import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILES = ['js/app.js', 'js/ui/defectReport.js', 'js/ui/spareMenu.js'];

const REPLACEMENTS = [
    ['타 부서 항목은 Batch Report에 포함할 수 없습니다.', 'Items from another department cannot be included in Batch Report.'],
    ['저장할 작업이 없습니다.', 'No jobs to save.'],
    ['Batch Work Report 저장 완료', 'Batch Work Report saved'],
    ['첫 번째 항목입니다.', 'This is the first item.'],
    ['마지막 항목입니다.', 'This is the last item.'],
    ['Work History에서 항목을 선택하세요.', 'Select an item from Work History.'],
    ['Confirm할 REPORTED 항목의 체크박스(ㅁ)를 선택하세요.', 'Check one or more REPORTED items to confirm.'],
    ['선택한 항목 중 Confirm할 수 없는 항목이 있습니다.', 'Some selected items cannot be confirmed.'],
    ['Engine(C/E) · Deck(C/O) · Master(Captain) · HQ 권한을 확인하세요.', 'Check Engine (C/E), Deck (C/O), Master (Captain), or HQ permission.'],
    ['리포트를 찾을 수 없습니다.', 'Report not found.'],
    ['Confirm할 수 없는 상태입니다.', 'Cannot confirm in this status.'],
    ['타 부서(', 'Other department ('],
    [') 리포트는 Confirm할 수 없습니다:', ') report cannot be confirmed:'],
    ['건 Confirm 완료', ' item(s) confirmed'],
    ['Approve할 Confirmed 항목의 체크박스(ㅁ)를 선택하세요.', 'Check one or more Confirmed items to approve.'],
    ['선택한 항목 중 Approve할 수 없는 항목이 있습니다.', 'Some selected items cannot be approved.'],
    ['Confirmed 상태 · HQ 승인 권한을 확인하세요.', 'Check Confirmed status and HQ approval permission.'],
    ['Confirmed 상태만 Approve할 수 있습니다.', 'Only Confirmed items can be approved.'],
    ['이미 Approved 되었습니다.', 'Already approved.'],
    ['Approved Postpone Date가 필요합니다. Work Report에서 확인하세요.', 'Approved Postpone Date is required. Check the Work Report.'],
    ['Approve할 수 있는 항목이 없습니다.', 'No items available to approve.'],
    ['를 Confirm하시겠습니까?', ' — confirm selected item(s)?'],
    ['를 Approve하시겠습니까?', ' — approve selected item(s)?'],
    ['건 Approve 완료', ' item(s) approved'],
    ['Group · Equipment · Jobs가 갱신됩니다. Continue?', 'Group, Equipment, and Jobs will be updated. Continue?'],
    ['PMS Master Excel을 Import 합니다.', 'Import PMS Master Excel?'],
    ['${data.job_code} 항목이 추가되었습니다.', '${data.job_code} item added.'],
    ['${data.job_code} 항목이 수정되었습니다.', '${data.job_code} item updated.'],
    ['PMS GROUP Tree를 불러오는 중…', 'Loading PMS GROUP tree…'],
    ['검색 결과 없음', 'No results'],
];

for (const rel of FILES) {
    const full = path.join(ROOT, rel);
    let src = fs.readFileSync(full, 'utf8');
    for (const [from, to] of REPLACEMENTS) src = src.split(from).join(to);
    fs.writeFileSync(full, src, 'utf8');
    console.log('en3', rel);
}
