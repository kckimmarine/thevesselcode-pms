/**
 * Apply TVC-Dialog-Message-Unification.xlsx proposals to source.
 * Run: node scripts/apply-dialog-message-unification.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const SHIP_APPROVER = 'Chief Engineer, Chief Officer, Captain, or HQ Superintendent';

/** Global substring replacements (user-facing strings only). Order matters for longer strings first. */
const GLOBAL = [
    ['Chief Engineer / Captain / Superintendent permission', `${SHIP_APPROVER} permission`],
    ['and you need Chief Engineer / Captain permission', `and you need ${SHIP_APPROVER} permission`],
    ['with Chief Engineer / Captain permission', `with ${SHIP_APPROVER} permission`],
    ['Chief Engineer / Captain permission required.', `${SHIP_APPROVER} permission required.`],
    ['Chief Engineer / Captain permission required', `${SHIP_APPROVER} permission required`],
    ['Chief Engineer / Captain 권한이 필요합니다.', `${SHIP_APPROVER} permission required.`],
    ['Chief Engineer / Captain 권한 필요', `${SHIP_APPROVER} permission required`],
    ['Modify, Append, and Delete require Chief Engineer, Chief Officer, Captain, or Superintendent (HQ) permission.', 'Modify, append, and delete require Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission.'],
    ['Approve is available in HQ mode only.', 'This action is available in HQ Mode only.'],
    ['Vessel Profile Export is available in HQ Mode only.', 'Vessel Profile Export is available in HQ Mode only.'], // already EN
    ['Confirm removed. Consumption returned to Reported.', 'Confirmation removed. Status returned to Reported.'],
    ['Confirm removed. Requisition returned to Reported.', 'Confirmation removed. Status returned to Reported.'],
    ['Approved by Company.', 'Approved by HQ.'],
    ['Check one or more', 'Select one or more'],
    ['Modify allows only one selected item', 'Modify supports only one selected item'],
    ['Login required.', 'Sign in required.'],
    ['Login required', 'Sign in required'],
    ['No permission to ', 'You do not have permission to '],
    ['Popup blocked. Please allow popups in your browser.', 'Pop-up blocked. Allow pop-ups in your browser settings.'],
    ['Cannot open Work Report screen.', 'Cannot open Work Report.'],
    ['Group append is unavailable.', 'Group append is not available.'],
    ['ExcelJS library not loaded.', 'Excel export is not available. Please refresh the page (Ctrl+F5).'],
    ['Vendor registry is not loaded. Please refresh the page (Ctrl+F5).', 'Vendor registry is not loaded. Please refresh the page.'],
    ['Complete Evaluation (Eval column) first', 'Complete evaluation for all items first'],
    ['O/S closed — approved by Company.', 'Outstanding quantity closed — approved by HQ.'],
    ['Each tab is a separate report. Unsaved input on this tab is not kept.\n\nSwitch report type?', 'Unsaved input on this tab will be lost.\n\nSwitch report type?'],
    ['Station access denied', 'Station access denied.'],
    ['Captain / Chief Engineer만 Work Procedure를 수정할 수 있습니다.', 'Only Captain or Chief Engineer can edit the Work Procedure.'],
    ['Work Procedure를 편집할 수 없습니다.', 'You do not have permission to edit the Work Procedure.'],
    ['Received Date를 입력하세요.', 'Enter Received Date.'],
    ['Received Port를 입력하세요.', 'Enter Received Port.'],
    ['JOB CODE에 "', 'Assign "'],
    ['" 할당\n\nJob Code:', '" to a JOB CODE\n\nJob Code:'],
    ['청구서 ${savedNo} 수정 완료 (${lineCount} line(s)).', 'Requisition ${savedNo} updated (${lineCount} line(s)).'],
    ['— Requisition List에 추가되었습니다.', '— added to Requisition List.'],
    // Korean throws / messages
    ['부서 불일치: 선택한 부서(${dept})와 파일의 부서(${fileDept})가 다릅니다.', 'Department mismatch: selected department (${dept}) does not match the file (${fileDept}).'],
    ['방향 불일치: 기대 ${directionHint}, 파일 ${fileDirection}', 'Direction mismatch: expected ${directionHint}, file has ${fileDirection}.'],
    ['ZIP에 유효한 vessel_id가 없습니다. 올바른 선박 Export 파일인지 확인하세요.', 'ZIP has no valid vessel_id. Check that this is a correct vessel export file.'],
    ['HQ에서 선택한 선박은 "${exp}"입니다.', 'Selected vessel in HQ is "${exp}".'],
    ['이 PC에 등록된 선박은 "${exp}"입니다.', 'Registered vessel on this PC is "${exp}".'],
    ['선박 ID 불일치: 이 ZIP은 "${got}" 선박 데이터입니다. ${ctx} 데이터 오염 방지를 위해 Import가 중단되었습니다.', 'Vessel ID mismatch: this ZIP is for vessel "${got}". ${ctx} Import stopped to prevent data corruption.'],
    ['SPARE Master Import는 Chief Engineer, Chief Officer, Captain(Master), 또는 HQ Superintendent만 사용할 수 있습니다.', 'SPARE Master Import requires Chief Engineer, Chief Officer, Captain (Master), or HQ Superintendent.'],
    ['Vessel Profile Export는 HQ Mode에서만 가능합니다.', 'Vessel Profile Export is available in HQ Mode only.'],
    ['JSZip이 로드되지 않았습니다.', 'JSZip is not loaded. Please refresh the page.'],
    ['파일이 없습니다.', 'No file selected.'],
    ['ZIP에 tvc_vessel_profile.json이 없습니다.', 'ZIP does not contain tvc_vessel_profile.json.'],
    ['Vessel Profile 파일이 아닙니다.', 'This is not a Vessel Profile file.'],
    ['Vessel Profile에 vessel_id가 없습니다.', 'Vessel Profile has no vessel_id.'],
    ['Vessel Profile Import는 선박 Mode에서만 가능합니다.', 'Vessel Profile Import is available in vessel mode only.'],
    ['App Update Export는 Admin Mode(tvc)에서만 가능합니다.', 'App Update Export is available in Admin Mode (tvc) only.'],
    ['목록에 저장된 Report만 Confirm할 수 있습니다.', 'Only saved reports in the list can be confirmed.'],
    ['Part No / Name 은 필수입니다.', 'Part No and Name are required.'],
    ['Part No "${rec.part_no}" 는 이미 존재합니다.', 'Part No "${rec.part_no}" already exists.'],
    ['파일을 선택하세요.', 'Select a file.'],
    ['지원 형식: .zip, .json, .csv', 'Supported formats: .zip, .json, .csv'],
    ['CSV에 데이터 행이 없습니다.', 'CSV has no data rows.'],
    ['file:// 모드에서는 로그인할 수 없습니다. Electron 설치본, START-TVC-PMS.bat, 또는 npm start → http://localhost:3000 으로 실행하세요.', 'Sign-in is not available in file:// mode. Use the Electron app, START-TVC-PMS.bat, or npm start → http://localhost:3000.'],
    ['이 브라우저에서 비밀번호 검증을 사용할 수 없습니다. Chrome/Edge 최신 버전을 사용하세요.', 'Password verification is not available in this browser. Use the latest Chrome or Edge.'],
    ['ExcelJS 라이브러리가 로드되지 않았습니다.', 'ExcelJS library is not loaded. Please refresh the page (Ctrl+F5).'],
    ['시트를 찾을 수 없습니다.', 'Worksheet not found.'],
    ["'Part No' 열을 찾을 수 없습니다.", "Column 'Part No' not found."],
    ['시트 "${sheetName}" 를 찾을 수 없습니다.', 'Worksheet "${sheetName}" not found.'],
    ['지원 형식: .csv, .xls, .xlsx', 'Supported formats: .csv, .xls, .xlsx'],
    ['파싱된 부품(SparePart) 행이 없습니다. 파일 형식을 확인하세요.', 'No spare part rows parsed. Check the file format.'],
    ['CSV fetch 실패: ${source}', 'CSV fetch failed: ${source}'],
    ['지원 source: CSV 문자열, URL, File, null(번들)', 'Supported source: CSV string, URL, File, or null (bundle).'],
    ['CSV에서 부품(SparePart) 행을 찾지 못했습니다. 헤더/형식을 확인하세요.', 'No spare part rows found in CSV. Check headers and format.'],
    ['SheetJS(XLSX)가 로드되지 않았습니다.', 'SheetJS (XLSX) is not loaded. Please refresh the page.'],
    ['XLS 파일을 찾을 수 없습니다: ${url}', 'XLS file not found: ${url}'],
    ['XLS에서 부품 행을 찾지 못했습니다.', 'No spare part rows found in XLS.'],
    ['Data Export & Import는 ${who}만 수행할 수 있습니다.', 'Data Export & Import can only be performed by ${who}.'],
    ['Deck (HQ 회신)', 'Deck (HQ reply)'],
    ['Engine (HQ 회신)', 'Engine (HQ reply)'],
    // History hints
    ['HQ Mode — vessel(Master)과 Export / Import 이력을 표시합니다.', 'HQ Mode — shows Export / Import history for the vessel (Master).'],
    ['HQ Mode — vessel(Master)과 SPARE Export / Import 이력을 표시합니다.', 'HQ Mode — shows SPARE Export / Import history for the vessel (Master).'],
    ['Hub (Captain) — Engine/Deck Station · Company(HQ)와 Export / Import 이력을 표시합니다.', 'Hub (Captain) — shows Export / Import history with Engine/Deck stations and Company (HQ).'],
    ['Hub (Captain) — Station · Company와 SPARE Export / Import 이력을 표시합니다.', 'Hub (Captain) — shows SPARE Export / Import history with stations and Company (HQ).'],
    ['확인자 — 주로 Master와 Export / Import합니다. Master PC 장애 시 Company(HQ) 패키지도 기록됩니다.', 'Confirmer — primarily exports/imports with Master. Company (HQ) packages are also recorded if Master PC is unavailable.'],
    ['확인자 — 주로 Master와 SPARE Export / Import합니다. Master PC 장애 시 Company(HQ) 패키지도 기록됩니다.', 'Confirmer — primarily exports/imports SPARE data with Master. Company (HQ) packages are also recorded if Master PC is unavailable.'],
    // History checkbox tooltips
    ["return '승인 완료'", "return 'Approved'"],
    ["return 'Report Confirm 또는 Approve 대상'", "return 'Eligible for Report Confirm or Approve'"],
    ["return 'Approve 대기'", "return 'Awaiting Approve'"],
    ["return 'Awaiting HQ · Confirmed 항목만 선택 가능'", "return 'Awaiting HQ — select Confirmed items only'"],
    ["return '이미 Confirm 됨'", "return 'Already confirmed'"],
    ["return 'Confirm 권한 없음 (Engine · C/E · Deck · C/O · Master · Captain · HQ)'", "return 'No permission to confirm (Engine · C/E · Deck · C/O · Master · Captain · HQ)'"],
    ["return '승인 완료된 리포트'", "return 'Approved report'"],
    ["return 'REPORTED · Confirmed 항목만 선택 가능'", "return 'REPORTED or Confirmed items only'"],
];

