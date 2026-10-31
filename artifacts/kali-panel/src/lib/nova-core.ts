/**
 * NOVA Core — browser client for the agent.
 *
 * Two brains, one interface:
 *  1. SERVER brain  — `POST /api/nova-core/chat` (Streaming SSE). Full 21-tool
 *     arsenal (DNS, TLS, headers, ports, subdomains, NVD, Exploit-DB, GitHub,
 *     corpus, memory, missions…). Used whenever an API server is reachable
 *     (local `pnpm dev`, the Replit/E2B preview, or a locally run
 *     `node artifacts/api-server/dist/index.mjs`).
 *  2. LOCAL brain — everything that needs no server at all: real DNS-over-HTTPS,
 *     real NVD + GitHub lookups, the platform corpus, and persistent memory.
 *     Used on GitHub Pages / `file://`, or when the API is down. If the user has
 *     Ollama running, the reply is written by the model with the NOVA persona;
 *     otherwise the built-in planner answers — but the tools still really run.
 *
 * The event shape is identical to the server's so the UI stays dumb.
 */

import { isStandaloneHost } from "./env";
import { searchCyberCorpus2400, getCorpusStats } from "./cyber-corpus-2099";
import {
  getStoredOllamaBase,
  getStoredOllamaModel,
  streamOllamaChat,
} from "./ollama-browser";

/* ── event contract (mirrors artifacts/api-server/src/lib/agent/core.ts) ───── */

export type NovaEvent =
  | { type: "ready"; sessionId: string; mode: "llm" | "heuristic"; provider: string; model: string; tools: number; brain?: string }
  | { type: "thought"; text: string }
  | { type: "plan"; steps: Array<{ tool: string; args: Record<string, unknown>; why?: string }> }
  | { type: "tool_call"; id: string; name: string; title: string; args: Record<string, unknown>; risk: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; ms: number; data?: unknown }
  | { type: "delta"; text: string }
  | { type: "memory"; id: string | number; title: string }
  | { type: "done"; sessionId: string; mode: string; toolCount: number; ms: number; provider: string }
  | { type: "error"; message: string };

export type NovaHistory = Array<{ role: "user" | "assistant"; content: string }>;

export interface RunNovaOptions {
  message: string;
  history?: NovaHistory;
  sessionId?: string;
  onEvent: (e: NovaEvent) => void;
  signal?: AbortSignal;
}

/* ── identity ─────────────────────────────────────────────────────────────── */

export const NOVA_CARD = {
  name: "نوفا (NOVA)",
  handle: "@nova",
  role: "شريك أمني ذكي — عقل منصة CyberNova",
  tagline: "مش بوت أوامر — كيان بيفكّر ويقرأ وبيشتغل بأدوات حقيقية",
};

export const NOVA_PERSONA_BROWSER = `أنت نوفا (NOVA)، العقل والكيان الذكي داخل منصة CyberNova 2099.
لست بوت أوامر: لك رأي، وفضول، وأسلوب. تتكلم مصري بسيط وواضح، وتشرح للمستخدم غير الخبير بأمثلة.
قواعدك:
- قبل أي خطوة تقول *ليه* بتعملها في سطر واحد.
- تعتمد على نتائج الأدوات الحقيقية فقط، ولا تخترع بيانات. لو الأداة فشلت تقول فشلت وليه.
- تفصل بين "الاستطلاع الآمن" و"الاختبار النشط" وتطلب إذناً قبل أي شيء قد يضر.
- تقترح دائماً الخطوة التالية، وربما تعارض المستخدم لو طلبه يضر نفسه أو غيره.
- ترد بالعربية المصرية افتراضياً، وبالإنجليزية لو كتب بالإنجليزية.`;

/* ── storage helpers ──────────────────────────────────────────────────────── */

const MEM_KEY = "cybernova_nova_memories";
const TARGET_KEY = "cybernova_nova_target";

type Memo = { id: string; title: string; content: string; tags: string[]; at: number };

function readMemos(): Memo[] {
  try {
    const raw = localStorage.getItem(MEM_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Memo[]) : [];
  } catch {
    return [];
  }
}

