#!/usr/bin/env node
/**
 * Verify Phase C cloud query API.
 * Usage: node scripts/verify-sync-cloud-api.mjs [baseUrl]
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'deploy', '.env.deploy.local');
const BASE = (process.argv[2] || process.env.SYNC_API_BASE_URL || 'https://app.thevesselcode.com').replace(/\/+$/, '');
const VESSEL = 'TVC No1';
const COMPANY = 'TVC';

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

function cloudHeaders(env, accountType) {
    const h = { 'X-Tvc-Account-Type': accountType };
    if (accountType === 'HQ') h['X-Tvc-Company-Id'] = COMPANY;
    const key = env.SYNC_CLOUD_READ_KEY || '';
    if (key) h['X-Tvc-Cloud-Read-Key'] = key;
    return h;
}

async function getJson(url, headers) {
    const res = await fetch(url, { headers });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

async function main() {
    const env = loadEnv();
    console.log(`Cloud query API — ${BASE}`);
    console.log(`Pilot: ${COMPANY} / ${VESSEL}\n`);

    const hqStatsUrl = `${BASE}/api/sync/cloud/stats?company_id=${encodeURIComponent(COMPANY)}&vessel_id=${encodeURIComponent(VESSEL)}`;
    const hqStats = await getJson(hqStatsUrl, cloudHeaders(env, 'HQ'));
    console.log('HQ stats', hqStats.status, JSON.stringify(hqStats.body, null, 2).slice(0, 800));

    if (hqStats.status === 501) {
        console.error('\nFAIL: Server not configured.');
        process.exit(1);
    }
    if (hqStats.status === 401) {
        console.error('\nFAIL: Unauthorized — set SYNC_CLOUD_READ_KEY on Vercel and pass X-Tvc-Cloud-Read-Key.');
        process.exit(1);
    }
    if (hqStats.status !== 200 || !hqStats.body?.ok) {
        console.error('\nFAIL: HQ stats unexpected response.');
        process.exit(1);
    }

    const adminStatsUrl = `${BASE}/api/sync/cloud/stats?vessel_id=${encodeURIComponent(VESSEL)}`;
    const adminStats = await getJson(adminStatsUrl, cloudHeaders(env, 'ADMIN'));
    console.log('\nAdmin stats', adminStats.status, `total_records=${adminStats.body?.total_records}`);

    const recordsUrl = `${BASE}/api/sync/cloud/records?company_id=${encodeURIComponent(COMPANY)}&vessel_id=${encodeURIComponent(VESSEL)}&store_name=maintenance_jobs&limit=3`;
    const records = await getJson(recordsUrl, cloudHeaders(env, 'HQ'));
    console.log('\nHQ records (maintenance_jobs, limit 3)', records.status, `returned=${records.body?.records?.length}`);

    if (records.status !== 200 || !records.body?.ok) {
        console.error('\nFAIL: records query failed.');
        process.exit(1);
    }

    console.log('\nPASS: Phase C cloud query API ready.');
    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
