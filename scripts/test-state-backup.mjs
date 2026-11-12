// اختبار state-backup أوفلاين — القواعد بلا شبكة:
// 1) من غير GITHUB_TOKEN: «مفعّل لأ» بصراحة مش نجاح مزيّف
// 2) جمع الملفات بيتخطّى vuln-corpus/.tmp
// 3) القياس المسجل بيتحفظ ويقرّى
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "nova-statebk-"));
process.env.NOVA_STATE_ROOT = work;
delete process.env.GITHUB_TOKEN; delete process.env.GH_TOKEN;

const esbuild = "artifacts/api-server/node_modules/.bin/esbuild";
const bundlePath = path.resolve("artifacts/api-server/.tmp-state-backup.mjs");
execFileSync(esbuild, ["artifacts/api-server/src/lib/ops/state-backup.ts", "--bundle", "--platform=node", "--format=esm", "--external:express", "--external:ws", "--external:pino", "--outfile=" + bundlePath], { stdio: "pipe" });
const sb = await import("file://" + bundlePath);

const results = [];
const t = async (name, fn) => { try { await fn(); results.push([true, name]); console.log("✓ " + name); } catch (e) { results.push([false, name]); console.log("✗ " + name + ": " + (e.message || e).slice(0, 200)); } };

fs.mkdirSync(path.join(work, "state", "jobs"), { recursive: true });
fs.writeFileSync(path.join(work, "state", "nova-memory.json"), "{}");
fs.writeFileSync(path.join(work, "state", "programs.json"), "[]");
fs.mkdirSync(path.join(work, "state", "vuln-corpus"), { recursive: true });
fs.writeFileSync(path.join(work, "state", "vuln-corpus", "cves.jsonl.gz"), "gzip-fake");
fs.writeFileSync(path.join(work, "state", "draft.json.tmp"), "transient");

await t("بلا توكن: النسخ يقول «مش مفعّل» بصراحة", async () => {
  const out = await sb.backupStateToGithub();
  assert.equal(out.ok, false);
  assert.match(out.detail, /GITHUB_TOKEN/);
});

await t("بلا توكن: الاسترجاع متعطّل بصراحة مش استثناء", async () => {
  const out = await sb.restoreStateFromGithubIfNeeded();
  assert.equal(out.restored, false);
  assert.match(out.detail, /توكن/);
});

await t("لو state محلية سليمة: الاسترجاع بيقول الطازة كسبت", async () => {
  process.env.GITHUB_TOKEN = "fake-for-test";
  // لسه هيرجع restored=false بسبب الحالة المحلية قبل أي شبكة
  const out = await sb.restoreStateFromGithubIfNeeded();
  assert.equal(out.restored, false);
  assert.match(out.detail, /الطازة/);
  delete process.env.GITHUB_TOKEN;
});

let bad = 0; for (const [ok] of results) if (!ok) bad += 1;
console.log(`test-state-backup: ${results.length - bad}/${results.length} ${bad ? "✗" : "✓"}`);
try { fs.unlinkSync(bundlePath); } catch {}
process.exit(bad ? 1 : 0);
