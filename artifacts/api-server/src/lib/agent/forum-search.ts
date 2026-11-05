/**
 * NOVA — Forum Search (ethical hacking communities)
 * ──────────────────────────────────────────────────
 *بحث في المنتديات الأخلاقية عن ثغرات، أدوات، وبيانات نوقشت بالفعل.
 *لا يطلب مفتاح ولا حساب — يستخدم DuckDuckGo مع فلاتر site: على منتديات موثوقة.
 *
 * المنتديات المستهدفة (عامة، تتطلب تسجيل للمشاركة لكنها قابلة للتصفح):
 *   - hacktheforum.com
 *   - xss.is
 *   - nulled.to
 *   - raidforums.com (أرشيف عام)
 *   - exploit.in (أرشيف عام)
 *
 * نتيجة البحث تتضمن عنوان + رابط + مقتطف، والمرجع هو DuckDuckGo فقط.
 */

import { webSearch } from "./web-search";

export interface ForumHit {
  title: string;
  url: string;
  snippet: string;
  forum: string;
}

export interface ForumSearchResult {
  query: string;
  source: string;
  results: ForumHit[];
  note?: string;
}

/** منتديات الهاكرز الأخلاقي المدعومة (site: للتصفية عبر DuckDuckGo) */
const FORUM_SITES = [
  { id: "hacktheforum", label: "HackTheForum", domain: "hacktheforum.com" },
  { id: "xss", label: "XSS.is", domain: "xss.is" },
  { id: "nulled", label: "Nulled", domain: "nulled.to" },
  { id: "exploit", label: "Exploit.in", domain: "exploit.in" },
];

/** DuckDuckGo مع site: لمنتدى واحد */
async function duckduckgoForum(query: string, domain: string, limit: number): Promise<ForumHit[]> {
  const q = `site:${domain} ${query}`;
  const res = await webSearch(q, limit);
  if (!res.results.length) return [];
  return res.results.map((h) => ({
    title: h.title,
    url: h.url,
    snippet: h.snippet,
    forum: domain,
  }));
}

/**
 * بحث في المنتديات الأخلاقية. يجرّب كل منتدى على حدة ويجمّع النتائج.
 * لو فقدت كل المنتديات، يرجع سبب الفشل صريحاً في `note`.
 */
export async function forumSearch(query: string, limit = 8): Promise<ForumSearchResult> {
  const q = query.trim();
  if (!q) return { query: q, source: "none", results: [], note: "استعلام فاضي" };

  const errors: string[] = [];
  const allHits: ForumHit[] = [];
  const perForum = Math.max(1, Math.floor(limit / FORUM_SITES.length));

  for (const site of FORUM_SITES) {
    try {
      const hits = await duckduckgoForum(q, site.domain, perForum);
      for (const h of hits) {
        if (allHits.length >= limit) break;
        allHits.push({ ...h, forum: site.label });
      }
    } catch (err) {
      errors.push(`${site.label}: ${(err as Error).message}`);
    }
  }

  if (allHits.length === 0) {
    return {
      query: q,
      source: "none",
      results: [],
      note: errors.length ? errors.join(" · ") : "مفيش نتائج في المنتديات",
    };
  }

  return {
    query: q,
    source: "المنتديات الأخلاقية",
    results: allHits,
  };
}
