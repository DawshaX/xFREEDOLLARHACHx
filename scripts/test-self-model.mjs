#!/usr/bin/env node
/**
 * The self-model is the answer to «انت مين وقادر على إيه؟», so these tests pin
 * the property that made the old answer useless: every number must come from a
 * registry at call time, not from a string someone typed three releases ago.
 *
 * Measured 2026-11-05: the prompt said «33 أداة» while 47 were registered, and
 * a capability question got a counter-question back instead of an answer.
 *
 *   node scripts/test-self-model.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";
const SRC = join(ROOT, "artifacts/api-server/src/lib/agent/self-model.ts");
const work = mkdtempSync(join(tmpdir(), "nova-selfmodel-"));
const out = join(work, "bundle.mjs");

// esbuild is resolved by ./lib/esbuild-runner.mjs: Node API first, CLI second.
const shim = 'import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);';
bundleCli(ROOT, [SRC, "--bundle", "--format=esm", "--platform=node", "--log-level=error", `--banner:js=${shim}`, `--outfile=${out}`]);

process.env.NOVA_SERVERS_FILE = join(work, "servers.json");
process.env.NOVA_STATE_DIR = join(work, "state");
process.env.NOVA_MEMORY_FILE = join(work, "state/nova-memory.json");

const mod = await import(out);
const { AGENT_TOOLS } = await import(
  await (async () => {
    const o = join(work, "tools.mjs");
    bundleCli(ROOT, [join(ROOT, "artifacts/api-server/src/lib/agent/tools.ts"), "--bundle", "--format=esm", "--platform=node", "--log-level=error", `--banner:js=${shim}`, `--outfile=${o}`]);
    return o;
  })()
);

// identityAnswer lives in core.ts (it is the answer path, not the model), so the
// test bundles it too — the promise being checked is that the numbers in the
// answer are the numbers in the registry.
const coreBundle = join(work, "core.mjs");
bundleCli(ROOT, [join(ROOT, "artifacts/api-server/src/lib/agent/core.ts"), "--bundle", "--format=esm", "--platform=node", "--log-level=error", `--banner:js=${shim}`, `--outfile=${coreBundle}`]);
const core = await import(coreBundle);

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
};

const model = mod.buildSelfModel();
const prompt = mod.selfModelPrompt(model);

test("the tool count equals the registry, not a typed number", () => {
  assert.equal(model.tools.count, AGENT_TOOLS.length);
  assert.ok(model.tools.count > 33, `expected more than the old stale 33, got ${model.tools.count}`);
});

test("every registered tool name appears in the measured list", () => {
  assert.equal(model.tools.names.length, AGENT_TOOLS.length);
  for (const t of AGENT_TOOLS) assert.ok(model.tools.names.includes(t.name), t.name);
});

test("the prompt contains the real count and never the stale 33", () => {
  assert.ok(prompt.includes(String(AGENT_TOOLS.length)), "count missing from the prompt");
  assert.ok(!/\b33 أداة\b/.test(prompt), "the stale number is back");
});

test("capabilities are phrased as actions and limits are stated", () => {
  assert.ok(model.canDo.length >= 3);
  assert.ok(model.cannotDo.some((c) => /Metasploit|Burp/.test(c)), "the honest limit about Kali tools is missing");
  assert.ok(prompt.includes("مش مقدور"), "the prompt must have an explicit cannot-do section");
});

test("the anti-counter-question rule is in the prompt", () => {
  assert.match(prompt, /ما تسأليش|متسألش/);
});

test("an unmeasured corpus is reported as unmeasured, never as zero rows", () => {
  const p = mod.selfModelPrompt({ ...model, corpus: { measured: false, total: 0, ageMin: null } });
  assert.match(p, /غير مقاس/);
  // `192,930 ثغرة` ends with "0 ثغرة", so a plain substring check would fail on
  // a correct prompt. Match a standalone zero instead.
  assert.ok(!/(?<![\d,])0 ثغرة/.test(p), "0 must never be presented as a measurement");
});

test("no registered machine is said out loud", () => {
  const p = mod.selfModelPrompt({ ...model, machines: { registered: 0, names: [] } });
  assert.match(p, /0 ماكينة/);
});

test("«انت مين» is answered from the measurement, including the real count", () => {
  const answer = core.identityAnswer(model);
  assert.match(answer, new RegExp(String(AGENT_TOOLS.length)), "the answer must carry the measured tool count");
  assert.doesNotMatch(answer, /33 أداة/, "the number that was typed once must never come back");
  assert.match(answer, /مش بعمله/, "limits are stated in the same breath");
  assert.match(answer, /example\.com/, "the answer ends with something the user can do now");
});

test("the self-question matcher catches the questions and nothing else", () => {
  for (const q of ["انت مين", "تقدر تحمل ادوات؟", "تقدر تشتغل على metasploit و burpsuite؟", "تنزل أدوات كالي؟"]) {
    assert.equal(core.SELF_QUESTION.test(q), true, `should match: ${q}`);
  }
  for (const q of ["استطلع example.com", "ابحث عن CVE-2024-3094", "كم جهاز في الأسطول؟"]) {
    assert.equal(core.SELF_QUESTION.test(q), false, `should NOT match: ${q}`);
  }
});

test("a greeting introduces the real machine, in two lines", () => {
  const hello = core.greetingAnswer(model);
  assert.match(hello, new RegExp(String(AGENT_TOOLS.length)), "the greeting carries the measured count");
  assert.match(hello, /مش بتتكلم بس/, "it says what the agent is, not what a chatbot is");
  assert.doesNotMatch(hello, /كيف يمكنني مساعدتك/, "the generic assistant line must never come back");
  assert.ok(hello.split("\n").length <= 8, "a greeting is short");
});

test("a greeting with a real task in it is not treated as small talk", () => {
  // `extractTarget` deliberately ignores example.com/test/localhost — a test
  // must use a real-looking host or it tests the wrong thing.
  const plan = core.heuristicPlan("أهلا، استطلع google.com");
  assert.ok(
    plan.steps.some((s) => s.tool === "recon_target"),
    "a greeting at the front must not swallow the request behind it",
  );
});

test("«مرحببببببا» is a greeting, not a memory search", () => {
  // The exact opener of the transcript this round exists for.
  const plan = core.heuristicPlan("مرحببببببا");
  assert.deepEqual(plan.steps, [], "a hello must not call tools");
  assert.equal(core.heuristicPlan("مرحبا، عامل ايه").steps.length, 0);
  // …while a greeting with work in it still plans the work.
  assert.ok(core.heuristicPlan("مرحبا، دوّر على CVE-2024-3094").steps.length > 0);
});

test("securityTools measured, and the prompt repeats the measurement", () => {
  const st = model.securityTools;
  assert.ok(st, "securityTools مش في النموذج — النموذج هيكلم نفسه بجملة عمومية");
  assert.ok(Array.isArray(st.present) && Array.isArray(st.missing), "present/missing لازم مصفوفات مقاسة");
  assert.equal(st.present.filter((b) => st.missing.includes(b)).length, 0, "أداة موجودة وناقصة في نفس الوقت");
  assert.equal(typeof st.provisionable, "boolean");
  assert.equal(typeof st.writable, "boolean");
  const ready = mod.selfModelPrompt({ ...model, securityTools: { present: ["nuclei"], missing: [], provisionable: true, writable: true, scriptFound: true } });
  assert.match(ready, /منصوبة ومقيسة \(nuclei\)/, "الـprompt مابيقولش المقاس");
  const need = mod.selfModelPrompt({ ...model, securityTools: { present: [], missing: ["nuclei", "httpx"], provisionable: true, writable: true, scriptFound: true } });
  assert.match(need, /tools_install/, "لما التجهيز متاح الـprompt لازم يسمّي الأداة");
  assert.match(need, /ناقصاه/, "ولازم يسمّي الناقص");
  const stuck = mod.selfModelPrompt({ ...model, securityTools: { present: [], missing: [], provisionable: false, writable: false, scriptFound: false } });
  assert.match(stuck, /مش قادر أنزّلها هنا/, "ولو القرص مقفول يقول كده، مش يسأل المستخدم");
});

test("the agent can reach the spine: tools_install + bounty_candidates are registered", () => {
  for (const name of ["tools_install", "bounty_candidates"]) {
    assert.ok(model.tools.names.includes(name), `${name} مش في السجل — المحرك مالوش إيدين`);
  }
  assert.ok(model.tools.count >= 49, `العدد لازم يتقاس من السجل: ${model.tools.count}`);
  assert.equal(model.tools.names.filter((n) => n === "tools_install").length, 1, "أداة متكررة في السجل");
});

console.log(`\nself-model: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n✗ ${f.name}\n${f.err.stack}`);
  process.exit(1);
}
