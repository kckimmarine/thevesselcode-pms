/* THE VESSEL CODE — IndexedDB Schema & Constants
 *
 * ▸ 확장 원칙 (20년 유지보수 지향):
 *   1. 기존 store/field는 절대 제거·개명하지 않는다 (하위호환 보장).
 *   2. 신규 데이터는 신규 store 또는 "선택적(optional) field"로만 추가한다.
 *   3. 인덱스 추가는 DB_VERSION을 올리면 db.js의 onupgradeneeded가
 *      "누락된 store/index만" 생성하도록 reconcile 한다 (파괴적 재생성 없음).
 *   4. 모든 레코드는 sync_status / updated_at / (선택) schema_version 을 갖는다.
 */
const TVC_SCHEMA = {
    DB_NAME: 'tvc_pms_v2',
    DB_VERSION: 11, // v11: spare_groups (SPARE GROUP Tree — separate from maintenance_groups)
    STORES: {
        meta: { keyPath: 'key' },
        users: { keyPath: 'id' },
        ship_components: { keyPath: 'id' },
        maintenance_jobs: { keyPath: 'id' },
        maintenance_groups: { keyPath: 'id' },
        spare_groups: { keyPath: 'id' },
        spare_parts: { keyPath: 'id' },
        daily_work_reports: { keyPath: 'id' },
        audit_logs: { keyPath: 'id', autoIncrement: true },
        sync_history: { keyPath: 'id', autoIncrement: true },
        // ── v3 신규 (Inventory / Procurement) ──────────────────────────
        universal_catalog: { keyPath: 'universal_code' }, // 공통 관리 코드 마스터
        job_bom: { keyPath: 'id' },                        // 정비작업 ↔ 필요부품(BOM)
        requisitions: { keyPath: 'id' },                   // 부품 청구서(Requisition)
        inventory_history: { keyPath: 'id' },              // SPICS 입·출고 전용 이력
        consume_logs: { keyPath: 'id' },                   // Consumed Parts 일지 (배치)
        defect_cases: { keyPath: 'id' },                   // Defect Report Case
        work_permits: { keyPath: 'id' },                   // Critical Equipment Work Permit
    },
    INDEXES: {
        users: [{ name: 'username', keyPath: 'username', unique: true }],
        ship_components: [
            { name: 'by_parent', keyPath: 'parent_id' },
            { name: 'by_sort', keyPath: 'sort_order' },
            { name: 'by_vessel', keyPath: 'vessel_id' },
        ],
        maintenance_jobs: [
            { name: 'by_job_code', keyPath: 'job_code' },
            { name: 'by_department', keyPath: 'department' },
            { name: 'by_component', keyPath: 'ship_component_id' },
            { name: 'by_overdue', keyPath: 'is_overdue' },
            { name: 'by_next_date', keyPath: 'next_date' },
            { name: 'by_sync', keyPath: 'sync_status' },
            { name: 'by_vessel', keyPath: 'vessel_id' },
        ],
        maintenance_groups: [
            { name: 'by_department', keyPath: 'department' },
            { name: 'by_vessel', keyPath: 'vessel_id' },
        ],
        spare_groups: [
            { name: 'by_department', keyPath: 'department' },
            { name: 'by_vessel', keyPath: 'vessel_id' },
        ],
        spare_parts: [
            // v10: unique 해제 — 선박별 동일 part_no 허용 (앱에서 vessel_id+part_no 검증)
            { name: 'by_part_no', keyPath: 'part_no', unique: false },
            { name: 'by_universal', keyPath: 'universal_code' },
            { name: 'by_category', keyPath: 'category' },
            { name: 'by_vessel', keyPath: 'vessel_id' },
        ],
        daily_work_reports: [
            { name: 'by_status', keyPath: 'status' },
            { name: 'by_job_code', keyPath: 'job_code' },
            { name: 'by_sync', keyPath: 'sync_status' },
        ],
        sync_history: [
            { name: 'by_direction', keyPath: 'direction' },
            { name: 'by_at', keyPath: 'at' },
        ],
        job_bom: [
            { name: 'by_job_code', keyPath: 'job_code' },
            { name: 'by_spare', keyPath: 'spare_part_id' },
        ],
        requisitions: [
            { name: 'by_status', keyPath: 'status' },
            { name: 'by_vessel', keyPath: 'vessel_id' },
            { name: 'by_department', keyPath: 'department' },
        ],
        inventory_history: [
            { name: 'by_spare', keyPath: 'spare_part_id' },
            { name: 'by_type', keyPath: 'tx_type' },
            { name: 'by_at', keyPath: 'at' },
            { name: 'by_part_no', keyPath: 'part_no' },
        ],
        consume_logs: [
            { name: 'by_vessel', keyPath: 'vessel_id' },
            { name: 'by_at', keyPath: 'created_at' },
            { name: 'by_department', keyPath: 'department' },
        ],
        defect_cases: [
            { name: 'by_status', keyPath: 'status' },
            { name: 'by_sync', keyPath: 'sync_status' },
            { name: 'by_vessel', keyPath: 'vessel_id' },
            { name: 'by_case_no', keyPath: 'case_no' },
            { name: 'by_department', keyPath: 'department' },
        ],
        work_permits: [
            { name: 'by_status', keyPath: 'status' },
            { name: 'by_sync', keyPath: 'sync_status' },
            { name: 'by_vessel', keyPath: 'vessel_id' },
            { name: 'by_permit_no', keyPath: 'permit_no' },
            { name: 'by_department', keyPath: 'department' },
        ],
    },
};

/** SPICS inventory_history 거래 유형 */
const TVC_INVENTORY_TX = {
    CONSUMPTION: 'CONSUMPTION',
    DELIVERY: 'DELIVERY',
    REVERSAL: 'REVERSAL',
    REQUISITION: 'REQUISITION',
    ADJUSTMENT: 'ADJUSTMENT',
    IMPORT: 'IMPORT',
    SETTLEMENT: 'SETTLEMENT',
};

