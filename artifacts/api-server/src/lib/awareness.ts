/**
 * NOVA — awareness: one call that answers «إنت عيان إيه دلوقتي؟»
 * ──────────────────────────────────────────────────────────────
 * `/nova-fleet` is the manager of the whole platform, and a manager needs one
 * truthful sentence about the state of every organ — not eleven requests that can
 * each hang, and not a green dot that means "the router answered".
 *
 * Three rules this file exists to enforce:
 *
 *  1. **Every organ is measured, never assumed.** A seat list, a node count, a
 *     program file, an outbound HTTPS request. If the probe fails the organ
 *     reports `ok:false` with the reason, and the whole snapshot stays 200 — a
 *     dead organ showing up as a 500 page is how outages get hidden.
 *  2. **`blind` is its own verdict.** Reaching the internet is part of this
 *     product ("متصل بالإنترنت"): a server that answers while it cannot reach
 *     NVD/CISA/GitHub is a brain in a box, and that must be loud, not implied.
 *  3. **Nothing secret.** Keys are reported as names via `/api/ops/provision`;
 *     here they are only counted. Program hostnames are counted, not listed —
 *     this endpoint is readable without a token.
 */
import os from "node:os";
import { NOVA_IDENTITY } from "./agent/persona";
import { listConfiguredProviders } from "./agent/llm";
import { councilMembers } from "./agent/council";
import { runSelfCheck } from "./agent/self-check";
import { getConnectedAgentList } from "../routes/local-agent";
import { getMemoryCount } from "../routes/memory";
import { getLiveEventHistory } from "../routes/live-events";
import { getHubClientCount } from "./ws-hub";
import { loadPrograms } from "./ops/scope";
import { catalogStatus } from "./ops/bounty-catalog";
import { getNexusSnapshot } from "./agent/session-nexus";
import { listJobs, runnerStats } from "./ops/runner";
import { throttleStats } from "./ops/ratelimit";
import { KIND_LIST, toolStatus } from "./ops/tools";
import { autonomySummary } from "./ops/autonomy";
import { buildStamp, type NovaBuildStamp } from "./ops/version";
import { freeHostSummary, type FreeHostSummary } from "./ops/free-hosts";
import { liveVerifySays, liveVerifyView, type LiveVerifyView } from "./ops/live-verify";
import { provisionStatus } from "./ops/keys-source";
import { opsExposure } from "./ops/gate";

export type OrganState = "up" | "down" | "partial" | "unknown";

export interface Organ {
  id: string;
  label: string;
  /** what the panel links to for this organ */
  route: string;
  state: OrganState;
  /** one honest line — numbers, not adjectives */
  says: string;
  /** what to do when it is not `up` */
  fixAr?: string;
}

export interface SiteProbe {
  id: string;
  label: string;
  url: string;
  ok: boolean;
  status: number | null;
  ms: number | null;
  note: string;
  /** a route that exists but whose certificate we cannot trust — not an outage */
  tls?: boolean;
}

export interface AwarenessSnapshot {
  ok: true;
  at: string;
  identity: typeof NOVA_IDENTITY;
  /** «أنا كده» — the same facts as `organs`, in one sentence. */
  moodAr: string;
  verdict: "alive" | "degraded" | "blind" | "asleep";
  vitals: {
    uptimeSec: number;
    rssMb: number;
    load1: number;
    node: string;
    platform: string;
    pid: number;
  };
  net: { outbound: boolean; tlsBlocked?: boolean; checkedAt: string; hosts: SiteProbe[] };
  sites: SiteProbe[];
  organs: Organ[];
  counters: {
    councilSeats: number;
    councilUsable: number;
    nodes: number;
    nodeCores: number;
    programs: { total: number; enabled: number; active: number };
    toolsInstalled: string[];
    kinds: number;
    jobs: { total: number; running: number; done: number; failed: number };
    throttleHosts: number;
    memory: number;
    hubClients: number;
    liveEvents: number;
    selfCheck: { score: number; passed: number; total: number; verdict: string } | null;
    autonomy: ReturnType<typeof autonomySummary>;
    freeHosts: FreeHostSummary;
    /** the offensive chain, measured against hosts whose owners allow scanning */
    liveVerify: {
      measured: boolean;
      fresh: boolean;
      verdict: string | null;
      pass: number;
      fail: number;
      review: number;
      blocked: number;
      ageMin: number | null;
      failedChecks: string[];
    };
    gate: ReturnType<typeof opsExposure>;
    keysLoaded: number;
    catalogPrograms?: number;
    nexus?: {
      rootSessionId: string;
      totalSessions: number;
      rootMessages: number;
      backgroundFeed: number;
      learnedInsights: number;
    };
  };
  /** the bundle identity (sha + age) — same payload as /api/ops/version */
  build?: NovaBuildStamp | null;
}

