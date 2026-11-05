/**
 * Advisory library test — the counters must come from HTTP, not from a literal.
 * ────────────────────────────────────────────────────────────────────────────
 * Proves, against the live GitHub Advisory Database:
 *   1. a fresh library reports `measured: false, total: 0` (no fake number)
 *   2. a sync stores real rows, and the severity counts add up to what was stored
 *   3. pagination really pages (cursor `Link: rel="next"`): 2 pages ≠ 1 page
 *   4. lookups find what was fetched, and refuse to guess below 3 characters
 *   5. a FAILED sync never wipes a good corpus
 *   6. the `intel.advisories` kind turns a match into a finding with hashed evidence
 *
 * Run: node scripts/test-advisory-library.mjs
 * Set NODE_EXTRA_CA_CERTS if your network goes through a TLS proxy.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
import { bundleCli } from "./lib/esbuild-runner.mjs";

const cacheFile = path.join(os.tmpdir(), `nova-advisory-cache-${process.pid}.json`);
process.env.NOVA_ADVISORY_CACHE = cacheFile;
try { fs.unlinkSync(cacheFile); } catch {}

// Bundles live under the api-server's node_modules: externals (`pino`) then resolve
// exactly as they do in production, and nothing lands in git.
const bundleDir = path.join(root, "artifacts/api-server/node_modules/.cache/adv-tests");
fs.mkdirSync(bundleDir, { recursive: true });

function bundle(entry, name) {
  const out = path.join(bundleDir, `nova-${name}-${process.pid}.cjs`);
  bundleCli(root, [
      path.join(root, entry),
      "--bundle", "--platform=node", "--format=cjs", "--target=node22",
      `--outfile=${out}`, "--log-level=warning",
      "--external:pg", "--external:better-sqlite3", "--external:express", "--external:ws",
      "--external:pino", "--external:pino-*",
    ],
    { stdio: "inherit" },
  );
  return out;
}

const lib = createRequire(import.meta.url)(bundle("artifacts/api-server/src/lib/ops/advisory-library.ts", "advlib"));

const checks = [];
const check = (name, ok, detail = "") => checks.push([name, Boolean(ok), detail]);

/* 1 · fresh library */
const before = lib.libraryStatus();
check("fresh library is NOT measured", before.measured === false, `measured=${before.measured}`);
check("fresh library prints 0, not a literal", before.total === 0, `total=${before.total}`);
check("fresh library says why (Arabic)", /مش متزامنة/.test(before.says_ar));

/* 2 · real sync */
const t0 = Date.now();
const res = await lib.syncAdvisories({ pages: 2 });
const ms = Date.now() - t0;
check("sync reached api.github.com", res.pages_fetched >= 1, `pages=${res.pages_fetched} · ${ms}ms · err=${res.error ?? "none"}`);
check("sync stored real rows", res.cache.total > 0, `rows=${res.cache.total}`);
const sevSum = Object.values(res.cache.bySeverity).reduce((a, b) => a + b, 0);
check("severity counts add up to the stored rows", sevSum === res.cache.total, `${sevSum} vs ${res.cache.total}`);
check("every row has a GHSA id", res.cache.advisories.every((a) => /^GHSA-/.test(a.id)));
check("rows carry CVSS or severity", res.cache.advisories.some((a) => typeof a.cvss === "number"));
check("cache file written", fs.existsSync(cacheFile), cacheFile);

/* 3 · pagination really pages */
check("2 pages ≠ 1 page (cursor pagination works)", res.cache.total > 100, `total=${res.cache.total}`);

/* 4 · lookups */
const withPkg = res.cache.advisories.find((a) => a.packages.length > 0);
const pkgName = withPkg ? withPkg.packages[0].split(":").pop() : "";
const found = pkgName ? lib.lookupProduct(pkgName, 5) : [];
check("lookupProduct finds a package that is in the corpus", pkgName.length > 2 ? found.length > 0 : true, `«${pkgName}» → ${found.length}`);
check("lookupProduct refuses to guess on 1 char", lib.lookupProduct("n", 5).length === 0);
const withCve = res.cache.advisories.find((a) => a.cve);
check("lookupCve resolves a CVE that is in the corpus", withCve ? lib.lookupCve(withCve.cve)?.id === withCve.id : true, withCve?.cve ?? "-");
check("lookupCve rejects a malformed id", lib.lookupCve("NOT-A-CVE") === null);

/* 5 · a failed sync must not wipe the corpus */
const failing = await lib.syncAdvisories({ pages: 1, fetchImpl: async () => { throw new Error("network down (simulated)"); } });
const after = lib.libraryStatus();
check("failed sync reports the error", Boolean(failing.error), failing.error ?? "");
check("failed sync kept the old corpus", after.total === res.cache.total, `${after.total} vs ${res.cache.total}`);

/* 6 · the kind, offline, using the corpus it just built */
const { KINDS } = createRequire(import.meta.url)(bundle("artifacts/api-server/src/lib/ops/tools.ts", "tools"));
const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-adv-job-"));
const ctx = {
  host: "example.invalid",
  scheme: "http",
  program: { id: "t", name: "t", enabled: true, addedAt: new Date().toISOString(), hosts: ["example.invalid"], max_rps: 1, max_concurrency: 1 },
  jobDir, rps: 1, allowNodeTools: false, timeoutMs: 8000, log: () => undefined,
};
const kindRes = await KINDS["intel.advisories"].run(ctx, { product: pkgName || "nginx" });
check("kind runs and reports the library size", kindRes.ok === true && /مكتبة/.test(kindRes.summary), kindRes.summary.slice(0, 90));
check("kind never claims a match it did not find", kindRes.findings.every((f) => f.extra?.ghsa));
if (kindRes.findings.length) {
  const f = kindRes.findings[0];
  const ev = f.evidence[0];
  const disk = fs.readFileSync(ev.file, "utf8");
  const sha = crypto.createHash("sha256").update(Buffer.from(disk, "utf8")).digest("hex");
  check("finding evidence is on disk with a matching hash", sha === ev.sha256, f.extra.ghsa);
  check("finding confidence is honest (context, not proof)", f.confidence <= 0.5, `confidence=${f.confidence}`);
}

/* report */
let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
}
console.log(`\n${checks.length - bad}/${checks.length} checks passed · library=${lib.libraryStatus().total} rows @ ${lib.libraryStatus().at}`);
process.exit(bad === 0 ? 0 : 1);
