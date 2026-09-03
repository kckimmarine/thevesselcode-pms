#!/usr/bin/env node
/** Poll Telegram getUpdates to find your chat id after you message the bot. */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ENV_PATH = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'deploy', '.env.deploy.local');

function loadToken() {
    if (!existsSync(ENV_PATH)) throw new Error('Missing deploy/.env.deploy.local');
    for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (t.startsWith('TELEGRAM_BOT_TOKEN=')) return t.slice('TELEGRAM_BOT_TOKEN='.length).trim();
    }
    throw new Error('TELEGRAM_BOT_TOKEN not in deploy/.env.deploy.local');
}

const token = loadToken();
const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const data = await res.json();
if (!data.ok) {
    console.error(data);
    process.exit(1);
}
const chats = new Map();
for (const u of data.result || []) {
    const c = u.message?.chat || u.edited_message?.chat;
    if (c) chats.set(c.id, c);
}
if (!chats.size) {
    console.log('No messages yet. Open Telegram, find your bot, send /start, then run again.');
    process.exit(0);
}
console.log('Allowed chat IDs (put in TELEGRAM_ALLOWED_CHAT_IDS):');
for (const [id, c] of chats) {
    console.log(`  ${id}  (${c.username || c.first_name || 'user'})`);
}
