/**
 * Watchers — الصوت اللي بيتكلم من غير ما حد يسأله
 * ──────────────────────────────────────────────────────────────────────────
 * لحد المرحلة دي الأجنت كان بيجاوب بس: مفيش في `lib/agent` كله أي سطر بيقول
 * «حصلت حاجة وأنا ساكت». المطلوب كان «وسيط بيحكم من الخارج وبيطمن» — ده الجسد
 * بتاعه. كل ملاحظة هنا قراءة لحاجة موجودة فعلًا في المستودع/الماكلة:
 *
 *   · آخر جري صيد          → state/hunt-latest.json (بيكتبه شغل CI)
 *   · خزنة النتائج الموثقة → ops/findings-vault
 *   · مكتبة الاستشارات     → ops/advisory-library
 *   · تقرير التحقق الحيّ    → ops/live-verify
 *   · الأدوات على المكنة    → ops/toolchain
 *   · المهام الدائمة        → nova-cron (runCount/errorCount مقاسين)
 *
 * مفيش أي رقم مكتوب في الكود: لو القراءة مش متوفرة الملاحظة ما بتتحطبش، أو بتتحطب
 * وهي بتقول «غير مقاس». التكرار محروس بتوقيع (sha) لكل حالة — نفس الحالة ما تتكررش،
 * والمتغيرة تتقال فورًا.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import { broadcastEvent, getHubClientCount } from "../ws-hub";
import { toolchainStatus } from "../ops/toolchain";
import { vaultStatus } from "../ops/findings-vault";
import { readPermanentVault, permanentVaultDrift } from "../ops/permanent-vault";
import { libraryStatus } from "../ops/advisory-library";
import { liveVerifyView } from "../ops/live-verify";
import { getJobs } from "../nova-cron";

export interface WatchNote {
  id: string;
  at: string;
  kind: string;
  text: string;
  evidence: Record<string, unknown>;
}

interface LogFile {
  updatedAt: string | null;
  seen: Record<string, string>;
  notes: WatchNote[];
}

const MAX_NOTES = 80;
const sha = (o: unknown): string => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 12);

function logPath(): string {
  return path.resolve(process.cwd(), "state", "proactive-log.json");
}

function readLog(): LogFile {
  try {
    const raw = JSON.parse(fs.readFileSync(logPath(), "utf8")) as Partial<LogFile>;
    return {
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
      seen: raw.seen && typeof raw.seen === "object" ? (raw.seen as Record<string, string>) : {},
      notes: Array.isArray(raw.notes) ? (raw.notes as WatchNote[]) : [],
    };
  } catch {
    return { updatedAt: null, seen: {}, notes: [] };
  }
}

function writeLog(log: LogFile): boolean {
  try {
    const p = logPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify(log, null, 2)}\n`, "utf8");
    return true;
  } catch (err) {
    logger.warn({ err: String(err) }, "watchers: log not writable");
    return false;
  }
}

function readHuntFile(): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "state", "hunt-latest.json"), "utf8")) as Record<string, unknown>;
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

/** الأرقام اللي بتتقال لازم تكون من الملف نفسه — مش من حساب في الكود. */
function numberFields(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  return Object.entries(obj as Record<string, unknown>)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .map(([k, v]) => `${k}=${v as number}`)
    .join(" · ");
}

interface Candidate {
  kind: string;
  sig: string;
  text: string;
  evidence: Record<string, unknown>;
}

/* ── الملاحقين ─────────────────────────────────────────────────────────────── */

