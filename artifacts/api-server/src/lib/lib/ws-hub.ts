import type { WebSocket } from "ws";

interface HubClient {
  ws: WebSocket;
  id: string;
  connectedAt: number;
}

const hubClients = new Map<string, HubClient>();

export function registerHubClient(id: string, ws: WebSocket): void {
  hubClients.set(id, { ws, id, connectedAt: Date.now() });
}

export function removeHubClient(id: string): void {
  hubClients.delete(id);
}

export function broadcastEvent(type: string, data: unknown): void {
  const payload = JSON.stringify({ type, data, ts: Date.now() });
  for (const [id, client] of hubClients) {
    try {
      if (client.ws.readyState === 1) {
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
