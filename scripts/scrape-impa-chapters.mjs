#!/usr/bin/env node
/**
 * Modular IMPA chapter scraper — polite fetch + HTML/JSON extraction.
 *
 * Usage:
 *   node scripts/scrape-impa-chapters.mjs --chapters=59,81
 *   node scripts/scrape-impa-chapters.mjs --all
 *   node scripts/scrape-impa-chapters.mjs --chapters=59 --live
 *
 * Env:
 *   IMPA_SCRAPER_BASE_URL — live catalog base (e.g. https://store.example.com/impa)
 *   IMPA_SCRAPER_DELAY_MS — delay between requests (default 400)
 *
 * Default source: local HTML fixtures (scripts/fixtures/impa-catalog/) simulating
 * public marine store catalog table structures — no bot blocks in CI.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_CHAPTERS,
  CHAPTER_META,
  derivePlateId,
  normalizeUnit,
  isValidImpaCode,
} from './lib/impa-scraper-schema.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURE_DIR = join(__dirname, 'fixtures/impa-catalog');
const OUT_DIR = join(ROOT, 'public/data/chapters');
const MERGED_PATH = join(ROOT, 'public/data/impa-full.json');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 TVC-IMPA-Scraper/1.0';

function parseArgs(argv) {
  const opts = { chapters: [], all: false, live: false, delay: Number(process.env.IMPA_SCRAPER_DELAY_MS) || 400 };
  for (const arg of argv) {
    if (arg === '--all') opts.all = true;
    else if (arg === '--live') opts.live = true;
    else if (arg.startsWith('--chapters=')) {
      opts.chapters = arg.slice('--chapters='.length).split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--delay=')) {
      opts.delay = Math.max(100, Number(arg.slice('--delay='.length)) || 400);
    }
  }
  if (opts.all) opts.chapters = [...ALL_CHAPTERS];
  if (!opts.chapters.length) opts.chapters = ['59', '81'];
  return opts;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchText(url, { retries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/json,text/plain,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (i < retries) await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

function readFixture(chapter) {
  const path = join(FIXTURE_DIR, `chapter-${chapter}.html`);
  if (!existsSync(path)) throw new Error(`Missing fixture: ${path}`);
  return readFileSync(path, 'utf8');
}

function extractSpecsFromCells(cells, name) {
  const specs = {};
  const rating = cells.find(t => /en\s*\d|solas|iso|pn\d|vde/i.test(t));
  const size = cells.find(t => /\d+\s*(mm|dn|l|kg|g\b)/i.test(t));
  const material = cells.find(t => /steel|bronze|iron|abs|hdpe|epoxy|stainless|polyester|copper/i.test(t));
  if (rating) specs.Rating = rating;
  if (size) specs.Size = size;
  if (material) specs.Material = material;
  if (!Object.keys(specs).length && name) specs.Description = name;
  return specs;
}

function rowToCompact(code, name, unit, chapter, plate, specs) {
  const c = String(code).replace(/\D/g, '').padStart(6, '0');
  return {
    c,
    n: String(name || '').trim(),
    u: normalizeUnit(unit),
    g: String(chapter || c.slice(0, 2)),
    p: plate || derivePlateId(c),
    specs: specs || {},
  };
}

/** Parse JSON catalog payloads (array or wrapped) */
export function parseJsonCatalog(text, chapter) {
  const data = JSON.parse(text);
  const rows = Array.isArray(data) ? data : (data.items || data.records || data.data || []);
  const out = [];
  for (const row of rows) {
    const code = row.c || row.code || row.impa_code || row.impa;
    const name = row.n || row.name || row.description || row.desc;
    const unit = row.u || row.unit || row.uom || 'PCS';
    if (!isValidImpaCode(code)) continue;
    const g = String(row.g || chapter || String(code).slice(0, 2));
    out.push(rowToCompact(code, name, unit, g, row.p || row.plate_id, row.specs || {}));
  }
  return out;
}

