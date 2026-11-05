/**
 * NOVA Doctor — one request that says what is broken and how to fix it.
 * ────────────────────────────────────────────────────────────────────────
 * Why this exists
 *   «هو شغّال؟» كان سؤالًا بيتطلب من إنسان يفتح ست كروت ويقارن أرقام. الأسوأ:
 *   الحاجة اللي بتقع فعلاً (نسخة مش اتعملها restart، ماكينة Private، كوربوس قديم)
 *   كانت بتفضل خضرا في كل مكان، لأن كل كارت بيقيس حاجة واحدة بس ومحدش بيجمّعها.
 *
 * Rules
 *   • كل قيمة هنا **مقاسة** في الطلب نفسه — مفيش ثابت مكتوب بيقول «تمام».
 *   • كل `fail` معاها `fix_ar` فيه الأمر أو اللينك اللي بيحلها، مش نصيحة عامة.
 *   • `score` = نسبة الفحوصات اللي حالتها `ok`، و`ready` = مفيش `fail` خالص.
 *     `warn` مش بيوقف `ready` (زي وكيل مش متصل) لكن بيظهر عشان محدش يتفاجئ.
 */

import fs from "node:fs";
import path from "node:path";
import { loadServers, probeAll } from "./server-registry";
import { corpusStatus } from "./ops/vuln-corpus";
import { buildDrift, supervisedNow } from "./self-restart";
import { listConfiguredProviders } from "./agent/llm";

export type DoctorState = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  state: DoctorState;
  value: string;
  says_ar: string;
  fix_ar?: string;
}

export interface DoctorReport {
  ok: boolean;
  now: number;
  ready: boolean;
  score: number;
  counts: { ok: number; warn: number; fail: number; total: number };
  checks: DoctorCheck[];
  says_ar: string;
}

function memoryFile(): string {
  if (process.env.NOVA_MEMORY_FILE) return path.resolve(process.env.NOVA_MEMORY_FILE);
  const dir = process.env.NOVA_STATIC_DIR ? path.resolve(process.env.NOVA_STATIC_DIR, "..") : process.cwd();
  return path.join(dir, "state/nova-memory.json");
}

