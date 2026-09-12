#!/usr/bin/env node
/**
 * Verify IMPA programmatic SEO pages and chunked sitemaps.
 * Run: node scripts/test-seo-sitemap.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const require = createRequire(import.meta.url);
const TEST_CODE = '812101';
const CANONICAL_ORIGIN = 'https://www.thevesselcode.com';
const HUB_CODES = [
    '812101', '812105', '812204', '812312', '812851',
    '590101', '590203', '590705', '590102', '590105',
    '791201', '791301',
];

function run(label, cmd, args) {
    const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${label} failed`);
}

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(ok ? 'OK' : 'FAIL', name, detail ? `— ${detail}` : '');
}

function assertValidXml(label, xml) {
    check(`${label} is well-formed xml`, xml.startsWith('<?xml'));
    check(`${label} has closing root`, /(<\/urlset>|<\/sitemapindex>)\s*$/.test(xml.trim()));
}

run('merge', 'node', ['scripts/merge-impa-chapters.mjs']);
run('seo-index', 'node', ['scripts/generate-impa-seo-index.mjs']);
run('sitemap', 'node', ['scripts/generate-sitemap.mjs']);

const impaSeo = require('../api/_lib/impaSeo.js');
const item = impaSeo.getItemByCode(TEST_CODE);
check(`${TEST_CODE} exists in seo index`, !!item?.name, item?.name || 'missing');

const html = impaSeo.buildStoreItemHtml(item);
check('default seo origin is www', impaSeo.storeSeoOrigin() === CANONICAL_ORIGIN);
const escName = item.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
check('html title format', html.includes(`<title>IMPA CODE ${TEST_CODE} - ${escName} | THE VESSEL CODE Maritime Catalog</title>`));
check('html h1 format', html.includes(`<h1 itemprop="name">IMPA CODE ${TEST_CODE} - ${escName}</h1>`));
check('html og:title format', html.includes(`<meta property="og:title" content="IMPA CODE ${TEST_CODE} - ${escName}">`));
check('html og:description plate copy', html.includes('maritime catalog plate illustration'));
check('html og:image plate url', html.includes('<meta property="og:image" content="https://www.thevesselcode.com/data/plates/'));
check('html json-ld mpn', html.includes('"mpn"'));
check('html json-ld marine category', html.includes('Marine Stores / Ship Equipment'));
check('html json-ld product', html.includes('"@type":"Product"') || html.includes('"@type": "Product"'));
check('html json-ld techarticle', html.includes('"@type":"TechArticle"') || html.includes('"@type": "TechArticle"'));
check('html canonical uses www', html.includes(`<link rel="canonical" href="${CANONICAL_ORIGIN}/store/${TEST_CODE}">`));
check('html og:url uses www', html.includes(`<meta property="og:url" content="${CANONICAL_ORIGIN}/store/${TEST_CODE}">`));
check('html meta description', html.includes('Technical specification, dimensions, unit, and maritime catalog plate illustration'));
check('html spec table', html.includes('<table class="spec-table">'));
check('html rating row', html.includes('<th scope="row">Rating</th>'));
check('html material row', html.includes('<th scope="row">Material</th>'));
check('html standard unit row', html.includes('<th scope="row">Standard Unit</th>'));
check('html toolkit cta', html.includes('Open Interactive Maritime Toolkit'));
check('html saas hook', html.includes('Vessel ROB Tracking &amp; 1-Click Requisition available on'));

const handler = require('../api/store/[code].js');
const mockRes = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
        this.headers[key.toLowerCase()] = value;
    },
    status(code) {
        this.statusCode = code;
        return this;
    },
    send(body) {
        this.body = body;
        return this;
    },
    end() {
        return this;
    },
};

await handler({ method: 'GET', query: { code: TEST_CODE } }, mockRes);
check('/store handler returns 200', mockRes.statusCode === 200, String(mockRes.statusCode));
check('/store handler html body', typeof mockRes.body === 'string' && mockRes.body.includes('spec-table'));

const notFoundRes = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
        this.headers[key.toLowerCase()] = value;
    },
    status(code) {
        this.statusCode = code;
        return this;
    },
    send(body) {
        this.body = body;
        return this;
    },
};
await handler({ method: 'GET', query: { code: '999999' } }, notFoundRes);
check('/store missing code returns 404', notFoundRes.statusCode === 404);
check('/store missing code has search link', String(notFoundRes.body).includes('Search catalog for IMPA'));

const sitemapIndex = readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8');
assertValidXml('sitemap.xml', sitemapIndex);
check('sitemap index references core pages', sitemapIndex.includes('sitemap-core.xml'));
check('sitemap index references store chunk', sitemapIndex.includes('sitemap-store-1.xml'));

const coreSitemap = readFileSync(join(root, 'public', 'sitemap-core.xml'), 'utf8');
assertValidXml('sitemap-core.xml', coreSitemap);
check('core sitemap has home', coreSitemap.includes('<loc>https://www.thevesselcode.com/</loc>'));
check('core sitemap has toolkit', coreSitemap.includes('<loc>https://www.thevesselcode.com/toolkit</loc>'));
check('core sitemap has contact-us', coreSitemap.includes('<loc>https://www.thevesselcode.com/contact-us</loc>'));

const storeChunk = readFileSync(join(root, 'public', 'sitemap-store-1.xml'), 'utf8');
assertValidXml('sitemap-store-1.xml', storeChunk);
check('store chunk includes test code', storeChunk.includes(`/store/${TEST_CODE}`));
check('store chunk uses www origin', storeChunk.includes('<loc>https://www.thevesselcode.com/store/'));
check('robots references www sitemap', readFileSync(join(root, 'public', 'robots.txt'), 'utf8').includes('Sitemap: https://www.thevesselcode.com/sitemap.xml'));
const robotsTxt = readFileSync(join(root, 'public', 'robots.txt'), 'utf8');
const storeChunks = (sitemapIndex.match(/sitemap-store-\d+\.xml/g) || []).filter((v, i, a) => a.indexOf(v) === i);
storeChunks.forEach((fileName) => {
  check(`robots allow ${fileName}`, robotsTxt.includes(`Allow: /${fileName}`));
  check(`robots sitemap ${fileName}`, robotsTxt.includes(`Sitemap: https://www.thevesselcode.com/${fileName}`));
});
check('robots references sitemap core', robotsTxt.includes('Sitemap: https://www.thevesselcode.com/sitemap-core.xml'));
check('robots sitemap count matches index', (robotsTxt.match(/^Sitemap: /gm) || []).length === storeChunks.length + 2);

const home = readFileSync(join(root, 'home', 'index.html'), 'utf8');
check('home popular impa section', home.includes('Popular Marine Stores'));
check('home links impa 232436', home.includes('href="/store/232436"'));
check('home links impa 812204', home.includes('href="/store/812204"'));

const toolkit = readFileSync(join(root, 'toolkit.html'), 'utf8');
check('toolkit popular impa section', toolkit.includes('Popular Marine Stores'));
check('toolkit canonical', toolkit.includes('rel="canonical" href="https://www.thevesselcode.com/toolkit"'));

HUB_CODES.forEach((code) => {
    const hubItem = impaSeo.getItemByCode(code);
    check(`hub code in seo index ${code}`, !!hubItem?.name, hubItem?.name || 'missing');
});

const failed = results.filter((r) => !r.ok);
if (failed.length) {
    console.error('\nSEO sitemap tests FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
}
console.log('\nSEO sitemap tests passed.');
