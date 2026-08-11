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

    function inferRecordDepartment(record, codes, jobs) {
        if (record?.department) return record.department;
        const depts = new Set();
        for (const code of codes || []) {
            const c = String(code || '').trim();
            if (!c) continue;
            for (const j of jobs || []) {
                if (j.job_code === c && j.department) depts.add(j.department);
            }
        }
        if (depts.size === 1) return [...depts][0];
        return null;
    }

    function buildJobRefMaps(jobs) {
        const byCode = new Map();
        const byDeptCode = new Map();
        for (const j of jobs || []) {
            if (!j?.job_code) continue;
            byCode.set(j.job_code, j.id);
            if (j.department) byDeptCode.set(`${j.department}|${j.job_code}`, j.id);
        }
        return { byCode, byDeptCode };
    }

    function repairReportJobRefsInRows(reports, jobs) {
        const { byCode, byDeptCode } = buildJobRefMaps(jobs);
        let repaired = 0;
        for (const rep of reports || []) {
            TVC_WorkReport.fromLegacy(rep);
            let changed = false;
            for (const item of rep.job_items || []) {
                const code = String(item.job_code || '').trim();
                if (!code) continue;
                const repDept = inferRecordDepartment(rep, TVC_WorkReport.getJobCodes(rep), jobs)
                    || rep.department;
                const canonical = (repDept && byDeptCode.get(`${repDept}|${code}`)) || byCode.get(code);
                if (canonical && item.maintenance_job_id !== canonical) {
                    item.maintenance_job_id = canonical;
                    changed = true;
                }
            }
            const primary = TVC_WorkReport.primaryJobItem(rep);
            if (primary?.maintenance_job_id && rep.maintenance_job_id !== primary.maintenance_job_id) {
                rep.maintenance_job_id = primary.maintenance_job_id;
                changed = true;
            }
            if (changed) repaired++;
        }
        return repaired;
    }

    /** Fix Work Report job_items.maintenance_job_id after cross-PC import (HQ/Hub) */
    async function repairReportJobRefs(reports, jobs) {
        const rows = reports || await TVC_DB.getAll('daily_work_reports').catch(() => []);
        const jobRows = jobs || await TVC_DB.getAll('maintenance_jobs').catch(() => []);
        const { byCode, byDeptCode } = buildJobRefMaps(jobRows);
        let repaired = 0;
        for (const rep of rows) {
            TVC_WorkReport.fromLegacy(rep);
            let changed = false;
            for (const item of rep.job_items || []) {
                const code = String(item.job_code || '').trim();
                if (!code) continue;
                const repDept = inferRecordDepartment(rep, TVC_WorkReport.getJobCodes(rep), jobRows)
                    || rep.department;
                const canonical = (repDept && byDeptCode.get(`${repDept}|${code}`)) || byCode.get(code);
                if (canonical && item.maintenance_job_id !== canonical) {
                    item.maintenance_job_id = canonical;
                    changed = true;
                }
            }
            const primary = TVC_WorkReport.primaryJobItem(rep);
            if (primary?.maintenance_job_id && rep.maintenance_job_id !== primary.maintenance_job_id) {
                rep.maintenance_job_id = primary.maintenance_job_id;
                changed = true;
            }
            if (changed) {
                await TVC_DB.put('daily_work_reports', rep);
                repaired++;
            }
        }
        if (repaired) console.info('[TVC_DataPurge] report job refs repaired', repaired);
        return { repaired };
    }

    async function repairReportJobRefsOnce() {
        const KEY = 'report_job_ref_repair_version';
        const VER = '20260812-hq-history-dept';
        const done = await TVC_DB.getMeta(KEY).catch(() => null);
        if (done === VER) return { skipped: true };

        const result = await repairReportJobRefs();
        await TVC_DB.setMeta(KEY, VER);
        return result;
    }

    /** Remove orphaned / invalid rows from Work Permit, Work History, Consumption, Requisition lists */
    async function purgeBuggyListDataOnce() {
        const KEY = 'list_data_purge_version';
        const VER = '20260812-hub-import-cleanup';
        const done = await TVC_DB.getMeta(KEY).catch(() => null);
        if (done === VER) return { skipped: true };

        const jobs = await TVC_DB.getAll('maintenance_jobs').catch(() => []);
        const jobIds = new Set(jobs.map(j => j.id));
        const jobCodes = new Set(jobs.map(j => j.job_code).filter(Boolean));

        let workPermits = 0;
        let workReports = 0;
        let consumeLogs = 0;
        let requisitions = 0;

        const reports = await TVC_DB.getAll('daily_work_reports').catch(() => []);
        const defects = await TVC_DB.getAll('defect_cases').catch(() => []);
        const permits = await TVC_DB.getAll('work_permits').catch(() => []);

        const referencedLogIds = new Set();
        for (const r of reports) {
            if (r?.consume_log_id) referencedLogIds.add(r.consume_log_id);
        }
        for (const d of defects) {
            if (d?.consume_log_id) referencedLogIds.add(d.consume_log_id);
        }
        for (const p of permits) {
            if (p?.consume_log_id) referencedLogIds.add(p.consume_log_id);
        }

        const permitJobValid = (row) => {
            const jc = String(row?.job_code || row?.pms_job_code || '').trim();
            const jid = row?.maintenance_job_id;
            if (jid && jobIds.has(jid)) return true;
            if (jc && jobCodes.has(jc)) return true;
            return false;
        };

        for (const row of permits) {
            const buggy = row?.vessel_id === LEGACY_VESSEL_ID
                || !permitJobValid(row)
                || (!String(row?.permit_no || row?.job_code || row?.maintenance_job_id || '').trim());
            if (buggy) {
                await TVC_DB.del('work_permits', row.id);
                workPermits++;
            }
        }

        for (const row of reports) {
            // Work History reports are never deleted here — job refs are repaired instead.
            // (Import from Engine can carry stale maintenance_job_id until repair runs.)
            if (row?.vessel_id === LEGACY_VESSEL_ID) {
                await TVC_DB.del('daily_work_reports', row.id);
                workReports++;
            }
        }

        const logs = await TVC_DB.getAll('consume_logs').catch(() => []);
        for (const log of logs) {
            const lines = log?.lines || log?.parts || log?.items || [];
            const hasLines = Array.isArray(lines) && lines.length > 0;
            const orphaned = !referencedLogIds.has(log.id);
            const buggy = log?.vessel_id === LEGACY_VESSEL_ID
                || (orphaned && !hasLines);
            if (buggy) {
                await TVC_DB.del('consume_logs', log.id);
                consumeLogs++;
            }
        }

        const reqs = await TVC_DB.getAll('requisitions').catch(() => []);
        for (const req of reqs) {
            const lines = Array.isArray(req?.lines) ? req.lines : [];
            const hasValidLine = lines.some(l =>
                l && (String(l.part_no || '').trim() || l.spare_part_id || String(l.name || '').trim())
            );
            const buggy = req?.vessel_id === LEGACY_VESSEL_ID
                || (!hasValidLine && (!req?.status || req.status === 'DRAFT'))
                || lines.some(l => l && !String(l.part_no || l.spare_part_id || l.name || '').trim());
            if (buggy) {
                await TVC_DB.del('requisitions', req.id);
                requisitions++;
            }
        }

        await TVC_DB.setMeta(KEY, VER);
        const summary = { workPermits, workReports, consumeLogs, requisitions };
        console.info('[TVC_DataPurge] buggy list data removed', summary);
        return summary;
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

    return { run, purgeAllRequisitionsOnce, purgeAllReportsForTestingOnce, purgeBuggyListDataOnce, repairReportJobRefs, repairReportJobRefsOnce, repairReportJobRefsInRows, PURGE_VERSION, LEGACY_VESSEL_ID };
})();