/** Bytes on disk, or null when the file is missing (not the same as empty). */
function fileBytes(file: string): number | null {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  /* 1. Is the running code the shipped code? */
  const drift = buildDrift();
  if (!drift.boot.builtAt || !drift.disk.builtAt) {
    checks.push({
      id: "build",
      label: "الكود الشغّال",
      state: "warn",
      value: "بلا build.json",
      says_ar: "مفيش بصمة بناء — النسخة دي أقدم من نظام build.json، فمش ممكن نتأكد إن اللي شغّال هو اللي اتنشر.",
      fix_ar: "نزّل حزمة nova-24-7 الحديثة من الريليس وافكّها فوق القديمة (state/ محفوظ).",
    });
  } else if (drift.stale) {
    checks.push({
      id: "build",
      label: "الكود الشغّال",
      state: "fail",
      value: `${drift.boot.commit?.slice(0, 7) ?? "?"} ≠ ${drift.disk.commit?.slice(0, 7) ?? "?"}`,
      says_ar: `الملفات على الديسك من ${drift.disk.builtAt} والعملية الشغّالة بدأت من ${drift.boot.builtAt} — النسخة الجديدة اتنزلت ومحدش شغّلها.`,
      fix_ar: "curl -s https://<host>/api/nova-core/restart  (أو زرار «شغّل النسخة الجديدة» في صفحة /nova-fleet)",
    });
  } else {
    checks.push({
      id: "build",
      label: "الكود الشغّال",
      state: "ok",
      value: drift.boot.commit?.slice(0, 7) ?? "?",
      says_ar: `العملية الشغّالة هي نفس النسخة اللي على الديسك (${drift.boot.builtAt}).`,
    });
  }

  /* 2. The machines: measured, never assumed. */
  const servers = loadServers();
  let upCount = 0;
  let httpsUp = 0;
  try {
    const probes = await probeAll(servers);
    // A probe does not carry `base` (it carries the origin that answered, `via`,
    // only when that differs) — so pair each probe with its registered server.
    const byId = new Map(servers.map((s) => [s.id, s]));
    const isHttps = (id: string) => (byId.get(id)?.base ?? "").startsWith("https://");
    upCount = probes.filter((p) => p.state === "up").length;
    httpsUp = probes.filter((p) => p.state === "up" && isHttps(p.id)).length;
  } catch {
    upCount = 0;
  }
  if (servers.length === 0) {
    checks.push({
      id: "machines",
      label: "الماكينات",
      state: "fail",
      value: "0",
      says_ar: "مفيش أي ماكينة مسجّلة — البرنامج شغّال على السيرفر ده بس، ومش عارف يوصل لنفسه من برّه.",
      fix_ar: "POST /api/fleet/servers {name, base} — أو من صفحة /nova-fleet ضيف رابط أي سيرفر عندك.",
    });
  } else if (upCount === 0) {
    checks.push({
      id: "machines",
      label: "الماكينات",
      state: "fail",
      value: `0/${servers.length}`,
      says_ar: `الماكينات ${servers.length} كلها مش بترد — يعني اللي بيضيف/بيقرأ الأسطول مش شايف ولا ماكينة شغّالة.`,
      fix_ar: "GET /api/fleet/servers?peers=0 وشوف error كل ماكينة — غالبًا البورت Private (GitHub Codespace) أو الرابط غلط.",
    });
  } else if (httpsUp === 0) {
    checks.push({
      id: "machines",
      label: "الماكينات",
      state: "warn",
      value: `${upCount}/${servers.length} · بلا HTTPS`,
      says_ar: `فيه ${upCount} ماكينة بترد، بس كلها http — أي متصفح على https هيمنع الطلبات (mixed content).`,
      fix_ar: "اعمل subdomain مجاني بـHTTPS في لوحة الاستضافة (خطوات Waifly في deploy/machines/waifly-live.md §6).",
    });
  } else {
    checks.push({
      id: "machines",
      label: "الماكينات",
      state: upCount === servers.length ? "ok" : "warn",
      value: `${upCount}/${servers.length}`,
      says_ar: `${upCount} من ${servers.length} ماكينة بترد دلوقتي، منهم ${httpsUp} بـHTTPS.`,
      fix_ar: upCount === servers.length ? undefined : "GET /api/fleet/servers وشوف error الماكينات اللي مش بترد.",
    });
  }

  /* 3. The brain: who answers when it thinks. */
  let providerCount = 0;
  try {
    providerCount = (await listConfiguredProviders()).length;
  } catch {
    providerCount = 0;
  }
  checks.push({
    id: "brain",
    label: "العقل",
    state: providerCount >= 2 ? "ok" : providerCount === 1 ? "warn" : "fail",
    value: String(providerCount),
    says_ar:
      providerCount >= 2
        ? `${providerCount} مزوّد متاح (مجلس بأكتر من صوت).`
        : providerCount === 1
          ? "مزوّد واحد بس — المجلس هيبقى صوت واحد بيوافق نفسه."
          : "مفيش أي مزوّد — البرنامج هيشتغل بالمخطط الحتمي، من غير عقل لغوي.",
    fix_ar: providerCount >= 2 ? undefined : "شغّل ollama محليًا أو سيب المزوّدين المجانيين (بدون مفاتيح) مفعّلين — NOVA_KEYLESS_LLM=1.",
  });

  /* 4. The corpus: how old is the truth. */
  let corpus: ReturnType<typeof corpusStatus> | null = null;
  try {
    corpus = corpusStatus();
  } catch {
    corpus = null;
  }
  if (!corpus?.measured || !corpus.total) {
    checks.push({
      id: "corpus",
      label: "الكوربوس",
      state: "fail",
      value: "0",
      says_ar: "الكوربوس مش مقاس — أي بحث عن ثغرة هيرجع «مفيش بيانات» بصراحة بدل رقم مخترع.",
      fix_ar: "POST /api/cve/sync (أو شغّل workflow «vuln-corpus» من تبويب Actions) — الملف بيتنزّل من GitHub.",
    });
  } else if ((corpus.ageMin ?? 0) > 48 * 60) {
    checks.push({
      id: "corpus",
      label: "الكوربوس",
      state: "warn",
      value: `${corpus.total.toLocaleString("en-US")} · ${Math.round((corpus.ageMin ?? 0) / 60)}س`,
      says_ar: `آخر مزامنة للكوربوس من ${Math.round((corpus.ageMin ?? 0) / 60)} ساعة — الثغرات الجديدة مش جوّه.`,
      fix_ar: "POST /api/cve/sync — أو استنى الـcron اليومي.",
    });
  } else {
    checks.push({
      id: "corpus",
      label: "الكوربوس",
      state: "ok",
      value: corpus.total.toLocaleString("en-US"),
      says_ar: `${corpus.total.toLocaleString("en-US")} ثغرة حقيقية، آخر مزامنة قبل ${corpus.ageMin} دقيقة.`,
    });
  }

  /* 5. The agents: the only way the mesh becomes a network. */
  let agents = 0;
  try {
    const { meshSnapshot } = await import("../routes/fleet-mesh");
    agents = Number((meshSnapshot().capacity as { agents?: { connected?: number } })?.agents?.connected ?? 0);
  } catch {
    agents = 0;
  }
  checks.push({
    id: "agents",
    label: "الوكلاء",
    state: agents > 0 ? "ok" : "warn",
    value: `${agents}/10`,
    says_ar:
      agents > 0
        ? `${agents} وكيل متصل — الأوامر بتتنفّذ على أجهزة حقيقية.`
        : "مفيش وكيل متصل: الأوامر بتتنفّذ على السيرفر نفسه بس، مش على أجهزة الأسطول.",
    fix_ar:
      agents > 0
        ? undefined
        : "curl -fsSL https://<host>/api/local-agent/download-agent | bash -s -- --id machine-1  (على أي ماكينة عندك)",
  });

  /* 6. Long-term memory: an empty file means it forgets everything. */
  const memFile = memoryFile();
  const bytes = fileBytes(memFile);
  if (bytes === null) {
    checks.push({
      id: "memory",
      label: "الذاكرة",
      state: "warn",
      value: "مفيش ملف",
      says_ar: `مفيش ملف ذاكرة على ${memFile} — أول محادثة هتنشئه، وكل اللي قبلها مش محفوظ.`,
      fix_ar: "ابعت رسالة واحدة في /nova-core (بتتحفظ تلقائيًا) أو POST /api/nova-core/memory.",
    });
  } else if (bytes === 0) {
    checks.push({
      id: "memory",
      label: "الذاكرة",
      state: "warn",
      value: "0 bytes",
      says_ar: "ملف الذاكرة موجود بس فاضي (0 bytes) — يعني مفيش ولا ذكرى اتحفظت على السيرفر ده.",
      fix_ar: "POST /api/nova-core/memory {text} مرة واحدة، أو اتكلم مع البرنامج في /nova-core — الحفظ بعدها تلقائي.",
    });
  } else {
    checks.push({
      id: "memory",
      label: "الذاكرة",
      state: "ok",
      value: `${Math.round(bytes / 1024)} KB`,
      says_ar: `الذاكرة الطويلة محفوظة على الديسك (${Math.round(bytes / 1024)} KB).`,
    });
  }

  /* 7. The updater: the one part that fails silently. */
  let update: {
    enabled?: boolean;
    restartNeeded?: boolean;
    lastResult?: string;
    lastCheckAt?: string | null;
  } | null = null;
  try {
    const { autoUpdateStatus } = await import("./auto-update");
    const st = autoUpdateStatus();
    update = { enabled: st.enabled, restartNeeded: st.restartNeeded, lastResult: st.lastResult, lastCheckAt: st.lastCheckAt };
  } catch {
    update = null;
  }
  if (!update?.enabled) {
    checks.push({
      id: "update",
      label: "التحديث الذاتي",
      state: "warn",
      value: "مقفول",
      says_ar: supervisedNow()
        ? "التحديث الذاتي متوقف بالمتغيرات (NOVA_AUTO_UPDATE=0) — التحديثات هتكون يدوية."
        : "التحديث الذاتي شغّال في الحزمة بس (محتاج boot.mjs كمُشرف) — النسخة دي اتشغّلت مباشرة.",
      fix_ar: "شغّل من start.sh/run (بيشغّل boot.mjs) أو اضبط NOVA_AUTO_UPDATE=1.",
    });
  } else if (update.restartNeeded) {
    checks.push({
      id: "update",
      label: "التحديث الذاتي",
      state: "fail",
      value: "restart-needed",
      says_ar: "نزلت نسخة جديدة والملفات اتغيّرت، بس العملية القديمة لسه شغّالة — ده بالظبط اللي بيخلّي الموقع بيجيب كود قديم.",
      fix_ar: "curl -s https://<host>/api/nova-core/restart",
    });
  } else {
    checks.push({
      id: "update",
      label: "التحديث الذاتي",
      state: "ok",
      value: update.lastResult ?? "idle",
      says_ar: `المُحدِّث شغّال، آخر نتيجة «${update.lastResult ?? "idle"}»${update.lastCheckAt ? ` قبل ${Math.round((Date.now() - Date.parse(update.lastCheckAt)) / 60000)} دقيقة` : ""}.`,
    });
  }

  const counts = {
    ok: checks.filter((c) => c.state === "ok").length,
    warn: checks.filter((c) => c.state === "warn").length,
    fail: checks.filter((c) => c.state === "fail").length,
    total: checks.length,
  };
  const score = Math.round((counts.ok / counts.total) * 100);
  const ready = counts.fail === 0;
  const firstFail = checks.find((c) => c.state === "fail");
  const firstWarn = checks.find((c) => c.state === "warn");

  const saysAr = ready
    ? counts.warn === 0
      ? `كل الفحوصات ${counts.total}/${counts.total} سليمة — البرنامج شغّال بالكامل.`
      : `مفيش عطل (${counts.total}/${counts.total} مقاس): ${counts.warn} تنبيه — أولهم ${firstWarn?.label}.`
    : `فيه ${counts.fail} عطل من ${counts.total}: ${firstFail?.label} — ${firstFail?.fix_ar ?? "شوف التفاصيل"}`;

  return {
    ok: true,
    now: Date.now(),
    ready,
    score,
    counts,
    checks,
    says_ar: saysAr,
  };
}
