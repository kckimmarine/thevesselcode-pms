'use strict';

/**
 * Phase C — Query sync_records / sync_vessel_meta / sync_package_ingest (service_role).
 */
const { getAdminClient, assertPilotVessel } = require('./syncStorage');
const { SYNC_STORES } = require('./syncIngest');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function err(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
}

function isReady() {
    return !!getAdminClient();
}

function parseIntBounded(value, fallback, max) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(n, max);
}

function assertCloudReadAuth(req) {
    const expected = String(process.env.SYNC_CLOUD_READ_KEY || '').trim();
    if (!expected) return;
    const auth = String(req.headers?.authorization || '').trim();
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const headerKey = String(req.headers['x-tvc-cloud-read-key'] || '').trim();
    const provided = bearer || headerKey;
    if (!provided || provided !== expected) throw err('UNAUTHORIZED', 'Unauthorized.');
}

/**
 * HQ: company_id required. ADMIN: company_id optional (all companies when omitted).
 */
async function resolveQueryScope(req) {
    const supabase = getAdminClient();
    if (!supabase) throw err('NOT_CONFIGURED', 'Supabase is not configured on the server.');

    const accountType = String(
        req.headers['x-tvc-account-type'] || req.query?.account_type || '',
    ).trim().toUpperCase();
    let companyId = String(
        req.headers['x-tvc-company-id'] || req.query?.company_id || '',
    ).trim();
    const vesselId = String(req.query?.vessel_id || '').trim();

    if (vesselId) assertPilotVessel(vesselId);

    const isAdmin = accountType === 'ADMIN';

    if (isAdmin) {
        if (vesselId && !companyId) {
            const { data, error } = await supabase
                .from('vessels')
                .select('company_id')
                .eq('id', vesselId)
                .maybeSingle();
            if (error) throw error;
            companyId = data?.company_id || companyId;
        }
        return { companyId: companyId || null, vesselId: vesselId || null, isAdmin: true };
    }

    if (accountType === 'HQ') {
        if (!companyId) throw err('BAD_REQUEST', 'company_id is required for HQ cloud queries.');
    } else if (!companyId && vesselId) {
        const { data, error } = await supabase
            .from('vessels')
            .select('company_id')
            .eq('id', vesselId)
            .maybeSingle();
        if (error) throw error;
        companyId = data?.company_id || '';
    }

    if (!companyId) {
        throw err('BAD_REQUEST', 'company_id is required (or provide account_type=ADMIN).');
    }

    if (vesselId) {
        const { data, error } = await supabase
            .from('vessels')
            .select('company_id')
            .eq('id', vesselId)
            .maybeSingle();
        if (error) throw error;
        if (data?.company_id && data.company_id !== companyId) {
            throw err('FORBIDDEN', `Vessel ${vesselId} is not under company ${companyId}.`);
        }
    }

    return { companyId, vesselId: vesselId || null, isAdmin: false };
}

function applyRecordFilters(query, scope, { storeName, recordKey }) {
    let q = query;
    if (scope.companyId) q = q.eq('company_id', scope.companyId);
    if (scope.vesselId) q = q.eq('vessel_id', scope.vesselId);
    if (storeName) q = q.eq('store_name', storeName);
    if (recordKey) q = q.eq('record_key', recordKey);
    return q;
}

