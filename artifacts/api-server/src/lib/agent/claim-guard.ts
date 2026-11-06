/**
 * NOVA — Claim Guard (منع الادّعاء)
 * ────────────────────────────────────────────────────────────────────────────
 * Measured 2026-11-05 from a real transcript on the live slot:
 *
 *   أنت: انت مين
 *   نوفا: ... و**3** ماكينة مسجّلة في الأسطول (Waifly · Paris FR01 · Waifly · HTTPS · Codespace الرئيسي)
 *
 * while `GET /api/fleet/mesh` at that same moment said `machines.connected: 0`.
 * The number was not invented by the model — it was *registered* machines, a
 * different quantity, quoted as if it were the live fleet. The human read a
 * confident number and had no way to know it was not measured.
 *
 * This module is the last stop before the screen. It reads the numbers a reply
 * claims about the platform and compares them with the numbers measured *right
 * now* from the same units the platform itself uses. When a claim exceeds the
 * measurement, the reply is not silently rewritten (that would hide the model's
 * mistake) — a measured correction block is appended, so the human always ends
 * up with the true number and can see that a correction happened.
 *
 * Design rules
 *   • Only *over*-claims are flagged. Saying "0 machines" when there are 0 is
 *     correct; saying "3" when there are 0 is not.
 *   • Nothing is deleted from the reply — the guard is additive, like every
 *     other change in this branch.
 *   • Every number in the correction comes from `buildSelfModel()`, which reads
 *     the live registries. The guard never types a number of its own.
 */

import { buildSelfModel, type SelfModel } from "./self-model";

export type ClaimKind = "fleet" | "tools" | "corpus" | "memory" | "patterns";