function watchHunt(): Candidate | null {
  const h = readHuntFile();
  if (!h) return null;
  const at = typeof h.at === "string" ? h.at : null;
  const verdict = typeof h.verdict === "string" ? h.verdict : null;
  const findings = Array.isArray(h.findings) ? h.findings.length : null;
  const nums = numberFields(h.totals);
  return {
    kind: "hunt",
    sig: sha({ at, verdict, findings, totals: h.totals ?? null }),
    text: [
      `جري الصيد اتحدّث (${at ?? "وقت غير مقاس"}).`,
      verdict ? `الحكم: ${verdict}.` : null,
      nums ? `مجاميع الملف: ${nums}.` : "مفيش مجاميع في الملف.",
      typeof h.says_ar === "string" ? h.says_ar : null,
    ]
      .filter(Boolean)
      .join(" "),
    evidence: { file: "state/hunt-latest.json", at, verdict, totals: h.totals ?? null, findings, elapsedMs: h.elapsedMs ?? null },
  };
}

function watchVault(): Candidate | null {
  const s = vaultStatus();
  if (!s.present) return null;
  const c = s.counts as { total?: number; verified?: number };
  const gap = typeof c.total === "number" && typeof c.verified === "number" ? c.total - c.verified : null;
  return {
    kind: "vault",
    sig: sha({ total: c.total, verified: c.verified, updatedAt: s.updatedAt }),
    text: `الخزنة: ${c.total ?? "غير مقاس"} نتيجة، منها ${c.verified ?? "غير مقاس"} موثقة${gap ? ` — ${gap} لسه ناقصة توثيق` : ""}. آخر تعديل: ${s.updatedAt ?? "غير مقاس"}.`,
    evidence: { file: s.path, counts: s.counts, updatedAt: s.updatedAt },
  };
}

/**
 * الخزنة الدائمة: أهم ملفات المستودع (11 اكتشاف + براهينهم). المراقب ده بيقول
 * لو الرقم المكتوب في الملف سايق عن العدد الحقيقي، ولو برهان اتسجّل في الخزنة
 * وملفّه مش على القرص — وده بيحصل فعلًا، فأسكت عليه مش مقبول.
 */
function watchPermanentVault(): Candidate | null {
  const v = readPermanentVault(50);
  if (!v.present) return null;
  const drift = permanentVaultDrift(v);
  const missingEvidence = v.vulnerabilities.filter((r) => r.evidencePath && !r.evidenceOnDisk);
  const noEvidence = v.vulnerabilities.filter((r) => !r.evidencePath);
  const sig = sha({ counts: v.counts, updatedAt: v.updatedAt, missing: missingEvidence.map((r) => r.id), drift: drift.detail });
  const bits = [
    `الخزنة الدائمة: ${v.counts.vulnerabilities} ثغرة · ${v.counts.notes} ملاحظة · ${v.counts.reports} تقرير · ${v.counts.rules} قاعدة (آخر تحديث ${v.updatedAt ?? "غير مقاس"}).`,
  ];
  if (drift.countMismatch) bits.push(`العدد المكتوب مش مطابق للملف: ${drift.detail}.`);
  if (missingEvidence.length) bits.push(`${missingEvidence.length} سجل برهانه مسجّل ومش موجود على القرص: ${missingEvidence.map((r) => r.id).join(", ")}.`);
  if (noEvidence.length) bits.push(`${noEvidence.length} سجل من غير مسار دليل خالص.`);
  return { kind: "permanent-vault", sig, text: bits.join(" "), evidence: { file: v.path, counts: v.counts, updatedAt: v.updatedAt, drift, missingEvidence: missingEvidence.map((r) => ({ id: r.id, evidencePath: r.evidencePath })) } };
}

function watchAdvisories(): Candidate | null {
  const ls = libraryStatus();
  if (!ls.measured) {
    return {
      kind: "advisories",
      sig: "unmeasured",
      text: "مكتبة الاستشارات لسه ما اتزامنتش على المكنة دي — البحث فيها هيقول «مفيش بيانات» بصراحة.",
      evidence: { source: ls.source, measured: false },
    };
  }
  const age = typeof ls.ageMin === "number" ? ls.ageMin : null;
  // أقل من 24 ساعة = طازجة، مفيش سبب نقاطع المستخدم.
  if (age !== null && age <= 1440) return null;
  return {
    kind: "advisories",
    sig: sha({ at: ls.at, total: ls.total }),
    text: `مكتبة الاستشارات اتقادمة: ${ls.total} استشارة، آخر مزامنة قبل ${age ?? "وقت غير مقاس"} دقيقة.`,
    evidence: { total: ls.total, at: ls.at, ageMin: ls.ageMin, source: ls.source },
  };
}

