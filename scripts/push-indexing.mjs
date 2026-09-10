#!/usr/bin/env node
/**
 * Push IMPA store URLs to Google Indexing API in batches.
 *
 * Setup:
 * 1. Enable "Web Search Indexing API" in Google Cloud Console.
 * 2. Create a service account; download JSON key.
 * 3. Add the service account email as Owner in GSC (URL prefix property).
 * 4. Set GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON (raw JSON or base64) or
 *    GOOGLE_APPLICATION_CREDENTIALS (path to JSON file).
 *
 * Usage:
 *   npm run push:indexing -- --limit 200
 *   npm run push:indexing -- --dry-run --limit 10
 *   npm run push:indexing -- --force --limit 50
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { google } from 'googleapis';

const root = process.cwd();
const DEFAULT_LIMIT = 200;
const DEFAULT_ORIGIN = 'https://www.thevesselcode.com';
const STATE_PATH = join(root, '.data', 'google-indexing-state.json');
const INDEX_PATHS = [
    join(root, 'api', '_data', 'impa-seo-index.json'),
    join(root, 'public', 'data', 'impa-seo-index.json'),
];

function parseArgs(argv) {
    const args = {
        limit: DEFAULT_LIMIT,
        dryRun: false,
        force: false,
        resetState: false,
        type: 'URL_UPDATED',
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--dry-run') args.dryRun = true;
        else if (arg === '--force') args.force = true;
        else if (arg === '--reset-state') args.resetState = true;
        else if (arg === '--limit' && argv[i + 1]) {
            args.limit = Math.max(1, Number.parseInt(argv[++i], 10) || DEFAULT_LIMIT);
        } else if (arg === '--type' && argv[i + 1]) {
            const type = String(argv[++i]).toUpperCase();
            if (type === 'URL_UPDATED' || type === 'URL_DELETED') args.type = type;
        } else if (arg === '--help' || arg === '-h') {
            args.help = true;
        }
    }
    return args;
}

function printHelp() {
    console.log(`Usage: node scripts/push-indexing.mjs [options]

Options:
  --limit <n>       Max URLs to push this run (default: ${DEFAULT_LIMIT})
  --dry-run         Resolve queue only; do not call Google API
  --force           Re-push URLs even if already recorded in state
  --reset-state     Clear local push history before running
  --type <TYPE>     URL_UPDATED (default) or URL_DELETED
  --help            Show this help
`);
}

function storeOrigin() {
    return String(process.env.STORE_SEO_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');
}

function loadCatalogCodes() {
    const path = INDEX_PATHS.find((p) => existsSync(p));
    if (!path) {
        throw new Error('IMPA SEO index missing. Run npm run generate:impa-seo first.');
    }
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    return Object.keys(payload.items || {}).sort();
}

function loadState() {
    if (!existsSync(STATE_PATH)) {
        return { version: 1, pushed: {} };
    }
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
    mkdirSync(join(root, '.data'), { recursive: true });
    writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function loadServiceAccountCredentials() {
    const inline = String(process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON || '').trim();
    if (inline) {
        try {
            return JSON.parse(inline);
        } catch {
            return JSON.parse(Buffer.from(inline, 'base64').toString('utf8'));
        }
    }
    const credPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    if (credPath && existsSync(credPath)) {
        return JSON.parse(readFileSync(credPath, 'utf8'));
    }
    return null;
}

function buildQueue(codes, state, { limit, force, type }) {
    const origin = storeOrigin();
    const queue = [];
    for (const code of codes) {
        const url = `${origin}/store/${code}`;
        const key = `${type}:${url}`;
        if (!force && state.pushed[key]) continue;
        queue.push({ code, url, key });
        if (queue.length >= limit) break;
    }
    return queue;
}

async function createIndexingClient(credentials) {
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/indexing'],
    });
    return google.indexing({ version: 'v3', auth });
}

async function pushUrl(client, url, type) {
    const response = await client.urlNotifications.publish({
        requestBody: { url, type },
    });
    return response.data;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const codes = loadCatalogCodes();
    let state = loadState();
    if (args.resetState) {
        state = { version: 1, pushed: {} };
        saveState(state);
        console.log('Reset local indexing state.');
    }

    const queue = buildQueue(codes, state, args);
    console.log(`Catalog codes: ${codes.length}`);
    console.log(`Queue size: ${queue.length} (limit ${args.limit}, force=${args.force}, type=${args.type})`);

    if (!queue.length) {
        console.log('Nothing to push. All catalog URLs are already recorded in local state.');
        return;
    }

    if (args.dryRun) {
        queue.slice(0, 5).forEach(({ url }) => console.log('DRY RUN', url));
        if (queue.length > 5) console.log(`... and ${queue.length - 5} more`);
        return;
    }

    const credentials = loadServiceAccountCredentials();
    if (!credentials?.client_email || !credentials?.private_key) {
        console.error('Missing Google service account credentials.');
        console.error('Set GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.');
        process.exit(1);
    }

    const client = await createIndexingClient(credentials);
    let ok = 0;
    let failed = 0;

    for (const entry of queue) {
        try {
            await pushUrl(client, entry.url, args.type);
            state.pushed[entry.key] = {
                at: new Date().toISOString(),
                code: entry.code,
                type: args.type,
            };
            ok += 1;
            console.log('OK', entry.url);
        } catch (error) {
            failed += 1;
            const message = error?.response?.data?.error?.message || error.message || String(error);
            console.error('FAIL', entry.url, '—', message);
            if (/quota|rate|429|403/i.test(message)) {
                console.error('Stopping early due to quota/permission error.');
                break;
            }
        }
    }

    saveState(state);
    console.log(`\nIndexing push complete: ${ok} ok, ${failed} failed, ${Object.keys(state.pushed).length} recorded total.`);
    if (failed > 0) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