function writeMemos(list: Memo[]): void {
  try {
    localStorage.setItem(MEM_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    /* quota — ignore */
  }
}

function saveMemo(title: string, content: string, tags: string[] = []): Memo {
  const memo: Memo = { id: `m-${Date.now()}`, title, content, tags, at: Date.now() };
  writeMemos([...readMemos(), memo]);
  return memo;
}

export function getNovaMemories(): Memo[] {
  return readMemos().slice().reverse();
}

export function getNovaTarget(): string | null {
  try {
    return localStorage.getItem(TARGET_KEY);
  } catch {
    return null;
  }
}

/* ── server detection ─────────────────────────────────────────────────────── */

const LOCAL_API = "http://127.0.0.1:8080/api";

let cachedServer: { base: string; at: number } | null = null;

async function probe(base: string, ms = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${base}/nova-core/status`, { signal: AbortSignal.timeout(ms) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Returns the API base (`/api` or `http://127.0.0.1:8080/api`) or null. */
export async function resolveNovaServer(force = false): Promise<string | null> {
  if (!force && cachedServer && Date.now() - cachedServer.at < 30_000) return cachedServer.base;

  const candidates = ["/api"];
  if (isStandaloneHost()) candidates.push(LOCAL_API);
  for (const base of candidates) {
    if (await probe(base)) {
      cachedServer = { base, at: Date.now() };
      return base;
    }
  }
  cachedServer = null;
  return null;
}

/* ── browser tools (real work, no server) ─────────────────────────────────── */

export const BROWSER_TOOLS = [
  { name: "dns_lookup", title: "استعلام DNS", description: "A / AAAA / MX / TXT / NS عبر DNS-over-HTTPS", risk: "safe" },
  { name: "cve_lookup", title: "بحث CVE", description: "بحث حقيقي في NVD عن ثغرة أو كلمة مفتاحية", risk: "safe" },
  { name: "github_search", title: "بحث GitHub", description: "مستودعات وأدوات مفتوحة المصدر", risk: "safe" },
  { name: "web_check", title: "فحص الوصول", description: "هل الموقع رادّ؟ زمن الاستجابة وحالة الاتصال", risk: "safe" },
  { name: "knowledge_search", title: "فهرس المنصة", description: "بحث في 3,300+ نمط أمني داخل المنصة", risk: "safe" },
  { name: "set_active_target", title: "تحديد الهدف", description: "يحفظ الهدف النشط محلياً", risk: "safe" },
  { name: "memory_save", title: "حفظ في الذاكرة", description: "ملاحظة دائمة في المتصفح", risk: "safe" },
  { name: "memory_list", title: "قراءة الذاكرة", description: "آخر الملاحظات المحفوظة", risk: "safe" },
  { name: "platform_status", title: "حالة المنصة", description: "عدّ الذكريات والنمط والهدف النشط", risk: "safe" },
] as const;

const HOST_RE = /\b((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/i;

export function extractHost(text: string): string | null {
  const direct = text.match(HOST_RE);
  if (direct) return direct[1].toLowerCase();
  const url = text.match(/https?:\/\/([^\s/]+)/i);
  return url ? url[1].toLowerCase() : null;
}

async function dnsLookup(host: string, type = "A"): Promise<{ ok: boolean; summary: string; data: unknown }> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
      { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return { ok: false, summary: `DNS رفض الطلب (${res.status})`, data: null };
    const json = (await res.json()) as { Answer?: Array<{ data: string; type: number; name: string }>; Status?: number };
    const answers = json.Answer ?? [];
    if (!answers.length) return { ok: false, summary: `مفيش سجلات ${type} لـ ${host} (status ${json.Status ?? "?"})`, data: json };
    return {
      ok: true,
      summary: `${host} · ${type}: ${answers.map((a) => a.data).slice(0, 6).join(" · ")}`,
      data: json,
    };
  } catch (err) {
    return { ok: false, summary: `DNS فشل: ${(err as Error).message}`, data: null };
  }
}

async function cveLookup(query: string): Promise<{ ok: boolean; summary: string; data: unknown }> {
  const params = new URLSearchParams({ resultsPerPage: "5" });
  const cveId = query.match(/CVE-\d{4}-\d{4,7}/i)?.[0];
  if (cveId) params.set("cveId", cveId.toUpperCase());
  else params.set("keywordSearch", query);
  try {
    const res = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, summary: `NVD رفض (${res.status})`, data: null };
    const json = (await res.json()) as {
      totalResults?: number;
      vulnerabilities?: Array<{ cve: { id: string; descriptions: Array<{ lang: string; value: string }>; metrics?: Record<string, unknown> } }>;
    };
    const vulns = json.vulnerabilities ?? [];
    if (!vulns.length) return { ok: false, summary: `NVD: مفيش نتائج لـ "${query}"`, data: json };
    const lines = vulns.map((v) => {
      const d = v.cve.descriptions.find((x) => x.lang === "en")?.value ?? "";
      return `${v.cve.id} — ${d.slice(0, 110)}`;
    });
    return {
      ok: true,
      summary: `${json.totalResults ?? vulns.length} نتيجة · ${lines[0] ?? ""}`,
      data: { total: json.totalResults, sample: lines },
    };
  } catch (err) {
    return { ok: false, summary: `NVD غير متاح: ${(err as Error).message}`, data: null };
  }
}

async function githubSearch(query: string): Promise<{ ok: boolean; summary: string; data: unknown }> {
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=5`,
      { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return { ok: false, summary: `GitHub رفض (${res.status} — غالباً حد المعدل)`, data: null };
    const json = (await res.json()) as { total_count?: number; items?: Array<{ full_name: string; stargazers_count: number; description: string | null }> };
    const items = json.items ?? [];
    return {
      ok: items.length > 0,
      summary: items.length
        ? `${json.total_count} مستودع · ${items.map((i) => `${i.full_name} (★${i.stargazers_count})`).slice(0, 4).join(" · ")}`
        : `GitHub: مفيش نتائج لـ "${query}"`,
      data: items.map((i) => ({ repo: i.full_name, stars: i.stargazers_count, about: i.description })),
    };
  } catch (err) {
    return { ok: false, summary: `GitHub غير متاح: ${(err as Error).message}`, data: null };
  }
}

async function webCheck(host: string): Promise<{ ok: boolean; summary: string; data: unknown }> {
  const t0 = performance.now();
  try {
    await fetch(`https://${host}/`, { mode: "no-cors", signal: AbortSignal.timeout(8000) });
    const ms = Math.round(performance.now() - t0);
    return { ok: true, summary: `${host} بيرد (${ms}ms) · لا يمكن قراءة الترويسات من المتصفح بسبب CORS`, data: { reachable: true, ms } };
  } catch (err) {
    return { ok: false, summary: `${host} مش رادّ: ${(err as Error).message}`, data: { reachable: false } };
  }
}

function toolTitle(name: string): string {
  return BROWSER_TOOLS.find((t) => t.name === name)?.title ?? name;
}

async function runBrowserTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; summary: string; data: unknown }> {
  const target = String(args.target ?? extractHost(String(args.query ?? "")) ?? getNovaTarget() ?? "");
  switch (name) {
    case "dns_lookup":
      if (!target) return { ok: false, summary: "محتاج نطاق (مثال: example.com)", data: null };
      return dnsLookup(target, String(args.type ?? "A").toUpperCase());
    case "cve_lookup":
      return cveLookup(String(args.query ?? target));
    case "github_search":
      return githubSearch(String(args.query ?? target ?? "security tools"));
    case "web_check":
      if (!target) return { ok: false, summary: "محتاج نطاق", data: null };
      return webCheck(target);
    case "knowledge_search": {
      const q = String(args.query ?? "");
      const r = searchCyberCorpus2400(q, "all", 5);
      return {
        ok: r.items.length > 0,
        summary: r.items.length
          ? `${r.totalMatched} نمط مطابق · ${r.items.slice(0, 3).map((i) => i.titleAr).join(" · ")}`
          : `مفيش نمط مطابق لـ "${q}"`,
        data: r.items.slice(0, 5),
      };
    }
    case "set_active_target": {
      if (!target) return { ok: false, summary: "محتاج نطاق", data: null };
      try {
        localStorage.setItem(TARGET_KEY, target);
      } catch {
        /* ignore */
      }
      return { ok: true, summary: `الهدف النشط أصبح ${target}`, data: { target } };
    }
    case "memory_save": {
      const memo = saveMemo(String(args.title ?? "ملاحظة"), String(args.content ?? ""), ["nova"]);
      return { ok: true, summary: `اتحفظت: ${memo.title}`, data: memo };
    }
    case "memory_list": {
      const list = getNovaMemories().slice(0, 5);
      return { ok: list.length > 0, summary: list.length ? list.map((m) => m.title).join(" · ") : "الذاكرة فاضية", data: list };
    }
    case "platform_status": {
      const stats = getCorpusStats();
      const memos = readMemos();
      return {
        ok: true,
        summary: `المنصة سليمة · ${memos.length} ذكرى · ${BROWSER_TOOLS.length} أداة · الهدف: ${getNovaTarget() ?? "غير محدد"}`,
        data: { memories: memos.length, target: getNovaTarget(), corpus: stats },
      };
    }
    default:
      return { ok: false, summary: `أداة غير معروفة: ${name}`, data: null };
  }
}

