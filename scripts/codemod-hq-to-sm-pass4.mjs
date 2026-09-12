#!/usr/bin/env node
/** Session/UI context tokens: hq -> sm (keep legacy reads). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILE_REPLACEMENTS = {
    'js/app.js': [
        ["localStorage.getItem('tvc_hq_dept_view')", "localStorage.getItem('tvc_sm_dept_view') || localStorage.getItem('tvc_hq_dept_view')"],
        ["localStorage.setItem('tvc_hq_dept_view'", "localStorage.setItem('tvc_sm_dept_view'"],
        ["return 'hq';", "return 'sm';"],
        ["ctx === 'hq'", "(ctx === 'sm' || ctx === 'hq')"],
        ["kind === 'hq'", "(kind === 'sm' || kind === 'hq')"],
        ['hq-mode', 'sm-mode'],
        ['hqApprovePending', 'smApprovePending'],
        ['hqPendingWorkReports', 'smPendingWorkReports'],
        ['hqPendingDefectCases', 'smPendingDefectCases'],
        ['hqPendingWorkPermits', 'smPendingWorkPermits'],
        ['hqPendingPostponeReports', 'smPendingPostponeReports'],
        ['hqMonthlyReportsPendingCount', 'smMonthlyReportsPendingCount'],
        ['hqDailyItems', 'smDailyItems'],
        ['getHistHqApproveCandidates', 'getHistSmApproveCandidates'],
        ['hqApprovePostponeDate', 'smApprovePostponeDate'],
        ['opts.hqApprove', 'opts.smApprove'],
        ['{ hqApprove: true }', '{ smApprove: true }'],
        ['isHqApprove', 'isSmApprove'],
        ['isHqApproved', 'isSmApproved'],
        ['hqApproveBtn', 'smApproveBtn'],
        ['checkedHqApproveCount', 'checkedSmApproveCount'],
        ['hqRole', 'smRole'],
        ['hqRepair', 'smRepair'],
        ["setText('cmaxsShipName', 'HEAD OFFICE (Fleet View)')", "setText('cmaxsShipName', 'HEAD OFFICE (Fleet View — SM)')"],
        ['HQ export for', 'SM export for'],
        ['HQ-approved', 'SM-approved'],
        ['placeholder="HQ comment"', 'placeholder="SM comment"'],
        ['Master · Captain · HQ)', 'Master · Captain · SM)'],
        ['import at HQ.', 'import at SM office.'],
        ['(HQ / Captain)', '(SM / Captain)'],
        ['company HQ.', 'company SM office.'],
        ['HQ: Import new seat', 'SM: Import new seat'],
        ['HQ app version', 'SM app version'],
        ['HQ=Company', 'SM=Company'],
        ['HQ license', 'SM license'],
        ['HQ / Master', 'SM / Master'],
        ['<label>HQ SKU', '<label>SM SKU'],
        ['HQ web login', 'SM web login'],
        [`\${company.name} HQ`, '${company.name} SM'],
        ['(HQ→Ship)', '(SM→Ship)'],
        ['Captain→HQ', 'Captain→SM'],
        ['Captain/HQ', 'Captain/SM'],
    ],
    'css/app.css': [
        ['.cmaxs-body.hq-mode', '.cmaxs-body.sm-mode, .cmaxs-body.hq-mode'],
    ],
};

for (const [rel, reps] of Object.entries(FILE_REPLACEMENTS)) {
    const file = path.join(ROOT, rel);
    let text = fs.readFileSync(file, 'utf8');
    let next = text;
    for (const [from, to] of reps) next = next.split(from).join(to);
    if (next !== text) {
        fs.writeFileSync(file, next);
        console.log(`Updated ${rel}`);
    }
}
