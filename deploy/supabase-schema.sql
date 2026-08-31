-- THE VESSEL CODE — Supabase schema (paste into SQL Editor)
-- Demo MVP: companies, vessels, user profiles + RLS
--
-- Online sync pilot (TVC No1 only): use deploy/supabase-sync-pilot-tvc-no1.sql
-- Full fleet seed below is for future HQ demo; do not run vessel inserts if pilot-only sync is desired.

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

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  company_id TEXT REFERENCES companies(id),
  account_type TEXT NOT NULL CHECK (account_type IN ('HQ', 'ADMIN', 'SHIP')),
  role TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed: TVC pilot fleet
INSERT INTO companies (id, name) VALUES ('TVC', 'The Vessel Code')
ON CONFLICT (id) DO NOTHING;

INSERT INTO vessels (id, company_id, name, imo_no, delivery) VALUES
  ('TVC No1', 'TVC', 'TVC No1', '9999999', '2003-09-18')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vessels_company_or_admin" ON vessels FOR SELECT USING (
  company_id = (auth.jwt() -> 'user_metadata' ->> 'company_id')
  OR (auth.jwt() -> 'user_metadata' ->> 'account_type') = 'ADMIN'
);

CREATE POLICY "profiles_self_or_admin" ON user_profiles FOR SELECT USING (
  id = auth.uid()
  OR (auth.jwt() -> 'user_metadata' ->> 'account_type') = 'ADMIN'
);

-- After creating Auth users in Supabase Dashboard, insert profiles:
-- dm_user@thevesselcode.com  → HQ, company_id = TVC
-- admin@thevesselcode.com    → ADMIN, company_id = null

-- Cloud sync storage metadata (ZIP packages: Master→HQ, HQ→Ship)
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

ALTER TABLE sync_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_packages_company_or_admin" ON sync_packages FOR SELECT USING (
  company_id = (auth.jwt() -> 'user_metadata' ->> 'company_id')
  OR (auth.jwt() -> 'user_metadata' ->> 'account_type') = 'ADMIN'
);

CREATE POLICY "sync_packages_insert_ship" ON sync_packages FOR INSERT WITH CHECK (
  (auth.jwt() -> 'user_metadata' ->> 'account_type') IN ('ADMIN', 'HQ', 'SHIP')
);

-- Supabase Storage: create bucket `tvc-sync-packages` (private)
-- Path pattern: {company_id}/{vessel_id}/{direction}/{timestamp}_{filename}