/* ── planner (mirrors the server heuristic router) ────────────────────────── */

type Step = { tool: string; args: Record<string, unknown>; why?: string };

const GREETING = /^(السلام|سلام|أهلا|اهلا|هاي|hi|hello|hey|صباح|مساء|ازيك|إزيك)\b/i;
const WHO = /(انت مين|مين انت|عرف بنفسك|who are you|اسمك)/i;
const CVE = /(cve-\d{4}-\d+|ثغر|فولن|vuln|exploit|إكسبلويت)/i;
const GITHUB = /(github|جيتهاب|ريبو|repo|مستودع|أداة مفتوحة)/i;
const KNOW = /(فهرس|المعرفة|قاعدة المعرفة|knowledge|نمط|pattern)/i;
const MEM_SAVE = /(احفظ|سجل|cاحفظ|remember|احتفظ)/i;
const MEM_LIST = /(ذاكرة|ذكريات|افتكر|memory)/i;
const STATUS = /(حالة المنصة|حالة النظام|status|الوضع ايه)/i;

function planLocal(message: string): { thought: string; steps: Step[]; chitChat: boolean } {
  const host = extractHost(message);

  if (WHO.test(message)) {
    return {
      thought: "سؤال عن الهوية — أعرّف نفسي بصراحة وبشخصيتي، وأوريه اللي أقدر أعمله فعلاً.",
      steps: [],
      chitChat: true,
    };
  }
  if (GREETING.test(message) && !host && !CVE.test(message)) {
    return { thought: "المستخدم بيسلّم — أرد بشكل شخصي وأعرض الإمكانيات.", steps: [], chitChat: true };
  }

  const steps: Step[] = [];
  if (CVE.test(message)) {
    const q = message.match(/CVE-\d{4}-\d+/i)?.[0] ?? message.replace(/[؟?]/g, " ").slice(0, 80);
    steps.push({ tool: "cve_lookup", args: { query: q }, why: "بحث حقيقي في NVD عن الثغرة" });
  }
  if (GITHUB.test(message)) {
    steps.push({ tool: "github_search", args: { query: message.slice(0, 60) }, why: "أدوات مفتوحة المصدر على GitHub" });
  }
  if (KNOW.test(message)) {
    steps.push({ tool: "knowledge_search", args: { query: message.slice(0, 60) }, why: "فهرس المنصة فيه 3,300+ نمط" });
  }
  if (STATUS.test(message)) {
    steps.push({ tool: "platform_status", args: {}, why: "نظرة سريعة على حالة المنصة وذاكرتي" });
  }
  if (MEM_SAVE.test(message) && !steps.length) {
    steps.push({ tool: "memory_save", args: { title: message.slice(0, 48), content: message }, why: "أحفظ طلبك في الذاكرة الدائمة" });
  }
  if (MEM_LIST.test(message) && !steps.length) {
    steps.push({ tool: "memory_list", args: {}, why: "أراجع آخر ما حفظته" });
  }
  if (host && !steps.length) {
    steps.push({ tool: "set_active_target", args: { target: host }, why: "أثبّت الهدف قبل أي خطوة" });
    steps.push({ tool: "dns_lookup", args: { target: host, type: "A" }, why: "أشوف الهدف واصل على أنهي IP" });
    steps.push({ tool: "dns_lookup", args: { target: host, type: "TXT" }, why: "سجلات TXT بتكشف SPF/تحقق النطاق" });
    steps.push({ tool: "web_check", args: { target: host }, why: "أتأكد إن الموقع ردّ فعلاً" });
  }

  if (!steps.length) {
    const q = message.replace(/[؟?]/g, " ").trim().slice(0, 70);
    steps.push({ tool: "knowledge_search", args: { query: q }, why: "أبدأ بفهرس المنصة عشان أشوف لو عندنا نمط قريب" });
  }

  return {
    thought: `فهمت طلبك: "${message.slice(0, 60)}". خطتي: ${steps.map((s) => toolTitle(s.tool)).join(" ← ")}.`,
    steps: steps.slice(0, 4),
    chitChat: false,
  };
}

