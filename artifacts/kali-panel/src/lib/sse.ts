import { novaAuthHeaders, novaTokenQuery } from "./ops-client";

export interface SseEvent {
  event: string;
  data: unknown;
}

const API_BASE = "/api";

/** بوابة الكتابة ردّت 403 token_required → أبلغ الـUI عشان بانر التوكن يظهر فورًا. */
function maybeSignalTokenRequired(res: Response, body: unknown): void {
  try {
    if (res.status === 403 && (body as { error?: string } | null)?.error === "token_required") {
      window.dispatchEvent(new CustomEvent("nova:token-required", {
        detail: { endpoint: String((body as { endpoint?: string })?.endpoint ?? "") },
      }));
    }
  } catch { /* window مش موجودة (اختبارات) — تجاهل */ }
}

/** Build the request headers once, merging caller headers with the ops token. */
function authHeaders(init: RequestInit): Record<string, string> {
  const headers = new Headers(init.headers ?? undefined);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return novaAuthHeaders(Object.fromEntries(headers.entries()));
}

export async function sseStream(
  path: string,
  init: RequestInit,
  onEvent: (e: SseEvent) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(init),
  });
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = raw.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      try {
        onEvent({ event, data: data ? JSON.parse(data) : null });
      } catch {
        onEvent({ event, data });
      }
    }
  }
}

export async function jsonRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: authHeaders(init),
  });
  if (!res.ok) {
    // If response is HTML (error page), throw a more descriptive error
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
      const text = await res.text();
      throw new Error(`Server returned HTML error page instead of JSON: ${res.status} ${res.statusText}`);
    }
    // البوابة بترجع JSON {error:"token_required"} — اقرأ البودي عشان نعلّم الـUI
    try {
      const maybeJson = await res.clone().json();
      maybeSignalTokenRequired(res, maybeJson);
    } catch { /* مش JSON — لا شيء */ }
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;

  // Check if response is actually JSON
  const contentType = res.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(`Expected JSON response but got ${contentType || "unknown"}: ${text.substring(0, 100)}...`);
  }

  try {
    return await res.json() as Promise<T>;
  } catch (error) {
    const text = await res.text();
    throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : "Unknown error"}. Response: ${text.substring(0, 100)}...`);
  }
}

/* TEST8 «كل زرار له رد فعل حقيقي»: إشعار لمركز الإشعارات الحي (SSE popup +
 * سجل دائم). fire-and-forget — الإشعار ما يفشلش الفعل نفسه ولا يعلّقه،
 * والفشل بتاعه صامت لأن المهمة هي رد الفعل مش التنفيذ. */
export function pushNotify(
  kind: "info" | "success" | "error" | "warning",
  title: string,
  body = "",
): void {
  void jsonRequest("/push/notify", {
    method: "POST",
    body: JSON.stringify({ kind, title, body }),
  }).catch(() => {});
}

// Re-export the query helper so callers that open raw EventSource / WebSocket
// connections (e.g. SystemContext, NovaFleetLive) use the same token source.
export { novaTokenQuery };
