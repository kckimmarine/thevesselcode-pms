/* THE VESSEL CODE — Offline license verify / seat bind (main process) */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { getSku, COMPANY_ID, isUniversalSku } = require('./sku');

const LICENSE_FILE_NAME = 'license.json';
const SKU_STAMP_FILE_NAME = 'sku.json';
const PUBLIC_KEY_FILE = path.join(__dirname, 'keys', 'public.pem');

function readPublicKey() {
    if (!fs.existsSync(PUBLIC_KEY_FILE)) {
        throw new Error('License public key missing (electron/keys/public.pem). Run: npm run license:keys');
    }
    return fs.readFileSync(PUBLIC_KEY_FILE, 'utf8');
}

/** Legacy signed payload (machineId not included). Used for unpackaged/dev seeds. */
function canonicalPayloadLegacy(lic) {
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

/**
 * Seat license signed payload — machineId is part of the signature.
 * Factory/dev licenses without a bound PC omit machineId (legacy canonical).
 */
function canonicalPayloadForSign(lic) {
    const mid = lic.machineId == null || lic.machineId === '' ? null : String(lic.machineId);
    if (!mid) return canonicalPayloadLegacy(lic);
    const body = {
        companyId: String(lic.companyId || ''),
        vesselId: lic.vesselId == null || lic.vesselId === '' ? null : String(lic.vesselId),
        sku: String(lic.sku || ''),
        issuedAt: String(lic.issuedAt || ''),
        expiresAt: String(lic.expiresAt || ''),
        allowedVesselIds: Array.isArray(lic.allowedVesselIds)
            ? [...lic.allowedVesselIds].map(String).sort()
            : null,
        machineId: mid,
        seat: true,
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
        const sigBuf = Buffer.from(String(lic.signature), 'base64');
        const payloads = [canonicalPayloadForSign(lic), canonicalPayloadLegacy(lic)];
        const seen = new Set();
        for (const payload of payloads) {
            if (seen.has(payload)) continue;
            seen.add(payload);
            const ok = crypto.verify(null, Buffer.from(payload, 'utf8'), pub, sigBuf);
            if (ok) return { ok: true };
        }
        return { ok: false, code: 'LICENSE_BAD_SIG', message: 'License signature is invalid.' };
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

function detectSkuHint(app) {
    const resources = process.resourcesPath || path.dirname(app.getAppPath());
    const stamp = readJsonSafe(path.join(resources, SKU_STAMP_FILE_NAME));
    if (stamp?.sku) return String(stamp.sku);
    try {
        const resLic = path.join(resources, LICENSE_FILE_NAME);
        if (fs.existsSync(resLic)) {
            const j = JSON.parse(fs.readFileSync(resLic, 'utf8'));
            if (j?.sku) return String(j.sku);
        }
    } catch (_) { /* ignore */ }
    return process.env.TVC_BUILD_SKU || process.env.TVC_DEV_SKU || null;
}

function licensePaths(app) {
    const userData = app.getPath('userData');
    const resources = process.resourcesPath || path.dirname(app.getAppPath());
    const sku = process.env.TVC_BUILD_SKU || detectSkuHint(app) || 'HQ_OFFICE';
    return {
        userData: path.join(userData, LICENSE_FILE_NAME),
        resources: path.join(resources, LICENSE_FILE_NAME),
        skuStamp: path.join(resources, SKU_STAMP_FILE_NAME),
        devSeed: path.join(app.getAppPath(), 'build', 'licenses', sku, LICENSE_FILE_NAME),
        sku,
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

function activationStatus(app, extra = {}) {
    const paths = licensePaths(app);
    const sku = paths.sku;
    const skuDef = getSku(sku) || {};
    return {
        ok: false,
        needsActivation: true,
        machineId: getMachineId(),
        sku: skuDef.sku || sku,
        skuLabel: skuDef.label || sku,
        companyId: skuDef.companyId || COMPANY_ID,
        vesselId: skuDef.vesselId || null,
        hostname: os.hostname(),
        ...extra,
    };
}

function validateLicenseBody(lic) {
    const skuDef = getSku(lic.sku);
    if (!skuDef) {
        return { ok: false, code: 'LICENSE_SKU', message: `Unknown SKU: ${lic.sku}` };
    }
    if (String(lic.sku || '') !== String(skuDef.sku || '')) {
        return {
            ok: false,
            code: 'LICENSE_SKU_MISMATCH',
            message: `License SKU (${lic.sku}) does not match this installation (${skuDef.sku}).`,
        };
    }
    if (isUniversalSku(skuDef)) {
        if (!String(lic.companyId || '').trim()) {
            return {
                ok: false,
                code: 'LICENSE_COMPANY',
                message: 'Seat license missing companyId. Re-issue from Admin with company selected.',
            };
        }
        if (skuDef.vesselId == null && skuDef.allowHq !== true && !String(lic.vesselId || '').trim()) {
            const vesselSkus = ['VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK'];
            if (vesselSkus.includes(String(skuDef.sku))) {
                return {
                    ok: false,
                    code: 'LICENSE_VESSEL',
                    message: 'Seat license missing vesselId. Re-issue from Admin with vessel selected.',
                };
            }
        }
        return { ok: true, skuDef };
    }
    if (String(lic.companyId || '') !== String(skuDef.companyId || COMPANY_ID)) {
        return {
            ok: false,
            code: 'LICENSE_COMPANY',
            message: 'License companyId does not match this product.',
        };
    }
    if (skuDef.vesselId && String(lic.vesselId || '') !== String(skuDef.vesselId)) {
        return {
            ok: false,
            code: 'LICENSE_VESSEL',
            message: 'License vesselId does not match this product.',
        };
    }
    return { ok: true, skuDef };
}

function isAdminModeInstallation(app) {
    const paths = licensePaths(app);
    return String(paths.sku || '').toUpperCase() === 'ADMIN_TVC';
}

function adminModeLicenseResult(app) {
    const skuDef = getSku('ADMIN_TVC') || {};
    const currentMachine = getMachineId();
    const status = {
        ok: true,
        companyId: skuDef.companyId || 'THEVESSELCODE',
        vesselId: null,
        allowedVesselIds: skuDef.allowedVesselIds || [],
        sku: 'ADMIN_TVC',
        skuLabel: skuDef.label || 'TVC Admin Mode',
        loginModes: [],
        allowHq: false,
        allowAdmin: true,
        machineId: currentMachine,
        issuedAt: null,
        expiresAt: null,
        boundAt: null,
        seat: false,
        noSeatRequired: true,
        electron: true,
    };
    return { ok: true, status, license: null };
}

function ensureLicense(app) {
    if (isAdminModeInstallation(app)) {
        return adminModeLicenseResult(app);
    }
    const paths = licensePaths(app);
    const currentMachine = getMachineId();
    const stamp = readJsonSafe(paths.skuStamp);
    let lic = loadRawLicense(app);

    if (!lic) {
        return {
            ok: false,
            code: 'LICENSE_NEED_ACTIVATION',
            message: 'Seat license required. Export this PC machine ID and ask HQ to issue a license for this computer only.',
            status: activationStatus(app),
        };
    }

    const sig = verifySignature(lic);
    if (!sig.ok) return { ...sig, status: activationStatus(app, { message: sig.message }) };

    const body = validateLicenseBody(lic);
    if (!body.ok) return { ...body, status: activationStatus(app, { message: body.message }) };
    const skuDef = body.skuDef;

    if (stamp?.sku && String(stamp.sku) !== String(lic.sku)) {
        return {
            ok: false,
            code: 'LICENSE_SKU_MISMATCH',
            message: `License SKU (${lic.sku}) does not match this package (${stamp.sku}).`,
            status: activationStatus(app),
        };
    }

    if (lic.expiresAt) {
        const exp = Date.parse(lic.expiresAt);
        if (!Number.isNaN(exp) && Date.now() > exp) {
            return {
                ok: false,
                code: 'LICENSE_EXPIRED',
                message: `License expired on ${String(lic.expiresAt).slice(0, 10)}.`,
                status: activationStatus(app),
            };
        }
    }

    const seatMachine = lic.machineId == null || lic.machineId === '' ? null : String(lic.machineId);

    if (app.isPackaged) {
        // Packaged product: only PC-bound seat licenses are accepted (no auto-bind).
        if (!seatMachine) {
            return {
                ok: false,
                code: 'LICENSE_NEED_ACTIVATION',
                message: 'This package requires a seat license bound to this PC. The installer alone cannot be reused on another computer.',
                status: activationStatus(app),
            };
        }
        if (seatMachine !== currentMachine) {
            return {
                ok: false,
                code: 'LICENSE_MACHINE',
                message: 'This seat license is bound to another PC. Copying or reinstalling on a different computer is not allowed.',
                status: activationStatus(app),
            };
        }
        if (!fs.existsSync(paths.userData)) {
            writeJson(paths.userData, { ...lic, seat: true, boundAt: lic.boundAt || new Date().toISOString() });
        }
    } else {
        // Dev / unpackaged: allow legacy unbound license to auto-bind once for local testing.
        if (!seatMachine) {
            lic = { ...lic, machineId: currentMachine, boundAt: new Date().toISOString(), seat: false };
            writeJson(paths.userData, lic);
        } else if (seatMachine !== currentMachine) {
            return {
                ok: false,
                code: 'LICENSE_MACHINE',
                message: 'This seat license is bound to another PC.',
                status: activationStatus(app),
            };
        } else if (!fs.existsSync(paths.userData)) {
            writeJson(paths.userData, lic);
        }
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
        allowAdmin: !!skuDef.allowAdmin,
        machineId: seatMachine || lic.machineId || currentMachine,
        issuedAt: lic.issuedAt,
        expiresAt: lic.expiresAt,
        boundAt: lic.boundAt || null,
        seat: !!seatMachine,
        electron: true,
    };
    return { ok: true, status, license: lic };
}

/** Validate and install a seat license file into userData. */
function applyLicenseFile(app, filePath) {
    const raw = readJsonSafe(filePath);
    if (!raw) {
        return { ok: false, code: 'LICENSE_MISSING', message: 'Could not read license file.' };
    }
    const sig = verifySignature(raw);
    if (!sig.ok) return sig;

    const body = validateLicenseBody(raw);
    if (!body.ok) return body;

    const paths = licensePaths(app);
    const stamp = readJsonSafe(paths.skuStamp);
    if (stamp?.sku && String(stamp.sku) !== String(raw.sku)) {
        return {
            ok: false,
            code: 'LICENSE_SKU_MISMATCH',
            message: `License SKU (${raw.sku}) does not match this package (${stamp.sku}).`,
        };
    }

    if (raw.expiresAt) {
        const exp = Date.parse(raw.expiresAt);
        if (!Number.isNaN(exp) && Date.now() > exp) {
            return {
                ok: false,
                code: 'LICENSE_EXPIRED',
                message: `License expired on ${String(raw.expiresAt).slice(0, 10)}.`,
            };
        }
    }

    const currentMachine = getMachineId();
    const seatMachine = raw.machineId == null || raw.machineId === '' ? null : String(raw.machineId);
    if (!seatMachine) {
        return {
            ok: false,
            code: 'LICENSE_NOT_SEAT',
            message: 'License is not a seat license (missing machineId). Ask HQ to issue with this PC machine ID.',
        };
    }
    if (seatMachine !== currentMachine) {
        return {
            ok: false,
            code: 'LICENSE_MACHINE',
            message: 'This license was issued for a different PC machine ID.',
        };
    }

    const toStore = {
        ...raw,
        seat: true,
        boundAt: new Date().toISOString(),
    };
    writeJson(paths.userData, toStore);
    return ensureLicense(app);
}

function buildMachineRequest(app) {
    const paths = licensePaths(app);
    const sku = paths.sku;
    const skuDef = getSku(sku) || {};
    return {
        kind: 'TVC_MACHINE_REQUEST',
        version: 1,
        machineId: getMachineId(),
        sku: skuDef.sku || sku,
        skuLabel: skuDef.label || sku,
        companyId: skuDef.companyId || null,
        vesselId: skuDef.vesselId || null,
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        username: os.userInfo().username,
        appVersion: app.getVersion(),
        requestedAt: new Date().toISOString(),
    };
}

module.exports = {
    LICENSE_FILE_NAME,
    SKU_STAMP_FILE_NAME,
    getMachineId,
    canonicalPayloadForSign,
    canonicalPayloadLegacy,
    verifySignature,
    ensureLicense,
    isAdminModeInstallation,
    adminModeLicenseResult,
    applyLicenseFile,
    buildMachineRequest,
    licensePaths,
    readPublicKey,
    activationStatus,
    detectSkuHint,
};
