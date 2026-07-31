/* Registered spare-part vendors / companies (HQ quote view) — offline-first */
const TVC_Vendors = (function () {
    const STORAGE_KEY = 'tvc_registered_vendors_v1';
    const META_KEY = 'registered_vendors_v1';
    let _cache = null;

    function normalizeList(raw) {
        if (!Array.isArray(raw)) return [];
        return raw.filter(v => v && String(v.name || '').trim()).map(v => ({
            id: String(v.id || `V-${Date.now()}`),
            name: String(v.name || '').trim(),
        }));
    }

    function isValidVendorName(name) {
        const n = String(name || '').trim();
        if (!n || n === '—') return false;
        if (n.length < 2 || n.length > 48) return false;
        if (!/[A-Za-z\uAC00-\uD7A3]/.test(n)) return false;
        if (/^[\s.*\-_0-9]+$/.test(n)) return false;
        if (/^\.+$/.test(n)) return false;
        const low = n.toLowerCase();
        if (/received|receive\b|used one|old\b/.test(low)) return false;
        if (/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(n)) return false;
        if (/^(at|in|to)\s+/i.test(n)) return false;
        return true;
    }

    function readLocalStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return normalizeList(JSON.parse(raw));
        } catch (_) {}
        return [];
    }

    function writeLocalStorage(list) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
            return true;
        } catch (_) {
            return false;
        }
    }

    function persist(list) {
        writeLocalStorage(list);
        if (typeof TVC_DB !== 'undefined' && TVC_DB.setMeta) {
            TVC_DB.setMeta(META_KEY, list).catch(() => {});
        }
    }

    function sanitizeList(list) {
        const clean = (list || []).filter(v => isValidVendorName(v.name));
        const seen = new Set();
        return clean.filter(v => {
            const key = v.name.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function ensureCache() {
        if (!_cache) {
            const raw = readLocalStorage();
            const clean = sanitizeList(raw);
            _cache = clean;
            if (clean.length !== raw.length) persist(clean);
        }
        return _cache;
    }

    function listAll() {
        return ensureCache().slice();
    }

    function findById(id) {
        const target = String(id || '').trim();
        if (!target) return null;
        return ensureCache().find(v => v.id === target) || null;
    }

    function register(name) {
        const n = String(name || '').trim();
        if (!isValidVendorName(n)) return null;
        const list = ensureCache();
        const hit = list.find(v => v.name.toLowerCase() === n.toLowerCase());
        if (hit) return { ...hit };
        const entry = { id: `V-${Date.now()}`, name: n };
        list.push(entry);
        _cache = list;
        persist(list);
        return { ...entry };
    }

    function rename(id, name) {
        const target = String(id || '').trim();
        const n = String(name || '').trim();
        if (!target || !isValidVendorName(n)) return null;
        const list = ensureCache();
        const row = list.find(v => v.id === target);
        if (!row) return null;
        const dup = list.find(v => v.id !== target && v.name.toLowerCase() === n.toLowerCase());
        if (dup) return { ...dup };
        row.name = n;
        _cache = list;
        persist(list);
        return { ...row };
    }

    function remove(id) {
        const target = String(id || '').trim();
        if (!target) return listAll();
        const list = ensureCache().filter(v => v.id !== target);
        _cache = list;
        persist(list);
        return listAll();
    }

    function upsert(vendor) {
        const name = String(vendor?.name || '').trim();
        if (!isValidVendorName(name)) return listAll();
        const list = ensureCache();
        const id = String(vendor?.id || '').trim();
        const byId = id ? list.find(v => v.id === id) : null;
        const byName = list.find(v => v.name.toLowerCase() === name.toLowerCase());
        if (byId) {
            byId.name = name;
        } else if (byName) {
            if (id) byName.id = id;
        } else {
            list.push({ id: id || `V-${Date.now()}`, name });
        }
        _cache = list;
        persist(list);
        return listAll();
    }

    function listForPicker() {
        return { registered: listAll() };
    }

    async function hydrateFromMeta() {
        if (typeof TVC_DB === 'undefined' || !TVC_DB.getMeta) return;
        try {
            const fromMeta = await TVC_DB.getMeta(META_KEY);
            const metaList = sanitizeList(normalizeList(fromMeta));
            if (!metaList.length) return;
            const local = sanitizeList(readLocalStorage());
            if (local.length >= metaList.length) return;
            _cache = metaList;
            persist(metaList);
        } catch (_) {}
    }

    hydrateFromMeta();

    return { listAll, register, rename, remove, upsert, findById, listForPicker, isValidVendorName };
})();

if (typeof window !== 'undefined') window.TVC_Vendors = TVC_Vendors;
