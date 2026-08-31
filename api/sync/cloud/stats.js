'use strict';

const {
    isReady,
    assertCloudReadAuth,
    resolveQueryScope,
    fetchCloudStats,
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
        const result = await fetchCloudStats(scope);
        return res.status(200).json(result);
    } catch (e) {
        const code = e.code || 'CLOUD_STATS_FAILED';
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
