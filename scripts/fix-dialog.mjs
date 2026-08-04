import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILES = [
    'js/app.js',
    'js/ui/defectReport.js',
    'js/ui/spareMenu.js',
    'js/ui/runHours.js',
    'js/auth.js',
    'js/services/masterBackup.js',
];

const KO_EN = [
    [/await TVC_Dialog\.await TVC_Dialog\.alert/g, 'await TVC_Dialog.alert'],
    [/PMS Group No\.를 먼저 선택하세요\.?/g, 'Select PMS Group No. first.'],
    [/Submitted · Approved 상태는 Captain \/ Chief Engineer만 Ship's Comments를 수정할 수 있습니다\./g, "Only Captain / Chief Engineer can edit Ship's Comments in Submitted or Approved status."],
    [/Confirmed 상태는 Captain \/ Chief Engineer만 삭제할 수 있습니다\./g, 'Only Captain / Chief Engineer can delete Confirmed items.'],
    [/삭제할 수 없는 상태입니다\./g, 'Cannot delete in this status.'],
    [/Defect Report 목록에서 항목을 선택하세요\./g, 'Select an item from the Defect Report list.'],
    [/Defect Report를 찾을 수 없습니다\./g, 'Defect Report not found.'],
    [/Confirmed 상태는 Captain \/ Chief Engineer만 수정할 수 있습니다\./g, 'Only Captain / Chief Engineer can modify Confirmed items.'],
    [/Approved · Submitted 상태는 수정할 수 없습니다\./g, 'Cannot modify Approved or Submitted items.'],
    [/삭제할 항목을 선택하세요\./g, 'Select item(s) to delete.'],
    [/삭제 권한이 없거나 Submitted · Approved 상태입니다\./g, 'No delete permission or item is Submitted / Approved.'],
    [/Report Confirm할 Reported 항목의 체크박스\(ㅁ\)를 선택하세요\./g, 'Check one or more Reported items to confirm.'],
    [/HQ Review 대기\(SUBMITTED\) 항목만 Confirm할 수 있습니다\./g, 'Only SUBMITTED items awaiting HQ review can be confirmed.'],
    [/Confirm할 수 있는 Reported Defect Report를 선택하세요\./g, 'Select Reported defect report(s) that can be confirmed.'],
    [/Work Plan에서 작업을 선택하세요\./g, 'Select a job in Work Plan.'],
    [/Defect Report 승인 권한이 없습니다\./g, 'No permission to approve Defect Report.'],
    [/Postpone Report 승인 권한이 없습니다\./g, 'No permission to approve Postpone Report.'],
    [/Data Export & Import 권한이 없습니다\./g, 'No permission for Data Export & Import.'],
    [/시스템 준비가 지연되고 있습니다\. 잠시 후 다시 로그인하거나 Ctrl\+Shift\+R 로 새로고침하세요\./g, 'System startup is delayed. Sign in again shortly or refresh with Ctrl+Shift+R.'],
    [/자동 로그인에 실패했습니다\. 다시 로그인하세요\./g, 'Auto sign-in failed. Please sign in again.'],
    [/권한 없음:/g, 'Permission denied:'],
    [/Station 접근 제한/g, 'Station access denied'],
    [/Modify · Append · Delete는 Chief engineer \(ce\) · Chief officer \(co\) · Captain · Superintendent \(hq\)만 사용할 수 있습니다\./g, 'Modify, Append, and Delete require Chief Engineer, Chief Officer, Captain, or Superintendent (HQ) permission.'],
    [/Revert 후 다시 Update할 수 있습니다\./g, 'Use Revert to update again.'],
    [/Monthly 준비: Work History 미완료 ([0-9]+)건/g, 'Monthly prep: $1 unfinished Work History item(s)'],
    [/완료 후 Running Hours Update를 진행하세요\./g, 'Complete them before Running Hours Update.'],
    [/· Defect는 별도 \(RH 조건 아님\)/g, '· Defect reports are separate (not an RH gate)'],
    [/이 파일은 ([^]+?) Restore에는 사용할 수 없습니다\./g, 'This file is a $1 backup and cannot be used for restore in the current scope.'],
    [/백업 선박\(([^)]+)\)과 현재 선박\(([^)]+)\)이 다릅니다\.\n그래도 복구하시겠습니까\?/g, 'Backup vessel ($1) differs from current vessel ($2).\nRestore anyway?'],
    [/복구가 취소되었습니다\./g, 'Restore cancelled.'],
    [/Requisition Import는 \.xlsx 파일만 가능합니다\./g, 'Requisition Import accepts .xlsx files only.'],
    [/Quotation Import는 \.xlsx 파일만 가능합니다\./g, 'Quotation Import accepts .xlsx files only.'],
    [/Received Import는 \.xlsx 파일만 가능합니다\./g, 'Received Import accepts .xlsx files only.'],
    [/Inventory Import는 \.xls \/ \.xlsx \/ \.csv 파일만 가능합니다\./g, 'Inventory Import accepts .xls, .xlsx, or .csv files only.'],
    [/청구서 ([^ ]+) 완료/g, 'Requisition $1 completed'],
    [/Requisition No\.를 선택하세요\./g, 'Select Requisition No.'],
];

for (const rel of FILES) {
    const full = path.join(ROOT, rel);
    let src = fs.readFileSync(full, 'utf8');
    for (const [re, rep] of KO_EN) src = src.replace(re, rep);
    fs.writeFileSync(full, src, 'utf8');
    console.log('fixed', rel);
}
