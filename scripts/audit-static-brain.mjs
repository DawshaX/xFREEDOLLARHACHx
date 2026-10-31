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
const MESSAGE = (args.find((a) => a.startsWith("--message=")) || "").split("=").slice(1).join("=") || "ابحث عن CVE-2025-29927 وإيه حالة المنصة؟";
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

function bootDom({ remoteBase = "", search = "", seed = null } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: `${HOST}/nova-fleet${search}`,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  if (seed) for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
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
  //
  // External origins are answered locally with a 503 instead of hitting the
  // network: this audit must be deterministic and offline-safe. A component
  // that fetches a third-party URL at mount time used to crash the whole phase
  // with an unhandled ECONNRESET when the sandbox had no route to it.
  if (!window.fetch) {
    const realFetch = globalThis.fetch.bind(globalThis);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input?.url ?? "";
      const absolute = /^https?:\/\//i.test(url);
      // Only the linked server (if any) may be reached for real; the Pages
      // origin itself is a third party here and must not hit the network.
      const allowed = !absolute || (Boolean(SERVER) && url.startsWith(SERVER));
      if (!allowed) {
        return Promise.resolve(
          new Response(JSON.stringify({ skipped: "external-origin blocked in audit", url }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return realFetch(input, init);
    };
  }
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
    body: JSON.stringify({ message: MESSAGE, sessionId: "audit" }),
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
  const need = ["محطة العمل", "المهمات", "الأدوات", "خريطة الشبكة", "الليف بانل", "وسّع القدرات", "خطة العمل", "حالة الاتصالات", "العقل السحابي 24/7"];
  const missing = need.filter((n) => !text.includes(n));

  let storeMachines = null;
  try {
    storeMachines = window.__novaLive?.()?.machines?.length ?? null;
  } catch { /* ignore */ }
  const machines = storeMachines ?? Number((text.match(/أجهزة\s*(\d+)/) ?? [])[1] ?? NaN);
  results.workUi = {
    chars: text.length, inputs, missing, machines,
    fleetDebug: (() => { try { return window.__novaFleetDebug ?? null; } catch { return null; } })(),
  };
  // The strip used to read «أجهزة 0» even though the browser itself is a live
  // node — that is the "looks dead" bug.
  if (machines === 0) findings.push({ kind: "fleet-zero", detail: "live bar shows 0 machines while the browser node exists" });

  // The live site once claimed «اتصال مباشر دائم مع المنصة» with no server at
  // all — the exact "it's connected" lie. Keep that from coming back.
  if (!results.workUi || true) {
    const claimsLive = /اتصال مباشر دائم/.test(text);
    const honestLocal = /شغّال في المتصفح|قناة داخلية|بدون سيرفر خارجي|قناة المتصفح/.test(text);
    results.workUi.fakeLiveClaim = claimsLive;
    results.workUi.honestLabel = honestLocal;
    if (claimsLive) findings.push({ kind: "fake-live-claim", detail: "page says «اتصال مباشر دائم» with no server linked" });
    if (!honestLocal) findings.push({ kind: "no-honest-label", detail: "no honest static-mode label on the live bar" });
  }
  if (missing.length) findings.push({ kind: "work-page-incomplete", detail: `missing: ${missing.join(", ")}` });
  if (inputs === 0) findings.push({ kind: "no-chat-input", detail: "work page rendered no input/textarea" });
  window.close?.();
}


/* ── 4. regression cases that actually broke on the live site ───────────── */

async function phaseRegression() {
  const { window } = bootDom();
  await import(pathToFileURL(path.join(DIST, "assets", mainJs)).href);
  await new Promise((r) => setTimeout(r, 300));

  const ask = async (url, body) => {
    const res = await window.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text/event-stream")) {
      const j = await res.json().catch(() => null);
      return { ctype, events: [], text: "" , json: j };
    }
    const events = await readSse(res);
    return { ctype, events, text: events.filter((e) => e.type === "delta").map((e) => e.text).join("") };
  };

  const cases = [
    { name: "greeting", url: "/api/nova-core/chat", body: { message: "مرحباااااااااا" } },
    { name: "greeting+query", url: "/api/nova-core/chat?brain=browser", body: { message: "مرحباااااااااا" } },
    { name: "scan", url: "/api/nova-core/chat", body: { message: "افحص example.com" } },
  ];
  const out = [];
  for (const c of cases) {
    const r = await ask(c.url, c.body);
    out.push({ name: c.name, ctype: r.ctype, events: r.events.length, chars: r.text.trim().length });
    if (!r.ctype.includes("text/event-stream")) findings.push({ kind: "not-sse", detail: `${c.name}: ${r.ctype}` });
    if (r.text.trim().length < 40) findings.push({ kind: "empty-reply", detail: `${c.name}: ${r.text.trim().length} chars` });
  }

  // the plan box used to need a server
  const planRes = await window.fetch("/api/fleet/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: "افحص example.com وقيس مخاطرته" }),
  });
  const plan = await planRes.json().catch(() => null);
  const steps = Array.isArray(plan?.plan?.steps) ? plan.plan.steps.length : 0;
  out.push({ name: "plan", steps });
  if (steps < 3) findings.push({ kind: "plan-broken", detail: `plan steps=${steps}` });

  // the fleet must show this browser as a real node, not 0 machines
  const mesh = await (await window.fetch("/api/local-agent/agents")).json().catch(() => null);
  const meshCount = Array.isArray(mesh) ? mesh.length : (mesh?.agents ?? []).length;
  out.push({ name: "agents", count: meshCount });

  results.regression = out;
  window.close?.();
}


/* ── 5. does it actually understand the message? ─────────────────────────── */

async function phaseIntents() {
  const { window } = bootDom();
  await import(pathToFileURL(path.join(DIST, "assets", mainJs)).href);
  await new Promise((r) => setTimeout(r, 300));

  const ask = async (message) => {
    const res = await window.fetch("/api/nova-core/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId: "intent" }),
    });
    const events = await readSse(res);
    const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
    const tools = events.filter((e) => e.type === "tool_call").map((e) => e.name);
    return { text, tools, chars: text.trim().length };
  };

  // A greeting must be greeted — not answered with a vulnerability dump, and
  // not with a pointless knowledge_search on the word «مرحبا».
  const cases = [
    { msg: "مرحبا", expect: { noTools: true, includes: ["أنا نوفا"], excludes: ["78,422", "ناقل WebSocket", "العقل التكتيكي الذاتي"] } },
    { msg: "مرحباااااااااا", expect: { noTools: true, includes: ["أنا نوفا"], excludes: ["78,422", "العقل التكتيكي الذاتي"] } },
    { msg: "ازيك", expect: { noTools: true, includes: ["أنا نوفا"] } },
    { msg: "شكرا", expect: { noTools: true, includes: ["العفو"] } },
    { msg: "مين انت؟", expect: { noTools: true, includes: ["نوفا"] } },
    { msg: "بتعرف تعمل ايه؟", expect: { noTools: true, includes: ["DNS"] } },
    { msg: "حالة المنصة", expect: { includes: ["حالة المنصة"] } },
    { msg: "افحص example.com", expect: { tools: ["dns_lookup"] } },
    { msg: "ابحث عن CVE-2025-29927", expect: { tools: ["cve_lookup"] } },
    { msg: "ابحث في GitHub عن nuclei", expect: { tools: ["github_search"] } },
    { msg: "اقرا example.com", expect: { tools: ["web_fetch"] } },
    { msg: "ايه رايك في القهوة", expect: { noTools: true, includes: ["تقصد"] } },
    { msg: "انت عامل ايه", expect: { noTools: true, includes: ["أنا نوفا"] } },
    { msg: "اخبارك", expect: { noTools: true, includes: ["أنا نوفا"] } },
    { msg: "المهمات", expect: { noTools: true, includes: ["المهمات"] } },
  ];

  const out = [];
  for (const c of cases) {
    const r = await ask(c.msg);
    const okIncludes = (c.expect.includes ?? []).every((t) => r.text.includes(t));
    const okExcludes = (c.expect.excludes ?? []).every((t) => !r.text.includes(t));
    const okNoTools = c.expect.noTools ? r.tools.length === 0 : true;
    const okTools = c.expect.tools ? c.expect.tools.every((t) => r.tools.includes(t)) : true;
    out.push({ msg: c.msg, tools: r.tools, chars: r.chars, ok: okIncludes && okExcludes && okNoTools && okTools });
    if (!okIncludes) findings.push({ kind: "intent-text", detail: `«${c.msg}» missing ${c.expect.includes.join(", ")}` });
    if (!okExcludes) findings.push({ kind: "intent-dump", detail: `«${c.msg}» answered with canned intel` });
    if (!okNoTools) findings.push({ kind: "intent-tools", detail: `«${c.msg}» ran ${r.tools.join(", ")} — should run none` });
    if (!okTools) findings.push({ kind: "intent-tools", detail: `«${c.msg}» did not run ${c.expect.tools.join(", ")}` });
    if (r.chars < 15) findings.push({ kind: "intent-empty", detail: `«${c.msg}» → ${r.chars} chars` });
  }
  results.intents = out;
  window.close?.();
}


