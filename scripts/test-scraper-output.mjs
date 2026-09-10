#!/usr/bin/env node
/**
 * Validate IMPA scraper output against storeManager ingestion schema.
 * Run: node scripts/test-scraper-output.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expandCompactItem,
  validateCompactItem,
  isValidImpaCode,
  CHAPTER_META,
} from './lib/impa-scraper-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CHAPTERS_DIR = join(ROOT, 'public/data/chapters');
const MERGED_PATH = join(ROOT, 'public/data/impa-full.json');

function loadJson(path) {
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Mirrors storeManager toDbRecords / TVC_ImpaSchema.fromCatalogJson gate */
function toDbRecord(expanded) {
  if (!expanded?.impa_code || !isValidImpaCode(expanded.impa_code)) return null;
  if (!String(expanded.name || '').trim()) return null;
  return {
    impa_code: expanded.impa_code,
    name: expanded.name,
    unit: expanded.unit || 'PCS',
    category: expanded.category || 'General',
    plate_id: expanded.plate_id || '',
    specs: expanded.specs || {},
  };
}

function normalizeChapterPayload(payload, file) {
  if (Array.isArray(payload)) {
    const match = /impa-(\d{2})\.json$/.exec(file);
    return { chapter: match?.[1] || '', items: payload };
  }
  return {
    chapter: String(payload?.chapter || ''),
    items: Array.isArray(payload?.items) ? payload.items : [],
  };
}

function testChapterFile(file) {
  const raw = loadJson(file);
  const payload = normalizeChapterPayload(raw, file);
  const errors = [];
  if (!payload.chapter) errors.push(`${file}: missing chapter`);
  if (!payload.items.length) errors.push(`${file}: empty items`);

  for (const item of payload.items) {
    const code = item.c || item.impa_code || item.code || '?';
    const ve = validateCompactItem(item);
    if (ve.length) errors.push(`${file} ${code}: ${ve.join(', ')}`);
    const exp = expandCompactItem(item, CHAPTER_META);
    const db = toDbRecord(exp);
    if (!db) errors.push(`${file} ${code}: failed DB expansion`);
  }
  return { file, count: payload.items.length, errors };
}

function main() {
  let failed = 0;

  if (!existsSync(CHAPTERS_DIR)) {
    console.error('FAIL: run scrape-impa-chapters.mjs first');
    process.exit(1);
  }

  const chapterFiles = readdirSync(CHAPTERS_DIR).filter(f => /^impa-\d{2}\.json$/.test(f));
  if (!chapterFiles.length) {
    console.error('FAIL: no chapter JSON files in public/data/chapters');
    process.exit(1);
  }

  console.log('IMPA scraper output validation');
  let totalItems = 0;
  for (const file of chapterFiles.sort()) {
    const result = testChapterFile(join(CHAPTERS_DIR, file));
    totalItems += result.count;
    if (result.errors.length) {
      failed += result.errors.length;
      result.errors.forEach(e => console.error('  FAIL', e));
    } else {
      console.log(`  OK ${file} (${result.count} items)`);
    }
  }

  const merged = loadJson(MERGED_PATH);
  if (!merged.items?.length) {
    console.error('FAIL: impa-full.json has no items');
    failed++;
  } else {
    const memBefore = process.memoryUsage().heapUsed;
    const expanded = merged.items.map(it => expandCompactItem(it, CHAPTER_META));
    const dbRows = expanded.map(toDbRecord).filter(Boolean);
    const memAfter = process.memoryUsage().heapUsed;
    const memMb = (memAfter - memBefore) / (1024 * 1024);
    console.log(`  OK impa-full.json (${dbRows.length} ingestible rows, +${memMb.toFixed(2)} MB heap)`);
    if (dbRows.length !== merged.items.length) {
      console.error(`FAIL: ${merged.items.length - dbRows.length} items failed ingestion expansion`);
      failed++;
    }
    if (memMb > 256) {
      console.error(`FAIL: merged load used ${memMb.toFixed(0)} MB — possible memory issue`);
      failed++;
    }
  }

  if (failed) {
    console.error(`\n${failed} validation error(s)`);
    process.exit(1);
  }
  console.log(`\nAll checks passed (${totalItems} chapter items across ${chapterFiles.length} files).`);
}

main();
