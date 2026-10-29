import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import { db, botCronJobs, botMemory, botAlerts, settings } from "@workspace/db";
import { resolveAi, markProviderFailed, getProviderStatus } from "./ai";
import { AGENT_TOOLS, runTool, CLIENT_TOOL_NAMES } from "./tools";
import { logger } from "./logger";
import {
  learnFromRecentCves,
  consolidateMemory,
  runGitHubPocHunt,
  crawlSecurityIntel,
  deepClassifyCves,
} from "./nova-learner";
import { runExplorer } from "./nova-explorer";

const tasks = new Map<number, ScheduledTask>();

// Global flag to track if a user chat is in progress
let _ollamaBusy = false;
export function setOllamaBusy(val: boolean): void { _ollamaBusy = val; }

async function executeJob(jobId: number): Promise<void> {
  const [job] = await db.select().from(botCronJobs).where(eq(botCronJobs.id, jobId));
  if (!job || job.isEnabled !== "true") return;

  // Skip AI inference cron jobs if Ollama might be serving user requests
  // This prevents background jobs from blocking the Ollama queue for 8-10 minutes
  if (_ollamaBusy) {
    logger.info({ jobId, name: job.name }, "Cron job skipped — Ollama busy with user request");
    return;
  }

  logger.info({ jobId, name: job.name }, "Cron job starting");

  await db
    .update(botCronJobs)
    .set({ lastRunAt: new Date(), lastStatus: "running" })
    .where(eq(botCronJobs.id, jobId));

  try {
    const { client, model } = await resolveAi();

    const systemPrompt = `أنت CyberNova Bot — وكيل أمني ذاتي يعمل 24/7. تنفّذ المهمة المجدولة باستخدام الأدوات الحقيقية.
المهمة: ${job.name}
الوصف: ${job.description}
نفّذ، احفظ النتائج المهمة في الذاكرة (memory_save) كـ success_pattern، وأرسل تقريراً موجزاً.`;

    const toolDefs = AGENT_TOOLS.filter((t) => !CLIENT_TOOL_NAMES.has(t.name));

    type Msg =
      | { role: "system"; content: string }
      | { role: "user"; content: string }
      | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
      | { role: "tool"; content: string; tool_call_id: string };

    const messages: Msg[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: job.prompt },
    ];

    const openaiTools = toolDefs.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    let iter = 0;
    let summary = "";
    while (iter < 6) {
      iter++;
      // Wrap inference call with 45s timeout to avoid blocking Ollama queue indefinitely
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Cron job AI timeout (45s)")), 45_000)
      );
      const response = await Promise.race([
        client.chat.completions.create({
          model,
          max_completion_tokens: 300,
          messages,
          // Note: llama3/Ollama does not support tools API — strip them to avoid 400 errors
        ...(openaiTools.length && !model.includes("llama") && !model.includes("mistral") ? { tools: openaiTools, tool_choice: "auto" } : {}),
        }),
        timeoutPromise,
      ]);

      const choice = response.choices[0];
      const text = choice.message.content || "";
      const toolCalls = choice.message.tool_calls ?? [];

      if (choice.finish_reason !== "tool_calls" || toolCalls.length === 0) {
        summary = text;
        break;
      }

      messages.push({
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
        try {
          const result = await runTool(tc.function.name, input);
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 4000) });
        } catch (err) {
          messages.push({ role: "tool", tool_call_id: tc.id, content: `Error: ${String(err)}` });
        }
      }
    }

    await db
      .update(botCronJobs)
      .set({ lastStatus: "success", runCount: job.runCount + 1, lastRunAt: new Date() })
      .where(eq(botCronJobs.id, jobId));

    if (summary.length > 50) {
      await db.insert(botMemory).values({
        memoryType: "success_pattern",
        key: `cron_${job.name}_${Date.now()}`,
        content: summary.slice(0, 2000),
        context: `Cron job: ${job.name} (ollama)`,
        tags: "cron,auto,scheduled",
      });
    }

    logger.info({ jobId, name: job.name, summaryLen: summary.length }, "Cron job done");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, err: errMsg }, "Cron job failed");
    try {
      await markProviderFailed("ollama", errMsg);
    } catch {
      // ignore
    }
    await db
      .update(botCronJobs)
      .set({ lastStatus: "failed", runCount: job.runCount + 1, lastRunAt: new Date() })
      .where(eq(botCronJobs.id, jobId));
    await db.insert(botAlerts).values({
      severity: "high",
      title: `Cron job failed: ${job.name}`,
      message: errMsg.slice(0, 500),
      source: "cron",
    });
  }
}

