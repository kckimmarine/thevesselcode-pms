/* THE VESSEL CODE — SM Mode RFQ case workspace */
const TVC_RfqWorkspace = (function () {
    const MODAL_ID = 'smRfqWorkspaceModal';
    let currentUser = null;
    let selectedCaseId = null;

    function el(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmtMoney(n, cur) {
        const v = Number(n);
        if (!Number.isFinite(v)) return '—';
        return `${cur || 'USD'} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    async function renderCaseList() {
        const host = el('smRfqCaseList');
        if (!host) return;
        const cases = await TVC_SupplierRfqPipeline.listSmCases();
        if (!cases.length) {
            host.innerHTML = '<p class="muted">No RFQ cases yet.</p>';
            return;
        }
        host.innerHTML = cases.map(c => {
            const active = c.rfq_id === selectedCaseId ? ' active' : '';
            return `<button type="button" class="sm-rfq-case-btn${active}" data-rfq-id="${esc(c.rfq_id)}">
                <span class="sm-rfq-case-id">${esc(c.rfq_id)}</span>
                <span class="sm-rfq-case-meta">${esc(c.vessel_name)} · ${esc(c.status)}</span>
            </button>`;
        }).join('');
        host.querySelectorAll('.sm-rfq-case-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedCaseId = btn.dataset.rfqId;
                void renderCaseDetail();
                void renderCaseList();
            });
        });
    }

    function renderItemsTable(items) {
        if (!items?.length) return '<p class="muted">No line items.</p>';
        const rows = items.map(it => `<tr>
            <td>${esc(it.part_no || '—')}</td>
            <td>${esc(it.description)}</td>
            <td class="num">${esc(it.qty)}</td>
            <td>${esc(it.unit || 'PCS')}</td>
        </tr>`).join('');
        return `<table class="supplier-table sm-rfq-items-table">
            <thead><tr><th>Part No</th><th>Description</th><th>Qty</th><th>Unit</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    async function renderQuotesSummary(smRfqId) {
        const quotes = await TVC_SupplierRfqPipeline.listQuotesForSmCase(smRfqId);
        if (!quotes.length) return '<p class="muted">No supplier quotes received yet.</p>';
        const rows = quotes.map(q => {
            const total = (q.lines || []).reduce((sum, ln) => {
                const p = Number(ln.unit_price);
                const qty = Number(ln.qty) || 1;
                return sum + (Number.isFinite(p) ? p * qty : 0);
            }, 0);
            return `<tr>
                <td>${esc(q.supplier_name || q.supplier_id)}</td>
                <td>${esc(q.lead_time_days)} days</td>
                <td class="num">${esc(fmtMoney(total, q.currency))}</td>
                <td>${esc(q.maker_remarks || '—')}</td>
                <td><button type="button" class="btn btn-sm btn-green sm-rfq-award-btn" data-quote-id="${esc(q.id)}">🏆 Award / Issue PO</button></td>
            </tr>`;
        }).join('');
        return `<table class="supplier-table sm-rfq-quotes-table">
            <thead><tr><th>Supplier</th><th>Lead time</th><th>Est. total</th><th>Maker / remark</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    async function renderCaseDetail() {
        const host = el('smRfqCaseDetail');
        if (!host) return;
        if (!selectedCaseId) {
            host.innerHTML = '<p class="muted">Select an RFQ case.</p>';
            return;
        }
        const c = await TVC_SupplierRfqPipeline.getSmCase(selectedCaseId);
        if (!c) {
            host.innerHTML = '<p class="muted">Case not found.</p>';
            return;
        }
        const canToss = c.status === TVC_SupplierRfqPipeline.SM_STATUS.DRAFT
            || c.status === TVC_SupplierRfqPipeline.SM_STATUS.OUT_TO_VENDOR
            || c.status === TVC_SupplierRfqPipeline.SM_STATUS.QUOTES_IN;
        const tossBtn = canToss
            ? `<button type="button" class="btn btn-green" id="smRfqTossBtn">🚀 Toss to Supplier</button>`
            : '';
        const tossed = (c.tossed_suppliers || []).map(t => esc(t.company_name || t.supplier_id)).join(', ') || '—';

        host.innerHTML = `
            <header class="sm-rfq-detail-head">
                <h3>${esc(c.rfq_id)}</h3>
                <span class="sm-rfq-status-pill">${esc(c.status)}</span>
            </header>
            <p class="sm-rfq-detail-meta"><b>Vessel:</b> ${esc(c.vessel_name)} · <b>Category:</b> ${esc(c.category)} · <b>Due:</b> ${esc(c.response_deadline || '—')}</p>
            <p class="muted sm-rfq-tossed">Sent to suppliers: ${tossed}</p>
            <h4>Line items</h4>
            ${renderItemsTable(c.items)}
            <div class="sm-rfq-detail-actions">${tossBtn}</div>
            <h4>Supplier quotes</h4>
            <div id="smRfqQuotesHost"></div>`;

        const quotesHost = el('smRfqQuotesHost');
        if (quotesHost) quotesHost.innerHTML = await renderQuotesSummary(c.rfq_id);

        el('smRfqTossBtn')?.addEventListener('click', () => openTossModal(c));
        host.querySelectorAll('.sm-rfq-award-btn').forEach(btn => {
            btn.addEventListener('click', () => void awardQuote(btn.dataset.quoteId));
        });
    }

    async function awardQuote(quoteId) {
        if (!selectedCaseId) return;
        const ok = await TVC_Dialog.confirm('Award this quote and issue a purchase order to the supplier?');
        if (!ok) return;
        try {
            await TVC_SupplierRfqPipeline.awardPurchaseOrder(selectedCaseId, quoteId);
            await TVC_Dialog.alert('PO issued. Supplier Delivery / Repair step is now unlocked.');
            await renderCaseDetail();
            await renderCaseList();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function openTossModal(caseRow) {
        const modal = el('smRfqTossModal');
        if (!modal) return;
        const sel = el('smRfqTossSupplier');
        const deadline = el('smRfqTossDeadline');
        if (deadline) deadline.value = caseRow.response_deadline || '';
        const profiles = await TVC_SupplierRfqPipeline.listSupplierProfiles();
        if (sel) {
            if (!profiles.length) {
                sel.innerHTML = '<option value="">— Register a supplier on the login screen —</option>';
            } else {
                sel.innerHTML = profiles.map(p =>
                    `<option value="${esc(p.supplier_id)}">${esc(p.company_name)}</option>`
                ).join('');
            }
        }
        modal.dataset.rfqId = caseRow.rfq_id;
        modal.classList.remove('hidden');
    }

    function closeTossModal() {
        el('smRfqTossModal')?.classList.add('hidden');
    }

    async function confirmToss() {
        const modal = el('smRfqTossModal');
        const smRfqId = modal?.dataset.rfqId;
        const supplierId = el('smRfqTossSupplier')?.value;
        const deadline = el('smRfqTossDeadline')?.value;
        if (!smRfqId || !supplierId) {
            await TVC_Dialog.alert('Select a registered supplier.');
            return;
        }
        if (!deadline) {
            await TVC_Dialog.alert('Set a response deadline.');
            return;
        }
        try {
            await TVC_SupplierRfqPipeline.tossToSupplier(smRfqId, supplierId, { deadline });
            closeTossModal();
            await TVC_Dialog.alert('RFQ dispatched to supplier inbox (status RECEIVED).');
            await renderCaseDetail();
            await renderCaseList();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    function bindOnce() {
        const root = el(MODAL_ID);
        if (!root || root.dataset.bound === '1') return;
        root.dataset.bound = '1';
        el('smRfqWorkspaceClose')?.addEventListener('click', () => close());
        root.addEventListener('click', (e) => {
            if (e.target === root) close();
        });
        el('smRfqTossCancel')?.addEventListener('click', () => closeTossModal());
        el('smRfqTossConfirm')?.addEventListener('click', () => void confirmToss());
        el('smRfqTossModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'smRfqTossModal') closeTossModal();
        });
    }

    async function open(user) {
        currentUser = user;
        bindOnce();
        await TVC_SupplierRfqPipeline.ensureSmDemoCases(user);
        const cases = await TVC_SupplierRfqPipeline.listSmCases();
        selectedCaseId = cases[0]?.rfq_id || null;
        el(MODAL_ID)?.classList.remove('hidden');
        await renderCaseList();
        await renderCaseDetail();
    }

    function close() {
        el(MODAL_ID)?.classList.add('hidden');
        currentUser = null;
    }

    return { open, close };
})();
if (typeof window !== 'undefined') window.TVC_RfqWorkspace = TVC_RfqWorkspace;
