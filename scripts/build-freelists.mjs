#!/usr/bin/env node
/**
 * Build NOVA's wordlists out of a free, public corpus — and prove where they came from.
 * ────────────────────────────────────────────────────────────────────────────────
 * Why this exists (measured, not guessed): the box has a 1024 MB slot and a 460 MB
 * RAM ceiling (GET /api/ops/tools → `resources` at 2026-11-08T01:42Z), so the answer to
 * «storage keeps growing» is NOT to keep stuffing files onto the machine. Big lists live
 * on free object storage (GitHub release / Google Drive / Dropbox), the box pulls the one
 * file it needs, verifies the SHA-256 from the manifest, and caches it in state/.
 *
 * Provenance is part of the product: the tarball hash of SecLists is recorded in the
 * manifest. If a list cannot be traced to a source we did not fetch, it does not ship.
 *
 *   node scripts/build-freelists.mjs --from /tmp/SecLists-master [--repo]
 *
 * `--repo` writes into artifacts/api-server/src/lib/ops/wordlists/ and refreshes
 * `free-store.json` there. Without it everything lands in ./artifacts/freelists/.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const SRC = path.resolve(arg("from", "/tmp/SecLists-master"));
const INTO_REPO = argv.includes("--repo");
const OUT = INTO_REPO
  ? path.join(REPO, "artifacts", "api-server", "src", "lib", "ops", "wordlists")
  : path.join(REPO, "artifacts", "freelists");

/** Source lists per output, in priority order (most common first) + a hard cap. */
const LISTS = {
  "nova-paths-xl.txt": {
    kind: "paths",
    cap: 60_000,
    note: "Union of the public discovery lists, deduped, most-common first.",
    files: [
      "Discovery/Web-Content/common.txt",
      "Discovery/Web-Content/raft-medium-directories.txt",
      "Discovery/Web-Content/raft-large-directories.txt",
      "Discovery/Web-Content/quickhits.txt",
      "Discovery/Web-Content/big.txt",
      "Discovery/Web-Content/combined_directories.txt",
      "Discovery/Web-Content/uri-from-top-55-most-popular-apps.txt",
    ],
  },
  "nova-vuln-xl.txt": {
    kind: "paths",
    cap: 25_000,
    note: "Sensitive/config/backup paths — the list a passive scan cannot guess.",
    files: [
      "Discovery/Web-Content/Common-DB-Backups.txt",
      "Discovery/Web-Content/versioning_metafiles.txt",
      "Discovery/Web-Content/vulnerability-scan_j2ee-websites_WEB-INF.txt",
      "Discovery/Web-Content/Logins.fuzz.txt",
      "Discovery/Web-Content/Passwords.fuzz.txt",
      "Discovery/Web-Content/GraphQL.txt",
      "Discovery/Web-Content/graphql.txt",
      "Discovery/Web-Content/hashicorp-vault.txt",
      "Discovery/Web-Content/hashicorp-consul-api.txt",
      "Discovery/Web-Content/oauth-oidc-scopes.txt",
      "Discovery/Web-Content/reverse-proxy-inconsistencies.txt",
      "Discovery/Web-Content/dsstorewordlist.txt",
      "Discovery/Web-Content/Microsoft-Frontpage.txt",
      "Discovery/Web-Content/SAP-NetWeaver.txt",
      "Discovery/Web-Content/wso2-enterprise-integrator.txt",
      "Discovery/Web-Content/sap-analytics-cloud.txt",
      "Discovery/Web-Content/domino-endpoints-coldfusion39.txt",
      "Discovery/Web-Content/domino-dirs-coldfusion39.txt",
      "Discovery/Web-Content/OracleAppServer.fuzz.txt",
      "Discovery/Web-Content/coldfusion.txt",
      "Discovery/Web-Content/JavaServlets-Common.fuzz.txt",
      "Discovery/Web-Content/AdobeXML.fuzz.txt",
      "Discovery/Web-Content/tftp.fuzz.txt",
      "Discovery/Web-Content/JavaScript-Miners.txt",
      "Discovery/Web-Content/common-api-endpoints-mazen160.txt",
      "Discovery/Web-Content/mcp-server.txt",
      "Discovery/Web-Content/web-mutations.txt",
      "Discovery/Web-Content/Roundcube-123.txt",
    ],
  },
  "nova-params-xl.txt": {
    kind: "words",
    cap: 12_000,
    note: "Parameter names — what a hidden-parameter hunt actually needs.",
    files: [
      "Discovery/Web-Content/burp-parameter-names.txt",
      "Discovery/Web-Content/url-params_from-top-55-most-popular-apps.txt",
      "Discovery/Web-Content/GraphQL.txt",
    ],
  },
  "nova-subdomains-xl.txt": {
    kind: "hosts",
    cap: 150_000,
    note: "Subdomain labels, deduped. A JS resolver cannot walk this — it is for gobuster/dalfox-sized runs.",
    files: [
      "Discovery/DNS/subdomains-top1million-110000.txt",
      "Discovery/DNS/bitquark-subdomains-top100000.txt",
      "Discovery/DNS/combined_subdomains.txt",
      "Discovery/DNS/deepmagic.com-prefixes-top50000.txt",
      "Discovery/DNS/services-names.txt",
      "Discovery/DNS/fierce-hostlist.txt",
    ],
  },
};

