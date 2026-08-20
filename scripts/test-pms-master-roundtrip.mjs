#!/usr/bin/env node
/**
 * PMS Master Excel round-trip regression tests
 * Usage: npm run test-pms-master-roundtrip
 */
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SEED_PATH = path.join(ROOT, 'data', 'pms-unified.json');

const DECK_LEGACY_CATALOG = [
    { legacy: 26, no: '01', name: 'CARGO TANK MONITORING SYSTEM' },
    { legacy: 28, no: '02', name: 'LSA/FFE' },
];
const LEGACY_DECK_NOS = new Set([26, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
function usesLegacyDeckGroupNumber(label) {
    const m = norm(label).match(/^(\d{1,2})\./);
    const leg = m ? parseInt(m[1], 10) : null;
    return leg != null && LEGACY_DECK_NOS.has(leg);
}
const DECK_LEGACY_MAP = new Map(DECK_LEGACY_CATALOG.map(c => [c.legacy, c]));
const FORCE_ENGINE_GROUP_NOS = new Set([24, 25]);
const JOB_DEPT_OVERRIDES = {
    '26-001': 'DECK',
    '26-002': 'DECK',
    '26-003': 'ENGINE',
    '26-004': 'ENGINE',
};

function norm(s) { return String(s ?? '').replace(/\s+/g, ' ').trim(); }
function pmsGroupNoFromLabel(label) {
    const mm = String(label || '').trim().match(/^(\d+)\s*\./);
    return mm ? parseInt(mm[1], 10) : null;
}
function legacyGroupNum(label) {
    const m = norm(label).match(/^(\d{1,2})\./);
    return m ? parseInt(m[1], 10) : null;
}
function splitGroupLabel(label) {
    const s = norm(label);
    const m = s.match(/^(\d{1,2})\.\s*(.+)$/);
    if (m) return { no: m[1], name: norm(m[2]) };
    return { no: '', name: s };
}
function isLegacyDeckGroupLabel(groupLabel) {
    const leg = legacyGroupNum(groupLabel);
    if (leg == null) return false;
    const hit = DECK_LEGACY_MAP.get(leg);
    if (!hit) return false;
    const sg = splitGroupLabel(groupLabel);
    return norm(sg.name).toUpperCase() === norm(hit.name).toUpperCase();
}
function forceDeptForGroupLabel(label) {
    const n = pmsGroupNoFromLabel(label);
    if (n != null && FORCE_ENGINE_GROUP_NOS.has(n)) return 'ENGINE';
    if (label && isLegacyDeckGroupLabel(label)) return 'DECK';
    return null;
}
function forceDeptForGroup26Job(job) {
    const groupStr = String(job?.group || '').toUpperCase();
    if (groupStr.includes('CARGO TANK') && groupStr.includes('F.O TANK')) return null;
    const itemStr = String(job?.item_sort1 || '').toUpperCase();
    const pathStr = `${groupStr}\0${itemStr}`;
    if (pathStr.includes('F.O TANK')) return 'ENGINE';
    if (pathStr.includes('CARGO TANK')) return 'DECK';
    return null;
}
function forceDeptForJob(job) {
    if (job?.master_import_at) return null;
    const fromSplit26 = forceDeptForGroup26Job(job);
    if (fromSplit26) return fromSplit26;
    const code = String(job?.job_code || '').trim().toUpperCase();
    if (JOB_DEPT_OVERRIDES[code]) return JOB_DEPT_OVERRIDES[code];
    const dept = String(job?.department || '').toUpperCase();
    if (dept === 'ENGINE') return null;
    return forceDeptForGroupLabel(job?.group);
}
function normalizeGroupDepartments(jobs) {
    for (const j of jobs) {
        const target = forceDeptForJob(j);
        if (target != null && j.department !== target) j.department = target;
    }
}
function filterEngineView(jobs) {
    return jobs.filter(j => j.department === 'ENGINE');
}

function createMockDb(seed) {
    const stores = {
        maintenance_jobs: new Map((seed.maintenance_jobs || []).map(j => [j.id, { ...j }])),
        maintenance_groups: new Map((seed.maintenance_groups || []).map(g => [g.id, { ...g }])),
        ship_components: new Map((seed.ship_components || []).map(c => [c.id, { ...c }])),
        daily_work_reports: new Map(),
        defect_cases: new Map(),
        job_bom: new Map(),
        audit_logs: new Map(),
        meta: new Map(Object.entries({
            vessel_id: seed.meta?.vessel_id || 'INCHEON CHEMI',
        })),
    };
    let auditSeq = 1;

    return {
        stores,
        async getAll(store) {
            return [...(stores[store]?.values() || [])];
        },
        async get(store, id) {
            return stores[store]?.get(id) ?? null;
        },
        async put(store, row) {
            if (!stores[store]) stores[store] = new Map();
            if (store === 'audit_logs') stores[store].set(String(auditSeq++), row);
            else stores[store].set(row.id || row.key, row);
        },
        async del(store, id) {
            stores[store]?.delete(id);
        },
        async bulkPut(store, rows) {
            for (const row of rows) await this.put(store, row);
        },
        async getMeta(key) {
            return stores.meta.get(key) ?? null;
        },
        async setMeta(key, value) {
            stores.meta.set(key, value);
        },
        cloneJobs() {
            return [...stores.maintenance_jobs.values()].map(j => ({ ...j }));
        },
    };
}

function loadPmsMasterExcel() {
    global.ExcelJS = ExcelJS;
    if (!global.crypto?.randomUUID) {
        global.crypto = { randomUUID };
    }
    global.TVC_META_KEYS = {
        VESSEL_ID: 'vessel_id',
        PMS_MASTER_IMPORTED: 'pms_master_imported_at',
    };
    global.TVC_RBAC = {
        assertModifyOriginalPlan() {},
        normalizeReportStatus: (s) => s,
    };
    global.TVC_WorkReport = { fromLegacy(r) { return r; } };
    global.TVC_DB = null;

    const code = fs.readFileSync(path.join(ROOT, 'js', 'services', 'pmsMasterExcel.js'), 'utf8')
        + '\nglobalThis.__TVC_PmsMasterExcel = TVC_PmsMasterExcel;';
    eval(code);
    return globalThis.__TVC_PmsMasterExcel;
}

function loadTvcPms(scope = 'SHIP', vesselId = 'INCHEON CHEMI') {
    const storage = {};
    global.localStorage = {
        getItem(k) { return storage[k] ?? null; },
        setItem(k, v) { storage[k] = String(v); },
        removeItem(k) { delete storage[k]; },
        key(i) { return Object.keys(storage)[i] ?? null; },
        get length() { return Object.keys(storage).length; },
    };
    global.TVC_Indexes = {
        groupKey(job) {
            const g = String(job?.group ?? '').replace(/\s+/g, ' ').trim();
            return `${job.department || ''}|${g}`;
        },
        build(state) {
            const jobsByGroupKey = new Map();
            (state.jobs || []).forEach(j => {
                const gk = this.groupKey(j);
                if (!jobsByGroupKey.has(gk)) jobsByGroupKey.set(gk, []);
                jobsByGroupKey.get(gk).push(j.id);
            });
            return { jobsByGroupKey, groupKey: this.groupKey };
        },
    };
    const code = fs.readFileSync(path.join(ROOT, 'js', 'pms.js'), 'utf8')
        + '\nglobalThis.__TVC_PMS = TVC_PMS;';
    eval(code);
    global.TVC_PMS = globalThis.__TVC_PMS;
    globalThis.__TVC_PMS.setSpace(scope, vesselId);
    return globalThis.__TVC_PMS;
}

function seedRunHourExpected(department, group, expectedNextMonth, scope = 'SHIP') {
    const key = `${department || ''}|${String(group || '').trim()}`;
    const storeKey = scope === 'SHIP' ? 'tvc_run_hrs_SHIP' : `tvc_run_hrs_HQ_${scope.replace(/^HQ_/, '')}`;
    const store = {};
    store[key] = { totalRunHours: 0, prevMonth: 0, expectedNextMonth, updated: null };
    global.localStorage.setItem(storeKey, JSON.stringify(store));
}

const CE_USER = { username: 'ce', display_name: 'Chief engineer', role: 'SHIP_CHIEF', department: 'ENGINE' };
const HQ_USER = { username: 'hq', display_name: 'Superintendent', role: 'HQ_SUPERVISOR', account_type: 'HQ' };
const CAPTAIN_USER = { username: 'captain', display_name: 'Captain', role: 'SHIP_CAPTAIN', department: 'DECK', station: 'CAPTAIN' };
const CO_USER = { username: 'co', display_name: 'Chief officer', role: 'SHIP_CAPTAIN', department: 'DECK', station: 'CCR' };

let pass = 0;
let fail = 0;
function assert(name, cond, detail = '') {
    if (cond) {
        console.log(`  ✓ ${name}`);
        pass++;
    } else {
        console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
        fail++;
    }
}

async function runScenario(name, fn) {
    console.log(`\n=== ${name} ===`);
    await fn();
}

async function exportEngineWorkbook(Pms, db) {
    const jobs = db.cloneJobs().filter(j => j.department === 'ENGINE');
    const groups = (await db.getAll('maintenance_groups')).filter(g => g.department === 'ENGINE');
    return Pms.exportToWorkbook({
        jobs: Pms.renumberJobsForExport(jobs),
        groups,
        vesselId: 'INCHEON CHEMI',
        department: 'ENGINE',
    });
}

async function exportDeckWorkbook(Pms, db) {
    const jobs = db.cloneJobs().filter(j => j.department === 'DECK');
    const groups = (await db.getAll('maintenance_groups')).filter(g => g.department === 'DECK');
    return Pms.exportToWorkbook({
        jobs: Pms.renumberJobsForExport(jobs),
        groups,
        vesselId: 'INCHEON CHEMI',
        department: 'DECK',
    });
}

async function exportImportCycle(Pms, db, user, mutateFn, department = 'ENGINE') {
    const wb = department === 'DECK'
        ? await exportDeckWorkbook(Pms, db)
        : await exportEngineWorkbook(Pms, db);
    if (mutateFn) await mutateFn(wb);
    global.TVC_DB = db;
    const result = await Pms.importFromWorkbook(wb, user, { department });
    const after = db.cloneJobs();
    normalizeGroupDepartments(after);
    return { result, after, wb };
}

async function importWorkbookToDb(Pms, db, wb, user, department) {
    global.TVC_DB = db;
    const result = await Pms.importFromWorkbook(wb, user, { department });
    const after = db.cloneJobs();
    normalizeGroupDepartments(after);
    return { result, after };
}

/** Jobs sheet columns (no JOB_ID) */
const J_COL = {
    DEPT: 1, GNO: 2, GNAME: 3, CODE: 4, S1: 5, S2: 6, DETAIL: 7, PERIOD: 8, UNIT: 9, PIC: 10, LAST: 11,
};

function jobCell(row, col) {
    return String(row.getCell(col).value || '').trim();
}

function setJobCell(ws, rowNo, patch) {
    const HDR = 5;
    const h = {};
    ws.getRow(HDR).eachCell((c, i) => {
        const v = String(c.value || '').trim().toUpperCase();
        if (v) h[v] = i;
    });
    const row = ws.getRow(rowNo);
    const set = (key, val) => {
        const col = h[key.toUpperCase()];
        if (col) row.getCell(col).value = val;
    };
    if (patch.department != null) set('DEPARTMENT', patch.department);
    if (patch.groupNo != null) set('GROUP NO', patch.groupNo);
    if (patch.groupName != null) set('GROUP NAME', patch.groupName);
    if (patch.jobCode != null) set('JOB CODE', patch.jobCode);
    if (patch.jobId != null) set('JOB_ID', patch.jobId);
    if (patch.detail != null) set('JOB DETAIL', patch.detail);
    if (patch.lastDone != null) set('LAST DONE', patch.lastDone);
    if (patch.period != null) set('PERIOD', patch.period);
}

function addGroupHeader(ws, rowNo, row) {
    const HDR = 5;
    ws.getRow(rowNo).getCell(1).value = row.department;
    ws.getRow(rowNo).getCell(2).value = row.groupNo;
    ws.getRow(rowNo).getCell(3).value = row.groupName;
    ws.getRow(rowNo).getCell(8).value = row.jobs ?? 0;
}

async function main() {
    if (!fs.existsSync(SEED_PATH)) {
        console.error('Seed not found:', SEED_PATH);
        process.exit(1);
    }
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    const Pms = loadPmsMasterExcel();

    await runScenario('1) Export → Import round-trip (no mutation)', async () => {
        const db = createMockDb(seed);
        const before = db.cloneJobs().length;
        const { result, after } = await exportImportCycle(Pms, db, HQ_USER, null);
        assert('import completes', result.jobs > 0);
        assert('job count preserved', after.length === before, `before=${before} after=${after.length}`);
        assert('meta flag set', !!(await db.getMeta(TVC_META_KEYS.PMS_MASTER_IMPORTED)));
        assert('imported ENGINE jobs stamped', after.filter(j => j.department === 'ENGINE').every(j => j.master_import_at));
    });

    await runScenario('2) ENGINE group 26 · F.O TANK stays ENGINE after import + load normalize', async () => {
        const db = createMockDb(seed);
        const { after } = await exportImportCycle(Pms, db, CE_USER, async (wb) => {
            const wsJ = wb.getWorksheet('Jobs');
            const wsG = wb.getWorksheet('Group Headers');
            const lastRow = wsJ.lastRow.number + 1;
            const id1 = 'test-fo-tank-001';
            const id2 = 'test-fo-tank-002';
            setJobCell(wsJ, lastRow, {
                jobId: id1,
                department: 'ENGINE',
                groupNo: '26',
                groupName: 'F.O TANK MONITORING SYSTEM',
                jobCode: '26-001',
                detail: 'SYSTEM CHECK & TEST',
            });
            setJobCell(wsJ, lastRow + 1, {
                jobId: id2,
                department: 'ENGINE',
                groupNo: '26',
                groupName: 'F.O TANK MONITORING SYSTEM',
                jobCode: '26-002',
                detail: 'FUNCTION TEST',
            });
            addGroupHeader(wsG, wsG.lastRow.number + 1, {
                department: 'ENGINE', groupNo: '26', groupName: 'F.O TANK MONITORING SYSTEM', jobs: 2,
            });
        });
        const foJobs = after.filter(j =>
            norm(j.group).includes('F.O TANK') && (j.job_code === '26-001' || j.job_code === '26-002')
        );
        const engineView = filterEngineView(after);
        assert('F.O TANK jobs exist', foJobs.length >= 2, `found=${foJobs.length}`);
        assert('F.O TANK 26-001 stays ENGINE', foJobs.some(j => j.job_code === '26-001' && j.department === 'ENGINE'));
        assert('F.O TANK 26-002 stays ENGINE', foJobs.some(j => j.job_code === '26-002' && j.department === 'ENGINE'));
        assert('visible in ENGINE view', engineView.some(j => j.job_code === '26-001' && norm(j.group).includes('F.O TANK')));
    });

    await runScenario('3) Cross-DB JOB_ID mismatch — match by group + detail (Engine SKU scenario)', async () => {
        const localJob = {
            id: 'engine-local-fo-001',
            department: 'ENGINE',
            group: '26. F.O TANK MONITORING SYSTEM',
            job_code: '26-003',
            job_detail: 'ENGINE LOCAL FO TANK CHECK',
            period: 1,
            unit: 'M',
            pic: '1/E',
        };
        const db = createMockDb({ maintenance_jobs: [localJob], maintenance_groups: [], ship_components: [] });
        const wb = await Pms.exportToWorkbook({ jobs: [], groups: [], vesselId: 'INCHEON CHEMI', department: 'ENGINE' });
        const wsJ = wb.getWorksheet('Jobs');
        const rowNo = 6;
        setJobCell(wsJ, rowNo, {
            department: 'ENGINE',
            groupNo: '26',
            groupName: 'F.O TANK MONITORING SYSTEM',
            jobCode: '26-001',
            detail: 'ENGINE LOCAL FO TANK CHECK',
        });
        global.TVC_DB = db;
        await Pms.importFromWorkbook(wb, CE_USER, { department: 'ENGINE' });
        const after = db.cloneJobs();
        normalizeGroupDepartments(after);
        const hits = after.filter(j => j.job_detail === 'ENGINE LOCAL FO TANK CHECK');
        const hit = hits[0];
        assert('local job updated (not duplicated)', hits.length === 1);
        assert('matched local id retained', hit?.id === 'engine-local-fo-001', `id=${hit?.id}`);
        assert('job code updated from Excel', hit?.job_code === '26-001', `code=${hit?.job_code}`);
        assert('department stays ENGINE after normalize', hit?.department === 'ENGINE');
    });

    await runScenario('4) DECK renumber — orphan removed, LSA/FFE can take 01-001', async () => {
        const db = createMockDb(seed);
        const deckFo = db.cloneJobs().filter(j => j.department === 'DECK');
        const { result, after } = await exportImportCycle(Pms, db, HQ_USER, async (wb) => {
            const wsJ = wb.getWorksheet('Jobs');
            const wsG = wb.getWorksheet('Group Headers');
            const keepRows = [];
            wsJ.eachRow((row, n) => {
                if (n < 6) return;
                const dept = jobCell(row, J_COL.DEPT).toUpperCase();
                if (dept !== 'DECK') { keepRows.push(n); return; }
                const gname = jobCell(row, J_COL.GNAME).toUpperCase();
                if (gname.includes('LSA/FFE')) keepRows.push(n);
            });
            const deckRows = [];
            wsJ.eachRow((row, n) => { if (n >= 6) deckRows.push({ row, n }); });
            for (const { row, n } of deckRows) {
                const dept = jobCell(row, J_COL.DEPT).toUpperCase();
                if (dept !== 'DECK') continue;
                if (!keepRows.includes(n)) wsJ.spliceRows(n, 1);
            }
            wsG.eachRow((row, n) => {
                if (n < 6) return;
                const dept = String(row.getCell(1).value || '').toUpperCase();
                const name = String(row.getCell(3).value || '').toUpperCase();
                if (dept === 'DECK' && name.includes('CARGO TANK')) wsG.spliceRows(n, 1);
            });
            let idx = 0;
            wsJ.eachRow((row, n) => {
                if (n < 6) return;
                if (jobCell(row, J_COL.DEPT).toUpperCase() !== 'DECK') return;
                idx++;
                setJobCell(wsJ, n, { groupNo: '01', groupName: 'LSA/FFE', jobCode: `01-${String(idx).padStart(3, '0')}` });
            });
        }, 'DECK');
        const lsa001 = after.find(j => j.department === 'DECK' && j.job_code === '01-001');
        assert('import succeeds', result.jobs > 0);
        assert('LSA/FFE 01-001 exists', !!lsa001);
        assert('CARGO TANK jobs removed', !after.some(j => j.department === 'DECK' && norm(j.group).includes('CARGO TANK MONITORING')));
    });

    await runScenario('5) Vessel Engine — rename group, delete jobs, add group (same PC import)', async () => {
        const db = createMockDb(seed);
        const beforeEngine = db.cloneJobs().filter(j => j.department === 'ENGINE').length;
        const sample24 = db.cloneJobs().find(j => j.department === 'ENGINE' && String(j.group).includes('24.') && j.job_code === '24-001');
        assert('seed has ENGINE 24-001', !!sample24, sample24?.group);

        const { result, after, wb } = await exportImportCycle(Pms, db, CE_USER, async (workbook) => {
            const wsJ = workbook.getWorksheet('Jobs');
            const wsG = workbook.getWorksheet('Group Headers');
            const renameFrom = 'CARGO EQUIPMENTS';
            const renameToNo = '88';
            const renameToName = 'CARGO EQUIPMENTS RENAMED';
            const newGroupNo = '99';
            const newGroupName = 'TEST ENGINE GROUP';

            wsJ.eachRow((row, n) => {
                if (n < 6) return;
                if (jobCell(row, J_COL.DEPT).toUpperCase() !== 'ENGINE') return;
                const gname = jobCell(row, J_COL.GNAME).toUpperCase();
                if (gname.includes(renameFrom)) {
                    setJobCell(wsJ, n, {
                        groupNo: renameToNo,
                        groupName: renameToName,
                        jobCode: jobCell(row, J_COL.CODE).replace(/^24-/, `${renameToNo}-`),
                    });
                }
            });

            const rowsToDrop = [];
            wsJ.eachRow((row, n) => {
                if (n < 6) return;
                if (jobCell(row, J_COL.DEPT).toUpperCase() !== 'ENGINE') return;
                const code = jobCell(row, J_COL.CODE);
                if (code === '88-002' || code === '88-003') rowsToDrop.push(n);
            });
            rowsToDrop.sort((a, b) => b - a).forEach(n => wsJ.spliceRows(n, 1));

            wsG.eachRow((row, n) => {
                if (n < 6) return;
                if (String(row.getCell(1).value || '').toUpperCase() !== 'ENGINE') return;
                const name = String(row.getCell(3).value || '').toUpperCase();
                if (name.includes(renameFrom)) {
                    row.getCell(2).value = renameToNo;
                    row.getCell(3).value = renameToName;
                }
                if (String(row.getCell(2).value) === renameToNo) {
                    let nJobs = 0;
                    wsJ.eachRow((jr, jn) => {
                        if (jn < 6) return;
                        if (jobCell(jr, J_COL.DEPT).toUpperCase() !== 'ENGINE') return;
                        if (jobCell(jr, J_COL.GNO) === renameToNo) nJobs++;
                    });
                    row.getCell(8).value = nJobs;
                }
            });

            let lastJobRow = 5;
            wsJ.eachRow((row, n) => { if (n >= 6) lastJobRow = n; });
            setJobCell(wsJ, lastJobRow + 1, {
                jobId: '',
                department: 'ENGINE',
                groupNo: newGroupNo,
                groupName: newGroupName,
                jobCode: '99-001',
                detail: 'SIMULATION NEW JOB',
            });
            let lastGroupRow = 5;
            wsG.eachRow((row, n) => { if (n >= 6) lastGroupRow = n; });
            addGroupHeader(wsG, lastGroupRow + 1, {
                department: 'ENGINE', groupNo: newGroupNo, groupName: newGroupName, jobs: 1,
            });
        }, 'ENGINE');

        const outPath = path.join(ROOT, 'data', '_test-pms-master-engine-mutated.xlsx');
        await wb.xlsx.writeFile(outPath);

        const renamed = after.find(j => j.department === 'ENGINE' && j.job_code === '88-001');
        const deleted = after.filter(j => j.department === 'ENGINE' && (j.job_code === '88-002' || j.job_code === '88-003'));
        const added = after.find(j => j.department === 'ENGINE' && j.job_code === '99-001');
        const deckUntouched = db.cloneJobs().filter(j => j.department === 'DECK').length;

        assert('import completes', result.jobs > 0);
        assert('group rename applied (88-001)', !!renamed && norm(renamed.group).includes('CARGO EQUIPMENTS RENAMED'));
        assert('deleted jobs removed', deleted.length === 0);
        assert('new group/job added (99-001)', !!added && added.job_detail === 'SIMULATION NEW JOB');
        assert('DECK jobs untouched on Engine PC', deckUntouched > 0);
        assert('ENGINE job count changed', after.filter(j => j.department === 'ENGINE').length !== beforeEngine);
        assert('mutated workbook saved', fs.existsSync(outPath), outPath);
    });

    await runScenario('6) Cross-PC — Engine Excel → HQ / Master import (file handoff)', async () => {
        const enginePc = createMockDb(seed);
        const hqPc = createMockDb(seed);
        const masterPc = createMockDb(seed);
        const deckBeforeHq = hqPc.cloneJobs().filter(j => j.department === 'DECK').length;
        const deckBeforeMaster = masterPc.cloneJobs().filter(j => j.department === 'DECK').length;

        const wb = await exportEngineWorkbook(Pms, enginePc);
        const wsJ = wb.getWorksheet('Jobs');
        const wsG = wb.getWorksheet('Group Headers');
        setJobCell(wsJ, 6, {
            groupNo: '77',
            groupName: 'CROSS PC GROUP',
            jobCode: '77-001',
            detail: 'CROSS PC TEST JOB',
        });
        addGroupHeader(wsG, wsG.lastRow.number + 1, {
            department: 'ENGINE', groupNo: '77', groupName: 'CROSS PC GROUP', jobs: 1,
        });
        const handoffPath = path.join(ROOT, 'data', '_test-pms-master-engine-crosspc.xlsx');
        await wb.xlsx.writeFile(handoffPath);

        const { after: hqAfter } = await importWorkbookToDb(Pms, hqPc, wb, HQ_USER, 'ENGINE');
        const { after: masterAfter } = await importWorkbookToDb(Pms, masterPc, wb, CAPTAIN_USER, 'ENGINE');

        const hqHit = hqAfter.find(j => j.job_code === '77-001' && j.department === 'ENGINE');
        const masterHit = masterAfter.find(j => j.job_code === '77-001' && j.department === 'ENGINE');

        assert('handoff file written', fs.existsSync(handoffPath));
        assert('HQ import creates 77-001', !!hqHit && hqHit.job_detail === 'CROSS PC TEST JOB');
        assert('Master import creates 77-001', !!masterHit && masterHit.job_detail === 'CROSS PC TEST JOB');
        assert('HQ DECK untouched', hqPc.cloneJobs().filter(j => j.department === 'DECK').length === deckBeforeHq);
        assert('Master DECK untouched', masterPc.cloneJobs().filter(j => j.department === 'DECK').length === deckBeforeMaster);
    });

    await runScenario('7) Deck PC rejects ENGINE-only file when DECK selected', async () => {
        const db = createMockDb(seed);
        const wb = await exportEngineWorkbook(Pms, db);
        global.TVC_DB = db;
        let errMsg = '';
        try {
            await Pms.importFromWorkbook(wb, CO_USER, { department: 'DECK' });
        } catch (e) {
            errMsg = e.message || '';
        }
        assert('DECK import rejects ENGINE file', /ENGINE data|ENGINE-only|contains ENGINE/i.test(errMsg), errMsg);
    });

    await runScenario('9) Vessel field-test — 27-002 + group 28 NEW(ENGINE)', async () => {
        const db = createMockDb(seed);
        const { result, after } = await exportImportCycle(Pms, db, CE_USER, async (wb) => {
            const wsJ = wb.getWorksheet('Jobs');
            const wsG = wb.getWorksheet('Group Headers');
            let lastJ = 5, lastG = 5;
            wsJ.eachRow((r, n) => { if (n >= 6) lastJ = n; });
            wsG.eachRow((r, n) => { if (n >= 6) lastG = n; });
            setJobCell(wsJ, lastJ + 1, {
                department: 'ENGINE', groupNo: '27', groupName: 'LUB. OIL ANALYSIS',
                jobCode: '27-002', detail: 'LUB. OIL ANALYSIS NEW1111',
            });
            wsG.eachRow((row, n) => {
                if (n < 6) return;
                if (String(row.getCell(2).value) === '27') row.getCell(8).value = 2;
            });
            addGroupHeader(wsG, lastG + 1, {
                department: 'ENGINE', groupNo: '28', groupName: 'NEW(ENGINE)', jobs: 1,
            });
            setJobCell(wsJ, lastJ + 2, {
                department: 'ENGINE', groupNo: '28', groupName: 'NEW(ENGINE)',
                jobCode: '28-001', detail: '111 222 333',
            });
        }, 'ENGINE');
        const j27002 = after.find(j => j.job_code === '27-002' && j.department === 'ENGINE');
        const j28001 = after.find(j => j.job_code === '28-001' && j.department === 'ENGINE');
        assert('27-002 created', !!j27002 && j27002.job_detail === 'LUB. OIL ANALYSIS NEW1111');
        assert('28-001 present', !!j28001);
        assert('import reports creates', result.created >= 2, `created=${result.created}`);
    });

    await runScenario('10) Reject group-only row — Jobs (ref)>0 but Jobs sheet missing', async () => {
        const db = createMockDb(seed);
        let errMsg = '';
        try {
            await exportImportCycle(Pms, db, CE_USER, async (wb) => {
                const wsG = wb.getWorksheet('Group Headers');
                let lastG = 5;
                wsG.eachRow((r, n) => { if (n >= 6) lastG = n; });
                addGroupHeader(wsG, lastG + 1, {
                    department: 'ENGINE', groupNo: '98', groupName: 'GROUP ONLY TEST', jobs: 1,
                });
            }, 'ENGINE');
        } catch (e) {
            errMsg = e.message || '';
        }
        assert('group-only import rejected', /Jobs \(ref\)=1|검증 실패/i.test(errMsg), errMsg.slice(0, 120));
    });

    await runScenario('11) LAST DONE in Excel → NEXT DATE from PERIOD on import', async () => {
        const db = createMockDb(seed);
        const target = db.cloneJobs().find(j => j.department === 'ENGINE' && j.job_code === '27-001');
        assert('seed has 27-001', !!target);
        const { after } = await exportImportCycle(Pms, db, CE_USER, async (wb) => {
            const wsJ = wb.getWorksheet('Jobs');
            wsJ.eachRow((row, n) => {
                if (n < 6) return;
                if (jobCell(row, J_COL.CODE) !== '27-001') return;
                setJobCell(wsJ, n, { lastDone: '2026-01-15' });
                setJobCell(wsJ, n, { period: '6' });
            });
        }, 'ENGINE');
        const hit = after.find(j => j.job_code === '27-001' && j.department === 'ENGINE');
        assert('last_done applied', hit?.last_done === '2026-01-15', `last_done=${hit?.last_done}`);
        assert('next_date computed from 6M', hit?.next_date === '2026-07-15', `next_date=${hit?.next_date}`);
    });

    await runScenario('12) H job LAST DONE uses Run-hour modal expectedNextMonth on import', async () => {
        const db = createMockDb(seed);
        const target = db.cloneJobs().find(j => j.department === 'ENGINE' && j.job_code === '01-004');
        assert('seed has 01-004 H job', !!target && target.unit === 'H');
        loadTvcPms('SHIP');
        seedRunHourExpected('ENGINE', target.group, 400);
        const PmsWithRunHr = loadPmsMasterExcel();
        const { after } = await exportImportCycle(PmsWithRunHr, db, CE_USER, async (wb) => {
            const wsJ = wb.getWorksheet('Jobs');
            wsJ.eachRow((row, n) => {
                if (n < 6) return;
                if (jobCell(row, J_COL.CODE) !== '01-004') return;
                setJobCell(wsJ, n, { lastDone: '2026-01-15' });
            });
        }, 'ENGINE');
        const hit = after.find(j => j.job_code === '01-004' && j.department === 'ENGINE');
        const expectedNext = globalThis.__TVC_PMS.addMonths('2026-01-15', 8000 / 400);
        assert('last_done applied', hit?.last_done === '2026-01-15', `last_done=${hit?.last_done}`);
        assert('next_date from expected 400h/mo', hit?.next_date === expectedNext, `next_date=${hit?.next_date} expected=${expectedNext}`);
        assert('run_hours_expected set', hit?.run_hours_expected === 400, `run_hours_expected=${hit?.run_hours_expected}`);
        assert('schedule_basis RUN_HOUR', hit?.schedule_basis === 'RUN_HOUR', `schedule_basis=${hit?.schedule_basis}`);
    });

    await runScenario('13) Replace group 29 MOORING → SCRUBBER removes old group/jobs', async () => {
        const db = createMockDb(seed);
        const moorLabel = '29. MOORING WINCH & WINDLASS and RELATED AUX. MACHINERY / SYSTEM';
        const scrubLabel = '29. SCRUBBER';
        for (let i = 1; i <= 3; i++) {
            await db.put('maintenance_jobs', {
                id: `eng-29-00${i}`,
                department: 'ENGINE',
                vessel_id: 'INCHEON CHEMI',
                group: moorLabel,
                job_code: `29-00${i}`,
                job_detail: i === 1 ? 'INSPECTION' : `DETAIL-${i}`,
                period: 12,
                unit: 'M',
            });
        }
        await db.put('maintenance_groups', {
            id: 'grp-29-moor',
            department: 'ENGINE',
            vessel_id: 'INCHEON CHEMI',
            label: moorLabel,
            item_sort1: null,
        });
        const { after } = await exportImportCycle(Pms, db, CE_USER, async (wb) => {
            const wsG = wb.getWorksheet('Group Headers');
            const wsJ = wb.getWorksheet('Jobs');
            wsG.eachRow((row, n) => {
                if (n < 6) return;
                if (String(row.getCell(2).value) !== '29') return;
                row.getCell(3).value = 'SCRUBBER';
                row.getCell(8).value = 2;
            });
            const keep = new Set(['29-001', '29-002']);
            const rows = [];
            wsJ.eachRow((row, n) => { if (n >= 6) rows.push(n); });
            for (const n of rows) {
                const row = wsJ.getRow(n);
                const code = jobCell(row, J_COL.CODE);
                if (!code.startsWith('29-')) continue;
                if (!keep.has(code)) {
                    wsJ.spliceRows(n, 1);
                    continue;
                }
                row.getCell(J_COL.GNAME).value = 'SCRUBBER';
                row.getCell(J_COL.DETAIL).value = 'Safety inspection';
            }
        }, 'ENGINE');
        const moorJobs = after.filter(j => j.department === 'ENGINE' && norm(j.group).includes('MOORING'));
        const scrubJobs = after.filter(j => j.department === 'ENGINE' && norm(j.group) === scrubLabel);
        const groups = await db.getAll('maintenance_groups');
        const moorDef = groups.find(g => norm(g.label).includes('MOORING') && g.department === 'ENGINE');
        const scrubDef = groups.find(g => norm(g.label) === scrubLabel);
        assert('MOORING jobs removed', moorJobs.length === 0, `moor=${moorJobs.length}`);
        assert('SCRUBBER has 29-001', scrubJobs.some(j => j.job_code === '29-001'));
        assert('SCRUBBER has 29-002', scrubJobs.some(j => j.job_code === '29-002'));
        assert('29-003 ENGINE removed', !after.some(j => j.department === 'ENGINE' && j.job_code === '29-003'));
        assert('MOORING group def pruned', !moorDef);
        assert('SCRUBBER group def exists', !!scrubDef);
    });

    await runScenario('14) DECK legacy group 29 defs purged — jobs renumbered to 03', async () => {
        const db = createMockDb(seed);
        await db.put('maintenance_groups', {
            id: 'deck-29-legacy',
            department: 'DECK',
            vessel_id: 'INCHEON CHEMI',
            label: '29. MOORING WINCH & WINDLASS and RELATED AUX. MACHINERY / SYSTEM',
        });
        const jobs = await db.getAll('maintenance_jobs');
        const groups = await db.getAll('maintenance_groups');
        const moorBefore = jobs.filter(j => j.department === 'DECK' && usesLegacyDeckGroupNumber(j.group));
        assert('seed has legacy DECK 29 jobs', moorBefore.length > 0, `count=${moorBefore.length}`);
        const result = await Pms.applyDeckCatalogNormalization(jobs, groups);
        const afterJobs = await db.getAll('maintenance_jobs');
        const afterGroups = await db.getAll('maintenance_groups');
        const leg29Jobs = afterJobs.filter(j => j.department === 'DECK' && usesLegacyDeckGroupNumber(j.group));
        const leg29Def = afterGroups.find(g => g.department === 'DECK' && usesLegacyDeckGroupNumber(g.label));
        const cat03Jobs = afterJobs.filter(j => j.department === 'DECK' && norm(j.group).startsWith('03.'));
        assert('legacy 29 DECK jobs migrated', leg29Jobs.length === 0, `remaining=${leg29Jobs.length}`);
        assert('catalog 03 DECK jobs exist', cat03Jobs.length > 0, `count=${cat03Jobs.length}`);
        assert('legacy 29 group def purged', !leg29Def);
        assert('normalization updated jobs', result.updated > 0, `updated=${result.updated}`);
    });

    await runScenario('15) SCRUBBER 29-001 re-links detached __tvc_ job with Work Report history', async () => {
        const db = createMockDb(seed);
        const moorLabel = '29. MOORING WINCH & WINDLASS and RELATED AUX. MACHINERY / SYSTEM';
        const scrubLabel = '29. SCRUBBER';
        const jobId = '62649d7e-f15c-8123-abcd-000000000001';
        await db.put('maintenance_jobs', {
            id: jobId,
            department: 'ENGINE',
            vessel_id: 'INCHEON CHEMI',
            group: moorLabel,
            job_code: '__tvc_62649d7ef15c8',
            detached_from_code: '29-001',
            job_detail: 'INSPECTION',
            period: 12,
            unit: 'M',
        });
        await db.put('daily_work_reports', {
            id: 'rep-29-001',
            job_items: [{ maintenance_job_id: jobId, job_code: '__tvc_62649d7ef15c8', status: 'CONFIRMED' }],
        });
        const { after } = await exportImportCycle(Pms, db, CE_USER, async (wb) => {
            const wsG = wb.getWorksheet('Group Headers');
            const wsJ = wb.getWorksheet('Jobs');
            let lastJ = 5;
            wsJ.eachRow((r, n) => { if (n >= 6) lastJ = n; });
            let has29Header = false;
            wsG.eachRow((row, n) => {
                if (n < 6) return;
                if (String(row.getCell(2).value) !== '29') return;
                has29Header = true;
                row.getCell(3).value = 'SCRUBBER';
                row.getCell(8).value = 1;
            });
            if (!has29Header) addGroupHeader(wsG, lastJ + 1, { department: 'ENGINE', groupNo: '29', groupName: 'SCRUBBER', jobs: 1 });
            setJobCell(wsJ, lastJ + 1, {
                department: 'ENGINE', groupNo: '29', groupName: 'SCRUBBER',
                jobCode: '29-001', detail: 'Safety inspection', period: 1, lastDone: '2022-07-18',
            });
        }, 'ENGINE');
        const hit = after.find(j => j.id === jobId);
        assert('detached job restored to 29-001', hit?.job_code === '29-001', `code=${hit?.job_code}`);
        assert('group moved to SCRUBBER', norm(hit?.group) === scrubLabel, `group=${hit?.group}`);
        assert('detached_from_code cleared', !hit?.detached_from_code);
        assert('no duplicate ENGINE 29-001', after.filter(j => j.department === 'ENGINE' && j.job_code === '29-001').length === 1);
    });

    await runScenario('16) MOORING 29-001 with Work Report updates in place to SCRUBBER (not detached)', async () => {
        const db = createMockDb(seed);
        const moorLabel = '29. MOORING WINCH & WINDLASS and RELATED AUX. MACHINERY / SYSTEM';
        const scrubLabel = '29. SCRUBBER';
        const jobId = 'eng-29-001-wr';
        await db.put('maintenance_jobs', {
            id: jobId,
            department: 'ENGINE',
            vessel_id: 'INCHEON CHEMI',
            group: moorLabel,
            job_code: '29-001',
            job_detail: 'INSPECTION',
            period: 12,
            unit: 'M',
        });
        await db.put('daily_work_reports', {
            id: 'rep-moor-29',
            job_items: [{ maintenance_job_id: jobId, job_code: '29-001', status: 'CONFIRMED' }],
        });
        const { after } = await exportImportCycle(Pms, db, CE_USER, async (wb) => {
            const wsG = wb.getWorksheet('Group Headers');
            const wsJ = wb.getWorksheet('Jobs');
            let lastJ = 5;
            wsJ.eachRow((r, n) => { if (n >= 6) lastJ = n; });
            let has29Header = false;
            wsG.eachRow((row, n) => {
                if (n < 6) return;
                if (String(row.getCell(2).value) !== '29') return;
                has29Header = true;
                row.getCell(3).value = 'SCRUBBER';
                row.getCell(8).value = 1;
            });
            if (!has29Header) addGroupHeader(wsG, lastJ + 1, { department: 'ENGINE', groupNo: '29', groupName: 'SCRUBBER', jobs: 1 });
            setJobCell(wsJ, lastJ + 1, {
                department: 'ENGINE', groupNo: '29', groupName: 'SCRUBBER',
                jobCode: '29-001', detail: 'Safety inspection', period: 1,
            });
        }, 'ENGINE');
        const hit = after.find(j => j.id === jobId);
        assert('keeps 29-001 code', hit?.job_code === '29-001', `code=${hit?.job_code}`);
        assert('not detached', !String(hit?.job_code || '').startsWith('__tvc_'));
        assert('group is SCRUBBER', norm(hit?.group) === scrubLabel, `group=${hit?.group}`);
    });

    await runScenario('17) SCRUBBER 29-001/29-002 same JOB DETAIL import as two jobs', async () => {
        const db = createMockDb(seed);
        const scrubLabel = '29. SCRUBBER';
        const sharedJobId = '62649d7e-f95a-4436-8878-45557adce151';
        await db.put('maintenance_jobs', {
            id: sharedJobId,
            department: 'ENGINE',
            vessel_id: 'INCHEON CHEMI',
            group: scrubLabel,
            job_code: '__tvc_62649d7ef95a',
            detached_from_code: '29-001',
            job_detail: 'Safety inspection',
            item_sort1: 'SCRUBBER',
            item_sort2: 'WATER SYSTEM',
            period: 1,
            unit: 'M',
        });
        const { after } = await exportImportCycle(Pms, db, CE_USER, async (wb) => {
            const wsG = wb.getWorksheet('Group Headers');
            const wsJ = wb.getWorksheet('Jobs');
            let lastJ = 5, lastG = 5;
            wsJ.eachRow((r, n) => { if (n >= 6) lastJ = n; });
            wsG.eachRow((r, n) => { if (n >= 6) lastG = n; });
            addGroupHeader(wsG, lastG + 1, { department: 'ENGINE', groupNo: '29', groupName: 'SCRUBBER', jobs: 2 });
            setJobCell(wsJ, lastJ + 1, {
                department: 'ENGINE', groupNo: '29', groupName: 'SCRUBBER',
                jobCode: '29-001', detail: 'Safety inspection',
                period: 1,
            });
            setJobCell(wsJ, lastJ + 2, {
                department: 'ENGINE', groupNo: '29', groupName: 'SCRUBBER',
                jobCode: '29-002', detail: 'Safety inspection',
                period: 1,
            });
        }, 'ENGINE');
        const j1 = after.find(j => j.department === 'ENGINE' && j.job_code === '29-001');
        const j2 = after.find(j => j.department === 'ENGINE' && j.job_code === '29-002');
        assert('29-001 exists', !!j1);
        assert('29-002 exists', !!j2);
        assert('29-001 not detached', !String(j1?.job_code || '').startsWith('__tvc_'));
        assert('distinct job ids', j1?.id !== j2?.id);
    });

    await runScenario('19) MOORING stub + detached __tvc_ — import prefers detached (Work Report)', async () => {
        const db = createMockDb(seed);
        const moorLabel = '29. MOORING WINCH & WINDLASS and RELATED AUX. MACHINERY / SYSTEM';
        const scrubLabel = '29. SCRUBBER';
        const detachedId = '62649d7e-f15c-8123-abcd-000000000001';
        await db.put('maintenance_jobs', {
            id: 'moor-stub-29-001',
            department: 'ENGINE',
            vessel_id: 'INCHEON CHEMI',
            group: moorLabel,
            job_code: '29-001',
            job_detail: 'Old mooring',
            period: 1,
            unit: 'M',
        });
        await db.put('maintenance_jobs', {
            id: detachedId,
            department: 'ENGINE',
            vessel_id: 'INCHEON CHEMI',
            group: moorLabel,
            job_code: '__tvc_62649d7ef15c8',
            detached_from_code: '29-001',
            job_detail: 'Inspection',
            item_sort1: 'SCRUBBER',
            item_sort2: 'Exhaust System',
            period: 1,
            unit: 'M',
        });
        await db.put('daily_work_reports', {
            id: 'rep-moor-detached',
            job_items: [{ maintenance_job_id: detachedId, job_code: '__tvc_62649d7ef15c8', status: 'CONFIRMED' }],
        });
        const { after } = await exportImportCycle(Pms, db, CE_USER, async (wb) => {
            const wsG = wb.getWorksheet('Group Headers');
            const wsJ = wb.getWorksheet('Jobs');
            let lastJ = 5, lastG = 5;
            wsJ.eachRow((r, n) => { if (n >= 6) lastJ = n; });
            wsG.eachRow((r, n) => { if (n >= 6) lastG = n; });
            addGroupHeader(wsG, lastG + 1, { department: 'ENGINE', groupNo: '29', groupName: 'SCRUBBER', jobs: 2 });
            setJobCell(wsJ, lastJ + 1, {
                department: 'ENGINE', groupNo: '29', groupName: 'SCRUBBER',
                jobCode: '29-001', detail: 'Inspection',
            });
            setJobCell(wsJ, lastJ + 2, {
                department: 'ENGINE', groupNo: '29', groupName: 'SCRUBBER',
                jobCode: '29-002', detail: 'Inspection',
            });
        }, 'ENGINE');
        const eng29 = after.filter(j => j.department === 'ENGINE' && /^29-/.test(j.job_code || ''));
        assert('single ENGINE 29-001', eng29.filter(j => j.job_code === '29-001').length === 1);
        const j1 = eng29.find(j => j.job_code === '29-001');
        assert('29-001 id kept (Work Report)', j1?.id === detachedId, `id=${j1?.id}`);
        assert('29-001 on SCRUBBER', norm(j1?.group) === scrubLabel, `group=${j1?.group}`);
        assert('29-002 exists', eng29.some(j => j.job_code === '29-002'));
        const idx = TVC_Indexes.build({
            jobs: after.filter(j => j.department === 'ENGINE'),
            components: [],
            groups: await db.getAll('maintenance_groups'),
            reports: [],
            spares: [],
            spareGroups: [],
        });
        const gk = `${'ENGINE'}|${scrubLabel}`;
        const scrubIds = idx.jobsByGroupKey.get(gk) || [];
        assert('SCRUBBER group index has jobs', scrubIds.length >= 2, `count=${scrubIds.length}`);
    });

    await runScenario('20) Group 29 SCRUBBER → ECR LAPTOP (008 handoff) + UI group 30 kept', async () => {
        const db = createMockDb(seed);
        await db.put('maintenance_groups', {
            id: 'grp-scrub', department: 'ENGINE', vessel_id: 'INCHEON CHEMI', label: '29. SCRUBBER',
        });
        await db.put('maintenance_groups', {
            id: 'grp-rpm-ui', department: 'ENGINE', vessel_id: 'INCHEON CHEMI', label: '30. RPM INDICATOR',
        });
        await db.put('maintenance_jobs', {
            id: 'scrub-1', department: 'ENGINE', vessel_id: 'INCHEON CHEMI',
            group: '29. SCRUBBER', job_code: '29-001', job_detail: 'Inspection', period: 1, unit: 'M',
        });
        await db.put('maintenance_jobs', {
            id: 'scrub-2', department: 'ENGINE', vessel_id: 'INCHEON CHEMI',
            group: '29. SCRUBBER', job_code: '29-002', job_detail: 'Inspection', period: 1, unit: 'M',
        });
        const { after } = await exportImportCycle(Pms, db, CE_USER, async (wb) => {
            const wsG = wb.getWorksheet('Group Headers');
            const wsJ = wb.getWorksheet('Jobs');
            let lastJ = 5, lastG = 5;
            wsJ.eachRow((r, n) => { if (n >= 6) lastJ = n; });
            wsG.eachRow((r, n) => { if (n >= 6) lastG = n; });
            addGroupHeader(wsG, lastG + 1, { department: 'ENGINE', groupNo: '29', groupName: 'ECR LAPTOP', jobs: 1 });
            addGroupHeader(wsG, lastG + 2, { department: 'ENGINE', groupNo: '30', groupName: 'RPM INDICATOR', jobs: 1 });
            setJobCell(wsJ, lastJ + 1, {
                department: 'ENGINE', groupNo: '29', groupName: 'ECR LAPTOP',
                jobCode: '29-001', detail: '1 MONTH',
            });
            setJobCell(wsJ, lastJ + 2, {
                department: 'ENGINE', groupNo: '30', groupName: 'RPM INDICATOR',
                jobCode: '30-001', detail: 'VISUAL CHECK',
            });
        }, 'ENGINE');
        const defs29 = (await db.getAll('maintenance_groups')).filter(g =>
            g.department === 'ENGINE' && /^29\./.test(String(g.label || ''))
        );
        const j29 = after.filter(j => j.department === 'ENGINE' && j.job_code === '29-001');
        const j30 = after.find(j => j.department === 'ENGINE' && j.job_code === '30-001');
        assert('only one group-29 def', defs29.length === 1, `defs=${defs29.map(g => g.label).join(', ')}`);
        assert('group 29 is ECR LAPTOP', norm(defs29[0]?.label) === '29. ECR LAPTOP');
        assert('no SCRUBBER group def', !(await db.getAll('maintenance_groups')).some(g => norm(g.label) === '29. SCRUBBER'));
        assert('29-001 on ECR LAPTOP', norm(j29[0]?.group) === '29. ECR LAPTOP', `group=${j29[0]?.group}`);
        assert('29-002 removed', !after.some(j => j.job_code === '29-002'));
        assert('30-001 exists', !!j30);
        assert('30-001 on RPM INDICATOR', norm(j30?.group) === '30. RPM INDICATOR');
    });

    await runScenario('18) Legacy Excel with JOB_ID column still imports', async () => {
        const db = createMockDb(seed);
        const wb = await exportEngineWorkbook(Pms, db);
        const wsJ = wb.getWorksheet('Jobs');
        wsJ.spliceColumns(1, 0, ['JOB_ID']);
        wsJ.getRow(5).getCell(1).value = 'JOB_ID';
        const { result } = await importWorkbookToDb(Pms, db, wb, CE_USER, 'ENGINE');
        assert('legacy JOB_ID column import ok', result.jobs > 0);
    });

    await runScenario('8) Legacy combined group 26 still splits by job code (pre-master seed)', async () => {
        const legacySeed = {
            maintenance_jobs: [{
                id: 'legacy-26-001',
                department: 'ENGINE',
                group: '26. CARGO TANK HIGH LEVEL / OVERFILL ALARM SYSTEM and F.O TANK HIGH / OVERFLOW ALARM SYSTEM',
                job_code: '26-001',
                job_detail: 'LEGACY CARGO',
                period: 1,
                unit: 'M',
            }],
            maintenance_groups: [],
            ship_components: [],
        };
        const jobs = legacySeed.maintenance_jobs.map(j => ({ ...j }));
        normalizeGroupDepartments(jobs);
        assert('legacy 26-001 → DECK', jobs[0].department === 'DECK');
    });

    await runScenario('21) ENGINE group 30 HOSE HANDLING CRANE — never reclassified to DECK on load', async () => {
        const jobs = [{
            id: 'eng-30-001',
            department: 'ENGINE',
            group: '30. HOSE HANDLING CRANE',
            job_code: '30-001',
            job_detail: 'Inspection',
            period: 1,
            unit: 'M',
        }];
        normalizeGroupDepartments(jobs);
        assert('ENGINE 30-001 stays ENGINE', jobs[0].department === 'ENGINE');
    });

    await runScenario('22) DECK catalog rename 29-001 → 03-001 does not touch ENGINE 29-001 Work Report', async () => {
        const db = createMockDb({ maintenance_jobs: [], maintenance_groups: [], ship_components: [] });
        await db.put('maintenance_jobs', {
            id: 'deck-29-001',
            department: 'DECK',
            vessel_id: 'INCHEON CHEMI',
            group: '29. MOORING WINCH & WINDLASS and RELATED AUX. MACHINERY / SYSTEM',
            job_code: '29-001',
            job_detail: 'DECK mooring',
            period: 1,
            unit: 'M',
        });
        await db.put('maintenance_jobs', {
            id: 'eng-29-001',
            department: 'ENGINE',
            vessel_id: 'INCHEON CHEMI',
            group: '29. ECR LAPTOP',
            job_code: '29-001',
            job_detail: 'ECR',
            period: 1,
            unit: 'M',
        });
        await db.put('daily_work_reports', {
            id: 'rep-eng-29',
            department: 'ENGINE',
            job_items: [{ maintenance_job_id: 'eng-29-001', job_code: '29-001', status: 'CONFIRMED' }],
        });
        await db.put('daily_work_reports', {
            id: 'rep-deck-29',
            department: 'DECK',
            job_items: [{ maintenance_job_id: 'deck-29-001', job_code: '29-001', status: 'CONFIRMED' }],
        });
        const jobs = await db.getAll('maintenance_jobs');
        const groups = await db.getAll('maintenance_groups');
        global.TVC_DB = db;
        await Pms.applyDeckCatalogNormalization(jobs, groups);
        const afterJobs = await db.getAll('maintenance_jobs');
        const deckJob = afterJobs.find(j => j.id === 'deck-29-001');
        const engJob = afterJobs.find(j => j.id === 'eng-29-001');
        const engRep = await db.get('daily_work_reports', 'rep-eng-29');
        const deckRep = await db.get('daily_work_reports', 'rep-deck-29');
        assert('ENGINE 29-001 unchanged', engJob?.job_code === '29-001' && engJob?.department === 'ENGINE');
        assert('DECK job renumbered off legacy 29', deckJob?.job_code?.startsWith('03-'), `deck code=${deckJob?.job_code}`);
        assert('ENGINE report still 29-001', engRep.job_items[0].job_code === '29-001');
        assert('DECK report follows deck rename', deckRep.job_items[0].job_code?.startsWith('03-'));
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
