/**
 * Agent — legacy route, now the unified chat.
 *
 * The old page drove `/api/agent/tasks` with its own step model. It is now a
 * thin alias for `NovaUnifiedChat`: one chat surface, one brain, one token.
 */
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";

export default function Agent() {
  return (
    <NovaUnifiedChat
      title="نوفا — الوكيل"
      subtitle="نفس العقل ونفس الأدوات — الشات الموحّد بدل النسخة المتفرقة"
    />
  );
}