const clean = (line, kind) => {
  let s = line.replace(/\s+$/, "").replace(/^\s+/, "");
  if (!s || s.startsWith("#") || s.startsWith("//") || s.startsWith("%")) return null;
  s = s.replace(/\s+\d+$/, ""); // raft format: "admin 5"
  if (kind === "paths") {
    if (/\s/.test(s) || s.includes("\\") || s.includes("?")) return null;
    if (!/^[\x21-\x7e]+$/.test(s)) return null;
    if (s.length > 80) return null;
    if (!s.startsWith("/")) s = `/${s}`;
    return s;
  }
  if (kind === "hosts") {
    s = s.toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(s) || s.includes("..")) return null;
    return s;
  }
  s = s.toLowerCase();
  if (!/^[a-z0-9_.\[\]-]{1,60}$/.test(s)) return null;
  return s;
};

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function build(name, spec) {
  const seen = new Set();
  const out = [];
  const used = [];
  for (const rel of spec.files) {
    const file = path.join(SRC, rel);
    if (!fs.existsSync(file)) continue; // a renamed upstream file must not kill the build
    used.push(rel);
    const txt = fs.readFileSync(file, "utf8");
    for (const raw of txt.split("\n")) {
      const s = clean(raw, spec.kind);
      if (!s) continue;
      const key = spec.kind === "paths" ? s.toLowerCase() : s;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= spec.cap) break;
    }
    if (out.length >= spec.cap) break;
  }
  if (!out.length) throw new Error(`${name}: ولا سطر من ${used.length} ملف — المصدر غلط (${SRC})`);
  const body = Buffer.from(out.join("\n") + "\n", "utf8");
  return { body, lines: out.length, used };
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`مافيش ${SRC} — نزّل SecLists الأول:\n  curl -sL https://codeload.github.com/danielmiessler/SecLists/tar.gz/refs/heads/master -o /tmp/seclists.tgz && tar -xzf /tmp/seclists.tgz -C /tmp`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { generatedAt: new Date().toISOString(), source: { name: "danielmiessler/SecLists", ref: "master", tarball: "https://codeload.github.com/danielmiessler/SecLists/tar.gz/refs/heads/master", tarballSha256: arg("src-sha", null) }, files: {} };
  for (const [name, spec] of Object.entries(LISTS)) {
    const { body, lines, used } = build(name, spec);
    fs.writeFileSync(path.join(OUT, name), body);
    manifest.files[name] = {
      kind: spec.kind,
      lines,
      bytes: body.length,
      sha256: sha256(body),
      note: spec.note,
      from: used,
    };
    console.log(`✓ ${name} · ${lines.toLocaleString("en-US")} سطر · ${(body.length / 1024).toFixed(0)} KB · من ${used.length} ملف`);
  }
  fs.writeFileSync(path.join(OUT, "free-store.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`✓ free-store.json · ${(fs.statSync(path.join(OUT, "free-store.json")).size / 1024).toFixed(0)} KB في ${OUT}`);
}

main();
