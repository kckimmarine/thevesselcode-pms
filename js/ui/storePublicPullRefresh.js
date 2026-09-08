/* THE VESSEL CODE — Mobile pull-to-refresh for Maritime Toolkit */
const TVC_StorePublicPullRefresh = (function () {
    const THRESHOLD = 72;
    const MAX_PULL = 120;
    const SCROLL_SELECTORS = [
        '#storeVlScroll',
        '#storeToolBunker',
        '#storeToolLube',
        '#storeToolPaint',
        '#storeToolEngineering',
        '.maritime-table-wrap',
    ];

    let _ready = false;
    let _startY = 0;
    let _pulling = false;
    let _pullDistance = 0;
    let _scrollEl = null;
    let _activePanel = null;
    let _refreshing = false;
    let _indicator = null;

    function isMobile() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    function modalOpen() {
        const detail = document.getElementById('impaDetailModal');
        const lead = document.getElementById('storeLeadModal');
        return (detail && !detail.classList.contains('hidden'))
            || (lead && !lead.classList.contains('hidden'));
    }

    function resolveScrollContainer(target) {
        for (const sel of SCROLL_SELECTORS) {
            const el = target.closest(sel);
            if (el) return el;
        }
        const panel = target.closest('.store-public-panel:not(.hidden)');
        if (!panel) return null;
        return panel.querySelector('#storeVlScroll')
            || panel.querySelector('.maritime-table-wrap')
            || panel;
    }

    function atScrollTop(el) {
        if (!el) return false;
        return el.scrollTop <= 0;
    }

    function ensureIndicator() {
        if (_indicator) return _indicator;
        const shell = document.querySelector('.store-public-shell');
        if (!shell) return null;

        const el = document.createElement('div');
        el.id = 'storePullRefresh';
        el.className = 'store-pull-refresh';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = `
            <span class="store-pull-refresh-icon" aria-hidden="true">↓</span>
            <span class="store-pull-refresh-label">Pull to refresh</span>`;
        shell.prepend(el);
        _indicator = el;
        return el;
    }

    function setPullVisual(distance) {
        const indicator = ensureIndicator();
        if (!indicator) return;

        const clamped = Math.min(distance, MAX_PULL);
        const progress = Math.min(clamped / THRESHOLD, 1);
        const ready = clamped >= THRESHOLD;

        indicator.style.height = `${clamped}px`;
        indicator.style.opacity = clamped > 8 ? String(0.35 + progress * 0.65) : '0';
        indicator.classList.toggle('store-pull-refresh-ready', ready);
        indicator.querySelector('.store-pull-refresh-label').textContent = ready
            ? 'Release to refresh'
            : 'Pull to refresh';
        indicator.querySelector('.store-pull-refresh-icon').textContent = ready ? '↻' : '↓';

        if (_activePanel) {
            _activePanel.style.transform = clamped > 0 ? `translateY(${clamped}px)` : '';
        }
    }

    function resetPullVisual() {
        const indicator = ensureIndicator();
        indicator?.classList.remove('store-pull-refresh-ready', 'store-pull-refresh-active');
        if (indicator) {
            indicator.style.height = '0';
            indicator.style.opacity = '0';
            indicator.querySelector('.store-pull-refresh-label').textContent = 'Pull to refresh';
            indicator.querySelector('.store-pull-refresh-icon').textContent = '↓';
        }
        if (_activePanel) _activePanel.style.transform = '';
        document.body.classList.remove('store-pull-active');
    }

    async function refreshCatalog() {
        if (typeof TVC_StoreManager !== 'undefined') {
            await TVC_StoreManager.loadCatalog();
            if (typeof TVC_StoreManager.buildMemoryIndex === 'function') {
                await TVC_StoreManager.buildMemoryIndex();
            }
        }
        if (typeof TVC_StoreMenu !== 'undefined') {
            await TVC_StoreMenu.render();
        }
    }

    async function performRefresh() {
        if (_refreshing) return;
        _refreshing = true;
        const indicator = ensureIndicator();
        indicator?.classList.add('store-pull-refresh-active');
        const refreshLabel = indicator?.querySelector('.store-pull-refresh-label');
        const refreshIcon = indicator?.querySelector('.store-pull-refresh-icon');
        if (refreshLabel) refreshLabel.textContent = 'Refreshing…';
        if (refreshIcon) refreshIcon.textContent = '↻';

        try {
            const onCatalog = document.querySelector('[data-tool-tab="catalog"].active');
            if (onCatalog) {
                await refreshCatalog();
            } else {
                window.location.reload();
                return;
            }
        } catch (err) {
            console.warn('[store-public] pull refresh failed, reloading', err);
            window.location.reload();
            return;
        } finally {
            _refreshing = false;
            resetPullVisual();
            _pullDistance = 0;
            _pulling = false;
            _scrollEl = null;
            _activePanel = null;
        }
    }

    function onTouchStart(e) {
        if (!isMobile() || _refreshing || modalOpen() || e.touches.length !== 1) return;
        if (e.target.closest('#storePublicToolkit, .store-public-header, .store-public-footer, .modal')) return;

        _scrollEl = resolveScrollContainer(e.target);
        if (!_scrollEl || !atScrollTop(_scrollEl)) return;

        _activePanel = _scrollEl.closest('.store-public-panel') || _scrollEl;
        _startY = e.touches[0].clientY;
        _pulling = false;
        _pullDistance = 0;
    }

    function onTouchMove(e) {
        if (!isMobile() || _refreshing || !_scrollEl || e.touches.length !== 1) return;
        if (!atScrollTop(_scrollEl)) {
            _scrollEl = null;
            resetPullVisual();
            return;
        }

        const delta = e.touches[0].clientY - _startY;
        if (delta <= 0) {
            if (_pulling) resetPullVisual();
            _pulling = false;
            _pullDistance = 0;
            return;
        }

        _pulling = true;
        _pullDistance = Math.min(delta * 0.55, MAX_PULL);
        e.preventDefault();
        document.body.classList.add('store-pull-active');
        setPullVisual(_pullDistance);
    }

    function onTouchEnd() {
        if (!isMobile() || _refreshing || !_scrollEl) return;

        if (_pulling && _pullDistance >= THRESHOLD) {
            performRefresh();
            return;
        }

        resetPullVisual();
        _pulling = false;
        _pullDistance = 0;
        _scrollEl = null;
        _activePanel = null;
    }

    function init() {
        if (_ready || !document.querySelector('.store-public-shell')) return;
        _ready = true;
        ensureIndicator();

        document.addEventListener('touchstart', onTouchStart, { passive: true });
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd, { passive: true });
        document.addEventListener('touchcancel', onTouchEnd, { passive: true });
    }

    return { init, THRESHOLD };
})();
