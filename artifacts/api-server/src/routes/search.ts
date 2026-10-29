import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/search/github", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const kind = String(req.query.kind ?? "repo");
    if (!q) return res.json([]);
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "CyberNova-Ultimate-V2",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const url = kind === "code"
      ? `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=20`
      : `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`;
    const r = await fetch(url, { headers });
    if (!r.ok) return res.status(r.status).json({ error: `GitHub: ${r.status}`, message: await r.text() });
    const data = await r.json() as { items?: Array<Record<string, unknown>> };
    const items = (data.items ?? []).map((it) => {
      const repo = (it.repository ?? it) as Record<string, unknown>;
      return {
        id: String(it.id ?? it.sha ?? Math.random()),
        name: String(it.name ?? repo.name ?? ""),
        fullName: String(it.full_name ?? repo.full_name ?? ""),
        url: String(it.html_url ?? repo.html_url ?? ""),
        description: String(it.description ?? repo.description ?? ""),
        stars: Number(it.stargazers_count ?? repo.stargazers_count ?? 0),
        forks: Number(it.forks_count ?? repo.forks_count ?? 0),
        language: String(it.language ?? repo.language ?? ""),
        updatedAt: String(it.updated_at ?? repo.updated_at ?? new Date().toISOString()),
      };
    });
    return res.json(items);
  } catch (e) {
    return next(e);  }
});

const EXPLOITDB_SEED: Array<{ id: string; title: string; type: string; platform: string; author: string; date: string; url: string; verified: boolean; keywords: string[] }> = [
  { id: "51977", title: "WordPress Plugin Backup Migration 1.3.7 - RCE", type: "webapps", platform: "php", author: "Nguyen Van Khanh", date: "2024-01-15", url: "https://www.exploit-db.com/exploits/51977", verified: true, keywords: ["wordpress", "rce", "backup"] },
  { id: "51843", title: "Apache OFBiz - Authentication Bypass and RCE", type: "webapps", platform: "java", author: "hyp3rlinx", date: "2023-12-26", url: "https://www.exploit-db.com/exploits/51843", verified: true, keywords: ["apache", "ofbiz", "rce", "auth bypass"] },
  { id: "51334", title: "Microsoft Exchange Server - ProxyShell RCE", type: "remote", platform: "windows", author: "Orange Tsai", date: "2023-04-12", url: "https://www.exploit-db.com/exploits/51334", verified: true, keywords: ["exchange", "proxyshell", "rce"] },
  { id: "50840", title: "Atlassian Confluence - OGNL Injection RCE (CVE-2022-26134)", type: "webapps", platform: "java", author: "Volexity", date: "2022-06-03", url: "https://www.exploit-db.com/exploits/50840", verified: true, keywords: ["confluence", "atlassian", "ognl", "rce"] },
  { id: "50383", title: "Log4j 2 - Remote Code Execution (Log4Shell)", type: "remote", platform: "java", author: "kozmer", date: "2021-12-13", url: "https://www.exploit-db.com/exploits/50383", verified: true, keywords: ["log4j", "log4shell", "rce", "java"] },
  { id: "47009", title: "Apache Struts - OGNL RCE (CVE-2017-5638)", type: "remote", platform: "java", author: "Various", date: "2017-03-07", url: "https://www.exploit-db.com/exploits/41570", verified: true, keywords: ["struts", "ognl", "rce"] },
  { id: "42315", title: "EternalBlue - SMB RCE (MS17-010)", type: "remote", platform: "windows", author: "Shadow Brokers", date: "2017-04-14", url: "https://www.exploit-db.com/exploits/42315", verified: true, keywords: ["smb", "eternalblue", "rce", "ms17-010"] },
  { id: "51961", title: "Linux Kernel 6.5 - Local Privilege Escalation", type: "local", platform: "linux", author: "Researcher", date: "2024-02-10", url: "https://www.exploit-db.com/exploits/51961", verified: false, keywords: ["linux", "kernel", "lpe", "privilege escalation"] },
  { id: "51790", title: "Citrix NetScaler - Memory Disclosure (CitrixBleed CVE-2023-4966)", type: "remote", platform: "hardware", author: "AssetNote", date: "2023-10-25", url: "https://www.exploit-db.com/exploits/51790", verified: true, keywords: ["citrix", "netscaler", "citrixbleed"] },
  { id: "51919", title: "Ivanti Connect Secure - SSRF + Auth Bypass RCE", type: "remote", platform: "hardware", author: "Volexity", date: "2024-01-10", url: "https://www.exploit-db.com/exploits/51919", verified: true, keywords: ["ivanti", "ssrf", "auth bypass", "rce"] },
  { id: "51682", title: "MoveIt Transfer - SQLi to RCE (CVE-2023-34362)", type: "webapps", platform: "windows", author: "Cl0p", date: "2023-06-05", url: "https://www.exploit-db.com/exploits/51682", verified: true, keywords: ["moveit", "sqli", "rce"] },
  { id: "51731", title: "Cisco IOS XE - Web UI Privilege Escalation (CVE-2023-20198)", type: "webapps", platform: "hardware", author: "Talos", date: "2023-10-16", url: "https://www.exploit-db.com/exploits/51731", verified: true, keywords: ["cisco", "ios xe", "privilege escalation"] },
  { id: "51894", title: "Fortra GoAnywhere MFT - Auth Bypass (CVE-2024-0204)", type: "webapps", platform: "java", author: "Horizon3", date: "2024-01-22", url: "https://www.exploit-db.com/exploits/51894", verified: true, keywords: ["goanywhere", "fortra", "auth bypass"] },
  { id: "51996", title: "ConnectWise ScreenConnect - Auth Bypass + Path Traversal", type: "webapps", platform: "windows", author: "Huntress", date: "2024-02-21", url: "https://www.exploit-db.com/exploits/51996", verified: true, keywords: ["screenconnect", "connectwise", "auth bypass"] },
  { id: "52022", title: "JetBrains TeamCity - Auth Bypass RCE (CVE-2024-27198)", type: "webapps", platform: "java", author: "Rapid7", date: "2024-03-04", url: "https://www.exploit-db.com/exploits/52022", verified: true, keywords: ["teamcity", "jetbrains", "rce", "auth bypass"] },
  { id: "52084", title: "Palo Alto GlobalProtect - Command Injection (CVE-2024-3400)", type: "remote", platform: "hardware", author: "Volexity", date: "2024-04-12", url: "https://www.exploit-db.com/exploits/52084", verified: true, keywords: ["palo alto", "globalprotect", "rce"] },
  { id: "50542", title: "Spring4Shell - RCE (CVE-2022-22965)", type: "remote", platform: "java", author: "Spring Team", date: "2022-04-01", url: "https://www.exploit-db.com/exploits/50542", verified: true, keywords: ["spring", "rce", "java"] },
  { id: "47138", title: "vBulletin 5.x - PreAuth RCE", type: "webapps", platform: "php", author: "Various", date: "2019-09-25", url: "https://www.exploit-db.com/exploits/47138", verified: true, keywords: ["vbulletin", "rce", "preauth"] },
  { id: "49216", title: "F5 BIG-IP - TMUI RCE (CVE-2020-5902)", type: "remote", platform: "linux", author: "Mikhail Klyuchnikov", date: "2020-07-05", url: "https://www.exploit-db.com/exploits/49216", verified: true, keywords: ["f5", "bigip", "tmui", "rce"] },
  { id: "50498", title: "Chrome V8 - Type Confusion RCE", type: "remote", platform: "multiple", author: "Google P0", date: "2021-11-30", url: "https://www.exploit-db.com/exploits/50498", verified: true, keywords: ["chrome", "v8", "rce", "browser"] },
];

