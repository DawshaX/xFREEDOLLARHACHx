import { Router } from "express";
import { runNovaAgent } from "../lib/novaAgent";
import { logger } from "../lib/logger";

const router = Router();

/**
 * POST /api/agent/nova/stream
 * Custom Nova Sentinel Agent Stream
 */
router.post("/agent/nova/stream", async (req, res: any) => {
  const { prompt } = req.body;

  if (!prompt) {
    res.status(400).json({ error: "Prompt is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = await runNovaAgent(prompt);

    for await (const chunk of stream) {
      // Send the structured output to the frontend
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.write("event: done\ndata: {}\n\n");
    res.end();
  } catch (error: any) {
    logger.error({ error }, "Nova Agent execution error");
    res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
    res.end();
  }
});

export default router;