/* ── 6. missions + persistent chat ───────────────────────────────────────── */

async function phaseMissions() {
  const { window } = bootDom();
  await import(pathToFileURL(path.join(DIST, "assets", mainJs)).href);
  await new Promise((r) => setTimeout(r, 300));

  const ask = async (message, sid = "mission-audit") => {
    const res = await window.fetch("/api/nova-core/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId: sid }),
    });
    const events = await readSse(res);
    return {
      text: events.filter((e) => e.type === "delta").map((e) => e.text).join(""),
      tools: events.filter((e) => e.type === "tool_call").map((e) => e.name),
    };
  };

  // A hunt must create a real mission with steps and (when a source answers)
  // findings, and it must be there on a second read.
  const hunt = await ask("استخرج ثغرات example.com");
  const raw = window.localStorage.getItem("cybernova_missions_v1");
  const missions = raw ? JSON.parse(raw) : [];
  const mission = missions[0];

  results.missions = {
    created: missions.length,
    title: mission?.title ?? null,
    steps: mission?.steps?.length ?? 0,
    doneSteps: mission?.steps?.filter((s) => s.status === "done").length ?? 0,
    findings: mission?.findings?.length ?? 0,
    tools: hunt.tools,
  };

  if (!missions.length) findings.push({ kind: "no-mission", detail: "hunt did not create a mission" });
  if ((mission?.steps?.length ?? 0) < 2) findings.push({ kind: "thin-mission", detail: "mission has fewer than 2 steps" });
  if (!hunt.text.includes("استخراج الثغرات")) findings.push({ kind: "hunt-reply", detail: "hunt reply does not summarise the hunt" });

  // asking for the list must show it back
  const list = await ask("المهمات");
  if (!list.text.includes(mission?.title ?? "___")) findings.push({ kind: "mission-list", detail: "«المهمات» did not list the created mission" });

  // chat sessions persist: write through the store the UI uses
  const sessions = window.localStorage.getItem("cybernova_chat_sessions_v1");
  results.sessions = { stored: sessions ? JSON.parse(sessions).length : 0 };

  window.close?.();
}


