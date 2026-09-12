/* THE VESSEL CODE — Supplier Portal workspace */
const TVC_SupplierWorkspace = (function () {
    const VIEWS = ['rfq', 'delivery', 'invoices', 'account'];

    let currentUser = null;
    let activeView = 'rfq';
    let activeRfqId = null;
    /** @type {object|null} RFQ row while quote drawer is open */
    let activeQuoteRfq = null;
    let activeQuoteAdhoc = false;

    function supplierId(user) {
        return String(user?.supplier_id || user?.id || '').trim();
    }

    function companyLabel(user) {
        return String(user?.company_name || user?.display_name || user?.username || 'Supplier').trim();
    }

    function el(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function todayIsoDate() {
        return new Date().toISOString().slice(0, 10);
    }

    function formatMoney(amount, currency) {
        const v = Number(amount);
        if (!Number.isFinite(v)) return '—';
        const cur = currency || 'USD';
        const digits = cur === 'KRW' ? 0 : 2;
        return `${cur} ${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
    }

    function parseInputNum(input) {
        const v = Number(input?.value);
        return Number.isFinite(v) ? v : 0;
    }

    function setActiveNav(view) {
        activeView = VIEWS.includes(view) ? view : 'rfq';
        document.querySelectorAll('#tvc-supplier-workspace .supplier-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.supplierView === activeView);
        });
        const pipeline = el('supplierPipeline');
        if (pipeline) {
            pipeline.querySelectorAll('[data-pipeline-step]').forEach((step, i) => {
                const stepViews = ['rfq', 'delivery', 'delivery', 'invoices'];
                const on = stepViews[i] === activeView || (activeView === 'rfq' && i === 0);
                step.classList.toggle('active', on);
            });
        }
    }

    function recalcLineRow(row) {
        if (!row) return { qty: 0, cost: 0, margin: 0, unit: 0, lineTotal: 0, lineProfit: 0, currency: 'USD' };
        const qty = Math.max(0, parseInputNum(row.querySelector('.supplier-quote-qty')) || parseFloat(row.dataset.qty) || 0);
        const cost = Math.max(0, parseInputNum(row.querySelector('.supplier-quote-cost')));
        const margin = parseInputNum(row.querySelector('.supplier-quote-margin'));
        const priceInput = row.querySelector('.supplier-quote-price');
        const currency = row.querySelector('.supplier-quote-currency')?.value || 'USD';
        const priceFromInput = parseInputNum(priceInput);
        const source = row.dataset.priceSource || 'margin';
        let unit = priceFromInput;

        if (source === 'margin' && cost > 0) {
            unit = cost * (1 + margin / 100);
            if (priceInput) priceInput.value = currency === 'KRW' ? String(Math.round(unit)) : unit.toFixed(2);
        } else if (source === 'price' && cost > 0 && unit > 0) {
            const m = ((unit - cost) / cost) * 100;
            const marginInput = row.querySelector('.supplier-quote-margin');
            if (marginInput) marginInput.value = Number.isFinite(m) ? m.toFixed(1) : '';
        }

        const lineTotal = unit * qty;
        const lineProfit = cost > 0 ? (unit - cost) * qty : 0;
        const totalEl = row.querySelector('.supplier-quote-line-total');
        const profitEl = row.querySelector('.supplier-quote-line-profit');
        if (totalEl) totalEl.textContent = `Line total: ${formatMoney(lineTotal, currency)}`;
        if (profitEl) {
            profitEl.textContent = cost > 0
                ? `Profit: ${formatMoney(lineProfit, currency)}`
                : 'Profit: — (enter cost)';
        }
        return { qty, cost, margin, unit, lineTotal, lineProfit, currency };
    }

    function recalcQuoteTotals() {
        const host = el('supplierQuoteDrawerBody');
        if (!host) return null;
        const byCur = {};
        let revenue = 0;
        let profit = 0;
        host.querySelectorAll('.supplier-quote-line').forEach(row => {
            const r = recalcLineRow(row);
            if (!byCur[r.currency]) byCur[r.currency] = { total: 0, profit: 0 };
            byCur[r.currency].total += r.lineTotal;
            byCur[r.currency].profit += r.lineProfit;
            revenue += r.lineTotal;
            profit += r.lineProfit;
        });
        const summary = el('supplierQuoteSummary');
        if (!summary) return { byCur, revenue, profit };
        const parts = Object.keys(byCur).sort().map(cur => {
            const { total, profit: p } = byCur[cur];
            const pct = total > 0 && p > 0 ? ((p / total) * 100).toFixed(1) : '—';
            return `<div class="supplier-quote-summary-row">
                <span>${esc(cur)} total</span><strong>${esc(formatMoney(total, cur))}</strong>
                <span class="muted">Margin ${esc(pct)}%</span>
            </div>`;
        });
        const overallPct = revenue > 0 && profit > 0 ? ((profit / revenue) * 100).toFixed(1) : '—';
        summary.innerHTML = `
            <h4 class="supplier-quote-summary-title">Quotation summary</h4>
            ${parts.join('') || '<p class="muted">Enter line prices to see totals.</p>'}
            <div class="supplier-quote-summary-overall">
                <span>Overall profit margin</span>
                <strong>${esc(overallPct)}%</strong>
            </div>`;
        return { byCur, revenue, profit };
    }

    function quoteLineInputs(rfq, adhoc) {
        const items = rfq.items || [];
        if (!items.length) {
            return '<p class="muted">No line items. Add a line below.</p>';
        }
        return items.map((it, idx) => {
            const lineId = it.line_id || idx + 1;
            const qty = it.qty ?? 1;
            const partBlock = adhoc
                ? `<div class="supplier-quote-adhoc-line-meta">
                    <label>Part No <input type="text" class="supplier-quote-part" value="${escAttr(it.part_no || '')}" maxlength="64"></label>
                    <label>Description <input type="text" class="supplier-quote-desc" value="${escAttr(it.description || '')}" maxlength="200"></label>
                    <label>Qty <input type="number" class="supplier-quote-qty" min="0" step="1" value="${esc(qty)}"></label>
                    <label>Unit <input type="text" class="supplier-quote-unit" value="${escAttr(it.unit || 'PCS')}" maxlength="12"></label>
                   </div>`
                : `<div class="supplier-quote-line-desc">
                    <strong>${esc(it.part_no || '—')}</strong> — ${esc(it.description)}
                    <span class="muted"> · Qty ${esc(qty)} ${esc(it.unit || 'PCS')}</span>
                   </div>`;
            return `<div class="supplier-quote-line" data-line-id="${esc(lineId)}" data-qty="${esc(qty)}" data-price-source="margin">
                ${partBlock}
                <div class="supplier-quote-line-fields">
                    <label class="supplier-quote-field">Currency
                        <select class="supplier-quote-currency" aria-label="Currency">
                            <option value="USD">USD</option><option value="KRW">KRW</option>
                        </select>
                    </label>
                    <label class="supplier-quote-field">Cost (base unit)
                        <input type="number" class="supplier-quote-cost" min="0" step="0.01" placeholder="0.00">
                    </label>
                    <label class="supplier-quote-field">Margin (%)
                        <input type="number" class="supplier-quote-margin" min="0" step="0.1" value="15" placeholder="15">
                    </label>
                    <label class="supplier-quote-field">Unit price (sell)
                        <input type="number" class="supplier-quote-price" min="0" step="0.01" placeholder="0.00">
                    </label>
                    <label class="supplier-quote-field">Lead time (days)
                        <input type="number" class="supplier-quote-lead" min="0" step="1" placeholder="14">
                    </label>
                    <label class="supplier-quote-field supplier-quote-field-wide">Genuine / OEM remark
                        <input type="text" class="supplier-quote-remark" maxlength="200" placeholder="OEM / alternate">
                    </label>
                </div>
                <div class="supplier-quote-line-stats">
                    <span class="supplier-quote-line-total muted">Line total: —</span>
                    <span class="supplier-quote-line-profit muted">Profit: —</span>
                </div>
            </div>`;
        }).join('');
    }

    function escAttr(s) {
        return esc(s).replace(/'/g, '&#39;');
    }

    function bindQuoteDrawerEvents(rfq, user) {
        const body = el('supplierQuoteDrawerBody');
        if (!body) return;
        body.querySelectorAll('.supplier-quote-line').forEach(row => {
            row.querySelector('.supplier-quote-cost')?.addEventListener('input', () => {
                row.dataset.priceSource = 'margin';
                recalcQuoteTotals();
            });
            row.querySelector('.supplier-quote-margin')?.addEventListener('input', () => {
                row.dataset.priceSource = 'margin';
                recalcQuoteTotals();
            });
            row.querySelector('.supplier-quote-price')?.addEventListener('input', () => {
                row.dataset.priceSource = 'price';
                recalcQuoteTotals();
            });
            row.querySelector('.supplier-quote-currency')?.addEventListener('change', () => recalcQuoteTotals());
            row.querySelector('.supplier-quote-qty')?.addEventListener('input', () => recalcQuoteTotals());
        });
        el('supplierQuoteDrawerClose')?.addEventListener('click', closeQuoteDrawer);
        el('supplierQuotePrintBtn')?.addEventListener('click', () => exportQuotationPrint(rfq, user));
        el('supplierQuoteAddLineBtn')?.addEventListener('click', () => addAdhocLine(rfq, user));
        const submitBtn = el('supplierQuoteSubmitBtn');
        if (submitBtn) {
            submitBtn.addEventListener('click', () => void submitQuote(rfq, user));
        }
        recalcQuoteTotals();
    }

    function syncAdhocItemsFromDom(rfq) {
        if (!activeQuoteAdhoc || !rfq) return;
        const items = [];
        document.querySelectorAll('#supplierQuoteDrawerBody .supplier-quote-line').forEach((row, idx) => {
            const qty = parseInputNum(row.querySelector('.supplier-quote-qty'));
            items.push({
                line_id: row.dataset.lineId || String(idx + 1),
                part_no: String(row.querySelector('.supplier-quote-part')?.value || '').trim(),
                description: String(row.querySelector('.supplier-quote-desc')?.value || '').trim(),
                qty: qty > 0 ? qty : 1,
                unit: String(row.querySelector('.supplier-quote-unit')?.value || 'PCS').trim() || 'PCS',
            });
        });
        if (items.length) rfq.items = items;
    }

    function addAdhocLine(rfq, user) {
        if (!activeQuoteAdhoc || !rfq) return;
        syncAdhocItemsFromDom(rfq);
        const items = rfq.items || [];
        items.push({
            line_id: String(items.length + 1),
            part_no: '',
            description: '',
            qty: 1,
            unit: 'PCS',
        });
        rfq.items = items;
        void openQuoteDrawer(null, user, { adhoc: true, rfq });
    }

    function renderQuoteDrawerContent(rfq, user, opts = {}) {
        const adhoc = !!opts.adhoc;
        const ref = rfq.sm_rfq_id || rfq.rfq_id || '—';
        const adhocMeta = adhoc
            ? `<div class="supplier-quote-adhoc-meta">
                <label>Quotation ref <input type="text" id="supplierQuoteAdhocRef" value="${escAttr(ref)}" maxlength="40"></label>
                <label>Vessel / Client <input type="text" id="supplierQuoteAdhocVessel" value="${escAttr(rfq.vessel_name || '')}" maxlength="120"></label>
                <label>Inquiry type <input type="text" id="supplierQuoteAdhocCategory" value="${escAttr(rfq.category || 'Spares')}" maxlength="60"></label>
               </div>`
            : '';
        return `
            <header class="supplier-quote-drawer-head">
                <h3>${adhoc ? 'Quick quotation' : esc(ref)}</h3>
                <p class="muted">${adhoc ? 'Enter inquiry details and line items for immediate export.' : `${esc(rfq.vessel_name)} · ${esc(rfq.category)} · Due ${esc(rfq.deadline || '—')}`}</p>
            </header>
            ${adhocMeta}
            <div class="supplier-quote-lines">${quoteLineInputs(rfq, adhoc)}</div>
            ${adhoc ? '<button type="button" class="btn btn-sm supplier-quote-add-line" id="supplierQuoteAddLineBtn">➕ Add line</button>' : ''}
            <div id="supplierQuoteSummary" class="supplier-quote-summary" aria-live="polite"></div>
            <div class="supplier-quote-drawer-actions">
                <button type="button" class="btn" id="supplierQuoteDrawerClose">Cancel</button>
                <button type="button" class="btn supplier-quote-print-btn" id="supplierQuotePrintBtn">🖨️ Export Quotation (PDF/Print)</button>
                ${adhoc ? '' : '<button type="button" class="btn btn-green" id="supplierQuoteSubmitBtn">📤 Submit Quotation</button>'}
            </div>`;
    }

    async function openQuoteDrawer(rfqId, user, options = {}) {
        let rfq = options.rfq || null;
        activeQuoteAdhoc = !!options.adhoc;
        if (!rfq && rfqId) {
            rfq = await TVC_DB.get('supplier_rfqs', rfqId).catch(() => null);
        }
        const drawer = el('supplierQuoteDrawer');
        const body = el('supplierQuoteDrawerBody');
        if (!drawer || !body || !rfq) return;
        activeRfqId = rfq.rfq_id || null;
        activeQuoteRfq = rfq;
        body.innerHTML = renderQuoteDrawerContent(rfq, user, options);
        drawer.classList.remove('hidden');
        bindQuoteDrawerEvents(rfq, user);
    }

    function openAdHocQuotation(user) {
        const stamp = todayIsoDate().replace(/-/g, '');
        const rfq = {
            rfq_id: null,
            sm_rfq_id: `QUO-${stamp}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
            vessel_name: '',
            category: 'Spares',
            deadline: '',
            items: [{ line_id: '1', part_no: '', description: '', qty: 1, unit: 'PCS' }],
        };
        void openQuoteDrawer(null, user, { adhoc: true, rfq });
    }

    function closeQuoteDrawer() {
        activeRfqId = null;
        activeQuoteRfq = null;
        activeQuoteAdhoc = false;
        el('supplierQuoteDrawer')?.classList.add('hidden');
    }

    function readAdhocMeta(rfq) {
        if (!activeQuoteAdhoc) return rfq;
        const ref = el('supplierQuoteAdhocRef')?.value?.trim();
        const vessel = el('supplierQuoteAdhocVessel')?.value?.trim();
        const cat = el('supplierQuoteAdhocCategory')?.value?.trim();
        return {
            ...rfq,
            sm_rfq_id: ref || rfq.sm_rfq_id,
            vessel_name: vessel || rfq.vessel_name,
            category: cat || rfq.category,
        };
    }

    function collectQuoteLinesFromDom(rfq) {
        const lines = [];
        let currency = 'USD';
        let leadDays = 0;
        const makerRemarks = [];
        const items = rfq.items || [];

        document.querySelectorAll('#supplierQuoteDrawerBody .supplier-quote-line').forEach((row, idx) => {
            const lineId = row.dataset.lineId;
            const cur = row.querySelector('.supplier-quote-currency')?.value || 'USD';
            currency = cur;
            const cost = parseInputNum(row.querySelector('.supplier-quote-cost'));
            const margin = parseInputNum(row.querySelector('.supplier-quote-margin'));
            const price = parseInputNum(row.querySelector('.supplier-quote-price'));
            const lead = parseInputNum(row.querySelector('.supplier-quote-lead'));
            const remark = String(row.querySelector('.supplier-quote-remark')?.value || '').trim();
            let qty = parseInputNum(row.querySelector('.supplier-quote-qty'));
            if (!qty) qty = parseFloat(row.dataset.qty) || 0;

            let partNo = '';
            let description = '';
            let unit = 'PCS';
            if (activeQuoteAdhoc) {
                partNo = String(row.querySelector('.supplier-quote-part')?.value || '').trim();
                description = String(row.querySelector('.supplier-quote-desc')?.value || '').trim();
                unit = String(row.querySelector('.supplier-quote-unit')?.value || 'PCS').trim();
            }

            if (Number.isFinite(lead) && lead > leadDays) leadDays = lead;
            if (remark) makerRemarks.push(remark);

            const item = items.find(it => String(it.line_id) === String(lineId)) || items[idx] || {};
            if (!activeQuoteAdhoc) {
                partNo = item.part_no;
                description = item.description;
                unit = item.unit;
                if (!qty) qty = item.qty ?? 1;
            }

            const calc = recalcLineRow(row);
            lines.push({
                line_id: lineId,
                part_no: partNo,
                description,
                qty,
                unit,
                unit_cost: cost > 0 ? cost : null,
                margin_pct: margin,
                unit_price: Number.isFinite(price) ? price : (calc.unit || null),
                line_total: calc.lineTotal,
                line_profit: calc.lineProfit,
                currency: cur,
                lead_time_days: Number.isFinite(lead) ? lead : null,
                maker_remark: remark,
            });
        });
        return { lines, currency, leadDays, makerRemarks };
    }

    function logoUrlForPrint() {
        try {
            return new URL('icons/company-logo.png', window.location.href).href;
        } catch (_) {
            return '/icons/company-logo.png';
        }
    }

    function buildPrintHtml(rfq, user, payload) {
        const { lines, currency, leadDays } = payload;
        const totals = payload.totals || recalcQuoteTotals() || { revenue: 0, profit: 0 };
        const overallPct = totals.revenue > 0 && totals.profit > 0
            ? ((totals.profit / totals.revenue) * 100).toFixed(1)
            : '—';
        const quoteDate = todayIsoDate();
        const ref = rfq.sm_rfq_id || rfq.rfq_id || '—';
        const rows = lines.map((ln, i) => `<tr>
            <td>${i + 1}</td>
            <td>${esc(ln.part_no || '—')}</td>
            <td>${esc(ln.description || '—')}</td>
            <td class="num">${esc(ln.qty)}</td>
            <td>${esc(ln.unit || 'PCS')}</td>
            <td class="num">${esc(formatMoney(ln.unit_price, ln.currency || currency))}</td>
            <td class="num">${esc(formatMoney(ln.line_total, ln.currency || currency))}</td>
            <td>${esc(ln.lead_time_days != null ? `${ln.lead_time_days} d` : '—')}</td>
            <td>${esc(ln.maker_remark || '—')}</td>
        </tr>`).join('');
        const grand = lines.reduce((s, ln) => s + (Number(ln.line_total) || 0), 0);

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>THE VESSEL CODE — Official Quotation ${esc(ref)}</title>
<style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #1a202c; margin: 0; padding: 0; font-size: 11pt; }
    .sheet { max-width: 210mm; margin: 0 auto; padding: 8mm 0; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a365d; padding-bottom: 12px; margin-bottom: 16px; }
    .brand img { width: 52px; height: 52px; object-fit: contain; }
    .brand h1 { margin: 0; font-size: 1.35rem; color: #1a365d; letter-spacing: 0.02em; }
    .brand p { margin: 4px 0 0; font-size: 0.85rem; color: #4a5568; }
    .meta { text-align: right; font-size: 0.9rem; }
    .meta dt { font-weight: 600; color: #2d3748; }
    .meta dd { margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.88rem; }
    th, td { border: 1px solid #cbd5e0; padding: 6px 8px; vertical-align: top; }
    th { background: #edf2f7; text-align: left; }
    td.num { text-align: right; white-space: nowrap; }
    .totals { margin-top: 16px; display: flex; justify-content: flex-end; }
    .totals-box { min-width: 240px; border: 2px solid #1a365d; padding: 12px 16px; border-radius: 6px; }
    .totals-box div { display: flex; justify-content: space-between; gap: 1rem; margin: 4px 0; }
    .totals-box strong { font-size: 1.1rem; }
    .foot { margin-top: 24px; font-size: 0.82rem; color: #718096; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
    }
</style>
</head>
<body>
<div class="sheet">
    <header class="head">
        <div class="brand">
            <img src="${esc(logoUrlForPrint())}" alt="">
            <h1>THE VESSEL CODE</h1>
            <p>Official Quotation · Maritime Supply &amp; Engineering</p>
        </div>
        <dl class="meta">
            <dt>Quotation No.</dt><dd>${esc(ref)}</dd>
            <dt>Date</dt><dd>${esc(quoteDate)}</dd>
            <dt>Supplier</dt><dd>${esc(companyLabel(user))}</dd>
            <dt>Vessel / Client</dt><dd>${esc(rfq.vessel_name || '—')}</dd>
            <dt>Max lead time</dt><dd>${leadDays ? `${esc(String(leadDays))} days` : '—'}</dd>
        </dl>
    </header>
    <p><strong>Inquiry:</strong> ${esc(rfq.category || 'Spares')} ${rfq.deadline ? `· Response by ${esc(rfq.deadline)}` : ''}</p>
    <table>
        <thead><tr>
            <th>#</th><th>Part No</th><th>Description</th><th>Qty</th><th>Unit</th>
            <th>Unit Price</th><th>Line Total</th><th>Lead</th><th>Remark</th>
        </tr></thead>
        <tbody>${rows}</tbody>
    </table>
    <div class="totals">
        <div class="totals-box">
            <div><span>Grand total (${esc(currency)})</span><strong>${esc(formatMoney(grand, currency))}</strong></div>
            <div><span>Profit margin</span><strong>${esc(overallPct)}%</strong></div>
        </div>
    </div>
    <footer class="foot">
        This quotation is valid for 14 days from the date shown unless otherwise agreed.
        THE VESSEL CODE (K-TECH) · Busan, Republic of Korea · thevesselcode.com
    </footer>
    <p class="no-print" style="margin-top:20px;text-align:center;">
        <button type="button" onclick="window.print()" style="padding:10px 20px;font-size:1rem;cursor:pointer;">Print / Save as PDF</button>
    </p>
</div>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });</script>
</body>
</html>`;
    }

    function exportQuotationPrint(rfq, user) {
        const metaRfq = readAdhocMeta(rfq);
        const collected = collectQuoteLinesFromDom(metaRfq);
        const totals = recalcQuoteTotals();
        if (!collected.lines.length) {
            void TVC_Dialog.alert('Add at least one line item with pricing before export.');
            return;
        }
        const html = buildPrintHtml(metaRfq, user, { ...collected, totals });
        const win = window.open('', '_blank', 'noopener,noreferrer');
        if (!win) {
            void TVC_Dialog.alert('Allow pop-ups to open the printable quotation.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
    }

    async function submitQuote(rfq, user) {
        if (!rfq?.rfq_id) {
            await TVC_Dialog.alert('Use Export Quotation for quick quotes. Submit is available for RFQs received from SM.');
            return;
        }
        const metaRfq = readAdhocMeta(rfq);
        const { lines, currency, leadDays, makerRemarks } = collectQuoteLinesFromDom(metaRfq);
        try {
            await TVC_SupplierRfqPipeline.submitQuotation(rfq.rfq_id, user, {
                currency,
                lines,
                lead_time_days: leadDays,
                maker_remarks: makerRemarks.join('; '),
            });
            closeQuoteDrawer();
            await TVC_Dialog.alert('Quotation submitted. SM will see status QUOTES_IN.');
            await renderRfqTable(user);
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function renderRfqTable(user) {
        const body = el('supplierRfqTableBody');
        if (!body) return;
        const rows = await TVC_SupplierRfqPipeline.listSupplierRfqsForSupplier(supplierId(user));
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="6" class="supplier-empty">No RFQs in inbox.</td></tr>';
            return;
        }
        body.innerHTML = rows.map(r => {
            const canQuote = r.status === TVC_SupplierRfqPipeline.SUPPLIER_RFQ_STATUS.RECEIVED;
            const action = canQuote
                ? `<button type="button" class="btn btn-sm btn-green supplier-quote-btn" data-rfq="${esc(r.rfq_id)}">Open / Quote</button>`
                : `<span class="muted">${esc(r.status)}</span>`;
            return `<tr data-rfq-row="${esc(r.rfq_id)}">
                <td>${esc(r.sm_rfq_id || r.rfq_id)}</td>
                <td>${esc(r.vessel_name)}</td>
                <td>${esc(r.inquiry_type || r.category)}</td>
                <td class="num">${esc(r.items_count ?? (r.items || []).length)}</td>
                <td>${esc(r.deadline)}</td>
                <td>${action}</td>
            </tr>`;
        }).join('');
        body.querySelectorAll('.supplier-quote-btn').forEach(btn => {
            btn.addEventListener('click', () => openQuoteDrawer(btn.dataset.rfq, user));
        });
    }

    async function renderDeliveryTable(user) {
        const body = el('supplierDeliveryTableBody');
        if (!body) return;
        const orders = await TVC_SupplierRfqPipeline.listOrdersForSupplier(supplierId(user));
        if (!orders.length) {
            body.innerHTML = '<tr><td colspan="5" class="supplier-empty">No purchase orders yet. Awards from SM unlock this step.</td></tr>';
            return;
        }
        body.innerHTML = orders.map(o => `<tr>
            <td>${esc(o.id)}</td>
            <td>${esc(o.sm_rfq_id)}</td>
            <td>${esc(o.vessel_name)}</td>
            <td>${esc(o.status)}</td>
            <td>${esc(o.lead_time_days)} days</td>
        </tr>`).join('');
    }

    function renderPlaceholder(view) {
        const main = el('supplierMainPane');
        if (!main) return;
        if (view === 'rfq') {
            main.innerHTML = `
                <div class="supplier-panel">
                    <div class="supplier-panel-toolbar">
                        <div>
                            <h2 class="supplier-panel-title">📥 RFQ Inbox</h2>
                            <p class="supplier-panel-sub muted">Live RFQs from Ship Management (SM) or build a quick quotation for industry inquiries.</p>
                        </div>
                        <button type="button" class="btn btn-green supplier-quick-quote-btn" id="supplierQuickQuoteBtn">➕ Quick quotation</button>
                    </div>
                    <div class="supplier-table-wrap">
                        <table class="supplier-table">
                            <thead><tr>
                                <th>RFQ No</th><th>Vessel</th><th>Inquiry Type</th>
                                <th>Items</th><th>Due Date</th><th>Action</th>
                            </tr></thead>
                            <tbody id="supplierRfqTableBody"></tbody>
                        </table>
                    </div>
                </div>`;
            return;
        }
        if (view === 'delivery') {
            main.innerHTML = `
                <div class="supplier-panel">
                    <h2 class="supplier-panel-title">📦 Delivery / Repair</h2>
                    <p class="supplier-panel-sub muted">Purchase orders issued after SM award.</p>
                    <div class="supplier-table-wrap">
                        <table class="supplier-table">
                            <thead><tr><th>PO No</th><th>RFQ</th><th>Vessel</th><th>Status</th><th>Lead time</th></tr></thead>
                            <tbody id="supplierDeliveryTableBody"></tbody>
                        </table>
                    </div>
                </div>`;
            return;
        }
        if (view === 'account' && currentUser) {
            const u = currentUser;
            const scopes = Array.isArray(u.business_scope) ? u.business_scope.join(', ') : '—';
            main.innerHTML = `
            <div class="supplier-panel">
                <h2 class="supplier-panel-title">⚙️ Account</h2>
                <dl class="supplier-account-dl">
                    <dt>Company</dt><dd>${esc(companyLabel(u))}</dd>
                    <dt>User ID</dt><dd>${esc(u.username || '—')}</dd>
                    <dt>Business Scope</dt><dd>${esc(scopes)}</dd>
                    <dt>Contact</dt><dd>${esc(u.contact_person || '—')}</dd>
                    <dt>Email</dt><dd>${esc(u.contact_email || '—')}</dd>
                    <dt>Service Ports</dt><dd>${esc(u.service_ports || '—')}</dd>
                </dl>
            </div>`;
            return;
        }
        main.innerHTML = `
            <div class="supplier-panel supplier-placeholder">
                <h2 class="supplier-panel-title">${esc(view === 'invoices' ? 'Invoices' : 'Section')}</h2>
                <p class="muted">Invoice workflow connects after delivery confirmation in a later release.</p>
            </div>`;
    }

    async function renderView(view) {
        setActiveNav(view);
        renderPlaceholder(view);
        if (!currentUser) return;
        if (view === 'rfq') await renderRfqTable(currentUser);
        if (view === 'delivery') await renderDeliveryTable(currentUser);
    }

    function bindNav() {
        const root = el('tvc-supplier-workspace');
        if (!root || root.dataset.navBound === '1') return;
        root.dataset.navBound = '1';
        root.querySelectorAll('.supplier-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                void renderView(btn.dataset.supplierView || 'rfq');
            });
        });
        el('supplierLogoutBtn')?.addEventListener('click', () => {
            if (typeof TVC_App !== 'undefined') TVC_App.handleLogout();
        });
        const drawer = el('supplierQuoteDrawer');
        if (drawer && drawer.dataset.backdropBound !== '1') {
            drawer.dataset.backdropBound = '1';
            drawer.addEventListener('click', (e) => {
                if (e.target === drawer) closeQuoteDrawer();
            });
        }
        const main = el('supplierMainPane');
        if (main && main.dataset.quoteToolbarBound !== '1') {
            main.dataset.quoteToolbarBound = '1';
            main.addEventListener('click', (e) => {
                if (e.target.closest('#supplierQuickQuoteBtn') && currentUser) {
                    openAdHocQuotation(currentUser);
                }
            });
        }
    }

    async function open(user) {
        currentUser = user;
        bindNav();
        const title = el('supplierPortalTitle');
        const sub = el('supplierCompanyName');
        if (title) title.textContent = 'SUPPLIER PORTAL';
        if (sub) sub.textContent = companyLabel(user);
        const badge = el('supplierUserBadge');
        if (badge) badge.textContent = companyLabel(user);
        const userIdLine = el('supplierUserIdLine');
        if (userIdLine) {
            const uid = String(user?.username || '').trim();
            userIdLine.textContent = uid ? `User ID: ${uid}` : '—';
        }
        closeQuoteDrawer();
        await renderView('rfq');
        try { location.hash = 'tvc-supplier-workspace'; } catch (_) {}
    }

    function close() {
        currentUser = null;
        closeQuoteDrawer();
        try {
            if (location.hash === '#tvc-supplier-workspace') location.hash = '';
        } catch (_) {}
    }

    return { open, close, renderView, openAdHocQuotation, exportQuotationPrint };
})();
if (typeof window !== 'undefined') window.TVC_SupplierWorkspace = TVC_SupplierWorkspace;
