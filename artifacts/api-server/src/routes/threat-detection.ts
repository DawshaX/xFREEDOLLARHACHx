/**
 * Threat Detection Dashboard — Real-time threat analysis powered by dolphin-llama3 via Ollama
 * Routes:
 *   GET  /api/threats             — list recent threats
 *   POST /api/threats             — add a raw threat event
 *   POST /api/threats/:id/analyze — run dolphin-llama3 analysis on a threat (SSE stream)
 *   POST /api/threats/batch-analyze — auto-analyze all unanalyzed threats (SSE)
 *   GET  /api/threats/stats       — threat statistics
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { threats } from "@workspace/db";
import { desc, eq, isNull, or } from "drizzle-orm";

const router: IRouter = Router();

import { getOllamaBaseUrl, getOllamaModel } from "../lib/ollama-settings";

const THREAT_ANALYST_SYSTEM = `You are CyberNova Threat Analyst. Analyze security threats briefly:
1. Threat type (Malware/Phishing/DDoS/Intrusion/Ransomware/Brute Force/SQLi/C2)
2. Severity: CRITICAL/HIGH/MEDIUM/LOW
3. Affected target
4. IOCs (IPs, domains)
5. Immediate mitigation step

Be concise. Max 200 words.`;

async function streamOllamaChat(
  messages: Array<{ role: string; content: string }>,
  onToken: (t: string) => void
): Promise<string> {
  const OLLAMA_URL = await getOllamaBaseUrl();
  const OLLAMA_MODEL = await getOllamaModel();
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: true,
      options: { num_predict: 300, num_ctx: 2048, temperature: 0.1, num_thread: 4 },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Ollama ${resp.status}: ${txt.slice(0, 200)}`);
  }

  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value, { stream: true }).split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const j = JSON.parse(t) as { message?: { content?: string }; done?: boolean };
        const tok = j.message?.content ?? "";
        if (tok) { full += tok; onToken(tok); }
      } catch { /* partial */ }
    }
  }
  return full;
}

