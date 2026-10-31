#!/usr/bin/env node
/**
 * CyberNova — Page Render Audit (black-screen detector)
 * ──────────────────────────────────────────────────────
 * Boots the built single-page bundle inside a simulated GitHub Pages DOM and
 * renders every route declared in `App.tsx`, failing when a route mounts an
 * empty tree (the classic "black screen").
 *
 * Requirements
 *   - a production build:  BASE_PATH=/xFREEDOLLARHACHx/ pnpm --filter @workspace/kali-panel run build
 *   - jsdom:               pnpm add -D jsdom      (optional dev tool, not shipped)
 *
 * Usage
 *   node scripts/audit-render.mjs                 # all routes
 *   node scripts/audit-render.mjs /desktop /vuln-center
 *   node scripts/audit-render.mjs --json
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIST = path.join(ROOT, "artifacts/kali-panel/dist/public");
const APP_TSX = path.join(ROOT, "artifacts/kali-panel/src/App.tsx");
const HOST = "https://dawshax.github.io/xFREEDOLLARHACHx";
const SETTLE_MS = Number(process.env.RENDER_SETTLE_MS || 1300);

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const explicitRoutes = args.filter((a) => a.startsWith("/"));

const RENDER_TIMEOUT_MS = 90_000;

if (isMain && !fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`✗ No build found at ${DIST}\n  Run: BASE_PATH=/xFREEDOLLARHACHx/ pnpm --filter @workspace/kali-panel run build`);
  process.exit(2);
}

const { JSDOM } = await import("jsdom").catch(() => {
  if (!isMain) throw new Error("jsdom missing");
  console.error("✗ jsdom is not installed.\n  Run: pnpm add -D jsdom");
  process.exit(2);
});

const ROUTES = !isMain ? [] : explicitRoutes.length
  ? explicitRoutes
  : [...new Set(["/", "/desktop", ...[...fs.readFileSync(APP_TSX, "utf8").matchAll(/path="([^"]+)"/g)].map((m) => m[1])])];

const assets = fs.existsSync(path.join(DIST, "assets")) ? fs.readdirSync(path.join(DIST, "assets")) : [];
const mainJs = assets.find((f) => /^index-.*\.js$/.test(f));
if (!mainJs) {
  console.error("✗ Could not find the entry bundle in dist/public/assets");
  process.exit(2);
}

async function renderRoute(route) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: `${HOST}${route}`,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message || e)));
  window.console.error = (...a) => errors.push("console.error: " + a.map(String).join(" ").slice(0, 300));
  window.console.warn = () => {};

  // Minimal browser surface that jsdom does not implement.
  window.fetch = async () => Promise.reject(new Error("render-audit: network disabled"));
  window.HTMLElement.prototype.scrollTo = function () {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.scrollTo = () => {};
  class StubBroadcastChannel {
    constructor(name) { this.name = name; this.onmessage = null; }
    postMessage() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
  }
  window.BroadcastChannel = StubBroadcastChannel;
  if (!window.ResizeObserver) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }

  for (const key of Object.getOwnPropertyNames(window)) {
    if (key in globalThis) continue;
    try {
      globalThis[key] = window[key];
    } catch {
      /* read-only globals are fine */
    }
  }
  for (const key of ["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage"]) {
    try {
      Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
    } catch {
      /* ignore */
    }
  }
  for (const key of ["addEventListener", "removeEventListener", "dispatchEvent", "innerWidth", "innerHeight", "devicePixelRatio"]) {
    try {
      if (globalThis[key] === undefined && window[key] !== undefined) {
        globalThis[key] = typeof window[key] === "function" ? window[key].bind(window) : window[key];
      }
    } catch {
      /* ignore */
    }
  }
  globalThis.fetch = window.fetch;
  globalThis.BroadcastChannel = StubBroadcastChannel;

  process.on("uncaughtException", (e) => errors.push("uncaughtException: " + String(e?.message ?? e).slice(0, 200)));
  process.on("unhandledRejection", (e) => errors.push("unhandledRejection: " + String(e?.message ?? e).slice(0, 200)));

  try {
    await import(pathToFileURL(path.join(DIST, "assets", mainJs)).href);
  } catch (err) {
    return { route, ok: false, phase: "bundle-import", error: String(err?.stack ?? err).slice(0, 500), errors };
  }
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  window.close?.();
  const html = window.document.getElementById("root")?.innerHTML ?? "";
  const text = (window.document.body.textContent ?? "").replace(/\s+/g, " ").trim();
  return { route, ok: html.length > 200, htmlLength: html.length, textLength: text.length, errors: errors.slice(0, 5) };
}

async function runAll() {
const results = [];
for (const route of ROUTES) {
  // Each route needs a pristine module graph; run it in a child process.
  const child = await import("node:child_process");
  const code = `
    const { renderRoute } = await import(${JSON.stringify(pathToFileURL(import.meta.filename).href)});
    const r = await renderRoute(${JSON.stringify(route)});
    console.log("__RESULT__" + JSON.stringify(r));
    process.exit(0);
  `;
  const out = child.spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 60_000 });
  const line = (out.stdout || "").split("\n").find((l) => l.startsWith("__RESULT__"));
  if (line) {
    results.push(JSON.parse(line.slice("__RESULT__".length)));
  } else {
    results.push({ route, ok: false, phase: "child-process", error: (out.stderr || "").slice(0, 300) });
  }
}

const failed = results.filter((r) => !r.ok);
if (asJson) {
  console.log(JSON.stringify({ total: results.length, ok: results.length - failed.length, failed: failed.length, results }, null, 2));
} else {
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.route.padEnd(28)} ${r.ok ? `${r.htmlLength} bytes` : (r.error ?? r.phase ?? "empty render")}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} routes rendered.`);
}
process.exit(failed.length === 0 ? 0 : 1);
}

export { renderRoute };

if (isMain) {
  await runAll();
}
