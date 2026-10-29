/**
 * Nova Explorer — محرك الاستكشاف الأمني التلقائي
 *
 * يجمع تلقائياً من:
 *   - GitHub: PayloadsAllTheThings, SecLists, HackTricks, GTFOBins, OWASP CheatSheets
 *   - الويب: Exploit-DB, CISA, NVD, PacketStorm, VulDB, Shodan Trends
 *   - مصادر متخصصة: MITRE ATT&CK, CVEDetails, Snyk Advisories
 *
 * ويحفظ كل ما يجده مفيداً في knowledgeTable بتصنيف تلقائي.
 */

import { db, knowledgeTable } from "@workspace/db";
import { logger } from "./logger";

const USER_AGENT = "CyberNova-AutoExplorer/3.0 (security research; educational)";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExplorerResult {
  source: string;
  collected: number;
  skipped: number;
  errors: string[];
  duration: number;
}

export interface ExplorerStats {
  totalRuns: number;
  totalCollected: number;
  lastRun?: Date;
  bySource: Record<string, number>;
}

// ── Raw GitHub Payload Sources ─────────────────────────────────────────────────

const PAYLOADS_ALL_THINGS_BASE = "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master";
const SECLISTS_BASE = "https://raw.githubusercontent.com/danielmiessler/SecLists/master";

interface RawPayloadSource {
  title: string;
  category: string;
  url: string;
  tags: string[];
  maxBytes?: number;
}

const RAW_PAYLOAD_SOURCES: RawPayloadSource[] = [
  // PayloadsAllTheThings — SQL Injection
  {
    title: "SQL Injection — Auth Bypass Payloads",
    category: "payloads/sqli",
    url: `${PAYLOADS_ALL_THINGS_BASE}/SQL%20Injection/Intruder/Auth_Bypass.txt`,
    tags: ["sqli", "payloads", "auth-bypass", "pat"],
    maxBytes: 30000,
  },
  {
    title: "SQL Injection — Generic Payloads (PAT)",
    category: "payloads/sqli",
    url: `${PAYLOADS_ALL_THINGS_BASE}/SQL%20Injection/Intruder/SQL-Injection.txt`,
    tags: ["sqli", "payloads", "injection", "pat"],
    maxBytes: 30000,
  },
  // PayloadsAllTheThings — XSS
  {
    title: "XSS — DOM Based Payloads (PAT)",
    category: "payloads/xss",
    url: `${PAYLOADS_ALL_THINGS_BASE}/XSS%20Injection/Intruder/FUZZ_XSS.txt`,
    tags: ["xss", "payloads", "dom", "pat"],
    maxBytes: 25000,
  },
  {
    title: "XSS — Bypass Filter Techniques",
    category: "payloads/xss",
    url: `${PAYLOADS_ALL_THINGS_BASE}/XSS%20Injection/Intruder/XSS_Bypass_WAF.txt`,
    tags: ["xss", "bypass", "waf", "payloads", "pat"],
    maxBytes: 25000,
  },
  // PayloadsAllTheThings — SSRF
  {
    title: "SSRF — Bypass Payloads (PAT)",
    category: "payloads/ssrf",
    url: `${PAYLOADS_ALL_THINGS_BASE}/Server%20Side%20Request%20Forgery/Intruder/SSRF_Targets.txt`,
    tags: ["ssrf", "payloads", "bypass", "pat"],
    maxBytes: 20000,
  },
  // PayloadsAllTheThings — Command Injection
  {
    title: "Command Injection — Payloads (PAT)",
    category: "payloads/cmdi",
    url: `${PAYLOADS_ALL_THINGS_BASE}/Command%20Injection/Intruder/command-execution-unix.txt`,
    tags: ["cmdi", "rce", "payloads", "unix", "pat"],
    maxBytes: 20000,
  },
  // PayloadsAllTheThings — Path Traversal
  {
    title: "Path Traversal — Payloads (PAT)",
    category: "payloads/traversal",
    url: `${PAYLOADS_ALL_THINGS_BASE}/Path%20Traversal/Intruder/path-traversal.txt`,
    tags: ["traversal", "lfi", "payloads", "pat"],
    maxBytes: 25000,
  },
  // SecLists — Fuzzing
  {
    title: "SecLists — Common Web Directories",
    category: "wordlists/dirs",
    url: `${SECLISTS_BASE}/Discovery/Web-Content/common.txt`,
    tags: ["wordlist", "dirs", "fuzzing", "seclists"],
    maxBytes: 50000,
  },
  {
    title: "SecLists — API Endpoints Fuzzing",
    category: "wordlists/api",
    url: `${SECLISTS_BASE}/Discovery/Web-Content/api/api-endpoints.txt`,
    tags: ["api", "wordlist", "fuzzing", "endpoints", "seclists"],
    maxBytes: 30000,
  },
  {
    title: "SecLists — Password Top 100",
    category: "wordlists/passwords",
    url: `${SECLISTS_BASE}/Passwords/Common-Credentials/10-million-password-list-top-100.txt`,
    tags: ["passwords", "wordlist", "credentials", "seclists"],
    maxBytes: 5000,
  },
  {
    title: "SecLists — Default Credentials",
    category: "wordlists/credentials",
    url: `${SECLISTS_BASE}/Passwords/Default-Credentials/default-passwords.csv`,
    tags: ["default-creds", "passwords", "wordlist", "seclists"],
    maxBytes: 20000,
  },
  {
    title: "SecLists — Subdomains Top 1M (sample)",
    category: "wordlists/subdomains",
    url: `${SECLISTS_BASE}/Discovery/DNS/subdomains-top1million-5000.txt`,
    tags: ["subdomains", "dns", "wordlist", "enumeration", "seclists"],
    maxBytes: 40000,
  },
];

