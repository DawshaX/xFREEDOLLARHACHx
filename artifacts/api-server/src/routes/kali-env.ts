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
import { readProbeCache, probeAllKaliNodes, orderPrewarmedFirst } from "../lib/ops/kali-node-probe";
import { PROOT_GUEST_EXEC } from "../lib/ops/kali-node-installer";
import { execStreamOnLocalAgent, execOnLocalAgent } from "./local-agent";
import { kaliSysInfo } from "../lib/ops/kali-sysinfo";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  readWorkspaceFile,
  runInWorkspace,
  workspaceSelfTest,
  workspaceShellCommand,
} from "../lib/ops/kali-workspace";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(requireOps("kali-env"));

/**
 * TEST38 — the eleven official Kali categories, in Kali's own order.
 *
 * The page used to show eight ad-hoc buckets (`recon`, `web`, `mitm`, `utils`…)
 * that did not match the menu a Kali user knows. These are the real ones, and
 * every tool the operator named is present in the group it belongs to.
 *
 * Additive only: the old keys are kept as aliases at the bottom so anything
 * that already reads `groups.recon` keeps working.
 */
const TOOL_GROUPS: Record<string, string[]> = {
  "information-gathering": [
    "nmap", "masscan", "subfinder", "amass", "dnsx", "naabu", "httpx", "whatweb",
    "theHarvester", "whois", "dig", "dnsenum", "fierce", "recon-ng", "maltego", "sublist3r", "sherlock"
  ],
  "vulnerability-analysis": [
    "nuclei", "nikto", "openvas", "lynis", "searchsploit", "nmap", "vulners",
  ],
  "web-applications": [
    "gobuster", "ffuf", "feroxbuster", "dirb", "dirsearch", "wfuzz", "sqlmap",
    "wpscan", "katana", "burpsuite", "zaproxy", "commix", "xsser", "arjun",
  ],
  "password-attacks": [
    "hydra", "john", "hashcat", "medusa", "crunch", "wordlists", "seclists",
    "patator", "ncrack", "cewl",
  ],
  wireless: [
    "aircrack-ng", "airmon-ng", "airodump-ng", "aireplay-ng", "airbase-ng",
    "reaver", "kismet", "wifite", "bully", "pixiewps", "hcxdumptool", "hcxtools",
  ],
  exploitation: [
    "msfconsole", "msfvenom", "msfdb", "metasploit", "armitage", "beef-xss",
    "setoolkit", "routersploit", "crackmapexec", "impacket-smbserver",
  ],
  "sniffing-spoofing": [
    "bettercap", "ettercap", "mitmproxy", "responder", "dsniff", "arpspoof",
    "macchanger", "yersinia", "wireshark", "tcpdump", "arp-scan"
  ],
  "post-exploitation": [
    "mimikatz", "empire", "powersploit", "bloodhound", "chisel", "ligolo-ng",
    "socat", "netcat", "ncat", "proxychains4", "netexec"
  ],
  forensics: [
    /* TEST47 — steghide وvolatility3 مضافين: كانوا مستحيلي التثبيت من الواجهة
     * (مش في الكتالوج أصلًا). مقاسين وتثبيتهم متاح الآن. */
    "steghide", "volatility3",
    "wireshark", "tshark", "tcpdump", "binwalk", "foremost", "exiftool",
    "volatility", "autopsy", "sleuthkit", "guymager", "dcfldd", "scalpel",
  ],
  "reverse-engineering": [
    "radare2", "r2", "ghidra", "gdb", "objdump", "readelf", "strings", "ltrace",
    "strace", "apktool", "jadx", "dex2jar", "nasm",
  ],
  reporting: [
    "cutycapt", "wkhtmltopdf", "pandoc", "faraday", "dradis", "cherrytree",
    "recordmydesktop", "libreoffice",
  ],
  /* ── aliases kept for existing consumers (additive, never removed) ── */
  recon: ["nmap", "masscan", "subfinder", "amass", "dnsx", "naabu", "httpx", "whatweb", "theHarvester"],
  web: ["gobuster", "ffuf", "feroxbuster", "dirb", "nikto", "nuclei", "katana", "sqlmap", "wpscan"],
  exploit: ["msfconsole", "msfvenom", "searchsploit", "metasploit"],
  password: ["hydra", "john", "hashcat", "medusa", "crunch"],
  mitm: ["bettercap", "ettercap", "mitmproxy", "responder"],
  utils: ["curl", "wget", "git", "python3", "node", "jq", "netcat", "socat", "openssl"],
};

/** The eleven real categories, in display order — aliases excluded. */
export const KALI_CATEGORIES = [
  "information-gathering", "vulnerability-analysis", "web-applications",
  "password-attacks", "wireless", "exploitation", "sniffing-spoofing",
  "post-exploitation", "forensics", "reverse-engineering", "reporting",
] as const;

/**
 * One-click run recipes. Each tool gets the argument shape it actually takes,
 * so the page can offer a target box instead of making the operator memorise
 * flags. `{target}` is substituted; the value is quoted by `shellQuote` before
 * it reaches the guest, so a target can never become a second command.
 */
