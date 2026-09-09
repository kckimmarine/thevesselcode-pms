#!/usr/bin/env node
/**
 * Vercel production build — copy static web assets into dist/.
 * Serverless routes stay in api/ at repo root (not copied here).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const out = join(root, 'dist');

const STATIC_PATHS = [
  'index.html',
  'home',
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

const publicDir = join(root, 'public');
for (const file of ['robots.txt', 'sitemap.xml']) {
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

console.log('\nVercel static build complete → dist/');
