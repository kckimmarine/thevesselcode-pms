#!/usr/bin/env node
/**
 * Smoke test: marketing landing page assets
 * Run: node scripts/test-home-landing.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(ok ? 'OK' : 'FAIL', name, detail ? `— ${detail}` : '');
}

check('home/index.html exists', existsSync(join(ROOT, 'home/index.html')));
check('css/home.css exists', existsSync(join(ROOT, 'css/home.css')));

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
check('host-based root redirect', (vercel.redirects || []).some((r) => r.has?.some((h) => h.value === 'www.thevesselcode.com')));

const html = readFileSync(join(ROOT, 'home/index.html'), 'utf8');
check('hero slogan', html.includes('Decoding the Engineering, Operations, and Economics'));
check('services section', html.includes('id="services"'));
check('five service pillars', html.includes('Owner') && html.includes('Retrofit Project') && html.includes('Strategic Supply'));
check('toolkit link', html.includes('href="/toolkit"'));
check('pms link', html.includes('app.thevesselcode.com'));
check('contact link', html.includes('href="/contact"'));
check('nav services anchor', html.includes('href="#services"'));
check('canonical tag', html.includes('https://thevesselcode.com/'));
const redirects = vercel.redirects || [];
check('maritime-toolkit redirect', redirects.some((r) => r.source === '/maritime-toolkit/'));
check('contact redirect', redirects.some((r) => r.source === '/contact/'));
check('home rewrite', (vercel.rewrites || []).some((r) => r.destination === '/home/index.html'));

const failed = results.filter((r) => !r.ok);
if (failed.length) {
    console.error('\nHome landing tests FAILED');
    process.exit(1);
}
console.log('\nHome landing tests passed.');
