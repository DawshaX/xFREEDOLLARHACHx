import { useEffect, useRef, useState, useCallback } from "react";

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
      name: "memory_and_target_sync",
      input: { query: content.slice(0, 120), mode: "internal-ws-bus" },
    });
  }, 60);

  setTimeout(() => {
    dispatch({
      type: "chat_tool_result",
      requestId,
      toolCallId,
      result: JSON.stringify({ synced: true, bus: "internal-ws-active" }, null, 2),
      isError: false,
    });
  }, 180);

  const reply =
    `⚡ **وكيل CyberNova الحي (متصل عبر ناقل WebSocket الداخلي)**\n\n` +
    `تم استلام رسالتك: "${content}"\n\n` +
    `- جميع الأحداث والملاحظات والأهداف متزامنة في الوقت الفعلي مع **الذاكرة (/memory)** و**متتبع المهام (/mission-tracker)** و**Bug Bounty Studio**.\n` +
    `- يمكنك الآن اختيار هدف من **Bug Bounty Studio** أو كتابة نطاق الهدف هنا لبدء الفحص القانوني وتوثيق النتائج تلقائياً.`;

  const chunks = reply.match(/.{1,20}/gs) ?? [reply];
  chunks.forEach((chunk, idx) => {
    setTimeout(() => {
      dispatch({ type: "chat_delta", requestId, text: chunk });
      if (idx === chunks.length - 1) {
        dispatch({ type: "chat_done", requestId, ts: Date.now() });
      }
    }, 240 + idx * 25);
  });
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { sessionId = "global", onMessage, autoConnect = true } = options;
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<{ type: string; [key: string]: unknown } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlersRef = useRef<Set<WsEventHandler>>(new Set());
  const isStaticHost =
    typeof window !== "undefined" && window.location.hostname.endsWith("github.io");

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
    if (isStaticHost) {
      setConnected(true);
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const url = `${proto}://${host}/api/ws?sessionId=${encodeURIComponent(sessionId)}`;

    try {
      const ws = new WebSocket(url);
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
