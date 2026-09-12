/**
 * IMPA SEO Phase quality gate (see docs/IMPA-SEO-SCALING-CHECKLIST.md §2).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { derivePlateId } from './impa-scraper-schema.mjs';

const SPAM_NAME_RE = /^(test|sample|lorem|xxx+|n\/a|tbd|null)$/i;
const DUPLICATE_NAME_WARN_THRESHOLD = 80;

export function rowCode(row) {
  return String(row?.c || row?.impa_code || row?.code || '').trim();
}

export function normalizeImpaCode(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits || digits.length < 4 || digits.length > 6) return '';
  return digits.padStart(6, '0').slice(-6);
}

export function rowName(row) {
  return String(row?.n || row?.name || '').trim();
}

export function rowUnit(row) {
  return String(row?.u || row?.unit || '').trim();
}

export function rowCategory(row) {
  return String(row?.category || row?.g || '').trim();
}

export function rowSpecs(row) {
  if (row?.specs && typeof row.specs === 'object' && Object.keys(row.specs).length) {
    return row.specs;
  }
  return null;
}

export function rowPlate(row) {
  return String(row?.p || row?.plate_id || row?.plate_no || '').trim();
}

export function plateAssetOk(plateRef, code, platesDir) {
  const plate = plateRef || derivePlateId(code);
  if (!plate) return true;
  const safe = plate.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) return true;
  if (!platesDir) return true;
  const webp = join(platesDir, `${safe}.webp`);
  const jpg = join(platesDir, `${safe}.jpg`);
  if (existsSync(webp) || existsSync(jpg)) return true;
  if (/^PL-\d{2}-\d{2}$/i.test(safe)) return true;
  return !!safe;
}

/**
 * @returns {string[]} rejection reasons (empty = pass)
 */
export function qualityGateReasons(row, ctx = {}) {
  const reasons = [];
  const code = normalizeImpaCode(rowCode(row));
  if (!code) reasons.push('invalid_code');
  const name = rowName(row);
  if (!name || name.length < 3) reasons.push('missing_name');
  if (SPAM_NAME_RE.test(name)) reasons.push('spam_name');

  const unit = rowUnit(row);
  const category = rowCategory(row);
  const specs = rowSpecs(row);
  const hasMeaningfulSpecs = specs && Object.values(specs).some((v) => String(v || '').trim().length > 1);
  if (!unit && !category && !hasMeaningfulSpecs) reasons.push('missing_specs_unit_category');

  const plate = rowPlate(row);
  if (!plate && !derivePlateId(code)) reasons.push('missing_plate');
  if (!plateAssetOk(plate, code, ctx.platesDir)) reasons.push('invalid_plate_ref');

  const dupCount = ctx.nameCounts?.get(name.toLowerCase()) || 0;
  if (name && dupCount > DUPLICATE_NAME_WARN_THRESHOLD) reasons.push('duplicate_spam_name');

  return reasons;
}

export function passesQualityGate(row, ctx = {}) {
  return qualityGateReasons(row, ctx).length === 0;
}

export function buildNameCounts(items) {
  const nameCounts = new Map();
  for (const row of items) {
    const name = rowName(row).toLowerCase();
    if (!name) continue;
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  return nameCounts;
}

export function filterQualityItems(items, ctx = {}) {
  const nameCounts = ctx.nameCounts || buildNameCounts(items);
  const platesDir = ctx.platesDir || join(process.cwd(), 'public', 'data', 'plates');
  const seen = new Set();
  const kept = [];
  const rejected = [];

  for (const row of items) {
    const code = normalizeImpaCode(rowCode(row));
    if (!code || seen.has(code)) {
      rejected.push({ code: rowCode(row), reasons: ['duplicate_code'] });
      continue;
    }
    const reasons = qualityGateReasons(row, { ...ctx, platesDir, nameCounts });
    if (reasons.length) {
      rejected.push({ code, reasons });
      continue;
    }
    seen.add(code);
    kept.push(row);
  }
  return { kept, rejected };
}
