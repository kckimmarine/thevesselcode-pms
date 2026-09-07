/**
 * Online mode — set at deploy time (Vercel env or edit before first use).
 * Create a separate Supabase project for ISO (do not share TVC-PMS production DB).
 */
window.PMS_ISO_CONFIG = {
  supabaseUrl: '',
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