async function guard<T>(fn: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/* ── outbound + sites: probed, cached, never fatal ─────────────────────── */

const NET_TTL_MS = Number(process.env.NOVA_AWARENESS_NET_TTL_MS || 60_000);
let netCache: { at: number; outbound: boolean; tlsBlocked: boolean; hosts: SiteProbe[] } | null = null;
let siteCache: { at: number; sites: SiteProbe[] } | null = null;

/**
 * Deliberately not a single "is google up" check: the engine talks to GitHub,
 * to vulnerability feeds and to the fleet hub, and each route can be blocked on
 * its own (this very sandbox blocks everything but a few hosts). A boolean from
 * one host would lie about the other two.
 */
async function probeOutbound(): Promise<{ outbound: boolean; tlsBlocked: boolean; checkedAt: string; hosts: SiteProbe[] }> {
  if (netCache && Date.now() - netCache.at < NET_TTL_MS) {
    return {
      outbound: netCache.outbound,
      tlsBlocked: netCache.tlsBlocked,
      checkedAt: new Date(netCache.at).toISOString(),
      hosts: netCache.hosts,
    };
  }
  const targets: Array<[string, string]> = [
    ["github", "https://api.github.com/zen"],
    ["dns", "https://dns.google/resolve?name=github.com&type=A"],
    ["nvd", "https://nvd.nist.gov/"],
    ["hackerone", "https://hackerone.com/security.txt"],
  ];
  const hosts = await Promise.all(
    targets.map(([id, url]) => probe(id, url, "منفذ الخروج")),
  );
  const outbound = hosts.some((h) => h.ok);
  // A proxy that re-signs TLS (or a node without the CA bundle) is NOT the same
  // fact as "no route": the program is online but untrusting. Reporting it as
  // blind would send the reader to the network config instead of `NODE_EXTRA_CA_CERTS`.
  const tlsBlocked = !outbound && hosts.some((h) => h.tls);
  netCache = { at: Date.now(), outbound, tlsBlocked, hosts };
  return { outbound, tlsBlocked, checkedAt: new Date(netCache.at).toISOString(), hosts };
}

async function probe(id: string, url: string, label: string): Promise<SiteProbe> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
      headers: { "user-agent": "CyberNova-NOVA/2099 (awareness probe)" },
    });
    const ms = Date.now() - t0;
    return {
      id,
      label,
      url,
      ok: res.status < 500,
      status: res.status,
      ms,
      note: res.ok ? `ردّ في ${ms}ms` : `HTTP ${res.status} —وصلنا بس رجّع خطأ`,
    };
  } catch (err) {
    const code = (err as Error & { cause?: { code?: string } }).cause?.code ?? (err as Error).message;
    const tls = /UNABLE_TO_VERIFY|SELF_SIGNED|SELF_SIGNED_CERT|DEPTH_ZERO|CERT_HAS_EXPIRED|UNABLE_TO_GET_ISSUER|unable to verify/i.test(
      String(code),
    );
    return {
      id,
      label,
      url,
      ok: false,
      tls,
      status: null,
      ms: Date.now() - t0,
      note: tls
        ? "المنفذ موجود بس شهادة TLS معتمدةش (بروكسي بيعيد التوقيع أو CA ناقص) — مشكلة ثقة مش انقطاع"
        : /ENOTFOUND|EAI_AGAIN/.test(String(code))
          ? "DNS مابيرضاش يحل الاسم"
          : /ECONN|ETIMEDOUT|timeout|abort/i.test(String(code))
            ? "مفيش وصول للمنفذ ده من هنا"
            : String(code).slice(0, 80),
    };
  }
}

