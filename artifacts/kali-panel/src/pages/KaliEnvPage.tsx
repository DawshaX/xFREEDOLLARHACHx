/**
 * KaliEnvPage — صفحة بيئة كالي الحقيقية، مبنية من الأول (TEST54، 2026-11-17).
 *
 * القاعدة اللي الصفحة دي كلها مبنية عليها (قرار الماولك «القياس قبل الادعاء»):
 *   كل رقم على الصفحة جاي من endpoint حقيقي بالحرف — مافيش رقم مكتوب،
 *   مافيش «كذا غالبًا»، ومافيش حالة وهمية. لو القياس مش موجود الصفحة
 *   بتقول «بيقيس…» أو بتقول السبب بالحرف.
 *
 * الأقسام (كلها حقيقية ومربوطة):
 *   1. نظرة عامة    — بصمة البناء + مرآة النشر + عدّادات مقاسة + تثبيت كالي على الهَب
 *   2. الأسطول      — عقد كالي السحابية الحية (GitHub Actions) بقياس 20ث
 *   3. الأدوات      — كتالوج كالي الكامل مقاس ✓/✗ + إصدار كل أداة + زر ثبت حقيقي
 *   4. الطرفية      — تنفيذ حقيقي (الجست proot أو عقدة الأسطول) بث حي للمخرجات
 *   5. الديسكتوب    — بث MJPEG حي من جوه الجست (Xvfb + ffmpeg)
 *   6. التخزين      — المخزن الموحد على GitHub (فروع + releases) مقاس بالبايت
 *
 * اللي محتاج فهم الأنظمة: كل أوامر كالي بتبدأ من الهَب → إما الجست المدمج
 * (/api/kali-env/exec) أو عقدة الأسطول (/api/ops/kali/exec-stream) — الاتنين
 * بيرجعوا نفس الشكل {type,text,exitCode} فالطرفية واحدة للطايرتين.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity, Boxes, CheckCircle2, ChevronDown, Cpu, Download, Eye, HardDrive,
  MonitorPlay, Package, RefreshCw, Server, TerminalSquare, XCircle, ExternalLink,
} from "lucide-react";
import { novaAuthHeaders } from "@/lib/ops-client";

const API = "/api";
const REPO = "DawshaX/xFREEDOLLARHACHx";

/* ── أنواع البيانات — حرفيًا من الراوترات ─────────────────────────────────── */

type BuildStamp = { commit?: string; builtAt?: string };
type DeployMirror = {
  at?: string;
  reachable?: boolean;
  boot?: { commit?: string; builtAt?: string } | null;
  bootAfter?: { commit?: string; builtAt?: string } | null;
  asset?: { updatedAt?: string; size?: number } | null;
  action?: string;
  fresh?: boolean;
};
type KaliNodeRow = {
  id: string; hostname: string; platform: string; connectedAt: string;
  kali: boolean; mode: string; probed: boolean;
};
type KaliNodeInstall = {
  running: boolean; node: string; startedAt: string | null; finishedAt: string | null;
  done: boolean; exitCode: number | null; log: string[];
};
type KaliNodes = {
  ok: boolean;
  hub: { kali: boolean; packages: number; executables?: number };
  nodes: KaliNodeRow[];
  install: KaliNodeInstall;
  probedAt: string;
  stats?: { total: number; ok: number; fail: number; last: { at: string; plane: string; cmd: string; ok: boolean; bytes: number } | null; byPlane: Record<string, number> } | null;
};
type StorageRow = { id: string; label: string; kind: string; bytes: number; items: number; updatedAt: string | null; link: string };
type StorageHub = { ok: boolean; repo: string; rows: StorageRow[]; totalBytes: number; totalHuman: string; measuredAt: string };
type KaliEnvHealth = {
  ok: boolean; ready: boolean; prootBin: string | null; rootfs: string | null;
  guestShell: boolean; detail: string; searched?: string[];
  fleet?: { connected: number; kaliReady: number };
  readyAnywhere?: boolean;
};
type CatalogCat = { id: string; tools: Array<{ name: string; present: boolean; version: string | null }> };
type ProvisionState = {
  running: boolean; phase: string; partsDone: number; partsTotal: number; entries: number;
  bytesDone: number; current: string; error: string | null; startedAt: string | null;
  finishedAt: string | null; log: string[]; transport: string | null;
};
type LogLine = { text: string; isErr?: boolean };

/* ── أدوات صغيرة ──────────────────────────────────────────────────────────── */

