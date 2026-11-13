#!/usr/bin/env node
/**
 * Offline checks for the edge brain's honesty layer.
 *
 * Why this exists: the first live turn on 2026-11-04 answered "CVE-2021-44228,
 * CVSS 10.0" out of a corpus that stops at 2020. The model invented the most
 * famous CVE of the decade because it is famous, and nothing in the old code
 * could tell the difference. These tests pin the guard that now does.
 *
 * No network. `npm:@supabase/supabase-js` is aliased to a stub, so the only
 * thing under test is the logic that decides what NOVA is allowed to say.
 *
 *   node scripts/test-nova-brain-edge.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";
const FN = join(ROOT, "supabase/functions/nova-brain/index.ts");
const work = mkdtempSync(join(tmpdir(), "nova-brain-edge-"));

/* Stub for @supabase/supabase-js: records what was asked, answers from a table
   of canned rows so each test can decide what "the database" contains. */
const stub = join(work, "supabase-stub.mjs");
writeFileSync(
  stub,
  `// State lives on globalThis so the bundled copy and the test share one object.
const S = (globalThis.__novaStub ??= { cveRows: [], calls: [] });
export const __state = S;
export function createClient() {
  const builder = (table) => {
    const q = {
      _table: table, _filters: [],
      select() { return q; }, eq(k, v) { q._filters.push([k, v]); return q; },
      in(k, v) { q._filters.push([k, v]); return q; },
      order() { return q; }, limit() { return q; },
      gte() { return q; }, or(expr) { q._or = expr; return q; }, maybeSingle() { return q; },
      upsert() { return Promise.resolve({ data: null, error: null }); },
      insert() { return Promise.resolve({ data: null, error: null }); },
      then(ok, fail) {
        try {
          S.calls.push({ table, filters: q._filters });
          if (table === "corpus_cve" && q._or) {
            const terms = [...String(q._or).matchAll(/[a-z0-9_.-]{2,}/g)].map((m) => m[0]);
            const hit = S.cveRows.filter((r) => {
              const hay = (String(r.cve) + " " + (r.products || []).join(" ") + " " + (r.summary || "")).toLowerCase();
              return terms.some((t) => hay.includes(t));
            });
            ok({ data: hit.slice(0, 5), error: null, count: hit.length });
            return;
          }
          if (table === "corpus_cve") {
            const inFilter = q._filters.find(([k, v]) => k === "cve" && Array.isArray(v));
            if (inFilter) {
              const wanted = new Set(inFilter[1].map((x) => String(x).toUpperCase()));
              ok({ data: S.cveRows.filter((r) => wanted.has(r.cve)), error: null, count: null });
              return;
            }
            const eqFilter = q._filters.find(([k, v]) => k === "cve" && typeof v === "string");
            if (eqFilter) {
              ok({ data: S.cveRows.filter((r) => r.cve === eqFilter[1]), error: null, count: null });
              return;
            }
          }
          ok({ data: [], error: null, count: 0 });
        } catch (err) {
          fail(err);
        }
      },
    };
    return q;
  };
  return { from: builder, auth: {} };
}`,
);

const out = join(work, "bundle.mjs");
// esbuild is resolved by ./lib/esbuild-runner.mjs: Node API first, CLI second.
bundleCli(ROOT, [
  FN,
  "--bundle",
  "--format=esm",
  "--platform=neutral",
  "--log-level=error",
  `--alias:npm:@supabase/supabase-js@2=${stub}`,
  `--outfile=${out}`,
]);

// The module calls Deno.serve at import time; capture the handler instead of
// letting it fail, and give Deno.env just enough to boot.
globalThis.Deno = {
  env: { get: (k) => (k === "SUPABASE_URL" ? "https://stub.local" : "service-role-stub") },
  serve: (handler) => {
    globalThis.__served = handler;
  },
};

const mod = await import(out);
const stubbed = await import(stub);

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

const SENSED = {
  corpus: { publishedTotal: 46143, publishedAt: "2026-11-04T20:26:11.930Z", rowsInDb: 46861, partial: false, criticalInDb: 343 },
  hunt: { runs: 6, findings: 0, lastAt: "2026-11-04T20:35:35.079+00:00", lastScanned: 4 },
};

