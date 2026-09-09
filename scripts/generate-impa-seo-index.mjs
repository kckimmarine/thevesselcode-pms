#!/usr/bin/env node
/**
 * Build compact IMPA code lookup map for serverless SEO pages.
 * Output: api/_data/impa-seo-index.json (+ public/data copy for local tooling)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const sources = [
    join(root, 'public', 'data', 'impa-full.json'),
    join(root, 'data', 'impa-full.json'),
];
const sourcePath = sources.find((p) => existsSync(p));
if (!sourcePath) {
    console.error('MISSING impa-full.json — run merge-impa-chapters first');
    process.exit(1);
}

const bundle = JSON.parse(readFileSync(sourcePath, 'utf8'));
const items = Array.isArray(bundle.items) ? bundle.items : [];
const map = {};

for (const raw of items) {
    const code = String(raw?.c || raw?.impa_code || raw?.code || '').trim();
    if (!/^\d{4,6}$/.test(code)) continue;
    const normalized = code.padStart(6, '0').slice(-6);
    const entry = {
        n: String(raw.n || raw.name || '').trim(),
        u: String(raw.u || raw.unit || 'PCS').trim() || 'PCS',
        g: String(raw.g || normalized.slice(0, 2) || '').trim(),
        p: String(raw.p || raw.plate_id || raw.plate_no || '').trim(),
    };
    if (raw.category) entry.category = String(raw.category).trim();
    if (raw.specs && typeof raw.specs === 'object') entry.specs = raw.specs;
    map[normalized] = entry;
}

const payload = {
    generated_at: new Date().toISOString(),
    source: sourcePath.replace(`${root}/`, ''),
    count: Object.keys(map).length,
    items: map,
};

const targets = [
    join(root, 'api', '_data', 'impa-seo-index.json'),
    join(root, 'public', 'data', 'impa-seo-index.json'),
];

for (const target of targets) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(payload));
    console.log('OK', target.replace(`${root}/`, ''), `(${payload.count} codes)`);
}
