'use strict';

const fs = require('fs');
const path = require('path');
const { computeLicensedDataDirName, readSkuStamp } = require('./install-display-name');

const LICENSE_FILE = 'license.json';

function detectSkuEarly() {
    const fromEnv = process.env.TVC_BUILD_SKU || process.env.TVC_DEV_SKU;
    if (fromEnv) return String(fromEnv).toUpperCase();
    const stamp = readSkuStamp();
    if (stamp?.sku) return String(stamp.sku).toUpperCase();
    return '';
}

function readJsonSafe(file) {
    try {
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
}

function copyDirContents(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        const from = path.join(src, name);
        const to = path.join(dest, name);
        if (fs.existsSync(to)) continue;
        const st = fs.statSync(from);
        if (st.isDirectory()) copyDirContents(from, to);
        else fs.copyFileSync(from, to);
    }
}

/**
 * Must run before app 'ready'. Separates HQ / Master / Engine / Deck IndexedDB per SKU.
 * After seat license, uses human-readable folder: TVC-PMS INCHEON CHEMI_Master
 */
function configureUserDataPath(app) {
    const sku = detectSkuEarly();
    if (!sku) return null;
    process.env.TVC_BUILD_SKU = sku;

    const roamingBase = path.dirname(app.getPath('userData'));
    const skuDir = path.join(roamingBase, `tvc-pms-${sku}`);
    let targetDir = skuDir;

    const licInSku = readJsonSafe(path.join(skuDir, LICENSE_FILE));
    if (licInSku?.sku) {
        const named = computeLicensedDataDirName({ sku: licInSku.sku, companyId: licInSku.companyId, vesselId: licInSku.vesselId });
        if (named) targetDir = path.join(roamingBase, named);
    } else {
        try {
            for (const entry of fs.readdirSync(roamingBase, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                if (!entry.name.startsWith('TVC-PMS ')) continue;
                const lic = readJsonSafe(path.join(roamingBase, entry.name, LICENSE_FILE));
                if (lic && String(lic.sku || '').toUpperCase() === sku) {
                    targetDir = path.join(roamingBase, entry.name);
                    break;
                }
            }
        } catch (_) { /* ignore */ }
    }

    if (targetDir !== skuDir && fs.existsSync(skuDir) && !fs.existsSync(path.join(targetDir, LICENSE_FILE))) {
        copyDirContents(skuDir, targetDir);
    }

    app.setPath('userData', targetDir);
    return targetDir;
}

function migrateSkuDirToLicensed(app, licenseStatus) {
    const named = computeLicensedDataDirName(licenseStatus);
    if (!named) return null;
    const roamingBase = path.dirname(app.getPath('userData'));
    const targetDir = path.join(roamingBase, named);
    const current = app.getPath('userData');
    if (path.normalize(current) === path.normalize(targetDir)) return targetDir;
    if (fs.existsSync(current)) {
        copyDirContents(current, targetDir);
    }
    app.setPath('userData', targetDir);
    return targetDir;
}

module.exports = {
    detectSkuEarly,
    configureUserDataPath,
    migrateSkuDirToLicensed,
};