console.log("nova-brain (edge) — honesty layer");

test("module loads and registers a Deno.serve handler", () => {
  assert.equal(typeof globalThis.__served, "function");
});

test("the real handler is reachable (GET answered)", async () => {
  const res = await globalThis.__served(new Request("https://stub.local/nova-brain", { method: "GET" }));
  const body = await res.json();
  assert.ok("doc" in body, "GET must answer with a doc field");
});

test("numbersIn keeps comma-grouped and decimal numbers as one token", () => {
  const set = mod.numbersIn("القاعدة فيها 46,143 صف و CVSS 9.8 و 343 خطيرة");
  assert.ok(set.has("46143"), "46,143 must normalise to 46143");
  assert.ok(set.has("9.8"));
  assert.ok(set.has("343"));
});

test("cveIdsIn finds ids case-insensitively and dedupes", () => {
  const ids = mod.cveIdsIn("cve-2021-44228 و CVE-2021-44228 و CVE-2008-7261");
  assert.deepEqual(ids.sort(), ["CVE-2008-7261", "CVE-2021-44228"]);
});

test("cveIdsIn normalises the separator a model actually used (cve:2021-44228)", () => {
  assert.deepEqual(mod.cveIdsIn("عايز كل حاجة عن cve:2021-44228"), ["CVE-2021-44228"]);
  assert.deepEqual(mod.cveIdsIn("شوف CVE_2008_7261"), ["CVE-2008-7261"]);
  assert.deepEqual(mod.cveIdsIn("مفيش معرّف هنا"), []);
});

await testAsync("verifyClaims rejects the exact string that shipped a fake CVE", async () => {
  stubbed.__state.cveRows = []; // 2021 is not in this slice, and that is the point
  const fake = "من القاعدة عندنا CVE-2021-44228، درجته 10.0 وده أخطر حاجة.";
  const check = await mod.verifyClaims(fake, { state: SENSED, action: null });
  assert.equal(check.ok, false);
  assert.ok(check.invented.some((x) => x.includes("CVE-2021-44228")), check.invented.join(","));
  assert.ok(check.invented.some((x) => x.includes("10.0")), check.invented.join(","));
});

await testAsync("verifyClaims accepts a CVE that is really in the table", async () => {
  stubbed.__state.cveRows = [{ cve: "CVE-2008-7261" }];
  const real = "لقيت CVE-2008-7261 في القاعدة، 46861 صف.";
  const check = await mod.verifyClaims(real, { state: SENSED, action: null });
  assert.equal(check.ok, true, check.invented.join(","));
});

await testAsync("verifyClaims accepts a CVE that is in the tool evidence but not yet re-queried", async () => {
  stubbed.__state.cveRows = [];
  const evidence = { kind: "corpus_search", arg: "nginx", ok: true, hits: 1, examples: [{ cve: "CVE-2009-2629", severity: "high", cvss: 7.5, kev: false }] };
  const check = await mod.verifyClaims("أهو CVE-2009-2629 من الكوربوس.", { state: SENSED, action: evidence });
  assert.equal(check.ok, true, check.invented.join(","));
});

test("templateAnswer with zero hits says zero and invents nothing", () => {
  const text = mod.templateAnswer(
    SENSED,
    { content: "فيه log4j؟" },
    { kind: "corpus_search", arg: "log4j", ok: true, hits: 0, examples: [] },
  );
  assert.match(text, /صفر نتيجة/);
  assert.doesNotMatch(text, /CVE-20\d\d-\d+/);
  assert.match(text, /46861/, "the row count must be the measured one");
});

test("templateAnswer quotes the real examples it was given", () => {
  const text = mod.templateAnswer(SENSED, { content: "nginx؟" }, {
    kind: "corpus_search",
    arg: "nginx",
    ok: true,
    hits: 2,
    examples: [
      { cve: "CVE-2009-2629", severity: "high", cvss: 7.5, kev: false },
      { cve: "CVE-2009-3896", severity: "medium", cvss: 5, kev: false },
    ],
  });
  assert.match(text, /CVE-2009-2629/);
  assert.match(text, /CVE-2009-3896/);
  assert.match(text, /نتيجتان|2 نتيجة/);
});

