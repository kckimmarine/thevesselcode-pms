/**
 * Build lightweight plate webp assets for on-demand STORE modal loading.
 * Run: node scripts/build-plate-webp.mjs
 */
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const platesDir = join(root, 'data/plates');
const svgDir = join(root, 'data/impa-plates');

/** Optional photo sources for demo plates (downloaded once, stored as webp) */
const PHOTO_SOURCES = {
  'PL-33-01': 'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=1200&q=85',
  'PL-33-02': 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=85',
  'PL-33-03': 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=1200&q=85',
  'PL-33-04': 'https://images.unsplash.com/photo-1628177142898-93e36e4e3a50?w=1200&q=85',
  'PL-33-05': 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1200&q=85',
};

mkdirSync(platesDir, { recursive: true });

async function writeWebp(plateId, input) {
  const out = join(platesDir, `${plateId}.webp`);
  await sharp(input)
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(out);
  return out;
}

async function fromPhoto(plateId, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${plateId}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeWebp(plateId, buf);
}

async function fromSvg(plateId, svgPath) {
  await writeWebp(plateId, svgPath);
}

const ids = new Set();
if (existsSync(svgDir)) {
  for (const file of readdirSync(svgDir)) {
    if (!/^PL-\d{2}-\d{2}\.svg$/i.test(file)) continue;
    ids.add(basename(file, '.svg'));
  }
}
Object.keys(PHOTO_SOURCES).forEach(id => ids.add(id));

let built = 0;
for (const plateId of [...ids].sort()) {
  try {
    if (PHOTO_SOURCES[plateId]) {
      await fromPhoto(plateId, PHOTO_SOURCES[plateId]);
    } else {
      const svg = join(svgDir, `${plateId}.svg`);
      if (!existsSync(svg)) continue;
      await fromSvg(plateId, svg);
    }
    built += 1;
    console.log(`  ${plateId}.webp`);
  } catch (err) {
    console.warn(`  skip ${plateId}: ${err.message}`);
  }
}

console.log(`Built ${built} plate webp files in data/plates/`);
