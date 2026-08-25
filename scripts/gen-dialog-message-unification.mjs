/**
 * Generate dialog message unification reference (Korean→English, permission, awkward EN).
 * Run: node scripts/gen-dialog-message-unification.mjs
 */
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');
const OUT = path.join(ROOT, 'data', 'TVC-Dialog-Message-Unification.xlsx');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const WRAP = { wrapText: true, vertical: 'top' };
const PROPOSED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };

function styleHeaderRow(row) {
    row.eachCell(cell => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { ...WRAP, horizontal: 'center' };
    });
    row.height = 22;
}

function addSheet(wb, name, columns, rows, highlightKey) {
    const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }));
    styleHeaderRow(ws.getRow(1));
    rows.forEach(r => {
        const row = ws.addRow(r);
        row.alignment = WRAP;
        if (highlightKey && r[highlightKey]) {
            row.getCell(highlightKey).fill = PROPOSED_FILL;
        }
    });
    if (columns.length <= 26) {
        ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + columns.length)}1` };
    }
    return ws;
}

function walk(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, out);
        else if (ent.name.endsWith('.js')) out.push(p);
    }
    return out;
}

function lineOf(text, index) {
    return text.slice(0, index).split('\n').length;
}

/** Confirmed Korean strings shown via TVC_Dialog (helper / validation). */
const KOREAN_DIALOG_DIRECT = [
    {
        priority: 'P1',
        category: 'Permission',
        current: 'Captain / Chief Engineer만 Work Procedure를 수정할 수 있습니다.',
        proposed: 'Only Captain or Chief Engineer can edit the Work Procedure.',
        file: 'js/app.js',
        function: 'workProcedureEditDeniedMessage()',
        callSites: 'TVC_Dialog.alert(workProcedureEditDeniedMessage()) ×2',
        modes: 'Engine / Master',
    },
    {
        priority: 'P1',
        category: 'Permission',
        current: 'Work Procedure를 편집할 수 없습니다.',
        proposed: 'You do not have permission to edit the Work Procedure.',
        file: 'js/app.js',
        function: 'workProcedureEditDeniedMessage()',
        callSites: 'TVC_Dialog.alert(workProcedureEditDeniedMessage()) ×2',
        modes: 'All vessel',
    },
    {
        priority: 'P1',
        category: 'Permission',
        current: 'Chief Engineer / Captain 권한이 필요합니다.',
        proposed: 'Chief Engineer or Captain permission required.',
        file: 'js/ui/spareMenu.js',
        function: 'spareItemNoteEditDeniedMessage()',
        callSites: 'TVC_Dialog.alert(spareItemNoteEditDeniedMessage()) ×2',
        modes: 'SPARE Note edit',
    },
    {
        priority: 'P1',
        category: 'Validation',
        current: 'Received Date를 입력하세요.',
        proposed: 'Enter Received Date.',
        file: 'js/ui/spareMenu.js',
        function: 'validateReceiveSave()',
        callSites: 'TVC_Dialog.alert(err) in saveReceive / saveReceiveProceed',
        modes: 'SPARE Received',
    },
    {
        priority: 'P1',
        category: 'Validation',
        current: 'Received Port를 입력하세요.',
        proposed: 'Enter Received Port.',
        file: 'js/ui/spareMenu.js',
        function: 'validateReceiveSave()',
        callSites: 'TVC_Dialog.alert(err) in saveReceive / saveReceiveProceed',
        modes: 'SPARE Received',
    },
    {
        priority: 'P2',
        category: 'Native prompt (not TVC_Dialog)',
        current: 'JOB CODE에 "{part}" 할당\\n\\nJob Code:',
        proposed: 'Assign "{part}" to a JOB CODE\\n\\nJob Code:',
        file: 'js/ui/spareMenu.js',
        function: 'prompt() at BOM link',
        callSites: 'window.prompt() — consider TVC_Dialog.promptText',
        modes: 'SPARE',
    },
];

/** Korean throw / message in services — may surface via TVC_Dialog.alert(e.message). */
const KOREAN_THROW_PROPOSALS = [
    ['js/services/sync.js', '부서 불일치: 선택한 부서({dept})와 파일의 부서({fileDept})가 다릅니다.', 'Department mismatch: selected department ({dept}) does not match the file ({fileDept}).'],
    ['js/services/sync.js', '방향 불일치: 기대 {directionHint}, 파일 {fileDirection}', 'Direction mismatch: expected {directionHint}, file has {fileDirection}.'],
    ['js/services/sync.js', 'ZIP에 유효한 vessel_id가 없습니다. 올바른 선박 Export 파일인지 확인하세요.', 'ZIP has no valid vessel_id. Check that this is a correct vessel export file.'],
    ['js/services/sync.js', '선박 ID 불일치: 이 ZIP은 "{got}" 선박 데이터입니다. …', 'Vessel ID mismatch: this ZIP is for vessel "{got}". Import stopped to prevent data corruption.'],
    ['js/services/spareMasterExcel.js', 'SPARE Master Import는 Chief Engineer, Chief Officer, Captain(Master), 또는 HQ Superintendent만 사용할 수 있습니다.', 'SPARE Master Import requires Chief Engineer, Chief Officer, Captain (Master), or HQ Superintendent.'],
    ['js/services/vesselProfileSync.js', 'Vessel Profile Export는 HQ Mode에서만 가능합니다.', 'Vessel Profile Export is available in HQ Mode only.'],
    ['js/services/vesselProfileSync.js', 'JSZip이 로드되지 않았습니다.', 'JSZip is not loaded. Please refresh the page.'],
    ['js/services/vesselProfileSync.js', '파일이 없습니다.', 'No file selected.'],
    ['js/services/vesselProfileSync.js', 'ZIP에 tvc_vessel_profile.json이 없습니다.', 'ZIP does not contain tvc_vessel_profile.json.'],
    ['js/services/vesselProfileSync.js', 'Vessel Profile 파일이 아닙니다.', 'This is not a Vessel Profile file.'],
    ['js/services/vesselProfileSync.js', 'Vessel Profile에 vessel_id가 없습니다.', 'Vessel Profile has no vessel_id.'],
    ['js/app.js', 'Vessel Profile Import는 선박 Mode에서만 가능합니다.', 'Vessel Profile Import is available in vessel mode only.'],
    ['js/services/appUpdate.js', 'App Update Export는 Admin Mode(tvc)에서만 가능합니다.', 'App Update Export is available in Admin Mode (tvc) only.'],
    ['js/services/defectCase.js', '목록에 저장된 Report만 Confirm할 수 있습니다.', 'Only saved reports in the list can be confirmed.'],
    ['js/services/inventory.js', 'Part No / Name 은 필수입니다.', 'Part No and Name are required.'],
    ['js/services/inventory.js', 'Part No "{rec.part_no}" 는 이미 존재합니다.', 'Part No "{rec.part_no}" already exists.'],
    ['js/services/stationSync.js', '파일을 선택하세요.', 'Select a file.'],
    ['js/services/stationSync.js', '지원 형식: .zip, .json, .csv', 'Supported formats: .zip, .json, .csv'],
    ['js/services/stationSync.js', 'CSV에 데이터 행이 없습니다.', 'CSV has no data rows.'],
    ['js/auth.js', 'file:// 모드에서는 로그인할 수 없습니다. …', 'Sign-in is not available in file:// mode. Use the Electron app, START-TVC-PMS.bat, or npm start → http://localhost:3000.'],
    ['js/auth.js', '이 브라우저에서 비밀번호 검증을 사용할 수 없습니다. …', 'Password verification is not available in this browser. Use the latest Chrome or Edge.'],
    ['js/services/excel.js', 'ExcelJS 라이브러리가 로드되지 않았습니다.', 'ExcelJS library is not loaded. Please refresh the page (Ctrl+F5).'],
    ['js/services/excel.js', '시트를 찾을 수 없습니다.', 'Worksheet not found.'],
    ['js/services/excel.js', "'Part No' 열을 찾을 수 없습니다.", "Column 'Part No' not found."],
    ['js/core/db.js', '파일이 없습니다.', 'No file selected.'],
    ['js/core/db.js', '시트 "{sheetName}" 를 찾을 수 없습니다.', 'Worksheet "{sheetName}" not found.'],
    ['js/core/db.js', '지원 형식: .csv, .xls, .xlsx', 'Supported formats: .csv, .xls, .xlsx'],
    ['js/core/db.js', '파싱된 부품(SparePart) 행이 없습니다. …', 'No spare part rows parsed. Check the file format.'],
    ['js/core/db.js', 'CSV fetch 실패: {source}', 'CSV fetch failed: {source}'],
    ['js/core/db.js', '지원 source: CSV 문자열, URL, File, null(번들)', 'Supported source: CSV string, URL, File, or null (bundle).'],
    ['js/core/db.js', 'CSV에서 부품(SparePart) 행을 찾지 못했습니다. …', 'No spare part rows found in CSV. Check headers and format.'],
    ['js/core/db.js', 'SheetJS(XLSX)가 로드되지 않았습니다.', 'SheetJS (XLSX) is not loaded. Please refresh the page.'],
    ['js/core/db.js', 'XLS 파일을 찾을 수 없습니다: {url}', 'XLS file not found: {url}'],
    ['js/core/db.js', 'XLS에서 부품 행을 찾지 못했습니다.', 'No spare part rows found in XLS.'],
    ['js/space.js', 'Data Export & Import는 {who}만 수행할 수 있습니다.', 'Data Export & Import can only be performed by {who}.'],
];

/** Permission / auth unification — current variants → proposed standard. */
const PERMISSION_UNIFICATION = [
    {
        templateId: 'AUTH-01',
        useCase: 'Not signed in',
        currentVariants: 'Login required. | Sign in required.',
        proposedStandard: 'Sign in required.',
        replaceCount: '~6',
        notes: 'Unify on Sign in required. (auth.js already uses this)',
    },
    {
        templateId: 'AUTH-02',
        useCase: 'RBAC role blocked',
        currentVariants: 'Permission denied: {role}',
        proposedStandard: 'Permission denied: {role label}',
        replaceCount: '1',
        notes: 'Keep dynamic role label from TVC_RBAC.getRoleLabel',
    },
    {
        templateId: 'AUTH-03',
        useCase: 'Station scope denied',
        currentVariants: 'Station access denied',
        proposedStandard: 'Station access denied.',
        replaceCount: '1',
        notes: 'Add period for consistency',
    },
    {
        templateId: 'PERM-01',
        useCase: 'Generic action denied',
        currentVariants: 'No permission to {verb} {noun}. (×20+ variants)',
        proposedStandard: 'You do not have permission to {verb} {noun}.',
        replaceCount: '~25',
        notes: 'OR keep "No permission to …" but use consistently everywhere',
    },
    {
        templateId: 'PERM-02',
        useCase: 'Ship approver roles (confirm)',
        currentVariants: 'Chief Engineer / Captain permission required. | …Chief Engineer, Chief Officer, Captain, or Superintendent (HQ)…',
        proposedStandard: 'Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission required.',
        replaceCount: '~16',
        notes: 'Always include C/O for Deck; drop "(HQ)" parenthetical',
    },
    {
        templateId: 'PERM-03',
        useCase: 'PMS/SPARE master excel',
        currentVariants: 'PMS Master Export · Import requires Chief Engineer, Chief Officer, Captain (Master), or HQ Superintendent.',
        proposedStandard: 'Same (already good — use as master template)',
        replaceCount: '0',
        notes: 'Reference template for PERM-02',
    },
    {
        templateId: 'PERM-04',
        useCase: 'Modify / append / delete groups & jobs',
        currentVariants: 'Modify, Append, and Delete require Chief Engineer, Chief Officer, Captain, or Superintendent (HQ) permission.',
        proposedStandard: 'Modify, append, and delete require Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission.',
        replaceCount: '~5',
        notes: 'Lowercase append/delete in sentence; HQ Superintendent not Superintendent (HQ)',
    },
    {
        templateId: 'PERM-05',
        useCase: 'HQ-only feature',
        currentVariants: 'Approve is available in HQ mode only. | …HQ Mode only.',
        proposedStandard: 'This action is available in HQ Mode only.',
        replaceCount: '~5',
        notes: 'Capitalize HQ Mode consistently',
    },
    {
        templateId: 'WF-01',
        useCase: 'Confirm success',
        currentVariants: 'Confirmed. | Confirmed {n} log(s).',
        proposedStandard: 'Confirmed. | Confirmed {n} item(s).',
        replaceCount: 'many',
        notes: 'Optional: unify item(s) vs log(s)/requisition(s)',
    },
    {
        templateId: 'WF-02',
        useCase: 'Unconfirm',
        currentVariants: 'Confirm removed. Consumption returned to Reported.',
        proposedStandard: 'Confirmation removed. Status returned to Reported.',
        replaceCount: '2',
        notes: 'Same pattern for Requisition',
    },
    {
        templateId: 'WF-03',
        useCase: 'Unapprove',
        currentVariants: 'Approval removed. | {type} approval removed.',
        proposedStandard: 'Approval removed. | {Type} approval removed.',
        replaceCount: '~9',
        notes: 'Or: "Approval withdrawn." / capitalize report type',
    },
    {
        templateId: 'WF-04',
        useCase: 'HQ approve success',
        currentVariants: 'Approved by Company.',
        proposedStandard: 'Approved by HQ.',
        replaceCount: '~6',
        notes: 'Company is ambiguous — use HQ or Superintendent',
    },
    {
        templateId: 'SEL-01',
        useCase: 'Nothing selected for bulk action',
        currentVariants: 'Check one or more {items} to {action}. (×12+)',
        proposedStandard: 'Select one or more {items} to {action}.',
        replaceCount: '~12',
        notes: 'Check → Select ( clearer for checkbox UI )',
    },
];

/** Awkward English hardcoded in TVC_Dialog — rewrite proposals. */
const AWKWARD_ENGLISH = [
    ['Popup blocked. Please allow popups in your browser.', 'Pop-up blocked. Allow pop-ups in your browser settings.', 'Spelling', 'js/ui/spareMenu.js', 'Match app.js Pop-up wording'],
    ['Pop-up blocked. Allow pop-ups to print or preview.', 'Pop-up blocked. Allow pop-ups in your browser settings to print or preview.', 'Spelling/clarity', 'js/app.js', 'Unify popup message text'],
    ['Cannot open Work Report screen.', 'Cannot open Work Report.', 'Wording', 'js/ui/spareMenu.js', 'Remove "screen"'],
    ['Modify allows only one selected item.', 'Modify supports only one selected item.', 'Grammar', 'js/app.js', ''],
    ['Each tab is a separate report. Unsaved input on this tab is not kept.\\n\\nSwitch report type?', 'Unsaved input on this tab will be lost.\\n\\nSwitch report type?', 'Clarity', 'js/app.js', 'Shorter'],
    ['Group append is unavailable.', 'Group append is not available.', 'Tone', 'js/ui/spareMenu.js', ''],
    ['Complete Evaluation (Eval column) first: {nos}', 'Complete evaluation for all items first: {nos}', 'UI jargon', 'js/ui/spareMenu.js', 'Hide column name'],
    ['ExcelJS library not loaded.', 'Excel export is not available. Please refresh the page (Ctrl+F5).', 'User-facing', 'js/ui/spareMenu.js', 'Hide library name'],
    ['Vendor registry is not loaded. Please refresh the page (Ctrl+F5).', 'Vendor registry is not loaded. Please refresh the page.', 'Platform', 'js/ui/spareMenu.js', 'Ctrl+F5 is Windows-specific'],
    ['Automatic Import is not available in file:// mode. …', 'Automatic import is not available when opened as a local file. Use npm run serve or the installed app.', 'Developer jargon', 'js/ui/spareMenu.js', 'Simplify file:// message'],
    ['consume Approved by Company. Approved by Superintendent.', 'Approved by HQ Superintendent.', 'Grammar/duplicate', 'js/ui/spareMenu.js', 'Fix lowercase consume prefix in message'],
    ['O/S closed — approved by Company.', 'Outstanding quantity closed — approved by HQ.', 'Abbreviation', 'js/ui/spareMenu.js', 'Expand O/S'],
];

/** UI hints (not modal) with Korean — for completeness. */
const KOREAN_UI_HINTS = [
    ['js/app.js', 'menuHistAccountHint', 'HQ Mode — vessel(Master)과 Export / Import 이력을 표시합니다.', 'HQ Mode — shows Export / Import history for the vessel (Master).', 'History subtitle'],
    ['js/app.js', 'menuHistAccountHint', 'Hub (Captain) — Engine/Deck Station · Company(HQ)와 Export / Import 이력을 표시합니다.', 'Hub (Captain) — shows Export / Import history with Engine/Deck stations and Company (HQ).', 'History subtitle'],
    ['js/app.js', 'menuHistAccountHint', '확인자 — 주로 Master와 Export / Import합니다. …', 'Confirmer — primarily exports/imports with Master. Company (HQ) packages are also recorded if Master PC is unavailable.', 'History subtitle'],
    ['js/ui/spareMenu.js', 'spareHistAccountHint', '(same pattern as PMS history)', '(translate same as PMS history hints)', 'SPARE History subtitle'],
    ['js/app.js', 'history checkbox title', '승인 완료 / Confirm 권한 없음 …', 'Approved / No permission to confirm …', 'Tooltip — not TVC_Dialog'],
    ['js/services/sync.js', 'scopeLabel', 'Deck (HQ 회신) / Engine (HQ 회신)', 'Deck (HQ reply) / Engine (HQ reply)', 'Sync history label'],
];

function scanKoreanThrows() {
    const rows = [];
    for (const file of walk(JS_DIR)) {
        const text = fs.readFileSync(file, 'utf8');
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        const lines = text.split('\n');
        lines.forEach((line, i) => {
            if (!/[\uac00-\ud7a3]/.test(line)) return;
            if (/^\s*(\/\/|\*|\/\*\*)/.test(line.trim())) return;
            if (!/throw|message:|return\s+['"`]|Error\(/.test(line)) return;
            rows.push({
                file: rel,
                line: i + 1,
                snippet: line.trim().slice(0, 200),
                inProposal: KOREAN_THROW_PROPOSALS.some(p => p[0] === rel && line.includes(p[1].slice(0, 20))),
            });
        });
    }
    return rows;
}

