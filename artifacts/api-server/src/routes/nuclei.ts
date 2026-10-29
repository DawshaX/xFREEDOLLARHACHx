import { Router, type IRouter, type Request, type Response } from "express";
import { spawn, execSync } from "node:child_process";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function isNucleiAvailable(): boolean {
  try { execSync("which nuclei", { stdio: "ignore" }); return true; } catch { return false; }
}

router.get("/nuclei/status", (_req: Request, res: Response) => {
  res.json({ available: isNucleiAvailable() });
});

router.get("/nuclei/scan", (req: Request, res: Response) => {
  const { target, templates = "cves,exposures,technologies,misconfiguration", severity = "critical,high,medium" } = req.query as Record<string, string>;

  if (!target) { res.status(400).json({ error: "target required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: "log", message: `[NOVA] Starting Nuclei scan on ${target}` });

  if (!isNucleiAvailable()) {
    // Demo/simulation mode when nuclei is not installed
    send({ type: "log", message: "[NOVA] Nuclei not installed — running in simulation mode" });
    const demoResults = [
      { templateId: "CVE-2021-44228", name: "Apache Log4j RCE", severity: "critical", matched: target, type: "http", timestamp: new Date().toISOString(), info: "Log4Shell vulnerability detected" },
      { templateId: "CVE-2022-0778", name: "OpenSSL Infinite Loop", severity: "high", matched: target, type: "network", timestamp: new Date().toISOString() },
      { templateId: "tech-nginx", name: "Nginx Web Server", severity: "info", matched: target, type: "http", timestamp: new Date().toISOString(), info: "Nginx/1.18.0 detected" },
      { templateId: "misconfig-cors", name: "CORS Misconfiguration", severity: "medium", matched: target, type: "http", timestamp: new Date().toISOString(), info: "Access-Control-Allow-Origin: *" },
    ];
    let i = 0;
    const sim = setInterval(() => {
      if (i >= demoResults.length) {
        clearInterval(sim);
        send({ type: "log", message: `[NOVA] Simulation complete — ${demoResults.length} demo findings` });
        send({ type: "done", results: demoResults });
        res.end();
        return;
      }
      const r = demoResults[i++]!;
      send({ type: "log", message: `[NUCLEI] Found: ${r.name} [${r.severity.toUpperCase()}]` });
      send({ type: "result", data: r });
    }, 800);
    req.on("close", () => clearInterval(sim));
    return;
  }

  const templateFlags = templates.split(",").flatMap(t => ["-t", t.trim()]);
  const args = [
    "-target", target,
    ...templateFlags,
    "-severity", severity,
    "-j",
    "-silent",
    "-no-color",
  ];

  logger.info({ target, templates, severity }, "Nuclei scan started");
  send({ type: "log", message: `[NUCLEI] nuclei ${args.join(" ")}` });

  const proc = spawn("nuclei", args, { stdio: ["ignore", "pipe", "pipe"] });

  proc.stdout.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(l => l.trim());
    for (const line of lines) {
      try {
        const json = JSON.parse(line) as {
          "template-id"?: string; info?: { name?: string; severity?: string; description?: string };
          "matched-at"?: string; type?: string; timestamp?: string;
        };
        const result = {
          templateId: json["template-id"] ?? "unknown",
          name: json.info?.name ?? json["template-id"] ?? "unknown",
          severity: json.info?.severity ?? "info",
          matched: json["matched-at"] ?? target,
          type: json.type ?? "http",
          timestamp: json.timestamp ?? new Date().toISOString(),
          info: json.info?.description,
        };
        send({ type: "log", message: `[NUCLEI] Found: ${result.name} [${result.severity.toUpperCase()}] at ${result.matched}` });
        send({ type: "result", data: result });
      } catch {
        if (line.trim()) send({ type: "log", message: `[NUCLEI] ${line}` });
      }
    }
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg) send({ type: "log", message: `[STDERR] ${msg}` });
  });

  proc.on("close", (code) => {
    logger.info({ code }, "Nuclei scan finished");
    send({ type: "log", message: `[NUCLEI] Process exited with code ${code}` });
    send({ type: "done" });
    res.end();
  });

  proc.on("error", (err) => {
    logger.error({ err }, "Nuclei process error");
    send({ type: "error", message: err.message });
    res.end();
  });

  req.on("close", () => { proc.kill(); });
});

export default router;
