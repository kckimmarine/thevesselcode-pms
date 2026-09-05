/* THE VESSEL CODE — PWA bootstrap (service worker + mobile nav helpers) */
const TVC_PWA = (function () {
    const SW_URL = 'service-worker.js';

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
                        console.info('[TVC-PWA] New version installed — will apply on next visit or manual refresh.');
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

    function normalizeDateText(raw) {
        const s = String(raw ?? '').trim();
        if (!s) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
        if (iso) {
            return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
        }
        const us = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
        if (us) {
            return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
        }
        const digits = s.replace(/\D/g, '');
        if (digits.length === 8) {
            return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
        }
        return s;
    }

    function maskDateInput(el) {
        const digits = el.value.replace(/\D/g, '').slice(0, 8);
        if (!digits) {
            el.value = '';
            return;
        }
        let out = digits.slice(0, 4);
        if (digits.length > 4) out += '-' + digits.slice(4, 6);
        if (digits.length > 6) out += '-' + digits.slice(6, 8);
        el.value = out;
    }

    function syncDatePickerConstraints(textEl, pickerEl) {
        ['min', 'max'].forEach(attr => {
            const v = textEl.getAttribute(attr) || textEl.dataset[`tvcDate${attr[0].toUpperCase()}${attr.slice(1)}`];
            if (v) pickerEl.setAttribute(attr, v);
            else pickerEl.removeAttribute(attr);
        });
    }

    function resetNativePickerStyle(pickerEl) {
        if (!pickerEl) return;
        pickerEl.classList.remove('tvc-date-picker-open');
        pickerEl.style.position = '';
        pickerEl.style.left = '';
        pickerEl.style.top = '';
        pickerEl.style.width = '';
        pickerEl.style.height = '';
        pickerEl.style.opacity = '';
        pickerEl.style.pointerEvents = '';
        pickerEl.style.zIndex = '';
    }

    function openDatePicker(textEl, pickerEl, anchorEl) {
        if (textEl.disabled || textEl.readOnly) return;
        syncDatePickerConstraints(textEl, pickerEl);
        const v = normalizeDateText(textEl.value);
        pickerEl.value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
        const anchor = anchorEl || textEl;
        pickerEl.disabled = false;
        pickerEl.removeAttribute('disabled');
        pickerEl.readOnly = false;
        pickerEl.removeAttribute('readonly');
        try {
            if (typeof pickerEl.showPicker === 'function') {
                pickerEl.showPicker();
                return;
            }
        } catch (_) { /* iframe / browser policy */ }
        const rect = anchor.getBoundingClientRect();
        pickerEl.classList.add('tvc-date-picker-open');
        pickerEl.style.position = 'fixed';
        pickerEl.style.left = `${Math.max(8, rect.right - 30)}px`;
        pickerEl.style.top = `${rect.top}px`;
        pickerEl.style.width = '30px';
        pickerEl.style.height = `${Math.max(24, rect.height || 28)}px`;
        pickerEl.style.opacity = '0.02';
        pickerEl.style.pointerEvents = 'auto';
        pickerEl.style.zIndex = '100000';
        const cleanup = () => resetNativePickerStyle(pickerEl);
        pickerEl.addEventListener('blur', cleanup, { once: true });
        pickerEl.addEventListener('change', cleanup, { once: true });
        setTimeout(cleanup, 4000);
        try { pickerEl.focus({ preventScroll: true }); } catch (_) { /* noop */ }
        try { pickerEl.click(); } catch (_) { /* noop */ }
    }

    function bindDatePickerTrigger(el, handler) {
        if (!el || el._tvcPickerTriggerBound) return;
        el._tvcPickerTriggerBound = true;
        el.style.touchAction = 'manipulation';
        let lastTouch = 0;
        const run = (e) => {
            if (e.type === 'touchend') {
                e.preventDefault();
                lastTouch = Date.now();
                handler(e);
                return;
            }
            if (e.type === 'click' && Date.now() - lastTouch < 500) return;
            handler(e);
        };
        el.addEventListener('click', run);
        el.addEventListener('touchend', run, { passive: false });
    }

    function attachDatePicker(textEl) {
        if (textEl.dataset.tvcDatePicker) return;
        textEl.dataset.tvcDatePicker = '1';

        const wrap = document.createElement('span');
        wrap.className = 'tvc-date-input-wrap';
        wrap.style.position = 'relative';
        textEl.parentNode.insertBefore(wrap, textEl);
        wrap.appendChild(textEl);
        textEl.style.touchAction = 'manipulation';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tvc-date-picker-btn';
        btn.title = 'Pick date';
        btn.setAttribute('aria-label', 'Pick date');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1zm13 9H4v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9zM6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1v1a1 1 0 1 1-2 0V5H9v1a1 1 0 1 1-2 0V5H6a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1z"/></svg>';

        const picker = document.createElement('input');
        picker.type = 'date';
        picker.className = 'tvc-date-picker-native';
        picker.tabIndex = -1;
        picker.setAttribute('aria-hidden', 'true');

        const openPicker = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openDatePicker(textEl, picker, btn);
        };

        bindDatePickerTrigger(btn, openPicker);
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        bindDatePickerTrigger(textEl, (e) => {
            if (textEl.disabled || textEl.readOnly) return;
            if (e.target !== textEl) return;
            e.preventDefault();
            e.stopPropagation();
            openDatePicker(textEl, picker, btn);
        });

        picker.addEventListener('change', () => {
            if (!picker.value) return;
            textEl.value = normalizeDateText(picker.value);
            textEl.dispatchEvent(new Event('input', { bubbles: true }));
            textEl.dispatchEvent(new Event('change', { bubbles: true }));
        });

        const syncDisabled = () => {
            const off = !!(textEl.disabled || textEl.readOnly);
            btn.disabled = off;
        };
        syncDisabled();
        new MutationObserver(syncDisabled).observe(textEl, { attributes: true, attributeFilter: ['disabled', 'readonly'] });

        wrap.appendChild(btn);
        wrap.appendChild(picker);
    }

    const REPORT_MODAL_DATE_WF_KEYS = new Set(['workDate', 'reportDate', 'lastMaintDate', 'postponeDate']);

    function isMobileViewport() {
        try { return window.matchMedia('(max-width: 768px)').matches; } catch (_) { return false; }
    }

    function isReportModalDateInput(el) {
        if (!el || el.tagName !== 'INPUT') return false;
        if (el.dataset.tvcReportNativeDate) return false;
        if (el.dataset.nativeDate === '1') return true;
        const modal = el.closest('#workReportModal, #defectReportModal, #workPermitModal');
        if (!modal) return false;
        if (el.dataset.wp || el.dataset.df) return true;
        if (el.dataset.wf && REPORT_MODAL_DATE_WF_KEYS.has(el.dataset.wf)) return true;
        return false;
    }

    function handleReportDateClick(e, inputEl) {
        e.preventDefault();
        e.stopPropagation();
        if (!inputEl || inputEl.disabled) return;
        if (inputEl.readOnly && !inputEl.dataset.allowPicker) return;
        if (typeof inputEl.showPicker === 'function') {
            try {
                inputEl.showPicker();
                return;
            } catch (_) { /* browser policy */ }
        }
        try { inputEl.focus({ preventScroll: true }); } catch (_) { inputEl.focus(); }
    }

    function syncReportNativeDateMobileGuard(inputEl, btn) {
        const editable = !inputEl.disabled && !inputEl.classList.contains('wr-ro');
        if (isMobileViewport() && editable) {
            inputEl.setAttribute('readonly', 'readonly');
            inputEl.dataset.allowPicker = '1';
            inputEl.setAttribute('inputmode', 'none');
        } else if (inputEl.dataset.allowPicker) {
            inputEl.removeAttribute('readonly');
            delete inputEl.dataset.allowPicker;
        }
        if (btn) btn.disabled = !editable;
    }

    function ensureReportNativeDateInput(el) {
        if (!el || el.dataset.tvcReportNativeDate) return;
        el.dataset.tvcReportNativeDate = '1';

        if (el.type === 'text' || el.classList.contains('tvc-date-input')) {
            const v = normalizeDateText(el.value);
            el.type = 'date';
            el.value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
            el.classList.remove('tvc-date-input');
            el.removeAttribute('placeholder');
            el.removeAttribute('maxlength');
            el.removeAttribute('pattern');
        }
        el.type = 'date';
        el.classList.add('report-native-date');
        el.setAttribute('inputmode', 'none');
        el.setAttribute('autocomplete', 'off');
        if (el.value) {
            const v = normalizeDateText(el.value);
            el.value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
        }

        let wrap = el.closest('.report-native-date-wrap');
        if (!wrap) {
            wrap = document.createElement('span');
            wrap.className = 'tvc-date-input-wrap report-native-date-wrap';
            wrap.style.position = 'relative';
            el.parentNode.insertBefore(wrap, el);
            wrap.appendChild(el);
        }
        el.style.touchAction = 'manipulation';

        let btn = wrap.querySelector('.tvc-date-picker-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tvc-date-picker-btn';
            btn.title = 'Pick date';
            btn.setAttribute('aria-label', 'Pick date');
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1zm13 9H4v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9zM6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1v1a1 1 0 1 1-2 0V5H9v1a1 1 0 1 1-2 0V5H6a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1z"/></svg>';
            wrap.appendChild(btn);
        }
        btn.style.pointerEvents = 'auto';
        btn.style.touchAction = 'manipulation';

        const openPicker = (e) => handleReportDateClick(e, el);
        if (!el._tvcReportNativeDateBound) {
            el._tvcReportNativeDateBound = true;
            bindDatePickerTrigger(el, openPicker);
        }
        if (!btn._tvcReportNativeDateBound) {
            btn._tvcReportNativeDateBound = true;
            bindDatePickerTrigger(btn, openPicker);
            btn.addEventListener('mousedown', (e) => e.preventDefault());
        }

        syncReportNativeDateMobileGuard(el, btn);
        if (!el._tvcReportNativeDateObs) {
            el._tvcReportNativeDateObs = true;
            new MutationObserver(() => syncReportNativeDateMobileGuard(el, btn))
                .observe(el, { attributes: true, attributeFilter: ['disabled', 'readonly', 'class'] });
        }
    }

    function isBindableDateInput(el) {
        if (!el || el.tagName !== 'INPUT') return false;
        if (el.classList.contains('tvc-date-picker-native')) return false;
        if (el.dataset.tvcReportNativeDate) return false;
        if (isReportModalDateInput(el)) return true;
        if (el.dataset.tvcDateFmt || el.dataset.tvcDatePicker) return false;
        if (el.type === 'date') return true;
        return el.classList.contains('tvc-date-input');
    }

    function ensureDateInput(el) {
        if (isReportModalDateInput(el)) {
            ensureReportNativeDateInput(el);
            return;
        }
        if (!isBindableDateInput(el)) {
            if (el?.dataset?.tvcDateFmt && !el.dataset.tvcDatePicker) attachDatePicker(el);
            return;
        }
        el.dataset.tvcDateFmt = '1';
        if (el.hasAttribute('min')) el.dataset.tvcDateMin = el.getAttribute('min');
        if (el.hasAttribute('max')) el.dataset.tvcDateMax = el.getAttribute('max');
        el.classList.add('tvc-date-input');
        if (el.type === 'date') el.type = 'text';
        if (!el.placeholder) el.placeholder = 'YYYY-MM-DD';
        el.setAttribute('inputmode', 'numeric');
        el.setAttribute('maxlength', '10');
        el.setAttribute('pattern', '\\d{4}-\\d{2}-\\d{2}');
        el.setAttribute('autocomplete', 'off');
        if (el.value) el.value = normalizeDateText(el.value);
        if (!el._tvcDateInputBound) {
            el._tvcDateInputBound = true;
            el.addEventListener('input', () => maskDateInput(el));
            el.addEventListener('blur', () => {
                if (!el.value.trim()) {
                    el.value = '';
                    return;
                }
                el.value = normalizeDateText(el.value);
            });
        }
        attachDatePicker(el);
    }

    function bindDateTextInput(el) {
        ensureDateInput(el);
    }

    function initDateInputFormat(scope) {
        const root = scope && typeof scope.querySelectorAll === 'function' ? scope : document;
        root.querySelectorAll('#workReportModal input[data-wf], #defectReportModal input[data-df], #workPermitModal input[data-wp], input.report-native-date, input[data-native-date="1"]').forEach(el => {
            if (isReportModalDateInput(el) || el.classList.contains('report-native-date')) ensureReportNativeDateInput(el);
        });
        root.querySelectorAll('input[type="date"]:not(.tvc-date-picker-native):not(.report-native-date)').forEach(ensureDateInput);
        root.querySelectorAll('input.tvc-date-input:not([data-tvc-date-fmt]):not(.report-native-date)').forEach(ensureDateInput);
    }

    function bindDateInputFormatObserver() {
        if (window._tvcDateFmtObs) return;
        initDateInputFormat();
        let timer = null;
        const processAdded = (nodes) => {
            for (const node of nodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches?.('input[type="date"], input.tvc-date-input, input.report-native-date, input[data-native-date]') && isBindableDateInput(node)) {
                    ensureDateInput(node);
                }
                node.querySelectorAll?.('input[type="date"]:not(.tvc-date-picker-native), input.tvc-date-input:not([data-tvc-date-fmt]), input.report-native-date, input[data-native-date="1"]').forEach(el => {
                    if (isBindableDateInput(el)) ensureDateInput(el);
                });
            }
        };
        window._tvcDateFmtObs = new MutationObserver((mutations) => {
            const added = [];
            for (const m of mutations) {
                if (m.type === 'childList') m.addedNodes.forEach(n => added.push(n));
            }
            if (!added.length) return;
            clearTimeout(timer);
            timer = setTimeout(() => processAdded(added), 0);
        });
        window._tvcDateFmtObs.observe(document.body, { childList: true, subtree: true });
    }

    function isWebPortalHost() {
        try {
            if (typeof TVC_Config !== 'undefined' && TVC_Config.isWebDeploy?.()) return true;
        } catch (_) {}
        try {
            const h = String(location.hostname || '').toLowerCase();
            const q = new URLSearchParams(location.search);
            if (q.get('web') === '1' || q.get('embed') === '1') return true;
            if (!h || h === 'localhost' || h === '127.0.0.1') return false;
            if (h.endsWith('.vercel.app')) return true;
            return ['thevesselcode.com', 'www.thevesselcode.com', 'app.thevesselcode.com', 'pms.thevesselcode.com'].includes(h);
        } catch (_) { return false; }
    }

    async function clearStaleCachesOnWeb() {
        if (!isWebPortalHost()) return;
        try {
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            }
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.filter(k => k.startsWith('tvc-pms-')).map(k => caches.delete(k)));
            }
        } catch (err) {
            console.warn('[TVC-PWA] web cache clear', err);
        }
    }

    function boot() {
        bindConnectivity();
        initMobileNav();
        bindDateInputFormatObserver();
        if (isStandalone()) document.body.classList.add('pwa-standalone');
        if (isWebPortalHost()) clearStaleCachesOnWeb();
        else registerServiceWorker();
    }

    return { boot, toggleMobileNav, closeMobileNav, registerServiceWorker, initDateInputFormat, normalizeDateText };
})();

document.addEventListener('DOMContentLoaded', () => TVC_PWA.boot());
