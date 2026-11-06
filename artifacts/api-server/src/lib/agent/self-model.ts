/**
 * NOVA — Self-model: what she is allowed to claim about herself.
 * ──────────────────────────────────────────────────────────────
 * Measured 2026-11-05 from a real chat transcript on the live slot:
 *
 *   أنت: انت مين
 *   نوفا: أنا نوفا، كيان ذكي وشريك أمني داخل منصة CyberNova.
 *
 *   أنت: تقدر تحمل أدوات؟            ← سؤال عن قدراتها الحقيقية
 *   [ bubble فاضي ]                   ← لا رد، ولا سبب
 *
 *   أنت: طب متبحث عالنت عن طرق مجانية وضيف انت
 *   نوفا: ممكن توضح لي بالضبط إيه اللي عايز أبحث عنه؟
 *
 * التلات مشاكل مش مشكلة «ذكاء النموذج» — دي مشكلة إن **مفيش وصف حقيقي للذات**
 * في الـprompt: عدد أدوات مكتوب باليد («33») بينما المسجّل 47، وقدرات مكتوبة
 * كنص ثابت مش من الحالة الفعلية، فالردود بتبقى عامة، ولما السؤال يخص قدرة
 * موجودة (بحث ويب/جلب صفحات) النموذج مش شايفها فيسأل المستخدم بدل ما ينفّذ.
 *
 * القاعدة هنا: كل رقم في الـprompt بيتقاس وقت النداء من نفس الوحدات اللي
 * بتنفّذ فعلاً. لو حاجة مش متاحة، الـprompt بيقول إنها مش متاحة — عشان
 * «مش قادر» تبقى إجابة، بدل سؤال رجعي للمستخدم.
 */

import { AGENT_TOOLS } from "./tools";
import { loadServers } from "../server-registry";
import { getConnectedAgentList } from "../../routes/local-agent";
import { corpusStatus } from "../ops/vuln-corpus";
import { memoryStats } from "./memory-store";
import { KINDS } from "../ops/tools";
import { getCorpusStats } from "../cyber-corpus-2099";
import { toolchainStatus, VENDORABLE } from "../ops/toolchain";
import { localBuild } from "../auto-update";

export interface SelfModel {
  tools: { count: number; names: string[]; byCategory: Record<string, number> };
  /**
   * `registered` = entries in the persisted server registry (a list of hosts we
   * know about). `connected` = agents with a LIVE WebSocket right now.
   *
   * These are different quantities and conflating them is exactly what produced
   * the false «3 ماكينة» on the live slot: the registry had three hosts, the
   * fleet had zero connected agents, and the reply quoted the first as if it
   * were the second. Both are reported, separately, always.
   */
  machines: { registered: number; names: string[]; connected: number; connectedNames: string[] };
  corpus: { measured: boolean; total: number; ageMin: number | null };
  /**
   * The static knowledge index — a different quantity from `corpus`.
   * `totalIndexedKnowledgeItems` is what the persona and the tool descriptions
   * quote as «3,300+ نمط»; without it in the model the guard had nothing to
   * check that number against, so a stale or invented pattern count could pass.
   */
  patterns: { total: number };
  memory: { total: number; pinned: number };
  opsKinds: number;
  /**
   * البصمة اللي بتكلّمك منها دلوقتي، من `build.json` جوه الحزمة.
   * اللي حصل: المستخدم بيقارن رقم في الشات بمستودع أحدث ويحكم على البرنامج
   * بالكذب — بينما الرقم كان صحيحًا للبناء اللي لسه شغّال (قِيس 2026-11-06:
   * `#216` اتدمج 00:12:49Z والردّ 00:14:17Z طلع من البناء اللي قبله).
   * فالردّ نفسه بقى يقول هو بتكلم من أنهي نسخة ومن قد إيه، والفرق يبقى مقاس مش جدل.
   */
  build: { commit: string | null; builtAt: string | null; ageMin: number | null; label: string };
  /**
   *الأدوات الأمنية الحقيقية على المكنة دي — مقاسة من القرص. بدونها النموذج بيكرر
   * جملة «مالوش أدوات تثبيت» وهو اللي يقدر ينزّلهم بنفسه.
   */
  securityTools: { present: string[]; missing: string[]; provisionable: boolean; writable: boolean; scriptFound: boolean };
  /** Things she can genuinely do right now, phrased as actions. */
  canDo: string[];
  /** Things that are honestly not available in this build. */
  cannotDo: string[];
}

