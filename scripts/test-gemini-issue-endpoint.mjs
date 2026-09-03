#!/usr/bin/env node
/**
 * Offline test for the Gemini → GitHub Issue webhook.
 * Exercises the issue builder, the GitHub API call (mocked fetch), and the
 * HTTP handler (mock req/res) across success and error paths. No network.
 *
 * Usage: node scripts/test-gemini-issue-endpoint.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const lib = require(path.join(ROOT, 'api/_lib/githubIssues.js'));

let passed = 0;
let failed = 0;
function assert(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  \u2705 ${name}`); }
    else { failed++; console.error(`  \u274c ${name}${detail ? ' \u2014 ' + detail : ''}`); }
}

// ── mock helpers ─────────────────────────────────────────────────────
function mockReq({ method = 'POST', headers = {}, body = '' } = {}) {
    const lowerHeaders = {};
    for (const [k, v] of Object.entries(headers)) lowerHeaders[k.toLowerCase()] = v;
    const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    return {
        method,
        headers: lowerHeaders,
        async *[Symbol.asyncIterator]() { yield buf; },
    };
}

function mockRes() {
    return {
        statusCode: null,
        payload: null,
        headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.payload = obj; return this; },
    };
}

function mockFetch(captured, response) {
    return async (url, options) => {
        captured.url = url;
        captured.options = options;
        captured.bodyParsed = options?.body ? JSON.parse(options.body) : null;
        return {
            ok: response.ok !== false,
            status: response.status || 201,
            async json() { return response.json; },
        };
    };
}

// ── 1. buildIssueFromInstruction ─────────────────────────────────────
console.log('\n\u2550\u2550\u2550 1. Issue builder \u2550\u2550\u2550\n');
{
    const issue = lib.buildIssueFromInstruction({
        title: 'Fix login field',
        description: 'User ID should be text, not email.',
        tasks: ['Edit config.js', 'Test on web'],
        acceptance_criteria: ['tvc logs in without email validation'],
        labels: ['bug', 'web'],
        assignees: ['octocat'],
    });
    assert('title preserved', issue.title === 'Fix login field');
    assert('cursor-agent label always first', issue.labels[0] === 'cursor-agent');
    assert('extra labels kept', issue.labels.includes('bug') && issue.labels.includes('web'));
    assert('tasks rendered as checklist', issue.body.includes('- [ ] Edit config.js'));
    assert('acceptance rendered', issue.body.includes('- [ ] tvc logs in without email validation'));
    assert('assignees passed', Array.isArray(issue.assignees) && issue.assignees[0] === 'octocat');
    assert('provenance JSON block appended', issue.body.includes('Original instruction (JSON)') && issue.body.includes('```json'));
}
{
    // Envelope unwrap + label dedupe (case-insensitive) + explicit body.
    const issue = lib.buildIssueFromInstruction({
        instruction: {
            summary: 'Wrapped task',
            body: 'Explicit body text.',
            labels: ['Cursor-Agent', 'enhancement'],
        },
    });
    assert('unwraps "instruction" envelope', issue.title === 'Wrapped task');
    assert('explicit body used', issue.body.startsWith('Explicit body text.'));
    assert('label dedupe (case-insensitive)', issue.labels.filter((l) => l.toLowerCase() === 'cursor-agent').length === 1);
}
{
    let threw = false;
    try { lib.buildIssueFromInstruction({ description: 'no title' }); }
    catch (e) { threw = e.code === 'BAD_REQUEST'; }
    assert('missing title -> BAD_REQUEST', threw);

    let threw2 = false;
    try { lib.buildIssueFromInstruction('not an object'); }
    catch (e) { threw2 = e.code === 'BAD_REQUEST'; }
    assert('non-object payload -> BAD_REQUEST', threw2);
}

// ── 2. createGitHubIssue (mock fetch) ────────────────────────────────
console.log('\n\u2550\u2550\u2550 2. createGitHubIssue (mocked GitHub API) \u2550\u2550\u2550\n');
{
    const captured = {};
    const fetchImpl = mockFetch(captured, {
        ok: true,
        status: 201,
        json: { number: 42, url: 'https://api.github.com/repos/acme/pms/issues/42', html_url: 'https://github.com/acme/pms/issues/42' },
    });
    const result = await lib.createGitHubIssue(
        { title: 'Do the thing', tasks: ['a', 'b'] },
        { fetchImpl, config: { token: 'tok_123', repo: 'acme/pms', apiBase: 'https://api.github.com' } },
    );
    assert('POST to correct issues URL', captured.url === 'https://api.github.com/repos/acme/pms/issues');
    assert('method POST', captured.options.method === 'POST');
    assert('Authorization bearer header', captured.options.headers.Authorization === 'Bearer tok_123');
    assert('GitHub API version header', captured.options.headers['X-GitHub-Api-Version'] === '2022-11-28');
    assert('request body carries cursor-agent label', captured.bodyParsed.labels.includes('cursor-agent'));
    assert('returns issue_number', result.issue_number === 42);
    assert('returns html_url', result.html_url === 'https://github.com/acme/pms/issues/42');
    assert('ok true', result.ok === true);
}
{
    // GitHub rejects (e.g. bad label / auth) -> GITHUB_ERROR
    const captured = {};
    const fetchImpl = mockFetch(captured, { ok: false, status: 422, json: { message: 'Validation Failed' } });
    let code = null;
    try {
        await lib.createGitHubIssue({ title: 'x' }, { fetchImpl, config: { token: 't', repo: 'a/b' } });
    } catch (e) { code = e.code; }
    assert('GitHub non-2xx -> GITHUB_ERROR', code === 'GITHUB_ERROR');
}
{
    // Missing config -> NOT_CONFIGURED
    let code = null;
    try {
        await lib.createGitHubIssue({ title: 'x' }, { fetchImpl: async () => ({}), config: { token: '', repo: '' } });
    } catch (e) { code = e.code; }
    assert('missing config -> NOT_CONFIGURED', code === 'NOT_CONFIGURED');
}

// ── 3. HTTP handler (mock req/res) ───────────────────────────────────
console.log('\n\u2550\u2550\u2550 3. HTTP handler \u2550\u2550\u2550\n');
const handlerPath = path.join(ROOT, 'api/gemini/create-issue.js');

function loadFreshHandler() {
    delete require.cache[require.resolve(handlerPath)];
    delete require.cache[require.resolve(path.join(ROOT, 'api/_lib/githubIssues.js'))];
    return require(handlerPath);
}

const savedEnv = { ...process.env };
const savedFetch = globalThis.fetch;
function resetEnv() {
    delete process.env.GITHUB_ISSUE_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_ISSUE_REPO;
    delete process.env.GITHUB_REPO;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GEMINI_ISSUE_WEBHOOK_SECRET;
    delete process.env.GEMINI_WEBHOOK_SECRET;
}

// 3a. 405 for non-POST
{
    resetEnv();
    const handler = loadFreshHandler();
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    assert('GET -> 405', res.statusCode === 405, `got ${res.statusCode}`);
}

// 3b. 501 when GitHub not configured
{
    resetEnv();
    process.env.GEMINI_ISSUE_WEBHOOK_SECRET = 'shh';
    const handler = loadFreshHandler();
    const res = mockRes();
    await handler(mockReq({ headers: { authorization: 'Bearer shh' }, body: { title: 't' } }), res);
    assert('no GitHub config -> 501', res.statusCode === 501, `got ${res.statusCode}`);
}

// 3c. 401 on bad secret
{
    resetEnv();
    process.env.GITHUB_ISSUE_TOKEN = 'tok';
    process.env.GITHUB_ISSUE_REPO = 'acme/pms';
    process.env.GEMINI_ISSUE_WEBHOOK_SECRET = 'shh';
    const handler = loadFreshHandler();
    const res = mockRes();
    await handler(mockReq({ headers: { authorization: 'Bearer WRONG' }, body: { title: 't' } }), res);
    assert('wrong secret -> 401', res.statusCode === 401, `got ${res.statusCode}`);
}

// 3d. 400 on invalid JSON
{
    resetEnv();
    process.env.GITHUB_ISSUE_TOKEN = 'tok';
    process.env.GITHUB_ISSUE_REPO = 'acme/pms';
    process.env.GEMINI_ISSUE_WEBHOOK_SECRET = 'shh';
    const handler = loadFreshHandler();
    const res = mockRes();
    await handler(mockReq({ headers: { authorization: 'Bearer shh' }, body: '{ not json' }), res);
    assert('invalid JSON -> 400', res.statusCode === 400, `got ${res.statusCode}`);
}

// 3e. 201 happy path (global fetch mocked)
{
    resetEnv();
    process.env.GITHUB_ISSUE_TOKEN = 'tok';
    process.env.GITHUB_ISSUE_REPO = 'acme/pms';
    process.env.GEMINI_ISSUE_WEBHOOK_SECRET = 'shh';
    const captured = {};
    globalThis.fetch = mockFetch(captured, {
        ok: true,
        status: 201,
        json: { number: 7, url: 'https://api.github.com/repos/acme/pms/issues/7', html_url: 'https://github.com/acme/pms/issues/7' },
    });
    const handler = loadFreshHandler();
    const res = mockRes();
    await handler(mockReq({
        headers: { authorization: 'Bearer shh', 'content-type': 'application/json' },
        body: { title: 'Gemini task', description: 'Do X', tasks: ['step 1'], labels: ['enhancement'] },
    }), res);
    assert('happy path -> 201', res.statusCode === 201, `got ${res.statusCode}`);
    assert('response has issue_number', res.payload?.issue_number === 7);
    assert('response labels include cursor-agent', Array.isArray(res.payload?.labels) && res.payload.labels.includes('cursor-agent'));
    assert('GitHub called with owner/repo path', captured.url === 'https://api.github.com/repos/acme/pms/issues');
    assert('sent labels include cursor-agent + enhancement', captured.bodyParsed.labels.includes('cursor-agent') && captured.bodyParsed.labels.includes('enhancement'));
}

// restore
globalThis.fetch = savedFetch;
process.env = savedEnv;

console.log(`\n\u2550\u2550\u2550 Result: ${passed} passed, ${failed} failed \u2550\u2550\u2550\n`);
process.exit(failed > 0 ? 1 : 0);
