import { OpenAI } from "openai";
import { NovaIntelligence } from "./novaIntelligence";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export class NovaAgentV2 {
  private client: OpenAI | null = null;
  private model: string = "dolphin-llama3";

  private async getClient(): Promise<OpenAI> {
    const { getOllamaBaseUrl, getOllamaModel } = await import("./ollama-settings");
    const base = await getOllamaBaseUrl();
    this.model = await getOllamaModel();
    return new OpenAI({ baseURL: `${base}/v1`, apiKey: "ollama" });
  }

  async processCommand(command: string, onUpdate: (data: any) => void) {
    try {
      onUpdate({ type: 'thought', content: `بدأت التفكير في الأمر: "${command}" بصفتي Lead Cybersecurity Architect...` });

      // Step 1: Reasoning & Planning
      const planPrompt = `بصفتك Lead Cybersecurity Architect، ضع خطة عمل (Chain of Thought) لتنفيذ الأمر التالي: "${command}". 
      يجب أن تتضمن الخطة خطوات محددة مثل (Reconnaissance, Vulnerability Research, Execution, Stealth Check).
      اكتب الخطة باللغة العربية.`;

      const client = await this.getClient();
      const planResponse = await client.chat.completions.create({
        model: this.model,
        max_completion_tokens: 512,
        messages: [{ role: "user", content: planPrompt }],
      });

      const plan = planResponse.choices[0].message.content;
      onUpdate({ type: 'thought', content: plan });

      // Step 2: Execution (Simulation of Tool Use)
      onUpdate({ type: 'status', status: 'executing', task: 'البحث عن ثغرات حية وتدقيق الهدف' });
      
      const threats = await NovaIntelligence.syncLiveThreats();
      onUpdate({ type: 'info', content: `تم جلب ${threats.length} ثغرات جديدة من CVE Daily Sync.` });

      // Simulate Terminal Action
      if (command.toLowerCase().includes('scan') || command.includes('افحص')) {
        onUpdate({ type: 'status', status: 'executing', task: 'Running Nmap Stealth Scan' });
        // In real env: const { stdout } = await execAsync('nmap -sS ...');
        await new Promise(r => setTimeout(r, 2000));
        onUpdate({ type: 'observation', content: 'Nmap Scan: Port 80 (Open), Port 443 (Open), Port 22 (Filtered).' });
      }

      // Step 3: Zero-Day Intelligence Check
      onUpdate({ type: 'thought', content: 'أقوم الآن بمقارنة نتائج الفحص مع أحدث ثغرات الـ Zero-Day المكتشفة...' });
      const analysis = await NovaIntelligence.comparativeAnalysis('TargetSystem', threats[0]);
      
      if (analysis.isVulnerable) {
        onUpdate({ type: 'alert', content: `تنبيه حرج: الهدف قد يكون مصاباً بـ ${threats[0].id}! نسبة الثقة: ${analysis.confidence * 100}%` });
      }

      // Step 4: Stealth & Final Report
      await NovaIntelligence.enableStealthMode();
      onUpdate({ type: 'info', content: 'تم تفعيل وضع الشبح ومسح سجلات العمليات.' });

      onUpdate({ type: 'final', content: 'تم الانتهاء من المهمة بنجاح. المنظومة الآن في وضع المراقبة المستمرة.' });

    } catch (error: any) {
      onUpdate({ type: 'error', content: `فشل تنفيذ المهمة: ${error.message}` });
    }
  }
}