const TVC_META_KEYS = {
    VESSEL_ID: 'vessel_id',
    LAST_EXPORT: 'last_export_at',
    SEED_LOADED: 'seed_loaded',
    DB_INIT: 'db_initialized_at',
    INVENTORY_DEFAULTS: 'inventory_defaults_v1', // BOM/카탈로그 1회 시딩 여부
    SPICS_SYNC: 'spics_sync_at',                 // SparePart 부팅 동기화 시각
    INVENTORY_IMPORT: 'inventory_import_last',   // spare inventory.xls 마지막 import
    INVENTORY_XLS_LOADED: 'inventory_xls_loaded', // data/spare-inventory.xls 자동 적재
    ORIGINAL_PLAN_UPDATE: 'original_plan_update_last',
    ORIGINAL_PLAN_LOCK: 'original_plan_lock_v1',
    PMS_MASTER_IMPORTED: 'pms_master_imported_at',
    MASTER_VESSEL_SCOPE: 'master_vessel_scope_v1',
};

function pmsMasterCanonicalMetaKey(vesselId, department) {
    const v = String(vesselId || 'SHIP').replace(/[^\w.-]+/g, '_').slice(0, 40);
    return `pms_master_group_canonical_${v}_${String(department || '').toUpperCase()}`;
}

/** 번들 ENGINE CSV 경로 (우선순위 순) */
const TVC_ENGINE_CSV_PATHS = [
    'data/spare inventory.xls - ENGINE.csv',
    'data/spare-inventory-engine.sample.csv',
];

/**
 * SPICS — SparePart / MaintenanceTask 정규 스키마 (camelCase = API·UI 계약)
 * IndexedDB 저장 시 snake_case 필드와 양방향 매핑 (TVC_SpareSchema).
 * 기존 part_no / qty_on_hand 등 레거시 필드는 절대 제거하지 않는다.
 */
