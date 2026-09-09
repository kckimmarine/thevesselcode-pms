#!/usr/bin/env node
/**
 * Add thevesselcode.com + www to Vercel project via API.
 * Requires: VERCEL_TOKEN, VERCEL_PROJECT_ID in env or deploy/.env.deploy.local
 *
 * Usage: node scripts/setup-vercel-domains.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(ROOT, 'deploy', '.env.deploy.local');
const DOMAINS = ['thevesselcode.com', 'www.thevesselcode.com'];

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

async function vercelFetch(token, teamId, path, opts = {}) {
    const team = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    const url = `https://api.vercel.com${path}${path.includes('?') ? '&' : team || ''}${teamId && !path.includes('?') ? team : ''}`;
    const res = await fetch(url, {
        ...opts,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(opts.headers || {}),
        },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { res, data };
}

async function main() {
    const fileEnv = loadEnvFile();
    const token = pickEnv('VERCEL_TOKEN', fileEnv);
    const projectId = pickEnv('VERCEL_PROJECT_ID', fileEnv);
    const teamId = pickEnv('VERCEL_TEAM_ID', fileEnv);

    if (!token || !projectId) {
        console.error('Missing VERCEL_TOKEN or VERCEL_PROJECT_ID.');
        console.error('Add to deploy/.env.deploy.local or environment secrets, then re-run.');
        process.exit(1);
    }

    for (const domain of DOMAINS) {
        const { res, data } = await vercelFetch(token, teamId, `/v10/projects/${projectId}/domains`, {
            method: 'POST',
            body: JSON.stringify({ name: domain }),
        });
        if (res.ok) {
            console.log('OK added domain', domain);
            continue;
        }
        const msg = JSON.stringify(data);
        if (res.status === 409 || /already/i.test(msg)) {
            console.log('SKIP domain already exists', domain);
            continue;
        }
        console.error('FAIL', domain, res.status, msg.slice(0, 300));
        process.exit(1);
    }

    const { res, data } = await vercelFetch(token, teamId, `/v9/projects/${projectId}/domains`);
    if (!res.ok) {
        console.error('Could not list domains:', JSON.stringify(data).slice(0, 300));
        process.exit(1);
    }

    console.log('\nProject domains:');
    for (const row of data.domains || []) {
        console.log(`  ${row.name}\tverified=${row.verified}\t${row.verification?.length ? 'needs DNS' : ''}`);
    }
    console.log('\nBluehost DNS targets:');
    console.log('  A     @   76.76.21.21');
    console.log('  CNAME www cname.vercel-dns.com');
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
