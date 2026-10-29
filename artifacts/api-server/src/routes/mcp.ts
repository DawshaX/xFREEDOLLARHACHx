/**
 * CyberNova MCP Server — Model Context Protocol endpoint
 * ═══════════════════════════════════════════════════════
 * Exposes Kali Linux tools as MCP tools so OpenClaw (and any MCP client)
 * can control the connected Kali machine from WhatsApp/Telegram/Discord.
 *
 * Integration:
 *   openclaw mcp set kali https://YOUR_DOMAIN/api/mcp
 *
 * Protocol: MCP over HTTP (Streamable HTTP transport, JSON-RPC 2.0)
 * Spec: https://spec.modelcontextprotocol.io/specification/2024-11-05/
 */
import { Router } from "express";
import { execOnLocalAgent, getConnectedAgentList, getAgentDeepProfile } from "./local-agent";
import { logger } from "../lib/logger";

const router = Router();

// ── MCP Tool definitions ──────────────────────────────────────────────────────
const MCP_TOOLS = [
  {
    name: "kali_exec",
    description: "Execute a shell command on the connected Kali Linux machine. Returns stdout, stderr, and exit code. Use for reconnaissance, enumeration, and any CLI operation.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute on Kali Linux (bash)" },
        timeout: { type: "number", description: "Timeout in milliseconds. Default: 30000. Max: 120000." },
      },
      required: ["command"],
    },
  },
  {
    name: "kali_system_info",
    description: "Get full system information from the connected Kali machine: hostname, OS, CPU, RAM, IP addresses, disk, uptime, running services, and current user.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "kali_screenshot",
    description: "Take a screenshot of the Kali machine's current display. Returns a base64-encoded PNG image. Requires a display/X11 session.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "kali_file_list",
    description: "List files and directories on the Kali machine at the given path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list. Default: ~ (home directory)." },
      },
      required: [],
    },
  },
  {
    name: "kali_file_read",
    description: "Read the contents of a file on the Kali machine.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file to read." },
      },
      required: ["path"],
    },
  },
  {
    name: "kali_anydesk_setup",
    description: "Install AnyDesk on the Kali machine (if not installed), start it, get the AnyDesk ID, and optionally set a password. Returns the AnyDesk ID for remote desktop connection.",
    inputSchema: {
      type: "object",
      properties: {
        password: { type: "string", description: "Password to set for AnyDesk connections. Default: nova2024." },
      },
      required: [],
    },
  },
  {
    name: "kali_network_scan",
    description: "Perform a quick network scan on the Kali machine's local network. Discovers live hosts and open ports.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "IP, CIDR, or hostname to scan. Default: auto-detect local subnet." },
        quick: { type: "boolean", description: "If true, do a fast ping sweep only. Default: false (full port scan on top 100 ports)." },
      },
      required: [],
    },
  },
  {
    name: "kali_processes",
    description: "List running processes on the Kali machine, sorted by CPU usage.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Optional filter string to search process names/commands." },
      },
      required: [],
    },
  },
];

// ── Helper: exec on connected Kali agent ─────────────────────────────────────
async function execKali(command: string, timeout = 30_000): Promise<{ stdout: string; stderr: string; error?: string }> {
  const agents = getConnectedAgentList();
  if (agents.length === 0) {
    return { stdout: "", stderr: "", error: "لا يوجد جهاز Kali متصل بـ CyberNova. شغّل nova-agent على جهاز كالي أولاً." };
  }
  try {
    // execOnLocalAgent signature: (cmd, agentId?, timeout?)
    const result = await execOnLocalAgent(command, agents[0].id, timeout);
    if (!result) return { stdout: "", stderr: "", error: "No response from agent (timeout?)" };
    return { stdout: result.stdout || "", stderr: result.stderr || "" };
  } catch (e: unknown) {
    return { stdout: "", stderr: "", error: String(e) };
  }
}

// ── Helper: format MCP text content ──────────────────────────────────────────
function textContent(text: string) {
  return [{ type: "text", text }];
}

function errorContent(msg: string) {
  return { content: textContent(`❌ ${msg}`), isError: true };
}

