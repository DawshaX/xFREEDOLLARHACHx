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

/** Tools this brain can really run without a server. */
const LOCAL_TOOLS = new Set(["memory_search", "knowledge_search", "cve_lookup", "corpus_stats", "platform_status", "memory_list", "mission_status"]);
/** Tools that exist but need the server (reported honestly, never faked). */
const SERVER_ONLY = new Set(["recon_target", "dns_lookup", "tls_audit", "http_headers_audit", "port_scan", "subdomain_enum", "web_fetch", "github_search", "exploit_search", "fleet_list", "fleet_profile", "fleet_exec", "device_control_map", "report_generate"]);

const TITLES: Record<string, string> = {
  memory_search: "بحث في الذاكرة",
  memory_list: "قراءة الذاكرة",
  knowledge_search: "بحث في فهرس المعرفة",
  cve_lookup: "بحث ثغرة في الفهرس المحلي",
  corpus_stats: "إحصاءات الفهرس",
  platform_status: "حالة المنصة",
  mission_status: "حالة المهمة",
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

  if (cveId) steps.push({ tool: "cve_lookup", title: TITLES.cve_lookup, args: { cveId } });
  if (wantsMemory) steps.push({ tool: "memory_search", title: TITLES.memory_search, args: { query: msg.slice(0, 80) } });
  if (wantsKnowledge && !cveId) steps.push({ tool: "knowledge_search", title: TITLES.knowledge_search, args: { query: msg.slice(0, 80) } });
  if (wantsStats) steps.push({ tool: "corpus_stats", title: TITLES.corpus_stats, args: {} });
  if (wantsScan) {
    steps.push(
      target
        ? { tool: "recon_target", title: TITLES.recon_target, args: { target } }
        : { tool: "platform_status", title: TITLES.platform_status, args: {} },
    );
  }
  if (steps.length === 0) {
    steps.push({ tool: "knowledge_search", title: TITLES.knowledge_search, args: { query: msg.slice(0, 80) } });
    if (target) steps.push({ tool: "recon_target", title: TITLES.recon_target, args: { target } });
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

function runLocalTool(step: Step): ToolOutcome {
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
    const outcome = runLocalTool(step);
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
  lines.push("### 🔌 ناقص إيه عشان يبقى تنفيذ كامل");
  lines.push(
    "- ده وضع المتصفح: مفيش سيرفر ولا أجهزة. اربط سيرفرك من صفحة **نوفا · الأسطول الموحّد → محطة العمل** وخلي العقل «سيرفر»، وساعتها الفحص الحقيقي والأسطول والأوامر تشتغل.",
  );

  const reply = lines.join("\n");
  for (const chunk of chunks(reply)) {
    emit({ type: "delta", text: chunk });
    await new Promise((r) => setTimeout(r, 6));
  }
  emit({ type: "done", sessionId, mode: "builtin", toolCount: results.length, ms: Date.now() - started, provider: "browser-engine" });

  return { reply, toolsUsed: results.map((r) => r.name), mode: "builtin" };
}

export const LOCAL_BRAIN_TOOL_COUNT = LOCAL_TOOLS.size;
