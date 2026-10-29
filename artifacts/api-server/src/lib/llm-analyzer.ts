/**
 * LLM Analyzer — تحليل الثغرات بـ Llama3 المحلي عبر Ollama
 *
 * يرسل وصف كل ثغرة لـ Llama3 ويستخرج:
 *  • Target      — الهدف المتأثر
 *  • Payload     — طريقة الاستغلال
 *  • Severity    — مستوى الخطورة والتأثير
 *  • Remediation — الإصلاح المقترح
 */

import { db, cves, riskScores } from "@workspace/db";
import { eq, isNull, or } from "drizzle-orm";
import { logger } from "./logger";

import { getOllamaBaseUrl, getOllamaModel } from "./ollama-settings";

interface OllamaResponse {
  response: string;
  done: boolean;
}

async function queryOllama(prompt: string, model?: string): Promise<string> {
  const OLLAMA_URL = await getOllamaBaseUrl();
  const resolvedModel = model ?? await getOllamaModel();
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: resolvedModel, prompt, stream: false }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text().catch(() => "")}`);
  const data = await r.json() as OllamaResponse;
  return data.response ?? "";
}

function parseAnalysis(text: string): { target: string; payload: string; severity: string; remediation: string } {
  const extract = (key: string) => {
    const m = text.match(new RegExp(`(?:${key}|${key.toLowerCase()})[:\\-]\\s*(.+?)(?:\\n|$)`, "i"));
    return m ? m[1].trim().slice(0, 300) : "";
  };
  return {
    target:      extract("Target|الهدف"),
    payload:     extract("Payload|الاستغلال|Attack"),
    severity:    extract("Severity|Impact|الخطورة|التأثير"),
    remediation: extract("Remediation|Fix|الإصلاح|الحل"),
  };
}

export async function analyzeCve(cveId: string, description: string): Promise<{
  target: string; payload: string; severity: string; remediation: string;
} | null> {
  try {
    const prompt = `أنت خبير أمن معلومات متخصص في تحليل الثغرات الأمنية. 
حلل الثغرة التالية واستخرج المعلومات بالتنسيق المحدد:

الثغرة: ${cveId}
الوصف: ${description.slice(0, 800)}

أجب بهذا التنسيق الدقيق (سطر لكل عنصر):
Target: [الأنظمة أو البرامج المتأثرة]
Payload: [طريقة الاستغلال أو الهجوم]
Severity: [تأثير الثغرة على النظام]
Remediation: [خطوات الإصلاح أو التخفيف]

أجب باللغة العربية فقط وكن موجزاً.`;

    const response = await queryOllama(prompt);
    return parseAnalysis(response);
  } catch (err) {
    logger.warn({ cveId, err: String(err) }, "LLM analysis failed");
    return null;
  }
}

export async function runLlmAnalysisBatch(limit = 20): Promise<number> {
  let analyzed = 0;
  try {
    // Check Ollama is available
    const ollamaUrl = await getOllamaBaseUrl();
    const ping = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!ping?.ok) {
      logger.warn("LLM Analyzer: Ollama not available, skipping");
      return 0;
    }

    // Get CVEs that haven't been analyzed yet
    const unanalyzed = await db.select({ id: cves.id, description: cves.description })
      .from(cves)
      .leftJoin(riskScores, eq(cves.id, riskScores.cveId))
      .where(or(isNull(riskScores.aiSummary), eq(riskScores.aiSummary, "")))
      .limit(limit);

    for (const cve of unanalyzed) {
      if (!cve.description) continue;
      const analysis = await analyzeCve(cve.id, cve.description);
      if (!analysis) continue;

      const summary = `الهدف: ${analysis.target} | الهجوم: ${analysis.payload} | الإصلاح: ${analysis.remediation}`;

      await db.insert(riskScores).values({
        cveId: cve.id,
        aiSummary: summary.slice(0, 500),
        aiTarget: analysis.target,
        aiPayload: analysis.payload,
        aiRemediation: analysis.remediation,
      }).onConflictDoUpdate({
        target: riskScores.cveId,
        set: {
          aiSummary: summary.slice(0, 500),
          aiTarget: analysis.target,
          aiPayload: analysis.payload,
          aiRemediation: analysis.remediation,
          lastUpdated: new Date(),
        },
      });

      analyzed++;
      await new Promise(r => setTimeout(r, 500));
    }

    logger.info({ analyzed }, "LLM Analyzer: batch complete");
  } catch (err) {
    logger.error({ err }, "LLM analysis batch failed");
  }
  return analyzed;
}

export async function generateScanReport(scanId: string, findings: Array<{ title: string; severity: string; description: string; url: string }>): Promise<string> {
  try {
    const ollamaUrl2 = await getOllamaBaseUrl();
    const ping = await fetch(`${ollamaUrl2}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!ping?.ok) return "Ollama غير متاح لتوليد التقرير.";

    const findingsList = findings.slice(0, 10).map((f, i) =>
      `${i + 1}. [${f.severity.toUpperCase()}] ${f.title} — ${f.url}\n   ${f.description.slice(0, 150)}`
    ).join("\n");

    const prompt = `أنت خبير أمن معلومات. اكتب تقريراً أمنياً احترافياً باللغة العربية بناءً على نتائج الفحص التالية:

معرف الفحص: ${scanId}
عدد الثغرات المكتشفة: ${findings.length}

النتائج:
${findingsList}

اكتب تقريراً يتضمن:
1. ملخص تنفيذي (3 جمل)
2. أشد الثغرات خطورة وأسبابها
3. توصيات الإصلاح الفورية
4. خطة العمل المقترحة

كن احترافياً ومنظماً.`;

    return await queryOllama(prompt);
  } catch {
    return "تعذّر توليد التقرير — Ollama غير متاح.";
  }
}

export async function checkOllamaAvailable(): Promise<{ available: boolean; models: string[] }> {
  try {
    const ollamaUrl3 = await getOllamaBaseUrl();
    const r = await fetch(`${ollamaUrl3}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { available: false, models: [] };
    const data = await r.json() as { models?: Array<{ name: string }> };
    return { available: true, models: (data.models ?? []).map(m => m.name) };
  } catch {
    return { available: false, models: [] };
  }
}
