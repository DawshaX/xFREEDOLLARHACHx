import { pgTable, text } from "drizzle-orm/pg-core";

export const cweTable = pgTable("cwe", {
  cweId: text("cwe_id").primaryKey(),
  name: text("name").notNull(),
  abstraction: text("abstraction").notNull().default("Base"),
  description: text("description").notNull(),
});

export type Cwe = typeof cweTable.$inferSelect;
