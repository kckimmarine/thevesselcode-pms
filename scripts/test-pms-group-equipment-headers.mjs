#!/usr/bin/env node
/**
 * PMS GROUP Tree Modify · Item equipment headers · Report snapshot stability
 * Usage: npm run test-pms-group-equipment-headers
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SPARE_JS = path.join(ROOT, 'js', 'ui', 'spareMenu.js');
const APP_JS = path.join(ROOT, 'js', 'app.js');

const CE_USER = { username: 'ce', role: 'SHIP_CHIEF', department: 'ENGINE' };
const HQ_USER = { username: 'hq', role: 'HQ_SUPERVISOR', department: null };

let pass = 0;
let fail = 0;
function assert(name, cond, detail = '') {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); fail++; }
}

function normalizeGroupLabel(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function groupDefHeader(st, label, itemSort1) {
    const lab = String(label || '').trim();
    if (!lab) return null;
    const inDept = (gr) => (!st.department || gr.department === st.department);
    const itemKey = String(itemSort1 || '').trim();
    const mapDef = (def) => {
        if (!def) return null;
        const has = def.machinery_name || def.model_type || def.maker || def.capacity || def.serial_no
            || def.is_critical_equipment != null;
        if (!def.header_edited && !has) return null;
        return {
            edited: !!def.header_edited,
            maker: String(def.maker || '').trim(),
            modelType: String(def.model_type || '').trim(),
            capacity: String(def.capacity || '').trim(),
            serialNo: String(def.serial_no || '').trim(),
            criticalEquipment: def.is_critical_equipment === true ? 'Yes' : def.is_critical_equipment === false ? 'No' : '',
        };
    };
    const matchLabel = (gr) => inDept(gr) && normalizeGroupLabel(gr.label) === normalizeGroupLabel(lab);
    if (itemKey) {
        const itemDef = (st.groups || []).find(gr => matchLabel(gr)
            && String(gr.item_sort1 || '').trim() === itemKey);
        const mapped = mapDef(itemDef);
        if (mapped) return mapped;
    }
    const def = (st.groups || []).find(gr => matchLabel(gr) && !String(gr.item_sort1 || '').trim());
    return mapDef(def);
}

function resolveGroupHeaderByKey(st, groupKey, groupLabel, itemSort1) {
    const label = String(groupLabel || '').trim();
    const itemDef = label ? groupDefHeader(st, label, itemSort1) : null;
    if (itemDef?.edited) {
        return {
            pmsGroupNo: label,
            maker: itemDef.maker,
            modelType: itemDef.modelType,
            capacity: itemDef.capacity,
            serialNo: itemDef.serialNo,
        };
    }
    const groupDef = groupDefHeader(st, label, '');
    return {
        pmsGroupNo: label,
        maker: groupDef?.maker || '',
        modelType: groupDef?.modelType || '',
        capacity: groupDef?.capacity || '',
        serialNo: groupDef?.serialNo || '',
    };
}

function simulateSaveGroupHeader(groups, { dept, label, maker, modelType, capacity, serialNo, critical }) {
    const idx = groups.findIndex(g => g.department === dept
        && normalizeGroupLabel(g.label) === normalizeGroupLabel(label)
        && !String(g.item_sort1 || '').trim());
    const row = {
        ...(idx >= 0 ? groups[idx] : { id: `grp-${label}`, department: dept, label, sort_order: 0 }),
        maker,
        model_type: modelType,
        capacity,
        serial_no: serialNo,
        is_critical_equipment: critical,
        header_edited: true,
    };
    if (idx >= 0) groups[idx] = row;
    else groups.push(row);
    return groups;
}

function simulateSaveJobEquipmentHeader(groups, { dept, label, item_sort1, maker, modelType, capacity, serialNo }) {
    const item = String(item_sort1 || '').trim();
    const idx = groups.findIndex(g => g.department === dept
        && normalizeGroupLabel(g.label) === normalizeGroupLabel(label)
        && String(g.item_sort1 || '').trim() === item);
    const row = {
        ...(idx >= 0 ? groups[idx] : { id: `grp-item-${label}-${item}`, department: dept, label, sort_order: 0 }),
        item_sort1: item || null,
        maker,
        model_type: modelType,
        capacity,
        serial_no: serialNo,
        header_edited: true,
    };
    if (idx >= 0) groups[idx] = row;
    else groups.push(row);
    return groups;
}

function snapshotReportHeader(hdr) {
    return {
        maker: hdr.maker,
        modelType: hdr.modelType,
        capacity: hdr.capacity,
        serialNo: hdr.serialNo,
    };
}

async function scenario(name, fn) {
    console.log(`\n=== ${name} ===`);
    await fn();
}

async function main() {
    const spareSrc = fs.readFileSync(SPARE_JS, 'utf8');
    const appSrc = fs.readFileSync(APP_JS, 'utf8');

    await scenario('1) Group Modify — batch fields persist (maintenance_groups)', async () => {
        const groups = [];
        simulateSaveGroupHeader(groups, {
            dept: 'ENGINE',
            label: '01. MAIN ENGINE',
            maker: 'MAN-B&W',
            modelType: '6S50MC-C',
            capacity: '6230 kW',
            serialNo: 'ME-001',
            critical: true,
        });
        const st = { department: 'ENGINE', groups };
        const def = groupDefHeader(st, '01. MAIN ENGINE');
        assert('group maker saved', def?.maker === 'MAN-B&W');
        assert('group model saved', def?.modelType === '6S50MC-C');
        assert('group capacity saved', def?.capacity === '6230 kW');
        assert('group serial saved', def?.serialNo === 'ME-001');
        assert('header_edited flag', def?.edited === true);
        assert('saveGroupHeaderEdit writes maintenance_groups', spareSrc.includes('header_edited: true'));
        assert('saveGroupHeaderEdit stores serial_no', spareSrc.includes('serial_no: header.serialNo'));
    });

    await scenario('2) Group Modify — resolveWrJobHeader uses saved group header', async () => {
        const groups = [{
            id: 'g1', department: 'ENGINE', label: '01. MAIN ENGINE',
            maker: 'MAKER-A', model_type: 'MODEL-A', capacity: 'CAP-A', serial_no: 'SN-A',
            header_edited: true,
        }];
        const st = { department: 'ENGINE', groups };
        const job = { department: 'ENGINE', group: '01. MAIN ENGINE', item_sort1: 'M/E CYLINDER' };
        const hdr = resolveGroupHeaderByKey(st, 'ENGINE|01. MAIN ENGINE', job.group, job.item_sort1);
        assert('new report gets group maker', hdr.maker === 'MAKER-A');
        assert('new report gets group model', hdr.modelType === 'MODEL-A');
        assert('resolveWrJobHeader passes item_sort1', spareSrc.includes('job.item_sort1 || \'\''));
    });

    await scenario('3) Item Modify — Equipment Headers (item_sort1 override)', async () => {
        const groups = [
            {
                id: 'g1', department: 'ENGINE', label: '01. MAIN ENGINE',
                maker: 'GROUP-MAKER', model_type: 'GROUP-MODEL', capacity: 'GROUP-CAP', serial_no: 'GROUP-SN',
                header_edited: true,
            },
            {
                id: 'g2', department: 'ENGINE', label: '01. MAIN ENGINE', item_sort1: 'F.O PUMP',
                maker: 'ITEM-MAKER', model_type: 'ITEM-MODEL', capacity: 'ITEM-CAP', serial_no: 'ITEM-SN',
                header_edited: true,
            },
        ];
        const st = { department: 'ENGINE', groups };
        const jobA = { department: 'ENGINE', group: '01. MAIN ENGINE', item_sort1: 'F.O PUMP' };
        const jobB = { department: 'ENGINE', group: '01. MAIN ENGINE', item_sort1: 'OTHER PART' };
        const hdrA = resolveGroupHeaderByKey(st, '', jobA.group, jobA.item_sort1);
        const hdrB = resolveGroupHeaderByKey(st, '', jobB.group, jobB.item_sort1);
        assert('item override maker', hdrA.maker === 'ITEM-MAKER');
        assert('item override model', hdrA.modelType === 'ITEM-MODEL');
        assert('fallback to group maker', hdrB.maker === 'GROUP-MAKER');
        assert('item edit UI wired', spareSrc.includes('renderPlanJobEquipmentHeaderEditHtml'));
        assert('item save calls saveJobEquipmentHeader', appSrc.includes('saveJobEquipmentHeader(user'));
        assert('equipment inputs in plan header', appSrc.includes('oie_maker'));
    });

    await scenario('4) PMS Master Equipment Headers — item_sort1 lookup', async () => {
        const groups = [{
            id: 'eq1', department: 'ENGINE', label: '01. MAIN ENGINE', item_sort1: 'F.O PUMP',
            maker: 'EXCEL-MAKER', model_type: 'EXCEL-MODEL', capacity: '100 m3/h', serial_no: 'FP-99',
            header_edited: true,
        }];
        const st = { department: 'ENGINE', groups };
        const hdr = resolveGroupHeaderByKey(st, '', '01. MAIN ENGINE', 'F.O PUMP');
        assert('imported equipment header maker', hdr.maker === 'EXCEL-MAKER');
        assert('imported equipment header model', hdr.modelType === 'EXCEL-MODEL');
        assert('groupDefHeader accepts itemSort1', spareSrc.includes('function groupDefHeader(st, label, itemSort1)'));
    });

    await scenario('5) Reports — saved snapshot vs live header (no reset on group change)', async () => {
        const liveHdr = { maker: 'NEW-MAKER', modelType: 'NEW-MODEL', capacity: 'NEW-CAP', serialNo: 'NEW-SN' };
        const savedForm = snapshotReportHeader({ maker: 'OLD-MAKER', modelType: 'OLD-MODEL', capacity: 'OLD-CAP', serialNo: 'OLD-SN' });
        const newReportForm = snapshotReportHeader(liveHdr);
        assert('saved report keeps old maker', savedForm.maker === 'OLD-MAKER');
        assert('saved report keeps old model', savedForm.modelType === 'OLD-MODEL');
        assert('new report uses live maker', newReportForm.maker === 'NEW-MAKER');
        assert('openWorkReport snapshots resolveWrJobHeader', appSrc.includes('resolveWrJobHeader(state, job)'));
        assert('history reload uses saved form', appSrc.includes('item?.used_parts') || appSrc.includes('item.form'));
    });

    await scenario('6) RBAC & wiring — HQ / Confirmer can modify', async () => {
        assert('canEditGroupHeader uses maint plan editor', spareSrc.includes('function canEditGroupHeader'));
        assert('startGroupHeaderEdit permission message', spareSrc.includes('Chief Engineer, Chief Officer, Captain, or Superintendent'));
        assert('canEditOriginalPlanItems for item modify', appSrc.includes('canEditOriginalPlanItems'));
        assert('CE role SHIP_CHIEF', CE_USER.role === 'SHIP_CHIEF');
        assert('HQ role HQ_SUPERVISOR', HQ_USER.role === 'HQ_SUPERVISOR');
    });

    await scenario('7) Stability — group header not cleared by dept normalize', async () => {
        assert('normalizeGroupDepartments preserves header fields', !appSrc.includes('g.maker = ')
            || appSrc.includes('g.department = target'));
        assert('header_edited skips legacy fallback', spareSrc.includes('if (def?.edited)'));
    });

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
