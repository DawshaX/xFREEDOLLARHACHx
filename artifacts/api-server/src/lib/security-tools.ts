import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import http from "node:http";
import { logger } from "./logger";

const execAsync = promisify(exec);

const NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const CISA_KEV_URL =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const EPSS_URL = "https://api.first.org/data/v1/epss";

export interface NvdSearchOpts {
  keyword?: string;
  cveId?: string;
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  days?: number;
  limit?: number;
  startIndex?: number;
}

function nvdHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "CyberNova/5.0 (security-research)",
  };
  const k = process.env["NVD_API_KEY"];
  if (k) h["apiKey"] = k;
  return h;
}

export async function nvdSearch(opts: NvdSearchOpts): Promise<unknown> {
  const params = new URLSearchParams();
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 2000);
  params.set("resultsPerPage", String(limit));
  if (opts.startIndex) params.set("startIndex", String(opts.startIndex));
  if (opts.cveId) params.set("cveId", opts.cveId.toUpperCase());
  else if (opts.keyword) params.set("keywordSearch", opts.keyword);
  if (opts.severity) params.set("cvssV3Severity", opts.severity);
  if (opts.days && opts.days > 0) {
    const now = new Date();
    const ago = new Date(Date.now() - opts.days * 86400000);
    const fmt = (d: Date) => d.toISOString();
    params.set("pubStartDate", fmt(ago));
    params.set("pubEndDate", fmt(now));
  }
  const url = `${NVD_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: nvdHeaders(),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`NVD ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

let cisaCache: { ts: number; data: unknown } | null = null;
export async function fetchCisaKev(): Promise<unknown> {
  if (cisaCache && Date.now() - cisaCache.ts < 600_000) return cisaCache.data;
  const res = await fetch(CISA_KEV_URL, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "CyberNova/5.0" },
  });
  if (!res.ok) throw new Error(`CISA KEV ${res.status}`);
  const data = await res.json();
  cisaCache = { ts: Date.now(), data };
  return data;
}

export async function fetchEpss(cves: string[]): Promise<unknown> {
  if (cves.length === 0) return { data: [] };
  const url = `${EPSS_URL}?cve=${encodeURIComponent(cves.join(","))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`EPSS ${res.status}`);
  return res.json();
}

export interface GhSearchOpts {
  q: string;
  type?: "repositories" | "code";
  perPage?: number;
}

export async function githubSearch(opts: GhSearchOpts): Promise<unknown> {
  const type = opts.type ?? "repositories";
  const perPage = Math.min(opts.perPage ?? 15, 30);
  const url = `https://api.github.com/search/${type}?q=${encodeURIComponent(opts.q)}&sort=stars&per_page=${perPage}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CyberNova/5.0",
  };
  const tok = process.env["GITHUB_TOKEN"];
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function githubAdvisories(perPage = 10): Promise<unknown> {
  const url = `https://api.github.com/advisories?per_page=${perPage}&sort=updated`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CyberNova/5.0",
  };
  const tok = process.env["GITHUB_TOKEN"];
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GH adv ${res.status}`);
  return res.json();
}

export async function exploitDbSearch(
  q: string,
  type?: string,
): Promise<unknown> {
  const params = new URLSearchParams({ q });
  if (type) params.set("type", type);
  params.set("format", "json");
  const url = `https://www.exploit-db.com/search?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 CyberNova/5.0",
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`EDB ${res.status}`);
    return res.json();
  } catch (e) {
    logger.warn({ err: String(e) }, "exploit-db scrape failed");
    return { data: [], recordsTotal: 0, error: String(e) };
  }
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Free web search via DuckDuckGo HTML endpoint. No API key needed.
 * Returns top results parsed from the HTML response.
 */
export async function webSearch(
  query: string,
  limit = 8,
): Promise<WebSearchResult[]> {
  const q = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`DuckDuckGo returned ${res.status}`);
  }
  const html = await res.text();
  const results: WebSearchResult[] = [];
  // Match each result block: <a class="result__a" href="...">title</a>...<a class="result__snippet">snippet</a>
  const blockRegex =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi;
  let m: RegExpExecArray | null;
  const stripTags = (s: string) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  while ((m = blockRegex.exec(html)) && results.length < limit) {
    let href = m[1];
    // DuckDuckGo wraps links: //duckduckgo.com/l/?uddg=<encoded>
    if (href.startsWith("//")) href = "https:" + href;
    const ddgRedirect = href.match(/uddg=([^&]+)/);
    if (ddgRedirect) {
      try {
        href = decodeURIComponent(ddgRedirect[1]);
      } catch {
        // keep as-is
      }
    }
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3] || "");
    if (title && href.startsWith("http")) {
      results.push({ title, url: href, snippet });
    }
  }
  return results;
}

export async function fetchUrlAsText(url: string): Promise<{
  status: number;
  contentType: string;
  text: string;
}> {
  const res = await fetch(url, {
    headers: { "User-Agent": "CyberNova/5.0 (security-research)" },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  const contentType = res.headers.get("content-type") || "";
  const buf = await res.arrayBuffer();
  let text = new TextDecoder("utf-8", { fatal: false }).decode(
    buf.slice(0, 200_000),
  );
  if (contentType.includes("html")) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12_000);
  }
  return { status: res.status, contentType, text };
}

