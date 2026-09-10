#!/usr/bin/env node
/**
 * Smoke test for push-indexing queue logic (no Google credentials required).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const statePath = join(root, '.data', 'google-indexing-state.json');

function run(label, args, { allowFail = false } = {}) {
    const result = spawnSync('node', args, { cwd: root, encoding: 'utf8' });
    if (!allowFail && result.status !== 0) {
        console.error(result.stdout);
        console.error(result.stderr);
        throw new Error(`${label} failed`);
    }
    return { output: `${result.stdout || ''}${result.stderr || ''}`, status: result.status ?? 1 };
}

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(ok ? 'OK' : 'FAIL', name, detail ? `— ${detail}` : '');
}

run('generate seo index', ['scripts/generate-impa-seo-index.mjs']);
if (existsSync(statePath)) rmSync(statePath);

const dryRun = run('push-indexing dry-run', ['scripts/push-indexing.mjs', '--dry-run', '--limit', '3']);
check('dry-run lists store urls', /DRY RUN https:\/\/www\.thevesselcode\.com\/store\//.test(dryRun.output));
check('dry-run respects limit', (dryRun.output.match(/DRY RUN /g) || []).length <= 3);

const missingCreds = run('push-indexing missing creds', ['scripts/push-indexing.mjs', '--limit', '1'], { allowFail: true });
check('missing credentials exits non-zero', missingCreds.status !== 0, String(missingCreds.status));
check('missing credentials message', /Missing Google service account credentials/.test(missingCreds.output));

const failed = results.filter((r) => !r.ok);
if (failed.length) {
    console.error('\nPush indexing tests FAILED:', failed.map((f) => f.name).join(', '));
    process.exit(1);
}
console.log('\nPush indexing tests passed.');
