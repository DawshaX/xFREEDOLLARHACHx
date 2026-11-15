#!/usr/bin/env node
/**
 * fleet-slot-budget.mjs — ميزانية السلوت (TEST33)
 *
 * العطل المقاس (2026-11-15T10:29Z): موجتين مكدّسين (4 قديمة حية + 19 جديدة)
 * ماسكين حد الخطة المجانية (20 concurrent jobs) → CI بتاع المستودع نفسه
 * (gates/bundle/watchdog) بقى queued — مقاس: runs 43704325710/43704325846
 * اتولدوا 10:29:38Z وقاعطين في الطابور لحد ما عقدة تموت.
 *
 * المعادلة:  n = min(WANTED, max(0, PLAN_MAX − occupied − RESERVE))
 *   occupied = كل jobs الموجات (fleet-nodes + fleet-now) بحالة in_progress أو
 *              queued (الqueued هيحجز سلوت أول ما يفضى — لازم يتعدّ).
 *   RESERVE = 1 → استقرار دائم: 19 عقدة + سلوت واحد دوار للCI.
 *   قرار المالك «الموجات المجدولة وب-push = 19/19» محفوظ: السقف فضل 19 —
 *   اللي اتمنع هو **التكدس** (موجة فوق موجة حية) مش العدد.
 *
 * API فشل؟ fail-safe: n = min(WANTED, 8) — ثمانية عمرها ما تجوّع CI.
 * stdout سطر واحد: nodes=N — الباقي stderr (::notice للوج الworkflow).
 */
import { execFileSync } from "node:child_process";

const WANTED = Math.max(0, Number(process.argv[2] ?? 19) || 19);
const RESERVE = Math.max(0, Number(process.argv[3] ?? 1));
const PLAN_MAX = Number(process.env.GH_PLAN_MAX ?? 20);
const REPO = process.env.GITHUB_REPOSITORY || "DawshaX/xFREEDOLLARHACHx";
const WORKFLOWS = (process.env.FLEET_WORKFLOWS || "fleet-nodes.yml,fleet-now.yml").split(",");

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
  for (const wf of WORKFLOWS) {
    // الحالتين: run شغّال (فيه jobs حية/طابور) وrun لسه queued كله (مافيش
    // حاجة لسه بدأت — عادته wave متكدسة) — الاتنين بيحجزوا مستقبلًا.
    for (const status of ["in_progress", "queued"]) {
      const runs = await api(`/repos/${REPO}/actions/workflows/${wf}/runs?per_page=30&status=${status}`);
      for (const run of runs.workflow_runs || []) {
        const jobs = await api(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`);
        const live = (jobs.jobs || []).filter((j) => j.status === "in_progress" || j.status === "queued").length;
        if (live) { occupied += live; detail.push(`${wf}#${run.id}=${live}`); }
      }
    }
  }
  return { occupied, detail };
}

const measured = await fleetOccupied().catch((e) => null);
let n;
if (!measured) {
  n = Math.min(WANTED, 8);
  console.error(`::warning::fleet budget: API failed — fail-safe n=${n} (عشر عقد ماتجوّعش CI)`);
} else {
  n = Math.max(0, Math.min(WANTED, PLAN_MAX - measured.occupied - RESERVE));
  console.error(
    `::notice::fleet budget: occupied=${measured.occupied} [${measured.detail.join(" ")}] · reserve=${RESERVE} · plan=${PLAN_MAX} → nodes=${n}`,
  );
}
console.log(`nodes=${n}`);
