/**
 * Environment helpers shared by the runtime shims (`setup.ts`) and the
 * WebSocket hook.
 */

/**
 * True when the app is running without a reachable API server and must use the
 * built-in standalone engine instead of network calls.
 *
 * Enabled for:
 *  - GitHub Pages (`*.github.io`) — the production static deployment
 *  - `file://` (opening the built `dist/public` locally)
 *  - an explicit opt-in: `?standalone=1` or `localStorage.cybernova_force_standalone = "1"`
 */
export function isStandaloneHost(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const host = window.location.hostname;
    if (host.endsWith("github.io")) return true;
    if (window.location.protocol === "file:") return true;
    const params = new URLSearchParams(window.location.search);
    if (params.has("standalone")) return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("cybernova_force_standalone") === "1") {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}
