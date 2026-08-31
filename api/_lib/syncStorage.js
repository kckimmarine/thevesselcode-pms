'use strict';

/**
 * Online sync storage — DATA RETENTION: contracted vessel ZIPs are kept until
 * customer-requested purge (see docs/data-retention-policy.md). No TTL / auto-delete.
 *
 * Phase B: after upload, parse tvc_sync.json → upsert sync_records (see syncIngest.js).
 */
const BUCKET = 'tvc-sync-packages';
const { ingestSyncPackage } = require('./syncIngest');

function getAdminClient() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    try {
        const { createClient } = require('@supabase/supabase-js');
        return createClient(url, key, { auth: { persistSession: false } });
    } catch (_) {
        return null;
    }
}

function isReady() {
    return !!getAdminClient();
}

async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

function sanitizePathPart(value, fallback = 'UNKNOWN') {
    return String(value || fallback).trim().replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 120) || fallback;
}

/** When SYNC_PILOT_VESSEL_ID is set on Vercel, block sync for any other vessel. */
function assertPilotVessel(vesselId) {
    const pilot = String(process.env.SYNC_PILOT_VESSEL_ID || '').trim();
    if (!pilot) return;
    const vid = String(vesselId || '').trim();
    if (vid !== pilot) {
        const err = new Error(`Online sync pilot is limited to vessel "${pilot}". Requested: "${vid}".`);
        err.code = 'PILOT_VESSEL_ONLY';
        throw err;
    }
}

function storagePath({ companyId, vesselId, direction, filename }) {
    const ts = Date.now();
    const safeName = sanitizePathPart(filename, 'package.zip');
    return `${sanitizePathPart(companyId)}/${sanitizePathPart(vesselId)}/${sanitizePathPart(direction)}/${ts}_${safeName}`;
}

async function resolveCompanyId(supabase, vesselId, headerCompanyId) {
    const fromHeader = String(headerCompanyId || '').trim();
    if (fromHeader) return fromHeader;
    const { data, error } = await supabase
        .from('vessels')
        .select('company_id')
        .eq('id', vesselId)
        .maybeSingle();
    if (error) throw error;
    return data?.company_id || 'UNKNOWN';
}

async function uploadPackage({
    vesselId,
    companyId,
    direction,
    filename,
    exportedBy,
    recordCount,
    body,
}) {
    const supabase = getAdminClient();
    if (!supabase) {
        const err = new Error('Supabase is not configured on the server.');
        err.code = 'NOT_CONFIGURED';
        throw err;
    }

    const vid = sanitizePathPart(vesselId, '');
    if (!vid) {
        const err = new Error('vessel_id required');
        err.code = 'BAD_REQUEST';
        throw err;
    }
    assertPilotVessel(vid);

    const cid = await resolveCompanyId(supabase, vid, companyId);
    const path = storagePath({ companyId: cid, vesselId: vid, direction, filename });
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buf, {
        contentType: 'application/zip',
        upsert: false,
    });
    if (upErr) throw upErr;

    const { data: row, error: insErr } = await supabase
        .from('sync_packages')
        .insert({
            company_id: cid,
            vessel_id: vid,
            direction,
            storage_path: path,
            filename: filename || path.split('/').pop(),
            file_size: buf.length,
            exported_by: exportedBy || null,
            record_count: Number(recordCount) || 0,
            status: 'READY',
        })
        .select('id, created_at, filename, file_size, record_count')
        .single();
    if (insErr) throw insErr;

    const ingest = await ingestSyncPackage({
        supabase,
        packageId: row.id,
        companyId: cid,
        vesselId: vid,
        direction,
        body: buf,
    });

    return {
        ok: true,
        package_id: row.id,
        company_id: cid,
        vessel_id: vid,
        direction,
        filename: row.filename,
        file_size: row.file_size,
        record_count: row.record_count,
        created_at: row.created_at,
        storage_path: path,
        ingest,
    };
}

