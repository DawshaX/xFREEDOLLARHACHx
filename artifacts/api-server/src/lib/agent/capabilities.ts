/**
 * NOVA — خريطة القدرات (capability index)
 * ────────────────────────────────────────────────────────────────────────────
 * ليه الملف ده موجود: في الـtranscript الحيّ (2026-11-06 14:38) المستخدم قال
 * «تقدر تفتح متصفح وتشتغل علي ميتاسبلويت؟» — المخطّط الـLLM اخد **65 ثانية**
 * ورجّع «**مش قادرة** أفتح متصفح أو أشغل Metasploit». وفي نفس اللحظة:
 *   · المنصة فيها `ui_browse_url`/`window.open` جوه اللوحة (العميل بيفتح تاب فعلاً)،
 *   · `terminal_exec` و`tools_install` و`kali_toolbox` مسجّلين في `AGENT_TOOLS`،
 *   · و`msfconsole` فعلًا مش منصّب — ودي حاجة **قابل للقياس** في نص ثانية.
 * يعني الرد الغلط جه من اتنين: إن الكلام عن القدرة بيتولّد من خيال الموديل،
 * وإن السؤال ماحدش فكّه لأدوات. الملف ده بيقفل الاتنين:
 *   1) `matchCapabilities()` = أسماء القدرة + تحريفاتها الإملائية (عربي/إنجليزي)
 *      → الأدوات اللي بتنفّذها فعلًا (خطوات حقيقية، مش نية).
 *   2) `probe*()` = قياس حقيقي للماكينه (ملفات على القرص، مفيش shell، مفيش شبكة).
 *   3) `capabilityAnswer()` = الرد متبني على القياس، مش على نص مكتوب في الكود.
 *   4) `truthGuard()` = لو أي رد (من الموديل) بيُنكر قدرة موجودة، السطر المقاس
 *      بيتلحق بيه — نفس مبدأ `capabilityTruthLine` بس لكل القدرات مش للتنزيل بس.
 *
 * قاعدة صارمة هنا: مفيش رقم/hardcode لعدد الأدوات ولا لاسم أداة «متوفرة». كل حاجة
 * كل حاجة إما متقاسة دلوقتي، إما بتقول صراحة «مش مقاسة».
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AGENT_TOOLS } from "./tools";
import { toolchainStatus } from "../ops/toolchain";

/* ── تطبيع النص: عشان «ميتاسبلويت/ميتاسبليت/متاسبليت» كلها تبقى كلمة واحدة ── */

/**
 * Matching on Arabic used to be a fight with spelling: the same product was
 * written five ways and the regex only knew one of them — which is exactly how a
 * «تقدر تشغل ميتاسبلويت؟» question escaped the deterministic path and fell to a
 * language model that had never seen the machine. So every matcher in this file
 * runs on a normalized string: diacritics gone, أإآ→ا, ة→ه, ى→ي, ي→ي, tatweel gone,
 * latin lowered. Cost: one pass over ~200 chars. Benefit: one pattern per idea.
 */
export function normalizeArabic(s: string): string {
  return String(s ?? "")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\u200f|\u200e/g, "")
    .toLowerCase();
}

/**
 * هيكل ساكن: بنشيل حروف العلة والفواصل عشان تحريفات الاسم الواحد («ميتاسبلويت»،
 * «ميتاسبليت»، «متاسبليت») كلها تقع على إبرة واحدة. بلا كده كل تحويلة جديدة كانت
 * هتحتاج regex جديد — وده بالظبط اللي خلّى سؤال 14:38 يفلت من المسار الحتمي.
 */
