/* PMS + SPICS Unified Transaction Service */
const TVC_Transaction = (function () {
    const now = () => new Date().toISOString();

    function markPending(entity) {
        entity.sync_status = entity.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (entity.sync_status || 'LOCAL');
        entity.updated_at = now();
        return entity;
    }

    async function logAudit(message) {
        await TVC_DB.put('audit_logs', { timestamp: new Date().toLocaleString(), log: message, sync_status: 'LOCAL' });
    }

    function buildJobItemsFromPayload(job, payload, status) {
        return [TVC_WorkReport.blankJobItem(job, {
            status: status || payload.status || 'REPORTED',
            form: payload.form || {},
            used_parts: payload.usedParts || [],
            description: payload.description || job.job_detail || job.item_sort2,
        })];
    }

    function snapshotJobState(job) {
        return {
            last_done: job.last_done ?? null,
            next_date: job.next_date ?? null,
            is_overdue: job.is_overdue ?? false,
            plan_status: job.plan_status ?? 'PENDING',
            schedule_basis: job.schedule_basis ?? null,
        };
    }

    function resolveMaintenanceLastDone(item, report) {
        const form = item?.form || report?.report_form || {};
        return String(form.workDate || form.lastMaintDate || report?.work_date || now().slice(0, 10)).slice(0, 10);
    }

    function shouldApplyJobSchedule(report) {
        const workType = report?.work_type;
        return workType === 'MAINTENANCE' || workType === 'TROUBLE' || workType === 'POSTPONE';
    }

    function maybeSnapshotJobState(item, job, snapshotPrev) {
        if (snapshotPrev && !item.prev_job_state) {
            item.prev_job_state = snapshotJobState(job);
        }
    }

    async function applyWorkReportJobSchedule(api, job, item, report, opts = {}) {
        if (!job || !item || !report) return job;
        maybeSnapshotJobState(item, job, opts.snapshotPrev);

        if (report.work_type === 'POSTPONE' || item.status === 'CONFIRMED' || item.status === 'POSTPONED') {
            const postponeDate = String(report.postpone_date || item.form?.postponeDate || '').slice(0, 10);
            if (!postponeDate) return job;
            const form = item.form || report.report_form || {};
            if (form.lastMaintDate) job.last_done = String(form.lastMaintDate).slice(0, 10);
            job.next_date = postponeDate;
            job.is_overdue = _isOverdue(job.next_date);
            job.plan_status = 'PLANNED';
            job.schedule_basis = 'POSTPONE';
        } else {
            const lastDone = resolveMaintenanceLastDone(item, report);
            job.last_done = lastDone;
            job.next_date = calcNextDate(job, lastDone);
            job.is_overdue = _isOverdue(job.next_date);
            job.plan_status = 'COMPLETED';
        }

        markPending(job);
        await api.put('maintenance_jobs', job);
        return job;
    }

    async function restoreJobScheduleFromSnapshot(api, item) {
        if (!item?.prev_job_state) return;
        const job = await api.get('maintenance_jobs', item.maintenance_job_id);
        if (!job) return;
        const prev = item.prev_job_state;
        job.last_done = prev.last_done ?? null;
        job.next_date = prev.next_date ?? job.next_date;
        job.is_overdue = prev.is_overdue !== undefined ? prev.is_overdue : _isOverdue(job.next_date);
        job.plan_status = prev.plan_status ?? 'PENDING';
        job.schedule_basis = prev.schedule_basis ?? null;
        markPending(job);
        await api.put('maintenance_jobs', job);
    }

    async function syncReportJobSchedules(api, report, opts = {}) {
        if (!shouldApplyJobSchedule(report)) return;
        for (const item of report.job_items || []) {
            const norm = TVC_RBAC.normalizeReportStatus(item.status);
            if (norm !== 'REPORTED' && norm !== 'PENDING') continue;
            const job = await api.get('maintenance_jobs', item.maintenance_job_id);
            if (!job) continue;
            await applyWorkReportJobSchedule(api, job, item, report, opts);
        }
        if (report.job_items?.length === 1) {
            report.prev_job_state = report.job_items[0].prev_job_state || null;
        }
    }

    /** 사관: Daily Work Report 제출 — Save 시 LAST DONE / NEXT DATE 갱신 (재고 미차감) */
    async function submitReport(user, jobId, payload) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.CREATE_DAILY_REPORT);

        return TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'audit_logs'], async (api) => {
            const job = await api.get('maintenance_jobs', jobId);
            if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { code: 'NOT_FOUND' });
            if (user.department && user.department !== job.department) {
                throw Object.assign(new Error(`DEPT_FORBIDDEN: ${job.job_code}`), { code: 'FORBIDDEN' });
            }

            const status = payload.status || 'REPORTED';
            const jobItems = buildJobItemsFromPayload(job, payload, status);
            const base = {
                id: 'DWR-' + Date.now(),
                work_type: payload.workType || 'MAINTENANCE',
                report_date: payload.reportDate || now().slice(0, 10),
                work_date: payload.workDate || null,
                description: payload.description || job.job_detail || job.item_sort2,
                reported_by: user.id,
                reporter_name: TVC_RBAC.getRankLabel(user),
                reporter_role: user.role,
                used_parts: payload.usedParts || [],
                trouble_detail: payload.troubleDetail || null,
                postpone_date: payload.postponeDate || null,
                report_form: payload.form || null,
                is_locked: false,
                created_at: now(),
            };
            const report = markPending(TVC_WorkReport.buildRecord(base, jobItems));
            await syncReportJobSchedules(api, report, { snapshotPrev: true });
            await api.put('daily_work_reports', report);
            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `📋 [${status}] ${job.job_code} (${report.work_type}) — LAST DONE ${job.last_done || '—'} · NEXT ${job.next_date || '—'} — ${user.display_name}`,
                sync_status: 'LOCAL',
            });
            return report;
        });
    }

    /** 다중 Job — Batch Work Report 제출 */
    async function submitBatchReport(user, payload) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.CREATE_DAILY_REPORT);
        const entries = payload.items || [];
        if (!entries.length) throw Object.assign(new Error('NO_JOBS_SELECTED'), { code: 'INVALID' });

        return TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'audit_logs'], async (api) => {
            const jobItems = [];
            for (const entry of entries) {
                const job = await api.get('maintenance_jobs', entry.maintenance_job_id);
                if (!job) throw Object.assign(new Error(`JOB_NOT_FOUND: ${entry.job_code || entry.maintenance_job_id}`), { code: 'NOT_FOUND' });
                if (user.department && user.department !== job.department) {
                    throw Object.assign(new Error(`DEPT_FORBIDDEN: ${job.job_code}`), { code: 'FORBIDDEN' });
                }
                jobItems.push(TVC_WorkReport.blankJobItem(job, {
                    status: payload.status || 'REPORTED',
                    form: { ...(payload.sharedForm || {}), ...(entry.form || {}) },
                    used_parts: entry.used_parts || entry.usedParts || [],
                    description: entry.description || entry.form?.outline || job.job_detail || job.item_sort2,
                }));
            }

            const codes = jobItems.map(i => i.job_code).join(', ');
            const base = {
                id: 'DWR-' + Date.now(),
                work_type: payload.workType || 'MAINTENANCE',
                report_date: payload.reportDate || now().slice(0, 10),
                work_date: payload.workDate || null,
                description: payload.description || `Batch report (${jobItems.length} jobs)`,
                reported_by: user.id,
                reporter_name: TVC_RBAC.getRankLabel(user),
                reporter_role: user.role,
                used_parts: [],
                trouble_detail: null,
                postpone_date: null,
                report_form: payload.sharedForm || null,
                is_locked: false,
                created_at: now(),
            };
            const report = markPending(TVC_WorkReport.buildRecord(base, jobItems));
            await syncReportJobSchedules(api, report, { snapshotPrev: true });
            await api.put('daily_work_reports', report);
            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `📋 [BATCH/${report.status}] ${codes} — LAST DONE/NEXT DATE 갱신 — ${user.display_name}`,
                sync_status: 'LOCAL',
            });
            return report;
        });
    }

    /** Work History에서 기존 리포트 수정 (Modify) — 상태는 유지, 일정 재반영 */
    async function updateReport(user, reportId, payload) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.CREATE_DAILY_REPORT);

        return TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'audit_logs'], async (api) => {
            const report = await api.get('daily_work_reports', reportId);
            if (!report) throw Object.assign(new Error('REPORT_NOT_FOUND'), { code: 'NOT_FOUND' });
            if (report.is_locked) throw Object.assign(new Error('LOCKED'), { code: 'LOCKED' });
            if (report.sync_status === 'SYNCED' && TVC_RBAC.isConfirmedStatus(report.status, report.is_locked)) {
                throw Object.assign(new Error('Submitted reports cannot be modified.'), { code: 'LOCKED' });
            }
            TVC_WorkReport.fromLegacy(report);

            if (payload.workType) report.work_type = payload.workType;
            if (payload.reportDate) report.report_date = payload.reportDate;
            if (payload.workDate !== undefined) report.work_date = payload.workDate || report.work_date;
            if (payload.description) report.description = payload.description;
            if (payload.troubleDetail !== undefined) report.trouble_detail = payload.troubleDetail;
            if (payload.postponeDate !== undefined) report.postpone_date = payload.postponeDate;
            if (payload.form) report.report_form = payload.form;

            if (payload.jobItems) {
                report.job_items = payload.jobItems;
                report.job_codes = payload.jobItems.map(i => i.job_code);
                report.is_batch = report.job_codes.length > 1;
            } else if (payload.form || payload.usedParts !== undefined) {
                const item = report.job_items[0];
                if (item) {
                    if (payload.form) item.form = payload.form;
                    if (payload.usedParts !== undefined && TVC_RBAC.isReportedStatus(item.status)) item.used_parts = payload.usedParts;
                    if (payload.description) item.description = payload.description;
                }
                if (payload.usedParts !== undefined && TVC_RBAC.isReportedStatus(report.status)) report.used_parts = payload.usedParts;
            }

            report.status = TVC_WorkReport.aggregateStatus(report.job_items);
            await syncReportJobSchedules(api, report, { snapshotPrev: true });
            markPending(report);
            await api.put('daily_work_reports', report);
            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `✏️ [MODIFIED] ${report.job_code} (${report.work_type}) — LAST DONE/NEXT DATE 반영 — ${user.display_name}`,
                sync_status: 'LOCAL',
            });
            return report;
        });
    }

    async function rollbackApprovedItem(api, item, user, report) {
        if (report?.stock_applied_at && (item.used_parts || []).length) {
            await TVC_InventoryService.reverseTaskPartsApi(api, user, item.used_parts, {
                ref: item.job_code || '',
                source_id: report.id,
                source_type: 'work_report',
                note: 'Work Report deleted — stock restored',
            });
        }
        const job = await api.get('maintenance_jobs', item.maintenance_job_id);
        if (job && item.prev_job_state) {
            await restoreJobScheduleFromSnapshot(api, item);
        }
    }

    /** Work History에서 리포트 삭제 */
    async function deleteReport(user, reportId) {
        const report = await TVC_DB.get('daily_work_reports', reportId);
        if (!report) throw Object.assign(new Error('REPORT_NOT_FOUND'), { code: 'NOT_FOUND' });
        TVC_WorkReport.fromLegacy(report);

        const normStatus = TVC_RBAC.normalizeReportStatus(report.status, report.is_locked);
        const isShipFinalized = normStatus === 'CONFIRMED'
            || report.job_items.some(i => TVC_RBAC.isConfirmedStatus(i.status));

        if (!isShipFinalized) {
            if (normStatus === 'APPROVED' || report.is_locked) {
                throw Object.assign(new Error('LOCKED'), { code: 'LOCKED' });
            }
            TVC_RBAC.assert(user, TVC_RBAC.Action.CREATE_DAILY_REPORT);
            return TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'audit_logs'], async (api) => {
                const rep = await api.get('daily_work_reports', reportId);
                if (!rep) throw Object.assign(new Error('REPORT_NOT_FOUND'), { code: 'NOT_FOUND' });
                TVC_WorkReport.fromLegacy(rep);
                for (const item of rep.job_items || []) {
                    await restoreJobScheduleFromSnapshot(api, item);
                }
                await api.del('daily_work_reports', reportId);
                await api.put('audit_logs', {
                    timestamp: new Date().toLocaleString(),
                    log: `🗑 [DELETED] ${rep.job_code} (${rep.work_type}) — LAST DONE/NEXT DATE 원복 — ${user.display_name}`,
                    sync_status: 'LOCAL',
                });
                return true;
            });
        }

        TVC_RBAC.assert(user, TVC_RBAC.Action.APPROVE_DAILY_REPORT);

        return TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'spare_parts', 'inventory_history', 'consume_logs', 'audit_logs'], async (api) => {
            const rep = await api.get('daily_work_reports', reportId);
            if (!rep) throw Object.assign(new Error('REPORT_NOT_FOUND'), { code: 'NOT_FOUND' });
            TVC_WorkReport.fromLegacy(rep);

            for (const item of rep.job_items) {
                if (!TVC_RBAC.isConfirmedStatus(item.status)) continue;
                const job = await api.get('maintenance_jobs', item.maintenance_job_id);
                if (job && user.department && user.department !== job.department) {
                    throw Object.assign(new Error('DEPT_FORBIDDEN'), { code: 'FORBIDDEN' });
                }
                if (rep.work_type !== 'POSTPONE') {
                    await rollbackApprovedItem(api, item, user, rep);
                } else {
                    await restoreJobScheduleFromSnapshot(api, item);
                }
            }

            if (rep.consume_log_id) {
                const log = await api.get('consume_logs', rep.consume_log_id);
                if (log) {
                    log.list_status = 'Reported';
                    log.stock_applied_at = '';
                    log.confirmed_at = '';
                    log.confirmed_by = '';
                    await api.put('consume_logs', log);
                }
            }
            rep.stock_applied_at = '';

            await api.del('daily_work_reports', reportId);
            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `🗑 [DELETED+ROLLBACK] ${rep.job_code} — 재고복원 · LAST DONE/NEXT DATE 원복 · ${user.display_name}`,
                sync_status: 'LOCAL',
            });
            return true;
        });
    }

    async function finalizeConfirmedJobItem(api, item, report) {
        const job = await api.get('maintenance_jobs', item.maintenance_job_id);
        if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { code: 'NOT_FOUND' });
        await applyWorkReportJobSchedule(api, job, item, report, { snapshotPrev: true });
        item.status = 'CONFIRMED';
        return job;
    }

    /** 선장/기관장: REPORTED → CONFIRMED + SPICS 재고 자동 차감 (단일·Batch) */
    async function confirmReport(user, reportId) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.APPROVE_DAILY_REPORT);

        return TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'spare_parts', 'inventory_history', 'consume_logs', 'audit_logs'], async (api) => {
            const report = await api.get('daily_work_reports', reportId);
            if (!report) throw Object.assign(new Error('INVALID_REPORT'), { code: 'INVALID' });
            TVC_WorkReport.fromLegacy(report);
            if (report.is_locked) throw Object.assign(new Error('LOCKED'), { code: 'LOCKED' });

            const isPostpone = report.work_type === 'POSTPONE';
            TVC_RBAC.assertReportTransition(user, 'REPORTED', 'CONFIRMED');

            const reportedItems = report.job_items.filter(i => TVC_RBAC.isReportedStatus(i.status));
            if (!reportedItems.length) throw Object.assign(new Error('INVALID_REPORT'), { code: 'INVALID' });

            const forceOk = payloadForceOk(user);
            const confirmTasks = [];

            for (const item of reportedItems) {
                const job = await api.get('maintenance_jobs', item.maintenance_job_id);
                if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { code: 'NOT_FOUND' });
                if (user.department && user.department !== job.department) {
                    throw Object.assign(new Error('DEPT_FORBIDDEN'), { code: 'FORBIDDEN' });
                }
                maybeSnapshotJobState(item, job, true);
                if (!isPostpone) {
                    confirmTasks.push({ job, usedParts: item.used_parts || [] });
                }
            }

            if (confirmTasks.length && !report.stock_applied_at) {
                const { alerts } = await TVC_InventoryService.deductTaskPartsBatchApi(api, user, confirmTasks, {
                    forceOk,
                    source_id: report.id,
                    source_type: 'work_report',
                });
                report._spicsAlerts = alerts;
                report.stock_applied_at = now();
            }

            for (const item of reportedItems) {
                await finalizeConfirmedJobItem(api, item, report);
            }

            report.status = TVC_WorkReport.aggregateStatus(report.job_items);
            report.confirmed_by = user.id;
            report.confirmed_at = now();
            if (report.job_items.length === 1) {
                report.prev_job_state = report.job_items[0].prev_job_state;
                report.used_parts = report.job_items[0].used_parts || [];
            }

            if (report.consume_log_id) {
                const log = await api.get('consume_logs', report.consume_log_id);
                if (log) {
                    log.list_status = 'Confirmed';
                    log.stock_applied_at = report.stock_applied_at;
                    log.confirmed_at = report.confirmed_at;
                    log.confirmed_by = user.display_name || user.username || '';
                    await api.put('consume_logs', log);
                }
            }

            markPending(report);
            await api.put('daily_work_reports', report);

            const codes = reportedItems.map(i => i.job_code).join(', ');
            const scheduleNote = isPostpone
                ? `NEXT DATE → ${report.postpone_date || reportedItems[0]?.form?.postponeDate || '—'}`
                : `LAST DONE ${report.job_items.find(i => i.status === 'CONFIRMED')?.form?.lastMaintDate || report.work_date || now().slice(0, 10)}`;
            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `✅ [CONFIRMED] ${codes} — ${isPostpone ? scheduleNote : '재고차감 · ' + scheduleNote}`,
                sync_status: 'LOCAL',
            });
            return report;
        });
    }

    async function executeMaintenance(user, jobId, usedParts, description) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.EXECUTE_MAINTENANCE);
        const report = await submitReport(user, jobId, { workType: 'MAINTENANCE', usedParts, description });
        return confirmReport(user, report.id);
    }

    /** HQ 공무감독: CONFIRMED → APPROVED + Lock */
    async function approveReport(user, reportId, companyComment) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.CONFIRM_REPORT);
        return TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'audit_logs'], async (api) => {
            const report = await api.get('daily_work_reports', reportId);
            if (!report) throw Object.assign(new Error('INVALID_REPORT'), { code: 'INVALID' });
            TVC_WorkReport.fromLegacy(report);
            if (!TVC_RBAC.isConfirmedStatus(report.status, report.is_locked)) {
                throw Object.assign(new Error('NOT_CONFIRMED'), { code: 'INVALID' });
            }
            TVC_RBAC.assertReportTransition(user, 'CONFIRMED', 'APPROVED');

            report.status = 'APPROVED';
            report.approved_by = user.id;
            report.approved_at = now();
            report.company_comment = companyComment || '';
            report.is_locked = true;
            report.job_items.forEach(item => { item.status = 'APPROVED'; });
            markPending(report);
            await api.put('daily_work_reports', report);

            for (const item of report.job_items) {
                const job = await api.get('maintenance_jobs', item.maintenance_job_id);
                if (job) {
                    job.is_locked = true;
                    markPending(job);
                    await api.put('maintenance_jobs', job);
                }
            }

            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `🏢 [APPROVED] ${report.job_code}${companyComment ? ': ' + companyComment : ''}`,
                sync_status: 'LOCAL',
            });
            return report;
        });
    }

    function payloadForceOk(user) {
        return TVC_RBAC.isApprover(user);
    }

    function calcNextDate(job, fromDateStr) {
        const d = new Date(fromDateStr);
        const p = Number(job.period) || 1;
        switch ((job.unit || 'M').toUpperCase()) {
            case 'D': d.setDate(d.getDate() + p); break;
            case 'W': d.setDate(d.getDate() + p * 7); break;
            case 'Y': d.setFullYear(d.getFullYear() + p); break;
            case 'H': d.setMonth(d.getMonth() + Math.max(1, Math.round(p / 500))); break;
            default: d.setMonth(d.getMonth() + p); break;
        }
        return d.toISOString().slice(0, 10);
    }

    function _isOverdue(nextDate) {
        if (!nextDate) return false;
        return new Date(nextDate) < new Date(new Date().toDateString());
    }

    async function purgeAllWorkReports() {
        const reports = await TVC_DB.getAll('daily_work_reports');
        if (!reports.length) return 0;

        const sysUser = { display_name: 'System Purge' };
        let count = 0;

        await TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'spare_parts', 'audit_logs'], async (api) => {
            for (const raw of reports) {
                const rep = { ...raw };
                TVC_WorkReport.fromLegacy(rep);
                const normStatus = TVC_RBAC.normalizeReportStatus(rep.status, rep.is_locked);
                const isShipFinalized = normStatus === 'CONFIRMED' || normStatus === 'APPROVED'
                    || (rep.job_items || []).some(i => {
                        const n = TVC_RBAC.normalizeReportStatus(i.status, rep.is_locked);
                        return n === 'CONFIRMED' || n === 'APPROVED';
                    });

                for (const item of rep.job_items || []) {
                    const itemNorm = TVC_RBAC.normalizeReportStatus(item.status, rep.is_locked);
                    const finalized = itemNorm === 'CONFIRMED' || itemNorm === 'APPROVED';
                    if (isShipFinalized && finalized) {
                        if (rep.work_type !== 'POSTPONE') {
                            await rollbackApprovedItem(api, item, sysUser);
                        } else {
                            await restoreJobScheduleFromSnapshot(api, item);
                        }
                    } else {
                        await restoreJobScheduleFromSnapshot(api, item);
                    }
                    const job = await api.get('maintenance_jobs', item.maintenance_job_id);
                    if (job?.is_locked) {
                        job.is_locked = false;
                        markPending(job);
                        await api.put('maintenance_jobs', job);
                    }
                }
                await api.del('daily_work_reports', rep.id);
                count++;
            }
            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `🗑 [Purge] ${count} work report(s) cleared for testing`,
                sync_status: 'LOCAL',
            });
        });
        return count;
    }

    return {
        submitReport, submitBatchReport, updateReport, deleteReport,
        approveReport, executeMaintenance, confirmReport, calcNextDate, markPending,
        purgeAllWorkReports,
    };
})();
