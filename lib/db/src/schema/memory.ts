import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const memoryTable = pgTable("memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MemoryItem = typeof memoryTable.$inferSelect;
