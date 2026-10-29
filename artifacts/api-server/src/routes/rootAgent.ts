import { Router, type IRouter } from "express";
import { resolveAi } from "../lib/ai";
import { TOOLS, runTool } from "../lib/agentTools";
import os from "node:os";
import { execSync } from "node:child_process";

const router: IRouter = Router();

const ROOT_SYSTEM = `أنت "Nova" — وكيل الجذر (Root Agent) لمنصة CyberNova المتقدمة.
أنت قادر على تنفيذ أي مهمة مهما كانت: أمنية، تقنية، بحثية، تحليلية.

قواعدك:
1. قبل التنفيذ، تعرض خطة واضحة مرقمة للمستخدم.
2. تفكر بصوت عالٍ وتشرح كل خطوة قبل تنفيذها.
3. تستخدم الأدوات المتاحة لإنجاز المهمة.
4. تتعلم من نتائج الأدوات وتعدّل خطتها عند الحاجة.
5. في النهاية تقدم ملخصاً شاملاً وتوصيات.
6. ترد دائماً بالعربية مع المصطلحات التقنية بالإنجليزية.
7. تستطيع فتح نوافذ في سطح المكتب (بإعادة إجراء open_window).
8. تراقب موارد النظام (CPU/RAM) وتستخدمها في تحليلاتك.

أدواتك المتاحة: ${TOOLS.map(t => t.name).join(", ")}, get_system_metrics, web_search_enhanced

كن دقيقاً، شاملاً، وعملياً.`;

const EXTRA_TOOLS = [
  {
    name: "get_system_metrics",
    description: "جلب بيانات النظام الحالية: CPU, RAM, GPU, uptime",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "web_search_enhanced",
    description: "بحث متقدم على الإنترنت عن أي موضوع",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "الاستعلام" },
        site: { type: "string", description: "موقع محدد للبحث فيه (اختياري)" },
      },
      required: ["query"],
    },
  },
  {
    name: "open_window",
    description: "فتح نافذة على سطح مكتب CyberNova",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["terminal", "browser", "files", "xdaw", "scanner", "monitor", "dashboard"] },
        title: { type: "string" },
        url: { type: "string" },
        command: { type: "string" },
      },
      required: ["kind"],
    },
  },
];

async function runExtraTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === "get_system_metrics") {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const used = totalMem - freeMem;
    let cpuUsage = 0;
    try {
      const out = execSync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'", { timeout: 2000 }).toString().trim();
      cpuUsage = parseFloat(out) || 0;
    } catch { /* */ }
    return `CPU: ${cpuUsage}% (${os.cpus().length} cores)\nRAM: ${Math.round(used / 1024 / 1024)}MB / ${Math.round(totalMem / 1024 / 1024)}MB\nUptime: ${Math.round(os.uptime() / 60)} min\nPlatform: ${os.platform()} | Host: ${os.hostname()}`;
  }
  if (name === "web_search_enhanced") {
    const query = String(input.query ?? "");
    const site = input.site ? `site:${input.site} ` : "";
    try {
      const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(site + query)}&format=json&t=cybernova`, {
        headers: { "User-Agent": "CyberNova/3.0" },
      });
      const data = await r.json() as { AbstractText?: string; RelatedTopics?: Array<{ Text?: string; FirstURL?: string }> };
      if (data.AbstractText) return data.AbstractText;
      const topics = (data.RelatedTopics ?? []).slice(0, 8).map(t => `- ${t.Text ?? ""} ${t.FirstURL ? `(${t.FirstURL})` : ""}`).join("\n");
      return topics || "لا توجد نتائج مباشرة.";
    } catch (e) { return `خطأ بحث: ${(e as Error).message}`; }
  }
  if (name === "open_window") {
    return `[ACTION:OPEN_WINDOW] ${JSON.stringify(input)}`;
  }
  return `أداة غير معروفة: ${name}`;
}

router.post("/agent/root/stream", async (req, res) => {
  const { prompt, history } = req.body as {
    prompt: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!prompt) {
    res.status(400).json({ error: "prompt required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  function send(event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  type OAMsg =
    | { role: "system"; content: string }
    | { role: "user"; content: string }
    | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
    | { role: "tool"; content: string; tool_call_id: string };

  const allToolDefs = [
    ...TOOLS.map(t => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
    ...EXTRA_TOOLS.map(t => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
  ];

  const msgs: OAMsg[] = [{ role: "system", content: ROOT_SYSTEM }];
  if (history) {
    for (const h of history) msgs.push({ role: h.role, content: h.content });
  }
  msgs.push({ role: "user", content: prompt });

  let iter = 0;
  const MAX = 12;

  try {
    const { client, model } = await resolveAi();

    while (iter < MAX) {
      iter++;

      const response = await client.chat.completions.create({
        model,
        max_completion_tokens: 4096,
        messages: msgs,
        tools: allToolDefs,
        tool_choice: "auto",
      });

      const choice = response.choices[0];
      const text = choice.message.content || "";
      const toolCalls = choice.message.tool_calls ?? [];

      if (text) send("text", { text });

      if (choice.finish_reason !== "tool_calls" || toolCalls.length === 0) {
        break;
      }

      msgs.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments || "{}"); } catch { input = {}; }

        send("tool_use", { id: tc.id, name: tc.function.name, input });

        let result: string;
        const isExtra = EXTRA_TOOLS.some(t => t.name === tc.function.name);
        if (isExtra) {
          result = await runExtraTool(tc.function.name, input);
        } else {
          result = await runTool(tc.function.name, input);
        }

        send("tool_result", { id: tc.id, name: tc.function.name, result: result.slice(0, 2000) });
        msgs.push({ role: "tool", tool_call_id: tc.id, content: result.slice(0, 4000) });
      }
    }

    send("done", { iterations: iter });
  } catch (e) {
    send("error", { message: (e as Error).message });
  } finally {
    res.end();
  }
});

export default router;
