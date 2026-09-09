#!/usr/bin/env node
/**
 * Set STORE_SEO_ORIGIN on Vercel and trigger production redeploy.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(ROOT, 'deploy', '.env.deploy.local');
const STORE_ORIGIN = process.env.STORE_SEO_ORIGIN || 'https://thevesselcode.com';

function loadEnvFile() {
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

function pickEnv(key, fileEnv) {
    return String(process.env[key] || fileEnv[key] || '').trim();
}

async function vercelFetch(token, path, opts = {}) {
    const res = await fetch(`https://api.vercel.com${path}`, {
        ...opts,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(opts.headers || {}),
        },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Vercel ${res.status}: ${text.slice(0, 400)}`);
    try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function main() {
    const fileEnv = loadEnvFile();
    const token = pickEnv('VERCEL_TOKEN', fileEnv);
    const projectId = pickEnv('VERCEL_PROJECT_ID', fileEnv);
    if (!token || !projectId) {
        console.error('Missing VERCEL_TOKEN or VERCEL_PROJECT_ID');
        process.exit(1);
    }

    const existing = await vercelFetch(token, `/v9/projects/${encodeURIComponent(projectId)}/env`);
    const rows = existing?.envs || [];
    const hit = rows.find((r) => r.key === 'STORE_SEO_ORIGIN');
    if (hit?.id) {
        await vercelFetch(token, `/v9/projects/${encodeURIComponent(projectId)}/env/${hit.id}`, { method: 'DELETE' });
    }
    await vercelFetch(token, `/v10/projects/${encodeURIComponent(projectId)}/env`, {
        method: 'POST',
        body: JSON.stringify({
            key: 'STORE_SEO_ORIGIN',
            value: STORE_ORIGIN,
            type: 'plain',
            target: ['production', 'preview'],
        }),
    });
    console.log('OK STORE_SEO_ORIGIN =', STORE_ORIGIN);

    const gitRepo = pickEnv('VERCEL_GIT_REPO', fileEnv) || 'kckimmarine/thevesselcode-pms';
    const gitRef = pickEnv('VERCEL_GIT_REF', fileEnv) || 'master';
    await vercelFetch(token, '/v13/deployments', {
        method: 'POST',
        body: JSON.stringify({
            name: 'thevesselcode-pms',
            project: projectId,
            target: 'production',
            gitSource: { type: 'github', repo: gitRepo, ref: gitRef },
        }),
    });
    console.log('OK production redeploy triggered');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
