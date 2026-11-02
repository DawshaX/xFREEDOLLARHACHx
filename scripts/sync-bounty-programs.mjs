#!/usr/bin/env node
/*
 * sync-bounty-programs — كتالوج برامج الـbug bounty اللي NOVA تقدر تدخلها (مصادر عامة، بلا مفاتيح).
 *
 * ليه: المحرك بيرفض أي فحص نشط من غير برنامج مسجّل في `state/programs.json` — وده الصح، وده كمان
 * المكان اللي كانت فيه الحلقة بتتعلّق: المستخدم كان لازم يكتب النطاق بيده قبل ما يمشي في أي حاجة.
 * الكتالوج ده بيجيب القائمة كلها (HackerOne + Bugcrowd) من `arkadiyt/bounty-targets-data` — بيانات
 * منشورة بيحدّثها CI بتاعهم يوميًا من صفحة كل برنامج — فـ«اكتب اسم البرنامج» بقى كفاية، والـ
 * `program_discover` بيكمل منه.
 *
 * الكتالوج **مش تصريح**. كل مدخل فيه `consented:false` و`mode:"passive_only"` بطبيعته: التسجيل في
 * `state/programs.json` مع الجملة المكتوبة «I have written permission for <host>`» هو اللي بيفتح
 * الضربة النشطة، والكلام ده ما بيتعملش آليًا هنا أبدًا.
 *
 *   node scripts/sync-bounty-programs.mjs                      # تنزيل من api.github.com
 *   node scripts/sync-bounty-programs.mjs --from-file h1.json   # شغل أوفلاين (ده اللي بيتقاس بيه)
 *   node scripts/sync-bounty-programs.mjs --check               # مقارنة بالكتالوج المتتبّع + حراسة انكماش
 *المسار الافتراضي: `ops/bounty/programs-catalog.json` — متتبّع في Git عمداً، لأن `state/`
 *بيتهمل في المستودع (state/programs.json وstate/jobs/ مستثنَين) والكتالوج لازم يوصل للصفحة الساكنة.
 *   --out <path> · --max-domains <n> (افتراضي 40) · --print
 *
 * exit: 0 تمام · 1 المصدر مكسور/الانكماش أكبر من 30% · 2 ملف ناقص
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const OUT = path.resolve(ROOT, opt("out", "ops/bounty/programs-catalog.json"));
const MAX_DOMAINS = Number(opt("max-domains", "24"));
const SOURCES = [
  { platform: "hackerone", file: "hackerone_data.json" },
  { platform: "bugcrowd", file: "bugcrowd_data.json" },
];
const REPO_RAW = (file) =>
  `https://api.github.com/repos/arkadiyt/bounty-targets-data/contents/data/${file}?ref=main`;

// HackerOne بيسلّك النطاقات جوه `WILDCARD` و`URL` (مافيش asset_type اسمه DOMAIN أصلًا — مقاس
// على البيانات المنشورة: WILDCARD 2651 · URL 36715 · IP_ADDRESS 329 · CIDR 231 · والحاجات التانية
// SOURCE_CODE/GOOGLE_PLAY_APP_ID/HARDWARE...). أي صنف تاني بيتحسب «أصل مش ميزة»: باكدجات أندرويد
// زي `com.coloros.assistantscreen` بتقعد شكل نطاق لو اتقارأت بالقاعدة العامة، وده بيخلّي
// subfinder يلف في الهوا — فالباب هنا أبيض مش رمادي.
const HOST_BUCKETS = {
  WILDCARD: "wildcards",
  URL: "urls",
  IP_ADDRESS: "ips",
  CIDR: "cidrs",
  // Bugcrowd بيسمّي الأصناف بحروف صغيرة وأنواع تانية (`website`, `api`, `web app`) — كلها في الآخر
  // عنوان بيتقارأ. من غير الخرايط دي المصدر بيرجع 297 برنامج و0 هدف، وده فشل صامت.
  WEBSITE: "urls",
  API: "urls",
  WEB_APP: "urls",
  WEB: "urls",
  MOBILE_API: "urls",
  SERVER: "urls",
  DOMAIN: "domains",
  IPV4: "ips",
};
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

function hostOf(id) {
  const raw = String(id || "").trim().replace(/\*+$/g, "").replace(/\/+$/, "");
  if (!raw) return null;
  if (IPV4.test(raw)) return { kind: raw.includes("/") ? "cidrs" : "ips", host: raw.toLowerCase() };
  let work = raw;
  let pathPart = "";
  if (/^https?:\/\//i.test(work)) {
    try {
      const u = new URL(work.startsWith("http") ? work : `https://${work}`);
      work = u.hostname;
      pathPart = decodeURIComponent(u.pathname || "").replace(/\/+$/, "");
      if (pathPart === "/") pathPart = "";
    } catch {
      return null;
    }
  } else if (work.includes("/")) {
    const i = work.indexOf("/");
    pathPart = work.slice(i).replace(/\/+$/, "");
    if (pathPart === "/") pathPart = "";
    work = work.slice(0, i);
  }
  work = work.replace(/^www\./i, (m) => m); // www يفضل زي ما هو: الفرق ليه معنى في الـscope
  work = work.split(":")[0].toLowerCase();
  const wildcard = work.startsWith("*.");
  const bare = wildcard ? work.slice(2) : work;
  if (!HOST_RE.test(bare)) return null;
  if (wildcard) return { kind: "wildcards", host: bare, apex: bare, path: pathPart };
  return { kind: "urls", host: bare, path: pathPart };
}

function normalize(program, platform) {
  const ins = (program.targets && program.targets.in_scope) || program.in_scope || [];
  const buckets = { domains: [], wildcards: [], urls: [], ips: [], cidrs: [] };
  const seen = new Set();
  const sevs = new Set();
  let eligible = 0;
  let nonHostAssets = 0;
  for (const raw of ins) {
    const kind = String(raw.asset_type || raw.type || "").toUpperCase();
    if (raw.eligible_for_bounty !== false) eligible++;
    const sev = String(raw.max_severity || "").toLowerCase();
    if (sev) sevs.add(sev);
    const bucket = HOST_BUCKETS[kind];
    if (!bucket) {
      nonHostAssets++;
      continue;
    }
    const parsed = hostOf(raw.asset_identifier ?? raw.identifier ?? raw.asset ?? raw.target ?? raw.uri ?? "");
    if (!parsed) {
      nonHostAssets++;
      continue;
    }
    const push = (b, id) => {
      const key = `${b}:${id}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (buckets[b].length < MAX_DOMAINS) buckets[b].push(id);
    };
    if (parsed.kind === "wildcards") {
      push("wildcards", `*.${parsed.host}`);
      push("domains", parsed.host); // الـapex نفسه هدف مشروع للاستطلاع
    } else if (parsed.kind === "urls") {
      push("urls", parsed.path ? `${parsed.host}${parsed.path}` : parsed.host);
      push("domains", parsed.host);
    } else {
      push(parsed.kind, parsed.host);
    }
  }
  let handle = String(program.handle || program.id || "").trim();
  if (!handle && program.url) {
    // bugcrowd مالهوش handle: بنشتق الـslug من الرابط (…/engagements/<slug>)
    try {
      const parts = new URL(program.url).pathname.split("/").filter(Boolean);
      handle = String(parts[parts.length - 1] || "").trim();
    } catch {
      handle = "";
    }
  }
  if (!handle) return null;
  const eff = program.response_efficiency_percentage;
  const avg = program.average_time_to_bounty_awarded;
  const avgNum = typeof avg === "number" ? avg : Number(avg);
  return {
    handle,
    name: String(program.name || handle),
    platform,
    url: String(program.url || `https://hackerone.com/${handle}`),
    bounties: program.offers_bounties === true || Number(program.max_payout) > 0,
    max_payout_usd: Number.isFinite(Number(program.max_payout)) && Number(program.max_payout) > 0
      ? Number(program.max_payout)
      : null,
    safe_harbor: program.safe_harbor ? String(program.safe_harbor).toLowerCase() : null,
    disclosure: program.allows_disclosure === true || program.has_bounty === true ? true : program.allows_disclosure === false ? false : null,
    swag: program.offers_swag === true,
    managed: program.managed_program === true || program.managed_by_bugcrowd === true,
    paused: /paused|closed|out_of_scope/i.test(String(program.submission_state || "")),
    submission_state: String(program.submission_state || "").slice(0, 40) || null,
    response_efficiency: typeof eff === "number" ? Math.round(eff) : null,
    avg_hours_to_bounty: Number.isFinite(avgNum) && avgNum > 0 ? Math.round(avgNum / 3_600_000) : null,
    severities: [...sevs].sort(),
    asset_total: ins.length,
    eligible_assets: eligible,
    non_host_assets: nonHostAssets,
    ...buckets,
    // الكتالوج معلومة عامة — مش إذن. الفحص النشط بيبدأ من state/programs.json بعد جملة الإذن المكتوبة.
    consented: false,
    mode: "passive_only",
  };
}

async function loadSource(src, index) {
  const fromFile = opt("from-file", "");
  if (fromFile) {
    const tmpl = fromFile.includes("{file}") ? fromFile : index === 0 ? fromFile : "";
    if (!tmpl) {
      // بصوت عالي: مصدر اتساب مش مصدر اتكرّر بملف غلط
      return { skipped: `متجاهَل (--from-file بدون قالب {file} بيطبّق على المصدر الأول بس)` };
    }
    const p = path.resolve(ROOT, tmpl.replace("{file}", src.file));
    if (!fs.existsSync(p)) {
      console.error(`✗ --from-file: الملف مش موجود: ${p}`);
      process.exit(2);
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  const url = REPO_RAW(src.file);
  const headers = { accept: "application/vnd.github.raw+json", "user-agent": "CyberNova-NOVA/2099 (bounty catalog sync)" };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (err) {
    // fetch بينجح على GitHub Actions لكن بيفشل في شبكات فيها proxy/تصفية DNS من نوع تاني
    // (مقاس: صندوق التطوير بيعرف يوصل api.github.com بـcurl وبيفشل بـnode fetch).
    // السقوط لـcurl مش رفاهية — هو اللي بيخلّي السكربت يتقاس في أي بيئة قبل ما ينشر.
    try {
      const out = execFileSync(
        "curl",
        ["-fsSL", "--max-time", "150", "-H", `accept: ${headers.accept}`, "-H", `user-agent: ${headers["user-agent"]}`, url],
        { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
      );
      console.warn(`⚠ fetch فشل (${String(err.message || err).slice(0, 40)}) — سقطنا لـcurl وجايب ${src.file}`);
      return JSON.parse(out);
    } catch (err2) {
      throw new Error(`fetch: ${String(err.message || err).slice(0, 40)} · curl: ${String(err2.message || err2).slice(0, 60)}`);
    }
  }
}

function summarize(rows) {
  return {
    programs: rows.length,
    bounty_programs: rows.filter((r) => r.bounties).length,
    active_programs: rows.filter((r) => !r.paused).length,
    programs_with_domains: rows.filter((r) => r.domains.length || r.wildcards.length).length,
    domains: rows.reduce((s, r) => s + r.domains.length, 0),
    wildcards: rows.reduce((s, r) => s + r.wildcards.length, 0),
  };
}

const rows = [];
const perSource = [];
for (const [i, src] of SOURCES.entries()) {
  let data;
  try {
    data = await loadSource(src, i);
  } catch (err) {
    // المصدر واحد من اتنين: لو فيه كتالوج متتبّع بنكمل عليه ونقولها، مش بنسيب الحلقة عمياء.
    if (!fs.existsSync(OUT)) {
      console.error(`❌ sync-bounty-programs: ماقدرناش نجيب ${src.file}: ${String(err.message || err).slice(0, 120)}`);
      process.exit(1);
    }
    console.warn(`⚠ تعذّر تنزيل ${src.file} (${String(err.message || err).slice(0, 60)}) — بنستخدم الكتالوج الموجود ونقولها`);
    perSource.push({ platform: src.platform, ok: false, error: String(err.message || err).slice(0, 120) });
    continue;
  }
  if (data && data.skipped) {
    perSource.push({ platform: src.platform, ok: false, skipped: data.skipped });
    console.warn(`⚠ ${src.platform}: ${data.skipped}`);
    continue;
  }
  if (data && !Array.isArray(data)) {
    console.error(`❌ ${src.file}: الرد مش array (شكل المصدر اتغيّر) — ماننشرش كتالوج ناقص في صمت`);
    process.exit(1);
  }
  const mine = data.map((p) => normalize(p, src.platform)).filter(Boolean);
  if (data.length && !mine.length) {
    console.error(
      `❌ ${src.platform}: جيبنا ${data.length} برنامج وما اتطبّع ولا واحد — المصدر غيّر شكله.\n` +
      `   الفشل هنا أحسن من كتالوج نصّه صامت: الخطط هتتبنى على منصة ناقصة وتقول «مفيش أهداف».`,
    );
    process.exit(1);
  }
  rows.push(...mine);
  perSource.push({ platform: src.platform, ok: true, raw: data.length, kept: mine.length });
}

const byHandle = new Map();
for (const r of rows) {
  const k = `${r.platform}:${r.handle}`;
  if (!byHandle.has(k)) byHandle.set(k, r);
}
const programs = [...byHandle.values()].sort(
  (a, b) => Number(b.bounties) - Number(a.bounties) || b.asset_total - a.asset_total || a.handle.localeCompare(b.handle),
);

const catalog = {
  schema: "cybernova.bounty-catalog/1",
  source: "arkadiyt/bounty-targets-data (بيانات منشورة لبرامج HackerOne/bugcrowd، بيتحدّث يوميًا بـCI صاحبهم)",
  sources: perSource,
  fetched_at: new Date().toISOString(),
  counts: summarize(programs),
  // الكتالوج ده للاستطلاع والخطط. مافيش فيه برنامج «نشِط»: النشاط بيبدأ من state/programs.json
  // بعد جملة الإذن المكتوبة، والكود ده ما بيكتبش في الملف ده نهائيًا.
  programs,
};

if (flag("check")) {
  if (!fs.existsSync(OUT)) {
    console.error("❌ --check: مفيش كتالوج متتبّع نقارن بيه (شغّل المزامنة الأول واcommit النتيجة)");
    process.exit(2);
  }
  const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const before = (prev.counts && prev.counts.programs) || 0;
  const after = catalog.counts.programs;
  const problems = [];
  if (!before) problems.push("الكتالوج المتتبّع ملوش counts.programs — شكله اتكسر");
  if (after < before * 0.7) problems.push(`انكماش ${before} → ${after} (أكتر من 30%) — المصدر غيّر شكله ولا الموقع اتقفل`);
  if (after === 0) problems.push("الكتالوج الجديد فاضي خالص");
  if (!catalog.counts.programs_with_domains) problems.push("ولا برنامج فيه نطاق واحد — مستحيل نبني عليه خطة");
  if (problems.length) {
    console.error("❌ --check فشل:\n" + problems.map((p) => `  · ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(`✅ --check: ${after} برنامج (كان ${before}) · ${catalog.counts.programs_with_domains} ليهم نطاقات`);
  process.exit(0);
}

if (!programs.length) {
  console.error("❌ مفيش ولا برنامج اتحوّل لنطاقات — المصدر اتغير. مانشيلش الكتالوج القديم بفراغ.");
  process.exit(1);
}

const body = JSON.stringify(catalog, null, flag("compact") ? 0 : 1);
if (flag("print")) console.log(body);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body + "\n");
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(
  `✅ ${path.relative(ROOT, OUT)} — ${catalog.counts.programs} برنامج (${catalog.counts.bounty_programs} فيه bounty، ` +
    `${catalog.counts.active_programs} مش موقوف) · ${catalog.counts.domains} نطاق + ${catalog.counts.wildcards} wildcard · ${kb} KB`,
);
console.log(`   المصادر: ${perSource.map((s) => `${s.platform}:${s.ok ? `${s.kept}/${s.raw}` : "فشل"}`).join(" · ")}`);
