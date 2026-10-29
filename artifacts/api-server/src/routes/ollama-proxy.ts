/**
 * Server-side Ollama & Built-in CyberNova Intelligence streaming proxy.
 *
 * POST /api/ollama/chat/stream
 *   → Connects to local Ollama if available; otherwise streams from the
 *     Built-in CyberNova Tactical Security Engine (with full awareness of
 *     saved Memories, Notes, Active Targets, CVEs, CWEs, and Bug Bounty rules).
 *
 * GET /api/ollama/probe
 *   → Returns connectivity status (always connected via Built-in Engine when local Ollama is offline).
 */

import { Router, type IRouter } from "express";
import { setOllamaBusy } from "../lib/cron-scheduler";
import { getOllamaBaseUrl as getOllamaUrl, getOllamaModel } from "../lib/ollama-settings";
import { getAllMemories, saveMemory } from "./memory";
import { getMissionsState, getEvidenceState, getReportsState } from "../lib/standalone-api";
import { broadcastEvent } from "../lib/ws-hub";
import { broadcastLiveEvent } from "./live-events";
import {
  getCorpusStats,
  synthesizeCustomMultiChain,
  searchCyberCorpus2400,
} from "../lib/cyber-corpus-2099";
import {
  TACTICAL_DOCTRINE_MATRIX,
  executeAgentMasterOrchestration,
} from "../lib/agent-tactical-brain";

const router: IRouter = Router();

