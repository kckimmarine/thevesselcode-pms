/* THE VESSEL CODE — Inventory / BOM / Requisition Service
 *
 * 관계 모델 (js/core/schema.js 참조):
 *   Equipment(ship_components) 1 ── N MaintenanceTask(maintenance_jobs)
 *   MaintenanceTask N ── N SparePart(spare_parts)  via  job_bom (BOM)
 *   SparePart N ── 1 UniversalCatalog  via  spare_parts.universal_code
 *   Requisition 1 ── N lines(스냅샷) → SparePart 참조
 *
 * 설계 원칙:
 *   - spare_parts 의 현 재고 필드명은 기존 그대로(qty_on_hand) 유지한다.
 *     "Current Stock" == qty_on_hand,  "Standard Stock" == standard_stock(신규,옵션, 없으면 min_qty).
 *   - 재고 차감/복구는 TVC_Transaction(approveReport/deleteReport)이 단일 소유한다.
 *     본 서비스는 "무엇을 얼마나 차감할지(BOM)"와 "청구서(Requisition)"만 책임진다.
 */
const TVC_Inventory = (function () {
    const now = () => new Date().toISOString();
    const SCHEMA_VERSION = 1; // requisition/job_bom 레코드 버전 (향후 마이그레이션 기준점)

    function markPending(entity) {
        entity.sync_status = entity.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (entity.sync_status || 'LOCAL');
        entity.updated_at = now();
        return entity;
    }

    // ── Stock 판정 ────────────────────────────────────────────────────
    function norm(s) { return (s && s.makerPartNo != null) ? s : TVC_SpareSchema.fromRow(s); }
    /** 기준 재고: standard_stock 우선, 없으면 기존 min_qty 로 하위호환 */
    function standardStock(spare) {
        const s = norm(spare || {});
        return Number(s.standardStock != null ? s.standardStock : 0) || 0;
    }
    function currentStock(spare) {
        return Number(norm(spare || {}).currentStock || 0) || 0;
    }
    function minStock(spare) {
        const s = norm(spare || {});
        return Number(s.minStock != null ? s.minStock : (s.standardStock || 0)) || 0;
    }
    /** currentStock <= minStock 이면 저재(청구 필요) */
    function isLowStock(spare) {
        return currentStock(spare) <= minStock(spare);
    }
    /** 기준재고까지 채우기 위해 필요한 수량 (최소 1) */
    function recommendedOrderQty(spare) {
        const gap = minStock(spare) - currentStock(spare);
        return Math.max(gap, isLowStock(spare) ? 1 : 0);
    }
    function lowStockItems(spares) {
        return (spares || []).filter(isLowStock);
    }

    // ── Spare CRUD (Append / Modify / Delete) ─────────────────────────
    function universalCodeFor(name) {
        const key = String(name || 'UNSPEC').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
        let h = 0;
        for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
        return 'UNI-' + Math.abs(h).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
    }

    function blankSpare() {
        return {
            part_no: '', name: '', unit: 'EA',
            qty_on_hand: 0, min_qty: 0, standard_stock: 0,
            maker: '', model: '', universal_code: '', price: null, currency: 'USD',
            group: '', category: 'ENGINE', location: '',
        };
    }

    function spareAuthUser(user) {
        if (!user) return user;
        const role = user.role || (window.TVC_RBAC?.resolveUserRole?.(user));
        return role && role !== user.role ? { ...user, role } : user;
    }

    function assertSpareModify(user) {
        if (!window.TVC_RBAC) return;
        const u = spareAuthUser(user);
        if (!TVC_RBAC.canModifySpareInventory(u)) TVC_RBAC.assert(u, TVC_RBAC.Action.MODIFY_INVENTORY);
    }

    /** 부품 추가/수정. id 없으면 신규 생성. universal_code 없으면 이름 기반 자동 매핑. */
    async function saveSpare(user, spare) {
        assertSpareModify(user);
        if (!spare.part_no || !spare.name) throw Object.assign(new Error('Part No / Name 은 필수입니다.'), { code: 'VALIDATION' });

        const rec = { ...blankSpare(), ...spare };
        rec.id = rec.id || 'SP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        ['qty_on_hand', 'min_qty', 'standard_stock', 'qty_working'].forEach(k => { rec[k] = Number(rec[k]) || 0; });
        rec.price = (rec.price === '' || rec.price == null) ? null : Number(rec.price);
        if (!rec.universal_code) rec.universal_code = universalCodeFor(rec.name);

        // part_no 중복 방지 (자기 자신 제외)
        const all = await TVC_DB.getAll('spare_parts');
        if (all.some(s => s.id !== rec.id && (s.part_no || '').toLowerCase() === rec.part_no.toLowerCase())) {
            throw Object.assign(new Error(`Part No "${rec.part_no}" 는 이미 존재합니다.`), { code: 'DUP' });
        }

        markPending(rec);
        await TVC_DB.put('spare_parts', rec);

        // 공통코드 마스터 보강
        const cat = await TVC_DB.get('universal_catalog', rec.universal_code);
        if (!cat) {
            await TVC_DB.put('universal_catalog', {
                universal_code: rec.universal_code, description: rec.name,
                category: (rec.name || '').split(' ')[0] || 'GENERAL', standard_unit: rec.unit || 'EA',
                updated_at: now(), sync_status: 'LOCAL',
            });
        }
        return rec;
    }

    async function deleteSpare(user, id) {
        assertSpareModify(user);
        await TVC_DB.del('spare_parts', id);
        return true;
    }

    // ── BOM (job_bom) ─────────────────────────────────────────────────
    /** job_code 에 연결된 필요부품 목록 + 부품 스냅샷 반환 */
    async function getBom(jobCode) {
        if (!jobCode) return [];
        const links = await TVC_DB.indexGetAll('job_bom', 'by_job_code', jobCode);
        const out = [];
        for (const link of links) {
            const spare = link.spare_part_id ? await TVC_DB.get('spare_parts', link.spare_part_id) : null;
            out.push({ link, spare });
        }
        return out;
    }

    /** BOM 을 used_parts 형태로 변환 ({spare_part_id, qty_used}) — 작업완료 시 자동 차감용 */
    async function bomToUsedParts(jobCode) {
        const bom = await getBom(jobCode);
        return bom
            .filter(b => b.spare && (b.link.qty_per_job || 0) > 0)
            .map(b => ({ spare_part_id: b.spare.id, qty_used: Number(b.link.qty_per_job) || 0 }));
    }

    async function addBomLine(jobCode, sparePartId, qtyPerJob) {
        const rec = markPending({
            id: 'BOM-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            schema_version: SCHEMA_VERSION,
            job_code: jobCode,
            spare_part_id: sparePartId,
            qty_per_job: Number(qtyPerJob) || 0,
            created_at: now(),
        });
        await TVC_DB.put('job_bom', rec);
        return rec;
    }

    // ── Requisition ───────────────────────────────────────────────────
    const REQ_STATUS = {
        DRAFT: 'DRAFT',        // 선내 작성
        EXPORTED: 'EXPORTED',  // 업체에 엑셀 발송(가격/코멘트 요청)
        QUOTED: 'QUOTED',      // 업체 견적 회신 반영
        HQ_REVIEW: 'HQ_REVIEW',// 본사 검토(수량 조정)
        APPROVED: 'APPROVED',  // 본사 승인/발주 확정
    };

    async function nextReqNo(vesselId) {
        const all = await TVC_DB.getAll('requisitions');
        const ymd = now().slice(0, 10).replace(/-/g, '');
        const seq = all.filter(r => (r.req_no || '').includes(ymd)).length + 1;
        const v = (vesselId || 'SHIP').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        return `REQ-${v}-${ymd}-${String(seq).padStart(3, '0')}`;
    }

    function lineFromSpare(spare, qty) {
        const s = norm(spare);
        return {
            spare_part_id: s.id,
            part_no: s.makerPartNo || spare.part_no || '',
            universal_code: s.universalCode || spare.universal_code || '',
            name: s.name || '',
            unit: spare.unit || 'EA',
            maker: spare.maker || '',
            model: spare.model || '',
            qty_on_hand: currentStock(spare),
            standard_stock: standardStock(spare),
            qty_requested: Number(qty) || recommendedOrderQty(spare) || 1,
            qty_approved: null,   // 본사 조정 후 채워짐
            price: (spare.price != null ? spare.price : null),
            currency: spare.currency || 'USD',
            vendor_comment: '',
            hq_comment: '',
        };
    }

    /**
     * 청구서 생성.
     * @param user  현재 사용자
     * @param opts  { vesselId, department, spares:[spare], qtyMap:{id:qty} }
     *              spares 미지정 시 저재(low stock) 부품 전체로 자동 구성.
     */
    async function createRequisition(user, opts = {}) {
        if (window.TVC_RBAC) TVC_RBAC.assert(user, TVC_RBAC.Action.CREATE_REQUISITION);
        const vesselId = opts.vesselId || (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || 'SHIP';
        const allSpares = opts.spares && opts.spares.length ? opts.spares : lowStockItems(await TVC_DB.getAll('spare_parts'));
        if (!allSpares.length) throw Object.assign(new Error('NO_LOW_STOCK'), { code: 'EMPTY' });

        const qtyMap = opts.qtyMap || {};
        const lines = allSpares.map(s => lineFromSpare(s, qtyMap[s.id]));

        const req = markPending({
            id: 'REQ-' + Date.now(),
            schema_version: SCHEMA_VERSION,
            req_no: await nextReqNo(vesselId),
            vessel_id: vesselId,
            department: opts.department || user?.department || null,
            status: REQ_STATUS.DRAFT,
            created_at: now(),
            created_by: user?.id || null,
            creator_name: '',
            lines,
        });
        await TVC_DB.put('requisitions', req);
        return req;
    }

    async function getRequisition(id) { return TVC_DB.get('requisitions', id); }

    /** vesselId 로 필터 (HQ 는 선박 선택, 선박은 자기 vessel) */
    async function listRequisitions(vesselId) {
        const all = await TVC_DB.getAll('requisitions');
        const rows = vesselId ? all.filter(r => r.vessel_id === vesselId) : all;
        return rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }

    async function saveRequisition(req) {
        markPending(req);
        await TVC_DB.put('requisitions', req);
        return req;
    }

    async function setStatus(id, status) {
        const req = await getRequisition(id);
        if (!req) throw new Error('REQ_NOT_FOUND');
        req.status = status;
        return saveRequisition(req);
    }

    async function deleteRequisition(id) { return TVC_DB.del('requisitions', id); }

    /**
     * 업체 회신 반영: rows = [{ part_no, price, currency, vendor_comment }]
     * part_no 로 라인 매칭 → price / vendor_comment 갱신. 상태 QUOTED.
     */
    async function applyVendorQuote(reqId, rows) {
        const req = await getRequisition(reqId);
        if (!req) throw new Error('REQ_NOT_FOUND');
        const byPart = new Map(rows.map(r => [String(r.part_no).trim(), r]));
        let updated = 0;
        req.lines.forEach(l => {
            const r = byPart.get(String(l.part_no).trim());
            if (!r) return;
            if (r.price != null && r.price !== '') l.price = Number(r.price);
            if (r.currency) l.currency = r.currency;
            if (r.vendor_comment != null) l.vendor_comment = String(r.vendor_comment);
            updated++;
        });
        req.status = REQ_STATUS.QUOTED;
        await saveRequisition(req);
        return { updated, total: req.lines.length, req };
    }

    /**
     * 본사 조정 반영: rows = [{ part_no, qty_approved, hq_comment }]
     * qty_approved / hq_comment 갱신. 상태 APPROVED. (선박 재업로드 시 로컬 DB 즉시 갱신)
     */
    async function applyHqAdjustment(reqId, rows) {
        const req = await getRequisition(reqId);
        if (!req) throw new Error('REQ_NOT_FOUND');
        const byPart = new Map(rows.map(r => [String(r.part_no).trim(), r]));
        let updated = 0;
        req.lines.forEach(l => {
            const r = byPart.get(String(l.part_no).trim());
            if (!r) return;
            if (r.qty_approved != null && r.qty_approved !== '') l.qty_approved = Number(r.qty_approved);
            if (r.hq_comment != null) l.hq_comment = String(r.hq_comment);
            if (r.price != null && r.price !== '') l.price = Number(r.price);
            updated++;
        });
        req.status = REQ_STATUS.APPROVED;
        await saveRequisition(req);
        return { updated, total: req.lines.length, req };
    }

    /** 엑셀 회신 → spare_parts DB (price, comment, stock 입고) */
    async function applyExcelImport(rows, ref) {
        let updated = 0;
        for (const r of rows) {
            const patch = {
                price: r.price,
                currency: r.currency,
                vendor_comment: r.vendor_comment,
                ref: ref || 'EXCEL_IMPORT',
            };
            if (r.qty_received != null && r.qty_received > 0) patch.qty_received = r.qty_received;
            const res = await TVC_DB.SparePart.applyVendorUpdate(r.part_no, patch);
            if (res) updated++;
        }
        return { updated, total: rows.length };
    }

    async function listConsumeLogs(vesselId) {
        await TVC_DB.open();
        const all = await TVC_DB.getAll('consume_logs');
        return all
            .filter(l => !vesselId || !l.vessel_id || l.vessel_id === vesselId)
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }

    async function getConsumeLog(id) { return TVC_DB.get('consume_logs', id); }

    async function saveConsumeLog(log) {
        await TVC_DB.open();
        const ts = new Date().toISOString();
        const row = {
            ...log,
            updated_at: ts,
            sync_status: log.sync_status || 'LOCAL',
        };
        if (!row.created_at) row.created_at = ts;
        if (!row.id) row.id = 'CL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        await TVC_DB.put('consume_logs', row);
        return row;
    }

    async function deleteConsumeLog(id) { return TVC_DB.del('consume_logs', id); }

    return {
        SCHEMA_VERSION, REQ_STATUS,
        standardStock, minStock, currentStock, isLowStock, recommendedOrderQty, lowStockItems,
        blankSpare, saveSpare, deleteSpare, universalCodeFor,
        getBom, bomToUsedParts, addBomLine,
        nextReqNo, createRequisition, getRequisition, listRequisitions, saveRequisition,
        setStatus, deleteRequisition, applyVendorQuote, applyHqAdjustment, applyExcelImport,
        listConsumeLogs, getConsumeLog, saveConsumeLog, deleteConsumeLog,
    };
})();
