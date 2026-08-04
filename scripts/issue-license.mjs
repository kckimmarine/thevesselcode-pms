/* Issue signed Pilot license JSON for a SKU */
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
    const out = { sku: null, out: null, months: 3, all: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--all') out.all = true;
        else if (a === '--sku') out.sku = argv[++i];
        else if (a === '--out') out.out = argv[++i];
        else if (a === '--months') out.months = Number(argv[++i]) || 3;
    }
    return out;
}

function signLicense(lic, privateKeyPem) {
    const key = crypto.createPrivateKey(privateKeyPem);
    const sig = crypto.sign(null, Buffer.from(canonicalPayloadForSign(lic), 'utf8'), key);
    return { ...lic, signature: sig.toString('base64'), machineId: null };
}

function buildLicense(skuKey, months) {
    const def = getSku(skuKey);
    if (!def) throw new Error(`Unknown SKU: ${skuKey}`);
    const issuedAt = new Date().toISOString();
    const exp = new Date();
    exp.setMonth(exp.getMonth() + months);
    return {
        companyId: def.companyId,
        vesselId: def.vesselId,
        sku: def.sku,
        allowedVesselIds: def.allowedVesselIds || (def.vesselId ? [def.vesselId] : null),
        issuedAt,
        expiresAt: exp.toISOString(),
        machineId: null,
    };
}

function issueOne(skuKey, months, outDir) {
    if (!fs.existsSync(privPath)) {
        throw new Error(`Private key not found: ${privPath}\nRun: npm run license:keys`);
    }
    const priv = fs.readFileSync(privPath, 'utf8');
    const unsigned = buildLicense(skuKey, months);
    const signed = signLicense(unsigned, priv);
    const dir = outDir || path.join(root, 'build', 'licenses', skuKey);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'license.json');
    fs.writeFileSync(file, JSON.stringify(signed, null, 2));
    console.log('Issued', skuKey, '→', file);
    return file;
}

const args = parseArgs(process.argv);
if (args.all) {
    for (const sku of Object.keys(SKUS)) issueOne(sku, args.months, null);
} else if (args.sku) {
    issueOne(args.sku, args.months, args.out ? path.dirname(path.resolve(args.out)) : null);
    if (args.out) {
        const src = path.join(root, 'build', 'licenses', args.sku, 'license.json');
        fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
        fs.copyFileSync(src, path.resolve(args.out));
    }
} else {
    console.log('Usage:');
    console.log('  node scripts/issue-license.mjs --all');
    console.log('  node scripts/issue-license.mjs --sku VESSEL_MASTER [--months 3]');
    process.exit(1);
}
