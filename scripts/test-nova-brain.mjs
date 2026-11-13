/**
 * NOVA brain test — the thinking loop, proven without a network.
 * ─────────────────────────────────────────────────────────────
 * The brain runs in CI against a keyless model, so the interesting parts are
 * exactly the ones a flaky network would hide:
 *
 *   1. senses come from files that exist (never from hope)
 *   2. `findPending` answers a question once and only once
 *   3. a model reply wrapped in prose or fences still parses
 *   4. a plan naming an action outside the allow-list collapses to `none`
 *   5. the seat list is walked in order when one throws or returns junk
 *   6. a tool call against the ops API is executed and its error is reported,
 *      not thrown away
 *   7. `says_ar` and `sources` never invent a number the run did not read
 *
 * Run: node scripts/test-nova-brain.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSenses, findPending, extractJson, sanitizePlan, think, runAction, brainDoc, systemPrompt, SEATS } from "./nova-brain.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const check = (name, ok, detail = "") => checks.push([name, Boolean(ok), detail]);

/* 1 · senses are read, or absent — never guessed */
const senses = readSenses();
const corpusFile = JSON.parse(fs.readFileSync(path.join(root, "state/vuln-corpus-index.json"), "utf8"));
check("senses.corpus.total equals the published index", senses.corpus?.total === corpusFile.total, `total=${senses.corpus?.total}`);
check(
  "senses.corpus.kev equals the published index",
  senses.corpus?.kev === corpusFile.kev,
  `kev=${senses.corpus?.kev}`,
);
check(
  "senses has no key for a file that does not exist",
  senses.advisories === undefined || typeof senses.advisories.total === "number",
  JSON.stringify(Object.keys(senses)),
);

/* 2 · pending detection */
const answered = [
  { role: "user", content: "كم ثغرة؟", created_at: "2026-11-04T20:00:00Z" },
  { role: "assistant", content: "144000", created_at: "2026-11-04T20:01:00Z" },
];
check("an answered question is not pending", findPending(answered) === null);

const waiting = [...answered, { role: "user", content: "وابحث عن nginx", created_at: "2026-11-04T20:05:00Z" }];
check("a newer question is pending", findPending(waiting)?.content === "وابحث عن nginx");
check("no messages → nothing pending", findPending([]) === null);

/* 3 · parsing survives prose and fences */
check("bare JSON parses", extractJson('{"reply":"أهلاً"}')?.reply === "أهلاً");
check("fenced JSON parses", extractJson('تمام:\n```json\n{"reply":"تم"}\n```\nشكراً')?.reply === "تم");
check("non-JSON returns null instead of throwing", extractJson("مفيش JSON هنا") === null);

/* 4 · the allow-list */
const bad = sanitizePlan({ reply: "هجم على example.com", action: { kind: "exploit_host", arg: "example.com" } });
check("an action outside the allow-list becomes none", bad.action.kind === "none", bad.action.kind);
check("the reply itself is kept", bad.reply === "هجم على example.com");
const good = sanitizePlan({ reply: "أهو", action: { kind: "corpus_search", arg: "nginx".repeat(40) } });
check("an allowed action keeps its kind", good.action.kind === "corpus_search");
check("the argument is capped at 120 chars", good.action.arg.length === 120, `len=${good.action.arg.length}`);
check("an empty argument collapses to none", sanitizePlan({ reply: "x", action: { kind: "corpus_search", arg: "  " } }).action.kind === "none");

/* 5 · seat fallback */
const throwing = async () => {
  throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
};
const failing = await think({ senses, pending: null, fetchImpl: throwing });
check("every seat failing → no plan, reasons kept", failing.plan === null && failing.failures.length === SEATS.length, failing.failures.join(" | "));

let calls = 0;
const flaky = async (url, init) => {
  calls += 1;
  if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
  const asked = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ reply: `رد من ${asked.model}`, action: { kind: "none", arg: "" }, why: "اختبار" }) } }],
    }),
  };
};
const second = await think({ senses, pending: { content: "مرحبا" }, fetchImpl: flaky });
check("a 429 falls through to the next seat", second.seat === "mistral" && second.plan.reply.includes("mistral"), String(second.seat));
check("the first seat's failure is still reported", second.failures[0]?.includes("429"), second.failures[0]);

const seenUrls = [];
const host402 = async (url, init) => {
  seenUrls.push(url);
  if (url.includes("pollinations")) return { ok: false, status: 402, json: async () => ({}) };
  const asked = JSON.parse(init.body);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ reply: `<think>hidden</think>رد من ${asked.model}`, action: { kind: "none", arg: "" }, why: "تبديل" }) } }],
    }),
  };
};
const external = await think({ senses, pending: { content: "أهلاً" }, fetchImpl: host402 });
check(
  "a 402 on Pollinations switches to an independent host (ovh) and strips <think>",
  external.seat === "ovh-llama" && seenUrls.some((u) => u.includes("ovh.net")) && !external.plan.reply.includes("<think>"),
  `${external.seat} · ${external.plan?.reply}`,
);

/* 6 · the hands */
const okFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ rows: [{ cve: "CVE-2024-0001", severity: "CRITICAL", cvss: 9.8, kev: true }] }),
});
const hit = await runAction({ kind: "corpus_search", arg: "nginx" }, { fetchImpl: okFetch });
check("corpus_search reports real hits", hit.ok && hit.hits === 1 && hit.examples[0].cve === "CVE-2024-0001");
const miss = await runAction({ kind: "corpus_search", arg: "nginx" }, { fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
check("a 503 is reported, not thrown", miss.ok === false && miss.error === "HTTP 503");
check("action none does nothing", (await runAction({ kind: "none" }, { fetchImpl: okFetch })) === null);

/* 7 · the published document */
const doc = brainDoc({
  at: "2026-11-04T22:00:00Z",
  seat: "openai",
  plan: { reply: "أول سطر\nسطر تاني", why: "سبب", action: { kind: "none", arg: "" } },
  action: null,
  pending: { content: "سؤال", created_at: "2026-11-04T21:59:00Z" },
  senses,
  failures: [],
});
check("says_ar carries the first line only", doc.says_ar.includes("أول سطر") && !doc.says_ar.includes("سطر تاني"));
check("the doc names where every number came from", Array.isArray(doc.sources) && doc.sources.includes("state/vuln-corpus-index.json"));
check("the answered question is recorded", doc.answered?.question === "سؤال");
check("the prompt forbids out-of-scope action", systemPrompt(senses).includes("مش مصرّح به"));

/* 8 · the tool takes a product token, so the brain must be told which ones exist */
const top = senses.corpus?.topProducts;
check("senses carries real product tokens for the search tool", Array.isArray(top) && top.length > 0, JSON.stringify(top?.slice(0, 3)));
check(
  "the prompt names those products and forbids a phrase as the argument",
  systemPrompt(senses).includes("topProducts") && systemPrompt(senses).includes("مش جملة"),
);
check(
  "topProducts are the published ones, not invented",
  Array.isArray(top) && top.every((p) => corpusFile.topProducts.some((x) => x.product === p)),
  `${top?.length} tokens`,
);

let bad_ = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad_ += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
}
console.log(`\n${checks.length - bad_}/${checks.length} checks passed`);
process.exit(bad_ === 0 ? 0 : 1);