router.get("/search/exploitdb", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (!q) return res.json([]);
    const hits = EXPLOITDB_SEED.filter((e) => {
      return e.title.toLowerCase().includes(q)
        || e.platform.toLowerCase().includes(q)
        || e.type.toLowerCase().includes(q)
        || e.keywords.some((k) => k.includes(q));
    }).slice(0, 30).map(({ keywords: _k, ...rest }) => rest);
    return res.json(hits);
  } catch (e) {
    return next(e);  }
});

router.get("/search/web", async (req, res, next) => {
  try {
    const url = String(req.query.url ?? "").trim();
    if (!url) return res.status(400).json({ error: "url required" });
    let parsed: URL;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: "url غير صالح" }); }
    if (!["http:", "https:"].includes(parsed.protocol)) return res.status(400).json({ error: "البروتوكول غير مدعوم" });
    if (/^(127\.|10\.|192\.168\.|0\.|169\.254\.)/.test(parsed.hostname) || parsed.hostname === "localhost") {
      return res.status(400).json({ error: "عنوان داخلي محظور" });
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    let r: Response;
    try {
      r = await fetch(parsed.toString(), {
        signal: ctrl.signal,
        headers: { "User-Agent": "CyberNova-Recon/2.0" },
        redirect: "follow",
      });
    } finally { clearTimeout(t); }
    const ct = r.headers.get("content-type") ?? "text/html";
    const buf = await r.arrayBuffer();
    const cap = 256 * 1024;
    const slice = buf.byteLength > cap ? buf.slice(0, cap) : buf;
    const text = new TextDecoder("utf-8").decode(slice);
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    return res.json({
      url: parsed.toString(),
      status: r.status,
      title: titleMatch?.[1]?.trim() ?? parsed.hostname,
      contentType: ct,
      bytes: buf.byteLength,
      text: text.slice(0, 60_000),
      headers,
    });
  } catch (e) {
    return next(e);  }
});

export default router;
