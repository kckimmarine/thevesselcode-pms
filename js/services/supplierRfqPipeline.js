/* THE VESSEL CODE — SM ↔ Supplier RFQ / quote / PO pipeline (IndexedDB) */
const TVC_SupplierRfqPipeline = (function () {
    const META_SM_DEMO = 'sm_rfq_demo_seeded_v1';

    const SM_STATUS = {
        DRAFT: 'DRAFT',
        OUT_TO_VENDOR: 'OUT_TO_VENDOR',
        QUOTES_IN: 'QUOTES_IN',
        AWARDED: 'AWARDED',
    };

    const SUPPLIER_RFQ_STATUS = {
        RECEIVED: 'RECEIVED',
        QUOTED: 'QUOTED',
        AWARDED: 'AWARDED',
    };

    function nowIso() {
        return new Date().toISOString();
    }

    function supplierRfqKey(smRfqId, supplierId) {
        return `${String(smRfqId).trim()}@${String(supplierId).trim()}`;
    }

    function nextRfqId() {
        const y = new Date().getFullYear();
        const stamp = Date.now().toString(36).slice(-5).toUpperCase();
        return `RFQ-${y}-${stamp}`;
    }

    async function listSupplierProfiles() {
        const rows = await TVC_DB.getAll('supplier_profiles').catch(() => []);
        return rows.sort((a, b) => String(a.company_name).localeCompare(String(b.company_name)));
    }

    async function listSmCases() {
        const rows = await TVC_DB.getAll('sm_rfq_cases').catch(() => []);
        return rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    }

    async function getSmCase(rfqId) {
        return TVC_DB.get('sm_rfq_cases', rfqId).catch(() => null);
    }

    async function listQuotesForSmCase(smRfqId) {
        const all = await TVC_DB.getAll('supplier_quotes').catch(() => []);
        return all
            .filter(q => q.sm_rfq_id === smRfqId)
            .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    }

    async function listSupplierRfqsForSupplier(supplierId) {
        const sid = String(supplierId || '').trim();
        const rows = await TVC_DB.getAll('supplier_rfqs').catch(() => []);
        return rows
            .filter(r => r.supplier_id === sid)
            .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
    }

    async function listOrdersForSupplier(supplierId) {
        const sid = String(supplierId || '').trim();
        const rows = await TVC_DB.getAll('supplier_orders').catch(() => []);
        return rows
            .filter(r => r.supplier_id === sid)
            .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    }

    async function ensureSmDemoCases(user) {
        if (!user || !(TVC_RBAC.isSmAccount?.(user) || TVC_RBAC.isHqAccount(user))) return;
        const seeded = await TVC_DB.getMeta(META_SM_DEMO).catch(() => null);
        if (seeded) return;
        const existing = await listSmCases();
        if (existing.length) {
            try { await TVC_DB.setMeta(META_SM_DEMO, '1'); } catch (_) {}
            return;
        }
        const vesselName = 'INCHEON CHEMI';
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 7);
        const caseRow = {
            rfq_id: nextRfqId(),
            vessel_id: 'TVC No1',
            vessel_name: vesselName,
            category: 'Spare Parts',
            inquiry_type: 'Urgent supply',
            items: [
                { line_id: '1', description: 'Fuel filter element', part_no: 'FF-2201', qty: 4, unit: 'PCS' },
                { line_id: '2', description: 'Lube oil pump seal kit', part_no: 'SEAL-LOP-09', qty: 1, unit: 'SET' },
            ],
            status: SM_STATUS.DRAFT,
            response_deadline: deadline.toISOString().slice(0, 10),
            tossed_suppliers: [],
            company_id: user.company_id || 'TVC',
            sync_status: 'local',
            created_at: nowIso(),
            updated_at: nowIso(),
        };
        await TVC_DB.put('sm_rfq_cases', caseRow);
        try { await TVC_DB.setMeta(META_SM_DEMO, '1'); } catch (_) {}
    }

    async function tossToSupplier(smRfqId, supplierId, opts = {}) {
        const sm = await getSmCase(smRfqId);
        if (!sm) throw new Error('RFQ case not found.');
        const profile = await TVC_DB.get('supplier_profiles', supplierId).catch(() => null);
        if (!profile) throw new Error('Supplier profile not found.');

        const deadline = String(opts.deadline || sm.response_deadline || '').trim();
        if (!deadline) throw new Error('Response deadline is required.');

        const key = supplierRfqKey(smRfqId, supplierId);
        const row = {
            rfq_id: key,
            sm_rfq_id: smRfqId,
            supplier_id: supplierId,
            supplier_name: profile.company_name,
            vessel_name: sm.vessel_name,
            vessel_id: sm.vessel_id,
            category: sm.category,
            inquiry_type: sm.inquiry_type,
            items: (sm.items || []).map(it => ({ ...it })),
            items_count: (sm.items || []).length,
            deadline,
            status: SUPPLIER_RFQ_STATUS.RECEIVED,
            sync_status: 'local',
            updated_at: nowIso(),
        };
        await TVC_DB.put('supplier_rfqs', row);

        const tossed = Array.isArray(sm.tossed_suppliers) ? [...sm.tossed_suppliers] : [];
        if (!tossed.some(t => t.supplier_id === supplierId)) {
            tossed.push({
                supplier_id: supplierId,
                supplier_rfq_id: key,
                company_name: profile.company_name,
                at: nowIso(),
            });
        }
        await TVC_DB.put('sm_rfq_cases', {
            ...sm,
            status: SM_STATUS.OUT_TO_VENDOR,
            response_deadline: deadline,
            tossed_suppliers: tossed,
            updated_at: nowIso(),
        });
        return row;
    }

    async function submitQuotation(supplierRfqId, user, payload) {
        const rfq = await TVC_DB.get('supplier_rfqs', supplierRfqId).catch(() => null);
        if (!rfq) throw new Error('RFQ not found.');
        const sid = String(user?.supplier_id || '').trim();
        if (rfq.supplier_id !== sid) throw new Error('This RFQ is assigned to another supplier.');

        const lines = Array.isArray(payload?.lines) ? payload.lines : [];
        const quoteId = `Q-${supplierRfqId}-${Date.now()}`;
        const quote = {
            id: quoteId,
            rfq_id: supplierRfqId,
            sm_rfq_id: rfq.sm_rfq_id,
            supplier_id: sid,
            supplier_name: rfq.supplier_name || user.company_name,
            currency: payload.currency || 'USD',
            lines,
            lead_time_days: Math.max(0, Math.floor(Number(payload.lead_time_days) || 0)),
            maker_remarks: String(payload.maker_remarks || '').trim(),
            status: 'SUBMITTED',
            sync_status: 'local',
            updated_at: nowIso(),
        };
        await TVC_DB.put('supplier_quotes', quote);
        await TVC_DB.put('supplier_rfqs', {
            ...rfq,
            status: SUPPLIER_RFQ_STATUS.QUOTED,
            updated_at: nowIso(),
        });

        const sm = await getSmCase(rfq.sm_rfq_id);
        if (sm && sm.status !== SM_STATUS.AWARDED) {
            await TVC_DB.put('sm_rfq_cases', {
                ...sm,
                status: SM_STATUS.QUOTES_IN,
                updated_at: nowIso(),
            });
        }
        return quote;
    }

    async function awardPurchaseOrder(smRfqId, quoteId) {
        const sm = await getSmCase(smRfqId);
        if (!sm) throw new Error('RFQ case not found.');
        const quote = await TVC_DB.get('supplier_quotes', quoteId).catch(() => null);
        if (!quote || quote.sm_rfq_id !== smRfqId) throw new Error('Quote not found for this RFQ.');

        const orderId = `PO-${smRfqId}-${Date.now()}`;
        const order = {
            id: orderId,
            sm_rfq_id: smRfqId,
            rfq_id: quote.rfq_id,
            quote_id: quoteId,
            supplier_id: quote.supplier_id,
            supplier_name: quote.supplier_name,
            vessel_name: sm.vessel_name,
            vessel_id: sm.vessel_id,
            status: 'OPEN',
            delivery_step: 'DELIVERY_REPAIR',
            lines: quote.lines || [],
            lead_time_days: quote.lead_time_days,
            sync_status: 'local',
            created_at: nowIso(),
            updated_at: nowIso(),
        };
        await TVC_DB.put('supplier_orders', order);

        const supplierRfq = await TVC_DB.get('supplier_rfqs', quote.rfq_id).catch(() => null);
        if (supplierRfq) {
            await TVC_DB.put('supplier_rfqs', {
                ...supplierRfq,
                status: SUPPLIER_RFQ_STATUS.AWARDED,
                updated_at: nowIso(),
            });
        }

        await TVC_DB.put('sm_rfq_cases', {
            ...sm,
            status: SM_STATUS.AWARDED,
            awarded_quote_id: quoteId,
            awarded_supplier_id: quote.supplier_id,
            awarded_order_id: orderId,
            updated_at: nowIso(),
        });
        return order;
    }

    return {
        SM_STATUS,
        SUPPLIER_RFQ_STATUS,
        supplierRfqKey,
        nextRfqId,
        listSupplierProfiles,
        listSmCases,
        getSmCase,
        listQuotesForSmCase,
        listSupplierRfqsForSupplier,
        listOrdersForSupplier,
        ensureSmDemoCases,
        tossToSupplier,
        submitQuotation,
        awardPurchaseOrder,
    };
})();
if (typeof window !== 'undefined') window.TVC_SupplierRfqPipeline = TVC_SupplierRfqPipeline;
