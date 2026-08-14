/* End-to-end seat license test helper (same PC as packaged app)
 * 1) machine ID + request JSON
 * 2) issue seat license
 * 3) verify signature
 *
 * Usage:
 *   node scripts/test-seat-activation-flow.mjs VESSEL_ENGINE
 *   node scripts/test-seat-activation-flow.mjs VESSEL_ENGINE --request path\to\exported.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getSku } = require('../electron/sku.js');
const { getMachineId, verifySignature, buildMachineRequest } = require('../electron/license.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function parseArgs(argv) {
    const out = { sku: 'VESSEL_ENGINE', request: null, months: 3 };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--request') out.request = argv[++i];
        else if (a === '--months') out.months = Number(argv[++i]) || 3;
        else if (!a.startsWith('-')) out.sku = a.toUpperCase();
    }
    return out;
}

const args = parseArgs(process.argv);
const def = getSku(args.sku);
if (!def) {
    console.error('Unknown SKU:', args.sku);
    process.exit(1);
}

spawnSync('node', ['scripts/generate-license-keys.mjs'], { cwd: root, stdio: 'inherit', shell: true });

const outDir = path.join(root, 'build', 'test-seat', args.sku);
fs.mkdirSync(outDir, { recursive: true });

let machineId;
let requestPath;

if (args.request) {
    requestPath = path.resolve(args.request);
    const req = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    if (req.kind !== 'TVC_MACHINE_REQUEST' || !req.machineId) {
        console.error('Invalid machine request file:', requestPath);
        process.exit(1);
    }
    machineId = String(req.machineId);
    if (req.sku && req.sku !== args.sku) {
        console.warn(`Warning: request SKU=${req.sku}, using CLI SKU=${args.sku}`);
    }
} else {
    machineId = getMachineId();
    const mockApp = {
        getPath: () => outDir,
        getAppPath: () => root,
    };
    process.env.TVC_BUILD_SKU = args.sku;
    const req = buildMachineRequest(mockApp);
    requestPath = path.join(outDir, `${args.sku.toLowerCase()}_machine_request_${machineId.slice(0, 8)}.json`);
    fs.writeFileSync(requestPath, JSON.stringify(req, null, 2));
}

const licensePath = path.join(outDir, `license-seat-${machineId.slice(0, 8)}.json`);
const issue = spawnSync(
    'node',
    [
        'scripts/issue-license.mjs',
        '--request', requestPath,
        '--sku', args.sku,
        '--out', licensePath,
        '--months', String(args.months),
    ],
    { cwd: root, stdio: 'inherit', shell: true }
);
if (issue.status !== 0) process.exit(issue.status || 1);

const lic = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
const sig = verifySignature(lic);
if (!sig.ok) {
    console.error('Signature verify failed:', sig.message);
    process.exit(1);
}

console.log('\n=== Seat license test artifacts ===');
console.log('SKU:        ', args.sku, `(${def.label})`);
console.log('Machine ID: ', machineId);
console.log('Request:    ', requestPath);
console.log('License:    ', licensePath);
console.log('Expires:    ', String(lic.expiresAt).slice(0, 10));
console.log('\nNext (packaged app on THIS PC):');
console.log('  1. Run Setup or dist win-unpacked exe → activation gate');
console.log('  2. Export machine request (optional — file above matches this PC)');
console.log('  3. Import seat license → select:', licensePath);
console.log('');
