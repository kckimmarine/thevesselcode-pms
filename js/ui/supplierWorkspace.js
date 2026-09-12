/* THE VESSEL CODE — Supplier Portal workspace (offline prototype) */
const TVC_SupplierWorkspace = (function () {
    const META_SEED_KEY = 'supplier_demo_rfqs_seeded_v1';
    const VIEWS = ['rfq', 'delivery', 'invoices', 'account'];

    let currentUser = null;
    let activeView = 'rfq';

    function supplierId(user) {
        return String(user?.supplier_id || user?.id || 'SUP_DEMO').trim();
    }

    function companyLabel(user) {
        return String(user?.company_name || user?.display_name || user?.username || 'Supplier').trim();
    }

    function el(id) { return document.getElementById(id); }

    async function ensureDemoRfqs(user) {
        const sid = supplierId(user);
        const seeded = await TVC_DB.getMeta(META_SEED_KEY).catch(() => null);
        if (seeded === sid) return;
        const existing = await TVC_DB.getAll('supplier_rfqs').catch(() => []);
        const mine = existing.filter(r => r.supplier_id === sid);
        if (mine.length) {
            try { await TVC_DB.setMeta(META_SEED_KEY, sid); } catch (_) {}
            return;
        }
        const now = new Date();
        const addDays = (d) => {
            const t = new Date(now);
            t.setDate(t.getDate() + d);
            return t.toISOString().slice(0, 10);
        };
        const demos = [
            {
                rfq_id: 'RFQ-2026-0142',
                supplier_id: sid,
                vessel_name: 'INCHEON CHEMI',
                category: 'Spare Parts',
                inquiry_type: 'Urgent supply',
                items_count: 6,
                deadline: addDays(5),
                status: 'RECEIVED',
                sync_status: 'local',
                updated_at: now.toISOString(),
            },
            {
                rfq_id: 'RFQ-2026-0138',
                supplier_id: sid,
                vessel_name: 'TVC No1',
                category: 'Deck stores',
                inquiry_type: 'Routine requisition',
                items_count: 12,
                deadline: addDays(12),
                status: 'RECEIVED',
                sync_status: 'local',
                updated_at: now.toISOString(),
            },
            {
                rfq_id: 'RFQ-2026-0091',
                supplier_id: sid,
                vessel_name: 'INCHEON CHEMI',
                category: 'Engine repair',
                inquiry_type: 'Workshop repair',
                items_count: 1,
                deadline: addDays(-2),
                status: 'QUOTED',
                sync_status: 'local',
                updated_at: now.toISOString(),
            },
        ];
        for (const row of demos) {
            await TVC_DB.put('supplier_rfqs', row);
        }
        try { await TVC_DB.setMeta(META_SEED_KEY, sid); } catch (_) {}
    }

    function setActiveNav(view) {
        activeView = VIEWS.includes(view) ? view : 'rfq';
        document.querySelectorAll('#tvc-supplier-workspace .supplier-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.supplierView === activeView);
        });
        const pipeline = el('supplierPipeline');
        if (pipeline) {
            pipeline.queryContent = activeView;
            pipeline.querySelectorAll('[data-pipeline-step]').forEach((step, i) => {
                const stepViews = ['rfq', 'delivery', 'delivery', 'invoices'];
                step.classList.toggle('active', stepViews[i] === activeView || (activeView === 'rfq' && i === 0));
            });
        }
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function renderRfqTable(user) {
        const body = el('supplierRfqTableBody');
        if (!body) return;
        const sid = supplierId(user);
        const rows = (await TVC_DB.getAll('supplier_rfqs').catch(() => []))
            .filter(r => r.supplier_id === sid)
            .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
        if (!rows.length) {
            body.innerHTML = '<tr><td colspan="6" class="supplier-empty">No RFQs in inbox.</td></tr>';
            return;
        }
        body.innerHTML = rows.map(r => {
            const canQuote = r.status === 'RECEIVED';
            const action = canQuote
                ? `<button type="button" class="btn btn-sm btn-green supplier-quote-btn" data-rfq="${escapeHtml(r.rfq_id)}">Submit Quote</button>`
                : `<span class="muted">${escapeHtml(r.status)}</span>`;
            return `<tr>
                <td>${escapeHtml(r.rfq_id)}</td>
                <td>${escapeHtml(r.vessel_name)}</td>
                <td>${escapeHtml(r.inquiry_type || r.category)}</td>
                <td class="num">${escapeHtml(r.items_count)}</td>
                <td>${escapeHtml(r.deadline)}</td>
                <td>${action}</td>
            </tr>`;
        }).join('');
        body.querySelectorAll('.supplier-quote-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                void submitQuoteStub(btn.dataset.rfq, user);
            });
        });
    }

    async function submitQuoteStub(rfqId, user) {
        const rfq = await TVC_DB.get('supplier_rfqs', rfqId).catch(() => null);
        if (!rfq) return;
        const quoteId = `Q-${rfqId}-${Date.now()}`;
        await TVC_DB.put('supplier_quotes', {
            id: quoteId,
            rfq_id: rfqId,
            supplier_id: supplierId(user),
            unit_prices: [],
            lead_time_days: 14,
            maker_remarks: 'Prototype quote — edit in future release.',
            status: 'SUBMITTED',
            sync_status: 'local',
            updated_at: new Date().toISOString(),
        });
        await TVC_DB.put('supplier_rfqs', {
            ...rfq,
            status: 'QUOTED',
            updated_at: new Date().toISOString(),
        });
        if (typeof TVC_Dialog !== 'undefined') {
            await TVC_Dialog.alert(`Quote submitted for ${rfqId} (stored locally in supplier_quotes).`);
        }
        await renderRfqTable(user);
    }

    function renderPlaceholder(view) {
        const main = el('supplierMainPane');
        if (!main) return;
        const titles = {
            delivery: 'Delivery / Repair',
            invoices: 'Invoices',
            account: 'Account',
        };
        if (view === 'rfq') {
            main.innerHTML = `
                <div class="supplier-panel">
                    <h2 class="supplier-panel-title">📥 RFQ Inbox</h2>
                    <p class="supplier-panel-sub muted">Incoming quotation requests from Ship Management (SM).</p>
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
        if (view === 'account' && currentUser) {
            const u = currentUser;
            const scopes = Array.isArray(u.business_scope) ? u.business_scope.join(', ') : '—';
            main.innerHTML = `
            <div class="supplier-panel">
                <h2 class="supplier-panel-title">⚙️ Account</h2>
                <dl class="supplier-account-dl">
                    <dt>Company</dt><dd>${escapeHtml(companyLabel(u))}</dd>
                    <dt>User ID</dt><dd>${escapeHtml(u.username || '—')}</dd>
                    <dt>Business Scope</dt><dd>${escapeHtml(scopes)}</dd>
                    <dt>Contact</dt><dd>${escapeHtml(u.contact_person || '—')}</dd>
                    <dt>Email</dt><dd>${escapeHtml(u.contact_email || '—')}</dd>
                    <dt>Service Ports</dt><dd>${escapeHtml(u.service_ports || '—')}</dd>
                </dl>
            </div>`;
            return;
        }
        main.innerHTML = `
            <div class="supplier-panel supplier-placeholder">
                <h2 class="supplier-panel-title">${escapeHtml(titles[view] || 'Section')}</h2>
                <p class="muted">Prototype navigation — full workflow connects to supplier_orders and cloud sync in a later release.</p>
            </div>`;
    }

    async function renderView(view) {
        setActiveNav(view);
        renderPlaceholder(view);
        if (view === 'rfq' && currentUser) await renderRfqTable(currentUser);
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
        await ensureDemoRfqs(user);
        await renderView('rfq');
        try { location.hash = 'tvc-supplier-workspace'; } catch (_) {}
    }

    function close() {
        currentUser = null;
        try {
            if (location.hash === '#tvc-supplier-workspace') location.hash = '';
        } catch (_) {}
    }

    return { open, close, renderView };
})();
if (typeof window !== 'undefined') window.TVC_SupplierWorkspace = TVC_SupplierWorkspace;