/** Parse HTML marine store catalog tables */
export function parseHtmlCatalog(html, chapter) {
  const items = [];
  const seen = new Set();

  // Strategy 1: data-impa-code / data-impa attributes on <tr>
  const trRe = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    const attrs = trMatch[1];
    const inner = trMatch[2];
    const codeAttr = attrs.match(/data-impa(?:-code)?=["'](\d{6})["']/i);
    const cells = [...inner.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    let code = codeAttr?.[1];
    if (!code) {
      const codeCell = cells.find(t => /^\d{6}$/.test(t));
      if (codeCell) code = codeCell;
    }
    if (!isValidImpaCode(code) || seen.has(code)) continue;
    const name = cells.find(t => t !== code && t.length > 3 && !/^(PCS|SET|MTR|LTR|KG|PR|COIL)$/i.test(t)) || cells[1] || '';
    const unit = cells.find(t => /^(PCS|SET|MTR|LTR|KG|PR|COIL|ROLL|CAN|DRUM)$/i.test(t)) || 'PCS';
    const specs = extractSpecsFromCells(cells, name);
    items.push(rowToCompact(code, name, unit, chapter, derivePlateId(code), specs));
    seen.add(code);
  }

  // Strategy 2: loose 6-digit codes in table rows
  if (!items.length) {
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = rowRe.exec(html)) !== null) {
      const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(x => x[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const code = cells.find(t => /^\d{6}$/.test(t));
      if (!code || seen.has(code)) continue;
      const name = cells.find(t => t !== code && !/^(PCS|SET|MTR|LTR|KG)$/i.test(t)) || '';
      const unit = cells.find(t => /^(PCS|SET|MTR|LTR|KG|PR|COIL)$/i.test(t)) || 'PCS';
      items.push(rowToCompact(code, name, unit, chapter, derivePlateId(code), extractSpecsFromCells(cells, name)));
      seen.add(code);
    }
  }

  return items;
}

async function scrapeChapter(chapter, opts) {
  const meta = CHAPTER_META[chapter];
  if (!meta) throw new Error(`Unknown chapter: ${chapter}`);

  let body;
  let source = 'fixtures';

  if (opts.live) {
    const base = (process.env.IMPA_SCRAPER_BASE_URL || '').replace(/\/+$/, '');
    if (!base) throw new Error('--live requires IMPA_SCRAPER_BASE_URL');
    const url = `${base}/chapter/${chapter}`;
    body = await fetchText(url);
    source = url;
  } else {
    body = readFixture(chapter);
    source = `fixture:chapter-${chapter}.html`;
  }

  let items;
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    items = parseJsonCatalog(body, chapter);
  } else {
    items = parseHtmlCatalog(body, chapter);
  }

  items = items.filter(it => it.g === chapter || it.c.startsWith(chapter));
  if (!items.length) throw new Error(`No items extracted for chapter ${chapter} from ${source}`);

  return {
    chapter,
    title: meta.title,
    category: meta.category,
    scraped_at: new Date().toISOString(),
    source,
    count: items.length,
    items,
  };
}

function writeChapterFile(payload) {
  const path = join(OUT_DIR, `impa-${payload.chapter}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return path;
}

function mergeChapters(chapterPayloads) {
  const byCode = new Map();
  for (const ch of chapterPayloads) {
    for (const item of ch.items) {
      if (!byCode.has(item.c)) byCode.set(item.c, item);
    }
  }
  const items = [...byCode.values()].sort((a, b) => a.c.localeCompare(b.c));
  return {
    generated_at: new Date().toISOString(),
    chapters: chapterPayloads.map(c => c.chapter),
    count: items.length,
    items,
  };
}

function mergeExistingChapterFiles() {
  if (!existsSync(OUT_DIR)) return [];
  const payloads = [];
  for (const file of readdirSync(OUT_DIR)) {
    const m = /^impa-(\d{2})\.json$/.exec(file);
    if (!m) continue;
    try {
      payloads.push(JSON.parse(readFileSync(join(OUT_DIR, file), 'utf8')));
    } catch { /* skip */ }
  }
  return payloads;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`IMPA chapter scraper — chapters: ${opts.chapters.join(', ')} (${opts.live ? 'live' : 'fixtures'})`);

  const scraped = [];
  for (let i = 0; i < opts.chapters.length; i++) {
    const ch = opts.chapters[i];
    const payload = await scrapeChapter(ch, opts);
    const path = writeChapterFile(payload);
    console.log(`  OK ch ${ch}: ${payload.count} items → ${path.replace(ROOT + '/', '')}`);
    scraped.push(payload);
    if (i < opts.chapters.length - 1) await sleep(opts.delay);
  }

  const allPayloads = mergeExistingChapterFiles();
  const merged = mergeChapters(allPayloads.length ? allPayloads : scraped);
  writeFileSync(MERGED_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log(`Merged ${merged.count} items → ${MERGED_PATH.replace(ROOT + '/', '')}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
