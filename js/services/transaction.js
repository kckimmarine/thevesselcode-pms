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
            status: status || payload.status || 'PENDING',
            form: payload.form || {},
            used_parts: payload.usedParts || [],
            description: payload.description || job.job_detail || job.item_sort2,
        })];
    }

    /** 사관: Daily Work Report 제출 (PENDING) — 재고 미차감 */
    async function submitReport(user, jobId, payload) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.CREATE_DAILY_REPORT);
        const job = await TVC_DB.get('maintenance_jobs', jobId);
        if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { code: 'NOT_FOUND' });
        if (user.department && user.department !== job.department) {
            throw Object.assign(new Error(`DEPT_FORBIDDEN: ${job.job_code}`), { code: 'FORBIDDEN' });
        }

        const status = payload.status || 'PENDING';
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
        await TVC_DB.put('daily_work_reports', report);
        await logAudit(`📋 [${status}] ${job.job_code} (${report.work_type}) — ${user.display_name}`);
        return report;
    }

    /** 다중 Job — Batch Work Report 제출 */
    async function submitBatchReport(user, payload) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.CREATE_DAILY_REPORT);
        const entries = payload.items || [];
        if (!entries.length) throw Object.assign(new Error('NO_JOBS_SELECTED'), { code: 'INVALID' });

        const jobItems = [];
        for (const entry of entries) {
            const job = await TVC_DB.get('maintenance_jobs', entry.maintenance_job_id);
            if (!job) throw Object.assign(new Error(`JOB_NOT_FOUND: ${entry.job_code || entry.maintenance_job_id}`), { code: 'NOT_FOUND' });
            if (user.department && user.department !== job.department) {
                throw Object.assign(new Error(`DEPT_FORBIDDEN: ${job.job_code}`), { code: 'FORBIDDEN' });
            }
            jobItems.push(TVC_WorkReport.blankJobItem(job, {
                status: payload.status || 'PENDING',
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
        await TVC_DB.put('daily_work_reports', report);
        await logAudit(`📋 [BATCH/${report.status}] ${codes} — ${user.display_name}`);
        return report;
    }

    /** Work History에서 기존 리포트 수정 (Modify) — 상태는 유지 */
    async function updateReport(user, reportId, payload) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.CREATE_DAILY_REPORT);
        const report = await TVC_DB.get('daily_work_reports', reportId);
        if (!report) throw Object.assign(new Error('REPORT_NOT_FOUND'), { code: 'NOT_FOUND' });
        if (report.is_locked) throw Object.assign(new Error('LOCKED'), { code: 'LOCKED' });
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
                if (payload.usedParts !== undefined && item.status === 'PENDING') item.used_parts = payload.usedParts;
                if (payload.description) item.description = payload.description;
            }
            if (payload.usedParts !== undefined && report.status === 'PENDING') report.used_parts = payload.usedParts;
        }

        report.status = TVC_WorkReport.aggregateStatus(report.job_items);
        markPending(report);
        await TVC_DB.put('daily_work_reports', report);
        await logAudit(`✏️ [MODIFIED] ${report.job_code} (${report.work_type}) — ${user.display_name}`);
        return report;
    }

    async function rollbackApprovedItem(api, item, user) {
        for (const line of item.used_parts || []) {
            const spare = await api.get('spare_parts', line.spare_part_id);
            if (!spare) continue;
            spare.qty_on_hand = (Number(spare.qty_on_hand) || 0) + (Number(line.qty_used) || 0);
            spare.qty_working = Math.max(0, (Number(spare.qty_working) || 0) - (Number(line.qty_used) || 0));
            markPending(spare);
            await api.put('spare_parts', spare);
        }
        const job = await api.get('maintenance_jobs', item.maintenance_job_id);
        if (job && item.prev_job_state) {
            const prev = item.prev_job_state;
            job.last_done = prev.last_done ?? null;
            job.next_date = prev.next_date ?? job.next_date;
            job.is_overdue = prev.is_overdue !== undefined ? prev.is_overdue : _isOverdue(job.next_date);
            job.plan_status = prev.plan_status ?? 'PENDING';
            markPending(job);
            await api.put('maintenance_jobs', job);
        }
    }

    /** Work History에서 리포트 삭제 */
    async function deleteReport(user, reportId) {
        const report = await TVC_DB.get('daily_work_reports', reportId);
        if (!report) throw Object.assign(new Error('REPORT_NOT_FOUND'), { code: 'NOT_FOUND' });
        TVC_WorkReport.fromLegacy(report);

        const isApproved = report.status === 'APPROVED' || report.job_items.some(i => i.status === 'APPROVED');

        if (!isApproved) {
            if (report.status === 'CONFIRMED' || report.is_locked) {
                throw Object.assign(new Error('LOCKED'), { code: 'LOCKED' });
            }
            TVC_RBAC.assert(user, TVC_RBAC.Action.CREATE_DAILY_REPORT);
            await TVC_DB.del('daily_work_reports', reportId);
            await logAudit(`🗑 [DELETED] ${report.job_code} (${report.work_type}) — ${user.display_name}`);
            return true;
        }

        TVC_RBAC.assert(user, TVC_RBAC.Action.APPROVE_DAILY_REPORT);

        return TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'spare_parts', 'audit_logs'], async (api) => {
            const rep = await api.get('daily_work_reports', reportId);
            if (!rep) throw Object.assign(new Error('REPORT_NOT_FOUND'), { code: 'NOT_FOUND' });
            TVC_WorkReport.fromLegacy(rep);

            for (const item of rep.job_items) {
                if (item.status !== 'APPROVED') continue;
                const job = await api.get('maintenance_jobs', item.maintenance_job_id);
                if (job && user.department && user.department !== job.department) {
                    throw Object.assign(new Error('DEPT_FORBIDDEN'), { code: 'FORBIDDEN' });
                }
                await rollbackApprovedItem(api, item, user);
            }

            await api.del('daily_work_reports', reportId);
            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `🗑 [DELETED+ROLLBACK] ${rep.job_code} — 재고복원 · LAST DONE/NEXT DATE 원복 · ${user.display_name}`,
                sync_status: 'LOCAL',
            });
            return true;
        });
    }

    async function approveJobItemDates(api, item) {
        const job = await api.get('maintenance_jobs', item.maintenance_job_id);
        if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { code: 'NOT_FOUND' });
        const today = now().slice(0, 10);
        job.last_done = today;
        job.next_date = calcNextDate(job, today);
        job.is_overdue = _isOverdue(job.next_date);
        job.plan_status = 'COMPLETED';
        markPending(job);
        await api.put('maintenance_jobs', job);
        item.status = 'APPROVED';
        return job;
    }

    /** 선기장: APPROVED + SPICS 재고 자동 차감 (단일·Batch) */
    async function approveReport(user, reportId) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.APPROVE_DAILY_REPORT);

        return TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'spare_parts', 'audit_logs'], async (api) => {
            const report = await api.get('daily_work_reports', reportId);
            if (!report) throw Object.assign(new Error('INVALID_REPORT'), { code: 'INVALID' });
            TVC_WorkReport.fromLegacy(report);
            if (report.is_locked) throw Object.assign(new Error('LOCKED'), { code: 'LOCKED' });
            TVC_RBAC.assertReportTransition(user, 'PENDING', 'APPROVED');

            const pendingItems = report.job_items.filter(i => i.status === 'PENDING');
            if (!pendingItems.length) throw Object.assign(new Error('INVALID_REPORT'), { code: 'INVALID' });

            const forceOk = payloadForceOk(user);
            const confirmTasks = [];

            for (const item of pendingItems) {
                const job = await api.get('maintenance_jobs', item.maintenance_job_id);
                if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { code: 'NOT_FOUND' });
                if (user.department && user.department !== job.department) {
                    throw Object.assign(new Error('DEPT_FORBIDDEN'), { code: 'FORBIDDEN' });
                }
                item.prev_job_state = {
                    last_done: job.last_done ?? null,
                    next_date: job.next_date ?? null,
                    is_overdue: job.is_overdue ?? false,
                    plan_status: job.plan_status ?? 'PENDING',
                };
                confirmTasks.push({ job, usedParts: item.used_parts || [] });
            }

            const { alerts } = await TVC_PMS.confirmBatchTasks(api, confirmTasks, { forceOk });
            report._spicsAlerts = alerts;

            for (const item of pendingItems) {
                await approveJobItemDates(api, item);
            }

            report.status = TVC_WorkReport.aggregateStatus(report.job_items);
            report.approved_by = user.id;
            report.approved_at = now();
            if (report.job_items.length === 1) {
                report.prev_job_state = report.job_items[0].prev_job_state;
                report.used_parts = report.job_items[0].used_parts || [];
            }
            markPending(report);
            await api.put('daily_work_reports', report);

            const codes = pendingItems.map(i => i.job_code).join(', ');
            await api.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `✅ [APPROVED] ${codes} — 재고차감 · LAST DONE ${now().slice(0, 10)}`,
                sync_status: 'LOCAL',
            });
            return report;
        });
    }

    async function executeMaintenance(user, jobId, usedParts, description) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.EXECUTE_MAINTENANCE);
        const report = await submitReport(user, jobId, { workType: 'MAINTENANCE', usedParts, description });
        return approveReport(user, report.id);
    }

    /** 본사: CONFIRM + Lock */
    async function confirmReport(user, reportId, companyComment) {
        TVC_RBAC.assert(user, TVC_RBAC.Action.CONFIRM_REPORT);
        return TVC_DB.runTransaction(['daily_work_reports', 'maintenance_jobs', 'audit_logs'], async (api) => {
            const report = await api.get('daily_work_reports', reportId);
            if (!report || report.status !== 'APPROVED') throw Object.assign(new Error('NOT_APPROVED'), { code: 'INVALID' });
            TVC_WorkReport.fromLegacy(report);
            TVC_RBAC.assertReportTransition(user, 'APPROVED', 'CONFIRMED');

            report.status = 'CONFIRMED';
            report.confirmed_by = user.id;
            report.confirmed_at = now();
            report.company_comment = companyComment || '';
            report.is_locked = true;
            report.job_items.forEach(item => { item.status = 'CONFIRMED'; });
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
                log: `🏢 [CONFIRMED] ${report.job_code}${companyComment ? ': ' + companyComment : ''}`,
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

    return {
        submitReport, submitBatchReport, updateReport, deleteReport,
        approveReport, executeMaintenance, confirmReport, calcNextDate, markPending,
    };
})();
