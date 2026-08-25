/**
 * Generate TVC-PMS Data Export / Import filename reference Excel.
 * Run: node scripts/gen-data-export-filename-reference.mjs
 */
import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'data', 'TVC-Data-Export-Import-Filename-Reference.xlsx');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const WRAP = { wrapText: true, vertical: 'top' };

function styleHeaderRow(row) {
    row.eachCell(cell => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { ...WRAP, horizontal: 'center' };
    });
    row.height = 22;
}

function addSheet(wb, name, columns, rows) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }));
    styleHeaderRow(ws.getRow(1));
    rows.forEach(r => {
        const row = ws.addRow(r);
        row.alignment = WRAP;
    });
    ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + columns.length)}1` };
    return ws;
}

const pmsCaseNote = 'W/M/D/P/C 모두 Case Report ZIP 1개 (개별 defect/wp/postpone ZIP 없음 — Menu C 기준)';
const deptEngine = 'engine';
const deptDeck = 'deck';
const deptEngineHq = 'engine_hq';
const deptDeckHq = 'deck_hq';

const pmsRows = (dept, deptLabel, station) => [
    { system: 'PMS', flow: `${deptLabel} → Master`, leg: '1', exportMode: station, exportMenu: 'Case Report', filename: `{vessel}_casereport_${dept}_{date}_{seq}.zip`, direction: 'STATION_TO_HUB', importMaster: 'O', importHq: '-', importEngine: '-', importDeck: '-', reExport: 'X (1회, sync_status=SYNCED)', note: pmsCaseNote },
    { system: 'PMS', flow: `${deptLabel} → Master`, leg: '1', exportMode: station, exportMenu: 'Monthly Report', filename: `{vessel}_monthly_${dept}_{date}_{seq}.zip`, direction: 'STATION_TO_HUB', importMaster: 'O', importHq: '-', importEngine: '-', importDeck: '-', reExport: 'O (새 seq)', note: '' },
    { system: 'PMS', flow: `${deptLabel} → Master → HQ`, leg: '2', exportMode: 'Master', exportMenu: 'Case Report', filename: `{vessel}_casereport_${dept}_{date}_{seq}.zip`, direction: 'SHIP_TO_HQ', importMaster: '-', importHq: 'O', importEngine: '-', importDeck: '-', reExport: 'X (Hub leg 1회)', note: pmsCaseNote },
    { system: 'PMS', flow: `${deptLabel} → Master → HQ`, leg: '2', exportMode: 'Master', exportMenu: 'Monthly Report', filename: `{vessel}_monthly_${dept}_{date}_{seq}.zip`, direction: 'SHIP_TO_HQ', importMaster: '-', importHq: 'O', importEngine: '-', importDeck: '-', reExport: 'O', note: '' },
    { system: 'PMS', flow: `HQ → ${deptLabel}`, leg: '3', exportMode: 'HQ', exportMenu: 'Case Report Reply', filename: `{vessel}_casereport_${dept}_hq_{date}_{seq}.zip`, direction: 'HQ_TO_SHIP', importMaster: 'O', importHq: '-', importEngine: dept === 'engine' ? 'O*' : '-', importDeck: dept === 'deck' ? 'O*' : '-', reExport: 'X', note: pmsCaseNote + `; *${deptLabel} Mode만` },
    { system: 'PMS', flow: `HQ → ${deptLabel}`, leg: '3', exportMode: 'HQ', exportMenu: 'Monthly Report Reply', filename: `{vessel}_monthly_${dept}_hq_{date}_{seq}.zip`, direction: 'HQ_TO_SHIP', importMaster: 'O', importHq: '-', importEngine: dept === 'engine' ? 'O*' : '-', importDeck: dept === 'deck' ? 'O*' : '-', reExport: 'O', note: `*${deptLabel} Mode만` },
    { system: 'PMS', flow: `HQ → Master → ${deptLabel}`, leg: '4', exportMode: 'Master', exportMenu: 'Case/Monthly Reply (relay)', filename: `{vessel}_*_${dept}_hq_{date}_{seq}.zip`, direction: 'HQ_TO_SHIP', importMaster: '-', importHq: '-', importEngine: dept === 'engine' ? 'O*' : '-', importDeck: dept === 'deck' ? 'O*' : '-', reExport: '-', note: 'Master HQ Reply import 후 Station 중계' },
];

const spareRows = (dept, deptLabel, station) => [
    { system: 'SPARE', flow: `${deptLabel} → Master`, leg: '1', exportMode: station, exportMenu: 'Requisition', filename: `{vessel}_requisition_${dept}_{date}_{seq}.zip`, direction: 'SPARE_EXPORT', importMaster: 'O', importHq: '-', importEngine: '-', importDeck: '-', reExport: 'X', note: '' },
    { system: 'SPARE', flow: `${deptLabel} → Master`, leg: '1', exportMode: station, exportMenu: 'Received', filename: `{vessel}_received_${dept}_{date}_{seq}.zip`, direction: 'SPARE_EXPORT', importMaster: 'O', importHq: '-', importEngine: '-', importDeck: '-', reExport: '-', note: '' },
    { system: 'SPARE', flow: `${deptLabel} → Master`, leg: '1', exportMode: station, exportMenu: 'Monthly Report', filename: `{vessel}_spare_monthly_${dept}_{date}_{seq}.zip`, direction: 'SPARE_EXPORT', importMaster: 'O', importHq: '-', importEngine: '-', importDeck: '-', reExport: 'O', note: '' },
    { system: 'SPARE', flow: `${deptLabel} → Master → HQ`, leg: '2', exportMode: 'Master', exportMenu: 'Requisition (relay)', filename: `{vessel}_requisition_${dept}_{date}_{seq}.zip`, direction: 'SPARE_EXPORT', importMaster: '-', importHq: 'O', importEngine: '-', importDeck: '-', reExport: 'X', note: 'Import 후 Export' },
    { system: 'SPARE', flow: `${deptLabel} → Master → HQ`, leg: '2', exportMode: 'Master', exportMenu: 'Monthly Report (relay)', filename: `{vessel}_spare_monthly_${dept}_{date}_{seq}.zip`, direction: 'SPARE_EXPORT', importMaster: '-', importHq: 'O', importEngine: '-', importDeck: '-', reExport: 'O', note: '_hq_ suffix 없음' },
    { system: 'SPARE', flow: `HQ → ${deptLabel}`, leg: '3', exportMode: 'HQ', exportMenu: 'Quotation', filename: `{vessel}_quotation_${dept}_hq_{date}_{seq}.zip`, direction: 'SPARE_EXPORT', importMaster: 'O', importHq: '-', importEngine: dept === 'engine' ? 'O*' : '-', importDeck: dept === 'deck' ? 'O*' : '-', reExport: 'X', note: '' },
    { system: 'SPARE', flow: `HQ → ${deptLabel}`, leg: '3', exportMode: 'HQ', exportMenu: 'Order', filename: `{vessel}_order_${dept}_hq_{date}_{seq}.zip`, direction: 'SPARE_EXPORT', importMaster: 'O', importHq: '-', importEngine: dept === 'engine' ? 'O*' : '-', importDeck: dept === 'deck' ? 'O*' : '-', reExport: 'X', note: '' },
    { system: 'SPARE', flow: `HQ → ${deptLabel}`, leg: '3', exportMode: 'HQ', exportMenu: 'Monthly Report', filename: `{vessel}_spare_monthly_${dept}_hq_{date}_{seq}.zip`, direction: 'SPARE_EXPORT', importMaster: 'O', importHq: '-', importEngine: dept === 'engine' ? 'O*' : '-', importDeck: dept === 'deck' ? 'O*' : '-', reExport: 'O', note: '' },
    { system: 'SPARE', flow: `Master → ${deptLabel}`, leg: '4', exportMode: 'Master', exportMenu: 'Monthly Report (relay to Station)', filename: `{vessel}_spare_monthly_${dept}_{date}_{seq}.zip`, direction: 'SPARE_EXPORT', importMaster: '-', importHq: '-', importEngine: dept === 'engine' ? 'O*' : '-', importDeck: dept === 'deck' ? 'O*' : '-', reExport: 'O', note: 'Import 후 relay Export' },
];

const masterExcelRows = [
    { system: 'PMS', flow: 'All modes', exportMode: 'Engine / Deck / Master / HQ', exportMenu: 'PMS Master Excel', filename: '{vessel}_pms_master_{engine|deck}_{date}_{seq}.xlsx', importMaster: 'O', importHq: 'O', importEngine: 'O*', importDeck: 'O*', reExport: 'O', note: '동일 vessel·dept. HQ도 _hq_ scope 없음' },
    { system: 'SPARE', flow: 'Engine / Deck', exportMode: 'Engine / Deck', exportMenu: 'SPARE Master Excel', filename: '{vessel}_spare_master_{engine|deck}_{date}_{seq}.xlsx', importMaster: 'O', importHq: 'O', importEngine: 'O*', importDeck: 'O*', reExport: 'O', note: '' },
    { system: 'SPARE', flow: 'Master Hub', exportMode: 'Master', exportMenu: 'SPARE Master Excel', filename: '{vessel}_spare_master_{engine|deck}_master_{date}_{seq}.xlsx', importMaster: 'O', importHq: 'O', importEngine: 'O*', importDeck: 'O*', reExport: 'O', note: '' },
    { system: 'SPARE', flow: 'HQ', exportMode: 'HQ', exportMenu: 'SPARE Master Excel', filename: '{vessel}_spare_master_{engine|deck}_hq_{date}_{seq}.xlsx', importMaster: 'O', importHq: 'O', importEngine: 'O*', importDeck: 'O*', reExport: 'O', note: '' },
];

const overviewRows = [
    { item: '파일명 패턴', value: '{vessel}_{type}_{scope}_{YYYYMMDD}_{seq}.zip|.xlsx' },
    { item: '{vessel}', value: '선박 ID 소문자·영숫자 (예: incheonshemi)' },
    { item: '{scope}', value: 'engine | deck | engine_hq | deck_hq | engine_master | deck_master' },
    { item: '{seq}', value: '001, 002… (sync_history 기준 자동 증가)' },
    { item: 'PMS Menu C Export', value: 'Case Report, Monthly Report 2종만' },
    { item: 'PMS Case Report', value: 'W/M/D/P/C 통합 ZIP — casereport (개별 ZIP 없음)' },
    { item: '업무 Flow', value: 'Engine/Deck → Master → HQ → (Master relay 또는 직송) → Engine/Deck' },
    { item: '부서 교차 Import', value: 'Engine ZIP ↔ Deck Mode 상호 Import 불가' },
    { item: 'Import 표기', value: 'O=가능, X=불가/1회제한, O*=해당 dept Mode만, -=해당 없음' },
    { item: '생성일', value: new Date().toISOString().slice(0, 10) },
    { item: '버전', value: '2026-08-25 (spare monthly scope: Master=engine/deck, HQ=engine_hq)' },
];

const exampleRows = [
    { line: 'PMS Engine', example: 'incheonshemi_casereport_engine_20260825_001.zip' },
    { line: 'PMS Engine Monthly', example: 'incheonshemi_monthly_engine_20260825_001.zip' },
    { line: 'PMS HQ Reply', example: 'incheonshemi_casereport_engine_hq_20260825_001.zip' },
    { line: 'PMS Deck', example: 'incheonshemi_casereport_deck_20260825_001.zip' },
    { line: 'SPARE Requisition', example: 'incheonshemi_requisition_engine_20260825_001.zip' },
    { line: 'SPARE HQ Order', example: 'incheonshemi_order_engine_hq_20260825_001.zip' },
    { line: 'SPARE Master Monthly relay', example: 'incheonshemi_spare_monthly_engine_20260825_001.zip' },
    { line: 'SPARE HQ Monthly', example: 'incheonshemi_spare_monthly_engine_hq_20260825_001.zip' },
    { line: 'PMS Master Excel', example: 'incheonshemi_pms_master_engine_20260825_001.xlsx' },
    { line: 'SPARE Master Excel (HQ)', example: 'incheonshemi_spare_master_engine_hq_20260825_001.xlsx' },
];

const cols = [
    { header: 'System', key: 'system', width: 8 },
    { header: 'Flow', key: 'flow', width: 28 },
    { header: 'Leg', key: 'leg', width: 6 },
    { header: 'Export Mode', key: 'exportMode', width: 14 },
    { header: 'Export Menu', key: 'exportMenu', width: 28 },
    { header: 'Filename Pattern', key: 'filename', width: 52 },
    { header: 'Direction', key: 'direction', width: 16 },
    { header: 'Import Master', key: 'importMaster', width: 12 },
    { header: 'Import HQ', key: 'importHq', width: 10 },
    { header: 'Import Engine', key: 'importEngine', width: 12 },
    { header: 'Import Deck', key: 'importDeck', width: 11 },
    { header: 'Re-export', key: 'reExport', width: 22 },
    { header: 'Note', key: 'note', width: 36 },
];

const wb = new ExcelJS.Workbook();
wb.creator = 'TVC-PMS';
wb.created = new Date();

addSheet(wb, 'Overview', [
    { header: 'Item', key: 'item', width: 22 },
    { header: 'Description', key: 'value', width: 80 },
], overviewRows);

addSheet(wb, 'PMS Engine Flow', cols, pmsRows(deptEngine, 'Engine', 'Engine (CE)'));
addSheet(wb, 'PMS Deck Flow', cols, pmsRows(deptDeck, 'Deck', 'Deck (CO)'));
addSheet(wb, 'SPARE Engine Flow', cols, spareRows(deptEngine, 'Engine', 'Engine (CE)'));
addSheet(wb, 'SPARE Deck Flow', cols, spareRows(deptDeck, 'Deck', 'Deck (CO)'));

addSheet(wb, 'Master Excel', [
    { header: 'System', key: 'system', width: 8 },
    { header: 'Flow', key: 'flow', width: 18 },
    { header: 'Export Mode', key: 'exportMode', width: 28 },
    { header: 'Export Menu', key: 'exportMenu', width: 22 },
    { header: 'Filename Pattern', key: 'filename', width: 52 },
    { header: 'Import Master', key: 'importMaster', width: 12 },
    { header: 'Import HQ', key: 'importHq', width: 10 },
    { header: 'Import Engine', key: 'importEngine', width: 12 },
    { header: 'Import Deck', key: 'importDeck', width: 11 },
    { header: 'Re-export', key: 'reExport', width: 10 },
    { header: 'Note', key: 'note', width: 40 },
], masterExcelRows);

addSheet(wb, 'Examples', [
    { header: 'Line', key: 'line', width: 28 },
    { header: 'Example Filename', key: 'example', width: 55 },
], exampleRows);

await wb.xlsx.writeFile(outPath);
console.log('Written:', outPath);
