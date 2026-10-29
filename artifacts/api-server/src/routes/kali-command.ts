/**
 * Kali Command Center — KALI AI v6
 * ════════════════════════════════════════════════════
 * v6 Major Upgrades:
 * - Deep System Intelligence: full agent profile from nova-agent v4
 * - Mission Planner: step-by-step execution with tracking
 * - Finding Extractor: auto-extract IPs, CVEs, hashes, credentials
 * - Mission Memory: persistent across sessions
 * - Auto-escalation: alternative commands on failure
 * - Rich system prompt with full tool inventory
 * - 250+ tool awareness built into every response
 */
import { Router } from "express";
import { exec as cpExec } from "child_process";
import { logger } from "../lib/logger";
import { broadcastLiveEvent } from "./live-events";
import { saveMemory, searchMemory, getAllMemory } from "./memory";
import { execOnLocalAgent, execStreamOnLocalAgent, isLocalAgentConnected, getConnectedAgentList, getAgentDeepProfile } from "./local-agent";
import { getAllSettings } from "./settings";
import os from "os";

const router = Router();

// ── Config ────────────────────────────────────────────────────────────────────
const DEFAULT_NGROK = "https://nucleus-uninjured-tusk.ngrok-free.dev";

function getConfig() {
  const map = getAllSettings();
  const provider = map.provider || "ollama-ngrok";
  const isNgrok = provider === "ollama-ngrok" || provider === "ngrok" || !provider.includes("local");
  const baseUrl = isNgrok
    ? (map.ngrokUrl || process.env.NGROK_URL || DEFAULT_NGROK).replace(/\/$/, "")
    : (map.ollamaBaseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = isNgrok
    ? (map.ngrokModel || map.ollamaModel || "dolphin-llama3:latest")
    : (map.ollamaModel || "dolphin-llama3:latest");
  return { baseUrl, model, isNgrok };
}

function makeHeaders(url: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (url.includes("ngrok")) h["ngrok-skip-browser-warning"] = "1";
  return h;
}

// ── Ngrok Keep-Alive Singleton — prevents cold-start latency on ngrok free tier ──
// Also caches model list so /chat endpoint doesn't need a blocking pre-flight
let _ngrokKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
let _lastKnownModels: string[] = [];
function startNgrokKeepalive(): void {
  if (_ngrokKeepaliveTimer) return;
  _ngrokKeepaliveTimer = setInterval(async () => {
    const { baseUrl, isNgrok } = getConfig();
    if (!isNgrok) return;
    try {
      const r = await fetch(`${baseUrl}/api/tags`, {
        headers: makeHeaders(baseUrl),
        signal: AbortSignal.timeout(5_000),
      });
      if (r.ok) {
        const data = await r.json() as { models?: Array<{ name: string }> };
        _lastKnownModels = (data.models || []).map((m) => m.name);
      }
    } catch { /* ignore — just warming the tunnel */ }
  }, 25_000);
}
startNgrokKeepalive();

// ── In-memory state ───────────────────────────────────────────────────────────
interface KaliTask {
  id: string;
  title: string;
  description: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  command?: string;
  result?: string;
  streamLines?: string[];
  error?: string;
  createdAt: number;
  type?: string;
  risk?: string;
  agentId?: string;
}

interface KaliSession {
  id: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  createdAt: number;
  updatedAt: number;
  missionContext?: MissionContext;
}

// ── Mission Planning Types ───────────────────────────────────────────────────
interface MissionStep {
  n: number;
  total: number;
  title: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  command?: string;
  result?: string;
  startedAt?: number;
  completedAt?: number;
}

interface Finding {
  id: string;
  type: "ip" | "port" | "vuln" | "cred" | "hash" | "url" | "file" | "cve" | "service" | "user";
  value: string;
  detail?: string;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  ts: number;
  source?: string;
}

interface MissionContext {
  id: string;
  goal: string;
  steps: MissionStep[];
  findings: Finding[];
  currentStep: number;
  status: "planning" | "running" | "done" | "failed";
  startedAt: number;
  completedAt?: number;
  target?: string;
}

const tasks = new Map<string, KaliTask>();
const sessions = new Map<string, KaliSession>();
let autonomousActive = false;
let autonomousSseClients = new Set<import("express").Response>();

// Global mission tracking
const activeMissions = new Map<string, MissionContext>();

// ── Finding Extractor ────────────────────────────────────────────────────────
function extractFindings(text: string, source = "kali-ai"): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Omit<Finding, "id" | "ts">) => {
    const key = `${f.type}:${f.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push({ ...f, id: `finding-${Date.now()}-${Math.random().toString(36).slice(2)}`, ts: Date.now(), source });
    }
  };

  // IPv4 addresses
  const ipRe = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
  for (const m of text.matchAll(ipRe)) {
    const ip = m[0];
    if (!ip.startsWith("0.") && !ip.startsWith("127.")) {
      add({ type: "ip", value: ip, severity: "info" });
    }
  }

  // CVE IDs
  const cveRe = /CVE-\d{4}-\d{4,}/gi;
  for (const m of text.matchAll(cveRe)) {
    add({ type: "cve", value: m[0].toUpperCase(), severity: "high" });
  }

  // Ports (from port:N or :N pattern in nmap output)
  const portRe = /\b(\d{1,5})\/(?:tcp|udp)\s+open\b/gi;
  for (const m of text.matchAll(portRe)) {
    add({ type: "port", value: m[1], detail: m[0], severity: "info" });
  }

  // Credentials (username:password patterns)
  const credRe = /\b([a-zA-Z0-9_.-]{2,20}):([^\s:'"]{4,30})\b/g;
  for (const m of text.matchAll(credRe)) {
    const [, user, pass] = m;
    if (!["http", "https", "ftp", "ssh", "mysql"].includes(user.toLowerCase())) {
      const suspiciousPass = pass.match(/[0-9]/) && pass.match(/[a-z]/i) && pass.length >= 6;
      if (suspiciousPass) add({ type: "cred", value: `${user}:${pass}`, severity: "critical" });
    }
  }

  // Hashes (MD5, SHA1, SHA256, NTLM)
  const hashRe = /\b([a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{64})\b/g;
  for (const m of text.matchAll(hashRe)) {
    const len = m[1].length;
    const hashType = len === 32 ? "MD5/NTLM" : len === 40 ? "SHA1" : "SHA256";
    add({ type: "hash", value: m[1], detail: hashType, severity: "high" });
  }

  // URLs
  const urlRe = /https?:\/\/[^\s"'<>]{10,100}/g;
  for (const m of text.matchAll(urlRe)) {
    add({ type: "url", value: m[0], severity: "info" });
  }

  // Service versions from nmap output
  const svcRe = /(\d+)\/tcp\s+open\s+(\S+)\s+(.+)/g;
  for (const m of text.matchAll(svcRe)) {
    const [, port, service, version] = m;
    add({ type: "service", value: `${port}/${service}`, detail: version.trim().slice(0, 80), severity: "info" });
  }

  return findings;
}

// ── Advanced Tool Output Parsers ─────────────────────────────────────────────

interface ParsedNmapPort { port: number; protocol: string; state: string; service: string; version: string }
interface ParsedNmapHost { ip: string; hostname?: string; status: string; ports: ParsedNmapPort[]; os?: string }

function parseNmapOutput(text: string): ParsedNmapHost[] {
  const hosts: ParsedNmapHost[] = [];
  const blocks = text.split(/(?=Nmap scan report for )/);
  for (const block of blocks) {
    const ipMatch = block.match(/Nmap scan report for (?:(\S+) \((\d+\.\d+\.\d+\.\d+)\)|(\d+\.\d+\.\d+\.\d+))/);
    if (!ipMatch) continue;
    const hostname = ipMatch[1] || undefined;
    const ip = ipMatch[2] || ipMatch[3];
    if (!ip) continue;
    const upMatch = block.match(/Host is (\w+)/);
    const status = upMatch ? upMatch[1] : "up";
    const ports: ParsedNmapPort[] = [];
    const portRe = /(\d+)\/(tcp|udp)\s+(open|filtered|closed)\s+(\S+)(?:\s+(.+))?/g;
    for (const m of block.matchAll(portRe)) {
      ports.push({ port: parseInt(m[1]), protocol: m[2], state: m[3], service: m[4], version: (m[5] || "").trim().slice(0, 80) });
    }
    const osMatch = block.match(/OS details?: (.+)/);
    hosts.push({ ip, hostname, status, ports, os: osMatch?.[1]?.trim() });
  }
  return hosts;
}

function parseGobusterOutput(text: string): Array<{ path: string; status: number; size?: number }> {
  const results: Array<{ path: string; status: number; size?: number }> = [];
  const re = /\/([\w/.-]*)\s+\(Status:\s*(\d+)\)(?:\s*\[Size:\s*(\d+)\])?/g;
  for (const m of text.matchAll(re)) {
    results.push({ path: `/${m[1]}`, status: parseInt(m[2]), size: m[3] ? parseInt(m[3]) : undefined });
  }
  return results.slice(0, 100);
}

function parseHydraOutput(text: string): Array<{ host: string; port: number; service: string; login: string; password: string }> {
  const results: Array<{ host: string; port: number; service: string; login: string; password: string }> = [];
  const re = /\[(\d+)\]\[(\w+)\]\s+host:\s*(\S+)\s+login:\s*(\S+)\s+password:\s*(\S+)/g;
  for (const m of text.matchAll(re)) {
    results.push({ port: parseInt(m[1]), service: m[2], host: m[3], login: m[4], password: m[5] });
  }
  return results;
}

function parseNiktoOutput(text: string): Array<{ finding: string; url?: string; osvdb?: string }> {
  const results: Array<{ finding: string; url?: string; osvdb?: string }> = [];
  const re = /^\+\s+(.+)$/gm;
  for (const m of text.matchAll(re)) {
    const line = m[1].trim();
    if (!line || line.startsWith("Target") || line.startsWith("Start") || line.startsWith("End")) continue;
    const osvdbMatch = line.match(/OSVDB-(\d+)/);
    const urlMatch = line.match(/(\/[^\s,]+)/);
    results.push({ finding: line.slice(0, 250), url: urlMatch?.[0], osvdb: osvdbMatch ? `OSVDB-${osvdbMatch[1]}` : undefined });
  }
  return results.slice(0, 40);
}

function detectAndParseToolOutput(cmd: string, output: string): { tool: string; data: unknown; summary: string } | null {
  if (/\bnmap\b/.test(cmd)) {
    const hosts = parseNmapOutput(output);
    if (hosts.length > 0) {
      const openPorts = hosts.flatMap(h => h.ports.filter(p => p.state === "open"));
      return { tool: "nmap", data: hosts, summary: `${hosts.length} جهاز، ${openPorts.length} منفذ مفتوح` };
    }
  }
  if (/\bgobuster\b/.test(cmd)) {
    const dirs = parseGobusterOutput(output);
    if (dirs.length > 0) {
      const ok = dirs.filter(d => d.status >= 200 && d.status < 300);
      return { tool: "gobuster", data: dirs, summary: `${dirs.length} مسار مكتشف، ${ok.length} ناجح` };
    }
  }
  if (/\bhydra\b/.test(cmd)) {
    const creds = parseHydraOutput(output);
    if (creds.length > 0) return { tool: "hydra", data: creds, summary: `🔑 ${creds.length} بيانات دخول مكتشفة!` };
  }
  if (/\bnikto\b/.test(cmd)) {
    const items = parseNiktoOutput(output);
    if (items.length > 0) return { tool: "nikto", data: items, summary: `${items.length} نقطة ضعف مكتشفة` };
  }
  return null;
}

// ── Mission Step Parser ──────────────────────────────────────────────────────
function parseMissionSteps(text: string): MissionStep[] {
  const steps: MissionStep[] = [];
  // Match [STEP n/N: title] or [STEP n/N title]
  const stepRe = /\[STEP\s+(\d+)\/(\d+)[:\s]+([^\]]+)\]/gi;
  for (const m of text.matchAll(stepRe)) {
    steps.push({
      n: parseInt(m[1]),
      total: parseInt(m[2]),
      title: m[3].trim(),
      status: "pending",
    });
  }
  return steps;
}

// ── Deep System Profile Builder ──────────────────────────────────────────────
function buildAgentSystemContext(agents: ReturnType<typeof getConnectedAgentList>): string {
  if (agents.length === 0) return "⚠️ لا يوجد جهاز كالي متصل — استخدم [EXECUTE:] للأوامر المحلية";

  const agent = agents[0];
  const profile = getAgentDeepProfile(agent.id);

  if (!profile) {
    return `✅ جهاز متصل: ${agent.user}@${agent.hostname} (${agent.platform} ${agent.arch || ""})
قدرات: ${(agent.capabilities || []).join(", ")}
⏳ جارٍ فحص النظام العميق...`;
  }

  const sys = profile.system || {};
  const tools = profile.tools || {};
  const network = profile.network || {};
  const services = profile.services || {};
  const users = profile.users || {};
  const env = profile.environment || {};

  // Build compact tool summary (top categories only for prompt brevity)
  const toolSummary: string[] = [];
  const priorityCats = ["network_scan","web_attack","password","exploit","post_exploit","recon"];
  for (const cat of priorityCats) {
    const toolList = tools[cat];
    if (Array.isArray(toolList) && toolList.length > 0) {
      toolSummary.push(`${cat}: ${(toolList as string[]).slice(0, 8).join(", ")}`);
    }
  }
  // Count total tools available without listing them all
  const totalTools = Object.values(tools).reduce((n, t) => n + (Array.isArray(t) ? t.length : 0), 0);

  const openPortsStr = Array.isArray(network.openPorts) && network.openPorts.length > 0
    ? network.openPorts.slice(0, 10).join("\n  ")
    : "لا منافذ مكشوفة";

  const runningServicesStr = Array.isArray(services.running) && services.running.length > 0
    ? services.running.slice(0, 15).join(", ")
    : "لا خدمات";

  const routesStr = Array.isArray(network.routes) && network.routes.length > 0
    ? network.routes.slice(0, 8).join("\n  ")
    : "لا مسارات";

  const interfacesStr = Object.entries(network.interfaces || {})
    .map(([iface, addrs]) => `${iface}: ${(addrs as string[]).join(", ")}`)
    .join("\n  ") || "لا واجهات";

  const dockerStr = profile.docker
    ? `✅ Docker متاح — ${profile.docker.containers?.length || 0} containers`
    : "❌ Docker غير متاح";

  const displayStr = sys.display
    ? `✅ شاشة X11 متاحة: ${sys.displayValue || ":0"}`
    : "❌ لا شاشة (headless/SSH) — استخدم CLI فقط";

  return `════════════════════════════════════════════
🖥 معلومات الجهاز المتصل (${agent.user}@${agent.hostname})
════════════════════════════════════════════
• نظام: ${sys.platform || agent.platform} ${sys.arch || agent.arch || ""} | Kernel: ${sys.release || "unknown"}
• CPU: ${sys.cpus?.count || 0} cores — ${sys.cpus?.model || "unknown"}
• ذاكرة: ${sys.memory?.usedPct || 0}% مستخدم (${Math.round((sys.memory?.used || 0) / 1024 / 1024)}MB / ${Math.round((sys.memory?.total || 0) / 1024 / 1024)}MB)
• Uptime: ${Math.round((sys.uptime || 0) / 3600)} ساعة
• المستخدم: ${users.current || agent.user} | Shell: ${env.shell || "/bin/bash"}
• شاشة: ${displayStr}
• Docker: ${dockerStr}
• Python: ${env.pythonPath || "غير متاح"}

════════════════════════════════════════════
🌐 الشبكة والمنافذ
════════════════════════════════════════════
• واجهات الشبكة:
  ${interfacesStr}
• جدول التوجيه:
  ${routesStr}
• المنافذ المفتوحة:
  ${openPortsStr}
• ARP Table: ${Array.isArray(network.arpTable) ? network.arpTable.slice(0, 5).join(" | ") : "فارغ"}
• DNS: ${Array.isArray(network.dnsServers) ? network.dnsServers.join(", ") : "غير معروف"}

════════════════════════════════════════════
🛡 الخدمات الجارية
════════════════════════════════════════════
${runningServicesStr}

════════════════════════════════════════════
⚔ أدوات الأمن (${totalTools || profile.toolCount || 0} أداة)
${toolSummary.join("\n") || "لم تُكتشف أدوات"}

════════════════════════════════════════════
👥 المستخدمون والصلاحيات
════════════════════════════════════════════
• المستخدم الحالي: ${users.current || "unknown"}
• جميع المستخدمين: ${Array.isArray(users.all) ? users.all.join(", ") : "غير معروف"}
• Sudo: ${Array.isArray(users.sudoers) && users.sudoers.length > 0 ? "✅ " + users.sudoers.join(" | ") : "محدود"}
• الجلسات النشطة: ${Array.isArray(users.sessions) ? users.sessions.join(" | ") : "لا جلسات"}

════════════════════════════════════════════
⏰ Cron Jobs
════════════════════════════════════════════
${Array.isArray(profile.cronJobs) && profile.cronJobs.length > 0
  ? (profile.cronJobs as any[]).map((c: any) => c.jobs?.join(", ") || "").join("\n")
  : "لا مهام مجدولة"}`.trim();
}

// ── Risk Assessment ───────────────────────────────────────────────────────────
interface RiskResult { risky: boolean; risk: "low" | "medium" | "high" | "critical"; reason: string }
function isRiskyCommand(cmd: string): RiskResult {
  const c = cmd.toLowerCase().trim();
  // Critical: destructive
  if (/\brm\s+-[rf]/.test(c) || /\bdd\b.*\bof=/.test(c) || /\bmkfs\b/.test(c) || /\bshred\b/.test(c)) {
    return { risky: true, risk: "critical", reason: "أمر تدميري — قد يحذف بيانات بشكل دائم" };
  }
  // Critical: active attacks
  if (/\bmetasploit\b/.test(c) || /\bmsfconsole\b/.test(c) || /\bhydra\b/.test(c) || /\bjohn\b.*--wordlist/.test(c) || /\bhashcat\b/.test(c)) {
    return { risky: true, risk: "critical", reason: "هجوم فعلي — يستهدف أنظمة خارجية" };
  }
  // High: downloads or running scripts
  if (/\bwget\b.*-[oO]\b/.test(c) || /\bcurl\b.*-[oO]\b/.test(c) || /\bpython3?\b.*\.py\b/.test(c) || /\bbash\b.*\.sh\b/.test(c)) {
    return { risky: true, risk: "high", reason: "يُحمّل ملفاً أو يُنفّذ سكريبتاً" };
  }
  // High: SQL/web attacks
  if (/\bsqlmap\b/.test(c) || /\bnikto\b/.test(c) || /\bwpscan\b/.test(c) || /\bgobuster\b/.test(c) || /\bffuf\b/.test(c)) {
    return { risky: true, risk: "high", reason: "أداة هجوم ويب — تستهدف تطبيقاً" };
  }
  // Medium: system modifications
  if (/\bapt\b.*install\b/.test(c) || /\bpip\b.*install\b/.test(c) || /\bchmod\b/.test(c) || /\bchown\b/.test(c) || /\buseradd\b/.test(c)) {
    return { risky: true, risk: "medium", reason: "يُعدّل النظام أو الصلاحيات" };
  }
  // Medium: network attacks
  if (/\bnmap\b.*-s[SUA]/.test(c) || /\bnmap\b.*--script/.test(c) || /\baircrack\b/.test(c) || /\barp-spoof\b/.test(c)) {
    return { risky: true, risk: "medium", reason: "مسح أو هجوم شبكي متقدم" };
  }
  // Low: GUI/browser
  if (/\bgoogle-chrome\b/.test(c) || /\bfirefox\b/.test(c) || /\bchromium\b/.test(c) || /\bxdg-open\b/.test(c)) {
    return { risky: true, risk: "low", reason: "يفتح واجهة رسومية على شاشة الجهاز" };
  }
  return { risky: false, risk: "low", reason: "" };
}

// ── Command Sanitizer — fix/block bad commands before execution ───────────────
function sanitizeCommand(cmd: string, hasDisplay: boolean): { ok: boolean; fixed?: string; reason?: string } {
  const c = cmd.trim();

  // ── xdg-open fixes ───────────────────────────────────────────────────────
  // xdg-open takes exactly ONE argument: a URL (https://...) or a USER FILE path
  // Common AI mistakes: "xdg-open firefox https://...", "xdg-open /usr/bin/chrome"
  const xdgMatch = c.match(/^xdg-open\s+(.+)$/);
  if (xdgMatch) {
    const arg = xdgMatch[1].trim();
    if (!hasDisplay) {
      return { ok: false, reason: `❌ xdg-open يحتاج شاشة X11/GUI — الجهاز headless. استخدم CLI بدلاً من ذلك.` };
    }
    const argParts = arg.split(/\s+/);
    const first = argParts[0];
    const rest  = argParts.slice(1).join(" ");

    // Pattern: xdg-open /usr/bin/something → that's a binary path, run it directly
    if (first.startsWith("/usr/bin/") || first.startsWith("/usr/sbin/") || first.startsWith("/bin/") || first.startsWith("/sbin/")) {
      const binName = first.split("/").pop() ?? first;
      const fullCmd = rest ? `DISPLAY=:0 ${binName} ${rest} &` : `DISPLAY=:0 ${binName} &`;
      return { ok: true, fixed: fullCmd, reason: `⚠️ xdg-open لا يُشغّل برامج — تم التحويل إلى: ${fullCmd}` };
    }
    // Pattern: xdg-open <appname> <url> → "xdg-open firefox https://..."
    if (argParts.length > 1 && !first.includes("://")) {
      const fullCmd = `DISPLAY=:0 ${first} ${rest} &`;
      return { ok: true, fixed: fullCmd, reason: `⚠️ xdg-open يأخذ argument واحد — تم التحويل: ${fullCmd}` };
    }
    // Pattern: xdg-open <url> <extra> → strip extra
    if (argParts.length > 1 && first.includes("://")) {
      return { ok: true, fixed: `xdg-open ${first}`, reason: `⚠️ xdg-open يأخذ argument واحد فقط — تم تصحيح الأمر` };
    }
    // Single arg that looks like an app name (no :// and no real file path)
    if (!arg.includes("://") && !arg.startsWith("/") && !arg.startsWith("~") && !arg.startsWith(".")) {
      return { ok: true, fixed: `DISPLAY=:0 ${arg} &`, reason: `⚠️ xdg-open يتوقع URL أو مسار — تم التحويل لتشغيل "${arg}" مباشرة` };
    }
  }

  // ── Block GUI apps on headless systems ───────────────────────────────────
  const guiApps = /^(google-chrome|google-chrome-stable|chromium|chromium-browser|firefox|firefox-esr|mousepad|gedit|nautilus|thunar|xfce4-terminal|gnome-terminal|konsole|xterm)\b/;
  if (!hasDisplay && guiApps.test(c)) {
    const appName = c.split(/\s+/)[0];
    return { ok: false, reason: `❌ "${appName}" هو تطبيق رسومي GUI — الجهاز يعمل في وضع headless (لا شاشة). استخدم CLI بدلاً من ذلك.` };
  }

  // ── Block Windows-style commands ─────────────────────────────────────────
  if (/^(cmd|powershell|tasklist|ipconfig|dir\s|netstat \/)/i.test(c)) {
    return { ok: false, reason: `❌ أمر Windows — الجهاز يعمل على Linux/Kali. استخدم: ps aux, ip addr, ls, ss -tulpn` };
  }

  return { ok: true };
}

// ── Extract display status from agent profile ─────────────────────────────────
function getAgentHasDisplay(agents: ReturnType<typeof getConnectedAgentList>): boolean {
  if (agents.length === 0) return false;
  const profile = getAgentDeepProfile(agents[0].id);
  if (!profile) return false;
  return !!(profile.system as any)?.display;
}

// ── System Prompt Builder v10 — Maximum Execution Intelligence ───────────────
function buildSystemPrompt(agentContext: string, memoryContext: string, agentConnected: boolean, hasDisplay = false): string {
  const headlessNote = agentConnected && !hasDisplay
    ? "\n⚠️ HEADLESS: no X11/display — CLI only, never xdg-open or GUI apps." : "";

  const agentSection = agentConnected
    ? `DEVICE CONNECTED:\n${agentContext}${headlessNote}`
    : `NO DEVICE CONNECTED — use [EXECUTE: cmd] for server-side commands only. Inform user to run nova-agent.js.`;

  const memSection = memoryContext ? `\nMEMORY (recent context):\n${memoryContext}` : "";

  return `You are KALI AI v10 — elite offensive security & Kali Linux intelligence inside CyberNova Omni Control. Answer in Arabic; all technical terms/commands stay in English.

══ COMMAND EXECUTION TAGS (mandatory — include in every reply that involves action) ══

[SAFE_EXEC: cmd]           → Execute IMMEDIATELY, no confirmation. Safe read-only & info commands.
[AGENT_EXEC: cmd]          → Execute on device, auto risk-assessed. Medium-risk ops, not destructive.
[CONFIRM: cmd | risk | reason] → Require user approval. risk = low/medium/high/critical.
[EXECUTE: cmd]             → Run on CyberNova server (not the Kali device).
[MISSION: goal]            → Define and start a structured mission.
[STEP N/T: title]          → Label each step in a multi-step mission.
[FINDING: type|value|detail] → Log a finding (ip, port, cve, cred, url, hash, vuln).
[MEMORY_SAVE: type|key|val] → Persist important fact to memory.
[ESCALATE: alt_cmd]        → Alternative command to try if primary fails.

══ EXECUTION POLICY ══

SAFE_EXEC (run immediately, no ask):
  id, whoami, groups, uname -a, hostname, uptime, date, env, printenv, pwd,
  ls, ls -la, find (read-only), cat, head, tail, less, grep, awk, sed (read),
  ps, ps aux, top -bn1, htop (non-interactive), pstree,
  ip addr, ip route, ip neigh, ifconfig, netstat, ss -tulpn,
  nmap -sn (ping sweep only), arp -n, arp-scan -l (passive),
  which, whereis, type, file, ldd, strings, hexdump,
  df -h, free -h, lscpu, lsmem, lsblk, lsusb, lspci, dmidecode,
  systemctl status, systemctl list-units --state=running,
  journalctl --no-pager -n 50, last, lastlog, who, w,
  cat /etc/passwd, cat /etc/group, cat /etc/os-release, cat /etc/hosts,
  cat /proc/cpuinfo, cat /proc/meminfo, cat /proc/version, cat /proc/net/*,
  sudo -l, id -Gn, getent passwd, getent group,
  searchsploit (query), msfconsole --version, python3 --version,
  git log, git status, ls /opt, ls /usr/share/wordlists,
  DISPLAY=:0 xdotool getdisplaygeometry, DISPLAY=:0 xdpyinfo,
  curl -sI URL, curl -s URL (GET only), wget -qO- URL (read only),
  dig, nslookup, host, whois, dnsrecon (passive), theHarvester (passive).

AGENT_EXEC (auto risk-assess, auto-execute if non-destructive):
  nmap -sV, nmap -A, nmap -p- (active scan — medium risk),
  nikto -h URL, whatweb URL, gobuster/ffuf/dirb (directory scan),
  curl POST, wget download, python3 script (read-only scripts),
  netcat listener nc -nlvp PORT, tcpdump -i any -c 50,
  find / -perm (privesc enum), linpeas.sh, linux-exploit-suggester.

CONFIRM required (always ask):
  sqlmap, hydra, john, hashcat, medusa, crackmapexec (password attacks),
  msfconsole with exploit, msfvenom payload generation,
  rm -rf, dd, mkfs, fdisk (destructive disk ops),
  apt-get install/remove, dpkg (package changes),
  useradd, usermod, passwd, visudo (user management),
  iptables -F, ufw disable (firewall changes),
  curl/wget executing scripts (wget|bash, curl|sh),
  crontab -e, systemctl enable/disable (persistence).

══ OPERATING RULES ══

1. ALWAYS execute, never just describe. Think → [SAFE_EXEC] → Analyze result → Chain next command.
2. Device connected → every reply must include ≥1 [SAFE_EXEC] or [AGENT_EXEC] block.
3. After receiving output: analyze it in Arabic, extract findings [FINDING:], chain next logical step.
4. Multi-step missions: use [MISSION:] + [STEP N/T:] for structured tracking.
5. On failure: try [ESCALATE:] with alternative command (e.g., sudo, alternate tool, alternate path).
6. Headless system (no DISPLAY): use CLI tools only — never xdg-open, never GUI apps.
7. Windows commands detected → reject immediately: "هذا نظام Linux/Kali — استخدم أوامر Linux".
8. Save important findings and credentials to memory: [MEMORY_SAVE: cred|hostname:service|user:pass].
9. AnyDesk workflow:
   CHECK  → [SAFE_EXEC: which anydesk && anydesk --get-id 2>/dev/null || echo NOT_INSTALLED]
   INSTALL→ [CONFIRM: apt-get install -y anydesk | medium | تثبيت AnyDesk للتحكم عن بعد]
   RESULT → ✅ AnyDesk ID: **XXXXXXXXXX** (Nova password: nova2024)
10. Wordlists: /usr/share/wordlists/rockyou.txt | /usr/share/wordlists/dirb/common.txt | /usr/share/seclists/

══ PENTEST QUICK REFERENCE ══
  Recon:    nmap -sn CIDR/24 | arp-scan -l | netdiscover -r CIDR | nmap -sV -A -p- IP
  Web:      curl -sI URL → whatweb URL → gobuster dir → nikto -h URL → sqlmap [CONFIRM]
  SMB:      smbclient -L //IP | enum4linux -a IP | crackmapexec smb IP [CONFIRM]
  Privesc:  sudo -l | find / -perm -4000 2>/dev/null | cat /etc/shadow | linpeas.sh
  Persist:  crontab -e | ~/.bashrc | systemctl [CONFIRM for all]
  Pivot:    ssh -D 1080 user@IP | proxychains | chisel/ligolo

${agentSection}${memSection}`;
}

// ── Exec on server ────────────────────────────────────────────────────────────
function execServerCommand(cmd: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = cpExec(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: err ? (err.code as number ?? 1) : 0,
        durationMs: Date.now() - t0,
      });
    });
    child.on("error", () => resolve({ stdout: "", stderr: "exec error", exitCode: 1, durationMs: Date.now() - t0 }));
  });
}

// ── SSE helper ────────────────────────────────────────────────────────────────
function sse(res: import("express").Response, event: string, data: unknown) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.();
  } catch { /* client disconnected */ }
}

