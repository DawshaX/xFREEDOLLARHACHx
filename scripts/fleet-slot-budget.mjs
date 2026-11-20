#!/usr/bin/env node
/**
 * fleet-slot-budget.mjs — ميزانية السلوت (TEST33 → TEST34)
 *
 * ══ العطل الأول (TEST33، مقاس 2026-11-15T10:29Z) ══
 * موجتين مكدّستين (4 قديمة حية + 19 جديدة) ماسكين حد الخطة المجانية
 * (20 concurrent jobs) → CI بتاع المستودع نفسه (gates/bundle/watchdog) بقى queued
 * — مقاس: runs 43704325710/43704325846 اتولّدوا 10:29:38Z وقاعدين في الطابور.
 *
 * المعادلة:  n = min(WANTED, max(0, PLAN_MAX − occupied − RESERVE))
 *   occupied = كل jobs الموجات (fleet-nodes + fleet-now) بحالة in_progress أو
 *              queued (الـ queued بيحجز سلوت أول ما يفضى — لازم يتعدّ).
 *   RESERVE = 1 → استقرار دائم: 19 عقدة + سلوت واحد دوّار للـ CI.
 *   قرار المالك «الموجات المجدولة وبـ push = 19/19» محفوظ: السقف فضل 19 —
 *   اللي اتمنع هو **التكدس** (موجة فوق موجة حية) مش العدد.
 *
 * ══ العطل التاني (TEST34، مقاس 2026-11-15T14:38Z) ══
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
 *      يعني كل موجة بتحجز سلوت ضد نفسها.
 *
 *   2. **موجة ميتة بتحجز سلوت للأبد.** `fleet-now.yml#43701361731` اتولّد
 *      09:52Z وعمر العقدة 6 ساعات. السكربت كان بيعدّ **كل** run في حالة
 *      in_progress/queued بلا سقف عمري — فموجة على وشك الموت (أو ماتت ولسه
 *      GitHub ماسك حالتها) بتفضل تحجز 19 سلوت، والموجة المجدولة (كل 5 ساعات)
 *      بترجع 0 كل مرة. النتيجة: لما عقد fleet-now تموت مفيش حاجة بتخلفها.
 *
 *      **الدليل المقاس:** في 16:08Z كان `fleet-now#43701361731` لسه
 *      `in_progress` بعد 6.4 ساعة، وعنده 20 job: **16 success + 4 in_progress**
 *      — يعني 16 عقدة خلصت بنجاح والباقي عالق. الـ run ده هو اللي بقى 19
 *      عقدة من أصل 19 (المصفوفة 1..19 = 19 job + prepare = 20). الأربعة
 *      العالقة دول هم اللي فضلوا متصلين = «4 عقد» اللي المستخدم شافها.
 *
 * ══ الإصلاح ══
 *   • استبعاد الـ run الحالي (GITHUB_RUN_ID) من العدّ — مفيش عدّ ذاتي.
 *   • سقف عمري: أي run أقدم من NODE_TTL_MIN (افتراضي 360د = عمر العقدة)
 *     بيتجاهَل — العقد بتاعته ميتة أصلًا، فحجز سلوت عليها بيمنع الخليفة.
 *   • قراءة WANTED من متغير FLEET_NODES (كان متبعت في الـ env ومش مقروء،
 *     والرقم 19 كان hardcoded في سطر النداء — فتغيير المتغير مكانش بيعمل حاجة).
 *   • fail-safe محفوظ: API فشل → min(WANTED, 8).
 *
 * stdout سطر واحد: nodes=N — الباقي stderr (::notice للوج الـ workflow).
 */

/** WANTED: argv[2] ← FLEET_NODES ← 19. الرقم مش hardcoded في الـ workflow. */
const WANTED = Math.max(
  0,
  Number(process.argv[2] ?? process.env.FLEET_NODES ?? 10) || 10,
);
const RESERVE = Math.max(10, Number(process.argv[3] ?? 10));
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
    // الحالتين: run شغّال (فيه jobs حية/طابور) و run لسه queued كله (مفيش
    // حاجة لسه بدأت — عادته wave متكدسة) — الاتنين بيحجزوا مستقبلًا.
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
