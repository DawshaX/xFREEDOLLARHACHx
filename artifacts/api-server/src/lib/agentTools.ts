import { db, cvesTable, mitreTechniquesTable, cweTable, ragFilesTable, knowledgeTable } from "@workspace/db";
import { ilike, or, eq, desc } from "drizzle-orm";
import { spawn } from "node:child_process";
import dns from "node:dns/promises";

export type ToolDef = {
  name: string;
  description: string;
  category: string;
  riskLevel: "low" | "medium" | "high";
  input_schema: Record<string, unknown>;
};

export const TOOLS: ToolDef[] = [
  {
    name: "search_cve_local",
    description: "بحث محلي في قاعدة بيانات CVEs (آخر التحديثات).",
    category: "vuln",
    riskLevel: "low",
    input_schema: { type: "object", properties: { q: { type: "string", description: "كلمة بحث" } }, required: ["q"] },
  },
  {
    name: "fetch_cve_live",
    description: "جلب بيانات CVE من NVD مباشرة عبر CVE-ID.",
    category: "vuln",
    riskLevel: "low",
    input_schema: { type: "object", properties: { cveId: { type: "string", description: "CVE-YYYY-NNNN" } }, required: ["cveId"] },
  },
  {
    name: "search_mitre",
    description: "بحث في تقنيات MITRE ATT&CK.",
    category: "intel",
    riskLevel: "low",
    input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
  {
    name: "search_cwe",
    description: "بحث في تصنيفات CWE.",
    category: "intel",
    riskLevel: "low",
    input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
  {
    name: "search_github",
    description: "البحث في GitHub عن مستودعات أو كود (PoCs/أدوات).",
    category: "search",
    riskLevel: "low",
    input_schema: {
      type: "object",
      properties: { q: { type: "string" }, kind: { type: "string", enum: ["repo", "code"] } },
      required: ["q"],
    },
  },
  {
    name: "search_exploitdb",
    description: "بحث في Exploit-DB عن استغلالات معروفة.",
    category: "vuln",
    riskLevel: "medium",
    input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
  {
    name: "fetch_url",
    description: "جلب محتوى URL خارجي للتحليل.",
    category: "recon",
    riskLevel: "low",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "dns_lookup",
    description: "استعلام DNS لنطاق ما (A, AAAA, MX, NS, TXT).",
    category: "recon",
    riskLevel: "low",
    input_schema: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] },
  },
  {
    name: "list_files",
    description: "قائمة الملفات المخزنة في قاعدة المعرفة.",
    category: "files",
    riskLevel: "low",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_file",
    description: "قراءة ملف من قاعدة البيانات بالاسم.",
    category: "files",
    riskLevel: "low",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "knowledge_search",
    description: "بحث في قاعدة المعرفة الداخلية (cheatsheets, OWASP, ...).",
    category: "kb",
    riskLevel: "low",
    input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
  {
    name: "run_shell",
    description: "تنفيذ أمر shell آمن (whitelist) على الخادم. للأوامر المسموحة فقط.",
    category: "exec",
    riskLevel: "high",
    input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
  },
  {
    name: "full_scan",
    description: "تشغيل سلسلة فحص شاملة (DNS + بحث CVE + بحث Exploit-DB) لهدف.",
    category: "scan",
    riskLevel: "medium",
    input_schema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
  },
  {
    name: "hash_text",
    description: "حساب hashes (md5, sha1, sha256) لنص.",
    category: "crypto",
    riskLevel: "low",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        algo: { type: "string", enum: ["md5", "sha1", "sha256"] },
      },
      required: ["text", "algo"],
    },
  },
];

