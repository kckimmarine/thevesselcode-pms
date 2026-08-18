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

function skuRoleSuffix(sku) {
    const s = String(sku || '').toUpperCase();
    if (s === 'VESSEL_DECK') return 'Deck';
    if (s === 'VESSEL_ENGINE') return 'Engine';
    if (s === 'VESSEL_MASTER') return 'Master';
    return '';
}

/** Default label before seat license (SKU only). */
function defaultSkuDisplayName(sku) {
    const def = getSku(sku);
    if (def?.productName) return def.productName;
    const role = skuRoleSuffix(sku);
    if (role) return `TVC-PMS-Vessel ${role}`;
    if (String(sku || '').toUpperCase() === 'HQ_OFFICE') return 'TVC-PMS-HQ Office';
    return 'TVC-PMS';
}

/**
 * Target shortcut / window name after license is known.
 * HQ: TVC-PMS-{companyId}
 * Vessel: TVC-PMS-{vesselId}_{Deck|Engine|Master}
 */
function computeLicensedDisplayName(status) {
    const sku = String(status?.sku || '').toUpperCase();
    const companyId = sanitizeDisplayName(status?.companyId || '');
    const vesselId = sanitizeDisplayName(status?.vesselId || '');
    if (sku === 'HQ_OFFICE' && companyId) return `TVC-PMS-${companyId}`;
    const role = skuRoleSuffix(sku);
    if (role && vesselId) return `TVC-PMS-${vesselId}_${role}`;
    if (role && companyId) return `TVC-PMS-${companyId}_${role}`;
    return defaultSkuDisplayName(sku);
}

function resolveDisplayName(status) {
    if (!status?.sku) return 'TVC-PMS';
    if (status.ok && (status.companyId || status.vesselId)) {
        return computeLicensedDisplayName(status);
    }
    return defaultSkuDisplayName(status.sku);
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

function writeState(app, displayName) {
    try {
        fs.writeFileSync(statePath(app), JSON.stringify({
            displayName,
            updatedAt: new Date().toISOString(),
        }, null, 2), 'utf8');
    } catch (_) { /* ignore */ }
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

function collectStaleShortcutPaths(app, nextName, exePath) {
    const staleNames = new Set([
        'TVC-PMS',
        defaultSkuDisplayName(readSkuFromApp(app)),
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
    try {
        const stamp = path.join(process.resourcesPath, 'sku.json');
        if (fs.existsSync(stamp)) {
            const raw = JSON.parse(fs.readFileSync(stamp, 'utf8'));
            if (raw?.sku) return String(raw.sku).toUpperCase();
        }
    } catch (_) { /* ignore */ }
    return process.env.TVC_BUILD_SKU || '';
}

function applyBestEffortDisplayName(app, browserWindow, licenseState) {
    const status = licenseState?.status;
    if (licenseState?.ok && status) {
        return applyInstallDisplayName(app, browserWindow, licenseState);
    }
    const sku = status?.sku || readSkuFromApp(app);
    if (!sku) return null;
    return applyInstallDisplayName(app, browserWindow, { ok: false, status: { sku } });
}

function syncWindowsShortcuts(app, displayName) {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    const exePath = process.execPath;
    const name = sanitizeDisplayName(displayName);
    if (!name) return;

    const paths = shortcutCandidates(app, name, exePath);
    try { fs.mkdirSync(path.dirname(paths.startMenuFolder), { recursive: true }); } catch (_) { /* ignore */ }

    for (const stale of collectStaleShortcutPaths(app, name, exePath)) {
        removeShortcutIfExists(stale);
    }

    upsertWindowsShortcut(paths.desktop, exePath, name);
    upsertWindowsShortcut(paths.startMenu, exePath, name);
    upsertWindowsShortcut(paths.startMenuFolder, exePath, name);
}

function applyInstallDisplayName(app, browserWindow, licenseStatus) {
    const status = licenseStatus?.status || licenseStatus;
    const displayName = sanitizeDisplayName(resolveDisplayName(status));
    if (!displayName) return displayName;

    try { app.setName(displayName); } catch (_) { /* ignore */ }

    if (browserWindow && !browserWindow.isDestroyed()) {
        browserWindow.setTitle(displayName);
    }

    const prev = readState(app)?.displayName;
    if (prev !== displayName) {
        syncWindowsShortcuts(app, displayName);
        writeState(app, displayName);
    }
    return displayName;
}

module.exports = {
    sanitizeDisplayName,
    defaultSkuDisplayName,
    computeLicensedDisplayName,
    resolveDisplayName,
    applyInstallDisplayName,
    applyBestEffortDisplayName,
};
