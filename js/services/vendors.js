/* Registered spare-part vendors / companies (HQ quote view) — localStorage, offline-first */
const TVC_Vendors = (function () {
    const STORAGE_KEY = 'tvc_registered_vendors_v1';

    function readRaw() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (_) {}
        return [];
    }

    function writeRaw(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    function listAll() {
        return readRaw().filter(v => v && String(v.name || '').trim());
    }

    function findById(id) {
        const target = String(id || '').trim();
        if (!target) return null;
        return listAll().find(v => v.id === target) || null;
    }

    function register(name) {
        const n = String(name || '').trim();
        if (!n) return listAll();
        const list = listAll();
        const hit = list.find(v => v.name.toLowerCase() === n.toLowerCase());
        if (hit) return list;
        list.push({ id: `V-${Date.now()}`, name: n });
        writeRaw(list);
        return list;
    }

    function upsert(vendor) {
        const name = String(vendor?.name || '').trim();
        if (!name) return listAll();
        const list = listAll();
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
        writeRaw(list);
        return list;
    }

    function suggestionsFromSpares(spares) {
        const seen = new Set(listAll().map(v => v.name.toLowerCase()));
        const out = [];
        (spares || []).forEach(s => {
            [s.maker, s.vendorComment, s.vendor_comment].forEach(val => {
                const n = String(val || '').trim();
                if (!n || n === '—' || seen.has(n.toLowerCase())) return;
                seen.add(n.toLowerCase());
                out.push({ id: '', name: n, suggested: true });
            });
        });
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    function listForPicker(spares) {
        const registered = listAll();
        const suggested = suggestionsFromSpares(spares).filter(s =>
            !registered.some(r => r.name.toLowerCase() === s.name.toLowerCase()));
        return { registered, suggested };
    }

    return { listAll, register, upsert, findById, listForPicker, suggestionsFromSpares };
})();
