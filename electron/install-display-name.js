'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { getSku } = require('./sku');

const STATE_FILE = 'install-display.json';
const INVALID_CHARS = /[\\/:*?"<>|]/g;

function sanitizeDisplayName(name) {
    return String(name || '')
        .replace(INVALID_CHARS, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function readAppVersion(app) {
    try {
        if (app?.getVersion) return String(app.getVersion()).trim();
    } catch (_) { /* ignore */ }
    try {
        const pkgPath = path.join(__dirname, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg?.version) return String(pkg.version).trim();
    } catch (_) { /* ignore */ }
    return '1.0.4';
}

function versionSuffix(app, explicitVersion) {
    const ver = String(explicitVersion || readAppVersion(app) || '').trim();
    return ver ? ` v${ver}` : '';
}

function skuRoleSuffix(sku) {
    const s = String(sku || '').toUpperCase();
    if (s === 'VESSEL_DECK') return 'Deck';
    if (s === 'VESSEL_ENGINE') return 'Engine';
    if (s === 'VESSEL_MASTER') return 'Master';
    return '';
}

function readSkuStamp() {
    try {
        const stampPath = process.resourcesPath
            ? path.join(process.resourcesPath, 'sku.json')
            : null;
        if (stampPath && fs.existsSync(stampPath)) {
            return JSON.parse(fs.readFileSync(stampPath, 'utf8'));
        }
    } catch (_) { /* ignore */ }
    const sku = process.env.TVC_BUILD_SKU || process.env.TVC_DEV_SKU;
    return sku ? { sku: String(sku).toUpperCase() } : null;
}

/** Pre-license window / shortcut label (SKU generic + version). */
function defaultSkuDisplayName(sku, app, explicitVersion) {
    const s = String(sku || '').toUpperCase();
    const ver = versionSuffix(app, explicitVersion);
    const def = getSku(s);
    if (s === 'HQ_OFFICE') return `TVC-PMS HQ Office${ver}`;
    const role = skuRoleSuffix(s);
    if (role) return `TVC-PMS Vessel ${role}${ver}`;
    if (def?.productName) return `${def.productName}${ver}`;
    return `TVC-PMS${ver}`;
}

/**
 * Licensed display: TVC-PMS INCHEON CHEMI_Master v1.0.4 / TVC-PMS DAEMYUNG v1.0.4
 */
function computeLicensedDisplayName(status, app, explicitVersion) {
    const sku = String(status?.sku || '').toUpperCase();
    const companyId = sanitizeDisplayName(status?.companyId || '');
    const vesselId = sanitizeDisplayName(status?.vesselId || '');
    const ver = versionSuffix(app, explicitVersion);
    if (sku === 'HQ_OFFICE' && companyId) return `TVC-PMS ${companyId}${ver}`;
    const role = skuRoleSuffix(sku);
    if (role && vesselId) return `TVC-PMS ${vesselId}_${role}${ver}`;
    if (role && companyId) return `TVC-PMS ${companyId}_${role}${ver}`;
    return defaultSkuDisplayName(sku, app, explicitVersion);
}

/** AppData folder name (no version): TVC-PMS INCHEON CHEMI_Master */
function computeLicensedDataDirName(status) {
    const sku = String(status?.sku || '').toUpperCase();
    const companyId = sanitizeDisplayName(status?.companyId || '');
    const vesselId = sanitizeDisplayName(status?.vesselId || '');
    if (sku === 'HQ_OFFICE' && companyId) return sanitizeDisplayName(`TVC-PMS ${companyId}`);
    const role = skuRoleSuffix(sku);
    if (role && vesselId) return sanitizeDisplayName(`TVC-PMS ${vesselId}_${role}`);
    if (role && companyId) return sanitizeDisplayName(`TVC-PMS ${companyId}_${role}`);
    if (sku) return sanitizeDisplayName(`tvc-pms-${sku}`);
    return '';
}

/** Setup.exe display filename: TVC-PMS INCHEON CHEMI_Master v1.0.4 Setup.exe */
function computeSetupExeName(status, app, explicitVersion) {
    const base = computeLicensedDisplayName(status, app, explicitVersion);
    if (status?.ok && (status.companyId || status.vesselId)) {
        return sanitizeDisplayName(`${base} Setup.exe`);
    }
    const sku = String(status?.sku || '').toUpperCase();
    return sanitizeDisplayName(`${defaultSkuDisplayName(sku, app, explicitVersion)} Setup.exe`);
}

function resolveDisplayName(status, app) {
    if (!status?.sku) return 'TVC-PMS';
    if (status.ok !== false && (status.companyId || status.vesselId)) {
        return computeLicensedDisplayName(status, app);
    }
    return defaultSkuDisplayName(status.sku, app);
}

function statePath(app) {
    return path.join(app.getPath('userData'), STATE_FILE);
}

function readState(app) {
    try {
        return JSON.parse(fs.readFileSync(statePath(app), 'utf8'));
    } catch (_) {
        return null;
    }
}

function persistState(app, patch) {
    const merged = { ...(readState(app) || {}), ...patch, updatedAt: new Date().toISOString() };
    try {
        fs.writeFileSync(statePath(app), JSON.stringify(merged, null, 2), 'utf8');
    } catch (_) { /* ignore */ }
    return merged;
}

/** Stable licensed identity — version bumps must not re-sync shortcuts. */
function licensedShortcutKey(status) {
    if (!status?.sku) return '';
    if (status.ok === false) return '';
    const sku = String(status.sku).toUpperCase();
    const companyId = sanitizeDisplayName(status.companyId || '');
    const vesselId = sanitizeDisplayName(status.vesselId || '');
    if (!companyId && !vesselId) return '';
    return `lic:${sku}:${vesselId}:${companyId}`;
}

function refreshDesktopShortcutOptOut(app, state, displayName) {
    if (process.platform !== 'win32' || !app.isPackaged) return state || {};
    if (!state?.shortcutLicensedKey || state.desktopShortcutRemovedByUser) return state || {};
    const name = sanitizeDisplayName(displayName || state.displayName);
    if (!name) return state || {};
    const desktop = shortcutCandidates(app, name, process.execPath).desktop;
    if (state.shortcutsDesktopSynced && !fs.existsSync(desktop)) {
        return persistState(app, { desktopShortcutRemovedByUser: true });
    }
    return state || {};
}

function runPowerShell(script) {
    if (process.platform !== 'win32') return;
    execFileSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script,
    ], { stdio: 'ignore', windowsHide: true });
}

function psQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function upsertWindowsShortcut(lnkPath, targetPath, displayName) {
    const script = [
        '$WshShell = New-Object -ComObject WScript.Shell',
        `$Shortcut = $WshShell.CreateShortcut(${psQuote(lnkPath)})`,
        `$Shortcut.TargetPath = ${psQuote(targetPath)}`,
        `$Shortcut.WorkingDirectory = ${psQuote(path.dirname(targetPath))}`,
        `$Shortcut.Description = ${psQuote(displayName)}`,
        '$Shortcut.Save()',
    ].join('; ');
    runPowerShell(script);
}

function removeShortcutIfExists(lnkPath) {
    if (!lnkPath || !fs.existsSync(lnkPath)) return;
    try { fs.unlinkSync(lnkPath); } catch (_) { /* ignore */ }
}

function shortcutCandidates(app, displayName, exePath) {
    const home = os.homedir();
    const desktop = path.join(home, 'Desktop', `${displayName}.lnk`);
    const publicDesktop = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop', `${displayName}.lnk`);
    const startMenu = path.join(
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
        'Microsoft', 'Windows', 'Start Menu', 'Programs',
        `${displayName}.lnk`,
    );
    const startMenuFolder = path.join(
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
        'Microsoft', 'Windows', 'Start Menu', 'Programs',
        displayName,
        `${displayName}.lnk`,
    );
    return { desktop, publicDesktop, startMenu, startMenuFolder, exePath };
}

function collectStaleShortcutPaths(app, nextName, sku) {
    const staleNames = new Set([
        'TVC-PMS',
        defaultSkuDisplayName(sku || readSkuFromApp(app), app),
        readState(app)?.displayName,
    ].filter(Boolean));
    if (nextName) staleNames.delete(nextName);

    const home = os.homedir();
    const roots = [
        path.join(home, 'Desktop'),
        path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'),
        path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ];
    const hits = [];
    for (const root of roots) {
        if (!root || !fs.existsSync(root)) continue;
        for (const name of staleNames) {
            hits.push(path.join(root, `${name}.lnk`));
            hits.push(path.join(root, name, `${name}.lnk`));
        }
    }
    return [...new Set(hits)];
}

function readSkuFromApp(app) {
    const stamp = readSkuStamp();
    if (stamp?.sku) return String(stamp.sku).toUpperCase();
    return process.env.TVC_BUILD_SKU || '';
}

function applyBestEffortDisplayName(app, browserWindow, licenseState, options = {}) {
    const status = licenseState?.status;
    if (licenseState?.ok && status) {
        return applyInstallDisplayName(app, browserWindow, licenseState, options);
    }
    const sku = status?.sku || readSkuFromApp(app);
    if (!sku) return null;
    return applyInstallDisplayName(app, browserWindow, { ok: false, status: { sku } }, options);
}

function syncWindowsShortcuts(app, displayName, options = {}) {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    const includeDesktop = options.includeDesktop !== false;
    const exePath = process.execPath;
    const name = sanitizeDisplayName(displayName);
    if (!name) return;

    const paths = shortcutCandidates(app, name, exePath);
    try { fs.mkdirSync(path.dirname(paths.startMenuFolder), { recursive: true }); } catch (_) { /* ignore */ }

    for (const stale of collectStaleShortcutPaths(app, name, readSkuFromApp(app))) {
        removeShortcutIfExists(stale);
    }

    if (includeDesktop) {
        upsertWindowsShortcut(paths.desktop, exePath, name);
    }
    upsertWindowsShortcut(paths.startMenu, exePath, name);
    upsertWindowsShortcut(paths.startMenuFolder, exePath, name);
}

function applyInstallDisplayName(app, browserWindow, licenseStatus, options = {}) {
    const status = licenseStatus?.status || licenseStatus;
    const displayName = sanitizeDisplayName(resolveDisplayName(status, app));
    if (!displayName) return displayName;

    try { app.setName(displayName); } catch (_) { /* ignore */ }

    if (browserWindow && !browserWindow.isDestroyed()) {
        browserWindow.setTitle(displayName);
    }

    let state = readState(app) || {};
    if (state.displayName !== displayName) {
        state = persistState(app, { displayName });
    }
    state = refreshDesktopShortcutOptOut(app, state, displayName);

    const licKey = licensedShortcutKey(status);
    const firstLicensed = licKey && licKey !== state.shortcutLicensedKey;
    if (firstLicensed && options.syncShortcuts && !state.desktopShortcutRemovedByUser) {
        syncWindowsShortcuts(app, displayName, { includeDesktop: true });
        persistState(app, {
            shortcutLicensedKey: licKey,
            shortcutsDesktopSynced: true,
        });
    } else if (firstLicensed) {
        const desktop = shortcutCandidates(app, displayName, process.execPath).desktop;
        persistState(app, {
            shortcutLicensedKey: licKey,
            shortcutsDesktopSynced: fs.existsSync(desktop),
        });
    }

    return displayName;
}

module.exports = {
    sanitizeDisplayName,
    readSkuStamp,
    readAppVersion,
    defaultSkuDisplayName,
    computeLicensedDisplayName,
    computeLicensedDataDirName,
    computeSetupExeName,
    resolveDisplayName,
    applyInstallDisplayName,
    applyBestEffortDisplayName,
};
