/* Critical Equipment — Work Permit CRUD */
const TVC_WorkPermitCaseService = (function () {
    const now = () => new Date().toISOString();

    async function resolveVesselId(user) {
        try {
            const meta = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID);
            if (meta) return String(meta).trim();
        } catch (_) {}
        return String(user?.vessel_id || '').trim();
    }

    async function nextPermitNo(vesselId) {
        const year = new Date().getFullYear();
        const prefix = `WP-${vesselId || 'VESSEL'}-${year}-`;
        const all = await TVC_DB.getAll('work_permits').catch(() => []);
        const seq = all
            .map(r => String(r.permit_no || ''))
            .filter(n => n.startsWith(prefix))
            .map(n => parseInt(n.slice(prefix.length), 10))
            .filter(n => !Number.isNaN(n))
            .reduce((max, n) => Math.max(max, n), 0);
        return `${prefix}${String(seq + 1).padStart(4, '0')}`;
    }

    async function get(id) {
        return TVC_DB.get('work_permits', id);
    }

    function markPending(row) {
        row.sync_status = row.sync_status === 'SYNCED' ? 'PENDING_SYNC' : 'LOCAL';
        row.updated_at = now();
        return row;
    }

    function stampAuthor(row, user) {
        if (!user) return row;
        row.reported_by = row.reported_by || user.id;
        row.reporter_username = row.reporter_username || String(user.username || '').toLowerCase();
        row.reporter_name = row.reporter_name || TVC_RBAC.getReportedByLabel(user);
        return row;
    }

    async function createFromJob(user, job) {
        if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { code: 'NOT_FOUND' });
        const vesselId = await resolveVesselId(user);
        const permitNo = await nextPermitNo(vesselId);
        const row = TVC_WorkPermit.blank({
            permit_no: permitNo,
            vessel_id: vesselId,
            department: job.department || user?.department || '',
            maintenance_job_id: job.id,
            job_code: job.job_code,
            pms_job_code: job.job_code,
            pms_group_no: job.group || '',
            pms_group_key: `${job.department}|${String(job.group || '').trim()}`,
            item_sort1: job.item_sort1 || '',
            item_sort2: job.item_sort2 || '',
            job_detail: job.job_detail || '',
            job_name: job.job_detail || job.item_sort2 || '',
            last_maintenance_date: job.last_done || '',
            visible_in_list: false,
            job_items: [{
                job_code: job.job_code,
                sort1: job.item_sort1 || '',
                sort2: job.item_sort2 || '',
                job_detail: job.job_detail || '',
                maintenance_job_id: job.id,
            }],
        });
        stampAuthor(row, user);
        await TVC_DB.put('work_permits', row);
        return row;
    }

    async function saveDraft(user, payload, existingId) {
        const vesselId = await resolveVesselId(user);
        let row = existingId ? await get(existingId) : null;
        if (row && !TVC_WorkPermit.canModifyListWorkflow(row)) {
            throw Object.assign(new Error('Cannot modify Submitted or Approved permit.'), { code: 'LOCKED' });
        }
        if (!row) {
            row = TVC_WorkPermit.blank({
                id: payload.id,
                permit_no: payload.permit_no || await nextPermitNo(vesselId),
                vessel_id: vesselId,
                department: payload.department || user?.department || '',
            });
            stampAuthor(row, user);
        }
        const fields = [
            'file_no', 'voy_no', 'place', 'plan_date', 'report_date',
            'pms_group_no', 'pms_group_key', 'pms_job_code', 'maintenance_job_id', 'job_code',
            'item_sort1', 'item_sort2', 'job_detail', 'job_name',
            'maker', 'model_type', 'capacity', 'serial_no',
            'last_maintenance_date', 'rh_since_last_maintenance', 'total_run_hrs',
            'outline_work_permit', 'company_comment', 'checked_estimated_spare_parts',
            'estimated_parts', 'job_items',
        ];
        fields.forEach(k => {
            if (k === 'company_comment' && !TVC_RBAC.isHqAccount(user)) return;
            if (payload[k] !== undefined) row[k] = payload[k];
        });
        row.checked_estimated_spare_parts = payload.checked_estimated_spare_parts === true
            || row.checked_estimated_spare_parts === true;
        row.visible_in_list = true;
        row.status = TVC_WorkPermit.Status.ACTIVE;
        markPending(row);
        await TVC_DB.put('work_permits', row);
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📋 [Work Permit] ${row.permit_no || row.job_code || row.id} saved — ${user?.display_name || user?.username || ''}`,
            sync_status: 'LOCAL',
        });
        return row;
    }

    async function saveApprovalMeta(user, id, { confirm, approve, unconfirm, unapprove, company_comment } = {}) {
        const row = await get(id);
        if (!row) throw Object.assign(new Error('Permit not found.'), { code: 'NOT_FOUND' });
        const today = now().slice(0, 10);
        if (confirm && !row.confirmed_at) {
            if (row.visible_in_list === false) {
                throw Object.assign(new Error('Save to list before Confirm.'), { code: 'INVALID_STATUS' });
            }
            if (!TVC_RBAC.canConfirmDepartment(user, row.department)) {
                throw Object.assign(new Error('Confirm permission required.'), { code: 'FORBIDDEN' });
            }
            row.confirmed_by = TVC_RBAC.getDepartmentConfirmLabel(row.department, user)
                || TVC_RBAC.getRankLabel(user);
            row.confirmed_at = today;
        }
        if (unconfirm && (row.confirmed_at || row.confirmed_by)) {
            if (row.approved_at || row.approved_by) {
                throw Object.assign(new Error('Approved permit cannot be unconfirmed.'), { code: 'INVALID_STATUS' });
            }
            if (!TVC_RBAC.canConfirmDepartment(user, row.department)) {
                throw Object.assign(new Error('Confirm permission required.'), { code: 'FORBIDDEN' });
            }
            row.confirmed_by = '';
            row.confirmed_at = '';
        }
        if (approve && !row.approved_at) {
            if (!TVC_RBAC.isHqAccount(user)) {
                throw Object.assign(new Error('HQ approval only.'), { code: 'FORBIDDEN' });
            }
            const hqDirect = TVC_RBAC.canHqDirectApprove(user, row);
            if (!row.confirmed_at && !hqDirect) {
                throw Object.assign(new Error('Confirm required before Approve.'), { code: 'INVALID_STATUS' });
            }
            if (!row.confirmed_at && hqDirect) {
                row.confirmed_by = row.confirmed_by || TVC_RBAC.getDepartmentConfirmLabel(row.department, user);
                row.confirmed_at = row.confirmed_at || today;
            }
            row.approved_by = TVC_RBAC.getReportedByLabel(user) || user.display_name || 'Company';
            row.approved_at = today;
        }
        if (unapprove && (row.approved_at || row.approved_by)) {
            if (!TVC_RBAC.isHqAccount(user)) {
                throw Object.assign(new Error('HQ unapprove only.'), { code: 'FORBIDDEN' });
            }
            if (TVC_WorkPermit.isHqReplyExported(row)) {
                throw Object.assign(new Error('Exported permit cannot be unapproved.'), { code: 'LOCKED' });
            }
            row.approved_by = '';
            row.approved_at = '';
        }
        if (company_comment !== undefined && TVC_RBAC.isHqAccount(user)) {
            row.company_comment = String(company_comment ?? '');
        }
        markPending(row);
        await TVC_DB.put('work_permits', row);
        return row;
    }

    async function saveCompanyComment(user, id, comment) {
        if (!TVC_RBAC.isHqAccount(user)) {
            throw Object.assign(new Error('HQ only.'), { code: 'FORBIDDEN' });
        }
        const row = await get(id);
        if (!row) throw Object.assign(new Error('Permit not found.'), { code: 'NOT_FOUND' });
        if (TVC_WorkPermit.isHqReplyExported(row)) {
            throw Object.assign(new Error('Reply already exported — Company Comments cannot be changed.'), { code: 'LOCKED' });
        }
        row.company_comment = String(comment ?? '');
        markPending(row);
        await TVC_DB.put('work_permits', row);
        return row;
    }

    async function deleteCase(user, id) {
        const row = await get(id);
        if (!row) return;
        const hqImportedCleanup = user && TVC_RBAC.isHqAccount(user) && row.hq_synced
            && (row.approved_at || row.approved_by) && row.sync_status !== 'SYNCED';
        if (!hqImportedCleanup && !TVC_WorkPermit.canDeleteListWorkflow(row)) {
            throw Object.assign(new Error('Cannot delete this permit.'), { code: 'LOCKED' });
        }
        if (!hqImportedCleanup && user?.department && row.department && user.department !== row.department) {
            throw Object.assign(new Error('Department forbidden.'), { code: 'FORBIDDEN' });
        }
        await TVC_DB.del('work_permits', id);
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `🗑 [Work Permit] ${row.permit_no || row.id} deleted — ${user?.display_name || user?.username || ''}`,
            sync_status: 'LOCAL',
        });
    }

    return {
        get, saveDraft, saveApprovalMeta, saveCompanyComment, deleteCase, createFromJob,
        resolveVesselId, nextPermitNo, markPending,
    };
})();

if (typeof window !== 'undefined') window.TVC_WorkPermitCaseService = TVC_WorkPermitCaseService;