const FILE_SPECIFIC = [
    {
        file: 'js/app.js',
        replacements: [
            ["await TVC_Dialog.alert('Pop-up blocked. Allow pop-ups to print or preview.');",
                "await TVC_Dialog.alert('Pop-up blocked. Allow pop-ups in your browser settings to print or preview.');"],
            ["await TVC_Dialog.alert('Vessel Profile Export is available in HQ Mode only.');",
                "await TVC_Dialog.alert('This action is available in HQ Mode only.');"],
        ],
    },
    {
        file: 'js/ui/spareMenu.js',
        replacements: [
            ["await TVC_Dialog.alert(kind === 'consume' ? 'Approved by Company.' : 'Approved by Superintendent.');",
                "await TVC_Dialog.alert('Approved by HQ Superintendent.');"],
            [`await TVC_Dialog.alert(
                'Automatic Import is not available in file:// mode.\\n\\n' +
                '▶ Click “Select spare-inventory.xls” directly\\n' +
                '▶ Recommended: npm run serve → http://localhost:3000'
            );`,
                `await TVC_Dialog.alert(
                'Automatic import is not available when opened as a local file.\\n\\n' +
                'Select spare-inventory.xls manually, or use npm run serve / the installed app.'
            );`],
        ],
    },
];

const TARGET_FILES = [
    'js/app.js',
    'js/ui/spareMenu.js',
    'js/ui/defectReport.js',
    'js/ui/workPermit.js',
    'js/ui/settings.js',
    'js/auth.js',
    'js/space.js',
    'js/core/db.js',
    'js/services/sync.js',
    'js/services/spareMasterExcel.js',
    'js/services/vesselProfileSync.js',
    'js/services/appUpdate.js',
    'js/services/defectCase.js',
    'js/services/inventory.js',
    'js/services/stationSync.js',
    'js/services/excel.js',
    'js/services/adminPrint.js',
];

