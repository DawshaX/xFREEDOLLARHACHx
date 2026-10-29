import { Router, type IRouter } from "express";
import { startProcess, getProcess } from "../lib/processes";

const router: IRouter = Router();

const AVAILABLE_TOOLS = [
  // Recon
  { id: "nmap", name: "Nmap", category: "recon", description: "فحص الشبكات والمنافذ", installCmd: "apt-get install -y nmap", checkCmd: "nmap --version" },
  { id: "whois", name: "Whois", category: "recon", description: "معلومات تسجيل النطاقات", installCmd: "apt-get install -y whois", checkCmd: "whois --version" },
  { id: "dnsutils", name: "DNS Utils", category: "recon", description: "أدوات DNS (dig, nslookup)", installCmd: "apt-get install -y dnsutils", checkCmd: "dig -v" },
  { id: "traceroute", name: "Traceroute", category: "recon", description: "تتبع مسار الشبكة", installCmd: "apt-get install -y traceroute", checkCmd: "traceroute --version" },
  { id: "masscan", name: "Masscan", category: "recon", description: "فحص المنافذ بسرعة عالية", installCmd: "apt-get install -y masscan", checkCmd: "masscan --version" },
  { id: "subfinder", name: "Subfinder", category: "recon", description: "اكتشاف النطاقات الفرعية", installCmd: "apt-get install -y subfinder 2>/dev/null || go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest", checkCmd: "subfinder -version" },

  // Exploit
  { id: "sqlmap", name: "SQLMap", category: "exploit", description: "اكتشاف ثغرات SQL Injection", installCmd: "apt-get install -y sqlmap", checkCmd: "sqlmap --version" },
  { id: "nikto", name: "Nikto", category: "exploit", description: "فحص ثغرات خوادم الويب", installCmd: "apt-get install -y nikto", checkCmd: "nikto -Version" },
  { id: "hydra", name: "Hydra", category: "exploit", description: "هجمات Brute Force", installCmd: "apt-get install -y hydra", checkCmd: "hydra -h" },
  { id: "gobuster", name: "Gobuster", category: "exploit", description: "اكتشاف المسارات والملفات", installCmd: "apt-get install -y gobuster", checkCmd: "gobuster version" },

  // Analysis
  { id: "tshark", name: "Wireshark CLI (tshark)", category: "analysis", description: "تحليل حزم الشبكة", installCmd: "apt-get install -y tshark", checkCmd: "tshark --version" },
  { id: "tcpdump", name: "TCPDump", category: "analysis", description: "التقاط حزم الشبكة", installCmd: "apt-get install -y tcpdump", checkCmd: "tcpdump --version" },
  { id: "netcat", name: "Netcat", category: "analysis", description: "أداة الشبكة متعددة الاستخدام", installCmd: "apt-get install -y netcat-openbsd", checkCmd: "nc -h" },
  { id: "john", name: "John the Ripper", category: "analysis", description: "كسر كلمات المرور", installCmd: "apt-get install -y john", checkCmd: "john --version" },
  { id: "hashcat", name: "Hashcat", category: "analysis", description: "كسر كلمات المرور المتقدم", installCmd: "apt-get install -y hashcat", checkCmd: "hashcat --version" },

  // Python
  { id: "scapy", name: "Scapy", category: "python", description: "مكتبة Python لمعالجة الحزم", installCmd: "pip3 install scapy", checkCmd: "python3 -c 'import scapy; print(scapy.__version__)'" },
  { id: "impacket", name: "Impacket", category: "python", description: "مكتبة Python لبروتوكولات الشبكة", installCmd: "pip3 install impacket", checkCmd: "python3 -c 'import impacket; print(impacket.__version__)'" },
  { id: "requests", name: "Requests", category: "python", description: "مكتبة HTTP لـ Python", installCmd: "pip3 install requests", checkCmd: "python3 -c 'import requests; print(requests.__version__)'" },
  { id: "shodan", name: "Shodan CLI", category: "python", description: "واجهة Shodan", installCmd: "pip3 install shodan", checkCmd: "shodan version" },

  // Scanner
  { id: "nuclei", name: "Nuclei", category: "scanner", description: "فحص الثغرات بالقوالب", installCmd: "apt-get install -y nuclei 2>/dev/null || go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest", checkCmd: "nuclei -version" },
  { id: "httpx", name: "HTTPx", category: "scanner", description: "فحص HTTP متعدد الخيوط", installCmd: "go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest", checkCmd: "httpx -version" },
];

