/**
 * INCHEON CHEMI — PMS Master Excel sample generator (CLI)
 * Matches TVC-PMS V.1 format: Group NO/NAME · Jobs by DEPARTMENT + JOB CODE
 *
 * Usage: npm run export-pms-master-sample
 */
import ExcelJS from 'exceljs';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SEED_PATH = path.join(ROOT, 'data', 'pms-unified.json');
const OUT_PATH = path.join(ROOT, 'data', 'INCHEON CHEMI_PMS_MASTER_SAMPLE.xlsx');

const NAVY = 'FF1A365D';
const GREEN = 'FF217346';
const HDR_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const CELL_ALIGN = { vertical: 'top', horizontal: 'left', wrapText: false };
const TEXT_FMT = '@';
const REQUIRED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const REQUIRED_HDR_FONT = { bold: true, color: { argb: 'FF1A365D' } };
const TEMPLATE_ROWS = 3;
const REQ_GROUP_COLS = [1, 2, 3, 8];
const REQ_EQUIP_COLS = [1, 2, 3, 4];
const REQ_JOB_COLS = [1, 2, 3, 4, 7, 8, 9];
const HDR_ROW = 5;
const DATA_START = 6;

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

function norm(s) { return String(s ?? '').replace(/\s+/g, ' ').trim(); }
function padGroupNo(n) {
    const d = parseInt(String(n).replace(/\D/g, ''), 10);
    return Number.isFinite(d) ? String(d).padStart(2, '0') : String(n || '').trim();
}
function buildGroupLabel(no, name) {
    const n = padGroupNo(no);
    const nm = norm(name);
    return n && nm ? `${n}. ${nm}` : norm(name);
}
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
function resolveGroup(dept, groupLabel) {
    const d = String(dept || '').trim().toUpperCase();
    if (d === 'DECK') {
        const leg = legacyGroupNum(groupLabel);
        const hit = leg != null ? DECK_LEGACY_MAP.get(leg) : null;
        if (hit) return { no: hit.no, name: hit.name, label: buildGroupLabel(hit.no, hit.name) };
    }
    return splitGroupLabel(groupLabel);
}
function criticalDisplay(j) {
    if (j.is_critical_equipment === true) return '⚠';
    if (j.is_critical_equipment === false) return '';
    return norm(j.sort).toUpperCase().includes('CRITICAL') ? '⚠' : '';
}
function renumberJobsForExport(jobs) {
    const engine = [];
    const deckBuckets = new Map();
    for (const j of jobs) {
        const dept = String(j.department || 'ENGINE').toUpperCase();
        const g = resolveGroup(dept, j.group);
        const normalized = { ...j, group: g.label };
        if (dept !== 'DECK') { engine.push(normalized); continue; }
        const key = `${g.no}|${g.label}`;
        if (!deckBuckets.has(key)) deckBuckets.set(key, []);
        deckBuckets.get(key).push(normalized);
    }
    const deckOut = [];
    for (const [, list] of deckBuckets) {
        list.sort((a, b) => String(a.job_code || '').localeCompare(String(b.job_code || ''), undefined, { numeric: true }));
        const g = splitGroupLabel(list[0].group);
        list.forEach((j, i) => deckOut.push({ ...j, job_code: `${g.no}-${String(i + 1).padStart(3, '0')}` }));
    }
    return [...engine, ...deckOut].sort((a, b) => {
        if (a.department !== b.department) return String(a.department).localeCompare(String(b.department));
        return String(a.job_code || '').localeCompare(String(b.job_code || ''), undefined, { numeric: true });
    });
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
function markRequiredCell(cell) { cell.fill = REQUIRED_FILL; }
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
function applySheetTextStyle(ws) {
    ws.eachRow({ includeEmpty: false }, row => {
        row.eachCell({ includeEmpty: false }, cell => {
            const v = cell.value;
            if (v instanceof Date) cell.value = v.toISOString().slice(0, 10);
            else if (v != null && typeof v === 'object') {
                if (v.richText) cell.value = v.richText.map(t => t.text).join('');
                else if (v.result != null && v.formula == null) cell.value = String(v.result);
            } else if (v != null && typeof v !== 'string') cell.value = String(v);
            cell.numFmt = TEXT_FMT;
            cell.alignment = { ...CELL_ALIGN };
        });
    });
}

const EQUIPMENT_SAMPLES = [
    { department: 'ENGINE', no: '01', name: 'MAIN ENGINE', item: 'CYL. OIL LUBRICATOR', critical: 'No', maker: '(example maker)', model: '(example model)', serial: '(example serial)' },
    { department: 'ENGINE', no: '08', name: 'PUMP / MOTOR', item: 'MOTORS', critical: 'No', maker: '(common motor spec)', model: '', serial: '' },
    { department: 'ENGINE', no: '08', name: 'PUMP / MOTOR', item: 'TURNING GEAR MOTOR', critical: 'Yes', maker: '(enter maker)', model: '(enter model)', serial: '(enter serial)' },
    { department: 'ENGINE', no: '08', name: 'PUMP / MOTOR', item: 'No.1 AUX. BLOWER MOTOR', critical: 'No', maker: '', model: '', serial: '' },
    { department: 'ENGINE', no: '08', name: 'PUMP / MOTOR', item: 'No.2 AUX. BLOWER MOTOR', critical: 'No', maker: '', model: '', serial: '' },
];

async function main() {
    const data = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
    const jobs = renumberJobsForExport(data.maintenance_jobs || []);
    const vesselId = data.meta?.vessel_id || 'INCHEON CHEMI';

    const groupCounts = new Map();
    jobs.forEach(j => {
        const g = resolveGroup(j.department, j.group);
        const k = `${j.department}|${g.no}|${g.name}`;
        groupCounts.set(k, (groupCounts.get(k) || 0) + 1);
    });
    const groupRows = [...groupCounts.entries()].map(([k, count]) => {
        const [department, no, ...rest] = k.split('|');
        return { department, no, name: rest.join('|'), count };
    }).sort((a, b) => a.department.localeCompare(b.department) || a.no.localeCompare(b.no, undefined, { numeric: true }));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'TVC-PMS';

    const wsG = wb.addWorksheet('Group Headers', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
    addMetaRows(wsG, [
        `Vessel: ${vesselId}  ·  PMS Master — Group Headers`,
        'GROUP NO + GROUP NAME per department (each dept starts 01).',
    ]);
    ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'Maker', 'Model/Type', 'Capacity', 'Serial No.', 'Jobs (ref)'].forEach((h, i) => {
        wsG.getRow(HDR_ROW).getCell(i + 1).value = h;
    });
    styleHeaderRow(wsG.getRow(HDR_ROW), NAVY, REQ_GROUP_COLS);
    groupRows.forEach((gr, idx) => {
        const r = wsG.getRow(DATA_START + idx);
        r.getCell(1).value = gr.department;
        r.getCell(2).value = gr.no;
        r.getCell(3).value = gr.name;
        r.getCell(8).value = gr.count;
        if (gr.department === 'ENGINE' && gr.no === '01') {
            r.getCell(4).value = 'MAN B&W';
            r.getCell(5).value = '6S50ME-C';
            r.getCell(6).value = '6220 kW';
        }
    });

    const wsE = wb.addWorksheet('Equipment Headers', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
    addMetaRows(wsE, [
        `Vessel: ${vesselId}  ·  Optional item_sort1 overrides (sparse)`,
        'Add rows only where group header is not enough.',
    ]);
    ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'ITEM (SORT-1)', 'Maker', 'Model/Type', 'Capacity', 'Serial No.'].forEach((h, i) => {
        wsE.getRow(HDR_ROW).getCell(i + 1).value = h;
    });
    styleHeaderRow(wsE.getRow(HDR_ROW), GREEN, REQ_EQUIP_COLS);
    EQUIPMENT_SAMPLES.forEach((eq, idx) => {
        const r = wsE.getRow(DATA_START + idx);
        r.getCell(1).value = eq.department;
        r.getCell(2).value = eq.no;
        r.getCell(3).value = eq.name;
        r.getCell(4).value = eq.item;
        r.getCell(5).value = eq.maker;
        r.getCell(6).value = eq.model;
        r.getCell(8).value = eq.serial;
    });

    const wsJ = wb.addWorksheet('Jobs', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
    addMetaRows(wsJ, [
        `Vessel: ${vesselId}  ·  ${jobs.length} jobs`,
        'Import matches jobs by DEPARTMENT + JOB CODE. DECK codes renumbered 01-001… per group.',
    ], 2);
    ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'JOB CODE', 'SORT-1', 'SORT-2', 'JOB DETAIL', 'PERIOD', 'UNIT', 'P.I.C', 'LAST DONE'].forEach((h, i) => {
        wsJ.getRow(HDR_ROW).getCell(i + 1).value = h;
    });
    styleHeaderRow(wsJ.getRow(HDR_ROW), NAVY, REQ_JOB_COLS);

    jobs.forEach((j, idx) => {
        const g = resolveGroup(j.department, j.group);
        const r = wsJ.getRow(DATA_START + idx);
        r.getCell(1).value = j.department;
        r.getCell(2).value = g.no;
        r.getCell(3).value = g.name;
        r.getCell(4).value = j.job_code;
        r.getCell(5).value = norm(j.item_sort1);
        r.getCell(6).value = norm(j.item_sort2);
        r.getCell(7).value = j.job_detail || '';
        r.getCell(8).value = j.period != null ? Number(j.period) : '';
        r.getCell(9).value = (j.unit || 'M').toUpperCase();
        r.getCell(10).value = j.pic || '';
        if (j.last_done) r.getCell(11).value = j.last_done;
    });

    applyRequiredDataFill(wsG, REQ_GROUP_COLS, groupRows.length);
    appendRequiredTemplateRows(wsG, REQ_GROUP_COLS);
    applyRequiredDataFill(wsE, REQ_EQUIP_COLS, EQUIPMENT_SAMPLES.length);
    appendRequiredTemplateRows(wsE, REQ_EQUIP_COLS);
    applyRequiredDataFill(wsJ, REQ_JOB_COLS, jobs.length);
    appendRequiredTemplateRows(wsJ, REQ_JOB_COLS);

    [wsG, wsE, wsJ].forEach(applySheetTextStyle);

    await wb.xlsx.writeFile(OUT_PATH);
    console.log(`Written: ${OUT_PATH}`);
    console.log(`  Groups: ${groupRows.length}, Jobs: ${jobs.length}, Equipment samples: ${EQUIPMENT_SAMPLES.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