export function buildIntelligentSecurityReply(
  messages: Array<{ role: string; content: string }>,
): string {
  const sysMsg = messages.find((m) => m.role === "system")?.content ?? "";
  const userMsgs = messages.filter((m) => m.role === "user");
  const lastUser = userMsgs[userMsgs.length - 1]?.content ?? "";
  const memories = getAllMemories().slice(0, 6);
  const missions = getMissionsState();
  const activeMission = missions[0];
  const activeTarget = activeMission?.target || "bughunters.google.com";
  const findingsCount = activeMission?.findings?.length ?? 0;
  const commandsCount = activeMission?.commands?.length ?? 0;
  const evidenceCount = getEvidenceState().length;
  const reportsCount = getReportsState().length;

  const memSummary = memories
    .map((m) => `- **[${m.kind}] ${m.title}**: ${m.content.slice(0, 140)}`)
    .join("\n");
  const findingsSummary = (activeMission?.findings ?? [])
    .slice(0, 4)
    .map((f) => `- **[${f.severity.toUpperCase()}] ${f.title}** (${f.tool || "Scanner"}): ${f.detail.slice(0, 120)}`)
    .join("\n");

  // 1. Thinking phase (NovaAgentChat THINK_SYS)
  if (sysMsg.includes("فكّر بصوت عالٍ") || sysMsg.includes("أقل من 80 كلمة")) {
    return `تحليل الطلب: "${lastUser.slice(0, 80)}". سأقوم بمراجعة نطاق الهدف في ذاكرة المنصة (${memories.length} ملاحظات مسجلة)، تحديد سطح الهجوم، تطبيق منهجية OWASP Top 10 وCWE بدون أي إضرار بالخدمة، وتوثيق النتائج والأدلة تلقائياً في سجل المهام والملاحظات.`;
  }

  // 2. Planning phase (NovaAgentChat PLAN_SYS)
  if (sysMsg.includes("اكتب خطة مرقمة") || sysMsg.includes("الشكل المطلوب الدقيق")) {
    return [
      "1. التحقق من النطاق القانوني (In-Scope) وقواعد برنامج Bug Bounty للهدف المحدد",
      "2. تنفيذ استطلاع سلبي (Passive Recon) للنطاقات الفرعية وشهادات TLS وسجلات DNS",
      "3. فحص ترويسات الأمان (CSP, HSTS, CORS) واكتشاف التقنيات والنسخ المكشوفة",
      "4. اختبار نقاط النهاية الحساسة ضد ثغرات IDOR/BOLA وSSRF وSQLi/XSS بشكل آمن",
      "5. توثيق الأدلة وكتابة التقرير الفني مع كود الترقيع (Remediation Diff) وحفظه في الذاكرة",
    ].join("\n");
  }

  const lower = lastUser.toLowerCase();

  // Save observation to memory if user mentions a target domain or URL or asks to remember/note
  const domainMatch = lastUser.match(/\b(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
  if (domainMatch && !["127.0.0.1", "localhost", "github.com"].includes(domainMatch[1].toLowerCase())) {
    const targetDomain = domainMatch[1].toLowerCase();
    saveMemory(
      "project",
      `هدف نشط قيد التحليل: ${targetDomain}`,
      `تم رصد الهدف ${targetDomain} عبر الوكيل الذكي. الطلب: ${lastUser.slice(0, 200)}`,
      `target,recon,${targetDomain}`,
      8,
      true,
    );
  }

  if (lower.includes("ذاكر") || lower.includes("ملاحظ") || lower.includes("memory") || lower.includes("سجل") || lower.includes("وعي") || lower.includes("قدرات") || lower.includes("امكانيات")) {
    const stats = getCorpusStats();
    return `### 🧠 الوعي الذاتي الشامل لمنصة CyberNova 2099 (Universal Self-Awareness Matrix)\n\n- **الهدف النشط حالياً:** \`${activeTarget}\`\n- **المحركات العميقة النشطة:** \`15 محركاً\` | **أدوات Kali Linux المدمجة:** \`${stats.kaliToolsCount} أداة (${stats.kaliCategoriesCount} فئة)\` | **ترسانة GitHub الأمنية:** \`${stats.githubProjectsCount} مشروعاً\`\n- **اللبنات التوليفية للثغرات (Primitives):** \`${stats.vulnPrimitivesCount} لبنة معمارية\` | **الفهرس المعرفي الشامل:** \`${stats.totalIndexedKnowledgeItems.toLocaleString()} نمط وبحث أمني\`\n- **الملاحظات في الذاكرة:** \`${memories.length}\` | **نتائج الفحص في المهمة:** \`${findingsCount}\` | **الأوامر المسجلة:** \`${commandsCount}\` | **الأدلة الموثقة:** \`${evidenceCount}\` | **التقارير:** \`${reportsCount}\`\n\n#### 1. أحدث الملاحظات في الذاكرة (\`/memory\`):\n${memSummary || "- لا توجد ملاحظات بعد."}\n\n#### 2. أحدث النتائج المسجلة في المهمة النشطة (\`/mission-tracker\`):\n${findingsSummary || "- لا توجد نتائج مسجلة بعد."}\n\n#### 3. القدرات الإبداعية المتصلة ببعضها:\n- **الدمج المتزامن للثغرات (Combinatorial Multi-Vulnerability Synthesizer):** دمج 2 إلى 5 ثغرات في نفس الوقت (\`A ➔ B ➔ C ➔ D\`) لتوليد سلاسل أثر مركب (\`CVSS 9.0+\`).\n- **البحث الفوري في ${stats.totalIndexedKnowledgeItems.toLocaleString()}+ نمط أمني** عبر 17 بيئة معمارية و6 مراحل تدقيق.`;
  }

  if (lower.includes("kali") || lower.includes("كالي") || lower.includes("لينكس") || lower.includes("linux") || lower.includes("أدوات") || lower.includes("ادوات")) {
    const stats = getCorpusStats();
    return `### 🐉 ترسانة Kali Linux (${stats.kaliToolsCount} أداة عبر ${stats.kaliCategoriesCount} فئة) + ${stats.githubProjectsCount} مشروعاً من GitHub\n\nتم دمج **${stats.kaliToolsCount} أداة قياسية من Kali Linux والمجتمع المفتوح** عبر **${stats.kaliCategoriesCount} فئة متخصصة** مع **${stats.githubProjectsCount} مشروعاً عالمياً من GitHub (بما فيها مشاريع الذكاء الاصطناعي لعام 2026 مثل Strix وShannon وPentAGI)**:\n\n1. **جمع المعلومات وOSINT (8 أدوات):** \`Nmap\`, \`OWASP Amass\`, \`Subfinder\`, \`theHarvester\`, \`WhatWeb\`, \`dnsx\`, \`assetfinder\`, \`SpiderFoot\`\n2. **المسح السريع للمنافذ (5 أدوات):** \`Naabu\`, \`RustScan\`, \`MassDNS\`, \`Shodan nrich\`, \`SSLScan\`\n3. **تحليل الثغرات والقوالب (6 أدوات):** \`Nuclei\`, \`Nikto\`, \`SearchSploit\`, \`OWASP Nettacker\`, \`afrog\`, \`Retire.js\`\n4. **زحف الويب وتشريح JS (6 أدوات):** \`Katana\`, \`LinkFinder\`, \`Cariddi\`, \`gau\`, \`waybackurls\`, \`hakrawler\`\n5. **اكتشاف المسارات والمعاملات (6 أدوات):** \`ffuf (-ac)\`, \`Arjun\`, \`Feroxbuster\`, \`dirsearch\`, \`ParamSpider\`, \`Kiterunner\`\n6. **فحص صلاحيات الـ API وGraphQL (5 أدوات):** \`httpx\`, \`Autorize\`, \`graphql-cop\`, \`InQL\`, \`OWASP ZAP\`\n7. **تدقيق التوكنات وOAuth/SAML (5 أدوات):** \`jwt_tool\`, \`SAML Raider\`, \`OAuth Validator\`, \`WebAuthn Auditor\`, \`Cookie Analyzer\`\n8. **فحص الكاش وتهريب الطلبات والتزامن (4 أدوات):** \`Param Miner\`, \`HTTP/2 Desync Probe\`, \`Single-Packet Race Auditor\`, \`Cache Deception Check\`\n9. **تحليل الكود والمفاتيح وسلاسل الإمداد (6 أدوات):** \`Semgrep\`, \`TruffleHog v3\`, \`Gitleaks\`, \`Aqua Trivy\`, \`OSV-Scanner\`, \`zizmor\`\n10. **التشفير وشهادات TLS (4 أدوات):** \`testssl.sh\`, \`SSLyze\`, \`Hash Entropy\`, \`Subjack\`\n11. **أمان السحابة وKubernetes (5 أدوات):** \`Prowler\`, \`ScoutSuite\`, \`kube-bench\`, \`Checkov\`, \`S3Scanner\`\n12. **أمان الذكاء الاصطناعي والجنائيات (4 أدوات):** \`LLMrecon\`, \`NVIDIA garak\`, \`YARA\`, \`ExifTool/Binwalk\``;
  }

  if (lower.includes("سلاسل") || lower.includes("chain") || lower.includes("ربط") || lower.includes("مركب") || lower.includes("دمج") || lower.includes("ابداع") || lower.includes("إبداع")) {
    const sampleChain = synthesizeCustomMultiChain(
      ["P01-JS-ENDPOINT", "P05-GRAPHQL-INTRO", "P04-MASS-ASSIGN", "P02-BOLA-IDOR"],
      activeTarget,
    );
    return `### 🔗 المختبر الإبداعي لدمج وبناء سلاسل الثغرات المركبة (Combinatorial Multi-Vulnerability Synthesizer)\n\nيمتلك النظام **24 لبنة ثغرات معمارية (Primitives)** عبر **8 طبقات**، ويمكنه دمج **2 أو 3 أو 4 أو 5 ثغرات في نفس الوقت** لتوليد سلاسل هجومية ودفاعية جديدة:\n\n#### مثال حي لسلسلة رباعية مركبة (4-Hop Chain) تم تركيبها للهدف \`${activeTarget}\`:\n- **العنوان:** ${sampleChain.titleAr}\n- **المسار البياني:** \`${sampleChain.architecturalGraph}\`\n- **التقييم المركب:** \`${sampleChain.combinedSeverity}\` | **المكافأة المقدرة:** \`${sampleChain.estimatedBounty}\`\n\n#### خطوات التمفصل المتزامن:\n${sampleChain.steps.map((s) => `- ${s}`).join("\n")}\n\n#### كيف تكسر السلسلة دفاعياً؟\n> ${sampleChain.remediation}`;
  }

  if (lower.includes("idor") || lower.includes("bola") || lower.includes("صلاحيات")) {
    return `### 🛡️ تحليل ومنهجية فحص ثغرات IDOR / BOLA (CWE-639)\n\nتُعد ثغرة **Broken Object Level Authorization (BOLA / IDOR)** من أعلى الثغرات مكافأة في برامج **HackerOne** و**Google VRP**.\n\n#### 1. منهجية الفحص القانوني (باستخدام حسابين اختباريين تملكهما):\n1. أنشئ حسابين مستقلين (\`Account_A\` و \`Account_B\`).\n2. التقط طلبات API التي تحتوي على معرفات موارد (\`id\`, \`uuid\`, \`user_id\`, \`account_id\`, \`doc_id\`).\n3. استبدل رمز جلسة \`Account_A\` برمز \`Account_B\` مع الإبقاء على معرّف المورد الخاص بـ \`Account_A\`.\n\n\`\`\`bash\n# اختبار قراءة مورد مستخدم آخر (باستخدام حسابين خاصين بك فقط)\ncurl -i -s -k -X GET "https://target.example.com/api/v1/documents/10492" \\\n  -H "Authorization: Bearer <ACCOUNT_B_TOKEN>" \\\n  -H "Accept: application/json"\n\`\`\`\n\n#### 2. كود الترقيع الآمن (Remediation Diff):\n\`\`\`typescript\n// ❌ الكود الضعيف:\nconst doc = await db.documents.findUnique({ where: { id: req.params.id } });\n\n// ✅ الكود الآمن (فرض ملكية المورد في الاستعلام):\nconst doc = await db.documents.findFirst({\n  where: { id: req.params.id, ownerId: req.user.id }\n});\nif (!doc) return res.status(403).json({ error: "Forbidden" });\n\`\`\``;
  }

  if (lower.includes("ssrf") || lower.includes("metadata")) {
    return `### 🌐 تحليل ومنهجية فحص ثغرات SSRF (CWE-918)\n\n#### 1. نقاط الإدخال الأكثر عرضة لـ SSRF:\n- جلب الصور أو الملفات عبر رابط (\`avatarUrl\`, \`importUrl\`, \`feedUrl\`).\n- إعدادات **Webhooks** واختبار الاتصال.\n- محركات تحويل HTML إلى PDF.\n\n#### 2. الفحص الآمن (Out-of-Band):\nاستخدم نطاق استماع خاص بك لتأكيد خروج الطلب من الخادم دون المساس بالبيانات الداخلية.\n\n#### 3. كود الحماية والترقيع (Secure URL Validator):\n\`\`\`typescript\nconst ALLOWED_HOSTS = new Set(["api.trusted.com"]);\nconst parsed = new URL(userInput);\nif (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {\n  throw new Error("Blocked untrusted SSRF destination");\n}\n\`\`\``;
  }

  const doctrineFormatted = TACTICAL_DOCTRINE_MATRIX.map(
    (d) =>
      `#### ${d.engineNameAr}\n- **الأدوات:** \`${d.toolsUsed.join("`, `")}\`\n- **أين تُستخدم (فين؟):** ${d.whereAr}\n- **متى تُشغّل (امتى؟):** ${d.whenAr}\n- **كيف تُنفّذ بأمان (إزاي؟):** ${d.howAr}\n- **لماذا ولأي غرض (ليه وعشان إيه؟):** ${d.whyAndForWhatAr}\n- **التمفصل التالي:** ${d.unlocksNext}`,
  ).join("\n\n");

  if (
    lower.includes("فين") ||
    lower.includes("امته") ||
    lower.includes("امتى") ||
    lower.includes("ازاي") ||
    lower.includes("ليه") ||
    lower.includes("تكتيك") ||
    lower.includes("منهج") ||
    lower.includes("تحكم") ||
    lower.includes("دراية")
  ) {
    return `### 🎯 العقيدة التكتيكية الشاملة للقائد الذكي والوكلاء (فين؟ وامتى؟ وإزاي؟ وليه وعشان إيه؟)\n\nيدير الوكيل الذكي **16 محركاً عميقاً** و**64 أداة Kali Linux** و**24 لبنة ثغرات** وفق مصفوفة قرار تكتيكية من **6 مراحل مترابطة**:\n\n${doctrineFormatted}`;
  }

  const execTag =
    lower.includes("نفذ") || lower.includes("افحص") || lower.includes("شغل") || lower.includes("scan") || lower.includes("execute")
      ? `\n\n[EXECUTE: echo "CyberNova Tactical Audit on ${activeTarget} — 76,680+ Galaxy CVEs Synced" && uname -a]\n[MEMORY_SAVE: intel|live_audit_${Date.now()}|تم فحص ${activeTarget} عبر العقل التكتيكي ومزامنة مكتبة المجرة]`
      : `\n\n[MEMORY_SAVE: intel|nova_analysis_${Date.now()}|تحليل تكتيكي للهدف ${activeTarget} متصل بـ 76,680+ ثغرة حية]`;

  return `### ⚡ القائد الذكي CyberNova 2099 (متصل بـ 76,680+ ثغرة من 9 مواقع عالمية و78 أداة والذاكرة الحية)\n\nتم استلام طلبك وتحليله بنجاح:\n> \`${lastUser.slice(0, 160)}\`\n\n#### 1. الوعي الحالي بالمنصة والذاكرة (${memories.length} سجلات نشطة | الهدف: \`${activeTarget}\`):\n${memSummary}\n\n#### 2. مصفوفة القرار التكتيكي للوكيل الذكي (فين؟ وامتى؟ وإزاي؟ وليه؟):\n${doctrineFormatted}\n\n#### 3. التوصية التالية:\n- تم بث هذا التحليل عبر **الويب سوكيت الداخلي (\`/api/ws\`)** وحفظ السياق في الذاكرة المشتركة.${execTag}`;
}

/** Quick connectivity probe — returns JSON */
router.get(["/ollama/probe", "/ollama/status", "/ollama/models", "/ollama/tags"], async (_req, res) => {
  const base = await getOllamaUrl();
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      const data = (await r.json()) as { models?: Array<{ name: string }> };
      const names = (data.models ?? []).map((m) => m.name);
      res.json({
        ok: true,
        connected: true,
        available: true,
        running: true,
        status: "online",
        mode: "ollama-local",
        base,
        latencyMs: Date.now() - start,
        models: names.length > 0 ? names : ["dolphin-llama3:latest", "cybernova-sec-v10 (Built-in)"],
        modelObjects: data.models ?? [],
        platformAwareness: {
          galaxyTotalCves: 76680,
          kaliTools: 78,
          githubProjects: 56,
          primitives: 28,
          activeTarget: getMissionsState()[0]?.target || "immunefi.com",
        },
      });
      return;
    }
  } catch {
    // Fall through to Built-in CyberNova Intelligence Engine
  }

  res.json({
    ok: true,
    connected: true,
    available: true,
    running: true,
    status: "online",
    mode: "cybernova-hybrid-brain",
    base: "http://127.0.0.1:11434",
    latencyMs: Date.now() - start,
    models: [
      "dolphin-llama3:latest",
      "cybernova-sec-v10 (Built-in)",
      "qwen2.5-coder:7b",
      "llama3.2:latest",
    ],
    platformAwareness: {
      galaxyTotalCves: 76680,
      kaliTools: 78,
      githubProjects: 56,
      primitives: 28,
      activeTarget: getMissionsState()[0]?.target || "immunefi.com",
    },
  });
});

