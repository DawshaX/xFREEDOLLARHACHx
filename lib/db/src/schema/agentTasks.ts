import { pgTable, uuid, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const agentTasksTable = pgTable("agent_tasks_v2", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id"),
  title: text("title").notNull(),
  description: text("description"),
  agent: text("agent").notNull(),
  status: text("status").notNull().default("pending"),
  progress: integer("progress").notNull().default(0),
  output: text("output"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentTaskV2 = typeof agentTasksTable.$inferSelect;

/** Alias for backwards-compatible imports */
export const agentTasks = agentTasksTable;
