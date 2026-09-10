#!/usr/bin/env node
/**
 * GSC readiness check — internal linking hub + www canonical enforcement.
 * Run: node scripts/verify-seo-gsc-ready.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const require = createRequire(import.meta.url);

const HUB_CODES = [
    '812101', '812105', '812204', '812312', '812851',
    '590101', '590203', '590705', '591211', '591720',
    '791201', '791301',
];
const CANONICAL_ORIGIN = 'https://www.thevesselcode.com';

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(ok ? 'OK' : 'FAIL', name, detail ? `— ${detail}` : '');
}

const home = readFileSync(join(root, 'home', 'index.html'), 'utf8');
check('home footer store anchor', home.includes('<a href="/store/812101">Marine Store Spec Index (IMPA 812101)</a>'));

const impaSeo = require('../api/_lib/impaSeo.js');
check('default seo origin is www', impaSeo.storeSeoOrigin() === CANONICAL_ORIGIN);

const sample = impaSeo.getItemByCode('812101');
const html = impaSeo.buildStoreItemHtml(sample);
check('canonical uses www', html.includes(`<link rel="canonical" href="${CANONICAL_ORIGIN}/store/812101">`));
check('og:url uses www', html.includes(`<meta property="og:url" content="${CANONICAL_ORIGIN}/store/812101">`));

HUB_CODES.forEach((code) => {
    const item = impaSeo.getItemByCode(code);
    check(`hub code indexed ${code}`, !!item?.name, item?.name || 'missing');
});

const failed = results.filter((r) => !r.ok);
if (failed.length) {
    console.error('\nGSC readiness checks FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
}
console.log('\nGSC readiness checks passed.');
