/**
 * ذراع التحكم في الأتمتة — بيحوّل زر «الوضع المستقل» من كلام لحاجة شغالة.
 *
 * مفيش استيراد ثابت للديمون: بنجيبه بـ dynamic import عشان
 * `autonomous-daemon.ts` → `ops/autonomy.ts` → (لو استوردتنا) تدور حلقة استيراد.
 */
import { effectiveAutonomy, writeAutonomyRecord, envLock, isAutonomyLevel, autonomyStateFile, type AutonomyLevel } from "./autonomy-state";
import { emitAutonomyEvent, autonomyListenerCount } from "./autonomy-events";

export interface AutonomyStatus {
  enabled: boolean;
  level: AutonomyLevel;
  source: "panel" | "env" | "default";
  updatedAt: string;
  file: string;
  fileExists: boolean;
  lockedByEnv: boolean;
  envValue: string;
  /** حالة الديمون الحقيقي — متقروءة من brain-state مش من الذاكرة */
  daemon: { running: boolean; state: string; cycles: number; lastHeartbeatAt: string; activeTarget: string };
  /** كام عميل مستني الـstream دلوقتي (لو 0 فمفيش حد بيتفرج) */
  subscribers: number;
}

async function daemonRef() {
  const mod = await import("./autonomous-daemon");
  return mod;
}

export async function autonomyStatus(): Promise<AutonomyStatus> {
  const eff = effectiveAutonomy();
  let daemon: AutonomyStatus["daemon"] = { running: false, state: "unknown", cycles: 0, lastHeartbeatAt: "", activeTarget: "" };
  try {
    const mod = await daemonRef();
    const st = mod.loadBrainState();
    daemon = {
      running: typeof mod.isAutonomousDaemonRunning === "function" ? mod.isAutonomousDaemonRunning() : false,
      state: st.daemonStatus?.state ?? "unknown",
      cycles: Number(st.daemonStatus?.autonomousCyclesCompleted ?? 0),
      lastHeartbeatAt: st.daemonStatus?.lastHeartbeatAt ?? "",
      activeTarget: st.whereAmINow?.activeTarget ?? "",
    };
  } catch (e) {
    daemon.state = `unreadable: ${e instanceof Error ? e.message : String(e)}`;
  }
  return {
    enabled: eff.enabled,
    level: eff.level,
    source: eff.source,
    updatedAt: eff.updatedAt,
    file: autonomyStateFile(),
    fileExists: eff.fileExists,
    lockedByEnv: envLock().locked,
    envValue: String(process.env.NOVA_OPS_AUTONOMY ?? ""),
    daemon,
    subscribers: autonomyListenerCount(),
  };
}

/**
 * تشغيل/إيقاف حقيقي: بنكتب الملف، بنبلّغ الديمون، وبنردّ بالحالة اللي
 * اتقريت بعد الكتابة — مش باللي طلبه المستخدم. لو الكتابة باظت (قرص مقفول)
 * الرد هيكون ok:false، فمفيش واجهة هتلمع على الفاضي.
 */
export async function setAutonomy(opts: { enabled: boolean; level?: string; note?: string }): Promise<{ ok: boolean; status: AutonomyStatus; error?: string }> {
  const status0 = await autonomyStatus();
  if (status0.lockedByEnv) {
    return {
      ok: false,
      status: status0,
      error: `المشغّل قافل الأتمتة/محدّدها بـ NOVA_OPS_AUTONOMY=${status0.envValue} — الزر مش هيتجاوز قرار المشغّل.`,
    };
  }
  const wanted: AutonomyLevel = opts.level && isAutonomyLevel(opts.level) ? (opts.level.trim().toLowerCase() as AutonomyLevel) : opts.enabled ? status0.level === "off" ? "passive" : status0.level : "off";
  const written = writeAutonomyRecord({
    enabled: opts.enabled,
    level: wanted,
    updatedAt: new Date().toISOString(),
    source: "panel",
    note: opts.note,
  });
  if (!written.ok) return { ok: false, status: await autonomyStatus(), error: `كتابة ${written.path} باظت: ${written.error}` };

  try {
    const mod = await daemonRef();
    if (opts.enabled) {
      mod.startAutonomousBackgroundDaemon();
      emitAutonomyEvent("enabled", { level: wanted, note: opts.note ?? null });
    } else {
      mod.stopAutonomousBackgroundDaemon?.();
      emitAutonomyEvent("disabled", { note: opts.note ?? null });
    }
  } catch (e) {
    return { ok: false, status: await autonomyStatus(), error: `الحالة اتسجلت لكن الديمون ما اتردّش: ${e instanceof Error ? e.message : String(e)}` };
  }
  const after = await autonomyStatus();
  if (after.enabled !== opts.enabled) {
    return { ok: false, status: after, error: `الحالة بعد القراءة (${after.level}) مش مطابقة للطلب — في قفل تاني بيتحكم.` };
  }
  return { ok: true, status: after };
}

/** الدورة دي لحظياً — عشان الزر يبان أنه شغال فعلاً مش مستني 3 دقايق */
export async function runAutonomyTickNow(target?: string): Promise<{ ok: boolean; error?: string; cycles?: number }> {
  try {
    const mod = await daemonRef();
    emitAutonomyEvent("tick_start", { manual: true, target: target ?? null });
    const st = await mod.tickAutonomousDaemon(target);
    emitAutonomyEvent("tick_done", { cycles: st.daemonStatus?.autonomousCyclesCompleted ?? null });
    return { ok: true, cycles: Number(st.daemonStatus?.autonomousCyclesCompleted ?? 0) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emitAutonomyEvent("tick_error", { error: msg });
    return { ok: false, error: msg };
  }
}
