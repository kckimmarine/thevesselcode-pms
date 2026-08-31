/* PMS Master Excel — Export / Import (Group · Equipment · Jobs)
 * Department-scoped schema is identical across Engine · Master · HQ (ENGINE file)
 * and Deck · Master · HQ (DECK file). Do not add SKU-specific columns.
 */
const TVC_PmsMasterExcel = (function () {
    const IMPORT_BUILD_ID = '20260821-crit-equip';
    /** Import 중 daily_work_reports 1회 스캔 캐시 (job마다 getAll 금지) */
    let _importWrIndex = null;
    const NAVY = 'FF1A365D';
    const GREEN = 'FF217346';
    const HDR_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
    const CELL_ALIGN = { vertical: 'top', horizontal: 'left', wrapText: false };
    const TEXT_FMT = '@';
    const REQUIRED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    const REQUIRED_HDR_FONT = { bold: true, color: { argb: 'FF1A365D' } };
    const TEMPLATE_ROWS = 3;
    /** Import 필수 입력 열 (1-based) */
    const REQ_GROUP_COLS = [1, 2, 3, 8];
    const REQ_EQUIP_COLS = [1, 2, 3, 4, 5];
    const REQ_JOB_COLS = [1, 2, 3, 6, 9, 10, 11];
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
    const LEGACY_DECK_GROUP_NOS = new Set(DECK_LEGACY_CATALOG.map(c => c.legacy));

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
        return (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null)) || 'TVC No1';
    }

    function sameVessel(row, vesselId) {
        if (typeof TVC_MasterVesselScope !== 'undefined') {
            const vid = TVC_MasterVesselScope.normId(vesselId);
            if (!vid) return false;
            const rowVid = TVC_MasterVesselScope.normId(row?.vessel_id);
            // 미태깅 legacy 행은 현재 선박 Import 대상으로 포함 (갱신 시 vessel_id stamp)
            if (!rowVid) return true;
            return rowVid === vid;
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

    /** 예전 DECK catalog 번호(26·28·29~36) — 신규 01~10 체계로 대체됨 */
    function usesLegacyDeckGroupNumber(label) {
        const leg = legacyGroupNum(label);
        return leg != null && LEGACY_DECK_GROUP_NOS.has(leg);
    }

    /** 예전 DECK 그룹 번호 maintenance_groups 정의 제거(장비 헤더는 catalog 라벨로 갱신) */
    async function purgeLegacyDeckGroupDefs(vesselId) {
        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        let pruned = 0;
        let renamed = 0;
        for (const g of defs) {
            if (String(g.department || '').toUpperCase() !== 'DECK') continue;
            if (vesselId && !sameVessel(g, vesselId)) continue;
            if (!usesLegacyDeckGroupNumber(g.label)) continue;
            const resolved = resolveGroup('DECK', g.label);
            if (norm(g.label) === norm(resolved.label)) continue;
            if (norm(g.item_sort1)) {
                g.label = resolved.label;
                g.updated_at = new Date().toISOString();
                await TVC_DB.put('maintenance_groups', g);
                renamed++;
                continue;
            }
            if (g.id) {
                await TVC_DB.del('maintenance_groups', g.id);
                pruned++;
            }
        }
        return { pruned, renamed };
    }

    /** Remove group-level defs (no item_sort1) with no jobs referencing them.
     *  keepGroupKeys: Import Group Headers에 남은 빈 그룹은 유지 (예: 38. E7 job 전부 삭제) */
    async function pruneEmptyGroupDefs(allJobs, vesselId, keepGroupKeys = null) {
        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        const used = new Set(
            (allJobs || [])
                .filter(j => !isDetachedJobCode(j.job_code))
                .map(j => `${j.department}|${norm(j.group)}`)
        );
        let pruned = 0;
        for (const g of defs) {
            if (vesselId && !sameVessel(g, vesselId)) continue;
            if (norm(g.item_sort1)) continue;
            const key = `${g.department}|${norm(g.label)}`;
            if (keepGroupKeys && keepGroupKeys.has(key)) continue;
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

    function criticalExportValue(v) {
        if (v === true) return 'Yes';
        if (v === false) return 'No';
        return '';
    }

    function criticalColIndex(h, colFn) {
        if (colFn) {
            const fromFn = colFn('CRITICAL EQUIPMENT') || colFn('⚠') || colFn('CRITICAL');
            if (fromFn) return fromFn;
        }
        return h['CRITICAL EQUIPMENT'] || h['⚠'] || h['CRITICAL'] || 0;
    }

    function parseCriticalFromRow(row, h, colFn) {
        const idx = criticalColIndex(h, colFn);
        if (!idx) return null;
        return parseCriticalCell(row.getCell(idx).value);
    }

    function groupDefsCriticalValue(groups, department, no, name) {
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

    function importGroupKey(department, group) {
        return `${department || ''}|${String(group || '').trim()}`;
    }

    /** Run-hour 저장소 조회 — 그룹 라벨 공백/포맷 차이 허용 (01. MAIN ENGINE vs 01.        MAIN ENGINE) */
    function findImportRunHourRecord(department, group) {
        if (typeof TVC_PMS === 'undefined') return null;
        const store = TVC_PMS.readStore();
        const tryKeys = [
            importGroupKey(department, group),
            importGroupKey(department, splitGroupLabel(group).label),
        ];
        for (const key of tryKeys) {
            const rec = store[key];
            if (rec && Number(rec.expectedNextMonth) > 0) return rec;
        }
        if (TVC_PMS.isTrackedGroup(group)) {
            const pfx = TVC_PMS.groupPrefix(group);
            if (pfx) {
                const deptPrefix = `${department || ''}|`;
                for (const [key, rec] of Object.entries(store)) {
                    if (!key.startsWith(deptPrefix)) continue;
                    const gPart = key.slice(deptPrefix.length);
                    if (TVC_PMS.groupPrefix(gPart) === pfx && Number(rec.expectedNextMonth) > 0) return rec;
                }
            }
        }
        return TVC_PMS.getRecord(importGroupKey(department, group));
    }

    /** H 주기 + Run-hour 모달 Estimated Run Hours Next month 기준 NEXT DATE (LAST DONE부터) */
    function calcImportRunHourNextDate(lastDone, period, expectedNextMonth) {
        const expected = Number(expectedNextMonth) || 0;
        const p = Number(period) || 0;
        if (!lastDone || p <= 0 || expected <= 0) return null;
        if (typeof TVC_PMS !== 'undefined' && TVC_PMS.addMonths) {
            return TVC_PMS.addMonths(lastDone, p / expected);
        }
        const d = new Date(lastDone);
        if (isNaN(d.getTime())) return null;
        d.setDate(d.getDate() + Math.round((p / expected) * 30.44));
        return d.toISOString().slice(0, 10);
    }

    /** Import — LAST DONE 있으면 PERIOD/UNIT 기준 NEXT DATE 항상 재계산 (NEXT DATE 열 없음) */
    function resolveImportSchedule(row, period, unit, warnings) {
        const lastDone = row.last_done || null;
        let nextDate = null;
        let runHourMeta = null;
        const unitU = String(unit || 'M').toUpperCase();

        if (lastDone && unitU === 'H' && typeof TVC_PMS !== 'undefined') {
            const group = row.group || '';
            if (TVC_PMS.isRunHourJob({ unit: 'H' }) && TVC_PMS.isTrackedGroup(group)) {
                const rec = findImportRunHourRecord(row.department, group);
                const expected = Number(rec?.expectedNextMonth) || 0;
                if (expected > 0) {
                    nextDate = calcImportRunHourNextDate(lastDone, period, expected);
                    runHourMeta = { expected, schedule_basis: 'RUN_HOUR' };
                } else if (Array.isArray(warnings)) {
                    const label = String(group).trim() || importGroupKey(row.department, group);
                    warnings.push(`Run-hour group "${label}": Estimated Run Hours Next month is empty — H-period NEXT DATE uses the default formula.`);
                }
            }
        }

        if (lastDone && !nextDate) {
            nextDate = calcNextDate({ period, unit: unitU }, lastDone);
        } else if (!lastDone && row.next_date) {
            nextDate = row.next_date;
        }
        return { lastDone, nextDate, runHourMeta };
    }

    function applyImportScheduleToJob(job, lastDone, nextDate, protectedSched = false, runHourMeta = null) {
        if (protectedSched) return;
        if (lastDone) job.last_done = lastDone;
        if (!nextDate) return;
        job.next_date = nextDate;
        if (!job.original_next_date) job.original_next_date = nextDate;
        const overdue = new Date(nextDate) < new Date(new Date().toDateString());
        job.is_overdue = overdue;
        if (job.schedule_basis !== 'POSTPONE') {
            job.plan_status = overdue ? 'OVERDUE' : 'PLANNED';
        }
        if (runHourMeta) {
            job.run_hours_expected = runHourMeta.expected;
            job.schedule_basis = runHourMeta.schedule_basis;
        }
    }

    function cellStr(row, col) {
        if (!col) return '';
        const v = row.getCell(col).value;
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object' && v.text != null) return norm(v.text);
        return norm(v);
    }

    /** JOB CODE — Excel date/number mangling 방지 */
    function parseJobCodeCell(v) {
        if (v == null || v === '') return '';
        if (v instanceof Date) return '';
        if (typeof v === 'object' && v.text != null) return norm(v.text);
        return norm(v);
    }

    function parseEquipNoCell(v) {
        const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.min(99, n);
    }

    /** JOB CODE — GG-EE-III (01-00-001). Legacy 01-001 → EE=00 */
    function parsePmsJobCode(code) {
        if (typeof TVC_SpareCode !== 'undefined' && TVC_SpareCode.parse) {
            return TVC_SpareCode.parse(code);
        }
        const s = String(code || '').trim();
        let m = s.match(/^(\d{2})-(\d{2})-(\d{3})$/);
        if (m) return { groupNo: m[1], equipNo: parseInt(m[2], 10), itemNo: parseInt(m[3], 10), valid: true, standard: true };
        m = s.match(/^(\d{1,2})-(\d{1,3})-(\d{1,3})$/);
        if (m) {
            return {
                groupNo: padGroupNo(m[1]),
                equipNo: parseInt(m[2], 10) || 0,
                itemNo: parseInt(m[3], 10) || 0,
                valid: true,
                standard: false,
            };
        }
        m = s.match(/^(\d{1,2})-(\d{1,3})$/);
        if (m) {
            return {
                groupNo: padGroupNo(m[1]),
                equipNo: 0,
                itemNo: parseInt(m[2], 10) || 0,
                valid: true,
                standard: false,
                legacy: true,
            };
        }
        return { groupNo: '', equipNo: 0, itemNo: 0, valid: false };
    }

    function formatPmsJobCode(groupNo, equipNo, itemNo) {
        const g = padGroupNo(groupNo);
        if (!g) return '';
        const ee = String(Math.min(99, Math.max(0, parseInt(equipNo, 10) || 0))).padStart(2, '0');
        const iii = String(Math.min(999, Math.max(1, parseInt(itemNo, 10) || 1))).padStart(3, '0');
        return `${g}-${ee}-${iii}`;
    }

    function canonicalPmsJobCode(code, groupNo, equipNo) {
        const p = parsePmsJobCode(code);
        if (!p.valid) return String(code || '').trim();
        const g = groupNo || p.groupNo;
        const e = (equipNo != null && equipNo !== '') ? parseEquipNoCell(equipNo) : p.equipNo;
        return formatPmsJobCode(g, e, p.itemNo);
    }

    function jobCodeAliases(code) {
        const raw = String(code || '').trim();
        const p = parsePmsJobCode(raw);
        if (!p.valid) return raw ? [raw] : [];
        const std = formatPmsJobCode(p.groupNo, p.equipNo, p.itemNo);
        const aliases = [raw, std];
        if (p.equipNo === 0) aliases.push(`${p.groupNo}-${String(p.itemNo).padStart(3, '0')}`);
        return [...new Set(aliases.filter(Boolean))];
    }

    function jobCodesEqual(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        const setA = new Set(jobCodeAliases(a));
        return jobCodeAliases(b).some(x => setA.has(x));
    }

    function jobCodePatternOk(code) {
        return parsePmsJobCode(code).valid;
    }

    function resolveJobEquipNo(job, groups) {
        const n = parseEquipNoCell(job?.equipment_no);
        if (n > 0) return n;
        const eqName = norm(job?.equipment);
        if (!eqName || !groups?.length) return 0;
        const g = resolveGroup(job.department, job.group);
        const hit = groups.find(gr =>
            String(gr.department || '').toUpperCase() === String(job.department || '').toUpperCase()
            && splitGroupLabel(gr.label).no === g.no
            && norm(gr.item_sort1) === eqName
        );
        return parseEquipNoCell(hit?.equipment_no);
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

    /** 신규 행 추가용 빈 템플릿 — Import 시 완전 빈 행은 무시됨 */
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
        ws.eachRow({ includeEmpty: false }, row => {
            row.eachCell({ includeEmpty: false }, cell => {
                const v = cell.value;
                if (v instanceof Date) {
                    cell.value = v.toISOString().slice(0, 10);
                } else if (v != null && typeof v === 'object') {
                    if (v.richText) cell.value = v.richText.map(t => t.text).join('');
                    else if (v.result != null && v.formula == null) cell.value = String(v.result);
                } else if (v != null && typeof v !== 'string') {
                    cell.value = String(v);
                }
                cell.numFmt = TEXT_FMT;
                cell.alignment = { ...CELL_ALIGN };
            });
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
                const eqNo = parseEquipNoCell(j.equipment_no);
                deckOut.push({ ...j, job_code: formatPmsJobCode(g.no, eqNo, i + 1) });
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
                row.job_code = formatPmsJobCode(row.groupNo, row.equipment_no || 0, i + 1);
            });
        }
        return jobRows;
    }

    function applyJobEquipmentFromHeaders(jobRows, equipRows) {
        const byName = new Map();
        const byNo = new Map();
        for (const e of equipRows || []) {
            byName.set(`${e.department}|${e.groupNo}|${norm(e.item_sort1).toUpperCase()}`, e.equipment_no || 0);
            if (e.equipment_no > 0) {
                byNo.set(`${e.department}|${e.groupNo}|${e.equipment_no}`, e.item_sort1);
            }
        }
        for (const row of jobRows || []) {
            if (!row.equipment_no && row.equipment) {
                const n = byName.get(`${row.department}|${row.groupNo}|${norm(row.equipment).toUpperCase()}`);
                if (n > 0) row.equipment_no = n;
            }
            if (row.equipment_no && !norm(row.equipment)) {
                const name = byNo.get(`${row.department}|${row.groupNo}|${row.equipment_no}`);
                if (name) row.equipment = name;
            }
            if (jobCodePatternOk(row.job_code)) {
                const next = canonicalPmsJobCode(row.job_code, row.groupNo, row.equipment_no || 0);
                if (next !== row.job_code) {
                    if (!row._legacyJobCode) row._legacyJobCode = row.job_code;
                    row.job_code = next;
                }
            }
        }
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
        let vesselId = opts.vesselId || meta || 'TVC No1';
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
        if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS is not loaded.');
        const department = normDept(opts.department);
        const loaded = opts.jobs ? opts : await loadExportData(department, opts);
        const { jobs, groups, vesselId } = loaded;
        const exportJobs = (opts.jobs || jobs)
            .filter(j => String(j.department || '').toUpperCase() === department)
            .filter(j => !isDetachedJobCode(j.job_code));

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
            'Format shared: Engine · Master · HQ (this DEPARTMENT). Deck uses a separate DECK file.',
            'Live DB snapshot — PMS GROUP Tree (maintenance_groups + maintenance_jobs) for this department only.',
            'CRITICAL EQUIPMENT = Yes / No. Group에 Yes면 해당 그룹 job이 Critical로 집계됩니다.',
        ]);
        ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'Maker', 'Model/Type', 'Capacity', 'Serial No.', 'Jobs (ref)', 'CRITICAL EQUIPMENT'].forEach((h, i) => {
            wsG.getRow(HDR_ROW).getCell(i + 1).value = h;
        });
        styleHeaderRow(wsG.getRow(HDR_ROW), NAVY, REQ_GROUP_COLS);
        groupRows.forEach((gr, idx) => {
            const r = wsG.getRow(DATA_START + idx);
            const meta = groupMeta.get(`${gr.department}|${gr.no}|${gr.name}`) || {};
            r.getCell(1).value = gr.department;
            r.getCell(2).value = gr.no;
            r.getCell(3).value = gr.name;
            r.getCell(4).value = meta.maker || meta.machinery_name || '';
            r.getCell(5).value = meta.model_type || '';
            r.getCell(6).value = meta.capacity || '';
            r.getCell(7).value = meta.serial_no || '';
            r.getCell(8).value = gr.count;
            r.getCell(9).value = criticalExportValue(groupDefsCriticalValue(groups, gr.department, gr.no, gr.name));
        });
        [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(i => { wsG.getColumn(i).width = i === 3 ? 28 : i === 9 ? 18 : 14; });

        const wsE = wb.addWorksheet('Equipment Headers', { views: [{ state: 'frozen', ySplit: DATA_START - 1 }] });
        addMetaRows(wsE, [
            `Vessel: ${vesselId}  ·  Equipment blocks (GG-EE-III 중 EE)`,
            'EQ NO = EE (01–99, 필수). Jobs 시트 EQ NO · Equipment와 같아야 해당 Equipment로 분류됩니다.',
            'CRITICAL EQUIPMENT = Yes / No (Equipment별).',
        ]);
        ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'EQ NO', 'Equipment', 'Maker', 'Model/Type', 'Capacity', 'Serial No.', 'CRITICAL EQUIPMENT'].forEach((h, i) => {
            wsE.getRow(HDR_ROW).getCell(i + 1).value = h;
        });
        styleHeaderRow(wsE.getRow(HDR_ROW), GREEN, REQ_EQUIP_COLS);
        let eqRow = 0;
        (groups || []).filter(g => norm(g.item_sort1)).forEach(g => {
            const sg = splitGroupLabel(g.label);
            const r = wsE.getRow(DATA_START + eqRow++);
            const eqNo = parseEquipNoCell(g.equipment_no);
            r.getCell(1).value = g.department;
            r.getCell(2).value = sg.no;
            r.getCell(3).value = sg.name;
            r.getCell(4).value = eqNo > 0 ? String(eqNo).padStart(2, '0') : '';
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

        const wsJ = wb.addWorksheet('Jobs', { views: [{ state: 'frozen', ySplit: DATA_START - 1 }] });
        addMetaRows(wsJ, [
            `Vessel: ${vesselId}  ·  ${department} — ${exportJobs.length} jobs`,
            'JOB CODE = GG-EE-III (예: 01-00-001). EE 미지정 = 00. Match by DEPARTMENT + JOB CODE. 시트에서 뺀 행은 삭제(Work Report 연결은 임시 CODE).',
            'EQ NO / Equipment: Equipment Headers와 동일하게 입력. 노란색 셀 = Import 필수.',
            'CRITICAL EQUIPMENT = Yes / No (Job별). 비우면 Group / Equipment 설정을 따릅니다.',
        ]);
        const jHeaders = ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'EQ NO', 'Equipment', 'JOB CODE', 'SORT-1', 'SORT-2', 'JOB DETAIL', 'PERIOD', 'UNIT', 'P.I.C', 'LAST DONE', 'CRITICAL EQUIPMENT'];
        jHeaders.forEach((h, i) => { wsJ.getRow(HDR_ROW).getCell(i + 1).value = h; });
        styleHeaderRow(wsJ.getRow(HDR_ROW), NAVY, REQ_JOB_COLS);
        wsJ.getColumn(4).width = 10;
        wsJ.getColumn(5).width = 22;
        wsJ.getColumn(6).width = 14;
        wsJ.getColumn(14).width = 18;

        exportJobs.forEach((j, idx) => {
            const g = resolveGroup(j.department, j.group);
            const eqNo = resolveJobEquipNo(j, groups);
            const parsed = parsePmsJobCode(j.job_code);
            const jobCode = parsed.valid
                ? formatPmsJobCode(parsed.groupNo || g.no, eqNo, parsed.itemNo)
                : formatPmsJobCode(g.no, eqNo, idx + 1);
            const r = wsJ.getRow(DATA_START + idx);
            r.getCell(1).value = j.department || '';
            r.getCell(2).value = g.no;
            r.getCell(3).value = g.name;
            r.getCell(4).value = eqNo > 0 ? String(eqNo).padStart(2, '0') : '';
            r.getCell(5).value = norm(j.equipment);
            r.getCell(6).value = jobCode;
            r.getCell(7).value = norm(j.item_sort1);
            r.getCell(8).value = norm(j.item_sort2);
            r.getCell(9).value = j.job_detail || '';
            r.getCell(10).value = j.period != null ? String(j.period) : '';
            r.getCell(11).value = (j.unit || 'M').toUpperCase();
            r.getCell(12).value = j.pic || '';
            if (j.last_done) r.getCell(13).value = String(j.last_done);
            r.getCell(14).value = criticalExportValue(j.is_critical_equipment);
        });

        applyRequiredDataFill(wsG, REQ_GROUP_COLS, groupRows.length);
        appendRequiredTemplateRows(wsG, REQ_GROUP_COLS);
        applyRequiredDataFill(wsE, REQ_EQUIP_COLS, eqRow);
        appendRequiredTemplateRows(wsE, REQ_EQUIP_COLS);
        applyRequiredDataFill(wsJ, REQ_JOB_COLS, exportJobs.length);
        appendRequiredTemplateRows(wsJ, REQ_JOB_COLS);

        [wsG, wsE, wsJ].forEach(applySheetTextStyle);

        return wb;
    }

    async function exportToFile(opts = {}) {
        const department = normDept(opts.department);
        const vesselId = opts.vesselId
            || opts.selectedVesselId
            || (typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.getSelectedId() : null)
            || (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null))
            || 'TVC No1';
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

    function parseGroupRows(ws, fallbackDept) {
        const h = parseSheetHeaders(ws);
        const fb = String(fallbackDept || '').trim().toUpperCase();
        const rows = [];
        ws.eachRow((row, n) => {
            if (n < DATA_START) return;
            let dept = cellStr(row, h.DEPARTMENT);
            if (!dept && fb) dept = fb;
            const no = padGroupNo(cellStr(row, h['GROUP NO'] || h.GROUP));
            const name = cellStr(row, h['GROUP NAME']);
            if (!dept || !no || !name) return;
            const jobsRefRaw = cellStr(row, h['JOBS (REF)'] || h.JOBS);
            const jobsRef = jobsRefRaw ? parseInt(jobsRefRaw, 10) : null;
            rows.push({
                department: dept.toUpperCase(),
                groupNo: no,
                groupName: name,
                label: buildGroupLabel(no, name),
                jobsRef: Number.isFinite(jobsRef) ? jobsRef : null,
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
            const eqNoRaw = cellStr(row, h['EQ NO'] || h.EQNO || h['EQ. NO']);
            if (!dept || !no || !name || !item) return;
            const equipment_no = parseEquipNoCell(eqNoRaw);
            if (!(equipment_no >= 1 && equipment_no <= 99)) {
                throw new Error(`Equipment Headers row ${n}: EQ NO is required (01–99) for “${item}”.`);
            }
            rows.push({
                department: dept.toUpperCase(),
                groupNo: no,
                groupName: name,
                label: buildGroupLabel(no, name),
                equipment_no,
                item_sort1: item,
                critical: parseCriticalFromRow(row, h),
                maker: cellStr(row, h.MAKER),
                model_type: cellStr(row, h['MODEL/TYPE']),
                capacity: cellStr(row, h.CAPACITY),
                serial_no: cellStr(row, h['SERIAL NO.'] || h['SERIAL NO']),
            });
        });
        return rows;
    }

    function parseJobRows(ws, fallbackDept) {
        const h = parseSheetHeaders(ws);
        const col = key => h[key.toUpperCase()] || h[key];
        const fb = String(fallbackDept || '').trim().toUpperCase();
        const rows = [];
        const skipped = [];
        ws.eachRow((row, n) => {
            if (n < DATA_START) return;
            let dept = cellStr(row, col('DEPARTMENT'));
            if (!dept && fb) dept = fb;
            const jobCodeCol = col('JOB CODE');
            const jobCode = jobCodeCol ? parseJobCodeCell(row.getCell(jobCodeCol).value) : '';
            if (!dept || !jobCode) {
                const hasAny = [dept, jobCode, cellStr(row, col('GROUP NO')), cellStr(row, col('GROUP NAME')), cellStr(row, col('JOB DETAIL'))]
                    .some(v => !!v);
                if (hasAny) skipped.push({ row: n, dept, jobCode });
                return;
            }
            const no = padGroupNo(cellStr(row, col('GROUP NO')));
            const name = cellStr(row, col('GROUP NAME'));
            const jobIdCol = col('JOB_ID');
            rows.push({
                _excelRow: n,
                job_id: jobIdCol ? cellStr(row, jobIdCol) : '',
                department: dept.toUpperCase(),
                groupNo: no,
                groupName: name,
                group: buildGroupLabel(no, name),
                critical: parseCriticalFromRow(row, h, col),
                job_code: jobCode,
                equipment_no: parseEquipNoCell(cellStr(row, col('EQ NO') || col('EQNO') || col('EQ. NO'))),
                equipment: cellStr(row, col('EQUIPMENT')),
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
        rows._skipped = skipped;
        return rows;
    }

    function groupRowKey(row) {
        return `${row.department}|${row.groupNo}|${norm(row.groupName)}`;
    }

    function groupNoFromJobCode(code) {
        const p = parsePmsJobCode(code);
        return p.groupNo || padGroupNo(String(code || '').trim().split('-')[0]);
    }

    function canonicalMetaKey(vesselId, department) {
        if (typeof pmsMasterCanonicalMetaKey !== 'undefined') {
            return pmsMasterCanonicalMetaKey(vesselId, department);
        }
        return `pms_master_group_canonical_${vesselId}_${department}`;
    }

    async function saveCanonicalGroupMap(vesselId, department, groupRows) {
        const byNo = canonicalGroupDisplayMap(groupRows, department);
        if (!byNo.size) return;
        await TVC_DB.setMeta(
            canonicalMetaKey(vesselId, department),
            JSON.stringify(Object.fromEntries(byNo))
        );
    }

    async function loadCanonicalGroupMap(vesselId, department) {
        const raw = await TVC_DB.getMeta(canonicalMetaKey(vesselId, department)).catch(() => null);
        if (!raw) return null;
        try {
            return new Map(
                Object.entries(JSON.parse(raw)).map(([k, v]) => [padGroupNo(k), v])
            );
        } catch (_) {
            return null;
        }
    }

    function canonicalGroupLabelMap(groupRows, department) {
        const map = new Map();
        for (const g of groupRows || []) {
            if (g.department !== department) continue;
            map.set(g.groupNo, norm(g.label));
        }
        return map;
    }

    function canonicalGroupDisplayMap(groupRows, department) {
        const map = new Map();
        for (const g of groupRows || []) {
            if (g.department !== department) continue;
            map.set(g.groupNo, g.label);
        }
        return map;
    }

    /** Jobs 시트 GROUP NO/NAME 불일치 시 Group Headers 라벨로 통일 */
    function applyCanonicalImportGroups(groupRows, jobRows, department) {
        const byNo = canonicalGroupDisplayMap(groupRows, department);
        for (const row of jobRows) {
            if (!row.groupNo && row.job_code) row.groupNo = groupNoFromJobCode(row.job_code);
            if (row.groupNo) row.groupNo = padGroupNo(row.groupNo);
            const canonical = byNo.get(row.groupNo);
            if (canonical) {
                row.group = canonical;
                const sg = splitGroupLabel(canonical);
                if (sg.name) row.groupName = sg.name;
            } else if (row.groupNo && row.groupName) {
                row.group = buildGroupLabel(row.groupNo, row.groupName);
            }
        }
        return jobRows;
    }

    function groupNoFromJob(job) {
        const code = isDetachedJobCode(job?.job_code) ? job?.detached_from_code : job?.job_code;
        return groupNoFromJobCode(code) || splitGroupLabel(job?.group).no;
    }

    /** Group Headers에서 GROUP NO는 같고 NAME만 바뀐 경우 — 구 그룹 job/정의 제거 */
    async function evictUnimportedJob(job) {
        if (await jobHasAnyWorkReport(job.id)) {
            const temp = tempJobCode(job.id);
            if (job.job_code !== temp) {
                if (!job.detached_from_code && jobCodePatternOk(job.job_code)) {
                    job.detached_from_code = job.job_code;
                }
                await cascadeJobCodeRename(job.job_code, temp, job.id, { department: job.department });
                job.job_code = temp;
                job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
                job.updated_at = new Date().toISOString();
                await TVC_DB.put('maintenance_jobs', job);
                return 'detached';
            }
            return null;
        }
        await TVC_DB.del('maintenance_jobs', job.id);
        return 'removed';
    }

    async function removeSupersededGroupJobs(groupRows, jobRows, vesselId, department) {
        const canonicalByNo = canonicalGroupLabelMap(groupRows, department);
        if (!canonicalByNo.size) return { removed: 0, detached: 0 };
        const existingJobs = await TVC_DB.getAll('maintenance_jobs');
        let removed = 0;
        let detached = 0;
        for (const job of existingJobs) {
            if (vesselId && !sameVessel(job, vesselId)) continue;
            if (job.department !== department) continue;
            const gNo = groupNoFromJob(job);
            if (!gNo || !canonicalByNo.has(gNo)) continue;
            if (norm(job.group) === canonicalByNo.get(gNo)) continue;
            if (jobRows.some(row => importRowMatchesJobForOrphan(row, job))) continue;
            const action = await evictUnimportedJob(job);
            if (action === 'removed') removed++;
            else if (action === 'detached') detached++;
        }
        return { removed, detached };
    }

    async function pruneSupersededGroupDefs(groupRows, vesselId, department) {
        const canonicalByNo = canonicalGroupLabelMap(groupRows, department);
        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        let pruned = 0;
        for (const g of defs) {
            if (vesselId && !sameVessel(g, vesselId)) continue;
            if (g.department !== department) continue;
            const sg = splitGroupLabel(g.label);
            if (!sg.no || !canonicalByNo.has(sg.no)) continue;
            if (norm(g.label) === canonicalByNo.get(sg.no)) continue;
            if (g.id) {
                await TVC_DB.del('maintenance_groups', g.id);
                pruned++;
            }
        }
        return pruned;
    }

    /** Import 직후 동일 JOB CODE 중복(Work Report 없는 stub) 제거 — detached 우선 복원 후 */
    async function dedupeImportJobCodeStubs(vesselId, department, keepIds) {
        const jobs = (await TVC_DB.getAll('maintenance_jobs')).filter(j =>
            sameVessel(j, vesselId) && j.department === department
        );
        const byCode = new Map();
        for (const j of jobs) {
            if (!j.job_code || isDetachedJobCode(j.job_code)) continue;
            if (!byCode.has(j.job_code)) byCode.set(j.job_code, []);
            byCode.get(j.job_code).push(j);
        }
        let removed = 0;
        for (const list of byCode.values()) {
            if (list.length <= 1) continue;
            const keep = list.find(j => keepIds.has(j.id))
                || list.find(j => j.master_import_at)
                || list[0];
            for (const j of list) {
                if (j.id === keep.id) continue;
                if (await jobHasAnyWorkReport(j.id)) continue;
                await TVC_DB.del('maintenance_jobs', j.id);
                removed++;
            }
        }
        return removed;
    }

    /** 동일 JOB CODE · 구 그룹명 stub 제거 (MOORING→SCRUBBER 전환 후 잔존) */
    async function removeStaleJobCodeStubs(jobRows, vesselId, department, keepIds) {
        let removed = 0;
        const jobs = await TVC_DB.getAll('maintenance_jobs');
        for (const row of jobRows) {
            const targetGroup = norm(row.group);
            for (const j of jobs) {
                if (!sameVessel(j, vesselId) || j.department !== department) continue;
                if (j.job_code !== row.job_code || keepIds.has(j.id)) continue;
                if (isDetachedJobCode(j.job_code)) continue;
                if (norm(j.group) === targetGroup) continue;
                if (await jobHasAnyWorkReport(j.id)) continue;
                await TVC_DB.del('maintenance_jobs', j.id);
                removed++;
            }
        }
        return removed;
    }

    /** Import loop 이후 — Excel Group Headers 기준으로 job.group 재정렬 (29 SCRUBBER→ECR LAPTOP 등) */
    async function reconcileJobsToCanonicalGroups(groupRows, vesselId, department, touchedJobIds) {
        const byNo = canonicalGroupDisplayMap(groupRows, department);
        if (!byNo.size || !touchedJobIds?.size) return 0;
        let updated = 0;
        const jobs = await TVC_DB.getAll('maintenance_jobs');
        for (const job of jobs) {
            if (!sameVessel(job, vesselId) || job.department !== department) continue;
            if (!touchedJobIds.has(job.id)) continue;
            const gNo = groupNoFromJob(job);
            if (!gNo || !byNo.has(gNo)) continue;
            const canonical = byNo.get(gNo);
            if (norm(job.group) === norm(canonical)) continue;
            job.group = canonical;
            job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
            job.updated_at = new Date().toISOString();
            await TVC_DB.put('maintenance_jobs', job);
            updated++;
        }
        return updated;
    }

    /** Master Import — JOB CODE 접두 그룹번호 기준 job.group 일괄 정렬 (29 SCRUBBER→ECR LAPTOP) */
    async function rehomeAllJobsByGroupNumber(groupRows, vesselId, department) {
        const byNo = canonicalGroupDisplayMap(groupRows, department);
        if (!byNo.size) return 0;
        let updated = 0;
        const jobs = await TVC_DB.getAll('maintenance_jobs');
        for (const job of jobs) {
            if (!sameVessel(job, vesselId) || job.department !== department) continue;
            const code = isDetachedJobCode(job.job_code) ? job.detached_from_code : job.job_code;
            const gNo = groupNoFromJobCode(code);
            if (!gNo || !byNo.has(gNo)) continue;
            const canonical = byNo.get(gNo);
            if (norm(job.group) === norm(canonical)) continue;
            job.group = canonical;
            job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
            job.updated_at = new Date().toISOString();
            await TVC_DB.put('maintenance_jobs', job);
            updated++;
        }
        return updated;
    }

    /**
     * 동일 GROUP NO에 이름만 다른 def/job 공존 시 정리 (load · import 공용).
     * canonicalByNo: import 시 Group Headers 기준 Map(groupNo → label)
     */
    async function repairDuplicateGroupNumbers(vesselId, opts = {}) {
        const department = opts.department || null;
        const canonicalByNo = opts.canonicalByNo || null;
        const jobs = (await TVC_DB.getAll('maintenance_jobs')).filter(j => sameVessel(j, vesselId));
        const defs = (await TVC_DB.getAll('maintenance_groups').catch(() => []))
            .filter(g => sameVessel(g, vesselId) && !norm(g.item_sort1));

        const clusters = new Map();
        const ensure = (dept, gNo) => {
            const k = `${dept}|${gNo}`;
            if (!clusters.has(k)) {
                clusters.set(k, { labels: new Map(), counts: new Map(), defs: [] });
            }
            return clusters.get(k);
        };
        const noteLabel = (c, label) => {
            const nk = norm(label);
            if (!c.labels.has(nk)) c.labels.set(nk, label);
            if (!c.counts.has(nk)) c.counts.set(nk, 0);
            return nk;
        };

        for (const j of jobs) {
            if (isDetachedJobCode(j.job_code)) continue;
            const gNo = groupNoFromJob(j);
            if (!gNo) continue;
            const c = ensure(j.department, gNo);
            const nk = noteLabel(c, j.group);
            c.counts.set(nk, (c.counts.get(nk) || 0) + 1);
        }
        for (const g of defs) {
            const sg = splitGroupLabel(g.label);
            if (!sg.no) continue;
            const c = ensure(g.department, sg.no);
            noteLabel(c, g.label);
            c.defs.push(g);
        }

        let defsPruned = 0;
        let jobsUpdated = 0;
        for (const [k, c] of clusters) {
            if (c.labels.size <= 1) continue;
            const [dept, gNo] = k.split('|');
            if (department && dept !== department) continue;

            let winnerDisplay = canonicalByNo?.get(gNo) || null;
            if (!winnerDisplay) {
                let bestScore = -1;
                for (const [nk, display] of c.labels) {
                    const count = c.counts.get(nk) || 0;
                    const def = c.defs.find(g => norm(g.label) === nk);
                    const ts = def?.updated_at ? Date.parse(def.updated_at) : 0;
                    const score = count * 1e15 + (Number.isFinite(ts) ? ts : 0);
                    if (score > bestScore) {
                        bestScore = score;
                        winnerDisplay = display;
                    }
                }
            }
            if (!winnerDisplay) continue;
            const winnerNorm = norm(winnerDisplay);

            for (const j of jobs) {
                if (j.department !== dept) continue;
                const codeNo = groupNoFromJobCode(
                    isDetachedJobCode(j.job_code) ? j.detached_from_code : j.job_code
                );
                if (codeNo !== gNo && groupNoFromJob(j) !== gNo) continue;
                if (norm(j.group) === winnerNorm) continue;
                j.group = winnerDisplay;
                j.updated_at = new Date().toISOString();
                await TVC_DB.put('maintenance_jobs', j);
                jobsUpdated++;
            }
            let winnerDefKept = false;
            for (const g of c.defs) {
                if (norm(g.label) === winnerNorm) {
                    if (g.label !== winnerDisplay) {
                        g.label = winnerDisplay;
                        g.updated_at = new Date().toISOString();
                        await TVC_DB.put('maintenance_groups', g);
                    }
                    winnerDefKept = true;
                    continue;
                }
                if (g.id) {
                    await TVC_DB.del('maintenance_groups', g.id);
                    defsPruned++;
                }
            }
            if (!winnerDefKept) {
                await upsertGroupDef(
                    { department: dept, label: winnerDisplay, groupNo: gNo, groupName: splitGroupLabel(winnerDisplay).name },
                    null,
                    vesselId
                );
            }
        }
        return { defsPruned, jobsUpdated };
    }

    /** Group Headers ↔ Jobs 시트 정합성 — job 누락 시 Import 중단 또는 경고 */
    function validateImportAlignment(groupRows, jobRows, skippedJobRows, department, equipRows = []) {
        const dept = normDept(department);
        const issues = [];
        const warnings = [];
        const badCodes = jobRows.filter(r => !r.job_id && !jobCodePatternOk(r.job_code));
        if (badCodes.length) {
            const sample = badCodes.slice(0, 3).map(r => `row ${r._excelRow || '?'}: "${r.job_code}"`).join(', ');
            issues.push(
                `Jobs sheet JOB CODE format error (${badCodes.length}) — use "01-00-001" (GG-EE-III). Use 00 if EE is not assigned. e.g. ${sample}`
            );
        }
        if (skippedJobRows.length) {
            const sample = skippedJobRows.slice(0, 4).map(s => s.row).join(', ');
            issues.push(
                `Jobs sheet skipped ${skippedJobRows.length} row(s) — DEPARTMENT or JOB CODE missing (rows: ${sample}${skippedJobRows.length > 4 ? '…' : ''}).\n`
                + 'Add new jobs on the Jobs sheet, not only on Group Headers.'
            );
        }
        const jobsByGroupNo = new Map();
        for (const r of jobRows) {
            if (!r.groupNo) {
                issues.push(`Jobs row ${r._excelRow || '?'} (${r.job_code}): GROUP NO missing`);
                continue;
            }
            const k = `${r.department}|${padGroupNo(r.groupNo)}`;
            jobsByGroupNo.set(k, (jobsByGroupNo.get(k) || 0) + 1);
        }
        if (dept === 'ENGINE') {
            const headerByNo = new Map();
            for (const g of groupRows) {
                if (g.department !== dept) continue;
                const k = `${g.department}|${g.groupNo}`;
                const prev = headerByNo.get(k);
                if (!prev || (g.jobsRef || 0) > (prev.jobsRef || 0)) headerByNo.set(k, g);
            }
            for (const g of headerByNo.values()) {
                const k = `${g.department}|${g.groupNo}`;
                const count = jobsByGroupNo.get(k) || 0;
                const expect = g.jobsRef;
                if (expect != null && expect > 0 && count === 0) {
                    issues.push(
                        `Group "${g.label}": Group Headers Jobs (ref)=${expect} but the Jobs sheet has no matching job rows.\n`
                        + '→ Add DEPARTMENT · GROUP NO · GROUP NAME · JOB CODE · JOB DETAIL rows on the Jobs sheet.'
                    );
                } else if (expect != null && expect > 0 && count > 0 && count < expect) {
                    warnings.push(`Group "${g.label}": Jobs (ref)=${expect}, Jobs sheet ${count} — ${expect - count} may be missing`);
                }
            }
        }
        const equipNames = new Set(
            (equipRows || [])
                .filter(e => e.department === dept)
                .map(e => `${e.groupNo}|${norm(e.item_sort1).toUpperCase()}`)
        );
        const unknownEquip = [];
        for (const r of jobRows) {
            const eq = norm(r.equipment);
            if (!eq) continue;
            if (!equipNames.has(`${r.groupNo}|${eq.toUpperCase()}`)) {
                unknownEquip.push(`row ${r._excelRow || '?'} (${r.job_code}): "${eq}"`);
            }
        }
        if (unknownEquip.length) {
            warnings.push(
                `Jobs Equipment name not found in Equipment Headers (${unknownEquip.length}). e.g. ${unknownEquip.slice(0, 3).join(', ')}`
            );
        }
        if (issues.length) {
            throw new Error(`PMS Master Import validation failed (${dept}):\n\n${issues.join('\n\n')}`);
        }
        return warnings;
    }

    async function loadImportWorkReportIndex() {
        if (_importWrIndex) return _importWrIndex;
        const any = new Set();
        const finalized = new Set();
        const reports = await TVC_DB.getAll('daily_work_reports').catch(() => []);
        for (const rep of reports) {
            TVC_WorkReport.fromLegacy(rep);
            for (const item of rep.job_items || []) {
                const jid = item.maintenance_job_id;
                if (!jid) continue;
                any.add(jid);
                const st = TVC_RBAC.normalizeReportStatus(item.status, rep.is_locked);
                if (st === 'CONFIRMED' || st === 'APPROVED') finalized.add(jid);
            }
        }
        _importWrIndex = { any, finalized };
        return _importWrIndex;
    }

    function clearImportWorkReportIndex() {
        _importWrIndex = null;
    }

    async function jobHasFinalizedHistory(jobId) {
        if (!jobId) return false;
        const idx = await loadImportWorkReportIndex();
        return idx.finalized.has(jobId);
    }

    async function jobHasAnyWorkReport(jobId) {
        if (!jobId) return false;
        const idx = await loadImportWorkReportIndex();
        return idx.any.has(jobId);
    }

    function tempJobCode(jobId) {
        return `__tvc_${String(jobId || '').replace(/-/g, '').slice(0, 12)}`;
    }

    function isDetachedJobCode(code) {
        return String(code || '').startsWith('__tvc_');
    }

    function refreshJobMaps(jobs) {
        const byId = new Map(jobs.map(j => [j.id, j]));
        const byDeptCode = new Map();
        for (const j of jobs) {
            for (const alias of jobCodeAliases(j.job_code)) {
                const k = `${j.department}|${alias}`;
                if (!byDeptCode.has(k)) byDeptCode.set(k, j);
            }
        }
        return { byId, byDeptCode };
    }

    function importRowMatchesJob(row, job) {
        if (row.job_id && row.job_id === job.id) return true;
        if (row.department !== job.department) return false;
        if (jobCodesEqual(row.job_code, job.job_code)) return true;
        if (row.job_code && jobCodesEqual(row.job_code, job.detached_from_code)) return true;
        if (row._legacyJobCode && jobCodesEqual(row._legacyJobCode, job.job_code)) return true;
        if (row._legacyJobCode && jobCodesEqual(row._legacyJobCode, job.detached_from_code)) return true;
        if (norm(row.group) === norm(job.group) && norm(row.job_detail) === norm(job.job_detail)) return true;
        return false;
    }

    /** Orphan 삭제용 — CODE/ID만 매칭. group+detail 유사매칭은 01-121 등 삭제를 막으므로 사용 금지 */
    function importRowMatchesJobForOrphan(row, job) {
        if (row.job_id && row.job_id === job.id) return true;
        if (row.department !== job.department) return false;
        if (jobCodesEqual(row.job_code, job.job_code)) return true;
        if (row.job_code && jobCodesEqual(row.job_code, job.detached_from_code)) return true;
        if (row._legacyJobCode && jobCodesEqual(row._legacyJobCode, job.job_code)) return true;
        if (row._legacyJobCode && jobCodesEqual(row._legacyJobCode, job.detached_from_code)) return true;
        return false;
    }

    function findDetachedImportJob(row, existingJobs) {
        if (!jobCodePatternOk(row.job_code)) return null;
        const detached = existingJobs.filter(j =>
            j.department === row.department && isDetachedJobCode(j.job_code)
        );
        if (!detached.length) return null;
        const byLegacy = detached.filter(j => j.detached_from_code === row.job_code);
        if (byLegacy.length === 1) return byLegacy[0];
        if (row.job_id) {
            const byId = detached.find(j => j.id === row.job_id);
            if (byId) return byId;
            const tempFromRow = tempJobCode(row.job_id);
            const byTemp = detached.find(j => j.job_code === tempFromRow);
            if (byTemp) return byTemp;
        }
        if (row._importJobIdUnknown) {
            const tempFromUnknown = tempJobCode(row._importJobIdUnknown);
            const byUnknownTemp = detached.find(j => j.job_code === tempFromUnknown);
            if (byUnknownTemp) return byUnknownTemp;
        }
        const gNorm = norm(row.group);
        const dNorm = norm(row.job_detail);
        if (gNorm && dNorm) {
            const byDetail = detached.filter(j =>
                norm(j.group) === gNorm && norm(j.job_detail) === dNorm
            );
            if (byDetail.length === 1) return byDetail[0];
        }
        if (row.groupNo) {
            const byGroupNo = detached.filter(j => {
                const gNo = splitGroupLabel(j.group).no || groupNoFromJobCode(j.detached_from_code);
                return gNo === row.groupNo;
            });
            if (byGroupNo.length === 1) return byGroupNo[0];
            if (byGroupNo.length > 1) {
                const byCode = byGroupNo.filter(j => j.detached_from_code === row.job_code);
                if (byCode.length === 1) return byCode[0];
            }
        }
        return null;
    }

    function buildImportGroupDetailCounts(jobRows) {
        const counts = new Map();
        for (const row of jobRows) {
            const k = `${row.department}|${norm(row.group)}|${norm(row.job_detail)}`;
            counts.set(k, (counts.get(k) || 0) + 1);
        }
        return counts;
    }

    function findImportJobMatch(row, byId, byDeptCode, existingJobs, groupDetailCounts) {
        if (row.job_id) {
            const byIdHit = byId.get(row.job_id);
            if (byIdHit) return byIdHit;
        }
        if (row.job_code && jobCodePatternOk(row.job_code)) {
            const detachedByLegacy = existingJobs.filter(j =>
                j.department === row.department &&
                isDetachedJobCode(j.job_code) &&
                j.detached_from_code === row.job_code
            );
            if (detachedByLegacy.length === 1) return detachedByLegacy[0];
        }
        let job = byDeptCode.get(`${row.department}|${row.job_code}`);
        if (job) return job;
        if (row._legacyJobCode) {
            job = byDeptCode.get(`${row.department}|${row._legacyJobCode}`);
            if (job) return job;
        }
        job = findDetachedImportJob(row, existingJobs);
        if (job) return job;
        const gNorm = norm(row.group);
        const dNorm = norm(row.job_detail);
        const gdKey = `${row.department}|${gNorm}|${dNorm}`;
        const gdImportCount = groupDetailCounts?.get(gdKey) || 1;
        if (gNorm && dNorm && gdImportCount === 1) {
            const byGroupDetail = existingJobs.filter(j =>
                j.department === row.department &&
                norm(j.group) === gNorm &&
                norm(j.job_detail) === dNorm
            );
            if (byGroupDetail.length === 1) {
                job = byGroupDetail[0];
            } else if (byGroupDetail.length > 1) {
                job = byGroupDetail.find(j =>
                    j.job_code === row.job_code ||
                    j.detached_from_code === row.job_code ||
                    (row.job_id && j.id === row.job_id)
                ) || null;
            }
            if (job) return job;
        }
        return null;
    }

    /** 구 Excel(JOB_ID 열 있음) — 로컬 DB에 없거나 중복이면 JOB CODE 매칭으로 전환 */
    function sanitizeImportJobRows(jobRows, vesselId, allExisting) {
        const localIds = new Set(
            (allExisting || []).filter(j => sameVessel(j, vesselId)).map(j => j.id)
        );
        const globalIds = new Set((allExisting || []).map(j => j.id));
        const seenJobIds = new Set();
        const warnings = [];
        for (const row of jobRows) {
            if (!row.job_id) continue;
            if (!globalIds.has(row.job_id)) {
                row._importJobIdUnknown = row.job_id;
                row.job_id = null;
                continue;
            }
            if (!localIds.has(row.job_id)) continue;
            if (seenJobIds.has(row.job_id)) {
                warnings.push(
                    `Jobs row ${row._excelRow || '?'} (${row.job_code}): JOB_ID가 다른 행과 중복 — JOB CODE로 매칭합니다.`
                );
                row.job_id = null;
            } else {
                seenJobIds.add(row.job_id);
            }
        }
        return warnings;
    }

    /** Import / orphan cleanup — 선택 부서(ENGINE·DECK)만 대상; 타 부서 job·group은 절대 변경하지 않음 */
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
            if (jobRows.some(row => importRowMatchesJobForOrphan(row, job))) continue;

            const action = await evictUnimportedJob(job);
            if (action === 'removed') removed++;
            else if (action === 'detached') detached++;
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
            await cascadeJobCodeRename(job.job_code, temp, job.id, { department: job.department });
            job.job_code = temp;
            job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
            job.updated_at = new Date().toISOString();
            await TVC_DB.put('maintenance_jobs', job);
            reserved++;
        }
        return reserved;
    }

    async function cascadeJobCodeRename(oldCode, newCode, jobId, opts = {}) {
        const department = opts.department ? String(opts.department).toUpperCase() : null;
        const sameDept = (rowDept) => !department || String(rowDept || '').toUpperCase() === department;
        let n = 0;
        const reports = await TVC_DB.getAll('daily_work_reports');
        for (const raw of reports) {
            const rep = { ...raw };
            TVC_WorkReport.fromLegacy(rep);
            let changed = false;
            const linkedToJob = (rep.job_items || []).some(it => it.maintenance_job_id === jobId);
            if (rep.job_code === oldCode && (linkedToJob || sameDept(rep.department))) {
                rep.job_code = newCode;
                changed = true;
            }
            if (Array.isArray(rep.job_codes)) {
                const next = rep.job_codes.map(c => (c === oldCode && (linkedToJob || sameDept(rep.department))) ? newCode : c);
                if (next.some((c, i) => c !== rep.job_codes[i])) {
                    rep.job_codes = next;
                    changed = true;
                }
            }
            for (const item of rep.job_items || []) {
                if (item.job_code !== oldCode) continue;
                if (item.maintenance_job_id === jobId) {
                    item.job_code = newCode;
                    changed = true;
                    continue;
                }
                if (!item.maintenance_job_id && sameDept(rep.department)) {
                    item.job_code = newCode;
                    item.maintenance_job_id = jobId;
                    changed = true;
                }
            }
            if (changed) { await TVC_DB.put('daily_work_reports', rep); n++; }
        }
        const defects = await TVC_DB.getAll('defect_cases');
        for (const dc of defects) {
            let changed = false;
            const linked = dc.maintenance_job_id === jobId;
            if ((dc.pms_job_code === oldCode || dc.job_code === oldCode) && (linked || sameDept(dc.department))) {
                if (dc.pms_job_code === oldCode) dc.pms_job_code = newCode;
                if (dc.job_code === oldCode) dc.job_code = newCode;
                if (!dc.maintenance_job_id) dc.maintenance_job_id = jobId;
                changed = true;
            }
            if (changed) await TVC_DB.put('defect_cases', dc);
        }
        const boms = await TVC_DB.getAll('job_bom');
        for (const b of boms) {
            if (b.job_code !== oldCode) continue;
            if (b.maintenance_job_id && b.maintenance_job_id !== jobId) continue;
            if (!b.maintenance_job_id && department && b.department && String(b.department).toUpperCase() !== department) continue;
            b.job_code = newCode;
            if (!b.maintenance_job_id) b.maintenance_job_id = jobId;
            await TVC_DB.put('job_bom', b);
        }
        return n;
    }

    function deckJobUsesLegacyCatalog(job) {
        if (String(job?.department || '').toUpperCase() !== 'DECK') return false;
        return usesLegacyDeckGroupNumber(job.group);
    }

    /**
     * Live DB — legacy DECK seed (26·28·… groups) → approved catalog (01·02·…).
     * HQ/Master Excel Export only renumbered in the file; this aligns Vessel Deck PC on load.
     */
    async function applyDeckCatalogNormalization(jobs, groups) {
        const pool = jobs || [];
        const legacyDeck = pool.filter(deckJobUsesLegacyCatalog);
        if (!legacyDeck.length) {
            const legacyDefsPurged = await purgeLegacyDeckGroupDefs(null);
            return {
                updated: 0, renamed: 0, groups: 0, spares: 0,
                legacyDefsPurged: legacyDefsPurged.pruned,
                legacyEquipRenamed: legacyDefsPurged.renamed,
            };
        }

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
                await cascadeJobCodeRename(oldCode, normJob.job_code, job.id, { department: job.department });
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
            if (!usesLegacyDeckGroupNumber(g.label)) continue;
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

        const legacyDefsPurged = await purgeLegacyDeckGroupDefs(null);
        const rebuildVids = [...new Set(changedJobs.map(j => j.vessel_id).filter(Boolean))];
        for (const vid of rebuildVids) {
            await rebuildVesselComponentTree(vid);
        }

        if (changedJobs.length || changedGroups.length || sparesUpdated || legacyDefsPurged.pruned || legacyDefsPurged.renamed) {
            console.info(
                `[TVC] DECK catalog normalized: jobs=${changedJobs.length}, codes renamed=${renamed}, `
                + `groups=${changedGroups.length}, spares=${sparesUpdated}, `
                + `legacy defs purged=${legacyDefsPurged.pruned}, equip headers renamed=${legacyDefsPurged.renamed}`
            );
        }
        return {
            updated: changedJobs.length,
            renamed,
            groups: changedGroups.length,
            spares: sparesUpdated,
            legacyDefsPurged: legacyDefsPurged.pruned,
            legacyEquipRenamed: legacyDefsPurged.renamed,
        };
    }

    async function bulkReplaceJobCodes(codeMap, department) {
        if (!codeMap?.size) return 0;
        const sameDept = (rowDept) => !department || String(rowDept || '').toUpperCase() === String(department).toUpperCase();
        let n = 0;
        const reports = await TVC_DB.getAll('daily_work_reports').catch(() => []);
        for (const raw of reports) {
            const rep = { ...raw };
            TVC_WorkReport.fromLegacy(rep);
            let changed = false;
            if (codeMap.has(rep.job_code) && sameDept(rep.department)) {
                rep.job_code = codeMap.get(rep.job_code);
                changed = true;
            }
            if (Array.isArray(rep.job_codes)) {
                const next = rep.job_codes.map(c => (codeMap.has(c) && sameDept(rep.department)) ? codeMap.get(c) : c);
                if (next.some((c, i) => c !== rep.job_codes[i])) {
                    rep.job_codes = next;
                    changed = true;
                }
            }
            for (const item of rep.job_items || []) {
                if (codeMap.has(item.job_code)) {
                    item.job_code = codeMap.get(item.job_code);
                    changed = true;
                }
            }
            if (changed) {
                await TVC_DB.put('daily_work_reports', rep);
                n++;
            }
        }
        const defects = await TVC_DB.getAll('defect_cases').catch(() => []);
        for (const dc of defects) {
            let changed = false;
            if (codeMap.has(dc.pms_job_code)) { dc.pms_job_code = codeMap.get(dc.pms_job_code); changed = true; }
            if (codeMap.has(dc.job_code)) { dc.job_code = codeMap.get(dc.job_code); changed = true; }
            if (changed) await TVC_DB.put('defect_cases', dc);
        }
        const boms = await TVC_DB.getAll('job_bom').catch(() => []);
        for (const b of boms) {
            if (!codeMap.has(b.job_code)) continue;
            if (department && b.department && String(b.department).toUpperCase() !== String(department).toUpperCase()) continue;
            b.job_code = codeMap.get(b.job_code);
            await TVC_DB.put('job_bom', b);
        }
        return n;
    }

    /** Live DB — 01-001 → 01-00-001 (EE 미지정=00). Equipment 지정 시 해당 EQ NO 사용. */
    async function applyPmsJobCodeNormalization(jobs, groups) {
        const pool = jobs || [];
        const codeMap = new Map();
        const changed = [];
        for (const job of pool) {
            if (isDetachedJobCode(job.job_code)) continue;
            const p = parsePmsJobCode(job.job_code);
            if (!p.valid) continue;
            const eqNo = parseEquipNoCell(job.equipment_no) || resolveJobEquipNo(job, groups) || p.equipNo || 0;
            const next = formatPmsJobCode(p.groupNo, eqNo, p.itemNo);
            let dirty = false;
            if (next !== job.job_code) {
                codeMap.set(job.job_code, next);
                job.job_code = next;
                dirty = true;
            }
            if (eqNo && parseEquipNoCell(job.equipment_no) !== eqNo) {
                job.equipment_no = eqNo;
                dirty = true;
            }
            if (dirty) {
                job.updated_at = new Date().toISOString();
                changed.push(job);
            }
        }
        if (changed.length) await TVC_DB.bulkPut('maintenance_jobs', changed);
        if (codeMap.size) await bulkReplaceJobCodes(codeMap, null);
        if (changed.length) {
            console.info(`[TVC] PMS JOB CODE GG-EE-III: ${changed.length} jobs, ${codeMap.size} codes`);
        }
        return { updated: changed.length, renamed: codeMap.size };
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
        const gNo = row.groupNo || splitGroupLabel(label).no;

        // 그룹 헤더(item 없음): 동일 GROUP NO의 UI 빈 그룹(AAAA 등)을 Excel 이름으로 교체
        let hit = defs.find(g =>
            sameVessel(g, vesselId)
            && g.department === dept
            && norm(g.label) === norm(label)
            && norm(g.item_sort1 || '') === item
        );
        if (!hit && !item && gNo) {
            hit = defs.find(g =>
                sameVessel(g, vesselId)
                && g.department === dept
                && !norm(g.item_sort1 || '')
                && splitGroupLabel(g.label).no === gNo
            );
        }
        const id = hit?.id || groupDefId(vesselId, dept, label, item);
        const next = {
            ...(hit || {}),
            id,
            vessel_id: vesselId,
            department: dept,
            label,
            item_sort1: item || null,
            equipment_no: item ? (row.equipment_no != null ? row.equipment_no : hit?.equipment_no) : null,
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

        // 같은 GROUP NO의 다른 이름 빈 그룹 def 제거 (32.AAAA vs 32.E1)
        if (!item && gNo) {
            for (const g of defs) {
                if (g.id === next.id) continue;
                if (!sameVessel(g, vesselId) || g.department !== dept) continue;
                if (norm(g.item_sort1 || '')) continue;
                if (splitGroupLabel(g.label).no !== gNo) continue;
                if (norm(g.label) === norm(label)) continue;
                if (g.id) await TVC_DB.del('maintenance_groups', g.id);
            }
        }
    }

    function getWorksheetCI(wb, name) {
        if (!wb) return null;
        const exact = wb.getWorksheet(name);
        if (exact) return exact;
        const target = String(name || '').trim().toLowerCase();
        return (wb.worksheets || []).find(ws => String(ws.name || '').trim().toLowerCase() === target) || null;
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
            const parts = [dept, job.group, job.sort, job.equipment, job.item_sort1, job.item_sort2].map(p => norm(p)).filter(Boolean);
            let parent = null;
            const pathAcc = [];
            const types = ['DEPARTMENT', 'GROUP', 'SORT', 'EQUIPMENT', 'ITEM_L1', 'ITEM_L2'];
            for (let i = 0; i < parts.length; i++) {
                pathAcc.push(parts[i]);
                parent = ensure(pathAcc, types[Math.min(i, types.length - 1)], parts[i], parent);
            }
            job.ship_component_id = parent;
            if (vesselId) job.vessel_id = vesselId;
        }
        return Object.values(components);
    }

    async function rebuildVesselComponentTree(vesselId) {
        const vesselJobs = (await TVC_DB.getAll('maintenance_jobs')).filter(j => sameVessel(j, vesselId));
        if (typeof TVC_MasterVesselScope !== 'undefined') {
            await TVC_MasterVesselScope.clearVesselStore('ship_components', vesselId);
        }
        const comps = rebuildComponentTree(vesselJobs, vesselId);
        if (comps.length) await TVC_DB.bulkPut('ship_components', comps);
        for (const job of vesselJobs) {
            await TVC_DB.put('maintenance_jobs', job);
        }
    }

    /** Import 직후 Group Headers Jobs(ref) vs DB 실제 건수 검증 + 요약 */
    async function verifyImportGroupJobCounts(groupRows, vesselId, department) {
        const warnings = [];
        const summary = [];
        const jobs = (await TVC_DB.getAll('maintenance_jobs')).filter(j =>
            sameVessel(j, vesselId) && j.department === department && !isDetachedJobCode(j.job_code)
        );
        const byNo = new Map();
        const samples = new Map();
        for (const j of jobs) {
            const gNo = groupNoFromJob(j);
            if (!gNo) continue;
            byNo.set(gNo, (byNo.get(gNo) || 0) + 1);
            if (!samples.has(gNo)) samples.set(gNo, j.job_code);
        }
        for (const g of groupRows || []) {
            if (g.department !== department) continue;
            const expect = g.jobsRef;
            if (expect == null || expect <= 0) continue;
            const count = byNo.get(g.groupNo) || 0;
            summary.push(`${g.label}: DB ${count} (Excel ref ${expect})${count ? ` · e.g. ${samples.get(g.groupNo)}` : ''}`);
            if (count === 0) {
                warnings.push(
                    `Import failed: Group "${g.label}" Excel Jobs(ref)=${expect} but 0 jobs after Import`
                );
            } else if (count < expect) {
                warnings.push(`Group "${g.label}": Excel ref=${expect}, DB=${count}`);
            }
        }
        return { warnings, summary };
    }

    function buildExcelJobRecord(row, vesselId, importStamp, existing) {
        const period = Number(row.period) || 1;
        const unit = (row.unit || 'M').toUpperCase();
        const base = existing ? { ...existing } : {
            id: (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            is_locked: false,
            plan_status: 'PLANNED',
            schedule_basis: null,
            sync_status: 'LOCAL',
            sort: '',
        };
        base.vessel_id = vesselId;
        base.department = row.department;
        base.group = row.group;
        base.job_code = row.job_code;
        base.equipment = row.equipment || '';
        base.equipment_no = row.equipment_no || 0;
        base.item_sort1 = row.item_sort1 || '';
        base.item_sort2 = row.item_sort2 || '';
        base.job_detail = row.job_detail || '';
        base.period = period;
        base.unit = unit;
        base.pic = row.pic || '';
        if (row.critical != null) base.is_critical_equipment = row.critical;
        if (row.last_done) base.last_done = row.last_done;
        if (row.next_date) {
            base.next_date = row.next_date;
            if (!base.original_next_date) base.original_next_date = row.next_date;
        }
        base.master_import_at = importStamp;
        base.updated_at = importStamp;
        if (existing) {
            base.sync_status = existing.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (existing.sync_status || 'LOCAL');
        }
        return base;
    }

    /**
     * Import 최종 보장 — Excel jobRows를 bulkPut으로 DB에 강제 반영 후 재조회 검증.
     */
    async function ensureImportJobsPersisted(jobRows, vesselId, department, importStamp) {
        let repaired = 0;
        let created = 0;
        const all = await TVC_DB.getAll('maintenance_jobs');
        const scoped = all.filter(j => sameVessel(j, vesselId) && j.department === department);
        const byCode = new Map();
        for (const j of scoped) {
            if (!j.job_code || isDetachedJobCode(j.job_code)) continue;
            byCode.set(j.job_code, j);
        }

        const toPut = [];
        for (const row of jobRows) {
            if (!row.job_code || row.department !== department) continue;
            const prev = byCode.get(row.job_code);
            if (!prev) {
                const job = buildExcelJobRecord(row, vesselId, importStamp, null);
                job._ensure_created = true;
                toPut.push(job);
                byCode.set(job.job_code, job);
                created++;
                continue;
            }
            const needGroup = row.group && norm(prev.group) !== norm(row.group);
            const needVessel = !prev.vessel_id;
            const needEquip = norm(prev.equipment || '') !== norm(row.equipment || '')
                || parseEquipNoCell(prev.equipment_no) !== parseEquipNoCell(row.equipment_no);
            const needCode = canonicalPmsJobCode(prev.job_code, row.groupNo, row.equipment_no || 0) !== prev.job_code;
            const needCrit = row.critical != null && prev.is_critical_equipment !== row.critical;
            if (needGroup || needVessel || needEquip || needCode || needCrit) {
                const job = buildExcelJobRecord(row, vesselId, importStamp, prev);
                toPut.push(job);
                byCode.set(job.job_code, job);
                repaired++;
            }
        }

        if (toPut.length) {
            if (typeof TVC_DB.bulkPut === 'function') {
                await TVC_DB.bulkPut('maintenance_jobs', toPut);
            } else {
                for (const job of toPut) await TVC_DB.put('maintenance_jobs', job);
            }
        }

        // bulkPut 후에도 누락이면 개별 put으로 재시도
        const after = await TVC_DB.getAll('maintenance_jobs');
        const afterCodes = new Set(
            after
                .filter(j => sameVessel(j, vesselId) && j.department === department && !isDetachedJobCode(j.job_code))
                .map(j => j.job_code)
        );
        const stillMissing = [];
        for (const row of jobRows) {
            if (!row.job_code || row.department !== department) continue;
            if (afterCodes.has(row.job_code)) continue;
            const job = buildExcelJobRecord(row, vesselId, importStamp, null);
            job._ensure_retry = true;
            await TVC_DB.put('maintenance_jobs', job);
            afterCodes.add(job.job_code);
            created++;
            stillMissing.push(row.job_code);
        }

        return { repaired, created, retried: stillMissing.length, missingCodes: stillMissing.slice(0, 20) };
    }

    async function importFromWorkbook(wb, user, opts = {}) {
        if (!TVC_RBAC.canMasterExcelAccount?.(user)) {
            throw Object.assign(new Error('PMS Master Import requires admin or pms-21.'), { code: 'PERMISSION_DENIED' });
        }
        clearImportWorkReportIndex();
        try {
        const department = normDept(opts.department);
        const vesselId = await resolveImportVesselId(user, opts);
        const wsG = getWorksheetCI(wb, 'Group Headers');
        const wsE = getWorksheetCI(wb, 'Equipment Headers');
        const wsJ = getWorksheetCI(wb, 'Jobs');
        if (!wsJ) throw new Error('Jobs sheet not found.');

        const groupRows = rowsForDepartment(wsG ? parseGroupRows(wsG, department) : [], department);
        const equipRows = rowsForDepartment(wsE ? parseEquipmentRows(wsE) : [], department);
        const parsedJobs = parseJobRows(wsJ, department);
        const skippedJobRows = parsedJobs._skipped || [];
        const jobRows = rowsForDepartment(normalizeImportJobRows(parsedJobs), department);
        if (!jobRows.length) throw new Error(`Jobs sheet has no ${department} data.`);
        applyJobEquipmentFromHeaders(jobRows, equipRows);
        applyCanonicalImportGroups(groupRows, jobRows, department);
        let allExisting = await TVC_DB.getAll('maintenance_jobs');
        const sanitizeWarnings = sanitizeImportJobRows(jobRows, vesselId, allExisting);
        const importWarnings = validateImportAlignment(groupRows, jobRows, skippedJobRows, department, equipRows);
        importWarnings.push(...sanitizeWarnings);

        // Work Report 인덱스 1회 로드 — job마다 getAll 금지 (701×전체스캔으로 Import가 끊기던 원인)
        await loadImportWorkReportIndex();

        // Jobs 먼저 반영 — 그룹만 남고 job 0건인 부분 Import 방지
        const orphanStats = await removeOrphanJobs(jobRows, vesselId);
        const supersededStats = await removeSupersededGroupJobs(groupRows, jobRows, vesselId, department);
        orphanStats.removed += supersededStats.removed;
        orphanStats.detached += supersededStats.detached;
        allExisting = await TVC_DB.getAll('maintenance_jobs');
        let existingJobs = allExisting.filter(j => sameVessel(j, vesselId));
        let { byId, byDeptCode } = refreshJobMaps(existingJobs);
        await reserveJobCodeSlots(jobRows, byId);

        allExisting = await TVC_DB.getAll('maintenance_jobs');
        existingJobs = allExisting.filter(j => sameVessel(j, vesselId));
        ({ byId, byDeptCode } = refreshJobMaps(existingJobs));

        let created = 0;
        let updated = 0;
        let renamed = 0;
        const codeReuseNotes = [];
        const rowErrors = [];
        const importStamp = new Date().toISOString();
        const groupDetailCounts = buildImportGroupDetailCounts(jobRows);
        const touchedJobIds = new Set();

        for (const row of jobRows) {
            try {
                if (row.job_id && byId.has(row.job_id) === false) {
                    const foreign = allExisting.find(j => j.id === row.job_id && !sameVessel(j, vesselId));
                    if (foreign) row.job_id = null;
                }
                let job = findImportJobMatch(row, byId, byDeptCode, existingJobs, groupDetailCounts);

                const period = Number(row.period) || 1;
                const unit = (row.unit || 'M').toUpperCase();
                const { lastDone, nextDate, runHourMeta } = resolveImportSchedule(row, period, unit, importWarnings);

                if (!job) {
                    const dup = existingJobs.filter(j => j.department === row.department && j.job_code === row.job_code);
                    if (dup.length) job = dup[0];
                }

                if (!job) {
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
                        equipment: row.equipment || '',
                        equipment_no: row.equipment_no || 0,
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
                    applyImportScheduleToJob(job, lastDone, nextDate, false, runHourMeta);
                    created++;
                } else {
                    const oldCode = job.job_code;
                    const oldGroup = job.group;
                    const protectedSched = await jobHasFinalizedHistory(job.id);

                    job.vessel_id = vesselId;
                    job.department = row.department;
                    job.group = row.group;
                    job.equipment = row.equipment || '';
                    job.equipment_no = row.equipment_no || 0;
                    job.item_sort1 = row.item_sort1;
                    job.item_sort2 = row.item_sort2;
                    job.job_detail = row.job_detail;
                    job.period = period;
                    job.unit = unit;
                    job.pic = row.pic;
                    if (row.critical != null) job.is_critical_equipment = row.critical;

                    applyImportScheduleToJob(job, lastDone, nextDate, protectedSched, runHourMeta);

                    if (oldCode !== row.job_code) {
                        await cascadeJobCodeRename(oldCode, row.job_code, job.id, { department: job.department });
                        job.job_code = row.job_code;
                        delete job.detached_from_code;
                        renamed++;
                    } else if (row._legacyJobCode && row._legacyJobCode !== row.job_code && oldCode === row._legacyJobCode) {
                        await cascadeJobCodeRename(row._legacyJobCode, row.job_code, job.id, { department: job.department });
                        job.job_code = row.job_code;
                        delete job.detached_from_code;
                        renamed++;
                    } else if (isDetachedJobCode(job.job_code) && jobCodePatternOk(row.job_code)) {
                        await cascadeJobCodeRename(job.job_code, row.job_code, job.id, { department: job.department });
                        job.job_code = row.job_code;
                        delete job.detached_from_code;
                        renamed++;
                    }
                    job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
                    job.master_import_at = importStamp;
                    job.updated_at = importStamp;
                    updated++;
                    if (norm(oldGroup) !== norm(row.group) && codeReuseNotes.length < 5) {
                        codeReuseNotes.push(`${row.job_code}: "${oldGroup}" → "${row.group}"`);
                    }
                }
                await TVC_DB.put('maintenance_jobs', job);
                touchedJobIds.add(job.id);
                byId.set(job.id, job);
                byDeptCode.set(`${job.department}|${job.job_code}`, job);
                const idx = existingJobs.findIndex(j => j.id === job.id);
                if (idx >= 0) existingJobs[idx] = job;
                else existingJobs.push(job);
            } catch (rowErr) {
                rowErrors.push(`Jobs row ${row._excelRow || '?'} (${row.job_code}): ${rowErr.message || rowErr}`);
            }
        }
        if (rowErrors.length) importWarnings.push(...rowErrors.slice(0, 8));

        await dedupeImportJobCodeStubs(vesselId, department, touchedJobIds);
        await removeStaleJobCodeStubs(jobRows, vesselId, department, touchedJobIds);
        await reconcileJobsToCanonicalGroups(groupRows, vesselId, department, touchedJobIds);
        const rehomedJobs = await rehomeAllJobsByGroupNumber(groupRows, vesselId, department);

        await pruneSupersededGroupDefs(groupRows, vesselId, department);
        const groupRepair = await repairDuplicateGroupNumbers(vesselId, {
            department,
            canonicalByNo: canonicalGroupDisplayMap(groupRows, department),
        });
        await purgeLegacyDeckGroupDefs(vesselId);

        // 수리·rehome 이후 반드시 재조회 — 이전 스냅샷 put이 canonical group을 되돌리지 않도록
        let vesselJobs = (await TVC_DB.getAll('maintenance_jobs')).filter(j => sameVessel(j, vesselId));
        const keepGroupKeys = new Set(
            (groupRows || []).map(g => `${g.department}|${norm(g.label)}`)
        );
        await pruneEmptyGroupDefs(vesselJobs, vesselId, keepGroupKeys);
        vesselJobs = (await TVC_DB.getAll('maintenance_jobs')).filter(j => sameVessel(j, vesselId));

        if (typeof TVC_MasterVesselScope !== 'undefined') {
            await TVC_MasterVesselScope.clearVesselStore('ship_components', vesselId);
        }
        const comps = rebuildComponentTree(vesselJobs, vesselId);
        if (comps.length) await TVC_DB.bulkPut('ship_components', comps);
        for (const job of vesselJobs) {
            await TVC_DB.put('maintenance_jobs', job);
        }

        // 최종 보장: Excel Jobs 행 bulkPut + 누락 개별 재시도
        let ensureStats = await ensureImportJobsPersisted(jobRows, vesselId, department, importStamp);
        created += ensureStats.created;
        let verify = await verifyImportGroupJobCounts(groupRows, vesselId, department);
        if (verify.warnings.length) {
            const retry = await ensureImportJobsPersisted(jobRows, vesselId, department, importStamp);
            ensureStats = {
                repaired: ensureStats.repaired + retry.repaired,
                created: ensureStats.created + retry.created,
                retried: (ensureStats.retried || 0) + (retry.retried || 0),
                missingCodes: retry.missingCodes || ensureStats.missingCodes,
            };
            created += retry.created;
            verify = await verifyImportGroupJobCounts(groupRows, vesselId, department);
        }

        const tailCodes = jobRows
            .filter(r => {
                const n = parseInt(r.groupNo || groupNoFromJobCode(r.job_code), 10);
                return Number.isFinite(n) && n >= 29 && n <= 43;
            })
            .map(r => r.job_code);

        if (verify.warnings.length) {
            throw new Error(
                `PMS Master Import — some groups have no jobs applied.\n\n`
                + `${verify.warnings.slice(0, 8).join('\n')}\n\n`
                + `Parsed jobs: ${jobRows.length} rows · new ${created} · updated ${updated}\n`
                + `29~43 parsed CODE: ${tailCodes.slice(0, 20).join(', ') || '(none)'}\n`
                + (rowErrors.length ? `Row errors ${rowErrors.length}:\n${rowErrors.slice(0, 5).join('\n')}\n\n` : '')
                + `Engine: ${IMPORT_BUILD_ID}`
            );
        }

        // Jobs 검증 통과 후에만 Group Headers 반영 (빈 그룹만 남는 현상 방지)
        for (const g of groupRows) await upsertGroupDef(g, null, vesselId);
        for (const e of equipRows) await upsertGroupDef(e, e.item_sort1, vesselId);

        const orphanNote = orphanStats.removed || orphanStats.detached
            ? ` · 제외 ${orphanStats.removed} · Work Report 격리 ${orphanStats.detached}`
            : '';
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📥 [PMS Master Import] ${vesselId} jobs +${created} ~${updated} rename ${renamed}${orphanNote} — ${user.display_name}`,
            sync_status: 'LOCAL',
        });
        await TVC_DB.setMeta(TVC_META_KEYS.PMS_MASTER_IMPORTED, importStamp);
        await saveCanonicalGroupMap(vesselId, department, groupRows);

        return {
            created, updated, renamed,
            removed: orphanStats.removed,
            detached: orphanStats.detached,
            rehomedJobs,
            groupRepair,
            ensureRepaired: ensureStats.repaired,
            ensureCreated: ensureStats.created,
            rowErrors: rowErrors.length,
            groups: groupRows.length,
            equipment: equipRows.length,
            jobs: jobRows.length,
            vessel_id: vesselId,
            codeReuseNotes,
            skippedJobRows: skippedJobRows.length,
            warnings: importWarnings,
            importBuild: IMPORT_BUILD_ID,
            groupVerify: verify.warnings,
            groupSummary: verify.summary,
            tailJobCodes: tailCodes,
        };
        } finally {
            clearImportWorkReportIndex();
        }
    }

    async function importFromFile(file, user, opts = {}) {
        if (!file) throw new Error('No file selected.');
        if (typeof ExcelJS === 'undefined') throw new Error('ExcelJS is not loaded.');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        return importFromWorkbook(wb, user, opts);
    }

    return {
        exportToFile, exportToWorkbook, importFromFile, importFromWorkbook,
        buildGroupLabel, splitGroupLabel, resolveGroup, renumberJobsForExport,
        isLegacyDeckGroupLabel, usesLegacyDeckGroupNumber, pruneEmptyGroupDefs, findImportJobMatch, importRowMatchesJob,
        applyDeckCatalogNormalization, applyPmsJobCodeNormalization, deckJobUsesLegacyCatalog,
        formatPmsJobCode, parsePmsJobCode,
        parseCriticalFromRow, parseCriticalCell, criticalExportValue, groupDefsCriticalValue,
        repairDuplicateGroupNumbers, rehomeAllJobsByGroupNumber,
        saveCanonicalGroupMap, loadCanonicalGroupMap,
        IMPORT_BUILD_ID,
        masterExcelFilename,
        DECK_LEGACY_CATALOG,
    };
})();
