/** TVC-PMS — unified confirm / alert dialogs (English, in-app modal) */
const TVC_Dialog = (function () {
    let pending = null;

    const KIND = {
        save: { confirmLabel: 'Save', cancelLabel: 'Cancel', confirmClass: 'btn-green' },
        confirm: { confirmLabel: 'Confirm', cancelLabel: 'Cancel', confirmClass: 'btn-green' },
        delete: { confirmLabel: 'Delete', cancelLabel: 'Cancel', confirmClass: 'btn-red' },
        cancel: { confirmLabel: 'Yes', cancelLabel: 'No', confirmClass: 'btn-green' },
        warning: { confirmLabel: 'Continue', cancelLabel: 'Cancel', confirmClass: 'btn-green' },
        alert: { confirmLabel: 'OK', cancelLabel: null, confirmClass: 'btn-green' },
        success: { confirmLabel: 'OK', cancelLabel: null, confirmClass: 'btn-green' },
        error: { confirmLabel: 'OK', cancelLabel: null, confirmClass: 'btn-red' },
    };

    function normalizeOpts(opts) {
        if (typeof opts === 'string') return { message: opts };
        return opts || {};
    }

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function modalEl() {
        return document.getElementById('tvcDialogModal');
    }

    function finish(value) {
        const fn = pending;
        pending = null;
        modalEl()?.classList.add('hidden');
        if (fn) fn(value);
    }

    function dismiss() {
        if (!pending) return;
        finish(false);
    }

    function onBackdrop(e) {
        if (e.target === modalEl()) dismiss();
    }

    function bindOnce() {
        const modal = modalEl();
        if (!modal || modal.dataset.dialogBound) return;
        modal.dataset.dialogBound = '1';
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && pending && !modal.classList.contains('hidden')) dismiss();
        });
    }

    function show(opts) {
        bindOnce();
        const o = normalizeOpts(opts);
        const kind = KIND[o.kind] ? o.kind : 'confirm';
        const defs = KIND[kind];
        const showCancel = o.showCancel !== false && defs.cancelLabel && kind !== 'alert' && kind !== 'success' && kind !== 'error';
        const modal = modalEl();
        const titleEl = document.getElementById('tvcDialogTitle');
        const msgEl = document.getElementById('tvcDialogMessage');
        const actionsEl = document.getElementById('tvcDialogActions');
        if (!modal || !msgEl || !actionsEl) {
            return Promise.resolve(showCancel ? window.confirm(o.message || '') : (window.alert(o.message || ''), true));
        }

        if (titleEl) {
            if (o.title) {
                titleEl.textContent = o.title;
                titleEl.classList.remove('hidden');
            } else {
                titleEl.textContent = '';
                titleEl.classList.add('hidden');
            }
        }
        msgEl.textContent = o.message || '';

        const confirmLabel = o.confirmLabel || defs.confirmLabel;
        const cancelLabel = o.cancelLabel || defs.cancelLabel;
        const confirmClass = o.confirmClass || defs.confirmClass;

        actionsEl.innerHTML = showCancel
            ? `<button type="button" class="btn ${confirmClass}" id="tvcDialogConfirmBtn">${esc(confirmLabel)}</button>
               <button type="button" class="btn" id="tvcDialogCancelBtn">${esc(cancelLabel)}</button>`
            : `<button type="button" class="btn ${confirmClass}" id="tvcDialogConfirmBtn">${esc(confirmLabel)}</button>`;

        return new Promise(resolve => {
            pending = resolve;
            modal.classList.remove('hidden');
            const confirmBtn = document.getElementById('tvcDialogConfirmBtn');
            const cancelBtn = document.getElementById('tvcDialogCancelBtn');
            confirmBtn?.focus();
            confirmBtn?.addEventListener('click', () => finish(true), { once: true });
            cancelBtn?.addEventListener('click', () => finish(false), { once: true });
        });
    }

    function confirm(opts) {
        const o = normalizeOpts(opts);
        return show({ ...o, kind: o.kind || 'confirm', showCancel: o.showCancel !== false });
    }

    function alert(opts) {
        const o = normalizeOpts(opts);
        return show({ ...o, kind: o.kind || 'alert', showCancel: false }).then(() => true);
    }

    function success(message, opts = {}) {
        return alert({ ...opts, kind: 'success', message });
    }

    function error(message, opts = {}) {
        return alert({ ...opts, kind: 'error', message });
    }

    return { confirm, alert, success, error, dismiss };
})();
