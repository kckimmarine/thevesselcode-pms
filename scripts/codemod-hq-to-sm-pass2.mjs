#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const REPLACEMENTS = [
    ["? 'SM' : 'SHIP'", "? 'SM' : 'SHIP'"],
    ["scopeOf('SM'", "scopeOf('SM'"],
    ["space: 'SM'", "space: 'SM'"],
    ["return 'SM'", "return 'SM'"],
    ['normalizeShipDefectForSm', 'normalizeShipDefectForSm'],
    ['SM_FEEDBACK_IMPORT', 'SM_FEEDBACK_IMPORT'],
    ['SM_REQ_LIST_STATUS', 'SM_REQ_LIST_STATUS'],
    ['SM_REQ_LIST_PHASE', 'SM_REQ_LIST_PHASE'],
    ['REQ_SM_FLOW_STAGES', 'REQ_SM_FLOW_STAGES'],
    ['normalizeSmFlowStage', 'normalizeSmFlowStage'],
    ['reqSmListWorkflowStatus', 'reqSmListWorkflowStatus'],
    ['SM_IMPORT_TYPES', 'SM_IMPORT_TYPES'],
    ['reqWorkSm', 'reqWorkSm'],
    ['SM_REVIEW', 'SM_REVIEW'],
    ["type: 'SM_IMPORT'", "type: 'SM_IMPORT'"],
    ["ref: 'SM'", "ref: 'SM'"],
    ['SM Assessment', 'SM Assessment'],
    ["account_type: 'SM'", "account_type: 'SM'"],
    ["dept === 'SM'", "dept === 'SM'"],
    ["=== 'SM' ||", "=== 'SM' ||"],
    ["|| d === 'SM'", "|| d === 'SM'"],
    ["r.space !== 'SM'", "r.space !== 'SM'"],
    ["space !== 'SM'", "space !== 'SM'"],
    ['setText(\'cmaxsShipCode\', \'HQ\')', "setText('cmaxsShipCode', 'SM')"],
    ['Approved by Superintendent.', 'Approved by Superintendent.'],
    ['approved by Superintendent.', 'approved by Superintendent.'],
    ['SM Import JSON', 'SM Import JSON'],
    ['SM Import Diff', 'SM Import Diff'],
    ['[SM_QUOTE]', '[SM_QUOTE]'],
    ['isInSmMode', 'isInSmMode'],
    ['SM_MODE_SESSION_ROOT', 'SM_MODE_SESSION_ROOT'],
];

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory() && name !== 'node_modules') walk(p, out);
        else if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.html')) out.push(p);
    }
    return out;
}

const skip = new Set([
    path.join(ROOT, 'js/services/hqLiveSync.js'),
    path.join(ROOT, 'js/core/legacySm.js'),
]);

let touched = 0;
for (const file of walk(ROOT)) {
    if (!file.includes('/js/') && !file.includes('/scripts/') && !file.includes('/api/') && !file.includes('/src/')
        && !file.endsWith('index.html')) continue;
    if (skip.has(file)) continue;
    let text = fs.readFileSync(file, 'utf8');
    let next = text;
    for (const [from, to] of REPLACEMENTS) next = next.split(from).join(to);
    if (next !== text) {
        fs.writeFileSync(file, next);
        touched++;
    }
}

console.log(`Pass2 updated ${touched} files.`);
