'use strict';

const { isReady, pullLatestPackage } = require('../../_lib/syncStorage');

async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isReady()) {
        return res.status(501).json({
            error: 'NOT_CONFIGURED',
            message: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel. Create Storage bucket tvc-sync-packages.',
        });
    }

    try {
        const vesselId = String(req.query?.vessel_id || '').trim();
        const direction = String(req.query?.direction || 'HQ_TO_SHIP').trim();
        const result = await pullLatestPackage(vesselId, direction);
        return res.status(200).json(result);
    } catch (e) {
        const code = e.code || 'SYNC_PULL_FAILED';
        const status = code === 'BAD_REQUEST' ? 400
            : code === 'NOT_FOUND' ? 404
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
