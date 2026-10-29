/**
 * Installer API — Tool installation with GitHub integration
 * Fetches real GitHub stats for each security tool
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, installerToolsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { spawn } from "node:child_process";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const UA = "CyberNova-Installer/1.0";

// ── GitHub repo metadata (owner/repo)
const TOOL_GITHUB: Record<string, { owner: string; repo: string }> = {
  nmap:         { owner: "nmap",                  repo: "nmap" },
  nikto:        { owner: "sullo",                 repo: "nikto" },
  sqlmap:       { owner: "sqlmapproject",         repo: "sqlmap" },
  gobuster:     { owner: "OJ",                    repo: "gobuster" },
  ffuf:         { owner: "ffuf",                  repo: "ffuf" },
  wpscan:       { owner: "wpscanteam",            repo: "wpscan" },
  subfinder:    { owner: "projectdiscovery",      repo: "subfinder" },
  amass:        { owner: "owasp-amass",           repo: "amass" },
  httpx:        { owner: "projectdiscovery",      repo: "httpx" },
  nuclei:       { owner: "projectdiscovery",      repo: "nuclei" },
  naabu:        { owner: "projectdiscovery",      repo: "naabu" },
  katana:       { owner: "projectdiscovery",      repo: "katana" },
  whois:        { owner: "weppos",                repo: "whois" },
  dnsx:         { owner: "projectdiscovery",      repo: "dnsx" },
  tlsx:         { owner: "projectdiscovery",      repo: "tlsx" },
  hydra:        { owner: "vanhauser-thc",         repo: "thc-hydra" },
  john:         { owner: "openwall",              repo: "john" },
  hashcat:      { owner: "hashcat",               repo: "hashcat" },
  metasploit:   { owner: "rapid7",                repo: "metasploit-framework" },
  theHarvester: { owner: "laramies",              repo: "theHarvester" },
};

// ── GitHub rate-limit cache
const ghCache = new Map<string, { stars: number; forks: number; desc: string; lang: string; url: string; updatedAt: string; cachedAt: number }>();

async function fetchGitHubStats(owner: string, repo: string): Promise<{ stars: number; forks: number; desc: string; lang: string; url: string; updatedAt: string } | null> {
  const key = `${owner}/${repo}`;
  const cached = ghCache.get(key);
  if (cached && Date.now() - cached.cachedAt < 30 * 60_000) {
    const { cachedAt: _, ...rest } = cached;
    return rest;
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { "User-Agent": UA, Accept: "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = await r.json() as { stargazers_count: number; forks_count: number; description: string; language: string; html_url: string; updated_at: string };
    const result = {
      stars: d.stargazers_count ?? 0,
      forks: d.forks_count ?? 0,
      desc: d.description ?? "",
      lang: d.language ?? "C",
      url: d.html_url ?? `https://github.com/${key}`,
      updatedAt: d.updated_at ?? "",
    };
    ghCache.set(key, { ...result, cachedAt: Date.now() });
    return result;
  } catch {
    return null;
  }
}

function checkBinary(binary: string): Promise<{ installed: boolean; version: string }> {
  return new Promise((resolve) => {
    const c = spawn("/bin/sh", ["-c", `command -v ${binary}`]);
    let out = "";
    c.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    c.on("close", (code: number | null) => {
      if (code !== 0 || !out.trim()) return resolve({ installed: false, version: "" });
      const v = spawn("/bin/sh", ["-c", `${binary} --version 2>&1 | head -n1`]);
      let vout = "";
      v.stdout.on("data", (d: Buffer) => { vout += d.toString(); });
      v.on("close", () => resolve({ installed: true, version: vout.trim().slice(0, 80) }));
    });
    c.on("error", () => resolve({ installed: false, version: "" }));
  });
}

// ── GET /installer/tools
router.get("/installer/tools", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db.select().from(installerToolsTable).orderBy(asc(installerToolsTable.category), asc(installerToolsTable.name));

    const updated = await Promise.all(rows.map(async (t) => {
      const [status, gh] = await Promise.all([
        checkBinary(t.binary),
        TOOL_GITHUB[t.binary] ? fetchGitHubStats(TOOL_GITHUB[t.binary]!.owner, TOOL_GITHUB[t.binary]!.repo) : Promise.resolve(null),
      ]);

      if (status.installed !== t.installed || status.version !== t.version) {
        await db.update(installerToolsTable)
          .set({ installed: status.installed, version: status.version, updatedAt: new Date() })
          .where(eq(installerToolsTable.id, t.id));
      }

      return {
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description,
        installed: status.installed,
        installCommand: t.installCommand,
        binary: t.binary,
        version: status.version,
        github: gh ?? null,
      };
    }));

    return res.json(updated);
  } catch (e) { return next(e); }
});

// ── POST /installer/tools/:toolId/install (SSE)
router.post("/installer/tools/:toolId/install", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [t] = await db.select().from(installerToolsTable).where(eq(installerToolsTable.id, req.params.toolId)).limit(1);
    if (!t) return res.status(404).json({ error: "tool not found" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const send = (line: string) => res.write(`data: ${JSON.stringify({ line })}\n\n`);

    send(`[☠] Starting installation of ${t.name}...`);
    send(`[⚡] Command: ${t.installCommand}`);

    const proc = spawn("/bin/sh", ["-c", t.installCommand], { env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" } });

    proc.stdout.on("data", (d: Buffer) => {
      const lines = d.toString().split("\n").filter((l: string) => l.trim());
      for (const line of lines) send(`[OUT] ${line}`);
    });

    proc.stderr.on("data", (d: Buffer) => {
      const lines = d.toString().split("\n").filter((l: string) => l.trim());
      for (const line of lines) send(`[ERR] ${line}`);
    });

    proc.on("close", async (code: number | null) => {
      const status = await checkBinary(t.binary);
      await db.update(installerToolsTable)
        .set({ installed: status.installed, version: status.version || (status.installed ? "installed" : ""), updatedAt: new Date() })
        .where(eq(installerToolsTable.id, t.id));

      if (code === 0 || status.installed) {
        send(`[✓] ${t.name} installed successfully!`);
        send(`[✓] Version: ${status.version || "available"}`);
      } else {
        send(`[✗] Installation failed (exit code ${code ?? "?"})`);
      }

      res.write(`data: ${JSON.stringify({ done: true, installed: status.installed, version: status.version })}\n\n`);
      res.end();
    });

    proc.on("error", (err: Error) => {
      send(`[✗] Process error: ${err.message}`);
      res.write(`data: ${JSON.stringify({ done: true, installed: false })}\n\n`);
      res.end();
    });

    req.on("close", () => proc.kill());

    return;
  } catch (e) { return next(e); }
});

// ── GET /installer/github/:owner/:repo  — direct GitHub stats
router.get("/installer/github/:owner/:repo", async (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  const stats = await fetchGitHubStats(owner, repo);
  if (!stats) return res.status(502).json({ error: "GitHub API unavailable" });
  return res.json(stats);
});

// ── Seed default tools
export async function ensureDefaultInstallerTools() {
  const existing = await db.select().from(installerToolsTable).limit(1);
  if (existing.length > 0) return;

  const tools = [
    // Network
    { name: "Nmap",         category: "network",  description: "ماسح المنافذ والشبكات — Network Mapper",                  installCommand: "apt-get install -y nmap",                                                          binary: "nmap" },
    { name: "Naabu",        category: "network",  description: "ماسح منافذ سريع بـ Go — ProjectDiscovery",                  installCommand: "go install github.com/projectdiscovery/naabu/v2/cmd/naabu@latest",                binary: "naabu" },
    // Web
    { name: "Nikto",        category: "web",      description: "ماسح ثغرات خوادم الويب",                                    installCommand: "apt-get install -y nikto",                                                          binary: "nikto" },
    { name: "SQLMap",       category: "web",      description: "أداة استغلال حقن SQL تلقائياً",                             installCommand: "apt-get install -y sqlmap",                                                         binary: "sqlmap" },
    { name: "Gobuster",     category: "web",      description: "Brute-force مسارات وnطاقات فرعية",                          installCommand: "apt-get install -y gobuster",                                                       binary: "gobuster" },
    { name: "Ffuf",         category: "web",      description: "Fuzzer سريع لتطبيقات الويب",                                 installCommand: "apt-get install -y ffuf",                                                           binary: "ffuf" },
    { name: "WPScan",       category: "web",      description: "ماسح ثغرات WordPress",                                       installCommand: "gem install wpscan",                                                                binary: "wpscan" },
    { name: "Httpx",        category: "web",      description: "HTTP multi-probe scanner سريع",                              installCommand: "go install github.com/projectdiscovery/httpx/cmd/httpx@latest",                   binary: "httpx" },
    { name: "Katana",       category: "web",      description: "زاحف ويب متقدم من ProjectDiscovery",                        installCommand: "go install github.com/projectdiscovery/katana/cmd/katana@latest",                 binary: "katana" },
    // Recon
    { name: "Subfinder",    category: "recon",    description: "اكتشاف النطاقات الفرعية السلبي",                            installCommand: "go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest",          binary: "subfinder" },
    { name: "Amass",        category: "recon",    description: "تعداد متقدم للنطاقات الفرعية",                              installCommand: "apt-get install -y amass",                                                          binary: "amass" },
    // Vuln
    { name: "Nuclei",       category: "vuln",     description: "ماسح ثغرات قائم على القوالب — 10k+ template",              installCommand: "go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest",               binary: "nuclei" },
    // OSINT
    { name: "Whois",        category: "osint",    description: "استعلامات WHOIS للنطاقات والـ IPs",                        installCommand: "apt-get install -y whois",                                                          binary: "whois" },
    { name: "Dnsx",         category: "osint",    description: "DNS multi-resolver سريع",                                   installCommand: "go install github.com/projectdiscovery/dnsx/cmd/dnsx@latest",                    binary: "dnsx" },
    { name: "TLSx",         category: "osint",    description: "فاحص TLS/SSL شامل",                                         installCommand: "go install github.com/projectdiscovery/tlsx/cmd/tlsx@latest",                    binary: "tlsx" },
    { name: "TheHarvester", category: "osint",    description: "جمع بريد إلكتروني ونطاقات من OSINT",                       installCommand: "apt-get install -y theharvester",                                                   binary: "theHarvester" },
    // Auth
    { name: "Hydra",        category: "auth",     description: "أداة كسر كلمات المرور عبر الشبكة",                        installCommand: "apt-get install -y hydra",                                                          binary: "hydra" },
    { name: "John",         category: "auth",     description: "John The Ripper — كسر الـ Hashes",                          installCommand: "apt-get install -y john",                                                           binary: "john" },
    { name: "Hashcat",      category: "auth",     description: "كسر Hashes بتسريع GPU",                                     installCommand: "apt-get install -y hashcat",                                                        binary: "hashcat" },
    // Exploit
    { name: "Metasploit",   category: "exploit",  description: "إطار الاستغلال الأشهر في العالم",                           installCommand: "apt-get install -y metasploit-framework",                                          binary: "msfconsole" },
  ];

  for (const t of tools) {
    await db.insert(installerToolsTable).values(t);
  }
  logger.info({ count: tools.length }, "Installer: seeded default tools");
}

export default router;
