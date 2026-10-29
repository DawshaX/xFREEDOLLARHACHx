/**
 * TelegramPanel — ربط Nova بـ Telegram Bot.
 * يستقبل إشعارات من Nova مباشرة على هاتفك.
 */
import { useState, useEffect, useCallback } from "react";
import { Send, CheckCircle2, XCircle, RefreshCw, Bot, MessageCircle, Copy, Check, Bell, Zap, AlertCircle } from "lucide-react";

const BASE = "/api";

interface TgStatus {
  ok: boolean;
  connected: boolean;
  bot?: { first_name: string; username: string };
  chatId?: number | string;
  tokenSet: boolean;
  error?: string;
}

export function TelegramPanel() {
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [manualId, setManualId] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [sent, setSent] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [copied, setCopied] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/telegram/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.connected) setStep(3);
        else if (data.tokenSet) setStep(2);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  const detectChatId = async () => {
    setDetecting(true);
    try {
      const res = await fetch(`${BASE}/telegram/get-chat-id`);
      const data = await res.json();
      if (data.ok && data.found) {
        await fetchStatus();
        setStep(3);
      } else {
        alert(data.message ?? "لم يُعثر على Chat ID. أرسل /start للبوت أولاً!");
      }
    } catch {}
    setDetecting(false);
  };

  const setChatIdManually = async () => {
    if (!manualId.trim()) return;
    try {
      await fetch(`${BASE}/telegram/set-chat-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: manualId }),
      });
      await fetchStatus();
      setStep(3);
    } catch {}
  };

  const sendTest = async () => {
    setSending(true);
    try {
      const msg = testMsg.trim() || "🛡️ *Nova CyberNova جاهزة!*\n\nتم ربط نظام الإشعارات بنجاح. ستصلك إشعارات عند:\n• انتهاء مهام Swarm\n• اكتشاف ثغرات جديدة\n• إنجاز المهام الذاتية";
      const res = await fetch(`${BASE}/telegram/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg }),
      });
      const data = await res.json();
      if (data.ok) { setSent(true); setTimeout(() => setSent(false), 3000); }
    } catch {}
    setSending(false);
  };

  const botUsername = status?.bot?.username ?? "NovaSecBot";
  const botLink = `https://t.me/${botUsername}`;

  const copyId = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-black/90 text-white" dir="rtl" style={{ fontFamily: "monospace" }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-blue-500/20 bg-gradient-to-r from-blue-900/20 to-sky-900/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-sky-600 flex items-center justify-center shadow-lg">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-blue-200">Telegram Bot — إشعارات Nova</div>
            <div className="flex items-center gap-2 text-[10px]">
              {status?.connected ? (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" /> مرتبط بنجاح · @{status.bot?.username}
                </span>
              ) : status?.tokenSet ? (
                <span className="flex items-center gap-1 text-yellow-400">
                  <AlertCircle className="w-3 h-3" /> التوكن موجود · في انتظار Chat ID
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-400">
                  <XCircle className="w-3 h-3" /> غير مرتبط
                </span>
              )}
            </div>
          </div>
          <button onClick={() => void fetchStatus()} disabled={loading}
            className="p-1.5 text-slate-500 hover:text-blue-400 transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Steps */}
        <div className="flex items-center gap-2 mb-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                step >= s ? "bg-blue-500 border-blue-400 text-white" : "bg-black/40 border-white/10 text-slate-500"
              }`}>{s}</div>
              {s < 3 && <div className={`w-8 h-px ${step > s ? "bg-blue-500" : "bg-white/10"}`} />}
            </div>
          ))}
          <span className="text-[10px] text-slate-500 mr-2">
            {step === 1 ? "التوكن" : step === 2 ? "Chat ID" : "جاهز!"}
          </span>
        </div>

        {/* Step 1: Token */}
        <div className={`rounded-xl border p-3 transition-all ${step >= 1 ? "border-blue-500/30 bg-blue-500/5" : "border-white/5 bg-black/20 opacity-50"}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${status?.tokenSet ? "bg-emerald-500 text-white" : "bg-blue-500 text-white"}`}>
              {status?.tokenSet ? "✓" : "1"}
            </div>
            <span className="text-xs font-bold text-blue-200">التوكن</span>
          </div>
          {status?.tokenSet ? (
            <div className="text-[10px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> التوكن محفوظ بنجاح
              {status.bot && <span className="text-slate-500">· بوت: @{status.bot.username}</span>}
            </div>
          ) : (
            <div className="text-[10px] text-slate-400">
              التوكن غير موجود. أضف <code className="text-yellow-300">TELEGRAM_BOT_TOKEN</code> في إعدادات السيكريتس.
            </div>
          )}
        </div>

        {/* Step 2: Chat ID */}
        <div className={`rounded-xl border p-3 transition-all ${step >= 2 ? "border-blue-500/30 bg-blue-500/5" : "border-white/5 bg-black/20 opacity-40"}`}>
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${status?.connected ? "bg-emerald-500 text-white" : "bg-blue-500 text-white"}`}>
              {status?.connected ? "✓" : "2"}
            </div>
            <span className="text-xs font-bold text-blue-200">ربط حسابك</span>
          </div>

          {/* Instructions */}
          <div className="space-y-2 text-[11px]">
            <div className="flex items-start gap-2 p-2 bg-black/30 rounded-lg">
              <span className="text-blue-400 font-bold shrink-0">1.</span>
              <div>
                افتح Telegram وابحث عن{" "}
                <button onClick={() => window.open(botLink, "_blank")}
                  className="text-blue-300 hover:text-blue-200 underline">
                  @{botUsername}
                </button>
              </div>
            </div>
            <div className="flex items-start gap-2 p-2 bg-black/30 rounded-lg">
              <span className="text-blue-400 font-bold shrink-0">2.</span>
              <div>أرسل الأمر: <code className="text-yellow-300 bg-black/40 px-1 rounded">/start</code></div>
            </div>
            <div className="flex items-start gap-2 p-2 bg-black/30 rounded-lg">
              <span className="text-blue-400 font-bold shrink-0">3.</span>
              <div>انقر زر "جلب Chat ID" أدناه</div>
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => void detectChatId()}
              disabled={detecting || !status?.tokenSet}
              className="flex-1 py-2 bg-blue-500/20 border border-blue-500/30 text-blue-300 rounded-lg text-xs hover:bg-blue-500/30 disabled:opacity-40 flex items-center justify-center gap-1.5 transition-all"
            >
              {detecting ? <><RefreshCw className="w-3 h-3 animate-spin" /> يبحث…</> : <><Zap className="w-3 h-3" /> جلب Chat ID تلقائياً</>}
            </button>
          </div>

          {/* Manual fallback */}
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="text-[10px] text-slate-500 mb-2">أو أدخل Chat ID يدوياً:</div>
            <div className="flex gap-2">
              <input value={manualId} onChange={(e) => setManualId(e.target.value)}
                placeholder="مثلاً: 123456789"
                className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs outline-none focus:border-blue-500/50" />
              <button onClick={() => void setChatIdManually()}
                disabled={!manualId.trim()}
                className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded text-xs hover:bg-blue-500/20 disabled:opacity-40">
                تعيين
              </button>
            </div>
            <div className="text-[9px] text-slate-600 mt-1">
              للحصول على Chat ID: تحدث مع @userinfobot على Telegram
            </div>
          </div>

          {status?.chatId && (
            <div className="mt-2 flex items-center gap-2 text-[10px] text-emerald-400">
              <CheckCircle2 className="w-3 h-3" /> Chat ID: {status.chatId}
              <button onClick={() => copyId(String(status.chatId))} className="text-slate-500 hover:text-slate-300">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>

        {/* Step 3: Test */}
        <div className={`rounded-xl border p-3 transition-all ${step === 3 ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/5 bg-black/20 opacity-40"}`}>
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === 3 ? "bg-emerald-500 text-white" : "bg-slate-700 text-slate-400"}`}>3</div>
            <span className="text-xs font-bold text-emerald-200">اختبار الإشعارات</span>
          </div>

          {step === 3 && (
            <>
              <div className="text-[11px] text-slate-300 mb-3">
                ✅ Nova مرتبطة بـ Telegram. ستصلك إشعارات عند:
              </div>
              <div className="space-y-1 text-[10px] text-slate-400 mb-3">
                {["انتهاء مهام Swarm", "اكتشاف ثغرات جديدة في CVE", "إنجاز المهام الذاتية", "حفظ ذاكرة جديدة"].map((item) => (
                  <div key={item} className="flex items-center gap-1.5">
                    <span className="text-emerald-500">·</span> {item}
                  </div>
                ))}
              </div>

              <textarea value={testMsg} onChange={(e) => setTestMsg(e.target.value)}
                placeholder="رسالة تجريبية (اتركه فارغاً للرسالة الافتراضية)"
                rows={2}
                className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs outline-none focus:border-emerald-500/50 resize-none mb-2" />

              <button
                onClick={() => void sendTest()}
                disabled={sending || !status?.connected}
                className="w-full py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-lg text-xs hover:bg-emerald-500/30 disabled:opacity-40 flex items-center justify-center gap-1.5 transition-all"
              >
                {sending ? <><RefreshCw className="w-3 h-3 animate-spin" /> يُرسل…</> :
                 sent ? <><CheckCircle2 className="w-3 h-3" /> أُرسلت!</> :
                 <><Send className="w-3 h-3" /> إرسال رسالة تجريبية</>}
              </button>
            </>
          )}
        </div>

        {/* Info box */}
        <div className="rounded-xl border border-white/5 bg-black/20 p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-2">
            <Bell className="w-3 h-3" /> ما الذي سيُرسله Nova تلقائياً؟
          </div>
          <div className="space-y-1 text-[9px] text-slate-600">
            <div>🔴 مهام Swarm اكتملت — مع ملخص النتيجة</div>
            <div>🧠 ذاكرة جديدة حُفظت — مع محتوى الذاكرة</div>
            <div>⚡ مهمة Autonomous انتهت — مع التقرير</div>
            <div>❌ أخطاء حرجة — مع وصف الخطأ</div>
          </div>
        </div>
      </div>
    </div>
  );
}
