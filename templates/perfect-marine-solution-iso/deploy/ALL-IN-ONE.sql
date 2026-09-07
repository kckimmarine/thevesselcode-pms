-- PMS ISO — 한 번에 실행 (Supabase SQL Editor에 붙여넣기 후 Run)
-- 프로젝트: pms-iso | TVC-PMS 프로덕션 DB가 아닌 전용 프로젝트에서만 실행

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS iso_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iso_documents (
  doc_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('QM', 'SOP', 'WI', 'FRM', 'REC')),
  revision TEXT NOT NULL DEFAULT '0.1',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'obsolete')),
  folder TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS iso_cars (
  car_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  description TEXT,
  due_at DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS iso_checklist_items (
  item_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iso_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  description TEXT,
  audit_clause TEXT,
  file_size BIGINT,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  uploaded_by UUID REFERENCES auth.users(id)
);

ALTER TABLE iso_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE iso_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE iso_cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE iso_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE iso_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iso_profiles_self" ON iso_profiles;
DROP POLICY IF EXISTS "iso_profiles_self_update" ON iso_profiles;
CREATE POLICY "iso_profiles_self" ON iso_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "iso_profiles_self_update" ON iso_profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "iso_docs_read" ON iso_documents;
DROP POLICY IF EXISTS "iso_docs_write" ON iso_documents;
CREATE POLICY "iso_docs_read" ON iso_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "iso_docs_write" ON iso_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM iso_profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM iso_profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')));

DROP POLICY IF EXISTS "iso_cars_read" ON iso_cars;
DROP POLICY IF EXISTS "iso_cars_write" ON iso_cars;
CREATE POLICY "iso_cars_read" ON iso_cars FOR SELECT TO authenticated USING (true);
CREATE POLICY "iso_cars_write" ON iso_cars FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM iso_profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM iso_profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')));

DROP POLICY IF EXISTS "iso_checklist_read" ON iso_checklist_items;
DROP POLICY IF EXISTS "iso_checklist_write" ON iso_checklist_items;
CREATE POLICY "iso_checklist_read" ON iso_checklist_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "iso_checklist_write" ON iso_checklist_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM iso_profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')));

DROP POLICY IF EXISTS "iso_evidence_read" ON iso_evidence;
DROP POLICY IF EXISTS "iso_evidence_write" ON iso_evidence;
CREATE POLICY "iso_evidence_read" ON iso_evidence FOR SELECT TO authenticated USING (true);
CREATE POLICY "iso_evidence_write" ON iso_evidence FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM iso_profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM iso_profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor')));

INSERT INTO iso_checklist_items (item_key, label, sort_order) VALUES
  ('scope', '인증 범위·조직도 최신', 10),
  ('manual', '품질매뉴얼 승인', 20),
  ('sop', '필수 절차서 3종 이상', 30),
  ('internal_audit', '내부심사 계획·보고서', 40),
  ('car', '미결 CAR 추적', 50),
  ('evidence', '증빙 파일 업로드', 60),
  ('training', '교육·자격 증빙', 70),
  ('tvc_export', 'TVC-PMS export ZIP 증빙', 80)
ON CONFLICT (item_key) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) VALUES ('iso-evidence', 'iso-evidence', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "iso_evidence_storage_read" ON storage.objects;
DROP POLICY IF EXISTS "iso_evidence_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "iso_evidence_storage_delete" ON storage.objects;

CREATE POLICY "iso_evidence_storage_read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'iso-evidence');

CREATE POLICY "iso_evidence_storage_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'iso-evidence'
  AND EXISTS (SELECT 1 FROM iso_profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor'))
);

CREATE POLICY "iso_evidence_storage_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'iso-evidence'
  AND EXISTS (SELECT 1 FROM iso_profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'editor'))
);
