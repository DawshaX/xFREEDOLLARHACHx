/**
 * The system bus — one snapshot of every organ, gathered from real sources.
 * ─────────────────────────────────────────────────────────────────────────
 * The platform had the pieces but no single place that knew about all of them:
 * the corpus loader, the hunt report, the Actions runs, the awareness map and the
 * page registry each lived on their own. This file is the wiring: every organ is
 * asked for its state, the answers carry timestamps, and anything that cannot be
 * measured is marked `unknown` (never `ok`).
 *
 * Consumers: the chat (so the assistant reasons over measured data instead of
 * vibes) and the fleet page (one strip that shows the whole body).
 */
import { loadCorpusLive, corpusSnapshot, type CorpusLive } from "./corpus-live";
import { fetchHunt, fetchLiveRuns, type HuntReport, type WorkflowRun } from "./live-body";
import { backendHealth, backendHunt } from "./backend";

export type OrganStatus = "live" | "partial" | "unknown" | "down";

export interface Organ {
  id: string;
  labelAr: string;
  status: OrganStatus;
  detail: string;
  /** where the number came from — a URL, a file, or a workflow */
  source: string;
  at?: string | null;
}

export interface SystemSnapshot {
  at: string;
  organs: Organ[];
  corpus: CorpusLive;
  hunt: HuntReport | null;
  runs: WorkflowRun[];
  runsError?: string;
  /** one sentence the brain can say out loud */
  saysAr: string;
}

const PAGES: Array<{ path: string; label: string }> = [
  { path: "/nova-fleet", label: "المخ والمدير" },
  { path: "/chat", label: "المحادثة" },
  { path: "/vuln-center", label: "مركز الثغرات" },
  { path: "/bug-bounty-studio", label: "استوديو الباونتي" },
  { path: "/agent", label: "الوكيل" },
  { path: "/reports", label: "التقارير" },
  { path: "/scanner", label: "الماسح" },
];

let snapshot: SystemSnapshot | null = null;
const listeners = new Set<(s: SystemSnapshot) => void>();

function organ(id: string, labelAr: string, status: OrganStatus, detail: string, source: string, at?: string | null): Organ {
  return { id, labelAr, status, detail, source, at: at ?? null };
}

export function buildOrgans(
  corpus: CorpusLive,
  hunt: HuntReport | null,
  runs: WorkflowRun[],
  runsError?: string,
  backend?: { ok: boolean; at?: string; cves?: number; findings?: number; error?: string },
): Organ[] {
  const out: Organ[] = [];

  out.push(
    organ(
      "corpus",
      "كوربوس الثغرات (NVD+KEV+EPSS)",
      corpus.measured ? "live" : "unknown",
      corpus.measured
        ? `${corpus.total.toLocaleString("en-US")} CVE · KEV ${corpus.kev} · ${corpus.products} منتج`
        : "مفيش كوربوس متنزّل — مفيش أرقام",
      "state/vuln-corpus-live.json",
      corpus.at,
    ),
  );

  const running = runs.filter((r) => r.status !== "completed");
  out.push(
    organ(
      "executor",
      "محرك التنفيذ (GitHub Actions)",
      runsError ? "unknown" : running.length ? "live" : "live",
      runsError
        ? `القياس فشل: ${runsError}`
        : running.length
          ? `${running.length} workflow شغّال دلوقتي: ${running.map((r) => r.name).join(" · ")}`
          : `مفيش workflow شغّال · آخر حالة: ${runs[0] ? `${runs[0].name} ${runs[0].conclusion ?? runs[0].status}` : "—"}`,
      "api.github.com/actions/runs",
      runs[0]?.updatedAt,
    ),
  );

  out.push(
    organ(
      "hunt",
      "الصيد الحقيقي",
      hunt ? (hunt.totals.findings > 0 ? "live" : "partial") : "unknown",
      hunt
        ? `${hunt.totals.findings} مطابقة · ${hunt.totals.rated} high/critical · ${hunt.totals.targets} هدف`
        : "لسه مفيش نتيجة منشورة من الـworkflow",
      "state/hunt-latest.json",
      hunt?.at,
    ),
  );

  const tools = hunt?.tools ?? {};
  const present = Object.values(tools).filter((v) => v === "present").length;
  out.push(
    organ(
      "tools",
      "الأدوات (nuclei/httpx/katana/nmap)",
      hunt ? (present === Object.keys(tools).length ? "live" : "partial") : "unknown",
      hunt ? `${present}/${Object.keys(tools).length} أداة موجودة على المنفّذ` : "لسه ماتقاستش",
      "hunt-latest.json → tools",
      hunt?.at,
    ),
  );

  out.push(
    organ(
      "chat",
      "الشات (مقاعد مجانية)",
      "live",
      "3 مقاعد بلا مفتاح + Ollama لو موجود · البث حي في المتصفح",
      "lib/llm-browser.ts",
      new Date().toISOString(),
    ),
  );

  out.push(
    organ(
      "pages",
      "الواجهة",
      "live",
      `${PAGES.length} صفحة مربوطة بالناقل ده`,
      "lib/system-bus.ts",
      new Date().toISOString(),
    ),
  );

  out.push(
    organ(
      "engine",
      "الباك إند (Supabase Edge + Postgres)",
      backend?.ok ? "live" : "unknown",
      backend?.ok
        ? `مستجيب · ${backend.cves ?? 0} CVE في القاعدة · ${backend.findings ?? 0} مطابقة متخزّنة`
        : `مش مقاس: ${backend?.error ?? "لسه ماتنادى"} — الواجهة بتقرأ من الملفات الثابتة`,
      "supabase/functions/ops-api",
      backend?.at,
    ),
  );

  return out;
}

export async function refreshSystem(force = false): Promise<SystemSnapshot> {
  if (!force && snapshot && Date.now() - Date.parse(snapshot.at) < 15_000) return snapshot;
  const [, hunt, runs, health] = await Promise.all([
    loadCorpusLive(force),
    fetchHunt(),
    fetchLiveRuns(8),
    backendHealth(),
  ]);
  const corpus = corpusSnapshot();
  const organs = buildOrgans(corpus, hunt, runs.runs, runs.ok ? undefined : runs.error, {
    ok: health.ok,
    at: health.ok ? health.data.at : undefined,
    cves: health.ok ? health.data.counts.cves : undefined,
    findings: health.ok ? health.data.counts.findings : undefined,
    error: health.ok ? undefined : health.error,
  });
  const live = organs.filter((o) => o.status === "live").length;
  const unknown = organs.filter((o) => o.status === "unknown").length;
  snapshot = {
    at: new Date().toISOString(),
    organs,
    corpus,
    hunt,
    runs: runs.runs,
    runsError: runs.ok ? undefined : runs.error,
    saysAr: `${live} عضو حي · ${unknown} غير مقاس · ${corpus.measured ? `${corpus.total} CVE` : "كوربوس غير مقاس"}${
      hunt ? ` · آخر صيد ${hunt.totals.findings} مطابقة` : ""
    }`,
  };
  for (const fn of listeners) fn(snapshot);
  return snapshot;
}

export function systemSnapshot(): SystemSnapshot | null {
  return snapshot;
}

export function onSystemChange(fn: (s: SystemSnapshot) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The backend's stored hunt (Postgres), used when the static file is stale. */
export async function backendHuntSummary() {
  const res = await backendHunt();
  if (!res.ok || !res.data.run) return null;
  return { at: res.data.run.at, findings: res.data.findings.length, verified: res.data.findings.filter((f) => f.verified).length };
}

export function knownPages(): Array<{ path: string; label: string }> {
  return PAGES;
}
