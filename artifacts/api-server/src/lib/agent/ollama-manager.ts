/**
 * NOVA — Local model manager (Ollama, 100% free)
 * ─────────────────────────────────────────────
 * Goal: the agent must end up with a real local brain **without the user doing
 * anything**. This module:
 *
 *   1. Finds a reachable Ollama (env override → 127.0.0.1 → host.docker.internal
 *      → the machine's LAN name, for Docker/Compose setups).
 *   2. Reports which models are already pulled.
 *   3. Pulls a small, capable free model on first run (`qwen2.5:3b` by default —
 *      the best quality/size trade-off for CPU-only boxes).
 *   4. Caches the answer for a few seconds so status endpoints stay cheap.
 *
 * It never *installs* the Ollama binary itself (that needs root/network access we
 * don't own). Instead `installHint()` returns the exact copy-paste command, and
 * `deploy/oracle-setup.sh` / `docker-compose.yml` do the install for you.
 */

const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const PULL_TIMEOUT_MS = Number(process.env.OLLAMA_PULL_TIMEOUT_MS || 15 * 60_000);

export interface OllamaModel {
  name: string;
  sizeBytes: number;
  modifiedAt: string | null;
}

export interface OllamaHealth {
  ok: boolean;
  baseUrl: string;
  reachable: boolean;
  models: OllamaModel[];
  activeModel: string | null;
  /** True when a usable chat model is present. */
  ready: boolean;
  hint: string | null;
  error: string | null;
  checkedAt: string;
}

export interface PrepareResult extends OllamaHealth {
  pulled: string | null;
  message: string;
}

function candidates(): string[] {
  const env = process.env.OLLAMA_BASE_URL?.trim();
  const list = [
    env,
    "http://127.0.0.1:11434",
    "http://host.docker.internal:11434", // Docker Desktop / Compose
    "http://ollama:11434", // docker-compose service name
  ].filter(Boolean) as string[];
  return Array.from(new Set(list.map((u) => u.replace(/\/$/, ""))));
}

async function ping(base: string, ms = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(ms) });
    return res.ok;
  } catch {
    return false;
  }
}

let cachedBase: { base: string; at: number } | null = null;

export async function resolveOllamaBase(force = false): Promise<string | null> {
  if (!force && cachedBase && Date.now() - cachedBase.at < 20_000) return cachedBase.base;
  for (const base of candidates()) {
    if (await ping(base)) {
      cachedBase = { base, at: Date.now() };
      return base;
    }
  }
  cachedBase = null;
  return null;
}

function installHint(): string {
  return [
    "Ollama مش متاح. نصّبه مرة واحدة (مجاني):",
    "  Linux:  curl -fsSL https://ollama.com/install.sh | sh",
    "  macOS:  brew install ollama   (أو من https://ollama.com/download)",
    "  Docker: docker run -d -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama",
    `  بعدها:  ollama pull ${DEFAULT_MODEL}`,
  ].join("\n");
}

/** Fast, cached health snapshot. */
export async function ollamaHealth(force = false): Promise<OllamaHealth> {
  const base = await resolveOllamaBase(force);
  const checkedAt = new Date().toISOString();
  if (!base) {
    return {
      ok: false,
      baseUrl: candidates()[0],
      reachable: false,
      models: [],
      activeModel: null,
      ready: false,
      hint: installHint(),
      error: "no Ollama endpoint answered /api/tags",
      checkedAt,
    };
  }
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    const json = (await res.json()) as { models?: Array<{ name: string; size: number; modified_at: string }> };
    const models: OllamaModel[] = (json.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      modifiedAt: m.modified_at ?? null,
    }));
    const wanted = DEFAULT_MODEL;
    const hasWanted = models.some((m) => m.name === wanted || m.name.startsWith(`${wanted}:`));
    const activeModel = hasWanted ? wanted : (models[0]?.name ?? null);
    return {
      ok: models.length > 0,
      baseUrl: base,
      reachable: true,
      models,
      activeModel,
      ready: models.length > 0,
      hint: models.length > 0 ? null : `Ollama شغال بس مفيش موديل. نزّل واحد: ollama pull ${DEFAULT_MODEL}`,
      error: null,
      checkedAt,
    };
  } catch (err) {
    return {
      ok: false,
      baseUrl: base,
      reachable: true,
      models: [],
      activeModel: null,
      ready: false,
      hint: installHint(),
      error: (err as Error).message,
      checkedAt,
    };
  }
}

/**
 * Makes sure a chat model exists, pulling the default one when needed.
 * Safe to call on every boot: it's a no-op when a model is already present.
 */
export async function ensureOllamaReady(
  opts: { model?: string; allowPull?: boolean; force?: boolean } = {},
): Promise<PrepareResult> {
  const health = await ollamaHealth(opts.force);
  const model = opts.model || DEFAULT_MODEL;

  if (!health.reachable) {
    return { ...health, pulled: null, message: "Ollama مش شغال — هنكمّل بالعقل المدمج أو مزوّد سحابي مجاني." };
  }
  if (health.models.length > 0) {
    return { ...health, pulled: null, message: `العقل المحلي جاهز: ${health.activeModel}` };
  }
  if (opts.allowPull === false) {
    return { ...health, pulled: null, message: `مفيش موديل. شغّل: ollama pull ${model}` };
  }

  // Pull with streamed progress; abort after a generous timeout.
  try {
    const res = await fetch(`${health.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: false }),
      signal: AbortSignal.timeout(PULL_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ...health, pulled: null, message: `فشل تنزيل ${model}: HTTP ${res.status} ${text.slice(0, 120)}` };
    }
    await res.body?.cancel().catch(() => {});
    const after = await ollamaHealth(true);
    return {
      ...after,
      pulled: model,
      message: after.ready ? `تم تنزيل ${model} — العقل المحلي اشتغل.` : `تم إرسال طلب تنزيل ${model}، جرّب تاني بعد شوية.`,
    };
  } catch (err) {
    return {
      ...health,
      pulled: null,
      message: `فشل تنزيل ${model}: ${(err as Error).message}`,
    };
  }
}

/** Model that the LLM layer should actually call. */
export async function preferredOllamaModel(): Promise<string> {
  const base = await resolveOllamaBase();
  if (!base) return DEFAULT_MODEL;
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const names = (json.models ?? []).map((m) => m.name);
    const wanted = DEFAULT_MODEL;
    return names.find((n) => n === wanted || n.startsWith(`${wanted}:`)) ?? names[0] ?? wanted;
  } catch {
    return DEFAULT_MODEL;
  }
}
