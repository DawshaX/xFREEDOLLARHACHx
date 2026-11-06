/**
 * NOVA — reply sanitiser
 * ──────────────────────
 * A model's *thinking* is not its *answer*, and the user must never see the
 * former. Measured 2026-11-06 on the live slot, a reply to «انت عامل ايه» began:
 *
 *   «اج أدوات. هرد عليه بالعربي المصري وأقولو إني جاهز لأي مهمة. أنا تمام يا حمو…»
 *
 * That first sentence is the model narrating its own plan — a leaked reasoning
 * preamble. It reads as a broken bot, and it is the single most damaging thing
 * in the transcript because it appears *before* the real answer.
 *
 * This module removes that class of leak without touching the answer:
 *   • `reasoning` / `thinking` blocks (`<thought>…</thought>`, `Thinking:` …)
 *   • a leading plan sentence that talks *about* replying rather than replying
 *   • duplicated paragraphs (the same bubble said twice)
 *
 * It is deliberately conservative: it only strips a leading preamble, never
 * anything in the middle of a real answer, and it never returns an empty string
 * — if stripping would empty the reply, the original is kept.
 */

/** Markers a model uses to fence off its private reasoning. */
const FENCED = [
  /<thought>[\s\S]*?<\/thought>/gi,
  /<thinking>[\s\S]*?<\/thinking>/gi,
  /<reasoning>[\s\S]*?<\/reasoning>/gi,
  /```(?:thought|thinking|reasoning)[\s\S]*?```/gi,
];

/**
 * A leading sentence that describes the act of answering instead of answering.
 * Kept narrow on purpose — these are the phrasings actually observed, not a
 * general "any sentence with a verb" rule that would eat real content.
 */
