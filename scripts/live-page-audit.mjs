#!/usr/bin/env node
/**
 * live-page-audit — المدقق الحي لصفحة /kali-env على الهَب الحقيقي (TEST58).
 *
 * ليه ده موجود: المالك قال «الصفحة فيها أخطاء وكذب ومينفعش تقولي خش جرب» —
 * فالمدقق ده بيدخل الموقع فعليًا بتوكن المالك (من أسرار CI — مافيش سر في الكود)،
 * بيجرب نفس الendpoints اللي الصفحة بتندها + زر ثبت فعليًا (POST)، وبيدوّق
 * كل رد بالحرف + زمنه — والتقرير بيتكتب في state/live-page-audit.json عشان
 * يبقى دليل مقاس مش كلام.
 *
 * شغّاله: NOVA_HUB_URL=https://… NOVA_EXEC_TOKEN=… NOVA_PANEL_PASS=… node scripts/live-page-audit.mjs
 */
import fs from "node:fs";

const HUB = (process.env.NOVA_HUB_URL || "https://nova.waifly.com").replace(/\/$/, "");
const TOKEN = process.env.NOVA_EXEC_TOKEN || "";
const PANEL_PASS = process.env.NOVA_PANEL_PASS || TOKEN;
const PANEL_USER = process.env.NOVA_PANEL_USER || "Dawsha";
const T0 = Date.now();
const ms = () => Date.now() - T0;

const report = { at: new Date().toISOString(), hub: HUB, checks: [] };
function check(name, ok, detail, extra = {}) {
  report.checks.push({ name, ok: Boolean(ok), ms: ms(), detail: String(detail ?? "").slice(0, 700), ...extra });
  console.log(`${ok ? "✓" : "✗"} [${ms()}ms] ${name}: ${String(detail ?? "").slice(0, 160)}`);
}

/** GET مع التوكن — بنفس الطريقة اللي الصفحة بتندها بيها (token query) */
async function apiGet(path, budget = 60_000) {
  const t = Date.now();
  try {
    const r = await fetch(`${HUB}${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`, {
      signal: AbortSignal.timeout(budget),
    });
    const body = await r.text();
    let json = null;
    try { json = JSON.parse(body); } catch { /* مش JSON — مهم نفسه */ }
    return { status: r.status, ms: Date.now() - t, json, body: body.slice(0, 500) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t, error: e.message };
  }
}

