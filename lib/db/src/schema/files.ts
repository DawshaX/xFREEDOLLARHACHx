import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const files = pgTable("files", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  contentBase64: text("content_base64").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type FileRow = typeof files.$inferSelect;
export type InsertFile = typeof files.$inferInsert;
