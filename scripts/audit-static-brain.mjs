#!/usr/bin/env node
/**
 * CyberNova — Static Brain & Remote Connector Audit
 * ────────────────────────────────────────────────
 * Proves the two ways the GitHub Pages build can answer the chat:
 *
 *   1. BROWSER BRAIN — with no server, `/api/nova-core/chat` must stream real
 *      `event: <type>` + `data: {...}` frames (thought → tool_call →
 *      tool_result → delta → done), not a `{ok:true}` stub that leaves the user
 *      with an empty bubble.
 *
 *   2. LINKED SERVER — with `localStorage.cybernova_remote_base` set, every
 *      `/api/*` call must be rewritten to that server (real brain, real fleet),
 *      and WebSocket URLs must become `ws(s)://<server>`.
 *
 * Runs the *production bundle* inside jsdom at the GitHub Pages origin, so it
 * tests exactly what ships.
 *
 * Usage
 *   BASE_PATH=/xFREEDOLLARHACHx/ pnpm --filter @workspace/kali-panel run build
 *   node scripts/audit-static-brain.mjs
 *   node scripts/audit-static-brain.mjs --server=http://127.0.0.1:8080   # test linking too
 *   node scripts/audit-static-brain.mjs --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "artifacts/kali-panel/dist/public");
const HOST = "https://dawshax.github.io/xFREEDOLLARHACHx";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const serverArg = args.find((a) => a.startsWith("--server="));
const SERVER = serverArg ? serverArg.split("=")[1].replace(/\/$/, "") : "";
const MODE = (args.find((a) => a.startsWith("--mode=")) || "").split("=")[1] || "";
const PHASE_OUT = "/tmp/nova-static-brain-phase.json";

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`✗ No build at ${DIST}\n  Run: BASE_PATH=/xFREEDOLLARHACHx/ pnpm --filter @workspace/kali-panel run build`);
  process.exit(2);
}

const mainJs = fs.readdirSync(path.join(DIST, "assets")).find((f) => /^index-.*\.js$/.test(f));
if (!mainJs) {
  console.error("✗ No entry bundle found");
  process.exit(2);
}

const { JSDOM } = await import("jsdom").catch(() => {
  console.error('✗ jsdom missing. Run: pnpm add -D jsdom');
  process.exit(2);
});

const findings = [];
const results = {};

function bootDom({ remoteBase = "", search = "" } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: `${HOST}/nova-fleet${search}`,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  if (remoteBase) {
    window.localStorage.setItem("cybernova_remote_base", JSON.stringify({ base: remoteBase, savedAt: Date.now() }));
  }
  window.HTMLElement.prototype.scrollTo = function () {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  const sockets = [];
  window.WebSocket = class {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      sockets.push(this.url);
      setTimeout(() => this.onerror?.({}), 5);
      setTimeout(() => this.onclose?.({}), 6);
    }
    send() {} close() {} addEventListener() {} removeEventListener() {}
  };
  window.EventSource = class { constructor(u) { this.url = u; } addEventListener() {} removeEventListener() {} close() {} };

  // jsdom has no fetch; give the bundle Node's real fetch so the app's own shim
  // (setup.ts) can wrap it, exactly like a browser.
  if (!window.fetch) window.fetch = globalThis.fetch.bind(globalThis);
  if (!window.Request) window.Request = globalThis.Request;
  if (!window.Response) window.Response = globalThis.Response;
  if (!window.Headers) window.Headers = globalThis.Headers;
  if (!window.ReadableStream) window.ReadableStream = globalThis.ReadableStream;
  if (!window.AbortController) window.AbortController = globalThis.AbortController;
  if (!window.URL) window.URL = globalThis.URL;

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
  globalThis.fetch = window.fetch;
  globalThis.console.error = () => {};
  return { dom, window, sockets };
}

/** Read an SSE Response and return the parsed frames. */
async function readSse(res, timeoutMs = 20000) {
  const events = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const started = Date.now();
  let buf = "";
  for (;;) {
    if (Date.now() - started > timeoutMs) break;
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try { events.push(JSON.parse(raw)); } catch { /* ignore */ }
      }
    }
  }
  return events;
}

/* ── 1. browser brain ───────────────────────────────────────────────────── */

