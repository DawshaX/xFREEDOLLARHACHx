/**
 * Nova Cron Scheduler — Smart AI Jobs (Standalone, No-DB)
 * 6 intelligent cron jobs: CVE hunt, self-heal probe, Telegram pulse,
 * memory consolidation, nova learner, system watchdog
 */
import { logger } from "./logger";
import { runHunt } from "./nova-cve-monitor";
import { consolidateMemoryLite } from "./nova-learner-lite";

export interface CronJob {
  id: string; name: string; cronExpr: string; enabled: boolean;
  lastRun?: string; lastResult?: string; nextRun?: string; runCount: number; errorCount: number;
}

const JOBS: CronJob[] = [
  { id: "cve_hunt",        name: "CVE Hunt (NVD+CISA+EDB+CIRCL)", cronExpr: "*/5 * * * *",  enabled: true, runCount: 0, errorCount: 0 },
  { id: "mem_consolidate", name: "Memory Consolidation",           cronExpr: "*/30 * * * *", enabled: true, runCount: 0, errorCount: 0 },
  { id: "self_heal",       name: "Self-Heal Probe",                cronExpr: "*/10 * * * *", enabled: true, runCount: 0, errorCount: 0 },
  { id: "tg_pulse",        name: "Telegram Heartbeat",             cronExpr: "0 * * * *",    enabled: false, runCount: 0, errorCount: 0 },
  { id: "sys_watchdog",    name: "System Watchdog",                cronExpr: "*/15 * * * *", enabled: true, runCount: 0, errorCount: 0 },
  { id: "nova_learn",      name: "Nova Auto-Learner",              cronExpr: "0 */6 * * *",  enabled: true, runCount: 0, errorCount: 0 },
];

const INTERVALS = new Map<string, ReturnType<typeof setInterval>>();

// ── Job implementations ───────────────────────────────────────────────────────
async function runJob(id: string): Promise<string> {
  switch (id) {
    case "cve_hunt": {
      const r = await runHunt();
      return `NVD:${r.nvdNew} CISA:${r.cisaNew} EDB:${r.edbNew} CIRCL:${r.circlNew} total:${r.totalNew}`;
    }
    case "mem_consolidate": {
      const n = consolidateMemoryLite();
      return `Consolidated ${n} entries`;
    }
    case "self_heal": {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execP = promisify(exec);
      try { await execP("echo healthcheck", { timeout: 5000 }); return "system OK"; }
      catch (e: any) { return `probe failed: ${e.message}`; }
    }
    case "tg_pulse": {
      const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "8430446319:AAFLClPeztKQe5HyPmVA0dCl6ULM699DRYo";
      const chatId   = process.env.TELEGRAM_CHAT_ID   ?? "1890579200";
      const msg = `💓 CyberNova v3 Pulse — ${new Date().toLocaleString("ar")}`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: msg }), signal: AbortSignal.timeout(10000) });
      return "telegram pulse sent";
    }
    case "sys_watchdog": {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execP = promisify(exec);
      try {
        const { stdout } = await execP("df -h / | tail -1 | awk '{print $5}' && free -m | awk 'NR==2{printf \"%s/%s MB\", $3, $2}'", { timeout: 5000 });
        return `disk/mem: ${stdout.trim()}`;
      } catch { return "watchdog: stat unavailable"; }
    }
    case "nova_learn": {
      const n = consolidateMemoryLite();
      return `nova_learn: ${n} new patterns`;
    }
    default: return "unknown job";
  }
}

function parseIntervalMs(expr: string): number {
  const parts = expr.trim().split(" ");
  const minPart = parts[0];
  if (minPart.startsWith("*/")) { const n = parseInt(minPart.slice(2)); if (!isNaN(n)) return n * 60_000; }
  if (minPart === "0") {
    const hrPart = parts[1];
    if (hrPart?.startsWith("*/")) { const n = parseInt(hrPart.slice(2)); if (!isNaN(n)) return n * 3_600_000; }
    return 3_600_000;
  }
  return 5 * 60_000;
}

function scheduleJob(job: CronJob): void {
  if (INTERVALS.has(job.id)) { clearInterval(INTERVALS.get(job.id)!); INTERVALS.delete(job.id); }
  if (!job.enabled) return;
  const ms = parseIntervalMs(job.cronExpr);
  const interval = setInterval(async () => {
    const start = Date.now();
    job.lastRun = new Date().toISOString();
    job.nextRun = new Date(Date.now() + ms).toISOString();
    try {
      const result = await runJob(job.id);
      job.lastResult = result; job.runCount++;
      logger.info({ id: job.id, result, ms: Date.now()-start }, "Cron job done");
    } catch (e: any) {
      job.lastResult = `ERROR: ${e.message}`; job.errorCount++;
      logger.warn({ id: job.id, err: e.message }, "Cron job failed");
    }
  }, ms);
  INTERVALS.set(job.id, interval);
  job.nextRun = new Date(Date.now() + ms).toISOString();
  logger.info({ id: job.id, ms }, `Cron scheduled: ${job.name}`);
}

// ── Public API ────────────────────────────────────────────────────────────────
export function getJobs(): CronJob[] { return JOBS; }

export function enableJob(id: string, enabled: boolean): boolean {
  const job = JOBS.find(j => j.id === id);
  if (!job) return false;
  job.enabled = enabled;
  scheduleJob(job);
  return true;
}

export async function triggerJob(id: string): Promise<{ ok: boolean; result?: string; error?: string }> {
  const job = JOBS.find(j => j.id === id);
  if (!job) return { ok: false, error: "job not found" };
  const start = Date.now();
  job.lastRun = new Date().toISOString();
  try { const result = await runJob(id); job.lastResult = result; job.runCount++; return { ok: true, result }; }
  catch (e: any) { job.lastResult = `ERROR: ${e.message}`; job.errorCount++; return { ok: false, error: e.message }; }
}

export function startCronScheduler(): void {
  for (const job of JOBS) scheduleJob(job);
  logger.info(`Nova Cron Scheduler started — ${JOBS.filter(j=>j.enabled).length}/${JOBS.length} jobs active`);
}
