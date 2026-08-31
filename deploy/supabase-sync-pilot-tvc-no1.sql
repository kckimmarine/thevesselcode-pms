-- THE VESSEL CODE — Online sync pilot (TVC No1 only)
-- Paste into Supabase SQL Editor, then create Storage bucket `tvc-sync-packages` (private).
-- Do NOT seed other vessels until pilot is complete.

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vessels (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  imo_no TEXT,
  delivery DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO companies (id, name) VALUES ('TVC', 'The Vessel Code')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO vessels (id, company_id, name, imo_no, delivery) VALUES
  ('TVC No1', 'TVC', 'TVC No1', '9999999', '2003-09-18')
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  name = EXCLUDED.name,
  imo_no = EXCLUDED.imo_no,
  delivery = EXCLUDED.delivery;

CREATE TABLE IF NOT EXISTS sync_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  vessel_id TEXT NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('SHIP_TO_HQ', 'HQ_TO_SHIP', 'STATION_TO_HUB')),
  storage_path TEXT NOT NULL,
  filename TEXT,
  file_size BIGINT,
  exported_by TEXT,
  record_count INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'IMPORTED', 'ARCHIVED')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_packages_vessel_dir_idx
  ON sync_packages (vessel_id, direction, created_at DESC);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vessels_company_or_admin" ON vessels;
CREATE POLICY "vessels_company_or_admin" ON vessels FOR SELECT USING (
  company_id = (auth.jwt() -> 'user_metadata' ->> 'company_id')
  OR (auth.jwt() -> 'user_metadata' ->> 'account_type') = 'ADMIN'
);

DROP POLICY IF EXISTS "sync_packages_company_or_admin" ON sync_packages;
CREATE POLICY "sync_packages_company_or_admin" ON sync_packages FOR SELECT USING (
  company_id = (auth.jwt() -> 'user_metadata' ->> 'company_id')
  OR (auth.jwt() -> 'user_metadata' ->> 'account_type') = 'ADMIN'
);

DROP POLICY IF EXISTS "sync_packages_insert_ship" ON sync_packages;
CREATE POLICY "sync_packages_insert_ship" ON sync_packages FOR INSERT WITH CHECK (
  (auth.jwt() -> 'user_metadata' ->> 'account_type') IN ('ADMIN', 'HQ', 'SHIP')
);

-- Storage (Dashboard): Storage -> New bucket
--   Name: tvc-sync-packages
--   Public: OFF (private)
-- Path pattern used by API: TVC/TVC No1/{direction}/{timestamp}_{filename}.zip