const TVC_SpareSchema = (function () {
    const SCHEMA_VERSION = 1;

    /** @typedef {Object} SparePart
     *  @property {string} id
     *  @property {string} universalItemCode - UniversalItemCode (필수 · 선박 간 공통 관리 코드)
     *  @property {string} makerPartNo       - Maker Part No (저장: part_no)
     *  @property {string} name              - Description
     *  @property {number} previousStock     - 전기 재고 (저장: previous_stock)
     *  @property {number} currentStock       - 현재 재고 실시간 (저장: qty_on_hand)
     *  @property {number} [stockA]          - Stock (A) — 신품/완전수리 (저장: stock_a)
     *  @property {number} [stockB]          - Stock (B) — 사용가능 중고 (저장: stock_b)
     *  @property {number} [receivedQty]     - 입고 (저장: qty_received)
     *  @property {number} [consumptionQty]  - 소비 (저장: qty_consumed)
     *  @property {number} minStock          - 최소 재고 (저장: min_qty)
     *  @property {number} [standardStock]   - 기준/청구 재고 (저장: standard_stock)
     *  @property {number} [workingQty]     - 사용(장착) 중 수량 (저장: qty_working)
     *  @property {string} [partClass]       - G/L (저장: part_class) — Legal(L), General(G)
     *  @property {string} [inventoryNumbering] - SPICS Code (GG-EE-III, e.g. 01-01-001)
     *  @property {string} [drawingPartNo]   - Part Number / Code Number
     *  @property {string} [dwgNo]           - Drawing No. (저장: dwg_no)
     *  @property {string} [shipComponentId] - 연결 장비/섹션
     *  @property {string} [parentEquipmentID] - 부모 장비 ID (CSV Equipment Header)
     *  @property {string} [equipment] - Equipment (SORT-1) — 그룹 내 장비 구분
     *  @property {number} [equipmentNo] - Equipment block no (EE in GG-EE-III, 1-99; 0 = none)
     *  @property {string} location
     *  @property {string} [group] - Original/Actual Plan GROUP (사용자 지정)
     *  @property {boolean} isCritical
     *  @property {Array<{at:string,type:string,qty:number,price?:number,vendorComment?:string,ref?:string,note?:string}>} history
     */

    /** @typedef {Object} RequiredPartLine
     *  @property {string} sparePartId
     *  @property {number} qty
     */

    /** @typedef {Object} MaintenanceTask
     *  @property {string} id
     *  @property {string} jobCode
     *  @property {RequiredPartLine[]} requiredParts - BOM (작업 완료 시 currentStock 차감)
     */

    function blank() {
        return {
            id: '',
            universalItemCode: '',
            universalCode: '', // alias
            makerPartNo: '',
            name: '',
            previousStock: 0,
            currentStock: 0,
            stockA: 0,
            stockB: 0,
            receivedQty: 0,
            consumptionQty: 0,
            minStock: 0,
            standardStock: 0,
            workingQty: 0,
            partClass: '',
            inventoryNumbering: '',
            drawingPartNo: '',
            dwgNo: '',
            shipComponentId: '',
            parentEquipmentID: '',
            equipment: '',
            equipmentNo: 0,
            location: '',
            group: '',
            isCritical: false,
            history: [],
            category: 'GENERAL',
            unit: 'EA',
            price: null,
            currency: 'USD',
            vendorComment: '',
        };
    }

    function intStock(v) {
        const n = Number(String(v ?? '').replace(/,/g, '').trim());
        if (isNaN(n)) return 0;
        return Math.max(0, Math.floor(n));
    }

    function textField(v) {
        if (v == null || v === '') return '';
        if (typeof v === 'string') return v.trim();
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
        return '';
    }

    function universalItemCodeOf(row) {
        return String(row.universal_item_code || row.universal_code || row.universalCode || row.universalItemCode || '').trim();
    }

    function normalizePartClass(v) {
        const c = String(v ?? '').trim().toUpperCase();
        if (c === 'L') return 'L';
        if (c === 'G' || c === 'M') return 'G';
        return '';
    }

    /** IndexedDB row → canonical SparePart */
    function fromRow(row) {
        if (!row) return null;
        const uic = universalItemCodeOf(row);
        const minS = Number(row.min_qty ?? row.minStock ?? row.standard_stock ?? 0) || 0;
        const stdS = Number(row.standard_stock ?? row.standardStock ?? minS) || 0;
        const pClass = normalizePartClass(row.part_class || row.partClass);
        const isCritFlag = row.is_critical ?? row.isCritical;
        return {
            id: row.id || '',
            universalItemCode: uic,
            universalCode: uic,
            makerPartNo: row.part_no || row.makerPartNo || row.maker_part_no || '',
            name: row.name || '',
            previousStock: intStock(row.previous_stock ?? row.previousStock),
            currentStock: intStock(row.qty_on_hand ?? row.currentStock),
            stockA: intStock(row.stock_a ?? row.stockA),
            stockB: intStock(row.stock_b ?? row.stockB),
            receivedQty: intStock(row.qty_received ?? row.receivedQty),
            consumptionQty: intStock(row.qty_consumed ?? row.consumptionQty),
            minStock: minS,
            standardStock: stdS,
            workingQty: intStock(row.qty_working ?? row.workingQty),
            partClass: pClass,
            inventoryNumbering: row.inventory_numbering || row.inventoryNumbering || '',
            drawingPartNo: textField(row.drawing_part_no ?? row.drawingPartNo),
            dwgNo: textField(row.dwg_no ?? row.dwgNo ?? row.drawing_no ?? row.drawingNo),
            shipComponentId: row.ship_component_id || row.shipComponentId || '',
            parentEquipmentID: row.parent_equipment_id || row.parentEquipmentID || '',
            equipment: textField(row.equipment || row.item_sort1 || row.itemSort1),
            equipmentNo: intStock(row.equipment_no ?? row.equipmentNo ?? 0),
            location: row.location || row.storage_location || '',
            maker: row.maker || row.vendor_comment || '',
            model: row.model || row.modelType || '',
            group: String(row.group || '').trim(),
            isCritical: isCritFlag != null ? !!isCritFlag : (pClass === 'L'),
            history: Array.isArray(row.history) ? row.history.slice() : [],
            category: row.category || 'GENERAL',
            unit: row.unit || 'EA',
            price: row.price != null ? Number(row.price) : null,
            currency: row.currency || 'USD',
            vendorComment: row.vendor_comment || row.vendorComment || '',
            sync_status: row.sync_status,
            updated_at: row.updated_at,
            schema_version: row.schema_version || SCHEMA_VERSION,
            vessel_id: row.vessel_id || row.vesselId || '',
            vesselId: row.vessel_id || row.vesselId || '',
        };
    }

    /** canonical SparePart → IndexedDB row (레거시 필드 동시 기록) */
    function toRow(part) {
        const p = { ...blank(), ...part };
        const uic = String(p.universalItemCode || p.universalCode || '').trim();
        const minS = Math.max(0, Math.floor(Number(p.minStock ?? p.standardStock) || 0));
        const stdS = Math.max(0, Math.floor(Number(p.standardStock ?? p.minStock) || 0));
        const cur = intStock(p.currentStock);
        const prev = intStock(p.previousStock);
        return {
            id: p.id,
            part_no: String(p.makerPartNo || '').trim(),
            universal_code: uic,
            universal_item_code: uic,
            name: String(p.name || '').trim(),
            previous_stock: prev,
            qty_on_hand: cur,
            stock_a: intStock(p.stockA),
            stock_b: intStock(p.stockB),
            qty_received: intStock(p.receivedQty),
            qty_consumed: intStock(p.consumptionQty),
            min_qty: minS,
            standard_stock: stdS,
            qty_working: intStock(p.workingQty),
            part_class: normalizePartClass(p.partClass),
            inventory_numbering: String(p.inventoryNumbering || '').trim(),
            drawing_part_no: textField(p.drawingPartNo),
            dwg_no: textField(p.dwgNo),
            drawing_no: textField(p.dwgNo),
            ship_component_id: String(p.shipComponentId || '').trim(),
            parent_equipment_id: String(p.parentEquipmentID || '').trim(),
            equipment: String(p.equipment || '').trim(),
            equipment_no: intStock(p.equipmentNo ?? p.equipment_no ?? 0),
            item_sort1: String(p.equipment || '').trim() || undefined,
            location: String(p.location || '').trim(),
            group: String(p.group || '').trim(),
            is_critical: !!p.isCritical,
            history: Array.isArray(p.history) ? p.history : [],
            category: String(p.category || 'GENERAL').trim() || 'GENERAL',
            unit: String(p.unit || 'EA').trim() || 'EA',
            price: p.price != null && p.price !== '' ? Number(p.price) : null,
            currency: String(p.currency || 'USD').trim() || 'USD',
            vendor_comment: String(p.vendorComment || '').trim(),
            maker: p.maker || '',
            model: p.model || '',
            schema_version: SCHEMA_VERSION,
            sync_status: p.sync_status || 'LOCAL',
            updated_at: p.updated_at || new Date().toISOString(),
            vessel_id: String(p.vessel_id || p.vesselId || '').trim() || undefined,
        };
    }

    function generateUniversalItemCode(name) {
        const key = String(name || 'UNSPEC').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
        let h = 0;
        for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
        return 'UNI-' + Math.abs(h).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
    }

    /** 입력 검증 — 사관 실수 방지 (엄격) */
    function validate(part, { partial = false } = {}) {
        const p = { ...blank(), ...part };
        const errors = [];
        if (!partial || p.makerPartNo !== undefined) {
            const pn = String(p.makerPartNo || '').trim();
            if (!pn) errors.push('Part No (Maker Part No)는 필수입니다.');
            else if (pn.length > 64) errors.push('Part No는 64자 이하여야 합니다.');
            else if (!/^[A-Za-z0-9._\-\/]+$/.test(pn)) errors.push('Part No는 영문·숫자·._-/ 만 사용 가능합니다.');
        }
        if (!partial || p.name !== undefined) {
            const nm = String(p.name || '').trim();
            if (!nm) errors.push('Description (Name)은 필수입니다.');
            else if (nm.length > 200) errors.push('Description은 200자 이하여야 합니다.');
        }
        const uic = String(p.universalItemCode || p.universalCode || '').trim();
        if (!partial && !uic) errors.push('UniversalItemCode는 필수입니다.');
        else if (uic && !/^(UNI-[A-Z0-9]{4,12}|U_[A-Z]{2,6}_\d{3,6})$/i.test(uic)) {
            errors.push('UniversalItemCode 형식: UNI-XXXXXX 또는 U_ENG_001');
        }
        ['currentStock', 'minStock', 'previousStock'].forEach(k => {
            const v = Number(p[k]);
            if (isNaN(v) || v < 0 || !Number.isInteger(v)) errors.push(`${k}는 0 이상의 정수여야 합니다.`);
        });
        if (p.price != null && p.price !== '' && (isNaN(Number(p.price)) || Number(p.price) < 0)) {
            errors.push('Price는 0 이상의 숫자여야 합니다.');
        }
        if (errors.length) {
            throw Object.assign(new Error(errors.join('\n')), { code: 'VALIDATION', errors });
        }
        return p;
    }

    /** MaintenanceTask.requiredParts ← job_bom / job.required_parts */
    function requiredPartsFromJob(job, bomLinks) {
        if (Array.isArray(job?.required_parts) && job.required_parts.length) {
            return job.required_parts.map(l => ({
                sparePartId: l.sparePartId || l.spare_part_id,
                qty: Number(l.qty || l.qty_used || l.qty_per_job) || 0,
            })).filter(l => l.sparePartId && l.qty > 0);
        }
        return (bomLinks || []).map(b => ({
            sparePartId: b.spare_part_id || b.sparePartId,
            qty: Number(b.qty_per_job || b.qty) || 0,
        })).filter(l => l.sparePartId && l.qty > 0);
    }

    function generateSequentialUic(prefix, seq) {
        const p = String(prefix || 'ENG').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'ENG';
        return `U_${p}_${String(seq).padStart(3, '0')}`;
    }

    function uicPrefixForDepartment(dept) {
        const d = String(dept || 'ENGINE').toUpperCase();
        if (d.includes('ENGINE') || d === 'ENG') return 'ENG';
        if (d.includes('DECK') || d === 'DEK') return 'DEK';
        return d.slice(0, 3).replace(/[^A-Z]/g, '') || 'GEN';
    }

    return {
        SCHEMA_VERSION, blank, fromRow, toRow, validate, requiredPartsFromJob,
        generateUniversalItemCode, generateSequentialUic, uicPrefixForDepartment,
        universalItemCodeOf, intStock, textField, normalizePartClass,
    };
})();

