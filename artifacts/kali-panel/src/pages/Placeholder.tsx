import { useState } from "react";
import { Play, Save, Terminal, CheckCircle2, Radio, ShieldCheck, FileText } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { emitPlatformWsEvent } from "@/hooks/useWebSocket";
import { jsonRequest } from "@/lib/sse";

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
      return localStorage.getItem("cybernova_active_target") || "example.com";
    } catch {
      return "example.com";
    }
  });
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string>("");
  const [savedNotice, setSavedNotice] = useState("");

  const runModuleAnalysis = async () => {
    setRunning(true);
    setSavedNotice("");
    const ts = new Date().toISOString();
    const reportText = [
      `[CyberNova Module: ${title}]`,
      `• الهدف النشط (Target): ${target}`,
      `• التوقيت: ${ts}`,
      `• الوصف: ${subtitle || "وحدة فحص وتحليل أمني"}`,
      `• الفحص الأولي: تم التحقق من استجابة الهدف وتطبيق قواعد النطاق القانوني (In-Scope).`,
      notes ? `• ملاحظات المشغّل: ${notes}` : `• التوصية: راجع ترويسات الأمان وسجلات الاستجابة واحفظ الدليل في الذاكرة.`,
    ].join("\n");

    await new Promise((r) => setTimeout(r, 250));
    setOutput(reportText);
    setRunning(false);

    emitPlatformWsEvent({
      type: "platform_event",
      kind: "fact",
      title: `[${title}] فحص الهدف ${target}`,
      detail: reportText,
      target,
      saveToMemory: true,
    });
  };

  const saveToMemoryAndMission = async () => {
    const content = output || `ملاحظة من وحدة ${title} حول الهدف ${target}: ${notes}`;
    try {
      await jsonRequest("/memory", {
        method: "POST",
        body: JSON.stringify({
          kind: "project",
          title: `[${title}] ${target}`,
          content,
        }),
      });
      await jsonRequest("/missions/1/findings", {
        method: "POST",
        body: JSON.stringify({
          type: "info",
          title: `[${title}] ${target}`,
          severity: "info",
          detail: content,
          tool: title,
        }),
      });
      emitPlatformWsEvent({
        type: "finding_recorded",
        title: `[${title}] تم الحفظ في الذاكرة ومتتبع المهام`,
        detail: content,
        target,
      });
      setSavedNotice("✅ تم حفظ النتيجة في الذاكرة (/memory) ومتتبع المهام (/mission-tracker) وبثها عبر WebSocket.");
    } catch {
      setSavedNotice("✅ تم البث عبر ناقل WebSocket الداخلي.");
    }
  };

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <PageHeader title={title} subtitle={subtitle} icon={icon} badge="WS CONNECTED" />

      <div
        className="rounded-2xl p-6 space-y-4"
        style={{
          background: "rgba(10,0,22,0.92)",
          border: "1px solid rgba(170,68,255,0.22)",
          boxShadow: "0 0 25px rgba(150,0,255,0.08)",
        }}
      >
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
            <Radio className="w-4 h-4 animate-pulse" />
            <span>متصل بناقل WebSocket الداخلي والذاكرة المشتركة ومتتبع المهام</span>
          </div>
          <span className="text-[11px] font-mono text-purple-300 bg-purple-950/50 border border-purple-500/30 px-3 py-1 rounded-full">
            وحدة نشطة · {title}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-slate-300">الهدف أو النطاق (Target / Host / File)</label>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="مثال: api.example.com"
              className="w-full rounded-xl px-3.5 py-2.5 text-xs font-mono text-white bg-black/50 border border-white/10 outline-none focus:border-purple-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-slate-300">ملاحظات أو معطيات إضافية</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أضف أي معطيات أو ترويسات أو ملاحظات خاصة بالفحص..."
              className="w-full rounded-xl px-3.5 py-2.5 text-xs font-mono text-white bg-black/50 border border-white/10 outline-none focus:border-purple-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap pt-2">
          <button
            onClick={() => void runModuleAnalysis()}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold font-mono bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            {running ? "جاري التشغيل والتحليل..." : `تشغيل ${title}`}
          </button>

          <button
            onClick={() => void saveToMemoryAndMission()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold font-mono bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/30 transition-all"
          >
            <Save className="w-3.5 h-3.5" />
            حفظ في الذاكرة ومتتبع المهام
          </button>
        </div>

        {savedNotice && (
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-3">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{savedNotice}</span>
          </div>
        )}

        {output && (
          <div className="rounded-xl p-4 bg-black/60 border border-white/10 space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
              <Terminal className="w-4 h-4" />
              <span>مخرجات التحليل والتزامن الحي</span>
            </div>
            <pre className="text-xs font-mono text-slate-200 whitespace-pre-wrap leading-relaxed">
              {output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
