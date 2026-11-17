import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Monitor, Play, RefreshCw, Square, Terminal, Wrench, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { pushNotify } from "@/lib/sse";
import { novaAuthHeaders } from "@/lib/ops-client";
/* TEST38 — لوحة الأنظمة الحقيقية: حالة النظام (CPU/RAM/قرص/عمليات/شبكة/GPU/rootfs)
 * + كتالوج الـ 11 تصنيف رسمي لكل أدوات كالي + تشغيل أداة بضغطة. مكوّن منفصل
 * عشان الصفحة الأصلية تفضل زي ما هي — إضافة فوق الموجود، مش استبدال. */
import KaliSystemsPanel from "./KaliSystemsPanel";

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
type DeployMirror = {
  at?: string;
  reachable?: boolean;
  boot?: { commit?: string; builtAt?: string } | null;
  bootAfter?: { commit?: string; builtAt?: string } | null;
  asset?: { updatedAt?: string; size?: number } | null;
  action?: string;
  fresh?: boolean;
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
  // TEST31 — مرآة النشر الحي: runner بيفحص waifly كل 30د ويدفع state/waifly-deploy.json للمستودع،
  // والصفحة بتقراه بfetch مباشر — المالك يشوف بنية الهَب الشغالة بعينه على الموقع.
  const [deployMirror, setDeployMirror] = useState<DeployMirror | null | "pending">("pending");
  const [deployChecked, setDeployChecked] = useState<string | null>(null);
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
  const [face, setFace] = useState<"system" | "term" | "tools" | "desk" | "store">("system");
  /* TEST35 — the terminal had exactly one plane: the remote Kali node. The
   * local proot guest (the one this page measures two cards above) was never
   * reachable from the input box, so `/api/kali-env/exec` shipped with no
   * consumer at all. `plane` picks where a command actually runs, and the
   * choice is visible on every result line — never implied. */
  const [plane, setPlane] = useState<"auto" | "proot" | "node">("auto");
  /* TEST41 — بث حي من كالي + المخزن الكامل بالتثبيت عند الطلب */
  const [liveOn, setLiveOn] = useState(false);
  const [sysLive, setSysLive] = useState<Record<string, unknown> | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [cat, setCat] = useState<Array<{ id: string; tools: Array<{ name: string; present: boolean; version: string | null }> }> | null>(null);
  const [catQ, setCatQ] = useState("");
  const [instBusy, setInstBusy] = useState<string | null>(null);
  const [instLog, setInstLog] = useState<string[]>([]);
  /* TEST42 — بث سطح المكتب الحي: <img> بيقرا multipart MJPEG من /node-desktop */
  const [deskOn, setDeskOn] = useState(false);
  const [deskTick, setDeskTick] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  /* TEST23 — عقد كالي السحابية: قياس حي كل 20ث من الهَب نفسه (probe عبر قناة الأجينتات) */
  const loadNodes = useCallback(async () => {
    try {
      const r = await fetch(`${API}/ops/kali/nodes`);
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
      // TEST47 — المرآة الحية: الهَب بيقراها سيرفرًا من GitHub API ويخزنها 10د
      // (raw.githubusercontent محجوب على بعض الشبكات في مصر فكانت تعرض
      // «مااتبنتش» كذبًا والمرآة موجودة). بعد الهَب: raw ثم النسخة المحلية.
      const urls = [
        `${API}/ops/deploy-mirror`,
        `https://raw.githubusercontent.com/DawshaX/xFREEDOLLARHACHx/main/state/waifly-deploy.json?t=${Date.now()}`,
        "/state/waifly-deploy.json",
      ];
      for (const u of urls) {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(9000) });
          if (r.ok) { setDeployMirror(await r.json()); setDeployChecked(new Date().toLocaleTimeString("en-GB")); return; }
        } catch { /* المحاولة الجاية */ }
      }
      setDeployMirror(null);
    })();
  }, [loadNodes]);
  useEffect(() => {
    const iv = setInterval(() => void loadNodes(), 20000);
    return () => clearInterval(iv);
  }, [loadNodes]);

  /* TEST24 — المخزن الموحد: «فين اللي عملتو» — مقاس حي كل 60ث */
  const loadStore = useCallback(async () => {
    try {
      const r = await fetch(`${API}/ops/storage-hub`);
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
  useEffect(() => { void loadEnv(false); }, [loadEnv]);

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
      const r = await fetch(`${API}/ops/kali/nodes/install`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
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
      const r = await fetch(`${API}/ops/kali`);
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
      const r = await fetch(`${API}/ops/kali/provision/status`);
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
      const r = await fetch(`${API}/ops/kali/provision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "yes" }) });
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
      const es = new EventSource(`${API}/ops/kali/exec-stream?command=${encodeURIComponent(c)}&timeout=120000`);
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
    <div className="h-full overflow-y-auto p-4 space-y-3" style={{ background: "linear-gradient(180deg,#03000a 0%,#060010 100%)", color: "#e0e0e0" }} dir="rtl">
      {/* الرأس */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-black flex items-center gap-2" style={{ color: "#ff5544", textShadow: "0 0 14px rgba(255,60,40,0.5)" }}>
            🐉 كالي الحقيقية — نظام متثبت على GitHub، بيتشغّل من العقد
          </h1>
          <p className="text-[10px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
            القرص الدايم فرع kali-rootfs (2113 حزمة، مش على سيرفر الموقع). العقدة بتفتح النظام كـ root وتقدر تثبّت أي حزمة بـ apt. اللايف أجينت بيستخدم نفس الطايرة عبر kali_run.
          </p>
        </div>
        <button onClick={() => navigate("/agent-pro")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all"
          style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.4)", color: "#22d3ee" }}>
          <ArrowLeft className="w-3.5 h-3.5" /> افتح اللايف أجينت
        </button>
      </div>

      <div className="rounded-xl p-3" style={{ background: "rgba(255,85,68,0.05)", border: "1px solid rgba(255,85,68,0.35)" }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] font-black" style={{ color: "#ff8866" }}>نظام الجست — قياس حي، مش شكل</p>
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
            className="text-[10px] font-mono px-2 py-1 rounded outline-none flex-1 min-w-[160px]" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,85,68,0.35)", color: "#ffe0d8" }} />
          <button type="submit" disabled={instBusy !== null || !pkgName.trim()} className="text-[9px] font-black px-2.5 py-1 rounded" style={{ background: "rgba(255,85,68,0.16)", border: "1px solid rgba(255,85,68,0.45)", color: "#ff8866", opacity: instBusy || !pkgName.trim() ? 0.5 : 1 }}>
            {instBusy ? `بيثبت ${instBusy}` : "ثبّت جوه كالي"}
          </button>
        </form>
        <p className="text-[8px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          خطأ dpkg «requires superuser privilege» كان لأن proot فاتح من غير -0. التثبيت دلوقتي بيدخل root. لو لسه uid≠0 يبقى الهَب لسه على النسخة القديمة.
        </p>
      </div>

      <div className="sticky top-0 z-20 flex flex-wrap gap-1.5 rounded-xl p-2" style={{ background: "rgba(6,0,16,0.92)", border: "1px solid rgba(255,255,255,0.12)" }}>
        {([
          ["system", "النظام والعقد"],
          ["term", "الطرفية"],
          ["tools", "الأدوات"],
          ["desk", "الديسكتوب"],
          ["store", "المخزن"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFace(id)}
            className="text-[10px] font-black px-2.5 py-1 rounded"
            style={{ background: face === id ? "rgba(255,85,68,0.2)" : "rgba(255,255,255,0.04)", color: face === id ? "#ff8866" : "rgba(255,255,255,0.65)", border: `1px solid ${face === id ? "rgba(255,85,68,0.5)" : "rgba(255,255,255,0.12)"}` }}>
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
                  style={{ background: n.kali ? "rgba(68,255,136,0.1)" : "rgba(255,255,255,0.05)", color: n.kali ? "#44ff88" : "rgba(255,170,68,0.9)" }}>
                  {n.probed ? (n.mode === "bare" ? "نظام كالي ✓" : n.mode === "proot" ? "rootfs كالي سحابية + proot ✓" : "جاهزة للتثبيت — الزر فوق") : "مش بردّ على الprobe"}
                </span>
                <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>متصل من {new Date(n.connectedAt).toLocaleTimeString("en-GB")}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[9px] font-mono mt-2" style={{ color: "rgba(255,170,68,0.85)" }}>
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
            <summary className="text-[9px] font-mono cursor-pointer" style={{ color: "rgba(255,170,68,0.75)" }}>استثناء: تحميل التبيئة محليًا على السيرفر ده (تأكيد مزدوج — خطر على الحصة)</summary>
            <button onClick={startProv} disabled={provBusy || prov?.running === true}
              className="mt-1.5 text-[10px] font-black px-3 py-1.5 rounded-lg"
              style={{ background: "rgba(255,170,68,0.1)", border: "1px solid rgba(255,170,68,0.5)", color: "#ffaa44" }}>
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
            <p className="mt-1 text-[8px] font-mono" style={{ color: live.exitCode === 0 ? "rgba(68,255,136,0.8)" : live.exitCode === null ? "rgba(255,170,68,0.8)" : "#ff8888" }}>
              {live.exitCode === null ? "البث اتقطع" : `exit=${live.exitCode} · ${live.durationMs ?? 0}ms`} — النتيجة كاملة في الطرفية تحت
            </p>
          )}
        </div>
      )}

      {/* TEST30 — إحصائيات الشغل الحقيقي: دايمًا ظاهرة (الأصفار صادقة) — كانت بتتخبي لما total=0
          فالصفحة بقت شكلها «زي ما هي» حتى بعد التحديث. + بصمة البنية تحت عشان المالك يشوف فورًا
          إن الكود اللي شغال على waifly هو آخر build (commit + builtAt من /api/nova-core/version). */}
      <div className="rounded-xl p-3" style={{ background: "rgba(255,170,68,0.04)", border: "1px solid rgba(255,170,68,0.3)" }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] font-black" style={{ color: "#ffaa44" }}>📊 إحصائيات الشغل الحقيقي على كالي — عدّاد من كل تنفيذ فعلًا</p>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(255,170,68,0.1)", color: "#ffc76b" }}>
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

      {/* TEST31 — حالة النشر الحي على waifly: runner بيقيس وبيدفع المرآة — الإثبات بيشوفه عينه */}
      <div className="rounded-xl p-3" style={{ background: "rgba(68,255,136,0.04)", border: `1px solid ${deployMirror && deployMirror !== "pending" && deployMirror.fresh ? "rgba(68,255,136,0.35)" : "rgba(255,170,68,0.3)"}` }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] font-black" style={{ color: "#44ff88" }}>🚀 حالة النشر على nova.waifly.com — فحص runner حي كل 30 دقيقة</p>
          {deployChecked && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.1)", color: "#7cffb0" }}>قرأت المرآة {deployChecked}</span>}
        </div>
        {deployMirror && deployMirror !== "pending" ? (
          <>
            <p className="text-[9px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.65)" }}>
              الهَب شغّال ببنية: <b style={{ color: "#7cffb0" }}>commit {(deployMirror.bootAfter || deployMirror.boot)?.commit?.slice(0, 7) || "؟"} · اتبنت {(deployMirror.bootAfter || deployMirror.boot)?.builtAt || "؟"}</b>
              {" · "}آخر باندل منشور: {deployMirror.asset?.updatedAt || "؟"}
            </p>
            <p className="text-[9px] font-mono mt-1" style={{ color: deployMirror.fresh ? "#44ff88" : "#ffaa44" }}>
              {deployMirror.action === "fresh" && "الهَب شغّال بآخر بنية ✓ — الباندل والعملية متطابقين"}
              {deployMirror.action === "restarted_ok" && "اتصلحت — الهَب كان شغّال ببنية أقدم فأعاد تشغيل نفسه على الباندل الجديد ✓"}
              {deployMirror.action === "updated_ok" && "الباندل الجديد اتسطب واتشغّل أثناء الفحص ✓"}
              {deployMirror.action === "restart_requested" && "إعادة التشغيل اتبعتت للهَب — الفحص الجاي (30د) هيتأكد أنها نفذت"}
              {deployMirror.action === "unreachable" && "الهَب مش متاح للفحص دلوقتي — خطوة الطاقة في الwatchdog بتتكفل بالسقوط الكامل"}
              {deployMirror.action === "none" && "…"}{" · آخر فحص: "}{deployMirror.at || "؟"}
            </p>
          </>
        ) : (
          <p className="text-[9px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
            {deployMirror === "pending" ? "…بجيب مرآة النشر من المستودع" : "مرآة النشر لسه مااتبنتش — أول فحص runner بعد دمج TEST31 هيبنيها (المرآة: state/waifly-deploy.json في المستودع)"}
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
                  style={{ background: "rgba(255,170,68,0.06)", border: "1px dashed rgba(255,170,68,0.35)" }}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-black" style={{ color: instBusy === k ? "#ffd08a" : "rgba(255,170,68,0.9)" }}>{instBusy === k ? "⏳ بتثبت…" : `＋ ${k}`}</span>
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
            <p className="text-[9px] font-mono" style={{ color: "rgba(255,170,68,0.85)" }}>
              القياس بيبدأ تلقائيًا أول ما عقدة كالي تتصل (القسم فوق) — البناء بيعملها بنفسها من فرع kali-rootfs بأدواتها الكاملة.
            </p>
          </>
        )}
      </div>

      </div>

      <div style={{ display: face === "term" ? "block" : "none" }}>
      {/* طرفية التنفيذ الحقيقي — دايمًا ظاهرة: على الهَب أو على العقد السحابية */}
      <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,170,0,0.2)" }}>
        <p className="text-[10px] font-black mb-2 flex items-center gap-1.5" style={{ color: "#ffaa44" }}>
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
                  <div key={i} className="whitespace-pre-wrap break-all leading-relaxed" style={{ color: l.isCmd ? "#ffaa44" : l.isErr ? "#ff6666" : "rgba(255,255,255,0.75)" }}>{l.text}</div>
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
                style={{ background: envHealth.ok ? "rgba(68,255,136,0.12)" : "rgba(255,170,68,0.12)", color: envHealth.ok ? "#44ff88" : "#ffaa44" }}>
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
            <p className="text-[9px] font-mono mt-1.5" style={{ color: envHealth.ok ? "rgba(68,255,136,0.8)" : "rgba(255,170,68,0.85)" }}>
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
                  <span className="text-[8px] font-mono" style={{ color: envTools.fleet.kaliReady > 0 ? "rgba(68,255,136,0.85)" : "rgba(255,170,68,0.8)" }}>
                    أسطول كالي: {envTools.fleet.kaliReady}/{envTools.fleet.connected} عقدة جاهزة
                  </span>
                )}
              </div>
              <div className="mt-1.5 space-y-1.5">
                {Object.entries(envTools.groups).map(([group, g]) => (
                  <div key={group} className="rounded-lg px-2 py-1.5" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[9px] font-black" style={{ color: "#22d3ee" }}>{group}</span>
                      <span className="text-[8px] font-mono" style={{ color: g.missing.length ? "rgba(255,170,68,0.8)" : "rgba(68,255,136,0.8)" }}>
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
            <p className="text-[9px] font-mono mt-1.5" style={{ color: "rgba(255,170,68,0.85)" }}>
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
              <p className="text-[9px] font-mono mt-2" style={{ color: "rgba(255,170,68,0.85)" }}>بيقيس المساحات من جيت هوب…</p>
            )}
          </div>

      </div>

      <div style={{ display: face === "desk" ? "block" : "none" }}>
          {/* ── TEST42 · 🖥️ سطح المكتب الحي — بث MJPEG من عقدة كالي ──────────── */}
          <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,204,0,0.25)" }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] font-black" style={{ color: "#ffcc00" }}>🖥️ سطح المكتب الحي — Xvfb + fluxbox من عقدة كالي (عرض مباشر)</span>
              <div className="flex items-center gap-1.5">
                {deskOn && (
                  <button onClick={() => setDeskTick((t) => t + 1)} className="text-[9px] font-black px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.2)" }}>↻ إعادة توصيل</button>
                )}
                <button onClick={() => setDeskOn((v) => !v)}
                  className="text-[9px] font-black px-2 py-1 rounded transition-all"
                  style={{ background: deskOn ? "rgba(239,68,68,0.15)" : "rgba(255,204,0,0.15)", color: deskOn ? "#ff6b6b" : "#ffcc00", border: `1px solid ${deskOn ? "rgba(239,68,68,0.4)" : "rgba(255,204,0,0.4)"}` }}>
                  {deskOn ? "■ إيقاف البث" : "▶ شغّل سطح المكتب"}
                </button>
              </div>
            </div>
            {deskOn ? (
              <div className="mt-2 rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,204,0,0.25)", background: "#000" }}>
                <img
                  key={deskTick}
                  src={`${API}/kali-env/node-desktop`}
                  alt="بث سطح مكتب كالي الحي"
                  className="w-full block"
                  style={{ maxHeight: 480, objectFit: "contain" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <p className="text-[8px] font-mono px-2 py-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                  🔴 MJPEG لايف عبر الهَب → عقدة كالي · أول تشغيل بينزّل xvfb+ffmpeg داخل الجست (دقيقتين تقريبًا قبل أول إطار) · التفاعل من الطرفية فوق — ده بث مشاهدة
                </p>
              </div>
            ) : (
              <p className="text-[9px] font-mono mt-2" style={{ color: "rgba(255,170,68,0.85)" }}>البث مقفول — اضغط «شغّل سطح المكتب» وهتشوف شاشة كالي لايف من عقدة الأسطول</p>
            )}
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
              <p className="text-[9px] font-mono mt-2" style={{ color: "rgba(255,170,68,0.85)" }}>
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
                        <span className="text-[8px] font-mono" style={{ color: present === shown.length ? "rgba(68,255,136,0.85)" : "rgba(255,170,68,0.8)" }}>
                          {present}/{shown.length} جاهزة
                        </span>
                      </summary>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {shown.map((t) => t.present ? (
                          <span key={t.name} title={t.version ?? ""} className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.1)", color: "#44ff88" }}>✓ {t.name}{t.version ? <span style={{ color: "rgba(68,255,136,0.55)" }}> · {t.version.slice(0, 14)}</span> : null}</span>
                        ) : (
                          <button key={t.name} onClick={() => void installTool(t.name)} disabled={instBusy !== null}
                            className="text-[8px] font-mono px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                            style={{ background: "rgba(255,170,68,0.08)", color: instBusy === t.name ? "#ffd08a" : "rgba(255,255,255,0.55)", border: "1px solid rgba(255,170,68,0.2)" }}>
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
    </div>
  );
}
