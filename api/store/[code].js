'use strict';

const {
    isValidImpaCode,
    getItemByCode,
    buildStoreItemHtml,
    buildNotFoundHtml,
    storeSeoOrigin,
} = require('../_lib/impaSeo');

async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).send('Method not allowed');
    }

    const code = String(req.query.code || '').trim();
    const origin = storeSeoOrigin();

    if (!isValidImpaCode(code)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=300');
        return res.status(400).send(buildNotFoundHtml(code, { origin }));
    }

    try {
        const item = getItemByCode(code);
        if (!item) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'public, s-maxage=300');
            return res.status(404).send(buildNotFoundHtml(code, { origin }));
        }

        const html = buildStoreItemHtml(item, { origin });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
        if (req.method === 'HEAD') return res.status(200).end();
        return res.status(200).send(html);
    } catch (err) {
        console.error('[store-seo]', err);
        return res.status(500).send('Catalog index unavailable');
    }
}

module.exports = handler;
