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
import { saveMemory, searchMemory, getAllMemories } from "../../routes/memory";
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

export interface AgentTool {
  name: string;
  title: string;
  description: string;
  category: "recon" | "intel" | "memory" | "mission" | "utility" | "platform";
  risk: "safe" | "active" | "sensitive";
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
        const keyword = String(rawArgs.keyword ?? "").trim();
        if (!keyword) throw new Error("keyword مطلوب");
        const limit = Math.min(Number(rawArgs.limit ?? 8) || 8, 20);
        const res = (await nvdSearch({ keyword, limit })) as { totalResults?: number; vulnerabilities?: unknown[] };
        return done(true, `NVD "${keyword}": ${res.totalResults ?? res.vulnerabilities?.length ?? 0} نتيجة`, res);
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
        const res = (await githubSearch({ q })) as { items?: unknown[] };
        return done(true, `GitHub "${q}": ${res.items?.length ?? 0} نتيجة`, res);
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
        return done(true, `الفهرس: ${JSON.stringify(stats).slice(0, 150)}`, stats);
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
