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
    let _plateZoom = null;
    let _plateFullscreen = null;
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
        if (existing && !existing.querySelector('.impa-detail-plate-viewport')) {
            existing.remove();
            _modalReady = false;
            _plateZoom = null;
            _plateFullscreen = null;
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
                    <section class="impa-detail-plate-section" aria-label="Catalog plate viewer">
                        <div class="impa-detail-plate-toolbar">
                            <p class="impa-detail-plate-caption" id="impaDetailPlateCaption">Catalog specification plate</p>
                            <button type="button" class="impa-detail-zoom-btn" id="impaDetailZoomBtn" hidden>
                                🔍 도판 크게보기
                            </button>
                        </div>
                        <div class="impa-detail-plate-viewport" id="impaDetailPlateViewport">
                            <div class="impa-detail-plate-stage" id="impaDetailPlateStage">
                                <img id="impaDetailPlateImg" class="impa-detail-plate-img" alt="Catalog plate" hidden>
                                <div id="impaDetailPlateFallback" class="impa-detail-plate-fallback" hidden></div>
                            </div>
                        </div>
                        <p class="impa-detail-plate-hint">Pinch or scroll to zoom · drag to pan when enlarged</p>
                    </section>
                    <section class="impa-detail-spec-section" aria-label="Technical specifications">
                        <div class="impa-detail-rob-banner" id="impaDetailRobBanner">
                            <span class="impa-detail-rob-label">Current Vessel ROB</span>
                            <span class="impa-detail-rob-value" id="impaDetailRobValue">—</span>
                        </div>
                        <h3 class="impa-detail-specs-title">Technical Specifications</h3>
                        <div class="impa-detail-spec-table-wrap">
                            <table class="impa-detail-spec-table">
                                <tbody id="impaDetailSpecBody"></tbody>
                            </table>
                        </div>
                        <div class="impa-detail-cart">
                            <label class="impa-detail-qty-label" for="impaDetailQty">청구 수량 (Requisition Qty)</label>
                            <div class="impa-detail-cart-row">
                                <input type="number" id="impaDetailQty" class="impa-detail-qty" min="1" step="1" value="1" inputmode="numeric">
                                <button type="button" class="btn impa-detail-cart-btn" id="impaDetailCartBtn">
                                    + Add to Requisition Cart
                                </button>
                            </div>
                            <p class="impa-detail-cart-msg" id="impaDetailCartMsg" role="status" aria-live="polite"></p>
                        </div>
                    </section>
                    <footer class="impa-detail-footer">
                        <button type="button" class="impa-detail-close-btn impa-detail-close-bottom">Close / 닫기</button>
                    </footer>
                </div>
            </div>
            <div id="impaPlateFullscreen" class="impa-plate-fullscreen hidden" aria-hidden="true">
                <div class="impa-plate-fullscreen-backdrop"></div>
                <div class="impa-plate-fullscreen-panel" role="dialog" aria-label="Enlarged catalog plate">
                    <header class="impa-plate-fullscreen-head">
                        <span id="impaPlateFullscreenTitle">Catalog plate</span>
                        <button type="button" class="impa-plate-fullscreen-close" aria-label="Close enlarged view">✕</button>
                    </header>
                    <div class="impa-plate-fullscreen-viewport" id="impaPlateFullscreenViewport">
                        <div class="impa-plate-fullscreen-stage" id="impaPlateFullscreenStage">
                            <img id="impaPlateFullscreenImg" class="impa-plate-fullscreen-img" alt="">
                        </div>
                    </div>
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
        wrap.querySelector('#impaDetailZoomBtn')?.addEventListener('click', openPlateFullscreen);

        const fs = wrap.querySelector('#impaPlateFullscreen');
        fs?.querySelector('.impa-plate-fullscreen-backdrop')?.addEventListener('click', closePlateFullscreen);
        fs?.querySelector('.impa-plate-fullscreen-close')?.addEventListener('click', closePlateFullscreen);

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                if (!fs?.classList.contains('hidden')) {
                    closePlateFullscreen();
                    return;
                }
                if (!wrap.classList.contains('hidden')) closeImpaDetailModal();
            }
        });

        const viewport = wrap.querySelector('#impaDetailPlateViewport');
        const stage = wrap.querySelector('#impaDetailPlateStage');
        if (viewport && stage) _plateZoom = createPlateZoomController(viewport, stage);

        const fsViewport = wrap.querySelector('#impaPlateFullscreenViewport');
        const fsStage = wrap.querySelector('#impaPlateFullscreenStage');
        if (fsViewport && fsStage) {
            _plateFullscreen = createPlateZoomController(fsViewport, fsStage, { maxScale: 6 });
        }

        _modalReady = true;
    }

    function touchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    }

    function createPlateZoomController(viewport, stage, { minScale = 1, maxScale = 4 } = {}) {
        let scale = 1;
        let tx = 0;
        let ty = 0;
        let pinching = false;
        let panning = false;
        let lastDist = 0;
        let lastX = 0;
        let lastY = 0;

        function apply() {
            stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
            viewport.classList.toggle('is-zoomed', scale > 1.02);
        }

        function reset() {
            scale = 1;
            tx = 0;
            ty = 0;
            pinching = false;
            panning = false;
            apply();
        }

        function clampScale(next) {
            return Math.min(maxScale, Math.max(minScale, next));
        }

        viewport.addEventListener('wheel', e => {
            if (!stage.querySelector('img:not([hidden])')) return;
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.92 : 1.08;
            const next = clampScale(scale * factor);
            if (next <= 1) {
                reset();
                return;
            }
            scale = next;
            apply();
        }, { passive: false });

        viewport.addEventListener('pointerdown', e => {
            if (!stage.querySelector('img:not([hidden])')) return;
            if (e.pointerType === 'touch') return;
            if (scale <= 1) return;
            panning = true;
            lastX = e.clientX;
            lastY = e.clientY;
            viewport.setPointerCapture?.(e.pointerId);
        });

        viewport.addEventListener('pointermove', e => {
            if (!panning) return;
            tx += e.clientX - lastX;
            ty += e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
            apply();
        });

        viewport.addEventListener('pointerup', () => { panning = false; });
        viewport.addEventListener('pointercancel', () => { panning = false; });

        viewport.addEventListener('touchstart', e => {
            if (!stage.querySelector('img:not([hidden])')) return;
            if (e.touches.length === 2) {
                pinching = true;
                lastDist = touchDistance(e.touches);
            } else if (e.touches.length === 1 && scale > 1) {
                panning = true;
                lastX = e.touches[0].clientX;
                lastY = e.touches[0].clientY;
            }
        }, { passive: true });

        viewport.addEventListener('touchmove', e => {
            if (pinching && e.touches.length === 2) {
                e.preventDefault();
                const dist = touchDistance(e.touches);
                if (lastDist > 0) {
                    const next = clampScale(scale * (dist / lastDist));
                    scale = next;
                    if (scale <= 1) {
                        reset();
                    } else {
                        apply();
                    }
                }
                lastDist = dist;
            } else if (panning && e.touches.length === 1 && scale > 1) {
                e.preventDefault();
                tx += e.touches[0].clientX - lastX;
                ty += e.touches[0].clientY - lastY;
                lastX = e.touches[0].clientX;
                lastY = e.touches[0].clientY;
                apply();
            }
        }, { passive: false });

        viewport.addEventListener('touchend', () => {
            pinching = false;
            panning = false;
            lastDist = 0;
        });

        return { reset, apply };
    }

    function platePlaceholderHtml(item) {
        const code = esc(item.impa_code || item.code || '—');
        const plateNo = esc(item.plate_no || TVC_ImpaSchema.derivePlateNo(item.impa_code || item.code) || '—');
        const name = esc(item.name || 'IMPA Item');
        return `
            <svg class="impa-plate-placeholder-svg" viewBox="0 0 480 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Technical drawing placeholder">
                <defs>
                    <pattern id="ph-grid" width="16" height="16" patternUnits="userSpaceOnUse">
                        <path d="M16 0H0V16" fill="none" stroke="#cbd5e0" stroke-width="0.5"/>
                    </pattern>
                </defs>
                <rect width="480" height="360" fill="#f8f4ea"/>
                <rect x="8" y="8" width="464" height="344" fill="url(#ph-grid)" stroke="#1a365d" stroke-width="2"/>
                <rect x="24" y="24" width="436" height="48" fill="#1a365d"/>
                <text x="242" y="54" text-anchor="middle" fill="#fff" font-family="Georgia,serif" font-size="16" font-weight="700">NO PLATE AVAILABLE</text>
                <circle cx="240" cy="190" r="72" fill="none" stroke="#4a5568" stroke-width="1.5" stroke-dasharray="6 4"/>
                <line x1="168" y1="190" x2="312" y2="190" stroke="#718096" stroke-width="1"/>
                <line x1="240" y1="118" x2="240" y2="262" stroke="#718096" stroke-width="1"/>
                <text x="240" y="196" text-anchor="middle" fill="#4a5568" font-family="ui-monospace,monospace" font-size="11">TECHNICAL DRAWING</text>
                <text x="32" y="300" fill="#2d3748" font-family="ui-monospace,monospace" font-size="11">IMPA ${code}</text>
                <text x="32" y="318" fill="#4a5568" font-family="ui-sans-serif,system-ui" font-size="10">${name}</text>
                <text x="32" y="336" fill="#718096" font-family="ui-monospace,monospace" font-size="10">PLATE REF: ${plateNo}</text>
            </svg>
            <p class="impa-detail-plate-fallback-msg">No catalog plate on file for this IMPA code.</p>`;
    }

    function specRows(item) {
        const specs = item.specs && typeof item.specs === 'object' ? item.specs : {};
        const priority = ['Dimensions', 'Material', 'Voltage', 'Standard', 'Grade', 'Finish', 'Certification'];
        const rows = [];
        const used = new Set();

        priority.forEach(key => {
            if (specs[key] != null && String(specs[key]).trim() !== '') {
                rows.push([key, specs[key]]);
                used.add(key);
            }
        });

        rows.push(['Category', item.category || '—']);
        rows.push(['Unit of Measure', item.unit || 'PCS']);
        const plateNo = item.plate_no || TVC_ImpaSchema.derivePlateNo(item.impa_code || item.code);
        if (plateNo) rows.push(['Plate Reference', plateNo]);

        Object.entries(specs).forEach(([key, val]) => {
            if (used.has(key) || val == null || String(val).trim() === '') return;
            rows.push([key, val]);
        });

        return rows.map(([label, value]) => `
            <tr>
                <th scope="row">${esc(label)}</th>
                <td>${esc(value)}</td>
            </tr>`).join('');
    }

    function isPhotoPlateUrl(url) {
        const u = String(url || '').trim();
        if (!u) return false;
        if (/^https?:\/\//i.test(u)) return !/\.svg(\?|#|$)/i.test(u);
        return /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(u);
    }

    function resolvePlatePhotoUrl(item) {
        const explicit = String(item?.plate_image || '').trim();
        if (isPhotoPlateUrl(explicit)) return explicit;
        return '';
    }

    function showPlatePlaceholder(item, img, fallback, zoomBtn, fsImg) {
        const viewport = document.getElementById('impaDetailPlateViewport');
        viewport?.classList.remove('has-photo');
        if (img) {
            img.hidden = true;
            img.removeAttribute('src');
        }
        if (fallback) {
            fallback.innerHTML = platePlaceholderHtml(item);
            fallback.hidden = false;
        }
        if (zoomBtn) zoomBtn.hidden = true;
        if (fsImg) fsImg.removeAttribute('src');
    }

    function bindPlateImage(item) {
        const img = document.getElementById('impaDetailPlateImg');
        const fallback = document.getElementById('impaDetailPlateFallback');
        const caption = document.getElementById('impaDetailPlateCaption');
        const zoomBtn = document.getElementById('impaDetailZoomBtn');
        const fsImg = document.getElementById('impaPlateFullscreenImg');
        const fsTitle = document.getElementById('impaPlateFullscreenTitle');
        const viewport = document.getElementById('impaDetailPlateViewport');
        if (!img || !fallback) return;

        _plateZoom?.reset();
        _plateFullscreen?.reset();

        const plateNo = item.plate_no || TVC_ImpaSchema.derivePlateNo(item.impa_code || item.code);
        const code = item.impa_code || item.code || '';
        const photoUrl = resolvePlatePhotoUrl(item);
        if (caption) {
            caption.textContent = photoUrl
                ? `Catalog Photo · ${plateNo || code}`
                : (plateNo ? `IMPA Catalog Plate · ${plateNo}` : 'IMPA Catalog Plate');
        }
        if (fsTitle) fsTitle.textContent = `${code} — ${item.name || 'Catalog plate'}`;

        img.hidden = true;
        fallback.hidden = true;
        fallback.innerHTML = '';
        if (zoomBtn) zoomBtn.hidden = true;
        img.alt = `${item.name || 'IMPA item'} catalog plate`;
        viewport?.classList.remove('has-photo');

        const onLoaded = src => {
            viewport?.classList.add('has-photo');
            img.hidden = false;
            fallback.hidden = true;
            if (zoomBtn) zoomBtn.hidden = false;
            if (fsImg) {
                fsImg.src = src;
                fsImg.alt = img.alt;
            }
        };

        if (!photoUrl) {
            showPlatePlaceholder(item, img, fallback, zoomBtn, fsImg);
            return;
        }

        img.onload = () => onLoaded(photoUrl);
        img.onerror = () => showPlatePlaceholder(item, img, fallback, zoomBtn, fsImg);
        img.src = photoUrl;
        img.loading = 'eager';
        img.decoding = 'async';
    }

    function openPlateFullscreen() {
        const fs = document.getElementById('impaPlateFullscreen');
        const img = document.getElementById('impaPlateFullscreenImg');
        const fsViewport = document.getElementById('impaPlateFullscreenViewport');
        if (!fs || !img?.src) return;
        fs.classList.remove('hidden');
        fs.setAttribute('aria-hidden', 'false');
        fsViewport?.classList.toggle('has-photo', isPhotoPlateUrl(img.src));
        _plateFullscreen?.reset();
    }

    function closePlateFullscreen() {
        const fs = document.getElementById('impaPlateFullscreen');
        if (!fs) return;
        fs.classList.add('hidden');
        fs.setAttribute('aria-hidden', 'true');
        _plateFullscreen?.reset();
    }

    function openImpaDetailModal(item) {
        if (!item) return;
        ensureImpaDetailModal();
        _currentItem = item;

        const modal = document.getElementById('impaDetailModal');
        const badge = document.getElementById('impaDetailBadge');
        const title = document.getElementById('impaDetailTitle');
        const specBody = document.getElementById('impaDetailSpecBody');
        const robValue = document.getElementById('impaDetailRobValue');
        const qtyInput = document.getElementById('impaDetailQty');
        if (badge) badge.textContent = item.impa_code || item.code || 'IMPA';
        if (title) title.textContent = item.name || '—';
        if (specBody) specBody.innerHTML = specRows(item);
        if (robValue) {
            robValue.textContent = `${formatNum(item.rob ?? 0)} ${item.unit || ''}`.trim();
        }
        if (qtyInput) qtyInput.value = '1';
        const msg = document.getElementById('impaDetailCartMsg');
        if (msg) msg.textContent = '';

        bindPlateImage(item);
        modal?.classList.remove('hidden');
        document.getElementById('impaDetailQty')?.focus();
    }

    function closeImpaDetailModal() {
        closePlateFullscreen();
        document.getElementById('impaDetailModal')?.classList.add('hidden');
        _currentItem = null;
        _plateZoom?.reset();
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