export interface ShellResult {
  command: string;
  stdout: string;
  stderr: string;
  code: number;
  signal?: string;
  durationMs: number;
  truncated: boolean;
}

export async function runShell(
  command: string,
  opts: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<ShellResult> {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const maxBuffer = opts.maxBuffer ?? 4 * 1024 * 1024;
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: opts.cwd,
      timeout: timeoutMs,
      maxBuffer,
      shell: "/bin/bash",
      env: { ...process.env, TERM: "xterm-256color" },
    });
    return {
      command,
      stdout: String(stdout),
      stderr: String(stderr),
      code: 0,
      durationMs: Date.now() - start,
      truncated: false,
    };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      signal?: string;
      killed?: boolean;
    };
    return {
      command,
      stdout: String(err.stdout ?? ""),
      stderr:
        String(err.stderr ?? "") +
        (err.killed ? `\n[killed: ${err.signal ?? "TIMEOUT"}]` : ""),
      code: typeof err.code === "number" ? err.code : err.code ? 1 : 1,
      signal: err.signal,
      durationMs: Date.now() - start,
      truncated: false,
    };
  }
}

export async function streamShell(
  command: string,
  onData: (chunk: { stream: "stdout" | "stderr"; data: string }) => void,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd: opts.cwd,
      env: { ...process.env, TERM: "xterm-256color" },
    });
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (d: string) => onData({ stream: "stdout", data: d }));
    child.stderr.on("data", (d: string) => onData({ stream: "stderr", data: d }));
    child.on("close", (code, signal) => {
      clearTimeout(t);
      resolve({ code, signal });
    });
    child.on("error", (err) => {
      onData({ stream: "stderr", data: `[spawn error] ${err.message}\n` });
    });
  });
}

export interface ScanOptions {
  dns?: boolean;
  ports?: boolean;
  ssl?: boolean;
  headers?: boolean;
  cve?: boolean;
  subdomains?: boolean;
  directories?: boolean;
}

const DEFAULT_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 465, 587, 993, 995,
  1433, 1521, 2049, 2375, 2376, 3000, 3306, 3389, 5000, 5432, 5601, 5900, 5984,
  6379, 7001, 7077, 8000, 8008, 8080, 8081, 8443, 8888, 9000, 9090, 9200, 9418,
  11211, 27017,
];
const SUB_WORDLIST = [
  "www",
  "mail",
  "api",
  "dev",
  "staging",
  "test",
  "admin",
  "portal",
  "vpn",
  "ftp",
  "shop",
  "blog",
  "app",
  "m",
  "cdn",
  "static",
  "assets",
  "img",
  "git",
  "jenkins",
  "jira",
  "ns1",
  "ns2",
  "smtp",
  "imap",
  "pop",
  "remote",
  "backup",
  "files",
  "owa",
  "dashboard",
  "monitor",
  "stats",
  "internal",
];
const DIR_WORDLIST = [
  ".env",
  ".git/HEAD",
  ".git/config",
  "robots.txt",
  "sitemap.xml",
  "admin",
  "admin/login",
  "wp-admin",
  "wp-login.php",
  "phpinfo.php",
  "phpmyadmin",
  "config.php",
  "backup",
  "backup.zip",
  "db.sql",
  "test.php",
  "server-status",
  "actuator",
  "actuator/env",
  "actuator/heapdump",
  ".DS_Store",
  ".svn/entries",
  "console",
  "swagger.json",
  "openapi.json",
  "api/v1",
  "graphql",
];

export async function scanDns(host: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { host };
  await Promise.all([
    dns.resolve4(host).then((r) => (out["A"] = r)).catch(() => {}),
    dns.resolve6(host).then((r) => (out["AAAA"] = r)).catch(() => {}),
    dns.resolveMx(host).then((r) => (out["MX"] = r)).catch(() => {}),
    dns.resolveTxt(host).then((r) => (out["TXT"] = r)).catch(() => {}),
    dns.resolveNs(host).then((r) => (out["NS"] = r)).catch(() => {}),
    dns.resolveCname(host).then((r) => (out["CNAME"] = r)).catch(() => {}),
    dns
      .resolveTxt(`_dmarc.${host}`)
      .then((r) => (out["DMARC"] = r))
      .catch(() => (out["DMARC"] = null)),
  ]);
  return out;
}

function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.connect(port, host);
  });
}

