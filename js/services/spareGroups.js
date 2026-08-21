/* SPARE GROUP definitions — separate from maintenance_groups (PMS) */
const TVC_SpareGroups = (function () {
    function normalizeLabel(s) {
        return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function groupKey(dept, label) {
        return `${dept || ''}|${String(label || '').trim()}`;
    }

    function deptFromSpare(spare) {
        if (typeof TVC_SpareIndexes !== 'undefined') return TVC_SpareIndexes.deptFromSpare(spare);
        const cat = String(spare?.category || '').toUpperCase();
        if (cat === 'DECK' || cat === 'ENGINE') return cat;
        return 'ENGINE';
    }

    function belongs(row, vesselId) {
        if (!vesselId) return true;
        if (typeof TVC_MasterVesselScope !== 'undefined') return TVC_MasterVesselScope.belongs(row, vesselId);
        return !row?.vessel_id || row.vessel_id === vesselId;
    }

    /** One-time seed: spare_groups from spare_parts labels only. Does not copy PMS Equipment (item_sort1). */
    async function ensureSeeded({ vesselId, spares, maintenanceGroups } = {}) {
        const existing = await TVC_DB.getAll('spare_groups').catch(() => []);
        const scoped = existing.filter(g => belongs(g, vesselId));
        if (scoped.length) return existing;

        const toPut = [];
        const seen = new Set();
        const now = new Date().toISOString();

        for (const s of spares || []) {
            if (!belongs(s, vesselId)) continue;
            const label = String(s.group || '').trim();
            if (!label) continue;
            const dept = deptFromSpare(s);
            const key = groupKey(dept, label);
            if (seen.has(key)) continue;
            seen.add(key);

            toPut.push({
                id: `sgrp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                vessel_id: vesselId || s.vessel_id || null,
                department: dept,
                label,
                sort_order: 0,
                machinery_name: '',
                model_type: '',
                maker: '',
                capacity: '',
                serial_no: '',
                dwg_no: '',
                header_edited: false,
                created_at: now,
                updated_at: now,
                sync_status: 'LOCAL',
            });
        }

        if (toPut.length) await TVC_DB.bulkPut('spare_groups', toPut);
        return [...existing, ...toPut];
    }

    async function addGroup({ vesselId, department, label, user }) {
        const lab = String(label || '').trim();
        if (!lab) throw new Error('GROUP name required');
        const dept = department || user?.department || 'ENGINE';
        let vid = vesselId || null;
        if (!vid && typeof TVC_MasterVesselScope !== 'undefined') {
            vid = await TVC_MasterVesselScope.resolve(user, { vesselId });
        }
        if (!vid) {
            vid = (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null))
                || user?.vessel_id
                || null;
        }
        const defs = await TVC_DB.getAll('spare_groups').catch(() => []);
        const norm = normalizeLabel;
        if (defs.some(g => g.department === dept && norm(g.label) === norm(lab) && belongs(g, vid))) {
            throw new Error('GROUP already exists');
        }
        const row = {
            id: `sgrp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            vessel_id: vid,
            department: dept,
            label: lab,
            sort_order: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sync_status: 'LOCAL',
        };
        await TVC_DB.put('spare_groups', row);
        return row;
    }

    async function deleteEmptyGroup({ department, label, vesselId, spares }) {
        const lab = String(label || '').trim();
        const dept = department || '';
        const inGroup = (spares || []).filter(s => {
            if (!belongs(s, vesselId)) return false;
            if (String(s.group || '').trim() !== lab) return false;
            const d = deptFromSpare(s);
            return !dept || d === dept;
        });
        if (inGroup.length) {
            const err = new Error('Cannot delete: spare parts exist in this group.');
            err.code = 'HAS_SPARES';
            err.count = inGroup.length;
            throw err;
        }
        const defs = await TVC_DB.getAll('spare_groups').catch(() => []);
        const norm = normalizeLabel;
        const def = defs.find(g =>
            belongs(g, vesselId)
            && (!dept || g.department === dept)
            && norm(g.label) === norm(lab));
        if (def) await TVC_DB.del('spare_groups', def.id);
    }

    return { ensureSeeded, addGroup, deleteEmptyGroup, groupKey, deptFromSpare, belongs, normalizeLabel };
})();
