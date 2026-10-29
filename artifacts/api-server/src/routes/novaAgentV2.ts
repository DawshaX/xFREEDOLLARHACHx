import { Router } from "express";
import { NovaAgentV2 } from "../lib/novaAgentV2";

const router = Router();
const agent = new NovaAgentV2();

router.post("/chat", async (req, res) => {
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({ error: "Command is required" });
  }

  // Set headers for SSE (Server-Sent Events) for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  await agent.processCommand(command, (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });

  res.end();
});

export default router;
