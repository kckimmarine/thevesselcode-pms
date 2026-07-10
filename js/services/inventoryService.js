/* THE VESSEL CODE — SPICS Inventory Service
 * 소비(Consumption) · 입고(Delivery) · 본사 Import Diff · inventory_history 기록
 */
const TVC_InventoryService = (function () {
    const now = () => new Date().toISOString();

    function operatorName(user) {
        if (!user) return '—';
        return TVC_RBAC.getRankLabel(user) || user.display_name || user.username || '—';
    }

    /** 부품 검색 (Part No / Name / Universal Code) */
    async function searchParts(query, limit = 25) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return [];
        const all = await TVC_DB.SparePart.listAll();
        return all.filter(s => {
            const hay = [
                s.makerPartNo, s.part_no, s.name,
                s.universalItemCode, s.universal_code, s.location, s.category,
            ].join(' ').toLowerCase();
            return hay.includes(q);
        }).slice(0, limit);
    }

    /**
     * inventory_history + spare_parts 동시 갱신 (트랜잭션)
     * @param {object} user
     * @param {Array<{ spare_part_id: string, qty: number, note?: string }>} lines
     * @param {{ tx_type: string, ref?: string, note?: string, forceOk?: boolean }} meta
     */
    async function applyStockTx(user, lines, meta) {
        const txType = meta.tx_type;
        const isConsumption = txType === TVC_INVENTORY_TX.CONSUMPTION;

        if (isConsumption) {
            TVC_RBAC.assert(user, TVC_RBAC.Action.DEDUCT_INVENTORY);
        } else if (txType === TVC_INVENTORY_TX.DELIVERY) {
            TVC_RBAC.assert(user, TVC_RBAC.Action.SUPPLY_PARTS);
        } else {
            TVC_RBAC.assert(user, TVC_RBAC.Action.MODIFY_INVENTORY);
        }

        const validLines = (lines || []).filter(l => l.spare_part_id && Number(l.qty) > 0);
        if (!validLines.length) {
            throw Object.assign(new Error('적용할 부품/수량이 없습니다.'), { code: 'EMPTY' });
        }

        return TVC_DB.runTransaction(['spare_parts', 'inventory_history', 'audit_logs'], async (api) => {
            const results = [];
            const ts = now();

            for (const line of validLines) {
                const qty = Math.floor(Number(line.qty) || 0);
                if (qty <= 0) continue;

                const row = await api.get('spare_parts', line.spare_part_id);
                if (!row) {
                    throw Object.assign(new Error(`부품을 찾을 수 없습니다: ${line.spare_part_id}`), { code: 'NOT_FOUND' });
                }

                const onHand = Number(row.qty_on_hand) || 0;
                if (isConsumption && onHand < qty && !meta.forceOk) {
                    throw Object.assign(
                        new Error(`재고 부족: ${row.part_no} (보유 ${onHand}, 요청 ${qty})`),
                        { code: 'STOCK', part: row.part_no }
                    );
                }

                const delta = isConsumption ? -qty : qty;
                row.qty_on_hand = isConsumption ? Math.max(0, onHand - qty) : onHand + qty;
                if (isConsumption) row.qty_working = (Number(row.qty_working) || 0) + qty;
                row.history = Array.isArray(row.history) ? row.history : [];
                row.history.push({
                    at: ts,
                    type: txType,
                    qty: delta,
                    ref: meta.ref || '',
                    note: line.note || meta.note || '',
                });
                row.sync_status = row.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (row.sync_status || 'LOCAL');
                row.updated_at = ts;
                await api.put('spare_parts', row);

                const histRow = {
                    at: ts,
                    date: ts.slice(0, 10),
                    time: ts.slice(11, 19),
                    tx_type: txType,
                    spare_part_id: row.id,
                    part_no: row.part_no || '',
                    part_name: row.name || '',
                    universal_code: row.universal_code || row.universal_item_code || '',
                    qty_delta: delta,
                    qty_after: row.qty_on_hand,
                    operator_id: user.id || '',
                    operator_name: operatorName(user),
                    department: user.department || row.category || '',
                    ref: meta.ref || '',
                    note: line.note || meta.note || '',
                    sync_status: 'LOCAL',
                    updated_at: ts,
                };
                await api.put('inventory_history', {
                    id: 'IH-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                    ...histRow,
                });

                results.push({
                    spare_part_id: row.id,
                    part_no: row.part_no,
                    qty,
                    qty_after: row.qty_on_hand,
                });
            }

            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `📦 [${txType}] ${results.length} items — ${operatorName(user)}`,
                sync_status: 'LOCAL',
            });

            return { tx_type: txType, count: results.length, lines: results, at: ts };
        });
    }

    /** 부품 사용(Consumption) — 재고 차감 + inventory_history */
    async function recordConsumption(user, lines, opts = {}) {
        return applyStockTx(user, lines, {
            tx_type: TVC_INVENTORY_TX.CONSUMPTION,
            ref: opts.ref || '',
            note: opts.note || '',
            forceOk: !!opts.forceOk,
        });
    }

    /** 입고(Delivery) — 재고 증가 + inventory_history */
    async function recordDelivery(user, lines, opts = {}) {
        return applyStockTx(user, lines, {
            tx_type: TVC_INVENTORY_TX.DELIVERY,
            ref: opts.ref || '',
            note: opts.note || '',
        });
    }

    /** 입출고 이력 조회 */
    async function getHistory(filters = {}) {
        if (filters.spare_part_id) {
            return TVC_DB.InventoryHistory.listBySpare(filters.spare_part_id, filters.limit || 50);
        }
        if (filters.tx_type) {
            return TVC_DB.InventoryHistory.listByType(filters.tx_type, filters.limit || 100);
        }
        return TVC_DB.InventoryHistory.listRecent(filters.limit || 100);
    }

    /**
     * 본사 JSON Import → 현재 DB Diff
     * @param {object} payload { spares?: [], meta?: {} }
     */
    async function diffHqImport(payload) {
        const incoming = Array.isArray(payload?.spares) ? payload.spares : (payload?.spare_parts || []);
        const local = await TVC_DB.SparePart.listAll();
        const byPartNo = new Map(local.map(s => [String(s.part_no || s.makerPartNo || '').toLowerCase(), s]));

        const diff = [];
        for (const inc of incoming) {
            const pn = String(inc.part_no || inc.makerPartNo || inc.inventory_numbering || '').toLowerCase();
            if (!pn) continue;
            const cur = byPartNo.get(pn);
            const incStock = Number(inc.qty_on_hand ?? inc.currentStock ?? 0);
            const curStock = cur ? TVC_Inventory.currentStock(cur) : 0;
            const incPrice = inc.price != null ? Number(inc.price) : null;
            const curPrice = cur?.price != null ? Number(cur.price) : null;

            if (!cur) {
                diff.push({ type: 'NEW', part_no: inc.part_no || inc.makerPartNo, name: inc.name, field: '—', before: '—', after: incStock });
            } else {
                if (incStock !== curStock) {
                    diff.push({ type: 'STOCK', part_no: cur.part_no, name: cur.name, field: 'Stock', before: curStock, after: incStock });
                }
                if (incPrice != null && incPrice !== curPrice) {
                    diff.push({ type: 'PRICE', part_no: cur.part_no, name: cur.name, field: 'Price', before: curPrice, after: incPrice });
                }
            }
        }

        return {
            summary: {
                total: diff.length,
                newItems: diff.filter(d => d.type === 'NEW').length,
                stockChanges: diff.filter(d => d.type === 'STOCK').length,
                priceChanges: diff.filter(d => d.type === 'PRICE').length,
            },
            diff,
            payload,
        };
    }

    /**
     * Assessment Result 적용 (Diff 승인 후)
     * @param {object} user
     * @param {object} assessment diffHqImport 결과
     */
    async function applyHqAssessment(user, assessment, opts = {}) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.IMPORT_HQ_SYNC);
        const payload = assessment.payload || assessment;
        const spares = Array.isArray(payload.spares) ? payload.spares : (payload.spare_parts || []);
        let updated = 0;

        for (const inc of spares) {
            const pn = inc.part_no || inc.makerPartNo;
            if (!pn) continue;
            const existing = await TVC_DB.SparePart.getByPartNo(pn);
            if (!existing) continue;

            const incStock = Number(inc.qty_on_hand ?? inc.currentStock);
            const curStock = TVC_Inventory.currentStock(existing);
            if (!Number.isNaN(incStock) && incStock !== curStock) {
                const delta = incStock - curStock;
                if (delta > 0) {
                    await TVC_DB.SparePart.addStock(existing.id, delta, { type: 'HQ_IMPORT', ref: 'HQ', note: opts.note || 'HQ Assessment' });
                } else if (delta < 0) {
                    await TVC_DB.SparePart.deductStock(existing.id, -delta, { type: 'HQ_IMPORT', ref: 'HQ', note: opts.note || 'HQ Assessment' });
                }
                const row = await TVC_DB.get('spare_parts', existing.id);
                await TVC_DB.InventoryHistory.append({
                    tx_type: TVC_INVENTORY_TX.IMPORT,
                    spare_part_id: existing.id,
                    part_no: row.part_no,
                    part_name: row.name,
                    universal_code: row.universal_code || '',
                    qty_delta: delta,
                    qty_after: row.qty_on_hand,
                    operator_id: user.id,
                    operator_name: operatorName(user),
                    department: user.department || '',
                    ref: 'HQ_IMPORT',
                    note: opts.note || 'HQ Assessment applied',
                });
                updated++;
            }
        }

        return { updated, total: spares.length };
    }

    return {
        searchParts,
        recordConsumption,
        recordDelivery,
        getHistory,
        diffHqImport,
        applyHqAssessment,
    };
})();
