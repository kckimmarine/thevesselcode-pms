/* Original Plan — Maintenance Job CRUD (Modify / Append / Delete) */
const TVC_MaintenancePlan = (function () {
    const now = () => new Date().toISOString();

    function newId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    }

    function assertCanEdit(user) {
        TVC_RBAC.assertModifyOriginalPlan(user);
    }

    function assertDept(user, job) {
        if (user.department && job.department && user.department !== job.department) {
            throw Object.assign(new Error('DEPT_FORBIDDEN'), { code: 'FORBIDDEN' });
        }
    }

    function recalcOverdue(job) {
        if (!job.next_date) {
            job.is_overdue = false;
            return;
        }
        job.is_overdue = new Date(job.next_date) < new Date(new Date().toDateString());
    }

    function markLocal(entity) {
        entity.sync_status = entity.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (entity.sync_status || 'LOCAL');
        entity.updated_at = now();
        return entity;
    }

    async function logAudit(message) {
        await TVC_DB.put('audit_logs', { timestamp: new Date().toLocaleString(), log: message, sync_status: 'LOCAL' });
    }

    function normalizePatch(patch) {
        const p = { ...patch };
        if (p.period != null && p.period !== '') p.period = Number(p.period);
        if (p.next_date === '') p.next_date = null;
        if (p.last_done === '') p.last_done = null;
        return p;
    }

    /** 기존 작업 항목 수정 */
    async function updateJob(user, jobId, patch) {
        assertCanEdit(user);
        const job = await TVC_DB.get('maintenance_jobs', jobId);
        if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { code: 'NOT_FOUND' });
        assertDept(user, job);

        const fields = ['group', 'job_code', 'sort', 'item_sort1', 'item_sort2', 'job_detail',
            'period', 'unit', 'pic', 'next_date', 'last_done'];
        const p = normalizePatch(patch);
        fields.forEach(f => { if (p[f] !== undefined) job[f] = p[f]; });

        if (p.job_code && p.job_code !== job.job_code) {
            const dup = await TVC_DB.indexGetAll('maintenance_jobs', 'by_job_code', p.job_code);
            if (dup.some(j => j.id !== jobId)) {
                throw Object.assign(new Error('JOB_CODE_EXISTS'), { code: 'DUPLICATE' });
            }
        }

        recalcOverdue(job);
        if (p.next_date && !job.original_next_date) job.original_next_date = p.next_date;
        job.plan_status = job.is_overdue ? 'OVERDUE' : 'PLANNED';
        markLocal(job);
        await TVC_DB.put('maintenance_jobs', job);
        await logAudit(`✏️ [ORIG/MODIFY] ${job.job_code} — ${user.display_name}`);
        return job;
    }

    /** 신규 작업 항목 추가 */
    async function createJob(user, data) {
        assertCanEdit(user);
        const dept = data.department || user.department;
        if (!dept) throw Object.assign(new Error('DEPARTMENT_REQUIRED'), { code: 'INVALID' });
        if (user.department && user.department !== dept) {
            throw Object.assign(new Error('DEPT_FORBIDDEN'), { code: 'FORBIDDEN' });
        }

        const jobCode = String(data.job_code || '').trim();
        if (!jobCode) throw Object.assign(new Error('JOB_CODE_REQUIRED'), { code: 'INVALID' });

        const dup = await TVC_DB.indexGetAll('maintenance_jobs', 'by_job_code', jobCode);
        if (dup.length) throw Object.assign(new Error('JOB_CODE_EXISTS'), { code: 'DUPLICATE' });

        const p = normalizePatch(data);
        const job = markLocal({
            id: newId(),
            department: dept,
            group: p.group || 'UNGROUPED',
            job_code: jobCode,
            sort: p.sort || '',
            item_sort1: p.item_sort1 || '',
            item_sort2: p.item_sort2 || '',
            job_detail: p.job_detail || '',
            period: Number(p.period) || 1,
            unit: (p.unit || 'M').toUpperCase(),
            pic: p.pic || '',
            next_date: p.next_date || null,
            last_done: p.last_done || null,
            original_next_date: p.next_date || null,
            ship_component_id: p.ship_component_id || null,
            is_locked: false,
            plan_status: 'PLANNED',
            schedule_basis: null,
        });
        recalcOverdue(job);
        if (job.is_overdue) job.plan_status = 'OVERDUE';

        await TVC_DB.put('maintenance_jobs', job);
        await logAudit(`➕ [ORIG/APPEND] ${job.job_code} — ${user.display_name}`);
        return job;
    }

    /** 작업 항목 삭제 */
    async function deleteJob(user, jobId, reports) {
        assertCanEdit(user);
        const job = await TVC_DB.get('maintenance_jobs', jobId);
        if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { code: 'NOT_FOUND' });
        assertDept(user, job);

        const linked = (reports || []).some(r =>
            TVC_WorkReport.getJobItems(r).some(i => i.maintenance_job_id === jobId)
        );
        if (linked) {
            throw Object.assign(new Error('WORK_REPORT_EXISTS'), { code: 'LINKED' });
        }

        await TVC_DB.del('maintenance_jobs', jobId);
        await logAudit(`🗑 [ORIG/DELETE] ${job.job_code} — ${user.display_name}`);
        return job;
    }

    function groupKeyOf(dept, label) {
        return `${dept || ''}|${String(label || '').trim()}`;
    }

    /** Original Plan GROUP Tree — 신규 그룹 추가 (작업 없이 트리에만 표시) */
    async function createGroup(user, department, label) {
        assertCanEdit(user);
        const dept = String(department || '').trim();
        const lab = String(label || '').trim();
        if (!dept) throw Object.assign(new Error('DEPARTMENT_REQUIRED'), { code: 'INVALID' });
        if (!lab) throw Object.assign(new Error('GROUP_LABEL_REQUIRED'), { code: 'INVALID' });

        const key = groupKeyOf(dept, lab);
        const allJobs = await TVC_DB.getAll('maintenance_jobs');
        if (allJobs.some(j => TVC_Indexes.groupKey(j) === key)) {
            throw Object.assign(new Error('GROUP_EXISTS'), { code: 'DUPLICATE' });
        }
        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        if (defs.some(g => groupKeyOf(g.department, g.label) === key)) {
            throw Object.assign(new Error('GROUP_EXISTS'), { code: 'DUPLICATE' });
        }

        const row = markLocal({
            id: 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            department: dept,
            label: lab,
            sort_order: 0,
            created_at: now(),
        });
        await TVC_DB.put('maintenance_groups', row);
        await logAudit(`➕ [ORIG/GROUP+] ${dept} · ${lab} — ${user.display_name}`);
        return row;
    }

    /** Original Plan GROUP Tree — 그룹명 변경 (해당 그룹 작업 전체 + Run-hour 키) */
    async function renameGroup(user, department, oldLabel, newLabel) {
        assertCanEdit(user);
        const dept = String(department || '').trim();
        const oldName = String(oldLabel || '').trim();
        const newName = String(newLabel || '').trim();
        if (!dept || !oldName) throw Object.assign(new Error('GROUP_REQUIRED'), { code: 'INVALID' });
        if (!newName) throw Object.assign(new Error('GROUP_LABEL_REQUIRED'), { code: 'INVALID' });
        if (oldName === newName) return { updated: 0, newKey: groupKeyOf(dept, newName) };

        const oldKey = groupKeyOf(dept, oldName);
        const newKey = groupKeyOf(dept, newName);
        const allJobs = await TVC_DB.getAll('maintenance_jobs');
        if (allJobs.some(j => j.department === dept && (j.group || '').trim() === newName && (j.group || '').trim() !== oldName)) {
            throw Object.assign(new Error('GROUP_EXISTS'), { code: 'DUPLICATE' });
        }

        let updated = 0;
        for (const job of allJobs) {
            if (job.department !== dept || (job.group || '').trim() !== oldName) continue;
            job.group = newName;
            markLocal(job);
            await TVC_DB.put('maintenance_jobs', job);
            updated++;
        }

        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        for (const g of defs) {
            if (g.department === dept && (g.label || '').trim() === oldName) {
                g.label = newName;
                markLocal(g);
                await TVC_DB.put('maintenance_groups', g);
            }
        }

        if (typeof TVC_PMS.renameGroupKey === 'function') {
            TVC_PMS.renameGroupKey(oldKey, newKey);
        }

        await logAudit(`✏️ [ORIG/GROUP↔] ${dept} · ${oldName} → ${newName} (${updated} jobs) — ${user.display_name}`);
        return { updated, newKey };
    }

    return { updateJob, createJob, deleteJob, createGroup, renameGroup, recalcOverdue, groupKeyOf };
})();