// ── Build memory context for prompt ──────────────────────────────────────────
function buildMemoryContext(limit = 12): string {
  const memories = getAllMemory();
  if (memories.length === 0) return "";
  const recent = memories.slice(0, limit);
  return recent.map((m) => `[${m.memoryType}] ${m.key}: ${m.content.slice(0, 200)}`).join("\n\n");
}

// ── POST /kali-command/chat ── Main KALI AI v6 chat ──────────────────────────
router.post("/kali-command/chat", async (req, res) => {
  const { sessionId, message } = req.body as { sessionId?: string; message: string };
  if (!message?.trim()) { res.status(400).json({ error: "message required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const sid = sessionId || `kali-${Date.now()}`;
  if (!sessions.has(sid)) {
    sessions.set(sid, { id: sid, messages: [], createdAt: Date.now(), updatedAt: Date.now() });
  }
  const session = sessions.get(sid)!;

  // Build agent context using deep profile
  const agents = getConnectedAgentList();
  const agentConnected = agents.length > 0;
  const agentContext = buildAgentSystemContext(agents);
  const hasDisplay = getAgentHasDisplay(agents);
  // Pre-search memory — small window for speed
  const _userKeywords = message.match(/\b[\w\u0600-\u06ff]{3,}\b/g) || [];
  const _searchQuery = _userKeywords.slice(0, 4).join(" ");
  const _preSearch = _searchQuery ? searchMemory(_searchQuery, 2) : [];
  const _preSearchCtx = _preSearch.length > 0
    ? "\n" + _preSearch.map((m) => `[${m.memoryType}] ${m.key}: ${m.content.slice(0, 120)}`).join("\n")
    : "";
  const memoryContext = buildMemoryContext(3) + _preSearchCtx;

  const systemPrompt = buildSystemPrompt(agentContext, memoryContext, agentConnected, hasDisplay);

  sse(res, "phase", { phase: "thinking", label: "يفكر..." });

  // Build messages with history — keep short for speed
  const historyMessages = session.messages.slice(-6);
  const allMessages = [
    { role: "system" as const, content: systemPrompt },
    ...historyMessages,
    { role: "user" as const, content: message },
  ];

  session.messages.push({ role: "user", content: message });
  session.updatedAt = Date.now();

  const { baseUrl, model } = getConfig();
  const headers = makeHeaders(baseUrl);

  let assistantContent = "";
  let activeModel = model;

  // ── Background pre-flight: verify model (non-blocking, runs in parallel) ──
  // Use cached model list from keepalive pings instead of blocking here
  const cachedAvailable = _lastKnownModels;
  if (cachedAvailable.length > 0) {
    const exactMatch = cachedAvailable.find((m) => m === activeModel);
    const prefixMatch = cachedAvailable.find((m) => m.startsWith(activeModel.split(":")[0]));
    if (!exactMatch && !prefixMatch) {
      const fallback = cachedAvailable[0];
      sse(res, "model_fallback", { requested: activeModel, fallback, available: cachedAvailable });
      activeModel = fallback;
    } else {
      activeModel = exactMatch ?? prefixMatch ?? activeModel;
    }
  }

  // ── Keep-alive heartbeat every 10s so client knows we're still working ─────
  let keepAliveCount = 0;
  const keepAliveIv = setInterval(() => {
    keepAliveCount++;
    sse(res, "phase", { phase: "thinking", label: `يعالج... (${keepAliveCount * 10}s)` });
  }, 10_000);

  try {
    const ollamaRes = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: activeModel,
        messages: allMessages,
        stream: true,
        keep_alive: "10m",
        options: {
          temperature: 0.3,
          num_predict: 900,
          num_ctx: 2048,
          top_k: 20,
          top_p: 0.85,
          repeat_penalty: 1.1,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    clearInterval(keepAliveIv);

    if (!ollamaRes.ok || !ollamaRes.body) {
      let modelsHint = "";
      try {
        const tc = await fetch(`${baseUrl}/api/tags`, { headers, signal: AbortSignal.timeout(4_000) });
        if (tc.ok) {
          const td = await tc.json() as { models?: Array<{ name: string }> };
          const names = (td.models || []).map((m) => m.name);
          if (names.length > 0) modelsHint = `\n💡 النماذج المتاحة: ${names.join(", ")}`;
          else modelsHint = "\n⚠️ لا توجد نماذج مثبّتة — شغّل: ollama pull dolphin-llama3";
        }
      } catch { /* ignore */ }
      sse(res, "error", {
        error: `⚠️ Ollama HTTP ${ollamaRes.status} — النموذج "${activeModel}" غير متاح.\n\nتحقق من:\n1. تشغيل ngrok وأن الرابط صحيح في الإعدادات\n2. تثبيت النموذج: ollama pull ${activeModel}${modelsHint}`,
      });
      res.end();
      return;
    }

    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();

    sse(res, "phase", { phase: "writing", label: "يكتب الرد..." });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const j = JSON.parse(t) as { message?: { content?: string }; done?: boolean };
          if (j.message?.content) {
            assistantContent += j.message.content;
            sse(res, "delta", { text: j.message.content });
          }
        } catch { /* partial JSON */ }
      }
    }

    // Save assistant message
    session.messages.push({ role: "assistant", content: assistantContent });
    session.updatedAt = Date.now();

    // ── Parse patterns ─────────────────────────────────────────────────────
    const SAFE_EXEC_RE = /\[SAFE_EXEC:\s*([\s\S]*?)\]/g;
    const AGENT_RE = /\[AGENT_EXEC:\s*([\s\S]*?)\]/g;
    const CONFIRM_RE = /\[CONFIRM:\s*([^|\]]+)\|([^|\]]+)\|([^\]]+)\]/g;
    const SERVER_RE = /\[EXECUTE:\s*([\s\S]*?)\]/g;
    const MEM_SAVE_RE = /\[MEMORY_SAVE:\s*([^|]+)\|([^|]+)\|([^\]]+)\]/g;
    const MEM_SEARCH_RE = /\[MEMORY_SEARCH:\s*([\s\S]*?)\]/g;
    const MISSION_RE = /\[MISSION:\s*([^\]]+)\]/g;
    const STEP_RE = /\[STEP\s+(\d+)\/(\d+)[:\s]+([^\]]+)\]/gi;
    const FINDING_RE = /\[FINDING:\s*([^|\]]+)\|([^|\]]+)(?:\|([^\]]*))?\]/g;
    const ESCALATE_RE = /\[ESCALATE:\s*([\s\S]*?)\]/g;
    const NEXT_STEP_RE = /\[NEXT_STEP:\s*([^\]]+)\]/g;

    // ── Extract Findings automatically ─────────────────────────────────────
    const autoFindings = extractFindings(assistantContent);

    // ── Parse explicit FINDING tags ────────────────────────────────────────
    for (const match of assistantContent.matchAll(FINDING_RE)) {
      const [, type, value, detail] = match;
      const finding: Finding = {
        id: `finding-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: type.trim().toLowerCase() as Finding["type"],
        value: value.trim(),
        detail: detail?.trim(),
        severity: type.toLowerCase().includes("cred") || type.toLowerCase().includes("cve") ? "critical" : "info",
        ts: Date.now(),
        source: "kali-ai-explicit",
      };
      sse(res, "finding", finding);
      // Save finding to memory
      try { saveMemory("finding", `${finding.type}:${finding.value}`, JSON.stringify(finding), "kali-ai,auto"); } catch { }
    }

    // Send auto-extracted findings
    for (const finding of autoFindings.slice(0, 20)) {
      sse(res, "finding", finding);
    }

    // ── Parse MISSION ──────────────────────────────────────────────────────
    for (const match of assistantContent.matchAll(MISSION_RE)) {
      const goal = match[1].trim();
      const missionId = `mission-${Date.now()}`;
      const missionCtx: MissionContext = {
        id: missionId,
        goal,
        steps: [],
        findings: [],
        currentStep: 0,
        status: "planning",
        startedAt: Date.now(),
      };
      activeMissions.set(sid, missionCtx);
      session.missionContext = missionCtx;
      sse(res, "mission_start", { missionId, goal });
    }

    // ── Parse STEPs ────────────────────────────────────────────────────────
    const stepMatches = [...assistantContent.matchAll(STEP_RE)];
    if (stepMatches.length > 0) {
      sse(res, "phase", { phase: "planning", label: "يخطط الخطوات..." });
      const steps: MissionStep[] = stepMatches.map(m => ({
        n: parseInt(m[1]),
        total: parseInt(m[2]),
        title: m[3].trim(),
        status: "pending" as const,
      }));
      sse(res, "mission_steps", { steps });

      // Update mission context
      const missionCtx = activeMissions.get(sid) || session.missionContext;
      if (missionCtx) {
        missionCtx.steps = steps;
        missionCtx.status = "running";
      }
    }

    // ── NEXT_STEP hints ────────────────────────────────────────────────────
    for (const match of assistantContent.matchAll(NEXT_STEP_RE)) {
      sse(res, "next_step_hint", { hint: match[1].trim() });
    }

    // ── Memory saves ───────────────────────────────────────────────────────
    for (const match of assistantContent.matchAll(MEM_SAVE_RE)) {
      const [, type, key, content] = match;
      try { saveMemory(type.trim(), key.trim(), content.trim(), "kali-ai"); } catch { }
    }

    // ── Memory searches ────────────────────────────────────────────────────
    for (const match of assistantContent.matchAll(MEM_SEARCH_RE)) {
      const query = match[1].trim();
      try {
        const results = searchMemory(query, 5);
        if (results.length > 0) {
          const resultText = results.map((r) => `[${r.memoryType}] ${r.key}: ${r.content}`).join("\n\n");
          sse(res, "search_result", { query, result: resultText });
        }
      } catch { }
    }

    // ── Helper: execute on agent and stream ────────────────────────────────
    const runOnAgent = async (cmd: string, taskId: string, task: KaliTask, currentStepMatch?: RegExpMatchArray) => {
      if (!agentConnected) {
        task.status = "failed"; task.error = "لا يوجد جهاز كالي متصل";
        tasks.set(taskId, task);
        sse(res, "agent_error", { error: `⚠️ الأمر [${cmd.slice(0, 60)}] — لا يوجد وكيل كالي متصل.\nnode nova-agent.js --server wss://YOUR-DOMAIN/api/local-agent/ws --reconnect` });
        return;
      }

      // All connected agents are valid for execution

      // ── Sanitize command before execution ──────────────────────────────
      const sanitized = sanitizeCommand(cmd, hasDisplay);
      if (!sanitized.ok) {
        task.status = "failed";
        task.error = sanitized.reason;
        tasks.set(taskId, task);
        sse(res, "exec_result", {
          command: cmd,
          result: sanitized.reason || "❌ الأمر محظور",
          isError: true,
          type: "agent_blocked",
          agentHost: agents[0]?.hostname,
          taskId,
        });
        return;
      }
      const finalCmd = sanitized.fixed || cmd;
      if (sanitized.fixed && sanitized.reason) {
        sse(res, "phase", { phase: "executing", label: sanitized.reason });
      }

      const agentId = agents[0]?.id;
      let streamedOutput = "";
      const result = await execStreamOnLocalAgent(finalCmd, agentId, 60_000, (streamType, data) => {
        streamedOutput += data;
        task.streamLines = task.streamLines || [];
        task.streamLines.push(data);
        task.progress = Math.min(90, (task.streamLines.length / 10) * 100);
        sse(res, "exec_stream", { taskId, command: finalCmd, streamType, data: data.slice(0, 3000) });
      });
      const finalOutput = result
        ? (result.stdout || streamedOutput) + (result.stderr ? `\n[stderr] ${result.stderr}` : "")
        : streamedOutput || "خطأ: لم يتم الرد من الوكيل";
      const isError = !result || result.exitCode !== 0;

      if (isError && assistantContent.includes("[ESCALATE:")) {
        const escalateMatch = ESCALATE_RE.exec(assistantContent);
        if (escalateMatch) {
          const altCmd = escalateMatch[1].trim();
          sse(res, "phase", { phase: "executing", label: `🔄 تصعيد: ${altCmd.slice(0, 50)}` });
          const altResult = await execStreamOnLocalAgent(altCmd, agentId, 30_000, (st, d) => {
            sse(res, "exec_stream", { taskId, command: altCmd, streamType: st, data: d.slice(0, 2000), isEscalate: true });
          });
          if (altResult?.exitCode === 0) {
            sse(res, "exec_result", { command: altCmd, result: altResult.stdout.slice(0, 4000), isError: false, type: "agent_escalate", agentHost: agents[0]?.hostname, taskId });
          }
        }
      }
      task.status = isError && !streamedOutput ? "failed" : "done";
      task.progress = 100;
      task.result = finalOutput.slice(0, 5000);
      tasks.set(taskId, task);
      sse(res, "exec_result", { command: finalCmd, result: finalOutput.slice(0, 4000), isError, type: "agent", agentHost: agents[0]?.hostname, durationMs: result?.durationMs, taskId });
      // ── Advanced Output Parsing ─────────────────────────────────────────
      const parsedResult = detectAndParseToolOutput(finalCmd, finalOutput);
      if (parsedResult) {
        sse(res, "parsed_output", { tool: parsedResult.tool, data: parsedResult.data, summary: parsedResult.summary, command: finalCmd, taskId });
        // Auto-extract findings from parsed data (e.g. hydra creds)
        if (parsedResult.tool === "hydra") {
          const creds = parsedResult.data as Array<{ host: string; port: number; service: string; login: string; password: string }>;
          for (const c of creds) {
            sse(res, "finding", { id: `f-${Date.now()}`, type: "cred", value: `${c.login}:${c.password}`, detail: `${c.host}:${c.port}/${c.service}`, severity: "critical", ts: Date.now(), source: "hydra-parser" });
          }
        }
        if (parsedResult.tool === "nmap") {
          const hosts = parsedResult.data as ParsedNmapHost[];
          for (const h of hosts) {
            for (const p of h.ports.filter(pt => pt.state === "open")) {
              sse(res, "finding", { id: `f-${Date.now()}-${p.port}`, type: "service", value: `${p.port}/${p.service}`, detail: `${h.ip}${p.version ? " — " + p.version : ""}`, severity: "info", ts: Date.now(), source: "nmap-parser" });
            }
          }
        }
      }

      // ── Self-Healing: retry with sudo on permission errors ──────────────
      if (isError && !streamedOutput.includes("[ESCALATE:")) {
        const errText = (finalOutput + "").toLowerCase();
        const isPermDenied = errText.includes("permission denied") || errText.includes("operation not permitted") || errText.includes("must be root") || errText.includes("need root") || errText.includes("eacces");
        const isNotFound = errText.includes("command not found") || errText.includes("not found") || errText.includes("no such file");
        const alreadySudo = finalCmd.trim().startsWith("sudo ");
        if (isPermDenied && !alreadySudo) {
          const sudoCmd = `sudo ${finalCmd}`;
          sse(res, "self_heal", { original: finalCmd, attempt: sudoCmd, reason: "permission_denied", status: "trying" });
          sse(res, "phase", { phase: "executing", label: `🔄 Self-Heal: sudo ${finalCmd.slice(0, 40)}` });
          const healResult = await execStreamOnLocalAgent(sudoCmd, agentId, 45_000, (st, d) => {
            sse(res, "exec_stream", { taskId, command: sudoCmd, streamType: st, data: d.slice(0, 2000), isSelfHeal: true });
          });
          if (healResult && healResult.exitCode === 0) {
            sse(res, "self_heal", { original: finalCmd, attempt: sudoCmd, reason: "permission_denied", status: "success" });
            sse(res, "exec_result", { command: sudoCmd, result: (healResult.stdout || "").slice(0, 4000), isError: false, type: "agent_healed", agentHost: agents[0]?.hostname, durationMs: healResult.durationMs, taskId });
            const healParsed = detectAndParseToolOutput(sudoCmd, healResult.stdout || "");
            if (healParsed) sse(res, "parsed_output", { tool: healParsed.tool, data: healParsed.data, summary: healParsed.summary, command: sudoCmd, taskId, healed: true });
          } else {
            sse(res, "self_heal", { original: finalCmd, attempt: sudoCmd, reason: "permission_denied", status: "failed" });
          }
        } else if (isNotFound) {
          const toolName = finalCmd.trim().split(/\s+/)[0];
          sse(res, "self_heal", { original: finalCmd, attempt: `apt-get install -y ${toolName}`, reason: "not_found", status: "info" });
        }
      }

      const outputFindings = extractFindings(finalOutput, `exec:${finalCmd.slice(0, 30)}`);
      for (const f of outputFindings.slice(0, 15)) sse(res, "finding", f);
      if (currentStepMatch) {
        sse(res, "step_update", { n: parseInt(currentStepMatch[1]), total: parseInt(currentStepMatch[2]), title: currentStepMatch[3].trim(), status: isError && !streamedOutput ? "failed" : "done", command: finalCmd, result: finalOutput.slice(0, 500) });
      }
      broadcastLiveEvent({ type: "shell_output", data: { tool: "kali_ai_v9", command: finalCmd, output: finalOutput.slice(0, 500), isError, ts: Date.now() }, ts: new Date().toISOString() });
      if (!isError && finalOutput.length > 50) { try { saveMemory("kali_exec", finalCmd.slice(0, 60), finalOutput.slice(0, 1000), "kali-ai,auto"); } catch { } }
      if (outputFindings.length > 0) { try { saveMemory("findings", `exec:${finalCmd.slice(0, 40)}`, outputFindings.slice(0, 5).map(f => `${f.type}:${f.value}`).join(", "), "kali-ai,finding"); } catch { } }
    };

    // ── SAFE_EXEC commands — always execute immediately ────────────────────
    const safeExecMatches = [...assistantContent.matchAll(SAFE_EXEC_RE)];
    await Promise.all(safeExecMatches.map(async (match) => {
      const cmd = match[1].trim();
      if (!cmd) return;
      sse(res, "phase", { phase: "executing", label: `▶ ${cmd.slice(0, 50)}` });
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const task: KaliTask = { id: taskId, title: cmd.slice(0, 80), description: `SAFE: ${cmd}`, status: "running", progress: 10, command: cmd, streamLines: [], createdAt: Date.now(), type: "agent", risk: "low", agentId: agents[0]?.id };
      tasks.set(taskId, task);
      sse(res, "task_created", { taskId, command: cmd, isSafe: true });
      await runOnAgent(cmd, taskId, task);
    }));

    // ── CONFIRM commands — send for user approval ──────────────────────────
    const confirmMatches = [...assistantContent.matchAll(CONFIRM_RE)];
    for (const match of confirmMatches) {
      const [, cmd, risk, reason] = match;
      const confirmId = `conf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sse(res, "confirm_required", {
        id: confirmId,
        cmd: cmd.trim(),
        risk: risk.trim().toLowerCase(),
        reason: reason.trim(),
        agentId: agents[0]?.id,
        agentHost: agents[0]?.hostname,
      });
    }

    // ── AGENT_EXEC commands — with risk assessment ─────────────────────────
    const agentMatches = [...assistantContent.matchAll(AGENT_RE)];
    let stepIndex = 0;

    for (const match of agentMatches) {
      const cmd = match[1].trim();
      if (!cmd) continue;

      const currentStepMatch = stepMatches[stepIndex];

      // Risk assessment — risky commands go to confirm flow
      const riskResult = isRiskyCommand(cmd);
      if (riskResult.risky) {
        const confirmId = `conf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sse(res, "confirm_required", {
          id: confirmId, cmd, risk: riskResult.risk, reason: riskResult.reason,
          agentId: agents[0]?.id, agentHost: agents[0]?.hostname,
        });
        if (currentStepMatch) {
          sse(res, "step_update", { n: parseInt(currentStepMatch[1]), total: parseInt(currentStepMatch[2]), title: currentStepMatch[3].trim(), status: "pending", command: cmd });
          stepIndex++;
        }
        continue;
      }

      // Safe to execute
      const stepLabel = currentStepMatch ? `[خطوة ${currentStepMatch[1]}/${currentStepMatch[2]}] ${currentStepMatch[3].trim()}` : cmd.slice(0, 60);
      sse(res, "phase", { phase: "executing", label: `▶ ${stepLabel}` });
      if (currentStepMatch) {
        sse(res, "step_update", { n: parseInt(currentStepMatch[1]), total: parseInt(currentStepMatch[2]), title: currentStepMatch[3].trim(), status: "running", command: cmd });
      }
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const task: KaliTask = { id: taskId, title: cmd.slice(0, 80), description: `KALI AI: ${cmd}`, status: "running", progress: 10, command: cmd, streamLines: [], createdAt: Date.now(), type: "agent", risk: "low", agentId: agents[0]?.id };
      tasks.set(taskId, task);
      sse(res, "task_created", { taskId, command: cmd });
      await runOnAgent(cmd, taskId, task, currentStepMatch);
      if (currentStepMatch) stepIndex++;
    }

    // ── SERVER exec commands ───────────────────────────────────────────────
    const serverMatches = [...assistantContent.matchAll(SERVER_RE)];
    for (const match of serverMatches) {
      const cmd = match[1].trim();
      if (!cmd) continue;

      sse(res, "phase", { phase: "executing", label: `▶ سيرفر: ${cmd.slice(0, 60)}` });

      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const task: KaliTask = {
        id: taskId, title: cmd.slice(0, 80), description: `SERVER: ${cmd}`,
        status: "running", progress: 0, command: cmd, createdAt: Date.now(), type: "server",
      };
      tasks.set(taskId, task);
      sse(res, "task_created", { taskId, command: cmd });

      const result = await execServerCommand(cmd, 30_000);
      const output = result.stdout + (result.stderr ? `\n[stderr] ${result.stderr}` : "");
      const isError = result.exitCode !== 0;

      task.status = isError ? "failed" : "done";
      task.progress = 100;
      task.result = output.slice(0, 3000);
      tasks.set(taskId, task);

      // Extract findings from server output too
      const serverFindings = extractFindings(output, `server:${cmd.slice(0, 30)}`);
      for (const f of serverFindings.slice(0, 10)) {
        sse(res, "finding", f);
      }

      sse(res, "exec_result", { command: cmd, result: output.slice(0, 3000), isError, type: "server", durationMs: result.durationMs, taskId });
    }

    sse(res, "phase", { phase: "analyzing", label: "يحلل ويحفظ..." });

    // Auto-save to memory if response was meaningful
    if (assistantContent.length > 100) {
      const summary = assistantContent.slice(0, 300).replace(/\[[^\]]+\]/g, "").trim();
      if (summary.length > 50) {
        try { saveMemory("session_log", `session:${sid.slice(-8)}:${Date.now()}`, summary, "kali-ai,auto"); } catch { }
      }
    }

    setTimeout(() => {
      sse(res, "done", { sessionId: sid, ts: Date.now() });
      res.end();
    }, 200);

  } catch (err: unknown) {
    clearInterval(keepAliveIv);
    const errMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errMsg.includes("TimeoutError") || errMsg.includes("timeout") || errMsg.includes("AbortError");
    logger.error({ err, sid }, "kali-command/chat error");
    sse(res, "error", {
      error: isTimeout
        ? `⏱️ انتهت مهلة الانتظار (180 ثانية) — Ollama أبطأ من المتوقع.\n\nتأكد من:\n1. تشغيل ngrok بشكل صحيح\n2. أن الجهاز لديه موارد كافية لتشغيل النموذج\n3. جرّب نموذجاً أصغر مثل: llama3.2:1b`
        : `⚠️ خطأ في الاتصال بـ Ollama: ${errMsg}`,
    });
    res.end();
  }
});

