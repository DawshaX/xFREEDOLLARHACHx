/**
 * NOVA — Tool Registry
 * ────────────────────
 * Every capability of the platform, exposed to the agent (and to the UI) as a
 * callable tool with a JSON schema. Implementations are REAL: they perform
 * network requests, DNS/TLS probes and mutate the platform's own memory and
 * mission store — nothing is faked.
 *
 * Safety:
 *  - All network calls have hard timeouts.
 *  - `web_fetch` refuses private/loopback hosts (SSRF guard).
 *  - `port_scan` is deliberately bounded (small port list, low concurrency).
 *  - `run_shell` exists but is DISABLED unless ENABLE_AGENT_SHELL=1.
 */

import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import {
  scanDns,
  scanHeaders,
  scanPorts,
  scanSsl,
  scanSubdomains,
  nvdSearch,
  githubSearch,
  exploitDbSearch,
  fetchUrlAsText,
} from "../security-tools";
import { searchCyberCorpus2400, getCorpusStats, KALI_ARSENAL_64 } from "../cyber-corpus-2099";
import {
  getConnectedAgentList,
  getAgentDeepProfile,
  preferredAgentId,
  execOnLocalAgent,
} from "../../routes/local-agent";
import { saveMemory, searchMemory, getAllMemories } from "../../routes/memory";
import { INTEGRATION_APPS, integrationsStatus, runIntegration } from "../ops/integrations";
import { createPushNotification } from "../push-hub";
import {
  remember,
  recall,
  forget,
  listMemories,
  memoryStats,
  type MemoryKind,
} from "./memory-store";
import {
  getMissionsState,
  setActiveMissionTarget,
  recordMissionCommand,
  recordMissionFinding,
  getEvidenceState,
  getReportsState,
} from "../standalone-api";
import { assertAuthorized, discoverProgram, fetchSecurityTxt, loadPrograms, upsertProgram, normalizeHost } from "../ops/scope";
import { provisionToolchainOnce } from "../ops/toolchain";
import { listVault, draftReport } from "../ops/findings-vault";
import { readPermanentVault, permanentVaultDrift, appendPermanentVaultFinding } from "../ops/permanent-vault";
import { libraryStatus, lookupCve, lookupProduct } from "../ops/advisory-library";
import { liveVerifyView } from "../ops/live-verify";
import { freeHostSummary, probeCatalogue } from "../ops/free-hosts";
import { autonomyLevel, autonomySummary } from "../ops/autonomy";
import { catalogStatus, huntCandidates } from "../ops/bounty-catalog";
import { vulnQuery } from "./vuln-keyword";
import { corpusStatus, queryCorpus } from "../ops/vuln-corpus";
import {
  buildReport,
  cancelJob,
  createJob,
  getJob,
  listJobs,
  pauseJob,
  resumeJob,
  runJob,
  verifyFinding,
} from "../ops/runner";
import { KIND_LIST, toolStatus } from "../ops/tools";
import { webSearch } from "./web-search";
import { forumSearch } from "./forum-search";
import {
  platformSelfReport,
  terminalExec,
  fileRead,
  fileWrite,
  fileList,
  processList,
  serviceStatus,
  uiNavigate,
  browserOpen,
  uiAction,
  memoryRecall,
} from "./platform-tools";

export interface AgentTool {
  name: string;
  title: string;
  description: string;
  category: "recon" | "intel" | "memory" | "mission" | "utility" | "platform" | "fleet";
  risk: "safe" | "active" | "sensitive" | "risky";
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolRunResult {
  ok: boolean;
  /** Short human summary (Arabic) shown in the UI timeline. */
  summary: string;
  /** Structured data for the model + UI. */
  data: unknown;
  ms: number;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const PRIVATE_RE =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[0-1])\.|::1|fc00:|fe80:|localhost$)/i;

