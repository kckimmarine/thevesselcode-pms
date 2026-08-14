/* THE VESSEL CODE — Admin contract registry (companies / vessels) */
const TVC_AdminRegistry = (function () {
    const REGISTRY_URL = 'admin/registry.json';
    const LS_COMPANY = 'tvc_admin_selected_company';
    const LS_VESSEL = 'tvc_admin_selected_vessel';
    const STATUS_OPTS = ['active', 'inactive'];
    const HQ_SKU_OPTS = ['HQ_OFFICE'];

    let _cache = null;

    function todayIso() {
        return new Date().toISOString().slice(0, 10);
    }

    function cleanId(id) {
        return String(id || '').trim();
    }

    function invalidIdChars(id) {
        return /[\\/:*?"<>|]/.test(id);
    }

    async function load() {
        const res = await fetch(REGISTRY_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Admin registry load failed (${res.status})`);
        const data = await res.json();
        _cache = normalize(data);
        return _cache;
    }

    function normalize(data) {
        const companies = (data.companies || []).map(c => ({
            company_id: cleanId(c.company_id),
            name: String(c.name || c.company_id || '').trim(),
            name_en: String(c.name_en || '').trim(),
            status: normalizeStatus(c.status),
            hq_sku: String(c.hq_sku || 'HQ_OFFICE').trim(),
            notes: String(c.notes || '').trim(),
            vessels: (c.vessels || []).map(v => ({
                vessel_id: cleanId(v.vessel_id || v.id),
                name: String(v.name || v.vessel_id || '').trim(),
                code: String(v.code || '').trim(),
                imo_no: String(v.imo_no || '').trim(),
                delivery: String(v.delivery || '').trim().slice(0, 10),
                status: normalizeStatus(v.status),
                company_id: cleanId(c.company_id),
                notes: String(v.notes || '').trim(),
            })),
        })).filter(c => c.company_id);
        return {
            version: data.version || 1,
            updated_at: data.updated_at || '',
            companies,
        };
    }

    function normalizeStatus(status) {
        const s = String(status || 'active').trim().toLowerCase();
        return STATUS_OPTS.includes(s) ? s : 'active';
    }

    function get() {
        return _cache;
    }

    function listCompanies(opts = {}) {
        const includeInactive = !!opts.includeInactive;
        let rows = _cache?.companies || [];
        if (!includeInactive) rows = rows.filter(c => c.status !== 'inactive');
        return rows;
    }

    /** Flat vessel rows for table (100+ scale) */
    function listVessels(opts = {}) {
        const q = String(opts.search || '').trim().toLowerCase();
        const companyId = cleanId(opts.companyId);
        const includeInactive = !!opts.includeInactive;
        let rows = [];
        for (const c of _cache?.companies || []) {
            if (companyId && c.company_id !== companyId) continue;
            for (const v of c.vessels || []) {
                if (!includeInactive && v.status === 'inactive') continue;
                rows.push({
                    ...v,
                    company_name: c.name,
                    company_id: c.company_id,
                });
            }
        }
        if (q) {
            rows = rows.filter(v =>
                (v.name || '').toLowerCase().includes(q)
                || (v.vessel_id || '').toLowerCase().includes(q)
                || (v.imo_no || '').toLowerCase().includes(q)
                || (v.code || '').toLowerCase().includes(q)
                || (v.company_id || '').toLowerCase().includes(q)
                || (v.company_name || '').toLowerCase().includes(q)
            );
        }
        return rows;
    }

    function getCompany(companyId) {
        const id = cleanId(companyId);
        return (_cache?.companies || []).find(c => c.company_id === id) || null;
    }

    function getVessel(companyId, vesselId) {
        const c = getCompany(companyId);
        if (!c) return null;
        const vid = cleanId(vesselId);
        return (c.vessels || []).find(v => v.vessel_id === vid) || null;
    }

    function getSelected() {
        try {
            return {
                companyId: localStorage.getItem(LS_COMPANY) || '',
                vesselId: localStorage.getItem(LS_VESSEL) || '',
            };
        } catch (_) {
            return { companyId: '', vesselId: '' };
        }
    }

    function setSelected(companyId, vesselId) {
        try {
            if (companyId) localStorage.setItem(LS_COMPANY, companyId);
            else localStorage.removeItem(LS_COMPANY);
            if (vesselId) localStorage.setItem(LS_VESSEL, vesselId);
            else localStorage.removeItem(LS_VESSEL);
        } catch (_) { /* ignore */ }
    }

    function stats() {
        const companies = listCompanies({ includeInactive: true });
        let vessels = 0;
        for (const c of companies) vessels += (c.vessels || []).length;
        return { companies: companies.length, vessels };
    }

    function assertLoaded() {
        if (!_cache) throw new Error('Registry not loaded.');
    }

    function validateCompanyInput(input, opts = {}) {
        const isEdit = !!opts.isEdit;
        const companyId = cleanId(input.company_id);
        const name = String(input.name || '').trim();
        if (!isEdit) {
            if (!companyId) return 'Company ID is required.';
            if (invalidIdChars(companyId)) return 'Company ID cannot contain \\ / : * ? " < > |';
            if (getCompany(companyId)) return `Company "${companyId}" already exists.`;
        } else if (!companyId) {
            return 'Company ID is required.';
        }
        if (!name) return 'Company name is required.';
        return null;
    }

    function validateVesselInput(companyId, input, opts = {}) {
        const isEdit = !!opts.isEdit;
        const cid = cleanId(companyId);
        const vesselId = cleanId(input.vessel_id);
        const name = String(input.name || '').trim();
        const company = getCompany(cid);
        if (!company) return 'Select a company first.';
        if (!isEdit) {
            if (!vesselId) return 'Vessel ID is required.';
            if (invalidIdChars(vesselId)) return 'Vessel ID cannot contain \\ / : * ? " < > |';
            if (getVessel(cid, vesselId)) return `Vessel "${vesselId}" already exists in this company.`;
        } else if (!vesselId) {
            return 'Vessel ID is required.';
        }
        if (!name) return 'Vessel name is required.';
        const delivery = String(input.delivery || '').trim();
        if (delivery && !/^\d{4}-\d{2}-\d{2}$/.test(delivery)) {
            return 'Delivery date must be YYYY-MM-DD.';
        }
        return null;
    }

    function upsertCompany(input) {
        assertLoaded();
        const isEdit = !!input._edit;
        const err = validateCompanyInput(input, { isEdit });
        if (err) throw new Error(err);
        const companyId = cleanId(input.company_id);
        const next = {
            company_id: companyId,
            name: String(input.name || '').trim(),
            name_en: String(input.name_en || '').trim(),
            status: normalizeStatus(input.status),
            hq_sku: String(input.hq_sku || 'HQ_OFFICE').trim() || 'HQ_OFFICE',
            notes: String(input.notes || '').trim(),
            vessels: [],
        };
        const idx = (_cache.companies || []).findIndex(c => c.company_id === companyId);
        if (isEdit) {
            if (idx < 0) throw new Error(`Company "${companyId}" not found.`);
            next.vessels = _cache.companies[idx].vessels || [];
            if (!next.notes) next.notes = _cache.companies[idx].notes || '';
            _cache.companies[idx] = next;
        } else {
            _cache.companies.push({ ...next, vessels: [] });
        }
        _cache.updated_at = todayIso();
        return next;
    }

    function upsertVessel(companyId, input) {
        assertLoaded();
        const isEdit = !!input._edit;
        const err = validateVesselInput(companyId, input, { isEdit });
        if (err) throw new Error(err);
        const cid = cleanId(companyId);
        const company = getCompany(cid);
        if (!company) throw new Error(`Company "${cid}" not found.`);
        const vesselId = cleanId(input.vessel_id);
        const next = {
            vessel_id: vesselId,
            name: String(input.name || '').trim(),
            code: String(input.code || '').trim(),
            imo_no: String(input.imo_no || '').trim(),
            delivery: String(input.delivery || '').trim().slice(0, 10),
            status: normalizeStatus(input.status),
            company_id: cid,
            notes: String(input.notes || '').trim(),
        };
        const vessels = company.vessels || [];
        const idx = vessels.findIndex(v => v.vessel_id === vesselId);
        if (isEdit) {
            if (idx < 0) throw new Error(`Vessel "${vesselId}" not found.`);
            if (!next.notes) next.notes = vessels[idx].notes || '';
            vessels[idx] = next;
        } else {
            vessels.push(next);
        }
        company.vessels = vessels;
        _cache.updated_at = todayIso();
        return next;
    }

    function setCompanyStatus(companyId, status) {
        assertLoaded();
        const company = getCompany(companyId);
        if (!company) throw new Error('Company not found.');
        company.status = normalizeStatus(status);
        _cache.updated_at = todayIso();
        return company;
    }

    function setVesselStatus(companyId, vesselId, status) {
        assertLoaded();
        const vessel = getVessel(companyId, vesselId);
        if (!vessel) throw new Error('Vessel not found.');
        vessel.status = normalizeStatus(status);
        _cache.updated_at = todayIso();
        return vessel;
    }

    /** Serialize in-memory registry to on-disk file bundle */
    function buildPersistBundle() {
        assertLoaded();
        const registry = {
            version: _cache.version || 1,
            updated_at: _cache.updated_at || todayIso(),
            companies: (_cache.companies || []).map(c => ({
                company_id: c.company_id,
                name: c.name,
                name_en: c.name_en || '',
                status: c.status || 'active',
                hq_sku: c.hq_sku || 'HQ_OFFICE',
                vessels: (c.vessels || []).map(v => ({
                    vessel_id: v.vessel_id,
                    name: v.name,
                    code: v.code || '',
                    imo_no: v.imo_no || '',
                    delivery: v.delivery || '',
                    status: v.status || 'active',
                })),
            })),
        };
        const files = [{ relPath: 'registry.json', data: registry }];
        for (const c of _cache.companies || []) {
            files.push({
                relPath: pathJoin('companies', c.company_id, 'company.json'),
                data: {
                    company_id: c.company_id,
                    name: c.name,
                    name_en: c.name_en || '',
                    status: c.status || 'active',
                    hq_sku: c.hq_sku || 'HQ_OFFICE',
                    notes: c.notes || '',
                    vessels: (c.vessels || []).map(v => v.vessel_id),
                },
            });
            for (const v of c.vessels || []) {
                files.push({
                    relPath: pathJoin('companies', c.company_id, 'vessels', v.vessel_id, 'vessel.json'),
                    data: {
                        vessel_id: v.vessel_id,
                        name: v.name,
                        company_id: c.company_id,
                        code: v.code || '',
                        imo_no: v.imo_no || '',
                        delivery: v.delivery || '',
                        status: v.status || 'active',
                        vessel_skus: [],
                        notes: v.notes || '',
                    },
                });
            }
        }
        return { registry, files };
    }

    function pathJoin() {
        return Array.from(arguments).filter(Boolean).join('/');
    }

    async function save() {
        const bundle = buildPersistBundle();
        if (typeof window !== 'undefined' && window.tvcElectron?.saveAdminRegistry) {
            const result = await window.tvcElectron.saveAdminRegistry(bundle);
            if (!result?.ok) throw new Error(result?.error || result?.message || 'Save failed.');
            return result;
        }
        downloadBundleFallback(bundle);
        return {
            ok: true,
            fallback: true,
            message: 'Registry bundle downloaded. Use npm run electron:admin to save directly to admin/.',
        };
    }

    function downloadBundleFallback(bundle) {
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `admin-registry-${todayIso()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    return {
        load,
        get,
        listCompanies,
        listVessels,
        getCompany,
        getVessel,
        getSelected,
        setSelected,
        stats,
        upsertCompany,
        upsertVessel,
        setCompanyStatus,
        setVesselStatus,
        buildPersistBundle,
        save,
        validateCompanyInput,
        validateVesselInput,
        STATUS_OPTS,
        HQ_SKU_OPTS,
    };
})();

if (typeof window !== 'undefined') window.TVC_AdminRegistry = TVC_AdminRegistry;
