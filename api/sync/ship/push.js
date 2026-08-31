'use strict';

const { isReady, readRawBody, uploadPackage } = require('../../_lib/syncStorage');

async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isReady()) {
        return res.status(501).json({
            error: 'NOT_CONFIGURED',
            message: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel. Create Storage bucket tvc-sync-packages.',
        });
    }

    try {
        const vesselId = String(req.headers['x-vessel-id'] || '').trim();
        const companyId = String(req.headers['x-company-id'] || '').trim();
        const filename = String(req.headers['x-filename'] || 'ship_sync.zip').trim();
        const exportedBy = String(req.headers['x-exported-by'] || '').trim();
        const recordCount = Number(req.headers['x-record-count'] || 0) || 0;
        const body = await readRawBody(req);

        if (!body.length) {
            return res.status(400).json({ error: 'Empty package body' });
        }

        const result = await uploadPackage({
            vesselId,
            companyId,
            direction: 'SHIP_TO_HQ',
            filename,
            exportedBy,
            recordCount,
            body,
        });

        return res.status(200).json(result);
    } catch (e) {
        const code = e.code || 'SYNC_PUSH_FAILED';
        const status = code === 'BAD_REQUEST' ? 400 : code === 'NOT_CONFIGURED' ? 501 : 500;
        return res.status(status).json({
            error: code,
            message: e.message || String(e),
        });
    }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
