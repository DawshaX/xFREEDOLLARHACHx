import { useEffect, useState, useCallback } from "react";
import {
  Settings as SettingsIcon, Save, Check,  Server,
  Wifi, WifiOff, CheckCircle, XCircle, RefreshCw, Cpu, Database, Skull,
  ChevronRight, Terminal, Zap,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";
import { probeOllamaViaServer, saveOllamaSettings } from "@/lib/ollama-browser";

interface OllamaProbe { connected: boolean; models: string[]; error?: string; runningButNoCors?: boolean; notRunning?: boolean; }
interface SettingsResp { provider: string; model: string; ollamaBaseUrl?: string; ollamaModel?: string; }

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: "monospace", padding: "10px 14px", width: "100%", outline: "none" };

export default function Settings() {
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(
    () => localStorage.getItem("cybernova_ollama_base") || "http://127.0.0.1:11434"
  );
  const [ollamaModel, setOllamaModel] = useState(
    () => localStorage.getItem("cybernova_ollama_model") || "dolphin-llama3"
  );
  const [probe, setProbe] = useState<OllamaProbe | null>(null);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const runProbe = useCallback(async (_base?: string) => {
    setChecking(true);
    const result = await probeOllamaViaServer();
    setProbe(result);
    if (result.connected && result.models.length > 0) {
      const best = result.models.find(m => m.includes("dolphin-llama3")) ?? result.models[0];
      if (best && !result.models.includes(ollamaModel)) {
        setOllamaModel(best);
      }
    }
    setChecking(false);
  }, [ollamaModel]);

  const load = async () => {
    try {
      const data = await jsonRequest<SettingsResp>("/settings");
      const savedBase = data.ollamaBaseUrl || localStorage.getItem("cybernova_ollama_base") || "http://127.0.0.1:11434";
      const savedModel = data.ollamaModel || localStorage.getItem("cybernova_ollama_model") || "dolphin-llama3";
      setOllamaBaseUrl(savedBase);
      setOllamaModel(savedModel);
    } catch {}
  };

  const save = async () => {
    const base = ollamaBaseUrl.trim().replace(/\/$/, "");
    const model = ollamaModel.trim() || "dolphin-llama3";
    saveOllamaSettings(base, model);
    try {
      await jsonRequest("/settings", {
        method: "PUT",
        body: JSON.stringify({ provider: "ollama", model, ollamaBaseUrl: base, ollamaModel: model }),
      });
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await runProbe(base);
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { void runProbe(); }, []);

  const pickModel = (m: string) => {
    setOllamaModel(m);
    saveOllamaSettings(ollamaBaseUrl.replace(/\/$/, ""), m);
    jsonRequest("/settings", {
      method: "PUT",
      body: JSON.stringify({ ollamaBaseUrl: ollamaBaseUrl.replace(/\/$/, ""), ollamaModel: m }),
    }).catch(() => {});
  };

  const statusOk = probe?.connected;
  const statusCors = !probe?.connected && probe?.runningButNoCors;
  const statusDown = !probe?.connected && probe?.notRunning;

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚙ الإعدادات" subtitle="تكوين Ollama وحالة الخدمة — Ollama Only Mode" icon={SettingsIcon} danger />

      <div className="max-w-4xl mx-auto space-y-4">

        {/* ── Ollama Service Status ── */}
        <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
          <div className="flex items-center gap-3 mb-1">
            <Server className="w-5 h-5" style={{ color: "#4488ff" }} />
            <h2 className="text-base font-black" style={{ color: "#4488ff", textShadow: "0 0 10px rgba(0,100,255,0.4)" }}>حالة خدمة Ollama</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Connection status card */}
            <div className="rounded-xl p-4 space-y-2"
              style={statusOk
                ? { background: "rgba(0,200,100,0.06)", border: "1px solid rgba(0,200,100,0.2)" }
                : statusCors
                  ? { background: "rgba(255,200,0,0.06)", border: "1px solid rgba(255,200,0,0.2)" }
                  : { background: "rgba(255,30,30,0.06)", border: "1px solid rgba(255,30,30,0.2)" }}>
              <div className="flex items-center gap-2">
                {statusOk
                  ? <CheckCircle className="w-4 h-4" style={{ color: "#44ff88" }} />
                  : <XCircle className="w-4 h-4" style={{ color: statusCors ? "#ffc800" : "#ff5555" }} />}
                <span className="text-sm font-black" style={{ color: statusOk ? "#44ff88" : statusCors ? "#ffc800" : "#ff5555" }}>
                  {checking ? "جاري الفحص..." : statusOk ? "✓ متصل" : statusCors ? "⚠ CORS مطلوب" : "✗ غير متصل"}
                </span>
              </div>
              <div className="space-y-1 text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.45)" }}>
                <div>النموذج: <span style={{ color: "#aa44ff" }}>{ollamaModel}</span></div>
                {statusOk && probe.models.length > 0 && (
                  <div style={{ color: "#44ff88" }}>نماذج مثبتة: {probe.models.length}</div>
                )}
                {probe?.error && !statusOk && (
                  <div style={{ color: "#ff8888" }} dir="ltr">{probe.error}</div>
                )}
              </div>
            </div>

            {/* Network */}
            <div className="rounded-xl p-4 space-y-2"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2">
                {navigator.onLine
                  ? <Wifi className="w-4 h-4" style={{ color: "#44ff88" }} />
                  : <WifiOff className="w-4 h-4" style={{ color: "#ff5555" }} />}
                <span className="text-sm font-black" style={{ color: navigator.onLine ? "#44ff88" : "#ff5555" }}>
                  {navigator.onLine ? "الشبكة متصلة" : "الشبكة غير متصلة"}
                </span>
              </div>
              <div className="space-y-1 text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.45)" }}>
                <div>API Server: <span style={{ color: "#44ff88" }}>متصل</span></div>
                <div>Ollama URL: <span style={{ color: "#44eebb" }} dir="ltr">{ollamaBaseUrl}</span></div>
              </div>
            </div>
          </div>

          {/* Test button */}
          <div className="flex items-center gap-3">
            <button onClick={() => void runProbe()} disabled={checking}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-black text-[12px] font-mono transition-all disabled:opacity-50"
              style={{ background: "rgba(0,100,255,0.1)", border: "1px solid rgba(0,100,255,0.28)", color: "#4488ff" }}>
              <RefreshCw className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} />
              فحص الاتصال
            </button>
            {!statusOk && (
              <button onClick={() => setShowGuide(g => !g)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-mono transition-all"
                style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.2)", color: "#ffaa44" }}>
                <Terminal className="w-3.5 h-3.5" />
                كيف أشغّل Ollama؟
                <ChevronRight className={`w-3 h-3 transition-transform ${showGuide ? "rotate-90" : ""}`} />
              </button>
            )}
          </div>

          {/* Setup guide */}
          {(showGuide || (!statusOk && probe !== null)) && (
            <div className="rounded-xl p-4 space-y-3 text-[11px] font-mono"
              style={{ background: "rgba(255,100,0,0.04)", border: "1px solid rgba(255,100,0,0.15)" }}>
              <div className="font-black text-[12px]" style={{ color: "#ff9944" }}>
                {statusCors ? "⚠ Ollama شغّال لكن CORS مطلوب" : "❌ Ollama غير شغّال"}
              </div>
              <div style={{ color: "rgba(255,255,255,0.55)" }}>شغّل Ollama بهذا الأمر:</div>
              <div className="rounded-lg px-3 py-2 text-[11px] select-all" dir="ltr"
                style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#44ff88" }}>
                {statusCors
                  ? `OLLAMA_ORIGINS="*" ollama serve`
                  : `OLLAMA_ORIGINS="*" ollama serve`}
              </div>
              <div style={{ color: "rgba(255,255,255,0.4)" }}>على Windows:</div>
              <div className="rounded-lg px-3 py-2 text-[11px] select-all" dir="ltr"
                style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.08)", color: "#44eebb" }}>
                {`set OLLAMA_ORIGINS=* && ollama serve`}
              </div>
              <div style={{ color: "rgba(255,255,255,0.35)" }}>
                ثم نزّل نموذج: <span dir="ltr" style={{ color: "#aa88ff" }}>ollama pull dolphin-llama3</span>
              </div>
            </div>
          )}

          {/* Installed models list */}
          {statusOk && probe && probe.models.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-black font-mono uppercase tracking-widest" style={{ color: "#44ff88" }}>
                <Zap className="w-3 h-3 inline mb-0.5 mr-1" />
                النماذج المثبتة على جهازك ({probe.models.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {probe.models.map(m => (
                  <button key={m} onClick={() => pickModel(m)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-mono font-bold transition-all"
                    style={ollamaModel === m
                      ? { background: "rgba(100,0,255,0.25)", border: "1px solid rgba(100,0,255,0.5)", color: "#cc88ff" }
                      : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)" }}>
                    {ollamaModel === m && <Check className="w-3 h-3 inline mb-0.5 mr-1" />}
                    {m}
                  </button>
                ))}
              </div>
              <div className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                انقر على النموذج لتحديده — يُحفظ تلقائياً
              </div>
            </div>
          )}
        </div>

        {/* ── Ollama Configuration ── */}
        <div className="rounded-2xl p-5 space-y-5" style={NEON_CARD}>
          <div className="flex items-center gap-3">
            <Cpu className="w-5 h-5" style={{ color: "#aa44ff" }} />
            <h2 className="text-base font-black" style={{ color: "#aa44ff", textShadow: "0 0 10px rgba(170,0,255,0.4)" }}>إعدادات Ollama</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black font-mono mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>عنوان Ollama (Base URL)</label>
              <input type="url" value={ollamaBaseUrl} onChange={(e) => setOllamaBaseUrl(e.target.value)}
                style={inputStyle} placeholder="http://127.0.0.1:11434" dir="ltr" />
            </div>

            <div>
              <label className="block text-[10px] font-black font-mono mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
                النموذج (Model)
                {probe?.connected && probe.models.length > 0 && (
                  <span style={{ color: "#44ff88", marginRight: 8 }}>← اختر من القائمة أعلاه أو اكتب يدوياً</span>
                )}
              </label>
              <input type="text" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}
                style={inputStyle} placeholder="dolphin-llama3" dir="ltr" />
            </div>

            <div className="flex items-center gap-3">
              <button onClick={save}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-[12px] font-mono transition-all"
                style={{ background: "rgba(170,0,255,0.14)", border: "1px solid rgba(170,0,255,0.38)", color: "#cc66ff", boxShadow: "0 0 12px rgba(170,0,255,0.1)" }}>
                <Save className="w-4 h-4" />
                حفظ الإعدادات
              </button>
              {saved && (
                <div className="flex items-center gap-1 text-sm font-black font-mono" style={{ color: "#44ff88" }}>
                  <Check className="w-4 h-4" />تم الحفظ ✓
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── System Info ── */}
        <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5" style={{ color: "#44eebb" }} />
            <h2 className="text-base font-black" style={{ color: "#44eebb", textShadow: "0 0 10px rgba(0,240,180,0.3)" }}>معلومات النظام</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: "نموذج AI", value: ollamaModel, color: "#aa44ff" },
              { label: "قاعدة البيانات", value: "PostgreSQL", color: "#44ff88" },
              { label: "الوضع", value: "Ollama Only", color: "#ffaa44" },
              { label: "حالة Ollama", value: statusOk ? "متصل ✓" : statusCors ? "CORS مطلوب ⚠" : "غير متصل ✗", color: statusOk ? "#44ff88" : statusCors ? "#ffc800" : "#ff5555" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>{label}: </span>
                <span className="text-[11px] font-black font-mono" style={{ color }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Skull Banner ── */}
        <div className="rounded-2xl p-5 text-center" style={{ background: "rgba(255,0,0,0.03)", border: "1px solid rgba(255,0,0,0.08)", borderRadius: 16 }}>
          <Skull className="w-10 h-10 mx-auto mb-2" style={{ color: "rgba(255,30,30,0.25)", filter: "drop-shadow(0 0 8px rgba(255,0,0,0.2))" }} />
          <p className="text-[10px] font-black font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>
            ☠ CyberNova — يعمل في وضع Ollama المحلي فقط · لا اتصال خارجي مطلوب · جميع البيانات محلية
          </p>
        </div>
      </div>
    </div>
  );
}
