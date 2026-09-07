-- Storage bucket policies for iso-evidence (run after creating bucket in Dashboard)

-- Bucket: iso-evidence, private

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
