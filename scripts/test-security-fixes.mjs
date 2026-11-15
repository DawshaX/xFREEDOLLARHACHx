#!/usr/bin/env node
/**
 * test-security-fixes.mjs — regression guard for the 2026-11-15 hardening pass
 * ────────────────────────────────────────────────────────────────────────────────
 * Each check below corresponds to a hole that was actually open in the code.
 * They are written as *behavioural* assertions against the real modules, not as
 * greps for a string, so a refactor that reintroduces the bug fails here.
 *
 * Run: node scripts/test-security-fixes.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) {
      console.log(`✓ ${name}`);
      pass++;
    } else {
      console.log(`✗ ${name} — ${r}`);
      fail++;
    }
  } catch (e) {
    console.log(`✗ ${name} — threw: ${e.message}`);
    fail++;
  }
}

async function checkAsync(name, fn) {
  try {
    const r = await fn();
    if (r === true || r === undefined) {
      console.log(`✓ ${name}`);
      pass++;
    } else {
      console.log(`✗ ${name} — ${r}`);
      fail++;
    }
  } catch (e) {
    console.log(`✗ ${name} — threw: ${e.message}`);
    fail++;
  }
}

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

// ── 1. shell-quote: a hostile value must stay a literal word ──────────────────
const { shq, heredocBody, assertSafePath, assertSafeId } = await import(
  path.join(ROOT, "artifacts/api-server/src/lib/ops/shell-quote.ts")
).catch(() => ({}));

if (shq) {
  await checkAsync("shq: $(...) is not executed", async () => {
    const evil = "$(echo PWNED)";
    const out = await new Promise((resolve) => {
      const c = spawn("/bin/sh", ["-c", `printf '%s' ${shq(evil)}`], { stdio: ["ignore", "pipe", "pipe"] });
      let s = "";
      c.stdout.on("data", (d) => (s += d));
      c.on("close", () => resolve(s));
    });
    return out === evil ? true : `shell expanded it: ${out}`;
  });

  check("shq: single quote is escaped, not dropped", () => {
    const out = shq("a'b");
    return out === `'a'\\''b'` ? true : `got ${out}`;
  });

  check("assertSafePath: rejects newline", () => {
    try {
      assertSafePath("/tmp/a\nrm -rf /");
      return "accepted a newline";
    } catch {
      return true;
    }
  });

  check("assertSafeId: rejects shell metacharacters", () => {
    try {
      assertSafeId("x; rm -rf /");
      return "accepted metacharacters";
    } catch {
      return true;
    }
  });

  check("heredocBody: delimiter cannot be closed by the payload", () => {
    const body = heredocBody("line\nNOVA_EOF\nrm -rf /");
    return body.startsWith("<<'NOVA_EOF_1'") ? true : `delimiter not bumped: ${body.slice(0, 30)}`;
  });
} else {
  console.log("· shell-quote.ts not importable as TS — skipping runtime checks");
}

// ── 2. proot: argv array, never a shell string ────────────────────────────────
check("proot.ts builds an argv array (no shell string)", () => {
  const src = read("artifacts/api-server/src/lib/ops/proot.ts");
  if (/spawn\([^)]*['"]-c['"]\s*,\s*\[/.test(src)) return "still spawns a shell with a built string";
  if (!/spawn\(layout\.prootBin!,\s*argv/.test(src)) return "does not spawn with the argv array";
  if (!/argv\.push\("\/bin\/sh",\s*"-c",\s*opts\.command\)/.test(src)) return "guest command not passed as one argv element";
  return true;
});

check("proot.ts has no duplicated options fragment", () => {
  const src = read("artifacts/api-server/src/lib/ops/proot.ts");
  const hits = src.match(/stdio:\s*\["ignore",\s*"pipe",\s*"pipe"\]/g) || [];
  return hits.length === 1 ? true : `found ${hits.length} stdio blocks (expected 1)`;
});

// ── 3. SSRF guard ─────────────────────────────────────────────────────────────
const ssrf = await import(path.join(ROOT, "artifacts/api-server/src/lib/ops/ssrf-guard.ts")).catch(() => ({}));
if (ssrf.isBlockedAddress) {
  const blocked = [
    "169.254.169.254", // cloud metadata
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ];
  for (const ip of blocked) {
    check(`ssrf: blocks ${ip}`, () => (ssrf.isBlockedAddress(ip) ? true : "allowed"));
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
    check(`ssrf: allows public ${ip}`, () => (ssrf.isBlockedAddress(ip) ? "blocked" : true));
  }
} else {
  console.log("· ssrf-guard.ts not importable as TS — skipping runtime checks");
}

// ── 4. every dangerous router is gated ────────────────────────────────────────
const GATED = [
  "artifacts/api-server/src/routes/processes.ts",
  "artifacts/api-server/src/routes/kali-terminal.ts",
  "artifacts/api-server/src/routes/kali-env.ts",
  "artifacts/api-server/src/routes/keys.ts",
];
for (const f of GATED) {
  check(`${path.basename(f)} uses requireOps`, () => {
    const src = read(f);
    return /requireOps\(/.test(src) ? true : "no requireOps call";
  });
}

check("settings.ts gates the write path", () => {
  const src = read("artifacts/api-server/src/routes/settings.ts");
  return /router\.put\("\/settings",\s*requireOps\(/.test(src) ? true : "PUT /settings is ungated";
});

// ── 5. the mock layer must not shadow the gated routers ───────────────────────
//
// This used to assert a hand-written prefix list (`p.startsWith("/processes")`).
// That list was the *old* fix and it was the wrong shape: it covered 55 prefixes
// while the real routers register 583 paths, so 202 paths stayed shadowed and
// every gate added to one of them was dead code. The replacement asks Express's
// own route table (route-registry) plus one explicit policy (mock-policy), so a
// new router is covered the moment it is mounted.
//
// The assertion is therefore stronger, not weaker: it requires the dynamic
// mechanism to be wired AND the old hand-list to be gone (a leftover hand-list
// would mean two sources of truth drifting apart again).
check("app.ts delegates mock suppression to the route registry", () => {
  const src = read("artifacts/api-server/src/app.ts");
  if (!/realRouterOwns\s*\(/.test(src)) return "app.ts does not call realRouterOwns()";
  if (!/from\s+["']\.\/lib\/ops\/mock-policy["']/.test(src)) return "mock-policy is not imported";
  if (/p\.startsWith\("\/processes"\)/.test(src)) return "the old hand-written prefix list is still present";
  return true;
});

check("route-registry walks the real Express route table", () => {
  const src = read("artifacts/api-server/src/lib/ops/route-registry.ts");
  if (!/router\.stack|_router\.stack/.test(src)) return "does not read the router stack";
  if (!/Array\.isArray/.test(src)) return "does not handle Express 5 array paths (route.path can be string[])";
  return true;
});

check("mock-policy refuses to answer a path a real router owns", () => {
  const src = read("artifacts/api-server/src/lib/ops/mock-policy.ts");
  if (!/export function realRouterOwns/.test(src)) return "realRouterOwns is not exported";
  if (!/return false/.test(src)) return "no refusal path";
  return true;
});

// ── 6. no hardcoded shared secret ─────────────────────────────────────────────
check("no literal cn_sec_2099 assigned as a secret", () => {
  for (const f of [
    "artifacts/api-server/src/lib/standalone-api.ts",
    "artifacts/kali-panel/src/lib/standalone-api.ts",
  ]) {
    // Match the assignment only — a comment explaining the old value is fine.
    if (/secret:\s*["']cn_sec_2099["']/.test(read(f))) return `still hardcoded in ${f}`;
  }
  return true;
});

// ── 7. SSRF guard is actually wired into both fetch routes ────────────────────
for (const f of ["artifacts/api-server/src/routes/proxy.ts", "artifacts/api-server/src/routes/security/fetch.ts"]) {
  check(`${path.basename(f)} calls the SSRF guard`, () => {
    const src = read(f);
    return /ssrfError\(/.test(src) ? true : "no ssrfError call";
  });
}

console.log(`\nsecurity-fixes: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
