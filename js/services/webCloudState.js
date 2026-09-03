/** THE VESSEL CODE — Web HQ shared cloud state (any PC sees the same records). */
const TVC_WebCloudState = (function () {
    const CHUNK = 200;
    const PUSH_DEBOUNCE_MS = 1600;
    let syncing = false;
    let lastUser = null;
    let lastVesselId = null;
    let pushTimer = null;

    function isWebHq(user) {
        try {
            if (typeof TVC_Config === 'undefined' || !TVC_Config.isWebDeploy?.()) return false;
        } catch (_) { return false; }
        if (!user || typeof TVC_RBAC === 'undefined' || !TVC_RBAC.isHqAccount(user)) return false;
        if (typeof TVC_OnlineSync === 'undefined' || !TVC_OnlineSync.isAvailable()) return false;
        return true;
    }

    function storeKeyField(storeName) {
        return storeName === 'universal_catalog' ? 'universal_code' : 'id';
    }

    function rowBelongsToVessel(row, vesselId) {
        const vid = String(row?.vessel_id || row?.vesselId || '').trim();
        if (!vid) return true;
        return vid === vesselId;
    }

    async function collectRecords(vesselId) {
        const stores = (typeof TVC_CloudMirror !== 'undefined' && TVC_CloudMirror.MIRROR_STORES)
            ? TVC_CloudMirror.MIRROR_STORES
            : [];
        const records = [];
        for (const store of stores) {
            let rows = [];
            try { rows = await TVC_DB.getAll(store); } catch (_) { continue; }
            const kf = storeKeyField(store);
            for (const row of rows || []) {
                if (!row || typeof row !== 'object') continue;
                if (!rowBelongsToVessel(row, vesselId)) continue;
                const key = row[kf];
                if (key == null || String(key).trim() === '') continue;
                const payload = row.vessel_id ? row : { ...row, vessel_id: vesselId };
                records.push({
                    store_name: store,
                    record_key: String(key),
                    payload,
                });
            }
        }
        return records;
    }

    async function collectMeta(vesselId) {
        const meta = {};
        if (typeof TVC_PMS !== 'undefined') {
            try {
                const scope = TVC_PMS.scopeOf('HQ', vesselId);
                const store = TVC_PMS.readStore(scope);
                if (store && typeof store === 'object' && Object.keys(store).length) {
                    meta.run_hours = store;
                }
            } catch (_) { /* optional */ }
        }
        return meta;
    }

    async function pushVessel(user, vesselId) {
        if (!isWebHq(user) || !vesselId) return { skipped: true };
        const companyId = TVC_OnlineSync.resolveCloudCompanyId(user, vesselId);
        const records = await collectRecords(vesselId);
        const meta = await collectMeta(vesselId);
        let upserted = 0;
        let skipped = 0;
        let metaUpserted = 0;
        if (!records.length && !Object.keys(meta).length) {
            return { ok: true, vessel_id: vesselId, records_upserted: 0, records_skipped: 0, meta_upserted: 0 };
        }
        for (let i = 0; i < records.length || i === 0; i += CHUNK) {
            const slice = records.slice(i, i + CHUNK);
            const first = i === 0;
            if (!slice.length && !first) break;
            const result = await TVC_OnlineSync.upsertCloudRecords(user, {
                vesselId,
                companyId,
                records: slice,
                meta: first ? meta : undefined,
            });
            upserted += Number(result?.records_upserted || 0);
            skipped += Number(result?.records_skipped || 0);
            if (first) metaUpserted += Number(result?.meta_upserted || 0);
            if (!records.length) break;
        }
        return {
            ok: true,
            vessel_id: vesselId,
            records_upserted: upserted,
            records_skipped: skipped,
            meta_upserted: metaUpserted,
        };
    }

    async function syncVessel(user, vesselId) {
        if (!isWebHq(user) || !vesselId) return { skipped: true, reason: 'not_web_hq' };
        if (syncing) return { skipped: true, reason: 'busy' };
        syncing = true;
        lastUser = user;
        lastVesselId = vesselId;
        try {
            let cloudHas = false;
            try {
                const stats = await TVC_OnlineSync.fetchCloudStats(user, { vesselId });
                cloudHas = Number(stats?.total_records || 0) > 0;
            } catch (e) {
                console.warn('[TVC_WebCloudState] stats', e);
            }

            let pushed = null;
            let pulled = null;
            if (cloudHas && typeof TVC_CloudMirror !== 'undefined') {
                pulled = await TVC_CloudMirror.mirrorVesselFromCloud(user, {
                    vesselId,
                    force: true,
                    importAuthoritative: true,
                });
            } else {
                pushed = await pushVessel(user, vesselId);
            }
            return { skipped: false, ok: !!(pulled?.ok || pushed?.ok), pushed, pulled };
        } catch (e) {
            return { skipped: true, reason: 'error', error: e.message || String(e), vessel_id: vesselId };
        } finally {
            syncing = false;
        }
    }

    function schedulePush() {
        if (!isWebHq(lastUser) || !lastVesselId || syncing) return;
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
            pushTimer = null;
            if (syncing) return;
            pushVessel(lastUser, lastVesselId).catch((e) => {
                console.warn('[TVC_WebCloudState] debounce push', e);
            });
        }, PUSH_DEBOUNCE_MS);
    }

    function notifyLocalWrite(storeName) {
        const stores = (typeof TVC_CloudMirror !== 'undefined' && TVC_CloudMirror.MIRROR_STORES)
            ? TVC_CloudMirror.MIRROR_STORES
            : [];
        if (storeName && stores.length && !stores.includes(storeName)) return;
        schedulePush();
    }

    function rememberSession(user, vesselId) {
        if (user) lastUser = user;
        if (vesselId) lastVesselId = vesselId;
    }

    return {
        isWebHq,
        syncVessel,
        pushVessel,
        notifyLocalWrite,
        rememberSession,
    };
})();
if (typeof window !== 'undefined') window.TVC_WebCloudState = TVC_WebCloudState;
