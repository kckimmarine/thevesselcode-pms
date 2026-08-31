'use strict';

const { isReady, readRawBody, purgeVesselSyncPackages } = require('../_lib/syncStorage');

function assertPurgeAuth(req) {
    const expected = String(process.env.ADMIN_DATA_PURGE_KEY || '').trim();
    if (!expected) {
        const err = new Error('ADMIN_DATA_PURGE_KEY is not configured on the server.');
        err.code = 'NOT_CONFIGURED';
        throw err;
    }
    const auth = String(req.headers?.authorization || '').trim();
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const headerKey = String(req.headers['x-tvc-admin-purge-key'] || '').trim();
    const provided = bearer || headerKey;
    if (!provided || provided !== expected) {
        const err = new Error('Unauthorized.');
        err.code = 'UNAUTHORIZED';
        throw err;
    }
}

async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isReady()) {
        return res.status(501).json({
            error: 'NOT_CONFIGURED',
            message: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel.',
        });
    }

    try {
        assertPurgeAuth(req);
        const raw = await readRawBody(req);
        let body = {};
        try {
            body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
        } catch (_) {
            const err = new Error('Invalid JSON body.');
            err.code = 'BAD_REQUEST';
            throw err;
        }

        const dryRun = body.dry_run !== false && body.dry_run !== 'false';
        const result = await purgeVesselSyncPackages({
            vesselId: body.vessel_id,
            companyId: body.company_id,
            dryRun,
            reason: body.reason,
            requestedBy: body.requested_by,
        });

        return res.status(200).json(result);
    } catch (e) {
        const code = e.code || 'PURGE_FAILED';
        const status = code === 'BAD_REQUEST' ? 400
            : code === 'UNAUTHORIZED' ? 401
                : code === 'NOT_CONFIGURED' ? 501
                    : 500;
        return res.status(status).json({
            error: code,
            message: e.message || String(e),
        });
    }
}

module.exports = handler;
