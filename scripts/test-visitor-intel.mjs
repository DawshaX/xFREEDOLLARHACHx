#!/usr/bin/env node
/**
 * test-visitor-intel — عين الزيارات: التقاط، إثراء سلبي (GeoIP+Shodan مزيّفين)،
 * تقرير تليجرام، dedupe، وتجاهل الـprivate IPs — كل ده محلي بلا أي شبكة خارجية.
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";
import assert from "node:assert/strict";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "artifacts/api-server/.tmp-visitor.mjs";

execFileSync(
  "artifacts/api-server/node_modules/.bin/esbuild",
  ["artifacts/api-server/src/lib/ops/visitor-intel.ts", "--bundle", "--platform=node", "--format=esm", "--packages=external",
   "--outfile=" + OUT],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);

// سيرفر واحد بيلعب 3 أدوار حسب المسار: telegram / geo / shodan
const hits = { telegram: [], geo: [], shodan: [] };
const fake = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/bot")) {
      hits.telegram.push({ url: req.url, body: body ? JSON.parse(body) : {} });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url.startsWith("/geo/")) {
      hits.geo.push(req.url);
      return res.end(JSON.stringify({ status: "success", city: "Alexandria", country: "Egypt", isp: "TE Data", reverse: "host-1-2-3-4.te-data.net" }));
    }
    if (req.url.startsWith("/shodan/")) {
      hits.shodan.push(req.url);
      return res.end(JSON.stringify({ ports: [22, 80, 443], org: "Example Org", vulns: ["CVE-2024-0001", "CVE-2024-0002"] }));
    }
    res.statusCode = 404; res.end("{}");
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${fake.address().port}`;

process.env.NOVA_TELEGRAM_API_BASE = base;
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_CHAT_ID = "999000";
process.env.NOVA_GEOIP_BASE = `${base}/geo`;
process.env.NOVA_SHODAN_BASE = `${base}/shodan`;
process.env.SHODAN_API_KEY = "test-shodan-key";
process.env.NOVA_VISITOR_DEDUP_MS = "60000";

const vi = await import("../" + OUT);
const mw = vi.visitorIntelMiddleware();

function fakeReq(over = {}) {
  return {
    method: "GET",
    path: "/",
    originalUrl: "/",
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (scanner-test)", "x-forwarded-for": "1.2.3.4" },
    socket: { remoteAddress: "9.9.9.9" },
    ...over,
  };
}
const nextCalls = [];
const next = () => nextCalls.push(1);

async function waitForTelegram(n, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (hits.telegram.length >= n) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(["✓", name]); }
  catch (e) { results.push(["✗", `${name}: ${e.message}`]); }
}

await t("زيارة HTML عامة → تقرير تليجرام كامل التفاصيل (IP+مكان+متصفح+شودان)", async () => {
  vi._resetVisitorIntelForTests();
  hits.telegram.length = 0; hits.geo.length = 0; hits.shodan.length = 0;
  mw(fakeReq(), {}, next);
  assert.ok(await waitForTelegram(1), "لازم يوصل إشعار تليجرام");
  const text = hits.telegram[0].body.text;
  assert.match(text, /1\.2\.3\.4/);
  assert.match(text, /Alexandria|Egypt/);
  assert.match(text, /Mozilla\/5\.0 \(scanner-test\)/);
  assert.match(text, /CVE-2024-0001/);
  assert.equal(hits.geo.length, 1);
  assert.equal(hits.shodan.length, 1);
  assert.match(hits.shodan[0], /key=test-shodan-key/);
});

await t("dedupe: نفس الـIP جوه النافذة → مفيش إشعار تاني", async () => {
  mw(fakeReq(), {}, next);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(hits.telegram.length, 1);
});

await t("IP خاص (192.168) لا يُبلَّغ عنه أبدًا", async () => {
  hits.telegram.length = 0;
  mw(fakeReq({ headers: { accept: "text/html", "x-forwarded-for": "192.168.1.9" } }), {}, next);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(hits.telegram.length, 0);
});

await t("طلبات /api والأصول مش زيارات", async () => {
  hits.telegram.length = 0;
  vi._resetVisitorIntelForTests();
  mw(fakeReq({ path: "/api/healthz", originalUrl: "/api/healthz" }), {}, next);
  mw(fakeReq({ path: "/assets/index.js", originalUrl: "/assets/index.js" }), {}, next);
  mw(fakeReq({ headers: { accept: "application/json", "x-forwarded-for": "8.8.8.8" } }), {}, next);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(hits.telegram.length, 0);
});

await t("الرد عمره ما يتعطّل: next بيتنده فورًا مش بعد الإثراء", async () => {
  vi._resetVisitorIntelForTests();
  nextCalls.length = 0;
  hits.telegram.length = 0;
  const t0 = Date.now();
  mw(fakeReq({ headers: { accept: "text/html", "x-forwarded-for": "5.6.7.8" } }), {}, next);
  assert.equal(nextCalls.length, 1);
  assert.ok(Date.now() - t0 < 50, "الوسيط لازم يكون فوري");
});

await t("NOVA_VISITOR_ALERTS=0 يطفي كل حاجة", async () => {
  process.env.NOVA_VISITOR_ALERTS = "0";
  vi._resetVisitorIntelForTests();
  hits.telegram.length = 0;
  mw(fakeReq({ headers: { accept: "text/html", "x-forwarded-for": "7.7.7.7" } }), {}, next);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(hits.telegram.length, 0);
  delete process.env.NOVA_VISITOR_ALERTS;
});

for (const [s, n] of results) console.log(`${s} ${n}`);
fake.close();
for (const f of ["artifacts/api-server/.tmp-telegram.mjs", "artifacts/api-server/.tmp-visitor.mjs"]) {
  try { rmSync(f); } catch { /* ok */ }
}
const failed = results.filter(([s]) => s === "✗");
console.log(`\ntest-visitor-intel: ${results.length - failed.length}/${results.length} ${failed.length ? "✗" : "✓"}`);
process.exit(failed.length ? 1 : 0);
