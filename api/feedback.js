'use strict';

const DEFAULT_REPO = 'kckimmarine/thevesselcode-pms';
const QUEUE_PATH = 'FEEDBACK_QUEUE.json';
const REVIEW_LABELS = ['pending-review', 'crew-feedback'];
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(Object.assign(new Error('Payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
                return;
            }
            chunks.push(chunk);
        });
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
        token: String(token || '').trim(),
        owner: owner || 'kckimmarine',
        repo: repo || 'thevesselcode-pms',
    };
}

async function githubRequest(path, opts = {}) {
    const c = githubConfig();
    if (!c.token) {
        const err = new Error('GitHub Token Missing');
        err.code = 'GITHUB_TOKEN_MISSING';
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

function makeFeedbackId(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const y = date.getUTCFullYear();
    const m = pad(date.getUTCMonth() + 1);
    const d = pad(date.getUTCDate());
    const h = pad(date.getUTCHours());
    const mi = pad(date.getUTCMinutes());
    const s = pad(date.getUTCSeconds());
    return `FB-${y}${m}${d}-${h}${mi}${s}`;
}

function excerpt(text, max = 72) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return 'Crew feedback';
    return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function resolvePage(body, deviceInfo) {
    const page = String(body.page || deviceInfo?.url || deviceInfo?.page || '').trim();
    return page || 'Unknown';
}

function buildQueueEntry({ ticketId, timestamp, body, deviceInfo, images }) {
    const title = String(body.title || '').trim();
    const comment = String(body.comments || body.comment || '').trim();
    return {
        id: ticketId,
        timestamp,
        page: resolvePage(body, deviceInfo),
        deviceInfo: deviceInfo && typeof deviceInfo === 'object' ? deviceInfo : String(body.deviceInfo || ''),
        issue: comment || title,
        hasImage: Array.isArray(images) && images.length > 0,
        status: 'pending',
    };
}

async function loadFeedbackQueue(c) {
    try {
        const data = await githubRequest(`/repos/${c.owner}/${c.repo}/contents/${QUEUE_PATH}`);
        const raw = Buffer.from(String(data.content || ''), 'base64').toString('utf8');
        const parsed = raw ? JSON.parse(raw) : [];
        return {
            queue: Array.isArray(parsed) ? parsed : [],
            sha: data.sha || null,
        };
    } catch (e) {
        if (e.status === 404) {
            return { queue: [], sha: null };
        }
        throw e;
    }
}

async function saveFeedbackQueue(c, queue, sha, ticketId) {
    const content = Buffer.from(`${JSON.stringify(queue, null, 2)}\n`, 'utf8').toString('base64');
    const putBody = {
        message: `feedback: append ${ticketId}`,
        content,
        committer: {
            name: 'TVC-PMS Feedback Collector',
            email: 'feedback@thevesselcode.com',
        },
    };
    if (sha) putBody.sha = sha;
    await githubRequest(`/repos/${c.owner}/${c.repo}/contents/${QUEUE_PATH}`, {
        method: 'PUT',
        body: putBody,
    });
}

async function appendFeedbackQueue(c, entry) {
    const { queue, sha } = await loadFeedbackQueue(c);
    queue.push(entry);
    await saveFeedbackQueue(c, queue, sha, entry.id);
    console.info('[feedback] queue appended', entry.id, `(${queue.length} total)`);
    return entry;
}

function buildIssueBody({ ticketId, comment, titleInput, deviceInfo, images }) {
    const lines = [
        '## Crew field feedback (CEO review queue)',
        '',
        '> **No auto-patch** — this issue is tagged `pending-review` for superintendent approval before any code changes.',
        '',
        `**Queue ID:** \`${ticketId}\` · See \`${QUEUE_PATH}\` on \`master\`.`,
        '',
        '### Description',
        String(comment || '').trim() || String(titleInput || '').trim() || '_No description provided._',
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
            const name = img.name || `screenshot-${i + 1}.jpg`;
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

    const c = githubConfig();
    if (!c.token) {
        console.error('[feedback] GitHub Token Missing — set GITHUB_TOKEN on Vercel');
        return res.status(500).json({ error: 'GitHub Token Missing' });
    }

    try {
        const body = await readJsonBody(req);
        const comment = String(body.comments || body.comment || '').trim();
        const titleInput = String(body.title || '').trim();
        const deviceInfo = body.deviceInfo && typeof body.deviceInfo === 'object' ? body.deviceInfo : {};
        const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];

        if (!comment && !titleInput && !images.length) {
            return res.status(400).json({ error: 'Comment or screenshot is required.' });
        }

        const ticketId = makeFeedbackId();
        const timestamp = new Date().toISOString();
        const queueEntry = buildQueueEntry({ ticketId, timestamp, body, deviceInfo, images });

        try {
            await appendFeedbackQueue(c, queueEntry);
        } catch (queueErr) {
            console.error('[feedback] FEEDBACK_QUEUE.json append failed', queueErr.message || queueErr);
            if (queueErr.code === 'GITHUB_TOKEN_MISSING' || queueErr.status === 401 || queueErr.status === 403) {
                return res.status(500).json({ error: 'GitHub Token Missing', message: queueErr.message });
            }
            throw queueErr;
        }

        const issueTitle = `[Field Feedback] ${excerpt(titleInput || comment)}`;
        const issueBody = buildIssueBody({ ticketId, comment, titleInput, deviceInfo, images });

        let issue;
        try {
            issue = await githubRequest(`/repos/${c.owner}/${c.repo}/issues`, {
                method: 'POST',
                body: {
                    title: issueTitle.slice(0, 256),
                    body: issueBody,
                    labels: REVIEW_LABELS,
                },
            });
        } catch (ghErr) {
            console.error('[feedback] GitHub issue creation failed', ghErr.message || ghErr);
            if (ghErr.code === 'GITHUB_TOKEN_MISSING' || ghErr.status === 401 || ghErr.status === 403) {
                return res.status(500).json({ error: 'GitHub Token Missing', message: ghErr.message });
            }
            if (ghErr.status === 422) {
                return res.status(422).json({ error: 'GITHUB_VALIDATION', message: ghErr.message });
            }
            throw ghErr;
        }

        console.info('[feedback] issue created', issue.number, issue.html_url, 'ticket', ticketId);
        return res.status(200).json({
            ok: true,
            ticketId,
            issueNumber: issue.number,
            issueUrl: issue.html_url,
        });
    } catch (e) {
        console.error('[feedback] unhandled error', e);
        if (e.code === 'PAYLOAD_TOO_LARGE') {
            return res.status(413).json({
                error: 'Payload too large',
                message: 'Screenshot payload exceeds server limit. Client compression should reduce size.',
            });
        }
        return res.status(500).json({
            error: e.code || 'FEEDBACK_FAILED',
            message: e.message || String(e),
        });
    }
}

module.exports = handler;
