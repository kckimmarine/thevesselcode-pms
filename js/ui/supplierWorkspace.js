/* THE VESSEL CODE — Supplier Portal workspace */
const TVC_SupplierWorkspace = (function () {
    const VIEWS = ['rfq', 'delivery', 'invoices', 'account'];

    let currentUser = null;
    let activeView = 'rfq';
    let activeRfqId = null;

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

    function quoteLineInputs(rfq) {
        const items = rfq.items || [];
        if (!items.length) {
            return '<p class="muted">No line items on this RFQ.</p>';
        }
        return items.map((it, idx) => `
            <div class="supplier-quote-line" data-line-id="${esc(it.line_id || idx + 1)}">
                <div class="supplier-quote-line-desc">
                    <strong>${esc(it.part_no || '—')}</strong> — ${esc(it.description)}
                    <span class="muted"> · Qty ${esc(it.qty)} ${esc(it.unit || 'PCS')}</span>
                </div>
                <div class="supplier-quote-line-fields">
                    <label>Unit Price <select class="supplier-quote-currency" aria-label="Currency">
                        <option value="USD">USD</option><option value="KRW">KRW</option>
                    </select>
                    <input type="number" class="supplier-quote-price" min="0" step="0.01" placeholder="0.00"></label>
                    <label>Lead Time (Days) <input type="number" class="supplier-quote-lead" min="0" step="1" placeholder="14"></label>
                    <label>Maker / Genuine Remark <input type="text" class="supplier-quote-remark" maxlength="200" placeholder="OEM / alternate"></label>
                </div>
            </div>`).join('');
    }

    async function openQuoteDrawer(rfqId, user) {
        activeRfqId = rfqId;
        const rfq = await TVC_DB.get('supplier_rfqs', rfqId).catch(() => null);
        const drawer = el('supplierQuoteDrawer');
        const body = el('supplierQuoteDrawerBody');
        if (!drawer || !body || !rfq) return;
        body.innerHTML = `
            <h3>${esc(rfq.sm_rfq_id || rfq.rfq_id)}</h3>
            <p class="muted">${esc(rfq.vessel_name)} · ${esc(rfq.category)} · Due ${esc(rfq.deadline)}</p>
            <div class="supplier-quote-lines">${quoteLineInputs(rfq)}</div>
            <div class="supplier-quote-drawer-actions">
                <button type="button" class="btn" id="supplierQuoteDrawerClose">Cancel</button>
                <button type="button" class="btn btn-green" id="supplierQuoteSubmitBtn">📤 Submit Quotation</button>
            </div>`;
        drawer.classList.remove('hidden');
        el('supplierQuoteDrawerClose')?.addEventListener('click', closeQuoteDrawer);
        el('supplierQuoteSubmitBtn')?.addEventListener('click', () => void submitQuote(rfq, user));
    }

    function closeQuoteDrawer() {
        activeRfqId = null;
        el('supplierQuoteDrawer')?.classList.add('hidden');
    }

    async function submitQuote(rfq, user) {
        const lines = [];
        let currency = 'USD';
        let leadDays = 0;
        let makerRemarks = [];
        document.querySelectorAll('#supplierQuoteDrawerBody .supplier-quote-line').forEach(row => {
            const lineId = row.dataset.lineId;
            const cur = row.querySelector('.supplier-quote-currency')?.value || 'USD';
            currency = cur;
            const price = Number(row.querySelector('.supplier-quote-price')?.value);
            const lead = Number(row.querySelector('.supplier-quote-lead')?.value);
            const remark = String(row.querySelector('.supplier-quote-remark')?.value || '').trim();
            if (Number.isFinite(lead) && lead > leadDays) leadDays = lead;
            if (remark) makerRemarks.push(remark);
            const item = (rfq.items || []).find(it => String(it.line_id) === String(lineId))
                || (rfq.items || [])[lines.length];
            lines.push({
                line_id: lineId,
                part_no: item?.part_no,
                description: item?.description,
                qty: item?.qty,
                unit: item?.unit,
                unit_price: Number.isFinite(price) ? price : null,
                currency: cur,
                lead_time_days: Number.isFinite(lead) ? lead : null,
                maker_remark: remark,
            });
        });
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
                    <h2 class="supplier-panel-title">📥 RFQ Inbox</h2>
                    <p class="supplier-panel-sub muted">Live RFQs from Ship Management (SM).</p>
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

    return { open, close, renderView };
})();
if (typeof window !== 'undefined') window.TVC_SupplierWorkspace = TVC_SupplierWorkspace;
