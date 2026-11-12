/**
 * NovaAgentV3 — legacy route, now the unified chat.
 *
 * The old page ran its own `/nova-agent-v3/chat` client with a fake step
 * timeline. It is now a thin alias for `NovaUnifiedChat`: the same real NOVA,
 * the same live tool stream, the same ops token — no second, pretend agent.
 */
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";

export default function NovaAgentV3() {
  return (
    <NovaUnifiedChat
      title="نوفا — الوكيل (V3)"
      subtitle="نفس العقل ونفس الأدوات — الشات الموحّد بدل النسخة المتفرقة"
    />
  );
}
