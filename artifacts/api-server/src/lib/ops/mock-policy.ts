/**
 * Mock-layer policy — decides whether the standalone mock may answer a request.
 *
 * ── The bug this fixes ───────────────────────────────────────────────────────
 * `app.ts` mounts a standalone mock BEFORE the real `/api` router. It answered
 * from a hand-written prefix allowlist (`letRouterHandle`). Any router added
 * after that list was written was silently shadowed: the real handler never
 * ran and the mock replied with a canned 200.
 *
 * Measured on 2026-11-15 against the 85 router files: 202 declared routes were
 * not covered by the allowlist, 120 of them writes (POST/PUT/PATCH/DELETE).
 * That is why a security gate added to `POST /api/processes` never executed —
 * the mock answered `proc-1042` with a 200 first, so the fix looked applied
 * while the hole stayed open.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * The mock may answer ONLY when the real router cannot:
 *
 *   1. No real route is declared for this method+path  → mock (compat shim for
 *      panel paths that predate the router split).
 *   2. A real route exists but it is DB-backed and this build has no
 *      DATABASE_URL → mock (that is the whole point of standalone mode: the
 *      panel must work on a free host with no Postgres).
 *   3. Otherwise → the real router owns it. Always.
 *
 * Rule 3 is the fix. It is derived from Express's own route table, so a router
 * added tomorrow is covered without anyone remembering to edit a list.
 */

import type { Router } from "express";
import { isRealRoute } from "./route-registry";

/**
 * Routers whose handlers read/write Postgres. In standalone mode (no
 * DATABASE_URL) these are the ones the mock is allowed to stand in for.
 *
 * Kept as prefixes because a router mounts many paths; the registry check
 * already guarantees a real handler exists before this list is consulted.
 */
const DB_BACKED_PREFIXES = [
  "/agent/tasks",
  "/agent/run",
  "/agent/tools",
  "/ai/",
  "/anthropic/",
  "/assets",
  "/audit",
  "/bookmarks",
  "/bot/",
  "/cves",
  "/cwe",
  "/dashboard/",
  "/evidence",
  "/explorer/",
  "/installer/",
  "/intelligence/",
  "/ioc",
  "/jobs",
  "/kaligpt/",
  "/knowledge",
  "/mitre/",
  "/nodes",
  "/playbooks",
  "/reports",
  "/risk/",
  "/stats/",
  "/threats",
  "/vulnerabilities",
  "/webhooks",
  "/missions",
];

function isDbBacked(path: string): boolean {
  return DB_BACKED_PREFIXES.some((p) => path === p || path.startsWith(p));
}

/**
 * True when the real router must handle this request (i.e. the mock must stand
 * down). `path` is relative to the `/api` mount, which is what `req.path` gives
 * inside the middleware.
 */
export function realRouterOwns(router: Router, method: string, path: string): boolean {
  if (!isRealRoute(router, method, path)) return false;
  // A DB-backed route with no database cannot serve the request — the mock is
  // the only thing that can, and that is a deliberate standalone-mode feature.
  if (!process.env.DATABASE_URL && isDbBacked(path)) return false;
  return true;
}

/** Exposed for the audit script so the policy can be asserted, not assumed. */
export function dbBackedPrefixes(): readonly string[] {
  return DB_BACKED_PREFIXES;
}
