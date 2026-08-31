-- THE VESSEL CODE — Supabase sync ingest (Phase A)
-- Operational records mirrored from sync ZIP payloads (tvc_sync.json).
-- Ingest runs server-side on ship/hq push (service_role). HQ/Admin read via RLS.
--
-- Prerequisite: deploy/supabase-sync-pilot-tvc-no1.sql (companies, vessels, sync_packages)

-- ---------------------------------------------------------------------------
-- sync_records — one row per IndexedDB record (JSONB payload, merge by updated_at)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_records (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vessel_id TEXT NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  record_updated_at TIMESTAMPTZ,
  last_package_id UUID REFERENCES sync_packages(id) ON DELETE SET NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vessel_id, store_name, record_key)
);

CREATE INDEX IF NOT EXISTS sync_records_company_vessel_store_idx
  ON sync_records (company_id, vessel_id, store_name);

CREATE INDEX IF NOT EXISTS sync_records_ingested_at_idx
  ON sync_records (vessel_id, ingested_at DESC);

-- ---------------------------------------------------------------------------
-- sync_vessel_meta — vessel-level blobs from payload (e.g. run_hours)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_vessel_meta (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vessel_id TEXT NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  meta_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  last_package_id UUID REFERENCES sync_packages(id) ON DELETE SET NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vessel_id, meta_key)
);

CREATE INDEX IF NOT EXISTS sync_vessel_meta_company_idx
  ON sync_vessel_meta (company_id, vessel_id);

-- ---------------------------------------------------------------------------
-- sync_package_ingest — audit / idempotency per uploaded ZIP
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_package_ingest (
  package_id UUID PRIMARY KEY REFERENCES sync_packages(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  vessel_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OK', 'FAILED', 'SKIPPED')),
  records_upserted INT NOT NULL DEFAULT 0,
  records_skipped INT NOT NULL DEFAULT 0,
  meta_upserted INT NOT NULL DEFAULT 0,
  error_message TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_package_ingest_vessel_idx
  ON sync_package_ingest (vessel_id, ingested_at DESC);

-- ---------------------------------------------------------------------------
-- RLS — HQ reads own company; ADMIN reads all (matches sync_packages)
-- ---------------------------------------------------------------------------
ALTER TABLE sync_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_vessel_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_package_ingest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_records_company_or_admin" ON sync_records;
CREATE POLICY "sync_records_company_or_admin" ON sync_records FOR SELECT USING (
  company_id = (auth.jwt() -> 'user_metadata' ->> 'company_id')
  OR (auth.jwt() -> 'user_metadata' ->> 'account_type') = 'ADMIN'
);

DROP POLICY IF EXISTS "sync_vessel_meta_company_or_admin" ON sync_vessel_meta;
CREATE POLICY "sync_vessel_meta_company_or_admin" ON sync_vessel_meta FOR SELECT USING (
  company_id = (auth.jwt() -> 'user_metadata' ->> 'company_id')
  OR (auth.jwt() -> 'user_metadata' ->> 'account_type') = 'ADMIN'
);

DROP POLICY IF EXISTS "sync_package_ingest_company_or_admin" ON sync_package_ingest;
CREATE POLICY "sync_package_ingest_company_or_admin" ON sync_package_ingest FOR SELECT USING (
  company_id = (auth.jwt() -> 'user_metadata' ->> 'company_id')
  OR (auth.jwt() -> 'user_metadata' ->> 'account_type') = 'ADMIN'
);

GRANT SELECT ON sync_records TO authenticated;
GRANT SELECT ON sync_vessel_meta TO authenticated;
GRANT SELECT ON sync_package_ingest TO authenticated;
