/* THE VESSEL CODE — Universal Setup handoff export (Admin) */
const TVC_SetupExport = (function () {
    const KIND = 'TVC_SETUP_HANDOFF';
    const VERSION = 1;
    const JSON_NAME = 'tvc_setup_handoff.json';
    const SETUPS_DIR = 'setups/';
    const HANDOFF_SKUS = ['HQ_OFFICE', 'VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK'];

    function isAdminUser(user) {
        return !!(user && typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isAdminAccount?.(user));
    }

    async function getSourceStatus() {
        if (!window.tvcElectron?.getSetupsSource) {
            return { configured: false, path: null, setups: [], message: 'Setup export requires Electron Admin Mode.' };
        }
        const r = await window.tvcElectron.getSetupsSource();
        if (!r?.ok) throw new Error(r?.error || 'Could not read setups folder.');
        return r;
    }

    async function pickSourceFolder() {
        if (!window.tvcElectron?.pickSetupsSourceFolder) {
            throw new Error('Setup export requires Electron Admin Mode.');
        }
        return window.tvcElectron.pickSetupsSourceFolder();
    }

    async function readSetupBytes(filename) {
        const r = await window.tvcElectron.readSetupFile({ filename });
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
        const sourceSetups = Array.isArray(opts.sourceSetups) ? opts.sourceSetups : [];
        const bySku = new Map(sourceSetups.map(s => [s.sku, s]));
        const zip = new JSZip();
        const setups = [];
        for (const sku of selectedSkus) {
            const meta = bySku.get(sku);
            if (!meta?.filename) continue;
            const buf = await readSetupBytes(meta.filename);
            const name = String(meta.filename).replace(/[\\/]/g, '_');
            zip.file(SETUPS_DIR + name, buf);
            setups.push({ sku, filename: name, bytes: buf.byteLength });
        }
        if (!setups.length) {
            throw new Error('No Setup.exe files found. Run npm run dist, then set the dist folder in Admin.');
        }
        const vessels = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.listVessels({ companyId, includeInactive: false })
            : [];
        const manifest = normalizeManifest({
            app_version: appVersion,
            company_id: companyId,
            company_name: company?.name || company?.name_en || companyId,
            notes: String(opts.notes || '').trim(),
            setups,
            exported_at: new Date().toISOString(),
            exported_by: user.username || 'tvc',
        });
        manifest.vessels = vessels.map(v => ({
            vessel_id: v.vessel_id,
            name: v.name,
            imo_no: v.imo_no,
        }));
        zip.file(JSON_NAME, JSON.stringify(manifest, null, 2));
        zip.file('README.txt', [
            'TVC-PMS Setup Handoff (Universal HQ + Vessel)',
            '',
            `Company: ${manifest.company_name} (${manifest.company_id})`,
            `App version: ${manifest.app_version}`,
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
        pickSourceFolder,
        buildZip,
    };
})();
