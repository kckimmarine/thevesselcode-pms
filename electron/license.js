/* THE VESSEL CODE — Offline license verify / machine bind (main process) */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { getSku, COMPANY_ID } = require('./sku');

const LICENSE_FILE_NAME = 'license.json';
const PUBLIC_KEY_FILE = path.join(__dirname, 'keys', 'public.pem');

function readPublicKey() {
    if (!fs.existsSync(PUBLIC_KEY_FILE)) {
        throw new Error('License public key missing (electron/keys/public.pem). Run: npm run license:keys');
    }
    return fs.readFileSync(PUBLIC_KEY_FILE, 'utf8');
}

/** Signed fields — machineId is bound locally after first run (not part of signature). */
function canonicalPayloadForSign(lic) {
    const body = {
        companyId: String(lic.companyId || ''),
        vesselId: lic.vesselId == null || lic.vesselId === '' ? null : String(lic.vesselId),
        sku: String(lic.sku || ''),
        issuedAt: String(lic.issuedAt || ''),
        expiresAt: String(lic.expiresAt || ''),
        allowedVesselIds: Array.isArray(lic.allowedVesselIds)
            ? [...lic.allowedVesselIds].map(String).sort()
            : null,
    };
    return JSON.stringify(body);
}

function verifySignature(lic) {
    if (!lic || typeof lic !== 'object') {
        return { ok: false, code: 'LICENSE_MISSING', message: 'License file not found.' };
    }
    if (!lic.signature) {
        return { ok: false, code: 'LICENSE_UNSIGNED', message: 'License signature missing.' };
    }
    try {
        const pub = readPublicKey();
        const ok = crypto.verify(
            null,
            Buffer.from(canonicalPayloadForSign(lic), 'utf8'),
            pub,
            Buffer.from(String(lic.signature), 'base64')
        );
        if (!ok) return { ok: false, code: 'LICENSE_BAD_SIG', message: 'License signature is invalid.' };
        return { ok: true };
    } catch (e) {
        return { ok: false, code: 'LICENSE_VERIFY_ERR', message: e.message || String(e) };
    }
}

function getMachineId() {
    const parts = [
        os.hostname(),
        os.platform(),
        os.arch(),
        os.userInfo().username,
    ];
    try {
        const nics = os.networkInterfaces() || {};
        const macs = Object.values(nics)
            .flat()
            .filter(i => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
            .map(i => i.mac)
            .sort();
        if (macs.length) parts.push(macs.join(','));
    } catch (_) { /* ignore */ }
    try {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            const out = execSync(
                'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
                { encoding: 'utf8', windowsHide: true, timeout: 5000 }
            );
            const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
            if (m) parts.push(m[1]);
        }
    } catch (_) { /* ignore */ }
    return crypto.createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 32);
}

function licensePaths(app) {
    const userData = app.getPath('userData');
    const resources = process.resourcesPath || path.dirname(app.getAppPath());
    const sku = process.env.TVC_BUILD_SKU || 'HQ_OFFICE';
    return {
        userData: path.join(userData, LICENSE_FILE_NAME),
        resources: path.join(resources, LICENSE_FILE_NAME),
        devSeed: path.join(app.getAppPath(), 'build', 'licenses', sku, LICENSE_FILE_NAME),
    };
}

function readJsonSafe(file) {
    try {
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
}

function writeJson(file, obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function loadRawLicense(app) {
    const paths = licensePaths(app);
    return readJsonSafe(paths.userData)
        || readJsonSafe(paths.resources)
        || (app.isPackaged ? null : readJsonSafe(paths.devSeed));
}

function ensureLicense(app) {
    const paths = licensePaths(app);
    let lic = loadRawLicense(app);
    if (!lic) {
        return {
            ok: false,
            code: 'LICENSE_MISSING',
            message: 'No license.json found. Install the licensed Pilot package or place license.json in the app data folder.',
            status: null,
        };
    }

    const sig = verifySignature(lic);
    if (!sig.ok) return { ...sig, status: null };

    const skuDef = getSku(lic.sku);
    if (!skuDef) {
        return { ok: false, code: 'LICENSE_SKU', message: `Unknown SKU: ${lic.sku}`, status: null };
    }
    if (String(lic.companyId || '') !== String(skuDef.companyId || COMPANY_ID)) {
        return {
            ok: false,
            code: 'LICENSE_COMPANY',
            message: 'License companyId does not match this product.',
            status: null,
        };
    }
    if (skuDef.vesselId && String(lic.vesselId || '') !== String(skuDef.vesselId)) {
        return {
            ok: false,
            code: 'LICENSE_VESSEL',
            message: 'License vesselId does not match this product.',
            status: null,
        };
    }
    if (lic.expiresAt) {
        const exp = Date.parse(lic.expiresAt);
        if (!Number.isNaN(exp) && Date.now() > exp) {
            return {
                ok: false,
                code: 'LICENSE_EXPIRED',
                message: `License expired on ${String(lic.expiresAt).slice(0, 10)}.`,
                status: null,
            };
        }
    }

    const currentMachine = getMachineId();
    if (!lic.machineId) {
        lic = { ...lic, machineId: currentMachine, boundAt: new Date().toISOString() };
        writeJson(paths.userData, lic);
    } else if (String(lic.machineId) !== currentMachine) {
        return {
            ok: false,
            code: 'LICENSE_MACHINE',
            message: 'This license is bound to another PC. Copying the app to another computer is not allowed.',
            status: null,
        };
    } else if (!fs.existsSync(paths.userData)) {
        writeJson(paths.userData, lic);
    }

    const status = {
        ok: true,
        companyId: lic.companyId,
        vesselId: lic.vesselId || null,
        allowedVesselIds: lic.allowedVesselIds
            || (lic.vesselId ? [lic.vesselId] : (skuDef.allowedVesselIds || [])),
        sku: lic.sku,
        skuLabel: skuDef.label,
        loginModes: skuDef.loginModes || [],
        allowHq: !!skuDef.allowHq,
        machineId: lic.machineId,
        issuedAt: lic.issuedAt,
        expiresAt: lic.expiresAt,
        boundAt: lic.boundAt || null,
        electron: true,
    };
    return { ok: true, status, license: lic };
}

module.exports = {
    LICENSE_FILE_NAME,
    getMachineId,
    canonicalPayloadForSign,
    verifySignature,
    ensureLicense,
    licensePaths,
    readPublicKey,
};
