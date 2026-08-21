/* THE VESSEL CODE — Renderer license bridge (Electron + browser dev) */
const TVC_License = (function () {
    const COMPANY_ID = 'DAEMYUNG';
    const PILOT_VESSEL_ID = 'INCHEON CHEMI';
    const HQ_ALLOWED_VESSEL_IDS = [
        'INCHEON CHEMI',
        'QUARTERBACK J',
        'GOLDSTAR SHINE',
        'VALIANT',
    ];

    let _cache = null;
    let _loaded = false;

    function isElectron() {
        return !!(typeof window !== 'undefined' && window.tvcElectron?.isElectron);
    }

    async function refresh() {
        if (!isElectron()) {
            _loaded = true;
            _cache = {
                ok: true,
                enforced: false,
                companyId: COMPANY_ID,
                vesselId: null,
                allowedVesselIds: HQ_ALLOWED_VESSEL_IDS.slice(),
                sku: 'DEV_BROWSER',
                skuLabel: 'Browser Dev',
                loginModes: ['MASTER', 'ENGINE', 'DECK'],
                allowHq: true,
                allowAdmin: true,
            };
            syncFleetFromLicense(_cache);
            return _cache;
        }
        const r = await window.tvcElectron.getLicense();
        _loaded = true;
        if (!r?.ok || !r.status) {
            _cache = {
                ok: false,
                enforced: true,
                message: r?.message || 'License invalid',
                code: r?.code || 'LICENSE_INVALID',
            };
            return _cache;
        }
        _cache = {
            ok: true,
            enforced: true,
            ...r.status,
            message: r.message || 'OK',
        };
        syncFleetFromLicense(_cache);
        return _cache;
    }

    function syncFleetFromLicense(st) {
        if (!st?.ok || !st.allowHq || typeof TVC_Fleet === 'undefined') return;
        const ids = st.allowedVesselIds;
        if (Array.isArray(ids) && ids.length) TVC_Fleet.syncFromAllowedVesselIds(ids);
    }

    async function getStatus() {
        if (!_loaded) await refresh();
        return _cache;
    }

    function statusSync() {
        return _cache;
    }

    /** @returns {{ ok: boolean, error?: string }} */
    function assertLoginMode(loginMode, accountType) {
        const st = _cache;
        if (!st || !st.enforced || !st.ok) {
            if (st && st.enforced && !st.ok) {
                return { ok: false, error: st.message || 'License invalid.' };
            }
            return { ok: true };
        }
        const type = String(accountType || '').toUpperCase();
        const isHq = type === 'HQ';
        const isAdmin = type === 'ADMIN';
        const adminOnly = !!st.allowAdmin && !st.allowHq && !(st.loginModes || []).length;

        if (isAdmin) {
            if (!st.allowAdmin && !st.allowHq) {
                return {
                    ok: false,
                    error: `This installation (${st.skuLabel || st.sku}) is not Admin Mode. Use HQ or Vessel login.`,
                };
            }
            if (st.allowHq || st.allowAdmin) return { ok: true };
            return {
                ok: false,
                error: `This installation (${st.skuLabel || st.sku}) is not Admin Mode. Use HQ or Vessel login.`,
            };
        }
        if (adminOnly) {
            return {
                ok: false,
                error: `This installation (${st.skuLabel || st.sku}) is TVC Admin Mode only. Use the tvc account.`,
            };
        }
        if (st.allowHq) {
            if (!isHq) {
                return {
                    ok: false,
                    error: `This installation (${st.skuLabel || st.sku}) is for company HQ. Use Superintendent (hq) or TVC Admin (tvc).`,
                };
            }
            return { ok: true };
        }
        if (isHq) {
            return {
                ok: false,
                error: `This installation (${st.skuLabel || st.sku}) is for vessel use only. HQ login is not allowed.`,
            };
        }
        const mode = String(loginMode || '').toUpperCase();
        const allowed = (st.loginModes || []).map(m => String(m).toUpperCase());
        if (!mode || !allowed.includes(mode)) {
            return {
                ok: false,
                error: `This installation (${st.skuLabel || st.sku}) only allows: ${(st.loginModes || []).join(', ') || '—'}.`,
            };
        }
        return { ok: true };
    }

    function assertVesselId(vesselId) {
        const st = _cache;
        if (!st || !st.enforced || !st.ok) {
            if (st && st.enforced && !st.ok) return { ok: false, error: st.message || 'License invalid.' };
            return { ok: true };
        }
        const got = String(vesselId || '').trim();
        if (!got) return { ok: false, error: 'vessel_id is required for this licensed installation.' };
        const allowed = (st.allowedVesselIds || []).map(String);
        if (st.vesselId && !allowed.includes(st.vesselId)) allowed.push(String(st.vesselId));
        if (allowed.length && !allowed.includes(got)) {
            return {
                ok: false,
                error: `Vessel "${got}" is not licensed on this installation (allowed: ${allowed.join(', ')}).`,
            };
        }
        if (st.companyId && st.companyId !== COMPANY_ID) {
            return { ok: false, error: `Company mismatch: license is for ${st.companyId}.` };
        }
        return { ok: true };
    }

    function assertCompanyId(companyId) {
        const st = _cache;
        if (!st || !st.enforced || !st.ok) {
            if (st && st.enforced && !st.ok) return { ok: false, error: st.message || 'License invalid.' };
            return { ok: true };
        }
        const got = String(companyId || '').trim();
        if (!got) return { ok: true }; // legacy packages without company_id
        if (st.companyId && got !== String(st.companyId)) {
            return {
                ok: false,
                error: `Company mismatch: package is for "${got}", this installation is licensed for "${st.companyId}".`,
            };
        }
        return { ok: true };
    }

    function assertExportImport(vesselId, companyId) {
        const c = assertCompanyId(companyId || COMPANY_ID);
        if (!c.ok) return c;
        return assertVesselId(vesselId);
    }

    return {
        COMPANY_ID,
        PILOT_VESSEL_ID,
        isElectron,
        refresh,
        getStatus,
        statusSync,
        assertLoginMode,
        assertVesselId,
        assertCompanyId,
        assertExportImport,
    };
})();
