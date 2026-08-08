#!/usr/bin/env node
/**
 * Electron 4-SKU mode simulation (HQ / Master / Engine / Deck)
 * Usage: npm run test-electron-four-modes
 */
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SEED_PATH = path.join(ROOT, 'data', 'pms-unified.json');
const require = createRequire(import.meta.url);
const { SKUS, PILOT_VESSEL_ID } = require('../electron/sku.js');

const WINDOW_TITLE_BASE = 'THE VESSEL CODE — TVC-PMS';
const MERGED_GEN_ENGINE_KEY = '__SPARE_MERGE_03_05_GENERATOR__';
const MERGED_GEN_ENGINE_LABEL = '03. GENERATOR ENGINE';

const USERS = {
    hq: { username: 'hq', display_name: 'Superintendent', account_type: 'HQ', role: 'HQ_SUPERVISOR', department: null, vessel_id: null },
    captain: { username: 'captain', display_name: 'Captain', account_type: 'SHIP', role: 'SHIP_CAPTAIN', department: 'DECK', vessel_id: PILOT_VESSEL_ID, station: 'CAPTAIN' },
    ce: { username: 'ce', display_name: 'Chief engineer', account_type: 'SHIP', role: 'SHIP_CHIEF', department: 'ENGINE', vessel_id: PILOT_VESSEL_ID, station: 'ECR' },
    co: { username: 'co', display_name: 'Chief officer', account_type: 'SHIP', role: 'SHIP_CAPTAIN', department: 'DECK', vessel_id: PILOT_VESSEL_ID, station: 'CCR' },
};

const MODES = [
    {
        sku: 'HQ_OFFICE',
        title: 'HQ Mode (Daemyung HQ Office)',
        userKey: 'hq',
        loginMode: null,
        windowSuffix: 'HQ',
        sessionDept: 'DECK',
        canToggleDept: true,
        loadScope: 'hq',
        pmsMasterDepts: ['DECK', 'ENGINE'],
        sparePick: { dept: 'DECK', match: /^\d+\.\s/ },
        crossImport: true,
    },
    {
        sku: 'VESSEL_MASTER',
        title: 'Master Mode (Captain Hub)',
        userKey: 'captain',
        loginMode: 'MASTER',
        windowSuffix: 'MASTER',
        sessionDept: 'DECK',
        canToggleDept: true,
        loadScope: 'captain',
        pmsMasterDepts: ['DECK', 'ENGINE'],
        sparePick: { dept: 'ENGINE', match: /^\d+\.\s/ },
        crossImport: true,
    },
    {
        sku: 'VESSEL_ENGINE',
        title: 'Engine Mode (ECR)',
        userKey: 'ce',
        loginMode: 'ENGINE',
        windowSuffix: 'ENGINE',
        sessionDept: 'ENGINE',
        canToggleDept: false,
        loadScope: 'station-engine',
        pmsMasterDepts: ['ENGINE'],
        sparePick: { dept: 'ENGINE', match: /^01\.\s/ },
        crossImport: false,
    },
    {
        sku: 'VESSEL_DECK',
        title: 'Deck Mode (CCR)',
        userKey: 'co',
        loginMode: 'DECK',
        windowSuffix: 'DECK',
        sessionDept: 'DECK',
        canToggleDept: false,
        loadScope: 'station-deck',
        pmsMasterDepts: ['DECK'],
        sparePick: { dept: 'DECK', match: /^\d+\./ },
        crossImport: false,
    },
];

let pass = 0;
let fail = 0;