/** SPICS spare inventory.xls / CSV → Equipment(ship_components) + SparePart 매핑 */
const TVC_EquipmentSchema = (function () {
    function slug(s) {
        return String(s || 'NODE').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
    }

    function blank() {
        return {
            id: '',
            parent_id: null,
            label: '',
            machinery_name: '',
            component_name: '',
            component_code: '',
            node_type: 'COMPONENT',
            department: 'ENGINE',
            path: [],
            sort_order: 0,
            remarks: '',
            sync_status: 'LOCAL',
            updated_at: new Date().toISOString(),
        };
    }

    /** 파서 컨텍스트 → ship_components row */
    function fromInventory(ctx, kind) {
        const b = blank();
        const dept = ctx.department || 'ENGINE';
        b.department = dept;
        b.path = (ctx.path || []).slice();
        b.sort_order = ctx.sortOrder || 0;
        if (kind === 'TOP') {
            b.id = 'EQ-' + slug(dept + '_' + ctx.equipmentName);
            b.label = ctx.equipmentName;
            b.machinery_name = ctx.equipmentName;
            b.component_name = ctx.equipmentName;
            b.node_type = 'EQUIPMENT';
            b.parent_id = null;
            b.remarks = ctx.remark || '';
        } else if (kind === 'GROUP') {
            b.id = 'EQ-' + slug(dept + '_' + ctx.groupLabel);
            b.label = ctx.groupLabel;
            b.machinery_name = ctx.equipmentName || ctx.groupLabel;
            b.component_name = ctx.groupLabel;
            b.component_code = ctx.groupLabel;
            b.node_type = 'GROUP';
            b.parent_id = ctx.equipmentId || null;
        } else {
            b.id = 'EQ-' + slug(dept + '_' + ctx.sectionCode);
            b.label = ctx.sectionTitle || ctx.sectionCode;
            b.machinery_name = ctx.equipmentName || '';
            b.component_name = ctx.sectionTitle || ctx.sectionCode;
            b.component_code = ctx.sectionCode;
            b.node_type = 'SORT';
            b.parent_id = ctx.groupId || ctx.equipmentId || null;
            b.remarks = ctx.sectionTitle || '';
        }
        return b;
    }

    return { blank, fromInventory, slug };
})();

/**
 * WorkReport — daily_work_reports 레코드 계약 (단일·다중 작업 보고)
 * @typedef {object} WorkReportJobItem
 * @property {string} job_code
 * @property {string} maintenance_job_id
 * @property {string} status — REPORTED | CONFIRMED | APPROVED | POSTPONED (legacy: PENDING/APPROVED/CONFIRMED)
 * @property {object} [form] — Job별 Work Report 입력
 * @property {Array} [used_parts]
 * @property {string} [description]
 * @property {object} [prev_job_state] — 승인 직전 Job 스냅샷
 *
 * @typedef {object} WorkReport
 * @property {string} id
 * @property {string[]} job_codes — 포함된 모든 Job Code
 * @property {WorkReportJobItem[]} job_items — Job별 독립 상태·입력
 * @property {boolean} [is_batch]
 * @property {string} job_code — 레거시·목록용 (단일 또는 요약)
 * @property {string} maintenance_job_id — 레거시·첫 Job id
 */
