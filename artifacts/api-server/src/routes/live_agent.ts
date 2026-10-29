import { Router, type IRouter } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  agentSessions,
  agentSessionMessages,
  files,
} from "@workspace/db";
import {
  chatRoundWithTools,
  streamPlainText,
  type AnthropicLikeMessage,
} from "../lib/ai-router-ollama-only";
import { AGENT_TOOLS, runTool, CLIENT_TOOL_NAMES } from "../lib/tools";

const router: IRouter = Router();

const SYSTEM_PROMPT = `أنت "CyberNova Live Agent v6" — وكيل ذكاء اصطناعي ذاتي بلا حدود داخل منصة CyberNova Ultimate. لديك وصول كامل إلى shell حقيقي على هذه الحاوية (Linux container على Replit)، تتحكم بواجهة المستخدم مباشرة (نوافذ، terminal، متصفح، scanner)، تتعلّم من تجاربك (memory)، تنفّذ Playbooks جاهزة، وتدير خوادم متعددة عبر SSH (nodes).

🧠 أدوات التعلّم الذاتي:
• memory_save: احفظ كل نجاح كـ success_pattern وكل فشل كـ error_pattern. خزّن مهارات جديدة (skill) وتفضيلات المستخدم (preference) وحقائق (fact).
• memory_search / memory_list: استعرض ذاكرتك قبل اقتراح حلّ — أعد استخدام ما نجح سابقاً.

📘 أدوات الـ Playbooks (وصفات جاهزة):
• playbook_list: استعرض الوصفات المتاحة (Pentest, Recon, OSINT...).
• playbook_get: اقرأ خطوات وصفة معينة ونفّذها بالترتيب.

🌐 أدوات الـ Nodes (إدارة خوادم متعددة عبر SSH):
• node_list: استعرض الخوادم المسجّلة (id, name, host, status).
• node_exec: نفّذ أمراً على خادم بعيد (nodeId + command). افتح "Nodes" بالـ ui_open_window للسرعة.

🎯 منهجية الإنجاز 100% + البحث الذاتي عند المشاكل:
- لو طلب المستخدم مهمة، اكتب خطة قصيرة (3-7 خطوات) ثم نفّذها واحدة واحدة بأدواتك بدون توقف.
- **عند أي خطأ أو رسالة لا تفهمها أو فشل أداة**: استخدم web_search فوراً للبحث على الإنترنت عن الخطأ بالضبط (انسخ نص الخطأ في query). اقرأ snippet النتائج، خذ رابطاً مفيداً وافتحه بـ fetch_url، استخرج الحل وطبّقه. ثم احفظ الحل بـ memory_save كـ success_pattern.
- مثال: لو فشل "apt install nmap" بسبب "Permission denied"، ابحث عن "apt install permission denied non-root linux" → اقرأ النتائج → استخدم nix-env أو طريقة بديلة.
- إذا فشلت أداة، **لا تستسلم**: اقرأ الخطأ، احفظه memory_save (error_pattern)، ابحث على النت بـ web_search، جرّب طريقة بديلة (تثبيت أداة، أمر آخر، مزوّد آخر) وحاول مرّة ثانية.
- لو استنفذت محاولاتك (3 مرات على نفس الخطوة)، اشرح للمستخدم بالضبط أين توقفت ولماذا، اعرض ملخص ما وجدته من البحث على النت، واطلب توجيه.
- بعد إنجاز المهمة، لخّص للمستخدم: ما تم، ما الذي تعلّمته، أي خطوات تالية مقترحة.

🤖 نموذج الذكاء الاصطناعي:
أنت تعمل بالكامل على Ollama المحلي (dolphin-llama3 — http://127.0.0.1:11434). لا يوجد أي مفتاح API خارجي. لا تستخدم Anthropic أو OpenAI أو Gemini أو أي سحابة خارجية. جميع عمليات الذكاء الاصطناعي تنتهي على الجهاز المحلي.
إذا أردت التحقق من الاتصال: run_shell("curl -s http://127.0.0.1:11434/api/tags")

⚡ أدوات تحكم الواجهة (UI) — استخدمها لتنفيذ المهام بصرياً قدّام المستخدم:
• ui_open_window: افتح نافذة سطح مكتب (browser, terminal, files, scanner, kaligpt, agent, monitor, editor)
• ui_browse_url: افتح المتصفح الداخلي على رابط (مثلاً facebook.com لإنشاء حساب)
• ui_run_terminal: افتح terminal ونفّذ أمراً يراه المستخدم
• ui_start_scanner: افتح scanner وابدأ فحصاً على هدف
• ui_show_page: نقّل المستخدم لأي صفحة في المنصة
• ui_prefill_report / ui_notify

⚡ أدوات الأمن الحقيقية (server-side):
• nvd_search / cisa_kev / epss_score — قواعد ثغرات حية
• github_search / github_advisories — أبحاث GitHub
• exploit_db_search — Exploit-DB حقيقي
• fetch_url — جلب أي صفحة ويب
• scan_target / scan_dns / scan_ports / scan_ssl / scan_headers / scan_subdomains — فحص فعلي
• run_shell + start_background_process — تنفيذ shell
• read/write/list_workspace_file — نظام ملفات حقيقي
• read_setting / update_setting / list_settings — تستطيع تعديل الإعدادات (ollamaBaseUrl, ollamaModel, nvdApiKey, githubToken)

🎯 منهجية العمل:
- إذا طلب المستخدم مهمة عملية ("أنشئ حساب فيسبوك"، "افحص مثلاً example.com"، "حمّل ملف من GitHub")، **افتح النوافذ المناسبة بـ ui_* وأظهر التنفيذ بصرياً**، ثم تابع بـ shell/أدوات حسب الحاجة.
- نفّذ، لا تنظّر. اجلب البيانات بالأدوات الحقيقية بدلاً من الإجابة من الذاكرة.
- إذا أداة غير مثبّتة، حاول apt-get/pip/npm install. لو فشل، اقترح بديلاً موجوداً.
- المستخدم يتحدث بالعربية — أجب بالعربية الفصحى الواضحة. المخرجات التقنية الإنجليزية كما هي.
- التزم بالأخلاق المهنية: لا تستهدف أنظمة بدون إذن صريح.

# (نص قديم محفوظ للمرجع، لا تتجاهله)
ممنوع الحذف من المنصة. كل ما تفعله إضافة فوق ما هو موجود.

أدواتك الحقيقية:
1. **run_shell**: تنفيذ أي أمر bash مزامن (curl, wget, git, nmap لو متوفر, python3, node, pip, npm, jq, openssl, hash...). استخدمه للأوامر القصيرة.
2. **start_background_process / list_processes / read_process_output / kill_process**: لإطلاق ومراقبة عمليات طويلة (سكان كامل، خوادم، msfconsole، sqlmap...). 
3. **read_workspace_file / write_workspace_file / list_workspace_dir**: قراءة وكتابة ملفات حقيقية على نظام الملفات (وليس فقط قاعدة البيانات).
4. **list_files / read_file / write_file**: ملفات مخزّنة في قاعدة بيانات المنصة (للرفع/التحميل من الواجهة).
5. **scan_url**: فحص أمني سريع لأي رابط (ترويسات، HSTS، CSP، سيرفر بانر...).
6. **search_cve_local / fetch_cve_live / cve_stats**: استعلام قاعدة الثغرات المحلية و NVD مباشرة.

قواعد:
- المستخدم يتحدث معك بالعربية. أجب دائماً بالعربية الفصحى الواضحة. المخرجات التقنية الإنجليزية كما هي.
- نفّذ، لا تنظّر. إذا احتجت معلومة على نظام الملفات أو من الإنترنت، اجلبها بأداة. لا ترفض شيئاً يمكنك تنفيذه عبر shell.
- إذا كانت الأداة المطلوبة غير مثبتة، حاول تثبيتها (apt-get / pip install / npm i / nix-env -iA). إن فشل التثبيت، اقترح بديلاً متاحاً مباشرة.
- للمسحات الكاملة (nmap -A -p-, sqlmap, gobuster, hydra, john) استخدم start_background_process ثم read_process_output كل ثوانٍ ولا تحجب الجلسة.
- عند كتابة سكربتات، احفظها في workspace باسم واضح (.sh / .py) وأعطها صلاحية تنفيذ بـ chmod +x.
- التزم بالأخلاق المهنية: لا تستخدم الأدوات لاستهداف أنظمة لا يملكها المستخدم بدون إذن صريح. تأكّد من النطاق قبل المسح الهجومي.`;

