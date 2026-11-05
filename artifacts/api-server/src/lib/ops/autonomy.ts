/**
 * NOVA — the background half of the ops engine
 * ─────────────────────────────────────────────
 * “Permanent, real, in the background” is not a slogan in this codebase: it means
 * the scheduler keeps producing *jobs* on the programs you authorized, with the
 * same gate, the same rate limiter and the same evidence chain as a manual run —
 * nobody is clicking anything.
 *
 * Safety properties, in order of importance:
 *
 *  1. **Depth is `passive` by default.** Passive kinds (DNS, CT-logs, public
 *     intel) never open a socket to the target's services, so an unattended loop
 *     cannot become an incident. `NOVA_OPS_AUTONOMY=standard|deep` opts into
 *     touching the service — and only for programs that are *not* `passive_only`,
 *     because the registry, not this file, is the authorization document.
 *  2. **Bounded.** One sweep per program per `NOVA_OPS_SWEEP_HOURS` (6), at most
 *     `NOVA_OPS_SWEEP_PROGRAMS` (4) programs per pulse, `NOVA_OPS_SWEEP_MAX_TASKS`
 *     (10) tasks per job. The ledger is on disk, so a restart does not re-sweep.
 *  3. **Silent on failure.** A sweep that throws is recorded in the ledger and the
 *     daemon carries on; a background job must never be able to take the server down.
 *
 * Set `NOVA_OPS_AUTONOMY=off` to switch this whole layer off.
 */
import fs from "node:fs";
import path from "node:path";
import { loadPrograms } from "./scope";
import { createJob, runJob } from "./runner";
import { broadcastEvent } from "../ws-hub";
import { logger } from "../logger";
import { effectiveAutonomy } from "../autonomy-state";

export type AutonomyLevel = "off" | "passive" | "standard" | "deep";

export interface SweepLedgerEntry {
  programId: string;
  at: string;
  jobId?: string;
  host?: string;
  status: "started" | "denied" | "error";
  note?: string;
}

export interface SweepResult {
  ran: boolean;
  level: AutonomyLevel;
  reason?: string;
  started: SweepLedgerEntry[];
  denied: SweepLedgerEntry[];
}

function envInt(name: string, min: number, max: number, dflt: number): number {
  const n = Number(process.env[name] ?? "");
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function autonomyLevel(): AutonomyLevel {
  // الملف المشترك بقى هو المرجع: قفل الـenv لسه أعلى سلطة، وبعده قرار اللوحة
  // (state/autonomy.json) وبعدين passive. قبل كده كانت env بس — فاللي كان
  // يضغط «تفعيل» في المحطة ما كان بيغيّر حاجة في المحرك خالص.
  return effectiveAutonomy().level;
}

/**
 * Ledger lives next to the programs file: both are “engine state you may commit”,
 * neither belongs in the job directory (which is per-job and gets pruned).
 */
function ledgerFile(): string {
  const programsPath = process.env.NOVA_PROGRAMS_FILE?.trim() || "state/programs.json";
  return path.join(path.dirname(path.resolve(programsPath)), "ops-sweeps.json");
}

function readLedger(): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerFile(), "utf8")) as { last?: Record<string, string> };
    return raw.last ?? {};
  } catch {
    return {};
  }
}

function writeLedger(last: Record<string, string>, entries: SweepLedgerEntry[]): void {
  try {
    fs.mkdirSync(path.dirname(ledgerFile()), { recursive: true });
    fs.writeFileSync(ledgerFile(), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), last, sweeps: entries.slice(-200) }, null, 2));
  } catch (err) {
    logger.warn({ err }, "ops sweep ledger write failed (sweep itself is unaffected)");
  }
}

function firstConcreteHost(hosts: string[], out: string[] = []): string | null {
  const clean = (h: string) => h.replace(/^\*\./, "").trim().toLowerCase();
  const isBad = (h: string) => out.some((pat) => clean(pat) === h || h.endsWith(`.${clean(pat)}`));
  for (const raw of hosts) {
    const h = clean(raw);
    if (h && !raw.startsWith("*.") && !isBad(h)) return h;
  }
  for (const raw of hosts) {
    const h = clean(raw);
    if (h && !isBad(h)) return h;
  }
  return null;
}

