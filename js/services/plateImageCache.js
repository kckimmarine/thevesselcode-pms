/* IMPA plate on-demand loader — CacheStorage LRU (max 50) */
const TVC_PlateImageCache = (function () {
    const CACHE_NAME = 'tvc-impa-plates-lru';
    const LRU_KEY = 'tvc_plate_lru_order_v1';
    const MAX_ENTRIES = 50;

    function readLru() {
        try {
            const raw = localStorage.getItem(LRU_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function writeLru(order) {
        try {
            localStorage.setItem(LRU_KEY, JSON.stringify(order));
        } catch { /* quota */ }
    }

    async function openCache() {
        if (!('caches' in window)) return null;
        try {
            return await caches.open(CACHE_NAME);
        } catch {
            return null;
        }
    }

    function assetUrl(plateId) {
        return TVC_ImpaSchema.resolvePlateAssetUrl(plateId);
    }

    async function evictOldest(cache, order) {
        while (order.length > MAX_ENTRIES) {
            const url = order.shift();
            if (url && cache) await cache.delete(url).catch(() => {});
        }
        return order;
    }

    async function touch(cache, url) {
        let order = readLru().filter(u => u !== url);
        order.push(url);
        order = await evictOldest(cache, order);
        writeLru(order);
    }

    /**
     * Fetch plate webp on demand. Returns blob object URL or failure reason.
     * @returns {Promise<{ok:boolean, objectUrl?:string, fromCache?:boolean, reason?:string}>}
     */
    async function fetchPlate(plateId) {
        const url = assetUrl(plateId);
        if (!url) return { ok: false, reason: 'no-id' };

        const cache = await openCache();

        if (cache) {
            const hit = await cache.match(url);
            if (hit) {
                await touch(cache, url);
                const blob = await hit.blob();
                return { ok: true, objectUrl: URL.createObjectURL(blob), fromCache: true };
            }
        }

        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            if (cache) {
                await cache.put(url, new Response(blob.slice(), {
                    headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/webp' },
                }));
                await touch(cache, url);
            }
            return { ok: true, objectUrl: URL.createObjectURL(blob), fromCache: false };
        } catch (err) {
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
            return { ok: false, reason: offline ? 'offline' : 'fetch-failed', error: err };
        }
    }

    async function clearAll() {
        writeLru([]);
        if ('caches' in window) await caches.delete(CACHE_NAME).catch(() => {});
    }

    function getStats() {
        return { maxEntries: MAX_ENTRIES, cachedUrls: readLru().length };
    }

    return { fetchPlate, assetUrl, clearAll, getStats, MAX_ENTRIES, CACHE_NAME };
})();
