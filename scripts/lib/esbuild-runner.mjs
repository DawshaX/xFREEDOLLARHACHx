#!/usr/bin/env node
/**
 * One way to bundle TypeScript for a script, whatever shape `pnpm install`
 * left behind.
 * ──────────────────────────────────────────────────────────────────────────
 * Measured 2026-11-05: `agent gates` failed in CI while every test passed
 * locally. Cause: the tests executed `node_modules/.pnpm/node_modules/.bin/
 * esbuild`, and on a fresh install that file is pnpm's shell proxy, which runs
 * `node …/esbuild/bin/esbuild`. On that install `bin/esbuild` happened to be the
 * **native binary**, so Node tried to parse an ELF header as JavaScript:
 *
 *     SyntaxError: Invalid or unexpected token   (ELF\x02\x01\x01)
 *
 * The lesson is not "pin the binary path" — it is that the CLI shim is
 * incidental. esbuild's Node API is the stable surface: `buildSync()` exists in
 * every version the workspace uses, and it cannot be broken by how a package
 * manager decides to write its shims.
 *
 * `bundleCli(root, args, execOpts)` takes the SAME argument array a script
 * already built for the CLI, so a call site changes by one word:
 *
 *     execFileSync(esbuild, [SRC, "--bundle", …])   →   bundleCli(ROOT, [SRC, "--bundle", …])
 *
 * If the API cannot be resolved at all (no install), it falls back to the CLI
 * exactly as before, so an offline checkout behaves no worse than it did.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let cached;
let cachedRoot;

/** Resolve esbuild's Node API from whichever package in the workspace owns it. */
export function esbuildApi(root) {
  if (cached !== undefined && cachedRoot === root) return cached;
  cachedRoot = root;
  // The api-server package is the one that depends on esbuild directly, so its
  // node_modules always contains it — under pnpm's strict layout the repo root
  // does not. Try the real entry points before any bare specifier.
  const candidates = [
    join(root, "artifacts/api-server/node_modules/esbuild/lib/main.js"),
    join(root, "node_modules/esbuild/lib/main.js"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      cached = createRequire(file)(file);
      return cached;
    } catch {
      /* try the next location */
    }
  }
  for (const anchor of [join(root, "artifacts/api-server/package.json"), join(root, "package.json")]) {
    if (!existsSync(anchor)) continue;
    try {
      cached = createRequire(anchor)("esbuild");
      return cached;
    } catch {
      /* try the next anchor */
    }
  }
  try {
    cached = createRequire(import.meta.url)("esbuild");
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/** Same order the scripts used, kept so the fallback matches old behaviour. */
export function esbuildCli(root) {
  return [
    join(root, "artifacts/api-server/node_modules/.bin/esbuild"),
    join(root, "node_modules/.bin/esbuild"),
    join(root, "node_modules/.pnpm/node_modules/.bin/esbuild"),
  ].find((p) => existsSync(p));
}

/** Translate the small CLI surface these scripts use into buildSync options. */
export function argsToBuildOptions(args) {
  const options = { logLevel: "info" };
  const leftover = [];
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      leftover.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    const key = eq === -1 ? body : body.slice(0, eq);
    const value = eq === -1 ? "" : body.slice(eq + 1);
    switch (key) {
      case "bundle":
        options.bundle = true;
        break;
      case "format":
        options.format = value;
        break;
      case "platform":
        options.platform = value;
        break;
      case "target":
        options.target = value;
        break;
      case "outfile":
        options.outfile = value;
        break;
      case "outdir":
        options.outdir = value;
        break;
      case "sourcemap":
        options.sourcemap = value || true;
        break;
      case "log-level":
        options.logLevel = value;
        break;
      case "packages":
        options.packages = value;
        break;
      case "external":
        options.external = [...(options.external ?? []), value];
        break;
      case "banner:js":
        options.banner = { ...(options.banner ?? {}), js: value };
        break;
      default:
        if (key.startsWith("alias:")) {
          // --alias:npm:@scope/pkg@2=/path/to/stub
          options.alias = { ...(options.alias ?? {}), [key.slice("alias:".length)]: value };
        } else if (key.startsWith("define:")) {
          options.define = { ...(options.define ?? {}), [key.slice("define:".length)]: value };
        } else {
          leftover.push(arg);
        }
    }
  }
  const entryPoints = leftover.filter((a) => !a.startsWith("-"));
  if (leftover.length !== entryPoints.length) options.__unknownFlags = leftover;
  return { options, entryPoints };
}

/**
 * Bundle with the given CLI-style arguments. Returns the outfile when known.
 * `execOpts` is accepted for drop-in compatibility (`{ stdio: "inherit" }`) and
 * is only honoured by the CLI fallback.
 */
export function bundleCli(root, args, execOpts = {}) {
  const api = esbuildApi(root);
  if (api?.buildSync) {
    const { options, entryPoints } = argsToBuildOptions(args);
    const unknown = options.__unknownFlags;
    delete options.__unknownFlags;
    if (entryPoints.length && !unknown) {
      api.buildSync({ entryPoints, ...options });
      return options.outfile;
    }
    // An argument this shim does not understand: do not guess at a build.
  }
  const cli = esbuildCli(root);
  if (!cli) throw new Error("esbuild not found — run pnpm install first");
  const opts = execOpts && Object.keys(execOpts).length ? execOpts : undefined;
  execFileSync(cli, args, opts);
  return args.find((a) => a.startsWith("--outfile="))?.slice("--outfile=".length);
}

export { pathToFileURL };