/* ── 7. chat that survives a reload ─────────────────────────────────────── */

async function phasePersist() {
  const { window } = bootDom();
  await import(pathToFileURL(path.join(DIST, "assets", mainJs)).href);
  await new Promise((r) => setTimeout(r, 2200));

  const doc = window.document;
  const textarea = doc.querySelector("textarea");
  if (!textarea) {
    findings.push({ kind: "no-textarea", detail: "work page has no chat input to drive" });
    window.close?.();
    return;
  }

  // React tracks the value through its own property descriptor; use the native
  // setter so the component sees the change (this is the standard trick).
  const proto = Object.getPrototypeOf(textarea);
  const desc = Object.getOwnPropertyDescriptor(proto, "value") ?? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  desc.set.call(textarea, "مرحبا");
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));

  const sendBtn = [...doc.querySelectorAll("button")].find((b) => /إرسال/.test(b.textContent || ""));
  if (!sendBtn) {
    findings.push({ kind: "no-send", detail: "no send button found" });
    window.close?.();
    return;
  }
  sendBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 3500));

  const raw = window.localStorage.getItem("cybernova_chat_sessions_v1");
  const stored = raw ? JSON.parse(raw) : [];
  const first = stored[0];
  const replied = (doc.body.textContent || "").includes("أنا نوفا");
  results.persist = {
    sessions: stored.length,
    lines: first?.lines?.length ?? 0,
    replied,
  };
  if (!stored.length) findings.push({ kind: "chat-not-saved", detail: "sending a message stored no session" });
  if ((first?.lines?.length ?? 0) < 2) findings.push({ kind: "chat-thin", detail: `session has ${first?.lines?.length ?? 0} lines` });
  if (!replied) findings.push({ kind: "no-reply-in-ui", detail: "answer never rendered in the chat" });
  window.close?.();

  // Save the snapshot for the restore phase, which runs in a clean process
  // (two DOMs in one process fight over `window`, so they must not share one).
  const snapshot = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    snapshot[k] = window.localStorage.getItem(k);
  }
  fs.writeFileSync("/tmp/nova-session-snapshot.json", JSON.stringify(snapshot));
}

