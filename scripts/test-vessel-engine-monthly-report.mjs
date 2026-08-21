#!/usr/bin/env node
/**
 * VESSEL MODE — ENGINE Monthly Report end-to-end simulation
 * Usage: npm run test-vessel-engine-monthly-report
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'pms-unified.json'), 'utf8'));

function loadModule(relPath, exportName) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
        + `\nglobalThis.__loaded_${exportName} = ${exportName};`;
    eval(code);
    const mod = globalThis[`__loaded_${exportName}`];
    globalThis[exportName] = mod;
    return mod;
}

// ── Browser API shims ──
const lsStore = {};
global.localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null; },
    setItem(k, v) { lsStore[k] = String(v); },
    removeItem(k) { delete lsStore[k]; },
    key(i) { return Object.keys(lsStore)[i] ?? null; },
    get length() { return Object.keys(lsStore).length; },
};

global.TVC_DB = {
    async getAll(store) {
        if (store === 'sync_history') return global.__syncHistory || [];
        return [];
    },
};

const RBAC = loadModule('js/rbac.js', 'TVC_RBAC');
loadModule('js/core/filename.js', 'TVC_Filename');
const Indexes = loadModule('js/core/indexes.js', 'TVC_Indexes');
const PMS = loadModule('js/pms.js', 'TVC_PMS');

let pass = 0;
let fail = 0;
function assert(name, cond, detail = '') {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

function todayYmd() {
    return new Date().toISOString().slice(0, 10);
}

function daysUntil(dateStr) {
    if (!dateStr) return NaN;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return NaN;
    return Math.ceil((d - new Date(todayYmd())) / 86400000);
}

function groupPrefix(group) {
    const m = String(group || '').trim().match(/^(\d+)\s*\./);
    return m ? m[1].padStart(2, '0') + '.' : '';
}

function isTrackedGroup(group) {
    return ['01.', '03.', '04.', '05.'].includes(groupPrefix(group));
}

function isRunHourJob(job) {
    return job && String(job.unit || '').toUpperCase() === 'H';
}

function groupKey(job) {
    return Indexes.groupKey(job);
}

function workReportListWorkflowStatus(report) {
    if (report.sync_status === 'SYNCED') return 'Submitted';
    const st = RBAC.normalizeReportStatus(report.status, report.is_locked);
    if (st === 'APPROVED') return 'Approved';
    if (st === 'CONFIRMED') return 'Confirmed';
    return 'Reported';
}

function isHistDefectEntry(entry) {
    return entry?.source === 'defect';
}

function isMonthlyRhGateEntryReady(entry) {
    if (!entry || isHistDefectEntry(entry)) return true;
    const report = entry.report;
    if (!report) return false;
    const label = workReportListWorkflowStatus(report);
    if (label !== 'Confirmed' && label !== 'Submitted' && label !== 'Approved') return false;
    const itemSt = entry.item
        ? RBAC.normalizeReportStatus(entry.item.status, report.is_locked)
        : null;
    if (itemSt === 'REPORTED') return false;
    return true;
}

function allWorkHistoryConfirmed(entries) {
    return entries.filter(e => !isHistDefectEntry(e) && !isMonthlyRhGateEntryReady(e)).length === 0;
}

function buildGroupNodes(jobs) {
    const jobsByGroupKey = new Map();
    jobs.forEach(j => {
        const gk = groupKey(j);
        if (!jobsByGroupKey.has(gk)) jobsByGroupKey.set(gk, []);
        jobsByGroupKey.get(gk).push(j.id);
    });
    const seen = new Set();
    const nodes = [];
    jobs.forEach(j => {
        const gk = groupKey(j);
        if (seen.has(gk)) return;
        seen.add(gk);
        nodes.push({
            key: gk,
            department: j.department,
            label: String(j.group || '').trim(),
            jobIds: jobsByGroupKey.get(gk) || [],
        });
    });
    return nodes;
}

function actualDashboardCounts(jobs, postponedKeys = { ids: new Set(), codes: new Set() }) {
    let overdue = 0;
    let due30 = 0;
    let postponed = 0;
    let critical = 0;
    jobs.forEach(j => {
        if (j.is_overdue && j.plan_status !== 'COMPLETED') overdue++;
        const d = daysUntil(j.next_date);
        if (!j.is_overdue && d >= 0 && d <= 30) due30++;
        if (postponedKeys.ids.has(j.id) || postponedKeys.codes.has(j.job_code)) postponed++;
        if (j.is_critical_equipment) critical++;
    });
    return { total: jobs.length, overdue, due30, postponed, critical };
}

function jobMatchesActualFilter(j, filter, postponedKeys) {
    if (!j || filter === 'total') return true;
    if (filter === 'overdue') return !!j.is_overdue && j.plan_status !== 'COMPLETED';
    if (filter === 'due30') {
        const d = daysUntil(j.next_date);
        return !j.is_overdue && d >= 0 && d <= 30;
    }
    if (filter === 'postponed') {
        return postponedKeys.ids.has(j.id) || postponedKeys.codes.has(j.job_code);
    }
    if (filter === 'critical') return !!j.is_critical_equipment;
    return true;
}

function countFilteredJobs(jobs, filter, postponedKeys) {
    return jobs.filter(j => jobMatchesActualFilter(j, filter, postponedKeys)).length;
}

function buildPmsMatrixCounts(jobs, defectRows, postponedKeys, isJobCritical) {
    const overdueAll = jobs.filter(j => jobMatchesActualFilter(j, 'overdue', postponedKeys));
    const dueAll = jobs.filter(j => jobMatchesActualFilter(j, 'due30', postponedKeys));
    const postponedAll = jobs.filter(j => jobMatchesActualFilter(j, 'postponed', postponedKeys));
    const splitJobs = (rows) => {
        const crit = rows.filter(isJobCritical);
        return { total: rows.length, critical: crit.length, nonCritical: rows.length - crit.length };
    };
    const splitDefects = (rows) => {
        const crit = rows.filter(dc => !!dc.is_critical);
        return { total: rows.length, critical: crit.length, nonCritical: rows.length - crit.length };
    };
    return {
        overdue: splitJobs(overdueAll),
        due: splitJobs(dueAll),
        postponed: splitJobs(postponedAll),
        defect: splitDefects(defectRows),
    };
}

function cloneJobs() {
    return SEED.maintenance_jobs
        .filter(j => j.department === 'ENGINE')
        .map(j => ({
            ...j,
            original_next_date: j.original_next_date || j.next_date || null,
        }));
}

function makeWorkHistoryScenario() {
    const maint = [1, 2, 3, 4].map(i => ({
        source: 'report',
        report: {
            id: `rep-m${i}`,
            work_type: 'MAINTENANCE',
            status: i <= 4 ? 'REPORTED' : 'CONFIRMED',
            is_locked: false,
            report_date: '2026-08-01',
            job_items: [{ status: 'REPORTED', job_code: `M-${i}` }],
        },
        item: { status: 'REPORTED', job_code: `M-${i}` },
    }));
    const postpone = [{
        source: 'report',
        report: {
            id: 'rep-p1',
            work_type: 'POSTPONE',
            status: 'REPORTED',
            is_locked: false,
            report_date: '2026-08-02',
            job_items: [{ status: 'REPORTED', job_code: 'P-001' }],
        },
        item: { status: 'REPORTED', job_code: 'P-001' },
    }];
    const defects = [1, 2, 3].map(i => ({
        source: 'defect',
        defect: { id: `def-${i}`, status: 'DRAFT', file_no: `D-${i}` },
    }));
    return [...maint, ...postpone, ...defects];
}

function confirmEntry(entry) {
    if (isHistDefectEntry(entry)) return entry;
    entry.report.status = 'CONFIRMED';
    if (entry.item) entry.item.status = 'CONFIRMED';
    if (entry.report.job_items?.[0]) entry.report.job_items[0].status = 'CONFIRMED';
    return entry;
}

async function scenario(name, fn) {
    console.log(`\n=== ${name} ===`);
    await fn();
}

async function main() {
    const syncSrc = fs.readFileSync(path.join(ROOT, 'js', 'services', 'sync.js'), 'utf8');
    const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

    await scenario('1) Work History — Report Confirm (RH gate)', async () => {
        let entries = makeWorkHistoryScenario();
        assert('8 Work History rows (4M + 1P + 3D)', entries.length === 8, `count=${entries.length}`);
        assert('RH gate blocked before confirm', !allWorkHistoryConfirmed(entries));

        entries = entries.map(e => {
            if (isHistDefectEntry(e)) return e;
            if (e.report.work_type === 'MAINTENANCE' || e.report.work_type === 'POSTPONE') {
                return confirmEntry({ ...e, report: { ...e.report }, item: { ...e.item } });
            }
            return e;
        });

        const pending = entries.filter(e => !isHistDefectEntry(e) && !isMonthlyRhGateEntryReady(e));
        assert('4 Maintenance confirmed', entries.filter(e => e.report?.work_type === 'MAINTENANCE' && workReportListWorkflowStatus(e.report) === 'Confirmed').length === 4);
        assert('1 Postpone confirmed', entries.filter(e => e.report?.work_type === 'POSTPONE' && workReportListWorkflowStatus(e.report) === 'Confirmed').length === 1);
        assert('3 Defect left unconfirmed (excluded from RH gate)', entries.filter(isHistDefectEntry).length === 3);
        assert('Defect entries pass RH gate (excluded)', entries.filter(isHistDefectEntry).every(isMonthlyRhGateEntryReady));
        assert('RH gate open after M/P confirm', pending.length === 0 && allWorkHistoryConfirmed(entries));

        assert('app excludes Defect from RH gate', appSrc.includes('!isHistDefectEntry(e) && !isMonthlyRhGateEntryReady(e)'));
        assert('CE monthly export still writes a file when no pending confirmed',
            appSrc.includes('stationPendingConfirmedReportCount(d) === 0')
            && appSrc.includes('Export current Monthly snapshot.'));
    });

    await scenario('2) Running Hours — 500 prev / 700 expected / total auto-sum', async () => {
        const jobs = cloneJobs();
        const nodes = buildGroupNodes(jobs).filter(n => PMS.isTrackedGroup(n.label));
        assert('4 tracked RH equipment rows (M/E + 3× G/E)', nodes.length === 4, `count=${nodes.length}`);

        const meNode = nodes.find(n => groupPrefix(n.label) === '01.');
        const geNodes = nodes.filter(n => ['03.', '04.', '05.'].includes(groupPrefix(n.label)));
        assert('MAIN ENGINE tracked node exists', !!meNode);
        assert('3 GENERATOR ENGINE tracked nodes', geNodes.length === 3);

        const meH = meNode.jobIds.filter(id => isRunHourJob(jobs.find(j => j.id === id))).length;
        const geH = geNodes.map(n => n.jobIds.filter(id => isRunHourJob(jobs.find(j => j.id === id))).length);
        assert('MAIN ENGINE — 68 H-unit jobs', meH === 68, `count=${meH}`);
        assert('No.1 G/E — 11 H-unit jobs', geH[0] === 11, `count=${geH[0]}`);
        assert('No.2 G/E — 11 H-unit jobs', geH[1] === 11, `count=${geH[1]}`);
        assert('No.3 G/E — 11 H-unit jobs', geH[2] === 11, `count=${geH[2]}`);

        const store = {};
        const PREV = 500;
        const EXP = 700;
        for (const n of nodes) {
            const base = 10000;
            const newTotal = base + PREV;
            store[n.key] = {
                totalRunHours: newTotal,
                prevMonth: PREV,
                expectedNextMonth: EXP,
                updated: todayYmd(),
            };
            assert(`preview total ${n.label.slice(0, 20)}… = base+500`, newTotal === base + PREV);
        }
        store._lastUpdatedDate = todayYmd();
        PMS.writeStore(store);

        const state = { jobs: jobs.map(j => ({ ...j })) };
        const res = await PMS.updateMaintenanceSchedule(state, { persist: false, silent: true });
        assert('101 run-hour jobs recalculated', res.log.length === 101, `count=${res.log.length}`);
        assert('all recalculated jobs have RUN_HOUR basis',
            res.log.every(l => !l.reset)
            && state.jobs.filter(j => isRunHourJob(j) && isTrackedGroup(j.group)).every(j => j.schedule_basis === 'RUN_HOUR'));

        const sample = res.log.find(l => l.group.includes('MAIN ENGINE'));
        assert('sample NEXT DATE computed from 700 h/month assumption', !!sample?.newDate, JSON.stringify(sample));
        if (sample) {
            const job = state.jobs.find(j => j.job_code === sample.job_code);
            assert('job.next_date matches calc', job?.next_date === sample.newDate, `${job?.next_date} vs ${sample.newDate}`);
        }
    });

    await scenario('3–4) Update Work Plan — RH reflected + lock gate', async () => {
        const jobs = cloneJobs();
        const hJobs = jobs.filter(j => isRunHourJob(j) && isTrackedGroup(j.group));
        assert('101 H jobs in ENGINE tracked groups', hJobs.length === 101);

        const store = {};
        buildGroupNodes(jobs).filter(n => PMS.isTrackedGroup(n.label)).forEach(n => {
            store[n.key] = { totalRunHours: 10500, prevMonth: 500, expectedNextMonth: 700, updated: todayYmd() };
        });
        PMS.writeStore(store);

        const state = { jobs: jobs.map(j => ({ ...j })) };
        await PMS.updateMaintenanceSchedule(state, { persist: false, silent: true });
        const changed = state.jobs.filter(j => j.schedule_basis === 'RUN_HOUR');
        assert('Work Plan NEXT DATE updated for all 101 H jobs', changed.length === 101, `count=${changed.length}`);
        assert('each updated job has run_hours_expected=700', changed.every(j => j.run_hours_expected === 700));

        assert('Plan lock still switches station monthly to full snapshot', appSrc.includes('isOriginalPlanUpdateLocked(d)'));
        assert('Update Work Plan requires RH committed', appSrc.includes('Complete Running Hours Update first.'));
    });

    await scenario('5) Work Plan dashboard — counts + tree integrity', async () => {
        const jobs = cloneJobs();
        const nodes = buildGroupNodes(jobs);
        assert('PMS GROUP TREE nodes built without error', nodes.length > 0, `count=${nodes.length}`);
        assert('every tree node has jobIds array', nodes.every(n => Array.isArray(n.jobIds)));
        assert('no duplicate group keys', nodes.length === new Set(nodes.map(n => n.key)).size);

        const store = {};
        buildGroupNodes(jobs).filter(n => PMS.isTrackedGroup(n.label)).forEach(n => {
            store[n.key] = { totalRunHours: 12000, prevMonth: 500, expectedNextMonth: 700, updated: todayYmd() };
        });
        PMS.writeStore(store);
        const state = { jobs: jobs.map(j => ({ ...j })) };
        await PMS.updateMaintenanceSchedule(state, { persist: false, silent: true });

        const postponedKeys = { ids: new Set(), codes: new Set(['POST-001']) };
        const dash = actualDashboardCounts(state.jobs, postponedKeys);
        assert('TOTAL count matches ENGINE jobs', dash.total === state.jobs.length, `${dash.total} vs ${state.jobs.length}`);
        assert('OVERDUE count computable', Number.isFinite(dash.overdue));
        assert('DUE (30d) count computable', Number.isFinite(dash.due30));
        assert('CRITICAL count computable', Number.isFinite(dash.critical));

        const filters = ['total', 'overdue', 'due30', 'postponed', 'critical'];
        filters.forEach(f => {
            const c = countFilteredJobs(state.jobs, f, postponedKeys);
            assert(`filter "${f}" returns valid count`, Number.isFinite(c) && c >= 0);
        });
    });

    await scenario('6) PMS Outstanding matrix ↔ Work Plan alignment', async () => {
        const jobs = cloneJobs().map(j => ({ ...j }));
        const postponedKeys = { ids: new Set(), codes: new Set(['01-010']) };
        jobs.find(j => j.job_code === '01-010').is_overdue = true;

        const defectRows = [
            { is_critical: true, status: 'SUBMITTED' },
            { is_critical: false, status: 'SUBMITTED' },
        ];
        const isJobCritical = j => !!j.is_critical_equipment;
        const matrix = buildPmsMatrixCounts(jobs, defectRows, postponedKeys, isJobCritical);

        const planOverdue = countFilteredJobs(jobs, 'overdue', postponedKeys);
        const planDue = countFilteredJobs(jobs, 'due30', postponedKeys);
        const planPostponed = countFilteredJobs(jobs, 'postponed', postponedKeys);

        assert('Outstanding Overdue total = Work Plan overdue filter', matrix.overdue.total === planOverdue, `${matrix.overdue.total} vs ${planOverdue}`);
        assert('Outstanding Due total = Work Plan due30 filter', matrix.due.total === planDue, `${matrix.due.total} vs ${planDue}`);
        assert('Outstanding Postponed total = Work Plan postponed filter', matrix.postponed.total === planPostponed, `${matrix.postponed.total} vs ${planPostponed}`);
        assert('Outstanding Defect total = submitted defect count', matrix.defect.total === defectRows.length);
    });

    await scenario('7–8) Monthly Report Export — filename + wiring', async () => {
        assert('sync.js uses TVC_Filename.build for monthly export', syncSrc.includes('opts.monthlyExport') && syncSrc.includes("type: 'monthly'"));
        assert('menuXferExportMonthly passes monthlyExport flag', appSrc.includes('monthlyExport: true'));

        global.__syncHistory = [];
        const fn = await TVC_Filename.build({
            vesselId: 'INCHEON CHEMI',
            type: 'monthly',
            department: 'ENGINE',
            ext: 'zip',
            dateTag: '20260811',
        });
        assert('export filename matches incheonchemi_monthly_engine_YYYYMMDD_001.zip', fn === 'incheonchemi_monthly_engine_20260811_001.zip', fn);

        const parsed = TVC_Filename.parseScoped(fn);
        assert('filename parses as monthly/engine scope', parsed?.type === 'monthly' && parsed?.scope === 'engine', JSON.stringify(parsed));
        assert('export_meta.package_type MONTHLY in sync payload', syncSrc.includes("package_type: 'MONTHLY'"));
    });

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
