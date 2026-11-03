/**
 * bounty-catalog — قراءة `ops/bounty/programs-catalog.json` (746 برنامج معلَن عليها علنًا).
 *
 * ليه: المحرك كان بيفضّل يبدأ من صفر — `program_discover` بيقرأ `security.txt` بس، فلو الهوست
 * مالوش ملف إفصاح (وغالبًا مالوش) بيطلع «مفيش برنامج عام واضح» حتى لو النطاق ده جوه برنامج
 * bug bounty منشورpolicy صفحته. الكتالوج بيقلب الجملة دي لـ«البرنامج FOO على hackerone،
 * السياسة برابط، الاستجابة 86%، safe harbor كامل» — وده الفرق بين خطة ومجاملة.
 *
 * **الكتالوج مش إذن.** مافيش هنا أي طريق يطلّع `passive_only:false`؛ الإذن بيفضل جملة
 * «I have written permission for <host>» في `scope.discoverProgram` وبس. الكود ده بيضيف
 * سياق (policy link، منصة، جودة الاستجابة) وبس.
 *
 * الكاش على mtime — عشان CI بياكتب الملف أسبوعيًا والسيرفر ممكن يفضل شغال أسابيع.
 */
import fs from "node:fs";
import path from "node:path";

export interface BountyMatch {
  handle: string;
  name: string;
  platform: string;
  url: string;
  bounties: boolean;
  safe_harbor?: string | null;
  max_payout_usd?: number | null;
  response_efficiency?: number | null;
  paused?: boolean;
  /** حالة الاستقبال على المنصة ("open" / "closed") — مش «إذن»: بس بيفرق في «أقدر أبعت دلوقتي؟» */
  submission_state?: string | null;
  /** النطاق اللي طابت المطابقة — بيتقال في التقرير عشان ما نخلطش برنامج بأكبر منه */
  matched_on: string;
  /** نوع المعرّف اللي طابت بيه المطابقة: نطاق صريح ولا wildcard ولا رابط. «wildcard_apex» =
   *  إحنا على النطاق الأب لـ*.example.com — وده بالعادة **برّه** الـscope، فبيتحسب أضعف. */
  matched_kind: "domain" | "wildcard" | "url" | "wildcard_apex";
}

interface CatalogProgram extends Partial<BountyMatch> {
  handle: string;
  name?: string;
  platform?: string;
  url?: string;
  bounties?: boolean;
  max_payout_usd?: number | null;
  response_efficiency?: number | null;
  safe_harbor?: string | null;
  paused?: boolean;
  submission_state?: string | null;
  avg_hours_to_bounty?: number | null;
  severities?: string[];
  asset_total?: number | null;
  eligible_assets?: number | null;
  non_host_assets?: number | null;
  domains?: string[];
  wildcards?: string[];
  urls?: string[];
  ips?: string[];
  cidrs?: string[];
  consented?: boolean;
  mode?: string;
}

interface Catalog {
  schema?: string;
  fetched_at?: string;
  counts?: { programs?: number; bounty_programs?: number };
  programs?: CatalogProgram[];
}

let cache: { file: string; mtime: number; data: Catalog | null } | null = null;

