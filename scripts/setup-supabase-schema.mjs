#!/usr/bin/env node
/** Apply pilot SQL via Supabase REST where possible + raw SQL over postgres if DATABASE_URL set. */
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'deploy', '.env.deploy.local');
const SQL_PATH = path.join(ROOT, 'deploy', 'supabase-sync-pilot-incheon-chemi.sql');

function loadEnv() {
    const out = {};
    for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 1) continue;
        out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
}

async function seedViaRest(env) {
    const base = env.SUPABASE_URL.replace(/\/+$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
    };

    async function upsert(table, rows) {
        const res = await fetch(`${base}/rest/v1/${table}`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify(rows),
        });
        if (!res.ok) {
            const t = await res.text();
            throw new Error(`${table} upsert failed ${res.status}: ${t}`);
        }
    }

    await upsert('companies', [{ id: 'DAEMYUNG', name: 'Daemyung Shipping' }]);
    await upsert('vessels', [{
        id: 'INCHEON CHEMI',
        company_id: 'DAEMYUNG',
        name: 'INCHEON CHEMI',
        imo_no: '9297711',
        delivery: '2003-09-18',
    }]);
    console.log('Seeded companies + vessels (INCHEON CHEMI only) via REST.');
}

async function main() {
    if (!existsSync(ENV_PATH)) throw new Error('Missing deploy/.env.deploy.local');
    const env = loadEnv();

    if (env.DATABASE_URL) {
        console.log('Running SQL file via supabase db query (statement by statement)...');
        const sql = readFileSync(SQL_PATH, 'utf8');
        const statements = sql
            .split(/;\s*\n/)
            .map(s => s.replace(/^\s*--[^\n]*\n?/gm, '').trim())
            .filter(s => s.length > 0 && !/^--/.test(s));
        for (let i = 0; i < statements.length; i++) {
            const q = statements[i].endsWith(';') ? statements[i] : `${statements[i]};`;
            const tmp = path.join(ROOT, 'deploy', '_tmp-run.sql');
            writeFileSync(tmp, q, 'utf8');
            const r = spawnSync('npx', ['supabase', 'db', 'query', '-f', tmp, '--db-url', env.DATABASE_URL], {
                cwd: ROOT, stdio: 'pipe', shell: true, encoding: 'utf8',
            });
            try { unlinkSync(tmp); } catch (_) {}
            if (r.status !== 0) {
                const err = (r.stderr || r.stdout || '').trim();
                throw new Error(`SQL statement ${i + 1} failed: ${err.slice(0, 500)}\n---\n${q.slice(0, 200)}`);
            }
        }
        console.log(`SQL applied (${statements.length} statements).`);
        return;
    }

    try {
        await seedViaRest(env);
        console.log('Note: sync_packages table still needs SQL (DATABASE_URL) or SQL Editor run once.');
        console.log(`Open: https://supabase.com/dashboard/project/wvgqzgiaajbxbamhvjgr/sql/new`);
        console.log(`Paste file: deploy/supabase-sync-pilot-incheon-chemi.sql`);
    } catch (e) {
        if (String(e.message).includes('does not exist') || String(e.message).includes('404')) {
            console.error('Tables not created yet. Need either:');
            console.error('  1) Add DATABASE_URL to deploy/.env.deploy.local (DB password from project create), or');
            console.error('  2) Run deploy/supabase-sync-pilot-incheon-chemi.sql in Supabase SQL Editor once.');
        }
        throw e;
    }
}

main().catch(e => { console.error(e.message); process.exit(1); });
