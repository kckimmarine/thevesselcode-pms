#!/usr/bin/env node
/**
 * Mirror public/assets → assets for local `npm start` (serve repo root).
 * Production build copies the same tree into dist/assets.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(ROOT, 'public', 'assets');
const dest = join(ROOT, 'assets');

if (!existsSync(src)) {
    console.warn('sync-public-assets: public/assets missing, skipping');
    process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log('OK public/assets → assets/');
