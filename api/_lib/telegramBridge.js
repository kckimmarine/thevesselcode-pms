'use strict';

/**
 * TVC Command Bridge — Telegram → Gemini (PM) → GitHub Issue → @cursor
 * Secrets (Vercel): TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ALLOWED_CHAT_IDS,
 * GEMINI_API_KEY, GITHUB_TOKEN, optional GITHUB_REPO, TELEGRAM_CURSOR_LABEL
 */

const DEFAULT_REPO = 'kckimmarine/thevesselcode-pms';
const DEFAULT_LABEL = 'cursor-agent';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

function config() {
    const allowedRaw = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').trim();
    const allowed = allowedRaw
        ? allowedRaw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
        : [];
    const [owner, repo] = String(process.env.GITHUB_REPO || DEFAULT_REPO).split('/');
    return {
        telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
        webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
        allowedChatIds: allowed,
        geminiKey: process.env.GEMINI_API_KEY || '',
        githubToken: process.env.GITHUB_TOKEN || '',
        githubOwner: owner || 'kckimmarine',
        githubRepo: repo || 'thevesselcode-pms',
        cursorLabel: process.env.TELEGRAM_CURSOR_LABEL || DEFAULT_LABEL,
        appOrigin: process.env.TVC_APP_ORIGIN || 'https://app.thevesselcode.com',
    };
}

function isReady() {
    const c = config();
    return !!(c.telegramToken && c.webhookSecret && c.allowedChatIds.length
        && c.geminiKey && c.githubToken);
}

function verifyWebhookSecret(req) {
    const c = config();
    const header = req.headers['x-telegram-bot-api-secret-token'];
    return header && header === c.webhookSecret;
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks);
    if (!raw.length) return {};
    return JSON.parse(raw.toString('utf8'));
}

async function sendTelegram(chatId, text, opts = {}) {
    const c = config();
    const res = await fetch(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: String(text).slice(0, 4000),
            disable_web_page_preview: opts.disablePreview !== false,
        }),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Telegram send failed ${res.status}: ${t}`);
    }
    return res.json();
}

const PM_SYSTEM = `You are the TVC-PMS project manager. The user is a non-developer CEO.
Convert their Korean/English request into a Cursor Cloud Agent task.

Project: kckimmarine/thevesselcode-pms (master), web HQ at app.thevesselcode.com.
Stack: offline-first SPA (index.html ~800 lines), js/config.js, js/auth.js (IndexedDB auth — never replace whole file),
Supabase sync, Vercel, Electron for ship PCs.

Rules:
- Never instruct replacing entire index.html or js/auth.js.
- Never commit .env, deploy/.env.local, package-lock.json.
- Prefer minimal targeted edits.