// GET /api/threats/stats
router.get("/threats/stats", async (_req, res) => {
  try {
    const all = await db.select().from(threats).orderBy(desc(threats.createdAt)).limit(1000);
    const total = all.length;
    const analyzed = all.filter((t) => t.aiAnalysis).length;
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const t of all) {
      const sev = t.severity || "UNKNOWN";
      const typ = t.threatType || "Unknown";
      bySeverity[sev] = (bySeverity[sev] || 0) + 1;
      byType[typ] = (byType[typ] || 0) + 1;
    }
    res.json({ total, analyzed, pending: total - analyzed, bySeverity, byType });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/threats
router.get("/threats", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await db.select().from(threats).orderBy(desc(threats.createdAt)).limit(limit);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/threats  — add raw threat event
router.post("/threats", async (req, res) => {
  try {
    const {
      title, description, sourceIp, targetIp, port,
      protocol, threatType, severity, rawData,
    } = req.body as {
      title?: string; description?: string; sourceIp?: string;
      targetIp?: string; port?: number; protocol?: string;
      threatType?: string; severity?: string; rawData?: string;
    };

    if (!title && !description && !rawData) {
      res.status(400).json({ error: "title, description, or rawData required" });
      return;
    }

    const [row] = await db
      .insert(threats)
      .values({
        title: title || "Untitled Threat",
        description: description || "",
        sourceIp: sourceIp || null,
        targetIp: targetIp || null,
        port: port || null,
        protocol: protocol || null,
        threatType: threatType || null,
        severity: severity || null,
        rawData: rawData || null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/threats/:id/analyze — SSE stream of dolphin-llama3 analysis
router.post("/threats/:id/analyze", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [threat] = await db.select().from(threats).where(eq(threats.id, id));
    if (!threat) {
      res.status(404).json({ error: "Threat not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const context = [
      threat.title ? `العنوان: ${threat.title}` : "",
      threat.description ? `الوصف: ${threat.description}` : "",
      threat.sourceIp ? `IP المصدر: ${threat.sourceIp}` : "",
      threat.targetIp ? `IP الهدف: ${threat.targetIp}` : "",
      threat.port ? `البورت: ${threat.port}/${threat.protocol || "tcp"}` : "",
      threat.threatType ? `النوع: ${threat.threatType}` : "",
      threat.rawData ? `البيانات الخام:\n${String(threat.rawData).slice(0, 800)}` : "",
    ].filter(Boolean).join("\n");

    let full = "";
    try {
      full = await streamOllamaChat(
        [
          { role: "system", content: THREAT_ANALYST_SYSTEM },
          { role: "user", content: `حلّل هذا التهديد الأمني:\n\n${context}` },
        ],
        (tok) => send("delta", { text: tok })
      );
    } catch (err: any) {
      send("error", { error: err.message });
      res.end();
      return;
    }

    // Extract severity from analysis
    let detectedSeverity = threat.severity;
    if (!detectedSeverity) {
      if (/CRITICAL/i.test(full)) detectedSeverity = "CRITICAL";
      else if (/HIGH/i.test(full)) detectedSeverity = "HIGH";
      else if (/MEDIUM/i.test(full)) detectedSeverity = "MEDIUM";
      else if (/LOW/i.test(full)) detectedSeverity = "LOW";
    }

    // Extract threat type
    let detectedType = threat.threatType;
    if (!detectedType) {
      const typeMatch = full.match(/\b(Malware|Phishing|DDoS|Intrusion|Ransomware|Brute[\s-]?Force|SQL[\s-]?Injection|XSS|SSRF|Backdoor)\b/i);
      if (typeMatch) detectedType = typeMatch[1];
    }

    // Save analysis to DB
    await db
      .update(threats)
      .set({
        aiAnalysis: full.slice(0, 4000),
        severity: detectedSeverity || threat.severity,
        threatType: detectedType || threat.threatType,
        analyzedAt: new Date(),
      })
      .where(eq(threats.id, id));

    send("done", { analysis: full, severity: detectedSeverity, threatType: detectedType });
    res.end();
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// POST /api/threats/batch-analyze — analyze all pending threats (SSE)
router.post("/threats/batch-analyze", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const pending = await db
      .select()
      .from(threats)
      .where(or(isNull(threats.aiAnalysis), eq(threats.aiAnalysis, "")))
      .limit(10);

    send("start", { count: pending.length });

    for (const threat of pending) {
      send("analyzing", { id: threat.id, title: threat.title });
      const context = [
        threat.title ? `العنوان: ${threat.title}` : "",
        threat.description ? `الوصف: ${threat.description}` : "",
        threat.sourceIp ? `IP المصدر: ${threat.sourceIp}` : "",
        threat.rawData ? `البيانات:\n${String(threat.rawData).slice(0, 400)}` : "",
      ].filter(Boolean).join("\n");

      try {
        const full = await streamOllamaChat(
          [
            { role: "system", content: THREAT_ANALYST_SYSTEM },
            { role: "user", content: `حلّل هذا التهديد:\n\n${context}` },
          ],
          () => {}
        );

        let sev = threat.severity;
        if (!sev) {
          if (/CRITICAL/i.test(full)) sev = "CRITICAL";
          else if (/HIGH/i.test(full)) sev = "HIGH";
          else if (/MEDIUM/i.test(full)) sev = "MEDIUM";
          else sev = "LOW";
        }

        await db.update(threats).set({
          aiAnalysis: full.slice(0, 4000),
          severity: sev,
          analyzedAt: new Date(),
        }).where(eq(threats.id, threat.id));

        send("analyzed", { id: threat.id, severity: sev });
      } catch (e: any) {
        send("error", { id: threat.id, error: e.message });
      }
    }

    send("done", { processed: pending.length });
    res.end();
  } catch (err: any) {
    send("error", { error: err.message });
    res.end();
  }
});

export default router;
