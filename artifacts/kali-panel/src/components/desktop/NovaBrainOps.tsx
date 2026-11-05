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
  Wrench,
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

/* ─────────────────────────────────────────────────────────────────────────────
 * NovaHuntSurface — سطح الصيد: من الكتالوج لهدف بخطّة، ومن الدليل لمسودة إفصاح.
 * ─────────────────────────────────────────────────────────────────────────────
 * الثلاث نقاط اللي كانت مفصولة: الكتالوج (746 برنامج) في مكان، والمهام ونتايجها في
 * مكان، ومسودة البعت مافيش خالص. هنا الاتنين قدام بعض، والقواعد نفسها اللي على
 * السيرفر بتتنفّذ — الصفحة مابتقررش حاجة:
 *   • المرشّحون من `/ops/hunt/candidates` وكل سطر فيهم `consented:false` متفروض مش مقروء.
 *   • «خطّط» بنده `/ops/hunt/plan` (security.txt + مطابقة الكتالوج + أنواع المهام) من غير تسجيل.
 *   • «مسودة» بنده `/ops/findings/<key>/report-draft`؛ لو النتيجة ماعدش إنتاجها المحرك
 *     بيردّ 409 والسبب — والصفحة بتعرض الرفض حرفيًا مابتخبّيهوش.
 *   • على Pages مافيش قرص: الرد بيقول `standalone` والسبب، فبنطبّع السبب مش بنرسم أخضر.
 */
interface HuntRow {
  handle: string;
  name: string;
  platform: string;
  url: string;
  response_efficiency?: number | null;
  max_payout_usd?: number | null;
  submission_state?: string | null;
  counts?: { domains?: number; wildcards?: number; urls?: number; cidrs?: number; ips?: number };
  sample_hosts?: string[];
  registered?: boolean;
  consented?: boolean;
  mode?: string;
}
interface VaultRow {
  key: string;
  host: string;
  asset?: string;
  titleAr?: string;
  title?: string;
  severity?: string;
  kind?: string;
  verified?: boolean;
  occurrences?: number;
  jobs?: Array<{ id: string; name: string }>;
  evidence?: Array<{ file?: string; sha256?: string; bytes?: number }>;
}

/** شكل `GET /api/ops/tools` — كل حقل فيه مقاس على القرص، ومافيش «متوقع». */
interface ToolsState {
  dir?: string;
  present?: string[];
  missing?: string[];
  writable?: boolean;
  scriptAvailable?: boolean;
  measured?: boolean;
  reasonAr?: string;
  last?: { at?: string; ok?: boolean; installed?: number; total?: number; error?: string; reasonAr?: string } | null;
}

