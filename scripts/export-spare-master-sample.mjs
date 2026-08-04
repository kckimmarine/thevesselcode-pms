/**
 * INCHEON CHEMI — SPARE Master Excel sample generator (CLI)
 * Matches TVC-PMS SPARE Master format: Group · Equipment · Spare Parts
 *
 * Usage: npm run export-spare-master-sample
 */
import ExcelJS from 'exceljs';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SEED_PATH = path.join(ROOT, 'data', 'pms-unified.json');
const OUT_PATH = path.join(ROOT, 'data', 'INCHEON CHEMI_SPARE_MASTER_SAMPLE.xlsx');

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
    return n && nm ? `${n}. ${nm}` : norm(name) || '';
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
const SPARE_GEN_ENGINE_NO = '03';
const SPARE_GEN_ENGINE_NAME = 'GENERATOR ENGINE';
const SPARE_GEN_ENGINE_LABEL = '03. GENERATOR ENGINE';
function isSpareGenEngineGroup(label) {
    const s = norm(label);
    if (/^03\s*~\s*05/i.test(s) && /GENERATOR\s+ENGINE/i.test(s)) return true;
    if (s === norm(SPARE_GEN_ENGINE_LABEL)) return true;
    const m = s.match(/^(\d{1,2})\./);
    if (!m) return false;
    const n = parseInt(m[1], 10);
    if (n < 3 || n > 5) return false;
    return /GENERATOR\s+ENGINE/i.test(s);
}
function resolveSpareMasterGroup(dept, groupLabel) {
    if (isSpareGenEngineGroup(groupLabel)) {
        return { no: SPARE_GEN_ENGINE_NO, name: SPARE_GEN_ENGINE_NAME, label: SPARE_GEN_ENGINE_LABEL };
    }
    return resolveGroup(dept, groupLabel);
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

function spareNumbering(s) {
    return s.inventory_numbering || s.part_no || '';
}

function spareDepartment(s, groupNodes) {
    const cat = String(s.category || '').trim().toUpperCase();
    if (cat === 'ENGINE' || cat === 'DECK') return cat;
    const label = String(s.group || '').trim();
    if (label && groupNodes) {
        const node = groupNodes.find(n => norm(n.label) === norm(label));
        if (node?.department) return node.department;
    }
    return 'ENGINE';
}

function buildGroupNodes(groups) {
    const seen = new Map();
    (groups || []).filter(g => !g.item_sort1).forEach(g => {
        if (!g.label || !g.department) return;
        seen.set(`${g.department}|${g.label}`, { label: g.label, department: g.department });
    });
    return [...seen.values()];
}

async function main() {
    const data = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
    const spares = data.spare_parts || [];
    const groups = data.maintenance_groups || [];
    const vesselId = data.meta?.vessel_id || 'INCHEON CHEMI';
    const groupNodes = buildGroupNodes(groups);

    const groupCounts = new Map();
    spares.forEach(s => {
        const dept = spareDepartment(s, groupNodes);
        const raw = String(s.group || '').trim();
        if (!raw) return;
        const g = resolveSpareMasterGroup(dept, raw);
        if (!g.no || !g.name) return;
        const k = `${dept}|${g.no}|${g.name}`;
        groupCounts.set(k, (groupCounts.get(k) || 0) + 1);
    });
    (groups || []).forEach(g => {
        if (g.item_sort1) return;
        if (isSpareGenEngineGroup(g.label)) return;
        const sg = splitGroupLabel(g.label);
        if (!sg.no || !sg.name || !g.department) return;
        const k = `${g.department}|${sg.no}|${sg.name}`;
        if (!groupCounts.has(k)) groupCounts.set(k, 0);
    });

    const groupRows = [...groupCounts.entries()].map(([k, count]) => {
        const [department, no, ...rest] = k.split('|');
        return { department, no, name: rest.join('|'), count };
    }).sort((a, b) => a.department.localeCompare(b.department) || a.no.localeCompare(b.no, undefined, { numeric: true }));

    const groupMeta = new Map();
    groups.filter(g => !g.item_sort1).forEach(g => {
        const sg = splitGroupLabel(g.label);
        groupMeta.set(`${g.department}|${sg.no}|${sg.name}`, g);
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'TVC-PMS';

    const wsG = wb.addWorksheet('Group Headers', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
    addMetaRows(wsG, [
        `Vessel: ${vesselId}  ·  SPARE Master — Group Headers`,
        'PMS: 03/04/05 Generator Engine separate · SPARE: consolidated as 03 GENERATOR ENGINE.',
    ], 9);
    ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'Critical Equipment', 'Maker', 'Model/Type', 'Capacity', 'Serial No.', 'Parts (ref)'].forEach((h, i) => {
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

    const wsE = wb.addWorksheet('Equipment Headers', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
    addMetaRows(wsE, [
        `Vessel: ${vesselId}  ·  Optional item_sort1 overrides (sparse)`,
        'Add rows only where group header is not enough.',
    ], 9);
    ['DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'ITEM (SORT-1)', 'Critical Equipment', 'Maker', 'Model/Type', 'Capacity', 'Serial No.'].forEach((h, i) => {
        wsE.getRow(HDR_ROW).getCell(i + 1).value = h;
    });
    styleHeaderRow(wsE.getRow(HDR_ROW), GREEN);
    let eqRow = 0;
    groups.filter(g => norm(g.item_sort1)).forEach(g => {
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

    const exportSpares = spares.slice(0, 500);
    const wsP = wb.addWorksheet('Spare Parts', { views: [{ state: 'frozen', ySplit: HDR_ROW }] });
    addMetaRows(wsP, [
        `Vessel: ${vesselId}  ·  ${exportSpares.length} spare parts (sample capped at 500)`,
        'SPARE_ID hidden. Edit GROUP NO/NAME, names, Work/Std/Rob. New parts: leave SPARE_ID empty.',
    ], 13);
    const pHeaders = ['SPARE_ID', 'DEPARTMENT', 'GROUP NO', 'GROUP NAME', 'Code', 'Class', 'Dwg No.', 'Part No.', 'Items', 'Unit', 'Work', 'Std', 'Rob'];
    pHeaders.forEach((h, i) => { wsP.getRow(HDR_ROW).getCell(i + 1).value = h; });
    styleHeaderRow(wsP.getRow(HDR_ROW), NAVY);
    wsP.getColumn(1).hidden = true;

    exportSpares.forEach((s, idx) => {
        const dept = spareDepartment(s, groupNodes);
        const raw = String(s.group || '').trim();
        const g = raw ? resolveSpareMasterGroup(dept, raw) : { no: '', name: '' };
        const r = wsP.getRow(DATA_START + idx);
        r.getCell(1).value = s.id || '';
        r.getCell(2).value = dept;
        r.getCell(3).value = g.no;
        r.getCell(4).value = g.name;
        r.getCell(5).value = spareNumbering(s);
        r.getCell(6).value = String(s.part_class || '').toUpperCase() === 'L' ? 'L' : (String(s.part_class || '').toUpperCase() === 'G' ? 'G' : '');
        r.getCell(7).value = s.drawing_part_no || '';
        r.getCell(8).value = s.part_no || '';
        r.getCell(9).value = s.name || '';
        r.getCell(10).value = (s.unit || 'EA').toUpperCase();
        r.getCell(11).value = Number(s.qty_working) || 0;
        r.getCell(12).value = Number(s.standard_stock ?? s.min_qty) || 0;
        r.getCell(13).value = Number(s.qty_on_hand) || 0;
    });

    await wb.xlsx.writeFile(OUT_PATH);
    console.log(`Written: ${OUT_PATH}`);
    console.log(`  Groups: ${groupRows.length}, Spare parts: ${exportSpares.length}, Equipment: ${eqRow}`);
}

main().catch(err => { console.error(err); process.exit(1); });