export interface ClaimViolation {
  kind: ClaimKind;
  /** The number the reply asserted. */
  claimed: number;
  /** The number measured at this instant. */
  actual: number;
  /** The matched phrase, for the log line. */
  phrase: string;
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Arabic-Indic digits → ASCII, so «٣ ماكينات» is read like «3 ماكينات». */
function normaliseDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

function parseNum(raw: string): number | null {
  const t = normaliseDigits(raw).replace(/[,\s\u00a0]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Strip the markdown emphasis that sits *between* a number and its unit.
 *
 * Measured 2026-11-06 on the live slot: the reply said «**3** ماكينة مسجّلة»
 * while `/api/fleet/mesh` said `connected: 1`. The guard did not fire — not
 * because the rule was wrong, but because the model bolds its numbers and the
 * `**` between `3` and `ماكينة` broke the `\d+\s*unit` match. A guard that a
 * formatting habit can switch off is not a guard, so emphasis is removed before
 * matching. Only `*`, `_` and backticks are touched; the reply itself is never
 * modified.
 */
function stripEmphasis(s: string): string {
  return s.replace(/[*_`]/g, "");
}

/**
 * Every "N <unit>" pair in the text, for one unit family.
 *
 * The unit alternation is deliberately narrow: it must not match a number that
 * belongs to something else (a port, a CVE year, a percentage). Only the nouns
 * that name a platform quantity are listed.
 */
function claimsFor(text: string, unit: string): Array<{ n: number; phrase: string }> {
  const out: Array<{ n: number; phrase: string }> = [];
  const re = new RegExp(`(\\d[\\d,\\s\\u00a0]{0,12})\\s*(?:${unit})`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseNum(m[1]);
    if (n !== null) out.push({ n, phrase: m[0].trim() });
  }
  return out;
}

const FLEET_UNIT =
  "ماكينة|ماكينات|ماكنة|ماكنات|جهاز|أجهزة|اجهزة|عقدة|عقد|نود|node|nodes|machine|machines|device|devices";
const TOOL_UNIT = "أداة|اداة|أدوات|ادوات|tool|tools";
const CORPUS_UNIT = "ثغرة|ثغرات|ثغرات|vulnerabilit(?:y|ies)|cve|cves|advisories";
const MEMORY_UNIT = "ذكرى|ذكريات|ذاكرة|memory|memories";
/**
 * The static knowledge index is a *different* quantity from the live CVE corpus:
 * the corpus stats' `totalIndexedKnowledgeItems` counts the synthesised patterns
 * (primitives × surfaces × phases) plus the bundled tool/project lists, while
 * `corpus.total` counts rows pulled from NVD/KEV/EPSS. Measured 2026-11-06 the
 * reply said «3354 نمط» — a real number, but the guard had no unit for it, so it
 * was never checked against anything. It is checked now, against its own source.
 */
const PATTERN_UNIT = "نمط|أنماط|انماط|pattern|patterns";

/**
 * Compare the numbers a reply claims with the numbers measured now.
 *
 * `model` may be passed in so a caller that already built a self-model for this
 * turn (the agent does) does not pay for a second measurement — and so the
 * correction can never disagree with the answer it is correcting.
 */
export function auditClaims(text: string, model: SelfModel = buildSelfModel()): ClaimViolation[] {
  const t = stripEmphasis(normaliseDigits(String(text ?? "")));
  if (!t) return [];
  const violations: ClaimViolation[] = [];

  const check = (kind: ClaimKind, unit: string, actual: number) => {
    for (const c of claimsFor(t, unit)) {
      if (c.n > actual) violations.push({ kind, claimed: c.n, actual, phrase: c.phrase });
    }
  };

  // The fleet is the one that was actually wrong on the live slot: the reply
  // quoted *registered* machines while the page showed *connected* ones.
  check("fleet", FLEET_UNIT, model.machines.connected);
  check("tools", TOOL_UNIT, model.tools.count);
  check("corpus", CORPUS_UNIT, model.corpus.measured ? model.corpus.total : 0);
  check("patterns", PATTERN_UNIT, model.patterns.total);
  check("memory", MEMORY_UNIT, model.memory.total);

  return violations;
}

/** One measured line per violated kind, in the conversation's own language. */
function correctionLines(violations: ClaimViolation[], model: SelfModel): string[] {
  const kinds = new Set(violations.map((v) => v.kind));
  const lines: string[] = [];
  if (kinds.has("fleet")) {
    lines.push(
      model.machines.connected > 0
        ? `- الأسطول المتصل **الآن**: ${model.machines.connected} جهاز${model.machines.connectedNames.length ? ` (${model.machines.connectedNames.slice(0, 4).join(" · ")})` : ""}.`
        : `- الأسطول المتصل **الآن**: صفر جهاز — مفيش عقدة مسجّلة لحظيًا (المسجّل في السجل حاجة تانية، مش اتصال حيّ).`,
    );
  }
  if (kinds.has("tools")) lines.push(`- أدواتي المسجّلة **الآن**: ${model.tools.count} أداة.`);
  if (kinds.has("corpus")) {
    lines.push(
      model.corpus.measured
        ? `- فهرس الثغرات **الآن**: ${model.corpus.total.toLocaleString("en-US")} ثغرة (آخر مزامنة قبل ${model.corpus.ageMin} دقيقة).`
        : `- فهرس الثغرات **الآن**: غير مقاس — مش هدّعي برقم.`,
    );
  }
  if (kinds.has("patterns")) lines.push(`- فهرس المعرفة الثابت **الآن**: ${model.patterns.total.toLocaleString("en-US")} نمط.`);
  if (kinds.has("memory")) lines.push(`- ذاكرتي **الآن**: ${model.memory.total} ذكرى محفوظة.`);
  return lines;
}

export interface GuardedReply {
  text: string;
  violations: ClaimViolation[];
}

/**
 * Append a measured correction when the reply over-claimed.
 *
 * Returns the reply unchanged (and an empty violation list) when every number
 * was within the measurement — the common case, and the one that must stay
 * byte-identical so the guard never adds noise to a correct answer.
 */
export function enforceClaims(text: string, model: SelfModel = buildSelfModel()): GuardedReply {
  const violations = auditClaims(text, model);
  if (violations.length === 0) return { text, violations };
  const lines = correctionLines(violations, model);
  if (lines.length === 0) return { text, violations };
  const block = [
    "",
    "---",
    "**⚠️ تصحيح مقاس (من المنصة نفسها، مش من دماغي):**",
    ...lines,
    "_الأرقام اللي فوق اتقاسوا لحظة الرد. أي رقم أكبر من دول كان محفوظ أو غلط — القياس هو المرجع._",
  ].join("\n");
  return { text: `${text}${block}`, violations };
}
