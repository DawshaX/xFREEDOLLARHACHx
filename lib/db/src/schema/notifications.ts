import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const notificationsTable = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull().default("info"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
