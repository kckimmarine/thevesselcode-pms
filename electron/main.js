/* THE VESSEL CODE — Electron main process */
'use strict';

const { app, BrowserWindow, protocol, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { ensureLicense } = require('./license');

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
        const filename = String(payload?.filename || '').trim();
        if (!filename) return { ok: false, error: 'Missing filename.' };
        const safeName = path.basename(filename);
        const folder = resolveExportFolder(readSettings());
        fs.mkdirSync(folder, { recursive: true });
        const bytes = Buffer.from(payload?.bytes || []);
        const fullPath = path.join(folder, safeName);
        fs.writeFileSync(fullPath, bytes);
        return { ok: true, path: fullPath, folder };
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
    const resourcesLicense = path.join(process.resourcesPath || '', 'license.json');
    try {
        if (fs.existsSync(resourcesLicense)) {
            const lic = JSON.parse(fs.readFileSync(resourcesLicense, 'utf8'));
            if (lic.sku) return String(lic.sku);
        }
    } catch (_) { /* ignore */ }
    return process.env.TVC_BUILD_SKU || process.env.TVC_DEV_SKU || '';
}

function applySkuUserData() {
    const sku = detectSkuFromResources();
    if (!sku) return;
    process.env.TVC_BUILD_SKU = sku;
    const base = app.getPath('userData');
    app.setPath('userData', path.join(path.dirname(base), `tvc-pms-${sku}`));
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

function refreshLicense() {
    const result = ensureLicense(app);
    licenseState = {
        ok: !!result.ok,
        status: result.status || null,
        message: result.message || (result.ok ? 'OK' : 'License invalid'),
        code: result.code || null,
    };
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
    mainWindow = new BrowserWindow({
        ...bounds,
        title: 'THE VESSEL CODE — TVC-PMS',
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

    mainWindow.once('ready-to-show', () => mainWindow.show());
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
    applySkuUserData();
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
    registerSettingsIpc();
    registerPrintPreviewIpc();

    createWindow();

    if (!licenseState.ok) {
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