// ── POST /kali-command/execute-direct ─────────────────────────────────────────
router.post("/kali-command/execute-direct", async (req, res) => {
  const { cmd, agentId } = req.body as { cmd: string; agentId?: string };
  if (!cmd?.trim()) { res.status(400).json({ error: "cmd required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const agents = getConnectedAgentList();
  const agent = agents.find(a => a.id === agentId) || agents[0];

  if (!agent) {
    sse(res, "error", { error: "⚠️ لا يوجد وكيل متصل" });
    res.end();
    return;
  }

  sse(res, "phase", { phase: "executing", label: `▶ موافق: ${cmd.slice(0, 50)}` });

  let streamedOutput = "";
  const result = await execStreamOnLocalAgent(cmd, agent.id, 120_000, (streamType, data) => {
    streamedOutput += data;
    sse(res, "exec_stream", { command: cmd, streamType, data: data.slice(0, 3000) });
  });

  const finalOutput = result
    ? (result.stdout || streamedOutput) + (result.stderr ? `\n[stderr] ${result.stderr}` : "")
    : streamedOutput || "خطأ في التنفيذ";
  const isError = !result || result.exitCode !== 0;

  sse(res, "exec_result", {
    command: cmd, result: finalOutput.slice(0, 4000), isError,
    type: "agent_approved", agentHost: agent.hostname, durationMs: result?.durationMs,
  });

  const findings = extractFindings(finalOutput, `approved:${cmd.slice(0, 30)}`);
  for (const f of findings.slice(0, 10)) sse(res, "finding", f);

  if (!isError && finalOutput.length > 50) {
    try { saveMemory("kali_exec", cmd.slice(0, 60), finalOutput.slice(0, 1000), "kali-ai,approved"); } catch { }
  }
  broadcastLiveEvent({ type: "shell_output", data: { tool: "kali_ai_approved", command: cmd, output: finalOutput.slice(0, 500), isError, ts: Date.now() }, ts: new Date().toISOString() });

  sse(res, "done", { ts: Date.now() });
  res.end();
});

// ── GET /kali-command/tasks ───────────────────────────────────────────────────
router.get("/kali-command/tasks", (_req, res) => {
  const list = [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
  res.json(list);
});

// ── DELETE /kali-command/tasks ────────────────────────────────────────────────
router.delete("/kali-command/tasks", (_req, res) => {
  tasks.clear();
  res.json({ ok: true });
});

// ── GET /kali-command/system ──────────────────────────────────────────────────
router.get("/kali-command/system", (_req, res) => {
  const mem = process.memoryUsage();
  const agents = getConnectedAgentList();
  const agentCount = agents.length;
  const load = os.loadavg();
  res.json({
    server: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: `${Math.round(os.totalmem() / 1024 / 1024)}MB`,
      uptime: `${Math.round(os.uptime() / 3600)}h`,
      memUsage: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
      loadAvg: load.map((l) => l.toFixed(2)).join(", "),
      openPorts: "8080",
    },
    agents: agents.map((a) => ({
      id: a.id,
      hostname: a.hostname,
      user: a.user,
      platform: a.platform,
      capabilities: a.capabilities,
      hasDeepProfile: !!getAgentDeepProfile(a.id),
    })),
    agentCount,
    knowledgeCount: getAllMemory().length,
    tasks: {
      queued: [...tasks.values()].filter((t) => t.status === "queued").length,
      running: [...tasks.values()].filter((t) => t.status === "running").length,
      done: [...tasks.values()].filter((t) => t.status === "done").length,
      failed: [...tasks.values()].filter((t) => t.status === "failed").length,
    },
    autonomousActive,
    activeMissions: [...activeMissions.values()].map((m) => ({
      id: m.id,
      goal: m.goal,
      status: m.status,
      steps: m.steps.length,
      currentStep: m.currentStep,
    })),
  });
});

// ── GET /kali-command/device-context ─────────────────────────────────────────
router.get("/kali-command/device-context", async (_req, res) => {
  const agents = getConnectedAgentList();
  if (agents.length === 0) {
    res.json({ connected: false, agent: null, context: null, profile: null });
    return;
  }

  const agent = agents[0];
  const profile = getAgentDeepProfile(agent.id);

  res.json({
    connected: true,
    agent: {
      id: agent.id,
      hostname: agent.hostname,
      user: agent.user,
      platform: agent.platform,
      arch: agent.arch,
      capabilities: agent.capabilities,
      interfaces: agent.interfaces,
    },
    context: profile ? {
      uptime: profile.system?.uptime ? `${Math.round(profile.system.uptime / 3600)}h` : undefined,
      kernel: profile.system?.release,
      mem: profile.system?.memory ? `${profile.system.memory.usedPct}% (${Math.round((profile.system.memory.used || 0) / 1024 / 1024)}MB / ${Math.round((profile.system.memory.total || 0) / 1024 / 1024)}MB)` : undefined,
      ip: Object.values(profile.network?.interfaces || {}).flat()[0] as string | undefined,
      disk: undefined,
      shell: profile.environment?.shell,
      cpu: profile.system?.cpus ? `${profile.system.cpus.count} cores` : undefined,
      display: profile.system?.display ? profile.system.displayValue || ":0" : null,
      toolCount: profile.toolCount,
    } : undefined,
    profile: profile ? {
      toolCount: profile.toolCount,
      tools: profile.tools,
      runningServices: profile.services?.running?.slice(0, 10),
      openPorts: profile.network?.openPorts?.slice(0, 10),
      users: profile.users?.all?.slice(0, 10),
      dockerContainers: profile.docker?.containers?.slice(0, 5),
      hasDisplay: profile.system?.display,
    } : null,
  });
});

// ── GET /kali-command/device-profile ── Full deep profile ───────────────────
router.get("/kali-command/device-profile", (_req, res) => {
  const agents = getConnectedAgentList();
  if (agents.length === 0) { res.json({ connected: false }); return; }
  const profile = getAgentDeepProfile(agents[0].id);
  res.json({ connected: true, agentId: agents[0].id, profile });
});

// ── GET /kali-command/memories ────────────────────────────────────────────────
router.get("/kali-command/memories", (req, res) => {
  const { limit = "50", search } = req.query as { limit?: string; search?: string };
  let mems = getAllMemory();
  if (search) {
    const s = (search as string).toLowerCase();
    mems = mems.filter((m) => m.key.toLowerCase().includes(s) || m.content.toLowerCase().includes(s));
  }
  res.json(mems.slice(0, Number(limit)));
});

router.post("/kali-command/memories", (req, res) => {
  const { memoryType = "fact", key, content, tags = "" } = req.body as { memoryType?: string; key: string; content: string; tags?: string };
  if (!key || !content) { res.status(400).json({ error: "key and content required" }); return; }
  try {
    const entry = saveMemory(memoryType, key, content, tags);
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: "save failed" });
  }
});

router.delete("/kali-command/memories/:id", (req, res) => {
  res.json({ ok: true, id: req.params.id });
});

// ── GET /kali-command/findings ────────────────────────────────────────────────
router.get("/kali-command/findings", (_req, res) => {
  const findingMems = getAllMemory().filter(m => m.memoryType === "finding" || m.tags?.includes("finding"));
  res.json(findingMems.slice(0, 100));
});

// ── GET /kali-command/missions ────────────────────────────────────────────────
router.get("/kali-command/missions", (_req, res) => {
  const missionList = [...activeMissions.values()];
  res.json(missionList);
});

// ── POST /kali-command/session/reset ─────────────────────────────────────────
router.post("/kali-command/session/reset", (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (sessionId) {
    sessions.delete(sessionId);
    activeMissions.delete(sessionId);
  }
  res.json({ ok: true });
});

// ── POST /kali-command/search ─────────────────────────────────────────────────
router.get("/kali-command/search", async (req, res) => {
  const { q } = req.query as { q?: string };
  if (!q) { res.json({ result: "لا استعلام" }); return; }

  try {
    // Search NVD API for CVEs
    const nvdRes = await fetch(
      `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(q)}&resultsPerPage=5`,
      { headers: { "User-Agent": "CyberNova/1.0" }, signal: AbortSignal.timeout(10_000) }
    );

    if (nvdRes.ok) {
      const data = await nvdRes.json() as {
        totalResults?: number;
        vulnerabilities?: Array<{
          cve: {
            id: string;
            descriptions: Array<{ lang: string; value: string }>;
            metrics?: { cvssMetricV31?: Array<{ cvssData?: { baseScore: number; baseSeverity: string } }> };
            published?: string;
          };
        }>;
      };

      if (data.vulnerabilities && data.vulnerabilities.length > 0) {
        const results = data.vulnerabilities.slice(0, 5).map((v) => {
          const cve = v.cve;
          const desc = cve.descriptions?.find((d) => d.lang === "en")?.value || "No description";
          const score = cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore;
          const severity = cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity;
          return `🔴 ${cve.id} [CVSS: ${score ?? "N/A"} ${severity ?? ""}]\n${desc.slice(0, 200)}\nنُشر: ${cve.published?.split("T")[0] ?? "unknown"}`;
        }).join("\n\n---\n\n");

        res.json({ result: `نتائج البحث عن "${q}" (${data.totalResults} إجمالي):\n\n${results}` });
        return;
      }
    }
    res.json({ result: `لا نتائج من NVD للاستعلام: "${q}"` });
  } catch {
    res.json({ result: `خطأ في البحث — تأكد من الاتصال بالإنترنت` });
  }
});

// ── GET /kali-command/preflight — System Fingerprint on agent connect ─────────
router.get("/kali-command/preflight", async (_req, res) => {
  const agents = getConnectedAgentList();
  if (agents.length === 0) {
    res.json({ connected: false, error: "لا يوجد وكيل متصل" });
    return;
  }
  const agent = agents[0];
  const fingerprint: Record<string, unknown> = {
    connected: true,
    hostname: agent.hostname,
    user: agent.user,
    platform: agent.platform,
    agentId: agent.id,
    ts: Date.now(),
  };

  // Run capability probes in parallel
  const probes: Array<{ key: string; cmd: string }> = [
    { key: "os",        cmd: "uname -a 2>/dev/null || ver" },
    { key: "ip",        cmd: "ip addr show 2>/dev/null | grep 'inet ' | awk '{print $2}' | head -3 || ipconfig 2>/dev/null | grep 'IPv4'" },
    { key: "tools",     cmd: "which nmap gobuster hydra nikto sqlmap metasploit dirb masscan ffuf wfuzz hashcat john aircrack-ng 2>/dev/null | xargs -I{} basename {} | tr '\\n' ',' || echo ''" },
    { key: "services",  cmd: "ss -tlpn 2>/dev/null | awk 'NR>1 {print $4}' | head -10 || netstat -tlpn 2>/dev/null | head -10" },
    { key: "openPorts", cmd: "ss -tulpn 2>/dev/null | grep LISTEN | awk '{print $5}' | cut -d: -f2 | sort -n | uniq | tr '\\n' ',' | head -c 200 || echo ''" },
    { key: "arch",      cmd: "uname -m 2>/dev/null || echo unknown" },
  ];

  await Promise.all(probes.map(async ({ key, cmd }) => {
    try {
      const r = await execOnLocalAgent(agent.id, cmd, 6_000);
      fingerprint[key] = (r?.stdout || "").trim().slice(0, 500);
    } catch {
      fingerprint[key] = "";
    }
  }));

  // Parse tools list into array
  const toolsRaw = String(fingerprint.tools || "");
  fingerprint.tools = toolsRaw.split(",").map(t => t.trim()).filter(Boolean);
  fingerprint.toolCount = (fingerprint.tools as string[]).length;

  const portsRaw = String(fingerprint.openPorts || "");
  fingerprint.openPorts = portsRaw.split(",").map(p => p.trim()).filter(Boolean);

  const servicesRaw = String(fingerprint.services || "");
  fingerprint.services = servicesRaw.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 10);

  res.json(fingerprint);
});

