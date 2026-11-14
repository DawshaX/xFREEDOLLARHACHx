import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Monitor, Play, RefreshCw, Square, Terminal, Wrench, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { pushNotify } from "@/lib/sse";

/**
 * TEST12 — «شغل نظام الكالي واعملو مكان وتبويب» — التبويبة المخصصة لبيئة كالي
 * الحقيقية المدمجة جوه البرنامج: الحالة والأدوات الثقيلة (metasploit/burp/zap)
 * مقاسة من rootfs نفسها، الديسكتوب الحي عبر الهَب (بيشتغل من nova.waifly.com
 * ومن أي دومين بيوصله)، طرفية تنفيذ حقيقي، وربط صريح باللايف أجينت (/agent-pro).
 * كل رقم هنا جاي من GET /api/ops/kali — بلا ادعاء.
 */
const API = "/api";

type HeavyTool = { present: boolean; version?: string };
type KaliStatus = {
  present: boolean;
  prettyName?: string;
  packages?: number;
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
  const [iframeKey, setIframeKey] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

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

  const exec = async (c: string) => {
    if (!c.trim() || execBusy) return;
    setExecBusy(true); setCmd("");
    setLog((p) => [...p, { text: `$ ${c}`, isCmd: true }]);
    try {
      const r = await fetch(`${API}/ops/kali/exec`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: c }),
      });
      const d = (await r.json()) as { stdout?: string; stderr?: string; exitCode?: number | null };
      const out = d.stdout || d.stderr || (d.exitCode === 0 ? "(بلا مخرجات)" : `exit=${d.exitCode}`);
      setLog((p) => [...p, { text: String(out).slice(0, 3000), isErr: d.exitCode !== 0 }]);
      pushNotify(d.exitCode === 0 ? "success" : "error", "كالي المدمجة", d.exitCode === 0 ? `اتنفّذ: ${c.slice(0, 50)}` : `خرج بكود ${d.exitCode}`);
    } catch (e: unknown) {
      setLog((p) => [...p, { text: e instanceof Error ? e.message : String(e), isErr: true }]);
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
            🐉 بيئة كالي الحقيقية المدمجة — جوه البرنامج نفسه
          </h1>
          <p className="text-[10px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
            rootfs كالي كاملة 100% بتشتغل بproot على الهَب · الديسكتوب بيتفتح من أي دومين بيوصل للهَب (nova.waifly.com) · الأجينت بيستخدمها بأداة kali_run
          </p>
        </div>
        <button onClick={() => navigate("/agent-pro")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all"
          style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.4)", color: "#22d3ee" }}>
          <ArrowLeft className="w-3.5 h-3.5" /> مكتب الشغل الحي (/agent-pro)
        </button>
      </div>

      {!st?.present ? (
        <div className="rounded-xl p-4" style={{ background: "rgba(255,170,0,0.05)", border: "1px solid rgba(255,170,0,0.3)" }}>
          <p className="text-[11px] font-bold" style={{ color: "#ffaa44" }}>البيئة مش مستخرجة على السيرفر الحالي</p>
          <p className="text-[10px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.55)" }}>
            أمر واحد بيسحبها من فرع kali-rootfs (بناء CI الرسمي — ببث streaming بيتحقق SHA256 لكل جزء):
            <code className="mx-1" style={{ color: "#ffdd88" }}>bash scripts/kali-rootfs-fetch.sh</code>
            — صادق عن مكانها: مفيش بيئة وهمية هنا.
          </p>
        </div>
      ) : (
        <>
          {/* الحالة المقاسة */}
          <div className="rounded-xl p-3" style={{ background: "rgba(255,60,60,0.04)", border: "1px solid rgba(255,60,60,0.3)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[11px] font-black" style={{ color: "#ff6655" }}>{st.prettyName ?? "Kali"}</span>
              <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>{st.packages ?? "?"} حزمة {st.builtAt ? `· بناء ${st.builtAt}` : ""}</span>
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
              + كل مجموعات كالي (information-gathering · vulnerability · web · database · passwords · wireless · reverse-engineering · exploitation · sniffing · social-engineering · post-exploitation · forensics) والتحميل الجديد جوه البيئة بـpip/git.
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

          {/* طرفية التنفيذ الحقيقي */}
          <div className="rounded-xl p-3" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,170,0,0.2)" }}>
            <p className="text-[10px] font-black mb-2 flex items-center gap-1.5" style={{ color: "#ffaa44" }}><Terminal className="w-3.5 h-3.5" /> طرفية كالي — تنفيذ حقيقي</p>
            <div className="flex flex-wrap gap-1 mb-2">
              {QUICK.map((c) => (
                <button key={c} onClick={() => exec(c)} disabled={execBusy} className="px-2 py-0.5 rounded text-[8px] font-mono" style={{ background: "rgba(255,170,0,0.05)", border: "1px solid rgba(255,170,0,0.2)", color: "rgba(255,170,0,0.75)" }}>
                  {c.split(" ")[0]}
                </button>
              ))}
            </div>
            <div ref={logRef} className="rounded-lg p-2 h-44 overflow-y-auto font-mono text-[9px] mb-2" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,170,0,0.15)" }}>
              {log.length === 0 ? <span style={{ color: "rgba(255,255,255,0.2)" }}>جاهز… كل أمر هنا بيتنفّذ فعليًا داخل البيئة</span> :
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

          {/* الربط بالأجينت */}
          <div className="rounded-xl p-3" style={{ background: "rgba(34,211,238,0.04)", border: "1px solid rgba(34,211,238,0.25)" }}>
            <p className="text-[10px] font-black" style={{ color: "#22d3ee" }}>🔗 الربط باللايف أجينت</p>
            <p className="text-[9px] font-mono mt-1 leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              الأجينت في <b>/agent-pro</b> عنده أداتين على البيئة دي مباشرة: <b>kali_run</b> (تنفيذ أي أمر) و<b>kali_desktop</b> (تشغيل/إطفاء/حالة + تحرك بالماوس بـxdotool) — وكل تنفيذ بيرفع إشعار حي بالlink.
            </p>
            <button onClick={() => navigate("/agent-pro")} className="mt-1.5 text-[9px] px-2 py-1 rounded" style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.4)", color: "#22d3ee" }}>
              افتح مكتب الشغل وجرّبها مع الأجينت ↗
            </button>
          </div>
        </>
      )}
    </div>
  );
}
