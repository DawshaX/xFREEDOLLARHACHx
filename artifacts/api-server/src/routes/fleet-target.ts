/**
 * Fleet target — "how many nodes is the fleet SUPPOSED to have, and how many
 * does it actually have right now?"
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The panel showed "4 nodes" while the owner's decision was 19. Neither number
 * was wrong on its own — they answered different questions, and nothing in the
 * system could tell you which was which:
 *
 *   • `4`  = nodes that had actually attached to the hub (measured, real)
 *   • `19` = the wave size the owner configured in GitHub Actions
 *
 * The gap between them is the whole story, and it was invisible. Worse, the
 * reason for the gap was a bug: `fleet-slot-budget.mjs` counted its own run as
 * occupied and never expired dead waves, so every scheduled wave computed
 * `nodes=0` and the fleet decayed from 19 to 4 as the old wave aged out.
 *
 * This route reports BOTH numbers side by side, plus the measured reason for
 * any gap, so "the fleet is short" is a fact you can act on instead of a
 * mystery. It reads the real GitHub Actions variable — it does not assume 19.
 *
 * ── Honesty rules ────────────────────────────────────────────────────────────
 *   • `configured` is null when GitHub cannot be read (no token / API down).
 *     It is never guessed.
 *   • `connected` comes from the live WebSocket registry, never from a config.
 *   • `shortfall` is only computed when `configured` is known.
 */
import { Router, type Request, type Response } from "express";
import { getConnectedAgentList } from "./local-agent";
import { createPushNotification } from "../lib/push-hub";
/* TEST37 — تنبيه الموجة العالقة (اقتراح جولة 12 المقاس: موجة عاشت 7.3س وهي
 * «بتموت» و16 عقدة خلصت بصمت). العمر بيقرا من الruns الحية نفسها، والإشعار
 * بيصعد قناة واحدة: مركز الإشعارات الموحد (session-nexus) + push-hub. */
const NODE_TTL_MIN = Number(process.env.NOVA_NODE_TTL_MIN || 360);

const router = Router();

const REPO = process.env.NOVA_GITHUB_REPO || "DawshaX/xFREEDOLLARHACHx";
const CACHE_MS = 60_000;

type WaveInfo = { workflow: string; runId: number; ageMin: number; url: string };
type TargetCache = {
  at: number;
  configured: number | null;
  enabled: boolean | null;
  error: string | null;
  waves: WaveInfo[] | null;
};

let cache: TargetCache = { at: 0, configured: null, enabled: null, error: null, waves: null };

const alertedStaleRuns = new Set<number>();
const alertedLowAttach = new Set<number>();

/** الموجات الحية بالحرف: run بتاع fleet-nodes/fleet-now لسه in_progress؟
 * بلا توكن/بلا نت → null (مش مصفوفة فاضية — فاضية معناها «مافيش موجات»
 * وده ادعاء؛ null معناها «مغيرقدرش أقيس» زي ما القاعدة بتقول). */
