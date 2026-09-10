#!/usr/bin/env node
/**
 * Offline checks for the Telegram Command Bridge.
 * Does not call Telegram, Gemini, or GitHub — fetch is mocked.
 */
import { createRequire } from 'module';
import { createServer } from 'node:http';

const require = createRequire(import.meta.url);

process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.TELEGRAM_ALLOWED_CHAT_IDS = '111,222';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GITHUB_TOKEN = 'test-github-token';
process.env.GITHUB_REPO = 'kckimmarine/thevesselcode-pms';
process.env.TELEGRAM_CURSOR_LABEL = 'cursor-agent';

const bridge = require('../api/_lib/telegramBridge.js');
const webhook = require('../api/telegram/webhook.js');

let failed = 0;
function check(name, cond, detail) {
    if (cond) {
        console.log('OK', name);
        return;
    }
    failed++;
    console.error('FAIL', name, detail || '');
}

check('isReady', bridge.isReady() === true);
check('help mentions /test', bridge.helpText().includes('/test'));
check('help mentions ping', bridge.helpText().includes('테스트'));

check('commandName /help@bot', bridge.commandName('/help@TvcBot') === '/help');
check('commandName /test', bridge.commandName('/test') === '/test');
check('commandName bare text', bridge.commandName('테스트') === '');

const pings = ['/test', '/ping', '/test@TvcBot', 'test', 'TEST', 'ping', '테스트'];
for (const t of pings) {
    check(`isHealthCheck ${JSON.stringify(t)}`, bridge.isHealthCheckText(t) === true);
}
const notPings = ['테스트 해줘', '로그인 테스트', '/status', 'SPARE 재고', ''];
for (const t of notPings) {
    check(`not healthcheck ${JSON.stringify(t)}`, bridge.isHealthCheckText(t) === false);
}

const plan = bridge.fallbackPlan('테스트');
check('fallback title', plan.title === '테스트');
check('fallback has index.html constraint', plan.cursor_prompt.includes('index.html'));
check('fallback has auth.js constraint', plan.cursor_prompt.includes('js/auth.js'));
check('fallback has lockfile constraint', plan.cursor_prompt.includes('package-lock.json'));
check('fallback asks for PR', plan.cursor_prompt.includes('Open a PR'));

check(
    'verifyWebhookSecret ok',
    bridge.verifyWebhookSecret({ headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret' } }) === true
);
check(
    'verifyWebhookSecret bad',
    !bridge.verifyWebhookSecret({ headers: { 'x-telegram-bot-api-secret-token': 'nope' } })
);

const fetchCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    fetchCalls.push({ url: u, method: opts.method || 'GET', body: opts.body || null });
    if (u.includes('api.telegram.org')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' };
    }
    if (u.includes('generativelanguage.googleapis.com')) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'gemini down' };
    }
    if (u.includes('/issues') && !u.includes('/comments')) {
        return {
            ok: true,
            status: 201,
            json: async () => ({
                number: 99,
                html_url: 'https://github.com/kckimmarine/thevesselcode-pms/issues/99',
            }),
            text: async () => '',
        };
    }
    return { ok: true, status: 201, json: async () => ({ id: 1 }), text: async () => '' };
};

function privateMsg(text, chatId = '111') {
    return { message: { text, chat: { id: chatId, type: 'private' } } };
}

const skipGroup = await bridge.handleTelegramUpdate({
    message: { text: '테스트', chat: { id: '111', type: 'group' } },
});
check('skip group chats', skipGroup.skipped === true && skipGroup.reason === 'not_a_private_text_message');

fetchCalls.length = 0;
const denied = await bridge.handleTelegramUpdate(privateMsg('테스트', '999'));
check('deny unknown chat', denied.skipped === true && denied.reason === 'chat_not_allowed');
check('deny sent telegram', fetchCalls.some((c) => c.url.includes('api.telegram.org')));

fetchCalls.length = 0;
const help = await bridge.handleTelegramUpdate(privateMsg('/help@TvcBot'));
check('help action', help.ok === true && help.action === 'help');
check('help did not hit github', !fetchCalls.some((c) => c.url.includes('api.github.com')));

