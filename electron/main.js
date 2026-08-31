/* THE VESSEL CODE — Electron main process */
'use strict';

const { app, BrowserWindow, protocol, ipcMain, dialog, shell, nativeImage } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const {
    ensureLicense,
    applyLicenseFile,
    buildMachineRequest,
    detectSkuHint,
} = require('./license');
const {
    issueSeatLicense,
    readPrivateKeyPem,
    resolvePrivateKeyPath,
} = require('./license-issue');
const { applyInstallDisplayName, resolveDisplayName, applyBestEffortDisplayName } = require('./install-display-name');
const { configureUserDataPath, migrateSkuDirToLicensed } = require('./user-data-path');

configureUserDataPath(app);

const PROTOCOL = 'tvc-app';
const WIDTH_RATIO = 0.78;
const HEIGHT_RATIO = 0.88;

protocol.registerSchemesAsPrivileged([{
    scheme: PROTOCOL,
    privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
    },
}]);

let mainWindow = null;
let licenseState = { ok: false, status: null, message: 'License not checked yet.', code: null };

const SETTINGS_FILE = 'settings.json';

function settingsPath() {
    return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function readSettings() {
    try {
        const raw = fs.readFileSync(settingsPath(), 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function writeSettings(next) {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
}

function resolveExportFolder(settings) {
    const folder = String(settings?.exportFolder || '').trim();
    if (folder && fs.existsSync(folder)) return folder;
    return app.getPath('downloads');
}

function registerPrintPreviewIpc() {
    const printPreviewPreload = path.join(__dirname, 'print-preview-preload.js');
    let lastPrintPreviewWindow = null;

    async function printWebContents(webContents) {
        if (!webContents || webContents.isDestroyed()) {
            return { ok: false, error: 'Print window not available.' };
        }
        try {
            await webContents.print({
                silent: false,
                printBackground: true,
            });
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    }

    ipcMain.handle('tvc:open-print-preview', async (_evt, payload) => {
        const html = String(payload?.html || '');
        const title = String(payload?.title || 'Print Preview');
        const autoPrint = !!payload?.autoPrint;
        if (!html) return { ok: false, error: 'Empty print document.' };

        if (lastPrintPreviewWindow && !lastPrintPreviewWindow.isDestroyed()) {
            lastPrintPreviewWindow.close();
        }

        const win = new BrowserWindow({
            width: 980,
            height: 760,
            title,
            autoHideMenuBar: true,
            webPreferences: {
                preload: printPreviewPreload,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        });
        lastPrintPreviewWindow = win;
        win.on('closed', () => {
            if (lastPrintPreviewWindow === win) lastPrintPreviewWindow = null;
        });

        const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
        await win.loadURL(dataUrl);

        if (autoPrint) {
            await new Promise(r => setTimeout(r, 450));
            return printWebContents(win.webContents);
        }
        return { ok: true };
    });

    ipcMain.handle('tvc:print-preview-window', (evt) => printWebContents(evt.sender));
}

function registerAdminRegistryIpc() {
    ipcMain.handle('tvc:save-admin-registry', (_evt, bundle) => {
        try {
            const sku = detectSkuFromResources();
            if (app.isPackaged && sku !== 'ADMIN_TVC') {
                return { ok: false, error: 'Admin registry save is only available in Admin Mode.' };
            }
            const files = Array.isArray(bundle?.files) ? bundle.files : [];
            if (!files.length) {
                return { ok: false, error: 'No registry files to save.' };
            }
            const adminDir = path.join(appRoot(), 'admin');
            const adminNorm = path.normalize(adminDir + path.sep);
            const written = [];
            for (const entry of files) {
                const rel = String(entry?.relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
                if (!rel || rel.includes('..')) {
                    return { ok: false, error: `Invalid registry path: ${rel || '(empty)'}` };
                }
                const abs = path.normalize(path.join(adminDir, rel));
                if (!abs.startsWith(adminNorm)) {
                    return { ok: false, error: 'Registry path outside admin folder.' };
                }
                fs.mkdirSync(path.dirname(abs), { recursive: true });
                const data = entry?.data ?? null;
                fs.writeFileSync(abs, JSON.stringify(data, null, 2) + '\n', 'utf8');
                written.push(rel);
            }
            const companyIds = new Set(
                (Array.isArray(bundle?.registry?.companies) ? bundle.registry.companies : [])
                    .map(c => String(c?.company_id || '').trim())
                    .filter(Boolean),
            );
            const companiesDir = path.join(adminDir, 'companies');
            if (fs.existsSync(companiesDir)) {
                for (const name of fs.readdirSync(companiesDir)) {
                    if (!companyIds.has(name)) {
                        fs.rmSync(path.join(companiesDir, name), { recursive: true, force: true });
                    }
                }
            }
            return { ok: true, written, adminDir };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });
}

function isAdminModeSku() {
    const sku = detectSkuFromResources();
    return !app.isPackaged || sku === 'ADMIN_TVC';
}

function registerAdminSeatLicenseIpc() {
    ipcMain.handle('tvc:get-license-signing-status', () => {
        try {
            if (!isAdminModeSku()) {
                return { ok: false, configured: false, error: 'Admin Mode only.' };
            }
            const settings = readSettings();
            const keyPath = resolvePrivateKeyPath({
                settingsPath: settings.licensePrivateKeyPath,
                root: appRoot(),
            });
            return {
                ok: true,
                configured: !!keyPath,
                path: keyPath || null,
            };
        } catch (e) {
            return { ok: false, configured: false, error: e.message || String(e) };
        }
    });

    ipcMain.handle('tvc:pick-license-private-key', async () => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            const win = BrowserWindow.getFocusedWindow() || mainWindow;
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
                title: 'Select license signing key (private.pem)',
                properties: ['openFile'],
                filters: [{ name: 'PEM', extensions: ['pem'] }],
            });
            if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
            const settings = readSettings();
            settings.licensePrivateKeyPath = filePaths[0];
            writeSettings(settings);
            return { ok: true, path: filePaths[0] };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });

    ipcMain.handle('tvc:issue-seat-license', (_evt, payload) => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            const settings = readSettings();
            const pem = readPrivateKeyPem({
                settingsPath: settings.licensePrivateKeyPath,
                root: appRoot(),
            });
            const result = issueSeatLicense(payload?.request, {
                months: Number(payload?.months) || 3,
                sku: payload?.sku || null,
                companyId: payload?.companyId || null,
                vesselId: payload?.vesselId || null,
                allowedVesselIds: payload?.allowedVesselIds || null,
                privateKeyPem: pem,
            });
            return { ok: true, ...result };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });

    ipcMain.handle('tvc:export-seat-license', async (_evt, payload) => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            const license = payload?.license;
            if (!license) return { ok: false, error: 'No license to save.' };
            const defaultName = String(payload?.suggestedFilename || 'license-seat.json').replace(/[\\/]/g, '_');
            const win = BrowserWindow.getFocusedWindow() || mainWindow;
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
                title: 'Save seat license.json',
                defaultPath: defaultName,
                filters: [{ name: 'JSON', extensions: ['json'] }],
            });
            if (canceled || !filePath) return { ok: false, canceled: true };
            fs.writeFileSync(filePath, JSON.stringify(license, null, 2), 'utf8');
            return { ok: true, path: filePath };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });
}

const SETUP_SKU_RES = {
    HQ_OFFICE: /HQ_OFFICE/i,
    VESSEL_MASTER: /VESSEL_MASTER/i,
    VESSEL_ENGINE: /VESSEL_ENGINE/i,
    VESSEL_DECK: /VESSEL_DECK/i,
};

function parseSetupSemver(filename) {
    const m = String(filename || '').match(/-(\d+\.\d+\.\d+)-Setup\.exe$/i);
    return m ? m[1] : '';
}

function compareSemver(a, b) {
    const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d;
    }
    return 0;
}

