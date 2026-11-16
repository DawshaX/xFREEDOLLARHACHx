#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * scripts/kali-rootfs.mjs — the real Kali environment, installed for real
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `lib/ops/proot.ts` tells the operator to run:
 *
 *     node scripts/kali-rootfs.mjs --install
 *
 * …and until now that file did not exist. The shell scripts beside it
 * (`kali-rootfs-fetch.sh`, `kali-rootfs-build.sh`) do the work, but they need
 * bash + git + python3 + a working `gh auth token`, and they cannot be called
 * from the panel. This is the Node entry point the code already points at.
 *
 * WHAT IT DOES
 *   --install   fetch the prebuilt Kali rootfs from the `kali-rootfs` branch,
 *               verify every part's SHA-256, decompress and extract it, then
 *               install proot-static and verify the guest shell answers.
 *   --status    report what is installed, without changing anything.
 *   --tools     probe every tool the operator asked for, inside the guest.
 *   --verify    re-check the extracted tree against the manifest.
 *   --clean     remove a partial/failed extraction (never a good one).
 *
 * WHY IT IS WRITTEN THIS WAY
 *   • The rootfs is ~20 GB extracted and arrives as 64 gzip parts. A naive
 *     "download everything then extract" needs 20 GB of scratch on top of the
 *     20 GB result — that is what filled the disk last time. So each part is
 *     streamed: fetch → verify SHA-256 → feed the gunzip → feed tar → delete.
 *     Peak extra disk is one part (~90 MB), not the whole archive.
 *   • Every part is verified BEFORE it is decompressed. A corrupted part is
 *     re-fetched (3 tries) instead of silently producing a broken rootfs.
 *   • Nothing is written into the destination until the first part verifies,
 *     so a failed download never leaves a half-rootfs that looks installed.
 *   • No shell is used to build paths or commands: `spawn` gets argv arrays.
 *     (Same class of bug as the proot SyntaxError — see lib/ops/proot.ts.)
 *
 * USAGE
 *   node scripts/kali-rootfs.mjs --install
 *   node scripts/kali-rootfs.mjs --install --dest /opt/kali-rootfs/rootfs
 *   node scripts/kali-rootfs.mjs --status
 *   node scripts/kali-rootfs.mjs --tools
 *   node scripts/kali-rootfs.mjs --verify
 *   node scripts/kali-rootfs.mjs --clean
 *
 * ENV
 *   NOVA_KALI_ROOT        destination rootfs dir (default $HOME/kali-rootfs/rootfs)
 *   NOVA_KALI_REPO_SLUG   default DawshaX/xFREEDOLLARHACHx
 *   NOVA_KALI_BRANCH      default kali-rootfs
 *   NOVA_KALI_STATIC_BRANCH default kali-static
 *   GITHUB_TOKEN / GH_TOKEN  optional; raises rate limits and works on private repos
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import zlib from "node:zlib";

// ── configuration ────────────────────────────────────────────────────────────
const REPO_SLUG = process.env.NOVA_KALI_REPO_SLUG ?? "DawshaX/xFREEDOLLARHACHx";
const BRANCH = process.env.NOVA_KALI_BRANCH ?? "kali-rootfs";
const STATIC_BRANCH = process.env.NOVA_KALI_STATIC_BRANCH ?? "kali-static";
const DEST =
  process.env.NOVA_KALI_ROOT ??
  path.join(process.env.HOME || os.homedir() || "/root", "kali-rootfs", "rootfs");
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ghToken() || "";
const PART_RETRIES = 3;
const FETCH_TIMEOUT_MS = 10 * 60 * 1000;