router.get("/modules/tools", async (_req, res) => {
  const toolsWithStatus = await Promise.all(
    AVAILABLE_TOOLS.map(async (tool) => {
      try {
        const proc = startProcess({ command: `${tool.checkCmd} 2>&1 | head -1` });
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            const p = getProcess(proc.id);
            if (p && p.status !== "running") {
              clearInterval(check);
              resolve();
            }
          }, 200);
          setTimeout(() => {
            clearInterval(check);
            resolve();
          }, 5000);
        });
        const p = getProcess(proc.id);
        const installed = p?.exitCode === 0;
        const version = p?.output?.split("\n")[0]?.trim() ?? "";
        return { ...tool, installed, version: installed ? version : null };
      } catch {
        return { ...tool, installed: false, version: null };
      }
    }),
  );
  res.json(toolsWithStatus);
});

router.post("/modules/tools/:id/install", (req, res) => {
  const toolId = req.params.id;
  const tool = AVAILABLE_TOOLS.find((t) => t.id === toolId);
  if (!tool) {
    res.status(404).json({ error: "Tool not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  function send(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  send("install_started", { toolId, toolName: tool.name, command: tool.installCmd });

  const proc = startProcess({
    command: `DEBIAN_FRONTEND=noninteractive ${tool.installCmd} 2>&1`,
    env: { DEBIAN_FRONTEND: "noninteractive" },
  });

  let lastOutput = "";
  const interval = setInterval(() => {
    const p = getProcess(proc.id);
    if (!p) return;

    const fresh = p.output.slice(lastOutput.length);
    if (fresh) {
      lastOutput = p.output;
      fresh.split("\n").forEach((line) => {
        if (line.trim()) send("output", { line });
      });
    }

    if (p.status !== "running") {
      clearInterval(interval);
      const success = p.exitCode === 0;
      send("install_completed", {
        toolId,
        toolName: tool.name,
        success,
        exitCode: p.exitCode,
      });
      res.end();
    }
  }, 300);

  setTimeout(() => {
    clearInterval(interval);
    send("install_timeout", { toolId, toolName: tool.name });
    res.end();
  }, 120000);
});

router.post("/modules/tools/:id/check", async (req, res) => {
  const toolId = req.params.id;
  const tool = AVAILABLE_TOOLS.find((t) => t.id === toolId);
  if (!tool) {
    res.status(404).json({ error: "Tool not found" });
    return;
  }

  try {
    const proc = startProcess({ command: `${tool.checkCmd} 2>&1 | head -1` });
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        const p = getProcess(proc.id);
        if (p && p.status !== "running") {
          clearInterval(check);
          resolve();
        }
      }, 200);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });
    const p = getProcess(proc.id);
    const installed = p?.exitCode === 0;
    const version = p?.output?.split("\n")[0]?.trim() ?? "";
    res.json({ toolId, installed, version: installed ? version : null });
  } catch (err) {
    res.json({ toolId, installed: false, error: String(err) });
  }
});

router.get("/modules/categories", (_req, res) => {
  const categories = [...new Set(AVAILABLE_TOOLS.map((t) => t.category))];
  const result = categories.map((cat) => ({
    id: cat,
    name: { recon: "الاستطلاع", exploit: "الاختراق", analysis: "التحليل", python: "Python", scanner: "الفحص" }[cat] ?? cat,
    tools: AVAILABLE_TOOLS.filter((t) => t.category === cat).length,
  }));
  res.json(result);
});

export default router;
