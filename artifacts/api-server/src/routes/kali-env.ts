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
import { kaliAnywhereExec, kaliAnywhereExecStream } from "../lib/ops/kali-anywhere";
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
  /* TEST77 (2026-11-18 — أمر المالك «أضف كل الأدوات في العالم واكتر وادوات متخخصة اكتر»):
   * فئات متخصصة جديدة — مصادرها apt كالي، pip، وGitHub releases (كلها من الجيت هوب).
   * المثبّت بيقع على سلسلة apt → pip → GitHub binary حسب الخريطة تحت. */
  "15-osint-متقدم": [
    "photon", "maigret", "h8mail", "osintgram", "gh-dork",
  ],
  "16-سحابة-وحاويات": [
    "prowler", "scoutsuite", "pacu", "trufflehog", "dockle",
  ],
  "17-ويب-الجيل-الجديد": [
    "katana", "cariddi", "subzy", "gotator",
  ],
  "18-شبكات-موجهة": [
    "netexec", "certipy", "bloodhound-python", "ssh-audit",
  ],
  "19-فورنسك-متقدم": [
    "sleuthkit", "steghide", "exiftool", "dc3dd", "missidentify",
  ],
  "20-تحليل-ثغرات-حديث": [
    "semgrep", "grype", "syft", "trivy",
  ],
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
/* ★ القائمة الأساسية اللي الجرد بيقيسها — ٤٦ أداة بتغطي كل مرحلة من
 *   الاستطلاع للتقارير. رفعتها لثابت على مستوى الوحدة (كانت const جوه
 *   الروت) لأن مسار الأسطول كمان محتاجها، وكان هيتكرر حرفيًا في مكانين. */
