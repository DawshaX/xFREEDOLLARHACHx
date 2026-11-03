/**
 * findings-vault — المخزن الوحيد للنتايج، وخزنة مسودة الإفصاح.
 * ────────────────────────────────────────────────────────────
 * ليه: لحد النهارده كل نتيجة كانت بتفضل محبوسة في `state/jobs/<id>.json` تبع مهمة واحدة،
 * و`state/discovered-vulnerabilities-vault.json` كان بيكتبه `deep-research` (نفس الفكرة،
 * خزانتين مالهمش صاحب). مافيش حاجة بتجمع، مافيش dedupe، ومافيش طريق من «نتيجة مُعاد
 * إنتاجها» لـ«مسودة تبعتها للبرنامج». الملف ده بقى الصاحب الوحيد للقراءة؛ الكتابة لسه
 * بتفضل ملك مَن أنتج الدليل.
 *
 * ثلاث قواعد مش قابلين للتفاوض:
 *  1) **المفتاح = المحتوى.** نفس الهوست + نفس النوع + نفس الـtemplate/path = سطر واحد،
 *     واللي بيتكرّر بيعدّي `occurrences++` مش بيترصّف (عشان «11 نتيجة» مش تعني 11 شيء).
 *  2) **مسودة إفصاح مابتتكتبش لنتيجة مااتأكدتش.** `verified !== true` = رفض بالاسم، مش
 *     تحذير. إعادة الإنتاج (runner.verifyFinding) هي البوابة.
 *  3) **الكتالوج مش إذن.** المسودة بت حطّ رابط سياسة البرنامج وحالة الاستقبال كـ*سياق*
 *     للمُرسِل؛ مافيش سطر هنا بيحوّل «النطاق جوه برنامج» لـ«مسموح تفحصه».
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { listJobs, getJob, type Job } from "./runner";
import type { Finding } from "./tools";
import { lookupBountyProgram, catalogStatus } from "./bounty-catalog";

export interface VaultEvidence {
  file?: string;
  sha256?: string;
  bytes?: number;
  probe: string;
  status?: number;
  at: string;
}

export interface FindingRecord {
  key: string;
  host: string;
  /** المسار/الـURL اللي اتلمس عليه — من غير سكيم ولا query، عشان المفتاح يفضل ثابت */
  asset: string;
  title: string;
  titleAr: string;
  severity: string;
  /** نصّ الخطورة زي ما المصدر كتبه، لو كان غير الـ5 مستويات (بيظهر في المسودة بس) */
  severityRaw?: string;
  confidence: number;
  kind: string;
  cwe?: string;
  cvssGuess?: number;
  reproduce: string;
  remediationAr?: string;
  verified: boolean;
  verification?: { at: string; method: string; detail: string };
  evidence: VaultEvidence[];
  /** البرنامج اللي النطاق جوه إيّاه (من الكتالوج) — سياق للمُسجِّل، مش إذن */
  program?: { handle: string; name: string; platform: string; url: string; submission_state?: string | null };
  jobs: Array<{ id: string; name: string }>;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  source: "ops-engine" | "deep-research";
}

export interface VaultFile {
  schema: "cybernova.findings-vault/1";
  updatedAt: string;
  counts: { total: number; verified: number; bySeverity: Record<string, number> };
  findings: FindingRecord[];
}

export function vaultPath(): string {
  const env = process.env.NOVA_FINDINGS_VAULT;
  if (env) return path.resolve(env);
  return path.resolve(process.cwd(), "state/findings-vault.json");
}

const sha1 = (s: string): string => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

/** `https://API.Example.com/x?_=1#f` → `api.example.com/x` */
export function normalizeAsset(target: string): string {
  const raw = String(target || "").trim();
  let s = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  s = s.replace(/^[^/@]*@/, ""); // يخلّي أي userinfo مسرّب في الـURL
  const host = s.split("/")[0].toLowerCase().replace(/:\d+$/, "");
  let rest = s.includes("/") ? s.slice(s.indexOf("/")) : "";
  rest = rest.split("#")[0].split("?")[0];
  rest = rest.replace(/\/+$/, "");
  return host + rest;
}

