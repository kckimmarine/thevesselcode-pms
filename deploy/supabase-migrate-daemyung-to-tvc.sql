-- Migrate pilot identity: DAEMYUNG / INCHEON CHEMI → TVC / TVC No1
-- Run once in Supabase SQL Editor after pilot rename deploy.

INSERT INTO companies (id, name) VALUES ('TVC', 'The Vessel Code')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO vessels (id, company_id, name, imo_no, delivery) VALUES
  ('TVC No1', 'TVC', 'TVC No1', '9297711', '2003-09-18')
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  name = EXCLUDED.name,
  imo_no = EXCLUDED.imo_no,
  delivery = EXCLUDED.delivery;

-- Repoint existing sync packages (if any were uploaded under old IDs)
UPDATE sync_packages SET company_id = 'TVC', vessel_id = 'TVC No1'
WHERE company_id = 'DAEMYUNG' AND vessel_id = 'INCHEON CHEMI';

-- Optional cleanup (only when no packages reference old vessel)
DELETE FROM vessels WHERE id = 'INCHEON CHEMI';
DELETE FROM companies WHERE id = 'DAEMYUNG';