async function pullLatestPackage(vesselId, direction = 'SHIP_TO_HQ') {
    const supabase = getAdminClient();
    if (!supabase) {
        const err = new Error('Supabase is not configured on the server.');
        err.code = 'NOT_CONFIGURED';
        throw err;
    }

    const vid = sanitizePathPart(vesselId, '');
    if (!vid) {
        const err = new Error('vessel_id required');
        err.code = 'BAD_REQUEST';
        throw err;
    }
    assertPilotVessel(vid);

    const { data: rows, error } = await supabase
        .from('sync_packages')
        .select('id, company_id, vessel_id, direction, storage_path, filename, file_size, record_count, created_at, exported_by')
        .eq('vessel_id', vid)
        .eq('direction', direction)
        .eq('status', 'READY')
        .order('created_at', { ascending: false })
        .limit(1);
    if (error) throw error;
    if (!rows?.length) {
        const err = new Error(`No ${direction} package found for vessel ${vid}.`);
        err.code = 'NOT_FOUND';
        throw err;
    }

    const pkg = rows[0];
    const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(pkg.storage_path, 3600);
    if (signErr) throw signErr;

    await markPackageImported(supabase, pkg.id);

    return {
        ok: true,
        package_id: pkg.id,
        company_id: pkg.company_id,
        vessel_id: pkg.vessel_id,
        direction: pkg.direction,
        filename: pkg.filename,
        file_size: pkg.file_size,
        record_count: pkg.record_count,
        created_at: pkg.created_at,
        exported_by: pkg.exported_by,
        download_url: signed?.signedUrl || null,
    };
}

/** Status only — Storage object is retained (data retention policy). */
async function markPackageImported(supabase, packageId) {
    if (!packageId) return;
    const client = supabase || getAdminClient();
    if (!client) return;
    await client
        .from('sync_packages')
        .update({ status: 'IMPORTED' })
        .eq('id', packageId)
        .eq('status', 'READY');
}

/**
 * Customer-requested purge: remove all online-sync packages for one vessel.
 * Does not touch vessel PCs (IndexedDB). Requires audit fields when dry_run is false.
 */
async function purgeVesselSyncPackages({
    vesselId,
    companyId,
    dryRun = false,
    reason = '',
    requestedBy = '',
}) {
    const supabase = getAdminClient();
    if (!supabase) {
        const err = new Error('Supabase is not configured on the server.');
        err.code = 'NOT_CONFIGURED';
        throw err;
    }

    const vid = sanitizePathPart(vesselId, '');
    if (!vid) {
        const err = new Error('vessel_id required');
        err.code = 'BAD_REQUEST';
        throw err;
    }

    const cidFilter = String(companyId || '').trim();
    let query = supabase
        .from('sync_packages')
        .select('id, company_id, vessel_id, storage_path, file_size, filename, status, created_at')
        .eq('vessel_id', vid);
    if (cidFilter) query = query.eq('company_id', cidFilter);

    const { data: rows, error } = await query;
    if (error) throw error;

    const packages = rows || [];
    const bytes = packages.reduce((n, r) => n + (Number(r.file_size) || 0), 0);
    const paths = packages.map(r => r.storage_path).filter(Boolean);

    if (dryRun) {
        return {
            ok: true,
            dry_run: true,
            vessel_id: vid,
            company_id: cidFilter || packages[0]?.company_id || null,
            packages: packages.length,
            bytes,
            storage_paths: paths,
        };
    }

    if (!String(reason || '').trim() || !String(requestedBy || '').trim()) {
        const err = new Error('reason and requested_by are required when dry_run is false.');
        err.code = 'BAD_REQUEST';
        throw err;
    }

    const resolvedCompany = cidFilter || packages[0]?.company_id || 'UNKNOWN';

    if (paths.length) {
        const batchSize = 100;
        for (let i = 0; i < paths.length; i += batchSize) {
            const batch = paths.slice(i, i + batchSize);
            const { error: rmErr } = await supabase.storage.from(BUCKET).remove(batch);
            if (rmErr) throw rmErr;
        }
    }

    let delQuery = supabase.from('sync_packages').delete().eq('vessel_id', vid);
    if (cidFilter) delQuery = delQuery.eq('company_id', cidFilter);
    const { error: delErr } = await delQuery;
    if (delErr) throw delErr;

    const logRow = {
        company_id: resolvedCompany,
        vessel_id: vid,
        scope: 'vessel_sync',
        packages_removed: packages.length,
        bytes_removed: bytes,
        reason: String(reason).trim().slice(0, 2000),
        requested_by: String(requestedBy).trim().slice(0, 200),
    };
    const { error: logErr } = await supabase.from('data_retention_purge_log').insert(logRow);
    if (logErr) {
        logRow._log_insert_failed = logErr.message;
    }

    return {
        ok: true,
        dry_run: false,
        vessel_id: vid,
        company_id: resolvedCompany,
        packages_removed: packages.length,
        bytes_removed: bytes,
        purge_log: logErr ? { warning: logErr.message } : { ok: true },
    };
}

module.exports = {
    BUCKET,
    isReady,
    getAdminClient,
    readRawBody,
    uploadPackage,
    pullLatestPackage,
    markPackageImported,
    purgeVesselSyncPackages,
};
