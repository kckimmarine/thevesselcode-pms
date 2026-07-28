/** THE VESSEL CODE — Online sync scaffold (Master ↔ HQ)
 *  Offline ZIP remains the primary/default transfer path.
 *  When a sync API is configured and the browser is online, Master/HQ can push/pull packages. */
const TVC_OnlineSync = (function () {
    const META_KEY = 'sync_api_base_url';
    const DEFAULT_TIMEOUT_MS = 30000;

    function getApiBaseUrl() {
        try {
            const fromMeta = localStorage.getItem(META_KEY);
            if (fromMeta && String(fromMeta).trim()) return String(fromMeta).trim().replace(/\/+$/, '');
        } catch (_) {}
        return null;
    }

    function isConfigured() {
        return !!getApiBaseUrl();
    }

    function isAvailable() {
        return typeof navigator !== 'undefined' && navigator.onLine === true && isConfigured();
    }

    function statusMessage() {
        if (!isConfigured()) {
            return 'Online sync is not configured. Use offline ZIP (email) or set sync API URL in admin settings.';
        }
        if (!navigator.onLine) {
            return 'Browser is offline. Use offline ZIP transfer.';
        }
        return 'Online sync is available.';
    }

    async function fetchJson(path, opts = {}) {
        const base = getApiBaseUrl();
        if (!base) throw new Error('Sync API URL is not configured.');
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;
        try {
            const res = await fetch(`${base}${path}`, {
                method: opts.method || 'GET',
                headers: {
                    Accept: 'application/json',
                    ...(opts.headers || {}),
                },
                body: opts.body,
                signal: controller?.signal,
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Sync API ${res.status}: ${text || res.statusText}`);
            }
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) return res.json();
            return { ok: true, raw: await res.text() };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** Master — push aggregated SHIP_TO_HQ package (scaffold: API must accept multipart/form-data) */
    async function pushShipToHq(user, blob, meta = {}) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.EXPORT_SHIP_SYNC);
        if (typeof TVC_Space !== 'undefined') TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.COMPANY_EXPORT);
        if (!isAvailable()) throw new Error(statusMessage());

        const form = new FormData();
        form.append('package', blob, meta.filename || 'ship_sync.zip');
        form.append('vessel_id', meta.vessel_id || user.vessel_id || '');
        form.append('direction', 'SHIP_TO_HQ');
        form.append('exported_by', user.username || '');

        const result = await fetchJson('/api/sync/ship/push', {
            method: 'POST',
            body: form,
        });

        await TVC_Sync.recordSyncHistory({
            type: 'EXPORT',
            direction: 'SHIP_TO_HQ',
            department: 'ALL',
            vessel_id: meta.vessel_id || user.vessel_id || '—',
            filename: meta.filename || 'online_push.zip',
            record_count: meta.record_count || 0,
            status: 'SUCCESS',
            space: 'SHIP',
            channel: 'ONLINE',
        });
        return result;
    }

    /** HQ — pull latest ship package for selected vessel (scaffold) */
    async function pullShipFromVessel(user, vesselId) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.IMPORT_HQ_SYNC);
        if (!TVC_RBAC.isHqAccount(user)) throw new Error('HQ account required.');
        if (!isAvailable()) throw new Error(statusMessage());
        const vid = String(vesselId || '').trim();
        if (!vid) throw new Error('Select a vessel before online sync.');

        const result = await fetchJson(`/api/sync/hq/pull?vessel_id=${encodeURIComponent(vid)}`);
        await TVC_Sync.recordSyncHistory({
            type: 'IMPORT',
            direction: 'SHIP_TO_HQ',
            department: 'ALL',
            vessel_id: vid,
            filename: '(online pull)',
            record_count: result?.record_count || 0,
            status: 'SUCCESS',
            space: 'HQ',
            channel: 'ONLINE',
        });
        return result;
    }

    /** HQ — push HQ_TO_SHIP feedback (scaffold) */
    async function pushHqFeedback(user, blob, meta = {}) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.EXPORT_HQ_FEEDBACK);
        if (!isAvailable()) throw new Error(statusMessage());

        const form = new FormData();
        form.append('package', blob, meta.filename || 'hq_feedback.zip');
        form.append('vessel_id', meta.vessel_id || '');
        form.append('direction', 'HQ_TO_SHIP');
        form.append('department', meta.department || 'ALL');
        form.append('exported_by', user.username || '');

        const result = await fetchJson('/api/sync/hq/push', {
            method: 'POST',
            body: form,
        });

        await TVC_Sync.recordSyncHistory({
            type: 'EXPORT',
            direction: 'HQ_TO_SHIP',
            department: meta.department || 'ALL',
            vessel_id: meta.vessel_id || '—',
            filename: meta.filename || 'online_hq_push.zip',
            record_count: meta.record_count || 0,
            status: 'SUCCESS',
            space: 'HQ',
            channel: 'ONLINE',
        });
        return result;
    }

    /** Unified entry — returns scaffold status until backend is deployed */
    async function syncNow(user, direction, opts = {}) {
        if (!isAvailable()) {
            return { channel: 'OFFLINE', message: statusMessage() };
        }
        return {
            channel: 'ONLINE',
            direction,
            status: 'SCAFFOLD',
            message: 'Online sync API is configured but backend endpoints (/api/sync/*) are not yet deployed in this offline PMS build. Continue using offline ZIP.',
            vesselId: opts.vesselId || null,
        };
    }

    return {
        META_KEY,
        getApiBaseUrl,
        isConfigured,
        isAvailable,
        statusMessage,
        pushShipToHq,
        pullShipFromVessel,
        pushHqFeedback,
        syncNow,
    };
})();
if (typeof window !== 'undefined') window.TVC_OnlineSync = TVC_OnlineSync;