export function NovaHuntSurface() {
  const [hunt, setHunt] = useState<{ items: HuntRow[]; scanned?: number; fetchedAt?: string | null; present?: boolean; reasonAr?: string; permissionModel?: string } | null>(null);
  const [vault, setVault] = useState<{ counts?: { total?: number; verified?: number; bySeverity?: Record<string, number> }; present?: boolean; updatedAt?: string | null; reasonAr?: string } | null>(null);
  const [rows, setRows] = useState<VaultRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  const [plan, setPlan] = useState<{ host: string; body: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // إيدي المحرك: مقروءة من `/ops/tools` (فتش فعلي على القرص)، مش مكتوبة نص.
  const [tools, setTools] = useState<ToolsState | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    const [c, st, f, tl] = await Promise.all([
      opsFetch<{ items?: HuntRow[]; scanned?: number; fetchedAt?: string | null; present?: boolean; reasonAr?: string; permissionModel?: string }>(
        `/ops/hunt/candidates?limit=6${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`
      ),
      opsFetch<{ counts?: { total?: number; verified?: number }; present?: boolean; updatedAt?: string | null; reasonAr?: string }>("/ops/findings/status"),
      opsFetch<{ items?: VaultRow[] }>("/ops/findings?limit=12"),
      opsFetch<ToolsState>("/ops/tools"),
    ]);
    setHunt({ items: c.data?.items || [], scanned: c.data?.scanned, fetchedAt: c.data?.fetchedAt, present: c.data?.present, reasonAr: c.data?.reasonAr, permissionModel: c.data?.permissionModel });
    setVault({ counts: st.data?.counts, present: st.data?.present, updatedAt: st.data?.updatedAt, reasonAr: st.data?.reasonAr });
    setRows(f.data?.items || []);
    setTools(tl.data || null);
    setNote(!c.ok ? c.denial || "مافيش رد من المحرك" : null);
    setBusy(null);
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = useCallback(async () => {
    setBusy("sync");
    const r = await opsFetch<{ added?: number; updated?: number; total?: number; verified?: number; scanned?: number }>("/ops/findings/sync", { method: "POST", body: { limit: 200 } });
    setNote(r.ok ? `زامنت: +${r.data?.added ?? 0} جديدة · ${r.data?.updated ?? 0} اتحدّثت · الإجمالي ${r.data?.total ?? 0} (${r.data?.scanned ?? 0} مهمة مقروءة)` : r.denial || "الزامن فشل");
    await load();
    setBusy(null);
  }, [load]);

  const makePlan = useCallback(async (target: string) => {
    setBusy(`plan:${target}`);
    setDraft(null);
    const r = await opsFetch<{ host?: string; ok?: boolean; needs_ar?: string; warnings?: string[]; proposal?: { needs_ar?: string; warnings?: string[]; evidence?: Record<string, unknown> }; plan?: { kinds?: string[]; why?: string[] } }>("/ops/hunt/plan", {
      method: "POST",
      body: { target },
    });
    const p = (r.data?.proposal || {}) as { needs_ar?: string; warnings?: string[] };
    const kinds = (r.data?.plan?.kinds || []).join(" · ") || "مافيش أنواع اتقترحت";
    setPlan({
      host: target,
      body: [
        `الأنواع: ${kinds}`,
        p.needs_ar ? `\nمطلوب: ${p.needs_ar}` : "",
        (p.warnings || []).length ? `\nتحذيرات المحرك:\n- ${(p.warnings || []).join("\n- ")}` : "",
        (r.data?.plan?.why || []).length ? `\nليه: ${(r.data!.plan!.why || []).join(" · ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    setBusy(null);
  }, []);

  const makeDraft = useCallback(async (rec: VaultRow) => {
    setBusy(`draft:${rec.key}`);
    setPlan(null);
    const r = await opsText(`/ops/findings/${encodeURIComponent(rec.key)}/report-draft`);
    const parsed = (() => {
      try {
        return JSON.parse(r.text) as { markdown?: string; reasonAr?: string; error?: string };
      } catch {
        return null;
      }
    })();
    if (r.ok && parsed?.markdown) setDraft({ title: `مسودة — ${rec.host} · ${rec.titleAr || rec.title || rec.key}`, body: parsed.markdown });
    else setDraft({ title: `مرفوض (${r.status}) — ${rec.host}`, body: parsed?.reasonAr || r.text || `HTTP ${r.status}` });
    setBusy(null);
  }, []);

  // التجهيز من الوجهة نفسها اللي بتقوله للمحرك في الشات (`tools_install`) — بس
  // من غير ما حد يفتح تيرمينال. الرفض بیوصل حرفيًا (403/سقف زمني/قرص مقفول).
  const provisionTools = useCallback(async () => {
    setBusy("provision");
    setNote("بينزّل النسخ الثابتة من GitHub في `vendor/bin` — لو الشبكة بطيانة هيقف لوحده ويقول.");
    const r = await opsFetch<{ ok?: boolean; record?: ToolsState["last"]; status?: ToolsState }>("/ops/tools/provision", { method: "POST", body: {} });
    if (r.ok && r.data?.ok) {
      setTools(r.data.status || null);
      const rec = r.data.record;
      setNote(`تم ${rec?.installed ?? 0}/${rec?.total ?? 0} في ${Math.max(1, Math.round((rec as unknown as { ms?: number })?.ms ? Number((rec as unknown as { ms?: number }).ms) / 1000 : 0))} ثانية — المحرك بيشوفهم من غير إعادة تشغيل.`);
    } else {
      setNote(`المكنة رفضت التجهيز: ${r.data?.record?.reasonAr || r.denial || r.error || `HTTP ${r.status}`}${r.how ? ` — ${r.how}` : ""}`);
    }
    setBusy(null);
  }, []);

  const counts = vault?.counts || {};
  const sevList = Object.entries(counts.bySeverity || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([s, n]) => `${s} ${n}`)
    .join(" · ");

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0a0512] p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-cyan-300" />
          <h2 className="text-xs font-black">سطح الصيد · الكتالوج ↔ الخزانة ↔ المسودة</h2>
          <span className="text-[9px] px-1.5 py-0.5 rounded border border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200">
            {hunt?.present ? `من ${hunt.scanned ?? 0} برنامج` : "الكتالوج على السيرفر"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="دوّر في الأسماء والنطاقات…"
            className="h-7 w-40 rounded-lg bg-black/40 border border-white/10 px-2 text-[10px] text-white/80 placeholder:text-white/25"
          />
          <button onClick={() => void load()} className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[9px] font-black text-white/60 hover:text-white/90">
            <Search className="h-3 w-3" /> تحديث
          </button>
          <button onClick={() => void sync()} className="flex items-center gap-1 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[9px] font-black text-cyan-200">
            {busy === "sync" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} زامن الخزانة
          </button>
        </div>
      </div>

      {note && <p className="text-[9.5px] text-amber-200/80 leading-relaxed">{note}</p>}
      {hunt?.permissionModel && (
        <p className="text-[9px] text-white/40 leading-relaxed">
          <ShieldCheck className="inline h-3 w-3 mr-1 text-emerald-300" />
          {hunt.permissionModel}
        </p>
      )}

      {/* ── الإيدين: أدوات المحرك على المكنة دي، مقاسة مش معلنة ─────────────
          السطر ده هو الفرق بين «البرنامج بيقدر يعمل كذا» و«البرنامج عنده أداته»:
          على nova.waifly.com كان القياس `present: []` والصفحة مابتقولش. */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-black text-white/70 flex items-center gap-1">
          <Wrench className="h-3 w-3 text-cyan-300" /> أدواتي على المكنة
        </span>
        {tools?.measured === false ? (
          <span className="text-[9px] text-white/40">{tools.reasonAr || "مش مقاس على الباندل الثابت"}</span>
        ) : (
          <>
            {(tools?.present || []).map((bin) => (
              <span key={bin} className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 font-mono">
                {bin} ✓
              </span>
            ))}
            {(tools?.missing || []).map((bin) => (
              <span key={bin} className="text-[9px] px-1.5 py-0.5 rounded border border-white/10 text-white/35 font-mono">
                {bin}
              </span>
            ))}
            {(tools?.present || []).length === 0 && <span className="text-[9px] text-amber-200/75">ولا أداة منصوبة — الاستطلاع السلبي والـHTTP بس</span>}
          </>
        )}
        <span className="ms-auto text-[8.5px] text-white/30 font-mono" title={tools?.dir || ""}>
          {tools?.dir ? tools.dir.split("/").slice(-2).join("/") : ""}
          {tools && tools.writable === false ? " · قرص مقفول" : ""}
        </span>
        {tools?.last && (
          <span className="text-[8.5px] text-white/35">
            آخر محاولة: {tools.last.ok ? `${tools.last.installed}/${tools.last.total} ✓` : `فشلت (${tools.last.error || "?"})`}
          </span>
        )}
        <button
          onClick={() => void provisionTools()}
          disabled={busy === "provision" || !tools || tools.measured === false || !tools.writable || !(tools.missing || []).length}
          title={
            !tools
              ? "مافيش قياس بعد"
              : tools.measured === false
                ? "الباندل الثابق مابيجهّزش — اربطه بالسيرفر"
                : !tools.writable
                  ? `${tools.dir || "vendor/bin"} مش قابل للكتابة على المكنة دي`
                  : !(tools.missing || []).length
                    ? "كل الأدوات موجودة"
                    : `ينزّل ${(tools.missing || []).join(", ")} من GitHub في ${tools.dir || "vendor/bin"}`
          }
          className="flex items-center gap-1 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[9px] font-black text-cyan-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === "provision" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} جهّز الأدوات
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* مرشّحو الصيد */}
        <div className="rounded-xl border border-white/10 p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-black text-white/70">مرشّحون للاطلاع (الأول أجود استجابة)</h3>
            <span className="text-[9px] text-white/35">{hunt?.fetchedAt ? `كتالوج ${String(hunt.fetchedAt).slice(0, 10)}` : ""}</span>
          </div>
          {hunt?.reasonAr && <p className="text-[9px] text-white/45">{hunt.reasonAr}</p>}
          {(hunt?.items || []).length === 0 && !hunt?.reasonAr && <p className="text-[9px] text-white/35">مافيش مرشّح راجع الفلاتر — جرّب من غير بحث.</p>}
          {(hunt?.items || []).map((c) => (
            <div key={c.handle} className="rounded-lg bg-black/30 border border-white/5 p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-black truncate">{c.name}</p>
                  <p className="text-[9px] text-white/45 truncate">
                    {c.platform}:{c.handle} · {c.url}
                  </p>
                </div>
                <button onClick={() => void makePlan((c.sample_hosts || [])[0] || c.handle)} className="shrink-0 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-1 text-[9px] font-black text-cyan-200">
                  {busy === `plan:${(c.sample_hosts || [])[0] || c.handle}` ? "…" : "خطّط"}
                </button>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[8.5px] font-mono">
                <span className="rounded bg-white/5 px-1 text-white/55">استجابة {c.response_efficiency ?? "؟"}%</span>
                <span className="rounded bg-white/5 px-1 text-white/55">أقصى {c.max_payout_usd != null ? `$${c.max_payout_usd}` : "؟"}</span>
                <span className="rounded bg-white/5 px-1 text-white/55">نطاقات {c.counts?.domains ?? 0}+{c.counts?.wildcards ?? 0}*</span>
                <span className="rounded bg-white/5 px-1 text-white/55">شبكة {c.counts?.cidrs ?? 0} CIDR (سياق)</span>
                <span className={`rounded px-1 ${c.submission_state === "open" ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"}`}>استقبال {c.submission_state || "؟"}</span>
                <span className="rounded bg-rose-400/10 px-1 text-rose-200">consented:{String(c.consented)} · {c.mode}</span>
                <span className={`rounded px-1 ${c.registered ? "bg-cyan-400/10 text-cyan-200" : "bg-white/5 text-white/45"}`}>{c.registered ? "مسجّل في المحرك" : "مش مسجّل"}</span>
              </div>
            </div>
          ))}
          {plan && (
            <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-2">
              <p className="text-[9.5px] font-black text-cyan-100">خطّة {plan.host}</p>
              <pre className="mt-1 whitespace-pre-wrap break-words text-[9px] text-white/65 leading-relaxed">{plan.body}</pre>
            </div>
          )}
        </div>

        {/* الخزانة */}
        <div className="rounded-xl border border-white/10 p-2 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <h3 className="text-[10px] font-black text-white/70">خزانة النتائج</h3>
            <span className="text-[9px] font-mono text-white/45">
              {vault?.present ? `${counts.total ?? 0} نتيجة · ${counts.verified ?? 0} متأكَّدة` : "الخزانة على السيرفر"}
            </span>
          </div>
          {vault?.reasonAr && <p className="text-[9px] text-white/45">{vault.reasonAr}</p>}
          {sevList && <p className="text-[9px] font-mono text-white/40">{sevList}</p>}
          {rows.length === 0 && <p className="text-[9px] text-white/35">مافيش نتائج في الخزانة — دوس «زامن الخزانة» بعد ما مهمة تخلص.</p>}
          {rows.map((r) => (
            <div key={r.key} className="rounded-lg bg-black/30 border border-white/5 p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-black truncate">{r.titleAr || r.title || r.key}</p>
                  <p className="text-[9px] text-white/45 truncate font-mono">
                    {r.host} · {r.kind} · {(r.occurrences ?? 1)} مشاهدة · {r.evidence?.length ?? 0} دليل
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded px-1 text-[8.5px] font-mono ${r.verified ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"}`}>
                    {r.verified ? "مُعاد إنتاجها" : "مش مثبتة"}
                  </span>
                  <button onClick={() => void makeDraft(r)} className="flex items-center gap-1 rounded-lg border border-white/10 px-1.5 py-1 text-[9px] font-black text-white/60 hover:text-white/90">
                    {busy === `draft:${r.key}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} مسودة
                  </button>
                </div>
              </div>
            </div>
          ))}
          {draft && (
            <div className="rounded-lg border border-white/10 bg-black/40 p-2">
              <p className="text-[9.5px] font-black text-white/80">{draft.title}</p>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[8.5px] leading-relaxed text-white/60">{draft.body}</pre>
            </div>
          )}
        </div>
      </div>
      <p className="text-[8.5px] text-white/30">
        الصفحة مابتقررش حاجة: الاختيار والرفض والمسودة كلهم ردود المحرك بحروفه — والرفض (409 «ماعدش إنتاجها») متعمّد يبان، مش يتخبّى.
      </p>
    </section>
  );
}