fetchCalls.length = 0;
const ping = await bridge.handleTelegramUpdate(privateMsg('테스트'));
check('CEO 테스트 is healthcheck', ping.ok === true && ping.action === 'healthcheck');
check('ping has no issue', ping.issue_number == null);
check('ping did not hit github', !fetchCalls.some((c) => c.url.includes('api.github.com')));
check('ping did not hit gemini', !fetchCalls.some((c) => c.url.includes('generativelanguage')));
const pingBody = JSON.parse(fetchCalls.find((c) => c.url.includes('sendMessage')).body);
check('ping reply text', String(pingBody.text).includes('테스트 성공'));

fetchCalls.length = 0;
const slashTest = await bridge.handleTelegramUpdate(privateMsg('/test'));
check('/test healthcheck', slashTest.action === 'healthcheck');

fetchCalls.length = 0;
const work = await bridge.handleTelegramUpdate(privateMsg('SPARE 재고 마이너스 방지'));
check('real task creates issue', work.ok === true && work.issue_number === 99);
check('real task hit github issues', fetchCalls.some((c) => c.url.includes('/issues') && !c.url.includes('/comments')));
const issuePost = fetchCalls.find((c) => c.url.includes('/issues') && !c.url.includes('/comments'));
const issueBody = JSON.parse(issuePost.body);
check('issue has cursor-agent label', Array.isArray(issueBody.labels) && issueBody.labels.includes('cursor-agent'));
check('issue body mentions CEO text', String(issueBody.body).includes('SPARE 재고 마이너스 방지'));
check('issue body has @cursor', String(issueBody.body).includes('@cursor'));

async function runWebhook(method, headers, body) {
    const req = {
        method,
        headers: headers || {},
        async *[Symbol.asyncIterator]() {
            if (body != null) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        },
    };
    let status = 0;
    let payload = null;
    const res = {
        setHeader() {},
        status(code) {
            status = code;
            return this;
        },
        json(obj) {
            payload = obj;
            return obj;
        },
    };
    await webhook(req, res);
    return { status, payload };
}

const m405 = await runWebhook('GET', {}, null);
check('webhook GET 405', m405.status === 405);

const m401 = await runWebhook('POST', { 'x-telegram-bot-api-secret-token': 'wrong' }, { update_id: 1 });
check('webhook bad secret 401', m401.status === 401);

fetchCalls.length = 0;
const m200 = await runWebhook(
    'POST',
    { 'x-telegram-bot-api-secret-token': 'test-webhook-secret' },
    { message: { text: '테스트', chat: { id: 111, type: 'private' } } }
);
check('webhook ping 200', m200.status === 200 && m200.payload?.ok === true && m200.payload?.action === 'healthcheck');

const origReadyEnv = process.env.TELEGRAM_BOT_TOKEN;
process.env.TELEGRAM_BOT_TOKEN = '';
const m501 = await runWebhook('POST', { 'x-telegram-bot-api-secret-token': 'test-webhook-secret' }, {});
check('webhook unconfigured 501', m501.status === 501 && m501.payload?.error === 'NOT_CONFIGURED');
process.env.TELEGRAM_BOT_TOKEN = origReadyEnv;

// Live HTTP round-trip against the handler (still mocked upstream APIs).
await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
        const vres = {
            setHeader(k, v) { res.setHeader(k, v); },
            status(code) { res.statusCode = code; return this; },
            json(obj) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(obj));
                return obj;
            },
        };
        webhook(req, vres).catch((e) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
        });
    });
    server.listen(0, '127.0.0.1', async () => {
        try {
            const { port } = server.address();
            const res = await originalFetch(`http://127.0.0.1:${port}/api/telegram/webhook`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-telegram-bot-api-secret-token': 'test-webhook-secret',
                },
                body: JSON.stringify({
                    message: { text: '/test', chat: { id: 111, type: 'private' } },
                }),
            });
            const json = await res.json();
            check('http ping 200', res.status === 200 && json.action === 'healthcheck');
            server.close();
            resolve();
        } catch (e) {
            server.close();
            reject(e);
        }
    });
});

globalThis.fetch = originalFetch;

if (failed) {
    console.error(failed, 'telegram bridge check(s) failed');
    process.exit(1);
}
console.log('All Telegram Command Bridge offline checks passed.');
