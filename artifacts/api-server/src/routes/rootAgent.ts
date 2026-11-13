import { Router, type IRouter } from "express";
import { runAgent, type AgentEvent } from "../lib/agent/core";
import { ROOT_SESSION_ID, getOrCreateNexusSession } from "../lib/agent/session-nexus";
import { requireOps, tokenConfigured, checkGate } from "../lib/ops/gate";

const router: IRouter = Router();

/**
 * POST /api/agent/root/stream
 * بوابة الوكيل الجذر لسطح المكتب — موحّدة الآن فوق نفس العقل الجذر (`runAgent` +
 * `session-nexus`) لتشارك نفس الأدوات والذاكرة الدائمة والخلفية مع كل صفحات المنصة.
 */
router.post("/agent/root/stream", async (req, res) => {
  const { prompt, history, sessionId, approve } = req.body as {
    prompt?: string;
    sessionId?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    approve?: string[];
  };

  if (!prompt?.trim()) {
    res.status(400).json({ error: "prompt required" });
    return;
  }

  const targetSessionId = String(sessionId || ROOT_SESSION_ID).trim() || ROOT_SESSION_ID;
  const sess = getOrCreateNexusSession(targetSessionId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  function send(event: string, data: unknown) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as unknown as { flush?: () => void }).flush?.();
    } catch { /* ignore */ }
  }

  const approved = (() => {
    const gate = tokenConfigured() ? checkGate(req as never, "root agent stream") : null;
    if (!gate && !tokenConfigured()) return [];
    return gate && gate.ok && gate.code === "allowed" && Array.isArray(approve) ? approve : [];
  })();
  // في بيئة بلا توكن مقفول أو عند تأكيد الجلسة، تظل الأدوات غير الحساسة تعمل تلقائياً
  void requireOps;

  try {
    const cleanHistory = Array.isArray(history) && history.length > 0
      ? history
      : sess.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-8)
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const result = await runAgent({
      message: prompt,
      sessionId: targetSessionId,
      history: cleanHistory,
      approved,
      emit: (ev: AgentEvent) => {
        if (ev.type === "delta") {
          send("text", { text: ev.text });
        } else if (ev.type === "thought") {
          send("thought", { text: ev.text });
        } else if (ev.type === "tool_call") {
          send("tool_use", { id: ev.id, name: ev.name, input: ev.args });
        } else if (ev.type === "tool_result") {
          send("tool_result", { id: ev.id, name: ev.name, result: ev.summary, ok: ev.ok });
        } else if (ev.type === "confirm_required") {
          send("confirm_required", ev);
        } else if (ev.type === "error") {
          send("error", { message: ev.message });
        }
      },
    });
    send("done", { sessionId: targetSessionId, mode: result.mode, toolsUsed: result.toolsUsed, ms: result.ms });
  } catch (e) {
    send("error", { message: (e as Error).message });
  } finally {
    try { res.end(); } catch { /* ignore */ }
  }
});

export default router;
