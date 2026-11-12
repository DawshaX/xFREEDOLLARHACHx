/**
 * NovaAgent — legacy route, now the unified chat.
 *
 * This page used to be a mock: it faked the agent's status with `setTimeout`
 * and random CPU/RAM numbers, and its "send" button never reached the brain.
 * It is now a thin alias for `NovaUnifiedChat`, so the route keeps working but
 * talks to the real 66-tool NOVA with the real ops token — one chat, one brain,
 * one connection.
 */
import { NovaUnifiedChat } from "@/components/desktop/NovaUnifiedChat";

export default function NovaAgent() {
  return (
    <NovaUnifiedChat
      title="نوفا — الوكيل الأساسي"
      subtitle="كلام + تنفيذ حقيقي + ذاكرة دائمة + تحكم في كل الأجهزة المتصلة"
    />
  );
}
