import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const scheduledJobsTable = pgTable("scheduled_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  cron: text("cron").notNull(),
  target: text("target").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastStatus: text("last_status").notNull().default("pending"),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScheduledJob = typeof scheduledJobsTable.$inferSelect;