export async function scanPorts(
  host: string,
  ports: number[] = DEFAULT_PORTS,
  concurrency = 50,
): Promise<{ port: number; open: boolean }[]> {
  const results: { port: number; open: boolean }[] = [];
  let i = 0;
  async function worker() {
    while (i < ports.length) {
      const port = ports[i++]!;
      const open = await tcpProbe(host, port);
      if (open) results.push({ port, open: true });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results.sort((a, b) => a.port - b.port);
}

export async function scanSsl(
  host: string,
  port = 443,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const sock = tls.connect(
      {
        host,
        port,
        servername: host,
        timeout: 8000,
        rejectUnauthorized: false,
      },
      () => {
        const cert = sock.getPeerCertificate(true);
        const proto = sock.getProtocol();
        const cipher = sock.getCipher();
        const out = {
          host,
          port,
          protocol: proto,
          cipher,
          authorized: sock.authorized,
          authorizationError: sock.authorizationError
            ? String(sock.authorizationError)
            : null,
          subject: cert?.subject,
          issuer: cert?.issuer,
          validFrom: cert?.valid_from,
          validTo: cert?.valid_to,
          fingerprint: cert?.fingerprint256,
          subjectAltName: cert?.subjectaltname,
        };
        sock.end();
        resolve(out);
      },
    );
    sock.on("error", (err) => resolve({ host, port, error: String(err) }));
    sock.on("timeout", () => {
      sock.destroy();
      resolve({ host, port, error: "timeout" });
    });
  });
}

export async function scanHeaders(
  host: string,
  useHttps = true,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const lib = useHttps ? https : http;
    const req = lib.request(
      {
        host,
        port: useHttps ? 443 : 80,
        path: "/",
        method: "HEAD",
        timeout: 8000,
        headers: { "User-Agent": "CyberNova/5.0" },
        rejectUnauthorized: false,
      },
      (res) => {
        const headers = res.headers;
        const expected = [
          "content-security-policy",
          "x-frame-options",
          "x-content-type-options",
          "strict-transport-security",
          "referrer-policy",
          "permissions-policy",
        ];
        const missing = expected.filter((h) => !headers[h]);
        const present = expected.filter((h) => headers[h]);
        resolve({
          host,
          status: res.statusCode,
          headers,
          missing,
          present,
          score: `${present.length}/${expected.length}`,
        });
        res.resume();
      },
    );
    req.on("error", (err) => resolve({ host, error: String(err) }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ host, error: "timeout" });
    });
    req.end();
  });
}

export async function scanSubdomains(
  domain: string,
): Promise<{ subdomain: string; ips: string[] }[]> {
  const found: { subdomain: string; ips: string[] }[] = [];
  await Promise.all(
    SUB_WORDLIST.map(async (sub) => {
      const fqdn = `${sub}.${domain}`;
      try {
        const ips = await dns.resolve4(fqdn);
        if (ips.length > 0) found.push({ subdomain: fqdn, ips });
      } catch {
        /* not found */
      }
    }),
  );
  return found;
}

export async function scanDirectories(
  baseUrl: string,
): Promise<{ path: string; status: number; size?: number }[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const found: { path: string; status: number; size?: number }[] = [];
  const work = DIR_WORDLIST.map(async (p) => {
    try {
      const res = await fetch(`${base}/${p}`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
        headers: { "User-Agent": "CyberNova/5.0" },
      });
      if (res.status < 400 || res.status === 401 || res.status === 403) {
        const len = Number(res.headers.get("content-length") ?? 0) || undefined;
        found.push({ path: `/${p}`, status: res.status, size: len });
      }
    } catch {
      /* ignore */
    }
  });
  await Promise.all(work);
  return found;
}

export async function fullScan(
  target: string,
  opts: ScanOptions = {},
): Promise<Record<string, unknown>> {
  const o: Required<ScanOptions> = {
    dns: opts.dns ?? true,
    ports: opts.ports ?? true,
    ssl: opts.ssl ?? true,
    headers: opts.headers ?? true,
    cve: opts.cve ?? true,
    subdomains: opts.subdomains ?? false,
    directories: opts.directories ?? false,
  };
  const cleanHost = target.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const result: Record<string, unknown> = { target, host: cleanHost, started: new Date().toISOString() };
  const tasks: Promise<void>[] = [];
  if (o.dns)
    tasks.push(scanDns(cleanHost).then((r) => void (result["dns"] = r)));
  if (o.ports)
    tasks.push(
      scanPorts(cleanHost).then((r) => void (result["ports"] = r)),
    );
  if (o.ssl)
    tasks.push(
      scanSsl(cleanHost).then((r) => void (result["ssl"] = r)),
    );
  if (o.headers)
    tasks.push(
      scanHeaders(cleanHost).then((r) => void (result["headers"] = r)),
    );
  if (o.subdomains)
    tasks.push(
      scanSubdomains(cleanHost).then((r) => void (result["subdomains"] = r)),
    );
  if (o.directories)
    tasks.push(
      scanDirectories(`https://${cleanHost}`)
        .then((r) => void (result["directories"] = r))
        .catch(() => {}),
    );
  await Promise.all(tasks);

  if (o.cve) {
    try {
      const guess = cleanHost.split(".").slice(-2)[0] ?? cleanHost;
      const cves = (await nvdSearch({ keyword: guess, limit: 5 })) as {
        vulnerabilities?: { cve: { id: string } }[];
      };
      result["cve_hint"] = (cves.vulnerabilities ?? []).map((v) => v.cve.id);
    } catch (e) {
      result["cve_hint_error"] = String(e);
    }
  }
  result["completed"] = new Date().toISOString();
  return result;
}