async function phaseBrowserBrain() {
  const { window } = bootDom();
  await import(pathToFileURL(path.join(DIST, "assets", mainJs)).href);
  await new Promise((r) => setTimeout(r, 300));

  const res = await window.fetch("/api/nova-core/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "ابحث عن CVE-2025-29927 وإيه حالة المنصة؟", sessionId: "audit" }),
  });

  const ctype = res.headers.get("content-type") ?? "";
  const events = await readSse(res);
  const types = [...new Set(events.map((e) => e.type))];
  const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  const toolResults = events.filter((e) => e.type === "tool_result");

  results.browserBrain = {
    status: res.status,
    contentType: ctype,
    events: events.length,
    types,
    tools: toolResults.length,
    toolsOk: toolResults.filter((t) => t.ok).length,
    replyChars: text.length,
    replyPreview: text.slice(0, 200),
  };

  if (!ctype.includes("text/event-stream")) findings.push({ kind: "no-sse", detail: `content-type=${ctype}` });
  if (events.length === 0) findings.push({ kind: "empty-stream", detail: "chat returned 200 but zero SSE frames (the old bug)" });
  for (const required of ["thought", "tool_call", "tool_result", "delta", "done"]) {
    if (!types.includes(required)) findings.push({ kind: "missing-event", detail: `browser brain never emitted '${required}'` });
  }
  if (text.length < 80) findings.push({ kind: "empty-reply", detail: `reply only ${text.length} chars` });
  window.close?.();
}

/* ── 2. linked server ───────────────────────────────────────────────────── */

