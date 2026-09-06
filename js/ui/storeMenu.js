/* THE VESSEL CODE — STORE tab (IMPA catalog, 50k+ virtual scroll) */
const TVC_StoreMenu = (function () {
    let _mounted = false;
    let _modalReady = false;
    let _currentItem = null;
    let _importBusy = false;
    let _virtualList = null;
    let _searchTimer = null;
    let _searchSeq = 0;
    const _listState = { items: [] };
    const STORE_ROW_H = 44;
    const SEARCH_DEBOUNCE_MS = 180;

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
                            <p class="impa-detail-plate-caption" id="impaDetailPlateCaption">Catalog specification plate</p>
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
        const plateNo = item.plate_no || TVC_ImpaSchema.derivePlateNo(item.impa_code || item.code);
        const rows = [
            ['Category', item.category],
            ['Unit', item.unit],
            ['Plate No.', plateNo || '—'],
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
        const caption = document.getElementById('impaDetailPlateCaption');
        if (!img || !fallback) return;

        const plateNo = item.plate_no || TVC_ImpaSchema.derivePlateNo(item.impa_code || item.code);
        if (caption) {
            caption.textContent = plateNo
                ? `Catalog plate · ${plateNo}`
                : 'Catalog specification plate';
        }

        const candidates = [];
        const primary = item.plate_image || TVC_ImpaSchema.resolvePlateImageUrl(item);
        if (primary) candidates.push(primary);
        const page = String(item.catalog_page || '').trim();
        if (page && page !== primary) candidates.push(page);

        img.hidden = true;
        fallback.hidden = true;
        img.alt = `${item.name || 'IMPA item'} catalog plate`;

        if (!candidates.length) {
            fallback.hidden = false;
            return;
        }

        let idx = 0;
        const tryNext = () => {
            if (idx >= candidates.length) {
                img.hidden = true;
                img.removeAttribute('src');
                fallback.hidden = false;
                return;
            }
            img.src = candidates[idx++];
        };

        img.onload = () => {
            img.hidden = false;
            fallback.hidden = true;
        };
        img.onerror = tryNext;
        tryNext();
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
            const search = await TVC_StoreManager.reloadCatalog();
            _mounted = true;
            renderCatalog(root, search);
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

    function countLabel(search) {
        const { query = '', items = [], total = 0, ms = 0, capped, browseLimited } = search;
        if (query.trim()) {
            const match = formatNum(items.length);
            const suffix = capped ? '+' : '';
            const timing = ms > 0 ? ` · ${ms.toFixed(0)} ms` : '';
            return `${match}${suffix} of ${formatNum(total)} items${timing}`;
        }
        if (browseLimited) {
            return `${formatNum(total)} items (preview ${formatNum(items.length)})`;
        }
        return `${formatNum(total)} items`;
    }

    function capNoteText(search) {
        const { query = '', items = [], total = 0, capped, browseLimited } = search;
        if (capped) {
            return `Showing first ${formatNum(items.length)} matches — refine search to narrow results.`;
        }
        if (!query && browseLimited) {
            return `Browsing first ${formatNum(items.length)} of ${formatNum(total)} items — search by IMPA code or description.`;
        }
        return '';
    }

    function toolbarHtml(search, cartCount) {
        const query = search?.query || '';
        return `
            <div class="store-toolbar">
                <input type="search" class="store-search" placeholder="Search IMPA code (6-digit) or description…"
                    aria-label="Search catalog" value="${esc(query)}" autocomplete="off">
                <button type="button" class="btn-sm store-import-btn" id="storeImportBtn">Import CSV/JSON</button>
                <span class="store-count" id="storeCatalogCount">${countLabel(search)}</span>
                <span class="store-cart-pill">Cart <span class="store-cart-count${cartCount ? '' : ' hidden'}">${cartCount}</span></span>
            </div>
            <div id="storeImportProgress" class="store-import-panel hidden" aria-live="polite">
                <div class="store-import-progress-track">
                    <div id="storeImportProgressFill" class="store-import-progress-fill"></div>
                </div>
                <p id="storeImportProgressLabel" class="store-import-progress-label"></p>
            </div>`;
    }

    function rowHtml(item) {
        const code = item.impa_code || item.code;
        return `
            <div class="store-vl-row" role="row">
                <span class="store-vl-cell store-code" role="cell">
                    <button type="button" class="store-code-link" data-impa-code="${esc(code)}">${esc(code)}</button>
                </span>
                <span class="store-vl-cell store-vl-name" role="cell" title="${esc(item.name)}">${esc(item.name)}</span>
                <span class="store-vl-cell store-vl-cat" role="cell">
                    <span class="store-category">${esc(item.category)}</span>
                </span>
                <span class="store-vl-cell store-vl-unit" role="cell">${esc(item.unit)}</span>
            </div>`;
    }

    function catalogShellHtml(search, cartCount) {
        const cap = capNoteText(search);
        const hasItems = (search.items || []).length > 0;
        const emptyMsg = (search.query || '').trim()
            ? 'No items match your search.'
            : 'No catalog items yet. Use Import CSV/JSON to load IMPA master data.';
        return `
            ${toolbarHtml(search, cartCount)}
            <p id="storeCapNote" class="store-cap-note${cap ? '' : ' hidden'}">${esc(cap)}</p>
            <p id="storeEmpty" class="store-empty${hasItems ? ' hidden' : ''}">${emptyMsg}</p>
            <div id="storeVlWrap" class="store-vl-wrap${hasItems ? '' : ' hidden'}" role="table" aria-label="IMPA catalog">
                <div class="store-vl-head" role="row">
                    <span role="columnheader">IMPA Code</span>
                    <span role="columnheader">Description</span>
                    <span role="columnheader">Category</span>
                    <span class="store-vl-unit-head" role="columnheader">Unit</span>
                </div>
                <div id="storeVlScroll" class="store-vl-scroll" tabindex="0"></div>
            </div>`;
    }

    function destroyVirtualList() {
        _virtualList?.destroy();
        _virtualList = null;
    }

    function mountVirtualList(root) {
        const scroll = root.querySelector('#storeVlScroll');
        if (!scroll) return;
        destroyVirtualList();
        _virtualList = TVC_VirtualList.mount(scroll, {
            rowHeight: STORE_ROW_H,
            getCount: () => _listState.items.length,
            renderRow: i => (_listState.items[i] ? rowHtml(_listState.items[i]) : ''),
            overflowX: 'hidden',
            overflowY: 'auto',
        });
    }

    function paintSearchResults(root, search) {
        const countEl = root.querySelector('#storeCatalogCount');
        if (countEl) countEl.textContent = countLabel(search);

        const capNote = root.querySelector('#storeCapNote');
        const cap = capNoteText(search);
        if (capNote) {
            capNote.textContent = cap;
            capNote.classList.toggle('hidden', !cap);
        }

        const items = search.items || [];
        const empty = root.querySelector('#storeEmpty');
        const wrap = root.querySelector('#storeVlWrap');

        if (!items.length) {
            wrap?.classList.add('hidden');
            empty?.classList.remove('hidden');
            if (empty) {
                empty.textContent = (search.query || '').trim()
                    ? 'No items match your search.'
                    : 'No catalog items yet. Use Import CSV/JSON to load IMPA master data.';
            }
            _listState.items = [];
            destroyVirtualList();
            return;
        }

        empty?.classList.add('hidden');
        wrap?.classList.remove('hidden');
        _listState.items = items;
        if (_virtualList) {
            const scroll = root.querySelector('#storeVlScroll');
            if (scroll) scroll.scrollTop = 0;
            _virtualList.refresh();
        } else {
            mountVirtualList(root);
        }
    }

    async function runSearch(root, query) {
        const seq = ++_searchSeq;
        const countEl = root.querySelector('#storeCatalogCount');
        if (countEl) countEl.textContent = 'Searching…';
        try {
            const search = await TVC_StoreManager.searchCatalog(query);
            if (seq !== _searchSeq) return;
            paintSearchResults(root, search);
        } catch (err) {
            if (seq !== _searchSeq) return;
            const empty = root.querySelector('#storeEmpty');
            if (empty) {
                empty.classList.remove('hidden');
                empty.textContent = err.message || 'Search failed.';
            }
        }
    }

    function scheduleSearch(root, query) {
        if (_searchTimer) clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
            _searchTimer = null;
            runSearch(root, query);
        }, SEARCH_DEBOUNCE_MS);
    }

    function bindCatalogEvents(root) {
        root.querySelector('#storeVlScroll')?.addEventListener('click', async e => {
            const btn = e.target.closest('.store-code-link');
            if (!btn) return;
            const code = btn.dataset.impaCode;
            const cached = _listState.items.find(i => (i.impa_code || i.code) === code);
            const item = cached?.specs ? cached : await TVC_StoreManager.getItemByCode(code);
            if (item) openImpaDetailModal(item);
        });

        const searchInput = root.querySelector('.store-search');
        searchInput?.addEventListener('input', e => {
            const q = e.target.value;
            scheduleSearch(root, q);
        });

        ensureImportFileInput();
        root.querySelector('#storeImportBtn')?.addEventListener('click', () => {
            if (_importBusy) return;
            document.getElementById('storeImportFile')?.click();
        });
    }

    function renderCatalog(root, search) {
        const state = search?.items ? search : TVC_StoreManager.getLastSearch();
        _listState.items = state.items || [];
        const cartCount = TVC_StoreManager.getCartCount();

        destroyVirtualList();
        root.innerHTML = catalogShellHtml(state, cartCount);
        bindCatalogEvents(root);
        if (_listState.items.length) mountVirtualList(root);
        updateCartBadge();
    }

    async function render() {
        const root = document.getElementById('storeMenuBody');
        if (!root) return;

        if (_mounted && TVC_StoreManager.getTotalCount() > 0) {
            const search = await TVC_StoreManager.searchCatalog(TVC_StoreManager.getLastSearch().query || '');
            renderCatalog(root, search);
            return;
        }

        root.innerHTML = '<p class="store-loading">Loading catalog…</p>';
        try {
            await TVC_StoreManager.loadCatalog();
            _mounted = true;
            renderCatalog(root, TVC_StoreManager.getLastSearch());
        } catch (err) {
            root.innerHTML = `<p class="store-error">${esc(err.message || 'Failed to load catalog')}</p>`;
        }
    }

    return { render, openImpaDetailModal, closeImpaDetailModal };
})();
