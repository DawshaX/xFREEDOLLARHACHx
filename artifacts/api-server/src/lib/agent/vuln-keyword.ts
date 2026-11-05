/**
 * استخراج مصطلح بحث NVD من جملة المستخدم.
 *
 * اللي حصل فعلاً (سجل جلسة 2026-11-05): نوفا نادت
 *   vuln_search { keyword: "دور على ثغرات في الموقع ده وشوف لو فيه حاجة تتستغل", limit: 8 }
 * فجاب NVD `0 نتيجة` — والرد اتحسب «✓ نجحت». الصفر ده مش نتيجة بحث، ده
 * استعلام غلط: NVD بيبحث بمصطلح منتج/تقنية (Apache Tomcat 9.0.10, OpenSSL) أو
 * CVE-ID، والجملة العربية ما بتطابقش أي حاجة في الفهرس. الملف ده بيحوّل
 * الجملة لمصطلح، ولو مافيش مصطلح بيقول لأ — أحسن بكتير من استعلام فاضي.
 */
export interface VulnQuery {
  /** مصطلح keywordSearch — null لو المعرّف CVE لوحده كفاية */
  keyword: string | null;
  cveId: string | null;
  /** لو مافيش حاجة صالحة للبحث: احنا مش بناخد الجملة لـ NVD خالص */
  usable: boolean;
  reason: string;
}

const CVE_RE = /\b(CVE-\d{4}-\d{4,7})\b/i;
/** كلمات إنجليزية ما بتفيدش كمصطلح منتج */
const STOP = new Set([
  "the", "and", "for", "with", "search", "find", "look", "check", "latest", "recent",
  "vulnerab", "vulnerability", "vulnerabilities", "exploit", "cve", "ids", "known", "list",
  "show", "give", "tell", "me", "you", "please", "about", "does", "have", "has", "is", "are",
  "how", "what", "which", "any", "all", "new", "on", "of", "in", "at", "to", "from", "site",
  "website", "target", "scan", "security", "hack", "hacking", "bug", "bounty", "report",
]);

export function vulnQuery(text: string): VulnQuery {
  const raw = String(text ?? "");
  const cve = raw.match(CVE_RE)?.[1]?.toUpperCase() ?? null;
  // نص بين علامات اقتباس (عربي أو إنجليزي) = المستخدم بيقصدده بالظبط
  const quoted = raw.match(/["'«“]([^"'»”]{3,60})["'»”]/)?.[1]?.trim() ?? null;

  let cleaned = raw
    .replace(CVE_RE, " ")
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    // النطاقات بتتشال كاملة — قبل التقسيم، عشان example.com ما يطلّعش «example» «com»
    .replace(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\b/gi, " ")
    .replace(/["'«»“”]/g, " ")
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g, " ") // العربية كلها بره
    .replace(/[^\x20-\x7E]+/g, " ");

  // النقط جوه أرقام الإصدارات (9.0.10) جزء من المصطلح، فمش بنقسم عليها
  const tokens = cleaned
    .split(/[\s,;:!()?\-(){}\[\]/\\|@#$%^&*+=<>~`]+/)
    .map((t) => t.replace(/^[.]+|[.,;:]+$/g, "").trim())
    .filter((t) => t.length >= 2 && /[A-Za-z]/.test(t))
    .filter((t) => !STOP.has(t.toLowerCase()))
    .filter((t) => !/^[\d.]+$/.test(t));

  if (tokens.length === 0) {
    if (quoted) return { keyword: quoted, cveId: cve, usable: true, reason: "اقتباس صريح من كلام المستخدم" };
    if (cve) return { keyword: null, cveId: cve, usable: true, reason: "معرّف CVE كفاية" };
    return { keyword: null, cveId: null, usable: false, reason: "مافيش اسم منتج/تقنية في الطلب" };
  }
  const keyword = tokens.slice(0, 4).join(" ");
  return { keyword, cveId: cve, usable: true, reason: `مصطلح مستخرج من الجملة (${tokens.length} مرشّح)` };
}
