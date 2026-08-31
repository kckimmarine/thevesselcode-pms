'use strict';

const {
    isReady,
    assertCloudReadAuth,
    resolveQueryScope,
    fetchCloudRecords,
    fetchCloudMeta,
} = require('../../_lib/syncCloudQuery');

async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isReady()) {
        return res.status(501).json({
            error: 'NOT_CONFIGURED',
            message: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel.',
        });
    }

    try {
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
        const status = code === 'BAD_REQUEST' ? 400
            : code === 'UNAUTHORIZED' ? 401
                : code === 'FORBIDDEN' ? 403
                    : code === 'NOT_CONFIGURED' ? 501
                        : code === 'PILOT_VESSEL_ONLY' ? 403
                            : 500;
        return res.status(status).json({
            error: code,
            message: e.message || String(e),
        });
    }
}

module.exports = handler;
