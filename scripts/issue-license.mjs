/* Issue signed Pilot / seat license JSON for a SKU */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { SKUS, getSku } = require('../electron/sku.js');
const { canonicalPayloadForSign } = require('../electron/license.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const privPath = process.env.TVC_LICENSE_PRIVATE_KEY
    || path.join(root, 'electron', 'keys', 'private.pem');

function parseArgs(argv) {
    const out = {
        sku: null,
        out: null,
        months: 3,
        all: false,
        machine: null,
        request: null,
        unbound: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--all') out.all = true;
        else if (a === '--sku') out.sku = argv[++i];
        else if (a === '--out') out.out = argv[++i];
        else if (a === '--months') out.months = Number(argv[++i]) || 3;
        else if (a === '--machine') out.machine = argv[++i];
        else if (a === '--request') out.request = argv[++i];
        else if (a === '--unbound') out.unbound = true;
    }
    return out;
}

function signLicense(lic, privateKeyPem) {
    const key = crypto.createPrivateKey(privateKeyPem);
    const mid = lic.machineId == null || lic.machineId === '' ? null : String(lic.machineId);
    const unsigned = {
        ...lic,
        machineId: mid,
        seat: !!mid,
    };
    const sig = crypto.sign(null, Buffer.from(canonicalPayloadForSign(unsigned), 'utf8'), key);
    return {
        ...unsigned,
        signature: sig.toString('base64'),
    };
}

function buildLicense(skuKey, months, machineId) {
    const def = getSku(skuKey);
    if (!def) throw new Error(`Unknown SKU: ${skuKey}`);
    const issuedAt = new Date().toISOString();
    const exp = new Date();
    exp.setMonth(exp.getMonth() + months);
    const mid = machineId == null || machineId === '' ? null : String(machineId).trim();
    return {
        companyId: def.companyId,
        vesselId: def.vesselId,
        sku: def.sku,
        allowedVesselIds: def.allowedVesselIds || (def.vesselId ? [def.vesselId] : null),
        issuedAt,
        expiresAt: exp.toISOString(),
        machineId: mid,
        seat: !!mid,
    };
}

function loadRequest(file) {
    const abs = path.resolve(file);
    const req = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!req || req.kind !== 'TVC_MACHINE_REQUEST' || !req.machineId) {
        throw new Error(`Invalid machine request file: ${abs}`);
    }
    return req;
}

function issueOne(skuKey, months, outPath, machineId) {
    if (!fs.existsSync(privPath)) {
        throw new Error(`Private key not found: ${privPath}\nRun: npm run license:keys`);
    }
    const priv = fs.readFileSync(privPath, 'utf8');
    const unsigned = buildLicense(skuKey, months, machineId);
    const signed = signLicense(unsigned, priv);
    const dir = outPath
        ? path.dirname(path.resolve(outPath))
        : path.join(root, 'build', 'licenses', skuKey);
    fs.mkdirSync(dir, { recursive: true });
    const file = outPath
        ? path.resolve(outPath)
        : path.join(dir, 'license.json');
    fs.writeFileSync(file, JSON.stringify(signed, null, 2));
    const mode = signed.machineId ? `seat:${signed.machineId}` : 'unbound(dev)';
    console.log('Issued', skuKey, mode, '→', file);
    return file;
}

const args = parseArgs(process.argv);

if (args.request) {
    const req = loadRequest(args.request);
    const sku = args.sku || req.sku;
    if (!sku) {
        console.error('SKU missing: pass --sku or include sku in request file');
        process.exit(1);
    }
    const out = args.out || path.join(root, 'build', 'licenses', sku, `license-seat-${req.machineId.slice(0, 8)}.json`);
    issueOne(sku, args.months, out, req.machineId);
} else if (args.all) {
    // Dev/unbound seeds only — packaged apps require seat licenses issued per PC.
    for (const sku of Object.keys(SKUS)) issueOne(sku, args.months, null, null);
} else if (args.sku) {
    let machineId = args.machine || null;
    if (!args.unbound && !machineId) {
        console.error('Seat license requires --machine <id> or --request <file>.');
        console.error('For unpackaged/dev seeds only: add --unbound');
        process.exit(1);
    }
    if (args.unbound) machineId = null;
    const out = args.out || null;
    issueOne(args.sku, args.months, out, machineId);
} else {
    console.log('Usage:');
    console.log('  # Dev seeds (unbound, local Electron only)');
    console.log('  node scripts/issue-license.mjs --all');
    console.log('  node scripts/issue-license.mjs --sku VESSEL_ENGINE --unbound');
    console.log('');
    console.log('  # Production seat license (one PC)');
    console.log('  node scripts/issue-license.mjs --sku VESSEL_ENGINE --machine <id> --out license.json');
    console.log('  node scripts/issue-license.mjs --request machine-request.json --out license.json');
    process.exit(1);
}
