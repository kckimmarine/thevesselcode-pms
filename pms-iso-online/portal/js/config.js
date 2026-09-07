/**
 * Online mode — set at deploy time (Vercel env or edit before first use).
 * Create a separate Supabase project for ISO (do not share TVC-PMS production DB).
 */
window.PMS_ISO_CONFIG = {
  supabaseUrl: 'https://vthtjthxbfepephctnax.supabase.co',
  supabaseAnonKey: '',
  companyName: 'PERFECT MARINE SOLUTION',
  companyShort: 'PMS',
};

(function injectFromMeta() {
  const url = document.querySelector('meta[name="pms-iso-supabase-url"]');
  const key = document.querySelector('meta[name="pms-iso-supabase-anon-key"]');
  if (url?.content) window.PMS_ISO_CONFIG.supabaseUrl = url.content.trim();
  if (key?.content) window.PMS_ISO_CONFIG.supabaseAnonKey = key.content.trim();
})();

(function loadSavedKey() {
  try {
    const saved = localStorage.getItem('pms_iso_anon_key');
    if (saved && !window.PMS_ISO_CONFIG.supabaseAnonKey) {
      window.PMS_ISO_CONFIG.supabaseAnonKey = saved;
    }
  } catch (_) {}
})();

window.PMS_ISO_saveAnonKey = function (key) {
  const k = (key || '').trim();
  if (!k) return false;
  window.PMS_ISO_CONFIG.supabaseAnonKey = k;
  try { localStorage.setItem('pms_iso_anon_key', k); } catch (_) {}
  return true;
};

window.PMS_ISO_needsSetup = function () {
  return !window.PMS_ISO_CONFIG.supabaseAnonKey;
};
