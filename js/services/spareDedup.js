/* SPARE inventory — duplicate spare_parts cleanup (same Code / group+part_no) */
const TVC_SpareDedup = (function () {
    const META_KEY = 'spare_parts_dedup_version';
    const META_VER = '20260826-v1';

    function norm(s) {
        return String(s ?? '').trim();
    }

    function normLower(s) {
        return norm(s).toLowerCase();
    }

    function normDept(s) {
        return norm(s || 'ENGINE').toUpperCase();
    }

    function sameVessel(row, vesselId) {
        const vid = norm(vesselId);
        if (!vid) return true;
        if (typeof TVC_MasterVesselScope !== 'undefined') {
            return TVC_MasterVesselScope.belongs(row, vid);
        }
        const rowVid = norm(row?.vessel_id);
        return !rowVid || rowVid === vid;
    }

    function canonicalCode(s) {
        let code = norm(s.inventory_numbering || s.part_no || '');
        if (!code) return '';
        if (typeof TVC_SpareCode !== 'undefined') {
            const p = TVC_SpareCode.parse(code);
            if (p.valid) return TVC_SpareCode.format(p.groupNo, p.equipNo, p.itemNo).toLowerCase();
        }
        return code.toLowerCase();
    }

    function matchKeys(s) {
        const dept = normDept(s.category);
        const keys = [];
        const code = canonicalCode(s);
        if (code) keys.push(`code:${dept}:${code}`);
        const grp = normLower(s.group);
        const pno = normLower(s.part_no || s.maker_part_no || '');
        if (grp && pno) keys.push(`grp:${dept}:${grp}:${pno}`);
        return keys;
    }

    function rowScore(s) {
        let score = 0;
        if (norm(s.vessel_id)) score += 1000;
        if (s.sync_status === 'SYNCED') score += 100;
        if (s.sync_status === 'PENDING_SYNC') score += 50;
        if (norm(s.inventory_numbering)) score += 20;
        if (norm(s.group)) score += 10;
        const t = Date.parse(s.updated_at || s.created_at || '') || 0;
        return score + t / 1e15;
    }

    class UnionFind {
        constructor() { this.parent = new Map(); }
        find(x) {
            if (!this.parent.has(x)) this.parent.set(x, x);
            if (this.parent.get(x) !== x) this.parent.set(x, this.find(this.parent.get(x)));
            return this.parent.get(x);
        }
        union(a, b) {
            const ra = this.find(a);
            const rb = this.find(b);
            if (ra !== rb) this.parent.set(rb, ra);
        }
    }

    function groupDuplicates(spares) {
        const keyToIds = new Map();
        spares.forEach(s => {
            const id = String(s.id);
            matchKeys(s).forEach(k => {
                if (!keyToIds.has(k)) keyToIds.set(k, []);
                keyToIds.get(k).push(id);
            });
        });
        const uf = new UnionFind();
        keyToIds.forEach(ids => {
            for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);
        });
        const byRoot = new Map();
        spares.forEach(s => {
            const id = String(s.id);
            const root = uf.find(id);
            if (!byRoot.has(root)) byRoot.set(root, []);
            byRoot.get(root).push(s);
        });
        return [...byRoot.values()].filter(g => g.length > 1);
    }

    async function relinkReferences(vesselId, idRemap) {
        if (!idRemap.size) return {};
        const mapId = (id) => {
            let cur = String(id || '').trim();
            const seen = new Set();
            while (cur && idRemap.has(cur) && !seen.has(cur)) {
                seen.add(cur);
                cur = idRemap.get(cur);
            }
            return cur || id;
        };

        const relinkLines = (lines) => {
            let n = 0;
            (lines || []).forEach(line => {
                const next = mapId(line?.spare_part_id);
                if (next && next !== line.spare_part_id) {
                    line.spare_part_id = next;
                    n++;
                }
            });
            return n;
        };

        const stats = {
            requisitions: 0, reqLines: 0, consumeLogs: 0, consumeLines: 0,
            workReports: 0, usedParts: 0, defectCases: 0, defectParts: 0,
            workPermits: 0, permitParts: 0, jobBom: 0,
        };

        const reqs = (await TVC_DB.getAll('requisitions').catch(() => []))
            .filter(r => sameVessel(r, vesselId));
        for (const req of reqs) {
            const n = relinkLines(req.lines);
            if (n) {
                stats.reqLines += n;
                stats.requisitions++;
                await TVC_DB.put('requisitions', req);
            }
        }

        const logs = (await TVC_DB.getAll('consume_logs').catch(() => []))
            .filter(r => sameVessel(r, vesselId));
        for (const log of logs) {
            const n = relinkLines(log.lines);
            if (n) {
                stats.consumeLines += n;
                stats.consumeLogs++;
                await TVC_DB.put('consume_logs', log);
            }
        }

        const reports = (await TVC_DB.getAll('daily_work_reports').catch(() => []))
            .filter(r => sameVessel(r, vesselId));
        for (const rep of reports) {
            let touched = false;
            const relinkPart = (part) => {
                const next = mapId(part?.spare_part_id);
                if (next && next !== part.spare_part_id) {
                    part.spare_part_id = next;
                    stats.usedParts++;
                    touched = true;
                }
            };
            (rep.used_parts || []).forEach(relinkPart);
            (rep.job_items || []).forEach(item => (item.used_parts || []).forEach(relinkPart));
            if (touched) {
                stats.workReports++;
                await TVC_DB.put('daily_work_reports', rep);
            }
        }

        const defects = (await TVC_DB.getAll('defect_cases').catch(() => []))
            .filter(r => sameVessel(r, vesselId));
        for (const dc of defects) {
            const n = relinkLines(dc.used_parts);
            if (n) {
                stats.defectParts += n;
                stats.defectCases++;
                await TVC_DB.put('defect_cases', dc);
            }
        }

        const permits = (await TVC_DB.getAll('work_permits').catch(() => []))
            .filter(r => sameVessel(r, vesselId));
        for (const wp of permits) {
            const n = relinkLines(wp.estimated_parts);
            if (n) {
                stats.permitParts += n;
                stats.workPermits++;
                await TVC_DB.put('work_permits', wp);
            }
        }

        const boms = await TVC_DB.getAll('job_bom').catch(() => []);
        for (const bom of boms) {
            const next = mapId(bom.spare_part_id);
            if (next && next !== bom.spare_part_id) {
                bom.spare_part_id = next;
                stats.jobBom++;
                await TVC_DB.put('job_bom', bom);
            }
        }

        return stats;
    }

    async function dedupeVessel(vesselId) {
        const vid = norm(vesselId);
        const all = await TVC_DB.getAll('spare_parts').catch(() => []);
        const spares = all.filter(s => sameVessel(s, vid));
        const dupGroups = groupDuplicates(spares);
        if (!dupGroups.length) {
            return { vesselId: vid, groups: 0, removed: 0, kept: spares.length };
        }

        const idRemap = new Map();
        let removed = 0;
        for (const group of dupGroups) {
            const sorted = group.slice().sort((a, b) => rowScore(b) - rowScore(a));
            const winner = sorted[0];
            for (let i = 1; i < sorted.length; i++) {
                const loser = sorted[i];
                idRemap.set(String(loser.id), String(winner.id));
                await TVC_DB.del('spare_parts', loser.id);
                removed++;
            }
        }

        const relink = await relinkReferences(vid, idRemap);
        const kept = spares.length - removed;
        return { vesselId: vid, groups: dupGroups.length, removed, kept, relink };
    }

    async function runOnce() {
        const done = await TVC_DB.getMeta(META_KEY).catch(() => null);
        if (done === META_VER) return { skipped: true };

        const all = await TVC_DB.getAll('spare_parts').catch(() => []);
        const vesselIds = new Set();
        all.forEach(s => {
            const vid = norm(s.vessel_id);
            if (vid) vesselIds.add(vid);
        });
        if (!vesselIds.size) {
            const fallback = typeof TVC_MasterVesselScope !== 'undefined'
                ? TVC_MasterVesselScope.defaultVesselId()
                : 'INCHEON CHEMI';
            vesselIds.add(fallback);
        }

        const results = [];
        let totalRemoved = 0;
        for (const vid of vesselIds) {
            const r = await dedupeVessel(vid);
            results.push(r);
            totalRemoved += r.removed || 0;
        }

        await TVC_DB.setMeta(META_KEY, META_VER);
        const summary = { version: META_VER, totalRemoved, vessels: results };
        console.info('[TVC_SpareDedup]', summary);
        return summary;
    }

    function normLabel(s) {
        return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function isRegisteredSpareEquipment(row, eq, spareGroups) {
        const eqName = normLabel(eq);
        if (!eqName) return false;
        const dept = String(row.category || 'ENGINE').toUpperCase();
        const grp = normLabel(row.group);
        return (spareGroups || []).some(g =>
            String(g.department || '').toUpperCase() === dept
            && normLabel(g.label) === grp
            && normLabel(g.item_sort1) === eqName);
    }

    function explicitEquipNoFor(s, spareGroups) {
        const eq = String(s.equipment || '').trim();
        if (!eq) return 0;
        const n = parseInt(String(s.equipment_no ?? s.equipmentNo ?? ''), 10);
        if (Number.isFinite(n) && n > 0) return n;
        const dept = String(s.category || 'ENGINE').toUpperCase();
        const grp = normLabel(s.group);
        const hit = (spareGroups || []).find(g =>
            String(g.department || '').toUpperCase() === dept
            && normLabel(g.label) === grp
            && normLabel(g.item_sort1) === normLabel(eq));
        const fromDef = parseInt(String(hit?.equipment_no ?? hit?.sort_order ?? ''), 10);
        return Number.isFinite(fromDef) && fromDef > 0 ? fromDef : 0;
    }

    /** Equipment 미지정인데 Code/item_sort1 등에서 추론된 equipment 필드 정리 */
    async function scrubInferredEquipmentOnce() {
        const KEY = 'spare_equipment_scrub_version';
        const VER = '20260826-v1';
        const done = await TVC_DB.getMeta(KEY).catch(() => null);
        if (done === VER) return { skipped: true };

        const spareGroups = await TVC_DB.getAll('spare_groups').catch(() => []);
        const allSpares = await TVC_DB.getAll('spare_parts').catch(() => []);
        let cleared = 0;
        const ts = new Date().toISOString();

        for (const row of allSpares) {
            const eq = String(row.equipment || row.item_sort1 || '').trim();
            if (!eq) {
                if (row.item_sort1 || row.equipment_no) {
                    row.equipment = '';
                    row.equipment_no = 0;
                    row.item_sort1 = undefined;
                    row.updated_at = ts;
                    await TVC_DB.put('spare_parts', row);
                    cleared++;
                }
                continue;
            }
            const shouldClear = normLabel(row.name) === normLabel(eq)
                || normLabel(row.group) === normLabel(eq)
                || !isRegisteredSpareEquipment(row, eq, spareGroups);
            if (!shouldClear) continue;
            row.equipment = '';
            row.equipment_no = 0;
            row.item_sort1 = undefined;
            row.updated_at = ts;
            row.sync_status = row.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (row.sync_status || 'LOCAL');
            await TVC_DB.put('spare_parts', row);
            cleared++;
        }

        let renumbered = 0;
        if (typeof TVC_SpareCode !== 'undefined' && cleared) {
            const vesselIds = new Set();
            allSpares.forEach(s => { const v = norm(s.vessel_id); if (v) vesselIds.add(v); });
            if (!vesselIds.size) {
                vesselIds.add(typeof TVC_MasterVesselScope !== 'undefined'
                    ? TVC_MasterVesselScope.defaultVesselId()
                    : 'INCHEON CHEMI');
            }
            const groupsAfter = await TVC_DB.getAll('spare_groups').catch(() => []);
            for (const vid of vesselIds) {
                for (const dept of ['ENGINE', 'DECK']) {
                    const r = await TVC_SpareCode.renumberVessel(vid, {
                        department: dept,
                        equipNoFor: (s) => explicitEquipNoFor(s, groupsAfter),
                    });
                    renumbered += r.updated || 0;
                }
            }
        }

        await TVC_DB.setMeta(KEY, VER);
        const summary = { version: VER, cleared, renumbered };
        console.info('[TVC_SpareDedup] scrub inferred equipment', summary);
        return summary;
    }

    return { runOnce, dedupeVessel, scrubInferredEquipmentOnce, META_KEY, META_VER };
})();
if (typeof window !== 'undefined') window.TVC_SpareDedup = TVC_SpareDedup;
