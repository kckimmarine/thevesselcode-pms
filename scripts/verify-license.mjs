/* Verify license sign/verify round-trip for all SKUs */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';

const require = createRequire(import.meta.url);
const { SKUS } = require('../electron/sku.js');
const { verifySignature, canonicalPayloadForSign } = require('../electron/license.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

spawnSync('node', ['scripts/generate-license-keys.mjs'], { cwd: root, stdio: 'inherit', shell: true });
spawnSync('node', ['scripts/issue-license.mjs', '--all'], { cwd: root, stdio: 'inherit', shell: true });

let failed = 0;
for (const sku of Object.keys(SKUS)) {
    const file = path.join(root, 'build', 'licenses', sku, 'license.json');
    const lic = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r = verifySignature(lic);
    if (!r.ok) {
        console.error('FAIL', sku, r.message);
        failed++;
        continue;
    }
    const payload = canonicalPayloadForSign(lic);
    if (!payload.includes(sku)) {
        console.error('FAIL', sku, 'payload missing sku');
        failed++;
        continue;
    }
    console.log('OK', sku, lic.companyId, lic.vesselId || '(HQ)', 'exp', String(lic.expiresAt).slice(0, 10));
}

if (failed) {
    console.error(failed, 'license verification failure(s)');
    process.exit(1);
}
console.log('All Pilot licenses verify OK.');
