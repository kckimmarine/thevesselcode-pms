/* THE VESSEL CODE — IMPA ship stores catalog (50k+ optimized) */
const TVC_StoreManager = (function () {
    const CART_KEY = 'tvc_store_requisition_cart';
    const CHUNK_SIZE = 1000;
    const SEARCH_LIMIT = 50000;
    const BROWSE_PREVIEW = 500;
    const SEARCH_TARGET_MS = 50;

    let _totalCount = 0;
    let _loadPromise = null;
    let _importAbort = null;
    let _lastSearch = { query: '', items: [], matched: 0, ms: 0 };

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
        _loadPromise = null;
        _lastSearch = { query: '', items: [], matched: 0, ms: 0 };
    }

    function toLightRow(row) {
        if (!row?.impa_code) return null;
        const ui = TVC_ImpaSchema.toUi(row);
        return {
            impa_code: ui.impa_code,
            code: ui.code,
            name: ui.name,
            unit: ui.unit,
            category: ui.category,
            plate_no: ui.plate_no,
            catalog_page: ui.catalog_page,
            plate_image: ui.plate_image,
            rob: ui.rob,
            specs: ui.specs,
        };
    }

    async function refreshTotalCount() {
        await TVC_DB.open();
        const meta = await TVC_DB.getMeta(TVC_META_KEYS.IMPA_CATALOG_COUNT);
        const counted = await TVC_DB.countStore('impa_master');
        _totalCount = Math.max(Number(meta) || 0, counted);
        if (_totalCount !== counted) {
            await TVC_DB.setMeta(TVC_META_KEYS.IMPA_CATALOG_COUNT, counted);
            _totalCount = counted;
        }
        return _totalCount;
    }

    async function ensureSearchFieldsBackfill() {
        const done = await TVC_DB.getMeta(TVC_META_KEYS.IMPA_SEARCH_BACKFILL);
        if (done) return;
        const rows = await TVC_DB.getAll('impa_master');
        if (!rows.length) {
            await TVC_DB.setMeta(TVC_META_KEYS.IMPA_SEARCH_BACKFILL, new Date().toISOString());
            return;
        }
        const ts = new Date().toISOString();
        const patched = [];
        for (const row of rows) {
            if (row.name_lower && row.code_prefix && row.plate_no) continue;
            const enriched = TVC_ImpaSchema.enrichDbFields(row);
            patched.push({ ...row, ...enriched, updated_at: ts });
        }
        for (let i = 0; i < patched.length; i += CHUNK_SIZE) {
            await TVC_DB.bulkPut('impa_master', patched.slice(i, i + CHUNK_SIZE));
            await yieldToMain();
        }
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_SEARCH_BACKFILL, new Date().toISOString());
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
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_CATALOG_SEED, new Date().toISOString());
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_SEARCH_BACKFILL, new Date().toISOString());
        return rows.length;
    }

    async function upsertSeedCatalogFromJson() {
        const raw = await fetchCatalogJson();
        const rows = toDbRecords(raw);
        if (rows.length) await putImpaChunk(rows);
        return rows.length;
    }

    async function ensureImpaMaster() {
        await TVC_DB.open();
        let count = await TVC_DB.countStore('impa_master');
        if (!count) {
            count = await seedImpaMasterFromJson();
        } else {
            const photosMigrated = await TVC_DB.getMeta(TVC_META_KEYS.IMPA_CATALOG_PHOTOS);
            if (!photosMigrated) {
                await upsertSeedCatalogFromJson();
                await TVC_DB.setMeta(TVC_META_KEYS.IMPA_CATALOG_PHOTOS, new Date().toISOString());
                count = await TVC_DB.countStore('impa_master');
            }
        }
        _totalCount = count;
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_CATALOG_COUNT, count);
        return count;
    }

    async function loadCatalog(options = {}) {
        if (!options.force && _loadPromise) return _loadPromise;
        _loadPromise = ensureImpaMaster()
            .then(async count => {
                _totalCount = count;
                return searchCatalog('', { limit: BROWSE_PREVIEW });
            })
            .catch(err => {
                _loadPromise = null;
                throw err;
            });
        return _loadPromise;
    }

    async function reloadCatalog() {
        invalidateCatalogCache();
        await refreshTotalCount();
        return searchCatalog(_lastSearch.query || '', { limit: SEARCH_LIMIT });
    }

    function getTotalCount() {
        return _totalCount;
    }

    function getLastSearch() {
        return _lastSearch;
    }

    /** Indexed search — code prefix (6-digit) or name_lower prefix index */
    async function searchCatalog(query, { limit = SEARCH_LIMIT } = {}) {
        const started = performance.now();
        await TVC_DB.open();
        await ensureSearchFieldsBackfill();
        if (!_totalCount) await refreshTotalCount();

        const q = String(query || '').trim();
        const qLower = q.toLowerCase();
        let items = [];

        if (!q) {
            items = await TVC_DB.cursorMap('impa_master', {
                limit: Math.min(limit, BROWSE_PREVIEW),
                map: toLightRow,
            });
        } else if (/^\d{1,6}$/.test(q)) {
            const range = IDBKeyRange.bound(q, `${q}\uffff`);
            items = await TVC_DB.cursorMap('impa_master', { range, limit, map: toLightRow });
        } else if (q.length === 2 && /^\d{2}$/.test(q)) {
            const range = IDBKeyRange.only(q);
            items = await TVC_DB.cursorMap('impa_master', {
                indexName: 'by_code_prefix',
                range,
                limit,
                map: toLightRow,
            });
        } else {
            const range = IDBKeyRange.bound(qLower, `${qLower}\uffff`);
            items = await TVC_DB.cursorMap('impa_master', {
                indexName: 'by_name_lower',
                range,
                limit,
                map: toLightRow,
            });
            if (items.length < limit && qLower.length >= 2) {
                const bucket = qLower.slice(0, 2);
                const extra = await TVC_DB.cursorMap('impa_master', {
                    indexName: 'by_name_lower',
                    range: IDBKeyRange.bound(bucket, `${bucket}\uffff`),
                    limit: limit * 2,
                    map: row => {
                        const name = String(row?.name_lower || row?.name || '').toLowerCase();
                        if (!name.includes(qLower)) return null;
                        return toLightRow(row);
                    },
                });
                const seen = new Set(items.map(i => i.impa_code));
                for (const row of extra) {
                    if (!row || seen.has(row.impa_code)) continue;
                    items.push(row);
                    seen.add(row.impa_code);
                    if (items.length >= limit) break;
                }
            }
        }

        const ms = performance.now() - started;
        const matched = items.length;
        const browseLimited = !q && _totalCount > items.length;

        _lastSearch = {
            query: q,
            items,
            matched,
            total: _totalCount,
            ms,
            browseLimited,
            capped: matched >= limit,
        };

        if (ms > SEARCH_TARGET_MS && q) {
            console.info(`[TVC_Store] search "${q}" → ${matched} rows in ${ms.toFixed(1)}ms`);
        }

        return _lastSearch;
    }

    async function getItemByCode(code) {
        const c = TVC_ImpaSchema.normalizeCode(code);
        if (!c) return null;
        const cached = _lastSearch.items.find(i => i.impa_code === c);
        if (cached && cached.specs) return cached;
        await TVC_DB.open();
        const row = await TVC_DB.get('impa_master', c);
        return TVC_ImpaSchema.toUi(row);
    }

    function getCatalog() {
        return _lastSearch.items.slice();
    }

    function getDisplayItems(query, items) {
        const source = items || _lastSearch.items || [];
        const total = _totalCount || source.length;
        const q = String(query || '').trim();
        const filtered = q ? source.length : total;
        return {
            items: source,
            filtered,
            total,
            capped: _lastSearch.capped,
            browseLimited: _lastSearch.browseLimited,
            searchMs: _lastSearch.ms,
        };
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

            Papa.parse(file, {
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

        await refreshTotalCount();
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_CATALOG_SEED, new Date().toISOString());
        await TVC_DB.setMeta(TVC_META_KEYS.IMPA_SEARCH_BACKFILL, new Date().toISOString());
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
        searchCatalog,
        getCatalog,
        getTotalCount,
        getLastSearch,
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
        SEARCH_LIMIT,
        BROWSE_PREVIEW,
    };
})();
