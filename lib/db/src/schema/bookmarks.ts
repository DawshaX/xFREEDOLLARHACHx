import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const bookmarksTable = pgTable("bookmarks", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  refId: text("ref_id").notNull(),
  label: text("label").notNull(),
  url: text("url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Bookmark = typeof bookmarksTable.$inferSelect;
