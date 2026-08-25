#!/usr/bin/env node
/**
 * SPARE Data Export/Import chain simulation:
 *   Engine/Deck station → Master (Captain Hub) → HQ → Vendor quotation round-trip
 *
 * Run: node scripts/sim-spare-xfer-chain.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VESSEL = 'INCHEON CHEMI';

function loadModule(relPath, exportName) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
        + `\nglobalThis.__loaded_${exportName} = ${exportName};`;
    eval(code);
    const mod = globalThis[`__loaded_${exportName}`];
    globalThis[exportName] = mod;
    return mod;
}

function loadSchemaBundle() {
    const code = fs.readFileSync(path.join(ROOT, 'js/core/schema.js'), 'utf8')
        + `\nglobalThis.__schema = { TVC_SCHEMA, TVC_META_KEYS, TVC_SpareSchema, TVC_WorkReport, TVC_DefectCase, TVC_WorkPermit };`;
    eval(code);
    for (const [k, v] of Object.entries(globalThis.__schema)) globalThis[k] = v;
}

function createDb(label) {
    const stores = {
        requisitions: [],
        spare_parts: [],
        sync_history: [],
    };
    const meta = { vessel_id: VESSEL };
    let lastSave = null;

    const db = {
        label,
        stores,
        meta,
        get lastSave() { return lastSave; },
        setLastSave(v) { lastSave = v; },
        async getMeta(k) { return meta[k] ?? null; },
        async setMeta(k, v) { meta[k] = v; },
        async getAll(name) { return [...(stores[name] || [])]; },
        async get(name, id) {
            return (stores[name] || []).find(r => r.id === id) || null;
        },
        async put(name, row) {
            const arr = stores[name] || (stores[name] = []);
            const i = arr.findIndex(r => r.id === row.id);
            if (i >= 0) arr[i] = JSON.parse(JSON.stringify(row));
            else arr.push(JSON.parse(JSON.stringify(row)));
        },
        async del(name, id) {
            const arr = stores[name];
            if (!arr) return;
            const i = arr.findIndex(r => r.id === id);
            if (i >= 0) arr.splice(i, 1);
        },
    };
    return db;
}

function installGlobals(db) {
    global.TVC_DB = db;
    global.TVC_FileExport = {
        async save(blob, filename) {
            const u8 = blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer());
            db.setLastSave({ buf: Buffer.from(u8), filename });
        },
    };
    global.window = global;
}

function makeConfirmedReq(dept, suffix) {
    const id = `req-${dept.toLowerCase()}-${suffix}`;
    return {
        id,
        req_no: `REQ-INCHEON-20260825-${suffix}`,
        vessel_id: VESSEL,
        department: dept,
        status: 'DRAFT',
        list_status: 'CONFIRMED',
        confirmed_at: '2026-08-25T10:00:00.000Z',
        confirmed_by: dept === 'ENGINE' ? 'Chief Engineer' : 'Chief Officer',
        lines: [{
            spare_part_id: `sp-${dept.toLowerCase()}-1`,
            part_no: `${dept === 'ENGINE' ? 'ENG' : 'DEK'}-P001`,
            qty_requested: 2,
            qty_approved: null,
            price: null,
            currency: 'USD',
            vendor_comment: '',
            hq_comment: '',
        }],
    };
}

function zipFromLastSave(db) {
    const save = db.lastSave;
    if (!save?.buf) throw new Error(`${db.label}: no ZIP saved`);
    const buf = Buffer.from(save.buf);
    buf.name = save.filename;
    return buf;
}

async function applyRequisitionExportStatus(req) {
    const RS = TVC_Inventory.REQ_STATUS;
    const listSt = req.list_status;
    if (listSt !== 'DRAFT') {
        await TVC_Inventory.setStatus(req.id, RS.SUBMITTED);
    } else if (req.status === RS.DRAFT) {
        await TVC_Inventory.setStatus(req.id, RS.EXPORTED);
    }
}

function setupHqQuote(req) {
    const lineId = req.lines[0].spare_part_id;
    req.hq_quote = {
        vendors: [
            { slot: 0, vendorId: '', vendorName: 'Acme Marine', currency: 'USD' },
            { slot: 1, vendorId: '', vendorName: '', currency: 'USD' },
        ],
        rowChecks: { [`0:${lineId}`]: true },
        prices: {},
        vendorMeta: {},
    };
    return req;
}

function assertScope(filename, expectedScope, name) {
    const parsed = TVC_Filename.parseScoped(filename);
    if (!parsed) throw new Error(`${name}: could not parse filename ${filename}`);
    if (parsed.scope !== expectedScope) {
        throw new Error(`${name}: expected scope ${expectedScope}, got ${parsed.scope} (${filename})`);
    }
}

let pass = 0;
let fail = 0;
function ok(name) { console.log(`  ✓ ${name}`); pass++; }
function bad(name, detail) { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
function check(name, cond, detail = '') {
    if (cond) ok(name);
    else bad(name, detail);
}

async function exportReqZip(user, reqs, opts = {}) {
    const { isHq = false, category = 'REQUISITION' } = opts;
    return TVC_SpareSync.exportRequisitionsZip(user, reqs, { category, isHq, vendorOnly: !isHq });
}

async function importReqZip(user, file, opts = {}) {
    return TVC_SpareSync.importZip(user, file, opts);
}

async function runDeptChain(dept) {
    const tag = dept === 'ENGINE' ? 'Engine' : 'Deck';
    const scope = dept === 'ENGINE' ? 'engine' : 'deck';
    const hqScope = `${scope}_hq`;
    console.log(`\n=== ${tag} → Master → HQ → Vendor quotation ===`);

    const stationUser = {
        username: dept === 'ENGINE' ? 'ce' : 'co',
        role: dept === 'ENGINE' ? 'SHIP_CHIEF' : 'SHIP_CAPTAIN',
        department: dept,
        station: dept === 'ENGINE' ? 'ECR' : 'CCR',
        account_type: 'SHIP',
        vessel_id: VESSEL,
    };
    const masterUser = {
        username: 'captain',
        role: 'SHIP_CAPTAIN',
        department: null,
        station: 'CAPTAIN',
        account_type: 'SHIP',
        vessel_id: VESSEL,
    };
    const hqUser = {
        username: 'hq',
        role: 'HQ_SUPERVISOR',
        department: dept,
        account_type: 'HQ',
        vessel_id: VESSEL,
    };

    const stationDb = createDb(`${tag} station`);
    installGlobals(stationDb);
    const req0 = makeConfirmedReq(dept, dept === 'ENGINE' ? '001' : '002');
    await TVC_Inventory.saveRequisition(req0);

    // 1) Station → Master export
    let r;
    try {
        r = await exportReqZip(stationUser, [await TVC_Inventory.getRequisition(req0.id)]);
        assertScope(r.filename, scope, `${tag} station export`);
        await applyRequisitionExportStatus(await TVC_Inventory.getRequisition(req0.id));
        check(`${tag} station export filename scope=${scope}`, r.filename.includes(`_${scope}_`));
        const afterExport = await TVC_Inventory.getRequisition(req0.id);
        check(`${tag} station status → SUBMITTED after export`, afterExport.status === TVC_Inventory.REQ_STATUS.SUBMITTED);
    } catch (e) {
        bad(`${tag} station export`, e.message);
        return;
    }

    const stationZip = zipFromLastSave(stationDb);

    // 2) Master import
    const masterDb = createDb(`${tag} master`);
    installGlobals(masterDb);
    try {
        const imp = await importReqZip(masterUser, stationZip, { expectedCategory: 'REQUISITION' });
        check(`${tag} master import count`, imp.updated === 1);
        const imported = await TVC_Inventory.getRequisition(req0.id);
        check(`${tag} master has requisition`, !!imported);
        check(`${tag} master req department preserved`, imported?.department === dept);
        check(`${tag} master req still CONFIRMED list`, imported?.list_status === 'CONFIRMED');
    } catch (e) {
        bad(`${tag} master import`, e.message);
        return;
    }

    // 3) Master → HQ export (relay)
    try {
        const masterReq = await TVC_Inventory.getRequisition(req0.id);
        r = await exportReqZip(masterUser, [masterReq]);
        assertScope(r.filename, scope, `${tag} master relay export`);
        check(`${tag} master relay scope=${scope}`, r.filename.includes(`_${scope}_`));
    } catch (e) {
        bad(`${tag} master relay export`, e.message);
        return;
    }
    const masterZip = zipFromLastSave(masterDb);

    // 4) HQ import requisition
    const hqDb = createDb(`${tag} HQ`);
    installGlobals(hqDb);
    try {
        const imp = await importReqZip(hqUser, masterZip, { expectedCategory: 'REQUISITION' });
        check(`${tag} HQ requisition import`, imp.updated === 1);
        check(`${tag} HQ category REQUISITION`, imp.category === 'REQUISITION');
    } catch (e) {
        bad(`${tag} HQ requisition import`, e.message);
        return;
    }

    // 5) HQ export quotation to vendor
    let hqReq = await TVC_Inventory.getRequisition(req0.id);
    setupHqQuote(hqReq);
    await TVC_Inventory.saveRequisition(hqReq);
    try {
        const targets = [{
            slot: 0,
            vendorName: 'Acme Marine',
            currency: 'USD',
            lines: hqReq.lines.map(l => ({ ...l })),
        }];
        r = await TVC_SpareSync.exportQuotationZip(hqUser, hqReq, targets, { isHq: true });
        assertScope(r.filename, hqScope, `${tag} HQ quotation export`);
        check(`${tag} HQ quotation scope=${hqScope}`, r.filename.includes(`_${hqScope}_`));
        check(`${tag} HQ quotation payload category`, r.payload.export_meta.category === 'QUOTATION');
    } catch (e) {
        bad(`${tag} HQ quotation export`, e.message);
        return;
    }
    const quoteZip = zipFromLastSave(hqDb);

    // 6) HQ import vendor quote (simulated vendor return)
    try {
        const vendorReq = JSON.parse(JSON.stringify(hqReq));
        vendorReq.lines = vendorReq.lines.map(l => ({
            ...l,
            price: 125.5,
            currency: 'USD',
            vendor_comment: 'In stock — 2 weeks lead',
        }));
        const zip = await JSZip.loadAsync(quoteZip);
        const payload = JSON.parse(await zip.file('tvc_spare_sync.json').async('string'));
        payload.requisitions = [vendorReq];
        const vendorReturnBuf = await new JSZip()
            .file('tvc_spare_sync.json', JSON.stringify(payload, null, 2))
            .file('README.txt', 'Vendor quote return')
            .generateAsync({ type: 'nodebuffer' });
        vendorReturnBuf.name = quoteZip.name;
        const vendorFile = vendorReturnBuf;
        const imp = await importReqZip(hqUser, vendorFile, {
            expectedCategory: 'QUOTATION',
            importMode: 'vendor-quote',
        });
        check(`${tag} HQ vendor-quote import`, imp.updated === 1);
        hqReq = await TVC_Inventory.getRequisition(req0.id);
        check(`${tag} HQ status → QUOTED`, hqReq.status === TVC_Inventory.REQ_STATUS.QUOTED);
        check(`${tag} HQ line price applied`, hqReq.lines[0].price === 125.5);
        check(`${tag} HQ vendor comment`, hqReq.lines[0].vendor_comment.includes('In stock'));
    } catch (e) {
        bad(`${tag} HQ vendor-quote import`, e.message);
    }
}

async function runNegativeTests() {
    console.log('\n=== Negative / isolation checks ===');

    const engineReq = makeConfirmedReq('ENGINE', 'iso-e');
    const deckReq = makeConfirmedReq('DECK', 'iso-d');

    // Category mismatch
    const engDb = createDb('neg engine');
    installGlobals(engDb);
    await TVC_Inventory.saveRequisition(engineReq);
    const { filename } = await exportReqZip(
        { username: 'ce', department: 'ENGINE', account_type: 'SHIP', vessel_id: VESSEL },
        [engineReq],
    );
    const reqZip = zipFromLastSave(engDb);
    try {
        await importReqZip(
            { username: 'hq', department: 'ENGINE', account_type: 'HQ', vessel_id: VESSEL },
            reqZip,
            { expectedCategory: 'QUOTATION' },
        );
        bad('Category mismatch should reject REQUISITION as QUOTATION');
    } catch (e) {
        check('Category mismatch rejects wrong import type', /Category mismatch/i.test(e.message), e.message);
    }

    // Cross-dept: deck ZIP imported at HQ ENGINE — no hard block in spareSync, but data preserved
    const deckDb = createDb('neg deck');
    installGlobals(deckDb);
    await TVC_Inventory.saveRequisition(deckReq);
    await exportReqZip(
        { username: 'co', department: 'DECK', account_type: 'SHIP', vessel_id: VESSEL },
        [deckReq],
    );
    const deckZip = zipFromLastSave(deckDb);
    const hqEngDb = createDb('neg hq engine');
    installGlobals(hqEngDb);
    try {
        const imp = await importReqZip(
            { username: 'hq', department: 'ENGINE', account_type: 'HQ', vessel_id: VESSEL },
            deckZip,
            { expectedCategory: 'REQUISITION' },
        );
        const got = await TVC_Inventory.getRequisition(deckReq.id);
        check('Cross-dept import succeeds (no ZIP dept gate)', imp.updated === 1);
        check('Cross-dept req keeps DECK department', got?.department === 'DECK');
        console.log('  ℹ Cross-dept: spareSync has no department filter — HQ operator must pick correct import');
    } catch (e) {
        bad('Cross-dept import', e.message);
    }

    // Vendor quote without existing req
    const orphanDb = createDb('neg orphan quote');
    installGlobals(orphanDb);
    setupHqQuote(engineReq);
    const targets = [{ slot: 0, vendorName: 'X', currency: 'USD', lines: engineReq.lines }];
    await TVC_SpareSync.exportQuotationZip(
        { username: 'hq', department: 'ENGINE', account_type: 'HQ', vessel_id: VESSEL },
        engineReq,
        targets,
        { isHq: true },
    );
    const quoteZip = zipFromLastSave(orphanDb);
    try {
        await importReqZip(
            { username: 'hq', department: 'ENGINE', account_type: 'HQ', vessel_id: VESSEL },
            quoteZip,
            { expectedCategory: 'QUOTATION', importMode: 'vendor-quote' },
        );
        bad('Vendor quote import without existing req should fail');
    } catch (e) {
        check('Vendor quote requires existing requisition', /REQ_NOT_FOUND/i.test(e.message), e.message);
    }
}

// ── Bootstrap ────────────────────────────────────────────────────────
global.JSZip = JSZip;
global.TVC_License = { assertExportImport: () => ({ ok: true }) };
global.TVC_Sync = { licensedCompanyId: () => 'DAEMYUNG' };
global.localStorage = (() => {
    const s = {};
    return {
        getItem(k) { return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; },
        setItem(k, v) { s[k] = String(v); },
        removeItem(k) { delete s[k]; },
    };
})();

loadModule('js/rbac.js', 'TVC_RBAC');
loadSchemaBundle();
loadModule('js/core/filename.js', 'TVC_Filename');
loadModule('js/services/inventory.js', 'TVC_Inventory');
loadModule('js/services/spareSync.js', 'TVC_SpareSync');

console.log('SPARE xfer chain simulation');
console.log(`Vessel: ${VESSEL}`);

await runDeptChain('ENGINE');
await runDeptChain('DECK');
await runNegativeTests();

console.log(`\n── Result: ${pass} passed, ${fail} failed ──`);
process.exit(fail > 0 ? 1 : 0);
