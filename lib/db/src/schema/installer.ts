import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const installerToolsTable = pgTable("installer_tools", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  installCommand: text("install_command").notNull(),
  binary: text("binary").notNull(),
  installed: boolean("installed").notNull().default(false),
  version: text("version").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InstallerTool = typeof installerToolsTable.$inferSelect;