const TVC_WorkReport = (function () {
    const ITEM_STATUSES = ['REPORTED', 'CONFIRMED', 'APPROVED', 'POSTPONED'];

    function normalizeItemStatus(status, isLocked) {
        if (typeof TVC_RBAC !== 'undefined' && TVC_RBAC.normalizeReportStatus) {
            return TVC_RBAC.normalizeReportStatus(status, isLocked);
        }
        if (status === 'PENDING') return 'REPORTED';
        if (status === 'POSTPONED' || status === 'APPROVED') return 'CONFIRMED';
        if (status === 'CONFIRMED') return isLocked ? 'APPROVED' : 'CONFIRMED';
        return status || 'REPORTED';
    }

    function backfillPostponeOriginalDue(report) {
        if (!report || report.work_type !== 'POSTPONE' || report.original_due_date) return;
        const item = (report.job_items || [])[0];
        const fromPrev = item?.prev_job_state?.next_date || report.prev_job_state?.next_date;
        if (fromPrev) report.original_due_date = String(fromPrev).slice(0, 10);
    }

    function migrateReportMeta(report) {
        if (!report) return report;
        const raw = report.status;
        if (raw === 'PENDING') {
            report.status = 'REPORTED';
        } else if (raw === 'POSTPONED') {
            report.status = 'CONFIRMED';
        } else if (raw === 'APPROVED') {
            if (!report.confirmed_by && report.approved_by) {
                report.confirmed_by = report.approved_by;
                report.confirmed_at = report.approved_at;
            }
            report.status = 'CONFIRMED';
        } else if (raw === 'CONFIRMED' && report.is_locked) {
            if (!report.approved_by && report.confirmed_by) {
                report.approved_by = report.confirmed_by;
                report.approved_at = report.confirmed_at;
            }
            report.status = 'APPROVED';
        } else {
            report.status = raw || 'REPORTED';
        }
        (report.job_items || []).forEach(item => {
            item.status = normalizeItemStatus(item.status, report.is_locked);
        });
        backfillPostponeOriginalDue(report);
        return report;
    }

    function blankJobItem(job, overrides = {}) {
        return {
            job_code: job.job_code,
            maintenance_job_id: job.id,
            status: overrides.status || 'REPORTED',
            form: overrides.form || {},
            used_parts: overrides.used_parts || [],
            description: overrides.description || job.job_detail || job.item_sort2 || '',
            prev_job_state: overrides.prev_job_state || null,
        };
    }

    /** 레거시 단일-job 리포트 → job_codes / job_items 보강 (in-place) */
    function fromLegacy(report) {
        if (!report) return report;
        if (Array.isArray(report.job_items) && report.job_items.length) {
            report.job_codes = report.job_codes || report.job_items.map(i => i.job_code);
            report.is_batch = report.is_batch ?? report.job_codes.length > 1;
            return migrateReportMeta(report);
        }
        const code = report.job_code || '';
        report.job_codes = code ? [code] : [];
        report.job_items = [{
            job_code: code,
            maintenance_job_id: report.maintenance_job_id,
            status: report.status || 'REPORTED',
            form: report.report_form || {},
            used_parts: report.used_parts || [],
            description: report.description || '',
            prev_job_state: report.prev_job_state || null,
        }];
        report.is_batch = false;
        return migrateReportMeta(report);
    }

    function getJobItems(report) {
        return fromLegacy(report).job_items || [];
    }

    function getJobCodes(report) {
        return fromLegacy(report).job_codes || [];
    }

    /** 부서 job_code 집합에 리포트(단일·Batch)가 속하는지 */
    function belongsToJobCodeSet(report, codeSet) {
        return getJobCodes(report).some(c => codeSet.has(c));
    }

    /** job_code → department 맵 기준 부서 소속 여부 (Export/Sync 필터) */
    function belongsToDepartment(report, dept, jobCodeToDept) {
        const map = jobCodeToDept instanceof Map ? jobCodeToDept : new Map(Object.entries(jobCodeToDept || {}));
        return getJobCodes(report).some(c => (map.get(c) || null) === dept);
    }

    function aggregateStatus(jobItems) {
        const items = jobItems || [];
        if (!items.length) return 'REPORTED';
        if (items.every(i => i.status === 'APPROVED')) return 'APPROVED';
        if (items.every(i => i.status === 'CONFIRMED' || i.status === 'APPROVED')) return 'CONFIRMED';
        if (items.some(i => i.status === 'REPORTED' || i.status === 'PENDING')) return 'REPORTED';
        return items[0].status || 'REPORTED';
    }

    function findItem(report, jobIdOrCode) {
        return getJobItems(report).find(i =>
            i.maintenance_job_id === jobIdOrCode || i.job_code === jobIdOrCode
        ) || null;
    }

    function hasPendingJob(report, jobId, jobCode) {
        return getJobItems(report).some(i =>
            (i.status === 'REPORTED' || i.status === 'PENDING') &&
            (i.maintenance_job_id === jobId || (jobCode && i.job_code === jobCode))
        );
    }

    function buildRecord(base, jobItems) {
        const items = jobItems.map(i => ({ ...i }));
        const codes = items.map(i => i.job_code).filter(Boolean);
        const primary = primaryJobItem({ job_items: items }) || items[0] || {};
        return {
            ...base,
            job_codes: codes,
            job_items: items,
            is_batch: codes.length > 1,
            job_code: codes.length > 1 ? (primary.job_code || codes.join(', ')) : (primary.job_code || base.job_code || ''),
            maintenance_job_id: primary.maintenance_job_id || base.maintenance_job_id,
            status: aggregateStatus(items),
        };
    }

    /** JOB CODE 정렬 (01-003 vs 01-010) */
    function compareJobCodes(a, b) {
        const parse = (code) => {
            const s = String(code || '').trim();
            const m = s.match(/^(\d+)\s*-\s*(\d+)/);
            if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
            return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, s];
        };
        const pa = parse(a);
        const pb = parse(b);
        for (let i = 0; i < 2; i++) {
            if (pa[i] !== pb[i]) return pa[i] - pb[i];
        }
        return String(a || '').localeCompare(String(b || ''));
    }

    /** 다중 JOB Work Report — 가장 빠른(작은) JOB CODE 항목 */
    function primaryJobItem(report) {
        const items = getJobItems(report);
        if (!items.length) return null;
        return [...items].sort((x, y) => compareJobCodes(x.job_code, y.job_code))[0];
    }

    /** Postpone — Original Due Date (저장 시점 Job NEXT DATE, Postpone Date와 분리) */
    function postponeOriginalDueDate(report, job, itemIndex = 0) {
        if (report) fromLegacy(report);
        if (report?.work_type === 'POSTPONE') {
            const item = getJobItems(report)[itemIndex];
            const od = report.original_due_date
                || item?.form?.originalDueDate
                || report.report_form?.originalDueDate
                || item?.prev_job_state?.next_date
                || report.prev_job_state?.next_date;
            if (od) return String(od).slice(0, 10);
        }
        return String(job?.next_date || '').slice(0, 10);
    }

    return {
        ITEM_STATUSES,
        blankJobItem,
        fromLegacy,
        getJobItems,
        getJobCodes,
        belongsToJobCodeSet,
        belongsToDepartment,
        aggregateStatus,
        findItem,
        hasPendingJob,
        buildRecord,
        compareJobCodes,
        primaryJobItem,
        postponeOriginalDueDate,
    };
})();

/**
 * DefectCase — defect_cases 레코드 계약 (Defect Report 서식 매핑)
 * Phase 1: 선박 보고 (긴급) · Phase 2: 회사 초기 검토/작업허가 (긴급)
 * Phase 3·4: 완료 확인·종결 (후속)
 */
