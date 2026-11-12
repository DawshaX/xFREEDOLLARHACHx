/**
 * NovaCore — legacy route, now the unified chat.
 *
 * The old page was the "heart" chat: its own `runNova` client, its own timeline
 * renderer, its own memory panel. It is now a thin alias for `NovaUnifiedChat`,
 * which is the same brain (66 tools, live tool stream, approvals, memory) plus
 * the fleet's live state — one chat surface for the whole app.
 */
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";

export default function NovaCore() {
  return (
    <NovaUnifiedChat
      title="نوفا — القلب"
      subtitle="نفس العقل ونفس الأدوات — الشات الموحّد بدل النسخة المتفرقة"
    />
  );
}
