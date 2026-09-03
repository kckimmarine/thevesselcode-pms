#!/usr/bin/env node
/**
 * Push the Telegram Command Bridge secrets to Vercel (Production + Preview) and
 * trigger a redeploy of master. Reads deploy/.env.deploy.local (gitignored).
 *
 * Required in .env.deploy.local:
 *   VERCEL_TOKEN
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ALLOWED_CHAT_IDS,
 *   GEMINI_API_KEY, GITHUB_TOKEN, GITHUB_REPO
 * Optional:
 *   VERCEL_PROJECT_ID (auto-resolved by project name when blank)
 *   VERCEL_PROJECT_NAME (default: thevesselcode-pms)
 *   VERCEL_GIT_REF (default: master)
 *
 * Values are read from the env file only — never passed on the command line.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'deploy', '.env.deploy.local');
const PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || 'thevesselcode-pms';

// Vars mirrored to Vercel. isReady() in api/_lib/telegramBridge.js needs the
// first five; GITHUB_REPO + label are included for completeness.
const KEYS = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_WEBHOOK_SECRET',
    'TELEGRAM_ALLOWED_CHAT_IDS',
    'GEMINI_API_KEY',
    'GITHUB_TOKEN',
    'GITHUB_REPO',
    'TELEGRAM_CURSOR_LABEL',
];

function loadEnv() {
    if (!existsSync(ENV_PATH)) {
        console.error(`Missing ${ENV_PATH} — copy deploy/.env.deploy.local.example and fill it in.`);
        process.exit(1);
    }
    const out = {};
    for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 1) continue;
        out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
}

async function vercel(token, urlPath, { method = 'GET', body, teamId } = {}) {
    const url = new URL(`https://api.vercel.com${urlPath}`);
    if (teamId) url.searchParams.set('teamId', teamId);
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, json };
}

async function resolveProject(token, name) {
    // Personal scope first.
    let r = await vercel(token, `/v9/projects/${encodeURIComponent(name)}`);
    if (r.ok && r.json?.id) return { id: r.json.id, teamId: null };

    // Then any accessible team.
    const teamsRes = await vercel(token, '/v2/teams');
    const teams = teamsRes.json?.teams || [];
    for (const t of teams) {
        r = await vercel(token, `/v9/projects/${encodeURIComponent(name)}`, { teamId: t.id });
        if (r.ok && r.json?.id) return { id: r.json.id, teamId: t.id };
    }
    throw new Error(`Vercel project "${name}" not found for this token (checked personal + ${teams.length} team(s)).`);
}

async function upsertEnv(token, projectId, teamId, key, value) {
    const existing = await vercel(token, `/v9/projects/${projectId}/env`, { teamId });
    const rows = existing.json?.envs || [];
    for (const row of rows.filter((r) => r.key === key && r.id)) {
        await vercel(token, `/v9/projects/${projectId}/env/${row.id}`, { method: 'DELETE', teamId });
    }
    const res = await vercel(token, `/v10/projects/${projectId}/env`, {
        method: 'POST',
        teamId,
        body: { key, value, type: 'encrypted', target: ['production', 'preview'] },
    });
    if (!res.ok) throw new Error(`Set ${key} failed: HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
}

async function main() {
    const env = loadEnv();
    const token = env.VERCEL_TOKEN;
    if (!token) throw new Error('VERCEL_TOKEN required in deploy/.env.deploy.local');

    const missing = KEYS.filter((k) => k !== 'TELEGRAM_CURSOR_LABEL' && !env[k]);
    if (missing.length) throw new Error(`Missing in .env.deploy.local: ${missing.join(', ')}`);

    let projectId = env.VERCEL_PROJECT_ID;
    let teamId = env.VERCEL_TEAM_ID || null;
    if (!projectId) {
        const resolved = await resolveProject(token, PROJECT_NAME);
        projectId = resolved.id;
        teamId = resolved.teamId;
        console.log(`Resolved project "${PROJECT_NAME}" -> ${projectId}${teamId ? ` (team ${teamId})` : ' (personal)'}`);
    }

    console.log('Setting Vercel environment variables (production + preview)...');
    for (const key of KEYS) {
        if (!env[key]) continue;
        await upsertEnv(token, projectId, teamId, key, env[key]);
        console.log(`  OK ${key}`);
    }

    console.log('Triggering redeploy of master...');
    const ref = env.VERCEL_GIT_REF || 'master';
    // The v13 deployments API requires the numeric repoId from the project's git link.
    const detail = await vercel(token, `/v9/projects/${projectId}`, { teamId });
    const link = detail.json?.link || {};
    const gitSource = link.repoId
        ? { type: link.type || 'github', repoId: link.repoId, ref }
        : { type: 'github', repo: env.VERCEL_GIT_REPO || env.GITHUB_REPO || 'kckimmarine/thevesselcode-pms', ref };
    const dep = await vercel(token, '/v13/deployments', {
        method: 'POST',
        teamId,
        body: {
            name: PROJECT_NAME,
            project: projectId,
            target: 'production',
            gitSource,
        },
    });
    if (dep.ok) {
        console.log(`  Redeploy started: ${dep.json?.url || dep.json?.id || 'ok'}`);
    } else {
        console.warn(`  Redeploy API returned HTTP ${dep.status}: ${JSON.stringify(dep.json).slice(0, 200)}`);
        console.warn('  Fallback: Vercel Dashboard -> thevesselcode-pms -> Deployments -> Redeploy (master).');
    }

    console.log('\nDone. The webhook should flip from 501 (NOT_CONFIGURED) to 401 once the deploy is live.');
}

main().catch((e) => { console.error(e.message || String(e)); process.exit(1); });
