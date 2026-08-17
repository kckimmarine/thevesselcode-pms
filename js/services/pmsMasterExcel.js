/* PMS Master Excel — Export / Import (Group · Equipment · Jobs)
 * Format: INCHEON CHEMI_PMS_MASTER_SAMPLE.xlsx (V.1 aligned)
 */
const TVC_PmsMasterExcel = (function () {
    const NAVY = 'FF1A365D';
    const GREEN = 'FF217346';
    const HDR_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
    const META_ROWS = 4;
    const HDR_ROW = 5;
    const DATA_START = 6;

    /** Legacy DECK group number (old label prefix) → new catalog (user-approved) */
    const DECK_LEGACY_CATALOG = [
        { legacy: 26, no: '01', name: 'CARGO TANK MONITORING SYSTEM' },
        { legacy: 28, no: '02', name: 'LSA/FFE' },
        { legacy: 29, no: '03', name: 'MOORING WINCH & WINDLASS' },
        { legacy: 30, no: '04', name: 'HOSE HANDLING CRANE' },
        { legacy: 31, no: '05', name: 'ODME & RELATED SYSTEM' },
        { legacy: 32, no: '06', name: 'NAVIGATION & COMMUNICATION' },
        { legacy: 33, no: '07', name: 'CARGO EQUIPMENTS' },
        { legacy: 34, no: '08', name: 'PRESSURE TEST & HULL PARTS' },
        { legacy: 35, no: '09', name: 'BWTS' },
        { legacy: 36, no: '10', name: 'SAEFETY INSPECTION' },
    ];
    const DECK_LEGACY_MAP = new Map(DECK_LEGACY_CATALOG.map(c => [c.legacy, c]));

    function norm(s) {
        return String(s ?? '').replace(/\s+/g, ' ').trim();
    }

    async function resolveImportVesselId(user, opts = {}) {
        if (typeof TVC_MasterVesselScope !== 'undefined') {
            return TVC_MasterVesselScope.resolve(user, {
                vesselId: opts.vesselId,
                selectedVesselId: opts.selectedVesselId,
            });
        }
        if (opts.vesselId) return String(opts.vesselId).trim();
        if (typeof TVC_Fleet !== 'undefined' && TVC_Fleet.getSelectedId()) {
            return TVC_Fleet.getSelectedId();
        }
        return (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null)) || 'INCHEON CHEMI';
    }

    function sameVessel(row, vesselId) {
        if (typeof TVC_MasterVesselScope !== 'undefined') {
            return TVC_MasterVesselScope.belongs(row, vesselId);
        }
        return !row?.vessel_id || row.vessel_id === vesselId;
    }

    function padGroupNo(n) {
        const d = parseInt(String(n).replace(/\D/g, ''), 10);
        return Number.isFinite(d) ? String(d).padStart(2, '0') : String(n || '').trim();
    }

    function buildGroupLabel(no, name) {
        const n = padGroupNo(no);
        const nm = norm(name);
        return n && nm ? `${n}. ${nm}` : norm(name) || '';
    }

    /** "01. MAIN ENGINE" → { no, name, label } */
    function splitGroupLabel(label) {
        const s = norm(label);
        const m = s.match(/^(\d{1,2})\.\s*(.+)$/);
        if (m) return { no: padGroupNo(m[1]), name: norm(m[2]), label: `${padGroupNo(m[1])}. ${norm(m[2])}` };
        return { no: '', name: s, label: s };
    }

    function legacyGroupNum(label) {
        const m = norm(label).match(/^(\d{1,2})\./);
        return m ? parseInt(m[1], 10) : null;
    }

    /** True only when label number + name match a DECK_LEGACY_CATALOG entry (not number alone). */
    function isLegacyDeckGroupLabel(groupLabel) {
        const leg = legacyGroupNum(groupLabel);
        if (leg == null) return false;
        const hit = DECK_LEGACY_MAP.get(leg);
        if (!hit) return false;
        const sg = splitGroupLabel(groupLabel);
        return norm(sg.name).toUpperCase() === norm(hit.name).toUpperCase();
    }

    /** Remove group-level defs (no item_sort1) with no jobs referencing them. */
    async function pruneEmptyGroupDefs(allJobs, vesselId) {
        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        const used = new Set(
            (allJobs || []).map(j => `${j.department}|${norm(j.group)}`)
        );
        let pruned = 0;
        for (const g of defs) {
            if (vesselId && !sameVessel(g, vesselId)) continue;
            if (norm(g.item_sort1)) continue;
            const key = `${g.department}|${norm(g.label)}`;
            if (!used.has(key) && g.id) {
                await TVC_DB.del('maintenance_groups', g.id);
                pruned++;
            }
        }
        return pruned;
    }

    /** DECK legacy seed → new group no/name; ENGINE unchanged */
    function resolveGroup(dept, groupLabel) {
        const d = String(dept || '').trim().toUpperCase();
        if (d === 'DECK') {
            const leg = legacyGroupNum(groupLabel);
            const hit = leg != null ? DECK_LEGACY_MAP.get(leg) : null;
            if (hit) return { no: hit.no, name: hit.name, label: buildGroupLabel(hit.no, hit.name) };
        }
        return splitGroupLabel(groupLabel);
    }

    function parseCriticalCell(v) {
        const s = norm(v).toLowerCase();
        if (!s) return null;
        if (s === '⚠' || s === 'y' || s === 'yes' || s === '1' || s === 'true') return true;
        if (s === 'n' || s === 'no' || s === '0' || s === 'false') return false;
        return null;
    }

    function criticalDisplay(v) {
        if (v === true) return '⚠';
        return '';
    }

    function calcNextDate(job, fromDateStr) {
        if (typeof TVC_Transaction !== 'undefined' && TVC_Transaction.calcNextDate) {
            return TVC_Transaction.calcNextDate(job, fromDateStr);
        }
        const d = new Date(fromDateStr);
        const p = Number(job.period) || 1;
        switch ((job.unit || 'M').toUpperCase()) {
            case 'D': d.setDate(d.getDate() + p); break;
            case 'W': d.setDate(d.getDate() + p * 7); break;
            case 'Y': d.setFullYear(d.getFullYear() + p); break;
            case 'H': d.setMonth(d.getMonth() + Math.max(1, Math.round(p / 500))); break;
            default: d.setMonth(d.getMonth() + p); break;
        }
        return d.toISOString().slice(0, 10);
    }

    function cellStr(row, col) {
        const v = row.getCell(col).value;
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object' && v.text != null) return norm(v.text);
        return norm(v);
    }

    function styleHeaderRow(row, fillArgb) {
        row.eachCell(cell => {
            cell.font = HDR_FONT;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
            cell.alignment = { vertical: 'middle', wrapText: true };
        });
        row.height = 22;
    }

    function addMetaRows(ws, lines, colSpan = 8) {
        lines.forEach((text, i) => {
            const r = ws.getRow(i + 1);
            r.getCell(1).value = text;
            r.getCell(1).font = { italic: true, color: { argb: 'FF4A5568' }, size: 10 };
            ws.mergeCells(i + 1, 1, i + 1, colSpan);
        });
    }

    async function downloadBlob(buf, filename) {
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        await TVC_FileExport.save(blob, filename);
    }

    function normDept(dept) {
        const d = String(dept || '').trim().toUpperCase();
        if (d !== 'DECK' && d !== 'ENGINE') throw new Error('Department must be DECK or ENGINE.');
        return d;
    }

    function rowsForDepartment(rows, department) {
        const dept = normDept(department);
        const scoped = (rows || []).filter(r => String(r.department || '').toUpperCase() === dept);
        const foreign = (rows || []).filter(r => {
            const d = String(r.department || '').toUpperCase();
            return d && d !== dept;
        });
        if (foreign.length) {
            throw new Error(`Excel contains ${foreign[0].department} data; select ${dept} and use a ${dept}-only master file.`);
        }
        return scoped;
    }

    async function masterExcelFilename(vesselId, department) {
        const dept = normDept(department);
        if (typeof TVC_Filename !== 'undefined') {
            return TVC_Filename.build({ vesselId, type: 'pms_master', department: dept, ext: 'xlsx' });
        }
        const slug = String(vesselId || 'vessel').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'vessel';
        const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        return `${slug}_pms_master_${dept.toLowerCase()}_${dateTag}_001.xlsx`;
    }

    /** Renumber DECK job codes on export (26-001 → 01-001). ENGINE codes unchanged. */
    function renumberJobsForExport(jobs) {
        const engine = [];
        const deckBuckets = new Map();
        for (const j of jobs) {
            const dept = String(j.department || 'ENGINE').toUpperCase();
            const g = resolveGroup(dept, j.group);
            const normalized = { ...j, group: g.label };
            if (dept !== 'DECK') {
                engine.push(normalized);
                continue;
            }
            const key = `${g.no}|${g.label}`;
            if (!deckBuckets.has(key)) deckBuckets.set(key, []);
            deckBuckets.get(key).push(normalized);
        }
        const deckOut = [];
        for (const [, list] of deckBuckets) {
            list.sort((a, b) => String(a.job_code || '').localeCompare(String(b.job_code || ''), undefined, { numeric: true }));
            const g = splitGroupLabel(list[0].group);
            list.forEach((j, i) => {
                deckOut.push({ ...j, job_code: `${g.no}-${String(i + 1).padStart(3, '0')}` });
            });
        }
        return [...engine, ...deckOut].sort((a, b) => {
            if (a.department !== b.department) return String(a.department).localeCompare(String(b.department));
            return String(a.job_code || '').localeCompare(String(b.job_code || ''), undefined, { numeric: true });
        });
    }

    /** Import: legacy DECK codes (26-001) → GROUP NO based (01-001) */
    function normalizeImportJobRows(jobRows) {
        const byGroup = new Map();
        for (const row of jobRows) {
            const k = `${row.department}|${row.groupNo}`;
            if (!byGroup.has(k)) byGroup.set(k, []);
            byGroup.get(k).push(row);
        }
        for (const list of byGroup.values()) {
            list.sort((a, b) => String(a.job_code || '').localeCompare(String(b.job_code || ''), undefined, { numeric: true }));
            list.forEach((row, i) => {
                if (row.department !== 'DECK') return;
                const prefix = parseInt(String(row.job_code || '').split('-')[0], 10);
                const groupNo = parseInt(row.groupNo, 10);
                if (!Number.isFinite(prefix) || !Number.isFinite(groupNo) || prefix === groupNo) return;
                row._legacyJobCode = row.job_code;
                row.job_code = `${row.groupNo}-${String(i + 1).padStart(3, '0')}`;
            });
        }
        return jobRows;
    }

    function jobShowsCritical(j) {
        if (j.is_critical_equipment === true) return true;
        if (j.is_critical_equipment === false) return false;
        const s = norm(j.sort).toUpperCase();
        return s.includes('CRITICAL');
    }

    async function loadExportData(department, opts = {}) {
        const dept = normDept(department);
        const [jobs, groups, meta] = await Promise.all([
            TVC_DB.getAll('maintenance_jobs'),
            TVC_DB.getAll('maintenance_groups').catch(() => []),
            TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null),
        ]);
        let vesselId = opts.vesselId || meta || 'INCHEON CHEMI';
        if (!opts.vesselId && typeof TVC_Fleet !== 'undefined') {
            vesselId = TVC_Fleet.getSelectedId() || TVC_Fleet.getSelected()?.name || TVC_Fleet.PILOT_VESSEL_ID || vesselId;
        }
        const vesselJobs = (jobs || []).filter(j => sameVessel(j, vesselId));
        const vesselGroups = (groups || []).filter(g => sameVessel(g, vesselId));
        const scopedJobs = renumberJobsForExport(vesselJobs).filter(j => String(j.department || '').toUpperCase() === dept);
        const scopedGroups = vesselGroups.filter(g => String(g.department || '').toUpperCase() === dept);
        return { jobs: scopedJobs, groups: scopedGroups, vesselId, department: dept };
    }

    async function exportToWorkbook(opts = {}) {
        if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS가 로드되지 않았습니다.');
        const department = normDept(opts.department);
        const loaded = opts.jobs ? opts : await loadExportData(department, opts);
        const { jobs, groups, vesselId } = loaded;
        const exportJobs = (opts.jobs || jobs).filter(j => String(j.department || '').toUpperCase() === department);

        const groupCounts = new Map();
        exportJobs.forEach(j => {
            const g = resolveGroup(j.department, j.group);
            const k = `${j.department}|${g.no}|${g.name}`;
            groupCounts.set(k, (groupCounts.get(k) || 0) + 1);
        });
        // Append-only groups (no jobs yet) live in maintenance_groups — include them in export.
        (groups || []).forEach(g => {
            if (g.item_sort1) return;
            const sg = splitGroupLabel(g.label);
            if (!sg.no || !sg.name || !g.department) return;
            const k = `${g.department}|${sg.no}|${sg.name}`;
            if (!groupCounts.has(k)) groupCounts.set(k, 0);
        });

        const groupRows = [...groupCounts.entries()].map(([k, count]) => {
            const [department, no, ...nameParts] = k.split('|');
            const name = nameParts.join('|');
            return { department, no, name, count };
        }).sort((a, b) => {
            if (a.department !== b.department) return a.department.localeCompare(b.department);
            return a.no.localeCompare(b.no, undefined, { numeric: true });
        });

        const groupMeta = new Map();
        (groups || []).forEach(g => {
            if (g.item_sort1) return;
            const sg = splitGroupLabel(g.label);
            groupMeta.set(`${g.department}|${sg.no}|${sg.name}`, g);
        });

        const wb = new ExcelJS.Workbook();
        wb.creator = 'TVC-PMS';

        const wsG = wb.addWorksheet('Group Headers', { views: [{ state: 'frozen', ySplit: DATA_START - 1 }] });
        addMetaRows(wsG, [
            `Vessel: ${vesselId}  ·  PMS Master — ${department} — Group Headers`,
            'Live DB snapshot — PMS GROUP Tree (maintenance_groups + maintenance_jobs) for this department only.',
        ]);
        ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'Critical Equipment', 'Maker', 'Model/Type', 'Capacity', 'Serial No.', 'Jobs (ref)'].forEach((h, i) => {
            wsG.getRow(HDR_ROW).getCell(i + 1).value = h;
        });
        styleHeaderRow(wsG.getRow(HDR_ROW), NAVY);
        groupRows.forEach((gr, idx) => {
            const r = wsG.getRow(DATA_START + idx);
            const meta = groupMeta.get(`${gr.department}|${gr.no}|${gr.name}`) || {};
            r.getCell(1).value = gr.department;
            r.getCell(2).value = gr.no;
            r.getCell(3).value = gr.name;
            r.getCell(4).value = meta.is_critical_equipment === true ? 'Yes' : meta.is_critical_equipment === false ? 'No' : '';
            r.getCell(5).value = meta.maker || meta.machinery_name || '';
            r.getCell(6).value = meta.model_type || '';
            r.getCell(7).value = meta.capacity || '';
            r.getCell(8).value = meta.serial_no || '';
            r.getCell(9).value = gr.count;
        });
        [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(i => { wsG.getColumn(i).width = i === 3 ? 28 : 14; });

        const wsE = wb.addWorksheet('Equipment Headers', { views: [{ state: 'frozen', ySplit: DATA_START - 1 }] });
        addMetaRows(wsE, [
            `Vessel: ${vesselId}  ·  Optional item_sort1 overrides (sparse)`,
            'Add rows only where GROUP header is not enough (e.g. CYL. OIL LUBRICATOR, individual motors).',
        ]);
        ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'ITEM (SORT-1)', 'Critical Equipment', 'Maker', 'Model/Type', 'Capacity', 'Serial No.'].forEach((h, i) => {
            wsE.getRow(HDR_ROW).getCell(i + 1).value = h;
        });
        styleHeaderRow(wsE.getRow(HDR_ROW), GREEN);
        let eqRow = 0;
        (groups || []).filter(g => norm(g.item_sort1)).forEach(g => {
            const sg = splitGroupLabel(g.label);
            const r = wsE.getRow(DATA_START + eqRow++);
            r.getCell(1).value = g.department;
            r.getCell(2).value = sg.no;
            r.getCell(3).value = sg.name;
            r.getCell(4).value = norm(g.item_sort1);
            r.getCell(5).value = g.is_critical_equipment === true ? 'Yes' : g.is_critical_equipment === false ? 'No' : '';
            r.getCell(6).value = g.maker || g.machinery_name || '';
            r.getCell(7).value = g.model_type || '';
            r.getCell(8).value = g.capacity || '';
            r.getCell(9).value = g.serial_no || '';
        });

        const wsJ = wb.addWorksheet('Jobs', { views: [{ state: 'frozen', ySplit: DATA_START - 1 }] });
        addMetaRows(wsJ, [
            `Vessel: ${vesselId}  ·  ${department} — ${exportJobs.length} jobs`,
            'JOB_ID column is hidden (export only). Edit GROUP NO / JOB CODE freely — rows removed from this sheet are dropped on import (Work Report linked jobs are kept with temp code). New jobs: leave JOB_ID empty.',
        ], 14);
        const jHeaders = ['JOB_ID', 'DEPARTMENT', 'GROUP NO', 'GROUP NAME', '⚠', 'JOB CODE', 'SORT-1', 'SORT-2', 'JOB DETAIL', 'PERIOD', 'UNIT', 'P.I.C', 'NEXT DATE', 'LAST DONE'];
        jHeaders.forEach((h, i) => { wsJ.getRow(HDR_ROW).getCell(i + 1).value = h; });
        styleHeaderRow(wsJ.getRow(HDR_ROW), NAVY);
        wsJ.getColumn(1).hidden = true;

        exportJobs.forEach((j, idx) => {
            const g = resolveGroup(j.department, j.group);
            const r = wsJ.getRow(DATA_START + idx);
            r.getCell(1).value = j.id || '';
            r.getCell(2).value = j.department || '';
            r.getCell(3).value = g.no;
            r.getCell(4).value = g.name;
            r.getCell(5).value = criticalDisplay(j.is_critical_equipment != null ? j.is_critical_equipment : jobShowsCritical(j));
            r.getCell(6).value = j.job_code || '';
            r.getCell(7).value = norm(j.item_sort1);
            r.getCell(8).value = norm(j.item_sort2);
            r.getCell(9).value = j.job_detail || '';
            r.getCell(10).value = j.period != null ? Number(j.period) : '';
            r.getCell(11).value = (j.unit || 'M').toUpperCase();
            r.getCell(12).value = j.pic || '';
            if (j.next_date) r.getCell(13).value = j.next_date;
            if (j.last_done) r.getCell(14).value = j.last_done;
        });

        return wb;
    }

    async function exportToFile(opts = {}) {
        const department = normDept(opts.department);
        const vesselId = opts.vesselId
            || opts.selectedVesselId
            || (typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.getSelectedId() : null)
            || (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null))
            || 'INCHEON CHEMI';
        const wb = await exportToWorkbook({ ...opts, department, vesselId });
        const buf = await wb.xlsx.writeBuffer();
        const filename = await masterExcelFilename(vesselId, department);
        await downloadBlob(buf, filename);
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'PMS_MASTER',
                scope: 'PMS',
                department,
                filename,
                file_name: filename,
                vessel_id: vesselId,
            });
        }
        return true;
    }

    function parseSheetHeaders(ws) {
        const row = ws.getRow(HDR_ROW);
        const map = {};
        row.eachCell((cell, col) => {
            const h = norm(cell.value).toUpperCase();
            if (h) map[h] = col;
        });
        return map;
    }

    function parseGroupRows(ws) {
        const h = parseSheetHeaders(ws);
        const rows = [];
        ws.eachRow((row, n) => {
            if (n < DATA_START) return;
            const dept = cellStr(row, h.DEPARTMENT);
            const no = padGroupNo(cellStr(row, h['GROUP NO'] || h.GROUP));
            const name = cellStr(row, h['GROUP NAME']);
            if (!dept || !no || !name) return;
            rows.push({
                department: dept.toUpperCase(),
                groupNo: no,
                groupName: name,
                label: buildGroupLabel(no, name),
                critical: parseCriticalCell(row.getCell(h['CRITICAL EQUIPMENT'] || 0).value),
                maker: cellStr(row, h.MAKER),
                model_type: cellStr(row, h['MODEL/TYPE'] || h.MODEL),
                capacity: cellStr(row, h.CAPACITY),
                serial_no: cellStr(row, h['SERIAL NO.'] || h['SERIAL NO']),
            });
        });
        return rows;
    }

    function parseEquipmentRows(ws) {
        const h = parseSheetHeaders(ws);
        const rows = [];
        ws.eachRow((row, n) => {
            if (n < DATA_START) return;
            const dept = cellStr(row, h.DEPARTMENT);
            const no = padGroupNo(cellStr(row, h['GROUP NO']));
            const name = cellStr(row, h['GROUP NAME']);
            const item = cellStr(row, h['ITEM (SORT-1)'] || h['SORT-1']);
            if (!dept || !no || !name || !item) return;
            rows.push({
                department: dept.toUpperCase(),
                groupNo: no,
                groupName: name,
                label: buildGroupLabel(no, name),
                item_sort1: item,
                critical: parseCriticalCell(row.getCell(h['CRITICAL EQUIPMENT'] || 0).value),
                maker: cellStr(row, h.MAKER),
                model_type: cellStr(row, h['MODEL/TYPE']),
                capacity: cellStr(row, h.CAPACITY),
                serial_no: cellStr(row, h['SERIAL NO.'] || h['SERIAL NO']),
            });
        });
        return rows;
    }

    function parseJobRows(ws) {
        const h = parseSheetHeaders(ws);
        const col = key => h[key.toUpperCase()] || h[key];
        const rows = [];
        ws.eachRow((row, n) => {
            if (n < DATA_START) return;
            const dept = cellStr(row, col('DEPARTMENT'));
            const jobCode = cellStr(row, col('JOB CODE'));
            if (!dept || !jobCode) return;
            const no = padGroupNo(cellStr(row, col('GROUP NO')));
            const name = cellStr(row, col('GROUP NAME'));
            rows.push({
                job_id: cellStr(row, col('JOB_ID')),
                department: dept.toUpperCase(),
                groupNo: no,
                groupName: name,
                group: buildGroupLabel(no, name),
                critical: parseCriticalCell(row.getCell(col('⚠') || col('CRITICAL')).value),
                job_code: jobCode,
                item_sort1: cellStr(row, col('SORT-1')),
                item_sort2: cellStr(row, col('SORT-2')),
                job_detail: cellStr(row, col('JOB DETAIL')),
                period: cellStr(row, col('PERIOD')),
                unit: cellStr(row, col('UNIT')) || 'M',
                pic: cellStr(row, col('P.I.C') || col('PIC')),
                next_date: cellStr(row, col('NEXT DATE')),
                last_done: cellStr(row, col('LAST DONE')),
            });
        });
        return rows;
    }

    async function jobHasFinalizedHistory(jobId) {
        const reports = await TVC_DB.getAll('daily_work_reports');
        for (const rep of reports) {
            TVC_WorkReport.fromLegacy(rep);
            for (const item of rep.job_items || []) {
                if (item.maintenance_job_id !== jobId) continue;
                const st = TVC_RBAC.normalizeReportStatus(item.status, rep.is_locked);
                if (st === 'CONFIRMED' || st === 'APPROVED') return true;
            }
        }
        return false;
    }

    async function jobHasAnyWorkReport(jobId) {
        const reports = await TVC_DB.getAll('daily_work_reports');
        for (const rep of reports) {
            TVC_WorkReport.fromLegacy(rep);
            for (const item of rep.job_items || []) {
                if (item.maintenance_job_id === jobId) return true;
            }
        }
        return false;
    }

    function tempJobCode(jobId) {
        return `__tvc_${String(jobId || '').replace(/-/g, '').slice(0, 12)}`;
    }

    function refreshJobMaps(jobs) {
        return {
            byId: new Map(jobs.map(j => [j.id, j])),
            byDeptCode: new Map(jobs.map(j => [`${j.department}|${j.job_code}`, j])),
        };
    }

    function importRowMatchesJob(row, job) {
        if (row.job_id && row.job_id === job.id) return true;
        if (row.department !== job.department) return false;
        if (row.job_code === job.job_code) return true;
        if (row._legacyJobCode && row._legacyJobCode === job.job_code) return true;
        if (norm(row.group) === norm(job.group) && norm(row.job_detail) === norm(job.job_detail)) return true;
        return false;
    }

    function findImportJobMatch(row, byId, byDeptCode, existingJobs) {
        if (row.job_id) {
            const byIdHit = byId.get(row.job_id);
            if (byIdHit) return byIdHit;
        }
        let job = byDeptCode.get(`${row.department}|${row.job_code}`);
        if (job) return job;
        if (row._legacyJobCode) {
            job = byDeptCode.get(`${row.department}|${row._legacyJobCode}`);
            if (job) return job;
        }
        const gNorm = norm(row.group);
        const dNorm = norm(row.job_detail);
        if (gNorm && dNorm) {
            job = existingJobs.find(j =>
                j.department === row.department &&
                norm(j.group) === gNorm &&
                norm(j.job_detail) === dNorm
            );
            if (job) return job;
        }
        return null;
    }

    /** Excel에 없는 job 제거 — Work Report 연결 시 임시 CODE로 격리 (선택 선박만) */
    async function removeOrphanJobs(jobRows, vesselId) {
        const importIds = new Set(jobRows.map(r => r.job_id).filter(Boolean));
        const importDepts = new Set(jobRows.map(r => r.department));
        const existingJobs = await TVC_DB.getAll('maintenance_jobs');
        let removed = 0;
        let detached = 0;

        for (const job of existingJobs) {
            if (vesselId && !sameVessel(job, vesselId)) continue;
            if (!importDepts.has(job.department)) continue;
            if (importIds.has(job.id)) continue;
            if (jobRows.some(row => importRowMatchesJob(row, job))) continue;

            if (await jobHasAnyWorkReport(job.id)) {
                const temp = tempJobCode(job.id);
                if (job.job_code !== temp) {
                    await cascadeJobCodeRename(job.job_code, temp, job.id);
                    job.job_code = temp;
                    job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
                    job.updated_at = new Date().toISOString();
                    await TVC_DB.put('maintenance_jobs', job);
                    detached++;
                }
            } else {
                await TVC_DB.del('maintenance_jobs', job.id);
                removed++;
            }
        }
        return { removed, detached };
    }

    /** 일괄 JOB CODE 변경 충돌 방지 — 먼저 고유 임시 CODE로 이동 */
    async function reserveJobCodeSlots(jobRows, byId) {
        let reserved = 0;
        for (const row of jobRows) {
            if (!row.job_id) continue;
            const job = byId.get(row.job_id);
            if (!job || job.job_code === row.job_code) continue;
            const temp = tempJobCode(job.id);
            if (job.job_code === temp) continue;
            await cascadeJobCodeRename(job.job_code, temp, job.id);
            job.job_code = temp;
            job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
            job.updated_at = new Date().toISOString();
            await TVC_DB.put('maintenance_jobs', job);
            reserved++;
        }
        return reserved;
    }

    async function cascadeJobCodeRename(oldCode, newCode, jobId) {
        let n = 0;
        const reports = await TVC_DB.getAll('daily_work_reports');
        for (const raw of reports) {
            const rep = { ...raw };
            TVC_WorkReport.fromLegacy(rep);
            let changed = false;
            if (rep.job_code === oldCode) { rep.job_code = newCode; changed = true; }
            if (Array.isArray(rep.job_codes)) {
                rep.job_codes = rep.job_codes.map(c => c === oldCode ? newCode : c);
                if (rep.job_codes.some((c, i) => c !== raw.job_codes?.[i])) changed = true;
            }
            for (const item of rep.job_items || []) {
                if (item.job_code === oldCode && (item.maintenance_job_id === jobId || !item.maintenance_job_id)) {
                    item.job_code = newCode;
                    if (!item.maintenance_job_id) item.maintenance_job_id = jobId;
                    changed = true;
                }
            }
            if (changed) { await TVC_DB.put('daily_work_reports', rep); n++; }
        }
        const defects = await TVC_DB.getAll('defect_cases');
        for (const dc of defects) {
            let changed = false;
            if (dc.pms_job_code === oldCode || dc.job_code === oldCode) {
                if (dc.pms_job_code === oldCode) dc.pms_job_code = newCode;
                if (dc.job_code === oldCode) dc.job_code = newCode;
                if (!dc.maintenance_job_id) dc.maintenance_job_id = jobId;
                changed = true;
            }
            if (changed) await TVC_DB.put('defect_cases', dc);
        }
        const boms = await TVC_DB.getAll('job_bom');
        for (const b of boms) {
            if (b.job_code === oldCode) {
                b.job_code = newCode;
                await TVC_DB.put('job_bom', b);
            }
        }
        return n;
    }

    function deckJobUsesLegacyCatalog(job) {
        if (String(job?.department || '').toUpperCase() !== 'DECK') return false;
        const leg = legacyGroupNum(job.group);
        return leg != null && DECK_LEGACY_MAP.has(leg);
    }

    /**
     * Live DB — legacy DECK seed (26·28·… groups) → approved catalog (01·02·…).
     * HQ/Master Excel Export only renumbered in the file; this aligns Vessel Deck PC on load.
     */
    async function applyDeckCatalogNormalization(jobs, groups) {
        const pool = jobs || [];
        const legacyDeck = pool.filter(deckJobUsesLegacyCatalog);
        if (!legacyDeck.length) return { updated: 0, renamed: 0, groups: 0, spares: 0 };

        const labelMap = new Map();
        const normalized = renumberJobsForExport(pool);
        const normById = new Map(
            normalized.filter(j => String(j.department || '').toUpperCase() === 'DECK').map(j => [j.id, j])
        );

        const stamp = new Date().toISOString();
        const changedJobs = [];
        let renamed = 0;

        for (const job of pool) {
            if (!deckJobUsesLegacyCatalog(job)) continue;
            const normJob = normById.get(job.id);
            if (!normJob) continue;

            const oldCode = job.job_code;
            const oldGroup = job.group;
            job.group = normJob.group;

            if (oldCode !== normJob.job_code) {
                await cascadeJobCodeRename(oldCode, normJob.job_code, job.id);
                job.job_code = normJob.job_code;
                renamed++;
            }
            if (norm(oldGroup) !== norm(job.group)) {
                labelMap.set(norm(oldGroup), job.group);
            }
            job.catalog_normalized_at = stamp;
            job.updated_at = stamp;
            changedJobs.push(job);
        }

        if (changedJobs.length) await TVC_DB.bulkPut('maintenance_jobs', changedJobs);

        const changedGroups = [];
        for (const g of groups || []) {
            if (String(g.department || '').toUpperCase() !== 'DECK' || norm(g.item_sort1)) continue;
            const leg = legacyGroupNum(g.label);
            if (leg == null || !DECK_LEGACY_MAP.has(leg)) continue;
            const resolved = resolveGroup('DECK', g.label);
            if (norm(g.label) === norm(resolved.label)) continue;
            labelMap.set(norm(g.label), resolved.label);
            g.label = resolved.label;
            g.updated_at = stamp;
            changedGroups.push(g);
        }
        if (changedGroups.length) await TVC_DB.bulkPut('maintenance_groups', changedGroups);

        let sparesUpdated = 0;
        if (labelMap.size) {
            const spares = await TVC_DB.getAll('spare_parts').catch(() => []);
            const spareChanges = [];
            for (const s of spares) {
                const cat = String(s.category || '').toUpperCase();
                if (cat && cat !== 'DECK') continue;
                const mapped = labelMap.get(norm(s.group));
                if (!mapped) continue;
                s.group = mapped;
                if (!s.category) s.category = 'DECK';
                spareChanges.push(s);
            }
            if (spareChanges.length) {
                await TVC_DB.bulkPut('spare_parts', spareChanges);
                sparesUpdated = spareChanges.length;
            }
        }

        const vesselIds = [...new Set(pool.map(j => j.vessel_id).filter(Boolean))];
        if (vesselIds.length) {
            for (const vid of vesselIds) {
                await pruneEmptyGroupDefs(pool.filter(j => sameVessel(j, vid)), vid);
            }
        } else {
            await pruneEmptyGroupDefs(pool);
        }

        if (changedJobs.length || changedGroups.length || sparesUpdated) {
            console.info(`[TVC] DECK catalog normalized: jobs=${changedJobs.length}, codes renamed=${renamed}, groups=${changedGroups.length}, spares=${sparesUpdated}`);
        }
        return { updated: changedJobs.length, renamed, groups: changedGroups.length, spares: sparesUpdated };
    }

    function groupDefId(vesselId, dept, label, itemSort1) {
        const v = String(vesselId || '').replace(/[^\w.-]+/g, '_').slice(0, 40);
        const base = `${v}|${dept}|${norm(label)}|${norm(itemSort1 || '')}`;
        return 'grp-' + base.replace(/[^\w|.-]/g, '_').slice(0, 100);
    }

    async function upsertGroupDef(row, itemSort1, vesselId) {
        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        const label = row.label;
        const dept = row.department;
        const item = norm(itemSort1 || '');
        let hit = defs.find(g =>
            sameVessel(g, vesselId)
            && g.department === dept
            && norm(g.label) === norm(label)
            && norm(g.item_sort1 || '') === item
        );
        const id = hit?.id || groupDefId(vesselId, dept, label, item);
        const next = {
            ...(hit || {}),
            id,
            vessel_id: vesselId,
            department: dept,
            label,
            item_sort1: item || null,
            machinery_name: row.maker || hit?.machinery_name || '',
            maker: row.maker || hit?.maker || '',
            model_type: row.model_type || hit?.model_type || '',
            capacity: row.capacity || hit?.capacity || '',
            serial_no: row.serial_no || hit?.serial_no || '',
            is_critical_equipment: row.critical != null ? row.critical : hit?.is_critical_equipment,
            header_edited: true,
            updated_at: new Date().toISOString(),
            sync_status: hit?.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (hit?.sync_status || 'LOCAL'),
        };
        await TVC_DB.put('maintenance_groups', next);
    }

    function rebuildComponentTree(jobs, vesselId) {
        const components = {};
        let order = 0;
        function ensure(path, nodeType, label, parentId) {
            const key = path.join('|');
            if (components[key]) return components[key].id;
            const id = typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : 'cmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            order++;
            components[key] = {
                id,
                vessel_id: vesselId || null,
                parent_id: parentId || null,
                path: [...path],
                label,
                node_type: nodeType,
                sort_order: order,
            };
            return id;
        }
        for (const job of jobs) {
            const dept = job.department;
            const parts = [dept, job.group, job.sort, job.item_sort1, job.item_sort2].map(p => norm(p)).filter(Boolean);
            let parent = null;
            const pathAcc = [];
            const types = ['DEPARTMENT', 'GROUP', 'SORT', 'ITEM_L1', 'ITEM_L2'];
            for (let i = 0; i < parts.length; i++) {
                pathAcc.push(parts[i]);
                parent = ensure(pathAcc, types[Math.min(i, types.length - 1)], parts[i], parent);
            }
            job.ship_component_id = parent;
            if (vesselId) job.vessel_id = vesselId;
        }
        return Object.values(components);
    }

    async function importFromWorkbook(wb, user, opts = {}) {
        TVC_RBAC.assertModifyOriginalPlan(user);
        const department = normDept(opts.department);
        const vesselId = await resolveImportVesselId(user, opts);
        const wsG = wb.getWorksheet('Group Headers');
        const wsE = wb.getWorksheet('Equipment Headers');
        const wsJ = wb.getWorksheet('Jobs');
        if (!wsJ) throw new Error('Jobs 시트를 찾을 수 없습니다.');

        const groupRows = rowsForDepartment(wsG ? parseGroupRows(wsG) : [], department);
        const equipRows = rowsForDepartment(wsE ? parseEquipmentRows(wsE) : [], department);
        const jobRows = rowsForDepartment(normalizeImportJobRows(parseJobRows(wsJ)), department);
        if (!jobRows.length) throw new Error(`Jobs 시트에 ${department} 데이터가 없습니다.`);

        for (const g of groupRows) await upsertGroupDef(g, null, vesselId);
        for (const e of equipRows) await upsertGroupDef(e, e.item_sort1, vesselId);

        const orphanStats = await removeOrphanJobs(jobRows, vesselId);
        let allExisting = await TVC_DB.getAll('maintenance_jobs');
        let existingJobs = allExisting.filter(j => sameVessel(j, vesselId));
        let { byId, byDeptCode } = refreshJobMaps(existingJobs);
        await reserveJobCodeSlots(jobRows, byId);

        allExisting = await TVC_DB.getAll('maintenance_jobs');
        existingJobs = allExisting.filter(j => sameVessel(j, vesselId));
        ({ byId, byDeptCode } = refreshJobMaps(existingJobs));

        let created = 0;
        let updated = 0;
        let renamed = 0;
        const importStamp = new Date().toISOString();

        for (const row of jobRows) {
            // 타 선박 job_id 는 무시하고 신규 생성 (선박별 분리)
            if (row.job_id && byId.has(row.job_id) === false) {
                const foreign = allExisting.find(j => j.id === row.job_id && !sameVessel(j, vesselId));
                if (foreign) row.job_id = null;
            }
            let job = findImportJobMatch(row, byId, byDeptCode, existingJobs);

            const period = Number(row.period) || 1;
            const unit = (row.unit || 'M').toUpperCase();
            let nextDate = row.next_date || null;
            const lastDone = row.last_done || null;
            if (lastDone && !nextDate) {
                nextDate = calcNextDate({ period, unit }, lastDone);
            }

            if (!job) {
                const dup = existingJobs.filter(j => j.department === row.department && j.job_code === row.job_code);
                if (dup.length) throw new Error(`JOB CODE 중복: ${row.department} ${row.job_code}`);

                const newId = row.job_id && !byId.has(row.job_id)
                    ? row.job_id
                    : (typeof crypto !== 'undefined' && crypto.randomUUID
                        ? crypto.randomUUID()
                        : 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
                job = {
                    id: newId,
                    vessel_id: vesselId,
                    department: row.department,
                    group: row.group,
                    job_code: row.job_code,
                    sort: '',
                    item_sort1: row.item_sort1,
                    item_sort2: row.item_sort2,
                    job_detail: row.job_detail,
                    period,
                    unit,
                    pic: row.pic,
                    next_date: nextDate,
                    last_done: lastDone,
                    original_next_date: nextDate,
                    is_critical_equipment: row.critical,
                    is_locked: false,
                    plan_status: 'PLANNED',
                    schedule_basis: null,
                    sync_status: 'LOCAL',
                    master_import_at: importStamp,
                    updated_at: importStamp,
                };
                if (job.next_date && new Date(job.next_date) < new Date(new Date().toDateString())) {
                    job.is_overdue = true;
                    job.plan_status = 'OVERDUE';
                }
                created++;
            } else {
                const oldCode = job.job_code;
                const protectedSched = await jobHasFinalizedHistory(job.id);

                job.vessel_id = vesselId;
                job.department = row.department;
                job.group = row.group;
                job.item_sort1 = row.item_sort1;
                job.item_sort2 = row.item_sort2;
                job.job_detail = row.job_detail;
                job.period = period;
                job.unit = unit;
                job.pic = row.pic;
                if (row.critical != null) job.is_critical_equipment = row.critical;

                if (!protectedSched) {
                    if (lastDone) job.last_done = lastDone;
                    if (nextDate) job.next_date = nextDate;
                }

                if (oldCode !== row.job_code) {
                    await cascadeJobCodeRename(oldCode, row.job_code, job.id);
                    job.job_code = row.job_code;
                    renamed++;
                } else if (row._legacyJobCode && row._legacyJobCode !== row.job_code && oldCode === row._legacyJobCode) {
                    await cascadeJobCodeRename(row._legacyJobCode, row.job_code, job.id);
                    job.job_code = row.job_code;
                    renamed++;
                }
                job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
                job.master_import_at = importStamp;
                job.updated_at = importStamp;
                updated++;
            }
            await TVC_DB.put('maintenance_jobs', job);
            byId.set(job.id, job);
            byDeptCode.set(`${job.department}|${job.job_code}`, job);
            const idx = existingJobs.findIndex(j => j.id === job.id);
            if (idx >= 0) existingJobs[idx] = job;
            else existingJobs.push(job);
        }

        const vesselJobs = (await TVC_DB.getAll('maintenance_jobs')).filter(j => sameVessel(j, vesselId));
        await pruneEmptyGroupDefs(vesselJobs, vesselId);
        if (typeof TVC_MasterVesselScope !== 'undefined') {
            await TVC_MasterVesselScope.clearVesselStore('ship_components', vesselId);
        }
        const comps = rebuildComponentTree(vesselJobs, vesselId);
        if (comps.length) await TVC_DB.bulkPut('ship_components', comps);
        for (const job of vesselJobs) {
            await TVC_DB.put('maintenance_jobs', job);
        }

        const orphanNote = orphanStats.removed || orphanStats.detached
            ? ` · 제외 ${orphanStats.removed} · Work Report 격리 ${orphanStats.detached}`
            : '';
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📥 [PMS Master Import] ${vesselId} jobs +${created} ~${updated} rename ${renamed}${orphanNote} — ${user.display_name}`,
            sync_status: 'LOCAL',
        });
        await TVC_DB.setMeta(TVC_META_KEYS.PMS_MASTER_IMPORTED, importStamp);

        return {
            created, updated, renamed,
            removed: orphanStats.removed,
            detached: orphanStats.detached,
            groups: groupRows.length,
            equipment: equipRows.length,
            jobs: jobRows.length,
            vessel_id: vesselId,
        };
    }

    async function importFromFile(file, user, opts = {}) {
        if (!file) throw new Error('파일이 없습니다.');
        if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS가 로드되지 않았습니다.');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        return importFromWorkbook(wb, user, opts);
    }

    return {
        exportToFile, exportToWorkbook, importFromFile, importFromWorkbook,
        buildGroupLabel, splitGroupLabel, resolveGroup, renumberJobsForExport,
        isLegacyDeckGroupLabel, pruneEmptyGroupDefs, findImportJobMatch, importRowMatchesJob,
        applyDeckCatalogNormalization, deckJobUsesLegacyCatalog,
        masterExcelFilename,
        DECK_LEGACY_CATALOG,
    };
})();
