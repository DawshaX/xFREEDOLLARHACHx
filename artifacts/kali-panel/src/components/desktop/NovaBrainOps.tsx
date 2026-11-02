/**
 * NovaBrainOps — وعي الكيان + غرفة العمليات
 * ─────────────────────────────────────────
 * `/nova-fleet` is advertised as the brain and the manager of the whole program.
 * For that to be a sentence about software and not about a slogan, the page has
 * to (a) know what the organism is doing right now, and (b) let you command it.
 *
 *  • `NovaAwarenessCard` reads ONE endpoint — the server's
 *    `/api/nova-core/awareness`, or an honest browser-side fallback on Pages —
 *    and renders the verdict (alive / degraded / blind / asleep / headless), the
 *    organ by organ state with the fix for each fault, the public sites it knows
 *    it lives on, and its vitals. Anything that was not measured is labelled
 *    «معلومة ناقصة», never green.
 *
 *  • `NovaOpsRoom` is the command half, bound to the engine's real contract:
 *    `GET /ops/programs` (the authorization registry), `POST /ops/programs/discover`,
 *    `POST /ops/programs/check` (why a target is allowed or refused — verbatim),
 *    `POST /ops/jobs` (depth passive|standard|deep), `GET /ops/jobs[/:id]`,
 *    `POST /ops/jobs/:id/verify|pause|resume|cancel`, `GET /ops/jobs/:id/report`,
 *    `GET|POST /ops/sweep`. Nothing here decides what may be touched: the scope
 *    gate on the server does, and its refusal text is shown as it was written.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Check,
  Download,
  Loader2,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { fetchAwareness, type AwarenessView, type OrganState } from "@/lib/awareness";
import { getOpsToken, hasToken, opsFetch, opsText, setOpsToken } from "@/lib/ops-client";

const STATE_UI: Record<OrganState, { dot: string; label: string }> = {
  up: { dot: "bg-emerald-400", label: "شغال" },
  partial: { dot: "bg-amber-400", label: "جزئي" },
  down: { dot: "bg-red-500", label: "واقع" },
  unknown: { dot: "bg-white/25", label: "معلومة ناقصة" },
};

const VERDICT_UI: Record<AwarenessView["verdict"], { ring: string; text: string; title: string }> = {
  alive: { ring: "border-emerald-400/40 bg-emerald-400/5", text: "text-emerald-300", title: "الكيان حيّ" },
  degraded: { ring: "border-amber-400/40 bg-amber-400/5", text: "text-amber-300", title: "حيّران — فيه عضو واقع" },
  blind: { ring: "border-red-500/40 bg-red-500/5", text: "text-red-300", title: "أعمى — مفيش إنترنت" },
  asleep: { ring: "border-red-500/40 bg-red-500/5", text: "text-red-300", title: "نائم — مفيش عقل ولا نود ولا تصريح" },
  headless: { ring: "border-fuchsia-400/40 bg-fuchsia-400/5", text: "text-fuchsia-300", title: "راس من غير جسم (وضع المتصفح)" },
};

export function NovaAwarenessCard() {
  const [view, setView] = useState<AwarenessView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force = false) => {
    setBusy(true);
    try {
      setView(await fetchAwareness(force));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(true), 6000);
    return () => clearInterval(t);
  }, [load]);

  const v = VERDICT_UI[view?.verdict ?? "headless"];
  const counters = (view?.counters ?? {}) as Record<string, unknown>;

  return (
    <div dir="rtl" className={`rounded-xl border p-3 space-y-2.5 ${v.ring}`}>
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-fuchsia-400/10 border border-fuchsia-400/40 flex items-center justify-center">
            <BrainCircuit className={`h-4 w-4 text-fuchsia-300 ${busy ? "animate-pulse" : ""}`} />
          </div>
          <div>
            <h2 className="text-[13px] font-black flex items-center gap-2">
              المخ · المدير — حالة الكيان
              <span className={`text-[9px] px-1.5 py-0.5 rounded border border-white/15 ${v.text}`}>{v.title}</span>
            </h2>
            <p className="text-[9px] text-white/45">
              قياس حقيقي من{" "}
              <b className="text-white/70">
                {view?.source === "server" ? "المحرك (16 مصدر)" : "المتصفح (Pages — من غير سيرفر)"}
              </b>
              {" · "}
              {view ? new Date(view.at).toLocaleTimeString("ar-EG") : "…"}
            </p>
          </div>
        </div>
        <button
          onClick={() => void load(true)}
          className="flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-lg border border-white/15 hover:border-cyan-400/40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} قياس دلوقتي
        </button>
      </div>

      {/* what it says about itself — its own words, not our labels */}
      <p className="text-[11px] leading-relaxed text-white/80 whitespace-pre-wrap">“{view?.moodAr ?? "بقرأ الحالة…"}”</p>

      {view?.error && <p className="text-[10px] text-red-300/90">⚠️ {view.error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
        {(view?.organs ?? []).map((o) => (
          <div key={o.id} className="rounded-lg border border-white/10 bg-black/25 p-2 space-y-1">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${STATE_UI[o.state].dot}`} />
              <span className="text-[10px] font-black">{o.label}</span>
              <span className="text-[8px] font-mono text-white/35">{STATE_UI[o.state].label}</span>
            </div>
            <p className="text-[9.5px] text-white/60 leading-snug">{o.says}</p>
            {o.fixAr && o.state !== "up" && <p className="text-[9px] text-amber-200/85 leading-snug">الحل: {o.fixAr}</p>}
          </div>
        ))}
      </div>

      {/* its own addresses — «واعي بمواقعوا» */}
      <div className="flex flex-wrap gap-1.5">
        {(view?.sites ?? []).map((s) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className={`text-[9px] font-mono px-1.5 py-1 rounded-lg border ${
              s.ok ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-200" : "border-red-500/25 bg-red-500/5 text-red-200"
            }`}
            title={s.note}
          >
            {s.ok ? "●" : "○"} {s.label} · {s.status ?? "—"}
            {s.ms != null ? ` ${s.ms}ms` : ""}
          </a>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-mono text-white/45">
        {Object.entries(counters)
          .filter(([, val]) => val !== null && val !== undefined && typeof val !== "object")
          .map(([k, val]) => (
            <span key={k}>
              {k} <b className="text-white/80">{String(val)}</b>
            </span>
          ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────── غرفة العمليات ─────────────── */

interface ProgramRow {
  id: string;
  name?: string;
  platform?: string;
  enabled?: boolean;
  passive_only?: boolean;
  hosts?: string[];
  exact?: string[];
  out_of_scope?: string[];
  policy_url?: string;
  notes_ar?: string;
}
interface TaskRow {
  id: string;
  kind: string;
  status?: string;
  attempts?: number;
  summary?: string;
  error?: string;
  findings?: number;
  ms?: number | null;
  evidence?: string[];
}
interface FindingRow {
  id: string;
  kind?: string;
  title?: string;
  titleAr?: string;
  severity?: string;
  confidence?: number;
  target?: string;
  verified?: boolean;
  verification?: { at?: string; method?: string; detail?: string };
}
interface JobRow {
  id: string;
  name?: string;
  target?: string;
  status?: string;
  createdAt?: string;
  programId?: string | null;
  stats?: { done?: number; failed?: number; skipped?: number; findings?: number; verified?: number; ms?: number };
}
interface JobDetail extends JobRow {
  host?: string;
  scheme?: string;
  objective?: string;
  tasks?: TaskRow[];
  findings?: FindingRow[];
  log?: Array<{ at?: string; line?: string }>;
}
interface Decision {
  ok?: boolean;
  host?: string;
  reason?: string;
  reasonCode?: string;
  program?: { id?: string; name?: string };
  limits?: { rps?: number; concurrency?: number; active?: boolean };
}

const fmt = (ms?: number | null) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const SEV: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-300",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  medium: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  low: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  info: "border-white/15 bg-white/5 text-white/60",
};
const STATUS_COLOR: Record<string, string> = {
  done: "text-emerald-300",
  running: "text-cyan-300",
  queued: "text-white/50",
  pending: "text-white/50",
  paused: "text-amber-300",
  failed: "text-red-300",
  cancelled: "text-white/40",
  skipped: "text-white/40",
};

export function NovaOpsRoom() {
  const [token, setToken] = useState(() => getOpsToken());
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobId, setJobId] = useState("");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState("");
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [sweep, setSweep] = useState<string>("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [hosts, setHosts] = useState<Array<Record<string, unknown>> | null>(null);
  const [hostNote, setHostNote] = useState("");
  const [status, setStatus] = useState("بقرأ السجل…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ target: "", depth: "passive", name: "" });

  const load = useCallback(async () => {
    const [p, j, k, sw, cat] = await Promise.all([
      opsFetch<{ programs?: ProgramRow[]; count?: number }>("/ops/programs"),
      opsFetch<{ jobs?: JobRow[] }>("/ops/jobs"),
      opsFetch<{
        kinds?: Array<{ id: string; titleAr?: string; active?: boolean; binary?: string | null; present?: boolean }>;
        total?: number;
        tools?: Array<{ bin: string; present: boolean }>;
      }>("/ops/kinds"),
      opsFetch<{ level?: string; nextRunAr?: string; policy?: string; programs?: number }>("/ops/sweep"),
      opsFetch<{ hosts?: Array<Record<string, unknown>>; counts?: Record<string, number>; measured_rule?: string; note?: string }>(
        "/fleet/catalogue?probe=1",
      ),
    ]);
    if (p.offline) {
      setStatus("مفيش محرك متصل — السجل والمهمات بيتقاسوا من السيرفر بس.");
      setError(p.denial ?? "");
      return;
    }
    setHosts(cat.ok ? (cat.data?.hosts ?? []) : null);
    setHostNote(String(cat.data?.measured_rule ?? cat.data?.note ?? ""));
    setPrograms(p.data?.programs ?? []);
    setJobs(j.data?.jobs ?? []);
    setKinds((k.data?.kinds ?? []).map((x) => (x.present || !x.binary ? x.id : `${x.id}✗`)));
    setSweep(
      sw.ok && sw.data
        ? `عمق الخلفية: ${sw.data.level ?? "?"} · ${sw.data.programs ?? 0} برنامج · ${sw.data.policy ?? ""}`
        : "",
    );
    setError(p.ok ? "" : (p.denial ?? "قراءة السجل اترفضت"));
    const ready = (k.data?.tools ?? []).filter((x) => x.present).length;
    setStatus(
      `سجل: ${p.data?.programs?.length ?? 0} برنامج · مهمات: ${j.data?.jobs?.length ?? 0} · ` +
        `أنواع مهام: ${k.data?.total ?? k.data?.kinds?.length ?? 0} · أدوات منصوبة على الـhub: ${ready}`,
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openJob = useCallback(async (id: string) => {
    setJobId(id);
    const d = await opsFetch<{ job?: JobDetail; live?: { running?: boolean } }>(`/ops/jobs/${encodeURIComponent(id)}`);
    setDetail(d.ok ? (d.data?.job ?? null) : null);
    setRunning(Boolean(d.data?.live?.running));
    const r = await opsText(`/ops/jobs/${encodeURIComponent(id)}/report${includeUnverified ? "?includeUnverified=1" : ""}`);
    setReport(r.ok ? r.text : `⚠️ ${r.error ?? `HTTP ${r.status}`}`);
  }, [includeUnverified]);

  // while a job is live, keep reading it — the pump ticks every 3 s
  useEffect(() => {
    if (!jobId || !running) return;
    const t = setInterval(() => void openJob(jobId), 3500);
    return () => clearInterval(t);
  }, [jobId, running, openJob]);

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await fn();
    } finally {
      setBusy("");
    }
  }, []);

  const unverified = useMemo(() => (detail?.findings ?? []).filter((f) => !f.verified).length, [detail]);

  return (
    <div dir="rtl" className="rounded-xl border border-cyan-500/20 bg-black/25 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-cyan-300" />
          <div>
            <h2 className="text-[13px] font-black">غرفة العمليات — التصريح والمهمات الحقيقية</h2>
            <p className="text-[9px] text-white/45">{status || "…"} · قرار النطاق بيتاخد في السيرفر، ورفضه بيتعرض كما هو.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onBlur={() => {
              setOpsToken(token);
              void load();
            }}
            placeholder={hasToken() ? "التوكن محفوظ ✓" : "x-nova-token (لو السيرفر بيطلبه)"}
            type="password"
            className="w-44 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[9.5px] font-mono"
          />
          <button
            onClick={() => void run("load", load)}
            className="flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-lg border border-white/15 hover:border-cyan-400/40"
          >
            {busy === "load" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} تحديث
          </button>
          <button
            onClick={() =>
              void run("sweep", async () => {
                const r = await opsFetch<{
                  ran?: boolean;
                  level?: string;
                  reason?: string;
                  started?: unknown[];
                  denied?: Array<{ host?: string; reason?: string; reasonCode?: string }>;
                  summary_ar?: string;
                }>("/ops/sweep", { method: "POST", body: { force: true } });
                if (!r.ok) {
                  setError(r.denial ?? "المسح اترفض");
                  return;
                }
                const d = r.data ?? {};
                const den = (d.denied ?? []).map((x) => `${x.host ?? "?"}: ${x.reasonCode ?? x.reason ?? "?"}`).slice(0, 4);
                setSweep(`جولة ${d.level ?? "passive"} · ${d.summary_ar ?? d.reason ?? ""}${den.length ? ` · مرفوض: ${den.join(" | ")}` : ""}`);
                void load();
              })
            }
            className="flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-lg border border-amber-400/30 bg-amber-400/5 hover:bg-amber-400/10"
          >
            {busy === "sweep" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} جولة الخلفية الآن
          </button>
        </div>
      </div>

      {error && <p className="text-[10px] text-red-300/90">⚠️ {error}</p>}
      {sweep && <p className="text-[9.5px] text-white/55">🧹 {sweep}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-2">
        {/* the authorization registry */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-black text-white/70 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" /> سجل التصريح ({programs.length})
          </div>
          {programs.length === 0 && (
            <p className="text-[9.5px] text-white/45 leading-relaxed">
              السجل فاضي — وده الوضع الآمن الافتراضي: أي فحص نشط هيرفض. «اكتشف النطاق» بيقرأ robots.txt + security.txt بتاعك ويقترح نطاق آمن (سلبي
              دايمًا لحد ما تضيفه أنت).
            </p>
          )}
          <div className="space-y-1 max-h-56 overflow-auto">
            {programs.map((p) => (
              <button
                key={p.id}
                onClick={() => setForm((f) => ({ ...f, target: (p.exact ?? [])[0] ?? (p.hosts ?? [])[0]?.replace(/^\*\./, "") ?? f.target, name: `${p.id} · تغطية` }))}
                className={`w-full text-right rounded-lg border p-1.5 ${
                  p.enabled === false ? "border-white/10 bg-white/[0.01] opacity-60" : "border-white/10 bg-white/[0.02] hover:border-emerald-400/40"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[9.5px] font-black font-mono truncate">{p.name ?? p.id}</span>
                  {p.passive_only && <span className="text-[8px] text-amber-300/80">سلبي فقط</span>}
                  {p.enabled === false && <span className="text-[8px] text-white/40">معطّل</span>}
                  <span className="text-[8px] font-mono text-white/35 mr-auto">{p.platform ?? "custom"}</span>
                </div>
                <p className="text-[8.5px] text-white/45 font-mono truncate">
                  {[...(p.hosts ?? []), ...(p.exact ?? [])].slice(0, 3).join(" · ") || "—"}
                  {(p.out_of_scope ?? []).length ? ` · ممنوع ${p.out_of_scope!.length}` : ""}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* plan + start */}
        <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.02] p-2">
          <div className="text-[10px] font-black text-white/70 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-cyan-300" /> إيه اللي هيتعمل
          </div>
          <input
            value={form.target}
            onChange={(e) => setForm((f) => ({ ...f, target: e.target.value.trim() }))}
            placeholder="النطاق (يتقارن بسجل التصريح في السيرفر)"
            className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[9.5px] font-mono"
          />
          <select
            value={form.depth}
            onChange={(e) => setForm((f) => ({ ...f, depth: e.target.value }))}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-1.5 py-1 text-[9.5px]"
          >
            <option value="passive">سلبي — DNS + Certspotter + NVD (مفيش ضربة على الهدف)</option>
            <option value="standard">قياسي — + headers/TLS/security.txt</option>
            <option value="deep">عميق — + منافذ + مسارات JWT (محتاج أداة/عقدة)</option>
          </select>
          <div className="flex gap-1.5">
            <button
              disabled={!form.target || busy === "job"}
              onClick={() =>
                void run("job", async () => {
                  const r = await opsFetch<{ job?: JobDetail; started?: boolean; denial?: string; error?: string; hint?: string }>("/ops/jobs", {
                    method: "POST",
                    body: {
                      target: form.target,
                      depth: form.depth,
                      name: form.name || `تغطية ${form.target}`,
                      objective: `تغطية ${form.depth} لـ${form.target} من لوحة NOVA`,
                      tools: true,
                    },
                  });
                  if (r.ok && r.data?.job) {
                    setStatus(`المهمة ${r.data.job.id} ${r.data.started ? "بدأت فعلًا" : "في الطابور"}`);
                    await load();
                    await openJob(String(r.data.job.id));
                  } else {
                    const d = r.data as { denial?: string; error?: string; hint?: string } | undefined;
                    setError(d?.denial ?? r.denial ?? d?.error ?? "المهمة اترفضت");
                    setSweep(d?.hint ? `💡 ${d.hint}` : "");
                  }
                })
              }
              className="flex-1 flex items-center justify-center gap-1 text-[10px] font-black px-2 py-1.5 rounded-lg border border-cyan-400/40 bg-cyan-400/10 hover:bg-cyan-400/20 disabled:opacity-40"
            >
              {busy === "job" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} ابدأ مهمة حقيقية
            </button>
            <button
              disabled={!form.target || busy === "check"}
              onClick={() =>
                void run("check", async () => {
                  const r = await opsFetch<Decision>("/ops/programs/check", { method: "POST", body: { target: form.target, active: form.depth !== "passive" } });
                  setDecision(r.data ?? null);
                  if (!r.ok) setError(r.denial ?? "مافيش قرار");
                })
              }
              className="flex items-center gap-1 text-[9px] font-black px-2 py-1.5 rounded-lg border border-white/15 hover:border-amber-400/40 disabled:opacity-40"
            >
              {busy === "check" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldAlert className="h-3 w-3" />} ليه مسموح/مرفوض؟
            </button>
          </div>
          <button
            disabled={!form.target || busy === "discover"}
            onClick={() =>
              void run("discover", async () => {
                const r = await opsFetch<{ ok?: boolean; host?: string; registered?: boolean; proposal?: ProgramRow; error?: string }>(
                  "/ops/programs/discover",
                  { method: "POST", body: { target: form.target, register: false } },
                );
                if (r.ok) {
                  const d = r.data ?? {};
                  setStatus(
                    `اكتشفت ${d.host ?? form.target}: ${d.registered ? "اتسجّل في السجل" : "مقترح جاهز (مسجّلش)"} — نطاق ${
                      (d.proposal?.hosts ?? []).length
                    }+${(d.proposal?.exact ?? []).length} وممنوع ${(d.proposal?.out_of_scope ?? []).length}`,
                  );
                  await load();
                } else setError(r.denial ?? r.data?.error ?? "الاكتشاف فشل");
              })
            }
            className="w-full flex items-center justify-center gap-1 text-[9px] font-black px-2 py-1 rounded-lg border border-emerald-400/30 bg-emerald-400/5 hover:bg-emerald-400/10 disabled:opacity-40"
          >
            {busy === "discover" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} اكتشف نطاق الهدف (مقترح آمن)
          </button>
          {decision && (
            <div className="rounded-lg border border-white/10 bg-black/30 p-1.5 text-[8.5px] font-mono leading-relaxed">
              <div className={decision.ok ? "text-emerald-300" : "text-red-300"}>
                {decision.ok ? "مسموح" : "مرفوض"} · <b>{decision.reasonCode}</b> · {decision.host}
              </div>
              <p className="text-white/55 whitespace-pre-wrap">{decision.reason}</p>
              <p className="text-white/35">
                {decision.program?.id ? `برنامج: ${decision.program.id} · ` : ""}rps {decision.limits?.rps ?? "—"} · التزامن{" "}
                {decision.limits?.concurrency ?? "—"} · نشط: {decision.limits?.active ? "أيوه" : "لأ"}
              </p>
            </div>
          )}
          {kinds.length > 0 && (
            <p className="text-[8px] font-mono text-white/30 truncate" title="✗ = نوع محتاج أداة مش منصوبة على السيرفر">
              أنواع المهام (✗ = محتاجة أداة): {kinds.join(" · ")}
            </p>
          )}
        </div>

        {/* jobs */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-black text-white/70">المهمات ({jobs.length})</div>
          <div className="space-y-1 max-h-64 overflow-auto">
            {jobs.map((j) => (
              <button
                key={j.id}
                onClick={() => void openJob(j.id)}
                className={`w-full text-right rounded-lg border p-1.5 ${
                  jobId === j.id ? "border-cyan-400/40 bg-cyan-400/5" : "border-white/10 bg-white/[0.02] hover:border-white/25"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-black truncate">{j.name ?? j.id}</span>
                  <span className={`text-[8px] font-mono ${STATUS_COLOR[String(j.status)] ?? "text-white/45"}`}>{j.status}</span>
                </div>
                <p className="text-[8.5px] font-mono text-white/45 truncate">
                  {j.target} · {j.stats?.done ?? 0}done/{j.stats?.failed ?? 0}fail · findings {j.stats?.findings ?? 0} · موثّق {j.stats?.verified ?? 0} ·{" "}
                  {fmt(j.stats?.ms)}
                </p>
              </button>
            ))}
            {jobs.length === 0 && <p className="text-[9.5px] text-white/40">مفيش مهمات — ابدأ واحدة أو استنى جولة الخلفية.</p>}
          </div>
        </div>
      </div>

      {/* what the selected job is doing */}
      {jobId && detail && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-white/70">
                مهام {detail.id.slice(0, 8)}{" "}
                <span className={running ? "text-cyan-300" : "text-white/40"}>{running ? "● شغالة" : "○ متوقفة"}</span>
              </span>
              <span className="flex items-center gap-1">
                {detail.status === "paused" ? (
                  <button
                    onClick={() =>
                      void run("resume", async () => {
                        await opsFetch(`/ops/jobs/${encodeURIComponent(detail.id)}/resume`, { method: "POST", body: {} });
                        await openJob(detail.id);
                      })
                    }
                    className="text-[8.5px] font-mono text-emerald-300/80 flex items-center gap-0.5 hover:text-emerald-200"
                  >
                    <Play className="h-3 w-3" /> كمّل
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      void run("pause", async () => {
                        await opsFetch(`/ops/jobs/${encodeURIComponent(detail.id)}/pause`, { method: "POST", body: {} });
                        await openJob(detail.id);
                      })
                    }
                    className="text-[8.5px] font-mono text-amber-300/80 flex items-center gap-0.5 hover:text-amber-200"
                  >
                    <Pause className="h-3 w-3" /> وقّف
                  </button>
                )}
                <button
                  onClick={() =>
                    void run("cancel", async () => {
                      await opsFetch(`/ops/jobs/${encodeURIComponent(detail.id)}/cancel`, { method: "POST", body: {} });
                      await openJob(detail.id);
                    })
                  }
                  className="text-[8.5px] font-mono text-red-300/80 flex items-center gap-0.5 hover:text-red-200"
                >
                  <X className="h-3 w-3" /> إلغاء
                </button>
                <button
                  onClick={() => void openJob(detail.id)}
                  className="text-[8.5px] font-mono text-cyan-300/80 flex items-center gap-0.5 hover:text-cyan-200"
                >
                  {busy === "detail" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} تحديث
                </button>
              </span>
            </div>
            <div className="space-y-1 max-h-64 overflow-auto">
              {(detail.tasks ?? []).map((t) => (
                <div key={t.id} className="rounded-lg border border-white/10 bg-black/25 p-1.5 text-[9px] font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className={STATUS_COLOR[String(t.status)] ?? "text-white/50"}>
                      {t.status === "done" ? "✓" : t.status === "failed" ? "✗" : t.status === "running" ? "◐" : "◌"}
                    </span>
                    <b className="text-white/75">{t.kind}</b>
                    <span className="text-white/35">محاولات {t.attempts ?? 0}</span>
                    <span className="text-white/40">findings {t.findings ?? 0}</span>
                    <span className="text-white/30 mr-auto">{fmt(t.ms)}</span>
                  </div>
                  {t.error && <p className="text-[8.5px] text-red-300/70 truncate">{t.error}</p>}
                  {t.summary && <p className="text-[8.5px] text-white/45 truncate">{t.summary}</p>}
                  {(t.evidence ?? []).length > 0 && (
                    <p className="text-[8px] text-white/30 truncate">أدلة: {(t.evidence ?? []).slice(0, 3).join(" · ")}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-white/70">
                النتائج ({detail.findings?.length ?? 0})
                {unverified > 0 && <span className="text-[8px] text-amber-300/80"> · {unverified} مستنية تأكيد مستقل</span>}
              </span>
              <span className="flex items-center gap-1.5">
                <label className="text-[8px] font-mono text-white/40 flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={includeUnverified} onChange={(e) => setIncludeUnverified(e.target.checked)} />
                  اعرض اللي اترفض في التقرير
                </label>
                {unverified > 0 && (
                  <button
                    onClick={() =>
                      void run("verify", async () => {
                        const r = await opsFetch<{ verified?: number; total?: number; job?: JobDetail }>("/ops/jobs/" + encodeURIComponent(detail.id) + "/verify", {
                          method: "POST",
                          body: {},
                        });
                        if (!r.ok) {
                          setError(r.denial ?? "التأكيد اترفض");
                          return;
                        }
                        setStatus(`تأكيد مستقل: ${r.data?.verified ?? 0}/${r.data?.total ?? 0} اتعاد إنتاجه`);
                        setDetail(r.data?.job ?? null);
                        const rep = await opsText(`/ops/jobs/${encodeURIComponent(detail.id)}/report`);
                        if (rep.ok) setReport(rep.text);
                      })
                    }
                    className="text-[8.5px] font-mono text-emerald-300/90 hover:text-emerald-200 flex items-center gap-0.5"
                  >
                    {busy === "verify" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} أكّد غير المؤكّد
                  </button>
                )}
                <button
                  onClick={() =>
                    void run("export", async () => {
                      const blob = new Blob([report || ""], { type: "text/markdown" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `nova-${detail.id.slice(0, 8)}.md`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    })
                  }
                  className="text-[8.5px] font-mono text-cyan-300/80 hover:text-cyan-200 flex items-center gap-0.5"
                >
                  <Download className="h-3 w-3" /> تنزيل
                </button>
              </span>
            </div>
            <div className="space-y-1 max-h-40 overflow-auto">
              {(detail.findings ?? []).map((f) => (
                <div key={f.id} className="rounded-lg border border-white/10 bg-black/25 p-1.5 text-[9px]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[8px] px-1 rounded border ${SEV[String(f.severity ?? "info")] ?? SEV.info}`}>{f.severity ?? "info"}</span>
                    <b className="truncate">{f.titleAr || f.title || f.kind}</b>
                    <span className="text-[8px] font-mono text-white/40 truncate">{f.target}</span>
                    <span className="text-[8px] font-mono text-white/30">ثقة {Math.round((f.confidence ?? 0) * 100)}%</span>
                    {f.verified ? (
                      <span className="text-[8px] text-emerald-300 flex items-center gap-0.5 mr-auto">
                        <Check className="h-2.5 w-2.5" /> معاد تأكيده
                      </span>
                    ) : (
                      <span className="text-[8px] text-amber-300/80 mr-auto">مفيش تأكيد</span>
                    )}
                  </div>
                  {f.verification?.detail && <p className="text-[8.5px] text-white/45 truncate">{f.verification.detail}</p>}
                </div>
              ))}
              {(detail.findings ?? []).length === 0 && (
                <p className="text-[9px] text-white/40">
                  مفيش نتائج مؤكَّدة على المهمة دي. الأدلة اللي فشل تأكيدُها بتتحفظ في مجلد المهمة وبتتحسب coverage gap في التقرير — مش نجاح.
                </p>
              )}
            </div>
            <details className="rounded-lg border border-white/10 bg-black/25 p-1.5" open={report.length > 0 && (detail.findings?.length ?? 0) > 0}>
              <summary className="text-[9px] font-black text-white/60 cursor-pointer">التقرير (اللي ماتأكدش مش جوه افتراضيًا)</summary>
              <pre className="text-[8.5px] font-mono text-white/60 whitespace-pre-wrap max-h-52 overflow-auto mt-1">{report || "…"}</pre>
            </details>
          </div>
        </div>
      )}


      {/* المضيفون المجانيون — مقاسين من المحرك، مش من مقال */}
      {hosts && hosts.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-black text-white/70">
              البدائل المجانية للمضيف ({hosts.length}) — القياس من السيرفر اللي بيخدم اللوحة
            </span>
            <button
              onClick={() =>
                void run("hosts", async () => {
                  const r = await opsFetch<{ hosts?: Array<Record<string, unknown>>; measured_rule?: string }>("/fleet/catalogue?probe=1&force=1");
                  if (r.ok) {
                    setHosts(r.data?.hosts ?? []);
                    setHostNote(String(r.data?.measured_rule ?? ""));
                  } else setError(r.denial ?? "القياس اترفض");
                })
              }
              className="text-[8.5px] font-mono text-cyan-300/80 hover:text-cyan-200 flex items-center gap-1"
            >
              {busy === "hosts" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} قيس تاني
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
            {hosts.map((h) => {
              const probe = (h.probe ?? {}) as Record<string, unknown>;
              const reachable = Boolean(probe.reachable);
              const usable = h.usable === true;
              const scan = String(h.scanPolicy ?? "unknown");
              return (
                <a
                  key={String(h.id)}
                  href={String(h.url ?? "#")}
                  target="_blank"
                  rel="noreferrer"
                  className={`rounded-lg border p-1.5 ${
                    usable ? "border-emerald-400/25 bg-emerald-400/[0.04] hover:border-emerald-400/50" : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${h.probe ? (reachable ? "bg-emerald-400" : "bg-red-500") : "bg-white/25"}`} />
                    <b className="text-[9.5px] truncate">{String(h.name ?? h.id)}</b>
                    <span className="text-[7.5px] font-mono text-white/35 mr-auto">{h.probe ? `${String(probe.status ?? "—")} · ${String(probe.ms ?? "—")}ms` : "مقيسش"}</span>
                  </div>
                  <p className="text-[8.5px] font-mono text-white/45 truncate">
                    {String(h.ram ?? "—")} · {h.alwaysOn === true ? "دائم" : h.sleeps === true ? "بينام" : "مش دائم"}
                    {h.cardRequired === true ? " · كارت ❌" : " · بلا كارت"}
                  </p>
                  <p className="text-[8px] text-white/35 truncate">
                    مسح نشط: {scan === "forbidden" ? "ممنوع في شروطهم ❌" : scan === "allowed" ? "مسموح ✓" : "مش مذكور — اسأل الأول"}
                  </p>
                </a>
              );
            })}
          </div>
          {hostNote && <p className="text-[8px] text-white/35 leading-relaxed">{hostNote}</p>}
        </div>
      )}

      <p className="text-[8.5px] text-white/35 leading-relaxed">        <AlertTriangle className="inline h-3 w-3 text-amber-300/70" /> كل رقم هنا مقروء من المحرك في اللحظة دي. مفيش سيرفر = مفيش رقم (مش صفر)، ومفيش
        نتيجة = مفيش تأكيد. التوكن بيتخزن في المتصفح وبيتبعت هيدر <span className="font-mono">x-nova-token</span> بس.
      </p>
    </div>
  );
}
