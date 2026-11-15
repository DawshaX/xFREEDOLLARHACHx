/**
 * kali-scan-stats — «إحصائيات الشغل الحقيقي» (TEST29).
 *
 * كل تنفيذ كالي (من أي طايرة — هَب أو عقدة) بيسجل هنا: مين نفّذ · إيه · امتى ·
 * نجح ولا لأ · كام بايت ناتج. ده مش ادعاء — ده عدّاد من أداة التسجيل نفسها
 * اللي بتتسحب في platform_self_report والصفحة. الملف خفيف (append JSONL)
 * ومكانته state/ — سحابي بالنسخ الاحتياطي دايمًا.
 */
import fs from "node:fs";
import path from "node:path";

export type ScanStat = {
  at: string;
  plane: string;
  cmd: string;
  ok: boolean;
  bytes: number;
};

const FILE = path.resolve(process.cwd(), "state", "kali_scan_stats_v1.jsonl");
const MAX_LINES = 500;

function append(stat: ScanStat): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean);
    } catch {
      lines = [];
    }
    lines.push(JSON.stringify(stat));
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
    fs.writeFileSync(FILE, lines.join("\n") + "\n");
  } catch {
    /* الإحصائية ماتكسّرش التنفيذ */
  }
}

/** استدعاء التسجيل — من tools.ts بعد كل تنفيذ كالي (مسار واحد موحّد). */
export function scanRunFromPlane(plane: string, cmd: string, ok: boolean, bytes = 0): void {
  append({
    at: new Date().toISOString(),
    plane,
    cmd: cmd.slice(0, 160),
    ok,
    bytes,
  });
}

/** عدّادات اللوحة — قراءة واحدة خفيفة. */
export function readScanStats(): { total: number; ok: number; fail: number; last: ScanStat | null; byPlane: Record<string, number> } {
  try {
    const lines = fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean).slice(-MAX_LINES);
    const rows = lines.map((l) => JSON.parse(l) as ScanStat);
    const byPlane: Record<string, number> = {};
    let ok = 0;
    for (const r of rows) {
      byPlane[r.plane] = (byPlane[r.plane] ?? 0) + 1;
      if (r.ok) ok += 1;
    }
    return {
      total: rows.length,
      ok,
      fail: rows.length - ok,
      last: rows.length ? rows[rows.length - 1] : null,
      byPlane,
    };
  } catch {
    return { total: 0, ok: 0, fail: 0, last: null, byPlane: {} };
  }
}
