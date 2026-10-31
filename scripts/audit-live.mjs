#!/usr/bin/env node
/**
 * CyberNova — Live Render Audit (the one that catches real crashes)
 * ─────────────────────────────────────────────────────────────────
 * `audit-render.mjs` renders every route with the network **switched off**, so a
 * page can look healthy while its production payload is a completely different
 * shape. That is exactly how `/nova-fleet` shipped a blank screen:
 *
 *     TypeError: Cannot read properties of undefined (reading 'length')
 *
 * This audit renders the same routes but proxies every `fetch` to a **running
 * API server**, so components see the exact JSON a real browser sees. It fails
 * when a route:
 *   • mounts the error boundary ("تم التقاط خطأ تشغيلي"), or
 *   • throws an uncaught error / console.error, or
 *   • renders an empty tree.
 *
 * Usage
 *   pnpm --filter @workspace/api-server build
 *   BASE_PATH=/xFREEDOLLARHACHx/ pnpm --filter @workspace/kali-panel run build
 *   node artifacts/api-server/dist/index.mjs &          # PORT=8080
 *   node scripts/audit-live.mjs                         # every route
 *   node scripts/audit-live.mjs /nova-fleet /desktop    # specific routes
 *   node scripts/audit-live.mjs --json
 *
 * Env: AUDIT_API (default http://127.0.0.1:8080), SETTLE_MS (default 2000),
 *      AUDIT_CONCURRENCY (default 6).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args0 = process.argv.slice(2);
const DIST = path.join(ROOT, "artifacts/kali-panel/dist/public");
const APP_TSX = path.join(ROOT, "artifacts/kali-panel/src/App.tsx");
const HOST = "https://dawshax.github.io/xFREEDOLLARHACHx";
const serverArg = args0.find((a) => a.startsWith("--server="));
const API = (serverArg ? serverArg.split("=")[1] : process.env.AUDIT_API || "http://127.0.0.1:8080").replace(/\/$/, "");
const SETTLE_MS = Number(process.env.SETTLE_MS || 2000);
const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY || 6);
const TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 90_000);

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const explicitRoutes = args.filter((a) => a.startsWith("/"));

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`✗ No build at ${DIST}\n  Run: BASE_PATH=/xFREEDOLLARHACHx/ pnpm --filter @workspace/kali-panel run build`);
  process.exit(2);
}

const assetsDir = path.join(DIST, "assets");
const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
const mainJs = assets.find((f) => /^index-.*\.js$/.test(f));
if (!mainJs) {
  console.error("✗ No entry bundle in dist/public/assets");
  process.exit(2);
}

const ALL_ROUTES = [...new Set(["/", ...[...fs.readFileSync(APP_TSX, "utf8").matchAll(/path="([^"]+)"/g)].map((m) => m[1])])]
  .filter((r) => !r.includes(":") && !r.includes("*"));
const ROUTES = explicitRoutes.length ? explicitRoutes : ALL_ROUTES;

const { JSDOM } = await import("jsdom").catch(() => {
  console.error("✗ jsdom is not installed.\n  Run: pnpm add -D jsdom");
  process.exit(2);
});

const realFetch = globalThis.fetch;

export async function renderRoute(route) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: `${HOST}${route}`,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  const errors = [];

  window.addEventListener("error", (e) => errors.push("window.error: " + String(e.message || e).slice(0, 400)));
  window.console.error = (...a) =>
    errors.push("console.error: " + a.map((x) => (x && x.stack ? String(x.stack) : String(x))).join(" ").slice(0, 1200));
  window.console.warn = () => {};

  // Proxy every request to the live server so pages see production payloads.
  const proxyFetch = async (input, init) => {
    let url = typeof input === "string" ? input : input?.url ?? String(input);
    try {
      if (url.startsWith("/")) url = API + url;
      else if (url.startsWith(HOST)) url = API + url.slice(HOST.length);
      if (!url.startsWith(API)) {
        // Third-party host: behave like an offline browser, but answer JSON so
        // `.json()` callers do not explode with a network error.
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      const res = await realFetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      const body = await res.arrayBuffer();
      return new Response(body, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  };

  window.fetch = proxyFetch;
  window.HTMLElement.prototype.scrollTo = function () {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.scrollTo = () => {};
  window.HTMLCanvasElement.prototype.getContext = () => null;
  class StubBC { constructor(n) { this.name = n; } postMessage() {} close() {} addEventListener() {} removeEventListener() {} }
  window.BroadcastChannel = StubBC;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  // Sockets are unavailable in jsdom; fail them the way a dropped server would
  // so components take their offline path instead of hanging.
  window.WebSocket = class {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor() { this.readyState = 3; setTimeout(() => this.onerror?.({}), 5); setTimeout(() => this.onclose?.({}), 6); }
    send() {} close() {} addEventListener() {} removeEventListener() {}
  };
  window.EventSource = class { constructor() {} addEventListener() {} removeEventListener() {} close() {} };

  for (const key of Object.getOwnPropertyNames(window)) {
    if (key in globalThis) continue;
    try { globalThis[key] = window[key]; } catch { /* read-only */ }
  }
  for (const key of ["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage"]) {
    try { Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true }); } catch { /* ignore */ }
  }
  for (const key of ["addEventListener", "removeEventListener", "dispatchEvent", "innerWidth", "innerHeight", "devicePixelRatio", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia"]) {
    try {
      const v = window[key];
      if (v !== undefined) globalThis[key] = typeof v === "function" ? v.bind(window) : v;
    } catch { /* ignore */ }
  }
  globalThis.fetch = proxyFetch;
  globalThis.BroadcastChannel = StubBC;
  globalThis.console.error = (...a) =>
    errors.push("console.error: " + a.map((x) => (x && x.stack ? String(x.stack) : String(x))).join(" ").slice(0, 1200));

  try {
    await import(pathToFileURL(path.join(assetsDir, mainJs)).href);
  } catch (err) {
    window.close?.();
    return { route, ok: false, crashed: false, errors, error: "bundle-import: " + String(err?.message ?? err).slice(0, 300) };
  }

  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const root = window.document.getElementById("root");
  const html = root?.innerHTML ?? "";
  const text = (window.document.body.textContent ?? "").replace(/\s+/g, " ").trim();
  const crashed = text.includes("تم التقاط خطأ تشغيلي") || text.includes("Unexpected Render Error");
  const boundaryError = text.match(/تم التقاط خطأ تشغيلي[^]{0,160}/)?.[0] ?? null;
  window.close?.();

  const cleanErrors = errors.filter(
    (e) => !/Not implemented:|getContext|HTMLCanvasElement|ResizeObserver loop|WebSocket|EventSource/i.test(e),
  );
  return {
    route,
    ok: !crashed && html.length > 200,
    crashed,
    boundaryError,
    htmlLength: html.length,
    textLength: text.length,
    errors: cleanErrors.slice(0, 6),
  };
}

