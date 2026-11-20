import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, Copy, Check,
  Cpu, FileText, FolderOpen, HardDrive, Layers, Play, Plus, RefreshCw,
  Shield, Terminal, Trash2, Wrench, XCircle, Zap,
} from "lucide-react";
import { novaAuthHeaders } from "@/lib/ops-client";

/**
 * بيئة كالي — لوحة واحدة صادقة
 * ═══════════════════════════════════════════════════════════════════════════════
 * المشكلة اللي الصفحة دي بتحلها
 * ─────────────────────────────
 * كان في ٦ تبويبات (النظام والعقد · الطرفية · الأدوات · الديسكتوب · مكان الشغل
 * · المخزن) وكل تبويب بيحمّل بياناته لوحده، فاللي بيشتغل بيبان في مكان واللي
 * فشل بيبان في مكان تاني، ومفيش رقم واحد يقول «إيه المتاح فعلًا».
 *
 * اللي اتبنى هنا — صفحة واحدة بتجاوب ثلاثة أسئلة بالترتيب:
 *   ١) **البيئة شغالة؟**  → قياس حي: كالي موجودة، كام حزمة، كام أداة تنفيذية،
 *      proot شغّال، قوالب nuclei موجودة، مساحة الدسك.
 *   ٢) **إيه المتاح؟**    → ١٠٠٪ من الكتالوج مقسّم: موجود · بديل شغّال · ناقص
 *      بسبب. مافيش «ناقص» لأداة ليها بديل، وكل بديل مذكور باسمه.
 *   ٣) **أعمل إيه؟**      → مكان الشغل: مساحة، أمر، مخرجات، ملفات، ونتايج
 *      المسح بتفتح جوه الصفحة.
 *
 * القاعدة الحاكمة: **كل رقم هنا جاي من نداء API**. مافيش رقم ثابت في الـJSX،
 * ومفيش «جاري التحميل» بلا نهاية — لو النداء فشل، الصفحة بتقول فشل وليه.
 */

/* ── الأنواع ─────────────────────────────────────────────────────────────── */
type ToolEntry = { name: string; present: boolean; version?: string | null; recipe?: string | null };
type Group = {
  present: string[];
  missing: string[];
  substituted?: { name: string; via: string; why: string }[];
};
type ToolsPayload = {
  ok: boolean;
  ready: boolean;
  total: number;
  present: number;
  groups: Record<string, Group>;
  measuredOn?: string;
  measuredAt?: string;
};
type Health = { ok?: boolean; ready?: boolean; guestShell?: boolean; rootfs?: string; prootBin?: string; detail?: string };
type Identity = { ok?: boolean; prettyName?: string | null; uid?: number | null; apt?: boolean; plane?: string };
type Sysinfo = {
  ok?: boolean;
  host?: { hostname?: string; platform?: string; release?: string; node?: string };
  disk?: { totalGB?: number; freeGB?: number; usedPct?: number };
  mem?: { totalMB?: number; freeMB?: number };
  cpu?: { cores?: number; load1?: number };
};
type WsFile = { name: string; rel: string; bytes: number; mtime: string; kind: "dir" | "file" };
type Ws = {
  slug: string; name: string; guestPath: string; createdAt: string; updatedAt: string;
  files: WsFile[]; fileCount: number; dirBytes: number;
  history: { cmd: string; at: string; exitCode: number | null; ms: number }[];
};
type RunResult = {
  ok: boolean; exitCode: number | null; stdout: string; stderr: string; ms: number;
  newFiles: string[]; workspace: Ws | null; error?: string;
};
type Inventory = {
  ok: boolean; total: number; present: number; missing: string[];
  measuredAt?: string;
  /* ★ `measured:false` ≠ «فشل». معناها السؤال اترد عليه بصدق: مافيش كالي
   *   في المدى. الواجهة لازم تقول السبب المقاس بدل شاشة فشل غامضة. */
  measured?: boolean; reason?: string; measuredOn?: string; ready?: boolean;
  searched?: string[]; fleet?: { connected: number; kaliReady: number };
  tools: { name: string; present: boolean; version: string | null }[];
};
type PyTools = {
  ok: boolean; venvPresent: boolean;
  manifest?: { installed?: number; total?: number; pythonPackages?: number; generatedAt?: string; results?: { pkg: string; status: string; version?: string | null; why?: string }[] } | null;
  hint?: string | null;
};

const API = "/api";

function human(b: number): string {
  if (!b) return "0";
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}
function num(n?: number | null): string {
  return typeof n === "number" ? n.toLocaleString("ar-EG") : "—";
}

