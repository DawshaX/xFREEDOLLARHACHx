import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, agentSessions, agentSessionMessages, botAlerts, botCronJobs } from "@workspace/db";
import { listProcesses } from "../lib/processes";
import os from "node:os";
import fs from "node:fs";
import { execFile } from "node:child_process";

const router: IRouter = Router();

/**
 * GPU مقاس مش متخمّن: nvidia-smi بس (لو موجود). غياب الملف أو فشله = مفيش GPU
 * مخصّص — وبنقولها بصراحة في الحقل noteAr بدل خانات صفرية توحي بوجود كارت.
 * النتيجة متخزنة مؤقتًا 60ث عشان المراقبة الحية ما تطلّعش process كل ثانية.
 */
export interface GpuReading {
  present: boolean;
  name?: string;
  memoryTotalMb?: number;
  memoryUsedMb?: number;
  utilizationPercent?: number;
  noteAr: string;
  measuredAt: string;
}
let gpuCache: GpuReading | null = null;
let gpuCacheAt = 0;

export function probeGpu(force = false): Promise<GpuReading> {
  if (!force && gpuCache && Date.now() - gpuCacheAt < 60_000) return Promise.resolve(gpuCache);
  return new Promise((resolvePromise) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=name,memory.total,memory.used,utilization.gpu", "--format=csv,noheader,nounits"],
      { timeout: 4_000 },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          gpuCache = {
            present: false,
            noteAr: "لا يوجد GPU مخصّص على هذه الخطة (nvidia-smi غير موجود) — المقاسات المتاحة: CPU/RAM/Disk.",
            measuredAt: new Date().toISOString(),
          };
        } else {
          const parts = stdout.trim().split("\n")[0].split(",").map((s) => s.trim());
          gpuCache = {
            present: true,
            name: parts[0],
            memoryTotalMb: Number(parts[1]),
            memoryUsedMb: Number(parts[2]),
            utilizationPercent: Number(parts[3]),
            noteAr: "GPU مخصّص موجود ومقاس من nvidia-smi.",
            measuredAt: new Date().toISOString(),
          };
        }
        gpuCacheAt = Date.now();
        resolvePromise(gpuCache);
      },
    );
  });
}

router.get("/monitor/system", async (_req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const cpuUsage = cpus.map((cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    return Math.round(((total - idle) / total) * 100);
  });
  const avgCpu = Math.round(cpuUsage.reduce((a, b) => a + b, 0) / cpuUsage.length);

  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    loadAvg: os.loadavg(),
    cpu: { model: cpus[0]?.model ?? "Unknown", cores: cpus.length, usage: avgCpu, perCore: cpuUsage },
    memory: { total: totalMem, used: usedMem, free: freeMem, usagePercent: Math.round((usedMem / totalMem) * 100) },
    gpu: await probeGpu(),
    disk: probeDiskSafe(),
    process: {
      pid: process.pid,
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
    },
    timestamp: new Date().toISOString(),
  });
});

/** قراءة قرص صامتة — statfs لو متاحة (Node 22: fs.statfsSync)، ولو فشلت بنقولها مش بنكمّر. */
function probeDiskSafe(): { present: boolean; totalMb?: number; freeMb?: number; noteAr: string } {
  try {
    const s = fs.statfsSync("/");
    return { present: true, totalMb: Math.round((s.blocks * s.bsize) / 1048576), freeMb: Math.round((s.bavail * s.bsize) / 1048576), noteAr: "مساحة القرص الجذري مقاسة من statfs." };
  } catch {
    return { present: false, noteAr: "تعذّر قياس القرص على هذا المضيف." };
  }
}

router.get("/monitor/processes", (_req, res) => {
  const procs = listProcesses();
  res.json({
    total: procs.length,
    running: procs.filter((p) => p.status === "running").length,
    processes: procs.slice(0, 50),
  });
});

router.get("/monitor/activity", async (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 20), 100);
  const recentMessages = await db
    .select({
      id: agentSessionMessages.id,
      role: agentSessionMessages.role,
      content: agentSessionMessages.content,
      toolName: agentSessionMessages.toolName,
      createdAt: agentSessionMessages.createdAt,
      sessionId: agentSessionMessages.sessionId,
    })
    .from(agentSessionMessages)
    .orderBy(desc(agentSessionMessages.createdAt))
    .limit(limit);

  const recentAlerts = await db.select().from(botAlerts).orderBy(desc(botAlerts.createdAt)).limit(10);
  const procs = listProcesses().filter((p) => p.status === "running").slice(0, 10);

  res.json({
    recentMessages: recentMessages.map((m) => ({ ...m, content: m.content.slice(0, 200) })),
    recentAlerts,
    runningProcesses: procs,
    timestamp: new Date().toISOString(),
  });
});

router.get("/monitor/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  function send(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  send("connected", { message: "CyberNova Monitor connected", timestamp: new Date().toISOString() });

  const systemInterval = setInterval(() => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpuUsage = cpus.map((cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      return Math.round(((total - cpu.times.idle) / total) * 100);
    });
    const avgCpu = Math.round(cpuUsage.reduce((a, b) => a + b, 0) / cpuUsage.length);

    send("system", {
      cpu: avgCpu,
      memUsed: Math.round((usedMem / totalMem) * 100),
      uptime: os.uptime(),
      loadAvg: os.loadavg()[0],
      timestamp: new Date().toISOString(),
    });
  }, 3000);

  const processInterval = setInterval(() => {
    const procs = listProcesses();
    send("processes", {
      total: procs.length,
      running: procs.filter((p) => p.status === "running").length,
      processes: procs
        .filter((p) => p.status === "running")
        .slice(0, 10)
        .map((p) => ({
          id: p.id,
          command: p.command.slice(0, 80),
          status: p.status,
          startedAt: p.startedAt,
        })),
    });
  }, 5000);

  const alertInterval = setInterval(async () => {
    try {
      const alerts = await db
        .select()
        .from(botAlerts)
        .where(eq(botAlerts.isRead, "false"))
        .orderBy(desc(botAlerts.createdAt))
        .limit(5);
      if (alerts.length > 0) {
        send("alerts", { count: alerts.length, alerts });
      }
    } catch {
      // ignore DB errors
    }
  }, 10000);

  req.on("close", () => {
    clearInterval(systemInterval);
    clearInterval(processInterval);
    clearInterval(alertInterval);
  });
});

router.get("/monitor/dashboard", async (_req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpuUsage = cpus.map((cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    return Math.round(((total - cpu.times.idle) / total) * 100);
  });
  const avgCpu = Math.round(cpuUsage.reduce((a, b) => a + b, 0) / cpuUsage.length);

  const procs = listProcesses();
  const sessions = await db.select().from(agentSessions).orderBy(desc(agentSessions.createdAt)).limit(5);
  const unreadAlerts = await db.select().from(botAlerts).where(eq(botAlerts.isRead, "false"));
  const cronJobs = await db.select().from(botCronJobs).where(eq(botCronJobs.isEnabled, "true"));

  res.json({
    system: {
      cpu: avgCpu,
      memUsed: Math.round((usedMem / totalMem) * 100),
      uptime: os.uptime(),
      hostname: os.hostname(),
    },
    processes: { total: procs.length, running: procs.filter((p) => p.status === "running").length },
    agent: {
      activeSessions: sessions.filter((s) => s.status === "active").length,
      totalSessions: sessions.length,
    },
    alerts: { unread: unreadAlerts.length, critical: unreadAlerts.filter((a) => a.severity === "critical").length },
    cronJobs: { enabled: cronJobs.length },
    timestamp: new Date().toISOString(),
  });
});

export default router;
