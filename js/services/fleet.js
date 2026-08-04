/* HQ Fleet registry — 1~100+ vessels (localStorage, offline-first) */
const TVC_Fleet = (function () {
    const STORAGE_KEY = 'tvc_fleet_v1';
    const SELECTED_KEY = 'tvc_fleet_selected';
    const LEGACY_VESSEL_ID = 'DM_CHEMICAL_01';

    /** Pilot company / vessel — license & Export/Sync ZIP 공통 */
    const COMPANY_ID = 'DAEMYUNG';
    const PILOT_VESSEL_ID = 'INCHEON CHEMI';

    /** 초기 Fleet — 파일럿 선박 1척 */
    const DEFAULT_FLEET = [
        { id: 'INCHEON CHEMI', name: 'INCHEON CHEMI', code: '01', imo_no: '9297711', delivery: '2024-01-15' },
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

    function sortFleet(fleet) {
        const rank = new Map(FLEET_ORDER.map((id, i) => [id, i]));
        return [...fleet].sort((a, b) => {
            const ra = rank.has(a.id) ? rank.get(a.id) : 999;
            const rb = rank.has(b.id) ? rank.get(b.id) : 999;
            if (ra !== rb) return ra - rb;
            return String(a.name || a.id).localeCompare(String(b.name || b.id));
        });
    }

    /** DEFAULT_FLEET 기준 병합 + 구/폐기 ID 제거 + 순번 정렬 */
    function normalizeFleet(fleet) {
        const byId = new Map((fleet || []).map(v => [v.id, v]));
        byId.delete(LEGACY_VESSEL_ID);
        for (const id of DEPRECATED_VESSEL_IDS) byId.delete(id);
        for (const def of DEFAULT_FLEET) {
            const prev = byId.get(def.id);
            byId.set(def.id, { ...def, ...(prev || {}) });
        }
        return sortFleet([...byId.values()]);
    }

    /** vessel_id → Fleet 레코드 (없으면 id 기반 fallback) */
    function resolveById(vesselId) {
        const id = String(vesselId || '').trim();
        if (!id) return null;
        const hit = getAll().find(v => v.id === id);
        if (hit) return hit;
        return { id, name: id.replace(/_/g, ' '), code: id.split('_').pop() || '—', imo_no: '—', delivery: '—' };
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
                name: resolveById(seedVessel)?.name || seedVessel.replace(/_/g, ' '),
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

    return {
        ensureFleet, getAll, getSelected, getSelectedId, select, upsert, remove, resolveById,
        COMPANY_ID, PILOT_VESSEL_ID, LEGACY_VESSEL_ID, DEFAULT_FLEET,
    };
})();
