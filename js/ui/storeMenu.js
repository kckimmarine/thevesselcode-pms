/* THE VESSEL CODE — STORE tab (IMPA catalog) */
const TVC_StoreMenu = (function () {
    let _mounted = false;
    let _modalReady = false;
    let _currentItem = null;
    let _importBusy = false;

    function formatNum(n) {
        return Number(n || 0).toLocaleString();
    }

    function esc(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function ensureImpaDetailModal() {
        const existing = document.getElementById('impaDetailModal');
        if (existing && !existing.querySelector('.impa-detail-close-float')) {
            existing.remove();
            _modalReady = false;
        }
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
                    <button type="button" class="impa-detail-close-btn impa-detail-close-float" aria-label="Close">✕</button>
                </header>
                <div class="impa-detail-scroll">
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
                    <footer class="impa-detail-footer">
                        <button type="button" class="impa-detail-close-btn impa-detail-close-bottom">Close / 닫기</button>
                    </footer>
                </div>
            </div>`;
        document.body.appendChild(wrap);

        wrap.addEventListener('click', e => {
            if (e.target === wrap) closeImpaDetailModal();
        });
        wrap.querySelectorAll('.impa-detail-close-btn').forEach(btn => {
            btn.addEventListener('click', closeImpaDetailModal);
        });
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

    function ensureImportFileInput() {
        if (document.getElementById('storeImportFile')) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.id = 'storeImportFile';
        input.accept = '.csv,.json,application/json,text/csv';
        input.hidden = true;
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.value = '';
            if (file) handleBulkImport(file);
        });
        document.body.appendChild(input);
    }

    function setImportProgress(visible, percent, label) {
        const panel = document.getElementById('storeImportProgress');
        const fill = document.getElementById('storeImportProgressFill');
        const text = document.getElementById('storeImportProgressLabel');
        if (!panel) return;
        panel.classList.toggle('hidden', !visible);
        if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        if (text) text.textContent = label || '';
    }

    async function handleBulkImport(file) {
        if (_importBusy) return;
        const root = document.getElementById('storeMenuBody');
        if (!root) return;
        _importBusy = true;
        ensureImportFileInput();
        setImportProgress(true, 0, 'Preparing import…');
        const importBtn = root.querySelector('#storeImportBtn');
        if (importBtn) importBtn.disabled = true;

        try {
            const result = await TVC_StoreManager.bulkImportCatalog(file, ({ imported, total, phase, catalogTotal }) => {
                const denom = total || imported || 1;
                const pct = phase === 'done' ? 100 : Math.round((imported / denom) * 100);
                const phaseLabel = phase === 'parsing' ? 'Parsing' : (phase === 'reading' ? 'Reading' : 'Loading');
                const label = phase === 'done'
                    ? `Complete — ${formatNum(catalogTotal || imported)} items in catalog`
                    : `${phaseLabel}: ${formatNum(imported)} / ${formatNum(total)} records…`;
                setImportProgress(true, pct, label);
            });

            root.innerHTML = '<p class="store-loading">Refreshing catalog…</p>';
            const items = await TVC_StoreManager.reloadCatalog();
            _mounted = true;
            renderCatalog(root, items);
            setImportProgress(true, 100,
                `Import complete — ${formatNum(result.catalogTotal)} items (${formatNum(result.imported)} upserted, ${formatNum(result.skipped)} skipped)`);
            setTimeout(() => setImportProgress(false, 0, ''), 4000);
        } catch (err) {
            setImportProgress(true, 0, err.message || 'Import failed');
            setTimeout(() => setImportProgress(false, 0, ''), 5000);
        } finally {
            _importBusy = false;
            if (importBtn) importBtn.disabled = false;
        }
    }

    function toolbarHtml(query, display, cartCount) {
        const { filtered, total, capped } = display;
        const countLabel = query.trim()
            ? `${formatNum(filtered)} of ${formatNum(total)} items`
            : `${formatNum(total)} items`;
        return `
            <div class="store-toolbar">
                <input type="search" class="store-search" placeholder="Search IMPA code, name, or category…"
                    aria-label="Search catalog" value="${esc(query)}">
                <button type="button" class="btn-sm store-import-btn" id="storeImportBtn">Import CSV/JSON</button>
                <span class="store-count" id="storeCatalogCount">${countLabel}</span>
                <span class="store-cart-pill">Cart <span class="store-cart-count${cartCount ? '' : ' hidden'}">${cartCount}</span></span>
            </div>
            <div id="storeImportProgress" class="store-import-panel hidden" aria-live="polite">
                <div class="store-import-progress-track">
                    <div id="storeImportProgressFill" class="store-import-progress-fill"></div>
                </div>
                <p id="storeImportProgressLabel" class="store-import-progress-label"></p>
            </div>`;
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

        ensureImportFileInput();
        root.querySelector('#storeImportBtn')?.addEventListener('click', () => {
            if (_importBusy) return;
            document.getElementById('storeImportFile')?.click();
        });
    }

    function renderCatalog(root, allItems, query = '') {
        const display = TVC_StoreManager.getDisplayItems(query, allItems);
        const { items, filtered, total, capped } = display;
        const cartCount = TVC_StoreManager.getCartCount();

        if (!filtered) {
            const msg = total
                ? 'No items match your search.'
                : 'No catalog items yet. Use Import CSV/JSON to load IMPA master data.';
            root.innerHTML = `
                ${toolbarHtml(query, display, cartCount)}
                <p class="store-empty">${msg}</p>`;
            bindCatalogEvents(root, allItems);
            return;
        }

        const rows = items.map(item => {
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

        const capNote = capped
            ? `<p class="store-cap-note">Showing first ${formatNum(items.length)} matches — refine search to narrow results.</p>`
            : '';

        root.innerHTML = `
            ${toolbarHtml(query, display, cartCount)}
            ${capNote}
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

        bindCatalogEvents(root, allItems);
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