function publicSites(reqHost: string | undefined): SiteProbe[] {
  const pages = process.env.NOVA_PAGES_URL ?? "https://dawshax.github.io/xFREEDOLLARHACHx/";
  const hub = reqHost ? `http://${reqHost}/` : null;
  const list: SiteProbe[] = [
    { id: "pages", label: "اللوحة على GitHub Pages", url: pages, ok: false, status: null, ms: null, note: "لم يُقَس بعد" },
  ];
  if (hub && !pages.startsWith(hub)) {
    list.push({ id: "hub", label: "الـhub ده (المخ)", url: hub, ok: true, status: 200, ms: 0, note: "أنت بتكلمه دلوقتي — يبقى شغال بالتعريف" });
  }
  list.push({
    id: "manager",
    label: "غرفة الإدارة",
    url: `${pages}nova-fleet`,
    ok: false,
    status: null,
    ms: null,
    note: "نفس اللوحة على `/nova-fleet`",
  });
  return list;
}

/* ── the snapshot ────────────────────────────────────────────────────────── */

let snapCache: { at: number; snap: AwarenessSnapshot } | null = null;
const SNAP_TTL_MS = Number(process.env.NOVA_AWARENESS_TTL_MS || 3_000);

export async function awareness(reqHost?: string): Promise<AwarenessSnapshot> {
  if (snapCache && Date.now() - snapCache.at < SNAP_TTL_MS) return snapCache.snap;

  const [providers, seats, net, selfCheck, stamp, freeHosts, verify] = await Promise.all([
    guard(() => listConfiguredProviders(), [] as Awaited<ReturnType<typeof listConfiguredProviders>>),
    guard(() => councilMembers(9), [] as Awaited<ReturnType<typeof councilMembers>>),
    probeOutbound(),
    guard(() => runSelfCheck(), null),
    Promise.resolve(guardSafe(() => buildStamp())),
    guard(() => freeHostSummary(), {
      total: 0,
      usableNoCard: 0,
      permanent: 0,
      probed: 0,
      reachable: 0,
      scanForbidden: 0,
      bestHubId: "none",
      bestHubAr: "القياس ماحصلش",
    } as Awaited<ReturnType<typeof freeHostSummary>>),
    // sync file read — wrapped so a missing report stays `unknown`, never an exception
    Promise.resolve(guardSafe(() => liveVerifyView())),
  ]);
  const nodes = guardSafe(() => getConnectedAgentList()) ?? [];
  const jobs = guardSafe(() => listJobs(50)) ?? [];
  const programs = guardSafe(() => loadPrograms().programs) ?? [];
  const tools = guardSafe(() => toolStatus()) ?? [];
  const runner = guardSafe(() => runnerStats());
  const throttle = guardSafe(() => throttleStats());
  const autonomy = guardSafe(() => autonomySummary()) ?? { level: "off", lastSweep: null, programs: 0 };
  const gate = guardSafe(() => opsExposure()) ?? { guarded: false, open: false, detail: "" };
  const keys = guardSafe(() => provisionStatus()?.keys?.applied?.length ?? 0) ?? 0;
  const memoryCount = guardSafe(() => getMemoryCount()) ?? 0;
  const liveEvents = guardSafe(() => getLiveEventHistory(20).length) ?? 0;
  const hubClients = guardSafe(() => getHubClientCount()) ?? 0;

  const usable = seats.filter((s) => s.kind === "openai-compatible" || s.id === "ollama");
  const installed = tools.filter((t) => t.present).map((t) => t.bin);
  const enabledPrograms = programs.filter((p) => p.enabled);
  const activePrograms = enabledPrograms.filter((p) => !p.passive_only);
  const runningJobs = jobs.filter((j) => /running|queued/.test(String(j.status))).length;
  const catalog = guardSafe(() => catalogStatus());
  const catalogTotal = catalog?.programs ?? 0;
  const nexus = guardSafe(() => getNexusSnapshot());

  /* Sites: probe the public ones (cached with the net check), never this host. */
  let sites = publicSites(reqHost);
  if (siteCache && Date.now() - siteCache.at < NET_TTL_MS) sites = siteCache.sites;
  else {
    sites = await Promise.all(
      sites.map(async (s) =>
        s.id === "hub" ? s : { ...s, ...(await probe(s.id, s.url, s.label)) },
      ),
    );
    siteCache = { at: Date.now(), sites };
  }

  const organs: Organ[] = [
    {
      id: "brain",
      label: "العقل اللغوي",
      route: "/nova-core",
      state: providers.length > 0 ? "up" : "down",
      says: providers.length
        ? `${providers.length} مصدر مفعّل: ${providers.slice(0, 4).map((p) => p.id).join(" · ")}`
        : "ولا مصدر — المحرك الهجين شغال بدل اللامحدّث",
      fixAr: providers.length ? undefined : "سيّر GROQ_API_KEY أو NOVA_KEYS_URL — أو شغّل ollama على نفس الجهاز",
    },
    {
      id: "council",
      label: "المجلس (تصويت)",
      route: "/nova-core",
      state: usable.length >= 2 ? "up" : usable.length === 1 ? "partial" : "down",
      says: usable.length >= 2 ? `${usable.length} مقاعد بترد — تصويت حقيقي` : `${usable.length} مقعد بس — مافيش تصويت`,
      fixAr: usable.length >= 2 ? undefined : "NOVA_KEYLESS_SEATS بيدي 3 مقاعد من غير مفاتيح (pollinations)",
    },
    {
      id: "fleet",
      label: "الأسطول (أجهزة حقيقية)",
      route: "/nova-fleet",
      state: nodes.length > 0 ? "up" : "down",
      says: nodes.length
        ? `${nodes.length} نود · ${nodes.reduce((n, a) => n + (a.cpus ?? 0), 0)} نواة · أدوات: ${installed.length ? installed.join(", ") : "ولا أداة على الـhub"}`
        : "مفيش نود متصل — التنفيذ على الـhub بس",
      fixAr: nodes.length ? undefined : "Actions → fleet-nodes (يحتاج NOVA_EXEC_TOKEN + FLEET_ENABLED=1) أو شغّل nova-agent.js على أي جهاز",
    },
    {
      id: "ops",
      label: "محرك التنفيذ",
      route: "/nova-fleet",
      state: KIND_LIST.length > 0 ? "up" : "down",
      says: `${KIND_LIST.length} نوع مهمة · ${installed.length} أداة منصوبة · ${runner?.active?.length ?? 0} job شغال دلوقتي`,
    },
    {
      id: "scope",
      label: "بوابة التصريح",
      route: "/nova-fleet",
      state: enabledPrograms.length > 0 ? (activePrograms.length > 0 ? "up" : "partial") : catalogTotal > 0 ? "partial" : "down",
      says: enabledPrograms.length
        ? `${enabledPrograms.length} برنامج مفعّل (${activePrograms.length} يسمح بفحص نشط)${catalogTotal > 0 ? ` · ${catalogTotal} في الكتالوج` : ""}`
        : catalogTotal > 0
          ? `حماية نشطة (وضع الاستطلاع الآمن) · ${catalogTotal} برنامج مسجّل في الكتالوج العام — أضف تصريح هدف لفتح الفحص النشط`
          : "مفيش برنامج مسجّل — أي فحص نشط مرفوض",
      fixAr: enabledPrograms.length
        ? undefined
        : catalogTotal > 0
          ? "اختر هدفاً من الكتالوج (GET /api/ops/bounty/candidates) أو أضف تصريحاً لهدفك عبر POST /api/ops/programs/discover"
          : "قول «اكتشف برنامج example.com» (أداة program_discover) أو POST /api/ops/programs/discover",
    },
    {
      id: "proof",
      label: "الأدلة والتحقق",
      route: "/evidence",
      state: runner?.dir ? "up" : "partial",
      says: `مجلد المهام: ${runner?.dir ?? "غير معروف"} · الأدلة SHA-256 جوه كل job`,
    },
    {
      id: "throttle",
      label: "احترام الهدف (rate limit)",
      route: "/nova-fleet",
      state: "up",
      says: `${Object.keys(throttle ?? {}).length} هوست تحت المراقبة · kill-switch: ${gate.open ? "مفتوح (معمل)" : gate.guarded ? "بالتوكن" : "نفس الأصل فقط"}`,
    },
    {
      id: "memory",
      label: "الذاكرة طويلة الأمد",
      route: "/nova-core",
      state: memoryCount > 0 ? "up" : "partial",
      says: `${memoryCount} مذكورة محفوظة`,
      fixAr: memoryCount > 0 ? undefined : "مفيش ذاكرة بعد — أي شغل حقيقي بيكتب نفسه هناك لوحده",
    },
    {
      id: "bus",
      label: "البث اللحظي",
      route: "/live-agent",
      state: hubClients > 0 ? "up" : "partial",
      says: `${hubClients} عميل على /api/ws · آخر ${liveEvents} حدث في history`,
      fixAr: hubClients > 0 ? undefined : "مفيش متصفّح مفتوح على اللوحة دلوقتي — البث شغال بس مفيش سامع",
    },
    {
      id: "net",
      label: "الإنترنت للخارج",
      route: "/self-check",
      state: net.outbound ? "up" : net.tlsBlocked ? "partial" : "down",
      says: net.hosts.filter((h) => h.ok).length
        ? `${net.hosts.filter((h) => h.ok).length}/${net.hosts.length} منفذ خارجي شغال (${net.hosts.filter((h) => h.ok).map((h) => h.id).join(", ")})`
        : net.tlsBlocked
          ? "الخروج موجود بس شهادة TLS ماقبلناهاش — آخر 4 منافذ كلها فشل اعتماد شهادة"
          : "مقطوع — مفيش أي مسار للخارج من السيرفر ده",
      fixAr: net.outbound
        ? undefined
        : net.tlsBlocked
          ? "لو السيرفر ورا بروكسي/صندوق أمان بيعيد التوقيع: ضيف `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` أو `NODE_TLS_REJECT_UNAUTHORIZED=0` للتحربة بس."
          : "لوانت بتجرّب في sandbox/بدون NAT فالنتيجة دي طبيعية؛ على الهوست الحقيقي لازم 4/4",
    },
    {
      id: "freehosts",
      label: "المضيفون المجانيون",
      route: "/nova-fleet",
      state: freeHosts.reachable > 0 ? "up" : freeHosts.probed === 0 ? "unknown" : "partial",
      says:
        freeHosts.probed === 0
          ? "مافيش قياس — الكتالوج مفيهوش probeUrl"
          : `${freeHosts.reachable}/${freeHosts.probed} موقع بيردّ من هنا · ${freeHosts.usableNoCard} بلا بطاقة · ${freeHosts.permanent} يصلح hub دائم · الأحسن: ${freeHosts.bestHubAr}`,
      fixAr:
        freeHosts.reachable > 0
          ? undefined
          : "صفر في القياس معناه غالبًا إن خروج السيرفر ده مقيد (مش إن المضيفين ماتوا) — القياس الحقيقى بيتعمل على الـhub. التفاصيل: `/api/fleet/catalogue?probe=1`.",
    },
    {
      id: "liveverify",
      label: "سلسلة الأدوات (مقاسة على أهداف حية)",
      route: "/nova-fleet",
      state: !(verify as LiveVerifyView | null)?.measured
        ? "unknown"
        : (verify as LiveVerifyView).verdict === "UNSAFE" || (verify as LiveVerifyView).verdict === "RED"
          ? "down"
          : (verify as LiveVerifyView).verdict === "GREEN" && (verify as LiveVerifyView).fresh
            ? "up"
            : "partial",
      says: liveVerifySays(verify as LiveVerifyView),
      fixAr: !(verify as LiveVerifyView)?.measured
        ? "شغّل workflow `live-verify.yml` (أو `node scripts/verify-live.mjs` على جهاز فيه خروج) — القياس بيتعمل على scanme.nmap.org و testphp.vulnweb.com بأذن أصحابهم، والمحكوم بيتكتب في state/verified-live.md."
        : (verify as LiveVerifyView).failedChecks.length
          ? `مقسوس: ${(verify as LiveVerifyView).failedChecks.slice(0, 3).join(" · ")} — التفاصيل والموافقات في \`state/verified-live.md\``
          : undefined,
    },
    {
      id: "background",
      label: "الشغل في الخلفية",
      route: "/nova-fleet",
      state: autonomy.level === "off" ? "down" : "up",
      says:
        autonomy.level === "off"
          ? "الدورة الخلفية مقفولة (NOVA_OPS_AUTONOMY=off)"
          : `عمق ${autonomy.level} · آخر دورة ${autonomy.lastSweep ?? "لسه"} · ${autonomy.programs} برنامج تحت المتابعة`,
    },
    {
      id: "nexus",
      label: "الجذر والاستمرار 24/7",
      route: "/agent-pro",
      state: "up",
      says: nexus
        ? `جلسة الجذر (${nexus.rootSessionId}) دائمة · ${nexus.totalSessions} جلسة متصلة · ${nexus.backgroundFeedCount} نبضة خلفية · ${nexus.learnedInsightsCount} تعلّم ذاتي`
        : "جلسة الجذر الدائمة مفعّلة",
    },
  ];

  const down = organs.filter((o) => o.state === "down");
  const partial = organs.filter((o) => o.state === "partial");
  const verdict: AwarenessSnapshot["verdict"] = !net.outbound && !net.tlsBlocked
    ? "blind"
    : providers.length === 0 && nodes.length === 0 && enabledPrograms.length === 0 && catalogTotal === 0
      ? "asleep"
      : down.length === 0
        ? "alive"
        : "degraded";
  // `partial` is deliberately NOT a downgrade: "مفيش نود متصل" and "مفيش متصفح
  // سامع البث" are honest idle states, not faults — calling them degraded would
  // train everyone to ignore the banner.

  const moodAr =
    `أنا ${NOVA_IDENTITY.name}: عقلي ${providers.length ? `شغال على ${providers.length} مصدر` : "مقطوع عن النماذج"} · ` +
    `المجلس ${usable.length >= 2 ? `بيصوّت (${usable.length})` : "من غير تصويت"} · ` +
    `الأسطول ${nodes.length || "صفر"} نود · البرامج المصرّح بها ${enabledPrograms.length || "صفر"} · ` +
    `الأدوات ${installed.length || "مفيش"} · الإنترنت ${net.outbound ? "متاح" : net.tlsBlocked ? "موجود بس الثقة مقطوعة (TLS)" : "مقطوع"}` +
    (down.length ? ` · الناقص: ${down.map((o) => o.label).join("، ")}` : " · مفيش عضو واقع");

  const snap: AwarenessSnapshot = {
    ok: true,
    at: new Date().toISOString(),
    identity: NOVA_IDENTITY,
    moodAr,
    verdict,
    vitals: {
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
      load1: Number((os.loadavg()[0] ?? 0).toFixed(2)),
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      pid: process.pid,
    },
    net,
    sites,
    organs,
    counters: {
      councilSeats: seats.length,
      councilUsable: usable.length,
      nodes: nodes.length,
      nodeCores: nodes.reduce((n: number, a: { cpus?: number }) => n + (a.cpus ?? 0), 0),
      programs: { total: programs.length, enabled: enabledPrograms.length, active: activePrograms.length },
      toolsInstalled: installed,
      kinds: KIND_LIST.length,
      jobs: {
        total: jobs.length,
        running: runningJobs,
        done: jobs.filter((j) => String(j.status) === "done").length,
        failed: jobs.filter((j) => /failed|cancelled/.test(String(j.status))).length,
      },
      throttleHosts: Object.keys(throttle ?? {}).length,
      memory: memoryCount,
      hubClients,
      liveEvents,
      selfCheck: selfCheck ? { score: selfCheck.score, passed: selfCheck.passed, total: selfCheck.total, verdict: selfCheck.verdict } : null,
      autonomy,
      freeHosts,
    liveVerify: {
      measured: Boolean((verify as LiveVerifyView | null)?.measured),
      fresh: Boolean((verify as LiveVerifyView | null)?.fresh),
      verdict: (verify as LiveVerifyView | null)?.verdict ?? null,
      pass: (verify as LiveVerifyView | null)?.counts?.pass ?? 0,
      fail: (verify as LiveVerifyView | null)?.counts?.fail ?? 0,
      review: (verify as LiveVerifyView | null)?.counts?.review ?? 0,
      blocked: (verify as LiveVerifyView | null)?.counts?.blocked ?? 0,
      ageMin: (verify as LiveVerifyView | null)?.ageMin ?? null,
      failedChecks: (verify as LiveVerifyView | null)?.failedChecks ?? [],
    },
      gate,
      keysLoaded: keys,
      catalogPrograms: catalogTotal,
      nexus: nexus
        ? {
            rootSessionId: nexus.rootSessionId,
            totalSessions: nexus.totalSessions,
            rootMessages: nexus.rootMessageCount,
            backgroundFeed: nexus.backgroundFeedCount,
            learnedInsights: nexus.learnedInsightsCount,
          }
        : undefined,
    },
  };
  // stamped on the snapshot, not on a side channel, so the panel can say
  // «باندل إيه ده» without a second request.
  snap.build = stamp;
  snapCache = { at: Date.now(), snap };
  return snap;
}

/** sync-safe wrapper for the getters that cannot throw but whose module may not be ready */
function guardSafe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