// ── GitHub Repository Sources ──────────────────────────────────────────────────

interface GitHubRepoSource {
  name: string;
  owner: string;
  repo: string;
  description: string;
  category: string;
  tags: string[];
  fetchReadme?: boolean;
}

const GITHUB_REPO_SOURCES: GitHubRepoSource[] = [
  { name: "PayloadsAllTheThings", owner: "swisskyrepo", repo: "PayloadsAllTheThings", description: "A list of useful payloads and bypass for Web App Security", category: "repos/tools", tags: ["payloads", "web", "bypass", "github"] },
  { name: "SecLists", owner: "danielmiessler", repo: "SecLists", description: "Security tester's companion: wordlists, fuzzing, credentials", category: "repos/wordlists", tags: ["wordlists", "fuzzing", "github"] },
  { name: "HackTricks", owner: "HackTricks-wiki", repo: "hacktricks", description: "Hacking tricks & techniques wiki", category: "repos/wiki", tags: ["wiki", "hacking", "techniques", "github"] },
  { name: "GTFOBins", owner: "GTFOBins", repo: "GTFOBins.github.io", description: "Unix binaries for privilege escalation", category: "repos/privesc", tags: ["gtfobins", "privesc", "lolbins", "github"] },
  { name: "PEASS-ng", owner: "carlospolop", repo: "PEASS-ng", description: "Privilege Escalation Awesome Scripts SUITE", category: "repos/privesc", tags: ["privesc", "linpeas", "winpeas", "github"] },
  { name: "Nuclei Templates", owner: "projectdiscovery", repo: "nuclei-templates", description: "Community-curated Nuclei templates for vulnerability scanning", category: "repos/scanning", tags: ["nuclei", "templates", "scanning", "github"] },
  { name: "Metasploit Framework", owner: "rapid7", repo: "metasploit-framework", description: "World's most popular penetration testing framework", category: "repos/exploitation", tags: ["metasploit", "exploitation", "framework", "github"] },
  { name: "Nmap NSE Scripts", owner: "nmap", repo: "nmap", description: "Network scanner with NSE scripting engine", category: "repos/scanning", tags: ["nmap", "nse", "scanning", "network", "github"] },
  { name: "sqlmap", owner: "sqlmapproject", repo: "sqlmap", description: "Automatic SQL injection exploitation tool", category: "repos/tools", tags: ["sqlmap", "sqli", "exploitation", "github"] },
  { name: "OWASP CheatSheets", owner: "OWASP", repo: "CheatSheetSeries", description: "OWASP cheat sheets for web security", category: "repos/cheatsheets", tags: ["owasp", "cheatsheet", "web", "security", "github"] },
  { name: "Impacket", owner: "fortra", repo: "impacket", description: "Python classes for working with network protocols", category: "repos/tools", tags: ["impacket", "smb", "kerberos", "network", "github"] },
  { name: "BloodHound", owner: "BloodHoundAD", repo: "BloodHound", description: "Active Directory attack path analysis", category: "repos/ad", tags: ["bloodhound", "active-directory", "graph", "github"] },
  { name: "Mimikatz", owner: "gentilkiwi", repo: "mimikatz", description: "Windows credentials extraction tool", category: "repos/credentials", tags: ["mimikatz", "credentials", "windows", "github"] },
  { name: "Burp Suite Extensions", owner: "PortSwigger", repo: "burp-extensions-montoya-api", description: "Burp Suite professional API for extensions", category: "repos/tools", tags: ["burp", "web", "proxy", "github"] },
  { name: "Responder", owner: "lgandx", repo: "Responder", description: "LLMNR, NBT-NS and MDNS poisoner", category: "repos/tools", tags: ["responder", "mitm", "poisoning", "network", "github"] },
  { name: "Rubeus", owner: "GhostPack", repo: "Rubeus", description: "Raw Kerberos interaction and abuse", category: "repos/ad", tags: ["rubeus", "kerberos", "ad", "github"] },
  { name: "CrackMapExec", owner: "mpgn", repo: "CrackMapExec", description: "Swiss army knife for pentesting networks", category: "repos/tools", tags: ["cme", "smb", "network", "lateral-movement", "github"] },
];

