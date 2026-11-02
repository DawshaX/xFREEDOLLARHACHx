/**
 * NOVA — self-provisioning for a zero-budget install
 * ───────────────────────────────────────────────────
 * Two things stop a free install from being useful, and both are fixed here
 * without asking a non-technical human to edit files:
 *
 *   1. **Model keys.** They are not in the repo and should not be pasted into a
 *      public page. If you keep them on your own host (that is what a small
 *      free app server is good for), point `NOVA_KEYS_URL` at an endpoint that
 *      returns `{ "GROQ_API_KEY": "..." }` and the engine loads it once at boot.
 *      Same for `NOVA_KEYS_FILE` for an untracked local JSON.
 *      Rules: a real env var always wins, values are never logged, and http://
 *      is refused unless `NOVA_KEYS_ALLOW_HTTP=1` — because a key sent in clear
 *      text over the internet is a key you must rotate afterwards.
 *
 *   2. **Scope.** A program registry is the one gate that must not be automated
 *      blindly, so boot-time seeding only creates *passive* programs
 *      (`passive_only: true`) from `NOVA_SCOPE_DOMAINS`, using the same
 *      discovery path as the agent tool: read the target's own `security.txt`,
 *      keep admin/staging/internal names out, cap at 1 req/s.
 *      Active probing still requires the explicit consent sentence — the human
 *      decision is one sentence wide, not a JSON file.
 */
import fs from "node:fs";
import path from "node:path";
import { discoverProgram } from "./scope";
import { logger } from "../logger";

export interface BootProvisionResult {
  keys: { source: string | null; applied: string[]; refused: string[]; error?: string };
  scope: { seeded: string[]; failed: Array<{ host: string; error: string }> };
}

const KEY_NAME = /^[A-Z][A-Z0-9_]{2,}_(KEY|TOKEN|API_KEY)$/;

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(process.env.HOME || process.env.USERPROFILE || "/", p.slice(2));
  return p;
}

/** Only env-shaped keys with plausible values, and only ones we do not already have. */
function applyKeyObject(obj: unknown, applied: string[], refused: string[]): void {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    refused.push("payload-not-an-object");
    return;
  }
  for (const [name, value] of Object.entries(obj as Record<string, unknown>)) {
    const clean = name.trim().toUpperCase();
    const str = typeof value === "string" ? value.trim() : "";
    if (!KEY_NAME.test(clean)) {
      refused.push(`${name}:not-a-key-name`);
      continue;
    }
    if (str.length < 12) {
      refused.push(`${name}:value-too-short`);
      continue;
    }
    if (process.env[clean] && process.env[clean]!.trim().length > 8) {
      refused.push(`${name}:already-in-env`);
      continue;
    }
    process.env[clean] = str;
    applied.push(clean);
  }
}

export async function loadKeysFromSource(): Promise<BootProvisionResult["keys"]> {
  const url = String(process.env.NOVA_KEYS_URL ?? "").trim();
  const file = String(process.env.NOVA_KEYS_FILE ?? "").trim();
  const out: BootProvisionResult["keys"] = { source: null, applied: [], refused: [] };
  if (!url && !file) return out;

  let text = "";
  try {
    if (file) {
      out.source = `file:${file}`;
      text = fs.readFileSync(expandHome(file), "utf8");
    } else if (url) {
      const isLocal = /^https:\/\//i.test(url) || process.env.NOVA_KEYS_ALLOW_HTTP === "1";
      if (!isLocal) {
        out.error = "NOVA_KEYS_URL لازم يبقى https (أو NOVA_KEYS_ALLOW_HTTP=1 لوHOSTك داخلي) — مفتاح بيتمشى صريح على النت مش مفتاح.";
        return out;
      }
      out.source = url.replace(/\/\/[^@/]*@/, "//");
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12_000),
        headers: { accept: "application/json", "user-agent": "CyberNova-NOVA/2099 (key bootstrap)" },
        redirect: "follow",
      });
      if (!res.ok) {
        out.error = `مصدر المفاتيح رجّع HTTP ${res.status}`;
        return out;
      }
      text = (await res.text()).slice(0, 200_000);
    }
    applyKeyObject(JSON.parse(text), out.applied, out.refused);
  } catch (err) {
    out.error = (err as Error).message;
  }
  if (out.applied.length) {
    // names only — a logged key is a leaked key
    logger.info({ applied: out.applied, source: out.source }, "nova keys bootstrapped from source");
  }
  if (out.error) logger.warn({ error: out.error, source: out.source }, "key bootstrap failed (continuing without them)");
  return out;
}

/**
 * `NOVA_SCOPE_DOMAINS=example.com,hackerone.com/foo` → passive programs in the
 * registry before the first request arrives. Existing programs are overwritten
 * only in the same passive mode, so this can never widen what may be touched.
 */
export async function seedScopeFromEnv(): Promise<BootProvisionResult["scope"]> {
  const raw = String(process.env.NOVA_SCOPE_DOMAINS ?? "").trim();
  const out: BootProvisionResult["scope"] = { seeded: [], failed: [] };
  if (!raw) return out;
  const hosts = raw
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 20);

  for (const host of hosts) {
    try {
      const proposal = await discoverProgram(host, { register: true });
      if (proposal.ok && proposal.registered) out.seeded.push(host);
      else out.failed.push({ host, error: proposal.error ?? proposal.needs_ar });
    } catch (err) {
      out.failed.push({ host, error: (err as Error).message });
    }
  }
  if (out.seeded.length) logger.info({ seeded: out.seeded }, "scope seeded from NOVA_SCOPE_DOMAINS (passive only)");
  return out;
}

let last: BootProvisionResult | null = null;

/** Boot-time provisioning. Never throws — a broken key source must not stop the server. */
export async function provisionOnBoot(): Promise<BootProvisionResult> {
  const keys = await loadKeysFromSource().catch((err) => ({
    source: null,
    applied: [] as string[],
    refused: [] as string[],
    error: (err as Error).message,
  }));
  const scope = await seedScopeFromEnv().catch(() => ({ seeded: [] as string[], failed: [] as Array<{ host: string; error: string }> }));
  last = { keys, scope };
  return last;
}

/** What provisioning did at boot, for the panel/status endpoint (names only). */
export function provisionStatus(): BootProvisionResult | null {
  return last;
}
