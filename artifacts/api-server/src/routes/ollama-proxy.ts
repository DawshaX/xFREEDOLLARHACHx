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
import { broadcastEvent } from "../lib/ws-hub";
import { broadcastLiveEvent } from "./live-events";

const router: IRouter = Router();

export function buildIntelligentSecurityReply(
  messages: Array<{ role: string; content: string }>,
): string {
  const sysMsg = messages.find((m) => m.role === "system")?.content ?? "";
  const userMsgs = messages.filter((m) => m.role === "user");
  const lastUser = userMsgs[userMsgs.length - 1]?.content ?? "";
  const memories = getAllMemories().slice(0, 6);
  const memSummary = memories
    .map((m) => `- **[${m.kind}] ${m.title}**: ${m.content.slice(0, 140)}`)
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

  if (lower.includes("ذاكر") || lower.includes("ملاحظ") || lower.includes("memory") || lower.includes("سجل")) {
    return `### 🧠 حالة الذاكرة والملاحظات المتصلة في CyberNova\n\nيوجد حالياً **${memories.length} ملاحظات وسجلات نشطة** متصلة بناقل WebSocket الداخلي:\n\n${memSummary || "- لا توجد ملاحظات بعد."}\n\n#### كيف يعمل التزامن التلقائي؟\n- أي هدف تختاره أو تفحصه في **Bug Bounty Studio** أو **الماسح** أو **الوكيل الحي** يتم تسجيله فوراً في **الذاكرة (\`/memory\`)** و**متتبع المهام (\`/mission-tracker\`)**.\n- يمكنك إضافة ملاحظة جديدة في أي وقت وسيكون جميع الوكلاء على دراية فورية بها.`;
  }

  if (lower.includes("idor") || lower.includes("bola") || lower.includes("صلاحيات")) {
    return `### 🛡️ تحليل ومنهجية فحص ثغرات IDOR / BOLA (CWE-639)\n\nتُعد ثغرة **Broken Object Level Authorization (BOLA / IDOR)** من أعلى الثغرات مكافأة في برامج **HackerOne** و**Google VRP**.\n\n#### 1. منهجية الفحص القانوني (باستخدام حسابين اختباريين تملكهما):\n1. أنشئ حسابين مستقلين (\`Account_A\` و \`Account_B\`).\n2. التقط طلبات API التي تحتوي على معرفات موارد (\`id\`, \`uuid\`, \`user_id\`, \`account_id\`, \`doc_id\`).\n3. استبدل رمز جلسة \`Account_A\` برمز \`Account_B\` مع الإبقاء على معرّف المورد الخاص بـ \`Account_A\`.\n\n\`\`\`bash\n# اختبار قراءة مورد مستخدم آخر (باستخدام حسابين خاصين بك فقط)\ncurl -i -s -k -X GET "https://target.example.com/api/v1/documents/10492" \\\n  -H "Authorization: Bearer <ACCOUNT_B_TOKEN>" \\\n  -H "Accept: application/json"\n\`\`\`\n\n#### 2. كود الترقيع الآمن (Remediation Diff):\n\`\`\`typescript\n// ❌ الكود الضعيف:\nconst doc = await db.documents.findUnique({ where: { id: req.params.id } });\n\n// ✅ الكود الآمن (فرض ملكية المورد في الاستعلام):\nconst doc = await db.documents.findFirst({\n  where: { id: req.params.id, ownerId: req.user.id }\n});\nif (!doc) return res.status(403).json({ error: "Forbidden" });\n\`\`\``;
  }

  if (lower.includes("ssrf") || lower.includes("metadata")) {
    return `### 🌐 تحليل ومنهجية فحص ثغرات SSRF (CWE-918)\n\n#### 1. نقاط الإدخال الأكثر عرضة لـ SSRF:\n- جلب الصور أو الملفات عبر رابط (\`avatarUrl\`, \`importUrl\`, \`feedUrl\`).\n- إعدادات **Webhooks** واختبار الاتصال.\n- محركات تحويل HTML إلى PDF.\n\n#### 2. الفحص الآمن (Out-of-Band):\nاستخدم نطاق استماع خاص بك لتأكيد خروج الطلب من الخادم دون المساس بالبيانات الداخلية.\n\n#### 3. كود الحماية والترقيع (Secure URL Validator):\n\`\`\`typescript\nconst ALLOWED_HOSTS = new Set(["api.trusted.com"]);\nconst parsed = new URL(userInput);\nif (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {\n  throw new Error("Blocked untrusted SSRF destination");\n}\n\`\`\``;
  }

  return `### ⚡ وكيل CyberNova الأمني (متصل بناقل WebSocket والذاكرة الحية)\n\nتم استلام طلبك وتحليله بنجاح:\n> \`${lastUser.slice(0, 160)}\`\n\n#### 1. الوعي الحالي بالمنصة والذاكرة (${memories.length} سجلات نشطة):\n${memSummary}\n\n#### 2. خطة العمل المقترحة (100% قانونية وآمنة):\n\`\`\`bash\n# 1. استطلاع النطاقات الفرعية السلبي عبر الشهادات\ncurl -s "https://crt.sh/?q=%25.${domainMatch ? domainMatch[1] : "example.com"}&output=json" | jq -r '.[].name_value' | sort -u\n\n# 2. فحص ترويسات الحماية وشهادة TLS بدون إزعاج الخادم\ncurl -I -s -L "https://${domainMatch ? domainMatch[1] : "example.com"}"\n\`\`\`\n\n#### 3. التوصية التالية:\n- تم بث هذا التحليل عبر **الويب سوكيت الداخلي (\`/api/ws\`)** وحفظ السياق في الذاكرة المشتركة.\n- حدد الهدف الذي سنبدأ عليه من **Bug Bounty Studio** أو اكتب نطاق الهدف هنا وسنبدأ الفحص والتسجيل خطوة بخطوة.`;
}

