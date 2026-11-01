/**
 * NOVA — Fleet capacity & free-stack catalogue
 * ────────────────────────────────────────────
 * The job of this router is to answer three questions honestly:
 *
 *   1. What can the fleet ACTUALLY do right now? (capabilities of connected nodes)
 *   2. How do I get more machines for $0? (catalogue of free hosts + free APIs)
 *   3. What is the concrete next step to add node N+1? (ready-to-run commands)
 *
 * Rule that must never break: nothing here reports a machine as connected
 * unless a real websocket from that machine is open. The catalogue lists what
 * is POSSIBLE, clearly separated from what is CONNECTED.
 */

import { Router, type Request, type Response } from "express";
import { getConnectedAgentList } from "./local-agent";

const router = Router();

/* ── types ─────────────────────────────────────────────────────────────── */

export interface FreeHost {
  id: string;
  name: string;
  url: string;
  kind: "server" | "ci" | "functions" | "database" | "tunnel" | "monitor";
  /** RAM / CPU as advertised on the free tier. */
  ram: string;
  /** Monthly runtime allowance, in plain words. */
  hours: string;
  alwaysOn: boolean;
  sleeps: boolean;
  /** true = a payment method is demanded. Those are NOT usable for us. */
  cardRequired: boolean;
  /** Can it run nova-agent.js permanently? */
  nodeFit: "permanent" | "ephemeral" | "no";
  steps: string[];
  notes: string;
}

/**
 * Free npm/HTTP services that make the server more capable without a card.
 * Every entry is a public endpoint we can call from the brain (No auth or
 * anonymous rate-limited access only).
 */
export interface FreeService {
  id: string;
  name: string;
  category: "dns" | "threat-intel" | "cve" | "ai" | "network" | "storage" | "monitor" | "search";
  endpoint: string;
  needsKey: boolean;
  limit: string;
  usedBy: string;
}

/* ── catalogue: compute hosts ──────────────────────────────────────────── */