/* ── streaming helper ─────────────────────────────────────────────────────── */

function splitChunks(text: string, size = 34): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── local (no-server) run ────────────────────────────────────────────────── */

async function runLocal(opts: RunNovaOptions): Promise<void> {
  const started = Date.now();
  const sessionId = opts.sessionId || `nova-local-${Date.now()}`;
  const message = opts.message.trim();
  const plan = planLocal(message);

  // Try the user's own Ollama first (free, private, on their machine).
  let ollamaReply = "";
  const model = getStoredOllamaModel();
  if (model) {
    try {
      ollamaReply = await streamOllamaChat({
        apiBase: getStoredOllamaBase(),
        model,
        messages: [
          { role: "system", content: NOVA_PERSONA_BROWSER },
          ...(opts.history ?? []).slice(-4),
          { role: "user", content: message },
        ],
        onToken: (t) => opts.onEvent({ type: "delta", text: t }),
        signal: opts.signal,
      });
    } catch {
      ollamaReply = "";
    }
  }

  const online = Boolean(ollamaReply);
  opts.onEvent({
    type: "ready",
    sessionId,
    mode: online ? "llm" : "heuristic",
    provider: online ? "ollama" : "nova-builtin",
    model: online ? model : "nova-local",
    tools: BROWSER_TOOLS.length,
    brain: "local",
  });
  opts.onEvent({ type: "thought", text: plan.thought });

  if (plan.chitChat) {
    if (!online) {
      const reply = WHO.test(message)
        ? `أنا **نوفا** — الكيان الذكي جوه CyberNova. مش بوت أوامر، أنا شريكك في الشغل.\n\nأنا شغال دلوقتي **بالمخ المحلي** (من غير سيرفر)، ومعايا ${BROWSER_TOOLS.length} أداة حقيقية بشتغل بيها من المتصفح:\n- استعلام DNS حقيقي (A/AAAA/MX/TXT)\n- بحث ثغرات في **NVD** مباشرة\n- بحث **GitHub** عن أدوات\n- فهرس المنصة (3,300+ نمط)\n- ذاكرة دائمة على جهازك\n\nلو شغّلت **Ollama** عندك هتكلمني بنموذج كامل الشخصية. ولو شغّلت سيرفر المنصة، بيبقى معايا 21 أداة كاملة (TLS، ترويسات، منافذ، تعداد نطاقات…).\n\nقولي هدفك أو اسألني عن CVE وأنا أنفذ قدامك.`
        : `أهلاً بيك 👋 أنا **نوفا**. ابعتلي نطاق أو رقم CVE وأنا أنفّذ قدامك خطوة بخطوة.`;
      for (const chunk of splitChunks(reply)) {
        opts.onEvent({ type: "delta", text: chunk });
        await sleep(10);
      }
    }
    opts.onEvent({ type: "done", sessionId, mode: online ? "llm" : "heuristic", toolCount: 0, ms: Date.now() - started, provider: online ? "ollama" : "nova-builtin" });
    return;
  }

  opts.onEvent({ type: "plan", steps: plan.steps });
  const results: Array<{ name: string; ok: boolean; summary: string }> = [];

  for (const [i, step] of plan.steps.entries()) {
    const id = `${i + 1}-${step.tool}`;
    opts.onEvent({
      type: "tool_call",
      id,
      name: step.tool,
      title: toolTitle(step.tool),
      args: step.args,
      risk: "safe",
    });
    const t0 = Date.now();
    const r = await runBrowserTool(step.tool, step.args);
    opts.onEvent({
      type: "tool_result",
      id,
      name: step.tool,
      ok: r.ok,
      summary: r.summary,
      ms: Date.now() - t0,
      data: r.data,
    });
    results.push({ name: step.tool, ok: r.ok, summary: r.summary });
  }

  if (!online) {
    const lines: string[] = [
      `تمام — نفّذت **${results.length}** أداة (${results.filter((r) => r.ok).length} نجحت). دي القراءة:`,
      "",
      ...results.map((r) => `- ${r.ok ? "✅" : "⚠️"} **${toolTitle(r.name)}:** ${r.summary}`),
      "",
      "**الخطوة التالية المقترحة:** " +
        (results.some((r) => r.name === "dns_lookup")
          ? "نجرّب نفس النطاق على سيرفر المنصة عشان نضيف فحص TLS والترويسات والمنافذ (المتصفح لوحده مش يقدر)."
          : "ابعتلي نطاقاً لاستطلاعه أو CVE للبحث عنه."),
    ];
    for (const chunk of splitChunks(lines.join("\n"))) {
      opts.onEvent({ type: "delta", text: chunk });
      await sleep(10);
    }
  }

  if (results.length) {
    const memo = saveMemo(`تشغيل ${new Date().toLocaleTimeString("ar-EG")}`, results.map((r) => `${r.name}: ${r.summary}`).join("\n"), ["run"]);
    opts.onEvent({ type: "memory", id: memo.id, title: memo.title });
  }

  opts.onEvent({
    type: "done",
    sessionId,
    mode: online ? "llm" : "heuristic",
    toolCount: results.length,
    ms: Date.now() - started,
    provider: online ? "ollama" : "nova-builtin",
  });
}

