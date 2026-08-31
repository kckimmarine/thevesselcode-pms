#!/usr/bin/env node
/**
 * Verify Phase E cloud restore API (publish HQ_TO_SHIP from sync_records).
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

function headers(env, accountType) {
    const h = {
        'Content-Type': 'application/json',
        'X-Tvc-Account-Type': accountType,
    };
    if (accountType === 'HQ') h['X-Tvc-Company-Id'] = COMPANY;
    const key = env.SYNC_CLOUD_RESTORE_KEY || '';
    if (key) h['X-Tvc-Cloud-Restore-Key'] = key;
    return h;
}

async function main() {
    const env = loadEnv();
    console.log(`Cloud restore API — ${BASE}\n`);

    const publishRes = await fetch(`${BASE}/api/sync/cloud/restore`, {
        method: 'POST',
        headers: headers(env, 'HQ'),
        body: JSON.stringify({
            vessel_id: VESSEL,
            company_id: COMPANY,
            department: 'ALL',
            upload: true,
            exported_by: 'verify-sync-cloud-restore',
        }),
    });
    const publishBody = await publishRes.json().catch(() => ({}));
    console.log('POST restore', publishRes.status, JSON.stringify(publishBody, null, 2).slice(0, 900));

    if (publishRes.status === 401) {
        console.error('\nFAIL: Unauthorized (set SYNC_CLOUD_RESTORE_KEY if required).');
        process.exit(1);
    }
    if (publishRes.status !== 200 || !publishBody.ok) {
        console.error('\nFAIL: publish restore failed.');
        process.exit(1);
    }

    const pullRes = await fetch(
        `${BASE}/api/sync/ship/pull?vessel_id=${encodeURIComponent(VESSEL)}&direction=HQ_TO_SHIP`,
    );
    const pullBody = await pullRes.json().catch(() => ({}));
    console.log('\nShip pull HQ_TO_SHIP', pullRes.status, pullBody.filename || pullBody.error);

    if (pullRes.status !== 200) {
        console.error('\nFAIL: vessel cannot pull restore package.');
        process.exit(1);
    }

    console.log('\nPASS: Cloud restore published and pullable as HQ_TO_SHIP.');
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
