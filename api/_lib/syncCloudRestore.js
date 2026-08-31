'use strict';

/**
 * Phase E — Build HQ_TO_SHIP restore ZIP from cloud sync_records (full vessel snapshot).
 */
const JSZip = require('jszip');
const { getAdminClient, assertPilotVessel, uploadPackage } = require('./syncStorage');
const { SYNC_STORES } = require('./syncIngest');
const { resolveQueryScope } = require('./syncCloudQuery');

const PAGE_SIZE = 500;

function err(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
}

function assertRestoreAuth(req) {
    const expected = String(process.env.SYNC_CLOUD_RESTORE_KEY || '').trim();
    if (!expected) return;
    const auth = String(req.headers?.authorization || '').trim();
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const headerKey = String(req.headers['x-tvc-cloud-restore-key'] || '').trim();
    const provided = bearer || headerKey;
    if (!provided || provided !== expected) throw err('UNAUTHORIZED', 'Unauthorized.');
}

function rowDepartment(row, storeName) {
    if (!row || typeof row !== 'object') return '';
    if (row.department) return String(row.department).trim().toUpperCase();
    if (storeName === 'ship_components' && Array.isArray(row.path) && row.path[0]) {
        return String(row.path[0]).trim().toUpperCase();
    }
    return '';
}

function rowMatchesDepartment(row, storeName, wantDept) {
    if (!wantDept || wantDept === 'ALL') return true;
    const d = rowDepartment(row, storeName);
    if (!d) return true;
    return d === wantDept;
}

async function fetchAllRecords(supabase, scope) {
    const all = [];
    let offset = 0;
    while (true) {
        let query = supabase
            .from('sync_records')
            .select('store_name, record_key, payload')
            .order('ingested_at', { ascending: true });
        if (scope.companyId) query = query.eq('company_id', scope.companyId);
        if (scope.vesselId) query = query.eq('vessel_id', scope.vesselId);
        const { data: rows, error } = await query.range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        const batch = rows || [];
        all.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }
    return all;
}

async function fetchMetaPayload(supabase, scope, metaKey) {
    let q = supabase
        .from('sync_vessel_meta')
        .select('payload')
        .eq('meta_key', metaKey);
    if (scope.companyId) q = q.eq('company_id', scope.companyId);
    if (scope.vesselId) q = q.eq('vessel_id', scope.vesselId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data?.payload || null;
}

function recordsToRestorePayload(records, scope, department) {
    const wantDept = String(department || 'ALL').trim().toUpperCase();
    const payload = {
        export_meta: {
            vessel_id: scope.vesselId,
            company_id: scope.companyId,
            export_date: new Date().toISOString().slice(0, 10),
            direction: 'HQ_TO_SHIP',
            department: wantDept === 'ALL' ? 'ALL' : wantDept,
            exported_by: 'cloud-restore',
            schema_version: 6,
            package_type: 'CLOUD_RESTORE',
        },
    };
    for (const { name } of SYNC_STORES) payload[name] = [];

    for (const row of records || []) {
        const store = row.store_name;
        const body = row.payload;
        if (!store || !body || typeof body !== 'object') continue;
        if (!rowMatchesDepartment(body, store, wantDept)) continue;
        if (!payload[store]) payload[store] = [];
        payload[store].push({ ...body });
    }
    return payload;
}

async function buildRestoreZipBuffer(scope, department) {
    const supabase = getAdminClient();
    if (!supabase) throw err('NOT_CONFIGURED', 'Supabase is not configured.');

    const records = await fetchAllRecords(supabase, scope);
    if (!records.length) {
        throw err('NOT_FOUND', `No cloud records for vessel ${scope.vesselId}.`);
    }

    const payload = recordsToRestorePayload(records, scope, department);
    const runHours = await fetchMetaPayload(supabase, scope, 'run_hours');
    if (runHours && typeof runHours === 'object') {
        if (department && department !== 'ALL') {
            const filtered = {};
            for (const [k, v] of Object.entries(runHours)) {
                if (k.startsWith(`${department}|`)) filtered[k] = v;
            }
            payload.run_hours = filtered;
        } else {
            payload.run_hours = runHours;
        }
    }

    const recordCount = SYNC_STORES.reduce((n, s) => n + (payload[s.name]?.length || 0), 0);
    if (!recordCount) {
        throw err('NOT_FOUND', `No records match department ${department || 'ALL'}.`);
    }

    const zip = new JSZip();
    zip.file('tvc_sync.json', JSON.stringify(payload, null, 2));
    zip.file('README.txt', [
        'TVC-PMS Cloud Restore Package',
        `Vessel: ${scope.vesselId}`,
        `Company: ${scope.companyId}`,
        `Department: ${payload.export_meta.department}`,
        `Direction: HQ_TO_SHIP`,
        `Records: ${recordCount}`,
        '',
        'Import on vessel: Pull HQ reply (online) or Import ZIP in Master Hub.',
    ].join('\n'));

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const exportDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const deptTag = payload.export_meta.department === 'ALL' ? 'ALL' : payload.export_meta.department;
    const filename = `${scope.vesselId}_CLOUD_RESTORE_${deptTag}_${exportDate}.zip`;

    return { buffer, filename, payload, record_count: recordCount };
}

async function publishCloudRestore(req, { department, upload = true, exportedBy }) {
    const scope = await resolveQueryScope(req);
    if (!scope.vesselId) throw err('BAD_REQUEST', 'vessel_id is required.');
    assertPilotVessel(scope.vesselId);

    const built = await buildRestoreZipBuffer(scope, department);

    if (!upload) {
        return {
            ok: true,
            upload: false,
            vessel_id: scope.vesselId,
            company_id: scope.companyId,
            filename: built.filename,
            record_count: built.record_count,
            file_size: built.buffer.length,
        };
    }

    const uploadResult = await uploadPackage({
        vesselId: scope.vesselId,
        companyId: scope.companyId,
        direction: 'HQ_TO_SHIP',
        filename: built.filename,
        exportedBy: exportedBy || 'cloud-restore',
        recordCount: built.record_count,
        body: built.buffer,
    });

    return {
        ok: true,
        upload: true,
        restore: true,
        vessel_id: scope.vesselId,
        company_id: scope.companyId,
        filename: built.filename,
        record_count: built.record_count,
        file_size: built.buffer.length,
        package: uploadResult,
        ship_pull_hint: 'On vessel Master Hub: Pull HQ reply (online) or Import this ZIP.',
    };
}

async function buildRestoreZipForDownload(req, department) {
    const scope = await resolveQueryScope(req);
    if (!scope.vesselId) throw err('BAD_REQUEST', 'vessel_id is required.');
    assertPilotVessel(scope.vesselId);
    return buildRestoreZipBuffer(scope, department);
}

module.exports = {
    assertRestoreAuth,
    buildRestoreZipBuffer,
    publishCloudRestore,
    buildRestoreZipForDownload,
};
