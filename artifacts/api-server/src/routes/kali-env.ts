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

/* TEST41 — مخزن كالي الكامل: الفئات الرسمية الـ14 بأسماء حزم كالي نفسها
 * (apt أسماء صحيحة — التثبيت عند الطلب بيتنفذ جوه الجست بأمر apt). القائمة
 * أوسع من الكتالوج القصير اللي فوق — والقياس بيفصل الموجود عن الناقص بالحرف. */
const KALI_CATALOG: Record<string, string[]> = {
  "01-جمع-المعلومات": [
    "nmap", "masscan", "arp-scan", "netdiscover", "dnsrecon", "dnsenum", "fierce",
    "subfinder", "amass", " sublist3r".trim(), "whatweb", "wafw00f", "theharvester",
    "whois", "dig", "dnstracer", "dnsmap", "dnswalk", "dmitry", "maltego", "recon-ng",
    "spiderfoot", "sherlock", "maigret", "httpx", "asnmap", "naabu", "shuffledns",
    "censys", "shodan", "isr-evilgrade".replace("isr-", ""),
  ],
  "02-تحليل-الثغرات": [
    "nikto", "nuclei", "wapiti", "legs", "nmap", " Lynis".trim().toLowerCase(), "unix-privesc-check",
    "checksec", "gvm", "openvas", "pentestly", "pip-audit", "trivy", "grype",
  ],
  "03-تحليل-تطبيقات-الويب": [
    "burpsuite", "gobuster", "ffuf", "feroxbuster", "dirb", "dirsearch", "wfuzz",
    "sqlmap", "wpscan", "joomscan", "droopescan", "nikto", "katana", "hakrawler",
    "paramspider", "arjun", "x8", "commix", "xsstrike", "dalfox", "wafw00f",
    "whatweb", "skipfish", "w3af", "padbuster", "ssrfmap",
  ],
  "04-تقييم-قواعد-البيانات": [
    "sqlmap", "sqldict", "tnscmd10g", "oscanner", "sidguesser", "sqsh", "sqlitebrowser",
    "mongosh", "redis-tools".replace("-tools", ""), "pgcli", "mycli",
  ],
  "05-هجمات-كلمات-السر": [
    "hydra", "john", "hashcat", "hashid", "hash-identifier", "medusa", "ncrack",
    "patator", "cewl", "crunch", "hashcat-utils".replace("-utils", ""), "maskprocessor",
    "ophcrack", "rainbowcrack", "wordlists", "wfuzz", "brutespray", "chntpw",
  ],
  "06-هجمات-اللاسلكي": [
    "aircrack-ng", "airmon-ng", "airodump-ng", "aireplay-ng", "airbase-ng", "reaver",
    "bully", "wifite", "kismet", "hcxdumptool", "hcxtools", "hashcat", "fernet",
    "fern-wifi-cracker", "pixiewps", "wifipumpkin3", "eaphammer", "hostapd-wpe",
  ],
  "07-الهندسة-العكسية": [
    "gdb", "radare2", "rizin", "ghidra", "ida-never".replace("-never", "").replace("ida", "retdec"),
    "apktool", "jadx", "baksmali", "dex2jar", "upx", "strings", "ltrace", "strace",
    "volatility3".replace("3", ""), "volatility3", "binwalk", "foremost", "yara",
  ],
  "08-أدوات-الاستغلال": [
    "msfconsole", "msfvenom", "searchsploit", "beef-xss", "bettercap", "setoolkit",
    "crackmapexec", "netexec", "impacket-smbexec", "impacket-psexec", "impacket-wmiexec",
    "impacket-secretsdump", "responder", "evilginx2", "venom", "shellter", "elfutils",
  ],
  "09-التنصت-والانتحال": [
    "wireshark", "tshark", "tcpdump", "bettercap", "ettercap", "mitmproxy", "responder",
    "arpspoof", "dsniff", "macof", "webspy", "urlsnarf", "driftnet", "ferret-sidejacking".replace("-sidejacking", ""),
    "netsniff-ng", "p0f",
  ],
  "10-ما-بعد-الاستغلال": [
    "metasploit-framework", "empire", "powershell-empire".replace("powershell-", ""),
    "pspy", "linpeas", "winpeas", "mimikatz", "bloodhound", "netexec", "crackmapexec",
    "impacket-ntlmrelayx", "proxychains", "chisel", "ligolo-ng".replace("-ng", "-ng"),
    "weevely", "dvcs-ripper", "gpp-decrypt", "peass-ng",
  ],
  "11-الطب-الشرعي": [
    "autopsy", "sleuthkit", "binwalk", "foremost", "bulk_extractor", "capinfos",
    "chkrootkit", "dc3dd", "dcfldd", "exiftool", "galleta", "hashdeep", "p0f",
    "rkhunter", "volatility3", "testdisk", "photorec", "guymager",
  ],
  "12-الإبلاغ": [
    "pipal", "cutycapt", "faraday", "dradis", "cherrytree", "keepnote", "metagoofil",
    "casefile", "record-my-desktop".replace("-my-", "my"), "maltego", "pipal",
  ],
  "13-الهندسة-الاجتماعية": [
    "setoolkit", "beef-xss", "maltego", "king-phisher", "gophish", "Phishery".toLowerCase(),
    "phoneinfoga", "social-analyzer".replace("-analyzer", "analyzer"),
  ],
  "14-الخدمات": [
    "curl", "wget", "git", "python3", "python3-pip", "ruby", "openvpn", "proxychains",
    "ssh", "socat", "ncat", "openssl", "jq", "htop", "tmux", "screen", "docker.io".replace(".io", ""),
    "zsh", "vim", "nano", "torrent".replace("torrent", "aria2"),
  ],
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
    // TEST41 — الاتحاد مع المخزن الكامل: القياس بيغطي الفئات الرسمية الـ14.
    const all = [...new Set([...Object.values(TOOL_GROUPS).flat(), ...Object.values(KALI_CATALOG).flat()])];
    const probe = all.map((t) => `command -v ${t} >/dev/null 2>&1 && echo "OK:${t}"`).join("; ");
    const fleet = await fleetKaliSummary();
    const r = await kaliAnywhereExec(probe, 60_000);
    if (r && r.exitCode === 0) {
      const found = new Set(
        r.stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("OK:")).map((l) => l.slice(3)),
      );
      const groups: Record<string, { present: string[]; missing: string[] }> = {};
      for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
        groups[group] = { present: tools.filter((t) => found.has(t)), missing: tools.filter((t) => !found.has(t)) };
      }
      for (const [group, tools] of Object.entries(KALI_CATALOG)) {
        if (groups[group]) continue;
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

/* TEST41 — قياس حي للنظام جوه الجست: سطر واحد يرجّع الحقائق كلها (نواة ·
 * توزيعة · تشغيل · قرص · رام · عدد الحزم). بيشتغل على أي طايرة متاحة. */
const SYSINFO_CMD =
  "uname -sr; grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d'\"' -f2; uptime | sed 's/.*up/up/'; df -h / | tail -1 | awk '{print $3\" / \"$2\" (\"$5\")\"}'; free -m | awk 'NR==2{print $3\"MB / \"$2\"MB ram\"}'; dpkg -l 2>/dev/null | wc -l";

router.get("/kali-env/sysinfo", async (_req, res) => {
  const layout = detectProotLayout();
  let out: Awaited<ReturnType<typeof kaliAnywhereExec>> = null;
  if (layout.ready) out = await kaliAnywhereExec(SYSINFO_CMD, 20_000);
  else out = await kaliAnywhereExec(SYSINFO_CMD, 20_000);
  if (!out) {
    res.status(503).json({ ok: false, reason: "مافيش طايرة كالي متاحة حالًا (هَب بلا rootfs ومافيش عقدة جاهزة)" });
    return;
  }
  const lines = out.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  res.json({
    ok: true,
    measured: true,
    at: new Date().toISOString(),
    plane: out.plane,
    exitCode: out.exitCode,
    raw: lines.slice(0, 8),
  });
});

/* TEST41 — المخزن الثابت (بلا قياس — سريع): الفئات والأسماء للواجهة. */
router.get("/kali-env/catalog", (_req, res) => {
  res.json({ ok: true, groups: KALI_CATALOG, total: Object.values(KALI_CATALOG).flat().length });
});

/* TEST41 — تثبيت عند الطلب: اسم حزمة كالي بس (حرفًا — مافيش shell meta)،
 * apt جوه الجست على الطايرة الفايزة. البوابة نفسها (requireOps) فوق الراوتر. */
const PKG_RE = /^[a-z0-9][a-z0-9.+_-]{0,48}$/;
router.post("/kali-env/install", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { tool?: string };
  const tool = String(body.tool ?? "").trim();
  if (!PKG_RE.test(tool)) { res.status(400).json({ ok: false, error: "اسم حزمة غير صالح" }); return; }
  const inCatalog = Object.values(KALI_CATALOG).flat().includes(tool) || Object.values(TOOL_GROUPS).flat().includes(tool);
  if (!inCatalog) { res.status(400).json({ ok: false, error: "الحزمة مش في مخزن كالي المعروف — استخدم الطرفية للأدوات الخاصة" }); return; }
  const cmd = `DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 | tail -1; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${tool} 2>&1 | tail -5; command -v ${tool} >/dev/null 2>&1 && echo INSTALL_OK:${tool} || echo INSTALL_FAIL:${tool}`;
  const r = await kaliAnywhereExec(cmd, 420_000);
  if (!r) { res.status(503).json({ ok: false, error: "مافيش طايرة كالي متاحة للتثبيت" }); return; }
  const ok = /INSTALL_OK:/.test(r.stdout);
  res.json({
    ok,
    tool,
    plane: r.plane,
    exitCode: r.exitCode,
    output: r.stdout.split("\n").slice(-8).join("\n"),
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
