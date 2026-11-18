/**
 * Kali Live — الجسر الموحد بين كل صفحات كالي
 * ────────────────────────────────────────────────
 * أي تنفيذ كالي في أي مكان يظهر حيًا في كل الصفحات عبر:
 * - WebSocket broadcast (ws-hub)
 * - Push notifications (push-hub)
 * - Shared state (via KaliContext)
 *
 * Endpoints:
 *   GET  /kali-live/status    → حالة كالي الموحدة (hub + fleet + desktop + tools summary)
 *   GET  /kali-live/history   → سجل التنفيذات الأخيرة (من kali_scan_stats)
 *   POST /kali-live/exec      → تنفيذ موحد (يختار الطائرة تلقائيًا ويبث حيًا)
 *   GET  /kali-live/files     → ملفات (ls -la عبر kaliAnywhere)
 *   GET  /kali-live/processes → عمليات (ps aux عبر kaliAnywhere)
 *   GET  /kali-live/network   → شبكة (ss/ip عبر kaliAnywhere)
 *   GET  /kali-live/tools     → أدوات مفصلة مع أوصاف عربية
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireOps } from "../lib/ops/gate";
import { kaliStatus, buildDesktopUrl } from "../lib/ops/kali-env";
import { detectProotLayout, prootHealth } from "../lib/ops/proot";
import { kaliAnywhereExec, kaliAnywhereExecStream } from "../lib/ops/kali-anywhere";
import { readProbeCache, probeAllKaliNodes } from "../lib/ops/kali-node-probe";
import { readScanStats } from "../lib/ops/kali-scan-stats";
import { broadcastEvent } from "../lib/ws-hub";
import { createPushNotification } from "../lib/push-hub";

const router: IRouter = Router();

// Status is public (read-only) — no token needed, like /ops/kali
router.get("/kali-live/status", async (_req, res) => {
  try {
    const [hubStatus, layout, health, scanStats] = await Promise.all([
      kaliStatus(false).catch(() => ({ present: false, root: null } as any)),
      Promise.resolve(detectProotLayout()),
      prootHealth().catch(() => ({ ready: false, prootBin: null, rootfs: null, guestShell: false, detail: "error" } as any)),
      Promise.resolve(readScanStats()),
    ]);

    const cached = readProbeCache();
    let fleet = { connected: 0, kaliReady: 0, nodes: [] as any[] };
    try {
      const rows = cached.fresh ? cached.rows : await Promise.race([
        probeAllKaliNodes(),
        new Promise<typeof cached.rows>((resolve) => setTimeout(() => resolve(cached.rows), 5000)),
      ] as const);
      fleet = {
        connected: rows.length,
        kaliReady: rows.filter(r => r.kali).length,
        nodes: rows.map(r => ({ id: r.id, hostname: r.hostname ?? r.id, platform: (r as any).platform ?? "linux", connectedAt: (r as any).connectedAt ?? new Date().toISOString(), kali: r.kali, mode: r.mode, probed: true })),
      };
    } catch {}

    const desktopUrl = buildDesktopUrl();

    res.json({
      ok: true,
      hub: hubStatus,
      proot: { layout, health, ready: layout.ready && health.guestShell },
      fleet,
      desktop: { url: desktopUrl, running: hubStatus.desktop?.running ?? false },
      stats: scanStats,
      isConnected: hubStatus.present || fleet.kaliReady > 0 || (layout.ready && health.guestShell),
      readyAnywhere: hubStatus.present || fleet.kaliReady > 0 || (layout.ready && health.guestShell),
      at: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.get("/kali-live/history", (_req, res) => {
  try {
    const stats = readScanStats();
    res.json({ ok: true, ...stats, at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// Unified exec — broadcasts to all clients
router.post("/kali-live/exec", requireOps("kali-live") as any, async (req: Request, res: Response) => {
  const { command, timeoutMs, source } = (req.body ?? {}) as { command?: string; timeoutMs?: number; source?: string };
  if (typeof command !== "string" || !command.trim()) {
    res.status(400).json({ error: "command is required" });
    return;
  }

  const tmo = typeof timeoutMs === "number" ? Math.min(Math.max(timeoutMs, 1000), 300000) : 120000;
  const execId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Broadcast start immediately
  broadcastEvent("kali_exec_start", { id: execId, cmd: command.slice(0, 200), source: source ?? "kali-live:api", startedAt: Date.now(), running: true });
  createPushNotification({ kind: "info", title: `▶ كالي: ${command.slice(0, 30)}`, body: `بدأ التنفيذ من ${source ?? "API"}`, link: "/kali-env" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: unknown) => {
    if (res.writableEnded || res.destroyed) return;
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  send({ type: "start", id: execId, command, source: source ?? "kali-live:api" });

  try {
    // Use unified anywhere exec with streaming
    const result = await kaliAnywhereExecStream(command, tmo, (stream, chunk) => {
      send({ type: stream, text: chunk, id: execId });
      // Also broadcast chunk via ws for other tabs that aren't on this SSE
      try { broadcastEvent("kali_exec_chunk", { id: execId, chunk: chunk.slice(0, 2000), stream }); } catch {}
    });

    if (!result) {
      send({ type: "error", message: "مافيش طائرة كالي متاحة حاليًا — شغّل عقدة أو ثبّت rootfs", id: execId });
      broadcastEvent("kali_exec_done", { id: execId, cmd: command.slice(0, 200), exitCode: null, running: false, error: "no-plane" });
    } else {
      send({ type: "done", id: execId, exitCode: result.exitCode, durationMs: result.durationMs, plane: result.plane });
      broadcastEvent("kali_exec_done", { id: execId, cmd: command.slice(0, 200), plane: result.plane, exitCode: result.exitCode, durationMs: result.durationMs, running: false });
      createPushNotification({
        kind: result.exitCode === 0 ? "success" : "error",
        title: `${result.exitCode === 0 ? "✓" : "✗"} كالي: ${command.slice(0, 30)}`,
        body: `انتهى على ${result.plane} — exit ${result.exitCode} في ${result.durationMs}ms`,
        link: "/kali-env",
      });
    }
  } catch (e) {
    send({ type: "error", message: (e as Error).message, id: execId });
    broadcastEvent("kali_exec_done", { id: execId, cmd: command.slice(0, 200), exitCode: null, running: false, error: (e as Error).message });
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

// Files — via kaliAnywhere
router.get("/kali-live/files", async (req: Request, res: Response) => {
  const p = typeof req.query.path === "string" ? req.query.path : "/root";
  const safePath = p.replace(/[^a-zA-Z0-9_\-/.]/g, "").slice(0, 200) || "/root";
  const r = await kaliAnywhereExec(`ls -la "${safePath}" 2>&1`, 15000);
  if (!r) { res.status(503).json({ ok: false, error: "مافيش طائرة كالي متاحة" }); return; }
  res.json({ ok: true, path: safePath, output: r.stdout || r.stderr, plane: r.plane, at: new Date().toISOString() });
});

// Processes
router.get("/kali-live/processes", async (_req, res) => {
  const r = await kaliAnywhereExec("ps aux --sort=-%cpu 2>/dev/null | head -30", 15000);
  if (!r) { res.status(503).json({ ok: false, error: "مافيش طائرة كالي متاحة" }); return; }
  res.json({ ok: true, output: r.stdout || r.stderr, plane: r.plane, at: new Date().toISOString() });
});

// Network
router.get("/kali-live/network", async (_req, res) => {
  const r = await kaliAnywhereExec("ss -tulpn 2>/dev/null | head -20; echo '---NET---'; ip -br addr 2>/dev/null | head -10", 15000);
  if (!r) { res.status(503).json({ ok: false, error: "مافيش طائرة كالي متاحة" }); return; }
  res.json({ ok: true, output: r.stdout || r.stderr, plane: r.plane, at: new Date().toISOString() });
});

// Tools catalog with Arabic descriptions — free, comprehensive
const KALI_TOOLS_CATALOG: Record<string, { name: string; ar: string; desc: string; category: string; example: string }> = {
  nmap: { name: "nmap", ar: "ماسح المنافذ", desc: "أشهر ماسح منافذ وخدمات في العالم", category: "recon", example: "nmap -sV -sC scanme.nmap.org" },
  nuclei: { name: "nuclei", ar: "ماسح الثغرات", desc: "ماسح ثغرات سريع بـ 8000+ قالب", category: "web", example: "nuclei -u https://example.com" },
  sqlmap: { name: "sqlmap", ar: "حقن SQL", desc: "أداة حقن SQL أوتوماتيكية", category: "exploit", example: "sqlmap -u 'https://example.com?id=1' --dbs" },
  nikto: { name: "nikto", ar: "فحص ثغرات ويب", desc: "ماسح ثغرات ويب شامل", category: "web", example: "nikto -h https://example.com" },
  hydra: { name: "hydra", ar: "تخمين كلمات المرور", desc: "أداة Brute Force سريعة", category: "password", example: "hydra -l admin -P rockyou.txt ssh://192.168.1.1" },
  gobuster: { name: "gobuster", ar: "استكشاف المجلدات", desc: "أداة brute force للمجلدات والـ DNS", category: "web", example: "gobuster dir -u https://example.com -w /usr/share/wordlists/dirb/common.txt" },
  ffuf: { name: "ffuf", ar: "Fuzzing سريع", desc: "أداة fuzzing فائقة السرعة", category: "web", example: "ffuf -u https://example.com/FUZZ -w wordlist.txt" },
  subfinder: { name: "subfinder", ar: "استكشاف النطاقات الفرعية", desc: "اكتشاف النطاقات الفرعية بسرعة", category: "recon", example: "subfinder -d example.com" },
  amass: { name: "amass", ar: "استخبارات النطاقات", desc: "أداة OSINT للنطاقات والشبكات", category: "recon", example: "amass enum -d example.com" },
  httpx: { name: "httpx", ar: "فحص HTTP", desc: "فحص خوادم HTTP بسرعة", category: "recon", example: "httpx -l subdomains.txt" },
  katana: { name: "katana", ar: "زحف الويب", desc: "أداة زحف ويب من ProjectDiscovery", category: "web", example: "katana -u https://example.com" },
  hashcat: { name: "hashcat", ar: "كسر الهاشات", desc: "أسرع أداة كسر هاشات", category: "password", example: "hashcat -m 0 -a 0 hash.txt rockyou.txt" },
  john: { name: "john", ar: "جون السفاح", desc: "أداة كسر كلمات المرور", category: "password", example: "john --wordlist=rockyou.txt hash.txt" },
  metasploit: { name: "msfconsole", ar: "ميتاسبلويت", desc: "أشهر منصة استغلال ثغرات", category: "exploit", example: "msfconsole -q -x 'use exploit/multi/handler; run'" },
  burpsuite: { name: "burpsuite", ar: "بورب سويت", desc: "منصة اختبار تطبيقات الويب", category: "web", example: "burpsuite" },
  zaproxy: { name: "zaproxy", ar: "OWASP ZAP", desc: "ماسح أمان تطبيقات الويب", category: "web", example: "zap.sh -daemon -host 0.0.0.0 -port 8090" },
  tshark: { name: "tshark", ar: "تحليل الشبكة", desc: "محلل حزم الشبكة (Wireshark CLI)", category: "forensics", example: "tshark -i eth0 -c 100" },
  binwalk: { name: "binwalk", ar: "تحليل البرمجيات الثابتة", desc: "تحليل واستخراج البرمجيات الثابتة", category: "forensics", example: "binwalk firmware.bin" },
  exiftool: { name: "exiftool", ar: "البيانات الوصفية", desc: "قراءة وكتابة البيانات الوصفية", category: "forensics", example: "exiftool image.jpg" },
  aircrack: { name: "aircrack-ng", ar: "اختراق WiFi", desc: "مجموعة أدوات اختبار WiFi", category: "wireless", example: "aircrack-ng capture.cap -w rockyou.txt" },
  bettercap: { name: "bettercap", ar: "هجوم MITM", desc: "أداة MITM وهجمات الشبكة", category: "mitm", example: "bettercap -iface eth0" },
  responder: { name: "responder", ar: "استجابة LLMNR", desc: "أداة انتحال LLMNR/NBT-NS", category: "mitm", example: "responder -I eth0" },
  theHarvester: { name: "theHarvester", ar: "حصاد المعلومات", desc: "جمع معلومات OSINT", category: "recon", example: "theHarvester -d example.com -b all" },
  whatweb: { name: "whatweb", ar: "بصمة الويب", desc: "تحديد تقنيات مواقع الويب", category: "recon", example: "whatweb https://example.com" },
  wpscan: { name: "wpscan", ar: "فحص ووردبريس", desc: "ماسح ثغرات ووردبريس", category: "web", example: "wpscan --url https://example.com --enumerate u" },
  dirb: { name: "dirb", ar: "استكشاف المجلدات", desc: "ماسح محتوى الويب", category: "web", example: "dirb https://example.com" },
  dnsx: { name: "dnsx", ar: "استعلام DNS", desc: "أداة استعلام DNS سريعة", category: "recon", example: "dnsx -d example.com -a -resp" },
  naabu: { name: "naabu", ar: "ماسح المنافذ السريع", desc: "ماسح منافذ من ProjectDiscovery", category: "recon", example: "naabu -host example.com" },
};

router.get("/kali-live/tools-catalog", (_req, res) => {
  res.json({ ok: true, tools: KALI_TOOLS_CATALOG, count: Object.keys(KALI_TOOLS_CATALOG).length, at: new Date().toISOString() });
});

export default router;
