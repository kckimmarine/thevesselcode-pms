/** Export filename — {vessel}_{type}_{scope}_{YYYYMMDD}_{seq}.{ext}
 *  Case Report:         {vessel}_casereport_{engine|deck}_{YYYYMMDD}_{seq}.zip
 *  Case Report HQ reply:{vessel}_casereport_{engine|deck}_hq_{YYYYMMDD}_{seq}.zip
 *  HQ Work Permit reply: {vessel}_workpermit_{engine|deck}_hq_{YYYYMMDD}_{seq}.zip
 *  HQ Defect reply:     {vessel}_defect_{engine|deck}_hq_{YYYYMMDD}_{seq}.zip
 *  PMS Backup:          {vessel}_pms_backup_{engine|deck}_{YYYYMMDD}_{seq}.zip
 *  SPARE Backup:        {vessel}_spare_backup_{engine|deck}_{YYYYMMDD}_{seq}.zip */
const TVC_Filename = (function () {
    const SPARE_TYPE = {
        REQUISITION: 'requisition',
        QUOTATION: 'quotation',
        REPLY_EVALUATION: 'evaluation',
        PURCHASE_ORDER: 'order',
        RECEIVED: 'received',
        INVENTORY: 'spare_monthly',
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

    /** HQ reply export scope: engine_hq | deck_hq */
    function hqReplyScopeToken(dept) {
        return `${scopeToken(dept, false)}_hq`;
    }

    /** Master Hub SPARE master excel scope: engine_master | deck_master */
    function masterHubScopeToken(dept) {
        return `${scopeToken(dept, false)}_master`;
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
     * 4-token (no scope): {vessel}_{type}_{YYYYMMDD}_{seq}.{ext}
     * e.g. tvcno1_pms_master_20260804_001.xlsx
     */
    async function buildFlat(opts = {}) {
        const vessel = vesselSlug(opts.vesselId);
        const type = String(opts.type || 'export').toLowerCase();
        const dateTag = opts.dateTag || todayTag();
        const ext = String(opts.ext || 'xlsx').replace(/^\./, '');
        const prefix = `${vessel}_${type}_${dateTag}_`;
        const seq = await nextSeq(prefix);
        return `${prefix}${seq}.${ext}`;
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

    /** Parse scoped export filename (5- or 6-column Work Permit HQ reply). */
    function parseScoped(filename) {
        const base = String(filename || '').trim().replace(/\.[^./\\]+$/i, '');
        let m = base.match(/^([a-z0-9]+)_([a-z0-9_]+)_(engine|deck)_hq_(\d{8})_(\d{3})$/i);
        if (m) {
            const dept = m[3].toLowerCase();
            return {
                vessel: m[1],
                type: m[2].toLowerCase(),
                scope: `${dept}_hq`,
                department: dept,
                isHqReply: true,
                dateTag: m[4],
                seq: m[5],
            };
        }
        m = base.match(/^([a-z0-9]+)_([a-z0-9_]+)_(engine|deck)_master_(\d{8})_(\d{3})$/i);
        if (m) {
            const dept = m[3].toLowerCase();
            return {
                vessel: m[1],
                type: m[2].toLowerCase(),
                scope: `${dept}_master`,
                department: dept,
                isHqReply: false,
                dateTag: m[4],
                seq: m[5],
            };
        }
        m = base.match(/^([a-z0-9]+)_([a-z0-9_]+)_(hq|engine|deck|hub)_(\d{8})_(\d{3})$/i);
        if (!m) return null;
        const scope = m[3].toLowerCase();
        return {
            vessel: m[1],
            type: m[2].toLowerCase(),
            scope,
            department: scope === 'engine' || scope === 'deck' ? scope : null,
            isHqReply: scope === 'hq',
            dateTag: m[4],
            seq: m[5],
        };
    }

    /** Resolve export filename from sync_history row (filename / file_name / summary). */
    function histResolve(row) {
        const direct = String(row?.filename || row?.file_name || '').trim();
        if (direct) return direct;
        const summary = String(row?.summary || '');
        const m = summary.match(/→\s*(\S+\.(?:zip|xlsx|csv|json))/i)
            || summary.match(/(\S+\.(?:zip|xlsx|csv|json))\s*$/i);
        return m ? m[1] : '';
    }

    return {
        vesselSlug,
        scopeToken,
        hqReplyScopeToken,
        masterHubScopeToken,
        spareType,
        todayTag,
        nextSeq,
        build,
        buildFlat,
        parseScoped,
        histResolve,
    };
})();