const TVC_DefectCase = (function () {
    const SCHEMA_VERSION = 1;

    const Status = {
        DRAFT: 'DRAFT',
        SUBMITTED_TO_COMPANY: 'SUBMITTED_TO_COMPANY',
        COMPANY_REVIEWED: 'COMPANY_REVIEWED',
        WORK_IN_PROGRESS: 'WORK_IN_PROGRESS',
        AWAITING_COMPLETION: 'AWAITING_COMPLETION',
        CLOSED: 'CLOSED',
    };

    const PHASE1_FIELDS = [
        'to_company', 'case_no', 'ship_name', 'report_date', 'work_date',
        'file_no', 'voy_no', 'place',
        'pms_group_no', 'pms_job_code', 'item_sort1', 'item_sort2', 'job_detail', 'job_name', 'pms_group_key',
        'last_maintenance_date', 'rh_since_last_maintenance', 'total_run_hrs',
        'expect_date_place', 'machinery_name', 'manufacturer', 'maker', 'model_type', 'capacity', 'serial_no',
        'chief_engineer', 'master',
        'confirmed_by', 'confirmed_at', 'approved_by', 'approved_at',
        'outline_maintenance_request', 'estimated_cause', 'possible_effect', 'action_taken',
        'ship_attachments', 'company_attachments', 'company_comment',
        'working_hours', 'working_member', 'shore_technician',
        'repair_request', 'shore_support', 'defect_cleared', 'used_parts',
    ];

    const PHASE2_FIELDS = [
        'company_initial_reply', 'permit_to_work', 'reply_by', 'reply_date',
        'report_to_class', 'report_to_flag', 'report_to_external_stakeholder', 'report_to_psc', 'report_na',
    ];

    const PHASE3_FIELDS = ['ship_verified_after_clear', 'ship_verified_by', 'ship_verified_date'];
    const PHASE4_FIELDS = [
        'preventive_measures', 'dp_closed_satisfactory', 'dp_closed_reply', 'dp_closed_by', 'dp_closed_date',
    ];

    function blank(overrides = {}) {
        const today = new Date().toISOString().slice(0, 10);
        return {
            id: overrides.id || `DEF-${Date.now()}`,
            schema_version: SCHEMA_VERSION,
            case_no: overrides.case_no || '',
            vessel_id: overrides.vessel_id || '',
            department: overrides.department || '',
            maintenance_job_id: overrides.maintenance_job_id || '',
            job_code: overrides.job_code || '',
            work_report_id: overrides.work_report_id || null,
            status: overrides.status || Status.DRAFT,
            urgency: 'IMMEDIATE',
            sync_status: 'LOCAL',
            updated_at: new Date().toISOString(),
            created_at: overrides.created_at || new Date().toISOString(),
            submitted_at: null,
            phase1_locked: false,
            phase2_locked: false,
            phase3_locked: false,
            phase4_locked: false,
            to_company: overrides.to_company || 'Company D.P.',
            ship_name: overrides.ship_name || '',
            report_date: overrides.report_date || today,
            work_date: overrides.work_date || today,
            file_no: overrides.file_no || '',
            voy_no: overrides.voy_no || '',
            place: overrides.place || '',
            pms_group_no: overrides.pms_group_no || '',
            pms_group_key: overrides.pms_group_key || '',
            pms_job_code: overrides.pms_job_code || '',
            item_sort1: overrides.item_sort1 || '',
            item_sort2: overrides.item_sort2 || '',
            job_detail: overrides.job_detail || '',
            job_name: overrides.job_name || '',
            last_maintenance_date: overrides.last_maintenance_date || '',
            rh_since_last_maintenance: overrides.rh_since_last_maintenance ?? '',
            total_run_hrs: overrides.total_run_hrs ?? '0',
            expect_date_place: overrides.expect_date_place || '',
            machinery_name: overrides.machinery_name || '',
            manufacturer: overrides.manufacturer || '',
            maker: overrides.maker || '',
            model_type: overrides.model_type || '',
            capacity: overrides.capacity || '',
            serial_no: overrides.serial_no || '',
            type_model_serial: overrides.type_model_serial || '',
            chief_engineer: overrides.chief_engineer || '',
            master: overrides.master || '',
            confirmed_by: overrides.confirmed_by || '',
            confirmed_at: overrides.confirmed_at || '',
            approved_by: overrides.approved_by || '',
            approved_at: overrides.approved_at || '',
            outline_maintenance_request: overrides.outline_maintenance_request || '',
            estimated_cause: overrides.estimated_cause || '',
            possible_effect: overrides.possible_effect || '',
            action_taken: overrides.action_taken || '',
            ship_attachments: overrides.ship_attachments || [],
            company_attachments: overrides.company_attachments || [],
            company_comment: overrides.company_comment || '',
            working_hours: overrides.working_hours ?? '0',
            working_member: overrides.working_member ?? '0',
            shore_technician: !!overrides.shore_technician,
            repair_request: !!overrides.repair_request,
            shore_support: !!(overrides.shore_support ?? overrides.shore_technician),
            defect_cleared: !!overrides.defect_cleared,
            used_parts: overrides.used_parts || [],
            job_items: overrides.job_items || [],
            consume_log_id: overrides.consume_log_id || null,
            stock_applied_at: overrides.stock_applied_at || '',
            job_schedule_applied_at: overrides.job_schedule_applied_at || '',
            company_initial_reply: '',
            permit_to_work: '',
            reply_by: '',
            reply_date: '',
            report_to_class: false,
            report_to_flag: false,
            report_to_external_stakeholder: false,
            report_to_psc: false,
            report_na: false,
            ship_verified_after_clear: '',
            ship_verified_by: '',
            ship_verified_date: '',
            preventive_measures: '',
            dp_closed_satisfactory: null,
            dp_closed_reply: '',
            dp_closed_by: '',
            dp_closed_date: '',
            hq_reply_exported_at: null,
            last_export_filename: '',
            reported_by: overrides.reported_by || '',
            hq_synced: false,
            visible_in_list: overrides.visible_in_list !== false,
            ...overrides,
        };
    }

    function fromJob(job, vesselMeta = {}) {
        const hdr = vesselMeta.groupHeader || {};
        return blank({
            maintenance_job_id: job?.id || '',
            job_code: job?.job_code || '',
            department: job?.department || '',
            pms_group_no: job?.group || '',
            pms_group_key: job?.department ? `${job.department}|${String(job.group || '').trim()}` : '',
            pms_job_code: job?.job_code || '',
            item_sort1: job?.item_sort1 || '',
            item_sort2: job?.item_sort2 || '',
            job_detail: job?.job_detail || '',
            job_name: '',
            machinery_name: hdr.machineryName || job?.item_sort1 || '',
            manufacturer: hdr.maker || '',
            maker: hdr.maker || '',
            model_type: hdr.modelType || '',
            capacity: hdr.capacity || '',
            serial_no: hdr.serialNo || '',
            type_model_serial: [hdr.modelType, hdr.serialNo].filter(Boolean).join(' / '),
            last_maintenance_date: job?.last_done || '',
            outline_maintenance_request: '',
        });
    }

    function isPhase1Editable(row) {
        return row && !row.phase1_locked && (row.status === Status.DRAFT || row.status === Status.SUBMITTED_TO_COMPANY);
    }

    function isPhase2Editable(row) {
        return row && row.status === Status.SUBMITTED_TO_COMPANY && !row.phase2_locked;
    }

    /** Phase 1 — Reported → Confirmed → Submitted (export to Company/HQ) */
    function isPhase1Exported(row) {
        if (!row) return false;
        if (row.submitted_at) return true;
        if (row.phase1_locked) return true;
        if ((row.confirmed_at || row.confirmed_by) && row.sync_status === 'SYNCED') return true;
        const st = listWorkflowStatus(row);
        if (st === 'Submitted' || st === 'Approved') return true;
        return row.status === Status.SUBMITTED_TO_COMPANY
            || row.status === Status.COMPANY_REVIEWED
            || row.status === Status.WORK_IN_PROGRESS
            || row.status === Status.AWAITING_COMPLETION
            || row.status === Status.CLOSED;
    }

    /** Phase 3 — Ship DC (Defect Cleared); editable after Phase 1 export, even before HQ Approve */
    function isPhase3Editable(row) {
        if (!row || row.phase3_locked) return false;
        if (row.status === Status.CLOSED) return false;
        return isPhase1Exported(row);
    }

    /** Phase 3 complete — DEFECT CLEARED saved (case closed on ship side) */
    function isPhase3DcComplete(row) {
        return !!(row && row.defect_cleared && row.phase3_locked);
    }

    /** HQ Approve 후 선박 — Verified by Ship / DEFECT CLEARED (alias) */
    function isShipVerificationEditable(row) {
        return isPhase3Editable(row);
    }

    /** Phase 4 — HQ Company inspection comments (after ship DC) */
    function isPhase4Editable(row) {
        if (!row || !isPhase3DcComplete(row)) return false;
        return true;
    }

    function canStartWork(row) {
        return row && row.phase2_locked && !row.phase3_locked
            && row.status === Status.COMPANY_REVIEWED;
    }

    function validatePhase3(row) {
        const missing = [];
        if (!String(row.ship_verified_after_clear || '').trim()) missing.push('Verification (after defect cleared)');
        if (!String(row.ship_verified_by || '').trim()) missing.push('Verified by');
        if (!String(row.ship_verified_date || '').trim()) missing.push('Verification Date');
        return { ok: !missing.length, missing };
    }

    function validatePhase4(row) {
        const missing = [];
        if (!String(row.preventive_measures || '').trim()) missing.push('Preventive measures');
        if (row.dp_closed_satisfactory !== true && row.dp_closed_satisfactory !== false) {
            missing.push('Satisfactory / Unsatisfactory');
        }
        if (!String(row.dp_closed_by || '').trim()) missing.push('Reply by');
        if (!String(row.dp_closed_date || '').trim()) missing.push('Reply Date');
        return { ok: !missing.length, missing };
    }

    function validatePhase1(row) {
        const missing = [];
        if (!String(row.outline_maintenance_request || '').trim()) missing.push('Outline of Defect');
        const machinery = String(row.machinery_name || row.job_name || '').trim();
        if (!machinery) missing.push('Job Name');
        if (!String(row.report_date || '').trim()) missing.push('Date');
        return { ok: !missing.length, missing };
    }

    function validatePhase2(row) {
        const missing = [];
        if (!String(row.company_initial_reply || '').trim()) missing.push('Initial Reply from Company');
        if (!String(row.reply_by || '').trim()) missing.push('Reply by');
        if (!String(row.reply_date || '').trim()) missing.push('Reply Date');
        return { ok: !missing.length, missing };
    }

    /** HQ Defect reply ZIP export 전 필수 항목 */
    function validateHqDefectReplyExport(row) {
        const missing = [];
        const phase2 = validatePhase2(row);
        if (!phase2.ok) missing.push(...phase2.missing);
        if (!(row.approved_at || row.approved_by)) missing.push('Approved by');
        const hasReportTo = row.report_na || row.report_to_class || row.report_to_flag
            || row.report_to_external_stakeholder || row.report_to_psc;
        if (!hasReportTo) missing.push('REQUIRE TO REPORT TO');
        return { ok: !missing.length, missing };
    }

    function isHqReplyExported(row) {
        return !!(row?.hq_reply_exported_at);
    }

    function belongsToDepartment(row, dept) {
        if (!dept) return true;
        return !row.department || row.department === dept;
    }

    /** Defect Report 목록·Work History 공통 표시 Status (4단계 — Closed out는 DC 열) */
    function listWorkflowStatus(row) {
        if (!row) return 'Draft';
        if (row.approved_at || row.approved_by) return 'Approved';
        if (row.confirmed_at || row.confirmed_by) {
            if (row.sync_status === 'SYNCED') return 'Submitted';
            return 'Confirmed';
        }
        if (row.visible_in_list === false) return 'Draft';
        return 'Reported';
    }

    function listWorkflowTone(label) {
        switch (label) {
            case 'Approved': return 'green';
            case 'Submitted': return 'amber';
            case 'Confirmed': return 'green';
            case 'Reported': return 'blue';
            case 'Draft': return 'gray';
            default: return 'gray';
        }
    }

    /** Approved · Submitted 제외 — 목록/History Modify 허용 */
    function canModifyListWorkflow(row) {
        if (!row) return false;
        if (row.status === Status.CLOSED) return false;
        if (row.approved_at || row.approved_by) return false;
        if ((row.confirmed_at || row.confirmed_by) && row.sync_status === 'SYNCED') return false;
        const st = listWorkflowStatus(row);
        return st !== 'Approved' && st !== 'Submitted';
    }

    /** Approved · Submitted 제외 — 목록 Delete 허용 */
    function canDeleteListWorkflow(row) {
        if (!row) return false;
        if (row.status === Status.CLOSED) return false;
        if (row.approved_at || row.approved_by) return false;
        if ((row.confirmed_at || row.confirmed_by) && row.sync_status === 'SYNCED') return false;
        const st = listWorkflowStatus(row);
        return st !== 'Approved' && st !== 'Submitted';
    }

    return {
        SCHEMA_VERSION, Status, PHASE1_FIELDS, PHASE2_FIELDS, PHASE3_FIELDS, PHASE4_FIELDS,
        blank, fromJob, isPhase1Editable, isPhase2Editable, isPhase3Editable, isPhase4Editable,
        isPhase1Exported, isPhase3DcComplete,
        canStartWork, validatePhase1, validatePhase2, validatePhase3, validatePhase4, validateHqDefectReplyExport,
        isHqReplyExported, belongsToDepartment,
        listWorkflowStatus, listWorkflowTone, canModifyListWorkflow, canDeleteListWorkflow, isShipVerificationEditable,
    };
})();

