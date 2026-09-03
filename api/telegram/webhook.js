'use strict';

const {
    isReady,
    verifyWebhookSecret,
    readJsonBody,
    handleTelegramUpdate,
} = require('../_lib/telegramBridge');

async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!isReady()) {
        return res.status(501).json({
            error: 'NOT_CONFIGURED',
            message: 'Set TELEGRAM_*, GEMINI_API_KEY, GITHUB_TOKEN on Vercel.',
        });
    }

    if (!verifyWebhookSecret(req)) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    try {
        const update = await readJsonBody(req);
        const result = await handleTelegramUpdate(update);
        return res.status(200).json({ ok: true, ...result });
    } catch (e) {
        console.error('[telegram/webhook]', e);
        return res.status(500).json({
            error: 'TELEGRAM_BRIDGE_FAILED',
            message: e.message || String(e),
        });
    }
}

module.exports = handler;
