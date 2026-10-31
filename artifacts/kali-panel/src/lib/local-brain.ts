/**
 * Local brain — a real, honest agent loop that runs **inside the browser**.
 *
 * Why this exists: the GitHub Pages build has no server, so `/api/nova-core/chat`
 * used to fall through to a generic `{ok:true}` stub. The panel saw a 200 with a
 * body, assumed the core answered, and rendered an empty assistant bubble — the
 * chat "worked" and said nothing.
 *
 * This module gives the static build a genuine deterministic brain:
 *   • it plans with the same intent rules as the server (`heuristicPlan`),
 *   • it executes the tools that are computable from the in-browser corpus
 *     (memory, knowledge search, CVE lookup, corpus/platform stats),
 *   • it streams the exact same SSE event contract the server emits
 *     (`thought` / `plan` / `tool_call` / `tool_result` / `delta` / `done`),
 *   • and it is explicit about what it cannot do without a server (no live
 *     scanning, no machines) instead of pretending.
 *
 * Tools that need the network or a fleet are reported as "needs a server" —
 * never faked.
 */
import { buildSmartAgentResponse, getMissionsState, resolveStandaloneApi } from "./standalone-api";

export type LocalBrainEvent =
  | { type: "ready"; sessionId: string; mode: "builtin"; provider: string; model: string; tools: number }
  | { type: "thought"; text: string }
  | { type: "plan"; steps: Array<{ tool: string; args: Record<string, unknown> }> }
  | { type: "tool_call"; id: string; name: string; title: string; args: Record<string, unknown>; risk: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; ms: number; dataPreview: string }
  | { type: "delta"; text: string }
  | { type: "done"; sessionId: string; mode: string; toolCount: number; ms: number; provider: string }
  | { type: "error"; message: string };

interface Step {
  tool: string;
  args: Record<string, unknown>;
  title: string;
}

/**
 * Tools this brain can really run without a server.
 *
 * The browser has a network stack, so DNS, public advisories, GitHub search and
 * page fetching are genuinely doable client-side (all of those APIs send CORS
 * headers). What a browser cannot do — raw sockets, TLS handshakes, arbitrary
 * ports — stays in SERVER_ONLY and is reported as such.
 */
const LOCAL_TOOLS = new Set([
  "memory_search", "knowledge_search", "cve_lookup", "corpus_stats", "platform_status", "memory_list",
  "mission_status", "dns_lookup", "github_search", "exploit_search", "web_fetch", "subdomain_enum",
]);
/** Tools that exist but need the server (reported honestly, never faked). */
const SERVER_ONLY = new Set(["recon_target", "tls_audit", "http_headers_audit", "port_scan", "fleet_list", "fleet_profile", "fleet_exec", "device_control_map", "report_generate"]);

const TITLES: Record<string, string> = {
  memory_search: "بحث في الذاكرة",
  memory_list: "قراءة الذاكرة",
  knowledge_search: "بحث في فهرس المعرفة",
  cve_lookup: "بحث ثغرة في الفهرس المحلي",
  corpus_stats: "إحصاءات الفهرس",
  platform_status: "حالة المنصة",
  mission_status: "حالة المهمة",
  dns_lookup: "فحص DNS الحي",
  subdomain_enum: "تعداد نطاقات فرعية (crt.sh)",
  github_search: "بحث GitHub الحي",
  exploit_search: "بحث ثغرات حي (OSV)",
  recon_target: "استطلاع الهدف",
  port_scan: "فحص المنافذ",
  web_fetch: "جلب صفحة",
  fleet_list: "قراءة الأجهزة المتصلة",
  fleet_exec: "تنفيذ أمر على جهاز",
};

/* ─────────────────────────── understanding ─────────────────────────────── */

/**
 * What the user actually asked for.
 *
 * The old planner matched keywords, so «مرحبا» became a knowledge search and
 * every answer was the same canned intel dump. This classifies the message
 * first, and only then decides which (if any) tools to run.
 */
