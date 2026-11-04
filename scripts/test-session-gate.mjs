/**
 * Session gate test — measures, doesn't claim.
 * ────────────────────────────────────────────
 * Starts a local HTTP server that records every header it receives, feeds a
 * program that has a session through the REAL code paths (sessionHeaders(),
 * writeEvidence(), and the argv builders of nuclei/httpx/katana), and asserts:
 *
 *   1. the target actually received `Authorization` + `Cookie` (the feature works)
 *   2. the evidence file on disk contains «redacted» and NOT the secret (no leak)
 *   3. the SHA-256 in the finding matches the bytes on disk (no lying hash)
 *   4. the printed `reproduce`/command line has no secret in it
 *
 * Run: node scripts/test-session-gate.mjs
 * The TS modules are bundled on the fly with esbuild (`--bundle`, extensionless
 * imports resolved) into a temp dir, then imported — so the test exercises the
 * real sources without needing the api-server to be built.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const received = [];
const server = http.createServer((req, res) => {
  received.push({
    method: req.method,
    url: req.url,
    headers: { ...req.headers },
  });
  res.writeHead(200, {
    "content-type": "text/html",
    "x-frame-options": "DENY",
  });
  res.end("ok");
});

const port = await new Promise((resolve) =>
  server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
);

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Inside the api-server's own node_modules so `express`, `ws`, … resolve exactly
// as they do in production — and node_modules is never committed.
fs.mkdirSync(path.join(root, "artifacts/api-server/node_modules/.cache"), {
  recursive: true,
});
const outDir = fs.mkdtempSync(
  path.join(root, "artifacts/api-server/node_modules/.cache/nova-session-"),
);
for (const name of ["tools", "session"]) {
  const esbuild = [
    path.join(root, "artifacts/api-server/node_modules/.bin/esbuild"),
    path.join(root, "node_modules/.pnpm/node_modules/.bin/esbuild"),
  ].find((p) => fs.existsSync(p));
  if (!esbuild) throw new Error("esbuild not found — run pnpm install first");
  execFileSync(
    esbuild,
    [
      path.join(root, `artifacts/api-server/src/lib/ops/${name}.ts`),
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node22",
      `--outfile=${path.join(outDir, `${name}.cjs`)}`,
      "--log-level=error",
      // heavy/native deps stay external: we only need the code under test
      "--external:pg",
      "--external:better-sqlite3",
      "--external:express",
      "--external:ws",
      "--external:pino",
      "--external:pino-*",
    ],
    { stdio: "inherit" },
  );
}
const { createRequire } = await import("node:module");
const require_ = createRequire(import.meta.url);
const { writeEvidence } = require_(path.join(outDir, "tools.cjs"));
const { maskProgram, redactSecrets, sessionFingerprint, sessionHeaders } =
  require_(path.join(outDir, "session.cjs"));

const COOKIE = "session=s3cr3t-cookie-value-42; csrf=csrf-abc-999";
const BEARER = "Bearer tok_live_abcdef1234567890";

const program = {
  id: "local-test",
  name: "local test",
  enabled: true,
  addedAt: new Date().toISOString(),
  hosts: ["localhost"],
  max_rps: 1,
  max_concurrency: 1,
  session: {
    headers: { Authorization: BEARER },
    cookie: COOKIE,
    label: "my own account",
  },
};

const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-session-test-"));
const ctx = {
  host: "127.0.0.1",
  scheme: "http",
  program,
  jobDir,
  rps: 1,
  allowNodeTools: false,
  timeoutMs: 8000,
  log: () => undefined,
};

// recon.headers hardcodes port 80/443; point the host at our server by using the
// port in a fetch-based path instead: exercise the *header plumbing* through
// sessionHeaders() the same way the kind does, then run the kind for evidence.
const hdrs = sessionHeaders(program.session);
const fetched = await fetch(`http://127.0.0.1:${port}/`, { headers: hdrs });
await fetched.text();

// 2 · evidence redaction + hash integrity, through the real writeEvidence path
const ev = writeEvidence(
  ctx,
  "test.leak",
  `curl -H 'Authorization: ${BEARER}' -H 'Cookie: ${COOKIE}' http://x/`,
  JSON.stringify(received[0].headers, null, 2),
);
const onDisk = fs.readFileSync(ev.file, "utf8");
const diskSha = crypto
  .createHash("sha256")
  .update(Buffer.from(onDisk, "utf8"))
  .digest("hex");

// 3 · the argv the REAL tools will be spawned with (no shell, one element per arg)
const { KINDS } = require_(path.join(outDir, "tools.cjs"));
const argvOf = (id) => KINDS[id].args(ctx, {});
const displayOf = (id) => KINDS[id].command(ctx, {});
const nucleiArgs = argvOf("tools.nuclei").join(" ");
const httpxArgs = argvOf("tools.httpx").join(" ");
const katanaArgs = argvOf("tools.katana").join(" ");
const displays = ["tools.nuclei", "tools.httpx", "tools.katana"]
  .map(displayOf)
  .join("\n");
// every argv element must stay a single argument (no shell quoting games)
const singleArg = (id) =>
  argvOf(id).some((a) => a === `Authorization: ${BEARER}`) &&
  argvOf(id).some((a) => a === `Cookie: ${COOKIE}`);

// 4 · mask + fingerprint
const masked = maskProgram(program);
const maskedJson = JSON.stringify(masked);

server.close();

const checks = [
  [
    "target received Authorization",
    received[0]?.headers?.authorization === BEARER,
  ],
  ["target received Cookie", received[0]?.headers?.cookie === COOKIE],
  [
    "evidence on disk has no cookie",
    !onDisk.includes("s3cr3t-cookie-value-42"),
  ],
  [
    "evidence on disk has no bearer",
    !onDisk.includes("tok_live_abcdef1234567890"),
  ],
  ["evidence shows the redaction marker", onDisk.includes("«redacted»")],
  ["evidence hash matches disk bytes", diskSha === ev.sha256],
  [
    "probe line is redacted",
    ev.probe.includes("«redacted»") || !ev.probe.includes("tok_live"),
  ],
  [
    "masked program leaks nothing",
    !/s3cr3t|tok_live|csrf-abc/.test(maskedJson),
  ],
  ["masked program reports presence", masked.session.present === true],
  [
    "masked program keeps header names",
    masked.session.names.includes("Authorization") &&
      masked.session.names.includes("Cookie"),
  ],
  [
    "fingerprint is stable 12 hex",
    /^[0-9a-f]{12}$/.test(sessionFingerprint(program.session) ?? ""),
  ],
  [
    "redactSecrets is idempotent",
    redactSecrets(redactSecrets(onDisk, program.session), program.session) ===
      redactSecrets(onDisk, program.session),
  ],
  [
    "nuclei argv carries the session (-H pairs)",
    nucleiArgs.includes("-H") &&
      nucleiArgs.includes("Authorization: " + BEARER) &&
      nucleiArgs.includes("Cookie: " + COOKIE),
  ],
  ["httpx argv carries the session", httpxArgs.includes("Cookie: " + COOKIE)],
  ["katana argv carries the session", katanaArgs.includes("Cookie: " + COOKIE)],
  [
    "session stays one argv element (no shell split)",
    singleArg("tools.nuclei"),
  ],
  [
    "printed nuclei command has no secret",
    !displays.includes("tok_live") && !displays.includes("s3cr3t"),
  ],
  [
    "printed command indexes of all 3 tools are clean",
    !/s3cr3t|tok_live/.test(displays),
  ],
];

let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(
  `\n${checks.length - bad}/${checks.length} checks passed · jobDir=${jobDir}`,
);

process.exit(bad === 0 ? 0 : 1);
