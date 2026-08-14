/* Spare Code — GG-EE-III (2-2-3) e.g. 01-01-001
 *
 * GG  = PMS group (01 … 26)
 * EE  = Equipment block (01 … 99; 00 = no equipment / group-level)
 * III = Item within block (001 … 999)
 *
 * Legacy formats are migrated on normalize:
 *   01-001       (GG-SSS)     → 01-00-001
 *   01-001-01    (GG-EEE-II)  → 01-01-001
 */
const TVC_SpareCode = (function () {
    const RE_STD = /^(\d{2})-(\d{2})-(\d{3})$/;
    const RE_LEGACY_V2 = /^(\d{2})-(\d{3})$/;
    const RE_LEGACY_V3 = /^(\d{2})-(\d{3})-(\d{1,3})$/;

    function padGroup(n) {
        const v = parseInt(String(n || '').replace(/\D/g, ''), 10);
        return Number.isFinite(v) && v > 0 ? String(v).padStart(2, '0') : '';
    }

    function padEquip(n) {
        const v = parseInt(String(n ?? '').replace(/\D/g, ''), 10);
        if (!Number.isFinite(v) || v < 0) return '00';
        return String(Math.min(99, v)).padStart(2, '0');
    }

    function padItem(n) {
        const v = parseInt(String(n ?? '').replace(/\D/g, ''), 10);
        if (!Number.isFinite(v) || v <= 0) return '001';
        return String(Math.min(999, v)).padStart(3, '0');
    }

    /** @param {string|number} groupNo @param {string|number} equipNo @param {string|number} itemNo */
    function format(groupNo, equipNo, itemNo) {
        const g = padGroup(groupNo);
        if (!g) return '';
        return `${g}-${padEquip(equipNo)}-${padItem(itemNo)}`;
    }

    /** @returns {{ groupNo: string, equipNo: number, itemNo: number, valid: boolean, standard: boolean, legacy: boolean, legacyKind: string }} */
    function parse(code) {
        const s = String(code || '').trim();
        let m = s.match(RE_STD);
        if (m) {
            return {
                groupNo: m[1],
                equipNo: parseInt(m[2], 10),
                itemNo: parseInt(m[3], 10),
                valid: true,
                standard: true,
                legacy: false,
                legacyKind: '',
            };
        }
        m = s.match(RE_LEGACY_V2);
        if (m) {
            return {
                groupNo: m[1],
                equipNo: 0,
                itemNo: parseInt(m[2], 10),
                valid: true,
                standard: false,
                legacy: true,
                legacyKind: 'v2',
            };
        }
        m = s.match(RE_LEGACY_V3);
        if (m) {
            const section = parseInt(m[2], 10);
            return {
                groupNo: m[1],
                equipNo: Math.min(99, section),
                itemNo: parseInt(m[3], 10),
                valid: true,
                standard: false,
                legacy: true,
                legacyKind: 'v3',
                section: m[2],
            };
        }
        m = s.match(/^(\d{1,2})[-.\s]/);
        if (m) {
            return {
                groupNo: padGroup(m[1]),
                equipNo: 0,
                itemNo: 0,
                valid: false,
                standard: false,
                legacy: true,
                legacyKind: 'partial',
            };
        }
        return {
            groupNo: '',
            equipNo: 0,
            itemNo: 0,
            valid: false,
            standard: false,
            legacy: false,
            legacyKind: '',
        };
    }

    function groupNoFromCode(code) {
        return parse(code).groupNo;
    }

    function groupNoFromLabel(groupLabel) {
        const m = String(groupLabel || '').trim().match(/^(\d{1,2})[\.\s~]/);
        return m ? padGroup(m[1]) : '';
    }

    function isStandard(code) {
        return RE_STD.test(String(code || '').trim());
    }

    /** @deprecated use isStandard */
    function isSimplified(code) {
        return isStandard(code);
    }

    function isLegacy(code) {
        const p = parse(code);
        return p.legacy && p.valid;
    }

    function compare(a, b) {
        const pa = parse(a);
        const pb = parse(b);
        if (pa.groupNo !== pb.groupNo) {
            return pa.groupNo.localeCompare(pb.groupNo, undefined, { numeric: true });
        }
        if (pa.equipNo !== pb.equipNo) return pa.equipNo - pb.equipNo;
        if (pa.itemNo !== pb.itemNo) return pa.itemNo - pb.itemNo;
        return String(a || '').localeCompare(String(b || ''));
    }

    function spareCodeOf(spare) {
        const s = spare || {};
        return String(s.inventoryNumbering || s.inventory_numbering || '').trim();
    }

    function intEquipNo(v) {
        const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
        return Number.isFinite(n) && n >= 0 ? Math.min(99, n) : 0;
    }

    function resolveGroupNo(spare, groupNoHint) {
        if (groupNoHint) return padGroup(groupNoHint);
        const fromCode = groupNoFromCode(spareCodeOf(spare));
        if (fromCode) return fromCode;
        return groupNoFromLabel(spare?.group || '');
    }

    function resolveEquipNo(spare, opts = {}) {
        if (opts.equipNo != null && opts.equipNo !== '') return intEquipNo(opts.equipNo);
        const s = spare || {};
        if (s.equipment_no != null && s.equipment_no !== '') return intEquipNo(s.equipment_no);
        if (s.equipmentNo != null && s.equipmentNo !== '') return intEquipNo(s.equipmentNo);
        const p = parse(spareCodeOf(s));
        if (p.valid) return p.equipNo;
        return 0;
    }

    function sortKey(spare) {
        const code = spareCodeOf(spare) || String(spare?.part_no || spare?.makerPartNo || '').trim();
        const p = parse(code);
        const g = p.groupNo || '99';
        const e = String(p.equipNo ?? 0).padStart(2, '0');
        const i = String(p.itemNo || 0).padStart(5, '0');
        return `${g}-${e}-${i}-${code}`;
    }

    function normalizeCode(code, groupNo, equipNo) {
        const g = padGroup(groupNo);
        if (!g || !code) return code;
        const p = parse(code);
        if (p.standard && p.groupNo === g) {
            if (equipNo != null && equipNo !== '' && intEquipNo(equipNo) !== p.equipNo) {
                return format(g, equipNo, p.itemNo || 1);
            }
            return String(code).trim();
        }
        if (!p.valid) return code;
        const eq = equipNo != null && equipNo !== '' ? intEquipNo(equipNo) : p.equipNo;
        if (p.legacyKind === 'v2' && p.groupNo === g) {
            return format(g, 0, p.itemNo || 1);
        }
        if (p.legacyKind === 'v3' && p.groupNo === g) {
            return format(g, eq || p.equipNo, p.itemNo || 1);
        }
        if (p.groupNo === g) return format(g, eq, p.itemNo || 1);
        return code;
    }

    /** @deprecated use normalizeCode */
    function normalizeForGroup(code, groupNo, equipNo) {
        return normalizeCode(code, groupNo, equipNo);
    }

    function nextInBlock(spares, groupNo, equipNo) {
        const g = padGroup(groupNo);
        if (!g) return '';
        const eq = intEquipNo(equipNo);
        let max = 0;
        (spares || []).forEach(s => {
            const p = parse(spareCodeOf(s));
            if (p.groupNo !== g || p.equipNo !== eq) return;
            if (p.valid && p.itemNo > 0) max = Math.max(max, p.itemNo);
        });
        return format(g, eq, max + 1);
    }

    function nextInGroup(spares, groupNo, equipNo) {
        const eq = equipNo != null && equipNo !== '' ? intEquipNo(equipNo) : 0;
        return nextInBlock(spares, groupNo, eq);
    }

    /**
     * Assign GG-EE-III codes per group+equipment block (sorted order preserved).
     * @returns {Map<string,string>} spare id → code
     */
    function assignCodes(spares, opts = {}) {
        const byBlock = new Map();
        (spares || []).forEach(s => {
            if (!s?.id) return;
            const g = resolveGroupNo(s, opts.groupNoFor?.(s)) || '99';
            const eq = resolveEquipNo(s, { equipNo: opts.equipNoFor?.(s) });
            const key = `${g}|${eq}`;
            if (!byBlock.has(key)) byBlock.set(key, []);
            byBlock.get(key).push(s);
        });
        const out = new Map();
        [...byBlock.entries()]
            .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
            .forEach(([, list]) => {
                list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
                const sample = list[0];
                const g = resolveGroupNo(sample, opts.groupNoFor?.(sample)) || '99';
                const eq = resolveEquipNo(sample, { equipNo: opts.equipNoFor?.(sample) });
                list.forEach((s, i) => out.set(s.id, format(g, eq, i + 1)));
            });
        return out;
    }

    /** @deprecated use assignCodes */
    function assignSimplifiedCodes(spares, opts) {
        return assignCodes(spares, opts);
    }

    async function renumberVessel(vesselId, opts = {}) {
        const vid = String(vesselId || '').trim();
        if (!vid) throw new Error('vessel_id required');
        const all = await TVC_DB.getAll('spare_parts').catch(() => []);
        const belongs = (row) => {
            if (typeof TVC_MasterVesselScope !== 'undefined') {
                return TVC_MasterVesselScope.belongs(row, vid);
            }
            return !row?.vessel_id || row.vessel_id === vid;
        };
        let scoped = all.filter(belongs);
        const dept = opts.department ? String(opts.department).toUpperCase() : '';
        if (dept) {
            scoped = scoped.filter(s => String(s.category || 'ENGINE').toUpperCase() === dept);
        }
        const canon = (row) => (typeof TVC_SpareSchema !== 'undefined' ? TVC_SpareSchema.fromRow(row) : row);
        const assignments = assignCodes(scoped.map(canon), {
            groupNoFor: opts.groupNoFor,
            equipNoFor: opts.equipNoFor,
        });
        let updated = 0;
        const ts = new Date().toISOString();
        for (const row of scoped) {
            const newCode = assignments.get(row.id);
            if (!newCode) continue;
            const old = String(row.inventory_numbering || '').trim();
            if (old === newCode) continue;
            row.inventory_numbering = newCode;
            row.updated_at = ts;
            row.sync_status = row.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (row.sync_status || 'LOCAL');
            await TVC_DB.put('spare_parts', row);
            updated++;
        }
        return { updated, total: scoped.length, vessel_id: vid, department: dept || null };
    }

    return {
        RE_STD,
        RE_LEGACY_V2,
        RE_LEGACY_V3,
        format,
        parse,
        groupNoFromCode,
        groupNoFromLabel,
        isStandard,
        isSimplified,
        isLegacy,
        compare,
        spareCodeOf,
        resolveEquipNo,
        normalizeCode,
        normalizeForGroup,
        nextInBlock,
        nextInGroup,
        assignCodes,
        assignSimplifiedCodes,
        renumberVessel,
        padEquip,
        padItem,
    };
})();
if (typeof window !== 'undefined') window.TVC_SpareCode = TVC_SpareCode;