// ── Cheat Sheet Content Fetcher ────────────────────────────────────────────────

interface CheatSheetSource {
  title: string;
  url: string;
  category: string;
  tags: string[];
}

const CHEATSHEET_SOURCES: CheatSheetSource[] = [
  {
    title: "OWASP SQL Injection Prevention Cheat Sheet",
    url: "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.md",
    category: "cheatsheets/web",
    tags: ["sqli", "owasp", "prevention", "cheatsheet"],
  },
  {
    title: "OWASP XSS Prevention Cheat Sheet",
    url: "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.md",
    category: "cheatsheets/web",
    tags: ["xss", "owasp", "prevention", "cheatsheet"],
  },
  {
    title: "OWASP Authentication Cheat Sheet",
    url: "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Authentication_Cheat_Sheet.md",
    category: "cheatsheets/auth",
    tags: ["authentication", "owasp", "security", "cheatsheet"],
  },
  {
    title: "OWASP SSRF Prevention Cheat Sheet",
    url: "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.md",
    category: "cheatsheets/web",
    tags: ["ssrf", "owasp", "prevention", "cheatsheet"],
  },
  {
    title: "OWASP Cryptographic Storage Cheat Sheet",
    url: "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Cryptographic_Storage_Cheat_Sheet.md",
    category: "cheatsheets/crypto",
    tags: ["crypto", "encryption", "owasp", "cheatsheet"],
  },
  {
    title: "OWASP Docker Security Cheat Sheet",
    url: "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Docker_Security_Cheat_Sheet.md",
    category: "cheatsheets/cloud",
    tags: ["docker", "containers", "owasp", "cheatsheet"],
  },
  {
    title: "OWASP JWT Security Cheat Sheet",
    url: "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.md",
    category: "cheatsheets/auth",
    tags: ["jwt", "tokens", "owasp", "cheatsheet"],
  },
  {
    title: "OWASP Input Validation Cheat Sheet",
    url: "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Input_Validation_Cheat_Sheet.md",
    category: "cheatsheets/web",
    tags: ["input-validation", "owasp", "sanitization", "cheatsheet"],
  },
];

// ── Security Tools & Techniques from GitHub ───────────────────────────────────