export type Intent =
  | { kind: "greeting" }
  | { kind: "thanks" }
  | { kind: "identity" }
  | { kind: "capabilities" }
  | { kind: "status" }
  | { kind: "memory"; query: string }
  | { kind: "cve"; cveId: string }
  | { kind: "scan"; target: string }
  | { kind: "github"; query: string }
  | { kind: "fetch"; url: string }
  | { kind: "exploit"; query: string }
  | { kind: "knowledge"; query: string }
  | { kind: "smalltalk"; text: string };

/** Normalise Arabic chat text: strip diacritics, punctuation runs, letter stutter. */
export function normalizeIntentText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "") // tashkeel
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/(.)\1{2,}/g, "$1$1") // مرحباااااا → مرحباا
    .replace(/[!؟?.,،؛;:…\-"']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DOMAIN_RE = /(?:[a-z0-9-]+\.)+[a-z]{2,}/i;

export function understand(message: string): Intent {
  const raw = message.trim();
  const t = normalizeIntentText(raw);
  const words = t.split(" ").filter(Boolean);
  const cveId = raw.match(/CVE-\d{4}-\d{4,7}/i)?.[0]?.toUpperCase() ?? null;
  const domain = raw.match(DOMAIN_RE)?.[0] ?? null;
  const short = words.length <= 6;

  // «مرحباااااااااا» must read as «مرحبا»: compare a fully-collapsed variant too.
  const collapsed = t.replace(/(.)\1+/g, "$1");
  const variants = collapsed === t ? [t] : [t, collapsed];
  const has = (re: RegExp) => variants.some((v) => re.test(v));
  const exact = (re: RegExp) => variants.some((v) => re.test(v));

  if (short && exact(/^(مرحبا|مرحبتين|هلا|هاي|هلو|اهلا|السلام عليكم|سلام|صباح الخير|مساء الخير|ازيك|عامل ايه|اخبارك|ايه الاخبار|hello|hi|hey|yo|sup)$/))
    return { kind: "greeting" };
  if (short && exact(/^(شكرا|تسلم|ميرسي|ربنا يكرمك|thanks|thank you|thx|ok|تمام|ماشي|حلو)$/)) return { kind: "thanks" };
  if (has(/(مين انت|من انت|انت مين|اسمك ايه|مين حضرتك|who are you|عرّف بنفسك|عرف بنفسك)/)) return { kind: "identity" };
  if (has(/(بتعرف تعمل|تعرف تعمل|امكانيات|قدرات|بتساعد في|بتعمل ايه|تقدر تعمل ايه|what can you do|ساعدني في ايه)/))
    return { kind: "capabilities" };

  if (cveId) {
    if (has(/(استغلال|exploit|poc|اثبات)/)) return { kind: "exploit", query: cveId };
    return { kind: "cve", cveId };
  }
  if (has(/(افحص|فحص|استطلع|scan|recon|دور علي نطاق|نطاق فرعي|subdomain)/) && domain)
    return { kind: "scan", target: domain };
  if (has(/(github|جيت هاب|جيتهاب|ريبو|مستودع|repo)/)) {
    const q = t.replace(/(github|جيت هاب|جيتهاب|ريبو|مستودع|repo|ابحث|دور|عن|علي|في)/g, " ").replace(/\s+/g, " ").trim();
    return { kind: "github", query: q || domain || raw.slice(0, 60) };
  }
  if (domain && has(/(افتح|اقرا|هات|جيب|محتوي|fetch|read|صفحه)/)) return { kind: "fetch", url: domain };
  if (has(/(استغلال|exploit|اثبات مفهوم)/)) return { kind: "exploit", query: domain ?? raw.slice(0, 60) };
  if (has(/(افتكر|تفتكر|فاكر|ذاكره|memory|remember|عني)/)) return { kind: "memory", query: raw.slice(0, 80) };
  if (has(/(حاله المنصه|احصائ|كام ثغره|ثغرات|الفهرس|galaxy|حاله الاسطول|الاسطول|stats|status)/)) return { kind: "status" };
  if (has(/(بحث|ابحث|دور|اعرف|اشرح|ايه هو|ايه هي|what is|explain)/) || domain)
    return { kind: "knowledge", query: raw.slice(0, 90) };

  return { kind: "smalltalk", text: raw };
}

/** Turn an intent into the smallest set of real tool calls that can answer it. */
export function planFor(intent: Intent, message: string): { thought: string; steps: Step[] } {
  const q = message.trim().slice(0, 80);
  switch (intent.kind) {
    case "greeting":
      return { thought: "دي تحية — مفيش داعي أشغّل أدوات. هرد وأقولك أنا جاهز لإيه.", steps: [] };
    case "thanks":
      return { thought: "شكر — رد قصير وكفاية.", steps: [] };
    case "identity":
      return { thought: "بيسأل مين أنا — هعرّفه بنفسي وباللي شغّال فعلاً.", steps: [] };
    case "capabilities":
      return { thought: "بيسأل أقدر أعمل إيه — هقول الحقيقة: اللي شغّال واللي محتاج سيرفر.", steps: [] };
    case "smalltalk":
      return { thought: "مش فاهم قصدك بالظبط — هسأله يوضّح بدل ما أخمّن.", steps: [] };
    case "status":
      return {
        thought: "بيسأل عن حالة المنصة — هقرأ الأرقام الحقيقية من الفهرس والذاكرة.",
        steps: [
          { tool: "platform_status", title: TITLES.platform_status, args: {} },
          { tool: "corpus_stats", title: TITLES.corpus_stats, args: {} },
          { tool: "memory_list", title: TITLES.memory_list, args: {} },
        ],
      };
    case "memory":
      return { thought: "بيسأل عن حاجة في الذاكرة — هدور فيها.", steps: [{ tool: "memory_search", title: TITLES.memory_search, args: { query: intent.query } }] };
    case "cve":
      return {
        thought: `السؤال عن ${intent.cveId} — هدور عليه في الفهرس المحلي وعند OSV.`,
        steps: [
          { tool: "cve_lookup", title: TITLES.cve_lookup, args: { cveId: intent.cveId } },
          { tool: "exploit_search", title: TITLES.exploit_search, args: { query: intent.cveId } },
        ],
      };
    case "exploit":
      return { thought: "بيسأل عن استغلال — هدور في OSV.", steps: [{ tool: "exploit_search", title: TITLES.exploit_search, args: { query: intent.query } }] };
    case "scan":
      return {
        thought: `هدف واضح (${intent.target}) — DNS و نطاقات فرعية بينفعوا من المتصفح فعلاً.`,
        steps: [
          { tool: "dns_lookup", title: TITLES.dns_lookup, args: { target: intent.target } },
          { tool: "subdomain_enum", title: TITLES.subdomain_enum, args: { target: intent.target } },
        ],
      };
    case "github":
      return { thought: "بدور على GitHub — ده API حي وبيشتغل من المتصفح.", steps: [{ tool: "github_search", title: TITLES.github_search, args: { query: intent.query } }] };
    case "fetch":
      return { thought: `هقرا ${intent.url} وألخّصلك اللي فيها.`, steps: [{ tool: "web_fetch", title: TITLES.web_fetch, args: { url: intent.url } }] };
    case "knowledge":
      return { thought: "هدور في فهرس المعرفة المحلي الأول، ولو مفيش نتيجة أقولك.", steps: [{ tool: "knowledge_search", title: TITLES.knowledge_search, args: { query: q } }] };
  }
}

/** Kept for callers/tests that only need the plan. */
export function planLocally(message: string): { thought: string; steps: Step[] } {
  return planFor(understand(message), message);
}

interface ToolOutcome {
  ok: boolean;
  summary: string;
  data: unknown;
}

/** Small, bounded fetch used by the network tools. Never throws past the tool. */
async function getJson(url: string, timeoutMs = 7000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url: string, timeoutMs = 9000): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function runLocalTool(step: Step): Promise<ToolOutcome> {
  try {
    switch (step.tool) {
      case "memory_search": {
        const q = String(step.args.query ?? "");
        const res = resolveStandaloneApi(`/memory/search?q=${encodeURIComponent(q)}`, "GET", null) as
          | { results?: Array<{ title?: string; content?: string }> }
          | Array<{ title?: string; content?: string }>
          | null;
        const list = Array.isArray(res) ? res : (res?.results ?? []);
        if (!list.length) return { ok: true, summary: "مفيش ذكريات مطابقة للسؤال ده", data: [] };
        return {
          ok: true,
          summary: `${list.length} ذكرى: ${list.slice(0, 3).map((m) => m.title ?? "").filter(Boolean).join(" · ")}`,
          data: list.slice(0, 5),
        };
      }
      case "memory_list": {
        const res = resolveStandaloneApi("/memory", "GET", null) as { memories?: unknown[] } | unknown[] | null;
        const list = Array.isArray(res) ? res : (res?.memories ?? []);
        return { ok: true, summary: `${list.length} ذكرى محفوظة`, data: list.slice(0, 5) };
      }
      case "knowledge_search": {
        const q = String(step.args.query ?? "");
        const res = resolveStandaloneApi(`/knowledge/search?q=${encodeURIComponent(q)}&limit=6`, "GET", null) as {
          items?: Array<{ title?: string }>;
        } | null;
        const items = res?.items ?? [];
        return items.length
          ? { ok: true, summary: `${items.length} نتيجة من الفهرس: ${items.slice(0, 3).map((i) => i.title ?? "").join(" · ")}`, data: items }
          : { ok: true, summary: "مفيش نتائج مطابقة في الفهرس المحلي", data: [] };
      }
      case "cve_lookup": {
        const id = String(step.args.cveId ?? "").toUpperCase();
        const res = resolveStandaloneApi(`/cve/search?q=${encodeURIComponent(id)}&limit=5`, "GET", null) as {
          cves?: Array<{ cveId?: string; description?: string; cvssScore?: number }>;
          results?: Array<{ cveId?: string; description?: string; cvssScore?: number }>;
        } | null;
        const list = res?.cves ?? res?.results ?? [];
        if (list.length) {
          return {
            ok: true,
            summary: `${id}: ${list[0]?.description?.slice(0, 120) ?? "موجودة في الفهرس"} (CVSS ${list[0]?.cvssScore ?? "?"})`,
            data: list,
          };
        }
        // Not in the local corpus: ask NVD directly (CORS-friendly, no key).
        try {
          const nvd = (await getJson(
            `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(id)}`,
            12000,
          )) as {
            vulnerabilities?: Array<{
              cve?: {
                id?: string;
                descriptions?: Array<{ lang?: string; value?: string }>;
                metrics?: { cvssMetricV31?: Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }> };
              };
            }>;
          };
          const v = nvd.vulnerabilities?.[0]?.cve;
          if (v) {
            const desc = v.descriptions?.find((d) => d.lang === "en")?.value ?? "";
            const score = v.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore;
            const sev = v.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity;
            return {
              ok: true,
              summary: `${id}${score ? ` · CVSS ${score} ${sev ?? ""}` : ""}: ${desc.slice(0, 300)}`,
              data: { id, description: desc, score, severity: sev, source: "NVD live" },
            };
          }
        } catch {
          /* NVD blocked or offline — say so below */
        }
        return {
          ok: false,
          summary: `${id} مش في الفهرس المحلي ومقدرتش أوصله من NVD دلوقتي (شبكة/CORS).`,
          data: null,
        };
      }
      case "dns_lookup": {
        const domain = String(step.args.target ?? "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
        if (!domain) return { ok: false, summary: "محتاج اسم نطاق", data: null };
        const types = ["A", "AAAA", "MX", "TXT", "NS"] as const;
        const out: Record<string, string[]> = {};
        for (const t of types) {
          try {
            const j = (await getJson(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${t}`)) as {
              Answer?: Array<{ data?: string }>;
            };
            out[t] = (j.Answer ?? []).map((a) => String(a.data ?? "")).filter(Boolean).slice(0, 6);
          } catch {
            out[t] = [];
          }
        }
        const total = Object.values(out).reduce((n, v) => n + v.length, 0);
        return total
          ? { ok: true, summary: `DNS حي لـ ${domain}: A ${out.A[0] ?? "—"} · MX ${out.MX.length} · TXT ${out.TXT.length} · NS ${out.NS.length}`, data: out }
          : { ok: false, summary: `مفيش سجلات DNS راجعة لـ ${domain} (ممكن النطاق مش موجود أو الشبكة مقفولة)`, data: out };
      }
      case "subdomain_enum": {
        const domain = String(step.args.target ?? "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
        // crt.sh first (certificate transparency = the widest source), but it is
        // frequently down, so a real DoH sweep of common prefixes backs it up.
        try {
          const j = (await getJson(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`, 10000)) as Array<{
            name_value?: string;
          }>;
          const names = new Set<string>();
          for (const row of Array.isArray(j) ? j : []) {
            for (const n of String(row.name_value ?? "").split("\n")) {
              const clean = n.trim().toLowerCase();
              if (clean && !clean.startsWith("*") && clean.endsWith(domain)) names.add(clean);
            }
          }
          const list = [...names].slice(0, 40);
          if (list.length) {
            return { ok: true, summary: `${list.length} نطاق فرعي من سجلات الشهادات (crt.sh): ${list.slice(0, 4).join(" · ")}`, data: list };
          }
        } catch {
          /* fall through to DNS */
        }
        const prefixes = ["www", "mail", "api", "dev", "staging", "admin", "app", "blog", "cdn", "docs"];
        const found: string[] = [];
        await Promise.all(
          prefixes.map(async (p) => {
            try {
              const j = (await getJson(`https://dns.google/resolve?name=${p}.${domain}&type=A`, 5000)) as {
                Answer?: unknown[];
              };
              if ((j.Answer ?? []).length) found.push(`${p}.${domain}`);
            } catch {
              /* ignore single failure */
            }
          }),
        );
        const sorted = found.sort();
        return sorted.length
          ? { ok: true, summary: `${sorted.length} نطاق فرعي حي عبر DNS: ${sorted.join(" · ")}`, data: sorted }
          : { ok: false, summary: `مفيش نطاقات فرعية ظاهرة لـ ${domain} (crt.sh وقع وDNS مالوش نتائج للبادئات الشائعة)`, data: [] };
      }
      case "github_search": {
        const q = String(step.args.query ?? "");
        const j = (await getJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5`)) as {
          total_count?: number;
          items?: Array<{ full_name?: string; stargazers_count?: number; html_url?: string }>;
        };
        const items = j.items ?? [];
        return items.length
          ? {
              ok: true,
              summary: `${(j.total_count ?? 0).toLocaleString()} مستودع · الأبرز: ${items.slice(0, 3).map((i) => i.full_name).join(" · ")}`,
              data: items.map((i) => ({ name: i.full_name, stars: i.stargazers_count, url: i.html_url })),
            }
          : { ok: false, summary: `GitHub مالوش نتائج لـ «${q}»`, data: [] };
      }
      case "exploit_search": {
        const q = String(step.args.query ?? "");
        const j = (await getJson(`https://api.osv.dev/v1/vulns/${encodeURIComponent(q)}`)) as {
          id?: string;
          summary?: string;
          severity?: unknown[];
          aliases?: string[];
        };
        return j?.id
          ? { ok: true, summary: `${j.id}: ${String(j.summary ?? "").slice(0, 140)} — ${(j.aliases ?? []).join(", ") || "مفيش مرادفات"}`, data: j }
          : { ok: false, summary: `مفيش سجل استغلال لـ ${q}`, data: null };
      }
      case "web_fetch": {
        const url = String(step.args.url ?? "");
        const absolute = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        const text = await getText(`https://r.jina.ai/${absolute}`, 15000);
        const clean = text.replace(/\s+/g, " ").trim();
        return clean
          ? { ok: true, summary: `قريت ${absolute} (${clean.length} حرف): ${clean.slice(0, 200)}`, data: clean.slice(0, 4000) }
          : { ok: false, summary: "الصفحة رجعت فاضية", data: null };
      }
      case "corpus_stats": {
        const res = resolveStandaloneApi("/corpus/stats", "GET", null) as { totalIndexedKnowledgeItems?: number } | null;
        return { ok: true, summary: `الفهرس المحلي: ${(res?.totalIndexedKnowledgeItems ?? 0).toLocaleString()} عنصر معرفي`, data: res };
      }
      case "platform_status": {
        const res = resolveStandaloneApi("/stats", "GET", null) as { totalCves?: number; criticalCves?: number } | null;
        return {
          ok: true,
          summary: `المنصة: ${res?.totalCves?.toLocaleString() ?? "?"} ثغرة (${res?.criticalCves ?? "?"} حرجة)`,
          data: res,
        };
      }
      case "mission_status": {
        const missions = getMissionsState();
        return missions.length
          ? { ok: true, summary: `${missions.length} مهمة · النشطة: ${missions[0]?.target ?? "—"}`, data: missions.slice(0, 3) }
          : { ok: true, summary: "مفيش مهام مسجّلة", data: [] };
      }
      default:
        return SERVER_ONLY.has(step.tool)
          ? {
              ok: false,
              summary: `«${TITLES[step.tool] ?? step.tool}» محتاجة سيرفر مربوط. من غير سيرفر مش هأدّعي إني نفّذتها.`,
              data: null,
            }
          : { ok: false, summary: "أداة غير معروفة في وضع المتصفح", data: null };
    }
  } catch (err) {
    return { ok: false, summary: `فشلت: ${(err as Error).message}`, data: null };
  }
}


/* ─────────────────────────── answering ─────────────────────────────────── */

type ToolResult = { name: string; ok: boolean; summary: string; data: unknown };

const SERVER_NOTE =
  "المتصفح مش قادر يعمل مسح منافذ TCP أو مصافحة TLS أو يشغّل أمر على جهاز تاني — ده محتاج سيرفر مربوط. أي حاجة تانية بتشتغل من هنا.";

function find(results: ToolResult[], name: string): ToolResult | undefined {
  return results.find((r) => r.name === name);
}

function canDoList(): string[] {
  return [
    "أبحث في فهرس المنصة والذاكرة (شغّال دلوقتي)",
    "أفحص DNS ونطاقات فرعية لأي نطاق حي (شغّال دلوقتي)",
    "أدور على ثغرة في OSV أو CVE في الفهرس (شغّال دلوقتي)",
    "أبحث في GitHub وأقرا أي صفحة وألخّصها (شغّال دلوقتي)",
    "أخطّط مهام وأحفظ الذاكرة (شغّال دلوقتي)",
    "مسح منافذ / TLS / تنفيذ على أجهزة — محتاج سيرفر مربوط",
  ];
}

function composeReply(intent: Intent, results: ToolResult[], message: string): string[] {
  switch (intent.kind) {
    case "greeting":
      return [
        "أهلًا 👋 أنا نوفا — العقل الشغّال في المتصفح ده، من غير أي سيرفر.",
        "",
        "قولّي إيه اللي محتاجه:",
        "- «افحص example.com» → DNS ونطاقات فرعية حقيقية",
        "- «ابحث عن CVE-2025-29927» → من الفهرس و OSV",
        "- «إيه حالة المنصة؟» → الأرقام الحقيقية",
        "- «ابحث في GitHub عن nuclei» → نتائج حية",
      ];
    case "thanks":
      return ["العفو 🙌 موجود في أي وقت — ابعت اللي بعده."];
    case "identity":
      return [
        "أنا **نوفا** — العقل التكتيكي لمنصة CyberNova 2099، بشتغل هنا في المتصفح نفسه.",
        "",
        "يعني مفيش سيرفر مستني منك ولا إعداد: بقرا الذاكرة والفهرس، بضرب DNS وGitHub وOSV على النت، وبنفّذ اللي أقدر عليه فعلاً وأقولك بصراحة اللي مش أقدر عليه.",
      ];
    case "capabilities":
      return ["## اللي بعمله فعلاً دلوقتي", ...canDoList().slice(0, 5).map((l) => `- ${l}`), "", `> ${SERVER_NOTE}`];
    case "smalltalk": {
      const t = intent.text.slice(0, 60);
      return [
        `مش متأكد إني فهمت «${t}» صح.`,
        "",
        "تقصد إيه بالظبط؟",
        "- تفحص نطاق؟ اكتب: «افحص example.com»",
        "- تسأل عن ثغرة؟ اكتب رقمها: «CVE-2025-29927»",
        "- تسأل عن حالة المنصة؟ اكتب: «حالة المنصة»",
      ];
    }
    case "status": {
      const platform = find(results, "platform_status");
      const corpus = find(results, "corpus_stats");
      const mem = find(results, "memory_list");
      const lines = ["## حالة المنصة (أرقام حقيقية من المتصفح)", ""];
      if (platform?.ok) lines.push(`- ${platform.summary}`);
      if (corpus?.ok) lines.push(`- ${corpus.summary}`);
      if (mem?.ok) lines.push(`- ${mem.summary}`);
      lines.push(`- الأسطول: عقدة واحدة حقيقية = المتصفح ده (الباقي محتاج سيرفر)`);
      return lines;
    }
    case "memory": {
      const r = find(results, "memory_search");
      if (!r) return ["مفيش نتائج."];
      if (!r.ok) return [`${r.summary}`];
      return ["## من الذاكرة", "", r.summary];
    }
    case "cve": {
      const local = find(results, "cve_lookup");
      const osv = find(results, "exploit_search");
      const lines = [`## ${intent.cveId}`, ""];
      if (local?.ok) lines.push(`- ${local.summary}`);
      else lines.push(`- ${local?.summary ?? "مش لاقيها"}`);
      if (osv?.ok) lines.push(`- **OSV:** ${osv.summary}`);
      if (!local?.ok && !osv?.ok) {
        lines.push("", "لو عايز، افتحها على NVD مباشرة:", `https://nvd.nist.gov/vuln/detail/${intent.cveId}`);
      }
      return lines;
    }
    case "exploit": {
      const r = find(results, "exploit_search");
      return [`## استغلال: ${intent.query}`, "", r?.ok ? `- ${r.summary}` : `- ${r?.summary ?? "مفيش نتائج"}`];
    }
    case "scan": {
      const dns = find(results, "dns_lookup");
      const subs = find(results, "subdomain_enum");
      const lines = [`## فحص ${intent.target}`, ""];
      if (dns) lines.push(`- **DNS:** ${dns.summary}`);
      if (subs) lines.push(`- **نطاقات فرعية:** ${subs.summary}`);
      lines.push("", `> ${SERVER_NOTE}`);
      return lines;
    }
    case "github": {
      const r = find(results, "github_search");
      if (!r) return ["مفيش نتائج."];
      const items = Array.isArray(r.data) ? (r.data as Array<{ name?: string; stars?: number; url?: string }>) : [];
      const lines = [`## GitHub — «${intent.query}»`, "", r.summary];
      for (const it of items.slice(0, 5)) lines.push(`- [${it.name}](${it.url}) — ⭐ ${it.stars ?? 0}`);
      if (!r.ok) {
        lines.push("", "لو GitHub رد بحد الاستخدام (rate limit) استنى دقيقة وجرب تاني، أو ابحث مباشرة:", `https://github.com/search?q=${encodeURIComponent(intent.query)}&type=repositories`);
      }
      return lines;
    }
    case "fetch": {
      const r = find(results, "web_fetch");
      if (!r) return ["مقدرتش أقرا الصفحة."];
      if (!r.ok) return [`مقدرتش أقرا ${intent.url}: ${r.summary}`, "", `جرّب تفتحها بنفسك: https://${intent.url}`];
      return [`## ${intent.url}`, "", String(r.summary).slice(0, 1200)];
    }
    case "knowledge": {
      const r = find(results, "knowledge_search");
      if (!r) return ["مفيش نتائج."];
      if (!r.ok) return [`${r.summary}`];
      const items = Array.isArray(r.data) ? (r.data as Array<{ title?: string }>) : [];
      const lines = [`## نتائج «${intent.query}»`, "", r.summary];
      for (const it of items.slice(0, 5)) if (it.title) lines.push(`- ${it.title}`);
      if (!items.length) lines.push("", "مالقيتش في الفهرس المحلي. لو عايز أدور على النت قولي المصدر (GitHub / صفحة معيّنة).");
      return lines;
    }
  }
}

function preview(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 600);
  } catch {
    return String(value).slice(0, 600);
  }
}

/** Split a reply into small chunks so streaming looks natural. */
function chunks(text: string, size = 90): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [""];
}

