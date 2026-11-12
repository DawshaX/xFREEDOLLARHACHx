#!/usr/bin/env node
/**
 * بوابات `scripts/nova-panel-restart.mjs` — على لوحة Pterodactyl وهمية محلّية.
 *
 * ليه: أمر إعادة التشغيل ده هو «الزرّار» اللي كنّا بنسبّه للمستخدم. ماقبلش نطلبه
 * منه، بنقيس إن الطلب نفسه صحيح: نفس المسار، نفس الهيدر، نفس الجسم، وإن المفتاح
 * مابيطلعش في اللوجات، وإن الفشل مابيخلّيش البوابة نفسها تفشل.
 *
 *   node scripts/test-panel-restart.mjs
 *
 * شغّال بلا نت: السيرفر الوهمي على 127.0.0.1 بس.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/nova-panel-restart.mjs");
const TOKEN = "PTSV_zzz-secret-token-1234567890";

/** كل حالة بتبتدي من `reset`: تسلسل health محدد + سلوك الـpower. */
const state = { health: [502], power: { status: 204, body: "" }, hits: [] };

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    if (req.url === "/__reset") {
      res.writeHead(204).end();
      return;
    }
    if (req.url.startsWith("/api/health")) {
      const code = state.health.length > 1 ? state.health.shift() : state.health[0];
      state.hits.push({ kind: "health", code });
      res.writeHead(code, { "content-type": "application/json" });
      res.end(code === 200 ? '{"status":"ok"}' : "<html>502 Bad Gateway</html>");
      return;
    }
    if (req.url.endsWith("/power") && req.method === "POST") {
      state.hits.push({ kind: "power", method: req.method, url: req.url, auth: req.headers.authorization || "", ct: req.headers["content-type"] || "", body });
      res.writeHead(state.power.status, { "content-type": "application/json" });
      res.end(state.power.body);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"errors":[{"code":"NotFoundHttpException","detail":"nope"}]}');
  });
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * `spawn` مش `spawnSync` — والفرق هنا مش ستايل: اللوحة الوهمية عايشة في نفس
 * العملية، وأي بلوك للـevent loop (زي spawnSync) معناه إن مفيش حد بيرد على طلبات
 * الطفل، فالطفل معلّق 15 ثانية على كل fetch. قِیس كده واتصلح (2026-11-08).
 */
function run(args, extraEnv = {}) {
  return new Promise((done) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        ...process.env,
        NOVA_PANEL_URL: BASE,
        NOVA_HUB_URL: BASE,
        NOVA_PANEL_SERVER: "53a7d0cb",
        NOVA_PANEL_TOKEN: TOKEN,
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => { stdout += d.toString(); });
    p.stderr.on("data", (d) => { stderr += d.toString(); });
    const killer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* ماتت */ } }, 30_000);
    p.on("close", (status) => {
      clearTimeout(killer);
      let doc = null;
      try {
        doc = JSON.parse(stdout.trim().split("\n").pop());
      } catch {
        /* بنفشل تحت بصراحة: doc=null */
      }
      done({ doc, stdout, stderr, status });
    });
  });
}

async function reset(next) {
  Object.assign(state, { health: [502], power: { status: 204, body: "" }, hits: [] }, next || {});
  try {
    await fetch(`${BASE}/__reset`, { method: "POST" });
  } catch (e) {
    throw new Error(`reset فشل: ${e.message} · cause=${e.cause && e.cause.message} · BASE=${BASE}`);
  }
}

const checks = [];
function check(name, fn) {
  checks.push([name, fn]);
}

check("الأمر الصحيح بيوصل للوحة: مسار + هيدر + جسم", async () => {
  await reset({ health: [502, 502, 200] });
  const r = await run(["--wait", "2", "--json"]);
  assert.equal(r.status, 0, `exit=${r.status} stderr=${r.stderr}`);
  const power = state.hits.find((h) => h.kind === "power");
  assert.ok(power, "مافيش طلب power وصل للوحة");
  assert.equal(power.method, "POST");
  assert.equal(power.url, "/api/client/servers/53a7d0cb/power");
  assert.equal(power.auth, `Bearer ${TOKEN}`);
  assert.equal(power.ct, "application/json");
  assert.deepEqual(JSON.parse(power.body), { signal: "restart" });
  assert.equal(r.doc.ok, true);
  assert.equal(r.doc.healthy, true, "قال ok وهو مالقاش الهب راجع");
  assert.equal(r.doc.power.status, 204);
});

