/**
 * NovaAgentV6 — legacy route, now the unified chat.
 *
 * The old page faked a task timeline with `setTimeout` and never called the
 * brain. It is now a thin alias for `NovaUnifiedChat`: the same real NOVA, the
 * same live tool stream, the same ops token — no second, pretend agent.
 */
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";

export default function NovaAgentV6() {
  return (
    <NovaUnifiedChat
      title="نوفا — الوكيل الأساسي (V6)"
      subtitle="نفس العقل ونفس الأدوات — الشات الموحّد بدل النسخة المزيّفة"
    />
  );
}
