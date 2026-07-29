#!/usr/bin/env node
/** Verify PMS group dept fix — name-aware DECK forcing + empty group prune */

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
const FORCE_ENGINE_GROUP_NOS = new Set([24, 25]);
const JOB_DEPT_OVERRIDES = {
    '26-001': 'DECK', '26-002': 'DECK', '26-003': 'ENGINE', '26-004': 'ENGINE',
};

function norm(s) { return String(s ?? '').replace(/\s+/g, ' ').trim(); }
function pmsGroupNoFromLabel(label) {
    const mm = String(label || '').trim().match(/^(\d+)\s*\./);
    return mm ? parseInt(mm[1], 10) : null;
}
function splitGroupLabel(label) {
    const s = norm(label);
    const m = s.match(/^(\d{1,2})\.\s*(.+)$/);
    if (m) return { no: m[1], name: norm(m[2]) };
    return { no: '', name: s };
}
function legacyGroupNum(label) {
    const m = norm(label).match(/^(\d{1,2})\./);
    return m ? parseInt(m[1], 10) : null;
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
function forceDeptForJob(job) {
    const code = String(job?.job_code || '').trim().toUpperCase();
    if (JOB_DEPT_OVERRIDES[code]) return JOB_DEPT_OVERRIDES[code];
    return forceDeptForGroupLabel(job?.group);
}
function pruneEmptyGroupDefs(allJobs, defs) {
    const used = new Set((allJobs || []).map(j => `${j.department}|${norm(j.group)}`));
    const kept = [];
    const pruned = [];
    for (const g of defs) {
        if (norm(g.item_sort1)) { kept.push(g); continue; }
        const key = `${g.department}|${norm(g.label)}`;
        if (used.has(key)) kept.push(g);
        else pruned.push(g);
    }
    return { kept, pruned };
}

let pass = 0;
let fail = 0;
function assert(name, cond) {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}`); fail++; }
}

console.log('1. isLegacyDeckGroupLabel');
assert('"28. SAEFETY INSPECTION" → false', !isLegacyDeckGroupLabel('28. SAEFETY INSPECTION'));
assert('"28. LSA/FFE" → true', isLegacyDeckGroupLabel('28. LSA/FFE'));
assert('"36. SAEFETY INSPECTION" → true', isLegacyDeckGroupLabel('36. SAEFETY INSPECTION'));

console.log('\n2. forceDeptForJob (loadData normalize)');
const j1 = { department: 'ENGINE', group: '28. SAEFETY INSPECTION', job_code: '28-001' };
assert('ENGINE + "28. SAEFETY INSPECTION" stays ENGINE', forceDeptForJob(j1) === null);

const j2 = { department: 'ENGINE', group: '28. LSA/FFE', job_code: '28-001' };
assert('ENGINE + "28. LSA/FFE" forces DECK', forceDeptForJob(j2) === 'DECK');

const j3 = { department: 'ENGINE', group: '24. MAIN ENGINE', job_code: '24-001' };
assert('ENGINE group 24 stays ENGINE force', forceDeptForJob(j3) === 'ENGINE');

console.log('\n3. pruneEmptyGroupDefs');
const jobs = [
    { department: 'ENGINE', group: '28. SAEFETY INSPECTION', job_code: '28-001' },
];
const defs = [
    { id: 'g1', department: 'ENGINE', label: '28. SAEFETY INSPECTION' },
    { id: 'g2', department: 'ENGINE', label: '36. SAEFETY INSPECTION' },
    { id: 'g3', department: 'DECK', label: '02. LSA/FFE', item_sort1: 'FIRE EXTINGUISHER' },
];
const { kept, pruned } = pruneEmptyGroupDefs(jobs, defs);
assert('ghost "36. SAEFETY INSPECTION" pruned', pruned.some(g => g.id === 'g2'));
assert('"28. SAEFETY INSPECTION" kept', kept.some(g => g.id === 'g1'));
assert('equipment def kept even if unused', kept.some(g => g.id === 'g3'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