// ── Autonomous mode stubs ─────────────────────────────────────────────────────
router.post("/kali-command/autonomous/start", (_req, res) => {
  autonomousActive = true;
  res.json({ ok: true, active: true });
});

router.post("/kali-command/autonomous/stop", (_req, res) => {
  autonomousActive = false;
  res.json({ ok: true, active: false });
});

router.get("/kali-command/autonomous/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "connected", active: autonomousActive })}\n\n`);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { clearInterval(ping); } }, 25_000);
  req.on("close", () => clearInterval(ping));
});

// ── POST /kali-command/agent/exec ── execute command on connected local agent ─
router.post("/kali-command/agent/exec", async (req, res) => {
  const { command, agentId, timeout = 60_000 } = req.body as { command: string; agentId?: string; timeout?: number };
  if (!command?.trim()) { res.status(400).json({ error: "command required" }); return; }
  const agents = getConnectedAgentList();
  const agent = agents.find(a => a.id === agentId) || agents[0];
  if (!agent) { res.status(503).json({ error: "no agent connected", connected: false }); return; }
  const result = await execStreamOnLocalAgent(command, agent.id, timeout, undefined);
  if (!result) { res.status(504).json({ error: "timeout or agent disconnected" }); return; }
  auditLog({ ts: new Date().toISOString(), action: "agent_exec", data: { agentId: agent.id, command, exitCode: result.exitCode } });
  res.json({ ok: true, agentId: agent.id, hostname: agent.hostname, ...result });
});

// ── POST /kali-command/server/exec ── execute command on the API server itself ─
router.post("/kali-command/server/exec", async (req, res) => {
  const { command, timeout = 30_000 } = req.body as { command: string; timeout?: number };
  if (!command?.trim()) { res.status(400).json({ error: "command required" }); return; }
  const { exec: execCmd } = await import("child_process");
  const t0 = Date.now();
  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>((resolve) => {
    execCmd(command, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || "", stderr: stderr || "", exitCode: err?.code ?? 0, durationMs: Date.now() - t0 });
    });
  });
  auditLog({ ts: new Date().toISOString(), action: "server_exec", data: { command, exitCode: result.exitCode } });
  res.json({ ok: true, ...result });
});

export default router;
