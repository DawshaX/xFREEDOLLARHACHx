import { pgTable, serial, text, timestamp, integer, doublePrecision } from "drizzle-orm/pg-core";

export const botMemory = pgTable("bot_memory", {
  id: serial("id").primaryKey(),
  memoryType: text("memory_type").notNull(),
  key: text("key").notNull(),
  content: text("content").notNull(),
  context: text("context").default(""),
  confidence: doublePrecision("confidence").notNull().default(1.0),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  sourceSessionId: integer("source_session_id"),
  tags: text("tags").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const botCronJobs = pgTable("bot_cron_jobs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  cronExpression: text("cron_expression").notNull(),
  prompt: text("prompt").notNull(),
  isEnabled: text("is_enabled").notNull().default("true"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastStatus: text("last_status").default(""),
  runCount: integer("run_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const botAlerts = pgTable("bot_alerts", {
  id: serial("id").primaryKey(),
  severity: text("severity").notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  source: text("source").notNull().default("bot"),
  isRead: text("is_read").notNull().default("false"),
  metadata: text("metadata").default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BotMemory = typeof botMemory.$inferSelect;
export type BotCronJob = typeof botCronJobs.$inferSelect;
export type BotAlert = typeof botAlerts.$inferSelect;
