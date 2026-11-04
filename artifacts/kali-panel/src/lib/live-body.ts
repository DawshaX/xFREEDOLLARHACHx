/**
 * The body that is actually running — read from the two things that never sleep.
 * ────────────────────────────────────────────────────────────────────────────
 * There is no always-on server in this deployment, so "the program is running"
 * has to mean something specific. It means:
 *
 *   1. **GitHub Actions** — the executor. Public REST, no token, no CORS problem:
 *      `api.github.com/repos/<owner>/<repo>/actions/runs` answers straight in the
 *      browser, so the panel can show *live* which workflow is running right now,
 *      how long it has been running, and whether the last one passed.
 *   2. **The last hunt** — `state/hunt-latest.json`, committed by that executor:
 *      what was scanned, what was found, with evidence hashes.
 *
 * Both are measurements with timestamps. Nothing here invents a green light: when
 * the API is rate-limited the panel says so instead of showing "connected".
 */
const OWNER = "DawshaX";
const REPO = "xFREEDOLLARHACHx";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

export interface WorkflowRun {
  id: number;
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | null
  createdAt: string;
  updatedAt: string;
  url: string;
  elapsedSec: number | null;
}

export interface HuntFinding {
  id: string;
  host: string;
  template: string;
  name: string;
  severity: string;
  matchedAt: string;
  cve: string | null;
  cwe: string | null;
  verified: boolean;
}

export interface HuntReport {
  at: string;
  tools: Record<string, string>;
  totals: { targets: number; findings: number; rated: number; bySeverity: Record<string, number> };
  findings: HuntFinding[];
  saysAr: string;
}

function basePath(): string {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  return b.endsWith("/") ? b : `${b}/`;
}

/** Latest runs, newest first. Rate-limited (60/h per IP) → the caller shows the reason. */
export async function fetchLiveRuns(limit = 8): Promise<{ ok: boolean; runs: WorkflowRun[]; error?: string }> {
  try {
    const res = await fetch(`${API}/actions/runs?per_page=${limit}`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) {
      const hint = res.status === 403 ? "rate limit من GitHub (60/ساعة لكل IP) — استنى شوية" : `HTTP ${res.status}`;
      return { ok: false, runs: [], error: hint };
    }
    const body = (await res.json()) as { workflow_runs?: Array<Record<string, unknown>> };
    const runs = (body.workflow_runs ?? []).map((r) => {
      const created = String(r["created_at"] ?? "");
      const updated = String(r["updated_at"] ?? "");
      const done = String(r["status"]) === "completed";
      return {
        id: Number(r["id"]),
        name: String(r["name"] ?? r["path"] ?? "workflow"),
        status: String(r["status"] ?? "unknown"),
        conclusion: r["conclusion"] ? String(r["conclusion"]) : null,
        createdAt: created,
        updatedAt: updated,
        url: String(r["html_url"] ?? ""),
        elapsedSec: done && created && updated ? Math.round((Date.parse(updated) - Date.parse(created)) / 1000) : null,
      };
    });
    return { ok: true, runs };
  } catch (err) {
    return { ok: false, runs: [], error: (err as Error).message };
  }
}

/** The last hunt, as committed by CI. Absent file = never ran (said out loud). */
export async function fetchHunt(): Promise<HuntReport | null> {
  try {
    const res = await fetch(`${basePath()}state/hunt-latest.json?t=${Date.now()}`);
    if (!res.ok) return null;
    const raw = (await res.json()) as Record<string, unknown>;
    const totals = (raw["totals"] as Record<string, unknown> | undefined) ?? {};
    return {
      at: String(raw["at"] ?? ""),
      tools: (raw["tools"] as Record<string, string>) ?? {},
      totals: {
        targets: Number(totals["targets"] ?? 0),
        findings: Number(totals["findings"] ?? 0),
        rated: Number(totals["rated"] ?? 0),
        bySeverity: (totals["bySeverity"] as Record<string, number>) ?? {},
      },
      findings: ((raw["findings"] as HuntFinding[]) ?? []).slice(0, 40),
      saysAr: String(raw["says_ar"] ?? ""),
    };
  } catch {
    return null;
  }
}

export function runLabel(r: WorkflowRun): string {
  if (r.status !== "completed") return r.status === "in_progress" ? "شغّال دلوقتي" : "في الطابور";
  return r.conclusion === "success" ? "خلص بنجاح" : r.conclusion === "cancelled" ? "اتلغى" : "فشل";
}

export function runColor(r: WorkflowRun): string {
  if (r.status !== "completed") return "#ffcc44";
  return r.conclusion === "success" ? "#44ff88" : r.conclusion === "cancelled" ? "#999999" : "#ff5555";
}