function listLatestSetupFiles(dir, preferredVersion) {
    const all = listSetupFiles(dir);
    if (!all.length) return [];
    const pref = String(preferredVersion || readPackageVersion(appRoot()) || '').trim();
    const bySku = new Map();
    for (const s of all) {
        const ver = parseSetupSemver(s.filename);
        const prev = bySku.get(s.sku);
        if (!prev) {
            bySku.set(s.sku, s);
            continue;
        }
        const prevVer = parseSetupSemver(prev.filename);
        if (pref) {
            if (ver === pref && prevVer !== pref) bySku.set(s.sku, s);
            else if (prevVer === pref) continue;
            else if (compareSemver(ver, prevVer) > 0) bySku.set(s.sku, s);
        } else if (compareSemver(ver, prevVer) > 0) {
            bySku.set(s.sku, s);
        }
    }
    return [...bySku.values()];
}

function candidateSetupsSourceDirs(settings) {
    const root = appRoot();
    const candidates = [];
    const configured = String(settings?.setupsSourceDir || '').trim();
    if (configured) candidates.push(configured);
    candidates.push(path.join(root, 'dist'));
    if (app.isPackaged) {
        candidates.push(path.join(path.dirname(process.execPath), 'dist'));
        candidates.push(path.join(app.getPath('documents'), 'thevesselcode-pms', 'dist'));
    } else {
        candidates.push(path.join(process.cwd(), 'dist'));
    }
    const seen = new Set();
    return candidates.filter(d => {
        const n = path.normalize(d);
        if (seen.has(n)) return false;
        seen.add(n);
        return fs.existsSync(n);
    });
}

