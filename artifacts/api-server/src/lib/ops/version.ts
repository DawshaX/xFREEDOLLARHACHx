/**
 * NOVA — “which build is actually running out there?”
 * ────────────────────────────────────────────────────
 * Every remote diagnosis in this project starts with the same dead end: the
 * panel answers 200 for everything (SPA fallthrough), so `curl /api/ops/kinds`
 * returning HTML tells you nothing, and a server that has been up for a week
 * can be running a bundle from before the ops engine existed.
 *
 * So the engine states it itself, from data it can see: the commit it was built
 * from (env first — a container usually has no `.git` — then `git` if present),
 * the mtime of the file Node is executing, and what the box can actually do
 * right now (tools on PATH, autonomy level, node version).
 *
 * Nothing here is secret: no env values, no keys, no hostnames.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { autonomySummary } from "./autonomy";
import { toolStatus } from "./tools";

export interface NovaBuildStamp {
  sha: string;
  shaSource: "env" | "git" | "unknown";
  entryMtime: string | null;
  uptimeSec: number;
  node: string;
  platform: string;
  opsRouter: true;
  toolsPresent: string[];
  autonomy: ReturnType<typeof autonomySummary>;
  /** Enough for a human to know whether a redeploy is overdue. */
  stale: { suspect: boolean; why: string };
}

let cached: { sha: string; source: NovaBuildStamp["shaSource"] } | null = null;

function currentSha(): { sha: string; source: NovaBuildStamp["shaSource"] } {
  if (cached) return cached;
  for (const name of ["NOVA_BUILD_SHA", "GITHUB_SHA", "COMMIT_REF", "VERCEL_GIT_COMMIT_SHA", "CF_PAGES_COMMIT_SHA"]) {
    const v = String(process.env[name] ?? "").trim();
    if (/^[0-9a-f]{7,40}$/i.test(v)) {
      cached = { sha: v.slice(0, 40), source: "env" };
      return cached;
    }
  }
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    const v = out.trim();
    if (/^[0-9a-f]{40}$/.test(v)) {
      cached = { sha: v, source: "git" };
      return cached;
    }
  } catch {
    /* no git, no repo, or hardened container — that is normal */
  }

  /* déploy bundle: build.json يُكتب من سكريبت البناء (build-standalone.mjs)
   * ويجلس بجانب entered point. هذا هو المصدر الوحيد المتاح في الحاويات
   * التي لا تحمل .git ولا متغيرات بناء. */
  for (const c of [path.resolve(process.cwd(), "build.json"), path.resolve(process.cwd(), "..", "build.json")]) {
    try {
      const raw = fs.readFileSync(c, "utf8");
      const parsed = JSON.parse(raw) as { commit?: string; sha?: string };
      const v = String(parsed.commit ?? parsed.sha ?? "").trim();
      if (/^[0-9a-f]{7,40}$/i.test(v)) {
        cached = { sha: v.slice(0, 40), source: "env" };
        return cached;
      }
    } catch {
      /* keep trying other candidates, then fall through to unknown */
    }
  }

  cached = { sha: "unknown", source: "unknown" };
  return cached;
}

/** The deployed bundle, not the source tree: whatever Node loaded is the truth. */
function entryFile(): string | null {
  const main = process.argv[1];
  if (!main) return null;
  try {
    return fs.realpathSync(main);
  } catch {
    return main;
  }
}

export function buildStamp(): NovaBuildStamp {
  const { sha, source } = currentSha();
  const entry = entryFile();
  let mtime: string | null = null;
  try {
    mtime = entry ? fs.statSync(entry).mtime.toISOString() : null;
  } catch {
    mtime = null;
  }
  const autonomy = autonomySummary();
  const ageDays = mtime ? (Date.now() - Date.parse(mtime)) / 86_400_000 : null;
  return {
    sha,
    shaSource: source,
    entryMtime: mtime,
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    opsRouter: true,
    toolsPresent: toolStatus().filter((t) => t.present).map((t) => t.bin),
    autonomy,
    stale:
      ageDays === null
        ? { suspect: true, why: "مفيش mtime للـbundle — اتأكد إن الملف مقروء (container read-only?)" }
        : ageDays > 3
          ? { suspect: true, why: `الـbundle عمره ${ageDays.toFixed(1)} يوم — لو الريبو اتحدّث بعدها، الـhost محتاج redeploy` }
          : { suspect: false, why: `الـbundle عمره ${ageDays.toFixed(1)} يوم` },
  };
}
