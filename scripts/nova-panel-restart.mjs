#!/usr/bin/env node
/**
 * إشغّل/أعد تشغيل المكنة من لوحة Pterodactyl — عن بُعد، من غير ما حد يفتح اللوحة.
 *
 * ليه الملف ده موجود: قِيس يوم 2026-11-07 — الهب وقع من 20:41Z وفضل 502 أكتر من
 * تلات ساعات، والسبب إن العملية اللي بترفّع التطبيق (`start.sh` → `boot.mjs`)
 * لمّا تموت مافيش حاجة بترجّعها، والزرار الوحيد كان جوه حساب المستخدم. المسار
 * ده بيحوّل «زرار في اللوحة» لطلب HTTP واحد، فأي بوابة (GitHub Actions هنا)
 * تقدر تعملّه لوحدها كل نص ساعة.
 *
 * الوثيقة الرسمية: Pterodactyl Client API
 *   POST {panel}/api/client/servers/{id}/power   body: {"signal":"restart"}
 *   Authorization: Bearer PTSV_…  (مفتاح المستخدم من Panel → Account → API Credentials)
 *   الرد الناجح: 204 No Content — مفيش جسم خالص.
 *
 * الاستخدام:
 *   NOVA_PANEL_TOKEN=PTSV_xxx node scripts/nova-panel-restart.mjs --when-down
 *   node scripts/nova-panel-restart.mjs --signal start --strict
 *
 * الـtoken بيتقرا من البيئة بس: مابيطبعش في أي سطر، وما بيروّحش في الـargv
 * (الـargv بيتسجّل في لوجات CI).
 */
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
  options: {
    signal: { type: "string", default: "restart" },
    panel: { type: "string" },
    server: { type: "string" },
    hub: { type: "string" },
    "when-down": { type: "boolean", default: false },
    wait: { type: "string", default: "180" },
    strict: { type: "boolean", default: false },
    json: { type: "boolean", default: true },
  },
  allowPositionals: false,
});

const SIGNALS = new Set(["start", "stop", "restart", "kill"]);
const PANEL = (opt.panel || process.env.NOVA_PANEL_URL || "https://panel.waifly.com").replace(/\/+$/, "");
const SERVER = opt.server || process.env.NOVA_PANEL_SERVER || "53a7d0cb";
const HUB = (opt.hub || process.env.NOVA_HUB_URL || "https://nova.waifly.com").replace(/\/+$/, "");
const TOKEN = process.env.NOVA_PANEL_TOKEN || process.env.WAAFLY_API_KEY || "";
const WAIT_MS = Math.max(0, Number(opt.wait) || 0) * 1000;

const report = { ok: false, panel: PANEL, server: SERVER, signal: opt.signal, whenDown: !!opt["when-down"] };

function out(code) {
  if (opt.json) console.log(JSON.stringify(report));
  process.exit(code);
}

/** `/api/health` — بنقيس من التطبيق نفسه، مش من اللوحة، لأن اللوحة بتقول "running" حتى لو النود جواها ميت. */
async function health() {
  try {
    const r = await fetch(`${HUB}/api/health`, { signal: AbortSignal.timeout(15_000), headers: { "cache-control": "no-cache" } });
    const text = await r.text();
    return { code: r.status, body: text.slice(0, 160).replace(/\s+/g, " ").trim() };
  } catch (e) {
    return { code: 0, body: String(e && e.message).slice(0, 160) };
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

if (!SIGNALS.has(opt.signal)) {
  report.error = `signal لازم يكون واحد من: ${[...SIGNALS].join(", ")}`;
  out(opt.strict ? 2 : 0);
}

report.healthBefore = await health();

if (opt["when-down"] && report.healthBefore.code >= 200 && report.healthBefore.code < 300) {
  report.ok = true;
  report.skipped = "الهب بيرد 2xx أصلًا — مفيش داعي إعادة تشغيل";
  out(0);
}

if (!TOKEN) {
  report.error = "مافيش NOVA_PANEL_TOKEN في البيئة — اللوحة مابتقبلش طلب بلا مفتاح";
  out(opt.strict ? 3 : 0);
}

async function powerOnce(signal) {
  try {
    const r = await fetch(`${PANEL}/api/client/servers/${SERVER}/power`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ signal }),
      signal: AbortSignal.timeout(25_000),
    });
    const text = await r.text();
    const p = { status: r.status, ok: r.status >= 200 && r.status < 300, signal };
    // Pterodactyl بيطالع أخطاء كـ {"errors":[{"code":…,"detail":…}]} — بنسيب أول
    // 240 حرف عشان «Token mismatch» يبان، بس مافيش حاجة من الـtoken في المخرج.
    if (text && !p.ok) p.detail = text.slice(0, 240).replace(/\s+/g, " ");
    return p;
  } catch (e) {
    return { status: 0, ok: false, signal, detail: `fetch فشل: ${String(e && e.message).slice(0, 160)}` };
  }
}

