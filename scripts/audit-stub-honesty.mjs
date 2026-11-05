#!/usr/bin/env node
/**
 * CyberNova — Stub Honesty Audit
 * ────────────────────────────────────────────────────────────────────────────
 * `artifacts/api-server/src/routes/stubs.ts` starts with the comment “These
 * provide sensible empty responses so the UI loads without errors”. That is a
 * double-edged tool: a path that nothing else serves either *admits* it is not
 * wired, or it *pretends* something happened. Pretending is what this gate
 * kills, because a UI that flips a toggle to “on” on `{ok:true}` is a lie the
 * operator cannot see.
 *
 * What it checks (measured against the real mount order in routes/index.ts):
 *   1. shadow-classification — a stub path answered earlier by a real router
 *      is DEAD (harmless, but reported); a stub path nothing else serves is
 *      LIVE, i.e. it is what the product actually says to the caller.
 *   2. live-claim        — a LIVE stub that answers a state-changing request
 *      (POST/PUT/PATCH/DELETE) with `ok: true` and no admission (`notWired`,
 *      `not_wired`, `error:`, a real await) → violation.
 *   3. live-status-lie   — a LIVE stub that reports `active/started/killed/enabled: true`
 *      with no work behind it (no await/awaited call in the body) → violation.
 *   4. shadow-import     — nothing may import `src/lib/lib/*` (measured dead
 *      duplicates: audit, logger, nova-cron, nova-cve-monitor,
 *      nova-learner-lite, ws-hub — the live ones sit one level up).
 *
 * Usage:  node scripts/audit-stub-honesty.mjs [--json] [--selftest]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = path.join(ROOT, "artifacts/api-server/src/routes");
const API_SRC = path.join(ROOT, "artifacts/api-server/src");
const STUB_FILE = path.join(ROUTES, "stubs.ts");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const selftest = args.includes("--selftest");

const VERB_RE = /(?:^|[^A-Za-z])(?:router|app)\.(get|post|put|delete|patch|all)\s*\(\s*["'`]([^"'`]+)["'`]/g;

function readSrc(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

/** pull every `router.<verb>("path", …)` handler with its body text */
export function handlersOf(src) {
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    VERB_RE.lastIndex = 0;
    const m = VERB_RE.exec(lines[i]);
    if (!m) continue;
    const verb = m[1].toUpperCase();
    const pth = m[2];
    // الجسم: من نفس السطر لحد توازي الأقواس (بيكفي لأي handler في stubs.ts)
    let body = lines[i].slice(m.index + m[0].length);
    if (!body.includes("});") && !/;\s*\)\s*;\s*$/.test(body)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
        body += "\n" + lines[j];
        if (/^\}\);/.test(lines[j]) || /\}\s*\)\s*;/.test(lines[j])) break;
      }
    }
    out.push({ verb, path: pth, line: i + 1, body });
  }
  return out;
}

/** mount order + prefixes from routes/index.ts */
export function mountOrder(indexSrc) {
  const lines = indexSrc.split("\n");
  const fileOf = new Map();
  for (const line of lines) {
    const m = line.match(/import\s+([A-Za-z0-9_$]+)\s+from\s+["']\.\/([A-Za-z0-9._-]+)["']/);
    if (m) fileOf.set(m[1], m[2].endsWith(".ts") ? m[2] : `${m[2]}.ts`);
  }
  const order = [];
  lines.forEach((line, i) => {
    const withPrefix = line.match(/router\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z0-9_$]+)\s*\)/);
    const bare = withPrefix ? null : line.match(/router\.use\(\s*([A-Za-z0-9_$]+)\s*\)/);
    const name = withPrefix ? withPrefix[2] : bare?.[1];
    if (!name) return;
    order.push({ name, file: fileOf.get(name) ?? null, prefix: withPrefix ? withPrefix[1] : "", line: i });
  });
  return { order, fileOf };
}

