/* Spare part notes & attachments (Spare History — Note tab) */
const TVC_SpareMeta = (function () {
    const KEY = 'tvc_spare_meta';

    function loadAll() {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
        catch { return {}; }
    }

    function saveAll(data) {
        localStorage.setItem(KEY, JSON.stringify(data));
    }

    function spareKey(spareId) {
        return String(spareId || '').trim();
    }

    function ensure(spareId) {
        const id = spareKey(spareId);
        const all = loadAll();
        if (!all[id]) {
            all[id] = { note: '', attachments: [] };
        }
        if (!Array.isArray(all[id].attachments)) all[id].attachments = [];
        return all[id];
    }

    function get(spareId) {
        return ensure(spareId);
    }

    function setNote(spareId, text) {
        const id = spareKey(spareId);
        const all = loadAll();
        const m = ensure(spareId);
        m.note = String(text ?? '');
        all[id] = m;
        saveAll(all);
    }

    function addAttachment(spareId, file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const id = spareKey(spareId);
                const all = loadAll();
                const m = ensure(spareId);
                m.attachments.push({
                    id: Date.now(),
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    dataUrl: reader.result,
                    uploaded_at: new Date().toISOString(),
                });
                all[id] = m;
                saveAll(all);
                resolve(m.attachments[m.attachments.length - 1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function removeAttachment(spareId, attachmentId) {
        const id = spareKey(spareId);
        const all = loadAll();
        const m = ensure(spareId);
        m.attachments = (m.attachments || []).filter(a => String(a.id) !== String(attachmentId));
        all[id] = m;
        saveAll(all);
    }

    return { get, setNote, addAttachment, removeAttachment };
})();