/** نداء API موحّد — كل نداء بحد زمني، والفشل بيرجع سبب مش undefined. */
async function call<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...novaAuthHeaders(), ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(init?.timeoutMs ?? 25_000),
    });
    const j = (await r.json()) as T & { error?: string };
    if (!r.ok) return { ok: false, error: j?.error ?? `HTTP ${r.status}` };
    return { ok: true, data: j };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const SUGGESTIONS = [
  { label: "إيه اللي في البيئة؟", cmd: "cat /etc/os-release | head -2; echo ---; ls /usr/bin | wc -l; echo 'تنفيذي'; ls /opt/nova-workspaces" },
  { label: "فحص منافذ سريع", cmd: "nmap -sT -Pn -T4 --top-ports 20 -oN scans/ports.txt 127.0.0.1 && tail -12 scans/ports.txt" },
  { label: "كشف خدمة (nuclei)", cmd: "nuclei -u http://127.0.0.1:8080 -t /opt/nuclei-templates/http/miscellaneous/ -silent | head -10" },
  { label: "تعداد محتوى (feroxbuster)", cmd: "feroxbuster -u http://127.0.0.1:8080 -w /usr/share/seclists/Discovery/Web-Content/common.txt -d 1 -q 2>/dev/null | head -15" },
  { label: "بحث ثغرات", cmd: "searchsploit apache 2>/dev/null | head -12" },
  { label: "المساحة والمخرجات", cmd: "pwd; echo ---; du -sh .; echo ---; find . -type f | head -20" },
];

