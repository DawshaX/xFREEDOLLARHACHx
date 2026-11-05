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

/**
 * True when *this page* is being served by a NOVA engine, rather than by a
 * static host. It is the mirror image of `isStandaloneHost()` and it exists
 * because of a real bug: opened from the Waifly slot, the panel showed
 * «عقل المتصفح» and «السيرفر مش متاح» even though the engine was answering on
 * the very same origin — the workstation only counted a server as "linked" if
 * the user had pasted a URL into localStorage. A page served by the engine is
 * already linked; nobody should have to connect a server to its own origin.
 */
export function servedByEngine(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const proto = window.location.protocol;
    if (proto !== "http:" && proto !== "https:") return false;
    return !isStandaloneHost();
  } catch {
    return false;
  }
}
