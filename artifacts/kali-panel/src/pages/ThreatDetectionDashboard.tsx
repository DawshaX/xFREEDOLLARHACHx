import { useState, useEffect, useRef } from "react";
import {
  Shield, AlertTriangle, Zap, Brain, RefreshCw,
  Plus, Activity, Server, Eye, Loader2, CheckCircle,
  XCircle, ChevronDown, ChevronRight, Radio,
} from "lucide-react";

const BASE = "/api";

interface Threat {
  id: number;
  title: string;
  description: string;
  sourceIp: string | null;
  targetIp: string | null;
  port: number | null;
  protocol: string | null;
  threatType: string | null;
  severity: string | null;
  rawData: string | null;
  aiAnalysis: string | null;
  analyzedAt: string | null;
  createdAt: string;
}

interface Stats {
  total: number;
  analyzed: number;
  pending: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#ff2244",
  HIGH: "#ff8800",
  MEDIUM: "#ffcc00",
  LOW: "#44aaff",
  UNKNOWN: "#888",
};

const SAMPLE_THREATS = [
  { title: "SSH Brute Force Attack", description: "Multiple failed SSH login attempts from external IP", sourceIp: "185.220.101.45", targetIp: "10.0.0.5", port: 22, protocol: "tcp", threatType: "Brute Force", severity: "HIGH", rawData: "Failed password for root from 185.220.101.45 port 49832 ssh2 (x847 attempts in 60s)" },
  { title: "SQL Injection Attempt", description: "Suspicious SQL injection payload detected in web request", sourceIp: "91.108.4.102", targetIp: "10.0.0.10", port: 443, protocol: "https", threatType: "SQL Injection", severity: "CRITICAL", rawData: "GET /login?id=1' OR 1=1-- HTTP/1.1 | User-Agent: sqlmap/1.7" },
  { title: "Suspicious Outbound DNS", description: "Unusual DNS queries to unknown domain indicating C2 activity", sourceIp: "10.0.0.20", targetIp: "8.8.8.8", port: 53, protocol: "udp", threatType: "C2 Communication", severity: "MEDIUM", rawData: "DNS query: a3f2b1c9.xyz TXT record | Encoded payload suspected" },
];