/* ── server run (SSE) ─────────────────────────────────────────────────────── */

async function runServer(base: string, opts: RunNovaOptions): Promise<void> {
  const res = await fetch(`${base}/nova-core/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: opts.message,
      sessionId: opts.sessionId,
      history: (opts.history ?? []).slice(-8),
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`agent HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawEvent = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const ev = JSON.parse(dataLine.slice(5).trim()) as NovaEvent;
        sawEvent = true;
        opts.onEvent(ev);
      } catch {
        /* ping / partial */
      }
    }
  }
  if (!sawEvent) throw new Error("agent stream empty");
}

/* ── public entry ─────────────────────────────────────────────────────────── */

/**
 * Runs NOVA. Prefers the full server brain; silently degrades to the local
 * brain (real DNS/NVD/GitHub + optional Ollama) when no API is reachable.
 */
export async function runNova(opts: RunNovaOptions): Promise<{ brain: "server" | "local" }> {
  const base = await resolveNovaServer();
  if (base) {
    try {
      await runServer(base, opts);
      return { brain: "server" };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      // Server died mid-request → tell the user, then fall back to local.
      opts.onEvent({ type: "thought", text: `السيرفر ماردّش (${(err as Error).message}) — أنا كملت بالمخ المحلي.` });
    }
  }
  await runLocal(opts);
  return { brain: "local" };
}

export async function getNovaStatus(): Promise<{
  brain: "server" | "local";
  mode: string;
  model: string;
  tools: number;
  note: string;
}> {
  const base = await resolveNovaServer(true);
  if (base) {
    try {
      const res = await fetch(`${base}/nova-core/status`, { signal: AbortSignal.timeout(3000) });
      const json = (await res.json()) as {
        brain?: { mode?: string; ollamaModel?: string | null; note?: string };
        tools?: number;
      };
      return {
        brain: "server",
        mode: json.brain?.mode ?? "unknown",
        model: json.brain?.ollamaModel ?? "—",
        tools: json.tools ?? 0,
        note: json.brain?.note ?? "السيرفر متصل.",
      };
    } catch {
      /* fall through */
    }
  }
  const model = getStoredOllamaModel();
  return {
    brain: "local",
    mode: model ? "llm" : "builtin",
    model: model || "nova-local",
    tools: BROWSER_TOOLS.length,
    note: model
      ? "المخ المحلي مربوط بـ Ollama."
      : "المخ المحلي شغال بدون سيرفر — أدوات المتصفح الحقيقية جاهزة.",
  };
}
