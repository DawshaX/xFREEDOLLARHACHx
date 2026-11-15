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

const router = Router();

const REPO = process.env.NOVA_GITHUB_REPO || "DawshaX/xFREEDOLLARHACHx";
const CACHE_MS = 60_000;

type TargetCache = {
  at: number;
  configured: number | null;
  enabled: boolean | null;
  error: string | null;
};

let cache: TargetCache = { at: 0, configured: null, enabled: null, error: null };

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
    cache = {
      at: now,
      configured: Number.isFinite(n) && (n as number) > 0 ? (n as number) : null,
      enabled: vars.get("FLEET_ENABLED") === "1",
      error: null,
    };
  } catch (err) {
    cache = {
      at: now,
      configured: null,
      enabled: null,
      error: err instanceof Error ? err.message : String(err),
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
      cachedForMs: CACHE_MS,
    },
  });
});

export default router;
