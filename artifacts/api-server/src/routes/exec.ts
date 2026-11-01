import { Router } from "express";
import { spawn } from "child_process";
import { broadcastLiveEvent } from "./live-events";
import { logger } from "../lib/logger";

const router = Router();

// ── Security: allowlist of safe binary prefixes ──────────────────────────────
const ALLOWED_BINS = new Set([
  "uname","whoami","uptime","df","free","ps","ss","netstat","ip","arp",
  "id","hostname","last","who","w","date","cat","ls","find","grep","awk",
  "sed","head","tail","wc","echo","printf","env","printenv","pwd","file",
  "stat","which","type","lsof","lscpu","lsblk","lspci","lsusb","lshw",
  "dmidecode","dmesg","sysctl","ulimit","nproc","nmap","nikto","gobuster",
  "subfinder","amass","whatweb","wapiti","ffuf","wfuzz","feroxbuster",
  "dirb","masscan","hydra","medusa","sqlmap","curl","wget","nc","ping",
  "traceroute","nslookup","dig","whois","host","openssl","python3","python",
  "node","java","javac","gcc","g++","make","git","apt","apt-get","pip",
  "pip3","npm","yarn","cargo","go","ruby","perl","bash","sh","zsh",
  "crontab","systemctl","service","journalctl","tcpdump","tshark","airmon-ng",
  "airodump-ng","aireplay-ng","hashcat","john","msfconsole","msfvenom",
  "metasploit","zaproxy","zap","burpsuite","mitmproxy","socat","ncat",
  "netcat","crackmapexec","impacket","enum4linux","smbclient","rpcclient",
  "ldapsearch","snmpwalk","onesixtyone","fping","arping","hping3","scapy",
  "linpeas","winpeas","pspy","ltrace","strace","strings","binwalk","exiftool",
  "foremost","volatility","autopsy","sleuthkit","ghidra","radare2","gdb",
  "objdump","readelf","nm","hexdump","xxd","base64","md5sum","sha256sum",
  "gpg","ssh","scp","rsync","ftp","telnet","mysql","psql","sqlite3",
  "redis-cli","mongo","docker","kubectl","helm","terraform","ansible",
  "stress","stress-ng","sysbench","iperf","iperf3","speedtest","htop",
  "top","vmstat","iostat","sar","mpstat","pidstat","perf","valgrind",
  "timeout","sleep","kill","pkill","killall","nice","renice","ionice",
  "stdbuf","tee","xargs","parallel","screen","tmux","watch","cmp","diff",
  "sort","uniq","tr","cut","paste","join","column","jq","yq","xmllint",
  "curl","wget","httpie","http","ab","wrk","siege","locust","k6",
  "shodan","theHarvester","recon-ng","maltego","spiderfoot","osrframework",
  "dmitry","dnsrecon","dnsenum","fierce","dnsx","puredns","massdns",
  "aquatone","eyewitness","gowitness","webscreenshot","chromium","firefox",
  "phantomjs","casperjs","playwright","puppeteer","selenium","geckodriver",
  "chromedriver","wkhtmltopdf","pdf2html","pdftk","pdfinfo","libreoffice",
  "convert","ffmpeg","imagemagick","exiv2","identify","montage","composite",
]);

const FORBIDDEN_PATTERNS = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+.*of=\/dev\/(s|h|v|xv)d/,
  />\s*\/dev\/sda/,
  /shred/,
  /:(){:|:&};:/,         // fork bomb
  /chmod\s+777\s+\//,
  /chown.*\/etc\/shadow/,
];

/**
 * Code-wrapping forms defeat the binary allowlist: `bash -c "<anything>"`
 * passes the "first token is bash" check and then runs *any* command. The panel
 * only ever sends plain commands, so these are refused unless the operator
 * explicitly opts in with NOVA_EXEC_ALLOW_SHELL=1.
 */
const CODE_WRAPPERS = [
  /\b(?:ba|z|k|da)?sh\s+-c\b/i,
  /\bnode\s+(?:-e|--eval)\b/i,
  /\bpython3?\s+-c\b/i,
  /\bperl\s+-e\b/i,
  /\bruby\s+-e\b/i,
  /\beval\s/i,
];

