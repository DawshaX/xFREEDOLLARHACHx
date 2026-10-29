import type { WebSocket } from "ws";

interface HubClient {
  ws: WebSocket;
  id: string;
  connectedAt: number;
}

const hubClients = new Map<string, HubClient>();

export function registerHubClient(
  idOrWs: string | WebSocket,
  wsOrId?: WebSocket | string,
): void {
  if (typeof idOrWs === "string" && wsOrId && typeof wsOrId !== "string") {
    hubClients.set(idOrWs, { ws: wsOrId, id: idOrWs, connectedAt: Date.now() });
  } else if (typeof idOrWs !== "string") {
    const id = typeof wsOrId === "string" ? wsOrId : `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    hubClients.set(id, { ws: idOrWs, id, connectedAt: Date.now() });
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