router.get("/live-agent/sessions", async (_req, res) => {
  try {
    // Check if agentSessions table exists by trying a count or simple select
    const rows = await db
      .select()
      .from(agentSessions)
      .orderBy(desc(agentSessions.createdAt))
      .catch((err) => {
        console.error("Database query for sessions failed:", err);
        return []; // Return empty array if table doesn't exist yet
      });
    res.json(rows);
  } catch (err: any) {
    console.error("GET /live-agent/sessions error:", err);
    res.status(200).json([]); // Always return 200 with empty array to prevent UI crash
  }
});

router.post("/live-agent/sessions", async (req, res) => {
  try {
    const title = String(req.body?.title || `جلسة ${new Date().toLocaleString("ar-SA-u-ca-gregory")}`);
    const rows = await db
      .insert(agentSessions)
      .values({ title, model: "dolphin-llama3", provider: "ollama" })
      .returning()
      .catch((err) => {
        console.error("Database insert for sessions failed:", err);
        return [{ id: "temp-" + Date.now(), title, createdAt: new Date() }];
      });
    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error("POST /live-agent/sessions error:", err);
    res.status(201).json({ id: "error-" + Date.now(), title: "Error Session" });
  }
});

router.get("/live-agent/sessions/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const s = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).then(rows => rows[0]).catch(() => null);
    if (!s) {
      // If session not in DB, return a mock empty session to prevent 404/500
      res.json({ id, title: "Session", messages: [] });
      return;
    }
    const msgs = await db
      .select()
      .from(agentSessionMessages)
      .where(eq(agentSessionMessages.sessionId, id))
      .orderBy(agentSessionMessages.createdAt)
      .catch(() => []);
    res.json({ ...s, messages: msgs });
  } catch (err: any) {
    console.error("GET /live-agent/sessions/:id error:", err);
    res.json({ id: req.params.id, title: "Error", messages: [] });
  }
});