const HOSTS: FreeHost[] = [
  {
    id: "gh-actions",
    name: "GitHub Actions (أسطول نودات)",
    url: "https://github.com/DawshaX/xFREEDOLLARHACHx/actions/workflows/fleet-nodes.yml",
    kind: "ci",
    ram: "16 GB · 4 vCPU",
    hours: "غير محدود على الريبو العام",
    alwaysOn: false,
    sleeps: false,
    cardRequired: false,
    nodeFit: "ephemeral",
    steps: [
      "الريبو → Settings → Secrets and variables → Actions → Variables",
      "NOVA_HUB = ws://node.waifly.com:27214/api/local-agent/ws",
      "FLEET_NODES = 8 (أو أي رقم لحد 19)",
      "Actions → fleet-nodes → Run workflow",
    ],
    notes:
      "أقوى حاجة مجانية موجودة: كل job جهاز حقيقي 4 أنوية/16 جيجا. العيب الوحيد إن الجلسة 6 ساعات كحد أقصى، فالأسطول بيدور (موجة كل 5 ساعات). مش نود دائم — نود متجدد.",
  },
  {
    id: "waifly",
    name: "Waifly",
    url: "https://waifly.com",
    kind: "server",
    ram: "300 MB · 1 GB disk",
    hours: "24/7 دائم",
    alwaysOn: true,
    sleeps: false,
    cardRequired: false,
    nodeFit: "permanent",
    steps: [
      "سجّل حساب مجاني (بريد فقط، مش محتاج فيزا)",
      "أنشئ سيرفر Node.js واختار الخطة المجانية",
      "في الكونسول: curl -fsSL <hub>/api/local-agent/download-nova-agent -o nova-agent.js",
      "NOVA_SERVER=ws://<hub>:27214/api/local-agent/ws node nova-agent.js --id waifly-2",
    ],
    notes:
      "ده نفس نوع سيرفرك الحالي. دائم فعلاً. لو النود offline 3 أيام بيتعلّق — الـ keepalive بيمنع ده.",
  },
  {
    id: "render",
    name: "Render",
    url: "https://render.com",
    kind: "server",
    ram: "512 MB · 0.1 CPU",
    hours: "750 ساعة/شهر",
    alwaysOn: false,
    sleeps: true,
    cardRequired: false,
    nodeFit: "ephemeral",
    steps: [
      "New → Web Service → Deploy from repo",
      "Build: node nova-agent.js لا، استخدم Background Worker لو متاح؛ غير كده Web Service + health check",
      "Env: NOVA_SERVER = ws://<hub>:27214/api/local-agent/ws",
    ],
    notes:
      "بينام بعد 15 دقيقة سكون، ولما يصحى بيتصل تاني (الـ agent عنده reconnect). مناسب كنود تقيل مش كـ hub.",
  },
  {
    id: "zeabur",
    name: "Zeabur",
    url: "https://zeabur.com",
    kind: "server",
    ram: "حسب الرصيد",
    hours: "رصيد $5 شهرياً",
    alwaysOn: true,
    sleeps: false,
    cardRequired: false,
    nodeFit: "permanent",
    steps: ["سجّل بـ GitHub", "أنشئ مشروع Node", "ضيف متغير NOVA_SERVER"],
    notes: "رصيد مجاني بيتجدد — سيرفر خفيف دائم لحد ما الرصيد يخلص.",
  },
  {
    id: "back4app",
    name: "Back4App Containers",
    url: "https://www.back4app.com",
    kind: "server",
    ram: "256–512 MB",
    hours: "خطة مجانية",
    alwaysOn: true,
    sleeps: false,
    cardRequired: false,
    nodeFit: "permanent",
    steps: ["Deploy from GitHub", "Dockerfile: node:22-alpine + nova-agent.js", "Env NOVA_SERVER"],
    notes: "حاويات مجانية بدون فيزا — مناسبة لنود دائم خفيف.",
  },
  {
    id: "snapdeploy",
    name: "SnapDeploy",
    url: "https://snapdeploy.dev",
    kind: "server",
    ram: "4 × 512 MB",
    hours: "100 ساعة حاويات/شهر",
    alwaysOn: false,
    sleeps: true,
    cardRequired: false,
    nodeFit: "ephemeral",
    steps: ["4 حاويات مجانية", "ارفع صورة node", "شغّل nova-agent.js"],
    notes: "أربع نودات دفعة واحدة، بس ساعات محدودة وبيناموا.",
  },
  {
    id: "bonto",
    name: "Bonto",
    url: "https://bonto.dev",
    kind: "server",
    ram: "512 MB",
    hours: "75 ساعة/شهر",
    alwaysOn: false,
    sleeps: true,
    cardRequired: false,
    nodeFit: "ephemeral",
    steps: ["Node 22/24/26 مدعوم", "ارفع nova-agent.js", "Env NOVA_SERVER"],
    notes: "ساعات قليلة — نود مساعد مش أساسي.",
  },
  {
    id: "oracle-always-free",
    name: "Oracle Cloud Always Free",
    url: "https://www.oracle.com/cloud/free/",
    kind: "server",
    ram: "24 GB ARM · 4 vCPU",
    hours: "دائم مجاني",
    alwaysOn: true,
    sleeps: false,
    cardRequired: true, // بطاقة للتحقق فقط، لكن مطلوبة => مش متاح
    nodeFit: "permanent",
    steps: ["محتاج بطاقة للتحقق (حتى لو مش هتتخصم)"],
    notes:
      "أقوى خطة مجانية في السوق، لكن **بتطلب بطاقة للتحقق**. طالما مفيش فيزا، دي مش خيار — مسجّلة هنا عشان الأمانة بس.",
  },
  {
    id: "koyeb-northflank-fly",
    name: "Koyeb / Northflank / Fly.io",
    url: "https://fly.io",
    kind: "server",
    ram: "—",
    hours: "—",
    alwaysOn: false,
    sleeps: false,
    cardRequired: true,
    nodeFit: "no",
    steps: ["محتاجة بطاقة — مستبعدة"],
    notes: "Koyeb بيحجز $29، Northflank بيطلب بطاقة للتحقق، Fly.io مبقاش عنده خطة مجانية من 2024. مش «مجاني» عملياً.",
  },
  {
    id: "cloudflare-pages",
    name: "Cloudflare / Vercel / Netlify",
    url: "https://workers.cloudflare.com",
    kind: "functions",
    ram: "128 MB / request",
    hours: "دوال بس",
    alwaysOn: true,
    sleeps: false,
    cardRequired: false,
    nodeFit: "no",
    steps: ["مناسبة للوحة والـ proxy، مش لسيرفر وراه websocket دائم"],
    notes: "مش سيرفر — دوال قصيرة العمر. تنفع لواجهة/بروكسي، متصلحش تشيل nova-agent.",
  },
];

