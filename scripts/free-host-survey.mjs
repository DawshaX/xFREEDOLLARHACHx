#!/usr/bin/env node
/**
 * NOVA · مسح المضيفين المجانيين — قياس، مش سمعة
 * ─────────────────────────────────────────────
 * `artifacts/api-server/src/lib/ops/free-hosts.ts` فيه كتالوج المضيفين اللي
 * بيقولوا إيه عن نفسهم. الملف ده بياخد الادعاء ده ويقيسه فعليًا:
 *
 *   mode A (الأفضل): اسأل المحرك نفسه — `--url http://127.0.0.1:8080`
 *     ووراها `/api/fleet/catalogue?probe=1`. يعني نفس كود القياس بتاع
 *     الإنتاج بيتقاس من الشبكة الحقيقية (الـCI عنده مخرج، الـsandbox لأ).
 *
 *   mode B (من غير محرك): اقرأ الـ`probeUrl` من ملف الكتالوج وضرب كل واحد
 *     بنفسك. نفس القاعدة: GET واحد، تايم-اوت، فشل = سطر في التقرير مش استثناء.
 *
 * القياس معناه «موقع المورد بيردّ من هنا» — مش «التسجيل هيتم»، ومش «الخدمة
 * شغالة»، ومش ضمان استمرارية. الجملة دي بتتكتب في المخرج نفسه.
 *
 * الاستخدام:
 *   node scripts/free-host-survey.mjs --url http://127.0.0.1:8080 --out state/free-hosts.json --markdown state/free-hosts.md
 *   node scripts/free-host-survey.mjs            # من غير محرك: قياس مباشر منالملف
 *   NOVA_HUB_URL=https://… node scripts/free-host-survey.mjs   # اسأل الـhub الحي
 *
 * مافيش exit code غير صفر: المسح مش بوابة — بوابة الجودة شغل ملفات تانية.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const arg = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const ENGINE = arg("url") || process.env.NOVA_HUB_URL || process.env.AUDIT_URL || "";
const OUT = arg("out", "state/free-hosts.json");
const MD = arg("markdown", "state/free-hosts.md");
const TIMEOUT_MS = Number(process.env.SURVEY_TIMEOUT_MS || 6000);
const MEANING =
  "«reachable» = موقع المورد بيردّ من المكان اللي اتقاس منه. مش ضمان تسجيل، ولا ضمان خدمة، ولا ضمان استمرارية.";

async function get(url, ms = TIMEOUT_MS) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ms),
      redirect: "follow",
      headers: { "user-agent": "CyberNova-NOVA/2099 (free-host survey)" },
    });
    const text = await res.text().catch(() => "");
    return { ok: true, status: res.status, ms: Date.now() - t0, text };
  } catch (err) {
    return { ok: false, status: null, ms: Date.now() - t0, error: String(err?.cause?.code ?? err?.message ?? err).slice(0, 90) };
  }
}

/** mode A — the engine's own measurement, through the engine's own route. */
async function fromEngine(base) {
  const r = await get(`${base.replace(/\/+$/, "")}/api/fleet/catalogue?probe=1&force=1`, 40_000);
  if (!r.ok || !r.text) return null;
  let body = null;
  try {
    body = JSON.parse(r.text);
  } catch {
    return null;
  }
  if (!body || !Array.isArray(body.hosts)) return null;
  return body.hosts.map((h) => {
    const p = h.probe ?? null;
    return {
      id: h.id,
      name: h.name,
      ram: h.ram,
      alwaysOn: h.alwaysOn === true,
      sleeps: h.sleeps === true,
      cardRequired: h.cardRequired === true,
      nodeFit: h.nodeFit,
      usable: h.usable === true,
      scanPolicy: h.scanPolicy ?? "unknown",
      db: h.db ?? null,
      claim: typeof h.status2026 === "string" ? h.status2026.slice(0, 160) : null,
      reachable: p ? p.reachable === true : null,
      status: p ? p.status : null,
      ms: p ? p.ms : null,
      note: p ? p.note : "مفيش قياس لهذا المورد",
      probeUrl: h.probeUrl ?? null,
    };
  });
}

