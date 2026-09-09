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
check('html has title', html.includes(`IMPA ${sampleCode}`));
check('html has canonical', html.includes(`/store/${sampleCode}`));
check('html has toolkit link', html.includes('toolkit?impa='));
check('html has json-ld', html.includes('application/ld+json'));

const sitemap = readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8');
check('sitemap index exists', sitemap.includes('<sitemapindex'));
check('sitemap references store chunk', sitemap.includes('sitemap-store-1.xml'));

const chunk = readFileSync(join(root, 'public', 'sitemap-store-1.xml'), 'utf8');
const urlCount = (chunk.match(/<loc>/g) || []).length;
check('chunk url count matches index', urlCount === index.count, `${urlCount} urls`);

const robots = readFileSync(join(root, 'public', 'robots.txt'), 'utf8');
check('robots references sitemap', robots.includes('Sitemap:'));

const failed = results.filter((r) => !r.ok);
if (failed.length) {
    console.error('\nStore SEO tests FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
}
console.log('\nStore SEO tests passed.');
