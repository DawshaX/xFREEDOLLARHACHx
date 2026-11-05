#!/usr/bin/env node
/**
 * The keyless search must never turn "the network failed" into "nothing exists".
 *
 * That distinction is the whole point: a security tool that reports «مفيش
 * نتائج» for a broken request teaches its user to stop looking.
 *
 *   node scripts/test-web-search.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "artifacts/api-server/src/lib/agent/web-search.ts");
const work = mkdtempSync(join(tmpdir(), "nova-websearch-"));
const out = join(work, "bundle.mjs");
const esbuild = join(ROOT, "node_modules/.pnpm/node_modules/.bin/esbuild");
assert.ok(existsSync(esbuild), "esbuild binary not found — run pnpm install first");
execFileSync(esbuild, [SRC, "--bundle", "--format=esm", "--platform=node", "--log-level=error", `--outfile=${out}`]);

const mod = await import(out);

let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const realFetch = globalThis.fetch;

await test("DuckDuckGo results are parsed into title/url/snippet", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        Heading: "Bug bounty",
        AbstractText: "A bug bounty program rewards <b>reporters</b>.",
        AbstractURL: "https://en.wikipedia.org/wiki/Bug_bounty_program",
        RelatedTopics: [
          { Text: "HackerOne - platform", FirstURL: "https://duckduckgo.com/HackerOne" },
          { Topics: [{ Text: "Immunefi - web3", FirstURL: "https://duckduckgo.com/Immunefi" }] },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const r = await mod.webSearch("bug bounty", 5);
  assert.equal(r.source, "DuckDuckGo");
  assert.ok(r.results.length >= 3, `expected >=3 hits, got ${r.results.length}`);
  assert.equal(r.results[0].url, "https://en.wikipedia.org/wiki/Bug_bounty_program");
  assert.ok(!r.results[0].snippet.includes("<b>"), "HTML must be stripped from snippets");
  assert.equal(r.results[2].url, "https://duckduckgo.com/Immunefi");
});

await test("a DuckDuckGo failure falls through to Wikipedia", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    if (String(url).includes("duckduckgo")) return new Response("nope", { status: 503 });
    return new Response(JSON.stringify(["linux", ["Linux"], ["Linux is a kernel"], ["https://en.wikipedia.org/wiki/Linux"]]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const r = await mod.webSearch("linux", 3);
  assert.equal(r.source, "Wikipedia");
  assert.equal(r.results[0].url, "https://en.wikipedia.org/wiki/Linux");
  assert.ok(calls >= 2);
});

await test("both backends failing yields an empty list WITH reasons", async () => {
  globalThis.fetch = async () => {
    throw new Error("getaddrinfo ENOTFOUND api.duckduckgo.com");
  };
  const r = await mod.webSearch("anything", 3);
  assert.equal(r.results.length, 0);
  assert.ok(r.note && r.note.includes("DuckDuckGo"), "the note must name the failing backend");
  assert.ok(r.note.includes("ENOTFOUND"), "the note must carry the real reason");
});

await test("an empty query never calls the network", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  const r = await mod.webSearch("   ", 3);
  assert.equal(called, false);
  assert.equal(r.results.length, 0);
  assert.ok(r.note);
});

await test("hits without a URL are dropped, never rendered as a dead link", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(["x", ["A"], ["snippet"], [""]]), { status: 200, headers: { "content-type": "application/json" } });
  const r = await mod.webSearch("x", 3);
  assert.equal(r.results.length, 0);
});

globalThis.fetch = realFetch;

console.log(`\nweb-search: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n✗ ${f.name}\n${f.err.stack}`);
  process.exit(1);
}
