import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const auditLogTable = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  result: text("result").notNull().default("success"),
  detail: text("detail"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditEntry = typeof auditLogTable.$inferSelect;