// ── Tool Executor ─────────────────────────────────────────────────────────────
async function callTool(name: string, args: Record<string, unknown>): Promise<{ content: unknown[]; isError?: boolean }> {

  switch (name) {

    case "kali_exec": {
      const command = String(args.command ?? "");
      const timeout = Math.min(Number(args.timeout ?? 30_000), 120_000);
      if (!command) return errorContent("command is required");
      const r = await execKali(command, timeout);
      if (r.error) return errorContent(r.error);
      const out = [
        `$ ${command}`,
        r.stdout ? r.stdout : "(no output)",
        r.stderr ? `[stderr] ${r.stderr}` : "",
      ].filter(Boolean).join("\n");
      return { content: textContent(out) };
    }

    case "kali_system_info": {
      const agents = getConnectedAgentList();
      if (agents.length === 0) return errorContent("لا يوجد جهاز Kali متصل");
      const agent = agents[0];
      const profile = getAgentDeepProfile(agent.id);
      if (profile) {
        const sys = profile.system as Record<string, unknown>;
        const lines = [
          `🖥️  CyberNova — Kali Device Info`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `Hostname:  ${String(sys.hostname ?? agent.hostname)}`,
          `Platform:  ${String(sys.platform ?? agent.platform)}`,
          `Arch:      ${String(sys.arch ?? agent.arch ?? "unknown")}`,
          `OS:        ${String(sys.release ?? "unknown")}`,
          `User:      ${String(sys.user ?? agent.user)}`,
          `Display:   ${sys.display ? `✅ ${String(sys.displayValue ?? ":0")}` : "❌ headless"}`,
          ``,
          `CPU:       ${(sys.cpus as any)?.count ?? "?"} cores — ${(sys.cpus as any)?.model ?? "unknown"}`,
          `RAM:       ${(sys.memory as any)?.used != null ? Math.round((sys.memory as any).used / 1024 / 1024) + " MB used / " + Math.round((sys.memory as any).total / 1024 / 1024) + " MB total" : "unknown"}`,
          `Uptime:    ${sys.uptime != null ? Math.round(Number(sys.uptime) / 3600) + "h " + Math.round((Number(sys.uptime) % 3600) / 60) + "m" : "unknown"}`,
          `Tools:     ${profile.tools?.length ?? 0} Kali tools detected`,
          `Connected: ${new Date(agent.connectedAt).toLocaleString()}`,
        ];
        // Add network info
        if (profile.network?.interfaces) {
          const ifaces = Object.entries(profile.network.interfaces as Record<string, unknown>)
            .map(([name, addrs]) => `  ${name}: ${Array.isArray(addrs) ? addrs.join(", ") : String(addrs)}`)
            .join("\n");
          lines.push(`\nNetwork:\n${ifaces}`);
        }
        return { content: textContent(lines.join("\n")) };
      }
      // Fallback: exec
      const r = await execKali("id && hostname && uname -a && ip addr show | grep inet && df -h / && free -h && uptime", 15_000);
      if (r.error) return errorContent(r.error);
      return { content: textContent(r.stdout || r.stderr) };
    }

    case "kali_screenshot": {
      const agents = getConnectedAgentList();
      if (agents.length === 0) return errorContent("لا يوجد جهاز Kali متصل");
      try {
        const resp = await fetch(`http://localhost:8080/api/local-agent/screenshot?agentId=${agents[0].id}`);
        const data = await resp.json() as { data?: string; error?: string; format?: string };
        if (!data.data) return errorContent(data.error ?? "فشل الـ screenshot");
        return {
          content: [{
            type: "image",
            data: data.data,
            mimeType: `image/${data.format ?? "png"}`,
          }],
        };
      } catch (e) {
        return errorContent(`Screenshot failed: ${String(e)}`);
      }
    }

    case "kali_file_list": {
      const dir = String(args.path ?? "~");
      const r = await execKali(`ls -la "${dir}" 2>&1 | head -60`, 10_000);
      if (r.error) return errorContent(r.error);
      return { content: textContent(`📁 ${dir}:\n${r.stdout || r.stderr}`) };
    }

    case "kali_file_read": {
      const path = String(args.path ?? "");
      if (!path) return errorContent("path is required");
      const r = await execKali(`cat "${path}" 2>&1 | head -200`, 10_000);
      if (r.error) return errorContent(r.error);
      return { content: textContent(r.stdout || r.stderr) };
    }

    case "kali_anydesk_setup": {
      const password = String(args.password ?? "nova2024");
      // Check if installed
      const check = await execKali("which anydesk && anydesk --version 2>/dev/null || echo NOT_INSTALLED", 10_000);
      let steps = [`🖥️ AnyDesk Setup على Kali`];

      if (check.stdout?.includes("NOT_INSTALLED") || (!check.stdout?.includes("/") && !check.stdout?.includes("AnyDesk"))) {
        steps.push("📥 جارٍ تثبيت AnyDesk...");
        const install = await execKali(
          `curl -fsSL https://keys.anydesk.com/repos/DEB-GPG-KEY | gpg --dearmor > /etc/apt/trusted.gpg.d/anydesk.gpg 2>/dev/null && echo "deb http://deb.anydesk.com/ all main" > /etc/apt/sources.list.d/anydesk-stable.list && apt-get update -qq 2>/dev/null && apt-get install -y anydesk 2>&1 | tail -5`,
          90_000,
        );
        steps.push(install.error ? `❌ فشل التثبيت: ${install.error}` : "✅ تم تثبيت AnyDesk");
      } else {
        steps.push(`✅ AnyDesk مثبّت: ${check.stdout?.trim()}`);
      }

      // Start AnyDesk
      const start = await execKali(
        `anydesk --start-with-linux 2>/dev/null & sleep 3 && anydesk --get-id 2>/dev/null`,
        20_000,
      );
      const idMatch = (start.stdout + start.stderr).match(/\d{9,12}/);

      // Set password
      if (password) {
        await execKali(`echo "${password}" | anydesk --set-password 2>/dev/null`, 10_000);
        steps.push(`🔒 كلمة المرور: **${password}**`);
      }

      if (idMatch) {
        steps.push(`\n✅ AnyDesk ID: **${idMatch[0]}**`);
        steps.push(`\nللاتصال بالجهاز:`);
        steps.push(`1. حمّل AnyDesk من anydesk.com`);
        steps.push(`2. اكتب ID: ${idMatch[0]}`);
        steps.push(`3. كلمة المرور: ${password}`);
      } else {
        // Try alternate method
        const getId = await execKali("anydesk --get-id 2>/dev/null || grep -r 'id=' ~/.anydesk/ 2>/dev/null | head -3", 10_000);
        const idMatch2 = (getId.stdout + getId.stderr).match(/\d{9,12}/);
        if (idMatch2) {
          steps.push(`\n✅ AnyDesk ID: **${idMatch2[0]}**`);
          steps.push(`كلمة المرور: ${password}`);
        } else {
          steps.push(`⚠️ لم يتم الحصول على الـ ID. تأكد من أن الجهاز يعمل بصلاحيات root.`);
          steps.push(`جرّب يدوياً: anydesk --get-id`);
        }
      }

      return { content: textContent(steps.join("\n")) };
    }

    case "kali_network_scan": {
      const target = args.target ? String(args.target) : null;
      const quick = Boolean(args.quick);
      let cmd: string;
      if (target) {
        cmd = quick
          ? `nmap -sn "${target}" 2>&1 | head -40`
          : `nmap -sV --top-ports 100 "${target}" 2>&1 | head -80`;
      } else {
        // Auto-detect subnet
        cmd = quick
          ? `nmap -sn $(ip route | grep -oP '\\d+\\.\\d+\\.\\d+\\.\\d+/\\d+' | head -1) 2>&1 | head -40`
          : `nmap -sn $(ip route | grep -oP '\\d+\\.\\d+\\.\\d+\\.\\d+/\\d+' | head -1) 2>&1 | head -40`;
      }
      const r = await execKali(cmd, 60_000);
      if (r.error) return errorContent(r.error);
      return { content: textContent(r.stdout || r.stderr || "No results") };
    }

    case "kali_processes": {
      const filter = args.filter ? String(args.filter) : null;
      const cmd = filter
        ? `ps aux --sort=-%cpu | head -1 && ps aux --sort=-%cpu | grep -i "${filter}" | head -20`
        : `ps aux --sort=-%cpu | head -25`;
      const r = await execKali(cmd, 10_000);
      if (r.error) return errorContent(r.error);
      return { content: textContent(r.stdout || r.stderr) };
    }

    default:
      return errorContent(`Unknown tool: ${name}`);
  }
}