export const TOOL_RECIPES: Record<string, { args: string; targetLabel: string; hint: string }> = {
  nmap: { args: "-sV -T4 {target}", targetLabel: "host / CIDR", hint: "فحص منافذ وخدمات" },
  masscan: { args: "{target} -p1-1000 --rate=1000", targetLabel: "host / CIDR", hint: "فحص سريع جدًا" },
  subfinder: { args: "-d {target}", targetLabel: "domain", hint: "تعداد النطاقات الفرعية" },
  httpx: { args: "-u {target} -status-code -title", targetLabel: "URL", hint: "فحص HTTP حي" },
  naabu: { args: "-host {target} -top-ports 100", targetLabel: "host", hint: "فحص منافذ سريع" },
  dnsx: { args: "-d {target} -a -resp", targetLabel: "domain", hint: "استعلامات DNS" },
  whatweb: { args: "{target}", targetLabel: "URL", hint: "بصمة التقنيات" },
  nuclei: { args: "-u {target} -severity critical,high", targetLabel: "URL", hint: "قوالب ثغرات" },
  nikto: { args: "-h {target}", targetLabel: "URL", hint: "فحص ويب كلاسيكي" },
  gobuster: { args: "dir -u {target} -w /usr/share/wordlists/dirb/common.txt", targetLabel: "URL", hint: "تعداد مسارات" },
  ffuf: { args: "-u {target}/FUZZ -w /usr/share/wordlists/dirb/common.txt -mc 200,301,302", targetLabel: "URL", hint: "فَزِّر مسارات" },
  feroxbuster: { args: "-u {target} -w /usr/share/wordlists/dirb/common.txt", targetLabel: "URL", hint: "تعداد متكرر" },
  sqlmap: { args: "-u {target} --batch --level=1 --risk=1", targetLabel: "URL", hint: "فحص حقن SQL" },
  wpscan: { args: "--url {target} --enumerate vp", targetLabel: "URL", hint: "فحص ووردبريس" },
  katana: { args: "-u {target} -d 2", targetLabel: "URL", hint: "زحف روابط" },
  hydra: { args: "-L /usr/share/wordlists/users.txt -P /usr/share/wordlists/passwords.txt {target} ssh", targetLabel: "host", hint: "تخمين اعتماد SSH" },
  john: { args: "--wordlist=/usr/share/wordlists/rockyou.txt {target}", targetLabel: "ملف هاش", hint: "كسر هاش" },
  hashcat: { args: "-m 0 -a 0 {target} /usr/share/wordlists/rockyou.txt", targetLabel: "ملف هاش", hint: "كسر هاش" },
  "aircrack-ng": { args: "{target}", targetLabel: "ملف .cap", hint: "كسر WPA" },
  "airodump-ng": { args: "{target}", targetLabel: "interface", hint: "التقاط شبكات" },
  msfconsole: { args: "-q -x 'search {target}; exit'", targetLabel: "كلمة بحث", hint: "بحث في Metasploit" },
  searchsploit: { args: "{target}", targetLabel: "اسم برنامج/إصدار", hint: "بحث في Exploit-DB" },
  tshark: { args: "-i {target} -c 20", targetLabel: "interface", hint: "التقاط حزم" },
  tcpdump: { args: "-i {target} -c 20 -nn", targetLabel: "interface", hint: "التقاط حزم" },
  binwalk: { args: "{target}", targetLabel: "ملف", hint: "تحليل فيرموير" },
  exiftool: { args: "{target}", targetLabel: "ملف", hint: "ميتاداتا" },
  radare2: { args: "-q -c 'iI; q' {target}", targetLabel: "ملف تنفيذي", hint: "تحليل ثنائي" },
  strings: { args: "{target} | head -40", targetLabel: "ملف", hint: "نصوص داخل ثنائي" },
  whois: { args: "{target}", targetLabel: "domain / IP", hint: "بيانات التسجيل" },
  dig: { args: "{target} ANY +short", targetLabel: "domain", hint: "استعلام DNS" },
};

/** POSIX single-quote escaping — the only quoting that survives every shell. */
export function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}


/* TEST41 — المخزن الموسّع للتثبيت (APT names) — مكمّل لتصنيفات الجولة 15: الفئات الرسمية الـ14 بأسماء حزم كالي نفسها
 * (apt أسماء صحيحة — التثبيت عند الطلب بيتنفذ جوه الجست بأمر apt). القائمة
 * أوسع من الكتالوج القصير اللي فوق — والقياس بيفصل الموجود عن الناقص بالحرف. */
