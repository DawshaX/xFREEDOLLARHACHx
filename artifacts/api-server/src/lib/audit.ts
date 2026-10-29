import fs from "fs";
import path from "path";

const AUDIT_DIR = path.resolve("./logs");
const AUDIT_FILE = path.join(AUDIT_DIR, "agent-audit.jsonl");

try { fs.mkdirSync(AUDIT_DIR, { recursive: true }); } catch { }

export interface AuditEntry {
  ts: string;
  sessionId?: string;
  action: "user_message" | "agent_response" | "exec_start" | "exec_result" | "exec_error" | "self_heal" | "kill_switch" | "connection" | "tool_call" | "exec_stream_start";
  data: Record<string, unknown>;
}

export function auditLog(entry: AuditEntry): void {
  try {
    const line = JSON.stringify({ ...entry, ts: entry.ts || new Date().toISOString() }) + "\n";
    fs.appendFileSync(AUDIT_FILE, line, "utf-8");
  } catch { }
}

export function getAuditLog(limit = 100): AuditEntry[] {
  try {
    const raw = fs.readFileSync(AUDIT_FILE, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l) as AuditEntry);
  } catch { return []; }
}
