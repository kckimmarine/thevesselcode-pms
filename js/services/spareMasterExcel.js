/* SPARE Master Excel — Export / Import (Group · Equipment · Spare Parts)
 * Filename: incheonchemi_spare_master_YYYYMMDD_001.xlsx
 */
const TVC_SpareMasterExcel = (function () {
    const NAVY = 'FF1A365D';
    const GREEN = 'FF217346';
    const HDR_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
    const HDR_ROW = 5;
    const DATA_START = 6;

    const SPARE_GEN_ENGINE_NO = '03';
    const SPARE_GEN_ENGINE_NAME = 'GENERATOR ENGINE';
    const SPARE_GEN_ENGINE_LABEL = '03. GENERATOR ENGINE';

    function isSpareGenEngineGroup(label) {
        if (typeof TVC_SpareMenu !== 'undefined' && TVC_SpareMenu.isGeneratorEngineGroupLabel) {
            return TVC_SpareMenu.isGeneratorEngineGroupLabel(label);
        }
        const s = norm(label);
        if (/^03\s*~\s*05/i.test(s) && /GENERATOR\s+ENGINE/i.test(s)) return true;
        if (s === norm(SPARE_GEN_ENGINE_LABEL)) return true;
        const m = s.match(/^(\d{1,2})\./);
        if (!m) return false;
        const n = parseInt(m[1], 10);
        if (n < 3 || n > 5) return false;
        return /GENERATOR\s+ENGINE/i.test(s);
    }

    function isSpareGenEngineMasterRow(groupNo, groupName) {
        return padGroupNo(groupNo) === SPARE_GEN_ENGINE_NO
            && norm(groupName).toUpperCase() === SPARE_GEN_ENGINE_NAME;
    }

    function resolveSpareMasterGroup(dept, groupLabel) {
        if (isSpareGenEngineGroup(groupLabel)) {
            return { no: SPARE_GEN_ENGINE_NO, name: SPARE_GEN_ENGINE_NAME, label: SPARE_GEN_ENGINE_LABEL };
        }
        return resolveGroup(dept, groupLabel);
    }

    function resolveSpareMasterImportGroup(groupNo, groupName) {
        if (isSpareGenEngineMasterRow(groupNo, groupName)) {
            return { no: SPARE_GEN_ENGINE_NO, name: SPARE_GEN_ENGINE_NAME, label: SPARE_GEN_ENGINE_LABEL };
        }
        const no = padGroupNo(groupNo);
        const name = norm(groupName);
        return { no, name, label: buildGroupLabel(no, name) };
    }

    function listPmsGenEngineLabels(groups, groupNodes, dept) {
        const labels = new Set();
        (groupNodes || []).forEach(n => {
            if (dept && n.department !== dept) return;
            if (!isSpareGenEngineGroup(n.label)) return;
            if (norm(n.label) === norm(SPARE_GEN_ENGINE_LABEL)) return;
            labels.add(n.label);
        });
        (groups || []).forEach(g => {
            if (g.item_sort1) return;
            if (dept && g.department !== dept) return;
            if (!isSpareGenEngineGroup(g.label)) return;
            if (norm(g.label) === norm(SPARE_GEN_ENGINE_LABEL)) return;
            labels.add(g.label);
        });
        return [...labels];
    }

    async function upsertSpareGroupDef(row, itemSort1, ctx = {}) {
        if (isSpareGenEngineMasterRow(row.groupNo, row.groupName)) {
            const labels = listPmsGenEngineLabels(ctx.groups, ctx.groupNodes, row.department);
            if (labels.length) {
                for (const lab of labels) {
                    await upsertGroupDef({ ...row, label: lab }, itemSort1 || null);
                }
                return;
            }
        }
        await upsertGroupDef(row, itemSort1 || null);
    }

    const PMS = () => (typeof TVC_PmsMasterExcel !== 'undefined' ? TVC_PmsMasterExcel : null);

    function norm(s) {
        return String(s ?? '').replace(/\s+/g, ' ').trim();
    }

    function padGroupNo(n) {
        const pms = PMS();
        if (pms?.splitGroupLabel) {
            const d = parseInt(String(n).replace(/\D/g, ''), 10);
            return Number.isFinite(d) ? String(d).padStart(2, '0') : String(n || '').trim();
        }
        const d = parseInt(String(n).replace(/\D/g, ''), 10);
        return Number.isFinite(d) ? String(d).padStart(2, '0') : String(n || '').trim();
    }

    function buildGroupLabel(no, name) {
        const pms = PMS();
        if (pms?.buildGroupLabel) return pms.buildGroupLabel(no, name);
        const n = padGroupNo(no);
        const nm = norm(name);
        return n && nm ? `${n}. ${nm}` : norm(name) || '';
    }

    function splitGroupLabel(label) {
        const pms = PMS();
        if (pms?.splitGroupLabel) return pms.splitGroupLabel(label);
        const s = norm(label);
        const m = s.match(/^(\d{1,2})\.\s*(.+)$/);
        if (m) return { no: padGroupNo(m[1]), name: norm(m[2]), label: `${padGroupNo(m[1])}. ${norm(m[2])}` };
        return { no: '', name: s, label: s };
    }

    function resolveGroup(dept, groupLabel) {
        const pms = PMS();
        if (pms?.resolveGroup) return pms.resolveGroup(dept, groupLabel);
        return splitGroupLabel(groupLabel);
    }

    function parseCriticalCell(v) {
        const s = norm(v).toLowerCase();
        if (!s) return null;
        if (s === 'y' || s === 'yes' || s === '1' || s === 'true') return true;
        if (s === 'n' || s === 'no' || s === '0' || s === 'false') return false;
        return null;
    }

    function cellStr(row, col) {
        if (!col) return '';
        const v = row.getCell(col).value;
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object' && v.text != null) return norm(v.text);
        return norm(v);
    }

    function intCell(row, col) {
        const s = cellStr(row, col);
        if (!s) return 0;
        const n = Number(String(s).replace(/,/g, ''));
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }

    function styleHeaderRow(row, fillArgb) {
        row.eachCell(cell => {
            cell.font = HDR_FONT;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
            cell.alignment = { vertical: 'middle', wrapText: true };
        });
        row.height = 22;
    }

    function addMetaRows(ws, lines, colSpan = 12) {
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

    async function masterExcelFilename(vesselId) {
        if (typeof TVC_Filename !== 'undefined') {
            return TVC_Filename.buildFlat({ vesselId, type: 'spare_master', ext: 'xlsx' });
        }
        const slug = String(vesselId || 'vessel').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'vessel';
        const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        return `${slug}_spare_master_${dateTag}_001.xlsx`;
    }

    function canonSpare(row) {
        return TVC_SpareSchema.fromRow(row);
    }

    function spareNumbering(s) {
        return s.inventoryNumbering || s.makerPartNo || s.part_no || '';
    }

    function spareDepartment(s, groupNodes) {
        const cat = String(s.category || '').trim().toUpperCase();
        if (cat === 'ENGINE' || cat === 'DECK') return cat;
        const label = String(s.group || '').trim();
        if (label && Array.isArray(groupNodes)) {
            const node = groupNodes.find(n => norm(n.label) === norm(label));
            if (node?.department) return node.department;
        }
        const code = spareNumbering(s);
        const m = String(code).trim().match(/^(\d{1,2})[-.\s]/);
        if (m && Array.isArray(groupNodes)) {
            const codeNo = parseInt(m[1], 10);
            const node = groupNodes.find(n => {
                const gm = norm(n.label).match(/^(\d{1,2})\./);
                return gm && parseInt(gm[1], 10) === codeNo;
            });
            if (node?.department) return node.department;
        }
        return 'ENGINE';
    }

    function resolveSpareGroupLabel(s, groupNodes) {
        let label = String(s.group || '').trim();
        if (label && label !== '—') return label;
        const code = spareNumbering(s);
        const m = String(code).trim().match(/^(\d{1,2})[-.\s]/);
        if (m && Array.isArray(groupNodes)) {
            const codeNo = parseInt(m[1], 10);
            const dept = spareDepartment(s, groupNodes);
            let node = groupNodes.find(n => {
                const gm = norm(n.label).match(/^(\d{1,2})\./);
                return gm && parseInt(gm[1], 10) === codeNo && (!dept || n.department === dept);
            });
            if (!node) {
                node = groupNodes.find(n => {
                    const gm = norm(n.label).match(/^(\d{1,2})\./);
                    return gm && parseInt(gm[1], 10) === codeNo;
                });
            }
            if (node?.label) return node.label;
        }
        return label;
    }

    function normalizeGroupLabel(s) {
        return norm(s).toLowerCase().replace(/(\d+)\s*~\s*(\d+)/g, '$1~$2');
    }

    function exportGroupKey(dept, groupLabel) {
        const g = resolveSpareMasterGroup(dept, groupLabel);
        if (!g.no || !g.name) return null;
        return `${dept}|${g.no}|${g.name}`;
    }

    function buildGroupMetaMap(groups) {
        const map = new Map();
        (groups || []).forEach(g => {
            if (g.item_sort1) return;
            const resolved = resolveSpareMasterGroup(g.department, g.label);
            if (!resolved.no || !resolved.name) return;
            const k = `${g.department}|${resolved.no}|${resolved.name}`;
            const prev = map.get(k);
            if (!prev || g.header_edited || (g.updated_at && (!prev.updated_at || g.updated_at > prev.updated_at))) {
                map.set(k, g);
            }
        });
        return map;
    }

    function collectExportGroupCounts(exportSpares, groups, jobs, groupNodes) {
        const counts = new Map();
        const ensure = (department, label, addParts = 0) => {
            const dept = String(department || '').trim().toUpperCase();
            const lab = String(label || '').trim();
            if (!dept || !lab) return;
            const k = exportGroupKey(dept, lab);
            if (!k) return;
            counts.set(k, (counts.get(k) || 0) + addParts);
        };

        exportSpares.forEach(s => {
            const dept = spareDepartment(s, groupNodes);
            const raw = String(s.group || '').trim() || resolveSpareGroupLabel(s, groupNodes);
            if (!raw) return;
            ensure(dept, raw, 1);
        });

        (groups || []).forEach(g => {
            if (g.item_sort1) return;
            if (isSpareGenEngineGroup(g.label) && norm(g.label) !== norm(SPARE_GEN_ENGINE_LABEL)) return;
            ensure(g.department, g.label, 0);
        });

        (jobs || []).forEach(j => {
            if (!j.group) return;
            if (isSpareGenEngineGroup(j.group)) return;
            ensure(j.department, j.group, 0);
        });

        return counts;
    }

    function pickSpareGroupMeta(groupMeta, groups, dept, no, name) {
        const k = `${dept}|${no}|${name}`;
        if (groupMeta.has(k)) return groupMeta.get(k);

        if (isSpareGenEngineMasterRow(no, name)) {
            for (const g of groups || []) {
                if (g.item_sort1 || g.department !== dept) continue;
                if (!isSpareGenEngineGroup(g.label)) continue;
                if (norm(g.label) === norm(SPARE_GEN_ENGINE_LABEL)) continue;
                return g;
            }
        }

        const targetName = norm(name).toUpperCase();
        for (const g of groups || []) {
            if (g.item_sort1 || g.department !== dept) continue;
            const sg = resolveSpareMasterGroup(dept, g.label);
            if (sg.no === padGroupNo(no) && norm(sg.name).toUpperCase() === targetName) return g;
            if (padGroupNo(splitGroupLabel(g.label).no) === padGroupNo(no)
                && normalizeGroupLabel(sg.name) === normalizeGroupLabel(name)) return g;
        }
        return {};
    }

    async function loadExportData() {
        const [spares, groups, jobs, meta] = await Promise.all([
            TVC_DB.getAll('spare_parts'),
            TVC_DB.getAll('maintenance_groups').catch(() => []),
            TVC_DB.getAll('maintenance_jobs').catch(() => []),
            TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null),
        ]);
        let vesselId = meta || 'INCHEON CHEMI';
        if (typeof TVC_Fleet !== 'undefined') {
            vesselId = TVC_Fleet.getSelected()?.name || TVC_Fleet.PILOT_VESSEL_ID || vesselId;
        }
        const idxState = {
            jobs: jobs || [],
            groups: groups || [],
            components: [],
            spares: spares || [],
            reports: [],
        };
        const groupNodes = (typeof TVC_Indexes !== 'undefined')
            ? TVC_Indexes.build(idxState).groupNodes
            : (groups || []).filter(g => !g.item_sort1).map(g => ({ label: g.label, department: g.department }));
        return {
            spares: (spares || []).map(canonSpare),
            groups: groups || [],
            jobs: jobs || [],
            groupNodes,
            vesselId,
        };
    }

    async function exportToWorkbook(opts = {}) {
        if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS가 로드되지 않았습니다.');
        const data = opts.spares ? { ...opts, jobs: opts.jobs || [], groups: opts.groups || [] } : await loadExportData();
        const { spares, groups, jobs, groupNodes, vesselId } = data;
        const exportSpares = (opts.spares || spares || []).map(canonSpare);

        const groupCounts = collectExportGroupCounts(exportSpares, groups, jobs, groupNodes);

        const groupRows = [...groupCounts.entries()].map(([k, count]) => {
            const [department, no, ...nameParts] = k.split('|');
            return { department, no, name: nameParts.join('|'), count };
        }).sort((a, b) => {
            if (a.department !== b.department) return a.department.localeCompare(b.department);
            return a.no.localeCompare(b.no, undefined, { numeric: true });
        });

        const groupMeta = buildGroupMetaMap(groups);

        const wb = new ExcelJS.Workbook();
        wb.creator = 'TVC-PMS';

        const wsG = wb.addWorksheet('Group Headers', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
        addMetaRows(wsG, [
            `Vessel: ${vesselId}  ·  SPARE Master — Group Headers`,
            'Live DB snapshot: SPARE/PMS group tree edits + spare item CRUD. Re-export after UI changes.',
        ]);
        ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'Critical Equipment', 'Maker', 'Model/Type', 'Capacity', 'Serial No.', 'Parts (ref)'].forEach((h, i) => {
            wsG.getRow(HDR_ROW).getCell(i + 1).value = h;
        });
        styleHeaderRow(wsG.getRow(HDR_ROW), NAVY);
        groupRows.forEach((gr, idx) => {
            const r = wsG.getRow(DATA_START + idx);
            const meta = pickSpareGroupMeta(groupMeta, groups, gr.department, gr.no, gr.name);
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

        const wsE = wb.addWorksheet('Equipment Headers', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
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
            const sg = isSpareGenEngineGroup(g.label)
                ? { no: SPARE_GEN_ENGINE_NO, name: SPARE_GEN_ENGINE_NAME }
                : splitGroupLabel(g.label);
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

        const wsP = wb.addWorksheet('Spare Parts', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
        addMetaRows(wsP, [
            `Vessel: ${vesselId}  ·  ${exportSpares.length} spare parts`,
            'SPARE_ID hidden. Generator Engine parts export as GROUP 03 · GENERATOR ENGINE (not PMS 03/04/05 split).',
        ], 13);
        const pHeaders = ['SPARE_ID', 'DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'Code', 'Class', 'Dwg No.', 'Part No.', 'Items', 'Unit', 'Work', 'Std', 'Rob'];
        pHeaders.forEach((h, i) => { wsP.getRow(HDR_ROW).getCell(i + 1).value = h; });
        styleHeaderRow(wsP.getRow(HDR_ROW), NAVY);
        wsP.getColumn(1).hidden = true;

        exportSpares.forEach((s, idx) => {
            const dept = spareDepartment(s, groupNodes);
            const raw = String(s.group || '').trim() || resolveSpareGroupLabel(s, groupNodes);
            const g = raw ? resolveSpareMasterGroup(dept, raw) : { no: '', name: '' };
            const r = wsP.getRow(DATA_START + idx);
            r.getCell(1).value = s.id || '';
            r.getCell(2).value = dept;
            r.getCell(3).value = g.no;
            r.getCell(4).value = g.name;
            r.getCell(5).value = spareNumbering(s);
            r.getCell(6).value = TVC_SpareSchema.normalizePartClass(s.partClass) || '';
            r.getCell(7).value = s.drawingPartNo || '';
            r.getCell(8).value = s.makerPartNo || '';
            r.getCell(9).value = s.name || '';
            r.getCell(10).value = (s.unit || 'EA').toUpperCase();
            r.getCell(11).value = TVC_SpareSchema.intStock(s.workingQty);
            r.getCell(12).value = TVC_SpareSchema.intStock(s.standardStock ?? s.minStock);
            r.getCell(13).value = TVC_SpareSchema.intStock(s.currentStock);
        });
        pHeaders.forEach((_, i) => { wsP.getColumn(i + 1).width = [0, 12, 10, 28, 14, 8, 14, 16, 32, 8, 8, 8, 8][i] || 12; });

        return wb;
    }

    async function exportToFile(opts = {}) {
        const wb = await exportToWorkbook(opts);
        const vesselId = opts.vesselId || (await loadExportData()).vesselId;
        const buf = await wb.xlsx.writeBuffer();
        const filename = await masterExcelFilename(vesselId);
        await downloadBlob(buf, filename);
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'SPARE_MASTER',
                scope: 'SPARE',
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

    function parseSpareRows(ws) {
        const h = parseSheetHeaders(ws);
        const col = key => h[key.toUpperCase()] || h[key];
        const rows = [];
        ws.eachRow((row, n) => {
            if (n < DATA_START) return;
            const dept = cellStr(row, col('DEPARTMENT'));
            const no = padGroupNo(cellStr(row, col('GROUP NO')));
            const name = cellStr(row, col('GROUP NAME'));
            const code = cellStr(row, col('CODE'));
            const partNo = cellStr(row, col('PART NO.')) || cellStr(row, col('PART NO'));
            const itemName = cellStr(row, col('ITEMS')) || cellStr(row, col('ITEM'));
            if (!dept && !no && !name && !code && !partNo && !itemName) return;
            const ig = resolveSpareMasterImportGroup(no, name);
            rows.push({
                spare_id: cellStr(row, col('SPARE_ID')),
                department: dept.toUpperCase(),
                groupNo: ig.no,
                groupName: ig.name,
                group: ig.label,
                code,
                partClass: cellStr(row, col('CLASS')),
                dwgNo: cellStr(row, col('DWG NO.')) || cellStr(row, col('DWG NO')),
                partNo,
                name: itemName,
                unit: cellStr(row, col('UNIT')) || 'EA',
                work: intCell(row, col('WORK')),
                std: intCell(row, col('STD')),
                rob: intCell(row, col('ROB')),
            });
        });
        return rows;
    }

    function groupDefId(dept, label, itemSort1) {
        const base = `${dept}|${norm(label)}|${norm(itemSort1 || '')}`;
        return 'grp-' + base.replace(/[^\w|.-]/g, '_').slice(0, 80);
    }

    async function upsertGroupDef(row, itemSort1) {
        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        const label = row.label;
        const dept = row.department;
        const item = norm(itemSort1 || '');
        let hit = defs.find(g => g.department === dept && norm(g.label) === norm(label) && norm(g.item_sort1 || '') === item);
        const id = hit?.id || groupDefId(dept, label, item);
        const next = {
            ...(hit || {}),
            id,
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

    function findSpareMatch(row, byId, byCode, byPart) {
        if (row.spare_id && byId.has(row.spare_id)) return byId.get(row.spare_id);
        const codeKey = norm(row.code).toLowerCase();
        if (codeKey && byCode.has(codeKey)) return byCode.get(codeKey);
        const partKey = `${row.department}|${norm(row.group)}|${norm(row.partNo).toLowerCase()}`;
        if (row.partNo && byPart.has(partKey)) return byPart.get(partKey);
        return null;
    }

    async function importFromWorkbook(wb, user) {
        const canImport = TVC_RBAC.isHqAccount(user)
            ? TVC_RBAC.canModifyOriginalPlan(user)
            : (TVC_RBAC.isMaintPlanEditor(user) && TVC_RBAC.canModifySpareInventory(user));
        if (!canImport) {
            throw Object.assign(new Error('SPARE Master Import는 Chief Engineer, Chief Officer, Captain(Master), 또는 HQ Superintendent만 사용할 수 있습니다.'), { code: 'PERMISSION_DENIED' });
        }
        if (TVC_RBAC.isHqAccount(user)) TVC_RBAC.assertModifyOriginalPlan(user);

        const wsG = wb.getWorksheet('Group Headers');
        const wsE = wb.getWorksheet('Equipment Headers');
        const wsP = wb.getWorksheet('Spare Parts');
        if (!wsP) throw new Error('Spare Parts 시트를 찾을 수 없습니다.');

        const groupRows = wsG ? parseGroupRows(wsG) : [];
        const equipRows = wsE ? parseEquipmentRows(wsE) : [];
        const spareRows = parseSpareRows(wsP);
        if (!spareRows.length) throw new Error('Spare Parts 시트에 데이터가 없습니다.');

        const [groups, groupNodes, jobs] = await Promise.all([
            TVC_DB.getAll('maintenance_groups').catch(() => []),
            loadExportData().then(d => d.groupNodes).catch(() => []),
            TVC_DB.getAll('maintenance_jobs').catch(() => []),
        ]);
        const importCtx = { groups, groupNodes, jobs };

        for (const g of groupRows) await upsertSpareGroupDef(g, null, importCtx);
        for (const e of equipRows) await upsertSpareGroupDef(e, e.item_sort1, importCtx);

        const existing = await TVC_DB.getAll('spare_parts');
        const byId = new Map(existing.map(r => [r.id, r]));
        const byCode = new Map();
        const byPart = new Map();
        existing.forEach(r => {
            const code = norm(r.inventory_numbering || r.part_no || '').toLowerCase();
            if (code) byCode.set(code, r);
            const dept = String(r.category || 'ENGINE').toUpperCase();
            const grp = norm(r.group);
            const pno = norm(r.part_no).toLowerCase();
            if (pno) byPart.set(`${dept}|${grp}|${pno}`, r);
        });

        let created = 0;
        let updated = 0;

        for (const row of spareRows) {
            if (!row.department) row.department = 'ENGINE';
            let spare = findSpareMatch(row, byId, byCode, byPart);
            const now = new Date().toISOString();

            if (!spare) {
                if (!row.code && !row.partNo && !row.name) continue;
                const id = typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : 'sp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
                const uic = row.code
                    ? ''
                    : TVC_SpareSchema.generateUniversalItemCode(row.name || row.partNo);
                spare = TVC_SpareSchema.toRow({
                    id,
                    universalItemCode: uic,
                    makerPartNo: row.partNo,
                    inventoryNumbering: row.code,
                    name: row.name,
                    partClass: row.partClass,
                    drawingPartNo: row.dwgNo,
                    group: row.group,
                    category: row.department,
                    unit: row.unit,
                    workingQty: row.work,
                    standardStock: row.std,
                    minStock: row.std,
                    currentStock: row.rob,
                    sync_status: 'LOCAL',
                    updated_at: now,
                });
                if (row.code && !spare.universal_item_code) {
                    spare.universal_item_code = TVC_SpareSchema.generateUniversalItemCode(row.code);
                    spare.universal_code = spare.universal_item_code;
                }
                created++;
            } else {
                const canon = canonSpare(spare);
                if (row.group) canon.group = row.group;
                if (row.department) canon.category = row.department;
                if (row.code) canon.inventoryNumbering = row.code;
                if (row.partNo) canon.makerPartNo = row.partNo;
                if (row.name) canon.name = row.name;
                if (row.partClass) canon.partClass = row.partClass;
                if (row.dwgNo !== undefined) canon.drawingPartNo = row.dwgNo;
                if (row.unit) canon.unit = row.unit;
                canon.workingQty = row.work;
                canon.standardStock = row.std;
                canon.minStock = row.std;
                canon.currentStock = row.rob;
                canon.sync_status = spare.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (spare.sync_status || 'LOCAL');
                canon.updated_at = now;
                spare = TVC_SpareSchema.toRow(canon);
                updated++;
            }
            await TVC_DB.put('spare_parts', spare);
            byId.set(spare.id, spare);
            const codeKey = norm(spare.inventory_numbering || spare.part_no || '').toLowerCase();
            if (codeKey) byCode.set(codeKey, spare);
            const partKey = `${row.department}|${norm(row.group)}|${norm(spare.part_no).toLowerCase()}`;
            if (spare.part_no) byPart.set(partKey, spare);
        }

        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📥 [SPARE Master Import] parts +${created} ~${updated} — ${user.display_name}`,
            sync_status: 'LOCAL',
        });

        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'IMPORT',
                direction: 'SPARE_MASTER',
                scope: 'SPARE',
                vessel_id: typeof TVC_Fleet !== 'undefined' ? (TVC_Fleet.getSelected()?.name || '') : '',
            });
        }

        return { created, updated, groups: groupRows.length, equipment: equipRows.length, parts: spareRows.length };
    }

    async function importFromFile(file, user) {
        if (!file) throw new Error('파일이 없습니다.');
        if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS가 로드되지 않았습니다.');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        return importFromWorkbook(wb, user);
    }

    return {
        exportToFile,
        exportToWorkbook,
        importFromFile,
        importFromWorkbook,
        masterExcelFilename,
        buildGroupLabel,
        splitGroupLabel,
        resolveGroup,
        resolveSpareMasterGroup,
        isSpareGenEngineGroup,
        SPARE_GEN_ENGINE_LABEL,
    };
})();
