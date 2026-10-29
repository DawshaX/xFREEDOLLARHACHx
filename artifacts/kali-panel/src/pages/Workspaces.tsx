import { useState, useEffect } from "react";
import {
  Server, Plus, Wifi, WifiOff, RefreshCw, Loader2, Terminal,
  Trash2, Play, CheckCircle, XCircle, Clock, Skull,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";

interface Node { id: number; name: string; host: string; port: number; username: string; authType: string; status: string; lastPingedAt?: string; osInfo?: string; tags: string; isActive: boolean; hasCredential: boolean; }
interface NodeCommand { id: number; nodeId: number; command: string; stdout: string; stderr: string; exitCode?: number; status: string; startedAt: string; completedAt?: string; triggeredBy: string; }

const STATUS_COLOR: Record<string, string> = { online: "#44ff88", offline: "#ff4444", unknown: "#888888", error: "#ff8844" };
const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };
const inputStyle: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "monospace", padding: "8px 12px", outline: "none", width: "100%" };

export default function Workspaces() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [commands, setCommands] = useState<NodeCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [pinging, setPinging] = useState<number | null>(null);
  const [executing, setExecuting] = useState(false);
  const [cmdInput, setCmdInput] = useState("uname -a");
  const [form, setForm] = useState({ name: "", host: "", port: 22, username: "root", authType: "password", credential: "", tags: "" });

  async function load() {
    setLoading(true);
    try { const r = await jsonRequest<Node[]>("/nodes"); setNodes(r); } catch { }
    setLoading(false);
  }

  async function loadCommands(nodeId: number) {
    try { const r = await jsonRequest<NodeCommand[]>(`/nodes/${nodeId}/commands`); setCommands(r); } catch { setCommands([]); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => { if (selectedNode) void loadCommands(selectedNode.id); }, [selectedNode]);

  async function addNode() {
    if (!form.name || !form.host) return;
    const r = await jsonRequest<Node>("/nodes", { method: "POST", body: JSON.stringify(form) });
    setNodes((p) => [r, ...p]);
    setShowAdd(false);
    setForm({ name: "", host: "", port: 22, username: "root", authType: "password", credential: "", tags: "" });
  }

  async function pingNode(id: number) {
    setPinging(id);
    try {
      const r = await jsonRequest<Node>(`/nodes/${id}/ping`, { method: "POST" });
      setNodes((p) => p.map((n) => n.id === id ? { ...n, status: r.status, lastPingedAt: r.lastPingedAt } : n));
      if (selectedNode?.id === id) setSelectedNode((p) => p ? { ...p, status: r.status } : p);
    } catch { } finally { setPinging(null); }
  }

  async function execCommand() {
    if (!selectedNode || !cmdInput.trim()) return;
    setExecuting(true);
    try {
      const r = await jsonRequest<NodeCommand>(`/nodes/${selectedNode.id}/exec`, { method: "POST", body: JSON.stringify({ command: cmdInput }) });
      setCommands((p) => [r, ...p]);
    } catch { } finally { setExecuting(false); }
  }

  async function deleteNode(id: number) {
    if (!confirm("حذف هذا السيرفر؟")) return;
    await jsonRequest(`/nodes/${id}`, { method: "DELETE" });
    setNodes((p) => p.filter((n) => n.id !== id));
    if (selectedNode?.id === id) setSelectedNode(null);
  }

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ Workspaces" subtitle="إدارة سيرفرات متعددة وتنفيذ أوامر عن بُعد" icon={Server} danger
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-2 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 text-[11px] font-black font-mono px-3 py-2 rounded-xl transition-all"
              style={{ background: "rgba(255,30,30,0.1)", border: "1px solid rgba(255,30,30,0.3)", color: "#ff5555" }}>
              <Plus className="w-3.5 h-3.5" />إضافة سيرفر
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "إجمالي", value: nodes.length, color: "#4488ff", rgb: "68,136,255" },
          { label: "متصل", value: nodes.filter(n => n.status === "online").length, color: "#44ff88", rgb: "68,255,136" },
          { label: "غير متصل", value: nodes.filter(n => n.status === "offline").length, color: "#ff4444", rgb: "255,68,68" },
          { label: "غير معروف", value: nodes.filter(n => n.status === "unknown").length, color: "#888888", rgb: "136,136,136" },
        ].map(({ label, value, color, rgb }) => (
          <div key={label} className="rounded-xl p-4 text-center"
            style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.18)`, borderRadius: 16 }}>
            <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 12px rgba(${rgb},0.5)` }}>{value}</div>
            <div className="text-[9px] font-mono mt-1" style={{ color: `rgba(${rgb},0.5)` }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="rounded-2xl p-5 space-y-4" style={{ ...NEON_CARD, border: "1px solid rgba(255,30,30,0.22)" }}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ff5555" }}>
            <Plus className="w-4 h-4" />إضافة سيرفر جديد
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: "name", label: "الاسم *", placeholder: "Production Server", type: "text" },
              { key: "host", label: "الـ Host *", placeholder: "192.168.1.1", type: "text" },
              { key: "port", label: "المنفذ", placeholder: "22", type: "number" },
              { key: "username", label: "المستخدم", placeholder: "root", type: "text" },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <label className="text-[9px] font-black font-mono mb-1 block" style={{ color: "rgba(255,255,255,0.35)" }}>{label}</label>
                <input type={type} placeholder={placeholder}
                  value={String((form as Record<string, string | number>)[key])}
                  onChange={e => setForm(f => ({ ...f, [key]: type === "number" ? Number(e.target.value) : e.target.value }))}
                  style={inputStyle} />
              </div>
            ))}
            <div>
              <label className="text-[9px] font-black font-mono mb-1 block" style={{ color: "rgba(255,255,255,0.35)" }}>نوع المصادقة</label>
              <select value={form.authType} onChange={e => setForm(f => ({ ...f, authType: e.target.value }))}
                style={inputStyle as React.CSSProperties}>
                <option value="password">كلمة مرور</option>
                <option value="key">مفتاح SSH</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black font-mono mb-1 block" style={{ color: "rgba(255,255,255,0.35)" }}>
                {form.authType === "key" ? "مسار المفتاح" : "كلمة المرور"}
              </label>
              <input type={form.authType === "password" ? "password" : "text"}
                value={form.credential} onChange={e => setForm(f => ({ ...f, credential: e.target.value }))}
                style={inputStyle} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)}
              className="text-[11px] font-mono px-3 py-1.5 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>
              إلغاء
            </button>
            <button onClick={() => void addNode()}
              className="text-[11px] font-black font-mono px-4 py-1.5 rounded-xl transition-all"
              style={{ background: "rgba(255,30,30,0.12)", border: "1px solid rgba(255,30,30,0.32)", color: "#ff5555" }}>
              إضافة السيرفر
            </button>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Nodes List */}
        <div className="lg:col-span-1 space-y-2">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#ff5555" }} /></div>
          ) : nodes.length === 0 ? (
            <div className="rounded-2xl p-10 text-center space-y-3" style={NEON_CARD}>
              <Skull className="w-10 h-10 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد سيرفرات — أضف الأول الآن</p>
            </div>
          ) : nodes.map((node) => {
            const color = STATUS_COLOR[node.status] ?? "#888";
            const isSelected = selectedNode?.id === node.id;
            return (
              <div key={node.id} onClick={() => setSelectedNode(node)} className="rounded-xl p-4 cursor-pointer transition-all"
                style={{ background: isSelected ? "rgba(255,30,30,0.06)" : "rgba(8,0,18,0.95)", border: isSelected ? "1px solid rgba(255,30,30,0.3)" : "1px solid rgba(180,0,255,0.1)", borderRadius: 16 }}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {node.status === "online"
                        ? <Wifi className="w-3.5 h-3.5" style={{ color: "#44ff88" }} />
                        : <WifiOff className="w-3.5 h-3.5" style={{ color: "#ff4444" }} />}
                      <span className="font-black text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>{node.name}</span>
                    </div>
                    <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {node.username}@{node.host}:{node.port}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[9px] font-black font-mono px-1.5 py-0.5 rounded"
                        style={{ color, background: `${color}12`, border: `1px solid ${color}28` }}>
                        {node.status}
                      </span>
                      {node.osInfo && (
                        <span className="text-[9px] font-mono truncate" style={{ color: "rgba(255,255,255,0.25)" }}>
                          {node.osInfo.slice(0, 20)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={e => { e.stopPropagation(); void pingNode(node.id); }} disabled={pinging === node.id}
                      className="p-1.5 transition-all" style={{ color: "rgba(255,255,255,0.25)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#44eebb"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.25)"; }}>
                      {pinging === node.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={e => { e.stopPropagation(); void deleteNode(node.id); }}
                      className="p-1.5 transition-all" style={{ color: "rgba(255,255,255,0.25)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ff4444"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.25)"; }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Terminal Panel */}
        <div className="lg:col-span-2 space-y-4">
          {selectedNode ? (
            <>
              <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
                <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#44eebb" }}>
                  <Terminal className="w-4 h-4" />تنفيذ أمر على {selectedNode.name}
                </h3>
                <div className="flex gap-2">
                  <input className="flex-1" value={cmdInput} onChange={e => setCmdInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !executing) void execCommand(); }}
                    placeholder="اكتب أمر shell..." dir="ltr"
                    style={inputStyle} />
                  <button onClick={() => void execCommand()} disabled={executing}
                    className="flex items-center gap-1.5 text-[11px] font-black font-mono px-4 rounded-xl transition-all disabled:opacity-50"
                    style={{ background: "rgba(0,200,100,0.08)", border: "1px solid rgba(0,200,100,0.25)", color: "#44ff88" }}>
                    {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    تنفيذ
                  </button>
                </div>
              </div>

              <div className="rounded-2xl p-4 space-y-3" style={NEON_CARD}>
                <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "rgba(255,255,255,0.5)" }}>
                  <Clock className="w-4 h-4" />سجل الأوامر
                </h3>
                <div className="space-y-2 max-h-96 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                  {commands.length === 0 ? (
                    <div className="text-center text-[11px] font-mono py-6" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد أوامر منفذة</div>
                  ) : commands.map((cmd) => (
                    <div key={cmd.id} className="rounded-xl p-3 space-y-2" style={DARK}>
                      <div className="flex items-center gap-2">
                        {cmd.status === "completed" && cmd.exitCode === 0
                          ? <CheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: "#44ff88" }} />
                          : cmd.status === "failed" || (cmd.exitCode !== undefined && cmd.exitCode !== 0)
                          ? <XCircle className="w-3.5 h-3.5 shrink-0" style={{ color: "#ff4444" }} />
                          : <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: "#ffaa44" }} />}
                        <code className="text-[11px] font-mono flex-1" style={{ color: "#44eebb" }}>{cmd.command}</code>
                        <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>
                          {new Date(cmd.startedAt).toLocaleTimeString("ar-EG")}
                        </span>
                      </div>
                      {cmd.stdout && (
                        <pre className="text-[10px] font-mono rounded-lg p-2 overflow-x-auto max-h-32 overflow-y-auto"
                          style={{ background: "rgba(0,0,0,0.4)", color: "#44ff88", border: "1px solid rgba(0,255,0,0.1)" }}>
                          {cmd.stdout.slice(0, 500)}
                        </pre>
                      )}
                      {cmd.stderr && (
                        <pre className="text-[10px] font-mono rounded-lg p-2 overflow-x-auto"
                          style={{ background: "rgba(0,0,0,0.4)", color: "#ff6666", border: "1px solid rgba(255,0,0,0.1)" }}>
                          {cmd.stderr.slice(0, 200)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl flex items-center justify-center h-64 space-y-3 flex-col" style={NEON_CARD}>
              <Skull className="w-12 h-12" style={{ color: "rgba(255,255,255,0.05)" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>اختر سيرفراً للتحكم فيه</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
