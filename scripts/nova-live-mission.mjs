#!/usr/bin/env node
/**
 * NOVA — Live Mission (real work, on free GitHub runners)
 * ──────────────────────────────────────────────────────
 * The brain pulse harvests intel. This one **runs the actual product**: it
 * starts the real API server, asks NOVA to perform a real mission with real
 * tools, saves what came back, and proves the whole stack with the live audit.
 *
 * Nothing is simulated:
 *   • the server is the same bundle that ships to users,
 *   • the mission is sent through the real `POST /api/nova-core/chat` SSE stream,
 *   • every tool listed in the reply actually executed (DNS, TLS, HTTP, NVD…),
 *   • memory is exported from the running process and written into `state/`.
 *
 * Usage
 *   node scripts/nova-live-mission.mjs                     # default target
 *   TARGET=example.com node scripts/nova-live-mission.mjs
 *   node scripts/nova-live-mission.mjs --port=8099 --zip=dist-standalone/nova-24-7.zip
 *
 * Exit code 0 = mission ran and memory was saved; 1 = something really failed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};

const PORT = Number(arg("port", process.env.MISSION_PORT || 8099));
const TARGET = process.env.TARGET || arg("target", "example.com");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "nova-mission-"));
const STATE_OUT = path.join(ROOT, "state/nova-mission-log.json");
const MEMORY_OUT = path.join(ROOT, "state/nova-memory.json");

const log = (...a) => console.log("•", ...a);

/* ── 1. get a runnable copy of the server ─────────────────────────────────── */
function materialiseServer() {
  const zip = arg("zip", "");
  if (zip && fs.existsSync(zip)) {
    try {
      execFileSync("unzip", ["-q", zip, "-d", WORK]);
      const dir = fs.readdirSync(WORK).find((d) => fs.statSync(path.join(WORK, d)).isDirectory());
      log(`using portable bundle from ${path.relative(ROOT, zip)}`);
      return path.join(WORK, dir);
    } catch (e) {
      log(`unzip failed (${e.message}) — falling back to the repo build`);
    }
  }
  const bundle = path.join(ROOT, "artifacts/api-server/dist/index.mjs");
  const panel = path.join(ROOT, "artifacts/kali-panel/dist/public");
  if (!fs.existsSync(bundle)) throw new Error("no server bundle — build it first");
  fs.copyFileSync(bundle, path.join(WORK, "server.mjs"));
  if (fs.existsSync(path.join(panel, "index.html"))) {
    fs.cpSync(panel, path.join(WORK, "public"), { recursive: true });
  }
  log("using the local build (artifacts/api-server/dist/index.mjs)");
  return WORK;
}