export async function reloadSchedule(): Promise<void> {
  for (const [, task] of tasks) task.stop();
  tasks.clear();

  const jobs = await db.select().from(botCronJobs);
  for (const job of jobs) {
    if (job.isEnabled !== "true") continue;
    if (!cron.validate(job.cronExpression)) {
      logger.warn({ jobId: job.id, expr: job.cronExpression }, "Invalid cron expression");
      continue;
    }
    const task = cron.schedule(job.cronExpression, () => { void executeJob(job.id); });
    tasks.set(job.id, task);
    logger.info({ jobId: job.id, name: job.name, expr: job.cronExpression }, "Cron scheduled");
  }
}

async function selfHealProviders(): Promise<void> {
  try {
    const status = await getProviderStatus();
    const errored = status.filter((s) => s.lastError);
    if (!errored.length) return;
    for (const p of errored) {
      await db.delete(settings).where(eq(settings.key, `${p.provider}_lastError`));
      await db.delete(settings).where(eq(settings.key, `${p.provider}_lastFailedAt`));
    }
    logger.info({ cleared: errored.map((e) => e.provider) }, "Self-heal: cleared provider errors");
  } catch (e) {
    logger.warn({ err: e }, "Self-heal cycle failed");
  }
}

async function keepaliveCheck(): Promise<void> {
  // Lightweight HTTP probe only — do NOT make inference calls that block Ollama
  const { getOllamaBaseUrl } = await import("./ollama-settings");
  const ollamaBase = await getOllamaBaseUrl();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`${ollamaBase}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      logger.debug("Keepalive: Ollama OK");
    } else {
      logger.warn({ status: r.status }, "Keepalive: Ollama returned non-OK status");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    logger.warn({ err: msg }, "Keepalive: Ollama unreachable");
    try {
      await db.insert(botAlerts).values({
        severity: "warning",
        title: "Ollama غير متاح",
        message: `Keepalive failed: ${msg}. تأكد أن Ollama يعمل على http://127.0.0.1:11434`,
        source: "keepalive",
      });
    } catch {}
  }
}

async function runLearningCycle(): Promise<void> {
  try {
    logger.info("Nova Learner: starting CVE learning cycle");
    const result = await learnFromRecentCves(48);
    logger.info(result, "Nova Learner: learning cycle complete");
  } catch (err) {
    logger.error({ err }, "Nova Learner: learning cycle failed");
  }
}

async function runGithubHunt(): Promise<void> {
  try {
    logger.info("Nova Learner: starting GitHub PoC hunt");
    const stored = await runGitHubPocHunt(10);
    logger.info({ stored }, "Nova Learner: GitHub hunt complete");
  } catch (err) {
    logger.error({ err }, "Nova Learner: GitHub hunt failed");
  }
}

async function runWebCrawl(): Promise<void> {
  try {
    logger.info("Nova Learner: starting web intel crawl");
    const stored = await crawlSecurityIntel();
    logger.info({ stored }, "Nova Learner: web crawl complete");
  } catch (err) {
    logger.error({ err }, "Nova Learner: web crawl failed");
  }
}

async function runMemoryConsolidation(): Promise<void> {
  try {
    logger.info("Nova Learner: starting memory consolidation");
    const n = await consolidateMemory();
    logger.info({ consolidated: n }, "Nova Learner: memory consolidation complete");
  } catch (err) {
    logger.error({ err }, "Nova Learner: memory consolidation failed");
  }
}

async function runCveClassifier(): Promise<void> {
  try {
    const updated = await deepClassifyCves(300);
    logger.info({ updated }, "Nova Learner: CVE deep classification complete");
  } catch (err) {
    logger.error({ err }, "Nova Learner: CVE classification failed");
  }
}

