#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfgPath = join(root, 'portal/js/config.js');
let ok = true;

if (!existsSync(cfgPath)) {
  console.error('Missing portal/js/config.js');
  process.exit(1);
}

const cfg = readFileSync(cfgPath, 'utf8');
if (!/supabaseUrl:\s*['"][^'"]+['"]/.test(cfg) || cfg.includes("supabaseUrl: ''")) {
  console.warn('WARN: supabaseUrl not set in portal/js/config.js');
  ok = false;
}
if (!/supabaseAnonKey:\s*['"][^'"]+['"]/.test(cfg) || cfg.includes("supabaseAnonKey: ''")) {
  console.warn('WARN: supabaseAnonKey not set in portal/js/config.js');
  ok = false;
}

if (ok) console.log('OK: Supabase config appears set.');
else {
  console.log('Run: npm run setup:supabase');
  process.exit(1);
}