const TECHNIQUE_SOURCES: Array<{ title: string; url: string; category: string; tags: string[] }> = [
  {
    title: "Linux Privilege Escalation Techniques",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/Methodology%20and%20Resources/Linux%20-%20Privilege%20Escalation.md",
    category: "techniques/privesc",
    tags: ["linux", "privesc", "techniques", "pat"],
  },
  {
    title: "Windows Privilege Escalation Techniques",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/Methodology%20and%20Resources/Windows%20-%20Privilege%20Escalation.md",
    category: "techniques/privesc",
    tags: ["windows", "privesc", "techniques", "pat"],
  },
  {
    title: "Active Directory Attacks Cheatsheet",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/Methodology%20and%20Resources/Active%20Directory%20Attack.md",
    category: "techniques/ad",
    tags: ["active-directory", "kerberos", "techniques", "pat"],
  },
  {
    title: "Network Pivoting Techniques",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/Network%20Pivoting%20Techniques/README.md",
    category: "techniques/network",
    tags: ["pivoting", "tunneling", "network", "techniques", "pat"],
  },
  {
    title: "File Inclusion Techniques (LFI/RFI)",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/File%20Inclusion/README.md",
    category: "techniques/web",
    tags: ["lfi", "rfi", "file-inclusion", "techniques", "pat"],
  },
  {
    title: "SSTI Server-Side Template Injection",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/Server%20Side%20Template%20Injection/README.md",
    category: "techniques/web",
    tags: ["ssti", "template-injection", "techniques", "pat"],
  },
  {
    title: "XXE — XML External Entity",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/XXE%20Injection/README.md",
    category: "techniques/web",
    tags: ["xxe", "xml", "injection", "techniques", "pat"],
  },
  {
    title: "IDOR & Access Control Bypass",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/Insecure%20Direct%20Object%20References/README.md",
    category: "techniques/web",
    tags: ["idor", "access-control", "techniques", "pat"],
  },
  {
    title: "GraphQL Injection Techniques",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/GraphQL%20Injection/README.md",
    category: "techniques/web",
    tags: ["graphql", "injection", "api", "techniques", "pat"],
  },
  {
    title: "OAuth 2.0 Vulnerabilities",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/OAuth%20Misconfiguration/README.md",
    category: "techniques/auth",
    tags: ["oauth", "auth", "misconfiguration", "techniques", "pat"],
  },
  {
    title: "Cloud AWS Exploitation Techniques",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/Methodology%20and%20Resources/Cloud%20-%20AWS%20Pentest.md",
    category: "techniques/cloud",
    tags: ["aws", "cloud", "exploitation", "techniques", "pat"],
  },
  {
    title: "Open Redirect Payloads",
    url: "https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/Open%20Redirect/README.md",
    category: "techniques/web",
    tags: ["open-redirect", "redirect", "techniques", "pat"],
  },
];

// ── Security News & Advisories ─────────────────────────────────────────────────

const ADVISORY_SOURCES = [
  {
    name: "Exploit-DB Recent",
    url: "https://www.exploit-db.com/rss.xml",
    category: "advisories/exploitdb",
    tags: ["exploit-db", "exploits", "advisories"],
  },
  {
    name: "Packet Storm Recent",
    url: "https://packetstormsecurity.com/feeds/",
    category: "advisories/packetstorm",
    tags: ["packetstorm", "exploits", "advisories"],
  },
];

// ── Fetch Helper ───────────────────────────────────────────────────────────────