async function ensureSmartCronJobs(): Promise<void> {
  const existing = await db.select({ name: botCronJobs.name }).from(botCronJobs);
  const existingNames = new Set(existing.map(j => j.name));

  const smartJobs = [
    {
      name: "محلل الثغرات الذكي",
      description: "يحلل آخر الثغرات الواردة ويستخرج الأنماط والمعلومات المفيدة تلقائياً",
      cronExpression: "0 */2 * * *",
      prompt: "حلّل آخر الثغرات الأمنية في قاعدة البيانات (آخر 48 ساعة). استخرج: أنماط الهجوم الشائعة، المنتجات الأكثر تأثراً، الثغرات ذات CVSS الأعلى. خزّن النتائج في الذاكرة كـ cve_pattern. ثم أرسل تقريراً موجزاً.",
    },
    {
      name: "صياد PoC GitHub",
      description: "يبحث في GitHub عن مستودعات PoC وexploits للثغرات الحرجة ويحفظها",
      cronExpression: "0 */6 * * *",
      prompt: "ابحث في GitHub عن مستودعات تحتوي على PoC أو exploit لأشد الثغرات خطورة في قاعدة بياناتنا. خزّن النتائج المفيدة في knowledge_add كفئة github-poc. قدّم ملخصاً بما وجدته.",
    },
    {
      name: "تقرير الأمن اليومي",
      description: "يولّد تقريراً يومياً شاملاً عن الوضع الأمني والثغرات الجديدة",
      cronExpression: "0 8 * * *",
      prompt: "اصنع تقريراً أمنياً يومياً شاملاً يتضمن: إحصاء الثغرات الجديدة، أخطر 5 ثغرات، الأنماط المرصودة، توصيات الحماية. خزّن التقرير في الذاكرة كـ daily_report.",
    },
  ];

  for (const job of smartJobs) {
    if (!existingNames.has(job.name)) {
      await db.insert(botCronJobs).values({
        name: job.name,
        description: job.description,
        cronExpression: job.cronExpression,
        prompt: job.prompt,
        isEnabled: "true",
      });
      logger.info({ name: job.name }, "Seeded smart cron job");
    }
  }
}

export function startScheduler(): void {
  void ensureSmartCronJobs().then(() => reloadSchedule());
  setInterval(() => { void reloadSchedule(); }, 60_000);
  setInterval(() => { void selfHealProviders(); }, 15 * 60_000);
  setInterval(() => { void keepaliveCheck(); }, 5 * 60_000);
  setTimeout(() => void keepaliveCheck(), 10_000);

  setTimeout(() => {
    void runLearningCycle();
    setInterval(() => void runLearningCycle(), 2 * 60 * 60_000);
  }, 30_000);

  setTimeout(() => {
    void runGithubHunt();
    setInterval(() => void runGithubHunt(), 6 * 60 * 60_000);
  }, 2 * 60_000);

  setTimeout(() => {
    void runWebCrawl();
    setInterval(() => void runWebCrawl(), 12 * 60 * 60_000);
  }, 5 * 60_000);

  setTimeout(() => {
    void runMemoryConsolidation();
    setInterval(() => void runMemoryConsolidation(), 24 * 60 * 60_000);
  }, 10 * 60_000);

  setTimeout(() => {
    void runCveClassifier();
    setInterval(() => void runCveClassifier(), 4 * 60 * 60_000);
  }, 45_000);

  const EXPLORER_INTERVAL = 60 * 60_000;
  setTimeout(() => {
    void runExplorerTask("payloads");
    void runExplorerTask("techniques");
    setInterval(() => {
      void runExplorerTask("payloads");
      void runExplorerTask("techniques");
    }, EXPLORER_INTERVAL);
  }, 3 * 60_000);

  setTimeout(() => {
    void runExplorerTask("cheatsheets");
    setInterval(() => void runExplorerTask("cheatsheets"), EXPLORER_INTERVAL);
  }, 5 * 60_000);

  setTimeout(() => {
    void runExplorerTask("github-repos");
    setInterval(() => void runExplorerTask("github-repos"), EXPLORER_INTERVAL);
  }, 7 * 60_000);

  setTimeout(() => {
    void runExplorerTask("mitre");
    setInterval(() => void runExplorerTask("mitre"), EXPLORER_INTERVAL);
  }, 10 * 60_000);

  setTimeout(() => {
    void runExplorerTask("exploit-db");
    setInterval(() => void runExplorerTask("exploit-db"), EXPLORER_INTERVAL);
  }, 6 * 60_000);

  setTimeout(() => {
    void runExplorerTask("cve-stats");
    setInterval(() => void runExplorerTask("cve-stats"), EXPLORER_INTERVAL);
  }, 8 * 60_000);

  logger.info("Cron scheduler started — Nova Learner + Nova Explorer active (Ollama only)");
}

async function runExplorerTask(task: Parameters<typeof runExplorer>[0]): Promise<void> {
  try {
    logger.info({ task }, "Nova Explorer: starting auto task");
    const results = await runExplorer(task);
    const total = results.reduce((s, r) => s + r.collected, 0);
    logger.info({ task, total }, "Nova Explorer: auto task complete");
  } catch (err) {
    logger.error({ task, err }, "Nova Explorer: auto task failed");
  }
}
