import { useCallback, useEffect, useRef, useState } from "react";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

export interface UseWebSocketOptions {
  sessionId?: string | null;
  onMessage?: (msg: WsMessage) => void;
  autoConnect?: boolean;
}

export function useWebSocket({ sessionId, onMessage, autoConnect = true }: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!sessionId) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const url = `${proto}://${host}/api/ws?sessionId=${sessionId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => { setConnected(true); setError(null); };
    ws.onclose = () => { setConnected(false); };
    ws.onerror = () => { setError("WebSocket error"); setConnected(false); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsMessage;
        onMessageRef.current?.(msg);
      } catch { /* ignore */ }
    };
    return ws;
  }, [sessionId]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (autoConnect && sessionId) {
      const ws = connect();
      return () => { ws?.close(); };
    }
    return () => {};
  }, [autoConnect, sessionId, connect]);

  return { connected, error, send, connect, disconnect };
}
