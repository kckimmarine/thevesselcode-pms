/* THE VESSEL CODE — STORE tab (IMPA catalog) */
const TVC_StoreMenu = (function () {
    let _mounted = false;
    let _modalReady = false;
    let _currentItem = null;

    function esc(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function ensureImpaDetailModal() {
        if (_modalReady) return;
        const wrap = document.createElement('div');
        wrap.id = 'impaDetailModal';
        wrap.className = 'modal hidden impa-detail-modal';
        wrap.innerHTML = `
            <div class="modal-box impa-detail-box" role="dialog" aria-modal="true" aria-labelledby="impaDetailTitle">
                <header class="impa-detail-head">
                    <div class="impa-detail-head-main">
                        <span class="impa-detail-badge" id="impaDetailBadge">IMPA</span>
                        <h2 class="impa-detail-title" id="impaDetailTitle">—</h2>
                    </div>
                    <button type="button" class="modal-x impa-detail-close" aria-label="Close">×</button>
                </header>
                <div class="impa-detail-body">
                    <div class="impa-detail-plate-wrap">
                        <div class="impa-detail-plate-frame">
                            <img id="impaDetailPlateImg" class="impa-detail-plate-img" alt="Catalog plate" hidden>
                            <div id="impaDetailPlateFallback" class="impa-detail-plate-fallback" hidden>
                                <span class="impa-detail-plate-fallback-icon" aria-hidden="true">📐</span>
                                <p>No catalog plate available for this item.</p>
                            </div>
                        </div>
                        <p class="impa-detail-plate-caption">Catalog specification plate</p>
                    </div>
                    <aside class="impa-detail-specs">
                        <h3 class="impa-detail-specs-title">Specifications</h3>
                        <table class="impa-detail-spec-table">
                            <tbody id="impaDetailSpecBody"></tbody>
                        </table>
                        <div class="impa-detail-cart">
                            <label class="impa-detail-qty-label" for="impaDetailQty">Quantity</label>
                            <div class="impa-detail-cart-row">
                                <input type="number" id="impaDetailQty" class="impa-detail-qty" min="1" step="1" value="1">
                                <button type="button" class="btn impa-detail-cart-btn" id="impaDetailCartBtn">
                                    Add to Requisition Cart
                                </button>
                            </div>
                            <p class="impa-detail-cart-msg" id="impaDetailCartMsg" role="status" aria-live="polite"></p>
                        </div>
                    </aside>
                </div>
            </div>`;
        document.body.appendChild(wrap);

        wrap.addEventListener('click', e => {
            if (e.target === wrap) closeImpaDetailModal();
        });
        wrap.querySelector('.impa-detail-close')?.addEventListener('click', closeImpaDetailModal);
        wrap.querySelector('.impa-detail-box')?.addEventListener('click', e => e.stopPropagation());
        wrap.querySelector('#impaDetailCartBtn')?.addEventListener('click', onAddToCart);

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !wrap.classList.contains('hidden')) closeImpaDetailModal();
        });

        _modalReady = true;
    }

    function specRows(item) {
        const rows = [
            ['Category', item.category],
            ['Unit', item.unit],
            ['ROB (On Board)', `${item.rob ?? 0} ${item.unit || ''}`.trim()],
        ];
        const specs = item.specs && typeof item.specs === 'object' ? item.specs : {};
        Object.entries(specs).forEach(([key, val]) => {
            rows.push([key, val]);
        });
        return rows.map(([label, value]) => `
            <tr>
                <th scope="row">${esc(label)}</th>
                <td>${esc(value)}</td>
            </tr>`).join('');
    }

    function bindPlateImage(item) {
        const img = document.getElementById('impaDetailPlateImg');
        const fallback = document.getElementById('impaDetailPlateFallback');
        if (!img || !fallback) return;

        const src = String(item.catalog_page || '').trim();
        img.hidden = true;
        fallback.hidden = true;

        if (!src) {
            fallback.hidden = false;
            return;
        }

        img.onload = () => {
            img.hidden = false;
            fallback.hidden = true;
        };
        img.onerror = () => {
            img.hidden = true;
            fallback.hidden = false;
        };
        img.src = src;
        img.alt = `${item.name || 'IMPA item'} catalog plate`;
    }

    function openImpaDetailModal(item) {
        if (!item) return;
        ensureImpaDetailModal();
        _currentItem = item;

        const modal = document.getElementById('impaDetailModal');
        const badge = document.getElementById('impaDetailBadge');
        const title = document.getElementById('impaDetailTitle');
        const specBody = document.getElementById('impaDetailSpecBody');
        const qtyInput = document.getElementById('impaDetailQty');
        if (badge) badge.textContent = item.impa_code || item.code || 'IMPA';
        if (title) title.textContent = item.name || '—';
        if (specBody) specBody.innerHTML = specRows(item);
        if (qtyInput) qtyInput.value = '1';
        const msg = document.getElementById('impaDetailCartMsg');
        if (msg) msg.textContent = '';

        bindPlateImage(item);
        modal?.classList.remove('hidden');
        document.getElementById('impaDetailQty')?.focus();
    }

    function closeImpaDetailModal() {
        document.getElementById('impaDetailModal')?.classList.add('hidden');
        _currentItem = null;
    }

    function onAddToCart() {
        if (!_currentItem) return;
        const qtyInput = document.getElementById('impaDetailQty');
        const qty = Math.max(1, Math.floor(Number(qtyInput?.value) || 1));
        if (qtyInput) qtyInput.value = String(qty);
        const result = TVC_StoreManager.addToCart(_currentItem, qty);
        const msg = document.getElementById('impaDetailCartMsg');
        if (msg) {
            msg.textContent = result.ok
                ? `Added ${qty} × ${_currentItem.impa_code} to Requisition Cart (${result.count} total).`
                : (result.error || 'Could not add to cart.');
        }
        updateCartBadge();
    }

    function updateCartBadge() {
        const count = TVC_StoreManager.getCartCount();
        document.querySelectorAll('.store-cart-count').forEach(el => {
            el.textContent = String(count);
            el.classList.toggle('hidden', count <= 0);
        });
    }

    function bindCatalogEvents(root, items) {
        root.querySelectorAll('.store-code-link').forEach(btn => {
            btn.addEventListener('click', () => {
                const code = btn.dataset.impaCode;
                const item = TVC_StoreManager.getItemByCode(code) || items.find(i => i.impa_code === code || i.code === code);
                if (item) openImpaDetailModal(item);
            });
        });

        const searchInput = root.querySelector('.store-search');
        searchInput?.addEventListener('input', e => {
            renderCatalog(root, items, e.target.value);
            const updated = root.querySelector('.store-search');
            if (updated) {
                updated.focus();
                updated.setSelectionRange(updated.value.length, updated.value.length);
            }
        });
    }

    function renderCatalog(root, items, query = '') {
        const filtered = TVC_StoreManager.filterCatalog(query, items);
        const cartCount = TVC_StoreManager.getCartCount();

        if (!filtered.length) {
            root.innerHTML = `
                <div class="store-toolbar">
                    <input type="search" class="store-search" placeholder="Search IMPA code, name, or category…"
                        aria-label="Search catalog" value="${esc(query)}">
                    <span class="store-count">0 of ${items.length} items</span>
                    <span class="store-cart-pill">Cart <span class="store-cart-count${cartCount ? '' : ' hidden'}">${cartCount}</span></span>
                </div>
                <p class="store-empty">No items match your search.</p>`;
            bindCatalogEvents(root, items);
            return;
        }

        const rows = filtered.map(item => {
            const code = item.impa_code || item.code;
            return `
            <tr>
                <td class="store-code">
                    <button type="button" class="store-code-link" data-impa-code="${esc(code)}">${esc(code)}</button>
                </td>
                <td>${esc(item.name)}</td>
                <td><span class="store-category">${esc(item.category)}</span></td>
                <td>${esc(item.unit)}</td>
            </tr>`;
        }).join('');

        root.innerHTML = `
            <div class="store-toolbar">
                <input type="search" class="store-search" placeholder="Search IMPA code, name, or category…"
                    aria-label="Search catalog" value="${esc(query)}">
                <span class="store-count">${filtered.length} of ${items.length} items</span>
                <span class="store-cart-pill">Cart <span class="store-cart-count${cartCount ? '' : ' hidden'}">${cartCount}</span></span>
            </div>
            <div class="store-table-wrap">
                <table class="store-table">
                    <thead>
                        <tr>
                            <th>IMPA Code</th>
                            <th>Description</th>
                            <th>Category</th>
                            <th>Unit</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;

        bindCatalogEvents(root, items);
    }

    async function render() {
        const root = document.getElementById('storeMenuBody');
        if (!root) return;

        if (_mounted && TVC_StoreManager.getCatalog().length) {
            renderCatalog(root, TVC_StoreManager.getCatalog());
            return;
        }

        root.innerHTML = '<p class="store-loading">Loading catalog…</p>';
        try {
            const items = await TVC_StoreManager.loadCatalog();
            _mounted = true;
            renderCatalog(root, items);
        } catch (err) {
            root.innerHTML = `<p class="store-error">${esc(err.message || 'Failed to load catalog')}</p>`;
        }
    }

    return { render, openImpaDetailModal, closeImpaDetailModal };
})();
