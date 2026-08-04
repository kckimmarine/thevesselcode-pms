import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILES = ['js/app.js', 'js/ui/defectReport.js', 'js/ui/spareMenu.js'];

const REPLACEMENTS = [
    ['이 계정은 ', 'This account is restricted to the '],
    [' 부서 전용입니다.', ' department.'],
    ['시작일은 종료일보다 늦을 수 없습니다.', 'Start date cannot be after end date.'],
    ['Import 유형을 먼저 선택하세요.', 'Select an import type first.'],
    ['Update Work Plan은 확인자(Chief engineer / Chief officer / Captain)만 사용할 수 있습니다.', 'Update Work Plan requires Chief Engineer, Chief Officer, or Captain permission.'],
    ['Running Hours Update를 먼저 완료하세요.', 'Complete Running Hours Update first.'],
    ['Control(권한) 변경은 관리자(B) 승인 후 적용됩니다.', 'Control (permission) changes apply after administrator approval.'],
    ['GROUP 이름을 입력하세요.', 'Enter a GROUP name.'],
    ['GROUP 이름이 "', 'GROUP renamed to "'],
    ['"(으)로 변경되었습니다.', '".'],
    ['GROUP "', 'GROUP "'],
    ['"이(가) 추가되었습니다.', '" was added.'],
    ['같은 부서에 동일한 GROUP 이름이 이미 있습니다.', 'A GROUP with the same name already exists in this department.'],
    ['저장 실패', 'Save failed'],
    ['수정할 작업 행을 선택하세요.', 'Select a job row to modify.'],
    ['작업 항목을 찾을 수 없습니다.', 'Job item not found.'],
    ['삭제할 작업 행을 선택하세요.', 'Select a job row to delete.'],
    ['\\n\\n이 작업 항목을 Delete this item?', '\\n\\nDelete this maintenance item?'],
    [' 항목이 삭제되었습니다.', ' item deleted.'],
    ['Original Plan 저장 중 오류가 발생했습니다.', 'An error occurred while saving Original Plan.'],
    ['Approve Work Plan 권한이 없습니다.', 'No permission to approve Work Plan.'],
    ['부서(Deck / Engine)를 선택하세요.', 'Select a department (Deck / Engine).'],
    ['Original Plan 계산 중 오류가 발생했습니다.', 'An error occurred while calculating Original Plan.'],
    ['선택된 작업이 없습니다.', 'No jobs selected.'],
    ['작업을 선택하거나 체크(ㅁ)로 1개 이상 선택하세요.', 'Select a job or check one or more rows.'],
    ['Batch Report는 2개 이상의 작업을 선택하세요.', 'Select at least 2 jobs for Batch Report.'],
    ['Evaluation 파일만 업로드할 수 있습니다.\\n· *_EVAL_REPLY.xlsx / *EVAL*.xlsx\\n· Assessment .json', 'Only evaluation files can be uploaded.\\n· *_EVAL_REPLY.xlsx / *EVAL*.xlsx\\n· Assessment .json'],
    ['Awaiting HQ 항목만 선택 가능', 'Only items awaiting HQ review can be selected'],
    ['선택 불가', 'Not selectable'],
    ['삭제 권한 없음', 'No delete permission'],
];

for (const rel of FILES) {
    const full = path.join(ROOT, rel);
    let src = fs.readFileSync(full, 'utf8');
    for (const [from, to] of REPLACEMENTS) src = src.split(from).join(to);
    fs.writeFileSync(full, src, 'utf8');
    console.log('en', rel);
}
