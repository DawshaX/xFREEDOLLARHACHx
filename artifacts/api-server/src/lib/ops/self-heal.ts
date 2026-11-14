/**
 * TEST10 — «البرنامج لما يلاقي خطأ يصلّحه من نفسه ويشوف الخطأ ويكبّر نفسه».
 *
 * runSelfHeal() بيقيس كل طبقة، واللي ينفع يتصحح بيتصحح فعلًا (الكوربوس المفقود
 * بيتوفر من السلسلة، الذاكرة والجلسات بيت initوا، المخزن بيتفحص، التطبيقات
 * المتصلة بتتاخد اختبار حي)، والنتيجة بتتسجّل كدروس في الذاكرة (scope
 * self-heal) عشان الدورة الجاية تبني عليها، وبيرفع إشعار حي بالـlink.
 * كل رقم في التقرير مقاس — مش ادعاء إصلاح.
 */
import { corpusStatus, provisionCorpus } from "./vuln-corpus";
import { initMemory, memoryStats, remember } from "../agent/memory-store";
import { initSessionNexus } from "../agent/session-nexus";
import { integrationsStatus, runIntegration, INTEGRATION_APPS } from "./integrations";
import { platformSelfReport } from "../agent/platform-tools";
import { createPushNotification } from "../push-hub";

export interface HealStep {
  layer: string;
  ok: boolean;
  fixed: boolean;
  measured: string;
  detail?: string;
}

export interface HealReport {
  ok: boolean;
  at: string;
  steps: HealStep[];
  fixedCount: number;
  says_ar: string;
}

const CHEAP_TEST_OP: Record<string, { op: string; args?: Record<string, string> }> = {
  github: { op: "list_repos" },
  gmail: { op: "list_messages", args: { max: "1" } },
  google_calendar: { op: "list_events", args: { max: "1" } },
  google_drive: { op: "list_files", args: { max: "1" } },
  google_docs: { op: "create_doc", args: { title: "NOVA self-heal probe", content: "اتأنشى أثناء الشفاء الذاتي — آمن للحذف" } },
  google_sheets: { op: "create_sheet", args: { title: "NOVA self-heal probe" } },
  google_slides: { op: "create_presentation", args: { title: "NOVA self-heal probe" } },
  notion: { op: "search", args: { query: "" } },
  linear: { op: "list_issues", args: { limit: "1" } },
  supabase: { op: "select", args: { table: "_prisma_migrations", limit: "1" } },
  vercel: { op: "list_projects" },
  dropbox: { op: "list_folder", args: { path: "" } },
};

