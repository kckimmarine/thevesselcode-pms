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
// Main cPanel FTP accounts are chrooted to public_html (remote path = site root).
// Sub-accounts may need BLUEHOST_FTP_REMOTE_ROOT=public_html.

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

async function uploadFile({ host, user, pass, localPath, remotePath }) {
  const url = `ftp://${host}/${remotePath}`;
  const args = [
    '--silent', '--show-error', '--fail',
    '--ftp-pasv',
    '--disable-epsv',
    '--ftp-create-dirs',
    '--connect-timeout', '20',
    '--max-time', '120',
    '-T', localPath,
    '--user', `${user}:${pass}`,
    url,
  ];
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await execFileAsync('curl', args);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 5) await new Promise(r => setTimeout(r, attempt * 3000));
    }
  }
  throw lastErr;
}

async function main() {
  const fileEnv = loadEnvFile();
  const host = process.env.BLUEHOST_FTP_HOST || fileEnv.BLUEHOST_FTP_HOST;
  const user = process.env.BLUEHOST_FTP_USER || fileEnv.BLUEHOST_FTP_USER;
  const pass = process.env.BLUEHOST_FTP_PASS || fileEnv.BLUEHOST_FTP_PASS;
  const remoteRoot = (
    process.env.BLUEHOST_FTP_REMOTE_ROOT ||
    fileEnv.BLUEHOST_FTP_REMOTE_ROOT ||
    ''
  ).replace(/\/+$/, '');

  if (!host || !user || !pass) {
    console.error('Bluehost FTP credentials not configured.');
    console.error('Add to deploy/.env.deploy.local (one time):');
    console.error('  BLUEHOST_FTP_HOST=ftp.thevesselcode.com');
    console.error('  BLUEHOST_FTP_USER=your_cpanel_username');
    console.error('  BLUEHOST_FTP_PASS=your_cpanel_password');
    console.error('\nOr add the same keys to Cursor Environment secrets.');
    process.exit(1);
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

  const remotePrefix = remoteRoot ? `${remoteRoot}/` : '';
  console.log(`Deploying ${files.length} file(s) to ${host}/${remotePrefix || '(site root)'} ...`);
  for (const rel of files) {
    const localPath = join(LOCAL_ROOT, rel);
    const remotePath = posix.join(remoteRoot, rel);
    await uploadFile({ host, user, pass, localPath, remotePath });
    console.log('  OK', remotePath);
  }
  console.log('\nDone. Check: https://thevesselcode.com/toolkit/');
}

main().catch(err => {
  console.error(err.stderr || err.message || err);
  process.exit(1);
});
