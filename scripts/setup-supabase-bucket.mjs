#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'deploy', '.env.deploy.local');
const BUCKET = 'tvc-sync-packages';

function loadEnv() {
    const out = {};
    if (!existsSync(ENV_PATH)) throw new Error('Missing deploy/.env.deploy.local');
    for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 1) continue;
        out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
}

async function main() {
    const env = loadEnv();
    const base = env.SUPABASE_URL.replace(/\/+$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' };

    const list = await fetch(`${base}/storage/v1/bucket`, { headers });
    const buckets = list.ok ? await list.json() : [];
    if (Array.isArray(buckets) && buckets.some(b => (b.name || b.id) === BUCKET)) {
        console.log(`Bucket "${BUCKET}" already exists.`);
        return;
    }
    const create = await fetch(`${base}/storage/v1/bucket`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: BUCKET, public: false }),
    });
    const body = await create.text();
    if (!create.ok && create.status !== 409) throw new Error(`Bucket create ${create.status}: ${body}`);
    console.log(`Bucket "${BUCKET}" ready (private).`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
