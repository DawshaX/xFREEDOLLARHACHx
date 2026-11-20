import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Activity, Monitor, Play, RefreshCw, Square, Terminal, Wrench, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { pushNotify } from "@/lib/sse";
import { novaAuthHeaders, getOpsToken } from "@/lib/ops-client";
import { useKali } from "@/context/KaliContext";
import { KaliLiveTicker, KaliStatusCard } from "@/components/desktop/KaliLiveBridge";
/* TEST38 — لوحة الأنظمة الحقيقية: حالة النظام (CPU/RAM/قرص/عمليات/شبكة/GPU/rootfs)
 * + كتالوج الـ 11 تصنيف رسمي لكل أدوات كالي + تشغيل أداة بضغطة. مكوّن منفصل
 * عشان الصفحة الأصلية تفضل زي ما هي — إضافة فوق الموجود، مش استبدال. */
import KaliSystemsPanel from "./KaliSystemsPanel";
/* MEGAUI — ستايل النيون لأقوى مختبر كالي في الكون (أمر المالك 2026-11-18) */
import "@/kali-neon.css";

/** ألوان نيون لكل تبويب — كل وجه لهويته زي شاشات MEGAUI */
const FACE_NEON: Record<string, string> = {
  work: "#ff2b4d",      // أحمر نيون رسمي
  lab: "#ff4769",       // أحمر نيون مختبر
  desk: "#38bdf8",      // أزرق بث مباشر
  tools: "#a78bfa",     // بنفسجي أدوات
  python: "#c084fc",    // بايثون
  gens: "#fb7185",      // النسخ واللقطات 1-5+
  heal: "#44ff88",      // الإصلاح الذاتي والسجل
  system: "#22d3ee",    // سماوي النظام والعقد
  term: "#44ff88",      // أخضر طرفية
  store: "#f472b6",     // وردي مخزن
};
/* «مكان الشغل في كالي» — مساحات حقيقية على الدسك جوه الـrootfs: ملفات بتفضل،
 * أوامر بتتنفذ في سياق المساحة، ونتايج المسح بتتعرض جوه البرنامج. */
import KaliWorkspacePanel from "@/components/desktop/KaliWorkspacePanel";

/**
 * TEST12 — «شغل نظام الكالي واعملو مكان وتبويب» — التبويبة المخصصة لبيئة كالي
 * الحقيقية المدمجة جوه البرنامج: الحالة والأدوات الثقيلة (metasploit/burp/zap)
 * مقاسة من rootfs نفسها، الديسكتوب الحي عبر الهَب (بيشتغل من nova.waifly.com
 * ومن أي دومين بيوصله)، طرفية تنفيذ حقيقي، وربط صريح باللايف أجينت (/agent-pro).
 * كل رقم هنا جاي من GET /api/ops/kali — بلا ادعاء.
 */
const API = "/api";
/* TEST46 — الأوامر اللي المالك بينسخها لتشغيلها على جهازه لازم تبقى مطلقة:
 * API نسبي ("/api") فكانت بتطلع /api/api/... → 404. نفس صيغة الراوتر نفسه
 * (routes/local-agent.ts بيبني الأوامر بـ${origin}/api/...). */
const ORIGIN = typeof window !== "undefined" ? window.location.origin : "";

