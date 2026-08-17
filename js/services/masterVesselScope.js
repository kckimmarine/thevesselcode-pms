/* HQ / Ship — PMS·SPARE Master vessel_id scoping */
const TVC_MasterVesselScope = (function () {
    const MASTER_STORES = [
        'maintenance_jobs',
        'maintenance_groups',
        'spare_groups',
        'ship_components',
        'spare_parts',
    ];

    function metaKey() {
        return (typeof TVC_META_KEYS !== 'undefined' && TVC_META_KEYS.MASTER_VESSEL_SCOPE)
            || 'master_vessel_scope_v1';
    }

    function normId(id) {
        return String(id || '').trim();
    }

    function defaultVesselId() {
        if (typeof TVC_Fleet !== 'undefined' && TVC_Fleet.PILOT_VESSEL_ID) {
            return TVC_Fleet.PILOT_VESSEL_ID;
        }
        return 'INCHEON CHEMI';
    }

    /** HQ: Fleet 선택 · Ship: meta / user.vessel_id */
    async function resolve(user, opts = {}) {
        if (opts.vesselId) return normId(opts.vesselId);
        if (user && typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isHqAccount(user)) {
            const id = normId(opts.selectedVesselId)
                || (typeof TVC_Fleet !== 'undefined' ? normId(TVC_Fleet.getSelectedId()) : '');
            if (!id) {
                throw Object.assign(new Error('Select a vessel in Fleet first.'), { code: 'VESSEL_REQUIRED' });
            }
            return id;
        }
        try {
            const meta = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID);
            if (meta) return normId(meta);
        } catch (_) {}
        return normId(user?.vessel_id) || defaultVesselId();
    }

    function belongs(row, vesselId) {
        const vid = normId(vesselId);
        if (!vid) return false;
        return normId(row?.vessel_id) === vid;
    }

    function filterRows(rows, vesselId) {
        const vid = normId(vesselId);
        if (!vid) return [];
        return (rows || []).filter(r => belongs(r, vid));
    }

    function stamp(row, vesselId) {
        if (!row || typeof row !== 'object') return row;
        row.vessel_id = normId(vesselId);
        return row;
    }

    async function backfillStore(storeName, fallbackVesselId) {
        const vid = normId(fallbackVesselId) || defaultVesselId();
        const rows = await TVC_DB.getAll(storeName).catch(() => []);
        const dirty = [];
        for (const row of rows) {
            if (!row || normId(row.vessel_id)) continue;
            row.vessel_id = vid;
            dirty.push(row);
        }
        if (dirty.length) await TVC_DB.bulkPut(storeName, dirty);
        return dirty.length;
    }

    /** 기존 마스터(무 vessel_id) → 파일럿/메타 선박으로 1회 태깅 */
    async function ensureBackfill() {
        const done = await TVC_DB.getMeta(metaKey()).catch(() => null);
        if (done) return { already: true };

        let fallback = defaultVesselId();
        try {
            const meta = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID);
            if (meta) fallback = normId(meta);
        } catch (_) {}

        const counts = {};
        for (const name of MASTER_STORES) {
            counts[name] = await backfillStore(name, fallback);
        }
        await TVC_DB.setMeta(metaKey(), new Date().toISOString());
        return { already: false, fallback, counts };
    }

    /** 선택 선박 마스터만 삭제 (다른 선박 보존) */
    async function clearVesselStore(storeName, vesselId) {
        const vid = normId(vesselId);
        if (!vid) return 0;
        const rows = await TVC_DB.getAll(storeName).catch(() => []);
        let n = 0;
        for (const row of rows) {
            if (!belongs(row, vid)) continue;
            await TVC_DB.del(storeName, row.id);
            n++;
        }
        return n;
    }

    /**
     * source → target 마스터 복제 (새 id, vessel_id=target).
     * target에 기존 마스터가 있으면 해당 선박분만 교체.
     */
    async function cloneMaster(sourceVesselId, targetVesselId) {
        const src = normId(sourceVesselId);
        const dst = normId(targetVesselId);
        if (!src || !dst) throw new Error('source/target vessel_id required');
        if (src === dst) throw new Error('source and target must differ');

        const idMap = new Map();
        function mapId(oldId) {
            if (!oldId) return oldId;
            if (idMap.has(oldId)) return idMap.get(oldId);
            const next = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            idMap.set(oldId, next);
            return next;
        }

        const out = {};
        for (const store of MASTER_STORES) {
            await clearVesselStore(store, dst);
            const rows = filterRows(await TVC_DB.getAll(store).catch(() => []), src);
            const cloned = rows.map(r => {
                const copy = { ...r, id: mapId(r.id), vessel_id: dst };
                if (copy.ship_component_id) copy.ship_component_id = mapId(copy.ship_component_id);
                if (copy.parent_id) copy.parent_id = mapId(copy.parent_id);
                if (copy.parent_equipment_id) copy.parent_equipment_id = mapId(copy.parent_equipment_id);
                copy.updated_at = new Date().toISOString();
                copy.sync_status = 'LOCAL';
                return copy;
            });
            if (cloned.length) await TVC_DB.bulkPut(store, cloned);
            out[store] = cloned.length;
        }
        return { source: src, target: dst, counts: out };
    }

    return {
        MASTER_STORES,
        normId,
        defaultVesselId,
        resolve,
        belongs,
        filterRows,
        stamp,
        ensureBackfill,
        clearVesselStore,
        cloneMaster,
    };
})();
if (typeof window !== 'undefined') window.TVC_MasterVesselScope = TVC_MasterVesselScope;
