#!/usr/bin/env node
/**
 * Offline checks for the server registry — the list behind «ماكينات نوفا».
 *
 * The point of these tests is the honesty rule the card promises: a server is
 * 「شغّال」 only because `/api/health` answered just now, a failure carries its
 * reason, and a host that was never probed is never counted as up.
 *
 * No network: `fetch` is injected. The registry file is redirected to a temp dir.
 *
 *   node scripts/test-fleet-servers.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "artifacts/api-server/src/lib/server-registry.ts");
const work = mkdtempSync(join(tmpdir(), "nova-fleet-servers-"));
const out = join(work, "bundle.mjs");

const esbuild = join(ROOT, "node_modules/.pnpm/node_modules/.bin/esbuild");
assert.ok(existsSync(esbuild), "esbuild binary not found — run pnpm install first");
execFileSync(esbuild, [SRC, "--bundle", "--format=esm", "--platform=node", "--log-level=error", `--outfile=${out}`]);

const registryFile = join(work, "fleet-servers.json");
process.env.NOVA_SERVERS_FILE = registryFile;
const mod = await import(out);

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};
const testAsync = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

console.log("server registry — the honesty rules");

test("normalizeServerBase accepts host, https, trailing slash and /api", () => {
  assert.equal(mod.normalizeServerBase("nova.onrender.com"), "https://nova.onrender.com");
  assert.equal(mod.normalizeServerBase("https://nova.onrender.com/"), "https://nova.onrender.com");
  assert.equal(mod.normalizeServerBase("https://nova.onrender.com/api"), "https://nova.onrender.com");
  assert.equal(mod.normalizeServerBase("  "), "");
  assert.equal(mod.normalizeServerBase("not a url at all"), "");
});

test("codespaceBase builds the port-8080 origin from a name", () => {
  assert.equal(
    mod.codespaceBase("animated-broccoli-gwx6wgpxvx5hv6gj"),
    "https://animated-broccoli-gwx6wgpxvx5hv6gj-8080.app.github.dev",
  );
  assert.equal(
    mod.codespaceBase("https://animated-broccoli-gwx6wgpxvx5hv6gj-8080.app.github.dev/"),
    "https://animated-broccoli-gwx6wgpxvx5hv6gj-8080.app.github.dev",
  );
  assert.equal(mod.codespaceBase(""), "");
});

test("serverKind recognises each host we actually deploy to", () => {
  assert.equal(mod.serverKind("https://x-8080.app.github.dev"), "codespace");
  assert.equal(mod.serverKind("https://cybernova-nova.onrender.com"), "render");
  assert.equal(mod.serverKind("http://localhost:8080"), "local");
  assert.equal(mod.serverKind("https://nova.example.com"), "custom");
});

test("upsertServer keeps one entry per base and a stable id", () => {
  let list = [];
  list = mod.upsertServer(list, { name: "Codespace", base: "https://a-8080.app.github.dev", kind: "codespace" });
  const id = list[0].id;
  list = mod.upsertServer(list, { name: "Codespace prod", base: "https://a-8080.app.github.dev/", kind: "codespace" });
  assert.equal(list.length, 1, "the same machine twice must not create a twin");
  assert.equal(list[0].id, id);
  assert.equal(list[0].name, "Codespace prod");
});

test("upsertServer refuses an empty base instead of storing junk", () => {
  const list = mod.upsertServer([], { name: "x", base: "   ", kind: "custom" });
  assert.equal(list.length, 0);
});

await testAsync("probeServer reports up with the real payload and latency", async () => {
  const server = { id: "s1", name: "r", base: "https://nova.onrender.com", kind: "render", addedAt: Date.now() };
  const probe = await mod.probeServer(server, {
    fetchImpl: async (url) => {
      assert.equal(url, "https://nova.onrender.com/api/health");
      return jsonResponse({ status: "ok", wsConnected: true });
    },
  });
  assert.equal(probe.state, "up");
  assert.equal(probe.ok, true);
  assert.equal(probe.health.status, "ok");
  assert.ok(typeof probe.ms === "number");
});

await testAsync("probeServer reports down with the HTTP code, not a shrug", async () => {
  const server = { id: "s2", name: "r", base: "https://quiet.onrender.com", kind: "render", addedAt: Date.now() };
  const probe = await mod.probeServer(server, { fetchImpl: async () => jsonResponse({}, 502) });
  assert.equal(probe.state, "down");
  assert.equal(probe.status, 502);
  assert.match(probe.error, /502/);
});

await testAsync("probeServer treats a thrown network error as down", async () => {
  const server = { id: "s3", name: "r", base: "https://gone.onrender.com", kind: "render", addedAt: Date.now() };
  const probe = await mod.probeServer(server, {
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND gone.onrender.com");
    },
  });
  assert.equal(probe.state, "down");
  assert.equal(probe.status, null);
  assert.match(probe.error, /النطاق مش موجود/);
});

await testAsync("a sleeping free instance that answers 404 is down, not up", async () => {
  const server = { id: "s4", name: "fly", base: "https://x.fly.dev", kind: "custom", addedAt: Date.now() };
  const probe = await mod.probeServer(server, { fetchImpl: async () => new Response("nope", { status: 404 }) });
  assert.equal(probe.state, "down");
});

await testAsync("probeAll caches for the TTL instead of hammering the hosts", async () => {
  let calls = 0;
  const servers = [{ id: "c1", name: "c", base: "https://c.onrender.com", kind: "render", addedAt: Date.now() }];
  const fetchImpl = async () => {
    calls++;
    return jsonResponse({ status: "ok" });
  };
  let clock = 1_000;
  const now = () => clock;
  await mod.probeAll(servers, { fetchImpl, now, ttlMs: 20_000 });
  clock += 5_000;
  await mod.probeAll(servers, { fetchImpl, now, ttlMs: 20_000 });
  assert.equal(calls, 1, "second read inside the TTL must not call the host again");
  clock += 30_000;
  await mod.probeAll(servers, { fetchImpl, now, ttlMs: 20_000 });
  assert.equal(calls, 2, "after the TTL it must re-measure");
});

test("saveServers + loadServers round-trip through the temp file", () => {
  const list = [
    { id: "a", name: "Codespace", base: "https://a-8080.app.github.dev", kind: "codespace", addedAt: 1 },
    { id: "b", name: "Render", base: "https://cybernova-nova.onrender.com", kind: "render", addedAt: 2 },
  ];
  assert.equal(mod.saveServers(list), true);
  const back = mod.loadServers();
  assert.equal(back.length, 2);
  assert.equal(back[0].base, "https://a-8080.app.github.dev");
});

test("loadServers survives a corrupt file instead of killing boot", () => {
  writeFileSync(registryFile, "{ this is not json");
  assert.deepEqual(mod.loadServers(), []);
  writeFileSync(registryFile, JSON.stringify({ servers: [{ base: "" }, null, { base: "https://ok.onrender.com" }] }));
  const back = mod.loadServers();
  assert.equal(back.length, 1, "junk entries are dropped, the valid one survives");
});

test("replaceServers normalises and dedupes whatever the browser sends", () => {
  const list = mod.replaceServers([
    { name: "one", base: "https://x.onrender.com/", kind: "render" },
    { name: "two", base: "https://x.onrender.com", kind: "render" },
    { name: "junk", base: "" },
    "nope",
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].base, "https://x.onrender.com");
});

test("removeServer removes exactly one", () => {
  const list = [
    { id: "a", name: "a", base: "https://a.onrender.com", kind: "render", addedAt: 1 },
    { id: "b", name: "b", base: "https://b.onrender.com", kind: "render", addedAt: 2 },
  ];
  const next = mod.removeServer(list, "a");
  assert.deepEqual(next.map((s) => s.id), ["b"]);
});

test("explainProbeError names the five real failure modes", () => {
  assert.match(mod.explainProbeError(new Error("getaddrinfo ENOTFOUND x")), /النطاق/);
  assert.match(mod.explainProbeError(new Error("connect ECONNREFUSED 1.2.3.4:443")), /البورت مقفول/);
  assert.match(mod.explainProbeError(new Error("The operation was aborted due to timeout")), /مردّش في الوقت/);
  assert.match(mod.explainProbeError(new Error("fetch failed")), /مفيش وصول للشبكة/);
  assert.match(mod.explainProbeError(new Error("certificate has expired")), /TLS/);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
