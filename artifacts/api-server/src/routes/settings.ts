import { Router } from "express";

const router = Router();

const DEFAULT_SETTINGS: Record<string, string> = {
  provider: "ollama-ngrok",
  ollamaModel: "dolphin-llama3:latest",
  ngrokUrl: "https://nucleus-uninjured-tusk.ngrok-free.dev",
  ngrokModel: "dolphin-llama3:latest",
  activeEndpoint: "ngrok",
};

const store = new Map<string, string>(Object.entries(DEFAULT_SETTINGS));

export function getSetting(key: string): string {
  return store.get(key) ?? "";
}

export function getAllSettings(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of store) result[k] = v;
  return result;
}

router.get("/settings", (_req, res) => {
  const map = getAllSettings();
  res.json({
    provider: map.provider || "ollama-ngrok",
    model: map.ngrokModel || map.ollamaModel || "dolphin-llama3:latest",
    ollamaModel: map.ollamaModel || "dolphin-llama3:latest",
    ngrokUrl: map.ngrokUrl || "https://nucleus-uninjured-tusk.ngrok-free.dev",
    ngrokModel: map.ngrokModel || "dolphin-llama3:latest",
    activeEndpoint: map.activeEndpoint || "ngrok",
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasOpenaiKey: !!process.env.OPENAI_API_KEY,
    useReplitDefault: map.useReplitDefault !== "false",
  });
});

router.put("/settings", (req, res) => {
  const body = req.body as Record<string, string | boolean | undefined>;
  const allowed = ["provider", "model", "ollamaModel", "ollamaBaseUrl", "ngrokUrl", "ngrokModel", "activeEndpoint", "useReplitDefault"];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      store.set(key, String(body[key]));
    }
  }
  res.json({ ok: true, settings: getAllSettings() });
});

export default router;