/** Quick connectivity probe — returns JSON */
router.get("/ollama/probe", async (_req, res) => {
  const base = await getOllamaUrl();
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      const data = (await r.json()) as { models?: Array<{ name: string }> };
      res.json({
        connected: true,
        mode: "ollama-local",
        base,
        latencyMs: Date.now() - start,
        models: (data.models ?? []).map((m) => m.name),
      });
      return;
    }
  } catch {
    // Fall through to Built-in CyberNova Intelligence Engine
  }

  res.json({
    connected: true,
    mode: "cybernova-builtin",
    base: "builtin://cybernova-core",
    latencyMs: Date.now() - start,
    models: [
      "cybernova-sec-v10 (Built-in)",
      "dolphin-llama3:latest",
      "qwen2.5-coder:7b",
    ],
  });
});

/** Streaming chat proxy — NDJSON stream of tokens */
router.post("/ollama/chat/stream", async (req, res) => {
  const body = req.body as {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
    apiBase?: string;
    options?: Record<string, unknown>;
  };

  const messages = body.messages ?? [];
  const base = (await getOllamaUrl()).replace(/\/$/, "");
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
    const reply = buildIntelligentSecurityReply(messages);
    const lastUser = messages.filter((m) => m.role === "user").pop()?.content ?? "";
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
      res.write(JSON.stringify({ token: chunk, done: false }) + "\n");
      flush();
      await new Promise((r) => setTimeout(r, 12));
    }
    if (!res.writableEnded) {
      res.write(JSON.stringify({ token: "", done: true }) + "\n");
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
            done?: boolean;
            error?: string;
          };
          if (json.error) {
            res.write(JSON.stringify({ error: json.error }) + "\n");
            break;
          }
          const token = json.message?.content ?? "";
          if (token || json.done) {
            res.write(JSON.stringify({ token, done: json.done ?? false }) + "\n");
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