export default function KaliWorkspacePanel() {
  /* ── حالة القياس ── */
  const [health, setHealth] = useState<Health | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [sysinfo, setSysinfo] = useState<Sysinfo | null>(null);
  const [tools, setTools] = useState<ToolsPayload | null>(null);
  const [py, setPy] = useState<PyTools | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [invBusy, setInvBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [showAllMissing, setShowAllMissing] = useState(false);
  /* ── المختبر: تشغيل حقيقي فوري لأداة على هدف (SSE من /kali-env/run) ── */
  const [labTarget, setLabTarget] = useState("");
  const [labBusy, setLabBusy] = useState<string | null>(null);
  const [labLog, setLabLog] = useState<Array<{ text: string; kind?: "cmd" | "err" }>>([]);


  /* ── حالة مساحة الشغل ── */
  const [list, setList] = useState<Ws[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [ws, setWs] = useState<Ws | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [run, setRun] = useState<RunResult | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [openFile, setOpenFile] = useState<{ rel: string; text: string; bytes: number; truncated: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [shellCmd, setShellCmd] = useState<string | null>(null);
  const outRef = useRef<HTMLPreElement>(null);

  /* ── القياس الشامل ── */
  const measure = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const [h, id, si, tl, pyT] = await Promise.all([
      call<Health>("/kali-env/health"),
      call<Identity>("/kali-env/identity"),
      call<Sysinfo>("/kali-env/sysinfo"),
      call<ToolsPayload>("/kali-env/tools", { timeoutMs: 120_000 }),
      call<PyTools>("/ops/tools/python"),
    ]);
    if (h.ok) setHealth(h.data); else setHealth({ ready: false, detail: h.error });
    if (id.ok) setIdentity(id.data);
    if (si.ok) setSysinfo(si.data);
    if (tl.ok) setTools(tl.data); else setErr(`الأدوات: ${tl.error}`);
    if (pyT.ok) setPy(pyT.data);
    setLoading(false);
  }, []);

  const loadList = useCallback(async () => {
    const r = await call<{ ok: boolean; workspaces: Ws[]; ready: boolean }>("/kali-env/workspaces");
    if (r.ok) setList(Array.isArray(r.data.workspaces) ? r.data.workspaces : []);
    else setErr(r.error);
  }, []);

  const loadOne = useCallback(async (slug: string) => {
    const r = await call<{ ok: boolean; workspace: Ws }>(`/kali-env/workspaces/${encodeURIComponent(slug)}`);
    if (r.ok) setWs(r.data.workspace);
    else setErr(r.error);
  }, []);

  useEffect(() => { void measure(); void loadList(); }, [measure, loadList]);

  /* الجرد التقيل (٤٦ أداة بنسخها) مش بيتعمل تلقائي مع كل تحميل للصفحة:
   * بيفتح ٤٦ عملية داخل proot وياخد لحد ٣ دقايق. المستخدم بيطلبه بزرار
   * عشان الصفحة تفتح سريعة، ولما يطلبه بياخد الحقيقة كاملة. */
  const runInventory = useCallback(async () => {
    setInvBusy(true);
    setErr(null);
    const r = await call<Inventory>("/kali-env/inventory", { timeoutMs: 300_000 });
    /* رفض الـHTTP مش هو اللي بنحكم بيه — الجسم نفسه هو الحقيقة. لو السيرفر
     * ردّ بـ`measured:false` وسبب مقاس، ده **جواب** مش خطأ. */
    if (r.ok && typeof r.data?.total === "number") setInv(r.data);
    else if (!r.ok) setErr(r.error);
    setInvBusy(false);
  }, []);
  useEffect(() => { if (sel) void loadOne(sel); else setWs(null); }, [sel, loadOne]);
  /* ★ أول مساحة تتحدد تلقائيًا — الصفحة تفتح على شغل مش على شاشة فاضية. */
  useEffect(() => { if (!sel && list.length > 0) setSel(list[0].slug); }, [list, sel]);

  /* ── المختبر: تنفيذ حقيقي — أداة من الكتالوج على هدف، streaming مباشر ── */
  const LAB_TOOLS = ["nmap","nikto","gobuster","ffuf","sqlmap","nuclei","hydra","subfinder","httpx","whatweb"] as const;
  const runLabTool = async (tool: string) => {
    const tgt = labTarget.trim();
    if (!tgt) { setLabLog((l) => [...l, { text: "اكتب الهدف الأول (دومين/عنوان) — الأخلاقيات: هدفك أو مصرح لك", kind: "err" }]); return; }
    setLabBusy(tool);
    setLabLog((l) => [...l, { text: `▶ ${tool} ← ${tgt}`, kind: "cmd" }]);
    try {
      const r = await fetch(`/api/kali-env/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ tool, target: tgt, timeoutMs: 180_000 }),
        signal: AbortSignal.timeout(200_000),
      });
      if (!r.ok || !r.body) { const t = await r.text().catch(() => ""); setLabLog((l) => [...l, { text: `✗ HTTP ${r.status}: ${t.slice(0,160)}`, kind: "err" }]); setLabBusy(null); return; }
      const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((x) => x.startsWith("data: "));
          if (!line) continue;
          try {
            const d = JSON.parse(line.slice(6)) as { type?: string; text?: string; plane?: string };
            if (d.text) setLabLog((l) => [...l.slice(-300), { text: d.text, kind: d.type === "stderr" || d.type === "error" ? "err" : undefined }]);
            if (d.plane) setLabLog((l) => [...l, { text: `↳ اتنفذت على: ${d.plane}`, kind: "cmd" }]);
          } catch { /* سطر ناقص */ }
        }
      }
    } catch (e) {
      setLabLog((l) => [...l, { text: `✗ ${e instanceof Error ? e.message : String(e)}`, kind: "err" }]);
    }
    setLabBusy(null);
  };

  /* ── أفعال المساحة ── */
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await call<{ ok: boolean; workspace: Ws; error?: string }>("/kali-env/workspaces", {
      method: "POST", body: JSON.stringify({ name: name.trim() }),
    });
    if (r.ok && r.data.ok) { setName(""); await loadList(); setSel(r.data.workspace.slug); }
    else setErr(r.ok ? (r.data.error ?? "فشل") : r.error);
    setBusy(false);
  };

  const remove = async (slug: string) => {
    if (!confirm(`تمسح مساحة «${slug}» وكل ملفاتها من الدسك؟`)) return;
    setBusy(true);
    await call(`/kali-env/workspaces/${encodeURIComponent(slug)}`, { method: "DELETE" });
    if (sel === slug) { setSel(null); setRun(null); }
    await loadList();
    setBusy(false);
  };

  const exec = async (command?: string) => {
    const c = (command ?? cmd).trim();
    if (!c || !sel || runBusy) return;
    setRunBusy(true); setRun(null); setErr(null); setOpenFile(null);
    const r = await call<RunResult>(`/kali-env/workspaces/${encodeURIComponent(sel)}/run`, {
      method: "POST", body: JSON.stringify({ command: c }), timeoutMs: 900_000,
    });
    if (r.ok) {
      setRun(r.data);
      if (r.data.workspace) setWs(r.data.workspace); else await loadOne(sel);
      await loadList();
      if (command) setCmd(c);
    } else setErr(r.error);
    setRunBusy(false);
  };

  const openF = async (rel: string) => {
    if (!sel) return;
    const r = await call<{ ok: boolean; rel: string; text: string; bytes: number; truncated: boolean }>(
      `/kali-env/workspaces/${encodeURIComponent(sel)}/file?path=${encodeURIComponent(rel)}`,
    );
    if (r.ok) setOpenFile(r.data); else setErr(r.error);
  };

  const shell = async () => {
    if (!sel) return;
    const r = await call<{ ok: boolean; commands?: Record<string, string>; error?: string }>(`/kali-env/workspaces/${encodeURIComponent(sel)}/shell`);
    if (r.ok && r.data.ok) setShellCmd(r.data.commands?.local ?? null);
    else setErr(r.ok ? (r.data.error ?? "فشل") : r.error);
  };

  const copy = async (text: string, tag: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(tag); setTimeout(() => setCopied(null), 1600); } catch { /* */ }
  };

  /* ── حسابات العرض ── */
  const groups = tools?.groups ?? {};
  const groupKeys = Object.keys(groups);
  const allSubs = groupKeys.flatMap((k) => groups[k]?.substituted ?? []);
  const subByName = new Map(allSubs.map((s) => [s.name, s]));
  const totalMissing = groupKeys.reduce((n, k) => n + (groups[k]?.missing?.length ?? 0), 0);
  const covered = (tools?.present ?? 0) + new Set(allSubs.map((s) => s.name)).size;
  const pyOk = py?.manifest?.installed ?? 0;
  const pyTotal = py?.manifest?.total ?? 0;

  /* ── أنماط ── */
  const card: React.CSSProperties = { background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 };
  const btn = "text-[10px] font-black px-2.5 py-1.5 rounded-lg disabled:opacity-40 transition-colors";
  const accent = "#ff8866";
  const good = "#5fd6a8";
  const warn = "#f5b461";
  const bad = "#f47b7b";
  const mint = "#8fd8c8";

  return (
    <div className="space-y-3" dir="rtl">
      {/* ══ المختبر — تشغيل حقيقي فوري: أداة من الكتالوج على هدفك (SSE مباشر) ══ */}
      <div className="p-3" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,43,77,0.35)" }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] font-black" style={{ color: "#ff2b4d" }}>⚡ المختبر — تشغيل حقيقي فوري على عقدة كالي</span>
          <button type="button" onClick={() => setLabLog([])} className="text-[9px] px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)" }}>مسح السجل</button>
        </div>
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <input value={labTarget} onChange={(e) => setLabTarget(e.target.value)} placeholder="هدفك (مثال: example.com)"
            className="text-[10px] px-2 py-1 rounded flex-1 min-w-[200px]" style={{ background: "rgba(0,0,0,0.5)", color: "#fff", border: "1px solid rgba(255,43,77,0.35)", outline: "none" }} />
          {LAB_TOOLS.map((t) => (
            <button key={t} type="button" onClick={() => void runLabTool(t)} disabled={!!labBusy}
              className="text-[9px] font-black px-2 py-1 rounded" style={{ background: labBusy === t ? "rgba(255,43,77,0.35)" : "rgba(255,43,77,0.12)", color: "#ff9ab0", border: "1px solid rgba(255,43,77,0.4)" }}>
              {labBusy === t ? "…" : t}
            </button>
          ))}
        </div>
        {labLog.length > 0 && (
          <pre dir="ltr" className="mt-2 text-[10px] leading-4 max-h-56 overflow-auto rounded p-2" style={{ background: "rgba(0,0,0,0.6)", color: "#c9f7d9", border: "1px solid rgba(255,43,77,0.2)" }}>
            {labLog.map((l, i) => <div key={i} style={{ color: l.kind === "err" ? "#ff8f8f" : l.kind === "cmd" ? "#ff2b4d" : undefined }}>{l.text}</div>)}
          </pre>
        )}
        <p className="text-[8px] mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>تنفيذ حقيقي streaming على عقدة كالي — الهاك الأخلاقي: هدفك أو مصرّح لك بس</p>
      </div>

      {/* ══ ١) شريط الحالة — أول حاجة المستخدم بيشوفها ══ */}
      <div style={{ ...card, background: "linear-gradient(135deg, rgba(255,85,68,0.09), rgba(140,255,220,0.05))" }} className="p-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Shield size={18} style={{ color: health?.ready ? good : bad }} />
            <div>
              <div className="text-[14px] font-black" style={{ color: "#fff" }}>
                {health?.ready ? "بيئة كالي الحقيقية شغّالة" : loading ? "بيتقيس…" : "البيئة مش جاهزة"}
              </div>
              <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.6)" }}>
                {identity?.prettyName ?? (health?.detail ? health.detail.slice(0, 70) : "…")}
                {identity?.uid != null && ` · uid ${identity.uid}`}
                {health?.guestShell && " · الشل بيستجيب"}
              </div>
            </div>
          </div>
          <button type="button" onClick={() => { void measure(); void loadList(); }} disabled={loading}
            className={btn} style={{ background: "rgba(255,255,255,0.07)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}>
            <RefreshCw size={11} className={`inline ${loading ? "animate-spin" : ""}`} /> قيس تاني
          </button>
        </div>

        {/* أرقام مقاسة — كل واحد من API */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-3">
          {[
            { icon: <Wrench size={12} />, label: "أداة متاحة", value: loading ? "…" : `${num(tools?.present)}`, sub: `من ${num(tools?.total)}` },
            { icon: <Layers size={12} />, label: "بديل شغّال", value: loading ? "…" : num(new Set(allSubs.map((s) => s.name)).size), sub: "بنفس الوظيفة" },
            { icon: <CheckCircle2 size={12} />, label: "تغطية", value: loading ? "…" : `${covered}`, sub: "وظيفة مؤمّنة" },
            { icon: <Zap size={12} />, label: "أدوات بايثون", value: py?.venvPresent === false ? "—" : `${pyOk}/${pyTotal || "—"}`, sub: `${num(py?.manifest?.pythonPackages)} حزمة` },
            { icon: <HardDrive size={12} />, label: "مساحة فاضية", value: sysinfo?.disk?.freeGB != null ? `${sysinfo.disk.freeGB}GB` : "…", sub: sysinfo?.disk?.totalGB != null ? `من ${sysinfo.disk.totalGB}GB` : "" },
            { icon: <Cpu size={12} />, label: "RAM", value: sysinfo?.mem?.freeMB != null ? `${Math.round(sysinfo.mem.freeMB / 1024)}GB` : "…", sub: `${sysinfo?.cpu?.cores ?? "?"} نواة` },
          ].map((m) => (
            <div key={m.label} className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-1 text-[8px]" style={{ color: "rgba(255,255,255,0.5)" }}>{m.icon} {m.label}</div>
              <div className="text-[15px] font-black leading-tight" style={{ color: mint }}>{m.value}</div>
              <div className="text-[8px]" style={{ color: "rgba(255,255,255,0.4)" }}>{m.sub}</div>
            </div>
          ))}
        </div>
        {err && (
          <div className="mt-2 text-[10px] rounded p-2" style={{ background: "rgba(244,123,123,0.14)", color: bad }}>
            <AlertTriangle size={10} className="inline ml-1" /> {err}
          </div>
        )}
      </div>

      {/* ══ ٢) مكان الشغل — المدخل الرئيسي ══ */}
      <div style={card} className="p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="flex items-center gap-1.5 text-[12px] font-black" style={{ color: accent }}>
            <Terminal size={14} /> مكان الشغل في كالي
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {list.map((w) => (
              <div key={w.slug} className="flex items-center gap-1 rounded-lg px-2 py-1"
                style={{ background: sel === w.slug ? "rgba(255,85,68,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${sel === w.slug ? "rgba(255,85,68,0.55)" : "rgba(255,255,255,0.12)"}` }}>
                <button type="button" onClick={() => setSel(w.slug)} className="text-[10px] font-bold" style={{ color: sel === w.slug ? accent : "#ccc" }}>
                  {w.slug}
                </button>
                <span className="text-[8px]" style={{ color: "rgba(255,255,255,0.4)" }}>{w.fileCount}</span>
                <button type="button" onClick={() => void remove(w.slug)} title="امسح"><Trash2 size={9} style={{ color: bad }} /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-1.5 mb-2">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()}
            placeholder="اسم مساحة جديدة · web-audit · pwn-lab · bugbounty"
            className="flex-1 text-[10px] px-2.5 py-1.5 rounded-lg bg-black/40 outline-none"
            style={{ border: "1px solid rgba(255,255,255,0.15)", color: "#fff" }} />
          <button type="button" onClick={() => void create()} disabled={busy || !name.trim()} className={btn}
            style={{ background: "rgba(255,85,68,0.2)", color: accent, border: "1px solid rgba(255,85,68,0.5)" }}>
            <Plus size={11} className="inline" /> اعمل مساحة
          </button>
        </div>

        {!sel && (
          <div className="text-[10px] py-3 text-center" style={{ color: "rgba(255,255,255,0.45)" }}>
            {list.length === 0 ? "مافيش مساحات — اعمل واحدة فوق وابدأ شغل داخل كالي." : "اختار مساحة فوق."}
          </div>
        )}

        {sel && ws && (
          <>
            <div className="text-[9px] mb-1.5 flex items-center gap-2 flex-wrap" style={{ color: "rgba(255,255,255,0.5)" }}>
              <code style={{ color: mint }}>{ws.guestPath}</code>
              <span>·</span><span>{ws.fileCount} ملف</span>
              <span>·</span><span>{human(ws.dirBytes)}</span>
              <button type="button" onClick={() => void shell()} className="mr-auto text-[9px] px-2 py-0.5 rounded"
                style={{ background: "rgba(140,255,220,0.1)", color: mint, border: "1px solid rgba(140,255,220,0.3)" }}>
                أمر طرفية لجهازي
              </button>
            </div>

            <div className="flex gap-1.5">
              <input value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void exec()}
                placeholder="nmap -sT -Pn -oN scans/ports.txt 10.0.0.1"
                className="flex-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-black/50 outline-none font-mono"
                style={{ border: "1px solid rgba(255,255,255,0.15)", color: mint }} dir="ltr" />
              <button type="button" onClick={() => void exec()} disabled={runBusy || !cmd.trim()} className={btn}
                style={{ background: "rgba(140,255,220,0.16)", color: mint, border: "1px solid rgba(140,255,220,0.4)" }}>
                {runBusy ? <RefreshCw size={11} className="inline animate-spin" /> : <Play size={11} className="inline" />} نفّذ
              </button>
            </div>

            <div className="mt-1.5 flex flex-wrap gap-1">
              {SUGGESTIONS.map((s) => (
                <button key={s.label} type="button" onClick={() => void exec(s.cmd)} disabled={runBusy}
                  className="text-[9px] px-2 py-1 rounded-lg disabled:opacity-40"
                  style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {s.label}
                </button>
              ))}
            </div>

            {shellCmd && (
              <div className="mt-2 rounded-lg p-2" style={{ background: "rgba(140,255,220,0.06)", border: "1px solid rgba(140,255,220,0.25)" }}>
                <div className="text-[9px] mb-1" style={{ color: mint }}>الصق ده في طرفية على جهازك:</div>
                <div className="flex gap-1 items-start">
                  <code className="flex-1 text-[8px] break-all" dir="ltr" style={{ color: "#ddd" }}>{shellCmd}</code>
                  <button type="button" onClick={() => void copy(shellCmd, "shell")}>
                    {copied === "shell" ? <Check size={11} style={{ color: mint }} /> : <Copy size={11} style={{ color: "#aaa" }} />}
                  </button>
                </div>
              </div>
            )}

            {(run || runBusy) && (
              <div className="mt-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] font-black" style={{ color: run?.ok ? good : bad }}>
                    {runBusy ? "بيتنفذ داخل كالي…" : run?.ok ? `✓ نجح · ${(run.ms / 1000).toFixed(2)}ث` : `✗ كود ${run?.exitCode ?? "?"} · ${((run?.ms ?? 0) / 1000).toFixed(2)}ث`}
                  </div>
                  {run && run.newFiles.length > 0 && (
                    <div className="text-[9px]" style={{ color: warn }}>{run.newFiles.length} ملف جديد اتحفظ</div>
                  )}
                </div>
                {run?.error && <div className="text-[9px] mb-1 rounded p-1.5" style={{ background: "rgba(244,123,123,0.14)", color: bad }}>{run.error}</div>}
                {run && (
                  <pre ref={outRef} className="text-[10px] p-2.5 rounded-lg overflow-auto max-h-72 font-mono whitespace-pre-wrap"
                    dir="ltr" style={{ background: "rgba(0,0,0,0.6)", color: "#cfe", margin: 0 }}>
                    {run.stdout || "(مفيش مخرجات)"}{run.stderr ? `\n[stderr]\n${run.stderr}` : ""}
                  </pre>
                )}
                {run && run.newFiles.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {run.newFiles.map((f) => (
                      <button key={f} type="button" onClick={() => void openF(f)} className="text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(245,180,97,0.14)", color: warn, border: "1px solid rgba(245,180,97,0.35)" }}>
                        <FileText size={9} className="inline" /> {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {openFile && (
              <div className="mt-2 rounded-lg p-2" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] font-black" style={{ color: warn }}><FileText size={10} className="inline ml-1" /> {openFile.rel}</div>
                  <div className="text-[8px]" style={{ color: "rgba(255,255,255,0.4)" }}>{human(openFile.bytes)}{openFile.truncated ? " · أول 512KB" : ""}</div>
                </div>
                <pre className="text-[9px] p-2 rounded overflow-auto max-h-64 font-mono whitespace-pre-wrap"
                  dir="ltr" style={{ background: "rgba(0,0,0,0.55)", color: "#cfe", margin: 0 }}>
                  {openFile.text || "(ملف غير نصي)"}
                </pre>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-2 mt-2">
              <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[10px] font-black mb-1" style={{ color: "rgba(255,255,255,0.8)" }}>
                  <FolderOpen size={10} className="inline ml-1" /> ملفات المساحة ({ws.fileCount})
                </div>
                {ws.files.length === 0 && <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.4)" }}>فاضية — نفّذ أمر فوق.</div>}
                <div className="space-y-0.5 max-h-44 overflow-auto">
                  {ws.files.filter((f) => f.kind !== "dir" || ws.files.length < 40).map((f) => (
                    <div key={f.rel} className="flex items-center gap-1.5 text-[9px]">
                      {f.kind === "dir" ? (
                        <span style={{ color: warn }}>📁 {f.name}/</span>
                      ) : (
                        <button type="button" onClick={() => void openF(f.rel)} className="truncate text-right" style={{ color: mint }}>📄 {f.rel}</button>
                      )}
                      {f.kind === "file" && <span className="shrink-0 mr-auto" style={{ color: "rgba(255,255,255,0.3)" }}>{human(f.bytes)}</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[10px] font-black mb-1" style={{ color: "rgba(255,255,255,0.8)" }}>
                  <Activity size={10} className="inline ml-1" /> سجل الأوامر (محفوظ على الدسك)
                </div>
                {ws.history.length === 0 && <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.4)" }}>لسه مافيش أوامر.</div>}
                <div className="space-y-0.5 max-h-44 overflow-auto">
                  {ws.history.slice(0, 12).map((h, i) => (
                    <div key={`${h.at}-${i}`} className="text-[8px] font-mono truncate" dir="ltr"
                      style={{ color: h.exitCode === 0 ? "rgba(95,214,168,0.85)" : "rgba(244,123,123,0.85)" }}>
                      [{h.exitCode ?? "?"}] {h.cmd}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ══ ٣) الأدوات — ١٠٠٪ من الكتالوج، مقسّمة بصدق ══ */}
      <div style={card} className="p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="flex items-center gap-1.5 text-[12px] font-black" style={{ color: mint }}>
            <Wrench size={14} /> الأدوات — {num(tools?.present)} مباشر · {num(new Set(allSubs.map((s) => s.name)).size)} ببديل · {num(totalMissing - new Set(allSubs.map((s) => s.name)).size)} ناقص
          </div>
          <label className="flex items-center gap-1 text-[9px] cursor-pointer" style={{ color: "rgba(255,255,255,0.6)" }}>
            <input type="checkbox" checked={showAllMissing} onChange={(e) => setShowAllMissing(e.target.checked)} />
            اعرض الناقص كله
          </label>
        </div>

        {!tools && <div className="text-[10px] py-2" style={{ color: "rgba(255,255,255,0.45)" }}>{loading ? "بيتقيس من كالي…" : "مفيش قياس"}</div>}

        {tools && (
          <div className="space-y-1.5">
            {groupKeys.map((gk) => {
              const g = groups[gk];
              if (!g) return null;
              const subs = g.substituted ?? [];
              const open = openGroups[gk] ?? false;
              const coveredN = g.present.length + subs.length;
              const totalN = coveredN + g.missing.length - subs.length;
              const pct = totalN > 0 ? Math.round((coveredN / totalN) * 100) : 0;
              return (
                <div key={gk} className="rounded-lg" style={{ background: "rgba(0,0,0,0.22)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <button type="button" onClick={() => setOpenGroups((p) => ({ ...p, [gk]: !p[gk] }))}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-right">
                    {open ? <ChevronDown size={11} style={{ color: "rgba(255,255,255,0.4)" }} /> : <ChevronLeft size={11} style={{ color: "rgba(255,255,255,0.4)" }} />}
                    <span className="text-[10px] font-bold" style={{ color: "#fff" }}>{gk}</span>
                    <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.45)" }}>{coveredN}/{totalN}</span>
                    <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="h-full" style={{ width: `${pct}%`, background: pct === 100 ? good : pct > 60 ? warn : bad }} />
                    </div>
                    <span className="text-[9px] font-black" style={{ color: pct === 100 ? good : pct > 60 ? warn : bad }}>{pct}%</span>
                  </button>
                  {open && (
                    <div className="px-2 pb-2 space-y-0.5">
                      {g.present.map((t) => (
                        <div key={`p-${t}`} className="flex items-center gap-1.5 text-[9px]">
                          <CheckCircle2 size={9} style={{ color: good }} />
                          <span style={{ color: "#cfe" }}>{t}</span>
                        </div>
                      ))}
                      {subs.map((s) => (
                        <div key={`s-${s.name}`} className="flex items-start gap-1.5 text-[9px]" title={s.why}>
                          <Layers size={9} style={{ color: warn, marginTop: 1 }} />
                          <span style={{ color: warn }}>{s.name}</span>
                          <span style={{ color: "rgba(255,255,255,0.5)" }}>← عبر <b style={{ color: mint }}>{s.via}</b></span>
                        </div>
                      ))}
                      {g.missing.filter((t) => !subByName.has(t)).map((t) => (
                        <div key={`m-${t}`} className="flex items-center gap-1.5 text-[9px]">
                          <XCircle size={9} style={{ color: "rgba(255,255,255,0.3)" }} />
                          <span style={{ color: "rgba(255,255,255,0.45)" }}>{t}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tools && (
          <div className="mt-2 text-[9px] rounded p-2" style={{ background: "rgba(140,255,220,0.05)", color: "rgba(255,255,255,0.6)" }}>
            <b style={{ color: mint }}>الناقص بيتحل إزاي (مقاس حيًا):</b> أدوات Go (ffuf · subfinder · amass · katana) والحزم النظامية (ettercap · steghide · exiftool)
            بتتسطب دلوقتي على عقد الأسطول من <b>kali-store</b> على الجيت هوب — tarballs جاهزة بتفريغ بلا dpkg، وطبقة STORE أول سلسلة التثبيت
            (مقاس TEST91: subfinder · amass · bettercap · ligolo-ng · mongosh … INSTALL_OK). اللي بيقول «محجوب» بيكتب عن نسخة قديمة.
          </div>
        )}
      </div>

      {/* ══ ٤) أدوات بايثون — المسار اللي شغال فعلًا ══ */}
      <div style={card} className="p-3">
        <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
          <div className="flex items-center gap-1.5 text-[12px] font-black" style={{ color: "#c9a6ff" }}>
            <Zap size={14} /> أدوات بايثون الأمنية — {py?.venvPresent ? `${pyOk}/${pyTotal}` : "مش متسطّبة"}
          </div>
          <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.45)" }}>
            {py?.manifest?.pythonPackages ? `${py.manifest.pythonPackages} حزمة في الـvenv` : ""}
            {py?.manifest?.generatedAt ? ` · قيس ${new Date(py.manifest.generatedAt).toLocaleString("ar-EG")}` : ""}
          </div>
        </div>
        {py?.venvPresent && py.manifest?.results ? (
          <div className="flex flex-wrap gap-1">
            {py.manifest.results.map((r) => (
              <span key={r.pkg} title={r.version ?? r.why ?? ""}
                className="text-[9px] px-1.5 py-0.5 rounded"
                style={{ background: r.status === "installed" ? "rgba(95,214,168,0.12)" : "rgba(244,123,123,0.12)", color: r.status === "installed" ? good : bad, border: `1px solid ${r.status === "installed" ? "rgba(95,214,168,0.3)" : "rgba(244,123,123,0.3)"}` }}>
                {r.pkg}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.45)" }}>{py?.hint ?? "بيتقيس…"}</div>
        )}
      </div>

      {/* ══ ٤.٥) جرد النسخ — ٤٦ أداة بنسختها الحقيقية ══ */}
      <div style={card} className="p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
          <div className="flex items-center gap-1.5 text-[12px] font-black" style={{ color: "#9fd0ff" }}>
            <Layers size={14} /> جرد النسخ — ٤٦ أداة أساسية
          </div>
          <div className="flex items-center gap-2">
            {inv && <span className="text-[10px] font-black" style={{ color: inv.present >= 40 ? good : warn }}>{inv.present}/{inv.total}</span>}
            <button type="button" onClick={() => void runInventory()} disabled={invBusy} className={btn}
              style={{ background: "rgba(159,208,255,0.14)", color: "#9fd0ff", border: "1px solid rgba(159,208,255,0.35)" }}>
              {invBusy ? <RefreshCw size={11} className="inline animate-spin" /> : <Activity size={11} className="inline" />} {inv ? "قيس تاني" : "اعمل جرد"}
            </button>
          </div>
        </div>
        {!inv && (
          <div className="text-[9px]" style={{ color: "rgba(255,255,255,0.45)" }}>
            بيفتح ٤٦ أداة ويجيب نسخة كل واحدة من مخرجاتها — ممكن ياخد لحد ٣ دقايق. اضغط «اعمل جرد».
          </div>
        )}
        {/* ★ الجواب الصادق: مافيش كالي في المدى. بنقول السبب المقاس والمسارات
            اللي اتفتشت — مش «فشل» ولا شاشة فاضية. */}
        {inv && inv.measured === false && (
          <div className="rounded-lg p-2 text-[9px] leading-relaxed" style={{ background: "rgba(255,176,32,0.10)", border: "1px solid rgba(255,176,32,0.30)", color: "#ffd08a" }}>
            <div className="font-black mb-1">مافيش كالي حقيقية في المدى — الجرد مش مقاس</div>
            <div style={{ color: "rgba(255,255,255,0.70)" }}>{inv.reason}</div>
            {inv.fleet && (
              <div className="mt-1" style={{ color: "rgba(255,255,255,0.55)" }}>
                الأسطول: {inv.fleet.connected} عقدة متصلة · {inv.fleet.kaliReady} منهم كالي جاهزة
              </div>
            )}
            {inv.searched && inv.searched.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer" style={{ color: "rgba(255,255,255,0.50)" }}>المسارات اللي اتفتشت ({inv.searched.length})</summary>
                <div className="mt-0.5 font-mono" dir="ltr" style={{ color: "rgba(255,255,255,0.40)" }}>{inv.searched.join(" · ")}</div>
              </details>
            )}
          </div>
        )}
        {inv && inv.measured !== false && inv.tools.length > 0 && (
          <>
            <div className="text-[9px] mb-1.5" style={{ color: "rgba(255,255,255,0.45)" }}>
              {inv.measuredOn ? `قيس على ${inv.measuredOn}` : `قيس ${new Date(inv.measuredAt ?? Date.now()).toLocaleString("ar-EG")}`}
              {inv.missing.length > 0 && <span style={{ color: warn }}> · ناقص: {inv.missing.join(" · ")}</span>}
            </div>
            <div className="grid sm:grid-cols-2 gap-x-3 gap-y-0.5 max-h-64 overflow-auto">
              {inv.tools.filter((t) => t.present).map((t) => (
                <div key={t.name} className="flex items-baseline gap-1.5 text-[9px]">
                  <CheckCircle2 size={8} style={{ color: good, flexShrink: 0 }} />
                  <span className="font-bold" style={{ color: "#cfe" }}>{t.name}</span>
                  {/* ⚠️ كان بيكتب "—" لأداة موجودة من غير رقم نسخة، والقارئ
                      يفهمها «مافيش». الأداة **موجودة** (الملف قابل للتنفيذ
                      وردّ) بس مابتعرضش رقم — بنقول الحقيقة دي صريحة. */}
                  <span className="truncate" dir="ltr" style={{ color: t.version ? "rgba(255,255,255,0.45)" : "rgba(140,220,170,0.65)" }}>
                    {t.version || "موجودة · بلا رقم نسخة"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ══ ٥) حقائق البيئة — قيود مقاسة، مش أعذار ══ */}
      <div style={card} className="p-3">
        <div className="text-[11px] font-black mb-1.5" style={{ color: "rgba(255,255,255,0.85)" }}>
          <AlertTriangle size={12} className="inline ml-1" style={{ color: warn }} /> قيود البيئة — مقاسة، اتعرف عليها قبل ما تبدأ
        </div>
        <div className="grid sm:grid-cols-2 gap-1.5 text-[9px]" style={{ color: "rgba(255,255,255,0.65)" }}>
          {[
            ["خروج الإنترنت", "من كالي المدمجة: pypi/npm. من عقد الأسطول: مفتوح — التثبيت من GitHub مقاس (subfinder/bettercap/amass…)."],
            ["raw sockets في proot", "nmap -sS محتاج CAP_NET_RAW — استخدم -sT. بقية الأدوات ما بتأثرش."],
            ["المنزل /root", "مملوك root:root 700 · HOME = المساحة فالإعدادات بتتحفظ مع شغلك."],
            ["dpkg على العقدة المجروحة", "ميت (مقاس TEST80 بصمت) — عشان كده kali-store tarballs بتفريغ بلا dpkg أصلًا."],
          ].map(([k, v]) => (
            <div key={k} className="rounded p-1.5" style={{ background: "rgba(255,255,255,0.03)" }}>
              <b style={{ color: "#fff" }}>{k}</b>
              <div style={{ color: "rgba(255,255,255,0.5)" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
