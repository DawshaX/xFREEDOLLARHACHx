/**
 * Ollama Daemon Manager
 *
 * Uses the system-installed Ollama binary (via Nix).
 * Ollama is managed by the dedicated 'Ollama Server' workflow.
 * This module only provides probe functionality for health checks.
 */

import { logger } from "./logger";

const OLLAMA_HOST = "127.0.0.1:11434";

/** Call once at server startup. No-op — Ollama runs as a separate workflow. */
export function startOllamaDaemon() {
  logger.info("Ollama is managed by the 'Ollama Server' workflow — daemon not needed");
}

/** Probe Ollama readiness (for health checks) */
export async function probeOllama(timeoutMs = 3000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`http://${OLLAMA_HOST}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}
