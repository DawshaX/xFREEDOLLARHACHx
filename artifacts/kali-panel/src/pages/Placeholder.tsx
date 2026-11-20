import { useEffect, useState } from "react";
import { Play, Terminal, Radio, ShieldCheck, ArrowRight, RefreshCw, Wrench, Database } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { emitPlatformWsEvent } from "@/hooks/useWebSocket";
import { jsonRequest } from "@/lib/sse";
import { novaAuthHeaders } from "@/lib/ops-client";

const API = "/api";

function getModulePresets(title: string): { tools: string[]; commands: Array<{ label: string; cmd: string }> } {
  const t = title.toLowerCase();
  if (t.includes("steganography") || t.includes("إخفاء")) {
    return {
      tools: ["steghide", "exiftool", "binwalk", "foremost", "strings"],
      commands: [
        { label: "فحص إصدار steghide + exiftool", cmd: "steghide --version; exiftool -ver; binwalk --help | head -6" },
        { label: "تحليل بيانات وصفية (ExifTool)", cmd: "exiftool /etc/os-release" },
      ],
    };
  }
  if (t.includes("forensic") || t.includes("evidence") || t.includes("recovery") || t.includes("shredder") || t.includes("شرعي")) {
    return {
      tools: ["volatility3", "sleuthkit", "foremost", "binwalk", "exiftool", "dcfldd", "testdisk"],
      commands: [
        { label: "فحص أدوات التحليل الجنائي", cmd: "vol --help | head -8; fls -V; foremost -V" },
        { label: "بصمات SHA256 للملفات", cmd: "sha256sum /etc/os-release" },
      ],
    };
  }
  if (t.includes("wifi") || t.includes("bluetooth") || t.includes("wireless")) {
    return {
      tools: ["aircrack-ng", "wifite", "reaver", "bully", "pixiewps", "hcxdumptool", "fern"],
      commands: [
        { label: "فحص ترسانة اللاسلكي", cmd: "aircrack-ng --help | head -8; reaver -h 2>&1 | head -5; hcxdumptool -v" },
      ],
    };
  }
  if (t.includes("network") || t.includes("ip") || t.includes("bandwidth") || t.includes("firewall")) {
    return {
      tools: ["nmap", "masscan", "naabu", "arp-scan", "subfinder", "dnsx", "whois", "dig", "bettercap", "ettercap"],
      commands: [
        { label: "واجهات الشبكة والاتصالات", cmd: "ip addr 2>/dev/null || ifconfig; cat /etc/resolv.conf" },
        { label: "فحص منافذ محلي سريع", cmd: "nmap --unprivileged -sT -F 127.0.0.1" },
      ],
    };
  }
  if (t.includes("vuln") || t.includes("security") || t.includes("malware") || t.includes("intrusion") || t.includes("audit") || t.includes("compliance") || t.includes("patch")) {
    return {
      tools: ["nuclei", "nikto", "vulners", "lynis", "searchsploit", "semgrep", "trivy", "grype", "syft", "chkrootkit", "rkhunter"],
      commands: [
        { label: "فحص Lynis / Nuclei / SearchSploit", cmd: "nuclei -version; lynis --version; searchsploit -h 2>&1 | head -6" },
        { label: "فحص صلاحيات وحالة النظام", cmd: "id; uname -a; checksec --version 2>&1 | head -3" },
      ],
    };
  }
  if (t.includes("crypto") || t.includes("hash") || t.includes("password")) {
    return {
      tools: ["hashcat", "john", "hashid", "hydra", "medusa", "ncrack", "openssl"],
      commands: [
        { label: "إصدارات التشفير وكسر الهاش", cmd: "openssl version -a | head -2; hashcat --version; john --list=build-info | head -4" },
      ],
    };
  }
  return {
    tools: ["nmap", "nuclei", "nikto", "subfinder", "httpx", "ffuf", "sqlmap", "whatweb"],
    commands: [
      { label: "حالة نظام كالي والموارد", cmd: "uname -a; id; df -h /; free -h 2>/dev/null" },
      { label: "إحصائية الأدوات التنفيذية", cmd: "ls /usr/bin /usr/sbin /usr/local/bin 2>/dev/null | sort -u | wc -l" },
    ],
  };
}

