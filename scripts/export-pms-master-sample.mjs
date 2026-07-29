/**
 * INCHEON CHEMI — PMS Master Excel sample generator (CLI)
 * Matches TVC-PMS V.1 format: Group NO/NAME · ⚠ · hidden JOB_ID
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
function styleHeaderRow(row, fillArgb) {
    row.eachCell(cell => {
        cell.font = HDR_FONT;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
        cell.alignment = { vertical: 'middle', wrapText: true };
    });
    row.height = 22;
}
function addMetaRows(ws, lines, colSpan = 9) {
    lines.forEach((text, i) => {
        const r = ws.getRow(i + 1);
        r.getCell(1).value = text;
        r.getCell(1).font = { italic: true, color: { argb: 'FF4A5568' }, size: 10 };
        ws.mergeCells(i + 1, 1, i + 1, colSpan);
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
    ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'Critical Equipment', 'Maker', 'Model/Type', 'Capacity', 'Serial No.', 'Jobs (ref)'].forEach((h, i) => {
        wsG.getRow(HDR_ROW).getCell(i + 1).value = h;
    });
    styleHeaderRow(wsG.getRow(HDR_ROW), NAVY);
    groupRows.forEach((gr, idx) => {
        const r = wsG.getRow(DATA_START + idx);
        r.getCell(1).value = gr.department;
        r.getCell(2).value = gr.no;
        r.getCell(3).value = gr.name;
        r.getCell(9).value = gr.count;
        if (gr.department === 'ENGINE' && gr.no === '01') {
            r.getCell(4).value = 'Yes';
            r.getCell(5).value = 'MAN B&W';
            r.getCell(6).value = '6S50ME-C';
            r.getCell(7).value = '6220 kW';
        }
    });

    const wsE = wb.addWorksheet('Equipment Headers', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
    addMetaRows(wsE, [
        `Vessel: ${vesselId}  ·  Optional item_sort1 overrides (sparse)`,
        'Add rows only where group header is not enough.',
    ]);
    ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'ITEM (SORT-1)', 'Critical Equipment', 'Maker', 'Model/Type', 'Capacity', 'Serial No.'].forEach((h, i) => {
        wsE.getRow(HDR_ROW).getCell(i + 1).value = h;
    });
    styleHeaderRow(wsE.getRow(HDR_ROW), GREEN);
    EQUIPMENT_SAMPLES.forEach((eq, idx) => {
        const r = wsE.getRow(DATA_START + idx);
        r.getCell(1).value = eq.department;
        r.getCell(2).value = eq.no;
        r.getCell(3).value = eq.name;
        r.getCell(4).value = eq.item;
        r.getCell(5).value = eq.critical;
        r.getCell(6).value = eq.maker;
        r.getCell(7).value = eq.model;
        r.getCell(9).value = eq.serial;
    });

    const wsJ = wb.addWorksheet('Jobs', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
    addMetaRows(wsJ, [
        `Vessel: ${vesselId}  ·  ${jobs.length} jobs`,
        'JOB_ID column hidden (export only). DECK codes renumbered 01-001… per group.',
    ], 14);
    ['JOB_ID', 'DEPARTMENT', 'GROUP NO', 'GROUP NAME', '⚠', 'JOB CODE', 'SORT-1', 'SORT-2', 'JOB DETAIL', 'PERIOD', 'UNIT', 'P.I.C', 'NEXT DATE', 'LAST DONE'].forEach((h, i) => {
        wsJ.getRow(HDR_ROW).getCell(i + 1).value = h;
    });
    styleHeaderRow(wsJ.getRow(HDR_ROW), NAVY);
    wsJ.getColumn(1).hidden = true;

    jobs.forEach((j, idx) => {
        const g = resolveGroup(j.department, j.group);
        const r = wsJ.getRow(DATA_START + idx);
        r.getCell(1).value = j.id || '';
        r.getCell(2).value = j.department;
        r.getCell(3).value = g.no;
        r.getCell(4).value = g.name;
        r.getCell(5).value = criticalDisplay(j);
        r.getCell(6).value = j.job_code;
        r.getCell(7).value = norm(j.item_sort1);
        r.getCell(8).value = norm(j.item_sort2);
        r.getCell(9).value = j.job_detail || '';
        r.getCell(10).value = j.period != null ? Number(j.period) : '';
        r.getCell(11).value = (j.unit || 'M').toUpperCase();
        r.getCell(12).value = j.pic || '';
        if (j.next_date) r.getCell(13).value = j.next_date;
        if (j.last_done) r.getCell(14).value = j.last_done;
    });

    await wb.xlsx.writeFile(OUT_PATH);
    console.log(`Written: ${OUT_PATH}`);
    console.log(`  Groups: ${groupRows.length}, Jobs: ${jobs.length}, Equipment samples: ${EQUIPMENT_SAMPLES.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