function normaliseHost(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

async function assertPublicHost(host: string): Promise<void> {
  if (!host) throw new Error("النطاق مطلوب (domain required)");
  if (PRIVATE_RE.test(host) || host === "localhost") {
    throw new Error(`الهدف ${host} داخلي/محلي — مسموح فقط للأهداف العامة المصرّح بها`);
  }
  const addrs = await dns.resolve4(host).catch(() => [] as string[]);
  const bad = addrs.find((ip) => PRIVATE_RE.test(ip));
  if (bad) throw new Error(`النطاق يُحل إلى عنوان داخلي (${bad}) — محجوب لحماية SSRF`);
}

function summariseHeaders(h: Record<string, unknown>): string {
  const status = h["status"] ?? h["statusCode"];
  const server = (h["server"] as string) || "—";
  return `HTTP ${status ?? "?"} · server: ${server}`;
}

/* ── registry ────────────────────────────────────────────────────────────── */

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "recon_target",
    title: "استطلاع شامل للهدف",
    description: "يجمع DNS + ترويسات HTTP + شهادة TLS في نداء واحد. ابدأ به دائماً عند ذكر نطاق جديد.",
    category: "recon",
    risk: "active",
    input_schema: { type: "object", properties: { target: { type: "string", description: "النطاق مثل example.com" } }, required: ["target"] },
  },
  {
    name: "dns_lookup",
    title: "استعلام DNS",
    description: "سجلات A / AAAA / MX / TXT / NS / CNAME / DMARC للنطاق.",
    category: "recon",
    risk: "safe",
    input_schema: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] },
  },
  {
    name: "tls_audit",
    title: "تدقيق شهادة TLS",
    description: "إصدار الشهادة، المُصدر، تاريخ الانتهاء، البروتوكول، والتحقق من الصلاحية.",
    category: "recon",
    risk: "active",
    input_schema: {
      type: "object",
      properties: { host: { type: "string" }, port: { type: "number", description: "افتراضي 443" } },
      required: ["host"],
    },
  },
  {
    name: "http_headers_audit",
    title: "تدقيق ترويسات الأمان",
    description: "يفحص HSTS وCSP وX-Frame-Options وReferrer-Policy وغيرها مع درجة أمان.",
    category: "recon",
    risk: "active",
    input_schema: {
      type: "object",
      properties: { host: { type: "string" }, https: { type: "boolean", description: "افتراضي true" } },
      required: ["host"],
    },
  },
  {
    name: "port_scan",
    title: "فحص منافذ محدود",
    description: "فحص TCP غير تدميري على قائمة منافذ شائعة (حد أقصى 40 منفذاً).",
    category: "recon",
    risk: "active",
    input_schema: {
      type: "object",
      properties: { host: { type: "string" }, ports: { type: "array", items: { type: "number" } } },
      required: ["host"],
    },
  },
  {
    name: "subdomain_enum",
    title: "تعداد النطاقات الفرعية",
    description: "استعلامات CRT.SH والـ DNS لاكتشاف نطاقات فرعية عامة.",
    category: "recon",
    risk: "active",
    input_schema: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] },
  },
  {
    name: "web_fetch",
    title: "جلب صفحة/ملف",
    description: "جلب محتوى نصي من URL عام لتحليله (محجوب ضد العناوين الداخلية).",
    category: "recon",
    risk: "active",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "web_search",
    title: "بحث في النت",
    description:
      "بحث حقيقي في الويب بلا أي مفتاح ولا حساب: DuckDuckGo (نتائج فورية) ثم ويكيبيديا كاحتياطي. يرجع عناوين + روابط + مقتطفات، ولو فشل الاتنين بيرجع سبب الفشل صريح.",
    category: "intel",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    },
  },

  {
    name: "forum_search",
    title: "بحث في المنتديات الأخلاقية",
    description:
      "بحث في منتدى الهاكرز الأخلاقي (HackTheForum، XSS.is، Nulled، وغيره) عن ثغرات، أدوات، وبيانات نوقشت بالفعل. مرجعي للتعلم من المجتمع، مش للتنفيذ المباشر.",
    category: "intel",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    },
  },
  {
    name: "cve_lookup",
    title: "بحث ثغرة برقم CVE",
    description: "جلب تفاصيل CVE من NVD (CVSS، الوصف، المراجع).",
    category: "intel",
    risk: "safe",
    input_schema: { type: "object", properties: { cveId: { type: "string" } }, required: ["cveId"] },
  },
  {
    name: "vuln_search",
    title: "بحث ثغرات بالكلمات",
    description: "بحث في NVD بكلمة مفتاحية (منتج/تقنية).",
    category: "intel",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { keyword: { type: "string" }, limit: { type: "number" } },
      required: ["keyword"],
    },
  },
  {
    name: "exploit_search",
    title: "بحث استغلالات معروفة",
    description: "بحث في Exploit-DB عن POCs منشورة.",
    category: "intel",
    risk: "safe",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "github_search",
    title: "بحث GitHub",
    description: "مستودعات أمنية / أدوات / POCs على GitHub.",
    category: "intel",
    risk: "safe",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "knowledge_search",
    title: "بحث في فهرس المنصة",
    description: "بحث في فهرس الثغرات الداخلي (3,300+ نمط) عن فئة ثغرة وطريقة فحص آمنة.",
    category: "intel",
    risk: "safe",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "kali_toolbox",
    title: "دليل أدوات Kali",
    description: "يعرض الأداة المناسبة من ترسانة Kali مع أمر جاهز معدّل للهدف.",
    category: "intel",
    risk: "safe",
    input_schema: { type: "object", properties: { query: { type: "string" }, target: { type: "string" } } },
  },
  {
    name: "memory_save",
    title: "حفظ في الذاكرة طويلة الأمد",
    description:
      "يحفظ حقيقة أو درساً أو تفضيلاً في الذاكرة الدائمة على القرص — تفضل موجودة بعد إعادة التشغيل وبعد شهور. استخدمها كلما عرفت شيئاً مهماً عن الهدف أو عن طريقة عمل المستخدم.",
    category: "memory",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "عنوان قصير ثابت لسهولة التحديث" },
        content: { type: "string" },
        kind: { type: "string", enum: ["fact", "preference", "lesson", "event", "session"] },
        scope: { type: "string", description: "الهدف/النطاق، افتراضي global" },
        importance: { type: "number", description: "1..10" },
        pinned: { type: "boolean" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "memory_search",
    title: "بحث في الذاكرة طويلة الأمد",
    description: "يبحث في كل ما تعرفه من جلسات سابقة ويرتّب النتائج حسب الصلة والأهمية.",
    category: "memory",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        scope: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_list",
    title: "كل الذاكرة",
    description: "آخر الإدخالات المحفوظة (أو الأهم) مع إحصائيات المخزن الدائم.",
    category: "memory",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        kind: { type: "string", enum: ["fact", "preference", "lesson", "event", "session"] },
        sort: { type: "string", enum: ["recent", "important"] },
      },
    },
  },
  {
    name: "memory_forget",
    title: "نسيان ذكرى",
    description: "يحذف ذكرى خاطئة أو قديمة من الذاكرة الدائمة بالمعرّف.",
    category: "memory",
    risk: "safe",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "memory_stats",
    title: "إحصائيات الذاكرة",
    description: "حجم الذاكرة طويلة الأمد وتوزيعها على الأنواع والأهداف.",
    category: "memory",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_active_target",
    title: "تحديد الهدف النشط",
    description: "يضبط الهدف النشط في المنصة (تستخدمه كل الأدوات والصفحات).",
    category: "mission",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { target: { type: "string" }, program: { type: "string", description: "اسم البرنامج مثل Google VRP" } },
      required: ["target"],
    },
  },
  {
    name: "record_finding",
    title: "تسجيل نتيجة",
    description: "يسجّل finding في المهمة النشطة مع درجة خطورة.",
    category: "mission",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        severity: { type: "string", description: "critical | high | medium | low | info" },
        detail: { type: "string" },
        tool: { type: "string" },
      },
      required: ["title", "detail"],
    },
  },
  {
    name: "mission_status",
    title: "حالة المهمة",
    description: "الهدف النشط، النتائج المسجلة، والأوامر المنفذة.",
    category: "mission",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "platform_status",
    title: "حالة المنصة",
    description: "صحة المنصة: الذاكرة، المهام، الأدلة، حجم الفهرس، وحالة الأدوات.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "hash_text",
    title: "بصمة SHA-256",
    description: "حساب بصمة تشفيرية لنص (للتحقق من الأدلة).",
    category: "utility",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" }, algo: { type: "string", description: "sha256 | sha1 | md5" } },
      required: ["text"],
    },
  },
  {
    name: "mission_create",
    title: "إنشاء مهمة",
    description: "ينشئ مهمة/مشروع فحص جديد بهدف واضح، ويجعله الهدف النشط.",
    category: "mission",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        target: { type: "string" },
        objective: { type: "string" },
        program: { type: "string" },
      },
      required: ["target"],
    },
  },
  {
    name: "report_generate",
    title: "توليد تقرير",
    description: "يبني تقرير Markdown جاهز للإرسال من نتائج المهمة الحالية (الملاحظات + الأدلة + الخطوات).",
    category: "mission",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        includeEvidence: { type: "boolean" },
      },
    },
  },
  {
    name: "evidence_list",
    title: "عرض الأدلة",
    description: "يسرد الأدلة المحفوظة في المنصة (لقطات/سجلات) وعددها.",
    category: "mission",
    risk: "safe",
    input_schema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "report_list",
    title: "عرض التقارير",
    description: "يسرد التقارير المُنشأة سابقاً في المنصة.",
    category: "mission",
    risk: "safe",
    input_schema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "corpus_stats",
    title: "إحصائيات فهرس المنصة",
    description: "أرقام فهرس الأمان الداخلي: عدد الأنماط، الطبقات، وأدوات Kali المتاحة.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "corpus_query",
    title: "بحث في الكوربوس الحقيقي (211K ثغرة)",
    description:
      "يبحث في الكوربوس الحقيقي المسحوب من NVD 2.0 + CISA KEV + EPSS عبر product/cve/minCvss/kevOnly — العدد الحقيقي من corpus_stats (بيتحدث كل ٣٠ د من الـCI) مش رقم مكتوب هنا.",
    category: "intel",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: {
        product: { type: "string", description: "اسم المنتج زي nginx أو apache" },
        cve: { type: "string", description: "رقم CVE زي CVE-2024-3094" },
        minCvss: { type: "number" },
        kevOnly: { type: "boolean", description: "المستغَلّة فعلياً فقط (CISA KEV)" },
        limit: { type: "number" },
      },
    },
  },
  // ── المرحلة 59: الكنوز اللي كانت في المستودع ومش متوصلة بالأجنت ──────────
  // `findings-vault` (النتايج الموثقة + مسودات الإفصاح)، `advisory-library`
  // (1071 استشارة GitHub)، `live-verify` (براهين الصفر-FP)، `free-hosts`
  // (الماكنات المجانية اللي تقدر تشيل الأدوات التقيلة)، `autonomy` (مستوى
  // الاستقلالية الحالي). كل الدول كانت مستوردة في الـroutes بس — فالأجنت كان
  // يوصف نفسه بـ49 أداة وهو فعليًا أقدر من كده بكتير.
  {
    name: "vault_list",
    title: "خزنة النتائج الموثقة",
    description: "يقرأ خزنة الاكتشافات الحقيقية: العدد، الموثق، وأحدث السجلات مع عدد أدلتها. ده المصدر الوحيد اللي تصح تتبني عليه ادعاءات «لقيت ثغرة».",
    category: "intel",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "كام سجل من 1 لـ20، افتراضي 5" }, severity: { type: "string" } },
    },
  },
  {
    name: "vault_draft",
    title: "مسودة إفصاح من الخزنة",
    description: "يولّد مسودة إفصاح جاهزة لسجل موجود في الخزنة (نفس اللي بيكتبه المنصة في state/disclosure-drafts).",
    category: "intel",
    risk: "sensitive",
    input_schema: { type: "object", properties: { key: { type: "string", description: "مفتاح السجل زي SKY-VULN-01" } }, required: ["key"] },
  },
  {
    name: "vuln_combine",
    title: "دمج ثغرات → فرضية زيرو داي",
    description:
      "يجمع 2+ ثغرات من الكوربوس الحقيقي (NVD+KEV+EPSS) ويحلّل دمجها كسلسلة استغلال (تقاطع CWE/المنتجات/CVSS) ويسجّل فرضية الدمج في الخزنة الدائمة (state/discovered-vulnerabilities-vault.json) عشان يتراجعها المالك أو يتحقق منها بفحص فعلي لاحقًا — اكتشاف تراكمي مش كلام.",
    category: "intel",
    risk: "sensitive",
    input_schema: {
      type: "object",
      properties: {
        cves: { type: "array", items: { type: "string" }, minItems: 2, description: "قائمة معرّفات CVE مثل ['CVE-2024-3400','CVE-2024-9474']" },
        noteAr: { type: "string", description: "ملاحظة/هجوم مقترح بالمصري" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["cves"],
    },
  },
  {
    name: "advisory_search",
    title: "مكتبة استشارات GitHub",
    description: "بدّور في الكاش المحلي لاستشارات GitHub (GHSA): حسب منتج أو حسب CVE، ومعاه حالة المكتبة ونضارتها.",
    category: "intel",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { product: { type: "string", description: "اسم منتج/حزمة" }, cve: { type: "string", description: "معرّف CVE للبحث العكسي" } },
    },
  },
  {
    name: "live_verify",
    title: "تقرير التحقق الحيّ",
    description: "يقرأ آخر تقرير تحقق حيّ: الحكم، الأدوات اللي اتنفذت، الفحوصات اللي وقعت، وعمر التقرير. ده البرهان مش الرأي.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "free_hosts",
    title: "الماكنات المجانية المتاحة",
    description: "بيقيس الاستضافة المجانية اللي تقدر تشغّل أدوات تقيلة (nmap/nuclei/ffuf) ويرجّع اللي شغال فعلاً. بيجاوب سؤال «منين نشتغل» بالقياس.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "autonomy_state",
    title: "مستوى الاستقلالية الحالي",
    description: "كم البرنامج مسموح لنفسه يشتغل لوحده دلوقتي: المستوى، آخر جولة، وعدد البرامج في الكتالوج — عشان أقول لك حدودي الحقيقية مش خيالي.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "task_list",
    title: "المهام والقدرات",
    description: "يسرد كل ما تستطيع نوفا تنفيذه الآن (أدواتها مصنّفة) — مفيد لما يسأل المستخدم «تقدر تعمل إيه؟».",
    category: "platform",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { category: { type: "string", description: "recon | intel | memory | mission | platform | utility" } },
    },
  },
  {
    name: "fleet_list",
    title: "قائمة الأجهزة المتصلة",
    description:
      "يعرض كل جهاز/وكيل متصل بالمنصة الآن (حتى 10 وكلاء و5 أجهزة وأكثر) مع نظامه وقدراته وعدد أدواته الأمنية.",
    category: "fleet",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "fleet_profile",
    title: "ملف جهاز تفصيلي",
    description:
      "يقرأ الملف العميق لجهاز متصل: الأدوات الأمنية المنصّبة، الواجهات الشبكية، الخدمات، الدوكر، والمستخدمين.",
    category: "fleet",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { agentId: { type: "string", description: "معرّف الجهاز (اتركه فارغاً للأول)" } },
    },
  },
  {
    name: "fleet_exec",
    title: "تنفيذ أمر على جهاز",
    description:
      "ينفّذ أمراً حقيقياً على جهاز متصل ويرجّع المخرجات. يحتاج وكيل NOVA شغّال على ذلك الجهاز. استخدمه بعد إذن المستخدم فقط.",
    category: "fleet",
    risk: "sensitive",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        agentId: { type: "string" },
        timeout: { type: "number", description: "مللي ثانية، الافتراضي 30000" },
      },
      required: ["command"],
    },
  },
  {
    name: "device_control_map",
    title: "دليل ربط الأجهزة",
    description:
      "يرجّع خطوات ربط جهاز جديد بالمنصة (أمر التثبيت الجاهز) لكل نظام تشغيل — استخدمه لو المستخدم سأل «إزاي أربط جهاز؟».",
    category: "fleet",
    risk: "safe",
    input_schema: { type: "object", properties: { platform: { type: "string", enum: ["linux", "macos", "windows"] } } },
  },

  /* ── ops: authorized programs, real jobs, evidence, verification ───────── */
  {
    name: "scope_check",
    title: "تأكّد إن الهدف مصرّح به",
    description:
      "قبل أي فحص نشط: يتأكد إن النطاق جوه برنامج مفعّل في state/programs.json (wildcard/CIDR/out-of-scope) ويعيد حدود المعدل. ابدأ به دائماً قبل أي job.",
    category: "platform",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string", description: "نطاق أو URL" },
        programId: { type: "string", description: "اختياري — لو عارف البرنامج" },
        active: { type: "boolean", description: "true = فحص نشط (لمس الخدمة)، false = مصادر عامة" },
      },
      required: ["target"],
    },
  },
  {
    name: "program_add",
    title: "تسجيل برنامج مصرّح به",
    description:
      "يضيف/يحدّث برنامج bug bounty في سجل التصريح مع نطاقاته وحدود المعدل، ويجيب سياسة الإفصاح من security.txt. محتاج موافقة المستخدم الصريحة على النطاقات.",
    category: "platform",
    risk: "sensitive",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        hosts: { type: "array", items: { type: "string" }, description: 'مثال: ["*.example.com"]' },
        out_of_scope: { type: "array", items: { type: "string" } },
        max_rps: { type: "number", description: "حد الطلبات/ثانية — الافتراضي 1" },
        passive_only: { type: "boolean" },
        policy_url: { type: "string" },
      },
      required: ["id", "hosts"],
    },
  },
  {
    name: "program_discover",
    title: "اكتشف برنامج بنفسك",
    description:
      "بيدخل برنامج من غير ما المستخدم يحرر JSON: بياخد نطاق عادي أو رابط صفحة برنامج، " +
      "يقرأ security.txt/السياسة بنفسه، ويسجّل النطاق في وضع الاستطلاع فقط. " +
      "الفحص النشط محتاج تأكيد إذن مكتوب من المستخدم — لو طلبه، ارجعله النص اللي لازم يقوله.",
    category: "platform",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string", description: 'نطاق أو رابط: "example.com" أو "https://hackerone.com/foo"' },
        name: { type: "string", description: "اسم اختياري للبرنامج" },
        activate: { type: "boolean", description: "طلب التفعيل للفحص النشط (لأول مرة برجّع شروط الإذن)" },
      },
      required: ["target"],
    },
  },
  {
    name: "program_list",
    title: "البرامج المسجّلة",
    description: "يعرض كل البرامج المصرّح بها وحالتها (مفعّل/مقفول، النطاقات، الحدود).",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "job_create",
    title: "إنشاء مهمة فحص حقيقية",
    description:
      "يبني job حقيقي على هدف مصرّح به: خطة مهام (DNS/TLS/ترويسات/منافذ/JS/CT-logs + أدوات النود لو منصوبة) ويشغّلها بمعدل آمن، ويخزّن الأدلة. ده هو «التنفيذ» مش العرض.",
    category: "mission",
    risk: "active",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        programId: { type: "string" },
        objective: { type: "string", description: "الهدف من الفحص بجملة" },
        depth: { type: "string", enum: ["passive", "standard", "deep"], description: "passive = من غير لمس الخدمة" },
        tools: { type: "boolean", description: "include real tool kinds (nuclei/httpx/katana/nmap) when present" },
        maxTasks: { type: "number" },
      },
      required: ["target"],
    },
  },
  {
    name: "job_status",
    title: "حالة مهمة",
    description: "بيرجّع حالة job: كل مهمة (done/failed/skipped + السبب)، الـfindings، وآخر سطور اللوج.",
    category: "mission",
    risk: "safe",
    input_schema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
  },
  {
    name: "job_list",
    title: "قايمة المهام",
    description: "كل مهام الفحص المخزّنة على القرص مع إحصائياتها — ده «إيه اللي شغال دلوقتي وإيه اللي خلص».",
    category: "mission",
    risk: "safe",
    input_schema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "job_control",
    title: "إيقاف/إكمال/إلغاء مهمة",
    description: "يتحكم في job شغال: pause | resume | cancel. استخدمه لو المستخدم قال «قف» أو «كمل».",
    category: "mission",
    risk: "sensitive",
    input_schema: {
      type: "object",
      properties: { jobId: { type: "string" }, action: { type: "string", enum: ["pause", "resume", "cancel"] } },
      required: ["jobId", "action"],
    },
  },
  {
    name: "finding_verify",
    title: "بوابة البرهان",
    description:
      "يعيد إنتاج الدليل لfinding ويقارن البصمة — من غيرها النتيجة ما تدخلش التقرير. اعملها لكل نتيجة قبل ما تكتب تقرير.",
    category: "mission",
    risk: "active",
    input_schema: {
      type: "object",
      properties: { jobId: { type: "string" }, findingId: { type: "string", description: "اتركه فاضي عشان يتحقق من كل غير المُتحقَّق" } },
      required: ["jobId"],
    },
  },
  {
    name: "findings_list",
    title: "نتائج مهمة",
    description: "كل الـfindings المخزّنة لـjob معDegree الخطورة والأدلة وحالة التحقق.",
    category: "mission",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { jobId: { type: "string" }, severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] } },
      required: ["jobId"],
    },
  },
  {
    name: "ops_kinds",
    title: "قدرات التنفيذ على النود",
    description: "بيقولك بصدق: أي أدوات أمنية منصوبة فعلاً على السيرفر/النودات المتصلة، وإيه اللي ناقص وأمر تثبيته.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "bounty_candidates",
    title: "مرشّحو منصات المكافآت",
    description:
      "يقرأ كتالوج الـ746 برنامج (HackerOne/Bugcrowd/Intigriti) ويرجّع الأفضل استجابة كمصدر **أفكار وأهداف للاطلاع** — مع `consented:false` لكل سطر: مافيش فحص نشط من هنا. استخدمها لما تلاك هدف مطلوب ومافيش نطاق في الجلسة، بدل ما تطلب من المستخدم نطاق.",
    category: "recon",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "كام مرشّح (الافتراضي 6، الحد 20)" },
        platform: { type: "string", enum: ["hackerone", "bugcrowd", "intigriti", ""], description: "منصة معيّنة" },
        q: { type: "string", description: "كلمة في الاسم أو النطاق" },
        minEfficiency: { type: "number", description: "أدنى جودة استجابة (0-100)" },
      },
    },
  },
  {
    name: "tools_install",
    title: "تجهيز أدواتي",
    description:
      "ينزّل النسخ الثابتة الرسمية (subfinder/httpx/nuclei/katana/dnsx/naabu/ffuf) في `vendor/bin` على المكنة اللي عليها المحرك — من غير root ومن غير apt ومن غير git. اعمليها أول ما لاقية أداة missing في `ops_kinds`، بدل ما تقولي «مافيش أدوات» وتوقفي.",
    category: "platform",
    risk: "active",
    input_schema: {
      type: "object",
      properties: { only: { type: "string", description: "اختياري: أسماء بفواصل، زي `nuclei,httpx`" } },
    },
  },
  {
    name: "job_report",
    title: "تقرير برنامج جاهز",
    description: "يبني تقرير Markdown من نتائج job — بس اللي عدّى بوابة البرهان. اربطه بزر الحفظ في /reports.",
    category: "mission",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { jobId: { type: "string" }, includeUnverified: { type: "boolean" } },
      required: ["jobId"],
    },
  },

  /* ── platform tools (أدوات المنصة) ────────────────────────────────────────
   * Added 2026-11-05. These let the agent act on the platform itself: read its
   * own measured state, drive the panel, and run commands / read files on a
   * connected node. `platform_self_report` is the one the persona and the claim
   * guard both rely on — it is the single source of every number the agent is
   * allowed to state about itself. */
  {
    name: "platform_self_report",
    title: "تقرير حالة المنصة (مقاس لحظيًا)",
    description:
      "يرجّع حالة كل جزء من المنصة مقاسة في هذه اللحظة: عدد الأجهزة المتصلة فعليًا (مش المسجّلة)، عدد الأدوات، حجم فهرس الثغرات، حجم الذاكرة، وقدرات العقدة. استخدمها قبل أي كلام عن قدراتك — ممنوع تقول رقم مش جاي من هنا.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "terminal_exec",
    title: "تنفيذ أمر على العقدة",
    description: "ينفّذ أمر شل على جهاز متصل بالأسطول ويرجّع المخرجات الحقيقية (stdout/stderr/exit code).",
    category: "platform",
    risk: "sensitive",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" }, agentId: { type: "string" }, timeoutMs: { type: "number" } },
      required: ["command"],
    },
  },
  {
    name: "file_read",
    title: "قراءة ملف على العقدة",
    description: "يقرأ محتوى ملف من جهاز متصل بالأسطول.",
    category: "platform",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, agentId: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "file_write",
    title: "كتابة ملف على العقدة",
    description: "يكتب محتوى في ملف على جهاز متصل بالأسطول (ينشئ المجلدات لو ناقصة).",
    category: "platform",
    risk: "sensitive",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" }, agentId: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "file_list",
    title: "سرد مجلد على العقدة",
    description: "يسرد محتويات مجلد على جهاز متصل بالأسطول.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: { path: { type: "string" }, agentId: { type: "string" } } },
  },
  {
    name: "process_list",
    title: "العمليات الشغّالة على العقدة",
    description: "يسرد أهم العمليات حسب استهلاك المعالج على جهاز متصل.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: { agentId: { type: "string" } } },
  },
  {
    name: "service_status",
    title: "حالة خدمة على العقدة",
    description: "يفحص حالة خدمة (systemd أو عملية) على جهاز متصل.",
    category: "platform",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, agentId: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "ui_navigate",
    title: "فتح صفحة في اللوحة",
    description: "ينقّل اللوحة لصفحة في المنصة — عن طريق قنات الأوامر، فيقال صراحة لو مفيش حد سامع.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "browser_open",
    title: "افتح متصفح (عندك في اللوحة)",
    description:
      "يفتح رابطًا في متصفح المستخدم عن طريق اللوحة، ويقرأ الصفحة كمان. مفيش متصفح على السيرفر؟ " +
      "التاب بيفتح عندك انت — فالجملة دي مش «مش قادر»، دي مكالمة حقيقية. لو مفيش لوحة متصلة بيقول كده بصراحة.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "ui_action",
    title: "تنفيذ إجراء في اللوحة",
    description: "يطلب من اللوحة تنفيذ إجراء مسمّى (تشغيل فحص، تغيير إعداد…) عبر WebSocket.",
    category: "platform",
    risk: "safe",
    input_schema: {
      type: "object",
      properties: { action: { type: "string" }, payload: { type: "object" } },
      required: ["action"],
    },
  },
  {
    name: "memory_recall",
    title: "استرجاع آخر الذاكرة",
    description: "يرجّع آخر الإدخالات المحفوظة في الذاكرة الدائمة.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: { limit: { type: "number" } } },
  },
  /* ── TEST9: التطبيقات المتصلة — اللايف أجينت بيدّه على كل التطبيقات ───────── */
  {
    name: "self_heal",
    title: "الشفاء الذاتي",
    description: "يقيس كل طبقات المنصة (الذاكرة · الجلسات · الكوربوس · الإشعارات · الأدوات · التطبيقات المتصلة)، ويصلّح اللي ينفع فعليًا (توفير كوربوس مفقود)، ويسجّل الدروس — «يلاقي خطأ يصلحه من نفسه ويكبّر نفسه».",
    category: "platform",
    risk: "sensitive",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "kali_node_setup",
    title: "جهاز كالي — التركيب والربط",
    description: "يرجّع أوامر التركيب الحقيقية لجهاز الشغل (كالي لينكس كامل): صورة Docker جاهزة من GHCR أو تركيب bare-metal على أي سيرفر، وحالة عقد كالي المتصلة الآن — بلا أي ادعاء بجهاز وهمي.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "integrations_status",
    title: "حالة التطبيقات المتصلة",
    description: "يجيب حالة الربط الحقيقية لكل التطبيقات (GitHub/Gmail/Google×5/Notion/Linear/Supabase/Vercel/Dropbox): متصل من فين، آخر اختبار، والعمليات المتاحة.",
    category: "platform",
    risk: "safe",
    input_schema: { type: "object", properties: {} },
  },
  ...INTEGRATION_APPS.flatMap((app) => [
    ({
      name: `app_${app.id}`,
      title: `${app.nameAr} (${app.name})`,
      description: `تشغيل عمليات ${app.nameAr} الحقيقية عبر API الرسمي. العمليات: ${app.ops.map((o) => o.id).join(" · ")}. لو مش متصل هيرجع رسالة تشرح طلب الربط بالعربي.`,
      category: "platform",
      risk: app.id === "supabase" ? ("sensitive" as const) : ("active" as const),
      input_schema: {
        type: "object",
        properties: {
          op: { type: "string", enum: app.ops.map((o) => o.id), description: "العملية المطلوبة" },
          ...Object.fromEntries(
            app.ops.flatMap((o) => (o.args ?? []).map((a) => [a.replace(/\?$/, ""), { type: "string", description: `وسيط ${a} لعملية ${o.id}` }])),
          ),
        },
        required: ["op"],
      },
    }) as AgentTool,
  ]),
  {
    name: "kali_run",
    title: "كالي المدمجة — نفّذ أمر حقيقي",
    description:
      "نفّذ أمر داخل بيئة كالي لينكس الحقيقية المدمجة في البرنامج (nmap sqlmap nikto hydra john hashcat aircrack tshark gobuster + python3-pip وgit لتحميل أدوات جديدة داخل البيئة). المخرجات فعلية من التنفيذ مش محاكاة.",
    category: "platform",
    risk: "sensitive",
    input_schema: {
      type: "object",
      properties: { cmd: { type: "string", description: "الأمر اللي يتشغل داخل كالي، مثال: nmap -sV scanme.nmap.org" } },
      required: ["cmd"],
    },
  },
  {
    name: "kali_desktop",
    title: "ديسكتوب كالي — شغّل/اطفي/حالة",
    description:
      "التحكم في ديسكتوب كالي الحقيقي (Xvfb + fluxbox + x11vnc + noVNC): status بيرجع الحالة المقاسة من البورتات، start بيشغّل ويرجّع الرابط، stop بيطفّي. الأجينت بيتحرك بالماوس ويفتح أي حاجة بأوامر xdotool داخل البيئة.",
    category: "platform",
    risk: "sensitive",
    input_schema: {
      type: "object",
      properties: { action: { type: "string", enum: ["status", "start", "stop"], description: "الحالة افتراضيًا" } },
    },
  },
];