function isSafeCommand(cmd: string): { safe: boolean; reason?: string } {
  const trimmed = cmd.trim();

  if (process.env.NOVA_EXEC_ALLOW_SHELL !== "1") {
    for (const rx of CODE_WRAPPERS) {
      if (rx.test(trimmed)) {
        return { safe: false, reason: "code wrappers are disabled (NOVA_EXEC_ALLOW_SHELL=1 to allow)" };
      }
    }
  }

  for (const rx of FORBIDDEN_PATTERNS) {
    if (rx.test(trimmed)) {
      return { safe: false, reason: `Forbidden pattern matched: ${rx}` };
    }
  }

  // Extract the first token (the binary name, possibly with path)
  const firstToken = trimmed.split(/\s+/)[0]!;
  const binName = firstToken.includes("/")
    ? firstToken.split("/").pop()!
    : firstToken;

  // Allow shell builtins and pipeline combinators
  const SHELL_OPERATORS = new Set(["&&","||","|",";","(",")","<",">",">>","&"]);
  if (!SHELL_OPERATORS.has(binName) && !ALLOWED_BINS.has(binName)) {
    return { safe: false, reason: `Binary '${binName}' not in allowlist` };
  }

  return { safe: true };
}

function runStreaming(cmd: string, cwd = "/tmp"): AsyncGenerator<{ type: string; text?: string; exitCode?: number }> {
  return (async function* () {
    const child = spawn("/bin/sh", ["-c", cmd], {
      cwd,
      env: { ...process.env, TERM: "xterm-256color" },
    });

    const queue: Array<{ type: string; text?: string; exitCode?: number }> = [];
    let resolve: (() => void) | null = null;
    const signal = () => { if (resolve) { resolve(); resolve = null; } };

    child.stdout.on("data", (d: Buffer) => {
      queue.push({ type: "stdout", text: d.toString() });
      signal();
    });
    child.stderr.on("data", (d: Buffer) => {
      queue.push({ type: "stderr", text: d.toString() });
      signal();
    });
    child.on("close", (code) => {
      queue.push({ type: "done", exitCode: code ?? 0 });
      signal();
    });
    child.on("error", (err) => {
      queue.push({ type: "error", text: err.message });
      signal();
    });

    const MAX_WAIT = 120_000;
    const start = Date.now();
    while (true) {
      if (queue.length > 0) {
        const item = queue.shift()!;
        yield item;
        if (item.type === "done" || item.type === "error") break;
      } else if (Date.now() - start > MAX_WAIT) {
        try { child.kill("SIGKILL"); } catch { }
        yield { type: "done", exitCode: -1 };
        break;
      } else {
        await new Promise<void>((r) => { resolve = r; setTimeout(r, 500); });
      }
    }
  })();
}

/**
 * Optional shared-secret gate. When NOVA_EXEC_TOKEN is set, every exec request
 * must carry it (`?token=` or the `x-nova-token` header). Without it these
 * endpoints accept commands from anyone who can reach the port — which is the
 * default on a free host, so it is worth setting on any public deployment.
 */
function tokenOk(req: { query?: Record<string, unknown>; headers?: Record<string, unknown> }): boolean {
  const expected = (process.env.NOVA_EXEC_TOKEN || "").trim();
  if (!expected) return false; // no token configured → this check cannot pass
  const fromQuery = String((req.query?.token as string) || "");
  const fromHeader = String((req.headers?.["x-nova-token"] as string) || "");
  return fromQuery === expected || fromHeader === expected;
}

/** Is a token configured at all? (decides whether same-origin is enough) */
function tokenRequired(): boolean {
  return Boolean((process.env.NOVA_EXEC_TOKEN || "").trim());
}

/**
 * The single gate every exec endpoint goes through.
 *
 *   token configured  → only that token works (panel included)
 *   no token          → only same-origin requests work (the panel), and only
 *                       because the browser sends Origin/Referer on them
 */
function execAllowed(req: {
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}): boolean {
  if (tokenRequired()) return tokenOk(req);
  return sameOriginOk(req);
}

