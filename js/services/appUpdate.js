/* THE VESSEL CODE — App Update package (Admin → HQ/Vessel). Never touches Master/History DB. */
const TVC_AppUpdate = (function () {
    const KIND = 'TVC_APP_UPDATE';
    const VERSION = 1;
    const JSON_NAME = 'tvc_app_update.json';
    const SETUPS_DIR = 'setups/';
    const LS_LAST = 'tvc_app_update_last_applied';

    function isAdminUser(user) {
        return !!(user && typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isAdminAccount?.(user));
    }

    function currentAppVersion() {
        return '1.0.2';
    }

    async function resolveAppVersion() {
        try {
            if (typeof window !== 'undefined' && window.tvcElectron?.getAppInfo) {
                const info = await window.tvcElectron.getAppInfo();
                if (info?.version) return String(info.version);
            }
        } catch (_) { /* ignore */ }
        try {
            const res = await fetch('package.json', { cache: 'no-store' });
            if (res.ok) {
                const pkg = await res.json();
                if (pkg?.version) return String(pkg.version);
            }
        } catch (_) { /* ignore */ }
        return currentAppVersion();
    }

    function normalizeManifest(raw = {}) {
        const setups = Array.isArray(raw.setups) ? raw.setups.map(s => ({
            sku: String(s.sku || '').trim(),
            filename: String(s.filename || '').trim(),
            bytes: Number(s.bytes) || 0,
        })).filter(s => s.sku && s.filename) : [];
        return {
            kind: KIND,
            version: VERSION,
            app_version: String(raw.app_version || '').trim(),
            notes: String(raw.notes || '').trim(),
            target_skus: Array.isArray(raw.target_skus)
                ? raw.target_skus.map(s => String(s).trim()).filter(Boolean)
                : setups.map(s => s.sku),
            setups,
            exported_at: raw.exported_at || new Date().toISOString(),
            exported_by: String(raw.exported_by || '').trim(),
            affects_operational_data: false,
        };
    }

    function appUpdateZipFilename(appVersion) {
        const ver = String(appVersion || '').trim() || '1.0.2';
        return `TVC-PMS App Update v${ver}.zip`;
    }

    async function buildZip(user, opts = {}) {
        if (!isAdminUser(user)) {
            throw Object.assign(new Error('App Update Export는 Admin Mode(tvc)에서만 가능합니다.'), { code: 'FORBIDDEN' });
        }
        if (typeof JSZip === 'undefined') throw new Error('JSZip이 로드되지 않았습니다.');

        const appVersion = String(opts.appVersion || '').trim();
        if (!appVersion) throw new Error('App version is required (e.g. 2.0.1).');
        const notes = String(opts.notes || '').trim();
        const files = Array.isArray(opts.setupFiles) ? opts.setupFiles : [];
        if (!files.length) {
            throw new Error('Attach at least one Setup.exe (from dist/) for the target HQ/Vessel SKU.');
        }

        const zip = new JSZip();
        const setups = [];
        for (const f of files) {
            const sku = String(f.sku || '').trim();
            const file = f.file;
            if (!sku || !file) continue;
            const name = String(file.name || `${sku}-Setup.exe`).replace(/[\\/]/g, '_');
            const buf = await file.arrayBuffer();
            zip.file(SETUPS_DIR + name, buf);
            setups.push({ sku, filename: name, bytes: buf.byteLength });
        }
        if (!setups.length) throw new Error('No valid Setup files attached.');

        const manifest = normalizeManifest({
            app_version: appVersion,
            notes,
            setups,
            target_skus: setups.map(s => s.sku),
            exported_at: new Date().toISOString(),
            exported_by: user.username || 'tvc',
        });
        zip.file(JSON_NAME, JSON.stringify(manifest, null, 2));

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const filename = appUpdateZipFilename(appVersion);
        return { blob, filename, manifest };
    }

    async function readSetupBytesFromSource(filename) {
        if (!window.tvcElectron?.readSetupFile) {
            throw new Error('Setup export requires Electron Admin Mode.');
        }
        const r = await window.tvcElectron.readSetupFile({ filename });
        if (!r?.ok) throw new Error(r?.error || 'Could not read Setup file.');
        return new Uint8Array(r.bytes || []);
    }

    /** Build shared App Update ZIP from dist/ Setup.exe (Admin — no manual attach). */
    async function buildZipFromSource(user, opts = {}) {
        if (!isAdminUser(user)) {
            throw Object.assign(new Error('App Update Export는 Admin Mode(tvc)에서만 가능합니다.'), { code: 'FORBIDDEN' });
        }
        if (typeof JSZip === 'undefined') throw new Error('JSZip이 로드되지 않았습니다.');

        const appVersion = String(opts.appVersion || '').trim();
        if (!appVersion) throw new Error('App version is required (e.g. 1.0.2).');
        const notes = String(opts.notes || '').trim();
        const selectedSkus = Array.isArray(opts.skus) && opts.skus.length
            ? opts.skus
            : ['HQ_OFFICE', 'VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK'];
        const sourceSetups = Array.isArray(opts.sourceSetups) ? opts.sourceSetups : [];
        const bySku = new Map(sourceSetups.map(s => [s.sku, s]));

        const zip = new JSZip();
        const setups = [];
        for (const sku of selectedSkus) {
            const meta = bySku.get(sku);
            if (!meta?.filename) continue;
            const buf = await readSetupBytesFromSource(meta.filename);
            const name = String(meta.filename).replace(/[\\/]/g, '_');
            zip.file(SETUPS_DIR + name, buf);
            setups.push({ sku, filename: name, bytes: buf.byteLength });
        }
        if (!setups.length) {
            throw new Error('No Setup.exe files found. Run npm run dist or Release build, then set the dist folder.');
        }

        const manifest = normalizeManifest({
            app_version: appVersion,
            notes,
            setups,
            target_skus: setups.map(s => s.sku),
            exported_at: new Date().toISOString(),
            exported_by: user.username || 'tvc',
        });
        zip.file(JSON_NAME, JSON.stringify(manifest, null, 2));
        zip.file('README.txt', [
            'TVC-PMS App Update (shared — all contracted pool vessels)',
            '',
            `App version: ${manifest.app_version}`,
            '',
            'For vessels already using TVC-PMS (data on PC):',
            '  HQ / Vessel → Data Export & Import → App Update → Import → Install update',
            '',
            'Does NOT replace Master Excel, Work History, or IndexedDB operational data.',
            '',
            'Setups in this package:',
            ...setups.map(s => `  - ${s.sku}: ${s.filename}`),
        ].join('\r\n'));

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const filename = appUpdateZipFilename(appVersion);
        return { blob, filename, manifest };
    }

    async function parseFile(file) {
        if (!file) throw new Error('No file selected.');
        if (typeof JSZip === 'undefined') throw new Error('JSZip이 로드되지 않았습니다.');
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const jsonFile = zip.file(JSON_NAME)
            || Object.keys(zip.files).map(n => zip.file(n)).find(f => f && /tvc_app_update\.json$/i.test(f.name));
        if (!jsonFile) throw new Error('Not an App Update package (missing tvc_app_update.json).');
        const manifest = normalizeManifest(JSON.parse(await jsonFile.async('string')));
        if (manifest.kind !== KIND) throw new Error('Invalid App Update package kind.');
        return { zip, manifest, sourceFile: file };
    }

    function isAppUpdateZipName(name) {
        const n = String(name || '');
        return /TVC-PMS App Update v/i.test(n)
            || /app_update/i.test(n)
            || /tvc_app_update/i.test(n);
    }

    async function detectInZip(zip) {
        const names = Object.keys(zip.files || {});
        return names.some(f => /tvc_app_update\.json$/i.test(f));
    }

    function resolveSetupForSku(manifest, sku) {
        const want = String(sku || '').trim().toUpperCase();
        if (!want) return null;
        return (manifest.setups || []).find(s => String(s.sku).toUpperCase() === want) || null;
    }

    async function validateForInstall(parsed, licenseStatus) {
        const sku = String(licenseStatus?.sku || '').trim();
        if (!sku) {
            return { ok: false, error: 'Current installation SKU unknown. Open App Update only in Electron HQ/Vessel.' };
        }
        if (String(sku).toUpperCase() === 'ADMIN_TVC') {
            return { ok: false, error: 'Admin Mode does not install App Update onto itself. Export only.' };
        }
        const setup = resolveSetupForSku(parsed.manifest, sku);
        if (!setup) {
            const listed = (parsed.manifest.target_skus || []).join(', ') || '—';
            return {
                ok: false,
                error: `This package has no Setup for SKU ${sku}. Package targets: ${listed}`,
            };
        }
        const entry = parsed.zip.file(SETUPS_DIR + setup.filename);
        if (!entry) {
            return { ok: false, error: `Setup file missing in package: ${setup.filename}` };
        }
        return { ok: true, sku, setup, entry };
    }

    async function extractSetupBytes(entry) {
        const buf = await entry.async('uint8array');
        return buf;
    }

    function getLastApplied() {
        try {
            const raw = localStorage.getItem(LS_LAST);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function setLastApplied(info) {
        try {
            localStorage.setItem(LS_LAST, JSON.stringify({
                app_version: info.app_version,
                sku: info.sku,
                applied_at: new Date().toISOString(),
                filename: info.filename || null,
            }));
        } catch (_) { /* ignore */ }
    }

    /**
     * Apply update: write Setup to temp via Electron and launch installer.
     * Does not read/write PMS/SPARE Master or Work History stores.
     */
    async function applyUpdate(parsed, licenseStatus) {
        const check = await validateForInstall(parsed, licenseStatus);
        if (!check.ok) return check;

        const bytes = await extractSetupBytes(check.entry);
        if (!window.tvcElectron?.installAppUpdate) {
            return {
                ok: false,
                error: 'App Update install requires the Electron app. Save the ZIP and run the Setup.exe inside setups/ manually.',
                manualSetup: check.setup.filename,
            };
        }
        const result = await window.tvcElectron.installAppUpdate({
            filename: check.setup.filename,
            bytes: Array.from(bytes),
            appVersion: parsed.manifest.app_version,
            sku: check.sku,
        });
        if (!result?.ok) {
            return { ok: false, error: result?.message || result?.error || 'Failed to launch installer.' };
        }
        setLastApplied({
            app_version: parsed.manifest.app_version,
            sku: check.sku,
            filename: check.setup.filename,
        });
        return {
            ok: true,
            message: result.message || 'Installer launched. Complete the setup wizard, then reopen TVC-PMS.',
            path: result.path || null,
        };
    }

    return {
        KIND,
        JSON_NAME,
        isAdminUser,
        currentAppVersion,
        resolveAppVersion,
        buildZip,
        buildZipFromSource,
        parseFile,
        detectInZip,
        isAppUpdateZipName,
        validateForInstall,
        applyUpdate,
        getLastApplied,
        resolveSetupForSku,
    };
})();

if (typeof window !== 'undefined') window.TVC_AppUpdate = TVC_AppUpdate;