/** الـ5 مستويات المعتمدة؛ أي نص تاني بيتحوّل لـ`info` وأصله بيتحفظ في `severityRaw`. */
export function normSeverity(raw: unknown): string {
  const s = String(raw ?? "").toLowerCase();
  for (const lvl of ["critical", "high", "medium", "low"] as const) if (s.includes(lvl)) return lvl;
  if (s.includes("info") || s.includes("none")) return "info";
  return "info";
}

/**
 * مفتاح النتيجة من المحتوى. بيستعمل template-id بتاع nuclei لو موجود، لأن نفس
 * الـtemplate على نفس المسار = نفس المشكلة مهما تكرّرت في شغلات مختلفة.
 */
export function findingKey(host: string, f: Finding): string {
  const tpl = String((f.extra as Record<string, unknown> | undefined)?.["template-id"] ?? "").trim();
  const asset = normalizeAsset(f.target || host);
  const idPart = tpl || String(f.title || "").toLowerCase().replace(/\s+/g, " ").trim();
  return sha1(`${host.toLowerCase()}|${f.kind}|${idPart}|${asset}`);
}

function emptyCounts(findings: FindingRecord[]): VaultFile["counts"] {
  const bySeverity: Record<string, number> = {};
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  return { total: findings.length, verified: findings.filter((f) => f.verified).length, bySeverity };
}

function readVault(): VaultFile {
  const file = vaultPath();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as VaultFile;
    if (raw && Array.isArray(raw.findings)) return { ...raw, findings: raw.findings };
  } catch {
    /* مافيش ملف بعد — حالة أول تشغيل مش خطأ */
  }
  return { schema: "cybernova.findings-vault/1", updatedAt: null as unknown as string, counts: { total: 0, verified: 0, bySeverity: {} }, findings: [] };
}

function writeVault(v: VaultFile): void {
  const file = vaultPath();
  v.updatedAt = new Date().toISOString();
  v.counts = emptyCounts(v.findings);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), "utf8");
  fs.renameSync(tmp, file); // نفس طريقة runner.atomicWrite — الخزانة ما تنصفكتابةش
}

export function recordFromFinding(job: Job, f: Finding): FindingRecord {
  const host = job.host || normalizeAsset(f.target).split("/")[0];
  const now = f.verification?.at || job.finishedAt || job.createdAt || new Date().toISOString();
  const bounty = lookupBountyProgram(host);
  return {
    key: findingKey(host, f),
    host,
    asset: normalizeAsset(f.target || host),
    title: f.title,
    titleAr: f.titleAr,
    severity: normSeverity(f.severity),
    ...(String(f.severity || "").toLowerCase() !== normSeverity(f.severity) ? { severityRaw: String(f.severity) } : {}),
    confidence: Number(f.confidence) || 0,
    kind: f.kind,
    cwe: f.cwe,
    cvssGuess: f.cvssGuess,
    reproduce: f.reproduce,
    remediationAr: f.remediationAr,
    verified: f.verified === true,
    verification: f.verification,
    evidence: (f.evidence || []).map((e) => ({ file: e.file, sha256: e.sha256, bytes: e.bytes, probe: e.probe, status: e.status, at: e.at })),
    program: bounty
      ? { handle: bounty.handle, name: bounty.name, platform: bounty.platform, url: bounty.url, submission_state: bounty.submission_state ?? null }
      : undefined,
    jobs: [{ id: job.id, name: job.name }],
    occurrences: 1,
    firstSeen: now,
    lastSeen: now,
    source: "ops-engine",
  };
}