/** POST مع التوكن — زر ثبت فعليًا */
async function apiPost(path, body, budget = 480_000) {
  const t = Date.now();
  try {
    const r = await fetch(`${HUB}${path}?token=${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nova-token": TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(budget),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* نص خام */ }
    return { status: r.status, ms: Date.now() - t, json, body: text.slice(0, 900) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t, error: e.message };
  }
}

/** دخول اللوحة زي المتصفح بالحرف: query login → كوكي → الصفحة */
async function loginAndOpenPage() {
  const t = Date.now();
  try {
    const lr = await fetch(`${HUB}/?user=${encodeURIComponent(PANEL_USER)}&pass=${encodeURIComponent(PANEL_PASS)}`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const setCookie = lr.headers.get("set-cookie") ?? "";
    const cookie = (setCookie.match(/(?:^|,\s*)([^=;]+)=[^;]*/g) ?? []).map((c) => c.trim()).join("; ") || setCookie.split(";")[0];
    const pr = await fetch(`${HUB}/kali-env`, { headers: cookie ? { cookie } : {}, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const html = await pr.text();
    const m = html.match(/assets\/(index-[^"]+\.js)/);
    const isLogin = /منطقة مقفولة|name="pass"/.test(html);
    check("login+page", pr.ok && !isLogin && Boolean(m),
      isLogin ? "الصفحة رجّعت جدار الدخول مش اللوحة" : `200 · shell=${m?.[1] ?? "?"}`,
      { loginStatus: lr.status, pageStatus: pr.status, cookieSent: Boolean(cookie), shellAsset: m?.[1] ?? null });
  } catch (e) {
    check("login+page", false, e.message);
  }
}

async function main() {
  if (!TOKEN) { console.error("✗ مافيش NOVA_EXEC_TOKEN"); process.exit(2); }

  // 1) الدخول وفتح الصفحة
  await loginAndOpenPage();

  // 2) حالة الأسطول والهَب (اللي الصفحة بتعرضه في نظرة عامة)
  const nodes = await apiGet("/api/ops/kali/nodes", 30_000);
  const hubPk = nodes.json?.hub?.packages ?? null;
  const nKali = (nodes.json?.nodes ?? []).filter((n) => n.kali).length;
  check("ops/kali/nodes", nodes.status === 200 && nodes.json?.ok === true,
    `hub.kali=${nodes.json?.hub?.kali} · hub.packages=${hubPk} · عقد كالي=${nKali}/${nodes.json?.nodes?.length ?? 0} · stats.ok=${nodes.json?.stats?.ok}/${nodes.json?.stats?.total}`,
    { hubPackages: hubPk, kaliNodes: nKali });

  const health = await apiGet("/api/kali-env/health", 40_000);
  check("kali-env/health", health.status === 200 && health.json?.readyAnywhere === true,
    `readyAnywhere=${health.json?.readyAnywhere} · fleet.kaliReady=${health.json?.fleet?.kaliReady}/${health.json?.fleet?.connected}`);

  // 3) الكتالوج المقاس — ده اللي تبويب الأدوات بيعرضه
  const tools = await apiGet("/api/kali-env/tools", 180_000);
  check("kali-env/tools", tools.status === 200 && tools.json?.ok === true && tools.json?.total > 0,
    tools.json?.ok ? `present=${tools.json.present}/${tools.json.total} · measuredOn=${tools.json.measuredOn ?? "?"}` : `${tools.status} · ${tools.json?.reason ?? tools.error ?? tools.body?.slice(0, 160)}`,
    { present: tools.json?.present ?? null, total: tools.json?.total ?? null });

  const catalog = await apiGet("/api/kali-env/catalog", 60_000);
  const cats = catalog.json?.categories ?? [];
  const tot = cats.reduce((a, c) => a + (c.tools?.length ?? 0), 0);
  const pres = cats.reduce((a, c) => a + (c.tools ?? []).filter((t) => t.present).length, 0);
  check("kali-env/catalog", catalog.status === 200 && tot > 0,
    tot > 0 ? `${pres}/${tot} عبر ${cats.length} فئة · cachedFrom=${catalog.json?.cachedFrom ?? "-"}` : `${catalog.status} · فاضي`,
    { present: pres, total: tot });

  // 4) الطرفية على طايرة العقد — أمر حقيقي
  const term = await apiPost("/api/kali-env/exec", { command: "uname -a", timeoutMs: 60_000 }, 120_000);
  check("terminal exec", term.status === 200 && /Linux/.test(term.body),
    `${term.status} · ${term.ms}ms · ${(term.body.match(/Linux[^"\\]{0,80}/) ?? [""])[0] || term.body.slice(0, 120)}`);

  // 5) زر ثبت فعليًا — أداة ناقصة مقاسة (ffuf من القايمة ✗ الحية)
  const inst = await apiPost("/api/kali-env/install", { tool: "ffuf" });
  const okInst = inst.json?.ok === true && /INSTALL_OK:/.test(inst.json?.output ?? "");
  check("install button (ffuf)", okInst,
    `${inst.status} · ${Math.round(inst.ms / 1000)}s · exit=${inst.json?.exitCode} · plane=${(inst.json?.plane ?? "?").slice(0, 60)} · ${inst.json?.output?.split("\n").slice(-3).join(" | ") ?? inst.body?.slice(0, 200)}`,
    { installOk: okInst });

  // 6) المخزن الموحد
  const store = await apiGet("/api/ops/storage-hub", 30_000);
  check("ops/storage-hub", store.status === 200 && store.json?.ok === true,
    `total=${store.json?.totalHuman} · rows=${store.json?.rows?.length ?? 0}`);

  // الخلاصة
  const fails = report.checks.filter((c) => !c.ok);
  report.ok = fails.length === 0;
  report.summary = `${report.checks.length - fails.length}/${report.checks.length} ✓${fails.length ? " · فاشل: " + fails.map((f) => f.name).join(", ") : ""}`;
  console.log(`\n${report.ok ? "✅" : "🔴"} ${report.summary}`);

  fs.mkdirSync("state", { recursive: true });
  fs.writeFileSync("state/live-page-audit.json", JSON.stringify(report, null, 2) + "\n");
  if (!report.ok) process.exit(1);
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
