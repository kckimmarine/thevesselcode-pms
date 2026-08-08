#!/usr/bin/env node
/**
 * Critical Postpone — Confirm 시 Work Plan NEXT DATE 반영 (Company Approved는 별도)
 * Usage: npm run test-critical-postpone-confirm
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadModule(relPath, exportName) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
        + `\nglobalThis.__loaded_${exportName} = ${exportName};`;
    eval(code);
    return globalThis[`__loaded_${exportName}`];
}

const RBAC = loadModule('js/rbac.js', 'TVC_RBAC');

let pass = 0;
let fail = 0;
function assert(name, cond, detail = '') {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

function workReportListWorkflowStatus(report) {
    if (report.sync_status === 'SYNCED') return 'Submitted';
    const st = RBAC.normalizeReportStatus(report.status, report.is_locked);
    if (st === 'APPROVED') return 'Approved';
    if (st === 'CONFIRMED') return 'Confirmed';
    return 'Reported';
}

function postponeRequiresCompanyApproval(report) {
    return report?.work_type === 'POSTPONE' && report.requires_company_approval === true;
}

/** Mirror of app.js isMonthlyRhGateEntryReady (post-change) */
function isMonthlyRhGateEntryReady(report, item) {
    const label = workReportListWorkflowStatus(report);
    if (label !== 'Confirmed' && label !== 'Submitted' && label !== 'Approved') return false;
    const itemSt = item ? RBAC.normalizeReportStatus(item.status, report.is_locked) : null;
    if (itemSt === 'REPORTED') return false;
    return true;
}

/** Mirror of applyActiveReportSchedules postpone branch (post-change) */
function applyPostponeNextDate(report, job) {
    if (!RBAC.isReportedStatus(report.status) && !RBAC.isConfirmedStatus(report.status)
        && !RBAC.isApprovedStatus(report.status, report.is_locked)) {
        return null;
    }
    const form = report.report_form || {};
    const postponeDate = String(
        report.approved_postpone_date || report.postpone_date || form.postponeDate || '',
    ).slice(0, 10);
    if (!postponeDate) return null;
    return { next_date: postponeDate, schedule_basis: 'POSTPONE' };
}

console.log('\n=== Critical Postpone — Confirm → Work Plan ===\n');

const txSrc = fs.readFileSync(path.join(ROOT, 'js/services/transaction.js'), 'utf8');
assert('criticalPostponeScheduleBlocked removed', !txSrc.includes('criticalPostponeScheduleBlocked'));

const criticalConfirmed = {
    work_type: 'POSTPONE',
    requires_company_approval: true,
    status: 'CONFIRMED',
    is_locked: false,
    postpone_date: '2026-10-15',
    job_items: [{ status: 'CONFIRMED', maintenance_job_id: 'j1' }],
};
const job = { id: 'j1', job_code: 'E-001', next_date: '2026-08-01' };

console.log('[RH gate — Confirmed critical passes]');
assert('Confirmed critical → RH gate ready', isMonthlyRhGateEntryReady(criticalConfirmed, criticalConfirmed.job_items[0]));
assert('Reported critical → RH gate blocked', !isMonthlyRhGateEntryReady(
    { ...criticalConfirmed, status: 'REPORTED', job_items: [{ status: 'REPORTED' }] },
    { status: 'REPORTED' },
));

console.log('\n[Work Plan — Confirm applies NEXT DATE]');
const applied = applyPostponeNextDate(criticalConfirmed, job);
assert('Confirmed critical → NEXT DATE applied', applied?.next_date === '2026-10-15');
assert('schedule_basis POSTPONE', applied?.schedule_basis === 'POSTPONE');

console.log('\n[Company Approved — date correction on approve]');
const approved = {
    ...criticalConfirmed,
    status: 'APPROVED',
    is_locked: true,
    approved_postpone_date: '2026-11-01',
};
const appliedApproved = applyPostponeNextDate(approved, job);
assert('Approved → uses approved_postpone_date', appliedApproved?.next_date === '2026-11-01');
assert('requires_company_approval flag preserved', postponeRequiresCompanyApproval(criticalConfirmed));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