export async function runSelfHeal(): Promise<HealReport> {
  const steps: HealStep[] = [];

  /* ① الذاكرة الدائمة */
  try {
    initMemory();
    const st = memoryStats();
    steps.push({ layer: "الذاكرة الدائمة", ok: true, fixed: false, measured: `${st.total} سجل · ${st.pinned ?? 0} مثبّت` });
  } catch (err) {
    steps.push({ layer: "الذاكرة الدائمة", ok: false, fixed: false, measured: "فشل init", detail: String(err).slice(0, 160) });
  }

  /* ② الجلسات المستمرة */
  try {
    initSessionNexus();
    steps.push({ layer: "الجلسات المستمرة", ok: true, fixed: false, measured: "nexus جاهز" });
  } catch (err) {
    steps.push({ layer: "الجلسات المستمرة", ok: false, fixed: false, measured: "فشل init", detail: String(err).slice(0, 160) });
  }

  /* ③ الكوربوس — لو ناقص أو غايب بيتوفر من السلسلة (شفاء فعلي) */
  try {
    const before = corpusStatus();
    if (!before.filePresent || (before.total ?? 0) < 1000) {
      const prov = await provisionCorpus({ force: true });
      const after = corpusStatus();
      steps.push({
        layer: "كوربوس الثغرات",
        ok: prov.ok,
        fixed: prov.ok && (after.total ?? 0) > (before.total ?? 0),
        measured: `قبل ${before.total ?? 0} → بعد ${after.total ?? 0} (${prov.action})`,
        detail: prov.ok ? undefined : prov.error,
      });
    } else {
      steps.push({ layer: "كوربوس الثغرات", ok: true, fixed: false, measured: `${before.total} صف · filePresent ✓` });
    }
  } catch (err) {
    steps.push({ layer: "كوربوس الثغرات", ok: false, fixed: false, measured: "فشل", detail: String(err).slice(0, 160) });
  }

  /* ④ مركز الإشعارات — المخزن بيتقاس */
  try {
    const { listPushNotifications } = await import("../push-hub");
    const n = listPushNotifications().length;
    steps.push({ layer: "مركز الإشعارات", ok: true, fixed: false, measured: `${n} إشعار مخزّن دائم` });
  } catch (err) {
    steps.push({ layer: "مركز الإشعارات", ok: false, fixed: false, measured: "فشل قراءة المخزن", detail: String(err).slice(0, 160) });
  }

  /* ⑤ الأدوات الحقيقية */
  try {
    const { AGENT_TOOL_NAMES } = await import("../agent/tools");
    const toolsN = AGENT_TOOL_NAMES.length;
    steps.push({ layer: "أدوات المنصة", ok: toolsN > 40, fixed: false, measured: `${toolsN} أداة مسجّلة في السجل` });
  } catch (err) {
    steps.push({ layer: "أدوات المنصة", ok: false, fixed: false, measured: "فشل التقرير", detail: String(err).slice(0, 160) });
  }

  /* ⑥ التطبيقات المتصلة — اختبار حي فعلي لأي تطبيق متصل (شفاء تشخيصي:
   * توكن ميت بيتكشف هنا بدل ما الأجينت يفشل في مهمة حقيقية) */
  try {
    const st = integrationsStatus();
    const connected = st.filter((s) => s.connected);
    const tested: string[] = [];
    for (const app of connected) {
      const cheap = CHEAP_TEST_OP[app.id];
      if (!cheap) continue;
      const r = await runIntegration(app.id, cheap.op, cheap.args ?? {});
      tested.push(`${app.icon}${app.nameAr}: ${r.ok ? "✓" : `✗ ${r.saysAr.slice(0, 60)}`}`);
    }
    steps.push({
      layer: "التطبيقات المتصلة",
      ok: true,
      fixed: false,
      measured: `${connected.length}/${INTEGRATION_APPS.length} متصل · ${tested.length ? tested.join(" · ") : "مافيش اختبار — ولا واحد متصل"}`,
    });
  } catch (err) {
    steps.push({ layer: "التطبيقات المتصلة", ok: false, fixed: false, measured: "فشل", detail: String(err).slice(0, 160) });
  }

  const fixedCount = steps.filter((s) => s.fixed).length;
  const okAll = steps.every((s) => s.ok);
  const report: HealReport = {
    ok: okAll,
    at: new Date().toISOString(),
    steps,
    fixedCount,
    says_ar: okAll
      ? `الشفاء الذاتي: ${steps.length} طبقة كلها سليمة · ${fixedCount} اتصلحت فعليًا`
      : `الشفاء الذاتي: ${steps.filter((s) => !s.ok).length} طبقة فيها مشكلة — التفاصيل مقاسة في الخطوات`,
  };

  /* التعلّم: الدروس بتتخزن — «يشوف الخطأ ويكبّر نفسه» يعني الدورة الجاية
   * تبقى أذكى باللي اتصلح. */
  try {
    remember({
      kind: "event",
      title: `شفاء ذاتي ${report.ok ? "سليم" : "فيه مشاكل"} — ${fixedCount} إصلاح`,
      content: steps.map((s) => `${s.layer}: ${s.measured}${s.detail ? ` — ${s.detail}` : ""}`).join(" | ").slice(0, 600),
      scope: "self-heal",
      importance: fixedCount > 0 ? 8 : 5,
      source: "agent",
    });
  } catch { /* التخزين مايوقفش التقرير */ }

  try {
    createPushNotification({
      kind: report.ok ? "success" : "warning",
      title: "الشفاء الذاتي",
      body: report.says_ar,
      link: "/agent",
    });
  } catch { /* الإشعار مايوقفش التقرير */ }

  return report;
}