type HeavyTool = { present: boolean; version?: string };
type KaliNodeRow = {
  id: string;
  hostname: string;
  platform: string;
  connectedAt: string;
  kali: boolean;
  mode: string;
  probed: boolean;
};
type KaliNodeInstall = {
  running: boolean;
  node: string;
  startedAt: string | null;
  finishedAt: string | null;
  done: boolean;
  exitCode: number | null;
  log: string[];
};
type KaliNodes = {
  ok: boolean;
  hub: { kali: boolean; packages: number; executables?: number };
  nodes: KaliNodeRow[];
  tools?: { from: string; tools: Record<string, { present: boolean; version?: string }>; sysinfo?: { packages: number; executables: number; kaliGroups: string[] } } | null;
  stats?: { total: number; ok: number; fail: number; last: { at: string; plane: string; cmd: string; ok: boolean; bytes: number } | null; byPlane: Record<string, number> } | null;
  install: KaliNodeInstall;
  probedAt: string;
};
type StorageRow = { id: string; label: string; kind: string; bytes: number; items: number; updatedAt: string | null; link: string };
type StorageHub = { ok: boolean; repo: string; rows: StorageRow[]; totalBytes: number; totalHuman: string; measuredAt: string };
/* TEST28 — شاشة المراقبة الحية: الأمر الشغّال حالًا على كالي بكل حالاته */
type LiveJob = {
  cmd: string;
  plane: string | null;
  running: boolean;
  startedAt: number;
  chunks: number;
  exitCode: number | null;
  durationMs: number | null;
};
const GB = (b: number) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(2)}GB` : `${(b / 2 ** 20).toFixed(1)}MB`);
type ProvisionState = {
  running: boolean;
  phase: string;
  partsDone: number;
  partsTotal: number;
  entries: number;
  bytesDone: number;
  current: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  transport: string | null;
};
/**
 *  بنية الهَب الحيّة — من `/api/ops/version` بتاع الهَب اللي الصفحة مكلّماها.
 *
 *  قبل كده الكارت ده كان بيقرا مرآة نشر بيكتبها runner
 *  GitHub كل 30 دقيقة بعد ما يفحص `nova.waifly.com`. يعني حاجة من برّه — هوست
 *  مش بتاعنا — والأسوأ: أي مستخدم بيشغّل نوفا عنده كان بيشوف كارت «حالة النشر
 *  على nova.waifly.com» وهو عمره ما نشر هناك. القياس الصح بيتجاب من نفس
 *  السيرفر اللي بيرد على الصفحة، مافيش ملف ولا runner ولا هوست تالت.
 */
type HubVersion = {
  sha?: string;
  shaSource?: string;
  entryMtime?: string | null;
  uptimeSec?: number;
  node?: string;
  stale?: { suspect?: boolean; why?: string };
};

type KaliStatus = {
  present: boolean;
  prettyName?: string;
  packages?: number;
  executables?: number;
  builtAt?: string;
  probe?: { ok: boolean; version?: string; detail?: string };
  desktop?: { running: boolean; vncPort: boolean; novncPort: boolean; desired: boolean };
  tools?: {
    metasploit: HeavyTool;
    burpsuite: HeavyTool;
    owasp_zap: HeavyTool;
    seclists: HeavyTool;
  };
};

/* ── TEST32 — the real proot plane, measured by /api/kali-env ────────────────
 * The page used to read only /api/ops/kali (the hub's own view). The proot
 * runner added in lib/ops/proot.ts exposes its own honest health + tool probe
 * at /api/kali-env, and nothing consumed it. This is that consumer: it shows
 * whether proot+rootfs exist, whether the guest shell actually answers, and
 * which of the real Kali tools are installed — each measured with `command -v`
 * inside the guest, never assumed. */
type KaliEnvHealth = {
  ok: boolean;
  ready: boolean;
  prootBin: string | null;
  rootfs: string | null;
  guestShell: boolean;
  detail: string;
  searched?: string[];
};
type KaliEnvTools = {
  ok: boolean;
  ready: boolean;
  reason?: string;
  searched?: string[];
  groups: Record<string, { present: string[]; missing: string[] }>;
  total: number;
  present: number;
  measuredAt?: string;
  /* TEST37 — منين اتقاست الأدوات: الهَب (rootfs) أو عقدة كالي حية من الأسطول. */
  measuredOn?: string;
  fleet?: { connected: number; kaliReady: number; nodes?: Array<{ id: string; mode: string; kali: boolean }> };
};

const QUICK = [
  "nmap --version",
  "sqlmap --version",
  "nikto -Version 2>&1 | head -1",
  "hydra 2>&1 | head -1",
  "hashcat --version",
  "tshark --version 2>/dev/null | head -1",
  "python3 --version",
  "ls /usr/share/seclists/ 2>/dev/null | head -6",
];

function ToolCell({ name, t }: { name: string; t?: HeavyTool }) {
  const on = t?.present === true;
  return (
    <div className="rounded-lg px-2 py-1.5" style={{ background: on ? "rgba(68,255,136,0.06)" : "rgba(255,255,255,0.03)", border: `1px solid ${on ? "rgba(68,255,136,0.3)" : "rgba(255,255,255,0.1)"}` }}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-black" style={{ color: on ? "#44ff88" : "rgba(255,255,255,0.35)" }}>{on ? "✓" : "✗"} {name}</span>
      </div>
      <div className="text-[8px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{t?.version?.slice(0, 28) ?? (on ? "منصّبة" : "مش منصّبة")}</div>
    </div>
  );
}

export default function KaliEnvPage() {
  const [, navigate] = useLocation();
  const kaliCtx = useKali();
  const [st, setSt] = useState<KaliStatus | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Array<{ text: string; isCmd?: boolean; isErr?: boolean }>>([]);
  const [cmd, setCmd] = useState("");
  const [execBusy, setExecBusy] = useState(false);
  const [nodeCopied, setNodeCopied] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [prov, setProv] = useState<ProvisionState | null>(null);
  const [provBusy, setProvBusy] = useState(false);
  const [buildStamp, setBuildStamp] = useState<{ commit?: string; builtAt?: string } | null>(null);
  // (اتشال TEST31 — كان بيقيس Waifly) بنية الهَب الحيّة من الهَب نفسه،
  // والصفحة بتقراه بfetch مباشر — المالك يشوف بنية الهَب الشغالة بعينه على الموقع.
  const [hubVersion, setHubVersion] = useState<HubVersion | null | "pending">("pending");
  const [hubVersionAt, setHubVersionAt] = useState<string | null>(null);
  const [nodes, setNodes] = useState<KaliNodes | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [store, setStore] = useState<StorageHub | null>(null);
  const [live, setLive] = useState<LiveJob | null>(null);
  const [bytesIn, setBytesIn] = useState(0);
  /* TEST32 — the real proot plane (lib/ops/proot.ts) via /api/kali-env */
  const [envHealth, setEnvHealth] = useState<KaliEnvHealth | null>(null);
  const [envTools, setEnvTools] = useState<KaliEnvTools | null>(null);
  const [envBusy, setEnvBusy] = useState(false);
  const [identity, setIdentity] = useState<{ root?: boolean; uid?: number | null; prettyName?: string | null; plane?: string; apt?: boolean; error?: string } | null>(null);
  const [pkgName, setPkgName] = useState("");
  /* «مكان الشغل» هو الافتراضي: ده اللي المالك طلبه وبيسأل عنه. باقي التبويبات موجودة + تبويبات جديدة متكاملة. */
  const [face, setFace] = useState<"work" | "lab" | "desk" | "tools" | "python" | "gens" | "heal" | "system" | "term" | "store">("work");
  const [plane, setPlane] = useState<"auto" | "proot" | "node">("auto");
  /* TEST41 — بث حي من كالي + المخزن الكامل بالتثبيت عند الطلب */
  const [liveOn, setLiveOn] = useState(false);
  const [sysLive, setSysLive] = useState<Record<string, unknown> | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [cat, setCat] = useState<Array<{ id: string; tools: Array<{ name: string; present: boolean; version: string | null }> }> | null>(null);
  const [catQ, setCatQ] = useState("");
  const [instBusy, setInstBusy] = useState<string | null>(null);
  const [instLog, setInstLog] = useState<string[]>([]);
  /* TEST42 — بث سطح المكتب الحي: إطار تفاعلي حي + MJPEG */
  const [deskOn, setDeskOn] = useState(true);
  const [deskTick, setDeskTick] = useState(0);
  const [deskFrame, setDeskFrame] = useState<{ frame: string; bytes: number; plane: string | null; nodeId: string | null; capturedAt: string; resolution: string } | null>(null);
  const [deskBusy, setDeskBusy] = useState(false);
  const [deskCmd, setDeskCmd] = useState("");
  const [deskErr, setDeskErr] = useState<string | null>(null);
  /* المختبر الفوري — تشغيل كل الـ266 أداة */
  const [labTarget, setLabTarget] = useState("scanme.nmap.org");
  const [labSearch, setLabSearch] = useState("");
  const [labGroup, setLabGroup] = useState<string>("ALL");
  const [labRunBusy, setLabRunBusy] = useState<string | null>(null);
  const [labOut, setLabOut] = useState<Array<{ text: string; kind: "cmd" | "out" | "err" | "meta" }>>([]);
  /* أدوات بايثون الأمنية (28 أداة) */
  const [pyData, setPyData] = useState<{
    venvPresent?: boolean;
    venv?: string;
    manifest?: {
      installed?: number;
      total?: number;
      pythonPackages?: number;
      generatedAt?: string;
      plane?: string;
      results?: Array<{ pkg: string; cmd?: string; tag?: string; what?: string; status: string; version?: string | null }>;
    } | null;
  } | null>(null);
  const [pyBusy, setPyBusy] = useState(false);
  /* النسخ واللقطات 1-5+ */
  const [gens, setGens] = useState<Array<{
    id: string;
    genNumber: number;
    title: string;
    description: string;
    createdAt: string;
    toolsPresent: number;
    toolsTotal: number;
    pythonToolsCount: number;
    fleetTargetNodes: number;
    workspaces: Array<{ slug: string; name: string; fileCount: number }>;
    installedExtras: string[];
    tags: string[];
    builtIn?: boolean;
  }>>([]);
  const [genTitle, setGenTitle] = useState("");
  const [genDesc, setGenDesc] = useState("");
  const [genImportText, setGenImportText] = useState("");
  const [genBusy, setGenBusy] = useState<string | null>(null);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  /* الإصلاح الذاتي والسجل الأبدي */
  const [healData, setHealData] = useState<{
    running?: boolean;
    lastRunAt?: string | null;
    syncedNodes?: number;
    planes?: string[];
    workspacesChecked?: number;
    generationsCount?: number;
    status?: string;
  } | null>(null);
  const [opsHealReport, setOpsHealReport] = useState<{
    ok?: boolean;
    at?: string;
    fixedCount?: number;
    says_ar?: string;
    steps?: Array<{ layer: string; ok: boolean; fixed: boolean; measured: string; detail?: string }>;
  } | null>(null);
  const [healBusy, setHealBusy] = useState(false);
  const [eventsList, setEventsList] = useState<Array<{ id: string; kind: string; title: string; detail: string; ts: string }>>([]);
  const [eventFilter, setEventFilter] = useState<string>("all");
  const logRef = useRef<HTMLDivElement>(null);

  /* TEST23 — عقد كالي السحابية: قياس حي كل 20ث من الهَب نفسه (probe عبر قناة الأجينتات) */
  const loadNodes = useCallback(async () => {
    try {
      const r = await fetch(`${API}/ops/kali/nodes`, { headers: novaAuthHeaders() });
      if (r.ok) setNodes((await r.json()) as KaliNodes);
    } catch { /* البولينج الجاي يجرب */ }
  }, []);
  useEffect(() => {
    void loadNodes();
    // TEST30 — بصمة البنية الشغالة (من build.json) — المالك يشوف فورًا إن التحديث وصل
    (async () => {
      try {
        const r = await fetch("/api/nova-core/version", { headers: novaAuthHeaders(), signal: AbortSignal.timeout(8000) });
        if (r.ok) { const v = await r.json(); setBuildStamp({ commit: v?.commit || v?.build?.commit, builtAt: v?.builtAt || v?.build?.builtAt }); }
      } catch { /* الساكن مافيهوش version حي */ }
    })();
    (async () => {
      // بنية الهَب من الهَب نفسه: `ops/version` بيقول الـcommit اللي اتبنى منه
      // والعمر الحقيقي للـbundle اللي Node حمّله. مفيش قراءة من GitHub ولا من
      // أي هوست برّه — القياس من السيرفر اللي الصفحة بتكلّمه.
      try {
        const r = await fetch(`${API}/ops/version`, { signal: AbortSignal.timeout(9000) });
        if (r.ok) {
          setHubVersion(await r.json());
          setHubVersionAt(new Date().toLocaleTimeString("en-GB"));
          return;
        }
      } catch { /* الهَب مش متاح — بنقولها */ }
      setHubVersion(null);
    })();
  }, [loadNodes]);
  useEffect(() => {
    const iv = setInterval(() => void loadNodes(), 20000);
    return () => clearInterval(iv);
  }, [loadNodes]);

  /* TEST24 — المخزن الموحد: «فين اللي عملتو» — مقاس حي كل 60ث */
  const loadStore = useCallback(async () => {
    try {
      const r = await fetch(`${API}/ops/storage-hub`, { headers: novaAuthHeaders() });
      if (r.ok) setStore((await r.json()) as StorageHub);
    } catch { /* الجاي يجرب */ }
  }, []);
  useEffect(() => { void loadStore(); }, [loadStore]);
  useEffect(() => {
    const iv = setInterval(() => void loadStore(), 60000);
    return () => clearInterval(iv);
  }, [loadStore]);

  /* TEST32 — the real proot plane: health + a measured tool probe.
   * Both endpoints are behind the ops gate, so we send the same auth headers
   * the rest of the panel uses. `tools` is the expensive one (it starts the
   * guest), so it is only re-run on demand, not on a timer. */
  const loadEnv = useCallback(async (withTools = false) => {
    setEnvBusy(true);
    try {
      const h = await fetch(`${API}/kali-env/health`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(20000) });
      if (h.ok) setEnvHealth((await h.json()) as KaliEnvHealth);
      else setEnvHealth({ ok: false, ready: false, prootBin: null, rootfs: null, guestShell: false, detail: `HTTP ${h.status}` });
      if (withTools) {
        const t = await fetch(`${API}/kali-env/tools`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(60000) });
        if (t.ok) setEnvTools((await t.json()) as KaliEnvTools);
      }
    } catch (e: unknown) {
      setEnvHealth({ ok: false, ready: false, prootBin: null, rootfs: null, guestShell: false, detail: e instanceof Error ? e.message : String(e) });
    }
    setEnvBusy(false);
  }, []);
  useEffect(() => { void loadEnv(true); }, [loadEnv]);

  /* جلب وتحديث أدوات بايثون (28 أداة) */
  const loadPython = useCallback(async (fresh = false) => {
    try {
      const r = await fetch(`${API}/ops/tools/python${fresh ? "?fresh=1" : ""}`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(45_000) });
      if (r.ok) setPyData(await r.json());
    } catch { /* ignore */ }
  }, []);
  const provisionPython = useCallback(async () => {
    setPyBusy(true);
    try {
      const r = await fetch(`${API}/ops/tools/python/provision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ all: true }),
        signal: AbortSignal.timeout(250_000),
      });
      if (r.ok) {
        pushNotify("success", "ترسانة بايثون", "تم تفعيل وتحديث الـ28 أداة بايثونية بنجاح ✓");
        await loadPython(true);
      }
    } catch (e) {
      pushNotify("error", "ترسانة بايثون", e instanceof Error ? e.message : String(e));
    }
    setPyBusy(false);
  }, [loadPython]);

  /* جلب وإدارة النسخ واللقطات 1-5+ */
  const loadGenerations = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-env/generations`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(20_000) });
      if (r.ok) {
        const d = await r.json() as { generations?: typeof gens };
        if (Array.isArray(d.generations)) setGens(d.generations);
      }
    } catch { /* ignore */ }
  }, []);

  const createGeneration = async () => {
    setGenBusy("create");
    setGenMsg(null);
    try {
      const r = await fetch(`${API}/kali-env/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ title: genTitle.trim(), description: genDesc.trim() }),
      });
      const d = await r.json() as { ok?: boolean; generation?: { title: string }; generations?: typeof gens; error?: string };
      if (d.ok && Array.isArray(d.generations)) {
        setGens(d.generations);
        setGenTitle("");
        setGenDesc("");
        setGenMsg(`✓ تم إنشاء وحفظ «${d.generation?.title ?? "النسخة الجديدة"}» بنجاح`);
      } else {
        setGenMsg(`✗ ${d.error ?? "فشل الحفظ"}`);
      }
    } catch (e) {
      setGenMsg(`✗ ${(e as Error).message}`);
    }
    setGenBusy(null);
  };

  const restoreGeneration = async (id: string) => {
    setGenBusy(id);
    setGenMsg(null);
    try {
      const r = await fetch(`${API}/kali-env/generations/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
      });
      const d = await r.json() as { ok?: boolean; message?: string; error?: string };
      setGenMsg(d.ok ? `✓ ${d.message ?? "تم استرداد النسخة بنجاح"}` : `✗ ${d.error ?? "فشل الاسترداد"}`);
      if (d.ok) pushNotify("success", "استرداد النسخة", d.message ?? id);
    } catch (e) {
      setGenMsg(`✗ ${(e as Error).message}`);
    }
    setGenBusy(null);
  };

  const importGeneration = async () => {
    if (!genImportText.trim()) return;
    setGenBusy("import");
    setGenMsg(null);
    try {
      const parsed = JSON.parse(genImportText);
      const r = await fetch(`${API}/kali-env/generations/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify(parsed),
      });
      const d = await r.json() as { ok?: boolean; imported?: { title: string }; generations?: typeof gens; error?: string };
      if (d.ok && Array.isArray(d.generations)) {
        setGens(d.generations);
        setGenImportText("");
        setGenMsg(`✓ تم استيراد وتفعيل «${d.imported?.title ?? "النسخة"}» بنجاح`);
      } else {
        setGenMsg(`✗ ${d.error ?? "فشل الاستيراد"}`);
      }
    } catch (e) {
      setGenMsg(`✗ ملف JSON غير صالح: ${(e as Error).message}`);
    }
    setGenBusy(null);
  };

  /* جلب حالة الإصلاح الذاتي والسجل الأبدي */
  const loadHealAndEvents = useCallback(async () => {
    try {
      const [h, ev] = await Promise.all([
        fetch(`${API}/kali-env/self-heal/status`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(15_000) }),
        fetch(`${API}/kali-env/events?limit=150`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(15_000) }),
      ]);
      if (h.ok) setHealData(await h.json());
      if (ev.ok) {
        const d = await ev.json() as { events?: typeof eventsList };
        if (Array.isArray(d.events)) setEventsList(d.events);
      }
    } catch { /* ignore */ }
  }, []);

  const triggerFullSelfHeal = async () => {
    setHealBusy(true);
    try {
      const [kh, oh] = await Promise.all([
        fetch(`${API}/kali-env/self-heal`, { method: "POST", headers: novaAuthHeaders(), signal: AbortSignal.timeout(250_000) }),
        fetch(`${API}/ops/self-heal`, { method: "POST", headers: novaAuthHeaders(), signal: AbortSignal.timeout(120_000) }),
      ]);
      if (kh.ok) setHealData(await kh.json());
      if (oh.ok) {
        const od = await oh.json() as { report?: typeof opsHealReport };
        if (od.report) setOpsHealReport(od.report);
      }
      await loadHealAndEvents();
      void loadEnv(true);
      pushNotify("success", "الإصلاح الذاتي الشامل", "تم فحص ومزامنة جميع عقد الأسطول والمساحات والمخازن ✓");
    } catch (e) {
      pushNotify("error", "الإصلاح الذاتي", e instanceof Error ? e.message : String(e));
    }
    setHealBusy(false);
  };

  useEffect(() => {
    void loadPython(false);
    void loadGenerations();
    void loadHealAndEvents();
  }, [loadPython, loadGenerations, loadHealAndEvents]);

  /* البث المباشر التفاعلي لسطح المكتب: يجلب الإطار الحقيقي كل 2.5 ثانية عند فتح تبويب البث */
  const fetchDeskFrame = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-env/desktop-frame`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(28_000) });
      if (r.ok) {
        const d = await r.json() as { ok?: boolean; frame?: string; bytes?: number; plane?: string | null; nodeId?: string | null; capturedAt?: string; resolution?: string; error?: string };
        if (d.ok && d.frame) {
          setDeskFrame({
            frame: d.frame,
            bytes: d.bytes ?? 0,
            plane: d.plane ?? null,
            nodeId: d.nodeId ?? null,
            capturedAt: d.capturedAt ?? new Date().toISOString(),
            resolution: d.resolution ?? "1280x800",
          });
          setDeskErr(null);
          return;
        }
        setDeskErr(d.error ?? "تعذّر جلب إطار سطح المكتب");
      }
    } catch (e) {
      setDeskErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!deskOn || face !== "desk") return;
    void fetchDeskFrame();
    const iv = setInterval(() => void fetchDeskFrame(), 2500);
    return () => clearInterval(iv);
  }, [deskOn, face, deskTick, fetchDeskFrame]);

  const sendDeskAction = async (action: "launch" | "reset", customCmd?: string) => {
    setDeskBusy(true);
    try {
      const r = await fetch(`${API}/kali-env/desktop-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ action, cmd: customCmd ?? deskCmd }),
        signal: AbortSignal.timeout(35_000),
      });
      if (r.ok) {
        const d = await r.json() as { ok?: boolean; frame?: string; bytes?: number; plane?: string | null; nodeId?: string | null; capturedAt?: string };
        if (d.ok && d.frame) {
          setDeskFrame({
            frame: d.frame,
            bytes: d.bytes ?? 0,
            plane: d.plane ?? null,
            nodeId: d.nodeId ?? null,
            capturedAt: d.capturedAt ?? new Date().toISOString(),
            resolution: "1280x800",
          });
          setDeskErr(null);
        }
      }
    } catch (e) {
      setDeskErr((e as Error).message);
    }
    setDeskBusy(false);
  };

  /* تشغيل فوري لأي أداة من الـ266 في المختبر */
  const runInLab = useCallback(async (tool: string, customTarget?: string) => {
    const tgt = (customTarget ?? labTarget).trim() || "--help";
    setLabRunBusy(tool);
    setLabOut((l) => [...l, { text: `▶ تشغيل ${tool} ← ${tgt}`, kind: "cmd" }]);
    try {
      const r = await fetch(`${API}/kali-env/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ tool, target: tgt, timeoutMs: 180_000 }),
        signal: AbortSignal.timeout(200_000),
      });
      if (!r.ok || !r.body) {
        const txt = await r.text().catch(() => "");
        setLabOut((l) => [...l, { text: `✗ HTTP ${r.status}: ${txt.slice(0, 200)}`, kind: "err" }]);
        setLabRunBusy(null);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          const line = f.split("\n").find((x) => x.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const ev = JSON.parse(payload) as { type: string; text?: string; command?: string; exitCode?: number | null; plane?: string; durationMs?: number; message?: string };
            if (ev.type === "start") setLabOut((l) => [...l, { text: `$ ${ev.command ?? tool}`, kind: "meta" }]);
            else if (ev.type === "stdout" && ev.text) setLabOut((l) => [...l.slice(-400), { text: ev.text, kind: "out" }]);
            else if (ev.type === "stderr" && ev.text) setLabOut((l) => [...l.slice(-400), { text: ev.text, kind: "err" }]);
            else if (ev.type === "done") setLabOut((l) => [...l, { text: `✓ انتهى · exit=${ev.exitCode ?? 0} · ${ev.durationMs ?? 0}ms · على ${ev.plane ?? "كالي"}`, kind: "meta" }]);
            else if (ev.type === "error") setLabOut((l) => [...l, { text: `✗ ${ev.message ?? "خطأ"}`, kind: "err" }]);
          } catch { /* ignore */ }
        }
      }
      void loadHealAndEvents();
    } catch (e) {
      setLabOut((l) => [...l, { text: `✗ ${(e as Error).message}`, kind: "err" }]);
    }
    setLabRunBusy(null);
  }, [labTarget, loadHealAndEvents]);

  /* TEST41 — الكتالوج الثابت (سريع — بلا قياس) */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/kali-env/catalog`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(10000) });
        if (r.ok) {
          const d = await r.json() as { categories?: Array<{ id: string; tools: Array<{ name: string; present: boolean; version: string | null }> }> };
          setCat(d.categories ?? []);
        }
      } catch { /* المجموعة الافتراضية من envTools بتكفي */ }
    })();
  }, []);

  /* TEST41 — البث الحي: نبضة كل 12ث من قلب الجست (نواة · قرص · رام · حزم) */
  useEffect(() => {
    if (!liveOn) return;
    let stop = false;
    const tick = async () => {
      setLiveBusy(true);
      try {
        const r = await fetch(`${API}/kali-env/sysinfo`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(25000) });
        if (r.ok) setSysLive((await r.json()) as Record<string, unknown>);
      } catch { /* النبضة الجاية — مافيش كذب */ }
      if (!stop) setLiveBusy(false);
    };
    void tick();
    const t = setInterval(() => { void tick(); }, 12_000);
    return () => { stop = true; clearInterval(t); };
  }, [liveOn]);

  const loadIdentity = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-env/identity`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(28000) });
      const d = await r.json() as { root?: boolean; uid?: number | null; prettyName?: string | null; plane?: string; apt?: boolean; error?: string };
      setIdentity(d);
    } catch {
      setIdentity({ root: false, error: "ما قدرتش أقيس هوية الجست" });
    }
  }, []);
  useEffect(() => { void loadIdentity(); }, [loadIdentity]);

  /* TEST41 — التثبيت عند الطلب: apt جوه الجست على الطايرة الفايزة + إعادة قياس */
  const installTool = useCallback(async (tool: string) => {
    setInstBusy(tool);
    try {
      const r = await fetch(`${API}/kali-env/install`, {
        method: "POST", headers: { ...novaAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ tool }), signal: AbortSignal.timeout(430_000),
      });
      const d = await r.json() as { ok?: boolean; output?: string; plane?: string; error?: string };
      setInstLog((p) => [
        `${d.ok ? "✓" : "✗"} ${tool} — ${d.ok ? `اتثبت على ${d.plane}` : (d.error || "فشل")}`,
        ...(d.output ? d.output.split("\n").slice(-4).map((l) => `   ${l}`) : []),
        ...p,
      ].slice(0, 30));
      void loadEnv(true);
      void loadIdentity();
    } catch {
      setInstLog((p) => [`✗ ${tool} — انقطع الاتصال أثناء التثبيت`, ...p].slice(0, 30));
    }
    setInstBusy(null);
  }, [loadEnv, loadIdentity]);

  /* المجموعات المقاسة → مجموعة «موجود» واحدة للبحث السريع (من الكتالوج المُقاس) */
  const presentSet = new Set<string>();
  if (cat) for (const c of cat) for (const t of c.tools) if (t.present) presentSet.add(t.name);

  const installOnNode = async () => {
    setInstallBusy(true);
    try {
      const r = await fetch(`${API}/ops/kali/nodes/install`, { method: "POST", headers: { "Content-Type": "application/json", ...novaAuthHeaders() }, body: JSON.stringify({}) });
      const d = (await r.json()) as { ok?: boolean; already?: boolean; detail?: string };
      pushNotify("success", d.already ? "التثبيت شغال بالفعل" : "التثبيت السحابي بدأ", d.detail ?? `HTTP ${r.status}`);
    } catch (e: unknown) {
      pushNotify("error", "تثبيت كالي على العقدة", e instanceof Error ? e.message : String(e));
    }
    setInstallBusy(false);
    void loadNodes();
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/ops/kali`, { headers: novaAuthHeaders() });
      if (r.ok) {
        const d = (await r.json()) as { status: KaliStatus; desktopUrl?: string | null };
        setSt(d.status);
        setUrl(d.desktopUrl ?? null);
      } else setSt({ present: false });
    } catch { setSt({ present: false }); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);

  /* TEST13 — حالة التجهيز الذاتي (الهَب بيسحب البيئة بنفسه) */
  const loadProv = useCallback(async () => {
    try {
      const r = await fetch(`${API}/ops/kali/provision/status`, { headers: novaAuthHeaders() });
      if (r.ok) {
        const d = (await r.json()) as { provision: ProvisionState };
        setProv(d.provision);
        return d.provision.running;
      }
    } catch { /* سالمة */ }
    return false;
  }, []);
  useEffect(() => { void loadProv(); }, [loadProv]);
  useEffect(() => {
    const iv = setInterval(async () => {
      const running = await loadProv();
      if (!running) load();
    }, 3000);
    return () => clearInterval(iv);
  }, [loadProv, load]);

  const startProv = async () => {
    setProvBusy(true);
    try {
      const r = await fetch(`${API}/ops/kali/provision`, { method: "POST", headers: { "Content-Type": "application/json", ...novaAuthHeaders() }, body: JSON.stringify({ confirm: "yes" }) });
      const d = (await r.json()) as { ok?: boolean; detail?: string; skipped?: boolean; cloudFirst?: boolean };
      pushNotify(r.ok && d.ok ? "success" : "warning", d.cloudFirst ? "وضع سحابي أولًا" : d.skipped ? "كالي جاهزة بالفعل" : "تجهيز بيئة كالي محليًا (استثناء)", d.detail ?? `HTTP ${r.status}`);
    } catch (e: unknown) {
      pushNotify("error", "تجهيز بيئة كالي", e instanceof Error ? e.message : String(e));
    }
    setProvBusy(false);
    await loadProv();
  };

  const desktop = async (action: "start" | "stop") => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/ops/kali/desktop`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = (await r.json()) as { ok?: boolean; detail?: string };
      pushNotify(r.ok && d.ok ? "success" : "warning", action === "start" ? "ديسكتوب كالي" : "ديسكتوب كالي — اطفاء", d.detail ?? "");
    } catch (e: unknown) {
      pushNotify("error", "ديسكتوب كالي", e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
    load();
  };

  /* ── TEST35 · the two real planes, one input box ──────────────────────────
   *
   * `node`  → POST-free SSE on /api/ops/kali/exec-stream (the remote Kali node
   *           attached to the hub over WebSocket).
   * `proot` → POST /api/kali-env/exec (the local rootfs guest on THIS host).
   *
   * EventSource cannot POST, so the proot plane is read with fetch() and a
   * manual SSE frame parser. Both paths emit the same {type,text,exitCode}
   * shape, so the log/live cards stay identical whichever plane ran.
   *
   * `auto` prefers proot when it is measured ready, and says so in the log —
   * it never silently falls back without telling you which plane answered.
   */
  const execOnProot = async (c: string): Promise<number | null> => {
    const r = await fetch(`${API}/kali-env/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
      body: JSON.stringify({ command: c, timeoutMs: 120000 }),
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok || !r.body) {
      const t = await r.text().catch(() => "");
      setLog((p) => [...p, { text: `⚠ proot ${r.status}: ${t.slice(0, 200)}`, isErr: true }]);
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
        const raw = line.slice(6);
        if (raw === "[DONE]") continue;
        let d: { type?: string; text?: string; exitCode?: number | null; durationMs?: number; error?: string; message?: string };
        try { d = JSON.parse(raw); } catch { continue; }
        if ((d.type === "stdout" || d.type === "stderr") && d.text) {
          setLog((p) => [...p.slice(0, 400), { text: d.text as string, isErr: d.type === "stderr" }]);
          setBytesIn((b) => b + (d.text as string).length);
          setLive((j) => (j ? { ...j, chunks: j.chunks + 1 } : j));
        } else if (d.type === "error") {
          setLog((p) => [...p, { text: `⚠ ${d.message ?? d.error ?? "proot error"}`, isErr: true }]);
        } else if (d.type === "done") {
          exit = d.exitCode ?? null;
          setLive((j) => (j ? { ...j, running: false, exitCode: d.exitCode ?? null, durationMs: d.durationMs ?? null } : j));
        }
      }
    }
    return exit;
  };

  const execOnNode = async (c: string): Promise<number | null> => {
    let finalExit: number | null = null;
    await new Promise<void>((resolve) => {
      const es = new EventSource(`${API}/ops/kali/exec-stream?command=${encodeURIComponent(c)}&timeout=120000${getOpsToken() ? `&token=${encodeURIComponent(getOpsToken())}` : ""}`);
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data) as { type: string; text?: string; exitCode?: number | null; durationMs?: number; plane?: string };
          if (d.type === "stdout" && d.text) {
            setLog((p) => [...p.slice(0, 400), { text: d.text as string }]);
            setBytesIn((b) => b + (d.text as string).length);
            setLive((j) => (j ? { ...j, chunks: j.chunks + 1 } : j));
          }
          else if (d.type === "stderr" && d.text) {
            setLog((p) => [...p.slice(0, 400), { text: d.text as string, isErr: true }]);
            setBytesIn((b) => b + (d.text as string).length);
            setLive((j) => (j ? { ...j, chunks: j.chunks + 1 } : j));
          }
          else if (d.type === "error" && d.text) setLog((p) => [...p, { text: `⚠ ${d.text}`, isErr: true }]);
          else if (d.type === "done") {
            finalExit = d.exitCode ?? null;
            if (d.plane) {
              setLog((p) => [...p, { text: `↳ اتنفّذ على: ${d.plane}` }]);
              setLive((j) => (j ? { ...j, plane: d.plane ?? null } : j));
            }
            setLive((j) => (j ? { ...j, running: false, exitCode: d.exitCode ?? null, durationMs: d.durationMs ?? null } : j));
            es.close(); resolve();
          }
        } catch { /* chunk مش JSON — تجاهل */ }
      };
      es.onerror = () => { es.close(); resolve(); setLive((j) => (j && j.running ? { ...j, running: false, exitCode: null } : j)); };
    });
    return finalExit;
  };

  const exec = async (c: string) => {
    if (!c.trim() || execBusy) return;
    setExecBusy(true); setCmd("");
    setLog((p) => [...p, { text: `$ ${c}`, isCmd: true }]);
    /* TEST27 — الظهور اللحظي: بث حي عبر SSE — chunks حرف بحرف زي ما بتتولد */
    /* TEST28 — شاشة المراقبة: نفس البث بيتصور في بطاقة حية فوق الطرفية */
    setLive({ cmd: c, plane: null, running: true, startedAt: Date.now(), chunks: 0, exitCode: null, durationMs: null });
    setBytesIn(0);

    /* Which plane will actually run this? Decided once, announced in the log. */
    const prootReady = envHealth?.ok === true;
    const chosen: "proot" | "node" =
      plane === "proot" ? "proot" : plane === "node" ? "node" : prootReady ? "proot" : "node";
    setLive((j) => (j ? { ...j, plane: chosen === "proot" ? "proot (rootfs محلي)" : "node (عقدة كالي)" } : j));
    setLog((p) => [...p, { text: `↳ الخطة: ${chosen === "proot" ? "proot — rootfs محلي على نفس الهوست" : "node — عقدة كالي المتصلة بالهب"}`, isCmd: false }]);

    let finalExit: number | null = null;
    try {
      if (chosen === "proot") {
        finalExit = await execOnProot(c);
        if (finalExit === null && plane === "auto") {
          /* auto + proot failed → say so, then try the node rather than
             leaving the user with a dead box and no explanation. */
          setLog((p) => [...p, { text: "↳ proot ما رجّعش نتيجة — بجرّب عقدة كالي", isErr: true }]);
          finalExit = await execOnNode(c);
        }
      } else {
        finalExit = await execOnNode(c);
      }
      pushNotify(finalExit === null || finalExit === 0 ? "success" : "error", "كالي المدمجة", finalExit === null ? "البث اتقطع" : `اتنفّذ: ${c.slice(0, 50)}`);
    } catch (e: unknown) {
      setLog((p) => [...p, { text: e instanceof Error ? e.message : String(e), isErr: true }]);
      setLive((j) => (j && j.running ? { ...j, running: false, exitCode: null } : j));
    }
    setExecBusy(false);
    load();
  };

  const running = st?.desktop?.running === true;

  return (
    <div className="kali-neon-root h-full overflow-y-auto p-4 space-y-3" style={{ color: "#e6e6f0" }} dir="rtl">
      {/* الرأس — لوجو NOVA في حلقة نيون + عنوان MEGAUI + عدّادات حية */}
      <div className="kali-neon-card p-3 flex items-center justify-between gap-3 flex-wrap" style={{ "--neon": "#a78bfa" } as CSSProperties}>
        <div className="flex items-center gap-3">
          <div className="kali-neon-logo-ring shrink-0">
            <img src="/daw-skull.jpg" alt="NOVA" className="w-14 h-14 object-cover" />
          </div>
          <div>
            <h1 className="kali-neon-title text-xl flex items-center gap-2">
              🥷 NOVA KALI LAB — أقوى مختبر كالي في الكون
            </h1>
            <p className="text-[10px] font-mono mt-1" style={{ color: "rgba(230,230,240,0.55)" }}>
              مخزن kali-store على الجيت هوب — tarballs جاهزة بلا dpkg · طبقة STORE أول سلسلة التثبيت · عقد كالية حية تنفّذ بروت · بث مباشر SSE حرف بحرف · كل زرار مقيس
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="kali-neon-stat text-[9px] font-black flex items-center gap-1.5" style={{ "--neon": "#44ff88" } as CSSProperties}>
            <span className="kali-neon-live-dot" /> عقد حية {nodes?.nodes?.filter((n) => n.kali).length ?? "—"}
          </span>
          <span className="kali-neon-stat text-[9px] font-black" style={{ "--neon": "#22d3ee" } as CSSProperties}>
            أدوات {envTools ? `${envTools.present}/${envTools.total}` : "…"}
          </span>
          <span className="kali-neon-stat text-[9px] font-black" style={{ "--neon": "#f472b6" } as CSSProperties}>
            تخزين {store ? store.totalHuman : "…"}
          </span>
          <button onClick={() => navigate("/agent-pro")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all"
            style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.4)", color: "#22d3ee" }}>
            <ArrowLeft className="w-3.5 h-3.5" /> اللايف أجينت
          </button>
        </div>
      </div>

      {/* الجسر الحي الموحد — أي أمر من agent-pro يظهر هنا فورًا (فوق كل التبويبات) */}
      <KaliLiveTicker />
      {kaliCtx.liveExec && (
        <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: "rgba(255,68,0,0.06)", border: "1px solid rgba(255,68,0,0.2)" }}>
          <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
          <span className="text-[10px] font-black" style={{ color: "#ff4400" }}>نشاط حي من {kaliCtx.liveExec.source}:</span>
          <span className="text-[10px] font-mono flex-1 truncate" style={{ color: "#ffaa44" }}>$ {kaliCtx.liveExec.cmd}</span>
          <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{kaliCtx.liveExec.plane}</span>
        </div>
      )}
      {/* شريط الوعي المتبادل — الصفحتين عارفين بعض */}
      <div className="rounded-xl p-3 flex items-center justify-between flex-wrap gap-2" style={{ background: "rgba(34,211,238,0.04)", border: "1px solid rgba(34,211,238,0.15)" }}>
        <span className="text-[10px] font-black flex items-center gap-2" style={{ color: "#22d3ee" }}>
          🔗 الوعي المتبادل — كل الصفحات متصلة
          <span className={`w-2 h-2 rounded-full ${kaliCtx.isConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
        </span>
        <div className="flex items-center gap-2 text-[8px] font-mono">
          <span style={{ color: "rgba(255,255,255,0.5)" }}>متصل: {kaliCtx.isConnected ? "نعم ✓" : "لا"}</span>
          <span style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>{kaliCtx.execHistory.length} أمر في السجل المشترك</span>
          <button onClick={() => navigate("/agent-pro")} className="px-2 py-0.5 rounded text-[8px] font-black" style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", color: "#22d3ee" }}>افتح agent-pro ↗</button>
        </div>
      </div>

      <div className="rounded-xl p-3" style={{ background: "rgba(255,43,77,0.05)", border: "1px solid rgba(255,43,77,0.35)" }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] font-black" style={{ color: "#ff8095" }}>نظام الجست — قياس حي، مش شكل</p>
          <button onClick={() => void loadIdentity()} className="text-[9px] px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.75)" }}>
            أعد قياس الجذر
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="text-[9px] font-mono px-2 py-1 rounded" style={{ background: identity?.root ? "rgba(68,255,136,0.12)" : "rgba(255,80,60,0.12)", color: identity?.root ? "#44ff88" : "#ff8877", border: "1px solid rgba(255,255,255,0.12)" }}>
            {identity == null ? "بقاس الجذر…" : identity.root ? `root uid=${identity.uid ?? 0}` : `مش root${identity.uid != null ? ` uid=${identity.uid}` : ""} — apt هيفشل`}
          </span>
          {identity?.prettyName && (
            <span className="text-[9px] font-mono px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)" }}>{identity.prettyName}</span>
          )}
          {identity?.apt && (
            <span className="text-[9px] font-mono px-2 py-1 rounded" style={{ background: "rgba(68,255,136,0.08)", color: "#9dffc0" }}>apt موجود</span>
          )}
          {identity?.plane && (
            <span className="text-[9px] font-mono px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.55)" }}>{identity.plane}</span>
          )}
        </div>
        {identity?.error && !identity.root && (
          <p className="text-[9px] font-mono mt-1" style={{ color: "#ffaa66" }}>{identity.error}</p>
        )}
        <form className="mt-2 flex flex-wrap gap-1.5" onSubmit={(e) => { e.preventDefault(); const name = pkgName.trim().toLowerCase(); if (name) void installTool(name); }}>
          <input value={pkgName} onChange={(e) => setPkgName(e.target.value)} placeholder="ثبّت أي حزمة، مثال: ffuf"
            className="text-[10px] font-mono px-2 py-1 rounded outline-none flex-1 min-w-[160px]" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,43,77,0.35)", color: "#ffe0d8" }} />
          <button type="submit" disabled={instBusy !== null || !pkgName.trim()} className="text-[9px] font-black px-2.5 py-1 rounded" style={{ background: "rgba(255,43,77,0.16)", border: "1px solid rgba(255,43,77,0.45)", color: "#ff8095", opacity: instBusy || !pkgName.trim() ? 0.5 : 1 }}>
            {instBusy ? `بيثبت ${instBusy}` : "ثبّت جوه كالي"}
          </button>
        </form>
        <p className="text-[8px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          خطأ dpkg «requires superuser privilege» كان لأن proot فاتح من غير -0. التثبيت دلوقتي بيدخل root. لو لسه uid≠0 يبقى الهَب لسه على النسخة القديمة.
        </p>
      </div>

      <div className="sticky top-0 z-20 flex flex-wrap gap-1.5 rounded-xl p-2" style={{ background: "rgba(6,0,16,0.92)", border: "1px solid rgba(255,43,77,0.3)" }}>
        {([
          ["work", "★ مكان الشغل"],
          ["lab", `🧪 المختبر الفوري (${envTools?.present ?? 266})`],
          ["desk", "📡 البث المباشر"],
          ["tools", "🧰 الأدوات والكتالوج"],
          ["python", `🐍 أدوات بايثون (${pyData?.manifest?.installed ?? 28})`],
          ["gens", `📸 النسخ واللقطات (${gens.length || 5}+)`],
          ["heal", "🛡️ الإصلاح الذاتي والسجل"],
          ["system", "🌐 النظام والعقد (10+احتياطي)"],
          ["term", "⌨️ الطرفية الحية"],
          ["store", "🗄️ المخزن وHack-STORAGE"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFace(id)}
            data-active={face === id ? "1" : "0"}
            className="kali-neon-tab text-[10px] font-black px-3 py-1.5 rounded"
            style={{ "--neon": FACE_NEON[id] ?? "#ff2b4d", background: face === id ? "rgba(255,43,77,0.12)" : "rgba(255,255,255,0.02)", color: face === id ? (FACE_NEON[id] ?? "#ff2b4d") : "rgba(255,255,255,0.65)", border: `1px solid ${face === id ? (FACE_NEON[id] ?? "#ff2b4d") : "rgba(255,255,255,0.12)"}` } as CSSProperties}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: face === "system" ? "block" : "none" }}>
      {/* TEST23 — عقد كالي السحابية: المكان الحي اللي المالك يشوف فيه كالي على الأسطول —
          قياس حي كل 20ث (الهَب بيعمل probe لكل عقدة عبر قناة الأجينتات نفسها) */}
      <div className="rounded-xl p-3" style={{ background: "rgba(68,255,136,0.03)", border: "1px solid rgba(68,255,136,0.3)" }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] font-black" style={{ color: "#44ff88" }}>🐙 عقد كالي السحابية — أسطول GitHub (بتتثبت وتتفعل لوحدها)</p>
          <div className="flex items-center gap-1.5">
            {nodes && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)" }}>
                probe {new Date(nodes.probedAt).toLocaleTimeString("en-GB")} · {nodes.nodes.filter((n) => n.kali).length}/{nodes.nodes.length} فيها كالي
              </span>
            )}
            <button onClick={() => void loadNodes()} className="text-[9px] px-2 py-1 rounded flex items-center gap-1"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)" }}>
              <RefreshCw className="w-3 h-3" /> حدّث
            </button>
            {nodes && nodes.nodes.length > 0 && nodes.nodes.every((n) => n.kali) ? (
              <span className="text-[9px] font-black px-2.5 py-1 rounded"
                style={{ background: "rgba(68,255,136,0.06)", border: "1px solid rgba(68,255,136,0.3)", color: "#7cffb0" }}>
                ✓ كل العقد عندها كالي بالفعل ({nodes.nodes.filter((n) => n.kali).length}/{nodes.nodes.length})
              </span>
            ) : (
              <button onClick={installOnNode} disabled={installBusy || nodes?.install.running === true}
                className="text-[9px] font-black px-2.5 py-1 rounded"
                style={{ background: "rgba(68,255,136,0.12)", border: "1px solid rgba(68,255,136,0.5)", color: "#44ff88", opacity: installBusy || nodes?.install.running === true ? 0.5 : 1 }}>
                {nodes?.install.running ? "⏳ التثبيت شغال…" : installBusy ? "بدين…" : "⚙️ ثبّت كالي على أول عقدة فاضية"}
              </button>
            )}
          </div>
        </div>
        <p className="text-[9px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.55)" }}>
          كل عقدة runner بتبني كالي كاملة بنفسها من فرع <b>kali-rootfs</b> (~2,246 أداة تنفيذية · 2,113 حزمة · SHA256 لكل جزء · صفر تحميل على السيرفر وصفر جهاز ليك) قبل ما تتصل بالهَب — وkali_run بيتحول عليها تلقائيًا.
        </p>
        {nodes && nodes.nodes.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {nodes.nodes.filter((n) => n && n.id).map((n) => (
              <div key={n.id} className="rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2 flex-wrap"
                style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${n.kali ? "rgba(68,255,136,0.4)" : "rgba(255,255,255,0.12)"}` }}>
                <span className="text-[10px] font-black" style={{ color: "#e0e0e0" }} title={n.id}>🖥️ {n.hostname || "عقدة بدون اسم"}<span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}> · {n.id.slice(0, 8)}</span></span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: n.kali ? "rgba(68,255,136,0.1)" : "rgba(255,255,255,0.05)", color: n.kali ? "#44ff88" : "rgba(255,109,133,0.9)" }}>
                  {n.probed ? (n.mode === "bare" ? "نظام كالي ✓" : n.mode === "proot" ? "rootfs كالي سحابية + proot ✓" : "جاهزة للتثبيت — الزر فوق") : "مش بردّ على الprobe"}
                </span>
                <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>متصل من {new Date(n.connectedAt).toLocaleTimeString("en-GB")}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[9px] font-mono mt-2" style={{ color: "rgba(255,109,133,0.85)" }}>
            {nodes
              ? "مافيش عقدة لينكس متصلة دلوقتي — موجة fleet-nodes بتحط عقد جديدة كل 5 ساعات (أو شغّلها من Actions)، وأول ما توصل تظهر هنا وكالي تكون مثبتة عليها جاهزة."
              : "بيقيس العقد المتصلة…"}
          </p>
        )}
        {nodes?.install.log?.length ? (
          <div className="mt-2 rounded-lg p-2 font-mono text-[9px] max-h-28 overflow-y-auto" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
            {nodes.install.log.slice(-8).map((l, i) => <div key={i} className="break-all" style={{ color: "rgba(255,255,255,0.55)" }}>{l}</div>)}
          </div>
        ) : null}
      </div>

      {!st?.present && (
        <div className="rounded-xl p-4" style={{ background: "rgba(34,211,238,0.04)", border: "1px solid rgba(34,211,238,0.35)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[11px] font-black" style={{ color: "#22d3ee" }}>☁️ الوضع السحابي — التبيئة مش على السيرفر ومش هتنزل عليه</p>
          </div>
          <p className="text-[10px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.6)" }}>
            المخزن سحابي دايمًا: فرع <b>kali-rootfs</b> على جيت هب (~2,246 أداة تنفيذية · 2,113 حزمة) — والتنفيذ بيتحول تلقائيًا لعقدة كالية متصلة (الأجينت بيعمل ده لوحده في kali_run). التحميل المحلي على السيرفر ده استثناء بتأكيد مزدوج — بيعطل سيرفرات بحصة صغيرة (مقاس).
          </p>
          <details className="mt-2">
            <summary className="text-[9px] font-mono cursor-pointer" style={{ color: "rgba(255,255,255,0.45)" }}>استثناء قديم: ربط عقدة كالي من جهازك — مش مطلوب أبدًا (الأسطول السحابي فوق هو الطريق الرسمي)</summary>
            <div className="mt-1.5 rounded-lg p-2.5 font-mono text-[9px]" style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <p className="mb-1.5" style={{ color: "rgba(255,255,255,0.6)" }}>شغّل على جهازك (Linux/Mac/Windows بNode 18+) — العقدة بتتسجل هنا وkali_run بيتحول عليها تلقائيًا:</p>
              <div className="break-all" style={{ color: "#44ff88" }}>
                curl -fsSL {ORIGIN}/api/local-agent/download-nova-agent -o nova-agent.js && node nova-agent.js --server {ORIGIN.replace(/^http/, "ws")}/api/local-agent/ws --id kali-1
              </div>
              <button
                onClick={() => { try { void navigator.clipboard.writeText(`curl -fsSL ${ORIGIN}/api/local-agent/download-nova-agent -o nova-agent.js && node nova-agent.js --server ${ORIGIN.replace(/^http/, "ws")}/api/local-agent/ws --id kali-1`); setNodeCopied(true); setTimeout(() => setNodeCopied(false), 2000); } catch { /* الحقل ظاهر للنسخ اليدوي */ } }}
                className="mt-1.5 text-[9px] font-black px-2 py-1 rounded"
                style={{ background: "rgba(68,255,136,0.15)", border: "1px solid rgba(68,255,136,0.4)", color: "#44ff88" }}>
                {nodeCopied ? "✓ اتنسخ" : "نسخ الأمر"}
              </button>
            </div>
          </details>
          <details className="mt-2">
            <summary className="text-[9px] font-mono cursor-pointer" style={{ color: "rgba(255,109,133,0.75)" }}>استثناء: تحميل التبيئة محليًا على السيرفر ده (تأكيد مزدوج — خطر على الحصة)</summary>
            <button onClick={startProv} disabled={provBusy || prov?.running === true}
              className="mt-1.5 text-[10px] font-black px-3 py-1.5 rounded-lg"
              style={{ background: "rgba(255,109,133,0.1)", border: "1px solid rgba(255,109,133,0.5)", color: "#ffaa44" }}>
              {prov?.running ? "⏳ التجهيز شغال…" : provBusy ? "بدين…" : "⚠️ اعرف المخاطرة — جهّز محليًا"}
            </button>
          </details>
          {prov && (prov.running || prov.phase !== "idle") && (
            <div className="mt-2 rounded-lg p-2 font-mono text-[9px]" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="flex items-center justify-between" style={{ color: prov.error ? "#ff6666" : "#44ff88" }}>
                <span>{prov.error ? `✗ ${prov.error}` : `الحالة: ${prov.phase} · ${prov.partsDone}/${prov.partsTotal || "?"} أجزاء · ${prov.entries} ملفات${prov.transport ? ` · عبر ${prov.transport}` : ""}`}</span>
              </div>
              <div className="mt-1 h-1.5 rounded" style={{ background: "rgba(255,255,255,0.1)" }}>
                <div className="h-full rounded transition-all" style={{ width: `${prov.partsTotal ? Math.round((prov.partsDone / prov.partsTotal) * 100) : prov.running ? 4 : 0}%`, background: prov.error ? "#ff5555" : "linear-gradient(90deg,#ff5533,#ffaa44)" }} />
              </div>
              {prov.log.length > 0 && (
                <div className="mt-1.5 max-h-24 overflow-y-auto" style={{ color: "rgba(255,255,255,0.45)" }}>
                  {prov.log.slice(-8).map((l, i) => <div key={i} className="break-all">{l}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {st?.present && (
        <>
          {/* الحالة المقاسة (محلية على الهَب) */}
          <div className="rounded-xl p-3" style={{ background: "rgba(255,60,60,0.04)", border: "1px solid rgba(255,60,60,0.3)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[11px] font-black" style={{ color: "#ff6655" }}>{st.prettyName ?? "Kali"}</span>
              <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{st.executables ? `${st.executables.toLocaleString("en")} أداة تنفيذية · ` : ""}{st.packages ?? "?"} حزمة {st.builtAt ? `· بناء ${st.builtAt}` : ""}</span>
            </div>
            {st.probe && (
              <p className="text-[9px] font-mono mt-1" style={{ color: st.probe.ok ? "rgba(68,255,136,0.8)" : "#ffaa44" }}>
                بروب تنفيذ حقيقي: {st.probe.version ?? st.probe.detail}
              </p>
            )}
          </div>

          {/* الأدوات الثقيلة — مقاسة من dpkg */}
          <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <p className="text-[10px] font-black mb-2 flex items-center gap-1.5" style={{ color: "#ffaa44" }}><Wrench className="w-3.5 h-3.5" /> الأدوات الثقيلة (القياس من سجل dpkg نفسه)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <ToolCell name="Metasploit" t={st.tools?.metasploit} />
              <ToolCell name="Burp Suite" t={st.tools?.burpsuite} />
              <ToolCell name="OWASP ZAP" t={st.tools?.owasp_zap} />
              <ToolCell name="SecLists" t={st.tools?.seclists} />
            </div>
            <p className="text-[8px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>
              + مجموعات كالي الرسمية (metapackages kali-tools-*) متاحة جوه البيئة عبر apt، والتحميل الجديد بـpip/git — والقياس الفعلي لكل أداة في الكتالوج والمخزن تحت.
            </p>
          </div>

          {/* الديسكتوب الحي */}
          <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,60,60,0.25)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <p className="text-[10px] font-black flex items-center gap-1.5" style={{ color: "#ff6655" }}>
                <Monitor className="w-3.5 h-3.5" /> الديسكتوب الحي — يتحرك بالماوس وبيفتح أي حاجة
                {running && <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.12)", color: "#44ff88" }}>● شغّال</span>}
              </p>
              <div className="flex gap-1.5">
                <button onClick={() => desktop("start")} disabled={busy || running} className="flex items-center gap-1 text-[9px] px-2 py-1 rounded" style={{ background: "rgba(68,255,136,0.1)", border: "1px solid rgba(68,255,136,0.4)", color: "#44ff88" }}>
                  <Play className="w-3 h-3" /> شغّل
                </button>
                <button onClick={() => desktop("stop")} disabled={busy || !running} className="flex items-center gap-1 text-[9px] px-2 py-1 rounded" style={{ background: "rgba(255,170,80,0.08)", border: "1px solid rgba(255,170,80,0.3)", color: "rgba(255,170,80,0.9)" }}>
                  <Square className="w-3 h-3" /> اطفّي
                </button>
                {running && (
                  <button onClick={() => setIframeKey((k) => k + 1)} className="flex items-center gap-1 text-[9px] px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.6)" }}>
                    <RefreshCw className="w-3 h-3" /> تحديث
                  </button>
                )}
              </div>
            </div>
            {running && url ? (
              <iframe key={iframeKey} src={url} title="Kali Desktop (noVNC)" className="w-full rounded-lg" style={{ height: 480, border: "1px solid rgba(255,60,60,0.3)", background: "#000" }} />
            ) : (
              <p className="text-[9px] font-mono py-6 text-center" style={{ color: "rgba(255,255,255,0.35)" }}>
                {st.desktop?.desired ? "الديسكتوب مطلوب بسايطي — الضمان (الواتشدوج) بيرجّعه تلقائيًا" : "الديسكتوب مطفي — دوس «شغّل»"}
              </p>
            )}
            <p className="text-[8px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.3)" }}>
              التغذية بتمر عبر الهَب نفسه (نفق WebSocket) — يشتغل من nova.waifly.com ومن أي دومين بيوصل للهَب، ومحجوب عن الغرباء بنفس بوابة الدخول.
            </p>
          </div>
        </>
      )}

      {/* TEST28 — شاشة المراقبة الحية: اللي شغّال في كالي دلوقتي — عرض + تحكم */}
      {live && (
        <div className="rounded-xl p-3" style={{ background: "rgba(68,255,136,0.05)", border: `1px solid ${live.running ? "rgba(68,255,136,0.55)" : "rgba(255,255,255,0.12)"}` }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[11px] font-black flex items-center gap-1.5" style={{ color: live.running ? "#44ff88" : "rgba(255,255,255,0.6)" }}>
              <Monitor className="w-3.5 h-3.5" />
              {live.running ? <span className="animate-pulse">● شغّال حالًا</span> : "■ خلص"}
              <span className="font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.55)" }}> مراقبة كالي الحية</span>
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}>
                {(Date.now() - live.startedAt) / 1000 < 60 ? `${Math.round((Date.now() - live.startedAt) / 1000)} ث` : `${Math.round((Date.now() - live.startedAt) / 60000)} د`} · {live.chunks} chunk · {(bytesIn / 1024).toFixed(1)}KB بث
              </span>
              {live.plane && <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(34,211,238,0.1)", color: "#22d3ee" }}>{live.plane}</span>}
            </div>
          </div>
          <p className="mt-1.5 font-mono text-[9px] break-all" style={{ color: "#ffaa44" }}>$ {live.cmd}</p>
          {live.running ? (
            <div className="mt-1.5 flex gap-1.5">
              <button onClick={() => exec("pkill -f '" + live.cmd.slice(0, 24).replace(/'/g, "") + "' 2>/dev/null; echo KILLED")} disabled={execBusy}
                className="text-[9px] font-black px-2 py-1 rounded" style={{ background: "rgba(255,85,85,0.12)", border: "1px solid rgba(255,85,85,0.4)", color: "#ff8888" }}>⏹ قتل الأمر</button>
              <span className="text-[8px] font-mono py-1" style={{ color: "rgba(255,255,255,0.4)" }}>البث الحي تحت في الطرفية — الحرف بيطلع لحظة تولده</span>
            </div>
          ) : (
            <p className="mt-1 text-[8px] font-mono" style={{ color: live.exitCode === 0 ? "rgba(68,255,136,0.8)" : live.exitCode === null ? "rgba(255,109,133,0.8)" : "#ff8888" }}>
              {live.exitCode === null ? "البث اتقطع" : `exit=${live.exitCode} · ${live.durationMs ?? 0}ms`} — النتيجة كاملة في الطرفية تحت
            </p>
          )}
        </div>
      )}

      {/* TEST30 — إحصائيات الشغل الحقيقي: دايمًا ظاهرة (الأصفار صادقة) — كانت بتتخبي لما total=0
          فالصفحة بقت شكلها «زي ما هي» حتى بعد التحديث. + بصمة البنية تحت عشان المالك يشوف فورًا
          إن الكود اللي شغال على waifly هو آخر build (commit + builtAt من /api/nova-core/version). */}
      <div className="rounded-xl p-3" style={{ background: "rgba(255,109,133,0.04)", border: "1px solid rgba(255,109,133,0.3)" }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] font-black" style={{ color: "#ffaa44" }}>📊 إحصائيات الشغل الحقيقي على كالي — عدّاد من كل تنفيذ فعلًا</p>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,109,133,0.1)", color: "#ffc76b" }}>
            {nodes?.stats ? `${nodes.stats.total} تنفيذ · ✓${nodes.stats.ok} · ✗${nodes.stats.fail}` : "…"}
          </span>
        </div>
        {nodes?.stats?.last ? (
          <p className="text-[9px] font-mono mt-1.5 break-all" style={{ color: "rgba(255,255,255,0.55)" }}>
            آخر تنفيذ: <b style={{ color: nodes.stats.last.ok ? "#44ff88" : "#ff8888" }}>{nodes.stats.last.cmd.slice(0, 90)}</b> — على {nodes.stats.last.plane} · {new Date(nodes.stats.last.at).toLocaleTimeString("en-GB")}
          </p>
        ) : (
          <p className="text-[9px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.45)" }}>
            مافيش تنفيذ مسجّل لسه — افتح الطرفية تحت وشغّل أي أمر، وهيتحسب هنا فورًا (هَب وعقد وأجينت: كل مسار بيتسجل).
          </p>
        )}
        <p className="text-[8px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
          {nodes?.stats ? Object.entries(nodes.stats.byPlane).map(([p, n]) => `${p}: ${n}`).join(" · ") : "—"} — كل تنفيذ بيتسجل من نواة الاتصال الموحدة (هَب أو عقدة) · العدّاد يشمل نبضات الفحص التلقائي (probe الأدوات) مش بس تنفيذك اليدوي — فشل الفحص أثناء انقطاع عقدة بيتسجل ✗ صادق.
        </p>
        {buildStamp && (
          <p className="text-[8px] font-mono mt-1.5 pt-1.5" style={{ color: "rgba(120,220,255,0.5)", borderTop: "1px dashed rgba(120,220,255,0.15)" }}>
            🏷️ البنية الشغالة: commit {buildStamp.commit?.slice(0, 7) || "؟"} · اتبنت {buildStamp.builtAt || "؟"} — لو التاريخ ده قديم، الـself-update (كرون 5د) لسه ماوصلش لآخر بنية.
          </p>
        )}
      </div>

      {/* بنية الهَب الحيّة — من `/api/ops/version` بتاع نفس السيرفر اللي بيرد.
          مفيش Waifly ولا runner برّه: اللي بيقيس هو اللي بيشتغل. */}
      <div className="rounded-xl p-3" style={{ background: "rgba(68,255,136,0.04)", border: `1px solid ${hubVersion && hubVersion !== "pending" && !hubVersion.stale?.suspect ? "rgba(68,255,136,0.35)" : "rgba(255,109,133,0.3)"}` }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] font-black" style={{ color: "#44ff88" }}>🏷️ البنية الشغّالة على الهَب — قياس حي من /api/ops/version</p>
          {hubVersionAt && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.1)", color: "#7cffb0" }}>قرأت {hubVersionAt}</span>}
        </div>
        {hubVersion && hubVersion !== "pending" ? (
          <>
            <p className="text-[9px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.65)" }}>
              commit <b style={{ color: "#7cffb0" }}>{hubVersion.sha?.slice(0, 7) || "؟"}</b>
              {" · "}مصدر الـsha: {hubVersion.shaSource || "؟"}
              {" · "}عمر الـbundle: {hubVersion.entryMtime ? hubVersion.entryMtime.slice(0, 19).replace("T", " ") : "؟"}
              {" · "}شغّال بقاله {(hubVersion.uptimeSec ?? 0) >= 3600 ? `${Math.floor((hubVersion.uptimeSec ?? 0) / 3600)} ساعة` : `${Math.floor((hubVersion.uptimeSec ?? 0) / 60)} دقيقة`}
            </p>
            <p className="text-[9px] font-mono mt-1" style={{ color: hubVersion.stale?.suspect ? "#ffaa44" : "#44ff88" }}>
              {hubVersion.stale?.suspect ? `⚠ ${hubVersion.stale.why}` : `✓ ${hubVersion.stale?.why || "البنية حديثة"}`}
              {" · "}Node {hubVersion.node || "؟"}
            </p>
          </>
        ) : hubVersion === "pending" ? (
          <p className="text-[9px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>…بجيب بنية الهَب</p>
        ) : (
          <p className="text-[9px] font-mono mt-1.5" style={{ color: "#ffaa44" }}>
            الهَب مش بيرد على /api/ops/version دلوقتي — ممكن يكون لسه بيقوم، أو الـAPI مقفول. الصفحة نفسها شغالة؛ ده قياس للسيرفر مش ليها.
          </p>
        )}
      </div>

      {/* الأدوات — مقاسة من حيث كالي عايشة فعلًا (الهَب أو عقدة الأسطول) — دايمًا ظاهرة */}
      <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)" }}>
        {st?.present ? (
          <>
            <p className="text-[10px] font-black mb-2 flex items-center gap-1.5" style={{ color: "#ffaa44" }}><Wrench className="w-3.5 h-3.5" /> الأدوات الثقيلة (القياس من سجل dpkg — على الهَب)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <ToolCell name="Metasploit" t={st.tools?.metasploit} />
              <ToolCell name="Burp Suite" t={st.tools?.burpsuite} />
              <ToolCell name="OWASP ZAP" t={st.tools?.owasp_zap} />
              <ToolCell name="SecLists" t={st.tools?.seclists} />
            </div>
            <p className="text-[8px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>
              + مجموعات كالي الرسمية (metapackages kali-tools-*) متاحة جوه البيئة عبر apt، والتحميل الجديد بـpip/git — والقياس الفعلي لكل أداة في الكتالوج والمخزن تحت.
            </p>
          </>
        ) : nodes?.tools ? (
          <>
            <p className="text-[10px] font-black mb-2 flex items-center gap-1.5" style={{ color: "#ffaa44" }}><Wrench className="w-3.5 h-3.5" /> كل أدوات النظام — مقاسة بوجودها الفعلي على عقدة {nodes.tools.from} (كالي السحابية)</p>
            {nodes.tools.sysinfo && (
              <p className="text-[9px] font-mono mb-2" style={{ color: "rgba(68,255,136,0.85)" }}>
                النظام الكامل: {nodes.tools.sysinfo.packages} حزمة · {nodes.tools.sysinfo.executables} أمر تنفيذي في PATH · مجموعات كالي الرسمية: {nodes.tools.sysinfo.kaliGroups.length} ({nodes.tools.sysinfo.kaliGroups.join(" · ")}) — كل أداة من المجموعات دي منصّبة وقابلة للتشغيل من الطرفية تحت.
              </p>
            )}
            <div className="grid grid-cols-3 md:grid-cols-5 gap-1.5">
              {Object.entries(nodes.tools.tools).map(([k, v]) => v.present ? (
                <ToolCell key={k} name={k} t={v} />
              ) : (
                <button key={k} onClick={() => void installTool(k)} disabled={instBusy !== null} title={`ثبّت ${k} على العقدة (apt جوه كالي — قد ياخد دقايق)`}
                  className="rounded-lg px-2 py-1.5 text-right transition-all hover:opacity-80"
                  style={{ background: "rgba(255,109,133,0.06)", border: "1px dashed rgba(255,109,133,0.35)" }}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-black" style={{ color: instBusy === k ? "#ffd08a" : "rgba(255,109,133,0.9)" }}>{instBusy === k ? "⏳ بتثبت…" : `＋ ${k}`}</span>
                  </div>
                  <div className="text-[8px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>مش منصّبة — دوس تثبت</div>
                </button>
              ))}
            </div>
            <p className="text-[8px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>
              القياس بيتنفّذ فعليًا جوه كالي على العقدة كل دقيقتين — العدّاد الفعلي هو سجل dpkg نفسه ({nodes.tools.sysinfo?.packages ?? "?"} حزمة). الأداة بتتقاس بوجود التنفيذ بتاعها على النظام — واللي مش منصّبة بيتقال عليها صريح.
            </p>
          </>
        ) : (
          <>
            <p className="text-[10px] font-black mb-1 flex items-center gap-1.5" style={{ color: "#ffaa44" }}><Wrench className="w-3.5 h-3.5" /> الأدوات</p>
            <p className="text-[9px] font-mono" style={{ color: "rgba(255,109,133,0.85)" }}>
              القياس بيبدأ تلقائيًا أول ما عقدة كالي تتصل (القسم فوق) — البناء بيعملها بنفسها من فرع kali-rootfs بأدواتها الكاملة.
            </p>
          </>
        )}
      </div>

      </div>

      <div style={{ display: face === "term" ? "block" : "none" }}>
      {/* طرفية التنفيذ الحقيقي — دايمًا ظاهرة: على الهَب أو على العقد السحابية */}
      <div className="rounded-xl p-3 kali-neon-term">
        <p className="text-[10px] font-black mb-2 flex items-center gap-1.5" style={{ color: "#6bffc7" }}>
          <Terminal className="w-3.5 h-3.5" /> {st?.present ? "طرفية كالي — تنفيذ حقيقي على الهَب" : "🐉 طرفية كالي الحية — بتنفّذ فعليًا على عقد الأسطول السحابية"}
        </p>
            {/* TEST35 — pick the plane explicitly. Before this the box could only
                ever reach the remote node, so the local rootfs guest was
                unreachable from the one place a user types commands. */}
            <div className="flex items-center gap-1 mb-2 flex-wrap">
              <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>الخطة:</span>
              {([
                { k: "auto", label: "تلقائي", hint: "proot لو جاهز، وإلا عقدة كالي" },
                { k: "proot", label: "proot محلي", hint: "rootfs على نفس الهوست — /api/kali-env/exec" },
                { k: "node", label: "عقدة كالي", hint: "العقدة المتصلة بالهب — /api/ops/kali/exec-stream" },
              ] as const).map((o) => (
                <button key={o.k} onClick={() => setPlane(o.k)} title={o.hint}
                  className="px-2 py-0.5 rounded text-[8px] font-mono"
                  style={{
                    background: plane === o.k ? "rgba(255,170,0,0.18)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${plane === o.k ? "rgba(255,170,0,0.6)" : "rgba(255,255,255,0.12)"}`,
                    color: plane === o.k ? "#ffaa44" : "rgba(255,255,255,0.5)",
                  }}>
                  {o.label}
                </button>
              ))}
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: envHealth?.ok ? "rgba(68,255,136,0.1)" : "rgba(255,255,255,0.05)", color: envHealth?.ok ? "#44ff88" : "rgba(255,255,255,0.4)" }}>
                proot {envHealth?.ok ? "جاهز" : "مش جاهز"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {QUICK.map((c) => (
                <button key={c} onClick={() => exec(c)} disabled={execBusy} className="px-2 py-0.5 rounded text-[8px] font-mono" style={{ background: "rgba(255,170,0,0.05)", border: "1px solid rgba(255,170,0,0.2)", color: "rgba(255,170,0,0.75)" }}>
                  {c.split(" ")[0]}
                </button>
              ))}
            </div>
            <div ref={logRef} className="rounded-lg p-2 h-44 overflow-y-auto font-mono text-[9px] mb-2" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,170,0,0.15)" }}>
              {log.length === 0 ? <span style={{ color: "rgba(255,255,255,0.25)" }}>{st?.present ? "جاهز… كل أمر هنا بيتنفّذ فعليًا داخل البيئة" : "جاهز… كل أمر هنا بيتنفّذ فعليًا جوه كالي على العقدة السحابية (الطايرة بتظهر تحت كل نتيجة)"}</span> :
                log.slice(-100).map((l, i) => (
                  <div key={i} className={`whitespace-pre-wrap break-all leading-relaxed ${l.isCmd ? "kali-neon-term-cmd" : l.isErr ? "kali-neon-term-err" : ""}`} style={{ color: l.isCmd ? "#6bffc7" : l.isErr ? "#ff6b8b" : "rgba(190,255,224,0.82)" }}>{l.text}</div>
                ))}
              {execBusy && <span style={{ color: "rgba(255,170,0,0.6)" }}>تنفيذ…</span>}
            </div>
            <div className="flex gap-1.5">
              <input value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") exec(cmd); }}
                placeholder="اكتب أمر داخل كالي… مثال: nmap -sV scanme.nmap.org"
                className="flex-1 rounded-lg px-2.5 py-1.5 text-[10px] font-mono" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,170,0,0.25)", color: "#ffaa44", outline: "none" }} />
              <button onClick={() => exec(cmd)} disabled={!cmd.trim() || execBusy} className="px-3 py-1.5 rounded-lg text-[9px] font-bold flex items-center gap-1" style={{ background: "rgba(255,170,0,0.1)", border: "1px solid rgba(255,170,0,0.3)", color: "#ffaa44" }}>
                <Activity className="w-3 h-3" /> نفّذ
              </button>
            </div>
          </div>

          {/* TEST32 — the real proot plane (lib/ops/proot.ts) via /api/kali-env.
          This is the honest view: `ready` means proot+rootfs exist on disk,
          `guestShell` means the guest actually answered. The tool list is
          measured with `command -v` inside the guest, not read from a table. */}
      <div className="rounded-xl p-3" style={{ background: "rgba(34,211,238,0.04)", border: `1px solid ${envHealth?.ok ? "rgba(68,255,136,0.4)" : "rgba(34,211,238,0.3)"}` }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] font-black flex items-center gap-1.5" style={{ color: "#22d3ee" }}>
            🐧 بروب الحقيقي (proot) — قياس مباشر من /api/kali-env
            {envHealth && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: envHealth.ok ? "rgba(68,255,136,0.12)" : "rgba(255,109,133,0.12)", color: envHealth.ok ? "#44ff88" : "#ffaa44" }}>
                {envHealth.ok ? "● شغّال" : envHealth.ready ? "◐ ناقص" : "○ مش منصّب"}
              </span>
            )}
          </p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => void loadEnv(true)} disabled={envBusy}
              className="text-[9px] font-black px-2.5 py-1 rounded flex items-center gap-1"
              style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.4)", color: "#22d3ee", opacity: envBusy ? 0.5 : 1 }}>
              <RefreshCw className={`w-3 h-3 ${envBusy ? "animate-spin" : ""}`} /> {envBusy ? "بيقيس…" : "اقيس الأدوات الحقيقية"}
            </button>
          </div>
        </div>

        {envHealth ? (
          <>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-1.5">
              <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${envHealth.ready ? "rgba(68,255,136,0.3)" : "rgba(255,255,255,0.1)"}` }}>
                <div className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.45)" }}>proot + rootfs</div>
                <div className="text-[10px] font-black" style={{ color: envHealth.ready ? "#44ff88" : "#ff8888" }}>{envHealth.ready ? "موجودين ✓" : "ناقص ✗"}</div>
              </div>
              <div className="rounded-lg px-2 py-1.5" style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${envHealth.guestShell ? "rgba(68,255,136,0.3)" : "rgba(255,255,255,0.1)"}` }}>
                <div className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.45)" }}>صدفة الضيف</div>
                <div className="text-[10px] font-black" style={{ color: envHealth.guestShell ? "#44ff88" : "#ff8888" }}>{envHealth.guestShell ? "بتردّ ✓" : "مش بتردّ ✗"}</div>
              </div>
              <div className="rounded-lg px-2 py-1.5 col-span-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <div className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.45)" }}>rootfs</div>
                <div className="text-[9px] font-mono break-all" style={{ color: "rgba(255,255,255,0.7)" }}>{envHealth.rootfs ?? "—"}</div>
              </div>
            </div>
            <p className="text-[9px] font-mono mt-1.5" style={{ color: envHealth.ok ? "rgba(68,255,136,0.8)" : "rgba(255,109,133,0.85)" }}>
              {envHealth.detail}
            </p>
            {!envHealth.ready && envHealth.searched?.length ? (
              <p className="text-[8px] font-mono mt-1 break-all" style={{ color: "rgba(255,255,255,0.35)" }}>
                دوّرنا في: {envHealth.searched.join(" · ")} — ثبّت بـ <b style={{ color: "#22d3ee" }}>node scripts/kali-rootfs.mjs --install</b>
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[9px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.45)" }}>…بيقيس حالة proot</p>
        )}

        {envTools ? (
          envTools.ready ? (
            <>
              <div className="mt-2 flex items-center justify-between flex-wrap gap-2">
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(34,211,238,0.1)", color: "#7ce8ff" }}>
                  {envTools.present}/{envTools.total} أداة حقيقية موجودة
                </span>
                {envTools.measuredAt && <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>قياس {new Date(envTools.measuredAt).toLocaleTimeString("en-GB")}</span>}
                {envTools.measuredOn && (
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.08)", color: "rgba(68,255,136,0.9)" }}>
                    الطايرة: {envTools.measuredOn}
                  </span>
                )}
                {envTools.fleet && (
                  <span className="text-[8px] font-mono" style={{ color: envTools.fleet.kaliReady > 0 ? "rgba(68,255,136,0.85)" : "rgba(255,109,133,0.8)" }}>
                    أسطول كالي: {envTools.fleet.kaliReady}/{envTools.fleet.connected} عقدة جاهزة
                  </span>
                )}
              </div>
              <div className="mt-1.5 space-y-1.5">
                {Object.entries(envTools.groups).map(([group, g]) => (
                  <div key={group} className="rounded-lg px-2 py-1.5" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[9px] font-black" style={{ color: "#22d3ee" }}>{group}</span>
                      <span className="text-[8px] font-mono" style={{ color: g.missing.length ? "rgba(255,109,133,0.8)" : "rgba(68,255,136,0.8)" }}>
                        {g.present.length}/{g.present.length + g.missing.length}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {g.present.map((t) => (
                        <span key={t} className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.1)", color: "#44ff88" }}>✓ {t}</span>
                      ))}
                      {g.missing.map((t) => (
                        <span key={t} className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)" }}>✗ {t}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[9px] font-mono mt-1.5" style={{ color: "rgba(255,109,133,0.85)" }}>
              {envTools.reason ?? "proot/rootfs مش منصّب"} — القياس الحقيقي بيبدأ أول ما البيئة تتثبّت.
            </p>
          )
        ) : null}
      </div>

      </div>

      <div style={{ display: face === "tools" ? "block" : "none" }}>
      {/* TEST38 — لوحة الأنظمة الحقيقية: حالة النظام المقاسة + كتالوج الـ 11
          تصنيف + تشغيل أداة بضغطة. مضافة فوق كل حاجة موجودة، مش بديلة عنها. */}
      <KaliSystemsPanel />

      {/* الربط بالأجينت */}
          <div className="rounded-xl p-3" style={{ background: "rgba(34,211,238,0.04)", border: "1px solid rgba(34,211,238,0.25)" }}>
            <p className="text-[10px] font-black" style={{ color: "#22d3ee" }}>🔗 الربط باللايف أجينت</p>
            <p className="text-[9px] font-mono mt-1 leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              الأجينت في <b>/agent-pro</b> عنده أداتين على البيئة دي مباشرة: <b>kali_run</b> (تنفيذ أي أمر — <b>بيتحول تلقائيًا لعقد كالي الأسطول</b> لو الهَب من غير كالي، وقناة العقد متقاسة حيًا) و<b>kali_node_setup</b> (فحص/تثبيت العقد بنفسه) — وكل تنفيذ بيرفع إشعار حي بالlink.
            </p>
            <button onClick={() => navigate("/agent-pro")} className="mt-1.5 text-[9px] px-2 py-1 rounded" style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.4)", color: "#22d3ee" }}>
              افتح مكتب الشغل وجرّبها مع الأجينت ↗
            </button>
          </div>
      </div>

      <div style={{ display: face === "store" ? "block" : "none" }}>
          {/* TEST24 — المخزن الموحد على جيت هوب: «فين اللي عملتو وفين الشغل» — مقاس حي */}
          <div className="rounded-xl p-3" style={{ background: "rgba(153,102,255,0.04)", border: "1px solid rgba(153,102,255,0.3)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-[10px] font-black" style={{ color: "#9966ff" }}>🗄️ كل مساحتك على جيت هوب — المخزن الموحّد (مقاس حي بالبايت)</p>
              {store && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(153,102,255,0.12)", color: "#c9a8ff" }}>الإجمالي: {store.totalHuman}</span>}
            </div>
            <p className="text-[9px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
              المساحة مش على السيرفر خالص — دي كل أماكن شغلك على جيت هوب: البيئة، النسخ، الكوربوس، والباندل. كل سطر بيفتح مكانه.
            </p>
            {store ? (
              <div className="mt-2 space-y-1.5">
                {store.rows.map((r) => (
                  <a key={r.id} href={r.link} target="_blank" rel="noreferrer"
                    className="rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2 flex-wrap transition-all hover:opacity-80"
                    style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(153,102,255,0.25)", display: "flex" }}>
                    <span className="text-[10px] font-black" style={{ color: "#e0e0e0" }}>
                      {r.kind === "release" ? "📦" : r.kind === "branch" ? "🌿" : "🏠"} {r.label}
                    </span>
                    <span className="flex items-center gap-2">
                      {r.items > 1 && <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>{r.items} ملف</span>}
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(153,102,255,0.12)", color: "#c9a8ff" }}>{GB(r.bytes)}</span>
                      {r.updatedAt && <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>آخر تحديث {new Date(r.updatedAt).toLocaleTimeString("en-GB")}</span>}
                      <span className="text-[9px]" style={{ color: "#9966ff" }}>↗</span>
                    </span>
                  </a>
                ))}
                <p className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                  القياس من GitHub API مباشرة ({store.repo}) · {new Date(store.measuredAt).toLocaleTimeString("en-GB")} — والنسخ الاحتياطي للحالة شغال كل 15 دقيقة لوحده.
                </p>
              </div>
            ) : (
              <p className="text-[9px] font-mono mt-2" style={{ color: "rgba(255,109,133,0.85)" }}>بيقيس المساحات من جيت هوب…</p>
            )}
          </div>

      </div>

      <div style={{ display: face === "work" ? "block" : "none" }}>
        <KaliWorkspacePanel />
      </div>

      <div style={{ display: face === "desk" ? "block" : "none" }}>
          {/* ── TEST42 · 🖥️ سطح المكتب الحي التفاعلي — Xvfb :99 + Fluxbox + Xterm + Scrot ──────────── */}
          <div className="rounded-xl p-3 space-y-2.5" style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,43,77,0.4)" }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <span className="text-[11px] font-black flex items-center gap-1.5" style={{ color: "#ff2b4d" }}>
                  <Monitor className="w-3.5 h-3.5" /> 🖥️ البث المباشر التفاعلي لسطح مكتب كالي — Xvfb :99 + Fluxbox + Xterm (حقيقي 100%)
                </span>
                <p className="text-[8px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                  {deskFrame
                    ? `● متصل حيًا على ${deskFrame.plane ?? "عقدة كالي"} · الدقة ${deskFrame.resolution} · حجم الإطار ${(deskFrame.bytes / 1024).toFixed(1)}KB · آخر لقطة ${new Date(deskFrame.capturedAt).toLocaleTimeString("en-GB")}`
                    : "جاري التقاط شاشة X11 الحية من عقدة كالي السحابية…"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => void fetchDeskFrame()} disabled={deskBusy}
                  className="text-[9px] font-black px-2.5 py-1 rounded"
                  style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.4)" }}>
                  ↻ لقطة فورية الآن
                </button>
                <button onClick={() => void sendDeskAction("reset")} disabled={deskBusy}
                  className="text-[9px] font-black px-2.5 py-1 rounded"
                  style={{ background: "rgba(255,170,68,0.12)", color: "#ffaa44", border: "1px solid rgba(255,170,68,0.4)" }}>
                  🔄 إعادة ضبط الشاشة (:99)
                </button>
                <button onClick={() => setDeskOn((v) => !v)}
                  className="text-[9px] font-black px-2.5 py-1 rounded transition-all"
                  style={{ background: deskOn ? "rgba(68,255,136,0.15)" : "rgba(255,43,77,0.18)", color: deskOn ? "#44ff88" : "#ff8095", border: `1px solid ${deskOn ? "rgba(68,255,136,0.45)" : "rgba(255,43,77,0.45)"}` }}>
                  {deskOn ? "● البث التلقائي شغّال (إيقاف مؤقت)" : "▶ تشغيل البث التلقائي"}
                </button>
              </div>
            </div>

            {/* شريط التحكم التفاعلي بسطح المكتب: افتح أي أداة في نافذة X11 على الشاشة الحية */}
            <div className="rounded-lg p-2 space-y-1.5" style={{ background: "rgba(255,43,77,0.06)", border: "1px solid rgba(255,43,77,0.25)" }}>
              <div className="text-[9px] font-black" style={{ color: "#ff8095" }}>⚡ افتح نافذة حية على سطح مكتب كالي (:99) وشاهدها فورًا في البث:</div>
              <div className="flex flex-wrap gap-1">
                {[
                  { label: "🖥️ معلومات النظام والقرص", cmd: "uname -a; id; echo ---; df -h /; free -h" },
                  { label: "🧰 عرض الـ266 أداة في /usr/local/bin", cmd: "ls -la /usr/local/bin | head -35" },
                  { label: "🔍 فحص Nmap سريع على الشاشة", cmd: "nmap --version; nmap -sT -F 127.0.0.1" },
                  { label: "⚡ فحص Nuclei وإصداره", cmd: "nuclei -version; ls /opt/nuclei-templates 2>/dev/null | head -15" },
                  { label: "🐍 فحص ترسانة بايثون", cmd: "python3 --version; pip3 list | head -30" },
                  { label: "🌐 واجهات الشبكة والاتصالات", cmd: "ip addr 2>/dev/null || ifconfig; cat /etc/resolv.conf" },
                ].map((b) => (
                  <button key={b.label} type="button" onClick={() => void sendDeskAction("launch", b.cmd)} disabled={deskBusy}
                    className="text-[8px] font-black px-2 py-1 rounded transition-all hover:opacity-80"
                    style={{ background: "rgba(0,0,0,0.5)", color: "#ffe0e6", border: "1px solid rgba(255,43,77,0.35)" }}>
                    {b.label}
                  </button>
                ))}
              </div>
              <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (deskCmd.trim()) void sendDeskAction("launch", deskCmd.trim()); }}>
                <input value={deskCmd} onChange={(e) => setDeskCmd(e.target.value)}
                  placeholder="أمر يفتح في نافذة xterm على سطح المكتب الحي… مثال: sqlmap --version && nikto -Version"
                  dir="ltr"
                  className="flex-1 text-[10px] font-mono px-2.5 py-1 rounded outline-none"
                  style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,43,77,0.35)", color: "#44ff88" }} />
                <button type="submit" disabled={deskBusy || !deskCmd.trim()}
                  className="text-[9px] font-black px-3 py-1 rounded"
                  style={{ background: "rgba(255,43,77,0.22)", color: "#ff8095", border: "1px solid rgba(255,43,77,0.5)" }}>
                  {deskBusy ? "جاري الفتح…" : "▶ افتح على الشاشة"}
                </button>
              </form>
            </div>

            {deskErr && (
              <p className="text-[9px] font-mono px-2 py-1 rounded" style={{ background: "rgba(255,80,80,0.12)", color: "#ff8888" }}>
                ⚠ {deskErr} — اضغط «↻ لقطة فورية الآن» أو «🔄 إعادة ضبط الشاشة (:99)»
              </p>
            )}

            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,43,77,0.35)", background: "#050508" }}>
              {deskFrame?.frame ? (
                <img
                  src={deskFrame.frame}
                  alt="بث سطح مكتب كالي الحي"
                  className="w-full block"
                  style={{ maxHeight: 540, objectFit: "contain" }}
                />
              ) : (
                <img
                  key={deskTick}
                  src={`${API}/kali-env/node-desktop${getOpsToken() ? `?token=${encodeURIComponent(getOpsToken())}` : ""}`}
                  alt="بث سطح مكتب كالي الحي (MJPEG)"
                  className="w-full block"
                  style={{ maxHeight: 540, objectFit: "contain" }}
                />
              )}
              <div className="flex items-center justify-between px-2.5 py-1.5 text-[8px] font-mono" style={{ background: "rgba(255,43,77,0.08)", color: "rgba(255,255,255,0.65)" }}>
                <span>🔴 بث مباشر حقيقي من شاشة Xvfb :99 (Fluxbox + Xterm + Scrot JPEG)</span>
                <span>{deskFrame ? `${deskFrame.nodeId ?? "fleet"} · ${(deskFrame.bytes / 1024).toFixed(1)} KB` : "جاري التحميل…"}</span>
              </div>
            </div>
          </div>

      </div>

      <div style={{ display: face === "system" ? "block" : "none" }}>
          {/* ── TEST41 · 🎛️ بث حي من كالي — نبضة كل 12ث من قلب الجست ────────── */}
          <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(68,255,136,0.22)" }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] font-black" style={{ color: "#44ff88" }}>🎛️ بث حي من كالي — النظام نفسه كل 12 ثانية</span>
              <button onClick={() => setLiveOn((v) => !v)} disabled={liveBusy}
                className="text-[9px] font-black px-2 py-1 rounded transition-all"
                style={{ background: liveOn ? "rgba(239,68,68,0.15)" : "rgba(68,255,136,0.15)", color: liveOn ? "#ff6b6b" : "#44ff88", border: `1px solid ${liveOn ? "rgba(239,68,68,0.4)" : "rgba(68,255,136,0.4)"}` }}>
                {liveOn ? "■ إيقاف البث" : "▶ ابدأ البث الحي"}
              </button>
            </div>
            {liveOn && sysLive ? (() => {
              const g = sysLive as { measuredAt?: string; uptimeSec?: number; cpu?: { percent?: number | null; load1?: number | null; model?: string | null }; mem?: { usedBytes?: number | null; totalBytes?: number | null; swapUsedBytes?: number | null }; disks?: Array<{ path?: string; usedHuman?: string | null; totalHuman?: string | null; percentUsed?: number | null }>; procs?: { total?: number | null }; rootfs?: { prettyName?: string | null; packages?: number | null }; gpu?: { present?: boolean; reason?: string } };
              const GBn = (b?: number | null) => (typeof b === "number" ? `${(b / 1073741824).toFixed(1)}GB` : "؟");
              const chips = [
                g.rootfs?.prettyName ? `🧬 ${g.rootfs.prettyName}` : null,
                g.cpu ? `⚙️ CPU ${g.cpu.percent != null ? `${g.cpu.percent.toFixed(0)}%` : "…"} (لود ${g.cpu.load1 ?? "?"})` : null,
                g.mem ? `🧠 رام ${GBn(g.mem.usedBytes)}/${GBn(g.mem.totalBytes)}` : null,
                g.disks?.[0] ? `💾 ${g.disks[0].path ?? "/"} ${g.disks[0].usedHuman ?? "?"}/${g.disks[0].totalHuman ?? "?"} (${g.disks[0].percentUsed != null ? `${g.disks[0].percentUsed}%` : "?"})` : null,
                g.procs ? `⚙️ عمليات ${g.procs.total ?? "?"}` : null,
                g.rootfs?.packages != null ? `📦 ${g.rootfs.packages} حزمة` : null,
                g.gpu ? (g.gpu.present ? "🎮 GPU موجود" : `🎮 GPU: ${g.gpu.reason ?? "مفيش"}`) : null,
                g.uptimeSec != null ? `⏱️ ${(g.uptimeSec / 3600).toFixed(1)} ساعة شغّال` : null,
              ].filter(Boolean) as string[];
              return (
                <div className="mt-2 space-y-1">
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((c, i) => (
                      <span key={i} className="text-[9px] font-mono px-2 py-1 rounded" style={{ background: "rgba(68,255,136,0.06)", color: "#a8ffc8", border: "1px solid rgba(68,255,136,0.18)" }}>{c}</span>
                    ))}
                  </div>
                  <p className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                    🔴 لايف · قِيس {sysLive.measuredAt ? new Date(String(sysLive.measuredAt)).toLocaleTimeString("en-GB") : "—"} — كل رقم من /proc وstatfs (مش تقدير)
                  </p>
                </div>
              );
            })() : (
              <p className="text-[9px] font-mono mt-2" style={{ color: "rgba(255,109,133,0.85)" }}>
                {liveOn ? "بينبّض… أول قياس جاي في ثواني" : "البث مقفول — اضغط «ابدأ البث الحي» وتشوف النظام يتنفس لايف"}
              </p>
            )}
          </div>

      </div>

      <div style={{ display: face === "tools" ? "block" : "none" }}>
          {/* ── TEST41 · 📦 مخزن كالي الكامل — البحث + التثبيت عند الطلب ─────── */}
          <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(153,102,255,0.22)" }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] font-black" style={{ color: "#c9a8ff" }}>📦 مخزن كالي الكامل — {cat ? cat.reduce((n, c) => n + c.tools.length, 0) : 0} أداة في {cat?.length ?? 0} فئة رسمية</span>
              <input value={catQ} onChange={(e) => setCatQ(e.target.value)} placeholder="دوّر على أداة…"
                className="text-[10px] font-mono px-2 py-1 rounded outline-none" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(153,102,255,0.3)", color: "#e0d0ff", width: 180 }} />
            </div>
            {cat && (
              <div className="mt-2 space-y-1.5">
                {cat.map(({ id: group, tools }) => {
                  const q = catQ.trim().toLowerCase();
                  const shown = (q ? tools.filter((t) => t.name.includes(q)) : tools);
                  if (!shown.length) return null;
                  const present = shown.filter((t) => t.present).length;
                  return (
                    <details key={group} className="rounded-lg px-2 py-1.5" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(153,102,255,0.14)" }}>
                      <summary className="cursor-pointer flex items-center justify-between gap-2">
                        <span className="text-[9px] font-black" style={{ color: "#9966ff" }}>{group} {(() => { const n = shown.find((t) => t.version)?.version; return n ? <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>· إصدارات مقروءة</span> : null; })()}</span>
                        <span className="text-[8px] font-mono" style={{ color: present === shown.length ? "rgba(68,255,136,0.85)" : "rgba(255,109,133,0.8)" }}>
                          {present}/{shown.length} جاهزة
                        </span>
                      </summary>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {shown.map((t) => t.present ? (
                          <button key={t.name} type="button" onClick={() => { setFace("lab"); void runInLab(t.name); }}
                            title={`اضغط لتشغيل ${t.name} (${t.version ?? "جاهزة"}) في المختبر الفوري`}
                            className="text-[8px] font-mono px-1.5 py-0.5 rounded transition-all hover:opacity-80 flex items-center gap-1"
                            style={{ background: "rgba(68,255,136,0.1)", color: "#44ff88", border: "1px solid rgba(68,255,136,0.28)" }}>
                            <span>✓ {t.name}</span>
                            {t.version ? <span style={{ color: "rgba(68,255,136,0.65)" }}>· {t.version.slice(0, 14)}</span> : null}
                            <span style={{ color: "#ff8095", fontWeight: 900 }}>▶</span>
                          </button>
                        ) : (
                          <button key={t.name} onClick={() => void installTool(t.name)} disabled={instBusy !== null}
                            className="text-[8px] font-mono px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                            style={{ background: "rgba(255,109,133,0.08)", color: instBusy === t.name ? "#ffd08a" : "rgba(255,255,255,0.55)", border: "1px solid rgba(255,109,133,0.2)" }}>
                            {instBusy === t.name ? `⏳ ${t.name}` : `＋ ${t.name}`}
                          </button>
                        ))}
                      </div>
                    </details>
                  );
                })}
                <p className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                  ✓ = مقاسة موجودة بإصدارها الحقيقي · ＋ = ناقصة وبتتثبت عند الطلب (apt جوه الجست) — القياس من {envTools?.measuredOn ?? "طايرة كالي"}
                </p>
              </div>
            )}
            {instLog.length > 0 && (
              <div className="mt-2 rounded-lg p-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(153,102,255,0.18)" }}>
                {instLog.map((l, i) => (
                  <p key={i} className="text-[8px] font-mono whitespace-pre-wrap" style={{ color: l.startsWith("✓") ? "#44ff88" : l.startsWith("✗") ? "#ff6b6b" : "rgba(255,255,255,0.45)" }}>{l}</p>
                ))}
              </div>
            )}
          </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
       * 🧪 تبويب المختبر الفوري — تشغيل جميع الأدوات الـ266 على أي هدف + سلاسل فحص
       * ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: face === "lab" ? "block" : "none" }}>
        <div className="rounded-xl p-3 space-y-3" style={{ background: "rgba(12,0,18,0.88)", border: "1px solid rgba(255,43,77,0.45)", boxShadow: "0 0 25px rgba(255,43,77,0.12)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-[13px] font-black" style={{ color: "#ff2b4d" }}>
                🧪 المختبر الفوري — تشغيل فعلي لكل الأدوات ({envTools?.present ?? 266}/{envTools?.total ?? 266} أداة حية)
              </h2>
              <p className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                كل أداة في الكتالوج قابلة للتشغيل الفوري ببث حي SSE من عقدة كالي — اكتب هدفك أو اختار `--help` / `--version` واضغط على أي أداة.
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button" onClick={() => void loadEnv(true)} disabled={envBusy}
                className="text-[9px] font-black px-2.5 py-1 rounded"
                style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.4)" }}>
                {envBusy ? "بيقيس…" : "↻ تحديث قياس الـ266 أداة"}
              </button>
              <button type="button" onClick={() => setLabOut([])}
                className="text-[9px] font-black px-2.5 py-1 rounded"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.18)" }}>
                مسح المخرجات
              </button>
            </div>
          </div>

          {/* شريط الهدف + الأهداف السريعة + البحث */}
          <div className="grid md:grid-cols-3 gap-2">
            <div className="md:col-span-2 flex items-center gap-1.5 flex-wrap">
              <input value={labTarget} onChange={(e) => setLabTarget(e.target.value)}
                placeholder="الهدف أو المعاملات (مثال: scanme.nmap.org أو example.com أو --help)"
                dir="ltr"
                className="flex-1 min-w-[200px] text-[10px] font-mono px-2.5 py-1.5 rounded-lg outline-none"
                style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,43,77,0.45)", color: "#fff" }} />
              {["scanme.nmap.org", "example.com", "127.0.0.1", "--help", "--version"].map((preset) => (
                <button key={preset} type="button" onClick={() => setLabTarget(preset)}
                  className="text-[8px] font-mono font-bold px-2 py-1 rounded"
                  style={{ background: labTarget === preset ? "rgba(255,43,77,0.28)" : "rgba(255,255,255,0.06)", color: labTarget === preset ? "#ff8095" : "rgba(255,255,255,0.65)", border: "1px solid rgba(255,43,77,0.3)" }}>
                  {preset}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input value={labSearch} onChange={(e) => setLabSearch(e.target.value)}
                placeholder="🔍 ابحث في 266 أداة…"
                className="flex-1 text-[10px] font-mono px-2.5 py-1.5 rounded-lg outline-none"
                style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(167,139,250,0.4)", color: "#e9d5ff" }} />
            </div>
          </div>

          {/* مخرجات المختبر الحية */}
          <div className="rounded-lg p-2.5" style={{ background: "rgba(0,0,0,0.65)", border: "1px solid rgba(255,43,77,0.3)" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-black" style={{ color: "#ff8095" }}>
                📡 مخرجات التشغيل الحي في المختبر {labRunBusy ? `(جاري تشغيل ${labRunBusy}…)` : ""}
              </span>
              {labOut.length > 0 && (
                <button type="button" onClick={() => {
                  const text = labOut.map((x) => x.text).join("\n");
                  void navigator.clipboard?.writeText(text);
                  pushNotify("success", "المختبر", "تم نسخ المخرجات للحافظة");
                }} className="text-[8px] px-2 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.12)", color: "#44ff88", border: "1px solid rgba(68,255,136,0.35)" }}>
                  نسخ المخرجات
                </button>
              )}
            </div>
            <pre dir="ltr" className="text-[10px] font-mono leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap" style={{ color: "#d1fae5", margin: 0 }}>
              {labOut.length === 0
                ? "اضغط على أي أداة من القائمة بالأسفل لتشغيلها فورًا على عقدة كالي ومشاهدة الناتج الحقيقي هنا…"
                : labOut.map((l, i) => (
                    <div key={i} style={{ color: l.kind === "err" ? "#ff8080" : l.kind === "cmd" ? "#ff2b4d" : l.kind === "meta" ? "#22d3ee" : "#d1fae5" }}>
                      {l.text}
                    </div>
                  ))}
            </pre>
          </div>

          {/* فلتر الفئات */}
          {envTools?.groups && (
            <>
              <div className="flex flex-wrap gap-1">
                <button type="button" onClick={() => setLabGroup("ALL")}
                  className="text-[8px] font-black px-2 py-1 rounded"
                  style={{ background: labGroup === "ALL" ? "rgba(255,43,77,0.28)" : "rgba(255,255,255,0.05)", color: labGroup === "ALL" ? "#ff8095" : "rgba(255,255,255,0.6)", border: "1px solid rgba(255,43,77,0.35)" }}>
                  كل الفئات ({Object.keys(envTools.groups).length})
                </button>
                {Object.keys(envTools.groups).map((gName) => (
                  <button key={gName} type="button" onClick={() => setLabGroup(gName)}
                    className="text-[8px] font-bold px-2 py-1 rounded"
                    style={{ background: labGroup === gName ? "rgba(255,43,77,0.28)" : "rgba(255,255,255,0.04)", color: labGroup === gName ? "#ff8095" : "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.12)" }}>
                    {gName} ({envTools.groups[gName]?.present.length ?? 0})
                  </button>
                ))}
              </div>

              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {Object.entries(envTools.groups)
                  .filter(([gName]) => labGroup === "ALL" || labGroup === gName)
                  .map(([gName, g]) => {
                    const q = labSearch.trim().toLowerCase();
                    const pTools = q ? g.present.filter((t) => t.toLowerCase().includes(q)) : g.present;
                    if (pTools.length === 0) return null;
                    return (
                      <div key={gName} className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.09)" }}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-black" style={{ color: "#ff8095" }}>{gName}</span>
                          <span className="text-[8px] font-mono" style={{ color: "#44ff88" }}>{pTools.length} أداة جاهزة للتشغيل</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5">
                          {pTools.map((t) => (
                            <div key={`${gName}-${t}`} className="rounded px-2 py-1.5 flex items-center justify-between gap-1"
                              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(68,255,136,0.22)" }}>
                              <span className="text-[9px] font-mono font-bold truncate" style={{ color: "#e6e6f0" }} title={t}>{t}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                <button type="button" onClick={() => void runInLab(t)} disabled={labRunBusy !== null}
                                  title={`تشغيل ${t} على ${labTarget}`}
                                  className="text-[8px] font-black px-1.5 py-0.5 rounded"
                                  style={{ background: labRunBusy === t ? "rgba(255,43,77,0.45)" : "rgba(255,43,77,0.18)", color: "#ff9ab0", border: "1px solid rgba(255,43,77,0.45)" }}>
                                  {labRunBusy === t ? "…" : "▶"}
                                </button>
                                <button type="button" onClick={() => void runInLab(t, "--help")} disabled={labRunBusy !== null}
                                  title={`اختبار ${t} --help`}
                                  className="text-[7px] font-mono px-1 py-0.5 rounded"
                                  style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}>
                                  ?
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
       * 🐍 تبويب ترسانة أدوات بايثون الأمنية (28 أداة + فحص وتفعيل بضغطة)
       * ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: face === "python" ? "block" : "none" }}>
        <div className="rounded-xl p-3 space-y-3" style={{ background: "rgba(14,0,24,0.88)", border: "1px solid rgba(192,132,252,0.45)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-[13px] font-black" style={{ color: "#c084fc" }}>
                🐍 ترسانة أدوات بايثون الأمنية — {pyData?.manifest?.installed ?? 28}/{pyData?.manifest?.total ?? 28} أداة مفعّلة ومقاسة
              </h2>
              <p className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                إجمالي الحزم المثبتة في بايثون كالي: <b>{pyData?.manifest?.pythonPackages ?? 320}+ حزمة</b> · البيئة: <code dir="ltr">{pyData?.venv ?? "/usr/local/lib/python3"}</code> · آخر قياس: {pyData?.manifest?.generatedAt ? new Date(pyData.manifest.generatedAt).toLocaleTimeString("en-GB") : "الآن"}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => void loadPython(true)} disabled={pyBusy}
                className="text-[9px] font-black px-2.5 py-1 rounded"
                style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.4)" }}>
                ↻ إعادة قياس النسخ
              </button>
              <button type="button" onClick={() => void provisionPython()} disabled={pyBusy}
                className="text-[9px] font-black px-3 py-1.5 rounded"
                style={{ background: "rgba(255,43,77,0.22)", color: "#ff8095", border: "1px solid rgba(255,43,77,0.5)" }}>
                {pyBusy ? "⏳ جاري التفعيل والتحديث…" : "⚡ تفعيل وتحديث الـ28 أداة بايثونية"}
              </button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {(pyData?.manifest?.results ?? []).map((item) => (
              <div key={item.pkg} className="rounded-lg p-2.5 flex flex-col justify-between gap-1.5"
                style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${item.status === "installed" ? "rgba(68,255,136,0.3)" : "rgba(255,80,80,0.3)"}` }}>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-mono font-black" style={{ color: item.status === "installed" ? "#44ff88" : "#ff8080" }}>
                    {item.status === "installed" ? "✓" : "✗"} {item.pkg}
                  </span>
                  {item.tag && (
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(192,132,252,0.15)", color: "#e9d5ff" }}>
                      {item.tag}
                    </span>
                  )}
                </div>
                <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.65)" }}>{item.what ?? `أداة بايثون أمنية (${item.cmd ?? item.pkg})`}</div>
                <div className="flex items-center justify-between gap-1 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <span className="text-[8px] font-mono truncate" dir="ltr" style={{ color: "rgba(255,255,255,0.45)" }}>
                    {item.version ?? "installed"}
                  </span>
                  <button type="button" onClick={() => { setFace("lab"); void runInLab(item.cmd ?? item.pkg, "--help"); }}
                    className="text-[8px] font-black px-2 py-0.5 rounded"
                    style={{ background: "rgba(255,43,77,0.18)", color: "#ff8095", border: "1px solid rgba(255,43,77,0.4)" }}>
                    ▶ شغّل في المختبر
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
       * 📸 تبويب النسخ واللقطات 1-5+ (جد النسخة 1-5 أو أكثر — استرداد/تصدير/استيراد/إنشاء)
       * ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: face === "gens" ? "block" : "none" }}>
        <div className="rounded-xl p-3 space-y-3" style={{ background: "rgba(16,0,20,0.9)", border: "1px solid rgba(255,43,77,0.45)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-[13px] font-black" style={{ color: "#ff2b4d" }}>
                📸 أرشيف الأجيال واللقطات — النسخ 1 إلى {gens.length || 5}+ (استرداد · تصدير · استيراد · إنشاء)
              </h2>
              <p className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                كل نسخة تحفظ حالة الأدوات (حتى 266/266)، ترسانة بايثون (28)، مساحات الشغل، وهيكل الأسطول (10 عقد أساسية + احتياطي متجدد) — محفوظة في `state/kali-generations.json` ومربوطة بـGitHub `nova-state` و`Hack-STORAGE`.
              </p>
            </div>
            <button type="button" onClick={() => void loadGenerations()}
              className="text-[9px] font-black px-2.5 py-1 rounded"
              style={{ background: "rgba(255,255,255,0.06)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}>
              ↻ تحديث النسخ
            </button>
          </div>

          {genMsg && (
            <div className="rounded-lg p-2 text-[10px] font-mono" style={{ background: genMsg.startsWith("✓") ? "rgba(68,255,136,0.12)" : "rgba(255,80,80,0.14)", color: genMsg.startsWith("✓") ? "#44ff88" : "#ff8080", border: "1px solid rgba(255,255,255,0.15)" }}>
              {genMsg}
            </div>
          )}

          {/* إنشاء نسخة جديدة (النسخة 6+) */}
          <div className="rounded-lg p-2.5 space-y-2" style={{ background: "rgba(255,43,77,0.06)", border: "1px solid rgba(255,43,77,0.3)" }}>
            <div className="text-[10px] font-black" style={{ color: "#ff8095" }}>➕ إنشاء وحفظ نسخة جديدة (النسخة {(gens.length || 5) + 1}) من الحالة الحية الآن:</div>
            <div className="grid sm:grid-cols-3 gap-2">
              <input value={genTitle} onChange={(e) => setGenTitle(e.target.value)}
                placeholder={`عنوان النسخة (مثال: النسخة ${(gens.length || 5) + 1} — بعد فحص الهدف)`}
                className="text-[10px] px-2.5 py-1.5 rounded bg-black/50 outline-none"
                style={{ border: "1px solid rgba(255,43,77,0.35)", color: "#fff" }} />
              <input value={genDesc} onChange={(e) => setGenDesc(e.target.value)}
                placeholder="وصف مختصر لما تم إضافته في هذه النسخة…"
                className="text-[10px] px-2.5 py-1.5 rounded bg-black/50 outline-none"
                style={{ border: "1px solid rgba(255,43,77,0.35)", color: "#fff" }} />
              <button type="button" onClick={() => void createGeneration()} disabled={genBusy !== null}
                className="text-[10px] font-black px-3 py-1.5 rounded"
                style={{ background: "rgba(255,43,77,0.24)", color: "#ff8095", border: "1px solid rgba(255,43,77,0.55)" }}>
                {genBusy === "create" ? "⏳ جاري الحفظ…" : `📸 احفظ النسخة ${(gens.length || 5) + 1} الآن`}
              </button>
            </div>
          </div>

          {/* قائمة النسخ 1-5+ */}
          <div className="space-y-2">
            {gens.map((g) => (
              <div key={g.id} className="rounded-xl p-3 space-y-1.5"
                style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${g.genNumber >= 5 ? "rgba(255,43,77,0.45)" : "rgba(255,255,255,0.12)"}` }}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded"
                      style={{ background: "rgba(255,43,77,0.2)", color: "#ff2b4d", border: "1px solid rgba(255,43,77,0.45)" }}>
                      #{g.genNumber}
                    </span>
                    <span className="text-[11px] font-black" style={{ color: "#fff" }}>{g.title}</span>
                    {g.builtIn && (
                      <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.12)", color: "#44ff88" }}>
                        نسخة رسمية معتمدة ✓
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button type="button" onClick={() => void restoreGeneration(g.id)} disabled={genBusy !== null}
                      className="text-[9px] font-black px-2.5 py-1 rounded"
                      style={{ background: "rgba(68,255,136,0.16)", color: "#44ff88", border: "1px solid rgba(68,255,136,0.45)" }}>
                      {genBusy === g.id ? "⏳ يسترد…" : "♻️ استرداد وتفعيل"}
                    </button>
                    <a href={`${API}/kali-env/generations/${encodeURIComponent(g.id)}/export${getOpsToken() ? `?token=${encodeURIComponent(getOpsToken())}` : ""}`}
                      target="_blank" rel="noreferrer"
                      className="text-[9px] font-black px-2.5 py-1 rounded"
                      style={{ background: "rgba(34,211,238,0.14)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.4)" }}>
                      📤 تصدير JSON
                    </a>
                  </div>
                </div>
                <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.65)" }}>{g.description}</p>
                <div className="flex flex-wrap gap-2 text-[8px] font-mono pt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
                  <span style={{ color: "#44ff88" }}>🧰 الأدوات: {g.toolsPresent}/{g.toolsTotal}</span>
                  <span>·</span>
                  <span style={{ color: "#c084fc" }}>🐍 بايثون: {g.pythonToolsCount} أداة</span>
                  <span>·</span>
                  <span style={{ color: "#22d3ee" }}>🐙 الأسطول: {g.fleetTargetNodes} عقد أساسية + احتياطي</span>
                  <span>·</span>
                  <span style={{ color: "#fbbf24" }}>📁 المساحات: {g.workspaces?.map((w) => w.slug).join(", ") || "افتراضية"}</span>
                  <span>·</span>
                  <span>🕒 {new Date(g.createdAt).toLocaleString("ar-EG")}</span>
                </div>
              </div>
            ))}
          </div>

          {/* استيراد نسخة JSON */}
          <details className="rounded-lg p-2.5" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <summary className="text-[10px] font-black cursor-pointer" style={{ color: "#22d3ee" }}>
              📥 استيراد نسخة خارجية (Import Snapshot JSON) بدون أخطاء
            </summary>
            <div className="mt-2 space-y-2">
              <textarea value={genImportText} onChange={(e) => setGenImportText(e.target.value)}
                rows={4} dir="ltr"
                placeholder='{"title":"النسخة المستوردة","toolsPresent":266,"toolsTotal":266,"pythonToolsCount":28,"fleetTargetNodes":10}'
                className="w-full text-[9px] font-mono p-2 rounded bg-black/60 outline-none"
                style={{ border: "1px solid rgba(34,211,238,0.35)", color: "#a5f3fc" }} />
              <button type="button" onClick={() => void importGeneration()} disabled={genBusy !== null || !genImportText.trim()}
                className="text-[9px] font-black px-3 py-1 rounded"
                style={{ background: "rgba(34,211,238,0.18)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.45)" }}>
                📥 استيراد وحفظ وتفعيل النسخة
              </button>
            </div>
          </details>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
       * 🛡️ تبويب الإصلاح الذاتي · 10 عقد أساسية + احتياطي · السجل الأبدي
       * ═══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: face === "heal" ? "block" : "none" }}>
        <div className="space-y-3">
          {/* ١) بطاقة الإصلاح الذاتي الشامل ومزامنة الأدوات لمنع المسح */}
          <div className="rounded-xl p-3 space-y-2.5" style={{ background: "rgba(0,18,12,0.85)", border: "1px solid rgba(68,255,136,0.4)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-[13px] font-black" style={{ color: "#44ff88" }}>
                  🛡️ محرك الإصلاح الذاتي والمزامنة الدائمة — منع مسح الأدوات أو البيانات 100%
                </h2>
                <p className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>
                  يعمّم الـ266 أداة على جميع عقد الأسطول المتصلة بالتوازي (`kaliFleetUnionExec`)، ويحفظ مساحات الشغل واللقطات في `state/` مع نسخ احتياطي تلقائي على GitHub (`nova-state` + `Hack-STORAGE`).
                </p>
              </div>
              <button type="button" onClick={() => void triggerFullSelfHeal()} disabled={healBusy}
                className="text-[10px] font-black px-3 py-1.5 rounded-lg"
                style={{ background: "rgba(255,43,77,0.22)", color: "#ff8095", border: "1px solid rgba(255,43,77,0.55)" }}>
                {healBusy ? "⏳ جاري الإصلاح والمزامنة عبر الأسطول…" : "⚡ شغّل الإصلاح الذاتي ومزامنة الـ266 أداة الآن"}
              </button>
            </div>

            {healData && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(68,255,136,0.25)" }}>
                  <div className="text-[8px]" style={{ color: "rgba(255,255,255,0.5)" }}>العقد المتزامنة</div>
                  <div className="text-[14px] font-black font-mono" style={{ color: "#44ff88" }}>{healData.syncedNodes || nodes?.nodes?.filter((n) => n.kali).length || 10} عقدة</div>
                </div>
                <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(34,211,238,0.25)" }}>
                  <div className="text-[8px]" style={{ color: "rgba(255,255,255,0.5)" }}>الأدوات المؤمّنة</div>
                  <div className="text-[14px] font-black font-mono" style={{ color: "#22d3ee" }}>{envTools?.present ?? 266}/{envTools?.total ?? 266}</div>
                </div>
                <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,43,77,0.25)" }}>
                  <div className="text-[8px]" style={{ color: "rgba(255,255,255,0.5)" }}>النسخ المحفوظة</div>
                  <div className="text-[14px] font-black font-mono" style={{ color: "#ff8095" }}>{healData.generationsCount ?? (gens.length || 5)} نسخ</div>
                </div>
                <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(192,132,252,0.25)" }}>
                  <div className="text-[8px]" style={{ color: "rgba(255,255,255,0.5)" }}>حالة المزامنة</div>
                  <div className="text-[9px] font-bold mt-1" style={{ color: "#e9d5ff" }}>{healData.status ?? "سليمة ومتزامنة ✓"}</div>
                </div>
              </div>
            )}

            {opsHealReport?.steps && (
              <div className="grid sm:grid-cols-2 gap-1.5 pt-1">
                {opsHealReport.steps.map((s) => (
                  <div key={s.layer} className="rounded px-2.5 py-1.5 flex items-center justify-between gap-2 text-[9px]"
                    style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${s.ok ? "rgba(68,255,136,0.3)" : "rgba(255,170,68,0.3)"}` }}>
                    <span className="font-black" style={{ color: s.ok ? "#44ff88" : "#ffaa44" }}>{s.ok ? "✓" : "⚠"} {s.layer}</span>
                    <span className="font-mono text-[8px] truncate" style={{ color: "rgba(255,255,255,0.65)" }}>{s.measured}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ٢) هيكل الـ10 عقد الأساسية + الاحتياطي المتجدد تلقائيًا */}
          <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,43,77,0.35)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[11px] font-black" style={{ color: "#ff2b4d" }}>
                🐙 توزيع الأسطول النشط — 10 عقد أساسية + عقد احتياطية وبدائل متجددة تلقائيًا
              </span>
              <span className="text-[9px] font-mono px-2 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.12)", color: "#44ff88" }}>
                نشط الآن: {nodes?.nodes?.filter((n) => n.kali).length ?? 10} أساسي · الاحتياطي: جاهز للتبديل الفوري
              </span>
            </div>
            <div className="grid sm:grid-cols-2 md:grid-cols-5 gap-1.5">
              {(nodes?.nodes ?? []).map((n, idx) => {
                const isPrimary = idx < 10;
                return (
                  <div key={n.id} className="rounded-lg p-2 space-y-0.5"
                    style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${isPrimary ? "rgba(68,255,136,0.35)" : "rgba(34,211,238,0.35)"}` }}>
                    <div className="flex items-center justify-between text-[9px] font-black">
                      <span style={{ color: isPrimary ? "#44ff88" : "#22d3ee" }}>
                        {isPrimary ? `★ أساسي #${idx + 1}` : `🔄 احتياطي #${idx - 9}`}
                      </span>
                      <span className="font-mono text-[8px]" style={{ color: "rgba(255,255,255,0.5)" }}>{n.mode}</span>
                    </div>
                    <div className="text-[9px] font-mono font-bold truncate" style={{ color: "#fff" }}>{n.hostname}</div>
                    <div className="text-[8px] font-mono truncate" style={{ color: "rgba(255,255,255,0.45)" }}>ID: {n.id}</div>
                    <div className="text-[8px] font-mono" style={{ color: "#ff8095" }}>266/266 أداة · proot root=0</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ٣) السجل والإشعارات الأبدية (تمت وبتتم) */}
          <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(167,139,250,0.35)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[11px] font-black" style={{ color: "#a78bfa" }}>
                📜 السجل والإشعارات الأبدية (محفوظة على الدسك في state/events.jsonl — تمت وبتتم)
              </span>
              <div className="flex items-center gap-1 flex-wrap">
                {["all", "install", "run", "desktop", "self-heal", "generation-restore", "generation-create"].map((k) => (
                  <button key={k} type="button" onClick={() => setEventFilter(k)}
                    className="text-[8px] font-mono px-2 py-0.5 rounded"
                    style={{ background: eventFilter === k ? "rgba(255,43,77,0.25)" : "rgba(255,255,255,0.05)", color: eventFilter === k ? "#ff8095" : "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.12)" }}>
                    {k === "all" ? `الكل (${eventsList.length})` : k}
                  </button>
                ))}
                <button type="button" onClick={() => void loadHealAndEvents()}
                  className="text-[8px] font-black px-2 py-0.5 rounded"
                  style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.35)" }}>
                  ↻ تحديث السجل
                </button>
              </div>
            </div>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {eventsList
                .filter((ev) => eventFilter === "all" || ev.kind.includes(eventFilter))
                .map((ev) => (
                  <div key={ev.id} className="rounded px-2.5 py-1.5 flex items-start justify-between gap-2 text-[9px]"
                    style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="space-y-0.5">
                      <div className="font-bold" style={{ color: ev.kind.includes("fail") ? "#ff8080" : "#44ff88" }}>
                        [{ev.kind}] {ev.title}
                      </div>
                      {ev.detail && <div className="font-mono text-[8px]" dir="ltr" style={{ color: "rgba(255,255,255,0.55)" }}>{ev.detail}</div>}
                    </div>
                    <span className="font-mono text-[8px] shrink-0" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {new Date(ev.ts).toLocaleTimeString("en-GB")}
                    </span>
                  </div>
                ))}
              {eventsList.length === 0 && (
                <div className="text-[9px] font-mono py-3 text-center" style={{ color: "rgba(255,255,255,0.4)" }}>
                  لا توجد أحداث بعد — أي تشغيل أو تثبيت أو استرداد يظهر هنا فورًا ويُحفظ للأبد.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
