import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Server,
  Wifi,
  WifiOff,
  Trash2,
  Pencil,
  Play,
  Loader2,
  RefreshCw,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";

const API_BASE = "/api";

interface NodeRow {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  status: string;
  lastPingedAt: string | null;
  osInfo?: string | null;
  tags?: string;
  isActive: boolean;
  hasCredential: boolean;
}

interface PingResult {
  nodeId: number;
  online: boolean;
  latencyMs: number;
  error?: string;
}

interface ExecResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  command: string;
  host: string;
}

const EMPTY_FORM = {
  id: 0 as number | null,
  name: "",
  host: "",
  port: 22,
  username: "root",
  authType: "password" as "password" | "key",
  credential: "",
  tags: "",
};

export function NodesWindow() {
  const [rows, setRows] = useState<NodeRow[]>([]);
  const [pings, setPings] = useState<Record<number, PingResult>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cmd, setCmd] = useState("");
  const [exec, setExec] = useState<ExecResult | null>(null);
  const [execBusy, setExecBusy] = useState(false);
  const [bulkPinging, setBulkPinging] = useState(false);
  const outRef = useRef<HTMLPreElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/nodes`);
      if (r.ok) {
        const data = (await r.json()) as NodeRow[];
        setRows(data);
        if (selected && !data.find((d) => d.id === selected)) setSelected(null);
      }
    } finally {
      setLoading(false);
    }
  }, [selected]);

  const pingAll = useCallback(async () => {
    setBulkPinging(true);
    try {
      const r = await fetch(`${API_BASE}/nodes/ping-all`, { method: "POST" });
      if (r.ok) {
        const j = (await r.json()) as { results: PingResult[] };
        const map: Record<number, PingResult> = {};
        for (const p of j.results) map[p.nodeId] = p;
        setPings(map);
        await reload();
      }
    } finally {
      setBulkPinging(false);
    }
  }, [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Auto ping every 15s
  useEffect(() => {
    if (rows.length === 0) return;
    void pingAll();
    const t = setInterval(() => {
      void pingAll();
    }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [exec]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (n: NodeRow) => {
    setForm({
      id: n.id,
      name: n.name,
      host: n.host,
      port: n.port,
      username: n.username,
      authType: n.authType,
      credential: "",
      tags: n.tags ?? "",
    });
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isEdit = form.id && form.id > 0;
    const url = isEdit ? `${API_BASE}/nodes/${form.id}` : `${API_BASE}/nodes`;
    const method = isEdit ? "PUT" : "POST";
    const body = JSON.stringify({
      name: form.name,
      host: form.host,
      port: Number(form.port) || 22,
      username: form.username,
      authType: form.authType,
      credential: form.credential,
      tags: form.tags,
    });
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (r.ok) {
      setShowForm(false);
      await reload();
    } else {
      alert("فشل الحفظ");
    }
  };

  const remove = async (id: number) => {
    if (!confirm("حذف الـ node؟")) return;
    await fetch(`${API_BASE}/nodes/${id}`, { method: "DELETE" });
    await reload();
  };

  const runCmd = async () => {
    if (!selected || !cmd.trim()) return;
    setExecBusy(true);
    setExec(null);
    try {
      const r = await fetch(`${API_BASE}/nodes/${selected}/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, triggeredBy: "panel" }),
      });
      if (r.ok) setExec((await r.json()) as ExecResult);
      else setExec({ output: `HTTP ${r.status}`, exitCode: -1, timedOut: false, command: cmd, host: "" });
    } catch (e) {
      setExec({
        output: e instanceof Error ? e.message : "خطأ غير معروف",
        exitCode: -1,
        timedOut: false,
        command: cmd,
        host: "",
      });
    } finally {
      setExecBusy(false);
    }
  };

  const selectedNode = rows.find((r) => r.id === selected) || null;

  return (
    <div className="flex h-full text-foreground">
      {/* Left: nodes list */}
      <div className="w-[260px] shrink-0 border-l border-primary/15 bg-card/40 flex flex-col">
        <div className="p-2 flex items-center gap-2 border-b border-primary/15">
          <button
            onClick={openCreate}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-primary/15 hover:bg-primary/25 border border-primary/30 text-primary text-xs font-mono"
            data-testid="nodes-add"
          >
            <Plus className="w-3.5 h-3.5" /> إضافة Node
          </button>
          <button
            onClick={() => void pingAll()}
            disabled={bulkPinging || rows.length === 0}
            className="px-2 py-1.5 rounded border border-border/40 hover:border-primary/40 text-muted-foreground hover:text-primary"
            title="فحص الكل"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${bulkPinging ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1.5" data-testid="nodes-list">
          {loading && rows.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-6">
              جاري التحميل...
            </div>
          )}
          {!loading && rows.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8 leading-relaxed">
              <Server className="w-7 h-7 mx-auto mb-2 text-primary/40" />
              لا توجد خوادم بعد. أضف أول SSH node
            </div>
          )}
          {rows.map((n) => {
            const p = pings[n.id];
            const isOnline = p ? p.online : n.status === "online";
            return (
              <div
                key={n.id}
                onClick={() => setSelected(n.id)}
                className={`group rounded-lg p-2.5 border cursor-pointer transition ${
                  selected === n.id
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/40 hover:border-primary/40 bg-background/30"
                }`}
                data-testid={`node-${n.id}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {isOnline ? (
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  )}
                  <span className="text-xs font-bold truncate flex-1">{n.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(n);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(n.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-400"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground truncate">
                  {n.username}@{n.host}:{n.port}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[9px] font-mono">
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      isOnline
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30"
                        : "bg-rose-500/10 text-rose-300 border border-rose-400/20"
                    }`}
                  >
                    {isOnline ? "ONLINE" : "OFFLINE"}
                  </span>
                  {p && (
                    <span className="text-cyan-300">{p.latencyMs}ms</span>
                  )}
                  {n.tags && (
                    <span className="text-muted-foreground truncate">{n.tags}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: detail + exec */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedNode ? (
          <>
            <div className="px-4 py-3 border-b border-primary/15 bg-card/30">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold flex items-center gap-2">
                    <Server className="w-4 h-4 text-primary" />
                    {selectedNode.name}
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground mt-0.5 truncate">
                    {selectedNode.username}@{selectedNode.host}:{selectedNode.port} · {selectedNode.authType}
                    {!selectedNode.hasCredential && (
                      <span className="ml-2 text-amber-300">⚠ بدون اعتماديات</span>
                    )}
                  </div>
                </div>
                {pings[selectedNode.id] && (
                  <div className="text-[10px] font-mono text-cyan-300">
                    {pings[selectedNode.id].latencyMs}ms
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-3">
              <div className="text-[10px] font-mono text-muted-foreground mb-2">
                نفّذ أمراً عن بُعد عبر SSH — السيرفر يستخدم sshpass + StrictHostKeyChecking=no
              </div>
              <div className="flex items-center gap-2 mb-2">
                <TerminalIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                <input
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runCmd();
                  }}
                  placeholder="مثلاً: uname -a && uptime"
                  className="flex-1 bg-background/60 border border-primary/20 rounded px-3 py-1.5 text-xs font-mono outline-none focus:border-primary/50"
                  data-testid="node-cmd-input"
                />
                <button
                  onClick={() => void runCmd()}
                  disabled={execBusy || !cmd.trim()}
                  className="px-3 py-1.5 rounded bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 text-xs disabled:opacity-50 flex items-center gap-1"
                  data-testid="node-cmd-run"
                >
                  {execBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  تنفيذ
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {[
                  "uname -a",
                  "uptime",
                  "df -h",
                  "free -h",
                  "ps aux --sort=-%cpu | head -10",
                  "netstat -tunlp 2>/dev/null | head -20",
                  "tail -50 /var/log/syslog",
                  "ls -lah /etc/ssh/",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setCmd(q)}
                    className="text-[10px] font-mono text-right truncate px-2 py-1 rounded border border-border/40 text-muted-foreground hover:border-primary/40 hover:text-primary"
                    title={q}
                  >
                    {q}
                  </button>
                ))}
              </div>

              {exec && (
                <div className="rounded-lg border border-border/40 bg-background/40 overflow-hidden">
                  <div className="px-3 py-1.5 flex items-center justify-between border-b border-border/30 text-[10px] font-mono">
                    <span className="text-muted-foreground truncate">$ {exec.command}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded ${
                        exec.timedOut
                          ? "bg-amber-500/20 text-amber-300"
                          : exec.exitCode === 0
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-rose-500/20 text-rose-300"
                      }`}
                    >
                      {exec.timedOut ? "TIMEOUT" : `exit ${exec.exitCode ?? "?"}`}
                    </span>
                  </div>
                  <pre
                    ref={outRef}
                    className="p-3 text-[11px] font-mono text-foreground/90 overflow-auto max-h-[40vh] whitespace-pre-wrap break-words"
                    data-testid="node-cmd-output"
                  >
                    {exec.output || "(لا مخرجات)"}
                  </pre>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-muted-foreground text-xs">
            <div className="text-center">
              <Server className="w-10 h-10 mx-auto mb-2 text-primary/40" />
              اختر node من اليمين للتحكم به
            </div>
          </div>
        )}
      </div>

      {/* Add/edit modal */}
      {showForm && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 backdrop-blur-sm">
          <form
            onSubmit={submit}
            className="w-[440px] max-w-[90%] rounded-xl bg-card border border-primary/40 shadow-[0_0_30px_rgba(0,212,255,0.25)] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold flex items-center gap-2">
                <Server className="w-4 h-4 text-primary" />
                {form.id && form.id > 0 ? "تعديل Node" : "إضافة Node جديد"}
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 text-[11px] font-mono text-muted-foreground">
                اسم
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full mt-1 bg-background/60 border border-border/40 rounded px-2 py-1.5 text-xs font-mono"
                  data-testid="node-form-name"
                />
              </label>
              <label className="col-span-2 text-[11px] font-mono text-muted-foreground">
                Host (IP أو domain)
                <input
                  value={form.host}
                  onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                  required
                  className="w-full mt-1 bg-background/60 border border-border/40 rounded px-2 py-1.5 text-xs font-mono"
                  data-testid="node-form-host"
                />
              </label>
              <label className="text-[11px] font-mono text-muted-foreground">
                Port
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))}
                  className="w-full mt-1 bg-background/60 border border-border/40 rounded px-2 py-1.5 text-xs font-mono"
                />
              </label>
              <label className="text-[11px] font-mono text-muted-foreground">
                User
                <input
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  className="w-full mt-1 bg-background/60 border border-border/40 rounded px-2 py-1.5 text-xs font-mono"
                />
              </label>
              <label className="text-[11px] font-mono text-muted-foreground">
                نوع الاعتماد
                <select
                  value={form.authType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, authType: e.target.value as "password" | "key" }))
                  }
                  className="w-full mt-1 bg-background/60 border border-border/40 rounded px-2 py-1.5 text-xs font-mono"
                >
                  <option value="password">كلمة سر</option>
                  <option value="key">مفتاح SSH</option>
                </select>
              </label>
              <label className="text-[11px] font-mono text-muted-foreground">
                Tags (اختياري)
                <input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="prod,web"
                  className="w-full mt-1 bg-background/60 border border-border/40 rounded px-2 py-1.5 text-xs font-mono"
                />
              </label>
              <label className="col-span-2 text-[11px] font-mono text-muted-foreground">
                {form.authType === "key" ? "مسار مفتاح SSH (مثلاً ~/.ssh/id_rsa)" : "كلمة السر"}
                <input
                  type={form.authType === "key" ? "text" : "password"}
                  value={form.credential}
                  onChange={(e) => setForm((f) => ({ ...f, credential: e.target.value }))}
                  placeholder={
                    form.id && form.id > 0 ? "اتركه فارغاً للحفاظ على القديم" : ""
                  }
                  className="w-full mt-1 bg-background/60 border border-border/40 rounded px-2 py-1.5 text-xs font-mono"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-3 py-1.5 text-xs rounded border border-border/40 text-muted-foreground hover:text-foreground"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs rounded bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30"
                data-testid="node-form-submit"
              >
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