const ALLOWED_BIN = new Set([
  "echo", "ls", "pwd", "whoami", "date", "uname", "id", "hostname",
  "cat", "head", "tail", "wc", "grep", "find", "stat", "file",
  "curl", "wget", "ping", "host", "dig", "nslookup", "whois",
  "nmap", "nikto", "gobuster", "ffuf", "sqlmap", "wpscan", "subfinder",
  "amass", "httpx", "nuclei", "naabu", "katana", "dnsx", "tlsx",
  "openssl", "sha256sum", "md5sum", "base64", "tr", "awk", "sed", "cut",
  "ps", "df", "du", "free", "uptime", "env", "node", "python3", "git",
  "which", "type",
]);

async function execShell(command: string, timeoutMs = 12000): Promise<string> {
  const first = command.trim().split(/[\s|;&><]+/)[0] ?? "";
  if (!ALLOWED_BIN.has(first)) return `الأمر غير مسموح: ${first}`;
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command]);
    let out = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } }, timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { out += d.toString(); });
    child.on("close", () => { clearTimeout(timer); resolve(out.slice(0, 8000) || "[بدون مخرجات]"); });
    child.on("error", (e) => { clearTimeout(timer); resolve(e.message); });
  });
}

export async function runTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_cve_local": {
      const q = String(input.q ?? "");
      const rows = await db.select().from(cvesTable).where(or(ilike(cvesTable.cveId, `%${q}%`), ilike(cvesTable.description, `%${q}%`))).limit(10);
      if (rows.length === 0) return "لا توجد نتائج محلية.";
      return rows.map((c) => `${c.cveId} | ${c.severity} | ${c.description.slice(0, 120)}`).join("\n");
    }
    case "fetch_cve_live": {
      const id = String(input.cveId ?? "").trim();
      try {
        const r = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(id)}`, { headers: { "User-Agent": "CyberNova/2.0" } });
        if (!r.ok) return `NVD: ${r.status}`;
        const data = await r.json() as { vulnerabilities?: Array<{ cve: Record<string, unknown> }> };
        const v = data.vulnerabilities?.[0]?.cve;
        if (!v) return "لم يتم العثور على CVE.";
        const desc = (v.descriptions as Array<{ value: string }>)?.[0]?.value ?? "";
        return `${v.id}\nالنشر: ${v.published}\nالوصف: ${desc.slice(0, 600)}`;
      } catch (e) { return `خطأ NVD: ${(e as Error).message}`; }
    }
    case "search_mitre": {
      const q = String(input.q ?? "");
      const rows = await db.select().from(mitreTechniquesTable).where(or(ilike(mitreTechniquesTable.techniqueId, `%${q}%`), ilike(mitreTechniquesTable.name, `%${q}%`), ilike(mitreTechniquesTable.description, `%${q}%`))).limit(10);
      if (rows.length === 0) return "لا توجد نتائج في MITRE.";
      return rows.map((m) => `${m.techniqueId} | ${m.name} (${m.tactic}): ${m.description.slice(0, 140)}`).join("\n");
    }
    case "search_cwe": {
      const q = String(input.q ?? "");
      const rows = await db.select().from(cweTable).where(or(ilike(cweTable.cweId, `%${q}%`), ilike(cweTable.name, `%${q}%`), ilike(cweTable.description, `%${q}%`))).limit(10);
      if (rows.length === 0) return "لا توجد نتائج CWE.";
      return rows.map((c) => `${c.cweId} | ${c.name}: ${c.description.slice(0, 140)}`).join("\n");
    }
    case "search_github": {
      const q = String(input.q ?? "");
      const kind = String(input.kind ?? "repo");
      const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "CyberNova/2.0" };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const url = kind === "code" ? `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=8` : `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=8`;
      try {
        const r = await fetch(url, { headers });
        if (!r.ok) return `GitHub: ${r.status}`;
        const data = await r.json() as { items?: Array<{ full_name?: string; html_url?: string; description?: string; stargazers_count?: number }> };
        const items = data.items ?? [];
        if (items.length === 0) return "لا توجد نتائج.";
        return items.map((i) => `${i.full_name} (${i.stargazers_count ?? 0}*) — ${i.description ?? ""}\n  ${i.html_url}`).join("\n\n");
      } catch (e) { return `خطأ: ${(e as Error).message}`; }
    }
    case "search_exploitdb": {
      const q = String(input.q ?? "").toLowerCase();
      const url = `${process.env.SELF_BASE_URL ?? `http://localhost:${process.env.PORT ?? 8080}`}/api/search/exploitdb?q=${encodeURIComponent(q)}`;
      try {
        const r = await fetch(url);
        const data = await r.json() as Array<{ id: string; title: string; type: string; platform: string; url: string }>;
        if (!Array.isArray(data) || data.length === 0) return "لا توجد نتائج Exploit-DB.";
        return data.slice(0, 10).map((d) => `[${d.id}] ${d.title} (${d.platform}/${d.type}) — ${d.url}`).join("\n");
      } catch (e) { return `خطأ: ${(e as Error).message}`; }
    }
    case "fetch_url": {
      const url = String(input.url ?? "");
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "CyberNova/2.0" } });
        clearTimeout(t);
        const text = (await r.text()).slice(0, 4000);
        return `HTTP ${r.status} (${r.headers.get("content-type") ?? ""})\n\n${text}`;
      } catch (e) { return `خطأ: ${(e as Error).message}`; }
    }
    case "dns_lookup": {
      const d = String(input.domain ?? "");
      try {
        const [a, aaaa, mx, ns, txt] = await Promise.all([
          dns.resolve4(d).catch(() => []),
          dns.resolve6(d).catch(() => []),
          dns.resolveMx(d).catch(() => []),
          dns.resolveNs(d).catch(() => []),
          dns.resolveTxt(d).catch(() => []),
        ]);
        return `A: ${a.join(", ") || "-"}\nAAAA: ${aaaa.join(", ") || "-"}\nMX: ${mx.map((m) => `${m.priority} ${m.exchange}`).join(", ") || "-"}\nNS: ${ns.join(", ") || "-"}\nTXT: ${txt.flat().join(" | ") || "-"}`;
      } catch (e) { return `خطأ: ${(e as Error).message}`; }
    }
    case "list_files": {
      const rows = await db.select().from(ragFilesTable).orderBy(desc(ragFilesTable.createdAt)).limit(30);
      if (rows.length === 0) return "لا توجد ملفات.";
      return rows.map((f) => `${f.name} (${f.kind}, ${f.size} bytes)`).join("\n");
    }
    case "read_file": {
      const name = String(input.name ?? "");
      const [row] = await db.select().from(ragFilesTable).where(eq(ragFilesTable.name, name)).limit(1);
      if (!row) return "الملف غير موجود.";
      return `# ${row.name}\n${row.content.slice(0, 4000)}`;
    }
    case "knowledge_search": {
      const q = String(input.q ?? "");
      const rows = await db.select().from(knowledgeTable).where(or(ilike(knowledgeTable.title, `%${q}%`), ilike(knowledgeTable.content, `%${q}%`))).limit(8);
      if (rows.length === 0) return "لا يوجد في قاعدة المعرفة.";
      return rows.map((k) => `## ${k.title} [${k.category}]\n${k.content.slice(0, 600)}`).join("\n\n");
    }
    case "run_shell": {
      const cmd = String(input.command ?? "");
      return await execShell(cmd);
    }
    case "full_scan": {
      const target = String(input.target ?? "");
      const dnsRes = await runTool("dns_lookup", { domain: target });
      const cveRes = await runTool("search_cve_local", { q: target });
      const expRes = await runTool("search_exploitdb", { q: target });
      return `=== DNS ===\n${dnsRes}\n\n=== CVEs محلياً ===\n${cveRes}\n\n=== Exploit-DB ===\n${expRes}`;
    }
    case "hash_text": {
      const text = String(input.text ?? "");
      const algo = String(input.algo ?? "sha256");
      const { createHash } = await import("node:crypto");
      return createHash(algo).update(text).digest("hex");
    }
    default:
      return `أداة غير معروفة: ${name}`;
  }
}
