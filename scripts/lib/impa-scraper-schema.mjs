/**
 * Shared IMPA compact ↔ catalog schema helpers (scraper + tests).
 */

export const CHAPTER_META = {
  '23': { title: 'Cordage & Ropes', category: 'Rigging' },
  '33': { title: 'Deck & Mooring Stores', category: 'Deck' },
  '59': { title: 'Safety Equipment', category: 'Safety' },
  '61': { title: 'Hand Tools', category: 'Tools' },
  '79': { title: 'Paints & Coatings', category: 'Paint' },
  '81': { title: 'Valves & Cocks', category: 'Piping' },
};

export const ALL_CHAPTERS = Object.keys(CHAPTER_META);

export function derivePlateId(code) {
  const c = String(code || '').replace(/\D/g, '').padStart(6, '0');
  if (c.length < 4) return '';
  return `PL-${c.slice(0, 2)}-${c.slice(2, 4)}`;
}

export function normalizeUnit(unit) {
  const u = String(unit || 'PCS').trim().toUpperCase();
  return u || 'PCS';
}

export function isValidImpaCode(code) {
  return /^\d{6}$/.test(String(code || '').trim());
}

/** Compact scraper row → storeManager / fromCatalogJson compatible object */
export function expandCompactItem(item, chapterMeta = CHAPTER_META) {
  const c = String(item?.c || item?.impa_code || item?.code || '').trim();
  const g = String(item?.g || c.slice(0, 2) || '').trim();
  const meta = chapterMeta[g] || { title: `Chapter ${g}`, category: 'General' };
  const p = String(item?.p || item?.plate_id || item?.plate_no || '').trim() || derivePlateId(c);
  return {
    impa_code: c,
    code: c,
    name: String(item?.n || item?.name || '').trim(),
    unit: normalizeUnit(item?.u || item?.unit),
    category: String(item?.category || meta.category || 'General').trim(),
    chapter: g,
    plate_id: p,
    plate_no: p,
    specs: item?.specs && typeof item.specs === 'object' ? { ...item.specs } : {},
  };
}

export function validateCompactItem(item) {
  const errors = [];
  const code = String(item?.c || item?.impa_code || item?.code || '').trim();
  if (!isValidImpaCode(code)) errors.push(`invalid code: ${code}`);
  if (!String(item?.n || item?.name || '').trim()) errors.push('missing name (n)');
  if (!String(item?.u || item?.unit || '').trim()) errors.push('missing unit (u)');
  if (!String(item?.g || code.slice(0, 2) || '').trim()) errors.push('missing chapter (g)');
  return errors;
}