/** دمج مجموعة سجلات في خزانة موجودة — نقي، بلا fs، عشان يتقاس في الاختبار. */
export function mergeRecords(existing: FindingRecord[], incoming: FindingRecord[]): { findings: FindingRecord[]; added: number; updated: number } {
  const byKey = new Map(existing.map((r) => [r.key, { ...r, jobs: [...r.jobs], evidence: [...r.evidence] }]));
  let added = 0;
  let updated = 0;
  for (const rec of incoming) {
    const cur = byKey.get(rec.key);
    if (!cur) {
      byKey.set(rec.key, { ...rec });
      added++;
      continue;
    }
    updated++;
    cur.occurrences += 1;
    cur.lastSeen = rec.lastSeen > cur.lastSeen ? rec.lastSeen : cur.lastSeen;
    cur.firstSeen = rec.firstSeen < cur.firstSeen ? rec.firstSeen : cur.firstSeen;
    // أول مرة تتأكد = للأبد. `verified:false` من شغلة تانية ما بيرجّعهاش ورا.
    if (rec.verified) {
      cur.verified = true;
      cur.verification = rec.verification;
    }
    for (const j of rec.jobs) if (!cur.jobs.some((x) => x.id === j.id)) cur.jobs.push(j);
    for (const e of rec.evidence) if (!cur.evidence.some((x) => x.sha256 === e.sha256 && x.file === e.file)) cur.evidence.push(e);
    if (!cur.program && rec.program) cur.program = rec.program;
    if (rec.severity === "critical" || rec.severity === "high") cur.severity = rec.severity;
  }
  const findings = [...byKey.values()].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
  return { findings, added, updated };
}

