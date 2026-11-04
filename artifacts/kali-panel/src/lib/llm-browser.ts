/**
 * Keyless LLM seats — so the chat answers even with no server and no API key.
 * ──────────────────────────────────────────────────────────────────────────
 * On GitHub Pages there is no backend: `streamOllamaViaServer` assumes a NOVA
 * engine on localhost, so the chat page was dead in the browser (`⚠ خطأ`).
 * These seats are called straight from the browser, need no key, and stream
 * tokens so the answer appears as it is written.
 *
 * Honesty rules:
 *   • a seat that fails is reported with its HTTP status / error, never hidden
 *   • the badge shows *which* seat is answering, because "connected" without a
 *     named provider is exactly the kind of claim this project keeps removing
 *   • if every seat fails the UI shows the real reason — it never fakes a reply
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SeatDef {
  id: string;
  label: string;
  model: string;
  /** cost: none, key: none, CORS: open */
  keyless: true;
}

/**
 * Pollinations' OpenAI-compatible gateway: free, no key, CORS-enabled, streams
 * SSE. Several models are reachable through the same endpoint, which gives us a
 * real fallback chain instead of one point of failure.
 */
const GATEWAY = "https://text.pollinations.ai/openai";

export const KEYLESS_SEATS: SeatDef[] = [
  { id: "pollinations-openai", label: "GPT-OSS (keyless)", model: "openai", keyless: true },
  { id: "pollinations-mistral", label: "Mistral (keyless)", model: "mistral", keyless: true },
  { id: "pollinations-llama", label: "Llama (keyless)", model: "llama", keyless: true },
];

export interface StreamOpts {
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  onToken?: (t: string) => void;
  /** called once the first token arrives, with the seat that produced it */
  onSeat?: (seat: SeatDef) => void;
  timeoutMs?: number;
}

export interface StreamResult {
  text: string;
  seat: SeatDef;
  latencyMs: number;
  streamed: boolean;
}

function withTimeout(parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`timeout after ${ms}ms`)), ms);
  const onAbort = () => ctl.abort((parent as AbortSignal & { reason?: unknown })?.reason);
  parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: ctl.signal,
    done: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function readSse(res: Response, onToken?: (t: string) => void): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()) || "";
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
        if (delta) {
          text += delta;
          onToken?.(delta);
        }
      } catch {
        /* a keep-alive or a partial frame: skip, never guess */
      }
    }
  }
  return text;
}

/** Try one seat. Throws with the real reason when it cannot answer. */
async function askSeat(seat: SeatDef, opts: StreamOpts): Promise<StreamResult> {
  const started = performance.now();
  const { signal, done } = withTimeout(opts.signal, opts.timeoutMs ?? 45_000);
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: seat.model, messages: opts.messages, stream: true, referrer: "cybernova" }),
      signal,
    });
    if (!res.ok) throw new Error(`${seat.id}: HTTP ${res.status}`);
    const streamed = Boolean(res.body);
    const text = streamed ? await readSse(res, opts.onToken) : await res.text();
    if (!text.trim()) throw new Error(`${seat.id}: empty answer`);
    opts.onSeat?.(seat);
    return { text, seat, latencyMs: Math.round(performance.now() - started), streamed };
  } finally {
    done();
  }
}

/**
 * Walk the seat list until one answers. The first success wins; the failures are
 * returned so the panel can print exactly why each seat is down.
 */
export async function streamKeylessChat(opts: StreamOpts): Promise<StreamResult & { failures: string[] }> {
  const failures: string[] = [];
  const seats = opts.model
    ? [...KEYLESS_SEATS.filter((s) => s.model === opts.model), ...KEYLESS_SEATS.filter((s) => s.model !== opts.model)]
    : KEYLESS_SEATS;
  for (const seat of seats) {
    try {
      const r = await askSeat(seat, opts);
      return { ...r, failures };
    } catch (err) {
      failures.push((err as Error).message);
    }
  }
  throw new Error(`كل المقاعد المجانية فشلت:\n${failures.join("\n")}`);
}

export interface SeatProbe {
  id: string;
  label: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
}

/** Ping every seat with a 1-token question — the panel shows this as a table. */
export async function probeKeylessSeats(signal?: AbortSignal): Promise<SeatProbe[]> {
  const out: SeatProbe[] = [];
  for (const seat of KEYLESS_SEATS) {
    const started = performance.now();
    try {
      const r = await askSeat(seat, {
        messages: [{ role: "user", content: "reply with the single word: ok" }],
        signal,
        timeoutMs: 20_000,
      });
      out.push({ id: seat.id, label: seat.label, ok: true, latencyMs: r.latencyMs, detail: r.text.trim().slice(0, 40) });
    } catch (err) {
      out.push({ id: seat.id, label: seat.label, ok: false, latencyMs: Math.round(performance.now() - started), detail: (err as Error).message });
    }
  }
  return out;
}