// ── GET /api/mcp — server info & capabilities (SSE endpoint for HTTP transport) ─
router.get("/mcp", (req, res) => {
  const agents = getConnectedAgentList();
  res.json({
    name: "CyberNova Kali MCP Server",
    version: "1.0.0",
    description: "Control a connected Kali Linux machine via MCP. Works with OpenClaw, Claude Code, Cursor, and any MCP-compatible client.",
    protocolVersion: "2024-11-05",
    transport: "http",
    endpoint: `${req.protocol}://${req.get("host")}/api/mcp`,
    status: agents.length > 0 ? "connected" : "no_device",
    connectedDevice: agents.length > 0 ? `${agents[0].user}@${agents[0].hostname}` : null,
    tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description })),
    openclaw_setup: {
      command: `openclaw mcp set kali-control ${req.protocol}://${req.get("host")}/api/mcp`,
      description: "Run this command in OpenClaw to add CyberNova as an MCP tool provider",
    },
  });
});

// ── POST /api/mcp — JSON-RPC 2.0 MCP endpoint ────────────────────────────────
router.post("/mcp", async (req, res) => {
  // Handle both single requests and batch arrays
  const body = req.body as Record<string, unknown> | Array<Record<string, unknown>>;
  const requests = Array.isArray(body) ? body : [body];

  const responses = await Promise.all(requests.map(async (rpc) => {
    const { jsonrpc, id, method, params } = rpc as {
      jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown>;
    };

    if (jsonrpc !== "2.0") {
      return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
    }

    try {
      switch (method) {

        case "initialize":
          logger.info({ clientInfo: (params as any)?.clientInfo }, "MCP client connected");
          return {
            jsonrpc: "2.0", id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: { listChanged: false },
                resources: {},
                prompts: {},
              },
              serverInfo: {
                name: "CyberNova-Kali",
                version: "1.0.0",
              },
            },
          };

        case "notifications/initialized":
          return null; // No response for notifications

        case "ping":
          return { jsonrpc: "2.0", id, result: {} };

        case "tools/list":
          return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };

        case "tools/call": {
          const p = params as { name: string; arguments?: Record<string, unknown> };
          if (!p?.name) {
            return { jsonrpc: "2.0", id, error: { code: -32602, message: "name is required" } };
          }
          logger.info({ tool: p.name, args: p.arguments }, "MCP tool call");
          const result = await callTool(p.name, p.arguments ?? {});
          return { jsonrpc: "2.0", id, result };
        }

        case "resources/list":
          return { jsonrpc: "2.0", id, result: { resources: [] } };

        case "prompts/list":
          return { jsonrpc: "2.0", id, result: { prompts: [] } };

        default:
          return {
            jsonrpc: "2.0", id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }
    } catch (err: unknown) {
      logger.error({ err: String(err), method }, "MCP handler error");
      return {
        jsonrpc: "2.0", id,
        error: { code: -32603, message: "Internal error", data: String(err) },
      };
    }
  }));

  // Filter out null (notifications)
  const filtered = responses.filter(Boolean);

  if (Array.isArray(body)) {
    res.json(filtered);
  } else {
    res.json(filtered[0] ?? {});
  }
});

