#!/usr/bin/env node
/**
 * Merge public/data/chapters/*.json + data/impa-catalog.json → public/data/impa-full.json
 * Run before Vercel static build so /toolkit can load one bundled catalog.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CHAPTERS_DIR = join(ROOT, 'public/data/chapters');
const SEED_PATH = join(ROOT, 'data/impa-catalog.json');
const OUT_PATH = join(ROOT, 'public/data/impa-full.json');

function loadRows(path) {
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function rowCode(row) {
  return String(row?.c || row?.impa_code || row?.code || '').trim();
}

function main() {
  const byCode = new Map();
  const chapters = [];

  for (const row of loadRows(SEED_PATH)) {
    const code = rowCode(row);
    if (code) byCode.set(code, row);
  }

  if (existsSync(CHAPTERS_DIR)) {
    for (const file of readdirSync(CHAPTERS_DIR).sort()) {
      const m = /^impa-(\d{2})\.json$/.exec(file);
      if (!m) continue;
      chapters.push(m[1]);
      for (const row of loadRows(join(CHAPTERS_DIR, file))) {
        const code = rowCode(row);
        if (code) byCode.set(code, row);
      }
    }
  }

  const items = [...byCode.values()].sort((a, b) => rowCode(a).localeCompare(rowCode(b)));
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      chapters,
      count: items.length,
      items,
    }, null, 2) + '\n',
    'utf8',
  );
  console.log(`Merged ${items.length} catalog items (${chapters.length} chapters) → public/data/impa-full.json`);
}

main();
