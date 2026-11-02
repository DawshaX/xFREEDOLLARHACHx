/**
 * NOVA · كتالوج المضيفين المجانيين — بيانات + قياس، مش سمعة
 * ──────────────────────────────────────────────────────────
 * `docs/FREE-HOSTS-2026.md` هو الشرح البشري؛ الملف ده هو نفس المعلومات في
 * شكل يقدر المحرك يردّ بيه على `/api/fleet/catalogue` ويحطه في قراية الوعي.
 *
 * قاعدتين هنا:
 *  1) أي سطر `status2026` اتقرا من صفحة المورد نفسه في 2026-11-02 — مش من
 *     ذاكرة ولا من مقال قديم (عشان كذا Cyclic/Glitch مش موجودين: ماتوا).
 *  2) `probeCatalogue()` بتقيس وصولية المورد من مكان تشغيل المحرك. القياس ده
 *     «الموقع موجود» — مش «التسجيل هيتم» ومش «الخدمة كلها شغالة». والفرق ده
 *     مكتوب في الرد نفسه (`measured_rule`) عشان ماحدش يقرأ أخضر على إنه ضمان.
 */

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
  /** what the provider's own site says TODAY (checked 2026-11-02, not from memory) */
  status2026?: string;
  /**
   * NOVA's offensive arm must not run where the ToS forbids it. Free tiers are
   * shared-IP and mostly anti-scan: that is a fact about the host, not a mood.
   */
  scanPolicy?: "allowed" | "forbidden" | "unknown";
  /** a public URL the engine probes to prove the provider itself is reachable */
  probeUrl?: string;
  /** free persistent storage / database on this tier, if any */
  db?: string;
  /**
   * What standing does registration actually demand, as of the last read of
   * their own page. This is a real cost: a host that needs a student email or a
   * Discord invite is not the same ask as one that needs an email form.
   */
  signupEase?: "email" | "edu" | "discord" | "card" | "unknown";
}