const APT_CATALOG: Record<string, string[]> = {
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

/** TEST57 — هوية الجست المقاسة: uid لازم يبقى 0 عشان apt/dpkg يشتغلوا. */
router.get("/kali-env/identity", async (_req, res) => {
  const cmd = "echo UID:$(id -u); id; . /etc/os-release 2>/dev/null; echo PRETTY:${PRETTY_NAME:-unknown}; command -v apt-get >/dev/null && echo APT:yes || echo APT:no; command -v dpkg >/dev/null && echo DPKG:yes || echo DPKG:no";
  const r = await kaliAnywhereExec(cmd, 25_000);
  if (!r) {
    res.status(503).json({ ok: false, root: false, error: "مافيش طايرة كالي متصلة دلوقتي" });
    return;
  }
  const uid = Number((r.stdout.match(/^UID:(\d+)$/m) ?? [])[1]);
  const pretty = (r.stdout.match(/^PRETTY:(.*)$/m) ?? [])[1] ?? null;
  res.json({
    ok: true,
    uid: Number.isFinite(uid) ? uid : null,
    root: uid === 0,
    prettyName: pretty,
    apt: /APT:yes/.test(r.stdout),
    dpkg: /DPKG:yes/.test(r.stdout),
    plane: r.plane,
    raw: r.stdout.slice(0, 600),
  });
});

router.get("/kali-env/tools", async (_req, res) => {
  const layout = detectProotLayout();
  if (!layout.ready) {
    // TEST37 — مافيش rootfs على الهَب؟ قيس الأدوات من عقدة كالي حية (نفس
    // أمر command -v، نفس التجميع) — القياس حقيقي من الطايرة السحابية بدل
    // «صفر أدوات» اللي بيظهر معاه إن كالي مش موجودة وهي موجودة على الأسطول.
    // TEST41 — الاتحاد مع المخزن الكامل: القياس بيغطي الفئات الرسمية الـ14.
    const all = [...new Set([...Object.values(TOOL_GROUPS).flat(), ...Object.values(APT_CATALOG).flat()])];
    /* نفس منطق measureCatalog: بنسأل عن **الأمر الحقيقي** لكل أداة عبر
     * TOOL_BIN_ALIASES. اتقاس 2026-11-17: metasploit موجود كـmsfconsole،
     * volatility3 كـvol — والـprobe القديم كان بيسأل بالاسم في الكتالوج فيقول
     * «ناقص» لأدوات شغالة. */
    const probe = all
      .map((t) => {
        const anyOf = binCandidates(t)
          .map((bin) => (bin.startsWith("/") ? `[ -e '${bin}' ]` : `command -v ${bin} >/dev/null 2>&1`))
          .join(" || ");
        return `{ ${anyOf} ; } && echo "OK:${t}"`;
      })
      .join("; ");
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
      for (const [group, tools] of Object.entries(APT_CATALOG)) {
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
  /* نفس منطق measureCatalog: بنسأل عن **الأمر الحقيقي** لكل أداة عبر
   * TOOL_BIN_ALIASES. اتقاس 2026-11-17: metasploit موجود كـmsfconsole،
   * volatility3 كـvol — والـprobe القديم كان بيسأل بالاسم في الكتالوج فيقول
   * «ناقص» لأدوات شغالة. */
  const probe = all
    .map((t) => {
      const anyOf = binCandidates(t)
        .map((bin) => (bin.startsWith("/") ? `[ -e '${bin}' ]` : `command -v ${bin} >/dev/null 2>&1`))
        .join(" || ");
      return `{ ${anyOf} ; } && echo "OK:${t}"`;
    })
    .join("; ");
  const r = await runInProot({ command: probe, timeoutMs: 60_000 });

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

/**
 * TEST38 — real system telemetry (CPU/RAM/disk/procs/net/GPU/rootfs).
 *
 * The page could say "proot exists" but not "what is this box doing". Every
 * number here is read from /proc and statfs; anything unreadable comes back as
 * `null` plus a reason in `unmeasured`, never as a zero the page would render
 * as a real measurement.
 */
router.get("/kali-env/sysinfo", async (_req, res) => {
  try {
    res.json(await kaliSysInfo());
  } catch (e) {
    logger.error({ e }, "kali-env sysinfo failed");
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

/**
 * TEST38 — the full tool catalogue with per-tool version, measured in one pass.
 *
 * `/tools` answers "present or missing" per group. This answers the richer
 * question the page needs: for every tool in every one of the eleven
 * categories, is it installed, what version, and what is the one-click recipe.
 *
 * One `command -v` + one `--version` sweep inside the guest — not 200 round
 * trips. A tool that is present but whose version cannot be parsed reports
 * `version: null` with `versionReason`, rather than a fabricated string.
 */
/* TEST47 — كاش الكتالوج: الفحص الحي (166 أداة × إصدارات) بياخد دقايق على
 * عقدة مشغولة (لود 9.5) فكان المتصفح بيقطع بعد 10ث ويعرض «فشل جلب». القياس
 * بقى واحد مشترك: أول نداء يقيس، والباقي ياخد آخر قياس فورًا مع measuredAt
 * وcachedFrom — والقياس الخلفي بيتجدد كل 10 دقايق لو فيه طايرة حية. */
type CatalogPayload = Record<string, unknown>;
let catalogCache: { at: number; payload: CatalogPayload } | null = null;
let catalogInflight: Promise<CatalogPayload> | null = null;
const CATALOG_TTL_MS = 10 * 60_000;

/**
 * ★ خريطة الاسم في الكتالوج → الأمر الحقيقي على الدسك.
 *
 * المشكلة اللي دي بتحلها (مقاسة 2026-11-17): الكتالوج بيقول «volatility3 ناقص»
 * بينما `vol` شغال تمام في `/usr/local/bin/vol` — لأن `command -v volatility3`
 * مابيلاقيش حاجة. نفس الحكاية: `metasploit` (الأمر msfconsole) و`bloodhound`
 * (الأمر bloodhound-ce-python) و`dirsearch` (ساعات بيتسطب كـ`dirsearch`).
 *
 * النتيجة كانت إن الواجهة تقول «ناقص» لأدوات موجودة فعلًا — وده بالظبط نوع
 * «الادعاء الغلط» اللي المالك رفضه. الخريطة دي بتخلّي القياس يسأل عن الأمر
 * الصح. مافيش تخمين: كل مرادف مذكور صراحة، واللي مش في الخريطة بيتقاس باسمه.
 */
const TOOL_BIN_ALIASES: Record<string, string[]> = {
  volatility3: ["vol", "vol.py", "volatility3"],
  volatility: ["volatility", "vol.py"],
  metasploit: ["msfconsole", "msfvenom"],
  bloodhound: ["bloodhound-ce-python", "bloodhound-python", "bloodhound.py"],
  crackmapexec: ["crackmapexec", "cme"],
  netexec: ["nxc", "netexec"],
  wordlists: ["/usr/share/wordlists", "dirb"],
  seclists: ["/usr/share/seclists"],
  zaproxy: ["zaproxy", "zap.sh"],
  burpsuite: ["burpsuite", "burpsuite_pro"],
  "beef-xss": ["beef-xss", "beef"],
  routersploit: ["rsf.py", "routersploit"],
  empire: ["empire", "powershell-empire"],
  dex2jar: ["d2j-dex2jar.sh", "d2j-dex2jar", "dex2jar"],
  "arp-scan": ["arp-scan"],
  "openvas": ["gvm-cli", "openvas", "omp"],
  vulners: ["vulners", "nmap-vulners"],
  wpscan: ["wpscan"],
  "ida": ["ida64", "ida", "retdec"],
};

/** الأمر الحقيقي (الأول المتاح) لأداة — بلا تخمين. */
function binCandidates(name: string): string[] {
  const al = TOOL_BIN_ALIASES[name];
  return al && al.length ? al : [name];
}

async function measureCatalog(): Promise<CatalogPayload> {
  if (catalogInflight) return catalogInflight;
  catalogInflight = (async () => {
    const layout = detectProotLayout();
    return await new Promise<CatalogPayload>((resolve) => {
      void (async () => {
        try {
          const all = [...new Set(KALI_CATEGORIES.flatMap((c) => TOOL_GROUPS[c] ?? []))];
          const measure = async (run: (cmd: string) => Promise<{ stdout: string; exitCode: number | null }>, plane: string) => {
            /* بنسأل عن كل مرادف ونطبع اسم الكتالوج لما أي مرادف يتلاقى —
             * كده الأداة بتتحسب موجودة بأمرها الحقيقي مش باسمها في القائمة. */
            const presenceCmd = all
              .map((t) => {
                const probe = binCandidates(t)
                  .map((bin) => (bin.startsWith("/") ? `[ -e '${bin}' ]` : `command -v ${bin} >/dev/null 2>&1`))
                  .join(" || ");
                return `{ ${probe} ; } && echo "OK:${t}"`;
              })
              .join("; ");
            const pr = await run(presenceCmd);
            const found = new Set(
              pr.stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("OK:")).map((l) => l.slice(3)),
            );
            const RS = "\u001e";
            const versionCmd = [...found]
              .map((t) => `printf 'V:${t}='; (${t} --version 2>/dev/null || ${t} -V 2>/dev/null || ${t} -v 2>/dev/null || echo unknown); printf '${RS}'`)
              .join("; ");
            const vr = versionCmd ? await run(versionCmd) : { stdout: "", exitCode: 0 };
            const versions: Record<string, string> = {};
            for (const m of vr.stdout.split(RS)) {
              const mm = m.match(/^V:([^=]+)=(.*)$/s);
              if (!mm) continue;
              const first = mm[2].split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
              versions[mm[1]] = first.slice(0, 80);
            }
            const categories = KALI_CATEGORIES.map((cat) => {
              const tools = TOOL_GROUPS[cat] ?? [];
              return {
                id: cat,
                tools: tools.map((t) => ({
                  name: t,
                  present: found.has(t),
                  version: found.has(t) ? (versions[t] && versions[t] !== "unknown" ? versions[t] : null) : null,
                  recipe: TOOL_RECIPES[t] ?? null,
                })),
                present: tools.filter((t) => found.has(t)).length,
                total: tools.length,
              };
            });
            return {
              ok: true,
              ready: true,
              measuredOn: plane,
              measuredAt: new Date().toISOString(),
              categories,
              total: all.length,
              present: [...found].filter((t) => all.includes(t)).length,
            } as CatalogPayload;
          };
          if (layout.ready) {
            resolve(await measure(async (cmd) => {
              const out = await runInProot({ command: cmd, timeoutMs: 60_000 });
              return { stdout: out.stdout, exitCode: out.exitCode };
            }, "proot (rootfs على الهوست)"));
            return;
          }
          const fleet = await fleetKaliSummary();
          if (fleet.kaliReady > 0) {
            const nodePayload = await measure(async (cmd) => {
              const out = await kaliAnywhereExec(cmd, 60_000);
              return { stdout: out?.stdout ?? "", exitCode: out?.exitCode ?? null };
            }, "عقدة كالي من الأسطول");
            resolve({ ...nodePayload, fleet } as CatalogPayload);
            return;
          }
          resolve({
            ok: false,
            ready: false,
            reason: "proot/rootfs مش منصّب على الهوست، ومفيش عقدة كالي حية في الأسطول ردّت",
            searched: layout.searched,
            fleet,
            categories: KALI_CATEGORIES.map((c) => ({
              id: c,
              tools: (TOOL_GROUPS[c] ?? []).map((t) => ({ name: t, present: false, version: null, recipe: TOOL_RECIPES[t] ?? null })),
              present: 0,
              total: (TOOL_GROUPS[c] ?? []).length,
            })),
            total: KALI_CATEGORIES.reduce((n, c) => n + (TOOL_GROUPS[c] ?? []).length, 0),
            present: 0,
          } as CatalogPayload);
        } catch (e) {
          resolve({ ok: false, ready: false, reason: `فشل قياس الكتالوج: ${e instanceof Error ? e.message : String(e)}` });
        } finally {
          catalogInflight = null;
        }
      })();
    });
  })();
  return catalogInflight;
}

router.get("/kali-env/catalog", async (_req, res) => {
  const fresh = catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS;
  if (fresh && catalogCache) {
    res.json({ ...catalogCache.payload, cachedFrom: new Date(catalogCache.at).toISOString() });
    return;
  }
  // فيه كاش قديم؟ قدّمه فورًا وقيّس في الخلفية — المتصفح مش بيستنى أبدًا.
  if (catalogCache) {
    res.json({ ...catalogCache.payload, cachedFrom: new Date(catalogCache.at).toISOString(), refreshing: true });
    void measureCatalog().then((p) => { catalogCache = { at: Date.now(), payload: p }; }).catch(() => {});
    return;
  }
  try {
    const payload = await measureCatalog();
    catalogCache = { at: Date.now(), payload };
    res.json(payload);
  } catch (e) {
    res.status(503).json({ ok: false, ready: false, reason: e instanceof Error ? e.message : String(e) });
  }
});

/* الراوتر القديم اتشال بالحرف — منطق القياس نفسه اتنقل لmeasureCatalog أعلاه
 * (مافيش حذف سلوك: نفس الاختيارات proot→عقدة→بصمة صادقة). */
router.get("/kali-env/catalog-legacy-disabled", async (_req, res) => {
  const layout = detectProotLayout();
  const all = [...new Set(KALI_CATEGORIES.flatMap((c) => TOOL_GROUPS[c] ?? []))];

  const measure = async (run: (cmd: string) => Promise<{ stdout: string; exitCode: number | null }>, plane: string) => {
    // Presence sweep: one shell, one line per hit.
    const presenceCmd = all.map((t) => `command -v ${t} >/dev/null 2>&1 && echo "OK:${t}"`).join("; ");
    const pr = await run(presenceCmd);
    const found = new Set(
      pr.stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("OK:")).map((l) => l.slice(3)),
    );
    // Version sweep: only for tools that exist, so we never pay for 200 misses.
    //
    // Two measured bugs are fixed here:
    //  1. No `head` — a minimal rootfs may not have coreutils' head, and the
    //     probe then failed with "head: not found" instead of a version.
    //  2. Records are separated by \x1e (ASCII record separator) rather than
    //     newlines, so a tool that prints nothing cannot let the next `printf`
    //     land on the same line and be read as this tool's version.
    const RS = "\u001e";
    const versionCmd = [...found]
      .map((t) => `printf 'V:${t}='; (${t} --version 2>/dev/null || ${t} -V 2>/dev/null || ${t} -v 2>/dev/null || echo unknown); printf '${RS}'`)
      .join("; ");
    const vr = versionCmd ? await run(versionCmd) : { stdout: "", exitCode: 0 };
    const versions: Record<string, string> = {};
    for (const rec of vr.stdout.split(RS)) {
      const m = /^V:([^=]+)=([\s\S]*)$/.exec(rec.trim());
      if (!m) continue;
      // First non-empty line only — some tools print a banner then details.
      const first = m[2].split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
      versions[m[1]] = first.slice(0, 80);
    }
    const categories = KALI_CATEGORIES.map((cat) => {
      const tools = TOOL_GROUPS[cat] ?? [];
      return {
        id: cat,
        tools: tools.map((t) => {
          const present = found.has(t);
          const v = versions[t];
          return {
            name: t,
            present,
            version: present ? (v && v !== "unknown" ? v : null) : null,
            versionReason: present && (!v || v === "unknown") ? "الأداة موجودة بس مش بتطبع إصدارها بالشكل المعتاد" : undefined,
            recipe: TOOL_RECIPES[t] ?? null,
          };
        }),
        present: tools.filter((t) => found.has(t)).length,
        total: tools.length,
      };
    });
    return {
      ok: true,
      ready: true,
      measuredOn: plane,
      measuredAt: new Date().toISOString(),
      categories,
      total: all.length,
      present: [...found].filter((t) => all.includes(t)).length,
    };
  };

  try {
    if (layout.ready) {
      const r = await measure(
        async (cmd) => {
          const out = await runInProot({ command: cmd, timeoutMs: 60_000 });
          return { stdout: out.stdout, exitCode: out.exitCode };
        },
        "proot (rootfs على الهوست)",
      );
      res.json(r);
      return;
    }
    // No local rootfs — measure on a live fleet Kali node instead of returning
    // an empty catalogue the page would show as "0 tools".
    const fleet = await fleetKaliSummary();
    if (fleet.kaliReady > 0) {
      const r = await measure(
        async (cmd) => {
          const out = await kaliAnywhereExec(cmd, 60_000);
          return { stdout: out?.stdout ?? "", exitCode: out?.exitCode ?? null };
        },
        "عقدة كالي من الأسطول",
      );
      res.json({ ...r, fleet });
      return;
    }
    res.json({
      ok: false,
      ready: false,
      reason: "proot/rootfs مش منصّب على الهوست، ومفيش عقدة كالي حية في الأسطول ردّت",
      searched: layout.searched,
      fleet,
      categories: KALI_CATEGORIES.map((c) => ({
        id: c,
        tools: (TOOL_GROUPS[c] ?? []).map((t) => ({ name: t, present: false, version: null, recipe: TOOL_RECIPES[t] ?? null })),
        present: 0,
        total: (TOOL_GROUPS[c] ?? []).length,
      })),
      total: all.length,
      present: 0,
    });
  } catch (e) {
    logger.error({ e }, "kali-env catalog failed");
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

/**
 * TEST38 — one-click tool run.
 *
 * The page sends `{ tool, target }`; this builds the argv from the recipe and
 * quotes the target with `shellQuote`, so a target of `1.2.3.4; rm -rf /`
 * becomes a single literal argument instead of a second command. The tool name
 * is validated against the catalogue — an unknown name is refused, never
 * passed through.
 */
router.post("/kali-env/run", async (req: Request, res: Response) => {
  const { tool, target, timeoutMs } = (req.body ?? {}) as {
    tool?: string;
    target?: string;
    timeoutMs?: number;
  };
  const known = new Set(KALI_CATEGORIES.flatMap((c) => TOOL_GROUPS[c] ?? []));
  if (typeof tool !== "string" || !known.has(tool)) {
    res.status(400).json({ error: `أداة غير معروفة: ${String(tool).slice(0, 40)}` });
    return;
  }
  const recipe = TOOL_RECIPES[tool];
  if (!recipe) {
    res.status(400).json({ error: `مفيش وصفة تشغيل لـ ${tool} — استخدم /kali-env/exec` });
    return;
  }
  const tgt = typeof target === "string" ? target.trim() : "";
  if (!tgt) {
    res.status(400).json({ error: "target مطلوب" });
    return;
  }
  // Reject anything that is not a plausible host/URL/path token. This is a
  // second layer behind shellQuote — belt and braces, not the only defence.
  if (tgt.length > 300 || /[\n\r\0]/.test(tgt)) {
    res.status(400).json({ error: "target فيه محارف مرفوضة" });
    return;
  }
  const command = `${tool} ${recipe.args.replace("{target}", shellQuote(tgt))}`;

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
  const tmo = typeof timeoutMs === "number" ? Math.min(Math.max(timeoutMs, 1000), 600_000) : 180_000;
  send({ type: "start", command, tool, target: tgt, hint: recipe.hint });

  try {
    const layout = detectProotLayout();
    if (layout.ready) {
      const result = await runInProot({
        command,
        timeoutMs: tmo,
        onData: (stream, chunk) => send({ type: stream, text: chunk }),
      });
      send({ type: "done", plane: "proot", exitCode: result.exitCode, durationMs: result.durationMs, error: result.error });
    } else {
      const result = await kaliAnywhereExec(command, tmo);
      if (!result) {
        send({ type: "error", message: "مفيش طائرة تنفيذ: لا rootfs محلي ولا عقدة كالي حية" });
      } else {
        if (result.stdout) send({ type: "stdout", text: result.stdout });
        if (result.stderr) send({ type: "stderr", text: result.stderr });
        send({ type: "done", plane: result.plane, exitCode: result.exitCode, durationMs: result.durationMs });
      }
    }
  } catch (e) {
    logger.error({ e }, "kali-env run failed");
    send({ type: "error", message: (e as Error).message });
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

/* TEST42 — بث سطح المكتب الحي من عقدة كالي (MJPEG عبر قناة الexec-stream):
 * العقدة بتشغّل Xvfb + fluxbox + ffmpeg x11grab جوه الجست وبتطلّع إطارات JPEG
 * على stdout مرمّزة base64 (نفس قناة exec-stream النصية — الصورة بتعدي سليمة)،
 * والهَب بيفكّها ويبثها multipart/x-mixed-replace → <img> عادي في الصفحة.
 * NOVA_DESKTOP_TEST=1 → إطار اختبار ثابت لقياس الجسر بلا عقدة (صادق ومعلن). */
const DESKTOP_FRAME_TEST = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscHRJDNS8OHxY3OTM0jCRCUhKj/9oADAMBAAIRAxEAPwD0/wCIj3nY5JIy5cWPSqUtwTV5LJPkoumlF3cn//Z",
  "base64",
);

function desktopStreamScript(kcmd: string, mode: string): string {
  const argv =
    mode === "MODE_PROOT"
      ? ["/bin/sh", "-c", PROOT_GUEST_EXEC, "nova-desktop", kcmd]
      : ["/bin/sh", "-c", kcmd];
  return (
    "const {spawn}=require('child_process');" +
    "const c=spawn(" + JSON.stringify(argv[0]) + "," + JSON.stringify(argv.slice(1)) + ",{stdio:['ignore','pipe','pipe'],cwd:'/'});" +
    "c.stdout.on('data',d=>{try{process.stdout.write(d.toString('base64'))}catch(e){}});" +
    "c.stderr.on('data',()=>{});" +
    "c.on('error',()=>process.exit(127));" +
    "const t=setTimeout(()=>c.kill('SIGKILL'),840000);" +
    "c.on('close',(x)=>{clearTimeout(t);process.exit(x===null?1:x);});"
  );
}

router.get("/kali-env/node-desktop", async (req: Request, res: Response) => {
  const BOUNDARY = "novadesk";
  const sendFrame = (buf: Buffer) => {
    if (res.writableEnded || res.destroyed) return false;
    res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
    res.write(buf);
    res.write("\r\n");
    return true;
  };

  /* وضع قياس الجسر (NOVA_DESKTOP_TEST=1): إطار ثابت مكرر — بيثبت إن التأطير
   * والبث من الهَب للمتصفح شغالين، ومكتوب صراحة إنه وضع اختبار. */
  if (process.env.NOVA_DESKTOP_TEST === "1") {
    res.setHeader("Content-Type", `multipart/x-mixed-replace; boundary=${BOUNDARY}`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Nova-Desktop-Test", "1");
    res.flushHeaders?.();
    const iv = setInterval(() => sendFrame(DESKTOP_FRAME_TEST), 800);
    /* قِيس 04:35Z: req 'close' في Node الحديث بيقع فورًا للGET بلا body
     * فبيوقف البث قبل أول إطار — res 'close' هو اللي بيحصل لما الاتصال يموت. */
    res.on("close", () => clearInterval(iv));
    return;
  }

  const cached = readProbeCache();
  let rows = cached.rows;
  if (!cached.fresh) {
    try {
      rows = await Promise.race([
        probeAllKaliNodes(),
        new Promise<Awaited<ReturnType<typeof probeAllKaliNodes>>>((resolve) => setTimeout(() => resolve(rows), 8_000)),
      ]);
    } catch { /* الكاش القديم */ }
  }
  const node = orderPrewarmedFirst(rows).find((r) => r.kali);
  if (!node) {
    res.status(503).json({ ok: false, reason: "مافيش عقدة كالي جاهزة للبث — شغّل موجة واستنى prewarm (~7د)" });
    return;
  }

  const kcmd =
    'export DEBIAN_FRONTEND=noninteractive;' +
    /* TEST53 — نفس فكس الجذر: ال13 مجلد قبل أي apt-get جوه الجست (نفس قائمة المثبّت). */
    'for d in var/log/apt var/lib/dpkg/updates var/lib/dpkg/triggers/File var/lib/dpkg/triggers/Unincorporated var/lib/dpkg/alternatives var/cache/apt/archives/partial var/lib/apt/lists/partial var/lib/ucf/cache run/lock tmp var/tmp var/lib/sudo var/spool/mail; do mkdir -p "/$d" 2>/dev/null; done;' +
    'command -v Xvfb >/dev/null 2>&1 || { apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq xvfb ffmpeg fluxbox xterm >/dev/null 2>&1; };' +
    'pkill -f "Xvfb :99" 2>/dev/null; pkill -f "x11grab" 2>/dev/null; sleep 0.4;' +
    'Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 & sleep 1.5;' +
    'DISPLAY=:99 fluxbox >/dev/null 2>&1 & DISPLAY=:99 xterm -maximized >/dev/null 2>&1 & sleep 0.8;' +
    'ffmpeg -loglevel error -f x11grab -video_size 1280x800 -framerate 6 -i :99 -f mjpeg -q:v 8 -';
  res.setHeader("Content-Type", `multipart/x-mixed-replace; boundary=${BOUNDARY}`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Nova-Desktop-Node", node.id);
  res.flushHeaders?.();

  let jpeg = Buffer.alloc(0);
  let sent = 0;
  const onData = (streamType: string, data: string) => {
    if (streamType !== "stdout" || res.writableEnded || res.destroyed) return;
    jpeg = Buffer.concat([jpeg, Buffer.from(data.replace(/\s+/g, ""), "base64")]);
    // استخراج الإطارات الكاملة: من علامة بداية JPEG (FFD8) لعلامة النهاية (FFD9)
    for (;;) {
      const start = jpeg.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) { jpeg = Buffer.alloc(0); break; }
      const end = jpeg.indexOf(Buffer.from([0xff, 0xd9]), start);
      if (end < 0) { if (start > 0) jpeg = jpeg.subarray(start); break; }
      const frame = jpeg.subarray(start, end + 2);
      if (sendFrame(frame)) sent++;
      jpeg = jpeg.subarray(end + 2);
    }
  };
  void execStreamOnLocalAgent(desktopStreamScript(kcmd, node.mode), node.id, 840_000, onData);
  res.on("close", () => {
    // إيقاف ffmpeg وXvfb على العقدة لما المتصفح يقفل البث (نضّف — مافيش عمليات يتيمة)
    void execOnLocalAgent(
      'pkill -f "x11grab" 2>/dev/null; pkill -f "Xvfb :99" 2>/dev/null; true',
      node.id, 10_000,
    );
  });
});

/* TEST41 — تثبيت عند الطلب: اسم حزمة كالي بس (حرفًا — مافيش shell meta)،
 * apt جوه الجست على الطايرة الفايزة. البوابة نفسها (requireOps) فوق الراوتر. */
const PKG_RE = /^[a-z0-9][a-z0-9.+_-]{0,48}$/;
router.post("/kali-env/install", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { tool?: string };
  const tool = String(body.tool ?? "").trim();
  if (!PKG_RE.test(tool)) { res.status(400).json({ ok: false, error: "اسم حزمة غير صالح — حروف وأرقام و .-_+ بس، من غير مسافة" }); return; }
  const inCatalog = Object.values(APT_CATALOG).flat().includes(tool) || Object.values(TOOL_GROUPS).flat().includes(tool);
  /* TEST47 — اسم الأمر ≠ اسم الحزمة أحيانًا: exiftool أمر والحزمة
   * libimage-exiftool-perl. التثبيت بيستخدم الحزمة الصح والتحقق بيستخدم الأمر. */
  const APT_ALIAS: Record<string, string> = { exiftool: "libimage-exiftool-perl" };
  const pkg = APT_ALIAS[tool] ?? tool;
  /* TEST53 — فكس الجذر (مقاس 2026-11-17): جيت مايخزنش المجلدات الفاضية فالجست
   * بيولّد من غيرها — apt/dpkg بيحتاجوها كلها وبيفشلوا واحد-واحد
   * («E: Directory '/var/log/apt/' missing» · «archives/partial is missing» ·
   * «dpkg returned an error code (2)»). نفس قائمة المثبّت بالحرف — ال13 مجلد. */
  const GUEST_DIRS = "var/log/apt var/lib/dpkg/updates var/lib/dpkg/triggers/File var/lib/dpkg/triggers/Unincorporated var/lib/dpkg/alternatives var/cache/apt/archives/partial var/lib/apt/lists/partial var/lib/ucf/cache run/lock tmp var/tmp var/lib/sudo var/spool/mail";
  const cmd = `echo ROOT_UID:$(id -u); for d in ${GUEST_DIRS}; do mkdir -p "/$d" 2>/dev/null; done; DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 | tail -2; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${pkg} 2>&1 | tail -12; if dpkg -s ${pkg} 2>/dev/null | grep -q '^Status: install ok installed' || command -v ${tool} >/dev/null 2>&1; then echo INSTALL_OK:${tool}; else echo INSTALL_FAIL:${tool}; fi`;
  const r = await kaliAnywhereExec(cmd, 420_000);
  if (!r) { res.status(503).json({ ok: false, error: "مافيش طايرة كالي متاحة للتثبيت" }); return; }
  const ok = /INSTALL_OK:/.test(r.stdout);
  const uid = Number((r.stdout.match(/^ROOT_UID:(\d+)$/m) ?? [])[1]);
  const tail = [r.stdout, r.stderr].filter(Boolean).join("\n").split("\n").slice(-12).join("\n");
  res.json({
    ok,
    tool,
    pkg,
    inCatalog,
    root: uid === 0,
    uid: Number.isFinite(uid) ? uid : null,
    plane: r.plane,
    exitCode: r.exitCode,
    output: tail,
    error: ok ? undefined : (uid === 0 ? "التثبيت فشل جوه الجست — الناتج تحت" : "الجست مش root (uid≠0) — dpkg هيرفض. الهَب لازم يكون بنسخة TEST57"),
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
  send({ type: "start", command, cwd: cwd ?? "/opt" /* /root مملوك root:root 700 — مافيش كتابة هناك (اتقاس 2026-11-17) */ });

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

/* ══════════════════════════════════════════════════════════════════════════
 * مكان الشغل في كالي — Workspaces
 * ──────────────────────────────────────────────────────────────────────────
 * «اعملي مكان للشغل في كالي» — اللي فات كان /exec أمر واحد بلا حالة،
 * و/sessions بيرجّع فاضي بصراحة. دي المساحات الحقيقية: مجلد جوه كالي،
 * ملفات بتفضل، أوامر بتتنفذ في سياق المساحة، وسجل شغل محفوظ على الدسك.
 * ══════════════════════════════════════════════════════════════════════════ */

router.get("/kali-env/workspaces", (_req: Request, res: Response) => {
  try {
    const rows = listWorkspaces();
    res.json({
      ok: true,
      root: "/opt/nova-workspaces",
      workspaces: rows,
      total: rows.length,
      // الحقيقة: لو rootfs مش موجود، الليستة فاضية *لأن* مافيش بيئة — بنقول كده
      ready: (() => {
        try {
          return detectProotLayout().ready;
        } catch {
          return false;
        }
      })(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message, workspaces: [] });
  }
});

router.post("/kali-env/workspaces", async (req: Request, res: Response) => {
  const { name, template } = (req.body ?? {}) as { name?: string; template?: string };
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ ok: false, error: "اسم المساحة مطلوب" });
    return;
  }
  try {
    const ws = await createWorkspace(name, { template });
    res.json({ ok: true, workspace: ws });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

router.get("/kali-env/workspaces/:slug", (req: Request, res: Response) => {
  try {
    res.json({ ok: true, workspace: getWorkspace(String(req.params.slug)) });
  } catch (e) {
    res.status(404).json({ ok: false, error: (e as Error).message });
  }
});

router.delete("/kali-env/workspaces/:slug", (req: Request, res: Response) => {
  try {
    res.json({ ok: true, ...deleteWorkspace(String(req.params.slug)) });
  } catch (e) {
    res.status(404).json({ ok: false, error: (e as Error).message });
  }
});

/** تنفيذ جوه المساحة — ده الفرق عن /exec: cwd = مجلد المساحة، والمخرجات بتفضل. */
router.post("/kali-env/workspaces/:slug/run", async (req: Request, res: Response) => {
  const { command, timeoutMs } = (req.body ?? {}) as { command?: string; timeoutMs?: number };
  if (typeof command !== "string" || !command.trim()) {
    res.status(400).json({ ok: false, error: "الأمر مطلوب" });
    return;
  }
  try {
    const r = await runInWorkspace(String(req.params.slug), command, { timeoutMs });
    res.json({ ...r, ok: r.ok });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

/** قراءة ملف من المساحة — عشان النتيجة تتعرض جوه البرنامج. */
router.get("/kali-env/workspaces/:slug/file", (req: Request, res: Response) => {
  try {
    const rel = String((req.query.path as string | undefined) ?? "");
    res.json({ ok: true, ...readWorkspaceFile(String(req.params.slug), rel) });
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message });
  }
});

/** أوامر جاهزة للنسخ — تفتح نفس المساحة في طرفية على جهاز المستخدم. */
router.get("/kali-env/workspaces/:slug/shell", (req: Request, res: Response) => {
  const r = workspaceShellCommand(String(req.params.slug));
  res.status(r.ok ? 200 : 400).json(r);
});

/** فحص حقيقي: بيفتح شل جوه مساحة ويشوف لازم يطلع المسار الصح. */
router.get("/kali-env/workspaces-selftest", async (_req: Request, res: Response) => {
  const r = await workspaceSelfTest();
  res.status(r.ok ? 200 : 503).json(r);
});

router.get("/kali-env/sessions", (_req, res) => {
  // proot runs are one-shot; there is no persistent session to list. Answering
  // honestly beats inventing rows the page would then render as real.
  res.json({ sessions: [], note: "proot runs are one-shot; no persistent sessions" });
});

export default router;
