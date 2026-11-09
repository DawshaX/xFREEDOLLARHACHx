/**
 * NovaAgentPro — legacy route, now the unified chat.
 *
 * The old page was the "advanced agent office": its own `/nova-agent-v3/chat`
 * client, its own tools/council/mission panels. It is now a thin alias for
 * `NovaUnifiedChat`, which is the same brain plus the fleet's live state — one
 * chat surface for the whole app, so "which chat is the real one?" stops being
 * a question.
 */
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";

export default function NovaAgentPro() {
  return (
    <NovaUnifiedChat
      title="نوفا — الوكيل المطوّر"
      subtitle="نفس العقل ونفس الأدوات — الشات الموحّد بدل النسخة المتفرقة"
    />
  );
}
