/* THE VESSEL CODE — IMPA ship stores catalog */
const TVC_StoreManager = (function () {
    const CART_KEY = 'tvc_store_requisition_cart';

    let _catalog = null;
    let _loadPromise = null;

    function readCart() {
        try {
            const raw = localStorage.getItem(CART_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function writeCart(items) {
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(items));
        } catch { /* ignore */ }
    }

    async function fetchCatalogJson() {
        const res = await fetch('/data/impa-catalog.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load IMPA catalog (${res.status})`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    }

    async function seedImpaMasterFromJson() {
        const raw = await fetchCatalogJson();
        const rows = raw.map(item => TVC_ImpaSchema.fromCatalogJson(item));
        if (rows.length) await TVC_DB.bulkPut('impa_master', rows);
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_CATALOG_SEED, new Date().toISOString());
        return rows;
    }

    async function ensureImpaMaster() {
        await TVC_DB.open();
        const seeded = await TVC_DB.getMeta(TVC_META_KEYS.IMPA_CATALOG_SEED);
        let rows = await TVC_DB.getAll('impa_master');
        if (!seeded || !rows.length) {
            rows = await seedImpaMasterFromJson();
        }
        return rows.map(TVC_ImpaSchema.toUi).filter(Boolean);
    }

    async function loadCatalog() {
        if (_catalog) return _catalog;
        if (_loadPromise) return _loadPromise;
        _loadPromise = ensureImpaMaster()
            .then(items => {
                _catalog = items;
                return _catalog;
            })
            .catch(async err => {
                _loadPromise = null;
                try {
                    const raw = await fetchCatalogJson();
                    _catalog = raw.map(item => TVC_ImpaSchema.toUi(TVC_ImpaSchema.fromCatalogJson(item)));
                    return _catalog;
                } catch {
                    throw err;
                }
            });
        return _loadPromise;
    }

    function getCatalog() {
        return _catalog ? _catalog.slice() : [];
    }

    function getItemByCode(code) {
        const c = TVC_ImpaSchema.normalizeCode(code);
        return (_catalog || []).find(item => item.impa_code === c || item.code === c) || null;
    }

    function filterCatalog(query, items) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return items;
        return items.filter(item =>
            String(item.impa_code || item.code || '').includes(q)
            || String(item.name || '').toLowerCase().includes(q)
            || String(item.category || '').toLowerCase().includes(q)
        );
    }

    function getCart() {
        return readCart();
    }

    function getCartCount() {
        return readCart().reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
    }

    function addToCart(item, qty) {
        const code = TVC_ImpaSchema.normalizeCode(item?.impa_code || item?.code);
        const amount = Math.max(1, Math.floor(Number(qty) || 1));
        if (!code) return { ok: false, error: 'Invalid item.' };
        const cart = readCart();
        const existing = cart.find(line => line.impa_code === code);
        if (existing) {
            existing.qty = (Number(existing.qty) || 0) + amount;
            existing.name = item.name || existing.name;
            existing.unit = item.unit || existing.unit;
        } else {
            cart.push({
                impa_code: code,
                name: item.name || '',
                unit: item.unit || 'PCS',
                category: item.category || '',
                qty: amount,
                added_at: new Date().toISOString(),
            });
        }
        writeCart(cart);
        return { ok: true, cart, count: getCartCount() };
    }

    return {
        loadCatalog,
        getCatalog,
        getItemByCode,
        filterCatalog,
        getCart,
        getCartCount,
        addToCart,
    };
})();
