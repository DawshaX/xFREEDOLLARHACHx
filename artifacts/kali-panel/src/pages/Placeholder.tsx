import { useState } from "react";
import { Play, Terminal, Radio, ShieldCheck, ArrowRight, Info } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { emitPlatformWsEvent } from "@/hooks/useWebSocket";
import { jsonRequest } from "@/lib/sse";

/**
 * وحدة غير موصولة (Not Wired).
 *
 * قبل كده: الضغط على «تشغيل» كان بيدّي تقرير ثابت بعد 250ms فيه سطور زي
 * «تم التحقق من استجابة الهدف وتطبيق قواعد النطاق القانوني» — تقرير مزيّف
 * بيوهم المشغّل إن فحص حقيقي اتعمل، وهو مفيش أي فحص.
 *
 * دلوقتي: الصفحة بتقول صراحةً إن الوحدة مش موصولة، وبتوجّه المشغّل للاجينت
 * الحقيقي (66 أداة) اللي يقدر ينفّذ الفحص فعلاً. مفيش تقرير مزيّف.
 */
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
      return localStorage.getItem("cybernova_active_target") || "";
    } catch {
      return "";
    }
  });
  const [handedOff, setHandedOff] = useState(false);

  // بنبعت الطلب للاجينت الحقيقي بدل ما نلفّق تقرير.
  const handOffToAgent = async () => {
    const t = target.trim();
    const prompt = t
      ? `نفّذ فحص «${title}» على الهدف ${t} باستخدام الأدوات الحقيقية المتاحة، واعرض النتيجة الفعلية.`
      : `الوحدة «${title}» مش موصولة كصفحة. إيه الأدوات الحقيقية المتاحة اللي تقدر تنفّذ نفس الوظيفة؟`;
    try {
      await jsonRequest("/nova-core/chat", {
        method: "POST",
        body: JSON.stringify({ message: prompt, planMode: true }),
      });
    } catch {
      // لو السيرفر مش متاح، بنبثّ الحدث الداخلي بس
    }
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
    <div className="p-6 space-y-6" dir="rtl">
      <PageHeader title={title} subtitle={subtitle} icon={icon} badge="NOT WIRED" />

      <div
        className="rounded-2xl p-6 space-y-4"
        style={{
          background: "rgba(10,0,22,0.92)",
          border: "1px solid rgba(255,170,68,0.25)",
          boxShadow: "0 0 25px rgba(255,170,68,0.06)",
        }}
      >
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#ffaa44" }} />
          <div className="space-y-1">
            <div className="font-black text-sm font-mono" style={{ color: "#ffaa44" }}>
              الوحدة دي مش موصولة بمنطق حقيقي
            </div>
            <div className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.5)" }}>
              مفيش فحص حقيقي بيتم هنا. بدل ما نعرض تقرير ثابت، بنحوّلك للاجينت الحقيقي (66 أداة) اللي ينفّذ الفحص فعلاً.
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-mono text-slate-300">الهدف أو النطاق (اختياري)</label>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="مثال: api.example.com"
            className="w-full rounded-xl px-3.5 py-2.5 text-xs font-mono text-white bg-black/50 border border-white/10 outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap pt-1">
          <button
            onClick={() => void handOffToAgent()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold font-mono bg-amber-600/20 border border-amber-500/40 text-amber-300 hover:bg-amber-600/30 transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            حوّل الطلب للاجينت الحقيقي
          </button>
          <a
            href="/nova-fleet#work"
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

        <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
          <Radio className="w-3 h-3" />
          <span>مفيش تقرير مزيّف — أي نتيجة لازم تيجي من أداة حقيقية</span>
        </div>
      </div>
    </div>
  );
}