let power = await powerOnce(opt.signal);
report.power = power;
if (!power.ok) out(opt.strict ? 5 : 0);

// الطلب اتقبل. لو المستخدم عايز يِتأكد، نستنى الهب يرجع — ده اللي بيمنعنا نقول
// «بعتنا الأمر» ونبقى لسّه قدام 502 بعد ساعة.
if (WAIT_MS > 0) {
  const started = Date.now();
  const deadline = started + WAIT_MS;
  // الفاصلة بتتقلّص مع الانتظار: مستخدم الـCLI عايز 3 دقايق بمراجعة كل 5 ثواني،
  // والتست بيقول --wait 2 وعايز يشوف الرد في أقل من ثانية.
  const step = Math.max(400, Math.min(5000, Math.floor(WAIT_MS / 8)));
  for (;;) {
    const h = await health();
    report.healthAfter = h;
    if (h.code >= 200 && h.code < 300) break;
    if (Date.now() >= deadline) {
      report.note = `الـpower اتقبل (${power.status}) بس الهب مالقيناوش راجع في ${opt.wait} ثانية`;
      break;
    }
    await sleep(Math.min(step, Math.max(100, deadline - Date.now())));
  }
  report.waitedMs = Date.now() - started;
}

let backUp = report.healthAfter && report.healthAfter.code >= 200 && report.healthAfter.code < 300;

// التصعيد الشجاع (2026-11-09 — الحالة المقاسة: الهب فضل 502 رغم إن الـrestart
// على لوحة Pterodactyl أحيانًا بيوصل لعملية جامدة فعلاً فـ«السيغنال» بيضيع.
// kill ينهّي العملية بالعافية وstart يفتح نضيف على آخر build — نفس أزمة
// «502 أكتر من تلات ساعات» اللي الملف ده اتعمل لأجلها.
if (!backUp && opt.signal === "restart" && WAIT_MS > 0) {
  report.escalated = "restart اتقبل وما قامش — جاري kill ثم start";
  const k = await powerOnce("kill");
  await sleep(3000);
  const st = await powerOnce("start");
  report.powerKill = k;
  report.powerStart = st;
  if (st.ok) {
    const deadline2 = Date.now() + WAIT_MS;
    const step2 = Math.max(400, Math.min(5000, Math.floor(WAIT_MS / 8)));
    for (;;) {
      const h = await health();
      report.healthAfter = h;
      if (h.code >= 200 && h.code < 300) break;
      if (Date.now() >= deadline2) { report.note = `حتى kill+start ما رجّعش في نافذة ${opt.wait} ثانية — الخطوة الجاية من اللوحة لوج/يانصيب بناء`; break; }
      await sleep(Math.min(step2, Math.max(100, deadline2 - Date.now())));
    }
    backUp = report.healthAfter && report.healthAfter.code >= 200 && report.healthAfter.code < 300;
  }
}

report.ok = Boolean(power.ok);
report.healthy = Boolean(backUp);
if (power.ok && !backUp && WAIT_MS > 0) report.note = report.note || "الأمر اشتغل والرجعة لسه 502 — احتمال الإقلاع بيتعملّه تحديث ذاتي، كمّل قياس شوية";
out(opt.strict && !backUp && WAIT_MS > 0 ? 6 : 0);
