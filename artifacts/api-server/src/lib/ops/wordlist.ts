/**
 * قائمة المسارات اللي بتتوزّع مع الحزمة — مش أوفر.
 * ────────────────────────────────────────────────────────────────────────────
 * `ffuf` و`gobuster` أداتين بلا معنى من غير wordlist، والحاوية المجانية مافيهاش
 * SecLists ومافيش root يثبّتها. فالحد الأدنى (215 سطر مختار يدويًا: لوحات،
 * `.env`, `.git`, actuator, swagger, wp-*, نقاط health/metrics) بقى ملف جوه
 * المستودع بيتم نسخّه مع `ops/` في الحزمة المحمولة — القياس: `ops/` كله كان
 * 804KB قبل الإضافة، ودي 1.9KB.
 *
 * عايز قائمة كاملة؟ `NOVA_WORDLIST=/path/to/SecLists-...txt` بياخد الأولوية،
 * ولو مالقيناش ولا ملف بنرجّع فاضي فتقرير الأداة يقول «مفيش wordlist» بدل ما
 * يطلع صفر نتائج ويبدو كأن الموقع نضيف — وده بالظبط نوع النجاح المفبرك اللي
 * البوابات هنا مبتقبلوش.
 */
import fs from "node:fs";
import path from "node:path";

export const EMBEDDED_WORDLIST = "ops/wordlists/nova-paths.txt";

/** أول ملف موجود من المرشّحين؛ `""` = مفيش (والأداة تقول السبب، مش تصمت). */
export function wordlistPath(cwd: string = process.cwd()): string {
  const env = String(process.env.NOVA_WORDLIST ?? "").trim();
  if (env) {
    const abs = path.resolve(env);
    if (fs.existsSync(abs)) return abs;
  }
  for (const base of [cwd, path.resolve(cwd, ".."), path.resolve(cwd, "../.."), path.resolve(cwd, "../../..")]) {
    const cand = path.join(base, EMBEDDED_WORDLIST);
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch {
      /* جرّب اللي بعده */
    }
  }
  return "";
}

export function wordlistInfo(cwd: string = process.cwd()): { path: string | null; lines: number; bytes: number; source: string } {
  const p = wordlistPath(cwd);
  if (!p) return { path: null, lines: 0, bytes: 0, source: "مفيش قائمة مدمجة — حطّ NOVA_WORDLIST" };
  try {
    const st = fs.statSync(p);
    let lines = 0;
    for (const chunk of String(fs.readFileSync(p, "utf8")).split("\n")) if (chunk.trim()) lines += 1;
    return { path: p, lines, bytes: st.size, source: envOverride() ? "NOVA_WORDLIST" : "embedded" };
  } catch (err) {
    return { path: p, lines: 0, bytes: 0, source: `مقروءش: ${(err as Error).message}` };
  }
}

function envOverride(): boolean {
  return Boolean(String(process.env.NOVA_WORDLIST ?? "").trim());
}