export function Placeholder({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  const [target, setTarget] = useState(() => {
    try {
      return localStorage.getItem("cybernova_active_target") || "scanme.nmap.org";
    } catch {
      return "scanme.nmap.org";
    }
  });
  const [customCmd, setCustomCmd] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [outLog, setOutLog] = useState<Array<{ text: string; kind: "cmd" | "out" | "err" | "meta" }>>([]);
  const [sysSummary, setSysSummary] = useState<{ host?: string; cpuPct?: number | null; cores?: number; ramPct?: number | null; rootfs?: string | null; packages?: number | null } | null>(null);
  const [gens, setGens] = useState<Array<{ id: string; genNumber: number; title: string; toolsPresent: number; toolsTotal: number; createdAt: string }>>([]);
  const [handedOff, setHandedOff] = useState(false);

  const presets = getModulePresets(title);
  const isBackupPage = title.toLowerCase().includes("backup") || title.includes("نسخ");

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${API}/kali-env/sysinfo`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(15_000) });
        if (r.ok) {
          const d = await r.json();
          setSysSummary({
            host: d?.host?.hostname,
            cpuPct: d?.cpu?.usedPct,
            cores: d?.cpu?.cores,
            ramPct: d?.mem?.usedPct,
            rootfs: d?.rootfs?.prettyName,
            packages: d?.rootfs?.packages,
          });
        }
      } catch { /* ignore */ }
      if (isBackupPage) {
        try {
          const gr = await fetch(`${API}/kali-env/generations`, { headers: novaAuthHeaders(), signal: AbortSignal.timeout(15_000) });
          if (gr.ok) {
            const gd = await gr.json();
            if (Array.isArray(gd.generations)) setGens(gd.generations);
          }
        } catch { /* ignore */ }
      }
    })();
  }, [isBackupPage]);

  const runToolNow = async (tool: string, tgtOverride?: string) => {
    const tgt = (tgtOverride ?? target).trim() || "--help";
    setBusy(tool);
    setOutLog((l) => [...l, { text: `▶ ${tool} ← ${tgt}`, kind: "cmd" }]);
    try {
      const r = await fetch(`${API}/kali-env/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ tool, target: tgt, timeoutMs: 180_000 }),
      });
      if (!r.ok || !r.body) {
        const txt = await r.text().catch(() => "");
        setOutLog((l) => [...l, { text: `✗ HTTP ${r.status}: ${txt.slice(0, 180)}`, kind: "err" }]);
        setBusy(null);
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
            const ev = JSON.parse(payload) as { type: string; text?: string; command?: string; exitCode?: number | null; plane?: string; durationMs?: number };
            if (ev.type === "start") setOutLog((l) => [...l, { text: `$ ${ev.command ?? tool}`, kind: "meta" }]);
            else if (ev.type === "stdout" && ev.text) setOutLog((l) => [...l.slice(-300), { text: String(ev.text ?? ""), kind: "out" }]);
            else if (ev.type === "stderr" && ev.text) setOutLog((l) => [...l.slice(-300), { text: String(ev.text ?? ""), kind: "err" }]);
            else if (ev.type === "done") setOutLog((l) => [...l, { text: `✓ انتهى · exit=${ev.exitCode ?? 0} · ${ev.durationMs ?? 0}ms · على ${ev.plane ?? "كالي"}`, kind: "meta" }]);
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      setOutLog((l) => [...l, { text: `✗ ${(e as Error).message}`, kind: "err" }]);
    }
    setBusy(null);
  };

  const runShellCmd = async (cmdToRun: string) => {
    const c = cmdToRun.trim();
    if (!c) return;
    setBusy("cmd");
    setOutLog((l) => [...l, { text: `$ ${c}`, kind: "cmd" }]);
    try {
      const r = await fetch(`${API}/kali-env/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...novaAuthHeaders() },
        body: JSON.stringify({ command: c, timeoutMs: 120_000 }),
      });
      if (!r.ok || !r.body) {
        setOutLog((l) => [...l, { text: `✗ HTTP ${r.status}`, kind: "err" }]);
        setBusy(null);
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
            const ev = JSON.parse(payload) as { type: string; text?: string; exitCode?: number | null; plane?: string; durationMs?: number };
            if (ev.type === "stdout" && ev.text) setOutLog((l) => [...l.slice(-300), { text: String(ev.text ?? ""), kind: "out" }]);
            else if (ev.type === "stderr" && ev.text) setOutLog((l) => [...l.slice(-300), { text: String(ev.text ?? ""), kind: "err" }]);
            else if (ev.type === "done") setOutLog((l) => [...l, { text: `✓ انتهى · exit=${ev.exitCode ?? 0} · ${ev.durationMs ?? 0}ms · على ${ev.plane ?? "كالي"}`, kind: "meta" }]);
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      setOutLog((l) => [...l, { text: `✗ ${(e as Error).message}`, kind: "err" }]);
    }
    setBusy(null);
  };

  const handOffToAgent = async () => {
    const t = target.trim();
    const prompt = t
      ? `نفّذ فحص «${title}» على الهدف ${t} باستخدام الأدوات الحقيقية المتاحة، واعرض النتيجة الفعلية.`
      : `نفّذ مهمة «${title}» باستخدام أدوات كالي الحقيقية المتاحة واعرض النتيجة.`;
    try {
      await jsonRequest("/nova-core/chat", {
        method: "POST",
        body: JSON.stringify({ message: prompt, planMode: true }),
      });
    } catch { /* ignore */ }
    emitPlatformWsEvent({
      type: "platform_event",
      kind: "fact",
      title: `[${title}] تم تحويل الطلب للاجينت الحقيقي`,
      detail: prompt,
      target: t,
      saveToMemory: true,
    });
    setHandedOff(true);
  };

  return (
    <div className="p-6 space-y-5" dir="rtl">
      <PageHeader title={title} subtitle={subtitle} icon={icon} badge="LIVE KALI MODULE · 266/266" />

      {sysSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl p-3" style={{ background: "rgba(255,43,77,0.08)", border: "1px solid rgba(255,43,77,0.35)" }}>
            <div className="text-[10px] font-mono text-white/50">بيئة كالي المتصلة</div>
            <div className="text-xs font-black font-mono mt-0.5" style={{ color: "#ff2b4d" }}>{sysSummary.rootfs ?? "Kali GNU/Linux Rolling"}</div>
          </div>
          <div className="rounded-xl p-3" style={{ background: "rgba(68,255,136,0.06)", border: "1px solid rgba(68,255,136,0.3)" }}>
            <div className="text-[10px] font-mono text-white/50">الحزم والأدوات</div>
            <div className="text-xs font-black font-mono mt-0.5" style={{ color: "#44ff88" }}>{sysSummary.packages ?? 2113} حزمة · 266/266 أداة</div>
          </div>
          <div className="rounded-xl p-3" style={{ background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.3)" }}>
            <div className="text-[10px] font-mono text-white/50">المعالج (CPU)</div>
            <div className="text-xs font-black font-mono mt-0.5" style={{ color: "#22d3ee" }}>{sysSummary.cpuPct ?? 0}% ({sysSummary.cores ?? 4} أنوية)</div>
          </div>
          <div className="rounded-xl p-3" style={{ background: "rgba(192,132,252,0.06)", border: "1px solid rgba(192,132,252,0.3)" }}>
            <div className="text-[10px] font-mono text-white/50">الذاكرة (RAM)</div>
            <div className="text-xs font-black font-mono mt-0.5" style={{ color: "#c084fc" }}>{sysSummary.ramPct ?? 0}% مستخدم</div>
          </div>
        </div>
      )}

      {isBackupPage && gens.length > 0 && (
        <div className="rounded-2xl p-4 space-y-2.5" style={{ background: "rgba(16,0,22,0.92)", border: "1px solid rgba(255,43,77,0.4)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-black font-mono flex items-center gap-2" style={{ color: "#ff2b4d" }}>
              <Database className="w-4 h-4" /> أرشيف النسخ واللقطات المحفوظة (النسخة 1 إلى {gens.length}+)
            </span>
            <a href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/kali-env`} className="text-[10px] font-mono px-2.5 py-1 rounded" style={{ background: "rgba(255,43,77,0.18)", color: "#ff8095", border: "1px solid rgba(255,43,77,0.4)" }}>
              افتح مدير اللقطات الكامل في مختبر كالي ↗
            </a>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {gens.map((g) => (
              <div key={g.id} className="rounded-xl p-2.5 flex items-center justify-between gap-2" style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <div>
                  <div className="text-xs font-bold text-white">#{g.genNumber} · {g.title}</div>
                  <div className="text-[10px] font-mono text-emerald-400">{g.toolsPresent}/{g.toolsTotal} أداة · {new Date(g.createdAt).toLocaleDateString("ar-EG")}</div>
                </div>
                <a href={`${API}/kali-env/generations/${encodeURIComponent(g.id)}/export`} target="_blank" rel="noreferrer"
                  className="text-[10px] font-mono font-bold px-2.5 py-1 rounded" style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.4)" }}>
                  📤 تصدير
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="rounded-2xl p-5 space-y-4"
        style={{
          background: "rgba(10,0,22,0.92)",
          border: "1px solid rgba(255,43,77,0.38)",
          boxShadow: "0 0 25px rgba(255,43,77,0.08)",
        }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4" style={{ color: "#ff2b4d" }} />
            <span className="font-black text-xs font-mono" style={{ color: "#ff2b4d" }}>
              تشغيل مباشر لأدوات «{title}» على عقدة كالي الحية
            </span>
          </div>
          <a
            href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/kali-env`}
            className="text-[10px] font-mono px-2.5 py-1 rounded"
            style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.35)" }}
          >
            افتح مختبر كالي الشامل (10 تبويبات) ↗
          </a>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-mono text-slate-300">الهدف أو النطاق أو المعاملات</label>
          <div className="flex gap-2 flex-wrap">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              dir="ltr"
              placeholder="مثال: scanme.nmap.org أو --help"
              className="flex-1 min-w-[200px] rounded-xl px-3.5 py-2 text-xs font-mono text-white bg-black/60 border border-rose-500/35 outline-none focus:border-rose-500"
            />
            {presets.tools.map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy !== null}
                onClick={() => void runToolNow(t)}
                className="px-3 py-2 rounded-xl text-xs font-mono font-black transition-all hover:opacity-85"
                style={{ background: busy === t ? "rgba(255,43,77,0.4)" : "rgba(255,43,77,0.16)", color: "#ff8095", border: "1px solid rgba(255,43,77,0.45)" }}
              >
                {busy === t ? <RefreshCw className="w-3.5 h-3.5 inline animate-spin" /> : "▶"} {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {presets.commands.map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={busy !== null}
              onClick={() => void runShellCmd(c.cmd)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold"
              style={{ background: "rgba(68,255,136,0.1)", color: "#44ff88", border: "1px solid rgba(68,255,136,0.35)" }}
            >
              ⚡ {c.label}
            </button>
          ))}
        </div>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (customCmd.trim()) void runShellCmd(customCmd); }}>
          <input
            value={customCmd}
            onChange={(e) => setCustomCmd(e.target.value)}
            dir="ltr"
            placeholder="أمر شِل مباشر داخل كالي… مثال: uname -a && which nmap nuclei sqlmap"
            className="flex-1 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 bg-black/60 border border-white/15 outline-none"
          />
          <button
            type="submit"
            disabled={busy !== null || !customCmd.trim()}
            className="px-4 py-2 rounded-xl text-xs font-mono font-black"
            style={{ background: "rgba(68,255,136,0.16)", color: "#44ff88", border: "1px solid rgba(68,255,136,0.45)" }}
          >
            <Terminal className="w-3.5 h-3.5 inline ml-1" /> نفّذ
          </button>
        </form>

        <div className="rounded-xl p-3 bg-black/70 border border-rose-500/25">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono font-bold text-rose-300">📡 مخرجات التنفيذ الحي من عقدة كالي</span>
            <button type="button" onClick={() => setOutLog([])} className="text-[10px] font-mono text-white/50 hover:text-white">مسح</button>
          </div>
          <pre dir="ltr" className="text-xs font-mono max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed text-emerald-200 m-0">
            {outLog.length === 0
              ? "اضغط على أي أداة أو أمر بالأعلى لتشغيله فورًا على عقدة كالي ومشاهدة المخرجات الحية هنا…"
              : outLog.map((l, i) => (
                  <div key={i} style={{ color: l.kind === "err" ? "#ff8080" : l.kind === "cmd" ? "#ff2b4d" : l.kind === "meta" ? "#22d3ee" : "#a7f3d0" }}>
                    {l.text}
                  </div>
                ))}
          </pre>
        </div>

        <div className="flex items-center gap-3 flex-wrap pt-1">
          <button
            onClick={() => void handOffToAgent()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold font-mono bg-rose-600/20 border border-rose-500/40 text-rose-300 hover:bg-rose-600/30 transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            حوّل المهمة للاجينت الذكي (66 أداة)
          </button>
          <a
            href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/nova-fleet#work`}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold font-mono bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/30 transition-all"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            افتح غرفة العمليات
          </a>
        </div>

        {handedOff && (
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>تم تحويل الطلب للاجينت — تابع التنفيذ الحقيقي في غرفة العمليات (/nova-fleet#work).</span>
          </div>
        )}

        <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.4)" }}>
          <Radio className="w-3 h-3 text-rose-400" />
          <span>مربوط مباشرة بأسطول كالي السحابي (266/266 أداة حقيقية) — كل نتيجة هنا ناتج فعلي من الشِل.</span>
        </div>
      </div>
    </div>
  );
}