router.delete("/live-agent/sessions/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await db.delete(agentSessions).where(eq(agentSessions.id, id));
    res.status(204).end();
  } catch (err: any) {
    console.error("DELETE /live-agent/sessions/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/live-agent/sessions/:id/messages", async (req, res) => {
  try {
    const id = req.params.id;
    const userText = String(req.body?.content || "").trim();
    const planMode = req.body?.planMode === true;
    if (!userText) {
      return res.status(400).json({ error: "content required" });
    }
    const s = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).then(rows => rows[0]).catch(() => null);
    if (!s) {
      return res.status(404).json({ error: "Not found" });
    }

    await db.insert(agentSessionMessages).values({
      sessionId: id,
      role: "user",
      content: userText,
    });

    const history = await db
      .select()
      .from(agentSessionMessages)
      .where(eq(agentSessionMessages.sessionId, id))
      .orderBy(agentSessionMessages.createdAt);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    if (planMode) {
      try {
        const planSystem = `أنت مخطّط CyberNova. مهمتك: قراءة طلب المستخدم وإنتاج خطة مرقّمة موجزة (3 إلى 8 خطوات) لتنفيذ المهمة. لكل خطوة اذكر:
- العنوان المختصر
- الأداة المتوقع استخدامها (مثل run_shell, web_search, ui_open_window, scan_target...) إن أمكن
- النتيجة المتوقعة

لا تنفّذ أي شيء الآن. لا تستخدم أي أداة. فقط اكتب الخطة بالعربية بصيغة Markdown كقائمة مرقّمة، ثم اختم بسؤال "هل تريد تنفيذ هذه الخطة؟". المستخدم سيقرّر بعدها بالموافقة أو طلب التعديل.`;
        const plainHistory = history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));
        const result = await streamPlainText({
          system: planSystem,
          messages: plainHistory,
          maxTokens: 1500,
          onText: (d) => send("delta", { text: d }),
        });
        send("provider_used", { provider: result.provider.id });
        await db.insert(agentSessionMessages).values({
          sessionId: id,
          role: "assistant",
          content: result.text,
        });
        send("plan_ready", { text: result.text });
        send("done", { text: result.text, mode: "plan" });
        res.end();
        return;
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : "Unknown error" });
        res.end();
        return;
      }
    }

    const messages: AnthropicLikeMessage[] = [];
    for (const m of history) {
      if (m.role === "user" || m.role === "assistant") {
        messages.push({
          role: m.role as "user" | "assistant",
          content: m.content,
        });
      }
    }

    let iter = 0;
    let finalText = "";
    let lastProviderId = "";
    while (iter < 25) {
      iter++;
      const round = await chatRoundWithTools({
        system: SYSTEM_PROMPT,
        messages,
        tools: AGENT_TOOLS,
        maxTokens: 4096,
        onText: (d) => send("delta", { text: d }),
      });
      if (round.provider.id !== lastProviderId) {
        lastProviderId = round.provider.id;
        send("provider_used", { provider: round.provider.id });
      }
      finalText += round.text;

      messages.push({
        role: "assistant",
        content: round.assistantBlocks as AnthropicLikeMessage["content"],
      });

      for (const call of round.toolCalls) {
        send("tool_call", { id: call.id, name: call.name, input: call.input });
      }

      if (round.done) break;

      const toolResults: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
        is_error?: boolean;
      }> = [];
      for (const call of round.toolCalls) {
        let result: unknown;
        let isError = false;
        if (CLIENT_TOOL_NAMES.has(call.name)) {
          send("client_tool", { id: call.id, name: call.name, input: call.input });
          result = { ok: true, dispatched_to_client: call.name, input: call.input };
        } else {
          try {
            result = await runTool(call.name, call.input);
          } catch (e) {
            result = { error: e instanceof Error ? e.message : String(e) };
            isError = true;
          }
        }
        const resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        send("tool_result", {
          toolCallId: call.id,
          name: call.name,
          result: resultText.slice(0, 4000),
          isError,
        });
        await db.insert(agentSessionMessages).values({
          sessionId: id,
          role: "tool",
          content: resultText.slice(0, 16000),
          toolName: call.name,
          toolInput: JSON.stringify(call.input),
          toolResult: resultText.slice(0, 16000),
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: resultText.slice(0, 16000),
          is_error: isError,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    await db.insert(agentSessionMessages).values({
      sessionId: id,
      role: "assistant",
      content: finalText,
    });

    send("done", { text: finalText });
    res.end();
  } catch (err: any) {
    console.error("Live Agent Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

router.post("/live-agent/sessions/:id/save-ai-response", async (req, res) => {
  try {
    const id = req.params.id;
    const content = String(req.body?.assistantContent || "").trim();
    if (!content) { res.status(400).json({ error: "assistantContent required" }); return; }
    await db.insert(agentSessionMessages).values({ sessionId: id, role: "assistant", content });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("POST save-ai-response error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/live-agent/sessions/:id/upload", async (req, res) => {
  try {
    const id = req.params.id;
    const s = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).then(rows => rows[0]).catch(() => null);
    if (!s) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const name = String(req.body?.name || "").trim();
    const mimeType = String(req.body?.mimeType || "application/octet-stream");
    const contentBase64 = String(req.body?.contentBase64 || "");
    if (!name || !contentBase64) {
      res.status(400).json({ error: "name and contentBase64 required" });
      return;
    }
    const size = Math.floor((contentBase64.length * 3) / 4);
    const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
    if (size > MAX_BYTES) {
      res.status(413).json({ error: "File too large (max 10 MB)" });
      return;
    }
    const [row] = await db
      .insert(files)
      .values({ name, mimeType, size, contentBase64 })
      .returning();
    await db.insert(agentSessionMessages).values({
      sessionId: id,
      role: "tool",
      toolName: "user_upload",
      content: `📎 المستخدم أرفق ملف #${row.id}: «${name}» (${mimeType}, ${size} بايت). يمكنك قراءة محتواه بـ read_file({"id": ${row.id}}).`,
    });
    res.status(201).json({
      id: row.id,
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
      createdAt: row.createdAt,
    });
  } catch (err: any) {
    console.error("POST /live-agent/sessions/:id/upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/live-agent/sessions/:id/files", async (req, res) => {
  try {
    const id = req.params.id;
    const s = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).then(rows => rows[0]).catch(() => null);
    if (!s) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const rows = await db
      .select({
        id: files.id,
        name: files.name,
        mimeType: files.mimeType,
        size: files.size,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(gte(files.createdAt, s.createdAt))
      .orderBy(desc(files.createdAt));
    res.json(rows);
  } catch (err: any) {
    console.error("GET /live-agent/sessions/:id/files error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/live-agent/files/:fileId/download", async (req, res) => {
  try {
    const fid = Number(req.params.fileId);
    const [row] = await db.select().from(files).where(eq(files.id, fid));
    if (!row) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const buf = Buffer.from(row.contentBase64, "base64");
    res.setHeader("Content-Type", row.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.name)}"`);
    res.send(buf);
  } catch (err: any) {
    console.error("GET /live-agent/files/:fileId/download error:", err);
    res.status(500).json({ error: err.message });
  }
});

void and;
export default router;