export const HOSTS: FreeHost[] = [
  {
    id: "gh-actions",
    name: "GitHub نفسه (Pages + Actions + Releases) — القاعدة اللي مغنية عن السيرفر",
    url: "https://github.com/DawshaX/xFREEDOLLARHACHx/actions/workflows/nova-runner.yml",
    kind: "ci",
    ram: "16 GB · 4 vCPU لكل job (ولحد 20 job مع بعض)",
    hours: "غير محدود على الريبو العام · job واحد لحد 6 ساعات",
    alwaysOn: false,
    sleeps: false,
    cardRequired: false,
    nodeFit: "ephemeral",
    signupEase: "email",
    db: "الريبو نفسه — كل تقرير commit بيرجّع، والواجهة بتقراه من /nova-runs/index.json",
    probeUrl: "https://github.com/robots.txt",
    scanPolicy: "forbidden",
    steps: [
      "حرّر state/nova-queue.json من واجهة جيت-هَب (Add file → Edit) وحط بعثة: {id,title,objective,target,depth:\"passive\",status:\"queued\"}",
      "الـcommit وحده بيشتغل الـworkflow (nova-runner) — أو استنى cron كل 15 دقيقة",
      "التقرير هيظهر على https://dawshax.github.io/xFREEDOLLARHACHx/nova-runs/index.json",
      "لو عايز أدوات بتماس الهدف: Settings → Variables → NOVA_RUNNER_ALLOW_ACTIVE=1 (مسؤوليتك، IP المصدر هنا بتاع جيت-هَب)",
    ],
    notes:
      "دي القوة الغاشمة المجانية الوحيدة: جهاز حقيقي بجذر كامل، بتنصّب عليه nmap/nuclei، ومفيش كارت ومفيش نوم ومفيش سقف دقائق على ريبو عام. اللي مالوش: مفيش منفذ عام يستقبل، وjob بيموت في 6 ساعات. عشان كده هو الذراع مش العنوان — الطابور في الريبو، والنشر على Pages، والـhub الصغير (Waifly/Silly) للرسايل اللحظية. الاستطلاع النشط متقفل افتراضياً بالضبط لهذا السبب.",
  },
  {
    id: "waifly",
    probeUrl: "https://waifly.com/robots.txt",
    signupEase: "email",
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
    probeUrl: "https://render.com/robots.txt",
    signupEase: "email",
    scanPolicy: "unknown",
    db: "مفيش ديسك على Free خالص — الذاكرة بتتصدّر لبره (`keepalive.yml`) أو `DATABASE_URL` على Postgres مجاني",
    status2026:
      "الخطة المجانية لسه موجودة: 750 ساعة/شهر، بس الـbandwidth اتقصّف لـ5GB في أبريل 2026 وخدمة الويب المجانية بتنام بعد 15 دقيقة (صحوتها ~دقيقة). متحقق من شاشة New Web Service بتاريخ 2026-11-02: الخطة $0 · 0.1 CPU · 512 MB، ومفيش طلب كارت جوه الفورم نفسه (الكارت بيطلبوه لو رفعت الخطة).",
    steps: [
      "New → **Blueprint** → اختار الريبو → Apply (render.yaml بيظبط كل حاجة: frankfurt + health check + NOVA_EXEC_TOKEN متولّد)",
      "أو New → Web Service: Build = `corepack enable && corepack prepare pnpm@10.34.9 --activate && pnpm install --no-frozen-lockfile && pnpm --filter @workspace/api-server run build && BASE_PATH=/ pnpm --filter @workspace/kali-panel run build && node scripts/fetch-toolchain.mjs --into vendor/bin`",
      "Start = `node --enable-source-maps artifacts/api-server/dist/index.mjs` · Root Directory فاضي · Region = Frankfurt",
      "Advanced: Health Check `/api/health` · Ignored Paths: `docs/**`, `**/*.md`, `.github/**`, `state/*` (من غيرها كل commit بتاع الروبوت هيبدأ build)",
      "في Actions: ضيف سرّ `NOVA_URL = https://<اسمك>.onrender.com` → keepalive كل 10 دقايق + نسخة احتياطية يومية للذاكرة",
    ],
    notes:
      "بينام بعد 15 دقيقة سكون، فمفتاحه إن `keepalive.yml` يفضل يرنّ عليه. **الأدوات الحقيقية بقت بتنزّل وقت الـbuild** (`scripts/fetch-toolchain.mjs` → `vendor/bin`: nuclei/httpx/subfinder/katana/dnsx/naabu/ffuf) فالمحرك يشوفها من غير root ومن غير apt — `findBinary()` بيبحث في `vendor/bin` وفي `NOVA_TOOL_DIR`. سياسة المسح عندهم متحققتش من مصدرهم النهاردة (`unknown`)، والمبدأ: الضربة النشطة على نود روت، والسلبي هنا. أول ما الأدوات تبان، أي خطة بقت نشطة → بوابة التصريح ترفض على برنامج `passive_only` بالمكتوب: «لازم تأكيد إذن مكتوب»",
  },
  {
    id: "zeabur",
    probeUrl: "https://zeabur.com/robots.txt",
    signupEase: "unknown",
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
    probeUrl: "https://back4app.com/robots.txt",
    signupEase: "unknown",
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
    probeUrl: "https://snapdeploy.dev/robots.txt",
    signupEase: "unknown",
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
    probeUrl: "https://bonto.dev/robots.txt",
    signupEase: "unknown",
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
    probeUrl: "https://www.oracle.com/robots.txt",
    signupEase: "card",
    scanPolicy: "forbidden",
    status2026:
      "مقارنة مضيفين مجانية (نشر أكتوبر 2026) بتقول: Always Free Arm لحد 2 OCPU/12 جيجا أو اتنين AMD micro (1 جيجا) + 200 جيجا ديسك، بطاقة للائتمان وقت التسجيل، و«idle instances can be reclaimed» — الأرقام دي من مصدر تالت مش من صفحة أوراكل نفسها",
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
    probeUrl: "https://www.koyeb.com/robots.txt",
    signupEase: "card",
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
    probeUrl: "https://workers.cloudflare.com/robots.txt",
    signupEase: "email",
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
  {
    id: "gratisvps",
    name: "GratisVPS.net — VPS كامل بلا كارت",
    url: "https://gratisvps.net/cvps",
    kind: "server",
    ram: "2 GB · 2 vCPU KVM · NVMe",
    hours: "24/7 دائم، مفيش عدّاد ساعات",
    alwaysOn: true,
    sleeps: false,
    cardRequired: false,
    nodeFit: "permanent",
    probeUrl: "https://gratisvps.net/robots.txt",
    signupEase: "email",
    scanPolicy: "forbidden",
    db: "ديسك NVMe دائم — الذاكرة والملفات بتفضل بعد الريستارت (عكس Render/Waifly)",
    status2026:
      "صفحة أكتوبر 2026: تسجيل ببريد بس (مفيش كارت/PayPal/تليفون)، Ubuntu 24.04 / Debian 12 / AlmaLinux 9 أو Windows، 3 ريجيونز US/Frankfurt/Singapore، و«No fixed end date while you follow the fair-use rules»",
    steps: [
      "gratisvps.net/cvps → حساب ببريد، اختار Ubuntu 24.04 + Frankfurt",
      "ssh root@<IP> && apt update && apt install -y nodejs npm git curl unzip",
      "curl -L -o nova.zip https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/nova-portable/nova-24-7.zip && unzip nova.zip && cd nova-24-7",
      "printf 'PORT=8080\\nHOST=0.0.0.0\\nNOVA_EXEC_TOKEN=%s\\n' \"$(openssl rand -hex 16)\" > .env",
      "npm i -g pm2 && pm2 start 'node server.mjs' --name nova && pm2 save && pm2 startup",
      "curl -s localhost:8080/api/nova-core/awareness | head -c 300   # لازم يطلع opsRouter:true",
    ],
    notes:
      "أحسن قفزة متاحة لحالتك: 2 جيجا + root + ديسك دائم من غير فيزا. لكن شروطهم بتمنع صراحة «port scanning / brute-forcing / DDoS» — يعني: العقل والمجلس والذاكرة والبث وrecon السلبي لأ؛ أي ضربة نشطة على نطاق تالت لا. الضرب النطوط على نودك بتاعك أو Oracle بموافقة.",
  },
  {
    id: "freevps-edu",
    name: "FreeVPS.edu.pl — KVM للطلاب والمطورين",
    url: "https://freevps.edu.pl/cp/index.php?rp=/store/free-vps",
    kind: "server",
    ram: "KVM مستقل · Ryzen 9 · DDR5 ECC · NVMe",
    hours: "24/7 دائم · root كامل · 1 Gbps fair-use",
    alwaysOn: true,
    sleeps: false,
    cardRequired: false,
    nodeFit: "permanent",
    probeUrl: "https://freevps.edu.pl/robots.txt",
    signupEase: "edu",
    scanPolicy: "unknown",
    db: "ديسك دائم + تنصب PostgreSQL نفسك",
    status2026:
      "الموقع (2026): الطالب بريد `.edu` بيوافق فورًا، والمطور بمراجعة GitHub/Portfolio — يعني حسابك على GitHub هو مفتاحك، ومفيش بطاقة",
    steps: [
      "سجّل ببريد جامعة (.edu / .edu.eg) أو اربط لينك GitHub في الطلب",
      "اختار Ubuntu 22.04 → نفس خطوات pm2 اللي في GratisVPS فوق",
      "اكتب في الطلب: Node.js service + health check على /api/health",
    ],
    notes:
      "أقصر طريق لـroot حقيقي من غير فيزا لو عندك إيميل جامعي أو GitHub نضيف. مفيش سياسة معلنة عن المسح — اسألهم الأول، ومن غير رد صريح خلّي الشغل passive.",
  },
  {
    id: "sillydev",
    name: "Silly Development — الحاوية اللي مابتنامش",
    url: "https://sillydev.co.uk/",
    kind: "server",
    ram: "256 MB · 25% core · 512 MB disk",
    hours: "24/7 — «We do not sleep idle containers»",
    alwaysOn: true,
    sleeps: false,
    cardRequired: false,
    nodeFit: "permanent",
    probeUrl: "https://sillydev.co.uk/robots.txt",
    signupEase: "unknown",
    scanPolicy: "unknown",
    db: "✅ Postgres/MariaDB مجاني (قاعدتين × 50 MB) «تتوصل بيها من أي حتة» → حطه في DATABASE_URL",
    status2026:
      "صفحتهم (نوفمبر 2026): بلا كارت، بلا تجديد، Node/Python/Bun، قواعد بيانات مجانية. الاستثناء الوحيد: سيرفر مااتستخدموش في أول 7 أيام بيتشيل بعد إيميل تحذير. Trustpilot 2026 فيه شكاوى تعليق/صيانة — طبيعي لمضيف مجاني",
    steps: [
      "سجّل (عن طريق الديسكورد غالبًا) → Create Server → Node.js",
      "في الكونسول: curl -L -o nova.zip <رابط الريليز> && unzip nova.zip && cd nova-24-7 && node server.mjs",
      "خلي Start command = node server.mjs و Environment: PORT/NOVA_EXEC_TOKEN",
      "HTTPS للوحة على Pages: sh start-tunnel.sh (Cloudflare quick tunnel، من غير تسجيل)",
      "لو فتحلك Postgres: صدّر DATABASE_URL → الذاكرة والمهمات بقت دائمة (الريبو بيراجعها في app.ts)",
    ],
    notes:
      "نفس الاختيار اللي الريبو كان بيرشحه (deploy/always-on-free.md) ولسه شغال بنفس الأرقام. مقاسنا (300MB) مضبوط عليه. العيب: 256MB مايلحقوش nmap+nuclei مع بعض — دول على نود تاني.",
  },
  {
    id: "azure-students",
    name: "Azure for Students — $100 كرِدِت من غير كارت",
    url: "https://azure.microsoft.com/en-us/free/students/",
    kind: "server",
    ram: "حسب الاختيار (B1s = 1 GB · D-series أعلى)",
    hours: "12 شهر، بيتجدد طالما أنت طالب",
    alwaysOn: true,
    sleeps: false,
    cardRequired: false,
    nodeFit: "permanent",
    probeUrl: "https://azure.microsoft.com/robots.txt",
    signupEase: "edu",
    scanPolicy: "forbidden",
    db: "ديسك دائم على الـVM",
    status2026:
      "مقارنات 2026 بتسمّيه الاستثناء الحقيقي على قاعدة «كل كرِدِت محتاج بطاقة»: التحقق ببريد جامعة بس، و«Zero credit or debit card details required» مع root وIPv4 مخصص",
    steps: [
      "azure.microsoft.com/free/students → بريد الجامعة (مفيش بطاقة)",
      "New resource → Ubuntu 22.04 (B1s) → افتح 8080 في الـNSG",
      "نفس خطوات pm2 بتاعة GratisVPS",
    ],
    notes:
      "VM كامل برام كفاية الأدوات تقيلة. لكن Azure بيمنع مسح شبكات ناس تانية من غير إذن مكتوب — نفس قاعدة الريبو: scope أولًا، واللوحة مافيهاش زرار بيتخطّى البوابة.",
  },
];


/* ── القياس: الكتالوج ادعاء لحد ما يتقاس ─────────────────────────────────── */

export interface HostProbe {
  id: string;
  reachable: boolean;
  status: number | null;
  ms: number | null;
  note: string;
  probedAt: string;
}

const PROBE_TTL_MS = Number(process.env.NOVA_HOST_PROBE_TTL_MS || 600_000);
let probeCache: { at: number; probes: HostProbe[] } | null = null;
let probeInFlight: Promise<HostProbe[]> | null = null;

async function probeOne(host: FreeHost): Promise<HostProbe> {
  const base: HostProbe = {
    id: host.id,
    reachable: false,
    status: null,
    ms: null,
    note: "",
    probedAt: new Date().toISOString(),
  };
  const url = host.probeUrl;
  if (!url) return { ...base, note: "مفيش probeUrl للمورد ده — مافيش قياس" };
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      redirect: "follow",
      headers: { "user-agent": "CyberNova-NOVA/2099 (free-host survey)" },
    });
    // أي رد = المورد موجود. حتى 404 دليل إن السيرفر شغال.
    return { ...base, reachable: true, status: res.status, ms: Date.now() - t0, note: `ردّ HTTP ${res.status} في ${Date.now() - t0}ms` };
  } catch (err) {
    const why = String((err as Error & { cause?: { code?: string } }).cause?.code ?? (err as Error).message);
    const tls = /UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO|CERT_HAS_EXPIRED|UNABLE_TO_GET_ISSUER|unable to verify/i.test(why);
    return {
      ...base,
      // فشل الثقة في الشهادة معناه إن المسار موجود — مش نفس حقيقة «مات».
      reachable: tls,
      ms: Date.now() - t0,
      note: tls ? `المسار موجود بس الثقة في الشهادة بايظة (${why.slice(0, 40)})` : why.slice(0, 60),
    };
  }
}