export default function ThreatDetectionDashboard() {
  const [threats, setThreats] = useState<Threat[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<Record<number, string>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchLog, setBatchLog] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ title: "", description: "", sourceIp: "", targetIp: "", rawData: "", threatType: "", severity: "HIGH" });
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadAll(); checkOllama(); }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [batchLog]);

  async function checkOllama() {
    try {
      const r = await fetch(`${BASE}/ollama/probe`);
      const d = await r.json();
      setOllamaOk(d.connected && d.models?.length > 0);
    } catch { setOllamaOk(false); }
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [tr, st] = await Promise.all([
        fetch(`${BASE}/threats?limit=50`).then(r => r.json()),
        fetch(`${BASE}/threats/stats`).then(r => r.json()),
      ]);
      setThreats(Array.isArray(tr) ? tr : []);
      setStats(st);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function analyzeThreat(id: number) {
    setAnalyzing(id);
    setAnalysis(a => ({ ...a, [id]: "" }));
    setExpanded(id);
    try {
      const resp = await fetch(`${BASE}/threats/${id}/analyze`, { method: "POST" });
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data:")) {
            try {
              const d = JSON.parse(line.slice(5));
              if (d.text) setAnalysis(a => ({ ...a, [id]: (a[id] || "") + d.text }));
            } catch { /* */ }
          }
        }
      }
    } catch (e) {
      setAnalysis(a => ({ ...a, [id]: `خطأ: ${(e as Error).message}` }));
    }
    setAnalyzing(null);
    await loadAll();
  }

  async function addSamples() {
    for (const s of SAMPLE_THREATS) {
      await fetch(`${BASE}/threats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    }
    await loadAll();
  }

  async function addThreat(e: React.FormEvent) {
    e.preventDefault();
    await fetch(`${BASE}/threats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(addForm) });
    setShowAdd(false);
    setAddForm({ title: "", description: "", sourceIp: "", targetIp: "", rawData: "", threatType: "", severity: "HIGH" });
    await loadAll();
  }

  async function runBatchAnalysis() {
    setBatchRunning(true);
    setBatchLog([]);
    try {
      const resp = await fetch(`${BASE}/threats/batch-analyze`, { method: "POST" });
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data:")) {
            try {
              const d = JSON.parse(line.slice(5));
              if (d.id && d.severity) setBatchLog(l => [...l, `✅ #${d.id} → ${d.severity}`]);
              else if (d.count !== undefined) setBatchLog(l => [...l, `🔍 تحليل ${d.count} تهديد...`]);
              else if (d.error) setBatchLog(l => [...l, `❌ خطأ: ${d.error}`]);
            } catch { /* */ }
          }
        }
      }
    } catch (e) {
      setBatchLog(l => [...l, `❌ ${(e as Error).message}`]);
    }
    setBatchRunning(false);
    await loadAll();
  }

  const NEON: React.CSSProperties = { background: "rgba(5,0,15,0.97)", borderRadius: 16, border: "1px solid rgba(180,0,255,0.15)" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#04000e 0%,#070018 60%,#03000c 100%)", color: "#e0d6ff", fontFamily: "monospace", padding: "24px 20px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,#ff2244,#8800ff)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 20px rgba(255,0,60,0.4)" }}>
          <Shield size={26} color="#fff" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, background: "linear-gradient(90deg,#ff2244,#cc44ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Threat Detection Dashboard
          </h1>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
            تحليل التهديدات في الوقت الفعلي بـ <span style={{ color: "#cc44ff" }}>dolphin-llama3 / Ollama</span>
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ padding: "4px 10px", borderRadius: 8, background: ollamaOk ? "rgba(0,255,100,0.1)" : "rgba(255,50,50,0.1)", border: `1px solid ${ollamaOk ? "rgba(0,255,100,0.3)" : "rgba(255,50,50,0.3)"}`, fontSize: 11, color: ollamaOk ? "#44ff88" : "#ff4444", display: "flex", alignItems: "center", gap: 5 }}>
            {ollamaOk ? <CheckCircle size={11} /> : <XCircle size={11} />}
            {ollamaOk === null ? "جارٍ الفحص..." : ollamaOk ? "Ollama متصل • dolphin-llama3" : "Ollama غير متاح"}
          </div>
          <button onClick={loadAll} style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#ccc", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
            <RefreshCw size={12} /> تحديث
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 24 }}>
          {[
            { label: "إجمالي التهديدات", val: stats.total, icon: <AlertTriangle size={18} />, color: "#ff8844" },
            { label: "تم تحليله", val: stats.analyzed, icon: <Brain size={18} />, color: "#44ff88" },
            { label: "في الانتظار", val: stats.pending, icon: <Activity size={18} />, color: "#ff2244" },
            { label: "CRITICAL", val: stats.bySeverity?.CRITICAL || 0, icon: <Zap size={18} />, color: "#ff2244" },
          ].map((s) => (
            <div key={s.label} style={{ ...NEON, padding: "14px 18px" }}>
              <div style={{ color: s.color, marginBottom: 6 }}>{s.icon}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 11, color: "#888" }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Action bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => setShowAdd(s => !s)} style={{ padding: "8px 14px", borderRadius: 8, background: "linear-gradient(90deg,#cc44ff,#8800ff)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
          <Plus size={14} /> إضافة تهديد
        </button>
        {threats.length === 0 && (
          <button onClick={addSamples} style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(255,136,68,0.15)", border: "1px solid rgba(255,136,68,0.3)", color: "#ff8844", cursor: "pointer", fontSize: 13 }}>
            📦 تحميل بيانات تجريبية
          </button>
        )}
        <button onClick={runBatchAnalysis} disabled={batchRunning || threats.length === 0} style={{ padding: "8px 14px", borderRadius: 8, background: batchRunning ? "rgba(200,68,255,0.1)" : "rgba(200,68,255,0.15)", border: "1px solid rgba(200,68,255,0.3)", color: "#cc44ff", cursor: batchRunning ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          {batchRunning ? <><Loader2 size={14} className="animate-spin" /> جارٍ التحليل...</> : <><Brain size={14} /> تحليل الكل بـ dolphin-llama3</>}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={addThreat} style={{ ...NEON, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { key: "title", label: "العنوان", ph: "e.g. SSH Brute Force" },
              { key: "threatType", label: "نوع التهديد", ph: "Malware / DDoS / ..." },
              { key: "sourceIp", label: "IP المصدر", ph: "185.220.101.x" },
              { key: "targetIp", label: "IP الهدف", ph: "10.0.0.x" },
            ].map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{f.label}</div>
                <input value={(addForm as any)[f.key]} onChange={e => setAddForm(a => ({ ...a, [f.key]: e.target.value }))} placeholder={f.ph}
                  style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "7px 10px", color: "#ddd", fontSize: 13 }} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>وصف / بيانات خام</div>
            <textarea value={addForm.description} onChange={e => setAddForm(a => ({ ...a, description: e.target.value }))} placeholder="وصف التهديد أو البيانات الخام للسجلات..."
              style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "7px 10px", color: "#ddd", fontSize: 13, minHeight: 80, resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="submit" style={{ padding: "8px 18px", borderRadius: 8, background: "linear-gradient(90deg,#ff2244,#cc00ff)", border: "none", color: "#fff", cursor: "pointer", fontWeight: 700 }}>حفظ</button>
            <button type="button" onClick={() => setShowAdd(false)} style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#888", cursor: "pointer" }}>إلغاء</button>
          </div>
        </form>
      )}

      {/* Batch log */}
      {batchLog.length > 0 && (
        <div ref={logRef} style={{ ...NEON, padding: 14, marginBottom: 18, maxHeight: 150, overflowY: "auto", fontSize: 12, lineHeight: 1.7, color: "#aaa" }}>
          {batchLog.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* Threats list */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#666" }}><Loader2 size={32} style={{ animation: "spin 1s linear infinite" }} /></div>
      ) : threats.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#555" }}>
          <Shield size={48} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div>لا توجد تهديدات مسجّلة.</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>أضف بيانات تجريبية أو أدخل تهديداً جديداً.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {threats.map(t => {
            const sevColor = SEV_COLOR[t.severity?.toUpperCase() || "UNKNOWN"] || "#888";
            const isExpanded = expanded === t.id;
            const isAnalyzingThis = analyzing === t.id;
            return (
              <div key={t.id} style={{ ...NEON, overflow: "hidden", borderColor: isExpanded ? "rgba(200,68,255,0.25)" : undefined }}>
                {/* Row */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer" }} onClick={() => setExpanded(isExpanded ? null : t.id)}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: sevColor, boxShadow: `0 0 8px ${sevColor}`, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#ddd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                      {t.sourceIp && <span>🔴 {t.sourceIp}</span>}
                      {t.targetIp && <span style={{ marginLeft: 8 }}>🎯 {t.targetIp}</span>}
                      {t.port && <span style={{ marginLeft: 8 }}>:{t.port}</span>}
                      {t.threatType && <span style={{ marginLeft: 8, color: "#888" }}>• {t.threatType}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {t.severity && <span style={{ padding: "2px 8px", borderRadius: 6, background: `${sevColor}20`, border: `1px solid ${sevColor}40`, color: sevColor, fontSize: 11, fontWeight: 700 }}>{t.severity}</span>}
                    {t.aiAnalysis ? <CheckCircle size={14} color="#44ff88" /> : <Eye size={14} color="#555" />}
                    {isExpanded ? <ChevronDown size={14} color="#666" /> : <ChevronRight size={14} color="#666" />}
                  </div>
                </div>

                {/* Expanded */}
                {isExpanded && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "14px 16px" }}>
                    {t.description && <div style={{ fontSize: 13, color: "#999", marginBottom: 12 }}>{t.description}</div>}
                    {t.rawData && (
                      <pre style={{ background: "rgba(0,0,0,0.4)", borderRadius: 8, padding: 10, fontSize: 11, color: "#7af", overflowX: "auto", marginBottom: 12, whiteSpace: "pre-wrap" }}>{t.rawData}</pre>
                    )}

                    {/* AI Analysis */}
                    {(t.aiAnalysis || analysis[t.id]) ? (
                      <div style={{ background: "rgba(200,68,255,0.04)", borderRadius: 10, border: "1px solid rgba(200,68,255,0.15)", padding: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          <Brain size={14} color="#cc44ff" />
                          <span style={{ fontSize: 11, color: "#cc44ff", fontWeight: 700 }}>تحليل dolphin-llama3</span>
                          {isAnalyzingThis && <span style={{ fontSize: 10, color: "#888" }}>جارٍ التحليل...</span>}
                        </div>
                        <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                          {analysis[t.id] || t.aiAnalysis}
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => analyzeThreat(t.id)} disabled={isAnalyzingThis} style={{ padding: "8px 16px", borderRadius: 8, background: "linear-gradient(90deg,rgba(200,68,255,0.2),rgba(136,0,255,0.2))", border: "1px solid rgba(200,68,255,0.3)", color: "#cc44ff", cursor: isAnalyzingThis ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        {isAnalyzingThis ? <><Loader2 size={13} /> جارٍ التحليل...</> : <><Brain size={13} /> تحليل بـ dolphin-llama3</>}
                      </button>
                    )}

                    <div style={{ fontSize: 10, color: "#444", marginTop: 8 }}>
                      {t.analyzedAt ? `✅ تم التحليل: ${new Date(t.analyzedAt).toLocaleString("ar")}` : "⏳ لم يتم التحليل بعد"} • {new Date(t.createdAt).toLocaleString("ar")}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
