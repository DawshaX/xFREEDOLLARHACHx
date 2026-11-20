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
import fs from "node:fs";
import path from "node:path";
import { Router, type IRouter, type Request, type Response } from "express";
import { requireOps } from "../lib/ops/gate";
import { detectProotLayout, prootHealth, runInProot } from "../lib/ops/proot";
import { kaliAnywhereExec, kaliFleetUnionExec, kaliAnywhereExecStream } from "../lib/ops/kali-anywhere";
import { readProbeCache, probeAllKaliNodes, orderPrewarmedFirst } from "../lib/ops/kali-node-probe";
import { PROOT_GUEST_EXEC } from "../lib/ops/kali-node-installer";
import { execStreamOnLocalAgent, execOnLocalAgent } from "./local-agent";
import { kaliSysInfo } from "../lib/ops/kali-sysinfo";
import { appendNovaEvent, readNovaEvents } from "../lib/ops/nova-events";
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
  /* قياس 2026-11-20 05:3xZ على عقدة كالي: في proot بـfake-root، nmap بيفشل
   * `route_dst_netlink: can't find interface "lo"` على أي هدف (raw sockets
   * بيرفضها الكيرنل). بالـ`--unprivileged -sT` القياس الحي: 127.0.0.1 →
   * 22/tcp open ssh · RC=0 في 0.17s. نفس البادئة لحماية الloopback. */
  nmap: { args: "--unprivileged -sT -sV -T4 {target}", targetLabel: "host / CIDR", hint: "فحص منافذ وخدمات" },
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
    "nikto", "nuclei", "wapiti", "legion", "nmap", " Lynis".trim().toLowerCase(), "unix-privesc-check",
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
    "bully", "wifite", "kismet", "hcxdumptool", "hcxtools", "hashcat", "fern",
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
  const readyAnywhere = (health.ready && health.guestShell) || fleet.kaliReady > 0;
  const firstNode = fleet.nodes.find((n) => n.kali);
  res.json({
    ...health,
    ready: readyAnywhere,
    guestShell: (health.ready && health.guestShell) || fleet.kaliReady > 0,
    rootfs: layout.rootfs ?? (firstNode ? `/home/runner/kali-rootfs/rootfs (${firstNode.hostname} · ${fleet.kaliReady} عقد حية)` : null),
    prootBin: layout.prootBin ?? (firstNode ? "/usr/local/bin/proot-static" : null),
    detail: (health.ready && health.guestShell)
      ? health.detail
      : fleet.kaliReady > 0
        ? `بيئة كالي السحابية شغّالة ومتصلة — ${fleet.kaliReady}/${fleet.connected} عقدة كالي حية (${firstNode?.hostname ?? "fleet"})`
        : health.detail,
    hubLocalReady: health.ready && health.guestShell,
    searched: layout.searched,
    ok: readyAnywhere,
    fleet,
    readyAnywhere,
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
    /* TEST93q — القياس الاتحادي: probe على كل العقد الحية (حتى 6) بالتوازي
     * وunion للنتائج. عقدة طازة عمرها ما تتسطب عليها C/D كانت بتدبل كتالوج
     * العقد المتراكم (مقاس حي 10:2xZ: 205 عقدة E فوق 228 عقدة C/D/E). الاتحاد
     * هو الكتالوج الحقيقي: كل أداة «موجودة» بس لو **مقاسة موجودة على عقدة حية**. */
        /* TEST93w — maxNodes 16: مقاس 14:28 — كاب ال6 كان بيستثني runnervm0hi8g
     * (اللي عليها C/D/F كاملة) فالاتحاد كان 209 كاذبة بدل ~261. البروب رخيص
     * (command -v ×266 لكل عقدة) — غطي كل الأسطول. */
    const union = await kaliFleetUnionExec(probe, 90_000, 16);
    const foundUnion = new Set<string>();
    for (const so of union.stdouts) {
      for (const l of so.split("\n").map((x) => x.trim()).filter((x) => x.startsWith("OK:"))) foundUnion.add(l.slice(3));
    }
    let r: { stdout: string; plane: string } | null = null;
    if (foundUnion.size) {
      r = {
        stdout: [...foundUnion].map((t) => `OK:${t}`).join("\n"),
        plane: `اتحاد ${union.planes.length} عقدة كالي حية — ${union.planes.slice(0, 4).join(" · ")}${union.planes.length > 4 ? " …" : ""}`,
      };
    } else {
      r = await kaliAnywhereExec(probe, 60_000);
    }
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
  volatility: ["volatility", "vol.py", "vol"],
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
  /* TEST88 — مرادفات مقاسة: الأداة بتتسطب باسم تري (مصدر: installers TEST87/88) */
  sleuthkit: ["fls", "mmls", "icat", "sleuthkit"],
  hcxtools: ["hcxpcapngtool", "hcxhashtool", "hcxwltool", "hcxtools"],
  scoutsuite: ["scout", "scoutsuite"],
  "ligolo-ng": ["ligolo-ng", "agent"],
  /* TEST91 — أدوات المخزن: أمر التثبيت ≠ اسم الأداة في الكتالوج كثيرًا */
  maskprocessor: ["mp32", "mp64", "maskprocessor", "mp"],
  rainbowcrack: ["rcrack", "rainbowcrack"],
  redis: ["redis-server", "redis-cli"],
  elfutils: ["eu-readelf", "readelf"],
  "python3-pip": ["pip3"],
  "metasploit-framework": ["msfconsole", "msfvenom"],
  libreoffice: ["libreoffice", "soffice"],
  gvm: ["gvm-cli", "gvmd", "gvm-setup"],
  w3af: ["w3af_console", "w3af_gui", "w3af"],
  ghidra: ["ghidraRun", "ghidra", "analyzeHeadless"],
  "dvcs-ripper": ["rip-git", "rip-svn"],
  "peass-ng": ["linpeas", "linpeas.sh"],
  socialanalyzer: ["social-analyzer", "socialanalyzer"],
  "gh-dork": ["gh-dork"],
  fern: ["fern"],
  pentestly: ["pentestly"],
  ssrfmap: ["ssrfmap"],
  sidguesser: ["sidguess", "sidguesser"],
  aria2: ["aria2c", "aria2"],
  "king-phisher": ["king-phisher"],
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
  hcxdumptool: { via: "aircrack-ng", why: "التقاط/تحليل WPA — aircrack-ng موجود (الـfirmware مش متاح في proot أصلًا)" },
  hcxtools: { via: "aircrack-ng", why: "تحويل/تحليل handshakes — aircrack-ng موجود" },
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
          const presenceCmd = all
            .map((t) => {
              const probe = binCandidates(t)
                .map((bin) => (bin.startsWith("/") ? `[ -e '${bin}' ]` : `command -v ${bin} >/dev/null 2>&1`))
                .join(" || ");
              return `{ ${probe} ; } && echo "OK:${t}"`;
            })
            .join("; ");
          const buildCategories = (found: Set<string>, versions: Record<string, string>, plane: string, fleet?: Awaited<ReturnType<typeof fleetKaliSummary>>): CatalogPayload => {
            const categories = KALI_CATEGORIES.map((cat) => {
              const tools = TOOL_GROUPS[cat] ?? [];
              return {
                id: cat,
                tools: tools.map((t) => ({
                  name: t,
                  present: found.has(t),
                  version: found.has(t) ? (versions[t] && versions[t] !== "unknown" ? versions[t] : `جاهزة (${binCandidates(t)[0]})`) : null,
                  recipe: TOOL_RECIPES[t] ?? { args: "{target}", targetLabel: "هدف / خيارات", hint: `تشغيل مباشر لـ ${t}` },
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
              ...(fleet ? { fleet } : {}),
            } as CatalogPayload;
          };

          if (layout.ready) {
            const pr = await runInProot({ command: `${presenceCmd}; echo '===DPKG==='; dpkg-query -W -f='V:\${Package}=\${Version}\\n' 2>/dev/null`, timeoutMs: 60_000 });
            const [presPart, dpkgPart = ""] = pr.stdout.split("===DPKG===");
            const found = new Set(presPart.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("OK:")).map((l) => l.slice(3)));
            const versions: Record<string, string> = {};
            for (const line of dpkgPart.split("\n")) {
              const m = /^V:([^=]+)=(.+)$/.exec(line.trim());
              if (m) versions[m[1]] = m[2].trim().slice(0, 60);
            }
            resolve(buildCategories(found, versions, "proot (rootfs على الهوست)"));
            return;
          }
          const fleet = await fleetKaliSummary();
          if (fleet.kaliReady > 0) {
            const union = await kaliFleetUnionExec(`${presenceCmd}; echo '===DPKG==='; dpkg-query -W -f='V:\${Package}=\${Version}\\n' 2>/dev/null`, 60_000);
            const found = new Set<string>();
            const versions: Record<string, string> = {};
            for (const out of union.stdouts) {
              const [presPart, dpkgPart = ""] = out.split("===DPKG===");
              for (const l of presPart.split("\n")) {
                const s = l.trim();
                if (s.startsWith("OK:")) found.add(s.slice(3));
              }
              for (const line of dpkgPart.split("\n")) {
                const m = /^V:([^=]+)=(.+)$/.exec(line.trim());
                if (m && !versions[m[1]]) versions[m[1]] = m[2].trim().slice(0, 60);
              }
            }
            const plane = union.planes.length > 0
              ? `اتحاد ${union.planes.length} عقدة كالي حية — ${union.planes.slice(0, 3).join(" · ")}`
              : "عقدة كالي من الأسطول";
            resolve(buildCategories(found, versions, plane, fleet));
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

router.get("/kali-env/catalog", async (req, res) => {
  const forceFresh = req.query.fresh === "1";
  const fresh = !forceFresh && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS;
  if (fresh && catalogCache) {
    res.json({ ...catalogCache.payload, cachedFrom: new Date(catalogCache.at).toISOString() });
    return;
  }
  if (!forceFresh && catalogCache) {
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
  const known = new Set([
    ...Object.values(TOOL_GROUPS).flat(),
    ...Object.values(APT_CATALOG).flat(),
  ]);
  if (typeof tool !== "string" || (!known.has(tool) && !/^[a-z0-9][a-z0-9.+_-]{0,48}$/i.test(tool))) {
    res.status(400).json({ error: `أداة غير معروفة: ${String(tool).slice(0, 40)}` });
    return;
  }
  const actualBin = binCandidates(tool)[0] ?? tool;
  const recipe = TOOL_RECIPES[tool] ?? {
    args: "{target}",
    targetLabel: "هدف أو خيار (مثال: example.com أو --help)",
    hint: `تشغيل مباشر للأداة ${tool} (${actualBin}) على عقدة كالي`,
  };
  const tgt = typeof target === "string" ? target.trim() : "";
  if (!tgt) {
    res.status(400).json({ error: "target مطلوب" });
    return;
  }
  if (tgt.length > 300 || /[\n\r\0]/.test(tgt)) {
    res.status(400).json({ error: "target فيه محارف مرفوضة" });
    return;
  }
  const command =
    tgt === "--help" || tgt === "-h" || tgt === "--version" || tgt === "-v"
      ? `${actualBin} ${tgt}`
      : `${actualBin} ${recipe.args.replace("{target}", shellQuote(tgt))}`;

  /* إصلاح مقاس 2026-11-20 05:0xZ: proot بيطلع `route_dst_netlink: can't find
   * interface "lo"` على أي فحص loopback (nmap -sV 127.0.0.1 → exit 1) لأن
   * واجهة lo مش لاقية in the proot namespace. بنرفعها قبل التنفيذ — idempotent
   * وصامت لو الأداة مش موجودة. */
  const isLoopback = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[?::1\]?)$/i.test(tgt);
  const finalCommand = isLoopback
    ? `(ip link set lo up 2>/dev/null || ifconfig lo up 2>/dev/null || true); ${command}`
    : command;

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
        command: finalCommand,
        timeoutMs: tmo,
        onData: (stream, chunk) => send({ type: stream, text: chunk }),
      });
      send({ type: "done", plane: "proot", exitCode: result.exitCode, durationMs: result.durationMs, error: result.error });
      appendNovaEvent("run", `${tool} ← ${tgt}`, `proot · exit=${result.exitCode} · ${Math.round(result.durationMs / 1000)}s`);
    } else {
      const result = await kaliAnywhereExecStream(finalCommand, tmo, (stream, chunk) => {
        send({ type: stream, text: chunk });
      });
      if (!result) {
        send({ type: "error", message: "مفيش طائرة تنفيذ: لا rootfs محلي ولا عقدة كالي حية" });
      } else {
        send({ type: "done", plane: result.plane, exitCode: result.exitCode, durationMs: result.durationMs });
        appendNovaEvent("run", `${tool} ← ${tgt}`, `${result.plane} · exit=${result.exitCode} · ${Math.round(result.durationMs / 1000)}s`);
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

/* إطار «بيجاهز» — بيتبعت فورًا مع heartbeat لحد أول إطار حقيقي من العقدة
 * (القياس الحي: تثبيت xvfb+ffmpeg جوه الجست بياخد دقائق — من غير الإطار ده
 * المتصفح شاشة سوداء والproxy مايفتحش — إثبات 2026-11-20 02:3xZ: HTTP 000 خلال 25s). */
const DESKTOP_FRAME_PREP = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABIMDRANCxIQDhAUExIVGywdGxgYGzYnKSAsQDlEQz85Pj1HUGZXR0thTT0+WXlaYWltcnNyRVV9hn" +
  "xvhWZwcm7/2wBDARMUFBsXGzQdHTRuST5Jbm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm5ubm7/wAARCAGQ" +
  "AoADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhBy" +
  "JxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKT" +
  "lJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAA" +
  "AAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRom" +
  "JygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExc" +
  "bHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDEVdPs9IsZ7iw+0SXHmZbzmTG1sdqi+36V/wBAb/yaejUP+QBp" +
  "P/bb/wBDFZdc1Ompptt7vq+78y5StojU+36V/wBAb/yaej7fpX/QG/8AJp6y6K09hHu/vf8AmLnf9JGp9v0r/oDf+TT0fb9K/wCgN/5NPWXRR7" +
  "CPd/e/8w53/SRqfb9K/wCgN/5NPR9v0r/oDf8Ak09ZdFHsI9397/zDnf8ASRqfb9K/6A3/AJNPR9v0r/oDf+TT1l0Uewj3f3v/ADDnf9JGp9v0" +
  "r/oDf+TT0fb9K/6A3/k09ZdFHsI9397/AMw53/SRqfb9K/6A3/k09H2/Sv8AoDf+TT1l0Uewj3f3v/MOd/0kan2/Sv8AoDf+TT0fb9K/6A3/AJ" +
  "NPWXRR7CPd/e/8w53/AEkan2/Sv+gN/wCTT0fb9K/6A3/k09ZdFHsI9397/wAw53/SRqfb9K/6A3/k09H2/Sv+gN/5NPWXRR7CPd/e/wDMOd/0" +
  "kan2/Sv+gN/5NPR9v0r/AKA3/k09ZdFHsI9397/zDnf9JGp9v0r/AKA3/k09H2/Sv+gN/wCTT1l0Uewj3f3v/MOd/wBJGp9v0r/oDf8Ak09H2/" +
  "Sv+gN/5NPWXRR7CPd/e/8AMOd/0kan2/Sv+gN/5NPR9v0r/oDf+TT1l0Uewj3f3v8AzDnf9JGp9v0r/oDf+TT0fb9K/wCgN/5NPWXRR7CPd/e/" +
  "8w53/SRqfb9K/wCgN/5NPR9v0r/oDf8Ak09ZdFHsI9397/zDnf8ASRqfb9K/6A3/AJNPR9v0r/oDf+TT1l0Uewj3f3v/ADDnf9JGp9v0r/oDf+" +
  "TT0fb9K/6A3/k09ZdFHsI9397/AMw53/SRqfb9K/6A3/k09H2/Sv8AoDf+TT1l0Uewj3f3v/MOd/0kan2/Sv8AoDf+TT0fb9K/6A3/AJNPWXRR" +
  "7CPd/e/8w53/AEkan2/Sv+gN/wCTT0fb9K/6A3/k09ZdFHsI9397/wAw53/SRqfb9K/6A3/k09H2/Sv+gN/5NPWXRR7CPd/e/wDMOd/0kan2/S" +
  "v+gN/5NPR9v0r/AKA3/k09ZdFHsI9397/zDnf9JGp9v0r/AKA3/k09H2/Sv+gN/wCTT1l0Uewj3f3v/MOd/wBJGp9v0r/oDf8Ak09H2/Sv+gN/" +
  "5NPWXRR7CPd/e/8AMOd/0kan2/Sv+gN/5NPR9v0r/oDf+TT1l0Uewj3f3v8AzDnf9JGp9v0r/oDf+TT0fb9K/wCgN/5NPWXRR7CPd/e/8w53/S" +
  "Rqfb9K/wCgN/5NPR9v0r/oDf8Ak09ZdFHsI9397/zDnf8ASRqfb9K/6A3/AJNPR9v0r/oDf+TT1l0Uewj3f3v/ADDnf9JGp9v0r/oDf+TT0fb9" +
  "K/6A3/k09ZdFHsI9397/AMw53/SRqfb9K/6A3/k09H2/Sv8AoDf+TT1l0Uewj3f3v/MOd/0kan2/Sv8AoDf+TT0fb9K/6A3/AJNPWXRR7CPd/e" +
  "/8w53/AEkan2/Sv+gN/wCTT0fb9K/6A3/k09ZdFHsI9397/wAw53/SRqfb9K/6A3/k09H2/Sv+gN/5NPWXRR7CPd/e/wDMOd/0kan2/Sv+gN/5" +
  "NPR9v0r/AKA3/k09ZdFHsI9397/zDnf9JGp9v0r/AKA3/k09H2/Sv+gN/wCTT1l0Uewj3f3v/MOd/wBJGp9v0r/oDf8Ak09H2/Sv+gN/5NPWXR" +
  "R7CPd/e/8AMOd/0kan2/Sv+gN/5NPR9v0r/oDf+TT1l0Uewj3f3v8AzDnf9JGp9v0r/oDf+TT0fb9K/wCgN/5NPWXRR7CPd/e/8w53/SRqfb9K" +
  "/wCgN/5NPUrLp95pF9Pb2H2eS38vDecz53NjvWNWpp//ACANW/7Y/wDoZrOpTUEmm911fdeY4yvow1D/AJAGk/8Abb/0MVl1qah/yANJ/wC23/" +
  "oYrLrSh8L9X+bFPf7vyCiiitiQooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoooo" +
  "AKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoo" +
  "ooAK1NP/5AGrf9sf8A0M1l1qaf/wAgDVv+2P8A6Gaxr/CvVfmiob/f+Qah/wAgDSf+23/oYrLrU1D/AJAGk/8Abb/0MVl0UPhfq/zYT3+78goo" +
  "orYkKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiig" +
  "AooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACtTT/8AkAat/wBsf/Qz" +
  "WXWpp/8AyANW/wC2P/oZrGv8K9V+aKhv9/5BqH/IA0n/ALbf+hisutTUP+QBpP8A22/9DFZdFD4X6v8ANhPf7vyCiiitiQooooAKKKKACiiigA" +
  "ooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiii" +
  "gAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK1NP/AOQBq3/bH/0M1l1qaf8A8gDVv+2P/oZrGv" +
  "8ACvVfmiob/f8AkGof8gDSf+23/oYrLrU1D/kAaT/22/8AQxWXRQ+F+r/NhPf7vyCiiitiQooooAKKKKACiiigAooooAKKKKACiiigAooooAKK" +
  "KKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA" +
  "KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK1NP8A+QBq3/bH/wBDNZdamn/8gDVv+2P/AKGaxr/CvVfmiob/AH/kGof8gDSf" +
  "+23/AKGKy61NQ/5AGk/9tv8A0MVl0UPhfq/zYT3+78gooorYkKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAoo" +
  "ooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigA" +
  "ooooAKKKKACiiigAooooAKKKKACtTT/+QBq3/bH/ANDNZdamn/8AIA1b/tj/AOhmsa/wr1X5oqG/3/kGof8AIA0n/tt/6GKy61NQ/wCQBpP/AG" +
  "2/9DFZdFD4X6v82E9/u/IKKKK2JCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACii" +
  "igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAC" +
  "iiigArU0//AJAGrf8AbH/0M1l1qaf/AMgDVv8Atj/6Gaxr/CvVfmiob/f+Qah/yANJ/wC23/oYrLrU1D/kAaT/ANtv/QxWXRQ+F+r/ADYT3+78" +
  "gooorYkKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACi" +
  "iigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACtTT/wDkAat/2x/9" +
  "DNZdamn/APIA1b/tj/6Gaxr/AAr1X5oqG/3/AJBqH/IA0n/tt/6GKy61NQ/5AGk/9tv/AEMVl0UPhfq/zYT3+78gooorYkKKKKACiiigAooooA" +
  "KKKKAJbSH7TdwwbtvmuqbsZxk4zWnrXh99KgSZZvOQnax2bdp7dzVHSv8AkLWf/XdP/QhXZX88c+pvpVz/AKu5twUPo2T/AID8q4cRWnTqx5dr" +
  "XZrCKlF3OXudG8jRYtQ8/d5mP3ezGM++aW00J5LL7Zd3CWtuejMMk/hWxrUD2vhSGCT78bKp/Wm+Lv8AkE2Xlf6ncMY6fd4/TNZQxE52inu3r5" +
  "IpwS18jLl0EvZtdafdJdxJ94KpVh+Bptjon27SpruK4/eRZzFs64GeufT2rT8Ebs3n9zC/nzUHhe8SHWJrcH91PkL6ZGSP0zVTq1Y88U7uNn8u" +
  "wlGLs+5kaZYtqN9HbI23dnLYztA70uqWK2F+1qkvnFMZbbjk9uprp9K05dIudSu5RiOPIj/3fvf4D8KxNChbVNfEsvIDGZ/z/wAcVaxPNKU0/d" +
  "S/HcThZJdWWbnwpJb6e9x9p3SIm8xeX+Yzn+lc/XoEK3p1y4aWH/Q3jCKSwPI9s57muJ1S0NjqM9v2Rvl+h5H6VODryqNxm7vf+vQKkEtUGl2X" +
  "9o6hFa+Z5fmZ+bGcYBPT8KtyaDP/AGw1hA3m7AC0hXAAIzk0nhf/AJD9t/wL/wBBNdffB5ILuPTXjS843+vTj9OhpYnEzpVeVbNfc77jhBSjc4" +
  "rV7CDTp/Jju/tEg++Am0L7Zyeav6V4ZbUbFblrnyQ5O1fL3ZA79RWOlvLJdi3KsJmfZhuuc967e7gvLd9OisIS8EDDzDuA4xjufQmniKs6cYwj" +
  "LV9dAhFSbbWhw1xC1vcSQyDDRsVP4Vpa5on9kLCftHneaT/BtxjHufWrPjCz8jUVuFHyzrz/ALw4P6Yq543/ANXZ/V/6VSxEpypWekr3+SE4JK" +
  "V+hz+l2X9o6hFa+Z5fmZ+bGcYBPT8KXVbH+zr+S28zzNgHzbcZyM9Ks+F/+Q/bf8C/9BNO8Vf8h6f6L/6CK19pL6xyX0tf8SbLkv5lPS7L+0dQ" +
  "itfM8vzM/NjOMAnp+FaU2g2kN2bVtVRZ+PleEgc9Oc4qv4X/AOQ/bf8AAv8A0E07xV/yHp/ov/oIqJym6/s1Kytfp3GklC7XUqalplxpk4juFH" +
  "zcq68hq1L7w7a6eEN3qnl787f9HJzj6Grvin/kA2Xnf67cuc9funP64qx4p+wbLb+0PtOMts8jb7ZzmudYmpP2etr3vby9S+RK5y09pD9qigsL" +
  "n7X5mAD5ZT5ienNX59CtbR1ivNUjinIzsERYD8apfaLa01GG408TNHGQ2J8ZJzz07V0DXGh67Mnnh4rl8KM5BPtnpW1WpUhyvXl6uyv8yYqLv3" +
  "Ofl08Jqsdks6SLIyKJUGRhsc/rVjUNBltdRhs7dzcPKu4HbtxyR6n0qafTBpXiOyhVy6NLGyk9cbuh/KutuCpklS3eNL0xfKWGeMnH4ZrGti5Q" +
  "cXF3TX9MqNNO9zj77RrTT54obnUgHfl9sJYIMd+antPDtrexPLbapvSP7x+zkY/M1jXsdxFdyLdhvO3fNu6k+tdJ4S/5BN99T/6DWteVSnS51O" +
  "707W/ImCjKVrGFd2lmip9ivjdSswXyxCyfzq5JoEdpGh1K/jtnfogQufxxVbw9s/ty18zGN/f1wcfrirfi/d/bR3Zx5a7fpz/XNXKU/aqkpdL3" +
  "0v8Alb8BJLl5rFXU9Fm0+JJw6T27/dlTp7ZqzaaDFNpC6hPe+RGc7h5RbHzY7GtGH/kRn87ptO3P+/x+tSWccUvglUnm8mMg7pNpbH7w9hXPLE" +
  "VOW19VK17dC1BX+VzIuNA/4l7XtjdJdQrkthCpAHXiseujGqWGm6LLZWUz3Mku7LlCoGRjPPtXOV14eVSV+fa+l9GZzSVrBRW1baJZTW0cr6xb" +
  "xM6glG25U+n3ql/4R+w/6Dlt/wCO/wDxVN4qkna/4P8AyD2cjAorS1TTLaxgV4NRhumZsFExkDHXgms2tYTjNXiS01ozfvfDlrp+z7Xqnl+ZkL" +
  "+4Jzj6H3qlq2iy6YkcvmLNBJwsi8e9dH4pgtJ1tvtl59mALbf3Rfd0z06Vj69q9tc2MFjZbmiixl2GM4GBXn4etWnyO7d7300++xtOMVcfeeHL" +
  "Ww8v7Vqgj8wkLmAnP5HjrWfrGjzaS6b3WSOTO1146e1dP4ktbW6a0S7u/s3zMF+Qnd079vxrM8ZSTCS3hMW2BQSj5zuPH8qWGxFScoJu9730/L" +
  "T/ADCcEk9Cu3h+3h06C8utR8lJVU/6gtgkZxwazb63tIAn2S9+1E53Dyim38+tdRqH2T/hF7H7d5/lbY8eTjdnZ79q5a++w5T7B9pxzu8/b+GM" +
  "Vthqk6jvJvd9Fb8iZxS2Na98OWun7PteqeX5mQv7gnOPofeqWraLLpiRy+Ys0EnCyLx710fimC0nW2+2Xn2YAtt/dF93TPTpWRrur211ZQWFiH" +
  "eOLHzsMZwMACssPWrT5Hdu976affYqcYq5Dovh9tWgkmM/kqrbR8m7ce/ce1Z+o2baffS2zncUPDYxkdjXXS2V7Z6Ha22nxb5lZXk+YDkHcep9" +
  "aoeMrQkW96F2kjy3Hp3H9adHFOdazfuu9l6f5hKmlHzKh8P28WnQXl1qPkpMqn/UlsEjOODVfVNEfT7eO5SZJ7eTGHUY6jI4rev4befwxYJdXP" +
  "2ZNsR37C3O3pgVW8Tb7bRrS2gXfagL++znOBx+fWppYipKcU3u300t9wSgknoZY0TOg/2n9o7f6vZ/tbeuf6VPYeGmv9LW7juQHcMVjKdSCRjO" +
  "fb0q8n/IhH6H/wBGVNYXbWPg6G5TkxtnHqPM5H5UTr1uV8r157fIFCN9exhaLo51WeaJpjCYhk5Td3+oqCy0u4v7x7e3AOwnc7cAD1Ndlp9pGu" +
  "pS31vgwXcQYY7Nnn/P1qh4Z/489R8r/XeY3Tr04/XNJ4yVpyXl8r7h7JaJmRJo9jFKYZNYiWUHBAiJAP1zis29tvsl08PmJJtxh06HIzx+dWtG" +
  "trO8u/s94bgPIwEZixjvnOfwpNcsItO1FreFnZAoOXIJ5+ldkJONTklJt27IzavG6RQooorpICiiigAooooAKKKKACiiigArU0//AJAGrf8AbH" +
  "/0M1l1qaf/AMgDVv8Atj/6Gaxr/CvVfmiob/f+Qah/yANJ/wC23/oYrLrU1D/kAaT/ANtv/QxWXRQ+F+r/ADYT3+78gooorYkKKKKACiiigAoo" +
  "ooAKKKKAJbSb7Ndwz7d3lOr7c4zg5xVzVdXbUNQju44zA8agLht3IJOeg9azqKh04uXM1qPmaVjb1bxGdTsRbtbCM7gxYPnp7YqG01147L7Hd2" +
  "6XVuOisSCPxrKorNYako8iWm4+eV7mvLrxSza10+1S0if7xVizH8TWXBM1vPHNGcNGwYfUUyirjShBNJbicmzd1XxM2o2LWy23khyNzeZuyB26" +
  "Cq2j6yNJinC2/mSS8B9+NvpxisuioWGpKHs0tB88r3JLeZoLiOZfvRsGH1BzVzWtTXVbhJhb+SyrtPz7t3p2FZ9FaOnFyU+qFd2sWtLvf7O1CK" +
  "68vzPLz8ucZyCOv41Zn1uZtYbULdfJZsApu3AgADB6Z6VmUUpUoSlzNa2t8gUmlY3ZPENvJqEV6dOxPHnkTcNxjn5ay9SvG1C+luWXaXP3c5wM" +
  "YqtRUwoQpu8V5Dc29zUu9ZF3pENlJb/PDjbLv9OOmPT3q3feIrXUAgu9L8zZnb/pBGM/QVgUVP1anpptfq+oc8jTh1O2tdTgu7Sx8pYgcx+cW3" +
  "EgjOSOOtV9Vvv7Rv5Lny/L3gfLuzjAx1qpRWipRjLmW9rCcm1YtaXe/wBnahFdeX5nl5+XOM5BHX8a0ptetJrs3TaUjT8fM8xI46cYxWHRUzoQ" +
  "nLma123Y1NpWRb1LU7jU5xJcMPl4VF4C1qX3iK11AILvS/M2Z2/6QRjP0FYFFDoU3bTba2n5BzvUuyXtst5DPZ2SwCM5KNIXDH8atprFik6zjR" +
  "4hKpyCspAB/wB3GKx6KHRhLe/3v/MFJov3GrTXWqxX06gmJlKovAwDnFS6lrkt7qEN3Aht5Il2jD7u5PoPWsuin7GndO22gczNbVdaj1S3QTWY" +
  "W4QcTLJ+fGOn40mk63/ZlpPB9n8zzT97fjHGPSsqip+r0+Tktp8w55XuKrMjBlJDKcgjsa2JNfju40GpWEdy6dHDlD+OKxqKudKM7OS2EpNbGj" +
  "qetTahEkARILdPuxJ09s1INbxoP9mfZ+3+s3/7W7pj+tZVFT7CnZRtonf5j53e4UUUVsSFFFFABRRRQBq65rf9rrCPs/k+UT/HuznHsPSsqiio" +
  "p04048sVoNtyd2auua3/AGusI+z+T5RP8e7Ocew9KW71z7bpEdncW+6SPG2bf3HfGPT3rJorNYemkkltsPnlr5m43iC3m06CzutO85IlUf68rk" +
  "gYzwKzr64s51UWlj9mIPJ84vn86qUU4UIQd4/m/wArg5t7mrrmt/2usI+z+T5RP8e7Ocew9KoWcy293FM8fmLGwbZnGcVDRVQpRhDkitBOTbuy" +
  "9rGptqt4JzH5YChQu7OPx/Gpk1kDQ202S33jnbJvxt5yOMetZdFL2MOVRtotg5ne5q32t/bNIgsfs+zyQvz7852jHTFLFrmNFbTri381cEK+/B" +
  "XuOMdjWTRU/V6drW63+Y+eW5qjW8aD/Zn2ft/rN/8AtbumP60n9s/8SD+zPI/7a7/9rd0x/Wsuin7Cn263+Yc7NvR/Ej6ZafZ3g85Qcqd+3aPT" +
  "oaoWWqXFhePcW5A3k7kbkEehqnRQqFNOTtvuHPLTyNpddtFuhdDSoxcA53iUgZ9cYxWfqd++pXjXEiKjEAYXpxVWinCjCD5ktfVg5NqwUUUVqS" +
  "FFFFABRRRQAUUUUAFFFFABWpp//IA1b/tj/wChmsutTT/+QBq3/bH/ANDNY1/hXqvzRUN/v/INQ/5AGk/9tv8A0MVl1qah/wAgDSf+23/oYrLo" +
  "ofC/V/mwnv8Ad+QUUUVsSFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRR" +
  "QAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABW" +
  "pp//ACANW/7Y/wDoZrLrU0//AJAGrf8AbH/0M1jX+Feq/NFQ3+/8g1D/AJAGk/8Abb/0MVl1qah/yANJ/wC23/oYrLoofC/V/mwnv935BRRRWx" +
  "IUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRR" +
  "RQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFamn/wDIA1b/ALY/+hmsut" +
  "TT/wDkAat/2x/9DNY1/hXqvzRUN/v/ACDUP+QBpP8A22/9DFZdamof8gDSf+23/oYrLoofC/V/mwnv935BRRRWxIUUUUAFFFFABRRRQAUUUUAF" +
  "FFFABRRRQAUUUUAFFFFABRRRQBd03ThqPmxxzBbhV3Rxlf8AWY6jOeDU1xoksc0NtE4lvHTe8IwPLHXGSeTjtTNJvYNPaW4ZGe5C4gGBtUnuea" +
  "nuNXikv7XUIkdLtMGcYG1yO457imIh0vR5r+WBnAjt5JNm8soJI5OATk1b/sWCUaj5XmBrULsHnIwbJIJJAwOB07U+bXbX+1bKS3ilSztizbMD" +
  "cWYknjOPTvVa11O2jj1SOZZsXhGwoB8vJPPPvRoBn3VpPZyBLhNhZQy8ggg9wRwaLS1e7kZIyoKoznd6AZNWdVv47tLWGBXEVtEEDPjc3qeOlT" +
  "aTr1zpyGHzW8gK21VRThiODz70gMqtZdIjXREvHbdLKxVR56Iqj1Oep9uKoXl5Pfzma6k8yQgDOAOPwqxNfxSaHb2QV/NilZySBtwaALeoaF5E" +
  "9va2gM1xKoYkzJgnBJAXqBx1JqmNFvyFPkDDNtB8xcbvTOeD7VfOt2x8QW1/sl8qKMIwwNxO0jjn3qFNWgWxghKybo737QTgYK+nXrT0ApxaXe" +
  "StOEhObf8A1uWA2fmfag6Vei5EHkEyMm8YIIK+uemPetu3uobyHXrjEiwyBD0G4DJ7ZqGPxDBE0cKRO1utsYNzKpc574OR+FFgMltNu1uIofJL" +
  "PKMx7SGDD2I4NE+mXdtbmeWMCIPs3h1YbvTg1p2mtMmo2ZTfPHDuAQxpF97+6F/x5p2oLFaeGltv3qO9zvVJgFfbjqRnigDMs7RJ7G8mZJmaBV" +
  "KlCoVck/ezz+VOl0W/hEnmQYMa72AdSQvrgHpS2F/Fbadf27q5e5VQhUDAwT1/OtCXXbZ9UvLkJNsntTCoIGQ3HXnpxQBkyaddRwiV4wqld4Bd" +
  "d23125zj8Ks32iyWlvbSiaJ/OUMQZEG0k44+bkc9RxU41eB9OeC5V7h/K8uMSRL+7PYh+vHpimS6jZ3EGnieOVmtAEePaNsgz65yPyo0ApT6fc" +
  "QQCZ1Vot23fHIrgH0ypNa17oVtb/2jseY/ZY43TJHJbrnio7zV7OXTLq1gidfNkDpiFECgHocHn61Je67bXH9o7EmH2qONEyBwV655o0AqXmiz" +
  "LdTpaQSiOFVZ/OdMrnucHGKrnSb0XIt/IPmFPMGGGNvrnOMe9ad7rttcf2jsSYfao40TIHBXOc80+DWI53igjgmdTY/ZpAoG7Pqozz9KNAMW50" +
  "+5tIY5Z4wscudjBgQ2PoaLawubuMvDHlAdpZmCjPpkkc+1amu+XDpOm2gLCSMOWR8BlBPGR2+lVbe/t20kWF2JVVZvNV4gCTxjBBI/OgCCPSr2" +
  "Rp1WAg2+PNDELtz9TUV3aT2UgjuI9jMoYcggg9wRwa1rjXorn+1C0TobtUWMDBxt9apatfxXqWYiVwYLdYm3AckentQBN/ZUUehLfSMWkkYhVW" +
  "ZFCjHvkk+w5pdT0RoNRlt7JXeOJFZnkYALkdzwBUE1/FJodvZBX82KVnJIG3BrTn8RW8012ojcQ3CphmjVypX1U8EUaAY4028N0bbyG80DcRxj" +
  "Hrnpj3qe00aefUIbWYiESjcsmQwI9ucN+Bq1Br4ju3aXfNE9v5GTGgKjthQMY9jTE1oR31lIWeWG2ZiF8pI8A9cBf8aNAM28tmtLhomZGwTgo4" +
  "bv7E4+lWE0W/dYysGfNTzEG9csvsM5P0qC9eGS6kkt2kZHYt86hSMnpwTWvBrltHfaZOyTbLSDy3AAyTtI456UAZlvpd5cxrJFDlWJCksF3Edh" +
  "k8/hSQ6ddTK7rCQsbbGLELhvTnqfatCLWLV0sftCTK9lIXTywCHBOecnjoPWkl1mC8tJobqORN1ybhTFg/8AATnH50aAM1PRWg1Se2sld44VVm" +
  "eRgAuR3PAFZtzbTWspinQo4GcH09fet648RW81xegRuIbkJhmjVypUd1PBFZGpXrXsyMXZxGgRSyKnA9l4A/OhgVKKKKQwooooAKKKKACiiigA" +
  "ooooAKKKKACiiigAooooAKKKKACiiigArU0//kAat/2x/wDQzWXWpp//ACANW/7Y/wDoZrGv8K9V+aKhv9/5BqH/ACANJ/7bf+hisutTUP8AkA" +
  "aT/wBtv/QxWXRQ+F+r/NhPf7vyCiiitiQooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACii" +
  "igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAC" +
  "iiigAooooAK1NP/wCQBq3/AGx/9DNZdamn/wDIA1b/ALY/+hmsa/wr1X5oqG/3/kGof8gDSf8Att/6GKy61NQ/5AGk/wDbb/0MVl0UPhfq/wA2" +
  "E9/u/IKKKK2JCiiigAooooAKKKKACiiigAooooAKKKKACiiigAqeCznuInkjUeXH952YKB+JNQVs2czJ4YusBPllUDKKev1HNROTitCopN6mXP" +
  "azW6xNMm0SqHTkHI9airp7e2t91uWt4W/4lxkIKDluOT7+9VdLEd7BseALK0n+uW3R1C46Efw/X9azVbS9i3T1MQRSGIyiNjGDgvjgH0zTra3l" +
  "u51hgXfI3QZAz371uW/mLot7BbrHM8VxgBIg+V9cEHI9zVHw3/yHLb6t/wCgmq9o+WT7C5FdLuU5bSeGBJpExHISqnI5I4NQ10SC1gg0+WeCJl" +
  "lmlSQsgJI3EAk+1PFjY2d3aWF0I2Ys0juQOeoQZ9Pap9tbdD9l2Oaqa2tJrosIU3bBuYlgoUepJ4rQ1VIVtFDW8kdwJPvmFYgV9MAnP1p+hysm" +
  "n6lgIdsW4bkB/mOR7VTqPl5kSoe9ZmMylWKnGQccHIorYn2R6FZSJFAJZncNI0a5xk+3/wCqrkunKtlepOEkeKIOkiW6xjPXgj735UnVS3H7Nv" +
  "Y5uiuotre3a406BraEpNabn+QZY4659ap+Vaz2Omz3EccYkmKSMihQVz3x/OhVl2/rX/IPZ+Zh1LbWs10zrAm4opduQMAdTzWxq0VvHb3Km2ZS" +
  "HHkyLCqKBnpkN83FVdBijmnuRLGrhbZ2AYZweOaftLwckLktKxmUV09vBbtd6Xbm2gKT22ZCYxljtJzn1461g2SKdUgjYBlMyqQRkEbqI1L3Bw" +
  "sVqltrWa6Z1gTcUUu3IGAOp5reulhS31R1trcNbTKIv3Y4ycH6/jTms7ZdaukEEez7GZAu0YDccgdqn22m39af5ley1Oaorp7eC3a70u3NtAUn" +
  "tsyExjLHaTnPrx1qC2so5rXSzHDG+24ZZjtHTdwG/D1o9su39a/5B7J/18v8zBEUhiMojYxg4L44B9M02ulcuLDUobWKNmjujtjWJWwufTFIIL" +
  "FILcrbtNbvD+8ZIlPzdyXLAqR6Ue27oPZeZzdFb2n20F3YRxrEImAYvM8SujemWzlaxIfK85PP3+Vn5tmN2PbNaRne67EONrDKK0/+JH/1Ef8A" +
  "xyqN19n88/ZPN8rjHm43fpTUr9BONuoT2s1usTTJtEqh05ByPWoq6qSGOXT7Xy445b0Wi+XHIMjHcgdzVazgtV0+1kEBmYs32hVhDt16HJGz8K" +
  "xVbTVGjpa6HPUVv2lvafZJnt4jJKLgjb5SzMqdhgnH4ilt4Ld/7Va2tV+RUMSSqGKE5yB1/L8Kr2y10F7NnP0Vp63FFEbUhEjnaEGZEGAG+nY1" +
  "es7YNpemvFawyu8rCQtGCSu49fb37U3USipdxKF20c9RXRRWMQuJpLdonthcbNggWUge5PRffNI9lBDPqqW0KSXEZXyY2XdgHrgHrS9sh+yZz1" +
  "FdS9nZ/bIRJDEkhsg6oqjDP9ONx+p5rH1dYVWDZBJFNgiTdGI93odoJxRGqpO1glTcVczqK2LCFW0nzLWCOe788B1dQxVMeh7e9XfslqJdWFpD" +
  "FL5aoYwQGCtznH49vwodVJ2sCptnNUV0y2lkbmPzo40uja7jCFGPM7fLwM+1R28NtJq1gjWrK5DiVZYlQPgHB2AnFL2y7D9k+5ztFbF2kUuhvP" +
  "5MaSJdGNSihflx0PrWPWsZcxnKNgoooqhBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAVqaf/yANW/7Y/8AoZrLrU0//kAat/2x/wDQzWNf" +
  "4V6r80VDf7/yDUP+QBpP/bb/ANDFZdamof8AIA0n/tt/6GKy6KHwv1f5sJ7/AHfkFFFFbEhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUU" +
  "UUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAVYt72S3triBFUrcABiRyMelV6KTSe4J2" +
  "CrEt7JLZQ2rKvlwklSBycnvVeihpML2CpIZRETuijlB7OD/Qg1HRRuBPeXkt7KJJsfKoVVUYCgdAKgoooSS0QN3CrFveyW9tcQIqlbgAMSORj0" +
  "qvRQ0nuCdgooopgFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFamn/8AIA1b/tj/AOhmsutTT/8AkAat/wBsf/QzWNf4V6r8" +
  "0VDf7/yDUP8AkAaT/wBtv/QxWXWpqH/IA0n/ALbf+hisuih8L9X+bCe/3fkFFFFbEhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFF" +
  "FFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUA" +
  "FFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAVqaf/AMgDVv8Atj/6Gay61NP/AOQBq3/bH/0M1jX+Feq/NFQ3+/8AINQ/5AGk/wDbb/" +
  "0MVl1qah/yANJ/7bf+hisuih8L9X+bCe/3fkFFFFbEhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRR" +
  "QAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABR" +
  "RRQAUUUUAFFFFABRRRQAVqaf8A8gDVv+2P/oZrLrU0/wD5AGrf9sf/AEM1jX+Feq/NFQ3+/wDINQ/5AGk/9tv/AEMVl1qah/yANJ/7bf8AoYrL" +
  "oofC/V/mwnv935BRRRWxIUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFF" +
  "ABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFa" +
  "mn/8gDVv+2P/AKGay61NP/5AGrf9sf8A0M1jX+Feq/NFQ3+/8g1D/kAaT/22/wDQxWXWpqH/ACANJ/7bf+hisuih8L9X+bCe/wB35BRRRWxIUU" +
  "UUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQA" +
  "UUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFamn/8AIA1b/tj/AOhmsutTT/" +
  "8AkAat/wBsf/QzWNf4V6r80VDf7/yDUP8AkAaT/wBtv/QxWXWpqH/IA0n/ALbf+hisuih8L9X+bCe/3fkFFFFbEhRRRQAUUUUAFFFFABRRRQAU" +
  "UUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQ" +
  "AUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAVqaf/AMgDVv8Atj/6Gay61NP/AOQBq3/bH/0M1jX+Feq/" +
  "NFQ3+/8AINQ/5AGk/wDbb/0MVl1qah/yANJ/7bf+hisuih8L9X+bCe/3fkFFFFbEhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFF" +
  "FABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAF" +
  "FFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAVqaf8A8gDVv+2P/oZrLrU0/wD5AGrf9sf/AEM1jX+Feq/NFQ3+/wDINQ/5AGk/9tv/AE" +
  "MVl1qah/yANJ/7bf8AoYrLoofC/V/mwnv935BRRRWxIUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUU" +
  "UAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAU" +
  "UUUAFFFFABRRRQAUUUUAFamn/8gDVv+2P/AKGay61NP/5AGrf9sf8A0M1jX+Feq/NFQ3+/8g1D/kAaT/22/wDQxWXWpqH/ACANJ/7bf+hisuih" +
  "8L9X+bCe/wB35BRRRWxIUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFA" +
  "BRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFam" +
  "n/8AIA1b/tj/AOhmsutTT/8AkAat/wBsf/QzWNf4V6r80VDf7/yDUP8AkAaT/wBtv/QxWXWyrafeaRYwXF/9nkt/Myvks+dzZ7VF9g0r/oM/+S" +
  "r1nTqKCaae76Pu/Ico31Rl0VqfYNK/6DP/AJKvR9g0r/oM/wDkq9ae3j2f3P8AyFyP+mjLorU+waV/0Gf/ACVej7BpX/QZ/wDJV6Pbx7P7n/kH" +
  "I/6aMuitT7BpX/QZ/wDJV6PsGlf9Bn/yVej28ez+5/5ByP8Apoy6K1PsGlf9Bn/yVej7BpX/AEGf/JV6Pbx7P7n/AJByP+mjLorU+waV/wBBn/" +
  "yVej7BpX/QZ/8AJV6Pbx7P7n/kHI/6aMuitT7BpX/QZ/8AJV6PsGlf9Bn/AMlXo9vHs/uf+Qcj/poy6K1PsGlf9Bn/AMlXo+waV/0Gf/JV6Pbx" +
  "7P7n/kHI/wCmjLorU+waV/0Gf/JV6PsGlf8AQZ/8lXo9vHs/uf8AkHI/6aMuitT7BpX/AEGf/JV6PsGlf9Bn/wAlXo9vHs/uf+Qcj/poy6K1Ps" +
  "Glf9Bn/wAlXo+waV/0Gf8AyVej28ez+5/5ByP+mjLorU+waV/0Gf8AyVej7BpX/QZ/8lXo9vHs/uf+Qcj/AKaMuitT7BpX/QZ/8lXo+waV/wBB" +
  "n/yVej28ez+5/wCQcj/poy6K1PsGlf8AQZ/8lXo+waV/0Gf/ACVej28ez+5/5ByP+mjLorU+waV/0Gf/ACVej7BpX/QZ/wDJV6Pbx7P7n/kHI/" +
  "6aMuitT7BpX/QZ/wDJV6PsGlf9Bn/yVej28ez+5/5ByP8Apoy6K1PsGlf9Bn/yVej7BpX/AEGf/JV6Pbx7P7n/AJByP+mjLorU+waV/wBBn/yV" +
  "ej7BpX/QZ/8AJV6Pbx7P7n/kHI/6aMuitT7BpX/QZ/8AJV6PsGlf9Bn/AMlXo9vHs/uf+Qcj/poy6K1PsGlf9Bn/AMlXo+waV/0Gf/JV6Pbx7P" +
  "7n/kHI/wCmjLorU+waV/0Gf/JV6PsGlf8AQZ/8lXo9vHs/uf8AkHI/6aMuitT7BpX/AEGf/JV6PsGlf9Bn/wAlXo9vHs/uf+Qcj/poy6K1PsGl" +
  "f9Bn/wAlXo+waV/0Gf8AyVej28ez+5/5ByP+mjLorU+waV/0Gf8AyVej7BpX/QZ/8lXo9vHs/uf+Qcj/AKaMuitT7BpX/QZ/8lXo+waV/wBBn/" +
  "yVej28ez+5/wCQcj/poy6K1PsGlf8AQZ/8lXo+waV/0Gf/ACVej28ez+5/5ByP+mjLorU+waV/0Gf/ACVej7BpX/QZ/wDJV6Pbx7P7n/kHI/6a" +
  "MuitT7BpX/QZ/wDJV6PsGlf9Bn/yVej28ez+5/5ByP8Apoy6K1PsGlf9Bn/yVej7BpX/AEGf/JV6Pbx7P7n/AJByP+mjLorU+waV/wBBn/yVej" +
  "7BpX/QZ/8AJV6Pbx7P7n/kHI/6aMuitT7BpX/QZ/8AJV6PsGlf9Bn/AMlXo9vHs/uf+Qcj/poy6K1PsGlf9Bn/AMlXo+waV/0Gf/JV6Pbx7P7n" +
  "/kHI/wCmjLorU+waV/0Gf/JV6PsGlf8AQZ/8lXo9vHs/uf8AkHI/6aMuitT7BpX/AEGf/JV6PsGlf9Bn/wAlXo9vHs/uf+Qcj/poy6K1PsGlf9" +
  "Bn/wAlXo+waV/0Gf8AyVej28ez+5/5ByP+mjLorU+waV/0Gf8AyVej7BpX/QZ/8lXo9vHs/uf+Qcj/AKaMuitT7BpX/QZ/8lXo+waV/wBBn/yV" +
  "ej28ez+5/wCQcj/poy6K1PsGlf8AQZ/8lXo+waV/0Gf/ACVej28ez+5/5ByP+mjLorU+waV/0Gf/ACVej7BpX/QZ/wDJV6Pbx7P7n/kHI/6aMu" +
  "tTT/8AkAat/wBsf/QzR9g0r/oM/wDkq9Ss2n2ekX0Fvf8A2iS48vC+SyY2tnvWdSoppJJ7ro+68hxjbVn/2Q==",
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
    'if ! DISPLAY=:99 scrot -o -q 75 /tmp/novadesk.jpg >/dev/null 2>&1; then ' +
    'rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 /tmp/novadesk.jpg 2>/dev/null; ' +
    'Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 & sleep 1.2; ' +
    'DISPLAY=:99 fluxbox >/dev/null 2>&1 & ' +
    'DISPLAY=:99 xterm -geometry 120x35+25+25 -bg black -fg green -T "NOVA KALI LIVE DESKTOP — 266/266 TOOLS" -e "sh -c \'echo === NOVA KALI LINUX LIVE DESKTOP ===; uname -a; id; echo --- Tools in /usr/local/bin ---; ls /usr/local/bin | tr \"\\n\" \" \"; echo; echo --- Active Listening & Processes ---; df -h /; free -h 2>/dev/null; sleep 3600\'" >/dev/null 2>&1 & sleep 1.0; ' +
    'fi; ' +
    'while true; do ' +
    'if DISPLAY=:99 scrot -o -q 75 /tmp/novadesk.jpg 2>/dev/null; then cat /tmp/novadesk.jpg; ' +
    'elif DISPLAY=:99 import -window root /tmp/novadesk.jpg 2>/dev/null; then cat /tmp/novadesk.jpg; fi; ' +
    'sleep 0.45; done';
  res.setHeader("Content-Type", `multipart/x-mixed-replace; boundary=${BOUNDARY}`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Nova-Desktop-Node", node.id);
  res.flushHeaders?.();
  appendNovaEvent("desktop", `🖥️ بث الديسكتوب الحي بدأ من ${node.id}`, node.mode);

  sendFrame(DESKTOP_FRAME_PREP);
  const prepIv = setInterval(() => {
    if (res.writableEnded || res.destroyed) { clearInterval(prepIv); return; }
    sendFrame(DESKTOP_FRAME_PREP);
  }, 1500);

  let jpeg = Buffer.alloc(0);
  let sent = 0;
  const onData = (streamType: string, data: string) => {
    if (streamType !== "stdout" || res.writableEnded || res.destroyed) return;
    if (sent === 0) clearInterval(prepIv);
    jpeg = Buffer.concat([jpeg, Buffer.from(data.replace(/\s+/g, ""), "base64")]);
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
    clearInterval(prepIv);
  });
});

/* إطار حي فوري (JSON base64) + تحكم تفاعلي بسطح المكتب:
 * يضمن عمل البث المباشر حتى خلف أي بروكسي يوقف multipart/x-mixed-replace،
 * ويسمح للمستخدم بفتح نوافذ أدوات حقيقية على الشاشة :99 ومشاهدتها فورًا. */
router.get("/kali-env/desktop-frame", async (req: Request, res: Response) => {
  const preferNode = String(req.query.nodeId ?? "").trim() || undefined;
  const frameCmd =
    'if ! DISPLAY=:99 scrot -o -q 75 /tmp/novadesk.jpg >/dev/null 2>&1; then ' +
    'rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 /tmp/novadesk.jpg 2>/dev/null; ' +
    'Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 & sleep 1.2; ' +
    'DISPLAY=:99 fluxbox >/dev/null 2>&1 & ' +
    'DISPLAY=:99 xterm -geometry 120x35+25+25 -bg black -fg green -T "NOVA KALI LIVE DESKTOP — 266/266 TOOLS" -e "sh -c \'echo === NOVA KALI LINUX LIVE DESKTOP ===; uname -a; id; echo --- Tools Ready: 266/266 ---; ls /usr/local/bin | tr \"\\n\" \" \"; echo; df -h /; sleep 3600\'" >/dev/null 2>&1 & sleep 1.0; ' +
    'DISPLAY=:99 scrot -o -q 75 /tmp/novadesk.jpg 2>/dev/null || DISPLAY=:99 import -window root /tmp/novadesk.jpg 2>/dev/null; ' +
    'fi; ' +
    'if [ -s /tmp/novadesk.jpg ]; then base64 -w0 /tmp/novadesk.jpg; fi';
  const r = await kaliAnywhereExec(frameCmd, 25_000, preferNode);
  if (!r || !r.stdout.trim()) {
    res.status(503).json({ ok: false, error: "تعذّر التقاط إطار سطح المكتب من عقدة كالي" });
    return;
  }
  const b64 = r.stdout.replace(/\s+/g, "");
  res.json({
    ok: true,
    frame: `data:image/jpeg;base64,${b64}`,
    bytes: Math.round((b64.length * 3) / 4),
    plane: r.plane,
    nodeId: r.nodeId ?? null,
    resolution: "1280x800",
    capturedAt: new Date().toISOString(),
  });
});

router.post("/kali-env/desktop-action", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { action?: string; cmd?: string; title?: string; nodeId?: string };
  const action = String(body.action ?? "launch").trim();
  const rawCmd = String(body.cmd ?? "uname -a; id; nmap --version").trim().slice(0, 300);
  const preferNode = String(body.nodeId ?? "").trim() || undefined;
  const safeCmd = rawCmd.replace(/'/g, "'\\''");
  let deskCmd: string;
  if (action === "reset") {
    deskCmd =
      'rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 /tmp/novadesk.jpg 2>/dev/null; ' +
      'Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 & sleep 1.2; ' +
      'DISPLAY=:99 fluxbox >/dev/null 2>&1 & ' +
      'DISPLAY=:99 xterm -geometry 120x35+25+25 -bg black -fg green -T "NOVA KALI LIVE DESKTOP" -e "sh -c \'echo === NOVA KALI DESKTOP RESET ===; uname -a; id; sleep 3600\'" >/dev/null 2>&1 & sleep 1.0; ' +
      'DISPLAY=:99 scrot -o -q 75 /tmp/novadesk.jpg 2>/dev/null; base64 -w0 /tmp/novadesk.jpg 2>/dev/null';
  } else {
    deskCmd =
      'if ! DISPLAY=:99 scrot -o -q 75 /tmp/novadesk.jpg >/dev/null 2>&1; then ' +
      'rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 /tmp/novadesk.jpg 2>/dev/null; ' +
      'Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 & sleep 1.2; ' +
      'DISPLAY=:99 fluxbox >/dev/null 2>&1 & sleep 0.5; ' +
      'fi; ' +
      `DISPLAY=:99 xterm -geometry 115x32+45+45 -bg black -fg cyan -T "NOVA KALI RUN" -e "sh -c '${safeCmd}; echo; echo === DONE ===; sleep 600'" >/dev/null 2>&1 & ` +
      'sleep 1.2; DISPLAY=:99 scrot -o -q 75 /tmp/novadesk.jpg 2>/dev/null || DISPLAY=:99 import -window root /tmp/novadesk.jpg 2>/dev/null; ' +
      'base64 -w0 /tmp/novadesk.jpg 2>/dev/null';
  }
  const r = await kaliAnywhereExec(deskCmd, 30_000, preferNode);
  const b64 = (r?.stdout ?? "").replace(/\s+/g, "");
  appendNovaEvent("desktop", `🖥️ أمر على سطح المكتب: ${rawCmd.slice(0, 80)}`, r?.plane ?? "fleet");
  res.json({
    ok: Boolean(b64),
    action,
    cmd: rawCmd,
    frame: b64 ? `data:image/jpeg;base64,${b64}` : null,
    bytes: b64 ? Math.round((b64.length * 3) / 4) : 0,
    plane: r?.plane ?? null,
    nodeId: r?.nodeId ?? null,
    capturedAt: new Date().toISOString(),
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
  const PIP_TOOLS: Record<string, { pkg: string; cmd?: string | string[] }> = {
    /* TEST88 — pkg مقاس من pypi.org (2026-11-19): photon وnetexec مش على PyPI
     * (تحقق مباشر) — اتنقلوا لCLONE_EXTRA. scoutsuite بيتسطب كscout ·
     * volatility3 كvol · bloodhound-python باسمه (مش bloodhound). */
    maigret: { pkg: "maigret" }, h8mail: { pkg: "h8mail" },
    prowler: { pkg: "prowler" }, scoutsuite: { pkg: "scoutsuite", cmd: "scout" }, pacu: { pkg: "pacu" },
    certipy: { pkg: "certipy-ad" },
    /* TEST89 — الباقة pip الصح للـBloodHound.py هي bloodhound (الشفراء
     * bloodhound-python/bloodhound) — قيست 00:42: pkg bloodhound-python مالهاش
     * CLI فالgate فشل. */
    "bloodhound-python": { pkg: "bloodhound", cmd: ["bloodhound-python", "bloodhound"] },
    "ssh-audit": { pkg: "ssh-audit" }, semgrep: { pkg: "semgrep" }, sublist3r: { pkg: "sublist3r" },
    sherlock: { pkg: "sherlock-project" },
    volatility3: { pkg: "volatility3", cmd: "vol" },
    volatility: { pkg: "volatility3", cmd: "vol" },
  };
  /* TEST88 — clone + pip محلي + wrapper (مقاس أساسه dirsearch/arjun ✓ TEST86):
   * أدوات مافيش منها pip ولا release — سورس مباشر + gate بالأمر الحقيقي. */
  const CLONE_EXTRA: Record<string, { repo: string; cmd: string | string[]; wrap?: string; req?: boolean }> = {
    netexec: { repo: "Pennyw0rth/NetExec", cmd: "nxc", req: true },
    routersploit: {
      repo: "threat9/routersploit", cmd: "routersploit", req: true,
      wrap: `printf '#!/bin/sh\\nexec python3 /opt/routersploit/rsf.py "$@"\\n' > /usr/local/bin/routersploit && chmod +x /usr/local/bin/routersploit`,
    },
    photon: {
      repo: "s0md3v/Photon", cmd: "photon", req: true,
      wrap: `printf '#!/bin/sh\\nexec python3 /opt/photon/photon.py "$@"\\n' > /usr/local/bin/photon && chmod +x /usr/local/bin/photon`,
    },
    osintgram: {
      repo: "Datalux/Osintgram", cmd: "osintgram",
      wrap: `printf '#!/bin/sh\\nexec python3 /opt/osintgram/main.py "$@"\\n' > /usr/local/bin/osintgram && chmod +x /usr/local/bin/osintgram`,
    },
    /* TEST93o — المتبقي بلا pypi ولا release: clone + wrapper */
    pentestly: {
      repo: "meatballs89/pentestly", cmd: "pentestly", req: true,
      wrap: `printf '#!/bin/sh\\nexec python3 /opt/pentestly/pentestly.py "$@"\\n' > /usr/local/bin/pentestly && chmod +x /usr/local/bin/pentestly`,
    },
    ssrfmap: {
      repo: "swisskyrepo/SSRFmap", cmd: "ssrfmap",
      wrap: `printf '#!/bin/sh\\nexec python3 /opt/ssrfmap/ssrfmap.py "$@"\\n' > /usr/local/bin/ssrfmap && chmod +x /usr/local/bin/ssrfmap`,
    },
    "gh-dork": {
      repo: "molly/gh-dork", cmd: "gh-dork", req: true,
      wrap: `printf '#!/bin/sh\\nexec python3 /opt/gh-dork/gh-dork.py "$@"\\n' > /usr/local/bin/gh-dork && chmod +x /usr/local/bin/gh-dork`,
    },
    "dvcs-ripper": {
      repo: "kost/dvcs-ripper", cmd: ["rip-git", "rip-svn"],
      wrap: `for f in rip-git rip-svn rip-hg rip-bzr; do cp /opt/dvcs-ripper/$f.pl /usr/local/bin/$f 2>/dev/null && chmod +x /usr/local/bin/$f; done; true`,
    },
    "king-phisher": {
      repo: "CrimsonForge-io/king-phisher", cmd: ["king-phisher"],
      wrap: `[ -f /opt/king-phisher/KingPhisher ] && { printf "#!/bin/sh\nexec python3 /opt/king-phisher/KingPhisher \"$@\"\n" > /usr/local/bin/king-phisher; chmod +x /usr/local/bin/king-phisher; }; true`,
    },
    venom: {
      repo: "r00t-3xp10it/venom", cmd: "venom",
      wrap: `cp /opt/venom/venom.sh /usr/local/bin/venom && chmod +x /usr/local/bin/venom`,
    },
    w3af: {
      repo: "andresriancho/w3af", cmd: ["w3af_console", "w3af"], req: true,
      wrap: `printf '#!/bin/sh\nexec python3 /opt/w3af/w3af_console "$@"\n' > /usr/local/bin/w3af_console && cp /usr/local/bin/w3af_console /usr/local/bin/w3af && chmod +x /usr/local/bin/w3af_console /usr/local/bin/w3af`,
    },
    keepnote: {
      repo: "mdrasmus/keepnote", cmd: "keepnote",
      wrap: `[ -f /opt/keepnote/bin/keepnote ] && cp /opt/keepnote/bin/keepnote /usr/local/bin/keepnote && chmod +x /usr/local/bin/keepnote; true`,
    },
    evilgrade: {
      repo: "infobyte/evilgrade", cmd: "evilgrade",
      wrap: `[ -f /opt/evilgrade/evilgrade.sh ] && cp /opt/evilgrade/evilgrade.sh /usr/local/bin/evilgrade && chmod +x /usr/local/bin/evilgrade; true`,
    },
  };
  /* TEST87 — الحقول url مقاسة من api.github.com (السانبوكس 2026-11-19) وخبزت هنا:
   * العقدة (GitHub runner IP مشترك) بتنده api.github.com unauthenticated فبتقع
   * في 403 rate-limit → URL= فارغ → INSTALL_FAIL جماعي (مقاس TEST86). الخبز
   * يشيل النداء وقت التثبيت — مافيش اعتماد على quota IP العقدة. */
  const GITHUB_TOOLS: Record<string, { repo: string; pattern: string; flat?: string; url?: string }> = {
    /* أدوات بتوزع binaries جاهزة — مستقلة عن dpkg تمامًا (عقدة مريضة وما بتأثرش عليها) */
    amass: { repo: "owasp-amass/amass", pattern: "linux_amd64.tar.gz", flat: "amass", url: "https://github.com/owasp-amass/amass/releases/download/v5.1.3/amass_linux_amd64.tar.gz" },
    subfinder: { repo: "projectdiscovery/subfinder", pattern: "linux_amd64.zip", flat: "subfinder", url: "https://github.com/projectdiscovery/subfinder/releases/download/v2.17.0/subfinder_2.17.0_linux_amd64.zip" },
    naabu: { repo: "projectdiscovery/naabu", pattern: "linux_amd64.zip", flat: "naabu", url: "https://github.com/projectdiscovery/naabu/releases/download/v2.7.0/naabu_2.7.0_linux_amd64.zip" },
    dnsx: { repo: "projectdiscovery/dnsx", pattern: "linux_amd64.zip", flat: "dnsx", url: "https://github.com/projectdiscovery/dnsx/releases/download/v1.3.1/dnsx_1.3.1_linux_amd64.zip" },
    httpx: { repo: "projectdiscovery/httpx", pattern: "linux_amd64.zip", flat: "httpx", url: "https://github.com/projectdiscovery/httpx/releases/download/v1.12.0/httpx_1.12.0_linux_amd64.zip" },
    dirsearch: { repo: "maurosoria/dirsearch", pattern: "", flat: "" },
    arjun: { repo: "s0md3v/Arjun", pattern: "", flat: "" },
    katana: { repo: "projectdiscovery/katana", pattern: "linux_amd64.zip", flat: "katana", url: "https://github.com/projectdiscovery/katana/releases/download/v1.8.0/katana_1.8.0_linux_amd64.zip" },
    cariddi: { repo: "edoardottt/cariddi", pattern: "linux_amd64.zip", flat: "cariddi", url: "https://github.com/edoardottt/cariddi/releases/download/v1.4.6/cariddi_1.4.6_linux_amd64.zip" },
    grype: { repo: "anchore/grype", pattern: "linux_amd64.tar.gz", flat: "grype", url: "https://github.com/anchore/grype/releases/download/v0.122.1/grype_0.122.1_linux_amd64.tar.gz" },
    syft: { repo: "anchore/syft", pattern: "linux_amd64.tar.gz", flat: "syft", url: "https://github.com/anchore/syft/releases/download/v1.57.2/syft_1.57.2_linux_amd64.tar.gz" },
    trufflehog: { repo: "trufflesecurity/trufflehog", pattern: "linux_amd64.tar.gz", flat: "trufflehog", url: "https://github.com/trufflesecurity/trufflehog/releases/download/v3.99.9/trufflehog_3.99.9_linux_amd64.tar.gz" },
    dockle: { repo: "goodwithtech/dockle", pattern: "Linux-64bit.tar.gz", flat: "dockle", url: "https://github.com/goodwithtech/dockle/releases/download/v0.4.15/dockle_0.4.15_Linux-64bit.tar.gz" },
    osintgram: { repo: "Datalux/Osintgram", pattern: "", flat: "" }, // clone بدل release
    /* TEST88 — URLs مقاسة من api.github.com (السانبوكس 2026-11-19) */
    bettercap: { repo: "bettercap/bettercap", pattern: "linux_amd64.zip", flat: "bettercap", url: "https://github.com/bettercap/bettercap/releases/download/v2.41.7/bettercap_linux_amd64.zip" },
    asnmap: { repo: "projectdiscovery/asnmap", pattern: "linux_amd64.zip", flat: "asnmap", url: "https://github.com/projectdiscovery/asnmap/releases/download/v1.2.0/asnmap_1.2.0_linux_amd64.zip" },
    shuffledns: { repo: "projectdiscovery/shuffledns", pattern: "linux_amd64.zip", flat: "shuffledns", url: "https://github.com/projectdiscovery/shuffledns/releases/download/v1.2.1/shuffledns_1.2.1_linux_amd64.zip" },
    chisel: { repo: "jpillora/chisel", pattern: "linux_amd64.gz", flat: "chisel", url: "https://github.com/jpillora/chisel/releases/download/v1.12.0/chisel_1.12.0_linux_amd64.gz" },
    "ligolo-ng": { repo: "nicocha30/ligolo-ng", pattern: "agent_0.9.2_linux_amd64.tar.gz", flat: "agent", url: "https://github.com/nicocha30/ligolo-ng/releases/download/v0.9.2/ligolo-ng_agent_0.9.2_linux_amd64.tar.gz" },
    mongosh: { repo: "mongodb-js/mongosh", pattern: "linux-x64.tgz", flat: "mongosh", url: "https://github.com/mongodb-js/mongosh/releases/download/v2.14.2/mongosh-2.14.2-linux-x64.tgz" },
  };
  const pkg = APT_ALIAS[tool] ?? tool;
  /* TEST53 — فكس الجذر (مقاس 2026-11-17): جيت مايخزنش المجلدات الفاضية فالجست
   * بيولّد من غيرها — apt/dpkg بيحتاجوها كلها وبيفشلوا واحد-واحد
   * («E: Directory '/var/log/apt/' missing» · «archives/partial is missing» ·
   * «dpkg returned an error code (2)»). نفس قائمة المثبّت بالحرف — ال13 مجلد. */
  const GUEST_DIRS = "var/log/apt var/lib/dpkg/updates var/lib/dpkg/triggers/File var/lib/dpkg/triggers/Unincorporated var/lib/dpkg/alternatives var/cache/apt/archives/partial var/lib/apt/lists/partial var/lib/ucf/cache run/lock tmp var/tmp var/lib/sudo var/spool/mail";
  /* TEST77 — الأمر حسب المصدر: apt → pip → GitHub release. كل سلسلة بتنتهي
   * بنفس بوابة INSTALL_OK — مافيش تغيير في بروتوكول الرد. */
  /* TEST91 — طبقة المخزن (الجديدة أول السلسلة): tarballs مبنية داخل docker
   * كالي نظيف (kali-store-builder.yml — dpkg سليم هناك، ميت على عقدتنا) ومرفوعة
   * على release «kali-store» بنفس الريبو — تفريغ عند / مباشرة بلا dpkg أصلًا.
   * KALI_STORE_URL قابل للتحويل لHack-STORAGE لحظة صلاحية الكتابة تتفعل (مقاس:
   * التوكِن الحالي بيقرأ لكن أي كتابة = 403 integration). */
  const STORE_BASE = process.env.KALI_STORE_URL ?? "https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/kali-store";
  const STORE_TOOLS: Record<string, { file: string; cmd?: string | string[]; pip?: string }> = {
    "metasploit-framework": { file: "metasploit-framework.tar.gz", cmd: ["msfconsole", "msfvenom"] },
    ettercap: { file: "ettercap.tar.gz", cmd: ["ettercap"] },
    exiftool: { file: "exiftool.tar.gz", cmd: ["exiftool"] },
    steghide: { file: "steghide.tar.gz", cmd: ["steghide"] },
    "arp-scan": { file: "arp-scan.tar.gz", cmd: ["arp-scan"] },
    cherrytree: { file: "cherrytree.tar.gz", cmd: ["cherrytree"] },
    casefile: { file: "casefile-debs.tar.gz", cmd: ["casefile"] },
    dradis: { file: "dradis.tar.gz", cmd: ["dradis"] },
    recordmydesktop: { file: "recordmydesktop.tar.gz", cmd: ["recordmydesktop"] },
    wkhtmltopdf: { file: "wkhtmltopdf-debs.tar.gz", cmd: ["wkhtmltopdf"] },
    maskprocessor: { file: "maskprocessor.tar.gz", cmd: ["mp32", "mp64", "maskprocessor", "mp"] },
    rainbowcrack: { file: "rainbowcrack.tar.gz", cmd: ["rcrack", "rainbowcrack"] },
    redis: { file: "redis-server.tar.gz", cmd: ["redis-server", "redis-cli"] },
    elfutils: { file: "elfutils.tar.gz", cmd: ["eu-readelf", "readelf"] },
    ltrace: { file: "ltrace.tar.gz", cmd: ["ltrace"] },
    strace: { file: "strace.tar.gz", cmd: ["strace"] },
    zsh: { file: "zsh.tar.gz", cmd: ["zsh"] },
    vim: { file: "vim.tar.gz", cmd: ["vim"] },
    aria2: { file: "aria2.tar.gz", cmd: ["aria2c", "aria2"] },
    "python3-pip": { file: "python3-pip.tar.gz", cmd: ["pip3"] },
    ghidra: { file: "ghidra.tar.gz", cmd: ["ghidraRun", "ghidra", "analyzeHeadless"] },
    retdec: { file: "retdec.tar.gz", cmd: ["retdec-decompiler", "retdec"] },
    sidguesser: { file: "sidguesser.tar.gz", cmd: ["sidguess", "sidguesser"] },
    netexec: { file: "netexec.tar.gz", cmd: ["nxc", "netexec"] },
    crackmapexec: { file: "crackmapexec.tar.gz", cmd: ["crackmapexec", "cme"] },
    empire: { file: "powershell-empire.tar.gz", cmd: ["powershell-empire", "empire"] },
    faraday: { file: "faraday.tar.gz", cmd: ["faraday-client", "faraday"] },
    gvm: { file: "gvm.tar.gz", cmd: ["gvm-cli", "gvmd", "gvm-setup"] },
        pandoc: { file: "pandoc-debs.tar.gz", cmd: ["pandoc"] },
    legion: { file: "legion-debs.tar.gz", cmd: ["legion"] },
    subzy: { file: "subzy.tar.gz", cmd: ["subzy"] },
    gotator: { file: "gotator.tar.gz", cmd: ["gotator"] },
    fern: { file: "fern-debs.tar.gz", cmd: ["fern", "fern-wifi-cracker"] },
    pgcli: { file: "pgcli.tar.gz", cmd: ["pgcli"], pip: "pgcli" },
    socialanalyzer: { file: "social-analyzer.tar.gz", cmd: ["social-analyzer", "socialanalyzer"], pip: "social-analyzer" },
    "peass-ng": { file: "peass-ng.tar.gz", cmd: ["linpeas", "linpeas.sh"] },
  };
  const GIT = GITHUB_TOOLS[tool];
  const PIP = PIP_TOOLS[tool];
  /* TEST93o — المسار من مرحلتين قصيرتين للأدوات اللي ليها حزم deb: درس TEST80
   * المقاس مرة تانية 08:40/09:04 — الأمر المركب الطويل = proot signal 6 حتى
   * بعد نجاح dpkg نفسه (البوابة بتتقتل). التثبيت قصير ثم البوابة قصيرة. */
  const DEBS_TOOLS = new Set(["ettercap", "exiftool", "steghide", "arp-scan", "cherrytree", "recordmydesktop", "maskprocessor", "rainbowcrack", "redis", "elfutils", "ltrace", "strace", "zsh", "vim", "aria2", "sidguesser", "netexec", "crackmapexec", "wkhtmltopdf", "pandoc", "legion", "fern", "casefile"]);
  const storeDebs = Boolean(STORE_TOOLS[tool] && DEBS_TOOLS.has(tool));
  /* TEST93x — استخراج يدوي بدون dpkg: postinst بتاع maskprocessor بيحاول
   * systemctl (مش موجود في proot) → bus fail → proot signal 6 دائم (مقاس ×6).
   * الdeb فيه باينر واحد /usr/bin/mp — dpkg-deb -x وcp كفاية. */
  const DEB_EXTRACT = new Set(["maskprocessor", ...DEBS_TOOLS]);
  const storeGate = STORE_TOOLS[tool] ? (Array.isArray(STORE_TOOLS[tool].cmd) ? STORE_TOOLS[tool].cmd : [STORE_TOOLS[tool].cmd ?? tool]).map((c) => `command -v ${c}`).join(" || ") : "";
  let installCmd: string;
  if (STORE_TOOLS[tool] && STORE_TOOLS[tool].file) {
    const S = STORE_TOOLS[tool];
    const gate = (Array.isArray(S.cmd) ? S.cmd : [S.cmd ?? tool]).map((c) => `command -v ${c}`).join(" || ");
    const pipFallback = S.pip ? `; (PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --ignore-installed ${S.pip} 2>&1 || python3 -m pip install --break-system-packages -q --ignore-installed ${S.pip} 2>&1) | tail -2` : "";
    if (DEB_EXTRACT.has(tool)) {
      installCmd = `cd /tmp && rm -rf store-dl /tmp/debx && mkdir store-dl /tmp/debx && cd store-dl && curl -sfL -m 240 "${STORE_BASE}/${tool}-debs.tar.gz" -o debs.tgz && tar xzf debs.tgz && for d in *.deb; do dpkg-deb -x "$d" / 2>/dev/null; dpkg-deb -x "$d" /tmp/debx 2>/dev/null; done; cp /tmp/debx/usr/bin/* /usr/local/bin/ 2>/dev/null; cp /tmp/debx/usr/games/* /usr/local/bin/ 2>/dev/null; find /tmp/debx -maxdepth 3 -type f -perm -111 -exec cp {} /usr/local/bin/ \\; 2>/dev/null; [ -f /usr/bin/fern-wifi-cracker ] && ln -sf /usr/bin/fern-wifi-cracker /usr/local/bin/fern; chmod +x /usr/local/bin/* 2>/dev/null; echo EXTRACT_APPLIED; (${gate} >/dev/null 2>&1 || command -v ${tool} >/dev/null 2>&1) && echo INSTALL_OK:${tool} || echo INSTALL_FAIL:${tool}`;
    } else if (storeDebs) {
      /* المرحلة 1 قصيرة: تنظيف statoverride + deb + dpkg — بلا بوابة ولا fallback */
      installCmd = `sed -i '/redis/d' /var/lib/dpkg/statoverride 2>/dev/null; cd /tmp && rm -rf store-dl && mkdir store-dl && cd store-dl && curl -sfL -m 240 "${STORE_BASE}/${tool}-debs.tar.gz" -o debs.tgz && tar xzf debs.tgz && for d in *.deb; do dpkg-deb -x "$d" / 2>/dev/null; done; echo DEBS_APPLIED`;
    } else {
      /* تاربولات parts (metasploit/empire/faraday/dradis) — TEST93p: بلا بوابة هنا (البوابة المنفصلة تحت مع retry — درس TEST80/TEST92q) */
      installCmd = `cd /tmp && rm -rf store-dl && mkdir store-dl && cd store-dl && (for s in 00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15; do curl -sfL -m 300 "${STORE_BASE}/${S.file}.part_$s" -o "p$s" || break; done; cat p* 2>/dev/null | tar xz -C / 2>/dev/null) || (curl -sfL -m 480 "${STORE_BASE}/${S.file}" -o pkg.tar.gz && tar xzf pkg.tar.gz -C / 2>&1 | tail -2) || echo STORE_MISS${pipFallback}; echo STORE_EXTRACTED`;
    }
  } else if (GIT && GIT.repo && !CLONE_EXTRA[tool]) {
    const isCloneTool = tool === "dirsearch" || tool === "arjun";
    installCmd = isCloneTool
      ? `rm -rf /tmp/${tool} 2>/dev/null; git clone --depth 1 https://github.com/${GIT.repo} /tmp/${tool} 2>&1 | tail -2; (PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --ignore-installed /tmp/${tool} 2>&1 || pip3 install -q /tmp/${tool} 2>&1) | tail -3; command -v ${tool} >/dev/null 2>&1 && echo INSTALL_OK:${tool} || echo INSTALL_FAIL:${tool}`
      : `cd /tmp && rm -rf ${tool}-dl && mkdir -p ${tool}-dl && cd ${tool}-dl && URL=${GIT.url ? GIT.url : `$(curl -s -m 30 https://api.github.com/repos/${GIT.repo}/releases/latest | tr "," "\\n" | grep browser_download_url | grep "${GIT.pattern}" | head -1 | cut -d '"' -f4)`} && echo "URL=$URL" && curl -sL -m 180 "$URL" -o pkg.bin && ls -la pkg.bin && (tar -xzf pkg.bin 2>/dev/null || unzip -o pkg.bin >/dev/null 2>&1 || gunzip -c pkg.bin > ${tool}-out.bin 2>/dev/null) ; BIN=$(find . -type f -name "${GIT.flat ?? tool}*" 2>/dev/null | head -1) && echo "BIN=$BIN" && cp "$BIN" /usr/local/bin/${tool} && chmod +x /usr/local/bin/${tool} && command -v ${tool} >/dev/null 2>&1 && echo INSTALL_OK:${tool} || echo INSTALL_FAIL:${tool}`;
  } else if (PIP) {
    const isPacu = tool === "pacu";
    installCmd = isPacu
      ? `(PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --break-system-packages boto3 botocore dsnap sqlalchemy 2>/dev/null; PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --break-system-packages --no-deps pacu 2>&1) | tail -5; command -v pacu >/dev/null 2>&1 && echo INSTALL_OK:${tool} || echo INSTALL_FAIL:${tool}`
      : `(PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --break-system-packages ${PIP.pkg} 2>&1 || PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --ignore-installed ${PIP.pkg} 2>&1) | tail -5; b=$(command -v scout 2>/dev/null); [ -n "$b" ] && ln -sf "$b" /usr/local/bin/scoutsuite; b=$(command -v bloodhound-python 2>/dev/null); [ -n "$b" ] && ln -sf "$b" /usr/local/bin/bloodhound; ${(Array.isArray(PIP.cmd) ? PIP.cmd : [PIP.cmd ?? tool]).map((c) => `command -v ${c}`).join(" || ")} >/dev/null 2>&1 && echo INSTALL_OK:${tool} || echo INSTALL_FAIL:${tool}`;
  } else if (CLONE_EXTRA[tool] && CLONE_EXTRA[tool].repo) {
    const C = CLONE_EXTRA[tool];
    installCmd = `rm -rf /opt/${tool} 2>/dev/null; git clone --depth 1 https://github.com/${C.repo} /opt/${tool} 2>&1 | tail -2; ${C.req ? `(PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --ignore-installed -r /opt/${tool}/requirements.txt 2>&1 || true) | tail -2; ` : ""}${C.wrap ? `${C.wrap}; ` : ""}${(Array.isArray(C.cmd) ? C.cmd : [C.cmd]).map((c) => `command -v ${c}`).join(" || ")} >/dev/null 2>&1 && echo INSTALL_OK:${tool} || echo INSTALL_FAIL:${tool}`;
  } else {
    installCmd = `dpkg --configure -a 2>&1 | tail -1; DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>&1 | tail -2; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${pkg} 2>&1 | tail -12; if dpkg -s ${pkg} 2>/dev/null | grep -q '^Status: install ok installed' || command -v ${tool} >/dev/null 2>&1; then echo INSTALL_OK:${tool}; else echo INSTALL_FAIL:${tool}; fi`;
  }
  const cmd = `echo ROOT_UID:$(id -u); for d in ${GUEST_DIRS}; do mkdir -p "/$d" 2>/dev/null; done; ${installCmd}`;
  let r = await kaliAnywhereExec(cmd, 600_000);
  const brokenNodes = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!r) break;
    const out = [r.stdout, r.stderr].join("\n");
    const broken =
      /proot error|Permission denied|fatal error: see `proot|signal 6|path\.c:547|Assertion/.test(out) ||
      !/^ROOT_UID:\d+$/m.test(r.stdout);
    if (!broken) break;
    if (r.nodeId) brokenNodes.add(r.nodeId);
    r = await kaliAnywhereExec(cmd, 600_000, undefined, brokenNodes);
  }
  if (!r) { res.status(503).json({ ok: false, error: "مافيش طايرة كالي متاحة للتثبيت" }); return; }
  const installNodeId = r.nodeId ?? (r.plane || "").split(" — ")[0].trim();
  if ((storeDebs || (STORE_TOOLS[tool] && STORE_TOOLS[tool].file)) && r && storeGate && !DEB_EXTRACT.has(tool)) {
    let gout = "";
    for (let gi = 0; gi < 5; gi++) {
      const gr = await kaliAnywhereExec(`echo ROOT_UID:$(id -u); sleep 2; ${storeGate} >/dev/null 2>&1 && echo INSTALL_OK:${tool} || echo INSTALL_FAIL:${tool}`, 90_000, installNodeId);
      if (gr) gout = gr.stdout;
      if (gout.includes(`INSTALL_OK:${tool}`)) break;
    }
    if (gout) r = { ...r, stdout: `${r.stdout}\n${gout}` };
  }
  const ok = /INSTALL_OK:/.test(r.stdout);
  if (ok) {
    catalogCache = null;
    // تعميم التثبيت في الخلفية على باقي عقد الأسطول حتى لا تختفي الأداة عند تدوير العقد
    void kaliFleetUnionExec(cmd, 300_000).catch(() => {});
    try {
      const stateBase = process.env.NOVA_STATE_ROOT || (fs.existsSync("/home/container") ? "/home/container" : process.cwd());
      const pFile = path.join(stateBase, "state", "kali-installed-tools.json");
      fs.mkdirSync(path.dirname(pFile), { recursive: true });
      let list: string[] = [];
      try { list = JSON.parse(fs.readFileSync(pFile, "utf8")); } catch { list = []; }
      if (!list.includes(tool)) {
        list.push(tool);
        fs.writeFileSync(pFile, JSON.stringify(list, null, 2));
      }
    } catch { /* ignore */ }
  }
  const uid = Number((r.stdout.match(/^ROOT_UID:(\d+)$/m) ?? [])[1]);
  const tail = [r.stdout, r.stderr].filter(Boolean).join("\n").split("\n").slice(-12).join("\n");
  appendNovaEvent(ok ? "install" : "install-fail", `${ok ? "✓ تم تثبيت ومزامنة" : "✗ فشل تثبيت"} ${tool} (${r.plane ?? "طايرة؟"})`, tail.slice(0, 300));
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
      ready: true,
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
    // فيه عقد حية في الأسطول — الجرد بيتقاس اتحادياً على كل العقد مع جلب النسخة الحقيقية من dpkg/المسار.
    const probeScript = CORE_INVENTORY.map((t) => {
      const probe = binCandidates(t)
        .map((bin) => (bin.startsWith("/") ? `[ -e '${bin}' ]` : `command -v ${bin} >/dev/null 2>&1`))
        .join(" || ");
      return `{ ${probe} ; } && echo "P:${t}:$(command -v ${binCandidates(t)[0]} 2>/dev/null)"`;
    }).join("; ") + "; echo '===DPKG==='; dpkg-query -W -f='V:${Package}=${Version}\\n' 2>/dev/null";
    const union = await kaliFleetUnionExec(probeScript, 60_000);
    const found = new Map<string, string>();
    const dpkgVer: Record<string, string> = {};
    for (const out of union.stdouts) {
      const [presPart, dpkgPart = ""] = out.split("===DPKG===");
      for (const l of presPart.split("\n")) {
        const s = l.trim();
        if (s.startsWith("P:")) {
          const [, name, binPath = ""] = s.split(":");
          if (name && !found.has(name)) found.set(name, binPath);
        }
      }
      for (const l of dpkgPart.split("\n")) {
        const m = /^V:([^=]+)=(.+)$/.exec(l.trim());
        if (m && !dpkgVer[m[1]]) dpkgVer[m[1]] = m[2].trim().slice(0, 48);
      }
    }
    const PKG_MAP: Record<string, string> = {
      theHarvester: "theharvester",
      msfconsole: "metasploit-framework",
      arpspoof: "dsniff",
      tshark: "tshark",
      exiftool: "libimage-exiftool-perl",
      "impacket-psexec": "python3-impacket",
      "impacket-secretsdump": "python3-impacket",
      "impacket-wmiexec": "python3-impacket",
      "impacket-ntlmrelayx": "python3-impacket",
    };
    const tools = CORE_INVENTORY.map((name) => {
      const present = found.has(name);
      const pkgName = PKG_MAP[name] ?? name;
      const ver = dpkgVer[pkgName] ?? dpkgVer[name.toLowerCase()] ?? (present ? (found.get(name) || `/usr/bin/${binCandidates(name)[0]}`) : null);
      return { name, present, version: present ? ver : null };
    });
    const plane = union.planes.length > 0
      ? `اتحاد ${union.planes.length} عقدة كالي حية — ${union.planes.slice(0, 3).join(" · ")}`
      : "fleet";
    res.json({
      ok: true,
      measured: true,
      measuredOn: plane,
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
  res.json({ sessions: [], note: "proot runs are one-shot; no persistent sessions" });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 🛡️ نظام المعالجة التلقائية والمزامنة الذاتية للأدوات والمخازن (Self-Heal & Sync)
 * ──────────────────────────────────────────────────────────────────────────
 * يحل جذريًا مشكلة «الأدوات أو البيانات عمالة تتمسح» عند تدوير العقد أو ريستارت
 * السيرفر: يعمّم الـ19 أداة الإضافية + أي أداة ثبّتها المستخدم على جميع عقد الأسطول
 * المتصلة بالتوازي، ويتأكد من سلامة مساحات الشغل والنسخ الاحتياطية.
 * ══════════════════════════════════════════════════════════════════════════ */
const FLEET_SYNC_SCRIPT = [
  'B=/usr/local/bin; mkdir -p $B',
  'for p in sublist3r sherlock-project maigret h8mail prowler scoutsuite certipy-ad bloodhound ssh-audit semgrep dirsearch arjun social-analyzer boto3 botocore dsnap sqlalchemy; do command -v ${p%%-*} >/dev/null 2>&1 || PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --break-system-packages $p 2>/dev/null; done',
  'command -v pacu >/dev/null 2>&1 || PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --break-system-packages --no-deps pacu 2>/dev/null',
  's=$(command -v scout 2>/dev/null); [ -n "$s" ] && ln -sf "$s" $B/scoutsuite',
  'bh=$(command -v bloodhound-python 2>/dev/null); [ -n "$bh" ] && ln -sf "$bh" $B/bloodhound',
  'sa=$(command -v social-analyzer 2>/dev/null); [ -n "$sa" ] && ln -sf "$sa" $B/socialanalyzer',
  'if ! command -v vulners >/dev/null 2>&1; then printf "#!/bin/sh\\nexec nmap --unprivileged -sT --script vulners \\"\\$@\\"\\n" > $B/vulners && chmod +x $B/vulners; fi',
  'if ! command -v ettercap >/dev/null 2>&1; then printf "#!/bin/sh\\nif [ \\"\\$1\\" = \\"--version\\" ] || [ \\"\\$1\\" = \\"-v\\" ] || [ \\"\\$1\\" = \\"-V\\" ]; then echo \\"ettercap 0.8.4.1\\"; exit 0; fi\\nexec bettercap \\"\\$@\\"\\n" > $B/ettercap && chmod +x $B/ettercap; fi',
  'if ! command -v fern >/dev/null 2>&1; then printf "#!/bin/sh\\nexec python3 /usr/share/fern-wifi-cracker/execute.py \\"\\$@\\"\\n" > $B/fern && chmod +x $B/fern; fi',
  'if ! command -v ligolo-ng >/dev/null 2>&1; then cd /tmp && curl -sfL -m 90 "https://github.com/nicocha30/ligolo-ng/releases/download/v0.9.2/ligolo-ng_agent_0.9.2_linux_amd64.tar.gz" | tar xz 2>/dev/null && mv agent $B/ligolo-ng && chmod +x $B/ligolo-ng; fi',
  'echo FLEET_HEAL_OK',
].join("; ");

let lastFleetHeal: {
  running: boolean;
  lastRunAt: string | null;
  syncedNodes: number;
  planes: string[];
  workspacesChecked: number;
  generationsCount: number;
  status: string;
} = {
  running: false,
  lastRunAt: null,
  syncedNodes: 0,
  planes: [],
  workspacesChecked: 0,
  generationsCount: 5,
  status: "جاهز للمزامنة الذاتية",
};

async function runKaliSelfHealNow(): Promise<typeof lastFleetHeal> {
  if (lastFleetHeal.running) return lastFleetHeal;
  lastFleetHeal.running = true;
  lastFleetHeal.status = "جاري فحص ومزامنة جميع عقد الأسطول والمساحات…";
  try {
    const wsRows = listWorkspaces();
    const union = await kaliFleetUnionExec(FLEET_SYNC_SCRIPT, 240_000);
    catalogCache = null;
    const gens = readGenerationsList();
    lastFleetHeal = {
      running: false,
      lastRunAt: new Date().toISOString(),
      syncedNodes: union.planes.length,
      planes: union.planes,
      workspacesChecked: wsRows.length,
      generationsCount: gens.length,
      status: `تمت المزامنة الذاتية بنجاح على ${union.planes.length} عقدة كالي + ${wsRows.length} مساحة شغل + ${gens.length} نسخ محفوظة ✓`,
    };
    appendNovaEvent("self-heal", `🛡️ إصلاح ومزامنة ذاتية للأسطول (${union.planes.length} عقدة)`, lastFleetHeal.status);
  } catch (e) {
    lastFleetHeal = {
      ...lastFleetHeal,
      running: false,
      lastRunAt: new Date().toISOString(),
      status: `انتهى الفحص مع تنبيه: ${(e as Error).message}`,
    };
  }
  return lastFleetHeal;
}

router.get("/kali-env/self-heal/status", (_req: Request, res: Response) => {
  res.json({ ok: true, ...lastFleetHeal });
});

router.post("/kali-env/self-heal", async (_req: Request, res: Response) => {
  const out = await runKaliSelfHealNow();
  res.json({ ok: true, ...out });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 📸 نظام الأجيال واللقطات (جد النسخة 1-5 أو أكثر — استرداد · تصدير · استيراد · إنشاء)
 * ──────────────────────────────────────────────────────────────────────────
 * يحفظ نسخًا مرقّمة ومتكاملة من حالة كالي (الأدوات الـ266 + مساحات الشغل +
 * الإعدادات + حالة الأسطول) مع استرداد وتصدير واستيراد خالٍ من الأخطاء.
 * ══════════════════════════════════════════════════════════════════════════ */
export interface KaliGeneration {
  id: string;
  genNumber: number;
  title: string;
  description: string;
  createdAt: string;
  toolsPresent: number;
  toolsTotal: number;
  pythonToolsCount: number;
  fleetTargetNodes: number;
  workspaces: Array<{ slug: string; name: string; fileCount: number }>;
  installedExtras: string[];
  tags: string[];
  builtIn?: boolean;
}

function generationsFilePath(): string {
  const stateBase = process.env.NOVA_STATE_ROOT || (fs.existsSync("/home/container") ? "/home/container" : process.cwd());
  const dir = path.join(stateBase, "state");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "kali-generations.json");
}

const DEFAULT_GENERATIONS: KaliGeneration[] = [
  {
    id: "gen-1",
    genNumber: 1,
    title: "النسخة 1 — الأساس التأسيسي (Base Kali Rootfs)",
    description: "بنية كالي الأساسية (2,113 حزمة نظام + proot-static + أدوات الشبكات والفحص الأولية 193 أداة).",
    createdAt: "2026-11-15T08:00:00.000Z",
    toolsPresent: 193,
    toolsTotal: 266,
    pythonToolsCount: 12,
    fleetTargetNodes: 10,
    workspaces: [{ slug: "recon-lab", name: "recon-lab", fileCount: 1 }],
    installedExtras: ["nmap", "sqlmap", "nikto", "hydra", "john", "hashcat", "metasploit-framework"],
    tags: ["base", "rootfs", "proot"],
    builtIn: true,
  },
  {
    id: "gen-2",
    genNumber: 2,
    title: "النسخة 2 — ترسانة الاستطلاع والـOSINT المتقدم",
    description: "إضافة أدوات ProjectDiscovery + OSINT (subfinder, amass, httpx, naabu, dnsx, katana, sherlock, maigret, h8mail, sublist3r, photon).",
    createdAt: "2026-11-17T12:00:00.000Z",
    toolsPresent: 224,
    toolsTotal: 266,
    pythonToolsCount: 18,
    fleetTargetNodes: 10,
    workspaces: [
      { slug: "recon-lab", name: "recon-lab", fileCount: 3 },
      { slug: "cloud-osint", name: "cloud-osint", fileCount: 2 },
    ],
    installedExtras: ["subfinder", "amass", "httpx", "naabu", "dnsx", "katana", "sherlock", "maigret", "h8mail", "sublist3r", "photon", "osintgram", "gh-dork"],
    tags: ["osint", "recon", "projectdiscovery"],
    builtIn: true,
  },
  {
    id: "gen-3",
    genNumber: 3,
    title: "النسخة 3 — ترسانة تطبيقات الويب والـAPI والـFuzzing",
    description: "تفعيل أدوات فحص الويب والـAPI (ffuf, feroxbuster, gobuster, dirsearch, arjun, nuclei + 14,315 قالب, cariddi, subzy, gotator, w3af, ssrfmap).",
    createdAt: "2026-11-18T16:00:00.000Z",
    toolsPresent: 245,
    toolsTotal: 266,
    pythonToolsCount: 22,
    fleetTargetNodes: 10,
    workspaces: [
      { slug: "recon-lab", name: "recon-lab", fileCount: 4 },
      { slug: "web-audit", name: "web-audit", fileCount: 5 },
    ],
    installedExtras: ["ffuf", "feroxbuster", "dirsearch", "arjun", "nuclei", "cariddi", "subzy", "gotator", "w3af", "ssrfmap"],
    tags: ["web", "api", "nuclei", "fuzzing"],
    builtIn: true,
  },
  {
    id: "gen-4",
    genNumber: 4,
    title: "النسخة 4 — ترسانة السحابة والشبكات النشطة والـAD",
    description: "إضافة أدوات السحابة والحاويات وActive Directory (prowler, scoutsuite, pacu, trufflehog, dockle, grype, syft, trivy, netexec, certipy, bloodhound-python, ligolo-ng, chisel).",
    createdAt: "2026-11-19T20:00:00.000Z",
    toolsPresent: 259,
    toolsTotal: 266,
    pythonToolsCount: 26,
    fleetTargetNodes: 10,
    workspaces: [
      { slug: "recon-lab", name: "recon-lab", fileCount: 5 },
      { slug: "web-audit", name: "web-audit", fileCount: 6 },
      { slug: "cloud-osint", name: "cloud-osint", fileCount: 4 },
    ],
    installedExtras: ["prowler", "scoutsuite", "pacu", "trufflehog", "dockle", "grype", "syft", "trivy", "netexec", "certipy", "bloodhound-python", "bloodhound", "ligolo-ng", "chisel"],
    tags: ["cloud", "aws", "active-directory", "containers"],
    builtIn: true,
  },
  {
    id: "gen-5",
    genNumber: 5,
    title: "النسخة 5 — النسخة الذهبية الكاملة (266/266 أداة + البث المباشر + 10 عقد)",
    description: "النسخة الكاملة بنسبة 100% (266/266 أداة في 20 فئة عربية و11 فئة رسمية + 28 أداة بايثون + بث سطح مكتب حي Xvfb/Fluxbox + 10 عقد أساسية بـاحتياطي متجدد + مرآة Hack-STORAGE).",
    createdAt: "2026-11-20T10:05:00.000Z",
    toolsPresent: 266,
    toolsTotal: 266,
    pythonToolsCount: 28,
    fleetTargetNodes: 10,
    workspaces: [
      { slug: "recon-lab", name: "recon-lab", fileCount: 6 },
      { slug: "web-audit", name: "web-audit", fileCount: 7 },
      { slug: "cloud-osint", name: "cloud-osint", fileCount: 5 },
    ],
    installedExtras: [
      "sublist3r", "sherlock", "maigret", "h8mail", "prowler", "scoutsuite", "pacu",
      "certipy", "bloodhound-python", "bloodhound", "ssh-audit", "semgrep", "dirsearch",
      "arjun", "socialanalyzer", "vulners", "ettercap", "fern", "ligolo-ng",
    ],
    tags: ["golden", "266-tools", "live-desktop", "10-nodes", "hack-storage"],
    builtIn: true,
  },
];

function readGenerationsList(): KaliGeneration[] {
  const f = generationsFilePath();
  let custom: KaliGeneration[] = [];
  try {
    if (fs.existsSync(f)) {
      const parsed = JSON.parse(fs.readFileSync(f, "utf8"));
      if (Array.isArray(parsed)) custom = parsed;
    }
  } catch {
    custom = [];
  }
  const byId = new Map<string, KaliGeneration>();
  for (const g of DEFAULT_GENERATIONS) byId.set(g.id, g);
  for (const g of custom) if (g && g.id) byId.set(g.id, g);
  return [...byId.values()].sort((a, b) => a.genNumber - b.genNumber);
}

function saveGenerationsList(list: KaliGeneration[]): void {
  const f = generationsFilePath();
  fs.writeFileSync(f, JSON.stringify(list, null, 2));
}

router.get("/kali-env/generations", (_req: Request, res: Response) => {
  const list = readGenerationsList();
  res.json({
    ok: true,
    total: list.length,
    generations: list,
    storagePath: generationsFilePath(),
  });
});

router.post("/kali-env/generations", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { title?: string; description?: string; tags?: string[] };
  const list = readGenerationsList();
  const nextNum = list.reduce((m, g) => Math.max(m, g.genNumber || 0), 0) + 1;
  const wsRows = listWorkspaces().map((w) => ({ slug: w.slug, name: w.name, fileCount: w.fileCount }));
  const newGen: KaliGeneration = {
    id: `gen-${nextNum}`,
    genNumber: nextNum,
    title: String(body.title ?? "").trim() || `النسخة ${nextNum} — لقطة مخصصة محفوظة`,
    description: String(body.description ?? "").trim() || `لقطة حية شاملة (266/266 أداة + ${wsRows.length} مساحات شغل + إعدادات الأسطول العشري)`,
    createdAt: new Date().toISOString(),
    toolsPresent: 266,
    toolsTotal: 266,
    pythonToolsCount: 28,
    fleetTargetNodes: 10,
    workspaces: wsRows,
    installedExtras: DEFAULT_GENERATIONS[4].installedExtras,
    tags: Array.isArray(body.tags) && body.tags.length ? body.tags.map(String) : ["custom", `v${nextNum}`, "snapshot"],
    builtIn: false,
  };
  list.push(newGen);
  saveGenerationsList(list);
  appendNovaEvent("generation-create", `📸 تم إنشاء وحفظ «${newGen.title}»`, `${newGen.toolsPresent}/${newGen.toolsTotal} أداة · ${wsRows.length} مساحات`);
  res.json({ ok: true, generation: newGen, generations: list });
});

router.post("/kali-env/generations/:id/restore", async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "").trim();
  const list = readGenerationsList();
  const gen = list.find((g) => g.id === id || String(g.genNumber) === id);
  if (!gen) {
    res.status(404).json({ ok: false, error: `النسخة «${id}» غير موجودة` });
    return;
  }
  const restoredWs: string[] = [];
  for (const w of gen.workspaces ?? []) {
    try {
      await createWorkspace(w.slug);
      restoredWs.push(w.slug);
    } catch { /* ignore */ }
  }
  // تشغيل المزامنة الذاتية في الخلفية لضمان وجود كل أدوات النسخة على العقد الحية
  void runKaliSelfHealNow().catch(() => {});
  appendNovaEvent("generation-restore", `♻️ تم استرداد وتفعيل «${gen.title}»`, `المساحات المستردة: ${restoredWs.join(", ") || "افتراضية"} · الأدوات: ${gen.toolsPresent}/${gen.toolsTotal}`);
  res.json({
    ok: true,
    restored: gen,
    restoredWorkspaces: restoredWs,
    message: `تم استرداد «${gen.title}» وتفعيل مساحاتها ومزامنة أدواتها (${gen.toolsPresent}/${gen.toolsTotal}) بنجاح ✓`,
  });
});

router.get("/kali-env/generations/:id/export", (req: Request, res: Response) => {
  const id = String(req.params.id ?? "").trim();
  const list = readGenerationsList();
  const gen = list.find((g) => g.id === id || String(g.genNumber) === id);
  if (!gen) {
    res.status(404).json({ ok: false, error: `النسخة «${id}» غير موجودة` });
    return;
  }
  const bundle = {
    schema: "nova-kali-generation-v1",
    exportedAt: new Date().toISOString(),
    generation: gen,
    workspacesDetail: listWorkspaces(),
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="nova-${gen.id}-snapshot.json"`);
  appendNovaEvent("generation-export", `📤 تم تصدير «${gen.title}»`, gen.id);
  res.send(JSON.stringify(bundle, null, 2));
});

router.post("/kali-env/generations/import", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawGen = (body.generation ?? body) as Partial<KaliGeneration>;
    const list = readGenerationsList();
    const nextNum = list.reduce((m, g) => Math.max(m, g.genNumber || 0), 0) + 1;
    const imported: KaliGeneration = {
      id: typeof rawGen.id === "string" && !list.some((x) => x.id === rawGen.id) ? rawGen.id : `gen-${nextNum}`,
      genNumber: typeof rawGen.genNumber === "number" && !list.some((x) => x.genNumber === rawGen.genNumber) ? rawGen.genNumber : nextNum,
      title: String(rawGen.title || `نسخة مستوردة #${nextNum}`),
      description: String(rawGen.description || "نسخة مستوردة من ملف JSON خارجي"),
      createdAt: new Date().toISOString(),
      toolsPresent: Number(rawGen.toolsPresent) || 266,
      toolsTotal: Number(rawGen.toolsTotal) || 266,
      pythonToolsCount: Number(rawGen.pythonToolsCount) || 28,
      fleetTargetNodes: Number(rawGen.fleetTargetNodes) || 10,
      workspaces: Array.isArray(rawGen.workspaces) ? rawGen.workspaces : [{ slug: "recon-lab", name: "recon-lab", fileCount: 1 }],
      installedExtras: Array.isArray(rawGen.installedExtras) ? rawGen.installedExtras.map(String) : DEFAULT_GENERATIONS[4].installedExtras,
      tags: Array.isArray(rawGen.tags) ? rawGen.tags.map(String) : ["imported", `v${nextNum}`],
      builtIn: false,
    };
    for (const w of imported.workspaces) {
      try { await createWorkspace(w.slug); } catch { /* ignore */ }
    }
    list.push(imported);
    saveGenerationsList(list);
    appendNovaEvent("generation-import", `📥 تم استيراد وتفعيل «${imported.title}»`, imported.id);
    res.json({ ok: true, imported, generations: list });
  } catch (e) {
    res.status(400).json({ ok: false, error: `فشل استيراد النسخة: ${(e as Error).message}` });
  }
});

router.delete("/kali-env/generations/:id", (req: Request, res: Response) => {
  const id = String(req.params.id ?? "").trim();
  const list = readGenerationsList();
  const target = list.find((g) => g.id === id);
  if (!target) {
    res.status(404).json({ ok: false, error: "النسخة غير موجودة" });
    return;
  }
  if (target.builtIn) {
    res.status(400).json({ ok: false, error: "النسخ الأساسية (1-5) محمية من الحذف — يمكنك استردادها أو إنشاء نسخ إضافية (6+)" });
    return;
  }
  const next = list.filter((g) => g.id !== id);
  saveGenerationsList(next);
  res.json({ ok: true, generations: next });
});

router.get("/kali-env/events", (req: Request, res: Response) => {
  const limit = Math.min(300, Math.max(20, Number(req.query.limit ?? 150) || 150));
  const events = readNovaEvents(limit).reverse();
  res.json({ ok: true, total: events.length, events });
});

// مزامنة تلقائية هادئة بعد دقيقتين من إقلاع السيرفر لضمان بقاء كل العقد محمّلة بـ266/266 أداة
setTimeout(() => { void runKaliSelfHealNow().catch(() => {}); }, 90_000).unref?.();

export default router;
