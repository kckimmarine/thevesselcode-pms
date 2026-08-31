#!/usr/bin/env node
/**
 * Verify Phase B ingest: upload minimal ZIP → sync_records upsert.
 * Usage: node scripts/verify-sync-ingest.mjs
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'deploy', '.env.deploy.local');

const VESSEL = 'TVC No1';
const COMPANY = 'TVC';

function loadEnv() {
    const out = {};
    for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 1) continue;
        const k = t.slice(0, i).trim();
        const v = t.slice(i + 1).trim();
        out[k] = v;
        if (!process.env[k]) process.env[k] = v;
    }
    return out;
}

async function buildTestZip() {
    const now = new Date().toISOString();
    const jobId = `verify-job-${Date.now()}`;
    const payload = {
        export_meta: {
            vessel_id: VESSEL,
            company_id: COMPANY,
            export_date: now.slice(0, 10),
            direction: 'SHIP_TO_HQ',
            department: 'ENGINE',
            exported_by: 'verify-sync-ingest',
            schema_version: 6,
        },
        maintenance_jobs: [{
            id: jobId,
            job_code: '99-99-001',
            department: 'ENGINE',
            vessel_id: VESSEL,
            sync_status: 'LOCAL',
            updated_at: now,
            job_detail: 'Ingest verification job',
        }],
        run_hours: { 'ENGINE|MAIN': { hours: 12345, updated_at: now } },
    };
    const zip = new JSZip();
    zip.file('tvc_sync.json', JSON.stringify(payload, null, 2));
    return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), jobId, payload };
}

async function countRecords(env, jobId) {
    const base = env.SUPABASE_URL.replace(/\/+$/, '');
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const url = `${base}/rest/v1/sync_records?vessel_id=eq.${encodeURIComponent(VESSEL)}&store_name=eq.maintenance_jobs&record_key=eq.${encodeURIComponent(jobId)}&select=record_key,payload`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
    if (res.status === 404 || res.status === 406) {
        const t = await res.text();
        if (/does not exist|schema cache/i.test(t)) {
            return { missingTable: true, rows: [] };
        }
    }
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`sync_records query failed ${res.status}: ${t}`);
    }
    const rows = await res.json();
    return { missingTable: false, rows };
}

async function main() {
    if (!existsSync(ENV_PATH)) {
        console.error('Missing deploy/.env.deploy.local');
        process.exit(1);
    }
    const env = loadEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    process.env.SYNC_PILOT_VESSEL_ID = process.env.SYNC_PILOT_VESSEL_ID || env.SYNC_PILOT_VESSEL_ID || VESSEL;

    const { uploadPackage } = require(path.join(ROOT, 'api', '_lib', 'syncStorage.js'));
    const { buffer, jobId } = await buildTestZip();

    console.log('Uploading test SHIP_TO_HQ package with 1 maintenance_jobs row ...');
    const result = await uploadPackage({
        vesselId: VESSEL,
        companyId: COMPANY,
        direction: 'SHIP_TO_HQ',
        filename: `verify_ingest_${Date.now()}.zip`,
        exportedBy: 'verify-sync-ingest',
        recordCount: 1,
        body: buffer,
    });

    console.log('Upload result:', JSON.stringify({
        package_id: result.package_id,
        ingest: result.ingest,
    }, null, 2));

    if (result.ingest?.error === 'INGEST_TABLES_MISSING') {
        console.error('\nFAIL: Ingest tables missing. Run: npm run setup-supabase-ingest');
        process.exit(1);
    }
    if (result.ingest?.status === 'FAILED') {
        console.error('\nFAIL: Ingest failed:', result.ingest.message || result.ingest.error);
        process.exit(1);
    }
    if (result.ingest?.status === 'SKIPPED' && result.ingest?.error !== 'INGEST_TABLES_MISSING') {
        console.error('\nFAIL: Ingest skipped unexpectedly:', result.ingest);
        process.exit(1);
    }

    const { rows, missingTable } = await countRecords(env, jobId);
    if (missingTable) {
        console.error('\nFAIL: sync_records table not found after ingest reported OK');
        process.exit(1);
    }
    if (!rows.length) {
        console.error('\nFAIL: No sync_records row for test job', jobId);
        process.exit(1);
    }

    const detail = rows[0]?.payload?.job_detail;
    console.log('\nPASS: sync_records contains test job:', jobId);
    console.log('  job_detail:', detail);
    console.log('  records_upserted:', result.ingest?.records_upserted);
    console.log('  meta_upserted:', result.ingest?.meta_upserted);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