async function readLiveWaves(token: string): Promise<WaveInfo[] | null> {
  try {
    const waves: WaveInfo[] = [];
    for (const wf of ["fleet-nodes.yml", "fleet-now.yml"]) {
      const r = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${wf}/runs?status=in_progress&per_page=20`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "user-agent": "nova-fleet-target",
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!r.ok) throw new Error(`github ${r.status}`);
      const d = (await r.json()) as {
        workflow_runs?: Array<{ id: number; created_at: string; html_url: string }>;
      };
      for (const run of d.workflow_runs ?? []) {
        const started = Date.parse(run.created_at);
        const ageMin = Number.isFinite(started) ? Math.round((Date.now() - started) / 60_000) : 0;
        waves.push({ workflow: wf, runId: run.id, ageMin, url: run.html_url });
      }
    }
    return waves;
  } catch {
    return null;
  }
}

/** التنبيه مرة واحدة لكل موجة — نفس run مابينبّهش تاني (الحرس ده + دوب
 * ال10 دقايق المدمج في recordBackgroundEvent بيمنع السبام). */
function alertStaleWaves(waves: WaveInfo[]): number {
  let fresh = 0;
  for (const w of waves) {
    if (w.ageMin <= NODE_TTL_MIN || alertedStaleRuns.has(w.runId)) continue;
    alertedStaleRuns.add(w.runId);
    fresh++;
    const title = `🌊 موجة أسطول تجاوزت عمرها (${w.ageMin} دقيقة) — ${w.workflow}#${w.runId}`;
    const detail = `الموجة شغالة ${w.ageMin} دقيقة وعمر العقدة الافتراضي ${NODE_TTL_MIN} دقيقة — عقدة متعلقة أو GitHub طايعة الحالة. عقد الخليفة مش هتتنافس على السلوتات دي (البودجت بيتجاهل الموجات المنتهية).`;
    void import("../lib/agent/session-nexus").then(({ recordBackgroundEvent }) =>
      recordBackgroundEvent({ kind: "fleet", title, detail, source: "fleet-target" }),
    );
    try {
      createPushNotification({ kind: "fleet-stale-wave", title, body: detail, link: w.url });
    } catch {
      /* push غير مظبوط — مركز الإشعارات شايف الحدث برضه */
    }
  }
  return fresh;
}

/** TEST38 — «موجة حية والاتصال قليل»: قِيس 02:27Z — موجة 20:07Z ماسكة 17
 * runner والهَب شايف 3-4 بس. ده مش نفس تنبيه العمر: العقدة ممكن تكون في
 * prewarm لسه، فالإنذار بينطلق بعد 45د من عمر الموجة (prewarm 7د + هامش)
 * والاتصال أقل من 5 — مرة واحدة لكل موجة، بنفس القنوات الموحدة. */
function alertLowAttach(waves: WaveInfo[], connected: number): void {
  if (connected >= 5) return;
  for (const w of waves) {
    if (w.ageMin < 45 || alertedLowAttach.has(w.runId)) continue;
    alertedLowAttach.add(w.runId);
    const title = `🔌 الأسطول متصل جزئيًا: ${connected} عقدة وصلت من موجة شغالة ${w.ageMin} دقيقة (${w.workflow}#${w.runId})`;
    const detail = `الrun ماسك سلوتات وjobs شغالة، بس الاتصال بالهَب أقل من 5 — العقد اللي ما وصلتش إما لسه في prewarm أو اتحادها فشل بصمت. اللوج الكامل للعقدة في صفحة Actions.`;
    void import("../lib/agent/session-nexus").then(({ recordBackgroundEvent }) =>
      recordBackgroundEvent({ kind: "fleet", title, detail, source: "fleet-target" }),
    );
    try {
      createPushNotification({ kind: "fleet-low-attach", title, body: detail, link: w.url });
    } catch {
      /* push غير مظبوط — مركز الإشعارات شايف الحدث برضه */
    }
  }
}

async function readGithubVars(): Promise<TargetCache> {
  const now = Date.now();
  if (now - cache.at < CACHE_MS) return cache;

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (!token) {
    cache = {
      at: now,
      configured: null,
      enabled: null,
      error: "no GITHUB_TOKEN on this host — configured target is unknown, not assumed",
      waves: null,
    };
    return cache;
  }

  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/variables`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "nova-fleet-target",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`github ${r.status}`);
    const d = (await r.json()) as { variables?: Array<{ name: string; value: string }> };
    const vars = new Map((d.variables ?? []).map((v) => [v.name, v.value]));
    const raw = vars.get("FLEET_NODES");
    const n = raw === undefined ? null : Number(raw);
    const waves = await readLiveWaves(token);
    cache = {
      at: now,
      configured: Number.isFinite(n) && (n as number) > 0 ? (n as number) : null,
      enabled: vars.get("FLEET_ENABLED") === "1",
      error: null,
      waves,
    };
    if (waves) alertStaleWaves(waves);
  } catch (err) {
    cache = {
      at: now,
      configured: null,
      enabled: null,
      error: err instanceof Error ? err.message : String(err),
      waves: null,
    };
  }
  return cache;
}

/**
 * The fleet's target vs its measured reality.
 *
 * `connected` is what the hub actually has attached. `configured` is what the
 * owner asked GitHub Actions to spawn. When they differ, `gap` says by how much
 * and `why` names the measured cause — never a guess.
 */
router.get("/fleet/target", async (_req: Request, res: Response) => {
  const agents = getConnectedAgentList();
  const connected = agents.length;
  const gh = await readGithubVars();

  const configured = gh.configured;
  const shortfall = configured === null ? null : Math.max(0, configured - connected);
  if (gh.waves) alertLowAttach(gh.waves, connected);

  let why: string;
  if (configured === null) {
    why = gh.error
      ? `الهدف غير معروف: ${gh.error}`
      : "الهدف غير معروف — مفيش قراءة من GitHub.";
  } else if (shortfall === 0) {
    why = `الأسطول كامل: ${connected}/${configured} عقدة متصلة.`;
  } else if (gh.enabled === false) {
    why = `ناقص ${shortfall} عقدة — FLEET_ENABLED مش = 1، فالموجات المجدولة مش بتقوم.`;
  } else {
    why = `ناقص ${shortfall} عقدة من ${configured} — الموجة المجدولة بترجع nodes=0 أو لسه ما اشتغلتش.`;
  }

  res.json({
    ok: true,
    measured: true,
    ts: new Date().toISOString(),
    connected,
    configured,
    shortfall,
    enabled: gh.enabled,
    waves: gh.waves,
    staleWaves: gh.waves ? gh.waves.filter((w) => w.ageMin > NODE_TTL_MIN) : null,
    nodeTtlMin: NODE_TTL_MIN,
    why,
    nodes: agents.map((a) => ({
      id: String(a.id ?? "agent"),
      hostname: String(a.hostname ?? "unknown"),
      platform: String(a.platform ?? "unknown"),
      connectedAt: a.connectedAt ?? null,
    })),
    source: {
      connected: "WebSocket registry (/api/local-agent/agents)",
      configured: `GitHub Actions variable FLEET_NODES in ${REPO}`,
      waves: `GitHub Actions runs (in_progress) of fleet-nodes.yml + fleet-now.yml in ${REPO}`,
      cachedForMs: CACHE_MS,
    },
  });
});

export default router;
