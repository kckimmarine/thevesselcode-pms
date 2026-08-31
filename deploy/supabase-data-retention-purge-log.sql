-- THE VESSEL CODE — Data retention audit log (customer-requested purge)
-- Run once in Supabase SQL Editor after sync_packages exists.

CREATE TABLE IF NOT EXISTS data_retention_purge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  vessel_id TEXT,
  scope TEXT NOT NULL DEFAULT 'vessel_sync',
  packages_removed INT NOT NULL DEFAULT 0,
  bytes_removed BIGINT NOT NULL DEFAULT 0,
  reason TEXT,
  requested_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_retention_purge_log_vessel_idx
  ON data_retention_purge_log (vessel_id, created_at DESC);

ALTER TABLE data_retention_purge_log ENABLE ROW LEVEL SECURITY;
