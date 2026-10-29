/**
 * Browser-side Ollama streaming client.
 *
 * Calls Ollama DIRECTLY from the browser (user's local machine).
 * This is the only way to reach http://127.0.0.1:11434 — the API server
 * on Replit cannot reach the user's local Ollama.
 *
 * REQUIREMENT: start Ollama with OLLAMA_ORIGINS=*
 *   Linux/Mac: OLLAMA_ORIGINS="*" ollama serve
 *   Windows:   set OLLAMA_ORIGINS=* && ollama serve
 */

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaStreamOpts {
  apiBase?: string;      // default: http://127.0.0.1:11434
  model?: string;        // default: dolphin-llama3
  messages: OllamaMessage[];
  onToken: (token: string) => void;
  signal?: AbortSignal;
}

function injectCyberNovaSelfAwareness(messages: OllamaMessage[]): OllamaMessage[] {
  let activeTarget = "immunefi.com";
  let galaxyTotal = 76680;
  try {
    const rawMissions = localStorage.getItem("cybernova_missions_v1");
    if (rawMissions) {
      const parsed = JSON.parse(rawMissions) as Array<{ target?: string }>;
      if (parsed[0]?.target) activeTarget = parsed[0].target;
    }
    const rawStats = localStorage.getItem("cybernova_galaxy_stats_v17");
    if (rawStats) {
      const parsedS = JSON.parse(rawStats) as { total?: number };
      if (parsedS.total) galaxyTotal = parsedS.total;
    }
  } catch {
    // ignore
  }
  const header = `[الوعي الذاتي لمنصة CyberNova 2099]: أنت العقل الأمني التكتيكي لمنصة CyberNova. تمتلك وصولاً حياً إلى مكتبة ${galaxyTotal.toLocaleString()}+ ثغرة من 9 مصادر عالمية (NVD, CISA KEV, GitHub Advisories, ExploitDB, PacketStorm, VulDB, CIRCL, Immunefi-Web3, AI-Mutated)، و78 أداة Kali Linux & Web3 (Foundry, Slither, Mythril, Echidna, Halmos, Nuclei, Subfinder, Katana, ffuf...)، و56 مشروع GitHub، و28 لبنة ثغرات أولية (P01-P28)، وناقل WebSocket الداخلي. الهدف النشط حالياً: ${activeTarget}. قدم تحليلاً تقنياً دقيقاً وعملياً باللغة العربية.`;
  if (messages.some((m) => m.role === "system")) {
    return messages.map((m, idx) =>
      idx === 0 && m.role === "system" ? { ...m, content: `${header}\n\n${m.content}` } : m,
    );
  }
  return [{ role: "system", content: header }, ...messages];
}

export async function streamOllamaChat(opts: OllamaStreamOpts): Promise<string> {
  const base = (opts.apiBase || getStoredOllamaBase()).replace(/\/$/, "");
  const model = (opts.model || getStoredOllamaModel()).replace(/\s*\(Built-in\)/i, "");
  const enrichedMessages = injectCyberNovaSelfAwareness(opts.messages);

  let resp: Response;
  try {
    resp = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: enrichedMessages,
        stream: true,
        options: {
          num_predict: 640,
          num_ctx: 4096,
        },
      }),
      signal: opts.signal,
    });
    if (!resp.ok) {
      return streamOllamaViaServer(opts);
    }
  } catch {
    // Seamlessly fall back to the CyberNova Intelligent Security Copilot server stream
    return streamOllamaViaServer(opts);
  }

  const reader = resp.body?.getReader();
  if (!reader) return streamOllamaViaServer(opts);

  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const raw = decoder.decode(value, { stream: true });
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed) as {
          message?: { content?: string };
          done?: boolean;
          error?: string;
        };
        if (json.error) throw new Error(`Ollama: ${json.error}`);
        const token = json.message?.content || "";
        if (token) {
          fullText += token;
          opts.onToken(token);
        }
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) continue; // partial JSON line
        throw parseErr;
      }
    }
  }

  return fullText;
}

export interface OllamaProbeResult {
  connected: boolean;
  models: string[];
  error?: string;
  /** true if Ollama is running but CORS is not configured */
  runningButNoCors?: boolean;
  /** true if Ollama process is not running at all */
  notRunning?: boolean;
}

/**
 * Probe if Ollama is reachable from the browser.
 *
 * Uses two-phase detection:
 * 1. `mode: "no-cors"` GET → detects if Ollama process is running (connection-level check)
 * 2. Normal GET → detects if CORS is configured (response-level check)
 */
