/* THE VESSEL CODE — STORE tab integration (wraps TVC_App.switchTab) */
(function () {
    function activateStoreTab() {
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === 'store');
        });
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById('tab-store')?.classList.remove('hidden');
        if (typeof TVC_StoreMenu !== 'undefined') TVC_StoreMenu.render();
        if (typeof TVC_PWA !== 'undefined') TVC_PWA.closeMobileNav();
        window.scrollTo(0, 0);
    }

    function patchSwitchTab() {
        if (!window.TVC_App || typeof TVC_App.switchTab !== 'function') return false;
        const original = TVC_App.switchTab.bind(TVC_App);
        TVC_App.switchTab = function (tab) {
            if (tab === 'store') {
                activateStoreTab();
                return;
            }
            return original(tab);
        };
        return true;
    }

    if (!patchSwitchTab()) {
        document.addEventListener('DOMContentLoaded', () => {
            if (!patchSwitchTab()) {
                setTimeout(patchSwitchTab, 0);
            }
        });
    }
})();
