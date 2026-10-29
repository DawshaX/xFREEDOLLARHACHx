import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";

export const agentTaskStepsTable = pgTable("agent_task_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentTaskStepV2 = typeof agentTaskStepsTable.$inferSelect;

/** Alias for backwards-compatible imports */
export const agentSteps = agentTaskStepsTable;