export const AGENT_TOOL_NAMES = AGENT_TOOLS.map((t) => t.name);

export function getToolSpec(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

/** Compact catalogue injected into the LLM prompt (names + short descriptions). */
export function toolCatalogueForPrompt(): string {
  return AGENT_TOOLS.map((t) => `- ${t.name}(${Object.keys(t.input_schema.properties).join(", ")}): ${t.title} — ${t.description}`).join("\n");
}

/* ── execution ───────────────────────────────────────────────────────────── */

export async function runAgentTool(name: string, rawArgs: Record<string, unknown> = {}): Promise<ToolRunResult> {
  const started = Date.now();
  const done = (ok: boolean, summary: string, data: unknown): ToolRunResult => ({
    ok,
    summary,
    data,
    ms: Date.now() - started,
  });

  try {
    /* ── TEST9: أدوات التطبيقات المتصلة (app_gmail/app_notion/…) — قبل الswitch
     * لأن الأسماء ديناميكية من INTEGRATION_APPS. كل تشغيل بيرفع إشعارًا حيًا
     * بالـlink اللي يودّي المالك لمكان التطبيق في اللوحة. ── */
    if (name.startsWith("app_")) {
      const appId = name.slice(4);
      const op = String(rawArgs.op ?? "");
      const { op: _op, ...rest } = rawArgs;
      const r = await runIntegration(appId, op, rest);
      const app = INTEGRATION_APPS.find((a) => a.id === appId);
      try {
        createPushNotification({
          kind: r.ok ? "success" : "error",
          title: `الأجينت → ${app?.nameAr ?? appId}`,
          body: r.saysAr,
          link: r.link,
        });
      } catch { /* الإشعار مايوقفش الأداة */ }
      return done(r.ok, r.saysAr, r.ok ? r.data : { error: r.saysAr });
    }
    switch (name) {
      case "recon_target": {
        const host = normaliseHost(rawArgs.target);
        await assertPublicHost(host);
        const [dnsRes, headerRes, tlsRes] = await Promise.all([
          scanDns(host).catch((e) => ({ error: String(e) })),
          scanHeaders(host, true).catch((e) => ({ error: String(e) })),
          scanSsl(host).catch((e) => ({ error: String(e) })),
        ]);
        const ip = Array.isArray((dnsRes as { A?: string[] }).A) ? (dnsRes as { A: string[] }).A.join(", ") : "—";
        const tls = tlsRes as Record<string, unknown>;
        return done(
          true,
          `استطلاع ${host}: IP=${ip} · ${summariseHeaders(headerRes as Record<string, unknown>)} · TLS حتى ${String(tls.validTo ?? "?")}`,
          { host, dns: dnsRes, headers: headerRes, tls: tlsRes },
        );
      }

      case "dns_lookup": {
        const host = normaliseHost(rawArgs.domain);
        await assertPublicHost(host);
        const res = await scanDns(host);
        const a = (res.A as string[] | undefined) ?? [];
        return done(true, `DNS ${host}: ${a.length} سجل A${a.length ? ` (${a.slice(0, 3).join(", ")})` : ""}`, res);
      }

      case "tls_audit": {
        const host = normaliseHost(rawArgs.host);
        const port = Number(rawArgs.port ?? 443) || 443;
        await assertPublicHost(host);
        const res = (await scanSsl(host, port)) as Record<string, unknown>;
        return done(
          Boolean(res && !res.error),
          res.error ? `TLS ${host}:${port} فشل — ${res.error}` : `TLS ${host} صالح حتى ${String(res.validTo)} (${String(res.protocol)})`,
          res,
        );
      }

      case "http_headers_audit": {
        const host = normaliseHost(rawArgs.host);
        const https = rawArgs.https !== false;
        await assertPublicHost(host);
        const res = (await scanHeaders(host, https)) as Record<string, Record<string, unknown>>;
        const missing = (res.missing ?? []) as unknown as string[];
        return done(
          true,
          `${summariseHeaders(res)} · ${missing.length ? `ناقص: ${missing.slice(0, 4).join(", ")}` : "الترويسات الأساسية موجودة"}`,
          res,
        );
      }

      case "port_scan": {
        const host = normaliseHost(rawArgs.host);
        await assertPublicHost(host);
        const requested = Array.isArray(rawArgs.ports) ? (rawArgs.ports as unknown[]).map(Number).filter((n) => n > 0 && n < 65536) : [];
        const ports = (requested.length ? requested : [21, 22, 25, 53, 80, 110, 143, 443, 445, 587, 993, 995, 2083, 2087, 3306, 3389, 5432, 6379, 8080, 8443, 9000, 9200]).slice(0, 40);
        const open = await scanPorts(host, ports, 20);
        return done(
          true,
          `فحص ${ports.length} منفذاً على ${host}: ${open.length} مفتوح${open.length ? ` (${open.map((p) => p.port).join(", ")})` : ""}`,
          { host, scanned: ports.length, open },
        );
      }

      case "subdomain_enum": {
        const host = normaliseHost(rawArgs.domain);
        await assertPublicHost(host);
        const res = (await scanSubdomains(host)) as Array<{ subdomain: string; ips: string[] }>;
        const found = Array.isArray(res) ? res : [];
        return done(true, `نطاقات فرعية لـ ${host}: ${found.length} نتيجة`, { domain: host, subdomains: found });
      }

      case "web_fetch": {
        const url = String(rawArgs.url ?? "").trim();
        if (!/^https?:\/\//i.test(url)) throw new Error("URL يجب أن يبدأ بـ http(s)://");
        const host = normaliseHost(url);
        await assertPublicHost(host);
        const res = await fetchUrlAsText(url);
        const len = String((res as { text?: string }).text ?? "").length;
        return done(true, `جلب ${host}: ${len} حرف`, res);
      }

      case "web_search": {
        const query = String(rawArgs.query ?? "").trim();
        if (!query) throw new Error("query مطلوب");
        const limit = Math.max(1, Math.min(Number(rawArgs.limit ?? 8) || 8, 15));
        const res = await webSearch(query, limit);
        if (!res.results.length) return done(false, `بحث "${query}": مفيش نتائج (${res.note ?? "المزوّدين رجعوا فاضي"})`, res);
        return done(true, `بحث "${query}": ${res.results.length} نتيجة من ${res.source}`, res);
      }


      case "forum_search": {
        const query = String(rawArgs.query ?? "").trim();
        if (!query) throw new Error("query مطلوب");
        const limit = Math.min(Number(rawArgs.limit ?? 8) || 8, 15);
        const res = await forumSearch(query, limit);
        if (!res.results.length) return done(false, `بحث في المنتديات "${query}": مفيش نتائج (${res.note ?? "المزوّدين رجعوا فاضي"})`, res);
        return done(true, `بحث في المنتديات "${query}": ${res.results.length} نتيجة من ${res.source}`, res);
      }

      case "cve_lookup": {
        const id = String(rawArgs.cveId ?? "").trim().toUpperCase();
        if (!/^CVE-\d{4}-\d{4,7}$/.test(id)) throw new Error("صيغة CVE غير صحيحة (CVE-YYYY-NNNN)");
        const res = (await nvdSearch({ cveId: id })) as { vulnerabilities?: Array<{ cve: Record<string, unknown> }> };
        const v = res.vulnerabilities?.[0]?.cve;
        if (!v) return done(false, `لم يتم العثور على ${id} في NVD`, res);
        const metrics = (v.metrics as Record<string, Array<{ cvssData?: { baseScore?: number; baseSeverity?: string } }>>) ?? {};
        const score = metrics.cvssMetricV31?.[0]?.cvssData ?? metrics.cvssMetricV30?.[0]?.cvssData ?? metrics.cvssMetricV2?.[0]?.cvssData;
        return done(true, `${id} — CVSS ${score?.baseScore ?? "?"} (${score?.baseSeverity ?? "?"})`, v);
      }

      case "vuln_search": {
        const asked = String(rawArgs.keyword ?? "").trim();
        if (!asked) throw new Error("keyword مطلوب");
        const q = vulnQuery(asked);
        if (!q.usable) {
          return done(false, `NVD ما اتسألش: «${asked.slice(0, 48)}» ملوش مصطلح منتج/تقنية (${q.reason}). ` +
            `NVD بيبحث بـ«Apache Tomcat 9.0.10» أو CVE-ID، مش بجُملة. جرّب knowledge_search بنفس الجملة أو عرّف المنتج.`,
            { skipped: true, reason: "bad_keyword", suggestTool: "knowledge_search" });
        }
        const limit = Math.min(Number(rawArgs.limit ?? 8) || 8, 20);
        const label = q.cveId && !q.keyword ? q.cveId : q.keyword!;

        /* TEST2-4: «الكوربوس أولًا» — عندنا فهرس محلي مقاس (330k+ سطر من NVD/KEV/EPSS
         * مُتزامن من الـCI) قبل ما نضرب الشبكة. لو الكوربوس مقاس وطلّع نتائج —
         * خلاص، الرد منه وواضح إنه منه. لو طلّع صفر أو الكوربوس مش مقاس —
         * بنضرب NVD لايف كـfallback وتصريح المصدر بيبقى في الرد. */
        const st = corpusStatus();
        if (st.measured && st.total > 0) {
          const probe = (q.cveId && !q.keyword)
            ? ({ cve: q.cveId, limit } as const)
            : ({ text: q.keyword!, limit } as const);
          const local = await queryCorpus(probe);
          if (local.rows.length > 0) {
            const items = local.rows.map((r) => ({
              cve: { id: r.id, descriptions: [{ lang: "en", value: r.desc }] },
              cvss: r.cvss ?? null, severity: r.sev, kev: r.kev === true, epss: r.epss ?? null,
            }));
            return done(
              true,
              `كوربوس نوفا (${st.total.toLocaleString("en-US")} ثغرة · متزامن من ${st.ageMin ?? "?"} دقيقة): ` +
              `"${label}" → ${local.rows.length} نتيجة${local.complete === false ? " (أعلى أولوية — الفحص وقف عند سقف القراءة)" : ""}`,
              {
                source: "corpus-local",
                keywordUsed: label,
                totalResults: local.rows.length,
                scanned: local.scanned,
                corpusTotal: st.total,
                corpusAgeMin: st.ageMin,
                items,
              },
            );
          }
          /* صفر من الكوربوس مقروءة: نجرب NVD no أول fallback — والرد هيقول
           * إنه جاء من NVD مش من الكوربوس. */
        }

        if (!process.env.NVD_API_KEY && q.cveId && !q.keyword) {
          // CVE-ID مباشر ممكن يتحل من الكوربوس حتى لو النتيجة فاضية فوق — لكن
          // من غير مفتاح NVD قصّرنا الكلفة: رد صادق بدل timeout طويل.
          return done(false, `كوربوس نوفا مفيهوش "${label}"، ومفيش NVD_API_KEY لاستعلام لايف — ` +
            `لو عايز أتأكّد من المصدر العالمي زوّد المفتاح أو ابعت المنتج بدل CVE-ID.`,
            { source: "none", keywordUsed: label, corpusChecked: st.measured });
        }
        try {
          const res = (await nvdSearch(q.cveId && !q.keyword ? { cveId: q.cveId, limit } : { keyword: q.keyword!, limit })) as {
            totalResults?: number; vulnerabilities?: unknown[];
          };
          const n = res.totalResults ?? res.vulnerabilities?.length ?? 0;
          const tail = n === 0 ? " — الصفر هنا معناه مافيش تطابق للمصطلح في NVD، مش إن البحث باظ" : "";
          const corpusNote = st.measured && st.total > 0
            ? ` – (الكوربوس المحلي (${st.total.toLocaleString("en-US")}) كان صفر لهذا المصطلح، فرجعت NVD لايف)` : "";
          return done(true, `NVD لايف "${label}": ${n} نتيجة${tail}${corpusNote}`, {
            source: "nvd-live-fallback",
            keywordUsed: label,
            totalResults: n,
            items: res.vulnerabilities ?? [],
          });
        } catch (e) {
          return done(false, `كوربوس نوفا صفر لـ"${label}"، وNVD لايف فشل: ${e instanceof Error ? e.message : String(e)}`, {
            source: "failed",
            keywordUsed: label,
            corpusChecked: st.measured,
            corpusTotal: st.measured ? st.total : null,
          });
        }
      }

      case "exploit_search": {
        const q = String(rawArgs.query ?? "").trim();
        if (!q) throw new Error("query مطلوب");
        const res = (await exploitDbSearch(q)) as { data?: unknown[]; recordsTotal?: number; error?: string };
        const n = res?.recordsTotal ?? res?.data?.length ?? 0;
        return done(!res?.error, `Exploit-DB "${q}": ${n} نتيجة`, res);
      }

      case "github_search": {
        const q = String(rawArgs.query ?? "").trim();
        if (!q) throw new Error("query مطلوب");
        const res = (await githubSearch({ q })) as { items?: unknown[]; error?: string };
        const gn = res.items?.length ?? 0;
        return done(!res.error, `GitHub "${q}": ${gn} نتيجة${res.error ? ` — فشل المصدر: ${res.error}` : gn === 0 ? " — مافيش مستودعات مطابقة" : ""}`, res);
      }

      case "knowledge_search": {
        const q = String(rawArgs.query ?? "").trim();
        const out = searchCyberCorpus2400(q, "all", 8);
        return done(true, `فهرس المنصة "${q}": ${out.items.length} نمط`, { query: q, items: out.items, stats: getCorpusStats() });
      }

      case "kali_toolbox": {
        const q = String(rawArgs.query ?? "").toLowerCase();
        const target = normaliseHost(rawArgs.target) || "<target>";
        const matches = KALI_ARSENAL_64.filter(
          (t) => !q || `${t.name} ${t.category} ${t.purposeAr}`.toLowerCase().includes(q),
        ).slice(0, 6);
        const items = matches.map((t) => ({
          name: t.name,
          category: t.category,
          purpose: t.purposeAr,
          safeEquivalent: t.safeEquivalent,
          command: String(t.commandTemplate ?? "").replace(/\{target\}|<target>|\$TARGET/g, target),
        }));
        return done(true, `ترسانة Kali: ${items.length} أداة مطابقة`, { query: q, target, items });
      }

      case "memory_save": {
        const kind = (["fact", "preference", "lesson", "event", "session"].includes(String(rawArgs.kind))
          ? String(rawArgs.kind)
          : "fact") as MemoryKind;
        const rec = remember({
          kind,
          title: String(rawArgs.title ?? "ملاحظة من نوفا"),
          content: String(rawArgs.content ?? ""),
          scope: rawArgs.scope ? String(rawArgs.scope) : undefined,
          importance: rawArgs.importance !== undefined ? Number(rawArgs.importance) : undefined,
          pinned: rawArgs.pinned === true,
          source: "agent",
        });
        // Mirror into the platform-wide memory feed so /memory stays populated.
        try {
          saveMemory(kind, rec.title, rec.content, "nova,agent,longterm", rec.importance, rec.pinned);
        } catch {
          /* the durable store is the source of truth */
        }
        return done(true, `اتحفظت في الذاكرة طويلة الأمد: ${rec.title} (${rec.kind} · ${rec.scope})`, rec);
      }

      case "memory_search": {
        const q = String(rawArgs.query ?? "").trim();
        const limit = Math.min(Number(rawArgs.limit ?? 10) || 10, 30);
        const hits = recall(q, { scope: rawArgs.scope ? String(rawArgs.scope) : undefined, limit });
        return done(
          hits.length > 0,
          hits.length ? `${hits.length} ذكرى عن "${q}" · أقربها: ${hits[0].title}` : `مفيش ذكرى عن "${q}"`,
          hits,
        );
      }

      case "memory_list": {
        const limit = Math.min(Number(rawArgs.limit ?? 15) || 15, 100);
        const kind = ["fact", "preference", "lesson", "event", "session"].includes(String(rawArgs.kind))
          ? (String(rawArgs.kind) as MemoryKind)
          : undefined;
        const res = listMemories({
          limit,
          kind,
          sort: String(rawArgs.sort) === "important" ? "important" : "recent",
        });
        return done(true, `الذاكرة: ${res.items.length} من ${res.total}`, res);
      }

      case "memory_forget": {
        const id = String(rawArgs.id ?? "").trim();
        if (!id) throw new Error("id مطلوب");
        const ok = forget(id);
        return done(ok, ok ? `اتمسحت الذكرى ${id}` : `مفيش ذكرى بالمعرّف ${id}`, { id, deleted: ok });
      }

      case "memory_stats": {
        const st = memoryStats();
        return done(
          true,
          `${st.total} ذكرى · ${st.pinned} مثبتة · ${Math.round(st.bytes / 1024)}KB على القرص`,
          st,
        );
      }

      case "set_active_target": {
        const target = normaliseHost(rawArgs.target);
        if (!target) throw new Error("target مطلوب");
        setActiveMissionTarget(target, rawArgs.program ? String(rawArgs.program) : undefined);
        return done(true, `الهدف النشط أصبح ${target}`, { target, program: rawArgs.program ?? null });
      }

      case "record_finding": {
        recordMissionFinding({
          title: String(rawArgs.title ?? "Finding"),
          severity: String(rawArgs.severity ?? "info"),
          detail: String(rawArgs.detail ?? ""),
          tool: String(rawArgs.tool ?? "NOVA Agent"),
        });
        const mission = getMissionsState()[0];
        return done(true, `تم تسجيل نتيجة في المهمة (${mission?.findings.length ?? 0} إجمالي)`, mission ?? null);
      }

      case "mission_status": {
        const missions = getMissionsState();
        const active = missions[0];
        return done(true, `المهمة النشطة: ${active?.target ?? "—"} · ${active?.findings.length ?? 0} نتيجة`, { active, total: missions.length });
      }

      case "platform_status": {
        const corpus = getCorpusStats();
        const missions = getMissionsState();
        const data = {
          memories: getAllMemories().length,
          missions: missions.length,
          activeTarget: missions[0]?.target ?? null,
          findings: missions[0]?.findings.length ?? 0,
          evidence: getEvidenceState().length,
          corpus,
          tools: AGENT_TOOLS.length,
        };
        return done(true, `المنصة سليمة · ${data.memories} ذكرى · ${corpus.totalIndexedKnowledgeItems} نمط · ${AGENT_TOOLS.length} أداة`, data);
      }

      case "hash_text": {
        const algo = String(rawArgs.algo ?? "sha256").toLowerCase();
        const text = String(rawArgs.text ?? "");
        const hex = crypto.createHash(["md5", "sha1", "sha256"].includes(algo) ? algo : "sha256").update(text).digest("hex");
        return done(true, `${algo.toUpperCase()}: ${hex.slice(0, 24)}…`, { algo, hash: hex, length: text.length });
      }

      case "run_shell": {
        if (process.env.ENABLE_AGENT_SHELL !== "1") {
          return done(
            false,
            "تنفيذ الأوامر معطّل افتراضياً (ENABLE_AGENT_SHELL=1 لتشغيله) — استخدم أدوات الاستطلاع الآمنة.",
            { disabled: true },
          );
        }
        const cmd = String(rawArgs.command ?? "").trim();
        if (!cmd) throw new Error("command مطلوب");
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const run = promisify(exec);
        const out = await run(cmd, { timeout: 20_000, maxBuffer: 512 * 1024 });
        recordMissionCommand(cmd, (out.stdout || "").slice(0, 400));
        return done(true, `نُفّذ: ${cmd}`, { stdout: out.stdout?.slice(0, 4000), stderr: out.stderr?.slice(0, 1000) });
      }

      case "mission_create": {
        const target = normaliseHost(rawArgs.target);
        if (!target) throw new Error("target مطلوب");
        const name = String(rawArgs.name ?? rawArgs.program ?? `فحص ${target}`);
        setActiveMissionTarget(target, String(rawArgs.program ?? name));
        const mission = getMissionsState()[0];
        if (mission && rawArgs.objective) mission.objective = String(rawArgs.objective);
        recordMissionCommand(`mission:create ${target}`, `تم إنشاء المهمة: ${name}`);
        return done(true, `المهمة جاهزة: ${name} → ${target}`, mission ?? null);
      }

      case "report_generate": {
        const mission = getMissionsState()[0];
        if (!mission) return done(false, "مفيش مهمة نشطة", null);
        const evidence = rawArgs.includeEvidence === false ? [] : getEvidenceState().slice(0, 10);
        const title = String(rawArgs.title ?? `تقرير فحص: ${mission.target}`);
        const lines: string[] = [
          `# ${title}`,
          "",
          `- **الهدف:** ${mission.target}`,
          `- **المهمة:** ${mission.name}`,
          `- **الهدف من الفحص:** ${mission.objective}`,
          `- **التاريخ:** ${new Date().toISOString().slice(0, 10)}`,
          "",
          "## الملاحظات",
        ];
        if (mission.findings.length === 0) lines.push("_لم تُسجَّل ملاحظات بعد._");
        for (const f of mission.findings) {
          lines.push(`### [${String(f.severity).toUpperCase()}] ${f.title}`, f.detail || "—", "");
        }
        if (evidence.length) {
          lines.push("## الأدلة", ...evidence.map((e, i) => `${i + 1}. ${JSON.stringify(e).slice(0, 200)}`), "");
        }
        lines.push("## الخطوات المنفّذة");
        lines.push(
          ...(mission.commands.length
            ? mission.commands.slice(0, 15).map((c) => `- \`${c.cmd}\` → ${c.output}`)
            : ["_لا يوجد_"]),
        );
        lines.push("", "## التوصيات", "- مراجعة الترويسات الناقصة وتحديث الشهادة إن لزم.", "- إعادة الفحص بعد المعالجة للتأكد.");
        const markdown = lines.join("\n");
        return done(true, `تقرير جاهز (${markdown.length} حرف · ${mission.findings.length} ملاحظة)`, { title, markdown });
      }

      case "evidence_list": {
        const limit = Math.min(Number(rawArgs.limit ?? 10) || 10, 30);
        const items = getEvidenceState().slice(0, limit);
        return done(true, items.length ? `${items.length} دليل محفوظ` : "مفيش أدلة محفوظة", items);
      }

      case "report_list": {
        const limit = Math.min(Number(rawArgs.limit ?? 10) || 10, 30);
        const items = (getReportsState() as unknown[]).slice(0, limit);
        return done(true, items.length ? `${items.length} تقرير` : "مفيش تقارير بعد", items);
      }

      case "corpus_stats": {
        const stats = getCorpusStats();
        const real = corpusStatus();
        const realLine = real.measured
          ? `${real.total.toLocaleString("en-US")} ثغرة حقيقية (KEV ${real.kev})`
          : "غير مقاس";
        return done(
          true,
          `الفهرس المُصنَّع: ${stats.totalIndexedKnowledgeItems} نمط · الكوربوس الحقيقي: ${realLine}`,
          { synthesized: stats, realCorpus: real },
        );
      }

      case "corpus_query": {
        const real = corpusStatus();
        if (!real.measured) {
          return done(
            false,
            "الكوربوس الحقيقي مش متنزّل على السيرفر — شغّل scripts/ingest-vuln-corpus.mjs أو الـworkflow الأول",
            { measured: false, says_ar: real.says_ar },
          );
        }
        const product = String(rawArgs.product ?? "").trim();
        const cve = String(rawArgs.cve ?? "").trim();
        if (!product && !cve) {
          return done(
            true,
            `الكوربوس الحقيقي: ${real.total.toLocaleString("en-US")} ثغرة · KEV ${real.kev} · ${real.products.toLocaleString("en-US")} منتج · ${real.says_ar}`,
            real,
          );
        }
        const res = await queryCorpus({
          product: product || undefined,
          cve: cve || undefined,
          minCvss: rawArgs.minCvss === undefined ? undefined : Number(rawArgs.minCvss),
          kevOnly: rawArgs.kevOnly === true,
          limit: rawArgs.limit === undefined ? 20 : Number(rawArgs.limit),
        });
        const label = cve || product;
        return done(
          true,
          `الكوربوس الحقيقي "${label}": ${res.rows.length} نتيجة (من ${res.scanned.toLocaleString("en-US")} صف ممسوح)`,
          {
            query: { product, cve },
            ...res,
            corpus: { total: real.total, at: real.at, sources: ["NVD 2.0", "CISA KEV", "EPSS"] },
          },
        );
      }

      case "vuln_combine": {
        const ids = Array.isArray(rawArgs.cves) ? (rawArgs.cves as unknown[]).map((x) => String(x).trim().toUpperCase()).filter(Boolean) : [];
        if (ids.length < 2) return done(false, "محتاج 2+ معرّفات CVE عشان أدمجهم — مثال: cves: ['CVE-2024-3400','CVE-2024-9474'].", { need: "cves" });

        // قلُب كل ثغرة من الكوربوس الحقيقي (332,347+) — مش من جدول قديم ولا خيال.
        const found: Array<{ cve: string; cvss: number; sev: string; desc: string; cwe: string[]; kev: boolean; epss: number | null; products: string[] }> = [];
        const missing: string[] = [];
        for (const id of ids) {
          const r = await queryCorpus({ cve: id, limit: 1 });
          const row = r.rows[0];
          if (!row) { missing.push(id); continue; }
          found.push({
            cve: row.id,
            cvss: row.cvss ?? 0,
            sev: row.sev,
            desc: row.desc.slice(0, 280),
            cwe: row.cwe,
            kev: row.kev === true,
            epss: row.epss ?? null,
            products: [...new Set(row.cpe.map((c) => `${c.vendor}:${c.product}`))].slice(0, 8),
          });
        }
        if (found.length < 2) {
          return done(false, `جبت ${found.length} بس من ${ids.length} — مفيش دمج: ${missing.join(", ") || "?"}`, { found, missing });
        }

        // التحليل: تقاطع CWEs + المنتجات + أقصى CVSS + مقياس KEV
        const cweSets = found.map((f) => new Set(f.cwe.map((x) => x.toUpperCase())));
        const sharedCwes = [...cweSets[0]].filter((w) => cweSets.every((st) => st.has(w)));
        const sharedProducts = [...new Set(found.flatMap((f) => f.products))]
          .filter((prod) => found.every((f) => f.products.includes(prod)));
        const maxCvss = Math.max(...found.map((f) => f.cvss));
        const kevCount = found.filter((f) => f.kev).length;
        const chainSev = maxCvss >= 9 ? "critical" : maxCvss >= 7 ? "high" : maxCvss >= 4 ? "medium" : "low";
        const noteAr = String(rawArgs.noteAr ?? "").trim();
        const hypothesisAr =
          noteAr ||
          `سلسلة دمج مقترحة بين ${found.map((f) => f.cve).join(" + ")}: ${sharedCwes.length ? `CWE مشتركة (${sharedCwes.join(", ")})` : "CWEs متباينة"}${sharedProducts.length ? ` على نفس المنتجات (${sharedProducts.slice(0, 3).join(", ")})` : ""} — أقصى CVSS = ${maxCvss}${kevCount ? ` · ${kevCount} مستغلة فعليًا (KEV)` : ""}. سلسلة لازم تتحقق بفحص حقيقي قبل الاستغلال.`;

        const rec = appendPermanentVaultFinding({
          titleAr: `فرضية دمج ${found.map((f) => f.cve).join(" + ")}`,
          titleEn: `Chain Hypothesis: ${found.map((f) => f.cve).join(" + ")}`,
          combinedFrom: found.map((f) => f.cve),
          hypothesisAr,
          impactAr: `أقصى CVSS = ${maxCvss} · ${chainSev.toUpperCase()} · KEV: ${kevCount} من ${found.length}`,
          severity: chainSev as "critical" | "high" | "medium" | "low",
          confidence: rawArgs.confidence === undefined ? 0.5 : Math.max(0, Math.min(1, Number(rawArgs.confidence))),
          evidence: { components: found, sharedCwes, sharedProducts, epss: found.map((f) => ({ cve: f.cve, epss: f.epss })) },
        });

        return done(
          true,
          `اتسجّلت في الخزنة باسم ${rec.id} — السلسلة: ${found.map((f) => `${f.cve} (${f.cvss})`).join(" + ")} = chain ${chainSev.toUpperCase()} (${maxCvss}). ${hypothesisAr}`,
          {
            recordId: rec.id,
            vaultPath: rec.path,
            vaultTotal: rec.total,
            chain: { ids: found.map((f) => f.cve), maxCvss, severity: chainSev, kevCount, sharedCwes, sharedProducts },
            components: found,
          },
        );
      }

      case "fleet_list": {
        const agents = getConnectedAgentList();
        if (agents.length === 0) {
          return done(
            false,
            "مفيش أي جهاز متصل حالياً. شغّل وكيل NOVA على الجهاز: node nova-agent.js --server wss://<host>/api/local-agent/ws",
            { agents: [], count: 0 },
          );
        }
        const lines = agents.map((a) => `${a.hostname} (${a.platform}/${a.arch ?? "?"}) · ${a.user} · ${a.capabilities.length} قدرة`);
        return done(true, `${agents.length} جهاز متصل: ${lines.join(" · ")}`, {
          count: agents.length,
          agents: agents.map((a) => ({
            ...a,
            connectedForMin: Math.round((Date.now() - a.connectedAt) / 60000),
          })),
        });
      }

      case "fleet_profile": {
        const agentId = rawArgs.agentId ? String(rawArgs.agentId) : undefined;
        const profile = getAgentDeepProfile(agentId);
        if (!profile) return done(false, "مفيش ملف عميق للجهاز ده (الوكيل لسه مبعتهوش)", null);
        const toolCount = profile.toolCount ?? 0;
        return done(
          true,
          `${profile.system?.hostname ?? "جهاز"} · ${toolCount} أداة أمنية · ${profile.services?.running?.length ?? 0} خدمة · ${profile.docker?.count ?? 0} حاوية`,
          profile,
        );
      }

      case "fleet_exec": {
        const command = String(rawArgs.command ?? "").trim();
        if (!command) throw new Error("command مطلوب");
        const agents = getConnectedAgentList();
        if (agents.length === 0) {
          return done(false, "مفيش جهاز متصل — شغّل وكيل NOVA الأول.", null);
        }
        // TEST6: كان بيجيب أول ليستة = self-node المدمج — الأمر كان بيتنفذ على
        // السيرفر مش على جهاز المالك. التوجيه بيمشي على الوكيل الحي الحقيقي.
        const agentId = rawArgs.agentId ? String(rawArgs.agentId) : (preferredAgentId() ?? agents[0].id);
        const timeout = Math.min(Number(rawArgs.timeout ?? 30_000) || 30_000, 180_000);
        const result = await execOnLocalAgent(command, agentId, timeout);
        if (!result) return done(false, `الجهاز ${agentId} ماردّش (منفصل أو لا يدعم التنفيذ)`, null);
        const host = agents.find((a) => a.id === agentId)?.hostname ?? agentId;
        const preview = (result.stdout || result.stderr || "").trim().slice(0, 300);
        return done(
          result.exitCode === 0,
          `[${host}] exit=${result.exitCode} · ${result.durationMs}ms · ${preview || "بدون مخرجات"}`,
          result,
        );
      }

      case "device_control_map": {
        const platform = String(rawArgs.platform ?? "linux");
        const base = process.env.NOVA_PUBLIC_URL || "https://<your-host>";
        const ws = `${base.replace(/^http/, "ws")}/api/local-agent/ws`;
        const map = {
          linux: `curl -fsSL ${base}/api/local-agent/download-agent | bash -s -- --server ${ws}`,
          macos: `curl -fsSL ${base}/api/local-agent/download-agent | bash -s -- --server ${ws}`,
          windows: `powershell -c "iwr ${base}/api/local-agent/download-agent?platform=windows -OutFile nova-agent.ps1; .\nova-agent.ps1"`,
          manual: `node nova-agent.js --server ${ws} --id my-machine`,
          manyAgents: "شغّل الوكيل على كل جهاز بمعرّف مختلف (--id) — المنصة بتستقبل حتى 10 وكلاء وأكثر في نفس الوقت.",
        };
        return done(true, `خطوات الربط لـ ${platform} جاهزة`, { platform, commands: map, endpoint: ws });
      }

      /* ── ops: authorized programs → real jobs → evidence → report ───────── */

      case "scope_check": {
        const host = normalizeHost(rawArgs.target ?? rawArgs.host ?? "");
        const decision = await assertAuthorized(host, {
          programId: rawArgs.programId ? String(rawArgs.programId) : undefined,
          active: rawArgs.active !== false,
        });
        return done(
          decision.ok,
          decision.ok
            ? `${host} داخل نطاق «${decision.program?.name}» · حدود: ${decision.limits.rps} req/s · ${decision.limits.concurrency} متوازي`
            : `مرفوض: ${decision.reason}`,
          decision,
        );
      }

      case "program_list": {
        const file = loadPrograms();
        return done(
          true,
          file.programs.length
            ? `${file.programs.length} برنامج مصرّح به`
            : "سجل البرامج فاضي — مفيش هدف يتفحص نشط غير لما تضيف برنامج",
          file,
        );
      }

      case "program_add": {
        const hosts = Array.isArray(rawArgs.hosts)
          ? (rawArgs.hosts as unknown[]).map(String)
          : String(rawArgs.hosts ?? "").split(/[,\s]+/).filter(Boolean);
        const id = String(rawArgs.id ?? "").trim();
        if (!id || hosts.length === 0) return done(false, "مطلوب id و hosts على الأقل واحد", null);
        const st = await fetchSecurityTxt(hosts[0]!.replace(/^\*\./, ""));
        const program = upsertProgram({
          id,
          name: String(rawArgs.name ?? id),
          hosts,
          platform: rawArgs.platform ? String(rawArgs.platform) : undefined,
          out_of_scope: Array.isArray(rawArgs.out_of_scope) ? (rawArgs.out_of_scope as unknown[]).map(String) : undefined,
          max_rps: rawArgs.max_rps === undefined ? undefined : Number(rawArgs.max_rps),
          passive_only: Boolean(rawArgs.passive_only),
          policy_url: rawArgs.policy_url ? String(rawArgs.policy_url) : st.url,
          notes_ar: rawArgs.notes_ar ? String(rawArgs.notes_ar) : st.found ? `security.txt: ${st.contact.join(" , ")}`.slice(0, 200) : undefined,
        });
        return done(
          true,
          `سُجّل برنامج «${program.name}» (${program.hosts.join(", ")})${st.found ? " · فيه security.txt" : " · مفيش security.txt — اقرأ الـpolicy يدوياً"}`,
          { program, securityTxt: { found: st.found, contact: st.contact, url: st.url ?? null } },
        );
      }

      case "program_discover": {
        const target = String(rawArgs.target ?? rawArgs.host ?? "");
        if (!target) return done(false, "مطلوب target (نطاق أو رابط صفحة البرنامج)", null);
        const asking = rawArgs.activate === true;
        const proposal = await discoverProgram(target, { register: !asking, name: rawArgs.name ? String(rawArgs.name) : undefined });
        if (!proposal.ok) return done(false, proposal.error ?? "فشل الاكتشاف", proposal);
        if (asking) {
          const consent = `I have written permission for ${proposal.host}`;
          return done(
            true,
            `التسجيل السلبي جاهز. للتفعيل النشط لازم المستخدم يقول النص ده بالحرف بعد ما يتأكد إن عنده إذن مكتوب: «${consent}» — اسأله صراحة ومتقولوش نيابة عنه.`,
            { host: proposal.host, consentSentence: consent, evidence: proposal.evidence, program: proposal.program },
          );
        }
        const ev = proposal.evidence;
        return done(
          true,
          `اتسجّل «${proposal.program?.name ?? proposal.host}» في وضع الاستطلاع · ${ev.security_txt ? `لقيت security.txt${ev.contacts.length ? ` (${ev.contacts.slice(0, 2).join(" , ")})` : ""}` : "مفيش security.txt — لو عايز فحص نشط هتحتاج نص الإذن المكتوب"} · النطاقات: ${(proposal.program?.hosts ?? []).join(", ")}`,
          { host: proposal.host, program: proposal.program, evidence: ev, warnings: proposal.warnings, needs_ar: proposal.needs_ar },
        );
      }

      case "job_create": {
        const target = String(rawArgs.target ?? rawArgs.host ?? "");
        const result = await createJob({
          target,
          name: rawArgs.name ? String(rawArgs.name) : undefined,
          objective: rawArgs.objective ? String(rawArgs.objective) : undefined,
          programId: rawArgs.programId ? String(rawArgs.programId) : undefined,
          depth: rawArgs.depth === "passive" || rawArgs.depth === "deep" ? rawArgs.depth : "standard",
          tools: rawArgs.tools !== false,
          maxTasks: rawArgs.maxTasks ? Number(rawArgs.maxTasks) : undefined,
        });
        if (!result.ok || !result.job) {
          return done(false, `ماتعملش job: ${result.error}`, { denial: result.denial ?? null });
        }
        void runJob(result.job.id).catch(() => undefined);
        return done(
          true,
          `بدأ الفحص الحقيقي على ${result.job.host} · ${result.job.tasks.length} مهمة · job=${result.job.id}`,
          { id: result.job.id, tasks: result.job.tasks.map((t) => t.kind), limits: result.job.budget, status: "running" },
        );
      }

      case "job_list": {
        const jobs = listJobs(rawArgs.limit ? Number(rawArgs.limit) : 20);
        return done(true, `${jobs.length} مهمة مخزّنة على القرص`, jobs);
      }

      case "job_status": {
        const job = getJob(String(rawArgs.jobId ?? ""));
        if (!job) return done(false, `مفيش job بالمعرّف ${rawArgs.jobId}`, null);
        return done(
          true,
          `${job.status} · خلص ${job.stats.done}/${job.tasks.length} · ${job.stats.findings} نتيجة (${job.stats.verified} متحققة) · ${job.stats.failed} فشل · ${job.stats.skipped} متخطّى`,
          {
            id: job.id,
            status: job.status,
            target: job.target,
            programId: job.programId,
            tasks: job.tasks.map((t) => ({ kind: t.kind, status: t.status, summary: t.summary ?? null, error: t.error ?? null, ms: t.ms ?? null, findings: t.findings })),
            log: job.log.slice(-12),
            stats: job.stats,
          },
        );
      }

      case "job_control": {
        const jobId = String(rawArgs.jobId ?? "");
        const action = String(rawArgs.action ?? "pause");
        const fn = action === "resume" ? resumeJob : action === "cancel" ? cancelJob : pauseJob;
        const ok = fn(jobId);
        return done(ok, ok ? `${action} على ${jobId}` : `مفيش job ${jobId}`, { ok, action, jobId });
      }

      case "finding_verify": {
        const jobId = String(rawArgs.jobId ?? "");
        const job = getJob(jobId);
        if (!job) return done(false, `مفيش job ${jobId}`, null);
        const targets = rawArgs.findingId
          ? job.findings.filter((f) => f.id === String(rawArgs.findingId))
          : job.findings.filter((f) => !f.verified);
        const results = [];
        for (const f of targets.slice(0, 20)) {
          const r = await verifyFinding(jobId, f.id);
          results.push({ findingId: f.id, title: f.title, ...(r ?? { ok: false, reproduced: false, detail: "no-result" }) });
        }
        const passed = results.filter((r) => r.reproduced).length;
        return done(
          passed > 0,
          `بوابة البرهان: ${passed}/${results.length} أُعيد إنتاجه — دول بس اللي يدخلوا التقرير`,
          { results, verified: job.stats.verified },
        );
      }

      case "findings_list": {
        const job = getJob(String(rawArgs.jobId ?? ""));
        if (!job) return done(false, `مفيش job ${rawArgs.jobId}`, null);
        const rank = ["critical", "high", "medium", "low", "info"];
        let rows = [...job.findings].sort((a, b) => rank.indexOf(a.severity) - rank.indexOf(b.severity));
        if (rawArgs.severity) rows = rows.filter((f) => f.severity === String(rawArgs.severity));
        return done(
          true,
          `${rows.length} نتيجة (${rows.filter((f) => f.verified).length} متحققة) على ${job.target}`,
          rows.slice(0, 40).map((f) => ({
            id: f.id,
            severity: f.severity,
            title: f.title,
            titleAr: f.titleAr,
            target: f.target,
            cwe: f.cwe ?? null,
            confidence: f.confidence,
            verified: f.verified,
            evidence: f.evidence.map((e) => ({ sha256: e.sha256?.slice(0, 16), file: e.file, probe: e.probe })),
            reproduce: f.reproduce,
          })),
        );
      }

      case "job_report": {
        const job = getJob(String(rawArgs.jobId ?? ""));
        if (!job) return done(false, `مفيش job ${rawArgs.jobId}`, null);
        const md = buildReport(job.id, { includeUnverified: Boolean(rawArgs.includeUnverified) });
        const reportable = job.findings.filter((f) => f.verified).length;
        return done(
          Boolean(md),
          `تقرير ${job.target} جاهز · ${reportable} نتيجة موثّقة${rawArgs.includeUnverified ? " (+ غير موثّقة مشمولة)" : ""}`,
          { jobId: job.id, markdown: md?.slice(0, 6000) ?? "", length: md?.length ?? 0, file: `state/jobs/${job.id}/report.md` },
        );
      }

      // «ابعتلي نطاق» كانت بتقطع سلسلة الشغل لوحدها. الأداة دي بتدي النموذج
      // مصدر أهداف من غير ما حد يديرو: قراية كتالوج بس، وكل سطر متعلّم
      // `consented:false` — والفحص النشط لسه محتاج الإذن المكتوب في `/ops`.
      case "bounty_candidates": {
        const lim = Math.min(20, Math.max(1, Number(rawArgs.limit) || 6));
        const c = huntCandidates({
          limit: lim,
          platform: String(rawArgs.platform || ""),
          minEfficiency: rawArgs.minEfficiency === undefined ? undefined : Number(rawArgs.minEfficiency),
          q: String(rawArgs.q || ""),
        });
        const cs = catalogStatus();
        if (!c.present) {
          return done(false, `الكتالوج مش على المكنة دي (${c.path}) — جرّب الاستطلاع السلبي على نطاق معروف`, { present: false, path: c.path });
        }
        const known = new Set<string>();
        try {
          for (const p of loadPrograms().programs || []) {
            for (const h of [...(p.hosts || []), ...(p.exact || [])]) known.add(String(h).replace(/^\*\./, "").toLowerCase());
          }
        } catch {
          /* مافيش برامج مسجّلة — مش خطأ */
        }
        return done(
          true,
          `${c.items.length} مرشّح من ${c.scanned} برنامج · ${c.filteredOut.notBounty} مستبعد (مالوش مكافأة) · ${known.size} نطاق مسجّل بإذن عندك`,
          {
            scanned: c.scanned,
            fetchedAt: c.fetchedAt,
            alreadyRegistered: known.size,
            permissionModel: "سياق للاطلاع بس: كل سطر consented:false. الفحص النشط محتاج برنامج مسجّل + موافقة نطاق (`program_add` + `scope_check`).",
            items: c.items.map((it) => ({ ...it, alreadyRegistered: (it.sample_hosts || []).some((h: string) => known.has(String(h).toLowerCase())) })),
          },
        );
      }

      case "ops_kinds": {
        const tools = toolStatus();
        const agents = getConnectedAgentList();
        return done(
          true,
          `${KIND_LIST.length} نوع مهمة · أدوات على النود: ${tools.filter((t) => t.present).map((t) => t.bin).join(", ") || "ولا أداة"} · نودات متصلة: ${agents.length}`,
          { kinds: KIND_LIST, tools, agents: agents.map((a) => ({ id: a.id, hostname: a.hostname, platform: a.platform })) },
        );
      }

      // «مافيش أدوات» كانت جملة الختام دايمًا. دلوقتي المحرك بيقدر يغيّر الواقع:
      // بينزّل النسخة الثابتة من الأداة وبيقيس تاني — والرسالة بتقول المقاس
      // بعد التنفيذ، مش ادعاء النجاح.
      case "tools_install": {
        const only = String(rawArgs.only || "")
          .split(",")
          .map((x: string) => x.trim())
          .filter(Boolean);
        const { record, status, skipped } = await provisionToolchainOnce({ only: only.length ? only : undefined });
        const after = status.present.length;
        if (skipped === "already-present") {
          return done(true, `أدواتي جاهزة أصلًا: ${status.present.join(" · ")} في \`${status.dir}\``, {
            dir: status.dir,
            present: status.present,
            missing: status.missing,
          });
        }
        if (skipped === "cooldown") {
          const mins = Math.max(1, Math.round((Date.now() - Date.parse(record?.at || "")) / 60000));
          return done(false, `آخر محاولة قبل ${mins} دقيقة فشلت (${record?.error || "?"}) — هاستنى شوية بدل ما أعيد تجربة شبكة ميتة: ${String(record?.reasonAr || "").slice(0, 160)}`, {
            cooldown: true,
            last: record,
          });
        }
        if (!record?.ok) {
          return done(false, `ماقدرتش أنزّل الأدوات: ${record?.reasonAr || record?.error || "سبب مجهول"}`, {
            dir: status.dir,
            writable: status.writable,
            script: status.script,
            present: status.present,
            missing: status.missing,
            results: record?.results ?? [],
          });
        }
        return done(
          after > 0,
          after
            ? `نزّلت ${record.installed}/${record.total} في \`${status.dir}\` خلال ${Math.round(record.ms / 1000)} ثانية · أدواتي دلوقتي: ${status.present.join(" · ")}`
            : `التنزيل خلص بس ولا أداة اتثبتت (${record.results.map((r) => `${r.bin}:${r.status}`).join(", ").slice(0, 200)})`,
          { dir: status.dir, installed: record.installed, total: record.total, ms: record.ms, present: status.present, missing: status.missing, results: record.results },
        );
      }

      case "vault_list": {
        const limit = Math.min(20, Math.max(1, Number(rawArgs.limit ?? 5) || 5));
        const sev = rawArgs.severity ? String(rawArgs.severity) : undefined;
        const v = listVault({ limit, ...(sev ? { severity: sev } : {}) });
        const perm = readPermanentVault(limit);
        if (!v.present) {
          // خزنة الشغل (state/findings-vault.json) مش على المكنة دي — لكن الخزنة
          // الدائمة (state/discovered-vulnerabilities-vault.json) هي أغلى ملف في
          // المستودع وكانت مخبية عن الأجنت خالص. بقى المصدر التاني بيتقرا.
          if (!perm.present) {
            return done(false, `مفيش خزنة على المكنة دي: لا ${v.path} ولا ${perm.path}.`, {
              present: false,
              jobVault: v.path,
              permanentVault: perm.path,
            });
          }
          const drift = permanentVaultDrift(perm);
          const items = perm.vulnerabilities.map((f) => ({
            key: f.id,
            title: f.titleEn,
            titleAr: f.titleAr,
            severity: f.severity,
            status: f.status,
            program: f.program,
            cwe: f.cwe,
            evidencePath: f.evidencePath,
            evidenceOnDisk: f.evidenceOnDisk,
            pocOnDisk: f.pocOnDisk,
          }));
          return done(
            true,
            `الخزنة الدائمة (${perm.path}): ${perm.counts.vulnerabilities} ثغرة مكتشفة · ${perm.counts.notes} ملاحظة معمارية · ${perm.counts.reports} تقرير إفصاح · ${perm.counts.rules} قاعدة تعلّم. آخر تحديث ${perm.updatedAt ?? "غير مقاس"}. ${drift.countMismatch ? `تنبيه: ${drift.detail}` : ""}`,
            { present: true, source: perm.path, schema: "permanent-vault", counts: perm.counts, drift, items, notes: perm.notes, rules: perm.rules },
          );
        }
        const items = v.items.map((f) => ({
          key: f.key,
          title: f.title,
          titleAr: f.titleAr,
          host: f.host,
          severity: f.severity,
          confidence: f.confidence,
          verified: f.verified,
          evidenceCount: Array.isArray(f.evidence) ? f.evidence.length : 0,
          occurrences: f.occurrences,
          program: f.program?.handle ?? null,
        }));
        return done(
          true,
          `الخزنة: ${v.counts.total} نتيجة (${v.counts.verified} موثقة) · آخر تعديل ${v.updatedAt ?? "غير مقاس"} · ${items.length} معروض${sev ? ` (severity=${sev})` : ""}.`,
          { present: true, path: v.path, counts: v.counts, updatedAt: v.updatedAt, items },
        );
      }

      case "vault_draft": {
        const key = String(rawArgs.key ?? "").trim();
        if (!key) return done(false, "محتاج مفتاح سجل من الخزنة (مثال SKY-VULN-01) — خد الأول من vault_list.", { need: "key" });
        const d = draftReport(key);
        if (!d.ok) {
          // الخزنة الدائمة فيها تقارير إفصاح مكتوبة بالفعل (`reportMarkdownPath`) —
          // أخلّس منها أحسن ما أقول «مفيش» وأنا شايل الملف.
          const perm = readPermanentVault(50);
          const rec = perm.present ? perm.vulnerabilities.find((f) => f.id === key) : null;
          if (rec?.reportMarkdownPath) {
            try {
              const md = fs.readFileSync(path.resolve(process.cwd(), rec.reportMarkdownPath), "utf8");
              return done(
                true,
                `مسودة الإفصاح المحفوظة لـ${key} (${md.length} حرف) من ${rec.reportMarkdownPath}.`,
                { ok: true, key, chars: md.length, source: rec.reportMarkdownPath, markdown: md },
              );
            } catch (err) {
              return done(false, `السجل موجود بس ملف التقرير مقروءش (${rec.reportMarkdownPath}): ${(err as Error).message}`, {
                ok: false,
                key,
                reportMarkdownPath: rec.reportMarkdownPath,
              });
            }
          }
        }
        return done(
          Boolean(d.ok),
          d.ok
            ? `مسودة إفصاح جاهزة لـ${key} (${(d.markdown ?? "").length} حرف) — المرفقة بالبراهين بس اللي بتتبعت.`
            : `مفيش مسودة لـ${key}: ${d.error ?? d.reasonAr ?? "السجل مش موجود أو مش متوثق"}`,
          { ok: d.ok, key, chars: (d.markdown ?? "").length, markdown: d.markdown ?? null, error: d.error ?? null, reasonAr: d.reasonAr ?? null },
        );
      }

      case "advisory_search": {
        const st = libraryStatus();
        const cve = rawArgs.cve ? String(rawArgs.cve).trim().toUpperCase() : null;
        const product = rawArgs.product ? String(rawArgs.product).trim() : null;
        if (!st.measured) {
          return done(false, `مكتبة الاستشارات لسه ما اتزامنتش هنا (${st.source}) — شغّل syncAdvisories أو اسأل على الكاش في state/advisory-cache.json.`, {
            measured: false,
            source: st.source,
          });
        }
        if (cve) {
          const row = lookupCve(cve);
          return done(Boolean(row), row ? `لقيت استشارة لـ${cve}.` : `مفيش استشارة لـ${cve} في ${st.total} استشارة (${st.ageMin ?? "عمر غير مقاس"} دقيقة).`, {
            cve,
            hit: row,
            library: { total: st.total, at: st.at, ageMin: st.ageMin },
          });
        }
        if (!product) return done(false, "قولي منتج (npm/pip/…) أو CVE.", { total: st.total, at: st.at });
        const rows = lookupProduct(product, 10);
        return done(
          rows.length > 0,
          rows.length ? `${rows.length} استشارة لـ«${product}» من أصل ${st.total}.` : `مفيش استشارة مسجلة لـ«${product}» في ${st.total}.`,
          { product, rows, library: { total: st.total, at: st.at, ageMin: st.ageMin, bySeverity: st.bySeverity } },
        );
      }

      case "live_verify": {
        const v = liveVerifyView();
        if (!v.measured) {
          return done(false, "مفيش تقرير تحقق حيّ على المكنة دي — بيتكتب بعد جري الأدلة في CI.", { measured: false });
        }
        return done(
          v.failedChecks.length === 0,
          `${v.verdict ?? "لا حكم"} · ${v.tools.length} أداة اتنفذت${v.failedChecks.length ? ` · ${v.failedChecks.length} فحص واقع` : ""} · عمر ${v.ageMin ?? "غير مقاس"} دقيقة.`,
          v,
        );
      }

      case "free_hosts": {
        const s = await freeHostSummary();
        const probes = await probeCatalogue().catch(() => [] as Array<{ id: string; reachable: boolean; ms: number | null; note: string }>);
        const live = probes.filter((h) => h.reachable);
        return done(
          s.reachable > 0,
          `${s.reachable}/${s.probed} مكان مجاني بيدّي رد حيّ (من ${s.total} في الكتالوج، ${s.usableNoCard} من غير كارت). أنسب واحد: ${s.bestHubAr || s.bestHubId || "مش محدد"}.` +
            (live.length ? ` الحيّ: ${live.slice(0, 4).map((h) => `${h.id}${h.ms === null ? "" : ` (${h.ms}ms)`}`).join(" · ")}.` : " والقياس دلوقتي: ولا واحد رد."),
          { summary: s, probes },
        );
      }

      case "autonomy_state": {
        const lvl = autonomyLevel();
        const sum = autonomySummary();
        const cs = catalogStatus();
        return done(
          true,
          `الاستقلالية: ${lvl} · آخر جولة ${sum.lastSweep ?? "غير مسجلة"} · ${sum.programs} برنامج له جولة مسجلة هنا · الكتالوج: ${
            cs.present ? `${cs.programs} برنامج (${cs.bountyPrograms} بدفع)${cs.fetchedAt ? ` · اتجيب ${cs.fetchedAt}` : ""}` : "مش موجود"
          }.`,
          { level: lvl, lastSweep: sum.lastSweep, sweptPrograms: sum.programs, catalog: cs },
        );
      }

      case "task_list": {
        const cat = rawArgs.category ? String(rawArgs.category) : null;
        const list = AGENT_TOOLS.filter((t) => !cat || t.category === cat).map((t) => ({
          name: t.name,
          title: t.title,
          category: t.category,
          risk: t.risk,
        }));
        return done(true, `${list.length} قدرة متاحة${cat ? ` في ${cat}` : ""}`, list);
      }

      /* ── platform tools (أدوات المنصة) ──────────────────────────────────── */
      case "platform_self_report": {
        const r = platformSelfReport();
        return done(r.ok, r.summary, r.data);
      }

      case "terminal_exec": {
        const r = await terminalExec(
          String(rawArgs.command ?? ""),
          rawArgs.agentId ? String(rawArgs.agentId) : undefined,
          rawArgs.timeoutMs !== undefined ? Number(rawArgs.timeoutMs) : undefined,
        );
        return done(r.ok, r.summary, r.data);
      }

      case "file_read": {
        const r = await fileRead(String(rawArgs.path ?? ""), rawArgs.agentId ? String(rawArgs.agentId) : undefined);
        return done(r.ok, r.summary, r.data);
      }

      case "file_write": {
        const r = await fileWrite(
          String(rawArgs.path ?? ""),
          String(rawArgs.content ?? ""),
          rawArgs.agentId ? String(rawArgs.agentId) : undefined,
        );
        return done(r.ok, r.summary, r.data);
      }

      case "file_list": {
        const r = await fileList(
          rawArgs.path ? String(rawArgs.path) : ".",
          rawArgs.agentId ? String(rawArgs.agentId) : undefined,
        );
        return done(r.ok, r.summary, r.data);
      }

      case "process_list": {
        const r = await processList(rawArgs.agentId ? String(rawArgs.agentId) : undefined);
        return done(r.ok, r.summary, r.data);
      }

      case "service_status": {
        const r = await serviceStatus(
          String(rawArgs.name ?? ""),
          rawArgs.agentId ? String(rawArgs.agentId) : undefined,
        );
        return done(r.ok, r.summary, r.data);
      }

      case "ui_navigate": {
        const r = uiNavigate(String(rawArgs.path ?? ""));
        return done(r.ok, r.summary, r.data);
      }

      case "browser_open": {
        const r = browserOpen(String(rawArgs.url ?? ""));
        return done(r.ok, r.summary, r.data);
      }

      case "ui_action": {
        const r = uiAction(
          String(rawArgs.action ?? ""),
          (rawArgs.payload && typeof rawArgs.payload === "object" ? rawArgs.payload : {}) as Record<string, unknown>,
        );
        return done(r.ok, r.summary, r.data);
      }

      case "memory_recall": {
        const r = memoryRecall(rawArgs.limit !== undefined ? Number(rawArgs.limit) : 10);
        return done(r.ok, r.summary, r.data);
      }

      case "self_heal": {
        const { runSelfHeal } = await import("../ops/self-heal");
        const report = await runSelfHeal();
        return done(report.ok, report.says_ar, report);
      }
      case "kali_node_setup": {
        const connected = getConnectedAgentList();
        const agentsLine = connected.length
          ? connected.map((a: { id?: string; hostname?: string; meta?: { platform?: string } }) => `${a.hostname ?? a.id ?? "node"}(${a.meta?.platform ?? "?"})`).join(" · ")
          : "مافيش عقدة متصلة لسه";
        const hub = process.env.NOVA_PUBLIC_URL ?? process.env.NOVA_HUB_URL ?? "";
        const ghcr = "ghcr.io/dawshax/xfreedollarhachx/nova-kali:latest";
        return done(
          true,
          `عقد كالي المتصلة الآن: ${agentsLine}. جهاز الشغل الثقيل بيركّب بأمر واحد: docker run GHCR أو bash kali-node-install.sh (الأوامر كاملة في data).`,
          {
            dockerOneLiner: `docker run -d --name nova-kali --restart unless-stopped -e NOVA_HUB_URL="${hub}" -e NOVA_EXEC_TOKEN="⟨التوكن⟩" ${ghcr}`,
            bareMetal: "curl -fsSL https://raw.githubusercontent.com/DawshaX/xFREEDOLLARHACHx/main/scripts/kali-node-install.sh | bash -s -- ⟨HUB_URL⟩ ⟨TOKEN⟩",
            image: ghcr,
            connectedAgents: connected,
            honestNote: "الأوامر دى للمالك ينفذها على سيرفره — الأداة مش بتدّعى إنها ركّبت حاجة",
          },
        );
      }
      case "kali_run": {
        const { kaliRoot: kRoot, runKali: kRun } = await import("../ops/kali-env");
        const kcmd = String(rawArgs.cmd ?? "").trim();
        if (!kcmd) throw new Error("cmd مطلوب");
        if (!kRoot()) {
          return done(false, "كالي مش مستخرجة على الهَب — scripts/kali-rootfs-fetch.sh بيسحبها من فرع kali-rootfs", { missing: true });
        }
        const kr = await kRun(kcmd, 90_000);
        try { recordMissionCommand(`kali: ${kcmd}`, kr.stdout.slice(0, 300)); } catch { /* سجل سالم */ }
        return done(
          kr.exitCode === 0,
          kr.exitCode === 0
            ? `كالي نفّذت فعليًا (${kr.durationMs}ms): ${kcmd.slice(0, 100)}`
            : `الأمر خرج بكود ${kr.exitCode} — المخرجات صادقة`,
          kr,
        );
      }
      case "kali_desktop": {
        const { kaliStatus: kStatus, startDesktop: kStart, stopDesktop: kStop } = await import("../ops/kali-env");
        const action = String(rawArgs.action ?? "status");
        if (action === "start") {
          const r = await kStart();
          return done(r.ok, r.detail, r);
        }
        if (action === "stop") {
          const r = kStop();
          return done(r.ok, r.detail, r);
        }
        const st = await kStatus(false);
        const running = st.desktop?.running ?? false;
        return done(st.present, running ? "الديسكتوب شغّال الآن (5901+6080 مفتوحين مقاس)" : st.present ? "البيئة جاهزة والديسكتوب مطفي — action:start يشغّله" : "كالي مش مستخرجة", { desktop: st.desktop });
      }
      case "integrations_status": {
        const st = integrationsStatus();
        const connected = st.filter((s) => s.connected);
        return done(
          true,
          `التطبيقات المتصلة: ${connected.length}/${st.length} — ${connected.map((s) => s.icon + s.nameAr).join(" · ") || "ولا واحد لسه"} — العمليات متاحة عبر أدوات app_*`,
          st,
        );
      }
      default:
        return done(false, `أداة غير معروفة: ${name}`, { available: AGENT_TOOL_NAMES });
    }
  } catch (err) {
    return done(false, `فشل ${name}: ${(err as Error).message}`, { error: (err as Error).message });
  }
}

/* ── SSRF guard export (used by tests / audits) ──────────────────────────── */
export function isPrivateHost(host: string): boolean {
  return PRIVATE_RE.test(host) || host === "localhost";
}

/** tiny helper used by the heuristic planner to detect a target inside text */
export function extractTarget(text: string): string | null {
  const match = text.match(/\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})\b/i);
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (/^(example|test|localhost)\./.test(host)) return null;
  if (net.isIP(host)) return host;
  return host;
}