/* ── 8. restore: fresh process, same storage ─────────────────────────────── */

async function phaseRestore() {
  const snapPath = "/tmp/nova-session-snapshot.json";
  if (!fs.existsSync(snapPath)) {
    findings.push({ kind: "no-snapshot", detail: "persist phase produced no snapshot" });
    return;
  }
  const seed = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const { window } = bootDom({ seed });
  await import(pathToFileURL(path.join(DIST, "assets", mainJs)).href);
  await new Promise((r) => setTimeout(r, 2000));
  const body = window.document.body.textContent || "";
  const restored = body.includes("أنا نوفا") && body.includes("مرحبا");
  results.restore = { restored };
  if (!restored) findings.push({ kind: "chat-not-restored", detail: "reload did not bring the conversation back" });
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
if (MODE === "regress") {
  await phaseRegression();
  fs.writeFileSync(PHASE_OUT, JSON.stringify({ findings, results }));
  process.exit(findings.length ? 1 : 0);
}
if (MODE === "intents") {
  await phaseIntents();
  fs.writeFileSync(PHASE_OUT, JSON.stringify({ findings, results }));
  process.exit(findings.length ? 1 : 0);
}
if (MODE === "missions") {
  await phaseMissions();
  fs.writeFileSync(PHASE_OUT, JSON.stringify({ findings, results }));
  process.exit(findings.length ? 1 : 0);
}
if (MODE === "persist") {
  await phasePersist();
  fs.writeFileSync(PHASE_OUT, JSON.stringify({ findings, results }));
  process.exit(findings.length ? 1 : 0);
}
if (MODE === "restore") {
  await phaseRestore();
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
  run("regress");
  run("intents");
  run("missions");
  run("persist");
  run("restore");
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
  if (results.regression) {
    for (const c of results.regression) {
      console.log(`  case ${String(c.name).padEnd(14)} ${c.chars !== undefined ? `${c.chars} chars / ${c.events} events` : c.steps !== undefined ? `${c.steps} plan steps` : `${c.count} agents`}`);
    }
  }
  if (results.intents) {
    for (const c of results.intents) {
      console.log(`  ${c.ok ? "✓" : "✗"} «${c.msg}» → ${c.chars} chars${c.tools.length ? ` · ${c.tools.join(", ")}` : " · no tools"}`);
    }
  }
  if (results.persist) {
    const p2 = results.persist;
    const restored = results.restore?.restored;
    console.log(`Chat persist  : ${p2.sessions} session · ${p2.lines} lines · reply ${p2.replied ? "✓" : "✗"} · restored after reload ${restored ? "✓" : "✗"}`);
  }
  if (results.missions) {
    const m = results.missions;
    console.log(`Missions      : ${m.created} created · ${m.steps} steps (${m.doneSteps} done) · ${m.findings} findings`);
  }
  if (results.workUi) {
    const u = results.workUi;
    console.log(`Work page     : ${u.chars} chars, ${u.inputs} inputs, ${u.machines ?? "?"} node(s)${u.missing.length ? ` — missing: ${u.missing.join(", ")}` : " ✓"}`);
    if (u.fleetDebug) console.log(`  fleet debug : ${JSON.stringify(u.fleetDebug)}`);
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
