#!/usr/bin/env node
/**
 * spare inventory.xls / CSV 파서 검증
 * node scripts/test-spare-inventory-parser.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const schemaCode = fs.readFileSync(path.join(root, 'js/core/schema.js'), 'utf8');
const dbSrc = fs.readFileSync(path.join(root, 'js/core/db.js'), 'utf8');
const cut = dbSrc.indexOf('\nconst TVC_DB = (function ()');
if (cut < 0) throw new Error('TVC_SpareInventoryParser block not found');
const parserCode = dbSrc.slice(0, cut);

const TVC_SpareInventoryParser = vm.runInNewContext(
    schemaCode + '\n' + parserCode + '\n; TVC_SpareInventoryParser;',
    { console, window: {} }
);

const csvPath = path.join(root, 'data/spare-inventory-engine.sample.csv');
if (!fs.existsSync(csvPath)) {
    console.error('Missing sample CSV:', csvPath);
    process.exit(1);
}

const text = fs.readFileSync(csvPath, 'utf8');
const rows = TVC_SpareInventoryParser.parseCsvText(text);
const parsed = TVC_SpareInventoryParser.parseCsvLineByLine(text, { department: 'ENGINE' });

console.log('[parse stats]', parsed.stats);
console.log('[equipment sample]', parsed.equipment.slice(0, 3).map(e => e.label));
console.log('[spare sample]', parsed.spares.slice(0, 3).map(s => ({
    part: s.makerPartNo, name: s.name, prev: s.previousStock, cur: s.currentStock,
})));

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

assert(parsed.stats.spares >= 1300, `expected >=1300 spares, got ${parsed.stats.spares}`);
assert(parsed.stats.equipment >= 50, `expected >=50 equipment nodes, got ${parsed.stats.equipment}`);
assert(parsed.spares.every(s => Number.isInteger(s.previousStock)), 'previousStock must be integer');
assert(parsed.spares.every(s => Number.isInteger(s.currentStock)), 'currentStock must be integer');
assert(parsed.spares.every(s => s.universalItemCode.startsWith('U_ENG_')), 'UIC must be U_ENG_xxx');
assert(parsed.spares.every(s => s.parentEquipmentID), 'parentEquipmentID required');
assert(parsed.spares[0].universalItemCode === 'U_ENG_001', 'first UIC must be U_ENG_001');

const stud = parsed.spares.find(s => s.makerPartNo === '01-001-01');
assert(stud && stud.name === 'Stud' && stud.previousStock === 4 && stud.currentStock === 4, 'Stud row mismatch');

console.log('\n✓ spare inventory parser OK');
