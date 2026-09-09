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
    let _plateObjectUrl = null;
    let _plateLoadToken = 0;
    let _publicMode = false;
    let _categoryFilter = '';
    const STORE_ROW_H = 44;
    const SEARCH_DEBOUNCE_MS = 180;
    const PUBLIC_SEARCH_DEBOUNCE_MS = 100;

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
        if (existing && (!existing.querySelector('.impa-detail-plate-viewport')
            || !existing.querySelector('#impaDetailShipservLayout')
            || !existing.querySelector('#modalCloseBtn')
            || !existing.querySelector('.modal-body'))) {
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
            <div class="modal-box impa-detail-box impa-modal-container modal-card" role="dialog" aria-modal="true" aria-labelledby="impaDetailProductTitle">
                <header class="impa-detail-head">
                    <div class="impa-detail-head-main">
                        <span class="impa-detail-badge" id="impaDetailBadge">IMPA</span>
                        <h2 class="impa-detail-title" id="impaDetailTitle">—</h2>
                    </div>
                    <button type="button" id="modalCloseBtn" class="impa-detail-close-btn impa-detail-close-float" aria-label="Close">✕</button>
                </header>
                <div class="modal-body impa-detail-scroll">
                    <div id="impaDetailShipservLayout" class="impa-shipserv-layout hidden" aria-label="IMPA product details">
                        <div class="impa-shipserv-photo" id="impaDetailProductPhoto">
                            <img id="impaDetailProductImg" class="impa-shipserv-photo-img" alt="" hidden>
                            <div id="impaDetailProductFallback" class="impa-shipserv-photo-fallback" hidden></div>
                        </div>
                        <h2 class="impa-shipserv-title" id="impaDetailProductTitle">—</h2>
                        <p class="impa-shipserv-dims" id="impaDetailProductDims"></p>
                        <div class="impa-shipserv-spec-wrap">
                            <table class="impa-shipserv-spec-table">
                                <tbody id="impaDetailShipservSpec"></tbody>
                            </table>
                        </div>
                        <section class="impa-shipserv-desc" aria-label="Description and use">
                            <h3 class="impa-shipserv-desc-title">Description / Use</h3>
                            <p class="impa-shipserv-desc-text" id="impaDetailProductDesc"></p>
                        </section>
                    </div>
                    <div id="impaDetailPmsLayout" class="impa-detail-pms-layout">
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
                    <section class="impa-detail-locked-preview hidden" id="impaDetailLockedPreview" aria-label="Enterprise PMS features preview">
                        <h3 class="impa-detail-locked-title">Enterprise PMS Features</h3>
                        <button type="button" class="impa-locked-row" data-lead-trigger="rob">
                            <span class="impa-locked-label">⚓ Vessel ROB (Stock)</span>
                            <span class="impa-locked-value">🔒 Locked — Available in TVC-PMS</span>
                        </button>
                        <button type="button" class="impa-locked-row" data-lead-trigger="requisition">
                            <span class="impa-locked-label">📋 1-Click Requisition</span>
                            <span class="impa-locked-value">🔒 Locked — Available in TVC-PMS</span>
                        </button>
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
                            <label class="impa-detail-qty-label" for="impaDetailQty">Requisition Qty</label>
                            <div class="impa-detail-cart-row">
                                <input type="number" id="impaDetailQty" class="impa-detail-qty" min="1" step="1" value="1" inputmode="numeric">
                                <button type="button" class="btn impa-detail-cart-btn" id="impaDetailCartBtn">
                                    + Add to Requisition Cart
                                </button>
                            </div>
                            <p class="impa-detail-cart-msg" id="impaDetailCartMsg" role="status" aria-live="polite"></p>
                        </div>
                        <div class="impa-detail-public-cta hidden" id="impaDetailPublicCta" aria-hidden="true"></div>
                    </section>
                    <footer class="impa-detail-footer">
                        <button type="button" class="impa-detail-close-btn impa-detail-close-bottom">Close</button>
                    </footer>
                    </div>
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
        wrap.querySelector('#modalCloseBtn')?.addEventListener('click', closeImpaDetailModal);
        wrap.querySelectorAll('.impa-detail-close-bottom').forEach(btn => {
            btn.addEventListener('click', closeImpaDetailModal);
        });
        wrap.querySelector('.impa-modal-container, .impa-detail-box')?.addEventListener('click', e => e.stopPropagation());
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

        applyModalPublicMode();
        _modalReady = true;
    }

    function applyModalPublicMode() {
        const rob = document.getElementById('impaDetailRobBanner');
        const cart = document.querySelector('#impaDetailModal .impa-detail-cart');
        const cta = document.getElementById('impaDetailPublicCta');
        const lockedPreview = document.getElementById('impaDetailLockedPreview');
        const bottomClose = document.querySelector('#impaDetailModal .impa-detail-close-bottom');
        const shipservLayout = document.getElementById('impaDetailShipservLayout');
        const pmsLayout = document.getElementById('impaDetailPmsLayout');
        const headerTitle = document.getElementById('impaDetailTitle');
        if (_publicMode) {
            rob?.classList.add('hidden');
            cart?.classList.add('hidden');
            cta?.classList.add('hidden');
            lockedPreview?.classList.add('hidden');
            bottomClose?.classList.add('hidden');
            shipservLayout?.classList.remove('hidden');
            pmsLayout?.classList.add('hidden');
            headerTitle?.classList.add('hidden');
            document.getElementById('impaDetailModal')?.classList.add('impa-detail-modal-public');
        } else {
            rob?.classList.remove('hidden');
            cart?.classList.remove('hidden');
            cta?.classList.add('hidden');
            lockedPreview?.classList.add('hidden');
            bottomClose?.classList.remove('hidden');
            shipservLayout?.classList.add('hidden');
            pmsLayout?.classList.remove('hidden');
            headerTitle?.classList.remove('hidden');
            document.getElementById('impaDetailModal')?.classList.remove('impa-detail-modal-public');
        }
    }

    function setPublicMode(enabled) {
        _publicMode = !!enabled;
        if (_publicMode) {
            document.documentElement.classList.add('store-public-mode');
            TVC_StoreManager.enableMemorySearch(true);
        }
        applyModalPublicMode();
    }

    function isPublicMode() {
        return _publicMode;
    }

    function emptyCatalogMessage(query) {
        if ((query || '').trim()) return 'No items match your search.';
        if (_publicMode) return 'No catalog items available.';
        return 'No catalog items yet. Use Import CSV/JSON to load IMPA master data.';
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

    function resolvePlateId(item) {
        return item.plate_id || item.plate_no
            || TVC_ImpaSchema.derivePlateId(item.impa_code || item.code);
    }

    function plateLoadingHtml(plateId) {
        const id = esc(plateId || '—');
        return `
            <div class="impa-plate-loading" role="status" aria-live="polite">
                <div class="impa-plate-loading-spinner" aria-hidden="true"></div>
                <p class="impa-plate-loading-text">Loading drawing plate… <span class="impa-plate-loading-id">${id}</span></p>
            </div>`;
    }

    function platePendingHtml(item, plateId, reason) {
        const code = esc(item.impa_code || item.code || '—');
        const id = esc(plateId || '—');
        const name = esc(item.name || 'IMPA Item');
        const offline = reason === 'offline' || (typeof navigator !== 'undefined' && !navigator.onLine);
        const title = offline ? 'Drawing plate download pending' : 'Cannot load drawing plate';
        const subtitle = offline
            ? 'You are offline. Reconnect and try again.'
            : 'Drawing plate is not cached yet.';
        return `
            <svg class="impa-plate-placeholder-svg" viewBox="0 0 480 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}">
                <rect width="480" height="360" fill="#f0f4f8"/>
                <rect x="8" y="8" width="464" height="344" fill="none" stroke="#a0aec0" stroke-width="2" stroke-dasharray="8 6"/>
                <rect x="24" y="24" width="436" height="52" fill="#4a5568"/>
                <text x="242" y="56" text-anchor="middle" fill="#fff" font-family="ui-sans-serif,system-ui" font-size="15" font-weight="700">${title}</text>
                <path d="M200 150 L240 190 L280 150" fill="none" stroke="#2b6cb0" stroke-width="3" stroke-linecap="round"/>
                <line x1="240" y1="190" x2="240" y2="250" stroke="#2b6cb0" stroke-width="3" stroke-linecap="round"/>
                <rect x="210" y="250" width="60" height="40" rx="4" fill="none" stroke="#2b6cb0" stroke-width="2"/>
                <text x="240" y="218" text-anchor="middle" fill="#2b6cb0" font-family="ui-monospace,monospace" font-size="22">↓</text>
                <text x="32" y="310" fill="#2d3748" font-family="ui-monospace,monospace" font-size="11">IMPA ${code} · ${id}</text>
                <text x="32" y="328" fill="#4a5568" font-family="ui-sans-serif,system-ui" font-size="10">${name}</text>
            </svg>
            <p class="impa-detail-plate-fallback-msg">${subtitle}</p>`;
    }

    function platePlaceholderHtml(item) {
        return platePendingHtml(item, resolvePlateId(item), 'missing');
    }

    function revokePlateObjectUrl() {
        if (_plateObjectUrl) {
            URL.revokeObjectURL(_plateObjectUrl);
            _plateObjectUrl = null;
        }
    }

    function showPlatePending(item, targets, plateId, reason) {
        const { img, fallback, viewport, zoomBtn, fsImg } = targets;
        viewport?.classList?.remove('has-photo', 'is-loading');
        revokePlateObjectUrl();
        if (img) {
            img.hidden = true;
            img.removeAttribute('src');
        }
        if (fallback) {
            fallback.innerHTML = fallback.id === 'impaDetailProductFallback'
                ? productFallbackSvg(item)
                : platePendingHtml(item, plateId, reason);
            fallback.hidden = false;
        }
        if (zoomBtn) zoomBtn.hidden = true;
        if (fsImg) fsImg.removeAttribute('src');
    }

    async function bindPlateImage(item) {
        const targets = _publicMode ? productPhotoTargets() : platePhotoTargets();
        const { img, fallback, caption, zoomBtn, fsImg, fsTitle, viewport } = targets;
        if (!img || !fallback) return;

        const loadToken = ++_plateLoadToken;
        _plateZoom?.reset();
        _plateFullscreen?.reset();
        revokePlateObjectUrl();

        const plateId = resolvePlateId(item);
        const code = item.impa_code || item.code || '';
        if (caption) {
            caption.textContent = plateId
                ? `Catalog Plate · ${plateId}`
                : 'IMPA Catalog Plate';
        }
        if (fsTitle) fsTitle.textContent = `${code} — ${item.name || 'Catalog plate'}`;

        img.hidden = true;
        fallback.hidden = false;
        fallback.innerHTML = fallback.id === 'impaDetailProductFallback'
            ? '<p class="impa-shipserv-photo-loading" role="status">Loading product photo…</p>'
            : plateLoadingHtml(plateId);
        if (zoomBtn) zoomBtn.hidden = true;
        img.alt = `${item.name || 'IMPA item'}${_publicMode ? '' : ' catalog plate'}`;
        viewport?.classList.remove('has-photo');
        viewport?.classList.add('is-loading');

        if (!plateId) {
            viewport?.classList.remove('is-loading');
            showPlatePending(item, targets, plateId, 'no-id');
            return;
        }

        const result = await TVC_PlateImageCache.fetchPlate(plateId);
        if (loadToken !== _plateLoadToken) return;

        viewport?.classList.remove('is-loading');

        if (!result.ok || !result.objectUrl) {
            showPlatePending(item, targets, plateId, result.reason);
            return;
        }

        _plateObjectUrl = result.objectUrl;
        const onLoaded = () => {
            if (loadToken !== _plateLoadToken) return;
            viewport?.classList.add('has-photo');
            img.hidden = false;
            fallback.hidden = true;
            if (zoomBtn) zoomBtn.hidden = false;
            if (fsImg) {
                fsImg.src = result.objectUrl;
                fsImg.alt = img.alt;
            }
        };

        img.onload = onLoaded;
        img.onerror = () => {
            if (loadToken !== _plateLoadToken) return;
            showPlatePending(item, targets, plateId, 'decode-failed');
        };
        img.src = result.objectUrl;
        img.loading = 'eager';
        img.decoding = 'async';
        if (img.complete && img.naturalWidth > 0) onLoaded();
    }

    function productPhotoTargets() {
        return {
            img: document.getElementById('impaDetailProductImg'),
            fallback: document.getElementById('impaDetailProductFallback'),
            viewport: document.getElementById('impaDetailProductPhoto'),
            zoomBtn: null,
            fsImg: null,
            caption: null,
            fsTitle: null,
        };
    }

    function platePhotoTargets() {
        return {
            img: document.getElementById('impaDetailPlateImg'),
            fallback: document.getElementById('impaDetailPlateFallback'),
            viewport: document.getElementById('impaDetailPlateViewport'),
            zoomBtn: document.getElementById('impaDetailZoomBtn'),
            fsImg: document.getElementById('impaPlateFullscreenImg'),
            caption: document.getElementById('impaDetailPlateCaption'),
            fsTitle: document.getElementById('impaPlateFullscreenTitle'),
        };
    }

    function extractDimensions(item) {
        const specs = item?.specs && typeof item.specs === 'object' ? item.specs : {};
        if (specs.Dimensions) return String(specs.Dimensions).trim();
        const name = String(item?.name || '');
        const match = name.match(/\d+(?:\.\d+)?\s*(?:mm|cm|m|mtr|inch|in|")\s*(?:x\s*\d+(?:\.\d+)?\s*(?:mm|cm|m|mtr|inch|in|")*)+/i);
        return match ? match[0].trim() : '';
    }

    function extractPackaging(item) {
        const unit = String(item?.unit || 'PCS').trim() || 'PCS';
        const name = String(item?.name || '');
        const match = name.match(/(\d+\s*(?:rolls?|rols|pcs|pieces?|boxes?|sets?)(?:\s*per\s*box)?)/i);
        return match ? `${unit} / ${match[1]}` : unit;
    }

    function extractMaterialSpec(item) {
        const specs = item?.specs && typeof item.specs === 'object' ? item.specs : {};
        if (specs.Material) return String(specs.Material).trim();
        if (specs.Standard) return String(specs.Standard).trim();
        const dims = extractDimensions(item);
        return dims || '—';
    }

    function cleanProductTitle(item) {
        let name = String(item?.name || '—');
        name = name.replace(/\s+\d+(?:\.\d+)?\s*(?:mm|cm|m|mtr|inch|in|")\s*(?:x\s*.+)?$/i, '');
        name = name.replace(/\s+\d+\s*(?:rolls?|rols|pcs|pieces?|boxes?|sets?)(?:\s*per\s*box)?.*$/i, '');
        return name.trim() || String(item?.name || '—');
    }

    function buildProductDescription(item) {
        const category = item?.category || 'Marine stores';
        const name = item?.name || 'this IMPA item';
        const dims = extractDimensions(item);
        const dimsNote = dims ? ` Typical size/spec: ${dims}.` : '';
        return `Shipboard ${category.toLowerCase()} — ${name}. Used for routine maintenance, provisioning, and spare inventory aboard commercial vessels.${dimsNote} Verify IMPA code and specifications against vessel needs before requisition.`;
    }

    function shipservSpecRows(item) {
        return `
            <tr>
                <th scope="row">Category</th>
                <td>${esc(item.category || '—')}</td>
            </tr>
            <tr>
                <th scope="row">UOM / Packaging</th>
                <td>${esc(extractPackaging(item))}</td>
            </tr>
            <tr>
                <th scope="row">Material / Spec</th>
                <td>${esc(extractMaterialSpec(item))}</td>
            </tr>`;
    }

    function productFallbackSvg(item) {
        const code = esc(item.impa_code || item.code || '—');
        const name = esc(cleanProductTitle(item));
        return `
            <svg class="impa-shipserv-photo-svg" viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Product image unavailable">
                <rect width="320" height="220" rx="8" fill="#f8fafc"/>
                <rect x="12" y="12" width="296" height="196" rx="6" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6 4"/>
                <circle cx="160" cy="92" r="28" fill="#e2e8f0"/>
                <path d="M148 92 L160 104 L172 92" fill="none" stroke="#64748b" stroke-width="2.5" stroke-linecap="round"/>
                <rect x="146" y="104" width="28" height="20" rx="3" fill="none" stroke="#64748b" stroke-width="2"/>
                <text x="160" y="150" text-anchor="middle" fill="#475569" font-family="ui-sans-serif,system-ui" font-size="12" font-weight="600">No product photo available</text>
                <text x="160" y="170" text-anchor="middle" fill="#64748b" font-family="ui-monospace,monospace" font-size="11">IMPA ${code}</text>
                <text x="160" y="188" text-anchor="middle" fill="#94a3b8" font-family="ui-sans-serif,system-ui" font-size="10">${name}</text>
            </svg>`;
    }

    function populateShipservDetail(item) {
        const code = item.impa_code || item.code || '';
        const badge = document.getElementById('impaDetailBadge');
        const title = document.getElementById('impaDetailProductTitle');
        const dimsEl = document.getElementById('impaDetailProductDims');
        const specBody = document.getElementById('impaDetailShipservSpec');
        const desc = document.getElementById('impaDetailProductDesc');
        if (badge) badge.textContent = code ? `IMPA ${code}` : 'IMPA';
        if (title) title.textContent = cleanProductTitle(item);
        const dims = extractDimensions(item);
        if (dimsEl) {
            dimsEl.textContent = dims;
            dimsEl.classList.toggle('hidden', !dims);
        }
        if (specBody) specBody.innerHTML = shipservSpecRows(item);
        if (desc) desc.textContent = buildProductDescription(item);
    }

    function specRows(item) {
        const specs = item.specs && typeof item.specs === 'object' ? item.specs : {};
        const priority = _publicMode
            ? ['Category', 'Unit of Measure', 'Material', 'Dimensions', 'Standard', 'Voltage', 'Grade', 'Finish', 'Certification']
            : ['Dimensions', 'Material', 'Voltage', 'Standard', 'Grade', 'Finish', 'Certification'];
        const rows = [];
        const used = new Set();

        if (_publicMode) {
            rows.push(['Category', item.category || '—']);
            rows.push(['Unit of Measure', item.unit || 'PCS']);
            used.add('Category');
            used.add('Unit of Measure');
        }

        priority.forEach(key => {
            if (used.has(key)) return;
            if (key === 'Category') {
                if (!_publicMode) rows.push([key, item.category || '—']);
                used.add(key);
                return;
            }
            if (key === 'Unit of Measure') {
                if (!_publicMode) rows.push([key, item.unit || 'PCS']);
                used.add(key);
                return;
            }
            if (specs[key] != null && String(specs[key]).trim() !== '') {
                rows.push([key, specs[key]]);
                used.add(key);
            }
        });

        if (!_publicMode) {
            rows.push(['Category', item.category || '—']);
            rows.push(['Unit of Measure', item.unit || 'PCS']);
        }
        const plateId = resolvePlateId(item);
        if (plateId) rows.push(['Plate ID', plateId]);

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
        return /^blob:/i.test(String(url || ''));
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
        if (_publicMode) {
            populateShipservDetail(item);
        } else {
            if (badge) badge.textContent = item.impa_code || item.code || 'IMPA';
            if (title) title.textContent = item.name || '—';
            if (specBody) specBody.innerHTML = specRows(item);
            if (robValue) {
                robValue.textContent = `${formatNum(item.rob ?? 0)} ${item.unit || ''}`.trim();
            }
            if (qtyInput) qtyInput.value = '1';
        }
        const msg = document.getElementById('impaDetailCartMsg');
        if (msg) msg.textContent = '';

        applyModalPublicMode();
        bindPlateImage(item);
        modal?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        if (_publicMode) {
            document.getElementById('modalCloseBtn')?.focus();
        } else {
            document.getElementById('impaDetailQty')?.focus();
        }
    }

    function closeImpaDetailModal() {
        closePlateFullscreen();
        _plateLoadToken += 1;
        revokePlateObjectUrl();
        document.getElementById('impaDetailModal')?.classList.add('hidden');
        document.body.style.overflow = '';
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

    function categoryOptionsHtml() {
        const cats = typeof TVC_StoreManager.getMemoryCategories === 'function'
            ? TVC_StoreManager.getMemoryCategories()
            : [];
        const opts = cats.map(c =>
            `<option value="${esc(c)}"${c === _categoryFilter ? ' selected' : ''}>${esc(c)}</option>`).join('');
        return `<option value="">All categories</option>${opts}`;
    }

    function toolbarHtml(search, cartCount) {
        const query = search?.query || '';
        if (_publicMode) {
            return `
            <div class="store-toolbar store-toolbar-public">
                <input type="search" class="store-search" placeholder="Search IMPA code, description, or category…"
                    aria-label="Search catalog" value="${esc(query)}" autocomplete="off" spellcheck="false">
                <select id="storeCategoryFilter" class="store-category-filter" aria-label="Filter by category">
                    ${categoryOptionsHtml()}
                </select>
                <span class="store-count" id="storeCatalogCount">${countLabel(search)}</span>
            </div>`;
        }
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
        const emptyMsg = emptyCatalogMessage(search.query);
        return `
            ${toolbarHtml(search, cartCount)}
            <p id="storeCapNote" class="store-cap-note${cap ? '' : ' hidden'}">${esc(cap)}</p>
            <p id="storeEmpty" class="store-empty${hasItems ? ' hidden' : ''}">${emptyMsg}</p>
            <div id="catalog-table-wrapper" class="store-vl-wrap${hasItems ? '' : ' hidden'}" role="table" aria-label="IMPA catalog">
                <div class="store-vl-head" role="row">
                    <span role="columnheader">IMPA Code</span>
                    <span role="columnheader">Description</span>
                    <span role="columnheader">Category</span>
                    <span class="store-vl-unit-head" role="columnheader">Unit</span>
                </div>
                <div id="storeVlScroll" class="store-vl-scroll table-scroll-container" tabindex="0"></div>
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

    function applyCategoryFilter(search) {
        if (!_categoryFilter) return search;
        const items = (search.items || []).filter(i => i.category === _categoryFilter);
        return { ...search, items, matched: items.length };
    }

    function paintSearchResults(root, search) {
        const filtered = _publicMode ? applyCategoryFilter(search) : search;
        const countEl = root.querySelector('#storeCatalogCount');
        if (countEl) countEl.textContent = countLabel(filtered);

        const capNote = root.querySelector('#storeCapNote');
        const cap = capNoteText(filtered);
        if (capNote) {
            capNote.textContent = cap;
            capNote.classList.toggle('hidden', !cap);
        }

        const items = filtered.items || [];
        const empty = root.querySelector('#storeEmpty');
        const wrap = root.querySelector('#catalog-table-wrapper');

        if (!items.length) {
            wrap?.classList.add('hidden');
            empty?.classList.remove('hidden');
            if (empty) empty.textContent = emptyCatalogMessage(filtered.query);
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
        const delay = _publicMode ? PUBLIC_SEARCH_DEBOUNCE_MS : SEARCH_DEBOUNCE_MS;
        _searchTimer = setTimeout(() => {
            _searchTimer = null;
            runSearch(root, query);
        }, delay);
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

        root.querySelector('#storeCategoryFilter')?.addEventListener('change', e => {
            _categoryFilter = e.target.value || '';
            paintSearchResults(root, TVC_StoreManager.getLastSearch());
        });

        if (!_publicMode) {
            ensureImportFileInput();
            root.querySelector('#storeImportBtn')?.addEventListener('click', () => {
                if (_importBusy) return;
                document.getElementById('storeImportFile')?.click();
            });
        }
    }

    function renderCatalog(root, search) {
        const state = search?.items ? search : TVC_StoreManager.getLastSearch();
        _listState.items = state.items || [];
        const cartCount = _publicMode ? 0 : TVC_StoreManager.getCartCount();

        destroyVirtualList();
        root.innerHTML = catalogShellHtml(state, cartCount);
        bindCatalogEvents(root);
        if (_listState.items.length) mountVirtualList(root);
        if (!_publicMode) updateCartBadge();
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
            if (_publicMode) await TVC_StoreManager.buildMemoryIndex();
            _mounted = true;
            renderCatalog(root, TVC_StoreManager.getLastSearch());
        } catch (err) {
            root.innerHTML = `<p class="store-error">${esc(err.message || 'Failed to load catalog')}</p>`;
        }
    }

    return {
        render,
        openImpaDetailModal,
        closeImpaDetailModal,
        setPublicMode,
        isPublicMode,
    };
})();
