import fs from "node:fs";
import path from "node:path";

/* ── سجل الأحداث الدائم (JSONL) ──────────────────────────────────────────────
 * طلب المالك 05:5xZ: «في سجل واشعارات أبديه في كل حتة تمت وبتتم».
 * كل عملية حقيقية (تثبيت · تشغيل أداة · بث ديسكتوب · تحديث نسخة · إصلاح تلقائي)
 * بتتكتب سطر JSON في state/events.jsonl — نفس مكان state/auto-update.json اللي
 * بيتحدّث على المكنة الشغّالة، فالسجل بيفضل موجود بعد الريبوت.
 * التسجيل عمره ما يكسر الخدمة — أي فشل في الكتابة يتاكل بصمت. */
function stateDir(): string {
  if (process.env.NOVA_STATIC_DIR) return path.resolve(process.env.NOVA_STATIC_DIR, "..", "state");
  return path.resolve(process.cwd(), "state");
}

export function novaEventsFile(): string {
  return path.join(stateDir(), "events.jsonl");
}

export type NovaEvent = { id: string; kind: string; title: string; detail: string; ts: string };

export function appendNovaEvent(kind: string, title: string, detail?: string): void {
  try {
    const f = novaEventsFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const ev: NovaEvent = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      title,
      detail: String(detail ?? "").slice(0, 400),
      ts: new Date().toISOString(),
    };
    fs.appendFileSync(f, JSON.stringify(ev) + "\n");
    /* سقف الحجم: فوق 1.5MB نحتفظ بآخر 400 حدث بس — السجل أبدي لكن مش منفوخ. */
    try {
      if (fs.statSync(f).size > 1_500_000) {
        const keep = fs.readFileSync(f, "utf8").trim().split("\n").slice(-400).join("\n") + "\n";
        fs.writeFileSync(f, keep);
      }
    } catch { /* race بين الطلبات — مش مهم */ }
  } catch { /* التسجيل مايكسّرش الخدمة أبدًا */ }
}

export function readNovaEvents(limit = 120): NovaEvent[] {
  try {
    const f = novaEventsFile();
    return fs
      .readFileSync(f, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l) as NovaEvent; } catch { return null; }
      })
      .filter(Boolean) as NovaEvent[];
  } catch {
    return [];
  }
}
