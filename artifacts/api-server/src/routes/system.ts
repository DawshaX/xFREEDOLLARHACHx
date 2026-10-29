import { Router, type IRouter } from "express";
import os from "node:os";
import { execSync } from "node:child_process";

const router: IRouter = Router();

function getCpuUsage(): number {
  try {
    const out = execSync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'", { timeout: 2000 }).toString().trim();
    return parseFloat(out) || 0;
  } catch {
    try {
      const cpus = os.cpus();
      let totalIdle = 0, totalTick = 0;
      for (const cpu of cpus) {
        for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      }
      return Math.round((1 - totalIdle / totalTick) * 100);
    } catch { return 0; }
  }
}

function getGpuInfo(): string {
  try {
    const out = execSync("nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null", { timeout: 2000 }).toString().trim();
    if (out) {
      const [util, memUsed, memTotal] = out.split(",").map(s => s.trim());
      return `${util}% (VRAM: ${memUsed}/${memTotal} MB)`;
    }
    return "N/A";
  } catch { return "N/A"; }
}

router.get("/system/metrics", (_req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpus = os.cpus();

    const metrics = {
      cpu: {
        usage: getCpuUsage(),
        cores: cpus.length,
        model: cpus[0]?.model ?? "Unknown",
        speed: cpus[0]?.speed ?? 0,
      },
      ram: {
        total: Math.round(totalMem / 1024 / 1024),
        used: Math.round(usedMem / 1024 / 1024),
        free: Math.round(freeMem / 1024 / 1024),
        percent: Math.round((usedMem / totalMem) * 100),
      },
      gpu: getGpuInfo(),
      uptime: Math.round(os.uptime()),
      platform: os.platform(),
      hostname: os.hostname(),
      loadAvg: os.loadavg().map(n => Math.round(n * 100) / 100),
    };

    res.json(metrics);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post("/system/run", async (req, res) => {
  const { cmd } = req.body as { cmd?: string };
  if (!cmd?.trim()) { res.status(400).json({ error: "cmd required" }); return; }
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
    res.json({ ok: true, stdout: stdout.slice(0, 5000), stderr: stderr.slice(0, 1000) });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    res.json({ ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? "" });
  }
});

export default router;