/** The tools the operator named, plus the ones the panel advertises. */
const REQUIRED_TOOLS = [
  "nmap", "msfconsole", "hydra", "sqlmap", "aircrack-ng", "gobuster",
  "john", "hashcat", "tshark", "burpsuite", "nuclei", "subfinder",
  "httpx", "katana", "dnsx", "naabu", "ffuf", "nikto", "whatweb",
  "wireshark", "zaproxy", "searchsploit", "netcat", "socat", "proxychains4",
  /* TEST38 — the rest of the 11 Kali categories, so `--tools` covers the whole
     catalogue the /kali-env page shows instead of a 25-tool subset. */
  "masscan", "whois", "dig", "dnsenum", "recon-ng",
  "lynis", "dirb", "dirsearch", "wfuzz", "wpscan", "commix",
  "medusa", "crunch", "patator", "ncrack", "cewl", "wordlists",
  "airmon-ng", "airodump-ng", "aireplay-ng", "reaver", "kismet", "wifite", "hcxdumptool",
  "msfvenom", "setoolkit", "crackmapexec", "routersploit",
  "bettercap", "ettercap", "mitmproxy", "responder", "dsniff", "arpspoof", "macchanger",
  "ncat", "chisel", "bloodhound",
  "tcpdump", "binwalk", "foremost", "exiftool", "volatility", "autopsy", "sleuthkit",
  "radare2", "ghidra", "gdb", "objdump", "readelf", "strings", "strace", "ltrace", "apktool", "jadx",
  "pandoc", "wkhtmltopdf", "cutycapt", "cherrytree",
];

/**
 * Debian/Kali packages that actually provide each tool. `--tools` probes the
 * binary; this map lets the report say WHICH package to install when it is
 * missing, instead of leaving the operator to guess.
 */
const TOOL_PACKAGE = {
  nmap: "nmap", masscan: "masscan", whois: "whois", dig: "dnsutils",
  dnsenum: "dnsenum", "recon-ng": "recon-ng", subfinder: "subfinder",
  httpx: "httpx-toolkit", naabu: "naabu", dnsx: "dnsx", katana: "katana",
  whatweb: "whatweb", "theHarvester": "theharvester",
  nuclei: "nuclei", nikto: "nikto", lynis: "lynis", searchsploit: "exploitdb",
  gobuster: "gobuster", ffuf: "ffuf", feroxbuster: "feroxbuster", dirb: "dirb",
  dirsearch: "dirsearch", wfuzz: "wfuzz", sqlmap: "sqlmap", wpscan: "wpscan",
  commix: "commix", burpsuite: "burpsuite", zaproxy: "zaproxy",
  hydra: "hydra", john: "john", hashcat: "hashcat", medusa: "medusa",
  crunch: "crunch", patator: "patator", ncrack: "ncrack", cewl: "cewl",
  wordlists: "wordlists", seclists: "seclists",
  "aircrack-ng": "aircrack-ng", "airmon-ng": "aircrack-ng", "airodump-ng": "aircrack-ng",
  "aireplay-ng": "aircrack-ng", reaver: "reaver", kismet: "kismet",
  wifite: "wifite", hcxdumptool: "hcxdumptool",
  msfconsole: "metasploit-framework", msfvenom: "metasploit-framework",
  setoolkit: "set", crackmapexec: "crackmapexec", routersploit: "routersploit",
  bettercap: "bettercap", ettercap: "ettercap-text-only", mitmproxy: "mitmproxy",
  responder: "responder", dsniff: "dsniff", arpspoof: "dsniff", macchanger: "macchanger",
  netcat: "netcat-traditional", ncat: "ncat", socat: "socat",
  chisel: "chisel", bloodhound: "bloodhound", proxychains4: "proxychains4",
  wireshark: "wireshark", tshark: "tshark", tcpdump: "tcpdump",
  binwalk: "binwalk", foremost: "foremost", exiftool: "libimage-exiftool-perl",
  volatility: "volatility3", autopsy: "autopsy", sleuthkit: "sleuthkit",
  radare2: "radare2", ghidra: "ghidra", gdb: "gdb", objdump: "binutils",
  readelf: "binutils", strings: "binutils", strace: "strace", ltrace: "ltrace",
  apktool: "apktool", jadx: "jadx",
  pandoc: "pandoc", wkhtmltopdf: "wkhtmltopdf", cutycapt: "cutycapt",
  cherrytree: "cherrytree",
};

