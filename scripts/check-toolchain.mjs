#!/usr/bin/env node
/**
 * Does a scanner actually exist, and does it actually run?
 * ───────────────────────────────────────────────────────
 * `scripts/fetch-toolchain.mjs` is deliberately built to never fail a build: a
 * bad CDN minute must not stop a deploy. The cost of that rule is that its
 * "success" means "the script finished", which is exactly how run 41894091651
 * reported a clean scan of 4 targets in 1 ms with no tools at all.
 *
 * This script answers the other question, and it is the one that matters before
 * a scan: is the binary there, where is it, and does it start? It exits 1 when a
 * required tool is not executable, with an ::error annotation naming what is
 * missing and where the search went.
 *
 *   node scripts/check-toolchain.mjs [--need=httpx,katana,nuclei] [--json]
 *                                    [--into=vendor/bin]
 *
 * Discovery is the same order hunt-live.mjs uses — NOVA_TOOL_DIR, vendor/bin,
 * PATH, the usual system directories — so a pass here means the hunt will see it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`));
  if (!hit) return d;
  const [, v] = hit.split("=");
  return v ?? true;
};
const asJson = argv.includes("--json");
const need = String(arg("need", "httpx,katana,nuclei"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const into = path.resolve(root, String(arg("into", "vendor/bin")));

const unique = (xs) => [...new Set(xs)];

function searchDirs() {
  const home = process.env.HOME || os.homedir();
  const dirs = [
    ...(process.env.NOVA_TOOL_DIR ? process.env.NOVA_TOOL_DIR.split(path.delimiter) : []),
    into,
    ...(process.env.PATH || "").split(path.delimiter),
    "/usr/local/bin",
    "/usr/bin",
    path.join(home, ".local/bin"),
  ].filter(Boolean);
  return unique(dirs);
}

function resolve(bin) {
  for (const d of searchDirs()) {
    const f = path.join(d, bin);
    try {
      fs.accessSync(f, fs.constants.X_OK);
      return f;
    } catch {
      /* next */
    }
  }
  return null;
}

function runs(file, args = ["-version"], timeoutMs = 20_000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, code: 127, line: e.message });
      return;
    }
    let out = "";
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve({ ok: false, code: 127, line: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      const line = String(out).split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
      // The ProjectDiscovery tools answer `-version` with exit 0 and a version
      // line. Anything else is not usable: a truncated download or a wrong
      // architecture prints an error and exits non-zero, and counting that as
      // "present" is the same mistake as trusting the vendorer's exit code.
      resolve({ ok: (code ?? -1) === 0 && line.length > 0, code: code ?? -1, line: line.slice(0, 120) });
    });
  });
}

const rows = [];
for (const bin of need) {
  const file = resolve(bin);
  if (!file) {
    rows.push({ bin, ok: false, at: null, why: "not found", searched: searchDirs().length });
    continue;
  }
  const r = await runs(file, bin === "ffuf" ? ["-V"] : ["-version"]);
  rows.push({
    bin,
    ok: r.ok,
    at: path.relative(root, file).startsWith("..") ? file : path.relative(root, file),
    exit: r.code,
    line: r.line,
    why: r.ok ? null : `found but would not start (exit ${r.code})`,
  });
}

const missing = rows.filter((r) => !r.ok);
if (asJson) {
  console.log(JSON.stringify({ into, need, rows, ok: missing.length === 0 }, null, 2));
} else {
  for (const r of rows) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.bin.padEnd(8)} ${r.ok ? r.at + " · " + r.line : r.why}`);
  }
  if (missing.length) {
    console.log(`searched ${searchDirs().length} directories: ${searchDirs().join(", ")}`);
  }
}

try {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(
      summary,
      [
        "### Toolchain check (before scanning)",
        "",
        "| tool | usable | where | version |",
        "|---|---|---|---|",
        ...rows.map((r) => `| \`${r.bin}\` | ${r.ok ? "yes" : "**no**"} | ${r.at || "—"} | ${r.line || r.why || "—"} |`),
        "",
        missing.length
          ? `_${missing.length} required scanner(s) unusable — a scan cannot be claimed._`
          : "_all required scanners start._",
      ].join("\n") + "\n",
    );
  }
} catch {
  /* the exit code is the contract */
}

if (missing.length) {
  const detail = missing.map((m) => `${m.bin}: ${m.why}${m.at ? ` at ${m.at}` : ""}`).join(" · ");
  console.error(`::error title=toolchain incomplete::${detail.slice(0, 800)}`);
  process.exit(1);
}
