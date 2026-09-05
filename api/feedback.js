'use strict';

const DEFAULT_REPO = 'kckimmarine/thevesselcode-pms';
const REVIEW_LABELS = ['pending-review', 'crew-feedback'];

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(raw ? JSON.parse(raw) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

function githubConfig() {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    const [owner, repo] = String(process.env.GITHUB_REPO || DEFAULT_REPO).split('/');
    return {
        token,
        owner: owner || 'kckimmarine',
        repo: repo || 'thevesselcode-pms',
    };
}

async function githubRequest(path, opts = {}) {
    const c = githubConfig();
    if (!c.token) {
        const err = new Error('GITHUB_TOKEN is not configured on the server.');
        err.code = 'NOT_CONFIGURED';
        throw err;
    }
    const res = await fetch(`https://api.github.com${path}`, {
        method: opts.method || 'GET',
        headers: {
            Authorization: `Bearer ${c.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'TVC-PMS-Feedback-Collector',
            ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text();
        const err = new Error(`GitHub ${path} ${res.status}: ${text.slice(0, 400)}`);
        err.code = 'GITHUB_ERROR';
        err.status = res.status;
        throw err;
    }
    return res.status === 204 ? null : res.json();
}

function excerpt(text, max = 72) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return 'Crew feedback';
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function buildIssueBody({ comment, deviceInfo, images }) {
    const lines = [
        '## Crew field feedback (CEO review queue)',
        '',
        '> **No auto-patch** — this issue is tagged `pending-review` for superintendent approval before any code changes.',
        '',
        '### Description',
        String(comment || '').trim() || '_No description provided._',
        '',
        '### Device info',
        '```json',
        JSON.stringify(deviceInfo || {}, null, 2),
        '```',
    ];

    const imgs = Array.isArray(images) ? images.filter((img) => img && img.dataUrl) : [];
    if (imgs.length) {
        lines.push('', '### Screenshots');
        imgs.forEach((img, i) => {
            const name = img.name || `screenshot-${i + 1}.png`;
            lines.push('', `#### ${name}`, `<img alt="${name}" src="${img.dataUrl}" width="480" />`);
        });
    }

    lines.push('', '---', '_Submitted via TVC-PMS AI Help · Mode B (Report Issue)_');
    return lines.join('\n');
}

async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = await readJsonBody(req);
        const comment = String(body.comment || '').trim();
        const titleInput = String(body.title || '').trim();
        const deviceInfo = body.deviceInfo && typeof body.deviceInfo === 'object' ? body.deviceInfo : {};
        const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];

        if (!comment && !images.length) {
            return res.status(400).json({ error: 'Comment or screenshot is required.' });
        }

        const issueTitle = `[Field Feedback] ${excerpt(titleInput || comment)}`;
        const issueBody = buildIssueBody({ comment, deviceInfo, images });
        const c = githubConfig();

        const issue = await githubRequest(`/repos/${c.owner}/${c.repo}/issues`, {
            method: 'POST',
            body: {
                title: issueTitle.slice(0, 256),
                body: issueBody,
                labels: REVIEW_LABELS,
            },
        });

        return res.status(200).json({
            ok: true,
            issueNumber: issue.number,
            issueUrl: issue.html_url,
        });
    } catch (e) {
        const code = e.code || 'FEEDBACK_FAILED';
        const status = code === 'NOT_CONFIGURED' ? 501
            : code === 'GITHUB_ERROR' && e.status === 422 ? 422
                : 500;
        return res.status(status).json({
            error: code,
            message: e.message || String(e),
        });
    }
}

module.exports = handler;
