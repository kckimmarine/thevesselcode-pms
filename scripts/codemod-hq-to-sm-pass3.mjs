#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const REPLACEMENTS = [
    ['isHqReplyExported', 'isSmReplyExported'],
    ['isHqReplyStationForwardPending', 'isSmReplyStationForwardPending'],
    ['isHqReplyForwardPending', 'isSmReplyForwardPending'],
    ['pushShipToHq', 'pushShipToSm'],
    ['pullHqFeedback', 'pullSmFeedback'],
    ['pushHqFeedback', 'pushSmFeedback'],
    ['importHqFeedbackPackage', 'importSmFeedbackPackage'],
    ["direction === 'HQ_PULL'", "direction === 'SM_PULL' || direction === 'HQ_PULL'"],
    ["direction === 'HQ_PUSH'", "direction === 'SM_PUSH' || direction === 'HQ_PUSH'"],
    ["dir: 'HQ_PULL'", "dir: 'SM_PULL'"],
    ["dir: 'HQ_PUSH'", "dir: 'SM_PUSH'"],
    ['HQ_PULL:', 'SM_PULL:'],
    ['HQ_PUSH:', 'SM_PUSH:'],
    ['histHqReportApproval', 'histSmReportApproval'],
    ['histBtnHqApprove', 'histBtnSmApprove'],
    ['hqLeftCol', 'smLeftCol'],
    ['hq-left-col', 'sm-left-col'],
    ['canHqApprove', 'canSmApprove'],
    ['hqAuthored', 'smAuthored'],
    ["unlocked_by: 'HQ_IMPORT'", "unlocked_by: 'SM_IMPORT'"],
    ['HQ_ALLOWED_VESSEL_IDS', 'SM_ALLOWED_VESSEL_IDS'],
    ['HQ_SKU_OPTS', 'SM_SKU_OPTS'],
    ["ref: 'HQ_IMPORT'", "ref: 'SM_IMPORT'"],
    ["source_type: 'hq_import'", "source_type: 'sm_import'"],
    ['isHqUserEarly', 'isSmUserEarly'],
];

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory() && !['node_modules', '.git'].includes(name)) walk(p, out);
        else if (/\.(js|html|css|mjs)$/.test(name)) out.push(p);
    }
    return out;
}

const skip = new Set([path.join(ROOT, 'js/services/hqLiveSync.js')]);
let touched = 0;
for (const file of walk(ROOT)) {
    if (!file.includes('/js/') && !file.includes('/css/') && !file.endsWith('index.html')) continue;
    if (skip.has(file)) continue;
    let text = fs.readFileSync(file, 'utf8');
    let next = text;
    for (const [from, to] of REPLACEMENTS) next = next.split(from).join(to);
    if (next !== text) {
        fs.writeFileSync(file, next);
        touched++;
    }
}
console.log(`Pass3 updated ${touched} files.`);
