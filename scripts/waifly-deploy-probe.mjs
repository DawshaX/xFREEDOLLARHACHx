#!/usr/bin/env node
/*
 * waifly-deploy-probe — «هل الهَب شغّال بآخر بنية اتنشرت فعلًا؟» — مقاس من runner.
 *
 * العطل المقاس (2026-11-05 على سلوت Waifly الحي): الأبديتر قال «installed» تلات مرات،
 * build.json على الديسك اتحدث… والعملية الشغالة فضلت بتجاوب بكود أقدم — لأن الreload
 * ماحصلش. uptime-watchdog بيعيد التشغيل بس لما الهَب يقع خالص؛ الثغرة دي (تشغيل قديم
 * والهَب صاحي) هي اللي خلت المالك يشوف ‎/kali-env «زي ما هي» بعد تلات بناءات متتالية.
 *
 * ما بيعمله (كل ده من runner — عقد GitHub بتوصل nova.waifly.com، السانبوكس لا):
 *   1) يقرا updatedAt لأصل nova-24-7.zip من الإصدار nova-portable (api.github.com).
 *   2) يقرا /api/nova-core/version من الهَب → build (الديسك) + boot (الكود الشغال) + stale.
 *   3) يقرا /api/nova-core/auto-update → حالة الأبديتر نفسه (تشخيص بلا تخمين).
 *   4) لو الكود الشغال أقدم من آخر بنية:
 *        a) POST /api/nova-core/auto-update  → يجبر الأبديتر يسحب ويسطب آخر بنية الآن.
 *        b) لسه قديم؟ POST /api/nova-core/restart (و?force=1 لو مافيش مشرف) → المُشرف
 *           يقلع العملية بالكود الجديد اللي على الديسك.
 *        c) يقيس تاني كل 5ث لحد 60ث ويسجل bootAfter.
 *   5) يكتب state/waifly-deploy.json — مرآة مكتبوكة في المستودع: الصفحة ‎/kali-env
 *      بتقراها بfetch مباشر وتعرضها للمالك («🚀 حالة النشر») — الإثبات بيشوفه عينه.
 *      TEST31b: الباندل نفسه بيشحن نسخة من المرآة جوّه public/state/ (fallback
 *      لو raw وقع) — build-standalone.mjs، أُغلق hollow-ship (بوابة مقاس 43/43).
 *
 * مافيش أي سر في المخرج: التوكن بيتبعت هيدر بس، والJSON بيقول حالات مش قيم سرية.
 */
import fs from "node:fs";
import path from "node:path";

const REPO = process.env.NOVA_RELEASE_REPO || "DawshaX/xFREEDOLLARHACHx";
const TAG = process.env.NOVA_RELEASE_TAG || "nova-portable";
const HUB = (process.env.NOVA_HUB_URL || "https://nova.waifly.com").replace(/\/$/, "");
const TOKEN = (process.env.NOVA_EXEC_TOKEN || "").trim();
const GH = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const OUT = process.argv[2] || "state/waifly-deploy.json";

const HEADERS = { "user-agent": "nova-deploy-probe", ...(TOKEN ? { "x-nova-token": TOKEN } : {}) };

async function j(url, opts = {}, timeout = 20_000) {
  try {
    const r = await fetch(url, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) }, signal: AbortSignal.timeout(timeout) });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* نرد نص مقصوص */ }
    return { status: r.status, ok: r.ok, body, text: text.slice(0, 400) };
  } catch (e) {
    return { status: 0, ok: false, body: null, text: String((e && e.message) || e).slice(0, 200) };
  }
}

const result = {
  at: new Date().toISOString(),
  hub: HUB,
  reachable: false,
  asset: null,
  disk: null,
  boot: null,
  stale: null,
  updater: null,
  updaterInstall: null,
  restartHttp: null,
  action: "none",
  bootAfter: null,
  fresh: null,
  notes: [],
};

// 1) آخر بنية منشورة
const rel = await j(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, {
  headers: { authorization: `Bearer ${GH}`, accept: "application/vnd.github+json" },
});
const asset = rel.body?.assets?.find((x) => x.name === "nova-24-7.zip");
if (asset) result.asset = { updatedAt: asset.updated_at, size: asset.size };
else result.notes.push(`مافيش أصل nova-24-7.zip في الإصدار ${TAG} (HTTP ${rel.status})`);

// 2) بنية الهَب الحية
const v = await j(`${HUB}/api/nova-core/version`);
result.reachable = v.ok;
if (v.ok) {
  result.disk = v.body?.build ?? null;
  result.boot = v.body?.boot ?? null;
  result.stale = v.body?.stale ?? null;
} else {
  result.notes.push(`version HTTP ${v.status} · ${v.text.slice(0, 120)}`);
}

