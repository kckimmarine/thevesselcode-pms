/* SPARE Master Excel — Export / Import (Group · Equipment · Spare Parts)
 * Filename: {vessel}_spare_master_{deck|engine}_{YYYYMMDD}_{seq}.xlsx
 * Group/Equipment header columns match PMS Master (Jobs/Parts ref name differs).
 * Schema is identical across Engine · Master · HQ (ENGINE) and Deck · Master · HQ (DECK).
 */
const TVC_SpareMasterExcel = (function () {
    const NAVY = 'FF1A365D';
    const GREEN = 'FF217346';
    const HDR_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
    const CELL_ALIGN = { vertical: 'top', horizontal: 'left', wrapText: false };
    const TEXT_FMT = '@';
    const REQUIRED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    const REQUIRED_HDR_FONT = { bold: true, color: { argb: 'FF1A365D' } };
    const TEMPLATE_ROWS = 3;
    /** Import 필수 입력 열 (1-based) */
    const REQ_GROUP_COLS = [1, 2, 3];
    const REQ_EQUIP_COLS = [1, 2, 3, 4, 5];
    const REQ_SPARE_COLS = [1, 2, 3, 6, 10];
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

    function listSpareGenEngineLabels(spareGroups, groupNodes, dept) {
        const labels = new Set();
        (groupNodes || []).forEach(n => {
            if (dept && n.department !== dept) return;
            if (!isSpareGenEngineGroup(n.label)) return;
            if (norm(n.label) === norm(SPARE_GEN_ENGINE_LABEL)) return;
            labels.add(n.label);
        });
        (spareGroups || []).forEach(g => {
            if (g.item_sort1) return;
            if (dept && g.department !== dept) return;
            if (!isSpareGenEngineGroup(g.label)) return;
            if (norm(g.label) === norm(SPARE_GEN_ENGINE_LABEL)) return;
            labels.add(g.label);
        });
        return [...labels];
    }

    async function upsertSpareGroupDef(row, itemSort1, ctx = {}) {
        const vesselId = ctx.vesselId;
        if (isSpareGenEngineMasterRow(row.groupNo, row.groupName)) {
            const labels = listSpareGenEngineLabels(ctx.spareGroups, ctx.groupNodes, row.department);
            if (labels.length) {
                for (const lab of labels) {
                    await upsertGroupDef({ ...row, label: lab }, itemSort1 || null, vesselId);
                }
                return;
            }
        }
        await upsertGroupDef(row, itemSort1 || null, vesselId);
    }

    function sameVessel(row, vesselId) {
        if (typeof TVC_MasterVesselScope !== 'undefined') {
            return TVC_MasterVesselScope.belongs(row, vesselId);
        }
        return !row?.vessel_id || row.vessel_id === vesselId;
    }

    async function resolveSpareVesselId(user, opts = {}) {
        if (typeof TVC_MasterVesselScope !== 'undefined') {
            return TVC_MasterVesselScope.resolve(user, {
                vesselId: opts.vesselId,
                selectedVesselId: opts.selectedVesselId,
            });
        }
        return opts.vesselId
            || opts.selectedVesselId
            || (typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.getSelectedId() : null)
            || (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null))
            || 'TVC No1';
    }

    const PMS = () => (typeof TVC_PmsMasterExcel !== 'undefined' ? TVC_PmsMasterExcel : null);

    function criticalExportValue(v) {
        const pms = PMS();
        if (pms?.criticalExportValue) return pms.criticalExportValue(v);
        if (v === true) return 'Yes';
        if (v === false) return 'No';
        return '';
    }

    function parseCriticalFromRow(row, h, colFn) {
        const pms = PMS();
        if (pms?.parseCriticalFromRow) return pms.parseCriticalFromRow(row, h, colFn);
        const idx = (colFn && (colFn('CRITICAL EQUIPMENT') || colFn('⚠') || colFn('CRITICAL')))
            || (h && (h['CRITICAL EQUIPMENT'] || h['⚠'] || h['CRITICAL']))
            || 0;
        if (!idx) return null;
        const s = norm(row.getCell(idx).value).toLowerCase();
        if (!s) return null;
        if (s === '⚠' || s === 'y' || s === 'yes' || s === '1' || s === 'true') return true;
        if (s === 'n' || s === 'no' || s === '0' || s === 'false') return false;
        return null;
    }

    function groupDefsCriticalValue(groups, department, no, name) {
        const pms = PMS();
        if (pms?.groupDefsCriticalValue) return pms.groupDefsCriticalValue(groups, department, no, name);
        const rows = (groups || []).filter(g => {
            if (String(g.department || '').toUpperCase() !== String(department || '').toUpperCase()) return false;
            const sg = splitGroupLabel(g.label);
            return padGroupNo(sg.no) === padGroupNo(no) && norm(sg.name).toUpperCase() === norm(name).toUpperCase();
        });
        if (rows.some(g => g.is_critical_equipment === true)) return true;
        const header = rows.find(g => !norm(g.item_sort1));
        if (header?.is_critical_equipment === false) return false;
        return null;
    }

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

    function styleHeaderRow(row, fillArgb, requiredCols = []) {
        const reqSet = new Set(requiredCols);
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            if (reqSet.has(colNumber)) {
                cell.font = REQUIRED_HDR_FONT;
                cell.fill = REQUIRED_FILL;
            } else {
                cell.font = HDR_FONT;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
            }
            cell.numFmt = TEXT_FMT;
            cell.alignment = { ...CELL_ALIGN };
        });
        row.height = 22;
    }

    function markRequiredCell(cell) {
        cell.fill = REQUIRED_FILL;
    }

    function applyRequiredDataFill(ws, cols, dataRowCount) {
        if (!cols.length || dataRowCount <= 0) return;
        for (let i = 0; i < dataRowCount; i++) {
            const row = ws.getRow(DATA_START + i);
            for (const col of cols) markRequiredCell(row.getCell(col));
        }
    }

    function appendRequiredTemplateRows(ws, cols, count = TEMPLATE_ROWS) {
        if (!cols.length || count <= 0) return;
        const base = Math.max(ws.rowCount, DATA_START - 1);
        for (let i = 0; i < count; i++) {
            const row = ws.getRow(base + 1 + i);
            for (const col of cols) {
                const cell = row.getCell(col);
                markRequiredCell(cell);
                cell.numFmt = TEXT_FMT;
                cell.alignment = { ...CELL_ALIGN };
            }
        }
    }

    function addMetaRows(ws, lines, startCol = 1) {
        lines.forEach((text, i) => {
            const cell = ws.getRow(i + 1).getCell(startCol);
            cell.value = String(text);
            cell.numFmt = TEXT_FMT;
            cell.alignment = { ...CELL_ALIGN };
            cell.font = { italic: true, color: { argb: 'FF4A5568' }, size: 10 };
        });
    }

    /** 시트 내 모든 사용 셀 — 텍스트 서식 · 위쪽 · 왼쪽 정렬 */
    function applySheetTextStyle(ws) {
        const maxCol = Math.max(ws.columnCount || 1, 1);
        ws.eachRow({ includeEmpty: true }, row => {
            for (let c = 1; c <= maxCol; c++) {
                const cell = row.getCell(c);
                const v = cell.value;
                if (v instanceof Date) {
                    cell.value = v.toISOString().slice(0, 10);
                } else if (v != null && typeof v === 'object') {
                    if (v.richText) cell.value = v.richText.map(t => t.text).join('');
                    else if (v.result != null && v.formula == null) cell.value = String(v.result);
                    else if (v.text != null) cell.value = String(v.text);
                } else if (v != null && typeof v !== 'string') {
                    cell.value = String(v);
                }
                cell.numFmt = TEXT_FMT;
                cell.alignment = { ...CELL_ALIGN };
            }
        });
        for (let c = 1; c <= maxCol; c++) ws.getColumn(c).numFmt = TEXT_FMT;
    }

    async function downloadBlob(buf, filename) {
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        await TVC_FileExport.save(blob, filename);
    }

    async function masterExcelFilename(vesselId, department, opts = {}) {
        const dept = normDept(department);
        let scope;
        const user = opts.user || null;
        if (user && typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isHqAccount?.(user) && typeof TVC_Filename !== 'undefined') {
            scope = TVC_Filename.hqReplyScopeToken(dept);
        } else if (user && typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub?.(user) && typeof TVC_Filename !== 'undefined') {
            scope = TVC_Filename.masterHubScopeToken(dept);
        } else if (typeof TVC_Filename !== 'undefined') {
            scope = TVC_Filename.scopeToken(dept, false);
        }
        if (typeof TVC_Filename !== 'undefined') {
            return TVC_Filename.build({ vesselId, type: 'spare_master', scope, ext: 'xlsx' });
        }
        const slug = String(vesselId || 'vessel').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'vessel';
        const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        return `${slug}_spare_master_${dept.toLowerCase()}_${dateTag}_001.xlsx`;
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

    function canonSpare(row) {
        return TVC_SpareSchema.fromRow(row);
    }

    function spareNumbering(s) {
        return s.inventoryNumbering || s.makerPartNo || s.part_no || '';
    }

    function groupNoForSpareExport(s, groupNodes) {
        const dept = spareDepartment(s, groupNodes);
        const raw = String(s.group || '').trim() || resolveSpareGroupLabel(s, groupNodes);
        const g = raw ? resolveSpareMasterGroup(dept, raw) : { no: '' };
        if (g.no) return g.no;
        if (typeof TVC_SpareCode !== 'undefined') {
            return TVC_SpareCode.groupNoFromCode(spareNumbering(s));
        }
        return '';
    }

    function simplifiedExportCodes(exportSpares, groupNodes, groups) {
        if (typeof TVC_SpareCode === 'undefined') return null;
        const grpList = groups || [];
        const equipNoFor = (s) => {
            const c = canonSpare(s);
            if (c.equipmentNo > 0) return c.equipmentNo;
            const eqName = String(c.equipment || '').trim();
            if (eqName && grpList.length) {
                const lab = String(c.group || '').trim() || resolveSpareGroupLabel(c, groupNodes);
                const hit = grpList.find(gr => norm(gr.label) === norm(lab)
                    && norm(gr.item_sort1 || '') === norm(eqName));
                const n = parseInt(String(hit?.equipment_no ?? hit?.sort_order ?? ''), 10);
                if (Number.isFinite(n) && n > 0) return n;
            }
            return 0;
        };
        return TVC_SpareCode.assignCodes(exportSpares, {
            groupNoFor: s => groupNoForSpareExport(s, groupNodes),
            equipNoFor,
        });
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
                if (!gm || parseInt(gm[1], 10) !== codeNo) return false;
                if (cat === 'ENGINE' || cat === 'DECK') return n.department === cat;
                return true;
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

    /** SPARE GROUP Tree (spare_groups) — not PMS maintenance_groups / jobs. */
    function collectExportGroupCounts(exportSpares, spareGroups, groupNodes) {
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

        (spareGroups || []).forEach(g => {
            if (g.item_sort1) return;
            if (isSpareGenEngineGroup(g.label) && norm(g.label) !== norm(SPARE_GEN_ENGINE_LABEL)) return;
            ensure(g.department, g.label, 0);
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

    async function loadExportData(department, opts = {}) {
        const dept = normDept(department);
        const [spares, spareGroups, meta] = await Promise.all([
            TVC_DB.getAll('spare_parts'),
            TVC_DB.getAll('spare_groups').catch(() => []),
            TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null),
        ]);
        let vesselId = opts.vesselId || opts.selectedVesselId || meta || 'TVC No1';
        if (!opts.vesselId && !opts.selectedVesselId && typeof TVC_Fleet !== 'undefined') {
            vesselId = TVC_Fleet.getSelectedId() || TVC_Fleet.getSelected()?.name || TVC_Fleet.PILOT_VESSEL_ID || vesselId;
        }
        const vesselSpareGroups = (spareGroups || []).filter(g => sameVessel(g, vesselId));
        const vesselSpares = (spares || []).filter(s => sameVessel(s, vesselId));
        const scopedSpareGroups = vesselSpareGroups.filter(g => String(g.department || '').toUpperCase() === dept);
        const groupNodes = (typeof TVC_SpareIndexes !== 'undefined')
            ? TVC_SpareIndexes.buildSpareGroupTree(scopedSpareGroups, vesselSpares)
            : scopedSpareGroups.filter(g => !g.item_sort1).map(g => ({ label: g.label, department: g.department }));
        const scopedSpares = vesselSpares.map(canonSpare).filter(s => spareDepartment(s, groupNodes) === dept);
        return {
            spares: scopedSpares,
            spareGroups: scopedSpareGroups,
            groups: scopedSpareGroups,
            groupNodes,
            vesselId,
            department: dept,
        };
    }

    async function exportToWorkbook(opts = {}) {
        if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS is not loaded.');
        const department = normDept(opts.department);
        const data = opts.spares
            ? { ...opts, department, spareGroups: opts.spareGroups || opts.groups || [], groups: opts.spareGroups || opts.groups || [] }
            : await loadExportData(department, opts);
        const spareGroups = data.spareGroups || data.groups || [];
        const { groupNodes, vesselId } = data;
        const exportSpares = (opts.spares || data.spares || []).map(canonSpare)
            .filter(s => spareDepartment(s, groupNodes) === department);

        const groupCounts = collectExportGroupCounts(exportSpares, spareGroups, groupNodes);

        const groupRows = [...groupCounts.entries()].map(([k, count]) => {
            const [department, no, ...nameParts] = k.split('|');
            return { department, no, name: nameParts.join('|'), count };
        }).sort((a, b) => {
            if (a.department !== b.department) return a.department.localeCompare(b.department);
            return a.no.localeCompare(b.no, undefined, { numeric: true });
        });

        const groupMeta = buildGroupMetaMap(spareGroups);

        const wb = new ExcelJS.Workbook();
        wb.creator = 'TVC-PMS';

        const wsG = wb.addWorksheet('Group Headers', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
        addMetaRows(wsG, [
            `Vessel: ${vesselId}  ·  SPARE Master — ${department} — Group Headers`,
            'Format shared: Engine · Master · HQ (this DEPARTMENT). Deck uses a separate DECK file.',
            'Live DB snapshot — SPARE GROUP Tree (spare_groups) for this department only. Re-export after UI changes.',
            'CRITICAL EQUIPMENT = Yes / No. Group에 Yes면 해당 그룹이 Critical로 표시됩니다.',
        ]);
        ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'Maker', 'Model/Type', 'Capacity', 'Serial No.', 'Parts (ref)', 'CRITICAL EQUIPMENT'].forEach((h, i) => {
            wsG.getRow(HDR_ROW).getCell(i + 1).value = h;
        });
        styleHeaderRow(wsG.getRow(HDR_ROW), NAVY, REQ_GROUP_COLS);
        groupRows.forEach((gr, idx) => {
            const r = wsG.getRow(DATA_START + idx);
            const meta = pickSpareGroupMeta(groupMeta, spareGroups, gr.department, gr.no, gr.name);
            r.getCell(1).value = gr.department;
            r.getCell(2).value = gr.no;
            r.getCell(3).value = gr.name;
            r.getCell(4).value = meta.maker || meta.machinery_name || '';
            r.getCell(5).value = meta.model_type || '';
            r.getCell(6).value = meta.capacity || '';
            r.getCell(7).value = meta.serial_no || '';
            r.getCell(8).value = String(gr.count ?? 0);
            r.getCell(9).value = criticalExportValue(groupDefsCriticalValue(spareGroups, gr.department, gr.no, gr.name));
        });
        [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(i => { wsG.getColumn(i).width = i === 3 ? 28 : i === 9 ? 18 : 14; });

        const wsE = wb.addWorksheet('Equipment Headers', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
        addMetaRows(wsE, [
            `Vessel: ${vesselId}  ·  Equipment blocks (GG-EE-III middle segment)`,
            'EQ No. = EE in Code (01–99, 필수). 노란색 셀 = Import 필수.',
            'CRITICAL EQUIPMENT = Yes / No (Equipment별).',
        ]);
        ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'EQ NO', 'Equipment', 'Maker', 'Model/Type', 'Capacity', 'Serial No.', 'CRITICAL EQUIPMENT'].forEach((h, i) => {
            wsE.getRow(HDR_ROW).getCell(i + 1).value = h;
        });
        styleHeaderRow(wsE.getRow(HDR_ROW), GREEN, REQ_EQUIP_COLS);
        let eqRow = 0;
        (spareGroups || []).filter(g => norm(g.item_sort1) && String(g.department || '').toUpperCase() === department).forEach(g => {
            const sg = isSpareGenEngineGroup(g.label)
                ? { no: SPARE_GEN_ENGINE_NO, name: SPARE_GEN_ENGINE_NAME }
                : splitGroupLabel(g.label);
            const r = wsE.getRow(DATA_START + eqRow++);
            const eqNo = parseInt(String(g.equipment_no ?? g.sort_order ?? ''), 10);
            r.getCell(1).value = g.department;
            r.getCell(2).value = sg.no;
            r.getCell(3).value = sg.name;
            r.getCell(4).value = Number.isFinite(eqNo) && eqNo > 0 ? String(eqNo).padStart(2, '0') : '';
            r.getCell(5).value = norm(g.item_sort1);
            r.getCell(6).value = g.maker || g.machinery_name || '';
            r.getCell(7).value = g.model_type || '';
            r.getCell(8).value = g.capacity || '';
            r.getCell(9).value = g.serial_no || '';
            r.getCell(10).value = criticalExportValue(g.is_critical_equipment);
        });
        wsE.getColumn(4).width = 10;
        wsE.getColumn(5).width = 22;
        wsE.getColumn(10).width = 18;

        const wsP = wb.addWorksheet('Spare Parts', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
        const simplifyCodes = opts.simplifyCodes !== false;
        const setupExport = !!opts.setupExport;
        const codeMap = simplifyCodes !== false ? simplifiedExportCodes(exportSpares, groupNodes, spareGroups) : null;
        addMetaRows(wsP, [
            `Vessel: ${vesselId}  ·  ${department} — ${exportSpares.length} spare parts`,
            'Format shared: Engine · Master · HQ (this DEPARTMENT). Deck uses a separate DECK file.',
            setupExport
                ? 'Setup template: ROB/Work zeroed · Code = GG-EE-III (e.g. 01-01-001; EE=00 if no Equipment). Match by DEPARTMENT + Code.'
                : 'Code = GG-EE-III (Group-Equipment-Item). Match by DEPARTMENT + Code. Generator Engine → GROUP 03 · GENERATOR ENGINE.',
        ]);
        const pHeaders = ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'EQ NO', 'Equipment', 'Code', 'Class', 'Dwg No.', 'Part No.', 'Items', 'Unit', 'Work', 'Std', 'Rob'];
        pHeaders.forEach((h, i) => { wsP.getRow(HDR_ROW).getCell(i + 1).value = h; });
        styleHeaderRow(wsP.getRow(HDR_ROW), NAVY, REQ_SPARE_COLS);

        exportSpares.forEach((s, idx) => {
            const dept = spareDepartment(s, groupNodes);
            const raw = String(s.group || '').trim() || resolveSpareGroupLabel(s, groupNodes);
            const g = raw ? resolveSpareMasterGroup(dept, raw) : { no: '', name: '' };
            const c = canonSpare(s);
            const eqName = String(c.equipment || '').trim();
            let eqNo = c.equipmentNo > 0 ? c.equipmentNo : 0;
            if (!eqNo && eqName) {
                const hit = (spareGroups || []).find(gr => norm(gr.label) === norm(raw) && norm(gr.item_sort1 || '') === norm(eqName));
                eqNo = parseInt(String(hit?.equipment_no ?? hit?.sort_order ?? ''), 10) || 0;
            }
            const r = wsP.getRow(DATA_START + idx);
            const code = codeMap?.get(s.id) || spareNumbering(s);
            r.getCell(1).value = dept;
            r.getCell(2).value = g.no;
            r.getCell(3).value = g.name;
            r.getCell(4).value = eqNo > 0 ? String(eqNo).padStart(2, '0') : (eqName ? '' : '00');
            r.getCell(5).value = eqName;
            r.getCell(6).value = code;
            r.getCell(7).value = TVC_SpareSchema.normalizePartClass(s.partClass) || '';
            r.getCell(8).value = s.drawingPartNo || '';
            r.getCell(9).value = s.makerPartNo || '';
            r.getCell(10).value = s.name || '';
            r.getCell(11).value = (s.unit || 'EA').toUpperCase();
            r.getCell(12).value = String(setupExport ? 0 : TVC_SpareSchema.intStock(s.workingQty));
            r.getCell(13).value = String(TVC_SpareSchema.intStock(s.standardStock ?? s.minStock));
            r.getCell(14).value = String(setupExport ? 0 : TVC_SpareSchema.intStock(s.currentStock));
        });
        pHeaders.forEach((_, i) => { wsP.getColumn(i + 1).width = [12, 10, 28, 8, 22, 14, 8, 14, 16, 32, 8, 8, 8, 8][i] || 12; });

        applyRequiredDataFill(wsG, REQ_GROUP_COLS, groupRows.length);
        appendRequiredTemplateRows(wsG, REQ_GROUP_COLS);
        applyRequiredDataFill(wsE, REQ_EQUIP_COLS, eqRow);
        appendRequiredTemplateRows(wsE, REQ_EQUIP_COLS);
        applyRequiredDataFill(wsP, REQ_SPARE_COLS, exportSpares.length);
        appendRequiredTemplateRows(wsP, REQ_SPARE_COLS);

        [wsG, wsE, wsP].forEach(applySheetTextStyle);

        return wb;
    }

    async function exportToFile(opts = {}) {
        const department = normDept(opts.department);
        const vesselId = opts.vesselId
            || opts.selectedVesselId
            || (typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.getSelectedId() : null)
            || (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null))
            || 'TVC No1';
        const persist = opts.persistCodes !== false && !opts.setupExport;
        if (opts.simplifyCodes !== false && persist && typeof TVC_SpareCode !== 'undefined') {
            await TVC_SpareCode.renumberVessel(vesselId, { department });
        }
        const wb = await exportToWorkbook({ ...opts, department, vesselId });
        const buf = await wb.xlsx.writeBuffer();
        const filename = await masterExcelFilename(vesselId, department, { user: opts.user });
        await downloadBlob(buf, filename);
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'SPARE_MASTER',
                scope: 'SPARE',
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
                critical: parseCriticalFromRow(row, h),
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
            const item = cellStr(row, h.EQUIPMENT || h['ITEM (SORT-1)'] || h['SORT-1']);
            const eqNoRaw = cellStr(row, h['EQ NO'] || h['EQ NO.'] || h['EQNO']);
            if (!dept || !no || !name || !item) return;
            const eqNo = parseInt(String(eqNoRaw || '').replace(/\D/g, ''), 10);
            if (!Number.isFinite(eqNo) || eqNo < 1 || eqNo > 99) {
                throw new Error(`Equipment Headers row ${n}: EQ NO is required (01–99) for “${item}”.`);
            }
            rows.push({
                department: dept.toUpperCase(),
                groupNo: no,
                groupName: name,
                label: buildGroupLabel(no, name),
                item_sort1: item,
                equipment_no: eqNo,
                critical: parseCriticalFromRow(row, h),
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
            const equipment = cellStr(row, col('EQUIPMENT'));
            const eqNoRaw = cellStr(row, col('EQ NO')) || cellStr(row, col('EQ NO.'));
            const eqNo = parseInt(String(eqNoRaw || '').replace(/\D/g, ''), 10);
            if (!dept && !no && !name && !code && !partNo && !itemName) return;
            const ig = resolveSpareMasterImportGroup(no, name);
            rows.push({
                spare_id: cellStr(row, col('SPARE_ID')),
                department: dept.toUpperCase(),
                groupNo: ig.no,
                groupName: ig.name,
                group: ig.label,
                code,
                equipment,
                equipment_no: Number.isFinite(eqNo) && eqNo >= 0 ? eqNo : null,
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

    function groupDefId(vesselId, dept, label, itemSort1) {
        const v = String(vesselId || '').replace(/[^\w.-]+/g, '_').slice(0, 40);
        const base = `${v}|${dept}|${norm(label)}|${norm(itemSort1 || '')}`;
        return 'sgrp-' + base.replace(/[^\w|.-]/g, '_').slice(0, 100);
    }

    async function upsertGroupDef(row, itemSort1, vesselId) {
        const defs = await TVC_DB.getAll('spare_groups').catch(() => []);
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
            equipment_no: row.equipment_no != null ? row.equipment_no : (hit?.equipment_no ?? null),
            sort_order: hit?.sort_order ?? 0,
            machinery_name: row.maker || hit?.machinery_name || '',
            maker: row.maker || hit?.maker || '',
            model_type: row.model_type || hit?.model_type || '',
            capacity: row.capacity || hit?.capacity || '',
            serial_no: row.serial_no || hit?.serial_no || '',
            is_critical_equipment: row.critical != null ? row.critical : hit?.is_critical_equipment,
            header_edited: true,
            created_at: hit?.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
            sync_status: hit?.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (hit?.sync_status || 'LOCAL'),
        };
        await TVC_DB.put('spare_groups', next);
    }

    function importGroupNoKey(dept, groupNo) {
        const d = String(dept || '').trim().toUpperCase();
        const n = padGroupNo(groupNo);
        return d && n ? `${d}|${n}` : '';
    }

    function collectImportGroupLabels(groupRows, equipRows, spareRows) {
        const byNo = new Map();
        const add = (dept, groupNo, label) => {
            const key = importGroupNoKey(dept, groupNo);
            const lab = String(label || '').trim();
            if (!key || !lab) return;
            if (isSpareGenEngineMasterRow(groupNo, splitGroupLabel(lab).name)) return;
            byNo.set(key, lab);
        };
        groupRows.forEach(g => add(g.department, g.groupNo, g.label));
        equipRows.forEach(e => add(e.department, e.groupNo, e.label));
        spareRows.forEach(s => add(s.department, s.groupNo, s.group));
        return byNo;
    }

    function existingLabelsByGroupNo(spareGroups, spares, vesselId) {
        const byNo = new Map();
        const add = (dept, label) => {
            if (!label) return;
            const resolved = resolveSpareMasterGroup(dept, label);
            if (!resolved.no || isSpareGenEngineGroup(label)) return;
            const key = importGroupNoKey(dept, resolved.no);
            if (!key) return;
            if (!byNo.has(key)) byNo.set(key, new Set());
            byNo.get(key).add(resolved.label || label);
        };
        (spareGroups || []).filter(g => sameVessel(g, vesselId) && !g.item_sort1).forEach(g => add(g.department, g.label));
        (spares || []).filter(s => sameVessel(s, vesselId)).forEach(s => {
            add(String(s.category || 'ENGINE').toUpperCase(), s.group);
        });
        return byNo;
    }

    async function renameGroupLabelInVessel(vesselId, department, oldLabel, newLabel) {
        const oldL = String(oldLabel || '').trim();
        const newL = String(newLabel || '').trim();
        const dept = String(department || '').trim().toUpperCase();
        if (!oldL || !newL || norm(oldL) === norm(newL)) {
            return { groups: 0, spares: 0 };
        }
        const ts = new Date().toISOString();
        const touch = row => ({
            ...row,
            updated_at: ts,
            sync_status: row.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (row.sync_status || 'LOCAL'),
        });
        const [grps, spares] = await Promise.all([
            TVC_DB.getAll('spare_groups').catch(() => []),
            TVC_DB.getAll('spare_parts').catch(() => []),
        ]);
        const gchg = (grps || []).filter(g =>
            sameVessel(g, vesselId)
            && String(g.department || '').toUpperCase() === dept
            && norm(g.label) === norm(oldL)
        ).map(g => touch({ ...g, label: newL }));
        const schg = (spares || []).filter(s =>
            sameVessel(s, vesselId)
            && String(s.category || 'ENGINE').toUpperCase() === dept
            && norm(s.group) === norm(oldL)
        ).map(s => {
            const c = canonSpare(s);
            c.group = newL;
            const row = TVC_SpareSchema.toRow(c);
            row.vessel_id = vesselId;
            return touch(row);
        });
        if (gchg.length) await TVC_DB.bulkPut('spare_groups', gchg);
        if (schg.length) {
            if (typeof TVC_DB.bulkPut === 'function') await TVC_DB.bulkPut('spare_parts', schg);
            else for (const row of schg) await TVC_DB.put('spare_parts', row);
        }
        return { groups: gchg.length, spares: schg.length };
    }

    async function applyImportGroupRenames(opts = {}) {
        const {
            vesselId, department, groupRows, equipRows, spareRows,
            spareGroups, existingSpares,
        } = opts;
        const importLabels = collectImportGroupLabels(groupRows, equipRows, spareRows);
        const existingLabels = existingLabelsByGroupNo(spareGroups, existingSpares, vesselId);
        let renamed = 0;
        let groupDefCount = 0;
        let spareCount = 0;
        for (const [key, newLabel] of importLabels) {
            const [dept] = key.split('|');
            if (dept !== department) continue;
            const olds = existingLabels.get(key) || new Set();
            for (const oldLabel of olds) {
                if (norm(oldLabel) === norm(newLabel)) continue;
                const r = await renameGroupLabelInVessel(vesselId, dept, oldLabel, newLabel);
                if (r.groups || r.spares) renamed++;
                groupDefCount += r.groups;
                spareCount += r.spares;
            }
        }
        return { renamed, groups: groupDefCount, spares: spareCount };
    }

    function findSpareMatch(row, byId, byCode, byPart) {
        if (row.spare_id && byId.has(row.spare_id)) return byId.get(row.spare_id);
        const codeKey = norm(row.code).toLowerCase();
        if (codeKey && byCode.has(codeKey)) return byCode.get(codeKey);
        const partKey = `${row.department}|${norm(row.group)}|${norm(row.partNo).toLowerCase()}`;
        if (row.partNo && byPart.has(partKey)) return byPart.get(partKey);
        return null;
    }

    async function relinkSpareReferencesAfterImport(vesselId) {
        const spares = (await TVC_DB.getAll('spare_parts').catch(() => []))
            .filter(s => sameVessel(s, vesselId));
        const byId = new Map(spares.map(s => [String(s.id), s]));
        const byPart = new Map();
        const byCode = new Map();
        spares.forEach(s => {
            const pno = norm(s.part_no || s.maker_part_no || '').toLowerCase();
            if (pno) byPart.set(pno, s);
            const code = norm(s.inventory_numbering || s.universal_item_code || s.universal_code || '').toLowerCase();
            if (code) byCode.set(code, s);
        });

        function resolveSpareId(line) {
            const sid = String(line?.spare_part_id || '').trim();
            if (sid && byId.has(sid)) return sid;
            const pno = norm(line?.part_no || '').toLowerCase();
            if (pno && byPart.has(pno)) return byPart.get(pno).id;
            const code = norm(line?.universal_code || line?.inventory_numbering || line?.code || '').toLowerCase();
            if (code && byCode.has(code)) return byCode.get(code).id;
            return sid || null;
        }

        function relinkLines(lines) {
            let n = 0;
            (lines || []).forEach(line => {
                const nextId = resolveSpareId(line);
                if (nextId && nextId !== line.spare_part_id) {
                    line.spare_part_id = nextId;
                    n++;
                }
            });
            return n;
        }

        function relinkSpareIdField(currentId) {
            const sid = String(currentId || '').trim();
            if (sid && byId.has(sid)) return sid;
            return null;
        }

        let requisitions = 0;
        let reqLines = 0;
        let consumeLogs = 0;
        let consumeLines = 0;
        let workReports = 0;
        let usedParts = 0;
        let defectCases = 0;
        let defectParts = 0;
        let workPermits = 0;
        let permitParts = 0;
        let jobBom = 0;

        const reqs = (await TVC_DB.getAll('requisitions').catch(() => []))
            .filter(r => sameVessel(r, vesselId));
        for (const req of reqs) {
            const n = relinkLines(req.lines);
            if (n) {
                reqLines += n;
                requisitions++;
                await TVC_DB.put('requisitions', req);
            }
        }

        const logs = (await TVC_DB.getAll('consume_logs').catch(() => []))
            .filter(r => sameVessel(r, vesselId));
        for (const log of logs) {
            const n = relinkLines(log.lines);
            if (n) {
                consumeLines += n;
                consumeLogs++;
                await TVC_DB.put('consume_logs', log);
            }
        }

        const reports = (await TVC_DB.getAll('daily_work_reports').catch(() => []))
            .filter(r => sameVessel(r, vesselId));
        for (const rep of reports) {
            let touched = false;
            (rep.used_parts || []).forEach(part => {
                const nextId = resolveSpareId(part);
                if (nextId && nextId !== part.spare_part_id) {
                    part.spare_part_id = nextId;
                    usedParts++;
                    touched = true;
                }
            });
            (rep.job_items || []).forEach(item => {
                (item.used_parts || []).forEach(part => {
                    const nextId = resolveSpareId(part);
                    if (nextId && nextId !== part.spare_part_id) {
                        part.spare_part_id = nextId;
                        usedParts++;
                        touched = true;
                    }
                });
            });
            if (touched) {
                workReports++;
                await TVC_DB.put('daily_work_reports', rep);
            }
        }

        const defects = (await TVC_DB.getAll('defect_cases').catch(() => []))
            .filter(r => sameVessel(r, vesselId));
        for (const dc of defects) {
            const n = relinkLines(dc.used_parts);
            if (n) {
                defectParts += n;
                defectCases++;
                await TVC_DB.put('defect_cases', dc);
            }
        }

        const permits = (await TVC_DB.getAll('work_permits').catch(() => []))
            .filter(r => sameVessel(r, vesselId));
        for (const wp of permits) {
            const n = relinkLines(wp.estimated_parts);
            if (n) {
                permitParts += n;
                workPermits++;
                await TVC_DB.put('work_permits', wp);
            }
        }

        const boms = await TVC_DB.getAll('job_bom').catch(() => []);
        for (const bom of boms) {
            const nextId = relinkSpareIdField(bom.spare_part_id);
            if (nextId && nextId !== bom.spare_part_id) {
                bom.spare_part_id = nextId;
                jobBom++;
                await TVC_DB.put('job_bom', bom);
            }
        }

        return {
            requisitions, reqLines, consumeLogs, consumeLines, workReports, usedParts,
            defectCases, defectParts, workPermits, permitParts, jobBom,
        };
    }

    /** Excel에 없는 현재 부서 Spare Parts 삭제 (PMS orphan job과 동일) */
    async function removeOrphanSpareParts({ vesselId, department, keptIds, groupNodes }) {
        const kept = keptIds || new Set();
        const all = await TVC_DB.getAll('spare_parts').catch(() => []);
        let removed = 0;
        for (const s of all) {
            if (!sameVessel(s, vesselId)) continue;
            if (spareDepartment(s, groupNodes) !== department) continue;
            if (kept.has(s.id)) continue;
            await TVC_DB.del('spare_parts', s.id);
            removed++;
        }
        return removed;
    }

    async function removeOrphanEquipmentDefs({ vesselId, department, equipRows }) {
        const keep = new Set();
        (equipRows || []).forEach(e => {
            keep.add(`${String(e.department || '').toUpperCase()}|${norm(e.label)}|${norm(e.item_sort1)}`);
            if (isSpareGenEngineMasterRow(e.groupNo, e.groupName)) {
                keep.add(`GEN|${String(e.department || '').toUpperCase()}|${norm(e.item_sort1)}`);
            }
        });
        const defs = await TVC_DB.getAll('spare_groups').catch(() => []);
        let removed = 0;
        for (const g of defs) {
            if (!sameVessel(g, vesselId)) continue;
            if (String(g.department || '').toUpperCase() !== department) continue;
            const item = norm(g.item_sort1);
            if (!item) continue;
            const direct = `${String(g.department || '').toUpperCase()}|${norm(g.label)}|${item}`;
            const genKey = isSpareGenEngineGroup(g.label) ? `GEN|${department}|${item}` : '';
            if (keep.has(direct) || (genKey && keep.has(genKey))) continue;
            if (g.id) {
                await TVC_DB.del('spare_groups', g.id);
                removed++;
            }
        }
        return removed;
    }

    async function pruneOrphanSpareGroups({ vesselId, department, groupRows, remainingSpares, groupNodes }) {
        const keep = new Set();
        (groupRows || []).forEach(g => {
            keep.add(`${String(g.department || '').toUpperCase()}|${norm(g.label)}`);
            if (isSpareGenEngineMasterRow(g.groupNo, g.groupName)) keep.add(`GEN|${department}`);
        });
        (remainingSpares || []).forEach(s => {
            if (spareDepartment(s, groupNodes) !== department) return;
            const lab = String(s.group || '').trim();
            if (lab) keep.add(`${department}|${norm(lab)}`);
        });
        const defs = await TVC_DB.getAll('spare_groups').catch(() => []);
        let removed = 0;
        for (const g of defs) {
            if (!sameVessel(g, vesselId)) continue;
            if (String(g.department || '').toUpperCase() !== department) continue;
            if (norm(g.item_sort1)) continue;
            const key = `${department}|${norm(g.label)}`;
            const genKeep = isSpareGenEngineGroup(g.label) && keep.has(`GEN|${department}`);
            if (keep.has(key) || genKeep) continue;
            if (g.id) {
                await TVC_DB.del('spare_groups', g.id);
                removed++;
            }
        }
        return removed;
    }

    async function importFromWorkbook(wb, user, opts = {}) {
        if (!TVC_RBAC.canMasterExcelAccount?.(user)) {
            throw Object.assign(new Error('SPARE Master Import requires admin, tvc, or pms-21.'), { code: 'PERMISSION_DENIED' });
        }
        const department = normDept(opts.department);
        const vesselId = await resolveSpareVesselId(user, opts);

        const wsG = wb.getWorksheet('Group Headers');
        const wsE = wb.getWorksheet('Equipment Headers');
        const wsP = wb.getWorksheet('Spare Parts');
        if (!wsP) throw new Error('Spare Parts sheet not found.');

        const groupRows = rowsForDepartment(wsG ? parseGroupRows(wsG) : [], department);
        const equipRows = rowsForDepartment(wsE ? parseEquipmentRows(wsE) : [], department);
        const spareRows = rowsForDepartment(parseSpareRows(wsP), department);

        const loaded = await loadExportData(department, { vesselId }).catch(() => ({ groupNodes: [], spareGroups: [], groups: [] }));
        const spareGroupsAll = await TVC_DB.getAll('spare_groups').catch(() => []);
        const importCtx = {
            vesselId,
            spareGroups: (spareGroupsAll || []).filter(g => sameVessel(g, vesselId) && String(g.department || '').toUpperCase() === department),
            groupNodes: loaded.groupNodes || [],
        };
        importCtx.groups = importCtx.spareGroups;

        const allExisting = await TVC_DB.getAll('spare_parts');
        const existing = allExisting.filter(r => sameVessel(r, vesselId));
        let foreignSpareIds = 0;
        for (const row of spareRows) {
            if (!row.spare_id) continue;
            const hit = allExisting.find(s => s.id === row.spare_id);
            if (hit && !sameVessel(hit, vesselId)) foreignSpareIds++;
        }
        const renameStats = await applyImportGroupRenames({
            vesselId,
            department,
            groupRows,
            equipRows,
            spareRows,
            spareGroups: importCtx.spareGroups,
            existingSpares: existing,
        });
        if (renameStats.groups || renameStats.spares) {
            const spareGroups2 = await TVC_DB.getAll('spare_groups').catch(() => []);
            importCtx.spareGroups = (spareGroups2 || []).filter(g => sameVessel(g, vesselId) && String(g.department || '').toUpperCase() === department);
            importCtx.groups = importCtx.spareGroups;
        }

        for (const g of groupRows) await upsertSpareGroupDef(g, null, importCtx);
        for (const e of equipRows) await upsertSpareGroupDef(e, e.item_sort1, importCtx);

        const existingSpares = renameStats.spares
            ? (await TVC_DB.getAll('spare_parts')).filter(r => sameVessel(r, vesselId))
            : existing;
        const byId = new Map(existingSpares.map(r => [r.id, r]));
        const byCode = new Map();
        const byPart = new Map();
        existingSpares.forEach(r => {
            const code = norm(r.inventory_numbering || r.part_no || '').toLowerCase();
            if (code) byCode.set(code, r);
            const dept = String(r.category || 'ENGINE').toUpperCase();
            const grp = norm(r.group);
            const pno = norm(r.part_no).toLowerCase();
            if (pno) byPart.set(`${dept}|${grp}|${pno}`, r);
        });

        let created = 0;
        let updated = 0;
        const keptIds = new Set();
        const importBlockSeq = new Map();

        function resolveImportEquipNo(row) {
            if (row.equipment_no != null && row.equipment_no >= 0 && norm(row.equipment)) return row.equipment_no;
            const eqName = norm(row.equipment);
            if (eqName) {
                const hit = equipRows.find(e => norm(e.label) === norm(row.group)
                    && norm(e.item_sort1 || '') === eqName);
                if (hit?.equipment_no != null && hit.equipment_no > 0) return hit.equipment_no;
            }
            return 0;
        }

        function nextImportCode(groupNo, equipNo) {
            const g = padGroupNo(groupNo);
            const eq = typeof TVC_SpareCode !== 'undefined'
                ? TVC_SpareCode.padEquip(equipNo ?? 0)
                : String(equipNo ?? 0).padStart(2, '0');
            const key = `${g}|${eq}`;
            const n = (importBlockSeq.get(key) || 0) + 1;
            importBlockSeq.set(key, n);
            if (typeof TVC_SpareCode !== 'undefined') return TVC_SpareCode.format(g, equipNo ?? 0, n);
            return `${g}-${eq}-${String(n).padStart(3, '0')}`;
        }

        for (const row of spareRows) {
            row.department = department;
            const equipNo = resolveImportEquipNo(row);
            row.resolved_equip_no = equipNo;
            if (typeof TVC_SpareCode !== 'undefined') {
                if (row.code && row.groupNo) {
                    row.code = TVC_SpareCode.normalizeCode(row.code, row.groupNo, equipNo);
                } else if (!row.code && row.groupNo) {
                    row.code = nextImportCode(row.groupNo, equipNo);
                }
            }
            if (row.spare_id && !byId.has(row.spare_id)) {
                const foreign = (await TVC_DB.getAll('spare_parts')).find(s => s.id === row.spare_id && !sameVessel(s, vesselId));
                if (foreign) row.spare_id = null;
            }
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
                    equipment: row.equipment || '',
                    equipmentNo: equipNo,
                    category: row.department,
                    unit: row.unit,
                    workingQty: row.work,
                    standardStock: row.std,
                    minStock: row.std,
                    currentStock: row.rob,
                    sync_status: 'LOCAL',
                    updated_at: now,
                });
                spare.vessel_id = vesselId;
                if (row.code && !spare.universal_item_code) {
                    spare.universal_item_code = TVC_SpareSchema.generateUniversalItemCode(row.code);
                    spare.universal_code = spare.universal_item_code;
                }
                created++;
            } else {
                const canon = canonSpare(spare);
                if (row.group) canon.group = row.group;
                if (row.equipment !== undefined) canon.equipment = row.equipment;
                if (row.resolved_equip_no != null) canon.equipmentNo = row.resolved_equip_no;
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
                spare.vessel_id = vesselId;
                updated++;
            }
            await TVC_DB.put('spare_parts', spare);
            keptIds.add(spare.id);
            byId.set(spare.id, spare);
            const codeKey = norm(spare.inventory_numbering || spare.part_no || '').toLowerCase();
            if (codeKey) byCode.set(codeKey, spare);
            const partKey = `${row.department}|${norm(row.group)}|${norm(spare.part_no).toLowerCase()}`;
            if (spare.part_no) byPart.set(partKey, spare);
        }

        const removedParts = await removeOrphanSpareParts({
            vesselId, department, keptIds, groupNodes: importCtx.groupNodes,
        });
        const removedEquipment = await removeOrphanEquipmentDefs({ vesselId, department, equipRows });
        const remainingSpares = (await TVC_DB.getAll('spare_parts').catch(() => []))
            .filter(s => sameVessel(s, vesselId) && spareDepartment(s, importCtx.groupNodes) === department);
        const removedGroups = await pruneOrphanSpareGroups({
            vesselId,
            department,
            groupRows,
            remainingSpares,
            groupNodes: importCtx.groupNodes,
        });

        let renumbered = null;
        if (opts.simplifyCodes !== false && typeof TVC_SpareCode !== 'undefined') {
            renumbered = await TVC_SpareCode.renumberVessel(vesselId, {
                department,
                groupNoFor: (s) => {
                    const raw = String(s.group || '').trim();
                    const ig = resolveSpareMasterGroup(department, raw);
                    return ig.no || TVC_SpareCode.groupNoFromCode(TVC_SpareCode.spareCodeOf(s));
                },
                equipNoFor: (s) => {
                    const c = canonSpare(s);
                    if (c.equipmentNo > 0) return c.equipmentNo;
                    if (c.equipment) {
                        const hit = equipRows.find(e => norm(e.label) === norm(c.group)
                            && norm(e.item_sort1 || '') === norm(c.equipment));
                        if (hit?.equipment_no > 0) return hit.equipment_no;
                    }
                    return 0;
                },
            });
        }

        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📥 [SPARE Master Import] ${vesselId} parts +${created} ~${updated} -${removedParts} — ${user.display_name}`,
            sync_status: 'LOCAL',
        });

        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'IMPORT',
                direction: 'SPARE_MASTER',
                scope: 'SPARE',
                vessel_id: vesselId,
            });
        }

        const relinked = await relinkSpareReferencesAfterImport(vesselId);

        return {
            created, updated,
            removed: removedParts,
            removedEquipment,
            removedGroups,
            groups: groupRows.length,
            equipment: equipRows.length,
            parts: spareRows.length,
            vessel_id: vesselId,
            codesRenumbered: renumbered?.updated ?? 0,
            groupRenamed: renameStats.renamed,
            groupRenameGroups: renameStats.groups,
            groupRenameSpares: renameStats.spares,
            relinkedRequisitions: relinked.requisitions,
            relinkedReqLines: relinked.reqLines,
            relinkedConsumeLogs: relinked.consumeLogs,
            relinkedConsumeLines: relinked.consumeLines,
            relinkedWorkReports: relinked.workReports,
            relinkedUsedParts: relinked.usedParts,
            relinkedDefectCases: relinked.defectCases,
            relinkedDefectParts: relinked.defectParts,
            relinkedWorkPermits: relinked.workPermits,
            relinkedPermitParts: relinked.permitParts,
            relinkedJobBom: relinked.jobBom,
            foreignSpareIds,
        };
    }

    async function importFromFile(file, user, opts = {}) {
        if (!file) throw new Error('No file selected.');
        if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS is not loaded.');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        return importFromWorkbook(wb, user, opts);
    }

    async function exportSetupTemplate(opts = {}) {
        return exportToFile({ ...opts, setupExport: true, simplifyCodes: true });
    }

    return {
        exportToFile,
        exportSetupTemplate,
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
