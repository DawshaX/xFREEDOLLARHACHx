/**
 * CVE table migrations — adds new enrichment columns safely (IF NOT EXISTS).
 * Called once at server startup before any CVE operations.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

const COLUMNS: string[] = [
  `ALTER TABLE cves ADD COLUMN IF NOT EXISTS source          TEXT    NOT NULL DEFAULT 'NVD'`,
  `ALTER TABLE cves ADD COLUMN IF NOT EXISTS exploit_type    TEXT`,
  `ALTER TABLE cves ADD COLUMN IF NOT EXISTS poc_url         TEXT`,
  `ALTER TABLE cves ADD COLUMN IF NOT EXISTS poc_verified    BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE cves ADD COLUMN IF NOT EXISTS epss_score      DOUBLE PRECISION`,
  `ALTER TABLE cves ADD COLUMN IF NOT EXISTS affected_products TEXT`,
  `ALTER TABLE cves ADD COLUMN IF NOT EXISTS cwe_ids         TEXT[]`,
  `ALTER TABLE cves ADD COLUMN IF NOT EXISTS tags            TEXT[]`,
  `ALTER TABLE cves ADD COLUMN IF NOT EXISTS report_status   TEXT`,
  `ALTER TABLE cves ADD COLUMN IF NOT EXISTS collected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
];

const INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS cves_source_idx       ON cves (source)`,
  `CREATE INDEX IF NOT EXISTS cves_exploit_type_idx ON cves (exploit_type)`,
  `CREATE INDEX IF NOT EXISTS cves_epss_idx         ON cves (epss_score DESC NULLS LAST)`,
  `CREATE INDEX IF NOT EXISTS cves_collected_idx    ON cves (collected_at DESC)`,
];

const BACKFILL: string[] = [
  // Backfill source for existing rows (they came from NVD / CISA / GitHub patterns)
  `UPDATE cves SET source = 'CISA-KEV' WHERE id NOT LIKE 'CVE-%' AND description LIKE '%[CISA KEV]%' AND source = 'NVD'`,
  `UPDATE cves SET source = 'ExploitDB' WHERE id LIKE 'EDB-%' AND source = 'NVD'`,
];

export async function runCveMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const sql of COLUMNS)  { try { await client.query(sql); } catch { /* ignore if column exists */ } }
    for (const sql of INDEXES)  { try { await client.query(sql); } catch { /* ignore */ } }
    for (const sql of BACKFILL) { try { await client.query(sql); } catch { /* ignore */ } }
    logger.info("CVE schema migrations applied (new columns: source, exploit_type, poc_url, epss_score, ...)");
  } finally {
    client.release();
  }
}