/** mode B — no engine: read the catalogue source and probe it ourselves. */
async function fromSource() {
  const file = path.join(ROOT, "artifacts", "api-server", "src", "lib", "ops", "free-hosts.ts");
  let src = "";
  try {
    src = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  // one pass over the HOSTS array, keeping only what a probe needs
  const entries = src.split(/\n  \{\n/).slice(1);
  const rows = [];
  for (const e of entries) {
    const pick = (key) => {
      const m = e.match(new RegExp(`\\b${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m"));
      return m ? m[1].replace(/\\"/g, '"') : null;
    };
    const id = pick("id");
    const probeUrl = pick("probeUrl");
    if (!id) continue;
    rows.push({
      id,
      name: pick("name") ?? id,
      ram: pick("ram"),
      alwaysOn: /alwaysOn:\s*true/.test(e),
      sleeps: /sleeps:\s*true/.test(e),
      cardRequired: /cardRequired:\s*true/.test(e),
      nodeFit: /nodeFit:\s*"(\w+)"/.exec(e)?.[1] ?? null,
      scanPolicy: /scanPolicy:\s*"(\w+)"/.exec(e)?.[1] ?? "unknown",
      probeUrl,
    });
    if (entries.indexOf(e) > 40) break;
  }
  const out = [];
  for (const r of rows) {
    if (!r.probeUrl) {
      out.push({ ...r, usable: !r.cardRequired && r.nodeFit !== "no", reachable: null, status: null, ms: null, note: "مفيش probeUrl — مافيش قياس", claim: null, db: null });
      continue;
    }
    const p = await get(r.probeUrl);
    out.push({
      ...r,
      usable: !r.cardRequired && r.nodeFit !== "no",
      reachable: p.ok,
      status: p.status,
      ms: p.ms,
      note: p.ok ? `ردّ HTTP ${p.status} في ${p.ms}ms` : p.error,
      claim: null,
      db: null,
    });
  }
  return out;
}

let rows = [];
let source = null;
if (ENGINE) {
  source = `engine:${ENGINE}`;
  rows = (await fromEngine(ENGINE)) ?? [];
  if (!rows.length) {
    console.log(`! المحرك ماردّش على ${ENGINE}/api/fleet/catalogue — بنزل لقياس مباشر من المصدر`);
    source = "source(fallback)";
    rows = await fromSource();
  }
} else {
  source = "source(direct)";
  rows = await fromSource();
}

const reachable = rows.filter((r) => r.reachable === true).length;
const permanentNoCard = rows.filter((r) => r.nodeFit === "permanent" && !r.cardRequired);
const report = {
  at: new Date().toISOString(),
  source,
  total: rows.length,
  reachable,
  permanent_no_card: permanentNoCard.map((r) => r.id),
  scan_forbidden: rows.filter((r) => r.scanPolicy === "forbidden").map((r) => r.id),
  meaning: MEANING,
  rows,
};

console.log(`\nCyberNova · مسح المضيفين المجانيين — ${report.at}`);
console.log(`المصدر: ${source} · ${reachable}/${rows.length} موقع بيردّ`);
console.log("─".repeat(96));
for (const r of rows) {
  const mark = r.reachable === true ? "✓" : r.reachable === false ? "✗" : "·";
  const card = r.cardRequired ? "كارت❌" : "بلاكارت";
  const fit = (r.nodeFit ?? "-").padEnd(9);
  const scan = ({ forbidden: "مسح❌", allowed: "مسح✓", unknown: "مسح؟" })[r.scanPolicy ?? "unknown"];
  console.log(
    `${mark} ${String(r.id).padEnd(22)} ${String(r.ram ?? "-").slice(0, 26).padEnd(27)} ${fit} ${card.padEnd(9)} ${scan.padEnd(6)} ${r.reachable === null ? "مقيسش" : `${String(r.status ?? "-")}/${String(r.ms ?? "-")}ms`} ${String(r.note).slice(0, 30)}`,
  );
}
console.log("─".repeat(96));
console.log(`دائم وبلا بطاقة: ${permanentNoCard.map((r) => r.id).join(" · ") || "مفيش"}`);
console.log(`ممنوع فيهم المسح النشط (شروط الاستخدام): ${report.scan_forbidden.join(" · ") || "مفيش"}`);
console.log(`⚠️  ${MEANING}`);
if (reachable === 0) console.log("::warning::كل المضيفين ماردّوش من المكان ده — غالبًا مخرج مقيد (sandbox/CI egress)، مش ضِمام إنهم ماتوا");

try {
  fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(report, null, 2) + "\n");
  console.log(`\n✓ مكتوب: ${OUT}`);
} catch (err) {
  console.log(`! ماقدرتش أكتب ${OUT}: ${err.message}`);
}

if (MD) {
  const md = [
    `# المضيفون المجانيون — آخر قياس آلي`,
    ``,
    `> اتولّد من \`scripts/free-host-survey.mjs\` (شغّله workflow \`free-host-survey.yml\`).`,
    `> **مفيش رقم هنا مقس من غير ما يضرب الموقع نفسه.**`,
    ``,
    `آخر قياس: \`${report.at}\` · المصدر: \`${source}\` · بيردّ: **${reachable}/${rows.length}**`,
    ``,
    MEANING,
    ``,
    `| المورد | رام | دائم؟ | بطاقة | نود؟ | مسح نشط | القياس |`,
    `|---|---|---|---|---|---|---|`,
    ...rows.map((r) => {
      const m = r.reachable === true ? `✓ ${r.status ?? ""} · ${r.ms ?? "?"}ms` : r.reachable === false ? `✗ ${r.note}` : "— مقسوش";
      return `| ${r.name ?? r.id} | ${r.ram ?? "—"} | ${r.alwaysOn ? "✅" : r.sleeps ? "⚠️ بينام" : "❌"} | ${r.cardRequired ? "❌ مطلوب" : "✅ بلا"} | ${r.nodeFit ?? "—"} | ${r.scanPolicy === "forbidden" ? "ممنوع في شروطهم" : r.scanPolicy === "allowed" ? "مسموح" : "مش مذكور"} | ${m} |`;
    }),
    ``,
    `## أدق تفاصيل مقاسة (ادّعاء المورد + نتيجة القياس)`,
    ``,
    ...rows.map((r) => `- **${r.name ?? r.id}** — \`${r.id}\`: ${r.claim ? String(r.claim) : "مفيش status2026 مسجل"} · القياس: ${r.note}`),
    ``,
    `## إزاي تعيد القياس`,
    ``,
    "```bash",
    "# من غير أي حاجة (قياس مباشر من الشبكة اللي أنت فيها)",
    "node scripts/free-host-survey.mjs",
    "",
    "# أو اسأل محرك شغال (نفس كود القياس بتاع الإنتاج)",
    "node scripts/free-host-survey.mjs --url http://127.0.0.1:8080",
    "",
    "# أو الـhub الحي",
    "NOVA_HUB_URL=https://<hub> node scripts/free-host-survey.mjs",
    "```",
    ``,
    flag("verbose") ? `_rows: ${JSON.stringify(rows.map((r) => r.id)).slice(0, 400)}_` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    fs.writeFileSync(path.join(ROOT, MD), md + "\n");
    console.log(`✓ مكتوب: ${MD}`);
  } catch (err) {
    console.log(`! ماقدرتش أكتب ${MD}: ${err.message}`);
  }
}
process.exit(0);