test("templateAnswer never claims a CVE number from nowhere", () => {
  const text = mod.templateAnswer(SENSED, null, null);
  assert.doesNotMatch(text, /CVE-20\d\d-\d+/);
  assert.match(text, /آخر عملية صيد/);
});

test("templateAnswer is honest when the query itself failed", () => {
  const text = mod.templateAnswer(SENSED, { content: "x" }, { kind: "corpus_search", arg: "x", ok: false, error: "db down" });
  assert.match(text, /فشل/);
  assert.match(text, /db down/);
});

test("every number the template prints is one it was handed", () => {
  const text = mod.templateAnswer(SENSED, { content: "nginx" }, {
    kind: "corpus_search",
    arg: "nginx",
    ok: true,
    hits: 1,
    examples: [{ cve: "CVE-2009-2629", severity: "high", cvss: 7.5, kev: false }],
  });
  const allowed = mod.numbersIn(JSON.stringify(SENSED) + JSON.stringify({ kind: "corpus_search", arg: "nginx", ok: true, hits: 1, examples: [{ cve: "CVE-2009-2629", severity: "high", cvss: 7.5, kev: false }] }));
  for (const m of text.matchAll(/[0-9]+(?:[.,][0-9]+)?/g)) {
    const plain = m[0].replace(",", "");
    if (Math.abs(Number(plain)) < 10) continue; // ٣ سطور, ordinal noise like "0 1"
    assert.ok(allowed.has(plain), `template printed an unmeasured number: ${m[0]}`);
  }
});

await testAsync("autoAct finds a product that really exists in the table", async () => {
  stubbed.__state.cveRows = [
    { cve: "CVE-2008-7261", products: ["log4j"], summary: "log4j issue" },
    { cve: "CVE-2009-2629", products: ["nginx"], summary: "nginx issue" },
  ];
  const res = await mod.autoAct("تست آلي: كام CVE عندنا في القاعدة دلوقتي؟ وفيه log4j؟");
  assert.ok(res, "autoAct must return a result for a question naming log4j");
  assert.equal(res.arg, "log4j");
  assert.equal(res.hits, 1);
  assert.equal(res.examples[0].cve, "CVE-2008-7261");
});

await testAsync("autoAct answers a named CVE id even when it is missing", async () => {
  stubbed.__state.cveRows = [];
  const res = await mod.autoAct("هات CVE-2021-44228");
  assert.ok(res);
  assert.equal(res.kind, "cve_lookup");
  assert.equal(res.hits, 0);
});

await testAsync("a no-model turn still answers with a real row, never a guess", async () => {
  stubbed.__state.cveRows = [{ cve: "CVE-2008-7261", products: ["log4j"], summary: "log4j issue" }];
  const evidence = await mod.autoAct("وفيه log4j؟");
  const text = mod.templateAnswer(SENSED, { content: "وفيه log4j؟" }, evidence);
  assert.match(text, /CVE-2008-7261/);
  assert.doesNotMatch(text, /CVE-2021-44228/);
});

test("orderSeatsForRound2 prefers seats on a different host after Round 1", () => {
  const ordered = mod.orderSeatsForRound2("text.pollinations.ai");
  assert.ok(ordered.length >= 3);
  assert.notEqual(ordered[0].host, "text.pollinations.ai");
  assert.equal(ordered[ordered.length - 1].host, "text.pollinations.ai");
});

test("cleanReplyText strips reasoning blocks and stray IPA glitches", () => {
  const out = mod.cleanReplyText("<think>plan</think> نحتاج توسيع وʀِّفّع النطاقات.");
  assert.doesNotMatch(out, /<think>|plan|ʀ/);
  assert.match(out, /نحتاج توسيع/);
});

test("candidatesFrom filters generic English words like latest and status", () => {
  const cands = mod.candidatesFrom("what is the latest platform status for nginx");
  assert.deepEqual(cands, ["nginx"]);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