/** `/notifications/:id/read` و`/notifications/:notificationId/read` نفس الشيء عند Express */
export function pathKey(verb, pth) {
  const norm = pth.split("/").map((seg) => (seg.startsWith(":") || seg.startsWith("*") ? "*" : seg)).join("/");
  return `${verb} ${norm}`;
}

export function classify({ stubHandlers, realByKey, stubLine }) {
  const live = [];
  const dead = [];
  for (const h of stubHandlers) {
    const owner = realByKey.get(pathKey(h.verb, h.path)) ?? realByKey.get(pathKey("ALL", h.path));
    if (owner && owner.line < stubLine) dead.push({ ...h, servedBy: owner.file });
    else live.push(h);
  }
  return { live, dead };
}

const ADMITS = /notWired|not_wired|not wired|notImplemented|error\s*:|reasonAr|res\.status\((4|5)\d\d\)/;
const WORK = /\bawait\b|\bthen\s*\(|import\s*\(|\.findIndex\(|\.splice\(|\.push\(|\.set\(|\.delete\(|=\s*(true|false)|exec\w*\(|spawn\w*\(|run[A-Z]/;

export function violationsOf(liveHandlers) {
  const v = [];
  for (const h of liveHandlers) {
    const claims = /\bok:\s*true\b/.test(h.body);
    const statusLie = /\b(active|started|killed|enabled|running|connected):\s*true\b/.test(h.body);
    if (!claims && !statusLie) continue;
    if (ADMITS.test(h.body)) continue; // بيعترف أنه مش موصول → أمانة
    const mutating = h.verb !== "GET" && h.verb !== "HEAD";
    const doesWork = WORK.test(h.body);
    if (mutating && (claims || statusLie) && !doesWork) {
      v.push({ kind: claims ? "live-claim" : "live-status-lie", ...h, why: "بيردّ نجاح على طلب تغيير حالة من غير ما يغيّر حاجة" });
    } else if (!mutating && statusLie && !doesWork) {
      v.push({ kind: "live-status-lie", ...h, why: "بيقال للحالة active/started:true من غير مصدر" });
    }
  }
  return v;
}

function shadowImports() {
  const bad = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (p.includes(`${path.sep}lib${path.sep}lib${path.sep}`)) continue;
      const src = readSrc(p);
      const re = /from\s+["']([^"']*)["']/g;
      let m;
      while ((m = re.exec(src))) {
        if (/\/lib\/lib\/|["']\.\/lib\/(audit|logger|ws-hub|nova-cron)/.test(m[1])) {
          bad.push({ file: path.relative(ROOT, p), spec: m[1] });
        }
      }
    }
  };
  walk(API_SRC);
  return bad;
}

function run() {
  const indexSrc = readSrc(path.join(ROUTES, "index.ts"));
  if (!indexSrc) return { ok: false, error: "routes/index.ts مقروءش" };
  const { order } = mountOrder(indexSrc);
  const stubMount = order.find((o) => o.file === "stubs.ts");
  const stubLine = stubMount ? stubMount.line : Number.MAX_SAFE_INTEGER;
  const realByKey = new Map();
  for (const m of order) {
    if (!m.file || m.file === "stubs.ts") continue;
    const src = readSrc(path.join(ROUTES, m.file));
    for (const h of handlersOf(src)) {
      const full = `${m.prefix}${h.path}`.replace(/\/{2,}/g, "/");
      for (const k of new Set([pathKey(h.verb, full), pathKey("ALL", full)])) {
        if (!realByKey.has(k)) realByKey.set(k, { file: m.file, line: m.line });
      }
    }
  }
  const stubHandlers = handlersOf(readSrc(STUB_FILE));
  const { live, dead } = classify({ stubHandlers, realByKey, stubLine });
  const violations = violationsOf(live);
  const imports = shadowImports();
  const ok = violations.length === 0 && imports.length === 0;
  return { ok, totals: { mounts: order.length, stubs: stubHandlers.length, dead: dead.length, live: live.length }, violations, imports, live };
}

function runSelftest() {
  const cases = [
    { name: "POST ok:true من غير شغل", body: `router.post("/x", (_req, res) => { res.json({ ok: true, active: true }); });`, must: true },
    { name: "POST بيعترف إنه مش موصول", body: `router.post("/x", (_req, res) => { res.json({ ok: false, notWired: true, error: "not_wired" }); });`, must: false },
    { name: "POST بيعمل شغل فعلاً", body: `router.post("/x", async (_req, res) => { const r = await trip(); res.json({ ok: true, r }); });`, must: false },
    { name: "GET status ملفّق", body: `router.get("/x", (_req, res) => { res.json({ active: true }); });`, must: true },
    { name: "GET فاضي", body: `router.get("/x", (_req, res) => { res.json([]); });`, must: false },
  ];
  let failed = 0;
  for (const c of cases) {
    const hs = handlersOf(c.body);
    const v = violationsOf(hs.map((h) => ({ ...h })));
    const caught = v.length > 0;
    if (caught !== c.must) { failed++; console.log(`✗ selftest: ${c.name} — اتوقعنا ${c.must ? "إمساك" : "هدوء"} وطلع ${caught ? "إمساك" : "هدوء"}`); }
  }
  const mo = mountOrder(`import aRouter from "./alpha";\nimport stubsRouter from "./stubs";\nrouter.use("/p", aRouter);\nrouter.use(stubsRouter);\n`);
  const keys = new Map([[pathKey("GET", "/p/x"), { file: "alpha.ts", line: 2 }]]);
  const cls = classify({ stubHandlers: [{ verb: "GET", path: "/p/x", line: 9, body: "" }], realByKey: keys, stubLine: 3 });
  if (cls.dead.length !== 1) { failed++; console.log("✗ selftest: البادج بمقابلش المسار المركّب"); }
  // :param لازم يتقابل — من غيره الفاحص يصرخ في ستاب ميت (اتلمس على /notifications/:id/read)
  const pk = new Map([[pathKey("POST", "/notifications/*/read"), { file: "notifications.ts", line: 5 }]]);
  const c2 = classify({ stubHandlers: [{ verb: "POST", path: "/notifications/:id/read", line: 9, body: "res.json({ ok: true })" }], realByKey: pk, stubLine: 20 });
  if (c2.dead.length !== 1 || c2.live.length !== 0) { failed++; console.log("✗ selftest: :param مبيتقابلش صح"); }
  if (mo.order.length !== 2) { failed++; console.log("✗ selftest: ترتيب التركيب اتقرا غلط"); }
  console.log(failed === 0 ? "✓ selftest — الحقن الخمس + البادج متصحيحهم" : `✗ selftest: ${failed} حالة فاشلة`);
  process.exit(failed === 0 ? 0 : 1);
}

if (selftest) runSelftest();
else {
  const r = run();
  if (asJson) { console.log(JSON.stringify({ ok: r.ok, totals: r.totals, violations: (r.violations ?? []).map((v) => ({ kind: v.kind, verb: v.verb, path: v.path, line: v.line })), imports: r.imports }, null, 2)); process.exit(r.ok ? 0 : 1); }
  if (r.error) { console.log(`✗ ${r.error}`); process.exit(1); }
  console.log(`stubs.ts: ${r.totals.stubs} handler · ميت (متغطّى من راوتر حقيقي قبله): ${r.totals.dead} · لايف (اللي بيردّ فعلاً): ${r.totals.live}`);
  for (const v of r.violations) console.log(`✗ ${v.kind}  ${v.verb} ${v.path}  (stubs.ts:${v.line}) — ${v.why}`);
  for (const i of r.imports) console.log(`✗ shadow-import  ${i.file} → ${i.spec} (نسخة ظلّ ميتة)`);
  if (r.ok) { console.log("✅ audit-stub-honesty — مفيش ستاب لايف بيدّعي نجاح، ومفيش استيراد لطبقة الظل"); process.exit(0); }
  console.log(`\nالإصلاح: خلي المسار ده ياخد راوتر حقيقي يتركّب قبل الـstubs، يا ردّ {ok:false, notWired:true, error:"not_wired", reasonAr, howAr}.`);
  process.exit(1);
}
