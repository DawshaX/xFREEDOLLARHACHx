import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const reportsTable = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  target: text("target").notNull(),
  kind: text("kind").notNull(),
  summary: text("summary").notNull().default(""),
  markdown: text("markdown").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Report = typeof reportsTable.$inferSelect;
