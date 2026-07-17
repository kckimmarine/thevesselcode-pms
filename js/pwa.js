/* THE VESSEL CODE — PWA bootstrap (service worker + mobile nav helpers) */
const TVC_PWA = (function () {
    const SW_URL = 'service-worker.js?v=20260717-wp-fix3';

    function canRegister() {
        return 'serviceWorker' in navigator
            && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
    }

    async function registerServiceWorker() {
        if (!canRegister()) return null;
        try {
            const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
            reg.addEventListener('updatefound', () => {
                const worker = reg.installing;
                if (!worker) return;
                worker.addEventListener('statechange', () => {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.info('[TVC-PWA] New version — reloading.');
                        window.location.reload();
                    }
                });
            });
            return reg;
        } catch (err) {
            console.warn('[TVC-PWA] Service worker registration failed:', err);
            return null;
        }
    }

    function setOnlineStatus(online) {
        document.body.classList.toggle('is-offline', !online);
        const el = document.getElementById('pwaOfflineBadge');
        if (el) el.classList.toggle('hidden', online);
    }

    function bindConnectivity() {
        setOnlineStatus(navigator.onLine);
        window.addEventListener('online', () => setOnlineStatus(true));
        window.addEventListener('offline', () => setOnlineStatus(false));
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    function initMobileNav() {
        const btn = document.getElementById('mobileNavBtn');
        const backdrop = document.getElementById('mobileNavBackdrop');
        if (!btn || !backdrop) return;

        btn.addEventListener('click', () => toggleMobileNav());
        backdrop.addEventListener('click', () => closeMobileNav());
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeMobileNav();
        });
    }

    function toggleMobileNav(force) {
        const open = typeof force === 'boolean' ? force : !document.body.classList.contains('mobile-nav-open');
        document.body.classList.toggle('mobile-nav-open', open);
        const btn = document.getElementById('mobileNavBtn');
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function closeMobileNav() {
        toggleMobileNav(false);
    }

    function initDateInputFormat(scope) {
        const root = scope && typeof scope.querySelectorAll === 'function' ? scope : document;
        root.querySelectorAll('input[type="date"]').forEach(el => {
            if (!el.getAttribute('lang')) el.setAttribute('lang', 'en-US');
            const sync = () => el.classList.toggle('tvc-date-empty', !el.value);
            sync();
            if (el.dataset.tvcDateFmt) return;
            el.dataset.tvcDateFmt = '1';
            el.addEventListener('input', sync);
            el.addEventListener('change', sync);
        });
    }

    function bindDateInputFormatObserver() {
        if (window._tvcDateFmtObs) return;
        initDateInputFormat();
        window._tvcDateFmtObs = new MutationObserver(() => initDateInputFormat());
        window._tvcDateFmtObs.observe(document.body, { childList: true, subtree: true });
    }

    function boot() {
        bindConnectivity();
        initMobileNav();
        bindDateInputFormatObserver();
        if (isStandalone()) document.body.classList.add('pwa-standalone');
        registerServiceWorker();
    }

    return { boot, toggleMobileNav, closeMobileNav, registerServiceWorker, initDateInputFormat };
})();

document.addEventListener('DOMContentLoaded', () => TVC_PWA.boot());