async function runAll() {
  const { spawn } = await import("node:child_process");
  const self = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const queue = [...ROUTES];
  const results = [];

  const worker = async () => {
    for (;;) {
      const route = queue.shift();
      if (!route) return;
      const result = await new Promise((resolve) => {
        const code = `const m = await import(${JSON.stringify(self)});`
          + `const r = await m.renderRoute(${JSON.stringify(route)});`
          + `console.log("__R__" + JSON.stringify(r)); process.exit(0);`;
        const cp = spawn(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: TIMEOUT_MS });
        let buf = "";
        cp.stdout.on("data", (d) => (buf += d));
        cp.on("close", () => {
          const line = buf.split("\n").find((l) => l.startsWith("__R__"));
          resolve(line ? JSON.parse(line.slice(5)) : { route, ok: false, crashed: false, errors: [], error: "child process died" });
        });
      });
      results.push(result);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => a.route.localeCompare(b.route));

  const failed = results.filter((r) => !r.ok);
  if (asJson) {
    console.log(JSON.stringify({ total: results.length, ok: results.length - failed.length, failed: failed.length, results }, null, 2));
  } else {
    for (const r of results) {
      if (r.ok) continue;
      const detail = r.boundaryError ?? r.error ?? "empty render";
      console.log(`✗ ${r.route.padEnd(30)} ${String(detail).slice(0, 160)}`);
      for (const e of (r.errors ?? []).slice(0, 2)) console.log(`    ${String(e).split("\n")[0].slice(0, 180)}`);
    }
    console.log(`\n${results.length - failed.length}/${results.length} routes rendered clean against live data.`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

if (isMain) await runAll();
