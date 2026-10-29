import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const cves = pgTable(
  "cves",
  {
    id:              text("id").primaryKey(),
    description:     text("description").notNull(),
    cvss:            doublePrecision("cvss").notNull().default(0),
    severity:        text("severity").notNull().default("UNKNOWN"),
    publishedAt:     timestamp("published_at",      { withTimezone: true }).notNull(),
    lastModifiedAt:  timestamp("last_modified_at",  { withTimezone: true }),
    url:             text("url").notNull(),
    raw:             text("raw"),
    syncedAt:        timestamp("synced_at",         { withTimezone: true }).defaultNow().notNull(),
    // ── enrichment fields ───────────────────────────────────────────────────
    source:          text("source").notNull().default("NVD"),
    exploitType:     text("exploit_type"),
    pocUrl:          text("poc_url"),
    pocVerified:     boolean("poc_verified").notNull().default(false),
    epssScore:       doublePrecision("epss_score"),
    affectedProducts: text("affected_products"),
    cweIds:          text("cwe_ids").array(),
    tags:            text("tags").array(),
    reportStatus:    text("report_status"),
    collectedAt:     timestamp("collected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    severityIdx:    index("cves_severity_idx").on(t.severity),
    publishedIdx:   index("cves_published_idx").on(t.publishedAt),
    cvssIdx:        index("cves_cvss_idx").on(t.cvss),
    sourceIdx:      index("cves_source_idx").on(t.source),
    exploitTypeIdx: index("cves_exploit_type_idx").on(t.exploitType),
    epssIdx:        index("cves_epss_idx").on(t.epssScore),
    collectedIdx:   index("cves_collected_idx").on(t.collectedAt),
  }),
);

export const cvesTable = cves;

export type Cve = typeof cves.$inferSelect;
export type InsertCve = typeof cves.$inferInsert;
