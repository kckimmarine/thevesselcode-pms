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

const REPLACEMENTS = [
    ['confirmCancelWorkReport, dismissWrCancelConfirm,', ''],
    ['confirmCancelNew, dismissCancelConfirm,', 'confirmCancelNew,'],
    ['dismissCancelConfirm();\n        ', ''],
    ['dismissWrCancelConfirm();\n        ', ''],
    ['await TVC_Dialog.confirm({ message: \'Save this Work Report?\' })', "await TVC_Dialog.confirm({ kind: 'save', message: 'Save this Work Report?' })"],
    ['await TVC_Dialog.confirm({ message: \'Save this Defect Report?\' })', "await TVC_Dialog.confirm({ kind: 'save', message: 'Save this Defect Report?' })"],
    ['`${row.case_no} Defect Report를 Delete this item?`', '`Delete defect report ${row.case_no}?`'],
    ['`${deletable.length}건의 Defect Report를 Delete this item?`', '`Delete ${deletable.length} defect report(s)?`'],
    ['`${toConfirm.length}건의 Defect Report를 Confirm selected item(s)?`', '`Confirm ${toConfirm.length} defect report(s)?`'],
    ['`${ok}건 Report Confirm 완료`', '`${ok} report(s) confirmed`'],
    ['`${rep.job_code} Critical Postpone 리포트가 Confirm되었습니다. (Company 승인·Export 대기)`', '`${rep.job_code} critical postpone report confirmed. (Awaiting company approval / export)`'],
    ['`${rep.job_code} Postpone 리포트가 Confirm되었습니다. (NEXT DATE 갱신)`', '`${rep.job_code} postpone report confirmed. (NEXT DATE updated)`'],
    ['`${rep.job_code} 리포트가 Confirm되었습니다. ((Stock deduction · LAST DONE / NEXT DATE update))`', '`${rep.job_code} report confirmed. (Stock deduction · LAST DONE / NEXT DATE update)`'],
    ['`${rep.job_code} 리포트가 본사 승인(APPROVED)되었습니다.${sched}`', '`${rep.job_code} report approved by company.${sched}`'],
    ['`Monthly 준비: Work History 미완료 ${unconfirmed}건\\n`', '`Monthly prep: ${unconfirmed} unfinished Work History item(s)\\n`'],
    ['· Critical Postpone → Confirm 후 Submitted (Export)', '· Critical Postpone → Confirm then Submitted (Export)'],
    ['8MB 이하 파일만 첨부할 수 있습니다.', 'Only files up to 8 MB can be attached.'],
    ['파일을 읽을 수 없습니다.', 'Could not read the file.'],
    ['첫 번째 Defect Report입니다.', 'This is the first defect report.'],
    ['마지막 Defect Report입니다.', 'This is the last defect report.'],
    ['Submitted · Approved 상태는 Captain / Chief Engineer만 Ship\\\'s Comments를 수정할 수 있습니다.', "Only Captain / Chief Engineer can edit Ship's Comments in Submitted or Approved status"],
    ['Running Hours Update는 Chief engineer (ce) · Superintendent (hq)만 사용할 수 있습니다.', 'Running Hours Update requires Chief Engineer (ce) or Superintendent (hq) permission.'],
    ['Running Hours Update가 완료되었습니다. Use Revert to update again.', 'Running Hours update is complete. Use Revert to update again.'],
    ['Work History: Maintenance·Postpone Confirm, Critical Postpone는 Submitted까지 완료 후 Update 가능합니다. (Defect 제외)', 'Work History: confirm Maintenance/Postpone; critical Postpone must be Submitted before Update. (Defect excluded)'],
    ['입력 후 Apply Update를 눌러 저장합니다.', 'Enter values, then click Apply Update to save.'],
    ['Update를 눌러 입력을 시작합니다.', 'Click Update to begin entering values.'],
    ['이 파일은 ${scopeLabel(payload.scope)} 백업입니다. ', 'This file is a ${scopeLabel(payload.scope)} backup. '],
    ['${scopeLabel(scope)} Restore에는 사용할 수 없습니다.', 'It cannot be used for ${scopeLabel(scope)} restore.'],
    ['백업 선박(${payload.vessel_id})과 현재 선박(${expectedVessel})이 다릅니다.\\n그래도 복구하시겠습니까?', 'Backup vessel (${payload.vessel_id}) differs from current vessel (${expectedVessel}).\\nRestore anyway?'],
    ["if (!ok) throw new Error('복구가 취소되었습니다.');", "if (!ok) throw new Error('Restore cancelled.');"],
    ['await TVC_Dialog.confirm({ message: `Export ${scopedIds.length} defect report(s) to ${destLabel}?` })', "await TVC_Dialog.confirm({ kind: 'confirm', message: `Export ${scopedIds.length} defect report(s) to ${destLabel}?` })"],
    ['await TVC_Dialog.alert(\'Work Procedure saved.\')', "await TVC_Dialog.success('Work Procedure saved.')"],
];

for (const rel of FILES) {
    const full = path.join(ROOT, rel);
    let src = fs.readFileSync(full, 'utf8');
    for (const [from, to] of REPLACEMENTS) {
        if (src.includes(from)) src = src.split(from).join(to);
    }
    fs.writeFileSync(full, src, 'utf8');
    console.log('patched', rel);
}
