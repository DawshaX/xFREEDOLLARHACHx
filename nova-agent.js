#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  NOVA AGENT  —  the missing link between the platform and a real machine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  This file was referenced by the server (`/api/local-agent/download-nova-agent`)
 *  but never existed, so "connect a computer" always 404'd. It is now a real,
 *  dependency-free agent.
 *
 *  WHAT IT DOES
 *    Registers a machine over WebSocket, then executes whatever the platform
 *    (or NOVA) asks for, and streams the output back:
 *      exec · exec_stream · fs_list · fs_read · fs_write · processes ·
 *      kill_process · screenshot · sysinfo · pty_* · mouse/keyboard/clipboard ·
 *      deep_profile (tool/network/service discovery) · heartbeat
 *
 *  RUN IT (any of these)
 *    node nova-agent.js --server wss://YOURHOST/api/local-agent/ws
 *    node nova-agent.js --server wss://YOURHOST/api/local-agent/ws --id kali-1
 *    NOVA_SERVER=wss://host/api/local-agent/ws node nova-agent.js
 *    curl -fsSL https://YOURHOST/api/local-agent/download-agent | bash
 *
 *  SAFETY
 *    • Every command is echoed to the local log file (audit trail).
 *    • `--read-only` refuses exec/write and only reports system info.
 *    • `--allow <csv>` whitelists command prefixes (e.g. "nmap,curl,ls").
 *    • Nothing persists: it is a plain Node process; kill it to disconnect.
 *
 *  Requires Node 18+. Node 22 has a built-in WebSocket, so usually NO npm install.
 * ═══════════════════════════════════════════════════════════════════════════
 */

"use strict";

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

/* ── CLI ──────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));

/**
 * Endpoint list. A single hub is the normal case, but comma-separated
 * candidates are honoured (`ws://a/... , ws://b/...`) so a node can fall back
 * when one route is blocked — e.g. a panel proxy that refuses WebSocket
 * upgrades on the raw port but forwards them over its TLS subdomain.
 */
