import type { WebSocket } from "ws";
import { getPlatformControlSnapshot } from "./standalone-api";

interface HubClient {
  ws: WebSocket;
  id: string;
  connectedAt: number;
}

const hubClients = new Map<string, HubClient>();

/**
 * اللوحة أول ما بتتصل بتستنى أول حدث عشان تعرف حالة المنصة. القصة دي بتتحوّل:
 * اللقطة بتبعت مرة واحدة عند الالتحاق — ومتكرّش مع كل بث (البث مش مكان الحالة).
 */
function pushSnapshot(ws: WebSocket): void {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "platform_snapshot", snapshot: getPlatformControlSnapshot(), ts: Date.now() }));
    }
  } catch {
    /* السوكت اتقفل في النص — مفيش حاجة تتفرض */
  }
}

export function registerHubClient(
  idOrWs: string | WebSocket,
  wsOrId?: WebSocket | string,
): void {
  if (typeof idOrWs === "string" && wsOrId && typeof wsOrId !== "string") {
    hubClients.set(idOrWs, { ws: wsOrId, id: idOrWs, connectedAt: Date.now() });
    pushSnapshot(wsOrId);
  } else if (typeof idOrWs !== "string") {
    const id = typeof wsOrId === "string" ? wsOrId : `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    hubClients.set(id, { ws: idOrWs, id, connectedAt: Date.now() });
    pushSnapshot(idOrWs);
  }
}

export function removeHubClient(idOrWs: string | WebSocket): void {
  if (typeof idOrWs === "string") {
    hubClients.delete(idOrWs);
    return;
  }
  for (const [id, client] of hubClients.entries()) {
    if (client.ws === idOrWs) {
      hubClients.delete(id);
    }
  }
}

export function broadcastEvent(
  typeOrObj: string | Record<string, unknown>,
  data?: unknown,
): void {
  const messageObj =
    typeof typeOrObj === "string"
      ? {
          type: typeOrObj,
          ...(typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}),
          data,
          ts: Date.now(),
        }
      : {
          ...typeOrObj,
          ts: Date.now(),
        };

  const payload = JSON.stringify(messageObj);
  for (const [id, client] of hubClients.entries()) {
    try {
      if (client.ws && client.ws.readyState === 1) {
        client.ws.send(payload);
      } else {
        hubClients.delete(id);
      }
    } catch {
      hubClients.delete(id);
    }
  }
}

export function getHubClientCount(): number {
  return hubClients.size;
}
