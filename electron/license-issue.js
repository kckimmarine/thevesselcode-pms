/* THE VESSEL CODE — Seat license issuance (Admin / CLI) */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSku } = require('./sku');
const { canonicalPayloadForSign } = require('./license');

function validateMachineRequest(req) {
    if (!req || req.kind !== 'TVC_MACHINE_REQUEST' || !req.machineId) {
        throw new Error('Invalid machine request (expected kind TVC_MACHINE_REQUEST with machineId).');
    }
    return req;
}

function buildLicense(skuKey, months, machineId, scope = {}) {
    const def = getSku(skuKey);
    if (!def) throw new Error(`Unknown SKU: ${skuKey}`);
    const issuedAt = new Date().toISOString();
    const exp = new Date();
    exp.setMonth(exp.getMonth() + months);
    const mid = machineId == null || machineId === '' ? null : String(machineId).trim();
    const companyId = scope.companyId != null && scope.companyId !== ''
        ? String(scope.companyId).trim()
        : def.companyId;
    const vesselId = scope.vesselId != null && scope.vesselId !== ''
        ? String(scope.vesselId).trim()
        : def.vesselId;
    let allowedVesselIds = scope.allowedVesselIds;
    if (allowedVesselIds == null) {
        allowedVesselIds = def.allowedVesselIds || (vesselId ? [vesselId] : null);
    }
    if (!companyId) {
        throw new Error('companyId is required for seat license (select company in Admin).');
    }
    if (def.allowHq && (!allowedVesselIds || !allowedVesselIds.length)) {
        throw new Error('HQ seat license requires allowedVesselIds (company vessels from registry).');
    }
    const vesselSkus = ['VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK'];
    if (vesselSkus.includes(def.sku) && !vesselId) {
        throw new Error('Vessel seat license requires vesselId (select vessel in Admin).');
    }
    return {
        companyId,
        vesselId: vesselId || null,
        sku: def.sku,
        allowedVesselIds,
        issuedAt,
        expiresAt: exp.toISOString(),
        machineId: mid,
        seat: !!mid,
    };
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

function suggestedLicenseFilename(request, skuKey) {
    const sku = String(skuKey || request?.sku || 'sku').toLowerCase();
    const mid = String(request?.machineId || '').slice(0, 8) || 'seat';
    return `${sku}_license_${mid}.json`;
}

function issueSeatLicense(request, opts = {}) {
    const req = validateMachineRequest(request);
    const skuKey = opts.sku || req.sku;
    if (!skuKey) throw new Error('SKU missing: include sku in machine request.');
    const months = Number(opts.months) || 3;
    const pem = opts.privateKeyPem;
    if (!pem) throw new Error('Private signing key not loaded.');
    const unsigned = buildLicense(skuKey, months, req.machineId, {
        companyId: opts.companyId,
        vesselId: opts.vesselId,
        allowedVesselIds: opts.allowedVesselIds,
    });
    const license = signLicense(unsigned, pem);
    return {
        license,
        suggestedFilename: suggestedLicenseFilename(req, skuKey),
        sku: skuKey,
        machineId: req.machineId,
        expiresAt: license.expiresAt,
    };
}

function resolvePrivateKeyPath(opts = {}) {
    const root = opts.root || path.join(__dirname, '..');
    const candidates = [
        process.env.TVC_LICENSE_PRIVATE_KEY,
        opts.settingsPath,
        path.join(root, 'electron', 'keys', 'private.pem'),
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function readPrivateKeyPem(opts = {}) {
    const keyPath = resolvePrivateKeyPath(opts);
    if (!keyPath) {
        throw new Error(
            'Private signing key not found. Dev: npm run license:keys · Packaged Admin: Menu → select private.pem once.'
        );
    }
    return fs.readFileSync(keyPath, 'utf8');
}

module.exports = {
    validateMachineRequest,
    buildLicense,
    signLicense,
    suggestedLicenseFilename,
    issueSeatLicense,
    resolvePrivateKeyPath,
    readPrivateKeyPem,
};