/* ── catalogue: free services the brain can call today ─────────────────── */

const SERVICES: FreeService[] = [
  { id: "cloudflare-doh", name: "Cloudflare DoH", category: "dns", endpoint: "https://cloudflare-dns.com/dns-query", needsKey: false, limit: "بدون مفتاح", usedBy: "dns_lookup" },
  { id: "google-doh", name: "Google DoH", category: "dns", endpoint: "https://dns.google/resolve", needsKey: false, limit: "بدون مفتاح", usedBy: "dns_lookup (احتياطي)" },
  { id: "rdap", name: "RDAP (whois حديث)", category: "dns", endpoint: "https://rdap.org/domain/{domain}", needsKey: false, limit: "بدون مفتاح", usedBy: "whois" },
  { id: "urlhaus", name: "URLhaus (abuse.ch)", category: "threat-intel", endpoint: "https://urlhaus-api.abuse.ch/v1/", needsKey: false, limit: "مجاني", usedBy: "threat intel" },
  { id: "shodan-internetdb", name: "Shodan InternetDB", category: "threat-intel", endpoint: "https://internetdb.shodan.io/{ip}", needsKey: false, limit: "بدون مفتاح", usedBy: "port intel" },
  { id: "greynoise-community", name: "GreyNoise Community", category: "threat-intel", endpoint: "https://api.greynoise.io/v3/community/{ip}", needsKey: false, limit: "ساعات محدودة", usedBy: "ip reputation" },
  { id: "cisa-kev", name: "CISA KEV", category: "cve", endpoint: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", needsKey: false, limit: "بدون مفتاح", usedBy: "/api/cves" },
  { id: "nvd", name: "NVD CVE API", category: "cve", endpoint: "https://services.nvd.nist.gov/rest/json/cves/2.0", needsKey: false, limit: "5 طلبات/30ث بدون مفتاح", usedBy: "/api/cve-live" },
  { id: "circl-cve", name: "CIRCL CVE Search", category: "cve", endpoint: "https://cve.circl.lu/api/", needsKey: false, limit: "بدون مفتاح", usedBy: "cve search" },
  { id: "osv", name: "OSV.dev", category: "cve", endpoint: "https://api.osv.dev/v1/query", needsKey: false, limit: "بدون مفتاح", usedBy: "dependency scan" },
  { id: "github-advisory", name: "GitHub Advisory", category: "cve", endpoint: "https://api.github.com/advisories", needsKey: false, limit: "60/ساعة", usedBy: "advisories" },
  { id: "groq", name: "Groq", category: "ai", endpoint: "https://api.groq.com/openai/v1", needsKey: true, limit: "مجاني (gpt-oss-120b)", usedBy: "council + chat" },
  { id: "gemini", name: "Google Gemini", category: "ai", endpoint: "https://generativelanguage.googleapis.com/v1beta", needsKey: true, limit: "gemini-2.5-flash مجاني", usedBy: "council" },
  { id: "openrouter-free", name: "OpenRouter :free", category: "ai", endpoint: "https://openrouter.ai/api/v1", needsKey: true, limit: "موديلات :free", usedBy: "council (احتياطي)" },
  { id: "ip-api", name: "ip-api.com", category: "network", endpoint: "http://ip-api.com/json/{ip}", needsKey: false, limit: "45/دقيقة", usedBy: "geo ip" },
  { id: "ipinfo", name: "ipinfo.io", category: "network", endpoint: "https://ipinfo.io/{ip}/json", needsKey: false, limit: "مجاني محدود", usedBy: "geo ip" },
  { id: "bgp-he", name: "BGPView / HE", category: "network", endpoint: "https://api.bgpview.io/", needsKey: false, limit: "بدون مفتاح", usedBy: "asn lookup" },
  { id: "gh-releases", name: "GitHub Releases", category: "storage", endpoint: "https://api.github.com/repos/DawshaX/xFREEDOLLARHACHx/releases", needsKey: false, limit: "2 GB/ملف", usedBy: "توزيع nova-24-7.zip" },
  { id: "uptimerobot", name: "UptimeRobot", category: "monitor", endpoint: "https://api.uptimerobot.com/v2/", needsKey: true, limit: "50 مونيتور مجاني", usedBy: "خارجي (اختياري)" },
  { id: "healthchecks", name: "Healthchecks.io", category: "monitor", endpoint: "https://hc-ping.com/", needsKey: false, limit: "20 check مجاني", usedBy: "نبضة الأسطول" },
  { id: "cron-job", name: "cron-job.org", category: "monitor", endpoint: "https://api.cron-job.org", needsKey: true, limit: "مجاني", usedBy: "تذكير/نبضة خارجية" },
  { id: "github-search", name: "GitHub Code Search", category: "search", endpoint: "https://api.github.com/search/code", needsKey: false, limit: "10/دقيقة", usedBy: "deep research" },
];

/* ── live state ────────────────────────────────────────────────────────── */

interface AgentView {
  id: string;
  hostname: string;
  platform: string;
  cpus: number;
  memMb: number;
  capabilities: string[];
  connectedAt: number;
}

function liveAgents(): AgentView[] {
  try {
    return getConnectedAgentList().map((a) => ({
      id: String(a.id ?? "?"),
      hostname: String(a.hostname ?? "?"),
      platform: String(a.platform ?? "?"),
      cpus: Number(a.cpus ?? 0) || 0,
      memMb: Math.round((Number(a.totalMemory ?? 0) || 0) / 1048576),
      capabilities: Array.isArray(a.capabilities) ? (a.capabilities as string[]) : [],
      connectedAt: Number(a.connectedAt ?? 0) || 0,
    }));
  } catch {
    return [];
  }
}

/** Capability keys that are always available because they run on the hub itself. */
const HUB_CAPABILITIES = [
  "brain (33 أدوات)",
  "llm chat",
  "council",
  "cve corpus",
  "memory",
  "crawl",
  "build/deploy",
  "self-check",
];

/* ── routes ────────────────────────────────────────────────────────────── */

/** What the fleet can really do right now — connected nodes only. */
router.get("/fleet/capabilities", (_req: Request, res: Response) => {
  const agents = liveAgents();
  const union = new Set<string>();
  for (const a of agents) for (const c of a.capabilities) union.add(c);

  const devices = agents.reduce((n, a) => n + (a.cpus || 1), 0);
  const ramGb = Math.round((agents.reduce((n, a) => n + a.memMb, 0) / 1024) * 10) / 10;

  res.json({
    ok: true,
    hub: { capabilities: HUB_CAPABILITIES },
    fleet: {
      connected: agents.length,
      cpuCores: devices,
      ramGb,
      capabilities: [...union].sort(),
      nodes: agents,
    },
    /** Honest statement of the ceiling: what a node adds is real shell on a real box. */
    note:
      agents.length === 0
        ? "مفيش نودات متصلة دلوقتي. الأسطول بيساوي صفر — الدماغ بس. شغّل fleet-nodes من Actions أو اربط أي جهاز."
        : `${agents.length} نود متصل فعلياً، بإجمالي ${devices} نواة و${ramGb} جيجا رام.`,
  });
});

/** The catalogue — split into what we can connect and what we can call. */
router.get("/fleet/catalogue", (req: Request, res: Response) => {
  const only = String(req.query.kind ?? "").toLowerCase();
  const hosts = HOSTS.filter((h) => (only ? h.kind === only : true));
  res.json({
    ok: true,
    counts: {
      hosts: HOSTS.length,
      usable_no_card: HOSTS.filter((h) => !h.cardRequired).length,
      permanent_nodes: HOSTS.filter((h) => h.nodeFit === "permanent").length,
      services: SERVICES.length,
    },
    hosts: hosts.map((h) => ({
      ...h,
      usable: !h.cardRequired && h.nodeFit !== "no",
    })),
    services: SERVICES,
    excluded_rule: "أي حاجة بتطلب بطاقة مش بتتحسب مجانية — بتظهر هنا بعلامة cardRequired عشان تعرف الحقيقة.",
  });
});

/** Concrete next steps to grow the fleet, ordered by cost-effectiveness. */
router.get("/fleet/scale-plan", (req: Request, res: Response) => {
  const want = Math.max(1, Math.min(100, Number(req.query.target ?? 8) || 8));
  const connected = liveAgents().length;
  const host = String(req.headers.host ?? "node.waifly.com:27214");
  const hub = `ws://${host}/api/local-agent/ws`;
  const httpBase = `http://${host}`;

  const waves = Math.ceil(want / 19);

  res.json({
    ok: true,
    target: want,
    connected,
    remaining: Math.max(0, want - connected),
    steps: [
      {
        n: 1,
        title: "أسطول GitHub Actions (أسرع طريقة، مجاني تماماً)",
        detail: `كل موجة = 19 نود × (4 vCPU / 16 GB)، وجلسة 6 ساعات، وموجة جديدة كل 5 ساعات. للوصول لـ${want} نود متزامن محتاج ${waves} workflow في نفس الوقت.`,
        action: "Actions → fleet-nodes → Run workflow (اضبط FLEET_NODES)",
        url: "https://github.com/DawshaX/xFREEDOLLARHACHx/actions/workflows/fleet-nodes.yml",
        adds: Math.min(19, Math.max(0, want - connected)),
        permanent: false,
      },
      {
        n: 2,
        title: "نود دائم مجاني على Waifly/Zeabur/Back4App",
        detail: "سيرفر 24/7 بـ300–512 ميجا، من غير فيزا. ده اللي بيخلّي الأسطول موجود حتى لو Actions وقف.",
        action: `curl -fsSL ${httpBase}/api/local-agent/download-nova-agent -o nova-agent.js && NOVA_SERVER=${hub} node nova-agent.js --id node-2`,
        adds: 1,
        permanent: true,
      },
      {
        n: 3,
        title: "أي جهاز عندك (لابتوب/موبايل/راوتر بـSSH)",
        detail: "نفس العميل شغّال على Windows/Linux/macOS/Android(Termux). الجهاز بيوصل عن طريق outbound websocket — مش محتاج IP عام ولا فتح بورت.",
        action: `NOVA_SERVER=${hub} node nova-agent.js --id my-laptop`,
        adds: 1,
        permanent: true,
      },
    ],
    hub,
    check: `${httpBase}/api/fleet/capabilities`,
  });
});

/** One-line bootstrap for a brand-new machine. */
router.get("/fleet/bootstrap", (req: Request, res: Response) => {
  const host = String(req.headers.host ?? "node.waifly.com:27214");
  const proto = (req.headers["x-forwarded-proto"] === "https" ? "wss" : "ws");
  const id = String(req.query.id ?? "node-2").replace(/[^\w.-]/g, "").slice(0, 40) || "node-2";
  const hub = `${proto}://${host}/api/local-agent/ws`;
  res.json({
    ok: true,
    id,
    hub,
    installer: `curl -fsSL http://${host}/api/local-agent/download-agent | bash -s -- --server ${hub} --id ${id}`,
    manual: [
      `curl -fsSL http://${host}/api/local-agent/download-nova-agent -o nova-agent.js`,
      `NOVA_SERVER=${hub} node nova-agent.js --id ${id}`,
    ],
    docker: `docker run -d --restart=always -e NOVA_SERVER=${hub} -e NOVA_ID=${id} node:22-alpine sh -c "apk add --no-cache curl && curl -fsSL http://${host}/api/local-agent/download-nova-agent -o /a.js && node /a.js"`,
  });
});

export default router;
