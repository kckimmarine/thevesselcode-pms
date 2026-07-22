#!/usr/bin/env node
/** One-off: assign PMS groups 24,25,26,28,29,30,33,35 to DECK in pms-unified.json */
const fs = require('fs');
const path = require('path');

const SEED = path.join(__dirname, '..', 'data', 'pms-unified.json');
const FORCE_DECK_GROUP_NOS = new Set([24, 25, 26, 28, 29, 30, 33, 35]);

function pmsGroupNoFromLabel(label) {
    const mm = String(label || '').trim().match(/^(\d+)\s*\./);
    return mm ? parseInt(mm[1], 10) : null;
}

const raw = fs.readFileSync(SEED, 'utf8');
const data = JSON.parse(raw);
let jobN = 0;
let compN = 0;
let groupN = 0;

(data.maintenance_jobs || []).forEach(j => {
    const n = pmsGroupNoFromLabel(j.group);
    if (n == null || !FORCE_DECK_GROUP_NOS.has(n)) return;
    if (j.department !== 'DECK') { j.department = 'DECK'; jobN++; }
});

(data.ship_components || []).forEach(c => {
    const grpLabel = Array.isArray(c.path) ? c.path[1] : null;
    const n = pmsGroupNoFromLabel(grpLabel);
    if (n == null || !FORCE_DECK_GROUP_NOS.has(n)) return;
    if (Array.isArray(c.path) && c.path[0] !== 'DECK') {
        c.path = ['DECK', ...c.path.slice(1)];
        compN++;
    }
    if (c.department && c.department !== 'DECK') { c.department = 'DECK'; compN++; }
});

(data.maintenance_groups || []).forEach(g => {
    const n = pmsGroupNoFromLabel(g.label);
    if (n == null || !FORCE_DECK_GROUP_NOS.has(n)) return;
    if (g.department !== 'DECK') { g.department = 'DECK'; groupN++; }
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
