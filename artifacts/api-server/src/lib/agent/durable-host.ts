/**
 * «المكنة دي هي المكنة الدايمة ولا نسخة بتخلص الشغل وتتمسح؟»
 * ────────────────────────────────────────────────────────────────────────────
 * الحالة (ذاكرة نوفا + الأدوات الناقصة) ليها مصدر واحد: صف في Supabase و`vendor/bin`
 * على حاوية وايفي. اللي يفعّل الكتابة في المصدر ده بالافتراضي لازم يكون المكنة
 * اللي الحالة بتاعتها هي الأصل — لا CI ولا Codespace ولا تشغيل محلي: دول كل واحد
 * فيهم نسخة لحظية، ولو كتبوا بالافتراضي همّ يمسحوا نسخة المكنة الحقيقية.
 *
 * القياس اللي جبّر الوظيفة دي: بعد تفعيل المِرور بـ `NOVA_SUPERVISED` بس، الـlive
 * audit (CI + تشغيل محلي) لاقى الحزمة بتولّع `boot.mjs` اللي بيحط المتغير ده،
 * فكتب صف `nova_memory` بـ«Audit marker» سجلين بدل 20 سجل المكنة (متقاس
 * 2026-11-07 17:01:20Z من القاعدة نفسها). `NOVA_SUPERVISED` وحده مش كفاية.
 *
 * القاعدة: مُشرَّف + مكان الحالة هو `/home/container` (القياس الحيّ: `boot.dir` من
 * `/api/nova-core/version`) + مفيش متغيرات CI. `NOVA_EPHEMERAL_STATE=1` بيطفي
 * لأي ظرف، و`=0` بيفعّله للاختبارات اللي شغالة في مجلد مؤقت ومتحتاجة تتحايل
 * على شرط المجلد — بس مش على CI: متغيرات CI لها الأولوية دايماً.
 */
import path from "node:path";

/** حاويات Pterodactyl (وايفلّي/سيلي) شغالة كلها من `/home/container`. */
export const DURABLE_ROOT = "/home/container";

const CI_KEYS = ["GITHUB_ACTIONS", "CI", "CODESPACES", "TF_BUILD", "GITLAB_CI"];

function truthy(v: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(String(v ?? "").trim());
}

export function isDurableHost(env: NodeJS.ProcessEnv = process.env): boolean {
  if (CI_KEYS.some((k) => truthy(env[k]))) return false;
  if (env.NOVA_EPHEMERAL_STATE === "1") return false;
  if (env.NOVA_SUPERVISED !== "1") return false;
  if (env.NOVA_EPHEMERAL_STATE === "0") return true;
  const root = String(env.NOVA_STATE_DIR ?? "").trim() || process.cwd();
  const abs = path.resolve(root);
  return abs === DURABLE_ROOT || abs.startsWith(`${DURABLE_ROOT}/`);
}

/** سبب الرفض — للوجوقات، عشان «مافيش مِرور» متبقاش لغز على المكنة. */
export function durableHostWhy(env: NodeJS.ProcessEnv = process.env): string {
  const hit = CI_KEYS.find((k) => truthy(env[k]));
  if (hit) return `CI: ${hit}`;
  if (env.NOVA_EPHEMERAL_STATE === "1") return "NOVA_EPHEMERAL_STATE=1";
  if (env.NOVA_SUPERVISED !== "1") return "مش مُشرَّف (boot.mjs ما حطّاش NOVA_SUPERVISED=1)";
  const root = String(env.NOVA_STATE_DIR ?? "").trim() || process.cwd();
  return `مكان الحالة ${path.resolve(root)} مش ${DURABLE_ROOT}`;
}
