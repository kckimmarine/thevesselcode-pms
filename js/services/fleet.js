/* HQ Fleet registry — 1~100+ vessels (localStorage, offline-first) */
const TVC_Fleet = (function () {
    const STORAGE_KEY = 'tvc_fleet_v1';
    const SELECTED_KEY = 'tvc_fleet_selected';
    const LEGACY_VESSEL_ID = 'DM_CHEMICAL_01';

    /** Pilot company / vessel — license & Export/Sync ZIP 공통 */
    const COMPANY_ID = 'DAEMYUNG';
    const PILOT_VESSEL_ID = 'INCHEON CHEMI';

    /** 초기 Fleet — HQ 등록 선박 (company: DAEMYUNG) */
    const DEFAULT_FLEET = [
        { id: 'INCHEON CHEMI', name: 'INCHEON CHEMI', code: '1', company_code: '1', imo_no: '9297711', delivery: '2003-09-18', company_id: COMPANY_ID },
        { id: 'QUARTERBACK J', name: 'QUARTERBACK J', code: '2', company_code: '1', imo_no: '9264879', delivery: '2003-01-29', company_id: COMPANY_ID },
        { id: 'GOLDSTAR SHINE', name: 'GOLDSTAR SHINE', code: '3', company_code: '1', imo_no: '9279707', delivery: '2004-09-27', company_id: COMPANY_ID },
        { id: 'VALIANT', name: 'VALIANT', code: '4', company_code: '1', imo_no: '9274288', delivery: '2005-01-20', company_id: COMPANY_ID },
    ];

    /** 예전 테스트 Fleet — HQ 목록에서 제거 */
    const DEPRECATED_VESSEL_IDS = new Set([
        'TEST_V01', 'TEST_V02', 'TEST_V03', 'TEST_V04', 'TEST_V05', 'TEST_V06',
    ]);

    const FLEET_ORDER = DEFAULT_FLEET.map(v => v.id);

    function readFleetRaw() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (_) {}
        return null;
    }

    function writeFleet(vessels) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(vessels));
    }

    function regCodeSortKey(val) {
        const s = String(val ?? '').trim();
        if (!s) return 9999;
        const n = Number(s);
        if (!Number.isInteger(n) || n < 1 || n > 200) return 9999;
        return n;
    }

    function sortFleet(fleet) {
        return [...fleet].sort((a, b) => {
            const cc = regCodeSortKey(a.company_code) - regCodeSortKey(b.company_code);
            if (cc) return cc;
            const vc = regCodeSortKey(a.code) - regCodeSortKey(b.code);
            if (vc) return vc;
            return String(a.id || '').localeCompare(String(b.id || ''));
        });
    }

    /** DEFAULT_FLEET 기준 병합 + 구/폐기 ID 제거 + 순번 정렬 */
    function normalizeFleet(fleet) {
        const byId = new Map((fleet || []).map(v => [v.id, v]));
        byId.delete(LEGACY_VESSEL_ID);
        for (const id of DEPRECATED_VESSEL_IDS) byId.delete(id);
        for (const def of DEFAULT_FLEET) {
            const prev = byId.get(def.id);
            // DEFAULT_FLEET 메타(name/imo/delivery/code)를 기준으로 맞춤
            byId.set(def.id, { company_id: COMPANY_ID, ...(prev || {}), ...def });
        }
        return sortFleet([...byId.values()]);
    }

    /** vessel_id → Fleet 레코드 (없으면 id 기반 fallback) */
    function resolveById(vesselId) {
        const id = String(vesselId || '').trim();
        if (!id) return null;
        const hit = getAll().find(v => v.id === id);
        if (hit) return hit;
        return { id, name: id, code: id.split('_').pop() || '—', imo_no: '—', delivery: '—' };
    }

    async function ensureFleet() {
        try {
            const meta = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID);
            if (meta === 'TEST_V01') {
                await TVC_DB.setMeta(TVC_META_KEYS.VESSEL_ID, PILOT_VESSEL_ID);
            }
        } catch (_) {}

        let fleet = normalizeFleet(readFleetRaw()?.length ? readFleetRaw() : [...DEFAULT_FLEET]);
        const seedVessel = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null);
        if (seedVessel && !fleet.some(v => v.id === seedVessel)) {
            fleet.push({
                id: seedVessel,
                name: seedVessel,
                code: seedVessel.split('_').pop() || '—',
                imo_no: '—',
                delivery: '—',
            });
            fleet = sortFleet(fleet);
        }
        writeFleet(fleet);
        const sel = localStorage.getItem(SELECTED_KEY);
        if (!sel || sel === LEGACY_VESSEL_ID || sel === 'TEST_V01') select(PILOT_VESSEL_ID);
        return fleet;
    }

    function getAll() {
        const raw = readFleetRaw();
        return normalizeFleet(raw?.length ? raw : [...DEFAULT_FLEET]);
    }

    function licenseCompanyId() {
        try {
            const st = typeof TVC_License !== 'undefined' ? TVC_License.statusSync() : null;
            return String(st?.companyId || COMPANY_ID).trim() || COMPANY_ID;
        } catch (_) {
            return COMPANY_ID;
        }
    }

    function licenseAllowedVesselIds() {
        try {
            const st = typeof TVC_License !== 'undefined' ? TVC_License.statusSync() : null;
            const ids = st?.allowedVesselIds;
            return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
        } catch (_) {
            return [];
        }
    }

    function vesselCompanyId(vessel) {
        return String(vessel?.company_id || COMPANY_ID).trim() || COMPANY_ID;
    }

    /** HQ superintendent — license company + allowedVesselIds. Super-admin sees registry-active fleet. */
    function getVisible(user) {
        const all = getAll();
        if (user && typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isSuperHqAccount?.(user)) {
            if (typeof TVC_AdminRegistry !== 'undefined') {
                try {
                    const activeRows = TVC_AdminRegistry.listVessels({ includeInactive: false });
                    if (activeRows.length) {
                        const activeIds = new Set(activeRows.map(r => String(r.vessel_id || '').trim()).filter(Boolean));
                        return all.filter(v => activeIds.has(v.id));
                    }
                } catch (_) { /* registry not loaded */ }
            }
            return all;
        }
        const companyScoped = !!(user && typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isCompanyHqAccount?.(user));
        if (!companyScoped) return all;
        const companyId = String(user.company_id || licenseCompanyId()).trim() || COMPANY_ID;
        const allowed = licenseAllowedVesselIds();
        let rows = all.filter(v => {
            if (vesselCompanyId(v) !== companyId) return false;
            if (allowed.length && !allowed.includes(v.id)) return false;
            return true;
        });
        if (typeof TVC_AdminRegistry !== 'undefined') {
            try {
                const activeRows = TVC_AdminRegistry.listVessels({ companyId, includeInactive: false });
                if (activeRows.length) {
                    const activeIds = new Set(activeRows.map(r => String(r.vessel_id || '').trim()).filter(Boolean));
                    rows = rows.filter(v => activeIds.has(v.id));
                }
            } catch (_) { /* ignore */ }
        }
        return rows;
    }

    function listCompanyIds(user) {
        const rows = getVisible(user);
        const ids = [];
        const seen = new Set();
        for (const v of rows) {
            const id = vesselCompanyId(v);
            if (seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
        }
        return ids;
    }

    function getSelectedId() {
        return localStorage.getItem(SELECTED_KEY) || getAll()[0]?.id || null;
    }

    function getSelected() {
        const id = getSelectedId();
        return getAll().find(v => v.id === id) || getAll()[0] || null;
    }

    function select(id) {
        if (id) localStorage.setItem(SELECTED_KEY, id);
    }

    function upsert(vessel) {
        const id = String(vessel?.id || '').trim();
        if (!id) return getAll();
        const raw = readFleetRaw()?.length ? readFleetRaw() : [];
        const byId = new Map(raw.map(v => [v.id, v]));
        byId.delete(LEGACY_VESSEL_ID);
        for (const dep of DEPRECATED_VESSEL_IDS) byId.delete(dep);
        const prev = byId.get(id) || DEFAULT_FLEET.find(v => v.id === id) || {};
        byId.set(id, { ...prev, ...vessel, id });
        writeFleet(sortFleet([...byId.values()]));
        return getAll();
    }

    /** HQ Fleet에서 선박 삭제 (마지막 1척은 삭제 불가) */
    function remove(id) {
        const target = String(id || '').trim();
        if (!target) return getAll();
        const raw = readFleetRaw()?.length ? readFleetRaw() : [...DEFAULT_FLEET];
        const next = raw.filter(v => v.id !== target && !DEPRECATED_VESSEL_IDS.has(v.id) && v.id !== LEGACY_VESSEL_ID);
        if (!next.length) return getAll();
        writeFleet(sortFleet(normalizeFleet(next)));
        if (getSelectedId() === target) select(next[0]?.id || PILOT_VESSEL_ID);
        return getAll();
    }

    /** HQ license allowedVesselIds → Ship List upsert */
    function syncFromAllowedVesselIds(ids) {
        const list = (ids || []).map(String).filter(Boolean);
        if (!list.length) return getAll();
        for (const id of list) {
            const prev = getAll().find(v => v.id === id) || DEFAULT_FLEET.find(v => v.id === id);
            upsert(prev ? { ...prev, id, company_id: prev.company_id || licenseCompanyId() } : {
                id,
                name: id,
                code: '—',
                imo_no: '—',
                delivery: '—',
                company_id: licenseCompanyId(),
            });
        }
        return getAll();
    }

    /** Company App Update manifest registry_vessels → Ship List upsert */
    function syncFromRegistryVessels(rows) {
        const list = Array.isArray(rows) ? rows : [];
        for (const r of list) {
            const id = String(r.vessel_id || r.id || '').trim();
            if (!id) continue;
            const prev = getAll().find(v => v.id === id) || DEFAULT_FLEET.find(v => v.id === id);
            upsert({
                ...(prev || {}),
                id,
                name: id,
                code: String(r.code || prev?.code || '—').trim() || '—',
                imo_no: String(r.imo_no || prev?.imo_no || '—').trim() || '—',
                delivery: String(r.delivery || prev?.delivery || '—').trim().slice(0, 10) || '—',
                company_id: String(r.company_id || prev?.company_id || licenseCompanyId()).trim() || licenseCompanyId(),
                company_code: String(r.company_code || prev?.company_code || '').trim(),
            });
        }
        return getAll();
    }

    /** Super HQ — admin/registry.json vessels → Ship List (all companies). */
    function syncFromAdminRegistry() {
        if (typeof TVC_AdminRegistry === 'undefined') return getAll();
        const activeRows = TVC_AdminRegistry.listVessels({ includeInactive: false });
        const activeIds = new Set(activeRows.map(r => String(r.vessel_id || '').trim()).filter(Boolean));
        const allRegistryRows = TVC_AdminRegistry.listVessels({ includeInactive: true });
        for (const r of allRegistryRows) {
            const id = String(r.vessel_id || '').trim();
            if (!id || activeIds.has(id)) continue;
            remove(id);
        }
        for (const r of activeRows) {
            const id = String(r.vessel_id || '').trim();
            if (!id) continue;
            const prev = getAll().find(v => v.id === id) || DEFAULT_FLEET.find(v => v.id === id);
            upsert({
                ...(prev || {}),
                id,
                name: id,
                code: String(r.code || prev?.code || '—').trim() || '—',
                imo_no: String(r.imo_no || prev?.imo_no || '—').trim() || '—',
                delivery: String(r.delivery || prev?.delivery || '—').trim().slice(0, 10) || '—',
                company_id: String(r.company_id || prev?.company_id || licenseCompanyId()).trim() || licenseCompanyId(),
                company_code: String(r.company_code || prev?.company_code || '').trim(),
            });
        }
        return getAll();
    }

    return {
        ensureFleet, getAll, getVisible, listCompanyIds, getSelected, getSelectedId, select, upsert, remove, resolveById,
        syncFromAllowedVesselIds, syncFromRegistryVessels, syncFromAdminRegistry, vesselCompanyId, licenseCompanyId,
        COMPANY_ID, PILOT_VESSEL_ID, LEGACY_VESSEL_ID, DEFAULT_FLEET,
    };
})();