/** `NOVA_BOUNTY_CATALOG` للتستات؛ غير كده بنلف من cwd و من ملف البناء لفوق لحد جذر المستودع. */
export function catalogPath(): string {
  const env = process.env.NOVA_BOUNTY_CATALOG;
  if (env) return path.resolve(env);
  const start = [process.cwd(), path.resolve(import.meta.dirname, "../../../.."), path.resolve(import.meta.dirname, "../../..")];
  for (const base of start) {
    let dir = base;
    for (let up = 0; up < 6; up++) {
      const p = path.join(dir, "ops/bounty/programs-catalog.json");
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        /* permissions — كمّل لفوق */
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return path.resolve(start[0], "ops/bounty/programs-catalog.json");
}

function load(): Catalog | null {
  const file = catalogPath();
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (cache && cache.file === file && cache.mtime === mtime) return cache.data;
  let data: Catalog | null = null;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8")) as Catalog;
  } catch {
    data = null;
  }
  cache = { file, mtime, data };
  return data;
}

/** للحلقة ولصف الحالة: الكتالوج موجود؟ كام برنامج؟ وإمتى اتحدّث؟ */
export function catalogStatus(): {
  present: boolean;
  path: string;
  programs: number;
  bountyPrograms: number;
  fetchedAt: string | null;
} {
  const file = catalogPath();
  const data = load();
  return {
    present: !!data && Array.isArray(data.programs),
    path: path.relative(process.cwd(), file) || file,
    programs: data?.counts?.programs ?? (Array.isArray(data?.programs) ? data!.programs!.length : 0),
    bountyPrograms: data?.counts?.bounty_programs ?? 0,
    fetchedAt: data?.fetched_at ?? null,
  };
}

const hostOnly = (s: string): string =>
  String(s || "")
    .replace(/^https?:\/\//i, "")
    .replace(/^\*\./, "")
    .split("/")[0]
    .toLowerCase()
    .trim();

const kindOf = (id: string): BountyMatch["matched_kind"] => {
  const v = String(id || "").trim();
  if (/^https?:\/\/|^\/\//.test(v) || (v.includes("/") && !v.startsWith("*."))) return "url";
  if (v.startsWith("*.")) return "wildcard";
  return "domain";
};

/**
 * أول برنامج في الكتالوج يغطي `host` (المطابقة بتبدأ من الأطول: wildcard على الهوست نفسه
 * أحسن من wildcard على الدومين الأب، عشان الـscope يفضل ضيّق).
 */
export function lookupBountyProgram(hostRaw: string): BountyMatch | null {
  const host = hostOnly(hostRaw);
  if (!host || !host.includes(".")) return null;
  const data = load();
  const programs = data && Array.isArray(data.programs) ? data.programs : null;
  if (!programs) return null;

  const labels = host.split(".").map((_, i) => host.split(".").slice(i).join(".")).filter((d) => d.includes("."));
  const score = (id: string): number => {
    const h = hostOnly(id);
    if (!h) return -1;
    // wildcard على أبونا مش معناه إن الأب نفسه جوّه السكوب — بيتحسب أضعف من النطاق الصريح
    if (h === host) return kindOf(id) === "wildcard" ? 950 + h.length : 1000 + h.length;
    if (labels.includes(h)) return 100 + h.length; // الأب (root domain)
    if (host.endsWith(`.${h}`)) return 90 + h.length;
    if (h.endsWith(`.${host}`)) return 80;
    return -1;
  };

  let best: { prog: CatalogProgram; matched: string; rank: number; kind: BountyMatch["matched_kind"] } | null = null;
  for (const prog of programs) {
    let rank = -1;
    let matched = "";
    let kind: BountyMatch["matched_kind"] = "domain";
    for (const id of [...(prog.domains || []), ...(prog.wildcards || []), ...(prog.urls || [])]) {
      const r = score(id);
      if (r > rank) {
        rank = r;
        matched = hostOnly(id);
        const k = kindOf(id);
        kind = k === "wildcard" && matched === host ? "wildcard_apex" : k;
      }
    }
    if (rank > 0 && (!best || rank > best.rank)) best = { prog, matched, rank, kind };
  }
  if (!best) return null;
  const p = best.prog;
  return {
    handle: p.handle,
    name: String(p.name || p.handle),
    platform: String(p.platform || "custom"),
    url: String(p.url || ""),
    bounties: p.bounties === true,
    safe_harbor: (p.safe_harbor as string | undefined) ?? null,
    max_payout_usd: (p.max_payout_usd as number | undefined) ?? null,
    response_efficiency: (p.response_efficiency as number | undefined) ?? null,
    paused: p.paused === true,
    submission_state: (p.submission_state as string | undefined) ?? null,
    matched_on: best.matched,
    matched_kind: best.kind,
  };
}

/* ── hunt candidates: «هتحط إيدك على إيه الجاي؟» ────────────────────────────────
 * الاختيار ده كان لسه بإيد المستخدم: المحرك يعرف 746 برنامج بس مابقولش «ابدأ بـ X».
 * الترتيب مش مزاج: جودة الاستجابة (اللي بيقرأوه أصلًا) الأول، وبعدين أكبر مكافأة معلنة.
 * **ولا حقل هنا بيرجّع إذن**: `consented:false` و`mode:"passive_only"` بيتفرضوا في
 * الرد — مش بيتقروا من الملف — عشان أي قارئ للـJSON مايشوفش «برنامج منشور = مسموح».
 */
export interface HuntCandidate {
  handle: string;
  name: string;
  platform: string;
  url: string;
  bounties: boolean;
  paused: boolean;
  submission_state: string | null;
  response_efficiency: number | null;
  max_payout_usd: number | null;
  avg_hours_to_bounty: number | null;
  safe_harbor: string | null;
  severities: string[];
  asset_total: number | null;
  eligible_assets: number | null;
  counts: { domains: number; wildcards: number; urls: number; cidrs: number; ips: number };
  /** سياق بس: أول نطاقات معلنة. مش «scope» — الـscope بييجي من صفحة البرنامج/الإذن. */
  sample_hosts: string[];
  /** سياق شبكة: مافيش حاجة في المحرك بتحوّل دول لـscope من هنا (مقيس في ops-selftest). */
  network_context_only: true;
  consented: false;
  mode: "passive_only";
}

export interface HuntQuery {
  limit?: number;
  platform?: string;
  minEfficiency?: number;
  q?: string;
  /** لو true: بيشمل الموقوفة/المقفولة الاستقبال (للاستطلاع)، وإلا لأ. */
  includeClosed?: boolean;
}

export function huntCandidates(opts: HuntQuery = {}): {
  present: boolean;
  path: string;
  fetchedAt: string | null;
  scanned: number;
  filteredOut: { notBounty: number; pausedOrClosed: number; lowEfficiency: number; platform: number; query: number };
  limit: number;
  items: HuntCandidate[];
} {
  const st = catalogStatus();
  const out = {
    present: st.present,
    path: st.path,
    fetchedAt: st.fetchedAt,
    scanned: 0,
    filteredOut: { notBounty: 0, pausedOrClosed: 0, lowEfficiency: 0, platform: 0, query: 0 },
    limit: Math.max(1, Math.min(Number(opts.limit) || 12, 100)),
    items: [] as HuntCandidate[],
  };
  const data = st.present ? load() : null;
  const programs = Array.isArray(data?.programs) ? data!.programs! : [];
  if (!programs.length) return out;
  const wantPlatform = (opts.platform || "").trim().toLowerCase();
  const minEff = Number.isFinite(Number(opts.minEfficiency)) ? Number(opts.minEfficiency) : null;
  const q = (opts.q || "").trim().toLowerCase();

  const keep: Array<{ p: CatalogProgram; c: HuntCandidate }> = [];
  for (const p of programs) {
    out.scanned++;
    if (p.bounties !== true) {
      out.filteredOut.notBounty++;
      continue;
    }
    const closed = p.paused === true || (typeof p.submission_state === "string" && p.submission_state !== "" && p.submission_state !== "open");
    if (closed && !opts.includeClosed) {
      out.filteredOut.pausedOrClosed++;
      continue;
    }
    if (wantPlatform && String(p.platform || "").toLowerCase() !== wantPlatform) {
      out.filteredOut.platform++;
      continue;
    }
    const eff = typeof p.response_efficiency === "number" ? p.response_efficiency : null;
    if (minEff != null && (eff == null || eff < minEff)) {
      out.filteredOut.lowEfficiency++;
      continue;
    }
    const domains = p.domains || [];
    const wildcards = p.wildcards || [];
    const urls = p.urls || [];
    if (q) {
      const hay = `${p.handle} ${p.name} ${domains.slice(0, 40).join(" ")} ${wildcards.slice(0, 40).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) {
        out.filteredOut.query++;
        continue;
      }
    }
    keep.push({
      p,
      c: {
        handle: String(p.handle),
        name: String(p.name || p.handle),
        platform: String(p.platform || "custom"),
        url: String(p.url || ""),
        bounties: true,
        paused: p.paused === true,
        submission_state: p.submission_state ? String(p.submission_state) : null,
        response_efficiency: eff,
        max_payout_usd: typeof p.max_payout_usd === "number" ? p.max_payout_usd : null,
        avg_hours_to_bounty: typeof p.avg_hours_to_bounty === "number" ? p.avg_hours_to_bounty : null,
        safe_harbor: p.safe_harbor ? String(p.safe_harbor) : null,
        severities: Array.isArray(p.severities) ? (p.severities as string[]).slice(0, 6) : [],
        asset_total: typeof p.asset_total === "number" ? p.asset_total : null,
        eligible_assets: typeof p.eligible_assets === "number" ? p.eligible_assets : null,
        counts: {
          domains: domains.length,
          wildcards: wildcards.length,
          urls: urls.length,
          cidrs: Array.isArray(p.cidrs) ? p.cidrs.length : 0,
          ips: Array.isArray(p.ips) ? p.ips.length : 0,
        },
        sample_hosts: [...domains, ...wildcards].slice(0, 6),
        network_context_only: true,
        consented: false,
        mode: "passive_only",
      },
    });
  }
  keep.sort((a, b) => {
    const ea = a.c.response_efficiency ?? -1;
    const eb = b.c.response_efficiency ?? -1;
    if (eb !== ea) return eb - ea;
    const pa = a.c.max_payout_usd ?? 0;
    const pb = b.c.max_payout_usd ?? 0;
    if (pb !== pa) return pb - pa;
    return a.c.name.localeCompare(b.c.name);
  });
  out.items = keep.slice(0, out.limit).map((x) => x.c);
  return out;
}