async function fetchCloudStats(scope) {
    const supabase = getAdminClient();
    let q = supabase
        .from('sync_records')
        .select('company_id, vessel_id, store_name');
    q = applyRecordFilters(q, scope, { storeName: null, recordKey: null });
    const { data: rows, error } = await q;
    if (error) throw error;

    const byStore = {};
    const byVessel = {};
    for (const row of rows || []) {
        const store = row.store_name || 'unknown';
        byStore[store] = (byStore[store] || 0) + 1;
        const vid = row.vessel_id || 'unknown';
        if (!byVessel[vid]) byVessel[vid] = { total: 0, stores: {} };
        byVessel[vid].total += 1;
        byVessel[vid].stores[store] = (byVessel[vid].stores[store] || 0) + 1;
    }

    let metaQ = supabase.from('sync_vessel_meta').select('vessel_id, meta_key, ingested_at');
    if (scope.companyId) metaQ = metaQ.eq('company_id', scope.companyId);
    if (scope.vesselId) metaQ = metaQ.eq('vessel_id', scope.vesselId);
    const { data: metaRows, error: metaErr } = await metaQ;
    if (metaErr) throw metaErr;

    const meta = {};
    for (const row of metaRows || []) {
        if (!meta[row.vessel_id]) meta[row.vessel_id] = {};
        meta[row.vessel_id][row.meta_key] = { ingested_at: row.ingested_at };
    }

    let ingestQ = supabase
        .from('sync_package_ingest')
        .select('package_id, vessel_id, direction, status, records_upserted, records_skipped, meta_upserted, ingested_at')
        .order('ingested_at', { ascending: false })
        .limit(20);
    if (scope.companyId) ingestQ = ingestQ.eq('company_id', scope.companyId);
    if (scope.vesselId) ingestQ = ingestQ.eq('vessel_id', scope.vesselId);
    const { data: ingestRows, error: ingestErr } = await ingestQ;
    if (ingestErr) throw ingestErr;

    const ingestSummary = {
        packages_total: (ingestRows || []).length,
        packages_ok: (ingestRows || []).filter(r => r.status === 'OK').length,
        last_ingested_at: ingestRows?.[0]?.ingested_at || null,
        recent: ingestRows || [],
    };

    return {
        ok: true,
        scope: {
            company_id: scope.companyId,
            vessel_id: scope.vesselId,
            admin: scope.isAdmin,
        },
        total_records: (rows || []).length,
        stores: byStore,
        vessels: byVessel,
        meta,
        ingest: ingestSummary,
        known_stores: SYNC_STORES.map(s => s.name),
    };
}

async function fetchCloudRecords(scope, opts = {}) {
    const supabase = getAdminClient();
    const limit = parseIntBounded(opts.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parseIntBounded(opts.offset, 0, 100000);
    const storeName = String(opts.storeName || '').trim() || null;
    const recordKey = String(opts.recordKey || '').trim() || null;

    if (storeName && !SYNC_STORES.some(s => s.name === storeName)) {
        throw err('BAD_REQUEST', `Unknown store_name: ${storeName}`);
    }

    let q = supabase
        .from('sync_records')
        .select(
            'company_id, vessel_id, store_name, record_key, payload, record_updated_at, ingested_at, last_package_id',
            { count: 'exact' },
        );
    q = applyRecordFilters(q, scope, { storeName, recordKey });
    q = q.order('ingested_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) throw error;

    return {
        ok: true,
        scope: {
            company_id: scope.companyId,
            vessel_id: scope.vesselId,
            admin: scope.isAdmin,
        },
        store_name: storeName,
        record_key: recordKey,
        total: count ?? (data || []).length,
        limit,
        offset,
        records: data || [],
    };
}

async function fetchCloudMeta(scope, metaKey) {
    const supabase = getAdminClient();
    const key = String(metaKey || '').trim();
    if (!key) throw err('BAD_REQUEST', 'meta_key is required.');

    let q = supabase
        .from('sync_vessel_meta')
        .select('company_id, vessel_id, meta_key, payload, ingested_at, last_package_id');
    if (scope.companyId) q = q.eq('company_id', scope.companyId);
    if (scope.vesselId) q = q.eq('vessel_id', scope.vesselId);
    q = q.eq('meta_key', key);

    const { data, error } = await q;
    if (error) throw error;

    return {
        ok: true,
        scope: {
            company_id: scope.companyId,
            vessel_id: scope.vesselId,
            admin: scope.isAdmin,
        },
        meta_key: key,
        rows: data || [],
    };
}

module.exports = {
    DEFAULT_LIMIT,
    MAX_LIMIT,
    isReady,
    assertCloudReadAuth,
    resolveQueryScope,
    fetchCloudStats,
    fetchCloudRecords,
    fetchCloudMeta,
};
