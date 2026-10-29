import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db, files, cves, settings, botMemory, playbooks, playbookSteps, nodes } from "@workspace/db";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  killProcess as killProc,
  listProcesses,
  runShell,
  startProcess,
  getProcess,
} from "./processes";
import {
  nvdSearch,
  fetchCisaKev,
  fetchEpss,
  githubSearch,
  githubAdvisories,
  exploitDbSearch,
  fetchUrlAsText,
  webSearch,
  fullScan,
  scanDns,
  scanPorts,
  scanSsl,
  scanHeaders,
  scanSubdomains,
} from "./security-tools";

// UI control tools — these are dispatched to the browser via SSE `client_tool`
// events instead of executing on the server. The agent loop intercepts these
// names before calling runTool().
export const CLIENT_TOOL_NAMES = new Set([
  "ui_show_page",
  "ui_open_window",
  "ui_run_terminal",
  "ui_browse_url",
  "ui_start_scanner",
  "ui_prefill_report",
  "ui_focus_window",
  "ui_close_window",
  "ui_notify",
]);

const WORKSPACE_ROOT = process.env.REPL_HOME || process.cwd();

function safePath(p: string): string {
  const abs = path.resolve(WORKSPACE_ROOT, p);
  if (!abs.startsWith(WORKSPACE_ROOT)) {
    throw new Error("Path escapes workspace root");
  }
  return abs;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "list_files",
    description: "List all files stored in the platform with name, mime type and size.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_file",
    description: "Read the text contents of a stored file by its numeric id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number", description: "File id from list_files" },
        maxBytes: {
          type: "number",
          description: "Optional cap on bytes returned (default 32000)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "write_file",
    description:
      "Create a new file with given name, mime type, and UTF-8 text content.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        mimeType: { type: "string", description: "e.g. text/plain, text/markdown" },
        content: { type: "string", description: "UTF-8 text content" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "scan_url",
    description:
      "Run a security scan on a URL: fetch headers, score security headers, list risks.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "search_cve_local",
    description:
      "Search the locally synced CVE database (fast, full-text). Supports severity filter and keyword.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Optional keyword (CVE id or description)" },
        severity: {
          type: "string",
          description: "Optional CRITICAL/HIGH/MEDIUM/LOW/ALL",
        },
        limit: { type: "number", description: "Default 20, max 100" },
      },
    },
  },
  {
    name: "fetch_cve_live",
    description:
      "Fetch the most recent CVEs of a given severity directly from NVD.",
    input_schema: {
      type: "object",
      properties: {
        severity: { type: "string" },
        limit: { type: "number" },
      },
      required: ["severity"],
    },
  },
  {
    name: "cve_stats",
    description: "Return total + per-severity counts of the local CVE database.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "run_shell",
    description:
      "Execute a shell command synchronously in the workspace and return stdout/stderr. Use for short commands (≤120s). For long-running tools (nmap full scan, msfconsole, etc.) use start_background_process instead.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash command to execute" },
        cwd: { type: "string", description: "Optional working directory (relative to workspace)" },
        timeoutMs: { type: "number", description: "Timeout in ms, default 30000, max 120000" },
      },
      required: ["command"],
    },
  },
  {
    name: "start_background_process",
    description:
      "Start a long-running process in the background (e.g. nmap, sqlmap, gobuster, hydra, python servers). Returns a process id. Use read_process_output to tail it and kill_process to stop it.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["command"],
    },
  },
  {
    name: "list_processes",
    description: "List all background processes (running and finished) with status.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_process_output",
    description:
      "Get the latest output buffer of a background process (last ~16KB).",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "kill_process",
    description: "Send SIGTERM to a running background process.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "read_workspace_file",
    description:
      "Read a real file from the workspace filesystem (NOT the file uploads DB). Use for project source code or anything written via run_shell.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to workspace root" },
        maxBytes: { type: "number", description: "Default 32000, max 200000" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_workspace_file",
    description:
      "Write a file to the real workspace filesystem. Creates parent directories. Use for tool outputs, scripts, configs.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_workspace_dir",
    description: "List files and subdirectories of a workspace path.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Default '.'" } },
    },
  },
  // ====================================================================
  // Real security research tools (NVD / CISA KEV / EPSS / GitHub /
  // Exploit-DB / web fetch / multi-stage scan)
  // ====================================================================
  {
    name: "nvd_search",
    description:
      "Real NVD search. Supports keyword, cveId, severity (CRITICAL/HIGH/MEDIUM/LOW), days back, and limit.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        cve_id: { type: "string" },
        severity: { type: "string" },
        days: { type: "number" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "cisa_kev",
    description:
      "Fetch the CISA Known Exploited Vulnerabilities catalog. Optional q filter.",
    input_schema: {
      type: "object",
      properties: { q: { type: "string" } },
    },
  },
  {
    name: "epss_score",
    description: "Get EPSS exploit-prediction scores for a list of CVE IDs.",
    input_schema: {
      type: "object",
      properties: {
        cves: { type: "array", items: { type: "string" } },
      },
      required: ["cves"],
    },
  },
  {
    name: "github_search",
    description:
      "GitHub search for repositories or code (PoCs, tools, nuclei templates...).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        type: { type: "string" },
        per_page: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "github_advisories",
    description: "Latest security advisories from the GitHub Advisory Database.",
    input_schema: {
      type: "object",
      properties: { per_page: { type: "number" } },
    },
  },
  {
    name: "exploit_db_search",
    description:
      "Search Exploit-DB for known exploits (real upstream — falls back to local if scrape blocked).",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, type: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch any URL and return its plain-text body (HTML stripped). Up to 12KB.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description:
      "البحث على الإنترنت (DuckDuckGo، مجاني بدون مفتاح). استخدمه لما تواجه مشكلة، خطأ، رسالة لا تفهمها، أو تحتاج معلومة حديثة. يعيد قائمة نتائج {title, url, snippet}.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "عبارة البحث" },
        limit: { type: "number", description: "عدد النتائج (افتراضي 8، أقصى 15)" },
      },
      required: ["query"],
    },
  },
  {
    name: "scan_target",
    description:
      "Multi-stage scan of a target (DNS, ports, SSL, HTTP headers, subdomains, optional dirs/CVE hints).",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        options: {
          type: "object",
          properties: {
            dns: { type: "boolean" },
            ports: { type: "boolean" },
            ssl: { type: "boolean" },
            headers: { type: "boolean" },
            cve: { type: "boolean" },
            subdomains: { type: "boolean" },
            directories: { type: "boolean" },
          },
        },
      },
      required: ["target"],
    },
  },
  {
    name: "scan_dns",
    description: "DNS records (A/AAAA/MX/TXT/NS/CNAME/DMARC) for a host.",
    input_schema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "scan_ports",
    description: "TCP port scan against a host (defaults to a common-ports list).",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        ports: { type: "array", items: { type: "number" } },
      },
      required: ["target"],
    },
  },
  {
    name: "scan_ssl",
    description: "Inspect a host's TLS certificate, protocol, and cipher.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        port: { type: "number" },
      },
      required: ["target"],
    },
  },
  {
    name: "scan_headers",
    description: "Inspect HTTP security headers; report missing ones.",
    input_schema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "scan_subdomains",
    description: "Brute-force subdomain enumeration with built-in wordlist.",
    input_schema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  // ====================================================================
  // Settings — the agent can read & rotate API keys / models on its own
  // ====================================================================
  {
    name: "read_setting",
    description:
      "Read a stored platform setting by key (e.g. ollamaBaseUrl, ollamaModel, provider, nvdApiKey, githubToken).",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "update_setting",
    description:
      "Update or insert a platform setting by key. Use to rotate API keys or change the model.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "list_settings",
    description: "List all stored setting keys (values are masked when sensitive).",
    input_schema: { type: "object", properties: {} },
  },
  // ====================================================================
  // UI control — agent drives the browser UI (windows, terminal, scanner...)
  // ====================================================================
  {
    name: "ui_show_page",
    description:
      "Navigate the user to a CyberNova page. Pages: dashboard, cve-live, cve-search, scanner, agent, live-agent, kaligpt, chat, files, exploit-db, github-search, web-search, playbooks, reports, monitor, installer, desktop, settings, knowledge.",
    input_schema: {
      type: "object",
      properties: { page: { type: "string" } },
      required: ["page"],
    },
  },
  {
    name: "ui_open_window",
    description:
      "Open a desktop window. Available windows: browser, terminal, files, scanner, kaligpt, agent, monitor, editor.",
    input_schema: {
      type: "object",
      properties: {
        window: { type: "string" },
        title: { type: "string" },
      },
      required: ["window"],
    },
  },
  {
    name: "ui_focus_window",
    description: "Bring a window to the front by id.",
    input_schema: {
      type: "object",
      properties: { window: { type: "string" } },
      required: ["window"],
    },
  },
  {
    name: "ui_close_window",
    description: "Close a window by id.",
    input_schema: {
      type: "object",
      properties: { window: { type: "string" } },
      required: ["window"],
    },
  },
  {
    name: "ui_run_terminal",
    description:
      "Open the desktop terminal window and execute a shell command in it (visible to the user).",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "ui_browse_url",
    description:
      "Open the in-app browser window and navigate to a URL (rendered through the proxy).",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "ui_start_scanner",
    description: "Open the scanner window and start a full scan against a target.",
    input_schema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "ui_prefill_report",
    description: "Pre-fill the report form fields in the UI.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        severity: { type: "string" },
        description: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "ui_notify",
    description: "Show a toast notification in the UI.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string" },
        kind: { type: "string", description: "info | success | warn | error" },
      },
      required: ["message"],
    },
  },
  // ====================================================================
  // Memory — long-term self-learning
  // ====================================================================
  {
    name: "memory_save",
    description:
      "Save a fact, success_pattern, error_pattern, skill, or preference into long-term memory for future tasks.",
    input_schema: {
      type: "object",
      properties: {
        memoryType: {
          type: "string",
          description: "fact | skill | preference | error_pattern | success_pattern",
        },
        key: { type: "string", description: "Short search key" },
        content: { type: "string", description: "Memory content" },
        context: { type: "string" },
        tags: { type: "string", description: "comma-separated" },
      },
      required: ["memoryType", "key", "content"],
    },
  },
  {
    name: "memory_search",
    description: "Search long-term memory by keyword and/or type.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: "string" },
        type: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "memory_list",
    description: "List the most recent memory entries.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  // ====================================================================
  // Playbooks — saved multi-step recipes
  // ====================================================================
  {
    name: "playbook_list",
    description: "List all available playbooks (recipes).",
    input_schema: {
      type: "object",
      properties: { category: { type: "string" } },
    },
  },
  {
    name: "playbook_get",
    description: "Get a playbook with its ordered steps by id.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
  // ====================================================================
  // Nodes — multi-server SSH management
  // ====================================================================
  {
    name: "node_list",
    description: "List all registered SSH nodes (remote servers).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "node_exec",
    description:
      "Execute a shell command on a remote node via SSH. Requires nodeId and command. Returns stdout/stderr.",
    input_schema: {
      type: "object",
      properties: {
        nodeId: { type: "number" },
        command: { type: "string" },
      },
      required: ["nodeId", "command"],
    },
  },
];

const SENSITIVE_KEYS = new Set([
  "githubToken",
  "nvdApiKey",
]);

function maskValue(key: string, value: string): string {
  if (!SENSITIVE_KEYS.has(key)) return value;
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

interface ScanInput {
  url: string;
}
async function scanUrlImpl(input: ScanInput) {
  const url = input.url.startsWith("http") ? input.url : `https://${input.url}`;
  const start = Date.now();
  const r = await fetch(url, { redirect: "follow" });
  const responseTimeMs = Date.now() - start;
  const text = await r.text();
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(text);
  const headers: Array<{ name: string; value: string }> = [];
  r.headers.forEach((v, k) => headers.push({ name: k, value: v }));

  const want = [
    {
      name: "Strict-Transport-Security",
      recommendation: "Enable HSTS to enforce HTTPS",
    },
    {
      name: "Content-Security-Policy",
      recommendation: "Set a strict CSP to mitigate XSS",
    },
    { name: "X-Frame-Options", recommendation: "Set to DENY or SAMEORIGIN" },
    { name: "X-Content-Type-Options", recommendation: "Set to nosniff" },
    { name: "Referrer-Policy", recommendation: "Set strict referrer policy" },
    { name: "Permissions-Policy", recommendation: "Restrict powerful APIs" },
  ];
  const securityHeaders = want.map((w) => {
    const h = headers.find((x) => x.name.toLowerCase() === w.name.toLowerCase());
    return {
      name: w.name,
      present: !!h,
      value: h?.value ?? "",
      recommendation: w.recommendation,
    };
  });
  const present = securityHeaders.filter((h) => h.present).length;
  const score = Math.round((present / securityHeaders.length) * 100);
  const risks: string[] = [];
  if (!securityHeaders[0].present) risks.push("No HSTS — vulnerable to downgrade");
  if (!securityHeaders[1].present) risks.push("No CSP — XSS risk");
  if (r.headers.get("server")) risks.push(`Server banner exposed: ${r.headers.get("server")}`);
  return {
    url,
    status: r.status,
    responseTimeMs,
    server: r.headers.get("server") || "",
    contentType: r.headers.get("content-type") || "",
    title: titleMatch?.[1]?.trim() || "",
    headers,
    securityHeaders,
    score,
    risks,
  };
}

const NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";

export async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_files": {
      const rows = await db
        .select({
          id: files.id,
          name: files.name,
          mimeType: files.mimeType,
          size: files.size,
          createdAt: files.createdAt,
        })
        .from(files)
        .orderBy(desc(files.createdAt))
        .limit(100);
      return rows;
    }
    case "read_file": {
      const id = Number(input.id);
      const maxBytes = Number(input.maxBytes) || 32000;
      const [f] = await db.select().from(files).where(eq(files.id, id));
      if (!f) return { error: "File not found" };
      const buf = Buffer.from(f.contentBase64, "base64");
      const text = buf.toString("utf8").slice(0, maxBytes);
      return { id: f.id, name: f.name, mimeType: f.mimeType, content: text };
    }
    case "write_file": {
      const name = String(input.name);
      const mimeType = String(input.mimeType || "text/plain");
      const content = String(input.content || "");
      const b64 = Buffer.from(content, "utf8").toString("base64");
      const [row] = await db
        .insert(files)
        .values({
          name,
          mimeType,
          size: Buffer.byteLength(content, "utf8"),
          contentBase64: b64,
        })
        .returning({ id: files.id, name: files.name, size: files.size });
      return row;
    }
    case "scan_url":
      return scanUrlImpl(input as unknown as ScanInput);
    case "search_cve_local": {
      const q = String(input.q || "").trim();
      const severity = String(input.severity || "").toUpperCase();
      const limit = Math.min(Number(input.limit) || 20, 100);
      const conds = [];
      if (q)
        conds.push(or(ilike(cves.description, `%${q}%`), ilike(cves.id, `%${q}%`)));
      if (severity && severity !== "ALL") conds.push(eq(cves.severity, severity));
      const rows = await db
        .select()
        .from(cves)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(cves.publishedAt))
        .limit(limit);
      return rows;
    }
    case "fetch_cve_live": {
      const severity = String(input.severity || "CRITICAL").toUpperCase();
      const limit = Math.min(Number(input.limit) || 20, 50);
      const params = new URLSearchParams({
        cvssV3Severity: severity,
        resultsPerPage: String(limit),
      });
      const r = await fetch(`${NVD_BASE}?${params}`, {
        headers: { "User-Agent": "CyberNova/1.0" },
      });
      if (!r.ok) return { error: `NVD ${r.status}` };
      const data = (await r.json()) as { vulnerabilities?: unknown[] };
      return data.vulnerabilities;
    }
    case "cve_stats": {
      const [total] = await db.select({ c: count() }).from(cves);
      const bySev = await db
        .select({ severity: cves.severity, c: count() })
        .from(cves)
        .groupBy(cves.severity);
      return {
        total: Number(total?.c || 0),
        bySeverity: Object.fromEntries(
          bySev.map((r) => [r.severity, Number(r.c)]),
        ),
      };
    }
    case "run_shell": {
      const command = String(input.command || "").trim();
      if (!command) return { error: "command required" };
      const cwd = input.cwd ? safePath(String(input.cwd)) : undefined;
      const timeoutMs = Number(input.timeoutMs) || 30_000;
      const r = await runShell(command, { cwd, timeoutMs });
      return {
        ok: r.ok,
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        durationMs: r.durationMs,
        output: r.output.slice(-16000),
      };
    }
    case "start_background_process": {
      const command = String(input.command || "").trim();
      if (!command) return { error: "command required" };
      const cwd = input.cwd ? safePath(String(input.cwd)) : undefined;
      try {
        const rec = startProcess({ command, cwd });
        return {
          id: rec.id,
          pid: rec.pid,
          status: rec.status,
          command: rec.command,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "start failed" };
      }
    }
    case "list_processes": {
      return listProcesses().map((p) => ({
        id: p.id,
        command: p.command.slice(0, 200),
        status: p.status,
        pid: p.pid,
        exitCode: p.exitCode,
        startedAt: p.startedAt,
        endedAt: p.endedAt,
      }));
    }
    case "read_process_output": {
      const id = String(input.id);
      const rec = getProcess(id);
      if (!rec) return { error: "process not found" };
      return {
        id: rec.id,
        status: rec.status,
        exitCode: rec.exitCode,
        output: rec.output.slice(-16000),
      };
    }
    case "kill_process": {
      const id = String(input.id);
      const ok = killProc(id);
      return { ok };
    }
    case "read_workspace_file": {
      const p = safePath(String(input.path));
      const max = Math.min(Number(input.maxBytes) || 32000, 200000);
      try {
        const stat = await fs.stat(p);
        if (stat.isDirectory()) return { error: "path is a directory" };
        const buf = await fs.readFile(p);
        const text = buf.toString("utf8").slice(0, max);
        return { path: input.path, size: stat.size, content: text };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "read failed" };
      }
    }
    case "write_workspace_file": {
      const p = safePath(String(input.path));
      const content = String(input.content || "");
      try {
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, content, "utf8");
        return { path: input.path, size: Buffer.byteLength(content, "utf8") };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "write failed" };
      }
    }
    // ====================================================================
    // Real security tools
    // ====================================================================
    case "nvd_search": {
      const opts: Parameters<typeof nvdSearch>[0] = {
        limit: Math.min(Number(input.limit) || 10, 50),
      };
      if (input.cve_id) opts.cveId = String(input.cve_id);
      else if (input.query) opts.keyword = String(input.query);
      const sev = String(input.severity || "").toUpperCase();
      if (["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(sev))
        opts.severity = sev as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
      if (input.days) opts.days = Number(input.days);
      const data = (await nvdSearch(opts)) as {
        totalResults?: number;
        vulnerabilities?: Array<{
          cve: {
            id: string;
            published: string;
            descriptions?: { lang: string; value: string }[];
            metrics?: Record<string, Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }>>;
          };
        }>;
      };
      const items = (data.vulnerabilities ?? []).map((v) => {
        const c = v.cve;
        const m = c.metrics ?? {};
        const d =
          m["cvssMetricV31"]?.[0]?.cvssData ??
          m["cvssMetricV30"]?.[0]?.cvssData ??
          m["cvssMetricV2"]?.[0]?.cvssData ??
          {};
        const desc =
          (c.descriptions ?? []).find((x) => x.lang === "en")?.value ?? "";
        return {
          id: c.id,
          published: c.published,
          score: d.baseScore ?? 0,
          severity: d.baseSeverity ?? "UNKNOWN",
          description: desc.slice(0, 600),
        };
      });
      return { totalResults: data.totalResults ?? items.length, results: items };
    }
    case "cisa_kev": {
      const data = (await fetchCisaKev()) as {
        vulnerabilities?: Array<{
          cveID: string;
          vulnerabilityName: string;
          vendorProject: string;
          product: string;
          dueDate: string;
          shortDescription?: string;
        }>;
      };
      const all = data.vulnerabilities ?? [];
      const q = String(input.q ?? "").toLowerCase().trim();
      const filtered = q
        ? all.filter((v) =>
            [v.cveID, v.vulnerabilityName, v.vendorProject, v.product]
              .some((x) => x?.toLowerCase().includes(q)),
          )
        : all;
      return {
        total: all.length,
        match: filtered.length,
        sample: filtered.slice(0, 25),
      };
    }
    case "epss_score": {
      const arr = Array.isArray(input.cves) ? (input.cves as string[]) : [];
      return await fetchEpss(arr);
    }
    case "github_search": {
      const data = (await githubSearch({
        q: String(input.query),
        type: (input.type as "repositories" | "code") ?? "repositories",
        perPage: Math.min(Number(input.per_page) || 10, 30),
      })) as {
        items?: Array<{
          full_name?: string;
          html_url?: string;
          description?: string;
          stargazers_count?: number;
          language?: string;
        }>;
        total_count?: number;
      };
      const items = (data.items ?? []).map((r) => ({
        name: r.full_name,
        url: r.html_url,
        description: r.description,
        stars: r.stargazers_count,
        language: r.language,
      }));
      return { total: data.total_count ?? items.length, results: items };
    }
    case "github_advisories": {
      const data = await githubAdvisories(Number(input.per_page) || 10);
      const arr = Array.isArray(data) ? data.slice(0, 25) : data;
      return arr;
    }
    case "exploit_db_search": {
      const data = await exploitDbSearch(
        String(input.query),
        input.type ? String(input.type) : undefined,
      );
      return data;
    }
    case "fetch_url": {
      const data = await fetchUrlAsText(String(input.url));
      return {
        status: data.status,
        contentType: data.contentType,
        text: data.text.slice(0, 6000),
      };
    }
    case "web_search": {
      const limit = Math.min(15, Math.max(1, Number(input.limit) || 8));
      const results = await webSearch(String(input.query), limit);
      return { query: String(input.query), count: results.length, results };
    }
    case "scan_target": {
      const r = await fullScan(
        String(input.target),
        (input.options as Record<string, boolean>) ?? {},
      );
      return r;
    }
    case "scan_dns":
      return await scanDns(String(input.target));
    case "scan_ports":
      return {
        open: await scanPorts(String(input.target), input.ports as number[] | undefined),
      };
    case "scan_ssl":
      return await scanSsl(String(input.target), Number(input.port) || 443);
    case "scan_headers":
      return await scanHeaders(String(input.target));
    case "scan_subdomains":
      return { subdomains: await scanSubdomains(String(input.target)) };
    // ====================================================================
    // Settings — agent self-rotation
    // ====================================================================
    case "read_setting": {
      const key = String(input.key);
      const rows = await db.select().from(settings).where(eq(settings.key, key));
      const value = rows[0]?.value;
      if (value === undefined) return { key, value: null };
      return { key, value: maskValue(key, value) };
    }
    case "update_setting": {
      const key = String(input.key);
      const value = String(input.value);
      await db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value, updatedAt: new Date() },
        });
      return { ok: true, key, masked: maskValue(key, value) };
    }
    case "list_settings": {
      const rows = await db.select().from(settings);
      return rows.map((r) => ({
        key: r.key,
        value: maskValue(r.key, r.value),
        updatedAt: r.updatedAt,
      }));
    }
    case "list_workspace_dir": {
      const rel = String(input.path || ".");
      const p = safePath(rel);
      try {
        const entries = await fs.readdir(p, { withFileTypes: true });
        return entries.slice(0, 200).map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
        }));
      } catch (e) {
        return { error: e instanceof Error ? e.message : "list failed" };
      }
    }
    // ====================================================================
    // Memory tools
    // ====================================================================
    case "memory_save": {
      const [row] = await db
        .insert(botMemory)
        .values({
          memoryType: String(input.memoryType),
          key: String(input.key),
          content: String(input.content),
          context: String(input.context ?? ""),
          tags: String(input.tags ?? ""),
        })
        .returning();
      return { ok: true, id: row.id };
    }
    case "memory_search": {
      const q = String(input.q ?? "").trim();
      const type = String(input.type ?? "").trim();
      const limit = Math.min(Number(input.limit ?? 20), 100);
      let query = db.select().from(botMemory).$dynamic();
      if (type) query = query.where(eq(botMemory.memoryType, type));
      if (q) query = query.where(ilike(botMemory.content, `%${q}%`));
      const rows = await query.orderBy(desc(botMemory.updatedAt)).limit(limit);
      return rows.map((r) => ({
        id: r.id,
        type: r.memoryType,
        key: r.key,
        content: r.content.slice(0, 500),
        confidence: r.confidence,
        tags: r.tags,
      }));
    }
    case "memory_list": {
      const limit = Math.min(Number(input.limit ?? 30), 100);
      const rows = await db
        .select()
        .from(botMemory)
        .orderBy(desc(botMemory.updatedAt))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        type: r.memoryType,
        key: r.key,
        content: r.content.slice(0, 200),
        tags: r.tags,
      }));
    }
    // ====================================================================
    // Playbooks
    // ====================================================================
    case "playbook_list": {
      const cat = String(input.category ?? "").trim();
      let query = db.select().from(playbooks).$dynamic();
      if (cat) query = query.where(eq(playbooks.category, cat));
      const rows = await query.orderBy(desc(playbooks.updatedAt)).limit(50);
      return rows.map((p) => ({
        id: p.id,
        title: p.title,
        category: p.category,
        description: p.description,
        runCount: p.runCount,
        tags: p.tags,
      }));
    }
    case "playbook_get": {
      const id = Number(input.id);
      const [p] = await db.select().from(playbooks).where(eq(playbooks.id, id));
      if (!p) return { error: "Not found" };
      const steps = await db
        .select()
        .from(playbookSteps)
        .where(eq(playbookSteps.playbookId, id))
        .orderBy(playbookSteps.stepOrder);
      return { playbook: p, steps };
    }
    // ====================================================================
    // Nodes
    // ====================================================================
    case "node_list": {
      const rows = await db.select().from(nodes).orderBy(desc(nodes.updatedAt));
      return rows.map((n) => ({
        id: n.id,
        name: n.name,
        host: n.host,
        port: n.port,
        username: n.username,
        status: n.status,
        tags: n.tags,
        osInfo: n.osInfo,
      }));
    }
    case "node_exec": {
      const nodeId = Number(input.nodeId);
      const command = String(input.command);
      const [n] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
      if (!n) return { error: "Node not found" };
      const sshCmd = `sshpass -p ${JSON.stringify(n.credential)} ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${n.port} ${n.username}@${n.host} ${JSON.stringify(command)}`;
      const result = await runShell(sshCmd, { timeoutMs: 60000 });
      return {
        nodeId,
        host: n.host,
        command,
        output: result.output.slice(0, 6000),
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
