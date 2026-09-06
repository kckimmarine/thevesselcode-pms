#!/usr/bin/env node
/**
 * Deploy bluehost/* embed pages to public_html (FTP).
 * Credentials (set once): deploy/.env.deploy.local or environment variables.
 *
 *   npm run deploy:bluehost
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_ROOT = join(ROOT, 'bluehost');
const REMOTE_ROOT = 'public_html';

function loadEnvFile() {
  const env = {};
  const path = join(ROOT, 'deploy/.env.deploy.local');
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

function resolveCred(env, fileEnv, names) {
  for (const name of names) {
    const val = process.env[name] || fileEnv[name];
    if (val) return { name, val };
  }
  return { name: names[0], val: '' };
}

async function uploadFile({ host, user, pass, localPath, remotePath }) {
  const url = `ftp://${host}/${remotePath}`;
  const baseArgs = ['--silent', '--show-error', '--fail', '-T', localPath, '--user', `${user}:${pass}`];
  try {
    await execFileAsync('curl', [...baseArgs, '--ssl-reqd', '-k', url]);
  } catch (err) {
    await execFileAsync('curl', [...baseArgs, url]);
  }
}

async function main() {
  const fileEnv = loadEnvFile();
  const host = resolveCred(process.env, fileEnv, ['TVC_FTP_HOST', 'BLUEHOST_FTP_HOST']).val;
  const user = resolveCred(process.env, fileEnv, ['TVC_FTP_USER', 'BLUEHOST_FTP_USER']).val;
  const pass = resolveCred(process.env, fileEnv, ['TVC_FTP_PASS', 'BLUEHOST_FTP_PASS']).val;

  if (!host || !user || !pass) {
    console.error('Bluehost FTP credentials not configured.');
    console.error('Add to deploy/.env.deploy.local (one time):');
    console.error('  TVC_FTP_HOST=your_ftp_server_hostname');
    console.error('  TVC_FTP_USER=your_ftp_username_with_domain');
    console.error('  TVC_FTP_PASS=your_ftp_password');
    console.error('\nOr add TVC_FTP_* (preferred) or BLUEHOST_FTP_* to Cursor Environment secrets.');
    process.exit(1);
  }

  if (!user.includes('@')) {
    console.warn('Warning: FTP user has no @ — use the cPanel Full Username (login@domain), not the main cPanel login.');
  }

  if (!existsSync(LOCAL_ROOT)) {
    console.error('Missing', LOCAL_ROOT);
    process.exit(1);
  }

  const files = listFiles(LOCAL_ROOT);
  if (!files.length) {
    console.error('No files under bluehost/');
    process.exit(1);
  }

  console.log(`Deploying ${files.length} file(s) to ${host}/${REMOTE_ROOT} ...`);
  for (const rel of files) {
    const localPath = join(LOCAL_ROOT, rel);
    const remotePath = `${REMOTE_ROOT}/${rel}`;
    await uploadFile({ host, user, pass, localPath, remotePath });
    console.log('  OK', remotePath);
  }
  console.log('\nDone. Check: https://thevesselcode.com/toolkit/');
}

main().catch(err => {
  console.error(err.stderr || err.message || err);
  process.exit(1);
});
