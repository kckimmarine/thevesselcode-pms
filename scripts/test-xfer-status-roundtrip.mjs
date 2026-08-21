#!/usr/bin/env node
/**
 * Status at each hop: engine–master–hq and deck–master–hq
 * Critical Postpone (company export) + Monthly maintenance.
 * Usage: npm run test-xfer-status-roundtrip
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
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

const stores = {
    maintenance_jobs: [],
    daily_work_reports: [],
    spare_parts: [],
    ship_components: [],
    audit_logs: [],
    requisitions: [],
    job_bom: [],
    universal_catalog: [],
    maintenance_groups: [],
    spare_groups: [],
    defect_cases: [],
    work_permits: [],
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
        const i = arr.findIndex(r => r.id === row.id);
        if (i >= 0) arr[i] = { ...row };
        else arr.push({ ...row });
    },
    async indexGetAll(name, index, query) {
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

let lastSave = null;
global.TVC_FileExport = {
    async save(blob, filename) {
        const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer());
        lastSave = { buf: Buffer.from(u8), filename };
    },
};
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
    isStationPc: (u) => u.station === 'ECR' || u.station === 'CCR',
};

loadModule('js/rbac.js', 'TVC_RBAC');
loadSchemaBundle();
loadModule('js/core/filename.js', 'TVC_Filename');
loadModule('js/pms.js', 'TVC_PMS');
loadModule('js/core/indexes.js', 'TVC_Indexes');
loadModule('js/services/hubRelay.js', 'TVC_HubRelay');
const Sync = loadModule('js/services/sync.js', 'TVC_Sync');
const Postpone = loadModule('js/services/postponeSync.js', 'TVC_PostponeSync');

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

function workflowStatus(report) {
    if (!report) return 'Reported';
    if (global.TVC_RBAC.isApprovedStatus(report.status, report.is_locked)) return 'Approved';
    if (global.TVC_RBAC.isConfirmedStatus(report.status, report.is_locked)) {
        if (report.sync_status === 'SYNCED') return 'Submitted';
        return 'Confirmed';
    }
    return 'Reported';
}

function confirmEnabled(report) {
    return workflowStatus(report) === 'Reported';
}

function uiPostponeExportOk(user, row) {
    const st = workflowStatus(row);
    if (global.TVC_RBAC.isHqAccount(user)) return st === 'Approved';
    if (global.TVC_Space.isCaptainHub(user)) {
        if (st === 'Approved') return true;
        return st === 'Submitted' && global.TVC_HubRelay.canHubLegExport(row);
    }
    return st === 'Confirmed' && global.TVC_HubRelay.canStationLegExport(row);
}

function resetDb(jobs, reports) {
    Object.keys(stores).forEach(k => { stores[k] = []; });
    stores.maintenance_jobs = (jobs || []).map(j => ({ ...j }));
    stores.daily_work_reports = (reports || []).map(r => ({ ...r }));
    meta.vessel_id = 'INCHEON CHEMI';
}

function makeJob(dept, code) {
    return {
        id: `job-${code}`,
        job_code: code,
        department: dept,
        name: `${code} SAFETY DEVICE`,
        item_sort1: 'CRITICAL',
        sort: 'C. CRITICAL',
        sync_status: 'PENDING_SYNC',
        updated_at: '2026-08-21T00:00:00.000Z',
    };
}

function makeCriticalPostpone(dept, code, status = 'CONFIRMED') {
    return {
        id: `pp-${code}`,
        work_type: 'POSTPONE',
        requires_company_approval: true,
        status,
        is_locked: status === 'APPROVED',
        job_code: code,
        department: dept,
        postpone_date: '2026-10-15',
        sync_status: status === 'CONFIRMED' ? 'PENDING_SYNC' : 'LOCAL',
        confirmed_at: status === 'REPORTED' ? null : '2026-08-21T00:00:00.000Z',
        confirmed_by: status === 'REPORTED' ? null : 'ce',
        updated_at: '2026-08-21T00:00:00.000Z',
        report_date: '2026-08-21',
        job_items: [{
            maintenance_job_id: `job-${code}`,
            job_code: code,
            status,
            form: { fileNo: `${code}-P`, postponeDate: '2026-10-15' },
        }],
    };
}

function asFile(buf, name) {
    const u8 = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    return {
        name,
        arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
    };
}

async function importPostpone(user, payload, jsonName, filename) {
    const zip = new JSZip();
    zip.file(jsonName, JSON.stringify(payload, null, 2));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    return Postpone.importPackage(user, asFile(buf, filename));
}

function makeMaintenance(dept, code, status = 'CONFIRMED') {
    return {
        id: `m-${code}`,
        work_type: 'MAINTENANCE',
        status,
        is_locked: status === 'APPROVED',
        job_code: code,
        department: dept,
        sync_status: status === 'CONFIRMED' ? 'PENDING_SYNC' : 'LOCAL',
        confirmed_at: status === 'REPORTED' ? null : '2026-08-21T00:00:00.000Z',
        updated_at: '2026-08-21T00:00:00.000Z',
        report_date: '2026-08-21',
        job_items: [{
            maintenance_job_id: `job-${code}`,
            job_code: code,
            status,
            form: { fileNo: `${code}-M` },
        }],
    };
}

async function payloadFromExport(user, direction, dept, opts = {}) {
    const payload = await Sync.exportZip(user, direction, dept, opts);
    const zip = new JSZip();
    zip.file('tvc_sync.json', JSON.stringify(payload, null, 2));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    return { payload, buf, filename: stores.sync_history.at(-1)?.filename || '' };
}

async function importMonthly(user, buf, name, dept, opts = {}) {
    const zip = await JSZip.loadAsync(buf);
    const payload = JSON.parse(await zip.file('tvc_sync.json').async('string'));
    const isHq = global.TVC_RBAC.isHqAccount(user);
    const mergeDept = dept === 'ALL' ? null : dept;
    const vesselId = payload.export_meta?.vessel_id || null;
    await Sync.mergePayload(payload, mergeDept, isHq, vesselId, { importAuthoritative: true });
    await Sync.recordSyncHistory({
        type: 'IMPORT',
        direction: payload.export_meta?.direction || 'UNKNOWN',
        department: dept,
        vessel_id: vesselId || '—',
        filename: name,
        record_count: payload.daily_work_reports?.length || 0,
        status: 'SUCCESS',
        peer: opts.allowHubMerge ? 'Station' : 'Company',
    });
    return payload;
}

async function monthlyChain(label, stationUser, hqUser, dept, code, stationId) {
    const job = makeJob(dept, code);
    const report = makeMaintenance(dept, code, 'CONFIRMED');
    resetDb([job], [report]);
    global.TVC_App.getAppDepartment = () => dept;

    assert(`${label} monthly after Confirm → Confirmed`, workflowStatus(stores.daily_work_reports[0]) === 'Confirmed');
    assert(`${label} monthly Confirm disabled`, confirmEnabled(stores.daily_work_reports[0]) === false);

    const stExp = await payloadFromExport(stationUser, 'STATION_TO_HUB', dept, {
        monthlyExport: true,
        station_id: stationId,
    });
    const afterSt = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} after station Monthly Export → Submitted`, workflowStatus(afterSt) === 'Submitted', workflowStatus(afterSt));

    resetDb([job], []);
    await importMonthly(CAPTAIN, stExp.buf, stExp.filename, dept, { allowHubMerge: true });
    const onMaster = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} Master Monthly Import → Submitted`, workflowStatus(onMaster) === 'Submitted', workflowStatus(onMaster));
    assert(`${label} Master monthly Confirm disabled (Submitted)`, confirmEnabled(onMaster) === false);

    const masterToHq = await payloadFromExport(CAPTAIN, 'SHIP_TO_HQ', dept, { monthlyExport: true });
    resetDb([job], []);
    await importMonthly(hqUser, masterToHq.buf, masterToHq.filename, dept);
    const onHq = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} HQ Monthly Import → Submitted`, workflowStatus(onHq) === 'Submitted', workflowStatus(onHq));

    onHq.status = 'APPROVED';
    onHq.is_locked = true;
    onHq.company_comment = 'WELL NOTED';
    onHq.sync_status = 'PENDING_SYNC';
    await TVC_DB.put('daily_work_reports', onHq);
    assert(`${label} HQ Approve → Approved`, workflowStatus(await TVC_DB.get('daily_work_reports', report.id)) === 'Approved');

    const hqReply = await payloadFromExport(hqUser, 'HQ_TO_SHIP', dept, { monthlyExport: true });
    resetDb([job], [{ ...onMaster, sync_status: 'SYNCED' }]);
    await importMonthly(CAPTAIN, hqReply.buf, hqReply.filename, dept);
    const masterAfterHq = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} Master Import HQ monthly reply → Approved`, workflowStatus(masterAfterHq) === 'Approved', workflowStatus(masterAfterHq));

    const masterRelay = await payloadFromExport(CAPTAIN, 'HQ_TO_SHIP', dept, { monthlyExport: true });
    resetDb([job], [{ ...afterSt }]);
    await importMonthly(stationUser, masterRelay.buf, masterRelay.filename, dept);
    const onStation = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} station Import Master-relayed monthly → Approved`, workflowStatus(onStation) === 'Approved', workflowStatus(onStation));
}

async function postponeChain(label, stationUser, hqUser, dept, code) {
    const job = makeJob(dept, code);
    const report = makeCriticalPostpone(dept, code, 'CONFIRMED');
    resetDb([job], [report]);
    global.TVC_App.getAppDepartment = () => dept;

    assert(`${label} CE/CO after Confirm → Confirmed`, workflowStatus(stores.daily_work_reports[0]) === 'Confirmed');
    assert(`${label} Report Confirm disabled after Confirm`, confirmEnabled(stores.daily_work_reports[0]) === false);
    assert(`${label} station can export Confirmed postpone`, uiPostponeExportOk(stationUser, stores.daily_work_reports[0]));

    const ceExp = await Postpone.exportRequestZip(stationUser, report.id);
    const afterCe = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} after station Postpone Export → Submitted`, workflowStatus(afterCe) === 'Submitted', workflowStatus(afterCe));
    assert(`${label} station cannot re-export Submitted`, !uiPostponeExportOk(stationUser, afterCe));

    resetDb([job], [{ ...afterCe }]);
    await importPostpone(CAPTAIN, ceExp.payload, 'postpone_report.json', ceExp.filename);
    const onMaster = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} Master Import → Submitted`, workflowStatus(onMaster) === 'Submitted', workflowStatus(onMaster));
    assert(`${label} Master Report Confirm stays disabled`, confirmEnabled(onMaster) === false);
    assert(`${label} Master CAN export Submitted postpone (hub leg)`, uiPostponeExportOk(CAPTAIN, onMaster),
        `st=${workflowStatus(onMaster)} hub=${global.TVC_HubRelay.canHubLegExport(onMaster)}`);

    const masterExp = await Postpone.exportRequestZip(CAPTAIN, report.id);
    const afterMaster = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} after Master Postpone Export → still Submitted`, workflowStatus(afterMaster) === 'Submitted');
    assert(`${label} Master hub_sync stamped`, afterMaster.hub_sync_status === 'SYNCED');

    resetDb([job], []);
    await importPostpone(hqUser, masterExp.payload, 'postpone_report.json', masterExp.filename);
    const onHq = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} HQ Import → Submitted`, workflowStatus(onHq) === 'Submitted', workflowStatus(onHq));

    onHq.status = 'APPROVED';
    onHq.is_locked = true;
    onHq.approved_postpone_date = '2026-11-01';
    onHq.approved_at = '2026-08-21T12:00:00.000Z';
    onHq.approved_by = 'hq';
    onHq.sync_status = 'PENDING_SYNC';
    await TVC_DB.put('daily_work_reports', onHq);
    assert(`${label} HQ Approve → Approved`, workflowStatus(await TVC_DB.get('daily_work_reports', report.id)) === 'Approved');

    const hqExp = await Postpone.exportHqReplyZip(hqUser, report.id);
    assert(`${label} HQ Reply ZIP created`, !!hqExp.filename && hqExp.payload.export_meta.direction === 'POSTPONE_REPLY_HQ_TO_SHIP');

    resetDb([job], [{ ...afterMaster, sync_status: 'SYNCED' }]);
    await importPostpone(CAPTAIN, hqExp.payload, 'postpone_report_reply.json', hqExp.filename);
    const masterAfterHq = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} Master Import HQ reply → Approved`, workflowStatus(masterAfterHq) === 'Approved', workflowStatus(masterAfterHq));
    assert(`${label} Master can relay Approved reply to station`, uiPostponeExportOk(CAPTAIN, masterAfterHq));

    const masterRelay = await Postpone.exportHqReplyZip(CAPTAIN, report.id);
    resetDb([job], [{ ...afterCe }]);
    await importPostpone(stationUser, masterRelay.payload, 'postpone_report_reply.json', masterRelay.filename);
    const onStation = await TVC_DB.get('daily_work_reports', report.id);
    assert(`${label} station Import Master-relayed HQ reply → Approved`, workflowStatus(onStation) === 'Approved', workflowStatus(onStation));
}

async function scenario(name, fn) {
    console.log(`\n=== ${name} ===`);
    await fn();
}

async function main() {
    await scenario('Source — Master postpone export no longer requires Confirmed', async () => {
        assert('hub Submitted branch exists',
            APP_SRC.includes('awaiting station export first (Submitted). Report Confirm is station-only.'));
        assert('old Confirmed-only gate is hub-guarded',
            APP_SRC.includes("if (st !== 'Confirmed')")
            && APP_SRC.includes('hub || isMasterHubMode()'));
    });

    await scenario('engine–master–hq — Critical Postpone 02-00-001 statuses', async () => {
        await postponeChain('ENGINE', CE, HQ, 'ENGINE', '02-00-001');
    });

    await scenario('deck–master–hq — Critical Postpone statuses', async () => {
        await postponeChain('DECK', CO, HQ_DECK, 'DECK', '04-00-001');
    });

    await scenario('engine–master–hq — Monthly maintenance statuses', async () => {
        await monthlyChain('ENGINE', CE, HQ, 'ENGINE', '01-00-001', 'ECR');
    });

    await scenario('deck–master–hq — Monthly maintenance statuses', async () => {
        await monthlyChain('DECK', CO, HQ_DECK, 'DECK', '03-00-001', 'CCR');
    });

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
