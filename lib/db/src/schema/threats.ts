import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const threats = pgTable("threats", {
  id:          serial("id").primaryKey(),
  title:       text("title").notNull().default(""),
  description: text("description").default(""),
  sourceIp:    text("source_ip"),
  targetIp:    text("target_ip"),
  port:        integer("port"),
  protocol:    text("protocol"),
  threatType:  text("threat_type"),
  severity:    text("severity"),
  rawData:     text("raw_data"),
  aiAnalysis:  text("ai_analysis"),
  analyzedAt:  timestamp("analyzed_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Threat     = typeof threats.$inferSelect;
export type NewThreat  = typeof threats.$inferInsert;
