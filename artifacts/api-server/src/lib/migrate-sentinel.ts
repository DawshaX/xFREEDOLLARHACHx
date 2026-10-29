/**
 * NOVA SENTINEL V10 — creates new tables if they don't exist yet.
 * Idempotent (CREATE TABLE IF NOT EXISTS).
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

const TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    tech_stack JSONB NOT NULL DEFAULT '[]',
    domains JSONB NOT NULL DEFAULT '[]',
    ips JSONB NOT NULL DEFAULT '[]',
    category TEXT NOT NULL DEFAULT 'web',
    criticality TEXT NOT NULL DEFAULT 'medium',
    owner TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT true,
    tags JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id TEXT NOT NULL,
    target_url TEXT NOT NULL,
    cve_id TEXT DEFAULT '',
    asset_id TEXT DEFAULT '',
    evidence_type TEXT NOT NULL DEFAULT 'http_response',
    severity TEXT NOT NULL DEFAULT 'medium',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    request TEXT DEFAULT '',
    response TEXT DEFAULT '',
    payload TEXT DEFAULT '',
    proof_text TEXT DEFAULT '',
    status_code TEXT DEFAULT '',
    response_time DOUBLE PRECISION DEFAULT 0,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    is_false_positive BOOLEAN NOT NULL DEFAULT false,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS risk_scores (
    id SERIAL PRIMARY KEY,
    cve_id TEXT NOT NULL UNIQUE,
    cvss DOUBLE PRECISION NOT NULL DEFAULT 0,
    epss_score DOUBLE PRECISION DEFAULT 0,
    is_in_kev BOOLEAN NOT NULL DEFAULT false,
    has_public_exploit BOOLEAN NOT NULL DEFAULT false,
    has_poc BOOLEAN NOT NULL DEFAULT false,
    affected_assets JSONB NOT NULL DEFAULT '[]',
    attack_vector TEXT DEFAULT 'NETWORK',
    attack_complexity TEXT DEFAULT 'LOW',
    risk_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    risk_label TEXT NOT NULL DEFAULT 'MEDIUM',
    exploitability DOUBLE PRECISION DEFAULT 0,
    impact_score DOUBLE PRECISION DEFAULT 0,
    ai_summary TEXT DEFAULT '',
    ai_target TEXT DEFAULT '',
    ai_payload TEXT DEFAULT '',
    ai_remediation TEXT DEFAULT '',
    priority_rank INTEGER DEFAULT 0,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ioc_tracker (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ioc_type TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    severity TEXT NOT NULL DEFAULT 'medium',
    description TEXT DEFAULT '',
    related_cves JSONB NOT NULL DEFAULT '[]',
    tags JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
  )`,
  // indexes for performance
  `CREATE INDEX IF NOT EXISTS risk_scores_label_idx ON risk_scores (risk_label)`,
  `CREATE INDEX IF NOT EXISTS risk_scores_score_idx ON risk_scores (risk_score DESC)`,
  `CREATE INDEX IF NOT EXISTS ioc_tracker_type_idx ON ioc_tracker (ioc_type)`,
  `CREATE INDEX IF NOT EXISTS ioc_tracker_active_idx ON ioc_tracker (is_active)`,
  `CREATE INDEX IF NOT EXISTS evidence_scan_id_idx ON evidence (scan_id)`,
  `CREATE INDEX IF NOT EXISTS assets_criticality_idx ON assets (criticality)`,
];

export async function runSentinelMigrations(): Promise<void> {
  logger.info("NOVA SENTINEL: Running table migrations…");
  for (const sql of TABLES) {
    try {
      await pool.query(sql);
    } catch (e) {
      logger.error({ err: e }, "NOVA SENTINEL migration error");
      throw e;
    }
  }
  logger.info("NOVA SENTINEL: All tables ready ✅");
}
