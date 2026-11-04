/**
 * The backend, finally — Supabase Edge + Postgres, free, always on.
 * ─────────────────────────────────────────────────────────────────
 * Everything the panel could not do on GitHub Pages (query 100k CVEs, keep chat
 * history, know what the organs are doing) now goes through one function:
 *
 *   supabase/functions/ops-api  →  /health · /organs · /hunt · /corpus · /chat
 *
 * The key below is the **publishable** key: it can read public rows and nothing
 * else. Writes are rejected unless the request carries the service role, which
 * only lives inside the function's environment.
 */
const PROJECT = "dbaaclqycsiefjwjfavf";
export const BACKEND_URL = `https://${PROJECT}.supabase.co/functions/v1/ops-api`;
/** publishable/anon — safe in a browser bundle by design */
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiYWFjbHF5Y3NpZWZqd2pmYXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3OTg2MzUsImV4cCI6MjEwOTM3NDYzNX0.Xl9wkwocQctksHXZJiugpj29JD_9O1q-_ztDNfU42gA";

const HEADERS = { apikey: ANON, authorization: `Bearer ${ANON}`, "content-type": "application/json" };

export interface BackendHealth {
  ok: boolean;
  at: string;
  counts: { cves: number; huntRuns: number; findings: number };
}

export interface BackendFinding {
  id: number;
  host: string;
  template: string;
  severity: string | null;
  matched_at: string | null;
  verified: boolean;
}

export interface BackendCve {
  cve: string;
  severity: string | null;
  cvss: number | null;
  kev: boolean;
  epss: number | null;
  products: string[];
  summary: string | null;
}

async function getJson<T>(path: string, timeoutMs = 8000): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const backendHealth = () => getJson<BackendHealth>("/health", 6000);

export const backendHunt = () =>
  getJson<{ run: { at: string; totals: Record<string, unknown>; says_ar?: string } | null; findings: BackendFinding[] }>("/hunt");

export const backendOrgans = () =>
  getJson<{ organs: Array<{ id: string; label_ar: string; status: string; detail: string; source: string; at: string }> }>("/organs");

export const backendCorpus = (q: string, limit = 20) =>
  getJson<{ rows: BackendCve[] }>(`/corpus?q=${encodeURIComponent(q)}&limit=${limit}`);

export interface BackendChatResult {
  ok: boolean;
  seat?: string;
  latencyMs?: number;
  text: string;
  error?: string;
}

/**
 * Streaming chat through the backend. The function falls back across keyless
 * seats itself; we read the SSE it forwards and report which seat answered.
 */
export async function streamBackendChat(
  messages: Array<{ role: string; content: string }>,
  onDelta: (text: string) => void,
): Promise<BackendChatResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${BACKEND_URL}/chat`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      return { ok: false, text: "", error: `HTTP ${res.status} ${detail.slice(0, 160)}` };
    }
    const seat = res.headers.get("x-nova-seat") ?? undefined;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let out = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            out += delta;
            onDelta(out);
          }
        } catch {
          /* keep-alive or a non-JSON frame */
        }
      }
    }
    return { ok: out.length > 0, seat, latencyMs: Date.now() - started, text: out, error: out ? undefined : "empty stream" };
  } catch (err) {
    return { ok: false, text: "", error: (err as Error).message };
  }
}

/** Best-effort history write; a failure here never loses a visible answer. */
export async function logChatTurn(turn: {
  conversationId?: string;
  role: "user" | "assistant";
  content: string;
  seat?: string;
  tools?: unknown;
}): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/chatlog`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ conversationId: turn.conversationId ?? null, ...turn }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
