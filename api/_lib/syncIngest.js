'use strict';

/**
 * Phase B — Parse sync ZIP (tvc_sync.json) and upsert into Supabase sync_records.
 * Merge semantics mirror client mergePayload: newer updated_at wins.
 */
const JSZip = require('jszip');

/** IndexedDB stores included in standard sync payloads */
const SYNC_STORES = [
    { name: 'maintenance_jobs', key: 'id' },
    { name: 'maintenance_groups', key: 'id' },
    { name: 'spare_groups', key: 'id' },
    { name: 'daily_work_reports', key: 'id' },
    { name: 'spare_parts', key: 'id' },
    { name: 'ship_components', key: 'id' },
    { name: 'audit_logs', key: 'id' },
    { name: 'requisitions', key: 'id' },
    { name: 'job_bom', key: 'id' },
    { name: 'universal_catalog', key: 'universal_code' },
    { name: 'defect_cases', key: 'id' },
    { name: 'work_permits', key: 'id' },
    { name: 'consume_logs', key: 'id' },
    { name: 'inventory_history', key: 'id' },
    { name: 'vessel_documents', key: 'id' },
];

const META_KEYS = ['run_hours', 'company_comments'];

const JSON_ZIP_PATHS = [
    'tvc_sync.json',
    'tvc_station_export.json',
    'tvc_company_report.json',
];

