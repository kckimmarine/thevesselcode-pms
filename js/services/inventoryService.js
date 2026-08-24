/* THE VESSEL CODE — SPICS Inventory Service
 * 재고 변경 단일入口 — spare_parts.qty_on_hand + inventory_history
 */
const TVC_InventoryService = (function () {
    const now = () => new Date().toISOString();

    function operatorName(user) {
        if (!user) return '—';
        return TVC_RBAC.getRankLabel(user) || user.display_name || user.username || '—';
    }

    function normalizePartLines(lines) {
        const map = new Map();
        for (const l of lines || []) {
            const id = String(l.spare_part_id || l.sparePartId || '').trim();
            const qty = Math.floor(Number(l.qty ?? l.qty_used ?? l.qty_consumed) || 0);
            if (!id || qty <= 0) continue;
            map.set(id, (map.get(id) || 0) + qty);
        }
        return map;
    }

    function linesFromMap(map) {
        return [...map.entries()].map(([spare_part_id, qty]) => ({ spare_part_id, qty }));
    }

    function assertStockPermission(user, txType, skipRbac) {
        if (skipRbac) return;
        if (txType === TVC_INVENTORY_TX.CONSUMPTION) {
            TVC_RBAC.assert(user, TVC_RBAC.Action.DEDUCT_INVENTORY);
        } else if (txType === TVC_INVENTORY_TX.DELIVERY) {
            TVC_RBAC.assert(user, TVC_RBAC.Action.SUPPLY_PARTS);
        } else {
            TVC_RBAC.assert(user, TVC_RBAC.Action.MODIFY_INVENTORY);
        }
    }

    function lowStockAlert(spare, ref) {
        const minS = Number(spare.min_qty ?? spare.standard_stock ?? 0) || 0;
        if ((Number(spare.qty_on_hand) || 0) >= minS) return null;
        return {
            sparePartId: spare.id,
            partNo: spare.part_no,
            name: spare.name,
            stock: spare.qty_on_hand,
            minStock: minS,
            jobCode: ref || '',
        };
    }

    function dispatchLowStockAlerts(alerts, ref) {
        if (!alerts.length || typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent('tvc:spics-requisition-suggest', {
            detail: { alerts, jobCode: ref || '' },
        }));
    }

    /**
     * @param {object} api — IndexedDB transaction api
     * @param {object} user
     * @param {Array<{ spare_part_id: string, qty: number, note?: string }>} lines
     */
    async function applyStockTxApi(api, user, lines, meta = {}) {
        const txType = meta.tx_type;
        const isConsumption = txType === TVC_INVENTORY_TX.CONSUMPTION;
        const isReversal = txType === TVC_INVENTORY_TX.REVERSAL;
        const isDelivery = txType === TVC_INVENTORY_TX.DELIVERY;

        const validLines = (lines || []).filter(l => l.spare_part_id && Number(l.qty) > 0);
        if (!validLines.length) {
            return { tx_type: txType, count: 0, lines: [], at: now(), alerts: [] };
        }

        const results = [];
        const alerts = [];
        const ts = now();

        for (const line of validLines) {
            const qty = Math.floor(Number(line.qty) || 0);
            if (qty <= 0) continue;

            const row = await api.get('spare_parts', line.spare_part_id);
            if (!row) {
                throw Object.assign(new Error(`Part not found: ${line.spare_part_id}`), { code: 'NOT_FOUND' });
            }

            const onHand = Number(row.qty_on_hand) || 0;
            if (isConsumption && onHand < qty && !meta.forceOk) {
                const partNo = row.part_no || line.part_no || line.spare_part_id;
                throw Object.assign(
                    new Error(`Insufficient stock: ${partNo} (on hand ${onHand}, requested ${qty})`),
                    { code: 'STOCK', part: partNo, onHand, requested: qty }
                );
            }

            let delta;
            if (isConsumption) {
                delta = -qty;
                row.qty_on_hand = Math.max(0, onHand - qty);
            } else if (isReversal) {
                delta = qty;
                row.qty_on_hand = onHand + qty;
            } else {
                delta = qty;
                row.qty_on_hand = onHand + qty;
            }

            row.history = Array.isArray(row.history) ? row.history : [];
            row.history.push({
                at: ts,
                type: txType,
                qty: delta,
                ref: meta.ref || '',
                source_id: meta.source_id || '',
                source_type: meta.source_type || '',
                note: line.note || meta.note || '',
            });
            row.sync_status = row.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (row.sync_status || 'LOCAL');
            row.updated_at = ts;
            await api.put('spare_parts', row);

            await api.put('inventory_history', {
                id: 'IH-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
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
                operator_id: user?.id || '',
                operator_name: operatorName(user),
                department: user?.department || row.category || '',
                ref: meta.ref || '',
                source_id: meta.source_id || '',
                source_type: meta.source_type || '',
                note: line.note || meta.note || '',
                sync_status: 'LOCAL',
                updated_at: ts,
            });

            results.push({
                spare_part_id: row.id,
                part_no: row.part_no,
                qty,
                qty_after: row.qty_on_hand,
            });

            if (isConsumption) {
                const alert = lowStockAlert(row, meta.ref);
                if (alert) alerts.push(alert);
            }
        }

        if (results.length && !meta.skipAudit) {
            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `📦 [${txType}] ${results.length} items — ${operatorName(user)}`,
                sync_status: 'LOCAL',
            });
        }

        return { tx_type: txType, count: results.length, lines: results, at: ts, alerts };
    }

    /** Standalone transaction wrapper */
    async function applyStockTx(user, lines, meta = {}) {
        assertStockPermission(user, meta.tx_type, meta.skipRbac);
        const validLines = (lines || []).filter(l => l.spare_part_id && Number(l.qty) > 0);
        if (!validLines.length) {
            throw Object.assign(new Error('No parts or quantities to apply.'), { code: 'EMPTY' });
        }
        return TVC_DB.runTransaction(['spare_parts', 'inventory_history', 'audit_logs'], async (api) => {
            const res = await applyStockTxApi(api, user, validLines, meta);
            if (res.alerts?.length) dispatchLowStockAlerts(res.alerts, meta.ref);
            return res;
        });
    }

    async function recordConsumption(user, lines, opts = {}) {
        return applyStockTx(user, lines, {
            tx_type: TVC_INVENTORY_TX.CONSUMPTION,
            ref: opts.ref || '',
            note: opts.note || '',
            forceOk: !!opts.forceOk,
            source_id: opts.source_id || '',
            source_type: opts.source_type || 'consume_log',
            skipRbac: !!opts.skipRbac,
        });
    }

    async function recordDelivery(user, lines, opts = {}) {
        return applyStockTx(user, lines, {
            tx_type: TVC_INVENTORY_TX.DELIVERY,
            ref: opts.ref || '',
            note: opts.note || '',
            source_id: opts.source_id || '',
            source_type: opts.source_type || 'received',
        });
    }

    async function recordReversal(user, lines, opts = {}) {
        return applyStockTx(user, lines, {
            tx_type: TVC_INVENTORY_TX.REVERSAL,
            ref: opts.ref || '',
            note: opts.note || 'Stock reversal',
            source_id: opts.source_id || '',
            source_type: opts.source_type || 'reversal',
            skipRbac: !!opts.skipRbac,
        });
    }

    /** Work Report Confirm — used_parts 차감 (transaction 내부) */
    async function deductTaskPartsApi(api, user, requiredParts, opts = {}) {
        const lines = linesFromMap(normalizePartLines(
            (requiredParts || []).map(l => ({
                spare_part_id: l.spare_part_id || l.sparePartId,
                qty: l.qty_used ?? l.qty,
            }))
        ));
        if (!lines.length) return { alerts: [], deducted: 0 };
        const res = await applyStockTxApi(api, user, lines, {
            tx_type: TVC_INVENTORY_TX.CONSUMPTION,
            ref: opts.ref || '',
            note: opts.note || 'Work Report confirmed',
            forceOk: !!opts.forceOk,
            source_id: opts.source_id || '',
            source_type: opts.source_type || 'work_report',
            skipRbac: true,
            skipAudit: opts.skipAudit,
        });
        if (res.alerts?.length) dispatchLowStockAlerts(res.alerts, opts.ref);
        return { alerts: res.alerts || [], deducted: res.count || 0 };
    }

    async function deductTaskPartsBatchApi(api, user, tasks, opts = {}) {
        const allAlerts = [];
        let totalDeducted = 0;
        for (const task of tasks || []) {
            if (!task?.job) continue;
            const parts = task.usedParts || task.requiredParts || [];
            const { alerts, deducted } = await deductTaskPartsApi(api, user, parts, {
                ...opts,
                ref: task.job.job_code,
                skipAudit: true,
            });
            if (alerts?.length) allAlerts.push(...alerts);
            totalDeducted += deducted || 0;
        }
        if (totalDeducted > 0 && !opts.skipAudit) {
            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `📦 [TASK_CONFIRM] ${totalDeducted} items — ${operatorName(user)}`,
                sync_status: 'LOCAL',
            });
        }
        return { alerts: allAlerts, deducted: totalDeducted };
    }

    async function reverseTaskPartsApi(api, user, usedParts, opts = {}) {
        const lines = linesFromMap(normalizePartLines(
            (usedParts || []).map(l => ({
                spare_part_id: l.spare_part_id,
                qty: l.qty_used ?? l.qty,
            }))
        ));
        if (!lines.length) return { count: 0 };
        return applyStockTxApi(api, user, lines, {
            tx_type: TVC_INVENTORY_TX.REVERSAL,
            ref: opts.ref || '',
            note: opts.note || 'Work Report rollback',
            source_id: opts.source_id || '',
            source_type: opts.source_type || 'work_report',
            skipRbac: true,
        });
    }

    /** SPARE Requisition Received 수정 — 이전/신규 입고 수량 diff 반영 */
    async function applyDeliveryDiff(user, prevLines, nextLines, opts = {}) {
        const prev = normalizePartLines(prevLines);
        const next = normalizePartLines(nextLines);
        const ids = new Set([...prev.keys(), ...next.keys()]);
        const deliveryLines = [];
        const reverseLines = [];
        for (const id of ids) {
            const d = (next.get(id) || 0) - (prev.get(id) || 0);
            if (d > 0) deliveryLines.push({ spare_part_id: id, qty: d });
            else if (d < 0) reverseLines.push({ spare_part_id: id, qty: -d });
        }
        if (!deliveryLines.length && !reverseLines.length) {
            return { count: 0 };
        }
        return TVC_DB.runTransaction(['spare_parts', 'inventory_history', 'audit_logs'], async (api) => {
            let count = 0;
            const baseMeta = {
                ref: opts.ref || '',
                note: opts.note || 'Requisition received updated',
                source_id: opts.source_id || '',
                source_type: opts.source_type || 'requisition',
                skipRbac: true,
            };
            if (reverseLines.length) {
                const r = await applyStockTxApi(api, user, reverseLines, {
                    ...baseMeta,
                    tx_type: TVC_INVENTORY_TX.REVERSAL,
                    note: opts.note || 'Requisition received qty reduced',
                });
                count += r.count || 0;
            }
            if (deliveryLines.length) {
                const r = await applyStockTxApi(api, user, deliveryLines, {
                    ...baseMeta,
                    tx_type: TVC_INVENTORY_TX.DELIVERY,
                    note: opts.note || 'Requisition received qty increased',
                });
                count += r.count || 0;
            }
            if (count > 0) {
                await api.put('audit_logs', {
                    timestamp: new Date().toLocaleString(),
                    log: `📦 [RECEIVED_DIFF] ${count} items — ${operatorName(user)}`,
                    sync_status: 'LOCAL',
                });
            }
            return { count };
        });
    }

    /** SPARE Consumed log 수정 — 이전/신규 수량 diff 반영 */
    async function applyConsumptionDiff(user, prevLines, nextLines, opts = {}) {
        const prev = normalizePartLines(prevLines);
        const next = normalizePartLines(nextLines);
        const ids = new Set([...prev.keys(), ...next.keys()]);
        const consumeLines = [];
        const reverseLines = [];
        for (const id of ids) {
            const d = (next.get(id) || 0) - (prev.get(id) || 0);
            if (d > 0) consumeLines.push({ spare_part_id: id, qty: d });
            else if (d < 0) reverseLines.push({ spare_part_id: id, qty: -d });
        }
        if (!consumeLines.length && !reverseLines.length) {
            return { count: 0 };
        }
        return TVC_DB.runTransaction(['spare_parts', 'inventory_history', 'audit_logs'], async (api) => {
            let count = 0;
            const baseMeta = {
                ref: opts.ref || '',
                note: opts.note || 'Consumed log updated',
                source_id: opts.source_id || '',
                source_type: opts.source_type || 'consume_log',
                skipRbac: true,
            };
            if (reverseLines.length) {
                const r = await applyStockTxApi(api, user, reverseLines, {
                    ...baseMeta,
                    tx_type: TVC_INVENTORY_TX.REVERSAL,
                    note: opts.note || 'Consumed log qty reduced',
                });
                count += r.count || 0;
            }
            if (consumeLines.length) {
                const r = await applyStockTxApi(api, user, consumeLines, {
                    ...baseMeta,
                    tx_type: TVC_INVENTORY_TX.CONSUMPTION,
                    forceOk: !!opts.forceOk,
                    note: opts.note || 'Consumed log qty increased',
                });
                if (r.alerts?.length) dispatchLowStockAlerts(r.alerts, opts.ref);
                count += r.count || 0;
            }
            if (count > 0) {
                await api.put('audit_logs', {
                    timestamp: new Date().toLocaleString(),
                    log: `📦 [CONSUME_DIFF] ${count} items — ${operatorName(user)}`,
                    sync_status: 'LOCAL',
                });
            }
            return { count };
        });
    }

    async function reverseConsumption(user, lines, opts = {}) {
        const normalized = linesFromMap(normalizePartLines(lines));
        if (!normalized.length) return { count: 0 };
        const res = await recordReversal(user, normalized, opts);
        return { count: res.count || 0 };
    }

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

    async function getHistory(filters = {}) {
        if (filters.spare_part_id) {
            return TVC_DB.InventoryHistory.listBySpare(filters.spare_part_id, filters.limit || 50);
        }
        if (filters.tx_type) {
            return TVC_DB.InventoryHistory.listByType(filters.tx_type, filters.limit || 100);
        }
        return TVC_DB.InventoryHistory.listRecent(filters.limit || 100);
    }

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
                    source_type: 'hq_import',
                    note: opts.note || 'HQ Assessment applied',
                });
                updated++;
            }
        }

        return { updated, total: spares.length };
    }

    return {
        searchParts,
        applyStockTxApi,
        applyStockTx,
        recordConsumption,
        recordDelivery,
        recordReversal,
        deductTaskPartsApi,
        deductTaskPartsBatchApi,
        reverseTaskPartsApi,
        applyConsumptionDiff,
        applyDeliveryDiff,
        reverseConsumption,
        normalizePartLines,
        getHistory,
        diffHqImport,
        applyHqAssessment,
    };
})();
