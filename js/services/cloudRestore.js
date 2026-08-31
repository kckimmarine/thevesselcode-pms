/** THE VESSEL CODE — Phase E: Cloud snapshot → HQ_TO_SHIP restore package */
const TVC_CloudRestore = (function () {
    function restoreHeaders(user) {
        const headers = typeof TVC_OnlineSync !== 'undefined'
            ? TVC_OnlineSync.cloudQueryHeaders(user)
            : {};
        try {
            const key = typeof TVC_Config !== 'undefined' ? TVC_Config.SYNC_CLOUD_RESTORE_KEY : '';
            if (key && String(key).trim()) headers['X-Tvc-Cloud-Restore-Key'] = String(key).trim();
        } catch (_) {}
        headers['Content-Type'] = 'application/json';
        return headers;
    }

    function resolveVesselAndCompany(user, opts = {}) {
        const vesselId = String(opts.vesselId || '').trim();
        if (!vesselId) throw new Error('Select a vessel before cloud restore.');
        const companyId = opts.companyId
            || (typeof TVC_OnlineSync !== 'undefined'
                ? TVC_OnlineSync.resolveCloudCompanyId(user, vesselId)
                : (user?.company_id || 'TVC'));
        return { vesselId, companyId };
    }

    /** Build HQ_TO_SHIP package on server and upload for vessel online pull. */
    async function publishRestoreToVessel(user, opts = {}) {
        if (!TVC_RBAC.isHqAccount(user)) throw new Error('HQ or Admin account required.');
        if (typeof TVC_OnlineSync === 'undefined' || !TVC_OnlineSync.isAvailable()) {
            throw new Error(TVC_OnlineSync?.statusMessage?.() || 'Online sync is not available.');
        }
        const { vesselId, companyId } = resolveVesselAndCompany(user, opts);
        const department = String(opts.department || 'ALL').trim().toUpperCase();
        const base = TVC_OnlineSync.getApiBaseUrl();
        const res = await fetch(`${base}/api/sync/cloud/restore`, {
            method: 'POST',
            headers: {
                ...restoreHeaders(user),
                'X-Exported-By': user.username || 'hq',
            },
            body: JSON.stringify({
                vessel_id: vesselId,
                company_id: companyId,
                department,
                upload: true,
                exported_by: user.username || 'hq',
            }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload?.message || payload?.error || `HTTP ${res.status}`);
        }
        await TVC_Sync.recordSyncHistory({
            type: 'EXPORT',
            direction: 'HQ_TO_SHIP',
            department,
            vessel_id: vesselId,
            filename: payload.filename || 'cloud_restore.zip',
            record_count: payload.record_count || 0,
            status: 'SUCCESS',
            space: 'HQ',
            channel: 'ONLINE',
            package_type: 'CLOUD_RESTORE',
        });
        return payload;
    }

    /** Download restore ZIP for offline FBB transfer to vessel. */
    async function downloadRestoreZip(user, opts = {}) {
        if (!TVC_RBAC.isHqAccount(user)) throw new Error('HQ or Admin account required.');
        if (typeof TVC_OnlineSync === 'undefined' || !TVC_OnlineSync.isAvailable()) {
            throw new Error(TVC_OnlineSync?.statusMessage?.() || 'Online sync is not available.');
        }
        const { vesselId, companyId } = resolveVesselAndCompany(user, opts);
        const department = String(opts.department || 'ALL').trim().toUpperCase();
        const params = new URLSearchParams({
            vessel_id: vesselId,
            company_id: companyId,
            department,
        });
        const base = TVC_OnlineSync.getApiBaseUrl();
        const res = await fetch(`${base}/api/sync/cloud/restore?${params}`, {
            headers: restoreHeaders(user),
        });
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload?.message || payload?.error || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const cd = res.headers.get('content-disposition') || '';
        const m = cd.match(/filename="?([^";]+)"?/i);
        const filename = m?.[1] || `${vesselId}_CLOUD_RESTORE_${department}.zip`;
        if (typeof TVC_FileExport !== 'undefined') {
            await TVC_FileExport.save(blob, filename);
        }
        return { blob, filename, vessel_id: vesselId };
    }

    return {
        publishRestoreToVessel,
        downloadRestoreZip,
    };
})();
if (typeof window !== 'undefined') window.TVC_CloudRestore = TVC_CloudRestore;
