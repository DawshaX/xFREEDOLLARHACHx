/**
 * Keyless web search — the answer to «دوّر على النت».
 * ──────────────────────────────────────────────────
 * Measured 2026-11-05 from a real chat transcript on the live slot:
 *
 *   أنت: طب متبحث عالنت عن طرق مجانية وضيف انت
 *   نوفا: ممكن توضح لي بالضبط إيه اللي عايز أبحث عنه؟
 *
 * The question was not ambiguous — the agent had no search tool, so the only
 * move left was to ask the human something. `web_fetch` can open a URL you
 * already know; it cannot find one you don't.
 *
 * Backends, in order, all requiring no key, no account and no card:
 *   1. DuckDuckGo Instant Answer API  — answers + related topics (JSON, stable)
 *   2. Wikipedia OpenSearch          — titles + snippets for any topic
 * Both are public read-only endpoints. A failure from one is not fatal: the
 * next is tried, and if all fail the caller gets `results: []` **with the
 * reason**, so the tool can honestly say "search failed" instead of "no results
 * exist" — those are different sentences and only one of them is true.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResult {
  query: string;
  source: string;
  results: SearchHit[];
  /** Present only when nothing came back — says which backends failed and why. */
  note?: string;
}

const UA = "NOVA-CyberNova/2099 (+https://github.com/DawshaX/xFREEDOLLARHACHx)";

function clean(text: unknown): string {
  return String(text ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function duckduckgo(query: string, limit: number): Promise<SearchHit[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const body = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
    Results?: Array<{ Text?: string; FirstURL?: string }>;
  };
  const hits: SearchHit[] = [];
  if (body.AbstractText && body.AbstractURL) {
    hits.push({ title: clean(body.Heading) || query, url: body.AbstractURL, snippet: clean(body.AbstractText) });
  }
  const flatten = (list: typeof body.RelatedTopics): Array<{ Text?: string; FirstURL?: string }> => {
    const out: Array<{ Text?: string; FirstURL?: string }> = [];
    for (const item of list ?? []) {
      if (item.Topics) out.push(...item.Topics);
      else out.push(item);
    }
    return out;
  };
  for (const item of [...(body.Results ?? []), ...flatten(body.RelatedTopics)]) {
    if (hits.length >= limit) break;
    if (item?.FirstURL && item.Text) {
      hits.push({ title: clean(item.Text).slice(0, 90), url: item.FirstURL, snippet: clean(item.Text) });
    }
  }
  return hits;
}

async function wikipedia(query: string, limit: number): Promise<SearchHit[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=${Math.min(limit, 10)}&search=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const body = (await res.json()) as [string, string[], string[], string[]];
  const [, titles, snippets, urls] = body;
  return (titles ?? []).map((t, i) => ({
    title: clean(t),
    url: urls?.[i] ?? "",
    snippet: clean(snippets?.[i] ?? ""),
  }));
}

/**
 * Search the open web with no credentials.
 *
 * Never throws for a provider failure: the caller decides what a failure means,
 * and `note` carries the reasons so the reply can say them out loud.
 */
export async function webSearch(query: string, limit = 8): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { query: q, source: "none", results: [], note: "استعلام فاضي" };

  const errors: string[] = [];
  for (const [name, fn] of [
    ["DuckDuckGo", duckduckgo],
    ["Wikipedia", wikipedia],
  ] as const) {
    try {
      const hits = (await fn(q, limit)).filter((h) => h.url).slice(0, limit);
      if (hits.length) return { query: q, source: name, results: hits };
      errors.push(`${name}: مفيش نتائج`);
    } catch (err) {
      errors.push(`${name}: ${(err as Error).message}`);
    }
  }
  return { query: q, source: "none", results: [], note: errors.join(" · ") };
}
