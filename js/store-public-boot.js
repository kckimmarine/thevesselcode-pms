/* THE VESSEL CODE — Public IMPA catalog (no PMS login) */
(function () {
    function boot() {
        if (typeof TVC_StoreMenu === 'undefined') {
            const root = document.getElementById('storeMenuBody');
            if (root) {
                root.innerHTML = '<p class="store-error">Catalog UI failed to load.</p>';
            }
            return;
        }
        TVC_StoreMenu.setPublicMode(true);
        TVC_StoreMenu.render();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
