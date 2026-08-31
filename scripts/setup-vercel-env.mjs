#!/usr/bin/env node
/** Set Vercel env vars + redeploy only (Supabase already configured). */
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'deploy', '.env.deploy.local');
const PILOT_VESSEL = 'TVC No1';

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
    if (!res.ok) throw new Error(`Vercel API ${res.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function main() {
    const env = loadEnv();
    const token = env.VERCEL_TOKEN;
    const projectId = env.VERCEL_PROJECT_ID;
    if (!token || !projectId) throw new Error('VERCEL_TOKEN and VERCEL_PROJECT_ID required');

    console.log('Setting Vercel environment variables...');
    const vars = [
        { key: 'SUPABASE_URL', value: env.SUPABASE_URL },
        { key: 'SUPABASE_SERVICE_ROLE_KEY', value: env.SUPABASE_SERVICE_ROLE_KEY },
        { key: 'SYNC_PILOT_VESSEL_ID', value: env.SYNC_PILOT_VESSEL_ID || PILOT_VESSEL },
    ];
    const existing = await vercelFetch(token, `/v9/projects/${encodeURIComponent(projectId)}/env`);
    const rows = existing?.envs || [];

    for (const v of vars) {
        if (!v.value) throw new Error(`Missing ${v.key} in .env.deploy.local`);
        const hit = rows.find(r => r.key === v.key);
        if (hit?.id) {
            await vercelFetch(token, `/v9/projects/${encodeURIComponent(projectId)}/env/${hit.id}`, { method: 'DELETE' }).catch(() => {});
        }
        await vercelFetch(token, `/v10/projects/${encodeURIComponent(projectId)}/env`, {
            method: 'POST',
            body: JSON.stringify({
                key: v.key,
                value: v.value,
                type: 'encrypted',
                target: ['production', 'preview'],
            }),
        });
        console.log(`  OK ${v.key}`);
    }

    console.log('Triggering redeploy...');
    try {
        await vercelFetch(token, '/v13/deployments', {
            method: 'POST',
            body: JSON.stringify({
                name: 'thevesselcode-pms',
                project: projectId,
                target: 'production',
                gitSource: {
                    type: 'github',
                    repo: env.VERCEL_GIT_REPO || 'kckimmarine/thevesselcode-pms',
                    ref: env.VERCEL_GIT_REF || 'master',
                },
            }),
        });
        console.log('  Redeploy started.');
    } catch (e) {
        console.warn(`  Redeploy API: ${e.message}`);
        console.warn('  Vercel Dashboard -> thevesselcode-pms -> Deployments -> Redeploy');
    }

    console.log('Waiting 45s for deploy...');
    await new Promise(r => setTimeout(r, 45000));
    spawnSync('node', ['scripts/verify-online-sync-api.mjs'], { cwd: ROOT, stdio: 'inherit', shell: true });
}

main().catch(e => { console.error(e.message); process.exit(1); });