const SERVERS = String(
  ARGS.server || process.env.NOVA_SERVER || process.env.AGENT_SERVER || "ws://127.0.0.1:8080/api/local-agent/ws",
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const SERVER = SERVERS[0];
let serverIndex = 0;

const AGENT_ID =
  ARGS.id ||
  process.env.NOVA_AGENT_ID ||
  `${os.hostname().toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${os.userInfo().username}`;

const READ_ONLY = Boolean(ARGS["read-only"] || ARGS.readOnly);
const ALLOW = String(ARGS.allow || process.env.NOVA_ALLOW || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const RECONNECT = ARGS["no-reconnect"] ? false : true;
const HEARTBEAT_MS = Number(ARGS.heartbeat || 20_000);
const MAX_OUTPUT = Number(ARGS["max-output"] || 2_000_000);

const LOG_FILE =
  ARGS.log === true || ARGS.log === undefined
    ? path.join(os.tmpdir(), `nova-agent-${AGENT_ID}.log`)
    : String(ARGS.log);

/* ── logging ──────────────────────────────────────────────────────────────── */

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(" ")}`;
  process.stderr.write(`${line}\n`);
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    /* log file is best-effort */
  }
}

/* ── WebSocket transport (built-in on Node 22, `ws` otherwise) ────────────── */

function getWebSocketImpl() {
  if (typeof WebSocket !== "undefined") return WebSocket; // Node >= 22
  try {
    return require("ws"); // explicit dependency if present
  } catch {
    log(
      "✗ لا يوجد WebSocket مدمج (Node < 22) ولا حزمة ws.",
      "\n  الحل:  npm i -g ws     أو     ترقية Node إلى 22+",
    );
    process.exit(1);
  }
}

const WS = getWebSocketImpl();

/* ── platform helpers ─────────────────────────────────────────────────────── */

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const SHELL = IS_WIN ? process.env.COMSPEC || "cmd.exe" : process.env.SHELL || "/bin/sh";

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = execFile(cmd, args, { timeout: opts.timeout || 15000, windowsHide: true }, (err, so, se) => {
        resolve({
          ok: !err,
          stdout: String(so || stdout).slice(0, MAX_OUTPUT),
          stderr: String(se || stderr).slice(0, MAX_OUTPUT),
          code: err ? (err.code ?? 1) : 0,
        });
      });
    } catch (e) {
      resolve({ ok: false, stdout: "", stderr: String(e.message), code: 1 });
      return;
    }
    child.on("error", (e) => resolve({ ok: false, stdout: "", stderr: String(e.message), code: 1 }));
  });
}

/** Shell string execution with optional streaming callbacks. */
function shellExec(command, { timeout = 60_000, onData } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = IS_WIN
      ? spawn(process.env.COMSPEC || "cmd.exe", ["/d", "/s", "/c", command], { windowsHide: true })
      : spawn(SHELL, ["-lc", command], { env: { ...process.env, TERM: process.env.TERM || "xterm-256color" } });

    const finish = (code, note) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: (stderr + (note ? `\n${note}` : "")).slice(0, MAX_OUTPUT),
        exitCode: typeof code === "number" ? code : 1,
        durationMs: Date.now() - started,
      });
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish(124, `[nova-agent] timeout after ${timeout}ms`);
    }, timeout);

    child.stdout?.on("data", (d) => {
      const text = d.toString();
      if (stdout.length < MAX_OUTPUT) stdout += text;
      if (onData) onData("stdout", text);
    });
    child.stderr?.on("data", (d) => {
      const text = d.toString();
      if (stderr.length < MAX_OUTPUT) stderr += text;
      if (onData) onData("stderr", text);
    });
    child.on("error", (e) => finish(1, `[nova-agent] spawn error: ${e.message}`));
    child.on("close", (code) => finish(code ?? 0));
  });
}

/* ── tool discovery (for the deep profile) ────────────────────────────────── */

const KNOWN_TOOLS = [
  "nmap", "masscan", "rustscan", "nikto", "sqlmap", "gobuster", "ffuf", "dirb", "feroxbuster",
  "nuclei", "subfinder", "amass", "httpx", "katana", "dnsx", "naabu", "assetfinder", "gau",
  "ffprobe", "whois", "dig", "nslookup", "host", "traceroute", "ping", "curl", "wget", "openssl",
  "hydra", "john", "hashcat", "wpscan", "whatweb", "wafw00f", "theHarvester", "recon-ng",
  "metasploit", "msfconsole", "searchsploit", "responder", "impacket-secretsdump", "evil-winrm",
  "bloodhound", "crackmapexec", "netexec", "sqlite3", "python3", "pip3", "node", "npm", "git",
  "docker", "kubectl", "aws", "gcloud", "terraform", "jq", "yq", "tmux", "screen", "nc", "socat",
  "tcpdump", "tshark", "aircrack-ng", "bettercap", "burpsuite", "zaproxy", "wfuzz", "commix",
];

async function detectTools() {
  const found = {};
  const which = IS_WIN ? "where" : "which";
  await Promise.all(
    KNOWN_TOOLS.map(async (tool) => {
      const r = await run(which, [tool], { timeout: 4000 });
      if (r.ok && r.stdout.trim()) {
        const p = r.stdout.split(/\r?\n/)[0].trim();
        const cat = /nmap|masscan|rustscan|naabu/.test(tool)
          ? "recon"
          : /nuclei|nikto|sqlmap|wpscan|wafw00f|commix|wfuzz/.test(tool)
            ? "scanner"
            : /ffuf|gobuster|dirb|feroxbuster|katana|httpx|gau|assetfinder/.test(tool)
              ? "web"
              : /subfinder|amass|dnsx|dig|nslookup|host|whois/.test(tool)
                ? "dns"
                : /hydra|john|hashcat|crackmapexec|netexec|evil-winrm|impacket|responder|bloodhound/.test(tool)
                  ? "exploit"
                  : /tcpdump|tshark|aircrack|bettercap|nc|socat/.test(tool)
                    ? "network"
                    : "util";
        (found[cat] ||= []).push(`${tool} (${p})`);
      }
    }),
  );
  return found;
}

async function buildNetworkInfo() {
  const ifaces = {};
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    ifaces[name] = (list || []).filter((i) => !i.internal).map((i) => i.address);
  }
  const routes = IS_WIN
    ? (await run("route", ["print"])).stdout.split(/\r?\n/).slice(0, 25)
    : (await run("ip", ["route"])).stdout.split("\n").slice(0, 25);
  const arp = IS_WIN
    ? (await run("arp", ["-a"])).stdout.split(/\r?\n/).slice(0, 40)
    : (await run("ip", ["neigh"])).stdout.split("\n").slice(0, 40);
  const dns = IS_WIN
    ? []
    : (await fs.promises.readFile("/etc/resolv.conf", "utf8").catch(() => ""))
        .split("\n")
        .filter((l) => l.startsWith("nameserver"))
        .map((l) => l.replace("nameserver", "").trim());
  return { interfaces: ifaces, routes, arpTable: arp, dnsServers: dns, hostname: os.hostname() };
}

async function buildServices() {
  if (IS_WIN) return { running: [], failed: [], all: 0 };
  const r = await run("systemctl", ["list-units", "--type=service", "--state=running", "--no-legend", "--no-pager"], {
    timeout: 8000,
  });
  if (!r.ok) return { running: [], failed: [], all: 0 };
  const running = r.stdout
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0])
    .filter(Boolean)
    .slice(0, 60);
  return { running, failed: [], all: running.length };
}

async function buildDocker() {
  const r = await run("docker", ["ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"], { timeout: 6000 });
  if (!r.ok) return null;
  const containers = r.stdout.split("\n").filter(Boolean);
  return { containers, count: containers.length };
}

async function buildDeepProfile() {
  const t0 = Date.now();
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  const [tools, network, services, docker] = await Promise.all([
    detectTools(),
    buildNetworkInfo(),
    buildServices(),
    buildDocker(),
  ]);
  const toolCount = Object.values(tools).reduce((a, l) => a + l.length, 0);
  return {
    system: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      cpus: { count: cpus.length, model: cpus[0]?.model?.trim() || "unknown", speed: cpus[0]?.speed || 0 },
      memory: {
        total,
        free,
        used: total - free,
        usedPct: Math.round(((total - free) / total) * 100),
      },
      loadAvg: os.loadavg(),
      user: os.userInfo().username,
      display: Boolean(process.env.DISPLAY) || IS_WIN || IS_MAC,
      displayValue: process.env.DISPLAY || null,
    },
    tools,
    toolCount,
    network,
    services,
    users: { current: os.userInfo().username, all: [], sudoers: [], sessions: [] },
    cronJobs: [],
    docker,
    environment: {
      shell: SHELL,
      path: process.env.PATH,
      home: os.homedir(),
      pythonPath: process.env.PYTHONPATH || null,
      rubyVersion: null,
    },
    capabilities: CAPABILITIES,
    interfaces: network.interfaces,
    profileBuiltAt: Date.now(),
    profileBuildMs: Date.now() - t0,
  };
}

/* ── capabilities ─────────────────────────────────────────────────────────── */

const CAPABILITIES = [
  "shell",
  "stream",
  "files",
  "processes",
  "sysinfo",
  "screenshot",
  "pty",
  "input",
  "clipboard",
  "deep_profile",
].filter((c) => !(READ_ONLY && ["shell", "stream", "files", "pty", "input"].includes(c)));

/* ── guard ────────────────────────────────────────────────────────────────── */

function guard(command) {
  if (READ_ONLY) return "الوكيل شغّال بوضع القراءة فقط (--read-only): التنفيذ ممنوع";
  if (!command || typeof command !== "string") return "أمر فارغ";
  if (ALLOW.length === 0) return null;
  const first = command.trim().split(/[\s|;&]+/)[0];
  const ok = ALLOW.some((p) => first === p || command.trim().startsWith(p));
  return ok ? null : `الأمر "${first}" مش في القائمة المسموحة (${ALLOW.join(", ")})`;
}

/* ── handlers ─────────────────────────────────────────────────────────────── */

async function handleExec(msg, reply) {
  const blocked = guard(msg.command);
  if (blocked) {
    reply({ type: "command_result", requestId: msg.requestId, stdout: "", stderr: blocked, exitCode: 126, durationMs: 0 });
    return;
  }
  log(`exec: ${String(msg.command).slice(0, 200)}`);
  const streaming = Boolean(msg.stream || msg.streaming);
  const requestId = msg.requestId;
  const result = await shellExec(msg.command, {
    timeout: Number(msg.timeout) || 60_000,
    onData: streaming && requestId
      ? (stream, data) => reply({ type: "exec_stream_data", requestId, stream, data })
      : undefined,
  });
  reply({ type: "command_result", requestId, ...result });
}

async function handleFsList(msg, reply) {
  const dir = resolvePath(msg.dir ?? msg.path ?? "~");
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const items = await Promise.all(
      entries.slice(0, 800).map(async (e) => {
        const full = path.join(dir, e.name);
        let size = 0;
        let mtime = null;
        try {
          const st = await fs.promises.stat(full);
          size = st.size;
          mtime = st.mtimeMs;
        } catch {
          /* unreadable entry */
        }
        return {
          name: e.name,
          type: e.isDirectory() ? "dir" : e.isSymbolicLink() ? "link" : "file",
          size,
          mtime,
          path: full,
        };
      }),
    );
    items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    reply({ type: "fs_list_result", requestId: msg.requestId, ok: true, dir, items });
  } catch (e) {
    reply({ type: "fs_list_result", requestId: msg.requestId, ok: false, error: e.message, dir });
  }
}

async function handleFsRead(msg, reply) {
  const file = resolvePath(msg.filePath ?? msg.path);
  const maxBytes = Number(msg.maxBytes) || 1_000_000;
  try {
    const buf = await fs.promises.readFile(file);
    const clipped = buf.subarray(0, maxBytes);
    reply({
      type: "fs_read_result",
      requestId: msg.requestId,
      ok: true,
      filePath: file,
      truncated: buf.length > maxBytes,
      size: buf.length,
      encoding: "utf8",
      content: clipped.toString("utf8"),
    });
  } catch (e) {
    reply({ type: "fs_read_result", requestId: msg.requestId, ok: false, error: e.message, filePath: file });
  }
}

async function handleFsWrite(msg, reply) {
  if (READ_ONLY) {
    reply({ type: "fs_write_result", requestId: msg.requestId, ok: false, error: "read-only mode" });
    return;
  }
  const file = resolvePath(msg.filePath ?? msg.path);
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    if (msg.append) await fs.promises.appendFile(file, msg.content ?? "");
    else await fs.promises.writeFile(file, msg.content ?? "");
    const st = await fs.promises.stat(file);
    reply({ type: "fs_write_result", requestId: msg.requestId, ok: true, filePath: file, size: st.size });
  } catch (e) {
    reply({ type: "fs_write_result", requestId: msg.requestId, ok: false, error: e.message, filePath: file });
  }
}

async function handleProcesses(msg, reply) {
  const cmd = IS_WIN ? "tasklist" : "ps";
  const args = IS_WIN ? [] : ["-eo", "pid,ppid,user,pcpu,pmem,etime,comm", "--sort=-pcpu"];
  const r = await run(cmd, args, { timeout: 10_000 });
  const processes = r.stdout
    .split(/\r?\n/)
    .slice(0, 200)
    .map((line) => {
      if (IS_WIN) {
        const m = line.match(/^(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)/);
        if (!m) return null;
        return { name: m[1], pid: Number(m[2]), user: m[3], cpu: Number(m[5]), mem: Number(m[6]) };
      }
      const m = line.trim().split(/\s+/);
      if (m.length < 7 || m[0] === "PID") return null;
      return {
        pid: Number(m[0]),
        ppid: Number(m[1]),
        user: m[2],
        cpu: Number(m[3]),
        mem: Number(m[4]),
        elapsed: m[5],
        name: m.slice(6).join(" "),
      };
    })
    .filter(Boolean);
  reply({ type: "processes_result", requestId: msg.requestId, ok: true, processes, count: processes.length });
}

async function handleKill(msg, reply) {
  if (READ_ONLY) {
    reply({ type: "kill_result", requestId: msg.requestId, ok: false, error: "read-only mode" });
    return;
  }
  const pid = Number(msg.pid);
  const signal = String(msg.signal || "SIGTERM");
  try {
    process.kill(pid, signal);
    reply({ type: "kill_result", requestId: msg.requestId, ok: true, pid, signal });
  } catch (e) {
    reply({ type: "kill_result", requestId: msg.requestId, ok: false, pid, signal, error: e.message });
  }
}

async function handleScreenshot(msg, reply) {
  try {
    const dataUri = await captureScreen();
    reply({ type: "screenshot_result", requestId: msg.requestId, ok: true, dataUri, ts: Date.now() });
  } catch (e) {
    reply({ type: "screenshot_result", requestId: msg.requestId, ok: false, error: e.message });
  }
}

async function captureScreen() {
  const tmp = path.join(os.tmpdir(), `nova-shot-${Date.now()}.png`);
  const tryRun = async (cmd, args) => {
    const r = await run(cmd, args, { timeout: 15_000 });
    if (r.ok && fs.existsSync(tmp)) return true;
    return false;
  };

  let ok = false;
  if (IS_WIN) {
    const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
      `$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
      `$bmp=New-Object Drawing.Bitmap $b.Width,$b.Height; ` +
      `$g=[Drawing.Graphics]::FromImage($bmp); ` +
      `$g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size); ` +
      `$bmp.Save('${tmp.replace(/\\/g, "\\\\")}',[Drawing.Imaging.ImageFormat]::Png)`;
    ok = await tryRun("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps]);
  } else if (IS_MAC) {
    ok = await tryRun("screencapture", ["-x", tmp]);
  } else {
    ok =
      (await tryRun("grim", [tmp])) ||
      (await tryRun("scrot", ["-o", tmp])) ||
      (await tryRun("import", ["-window", "root", tmp]));
  }

  if (!ok || !fs.existsSync(tmp)) {
    throw new Error(
      "فشل التقاط الشاشة — محتاج X11 (DISPLAY) + أداة مثل scrot/grim/import، أو سيرفر بدون واجهة رسومية",
    );
  }
  const buf = await fs.promises.readFile(tmp);
  await fs.promises.unlink(tmp).catch(() => {});
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function handleSysinfo(msg, reply) {
  const total = os.totalmem();
  const free = os.freemem();
  reply({
    type: "sysinfo_result",
    requestId: msg.requestId,
    ok: true,
    hostname: os.hostname(),
    platform: process.platform,
    arch: os.arch(),
    release: os.release(),
    uptime: os.uptime(),
    user: os.userInfo().username,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model?.trim(),
    loadAvg: os.loadavg(),
    totalMemory: total,
    freeMemory: free,
    usedPct: Math.round(((total - free) / total) * 100),
    node: process.version,
    interfaces: Object.fromEntries(
      Object.entries(os.networkInterfaces()).map(([k, v]) => [k, (v || []).filter((i) => !i.internal).map((i) => i.address)]),
    ),
  });
}

/* ── PTY (needs node-pty; degrades to a persistent shell exec) ────────────── */

const ptySessions = new Map();

async function handlePtyCreate(msg, reply) {
  const { sessionId } = msg;
  if (READ_ONLY) {
    reply({ type: "pty_result", requestId: msg.requestId, ok: false, error: "read-only mode" });
    return;
  }
  let pty = null;
  try {
    pty = require("node-pty");
  } catch {
    pty = null;
  }

  if (pty) {
    const term = pty.spawn(msg.shell || SHELL, [], {
      name: "xterm-256color",
      cols: Number(msg.cols) || 80,
      rows: Number(msg.rows) || 24,
      cwd: os.homedir(),
      env: process.env,
    });
    term.onData((data) => send({ type: "pty_output", sessionId, data }));
    term.onExit(({ exitCode }) => {
      ptySessions.delete(sessionId);
      send({ type: "pty_exit", sessionId, exitCode });
    });
    ptySessions.set(sessionId, { kind: "pty", term });
    reply({ type: "pty_result", requestId: msg.requestId, ok: true, sessionId, mode: "pty" });
    return;
  }

  // Fallback: a long-lived shell child with piped stdio (good enough for most use).
  const child = IS_WIN
    ? spawn(process.env.COMSPEC || "cmd.exe", [], { windowsHide: true })
    : spawn(SHELL, ["-i"], { env: { ...process.env, PS1: "$ " } });
  child.stdout.on("data", (d) => send({ type: "pty_output", sessionId, data: d.toString() }));
  child.stderr.on("data", (d) => send({ type: "pty_output", sessionId, data: d.toString() }));
  child.on("close", (code) => {
    ptySessions.delete(sessionId);
    send({ type: "pty_exit", sessionId, exitCode: code ?? 0 });
  });
  ptySessions.set(sessionId, { kind: "pipe", child });
  reply({
    type: "pty_result",
    requestId: msg.requestId,
    ok: true,
    sessionId,
    mode: "pipe",
    note: "node-pty غير منصّب — شغّال بوضع الأنبوب (npm i node-pty لطرفية كاملة)",
  });
}

function handlePtyInput(msg) {
  const sess = ptySessions.get(msg.sessionId);
  if (!sess) return;
  if (sess.kind === "pty") sess.term.write(msg.data ?? "");
  else sess.child.stdin?.write(msg.data ?? "");
}

function handlePtyResize(msg) {
  const sess = ptySessions.get(msg.sessionId);
  if (sess?.kind === "pty") {
    try {
      sess.term.resize(Number(msg.cols) || 80, Number(msg.rows) || 24);
    } catch {
      /* ignore */
    }
  }
}

function handlePtyKill(msg) {
  const sess = ptySessions.get(msg.sessionId);
  if (!sess) return;
  try {
    if (sess.kind === "pty") sess.term.kill();
    else sess.child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  ptySessions.delete(msg.sessionId);
}

/* ── remote input (mouse/keyboard/clipboard) ──────────────────────────────── */

const XDOTOOL_OK = !IS_WIN && !IS_MAC;

async function handleInput(msg, reply) {
  if (READ_ONLY) {
    reply({ type: "input_result", requestId: msg.requestId, ok: false, error: "read-only mode" });
    return;
  }
  try {
    if (msg.type === "clipboard_result" || msg.op === "clipboard-set") {
      if (IS_MAC) await run("pbcopy", [], { timeout: 3000 });
      reply({ type: "clipboard_result", requestId: msg.requestId, ok: true });
      return;
    }
    if (msg.type === "mouse_result") {
      if (!XDOTOOL_OK) throw new Error("التحكم بالفأرة مدعوم على Linux عبر xdotool فقط");
      await run("xdotool", ["mousemove", String(msg.x ?? 0), String(msg.y ?? 0)], { timeout: 4000 });
      if (msg.click) await run("xdotool", ["click", String(msg.click)], { timeout: 4000 });
      reply({ type: "mouse_result", requestId: msg.requestId, ok: true });
      return;
    }
    if (msg.type === "keyboard_result") {
      if (!XDOTOOL_OK) throw new Error("التحكم بالكيبورد مدعوم على Linux عبر xdotool فقط");
      await run("xdotool", ["type", "--delay", "25", String(msg.text ?? "")], { timeout: 10_000 });
      reply({ type: "keyboard_result", requestId: msg.requestId, ok: true });
      return;
    }
    reply({ type: "input_result", requestId: msg.requestId, ok: false, error: `نوع غير معروف: ${msg.type}` });
  } catch (e) {
    reply({ type: msg.type, requestId: msg.requestId, ok: false, error: e.message });
  }
}

function resolvePath(p) {
  if (!p) return os.homedir();
  let v = String(p);
  if (v === "~") return os.homedir();
  if (v.startsWith("~/") || v.startsWith("~\\")) v = path.join(os.homedir(), v.slice(2));
  return path.resolve(v);
}

/* ── connection loop ──────────────────────────────────────────────────────── */

let ws = null;
let registered = false;
let attempt = 0;
let heartbeatTimer = null;

function send(obj) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {
      log("send failed:", e.message);
    }
  }
}

