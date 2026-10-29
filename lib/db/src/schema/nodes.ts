import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const nodes = pgTable("nodes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(22),
  username: text("username").notNull().default("root"),
  authType: text("auth_type").notNull().default("password"),
  credential: text("credential").notNull().default(""),
  status: text("status").notNull().default("unknown"),
  lastPingedAt: timestamp("last_pinged_at", { withTimezone: true }),
  osInfo: text("os_info").default(""),
  tags: text("tags").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const nodeCommands = pgTable("node_commands", {
  id: serial("id").primaryKey(),
  nodeId: integer("node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  command: text("command").notNull(),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  exitCode: integer("exit_code"),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  triggeredBy: text("triggered_by").notNull().default("user"),
});

export type Node = typeof nodes.$inferSelect;
export type InsertNode = typeof nodes.$inferInsert;
export type NodeCommand = typeof nodeCommands.$inferSelect;
