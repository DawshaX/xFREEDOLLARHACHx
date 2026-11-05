/**
 * مجرّة أحداث الأتمتة — مصدر ورقي صغير عشان نكسر الحلقة بين الديمون والتحكم.
 * اللي بيستنى في `/api/autonomous/stream` بيشوف الأحداث دي فعلاً، مش ping صامت.
 */
import { EventEmitter } from "node:events";

const bus = new EventEmitter();
bus.setMaxListeners(64);

export interface AutonomyEvent {
  type: "tick_start" | "tick_done" | "tick_error" | "enabled" | "disabled" | "note";
  at: string;
  detail?: Record<string, unknown>;
}

export function emitAutonomyEvent(type: AutonomyEvent["type"], detail?: Record<string, unknown>): void {
  bus.emit("autonomy", { type, at: new Date().toISOString(), detail } satisfies AutonomyEvent);
}

export function subscribeAutonomyEvent(cb: (e: AutonomyEvent) => void): () => void {
  bus.on("autonomy", cb);
  return () => bus.off("autonomy", cb);
}

export function autonomyListenerCount(): number {
  return bus.listenerCount("autonomy");
}
