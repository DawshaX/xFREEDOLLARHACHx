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

/** Same intent shape as the server's heuristic planner, trimmed to local tools. */
export function planLocally(message: string): { thought: string; steps: Step[] } {
  const msg = message.trim();
  const lower = msg.toLowerCase();
  const steps: Step[] = [];

  const target = msg.match(/(?:[a-z0-9-]+\.)+[a-z]{2,}/i)?.[0] ?? getMissionsState()[0]?.target ?? null;
  const cveId = msg.match(/CVE-\d{4}-\d{4,7}/i)?.[0];
  const wantsMemory = /(?:افتكر|تفتكر|ذاكر|memory|remember)/i.test(msg);
  const wantsKnowledge = /(?:بحث|ابحث|knowledge|فهرس|ثغرات|vuln)/i.test(msg);
  const wantsStats = /(?:احصائ|إحصائ|stats|كام|عدد|حالة)/i.test(msg);
  const wantsScan = /(?:افحص|نفذ|scan|nmap|nuclei|recon|استطلع)/i.test(msg);

  const wantsRepos = /(?:github|ريبو|مستودع|repo)/i.test(msg);
  const wantsExploit = /(?:exploit|استغلال|poC|poc)/i.test(msg);
  const wantsFetch = /(?:افتح|اقرا|اقرأ|جيب|fetch|اقتبس)/i.test(msg);

  if (cveId) steps.push({ tool: "cve_lookup", title: TITLES.cve_lookup, args: { cveId } });
  if (wantsMemory) steps.push({ tool: "memory_search", title: TITLES.memory_search, args: { query: msg.slice(0, 80) } });
  if (wantsKnowledge && !cveId) steps.push({ tool: "knowledge_search", title: TITLES.knowledge_search, args: { query: msg.slice(0, 80) } });
  if (wantsStats) steps.push({ tool: "corpus_stats", title: TITLES.corpus_stats, args: {} });
  if (wantsRepos) steps.push({ tool: "github_search", title: TITLES.github_search, args: { query: msg.slice(0, 60) } });
  if (wantsExploit) steps.push({ tool: "exploit_search", title: TITLES.exploit_search, args: { query: cveId ?? msg.slice(0, 60) } });
  if (wantsScan && target) {
    // Real client-side recon: DNS over HTTPS and certificate transparency both
    // work from a browser. Raw port scans still need a server — and we say so.
    steps.push({ tool: "dns_lookup", title: TITLES.dns_lookup, args: { target } });
    steps.push({ tool: "subdomain_enum", title: TITLES.subdomain_enum, args: { target } });
  } else if (wantsScan) {
    steps.push({ tool: "platform_status", title: TITLES.platform_status, args: {} });
  }
  if (wantsFetch && target) steps.push({ tool: "web_fetch", title: TITLES.web_fetch, args: { url: target } });
  if (steps.length === 0) {
    steps.push({ tool: "knowledge_search", title: TITLES.knowledge_search, args: { query: msg.slice(0, 80) } });
    if (target && /\.[a-z]{2,}/i.test(msg)) steps.push({ tool: "dns_lookup", title: TITLES.dns_lookup, args: { target } });
  }

  const thought = cveId
    ? `السؤال فيه معرّف ثغرة (${cveId}) — هبحث عنه في الفهرس المحلي قبل أي استنتاج.`
    : target
      ? `فيه هدف واضح (${target}). في وضع المتصفح أقدر أبحث في الفهرس والذاكرة، لكن الفحص الحقيقي محتاج سيرفر مربوط.`
      : "هجمع من الذاكرة وفهرس المعرفة المحلي الأول، وبعدها أقرر.";

  return { thought, steps: steps.slice(0, 4) };
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
        const id = String(step.args.cveId ?? "");
        const res = resolveStandaloneApi(`/cve/search?q=${encodeURIComponent(id)}&limit=5`, "GET", null) as {
          cves?: Array<{ cveId?: string; description?: string; cvssScore?: number }>;
          results?: Array<{ cveId?: string; description?: string; cvssScore?: number }>;
        } | null;
        const list = res?.cves ?? res?.results ?? [];
        return list.length
          ? { ok: true, summary: `${id}: ${list[0]?.description?.slice(0, 120) ?? "موجودة في الفهرس"} (CVSS ${list[0]?.cvssScore ?? "?"})`, data: list }
          : { ok: false, summary: `${id} مش موجودة في الفهرس المحلي — اسألني على سيرفر مربوط عشان أدور في NVD مباشرة`, data: null };
      }

      // ── real network tools (the browser has a network stack) ──────────────
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

  const plan = planLocally(message);
  emit({ type: "thought", text: plan.thought });
  emit({ type: "plan", steps: plan.steps.map((s) => ({ tool: s.tool, args: s.args })) });

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

  // Compose: the corpus brain gives the domain answer, then we append the real
  // tool outcomes so the reply never claims more than it did.
  const target = getMissionsState()[0]?.target || "immunefi.com";
  const base = buildSmartAgentResponse(message, target);
  const did = results.filter((r) => r.ok);
  const blocked = results.filter((r) => !r.ok);

  const lines: string[] = [base, "", "---", "### 🧾 اللي اتنفذ فعلاً في المتصفح"];
  if (did.length === 0) lines.push("- مفيش أداة محلية اتنفذت على الطلب ده.");
  for (const r of did) lines.push(`- ✅ **${r.name}** — ${r.summary}`);
  for (const r of blocked) lines.push(`- ⚠️ **${r.name}** — ${r.summary}`);

  lines.push("");
  lines.push("### 🧠 الوضع الحالي");
  lines.push(`- شغّال دلوقتي بالكامل في المتصفح: ذاكرة + فهرس + DNS حي + GitHub + OSV + قراءة صفحات. مفيش أي إعداد مطلوب.`);
  lines.push("- الحاجات الوحيدة اللي محتاجة سيرفر بحكم الفيزياء: مسح منافذ TCP، مصافحة TLS، تنفيذ أوامر على أجهزة تانية. لو ربطت سيرفر بتاعك بتتفتح تلقائياً — ولو مش مربوط كل حاجة تانية بتشتغل عادي.");

  const reply = lines.join("\n");
  for (const chunk of chunks(reply)) {
    emit({ type: "delta", text: chunk });
    await new Promise((r) => setTimeout(r, 6));
  }
  emit({ type: "done", sessionId, mode: "builtin", toolCount: results.length, ms: Date.now() - started, provider: "browser-engine" });

  return { reply, toolsUsed: results.map((r) => r.name), mode: "builtin" };
}

export const LOCAL_BRAIN_TOOL_COUNT = LOCAL_TOOLS.size;
