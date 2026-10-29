import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";


const execAsync = promisify(exec);
const router = Router();

router.post("/network/scan", async (req, res) => {
  const { target, scanType = "quick", ports } = req.body as { target: string; scanType?: string; ports?: string };
  if (!target) { res.status(400).json({ error: "target required" }); return; }
  const start = Date.now();

  let nmapArgs = "";
  switch (scanType) {
    case "quick":   nmapArgs = "-T4 -F"; break;
    case "full":    nmapArgs = "-T4 -p-"; break;
    case "os":      nmapArgs = "-T4 -O"; break;
    case "service": nmapArgs = "-T4 -sV"; break;
    case "vuln":    nmapArgs = "-T4 --script vuln"; break;
    default:        nmapArgs = "-T4 -F";
  }
  if (ports) nmapArgs += ` -p ${ports}`;

  try {
    const { stdout, stderr } = await execAsync(`nmap ${nmapArgs} ${target} 2>&1`, { timeout: 120000 });
    const rawOutput = stdout + (stderr ?? "");
    const hosts = parseNmapOutput(rawOutput, target);
    res.json({ target, scanType, hosts, rawOutput, duration: (Date.now() - start) / 1000 });
  } catch (err: any) {
    const rawOutput = err.stdout ?? err.message ?? "nmap not available or scan failed";
    res.json({ target, scanType, hosts: [], rawOutput, duration: (Date.now() - start) / 1000 });
  }
});

function parseNmapOutput(output: string, target: string) {
  const hosts: any[] = [];
  const lines = output.split("\n");
  let currentHost: any = null;

  for (const line of lines) {
    const hostMatch = line.match(/Nmap scan report for (.+?)(?:\s+\((.+?)\))?$/);
    if (hostMatch) {
      if (currentHost) hosts.push(currentHost);
      const ipOrHost = hostMatch[2] ?? hostMatch[1] ?? target;
      const maybeHostname = hostMatch[2] ? hostMatch[1] : null;
      currentHost = { ip: ipOrHost, hostname: maybeHostname, status: "up", os: null, ports: [] };
      continue;
    }

    if (!currentHost) {
      currentHost = { ip: target, hostname: null, status: "unknown", os: null, ports: [] };
    }

    const portMatch = line.match(/^(\d+)\/(tcp|udp)\s+(\w+)\s+(\S+)(?:\s+(.+))?$/);
    if (portMatch) {
      currentHost.ports.push({
        port: parseInt(portMatch[1] ?? "0"),
        protocol: portMatch[2] ?? "tcp",
        state: portMatch[3] ?? "unknown",
        service: portMatch[4] ?? "unknown",
        version: portMatch[5] ?? null,
      });
    }

    const osMatch = line.match(/OS details:\s*(.+)/) ?? line.match(/Running:\s*(.+)/);
    if (osMatch && currentHost) currentHost.os = osMatch[1] ?? null;
  }

  if (currentHost) hosts.push(currentHost);
  return hosts;
}

router.get("/network/interfaces", async (_req, res) => {
  const ifaces = os.networkInterfaces();
  const result = Object.entries(ifaces).map(([name, addrs]) => ({
    name,
    addresses: (addrs ?? []).map((a) => `${a.address}/${a.cidr?.split("/")[1] ?? "?"} (${a.family})`),
    mac: addrs?.[0]?.mac ?? null,
    isUp: (addrs?.length ?? 0) > 0,
  }));
  res.json(result);
});

export default router;
