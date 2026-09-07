import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';

const cfg = window.PMS_ISO_CONFIG || {};

export function getClient() {
  const url = cfg.supabaseUrl;
  const key = cfg.supabaseAnonKey;
  if (!url || !key) {
    throw new Error('Supabase not configured. Set portal/js/config.js or Vercel env → meta tags.');
  }
  return createClient(url, key);
}

export async function getSession() {
  const sb = getClient();
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  const sb = getClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const sb = getClient();
  await sb.auth.signOut();
}

export function onAuthChange(cb) {
  const sb = getClient();
  return sb.auth.onAuthStateChange((_event, session) => cb(session));
}
