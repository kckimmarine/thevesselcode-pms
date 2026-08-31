/* THE VESSEL CODE — Universal Setup handoff export (Admin) */
const TVC_SetupExport = (function () {
    const KIND = 'TVC_SETUP_HANDOFF';
    const VERSION = 1;
    const JSON_NAME = 'tvc_setup_handoff.json';
    const SETUPS_DIR = 'setups/';
    const HANDOFF_SKUS = ['HQ_OFFICE', 'VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK'];

    function sanitizeSetupFilename(name) {
        return String(name || '')
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function skuRoleLabel(sku) {
        const s = String(sku || '').toUpperCase();
        if (s === 'VESSEL_DECK') return 'Deck';
        if (s === 'VESSEL_ENGINE') return 'Engine';
        if (s === 'VESSEL_MASTER') return 'Master';
        return '';
    }

    /** Handoff Setup.exe name: TVC-PMS TVC No1_Master v1.0.5 Setup.exe */
    function handoffSetupFilename(sku, companyId, vesselId, appVersion) {
        const ver = String(appVersion || '').trim();
        const verTag = ver ? ` v${ver}` : '';
        const co = sanitizeSetupFilename(companyId);
        const vessel = sanitizeSetupFilename(vesselId);
        if (String(sku).toUpperCase() === 'HQ_OFFICE' && co) {
            return sanitizeSetupFilename(`TVC-PMS ${co}${verTag} Setup.exe`);
        }
        const role = skuRoleLabel(sku);
        if (role && vessel) {
            return sanitizeSetupFilename(`TVC-PMS ${vessel}_${role}${verTag} Setup.exe`);
        }
        return sanitizeSetupFilename(`TVC-PMS ${role || sku}${verTag} Setup.exe`);
    }

    function isAdminUser(user) {
        return !!(user && typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isAdminAccount?.(user));
    }

    async function fetchPackageVersion() {
        try {
            const r = await fetch('/package.json', { cache: 'no-store' });
            if (!r.ok) return '';
            const pkg = await r.json();
            return String(pkg.version || '').trim();
        } catch (_) {
            return '';
        }
    }

    async function probeWebSetup(sku, version) {
        const filename = `TVC-PMS-${sku}-${version}-Setup.exe`;
        const url = `/downloads/${encodeURIComponent(filename)}`;
        try {
            const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
            if (!r.ok) return null;
            const bytes = parseInt(r.headers.get('content-length') || '0', 10) || 0;
            return { sku, filename, url, bytes, web: true };
        } catch (_) {
            return null;
        }
    }

    async function getWebSourceStatus() {
        const appVersion = await fetchPackageVersion();
        if (!appVersion) {
            return {
                configured: false,
                path: null,
                setups: [],
                appVersion: '',
                message: 'Could not read app version from package.json.',
            };
        }
        const setups = [];
        for (const sku of HANDOFF_SKUS) {
            const hit = await probeWebSetup(sku, appVersion);
            if (hit) setups.push(hit);
        }
        return {
            configured: setups.length > 0,
            path: setups.length ? '/downloads/' : null,
            setups,
            appVersion,
            autoDetected: true,
            message: setups.length
                ? null
                : `No Setup.exe in /downloads/ for v${appVersion}. Upload TVC-PMS-*-${appVersion}-Setup.exe to the server downloads folder.`,
        };
    }

    async function getSourceStatus() {
        if (window.tvcElectron?.getSetupsSource) {
            const r = await window.tvcElectron.getSetupsSource();
            if (!r?.ok) throw new Error(r?.error || 'Could not read setups folder.');
            return r;
        }
        return getWebSourceStatus();
    }

    async function ensureSource() {
        return getSourceStatus();
    }

    async function pickSourceFolder() {
        if (!window.tvcElectron?.pickSetupsSourceFolder) {
            throw new Error('Manual folder selection requires Electron Admin Mode.');
        }
        return window.tvcElectron.pickSetupsSourceFolder();
    }

    async function readSetupBytes(metaOrFilename) {
        const meta = typeof metaOrFilename === 'object' && metaOrFilename
            ? metaOrFilename
            : { filename: metaOrFilename };
        if (meta.url) {
            const r = await fetch(meta.url, { cache: 'no-store' });
            if (!r.ok) throw new Error(`Could not download ${meta.filename || meta.url}.`);
            return new Uint8Array(await r.arrayBuffer());
        }
        const r = await window.tvcElectron.readSetupFile({ filename: meta.filename });
        if (!r?.ok) throw new Error(r?.error || 'Could not read Setup file.');
        return new Uint8Array(r.bytes || []);
    }

    function normalizeManifest(raw = {}) {
        return {
            kind: KIND,
            version: VERSION,
            app_version: String(raw.app_version || '').trim(),
            company_id: String(raw.company_id || '').trim(),
            company_name: String(raw.company_name || '').trim(),
            notes: String(raw.notes || '').trim(),
            setups: Array.isArray(raw.setups) ? raw.setups.map(s => ({
                sku: String(s.sku || '').trim(),
                filename: String(s.filename || '').trim(),
                bytes: Number(s.bytes) || 0,
            })).filter(s => s.sku && s.filename) : [],
            exported_at: raw.exported_at || new Date().toISOString(),
            exported_by: String(raw.exported_by || '').trim(),
            universal: true,
        };
    }

    async function buildZip(user, opts = {}) {
        if (!isAdminUser(user)) {
            throw Object.assign(new Error('Setup export is Admin Mode (tvc) only.'), { code: 'FORBIDDEN' });
        }
        if (typeof JSZip === 'undefined') throw new Error('JSZip is not loaded.');
        const companyId = String(opts.companyId || '').trim();
        if (!companyId) throw new Error('Select a company.');
        const company = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.getCompany(companyId)
            : null;
        const appVersion = String(opts.appVersion || '').trim();
        if (!appVersion) throw new Error('App version is required (e.g. 1.0.0).');
        const selectedSkus = Array.isArray(opts.skus) ? opts.skus : HANDOFF_SKUS;
        let sourceSetups = Array.isArray(opts.sourceSetups) ? opts.sourceSetups : [];
        if (!sourceSetups.length) {
            const source = await ensureSource();
            sourceSetups = source.setups || [];
        }
        const bySku = new Map(sourceSetups.map(s => [s.sku, s]));
        const vessels = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.listVessels({ companyId, includeInactive: false })
            : [];
        const primaryVesselId = String(opts.vesselId || '').trim()
            || vessels[0]?.vessel_id || vessels[0]?.name || '';
        const zip = new JSZip();
        const setups = [];
        for (const sku of selectedSkus) {
            const meta = bySku.get(sku);
            if (!meta?.filename) continue;
            const buf = await readSetupBytes(meta);
            const name = handoffSetupFilename(sku, companyId, primaryVesselId, appVersion);
            zip.file(SETUPS_DIR + name, buf);
            setups.push({ sku, filename: name, bytes: buf.byteLength, source: meta.filename });
        }
        if (!setups.length) {
            const hint = window.tvcElectron?.getSetupsSource
                ? 'Run npm run dist in the project, then retry Export Setup ZIP.'
                : 'Upload Setup.exe files to /downloads/ on the server, then retry.';
            throw new Error(`No Setup.exe files found. ${hint}`);
        }
        const manifest = normalizeManifest({
            app_version: appVersion,
            company_id: companyId,
            company_name: company?.name || company?.name_en || companyId,
            notes: String(opts.notes || '').trim(),
            setups,
            exported_at: new Date().toISOString(),
            exported_by: user.username || 'tvc',
        });
        manifest.vessels = (opts.vesselId
            ? vessels.filter(v => v.vessel_id === opts.vesselId)
            : vessels
        ).map(v => ({
            vessel_id: v.vessel_id,
            name: v.name,
            imo_no: v.imo_no,
        }));
        zip.file(JSON_NAME, JSON.stringify(manifest, null, 2));
        zip.file('README.txt', [
            'TVC-PMS Setup Handoff (Path B — Universal HQ + Vessel)',
            '',
            `Company: ${manifest.company_name} (${manifest.company_id})`,
            `App version: ${manifest.app_version}`,
            '',
            'Prerequisite: vessel contract info registered in Admin registry before export.',
            '',
            '1. Install Setup.exe on each PC (HQ once · Master/Engine/Deck on vessel PC).',
            '2. Export machine request JSON from each installation.',
            '3. TVC Admin → Issue seat license (select company + vessel for vessel SKUs).',
            '4. Import seat license on each PC.',
            '',
            'Setups in this package:',
            ...setups.map(s => `  - ${s.sku}: ${s.filename}`),
        ].join('\r\n'));
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const safeCo = companyId.replace(/[^\w.-]+/g, '_');
        const filename = `tvc_setup_handoff_${safeCo}_${appVersion}_${new Date().toISOString().slice(0, 10)}.zip`;
        return { blob, filename, manifest };
    }

    return {
        HANDOFF_SKUS,
        isAdminUser,
        getSourceStatus,
        ensureSource,
        pickSourceFolder,
        buildZip,
    };
})();
