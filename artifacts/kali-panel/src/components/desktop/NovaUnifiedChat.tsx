/**
 * NovaUnifiedChat — the ONE chat surface.
 *
 * Before this file the program had a dozen chat pages (NovaAgent, NovaAgentV3,
 * NovaAgentV6, NovaAgentPro, NovaAgentChat, NovaCore, Chat, LiveAgent, Agent…)
 * and each one invented its own connection: some talked to `/nova-core/chat`,
 * some to `/nova-agent-v3/chat`, some to a browser-only brain, and most did not
 * send the ops token at all. The result was the exact complaint the user made:
 * "the chat is not connected to everything".
 *
 * This component is the single source of truth for talking to NOVA. It renders
 * the real `LiveAgentPanel` (the 66-tool brain, live tool stream, approvals,
 * memory, files) and wraps it with the fleet's live state — agents, machines,
 * slots, the message bus and the approval gate — all read from ONE place
 * (`/api/fleet/mesh` + the `/api/ws` socket), so nothing on screen is a second
 * copy of the truth.
 *
 * Every chat page now renders this, so "which chat is the real one?" stops
 * being a question.
 */
import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Activity, Radio, Server, ShieldCheck, Sparkles } from "lucide-react";
import { LiveAgentPanel } from "./LiveAgentPanel";
import type { ClientToolEvent } from "./AgentWindow";
import { NovaFleetPanel, NovaProjectPulse } from "./NovaFleetPanel";
import { NovaLiveBar, useNovaLive } from "./NovaFleetLive";

export interface NovaUnifiedChatProps {
  /** Title shown in the header. Defaults to the primary agent workspace. */
  title?: string;
  /** Subtitle under the title. */
  subtitle?: string;
  /** Which side rail to show first. */
  defaultSide?: "pulse" | "fleet";
  /** Hide the side rail entirely (for a narrow embed). */
  hideRail?: boolean;
  /** Compact embedded mode: hides duplicate top bar & header when mounted inside a deck. */
  compact?: boolean;
}

export function NovaUnifiedChat({
  title = "نوفا — الوكيل الأساسي",
  subtitle = "كلام + تنفيذ حقيقي + ذاكرة دائمة + تحكم في كل الأجهزة المتصلة",
  defaultSide = "pulse",
  hideRail = false,
  compact = false,
}: NovaUnifiedChatProps) {
  const [, navigate] = useLocation();
  const live = useNovaLive();

  // The same client-tool bridge the fleet page uses: when the brain asks the
  // panel to open a window or navigate, it happens here too — one behaviour,
  // wherever the chat is mounted.
  const onClientTool = useCallback(
    (event: ClientToolEvent) => {
      if (event.name === "ui_open_window" || event.name === "open_window") {
        const requestedWindow = event.input.window ?? event.input.kind;
        if (typeof requestedWindow === "string" && requestedWindow.trim()) {
          const params = new URLSearchParams({ open: requestedWindow.trim() });
          if (requestedWindow === "browser" && typeof event.input.url === "string") {
            const rawUrl = event.input.url.trim();
            try {
              const url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
              if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
                params.set("url", url.toString());
              }
            } catch {
              /* open the browser at its safe default */
            }
          }
          navigate(`/desktop?${params.toString()}`);
        }
        return;
      }
      if (event.name === "ui_browse_url" && typeof event.input.url === "string") {
        const rawUrl = event.input.url.trim();
        try {
          const url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
          if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
            navigate(`/desktop?open=browser&url=${encodeURIComponent(url.toString())}`);
          }
        } catch {
          /* ignore an invalid URL */
        }
        return;
      }
      if (event.name === "ui_show_page" && typeof event.input.page === "string") {
        const page = event.input.page.trim();
        if (!page) return;
        try {
          const target = new URL(page.startsWith("/") ? page : `/${page}`, window.location.origin);
          if (target.origin === window.location.origin) navigate(`${target.pathname}${target.search}${target.hash}`);
        } catch {
          /* ignore */
        }
      }
    },
    [navigate],
  );

  const openAgentWindow = useCallback(() => navigate("/desktop?open=agent"), [navigate]);

  // One measured picture of the fleet, straight from the live socket.
  const fleetLine = useMemo(() => {
    const machines = live.machines.length;
    const running = live.running.length;
    return `${machines} جهاز · ${running} مهمة جارية`;
  }, [live.machines.length, live.running.length]);
  const socketOpen = live.socket === "open";

  return (
    <div dir="rtl" className={`flex ${compact ? "h-full" : "h-[calc(100vh-64px)]"} min-h-0 flex-col bg-[#050208] text-white`}>
      {!compact && (
        <>
          <div className="px-3 pt-2">
            <NovaLiveBar />
          </div>

          <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-400/10">
              <Sparkles className="h-4 w-4 text-cyan-300" />
            </div>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-sm font-bold">
                {title}
                <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] text-emerald-200">
                  LIVE
                </span>
              </h1>
              <p className="truncate text-[10px] text-white/40">{subtitle}</p>
            </div>
            <div className="ms-auto flex items-center gap-2 text-[10px] font-mono text-white/45">
              <span className="flex items-center gap-1">
                <Server className="h-3 w-3 text-cyan-300" /> {fleetLine}
              </span>
              <span className="flex items-center gap-1">
                <Radio className={`h-3 w-3 ${socketOpen ? "text-emerald-300" : "text-white/30"}`} />
                {socketOpen ? "بث حي" : "غير متصل"}
              </span>
              <span className="hidden items-center gap-1 sm:flex">
                <ShieldCheck className="h-3 w-3" /> بوابة الموافقة مفعّلة
              </span>
            </div>
          </header>
        </>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden">
          <LiveAgentPanel embedded onClientTool={onClientTool} onOpenAgentWindow={openAgentWindow} />
        </div>
        {!hideRail && (
          <aside className="hidden w-[330px] shrink-0 overflow-hidden border-s border-white/10 lg:block">
            {defaultSide === "pulse" ? <NovaProjectPulse /> : <NovaFleetPanel compact />}
          </aside>
        )}
      </div>
    </div>
  );
}

export default NovaUnifiedChat;

/** Small badge used by the fleet page to point at the unified chat. */
export function NovaUnifiedChatBadge() {
  return (
    <span className="flex items-center gap-1 rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] text-cyan-200">
      <Activity className="h-2.5 w-2.5" /> شات موحّد
    </span>
  );
}
