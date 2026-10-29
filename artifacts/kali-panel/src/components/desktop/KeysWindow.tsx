/**
 * KeysWindow — API Key Manager for CyberNova Desktop
 *
 * Shows all AI providers with health status, allows adding/removing keys,
 * and triggers auto-refresh cycles.
 */

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  ExternalLink,
  KeyRound,
  Trash2,
  Plus,
  Loader2,
  AlertTriangle,
  Zap,
  Clock,
  Shield,
  Wifi,
  WifiOff,
  Cpu,
} from "lucide-react";
import { probeOllamaViaServer, getStoredOllamaModel, getStoredOllamaBase } from "@/lib/ollama-browser";

const API_BASE = "/api";

interface ProviderKeyStatus {
  id: string;
  displayName: string;
  family: string;
  available: boolean;
  enabled: boolean;
  healthy: boolean | null;
  latencyMs?: number;
  error?: string;
  lastTestedAt?: string;
  freeInfo?: string;
  signupUrl?: string;
}

interface KeysStatus {
  lastCycleAt: string | null;
  providers: ProviderKeyStatus[];
  summary: { total: number; working: number; failed: number };
}

const PROVIDER_CONFIG: Record<string, { color: string; emoji: string }> = {
  anthropic: { color: "border-orange-500/40 bg-orange-500/10", emoji: "🟠" },
  openai: { color: "border-emerald-500/40 bg-emerald-500/10", emoji: "🟢" },
  gemini: { color: "border-sky-500/40 bg-sky-500/10", emoji: "🔵" },
  groq: { color: "border-yellow-500/40 bg-yellow-500/10", emoji: "⚡" },
  mistral: { color: "border-purple-500/40 bg-purple-500/10", emoji: "🟣" },
  openrouter: { color: "border-pink-500/40 bg-pink-500/10", emoji: "🩷" },
  together: { color: "border-teal-500/40 bg-teal-500/10", emoji: "🩵" },
  deepseek: { color: "border-blue-500/40 bg-blue-500/10", emoji: "🔷" },
  ollama: { color: "border-violet-500/40 bg-violet-500/10", emoji: "🟤" },
};

