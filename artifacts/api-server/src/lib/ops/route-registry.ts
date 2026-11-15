/**
 * Route registry — the answer to "is this path actually served by a real router?"
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `app.ts` installs a standalone mock layer BEFORE `app.use("/api", router)`.
 * That layer answers any path it recognises with a canned 200 payload, which is
 * what lets the panel run on a free host with no Postgres.
 *
 * The problem: the mock decided what to answer from a HAND-WRITTEN allowlist of
 * prefixes (`letRouterHandle`). Every router added after that list was written
 * was silently shadowed — the real handler never ran, and the mock answered
 * instead. On 2026-11-15 that turned a security fix into a no-op: the ops gate
 * was added to `POST /api/processes`, but the mock answered first with a fake
 * `proc-1042` and a 200, so the gate never executed and the hole stayed open
 * while the diff looked correct.
 *
 * A hand-maintained list cannot stay correct against 85 router files. So we ask
 * Express itself: walk the mounted router's stack once at boot, compile every
 * declared path to a matcher, and answer `isRealRoute(method, path)` from that.
 * New routers are covered automatically — there is nothing to remember.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────
 * It does not decide policy. It only reports a fact ("a real handler exists").
 * `app.ts` still owns the decision of whether to prefer the mock for a given
 * path (see MOCK_PREFERRED there) — some routes are deliberately mocked because
 * they are DB-backed and the standalone build has no database.
 */

import type { Router } from "express";

export type RouteEntry = {
  /** Path as declared, e.g. `/agent/tasks/:id` */
  path: string;
  /** Lower-case methods, e.g. `["get", "post"]` */
  methods: string[];
  /** Compiled matcher for the declared path */
  matcher: RegExp;
};

/** Express 5 keeps the layer stack on `router.stack`; Express 4 on `_router`. */
type AnyLayer = {
  route?: { path?: string | string[]; methods?: Record<string, boolean> };
  name?: string;
  handle?: { stack?: AnyLayer[] };
  matcher?: string;
  path?: string;
};

/**
 * Turn an Express path pattern into a RegExp.
 *
 * Handles the three forms the codebase actually uses:
 *   `/agent/tasks/:id`      → named param, one segment
 *   `/files/*splat`         → Express 5 wildcard
 *   `/cve/:id?`             → optional trailing param
 *
 * Anything else is escaped literally, so a path containing regex metacharacters
 * (e.g. a dot in a filename route) cannot widen the match.
 */
export function compilePath(declared: string): RegExp {
  const source = declared
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      // Express 5 wildcard: `*name` or bare `*`
      if (segment.startsWith("*")) return "[^/]+(?:/[^/]+)*";
      // `:param`, `:param?`, `:param(...)` — treat the constraint as one segment
      if (segment.startsWith(":")) {
        const optional = segment.endsWith("?");
        const body = "[^/]+";
        return optional ? `(?:${body})?` : body;
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  // Trailing slash is insignificant; a missing optional segment must not leave
  // a dangling separator behind.
  return new RegExp(`^${source.replace(/\/\(\?:\[\^\/\]\+\)\?$/, "(?:/[^/]+)?")}/?$`);
}

function collect(stack: AnyLayer[], prefix: string, out: RouteEntry[]): void {
  for (const layer of stack) {
    if (layer.route) {
      // Express 5 stores `route.path` as a STRING for `router.get("/a")` but as
      // an ARRAY for `router.get(["/a", "/b"])`. Assuming a string here threw
      // `d2.startsWith is not a function` on the first multi-path route and took
      // the whole registry (and therefore every request) down with a 500.
      const declaredRaw = layer.route.path ?? "/";
      const declaredList = Array.isArray(declaredRaw) ? declaredRaw : [declaredRaw];
      const methods = Object.keys(layer.route.methods ?? {}).map((m) => m.toLowerCase());
      for (const declared of declaredList) {
        if (typeof declared !== "string") continue;
        const full = joinPaths(prefix, declared);
        out.push({ path: full, methods, matcher: compilePath(full) });
      }
      continue;
    }
    // A mounted sub-router: recurse with its mount path as the new prefix.
    if (layer.handle?.stack) {
      const mountRaw = layer.matcher ?? layer.path ?? "";
      const mount = typeof mountRaw === "string" ? mountRaw : "";
      collect(layer.handle.stack, joinPaths(prefix, mount), out);
    }
  }
}

function joinPaths(prefix: string, declared: string): string {
  const p = String(prefix ?? "").replace(/\/+$/, "");
  const d = declared === "/" ? "" : String(declared ?? "");
  const joined = `${p}${d.startsWith("/") ? "" : "/"}${d}`;
  return joined === "" ? "/" : joined;
}

let registry: RouteEntry[] | null = null;

/** Build (once) and return the registry for a mounted router. */
export function buildRegistry(router: Router): RouteEntry[] {
  if (registry) return registry;
  const anyRouter = router as unknown as { stack?: AnyLayer[]; _router?: { stack?: AnyLayer[] } };
  const stack = anyRouter.stack ?? anyRouter._router?.stack ?? [];
  const out: RouteEntry[] = [];
  collect(stack, "", out);
  registry = out;
  return out;
}

/**
 * True when a real handler is declared for this method + path.
 *
 * `path` is the path RELATIVE to the router's mount point (i.e. `req.path`
 * inside the `/api` middleware), which is what `app.ts` passes.
 */
export function isRealRoute(router: Router, method: string, path: string): boolean {
  const entries = buildRegistry(router);
  const m = method.toLowerCase();
  const clean = path.split("?")[0] || "/";
  for (const entry of entries) {
    if (!entry.methods.includes(m) && !entry.methods.includes("all")) continue;
    if (entry.matcher.test(clean)) return true;
  }
  return false;
}

/** Diagnostics: every declared route, for the audit script. */
export function listRoutes(router: Router): RouteEntry[] {
  return buildRegistry(router).map(({ path, methods }) => ({ path, methods, matcher: /(?:)/ }));
}