function resolveSetupsSource(settings) {
    const s = settings || readSettings();
    const preferredVersion = readPackageVersion(appRoot());
    const candidates = candidateSetupsSourceDirs(s);
    let bestDir = null;
    let bestSetups = [];
    let bestScore = -1;
    for (const dir of candidates) {
        const setups = listLatestSetupFiles(dir, preferredVersion);
        const score = setups.length;
        if (score > bestScore) {
            bestScore = score;
            bestDir = dir;
            bestSetups = setups;
        }
    }
    if (bestDir && bestScore > 0 && String(s.setupsSourceDir || '').trim() !== bestDir) {
        s.setupsSourceDir = bestDir;
        writeSettings(s);
    }
    const appVersion = preferredVersion
        || parseSetupSemver(bestSetups[0]?.filename)
        || '';
    return { dir: bestDir, setups: bestSetups, appVersion };
}

function resolveSetupsSourceDir(settings) {
    return resolveSetupsSource(settings).dir;
}

function listSetupFiles(dir) {
    if (!dir || !fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        if (!/-Setup\.exe$/i.test(name)) continue;
        for (const [sku, re] of Object.entries(SETUP_SKU_RES)) {
            if (re.test(name)) {
                const full = path.join(dir, name);
                try {
                    out.push({
                        sku,
                        filename: name,
                        path: full,
                        bytes: fs.statSync(full).size,
                    });
                } catch (_) { /* skip */ }
                break;
            }
        }
    }
    return out;
}

let releaseBuildProcess = null;

function releaseBuildScriptPath(root) {
    return path.join(root, 'scripts', 'build-release.mjs');
}

function canRunReleaseBuild(root) {
    return fs.existsSync(releaseBuildScriptPath(root))
        && fs.existsSync(path.join(root, 'package.json'));
}

function readPackageVersion(root) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        return String(pkg.version || '').trim();
    } catch (_) {
        return '';
    }
}

function findAppUpdateZip(distDir, version) {
    if (!distDir || !fs.existsSync(distDir) || !version) return null;
    const canonical = `TVC-PMS App Update v${version}.zip`;
    const canonicalPath = path.join(distDir, canonical);
    if (fs.existsSync(canonicalPath)) return canonicalPath;
    const prefix = `tvc_app_update_${version.replace(/[^\w.-]+/g, '_')}_`;
    const matches = fs.readdirSync(distDir)
        .filter(n => (n === canonical || n.startsWith(prefix) || n.startsWith('TVC-PMS App Update v')) && n.endsWith('.zip'))
        .sort()
        .reverse();
    return matches.length ? path.join(distDir, matches[0]) : null;
}

