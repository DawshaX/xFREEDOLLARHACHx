import { useState } from "react";
import { LiveAgentPanel } from "@/components/desktop/LiveAgentPanel";
import { NovaFleetPanel, NovaProjectPulse } from "@/components/desktop/NovaFleetPanel";
import { NovaLiveBar } from "@/components/desktop/NovaFleetLive";
import { Activity, Server, Sparkles, ShieldCheck } from "lucide-react";

/**
 * NOVA — the primary agent workspace.
 *
 * This is the dedicated, full-screen home of the Live Agent panel: one place
 * where you talk to NOVA, watch every tool execute live, see the project pulse,
 * and drive every connected machine (10+ agents / 5+ computers) — no personal
 * device required, because the agents run wherever you install them.
 */
export default function NovaAgentPage() {
  const [side, setSide] = useState<"pulse" | "fleet">("pulse");

  return (
    <div dir="rtl" className="flex h-[calc(100vh-64px)] min-h-0 flex-col bg-[#050208] text-white">
      <div className="px-3 pt-2">
        <NovaLiveBar />
      </div>

      {/* header */}
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-400/10">
          <Sparkles className="h-4 w-4 text-cyan-300" />
        </div>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-sm font-bold">
            نوفا — الوكيل الأساسي
            <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] text-emerald-200">
              LIVE
            </span>
          </h1>
          <p className="truncate text-[10px] text-white/40">
            كلام + تنفيذ حقيقي + ذاكرة دائمة + تحكم في كل الأجهزة المتصلة
          </p>
        </div>
        <div className="ms-auto flex items-center gap-1 rounded-lg border border-white/10 p-0.5">
          <button
            onClick={() => setSide("pulse")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] ${
              side === "pulse" ? "bg-emerald-500/20 text-emerald-200" : "text-white/50 hover:text-white/80"
            }`}
          >
            <Activity className="h-3 w-3" /> نبض المشروع
          </button>
          <button
            onClick={() => setSide("fleet")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] ${
              side === "fleet" ? "bg-cyan-500/20 text-cyan-200" : "text-white/50 hover:text-white/80"
            }`}
          >
            <Server className="h-3 w-3" /> الأجهزة
          </button>
        </div>
        <span className="hidden items-center gap-1 text-[10px] text-white/30 sm:flex">
          <ShieldCheck className="h-3 w-3" /> يعمل بدون جهاز شخصي — الوكلاء يشتغلون حيث تُثبَّت
        </span>
      </header>

      {/* body: agent panel + live side rail */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden">
          <LiveAgentPanel embedded onClientTool={() => {}} onOpenAgentWindow={() => {}} />
        </div>
        <aside className="hidden w-[330px] shrink-0 overflow-hidden border-s border-white/10 lg:block">
          {side === "pulse" ? <NovaProjectPulse /> : <NovaFleetPanel compact />}
        </aside>
      </div>
    </div>
  );
}
