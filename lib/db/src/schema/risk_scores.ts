import { pgTable, serial, text, timestamp, boolean, doublePrecision, jsonb, integer } from "drizzle-orm/pg-core";

export const riskScores = pgTable("risk_scores", {
  id:               serial("id").primaryKey(),
  cveId:            text("cve_id").notNull().unique(),
  cvss:             doublePrecision("cvss").notNull().default(0),
  epssScore:        doublePrecision("epss_score").default(0),
  isInKev:          boolean("is_in_kev").notNull().default(false),
  hasPublicExploit: boolean("has_public_exploit").notNull().default(false),
  hasPoc:           boolean("has_poc").notNull().default(false),
  affectedAssets:   jsonb("affected_assets").$type<string[]>().notNull().default([]),
  attackVector:     text("attack_vector").default("NETWORK"),
  attackComplexity: text("attack_complexity").default("LOW"),
  riskScore:        doublePrecision("risk_score").notNull().default(0),
  riskLabel:        text("risk_label").notNull().default("MEDIUM"),
  exploitability:   doublePrecision("exploitability").default(0),
  impactScore:      doublePrecision("impact_score").default(0),
  aiSummary:        text("ai_summary").default(""),
  aiTarget:         text("ai_target").default(""),
  aiPayload:        text("ai_payload").default(""),
  aiRemediation:    text("ai_remediation").default(""),
  priorityRank:     integer("priority_rank").default(0),
  lastUpdated:      timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
});

export type RiskScore = typeof riskScores.$inferSelect;
export type NewRiskScore = typeof riskScores.$inferInsert;