export function skeleton(s: string): string {
  return normalizeArabic(s).replace(/[اويـ\s\-_.،,؛;:!?'"()\[\]]/g, "");
}

/* ── قياس المكنة (من غير shell، من غير شبكة) ───────────────────────────────── */

const KNOWN_BROWSER_BINS = ["chromium", "chromium-browser", "google-chrome", "chrome", "brave-browser", "microsoft-edge", "firefox"];
const KNOWN_MSF_PATHS = ["/usr/bin/msfconsole", "/usr/local/bin/msfconsole", "/opt/metasploit-framework/bin/msfconsole", "/usr/share/metasploit-framework/msfconsole"];
const KNOWN_MSF_DIRS = ["/usr/share/metasploit-framework", "/opt/metasploit-framework"];
const KNOWN_BURP_JARS = ["/usr/share/burpsuite/burpsuite.jar", "/opt/burpsuite/burpsuite.jar"];

function pathDirs(): string[] {
  return String(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")
    .split(path.delimiter)
    .filter(Boolean);
}

/** Look a binary up on PATH + a fixed list of extra dirs. fs only — no shell. */
export function findBinary(names: string[], extraDirs: string[] = []): string | null {
  const dirs = [...extraDirs, ...pathDirs()];
  for (const name of names) {
    for (const dir of dirs) {
      try {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isFile() && (st.mode & 0o111) !== 0) return full;
      } catch {
        /* مش موجود هنا — كمّل */
      }
    }
  }
  return null;
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export interface BrowserFacts {
  /** محركات مثبتة على المكنة دي (متقاسة من القرص). */
  engines: Array<{ name: string; path: string }>;
  /** في حد يسمع أوامر اللوحة (WebSocket clients)؟ */
  panelClients: number;
  /** مفيش محرك على السيرفر؟ التاب بيتفتح عند المستخدم في اللوحة. */
  note: string;
}

export function browserProbe(panelClients = 0): BrowserFacts {
  const engines: BrowserFacts["engines"] = [];
  for (const name of KNOWN_BROWSER_BINS) {
    const found = findBinary([name]);
    if (found) engines.push({ name, path: found });
  }
  return {
    engines,
    panelClients,
    note: engines.length
      ? `فيه محرك headless على المكنة دي (${engines.map((e) => e.name).join(" · ")}) — نقدر نصور الصفحة فعلًا.`
      : "مفيش متصفح مثبّت على المكنة دي (متقاس من PATH) — بس اللوحة اللي بتكلمني منها بتفتح التاب، فـ«افتح متصفح» مش مرفوضة، بتتحول لـ`browser_open`.",
  };
}

export interface OffensiveFacts {
  msf: { installed: boolean; at: string | null };
  burp: { installed: boolean; at: string | null };
  toolchain: { present: string[]; missing: string[]; dir: string; writable: boolean } | null;
}

export function offensiveProbe(): OffensiveFacts {
  let toolchain: OffensiveFacts["toolchain"] = null;
  try {
    const t = toolchainStatus();
    toolchain = { present: t.present, missing: t.missing, dir: t.dir, writable: t.writable };
  } catch {
    toolchain = null;
  }
  return {
    msf: { installed: !!findBinary(["msfconsole"], ["/opt/metasploit-framework/bin"]) || !!firstExisting(KNOWN_MSF_PATHS) || !!firstExisting(KNOWN_MSF_DIRS), at: firstExisting(KNOWN_MSF_PATHS) },
    burp: { installed: !!firstExisting(KNOWN_BURP_JARS), at: firstExisting(KNOWN_BURP_JARS) },
    toolchain,
  };
}

/* ── جدول القدرات: اسم القدرة ↔ تحريفاتها ↔ الأدوات اللي بتنّفذها ─────────── */

export interface CapabilityStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface Capability {
  key: string;
  /** اسم القدرة زي ما بيتقال للمستخدم في سطر التفكير. */
  label: string;
  /** بيتقاس على النص الأصلي وعلى المطبّع. */
  test: RegExp;
  /** بيتقاس على الهيكل الساكن (لأسماء اتحرفت حروف العلة فيها). */
  skel?: RegExp;
  /** الخطوات الحقيقية (ات رجعت فاضية = سؤال مش طلب). */
  steps: (msg: string, norm: string) => CapabilityStep[];
}

const URL_RE = /(https?:\/\/[^\s"'`)\]]+|www\.[^\s"'`)\]]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|dev|ai|co|gov|edu|me|app|info|biz|shop|site|online|xyz|ru|sa|eg|ae|ma|tn|uk|de|fr|jp)(?:\/[^\s"'`)\]]*)?)/i;

function grabUrl(msg: string): string | null {
  const m = String(msg ?? "").match(URL_RE);
  if (!m) return null;
  let u = m[0].replace(/[.,;:!?]+$/, "");
  if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, "")}`;
  return u;
}

export const CAPABILITIES: Capability[] = [
  {
    key: "browser",
    label: "فتح متصفح",
    // «تقدر تفتح متصفح؟» كانت بيفلتوا: الأمر كان مكتوب بأمر الفعل بس (افتح)،
    // والمستخدم بيسأل بصيغة المخاطب (تفتح). فالأمر والمضارع الاتنين في الإبرة،
    // والمفعول موسّع (متصفح/موقع/صفحة/رابط/url/تاب).
    test:
      /(?:[أا]فتحا?|افتح(?:ي|لي)?|ت?فتح|ت?فتحي|ادخ[له](?:ي)?|زو[رر](?:ي)?|رو[حه](?:ي)?|ور[يى]ني|اعرض|شغ[لّ]ل?ي?|open|navigate|browse|go\s*to)[^\n]{0,40}(?:متصفح|متصفحا|browser|كروم|chrom(?:e|ium)|firefox|موقع|صفه|صفحه|page|site|تبويب|تاب|tab|رابط|link|url|https?:\/\/)|(?:متصفح|browser)[^\n]{0,20}(?:[أا]فتح|ت?فتح|شغ[لّ])|https?:\/\/\S+[^\n]{0,24}(?:افتح|تفتح|شغ[لّ])/,
  skel: /افتح[^]{0,20}متصفح|تفتح[^]{0,20}متصفح/,
    steps: (msg) => {
      const url = grabUrl(msg);
      if (url) return [{ tool: "browser_open", args: { url } }, { tool: "web_fetch", args: { url } }];
      return [{ tool: "browser_open", args: {} }];
    },
  },
  {
    key: "kali",
    label: "أدوات كالي وميتاسبلويت",
    test: /(?:metasploit|msfconsole|msf[\s\-]?console|برب|burp|kali|كالي|tool\s?box|ادوات\s?اختراق|أدوات\s?اختراق|scanner\s?tool)/,
    // «ميتاسبلويت/ميتاسبليت/متاسبليت» كلها بتقع على الهيكل «متسبلت» — وده اللي
    // كان مفقود يوم 2026-11-06 14:38 وساب السؤال للموديل فرجّع إنكار.
    skel: /متسبلت|متسبل|msfconsole|metasploit|burpsu/,
    steps: (msg, norm) => {
      const url = grabUrl(msg);
      const target = url ? new URL(url).hostname : undefined;
      // كلمة واحدة: الدليل بيفلترب بمطابقة اسم الأداة، و«metasploit exploit» كثنائية
      // كان بيرجّع صفر — فالحاجة اللي بتقانَن هي الأداة نفسها مش جملة المستخدم.
      const q = /(?:metasploit|msf|ميتا|متسبل|بيونش|exploit)/.test(norm) ? "metasploit" : "scanner";
      const steps: CapabilityStep[] = [
        { tool: "kali_toolbox", args: { query: q, ...(target ? { target } : {}) } },
        // بحث في الفهرس الحقيقي: لو msfconsole مش منصّب، اللي يقدر يتقال هو عدد
        // الاستغلالات المكتوبة عن المنتج في NVD — وده مقاس مش منقوص.
        { tool: "exploit_search", args: { query: q } },
      ];
      if (target) steps.push({ tool: "tools_install", args: {} });
      return steps;
    },
  },
  {
    key: "free_hosts",
    label: "أماكن شغل مجانية",
    test: /(?:اجهزه? مجاني|سيرفر مجاني|استضافه? مجاني|free (?:vps|host|tier|box)|vps|منين نشغل|على ايه نشغل|جهاز بديل|مكان بديل)/,
    steps: () => [{ tool: "free_hosts", args: {} }],
  },
  {
    key: "bounty",
    label: "برامج مكافآت والإبلاغ",
    test: /(?:هاكر\s?و[اى]ن|hacker\s?one|bug ?crowd|bounty|باونتي|بلاگ|بلوغ|برنامج مكاف|مكاف|ابلاغ|ابلغ| disclosure|responsible disclosure)/,
    steps: (msg) => {
      const url = grabUrl(msg);
      const steps: CapabilityStep[] = url
        ? [{ tool: "program_discover", args: { target: new URL(url).hostname } }, { tool: "scope_check", args: { target: new URL(url).hostname } }]
        : [{ tool: "bounty_candidates", args: {} }];
      if (url) steps.push({ tool: "bounty_candidates", args: {} });
      return steps;
    },
  },
  {
    key: "fleet_map",
    label: "خريطة الأجهزة والشبكة",
    test: /(?:خريطه|خريطة|الاسطول|الأسطول|الاجهزه? اللي|devices?|fleet|الماكينة|الماكينات|انهي جهاز|اي جهاز|جهاز متصل|اللى متص?ل)/,
    steps: () => [{ tool: "fleet_list", args: {} }, { tool: "device_control_map", args: {} }],
  },
  {
    key: "powers",
    label: "القدرات المقاسة",
    test: /(?:قدراتك|اقدر اعمل|تقدر تعملي|بتقدر تعمل|powers|capabilit|ايه اللي عندك|اعمل ايه|تعمل ايه|اشغل ايه|قادر علي|قادره علي)/,
    steps: () => [{ tool: "platform_status", args: {} }],
  },
];

/**
 * فحص بالاسم، وقت الطلب — مش `new Set(AGENT_TOOLS.map(...))` على مستوى الملف.
 * اللي حصل: القراءة على مستوى الوحدة نقلت الـTDZ لدورة الاستيراد (tools →
 * platform-tools → self-model → capabilities → tools) وفجّرت bundling الاختبارات:
 * `Cannot read properties of undefined (reading 'map')`. فالقراءة بتفضل جوه الدالة
 * زي باقي الملفات.
 */
function isKnownTool(name: string): boolean {
  for (const t of AGENT_TOOLS) if (t.name === name) return true;
  return false;
}

/** القدرات اللي الطلب ده بيلمسها (على النص الأصلي + المطبّع). */
export function matchCapabilities(message: string): Capability[] {
  const msg = String(message ?? "").trim();
  if (!msg) return [];
  const norm = normalizeArabic(msg);
  const out: Capability[] = [];
  const sk = skeleton(msg);
  for (const cap of CAPABILITIES) {
    if (cap.test.test(msg) || cap.test.test(norm) || (cap.skel && cap.skel.test(sk))) out.push(cap);
  }
  return out;
}

/**
 * خطوات حقيقية للقدرات المتطابقة — ومعظم فلتر مهم: أي أداة مش في السجل الحيّ
 * بتتطرح. لو السجل اتغيّر والخطوات بقت فاضية، بنفضل نرد مقاس أحسن ما ننادي
 * أداة اسمها من خيال (نفس علة PR #216 بس للأمام).
 */
export function capabilitySteps(message: string, limit = 3): CapabilityStep[] {
  const norm = normalizeArabic(message);
  const out: CapabilityStep[] = [];
  for (const cap of matchCapabilities(message)) {
    for (const s of cap.steps(message, norm)) {
      if (!isKnownTool(s.tool)) continue;
      if (out.some((x) => x.tool === s.tool && JSON.stringify(x.args) === JSON.stringify(s.args))) continue;
      out.push(s);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function capabilityLabels(message: string): string[] {
  return matchCapabilities(message).map((c) => c.label);
}

/* ── الرد المقاس ───────────────────────────────────────────────────────────── */

/** الشكل اللي بيستخدمه core.ts — مبني من SelfModel عشان يبقى قياس دورة واحدة. */
export type CapabilityFacts = CapabilityModel;

export interface CapabilityModel {
  toolsCount: number;
  browser: BrowserFacts;
  offensive: OffensiveFacts;
}

/**
 * «تقدر تفتح متصفح وتشتغل علي ميتاسبلويت؟» — الإجابة دي مبنية على القياس اللي
 * فوق: أدوات مسجّلة + محركات على القرص + msf/burp موجودين ولا لأ + السلسلة دي.
 * مفيش فيها «لو كان…» ولا «نظريًا».
 */
export function capabilityAnswer(caps: Capability[], facts: CapabilityModel, acted: string[]): string {
  const lines: string[] = [];
  const names = caps.map((c) => c.label);
  lines.push(`سؤال عن قدرة (${names.join(" · ")}) — ردّي كله من قياس المكنة دي دلوقتي، مش من نص محفوظ:`);
  lines.push("");
  lines.push(`- **عدد أدواتى المسجّل:** **${facts.toolsCount}** (من السجل الحيّ، مش من الذاكرة).`);
  if (caps.some((c) => c.key === "browser")) {
    const eng = facts.browser.engines.length ? facts.browser.engines.map((e) => `\`${e.name}\``).join(" · ") : "مفيش محرك على السيرفر";
    lines.push(`- **المتصفح:** ${eng}. ${facts.browser.note} **العملاء اللي بيسمعوا أوامر اللوحة دلوقتي: ${facts.browser.panelClients}.**`);
  }
  if (caps.some((c) => c.key === "kali")) {
    const o = facts.offensive;
    lines.push(`- **Metasploit:** ${o.msf.installed ? `منصّب (${o.msf.at ?? "متقاس على القرص"})` : "مش منصّب على المكنة دي — متقاس من PATH والمسارات المعروفة، مش رأي"}.`);
    lines.push(`- **Burp Suite:** ${o.burp.installed ? `موجود (${o.burp.at})` : "مش موجود — وده GUI محتاج شاشة؛ مفيش نسخة headless تتشغل بالأمِر ده"}.`);
    if (o.toolchain) {
      lines.push(
        `- **سلسلة الأدوات على ${o.toolchain.dir}:** ${o.toolchain.present.length ? `الموجود ${o.toolchain.present.slice(0, 8).join(" · ")}` : "مفيش حاجة متنصّبة"}${o.toolchain.missing.length ? ` · الناقص ${o.toolchain.missing.slice(0, 6).join(" · ")} بيتنزّل بـ\`tools_install\`${o.toolchain.writable ? "" : " (المجلد مش قابل للكتابة — التنزيل هيقع)"}` : ""}.`,
      );
    } else {
      lines.push("- **سلسلة الأدوات:** حالة المكنة مرجّعتش قياس — فمش هدّعي وجود أداة ولا غيابها.");
    }
  }
  if (caps.some((c) => c.key === "free_hosts")) {
    lines.push("- **أماكن مجانية للشغل:** `free_hosts` بيرجّع الاستضافات اللي فعلًا شغّالة ومصدرها مقاس، مش قائمة اقتراحات.");
  }
  if (caps.some((c) => c.key === "bounty")) {
    lines.push("- **الصيد المسموح:** `program_discover` + `scope_check` — الفحص النشط مافيش غير بعد ما البرنامج يبقى في السكوب المصرّح بيه.");
  }
  if (caps.some((c) => c.key === "fleet_map")) {
    lines.push("- **خريطة الشبكة:** `fleet_list` + `device_control_map` — متصل مقابل مسجّل، مش رقم واحد الاتنين.");
  }
  if (acted.length) {
    lines.push("");
    lines.push(`**اللي اتنفّذ فعلًا في الرد ده:** ${acted.map((a) => `\`${a}\``).join(" + ")}`);
  }
  return lines.join("\n");
}

/* ── حارس الإنكار ──────────────────────────────────────────────────────────── */

/** أي جملة «مش قادر/مفيش/مش متاح» — اللي بتيجي من الموديل من غير قياس. */
export const DENIAL_RE =
  /(?:مش قادر|مش قادره|مش بقدر|ما[أآ]?قدرش|لا أقدر|لا اقدر|مش متاح|مش موجود(?: عندي)?|غير متاح|مالناش|مفيش أداة|مافيش أداة|لا استطيع|لا أستطيع|not able|cannot|i can'?t|unavailable)/i;

/**
 * الحارس مش بيغيّر كلام الموديل — بيضيف القياس جنبه، عشان «مش قادرة أفتح
 * متصفح» تبقى مقابلة بسطر يقول: المحرك موجود/مش موجود، واللوحة بتسمع ولا لأ.
 * لو مافيش إنكار في النص، بيرجّع النص زي ما هو (صفر overhead).
 */
export function truthGuard(text: string, facts: CapabilityModel): { text: string; guarded: boolean } {
  const t = String(text ?? "");
  if (!DENIAL_RE.test(t)) return { text: t, guarded: false };
  const add: string[] = [];
  const browsers = facts.browser.engines.length ? facts.browser.engines.map((e) => e.name).join(" · ") : "مفيش";
  add.push(`_تصحيح مقاس من المكنة دي: متصفحات على القرص = ${browsers} · عملاء اللوحة = ${facts.browser.panelClients} · أدواتى المسجّلة = ${facts.toolsCount}._`);
  add.push(
    `_Metasploit ${facts.offensive.msf.installed ? "منصّب" : "مش منصّب"} · Burp ${facts.offensive.burp.installed ? "موجود" : "مش موجود"} · سلسلة الأدوات: ${facts.offensive.toolchain ? `${facts.offensive.toolchain.present.length} موجودة / ${facts.offensive.toolchain.missing.length} ناقصة` : "غير مقاسة"}._`,
  );
  return { text: `${t.trim()}\n\n${add.join("\n")}`, guarded: true };
}

/** للوحة ولردّ الهوية: القدرات اللي للطلب ده اسم — عشان سطر التفكير يبقي مفهوم. */
export function capabilityPromptLine(facts: CapabilityModel): string {
  const o = facts.offensive;
  return [
    `**قدراى المتقاسة دلوقتي:** ${facts.toolsCount} أداة · متصفحات على المكنة: ${facts.browser.engines.length ? facts.browser.engines.map((e) => e.name).join(" · ") : "مفيش (التاب بيتفتح في لوحتك)"}`,
    ` · متصفح العملاء: ${facts.browser.panelClients} · msfconsole: ${o.msf.installed ? "منصّب" : "مش منصّب"} · burp: ${o.burp.installed ? "موجود" : "مش موجود"}`,
    o.toolchain ? ` · أدوات الأمان على المكنة: ${o.toolchain.present.join(" · ") || "مفيش"} (الناقص ${o.toolchain.missing.length}).` : "",
  ].join("");
}