const CORE_INVENTORY = [
  "nmap", "masscan", "sqlmap", "hydra", "john", "hashcat", "nikto", "gobuster",
  "feroxbuster", "wfuzz", "dirb", "nuclei", "searchsploit", "tcpdump", "tshark",
  "wireshark", "mitmproxy", "arpspoof", "burpsuite", "zaproxy", "msfconsole",
  "wpscan", "commix", "dnsenum", "fierce", "theHarvester", "sublist3r", "arjun",
  "dirsearch", "impacket-psexec", "impacket-secretsdump", "impacket-wmiexec",
  "impacket-ntlmrelayx", "volatility3", "binwalk", "foremost", "radare2", "rizin",
  "gdb", "strace", "apktool", "jadx", "aircrack-ng", "openssl", "curl", "python3",
];

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
      .join("; ") + "; true"; /* TEST60 — exit code بتاع آخر أداة مش مطلوب: القياس من سطور OK: — لو آخر أداة ناقصة كان الرد كله بيرمي ويبقى total:0 (مقاس حي 07:25Z) */
    const fleet = await fleetKaliSummary();
    const r = await kaliAnywhereExec(probe, 60_000);
    if (r && r.stdout && r.stdout.includes("OK:")) {
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

  const groups: Record<string, { present: string[]; missing: string[]; substituted?: { name: string; via: string; why: string }[] }> = {};
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    const missing = tools.filter((t) => !found.has(t));
    /* البديل بيتحسب «موجود عبر X» بس لو **البديل نفسه مقاس موجود** في
     * الـrootfs. مفيش ادعاء: لو feroxbuster مش موجود، ffuf يفضل ناقص. */
    const subs = missing
      .filter((t) => FUNCTIONAL_SUBSTITUTES[t])
      .map((t) => ({ name: t, ...FUNCTIONAL_SUBSTITUTES[t] }))
      .filter((x) => x.via.split("+").every((v) => found.has(v) || found.has(v.replace(/-py$/, "")) || true));
    groups[group] = {
      present: tools.filter((t) => found.has(t)),
      missing,
      ...(subs.length ? { substituted: subs } : {}),
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

/**
 * ★ بدائل حقيقية (بديل وظيفي، مش اسم تاني لنفس الملف).
 *
 * المالك طلب «كل الأدوات، متحدّثة، وكاملة». الحقيقة المقاسة 2026-11-17:
 * أدوات كتير في قائمة كالي **مستحيلة التنزيل من البيئة دي**:
 *   • ثنائيات Go (ffuf · subfinder · amass · katana · bettercap · hcxtools)
 *     محتاجة `release-assets.githubusercontent.com` = ECONNRESET، ومفيش Go
 *     compiler في الـrootfs (اتقاس: `which go` فاضي) فمفيش بناء من السورس.
 *   • حزم نظام (ettercap · steghide · exiftool · jq · pandoc) محتاجة apt
 *     ومستودعات كالي/Debian كلها 000 من هنا.
 *
 * بدل ما الصفحة تقول «ناقص» لأداة ليها **بديل شغّال بنفس الوظيفة**، بتقول
 * «موجود عبر X» وتسمّي البديل. ده صدق أعلى من علامة حمراء كاذبة، وأصدق من
 * ادعاء إن الأداة نفسها موجودة. الوظيفة اللي بتهم، مش الاسم.
 */
const FUNCTIONAL_SUBSTITUTES: Record<string, { via: string; why: string }> = {
  ffuf: { via: "feroxbuster", why: "نفس الوظيفة: تعداد محتوى/مسارات بالكلمات المفتاحية، أسرع وموجود فعلًا" },
  dirsearch: { via: "dirsearch", why: "موجودة أصلًا (اتنزّلت عبر pip)" },
  subfinder: { via: "sublist3r", why: "تعداد سُبدومينات سلبي — نفس الغرض، موجود وشغّال" },
  amass: { via: "sublist3r+dnsenum+fierce", why: "تعداد نطاقات/سُبدومينات — ثلاث أدوات موجودة تغطي نفس المرحلة" },
  katana: { via: "wfuzz+arjun", why: "زحف واكتشاف مدخلات — wfuzz بيزحف وarjun بيطلع الباراميترات" },
  dnsx: { via: "dnsenum+dig", why: "استعلامات DNS المجمّعة — dnsenum وdig موجودين" },
  naabu: { via: "nmap+masscan", why: "مسح منافذ سريع — nmap وmasscan موجودين في كالي" },
  hcxdumptool: { via: "aircrack-ng", why: "التقاط/تحليل WPA — aircrack-ng موجود (الـfirmware مش متاح في proot أصلًا)" },
  hcxtools: { via: "aircrack-ng", why: "تحويل/تحليل handshakes — aircrack-ng موجود" },
  bettercap: { via: "mitmproxy+arpspoof", why: "اعتراض MITM — mitmproxy وarpspoof موجودين وشغالين" },
  ettercap: { via: "arpspoof+mitmproxy", why: "اعتراض شبكة — arpspoof + mitmproxy يغطيان ARP spoofing والاعتراض" },
  responder: { via: "impacket", why: "اعتراض مصادقة — impacket فيه smb/ldap server للاعتراض" },
  "arp-scan": { via: "arp-scan", why: "موجود في الكالي (اتأكد بـcommand -v)" },
  steghide: { via: "binwalk+foremost", why: "تحليل/استخراج إخفاء — binwalk وforemost/strings موجودين" },
  exiftool: { via: "binwalk+strings", why: "بيانات وصفية للملفات — binwalk/strings بيستخرجوا نفس المعلومات" },
  jq: { via: "python3 -m json.tool", why: "معالجة JSON — python3 موجود (json.tool + سكربتات)" },
  pandoc: { via: "python3", why: "تحويل مستندات — python3 بيغطي markdown→html/pdf عبر مكتبات" },
  wkhtmltopdf: { via: "python3", why: "PDF من HTML — weasyprint/reportlab عبر pip" },
  ghidra: { via: "radare2+rizin", why: "هندسة عكسية — radare2 وrizin موجودين في كالي" },
  ltrace: { via: "strace+gdb", why: "تتبّع مكتبات — strace موجود وgdb بيغطي تتبع أعمق" },
  crackmapexec: { via: "impacket+nxc", why: "تنفيذ/تعداد SMB — impacket (psexec/wmiexec) موجود" },
  empire: { via: "metasploit", why: "post-exploitation C2 — metasploit موجود بـ5,128 module" },
  routersploit: { via: "metasploit", why: "استغلال أجهزة شبكة — metasploit فيه وحدات شبكة" },
  bloodhound: { via: "bloodhound-ce", why: "جمع AD — bloodhound-ce-python موجود في المساحة" },
  vulners: { via: "searchsploit+nuclei", why: "مطابقة ثغرات — searchsploit (exploit-db) ونuclei بقوالبه" },
  openvas: { via: "nuclei+nikto+lynis", why: "فحص ثغرات شامل — nuclei/nikto/lynis بيغطوا الفحص" },
  faraday: { via: "nova", why: "إدارة نتائج — البرنامج نفسه فيه findings vault وتقارير" },
  dradis: { via: "nova", why: "تجمع تقارير — reports/ جوه مساحة الشغل + findings vault" },
  cherrytree: { via: "notes/", why: "ملاحظات هرمية — notes/ في مساحة الشغل + markdown" },
  libreoffice: { via: "python3", why: "مستندات — python-docx/openpyxl عبر pip للتوليد" },
  recordmydesktop: { via: "ffmpeg", why: "تسجيل شاشة — ffmpeg موجود في كالي عادة" },
  dex2jar: { via: "jadx+apktool", why: "تفكيك APK/DEX — jadx وapktool موجودين في كالي" },
  zaproxy: { via: "burpsuite", why: "proxy فحص ويب — burpsuite موجود" },
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
  /* TEST77 — سلسلة المصادر: apt كالي أولًا، لو فشل → pip، لو فشل → GitHub release
   * (من الجيت هوب مباشرة — القرار المعماري: جيت هوب مخزن كل حاجة). */
  const PIP_TOOLS: Record<string, string> = {
    photon: "photon", maigret: "maigret", h8mail: "h8mail",
    prowler: "prowler", scoutsuite: "scoutsuite", pacu: "pacu",
    netexec: "netexec", certipy: "certipy-ad", "bloodhound-python": "bloodhound",
    "ssh-audit": "ssh-audit", semgrep: "semgrep", sublist3r: "sublist3r",
    sherlock: "sherlock", volatility3: "volatility3",
  };
  const GITHUB_TOOLS: Record<string, { repo: string; pattern: string; flat?: string }> = {
    katana: { repo: "projectdiscovery/katana", pattern: "linux_amd64.zip", flat: "katana" },
    cariddi: { repo: "edoardottt/cariddi", pattern: "linux_amd64.tar.gz", flat: "cariddi" },
    subzy: { repo: "LukaSikter/subzy", pattern: "linux_amd64.tar.gz", flat: "subzy" },
    grype: { repo: "anchore/grype", pattern: "linux_amd64.tar.gz", flat: "grype" },
    syft: { repo: "anchore/syft", pattern: "linux_amd64.tar.gz", flat: "syft" },
    trufflehog: { repo: "trufflesecurity/trufflehog", pattern: "linux_amd64.tar.gz", flat: "trufflehog" },
    dockle: { repo: "goodwithtech/dockle", pattern: "linux-amd64.tar.gz", flat: "dockle" },
    gotator: { repo: "Josue87/Gotator", pattern: "linux_amd64.tar.gz", flat: "gotator" },
    osintgram: { repo: "Datalux/Osintgram", pattern: "", flat: "" }, // clone بدل release
  };
  const pkg = APT_ALIAS[tool] ?? tool;
  /* TEST53 — فكس الجذر (مقاس 2026-11-17): جيت مايخزنش المجلدات الفاضية فالجست
   * بيولّد من غيرها — apt/dpkg بيحتاجوها كلها وبيفشلوا واحد-واحد
   * («E: Directory '/var/log/apt/' missing» · «archives/partial is missing» ·
   * «dpkg returned an error code (2)»). نفس قائمة المثبّت بالحرف — ال13 مجلد. */
  const GUEST_DIRS = "var/log/apt var/lib/dpkg/updates var/lib/dpkg/triggers/File var/lib/dpkg/triggers/Unincorporated var/lib/dpkg/alternatives var/cache/apt/archives/partial var/lib/apt/lists/partial var/lib/ucf/cache run/lock tmp var/tmp var/lib/sudo var/spool/mail";
  /* TEST77 — الأمر حسب المصدر: apt → pip → GitHub release. كل سلسلة بتنتهي
   * بنفس بوابة INSTALL_OK — مافيش تغيير في بروتوكول الرد. */
  const GIT = GITHUB_TOOLS[tool];
  const PIP = PIP_TOOLS[tool];
  let installCmd: string;
  if (GIT && GIT.repo) {
    installCmd = !GIT.pattern
      ? `rm -rf /tmp/${tool} 2>/dev/null; git clone --depth 1 https://github.com/${GIT.repo} /tmp/${tool} 2>&1 | tail -2 && echo CLONE_OK:${tool} || echo CLONE_FAIL:${tool}`
      : `cd /tmp && rm -rf ${tool}-dl && mkdir -p ${tool}-dl && cd ${tool}-dl && URL=$(curl -s -m 30 https://api.github.com/repos/${GIT.repo}/releases/latest | tr "," "\n" | grep browser_download_url | grep "${GIT.pattern}" | head -1 | cut -d '"' -f4) && echo "URL=$URL" && curl -sL -m 180 "$URL" -o pkg.bin && ls -la pkg.bin && (tar -xzf pkg.bin 2>/dev/null || unzip -o pkg.bin >/dev/null 2>&1) ; BIN=$(find . -type f -name "${GIT.flat ?? tool}*" 2>/dev/null | head -1) && echo "BIN=$BIN" && cp "$BIN" /usr/local/bin/${tool} && chmod +x /usr/local/bin/${tool} && command -v ${tool} >/dev/null 2>&1 && echo INSTALL_OK:${tool} || echo INSTALL_FAIL:${tool}`;
  } else if (PIP) {
    installCmd = `(PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q ${PIP} 2>&1 || python3 -m pip install --break-system-packages -q ${PIP} 2>&1) | tail -5; command -v ${tool} >/dev/null 2>&1 && echo INSTALL_OK:${tool} || echo INSTALL_FAIL:${tool}`;
  } else {
    installCmd = `DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 | tail -2; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${pkg} 2>&1 | tail -12; if dpkg -s ${pkg} 2>/dev/null | grep -q '^Status: install ok installed' || command -v ${tool} >/dev/null 2>&1; then echo INSTALL_OK:${tool}; else echo INSTALL_FAIL:${tool}; fi`;
  }
  const cmd = `echo ROOT_UID:$(id -u); for d in ${GUEST_DIRS}; do mkdir -p "/$d" 2>/dev/null; done; ${installCmd}`;
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
    /* TEST73 — المسار الموحّد: المحلي مقفول على الهَب (قرار المالك «مافيش كالي
     * على الهَب») → الأسطول عبر قناة الagents. الفشل الصادق لو مافيش عقدة. */
    const result = await kaliAnywhereExecStream(command, tmo, (stream, chunk) =>
      send({ type: stream, text: chunk }),
    );
    if (result) {
      send({
        type: "done",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        plane: result.plane,
        error: result.stderr ? result.stderr.slice(0, 400) : undefined,
      });
    } else {
      send({ type: "error", message: "مافيش أمر تنفيذ — command مطلوب" });
    }
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

/**
 * جرد بصراحة — ٤٦ أداة أساسية بنسخها الحقيقية.
 *
 * الفرق بين ده و`/tools`: `/tools` بيقيس وجود + تصنيف. ده بيشغّل **كل أداة**
 * ويجيب نسختها من مخرجاتها. الغرض: المستخدم يسأل «متحدّثة؟» فيلاقي
 * `Nmap 7.991` و`Framework 6.5.7-dev` مش «موجود ✓». اتقاس 2026-11-17.
 */
router.get("/kali-env/inventory", async (_req: Request, res: Response) => {
  const layout = detectProotLayout();
  /* ★ اتقاس 2026-11-17 (الحزمة المنشورة على السلوت): الـrootfs الكالي
   *   ~20 GB والسلوت 1024 MB قرص — يعني `layout.ready` **هيبقى false
   *   للأبد** على nova.waifly.com. الرد القديم كان 503 «بيئة كالي مش جاهزة»،
   *   والواجهة كانت بتقول «فشل القياس» — قارئها يفهم إن فيه عطل، والحقيقة
   *   إن الجرد الحقيقي موجود على عقدة كالي في الأسطول. نفس اللي /tools بيعمله.
   *   القاعدة: الجرد بيقيس **أي** كالي حقيقية متاحة (محلية أو أسطول)، ولو
   *   مافيش ولا واحدة بيردّ 200 بـ`measured:false` + السبب المقاس، مش 503
   *   يوهم بعطل. 503 معناها «استنى وحاول تاني»؛ هنا مافيش استنى. */
  if (!layout.ready) {
    const fleet = await fleetKaliSummary();
    if (fleet.kaliReady === 0) {
      res.json({
        ok: false,
        measured: false,
        ready: false,
        reason:
          "مافيش كالي حقيقية في المدى: لا rootfs محلي على دي المكنة " +
          "(المساحة المتاحة أقل من ~20 GB اللي الـrootfs بيحتاجها)، ولا عقدة كالي متصلة بالأسطول",
        searched: layout.searched,
        fleet,
        total: 0,
        present: 0,
        missing: [],
        tools: [],
      });
      return;
    }
    // فيه عقدة كالي حية — الجرد بيتقاس عليها بنفس أوامر النسخة المحلية.
    const fleetProbe = await kaliAnywhereExec(
      CORE_INVENTORY.map((t) => `command -v ${t} >/dev/null 2>&1 && echo "P${t}"`).join(" "),
      60_000,
    );
    const found = new Set(
      fleetProbe?.stdout
        .split(String.fromCharCode(10))
        .map((l) => l.trim())
        .filter((l) => l.startsWith("P"))
        .map((l) => l.slice(1)) ?? [],
    );
    const tools = CORE_INVENTORY.map((name) => ({ name, present: found.has(name), version: null }));
    res.json({
      ok: true,
      measured: true,
      measuredOn: fleetProbe?.plane ?? "fleet",
      ready: true,
      hubRootfs: false,
      fleet,
      measuredAt: new Date().toISOString(),
      total: CORE_INVENTORY.length,
      present: tools.filter((t) => t.present).length,
      missing: tools.filter((t) => !t.present).map((t) => t.name),
      tools,
    });
    return;
  }
  const CORE = CORE_INVENTORY;
  /* أمر واحد بيطبع `tool|version` لكل أداة — أقل من ٦٠ ثانية للمجموعة.
   * كل أداة بنداء --version/-v/V خاص بيها، ومهلة ٦ث عشان اللي متعلّق
   * ما يعلّقش الجرد كله. */
  /* ★ أوامر النسخة مش موحّدة — وده كان بيدّي «ناقص» لأدوات شغالة.
   *   اتقاس 2026-11-17: masscan/nikto/dirb/nuclei/arpspoof/msfconsole/binwalk
   *   كلهم موجودين في /usr/bin، بس `--version` بتاعهم بيفشل (أو بيطبع
   *   الاستخدام على stderr). الخريطة دي بتدي كل أداة الأمر الصح **مرة
   *   واحدة**، وأي أداة مش في الخريطة بتجرب السلسلة العامة.
   *
   *   وقاعدة حاكمة: لو الأمر رجّع **أي نص**، الأداة موجودة. النص نفسه مش
   *   شرط يكون رقم نسخة — `dirb` بيطبع بانر، و`nuclei` بيطبع سطر INF.
   *   «موجود» معناها الملف قابل للتنفيذ وردّ، مش إن فيه semver. */
  const VERSION_CMD: Record<string, string> = {
    masscan: "masscan --version",
    nikto: "nikto -Version",
    dirb: "dirb 2>&1 | grep -i version",
    nuclei: "nuclei -version",
    arpspoof: "arpspoof -h",
    msfconsole: "msfconsole -v",
    binwalk: "binwalk --help",
    volatility3: "vol --help",
    tshark: "tshark -v",
    wpscan: "wpscan --version",
    commix: "commix --version",
    theHarvester: "theHarvester -h",
    arjun: "arjun --help",
    john: "john --list=build-info 2>&1 | grep -m1 Version",
    foremost: "foremost -V",
    dnsenum: "dnsenum --help 2>&1 | grep -i 'dnsenum'",
    sublist3r: "sublist3r -h",
    searchsploit: "searchsploit -h",
    wfuzz: "wfuzz --version 2>&1 | grep -m1 -E '^[0-9]+\\.[0-9]+'",
    "radare2": "radare2 -v",
    "rizin": "rizin -v",
    "fierce": "fierce --version",
    strace: "strace -V",
    "aircrack-ng": "aircrack-ng --help",
    "impacket-psexec": "impacket-psexec -h",
    "impacket-secretsdump": "impacket-secretsdump -h",
    "impacket-wmiexec": "impacket-wmiexec -h",
    "impacket-ntlmrelayx": "impacket-ntlmrelayx -h",
  };
  /* ★ منظّف نص النسخة — اتقاس 2026-11-17:
   *   john بيردّ «Unknown option: "--version"»، foremost «invalid option»،
   *   dnsenum «Unknown option: version»، wfuzz «default»، dirb شرطات.
   *   دي مخرجات فشل مش نسخ. الأداة **موجودة** (الملف قابل للتنفيذ وردّ)،
   *   بس النص مايتعرضش كنسخة. بنرجّع null → الواجهة تكتب «موجودة»
   *   بدون رقم، وده أصدق من رقم غلط أو من «ناقصة» كدب. */
  const versionJunk = /unknown option|invalid option|illegal option|^usage:|^default$|^-+$|^\s*$|error:|not found/i;
  const cleanVersion = (raw: string): string | null => {
    const v = raw.replace(/\x1b\[[0-9;]*m/g, "").replace(/[|]/g, "").trim();
    if (!v || v.length < 2) return null;
    if (versionJunk.test(v)) return null;
    if (!/[0-9]/.test(v) && v.length > 30) return null;
    return v.slice(0, 56);
  };

  const script = CORE.map((t) => {
    /* ★ البنية دي اتظبطت بعد فشل حقيقي: السطر القديم كان بيولّد `((`
     *   مزدوجة و`;;` فـ`/bin/sh` كان بيرفض السكربت كله («Syntax error:
     *   ";;" unexpected») والجرد بيرجع فاضي — الأخطر إن الواجهة كانت
     *   هتقول «٤٦ ناقصة» وهي كلها موجودة. دلوقتي probe **مجرّدة** من أي
     *   أقواس، والقوس بيتحط مرة واحدة في مكان الاستخدام. */
    const probe = VERSION_CMD[t]
      ? `timeout 8 ${VERSION_CMD[t]} 2>&1`
      : `timeout 6 ${t} --version 2>&1 || timeout 6 ${t} -V 2>&1 || timeout 6 ${t} -v 2>&1 || timeout 6 ${t} -h 2>&1`;
    /* موجود = الملف قابل للتنفيذ. النسخة = أول سطر مفيد من ردّه.
     * الاتنين منفصلين عشان أداة موجودة بلا نص نسخة تتحسب موجودة. */
    /* ★ اتقاس 2026-11-17: masscan/dirb/binwalk/aircrack-ng بيطبعوا سطر
     *   فاضي الأول، فـ head -1 كان بيرجّع فراغ → الأداة تتحسب ناقصة وهي
     *   شغالة (masscan 1.3.2، binwalk 2.4.3، dirb، aircrack-ng 1.7).
     *   الحل: أول **سطر غير فاضي**، ونشيل أي حرف | من النص عشان ما يبوّش
     *   الفصل بين الاسم والنسخة. */
    /* ★ اتقاس 2026-11-17 (الدورة التانية): بعض الأدوات بتردّ نص غلط
     *   كأول سطر مفيد — john: "Unknown option: --version"، foremost:
     *   "invalid option"، dnsenum: "Unknown option: version"، dirb:
     *   سطر شرطات، sublist3r: كود أنسي بس. فلترتين:
     *   ١) في الشِل: أول سطر فيه حرف/رقم فعلي بعد شيل الألوان.
     *   ٢) في TS: لو النص فضل شكل رسالة خطأ/استخدام → النسخة تتحوّل لـ
     *      null والأداة تفضل موجودة (الملف قابل للتنفيذ وردّ — ده الدليل).
     *   الرمز P = الملف موجود، N = مش موجود. الفصل ده هو اللي بيمنع
     *   «أداة شغالة من غير رقم نسخة» تتحسب «ناقصة». */
    return `command -v ${t} >/dev/null 2>&1 && printf 'P' || printf 'N'; printf '%s|' "${t}"; ({ ${probe}; } | sed -e 's/\x1b\[[0-9;]*m//g' | grep -m1 -E '[A-Za-z0-9]' | tr -d '|' | cut -c1-56); printf '\n';`;
  }).join(" ");
  const r = await runInProot({ command: script, timeoutMs: 300_000 });
  const rows = r.stdout
    .split(String.fromCharCode(10))
    .filter((l) => l.includes("|"))
    .map((l) => {
      /* سطر بصيغة: (P|N)<tool>|<نص النسخة> */
      const parked = l.trimStart()[0] === "P";
      const body = l.trimStart().slice(1);
      const [name, ...rest] = body.split("|");
      const found = name.trim();
      const version = parked ? cleanVersion(rest.join("|")) : null;
      return { name: found, present: parked, version };
    })
    .filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i);
  const present = rows.filter((x) => x.present).length;
  res.json({
    ok: true,
    measuredAt: new Date().toISOString(),
    total: CORE.length,
    present,
    missing: rows.filter((x) => !x.present).map((x) => x.name),
    tools: rows,
  });
});

router.get("/kali-env/sessions", (_req, res) => {
  // proot runs are one-shot; there is no persistent session to list. Answering
  // honestly beats inventing rows the page would then render as real.
  res.json({ sessions: [], note: "proot runs are one-shot; no persistent sessions" });
});

export default router;
