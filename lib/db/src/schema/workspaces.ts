import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const workspacesTable = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#22d3ee"),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Workspace = typeof workspacesTable.$inferSelect;