const PLAN_PREAMBLE = [
  /^\s*(?:هرد|هردّ|هجاوب|هقول|لازم\s+أرد|لازم\s+ارد|المستخدم\s+بيسأل|المستخدم\s+يسأل|سأرد|سأجيب|سأقول|I(?:'| a)?m going to (?:reply|answer|respond)|I should (?:reply|answer|respond)|The user is asking|Let me (?:reply|answer|respond))[^.؟!?\n]{0,220}[.؟!?]\s*/i,
  /^\s*(?:أول\s+حاجة|اول\s+حاجة|First,?\s+I(?:'| a)?ll)[^.؟!?\n]{0,160}[.؟!?]\s*/i,
];

/** Collapse a reply that repeats itself paragraph-for-paragraph. */
function dedupeParagraphs(text: string): string {
  const parts = text.split(/\n{2,}/);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of parts) {
    const key = p.trim().replace(/\s+/g, " ");
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(p);
  }
  return kept.join("\n\n");
}

/**
 * ضبط صيغة المؤنث عن النفس.
 *
 * الـpersona بتقول «اتكلمي بصيغة المؤنث» والـmodel بيقول «أنا بخير يا بطل… أنا
 * جاهز» — يعني التعليم وحده مابيكفيش (مقاس في الـtranscript الحيّ: «أنا متحمسة»
 * في سطر و«مش قادر» في اللي بعده). الإصلاح هنا ميكانيكي وضيّق: بس الصيغ اللي
 * بترجع لمتكلمة عن نفسها، ولو قبلها «انت/أنت» بتتساب للمخاطب المذكر.
 */
/**
 * الصفات اللي بتلحق بمتكلمة عن نفسها. القاعدة مش «كل جاهز → جاهزة»: لو الصفة
 * بتتقال للمخاطب («لو انت مش قادر توصل») بتتساب — عشان كده كل استبدال بيعمل
 * check على الـ16 حرف اللي قبله.
 */
const SELF_ADJ: Array<[string, string]> = [
  ["قادر", "قادرة"],
  ["جاهز", "جاهزة"],
  ["متأكد", "متأكدة"],
  ["مستعد", "مستعدة"],
  ["متحمس", "متحمسة"],
  ["مبسوط", "مبسوطة"],
  ["شايف", "شايفة"],
  ["عارف", "عارفة"],
];
/** الصيغ اللي بتقطع الشك من غير سياق: «مش قادر» عن النفس. */
const SELF_MARK = /(?:أنا|انا|إني|اني|نفسي|بنفسى|أصبح|اصبح|بقيت|لقفت)\s*$/u;
const ADDRESSED_TO_USER = /(?:انت|أنت|انتي|أنتي|حضرتك|يا\s*\w+)\s*$/u;

function skipBecauseAddressed(before: string): boolean {
  return ADDRESSED_TO_USER.test(before);
}

export function feminizeSelfVoice(text: string): { text: string; fixed: number } {
  let out = String(text ?? "");
  let fixed = 0;
  // مفيش \b: حروف العربية مش \w في JS، فالحد بيمنع المطابقة خالص (الاتست كشف ده).
  for (const [from, to] of SELF_ADJ) {
    const re = new RegExp("(?:مش|ما|لست)\\s*" + from + "(?!ة)|(?:أنا|انا|إني|اني|بقيت|أصبحت|اصبحت)\\s+" + from + "(?!ة)", "g");
    out = out.replace(re, (match: string, ...rest: unknown[]) => {
      const offset = Number(rest[rest.length - 2] ?? 0);
      const before = out.slice(Math.max(0, offset - 16), offset);
      // السياق جوه المطابقة نفسها: «أنا جاهز» = ضمير المتكلم، «مش قادر» = صيغة
      // نفي بترجعلنا لو المخاطب ماذكرش. ماحدش بيطلب من القاعدة تقرأ ذهنه.
      const hasSelfMarker = /^(?:أنا|انا|إني|اني|بقيت|أصبحت|اصبحت)/.test(match);
      const hasNegation = /^(?:مش|ما|لست)/.test(match);
      if (hasNegation && skipBecauseAddressed(before)) return match;
      if (!hasSelfMarker && !hasNegation) return match;
      fixed += 1;
      return match.replace(from, to);
    });
  }
  return { text: out, fixed };
}

export interface SanitizeResult {
  text: string;
  /** What was removed, for the log — never shown to the user. */
  removed: string[];
}

/**
 * Strip leaked reasoning from a model reply.
 *
 * Returns the cleaned text plus a list of what was removed so the caller can
 * log it. If cleaning would leave nothing, the original text is returned
 * untouched: an ugly answer beats a blank one.
 */
export function sanitizeReply(raw: string): SanitizeResult {
  const original = String(raw ?? "");
  if (!original.trim()) return { text: original, removed: [] };

  const removed: string[] = [];
  let text = original;

  for (const re of FENCED) {
    const before = text;
    text = text.replace(re, "");
    if (text !== before) removed.push("fenced-reasoning");
  }

  // Only a *leading* preamble is stripped, and only once — a real answer that
  // happens to contain the word «هقول» further down is left alone.
  for (const re of PLAN_PREAMBLE) {
    const m = text.match(re);
    if (m) {
      text = text.slice(m[0].length);
      removed.push("plan-preamble");
      break;
    }
  }

  const deduped = dedupeParagraphs(text);
  if (deduped !== text) removed.push("duplicate-paragraph");
  text = deduped;

  text = text.replace(/^\s+/, "").replace(/\s+$/, "");

  // Never trade a real answer for an empty one.
  if (!text.trim()) return { text: original, removed: [] };

  // صوت واحد لمتكلمة واحدة: الإصلاح ده بيتعمل بعد إزالة تسريب التفكير وقبل ما
  // الرد يوصل للمستخدم، فأي مسار (موديل أو حتمي) بيمرّيه.
  const voice = feminizeSelfVoice(text);
  if (voice.fixed) {
    text = voice.text;
    removed.push(`voice:masculine→feminine (${voice.fixed})`);
  }

  return { text, removed };
}