/** خزنة قديمة من `deep-research` — بتتقرأ وتتلحّق، ومابيتكتبش على ملفها. */
function readLegacyVault(now: string): FindingRecord[] {
  const file = path.resolve(process.cwd(), "state/discovered-vulnerabilities-vault.json");
  let raw: { discoveredVulnerabilities?: Array<Record<string, unknown>> } | null = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const list = Array.isArray(raw?.discoveredVulnerabilities) ? raw!.discoveredVulnerabilities! : [];
  return list.map((v, i) => {
    const host = String(v.host || v.target || "unknown").replace(/^[a-z]+:\/\//i, "").split("/")[0].toLowerCase();
    const title = String(v.title || v.vulnerability || `deep-research #${i + 1}`);
    return {
      key: sha1(`${host}|deep-research|${title.toLowerCase()}`),
      host,
      asset: normalizeAsset(String(v.target || host)),
      title,
      titleAr: String(v.titleAr || title),
      severity: normSeverity(v.severity),
      ...(String(v.severity || "").toLowerCase() !== normSeverity(v.severity) ? { severityRaw: String(v.severity) } : {}),
      confidence: Number(v.confidence) || 0,
      kind: "deep-research",
      reproduce: String(v.reproduce || v.steps || "مافيش أمر تسجيل في المصدر"),
      verified: false, // المصدر ده مابيدّيش إعادة إنتاج — فممنوع يوصل لمسودة
      evidence: [],
      jobs: [],
      occurrences: 1,
      firstSeen: String(v.foundAt || now),
      lastSeen: String(v.foundAt || now),
      source: "deep-research",
    } satisfies FindingRecord;
  });
}

/**
 * يمسح مهام المحرك المرصودة (listJobs → getJob) ويلحّقها بالخزانة.
 * idempotent بالقياس: تشغيله مرّتين ورا بعض = نفس `total`، وكل نتيجة بتكسب occurrence.
 */
export function syncFromJobs(opts: { limit?: number } = {}): {
  added: number;
  updated: number;
  scanned: number;
  fromJobs: number;
  fromLegacy: number;
  total: number;
  verified: number;
  path: string;
} {
  const v = readVault();
  const now = new Date().toISOString();
  const legacy = readLegacyVault(now);
  const incoming: FindingRecord[] = [];
  let scanned = 0;
  for (const meta of listJobs(opts.limit ?? 200)) {
    const job = getJob(meta.id);
    if (!job) continue;
    scanned++;
    for (const f of job.findings || []) incoming.push(recordFromFinding(job, f));
  }
  // مصدرين داخل نفس الـmerge: عشان `added` يعدّ الكتالوج القديم كمان، مش شغل المحرك بس.
  const { findings, added, updated } = mergeRecords(v.findings, [...legacy, ...incoming]);
  const next: VaultFile = { schema: "cybernova.findings-vault/1", updatedAt: now, counts: { total: 0, verified: 0, bySeverity: {} }, findings };
  writeVault(next);
  return {
    added,
    updated,
    scanned,
    fromJobs: incoming.length,
    fromLegacy: legacy.length,
    total: next.counts.total,
    verified: next.counts.verified,
    path: path.relative(process.cwd(), vaultPath()),
  };
}

export interface VaultQuery {
  host?: string;
  severity?: string;
  verifiedOnly?: boolean;
  limit?: number;
}

export function listVault(q: VaultQuery = {}): { present: boolean; path: string; updatedAt: string | null; counts: VaultFile["counts"]; items: FindingRecord[]; limit: number } {
  const v = readVault();
  const host = (q.host || "").trim().toLowerCase().replace(/^[a-z]+:\/\//i, "").split("/")[0];
  const sev = (q.severity || "").trim().toLowerCase();
  let items = v.findings;
  if (host) items = items.filter((r) => r.host === host || r.host.endsWith(`.${host}`) || r.asset.includes(host));
  if (sev) items = items.filter((r) => r.severity.toLowerCase() === sev);
  if (q.verifiedOnly) items = items.filter((r) => r.verified);
  const limit = Math.max(1, Math.min(Number(q.limit) || 50, 500));
  return {
    present: fs.existsSync(vaultPath()),
    path: path.relative(process.cwd(), vaultPath()),
    updatedAt: v.updatedAt,
    counts: v.counts ?? emptyCounts(v.findings),
    items: items.slice(0, limit),
    limit,
  };
}

export function getRecord(key: string): FindingRecord | null {
  return readVault().findings.find((r) => r.key === key) ?? null;
}

export interface DraftResult {
  ok: boolean;
  markdown?: string;
  error?: string;
  reasonAr?: string;
}

/**
 * مسودة إفصاح. **مرفوضة بالاسم** لو النتيجة ما اتأكدتش بإعادة إنتاج — لأن مسودة
 * «ربما» بتروح لمكان فيه بشرة بتقرأها، وده أسوأ من صفر نتائج.
 */
export function draftReport(key: string): DraftResult {
  const rec = getRecord(key);
  if (!rec) return { ok: false, error: "not-found", reasonAr: `مافيش نتيجة بالمفتاح «${key}» في الخزانة — اعمل POST /api/ops/findings/sync الأول.` };
  if (!rec.verified) {
    return {
      ok: false,
      error: "not-reproduced",
      reasonAr:
        `النتيجة «${rec.title}» لسه ماعادش إنتاجها (POST /api/ops/jobs/${rec.jobs[0]?.id || "<id>"}/verify). ` +
        `مفيش مسودة لنتيجة مش مثبتة — الدليل الأول، والكلام بعدين.`,
    };
  }
  const cat = catalogStatus();
  const lines: string[] = [];
  lines.push(`# ${rec.titleAr || rec.title}`);
  lines.push("");
  lines.push(`- **الهدف:** \`${rec.asset}\``);
  lines.push(`- **السيّفية المُبلَّغ عنها:** ${rec.severity}${rec.cvssGuess ? ` (CVSS تقديري ${rec.cvssGuess})` : ""} · ثقة ${Math.round(rec.confidence * 100)}%`);
  if (rec.cwe) lines.push(`- **CWE:** ${rec.cwe}`);
  lines.push(`- **الأداة/النوع:** \`${rec.kind}\`${rec.key ? ` · key \`${rec.key}\`` : ""}`);
  lines.push(`- **اتكرّرت في:** ${rec.occurrences} مشاهدة · ${rec.jobs.length} مهمة (${rec.jobs.map((j) => j.id).join(", ") || "—"})`);
  lines.push(`- **أول ظهور / آخر ظهور:** ${rec.firstSeen} · ${rec.lastSeen}`);
  lines.push("");
  lines.push("## ملخص");
  lines.push("");
  lines.push(rec.titleAr && rec.titleAr !== rec.title ? `${rec.titleAr}\n\n(الاسم اللي طلع من الأداة: ${rec.title})` : rec.title);
  lines.push("");
  lines.push("## خطوات إعادة الإنتاج");
  lines.push("");
  lines.push("```");
  lines.push(rec.reproduce || "مافيش أمر مسجّل — ده وحده سبب كفاية إن المسودة ماتتكتبش");
  lines.push("```");
  lines.push("");
  lines.push("## الدليل (مجزّأ على القرص، ومشفّر بـsha256)");
  lines.push("");
  if (!rec.evidence.length) lines.push("- مافيش ملف دليل مسجّل على النتيجة دي.");
  for (const e of rec.evidence) {
    lines.push(`- \`${e.file ?? "—"}\` · ${e.bytes ?? "?"} بايت · sha256 \`${e.sha256 ?? "—"}\`${e.status ? ` · HTTP ${e.status}` : ""}`);
    lines.push(`  - الأمر/الطلب اللي طلّعه: \`${e.probe}\``);
  }
  lines.push("");
  if (rec.remediationAr) {
    lines.push("## الإصلاح المقترح");
    lines.push("");
    lines.push(rec.remediationAr);
    lines.push("");
  }
  if (rec.verification) {
    lines.push("## إعادة الإنتاج (بوابة التحقق)");
    lines.push("");
    lines.push(`- \`${rec.verification.at}\` · الطريقة: \`${rec.verification.method}\``);
    lines.push(`- ${rec.verification.detail}`);
    lines.push("");
  }
  lines.push("## سياسة البرنامج");
  lines.push("");
  if (rec.program) {
    lines.push(`- البرنامج: **${rec.program.name}** على ${rec.program.platform} — ${rec.program.url}`);
    if (rec.program.submission_state) lines.push(`- حالة الاستقبال وقت التوليد: \`${rec.program.submission_state}\``);
  } else {
    lines.push(`- مافيش برنامج معلَن في الكتالوج (${cat.present ? `${cat.programs} برنامج` : "كتالوج مقفول"}) بيغطي \`${rec.host}\` — اربط المسودة بصفحة سياسة البرنامج قبل البعت.`);
  }
  lines.push("");
  lines.push("## ملاحظة على النسخة دي");
  lines.push("");
  lines.push("- المسودة اتولّدت من دليل المحرك بس: مافيش هنا حكم «impact» ولا رقم مكافأة متوقّع — دول بتاعك انت.");
  lines.push("- لو الـscan اللي طلّع النتيجة ده اتقطع في النص (`اتقطع بعد …ms`)، النتيجة «مافيش» مش موثّقة: ما تبعتش مسودة مبنية على تغطية ناقصة.");
  lines.push(`- اتولّدت \`${new Date().toISOString()}\` من \`${path.relative(process.cwd(), vaultPath())}\`.`);
  return { ok: true, markdown: lines.join("\n") };
}

export function vaultStatus(): { present: boolean; path: string; updatedAt: string | null; counts: VaultFile["counts"] } {
  const v = readVault();
  return { present: fs.existsSync(vaultPath()), path: path.relative(process.cwd(), vaultPath()), updatedAt: v.updatedAt, counts: v.counts ?? emptyCounts(v.findings) };
}
