'use strict';

const DEFAULT_REPO = 'kckimmarine/thevesselcode-pms';
const MAX_BODY_BYTES = 32 * 1024;

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

function contactRecipients() {
    const fromEnv = String(process.env.CONTACT_TO_EMAILS || '').trim();
    if (fromEnv) {
        return fromEnv.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [
        'ktechship@gmail.com',
        ['kckim', 'marine', 'gmail', 'com'].join('.').replace('.marine.', '.marine@'),
    ];
}

function contactFromAddress() {
    return String(process.env.CONTACT_FROM_EMAIL || 'THE VESSEL CODE <onboarding@resend.dev>').trim();
}

function isValidEmail(value) {
    const email = String(value || '').trim();
    if (!email || email.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function buildInquiryText(body) {
    return [
        `Inquiry Type: ${body.inquiryType}`,
        `Company: ${body.companyName}`,
        `Your Name: ${body.yourName}`,
        `Work Email: ${body.email}`,
        '',
        'Message:',
        body.message,
        '',
        `Submitted: ${new Date().toISOString()}`,
        `Source: ${body.source || 'about-contact'}`,
    ].join('\n');
}

async function sendViaResend(body) {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) return null;

    const to = contactRecipients();
    const subject = `[TVC Contact] ${body.inquiryType}`;
    const text = buildInquiryText(body);

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: contactFromAddress(),
            to,
            reply_to: body.email,
            subject,
            text,
        }),
    });

    if (!res.ok) {
        const detail = await res.text();
        const err = new Error(`Resend ${res.status}: ${detail.slice(0, 400)}`);
        err.code = 'RESEND_ERROR';
        err.status = res.status;
        throw err;
    }

    const data = await res.json();
    return { id: data.id, to };
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
            'User-Agent': 'TVC-Contact-Form',
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

async function sendViaGitHubIssue(body) {
    const c = githubConfig();
    const title = `[Contact] ${body.inquiryType} — ${body.companyName}`.slice(0, 256);
    const issue = await githubRequest(`/repos/${c.owner}/${c.repo}/issues`, {
        method: 'POST',
        body: {
            title,
            body: buildInquiryText(body),
        },
    });
    return { issueNumber: issue.number, issueUrl: issue.html_url };
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
        const raw = await readJsonBody(req);
        const body = {
            companyName: String(raw.companyName || '').trim(),
            yourName: String(raw.yourName || '').trim(),
            email: String(raw.email || '').trim(),
            inquiryType: String(raw.inquiryType || 'General Inquiries').trim(),
            message: String(raw.message || '').trim(),
            source: String(raw.source || 'about-contact').trim(),
        };

        if (!body.companyName || !body.yourName || !body.email || !body.message) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        if (!isValidEmail(body.email)) {
            return res.status(400).json({ error: 'Invalid work email address.' });
        }

        let delivery = null;
        let emailDebug = null;

        if (!String(process.env.RESEND_API_KEY || '').trim()) {
            emailDebug = 'RESEND_API_KEY is not set on this deployment.';
        } else {
            try {
                const emailResult = await sendViaResend(body);
                if (emailResult) {
                    delivery = { method: 'email', ...emailResult };
                }
            } catch (emailErr) {
                emailDebug = String(emailErr.message || emailErr).slice(0, 500);
                console.error('[contact] Resend failed', emailDebug);
                if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
                    throw emailErr;
                }
            }
        }

        if (!delivery) {
            const issueResult = await sendViaGitHubIssue(body);
            delivery = { method: 'github', ...issueResult };
            if (emailDebug) delivery.emailDebug = emailDebug;
        }

        console.info('[contact] delivered via', delivery.method, delivery.id || delivery.issueNumber);
        return res.status(200).json({ ok: true, delivery });
    } catch (e) {
        console.error('[contact] unhandled error', e);
        if (e.code === 'PAYLOAD_TOO_LARGE') {
            return res.status(413).json({ error: 'Payload too large' });
        }
        if (e.code === 'GITHUB_TOKEN_MISSING') {
            return res.status(503).json({
                error: 'CONTACT_NOT_CONFIGURED',
                message: 'Set RESEND_API_KEY on Vercel for email delivery.',
            });
        }
        return res.status(500).json({
            error: e.code || 'CONTACT_FAILED',
            message: e.message || String(e),
        });
    }
}

module.exports = handler;