async function fetchText(url: string, maxBytes = 100000, timeout = 20000): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain,text/html,application/json,*/*" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    const text = new TextDecoder().decode(buf.slice(0, maxBytes));
    return text;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string, timeout = 15000): Promise<T | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!r.ok) return null;
    return await r.json() as T;
  } catch {
    return null;
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Upsert to knowledge (skip exact title duplicates) ─────────────────────────

async function upsertKnowledge(title: string, category: string, content: string, tags: string[]): Promise<boolean> {
  if (!content?.trim() || content.trim().length < 30) return false;
  try {
    await db.insert(knowledgeTable).values({
      title: title.slice(0, 300),
      category,
      content: content.slice(0, 20000),
      tags: tags.slice(0, 20),
    }).onConflictDoNothing();
    return true;
  } catch {
    return false;
  }
}

// ── Collector 1: Raw Payload Files ─────────────────────────────────────────────

export async function collectPayloads(onProgress?: (msg: string) => void): Promise<ExplorerResult> {
  const result: ExplorerResult = { source: "raw-payloads", collected: 0, skipped: 0, errors: [], duration: 0 };
  const start = Date.now();

  for (const src of RAW_PAYLOAD_SOURCES) {
    onProgress?.(`[PAYLOADS] Fetching: ${src.title}`);
    const text = await fetchText(src.url, src.maxBytes ?? 30000);
    if (!text) { result.skipped++; onProgress?.(`[SKIP] Could not fetch: ${src.url}`); await sleep(500); continue; }

    const lines = text.split("\n").filter(l => l.trim() && !l.startsWith("#")).length;
    const content = `Source: ${src.url}\nTotal entries: ${lines}\n\n${text}`;
    const ok = await upsertKnowledge(src.title, src.category, content, [...src.tags, "auto-explorer"]);
    if (ok) { result.collected++; onProgress?.(`[SAVED] ${src.title} (${lines} lines)`); }
    else { result.skipped++; }
    await sleep(800);
  }

  result.duration = Date.now() - start;
  logger.info({ collected: result.collected, skipped: result.skipped }, "Nova Explorer: payloads collected");
  return result;
}

// ── Collector 2: GitHub Repos Index ───────────────────────────────────────────

export async function collectGitHubRepos(onProgress?: (msg: string) => void): Promise<ExplorerResult> {
  const result: ExplorerResult = { source: "github-repos", collected: 0, skipped: 0, errors: [], duration: 0 };
  const start = Date.now();

  interface GitHubRepo {
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    watchers_count: number;
    forks_count: number;
    language: string | null;
    topics: string[];
    updated_at: string;
    open_issues_count: number;
    license?: { spdx_id: string };
  }

  for (const src of GITHUB_REPO_SOURCES) {
    onProgress?.(`[GITHUB] Fetching: ${src.owner}/${src.repo}`);
    const data = await fetchJson<GitHubRepo>(`https://api.github.com/repos/${src.owner}/${src.repo}`);

    if (!data) { result.skipped++; await sleep(1200); continue; }

    const content =
      `# ${src.name}\n\n` +
      `**GitHub**: https://github.com/${src.owner}/${src.repo}\n` +
      `**Stars**: ${data.stargazers_count?.toLocaleString() ?? "?"}\n` +
      `**Forks**: ${data.forks_count?.toLocaleString() ?? "?"}\n` +
      `**Language**: ${data.language ?? "Multiple"}\n` +
      `**License**: ${data.license?.spdx_id ?? "N/A"}\n` +
      `**Last Updated**: ${data.updated_at ?? ""}\n` +
      `**Topics**: ${(data.topics ?? []).join(", ")}\n\n` +
      `## Description\n${src.description}\n\n` +
      `${data.description ? `**GitHub Description**: ${data.description}\n` : ""}` +
      `\n## Use Cases in Cybersecurity\n${getRepoUseCases(src.name)}`;

    const ok = await upsertKnowledge(
      `[GitHub] ${src.name}`,
      src.category,
      content,
      [...src.tags, "github-repo", `stars-${Math.floor((data.stargazers_count ?? 0) / 1000)}k`, "auto-explorer"],
    );

    if (ok) { result.collected++; onProgress?.(`[SAVED] ${src.name} (⭐${data.stargazers_count})`); }
    else { result.skipped++; }

    await sleep(1200); // GitHub rate limit
  }

  result.duration = Date.now() - start;
  return result;
}

function getRepoUseCases(name: string): string {
  const uses: Record<string, string> = {
    "PayloadsAllTheThings": "- جمع payloads للـ SQL Injection, XSS, SSRF, SSTI\n- Bypass تقنيات الحماية (WAF, filters)\n- مرجع شامل لثغرات تطبيقات الويب",
    "SecLists": "- Fuzzing مجلدات وملفات الويب\n- اختبار كلمات المرور الشائعة\n- اكتشاف Subdomains\n- قوائم API endpoints",
    "HackTricks": "- موسوعة شاملة لتقنيات الاختراق\n- Active Directory attacks\n- Cloud security (AWS, Azure, GCP)\n- Post-exploitation techniques",
    "GTFOBins": "- ثنائيات Linux للـ privilege escalation\n- Bypass الـ restrictions عبر أدوات النظام\n- Living off the land techniques",
    "PEASS-ng": "- LinPEAS: رفع الصلاحيات تلقائياً في Linux\n- WinPEAS: رفع الصلاحيات في Windows\n- اكتشاف misconfigurations",
    "Nuclei Templates": "- قوالب فحص الثغرات الأمني\n- CVE detection templates\n- Technology fingerprinting\n- Misconfiguration detection",
    "OWASP CheatSheets": "- مرجع OWASP لأمان تطبيقات الويب\n- دليل الحماية من الثغرات الشائعة\n- أفضل الممارسات الأمنية",
  };
  return uses[name] ?? "- أداة أمنية احترافية مفتوحة المصدر\n- تستخدم في اختبارات الاختراق\n- مرجع للباحثين الأمنيين";
}

// ── Collector 3: OWASP Cheat Sheets (Full Content) ────────────────────────────

export async function collectCheatSheets(onProgress?: (msg: string) => void): Promise<ExplorerResult> {
  const result: ExplorerResult = { source: "cheatsheets", collected: 0, skipped: 0, errors: [], duration: 0 };
  const start = Date.now();

  for (const src of CHEATSHEET_SOURCES) {
    onProgress?.(`[CHEATSHEET] Fetching: ${src.title}`);
    const text = await fetchText(src.url, 80000);
    if (!text) { result.skipped++; await sleep(600); continue; }

    const ok = await upsertKnowledge(src.title, src.category, text, [...src.tags, "auto-explorer"]);
    if (ok) { result.collected++; onProgress?.(`[SAVED] ${src.title} (${text.length} chars)`); }
    else { result.skipped++; }
    await sleep(700);
  }

  result.duration = Date.now() - start;
  return result;
}

// ── Collector 4: Security Techniques (PAT Markdown) ───────────────────────────

export async function collectTechniques(onProgress?: (msg: string) => void): Promise<ExplorerResult> {
  const result: ExplorerResult = { source: "techniques", collected: 0, skipped: 0, errors: [], duration: 0 };
  const start = Date.now();

  for (const src of TECHNIQUE_SOURCES) {
    onProgress?.(`[TECHNIQUE] Fetching: ${src.title}`);
    const text = await fetchText(src.url, 60000);
    if (!text || text.length < 200) { result.skipped++; await sleep(500); continue; }

    const ok = await upsertKnowledge(src.title, src.category, text, [...src.tags, "auto-explorer"]);
    if (ok) { result.collected++; onProgress?.(`[SAVED] ${src.title} (${text.length} chars)`); }
    else { result.skipped++; }
    await sleep(700);
  }

  result.duration = Date.now() - start;
  return result;
}

// ── Collector 5: GitHub Security Topic Search ─────────────────────────────────

const GITHUB_SEARCH_TOPICS = [
  "penetration-testing",
  "ctf-tools",
  "red-team",
  "bug-bounty",
  "osint",
  "web-security",
  "privilege-escalation",
  "post-exploitation",
];

export async function collectGitHubTopicRepos(onProgress?: (msg: string) => void): Promise<ExplorerResult> {
  const result: ExplorerResult = { source: "github-topics", collected: 0, skipped: 0, errors: [], duration: 0 };
  const start = Date.now();

  interface SearchResult {
    items?: Array<{
      full_name: string;
      html_url: string;
      description: string | null;
      stargazers_count: number;
      language: string | null;
      topics: string[];
    }>;
  }

  for (const topic of GITHUB_SEARCH_TOPICS) {
    onProgress?.(`[GITHUB TOPICS] Searching: ${topic}`);
    const url = `https://api.github.com/search/repositories?q=topic:${topic}&sort=stars&per_page=10&order=desc`;
    const data = await fetchJson<SearchResult>(url);

    if (!data?.items) { result.skipped++; await sleep(2000); continue; }

    const filtered = data.items.filter(r => (r.stargazers_count ?? 0) >= 100);

    if (filtered.length > 0) {
      const content =
        `# Security Repositories — Topic: ${topic}\n\n` +
        `*Auto-collected from GitHub topic search*\n\n` +
        filtered.map(r =>
          `## ${r.full_name}\n` +
          `- **URL**: ${r.html_url}\n` +
          `- **Stars**: ${r.stargazers_count}\n` +
          `- **Language**: ${r.language ?? "N/A"}\n` +
          `- **Description**: ${r.description ?? "No description"}\n` +
          `- **Topics**: ${(r.topics ?? []).join(", ")}\n`
        ).join("\n---\n");

      const ok = await upsertKnowledge(
        `[GitHub Topic] ${topic} — Top Repositories`,
        "repos/discovery",
        content,
        [topic, "github", "repos", "security", "auto-explorer"],
      );
      if (ok) { result.collected++; onProgress?.(`[SAVED] ${topic}: ${filtered.length} repos`); }
    }

    await sleep(3000); // GitHub search rate limit
  }

  result.duration = Date.now() - start;
  return result;
}

// ── Collector 6: Exploit-DB RSS ───────────────────────────────────────────────

export async function collectExploitDbAdvisories(onProgress?: (msg: string) => void): Promise<ExplorerResult> {
  const result: ExplorerResult = { source: "exploit-db", collected: 0, skipped: 0, errors: [], duration: 0 };
  const start = Date.now();

  onProgress?.("[EXPLOIT-DB] Fetching recent entries from Exploit-DB API");

  // Exploit-DB has a public API at exploit-db.com/search
  const url = "https://www.exploit-db.com/search?type=json&draw=1&columns[0][data]=date_published&order[0][column]=0&order[0][dir]=desc&start=0&length=20&search[value]=";
  const data = await fetchJson<{ data?: Array<{ id: string; date_published: string; description: string; type: string; platform: string; author: { name: string }; code_file?: string }> }>(url);

  if (data?.data?.length) {
    const content =
      `# Exploit-DB — Recent Exploits (Auto-collected)\n\n` +
      `*Fetched: ${new Date().toISOString()}*\n\n` +
      data.data.map(e =>
        `## ${e.description ?? "Unknown"}\n` +
        `- **ID**: EDB-${e.id}\n` +
        `- **Date**: ${e.date_published}\n` +
        `- **Type**: ${e.type}\n` +
        `- **Platform**: ${e.platform}\n` +
        `- **Author**: ${e.author?.name ?? "Unknown"}\n` +
        `- **URL**: https://www.exploit-db.com/exploits/${e.id}\n`
      ).join("\n---\n");

    const ok = await upsertKnowledge(
      `[Exploit-DB] Recent Exploits — ${new Date().toDateString()}`,
      "advisories/exploitdb",
      content,
      ["exploit-db", "exploits", "advisories", "auto-explorer", "auto-collected"],
    );
    if (ok) { result.collected++; onProgress?.(`[SAVED] Exploit-DB: ${data.data.length} entries`); }
  } else {
    result.skipped++;
    onProgress?.("[SKIP] Exploit-DB: no data returned");
  }

  result.duration = Date.now() - start;
  return result;
}

// ── Collector 7: MITRE ATT&CK Techniques (via API) ────────────────────────────

export async function collectMitreAttack(onProgress?: (msg: string) => void): Promise<ExplorerResult> {
  const result: ExplorerResult = { source: "mitre-attack", collected: 0, skipped: 0, errors: [], duration: 0 };
  const start = Date.now();

  onProgress?.("[MITRE] Fetching ATT&CK Enterprise framework data");

  interface MitreObject {
    type: string;
    id: string;
    name?: string;
    description?: string;
    external_references?: Array<{ source_name: string; external_id?: string; url?: string }>;
    kill_chain_phases?: Array<{ phase_name: string }>;
    x_mitre_platforms?: string[];
  }
  interface MitreBundle { objects?: MitreObject[] }

  const data = await fetchJson<MitreBundle>(
    "https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json",
    45000,
  );

  if (!data?.objects) { result.skipped++; result.duration = Date.now() - start; return result; }

  // Group techniques by tactic
  const techniques = data.objects.filter(o =>
    o.type === "attack-pattern" && o.name && o.description
  );

  onProgress?.(`[MITRE] Found ${techniques.length} ATT&CK techniques`);

  // Store by tactic group
  const byTactic = new Map<string, MitreObject[]>();
  for (const t of techniques) {
    const phases = t.kill_chain_phases ?? [];
    for (const phase of phases) {
      const tactic = phase.phase_name;
      const existing = byTactic.get(tactic) ?? [];
      existing.push(t);
      byTactic.set(tactic, existing);
    }
  }

  for (const [tactic, techs] of byTactic) {
    if (techs.length === 0) continue;
    const content =
      `# MITRE ATT&CK — ${tactic.replace(/-/g, " ").toUpperCase()}\n\n` +
      `*Tactic: ${tactic} | Total techniques: ${techs.length}*\n\n` +
      techs.slice(0, 30).map(t => {
        const extRef = t.external_references?.find(r => r.source_name === "mitre-attack");
        return `## ${t.name} (${extRef?.external_id ?? "?"})\n` +
          `**Platforms**: ${(t.x_mitre_platforms ?? []).join(", ")}\n\n` +
          `${(t.description ?? "").slice(0, 500)}\n` +
          (extRef?.url ? `\n[MITRE Reference](${extRef.url})\n` : "");
      }).join("\n---\n");

    const ok = await upsertKnowledge(
      `[MITRE ATT&CK] ${tactic}`,
      "frameworks/mitre",
      content,
      ["mitre", "att&ck", tactic, "framework", "auto-explorer"],
    );
    if (ok) { result.collected++; onProgress?.(`[SAVED] MITRE ATT&CK: ${tactic} (${techs.length} techniques)`); }
    await sleep(200);
  }

  result.duration = Date.now() - start;
  return result;
}

// ── Collector 8: CVEDetails Stats & Top Vendors ───────────────────────────────

export async function collectCveStats(onProgress?: (msg: string) => void): Promise<ExplorerResult> {
  const result: ExplorerResult = { source: "cve-stats", collected: 0, skipped: 0, errors: [], duration: 0 };
  const start = Date.now();

  onProgress?.("[CVE-STATS] Fetching CVE year statistics from NVD");

  const thisYear = new Date().getFullYear();
  const lastYear = thisYear - 1;

  for (const year of [lastYear, thisYear]) {
    const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=${year}-01-01T00:00:00.000&pubEndDate=${year}-12-31T23:59:59.000&resultsPerPage=5`;
    onProgress?.(`[CVE-STATS] NVD year ${year}...`);

    interface NvdResponse {
      totalResults?: number;
      vulnerabilities?: Array<{
        cve: {
          id: string;
          descriptions?: Array<{ lang: string; value: string }>;
          metrics?: { cvssMetricV31?: Array<{ cvssData: { baseScore: number; baseSeverity: string } }> };
        }
      }>;
    }

    const data = await fetchJson<NvdResponse>(url, 20000);
    if (!data) { await sleep(3000); continue; }

    const totalResults = data.totalResults ?? 0;
    const topCves = (data.vulnerabilities ?? []).slice(0, 5).map(v => {
      const desc = v.cve.descriptions?.find(d => d.lang === "en")?.value ?? "";
      const score = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseScore ?? "N/A";
      const severity = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseSeverity ?? "N/A";
      return `### ${v.cve.id}\n- **CVSS**: ${score} (${severity})\n- ${desc.slice(0, 200)}`;
    }).join("\n\n");

    const content =
      `# CVE Statistics — Year ${year}\n\n` +
      `**Total CVEs Published in ${year}**: ${totalResults.toLocaleString()}\n\n` +
      `## Recent Examples\n\n${topCves}\n\n` +
      `*Source: NIST National Vulnerability Database — ${new Date().toISOString()}*`;

    const ok = await upsertKnowledge(
      `[NVD] CVE Statistics ${year}`,
      "stats/cves",
      content,
      ["nvd", "cve", "statistics", year.toString(), "auto-explorer"],
    );
    if (ok) { result.collected++; onProgress?.(`[SAVED] NVD ${year}: ${totalResults} total CVEs`); }
    await sleep(3000);
  }

  result.duration = Date.now() - start;
  return result;
}

// ── Master Runner ──────────────────────────────────────────────────────────────

export type ExplorerTask = "payloads" | "github-repos" | "cheatsheets" | "techniques" | "github-topics" | "exploit-db" | "mitre" | "cve-stats" | "all";

export async function runExplorer(
  task: ExplorerTask = "all",
  onProgress?: (msg: string) => void,
): Promise<ExplorerResult[]> {
  const results: ExplorerResult[] = [];
  onProgress?.(`[NOVA EXPLORER] Starting task: ${task}`);

  const tasks: Array<[string, () => Promise<ExplorerResult>]> = [];

  if (task === "all" || task === "payloads")      tasks.push(["payloads", () => collectPayloads(onProgress)]);
  if (task === "all" || task === "github-repos")  tasks.push(["github-repos", () => collectGitHubRepos(onProgress)]);
  if (task === "all" || task === "cheatsheets")   tasks.push(["cheatsheets", () => collectCheatSheets(onProgress)]);
  if (task === "all" || task === "techniques")    tasks.push(["techniques", () => collectTechniques(onProgress)]);
  if (task === "all" || task === "github-topics") tasks.push(["github-topics", () => collectGitHubTopicRepos(onProgress)]);
  if (task === "all" || task === "exploit-db")    tasks.push(["exploit-db", () => collectExploitDbAdvisories(onProgress)]);
  if (task === "all" || task === "mitre")         tasks.push(["mitre", () => collectMitreAttack(onProgress)]);
  if (task === "all" || task === "cve-stats")     tasks.push(["cve-stats", () => collectCveStats(onProgress)]);

  for (const [name, fn] of tasks) {
    onProgress?.(`\n═══ Starting: ${name} ═══`);
    try {
      const r = await fn();
      results.push(r);
      onProgress?.(`[DONE] ${name}: ${r.collected} collected, ${r.skipped} skipped, ${r.duration}ms`);
    } catch (err) {
      onProgress?.(`[ERROR] ${name}: ${String(err)}`);
      results.push({ source: name, collected: 0, skipped: 0, errors: [String(err)], duration: 0 });
    }
  }

  const totalCollected = results.reduce((s, r) => s + r.collected, 0);
  onProgress?.(`\n[NOVA EXPLORER] Complete! Total collected: ${totalCollected}`);
  logger.info({ task, totalCollected, tasks: results.length }, "Nova Explorer: run complete");
  return results;
}