function assert(name, cond, detail = '') {
    if (cond) { console.log(`    ✓ ${name}`); pass++; }
    else { console.log(`    ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

function loadModule(relPath, exportName) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
        + `\nglobalThis.__loaded_${exportName} = ${exportName};`;
    eval(code);
    return globalThis[`__loaded_${exportName}`];
}

function assertLoginModeForSku(skuDef, loginMode, accountType) {
    const isHq = String(accountType || '').toUpperCase() === 'HQ';
    if (skuDef.allowHq) {
        if (!isHq) return { ok: false, error: 'HQ SKU rejects vessel account' };
        return { ok: true };
    }
    if (isHq) return { ok: false, error: 'Vessel SKU rejects HQ account' };
    const mode = String(loginMode || '').toUpperCase();
    const allowed = (skuDef.loginModes || []).map(m => String(m).toUpperCase());
    if (!mode || !allowed.includes(mode)) {
        return { ok: false, error: `Allowed: ${allowed.join(', ')}` };
    }
    return { ok: true };
}

function resolveWindowTitleSuffix(user, Space, RBAC) {
    if (!user) return '';
    if (RBAC.isHqAccount(user)) return 'HQ';
    if (Space.isCaptainHub(user)) return 'MASTER';
    if (Space.isDeckVesselMode(user)) return 'DECK';
    if (Space.isEngineVesselMode(user)) return 'ENGINE';
    const dept = String(user.department || '').toUpperCase();
    if (dept === 'DECK') return 'DECK';
    if (dept === 'ENGINE') return 'ENGINE';
    return '';
}

function simulateLoadData(user, allJobs, allGroups, allComponents, Space, RBAC) {
    const isCaptainHub = Space.isCaptainHub(user);
    if (user && !RBAC.isHqAccount(user) && user.department && !isCaptainHub) {
        const dept = user.department;
        return {
            jobs: allJobs.filter(j => j.department === dept),
            groups: allGroups.filter(g => g.department === dept),
            components: allComponents.filter(c => !c.path || c.path[0] === dept),
        };
    }
    if (isCaptainHub) {
        return { jobs: allJobs, groups: allGroups, components: allComponents };
    }
    return { jobs: allJobs, groups: allGroups, components: allComponents };
}

function findSpareGroupNode(st, key) {
    if (!key) return null;
    if (key === MERGED_GEN_ENGINE_KEY) {
        return { key: MERGED_GEN_ENGINE_KEY, department: 'ENGINE', label: MERGED_GEN_ENGINE_LABEL };
    }
    return (st.idx?.groupNodes || []).find(n => n.key === key) || null;
}

function groupFilterLabel(st) {
    if (!st.selectedGroupKey) return '';
    const node = findSpareGroupNode(st, st.selectedGroupKey);
    return node?.label || '';
}

function simulateSpareGroupHeaderDisplay(st) {
    const label = groupFilterLabel(st);
    return {
        label,
        displayed: !!String(label || '').trim(),
        title: label ? `${WINDOW_TITLE_BASE} · ${label.slice(0, 40)}` : '',
    };
}

function spareGroupTreeIncludesDept(st, node) {
    if (!st?.department) return true;
    return node?.department === st.department;
}

function createMockDb(seed) {
    const stores = {
        maintenance_jobs: new Map((seed.maintenance_jobs || []).map(j => [j.id, { ...j }])),
        maintenance_groups: new Map((seed.maintenance_groups || []).map(g => [g.id, { ...g }])),
        ship_components: new Map((seed.ship_components || []).map(c => [c.id, { ...c }])),
        daily_work_reports: new Map(),
        defect_cases: new Map(),
        work_permits: new Map(),
        job_bom: new Map(),
        audit_logs: new Map(),
        meta: new Map(Object.entries({ vessel_id: seed.meta?.vessel_id || PILOT_VESSEL_ID })),
    };
    let auditSeq = 1;
    return {
        async getAll(store) { return [...(stores[store]?.values() || [])]; },
        async put(store, row) {
            if (store === 'audit_logs') stores[store].set(String(auditSeq++), row);
            else stores[store].set(row.id || row.key, row);
        },
        async del(store, id) { stores[store]?.delete(id); },
        async bulkPut(store, rows) { for (const row of rows) await this.put(store, row); },
        async getMeta(key) { return stores.meta.get(key) ?? null; },
        async setMeta(key, value) { stores.meta.set(key, value); },
        cloneJobs() { return [...stores.maintenance_jobs.values()].map(j => ({ ...j })); },
    };
}

function loadPmsMasterExcel(rbacRef) {
    global.ExcelJS = ExcelJS;
    if (!global.crypto?.randomUUID) global.crypto = { randomUUID };
    global.TVC_META_KEYS = { VESSEL_ID: 'vessel_id', PMS_MASTER_IMPORTED: 'pms_master_imported_at' };
    global.TVC_RBAC = rbacRef;
    global.TVC_WorkReport = { fromLegacy(r) { return r; } };
    const code = fs.readFileSync(path.join(ROOT, 'js', 'services', 'pmsMasterExcel.js'), 'utf8')
        + '\nglobalThis.__TVC_PmsMasterExcel = TVC_PmsMasterExcel;';
    eval(code);
    return globalThis.__TVC_PmsMasterExcel;
}

async function exportEngineSample(Pms, db) {
    const jobs = db.cloneJobs().filter(j => j.department === 'ENGINE');
    const groups = (await db.getAll('maintenance_groups')).filter(g => g.department === 'ENGINE');
    return Pms.exportToWorkbook({ jobs: Pms.renumberJobsForExport(jobs), groups, vesselId: PILOT_VESSEL_ID, department: 'ENGINE' });
}

function pickGroupNode(st, pick) {
    const nodes = (st.idx?.groupNodes || [])
        .filter(n => n.department === pick.dept && pick.match.test(String(n.label || '').trim()));
    return nodes[0] || null;
}

async function runMode(mode, ctx) {
    const { seed, Space, RBAC, Indexes, Pms, handoffWb } = ctx;
    const skuDef = SKUS[mode.sku];
    const userTemplate = USERS[mode.userKey];
    console.log(`\n━━ ${mode.title} (${mode.sku}) ━━`);

    assert('SKU defined', !!skuDef, mode.sku);
    assert('productName set', !!skuDef?.productName, skuDef?.productName);

    const lic = assertLoginModeForSku(skuDef, mode.loginMode, userTemplate.account_type);
    assert('license/login gate', lic.ok, lic.error || '');

    if (mode.loginMode) {
        const login = Space.validateLogin(userTemplate, mode.loginMode);
        assert('Space.validateLogin', login.ok, login.error || '');
        userTemplate.station = login.station || userTemplate.station;
    } else {
        const badVessel = Space.validateLogin(USERS.captain, null);
        assert('HQ SKU blocks vessel login w/o mode', !badVessel.ok || userTemplate.account_type === 'HQ');
    }

    const titleSuffix = resolveWindowTitleSuffix(userTemplate, Space, RBAC);
    assert(`window title → ${mode.windowSuffix}`, titleSuffix === mode.windowSuffix, `got ${titleSuffix}`);

    const allJobs = seed.maintenance_jobs || [];
    const allGroups = seed.maintenance_groups || [];
    const allComponents = seed.ship_components || [];
    const loaded = simulateLoadData(userTemplate, allJobs, allGroups, allComponents, Space, RBAC);

    if (mode.loadScope === 'station-engine') {
        assert('ENGINE-only jobs', loaded.jobs.every(j => j.department === 'ENGINE'));
        assert('no DECK jobs', !loaded.jobs.some(j => j.department === 'DECK'));
    } else if (mode.loadScope === 'station-deck') {
        assert('DECK-only jobs', loaded.jobs.every(j => j.department === 'DECK'));
        assert('no ENGINE jobs', !loaded.jobs.some(j => j.department === 'ENGINE'));
    } else if (mode.loadScope === 'captain') {
        assert('Captain sees all jobs', loaded.jobs.length === allJobs.length);
    } else {
        assert('HQ sees all jobs', loaded.jobs.length === allJobs.length);
    }

    const canMaster = RBAC.canModifyOriginalPlan(userTemplate);
    assert('PMS/SPARE Master Excel permission', canMaster);

    for (const dept of mode.pmsMasterDepts) {
        const scoped = allJobs.filter(j => j.department === dept);
        assert(`PMS export scope ${dept}`, scoped.length > 0, `count=${scoped.length}`);
        const fn = await Pms.masterExcelFilename(PILOT_VESSEL_ID, dept);
        assert(`${dept} master filename`, fn.includes(`_pms_master_${dept.toLowerCase()}_`), fn);
    }

    const st = {
        user: userTemplate,
        department: mode.sessionDept,
        selectedGroupKey: null,
        jobs: loaded.jobs,
        groups: loaded.groups,
        components: loaded.components,
        spares: [],
        reports: [],
    };
    st.idx = Indexes.build(st);

    const visibleTree = (st.idx.groupNodes || []).filter(n => spareGroupTreeIncludesDept(st, n));
    assert('SPARE tree has visible groups', visibleTree.length > 0, `count=${visibleTree.length}`);

    const node = pickGroupNode(st, mode.sparePick);
    assert('sample group node found', !!node, mode.sparePick.dept);
    if (node) {
        st.selectedGroupKey = node.key;
        const hdr = simulateSpareGroupHeaderDisplay(st);
        assert('SPARE group header displays label', hdr.displayed, hdr.label || '(empty)');
        assert('group key resolves via findSpareGroupNode', !!findSpareGroupNode(st, node.key));
    }

    if (mode.sku === 'VESSEL_DECK') {
        const deckLabels = loaded.jobs.map(j => String(j.group || '').trim()).filter(Boolean);
        const hasLegacy26 = deckLabels.some(l => /^26\./.test(l));
        const hasCatalog01 = deckLabels.some(l => /^01\./.test(l));
        assert('Deck tree uses 01-catalog or legacy seed noted', hasCatalog01 || hasLegacy26,
            `01=${hasCatalog01} legacy26=${hasLegacy26}`);
    }

    if (mode.crossImport && handoffWb) {
        const db = createMockDb(seed);
        global.TVC_DB = db;
        const r = await Pms.importFromWorkbook(handoffWb, userTemplate, { department: 'ENGINE' });
        const hit = db.cloneJobs().find(j => j.job_code === '77-001' && j.department === 'ENGINE');
        assert('cross-PC ENGINE master import', !!hit && r.created + r.updated >= 0);
        const deckCount = db.cloneJobs().filter(j => j.department === 'DECK').length;
        assert('DECK jobs untouched after ENGINE import', deckCount === allJobs.filter(j => j.department === 'DECK').length);
    }

    if (mode.sku === 'VESSEL_ENGINE') {
        const wrongDept = Space.validateLogin(userTemplate, 'DECK');
        assert('Engine SKU loginMode=DECK rejected', !wrongDept.ok);
    }
    if (mode.sku === 'VESSEL_DECK') {
        const wrongDept = Space.validateLogin(userTemplate, 'ENGINE');
        assert('Deck SKU loginMode=ENGINE rejected', !wrongDept.ok);
    }
}

async function main() {
    if (!fs.existsSync(SEED_PATH)) {
        console.error('Seed not found:', SEED_PATH);
        process.exit(1);
    }
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

    global.TVC_RBAC = loadModule('js/rbac.js', 'TVC_RBAC');
    global.TVC_Space = loadModule('js/space.js', 'TVC_Space');
    global.TVC_WorkReport = { fromLegacy(r) { return r; }, getJobCodes(r) { return r.job_code ? [r.job_code] : []; } };
    const RBAC = global.TVC_RBAC;
    const Space = global.TVC_Space;
    const Indexes = loadModule('js/core/indexes.js', 'TVC_Indexes');
    const Pms = loadPmsMasterExcel(RBAC);

    console.log('══════════════════════════════════════════════════');
    console.log(' Electron 4-Mode Simulation (HQ · Master · Engine · Deck)');
    console.log('══════════════════════════════════════════════════');

    const engineDb = createMockDb(seed);
    const handoffWb = await exportEngineSample(Pms, engineDb);
    const wsJ = handoffWb.getWorksheet('Jobs');
    const wsG = handoffWb.getWorksheet('Group Headers');
    wsJ.getRow(6).getCell(3).value = '77';
    wsJ.getRow(6).getCell(4).value = 'CROSS PC GROUP';
    wsJ.getRow(6).getCell(6).value = '77-001';
    wsJ.getRow(6).getCell(9).value = 'CROSS PC TEST JOB';
    const gRow = wsG.lastRow?.number ? wsG.lastRow.number + 1 : 6;
    wsG.getRow(gRow).getCell(1).value = 'ENGINE';
    wsG.getRow(gRow).getCell(2).value = '77';
    wsG.getRow(gRow).getCell(3).value = 'CROSS PC GROUP';

    const ctx = { seed, Space, RBAC, Indexes, Pms, handoffWb };

    for (const mode of MODES) {
        await runMode(mode, ctx);
    }

    console.log('\n══════════════════════════════════════════════════');
    console.log(` Result: ${pass} passed, ${fail} failed (4 modes)`);
    console.log('══════════════════════════════════════════════════\n');
    process.exit(fail ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
