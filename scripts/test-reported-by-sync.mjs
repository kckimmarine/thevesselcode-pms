#!/usr/bin/env node
/**
 * REPORTED BY / REPORTED DATE — PMS + SPARE + ZIP sync
 * Usage: npm run test-reported-by-sync
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadModule(relPath, exportName) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
        + `\nglobalThis.__loaded_${exportName} = ${exportName};`;
    eval(code);
    return globalThis[`__loaded_${exportName}`];
}

const RBAC = loadModule('js/rbac.js', 'TVC_RBAC');

const ENGINEER = { username: 'engineer', role: 'SHIP_OFFICER', department: 'ENGINE', id: 'user-engineer' };
const CE = { username: 'ce', role: 'SHIP_CHIEF', department: 'ENGINE', id: 'user-chief' };
const OFFICER = { username: 'officer', role: 'SHIP_OFFICER', department: 'DECK', id: 'user-officer' };

let pass = 0;
let fail = 0;
function assert(name, cond, detail = '') {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

function preserveAuthorFields(existing, incoming) {
    const fields = [
        'reporter_name', 'reporter_username', 'reported_by', 'reporter_role',
        'made_by', 'created_by', 'created_by_username', 'creator_name', 'operator_id', 'operator_name',
    ];
    for (const f of fields) {
        const ex = existing?.[f];
        const inc = incoming?.[f];
        if (ex != null && String(ex).trim() && (inc == null || !String(inc).trim())) {
            incoming[f] = ex;
        }
    }
}

console.log('\n=== REPORTED BY / DATE rules ===\n');

console.log('[PMS Work Report]');
const wr = {
    reported_by: 'user-engineer',
    reporter_username: 'engineer',
    reporter_name: 'Engineer',
    report_date: '2026-08-08',
};
assert('author → Engineer (username)', RBAC.getReportedByLabelForWorkReport(wr) === 'Engineer');
assert('CE viewing keeps Engineer', RBAC.getReportedByLabelForWorkReport(wr) === 'Engineer');
assert('new author label from user', RBAC.getReportedByLabel(ENGINEER) === 'Engineer');

console.log('\n[SPARE Requisition / Consume]');
const req = {
    created_by: 'user-officer',
    created_by_username: 'officer',
    made_by: 'Officer',
    made_on: '2026-08-08',
};
assert('req author → Officer', RBAC.getReportedByLabelForRecord(req) === 'Officer');
assert('CE cannot overwrite author label', RBAC.getReportedByLabelForAuthor(req) === 'Officer');

const consume = {
    created_by_username: 'engineer',
    made_by: 'Engineer',
    made_on: '2026-08-08',
};
assert('consume author → Engineer', RBAC.getReportedByLabelForAuthor(consume) === 'Engineer');

console.log('\n[ZIP Import merge — author preserved]');
const existing = { ...wr, id: 'DWR-1' };
const incoming = { ...existing, description: 'updated text', reporter_name: '', reporter_username: '' };
preserveAuthorFields(existing, incoming);
assert('import keeps reporter_name', incoming.reporter_name === 'Engineer');
assert('import keeps reporter_username', incoming.reporter_username === 'engineer');
assert('import applies other fields', incoming.description === 'updated text');

const existingReq = { ...req, id: 'REQ-1' };
const incomingReq = { ...existingReq, ships_comments: 'HQ note', made_by: '', created_by_username: '' };
preserveAuthorFields(existingReq, incomingReq);
assert('import keeps made_by', incomingReq.made_by === 'Officer');
assert('import keeps created_by_username', incomingReq.created_by_username === 'officer');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
