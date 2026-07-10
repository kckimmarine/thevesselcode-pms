/* Node smoke test for TVC_Inventory (in-memory DB stub). Run: node scripts/test-inventory.cjs */
const fs = require('fs');
const path = require('path');

// ── stubs ──────────────────────────────────────────────────────────
const stores = {
    spare_parts: new Map(),
    job_bom: new Map(),
    requisitions: new Map(),
    meta: new Map(),
};
function keyFieldOf(store) { return store === 'universal_catalog' ? 'universal_code' : (store === 'meta' ? 'key' : 'id'); }
global.window = {};
global.TVC_META_KEYS = { VESSEL_ID: 'vessel_id' };
global.TVC_RBAC = { Action: { CREATE_REQUISITION: 'CREATE_REQUISITION', MODIFY_INVENTORY: 'MODIFY_INVENTORY' }, assert: () => {} };
global.TVC_DB = {
    async getAll(s) { return [...(stores[s]?.values() || [])]; },
    async get(s, k) { return stores[s]?.get(k); },
    async put(s, v) { stores[s] = stores[s] || new Map(); stores[s].set(v[keyFieldOf(s)], v); return v[keyFieldOf(s)]; },
    async del(s, k) { stores[s]?.delete(k); return true; },
    async bulkPut(s, arr) { arr.forEach(v => stores[s].set(v[keyFieldOf(s)], v)); return arr.length; },
    async getMeta(k) { return stores.meta.get(k)?.value; },
    async setMeta(k, v) { stores.meta.set(k, { key: k, value: v }); },
    async indexGetAll(s, idx, q) {
        const field = idx === 'by_job_code' ? 'job_code' : idx === 'by_spare' ? 'spare_part_id' : null;
        return [...stores[s].values()].filter(r => field ? r[field] === q : true);
    },
};

// load inventory.js
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'services', 'inventory.js'), 'utf8');
eval(src.replace('const TVC_Inventory', 'global.TVC_Inventory'));
const INV = global.TVC_Inventory;

// ── fixtures ───────────────────────────────────────────────────────
const spares = [
    { id: 's1', part_no: 'ME-EX-001', name: 'Exhaust Valve Spindle', qty_on_hand: 2, min_qty: 2, standard_stock: 4, unit: 'EA', universal_code: 'UNI-AAA' },
    { id: 's2', part_no: 'ME-FI-002', name: 'Fuel Injector', qty_on_hand: 10, min_qty: 2, standard_stock: 5, unit: 'EA', universal_code: 'UNI-BBB' },
    { id: 's3', part_no: 'GE-PR-003', name: 'Piston Ring', qty_on_hand: 0, min_qty: 3, standard_stock: 3, unit: 'SET', universal_code: 'UNI-CCC' },
];
spares.forEach(s => stores.spare_parts.set(s.id, s));
stores.job_bom.set('b1', { id: 'b1', job_code: '01-004', spare_part_id: 's1', qty_per_job: 2 });
stores.job_bom.set('b2', { id: 'b2', job_code: '01-004', spare_part_id: 's3', qty_per_job: 1 });

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } };

(async () => {
    console.log('\n[1] Low-stock & standard-stock logic');
    ok('s1 low (2<=4)', INV.isLowStock(spares[0]) === true);
    ok('s2 not low (10>5)', INV.isLowStock(spares[1]) === false);
    ok('s3 low (0<=3)', INV.isLowStock(spares[2]) === true);
    ok('s1 recommend = 2', INV.recommendedOrderQty(spares[0]) === 2);
    ok('lowStockItems = 2', INV.lowStockItems(spares).length === 2);

    console.log('\n[2] BOM → used_parts');
    const bom = await INV.getBom('01-004');
    ok('BOM has 2 lines', bom.length === 2);
    const up = await INV.bomToUsedParts('01-004');
    ok('usedParts qty (s1=2)', up.find(u => u.spare_part_id === 's1').qty_used === 2);

    console.log('\n[3] Requisition create (auto low-stock)');
    const req = await INV.createRequisition({ id: 'u1', display_name: 'Chief', department: 'ENGINE' }, { vesselId: 'TEST_V01' });
    ok('req_no formatted', /^REQ-DMCHEMIC-\d{8}-001$/.test(req.req_no));
    ok('req has 2 low lines', req.lines.length === 2);
    ok('vessel tagged', req.vessel_id === 'TEST_V01');
    ok('status DRAFT', req.status === 'DRAFT');

    console.log('\n[4] Vendor quote apply');
    const q = await INV.applyVendorQuote(req.id, [
        { part_no: 'ME-EX-001', price: 1200, currency: 'USD', vendor_comment: '2wk lead' },
        { part_no: 'GE-PR-003', price: 300, vendor_comment: 'in stock' },
    ]);
    ok('2 updated', q.updated === 2);
    ok('status QUOTED', q.req.status === 'QUOTED');
    ok('price set', q.req.lines.find(l => l.part_no === 'ME-EX-001').price === 1200);

    console.log('\n[5] HQ adjustment apply');
    const h = await INV.applyHqAdjustment(req.id, [
        { part_no: 'ME-EX-001', qty_approved: 2, hq_comment: 'ok' },
        { part_no: 'GE-PR-003', qty_approved: 1, hq_comment: 'reduce' },
    ]);
    ok('status APPROVED', h.req.status === 'APPROVED');
    ok('qty_approved set', h.req.lines.find(l => l.part_no === 'GE-PR-003').qty_approved === 1);

    console.log('\n[6] Spare CRUD (Append / Modify / Delete)');
    const nu = await INV.saveSpare({ id: 'u1' }, { part_no: 'NEW-001', name: 'Cooling Pump Seal', unit: 'EA', qty_on_hand: 1, standard_stock: 3 });
    ok('append creates id', !!nu.id);
    ok('auto universal_code', /^UNI-/.test(nu.universal_code));
    ok('stored in DB', (await TVC_DB.get('spare_parts', nu.id)).name === 'Cooling Pump Seal');
    let dupErr = null;
    try { await INV.saveSpare({ id: 'u1' }, { part_no: 'ME-EX-001', name: 'dup' }); } catch (e) { dupErr = e; }
    ok('duplicate part_no rejected', dupErr && dupErr.code === 'DUP');
    nu.name = 'Cooling Pump Seal (rev)';
    await INV.saveSpare({ id: 'u1' }, nu);
    ok('modify persists', (await TVC_DB.get('spare_parts', nu.id)).name === 'Cooling Pump Seal (rev)');
    await INV.deleteSpare({ id: 'u1' }, nu.id);
    ok('delete removes', !(await TVC_DB.get('spare_parts', nu.id)));

    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    process.exit(fail ? 1 : 0);
})();