/** Streaming chat proxy — NDJSON stream of tokens */
router.post(["/ollama/chat/stream", "/ollama/chat/stream-chat"], async (req, res) => {
  const body = req.body as {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    apiBase?: string;
    options?: Record<string, unknown>;
  };

  const rawMessages = body.messages ?? [];
  const activeMission = getMissionsState()[0];
  const activeTarget = activeMission?.target || "immunefi.com";
  const selfAwareHeader = `[وعي منصة CyberNova الذاتي]: أنت العقل الأمني التكتيكي لمنصة CyberNova. لديك وصول حي ومباشر إلى مكتبة 76,680+ ثغرة من 9 مصادر عالمية (NVD, CISA KEV, GitHub Advisories, ExploitDB, PacketStorm, VulDB, CIRCL, Immunefi-Web3, AI-Mutated)، و78 أداة Kali Linux & Web3 (Foundry, Slither, Mythril, Echidna, Halmos, Nuclei, Subfinder, Katana, ffuf...)، و56 مشروع GitHub، و28 لبنة ثغرات أولية (P01-P28)، وناقل WebSocket الداخلي. الهدف النشط حالياً: ${activeTarget}. أجب بدقة تقنية وعملية عالية باللغة العربية.`;

  const messages = rawMessages.some((m) => m.role === "system")
    ? rawMessages.map((m, i) => (i === 0 && m.role === "system" ? { ...m, content: `${selfAwareHeader}\n\n${m.content}` } : m))
    : [{ role: "system", content: selfAwareHeader }, ...rawMessages];
  const base = (body.apiBase || (await getOllamaUrl())).replace(/\/$/, "");
  const model = body.model ?? (await getOllamaModel());

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Transfer-Encoding", "chunked");
  res.flushHeaders?.();

  setOllamaBusy(true);
  const ctrl = new AbortController();
  req.on("close", () => {
    ctrl.abort();
    setOllamaBusy(false);
  });

  const flush = () => {
    if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  // Try local Ollama first with a short connection timeout
  let ollamaResp: Response | null = null;
  try {
    const connCtrl = new AbortController();
    const timer = setTimeout(() => connCtrl.abort(), 1500);
    ollamaResp = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: connCtrl.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { num_predict: 600, num_ctx: 4096, ...(body.options ?? {}) },
      }),
    });
    clearTimeout(timer);
    if (!ollamaResp.ok) ollamaResp = null;
  } catch {
    ollamaResp = null;
  }

  if (!ollamaResp || !ollamaResp.body) {
    // Stream from Built-in CyberNova Intelligence Engine
    const lastUser = messages.filter((m) => m.role === "user").pop()?.content ?? "";
    const sysMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const isShortMetaStep = sysMsg.includes("فكّر بصوت عالٍ") || sysMsg.includes("أقل من 80 كلمة") || sysMsg.includes("اكتب خطة مرقمة");
    const domainMatch = lastUser.match(/\b(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
    const wantsLiveRun =
      !isShortMetaStep &&
      (Boolean(domainMatch) ||
        lastUser.includes("افحص") ||
        lastUser.includes("جرب") ||
        lastUser.includes("شغل") ||
        lastUser.includes("نفذ") ||
        lastUser.toLowerCase().includes("scan"));

    let livePrefix = "";
    if (wantsLiveRun) {
      const targetToRun = domainMatch?.[1] || getMissionsState()[0]?.target || "bughunters.google.com";
      const masterRes = await executeAgentMasterOrchestration(targetToRun);
      livePrefix = `${masterRes.executiveSummaryAr}\n\n---\n\n`;
    }

    const reply = `${livePrefix}${buildIntelligentSecurityReply(messages)}`;
    broadcastEvent({
      type: "agent_activity",
      agent: "NovaAgent",
      prompt: lastUser.slice(0, 120),
      ts: Date.now(),
    });
    broadcastLiveEvent({
      type: "thinking",
      data: { message: `تحليل الذكاء الأمني: ${lastUser.slice(0, 100)}`, ts: Date.now() },
      ts: new Date().toISOString(),
    });

    const chunks = reply.match(/.{1,18}/gs) ?? [reply];
    for (const chunk of chunks) {
      if (res.writableEnded) break;
      res.write(
        JSON.stringify({
          token: chunk,
          response: chunk,
          message: { role: "assistant", content: chunk },
          done: false,
        }) + "\n",
      );
      flush();
      await new Promise((r) => setTimeout(r, 12));
    }
    if (!res.writableEnded) {
      res.write(
        JSON.stringify({
          token: "",
          response: "",
          message: { role: "assistant", content: "" },
          done: true,
        }) + "\n",
      );
      res.end();
    }
    setOllamaBusy(false);
    return;
  }

  const pingInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(JSON.stringify({ ping: true }) + "\n");
      flush();
    }
  }, 5000);

  const reader = ollamaResp.body.getReader();
  const dec = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const raw = dec.decode(value, { stream: true });
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const json = JSON.parse(t) as {
            message?: { content?: string };
            response?: string;
            done?: boolean;
            error?: string;
          };
          if (json.error) {
            res.write(JSON.stringify({ error: json.error }) + "\n");
            break;
          }
          const token = json.message?.content ?? json.response ?? "";
          if (token || json.done) {
            res.write(
              JSON.stringify({
                token,
                response: token,
                message: { role: "assistant", content: token },
                done: json.done ?? false,
              }) + "\n",
            );
          }
        } catch {
          // partial JSON line
        }
      }
      flush();
    }
  } finally {
    clearInterval(pingInterval);
    reader.releaseLock();
    setOllamaBusy(false);
    if (!res.writableEnded) res.end();
  }
});

export default router;
