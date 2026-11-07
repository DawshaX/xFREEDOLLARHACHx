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
/**
 * القايمة المتوسطة والبارامترات — «كنوز» مجّلوبة من `danielmiessler/SecLists`
 * (`Discovery/Web-Content/common.txt` + `quickhits.txt` + `burp-parameter-names.txt`)
 * عبر `api.github.com` في 2026-11-07، اتلمّت وراحت التكرار بالسطر:
 * `paths-medium.txt` = 7207 سطر (78KB) و`params-burp.txt` = 6453 سطر (54KB).
 * ليه جوه المستودع مش على النت؟ المكنة ما تشوفش `api.github.com` (متقاس)، فالملف
 * اللي جوه الحزمة هو الوحيد المضمون. و`ops/` كله بقى 928KB بدل 804KB (+130KB) —
 * ده مقاس ومتحمّل: 78KB نص بيضغط مع الحزمة، مقابل إن ffuf يبقى عنده 7207 مسار
 * يشتغل بيهم بدل 215، ونقطة بداية حقيقية لصيد البارامترات.
 */
export const WORDLISTS = {
  /** السريعة: على حاوية 1-2 نواة بتخلص في ثواني، ودي الافتراضي. */
  fast: "ops/wordlists/nova-paths.txt",
  /** المتوسطة: common + quickhits من SecLists — ~7.2 ألف مسار. */
  medium: "ops/wordlists/paths-medium.txt",
  /** أسماء بارامترات (burp-parameter-names) لـ`?FUZZ=1`. */
  params: "ops/wordlists/params-burp.txt",
} as const;
export type WordlistKind = keyof typeof WORDLISTS;

/** اختيار الحجم بالـenv: `NOVA_WORDLIST_SIZE=medium` أو ملف صريح بياخد الأولوية. */
export function resolveList(kind: WordlistKind, cwd: string = process.cwd()): string {
  const p = wordlistPathFor(WORDLISTS[kind], cwd);
  return p;
}

/** أول ملف موجود من المرشّحين؛ `""` = مفيش (والأداة تقول السبب، مش تصمت). */
function wordlistPathFor(rel: string, cwd: string): string {
  for (const base of [cwd, path.resolve(cwd, ".."), path.resolve(cwd, "../.."), path.resolve(cwd, "../../..")]) {
    const cand = path.join(base, rel);
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch {
      /* جرّب اللي بعده */
    }
  }
  return "";
}

/**
 * `NOVA_WORDLIST=/path` > `NOVA_WORDLIST_SIZE=fast|medium|params` > السريعة.
 * الأحجام دي مش زينة: على مكنة 208MHz/1 نواة القايمة المتوسطة تاخد دقائق، وده
 * قرار صاحب المكنة مش قرارنا — فالافتراضي يفضل السريع.
 */
export function wordlistPath(cwd: string = process.cwd()): string {
  const env = String(process.env.NOVA_WORDLIST ?? "").trim();
  if (env) {
    const abs = path.resolve(env);
    if (fs.existsSync(abs)) return abs;
  }
  const size = String(process.env.NOVA_WORDLIST_SIZE ?? "").trim().toLowerCase();
  if (size === "medium" || size === "params") return wordlistPathFor(WORDLISTS[size as WordlistKind], cwd);
  return wordlistPathFor(EMBEDDED_WORDLIST, cwd);
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
