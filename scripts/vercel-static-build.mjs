#!/usr/bin/env node
/**
 * Vercel production build — copy static web assets into dist/.
 * Serverless routes stay in api/ at repo root (not copied here).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const out = join(root, 'dist');

const STATIC_PATHS = [
  'home',
  'services',
  'sm',
  'contact-us',
  'toolkit.html',
  'about-contact',
  'store-public.html',
  'gemini-handoff.html',
  'manifest.json',
  'service-worker.js',
  'css',
  'js',
  'vendor',
  'icons',
  'data',
  'admin',
  'downloads',
];

const smoke = spawnSync('node', ['scripts/smoke-web-demo.mjs'], { cwd: root, stdio: 'inherit' });
if (smoke.status !== 0) process.exit(smoke.status ?? 1);

spawnSync('node', ['scripts/merge-impa-chapters.mjs'], { cwd: root, stdio: 'inherit' });

const seoIndex = spawnSync('node', ['scripts/generate-impa-seo-index.mjs'], { cwd: root, stdio: 'inherit' });
if (seoIndex.status !== 0) process.exit(seoIndex.status ?? 1);

const sitemap = spawnSync('node', ['scripts/generate-sitemap.mjs'], { cwd: root, stdio: 'inherit' });
if (sitemap.status !== 0) process.exit(sitemap.status ?? 1);

const shouldPingSitemaps = process.env.PING_SITEMAPS === '1' || process.env.VERCEL === '1';
if (shouldPingSitemaps) {
  const ping = spawnSync('node', ['scripts/ping-sitemaps.mjs'], { cwd: root, stdio: 'inherit' });
  if (ping.status !== 0) {
    console.warn('WARN sitemap ping failed (non-fatal)');
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const rel of STATIC_PATHS) {
  const src = join(root, rel);
  if (!existsSync(src)) {
    console.error('MISSING static asset:', rel);
    process.exit(1);
  }
  cpSync(src, join(out, rel), { recursive: true });
  console.log('OK', rel);
}

const publicData = join(root, 'public', 'data');
if (existsSync(publicData)) {
  cpSync(publicData, join(out, 'data'), { recursive: true });
  console.log('OK public/data → data/');
}

const publicAssets = join(root, 'public', 'assets');
if (existsSync(publicAssets)) {
  cpSync(publicAssets, join(out, 'assets'), { recursive: true });
  console.log('OK public/assets → assets/');
}

const publicDir = join(root, 'public');
for (const file of ['robots.txt', 'sitemap.xml', 'sitemap-core.xml']) {
  const src = join(publicDir, file);
  if (existsSync(src)) {
    cpSync(src, join(out, file));
    console.log('OK public/', file, '→ dist/');
  }
}
if (existsSync(publicDir)) {
  for (const file of readdirSync(publicDir)) {
    if (/^sitemap-store-\d+\.xml$/.test(file)) {
      cpSync(join(publicDir, file), join(out, file));
      console.log('OK public/', file, '→ dist/');
    }
  }
}

// PMS SPA at /app.html — no dist/index.html so Vercel host rewrites apply at /
cpSync(join(root, 'index.html'), join(out, 'app.html'));
const pmsShell = readFileSync(join(out, 'app.html'), 'utf8');
if (!pmsShell.includes('TVC-PMS') && !pmsShell.includes('TVC_App')) {
  console.error('FAIL dist/app.html is not PMS shell');
  process.exit(1);
}
const marketingHome = readFileSync(join(out, 'home', 'index.html'), 'utf8');
if (!marketingHome.includes('marketing-shell.js')) {
  console.error('FAIL dist/home/index.html is not marketing home');
  process.exit(1);
}
if (existsSync(join(out, 'index.html'))) {
  console.error('FAIL dist/index.html must not exist (blocks Vercel host rewrites)');
  process.exit(1);
}
console.log('OK dist/app.html ← PMS shell');
console.log('OK dist/home/index.html ← marketing home (served via rewrite)');

console.log('\nVercel static build complete → dist/');
