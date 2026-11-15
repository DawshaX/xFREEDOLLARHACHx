#!/usr/bin/env node
/**
 * fleet-slot-budget.mjs — ميزانية السلوت (TEST33 → TEST34)
 *
 * ══ العطل الأصلي (TEST33، مقاس 2026-11-15T10:29Z) ══
 * موجتين مكدّستين (4 قديمة حية + 19 جديدة) ماسكين حد الخطة المجانية
 * (20 concurrent jobs) → CI بتاع المستودع نفسه (gates/bundle/watchdog) بقى queued.
 * الحل: n = min(WANTED, max(0, PLAN_MAX − occupied − RESERVE)).
 *
 * ══ العطل اللي ظهر بعد كده (TEST34، مقاس 2026-11-15T14:38Z) ══
 * الأسطول نزل من 19 عقدة لـ 4. السبب **مقاس بالحرف** من لوج الـ prepare:
 *
 *   ##[notice]fleet budget: occupied=20
 *     [fleet-nodes.yml#43715136119=1  fleet-now.yml#43701361731=19]
 *     · reserve=1 · plan=20 → nodes=0
 *
 * فيه **عيبين** في السطر ده:
 *
 *   1. **عدّ ذاتي (self-count).** `fleet-nodes.yml#43715136119` هو الـ run
 *      اللي بيحسب نفسه — الـ prepare job بتاعه لسه شغّال، فاتحسب كـ 1 مشغول.
 *      يعني كل موجة بتحجز سلوت ضد نفسها. مع reserve=1 ده لوحده كفاية يخلّي
 *      السقف 18 بدل 19، ومع أي job تاني بيوصل 0.
 *
 *   2. **موجة ميتة بتحجز سلوت للأبد.** `fleet-now.yml#43701361731` اتولّد
 *      09:52Z وعمر العقدة 6 ساعات (تنتهي ~15:52Z). السكربت كان بيعدّ
 *      **كل** run في حالة in_progress/queued بلا سقف عمري — فموجة على وشك
 *      الموت (أو ماتت ولسه GitHub ماسك حالتها) بتفضل تحجز 19 سلوت، والموجة
 *      المجدولة (fleet-nodes، كل 5 ساعات) بترجع 0 كل مرة. النتيجة: لما عقد
 *      fleet-now تموت مفيش حاجة بتخلفها → الأسطول ينزل لـ 4.
 *
 * ══ الإصلاح ══
 *   • استبعاد الـ run الحالي (GITHUB_RUN_ID) من العدّ — مفيش عدّ ذاتي.
 *   • سقف عمري: أي run أقدم من NODE_TTL_MIN (افتراضي 360د = عمر العقدة)
 *     بيتجاهَل — العقد بتاعته ميتة أصلًا، فحجز سلوت عليها بيمنع الخليفة.
 *   • قراءة WANTED من متغير FLEET_NODES (كان متبعت في الـ env ومش مقروء،
 *     والرقم 19 كان hardcoded في سطر النداء — فتغيير المتغير مكانش بيعمل حاجة).
 *   • fail-safe محفوظ: API فشل → min(WANTED, 8).
 *
 * المعادلة: n = min(WANTED, max(0, PLAN_MAX − occupied − RESERVE))
 *   occupied = jobs حية (in_progress/queued) من runs أصغر من NODE_TTL_MIN،
 *              من غير الـ run الحالي.
 *
 * stdout سطر واحد: nodes=N — الباقي stderr (::notice للوج الـ workflow).
 */
import { execFileSync } from "node:child_process";

/** WANTED: argv[2] ← FLEET_NODES ← 19. الرقم مش hardcoded في الـ workflow. */
const WANTED = Math.max(
  0,
  Number(process.argv[2] ?? process.env.FLEET_NODES ?? 19) || 19,
);
const RESERVE = Math.max(0, Number(process.argv[3] ?? 1));
const PLAN_MAX = Number(process.env.GH_PLAN_MAX ?? 20);
/** عمر العقدة 6 ساعات (timeout-minutes: 350 ≈ 5.8h). أي run أقدم من كده ميت. */
const NODE_TTL_MIN = Math.max(30, Number(process.env.NODE_TTL_MIN ?? 360));
const REPO = process.env.GITHUB_REPOSITORY || "DawshaX/xFREEDOLLARHACHx";
const WORKFLOWS = (process.env.FLEET_WORKFLOWS || "fleet-nodes.yml,fleet-now.yml").split(",");
/** الـ run اللي بيحسب دلوقتي — لازم يتستبعد، وإلا كل موجة بتحجز ضد نفسها. */
const SELF_RUN = String(process.env.GITHUB_RUN_ID || "").trim();

async function api(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const headers = { "user-agent": "nova-fleet-budget", accept: "application/vnd.github+json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`api ${r.status} ${path}`);
  return r.json();
}

async function fleetOccupied() {
  let occupied = 0;
  const detail = [];
  const skipped = [];
  const cutoff = Date.now() - NODE_TTL_MIN * 60_000;

  for (const wf of WORKFLOWS) {
    for (const status of ["in_progress", "queued"]) {
      const runs = await api(`/repos/${REPO}/actions/workflows/${wf}/runs?per_page=30&status=${status}`);
      for (const run of runs.workflow_runs || []) {
        // (1) مفيش عدّ ذاتي: الـ run اللي بيحسب نفسه مش مشغول *ضد* نفسه.
        if (SELF_RUN && String(run.id) === SELF_RUN) {
          skipped.push(`${wf}#${run.id}=self`);
          continue;
        }
        // (2) سقف عمري: عقدة أقدم من عمرها الافتراضي ميتة — حجز سلوت عليها
        //     بيمنع الخليفة من إنها تقوم، وده اللي خلّى الأسطول ينزل لـ 4.
        const created = Date.parse(run.created_at || "");
        if (Number.isFinite(created) && created < cutoff) {
          skipped.push(`${wf}#${run.id}=expired`);
          continue;
        }
        const jobs = await api(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`);
        const live = (jobs.jobs || []).filter((j) => j.status === "in_progress" || j.status === "queued").length;
        if (live) {
          occupied += live;
          detail.push(`${wf}#${run.id}=${live}`);
        }
      }
    }
  }
  return { occupied, detail, skipped };
}

const measured = await fleetOccupied().catch((e) => {
  console.error(`::warning::fleet budget: ${e instanceof Error ? e.message : e}`);
  return null;
});

let n;
if (!measured) {
  n = Math.min(WANTED, 8);
  console.error(`::warning::fleet budget: API failed — fail-safe n=${n} (ثمانية عمرها ما تجوّع CI)`);
} else {
  n = Math.max(0, Math.min(WANTED, PLAN_MAX - measured.occupied - RESERVE));
  console.error(
    `::notice::fleet budget: occupied=${measured.occupied} [${measured.detail.join(" ") || "none"}]` +
      ` · skipped=[${measured.skipped.join(" ") || "none"}]` +
      ` · reserve=${RESERVE} · plan=${PLAN_MAX} · wanted=${WANTED} · ttl=${NODE_TTL_MIN}m → nodes=${n}`,
  );
}
console.log(`nodes=${n}`);
