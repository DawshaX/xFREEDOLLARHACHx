/**
 * Ollama-only client (OpenAI-compatible API).
 * Replaces the Anthropic client — all calls go to local Ollama.
 * Client is built lazily on first use so it reads the DB-configured URL.
 */
import OpenAI from "openai";
import { getOllamaBaseUrl, getOllamaModel } from "./ollama-settings";

export const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "dolphin-llama3";

async function buildClient(): Promise<OpenAI> {
  const base = await getOllamaBaseUrl();
  return new OpenAI({ apiKey: "ollama", baseURL: `${base}/v1` });
}

// Lazy singleton — recreated if called after settings change (cache TTL handles this)
let _client: OpenAI | null = null;
let _clientBase = "";

async function getClient(): Promise<OpenAI> {
  const base = await getOllamaBaseUrl();
  if (!_client || _clientBase !== base) {
    _client = await buildClient();
    _clientBase = base;
  }
  return _client;
}

// Anthropic-shaped shim that delegates to Ollama via OpenAI SDK
export const anthropic = {
  messages: {
    create: async (params: {
      model: string;
      max_tokens: number;
      system?: string;
      tools?: Array<{ name: string; description: string; input_schema: object }>;
      messages: Array<{ role: string; content: unknown }>;
    }) => {
      const client = await getClient();
      const model = params.model || await getOllamaModel();

      const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

      if (params.system) {
        openaiMessages.push({ role: "system", content: params.system });
      }

      for (const m of params.messages) {
        if (typeof m.content === "string") {
          openaiMessages.push({ role: m.role as "user" | "assistant", content: m.content });
        } else if (Array.isArray(m.content)) {
          const role = m.role as string;
          if (role === "user") {
            const textParts: string[] = [];
            for (const block of m.content as Array<{ type: string; text?: string; content?: string; tool_use_id?: string }>) {
              if (block.type === "text") textParts.push(block.text ?? "");
              else if (block.type === "tool_result") {
                openaiMessages.push({
                  role: "tool",
                  tool_call_id: block.tool_use_id ?? "id",
                  content: block.content ?? "",
                });
              }
            }
            if (textParts.length) openaiMessages.push({ role: "user", content: textParts.join("\n") });
          } else {
            const textParts: string[] = [];
            const toolCalls: OpenAI.Chat.ChatCompletionMessageParam["tool_calls"] = [];
            for (const block of m.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>) {
              if (block.type === "text") textParts.push(block.text ?? "");
              else if (block.type === "tool_use") {
                (toolCalls as any[]).push({
                  id: block.id, type: "function",
                  function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
                });
              }
            }
            openaiMessages.push({
              role: "assistant",
              content: textParts.join("\n") || null,
              ...(toolCalls && (toolCalls as any[]).length ? { tool_calls: toolCalls } : {}),
            } as OpenAI.Chat.ChatCompletionMessageParam);
          }
        }
      }

      const openaiTools = params.tools?.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));

      const response = await client.chat.completions.create({
        model,
        max_completion_tokens: params.max_tokens,
        messages: openaiMessages,
        ...(openaiTools && openaiTools.length ? { tools: openaiTools, tool_choice: "auto" } : {}),
      });

      const choice = response.choices[0];
      const content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> = [];

      if (choice.message.content) {
        content.push({ type: "text", text: choice.message.content });
      }

      for (const tc of choice.message.tool_calls ?? []) {
        if (tc.type !== "function") continue;
        let input: unknown = {};
        try { input = JSON.parse(tc.function.arguments || "{}"); } catch { input = {}; }
        content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }

      return { content, stop_reason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn" };
    },
  },
} as unknown as {
  messages: {
    create: (params: {
      model: string;
      max_tokens: number;
      system?: string;
      tools?: unknown[];
      messages: unknown[];
    }) => Promise<{
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason: string;
    }>;
  };
};
