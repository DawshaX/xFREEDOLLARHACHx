/**
 * NovaAgentChat — legacy route, now the unified chat.
 *
 * The old page ran its own SSE client against `/nova-core/chat` with a session
 * sidebar. It is now a thin alias for `NovaUnifiedChat`, which is the same
 * brain plus the fleet's live state — one chat surface for the whole app.
 */
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";

export default function NovaAgentChat() {
  return (
    <NovaUnifiedChat
      title="نوفا — شات الوكيل"
      subtitle="نفس العقل ونفس الأدوات — الشات الموحّد بدل النسخة المتفرقة"
    />
  );
}
