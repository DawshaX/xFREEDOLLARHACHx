import { chatRoundWithTools, type AnthropicLikeMessage } from "./ai-router-ollama-only";
import { AGENT_TOOLS, runTool, CLIENT_TOOL_NAMES } from "./tools";
import { logger } from "./logger";

export class NovaAgentV3 {
  private systemPrompt = `أنت "Nova Sentinel V3" — الوكيل الذكي الأكثر تقدماً في منصة CyberNova. 
مهمتك هي مساعدة المستخدم في العمليات السيبرانية، الفحص، البحث عن الثغرات، وإدارة النظام.

لديك وصول إلى مجموعة من الأدوات الحقيقية:
- run_shell: لتنفيذ أوامر Linux.
- scan_target / scan_ports: للفحص الأمني.
- nvd_search / exploit_db_search: للبحث عن الثغرات.
- web_search: للبحث في الإنترنت.
- ui_*: للتحكم في واجهة المستخدم (فتح نوافذ، إلخ).

منهجية العمل (ReAct):
1. Thought: فكر في الخطوة التالية.
2. Action: اختر أداة ونفذها.
3. Observation: لاحظ النتائج.
4. كرر حتى تصل للحل النهائي.

يجب أن تتحدث باللغة العربية الفصحى دائماً.`;

  async executeAutonomousTask(command: string, onUpdate: (data: any) => void) {
    try {
      logger.info({ command }, "NovaAgentV3: Starting real task execution");
      
      const messages: AnthropicLikeMessage[] = [
        { role: "user", content: command }
      ];

      let iter = 0;
      while (iter < 10) {
        iter++;
        
        const round = await chatRoundWithTools({
          system: this.systemPrompt,
          messages,
          tools: AGENT_TOOLS,
          maxTokens: 4096,
        });

        if (round.text) {
          onUpdate({ type: 'thought', content: round.text });
        }

        // Append assistant turn to history
        messages.push({
          role: "assistant",
          content: round.assistantBlocks as AnthropicLikeMessage["content"],
        });

        if (round.done || round.toolCalls.length === 0) {
          onUpdate({ type: 'final', content: round.text || "تمت المهمة بنجاح." });
          break;
        }

        const toolResults: any[] = [];
        for (const call of round.toolCalls) {
          onUpdate({ type: 'status', status: 'executing', task: `جاري استخدام الأداة: ${call.name}` });
          onUpdate({ type: 'action', content: `استخدام ${call.name} مع المدخلات: ${JSON.stringify(call.input)}` });

          let result: any;
          if (CLIENT_TOOL_NAMES.has(call.name)) {
            // In a real SSE stream, we'd need a way to signal the client to run this.
            // For now, we'll just record it as dispatched.
            result = { ok: true, status: "dispatched_to_ui", tool: call.name };
          } else {
            try {
              result = await runTool(call.name, call.input);
            } catch (err: any) {
              result = { error: err.message };
            }
          }

          const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          onUpdate({ type: 'observation', content: resultText.slice(0, 1000) });

          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: resultText,
          });
        }

        messages.push({ role: "user", content: toolResults });
      }

    } catch (error: any) {
      logger.error({ error }, "NovaAgentV3: Execution failed");
      onUpdate({ type: 'error', content: `فشل الوكيل: ${error.message}` });
    }
  }
}