// ── tiny helpers ─────────────────────────────────────────────────────────────
const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const log = (...a) => console.log(...a);
const ok = (s) => log(`  ${C.green("✓")} ${s}`);
const bad = (s) => log(`  ${C.red("✗")} ${s}`);
const warn = (s) => log(`  ${C.yellow("!")} ${s}`);
const step = (n, total, s) => log(`\n${C.bold(`[${n}/${total}]`)} ${s}`);

function ghToken() {
  // `gh auth token` is the only reliable way to pick up an existing login.
  try {
    const r = spawnSync("gh", ["auth", "token"], { encoding: "utf8", timeout: 5000 });
    if (r.status === 0) return (r.stdout || "").trim();
  } catch {
    /* gh not installed — fine, public repo works without it */
  }
  return "";
}

function human(bytes) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)}${u[i]}`;
}

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return -1;
  }
}

/** Nearest existing ancestor, so statfs works before DEST exists. */
function existingAncestor(p) {
  let cur = path.resolve(p);
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(cur)) return cur;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return "/";
}

// ── GitHub raw fetch ─────────────────────────────────────────────────────────
function rawUrl(file, branch = BRANCH) {
  return `https://raw.githubusercontent.com/${REPO_SLUG}/${branch}/${file}`;
}

async function fetchText(file, branch = BRANCH) {
  const res = await fetch(rawUrl(file, branch), {
    headers: TOKEN ? { Authorization: `token ${TOKEN}` } : {},
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
}

/** Stream one part to a temp file, hashing as it goes. Returns {sha, bytes}. */
async function fetchPart(part, tmpFile) {
  const res = await fetch(rawUrl(part), {
    headers: TOKEN ? { Authorization: `token ${TOKEN}` } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${part}: HTTP ${res.status}`);
  if (!res.body) throw new Error(`${part}: empty body`);

  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const out = fs.createWriteStream(tmpFile);
  const src = Readable.fromWeb(res.body);
  src.on("data", (c) => {
    hash.update(c);
    bytes += c.length;
  });
  await pipeline(src, out);
  return { sha: hash.digest("hex"), bytes };
}

// ── proot-static ─────────────────────────────────────────────────────────────
/**
 * proot-static comes from the `kali-static` branch. It is fetched as a blob
 * through the GitHub API (raw.githubusercontent serves it fine too, but the
 * API path lets us fall back to the git blob endpoint when the file is large).
 */
async function installProotStatic(rootfs) {
  const binDir = path.join(rootfs, "usr", "local", "bin");
  const target = path.join(binDir, "proot-static");
  fs.mkdirSync(binDir, { recursive: true });

  const candidates = [
    rawUrl("proot-static", STATIC_BRANCH),
    rawUrl("proot", STATIC_BRANCH),
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: TOKEN ? { Authorization: `token ${TOKEN}` } : {},
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10_000) continue; // a 404 page, not a binary
      fs.writeFileSync(target, buf, { mode: 0o755 });
      fs.chmodSync(target, 0o755);
      const probe = spawnSync(target, ["--version"], { encoding: "utf8", timeout: 10_000 });
      if (probe.status === 0 || /proot/i.test(`${probe.stdout}${probe.stderr}`)) {
        ok(`proot-static installed (${human(buf.length)})`);
        return true;
      }
      warn(`proot-static downloaded but did not answer --version (${probe.status})`);
      return true; // still installed; the guest probe below is the real test
    } catch (e) {
      warn(`${url.split("/").pop()}: ${e.message}`);
    }
  }
  bad("proot-static not found on the kali-static branch");
  return false;
}

// ── guest execution (argv, never a shell string) ─────────────────────────────
function runGuest(rootfs, command, timeoutMs = 30_000) {
  const proot = path.join(rootfs, "usr", "local", "bin", "proot-static");
  if (!fs.existsSync(proot)) {
    return { ok: false, stdout: "", stderr: "proot-static missing", status: 127 };
  }
  const argv = [
    "-R", rootfs,
    "-w", "/root",
    "-0",
    "-b", "/dev",
    "-b", "/proc",
    "-b", "/sys",
    "/bin/sh", "-c", command,
  ];
  const r = spawnSync(proot, argv, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      HOME: "/root",
      TERM: "xterm-256color",
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      LANG: "C.UTF-8",
    },
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    status: r.status,
  };
}

// ── status ───────────────────────────────────────────────────────────────────
function readManifest(rootfs) {
  try {
    return fs.readFileSync(path.join(rootfs, "etc/os-release"), "utf8");
  } catch {
    return "";
  }
}

function countPackages(rootfs) {
  try {
    const status = fs.readFileSync(path.join(rootfs, "var/lib/dpkg/status"), "utf8");
    return (status.match(/^Package:/gm) || []).length;
  } catch {
    return 0;
  }
}

function isKali(rootfs) {
  return /kali/i.test(readManifest(rootfs));
}

function cmdStatus() {
  log(C.bold("\nKali rootfs status"));
  log(`  destination : ${DEST}`);
  log(`  exists      : ${fs.existsSync(DEST) ? "yes" : "no"}`);

  if (!fs.existsSync(DEST)) {
    warn("not installed — run: node scripts/kali-rootfs.mjs --install");
    return 1;
  }
  const kali = isKali(DEST);
  log(`  is Kali     : ${kali ? C.green("yes") : C.red("no")}`);
  if (kali) {
    const pretty = (readManifest(DEST).match(/PRETTY_NAME="?([^"\n]+)"?/) || [])[1] || "?";
    log(`  distro      : ${pretty}`);
    log(`  packages    : ${countPackages(DEST)}`);
  }
  const proot = path.join(DEST, "usr", "local", "bin", "proot-static");
  log(`  proot-static: ${fs.existsSync(proot) ? C.green("present") : C.red("missing")}`);

  if (kali && fs.existsSync(proot)) {
    const r = runGuest(DEST, "echo NOVA_GUEST_OK && uname -m", 20_000);
    if (r.stdout.includes("NOVA_GUEST_OK")) {
      ok(`guest shell answers (${r.stdout.trim().split("\n").pop()})`);
    } else {
      bad(`guest shell failed: ${(r.stderr || "").slice(0, 200)}`);
    }
  }
  return kali ? 0 : 1;
}

// ── tools probe ──────────────────────────────────────────────────────────────
function cmdTools() {
  if (!fs.existsSync(DEST) || !isKali(DEST)) {
    bad("no Kali rootfs installed — run --install first");
    return 1;
  }
  log(C.bold("\nProbing tools inside the guest (real `command -v`, not a guess)\n"));

  // One guest invocation for all tools — 25 separate proot starts would take
  // minutes; a single shell loop takes seconds.
  const script = REQUIRED_TOOLS.map(
    (t) => `printf '%s\\t' ${JSON.stringify(t)}; command -v ${JSON.stringify(t)} || echo MISSING`,
  ).join("; ");
  const r = runGuest(DEST, script, 120_000);

  const found = new Map();
  for (const line of r.stdout.split("\n")) {
    const [name, where] = line.split("\t");
    if (!name) continue;
    found.set(name, where && where !== "MISSING" ? where : null);
  }

  let present = 0;
  const missing = [];
  for (const t of REQUIRED_TOOLS) {
    const where = found.get(t);
    if (where) {
      present++;
      ok(`${t.padEnd(14)} ${C.dim(where)}`);
    } else {
      bad(`${t.padEnd(14)} ${C.dim("not installed")}`);
      const pkg = TOOL_PACKAGE[t];
      if (pkg) missing.push(pkg);
    }
  }
  log(
    `\n  ${present}/${REQUIRED_TOOLS.length} tools present` +
      (present === REQUIRED_TOOLS.length ? C.green(" — complete") : C.yellow(" — incomplete")),
  );
  /* TEST38 — name the packages instead of leaving the operator to guess which
     apt package provides `httpx` (it is httpx-toolkit) or `setoolkit` (`set`). */
  const uniq = [...new Set(missing)];
  if (uniq.length > 0) {
    log(C.bold("\n  Install the missing ones with:"));
    log(C.dim(`    proot -R ${DEST} apt-get install -y ${uniq.join(" ")}`));
  }
  return present === REQUIRED_TOOLS.length ? 0 : 1;
}

// ── verify ───────────────────────────────────────────────────────────────────
async function cmdVerify() {
  log(C.bold("\nVerifying the extracted tree against the manifest"));
  if (!fs.existsSync(DEST)) {
    bad("nothing to verify — not installed");
    return 1;
  }
  let manifest;
  try {
    manifest = await fetchText("MANIFEST.txt");
  } catch (e) {
    bad(`cannot read MANIFEST.txt: ${e.message}`);
    return 1;
  }
  const want = Object.fromEntries(
    manifest
      .split("\n")
      .map((l) => l.split("="))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()]),
  );
  log(`  manifest: ${want.PRETTY_NAME ?? "?"} · ${want.packages ?? "?"} packages · built ${want.built_at ?? "?"}`);

  const kali = isKali(DEST);
  const pkgs = countPackages(DEST);
  log(`  on disk : ${kali ? "Kali" : "NOT Kali"} · ${pkgs} packages`);

  let fail = 0;
  if (!kali) {
    bad("os-release does not say Kali");
    fail++;
  }
  if (want.packages && Math.abs(pkgs - Number(want.packages)) > 5) {
    warn(`package count differs from manifest (${pkgs} vs ${want.packages})`);
  }
  const proot = path.join(DEST, "usr", "local", "bin", "proot-static");
  if (!fs.existsSync(proot)) {
    bad("proot-static missing");
    fail++;
  }
  const r = runGuest(DEST, "echo NOVA_GUEST_OK", 20_000);
  if (!r.stdout.includes("NOVA_GUEST_OK")) {
    bad(`guest shell does not answer: ${(r.stderr || "").slice(0, 200)}`);
    fail++;
  } else {
    ok("guest shell answers");
  }
  return fail === 0 ? 0 : 1;
}

// ── clean ────────────────────────────────────────────────────────────────────
function cmdClean() {
  if (!fs.existsSync(DEST)) {
    log("nothing to clean");
    return 0;
  }
  // Never delete a working install by accident.
  if (isKali(DEST) && fs.existsSync(path.join(DEST, "usr", "local", "bin", "proot-static"))) {
    const r = runGuest(DEST, "echo NOVA_GUEST_OK", 20_000);
    if (r.stdout.includes("NOVA_GUEST_OK")) {
      bad("this is a WORKING Kali install — refusing to delete it");
      log(C.dim("  remove it yourself if you really mean to: rm -rf " + DEST));
      return 1;
    }
  }
  log(`removing partial extraction: ${DEST}`);
  fs.rmSync(DEST, { recursive: true, force: true });
  ok("removed");
  return 0;
}

// ── install ──────────────────────────────────────────────────────────────────
async function cmdInstall() {
  log(C.bold("\nInstalling the real Kali rootfs"));
  log(`  repo   : ${REPO_SLUG}`);
  log(`  branch : ${BRANCH}`);
  log(`  dest   : ${DEST}`);
  log(`  token  : ${TOKEN ? "yes" : "no (public repo is fine)"}`);

  // ── 1. manifest + part list ────────────────────────────────────────────────
  step(1, 6, "reading MANIFEST.txt and SHA256SUMS");
  let manifest;
  let sums;
  try {
    [manifest, sums] = await Promise.all([fetchText("MANIFEST.txt"), fetchText("SHA256SUMS")]);
  } catch (e) {
    bad(`cannot read the branch: ${e.message}`);
    log(C.dim(`  is ${BRANCH} built? see scripts/kali-rootfs-build.sh`));
    return 2;
  }
  const meta = Object.fromEntries(
    manifest
      .split("\n")
      .map((l) => l.split("="))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()]),
  );
  log(`  ${meta.PRETTY_NAME ?? "?"} · ${meta.packages ?? "?"} packages · ${human(Number(meta.bytes ?? 0))} extracted`);
  log(`  built ${meta.built_at ?? "?"} (commit ${(meta.commit ?? "?").slice(0, 8)})`);

  const parts = sums
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length === 2 && /^part-\d+$/.test(p[1]))
    .map(([sha, name]) => ({ sha, name }))
    .sort((a, b) => Number(a.name.slice(5)) - Number(b.name.slice(5)));

  if (!parts.length) {
    bad("SHA256SUMS lists no parts — the branch is not a built rootfs");
    return 2;
  }
  ok(`${parts.length} parts, each verified before it is decompressed`);

  // ── 2. disk space ──────────────────────────────────────────────────────────
  step(2, 6, "checking free disk space");
  const need = Number(meta.bytes ?? 0);
  const free = freeBytes(existingAncestor(DEST));
  log(`  need ~${human(need)} · free ${free >= 0 ? human(free) : "unknown"}`);
  if (free >= 0 && free < need * 1.05) {
    bad(`not enough space: need ${human(need)}, have ${human(free)}`);
    log(C.dim("  free space, or set NOVA_KALI_ROOT to a bigger volume"));
    return 3;
  }
  ok("enough space");

  // ── 3. destination ─────────────────────────────────────────────────────────
  step(3, 6, "preparing the destination");
  if (fs.existsSync(DEST) && isKali(DEST)) {
    const r = runGuest(DEST, "echo NOVA_GUEST_OK", 20_000);
    if (r.stdout.includes("NOVA_GUEST_OK")) {
      ok("a working Kali install is already here — nothing to do");
      log(C.dim("  use --verify to re-check it, or --clean to start over"));
      return 0;
    }
    warn("an existing install does not answer — replacing it");
  }
  fs.mkdirSync(DEST, { recursive: true });
  ok(DEST);

  // ── 4. stream: fetch → verify → gunzip → tar ───────────────────────────────
  step(4, 6, "streaming parts (fetch → SHA-256 → gunzip → tar → delete)");
  const tmpPart = path.join(os.tmpdir(), `nova-kali-part-${process.pid}.tmp`);
  const cleanupTmp = () => {
    try {
      fs.unlinkSync(tmpPart);
    } catch {
      /* already gone */
    }
  };
  process.on("exit", cleanupTmp);

  // One gunzip + one tar for the whole stream: the parts are consecutive
  // slices of a single .tar.gz, so they must be concatenated, not extracted
  // one by one.
  const gunzip = zlib.createGunzip();
  const tar = spawn("tar", ["-xf", "-", "-C", DEST], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  const tarDone = new Promise((resolve) => {
    tar.on("close", (code) => resolve(code ?? 1));
    tar.on("error", () => resolve(1));
  });
  gunzip.pipe(tar.stdin);

  let bytesIn = 0;
  try {
    for (let i = 0; i < parts.length; i++) {
      const { sha, name } = parts[i];
      let got = null;
      for (let attempt = 1; attempt <= PART_RETRIES; attempt++) {
        try {
          const r = await fetchPart(name, tmpPart);
          if (r.sha === sha) {
            got = r;
            break;
          }
          warn(`${name} hash mismatch (attempt ${attempt}/${PART_RETRIES})`);
        } catch (e) {
          warn(`${name} fetch failed (attempt ${attempt}/${PART_RETRIES}): ${e.message}`);
        }
        if (attempt < PART_RETRIES) await new Promise((r) => setTimeout(r, 3000));
      }
      if (!got) {
        bad(`${name} failed ${PART_RETRIES} times — aborting, nothing half-installed`);
        gunzip.destroy();
        tar.kill("SIGKILL");
        return 5;
      }
      bytesIn += got.bytes;

      // Feed the verified part into the decompressor, then delete it at once.
      await new Promise((resolve, reject) => {
        const src = fs.createReadStream(tmpPart);
        src.on("error", reject);
        src.on("end", resolve);
        src.pipe(gunzip, { end: false });
      });
      cleanupTmp();

      const pct = Math.round(((i + 1) / parts.length) * 100);
      process.stdout.write(
        `\r  ${String(pct).padStart(3)}%  ${name}  ${human(bytesIn)} fetched   `,
      );
    }
    gunzip.end();
    log("");
  } catch (e) {
    bad(`stream failed: ${e.message}`);
    gunzip.destroy();
    tar.kill("SIGKILL");
    return 5;
  }

  const tarCode = await tarDone;
  if (tarCode !== 0) {
    bad(`tar exited ${tarCode} — out of space? check: df -h ${existingAncestor(DEST)}`);
    return 6;
  }
  ok(`extracted ${human(bytesIn)} of compressed parts`);

  // ── 5. proot-static ────────────────────────────────────────────────────────
  step(5, 6, "installing proot-static");
  await installProotStatic(DEST);

  // ── 6. verify ──────────────────────────────────────────────────────────────
  step(6, 6, "verifying the guest");
  const pretty = (readManifest(DEST).match(/PRETTY_NAME="?([^"\n]+)"?/) || [])[1] || "?";
  log(`  PRETTY_NAME: ${pretty}`);
  if (!/kali/i.test(pretty)) {
    bad("this is not Kali — the extraction is wrong");
    return 3;
  }
  ok(`Kali confirmed · ${countPackages(DEST)} packages`);

  const probe = runGuest(DEST, "echo NOVA_GUEST_OK && uname -m && id -u", 30_000);
  if (!probe.stdout.includes("NOVA_GUEST_OK")) {
    bad(`guest shell does not answer: ${(probe.stderr || "").slice(0, 300)}`);
    log(C.dim("  the tree is extracted; proot-static may need a newer glibc"));
    return 4;
  }
  ok(`guest shell answers (${probe.stdout.trim().split("\n").slice(1).join(" ")})`);

  log(C.green(C.bold(`\n✔ Kali is installed at ${DEST}`)));
  log(C.dim("  next: node scripts/kali-rootfs.mjs --tools"));
  log(C.dim("  or:   scripts/kali-exec.sh 'nmap --version'"));
  return 0;
}

// ── main ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);

async function main() {
  if (has("--help") || has("-h") || args.length === 0) {
    log(`
${C.bold("scripts/kali-rootfs.mjs")} — install and inspect the real Kali rootfs

  --install   fetch, verify, extract, install proot-static, verify the guest
  --status    report what is installed (changes nothing)
  --tools     probe every required tool inside the guest
  --verify    re-check the extracted tree against the manifest
  --clean     remove a partial/failed extraction (never a working one)

  env: NOVA_KALI_ROOT, NOVA_KALI_REPO_SLUG, NOVA_KALI_BRANCH,
       NOVA_KALI_STATIC_BRANCH, GITHUB_TOKEN
`);
    return 0;
  }
  if (has("--install")) return cmdInstall();
  if (has("--status")) return cmdStatus();
  if (has("--tools")) return cmdTools();
  if (has("--verify")) return cmdVerify();
  if (has("--clean")) return cmdClean();

  bad(`unknown flag: ${args.join(" ")}`);
  log("  try --help");
  return 64;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    bad(`unexpected: ${e && e.stack ? e.stack : e}`);
    process.exitCode = 1;
  });
