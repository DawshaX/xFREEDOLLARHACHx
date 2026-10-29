import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const webhooksTable = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull(),
  url: text("url").notNull(),
  event: text("event").notNull().default("all"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Webhook = typeof webhooksTable.$inferSelect;
