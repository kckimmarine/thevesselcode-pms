/* 일회성·버전별 데이터 정리 — 구 vessel_id 및 PMS Sync 이력 제거 */
const TVC_DataPurge = (function () {
    const LEGACY_VESSEL_ID = 'DM_CHEMICAL_01';
    const PILOT_VESSEL_ID = typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.PILOT_VESSEL_ID : 'INCHEON CHEMI';
    const PURGE_VERSION = '20260707_legacy_sync';

    const SYNC_AUDIT_RE = /📦\s*\[Export|📥\s*\[Import|\[Export\/|\[Import\/|PMS Sync|Sync Package/i;

    async function clearStore(storeName) {
        let count = 0;
        try {
            const rows = await TVC_DB.getAll(storeName);
            for (const row of rows) {
                await TVC_DB.del(storeName, row.id);
                count++;
            }
        } catch (_) {}
        return count;
    }

    async function purgeLegacyVesselRecords() {
        let count = 0;
        for (const store of ['daily_work_reports', 'maintenance_jobs', 'requisitions']) {
            try {
                const rows = await TVC_DB.getAll(store);
                for (const row of rows) {
                    if (row.vessel_id === LEGACY_VESSEL_ID) {
                        await TVC_DB.del(store, row.id);
                        count++;
                    }
                }
            } catch (_) {}
        }
        return count;
    }

    async function purgeSyncAuditLogs() {
        let count = 0;
        try {
            const rows = await TVC_DB.getAll('audit_logs');
            for (const row of rows) {
                const log = row.log || '';
                if (SYNC_AUDIT_RE.test(log)) {
                    await TVC_DB.del('audit_logs', row.id);
                    count++;
                }
            }
        } catch (_) {}
        return count;
    }

    function purgeLegacyLocalStorage() {
        try {
            localStorage.removeItem(`tvc_run_hrs_HQ_${LEGACY_VESSEL_ID}`);
            if (localStorage.getItem('tvc_fleet_selected') === LEGACY_VESSEL_ID
                || localStorage.getItem('tvc_fleet_selected') === 'TEST_V01') {
                localStorage.setItem('tvc_fleet_selected', PILOT_VESSEL_ID);
            }
            const raw = localStorage.getItem('tvc_fleet_v1');
            if (raw) {
                const fleet = JSON.parse(raw).filter(v => v.id !== LEGACY_VESSEL_ID);
                localStorage.setItem('tvc_fleet_v1', JSON.stringify(fleet));
            }
        } catch (_) {}
    }

    /** 테스트·개발 중 생성된 청구서 전부 삭제 (일회성) */
    async function purgeAllRequisitionsOnce() {
        const KEY = 'requisition_purge_version';
        const VER = '20260708-req-draft-only';
        const done = await TVC_DB.getMeta(KEY).catch(() => null);
        if (done === VER) return { skipped: true };

        const requisitions = await clearStore('requisitions');
        await TVC_DB.setMeta(KEY, VER);
        console.info('[TVC_DataPurge] all requisitions cleared', requisitions);
        return { requisitions };
    }

    /** 테스트 재시작: Work History + Defect Report 전부 삭제 (일회성) */
    async function purgeAllReportsForTestingOnce() {
        const KEY = 'reports_purge_version';
        const VER = '20260717-clear-reports';
        const done = await TVC_DB.getMeta(KEY).catch(() => null);
        if (done === VER) return { skipped: true };

        const workReports = await TVC_Transaction.purgeAllWorkReports().catch(() => 0);
        const defectCases = await clearStore('defect_cases');
        await TVC_DB.setMeta(KEY, VER);
        console.info('[TVC_DataPurge] all reports cleared', { workReports, defectCases });
        return { workReports, defectCases };
    }

    /** 구 DM_CHEMICAL_01 태그·PMS Import/Export 이력 전부 삭제 (HQ·선박 공통) */
    async function run() {
        const done = await TVC_DB.getMeta('data_purge_version').catch(() => null);
        if (done === PURGE_VERSION) return { skipped: true };

        const syncHistory = await clearStore('sync_history');
        const auditLogs = await purgeSyncAuditLogs();
        const legacyRows = await purgeLegacyVesselRecords();

        try {
            const vesselMeta = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID);
            if (!vesselMeta || vesselMeta === LEGACY_VESSEL_ID || vesselMeta === 'TEST_V01') {
                await TVC_DB.setMeta(TVC_META_KEYS.VESSEL_ID, PILOT_VESSEL_ID);
            }
        } catch (_) {}

        try { await TVC_DB.setMeta(TVC_META_KEYS.LAST_EXPORT, ''); } catch (_) {}

        purgeLegacyLocalStorage();
        await TVC_DB.setMeta('data_purge_version', PURGE_VERSION);

        const summary = { syncHistory, auditLogs, legacyRows };
        console.info('[TVC_DataPurge] completed', summary);
        return summary;
    }

    return { run, purgeAllRequisitionsOnce, purgeAllReportsForTestingOnce, PURGE_VERSION, LEGACY_VESSEL_ID };
})();