export function KeysWindow() {
  const [status, setStatus] = useState<KeysStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [ollamaProbe, setOllamaProbe] = useState<{ connected: boolean; models: string[]; error?: string } | null>(null);
  const [probingOllama, setProbingOllama] = useState(false);

  const probeOllama = async () => {
    setProbingOllama(true);
    const result = await probeOllamaViaServer();
    setOllamaProbe(result);
    setProbingOllama(false);
  };

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/keys/status`);
      if (r.ok) setStatus(await r.json() as KeysStatus);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
    void probeOllama(); // Check Ollama connection from browser on mount
    const t = setInterval(() => void fetchStatus(), 30_000);
    return () => clearInterval(t);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const r = await fetch(`${API_BASE}/keys/refresh`, { method: "POST" });
      const j = await r.json() as { ok: boolean; status?: KeysStatus };
      if (j.ok && j.status) setStatus(j.status);
      setMessage({ text: "تم تحديث حالة جميع المفاتيح ✓", ok: true });
    } catch (e) {
      setMessage({ text: `فشل التحديث: ${e instanceof Error ? e.message : "خطأ"}`, ok: false });
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveKey = async (providerId: string) => {
    if (!keyInput.trim()) return;
    setSavingKey(true);
    setMessage(null);
    try {
      const r = await fetch(`${API_BASE}/keys/${providerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyInput.trim() }),
      });
      const j = await r.json() as { ok: boolean; status?: KeysStatus; error?: string };
      if (j.ok && j.status) {
        setStatus(j.status);
        setMessage({ text: `تم حفظ المفتاح لـ ${providerId} ✓`, ok: true });
        setAddingFor(null);
        setKeyInput("");
      } else {
        setMessage({ text: j.error ?? "فشل الحفظ", ok: false });
      }
    } catch (e) {
      setMessage({ text: `خطأ: ${e instanceof Error ? e.message : "unknown"}`, ok: false });
    } finally {
      setSavingKey(false);
    }
  };

  const handleDeleteKey = async (providerId: string) => {
    setDeletingKey(providerId);
    setMessage(null);
    try {
      await fetch(`${API_BASE}/keys/${providerId}`, { method: "DELETE" });
      setMessage({ text: `تم حذف مفتاح ${providerId}`, ok: true });
      await fetchStatus();
    } catch {
      // ignore
    } finally {
      setDeletingKey(null);
    }
  };

  const freeProviders = status?.providers.filter((p) => p.freeInfo) ?? [];
  const allProviders = status?.providers ?? [];

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100 text-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-cyan-900/30 bg-gray-900/60">
        <KeyRound className="w-4 h-4 text-cyan-400" />
        <span className="font-semibold text-cyan-300">مدير المفاتيح التلقائي</span>
        <div className="ml-auto flex items-center gap-2">
          {status?.summary && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-emerald-400 font-mono">{status.summary.working}</span>
              <span className="text-gray-500">/</span>
              <span className="text-gray-400 font-mono">{status.summary.total}</span>
              <span className="text-gray-500">شغّال</span>
            </div>
          )}
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* Message banner */}
      {message && (
        <div className={`mx-4 mt-2 px-3 py-2 rounded text-xs ${message.ok ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300" : "bg-red-500/10 border border-red-500/30 text-red-300"}`}>
          {message.text}
        </div>
      )}

      {/* Free providers highlight */}
      {freeProviders.length > 0 && (
        <div className="px-4 py-2 border-b border-cyan-900/20">
          <div className="text-xs text-cyan-400 mb-1 flex items-center gap-1">
            <Zap className="w-3 h-3" /> مزوّدون مجانيون — أضف مفتاحك مجاناً
          </div>
          <div className="flex flex-wrap gap-1">
            {freeProviders.map((p) => (
              <a
                key={p.id}
                href={p.signupUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 hover:bg-cyan-500/20 transition-colors"
              >
                {p.displayName}
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Providers list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {loading && !status && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          </div>
        )}
        {allProviders.map((p) => {
          const cfg = PROVIDER_CONFIG[p.family] ?? { color: "border-gray-500/40 bg-gray-500/10", emoji: "⚙️" };
          const isAdding = addingFor === p.id;
          const isDeleting = deletingKey === p.id;
          const isOllama = p.family === "ollama";

          // ── Special Ollama card (no API key needed) ──────────────────────
          if (isOllama) {
            const browserConnected = ollamaProbe?.connected ?? null;
            const storedBase = getStoredOllamaBase();
            const storedModel = getStoredOllamaModel();
            return (
              <div key={p.id} className={`rounded-lg border ${cfg.color} p-3 space-y-2`}>
                <div className="flex items-center gap-2">
                  {/* Browser-side connection icon */}
                  {browserConnected === null ? (
                    <Cpu className="w-4 h-4 text-violet-400 shrink-0" />
                  ) : browserConnected ? (
                    <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-gray-100">{p.displayName}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300">
                        🏠 محلي • لا يحتاج API Key
                      </span>
                    </div>
                    <div className="text-[10px] mt-0.5">
                      {browserConnected === null ? (
                        <span className="text-gray-500">جاري فحص الاتصال من المتصفح...</span>
                      ) : browserConnected ? (
                        <span className="text-emerald-400">
                          ✓ متصل • {storedBase} • النماذج: {(ollamaProbe?.models ?? [storedModel]).slice(0, 3).join(", ")}
                        </span>
                      ) : (
                        <span className="text-rose-400">
                          ✗ غير متصل من المتصفح — {ollamaProbe?.error?.includes("CORS") ? 'شغّل: OLLAMA_ORIGINS="*" ollama serve' : (ollamaProbe?.error?.slice(0, 80) ?? "تعذّر الوصول")}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => void probeOllama()}
                    disabled={probingOllama}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-violet-500/10 border border-violet-500/30 text-violet-300 hover:bg-violet-500/20 transition-colors text-[10px]"
                    title="فحص الاتصال من المتصفح"
                  >
                    {probingOllama ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
                    فحص
                  </button>
                </div>
                {/* Ollama start instructions if disconnected */}
                {browserConnected === false && (
                  <div className="text-[9px] font-mono p-2 rounded bg-rose-500/5 border border-rose-500/20 text-rose-300/80 space-y-0.5">
                    <div>💡 لتشغيل Ollama مع دعم CORS:</div>
                    <div className="font-bold">OLLAMA_ORIGINS="*" ollama serve</div>
                    <div className="text-gray-500 mt-1">أو على Windows: set OLLAMA_ORIGINS=* && ollama serve</div>
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              key={p.id}
              className={`rounded-lg border ${cfg.color} p-3 transition-all`}
            >
              <div className="flex items-center gap-2">
                {/* Status icon */}
                {p.available ? (
                  p.healthy === true ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : p.healthy === false ? (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-yellow-400 shrink-0" />
                  )
                ) : (
                  <AlertTriangle className="w-4 h-4 text-gray-500 shrink-0" />
                )}

                {/* Name + info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-gray-100">{p.displayName}</span>
                    {p.freeInfo && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                        {p.freeInfo}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {p.available
                      ? p.healthy === true
                        ? `✓ يعمل${p.latencyMs ? ` · ${p.latencyMs}ms` : ""}`
                        : p.healthy === false
                          ? `✗ ${p.error ?? "فشل الاتصال"}`
                          : "جاري الفحص..."
                      : "لم يُضف مفتاح API"}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {p.signupUrl && !p.available && (
                    <a
                      href={p.signupUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-cyan-400 transition-colors"
                      title="احصل على مفتاح مجاني"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {p.available && (
                    <button
                      onClick={() => void handleDeleteKey(p.id)}
                      disabled={isDeleting}
                      className="p-1 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                      title="حذف المفتاح"
                    >
                      {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </button>
                  )}
                  {!p.available && p.id !== "anthropic-replit" && p.id !== "openai-replit" && p.id !== "gemini-replit" && (
                    <button
                      onClick={() => { setAddingFor(isAdding ? null : p.id); setKeyInput(""); }}
                      className="p-1 rounded hover:bg-cyan-500/10 text-gray-500 hover:text-cyan-400 transition-colors"
                      title="إضافة مفتاح"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Add key form */}
              {isAdding && (
                <div className="mt-2 flex gap-1">
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleSaveKey(p.id); if (e.key === "Escape") setAddingFor(null); }}
                    placeholder={`أدخل مفتاح ${p.displayName}...`}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-cyan-500"
                    autoFocus
                  />
                  <button
                    onClick={() => void handleSaveKey(p.id)}
                    disabled={savingKey || !keyInput.trim()}
                    className="px-2 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 text-xs disabled:opacity-50 transition-colors"
                  >
                    {savingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : "حفظ"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-cyan-900/20 px-4 py-2">
        <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
          <Shield className="w-3 h-3" />
          <span>المفاتيح محفوظة محلياً في قاعدة البيانات · تحديث تلقائي كل 10 دقائق</span>
          {status?.lastCycleAt && (
            <span className="ml-auto">
              آخر فحص: {new Date(status.lastCycleAt).toLocaleTimeString("ar")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