Reply with ONLY valid JSON (no markdown fences):
{
  "title": "short issue title in English",
  "summary_ko": "2-3 sentences in Korean for the CEO",
  "cursor_prompt": "detailed English instructions for Cursor agent including files hints and done criteria"
}`;

async function planWithGemini(userMessage) {
    const c = config();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(c.geminiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                role: 'user',
                parts: [{ text: `${PM_SYSTEM}\n\nUser request:\n${userMessage}` }],
            }],
            generationConfig: {
                temperature: 0.2,
                responseMimeType: 'application/json',
            },
        }),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Gemini failed ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(text);
    if (!parsed.title || !parsed.cursor_prompt) {
        throw new Error('Gemini returned incomplete JSON');
    }
    return parsed;
}

function fallbackPlan(userMessage) {
    const title = userMessage.trim().split(/\r?\n/)[0].slice(0, 80) || 'TVC task from Telegram';
    return {
        title,
        summary_ko: '요청을 GitHub Issue로 등록했습니다. Cursor가 작업을 시작합니다.',
        cursor_prompt: [
            'Repository: kckimmarine/thevesselcode-pms',
            'Branch: master',
            '',
            'Task from Telegram (CEO request):',
            userMessage.trim(),
            '',
            'Constraints: Do not replace entire index.html or js/auth.js.',
            'Do not commit .env, deploy/.env.local, or package-lock.json.',
            'Open a PR when done.',
        ].join('\n'),
    };
}

async function githubRequest(path, opts = {}) {
    const c = config();
    const res = await fetch(`https://api.github.com${path}`, {
        method: opts.method || 'GET',
        headers: {
            Authorization: `Bearer ${c.githubToken}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`GitHub ${path} ${res.status}: ${t.slice(0, 400)}`);
    }
    return res.status === 204 ? null : res.json();
}

async function createCursorIssue(plan, originalMessage) {
    const c = config();
    const body = [
        '@cursor',
        '',
        plan.cursor_prompt.trim(),
        '',
        '---',
        '_Submitted via TVC Telegram Command Bridge_',
        '',
        `**Original (CEO):** ${originalMessage.trim().slice(0, 2000)}`,
    ].join('\n');

    const labels = [c.cursorLabel];
    let issue;
    try {
        issue = await githubRequest(`/repos/${c.githubOwner}/${c.githubRepo}/issues`, {
            method: 'POST',
            body: { title: plan.title, body, labels },
        });
    } catch (e) {
        if (!String(e.message).includes('label')) throw e;
        issue = await githubRequest(`/repos/${c.githubOwner}/${c.githubRepo}/issues`, {
            method: 'POST',
            body: { title: plan.title, body },
        });
    }

    await githubRequest(`/repos/${c.githubOwner}/${c.githubRepo}/issues/${issue.number}/comments`, {
        method: 'POST',
        body: { body: `@cursor\n\n${plan.cursor_prompt.trim()}` },
    }).catch(() => { /* comment optional if Automations reads issue body */ });

    return issue;
}

function commandName(text) {
    const t = String(text || '').trim();
    if (!t.startsWith('/')) return '';
    return t.split(/\s+/)[0].split('@')[0].toLowerCase();
}

function isHealthCheckText(text) {
    const t = String(text || '').trim();
    const cmd = commandName(t);
    if (cmd === '/test' || cmd === '/ping') return true;
    const lower = t.toLowerCase();
    return lower === 'test' || lower === 'ping' || t === '테스트';
}

function healthCheckText() {
    const c = config();
    return [
        '✅ TVC Command Bridge 테스트 성공',
        '',
        isReady() ? '설정: OK' : '설정: 환경변수 부족',
        `Repo: ${c.githubOwner}/${c.githubRepo}`,
        `Label: ${c.cursorLabel}`,
        '',
        '실제 작업을 보내면 GitHub Issue → Cursor PR 로 진행됩니다.',
        '명령: /help /status /test',
    ].join('\n');
}

function helpText() {
    return [
        'TVC Command Bridge',
        '',
        '한국어로 작업을 적어 보내세요. 예:',
        '「웹 HQ tvc 로그인이 email 검증에 걸려」',
        '「SPARE 재고 마이너스 방지」',
        '',
        '흐름: Gemini 정리 → GitHub Issue → Cursor Cloud → PR',
        '',
        '명령: /help /status /test',
        '핑: 테스트 · test · ping  (Issue 없이 연결만 확인)',
    ].join('\n');
}

async function handleTelegramUpdate(update) {
    const msg = update?.message || update?.edited_message;
    if (!msg?.text || msg.chat?.type !== 'private') {
        return { skipped: true, reason: 'not_a_private_text_message' };
    }

    const c = config();
    const chatId = String(msg.chat.id);
    if (!c.allowedChatIds.includes(chatId)) {
        await sendTelegram(chatId, '이 봇은 등록된 계정만 사용할 수 있습니다.');
        return { skipped: true, reason: 'chat_not_allowed' };
    }

    const text = msg.text.trim();
    const cmd = commandName(text);
    if (text === '/start' || text === '/help' || cmd === '/start' || cmd === '/help') {
        await sendTelegram(chatId, helpText());
        return { ok: true, action: 'help' };
    }
    if (text === '/status' || cmd === '/status') {
        await sendTelegram(chatId, [
            'Bridge status:',
            isReady() ? '✅ configured' : '❌ missing Vercel env vars',
            `Repo: ${c.githubOwner}/${c.githubRepo}`,
            `Label: ${c.cursorLabel}`,
        ].join('\n'));
        return { ok: true, action: 'status' };
    }
    if (isHealthCheckText(text)) {
        await sendTelegram(chatId, healthCheckText());
        return { ok: true, action: 'healthcheck' };
    }

    await sendTelegram(chatId, '⏳ Gemini가 작업을 정리하고 GitHub Issue를 만듭니다…');

    let plan;
    try {
        plan = await planWithGemini(text);
    } catch (_) {
        plan = fallbackPlan(text);
    }

    const issue = await createCursorIssue(plan, text);
    const issueUrl = issue.html_url;

    await sendTelegram(chatId, [
        '✅ Cursor에게 작업을 전달했습니다.',
        '',
        plan.summary_ko || plan.title,
        '',
        `Issue #${issue.number}`,
        issueUrl,
        '',
        'Cursor Cloud가 PR을 만들면 GitHub에서 Merge 하세요.',
        '배포: app.thevesselcode.com (Merge 후 1~2분, Ctrl+Shift+R)',
    ].join('\n'));

    return { ok: true, issue_number: issue.number, issue_url: issueUrl };
}

module.exports = {
    config,
    isReady,
    verifyWebhookSecret,
    readJsonBody,
    handleTelegramUpdate,
    helpText,
    healthCheckText,
    isHealthCheckText,
    fallbackPlan,
    commandName,
};
