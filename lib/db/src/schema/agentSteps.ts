import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";

export const agentTaskStepsTable = pgTable("agent_task_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull(),
  kind: text("kind").notNull().default("step"),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  // ── additive columns (2026-11-05): the agent planner writes these ──────────
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("pending"),
  output: text("output").notNull().default(""),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentTaskStepV2 = typeof agentTaskStepsTable.$inferSelect;

/** Alias for backwards-compatible imports */
export const agentSteps = agentTaskStepsTable;