/**
 * Browser-only gate.
 *
 * A command endpoint open to the whole internet is not acceptable on a public
 * host. Without a token, requests are accepted only when they come from the
 * panel itself — the browser sends `Origin`/`Referer` on those calls, while
 * scanners and `curl` from a random host do not.
 *
 * Be honest about the strength: a determined attacker can forge the header.
 * This is a speed bump that stops drive-by scanners, NOT authentication. Real
 * authentication is `NOVA_EXEC_TOKEN`.
 */
function sameOriginOk(req: { headers?: Record<string, unknown> }): boolean {
  const host = String((req.headers?.host as string) || "");
  if (!host) return false;
  const origins = [req.headers?.origin, req.headers?.referer]
    .map((v) => String(v ?? ""))
    .filter(Boolean);
  if (origins.length === 0) return false;
  return origins.some((o) => {
    try {
      return new URL(o).host === host;
    } catch {
      return false;
    }
  });
}

export function execExposure(): { open: boolean; guarded: boolean; detail: string } {
  const guarded = Boolean((process.env.NOVA_EXEC_TOKEN || "").trim());
  const shell = process.env.NOVA_EXEC_ALLOW_SHELL === "1";
  const shellNote = shell ? " · أوامر الشل الملفوفة مسموحة" : "";
  return {
    open: !guarded,
    guarded,
    detail: guarded
      ? `محمي بتوكن${shellNote}`
      : `محدود على طلبات اللوحة (same-origin) — سكانر أو curl من برّه بياخد 403${shellNote}`,
  };
}

router.get("/exec/stream", async (req, res) => {
  if (!execAllowed(req)) {
    res.status(403).json({
      error: "التنفيذ متاح من اللوحة بس (أو بتوكن NOVA_EXEC_TOKEN)",
      reason: "cross-origin",
    });
    return;
  }
  const { cmd, cwd = "/tmp" } = req.query as { cmd?: string; cwd?: string };
  if (!cmd) { res.status(400).json({ error: "cmd required" }); return; }

  const check = isSafeCommand(cmd);
  if (!check.safe) {
    logger.warn({ cmd, reason: check.reason }, "exec stream blocked");
    res.status(403).json({ error: "Command not permitted", reason: check.reason });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  logger.info({ cmd }, "exec stream start");
  broadcastLiveEvent({
    type: "tool_start",
    data: { tool: "shell", message: cmd, ts: Date.now() },
    ts: new Date().toISOString(),
  });

  try {
    for await (const chunk of runStreaming(cmd, cwd)) {
      try {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        (res as any).flush?.();
      } catch { break; }

      if (chunk.type === "done" || chunk.type === "error") {
        broadcastLiveEvent({
          type: "tool_done",
          data: { tool: "shell", message: cmd, exitCode: chunk.exitCode, ts: Date.now() },
          ts: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    try {
      res.write(`data: ${JSON.stringify({ type: "error", text: String(err) })}\n\n`);
    } catch { }
  } finally {
    try { res.end(); } catch { }
  }
});

router.post("/exec/run", async (req, res) => {
  if (!execAllowed(req)) {
    res.status(403).json({
      error: "التنفيذ متاح من اللوحة بس (أو بتوكن NOVA_EXEC_TOKEN)",
      reason: "cross-origin",
    });
    return;
  }
  const { command, cmd, cwd = "/tmp", timeout = 30000 } = req.body as {
    command?: string; cmd?: string; cwd?: string; timeout?: number;
  };
  const command_ = command || cmd;
  if (!command_) { res.status(400).json({ error: "command required" }); return; }

  const check = isSafeCommand(command_);
  if (!check.safe) {
    logger.warn({ cmd: command_, reason: check.reason }, "exec run blocked");
    res.status(403).json({ error: "Command not permitted", reason: check.reason });
    return;
  }

  const t0 = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  for await (const chunk of runStreaming(command_, cwd)) {
    if (chunk.type === "stdout" && chunk.text) stdout += chunk.text;
    if (chunk.type === "stderr" && chunk.text) stderr += chunk.text;
    if (chunk.type === "done") { exitCode = chunk.exitCode ?? 0; break; }
    if (chunk.type === "error") { stderr += chunk.text ?? ""; break; }
    if (Date.now() - t0 > timeout) { exitCode = -1; break; }
  }

  res.json({ stdout, stderr, exitCode, durationMs: Date.now() - t0 });
});

export default router;
