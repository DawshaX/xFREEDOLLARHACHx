/**
 * TEST38 — Kali system telemetry + full tool catalogue + one-click runner.
 * ─────────────────────────────────────────────────────────────────────────────
 * Additive panel. The existing KaliEnvPage already shows: fleet nodes, measured
 * status, heavy tools, live desktop, live job monitor, real stats, deploy
 * mirror, the terminal (with plane picker), the proot card, the agent link and
 * the GitHub storage hub. None of that is touched.
 *
 * What was missing, and is here:
 *   1. The eleven official Kali categories with per-tool version + run button.
 *   2. A real system panel: CPU / RAM / disk / processes / network / GPU /
 *      uptime / rootfs — every number from /proc and statfs.
 *   3. One-click tool execution with a target box, streaming into a log.
 *
 * Honesty rules enforced here:
 *   - A failed fetch renders the error, never a zero.
 *   - `null` from the API renders as "غير مقيس" with the reason, never as 0.
 *   - Every result line says which plane actually ran it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Cpu, HardDrive, Network, Play, RefreshCw, Terminal, Wrench } from "lucide-react";

const API = "/api";

type ToolRow = {
  name: string;
  present: boolean;
  version: string | null;
  versionReason?: string;
  recipe: { args: string; targetLabel: string; hint: string } | null;
};
type Category = { id: string; tools: ToolRow[]; present: number; total: number };
type Catalog = {
  ok: boolean;
  ready: boolean;
  reason?: string;
  measuredOn?: string;
  measuredAt?: string;
  categories: Category[];
  total: number;
  present: number;
  fleet?: { connected: number; kaliReady: number };
};

type SysInfo = {
  ok: boolean;
  measuredAt: string;
  host: { hostname: string; platform: string; release: string; arch: string; node: string };
  uptimeSec: number | null;
  cpu: { usedPct: number | null; cores: number; model: string | null; load1: number | null; load5: number | null; load15: number | null; reason?: string };
  mem: { totalBytes: number | null; availableBytes: number | null; usedBytes: number | null; usedPct: number | null; swapTotalBytes: number | null; swapUsedBytes: number | null; reason?: string };
  disks: Array<{ mount: string; totalBytes: number | null; freeBytes: number | null; usedBytes: number | null; usedPct: number | null; reason?: string }>;
  procs: { total: number; rows: Array<{ pid: number; name: string; rssBytes: number; cpuTicks: number; state: string }>; reason?: string };
  net: { ifaces: Array<{ name: string; rxBytes: number; txBytes: number }>; reason?: string };
  gpu: { present: boolean; devices: string[]; renderer: string; note: string };
  rootfs: { present: boolean; root: string | null; prootBin: string | null; guestShell: boolean; bytes: number | null; packages: number | null; executables: number | null; prettyName: string | null; reason?: string };
  unmeasured: string[];
};

const CATEGORY_LABEL: Record<string, string> = {
  "information-gathering": "Information Gathering",
  "vulnerability-analysis": "Vulnerability Analysis",
  "web-applications": "Web Applications",
  "password-attacks": "Password Attacks",
  wireless: "Wireless Attacks",
  exploitation: "Exploitation Tools",
  "sniffing-spoofing": "Sniffing & Spoofing",
  "post-exploitation": "Post Exploitation",
  forensics: "Forensics",
  "reverse-engineering": "Reverse Engineering",
  reporting: "Reporting Tools",
};

const human = (b: number | null): string => {
  if (b === null) return "غير مقيس";
  if (b >= 2 ** 30) return `${(b / 2 ** 30).toFixed(2)} GB`;
  if (b >= 2 ** 20) return `${(b / 2 ** 20).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
};

const uptime = (s: number | null): string => {
  if (s === null) return "غير مقيس";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}ي ${h}س ${m}د` : `${h}س ${m}د`;
};

function Bar({ pct, color }: { pct: number | null; color: string }) {
  if (pct === null) {
    return <div className="h-1.5 rounded mt-1" style={{ background: "rgba(255,255,255,0.06)" }} />;
  }
  return (
    <div className="h-1.5 rounded mt-1 overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
      <div className="h-full rounded transition-all" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

export default function KaliSystemsPanel() {
  const [sys, setSys] = useState<SysInfo | null>(null);
  const [sysErr, setSysErr] = useState<string | null>(null);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [catBusy, setCatBusy] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>("information-gathering");
  const [target, setTarget] = useState<Record<string, string>>({});
  const [runLog, setRunLog] = useState<Array<{ text: string; kind: "cmd" | "out" | "err" | "meta" }>>([]);
  const [runBusy, setRunBusy] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const loadSys = useCallback(async () => {
    try {
      const r = await fetch(`${API}/kali-env/sysinfo`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) {
        setSysErr(`HTTP ${r.status} — ${r.statusText}`);
        return;
      }
      const d = (await r.json()) as Partial<SysInfo> & { note?: string; error?: string };
      if (!d?.host || !d.cpu || !d.mem || !d.gpu || !Array.isArray(d.disks)) {
        setSys(null);
        setSysErr(d?.note || d?.error || "الرد ناقص حالة النظام — مش هعرض أرقام متخيلة");
        return;
      }
      setSys(d as SysInfo);
      setSysErr(null);
    } catch (e) {
      setSysErr((e as Error).message.slice(0, 160));
    }
  }, []);

  const loadCat = useCallback(async () => {
    setCatBusy(true);
    try {
      const r = await fetch(`${API}/kali-env/catalog`, { signal: AbortSignal.timeout(90_000) });
      if (!r.ok) {
        setCatErr(`HTTP ${r.status} — ${r.statusText}`);
        return;
      }
      setCat((await r.json()) as Catalog);
      setCatErr(null);
    } catch (e) {
      setCatErr((e as Error).message.slice(0, 160));
    } finally {
      setCatBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadSys();
    void loadCat();
    const iv = setInterval(() => void loadSys(), 10_000);
    return () => clearInterval(iv);
  }, [loadSys, loadCat]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [runLog]);

  const runTool = async (tool: string) => {
    const tgt = (target[tool] ?? "").trim();
    if (!tgt) {
      setRunLog((l) => [...l, { text: `✗ ${tool}: اكتب الهدف الأول (${cat?.categories.flatMap((c) => c.tools).find((t) => t.name === tool)?.recipe?.targetLabel ?? "target"})`, kind: "err" }]);
      return;
    }
    setRunBusy(tool);
    setRunLog((l) => [...l, { text: `▶ ${tool} ← ${tgt}`, kind: "cmd" }]);
    try {
      const r = await fetch(`${API}/kali-env/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, target: tgt, timeoutMs: 180_000 }),
      });
      if (!r.ok || !r.body) {
        const body = await r.text().catch(() => "");
        setRunLog((l) => [...l, { text: `✗ HTTP ${r.status}: ${body.slice(0, 200)}`, kind: "err" }]);
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
            const ev = JSON.parse(payload) as { type: string; text?: string; exitCode?: number | null; plane?: string; message?: string; durationMs?: number };
            if (ev.type === "stdout" && ev.text) setRunLog((l) => [...l, { text: ev.text!, kind: "out" }]);
            else if (ev.type === "stderr" && ev.text) setRunLog((l) => [...l, { text: ev.text!, kind: "err" }]);
            else if (ev.type === "start") setRunLog((l) => [...l, { text: `$ ${ev.text ?? ""}`, kind: "meta" }]);
            else if (ev.type === "done") setRunLog((l) => [...l, { text: `— انتهى · exit=${ev.exitCode ?? "?"} · ${ev.durationMs ?? "?"}ms · على ${ev.plane ?? "?"}`, kind: "meta" }]);
            else if (ev.type === "error") setRunLog((l) => [...l, { text: `✗ ${ev.message ?? "خطأ"}`, kind: "err" }]);
          } catch {
            /* frame not JSON — ignore */
          }
        }
      }
    } catch (e) {
      setRunLog((l) => [...l, { text: `✗ ${(e as Error).message.slice(0, 160)}`, kind: "err" }]);
    } finally {
      setRunBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* ── لوحة حالة النظام الحقيقية ─────────────────────────────────── */}
      <div className="rounded-xl p-3" style={{ background: "rgba(34,211,238,0.03)", border: "1px solid rgba(34,211,238,0.3)" }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] font-black flex items-center gap-1.5" style={{ color: "#22d3ee" }}>
            <Activity className="w-3.5 h-3.5" /> حالة النظام الحقيقية — مقاسة من /proc و statfs
          </p>
          <div className="flex items-center gap-1.5">
            {sys && (
              <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
                {sys.host?.hostname ?? "غير مقيس"} · {sys.host?.platform ?? "—"} {sys.host?.release ?? ""} · {sys.host?.arch ?? "—"} · node {sys.host?.node ?? "—"}
              </span>
            )}
            <button onClick={() => void loadSys()} className="text-[9px] px-2 py-1 rounded flex items-center gap-1"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)" }}>
              <RefreshCw className="w-3 h-3" /> تحديث
            </button>
          </div>
        </div>

        {sysErr ? (
          <p className="text-[9px] font-mono mt-2" style={{ color: "#ff6666" }}>
            ✗ فشل قياس حالة النظام: {sysErr} — الأرقام مش معروضة بدل ما تتعرض كصفر.
          </p>
        ) : !sys ? (
          <p className="text-[9px] font-mono mt-2" style={{ color: "rgba(255,255,255,0.45)" }}>…بجيب القياسات</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              {/* CPU */}
              <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black flex items-center gap-1" style={{ color: "#ffaa44" }}><Cpu className="w-3 h-3" /> CPU</span>
                  <span className="text-[10px] font-mono font-black" style={{ color: sys.cpu.usedPct === null ? "#ff6666" : "#44ff88" }}>
                    {sys.cpu.usedPct === null ? "غير مقيس" : `${sys.cpu.usedPct}%`}
                  </span>
                </div>
                <Bar pct={sys.cpu.usedPct} color="linear-gradient(90deg,#ff5533,#ffaa44)" />
                <p className="text-[8px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {sys.cpu.cores} نواة · load {sys.cpu.load1 ?? "?"}/{sys.cpu.load5 ?? "?"}/{sys.cpu.load15 ?? "?"}
                </p>
                {sys.cpu.reason && <p className="text-[8px] font-mono" style={{ color: "#ff6666" }}>{sys.cpu.reason}</p>}
              </div>

              {/* RAM */}
              <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black" style={{ color: "#9966ff" }}>RAM</span>
                  <span className="text-[10px] font-mono font-black" style={{ color: sys.mem.usedPct === null ? "#ff6666" : "#44ff88" }}>
                    {sys.mem.usedPct === null ? "غير مقيس" : `${sys.mem.usedPct}%`}
                  </span>
                </div>
                <Bar pct={sys.mem.usedPct} color="linear-gradient(90deg,#6633ff,#9966ff)" />
                <p className="text-[8px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {human(sys.mem.usedBytes)} / {human(sys.mem.totalBytes)} · متاح {human(sys.mem.availableBytes)}
                </p>
                {sys.mem.swapTotalBytes !== null && sys.mem.swapTotalBytes > 0 && (
                  <p className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                    swap {human(sys.mem.swapUsedBytes)} / {human(sys.mem.swapTotalBytes)}
                  </p>
                )}
              </div>

              {/* uptime + procs */}
              <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="text-[9px] font-black" style={{ color: "#44ff88" }}>Uptime / عمليات</span>
                <p className="text-[10px] font-mono font-black mt-0.5" style={{ color: "#e0e0e0" }}>{uptime(sys.uptimeSec)}</p>
                <p className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
                  {sys.procs.reason ? `غير مقيس: ${sys.procs.reason}` : `${sys.procs.total} عملية شغالة`}
                </p>
              </div>

              {/* GPU */}
              <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="text-[9px] font-black" style={{ color: sys.gpu.present ? "#44ff88" : "#ffaa44" }}>GPU</span>
                <p className="text-[9px] font-mono font-black mt-0.5" style={{ color: "#e0e0e0" }}>{sys.gpu.renderer}</p>
                <p className="text-[8px] font-mono leading-snug" style={{ color: "rgba(255,255,255,0.4)" }}>{sys.gpu.note}</p>
              </div>
            </div>

            {/* disks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
              {sys.disks.map((d) => (
                <div key={d.mount} className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black flex items-center gap-1" style={{ color: "#22d3ee" }}>
                      <HardDrive className="w-3 h-3" /> {d.mount}
                    </span>
                    <span className="text-[9px] font-mono" style={{ color: d.usedPct !== null && d.usedPct > 90 ? "#ff6666" : "#44ff88" }}>
                      {d.usedPct === null ? "غير مقيس" : `${d.usedPct}%`}
                    </span>
                  </div>
                  <Bar pct={d.usedPct} color={d.usedPct !== null && d.usedPct > 90 ? "#ff5555" : "linear-gradient(90deg,#22d3ee,#44ff88)"} />
                  <p className="text-[8px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                    {d.reason ? `✗ ${d.reason}` : `${human(d.usedBytes)} مستخدم · ${human(d.freeBytes)} فاضي · من ${human(d.totalBytes)}`}
                  </p>
                </div>
              ))}
            </div>

            {/* network + top procs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
              <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="text-[9px] font-black flex items-center gap-1" style={{ color: "#44ff88" }}><Network className="w-3 h-3" /> الشبكة</span>
                {sys.net.reason ? (
                  <p className="text-[8px] font-mono mt-1" style={{ color: "#ff6666" }}>✗ {sys.net.reason}</p>
                ) : (
                  <div className="mt-1 space-y-0.5">
                    {sys.net.ifaces.map((i) => (
                      <div key={i.name} className="flex items-center justify-between text-[8px] font-mono">
                        <span style={{ color: "rgba(255,255,255,0.6)" }}>{i.name}</span>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>↓{human(i.rxBytes)} ↑{human(i.txBytes)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-lg p-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <span className="text-[9px] font-black" style={{ color: "#ffaa44" }}>أكبر العمليات (RSS)</span>
                {sys.procs.reason ? (
                  <p className="text-[8px] font-mono mt-1" style={{ color: "#ff6666" }}>✗ {sys.procs.reason}</p>
                ) : (
                  <div className="mt-1 space-y-0.5">
                    {sys.procs.rows.slice(0, 6).map((p) => (
                      <div key={p.pid} className="flex items-center justify-between text-[8px] font-mono">
                        <span style={{ color: "rgba(255,255,255,0.6)" }}>{p.pid} {p.name}</span>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>{human(p.rssBytes)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* rootfs */}
            <div className="rounded-lg p-2 mt-2" style={{ background: "rgba(255,60,60,0.04)", border: "1px solid rgba(255,60,60,0.25)" }}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-[9px] font-black" style={{ color: "#ff6655" }}>
                  rootfs: {sys.rootfs.present ? (sys.rootfs.prettyName ?? "Kali") : "مش منصّب"}
                </span>
                <span className="text-[8px] font-mono" style={{ color: sys.rootfs.guestShell ? "#44ff88" : "#ffaa44" }}>
                  {sys.rootfs.guestShell ? "✓ الضيف بيرد" : "✗ الضيف ما ردّش"}
                </span>
              </div>
              <p className="text-[8px] font-mono mt-1 break-all" style={{ color: "rgba(255,255,255,0.45)" }}>
                {sys.rootfs.reason
                  ? `✗ ${sys.rootfs.reason}`
                  : `${sys.rootfs.root} · ${human(sys.rootfs.bytes)} · ${sys.rootfs.packages ?? "?"} حزمة · ${sys.rootfs.executables ?? "?"} تنفيذي · proot: ${sys.rootfs.prootBin ?? "?"}`}
              </p>
            </div>

            {sys.unmeasured.length > 0 && (
              <div className="rounded-lg p-2 mt-2" style={{ background: "rgba(255,170,68,0.06)", border: "1px solid rgba(255,170,68,0.3)" }}>
                <p className="text-[9px] font-black" style={{ color: "#ffaa44" }}>⚠️ حاجات مش مقاسة (بصراحة، مش صفر)</p>
                <ul className="mt-1 space-y-0.5">
                  {sys.unmeasured.map((u, i) => (
                    <li key={i} className="text-[8px] font-mono" style={{ color: "rgba(255,170,68,0.85)" }}>• {u}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── كتالوج الأدوات: 11 تصنيف ─────────────────────────────────── */}
      <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] font-black flex items-center gap-1.5" style={{ color: "#ffaa44" }}>
            <Wrench className="w-3.5 h-3.5" /> كتالوج أدوات كالي — 11 تصنيف رسمي، كل أداة مقاسة
          </p>
          <div className="flex items-center gap-1.5">
            {cat?.ready && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(68,255,136,0.1)", color: "#44ff88" }}>
                {cat.present}/{cat.total} أداة · قياس على {cat.measuredOn}
              </span>
            )}
            <button onClick={() => void loadCat()} disabled={catBusy} className="text-[9px] px-2 py-1 rounded flex items-center gap-1"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.7)" }}>
              <RefreshCw className={`w-3 h-3 ${catBusy ? "animate-spin" : ""}`} /> {catBusy ? "بيقيس…" : "أعد القياس"}
            </button>
          </div>
        </div>

        {catErr ? (
          <p className="text-[9px] font-mono mt-2" style={{ color: "#ff6666" }}>✗ فشل جلب الكتالوج: {catErr}</p>
        ) : !cat ? (
          <p className="text-[9px] font-mono mt-2" style={{ color: "rgba(255,255,255,0.45)" }}>…بيقيس الأدوات جوه كالي</p>
        ) : !cat.ready ? (
          <div className="mt-2 rounded-lg p-2" style={{ background: "rgba(255,170,68,0.06)", border: "1px solid rgba(255,170,68,0.3)" }}>
            <p className="text-[9px] font-mono" style={{ color: "#ffaa44" }}>⚠️ {cat.reason}</p>
            <p className="text-[8px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
              الكتالوج معروض بالكامل تحت، وكل أداة معلّمة «مش منصّبة» — ده قياس صادق مش صفر مخفي.
            </p>
          </div>
        ) : null}

        {cat && (
          <div className="mt-2 space-y-1.5">
            {(cat.categories ?? []).map((c) => {
              const open = openCat === c.id;
              return (
                <div key={c.id} className="rounded-lg overflow-hidden" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <button onClick={() => setOpenCat(open ? null : c.id)} className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-right">
                    <span className="text-[10px] font-black" style={{ color: "#22d3ee" }}>
                      {open ? "▾" : "▸"} {CATEGORY_LABEL[c.id] ?? c.id}
                    </span>
                    <span className="text-[8px] font-mono" style={{ color: c.present === c.total ? "#44ff88" : c.present === 0 ? "rgba(255,255,255,0.3)" : "#ffaa44" }}>
                      {c.present}/{c.total}
                    </span>
                  </button>
                  {open && (
                    <div className="px-2 pb-2 space-y-1">
                      {c.tools.map((t) => (
                        <div key={t.name} className="rounded px-2 py-1.5" style={{ background: t.present ? "rgba(68,255,136,0.05)" : "rgba(255,255,255,0.02)", border: `1px solid ${t.present ? "rgba(68,255,136,0.22)" : "rgba(255,255,255,0.07)"}` }}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-[9px] font-mono font-black" style={{ color: t.present ? "#44ff88" : "rgba(255,255,255,0.35)" }}>
                              {t.present ? "✓" : "✗"} {t.name}
                            </span>
                            <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
                              {t.present ? (t.version ?? t.versionReason ?? "منصّبة") : "مش منصّبة"}
                            </span>
                          </div>
                          {t.recipe && (
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              <input
                                value={target[t.name] ?? ""}
                                onChange={(e) => setTarget((s) => ({ ...s, [t.name]: e.target.value }))}
                                placeholder={t.recipe.targetLabel}
                                className="flex-1 min-w-[120px] text-[8px] font-mono px-1.5 py-1 rounded outline-none"
                                style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)", color: "#e0e0e0" }}
                              />
                              <button
                                onClick={() => void runTool(t.name)}
                                disabled={runBusy !== null || !t.present}
                                title={t.present ? t.recipe.hint : "الأداة مش منصّبة — شغّل التثبيت الأول"}
                                className="text-[8px] font-black px-2 py-1 rounded flex items-center gap-1"
                                style={{
                                  background: t.present ? "rgba(68,255,136,0.12)" : "rgba(255,255,255,0.04)",
                                  border: `1px solid ${t.present ? "rgba(68,255,136,0.45)" : "rgba(255,255,255,0.1)"}`,
                                  color: t.present ? "#44ff88" : "rgba(255,255,255,0.3)",
                                }}>
                                <Play className="w-2.5 h-2.5" /> {runBusy === t.name ? "بيشتغل…" : "شغّل"}
                              </button>
                            </div>
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
      </div>

      {/* ── سجل التشغيل ──────────────────────────────────────────────── */}
      <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,170,0,0.25)" }}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black flex items-center gap-1.5" style={{ color: "#ffaa44" }}>
            <Terminal className="w-3.5 h-3.5" /> سجل تشغيل الأدوات — بث حي
          </p>
          <button onClick={() => setRunLog([])} className="text-[8px] px-2 py-0.5 rounded"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)" }}>
            مسح
          </button>
        </div>
        <div ref={logRef} className="mt-1.5 max-h-64 overflow-y-auto font-mono text-[9px] leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
          {runLog.length === 0 ? (
            <p style={{ color: "rgba(255,255,255,0.3)" }}>لسه مفيش تشغيل — اكتب هدف واضغط «شغّل» على أي أداة فوق.</p>
          ) : (
            runLog.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all" style={{
                color: l.kind === "err" ? "#ff8888" : l.kind === "cmd" ? "#44ff88" : l.kind === "meta" ? "#22d3ee" : "rgba(255,255,255,0.75)",
              }}>{l.text}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
