import { Router } from "express";
import { NovaAgentV3 } from "../lib/novaAgentV3";

const router = Router();
const agent = new NovaAgentV3();

router.post("/nova-agent-v3/chat", async (req, res) => {
  try {
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({ error: "Command is required" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    await agent.executeAutonomousTask(command, (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });

    res.end();
  } catch (error: any) {
    console.error("SSE Route Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
      res.end();
    }
  }
});

export default router;
