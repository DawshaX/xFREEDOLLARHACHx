/**
 * Kali Environment API — the real proot-backed Kali Linux plane
 * ────────────────────────────────────────────────────────────────────────────────
 * The /kali-env page had no backend at all: it was a static mock. This router
 * gives it a real one, backed by `lib/ops/proot.ts`, which runs commands inside
 * an actual Kali rootfs via proot (no root, no VM, works in a container).
 *
 * Endpoints
 *   GET  /kali-env/health   → is proot + rootfs present, does the guest answer
 *   GET  /kali-env/tools    → which of the real Kali tools are installed
 *   POST /kali-env/exec     → run a command in the guest (SSE stream)
 *   GET  /kali-env/sessions → nothing to list; kept for panel compatibility
 *
 * Every route is behind the ops gate: this executes commands.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireOps } from "../lib/ops/gate";
import { detectProotLayout, prootHealth, runInProot } from "../lib/ops/proot";
import { kaliAnywhereExec } from "../lib/ops/kali-anywhere";
import { readProbeCache, probeAllKaliNodes } from "../lib/ops/kali-node-probe";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(requireOps("kali-env"));

/** The tools the operator asked for, grouped the way the page shows them. */
const TOOL_GROUPS: Record<string, string[]> = {
  recon: ["nmap", "masscan", "subfinder", "amass", "dnsx", "naabu", "httpx", "whatweb", "theHarvester"],
  web: ["gobuster", "ffuf", "feroxbuster", "dirb", "nikto", "nuclei", "katana", "sqlmap", "wpscan"],
  exploit: ["msfconsole", "msfvenom", "searchsploit", "metasploit"],
  password: ["hydra", "john", "hashcat", "medusa", "crunch"],
  wireless: ["aircrack-ng", "airmon-ng", "airodump-ng", "aireplay-ng", "reaver", "kismet"],
  mitm: ["bettercap", "ettercap", "mitmproxy", "responder"],
  forensics: ["wireshark", "tshark", "tcpdump", "binwalk", "foremost", "exiftool", "volatility"],
  utils: ["curl", "wget", "git", "python3", "node", "jq", "netcat", "socat", "openssl"],
};

/** TEST37 — أسطول كالي الحقيقي: العقد المتصلة وأيها جاهزة فعلاً (مقاس بالبروب،
 * كاش 3د). ده اللي يخلي الصفحة تعرض «كالي حقيقية شغالة في الخلفية» حتى لو
 * rootfs مش منصّبة على الهَب نفسه (حصة 1.5GB) — الكالي بتعيش على عقد الأسطول
 * وkaliAnywhereExec بيوصّل ليها failover تلقائي. */
async function fleetKaliSummary() {
  const cached = readProbeCache();
  let rows = cached.rows;
  if (!cached.fresh) {
    try {
      type ProbeRows = Awaited<ReturnType<typeof probeAllKaliNodes>>;
      rows = await Promise.race<ProbeRows>([
        probeAllKaliNodes(),
        new Promise<ProbeRows>((resolve) => setTimeout(() => resolve(rows), 8_000)),
      ]);
    } catch {
      /* الكاش الأقدم أنضف من «مفيش» — بيرجع زي ما هو */
    }
  }
  const kaliNodes = rows.filter((r) => r.kali);
  return {
    connected: rows.length,
    kaliReady: kaliNodes.length,
    nodes: rows.map((r) => ({ id: r.id, hostname: r.hostname, mode: r.mode, kali: r.kali, at: r.at })),
  };
}

router.get("/kali-env/health", async (_req, res) => {
  const layout = detectProotLayout();
  const health = await prootHealth();
  const fleet = await fleetKaliSummary();
  res.json({
    ...health,
    searched: layout.searched,
    // Honest: `ready` means proot+rootfs exist; `guestShell` means it actually ran.
    ok: health.ready && health.guestShell,
    // TEST37 — الطايرة التانية الحقيقية: عقد كالي السحابية (الأسطول).
    fleet,
    // الجاهزية الكاملة: إما rootfs على الهَب أو عقدة كالي حية جاهزة — والتين
    // مقاسين، مافيش تخمين.
    readyAnywhere: (health.ready && health.guestShell) || fleet.kaliReady > 0,
  });
});

