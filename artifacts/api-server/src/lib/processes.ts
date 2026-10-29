import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

export interface ProcessRecord {
  id: string;
  command: string;
  cwd: string;
  pid: number | null;
  status: "running" | "exited" | "killed" | "error";
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  output: string;
}

interface InternalProcess {
  record: ProcessRecord;
  child: ChildProcess | null;
  emitter: EventEmitter;
}

const MAX_OUTPUT = 200_000;
const MAX_CONCURRENT = 32;
const procs = new Map<string, InternalProcess>();

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function listProcesses(): ProcessRecord[] {
  return [...procs.values()]
    .map((p) => p.record)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function getProcess(id: string): ProcessRecord | null {
  return procs.get(id)?.record ?? null;
}

export function getEmitter(id: string): EventEmitter | null {
  return procs.get(id)?.emitter ?? null;
}

export function killProcess(id: string): boolean {
  const p = procs.get(id);
  if (!p || !p.child || p.record.status !== "running") return false;
  try {
    p.child.kill("SIGTERM");
    setTimeout(() => {
      if (p.record.status === "running") p.child?.kill("SIGKILL");
    }, 2000);
    return true;
  } catch {
    return false;
  }
}

export function clearProcess(id: string): boolean {
  const p = procs.get(id);
  if (!p) return false;
  if (p.record.status === "running") return false;
  procs.delete(id);
  return true;
}

export interface StartOptions {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export function startProcess(opts: StartOptions): ProcessRecord {
  const running = [...procs.values()].filter(
    (p) => p.record.status === "running",
  ).length;
  if (running >= MAX_CONCURRENT) {
    throw new Error(`Too many running processes (${running}/${MAX_CONCURRENT})`);
  }
  const id = newId();
  const cwd = opts.cwd || process.cwd();
  const emitter = new EventEmitter();
  const record: ProcessRecord = {
    id,
    command: opts.command,
    cwd,
    pid: null,
    status: "running",
    exitCode: null,
    startedAt: Date.now(),
    endedAt: null,
    output: "",
  };

  let child: ChildProcess;
  try {
    child = spawn("bash", ["-lc", opts.command], {
      cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    record.status = "error";
    record.endedAt = Date.now();
    record.output = e instanceof Error ? e.message : String(e);
    procs.set(id, { record, child: null, emitter });
    return record;
  }

  record.pid = child.pid ?? null;

  const append = (chunk: string) => {
    record.output += chunk;
    if (record.output.length > MAX_OUTPUT) {
      record.output =
        "...[truncated]\n" + record.output.slice(-MAX_OUTPUT + 100);
    }
    emitter.emit("data", chunk);
  };

  const stdout = child.stdout as Readable | null;
  const stderr = child.stderr as Readable | null;
  stdout?.setEncoding("utf8");
  stderr?.setEncoding("utf8");
  stdout?.on("data", (d: string) => append(d));
  stderr?.on("data", (d: string) => append(d));

  child.on("close", (code, signal) => {
    record.endedAt = Date.now();
    if (signal) {
      record.status = "killed";
      record.exitCode = null;
    } else {
      record.status = "exited";
      record.exitCode = code;
    }
    emitter.emit("end", { code, signal });
  });

  child.on("error", (err) => {
    append(`\n[spawn error] ${err.message}`);
    record.status = "error";
    record.endedAt = Date.now();
    emitter.emit("end", { code: null, signal: null });
  });

  procs.set(id, { record, child, emitter });
  return record;
}

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  durationMs: number;
}

export function runShell(
  command: string,
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeoutMs = Math.min(opts.timeoutMs ?? 30_000, 120_000);
    let child: ChildProcess;
    try {
      child = spawn("bash", ["-lc", command], {
        cwd: opts.cwd || process.cwd(),
        env: { ...process.env, ...(opts.env || {}) },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({
        ok: false,
        exitCode: null,
        output: e instanceof Error ? e.message : String(e),
        timedOut: false,
        durationMs: Date.now() - start,
      });
      return;
    }
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    const append = (d: string) => {
      output += d;
      if (output.length > MAX_OUTPUT) {
        output = "...[truncated]\n" + output.slice(-MAX_OUTPUT + 100);
      }
    };
    const stdout = child.stdout as Readable | null;
    const stderr = child.stderr as Readable | null;
    stdout?.setEncoding("utf8");
    stderr?.setEncoding("utf8");
    stdout?.on("data", (d: string) => append(d));
    stderr?.on("data", (d: string) => append(d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        output,
        timedOut,
        durationMs: Date.now() - start,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      append(`\n[spawn error] ${err.message}`);
      resolve({
        ok: false,
        exitCode: null,
        output,
        timedOut: false,
        durationMs: Date.now() - start,
      });
    });
  });
}
