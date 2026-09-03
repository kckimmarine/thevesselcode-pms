/** THE VESSEL CODE — Phase D: HQ/Admin cloud DB → IndexedDB mirror */
const TVC_CloudMirror = (function () {
    const MIRROR_STORES = [
        'maintenance_jobs', 'maintenance_groups', 'spare_groups', 'daily_work_reports',
        'spare_parts', 'ship_components', 'audit_logs', 'requisitions', 'job_bom',
        'universal_catalog', 'defect_cases', 'work_permits', 'consume_logs',
        'inventory_history', 'vessel_documents',
    ];
    const PAGE_SIZE = 200;
    const THROTTLE_MS = 120000;
    const LAST_KEY_PREFIX = 'tvc_cloud_mirror_at_';

    function lastMirrorKey(vesselId) {
        return `${LAST_KEY_PREFIX}${String(vesselId || '').trim()}`;
    }

    function lastMirrorAt(vesselId) {
        try {
            const raw = sessionStorage.getItem(lastMirrorKey(vesselId));
            const n = Number(raw);
            return Number.isFinite(n) ? n : 0;
        } catch (_) {
            return 0;
        }
    }

    function stampMirrorAt(vesselId) {
        try { sessionStorage.setItem(lastMirrorKey(vesselId), String(Date.now())); } catch (_) {}
    }

    function shouldThrottle(vesselId, force) {
        if (force) return false;
        return Date.now() - lastMirrorAt(vesselId) < THROTTLE_MS;
    }

    async function fetchAllCloudRecords(user, opts = {}) {
        const all = [];
        let offset = 0;
        let total = Infinity;
        while (offset < total) {
            const page = await TVC_OnlineSync.fetchCloudRecords(user, {
                ...opts,
                limit: PAGE_SIZE,
                offset,
            });
            const rows = page.records || [];
            total = Number(page.total ?? rows.length);
            all.push(...rows);
            if (!rows.length || rows.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
        }
        return all;
    }

    function recordsToPayload(records, vesselId, companyId) {
        const payload = {
            export_meta: {
                vessel_id: vesselId,
                company_id: companyId,
                direction: 'CLOUD_MIRROR',
                department: 'ALL',
                export_date: new Date().toISOString().slice(0, 10),
                exported_by: 'cloud',
                schema_version: 6,
                package_type: 'CLOUD_MIRROR',
            },
        };
        for (const name of MIRROR_STORES) payload[name] = [];
        for (const row of records || []) {
            const store = row.store_name;
            if (!store || !row.payload) continue;
            if (!payload[store]) payload[store] = [];
            payload[store].push({ ...row.payload });
        }
        return payload;
    }

    async function applyRunHoursMeta(user, vesselId, companyId) {
        if (typeof TVC_PMS === 'undefined') return false;
        const meta = await TVC_OnlineSync.fetchCloudRecords(user, {
            vesselId,
            companyId,
            metaKey: 'run_hours',
        });
        const row = (meta.rows || []).find(r => r.vessel_id === vesselId);
        if (!row?.payload || typeof row.payload !== 'object') return false;
        const myScope = TVC_PMS.scopeOf('HQ', vesselId);
        const store = TVC_PMS.readStore(myScope);
        for (const [k, v] of Object.entries(row.payload)) store[k] = v;
        TVC_PMS.writeStore(store, myScope);
        return true;
    }

    /** Pull one vessel's cloud sync_records into HQ IndexedDB. */
    async function mirrorVesselFromCloud(user, opts = {}) {
        if (!TVC_RBAC.isHqAccount(user)) throw new Error('HQ or Admin account required.');
        if (typeof TVC_OnlineSync === 'undefined' || !TVC_OnlineSync.isAvailable()) {
            throw new Error(TVC_OnlineSync?.statusMessage?.() || 'Online sync is not available.');
        }
        TVC_RBAC.assert(user, TVC_RBAC.Action.IMPORT_HQ_SYNC);

        const vesselId = String(opts.vesselId || '').trim();
        if (!vesselId) throw new Error('Select a vessel before cloud mirror.');

        const companyId = opts.companyId || TVC_OnlineSync.resolveCloudCompanyId(user, vesselId);
        const records = await fetchAllCloudRecords(user, { vesselId, companyId });
        const payload = recordsToPayload(records, vesselId, companyId);

        await TVC_Sync.mergePayload(payload, null, true, vesselId, {
            importAuthoritative: opts.importAuthoritative === true,
        });
        const runHoursApplied = await applyRunHoursMeta(user, vesselId, companyId).catch(() => false);

        const storeCounts = {};
        for (const name of MIRROR_STORES) {
            const n = (payload[name] || []).length;
            if (n) storeCounts[name] = n;
        }

        await TVC_Sync.recordSyncHistory({
            type: 'IMPORT',
            direction: 'CLOUD_MIRROR',
            department: 'ALL',
            vessel_id: vesselId,
            filename: '(cloud DB)',
            record_count: records.length,
            status: 'SUCCESS',
            space: 'HQ',
            channel: 'ONLINE',
        });

        stampMirrorAt(vesselId);

        return {
            ok: true,
            vessel_id: vesselId,
            company_id: companyId,
            record_count: records.length,
            stores: storeCounts,
            run_hours: runHoursApplied,
        };
    }

    /** Mirror all visible fleet vessels (company HQ or admin registry). */
    async function mirrorVisibleFleet(user, opts = {}) {
        if (!TVC_Fleet?.getVisible) throw new Error('Fleet module not loaded.');
        const vessels = TVC_Fleet.getVisible(user) || [];
        const results = [];
        for (const v of vessels) {
            if (!v?.id) continue;
            try {
                const r = await mirrorVesselFromCloud(user, {
                    vesselId: v.id,
                    companyId: opts.companyId,
                    force: opts.force,
                });
                results.push(r);
            } catch (e) {
                results.push({ ok: false, vessel_id: v.id, error: e.message || String(e) });
            }
        }
        return results;
    }

    /** Auto-mirror on vessel select / login — throttled, silent on failure. */
    async function maybeMirrorSelectedVessel(user, vesselId, opts = {}) {
        if (!user || !TVC_RBAC.isHqAccount(user)) return { skipped: true, reason: 'not_hq' };
        if (!vesselId) return { skipped: true, reason: 'no_vessel' };
        if (typeof TVC_OnlineSync === 'undefined' || !TVC_OnlineSync.isAvailable()) {
            return { skipped: true, reason: 'offline' };
        }
        if (shouldThrottle(vesselId, opts.force)) {
            return { skipped: true, reason: 'throttled', vessel_id: vesselId };
        }
        try {
            const result = await mirrorVesselFromCloud(user, {
                vesselId,
                companyId: opts.companyId,
                importAuthoritative: opts.importAuthoritative === true,
            });
            return { skipped: false, ...result };
        } catch (e) {
            return { skipped: true, reason: 'error', error: e.message || String(e), vessel_id: vesselId };
        }
    }

    return {
        MIRROR_STORES,
        mirrorVesselFromCloud,
        mirrorVisibleFleet,
        maybeMirrorSelectedVessel,
        shouldThrottle,
    };
})();
if (typeof window !== 'undefined') window.TVC_CloudMirror = TVC_CloudMirror;