router.get("/kali-env/tools", async (_req, res) => {
  const layout = detectProotLayout();
  if (!layout.ready) {
    // TEST37 — مافيش rootfs على الهَب؟ قيس الأدوات من عقدة كالي حية (نفس
    // أمر command -v، نفس التجميع) — القياس حقيقي من الطايرة السحابية بدل
    // «صفر أدوات» اللي بيظهر معاه إن كالي مش موجودة وهي موجودة على الأسطول.
    const all = [...new Set(Object.values(TOOL_GROUPS).flat())];
    const probe = all.map((t) => `command -v ${t} >/dev/null 2>&1 && echo "OK:${t}"`).join("; ");
    const fleet = await fleetKaliSummary();
    const r = await kaliAnywhereExec(probe, 30_000);
    if (r && r.exitCode === 0) {
      const found = new Set(
        r.stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("OK:")).map((l) => l.slice(3)),
      );
      const groups: Record<string, { present: string[]; missing: string[] }> = {};
      for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
        groups[group] = { present: tools.filter((t) => found.has(t)), missing: tools.filter((t) => !found.has(t)) };
      }
      const present = [...found].filter((t) => all.includes(t)).length;
      res.json({
        ok: true,
        ready: true,
        measuredOn: r.plane,
        hubRootfs: false,
        fleet,
        searched: layout.searched,
        groups,
        total: all.length,
        present,
      });
      return;
    }
    res.json({
      ok: false,
      ready: false,
      reason: "proot/rootfs not installed AND no live Kali node answered",
      searched: layout.searched,
      fleet,
      groups: {},
      total: 0,
      present: 0,
    });
    return;
  }

  // One `command -v` pass for every tool — measured, not assumed.
  const all = [...new Set(Object.values(TOOL_GROUPS).flat())];
  const probe = all.map((t) => `command -v ${t} >/dev/null 2>&1 && echo "OK:${t}"`).join("; ");
  const r = await runInProot({ command: probe, timeoutMs: 30_000 });

  const found = new Set(
    r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("OK:"))
      .map((l) => l.slice(3)),
  );

  const groups: Record<string, { present: string[]; missing: string[] }> = {};
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    groups[group] = {
      present: tools.filter((t) => found.has(t)),
      missing: tools.filter((t) => !found.has(t)),
    };
  }

  res.json({
    ok: true,
    ready: true,
    groups,
    total: all.length,
    present: found.size,
    measuredAt: new Date().toISOString(),
  });
});

router.post("/kali-env/exec", async (req: Request, res: Response) => {
  const { command, timeoutMs, cwd } = (req.body ?? {}) as {
    command?: string;
    timeoutMs?: number;
    cwd?: string;
  };

  if (typeof command !== "string" || !command.trim()) {
    res.status(400).json({ error: "command is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: unknown) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* client gone */
    }
  };

  const tmo = typeof timeoutMs === "number" ? Math.min(Math.max(timeoutMs, 1000), 600_000) : 120_000;
  send({ type: "start", command, cwd: cwd ?? "/root" });

  try {
    const result = await runInProot({
      command,
      timeoutMs: tmo,
      cwd,
      onData: (stream, chunk) => send({ type: stream, text: chunk }),
    });
    send({
      type: "done",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      error: result.error,
    });
  } catch (e) {
    logger.error({ e }, "kali-env exec failed");
    send({ type: "error", message: (e as Error).message });
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

router.get("/kali-env/sessions", (_req, res) => {
  // proot runs are one-shot; there is no persistent session to list. Answering
  // honestly beats inventing rows the page would then render as real.
  res.json({ sessions: [], note: "proot runs are one-shot; no persistent sessions" });
});

export default router;
