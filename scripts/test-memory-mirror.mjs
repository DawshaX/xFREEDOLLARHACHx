/**
 * Memory mirror test — proves the agent's memory survives a box with no disk.
 * ───────────────────────────────────────────────────────────────────────────
 * Free web hosts (Render free, scale-to-zero VMs) throw the filesystem away on
 * every deploy. The memory file is the agent's whole brain, so "no disk" would
 * mean "it forgot every lesson — again". The store now mirrors to one Supabase
 * row and rehydrates from it when the file is missing.
 *
 * Eight things must hold, and none of them can be proven by reading the code:
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
  for (const key of [
    "NOVA_SUPABASE_URL",
    "NOVA_SUPABASE_SERVICE_KEY",
    "NOVA_MEMORY_FILE",
    "NOVA_MEMORY_ROW",
    "NOVA_SUPERVISED",
    "NOVA_STATE_EDGE",
    "NOVA_STATE_EDGE_URL",
    "NOVA_STATE_TOKEN",
    "NOVA_EPHEMERAL_STATE",
    "NOVA_STATE_DIR",
    "GITHUB_ACTIONS",
    "CI",
  ]) {
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

/* ── 5 · the box has no secret: the edge function writes for it ─────────── */
{
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ?? null,
    });
    return { ok: true, status: 200, json: async () => ({ ok: true, row: null, records: 0 }) };
  };
  const store = freshStore({
    NOVA_MEMORY_FILE: path.join(work, "edge.json"),
    NOVA_SUPERVISED: "1",
    // المجلد هنا مؤقت (tmpdir) والمكان الدائم هو /home/container — فالتصريح ده
    // بيخلي السيناريو يقيس وضع الدالة، وسيناريو 8 يقيس إنه يتقفل لوحده.
    NOVA_EPHEMERAL_STATE: "0",
    NOVA_SUPABASE_URL: "https://example.supabase.co",
  });
  const st = store.mirrorStatus();
  check("keyless on a supervised box keeps the mirror on", st.on === true && st.via === "edge", JSON.stringify(st));
  const out = await store.hydrateMemoryFromMirror();
  check("an empty row hydrates nothing", out.hydrated === false, JSON.stringify(out));
  check("the read goes to the edge route with no apikey", seen.some((c) => c.url.endsWith("/functions/v1/nova-state") && !c.headers.apikey), seen.map((c) => c.url).join(","));
  store.remember({ kind: "fact", title: "من غير مفتاح", content: "the box holds no secret" });
  store.flushMemory();
  await new Promise((r) => setTimeout(r, 2200));
  // سيناريو 4 سيبق debounce وراّه على نفس الـmock — فكل قياس هنا بيتقصّى على مسار الدالة
  const post = seen.filter((c) => c.method === "POST" && c.url.endsWith("/functions/v1/nova-state")).pop();
  if (process.env.DBG) console.log("DBG seen=", JSON.stringify(seen.map((c) => ({ u: c.url, m: c.method, b: String(c.body).slice(0, 90), h: Object.keys(c.headers) })), null, 1), "status=", JSON.stringify(store.mirrorStatus()));
  check("the write posts the doc to the edge route", Boolean(post && post.url.endsWith("/functions/v1/nova-state")), post?.url);
  check("the edge body is { doc } with the new record", Boolean(post && JSON.parse(post.body).doc.records.some((r) => r.title === "من غير مفتاح")));
  check("no service key ever leaves the box", Boolean(post && !post.headers.apikey && !post.headers.authorization), JSON.stringify(post?.headers ?? {}));
  check("the edge POST carries no Prefer header (not a REST upsert)", Boolean(post && !post.headers.prefer), JSON.stringify(post?.headers ?? {}));
}

/* ── 6 · unsupervised with no env must not touch the default project ────── */
{
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ ok: true, row: null }) };
  };
  const store = freshStore({ NOVA_MEMORY_FILE: path.join(work, "unsup.json") });
  store.remember({ kind: "fact", title: "من غير إشراف", content: "local only" });
  store.flushMemory();
  await new Promise((r) => setTimeout(r, 1800));
  check(
    "unsupervised + no env → the default project is never contacted",
    calls.length === 0 && store.mirrorStatus().on === false,
    `${calls.length} calls · ${JSON.stringify(store.mirrorStatus())}`,
  );
}

