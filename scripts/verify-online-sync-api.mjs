#!/usr/bin/env node
/**
 * Verify online sync API for pilot vessel TVC No1.
 * Usage: node scripts/verify-online-sync-api.mjs [baseUrl]
 */
const BASE = (process.argv[2] || process.env.SYNC_API_BASE_URL || 'https://app.thevesselcode.com').replace(/\/+$/, '');
const VESSEL = 'TVC No1';

async function check(path, label) {
    const url = `${BASE}${path}`;
    const res = await fetch(url);
    let body;
    try { body = await res.json(); } catch { body = { raw: await res.text() }; }
    const okConfigured = res.status !== 501;
    const okNotFound = res.status === 404 && body?.error === 'NOT_FOUND';
    const pass = okConfigured && (okNotFound || res.status === 200);
    console.log(`\n${label}`);
    console.log(`  GET ${url}`);
    console.log(`  HTTP ${res.status}`);
    console.log(`  ${JSON.stringify(body)}`);
    if (res.status === 501) {
        console.log('  -> NOT CONFIGURED: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on Vercel and redeploy.');
    } else if (okNotFound) {
        console.log('  -> OK: API configured; no package uploaded yet (expected before first sync).');
    } else if (res.status === 200) {
        console.log('  -> OK: package available for download.');
    } else if (res.status === 403 && body?.error === 'PILOT_VESSEL_ONLY') {
        console.log('  -> Pilot guard active (wrong vessel blocked).');
    }
    return { pass, status: res.status, body };
}

async function main() {
    console.log(`Online sync API check — pilot vessel: ${VESSEL}`);
    console.log(`Base URL: ${BASE}`);

    const shipToHq = await check(
        `/api/sync/hq/pull?vessel_id=${encodeURIComponent(VESSEL)}&direction=SHIP_TO_HQ`,
        'HQ pull (SHIP_TO_HQ)',
    );
    const hqToShip = await check(
        `/api/sync/ship/pull?vessel_id=${encodeURIComponent(VESSEL)}&direction=HQ_TO_SHIP`,
        'Master pull (HQ_TO_SHIP)',
    );
    const blocked = await check(
        '/api/sync/hq/pull?vessel_id=OTHER%20VESSEL&direction=SHIP_TO_HQ',
        'Pilot guard (other vessel should be blocked if SYNC_PILOT_VESSEL_ID is set)',
    );

    const configured = shipToHq.status !== 501 && hqToShip.status !== 501;
    console.log('\n--- Summary ---');
    if (!configured) {
        console.log('FAIL: Server not configured. Follow deploy/SETUP-ONLINE-SYNC.ps1');
        process.exit(1);
    }
    if (shipToHq.pass && hqToShip.pass) {
        console.log(`PASS: ${VESSEL} online sync API is ready.`);
        if (blocked.status === 403) {
            console.log('PASS: Pilot vessel guard is active.');
        }
        process.exit(0);
    }
    console.log('WARN: Unexpected responses — check Vercel logs and Supabase bucket/table.');
    process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
