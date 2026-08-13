/* Verify license sign/verify round-trip for unbound + seat licenses */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';

const require = createRequire(import.meta.url);
const { SKUS } = require('../electron/sku.js');
const {
    verifySignature,
    canonicalPayloadForSign,
    canonicalPayloadLegacy,
} = require('../electron/license.js');

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
        console.error('FAIL unbound', sku, r.message);
        failed++;
        continue;
    }
    const payload = canonicalPayloadLegacy(lic);
    if (!payload.includes(sku)) {
        console.error('FAIL unbound', sku, 'payload missing sku');
        failed++;
        continue;
    }
    console.log('OK unbound', sku, lic.companyId, lic.vesselId || '(HQ)', 'exp', String(lic.expiresAt).slice(0, 10));
}

// Seat round-trip for one SKU
const seatSku = 'VESSEL_ENGINE';
const fakeMachine = 'a'.repeat(32);
const seatOut = path.join(root, 'build', 'licenses', seatSku, 'license-seat-verify.json');
const seatIssue = spawnSync(
    'node',
    ['scripts/issue-license.mjs', '--sku', seatSku, '--machine', fakeMachine, '--out', seatOut, '--months', '1'],
    { cwd: root, stdio: 'inherit', shell: true }
);
if (seatIssue.status !== 0) {
    console.error('FAIL seat issue');
    failed++;
} else {
    const seatLic = JSON.parse(fs.readFileSync(seatOut, 'utf8'));
    const sr = verifySignature(seatLic);
    const payload = canonicalPayloadForSign(seatLic);
    if (!sr.ok) {
        console.error('FAIL seat verify', sr.message);
        failed++;
    } else if (!payload.includes(fakeMachine) || !payload.includes('"seat":true')) {
        console.error('FAIL seat payload missing machineId/seat');
        failed++;
    } else if (seatLic.machineId !== fakeMachine) {
        console.error('FAIL seat machineId field');
        failed++;
    } else {
        console.log('OK seat', seatSku, 'machine', fakeMachine.slice(0, 8) + '…');
    }
}

if (failed) {
    console.error(failed, 'license verification failure(s)');
    process.exit(1);
}
console.log('All Pilot licenses verify OK (unbound + seat).');
