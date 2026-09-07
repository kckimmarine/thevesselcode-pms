import { getClient } from './auth.js';

const BUCKET = 'iso-evidence';

export async function listDocuments() {
  const sb = getClient();
  const { data, error } = await sb
    .from('iso_documents')
    .select('*')
    .order('doc_id');
  if (error) throw error;
  return data || [];
}

export async function upsertDocument(row) {
  const sb = getClient();
  const { data, error } = await sb.from('iso_documents').upsert(row).select().single();
  if (error) throw error;
  return data;
}

export async function listCars() {
  const sb = getClient();
  const { data, error } = await sb.from('iso_cars').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function upsertCar(row) {
  const sb = getClient();
  const { data, error } = await sb.from('iso_cars').upsert(row).select().single();
  if (error) throw error;
  return data;
}

export async function listChecklist() {
  const sb = getClient();
  const { data, error } = await sb.from('iso_checklist_items').select('*').order('sort_order');
  if (error) throw error;
  return data || [];
}

export async function setChecklistItem(itemKey, completed, notes) {
  const sb = getClient();
  const { data, error } = await sb
    .from('iso_checklist_items')
    .update({ completed, notes, updated_at: new Date().toISOString() })
    .eq('item_key', itemKey)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listEvidence() {
  const sb = getClient();
  const { data, error } = await sb.from('iso_evidence').select('*').order('uploaded_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function uploadEvidence(file, meta) {
  const sb = getClient();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}_${safe}`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (upErr) throw upErr;
  const { data, error } = await sb
    .from('iso_evidence')
    .insert({
      filename: file.name,
      storage_path: path,
      description: meta.description || '',
      audit_clause: meta.audit_clause || '',
      file_size: file.size,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function evidenceDownloadUrl(storagePath) {
  const sb = getClient();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}