// ── POST /api/openclaw/chat — Simple webhook for OpenClaw HTTP tool integration ─
// Used when OpenClaw is configured with a custom HTTP fetch tool pointing here.
router.post("/openclaw/chat", async (req, res) => {
  const { message, session, sender, channel } = req.body as {
    message?: string; session?: string; sender?: string; channel?: string;
  };
  if (!message?.trim()) {
    res.status(400).json({ error: "message required" });
    return;
  }

  logger.info({ sender, channel, messageLen: message.length }, "OpenClaw webhook chat");

  // Quick exec: if message looks like a command (starts with $ or !)
  const cmdMatch = message.match(/^[\$!]\s*(.+)$/);
  if (cmdMatch) {
    const cmd = cmdMatch[1].trim();
    const r = await execKali(cmd, 30_000);
    if (r.error) {
      res.json({ response: `❌ ${r.error}`, type: "error" });
      return;
    }
    res.json({
      response: `\`\`\`\n$ ${cmd}\n${(r.stdout || r.stderr || "(empty)").slice(0, 2000)}\n\`\`\``,
      type: "exec",
    });
    return;
  }

  // Otherwise, forward to KALI AI
  try {
    const resp = await fetch(`http://localhost:8080/api/kali-command/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session ?? "openclaw", message }),
    });

    // Collect SSE stream
    const text = await resp.text();
    const chunks: string[] = [];
    text.split("\n").forEach((line: string) => {
      if (line.startsWith("data: ")) {
        try {
          const d = JSON.parse(line.slice(6)) as { type?: string; content?: string; text?: string };
          if (d.type === "content" && d.content) chunks.push(d.content);
          if (d.type === "text" && d.text) chunks.push(d.text);
        } catch { /* skip */ }
      }
    });

    res.json({
      response: chunks.join("") || "لم يرد الـ AI بأي شيء",
      type: "ai",
      session: session ?? "openclaw",
    });
  } catch (e: unknown) {
    res.status(500).json({ error: `AI error: ${String(e)}` });
  }
});

// ── GET /api/openclaw/status — Quick status for OpenClaw ─────────────────────
router.get("/openclaw/status", (_req, res) => {
  const agents = getConnectedAgentList();
  res.json({
    connected: agents.length > 0,
    device: agents.length > 0 ? {
      id: agents[0].id,
      hostname: agents[0].hostname,
      user: agents[0].user,
      platform: agents[0].platform,
    } : null,
    mcp_tools: MCP_TOOLS.length,
    server: "CyberNova Kali MCP",
    version: "1.0.0",
  });
});

export default router;
