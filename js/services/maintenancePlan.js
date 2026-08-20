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

    function assertCanEditGroup(user) {
        if (TVC_RBAC.canModifyOriginalPlan(user)) return;
        if (TVC_RBAC.canModifySpareInventory(user)) return;
        TVC_RBAC.assertModifyOriginalPlan(user);
    }

    function assertDept(user, job) {
        if (user.department && job.department && user.department !== job.department) {
            throw Object.assign(new Error('DEPT_FORBIDDEN'), { code: 'FORBIDDEN' });
        }
    }

    async function resolveVessel(user, data) {
        if (typeof TVC_MasterVesselScope === 'undefined') {
            return data?.vessel_id || user?.vessel_id || 'INCHEON CHEMI';
        }
        return TVC_MasterVesselScope.resolve(user, {
            vesselId: data?.vessel_id,
            selectedVesselId: data?.selectedVesselId,
        });
    }

    function sameVessel(row, vesselId) {
        if (typeof TVC_MasterVesselScope !== 'undefined') {
            return TVC_MasterVesselScope.belongs(row, vesselId);
        }
        return !row?.vessel_id || row.vessel_id === vesselId;
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
        if (p.is_critical_equipment === 'Yes') p.is_critical_equipment = true;
        else if (p.is_critical_equipment === 'No') p.is_critical_equipment = false;
        else if (p.is_critical_equipment === '' || p.is_critical_equipment === '—') p.is_critical_equipment = null;
        return p;
    }

    /** 기존 작업 항목 수정 */
    async function updateJob(user, jobId, patch) {
        assertCanEdit(user);
        const job = await TVC_DB.get('maintenance_jobs', jobId);
        if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { code: 'NOT_FOUND' });
        assertDept(user, job);

        const vesselId = await resolveVessel(user, { vessel_id: job.vessel_id || patch?.vessel_id, selectedVesselId: patch?.selectedVesselId });
        if (TVC_RBAC.isHqAccount(user) && job.vessel_id && !sameVessel(job, vesselId)) {
            throw Object.assign(new Error('VESSEL_FORBIDDEN'), { code: 'FORBIDDEN' });
        }

        const fields = ['group', 'job_code', 'sort', 'item_sort1', 'item_sort2', 'job_detail',
            'period', 'unit', 'pic', 'next_date', 'last_done', 'is_critical_equipment'];
        const p = normalizePatch(patch);
        const prevJobCode = job.job_code;
        fields.forEach(f => { if (p[f] !== undefined) job[f] = p[f]; });

        if (p.job_code && p.job_code !== prevJobCode) {
            const dup = await TVC_DB.indexGetAll('maintenance_jobs', 'by_job_code', p.job_code);
            if (dup.some(j => j.id !== jobId && j.department === job.department && sameVessel(j, vesselId))) {
                throw Object.assign(new Error('JOB_CODE_EXISTS'), { code: 'DUPLICATE' });
            }
        }

        if (!job.vessel_id) job.vessel_id = vesselId;
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

        const vesselId = await resolveVessel(user, data);
        const jobCode = String(data.job_code || '').trim();
        if (!jobCode) throw Object.assign(new Error('JOB_CODE_REQUIRED'), { code: 'INVALID' });

        const dup = await TVC_DB.indexGetAll('maintenance_jobs', 'by_job_code', jobCode);
        if (dup.some(j => j.department === dept && sameVessel(j, vesselId))) {
            throw Object.assign(new Error('JOB_CODE_EXISTS'), { code: 'DUPLICATE' });
        }

        const p = normalizePatch(data);
        const job = markLocal({
            id: newId(),
            vessel_id: vesselId,
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
            is_critical_equipment: p.is_critical_equipment == null ? null : !!p.is_critical_equipment,
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

        if (TVC_RBAC.isHqAccount(user)) {
            const vesselId = await resolveVessel(user, {});
            if (job.vessel_id && !sameVessel(job, vesselId)) {
                throw Object.assign(new Error('VESSEL_FORBIDDEN'), { code: 'FORBIDDEN' });
            }
        }

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
        const g = String(label ?? '').replace(/\s+/g, ' ').trim();
        return `${dept || ''}|${g}`;
    }

    /** Original Plan GROUP Tree — 신규 그룹 추가 (작업 없이 트리에만 표시) */
    async function createGroup(user, department, label, opts = {}) {
        assertCanEditGroup(user);
        const dept = String(department || '').trim();
        const lab = String(label || '').trim();
        if (!dept) throw Object.assign(new Error('DEPARTMENT_REQUIRED'), { code: 'INVALID' });
        if (!lab) throw Object.assign(new Error('GROUP_LABEL_REQUIRED'), { code: 'INVALID' });

        const vesselId = await resolveVessel(user, opts);
        const key = groupKeyOf(dept, lab);
        const allJobs = await TVC_DB.getAll('maintenance_jobs');
        if (allJobs.some(j => sameVessel(j, vesselId) && TVC_Indexes.groupKey(j) === key)) {
            throw Object.assign(new Error('GROUP_EXISTS'), { code: 'DUPLICATE' });
        }
        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        if (defs.some(g => sameVessel(g, vesselId) && groupKeyOf(g.department, g.label) === key)) {
            throw Object.assign(new Error('GROUP_EXISTS'), { code: 'DUPLICATE' });
        }

        const row = markLocal({
            id: 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            vessel_id: vesselId,
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
    async function renameGroup(user, department, oldLabel, newLabel, opts = {}) {
        assertCanEdit(user);
        const dept = String(department || '').trim();
        const oldName = String(oldLabel || '').trim();
        const newName = String(newLabel || '').trim();
        if (!dept || !oldName) throw Object.assign(new Error('GROUP_REQUIRED'), { code: 'INVALID' });
        if (!newName) throw Object.assign(new Error('GROUP_LABEL_REQUIRED'), { code: 'INVALID' });
        if (oldName === newName) return { updated: 0, newKey: groupKeyOf(dept, newName) };

        const vesselId = await resolveVessel(user, opts);
        const oldKey = groupKeyOf(dept, oldName);
        const newKey = groupKeyOf(dept, newName);
        const allJobs = await TVC_DB.getAll('maintenance_jobs');
        if (allJobs.some(j =>
            sameVessel(j, vesselId)
            && j.department === dept
            && (j.group || '').trim() === newName
            && (j.group || '').trim() !== oldName
        )) {
            throw Object.assign(new Error('GROUP_EXISTS'), { code: 'DUPLICATE' });
        }

        let updated = 0;
        for (const job of allJobs) {
            if (!sameVessel(job, vesselId)) continue;
            if (job.department !== dept || (job.group || '').trim() !== oldName) continue;
            job.group = newName;
            markLocal(job);
            await TVC_DB.put('maintenance_jobs', job);
            updated++;
        }

        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        for (const g of defs) {
            if (!sameVessel(g, vesselId)) continue;
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

    /** Original Plan / SPARE GROUP Tree — 빈 그룹 삭제 (작업·부품 없을 때만) */
    async function deleteGroup(user, department, label, opts = {}) {
        assertCanEditGroup(user);
        const dept = String(department || '').trim();
        const lab = String(label || '').trim();
        if (!dept || !lab) throw Object.assign(new Error('GROUP_REQUIRED'), { code: 'INVALID' });

        const vesselId = await resolveVessel(user, opts);
        const allJobs = await TVC_DB.getAll('maintenance_jobs');
        const jobsInGroup = allJobs.filter(j =>
            sameVessel(j, vesselId) && j.department === dept && String(j.group || '').trim() === lab
        );
        if (jobsInGroup.length) {
            throw Object.assign(new Error('GROUP_HAS_JOBS'), { code: 'HAS_JOBS', count: jobsInGroup.length });
        }

        const spares = await TVC_DB.getAll('spare_parts');
        const sparesInGroup = spares.filter(s => {
            if (!sameVessel(s, vesselId)) return false;
            const cat = String(s.category || s.department || '').trim();
            if (cat && cat !== dept) return false;
            return String(s.group || '').trim() === lab;
        });
        if (sparesInGroup.length) {
            throw Object.assign(new Error('GROUP_HAS_SPARES'), { code: 'HAS_SPARES', count: sparesInGroup.length });
        }

        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        let removed = 0;
        for (const g of defs) {
            if (!sameVessel(g, vesselId)) continue;
            if (g.department === dept && String(g.label || '').trim() === lab) {
                await TVC_DB.del('maintenance_groups', g.id);
                removed++;
            }
        }

        const key = groupKeyOf(dept, lab);
        if (typeof TVC_PMS.deleteGroupKey === 'function') {
            TVC_PMS.deleteGroupKey(key);
        }

        await logAudit(`🗑 [ORIG/GROUP-] ${dept} · ${lab} — ${user.display_name}`);
        return { removed, key };
    }

    return { updateJob, createJob, deleteJob, createGroup, renameGroup, deleteGroup, recalcOverdue, groupKeyOf };
})();
