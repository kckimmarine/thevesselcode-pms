/** THE VESSEL CODE — Online sync (Master ↔ HQ via cloud storage)
 *  Offline ZIP remains the fallback for FBB. V-SAT: long timeout (up to 10 min). */
const TVC_OnlineSync = (function () {
    const META_KEY = 'sync_api_base_url';
    const DEFAULT_TIMEOUT_MS = 600000;

    function getApiBaseUrl() {
        try {
            const fromMeta = localStorage.getItem(META_KEY);
            if (fromMeta && String(fromMeta).trim()) return String(fromMeta).trim().replace(/\/+$/, '');
        } catch (_) {}
        try {
            const cfg = typeof TVC_Config !== 'undefined' ? TVC_Config.SYNC_API_BASE_URL : '';
            if (cfg && String(cfg).trim()) return String(cfg).trim().replace(/\/+$/, '');
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
            return 'Online sync API URL is not set. Use offline ZIP or configure sync in Settings.';
        }
        if (!navigator.onLine) {
            return 'Browser is offline. Use offline ZIP transfer.';
        }
        return 'Online sync is available (cloud storage). V-SAT links may take several minutes.';
    }

    async function apiFetch(path, opts = {}) {
        const base = getApiBaseUrl();
        if (!base) throw new Error('Sync API URL is not configured.');
        const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
            const res = await fetch(`${base}${path}`, {
                method: opts.method || 'GET',
                headers: opts.headers || {},
                body: opts.body,
                signal: controller?.signal,
            });
            const ct = res.headers.get('content-type') || '';
            const isJson = ct.includes('application/json');
            const payload = isJson ? await res.json().catch(() => ({})) : { raw: await res.text() };
            if (!res.ok) {
                const msg = payload?.message || payload?.error || res.statusText || `HTTP ${res.status}`;
                throw new Error(`Sync API ${res.status}: ${msg}`);
            }
            return payload;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** Master — push aggregated SHIP_TO_HQ package (application/zip body). */
    async function pushShipToHq(user, blob, meta = {}) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.EXPORT_SHIP_SYNC);
        if (typeof TVC_Space !== 'undefined') TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.COMPANY_EXPORT);
        if (!isAvailable()) throw new Error(statusMessage());

        const result = await apiFetch('/api/sync/ship/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/zip',
                'X-Vessel-Id': meta.vessel_id || user.vessel_id || '',
                'X-Company-Id': meta.company_id || '',
                'X-Filename': meta.filename || 'ship_sync.zip',
                'X-Exported-By': user.username || '',
                'X-Record-Count': String(meta.record_count || 0),
            },
            body: blob,
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

    /** HQ — pull latest ship package metadata + signed download URL. */
    async function pullShipFromVessel(user, vesselId) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.IMPORT_HQ_SYNC);
        if (!TVC_RBAC.isHqAccount(user)) throw new Error('HQ account required.');
        if (!isAvailable()) throw new Error(statusMessage());
        const vid = String(vesselId || '').trim();
        if (!vid) throw new Error('Select a vessel before online sync.');

        return apiFetch(`/api/sync/hq/pull?vessel_id=${encodeURIComponent(vid)}&direction=SHIP_TO_HQ`);
    }

    /** Master — pull latest HQ_TO_SHIP feedback package metadata + signed download URL. */
    async function pullHqFeedback(user, vesselId) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.IMPORT_HQ_SYNC);
        if (typeof TVC_Space !== 'undefined' && !TVC_Space.isCaptainHub(user)) {
            throw new Error('Online pull from HQ is available from Master Hub (Captain) only.');
        }
        if (!isAvailable()) throw new Error(statusMessage());
        const vid = String(vesselId || user.vessel_id || '').trim();
        if (!vid) throw new Error('Vessel ID is missing.');

        return apiFetch(`/api/sync/ship/pull?vessel_id=${encodeURIComponent(vid)}&direction=HQ_TO_SHIP`);
    }

    /** HQ — download pulled ship package and import into IndexedDB. */
    async function importPulledPackage(user, meta) {
        const url = meta?.download_url;
        if (!url) throw new Error('Pull response has no download_url.');
        const zipRes = await fetch(url);
        if (!zipRes.ok) throw new Error(`Download failed: ${zipRes.status}`);
        const blob = await zipRes.blob();
        const filename = meta.filename || 'online_pull.zip';
        const file = new File([blob], filename, { type: 'application/zip' });
        await TVC_Sync.importZip(user, file, null);
        await TVC_Sync.recordSyncHistory({
            type: 'IMPORT',
            direction: 'SHIP_TO_HQ',
            department: 'ALL',
            vessel_id: meta.vessel_id || '—',
            filename,
            record_count: meta.record_count || 0,
            status: 'SUCCESS',
            space: 'HQ',
            channel: 'ONLINE',
        });
        return { filename, vessel_id: meta.vessel_id };
    }

    /** Master — download HQ feedback package and import into IndexedDB. */
    async function importHqFeedbackPackage(user, meta) {
        const url = meta?.download_url;
        if (!url) throw new Error('Pull response has no download_url.');
        const zipRes = await fetch(url);
        if (!zipRes.ok) throw new Error(`Download failed: ${zipRes.status}`);
        const blob = await zipRes.blob();
        const filename = meta.filename || 'online_hq_pull.zip';
        const file = new File([blob], filename, { type: 'application/zip' });
        await TVC_Sync.importZip(user, file, null);
        await TVC_Sync.recordSyncHistory({
            type: 'IMPORT',
            direction: 'HQ_TO_SHIP',
            department: meta.department || 'ALL',
            vessel_id: meta.vessel_id || '—',
            filename,
            record_count: meta.record_count || 0,
            status: 'SUCCESS',
            space: 'SHIP',
            channel: 'ONLINE',
        });
        return { filename, vessel_id: meta.vessel_id };
    }

    /** HQ — push HQ_TO_SHIP feedback package. */
    async function pushHqFeedback(user, blob, meta = {}) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.EXPORT_HQ_FEEDBACK);
        if (!isAvailable()) throw new Error(statusMessage());

        const result = await apiFetch('/api/sync/hq/push', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/zip',
                'X-Vessel-Id': meta.vessel_id || '',
                'X-Company-Id': meta.company_id || '',
                'X-Filename': meta.filename || 'hq_feedback.zip',
                'X-Exported-By': user.username || '',
                'X-Record-Count': String(meta.record_count || 0),
                'X-Direction': 'HQ_TO_SHIP',
            },
            body: blob,
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

    function resolveSyncDept(user, opts = {}) {
        const fromOpt = String(opts.dept || '').trim().toUpperCase();
        if (fromOpt === 'DECK' || fromOpt === 'ENGINE') return fromOpt;
        if (typeof TVC_Sync?.resolveActiveImportDepartment === 'function') {
            const fromApp = TVC_Sync.resolveActiveImportDepartment(user);
            if (fromApp === 'DECK' || fromApp === 'ENGINE') return fromApp;
        }
        return null;
    }

    /** Unified entry — Master ↔ HQ online sync. */
    async function syncNow(user, direction, opts = {}) {
        if (!isAvailable()) {
            return { channel: 'OFFLINE', status: 'OFFLINE', message: statusMessage() };
        }

        if (direction === 'SHIP_TO_HQ') {
            if (typeof TVC_Space !== 'undefined' && !TVC_Space.isCaptainHub(user)) {
                throw new Error('Online push to HQ is available from Master Hub (Captain) only.');
            }
            if (typeof TVC_Sync.buildCompanyZipBlob !== 'function') {
                throw new Error('Sync export module is not loaded.');
            }
            const built = await TVC_Sync.buildCompanyZipBlob(user);
            const pushResult = await pushShipToHq(user, built.blob, {
                filename: built.filename,
                vessel_id: built.vessel_id,
                company_id: built.company_id,
                record_count: built.record_count,
            });
            return {
                channel: 'ONLINE',
                status: 'OK',
                direction,
                message: `Uploaded ${built.filename} to cloud sync storage.`,
                vessel_id: built.vessel_id,
                package_id: pushResult?.package_id || null,
            };
        }

        if (direction === 'HQ_PULL') {
            const vesselId = opts.vesselId;
            const meta = await pullShipFromVessel(user, vesselId);
            const imported = await importPulledPackage(user, meta);
            return {
                channel: 'ONLINE',
                status: 'OK',
                direction,
                message: `Imported ${imported.filename} from cloud sync storage.`,
                vessel_id: imported.vessel_id,
                package_id: meta.package_id || null,
            };
        }

        if (direction === 'HQ_PUSH') {
            if (!TVC_RBAC.isHqAccount(user)) throw new Error('HQ account required.');
            const vesselId = opts.vesselId;
            if (!vesselId) throw new Error('Select a vessel in Ship List before online push.');
            const dept = resolveSyncDept(user, opts);
            if (!dept) throw new Error('Select Deck or Engine toggle before pushing HQ reply online.');
            if (typeof TVC_Sync.buildExportZipBlob !== 'function') {
                throw new Error('Sync export module is not loaded.');
            }
            const built = await TVC_Sync.buildExportZipBlob(user, 'HQ_TO_SHIP', dept, {
                expectedVesselId: vesselId,
            });
            const pushResult = await pushHqFeedback(user, built.blob, {
                filename: built.filename,
                vessel_id: built.vessel_id,
                company_id: built.company_id,
                record_count: built.record_count,
                department: dept,
            });
            if (typeof TVC_Sync.finalizeZipExport === 'function') {
                await TVC_Sync.finalizeZipExport(user, 'HQ_TO_SHIP', dept, built.delta, built, {
                    skipSyncHistory: true,
                });
            }
            return {
                channel: 'ONLINE',
                status: 'OK',
                direction,
                message: `Uploaded HQ reply ${built.filename} to cloud sync storage.`,
                vessel_id: built.vessel_id,
                package_id: pushResult?.package_id || null,
            };
        }

        if (direction === 'SHIP_PULL') {
            if (typeof TVC_Space !== 'undefined' && !TVC_Space.isCaptainHub(user)) {
                throw new Error('Online pull from HQ is available from Master Hub (Captain) only.');
            }
            const vesselId = opts.vesselId || user.vessel_id;
            const meta = await pullHqFeedback(user, vesselId);
            const imported = await importHqFeedbackPackage(user, meta);
            return {
                channel: 'ONLINE',
                status: 'OK',
                direction,
                message: `Imported HQ reply ${imported.filename} from cloud sync storage.`,
                vessel_id: imported.vessel_id,
                package_id: meta.package_id || null,
            };
        }

        return {
            channel: 'ONLINE',
            status: 'UNSUPPORTED',
            direction,
            message: `Unsupported online sync direction: ${direction}`,
        };
    }

    function cloudQueryHeaders(user) {
        const headers = {};
        const accountType = String(user?.account_type || '').trim().toUpperCase();
        if (accountType) headers['X-Tvc-Account-Type'] = accountType;
        const companyId = String(user?.company_id || '').trim();
        if (companyId) headers['X-Tvc-Company-Id'] = companyId;
        try {
            const key = typeof TVC_Config !== 'undefined' ? TVC_Config.SYNC_CLOUD_READ_KEY : '';
            if (key && String(key).trim()) headers['X-Tvc-Cloud-Read-Key'] = String(key).trim();
        } catch (_) {}
        return headers;
    }

    function resolveCloudCompanyId(user, vesselId) {
        if (user?.company_id) return String(user.company_id).trim();
        if (vesselId && typeof TVC_Fleet !== 'undefined') {
            const v = TVC_Fleet.resolveById(vesselId);
            if (v) return TVC_Fleet.vesselCompanyId(v);
        }
        if (typeof TVC_Fleet !== 'undefined') return TVC_Fleet.licenseCompanyId();
        return 'TVC';
    }

    /** Phase C — cloud DB summary (HQ: company scope; Admin: all or filtered). */
    async function fetchCloudStats(user, opts = {}) {
        if (!TVC_RBAC.isHqAccount(user)) throw new Error('HQ or Admin account required.');
        if (!isAvailable()) throw new Error(statusMessage());
        const vesselId = String(opts.vesselId || user.vessel_id || '').trim();
        const companyId = resolveCloudCompanyId(user, vesselId);
        const params = new URLSearchParams();
        if (companyId && user.account_type !== 'ADMIN') params.set('company_id', companyId);
        else if (opts.companyId || companyId) params.set('company_id', String(opts.companyId || companyId));
        if (vesselId) params.set('vessel_id', vesselId);
        return apiFetch(`/api/sync/cloud/stats?${params}`, { headers: cloudQueryHeaders(user) });
    }

    /** Phase C — paginated sync_records from cloud DB. */
    async function fetchCloudRecords(user, opts = {}) {
        if (!TVC_RBAC.isHqAccount(user)) throw new Error('HQ or Admin account required.');
        if (!isAvailable()) throw new Error(statusMessage());
        const vesselId = String(opts.vesselId || user.vessel_id || '').trim();
        const companyId = resolveCloudCompanyId(user, vesselId);
        const params = new URLSearchParams();
        if (companyId && user.account_type !== 'ADMIN') params.set('company_id', companyId);
        else if (opts.companyId || companyId) params.set('company_id', String(opts.companyId || companyId));
        if (vesselId) params.set('vessel_id', vesselId);
        if (opts.storeName) params.set('store_name', opts.storeName);
        if (opts.recordKey) params.set('record_key', opts.recordKey);
        if (opts.metaKey) params.set('meta_key', opts.metaKey);
        if (opts.limit != null) params.set('limit', String(opts.limit));
        if (opts.offset != null) params.set('offset', String(opts.offset));
        return apiFetch(`/api/sync/cloud/records?${params}`, { headers: cloudQueryHeaders(user) });
    }

    /** Web HQ — upsert local IndexedDB rows into cloud sync_records. */
    async function upsertCloudRecords(user, opts = {}) {
        if (!TVC_RBAC.isHqAccount(user)) throw new Error('HQ or Admin account required.');
        if (!isAvailable()) throw new Error(statusMessage());
        const vesselId = String(opts.vesselId || '').trim();
        if (!vesselId) throw new Error('vessel_id is required.');
        const companyId = String(opts.companyId || resolveCloudCompanyId(user, vesselId)).trim();
        const records = Array.isArray(opts.records) ? opts.records : [];
        const params = new URLSearchParams();
        params.set('vessel_id', vesselId);
        if (companyId) params.set('company_id', companyId);
        return apiFetch(`/api/sync/cloud/records?${params}`, {
            method: 'POST',
            headers: {
                ...cloudQueryHeaders(user),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                vessel_id: vesselId,
                company_id: companyId,
                records,
                meta: opts.meta || undefined,
            }),
        });
    }

    return {
        META_KEY,
        getApiBaseUrl,
        isConfigured,
        isAvailable,
        statusMessage,
        cloudQueryHeaders,
        resolveCloudCompanyId,
        fetchCloudStats,
        fetchCloudRecords,
        upsertCloudRecords,
        pushShipToHq,
        pullShipFromVessel,
        pullHqFeedback,
        importPulledPackage,
        importHqFeedbackPackage,
        pushHqFeedback,
        syncNow,
    };
})();
if (typeof window !== 'undefined') window.TVC_OnlineSync = TVC_OnlineSync;
