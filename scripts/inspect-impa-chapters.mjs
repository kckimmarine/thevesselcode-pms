#!/usr/bin/env node
/**
 * Quality gate report for chapter JSON files (Phase A inspection).
 *   node scripts/inspect-impa-chapters.mjs 23 33 61
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  filterQualityItems,
  qualityGateReasons,
  rowCode,
  normalizeImpaCode,
} from './lib/impa-quality-gate.mjs';

const root = process.cwd();
const chaptersDir = join(root, 'public', 'data', 'chapters');

function loadChapter(ch) {
  const path = join(chaptersDir, `impa-${ch}.json`);
  if (!existsSync(path)) return { chapter: ch, items: [], missing: true };
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const items = Array.isArray(data) ? data : (data.items || []);
  return { chapter: ch, items, missing: false };
}

const args = process.argv.slice(2).filter((a) => /^\d{1,2}$/.test(a));
const chapters = args.length
  ? args.map((c) => c.padStart(2, '0').slice(-2))
  : readdirSync(chaptersDir)
    .map((f) => /^impa-(\d{2})\.json$/.exec(f)?.[1])
    .filter(Boolean);

let exitCode = 0;
for (const ch of chapters) {
  const { items, missing } = loadChapter(ch);
  if (missing) {
    console.log(`ch ${ch}: MISSING file`);
    exitCode = 1;
    continue;
  }
  const { kept, rejected } = filterQualityItems(items);
  const prefixMatch = items.filter((r) => normalizeImpaCode(rowCode(r)).startsWith(ch));
  console.log(`\nch ${ch}: ${items.length} rows, ${kept.length} pass gate, ${rejected.length} rejected, ${prefixMatch.length} codes with prefix ${ch}`);
  if (rejected.length) {
    const sample = rejected.slice(0, 8);
    for (const r of sample) {
      console.log(`  reject ${r.code}: ${r.reasons.join(', ')}`);
    }
    exitCode = 1;
  }
  if (items[0]) {
    const reasons = qualityGateReasons(items[0]);
    console.log(`  sample ${rowCode(items[0])}: ${items[0].n || items[0].name} (${reasons.length ? reasons.join(', ') : 'ok'})`);
  }
}

process.exit(exitCode);
