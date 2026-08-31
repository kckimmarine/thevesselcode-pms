#!/usr/bin/env node
/**
 * Purge online-sync packages for a vessel (customer deletion request).
 * Uses deploy/.env.deploy.local (SUPABASE_*). Default: dry-run.
 *
 *   npm run purge-vessel-sync -- --vessel "TVC No1" --company TVC
 *   npm run purge-vessel-sync -- --vessel "TVC No1" --company TVC --execute --reason "Customer request" --by "TVC Admin"
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function loadEnv() {
    const envPath = path.join(ROOT, 'deploy', '.env.deploy.local');
    if (!existsSync(envPath)) throw new Error('Missing deploy/.env.deploy.local');
    const out = {};
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('=');
        if (i < 1) continue;
        out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
}

function parseArgs(argv) {
    const out = { dryRun: true };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--vessel') out.vessel = argv[++i];
        else if (a === '--company') out.company = argv[++i];
        else if (a === '--execute') out.dryRun = false;
        else if (a === '--dry-run') out.dryRun = true;
        else if (a === '--reason') out.reason = argv[++i];
        else if (a === '--by') out.requestedBy = argv[++i];
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.vessel) {
        console.error('Usage: npm run purge-vessel-sync -- --vessel "TVC No1" [--company TVC] [--execute --reason "…" --by "…"]');
        process.exit(1);
    }

    const env = loadEnv();
    process.env.SUPABASE_URL = env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SYNC_PILOT_VESSEL_ID;

    const { purgeVesselSyncPackages } = require(path.join(ROOT, 'api', '_lib', 'syncStorage.js'));

    const result = await purgeVesselSyncPackages({
        vesselId: args.vessel,
        companyId: args.company,
        dryRun: args.dryRun,
        reason: args.reason || '',
        requestedBy: args.requestedBy || '',
    });

    console.log(JSON.stringify(result, null, 2));
    if (result.dry_run) {
        console.log('\nDry-run only. Re-run with --execute --reason "…" --by "…" to delete.');
    }
}

main().catch(e => {
    console.error(e.message || e);
    process.exit(1);
});
