/**
 * Memory mirror test — proves the agent's memory survives a box with no disk.
 * ───────────────────────────────────────────────────────────────────────────
 * Free web hosts (Render free, scale-to-zero VMs) throw the filesystem away on
 * every deploy. The memory file is the agent's whole brain, so "no disk" would
 * mean "it forgot every lesson — again". The store now mirrors to one Supabase
 * row and rehydrates from it when the file is missing.
 *
 * Four things must hold, and none of them can be proven by reading the code:
 *   1. with the env unset, NOT ONE network call is made (a plain file store)
 *   2. a cold start with no file hydrates from the mirror row
 *   3. a write reaches the mirror (and carries the whole document)
 *   4. an HTTP failure is recorded, not thrown — memory must never crash a turn
 *
 * Run: node scripts/test-memory-mirror.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli, esbuildApi, esbuildCli } from "./lib/esbuild-runner.mjs";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "nova-memory-test-"));
const bundle = path.join(work, "memory-store.cjs");

if (!esbuildApi(root) && !esbuildCli(root)) {
  console.log("check skipped: esbuild not installed (run pnpm install)");
  process.exit(0);
}
bundleCli(root, [
  path.join(root, "artifacts/api-server/src/lib/agent/memory-store.ts"),
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node22",
  `--outfile=${bundle}`,
], { stdio: "pipe" });

const checks = [];
const check = (name, ok, detail = "") => checks.push([name, Boolean(ok), detail]);

let copySeq = 0;
function freshStore(env) {
  // A fresh module instance per scenario: the store memoises `loaded`, and the
  // mirror env is read at import time. A copy per scenario is the only honest way
  // to get a new instance (a ?cache-buster does not work with require()).
  const modulePath = path.join(work, `copy-${copySeq++}.cjs`);
  fs.copyFileSync(bundle, modulePath);
  const saved = { ...process.env };
  for (const key of ["NOVA_SUPABASE_URL", "NOVA_SUPABASE_SERVICE_KEY", "NOVA_MEMORY_FILE", "NOVA_MEMORY_ROW"]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  const req = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = req(modulePath);
  process.env = saved;
  return mod;
}

/* ── 1 · no env, no traffic ─────────────────────────────────────────────── */
{
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => [] };
  };
  const store = freshStore({ NOVA_MEMORY_FILE: path.join(work, "plain.json") });
  store.remember({ kind: "fact", title: "بدون مِرور", content: "الذاكرة على القرص بس" });
  store.flushMemory();
  await new Promise((r) => setTimeout(r, 1800));
  check("unset env → zero network calls", calls.length === 0, `${calls.length} calls`);
  check("unset env → mirror reports off", store.mirrorStatus().on === false, JSON.stringify(store.mirrorStatus()));
  check("the file still holds the record", store.recall("بدون مِرور").length > 0);
}

/* ── 2 · cold start with no file hydrates from the row ──────────────────── */
const remoteDoc = {
  version: 2,
  seq: 7,
  records: [
    {
      id: "r1",
      kind: "fact",
      title: "درس محفوظ في السحابة",
      content: "الهدف scanme.nmap.org مسموح",
      tags: ["scope"],
      scope: "global",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      hits: 0,
      lastUsedAt: null,
      seq: 7,
    },
  ],
};
{
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => [{ doc: remoteDoc }] };
  };
  const store = freshStore({
    NOVA_MEMORY_FILE: path.join(work, "cold.json"),
    NOVA_SUPABASE_URL: "https://example.supabase.co",
    NOVA_SUPABASE_SERVICE_KEY: "service-key-not-real",
  });
  const out = await store.hydrateMemoryFromMirror();
  check("cold start hydrates from the row", out.hydrated === true && out.records === 1, JSON.stringify(out));
  check("hydrated memory is searchable by hostname part", store.recall("scanme").length > 0, `hits=${store.recall("scanme").length}`);
  check("hydrated memory is searchable by the whole token", store.recall("scanme.nmap.org").length > 0);
  check("hydration wrote the local file too", fs.existsSync(path.join(work, "cold.json")));
  check("the read used the row endpoint", calls.some((u) => u.includes("/rest/v1/nova_memory?id=eq.main")), calls[0]);
}

/* ── 3 · a write reaches the mirror ─────────────────────────────────────── */
{
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ?? null, headers: init?.headers ?? {} });
    return { ok: true, status: 200, json: async () => [] };
  };
  const store = freshStore({
    NOVA_MEMORY_FILE: path.join(work, "push.json"),
    NOVA_SUPABASE_URL: "https://example.supabase.co/", // trailing slash must not double up
    NOVA_SUPABASE_SERVICE_KEY: "service-key-not-real",
  });
  store.remember({ kind: "event", title: "دفعة للسحابة", content: "hunt ran on scanme" });
  store.flushMemory();
  await new Promise((r) => setTimeout(r, 2200));
  const posts = seen.filter((c) => c.method === "POST");
  const push = posts[posts.length - 1];
  check("a write is pushed to the mirror", Boolean(push), seen.map((c) => c.method).join(","));
  check("the push is an upsert on id", Boolean(push && push.url.includes("on_conflict=id") && push.url.startsWith("https://example.supabase.co/rest/v1/nova_memory")), push?.url);
  check("the push carries the whole document", Boolean(push && JSON.parse(push.body)[0].doc.records.some((r) => r.title === "دفعة للسحابة")));
  check("the service key travels as apikey + bearer", Boolean(push && push.headers.apikey === "service-key-not-real" && String(push.headers.authorization).startsWith("Bearer ")));
  check("the mirror reports ok", store.mirrorStatus().state === "ok", JSON.stringify(store.mirrorStatus()));
}

/* ── 4 · a failing mirror never throws ──────────────────────────────────── */
{
  globalThis.fetch = async () => {
    throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
  };
  const store = freshStore({
    NOVA_MEMORY_FILE: path.join(work, "fail.json"),
    NOVA_SUPABASE_URL: "https://example.supabase.co",
    NOVA_SUPABASE_SERVICE_KEY: "service-key-not-real",
  });
  const out = await store.hydrateMemoryFromMirror();
  check("a dead mirror hydrates nothing and does not throw", out.hydrated === false, JSON.stringify(out));
  check("the failure is recorded", store.mirrorStatus().state === "error" || store.mirrorStatus().error !== null, JSON.stringify(store.mirrorStatus()));
  const rec = store.remember({ kind: "fact", title: "لسه شغال", content: "الذاكرة محلية" });
  store.flushMemory();
  await new Promise((r) => setTimeout(r, 2200));
  check("writes still work when the mirror is down", Boolean(rec?.id) && store.recall("محلية").length > 0);
}

let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
}
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
process.exit(bad === 0 ? 0 : 1);