function watchVerify(): Candidate | null {
  const v = liveVerifyView();
  if (!v.measured) return null;
  const nums = numberFields(v.counts);
  return {
    kind: "verify",
    sig: sha({ at: v.at, verdict: v.verdict, counts: v.counts }),
    text: [
      `تقرير التحقق الحيّ: ${v.verdict ?? "لا حكم"}.`,
      nums || null,
      v.failedChecks.length ? `فحوصات وقعت: ${v.failedChecks.join(", ")}.` : "مفيش فحص واقع.",
    ]
      .filter(Boolean)
      .join(" "),
    evidence: { at: v.at, verdict: v.verdict, counts: v.counts, tools: v.tools, failedChecks: v.failedChecks },
  };
}

function watchToolchain(): Candidate | null {
  const t = toolchainStatus();
  return {
    kind: "toolchain",
    sig: sha({ present: t.present, missing: t.missing, writable: t.writable }),
    text: t.present.length
      ? `الأدوات الموجودة على المكنة دي: ${t.present.join(" · ")} في \`${t.dir}\`${
          t.missing.length ? ` — ناقص ${t.missing.length} تتنزّل بـ tools_install` : ""
        }.`
      : `مفيش أداة في \`${t.dir}\` — الصيد التقيل بيتم في CI. أقدر أنزّل اللي يتنزّل بـ tools_install، والباقي محتاج مكنة فيها مساحة وصلاحيات.`,
    evidence: { dir: t.dir, exists: t.exists, files: t.files.length, present: t.present, missing: t.missing, writable: t.writable },
  };
}

/**
 * المهام الدائمة: بتتقال مرة كل تغيير، وخطوة زيادة الأخطاء ليها نص خاص.
 * `prevErrors` قاعدي من `seen` نفسه فالعدّاد ما بيترجعش لصفر مع إعادة التشغيل.
 */
function watchCron(prevErrors: number): Candidate {
  const jobs = getJobs();
  const errors = jobs.reduce((n, j) => n + (j.errorCount ?? 0), 0);
  const runs = jobs.reduce((n, j) => n + (j.runCount ?? 0), 0);
  const failing = jobs.filter((j) => (j.errorCount ?? 0) > 0);
  const evidence = {
    jobs: jobs.map((j) => ({
      id: j.id,
      enabled: j.enabled,
      runCount: j.runCount,
      errorCount: j.errorCount,
      lastRun: j.lastRun ?? null,
      lastResult: j.lastResult ?? null,
    })),
  };
  if (errors > prevErrors && failing.length) {
    return {
      kind: "cron",
      sig: sha({ errors, failing: failing.map((j) => [j.id, j.errorCount]) }),
      text: `${errors - prevErrors} محاولة فاشلة في المهام الدائمة (${failing.map((j) => `${j.id}:${j.errorCount}`).join(", ")})${
        failing[0]?.lastResult ? ` — آخر نتيجة: «${failing[0].lastResult}»` : ""
      }.`,
      evidence,
    };
  }
  return {
    kind: "pulse",
    sig: sha({ runs, errors }),
    text: jobs.length
      ? `المهام الدائمة: ${jobs.filter((j) => j.enabled).length}/${jobs.length} مفعّلة، ${runs} تنفيذ، ${errors} خطأ.`
      : "مفيش مهمة دائمة مسجّلة.",
    evidence,
  };
}

/* ── التوصيل: بث حيّ + تليجرام لو المفاتيح موجودة ──────────────────────────── */