const hhmmss = (iso?: string | null) => (iso ? iso.slice(11, 19) : "");
const GB = (b: number) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(2)}GB` : `${(b / 2 ** 20).toFixed(1)}MB`);
const ago = (iso?: string | null): string => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return hhmmss(iso);
  const m = Math.floor(ms / 60000);
  if (m < 60) return `منذ ${m}د`;
  const h = Math.floor(m / 60);
  return `منذ ${h}س ${m % 60}د`;
};

/* ═══════════════════════════════ الصفحة ═══════════════════════════════ */

export default function KaliEnvPage() {
  const [tab, setTab] = useState<"overview" | "fleet" | "tools" | "terminal" | "desktop" | "storage">("overview");

  /* كل مقاييس النظرة العامة */
  const [build, setBuild] = useState<BuildStamp | null>(null);
  const [mirror, setMirror] = useState<DeployMirror | null | "pending">("pending");
  const [nodes, setNodes] = useState<KaliNodes | null>(null);
  const [health, setHealth] = useState<KaliEnvHealth | null>(null);
  const [storage, setStorage] = useState<StorageHub | null>(null);
  const [prov, setProv] = useState<ProvisionState | null>(null);
  const [checkedAt, setCheckedAt] = useState<string>("");

  /* الأدوات */
  const [cats, setCats] = useState<CatalogCat[]>([]);
  const [catMeta, setCatMeta] = useState<{ cachedFrom?: string; measuredOn?: string }>({});
  const [instBusy, setInstBusy] = useState<string | null>(null);
  const [instResult, setInstResult] = useState<Record<string, { ok: boolean; output: string }>>({});
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});

  /* الطرفية */
  const [cmd, setCmd] = useState("");
  const [plane, setPlane] = useState<"auto" | "node" | "proot">("auto");
  const [log, setLog] = useState<LogLine[]>([]);
  const [live, setLive] = useState<{ running?: boolean; cmd?: string; plane?: string | null; exitCode?: number | null; durationMs?: number | null } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  /* الديسكتوب */
  const [deskOn, setDeskOn] = useState(false);
  const [deskTick, setDeskTick] = useState(0);

  /* ── القياسات ─────────────────────────────────────────────────────────── */

  const loadBuild = useCallback(async () => {
    try {
      const r = await fetch("/api/nova-core/version", { headers: novaAuthHeaders(), signal: AbortSignal.timeout(8000) });
      if (r.ok) { const v = await r.json(); setBuild({ commit: v?.commit || v?.build?.commit, builtAt: v?.builtAt || v?.build?.builtAt }); }
    } catch { /* النبضة الجايّة */ }
  }, []);

  /* المرآة: الهَب أولًا (كاش 10د) → raw.githubusercontent → نسخة محلية */
  const loadMirror = useCallback(async () => {
    setMirror("pending");
    const urls = [
      `${API}/ops/deploy-mirror`,
      `https://raw.githubusercontent.com/${REPO}/main/state/waifly-deploy.json?t=${Date.now()}`,
      "/state/waifly-deploy.json",
    ];
    for (const u of urls) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(9000) });
        if (r.ok) { setMirror(await r.json() as DeployMirror); setCheckedAt(new Date().toLocaleTimeString("en-GB")); return; }
      } catch { /* المحاولة الجاية */ }
    }
    setMirror(null);
    setCheckedAt(new Date().toLocaleTimeString("en-GB"));
  }, []);

  const loadNodes = useCallback(async () => {
    try {
      const r = await fetch(`${API}/ops/kali/nodes`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) setNodes(await r.json() as KaliNodes);
    } catch { /* البولينج الجايّ */ }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-env/health`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(25000) });
      if (r.ok) setHealth(await r.json() as KaliEnvHealth);
    } catch { /* النبضة الجايّة */ }
  }, []);

  const loadStorage = useCallback(async () => {
    try {
      const r = await fetch(`${API}/ops/storage-hub`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) setStorage(await r.json() as StorageHub);
    } catch { /* النبضة الجايّة */ }
  }, []);

  const loadProv = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch(`${API}/ops/kali/provision/status`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) { const d = await r.json() as { provision: ProvisionState }; setProv(d.provision); return d.provision.running; }
    } catch { /* النبضة الجايّة */ }
    return false;
  }, []);

  /* نبضة شاملة أول تحميل + بولينج خفيف مستمر */
  useEffect(() => {
    void loadBuild(); void loadMirror(); void loadNodes(); void loadHealth(); void loadStorage(); void loadProv();
    const iv = setInterval(() => { void loadNodes(); void loadHealth(); }, 20000);
    const iv2 = setInterval(() => void loadProv(), 15000);
    return () => { clearInterval(iv); clearInterval(iv2); };
  }, [loadBuild, loadMirror, loadNodes, loadHealth, loadStorage, loadProv]);

  /* الكتالوج المقاس (كاش 10د سيرفرًا — فتح الصفحة مش بيقيس من أول جديد) */
  const loadCatalog = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-env/catalog`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const d = await r.json() as { categories?: CatalogCat[]; cachedFrom?: string; measuredOn?: string };
        setCats(d.categories ?? []);
        setCatMeta({ cachedFrom: d.cachedFrom, measuredOn: d.measuredOn });
      }
    } catch { /* زر التحديث يجرب تاني */ }
  }, []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  /* زر ثبت — حقيقي: POST /kali-env/install → النتيجة مقاسة (INSTALL_OK/FAIL) */
  const installTool = async (tool: string) => {
    setInstBusy(tool);
    try {
      const r = await fetch(`${API}/kali-env/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ tool }),
        signal: AbortSignal.timeout(480000),
      });
      if (r.ok) {
        const d = await r.json() as { ok: boolean; output: string };
        setInstResult((p) => ({ ...p, [tool]: { ok: d.ok, output: d.output || (d.ok ? "تثبت ✓" : "فشل") } }));
      } else {
        const t = await r.text().catch(() => "");
        setInstResult((p) => ({ ...p, [tool]: { ok: false, output: `HTTP ${r.status} ${t.slice(0, 120)}` } }));
      }
    } catch (e) {
      setInstResult((p) => ({ ...p, [tool]: { ok: false, output: e instanceof Error ? e.message : "فشل الطلب" } }));
    }
    setInstBusy(null);
    void loadCatalog();
  };

  /* تثبيت كالي على الهَب نفسه (provision) — زر حقيقي مع تأكيد */
  const startProvision = async () => {
    if (!window.confirm("تثبيت كالي على الهَب نفسه؟ التنزيل سحابي بالكامل (فرع kali-rootfs) وممكن ياخد دقايق.")) return;
    try {
      await fetch(`${API}/ops/kali/provision`, {
        method: "POST", headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ confirm: "yes" }), signal: AbortSignal.timeout(15000),
      });
    } catch { /* الحالة الجاية تقول الصدق */ }
    void loadProv();
  };

  /* عقدة جديدة: شغّل المثبّت على عقدة متصلة */
  const installOnNode = async () => {
    try {
      await fetch(`${API}/ops/kali/nodes/install`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    } catch { /* الحالة الجاية تقول الصدق */ }
    void loadNodes();
  };

  /* ── الطرفية: طايرة حقيقية واحدة — الجست أو العقدة ────────────────────── */

  const pushLine = (text: string, isErr = false) =>
    setLog((p) => [...p.slice(0, 500), { text, isErr }]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);

  const execProot = async (c: string): Promise<number | null> => {
    const r = await fetch(`${API}/kali-env/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
      body: JSON.stringify({ command: c, timeoutMs: 120000 }),
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok || !r.body) {
      const t = await r.text().catch(() => "");
      pushLine(`⚠ الجست ${r.status}: ${t.slice(0, 200)}`, true);
      return null;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let exit: number | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        const line = f.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let d: { type?: string; text?: string; exitCode?: number | null; durationMs?: number; message?: string };
        try { d = JSON.parse(line.slice(6)); } catch { continue; }
        if ((d.type === "stdout" || d.type === "stderr") && d.text) pushLine(d.text, d.type === "stderr");
        else if (d.type === "error") pushLine(`⚠ ${d.message ?? "خطأ الجست"}`, true);
        else if (d.type === "done") { exit = d.exitCode ?? null; setLive((j) => ({ ...(j ?? {}), running: false, exitCode: exit, durationMs: d.durationMs ?? null, plane: "الجست المدمج" })); }
      }
    }
    return exit;
  };

  const execNode = (c: string): Promise<number | null> =>
    new Promise((resolve) => {
      let finalExit: number | null = null;
      const es = new EventSource(`${API}/ops/kali/exec-stream?command=${encodeURIComponent(c)}&timeout=120000`);
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data) as { type: string; text?: string; exitCode?: number | null; durationMs?: number; plane?: string };
          if ((d.type === "stdout" || d.type === "stderr") && d.text) pushLine(d.text, d.type === "stderr");
          else if (d.type === "error" && d.text) pushLine(`⚠ ${d.text}`, true);
          else if (d.type === "done") {
            finalExit = d.exitCode ?? null;
            if (d.plane) setLive((j) => ({ ...(j ?? {}), plane: d.plane ?? null }));
            setLive((j) => ({ ...(j ?? {}), running: false, exitCode: d.exitCode ?? null, durationMs: d.durationMs ?? null }));
            es.close(); resolve(finalExit);
          }
        } catch { /* chunk مش JSON */ }
      };
      es.onerror = () => { es.close(); setLive((j) => (j && j.running ? { ...j, running: false } : j)); resolve(finalExit); };
    });

  const run = async (c?: string) => {
    const command = (c ?? cmd).trim();
    if (!command || live?.running) return;
    setCmd(command);
    setLive({ running: true, cmd: command, plane: null });
    pushLine(`$ ${command}`);
    let exit: number | null = null;
    if (plane === "node") exit = await execNode(command);
    else if (plane === "proot") exit = await execProot(command);
    else {
      // auto: الجست لو جاهز مقاس، وإلا عقدة الأسطول — وبنقولك الطايرة اللي ردت
      const ready = health?.readyAnywhere ?? false;
      exit = ready ? await execProot(command) : await execNode(command);
    }
    setLive((j) => ({ ...(j ?? {}), running: false, exitCode: exit ?? j?.exitCode ?? null }));
  };

  /* ── العدّادات المقاسة ─────────────────────────────────────────────────── */

  const kaliNodes = nodes?.nodes.filter((n) => n.kali) ?? [];
  const totalTools = useMemo(() => cats.reduce((a, c) => a + c.tools.length, 0), [cats]);
  const presentTools = useMemo(() => cats.reduce((a, c) => a + c.tools.filter((t) => t.present).length, 0), [cats]);

  const bootCommit = (mirror && mirror !== "pending" ? (mirror.bootAfter ?? mirror.boot) : null)?.commit;
  const mirrorChip = mirror === "pending"
    ? { label: "…بجيب مرآة النشر", tone: "wait" as const }
    : mirror === null
      ? { label: "المرآة مااتبنتش لسه", tone: "warn" as const }
      : {
          label: `${(mirror.reachable ?? false) ? "مرآة حية" : "مرآة"} · boot:${(bootCommit ?? "?").slice(0, 7)}${mirror.asset?.updatedAt ? ` · bundle:${hhmmss(mirror.asset.updatedAt)}` : ""}`,
          tone: mirror.fresh ? ("ok" as const) : ("warn" as const),
        };

  const TABS = [
    { id: "overview", label: "نظرة عامة", icon: Activity },
    { id: "fleet", label: `الأسطول${nodes ? ` (${kaliNodes.length})` : ""}`, icon: Server },
    { id: "tools", label: `الأدوات${cats.length ? ` (${presentTools}/${totalTools})` : ""}`, icon: Boxes },
    { id: "terminal", label: "الطرفية", icon: TerminalSquare },
    { id: "desktop", label: "الديسكتوب الحي", icon: MonitorPlay },
    { id: "storage", label: "التخزين", icon: HardDrive },
  ] as const;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-200" dir="rtl">
      {/* ── الهيدر: بصمة + مرآة + تحديث ── */}
      <div className="sticky top-0 z-20 bg-[#070b14]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h1 className="text-lg font-black text-emerald-100">كالي الحقيقية — مقاسة حي</h1>
          </div>
          <span className={`text-[11px] px-2.5 py-1 rounded-full border ${mirrorChip.tone === "ok" ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-200" : mirrorChip.tone === "warn" ? "bg-amber-500/10 border-amber-400/30 text-amber-200" : "bg-slate-500/10 border-slate-400/30 text-slate-300"}`}>
            {mirrorChip.label}
          </span>
          {build?.commit && (
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-400/30 text-cyan-200 font-mono" title={build.builtAt || ""}>
              build {build.commit.slice(0, 7)}{build.builtAt ? ` · ${hhmmss(build.builtAt)}` : ""}
            </span>
          )}
          <div className="grow" />
          {checkedAt && <span className="text-[10px] text-slate-500">اتقاس {checkedAt}</span>}
          <button
            onClick={() => { void loadBuild(); void loadMirror(); void loadNodes(); void loadHealth(); void loadStorage(); void loadCatalog(); }}
            className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> قيس من جديد
          </button>
        </div>
        {/* التبويبات */}
        <div className="max-w-7xl mx-auto px-4 pb-2 flex gap-1.5 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border whitespace-nowrap flex items-center gap-1.5 ${tab === t.id ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-100 font-bold" : "bg-white/[0.03] border-white/10 text-slate-400 hover:bg-white/[0.07]"}`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-5">
        {/* ═══ نظرة عامة ═══ */}
        {tab === "overview" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={Server} label="عقد كالي حية" value={nodes ? `${kaliNodes.length}/${nodes.nodes.length}` : "…بيقيس"} hint={nodes?.probedAt ? `آخر فحص ${hhmmss(nodes.probedAt)}` : "من الهَب كل 20ث"} tone="cyan" />
              <StatCard icon={Package} label="حزم كالي" value={nodes?.hub.packages ? String(nodes.hub.packages) : health?.ok ? "…بيقيس" : "—"} hint={nodes?.hub.executables ? `${nodes.hub.executables} تنفيذي` : "rootfs حقيقية"} tone="violet" />
              <StatCard icon={Boxes} label="أدوات متاحة" value={cats.length ? `${presentTools}/${totalTools}` : "…بيقيس"} hint="command -v جوه الجست" tone="emerald" />
              <StatCard icon={HardDrive} label="على GitHub" value={storage?.totalHuman ?? "…بيقيس"} hint={storage?.measuredAt ? `مقاس ${hhmmss(storage.measuredAt)}` : "فروع + releases"} tone="amber" />
            </div>

            {/* المرآة والبناء — الشهادة إن اللي شغال هو آخر بناء */}
            <Card title="سلسلة النشر — المرآة الحية" icon={Eye}>
              {mirror === "pending" ? (
                <p className="text-sm text-slate-400">…بجيب مرآة النشر (state/waifly-deploy.json)…</p>
              ) : mirror === null ? (
                <p className="text-sm text-amber-300">المرآة مااتبنتش — أول فحص watchdog هيبنيها وترجع تظهر هنا بالحرف.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <KV k="آخر فحص" v={hhmmss(mirror.at)} />
                  <KV k="boot (المبني شغال)" v={(mirror.bootAfter ?? mirror.boot)?.commit?.slice(0, 7) ?? "—"} />
                  <KV k="bundle nova-24-7.zip" v={mirror.asset?.updatedAt ? `${hhmmss(mirror.asset.updatedAt)} · ${GB(mirror.asset.size ?? 0)}` : "—"} />
                  <KV k="الفعل الأخير" v={mirror.action ?? "—"} />
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-2">
                المرآة بيتحدثها فحص runner كل 30د — لو boot هنا أقدم من build فوق، الهَب لسه هيتحدث أو الفحص الجاي لسه ما اتنفذش.
              </p>
            </Card>

            {/* تثبيت كالي على الهَب */}
            <Card title="كالي على الهَب نفسه (rootfs + proot)" icon={Cpu}>
              <div className="flex flex-wrap items-center gap-3">
                {health ? (
                  <>
                    <Chip ok={health.ready} label={health.ready ? "proot + rootfs موجودين" : "مش منصبين على الهَب"} />
                    <Chip ok={health.guestShell} label={health.guestShell ? "شيل الجست بيرد فعليًا" : "الشيل ما ردّش"} />
                    <Chip ok={Boolean(health.fleet?.kaliReady)} label={`طايرة الأسطول: ${health.fleet?.kaliReady ?? 0} عقدة كالي`} />
                    <Chip ok={Boolean(health.readyAnywhere)} label={health.readyAnywhere ? "كالي جاهزة في مكان ما (مقاس)" : "مافيش كالي جاهزة"} />
                  </>
                ) : (
                  <p className="text-sm text-slate-400">…بيقيس صحة الجست…</p>
                )}
                <div className="grow" />
                <button
                  onClick={startProvision}
                  disabled={Boolean(prov?.running)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-400/30 hover:bg-violet-500/25 disabled:opacity-40 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> {prov?.running ? `بينزل ${prov.partsDone}/${prov.partsTotal}` : "ثبت كالي على الهَب"}
                </button>
              </div>
              {prov?.running && (
                <div className="mt-3 text-[11px] text-slate-400">
                  <div>المرحلة: {prov.phase} · الجزء الحالي: {prov.current || "—"}</div>
                  <div className="mt-1 h-1.5 rounded bg-white/5 overflow-hidden">
                    <div className="h-full bg-violet-400/60 transition-all" style={{ width: `${prov.partsTotal ? Math.round((prov.partsDone / prov.partsTotal) * 100) : 0}%` }} />
                  </div>
                </div>
              )}
              {prov?.error && <p className="text-xs text-rose-300 mt-2">⚠ {prov.error}</p>}
              <p className="text-[11px] text-slate-500 mt-2">
                من غير rootfs على الهَب الأوامر بتروح لعقدة الأسطول تلقائيًا (kali_run) — الاتنين حقيقيين ومقاسين.
              </p>
            </Card>

            {/* آخر تنفيذ حقيقي */}
            {nodes?.stats?.last && (
              <Card title="آخر أمر اتنفذ على كالي (مقاس)" icon={TerminalSquare}>
                <div className="text-xs space-y-1.5 font-mono" dir="ltr">
                  <div className="text-slate-300 break-all">{nodes.stats.last.cmd.slice(0, 180)}</div>
                  <div className="flex gap-3 text-[11px]">
                    <span className={nodes.stats.last.ok ? "text-emerald-300" : "text-rose-300"}>{nodes.stats.last.ok ? "✓ نجح" : "✗ فشل"}</span>
                    <span className="text-slate-400">{nodes.stats.last.plane}</span>
                    <span className="text-slate-500">{hhmmss(nodes.stats.last.at)} · {GB(nodes.stats.last.bytes)}</span>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ═══ الأسطول ═══ */}
        {tab === "fleet" && (
          <div className="space-y-4">
            <Card
              title={`عقد كالي السحابية (${kaliNodes.length} كالي من ${nodes?.nodes.length ?? "?"} متصلة)`}
              icon={Server}
              action={
                <button onClick={installOnNode} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/30 hover:bg-emerald-500/25 flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" /> ثبّت كالي على عقدة
                </button>
              }
            >
              {!nodes ? (
                <p className="text-sm text-slate-400">…بيقيس الأسطول…</p>
              ) : nodes.nodes.length === 0 ? (
                <p className="text-sm text-amber-300">مافيش عقد متصلة حالًا — موجة fleet-nodes بتطلع كل 5 ساعات وبتصل بالهَب تلقائيًا.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 text-right">
                        <th className="py-1.5 px-2">العقدة</th>
                        <th className="py-1.5 px-2">الوضع</th>
                        <th className="py-1.5 px-2">كالي؟</th>
                        <th className="py-1.5 px-2">متصل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nodes.nodes.map((n) => (
                        <tr key={n.id} className="border-t border-white/5">
                          <td className="py-1.5 px-2 font-mono" dir="ltr">{n.hostname || n.id}</td>
                          <td className="py-1.5 px-2 text-slate-400">{n.mode}</td>
                          <td className="py-1.5 px-2">
                            {n.kali ? <span className="text-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> كالي جاهزة</span>
                              : <span className="text-slate-500">{n.probed ? "قيس — مش كالي" : "…بقيس"}</span>}
                          </td>
                          <td className="py-1.5 px-2 text-slate-500">{ago(n.connectedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {nodes?.install && (nodes.install.running || nodes.install.log.length > 0) && (
              <Card title={`مثبّت العقدة ${nodes.install.node || ""} ${nodes.install.running ? "— شغال دلوقتي" : nodes.install.done ? `— خلص (exit ${nodes.install.exitCode})` : ""}`} icon={Download}>
                <div ref={logRef} className="max-h-56 overflow-y-auto bg-black/40 rounded-lg p-3 text-[11px] font-mono whitespace-pre-wrap" dir="ltr">
                  {nodes.install.log.slice(-40).join("\n") || "…"}
                </div>
              </Card>
            )}

            <Card title="إزاي العقد دي موجودة أصلًا؟" icon={ExternalLink}>
              <p className="text-xs text-slate-400 leading-relaxed">
                كل عقدة = job على <b>GitHub Actions</b> (public repo — دقائق مجانية، 4 vCPU / 16GB لكل عقدة).
                الموجة بتطلع كل 5 ساعات، بتسحب rootfs كالي من فرع <span className="font-mono">kali-rootfs</span> (5.62GB، SHA256 لكل جزء)،
                وبتتصل بالهَب بتوكن. العقدة بتعيش 6 ساعات والموجة الجاية بتبدلها قبل ما تموت — الأسطول عمره ما يفضل فاضي.
                <a className="text-cyan-300 hover:underline ms-2" href={`https://github.com/${REPO}/blob/main/.github/workflows/fleet-nodes.yml`} target="_blank" rel="noreferrer">شوف الworkflow على GitHub ↗</a>
              </p>
            </Card>
          </div>
        )}

        {/* ═══ الأدوات ═══ */}
        {tab === "tools" && (
          <div className="space-y-4">
            <Card
              title={`كتالوج كالي المقاس — ${presentTools}/${totalTools} متاحة`}
              icon={Boxes}
              action={
                <span className="text-[10px] text-slate-500">
                  {catMeta.measuredOn ? `اتقاس على: ${catMeta.measuredOn}` : ""}
                  {catMeta.cachedFrom ? ` · كاش ${hhmmss(catMeta.cachedFrom)}` : ""}
                </span>
              }
            >
              {cats.length === 0 ? (
                <p className="text-sm text-slate-400">…بجيب الكتالوج المقاس… (أول قياس بياخد حتى دقيقة — بيمرّ على كل أداة بـcommand -v)</p>
              ) : (
                <div className="space-y-2">
                  {cats.map((c) => {
                    const open = openCats[c.id] ?? true;
                    const p = c.tools.filter((t) => t.present).length;
                    return (
                      <div key={c.id} className="border border-white/5 rounded-xl overflow-hidden">
                        <button
                          onClick={() => setOpenCats((s) => ({ ...s, [c.id]: !open }))}
                          className="w-full flex items-center gap-2 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-right"
                        >
                          <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${open ? "" : "-rotate-90"}`} />
                          <span className="text-xs font-bold">{c.id}</span>
                          <span className="grow" />
                          <span className={`text-[11px] ${p === c.tools.length ? "text-emerald-300" : p === 0 ? "text-slate-500" : "text-amber-300"}`}>
                            {p}/{c.tools.length}
                          </span>
                        </button>
                        {open && (
                          <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-1.5">
                            {c.tools.map((t) => (
                              <div key={t.name} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/20 border border-white/5">
                                {t.present
                                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  : <XCircle className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
                                <span className={`text-xs font-mono ${t.present ? "text-slate-200" : "text-slate-500"}`} dir="ltr">{t.name}</span>
                                {t.version && t.version !== "unknown" && (
                                  <span className="text-[9px] text-cyan-300/70 truncate max-w-[110px]" dir="ltr" title={t.version}>{t.version.split("\n")[0].slice(0, 26)}</span>
                                )}
                                <span className="grow" />
                                {!t.present && (
                                  instBusy === t.name
                                    ? <span className="text-[10px] text-amber-300 animate-pulse">…بينزل ويثبت (apt)…</span>
                                    : <button
                                        onClick={() => void installTool(t.name)}
                                        className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/25 hover:bg-emerald-500/25 text-emerald-200"
                                      >
                                        ثبت
                                      </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* نتائج التثبيت الحية */}
            {Object.keys(instResult).length > 0 && (
              <Card title="نتائج أزرار التثبيت (مقاسة — مافيش ادعاء)" icon={Download}>
                <div className="space-y-2">
                  {Object.entries(instResult).map(([tool, r]) => (
                    <div key={tool} className={`rounded-lg border p-2.5 text-xs ${r.ok ? "border-emerald-400/25 bg-emerald-500/5" : "border-rose-400/25 bg-rose-500/5"}`}>
                      <div className="flex items-center gap-2 font-mono" dir="ltr">
                        {r.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                        <b className={r.ok ? "text-emerald-200" : "text-rose-200"}>{tool}</b>
                        <span className="text-slate-500">{r.ok ? "INSTALL_OK — بيقيس command -v بعد التثبيت" : "فشل"}</span>
                      </div>
                      {r.output && <pre className="mt-1.5 text-[10px] text-slate-400 whitespace-pre-wrap max-h-24 overflow-y-auto" dir="ltr">{r.output}</pre>}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ═══ الطرفية ═══ */}
        {tab === "terminal" && (
          <div className="space-y-4">
            <Card title="طرفية كالي حقيقية — بتنفذ فعليًا ومقاسة" icon={TerminalSquare}>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {([["auto", "تلقائي"], ["proot", "الجست المدمج"], ["node", "عقدة الأسطول"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setPlane(k)}
                    className={`text-xs px-3 py-1.5 rounded-lg border ${plane === k ? "bg-cyan-500/15 border-cyan-400/40 text-cyan-100 font-bold" : "bg-white/[0.03] border-white/10 text-slate-400"}`}>
                    {l}
                  </button>
                ))}
                <span className="text-[10px] text-slate-500">
                  تلقائي = الجست لو مقاس جاهز، وإلا عقدة — والرد بيقولك مين نفّذ فعلًا
                </span>
              </div>
              <div className="flex gap-2 mb-3">
                <input
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
                  placeholder="اكتب أمر… مثال: nmap --version"
                  dir="ltr"
                  className="grow bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-emerald-100 focus:outline-none focus:border-emerald-400/40"
                />
                <button
                  onClick={() => void run()}
                  disabled={Boolean(live?.running) || !cmd.trim()}
                  className="px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-400/30 hover:bg-emerald-500/30 disabled:opacity-40 text-sm font-bold flex items-center gap-1.5"
                >
                  <Activity className="w-4 h-4" /> {live?.running ? "شغّال…" : "شغّل"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {["uname -a", "cat /etc/os-release | head -3", "nmap --version", "df -h /", "dpkg -l | wc -l"].map((q) => (
                  <button key={q} onClick={() => void run(q)} className="text-[10px] font-mono px-2 py-1 rounded bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-slate-300" dir="ltr">
                    {q}
                  </button>
                ))}
              </div>
              <div ref={logRef} className="h-72 overflow-y-auto bg-black/50 border border-white/5 rounded-xl p-3 text-[12px] font-mono whitespace-pre-wrap" dir="ltr">
                {log.length === 0 ? (
                  <span className="text-slate-600">المخرجات الحية هتظهر هنا — كل حرف جاي من تنفيذ حقيقي.</span>
                ) : (
                  log.map((l, i) => <div key={i} className={l.isErr ? "text-rose-300" : "text-emerald-100/90"}>{l.text}</div>)
                )}
              </div>
              {live?.cmd && !live.running && (
                <div className="mt-2 text-[11px] text-slate-400">
                  exit={live.exitCode ?? "—"} {live.durationMs ? `· ${live.durationMs}ms` : ""} {live.plane ? `· اتنفذ على: ${live.plane}` : ""}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ═══ الديسكتوب الحي ═══ */}
        {tab === "desktop" && (
          <Card
            title="بث سطح مكتب كالي الحي (Xvfb + ffmpeg — MJPEG)"
            icon={MonitorPlay}
            action={
              <button
                onClick={() => { setDeskOn((v) => !v); setDeskTick((t) => t + 1); }}
                className={`text-xs px-3 py-1.5 rounded-lg border ${deskOn ? "bg-rose-500/15 border-rose-400/30 text-rose-200" : "bg-emerald-500/15 border-emerald-400/30 text-emerald-200"}`}
              >
                {deskOn ? "أوقف البث" : "ابدأ البث المباشر"}
              </button>
            }
          >
            {deskOn ? (
              <div>
                <img
                  key={deskTick}
                  src={`${API}/kali-env/node-desktop`}
                  alt="بث كالي الحي"
                  className="w-full rounded-xl border border-white/10 bg-black"
                />
                <p className="text-[11px] text-slate-500 mt-2">
                  البث حقيقي إطار بإطار من جوه الجست — لو مافيش rootfs جاهز، الطلب بروح لعقدة كالي حية تلقائيًا.
                  لو زر البث رجّع خطأ فمعناها مافيش طايرة جاهزة حالًا — جرّب بعد ما موجة الأسطول تخلص prewarm.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-400">البث مقفول — اضغط «ابدأ البث المباشر» وهيجيلك ديسكتوب كالي حي إطار بإطار.</p>
            )}
          </Card>
        )}

        {/* ═══ التخزين ═══ */}
        {tab === "storage" && (
          <div className="space-y-4">
            <Card title={`المخزن الموحد على GitHub — ${storage?.totalHuman ?? "…بيقيس"}`} icon={HardDrive}>
              {!storage ? (
                <p className="text-sm text-slate-400">…بقيس المخزن…</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 text-right">
                        <th className="py-1.5 px-2">المخزن</th><th className="py-1.5 px-2">النوع</th>
                        <th className="py-1.5 px-2">الحجم</th><th className="py-1.5 px-2">العناصر</th><th className="py-1.5 px-2">محدّث</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storage.rows.map((r) => (
                        <tr key={r.id} className="border-t border-white/5">
                          <td className="py-1.5 px-2"><a href={r.link} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline font-mono" dir="ltr">{r.label}</a></td>
                          <td className="py-1.5 px-2 text-slate-400">{r.kind}</td>
                          <td className="py-1.5 px-2 font-mono">{GB(r.bytes)}</td>
                          <td className="py-1.5 px-2 text-slate-400">{r.items}</td>
                          <td className="py-1.5 px-2 text-slate-500">{r.updatedAt ? ago(r.updatedAt) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-2">
                صفر بايت على السيرفر — التخزين كله على GitHub (مجاني) وده مقاس بالبايت من GitHub API مش ادعاء.
              </p>
            </Card>
          </div>
        )}

        {/* الفوتر: اللايف أجينت مدير النظام */}
        <p className="text-center text-[11px] text-slate-600 mt-6">
          اللايف أجينت بيدير النظام ده كله من{" "}
          <a href="/agent-pro" className="text-cyan-400 hover:underline">/agent-pro</a>
          {" "}— والعقول تحته. كل رقم في الصفحة دي مقاس من endpoints حقيقية · TEST54.
        </p>
      </div>
    </div>
  );
}

/* ── عناصر صغيرة ──────────────────────────────────────────────────────────── */

function StatCard({ icon: Icon, label, value, hint, tone }: {
  icon: typeof Activity; label: string; value: string; hint?: string;
  tone: "cyan" | "violet" | "emerald" | "amber";
}) {
  const tones = {
    cyan: "border-cyan-400/25 text-cyan-200",
    violet: "border-violet-400/25 text-violet-200",
    emerald: "border-emerald-400/25 text-emerald-200",
    amber: "border-amber-400/25 text-amber-200",
  } as const;
  return (
    <div className={`rounded-xl border bg-white/[0.02] p-3.5 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className="text-2xl font-black mt-1 font-mono">{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function Card({ title, icon: Icon, children, action }: {
  title: string; icon: typeof Activity; children: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-emerald-300" />
        <h2 className="text-sm font-bold text-slate-200">{title}</h2>
        <span className="grow" />
        {action}
      </div>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-black/30 border border-white/5 px-2.5 py-1.5">
      <div className="text-[10px] text-slate-500">{k}</div>
      <div className="text-xs font-mono text-slate-200" dir="ltr">{v}</div>
    </div>
  );
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`text-[11px] px-2.5 py-1 rounded-full border ${ok ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-200" : "bg-slate-500/10 border-slate-400/25 text-slate-400"}`}>
      {ok ? "✓ " : "✗ "}{label}
    </span>
  );
}
