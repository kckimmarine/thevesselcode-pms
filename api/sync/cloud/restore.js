'use strict';

const { isReady, readRawBody } = require('../../_lib/syncStorage');
const {
    assertRestoreAuth,
    publishCloudRestore,
    buildRestoreZipForDownload,
} = require('../../_lib/syncCloudRestore');

async function handler(req, res) {
    if (!isReady()) {
        return res.status(501).json({
            error: 'NOT_CONFIGURED',
            message: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel.',
        });
    }

    try {
        assertRestoreAuth(req);

        if (req.method === 'GET') {
            const department = String(req.query?.department || 'ALL').trim().toUpperCase();
            const { buffer, filename } = await buildRestoreZipForDownload(req, department);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
            return res.status(200).send(buffer);
        }

        if (req.method === 'POST') {
            const raw = await readRawBody(req);
            let body = {};
            try {
                body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
            } catch (_) {
                const e = new Error('Invalid JSON body.');
                e.code = 'BAD_REQUEST';
                throw e;
            }
            if (body.vessel_id && !req.query?.vessel_id) {
                req.query = { ...req.query, vessel_id: body.vessel_id };
            }
            if (body.company_id && !req.query?.company_id) {
                req.query = { ...req.query, company_id: body.company_id };
            }
            const department = String(body.department || req.query?.department || 'ALL').trim().toUpperCase();
            const upload = body.upload !== false && body.upload !== 'false';
            const exportedBy = String(body.exported_by || req.headers['x-exported-by'] || 'cloud-restore').trim();
            const result = await publishCloudRestore(req, { department, upload, exportedBy });
            return res.status(200).json(result);
        }

        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        const code = e.code || 'CLOUD_RESTORE_FAILED';
        const status = code === 'BAD_REQUEST' ? 400
            : code === 'UNAUTHORIZED' ? 401
                : code === 'FORBIDDEN' ? 403
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
module.exports.config = { api: { bodyParser: false } };