/* ── keyword extraction for vuln_search (added 2026-11-06) ────────────────────
 * NVD's keyword search matches product and technology names. A user asking in
 * Arabic («عايز أعرف ثغرات في ووردبريس») sent the whole sentence and got 0
 * results every time. This reduces free text to the terms that can match:
 *   1. a CVE id, if present — that is the strongest signal;
 *   2. Latin-script tokens (product names are almost always Latin);
 *   3. a small Arabic→English technology map for the common cases;
 *   4. otherwise the longest non-stopword token.
 * Returns candidates best-first, de-duplicated, never empty when input is not.
 */
const AR_TECH_MAP: Array<[RegExp, string]> = [
  [/وورد\s*بريس|ووردبريس|ورردبريس/, "wordpress"],
  [/جوملا/, "joomla"],
  [/دروبال/, "drupal"],
  [/أباتشي|اباتشي/, "apache"],
  [/نجينكس|نچينكس/, "nginx"],
  [/لينكس|لينوكس/, "linux"],
  [/ويندوز/, "windows"],
  [/أندرويد|اندرويد/, "android"],
  [/آيفون|ايفون/, "ios"],
  [/أوراكل|اوراكل/, "oracle"],
  [/مايكروسوفت|ميكروسوفت/, "microsoft"],
  [/جوجل|قوقل/, "google"],
  [/فايرفوكس/, "firefox"],
  [/كروم/, "chrome"],
  [/جافا/, "java"],
  [/بايثون/, "python"],
  [/نود\s*جيه\s*اس|نودجس/, "nodejs"],
  [/دوكر/, "docker"],
  [/كوبرنيتس|كوبرنيتيز/, "kubernetes"],
  [/سيسكو/, "cisco"],
  [/فورتينايت|فورتينت/, "fortinet"],
  [/سيتريكس/, "citrix"],
  [/فولنرابيليتي|ثغرة|ثغرات|اختراق/, ""],
];