function findHandoffFile(releaseDir, version) {
    if (!releaseDir || !fs.existsSync(releaseDir) || !version) return null;
    const prefix = `v${version}-handoff-`;
    const matches = fs.readdirSync(releaseDir)
        .filter(n => n.startsWith(prefix) && n.endsWith('.txt'))
        .sort()
        .reverse();
    return matches.length ? path.join(releaseDir, matches[0]) : null;
}

function fileMeta(absPath) {
    if (!absPath || !fs.existsSync(absPath)) return null;
    try {
        const st = fs.statSync(absPath);
        return {
            filename: path.basename(absPath),
            path: absPath,
            bytes: st.size,
        };
    } catch (_) {
        return null;
    }
}

function gatherReleaseArtifacts(root) {
    const version = readPackageVersion(root);
    const distDir = path.join(root, 'dist');
    const releaseDir = path.join(root, 'release');
    const setups = listLatestSetupFiles(distDir, version);
    const appUpdateZip = findAppUpdateZip(distDir, version);
    const handoff = findHandoffFile(releaseDir, version);
    let config = null;
    const configPath = version ? path.join(releaseDir, `v${version}.json`) : null;
    if (configPath && fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (_) { /* ignore */ }
    }
    return {
        version,
        distDir: fs.existsSync(distDir) ? distDir : null,
        releaseDir: fs.existsSync(releaseDir) ? releaseDir : null,
        configPath: configPath && fs.existsSync(configPath) ? configPath : null,
        config,
        setups,
        appUpdateZip: fileMeta(appUpdateZip),
        handoff: fileMeta(handoff),
    };
}

function sendReleaseLog(webContents, line) {
    const text = String(line || '');
    if (!text) return;
    if (webContents && !webContents.isDestroyed()) {
        webContents.send('tvc:release-log', text);
    }
}

