-- THE VESSEL CODE — Supabase schema (paste into SQL Editor)
-- Demo MVP: companies, vessels, user profiles + RLS

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

-- Seed: Daemyung pilot fleet
INSERT INTO companies (id, name) VALUES ('DAEMYUNG', 'Daemyung Shipping')
ON CONFLICT (id) DO NOTHING;

INSERT INTO vessels (id, company_id, name, imo_no, delivery) VALUES
  ('INCHEON CHEMI', 'DAEMYUNG', 'INCHEON CHEMI', '9297711', '2003-09-18'),
  ('QUARTERBACK J', 'DAEMYUNG', 'QUARTERBACK J', '9264879', '2003-01-29'),
  ('GOLDSTAR SHINE', 'DAEMYUNG', 'GOLDSTAR SHINE', '9279707', '2004-09-27'),
  ('VALIANT', 'DAEMYUNG', 'VALIANT', '9274288', '2005-01-20')
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
-- dm_user@thevesselcode.com  → HQ, company_id = DAEMYUNG
-- admin@thevesselcode.com    → ADMIN, company_id = null