const AR_STOPWORDS = new Set([
  "عايز", "عاوز", "أعرف", "اعرف", "ممكن", "فيه", "فيها", "عن", "من", "على", "إلى", "الى",
  "هل", "إيه", "ايه", "إيه", "اللي", "التي", "الذي", "ثغرات", "ثغرة", "أمنية", "امنية",
  "برنامج", "برامج", "نظام", "سيرفر", "خادم", "موقع", "تطبيق", "شركة", "كيف", "أزاي", "ازاي",
  "بحث", "ابحث", "دور", "لي", "عليها", "عليه", "كل", "أي", "اي", "واحد", "حاجة", "حاجه",
]);

export function extractSearchKeywords(text: string): string[] {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const out: string[] = [];
  const push = (v: string) => {
    const t = v.trim().toLowerCase();
    if (t && t.length >= 2 && !out.includes(t)) out.push(t);
  };

  // 1. CVE id wins outright.
  const cve = raw.match(/CVE-\d{4}-\d{4,7}/i);
  if (cve) push(cve[0].toUpperCase());

  // 2. Latin tokens (product/tech names are nearly always Latin).
  const latin = raw.match(/[A-Za-z][A-Za-z0-9._+-]{1,30}/g) ?? [];
  for (const t of latin) {
    if (/^(the|and|for|with|from|about|what|how|please|search|find)$/i.test(t)) continue;
    push(t);
  }

  // 3. Arabic technology names → canonical English product name.
  for (const [rx, en] of AR_TECH_MAP) {
    if (rx.test(raw) && en) push(en);
  }

  // 4. Last resort: the longest Arabic token that is not a stopword.
  if (out.length === 0) {
    const words = raw.split(/[\s،,.!?؟:;()\[\]{}«»"']+/).filter(Boolean);
    const ranked = words
      .filter((w) => !AR_STOPWORDS.has(w) && w.length >= 3)
      .sort((a, b) => b.length - a.length);
    if (ranked[0]) push(ranked[0]);
  }

  return out.length ? out : [raw];
}
