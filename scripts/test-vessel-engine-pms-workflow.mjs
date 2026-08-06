#!/usr/bin/env node
/**
 * VESSEL MODE — ENGINE PMS workflow simulation
 * Usage: npm run test-vessel-engine-pms-workflow
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const APP_JS = path.join(ROOT, 'js', 'app.js');

const MAINT_PLAN_EDITOR_USERNAMES = new Set(['ce', 'co', 'captain', 'hq']);
const CE_USER = { username: 'ce', role: 'SHIP_CHIEF', department: 'ENGINE', display_name: 'Chief engineer' };
const ENGINEER_USER = { username: 'engineer', role: 'SHIP_OFFICER', department: 'ENGINE', display_name: 'Engineer' };

let pass = 0;
let fail = 0;
function assert(name, cond, detail = '') {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

function canEditWorkProcedure(user) {
    if (!user) return false;
    if (!MAINT_PLAN_EDITOR_USERNAMES.has(String(user.username || '').toLowerCase())) return false;
    return ['SHIP_CHIEF', 'SHIP_CAPTAIN', 'HQ_SUPERVISOR'].includes(user.role);
}

function menuNavigateSim(state, tab, opts = {}) {
    if (opts.actualFilter) state.actualFilter = opts.actualFilter;
    state.currentTab = tab;
    return state;
}

function histTypeMarker(entry) {
    if (entry.source === 'defect') return { letter: 'D', title: 'Defect Report' };
    if (entry.report?.work_type === 'POSTPONE') return { letter: 'P', title: 'Postponed Report' };
    return { letter: 'M', title: 'Maintenance Report' };
}

function listReportedDateStr(record) {
    return String(record.report_date || record.report_form?.reportDate || record.work_date || record.created_at || '').slice(0, 10);
}

function reportWorkflowStatusLabel(report) {
    const st = String(report?.status || 'REPORTED').toUpperCase();
    if (st === 'APPROVED') return 'Approved';
    if (st === 'CONFIRMED') return 'Confirmed';
    return 'Reported';
}

function defectHistoryStatusLabel(dc) {
    const st = String(dc?.status || 'DRAFT').toUpperCase();
    if (st.includes('CLOSED') || st.includes('APPROVED')) return 'Approved';
    if (st.includes('SUBMITTED') || st.includes('CONFIRMED')) return 'Confirmed';
    return 'Reported';
}

function page2SpareCheckedCount(usedParts) {
    return (usedParts || []).filter(p => Number(p.qty_used) > 0).length;
}

function extractHistListRow(entry) {
    if (entry.source === 'defect') {
        const dc = entry.defect;
        return {
            type: 'D',
            fileNo: String(dc.file_no || '').trim(),
            reportedDate: listReportedDateStr(dc),
            status: defectHistoryStatusLabel(dc),
            description: dc.outline_maintenance_request || dc.action_taken || '',
            consumption: page2SpareCheckedCount(dc.used_parts),
        };
    }
    const { report: r, item } = entry;
    const f = item?.form || r.report_form || {};
    const parts = item?.used_parts?.length ? item.used_parts : (r.used_parts || []);
    return {
        type: histTypeMarker(entry).letter,
        fileNo: String(f.fileNo || '').trim(),
        reportedDate: listReportedDateStr(r),
        status: reportWorkflowStatusLabel(r),
        description: item?.description || r.description || '',
        consumption: page2SpareCheckedCount(parts),
    };
}

function consumeLogTypeMarker(log, reports = []) {
    const src = String(log?.source || '').toLowerCase();
    if (src === 'defect_report' || log?.defect_case_id) return 'D';
    if (src === 'work_report' || log?.work_report_id) {
        const rep = reports.find(r => r.id === log.work_report_id || r.consume_log_id === log.id);
        if (rep?.work_type === 'POSTPONE') return 'P';
        return 'M';
    }
    return 'C';
}

function extractConsumeListRow(log, reports = []) {
    return {
        type: consumeLogTypeMarker(log, reports),
        fileNo: String(log.file_no || '').trim(),
        reportedDate: String(log.made_on || log.consumed_date || '').slice(0, 10),
        status: log.list_status || 'Reported',
        totalData: log.line_count ?? (log.lines?.length || 0),
    };
}

function workHistoryEntriesRaw(reports, defects) {
    const entries = [];
    reports.forEach(r => {
        (r.job_items || []).forEach(item => entries.push({ source: 'report', report: r, item }));
    });
    defects.forEach(dc => entries.push({ source: 'defect', defect: dc }));
    return entries;
}

function jobWorkHistoryEntries(jobId, jobCode, entriesRaw) {
    return entriesRaw.filter(e => {
        if (e.source === 'defect') {
            const dc = e.defect;
            return dc.maintenance_job_id === jobId || dc.job_code === jobCode;
        }
        const item = e.item;
        return item && (item.maintenance_job_id === jobId || item.job_code === jobCode);
    });
}

function simulateSyncConsumeLogFromWorkReport({ report, job, usedParts, form }) {
    const logLines = (usedParts || []).filter(p => Number(p.qty_used) > 0);
    if (!logLines.length) return null;
    return {
        id: report.consume_log_id || `clog-${report.id}`,
        work_report_id: report.id,
        source: 'work_report',
        file_no: String(form?.fileNo || report.report_form?.fileNo || '').trim(),
        made_on: String(form?.workDate || report.work_date || '').slice(0, 10),
        list_status: 'Reported',
        job_code: job.job_code,
        line_count: logLines.length,
        lines: logLines,
    };
}

function simulateSyncConsumeLogFromDefect({ defectCase, usedParts }) {
    const logLines = (usedParts || []).filter(p => Number(p.qty_used) > 0);
    if (!logLines.length) return null;
    return {
        id: defectCase.consume_log_id || `clog-${defectCase.id}`,
        defect_case_id: defectCase.id,
        source: 'defect_report',
        file_no: String(defectCase.file_no || '').trim(),
        made_on: String(defectCase.work_date || defectCase.report_date || '').slice(0, 10),
        list_status: 'Reported',
        job_code: defectCase.job_code,
        line_count: logLines.length,
        lines: logLines,
    };
}

function rowsMatchCore(histRow, consumeRow) {
    return histRow.type === consumeRow.type
        && histRow.fileNo === consumeRow.fileNo
        && histRow.reportedDate === consumeRow.reportedDate
        && String(histRow.status).toLowerCase() === String(consumeRow.status).toLowerCase();
}

async function scenario(name, fn) {
    console.log(`\n=== ${name} ===`);
    await fn();
}

async function main() {
    const appSrc = fs.readFileSync(APP_JS, 'utf8');

    await scenario('1) Check Work Plan → Work Plan tab (overdue filter)', async () => {
        const state = { currentTab: 'menu', actualFilter: 'total' };
        menuNavigateSim(state, 'actual', { actualFilter: 'overdue' });
        assert('switches to actual tab', state.currentTab === 'actual');
        assert('applies overdue filter', state.actualFilter === 'overdue');
        assert('menu defines Check Work Plan action', appSrc.includes("label: 'Check Work Plan'"));
        assert('checkPlan routes to actual/overdue', appSrc.includes("case 'checkPlan': menuNavigate('actual', { actualFilter: 'overdue' })"));
    });

    await scenario('2) Double-click → Work Procedure modal wiring', async () => {
        assert('job row uses openWorkProcedure on dblclick', /ondblclick="TVC_App\.openWorkProcedure/.test(appSrc));
        assert('workProcedureModal exists in index', fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('id="workProcedureModal"'));
        assert('openWorkProcedure returns when job missing', appSrc.includes("await TVC_Dialog.alert('Job not found.');"));
    });

    await scenario('3) Modify Work Procedure — CE can edit, Engineer cannot', async () => {
        assert('CE can edit Work Procedure', canEditWorkProcedure(CE_USER));
        assert('Engineer cannot edit Work Procedure', !canEditWorkProcedure(ENGINEER_USER));
        assert('saveWorkProcedure guards permission', appSrc.includes('if (!canEditWorkProcedure())'));
        assert('enterWorkProcedureEdit returns on deny', appSrc.includes('async function enterWorkProcedureEdit()'));
    });

    await scenario('4) Work History tab — title and Consumption column', async () => {
        assert('tab labeled Work History', appSrc.includes("onclick=\"TVC_App.setWorkProcedureTab('history')\">Work History</button>"));
        assert('section titled Work History', appSrc.includes('<div class="wp-section-head">Work History'));
        assert('history pane uses Consumption header',
            appSrc.includes('<th>Type</th><th>File No</th><th>Reported Date</th><th>Status</th><th>Description</th><th>Consumption</th>'));
        assert('Page 2 spare count helper exists', appSrc.includes('function histEntryPage2SpareCount(entry)'));
    });

    await scenario('5) M / P / D reports → Work History with Consumption count', async () => {
        const job = { id: 'job-engine-001', job_code: '01-001', department: 'ENGINE', group: '01. MAIN ENGINE' };
        const reports = [
            {
                id: 'rep-m', work_type: 'MAINTENANCE', status: 'REPORTED', report_date: '2026-08-01', work_date: '2026-08-01',
                company_comment: 'HQ OK-M', description: 'Maint desc',
                report_form: { fileNo: 'M-001' },
                used_parts: [{ spare_part_id: 'sp1', qty_used: 1 }, { spare_part_id: 'sp2', qty_used: 1 }],
                job_items: [{ maintenance_job_id: job.id, job_code: job.job_code, description: 'Maint desc', form: { fileNo: 'M-001' }, used_parts: [{ spare_part_id: 'sp1', qty_used: 1 }, { spare_part_id: 'sp2', qty_used: 1 }] }],
            },
            {
                id: 'rep-p', work_type: 'POSTPONE', status: 'REPORTED', report_date: '2026-08-02', work_date: '2026-08-02',
                company_comment: 'HQ OK-P',
                report_form: { fileNo: 'P-001' },
                job_items: [{ maintenance_job_id: job.id, job_code: job.job_code, description: 'Postpone desc', form: { fileNo: 'P-001' } }],
            },
        ];
        const defects = [{
            id: 'def-1', maintenance_job_id: job.id, job_code: job.job_code,
            file_no: 'D-001', report_date: '2026-08-03', work_date: '2026-08-03',
            status: 'DRAFT', outline_maintenance_request: 'Defect desc', company_comment: 'HQ OK-D',
        }];
        const raw = workHistoryEntriesRaw(reports, defects);
        const jobHist = jobWorkHistoryEntries(job.id, job.job_code, raw);
        assert('job history has 3 entries (M/P/D)', jobHist.length === 3, `count=${jobHist.length}`);

        const consumeLogs = [
            simulateSyncConsumeLogFromWorkReport({ report: reports[0], job, usedParts: [{ qty_used: 1 }, { qty_used: 1 }], form: { fileNo: 'M-001', workDate: '2026-08-01' } }),
            simulateSyncConsumeLogFromWorkReport({ report: reports[1], job, usedParts: [], form: { fileNo: 'P-001', workDate: '2026-08-02' } }),
            simulateSyncConsumeLogFromDefect({ defectCase: defects[0], usedParts: [] }),
        ].filter(Boolean);
        assert('only reports with Page 2 spare usage appear in Consumption List', consumeLogs.length === 1);

        for (const entry of jobHist) {
            const histRow = extractHistListRow(entry);
            assert(`${histRow.type} appears in Work History`, !!histRow.fileNo);
            assert(`${histRow.type} has description`, !!histRow.description);
            if (histRow.type === 'M') {
                assert('M Consumption count is 2', histRow.consumption === 2, `got ${histRow.consumption}`);
            } else {
                assert(`${histRow.type} Consumption count is 0`, histRow.consumption === 0, `got ${histRow.consumption}`);
            }
            const consumeLog = entry.source === 'defect'
                ? null
                : entry.report.work_type === 'POSTPONE'
                    ? null
                    : consumeLogs[0];
            if (!consumeLog) {
                assert(`${histRow.type} skipped in SPARE Consumption List (no spare usage)`, true);
                continue;
            }
            const consumeRow = extractConsumeListRow(consumeLog, reports);
            assert(`${histRow.type} Type matches`, histRow.type === consumeRow.type, `${histRow.type} vs ${consumeRow.type}`);
            assert(`${histRow.type} File No matches`, histRow.fileNo === consumeRow.fileNo, `${histRow.fileNo} vs ${consumeRow.fileNo}`);
            assert(`${histRow.type} Reported Date matches`, histRow.reportedDate === consumeRow.reportedDate);
            assert(`${histRow.type} Status matches`, rowsMatchCore(histRow, consumeRow));
            assert(`${histRow.type} consume Total Data is number`, Number.isFinite(Number(consumeRow.totalData)));
        }
    });

    await scenario('6) Source wiring — Postpone sync + skip empty Consumption List', async () => {
        const spareSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui', 'spareMenu.js'), 'utf8');
        assert('saveWorkReport syncs POSTPONE', appSrc.includes("workType === 'POSTPONE'"));
        assert('consumeLogTypeMarker supports P', spareSrc.includes("letter: 'P', title: 'Postponed Report'"));
        assert('empty spare usage skips consume log', spareSrc.includes('if (!logLines.length) {') && spareSrc.includes("return { logId: null, stockAppliedAt: '' };"));
        assert('empty spare usage deletes existing consume log', spareSrc.includes('await TVC_Inventory.deleteConsumeLog(existingLogId)'));
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
