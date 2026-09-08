#!/usr/bin/env node
/**
 * Vercel production build — copy static web assets into dist/.
 * Serverless routes stay in api/ at repo root (not copied here).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const out = join(root, 'dist');

const STATIC_PATHS = [
  'index.html',
  'toolkit.html',
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

console.log('\nVercel static build complete → dist/');
