/* THE VESSEL CODE — Public IMPA catalog (no PMS login) */
(function () {
    async function boot() {
        if (typeof TVC_StoreMenu === 'undefined') {
            const root = document.getElementById('storeMenuBody');
            if (root) root.innerHTML = '<p class="store-error">Catalog UI failed to load.</p>';
            return;
        }

        TVC_StoreManager.enableMemorySearch(true);
        TVC_StoreMenu.setPublicMode(true);

        if (typeof TVC_MaritimeToolkit !== 'undefined') {
            TVC_MaritimeToolkit.init();
        }

        if (typeof TVC_StorePublicLead !== 'undefined') {
            TVC_StorePublicLead.init();
        }

        if (typeof TVC_StorePublicPullRefresh !== 'undefined') {
            TVC_StorePublicPullRefresh.init();
        }

        try {
            await TVC_StoreManager.loadCatalog();
            await TVC_StoreManager.buildMemoryIndex();
        } catch (err) {
            console.warn('[store-public] catalog preload', err);
        }

        await TVC_StoreMenu.render();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
