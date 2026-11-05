/**
 * حالة الأتمتة الحقيقية — المصدر الوحيد للحقيقة.
 *
 * ليه الملف ده موجود؟ لأن زر «الوضع المستقل» في محطة العمل كان بيبعت
 * POST /api/autonomous/enable ويردّ عليه `stubs.ts` بـ `{ok:true,active:true}`
 * من غير ما حد يفعّل حاجة: الواجهة كانت بتلمع، والعداد بيلف من الـSSE الملفّق،
 * لكن الديمون الحقيقي و`NOVA_OPS_AUTONOMY` ما اتغيروش خالص. يعني «مفعّل» كان
 * كلام. دلوقتي الحالة بتتكتب في ملف وبتتقرا من نفس المكان اللي بيحكم منه
 * المسح الذاتي (`ops/autonomy.ts`) — فلو الملف قال off، مفيش شاشة هتقول غير كده.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type AutonomyLevel = "off" | "passive" | "standard" | "deep";
const LEVELS: AutonomyLevel[] = ["off", "passive", "standard", "deep"];

export interface AutonomyRecord {
  enabled: boolean;
  level: AutonomyLevel;
  updatedAt: string;
  /** مين غيّرها: لوحة التحكم ولا مشغّل السيرفر */
  source: "panel" | "env" | "default";
  note?: string;
}

function stateDir(): string {
  if (process.env.NOVA_STATE_DIR) return process.env.NOVA_STATE_DIR;
  return path.resolve(process.cwd(), "state");
}
export function autonomyStateFile(): string {
  return path.join(stateDir(), "autonomy.json");
}

function normLevel(v: unknown, dflt: AutonomyLevel = "passive"): AutonomyLevel {
  const raw = String(v ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  if (raw === "standard" || raw === "deep" || raw === "passive") return raw;
  return dflt;
}

/**
 * المشغّل بيقدر يقفل الأتمتة نهائيًا بـ `NOVA_OPS_AUTONOMY=off` — وده
 * overriding lock: مفيش زر في المتصفح هيفتحها تاني (لأن القفل قرار مشغّل مش تفضيل واجهة).
 */
export function envLock(): { locked: boolean; level: AutonomyLevel } {
  const raw = String(process.env.NOVA_OPS_AUTONOMY ?? "").trim();
  if (!raw) return { locked: false, level: "passive" };
  return { locked: true, level: normLevel(raw) };
}

export function readAutonomyRecord(): AutonomyRecord | null {
  try {
    const f = autonomyStateFile();
    if (!fs.existsSync(f)) return null;
    const parsed = JSON.parse(fs.readFileSync(f, "utf-8")) as Partial<AutonomyRecord>;
    const enabled = parsed.enabled !== false;
    return {
      enabled,
      level: normLevel(parsed.level, enabled ? "passive" : "off"),
      updatedAt: String(parsed.updatedAt ?? ""),
      source: parsed.source === "panel" ? "panel" : parsed.source === "env" ? "env" : "default",
      note: parsed.note ? String(parsed.note) : undefined,
    };
  } catch {
    return null;
  }
}

export function writeAutonomyRecord(rec: AutonomyRecord): { ok: boolean; path: string; error?: string } {
  const f = autonomyStateFile();
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${JSON.stringify(rec, null, 2)}\n`, "utf-8");
    return { ok: true, path: f };
  } catch (e) {
    return { ok: false, path: f, error: e instanceof Error ? e.message : String(e) };
  }
}

/** الحالة الفاعلة: القفل من-env > ملف الحالة > الافتراضي passive */
export function effectiveAutonomy(): AutonomyRecord & { fileExists: boolean; writable: boolean } {
  const lock = envLock();
  const file = readAutonomyRecord();
  if (lock.locked) {
    return {
      enabled: lock.level !== "off",
      level: lock.level,
      updatedAt: file?.updatedAt ?? "",
      source: "env",
      note: `NOVA_OPS_AUTONOMY=${String(process.env.NOVA_OPS_AUTONOMY ?? "").trim()}`,
      fileExists: !!file,
      writable: false,
    };
  }
  if (file) return { ...file, fileExists: true, writable: true };
  return { enabled: true, level: "passive", updatedAt: "", source: "default", fileExists: false, writable: true };
}

export function isAutonomyLevel(v: string): v is AutonomyLevel {
  return (LEVELS as string[]).includes(v.trim().toLowerCase());
}
export const AUTONOMY_LEVELS = LEVELS;
