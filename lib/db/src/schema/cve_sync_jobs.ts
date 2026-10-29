import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const cveSyncJobs = pgTable("cve_sync_jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"),
  totalFetched: integer("total_fetched").notNull().default(0),
  totalAvailable: integer("total_available").notNull().default(0),
  pagesDone: integer("pages_done").notNull().default(0),
  lastError: text("last_error"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type CveSyncJob = typeof cveSyncJobs.$inferSelect;
