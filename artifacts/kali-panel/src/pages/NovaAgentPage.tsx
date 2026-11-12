/**
 * NovaAgentPage — the primary agent workspace, now the unified chat.
 *
 * It already rendered `LiveAgentPanel`; it now renders `NovaUnifiedChat`, which
 * is the same panel plus the fleet's live state (agents, machines, slots, bus,
 * approvals) read from one source of truth. One chat surface for the whole app.
 */
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";

export default function NovaAgentPage() {
  return (
    <NovaUnifiedChat
      title="نوفا — الوكيل الأساسي"
      subtitle="كلام + تنفيذ حقيقي + ذاكرة دائمة + تحكم في كل الأجهزة المتصلة"
      defaultSide="pulse"
    />
  );
}
