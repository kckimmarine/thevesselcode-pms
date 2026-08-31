#!/usr/bin/env node
/**
 * One-shot online sync setup for pilot vessel TVC No1.
 * Reads deploy/.env.deploy.local (gitignored) and:
 *   1. Runs deploy/supabase-sync-pilot-tvc-no1.sql
 *   2. Creates Storage bucket tvc-sync-packages (private)
 *   3. Sets Vercel env vars + triggers redeploy
 *   4. Runs verify-online-sync-api.mjs
 *
 * Copy deploy/.env.deploy.local.example -> deploy/.env.deploy.local and fill in values.
 */
import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'deploy', '.env.deploy.local');
const SQL_PATH = path.join(ROOT, 'deploy', 'supabase-sync-pilot-tvc-no1.sql');
const PILOT_VESSEL = 'TVC No1';
const BUCKET = 'tvc-sync-packages';

function loadEnv(filePath) {
    if (!existsSync(filePath)) return {};
    const out = {};
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 1) continue;
        const key = t.slice(0, i).trim();
        let val = t.slice(i + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

function req(env, key) {
    const v = String(env[key] || '').trim();
    if (!v) throw new Error(`Missing ${key} in deploy/.env.deploy.local`);
    return v;
}

async function runSql(env) {
    const dbUrl = req(env, 'DATABASE_URL');
    console.log('\n[1/4] Running Supabase SQL (TVC No1 pilot only)...');
    const r = spawnSync('npx', ['supabase', 'db', 'query', '-f', SQL_PATH, '--db-url', dbUrl], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
    });
    if (r.status !== 0) throw new Error('SQL execution failed');
}

async function ensureBucket(env) {
    const base = req(env, 'SUPABASE_URL').replace(/\/+$/, '');
    const key = req(env, 'SUPABASE_SERVICE_ROLE_KEY');
    console.log('\n[2/4] Ensuring Storage bucket...');
    const headers = {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
    };
    const list = await fetch(`${base}/storage/v1/bucket`, { headers });
    if (!list.ok) throw new Error(`Storage list failed: ${list.status} ${await list.text()}`);
    const buckets = await list.json();
    if (Array.isArray(buckets) && buckets.some(b => b.name === BUCKET || b.id === BUCKET)) {
        console.log(`  Bucket "${BUCKET}" already exists.`);
        return;
    }
    const create = await fetch(`${base}/storage/v1/bucket`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: BUCKET, public: false }),
    });
    if (!create.ok && create.status !== 409) {
        throw new Error(`Bucket create failed: ${create.status} ${await create.text()}`);
    }
    console.log(`  Bucket "${BUCKET}" created (private).`);
}

async function vercelFetch(token, urlPath, opts = {}) {
    const res = await fetch(`https://api.vercel.com${urlPath}`, {
        ...opts,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(opts.headers || {}),
        },
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(`Vercel API ${res.status}: ${text}`);
    return json;
}

async function setVercelEnv(env) {
    const token = req(env, 'VERCEL_TOKEN');
    const projectId = req(env, 'VERCEL_PROJECT_ID');
    const teamId = String(env.VERCEL_TEAM_ID || '').trim();
    const teamQ = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    console.log('\n[3/4] Setting Vercel environment variables...');

    const vars = [
        { key: 'SUPABASE_URL', value: req(env, 'SUPABASE_URL') },
        { key: 'SUPABASE_SERVICE_ROLE_KEY', value: req(env, 'SUPABASE_SERVICE_ROLE_KEY') },
        { key: 'SYNC_PILOT_VESSEL_ID', value: env.SYNC_PILOT_VESSEL_ID || PILOT_VESSEL },
    ];

    const existing = await vercelFetch(token, `/v9/projects/${encodeURIComponent(projectId)}/env${teamQ}`);
    const rows = existing?.envs || existing?.environmentVariables || [];

    for (const v of vars) {
        const hit = rows.find(r => r.key === v.key && (r.target || []).includes('production'));
        if (hit) {
            await vercelFetch(token, `/v9/projects/${encodeURIComponent(projectId)}/env/${hit.id}${teamQ}`, {
                method: 'DELETE',
            }).catch(() => {});
        }
        await vercelFetch(token, `/v10/projects/${encodeURIComponent(projectId)}/env${teamQ}`, {
            method: 'POST',
            body: JSON.stringify({
                key: v.key,
                value: v.value,
                type: 'encrypted',
                target: ['production', 'preview'],
            }),
        });
        console.log(`  Set ${v.key}`);
    }

    console.log('  Triggering production redeploy...');
    await vercelFetch(token, `/v13/deployments${teamQ}`, {
        method: 'POST',
        body: JSON.stringify({
            name: projectId,
            project: projectId,
            target: 'production',
            gitSource: env.VERCEL_GIT_REPO
                ? {
                    type: 'github',
                    repo: env.VERCEL_GIT_REPO,
                    ref: env.VERCEL_GIT_REF || 'master',
                }
                : undefined,
        }),
    }).catch((e) => {
        console.warn(`  Redeploy via API skipped (${e.message}). Redeploy manually in Vercel dashboard.`);
    });
}

async function verify() {
    console.log('\n[4/4] Verifying API (may take ~1 min after redeploy)...');
    await new Promise(r => setTimeout(r, 15000));
    const r = spawnSync('node', ['scripts/verify-online-sync-api.mjs'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (r.status !== 0) {
        console.warn('Verify not passing yet — wait for Vercel redeploy, then run: npm run verify-online-sync');
    }
}

async function main() {
    if (!existsSync(ENV_PATH)) {
        console.error(`Missing ${ENV_PATH}`);
        console.error('Copy deploy/.env.deploy.local.example -> deploy/.env.deploy.local and fill in Supabase + Vercel values.');
        process.exit(1);
    }
    const env = loadEnv(ENV_PATH);
    console.log(`Online sync auto-setup — pilot vessel: ${env.SYNC_PILOT_VESSEL_ID || PILOT_VESSEL}`);
    await runSql(env);
    await ensureBucket(env);
    await setVercelEnv(env);
    await verify();
    console.log('\nDone.');
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
