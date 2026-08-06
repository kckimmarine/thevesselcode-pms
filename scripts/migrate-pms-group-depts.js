#!/usr/bin/env node
/** PMS group department rules — legacy 24·25 → ENGINE; legacy DECK catalog name+no → DECK; 26 split by job code */
const fs = require('fs');
const path = require('path');

const SEED = path.join(__dirname, '..', 'data', 'pms-unified.json');
const FORCE_ENGINE_GROUP_NOS = new Set([24, 25]);
const JOB_DEPT_OVERRIDES = {
    '26-001': 'DECK',
    '26-002': 'DECK',
    '26-003': 'ENGINE',
    '26-004': 'ENGINE',
};

const DECK_LEGACY_CATALOG = [
    { legacy: 26, no: '01', name: 'CARGO TANK MONITORING SYSTEM' },
    { legacy: 28, no: '02', name: 'LSA/FFE' },
    { legacy: 29, no: '03', name: 'MOORING WINCH & WINDLASS' },
    { legacy: 30, no: '04', name: 'HOSE HANDLING CRANE' },
    { legacy: 31, no: '05', name: 'ODME & RELATED SYSTEM' },
    { legacy: 32, no: '06', name: 'NAVIGATION & COMMUNICATION' },
    { legacy: 33, no: '07', name: 'CARGO EQUIPMENTS' },
    { legacy: 34, no: '08', name: 'PRESSURE TEST & HULL PARTS' },
    { legacy: 35, no: '09', name: 'BWTS' },
    { legacy: 36, no: '10', name: 'SAEFETY INSPECTION' },
];
const DECK_LEGACY_MAP = new Map(DECK_LEGACY_CATALOG.map(c => [c.legacy, c]));

function norm(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function pmsGroupNoFromLabel(label) {
    const mm = String(label || '').trim().match(/^(\d+)\s*\./);
    return mm ? parseInt(mm[1], 10) : null;
}

function isLegacyDeckGroupLabel(groupLabel) {
    const m = norm(groupLabel).match(/^(\d{1,2})\.\s*(.+)$/);
    if (!m) return false;
    const leg = parseInt(m[1], 10);
    const hit = DECK_LEGACY_MAP.get(leg);
    if (!hit) return false;
    return norm(m[2]).toUpperCase() === norm(hit.name).toUpperCase();
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
    const fromSplit26 = forceDeptForGroup26Job(job);
    if (fromSplit26) return fromSplit26;
    const code = String(job?.job_code || '').trim().toUpperCase();
    if (JOB_DEPT_OVERRIDES[code]) return JOB_DEPT_OVERRIDES[code];
    return forceDeptForGroupLabel(job?.group);
}

function forceDeptForGroup26Component(c) {
    const grpLabel = Array.isArray(c.path) ? c.path[1] : null;
    if (pmsGroupNoFromLabel(grpLabel) !== 26) return null;
    const pathStr = (c.path || []).join('\0').toUpperCase();
    if (pathStr.includes('CARGO TANK MONITORING SYSTEM')) return 'DECK';
    if (pathStr.includes('F.O TANK MONITORING SYSTEM')) return 'ENGINE';
    return null;
}

function forceDeptForComponent(c) {
    const fromSplit26 = forceDeptForGroup26Component(c);
    if (fromSplit26) return fromSplit26;
    const grpLabel = Array.isArray(c.path) ? c.path[1] : null;
    return forceDeptForGroupLabel(grpLabel);
}

const raw = fs.readFileSync(SEED, 'utf8');
const data = JSON.parse(raw);
let jobN = 0;
let compN = 0;
let groupN = 0;

(data.maintenance_jobs || []).forEach(j => {
    const target = forceDeptForJob(j);
    if (!target || j.department === target) return;
    j.department = target;
    jobN++;
});

(data.ship_components || []).forEach(c => {
    const target = forceDeptForComponent(c);
    if (!target) return;
    if (Array.isArray(c.path) && c.path[0] !== target) {
        c.path = [target, ...c.path.slice(1)];
        compN++;
    }
    if (c.department && c.department !== target) {
        c.department = target;
        compN++;
    }
});

(data.maintenance_groups || []).forEach(g => {
    const n = pmsGroupNoFromLabel(g.label);
    if (n === 26) return;
    const target = forceDeptForGroupLabel(g.label);
    if (!target || g.department === target) return;
    g.department = target;
    groupN++;
});

const engineCount = (data.maintenance_jobs || []).filter(j => j.department === 'ENGINE').length;
const deckCount = (data.maintenance_jobs || []).filter(j => j.department === 'DECK').length;
if (data.meta) {
    data.meta.engine_count = engineCount;
    data.meta.deck_count = deckCount;
}

fs.writeFileSync(SEED, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`Updated seed: jobs=${jobN}, components=${compN}, groups=${groupN}`);
console.log(`Counts: ENGINE=${engineCount}, DECK=${deckCount}`);
const g26 = (data.maintenance_jobs || []).filter(j => /^26-/.test(j.job_code || ''));
g26.forEach(j => console.log(`  ${j.job_code} → ${j.department}`));
