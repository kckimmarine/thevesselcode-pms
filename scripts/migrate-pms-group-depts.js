#!/usr/bin/env node
/** PMS group department rules — 24·25 → ENGINE, 28·29·30·33·35 → DECK, 26 split by job code */
const fs = require('fs');
const path = require('path');

const SEED = path.join(__dirname, '..', 'data', 'pms-unified.json');
const FORCE_ENGINE_GROUP_NOS = new Set([24, 25]);
const FORCE_DECK_GROUP_NOS = new Set([28, 29, 30, 33, 35]);
const JOB_DEPT_OVERRIDES = {
    '26-001': 'DECK',
    '26-002': 'DECK',
    '26-003': 'ENGINE',
    '26-004': 'ENGINE',
};

function pmsGroupNoFromLabel(label) {
    const mm = String(label || '').trim().match(/^(\d+)\s*\./);
    return mm ? parseInt(mm[1], 10) : null;
}

function forceDeptForGroupNo(n) {
    if (FORCE_ENGINE_GROUP_NOS.has(n)) return 'ENGINE';
    if (FORCE_DECK_GROUP_NOS.has(n)) return 'DECK';
    return null;
}

function forceDeptForJob(job) {
    const code = String(job?.job_code || '').trim().toUpperCase();
    if (JOB_DEPT_OVERRIDES[code]) return JOB_DEPT_OVERRIDES[code];
    const n = pmsGroupNoFromLabel(job?.group);
    return n != null ? forceDeptForGroupNo(n) : null;
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
    const n = pmsGroupNoFromLabel(grpLabel);
    return n != null ? forceDeptForGroupNo(n) : null;
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
    const target = n != null ? forceDeptForGroupNo(n) : null;
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