async function deliver(note: WatchNote): Promise<Record<string, unknown>> {
  broadcastEvent("watch_note", note);
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const chat = process.env.TELEGRAM_CHAT_ID ?? "";
  if (!token || !chat) {
    return { channel: "telegram", ok: false, skipped: "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID مش موجودين في environment" };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `${note.text}\n\n(${note.kind} · ${note.at})` }),
      signal: AbortSignal.timeout(8000),
    });
    return { channel: "telegram", ok: r.ok, status: r.status };
  } catch (err) {
    return { channel: "telegram", ok: false, error: String((err as Error).message).slice(0, 120) };
  }
}

let ticking = false;

export async function watchTick(
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; at: string; emitted: WatchNote[]; checked: number; logWritten: boolean; delivery: Array<Record<string, unknown>> }> {
  const at = new Date().toISOString();
  if (ticking) return { ok: true, at, emitted: [], checked: 0, logWritten: false, delivery: [{ skipped: "tick شغال" }] };
  ticking = true;
  try {
    const log = readLog();
    const prevErrors = Number(log.seen["cron:errors"] ?? "0");
    const candidates = [
      watchHunt(),
      watchVault(),
      watchPermanentVault(),
      watchAdvisories(),
      watchVerify(),
      watchToolchain(),
      watchCron(Number.isFinite(prevErrors) ? prevErrors : 0),
    ].filter((c): c is Candidate => c !== null);

    const jobs = getJobs();
    log.seen["cron:errors"] = String(jobs.reduce((n, j) => n + (j.errorCount ?? 0), 0));

    const emitted: WatchNote[] = [];
    const delivery: Array<Record<string, unknown>> = [];
    for (const c of candidates) {
      const key = `${c.kind}:${c.sig}`;
      if (!opts.force && log.seen[key] === c.sig) continue;
      const note: WatchNote = { id: `${c.kind}-${c.sig}`, at, kind: c.kind, text: c.text, evidence: c.evidence };
      log.seen[key] = c.sig;
      log.notes = [note, ...log.notes].slice(0, MAX_NOTES);
      emitted.push(note);
      delivery.push(await deliver(note));
    }
    log.updatedAt = at;
    const logWritten = writeLog(log);
    logger.info({ emitted: emitted.length, checked: candidates.length }, "watchers: tick");
    return { ok: true, at, emitted, checked: candidates.length, logWritten, delivery };
  } finally {
    ticking = false;
  }
}

export function watchStatus(): {
  enabled: boolean;
  intervalMs: number;
  logPath: string;
  logPresent: boolean;
  lastTickAt: string | null;
  startedAt: string | null;
  notes: WatchNote[];
  hubClients: number;
} {
  const log = readLog();
  return {
    enabled: startedAt !== null,
    intervalMs: intervalMs(),
    logPath: logPath(),
    logPresent: fs.existsSync(logPath()),
    lastTickAt: log.updatedAt,
    startedAt,
    notes: log.notes,
    hubClients: getHubClientCount(),
  };
}

function intervalMs(): number {
  const raw = Number(process.env.NOVA_WATCH_INTERVAL_MS ?? "");
  return Number.isFinite(raw) && raw >= 30_000 ? raw : 300_000;
}

let timer: ReturnType<typeof setInterval> | null = null;
let startedAt: string | null = null;

export function startWatchers(): void {
  if (timer) return;
  if (process.env.NOVA_WATCHERS === "0") {
    logger.info("watchers: معطّل بـ NOVA_WATCHERS=0");
    return;
  }
  startedAt = new Date().toISOString();
  const ms = intervalMs();
  const run = (): void => {
    void watchTick().catch((err) => logger.warn({ err: String(err) }, "watchers: tick failed"));
  };
  setTimeout(run, 20_000);
  timer = setInterval(run, ms);
  logger.info({ ms }, "watchers: الصوت الدائم اتشغّل");
}

export function stopWatchers(): void {
  if (timer) clearInterval(timer);
  timer = null;
  startedAt = null;
}
