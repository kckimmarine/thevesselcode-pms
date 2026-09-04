'use strict';

/**
 * POST /api/gemini/create-issue
 *
 * Webhook that receives a Gemini-authored work-instruction JSON and creates a
 * GitHub Issue tagged with the `cursor-agent` label.
 *
 * Auth:
 *   Authorization: Bearer <GEMINI_ISSUE_WEBHOOK_SECRET>
 *   (or header  x-tvc-gemini-key: <secret>)
 *
 * Body (application/json) — any of these shapes work; the object may also be
 * wrapped under "instruction"/"work"/"task"/"issue"/"data":
 *   {
 *     "title": "Short imperative summary",           // required
 *     "description": "What & why (markdown ok)",     // optional
 *     "context": "Background",                        // optional
 *     "tasks": ["step 1", "step 2"],                  // optional -> checklist
 *     "acceptance_criteria": ["done when ..."],       // optional -> checklist
 *     "files": ["js/app.js"],                          // optional
 *     "labels": ["bug"],                               // optional (cursor-agent always added)
 *     "assignees": ["octocat"]                         // optional
 *   }
 *
 * Success: 201 { ok, issue_number, issue_url, html_url, labels }
 */

const { isReady, createGitHubIssue } = require('../_lib/githubIssues');

async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

function assertWebhookAuth(req) {
    const expected = String(
        process.env.GEMINI_ISSUE_WEBHOOK_SECRET || process.env.GEMINI_WEBHOOK_SECRET || '',
    ).trim();
    if (!expected) {
        const err = new Error('GEMINI_ISSUE_WEBHOOK_SECRET is not configured on the server.');
        err.code = 'NOT_CONFIGURED';
        throw err;
    }
    const auth = String(req.headers?.authorization || '').trim();
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const headerKey = String(req.headers?.['x-tvc-gemini-key'] || '').trim();
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
        return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
    }

    if (!isReady()) {
        return res.status(501).json({
            error: 'NOT_CONFIGURED',
            message: 'Set GITHUB_ISSUE_TOKEN (Issues: write) and GITHUB_ISSUE_REPO ("owner/repo") on Vercel.',
        });
    }

    try {
        assertWebhookAuth(req);

        const raw = await readRawBody(req);
        let payload;
        try {
            payload = raw.length ? JSON.parse(raw.toString('utf8')) : null;
        } catch (_) {
            const err = new Error('Invalid JSON body.');
            err.code = 'BAD_REQUEST';
            throw err;
        }
        if (!payload) {
            const err = new Error('Empty request body.');
            err.code = 'BAD_REQUEST';
            throw err;
        }

        const result = await createGitHubIssue(payload);
        return res.status(201).json(result);
    } catch (e) {
        const code = e.code || 'CREATE_ISSUE_FAILED';
        const status = code === 'BAD_REQUEST' ? 400
            : code === 'UNAUTHORIZED' ? 401
                : code === 'NOT_CONFIGURED' ? 501
                    : code === 'GITHUB_UNREACHABLE' ? 502
                        : code === 'GITHUB_ERROR' ? 502
                            : 500;
        return res.status(status).json({
            error: code,
            message: e.message || String(e),
        });
    }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
