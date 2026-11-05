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
  // Junk dropped, the valid one survives — and because that file predates the
  // current seed list (no seedVersion), the known machines are merged in once.
  assert.equal(back[0].base, "https://ok.onrender.com", "junk entries are dropped, the valid one survives");
  assert.equal(back.length, 1 + mod.SEED_SERVERS.length, "an old file gains the new seeds");
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

await testAsync("probeServer refuses a 200 that is not JSON (GitHub port interstitial)", async () => {
  const server = { id: "s11", name: "cs", base: "https://x-8080.app.github.dev", kind: "codespace", addedAt: 1 };
  const probe = await mod.probeServer(server, {
    fetchImpl: async () =>
      new Response("<!doctype html><title>Codespaces Access Port</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });
  assert.equal(probe.state, "down", "an HTML warning page is not a health answer");
  assert.equal(probe.ok, false);
  assert.match(probe.error, /مش JSON/);
});

test("schemeCandidates tries the registered origin first, then the other scheme", () => {
  assert.deepEqual(mod.schemeCandidates("http://node.waifly.com:27316"), [
    "http://node.waifly.com:27316",
    "https://node.waifly.com:27316",
  ]);
  assert.deepEqual(mod.schemeCandidates("https://a.onrender.com"), [
    "https://a.onrender.com",
    "http://a.onrender.com",
  ]);
  assert.deepEqual(mod.schemeCandidates(""), []);
});

await testAsync("probeServer falls back to the other scheme and says which one answered", async () => {
  const server = { id: "s9", name: "w", base: "http://node.waifly.com:27316", kind: "waifly", addedAt: 1 };
  const tried = [];
  const probe = await mod.probeServer(server, {
    fetchImpl: async (url) => {
      tried.push(url);
      if (url.startsWith("http://")) throw new Error("fetch failed");
      return jsonResponse({ status: "ok" });
    },
  });
  assert.deepEqual(tried, ["http://node.waifly.com:27316/api/health", "https://node.waifly.com:27316/api/health"]);
  assert.equal(probe.state, "up", "a live https answer must not be reported as down");
  assert.equal(probe.via, "https://node.waifly.com:27316");
});

await testAsync("probeServer stays down (and names the reason) when both schemes fail", async () => {
  const server = { id: "s10", name: "w", base: "http://node.waifly.com:27316", kind: "waifly", addedAt: 1 };
  const probe = await mod.probeServer(server, {
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND node.waifly.com");
    },
  });
  assert.equal(probe.state, "down");
  assert.equal(probe.via, undefined, "nothing answered, so nothing is claimed to have answered");
  assert.match(probe.error, /النطاق/);
});

test("a missing registry file starts from the machines we know, not from nothing", () => {
  const previous = process.env.NOVA_SERVERS_FILE;
  process.env.NOVA_SERVERS_FILE = join(work, "never-written.json");
  const list = mod.loadServers();
  process.env.NOVA_SERVERS_FILE = previous;
  assert.ok(list.length >= 2, "the Codespace and the Waifly slot should be there");
  assert.ok(list.some((s) => s.kind === "waifly" && s.base.includes("27316")));
  assert.ok(list.every((s) => s.id.startsWith("srv-")), "seeded entries need real ids");
});

test("seeded machines are written down once, so addedAt stops moving", () => {
  const previous = process.env.NOVA_SERVERS_FILE;
  const file = join(work, "seeded-once.json");
  process.env.NOVA_SERVERS_FILE = file;
  const first = mod.loadServers();
  assert.ok(existsSync(file), "the first read should persist the seeds");
  const written = JSON.parse(readFileSync(file, "utf8")).servers;
  assert.equal(written.length, first.length);
  const ids = written.map((s) => s.id).sort();
  const again = mod.loadServers();
  process.env.NOVA_SERVERS_FILE = previous;
  assert.deepEqual(again.map((s) => s.id).sort(), ids, "a second read must return the same machines");
  assert.deepEqual(again.map((s) => s.addedAt), written.map((s) => s.addedAt), "addedAt must not change on every read");
});

test("a machine the user removed stays removed once the seed list is current", () => {
  const previous = process.env.NOVA_SERVERS_FILE;
  const file = join(work, "user-removed.json");
  process.env.NOVA_SERVERS_FILE = file;
  mod.saveServers([{ id: "keep", name: "keep", base: "https://keep.onrender.com", kind: "render", addedAt: 1 }]);
  const back = mod.loadServers();
  process.env.NOVA_SERVERS_FILE = previous;
  assert.deepEqual(back.map((s) => s.base), ["https://keep.onrender.com"], "no resurrection after the seeds are current");
});

test("a new seed reaches a machine that booted before it existed", () => {
  const previous = process.env.NOVA_SERVERS_FILE;
  const file = join(work, "old-file.json");
  writeFileSync(file, JSON.stringify({ servers: [{ id: "x", name: "x", base: "https://x.onrender.com", kind: "render", addedAt: 1 }] }));
  process.env.NOVA_SERVERS_FILE = file;
  const back = mod.loadServers();
  const again = mod.loadServers();
  process.env.NOVA_SERVERS_FILE = previous;
  assert.equal(back.length, 1 + mod.SEED_SERVERS.length);
  assert.ok(back.some((s) => s.base.includes("nova.waifly.com")), "the HTTPS face is one of them");
  assert.equal(again.length, back.length, "merging happens once, not on every read");
});

/* ── peer exchange: one fleet, not three lists ───────────────────────────── */

test("mergePeerServers adds what the peer knows and never renames what we know", () => {
  const mine = [{ id: "a", name: "Waifly (اسمي أنا)", base: "https://nova.waifly.com", kind: "waifly", addedAt: 1 }];
  const theirs = [
    { name: "Waifly (اسمهم)", base: "https://nova.waifly.com", kind: "waifly" },
    { name: "Codespace", base: "https://x-8080.app.github.dev", kind: "codespace" },
    { name: "junk", base: "" },
    null,
  ];
  const merged = mod.mergePeerServers(mine, theirs, "https://peer.example.com", 1234);
  assert.equal(merged.servers.length, 2, "one duplicate, one new, junk dropped");
  assert.equal(merged.servers[0].name, "Waifly (اسمي أنا)", "a peer must not rename our machine");
  const gained = merged.gained[0];
  assert.equal(gained.base, "https://x-8080.app.github.dev");
  assert.equal(gained.learnedFrom, "https://peer.example.com");
  assert.equal(gained.addedAt, 1234);
});

test("mergePeerServers does not add the peer itself", () => {
  const merged = mod.mergePeerServers([], [{ name: "me", base: "https://peer.example.com" }], "https://peer.example.com");
  assert.equal(merged.servers.length, 0, "the caller already has that machine in its own list");
});

await testAsync("gossipServers asks only reachable machines and merges their lists", async () => {
  const list = [
    { id: "srv-a", name: "A", base: "https://a.example.com", kind: "custom", addedAt: 1 },
    { id: "srv-b", name: "B", base: "https://dead.example.com", kind: "custom", addedAt: 1 },
  ];
  const asked = [];
  const result = await mod.gossipServers(list, {
    force: true,
    fetchImpl: async (url) => {
      asked.push(url);
      if (url.includes("dead.example.com")) throw new Error("ECONNREFUSED");
      if (url.includes("/api/health")) return jsonResponse({ status: "ok" });
      if (url.includes("/api/fleet/servers")) {
        return jsonResponse({ servers: [{ name: "C", base: "https://c.example.com" }] });
      }
      return jsonResponse({});
    },
  });
  assert.ok(asked.some((u) => u.includes("a.example.com/api/fleet/servers?peers=0")), "asks a reachable peer with peers=0 (no loop)");
  assert.ok(!asked.some((u) => u.includes("dead.example.com/api/fleet/servers")), "does not ask a machine that is down");
  assert.equal(result.gained, 1);
  assert.ok(result.servers.some((s) => s.base === "https://c.example.com"), "the peer's machine is now ours too");
  assert.equal(result.peers.filter((p) => p.ok).length, 1);
});

await testAsync("gossipServers survives a peer that answers garbage", async () => {
  const list = [{ id: "srv-a", name: "A", base: "https://a.example.com", kind: "custom", addedAt: 1 }];
  const result = await mod.gossipServers(list, {
    force: true,
    fetchImpl: async (url) => {
      if (url.includes("/api/health")) return jsonResponse({ status: "ok" });
      return new Response("not json at all", { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  assert.equal(result.gained, 0);
  assert.equal(result.servers.length, 1, "our list is untouched");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
