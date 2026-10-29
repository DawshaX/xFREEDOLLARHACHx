import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const knowledgeTable = pgTable("knowledge", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  content: text("content").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KnowledgeItem = typeof knowledgeTable.$inferSelect;
