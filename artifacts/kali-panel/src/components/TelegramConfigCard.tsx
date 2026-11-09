import { useEffect, useState, useCallback } from "react";
import { Send, CheckCircle, XCircle, Eye, EyeOff, TestTube } from "lucide-react";
import { opsFetch, getOpsToken, setOpsToken } from "@/lib/ops-client";

/**
 * TelegramConfigCard — الضبط الدائم لقناة التليجرام من جوه المنصة.
 * صدق الصفحة:
 *  · القيم الحساسة عمرها ما ترجع من السيرفر: بنقيس boolean بس من /ops/config/status.
 *  · الحفظ بيستدعي /api/ops/config (موقّع بالـops token اللي المالك سجّله في الواجهة).
 *  · زر «اختبار حقيقي» بيبعت رسالة فعلية عبر /ops/config/test-telegram — لو فشلت
 *    بنقول السبب العربي مش «تم» كاذب.
 */
export function TelegramConfigCard() {
  const [status, setStatus] = useState<Record<string, boolean> | null>(null);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [cveAlerts, setCveAlerts] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [execToken, setExecToken] = useState(""); // NOVA_EXEC_TOKEN — من env استضافة السيرفر (waifly)

  const refresh = useCallback(async () => {
    const r = await opsFetch<{ keys: Record<string, boolean> }>("/ops/config/status");
    if (r.ok && r.data) setStatus(r.data.keys ?? null);
    const lr = await opsFetch<Record<string, unknown>>("/ops/telegram/status");
    if (lr.ok && lr.data) setLive(lr.data);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      if (execToken.trim()) { setOpsToken(execToken.trim()); setExecToken(""); }
      
      const jobs: Array<[string, string]> = [];
      if (token.trim()) jobs.push(["telegram.botToken", token.trim()]);
      if (chatId.trim()) jobs.push(["telegram.chatId", chatId.trim()]);
      jobs.push(["telegram.alert.cve", cveAlerts ? "1" : "0"]);
      if (jobs.length === 0) { setMsg({ ok: false, text: "مفيش حاجة مكتوبة تتحفظ" }); return; }
      for (const [key, value] of jobs) {
        const r = await opsFetch<{ ok: boolean; reasonAr?: string }>("/ops/config", {
          method: "POST",
          body: { key, value },
        });
        if (!r.ok || r.data?.ok === false) {
          setMsg({ ok: false, text: r.status === 403
            ? (getOpsToken()
                ? "✗ 403: التوكن المخزن في اللوحة مش مطابق لـNOVA_EXEC_TOKEN على السيرفر — اكتبه صح في حقل «توكن التشغيل» تحت وأعد المحاولة"
                : "✗ 403: الكتابة على السيرفر محتاجة توكن التشغيل (NOVA_EXEC_TOKEN من env الاستضافة) — اكتبه في الحقل تحت ثم احفظ.")
            : `✗ «${key}» رُفض: ${r.data?.reasonAr ?? r.error ?? r.status}` });
          return;
        }
      }
      setToken(""); setChatId("");
      setMsg({ ok: true, text: "✓ اتقفل في ذاكرة العقدة الدائمة (يتحمّل أي ريستارت). دلوقتي ابعت /start للبوت من تليجرامك عشان الـchat_id يتعلّم" });
      await refresh();
    } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await opsFetch<{ ok: boolean; reasonAr?: string }>("/ops/config/test-telegram", { method: "POST", body: {} });
      setMsg(r.ok && r.data?.ok !== false
        ? { ok: true, text: "✓ رسالة الاختبار وصلت تليجرام فعلًا" }
        : { ok: false, text: `✗ ${r.data?.reasonAr ?? "فشل الإرسال"} (${r.status})` });
      await refresh();
    } finally { setBusy(false); }
  };

  const cell = (ok: boolean | undefined, label: string) => (
    <div className="flex items-center gap-1.5 text-[11px] font-mono" key={label}>
      {ok === true ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : ok === false ? <XCircle className="w-3.5 h-3.5 text-rose-400" /> : <span className="w-3.5 h-3.5 inline-block rounded-full border border-white/20" />}
      <span className={ok ? "text-emerald-300" : "text-white/40"}>{label}</span>
    </div>
  );

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: "rgba(8,0,18,0.95)", border: "1px solid rgba(0,200,255,0.14)", borderRadius: 16 }}>
      <div className="flex items-center gap-2">
        <Send className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-cyan-200">قناة التليجرام (إشعارات الإقلاع · الزيارات · صيد الثغرات)</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cell(status?.["telegram.botToken"], "botToken")}
        {cell(status?.["telegram.chatId"], "chatId")}
        {cell(status?.["visitorAlerts"], "تنبيهات الزيارات")}
        {cell(status?.["telegram.alert.cve"] !== false, "تنبيهات الصيد")}
      </div>

      {live && (
        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[10px] font-mono space-y-1">
          {live.tokenSet === false && <div className="text-rose-300">⛔ {String(live.noteAr ?? "")}</div>}
          {live.tokenSet === true && (
            <>
              <div className="text-white/60">
                البوت: {(live.bot as { ok?: boolean; username?: string } | undefined)?.ok === true
                  ? <span className="text-emerald-300">@{(live.bot as { username?: string }).username} ✓</span>
                  : <span className="text-rose-300">{String((live.bot as { noteAr?: string } | undefined)?.noteAr ?? "لا")}</span>}
                {" · "}التوكن من: {String(live.tokenFrom ?? "—")}
                {" · "}chat_id: {live.chatIdKnown ? <span className="text-emerald-300">معروف ✓</span> : <span className="text-amber-300">لسه مجهول</span>}
                {" · "}updates معلّقة: {String(live.pendingUpdates ?? "—")}
              </div>
              {(live.lastError as { status?: number; desc?: string } | null)?.desc ? (
                <div className="text-rose-300/90">
                  آخر خطأ تليجرام: {(live.lastError as { status?: number }).status} — {String((live.lastError as { desc?: string }).desc)}
                </div>
              ) : null}
              {live.adviceAr ? <div className="text-cyan-300/80">💡 {String(live.adviceAr)}</div> : null}
            </>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="space-y-1">
          <input
            type="password" value={execToken} onChange={(e) => setExecToken(e.target.value)}
            placeholder="توكن التشغيل NOVA_EXEC_TOKEN (من env استضافة السيرفر — نفس اللي كتبته في waifly)"
            className="w-full bg-white/[0.03] border border-amber-500/20 rounded-[10px] text-white/80 text-[13px] font-mono px-3.5 py-2.5 outline-none"
          />
          <div className="text-[9px] font-mono text-amber-200/40">مش موجود عندك؟ اعمله: لوحة waifly → Environment → NOVA_EXEC_TOKEN = أي خلطة طويلة، Restart، واكتب نفس الخلطة هنا — اللوحة بتحفظه محليًا في جهازك بس.</div>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showToken ? "text" : "password"} value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="توكن البوت من BotFather (رقم:خلطة) — مش بيترجع أبدًا"
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-[10px] text-white/80 text-[13px] font-mono px-3.5 py-2.5 outline-none"
            />
            <button onClick={() => setShowToken((v) => !v)} className="absolute left-2 top-2.5 text-white/30 hover:text-white/70" type="button">
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <input value={chatId} onChange={(e) => setChatId(e.target.value)}
            placeholder="chatId (اختياري — بيتعلّم بـ/start)"
            className="w-44 bg-white/[0.03] border border-white/[0.08] rounded-[10px] text-white/80 text-[13px] font-mono px-3.5 py-2.5 outline-none" />
        </div>

        <label className="flex items-center gap-2 text-[11px] text-white/50 font-mono cursor-pointer select-none">
          <input type="checkbox" checked={cveAlerts} onChange={(e) => setCveAlerts(e.target.checked)} />
          أنبّهني على تليجرام أول بأول لما الصيد الحي يلاقي ثغرات جديدة (NVD/GitHub/CISA…)
        </label>

        <div className="flex gap-2">
          <button onClick={() => void save()} disabled={busy}
            className="px-4 py-2 rounded-xl text-xs font-bold font-mono bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition disabled:opacity-50">
            {busy ? "⏳ …" : "💾 حفظ دائم في العقدة"}
          </button>
          <button onClick={() => void sendTest()} disabled={busy}
            className="px-4 py-2 rounded-xl text-xs font-bold font-mono bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition disabled:opacity-50 flex items-center gap-1.5">
            <TestTube className="w-3.5 h-3.5" /> اختبار حقيقي (رسالة فعلية)
          </button>
        </div>

        {msg && (
          <div className="text-[11px] font-mono rounded-lg px-3 py-2" style={{ background: msg.ok ? "rgba(34,197,94,.08)" : "rgba(244,63,94,.08)", color: msg.ok ? "#4ade80" : "#fb7185" }}>
            {msg.text}
          </div>
        )}
        <div className="text-[9px] text-white/25 font-mono">
          القيم الحساسة بتتخزن في Supabase Edge عبر قناة موقّعة — الواجهة بتقرأ boolean بس. بديل CI: workflow «telegram provision» بلصقة واحدة.
        </div>
      </div>
    </div>
  );
}