function registerAdminReleaseIpc() {
    ipcMain.handle('tvc:get-release-info', () => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            const root = appRoot();
            const version = readPackageVersion(root);
            const buildable = canRunReleaseBuild(root);
            const artifacts = gatherReleaseArtifacts(root);
            const exportFolder = resolveExportFolder(readSettings());
            return {
                ok: true,
                root,
                buildable,
                buildableMessage: buildable
                    ? null
                    : 'Release build requires the development project (npm run electron:admin from source checkout).',
                version,
                exportFolder,
                artifacts,
            };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });

    ipcMain.handle('tvc:list-release-artifacts', () => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            return { ok: true, artifacts: gatherReleaseArtifacts(appRoot()) };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });

    ipcMain.handle('tvc:run-admin-release', async (evt) => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            if (releaseBuildProcess) return { ok: false, error: 'Release build already running.' };
            const root = appRoot();
            if (!canRunReleaseBuild(root)) {
                return {
                    ok: false,
                    error: 'Release build is only available from the development project root (scripts/build-release.mjs). Run npm run electron:admin from the repo.',
                };
            }
            const version = readPackageVersion(root);
            const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            return await new Promise((resolve) => {
                let logTail = '';
                const appendLog = (chunk) => {
                    logTail += chunk;
                    const lines = logTail.split(/\r?\n/);
                    logTail = lines.pop() || '';
                    for (const line of lines) sendReleaseLog(evt.sender, line);
                };
                releaseBuildProcess = spawn(npmCmd, ['run', 'release'], {
                    cwd: root,
                    shell: true,
                    env: process.env,
                });
                releaseBuildProcess.stdout?.on('data', (d) => appendLog(String(d)));
                releaseBuildProcess.stderr?.on('data', (d) => appendLog(String(d)));
                releaseBuildProcess.on('error', (err) => {
                    releaseBuildProcess = null;
                    resolve({ ok: false, error: err.message || String(err) });
                });
                releaseBuildProcess.on('close', (code) => {
                    if (logTail) sendReleaseLog(evt.sender, logTail);
                    releaseBuildProcess = null;
                    if (code !== 0) {
                        resolve({ ok: false, error: `Release build failed (exit ${code}).` });
                        return;
                    }
                    const settings = readSettings();
                    const distDir = path.join(root, 'dist');
                    if (fs.existsSync(distDir)) {
                        settings.setupsSourceDir = distDir;
                        writeSettings(settings);
                    }
                    resolve({
                        ok: true,
                        version,
                        artifacts: gatherReleaseArtifacts(root),
                    });
                });
            });
        } catch (e) {
            releaseBuildProcess = null;
            return { ok: false, error: e.message || String(e) };
        }
    });

    ipcMain.handle('tvc:cancel-admin-release', () => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            if (!releaseBuildProcess) return { ok: false, error: 'No release build running.' };
            releaseBuildProcess.kill();
            releaseBuildProcess = null;
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });

    ipcMain.handle('tvc:export-release-artifacts', (_evt, payload) => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            const root = appRoot();
            const artifacts = gatherReleaseArtifacts(root);
            const version = String(payload?.version || artifacts.version || '').trim();
            const includeSetups = payload?.includeSetups !== false;
            const includeAppUpdate = payload?.includeAppUpdate !== false;
            const includeHandoff = payload?.includeHandoff !== false;
            const settings = readSettings();
            const baseFolder = resolveExportFolder(settings);
            const date = new Date().toISOString().slice(0, 10);
            const subfolder = String(payload?.subfolder || `TVC-Release-v${version || 'unknown'}-${date}`).replace(/[\\/]/g, '_');
            const destDir = path.join(baseFolder, subfolder);
            fs.mkdirSync(destDir, { recursive: true });
            const copied = [];
            const addCopy = (meta) => {
                if (!meta?.path || !meta.filename) return;
                const dest = path.join(destDir, meta.filename);
                fs.copyFileSync(meta.path, dest);
                copied.push({
                    filename: meta.filename,
                    path: dest,
                    bytes: fs.statSync(dest).size,
                });
            };
            if (includeSetups) {
                for (const s of artifacts.setups || []) addCopy({ filename: s.filename, path: s.path, bytes: s.bytes });
            }
            if (includeAppUpdate && artifacts.appUpdateZip) addCopy(artifacts.appUpdateZip);
            if (includeHandoff && artifacts.handoff) addCopy(artifacts.handoff);
            if (!copied.length) {
                return { ok: false, error: 'No release artifacts found in dist/ or release/. Run Release build first.' };
            }
            if (artifacts.distDir && fs.existsSync(artifacts.distDir)) {
                settings.setupsSourceDir = artifacts.distDir;
                writeSettings(settings);
            }
            return { ok: true, folder: destDir, copied, version: artifacts.version };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });
}

function registerSetupExportIpc() {
    ipcMain.handle('tvc:get-setups-source', () => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            const resolved = resolveSetupsSource(readSettings());
            if (!resolved.dir) {
                return {
                    ok: true,
                    configured: false,
                    path: null,
                    setups: [],
                    appVersion: resolved.appVersion || readPackageVersion(appRoot()) || '',
                };
            }
            return {
                ok: true,
                configured: resolved.setups.length > 0,
                path: resolved.dir,
                setups: resolved.setups,
                appVersion: resolved.appVersion || '',
                autoDetected: true,
            };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });

    ipcMain.handle('tvc:pick-setups-source-folder', async () => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            const win = BrowserWindow.getFocusedWindow() || mainWindow;
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
                title: 'Select folder containing Setup.exe (usually dist/)',
                properties: ['openDirectory'],
            });
            if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
            const folder = filePaths[0];
            const settings = readSettings();
            settings.setupsSourceDir = folder;
            writeSettings(settings);
            return {
                ok: true,
                path: folder,
                setups: listSetupFiles(folder),
            };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });

    ipcMain.handle('tvc:read-setup-file', (_evt, payload) => {
        try {
            if (!isAdminModeSku()) return { ok: false, error: 'Admin Mode only.' };
            const filename = path.basename(String(payload?.filename || ''));
            if (!filename) return { ok: false, error: 'Missing filename.' };
            const dir = resolveSetupsSourceDir(readSettings());
            if (!dir) return { ok: false, error: 'Setups source folder not configured.' };
            const abs = path.normalize(path.join(dir, filename));
            const dirNorm = path.normalize(dir + path.sep);
            if (!abs.startsWith(dirNorm)) return { ok: false, error: 'Invalid path.' };
            if (!fs.existsSync(abs)) return { ok: false, error: 'Setup file not found.' };
            const buf = fs.readFileSync(abs);
            return { ok: true, filename, bytes: Array.from(buf) };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });
}