check("--when-down بيفوّت لما الهب سليم (مافيش إعادة تشغيل عبث)", async () => {
  await reset({ health: [200] });
  const r = await run(["--when-down", "--wait", "0"]);
  assert.equal(r.status, 0);
  assert.equal(r.doc.ok, true);
  assert.match(r.doc.skipped, /مفيش داعي/);
  assert.equal(state.hits.some((h) => h.kind === "power"), false, "بعت power رغم إن الهب شغال");
});

check("--when-down بيبعت power فعلًا لما الهب 502", async () => {
  await reset({ health: [502, 502, 200] });
  const r = await run(["--when-down", "--wait", "2"]);
  assert.equal(r.status, 0);
  assert.ok(state.hits.some((h) => h.kind === "power"), "الهب واقع ومافيش محاولة إعادة تشغيل");
  assert.equal(r.doc.healthy, true);
});

check("المفتاح مابيطلعش في المخرج أبدًا", async () => {
  await reset({ health: [502], power: { status: 403, body: '{"errors":[{"code":"HttpException","detail":"Token mismatch"}]}' } });
  const r = await run(["--wait", "0"]);
  assert.equal(r.doc.ok, false);
  assert.equal(r.doc.power.status, 403);
  assert.match(r.doc.power.detail, /Token mismatch/);
  assert.ok(!r.stdout.includes(TOKEN) && !r.stderr.includes(TOKEN), "التوكن تسرّب في اللوج!");
  assert.equal(r.status, 0, "البوابة المفروض ماتحمراش على فشل إعادة التشغيل");
  const strict = await run(["--wait", "0", "--strict"]);
  assert.equal(strict.status, 5, "strict المفروض يطلع كود فشل محدد");
});

check("بلا توكن = بيقول السبب بوضوح ومايموتش", async () => {
  await reset({ health: [502] });
  const r = await run(["--wait", "0"], { NOVA_PANEL_TOKEN: "" });
  assert.equal(r.status, 0);
  assert.match(r.doc.error, /NOVA_PANEL_TOKEN/);
  assert.equal(state.hits.some((h) => h.kind === "power"), false);
  // `await` بقى قبل `.status` = بياخد الـpromise كله، عشان كده بنقوّس ✓
  assert.equal((await run(["--wait", "0", "--strict"], { NOVA_PANEL_TOKEN: "" })).status, 3);
});

check("signal غلط مابيطالعش طلب للوحة", async () => {
  await reset({ health: [502] });
  const r = await run(["--signal", "reboot", "--wait", "0"]);
  assert.equal(r.status, 0);
  assert.match(r.doc.error, /signal/);
  assert.equal(state.hits.some((h) => h.kind === "power"), false, "بعت signal مش موجود في الوثيقة");
});

check("اللوحة نفسها ميت = fetch فشل، والرسالة قابلة للقراءة", async () => {
  await reset({ health: [502] });
  const r = await run(["--panel", "http://127.0.0.1:1", "--wait", "0"]);
  assert.equal(r.status, 0);
  assert.equal(r.doc.power.ok, false);
  assert.match(r.doc.power.detail, /fetch فشل/);
});

let bad = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    bad += 1;
    console.log(`✗ ${name}\n    ${(process.env.TRACE ? String(e.stack) : String(e.message)).split("\n").slice(0,5).join(" | ")}`);
  }
}
// اللقطة دي بعد التشغيل لا قبله: `server.close()` كان بيتنادي أول ما الملف ييتنفّذ،
// فالـchecks كلها كانت بتلمس بورت مقفول — ECONNREFUSED سبعة مرات (قِيس 2026-11-08).
server.close();
console.log(`\npanel-restart: ${checks.length - bad}/${checks.length} أخضر`);
process.exit(bad ? 1 : 0);
