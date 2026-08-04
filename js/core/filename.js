/** Export filename — {vessel}_{type}_{scope}_{YYYYMMDD}_{seq}.{ext} */
const TVC_Filename = (function () {
    const SPARE_TYPE = {
        REQUISITION: 'requisition',
        QUOTATION: 'quotation',
        REPLY_EVALUATION: 'evaluation',
        PURCHASE_ORDER: 'order',
        RECEIVED: 'received',
        INVENTORY: 'inventory',
        ASSESSMENT: 'evaluation',
    };

    function todayTag() {
        return new Date().toISOString().slice(0, 10).replace(/-/g, '');
    }

    function vesselSlug(vesselId) {
        const s = String(vesselId || 'unknown')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
        return s || 'unknown';
    }

    function scopeToken(dept, isHq) {
        if (isHq) return 'hq';
        const d = String(dept || '').trim().toUpperCase();
        if (d === 'DECK') return 'deck';
        if (d === 'ENGINE') return 'engine';
        return 'engine';
    }

    function spareType(category) {
        const key = String(category || '').trim().toUpperCase();
        return SPARE_TYPE[key] || String(category || 'export').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    }

    async function nextSeq(prefix) {
        let rows = [];
        try {
            rows = await TVC_DB.getAll('sync_history');
        } catch (_) {}
        let max = 0;
        for (const r of rows) {
            const fn = String(r.filename || r.file_name || '');
            if (!fn.startsWith(prefix)) continue;
            const m = fn.match(/_(\d{3})\.[a-z0-9]+$/i);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        }
        return String(max + 1).padStart(3, '0');
    }

    /**
     * @param {{ vesselId?: string, type: string, scope?: string, department?: string, isHq?: boolean, ext?: string, dateTag?: string }} opts
     */
    async function build(opts = {}) {
        const vessel = vesselSlug(opts.vesselId);
        const type = String(opts.type || 'export').toLowerCase();
        const scope = opts.scope || scopeToken(opts.department, opts.isHq);
        const dateTag = opts.dateTag || todayTag();
        const ext = String(opts.ext || 'zip').replace(/^\./, '');
        const prefix = `${vessel}_${type}_${scope}_${dateTag}_`;
        const seq = await nextSeq(prefix);
        return `${prefix}${seq}.${ext}`;
    }

    return {
        vesselSlug,
        scopeToken,
        spareType,
        todayTag,
        nextSeq,
        build,
    };
})();