function applyGlobal(text) {
    let out = text;
    for (const [from, to] of GLOBAL) {
        if (out.includes(from)) out = out.split(from).join(to);
    }
    return out;
}

let changed = 0;
for (const rel of TARGET_FILES) {
    const fp = path.join(ROOT, rel);
    if (!fs.existsSync(fp)) continue;
    let text = fs.readFileSync(fp, 'utf8');
    const orig = text;
    text = applyGlobal(text);
    const spec = FILE_SPECIFIC.find(s => s.file === rel);
    if (spec) {
        for (const [from, to] of spec.replacements) {
            if (text.includes(from)) text = text.replace(from, to);
        }
    }
    if (text !== orig) {
        fs.writeFileSync(fp, text, 'utf8');
        changed++;
        console.log('Updated', rel);
    }
}

// Verify no Korean in user-facing throw/return (excluding comments)
let koreanLeft = 0;
for (const rel of TARGET_FILES) {
    const fp = path.join(ROOT, rel);
    if (!fs.existsSync(fp)) continue;
    const lines = fs.readFileSync(fp, 'utf8').split('\n');
    lines.forEach((line, i) => {
        if (!/[\uac00-\ud7a3]/.test(line)) return;
        if (/^\s*(\/\/|\*|\/\*\*)/.test(line.trim())) return;
        if (!/throw|message:|return\s+['"`]|TVC_Dialog|alert\(|confirm\(|prompt\(/.test(line)) return;
        console.log(`  KO remaining ${rel}:${i + 1}`, line.trim().slice(0, 100));
        koreanLeft++;
    });
}

console.log(`\nFiles changed: ${changed}`);
console.log(`User-facing Korean lines remaining (target files): ${koreanLeft}`);
process.exit(koreanLeft > 5 ? 1 : 0);