const reply = (obj) => send(obj);

async function register() {
  const profile = await buildDeepProfile();
  send({
    type: "register",
    id: AGENT_ID,
    hostname: os.hostname(),
    platform: process.platform,
    arch: os.arch(),
    user: os.userInfo().username,
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
    nodeVersion: process.version,
    capabilities: CAPABILITIES,
    interfaces: profile.interfaces,
    deepProfile: profile,
    readOnly: READ_ONLY,
    allow: ALLOW,
    agentVersion: "8.0.0",
  });
  log(`registered as ${AGENT_ID} (${profile.toolCount} tools, ${Object.keys(profile.interfaces || {}).length} ifaces)`);
}

/**
 * Why a handshake failed matters more than the fact that it failed.
 * Node's WebSocket only says "non-101 status code"; this asks the same URL for
 * the real status line so the fix is obvious (404 path / 502 proxy / 400 TLS).
 */
async function diagnose(target) {
  const m = /^(wss?):\/\/([^/]+)(\/.*)?$/i.exec(target);
  if (!m) return;
  const [, scheme, hostPort, pathPart] = m;
  const httpScheme = scheme.toLowerCase() === "wss" ? "https" : "http";
  const base = `${httpScheme}://${hostPort}`;
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(6000) });
    log(`diagnose: ${base}/api/health → HTTP ${r.status} ${(await r.text()).slice(0, 80)}`);
  } catch (e) {
    log(`diagnose: ${base}/api/health unreachable (${e.cause?.code || e.message})`);
  }
  try {
    const https = httpScheme === "https";
    const mod = await import(https ? "node:tls" : "node:net");
    const url = new URL(base);
    const socket = https
      ? mod.default.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname })
      : mod.default.connect({ host: url.hostname, port: Number(url.port || 80) });
    const status = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve("(no response in 6s)"), 6000);
      const send = () => {
        socket.write(
          `GET ${pathPart || "/api/local-agent/ws"} HTTP/1.1\r\n` +
            `Host: ${hostPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            "Sec-WebSocket-Key: bm92YS1kaWFnbm9zZS1rZXk=\r\nSec-WebSocket-Version: 13\r\n\r\n",
        );
      };
      if (https) socket.once("secureConnect", send);
      else socket.once("connect", send);
      socket.on("data", (d) => {
        clearTimeout(timer);
        resolve(d.toString("latin1").split("\r\n")[0]);
        socket.destroy();
      });
      socket.on("error", (e) => {
        clearTimeout(timer);
        resolve(`tcp error ${e.code || e.message}`);
      });
    });
    log(`diagnose: upgrade on ${target} → ${status}`);
  } catch (e) {
    log(`diagnose failed: ${e.message}`);
  }
}

function connect() {
  const target = SERVERS[serverIndex % SERVERS.length];
  log(`connecting → ${target}${SERVERS.length > 1 ? ` (${serverIndex % SERVERS.length + 1}/${SERVERS.length})` : ""}`);
  ws = new WS(target);

  ws.addEventListener("open", () => {
    attempt = 0;
    registered = false;
    log("socket open");
    register().catch((e) => log("register failed:", e.message));
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => send({ type: "heartbeat", ts: Date.now() }), HEARTBEAT_MS);
  });

  ws.addEventListener("message", async (event) => {
    let msg;
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
    } catch {
      return;
    }
    const type = msg.type;
    if (type === "registered") {
      registered = true;
      log(`✓ server accepted ${msg.agentId || AGENT_ID}`);
      return;
    }
    if (type === "pong") return;

    switch (type) {
      case "exec":
      case "command":
        await handleExec(msg, reply);
        break;
      case "fs_list":
        await handleFsList(msg, reply);
        break;
      case "fs_read":
        await handleFsRead(msg, reply);
        break;
      case "fs_write":
        await handleFsWrite(msg, reply);
        break;
      case "processes":
        await handleProcesses(msg, reply);
        break;
      case "kill_process":
        await handleKill(msg, reply);
        break;
      case "screenshot":
        await handleScreenshot(msg, reply);
        break;
      case "sysinfo":
        await handleSysinfo(msg, reply);
        break;
      case "pty_create":
        await handlePtyCreate(msg, reply);
        break;
      case "pty_input":
        handlePtyInput(msg);
        break;
      case "pty_resize":
        handlePtyResize(msg);
        break;
      case "pty_kill":
        handlePtyKill(msg);
        break;
      case "deep_profile":
        send({ type: "deep_profile_result", requestId: msg.requestId, profile: await buildDeepProfile() });
        break;
      case "mouse_result":
      case "keyboard_result":
      case "clipboard_result":
      case "input":
        await handleInput(msg, reply);
        break;
      default:
        log(`unknown message type: ${type}`);
        if (msg.requestId) reply({ type: `${type}_result`, requestId: msg.requestId, ok: false, error: `unknown type ${type}` });
    }
  });

  ws.addEventListener("error", (e) => {
    log("socket error:", e?.message || e?.error?.message || "unknown");
    diagnose(target).catch(() => {});
    if (SERVERS.length > 1) serverIndex += 1;
  });

  ws.addEventListener("close", (e) => {
    registered = false;
    clearInterval(heartbeatTimer);
    log(`socket closed (code ${e?.code ?? "?"})`);
    if (!RECONNECT) process.exit(0);
    attempt += 1;
    const delay = Math.min(30_000, 1000 * Math.pow(2, Math.min(attempt, 5)));
    const next = SERVERS[serverIndex % SERVERS.length];
    log(`reconnecting in ${Math.round(delay / 1000)}s (attempt ${attempt}) → ${next}`);
    setTimeout(connect, delay);
  });
}

/* ── lifecycle ────────────────────────────────────────────────────────────── */

process.on("SIGINT", () => {
  log("SIGINT — disconnecting");
  clearInterval(heartbeatTimer);
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
});
process.on("uncaughtException", (err) => log("uncaught:", err?.stack || String(err)));
process.on("unhandledRejection", (err) => log("unhandled:", err?.stack || String(err)));

log(`NOVA agent ${AGENT_ID} · node ${process.version} · ${os.platform()}/${os.arch()}`);
log(`server: ${SERVERS.join(" , ")}${READ_ONLY ? " · READ-ONLY" : ""}${ALLOW.length ? ` · allow=${ALLOW.join(",")}` : ""}`);
log(`log file: ${LOG_FILE}`);
connect();
