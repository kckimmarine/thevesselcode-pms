'use strict';

const {
    isReady,
    assertCloudReadAuth,
    resolveQueryScope,
    fetchCloudRecords,
    fetchCloudMeta,
} = require('../../_lib/syncCloudQuery');
const { getAdminClient, readRawBody } = require('../../_lib/syncStorage');
const {
    SYNC_STORES,
    mergeRecordBatch,
    upsertMetaItems,
    recordUpdatedAt,
    recordKey,
} = require('../../_lib/syncIngest');

const MAX_UPSERT = 400;

function failStatus(code) {
    return code === 'BAD_REQUEST' ? 400
        : code === 'UNAUTHORIZED' ? 401
            : code === 'FORBIDDEN' ? 403
                : code === 'NOT_CONFIGURED' ? 501
                    : code === 'PILOT_VESSEL_ONLY' ? 403
                        : 500;
}

async function readJsonBody(req) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        return req.body;
    }
    const raw = await readRawBody(req);
    if (!raw.length) return {};
    return JSON.parse(raw.toString('utf8'));
}

async function upsertWebRecords(req, res) {
    assertCloudReadAuth(req);
    const body = await readJsonBody(req);
    if (!req.query) req.query = {};
    if (body.vessel_id && !req.query.vessel_id) req.query.vessel_id = String(body.vessel_id);
    if (body.company_id && !req.query.company_id) req.query.company_id = String(body.company_id);

    const scope = await resolveQueryScope(req);
    const vesselId = String(scope.vesselId || body.vessel_id || '').trim();
    const companyId = String(scope.companyId || body.company_id || '').trim();
    if (!vesselId) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'vessel_id is required.' });
    }
    if (!companyId) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'company_id is required.' });
    }

    const incoming = Array.isArray(body.records) ? body.records : [];
    if (incoming.length > MAX_UPSERT) {
        return res.status(400).json({
            error: 'BAD_REQUEST',
            message: `At most ${MAX_UPSERT} records per request.`,
        });
    }

    const known = new Set(SYNC_STORES.map(s => s.name));
    const keyByStore = Object.fromEntries(SYNC_STORES.map(s => [s.name, s.key]));
    const now = new Date().toISOString();
    const batch = [];
    for (const rec of incoming) {
        const store = String(rec?.store_name || '').trim();
        if (!known.has(store)) continue;
        const payload = rec?.payload && typeof rec.payload === 'object' ? { ...rec.payload } : null;
        if (!payload) continue;
        if (!payload.vessel_id) payload.vessel_id = vesselId;
        const rk = String(rec.record_key || recordKey(payload, keyByStore[store]) || '').trim();
        if (!rk) continue;
        batch.push({
            company_id: companyId,
            vessel_id: vesselId,
            store_name: store,
            record_key: rk,
            payload,
            record_updated_at: recordUpdatedAt(payload),
            last_package_id: null,
            ingested_at: now,
        });
    }

    const supabase = getAdminClient();
    let upserted = 0;
    let skipped = 0;
    const CHUNK = 100;
    for (let i = 0; i < batch.length; i += CHUNK) {
        const part = await mergeRecordBatch(supabase, batch.slice(i, i + CHUNK));
        upserted += part.upserted;
        skipped += part.skipped;
    }

    const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
    const metaItems = [];
    for (const metaKey of ['run_hours', 'company_comments']) {
        if (meta[metaKey] == null) continue;
        metaItems.push({
            company_id: companyId,
            vessel_id: vesselId,
            meta_key: metaKey,
            payload: meta[metaKey],
            last_package_id: null,
        });
    }
    const metaUpserted = await upsertMetaItems(supabase, metaItems);

    return res.status(200).json({
        ok: true,
        vessel_id: vesselId,
        company_id: companyId,
        records_upserted: upserted,
        records_skipped: skipped,
        meta_upserted: metaUpserted,
    });
}

async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isReady()) {
        return res.status(501).json({
            error: 'NOT_CONFIGURED',
            message: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel.',
        });
    }

    try {
        if (req.method === 'POST') {
            return await upsertWebRecords(req, res);
        }

        assertCloudReadAuth(req);
        const scope = await resolveQueryScope(req);

        const metaKey = String(req.query?.meta_key || '').trim();
        if (metaKey) {
            const result = await fetchCloudMeta(scope, metaKey);
            return res.status(200).json(result);
        }

        const result = await fetchCloudRecords(scope, {
            storeName: req.query?.store_name,
            recordKey: req.query?.record_key,
            limit: req.query?.limit,
            offset: req.query?.offset,
        });
        return res.status(200).json(result);
    } catch (e) {
        const code = e.code || 'CLOUD_RECORDS_FAILED';
        return res.status(failStatus(code)).json({
            error: code,
            message: e.message || String(e),
        });
    }
}

module.exports = handler;
