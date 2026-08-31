#!/usr/bin/env node
/**
 * Apply deploy/supabase-sync-ingest.sql (Phase A tables + RLS).
 * Requires deploy/.env.deploy.local with DATABASE_URL (or run SQL in Supabase Editor).
 */
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'deploy', '.env.deploy.local');
const SQL_PATH = path.join(ROOT, 'deploy', 'supabase-sync-ingest.sql');

function loadEnv() {
    const out = {};
    if (!existsSync(ENV_PATH)) return out;
    for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 1) continue;
        out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
}

function splitStatements(sql) {
    return sql
        .split(/;\s*\n/)
        .map(s => s.replace(/^\s*--[^\n]*\n?/gm, '').trim())
        .filter(s => s.length > 0 && !/^--/.test(s));
}

async function main() {
    const env = loadEnv();
    if (!env.DATABASE_URL) {
        console.error('Missing DATABASE_URL in deploy/.env.deploy.local');
        console.error('Alternatively paste deploy/supabase-sync-ingest.sql into Supabase SQL Editor.');
        process.exit(1);
    }

    const sql = readFileSync(SQL_PATH, 'utf8');
    const statements = splitStatements(sql);
    console.log(`Applying ${statements.length} SQL statements from supabase-sync-ingest.sql ...`);

    for (let i = 0; i < statements.length; i++) {
        const q = statements[i].endsWith(';') ? statements[i] : `${statements[i]};`;
        const tmp = path.join(ROOT, 'deploy', '_tmp-ingest-run.sql');
        writeFileSync(tmp, q, 'utf8');
        const r = spawnSync('npx', ['supabase', 'db', 'query', '-f', tmp, '--db-url', env.DATABASE_URL], {
            cwd: ROOT, stdio: 'pipe', shell: true, encoding: 'utf8',
        });
        try { unlinkSync(tmp); } catch (_) {}
        if (r.status !== 0) {
            const err = (r.stderr || r.stdout || '').trim();
            throw new Error(`Statement ${i + 1}/${statements.length} failed: ${err.slice(0, 600)}\n---\n${q.slice(0, 300)}`);
        }
    }

    console.log('OK: sync_records, sync_vessel_meta, sync_package_ingest ready.');
    console.log('Next: npm run verify-sync-ingest');
}

main().catch(e => { console.error(e.message); process.exit(1); });
