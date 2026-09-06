/* THE VESSEL CODE — IMPA ship stores catalog */
const TVC_StoreManager = (function () {
    let _catalog = null;
    let _loadPromise = null;

    async function loadCatalog() {
        if (_catalog) return _catalog;
        if (_loadPromise) return _loadPromise;
        _loadPromise = fetch('/data/impa-catalog.json', { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load IMPA catalog (${res.status})`);
                return res.json();
            })
            .then(data => {
                _catalog = Array.isArray(data) ? data : [];
                return _catalog;
            })
            .catch(err => {
                _loadPromise = null;
                throw err;
            });
        return _loadPromise;
    }

    function getCatalog() {
        return _catalog ? _catalog.slice() : [];
    }

    function filterCatalog(query, items) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return items;
        return items.filter(item =>
            String(item.code || '').includes(q)
            || String(item.name || '').toLowerCase().includes(q)
            || String(item.category || '').toLowerCase().includes(q)
        );
    }

    return { loadCatalog, getCatalog, filterCatalog };
})();
