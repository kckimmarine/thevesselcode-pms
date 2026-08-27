#!/usr/bin/env node
/**
 * Engine → Master → HQ → Master Monthly Report round-trip simulation
 * Usage: npm run test-vessel-engine-monthly-roundtrip
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'pms-unified.json'), 'utf8'));
const SYNC_SRC = fs.readFileSync(path.join(ROOT, 'js', 'services', 'sync.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

function loadModule(relPath, exportName) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
        + `\nglobalThis.__loaded_${exportName} = ${exportName};`;
    eval(code);
    const mod = globalThis[`__loaded_${exportName}`];
    globalThis[exportName] = mod;
    return mod;
}

function loadSchemaBundle() {
    const code = fs.readFileSync(path.join(ROOT, 'js', 'core', 'schema.js'), 'utf8')
        + `\nglobalThis.__schema = { TVC_SCHEMA, TVC_META_KEYS, TVC_WorkReport, TVC_DefectCase, TVC_WorkPermit };`;
    eval(code);
    for (const [k, v] of Object.entries(globalThis.__schema)) globalThis[k] = v;
}

// ── In-memory DB ──
const stores = {
    maintenance_jobs: [],
    daily_work_reports: [],
    maintenance_groups: [],
    spare_parts: [],
    ship_components: [],
    audit_logs: [],
    requisitions: [],
    job_bom: [],
    universal_catalog: [],
    defect_cases: [],
    sync_history: [],
};
const meta = { vessel_id: 'INCHEON CHEMI' };

global.TVC_META_KEYS = global.TVC_META_KEYS || { VESSEL_ID: 'vessel_id' };
global.TVC_DB = {
    async getMeta(k) { return meta[k] ?? null; },
    async setMeta(k, v) { meta[k] = v; },
    async getAll(name) { return [...(stores[name] || [])]; },
    async get(name, id) { return (stores[name] || []).find(r => r.id === id) || null; },
    async put(name, row) {
        const arr = stores[name] || (stores[name] = []);
        if (name === 'spare_parts') {
            const pn = String(row.part_no || '').trim();
            if (pn) {
                const dup = arr.find(r => r.id !== row.id && String(r.part_no || '').trim() === pn);
                if (dup) {
                    throw new Error("Unable to add key to index 'by_part_no': at least one key does not satisfy the uniqueness requirements.");
                }
            }
        }
        const i = arr.findIndex(r => r.id === row.id);
        if (i >= 0) arr[i] = { ...row };
        else arr.push({ ...row });
    },
    async indexGetAll(name, index, query) {
        if (name === 'spare_parts' && index === 'by_part_no') {
            const q = String(query || '').trim();
            return (stores.spare_parts || []).filter(r => String(r.part_no || '').trim() === q);
        }
        if (name === 'daily_work_reports' && index === 'by_job_code') {
            const q = String(query || '').trim();
            return (stores.daily_work_reports || []).filter(r => String(r.job_code || '').trim() === q);
        }
        return [];
    },
    async runTransaction(_stores, fn) {
        const api = {
            get: (s, id) => global.TVC_DB.get(s, id),
            put: (s, row) => global.TVC_DB.put(s, row),
        };
        return fn(api);
    },
};

global.localStorage = (() => {
    const s = {};
    return {
        getItem(k) { return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; },
        setItem(k, v) { s[k] = String(v); },
        removeItem(k) { delete s[k]; },
        key(i) { return Object.keys(s)[i] ?? null; },
        get length() { return Object.keys(s).length; },
    };
})();

global.TVC_FileExport = { async save() {} };
global.TVC_License = { statusSync: () => ({ enforced: false }), assertExportImport: () => ({ ok: true }) };
global.TVC_Fleet = {
    PILOT_VESSEL_ID: 'INCHEON CHEMI',
    getSelectedId: () => 'INCHEON CHEMI',
    resolveById: (id) => ({ name: id }),
};
global.TVC_App = { getAppDepartment: () => 'ENGINE' };
global.TVC_Space = {
    Direction: { STATION_TO_HUB: 'STATION_TO_HUB', SHIP_TO_HQ: 'SHIP_TO_HQ', HQ_TO_SHIP: 'HQ_TO_SHIP' },
    Endpoint: { STATION_EXPORT: 'STATION_EXPORT', HUB_IMPORT: 'HUB_IMPORT' },
    assertEndpoint() {},
    getStation: (u) => u.station,
    canAccessDepartment: () => true,
    isCaptainHub: (u) => u.station === 'CAPTAIN',
    isEngineVesselMode: (u) => u.station === 'ECR',
    isDeckVesselMode: (u) => u.station === 'CCR',
};

loadModule('js/rbac.js', 'TVC_RBAC');
loadSchemaBundle();
loadModule('js/core/filename.js', 'TVC_Filename');
loadModule('js/pms.js', 'TVC_PMS');
loadModule('js/core/indexes.js', 'TVC_Indexes');
const Sync = loadModule('js/services/sync.js', 'TVC_Sync');

const CE = { username: 'ce', role: 'SHIP_CHIEF', department: 'ENGINE', station: 'ECR', account_type: 'SHIP', vessel_id: 'INCHEON CHEMI' };
const CO = { username: 'co', role: 'SHIP_CAPTAIN', department: 'DECK', station: 'CCR', account_type: 'SHIP', vessel_id: 'INCHEON CHEMI' };
const CAPTAIN = { username: 'captain', role: 'SHIP_CAPTAIN', department: null, station: 'CAPTAIN', account_type: 'SHIP', vessel_id: 'INCHEON CHEMI' };
const HQ = { username: 'hq', role: 'HQ_SUPERVISOR', department: 'ENGINE', account_type: 'HQ', vessel_id: 'INCHEON CHEMI' };
const HQ_DECK = { username: 'hq', role: 'HQ_SUPERVISOR', department: 'DECK', account_type: 'HQ', vessel_id: 'INCHEON CHEMI' };

let pass = 0;
let fail = 0;
function assert(name, cond, detail = '') {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

function assertThrows(name, fn, pattern) {
    try {
        fn();
        assert(name, false, 'expected throw');
    } catch (e) {
        assert(name, !pattern || pattern.test(String(e.message || e)), String(e.message || e));
    }
}

function cloneEngineJobs() {
    return SEED.maintenance_jobs
        .filter(j => j.department === 'ENGINE')
        .slice(0, 20)
        .map(j => ({ ...j, sync_status: 'PENDING_SYNC', updated_at: '2026-08-11T00:00:00.000Z' }));
}

function cloneDeckJobs() {
    return SEED.maintenance_jobs
        .filter(j => j.department === 'DECK')
        .slice(0, 20)
        .map(j => ({ ...j, sync_status: 'PENDING_SYNC', updated_at: '2026-08-11T00:00:00.000Z' }));
}

function makeDeckReports(jobs) {
    const codes = jobs.slice(0, 5).map(j => j.job_code);
    const mk = (id, type, code, status) => ({
        id,
        work_type: type,
        status,
        is_locked: status === 'APPROVED',
        job_code: code,
        department: 'DECK',
        sync_status: 'PENDING_SYNC',
        updated_at: '2026-08-11T00:00:00.000Z',
        report_date: '2026-08-10',
        work_date: '2026-08-10',
        job_items: [{
            maintenance_job_id: `job-${code}`,
            job_code: code,
            status,
            form: { fileNo: `${code}-F` },
        }],
    });
    return codes.map((code, i) => mk(`rep-d${i + 1}`, i === 4 ? 'POSTPONE' : 'MAINTENANCE', code, 'CONFIRMED'));
}

function makeReports() {
    const mk = (id, type, code, status) => ({
        id,
        work_type: type,
        status,
        is_locked: status === 'APPROVED',
        job_code: code,
        department: 'ENGINE',
        sync_status: 'PENDING_SYNC',
        updated_at: '2026-08-11T00:00:00.000Z',
        report_date: '2026-08-10',
        work_date: '2026-08-10',
        job_items: [{
            maintenance_job_id: `job-${code}`,
            job_code: code,
            status,
            form: { fileNo: `${code}-F` },
        }],
    });
    return [
        mk('rep-m1', 'MAINTENANCE', '01-001', 'CONFIRMED'),
        mk('rep-m2', 'MAINTENANCE', '01-002', 'CONFIRMED'),
        mk('rep-m3', 'MAINTENANCE', '01-003', 'CONFIRMED'),
        mk('rep-m4', 'MAINTENANCE', '01-004', 'CONFIRMED'),
        mk('rep-p1', 'POSTPONE', '01-010', 'CONFIRMED'),
    ];
}

function resetDb(jobs, reports) {
    Object.keys(stores).forEach(k => { stores[k] = []; });
    stores.maintenance_jobs = jobs.map(j => ({ ...j }));
    stores.daily_work_reports = reports.map(r => ({ ...r }));
    meta.vessel_id = 'INCHEON CHEMI';
    global.TVC_PMS.writeStore({
        'ENGINE|01.        MAIN ENGINE': { totalRunHours: 10500, prevMonth: 500, expectedNextMonth: 700, updated: '2026-08-11' },
        _lastUpdatedDate: '2026-08-11',
    });
}

async function payloadFromExport(user, direction, dept, opts = {}) {
    const payload = await Sync.exportZip(user, direction, dept, opts);
    const zip = new JSZip();
    zip.file('tvc_sync.json', JSON.stringify(payload, null, 2));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    return { payload, buf, filename: stores.sync_history.at(-1)?.filename || '' };
}

async function importBuf(user, buf, name, dept, opts = {}) {
    const zip = await JSZip.loadAsync(buf);
    const payload = JSON.parse(await zip.file('tvc_sync.json').async('string'));
    const isHq = global.TVC_RBAC.isHqAccount(user);
    const fileDept = payload.export_meta?.department;
    dept = dept || fileDept || user.department;
    const mergeDept = dept === 'ALL' ? null : dept;
    const vesselId = payload.export_meta?.vessel_id || null;
    await Sync.mergePayload(payload, mergeDept, isHq, vesselId, { importAuthoritative: true });
    if (payload.run_hours && global.TVC_PMS) {
        const myScope = isHq ? global.TVC_PMS.scopeOf('HQ', vesselId) : 'SHIP';
        const store = global.TVC_PMS.readStore(myScope);
        for (const [k, v] of Object.entries(payload.run_hours)) {
            if (!mergeDept || k.startsWith(mergeDept + '|')) store[k] = v;
        }
        global.TVC_PMS.writeStore(store, myScope);
    }
    await Sync.recordSyncHistory({
        type: 'IMPORT',
        direction: payload.export_meta?.direction || 'UNKNOWN',
        department: dept,
        vessel_id: vesselId || '—',
        filename: name,
        record_count: payload.daily_work_reports?.length || 0,
        status: 'SUCCESS',
        peer: opts.allowHubMerge ? 'Engine' : 'Company',
    });
    return payload;
}

function countEngineReports() {
    return stores.daily_work_reports.filter(r => r.department === 'ENGINE' || !r.department).length;
}

function countDeckReports() {
    return stores.daily_work_reports.filter(r => r.department === 'DECK').length;
}

function menuHistPeer(row, user) {
    if (row?.peer) return row.peer;
    return 'Master';
}

async function scenario(name, fn) {
    console.log(`\n=== ${name} ===`);
    await fn();
}

async function main() {
    const PMS = global.TVC_PMS;

    await scenario('1) Engine — Monthly export (STATION_TO_HUB)', async () => {
        resetDb(cloneEngineJobs(), makeReports());
        const { payload, filename } = await payloadFromExport(CE, 'STATION_TO_HUB', 'ENGINE', {
            monthlyExport: true,
            station_id: 'ECR',
        });
        assert('filename incheonchemi_monthly_engine_YYYYMMDD_001.zip',
            /^incheonchemi_monthly_engine_\d{8}_\d{3}\.zip$/.test(filename), filename);
        assert('package_type MONTHLY', payload.export_meta.package_type === 'MONTHLY');
        assert('5 work reports in payload', payload.daily_work_reports.length === 5, `count=${payload.daily_work_reports.length}`);
        assert('run_hours included', Object.keys(payload.run_hours || {}).length >= 1);
        const hist = stores.sync_history.at(-1);
        assert('sync_history Direction peer Master/HQ', menuHistPeer(hist, CE) === 'Master/HQ', hist?.peer);
        assert('reports marked SYNCED on engine after export',
            stores.daily_work_reports.every(r => r.sync_status === 'SYNCED'));
    });

    let enginePayload;
    let engineBuf;

    await scenario('2–4) Master — import Engine zip & data match', async () => {
        resetDb(cloneEngineJobs(), makeReports());
        const exp = await payloadFromExport(CE, 'STATION_TO_HUB', 'ENGINE', { monthlyExport: true, station_id: 'ECR' });
        enginePayload = exp.payload;
        engineBuf = exp.buf;

        resetDb([], []);
        await importBuf(CAPTAIN, engineBuf, 'incheonchemi_monthly_engine_20260811_001.zip', 'ENGINE', { allowHubMerge: true });
        assert('Master has 5 imported reports', countEngineReports() === 5, `count=${countEngineReports()}`);
        assert('Master jobs imported', stores.maintenance_jobs.length === enginePayload.maintenance_jobs.length);
        assert('run_hours merged on Master',
            PMS.readStore()['ENGINE|01.        MAIN ENGINE']?.totalRunHours === 10500);
        const impHist = stores.sync_history.at(-1);
        assert('import history recorded', impHist?.type === 'IMPORT');
    });

    await scenario('5) Master — Monthly export to HQ (SHIP_TO_HQ)', async () => {
        const { payload, filename } = await payloadFromExport(CAPTAIN, 'SHIP_TO_HQ', 'ENGINE', { monthlyExport: true });
        assert('Master export filename matches monthly engine pattern',
            /^incheonchemi_monthly_engine_\d{8}_\d{3}\.zip$/.test(filename), filename);
        assert('Master export includes all 5 reports (monthly snapshot)',
            payload.daily_work_reports.length === 5, `count=${payload.daily_work_reports.length}`);
        const hist = stores.sync_history.at(-1);
        assert('Direction peer Master/HQ', menuHistPeer(hist, CAPTAIN) === 'Master/HQ', hist?.peer);
    });

    let hqPayload;

    await scenario('6–7) HQ — import & data match Engine', async () => {
        const masterExp = await payloadFromExport(CAPTAIN, 'SHIP_TO_HQ', 'ENGINE', { monthlyExport: true });
        resetDb([], []);
        hqPayload = await importBuf(HQ, masterExp.buf, 'incheonchemi_monthly_engine_20260811_001.zip', 'ENGINE');
        assert('HQ imported 5 reports', countEngineReports() === 5);
        assert('HQ run_hours scope',
            PMS.readStore(PMS.scopeOf('HQ', 'INCHEON CHEMI'))['ENGINE|01.        MAIN ENGINE']?.expectedNextMonth === 700);
        assert('job count matches engine export',
            stores.maintenance_jobs.length === enginePayload.maintenance_jobs.length);
        assert('imported reports tagged ENGINE dept',
            stores.daily_work_reports.every(r => r.department === 'ENGINE'),
            stores.daily_work_reports.map(r => r.department || '—').join(','));
        assert('imported reports hq_synced',
            stores.daily_work_reports.every(r => r.hq_synced === true));
    });

    await scenario('8) HQ — Company Comments WELL NOTED on 5 reports', async () => {
        assert('histHqReportApproval prompts for company comment',
            APP_SRC.includes('TVC_Dialog.promptText') && APP_SRC.includes('approveReport(user, id, companyComment'));
        assert('Company Comments editable in Work Report detail for HQ approve',
            APP_SRC.includes('canEditCompanyComment') && APP_SRC.includes('wr-company-comment-edit'));
        assert('closeWorkReport passes detail company comment to approveReport',
            APP_SRC.includes('readWrCompanyComment(rep)'));

        for (const r of stores.daily_work_reports) {
            r.company_comment = 'WELL NOTED';
            r.status = 'APPROVED';
            r.is_locked = true;
            r.sync_status = 'PENDING_SYNC';
            await TVC_DB.put('daily_work_reports', r);
        }
        assert('5 reports have WELL NOTED', stores.daily_work_reports.every(r => r.company_comment === 'WELL NOTED'));
    });

    await scenario('9) HQ — Monthly reply export (engine_hq filename)', async () => {
        assert('sync uses hqReplyScopeToken for HQ monthly export',
            SYNC_SRC.includes('TVC_Filename.hqReplyScopeToken(dept)'));
        const { payload, filename } = await payloadFromExport(HQ, 'HQ_TO_SHIP', 'ENGINE', { monthlyExport: true });
        assert('filename incheonchemi_monthly_engine_hq_YYYYMMDD_001.zip',
            /^incheonchemi_monthly_engine_hq_\d{8}_\d{3}\.zip$/.test(filename), filename);
        assert('company_comments in HQ export payload',
            (payload.company_comments || []).length === 5, `count=${(payload.company_comments || []).length}`);
        assert('all comments WELL NOTED',
            (payload.company_comments || []).every(c => c.comment === 'WELL NOTED'));
        const parsed = TVC_Filename.parseScoped(filename);
        assert('parseScoped detects engine_hq reply', parsed?.scope === 'engine_hq', JSON.stringify(parsed));
    });

    await scenario('10) Master — import HQ reply zip', async () => {
        const hqExp = await payloadFromExport(HQ, 'HQ_TO_SHIP', 'ENGINE', { monthlyExport: true });
        resetDb(stores.maintenance_jobs.map(j => ({ ...j })), stores.daily_work_reports.map(r => ({ ...r, sync_status: 'SYNCED' })));
        await importBuf(CAPTAIN, hqExp.buf, 'incheonchemi_monthly_engine_hq_20260811_001.zip', 'ENGINE');
        assert('Master received company comments',
            stores.daily_work_reports.filter(r => r.company_comment === 'WELL NOTED').length === 5,
            `count=${stores.daily_work_reports.filter(r => r.company_comment === 'WELL NOTED').length}`);
        assert('reports APPROVED or carry WELL NOTED after HQ reply',
            stores.daily_work_reports.every(r => r.company_comment === 'WELL NOTED' && (r.status === 'APPROVED' || r.is_locked === true)));
    });

    await scenario('11) Master — re-export HQ reply to Engine station', async () => {
        const { payload, filename } = await payloadFromExport(CAPTAIN, 'HQ_TO_SHIP', 'ENGINE', { monthlyExport: true });
        assert('Master relay filename is engine_hq (not Company SHIP_TO_HQ)',
            /^incheonchemi_monthly_engine_hq_\d{8}_\d{3}\.zip$/.test(filename), filename);
        assert('relay direction HQ_TO_SHIP', payload.export_meta.direction === 'HQ_TO_SHIP');
        assert('relay still MONTHLY', payload.export_meta.package_type === 'MONTHLY');
        assert('relay carries WELL NOTED comments',
            (payload.company_comments || []).every(c => c.comment === 'WELL NOTED')
            && (payload.company_comments || []).length === 5,
            `count=${(payload.company_comments || []).length}`);
        const parsed = TVC_Filename.parseScoped(filename);
        assert('CE can parse relay as engine HQ reply', parsed?.isHqReply === true && parsed?.department === 'engine', JSON.stringify(parsed));
    });

    await scenario('12) CE — import Master-relayed HQ reply', async () => {
        const masterRelay = await payloadFromExport(CAPTAIN, 'HQ_TO_SHIP', 'ENGINE', { monthlyExport: true });
        global.TVC_App.getAppDepartment = () => 'ENGINE';
        const scope = Sync.validateImportPackageScope(CE, { name: masterRelay.filename }, masterRelay.payload);
        assert('CE accepts Master HQ_TO_SHIP relay', scope.ok === true, JSON.stringify(scope));

        resetDb(cloneEngineJobs(), makeReports().map(r => ({ ...r, sync_status: 'SYNCED' })));
        assert('CE starts without company comments',
            stores.daily_work_reports.every(r => !r.company_comment));
        await importBuf(CE, masterRelay.buf, masterRelay.filename, 'ENGINE');
        assert('CE received WELL NOTED after Master relay import',
            stores.daily_work_reports.filter(r => r.company_comment === 'WELL NOTED').length === 5,
            `count=${stores.daily_work_reports.filter(r => r.company_comment === 'WELL NOTED').length}`);
        assert('CE reports APPROVED after HQ reply import',
            stores.daily_work_reports.every(r => r.status === 'APPROVED' && r.is_locked === true));
    });

    await scenario('Regression — spare part_no merge on Master hub', async () => {
        resetDb(cloneEngineJobs(), makeReports());
        const engineSpare = {
            id: 'engine-spare-id-001',
            part_no: 'ME-EX-001',
            name: 'Engine spare sample',
            sync_status: 'PENDING_SYNC',
            updated_at: '2026-08-11T00:00:00.000Z',
        };
        stores.spare_parts.push({ ...engineSpare });
        const exp = await payloadFromExport(CE, 'STATION_TO_HUB', 'ENGINE', { monthlyExport: true, station_id: 'ECR' });
        assert('engine export includes spare sample',
            (exp.payload.spare_parts || []).some(s => s.part_no === engineSpare.part_no));

        resetDb([], []);
        stores.spare_parts.push({
            id: 'master-spare-existing-id',
            part_no: engineSpare.part_no,
            name: 'Master existing spare',
            sync_status: 'LOCAL',
            updated_at: '2026-08-01T00:00:00.000Z',
        });

        await importBuf(CAPTAIN, exp.buf, 'incheonchemi_monthly_engine_20260811_001.zip', 'ENGINE', { allowHubMerge: true });
        assert('no duplicate part_no after hub merge',
            stores.spare_parts.filter(s => String(s.part_no || '').trim() === engineSpare.part_no).length === 1,
            `count=${stores.spare_parts.filter(s => String(s.part_no || '').trim() === engineSpare.part_no).length}`);
        assert('hub keeps existing spare id',
            stores.spare_parts.some(s => s.id === 'master-spare-existing-id' && s.part_no === engineSpare.part_no));
    });

    await scenario('Import routing — Engine/Deck scope & direct paths', async () => {
        const engineStationZip = {
            export_meta: { direction: 'STATION_TO_HUB', department: 'ENGINE', station_id: 'ECR' },
        };
        const engineFile = { name: 'incheonchemi_monthly_engine_20260811_001.zip' };
        const hqReply = { export_meta: { direction: 'HQ_TO_SHIP', department: 'ENGINE' } };
        const hqReplyFile = { name: 'incheonchemi_monthly_engine_hq_20260811_001.zip' };
        const deckUser = { username: 'co', role: 'SHIP_CAPTAIN', department: 'DECK', station: 'CCR', account_type: 'SHIP', vessel_id: 'INCHEON CHEMI' };

        assertThrows('Engine station cannot import its own STATION_TO_HUB on Engine PC', () => {
            Sync.validateImportPackageScope(CE, engineFile, engineStationZip);
        }, /Import station export ZIP in Master Mode or HQ Mode/);

        global.TVC_App.getAppDepartment = () => 'ENGINE';
        assert('Master + Engine toggle accepts Engine station export',
            Sync.validateImportPackageScope(CAPTAIN, engineFile, engineStationZip).route === 'hub_merge');
        assert('HQ + Engine toggle accepts Engine station export (direct path)',
            Sync.validateImportPackageScope(HQ, engineFile, engineStationZip).route === 'hq_direct');

        global.TVC_App.getAppDepartment = () => 'DECK';
        assertThrows('HQ Deck toggle rejects Engine station export', () => {
            Sync.validateImportPackageScope(HQ, engineFile, engineStationZip);
        }, /Department mismatch/);

        assertThrows('Deck station rejects Engine station export', () => {
            Sync.validateImportPackageScope(deckUser, engineFile, engineStationZip);
        }, /Deck export is not applied in Engine Mode|Import station export ZIP in Master Mode or HQ Mode/);

        global.TVC_App.getAppDepartment = () => 'ENGINE';
        assert('Engine station accepts HQ engine reply (direct path)',
            Sync.validateImportPackageScope(CE, hqReplyFile, hqReply).fileDept === 'ENGINE');

        assertThrows('Deck station rejects Engine HQ reply', () => {
            Sync.validateImportPackageScope(deckUser, hqReplyFile, hqReply);
        }, /Engine HQ reply is not applied in Deck Mode/);

        global.TVC_App.getAppDepartment = () => 'ENGINE';
    });

    await scenario('Regression — delta-only export empty after SYNCED (non-monthly)', async () => {
        resetDb(cloneEngineJobs(), makeReports().map(r => ({ ...r, sync_status: 'SYNCED' })));
        const delta = await Sync.collectDelta('ENGINE');
        assert('collectDelta empty when all SYNCED', delta.daily_work_reports.length === 0);
        const snap = await Sync.collectMonthlySnapshot('ENGINE');
        assert('collectMonthlySnapshot includes SYNCED rows',
            snap.daily_work_reports.length === 5, `count=${snap.daily_work_reports.length}`);
    });

    await scenario('CE — Monthly snapshot still writes a file with 0 pending reports', async () => {
        resetDb(cloneEngineJobs(), []);
        const { payload, filename } = await payloadFromExport(CE, 'STATION_TO_HUB', 'ENGINE', {
            monthlyExport: true,
            station_id: 'ECR',
        });
        assert('CE empty-pending filename is monthly engine zip',
            /^incheonchemi_monthly_engine_\d{8}_\d{3}\.zip$/.test(filename), filename);
        assert('package_type MONTHLY', payload.export_meta.package_type === 'MONTHLY');
        assert('jobs included even with 0 reports', payload.maintenance_jobs.length > 0);
        assert('0 work reports in empty-pending snapshot', payload.daily_work_reports.length === 0);
    });

    await scenario('Deck — CO → Master → HQ monthly roundtrip', async () => {
        global.TVC_App.getAppDepartment = () => 'DECK';
        const deckJobs = cloneDeckJobs();
        const deckReports = makeDeckReports(deckJobs);
        resetDb(deckJobs, deckReports);
        global.TVC_PMS.writeStore({
            'DECK|HULL': { totalRunHours: 0, updated: '2026-08-11' },
            _lastUpdatedDate: '2026-08-11',
        });

        const stationExp = await payloadFromExport(CO, 'STATION_TO_HUB', 'DECK', {
            monthlyExport: true,
            station_id: 'CCR',
        });
        assert('CO filename monthly deck',
            /^incheonchemi_monthly_deck_\d{8}_\d{3}\.zip$/.test(stationExp.filename), stationExp.filename);
        assert('CO package MONTHLY', stationExp.payload.export_meta.package_type === 'MONTHLY');
        assert('CO export has 5 deck reports', stationExp.payload.daily_work_reports.length === 5);

        resetDb([], []);
        await importBuf(CAPTAIN, stationExp.buf, stationExp.filename, 'DECK', { allowHubMerge: true });
        assert('Master imported 5 deck reports', countDeckReports() === 5, `count=${countDeckReports()}`);

        const masterExp = await payloadFromExport(CAPTAIN, 'SHIP_TO_HQ', 'DECK', { monthlyExport: true });
        assert('Master deck export filename',
            /^incheonchemi_monthly_deck_\d{8}_\d{3}\.zip$/.test(masterExp.filename), masterExp.filename);
        assert('Master deck snapshot keeps 5 reports',
            masterExp.payload.daily_work_reports.length === 5, `count=${masterExp.payload.daily_work_reports.length}`);

        resetDb([], []);
        await importBuf(HQ_DECK, masterExp.buf, masterExp.filename, 'DECK');
        assert('HQ imported 5 deck reports', countDeckReports() === 5);
        for (const r of stores.daily_work_reports) {
            r.company_comment = 'WELL NOTED';
            r.status = 'APPROVED';
            r.is_locked = true;
            r.sync_status = 'PENDING_SYNC';
            await TVC_DB.put('daily_work_reports', r);
        }
        const hqExp = await payloadFromExport(HQ_DECK, 'HQ_TO_SHIP', 'DECK', { monthlyExport: true });
        assert('HQ deck reply filename',
            /^incheonchemi_monthly_deck_hq_\d{8}_\d{3}\.zip$/.test(hqExp.filename), hqExp.filename);

        resetDb(deckJobs, deckReports.map(r => ({ ...r, sync_status: 'SYNCED' })));
        await importBuf(CAPTAIN, hqExp.buf, hqExp.filename, 'DECK');
        assert('Master received deck HQ comments',
            stores.daily_work_reports.filter(r => r.company_comment === 'WELL NOTED').length === 5);

        const masterRelay = await payloadFromExport(CAPTAIN, 'HQ_TO_SHIP', 'DECK', { monthlyExport: true });
        assert('Master deck relay filename is deck_hq',
            /^incheonchemi_monthly_deck_hq_\d{8}_\d{3}\.zip$/.test(masterRelay.filename), masterRelay.filename);
        assert('Master deck relay direction HQ_TO_SHIP', masterRelay.payload.export_meta.direction === 'HQ_TO_SHIP');

        const coScope = Sync.validateImportPackageScope(CO, { name: masterRelay.filename }, masterRelay.payload);
        assert('CO accepts Master HQ_TO_SHIP deck relay', coScope.ok === true, JSON.stringify(coScope));
        resetDb(deckJobs, deckReports.map(r => ({ ...r, sync_status: 'SYNCED' })));
        await importBuf(CO, masterRelay.buf, masterRelay.filename, 'DECK');
        assert('CO received WELL NOTED after Master relay import',
            stores.daily_work_reports.filter(r => r.company_comment === 'WELL NOTED').length === 5,
            `count=${stores.daily_work_reports.filter(r => r.company_comment === 'WELL NOTED').length}`);
        global.TVC_App.getAppDepartment = () => 'ENGINE';
    });

    await scenario('Source — CE always can export Monthly; Master Monthly is dept-scoped', async () => {
        assert('station monthly snapshot when no pending confirmed',
            APP_SRC.includes('stationPendingConfirmedReportCount(d) === 0'));
        assert('Master monthly uses selected ENGINE/DECK not COMPANY_REPORT',
            APP_SRC.includes("if (exportType === 'monthly')") && APP_SRC.includes("return (dept === 'DECK' || dept === 'ENGINE') ? dept : null"));
        assert('Master relays HQ reply down as HQ_TO_SHIP after import',
            APP_SRC.includes('monthlyHasHqReplyForDept') && APP_SRC.includes('relayHqReply'));
        assert('Captain hub may export HQ_TO_SHIP without HQ_FEEDBACK permission',
            SYNC_SRC.includes('hubRelayHqReply'));
        const fileExportSrc = fs.readFileSync(path.join(ROOT, 'js', 'services', 'fileExport.js'), 'utf8');
        assert('FileExport does not serialize zip as Array.from(buf)',
            !fileExportSrc.includes('Array.from(buf)'));
        assert('monthly snapshot ignores hub-relay pending filter',
            !SYNC_SRC.includes('collectMonthlySnapshot(dept, { hubRelayPending })'));
    });

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