/**
 * Run the local agent loop and return the reply. Callers either stream events
 * (setup.ts builds the SSE response) or just take the text (tests).
 */
export async function runLocalBrain(
  message: string,
  emit: (event: LocalBrainEvent) => void,
  opts: { sessionId?: string; history?: Array<{ role: string; content: string }> } = {},
): Promise<{ reply: string; toolsUsed: string[]; mode: "builtin" }> {
  const started = Date.now();
  const sessionId = opts.sessionId || `local-${Date.now()}`;

  emit({ type: "ready", sessionId, mode: "builtin", provider: "browser-engine", model: "cybernova-local", tools: 33 });

  const intent = understand(message);
  const plan = planFor(intent, message);
  emit({ type: "thought", text: plan.thought });
  emit({ type: "plan", steps: plan.steps.map((s2) => ({ tool: s2.tool, args: s2.args })) });

  const results: Array<{ name: string; ok: boolean; summary: string; data: unknown }> = [];
  for (const [idx, step] of plan.steps.entries()) {
    const id = `${idx + 1}-${step.tool}`;
    emit({
      type: "tool_call",
      id,
      name: step.tool,
      title: step.title,
      args: step.args,
      risk: SERVER_ONLY.has(step.tool) ? "needs-server" : "safe",
    });
    const t0 = Date.now();
    const outcome = await runLocalTool(step);
    const ms = Date.now() - t0;
    results.push({ name: step.tool, ...outcome });
    emit({ type: "tool_result", id, name: step.tool, ok: outcome.ok, summary: outcome.summary, ms, dataPreview: preview(outcome.data) });
  }

  // Answer the thing that was actually asked. No canned intel dump: the reply
  // is built from the intent and from what the tools really returned.
  const lines = composeReply(intent, results, message);

  const reply = lines.join("\n");
  for (const chunk of chunks(reply)) {
    emit({ type: "delta", text: chunk });
    await new Promise((r) => setTimeout(r, 6));
  }
  emit({ type: "done", sessionId, mode: "builtin", toolCount: results.length, ms: Date.now() - started, provider: "browser-engine" });

  return { reply, toolsUsed: results.map((r) => r.name), mode: "builtin" };
}

export const LOCAL_BRAIN_TOOL_COUNT = LOCAL_TOOLS.size;