/** بصمة البناء اللي شغّال دلوقتي — `null` لو النسخة أقدم من نظام البصمة. */
function buildStamp(): { commit: string | null; builtAt: string | null; ageMin: number | null; label: string } {
  const b = localBuild();
  const ms = b?.builtAt ? Date.parse(b.builtAt) : NaN;
  return {
    commit: b?.commit ?? null,
    builtAt: b?.builtAt ?? null,
    ageMin: Number.isFinite(ms) ? Math.max(0, Math.round((Date.now() - ms) / 60_000)) : null,
    label: b?.commit ? b.commit.slice(0, 7) : "بلا بصمة",
  };
}

/** Everything here is measured at call time — nothing is typed from memory. */
export function buildSelfModel(): SelfModel {
  const names = AGENT_TOOLS.map((t) => t.name);
  const byCategory: Record<string, number> = {};
  for (const t of AGENT_TOOLS) {
    const cat = String((t as { category?: string }).category ?? "core");
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  let servers: Array<{ name: string }> = [];
  try {
    servers = loadServers();
  } catch {
    servers = [];
  }

  // Live agents — a WebSocket that is open RIGHT NOW. This is the number the
  // fleet page shows, and the only one that may be quoted as "connected".
  let connected: Array<{ hostname: string }> = [];
  try {
    connected = getConnectedAgentList();
  } catch {
    connected = [];
  }

  let corpus = { measured: false, total: 0, ageMin: null as number | null };
  try {
    const c = corpusStatus();
    corpus = { measured: c.measured, total: c.total, ageMin: c.ageMin };
  } catch {
    /* a corpus that cannot be read is reported as unmeasured, never as 0 rows */
  }

  let memory = { total: 0, pinned: 0 };
  try {
    const m = memoryStats();
    memory = { total: m.total, pinned: m.pinned };
  } catch {
    /* memory unavailable */
  }

  let patterns = { total: 0 };
  try {
    patterns = { total: getCorpusStats().totalIndexedKnowledgeItems };
  } catch {
    /* an index that cannot be read is reported as 0, never guessed */
  }

  let opsKinds = 0;
  try {
    opsKinds = Object.keys(KINDS).length;
  } catch {
    opsKinds = 0;
  }

  let securityTools = { present: [] as string[], missing: [...VENDORABLE] as string[], provisionable: false, writable: false, scriptFound: false };
  try {
    const tc = toolchainStatus();
    securityTools = {
      present: tc.present,
      missing: tc.missing,
      provisionable: tc.scriptAvailable && tc.writable,
      writable: tc.writable,
      scriptFound: tc.scriptAvailable,
    };
  } catch {
    /* القياس مابيتكسرش الـprompt — بنقوله «مش مقاس» ونبقى صريحين في السطر */
  }

  const canDo: string[] = [
    `تشغيل ${AGENT_TOOLS.length} أداة حقيقية مسجّلة باسمها (القائمة كاملة تحت)`,
    opsKinds ? `إنشاء وتشغيل ${opsKinds} نوع عملية على برامج مصرّح بها (ops)` : "تسجيل برامج وتشغيل عمليات مصرّح بها",
    corpus.measured
      ? `البحث في ${corpus.total.toLocaleString("en-US")} ثغرة حقيقية (NVD + KEV + EPSS) من داخل المنصة`
      : "البحث في فهرس الثغرات (لسه مش متزامن — البحث هيقول «مفيش بيانات» بصراحة)",
    "جلب صفحات ومواقع حقيقية من النت وقراءتها (web_fetch) — البحث والتحليل مش تخمين",
    securityTools.present.length
      ? `أدوات أمنية حقيقية منصوبة على المكنة دي ومقيسة: ${securityTools.present.join(" · ")}`
      : securityTools.provisionable
        ? `تجهّزي أدواتك بنفسك بأداة \`tools_install\` (نسخ ثابتة من GitHub في \`vendor/bin\` — ${securityTools.missing.length} أداة ناقصة)`
        : "مافيش أدوات أمنية على المكنة دي، وتنزيلها مش متاح من هنا — الاستطلاع السلبي والـHTTP بس",
    "جلب ملفات GitHub وقراءة مستودعاتها",
    "الذاكرة الطويلة: تحفظ وتسترجع عبر الجلسات",
    // The fleet line reports BOTH numbers, because they answer different
    // questions and quoting one as the other is the false claim this file
    // exists to prevent.
    connected.length
      ? `${connected.length} جهاز متصل **الآن** بالأسطول (${connected.slice(0, 4).map((a) => a.hostname).join(" · ")}) — التنفيذ عليهم متاح فورًا`
      : servers.length
        ? `الأسطول فيه ${servers.length} ماكينة **مسجّلة** في السجل، بس **صفر جهاز متصل الآن** — التنفيذ بيتفتح لحظة اتصال وكيل`
        : "الأسطول جاهز لكن مفيش ماكينة مسجّلة ولا متصلة — إضافة ماكينة بتفتح تنفيذ الأوامر عليها",
  ];

  const cannotDo: string[] = [
    // الجملة كانت مطلقة («مااقدرش أثبّت حاجة») وهي اللي بتخلي النموذج يقف
    // ويِسأل المستخدم. التثبيت الثقيل (Kali/Burp/root) فعلاً مش مقدور، لكن
    // النسخ الثابتة بتتنزّل من غير root — فنقول المقاس، مش الانطباع.
    securityTools.provisionable
      ? `تثبيت Kali أو Burp Suite (مافيش root/mount على الاستضافة) — بس النسخ الثابتة (${securityTools.missing.join(", ") || "كلها موجودة بالفعل"}) تتنزّل بـ\`tools_install\``
      : "تثبيت أدوات على السيرفر نفسه: مافيش root، وتنزيل النسخ الثابتة مش متاح هنا كمان (`vendor/bin` مش قابل للكتابة أو السكربت مش في الحزمة)",
    "تشغيل Metasploit أو Burp Suite على السيرفر اللي أنا شغالة عليه",
    "الوصول لأي جهاز غير متصل بالوكيل",
    "اختراق أو مهاجمة هدف غير مصرّح به",
  ];

  return {
    build: buildStamp(),
    tools: { count: AGENT_TOOLS.length, names, byCategory },
    machines: {
      registered: servers.length,
      names: servers.map((s) => s.name),
      connected: connected.length,
      connectedNames: connected.map((a) => a.hostname),
    },
    corpus,
    patterns,
    memory,
    opsKinds,
    securityTools,
    canDo,
    cannotDo,
  };
}

/**
 * The block injected into every system prompt.
 *
 * Written in Arabic because that is the language of the conversation, and
 * phrased as rules rather than a brochure: the model tends to answer capability
 * questions from whatever text is nearest, so the text must be the truth.
 */
export function selfModelPrompt(model: SelfModel = buildSelfModel()): string {
  const toolList = model.tools.names.map((n) => `\`${n}\``).join(" · ");
  // The can-do lines about the corpus and the fleet are re-derived from the
  // model passed in, so an override (a test, or a caller with fresh numbers)
  // can never produce a prompt that contradicts itself — e.g. «192,930 ثغرة»
  // in one line and «غير مقاس» in the next.
  const derived = model.canDo.filter((c) => !/ثغرة|ماكينة/.test(c));
  const corpusLine = model.corpus.measured
    ? `البحث في ${model.corpus.total.toLocaleString("en-US")} ثغرة حقيقية (NVD + KEV + EPSS) من داخل المنصة`
    : "البحث في فهرس الثغرات (لسه مش متزامن — البحث هيقول «مفيش بيانات» بصراحة)";
  const fleetLine = model.machines.connected
    ? `${model.machines.connected} جهاز متصل **الآن** بالأسطول${(model.machines.connectedNames ?? []).length ? ` (${(model.machines.connectedNames ?? []).slice(0, 4).join(" · ")})` : ""} — التنفيذ عليهم متاح فورًا`
    : model.machines.registered
      ? `الأسطول فيه ${model.machines.registered} ماكينة **مسجّلة** في السجل، بس **صفر جهاز متصل الآن** — التنفيذ بيتفتح لحظة اتصال وكيل`
      : "0 ماكينة مسجّلة ولا متصلة — الأسطول جاهز، وإضافة ماكينة بتفتح تنفيذ الأوامر عليها";
  return [
    "# من أنت الآن — مقاس، مش مكتوب",
    `- أدواتك الحقيقية: **${model.tools.count}** أداة (${toolList}). كل أداة بتنفّذ فعلاً؛ لو أداة فشلت بتقول فشلت وليه.`,
    `- الذاكرة: ${model.memory.total} ذكرى محفوظة (${model.memory.pinned} مثبتة) — تفضل بعد إعادة التشغيل.`,
    `- الأسطول: ${model.machines.connected ?? 0} جهاز متصل الآن · ${model.machines.registered} ماكينة مسجّلة في السجل${(model.machines.connectedNames ?? []).length ? ` (متصل: ${(model.machines.connectedNames ?? []).slice(0, 4).join(" · ")})` : ""}. **ممنوع تقولي «متصل» على المسجّل — دول رقمين مختلفين.**`,
    // Measured 2026-11-06: asked «انت مين», the reply opened with «3 ماكينة
    // مسجّلة في الأسطول» — a true number, but the wrong one to lead with, and
    // the human read it as a lie because the page showed one connected node.
    // The rule is now explicit: the connected count is the headline, the
    // registry is a footnote, and the two are never merged into one sentence.
    `- **لما حد يسألك «انت مين» أو «عندك كام جهاز»: ابدئي بعدد المتصل (${model.machines.connected ?? 0}) — ده الرقم اللي بيتنفّذ عليه فعلاً. رقم السجل (${model.machines.registered}) تذكريه بعده وبكلمة «مسجّلة» بس، ومتجمعيهمش في رقم واحد.**`,
    `- الكوربوس: ${model.corpus.measured ? `${model.corpus.total.toLocaleString("en-US")} ثغرة حقيقية، آخر مزامنة قبل ${model.corpus.ageMin} دقيقة` : "غير مقاس حالياً"}.`,
    model.opsKinds ? `- طبقة التنفيذ (ops): ${model.opsKinds} نوع عملية مسجّل.` : "- طبقة التنفيذ: غير متاحة في هذه النسخة.",
    // السطر ده هو اللي بيمنع جملة «مالوش أدوات» من إنها تتكرر بعد التجهيز:
    // بيتقرا من القرص في نفس اللحظة، مش من نص مكتوب.
    `- أدواتك الأمنية على المكنة: ${model.securityTools.present.length ? `منصوبة ومقيسة (${model.securityTools.present.join(", ")})` : model.securityTools.provisionable ? `ناقصاه (${model.securityTools.missing.join(", ")}) — تنزّلها بـ\`tools_install\`` : "مش منصوبة ومش قادر أنزّلها هنا"}.`,
    `- مجلد \`vendor/bin\`: ${model.securityTools.writable ? "قابل للكتابة ✓" : "مش قابل للكتابة ✗"}.`,
    "",
    "# تقدري تعملي إيه فعلاً (استخدمي دي لما حد يسأل «تقدر تعمل إيه»)",
    ...[corpusLine, fleetLine, ...derived].map((c) => `- ${c}`),
    "",
    "# مش مقدور عليه — تقوليه بصراحة ومن غير لف",
    ...model.cannotDo.map((c) => `- ${c}`),
    "",
    "# قاعدة السؤال الرجعي",
    "- لو الطلب ينفع يتنفّذ بأداة موجودة، **نفّذيه** — ما تسأليش «تقصد إيه؟».",
    "- السؤال الوحيد المسموح: لو مفيش هدف/نطاق والأداة لازماه، اسألي عن الهدف بس، بسطر واحد.",
    "- لما تقولي «مش قادرة»، اذكري السبب الحقيقي والبديل المتاح في نفس الجملة.",
  ].join("\n");
}
