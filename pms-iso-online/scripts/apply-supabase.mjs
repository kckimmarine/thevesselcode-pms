#!/usr/bin/env node
/**
 * Apply ISO Supabase schema + storage bucket (service role / DATABASE_URL).
 * Requires deploy/.env.local — see deploy/.env.example
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = {};
  const path = join(root, 'deploy/.env.local');
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

function env() {
  const file = loadEnv();
  return {
    url: process.env.SUPABASE_URL || file.SUPABASE_URL,
    anon: process.env.SUPABASE_ANON_KEY || file.SUPABASE_ANON_KEY,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || file.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: process.env.DATABASE_URL || file.DATABASE_URL,
  };
}

async function runSql(client, sql, label) {
  try {
    await client.query(sql);
    console.log('OK', label);
  } catch (err) {
    if (/already exists|duplicate/i.test(err.message)) {
      console.log('SKIP (exists)', label);
    } else {
      throw new Error(`${label}: ${err.message}`);
    }
  }
}

async function applySchema(pgClient) {
  const schema = readFileSync(join(root, 'deploy/supabase-schema.sql'), 'utf8');
  const storage = readFileSync(join(root, 'deploy/supabase-storage.sql'), 'utf8');
  await runSql(pgClient, schema, 'supabase-schema.sql');
  await runSql(pgClient, `INSERT INTO storage.buckets (id, name, public) VALUES ('iso-evidence', 'iso-evidence', false) ON CONFLICT (id) DO NOTHING;`, 'bucket iso-evidence');
  await runSql(pgClient, storage, 'supabase-storage.sql');
}

async function ensureBucket(sb) {
  const { data: buckets } = await sb.storage.listBuckets();
  if (buckets?.some((b) => b.id === 'iso-evidence')) {
    console.log('OK bucket iso-evidence (API)');
    return;
  }
  const { error } = await sb.storage.createBucket('iso-evidence', { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
  console.log('OK bucket iso-evidence (created)');
}

function writePortalConfig(url, anon) {
  const path = join(root, 'portal/js/config.js');
  const body = `/**
 * Online mode — Supabase (auto-written by npm run setup:apply)
 */
window.PMS_ISO_CONFIG = {
  supabaseUrl: '${url}',
  supabaseAnonKey: '${anon}',
  companyName: 'PERFECT MARINE SOLUTION',
  companyShort: 'PMS',
};

(function injectFromMeta() {
  const u = document.querySelector('meta[name="pms-iso-supabase-url"]');
  const k = document.querySelector('meta[name="pms-iso-supabase-anon-key"]');
  if (u?.content) window.PMS_ISO_CONFIG.supabaseUrl = u.content.trim();
  if (k?.content) window.PMS_ISO_CONFIG.supabaseAnonKey = k.content.trim();
})();
`;
  writeFileSync(path, body);
  console.log('OK portal/js/config.js');
}

async function ensureAdmin(sb, pgClient) {
  const email = process.env.PMS_ISO_ADMIN_EMAIL || loadEnv().PMS_ISO_ADMIN_EMAIL;
  const password = process.env.PMS_ISO_ADMIN_PASSWORD || loadEnv().PMS_ISO_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('SKIP admin user (set PMS_ISO_ADMIN_EMAIL + PMS_ISO_ADMIN_PASSWORD in deploy/.env.local)');
    return;
  }
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  let userId = created?.user?.id;
  if (createErr) {
    if (!/already|registered/i.test(createErr.message)) throw createErr;
    const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
    userId = list?.users?.find((u) => u.email === email)?.id;
    console.log('SKIP create user (exists)', email);
  } else {
    console.log('OK admin user', email);
  }
  if (!userId) throw new Error('Could not resolve admin user id');
  await pgClient.query(
    `INSERT INTO iso_profiles (id, display_name, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
    [userId, 'Quality Admin']
  );
  console.log('OK iso_profiles admin');
}

async function main() {
  const { url, anon, service, databaseUrl } = env();
  if (!databaseUrl) {
    console.error('Missing DATABASE_URL in deploy/.env.local');
    console.error('Supabase → Project Settings → Database → Connection string (URI)');
    process.exit(1);
  }
  if (!url || !anon || !service) {
    console.error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const pgClient = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await pgClient.connect();
  const sb = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    await applySchema(pgClient);
    await ensureBucket(sb);
    await ensureAdmin(sb, pgClient);
    writePortalConfig(url, anon);
    console.log('\nDone. Run: npm start → http://localhost:3010');
  } finally {
    await pgClient.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
