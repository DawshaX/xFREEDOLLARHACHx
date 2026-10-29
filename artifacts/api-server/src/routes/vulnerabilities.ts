import { Router } from "express";


const router = Router();

interface Vuln {
  id: number;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  target: string;
  port: number | null;
  cve: string | null;
  discoveredAt: string;
  status: "open" | "investigating" | "mitigated" | "closed";
}

let vulns: Vuln[] = [
  { id: 1, title: "OpenSSH Weak Cipher", description: "SSH service accepts weak cipher suites (arcfour, blowfish)", severity: "medium", target: "192.168.1.1", port: 22, cve: "CVE-2023-38408", discoveredAt: new Date().toISOString(), status: "open" },
  { id: 2, title: "SMB EternalBlue Exposure", description: "Port 445 open, potential MS17-010 vulnerability", severity: "critical", target: "192.168.1.5", port: 445, cve: "CVE-2017-0144", discoveredAt: new Date().toISOString(), status: "open" },
  { id: 3, title: "HTTP Default Credentials", description: "Web service responding with default admin credentials", severity: "high", target: "192.168.1.10", port: 80, cve: null, discoveredAt: new Date().toISOString(), status: "investigating" },
];
let nextId = 4;

router.get("/vulnerabilities", (_req, res) => {
  res.json(vulns);
});

router.post("/vulnerabilities", (req, res) => {
  const { id } = req.body as { title: string; description?: string; severity?: string; target?: string; port?: number | null; cve?: string | null };
  const before = vulns.length;
  vulns = vulns.filter((v) => v.id !== id);
  res.json({ success: vulns.length < before, message: "Deleted" });
});

export default router;
