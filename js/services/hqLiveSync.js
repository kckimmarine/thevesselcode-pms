/** THE VESSEL CODE — HQ / Admin live sync (shared cloud DB → IndexedDB) */
const TVC_HqLiveSync = (function () {
    const POLL_MS = 30000;
    const WM_KEY_PREFIX = 'tvc_cloud_ingest_wm_';
    let timer = null;
    let user = null;
    let getSelectedVesselId = null;
    let onRefresh = null;
    let onRegistryChanged = null;
    let polling = false;

    function watermarkKey(vesselId) {
        return `${WM_KEY_PREFIX}${String(vesselId || '').trim()}`;
    }

    function getWatermark(vesselId) {
        try { return sessionStorage.getItem(watermarkKey(vesselId)) || ''; } catch (_) { return ''; }
    }

    function setWatermark(vesselId, ts) {
        if (!vesselId || !ts) return;
        try { sessionStorage.setItem(watermarkKey(vesselId), String(ts)); } catch (_) {}
    }

    async function syncWatermark(u, vesselId) {
        if (!u || !vesselId || typeof TVC_OnlineSync === 'undefined') return;
        if (!TVC_OnlineSync.isAvailable()) return;
        try {
            const stats = await TVC_OnlineSync.fetchCloudStats(u, { vesselId });
            const ts = stats?.max_ingested_at || stats?.ingest?.last_ingested_at || '';
            if (ts) setWatermark(vesselId, ts);
        } catch (_) { /* offline or API unavailable */ }
    }

    async function pollRegistry() {
        if (!user || !TVC_RBAC.isSuperHqAccount?.(user)) return false;
        if (typeof TVC_AdminRegistry?.reloadIfChanged !== 'function') return false;
        try {
            const changed = await TVC_AdminRegistry.reloadIfChanged();
            if (changed && onRegistryChanged) {
                await onRegistryChanged();
            }
            return changed;
        } catch (e) {
            console.warn('[TVC_HqLiveSync] registry', e);
            return false;
        }
    }

    async function pollCloudMirror() {
        if (!user || !TVC_RBAC.isHqAccount(user)) return false;
        if (typeof TVC_OnlineSync === 'undefined' || !TVC_OnlineSync.isAvailable()) return false;
        if (typeof TVC_CloudMirror === 'undefined') return false;

        const vesselId = getSelectedVesselId?.() || null;
        if (!vesselId) return false;

        const stats = await TVC_OnlineSync.fetchCloudStats(user, { vesselId });
        const lastIngest = stats?.max_ingested_at || stats?.ingest?.last_ingested_at || '';
        if (!lastIngest) return false;

        const prev = getWatermark(vesselId);
        if (prev && prev === lastIngest) return false;

        const result = await TVC_CloudMirror.mirrorVesselFromCloud(user, { vesselId, force: true });
        if (!result?.ok) return false;

        setWatermark(vesselId, lastIngest);
        if (onRefresh) await onRefresh(result);
        return true;
    }

    async function pollOnce() {
        if (polling || !user) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        polling = true;
        try {
            await pollRegistry();
            await pollCloudMirror();
        } catch (e) {
            console.warn('[TVC_HqLiveSync]', e);
        } finally {
            polling = false;
        }
    }

    function start(u, hooks = {}) {
        stop();
        if (!u || !TVC_RBAC.isHqAccount(u)) return;
        user = u;
        getSelectedVesselId = hooks.getSelectedVesselId || null;
        onRefresh = hooks.onRefresh || null;
        onRegistryChanged = hooks.onRegistryChanged || null;
        timer = setInterval(pollOnce, POLL_MS);
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibility);
        }
        setTimeout(pollOnce, 5000);
    }

    function onVisibility() {
        if (!document.hidden && user) pollOnce();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
        user = null;
        getSelectedVesselId = null;
        onRefresh = null;
        onRegistryChanged = null;
        polling = false;
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibility);
        }
    }

    return {
        POLL_MS,
        start,
        stop,
        pollOnce,
        syncWatermark,
        getWatermark,
        setWatermark,
    };
})();
if (typeof window !== 'undefined') window.TVC_HqLiveSync = TVC_HqLiveSync;
