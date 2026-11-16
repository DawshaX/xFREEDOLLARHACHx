#!/usr/bin/env node
/**
 * audit-api-freshness.mjs — بوابة الوهم الدائمة (TEST46)
 * ════════════════════════════════════════════════════════════════════════════
 * قِيس 2026-11-16 (جولة 10:30Z): 112 نداء في الواجهة × 493 راوتر → 17 نداء ميت
 * (محرر ريجستري كامل + مدير ملفات + شات) كانت بتترجع 404 أو بيلتقطها fallback
 * وهمي. العطل اتصلح، والبوابة دي بتمنع تكراره: أي نداء في الواجهة مالوش راوتر
 * حي (مقطع-بمقطع + method) = الدمج بيتوقف هنا قبل ما يوصل للهَب.
 *
 * الmethod بيستنتج من شكل النداء: fetch بإسناد body/POST→POST · EventSource→GET ·
 * غير ذلك GET. الراوترات بتتقرا من artifacts/api-server/src/routes/*.ts.
 * مسموح بالاستثناء المعلن فقط: WHITELIST (نداء بيرجع 404 عمدًا كاختبار).
 */
import fs from "node:fs";
import path from "node:path";
import { globSync } from "node:fs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PANEL = path.join(ROOT, "artifacts/kali-panel/src");
const SERVER = path.join(ROOT, "artifacts/api-server/src/routes");

const WHITELIST = new Set([
  // مافيش استثناءات حاليًا — أي استثناء لازم ي documented هنا بسبب حقيقي
]);

/** نداءات الواجهة: fetch/opsFetch + EventSource مع المسار والmethod المستنتجة */
function collectCalls() {
  const calls = new Map(); // "METHOD path" → [files]
  const files = [...globSync(`${PANEL}/**/*.tsx`), ...globSync(`${PANEL}/**/*.ts`)];
  const fetchRe = /(?:fetch|opsFetch)\(\s*[`"']((?:\$\{API\}|\/api\/)[^`"'?]*)(?:\?[^`]*)?[`"']/g;
  const methodRe = /method:\s*["']([A-Z]+)["']/g;
  const esRe = /new EventSource\(\s*[`"']((?:\$\{API\}|\/api\/)[^`"'?]*)/g;
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    // EventSource = GET دايمًا
    for (const m of s.matchAll(esRe)) add(calls, "GET", m[1], rel);
    // fetch: الmethod لازم يكون جوه نفس الاستدعاء — النافذة بتقفل عند أول
    // fetch/EventSource تاني (قِيس 10:20Z: نافذة ثابتة كانت بتسرق POST من
    // النداء اللي بعده وبتحرج GET حي كزر ميت — عدل البوابة قبل عدل الكود).
    const anchors = [...s.matchAll(/(?:fetch|opsFetch)\(|new EventSource\(/g)].map((m) => m.index);
    for (const m of s.matchAll(fetchRe)) {
      const next = anchors.find((a) => a > m.index + m[0].length) ?? m.index + 400;
      const after = s.slice(m.index, Math.min(next, m.index + 400));
      const mm = methodRe.exec(after);
      add(calls, mm ? mm[1].toUpperCase() : "GET", m[1], rel);
    }
  }
  return calls;
}
function add(map, method, rawPath, file) {
  const p = rawPath.replace("${API}", "/api").replace(/\/$/, "");
  if (!p.startsWith("/api/")) return;
  const key = `${method} ${p}`;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(file);
}

/** الراوترات الحية من routes/*.ts */
function collectRoutes() {
  const routes = [];
  for (const f of fs.readdirSync(SERVER).filter((x) => x.endsWith(".ts"))) {
    const s = fs.readFileSync(path.join(SERVER, f), "utf8");
    for (const m of s.matchAll(/router\.(get|post|put|delete|patch)\(\s*(?:\[[^\]]*\])?\s*["']([^"']+)["']/g)) {
      routes.push({ method: m[1].toUpperCase(), path: m[2] });
    }
  }
  return routes;
}

/** مطابقة صارمة: مقاطع النداء لازم تكون بادئة لمقاطع الراوتر (مع :param) */
function matches(method, callPath, route) {
  if (method !== route.method && !(method === "GET" && route.method === "GET")) return false;
  const c = callPath.replace("/api/", "").split("/").filter(Boolean);
  const r = route.path.replace(/^\/+/, "").split("/:")[0].split("/").filter(Boolean);
  if (c.length < r.length) return false;
  for (let i = 0; i < r.length; i++) if (c[i] !== r[i]) return false;
  return true;
}

const calls = collectCalls();
const routes = collectRoutes();
const dead = [];
for (const [key, files] of calls) {
  const [method, p] = key.split(" ");
  if (WHITELIST.has(key)) continue;
  const hit = routes.some((r) => matches(method, p, r));
  if (!hit) dead.push({ key, files: [...files] });
}

if (dead.length) {
  console.error(`✗ [api-freshness] ${dead.length} نداء في الواجهة مالوش راوتر حي (زر ميت):`);
  for (const d of dead) console.error(`   ✗ ${d.key}  ← ${d.files.join(", ")}`);
  console.error("   الصح: أضف الراوتر الحقيقي أو صلّح المسار — مافيش صفحة بزوار ميتة.");
  process.exit(1);
}
console.log(`✓ [api-freshness] ${calls.size} نداء في الواجهة كلها ليها راوتر حي (${routes.length} مسار) — مافيش زر ميت.`);
