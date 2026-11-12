import fs from "fs";
import path from "path";

const AUDIT_DIR = path.resolve("./logs");
const AUDIT_FILE = path.join(AUDIT_DIR, "agent-audit.jsonl");

try { fs.mkdirSync(AUDIT_DIR, { recursive: true }); } catch { }

export interface AuditEntry {
  ts: string;
  sessionId?: string;
  action:
    | "user_message"
    | "agent_response"
    | "exec_start"
    | "exec_result"
    | "exec_error"
    | "self_heal"
    | "kill_switch"
    | "autonomy_enable"
    | "autonomy_disable"
    | "connection"
    | "tool_call"
    | "exec_stream_start"
    // ── additive (2026-11-05): input-control + server exec events ──
    | "agent_exec"
    | "server_exec"
    | "mouse_input"
    | "keyboard_input";
  data: Record<string, unknown>;
}

/** سقف حجم ملف التدقيق بالكيلوبايت — NOVA_AUDIT_MAX_KB (الافتراضي 256). */
function auditMaxBytes(): number {
  const kb = Number(process.env.NOVA_AUDIT_MAX_KB);
  return Number.isFinite(kb) && kb > 0 ? Math.round(kb * 1024) : 256 * 1024;
}

/** كام سطر نحتفظ بيهم بعد القص — NOVA_AUDIT_KEEP_LINES (الافتراضي 600). */
function auditKeepLines(): number {
  const n = Number(process.env.NOVA_AUDIT_KEEP_LINES);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 600;
}

export function auditLog(entry: AuditEntry): void {
  try {
    const line = JSON.stringify({ ...entry, ts: entry.ts || new Date().toISOString() }) + "\n";
    fs.appendFileSync(AUDIT_FILE, line, "utf-8");
    // الملف ده كان بيكبر للأبد: سطر مع كل رسالة شات وكل استدعاء أداة، وعلى حاوية
    // مجانية (قرص 512MB–1.5GB) الزحف الصامت ده بيوقف السيرفر من غير ما حد يفهم ليه.
    // نفس حارس auto-update.log: فوق السقف → نحتفظ بآخر N سطر بس. التاريخ جوه كل سطر
    // فاللي بيتشال هو الأقدم فعلًا، وgetAuditLog أصلًا بيقرآ آخر limit سطر فمفيش
    // وظيفة بتتكسر — بس الديسك بقى محدود السقف حتى لو الشات اشتغل سنين.
    const st = fs.statSync(AUDIT_FILE);
    if (st.size > auditMaxBytes()) {
      const lines = fs.readFileSync(AUDIT_FILE, "utf-8").split("\n").filter(Boolean);
      fs.writeFileSync(AUDIT_FILE, lines.slice(-auditKeepLines()).join("\n") + "\n", "utf-8");
    }
  } catch { }
}

export function getAuditLog(limit = 100): AuditEntry[] {
  try {
    const raw = fs.readFileSync(AUDIT_FILE, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l) as AuditEntry);
  } catch { return []; }
}
