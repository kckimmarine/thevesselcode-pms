/* THE VESSEL CODE — Admin contract registry (companies / vessels) */
const TVC_AdminRegistry = (function () {
    const REGISTRY_URL = 'admin/registry.json';
    const LS_COMPANY = 'tvc_admin_selected_company';
    const LS_VESSEL = 'tvc_admin_selected_vessel';
    const LS_REGISTRY_CACHE = 'tvc_admin_registry_cache_v1';
    const STATUS_OPTS = ['active', 'inactive'];
    const HQ_SKU_OPTS = ['HQ_OFFICE'];
    const VESSEL_SKUS = ['VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK'];
    const TVC_LAB_COMPANY_ID = 'TVC_LAB';
    const TVC_LAB_VESSEL_ID = 'LAB_SHIP';

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

    function normalizeDeploy(raw, { isVessel = false } = {}) {
        const d = raw && typeof raw === 'object' ? raw : {};
        if (isVessel) {
            const av = d.app_version && typeof d.app_version === 'object' ? d.app_version : {};
            const au = d.app_updated_at && typeof d.app_updated_at === 'object' ? d.app_updated_at : {};
            return {
                setup_version: String(d.setup_version || '').trim(),
                setup_sent_at: String(d.setup_sent_at || '').trim().slice(0, 10),
                app_version: {
                    VESSEL_MASTER: String(av.VESSEL_MASTER || d.app_version_master || '').trim(),
                    VESSEL_ENGINE: String(av.VESSEL_ENGINE || d.app_version_engine || '').trim(),
                    VESSEL_DECK: String(av.VESSEL_DECK || d.app_version_deck || '').trim(),
                },
                app_updated_at: {
                    VESSEL_MASTER: String(au.VESSEL_MASTER || '').trim().slice(0, 10),
                    VESSEL_DECK: String(au.VESSEL_DECK || '').trim().slice(0, 10),
                    VESSEL_ENGINE: String(au.VESSEL_ENGINE || '').trim().slice(0, 10),
                },
                license_issued_at: String(d.license_issued_at || '').trim().slice(0, 10),
                last_handoff_at: String(d.last_handoff_at || '').trim().slice(0, 10),
            };
        }
        return {
            setup_version: String(d.setup_version || '').trim(),
            setup_sent_at: String(d.setup_sent_at || '').trim().slice(0, 10),
            app_version: String(d.app_version || '').trim(),
            app_updated_at: String(d.app_updated_at || '').trim().slice(0, 10),
            license_issued_at: String(d.license_issued_at || '').trim().slice(0, 10),
            last_handoff_at: String(d.last_handoff_at || '').trim().slice(0, 10),
        };
    }

    function normalizeContract(raw) {
        const c = raw && typeof raw === 'object' ? raw : {};
        const months = Number(c.term_months);
        return {
            start_date: String(c.start_date || '').trim().slice(0, 10),
            term_months: Number.isFinite(months) && months > 0 ? months : 0,
            fee_note: String(c.fee_note || '').trim(),
        };
    }

    function formatCompanyAppVersion(deploy) {
        const v = deploy?.app_version;
        return v ? String(v) : '—';
    }

    function formatVesselAppVersions(deploy) {
        const av = deploy?.app_version;
        if (!av) return '—';
        if (typeof av === 'string') return av.trim() || '—';
        const versions = VESSEL_SKUS.map(k => String(av[k] || '').trim()).filter(Boolean);
        if (!versions.length) return '—';
        return versions[0];
    }

    function formatVesselSetupVersion(deploy) {
        return deploy?.setup_version || '—';
    }

    function isTvcLabCompany(companyId) {
        return cleanId(companyId) === TVC_LAB_COMPANY_ID;
    }

    function getTvcLabDefaults() {
        return { companyId: TVC_LAB_COMPANY_ID, vesselId: TVC_LAB_VESSEL_ID };
    }

    async function load() {
        if (!isElectronAdmin()) {
            try {
                const local = localStorage.getItem(LS_REGISTRY_CACHE);
                if (local) {
                    _cache = normalize(JSON.parse(local));
                    return _cache;
                }
            } catch (e) {
                console.warn('[TVC_AdminRegistry] local cache read failed', e);
            }
        }
        const res = await fetch(REGISTRY_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Admin registry load failed (${res.status})`);
        const data = await res.json();
        _cache = normalize(data);
        return _cache;
    }

    function isElectronAdmin() {
        return typeof window !== 'undefined' && !!window.tvcElectron?.saveAdminRegistry;
    }

    function saveLocalCache() {
        if (!_cache) throw new Error('Registry not loaded.');
        localStorage.setItem(LS_REGISTRY_CACHE, JSON.stringify(_cache));
    }

    function normalizeLoginAccount(raw) {
        const d = raw && typeof raw === 'object' ? raw : {};
        const username = String(d.username || '').trim();
        const password_hash = String(d.password_hash || '').trim();
        if (!username || !password_hash) return null;
        const password_plain = String(d.password_plain || '').trim();
        return {
            username,
            password_hash,
            password_plain,
            display_name: String(d.display_name || '').trim(),
            updated_at: String(d.updated_at || '').trim().slice(0, 10),
        };
    }

    function normalize(data) {
        const companies = (data.companies || []).map(c => ({
            company_id: cleanId(c.company_id),
            name: String(c.name || c.company_id || '').trim(),
            name_en: String(c.name_en || '').trim(),
            status: normalizeStatus(c.status),
            hq_sku: String(c.hq_sku || 'HQ_OFFICE').trim(),
            notes: String(c.notes || '').trim(),
            address: String(c.address || '').trim(),
            contact_name: String(c.contact_name || '').trim(),
            contact_email: String(c.contact_email || '').trim(),
            contract: normalizeContract(c.contract),
            deploy: normalizeDeploy(c.deploy, { isVessel: false }),
            hq_login: normalizeLoginAccount(c.hq_login),
            vessels: (c.vessels || []).map(v => ({
                vessel_id: cleanId(v.vessel_id || v.id),
                name: String(v.name || v.vessel_id || '').trim(),
                code: String(v.code || '').trim(),
                imo_no: String(v.imo_no || '').trim(),
                delivery: String(v.delivery || '').trim().slice(0, 10),
                status: normalizeStatus(v.status),
                company_id: cleanId(c.company_id),
                notes: String(v.notes || '').trim(),
                deploy: normalizeDeploy(v.deploy, { isVessel: true }),
                master_login: normalizeLoginAccount(v.master_login),
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
            if (!includeInactive && c.status === 'inactive') continue;
            for (const v of c.vessels || []) {
                if (!includeInactive && v.status === 'inactive') continue;
                rows.push({
                    ...v,
                    company_name: c.name,
                    company_id: c.company_id,
                    deploy: v.deploy || normalizeDeploy({}, { isVessel: true }),
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

    function activeVesselIds(company) {
        return (company.vessels || []).filter(v => v.status !== 'inactive').map(v => v.vessel_id);
    }

    function ensureCompanyDeploy(company) {
        if (!company.deploy) company.deploy = normalizeDeploy({}, { isVessel: false });
        return company.deploy;
    }

    function ensureVesselDeploy(vessel) {
        if (!vessel.deploy) vessel.deploy = normalizeDeploy({}, { isVessel: true });
        return vessel.deploy;
    }

    /** Record deploy / update / license in registry (call save() after). */
    function recordDeploy(opts = {}) {
        assertLoaded();
        const companyId = cleanId(opts.companyId);
        const company = getCompany(companyId);
        if (!company) throw new Error('Company not found.');
        const today = todayIso();
        const appVersion = String(opts.appVersion || '').trim();
        const kind = String(opts.kind || '').trim();
        const sku = String(opts.sku || '').trim();
        const vesselId = cleanId(opts.vesselId);
        let vesselIds = Array.isArray(opts.vesselIds) ? opts.vesselIds.map(cleanId).filter(Boolean) : null;
        if (!vesselIds?.length && kind === 'setup') {
            vesselIds = activeVesselIds(company);
        }

        if (kind === 'setup') {
            const cd = ensureCompanyDeploy(company);
            if (appVersion) cd.setup_version = appVersion;
            cd.setup_sent_at = today;
            cd.last_handoff_at = today;
            for (const vid of vesselIds || []) {
                const v = getVessel(companyId, vid);
                if (!v) continue;
                const vd = ensureVesselDeploy(v);
                if (appVersion) vd.setup_version = appVersion;
                vd.setup_sent_at = today;
                vd.last_handoff_at = today;
            }
        } else if (kind === 'update') {
            if (sku === 'HQ_OFFICE') {
                const cd = ensureCompanyDeploy(company);
                if (appVersion) cd.app_version = appVersion;
                cd.app_updated_at = today;
            } else if (VESSEL_SKUS.includes(sku)) {
                const targets = vesselIds?.length ? vesselIds : activeVesselIds(company);
                for (const vid of targets) {
                    const v = getVessel(companyId, vid);
                    if (!v) continue;
                    const vd = ensureVesselDeploy(v);
                    if (appVersion) vd.app_version[sku] = appVersion;
                    vd.app_updated_at[sku] = today;
                }
            }
        } else if (kind === 'license') {
            if (sku === 'HQ_OFFICE') {
                const cd = ensureCompanyDeploy(company);
                cd.license_issued_at = today;
                if (appVersion) {
                    cd.app_version = appVersion;
                    cd.app_updated_at = today;
                }
            } else if (VESSEL_SKUS.includes(sku) && vesselId) {
                const v = getVessel(companyId, vesselId);
                if (v) {
                    const vd = ensureVesselDeploy(v);
                    vd.license_issued_at = today;
                    if (appVersion) {
                        vd.app_version[sku] = appVersion;
                        vd.app_updated_at[sku] = today;
                    }
                }
            }
        } else {
            throw new Error('Unknown deploy record kind.');
        }
        _cache.updated_at = today;
        return { ok: true, companyId, kind, sku, appVersion };
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
        const startDate = String(input.contract_start_date || '').trim();
        if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
            return 'Contract start date must be YYYY-MM-DD.';
        }
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
        const termMonths = Number(input.contract_term_months);
        const next = {
            company_id: companyId,
            name: String(input.name || '').trim(),
            name_en: String(input.name_en || '').trim(),
            status: normalizeStatus(input.status),
            hq_sku: String(input.hq_sku || 'HQ_OFFICE').trim() || 'HQ_OFFICE',
            notes: String(input.notes || '').trim(),
            address: String(input.address || '').trim(),
            contact_name: String(input.contact_name || '').trim(),
            contact_email: String(input.contact_email || '').trim(),
            contract: normalizeContract({
                start_date: input.contract_start_date,
                term_months: Number.isFinite(termMonths) && termMonths > 0 ? termMonths : input.contract_term_months,
                fee_note: input.contract_fee_note,
            }),
            deploy: normalizeDeploy({}, { isVessel: false }),
            vessels: [],
        };
        const idx = (_cache.companies || []).findIndex(c => c.company_id === companyId);
        if (isEdit) {
            if (idx < 0) throw new Error(`Company "${companyId}" not found.`);
            const prev = _cache.companies[idx];
            next.vessels = prev.vessels || [];
            next.deploy = prev.deploy || next.deploy;
            if (!next.notes) next.notes = prev.notes || '';
            if (!next.address) next.address = prev.address || '';
            if (!next.contact_name) next.contact_name = prev.contact_name || '';
            if (!next.contact_email) next.contact_email = prev.contact_email || '';
            if (!next.contract.start_date) next.contract.start_date = prev.contract?.start_date || '';
            if (!next.contract.term_months) next.contract.term_months = prev.contract?.term_months || 0;
            if (!next.contract.fee_note) next.contract.fee_note = prev.contract?.fee_note || '';
            next.hq_login = prev.hq_login || null;
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
            deploy: normalizeDeploy({}, { isVessel: true }),
        };
        const vessels = company.vessels || [];
        const idx = vessels.findIndex(v => v.vessel_id === vesselId);
        if (isEdit) {
            if (idx < 0) throw new Error(`Vessel "${vesselId}" not found.`);
            if (!next.notes) next.notes = vessels[idx].notes || '';
            next.deploy = vessels[idx].deploy || next.deploy;
            next.master_login = vessels[idx].master_login || null;
            vessels[idx] = next;
        } else {
            vessels.push(next);
        }
        company.vessels = vessels;
        _cache.updated_at = todayIso();
        return next;
    }

    function setCompanyHqLogin(companyId, login) {
        assertLoaded();
        const company = getCompany(companyId);
        if (!company) throw new Error(`Company "${companyId}" not found.`);
        company.hq_login = normalizeLoginAccount(login);
        if (!company.hq_login) throw new Error('Invalid HQ login.');
        _cache.updated_at = todayIso();
        return company.hq_login;
    }

    function setVesselMasterLogin(companyId, vesselId, login) {
        assertLoaded();
        const vessel = getVessel(companyId, vesselId);
        if (!vessel) throw new Error(`Vessel "${vesselId}" not found.`);
        vessel.master_login = normalizeLoginAccount(login);
        if (!vessel.master_login) throw new Error('Invalid Master login.');
        _cache.updated_at = todayIso();
        return vessel.master_login;
    }

    function serializeLoginAccount(login) {
        if (!login?.username || !login?.password_hash) return null;
        const row = {
            username: login.username,
            password_hash: login.password_hash,
        };
        if (login.display_name) row.display_name = login.display_name;
        if (login.updated_at) row.updated_at = login.updated_at;
        if (login.password_plain) row.password_plain = login.password_plain;
        return row;
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

    function serializeCompanyDeploy(deploy) {
        const d = normalizeDeploy(deploy, { isVessel: false });
        const out = {};
        if (d.setup_version) out.setup_version = d.setup_version;
        if (d.setup_sent_at) out.setup_sent_at = d.setup_sent_at;
        if (d.app_version) out.app_version = d.app_version;
        if (d.app_updated_at) out.app_updated_at = d.app_updated_at;
        if (d.license_issued_at) out.license_issued_at = d.license_issued_at;
        if (d.last_handoff_at) out.last_handoff_at = d.last_handoff_at;
        return Object.keys(out).length ? out : undefined;
    }

    function serializeVesselDeploy(deploy) {
        const d = normalizeDeploy(deploy, { isVessel: true });
        const av = d.app_version || {};
        const au = d.app_updated_at || {};
        const hasApp = VESSEL_SKUS.some(s => av[s] || au[s]);
        const out = {};
        if (d.setup_version) out.setup_version = d.setup_version;
        if (d.setup_sent_at) out.setup_sent_at = d.setup_sent_at;
        if (hasApp) {
            out.app_version = {};
            out.app_updated_at = {};
            for (const s of VESSEL_SKUS) {
                if (av[s]) out.app_version[s] = av[s];
                if (au[s]) out.app_updated_at[s] = au[s];
            }
        }
        if (d.license_issued_at) out.license_issued_at = d.license_issued_at;
        if (d.last_handoff_at) out.last_handoff_at = d.last_handoff_at;
        return Object.keys(out).length ? out : undefined;
    }

    /** Serialize in-memory registry to on-disk file bundle */
    function buildPersistBundle() {
        assertLoaded();
        const registry = {
            version: _cache.version || 1,
            updated_at: _cache.updated_at || todayIso(),
            companies: (_cache.companies || []).map(c => {
                const row = {
                    company_id: c.company_id,
                    name: c.name,
                    name_en: c.name_en || '',
                    status: c.status || 'active',
                    hq_sku: c.hq_sku || 'HQ_OFFICE',
                    vessels: (c.vessels || []).map(v => {
                        const vr = {
                            vessel_id: v.vessel_id,
                            name: v.name,
                            code: v.code || '',
                            imo_no: v.imo_no || '',
                            delivery: v.delivery || '',
                            status: v.status || 'active',
                        };
                        const vd = serializeVesselDeploy(v.deploy);
                        if (vd) vr.deploy = vd;
                        const ml = serializeLoginAccount(v.master_login);
                        if (ml) vr.master_login = ml;
                        return vr;
                    }),
                };
                if (c.address) row.address = c.address;
                if (c.contact_name) row.contact_name = c.contact_name;
                if (c.contact_email) row.contact_email = c.contact_email;
                const contract = normalizeContract(c.contract);
                if (contract.start_date || contract.term_months || contract.fee_note) row.contract = contract;
                const cd = serializeCompanyDeploy(c.deploy);
                if (cd) row.deploy = cd;
                const hl = serializeLoginAccount(c.hq_login);
                if (hl) row.hq_login = hl;
                return row;
            }),
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
                    address: c.address || '',
                    contact_name: c.contact_name || '',
                    contact_email: c.contact_email || '',
                    contract: normalizeContract(c.contract),
                    deploy: serializeCompanyDeploy(c.deploy) || {},
                    vessels: (c.vessels || []).map(v => v.vessel_id),
                },
            });
            const hqLogin = serializeLoginAccount(c.hq_login);
            if (hqLogin) files[files.length - 1].data.hq_login = hqLogin;
            for (const v of c.vessels || []) {
                const vesselData = {
                        vessel_id: v.vessel_id,
                        name: v.name,
                        company_id: c.company_id,
                        code: v.code || '',
                        imo_no: v.imo_no || '',
                        delivery: v.delivery || '',
                        status: v.status || 'active',
                        vessel_skus: [],
                        notes: v.notes || '',
                        deploy: serializeVesselDeploy(v.deploy) || {},
                };
                const masterLogin = serializeLoginAccount(v.master_login);
                if (masterLogin) vesselData.master_login = masterLogin;
                files.push({
                    relPath: pathJoin('companies', c.company_id, 'vessels', v.vessel_id, 'vessel.json'),
                    data: vesselData,
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
        if (isElectronAdmin()) {
            const result = await window.tvcElectron.saveAdminRegistry(bundle);
            if (!result?.ok) throw new Error(result?.error || result?.message || 'Save failed.');
            return result;
        }
        saveLocalCache();
        return { ok: true, local: true };
    }

    function exportRegistryBundleDownload() {
        const bundle = buildPersistBundle();
        downloadBundleFallback(bundle);
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
        setCompanyHqLogin,
        setVesselMasterLogin,
        serializeLoginAccount,
        upsertCompany,
        upsertVessel,
        setCompanyStatus,
        setVesselStatus,
        recordDeploy,
        formatCompanyAppVersion,
        formatVesselAppVersions,
        formatVesselSetupVersion,
        buildPersistBundle,
        save,
        exportRegistryBundleDownload,
        isElectronAdmin,
        validateCompanyInput,
        validateVesselInput,
        STATUS_OPTS,
        HQ_SKU_OPTS,
        VESSEL_SKUS,
        TVC_LAB_COMPANY_ID,
        TVC_LAB_VESSEL_ID,
        isTvcLabCompany,
        getTvcLabDefaults,
    };
})();

if (typeof window !== 'undefined') window.TVC_AdminRegistry = TVC_AdminRegistry;
