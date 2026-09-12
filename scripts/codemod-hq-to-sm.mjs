#!/usr/bin/env node
/**
 * One-shot HQ → SM rename across browser JS (excludes vendor, node_modules).
 * Run: node scripts/codemod-hq-to-sm.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_ROOT = path.join(ROOT, 'js');

const REPLACEMENTS = [
    ['isHqAccount', 'isSmAccount'],
    ['isSuperHqAccount', 'isSuperSmAccount'],
    ['isCompanyHqAccount', 'isCompanySmAccount'],
    ['canApproveHqReport', 'canApproveSmReport'],
    ['isHqAuthoredRecord', 'isSmAuthoredRecord'],
    ['canHqDirectApprove', 'canSmDirectApprove'],
    ['hqActingRole', 'smActingRole'],
    ['isHqSku', 'isSmSku'],
    ['isReqListHqUser', 'isReqListSmUser'],
    ['isMasterHqReplyForwardPending', 'isMasterSmReplyForwardPending'],
    ['stampMasterHqReplyCaseForwarded', 'stampMasterSmReplyCaseForwarded'],
    ['showHqConfirmPanel', 'showSmConfirmPanel'],
    ['showExportHq', 'showExportSm'],
    ['showImportHq', 'showImportSm'],
    ['IMPORT_HQ_SYNC', 'IMPORT_SM_SYNC'],
    ['EXPORT_HQ_FEEDBACK', 'EXPORT_SM_FEEDBACK'],
    ['HQ_SUPERVISOR', 'SM_SUPERVISOR'],
    ['AccountType.HQ', 'AccountType.SM'],
    ["account_type === 'HQ'", "account_type === 'SM'"],
    ["user.account_type === 'HQ'", 'user.account_type === \'SM\''],
    ["record.account_type === AccountType.HQ", 'record.account_type === AccountType.SM'],
    ['HQ_TO_SHIP', 'SM_TO_SHIP'],
    ['SHIP_TO_HQ', 'SHIP_TO_SM'],
    ['DEFECT_URGENT_TO_HQ', 'DEFECT_URGENT_TO_SM'],
    ['DEFECT_REPLY_HQ_TO_SHIP', 'DEFECT_REPLY_SM_TO_SHIP'],
    ['POSTPONE_REPLY_HQ_TO_SHIP', 'POSTPONE_REPLY_SM_TO_SHIP'],
    ['WORK_PERMIT_REPLY_HQ_TO_SHIP', 'WORK_PERMIT_REPLY_SM_TO_SHIP'],
    ['VESSEL_PROFILE_HQ_TO_SHIP', 'VESSEL_PROFILE_SM_TO_SHIP'],
    ["state.space = 'HQ'", "state.space = 'SM'"],
    ["space === 'HQ'", "space === 'SM'"],
    ["setSpace('HQ'", "setSpace('SM'"],
    ['TVC_HqLiveSync', 'TVC_SmLiveSync'],
    ['startHqLiveSync', 'startSmLiveSync'],
    ['stopHqLiveSync', 'stopSmLiveSync'],
    ['hq_synced', 'sm_synced'],
    ['hq_sync_at', 'sm_sync_at'],
    ['HQ_OFFICE', 'SM_OFFICE'],
    ['Push to HQ', 'Push to SM'],
    ['Pull HQ', 'Pull SM'],
    ['HQ reply', 'SM reply'],
    ['HQ-authored', 'SM-authored'],
    ['HQ Superintendent', 'SM Superintendent'],
    ['to HQ', 'to SM'],
    ['from HQ', 'from SM'],
    ['with HQ', 'with SM'],
    [' HQ ', ' SM '],
    ['(HQ)', '(SM)'],
];

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p, out);
        else if (name.endsWith('.js')) out.push(p);
    }
    return out;
}

let files = 0;
let touched = 0;
for (const file of walk(JS_ROOT)) {
    if (file.includes('hqLiveSync.js')) continue;
    let text = fs.readFileSync(file, 'utf8');
    let next = text;
    for (const [from, to] of REPLACEMENTS) {
        next = next.split(from).join(to);
    }
    if (next !== text) {
        fs.writeFileSync(file, next);
        touched++;
    }
    files++;
}

// pms.js storage prefix HQ_ -> SM_
const pmsPath = path.join(JS_ROOT, 'pms.js');
let pms = fs.readFileSync(pmsPath, 'utf8');
pms = pms.replace(/`HQ_\$\{/g, '`SM_${');
pms = pms.replace(/space === 'SM' \? `HQ_/g, "space === 'SM' ? `SM_");
fs.writeFileSync(pmsPath, pms);

console.log(`Scanned ${files} files, updated ${touched}.`);
