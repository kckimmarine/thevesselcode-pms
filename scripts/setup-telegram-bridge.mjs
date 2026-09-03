#!/usr/bin/env node
/**
 * Register Telegram webhook → app.thevesselcode.com/api/telegram/webhook
 * Reads deploy/.env.deploy.local (gitignored).
 *
 * Required in .env.deploy.local:
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ALLOWED_CHAT_IDS,
 *   GEMINI_API_KEY, GITHUB_TOKEN
 *
 * Also add the same keys to Vercel → Project → Environment Variables.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, 'deploy', '.env.deploy.local');
const APP_ORIGIN = (process.env.TVC_APP_ORIGIN || 'https://app.thevesselcode.com').replace(/\/+$/, '');

function loadEnv() {
    if (!existsSync(ENV_PATH)) {
        console.error(`Missing ${ENV_PATH}`);
        console.error('Copy deploy/.env.deploy.local.example and fill in values.');
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

async function main() {
    const env = loadEnv();
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.error('TELEGRAM_BOT_TOKEN is required in deploy/.env.deploy.local');
        process.exit(1);
    }

    let secret = env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) {
        secret = crypto.randomBytes(24).toString('hex');
        console.log('\nGenerated TELEGRAM_WEBHOOK_SECRET (add to .env.deploy.local and Vercel):');
        console.log(secret);
        console.log('');
    }

    const webhookUrl = `${APP_ORIGIN}/api/telegram/webhook`;
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: webhookUrl,
            secret_token: secret,
            allowed_updates: ['message', 'edited_message'],
            drop_pending_updates: true,
        }),
    });
    const data = await res.json();
    if (!data.ok) {
        console.error('setWebhook failed:', data);
        process.exit(1);
    }

    console.log('Webhook registered:', webhookUrl);
    console.log('Description:', data.description || 'OK');

    if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
        const [owner, repo] = (env.GITHUB_REPO || 'kckimmarine/thevesselcode-pms').split('/');
        const label = env.TELEGRAM_CURSOR_LABEL || 'cursor-agent';
        const gh = await fetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: label, color: '1d76db', description: 'Cursor Cloud auto-task from Telegram' }),
        });
        if (gh.ok) console.log(`GitHub label "${label}" created.`);
        else if (gh.status === 422) console.log(`GitHub label "${label}" already exists.`);
        else console.warn('GitHub label create:', gh.status, await gh.text());
    }

    console.log('\nNext:');
    console.log('1. Add all TELEGRAM_* / GEMINI_API_KEY / GITHUB_TOKEN to Vercel env');
    console.log('2. Deploy master to Vercel');
    console.log('3. Message your bot on Telegram (private chat)');
    console.log('4. cursor.com/automations → Issue comment or label "cursor-agent" trigger');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
