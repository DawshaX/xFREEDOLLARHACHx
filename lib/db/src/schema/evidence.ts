import { pgTable, uuid, text, timestamp, boolean, doublePrecision } from "drizzle-orm/pg-core";

export const evidence = pgTable("evidence", {
  id:              uuid("id").primaryKey().defaultRandom(),
  scanId:          text("scan_id").notNull(),
  targetUrl:       text("target_url").notNull(),
  cveId:           text("cve_id").default(""),
  assetId:         text("asset_id").default(""),
  evidenceType:    text("evidence_type").notNull().default("http_response"),
  severity:        text("severity").notNull().default("medium"),
  title:           text("title").notNull(),
  description:     text("description").notNull().default(""),
  request:         text("request").default(""),
  response:        text("response").default(""),
  payload:         text("payload").default(""),
  proofText:       text("proof_text").default(""),
  statusCode:      text("status_code").default(""),
  responseTime:    doublePrecision("response_time").default(0),
  isVerified:      boolean("is_verified").notNull().default(false),
  isFalsePositive: boolean("is_false_positive").notNull().default(false),
  notes:           text("notes").default(""),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Evidence = typeof evidence.$inferSelect;
export type NewEvidence = typeof evidence.$inferInsert;
