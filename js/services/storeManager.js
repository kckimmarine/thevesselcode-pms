/* THE VESSEL CODE — IMPA ship stores catalog */
const TVC_StoreManager = (function () {
    const CART_KEY = 'tvc_store_requisition_cart';
    const CHUNK_SIZE = 1000;
    const DISPLAY_CAP = 500;

    let _catalog = null;
    let _loadPromise = null;
    let _totalCount = 0;
    let _importAbort = null;

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

    function yieldToMain() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    function invalidateCatalogCache() {
        _catalog = null;
        _loadPromise = null;
    }

    async function fetchCatalogJson() {
        const res = await fetch('/data/impa-catalog.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load IMPA catalog (${res.status})`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    }

    async function putImpaChunk(records) {
        if (!records.length) return 0;
        await TVC_DB.open();
        return TVC_DB.bulkPut('impa_master', records);
    }

    function toDbRecords(rows, ts) {
        const stamp = ts || new Date().toISOString();
        const out = [];
        for (const raw of rows) {
            const row = TVC_ImpaSchema.fromCatalogJson(raw);
            if (!row?.impa_code) continue;
            out.push({ ...row, updated_at: stamp });
        }
        return out;
    }

    async function seedImpaMasterFromJson() {
        const raw = await fetchCatalogJson();
        const rows = toDbRecords(raw);
        if (rows.length) await putImpaChunk(rows);
        const count = rows.length;
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_CATALOG_SEED, new Date().toISOString());
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_CATALOG_COUNT, count);
        _totalCount = count;
        return rows;
    }

    async function readRowsFromDb() {
        await TVC_DB.open();
        const rows = await TVC_DB.getAll('impa_master');
        _totalCount = rows.length;
        const countMeta = await TVC_DB.getMeta(TVC_META_KEYS.IMPA_CATALOG_COUNT);
        if (countMeta != null && Number(countMeta) > _totalCount) {
            _totalCount = Number(countMeta);
        }
        return rows;
    }

    async function ensureImpaMaster() {
        await TVC_DB.open();
        let rows = await TVC_DB.getAll('impa_master');
        if (!rows.length) {
            rows = await seedImpaMasterFromJson();
        } else {
            _totalCount = rows.length;
            const countMeta = await TVC_DB.getMeta(TVC_META_KEYS.IMPA_CATALOG_COUNT);
            if (countMeta != null) _totalCount = Number(countMeta) || rows.length;
        }
        return rows.map(TVC_ImpaSchema.toUi).filter(Boolean);
    }

    async function loadCatalog(options = {}) {
        if (!options.force && _catalog) return _catalog;
        if (!options.force && _loadPromise) return _loadPromise;
        _loadPromise = ensureImpaMaster()
            .then(items => {
                _catalog = items;
                _totalCount = items.length;
                return _catalog;
            })
            .catch(async err => {
                _loadPromise = null;
                try {
                    const raw = await fetchCatalogJson();
                    _catalog = raw.map(item => TVC_ImpaSchema.toUi(TVC_ImpaSchema.fromCatalogJson(item))).filter(Boolean);
                    _totalCount = _catalog.length;
                    return _catalog;
                } catch {
                    throw err;
                }
            });
        return _loadPromise;
    }

    async function reloadCatalog() {
        invalidateCatalogCache();
        const items = await loadCatalog({ force: true });
        _totalCount = items.length;
        return items;
    }

    function getTotalCount() {
        if (_totalCount > 0) return _totalCount;
        return _catalog?.length || 0;
    }

    function getCatalog() {
        return _catalog ? _catalog.slice() : [];
    }

    function getDisplayItems(query, items) {
        const source = items || _catalog || [];
        const filtered = filterCatalog(query, source);
        const capped = filtered.length > DISPLAY_CAP ? filtered.slice(0, DISPLAY_CAP) : filtered;
        return { items: capped, filtered: filtered.length, total: getTotalCount(), capped: filtered.length > DISPLAY_CAP };
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

    function parseJsonRows(text) {
        const data = JSON.parse(text);
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.items)) return data.items;
        if (Array.isArray(data?.records)) return data.records;
        if (Array.isArray(data?.data)) return data.data;
        throw new Error('JSON must be an array or { items | records | data: [] }.');
    }

    async function importJsonFile(file, onProgress) {
        const text = await file.text();
        const rawRows = parseJsonRows(text);
        const total = rawRows.length;
        let imported = 0;
        let skipped = 0;
        const ts = new Date().toISOString();

        for (let i = 0; i < rawRows.length; i += CHUNK_SIZE) {
            if (_importAbort?.aborted) throw new Error('Import cancelled.');
            const slice = rawRows.slice(i, i + CHUNK_SIZE);
            const before = slice.length;
            const records = toDbRecords(slice, ts);
            skipped += before - records.length;
            await putImpaChunk(records);
            imported += records.length;
            onProgress?.({ imported, skipped, total, phase: 'writing' });
            await yieldToMain();
        }
        return { imported, skipped, total };
    }

    function importCsvFile(file, onProgress) {
        return new Promise((resolve, reject) => {
            if (typeof Papa === 'undefined') {
                reject(new Error('CSV parser (PapaParse) is not loaded.'));
                return;
            }
            let imported = 0;
            let skipped = 0;
            let total = 0;
            let buffer = [];
            const ts = new Date().toISOString();
            let parserRef = null;

            const flushBuffer = async () => {
                if (!buffer.length) return;
                const batch = buffer.splice(0, buffer.length);
                const records = toDbRecords(batch, ts);
                skipped += batch.length - records.length;
                await putImpaChunk(records);
                imported += records.length;
                onProgress?.({ imported, skipped, total: total || imported + skipped, phase: 'writing' });
                await yieldToMain();
            };

            parserRef = Papa.parse(file, {
                header: true,
                skipEmptyLines: 'greedy',
                worker: false,
                step: (results, parser) => {
                    if (_importAbort?.aborted) {
                        parser.abort();
                        reject(new Error('Import cancelled.'));
                        return;
                    }
                    total += 1;
                    buffer.push(results.data);
                    if (buffer.length >= CHUNK_SIZE) {
                        parser.pause();
                        flushBuffer()
                            .then(() => parser.resume())
                            .catch(err => {
                                parser.abort();
                                reject(err);
                            });
                    }
                    if (total % 250 === 0) {
                        onProgress?.({ imported, skipped, total, phase: 'parsing' });
                    }
                },
                complete: () => {
                    flushBuffer()
                        .then(() => resolve({ imported, skipped, total }))
                        .catch(reject);
                },
                error: err => reject(err),
            });
        });
    }

    async function bulkImportCatalog(file, { onProgress } = {}) {
        if (!file) throw new Error('No file selected.');
        const name = String(file.name || '').toLowerCase();
        _importAbort = new AbortController();
        await TVC_DB.open();

        onProgress?.({ imported: 0, skipped: 0, total: 0, phase: 'reading' });
        await yieldToMain();

        let result;
        if (name.endsWith('.json')) {
            result = await importJsonFile(file, onProgress);
        } else if (name.endsWith('.csv')) {
            result = await importCsvFile(file, onProgress);
        } else {
            throw new Error('Unsupported file type. Use .csv or .json');
        }

        const countRows = await readRowsFromDb();
        _totalCount = countRows.length;
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_CATALOG_SEED, new Date().toISOString());
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_CATALOG_COUNT, _totalCount);
        invalidateCatalogCache();
        _importAbort = null;

        onProgress?.({
            imported: result.imported,
            skipped: result.skipped,
            total: result.total,
            catalogTotal: _totalCount,
            phase: 'done',
        });

        return { ...result, catalogTotal: _totalCount };
    }

    function cancelBulkImport() {
        _importAbort?.abort();
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
        reloadCatalog,
        getCatalog,
        getTotalCount,
        getDisplayItems,
        getItemByCode,
        filterCatalog,
        bulkImportCatalog,
        cancelBulkImport,
        invalidateCatalogCache,
        getCart,
        getCartCount,
        addToCart,
        CHUNK_SIZE,
        DISPLAY_CAP,
    };
})();