function registerSettingsIpc() {
    ipcMain.handle('tvc:get-settings', () => {
        const settings = readSettings();
        const exportFolder = resolveExportFolder(settings);
        const configured = String(settings.exportFolder || '').trim();
        return {
            exportFolder,
            configuredExportFolder: configured || null,
            downloadsPath: app.getPath('downloads'),
        };
    });

    ipcMain.handle('tvc:set-export-folder', (_evt, folder) => {
        const settings = readSettings();
        const next = String(folder || '').trim();
        if (!next) {
            delete settings.exportFolder;
        } else if (!fs.existsSync(next)) {
            return { ok: false, error: 'Folder does not exist.' };
        } else {
            settings.exportFolder = next;
        }
        writeSettings(settings);
        return { ok: true, exportFolder: resolveExportFolder(settings) };
    });

    ipcMain.handle('tvc:pick-export-folder', async () => {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;
        const result = await dialog.showOpenDialog(win, {
            title: 'Select default export folder',
            properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };
        const folder = result.filePaths[0];
        const settings = readSettings();
        settings.exportFolder = folder;
        writeSettings(settings);
        return { ok: true, exportFolder: folder };
    });

    ipcMain.handle('tvc:open-export-folder', () => {
        const folder = resolveExportFolder(readSettings());
        if (!fs.existsSync(folder)) return { ok: false, error: 'Folder does not exist.' };
        shell.openPath(folder);
        return { ok: true, exportFolder: folder };
    });

    ipcMain.handle('tvc:save-export-file', (_evt, payload) => {
        try {
            const filename = String(payload?.filename || '').trim();
            if (!filename) return { ok: false, error: 'Missing filename.' };
            const safeName = path.basename(filename);
            const folder = resolveExportFolder(readSettings());
            fs.mkdirSync(folder, { recursive: true });
            const raw = payload?.bytes;
            let bytes;
            if (Buffer.isBuffer(raw)) bytes = raw;
            else if (ArrayBuffer.isView(raw)) bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
            else if (raw instanceof ArrayBuffer) bytes = Buffer.from(raw);
            else bytes = Buffer.from(Array.isArray(raw) ? raw : []);
            if (!bytes.length) return { ok: false, error: 'Export file is empty.' };
            const fullPath = path.join(folder, safeName);
            fs.writeFileSync(fullPath, bytes);
            return { ok: true, path: fullPath, folder };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });
}

function appRoot() {
    return app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
}

function computeWindowBounds() {
    const { screen } = require('electron');
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(Math.max(1100, Math.floor(area.width * WIDTH_RATIO)), area.width - 40);
    const height = Math.min(Math.max(720, Math.floor(area.height * HEIGHT_RATIO)), area.height - 40);
    const x = Math.floor(area.x + (area.width - width) / 2);
    const y = Math.floor(area.y + (area.height - height) / 2);
    return { width, height, x, y };
}

function detectSkuFromResources() {
    return detectSkuHint({ getAppPath: () => app.getAppPath() })
        || process.env.TVC_BUILD_SKU
        || process.env.TVC_DEV_SKU
        || '';
}

function registerProtocol() {
    const root = appRoot();
    const rootNorm = path.normalize(root + path.sep);
    protocol.handle(PROTOCOL, async (request) => {
        try {
            const url = new URL(request.url);
            let rel = decodeURIComponent(url.pathname || '/');
            if (rel.startsWith('/')) rel = rel.slice(1);
            // strip cache-bust query from pathname if present (pathname shouldn't have it, but keep safe)
            rel = rel.split('?')[0];
            if (!rel || rel.endsWith('/')) rel += 'index.html';
            const abs = path.normalize(path.join(root, rel));
            if (!abs.startsWith(rootNorm) && abs !== path.normalize(root)) {
                return new Response('Forbidden', { status: 403 });
            }
            if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
                return new Response('Not found', { status: 404 });
            }
            const data = fs.readFileSync(abs);
            const ext = path.extname(abs).toLowerCase();
            const types = {
                '.html': 'text/html; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.json': 'application/json; charset=utf-8',
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.ico': 'image/x-icon',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2',
                '.xls': 'application/vnd.ms-excel',
                '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                '.csv': 'text/csv; charset=utf-8',
                '.zip': 'application/zip',
                '.map': 'application/json',
            };
            return new Response(data, {
                headers: {
                    'Content-Type': types[ext] || 'application/octet-stream',
                    'Cache-Control': 'no-store',
                },
            });
        } catch (e) {
            return new Response(String(e.message || e), { status: 500 });
        }
    });
}

function refreshLicense(options = {}) {
    const result = ensureLicense(app);
    licenseState = {
        ok: !!result.ok,
        status: result.status || null,
        message: result.message || (result.ok ? 'OK' : 'License invalid'),
        code: result.code || null,
    };
    if (licenseState.ok && licenseState.status) {
        migrateSkuDirToLicensed(app, licenseState.status);
        applyInstallDisplayName(app, mainWindow, licenseState, options);
    } else if (licenseState.status?.sku || app.isPackaged) {
        applyBestEffortDisplayName(app, mainWindow, licenseState, options);
    }
    return licenseState;
}

function resolveAppIcon() {
    const candidates = [
        path.join(appRoot(), 'build', 'icon.ico'),
        path.join(appRoot(), 'build', 'icon.png'),
        path.join(appRoot(), 'icons', 'app-icon.png'),
    ];
    return candidates.find(p => fs.existsSync(p)) || undefined;
}

function createWindow() {
    const bounds = computeWindowBounds();
    const iconPath = resolveAppIcon();
    const iconImage = iconPath ? nativeImage.createFromPath(iconPath) : null;
    const windowTitle = licenseState.status
        ? resolveDisplayName(licenseState.status)
        : 'THE VESSEL CODE — TVC-PMS';
    mainWindow = new BrowserWindow({
        ...bounds,
        title: windowTitle,
        icon: iconPath,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    // Windows title bar picks the matching size from a multi-res .ico more reliably via setIcon.
    if (iconImage && !iconImage.isEmpty()) {
        mainWindow.setIcon(iconImage);
    }
    // Dev: always bypass HTTP cache so logo/asset edits show immediately
    if (!app.isPackaged) {
        mainWindow.webContents.session.clearCache().catch(() => {});
    }

    mainWindow.once('ready-to-show', () => {
        applyBestEffortDisplayName(app, mainWindow, licenseState);
        mainWindow.show();
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        const blank = !url || url === 'about:blank';
        if (blank) {
            // Print / Preview — allow in-app blank window (document.write from renderer)
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    width: 980,
                    height: 760,
                    autoHideMenuBar: true,
                    webPreferences: {
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: true,
                    },
                },
            };
        }
        if (/^https?:\/\//i.test(url)) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    if (!licenseState.ok) {
        mainWindow.loadFile(path.join(__dirname, 'license-gate.html'));
        return;
    }

    mainWindow.loadURL(`${PROTOCOL}://localhost/index.html`);
}

app.whenReady().then(() => {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
        app.quit();
        return;
    }
    app.on('second-instance', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
    registerProtocol();
    refreshLicense();

    ipcMain.handle('tvc:get-license', () => ({
        ok: licenseState.ok,
        status: licenseState.status,
        message: licenseState.message,
        code: licenseState.code,
    }));
    ipcMain.handle('tvc:get-app-info', () => ({
        version: app.getVersion(),
        packaged: app.isPackaged,
        userData: app.getPath('userData'),
        protocol: PROTOCOL,
    }));
    ipcMain.handle('tvc:export-machine-request', async () => {
        try {
            const req = buildMachineRequest(app);
            const defaultName = `${String(req.sku || 'sku').toLowerCase()}_machine_request_${req.machineId.slice(0, 8)}.json`;
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
                title: 'Export machine request',
                defaultPath: defaultName,
                filters: [{ name: 'JSON', extensions: ['json'] }],
            });
            if (canceled || !filePath) {
                return { ok: false, message: 'Export cancelled.' };
            }
            fs.writeFileSync(filePath, JSON.stringify(req, null, 2), 'utf8');
            return { ok: true, path: filePath, request: req };
        } catch (e) {
            return { ok: false, message: e.message || String(e) };
        }
    });
    ipcMain.handle('tvc:import-seat-license', async () => {
        try {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
                title: 'Import seat license.json',
                properties: ['openFile'],
                filters: [{ name: 'License JSON', extensions: ['json'] }],
            });
            if (canceled || !filePaths?.length) {
                return { ok: false, message: 'Import cancelled.' };
            }
            const result = applyLicenseFile(app, filePaths[0]);
            if (!result.ok) {
                return {
                    ok: false,
                    code: result.code || null,
                    message: result.message || 'License import failed.',
                };
            }
            refreshLicense({ syncShortcuts: true });
            if (licenseState.ok && licenseState.status) {
                migrateSkuDirToLicensed(app, licenseState.status);
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL(`${PROTOCOL}://localhost/index.html`);
            }
            return {
                ok: true,
                status: licenseState.status,
                message: 'Seat license applied.',
            };
        } catch (e) {
            return { ok: false, message: e.message || String(e) };
        }
    });
    /** App Update: write Setup.exe to temp and launch — does not touch IndexedDB. */
    ipcMain.handle('tvc:install-app-update', async (_evt, payload) => {
        try {
            const filename = String(payload?.filename || 'TVC-PMS-Setup.exe').replace(/[\\/]/g, '_');
            const bytes = payload?.bytes;
            if (!Array.isArray(bytes) || !bytes.length) {
                return { ok: false, message: 'Setup bytes missing.' };
            }
            const dir = path.join(os.tmpdir(), 'tvc-app-update');
            fs.mkdirSync(dir, { recursive: true });
            const dest = path.join(dir, filename);
            fs.writeFileSync(dest, Buffer.from(bytes));
            const openResult = await shell.openPath(dest);
            if (openResult) {
                return { ok: false, message: openResult, path: dest };
            }
            setTimeout(() => {
                try { app.quit(); } catch (_) { /* ignore */ }
            }, 800);
            return {
                ok: true,
                path: dest,
                message: 'Installer launched. Finish the setup wizard, then reopen TVC-PMS. Operational data (Master/History) stays in AppData.',
            };
        } catch (e) {
            return { ok: false, message: e.message || String(e) };
        }
    });
    registerSettingsIpc();
    registerAdminRegistryIpc();
    registerAdminSeatLicenseIpc();
    registerSetupExportIpc();
    registerAdminReleaseIpc();
    registerPrintPreviewIpc();

    createWindow();

    // Activation gate is expected on first run — only alert on hard failures.
    if (!licenseState.ok && licenseState.code !== 'LICENSE_NEED_ACTIVATION') {
        dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'TVC-PMS License',
            message: 'License check failed',
            detail: licenseState.message || 'Invalid license',
        }).catch(() => {});
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
