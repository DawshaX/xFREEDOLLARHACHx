import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";

export const shellSessionsTable = pgTable("shell_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  cwd: text("cwd").notNull().default("/tmp"),
  commandCount: integer("command_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shellHistoryTable = pgTable("shell_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  command: text("command").notNull(),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  exitCode: integer("exit_code").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShellSession = typeof shellSessionsTable.$inferSelect;
export type ShellHistory = typeof shellHistoryTable.$inferSelect;