/**
 * WorkPermit — work_permits (Critical Equipment planned maintenance permit)
 */
const TVC_WorkPermit = (function () {
    const SCHEMA_VERSION = 1;
    const Status = { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE' };

    function blank(overrides = {}) {
        const today = new Date().toISOString().slice(0, 10);
        return {
            id: overrides.id || `WP-${Date.now()}`,
            schema_version: SCHEMA_VERSION,
            permit_no: overrides.permit_no || '',
            vessel_id: overrides.vessel_id || '',
            department: overrides.department || '',
            maintenance_job_id: overrides.maintenance_job_id || '',
            job_code: overrides.job_code || '',
            pms_group_no: overrides.pms_group_no || '',
            pms_group_key: overrides.pms_group_key || '',
            pms_job_code: overrides.pms_job_code || '',
            item_sort1: overrides.item_sort1 || '',
            item_sort2: overrides.item_sort2 || '',
            job_detail: overrides.job_detail || '',
            job_name: overrides.job_name || '',
            file_no: overrides.file_no || '',
            voy_no: overrides.voy_no || '',
            place: overrides.place || '',
            plan_date: overrides.plan_date || today,
            report_date: overrides.report_date || today,
            reported_by: overrides.reported_by || '',
            reporter_username: overrides.reporter_username || '',
            reporter_name: overrides.reporter_name || '',
            maker: overrides.maker || '',
            model_type: overrides.model_type || '',
            capacity: overrides.capacity || '',
            serial_no: overrides.serial_no || '',
            last_maintenance_date: overrides.last_maintenance_date || '',
            rh_since_last_maintenance: overrides.rh_since_last_maintenance ?? '',
            total_run_hrs: overrides.total_run_hrs ?? '0',
            outline_work_permit: overrides.outline_work_permit || '',
            company_comment: overrides.company_comment || '',
            checked_estimated_spare_parts: overrides.checked_estimated_spare_parts === true,
            estimated_parts: Array.isArray(overrides.estimated_parts) ? overrides.estimated_parts : [],
            job_items: Array.isArray(overrides.job_items) ? overrides.job_items : [],
            confirmed_by: overrides.confirmed_by || '',
            confirmed_at: overrides.confirmed_at || '',
            approved_by: overrides.approved_by || '',
            approved_at: overrides.approved_at || '',
            hq_reply_exported_at: overrides.hq_reply_exported_at || null,
            status: overrides.status || Status.DRAFT,
            visible_in_list: overrides.visible_in_list !== false,
            sync_status: 'LOCAL',
            updated_at: new Date().toISOString(),
            created_at: overrides.created_at || new Date().toISOString(),
        };
    }

    function listWorkflowStatus(row) {
        if (row.approved_at || row.approved_by) return 'Approved';
        if (row.sync_status === 'SYNCED') return 'Submitted';
        if (row.confirmed_at || row.confirmed_by) return 'Confirmed';
        return 'Reported';
    }

    function isHqReplyExported(row) {
        if (!row) return false;
        if (row.hq_reply_exported_at) return true;
        return !!(row.hq_synced && (row.approved_at || row.approved_by) && row.sync_status === 'SYNCED');
    }

    function canModifyListWorkflow(row) {
        if (!row || row.approved_at || row.approved_by) return false;
        if (row.sync_status === 'SYNCED') return false;
        return true;
    }

    function canDeleteListWorkflow(row) {
        if (!row) return false;
        const user = typeof TVC_Auth !== 'undefined' ? TVC_Auth.getCurrentUser() : null;
        if (user && TVC_RBAC.isHqAccount(user) && row.hq_synced
            && (row.approved_at || row.approved_by) && row.sync_status !== 'SYNCED') {
            return true;
        }
        return canModifyListWorkflow(row);
    }

    function belongsToDepartment(row, dept) {
        if (!dept) return true;
        return String(row?.department || '').toUpperCase() === String(dept).toUpperCase();
    }

    return {
        SCHEMA_VERSION, Status, blank, listWorkflowStatus, isHqReplyExported,
        canModifyListWorkflow, canDeleteListWorkflow, belongsToDepartment,
    };
})();

/** 실행 환경 (file:// vs http:// vs Electron tvc-app://) */
const TVC_Env = (function () {
    function isElectronApp() {
        return typeof location !== 'undefined' && location.protocol === 'tvc-app:'
            || !!(typeof window !== 'undefined' && window.tvcElectron?.isElectron);
    }
    function isFileProtocol() {
        // Electron custom protocol is a secure app origin — not browser file://
        if (isElectronApp()) return false;
        return typeof location !== 'undefined' && location.protocol === 'file:';
    }
    function canFetchBundledAssets() {
        return !isFileProtocol();
    }
    const FILE_HINT =
        'index.html을 더블클릭(file://)으로 열면 재고 파일 자동 로드가 차단됩니다. ' +
        'Electron 설치본, START-TVC-PMS.bat, 또는 npm start → http://localhost:3000 으로 실행하세요.';
    return { isFileProtocol, canFetchBundledAssets, isElectronApp, FILE_HINT };
})();