/** One autonomous sweep. Called by the background daemon — never by a user request. */
export async function runOpsSweep(): Promise<SweepResult> {
  const level = autonomyLevel();
  if (level === "off") return { ran: false, level, reason: "NOVA_OPS_AUTONOMY=off", started: [], denied: [] };

  const hours = envInt("NOVA_OPS_SWEEP_HOURS", 1, 168, 6);
  const maxPrograms = envInt("NOVA_OPS_SWEEP_PROGRAMS", 1, 16, 4);
  const maxTasks = envInt("NOVA_OPS_SWEEP_MAX_TASKS", 2, 40, 10);
  const last = readLedger();
  const nowMs = Date.now();

  const eligible = loadPrograms()
    .programs.filter((p) => p.enabled)
    .filter((p) => {
      const at = last[p.id];
      if (!at) return true;
      const age = nowMs - Date.parse(at);
      return !Number.isFinite(age) || age >= hours * 3_600_000;
    })
    .slice(0, maxPrograms);

  if (eligible.length === 0) {
    return {
      ran: false,
      level,
      reason: "مفيش برنامج مستحق دورة دلوقتي (كل برنامج مرة كل " + hours + " ساعة)",
      started: [],
      denied: [],
    };
  }

  const started: SweepLedgerEntry[] = [];
  const denied: SweepLedgerEntry[] = [];

  for (const program of eligible) {
    // `passive_only` is honoured even when the operator raised the global depth:
    // the per-program flag is the human's word about *that* program.
    const depth = program.passive_only ? "passive" : level;
    const host = firstConcreteHost(program.hosts ?? [], program.out_of_scope ?? []);
    if (!host) {
      denied.push({ programId: program.id, at: new Date().toISOString(), status: "denied", note: "مفيش هوست واضح في النطاقات" });
      continue;
    }
    try {
      const job = await createJob({
        target: host,
        programId: program.id,
        name: `دورة خلفية · ${program.name}`,
        objective: `متابعة استطلاعية تلقائية داخل نطاق ${program.id} (مصرّح به مسبقاً)`,
        depth: depth as "passive" | "standard" | "deep",
        tools: depth === "deep",
        maxTasks,
      });
      if (!job.ok || !job.job) {
        denied.push({ programId: program.id, at: new Date().toISOString(), status: "denied", host, note: job.error?.slice(0, 200) });
        continue;
      }
      last[program.id] = new Date().toISOString();
      started.push({ programId: program.id, at: last[program.id]!, jobId: job.job.id, host, status: "started" });
      // Fire and forget: the pump owns the pacing, the sweep must not block the pulse.
      void runJob(job.job.id).catch((err) => logger.warn({ err, jobId: job.job?.id }, "autonomous job run failed"));
    } catch (err) {
      denied.push({ programId: program.id, at: new Date().toISOString(), status: "error", host, note: (err as Error).message.slice(0, 200) });
    }
  }

  writeLedger(last, [...started, ...denied]);
  if (started.length) {
    broadcastEvent("nova-ops", { type: "ops.autosweep", jobs: started.map((s) => s.jobId), level, at: new Date().toISOString() });
    logger.info({ jobs: started.map((s) => `${s.programId}→${s.jobId}`), level }, "autonomous ops sweep started");
  }
  if (denied.length) logger.debug({ denied: denied.map((d) => `${d.programId}:${d.note}`) }, "autonomous sweep skips");

  return { ran: started.length > 0, level, started, denied };
}

/** Honest status line for /self-check and the panel banner. */
export function autonomySummary(): { level: AutonomyLevel; lastSweep: string | null; programs: number } {
  const last = readLedger();
  const stamps = Object.values(last).filter(Boolean).sort();
  return {
    level: autonomyLevel(),
    lastSweep: stamps.length ? stamps[stamps.length - 1]! : null,
    programs: Object.keys(last).length,
  };
}
