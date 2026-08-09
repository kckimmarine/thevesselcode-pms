/** Modal drag — grab navy title bars (e.g. .wr-titlebar) to reposition within viewport */
window.TVC_ModalDrag = (function () {
    const HANDLE_SEL = '.wr-titlebar, .modal-drag-handle';
    const NO_DRAG_MODAL_IDS = new Set(['workReportModal', 'defectReportModal', 'workPermitModal']);
    let drag = null;

    function resetBox(box) {
        if (!box) return;
        box.classList.remove('modal-is-dragged');
        box.style.position = '';
        box.style.left = '';
        box.style.top = '';
        box.style.margin = '';
        box.style.transform = '';
    }

    function resetModal(modal) {
        if (!modal) return;
        modal.querySelectorAll('.modal-box').forEach(resetBox);
    }

    function observeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            if (modal.dataset.dragObs) return;
            modal.dataset.dragObs = '1';
            new MutationObserver(() => {
                if (modal.classList.contains('hidden')) resetModal(modal);
            }).observe(modal, { attributes: true, attributeFilter: ['class'] });
        });
    }

    function onPointerDown(e) {
        const handle = e.target.closest(HANDLE_SEL);
        if (!handle || e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea')) return;
        const box = handle.closest('.modal-box');
        const modal = box?.closest('.modal');
        if (!box || !modal || modal.classList.contains('hidden')) return;
        if (NO_DRAG_MODAL_IDS.has(modal.id) || handle.classList.contains('modal-no-drag')) return;

        e.preventDefault();
        const rect = box.getBoundingClientRect();
        box.classList.add('modal-is-dragged');
        box.style.position = 'fixed';
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.margin = '0';
        box.style.transform = 'none';

        drag = {
            box,
            handle,
            ox: e.clientX - rect.left,
            oy: e.clientY - rect.top,
            pid: e.pointerId,
        };
        try { handle.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    }

    function onPointerMove(e) {
        if (!drag || (drag.pid != null && e.pointerId !== drag.pid)) return;
        e.preventDefault();
        const w = drag.box.offsetWidth;
        const h = drag.box.offsetHeight;
        const pad = 8;
        const x = Math.min(Math.max(pad, e.clientX - drag.ox), window.innerWidth - w - pad);
        const y = Math.min(Math.max(pad, e.clientY - drag.oy), window.innerHeight - h - pad);
        drag.box.style.left = `${x}px`;
        drag.box.style.top = `${y}px`;
    }

    function endDrag(e) {
        if (!drag) return;
        if (e && drag.pid != null && e.pointerId !== drag.pid) return;
        try { drag.handle?.releasePointerCapture?.(drag.pid); } catch (_) { /* noop */ }
        drag = null;
    }

    function init() {
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', endDrag);
        document.addEventListener('pointercancel', endDrag);
        const boot = () => observeModals();
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
    }

    init();
    return { resetModal, observeModals };
})();
