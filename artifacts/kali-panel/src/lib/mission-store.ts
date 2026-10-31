/**
 * Missions that keep running after you close the page.
 *
 * He asked for «مهمات شغالة» — real work items with steps, findings and a
 * status that is still there when he comes back. This is a local, persistent
 * mission ledger: the browser brain creates one when it hunts, advances the
 * steps as tools really finish, and appends findings (CVE / DNS / subdomains).
 *
 * Nothing here is simulated: a step is only marked done when the tool returned,
 * and a finding only exists if a source actually returned it.
 */

export type StepStatus = "queued" | "running" | "done" | "failed" | "blocked";

export interface MissionStep {
  id: string;
  title: string;
  tool: string | null;
  status: StepStatus;
  startedAt?: number;
  endedAt?: number;
  ms?: number;
  note?: string;
}

export interface Finding {
  id: string;
  title: string;
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  cvss?: number;
  source: string;
  ref?: string;
  detail?: string;
  at: number;
}

export interface Mission {
  id: string;
  title: string;
  target?: string;
  kind: "hunt" | "scan" | "intel" | "custom";
  status: "queued" | "running" | "done" | "failed";
  createdAt: number;
  updatedAt: number;
  steps: MissionStep[];
  findings: Finding[];
}

const KEY = "cybernova_missions_v1";
const MAX_MISSIONS = 30;

function store(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
export function onMissionsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(): void {
  listeners.forEach((fn) => fn());
}

function readAll(): Mission[] {
  try {
    const raw = store()?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Mission[]) : [];
    return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.id === "string") : [];
  } catch {
    return [];
  }
}

function writeAll(missions: Mission[]): void {
  try {
    store()?.setItem(KEY, JSON.stringify(missions.slice(0, MAX_MISSIONS)));
  } catch {
    /* quota */
  }
}

export function listMissions(): Mission[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getMission(id: string): Mission | null {
  return readAll().find((m) => m.id === id) ?? null;
}

export function activeMission(): Mission | null {
  return listMissions().find((m) => m.status === "running") ?? null;
}

export function createMission(input: {
  title: string;
  target?: string;
  kind?: Mission["kind"];
  steps: Array<{ title: string; tool?: string | null }>;
}): Mission {
  const now = Date.now();
  const mission: Mission = {
    id: `m-${now.toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    title: input.title.slice(0, 90),
    target: input.target,
    kind: input.kind ?? "custom",
    status: "running",
    createdAt: now,
    updatedAt: now,
    steps: input.steps.map((s, i) => ({ id: `st${i + 1}`, title: s.title, tool: s.tool ?? null, status: "queued" })),
    findings: [],
  };
  writeAll([mission, ...readAll()]);
  emit();
  return mission;
}

export function updateStep(
  missionId: string,
  stepId: string,
  patch: Partial<MissionStep> & { status?: StepStatus },
): void {
  const all = readAll();
  const idx = all.findIndex((m) => m.id === missionId);
  if (idx < 0) return;
  const steps = all[idx].steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s));
  const finished = steps.every((s) => s.status === "done" || s.status === "failed" || s.status === "blocked");
  const anyFailed = steps.some((s) => s.status === "failed");
  all[idx] = {
    ...all[idx],
    steps,
    status: finished ? (anyFailed && steps.every((s) => s.status !== "done") ? "failed" : "done") : "running",
    updatedAt: Date.now(),
  };
  writeAll(all);
  emit();
}

export function addFindings(missionId: string, findings: Finding[]): void {
  if (!findings.length) return;
  const all = readAll();
  const idx = all.findIndex((m) => m.id === missionId);
  if (idx < 0) return;
  const seen = new Set(all[idx].findings.map((f) => `${f.title}|${f.ref ?? ""}`));
  const fresh = findings.filter((f) => !seen.has(`${f.title}|${f.ref ?? ""}`));
  all[idx] = { ...all[idx], findings: [...fresh, ...all[idx].findings].slice(0, 200), updatedAt: Date.now() };
  writeAll(all);
  emit();
}

export function finishMission(missionId: string, status: Mission["status"] = "done"): void {
  const all = readAll();
  const idx = all.findIndex((m) => m.id === missionId);
  if (idx < 0) return;
  all[idx] = { ...all[idx], status, updatedAt: Date.now() };
  writeAll(all);
  emit();
}

export function deleteMission(id: string): void {
  writeAll(readAll().filter((m) => m.id !== id));
  emit();
}

export function missionStats(): { total: number; running: number; done: number; findings: number } {
  const all = readAll();
  return {
    total: all.length,
    running: all.filter((m) => m.status === "running").length,
    done: all.filter((m) => m.status === "done").length,
    findings: all.reduce((n, m) => n + m.findings.length, 0),
  };
}
