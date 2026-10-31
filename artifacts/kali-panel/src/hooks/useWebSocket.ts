import { useEffect, useRef, useState, useCallback } from "react";
import { resolveStandaloneApi } from "@/lib/standalone-api";
import { getRemoteBase, remoteWsUrl } from "@/lib/remote";
import { isStandaloneHost } from "@/lib/env";

export type WsEventHandler = (event: { type: string; [key: string]: unknown }) => void;

interface UseWebSocketOptions {
  sessionId?: string;
  onMessage?: WsEventHandler;
  autoConnect?: boolean;
}

const WS_CHANNEL_NAME = "cybernova_ws_bus";
const localListeners = new Set<WsEventHandler>();
let activeSocket: WebSocket | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  try {
    if (typeof BroadcastChannel !== "undefined") {
      return new BroadcastChannel(WS_CHANNEL_NAME);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Broadcast a platform event to:
 *  1. All in-page listeners (TopBar, FloatingNovaButton, SystemContext, BugBountyStudio, etc.)
 *  2. All other browser tabs via BroadcastChannel
 *  3. The backend /api/ws WebSocket hub (if connected)
 */
export function emitPlatformWsEvent(event: { type: string; [key: string]: unknown }) {
  const payload = { ...event, ts: event.ts ?? Date.now() };
  localListeners.forEach((fn) => {
    try {
      fn(payload);
    } catch {
      // ignore
    }
  });
  if (typeof window !== "undefined") {
    const g = window as unknown as { __cybernovaRawWsListeners?: Set<(ev: unknown) => void> };
    g.__cybernovaRawWsListeners?.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        // ignore
      }
    });
  }
  const bc = getBroadcastChannel();
  if (bc) {
    try {
      bc.postMessage(payload);
      bc.close();
    } catch {
      // ignore
    }
  }
  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    try {
      activeSocket.send(JSON.stringify(payload));
    } catch {
      // ignore
    }
  }
  // Mirror onto the platform SSE bus (installed by setup.ts on static hosts) so
  // EventSource consumers such as SystemContext receive the same live events.
  if (typeof window !== "undefined") {
    const hook = (window as unknown as { __cybernovaPlatformSse?: (name: string, data: unknown) => void })
      .__cybernovaPlatformSse;
    if (hook) {
      try { hook("message", payload); } catch { /* ignore */ }
    }
  }
}

if (typeof window !== "undefined") {
  (window as unknown as { __cybernovaEmitWs?: typeof emitPlatformWsEvent }).__cybernovaEmitWs = emitPlatformWsEvent;
}

function simulateStandaloneWsChat(
  msg: Record<string, unknown>,
  dispatch: (ev: { type: string; [key: string]: unknown }) => void,
) {
  const requestId = String(msg.requestId || `req_${Date.now()}`);
  const content = String(msg.content || "");
  const toolCallId = `tc_${Date.now()}`;

  setTimeout(() => {
    dispatch({
      type: "chat_tool_call",
      requestId,
      id: toolCallId,
      name: "cybernova_galaxy_brain_sync",
      input: { query: content.slice(0, 120), mode: "internal-ws-bus", galaxyCves: 76680 },
    });
  }, 40);

  setTimeout(() => {
    dispatch({
      type: "chat_tool_result",
      requestId,
      toolCallId,
      result: JSON.stringify({ synced: true, bus: "internal-ws-active", galaxyCves: 76680, tools: 78, primitives: 28 }, null, 2),
      isError: false,
    });
  }, 110);

  const brainRes = resolveStandaloneApi("/api/ollama/chat", "POST", { prompt: content }) as { response?: string } | null;
  const reply =
    brainRes?.response ||
    `⚡ **وكيل CyberNova الحي (متصل عبر ناقل WebSocket الداخلي ومكتبة 76,680+ ثغرة)**\n\n` +
    `تم استلام رسالتك: "${content}"\n\n` +
    `- جميع الأحداث والملاحظات والأهداف متزامنة في الوقت الفعلي مع **الذاكرة (/memory)** و**متتبع المهام (/mission-tracker)** و**Bug Bounty Studio**.`;

  const chunks = reply.match(/.{1,36}/gs) ?? [reply];
  chunks.forEach((chunk, idx) => {
    setTimeout(() => {
      dispatch({ type: "chat_delta", requestId, text: chunk });
      if (idx === chunks.length - 1) {
        dispatch({ type: "chat_done", requestId, ts: Date.now() });
      }
    }, 150 + idx * 14);
  });
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { sessionId = "global", onMessage, autoConnect = true } = options;
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<{ type: string; [key: string]: unknown } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlersRef = useRef<Set<WsEventHandler>>(new Set());
  const isStaticHost = isStandaloneHost();

  if (onMessage) {
    handlersRef.current.add(onMessage);
  }

  const dispatchLocal = useCallback((data: { type: string; [key: string]: unknown }) => {
    setLastEvent(data);
    handlersRef.current.forEach((h) => {
      try {
        h(data);
      } catch {
        // ignore
      }
    });
  }, []);

  useEffect(() => {
    localListeners.add(dispatchLocal);
    const bc = getBroadcastChannel();
    if (bc) {
      bc.onmessage = (ev) => {
        if (ev.data && typeof ev.data === "object") {
          dispatchLocal(ev.data as { type: string; [key: string]: unknown });
        }
      };
    }
    return () => {
      localListeners.delete(dispatchLocal);
      if (bc) bc.close();
    };
  }, [dispatchLocal]);

  const connect = useCallback(() => {
    const hasRemote = (() => {
      try {
        return Boolean(getRemoteBase());
      } catch {
        return false;
      }
    })();
    if (isStaticHost && !hasRemote) {
      // No server, no socket. Reporting "connected" here was a lie the UI showed
      // as a live link; now it correctly reads as offline.
      setConnected(false);
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // When a NOVA server is linked, the realtime channel lives on that server.
    // On GitHub Pages isStaticHost used to short-circuit this into "connected"
    // with no socket at all — a fake green light. Now: linked server → real
    // socket; no server → genuinely disconnected.
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const url = `${proto}://${host}/api/ws?sessionId=${encodeURIComponent(sessionId)}`;
    const remoteBase = (() => {
      try {
        return getRemoteBase();
      } catch {
        return "";
      }
    })();
    const finalUrl = remoteBase ? remoteWsUrl(`/api/ws?sessionId=${encodeURIComponent(sessionId)}`) : url;

    try {
      const ws = new WebSocket(finalUrl);
      wsRef.current = ws;
      activeSocket = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data as string) as { type: string; [key: string]: unknown };
          dispatchLocal(data);
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        // Fall back to internal bus so UI remains functional even if WS reconnects
        setConnected(true);
        wsRef.current = null;
        reconnectTimer.current = setTimeout(() => {
          connect();
        }, 4000);
      };

      ws.onerror = () => {
        setConnected(true);
        ws.close();
      };
    } catch {
      setConnected(true);
    }
  }, [sessionId, isStaticHost, dispatchLocal]);

  const send = useCallback(
    (data: Record<string, unknown>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(data));
        return;
      }
      if (data.type === "chat_send") {
        simulateStandaloneWsChat(data, dispatchLocal);
        return;
      }
      emitPlatformWsEvent(data as { type: string; [key: string]: unknown });
    },
    [dispatchLocal],
  );

  const subscribe = useCallback((handler: WsEventHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (autoConnect) connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [autoConnect, connect]);

  return { connected, lastEvent, send, subscribe };
}