// 3) حالة الأبديتر (تشخيص — مش ادعاء)
const au = await j(`${HUB}/api/nova-core/auto-update`);
result.updater = au.ok
  ? {
      enabled: au.body?.enabled ?? null,
      lastResult: au.body?.lastResult ?? null,
      lastDetail: String(au.body?.lastDetail ?? "").slice(0, 180),
      lastCheckAt: au.body?.lastCheckAt ?? null,
      currentBuiltAt: au.body?.currentBuiltAt ?? null,
      latestReleaseAt: au.body?.latestReleaseAt ?? null,
      restartNeeded: au.body?.restartNeeded ?? null,
    }
  : { http: au.status };

// 4) الحسم
const bootAt = Date.parse(result.boot?.builtAt || "") || 0;
const assetAt = Date.parse(result.asset?.updatedAt || "") || 0;
const MIN_DELTA = 120_000; // نفس تسامح الأبديتر — بنية أقدم من دقيقتين بتفضل «نفس البناء»
const bootBehindAsset = assetAt > 0 && bootAt > 0 && assetAt - bootAt > MIN_DELTA;

if (result.reachable && (result.stale === true || bootBehindAsset)) {
  result.action = "update+restart";
  const inst = await j(`${HUB}/api/nova-core/auto-update`, { method: "POST" }, 150_000);
  result.updaterInstall = { status: inst.status, lastResult: inst.body?.lastResult ?? null, detail: String(inst.body?.lastDetail ?? inst.text).slice(0, 220) };

  const v2 = await j(`${HUB}/api/nova-core/version`);
  const boot2 = Date.parse(v2.body?.boot?.builtAt || "") || 0;
  const stillStale = v2.body?.stale === true || (assetAt > 0 && boot2 > 0 && assetAt - boot2 > MIN_DELTA);
  if (stillStale) {
    let rs = await j(`${HUB}/api/nova-core/restart`, { method: "POST" });
    if (rs.status === 409) rs = await j(`${HUB}/api/nova-core/restart?force=1`, { method: "POST" });
    result.restartHttp = rs.status;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const v3 = await j(`${HUB}/api/nova-core/version`, {}, 10_000);
      if (v3.ok) {
        result.bootAfter = v3.body?.boot ?? null;
        if ((Date.parse(v3.body?.boot?.builtAt || "") || 0) > bootAt) { result.action = "restarted_ok"; break; }
      }
    }
    if (result.action !== "restarted_ok") result.action = "restart_requested";
  } else {
    result.action = "updated_ok";
  }
} else if (result.reachable) {
  result.action = "fresh";
} else {
  result.action = "unreachable"; // السقوط الكامل — uptime-watchdog بيمسكه بخطوة الطاقة بتاعته
}

result.fresh = result.action === "fresh" || result.action === "updated_ok" || result.action === "restarted_ok";

// 5) الصفحة المسervة نفسها: status + كاش الهيدر + اسم الasset المقصوص (الshell اللي المتصفح بياخده)
try {
  const r = await fetch(`${HUB}/kali-env`, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  const html = await r.text();
  const assetMatch = /(?:src|href)="([^"]*\/assets\/[A-Za-z0-9_.-]+\.(?:js|css))"/.exec(html);
  result.page = {
    status: r.status,
    cacheControl: r.headers.get("cache-control") || null,
    servedAsset: assetMatch ? assetMatch[1] : null,
    htmlBytes: html.length,
  };
} catch (e) {
  result.page = { error: String((e && e.message) || e).slice(0, 120) };
}

// 6) الأسطول الحي — عدّ العقد المسجلة فعلًا على الهَب (TEST32): الowner يسأل
// «الـ19 عقدة فين؟» فالمرآة بتجيب الرقم من الهَب نفسه مش من jobs API.
try {
  const r = await fetch(`${HUB}/api/local-agent/agents`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  const b = await r.json().catch(() => null);
  result.fleet = {
    status: r.status,
    count: (b && b.count) ?? null,
    ids: b && Array.isArray(b.agents) ? b.agents.map((a) => a.id).slice(0, 45) : null,
  };
} catch (e) {
  result.fleet = { error: String((e && e.message) || e).slice(0, 120) };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({ action: result.action, fresh: result.fresh, boot: (result.bootAfter || result.boot)?.builtAt ?? null, asset: result.asset?.updatedAt ?? null, mirror: OUT }),
);
