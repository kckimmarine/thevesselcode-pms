#!/usr/bin/env node
/**
 * Berth Marine catalog scraper — extract IMPA metadata + plate images by category.
 *
 * Usage:
 *   node scripts/scrape-berthmarine.mjs --category=11-welfare-items
 *   node scripts/scrape-berthmarine.mjs --category=11-welfare-items --limit=5 --dry-run
 *   node scripts/scrape-berthmarine.mjs --codes=150821,232435,232448
 *
 * Output:
 *   public/data/berth-import-{category}.json
 *   public/data/plates/berth-{plateKey}.webp  (unique plate images only)
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASE = 'https://www.berthmarine.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 TVC-Berth-Scraper/1.0';
const DEFAULT_DELAY_MS = 500;

function parseArgs(argv) {
  const opts = {
    category: '',
    codes: [],
    limit: 0,
    dryRun: false,
    delay: Number(process.env.BERTH_SCRAPER_DELAY_MS) || DEFAULT_DELAY_MS,
    skipDownload: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--category=')) opts.category = arg.slice('--category='.length).trim();
    else if (arg.startsWith('--codes=')) {
      opts.codes = arg.slice('--codes='.length).split(',').map(s => s.trim().replace(/\D/g, '')).filter(Boolean);
    }
    else if (arg.startsWith('--limit=')) opts.limit = Math.max(0, Number(arg.slice('--limit='.length)) || 0);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--skip-download') opts.skipDownload = true;
    else if (arg.startsWith('--delay=')) opts.delay = Math.max(200, Number(arg.slice('--delay='.length)) || DEFAULT_DELAY_MS);
  }
  if (!opts.category && !opts.codes.length) {
    console.error('Usage: node scripts/scrape-berthmarine.mjs --category=11-welfare-items OR --codes=150821,232435');
    process.exit(1);
  }
  return opts;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
      if (res.status === 429) {
        const wait = 2000 * (i + 1);
        console.warn(`RATE LIMIT ${url} — waiting ${wait}ms`);
        await sleep(wait);
        throw new Error(`HTTP 429 for ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (i < retries) await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

function absUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

function plateKeyFromImageUrl(imageUrl) {
  const file = basename(imageUrl.split('?')[0] || '');
  const stem = file.replace(/\.(jpg|jpeg|png|webp)$/i, '');
  return stem || 'unknown';
}

function parseCategoryName(html) {
  const m = html.match(/<title>([^<|]+)/i);
  if (!m) return '';
  return decodeHtml(m[1].replace(/\s*-\s*Berth.*$/i, ''));
}

function parseNextPageUrl(html) {
  const m = html.match(/<link[^>]+rel=["']next["'][^>]+href=["']([^"']+)["']/i);
  return m ? absUrl(m[1]) : '';
}

function parseListingCards(html) {
  const cards = [];
  const re = /<a href="(https:\/\/www\.berthmarine\.com\/product\/impa-code-(\d{6})\/)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) !== null) {
    const impa_code = m[2];
    if (seen.has(impa_code)) continue;
    seen.add(impa_code);
    const image_url = absUrl(m[3].replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp))/i, ''));
    if (/logo|cropped-1/i.test(image_url)) continue;
    cards.push({
      impa_code,
      product_url: m[1],
      image_url,
      plate_key: plateKeyFromImageUrl(image_url),
    });
  }
  return cards;
}

function parseProductDetail(html, fallback) {
  const impa_code = fallback.impa_code;
  let item_name = '';
  const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (meta) {
    const desc = decodeHtml(meta[1]);
    const nameMatch = desc.match(new RegExp(`${impa_code}\\s*[–-]\\s*(.+?)\\s+Professional`, 'i'));
    if (nameMatch) item_name = decodeHtml(nameMatch[1]);
  }
  if (!item_name) {
    const pMatch = html.match(/<div class="product-short-description"[^>]*>[\s\S]*?<p>([^<]+)<\/p>/i)
      || html.match(/<p>\s*([A-Z0-9][^<]{3,120})\s*(?:&#8211;|–|-)\s*PC\s*<\/p>/i);
    if (pMatch) item_name = decodeHtml(pMatch[1]);
  }

  let image_url = fallback.image_url;
  const ld = html.match(/"thumbnailUrl":"(https:\\\/\\\/www\.berthmarine\.com\\\/wp-content\\\/uploads\\\/[^"]+)"/i);
  if (ld) {
    image_url = ld[1].replace(/\\\//g, '/');
  } else {
    const img = html.match(new RegExp(`wp-content/uploads/[^"'\\s]+/${impa_code}\\.jpg`, 'i'));
    if (img) image_url = absUrl(img[0]);
  }

  let category = fallback.category || '';
  const cat = html.match(/Category:\s*<a[^>]+>([^<]+)<\/a>/i)
    || html.match(/product-category\/[^/]+\/">([^<]+)<\/a><\/nav>/i);
  if (cat) category = decodeHtml(cat[1]);

  return {
    impa_code,
    item_name: item_name || `IMPA ${impa_code}`,
    image_url,
    plate_key: plateKeyFromImageUrl(image_url),
    category,
    product_url: fallback.product_url,
  };
}

async function collectCategoryProducts(categorySlug, { limit, delay }) {
  const listing = [];
  let url = `${BASE}/product-category/${categorySlug}/`;
  let categoryName = '';

  const unique = new Map();
  while (url) {
    console.log('FETCH listing', url);
    const html = await fetchText(url);
    if (!categoryName) categoryName = parseCategoryName(html);
    for (const card of parseListingCards(html)) {
      if (!unique.has(card.impa_code)) unique.set(card.impa_code, card);
    }
    if (limit > 0 && unique.size >= limit) break;
    const next = parseNextPageUrl(html);
    url = next && next !== url ? next : '';
    if (url) await sleep(delay);
  }

  let cards = [...unique.values()].sort((a, b) => a.impa_code.localeCompare(b.impa_code));
  if (limit > 0) cards = cards.slice(0, limit);

  const items = [];
  for (const card of cards) {
    await sleep(delay);
    console.log('FETCH product', card.impa_code);
    try {
      const html = await fetchText(card.product_url);
      items.push(parseProductDetail(html, { ...card, category: categoryName }));
    } catch (err) {
      console.warn('WARN detail failed', card.impa_code, err.message);
      items.push({
        impa_code: card.impa_code,
        item_name: `IMPA ${card.impa_code}`,
        image_url: card.image_url,
        plate_key: card.plate_key,
        category: categoryName,
        product_url: card.product_url,
        error: err.message,
      });
    }
  }

  return { categoryName, items };
}

function groupPlates(items) {
  const plates = new Map();
  for (const item of items) {
    const key = item.plate_key || plateKeyFromImageUrl(item.image_url);
    if (!plates.has(key)) {
      plates.set(key, {
        plate_key: key,
        image_url: item.image_url,
        impa_codes: [],
        local_webp: `public/data/plates/berth-${key}.webp`,
      });
    }
    plates.get(key).impa_codes.push(item.impa_code);
  }
  return [...plates.values()];
}

async function downloadPlateWebp(plate, outDir, dryRun) {
  const outPath = join(ROOT, plate.local_webp);
  if (existsSync(outPath)) {
    console.log('SKIP existing', plate.local_webp);
    return outPath;
  }
  if (dryRun) {
    console.log('DRY-RUN download', plate.image_url, '→', plate.local_webp);
    return outPath;
  }
  mkdirSync(outDir, { recursive: true });
  const res = await fetch(plate.image_url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for image ${plate.image_url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await sharp(buf)
    .resize({ width: 1400, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath);
  console.log('OK plate', plate.local_webp, `(${plate.impa_codes.length} codes)`);
  return outPath;
}

async function collectCodeProducts(codes, { delay }) {
  const items = [];
  for (const raw of codes) {
    const impa_code = String(raw).replace(/\D/g, '').padStart(6, '0');
    const product_url = `${BASE}/product/impa-code-${impa_code}/`;
    await sleep(delay);
    console.log('FETCH product', impa_code);
    try {
      const html = await fetchText(product_url);
      const imageGuess = `${BASE}/wp-content/uploads/2022/05/${impa_code}.jpg`;
      items.push(parseProductDetail(html, {
        impa_code,
        product_url,
        image_url: imageGuess,
        plate_key: impa_code,
        category: '',
      }));
    } catch (err) {
      console.warn('WARN skip', impa_code, err.message);
      items.push({
        impa_code,
        item_name: `IMPA ${impa_code}`,
        product_url,
        error: err.message,
        skipped: true,
      });
    }
  }
  return { categoryName: 'IMPA code list', items };
}

function mergeBerthIndex(items) {
  const indexPath = join(ROOT, 'public/data/berth-impa-index.json');
  let payload = { updated_at: '', codes: {} };
  if (existsSync(indexPath)) {
    try {
      payload = JSON.parse(readFileSync(indexPath, 'utf8'));
      if (!payload.codes) payload.codes = {};
    } catch { /* rebuild */ }
  }
  for (const item of items) {
    if (item.skipped || !item.plate_key) continue;
    const webp = join(ROOT, 'public/data/plates', `berth-${item.plate_key}.webp`);
    if (existsSync(webp)) {
      payload.codes[item.impa_code] = `berth-${item.plate_key}`;
    }
  }
  payload.updated_at = new Date().toISOString();
  if (!existsSync(dirname(indexPath))) mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, JSON.stringify(payload, null, 2));
  console.log('WROTE', indexPath, `(${Object.keys(payload.codes).length} codes)`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const slug = opts.category || `codes-${opts.codes.slice(0, 3).join('-')}`;
  const outJson = join(ROOT, 'public/data', `berth-import-${slug}.json`);
  const platesDir = join(ROOT, 'public/data/plates');

  const { categoryName, items } = opts.codes.length
    ? await collectCodeProducts(opts.codes, opts)
    : await collectCategoryProducts(opts.category, opts);
  const plates = groupPlates(items.filter(i => !i.skipped && i.image_url));

  const payload = {
    source: 'berthmarine.com',
    category_slug: opts.category || 'by-codes',
    impa_codes: opts.codes.length ? opts.codes : undefined,
    category_name: categoryName,
    scraped_at: new Date().toISOString(),
    item_count: items.length,
    unique_plates: plates.length,
    items,
    plates,
  };

  mkdirSync(dirname(outJson), { recursive: true });
  if (!opts.dryRun) {
    writeFileSync(outJson, JSON.stringify(payload, null, 2));
    console.log('WROTE', outJson);
  } else {
    console.log('DRY-RUN would write', outJson, `(${items.length} items, ${plates.length} plates)`);
  }

  if (!opts.skipDownload) {
    for (const plate of plates) {
      try {
        await downloadPlateWebp(plate, platesDir, opts.dryRun);
        await sleep(opts.delay);
      } catch (err) {
        console.warn('WARN plate download failed', plate.plate_key, err.message);
        plate.download_error = err.message;
      }
    }
  }

  mergeBerthIndex(items.filter(i => !i.skipped));

  console.log(`\nBerth Marine scrape complete — ${items.length} items, ${plates.length} unique plates.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
