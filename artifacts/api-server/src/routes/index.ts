import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import statsRouter from "./stats";
import anthropicRouter from "./anthropic";
import aiRouter from "./ai";
import agentRouter from "./agent";
import liveAgentRouter from "./live_agent";
import kaligptRouter from "./kaligpt";
import filesRouter from "./files";
import settingsRouter from "./settings";
import cveRouter from "./cve";
import scannerRouter from "./scanner";
import processesRouter from "./processes";
import nvdRouter from "./security/nvd";
import cisaRouter from "./security/cisa";
import githubRouter from "./security/github";
import exploitdbRouter from "./security/exploitdb";
import fetchRouter from "./security/fetch";
import scanRouter from "./security/scan";
import proxyRouter from "./proxy";
import botRouter from "./bot";
import monitorRouter from "./monitor";
import modulesRouter from "./modules";
import providersRouter from "./providers";
import nodesRouter from "./nodes";
import keysRouter from "./keys";
import novaAgentV3Router from "./novaAgentV3";
import intelligenceRouter from "./intelligence";
import knowledgeRouter from "./knowledge";
import assetsRouter from "./assets";
import riskRouter from "./risk";
import evidenceRouter from "./evidence";
import iocRouter from "./ioc";
import osvRouter from "./osv";
import nucleiRouter from "./nuclei";
import reportsRouter from "./reports";
import explorerRouter from "./explorer";
import agentV2Router from "./agentV2";
import rootAgentRouter from "./rootAgent";
import ollamaStatusRouter from "./ollama-status";
import ollamaProxyRouter from "./ollama-proxy";
import memoryRouter from "./memory";
import threatDetectionRouter from "./threat-detection";

// Additional routes from v2 routes directory
import auditRouter from "./audit";
import bookmarksRouter from "./bookmarks";
import cveLiveRouter from "./cve-live";
import cvesRouter from "./cves";
import cweRouter from "./cwe";
import execRouter from "./exec";
import installerRouter from "./installer";
import kaliCommandRouter from "./kali-command";
import killSwitchRouter from "./kill-switch";
import liveAgentV2Router from "./live-agent";
import liveEventsRouter from "./live-events";
import localAgentRouter from "./local-agent";
import localAgentInputRouter from "./local-agent-input";
import mcpRouter from "./mcp";
import mitreRouter from "./mitre";
import networkRouter from "./network";
import notificationsRouter from "./notifications";
import novaCronRouter from "./nova-cron";
import novaIntelRouter from "./nova-intel";
import novaAgentV2Router from "./novaAgentV2";
import playbooksRouter from "./playbooks";
import searchRouter from "./search";
import shellRouter from "./shell";
import stubsRouter from "./stubs";
import systemRouter from "./system";
import terminalRouter from "./terminal";
import toolsRouter from "./tools";
import vulnerabilitiesRouter from "./vulnerabilities";
import webhooksRouter from "./webhooks";
import workspacesRouter from "./workspaces";
import dashboardRouter from "./dashboard";
import jobsRouter from "./jobs";
import novaAgentRouter from "./novaAgent";
import kaliTerminalRouter from "./kali-terminal";
import multiAiRouter from "./multi-ai";
import novaGatewayRouter from "./nova-gateway";

const router: IRouter = Router();

// Cache-Control headers for GET requests that return slowly-changing data
const CACHE_SECONDS: Record<string, number> = {
  "/cve/db/stats":     30,
  "/stats/dashboard":  30,
  "/cve/db/daily":     120,
  "/risk/stats":       60,
  "/assets":           30,
  "/ioc":              30,
  "/bot/cron":         60,
  "/bot/alerts":       30,
  "/providers/detailed": 30,
  "/status":           10,
};
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === "GET") {
    const ttl = CACHE_SECONDS[req.path] ?? 0;
    if (ttl > 0) {
      res.setHeader("Cache-Control", `public, max-age=${ttl}, stale-while-revalidate=${ttl * 2}`);
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
  next();
});

// ── Core ────────────────────────────────────────────────────────────────────
router.use(healthRouter);
router.use(statsRouter);
router.use(dashboardRouter);
router.use(anthropicRouter);
router.use(agentRouter);
router.use(agentV2Router);
router.use(novaAgentRouter);
router.use(novaAgentV2Router);
router.use(novaAgentV3Router);
router.use(rootAgentRouter);
router.use(kaliTerminalRouter);

// ── Multi-AI Free Providers ───────────────────────────────────────────────────
router.use(multiAiRouter);

// ── Nova Gateway (centralized AI + ngrok + Ollama status) ────────────────────
router.use(novaGatewayRouter);

// ── AI / Chat ────────────────────────────────────────────────────────────────
router.use(liveAgentRouter);
router.use(liveAgentV2Router);
router.use(liveEventsRouter);
router.use(localAgentRouter);
router.use(localAgentInputRouter);
router.use(kaliCommandRouter);
router.use(kaligptRouter);
router.use(aiRouter);

// ── Ollama ───────────────────────────────────────────────────────────────────
router.use(ollamaStatusRouter);
router.use(ollamaProxyRouter);

// ── Files, System, Terminal ──────────────────────────────────────────────────
router.use(filesRouter);
router.use(settingsRouter);
router.use(processesRouter);
router.use(execRouter);
router.use(systemRouter);
router.use(networkRouter);
router.use(terminalRouter);
router.use(shellRouter);
router.use(toolsRouter);

// ── CVE & Vuln ───────────────────────────────────────────────────────────────
router.use(cveRouter);
router.use(cvesRouter);
router.use(cveLiveRouter);
router.use(vulnerabilitiesRouter);
router.use(cweRouter);
router.use(mitreRouter);
router.use(scannerRouter);
router.use(nucleiRouter);
router.use(osvRouter);

// ── Security tool routes ─────────────────────────────────────────────────────
router.use("/nvd", nvdRouter);
router.use("/cisa", cisaRouter);
router.use("/github", githubRouter);
router.use("/exploitdb", exploitdbRouter);
router.use("/fetch", fetchRouter);
router.use("/scan", scanRouter);
router.use("/proxy", proxyRouter);
router.use(searchRouter);
router.use(killSwitchRouter);

// ── Bot, Cron, Monitor ───────────────────────────────────────────────────────
router.use(botRouter);
router.use(monitorRouter);
router.use(novaCronRouter);
router.use(novaIntelRouter);
router.use(modulesRouter);
router.use(providersRouter);
router.use(nodesRouter);
router.use(keysRouter);
router.use(mcpRouter);
router.use(notificationsRouter);
router.use(jobsRouter);

// ── Intel & Security Data ────────────────────────────────────────────────────
router.use(intelligenceRouter);
router.use(knowledgeRouter);
router.use(memoryRouter);
router.use(assetsRouter);
router.use(riskRouter);
router.use(evidenceRouter);
router.use(iocRouter);
router.use(threatDetectionRouter);
router.use(explorerRouter);

// ── Reporting & Audit ────────────────────────────────────────────────────────
router.use(reportsRouter);
router.use(auditRouter);
router.use(bookmarksRouter);
router.use(playbooksRouter);
router.use(workspacesRouter);
router.use(webhooksRouter);
router.use(installerRouter);

// ── Stubs (fallback compatibility) ───────────────────────────────────────────
router.use(stubsRouter);

export default router;
