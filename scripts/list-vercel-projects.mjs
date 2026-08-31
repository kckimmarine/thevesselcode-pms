#!/usr/bin/env node
/** List Vercel projects — helps fill VERCEL_PROJECT_ID in deploy/.env.deploy.local */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'deploy', '.env.deploy.local');

function loadToken() {
    if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN.trim();
    if (!existsSync(ENV_PATH)) {
        console.error('Set VERCEL_TOKEN env var or add to deploy/.env.deploy.local');
        process.exit(1);
    }
    for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
        if (line.startsWith('VERCEL_TOKEN=')) return line.slice('VERCEL_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
    }
    process.exit(1);
}

async function main() {
    const token = loadToken();
    const res = await fetch('https://api.vercel.com/v9/projects?limit=20', {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    console.log('Vercel projects:');
    for (const p of data.projects || []) {
        console.log(`  ${p.name}\t${p.id}`);
    }
}

main().catch(e => { console.error(e.message); process.exit(1); });