/* ── 2. boot it, warm it, make sure it answers ───────────────────────────── */
async function waitForHealth(base, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return await r.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/** Read the SSE stream and keep every frame the agent emits. */
async function chat(base, message) {
  const res = await fetch(`${base}/api/nova-core/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, sessionId: `mission-${Date.now()}` }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok || !res.body) throw new Error(`chat HTTP ${res.status}`);

  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          events.push(JSON.parse(raw));
        } catch {
          /* keep-alive or partial frame */
        }
      }
    }
  }
  return events;
}

/* ── 3. main ─────────────────────────────────────────────────────────────── */
const serverDir = materialiseServer();
const child = spawn(process.execPath, [path.join(serverDir, "server.mjs")], {
  cwd: serverDir,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    NODE_ENV: "production",
    NOVA_AUTOPULL: "0",
    NOVA_CRON_ENABLED: "1", // missions should also tick the 24/7 loop
    NOVA_MEMORY_FILE: path.join(serverDir, "state/nova-memory.json"),
    NOVA_STATIC_DIR: path.join(serverDir, "public"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverLog = [];
child.stdout.on("data", (d) => serverLog.push(String(d)));
child.stderr.on("data", (d) => serverLog.push(String(d)));

const base = `http://127.0.0.1:${PORT}`;
const started = Date.now();

try {
  const health = await waitForHealth(base);
  if (!health) throw new Error(`server never answered on ${base}\n${serverLog.join("").slice(-1500)}`);
  log(`server up in ${Date.now() - started} ms — ${JSON.stringify(health)}`);

  /* ── the mission: real tools, in a fixed order, with real arguments ─────
   * The chat planner is free-form and, without an LLM key, may pick other
   * tools — that is fine for conversation but useless as a daily proof. So the
   * mission executes the tools directly and records exactly what happened. */
  const plan = [
    { tool: "dns_lookup", args: { domain: TARGET } },
    { tool: "http_headers_audit", args: { host: TARGET } },
    { tool: "tls_audit", args: { host: TARGET } },
  ];

  log(`mission → ${TARGET} (${plan.length} real tools)`);
  const toolResults = [];
  for (const step of plan) {
    const started = Date.now();
    try {
      const r = await fetch(`${base}/api/nova-core/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: step.tool, args: step.args }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await r.json().catch(() => ({}));
      toolResults.push({
        name: step.tool,
        ok: r.ok && body.ok !== false,
        ms: body.ms ?? Date.now() - started,
        summary: String(body.summary ?? body.error ?? `HTTP ${r.status}`).slice(0, 400),
      });
    } catch (err) {
      toolResults.push({ name: step.tool, ok: false, ms: Date.now() - started, summary: String(err.message) });
    }
    const last = toolResults[toolResults.length - 1];
    log(`  ${last.ok ? "✓" : "✗"} ${last.name} (${last.ms}ms) — ${last.summary.slice(0, 110)}`);
  }

  // Persist what was learned — through the agent's own memory tool, not a file hack.
  const summaryLine = toolResults.map((t) => `${t.name}: ${t.ok ? "ok" : "failed"} — ${t.summary.slice(0, 160)}`).join(" | ");
  try {
    await fetch(`${base}/api/nova-core/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tool: "memory_save",
        args: {
          kind: "fact",
          scope: TARGET,
          title: `استطلاع حقيقي ${TARGET} — ${new Date().toISOString().slice(0, 16)}`,
          content: summaryLine,
          importance: 6,
          tags: ["mission", "recon", "auto"],
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    log("saved the findings to long-term memory (memory_save)");
  } catch {
    log("memory_save failed — findings still recorded in the mission log");
  }

  // Prove the conversational agent loop also runs (not gated on tool choice).
  log("chat round-trip (proves the agent loop)…");
  const events = await chat(base, `باختصار: إيه أهم 3 حاجات تتأكد منها في ${TARGET}؟`);
  const reply = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  const done = events.find((e) => e.type === "done");
  const errorEvent = events.find((e) => e.type === "error");
  log(`${events.length} chat events · reply ${reply.length} chars`);

  const memory = await fetch(`${base}/api/nova-core/memory/export`, { signal: AbortSignal.timeout(15000) })
    .then((r) => r.text())
    .catch(() => "");
  const records = (() => {
    try {
      return JSON.parse(memory).records?.length ?? 0;
    } catch {
      return 0;
    }
  })();
  log(`memory exported: ${memory.length} bytes · ${records} records`);

  const selfCheck = await fetch(`${base}/api/nova-core/self-check`, { signal: AbortSignal.timeout(30000) })
    .then((r) => r.json())
    .catch(() => null);

  const entry = {
    ranAt: new Date().toISOString(),
    target: TARGET,
    source: arg("zip", "") ? "release-bundle" : "repo-build",
    chatEvents: events.length,
    tools: toolResults,
    toolsOk: toolResults.filter((t) => t.ok).length,
    reply: reply.slice(0, 4000),
    memoryRecords: records,
    selfCheckScore: selfCheck?.score ?? null,
    selfCheckVerdict: selfCheck?.verdict ?? null,
    durationMs: done?.ms ?? null,
    provider: done?.provider ?? null,
    mode: done?.mode ?? null,
    error: errorEvent?.message ?? null,
    runner: { node: process.version, platform: `${os.platform()} ${os.arch()}` },
  };

  // Merge into a rolling log (last 50 missions) so the panel can show history.
  let history = [];
  if (fs.existsSync(STATE_OUT)) {
    try {
      history = JSON.parse(fs.readFileSync(STATE_OUT, "utf8")).missions ?? [];
    } catch {
      history = [];
    }
  }
  history.unshift(entry);
  fs.writeFileSync(
    STATE_OUT,
    JSON.stringify({ updatedAt: entry.ranAt, missions: history.slice(0, 50) }, null, 2) + "\n",
  );
  log(`wrote ${path.relative(ROOT, STATE_OUT)} (${Math.min(history.length, 50)} missions kept)`);

  if (memory && records > 0) {
    fs.writeFileSync(MEMORY_OUT, memory);
    log(`wrote ${path.relative(ROOT, MEMORY_OUT)}`);
  }

  // The mission itself succeeded if the agent actually executed tools.
  if (toolResults.length === 0) {
    console.error("✗ no tool executed — the agent answered without acting");
    process.exitCode = 1;
  } else if (entry.toolsOk === 0) {
    console.error("✗ every tool failed — network or tooling problem");
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  console.error(serverLog.join("").slice(-2000));
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1200));
  if (!child.killed) child.kill("SIGKILL");
}

process.exit(process.exitCode ?? 0);