function recordUpdatedAt(row) {
    const raw = row?.updated_at || row?.last_synced_at || row?.created_at;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function shouldApplyIncoming(existingPayload, incomingPayload) {
    const inTs = incomingPayload?.updated_at || incomingPayload?.last_synced_at || '';
    const exTs = existingPayload?.updated_at || existingPayload?.last_synced_at || '';
    if (!exTs || !inTs) return true;
    return String(inTs) >= String(exTs);
}

function recordKey(row, keyField) {
    const v = row?.[keyField];
    if (v == null || v === '') return null;
    return String(v);
}

function stampVesselId(row, vesselId) {
    if (!vesselId || row.vessel_id || row.vesselId) return row;
    return { ...row, vessel_id: vesselId };
}

async function parseSyncZipBuffer(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    for (const path of JSON_ZIP_PATHS) {
        const file = zip.file(path);
        if (!file) continue;
        const text = await file.async('string');
        try {
            return JSON.parse(text);
        } catch (e) {
            const err = new Error(`Invalid JSON in ${path}: ${e.message}`);
            err.code = 'INVALID_PAYLOAD';
            throw err;
        }
    }
    return null;
}

function collectRecordItems(payload, companyId, vesselId, packageId) {
    const items = [];
    for (const { name, key } of SYNC_STORES) {
        const rows = payload[name];
        if (!Array.isArray(rows) || !rows.length) continue;
        for (const raw of rows) {
            if (!raw || typeof raw !== 'object') continue;
            const row = stampVesselId(raw, vesselId);
            const rk = recordKey(row, key);
            if (!rk) continue;
            items.push({
                company_id: companyId,
                vessel_id: vesselId,
                store_name: name,
                record_key: rk,
                payload: row,
                record_updated_at: recordUpdatedAt(row),
                last_package_id: packageId,
            });
        }
    }
    return items;
}

function collectMetaItems(payload, companyId, vesselId, packageId) {
    const items = [];
    for (const metaKey of META_KEYS) {
        const data = payload[metaKey];
        if (data == null) continue;
        if (metaKey === 'company_comments' && Array.isArray(data) && !data.length) continue;
        if (metaKey === 'run_hours' && typeof data === 'object' && !Object.keys(data).length) continue;
        items.push({
            company_id: companyId,
            vessel_id: vesselId,
            meta_key: metaKey,
            payload: data,
            last_package_id: packageId,
        });
    }
    return items;
}

async function fetchExistingBatch(supabase, vesselId, batch) {
    const storeNames = [...new Set(batch.map(b => b.store_name))];
    const recordKeys = [...new Set(batch.map(b => b.record_key))];
    const { data, error } = await supabase
        .from('sync_records')
        .select('store_name, record_key, payload, record_updated_at')
        .eq('vessel_id', vesselId)
        .in('store_name', storeNames)
        .in('record_key', recordKeys);
    if (error) throw error;
    const map = new Map();
    for (const row of data || []) {
        map.set(`${row.store_name}|${row.record_key}`, row);
    }
    return map;
}

async function mergeRecordBatch(supabase, batch) {
    if (!batch.length) return { upserted: 0, skipped: 0 };
    const vesselId = batch[0].vessel_id;
    const existingMap = await fetchExistingBatch(supabase, vesselId, batch);
    const toUpsert = [];
    let skipped = 0;
    for (const item of batch) {
        const k = `${item.store_name}|${item.record_key}`;
        const ex = existingMap.get(k);
        if (ex && !shouldApplyIncoming(ex.payload, item.payload)) {
            skipped += 1;
            continue;
        }
        toUpsert.push(item);
    }
    if (toUpsert.length) {
        const { error } = await supabase
            .from('sync_records')
            .upsert(toUpsert, { onConflict: 'vessel_id,store_name,record_key' });
        if (error) throw error;
    }
    return { upserted: toUpsert.length, skipped };
}

async function upsertMetaItems(supabase, items) {
    if (!items.length) return 0;
    const { error } = await supabase
        .from('sync_vessel_meta')
        .upsert(items, { onConflict: 'vessel_id,meta_key' });
    if (error) throw error;
    return items.length;
}

async function writeIngestLog(supabase, row) {
    const { error } = await supabase.from('sync_package_ingest').upsert(row, { onConflict: 'package_id' });
    if (error) throw error;
}

function isMissingIngestTableError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('sync_records') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

/**
 * Ingest one uploaded ZIP into Postgres. Never throws to caller — returns status object.
 */
async function ingestSyncPackage({
    supabase,
    packageId,
    companyId,
    vesselId,
    direction,
    body,
}) {
    const baseLog = {
        package_id: packageId,
        company_id: companyId,
        vessel_id: vesselId,
        direction: direction || 'UNKNOWN',
    };

    try {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
        const payload = await parseSyncZipBuffer(buf);

        if (!payload) {
            await writeIngestLog(supabase, {
                ...baseLog,
                status: 'SKIPPED',
                records_upserted: 0,
                records_skipped: 0,
                meta_upserted: 0,
                error_message: 'No tvc_sync.json (or equivalent) in ZIP',
            });
            return { ok: true, status: 'SKIPPED', records_upserted: 0, records_skipped: 0, meta_upserted: 0 };
        }

        const meta = payload.export_meta || {};
        const cid = String(companyId || meta.company_id || '').trim() || 'UNKNOWN';
        const vid = String(vesselId || meta.vessel_id || '').trim();
        if (!vid) {
            await writeIngestLog(supabase, {
                ...baseLog,
                status: 'FAILED',
                error_message: 'vessel_id missing in headers and export_meta',
            });
            return { ok: false, status: 'FAILED', error: 'vessel_id missing' };
        }

        const items = collectRecordItems(payload, cid, vid, packageId);
        const BATCH = 100;
        let upserted = 0;
        let skipped = 0;
        for (let i = 0; i < items.length; i += BATCH) {
            const part = await mergeRecordBatch(supabase, items.slice(i, i + BATCH));
            upserted += part.upserted;
            skipped += part.skipped;
        }

        const metaItems = collectMetaItems(payload, cid, vid, packageId);
        const metaUpserted = await upsertMetaItems(supabase, metaItems);

        await writeIngestLog(supabase, {
            ...baseLog,
            company_id: cid,
            vessel_id: vid,
            status: 'OK',
            records_upserted: upserted,
            records_skipped: skipped,
            meta_upserted: metaUpserted,
            error_message: null,
        });

        return {
            ok: true,
            status: 'OK',
            records_upserted: upserted,
            records_skipped: skipped,
            meta_upserted: metaUpserted,
            stores_touched: [...new Set(items.map(i => i.store_name))],
        };
    } catch (e) {
        if (isMissingIngestTableError(e)) {
            return {
                ok: false,
                status: 'SKIPPED',
                error: 'INGEST_TABLES_MISSING',
                message: 'Run deploy/supabase-sync-ingest.sql on Supabase',
            };
        }
        try {
            await writeIngestLog(supabase, {
                ...baseLog,
                status: 'FAILED',
                error_message: String(e.message || e).slice(0, 2000),
            });
        } catch (_) { /* ingest log table may not exist yet */ }
        return { ok: false, status: 'FAILED', error: e.code || 'INGEST_FAILED', message: e.message || String(e) };
    }
}

module.exports = {
    SYNC_STORES,
    parseSyncZipBuffer,
    collectRecordItems,
    collectMetaItems,
    shouldApplyIncoming,
    mergeRecordBatch,
    upsertMetaItems,
    recordUpdatedAt,
    recordKey,
    ingestSyncPackage,
};