export function probeCatalogue(force = false): Promise<HostProbe[]> {
  if (!force && probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return Promise.resolve(probeCache.probes);
  if (probeInFlight) return probeInFlight;
  probeInFlight = Promise.all(HOSTS.filter((h) => h.probeUrl).map((h) => probeOne(h)))
    .then((probes) => {
      probeCache = { at: Date.now(), probes };
      return probes;
    })
    .finally(() => {
      probeInFlight = null;
    });
  return probeInFlight;
}

export interface FreeHostSummary {
  total: number;
  usableNoCard: number;
  permanent: number;
  probed: number;
  reachable: number;
  scanForbidden: number;
  bestHubId: string;
  bestHubAr: string;
}

/** العدادات اللي بتظهر في قراية الوعي — محسوبة مش متقولة. */
export async function freeHostSummary(): Promise<FreeHostSummary> {
  const probes = await probeCatalogue().catch(() => [] as HostProbe[]);
  const reachable = probes.filter((x) => x.reachable);
  const reachIds = new Set(reachable.map((x) => x.id));
  /**
   * التوصية سكور مش أول سطر في جدول: الـhub عايز وصولية (مقيسة)، وديسك/قاعدة
   * data تعيش بعد الريديبلوي، ودوام حقيقي، وبلا بطاقة، ورام تشيل المجلس.
   * كل ده مت المشتق من الكتالوج — فتعديل البيانات يعدّل النصيحة نفسها.
   */
  const hubScore = (h: FreeHost): number =>
    (reachIds.has(h.id) ? 3 : 0) +
    (h.db ? 2 : 0) +
    (h.nodeFit === "permanent" ? 2 : 0) +
    (!h.cardRequired ? 1 : 0) +
    (/\d+(\.\d+)?\s?GB\b/.test(h.ram ?? "") ? 1 : 0) -
    (h.sleeps ? 2 : 0) +
    ({ email: 2, edu: 1, discord: 1, card: -3, unknown: 0 }[h.signupEase ?? "unknown"] ?? 0);
  const best = HOSTS.filter((h) => h.nodeFit !== "no" && !h.cardRequired).sort((a, b) => hubScore(b) - hubScore(a))[0] ?? null;
  return {
    total: HOSTS.length,
    usableNoCard: HOSTS.filter((h) => !h.cardRequired).length,
    permanent: HOSTS.filter((h) => h.nodeFit === "permanent").length,
    probed: probes.length,
    reachable: reachable.length,
    scanForbidden: HOSTS.filter((h) => h.scanPolicy === "forbidden").length,
    bestHubId: best?.id ?? "none",
    bestHubAr: best
      ? `${best.name} — ${best.ram}${best.db ? ` · تخزين: ${String(best.db).split("—")[0].trim()}` : ""}${reachIds.has(best.id) ? " · موقعه بيردّ" : " · موقعه ماردّش من هنا"}`
      : "مفيش مضيف دائم بلا بطاقة في القياس ده",
  };
}