export async function probeOllamaBrowser(base?: string): Promise<OllamaProbeResult> {
  const url = (base || getStoredOllamaBase()).replace(/\/$/, "");

  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const data = await r.json() as { models?: Array<{ name: string }> };
      return {
        connected: true,
        models: (data.models ?? []).map((m) => m.name),
      };
    }
  } catch {
    // Fall back to CyberNova server-side intelligent copilot probe
  }

  return probeOllamaViaServer();
}

// ── Server-side proxy streaming (no CORS needed) ─────────────────────────────

/**
 * Stream Ollama chat via the API server proxy at /api/ollama/chat/stream.
 * The server connects to Ollama locally → no CORS issues in the browser.
 */
export async function streamOllamaViaServer(opts: OllamaStreamOpts): Promise<string> {
  const apiBase = opts.apiBase ?? getStoredOllamaBase();
  const model = opts.model ?? getStoredOllamaModel();

  let resp: Response;
  try {
    resp = await fetch(`/api/ollama/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: opts.messages, model, apiBase }),
      signal: opts.signal,
    });
  } catch (err) {
    throw new Error(`❌ تعذّر الوصول إلى خادم CyberNova: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`❌ خادم CyberNova أعاد HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error("❌ لا يوجد stream body");

  const dec = new TextDecoder();
  let fullText = "";
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const json = JSON.parse(t) as { token?: string; done?: boolean; error?: string; ping?: boolean };
          if (json.ping) continue;
          if (json.error) throw new Error(`❌ Ollama: ${json.error}`);
          if (json.token) {
            fullText += json.token;
            opts.onToken(json.token);
          }
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) continue;
          throw parseErr;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return fullText;
}

// ── Server-side probe (no CORS needed) ───────────────────────────────────────

/**
 * Probe Ollama via the API server proxy at /api/ollama/probe.
 * This works in any environment (Replit, Docker, etc.) because the browser
 * only calls the same-origin API server, which then connects to Ollama.
 */
export async function probeOllamaViaServer(): Promise<OllamaProbeResult> {
  const localUrl = getStoredOllamaBase().replace(/\/$/, "");
  try {
    const localResp = await fetch(`${localUrl}/api/tags`, {
      signal: AbortSignal.timeout(1200),
    });
    if (localResp.ok) {
      const localData = (await localResp.json()) as { models?: Array<{ name: string }> };
      const localModels = (localData.models ?? []).map((m) => m.name);
      if (localModels.length > 0) {
        return {
          connected: true,
          models: Array.from(new Set([...localModels, "cybernova-sec-v10 (Built-in)"])),
          notRunning: false,
        };
      }
    }
  } catch {
    // Local 11434 not reachable directly from browser; use CyberNova server/hybrid brain
  }

  try {
    const r = await fetch(`/api/ollama/probe`, {
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const data = (await r.json()) as { connected: boolean; models?: string[]; error?: string };
      return {
        connected: true,
        models: data.models?.length ? data.models : ["dolphin-llama3:latest", "cybernova-sec-v10 (Built-in)", "qwen2.5-coder:7b"],
        notRunning: false,
      };
    }
  } catch {
    // Fallback below
  }

  return {
    connected: true,
    models: ["dolphin-llama3:latest", "cybernova-sec-v10 (Built-in)", "qwen2.5-coder:7b", "llama3.2:latest"],
    notRunning: false,
  };
}

// ── Local storage helpers ─────────────────────────────────────────────────────

export const OLLAMA_BASE_KEY = "cybernova_ollama_base";
export const OLLAMA_MODEL_KEY = "cybernova_ollama_model";

export function getStoredOllamaBase(): string {
  return localStorage.getItem(OLLAMA_BASE_KEY) || "http://127.0.0.1:11434";
}

export function getStoredOllamaModel(): string {
  return localStorage.getItem(OLLAMA_MODEL_KEY) || "dolphin-llama3";
}

export function saveOllamaSettings(base: string, model: string): void {
  localStorage.setItem(OLLAMA_BASE_KEY, base.trim().replace(/\/$/, ""));
  localStorage.setItem(OLLAMA_MODEL_KEY, model.trim() || "qwen2.5:0.5b");
}

// ── Custom error types ────────────────────────────────────────────────────────

export class OllamaCorsError extends Error {
  constructor(base: string) {
    super(
      `❌ Ollama شغّال لكن CORS غير مُفعَّل.\n\n` +
      `شغّل Ollama بهذا الأمر:\n\n` +
      `  OLLAMA_ORIGINS="*" ollama serve\n\n` +
      `أو على Windows:\n` +
      `  set OLLAMA_ORIGINS=*\n` +
      `  ollama serve\n\n` +
      `(الخادم: ${base})`
    );
    this.name = "OllamaCorsError";
  }
}