async function phaseLinkedServer() {
  if (!SERVER) {
    findings.push({ kind: "no-server", detail: "phase 2 needs --server=" });
    return;
  }
  const probe = await fetch(`${SERVER}/api/nova-core/status`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  if (!probe?.ok) {
    findings.push({ kind: "server-down", detail: `${SERVER} did not answer /api/nova-core/status` });
  } else {
    await probe.body?.cancel().catch(() => {});
    const { window, sockets } = bootDom({ remoteBase: SERVER, search: "?standalone=1" });
    await import(pathToFileURL(path.join(DIST, "assets", mainJs)).href);
    await new Promise((r) => setTimeout(r, 400));

    // Status must come from the REAL server, not the static engine.
    const statusRes = await window.fetch("/api/nova-core/status");
    const status = await statusRes.json();
    const realServer = status?.mode !== "static" && Boolean(status?.brain);

    // Chat must be proxied to the server too.
    const chatRes = await window.fetch("/api/nova-core/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "إيه الأجهزة المتصلة؟" }),
    });
    const events = await readSse(chatRes, 30000);
    const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");

    results.linkedServer = {
      base: SERVER,
      statusFromRealServer: realServer,
      brainMode: status?.brain?.mode ?? null,
      chatEvents: events.length,
      chatReplyChars: text.length,
      chatTools: events.filter((e) => e.type === "tool_result").length,
      socketUrls: sockets.slice(0, 4),
    };

    // The socket layer: with a server linked the standalone shim must hand off to
    // a REAL WebSocket instead of faking a green "connected" light.
    try {
      const probeSocket = new window.WebSocket(`/api/ws?sessionId=audit`);
      probeSocket.close?.();
    } catch (err) {
      findings.push({ kind: "ws-throw", detail: String(err?.message ?? err) });
    }
    await new Promise((r) => setTimeout(r, 120));

    if (!realServer) findings.push({ kind: "not-proxied", detail: "status still answered by the static engine while a server was linked" });
    if (events.length === 0) findings.push({ kind: "linked-chat-empty", detail: "linked-server chat produced no events" });
    if (!sockets.some((u) => /^wss?:\/\//.test(u))) findings.push({ kind: "no-ws", detail: "linked server did not open a real WebSocket (the stale shim faked it)" });
    if (!sockets.some((u) => u.includes(new URL(SERVER).host))) {
      findings.push({ kind: "ws-not-remote", detail: `socket URLs did not target ${new URL(SERVER).host}: ${sockets.join(", ")}` });
    }
    window.close?.();
  }
}


/* ── 3. work page really renders ────────────────────────────────────────── */

async function phaseWorkUi() {
  const { window } = bootDom();
  await import(pathToFileURL(path.join(DIST, "assets", mainJs)).href);
  await new Promise((r) => setTimeout(r, 2500));

  const text = window.document.body.textContent || "";
  const inputs = window.document.querySelectorAll("textarea, input").length;
  const need = ["محطة العمل", "خريطة الشبكة", "الليف بانل", "ربط السيرفر", "خطة العمل", "حالة الاتصالات"];
  const missing = need.filter((n) => !text.includes(n));

  results.workUi = { chars: text.length, inputs, missing };

  if (missing.length) findings.push({ kind: "work-page-incomplete", detail: `missing: ${missing.join(", ")}` });
  if (inputs === 0) findings.push({ kind: "no-chat-input", detail: "work page rendered no input/textarea" });
  window.close?.();
}

/* ── driver ─────────────────────────────────────────────────────────────── */

if (MODE === "brain") {
  await phaseBrowserBrain();
  fs.writeFileSync(PHASE_OUT, JSON.stringify({ findings, results }));
  process.exit(findings.length ? 1 : 0);
}
if (MODE === "ui") {
  await phaseWorkUi();
  fs.writeFileSync(PHASE_OUT, JSON.stringify({ findings, results }));
  process.exit(findings.length ? 1 : 0);
}
if (MODE === "linked") {
  await phaseLinkedServer();
  fs.writeFileSync(PHASE_OUT, JSON.stringify({ findings, results }));
  process.exit(findings.length ? 1 : 0);
}

// Default: run each phase in its own process. `setup.ts` patches `window` once
// per ES module graph, so two DOMs in one process would share the first patch
// and the second phase would silently test the wrong window.
{
  const { spawnSync } = await import("node:child_process");
  const selfPath = fileURLToPath(import.meta.url);
  const run = (mode) => {
    const out = spawnSync(process.execPath, [selfPath, `--mode=${mode}`, ...(SERVER ? [`--server=${SERVER}`] : [])], {
      encoding: "utf8",
      timeout: 120_000,
    });
    if (fs.existsSync(PHASE_OUT)) {
      const parsed = JSON.parse(fs.readFileSync(PHASE_OUT, "utf8"));
      fs.rmSync(PHASE_OUT, { force: true });
      findings.push(...(parsed.findings ?? []));
      Object.assign(results, parsed.results ?? {});
    }
    if (out.status === null) findings.push({ kind: "phase-timeout", detail: `${mode} timed out` });
  };
  run("brain");
  run("ui");
  if (SERVER) run("linked");
}

/* ── report ─────────────────────────────────────────────────────────────── */

if (asJson) {
  console.log(JSON.stringify({ findings, results }, null, 2));
} else {
  console.log("CyberNova — Static Brain & Remote Connector Audit");
  console.log("────────────────────────────────────────────────");
  const b = results.browserBrain;
  console.log(`Browser brain  : ${b.status} ${b.contentType}`);
  console.log(`  events       : ${b.events} [${b.types.join(", ")}]`);
  console.log(`  tools        : ${b.tools} (${b.toolsOk} ok)`);
  console.log(`  reply        : ${b.replyChars} chars — ${b.replyPreview.replace(/\s+/g, " ").slice(0, 110)}…`);
  if (results.linkedServer) {
    const l = results.linkedServer;
    console.log(`Linked server  : ${l.base}`);
    console.log(`  real core    : ${l.statusFromRealServer ? "✓" : "✗"} (brain: ${l.brainMode ?? "?"})`);
    console.log(`  chat         : ${l.chatEvents} events, ${l.chatTools} tools, ${l.chatReplyChars} chars`);
    console.log(`  sockets      : ${l.socketUrls.join(", ") || "none"}`);
  } else {
    console.log("Linked server  : skipped (pass --server=http://127.0.0.1:8080)");
  }
  if (results.workUi) {
    const u = results.workUi;
    console.log(`Work page     : ${u.chars} chars, ${u.inputs} inputs${u.missing.length ? ` — missing: ${u.missing.join(", ")}` : " ✓"}`);
  }
  console.log("");
  if (findings.length) {
    console.log(`✗ ${findings.length} finding(s):`);
    for (const f of findings) console.log(`  - [${f.kind}] ${f.detail}`);
  } else {
    console.log("✅ Static brain streams a real reply and the linked-server path really proxies.");
  }
}
process.exit(findings.length === 0 ? 0 : 1);
