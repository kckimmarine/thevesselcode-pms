/* HQ Fleet registry — 1~100+ vessels (localStorage, offline-first) */
const TVC_Fleet = (function () {
    const STORAGE_KEY = 'tvc_fleet_v1';
    const SELECTED_KEY = 'tvc_fleet_selected';
    const LEGACY_VESSEL_ID = 'DM_CHEMICAL_01';

    /** No1 Test Vessel — Export/Sync ZIP 파일명·DB vessel_id 공통 키 */
    const PILOT_VESSEL_ID = 'TEST_V01';

    const DEFAULT_FLEET = [
        { id: 'TEST_V01', name: 'No1 Test Vessel', code: '01', delivery: '2024-01-15' },
        { id: 'TEST_V02', name: 'No2 Test Vessel', code: '02', delivery: '2020-06-15' },
        { id: 'TEST_V03', name: 'No3 Test Vessel', code: '03', delivery: '2021-01-20' },
        { id: 'TEST_V04', name: 'No4 Test Vessel', code: '04', delivery: '2021-08-05' },
        { id: 'TEST_V05', name: 'No5 Test Vessel', code: '05', delivery: '2022-02-28' },
        { id: 'TEST_V06', name: 'No6 Test Vessel', code: '06', delivery: '2022-11-12' },
    ];

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

    /** DEFAULT_FLEET 기준 병합 + 구 ID(DM_CHEMICAL_01) 제거 + 순번 정렬 */
    function normalizeFleet(fleet) {
        const byId = new Map((fleet || []).map(v => [v.id, v]));
        byId.delete(LEGACY_VESSEL_ID);
        for (const def of DEFAULT_FLEET) {
            const prev = byId.get(def.id);
            byId.set(def.id, prev ? { ...prev, ...def } : { ...def });
        }
        return sortFleet([...byId.values()]);
    }

    /** vessel_id → Fleet 레코드 (없으면 id 기반 fallback) */
    function resolveById(vesselId) {
        const id = String(vesselId || '').trim();
        if (!id) return null;
        const hit = getAll().find(v => v.id === id);
        if (hit) return hit;
        return { id, name: id.replace(/_/g, ' '), code: id.split('_').pop() || '—', delivery: '—' };
    }

    async function ensureFleet() {
        let fleet = normalizeFleet(readFleetRaw()?.length ? readFleetRaw() : [...DEFAULT_FLEET]);
        const seedVessel = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null);
        if (seedVessel && !fleet.some(v => v.id === seedVessel)) {
            fleet.push({
                id: seedVessel,
                name: resolveById(seedVessel)?.name || seedVessel.replace(/_/g, ' '),
                code: seedVessel.split('_').pop() || '—',
                delivery: '—',
            });
            fleet = sortFleet(fleet);
        }
        writeFleet(fleet);
        const sel = localStorage.getItem(SELECTED_KEY);
        if (!sel || sel === LEGACY_VESSEL_ID) select(PILOT_VESSEL_ID);
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
        const fleet = getAll();
        const i = fleet.findIndex(v => v.id === vessel.id);
        if (i >= 0) fleet[i] = { ...fleet[i], ...vessel };
        else fleet.push(vessel);
        writeFleet(sortFleet(fleet));
        return getAll();
    }

    return {
        ensureFleet, getAll, getSelected, getSelectedId, select, upsert, resolveById,
        PILOT_VESSEL_ID, LEGACY_VESSEL_ID,
    };
})();
