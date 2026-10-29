import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";

export const ragFilesTable = pgTable("rag_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull().default("text/plain"),
  size: integer("size").notNull().default(0),
  content: text("content").notNull().default(""),
  summary: text("summary").default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RagFile = typeof ragFilesTable.$inferSelect;
