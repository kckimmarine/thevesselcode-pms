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

const CE_USER = { username: 'ce', display_name: 'Chief engineer', role: 'SHIP_CHIEF', department: 'ENGINE' };
const HQ_USER = { username: 'hq', display_name: 'Superintendent', role: 'HQ_SUPERVISOR', account_type: 'HQ' };

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

async function exportImportCycle(Pms, db, user, mutateFn) {
    const jobs = db.cloneJobs();
    const groups = await db.getAll('maintenance_groups');
    const wb = await Pms.exportToWorkbook({ jobs: Pms.renumberJobsForExport(jobs), groups, vesselId: 'INCHEON CHEMI' });
    if (mutateFn) await mutateFn(wb);
    global.TVC_DB = db;
    const result = await Pms.importFromWorkbook(wb, user);
    const after = db.cloneJobs();
    normalizeGroupDepartments(after);
    return { result, after, wb };
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
}

function addGroupHeader(ws, rowNo, row) {
    const HDR = 5;
    ws.getRow(rowNo).getCell(1).value = row.department;
    ws.getRow(rowNo).getCell(2).value = row.groupNo;
    ws.getRow(rowNo).getCell(3).value = row.groupName;
    ws.getRow(rowNo).getCell(9).value = row.jobs ?? 0;
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
        assert('imported jobs stamped', after.every(j => j.master_import_at));
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
        const wb = await Pms.exportToWorkbook({ jobs: [], groups: [], vesselId: 'INCHEON CHEMI' });
        const wsJ = wb.getWorksheet('Jobs');
        const rowNo = 6;
        setJobCell(wsJ, rowNo, {
            jobId: 'hq-exported-uuid-999',
            department: 'ENGINE',
            groupNo: '26',
            groupName: 'F.O TANK MONITORING SYSTEM',
            jobCode: '26-001',
            detail: 'ENGINE LOCAL FO TANK CHECK',
        });
        global.TVC_DB = db;
        await Pms.importFromWorkbook(wb, CE_USER);
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
                const dept = String(row.getCell(2).value || '').toUpperCase();
                if (dept !== 'DECK') { keepRows.push(n); return; }
                const gname = String(row.getCell(4).value || '').toUpperCase();
                if (gname.includes('LSA/FFE')) keepRows.push(n);
            });
            const deckRows = [];
            wsJ.eachRow((row, n) => { if (n >= 6) deckRows.push({ row, n }); });
            for (const { row, n } of deckRows) {
                const dept = String(row.getCell(2).value || '').toUpperCase();
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
                if (String(row.getCell(2).value || '').toUpperCase() !== 'DECK') return;
                idx++;
                setJobCell(wsJ, n, { groupNo: '01', groupName: 'LSA/FFE', jobCode: `01-${String(idx).padStart(3, '0')}` });
            });
        });
        const lsa001 = after.find(j => j.department === 'DECK' && j.job_code === '01-001');
        assert('import succeeds', result.jobs > 0);
        assert('LSA/FFE 01-001 exists', !!lsa001);
        assert('CARGO TANK jobs removed', !after.some(j => j.department === 'DECK' && norm(j.group).includes('CARGO TANK MONITORING')));
    });

    await runScenario('5) Legacy combined group 26 still splits by job code (pre-master seed)', async () => {
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

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
