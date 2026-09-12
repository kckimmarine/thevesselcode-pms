#!/usr/bin/env node
/**
 * Validate IMPA programmatic SEO artifacts and HTML renderer.
 * Run: node scripts/test-store-seo.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const require = createRequire(import.meta.url);

function run(label, cmd, args) {
    const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`${label} failed`);
    }
}

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(ok ? 'OK' : 'FAIL', name, detail ? `— ${detail}` : '');
}

run('merge', 'node', ['scripts/merge-impa-chapters.mjs']);
run('seo-index', 'node', ['scripts/generate-impa-seo-index.mjs']);
run('sitemap', 'node', ['scripts/generate-sitemap.mjs']);

const indexPath = join(root, 'api', '_data', 'impa-seo-index.json');
check('seo index exists', existsSync(indexPath));
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
check('seo index has items', index.count > 0, String(index.count));

const sampleCode = Object.keys(index.items).sort()[0];
const impaSeo = require('../api/_lib/impaSeo.js');
const item = impaSeo.getItemByCode(sampleCode);
check('lookup sample item', !!item?.name, sampleCode);

const html = impaSeo.buildStoreItemHtml(item, { origin: 'https://app.thevesselcode.com' });
check('html has title', html.includes('THE VESSEL CODE Maritime Catalog'));
check('html has canonical', html.includes(`/store/${sampleCode}`));
check('html has description meta', html.includes('maritime catalog plate illustration'));
check('html has og:image', html.includes('property="og:image"'));
check('html has spec table', html.includes('spec-table'));
check('html has toolkit link', html.includes('toolkit?impa='));
check('html has json-ld', html.includes('application/ld+json'));
check('html has saas hook', html.includes('Vessel ROB Tracking'));

const sitemap = readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8');
check('sitemap index exists', sitemap.includes('<sitemapindex'));
check('sitemap references core pages', sitemap.includes('sitemap-core.xml'));
check('sitemap references store chunk', sitemap.includes('sitemap-store-1.xml'));

let storeUrlCount = 0;
const chunk1 = readFileSync(join(root, 'public', 'sitemap-store-1.xml'), 'utf8');
storeUrlCount += (chunk1.match(/<loc>/g) || []).length;
const chunk2Path = join(root, 'public', 'sitemap-store-2.xml');
if (existsSync(chunk2Path)) {
    const chunk2 = readFileSync(chunk2Path, 'utf8');
    storeUrlCount += (chunk2.match(/<loc>/g) || []).length;
}
check('store sitemap url count matches index', storeUrlCount === index.count, `${storeUrlCount} urls`);

const robots = readFileSync(join(root, 'public', 'robots.txt'), 'utf8');
check('robots references sitemap', robots.includes('Sitemap:'));

const failed = results.filter((r) => !r.ok);
if (failed.length) {
    console.error('\nStore SEO tests FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
}
console.log('\nStore SEO tests passed.');