/* ── 7 · a box that already remembers must fill an empty row at boot ────── */
{
  // القياس اللي المفروض الفحص ده يمنع رجوعه: nova_memory كانت 0 rows والمكنة
  // ليها 20 سجل على القرص — المِرور كان بيكتب عند الكتابة الجديدة بس، فالصف
  // كان يفضل فاضي لأيام. بقى في الإقلاع نفسه bootstrap: قرص مملوء + صف فاضي
  // = ارفع. ولو القراءة وقعت، مفيش رفع أعمى (احتماله يمسح نسخة حد تاني).
  const file = path.join(work, "bootstrap.json");
  const rec = (id, title) => ({
    id, kind: "fact", scope: "global", title, content: `body of ${id}`,
    tags: [], pinned: false, createdAt: "2026-11-07T10:00:00.000Z", updatedAt: "2026-11-07T10:00:00.000Z",
  });
  fs.writeFileSync(file, JSON.stringify({ version: 2, seq: 2, records: [rec("mem_a", "من قبل المِرور"), rec("mem_b", "الثاني")] }), "utf8");

  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ?? null, headers: init?.headers ?? {} });
    return { ok: true, status: 200, json: async () => ({ ok: true, row: null, records: 0 }) };
  };
  const store = freshStore({
    NOVA_MEMORY_FILE: file,
    NOVA_SUPERVISED: "1",
    NOVA_EPHEMERAL_STATE: "0",
    NOVA_SUPABASE_URL: "https://example.supabase.co",
  });
  const out = await store.hydrateMemoryFromMirror();
  check("full disk + empty row → one bootstrap push at boot", out.bootstrapped === true && out.records === 2, JSON.stringify(out));
  const post = seen.filter((c) => c.method === "POST" && c.url.endsWith("/functions/v1/nova-state")).pop();
  check("the bootstrap push carries both records", Boolean(post && JSON.parse(post.body).doc.records.length === 2), post?.url);
  check("the row is still not read back into memory", out.hydrated === false && store.listMemories().total === 2, JSON.stringify(store.listMemories().total));
  check("the boot reconcile is idempotent", (await store.hydrateMemoryFromMirror()).bootstrapped === true);

  // والقراءة الفاشلة ما تنتجش كتابة خالص
  const before = seen.length;
  globalThis.fetch = async () => {
    throw new Error("mirror unreachable");
  };
  const cold = freshStore({
    NOVA_MEMORY_FILE: file,
    NOVA_SUPERVISED: "1",
    NOVA_EPHEMERAL_STATE: "0",
    NOVA_SUPABASE_URL: "https://example.supabase.co",
  });
  const out2 = await cold.hydrateMemoryFromMirror();
  check("a failed read never pushes blind", out2.bootstrapped === undefined && seen.length === before, JSON.stringify(out2));
  check("the failure is recorded, not thrown", cold.mirrorStatus().state === "error", JSON.stringify(cold.mirrorStatus()));
}

/* ── 8 · CI never writes the durable row ─────────────────────────────────── */
{
  // القياس اللي جبّر السيناريو ده: live audit شغّل الحزمة نفسها (boot.mjs بيحط
  // NOVA_SUPERVISED=1) في CI وعلى جهاز تطوير، فكتب `nova_memory` بـ«Audit marker»
  // سجلين بدل 20 سجل المكنة (متقاس 2026-11-07T17:01:20Z من القاعدة نفسها).
  // بقى لازم مكان الحالة يكون /home/container فعلًا عشان المِرور يتفعّل بالافتراضي.
  for (const trigger of [{ GITHUB_ACTIONS: "true" }, { CI: "true" }, { CODESPACES: "true" }, {}]) {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ ok: true, row: null, records: 0 }) };
    };
    const store = freshStore({
      NOVA_MEMORY_FILE: path.join(work, "ephemeral.json"),
      NOVA_SUPERVISED: "1",
      NOVA_SUPABASE_URL: "https://example.supabase.co",
      ...trigger,
    });
    const label = Object.keys(trigger)[0] ?? "لا CI ولا مجلد دائم";
    await store.hydrateMemoryFromMirror();
    store.remember({ kind: "fact", title: "علامة لحظية", content: "temp copy must not write" });
    store.flushMemory();
    await new Promise((r) => setTimeout(r, 1700));
    check(`${label}: نسخة لحظية ما تكتبش في الدائمة`, calls.length === 0 && store.mirrorStatus().on === false, `${calls.length} calls · ${JSON.stringify(store.mirrorStatus())}`);
  }
}

let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
}
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
process.exit(bad === 0 ? 0 : 1);