async function main() {
    const koreanThrowRows = KOREAN_THROW_PROPOSALS.map(([file, current, proposed], i) => ({
        id: `KR-${String(i + 1).padStart(3, '0')}`,
        priority: file.includes('auth') || file.includes('sync') ? 'P1' : 'P2',
        file,
        current,
        proposed,
        surfacesVia: 'TVC_Dialog.alert(e.message) or import fail handler',
        action: 'Replace throw new Error / message string in source',
    }));

    const overview = [
        { item: 'Purpose', value: 'Korean→English replacements + permission/approval message unification for TVC_Dialog' },
        { item: 'TVC_Dialog call sites', value: '867 (see TVC-Dialog-Alert-Inventory.xlsx)' },
        { item: 'Confirmed Korean in dialogs', value: String(KOREAN_DIALOG_DIRECT.length) },
        { item: 'Korean throw/message proposals', value: String(koreanThrowRows.length) },
        { item: 'Permission templates', value: String(PERMISSION_UNIFICATION.length) },
        { item: 'Awkward English rewrites', value: String(AWKWARD_ENGLISH.length) },
        { item: 'Recommended order', value: 'P1 direct dialog Korean → P1 sync/auth throws → PERM templates → awkward EN' },
        { item: 'Regenerate', value: 'node scripts/gen-dialog-message-unification.mjs' },
        { item: 'Generated', value: new Date().toISOString().slice(0, 19).replace('T', ' ') },
    ];

    const wb = new ExcelJS.Workbook();
    wb.creator = 'TVC-PMS';
    wb.created = new Date();

    addSheet(wb, 'Overview', [
        { header: 'Item', key: 'item', width: 24 },
        { header: 'Value', key: 'value', width: 72 },
    ], overview);

    addSheet(wb, 'Korean in Dialogs P1', [
        { header: 'Priority', key: 'priority', width: 8 },
        { header: 'Category', key: 'category', width: 12 },
        { header: 'Current (KO/mixed)', key: 'current', width: 48 },
        { header: 'Proposed (EN)', key: 'proposed', width: 48 },
        { header: 'File', key: 'file', width: 28 },
        { header: 'Function', key: 'function', width: 28 },
        { header: 'Call Sites', key: 'callSites', width: 36 },
        { header: 'Modes', key: 'modes', width: 18 },
    ], KOREAN_DIALOG_DIRECT, 'proposed');

    addSheet(wb, 'Korean Throws P1-P2', [
        { header: 'ID', key: 'id', width: 8 },
        { header: 'Priority', key: 'priority', width: 8 },
        { header: 'File', key: 'file', width: 28 },
        { header: 'Current (KO)', key: 'current', width: 44 },
        { header: 'Proposed (EN)', key: 'proposed', width: 44 },
        { header: 'Surfaces Via', key: 'surfacesVia', width: 28 },
        { header: 'Action', key: 'action', width: 28 },
    ], koreanThrowRows, 'proposed');

    addSheet(wb, 'Permission Templates', [
        { header: 'Template ID', key: 'templateId', width: 12 },
        { header: 'Use Case', key: 'useCase', width: 24 },
        { header: 'Current Variants', key: 'currentVariants', width: 44 },
        { header: 'Proposed Standard', key: 'proposedStandard', width: 44 },
        { header: '~Count', key: 'replaceCount', width: 10 },
        { header: 'Notes', key: 'notes', width: 36 },
    ], PERMISSION_UNIFICATION, 'proposedStandard');

    addSheet(wb, 'Awkward English', [
        { header: 'Current', key: 'current', width: 44 },
        { header: 'Proposed', key: 'proposed', width: 44 },
        { header: 'Issue', key: 'issue', width: 14 },
        { header: 'File', key: 'file', width: 28 },
        { header: 'Notes', key: 'notes', width: 28 },
    ], AWKWARD_ENGLISH.map(([current, proposed, issue, file, notes]) => ({
        current, proposed, issue, file, notes,
    })), 'proposed');

    addSheet(wb, 'UI Hints Korean', [
        { header: 'File', key: 'file', width: 28 },
        { header: 'Context', key: 'context', width: 24 },
        { header: 'Current', key: 'current', width: 44 },
        { header: 'Proposed', key: 'proposed', width: 44 },
        { header: 'Type', key: 'type', width: 18 },
    ], KOREAN_UI_HINTS.map(([file, context, current, proposed, type]) => ({
        file, context, current, proposed, type,
    })), 'proposed');

    const scanned = scanKoreanThrows();
    addSheet(wb, 'Korean Lines Scan', [
        { header: 'File', key: 'file', width: 28 },
        { header: 'Line', key: 'line', width: 8 },
        { header: 'In Proposal Sheet', key: 'inProposal', width: 14 },
        { header: 'Snippet', key: 'snippet', width: 80 },
    ], scanned);

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    await wb.xlsx.writeFile(OUT);
    console.log(`Wrote ${OUT}`);
    console.log(`Sheets: ${wb.worksheets.map(w => w.name).join(', ')}`);
}

main();
