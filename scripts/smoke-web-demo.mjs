#!/usr/bin/env node
/** Smoke check — web demo files & demo accounts (no browser). */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const mustExist = [
  'index.html',
  'vercel.json',
  'js/config.js',
  'js/auth.js',
  'deploy/supabase-schema.sql',
  'downloads/.gitkeep',
  'data/pms-unified.json',
];

let ok = true;
for (const rel of mustExist) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    console.error('MISSING', rel);
    ok = false;
  } else {
    console.log('OK', rel);
  }
}

const auth = readFileSync(join(root, 'js/auth.js'), 'utf8');
for (const u of ['dm_user@thevesselcode.com', 'admin@thevesselcode.com']) {
  if (auth.includes(u)) console.log('OK account', u);
  else { console.error('MISSING account', u); ok = false; }
}

const bluehostEmbed = join(root, 'bluehost/pms/index.html');
if (existsSync(bluehostEmbed)) {
  console.log('OK bluehost/pms/index.html');
} else {
  console.error('MISSING bluehost/pms/index.html');
  ok = false;
}

if (readFileSync(join(root, 'js/config.js'), 'utf8').includes('isWebDeploy')) {
  console.log('OK web deploy config');
} else {
  console.error('MISSING isWebDeploy');
  ok = false;
}

console.log(ok ? '\nSmoke check passed.' : '\nSmoke check FAILED.');
process.exit(ok ? 0 : 1);
