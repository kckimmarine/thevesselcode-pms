/* Defect (Trouble) Report Case — Phase 1·2 긴급 워크플로 */
const TVC_DefectCaseService = (function () {
    const now = () => new Date().toISOString();

    async function resolveVesselId(user) {
        try {
            const meta = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID);
            if (meta) return String(meta).trim();
        } catch (_) {}
        return String(user?.vessel_id || '').trim();
    }

    async function nextCaseNo(vesselId) {
        const year = new Date().getFullYear();
        const prefix = `DEF-${vesselId || 'VESSEL'}-${year}-`;
        const all = await TVC_DB.getAll('defect_cases');
        const seq = all
            .map(r => String(r.case_no || ''))
            .filter(n => n.startsWith(prefix))
            .map(n => parseInt(n.slice(prefix.length), 10))
            .filter(n => !Number.isNaN(n))
            .reduce((max, n) => Math.max(max, n), 0);
        return `${prefix}${String(seq + 1).padStart(4, '0')}`;
    }

    async function listAll() {
        return TVC_DB.getAll('defect_cases');
    }

    async function get(id) {
        return TVC_DB.get('defect_cases', id);
    }

    function markPending(row) {
        row.sync_status = row.sync_status === 'SYNCED' ? 'PENDING_SYNC' : 'LOCAL';
        row.updated_at = now();
        return row;
    }

    async function saveDraft(user, payload, existingId) {
        const vesselId = await resolveVesselId(user);
        let row = existingId ? await get(existingId) : null;
        if (row && row.phase1_locked) {
            throw Object.assign(new Error('Phase 1 is locked after submission.'), { code: 'LOCKED' });
        }
        if (!row) {
            row = TVC_DefectCase.blank({
                vessel_id: vesselId,
                reported_by: user?.username || '',
                department: payload.department || user?.department || '',
            });
            row.case_no = await nextCaseNo(vesselId);
        }
        Object.assign(row, payload, {
            vessel_id: vesselId || row.vessel_id,
            reported_by: user?.username || row.reported_by,
            status: row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
                ? row.status
                : TVC_DefectCase.Status.DRAFT,
        });
        markPending(row);
        await TVC_DB.put('defect_cases', row);
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `🛠 [Defect/DRAFT] ${row.case_no}`,
            sync_status: 'LOCAL',
        });
        return row;
    }

    async function submitToCompany(user, id) {
        const row = await get(id);
        if (!row) throw Object.assign(new Error('Case not found.'), { code: 'NOT_FOUND' });
        if (row.phase1_locked) throw Object.assign(new Error('Already submitted.'), { code: 'LOCKED' });
        const v = TVC_DefectCase.validatePhase1(row);
        if (!v.ok) {
            throw Object.assign(new Error(`Required: ${v.missing.join(', ')}`), { code: 'VALIDATION', missing: v.missing });
        }
        row.status = TVC_DefectCase.Status.SUBMITTED_TO_COMPANY;
        row.phase1_locked = true;
        row.submitted_at = now();
        row.chief_engineer = row.chief_engineer || (user?.department === 'ENGINE' ? TVC_RBAC.getRankLabel(user) : row.chief_engineer);
        row.master = row.master || (user?.department === 'DECK' || user?.role === 'SHIP_CAPTAIN' ? TVC_RBAC.getRankLabel(user) : row.master);
        markPending(row);
        await TVC_DB.put('defect_cases', row);
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `🚨 [Defect/SUBMIT] ${row.case_no} → Company (URGENT)`,
            sync_status: 'LOCAL',
        });
        return row;
    }

    async function saveHqPhase2(user, id, phase2) {
        if (!TVC_RBAC.isHqAccount(user)) {
            throw Object.assign(new Error('HQ only.'), { code: 'FORBIDDEN' });
        }
        const row = await get(id);
        if (!row) throw Object.assign(new Error('Case not found.'), { code: 'NOT_FOUND' });
        if (row.status !== TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) {
            throw Object.assign(new Error('Case is not awaiting company review.'), { code: 'INVALID_STATUS' });
        }
        Object.assign(row, phase2, {
            reply_by: phase2.reply_by || TVC_RBAC.getRankLabel(user),
            reply_date: phase2.reply_date || now().slice(0, 10),
            status: TVC_DefectCase.Status.COMPANY_REVIEWED,
            phase2_locked: true,
            hq_synced: true,
        });
        const v = TVC_DefectCase.validatePhase2(row);
        if (!v.ok) {
            throw Object.assign(new Error(`Required: ${v.missing.join(', ')}`), { code: 'VALIDATION', missing: v.missing });
        }
        markPending(row);
        await TVC_DB.put('defect_cases', row);
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `✅ [Defect/HQ Reply] ${row.case_no} — Permit: ${row.permit_to_work ? 'Y' : 'N'}`,
            sync_status: 'LOCAL',
        });
        return row;
    }

    async function startWork(user, id) {
        const row = await get(id);
        if (!row) throw Object.assign(new Error('Case not found.'), { code: 'NOT_FOUND' });
        if (!TVC_DefectCase.canStartWork(row)) {
            throw Object.assign(new Error('Work can start after Company Phase 2 (Permit).'), { code: 'INVALID_STATUS' });
        }
        row.status = TVC_DefectCase.Status.WORK_IN_PROGRESS;
        markPending(row);
        await TVC_DB.put('defect_cases', row);
        return row;
    }

    async function saveShipPhase3(user, id, phase3) {
        if (TVC_RBAC.isHqAccount(user)) {
            throw Object.assign(new Error('Ship only.'), { code: 'FORBIDDEN' });
        }
        const row = await get(id);
        if (!row) throw Object.assign(new Error('Case not found.'), { code: 'NOT_FOUND' });
        if (row.phase3_locked) {
            throw Object.assign(new Error('Phase 3 is locked.'), { code: 'LOCKED' });
        }
        if (!TVC_DefectCase.isPhase3Editable(row)) {
            throw Object.assign(new Error('Complete Phase 2 before reporting clearance.'), { code: 'INVALID_STATUS' });
        }
        Object.assign(row, phase3, {
            ship_verified_by: phase3.ship_verified_by || TVC_RBAC.getRankLabel(user),
            ship_verified_date: phase3.ship_verified_date || now().slice(0, 10),
            status: TVC_DefectCase.Status.AWAITING_COMPLETION,
            phase3_locked: true,
            completed_at: now(),
        });
        const v = TVC_DefectCase.validatePhase3(row);
        if (!v.ok) {
            throw Object.assign(new Error(`Required: ${v.missing.join(', ')}`), { code: 'VALIDATION', missing: v.missing });
        }
        markPending(row);
        await TVC_DB.put('defect_cases', row);
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `✔ [Defect/Phase3] ${row.case_no} — Cleared, reported to Company`,
            sync_status: 'LOCAL',
        });
        return row;
    }

    async function saveHqPhase4(user, id, phase4) {
        if (!TVC_RBAC.isHqAccount(user)) {
            throw Object.assign(new Error('HQ only.'), { code: 'FORBIDDEN' });
        }
        const row = await get(id);
        if (!row) throw Object.assign(new Error('Case not found.'), { code: 'NOT_FOUND' });
        if (!TVC_DefectCase.isPhase4Editable(row)) {
            if (row.phase4_locked) throw Object.assign(new Error('Case already closed.'), { code: 'LOCKED' });
            throw Object.assign(new Error('Awaiting ship Phase 3 completion report.'), { code: 'INVALID_STATUS' });
        }
        const sat = phase4.dp_closed_satisfactory;
        const satisfactory = sat === true || sat === 'true'
            ? true
            : sat === false || sat === 'false'
                ? false
                : null;
        Object.assign(row, phase4, {
            dp_closed_satisfactory: satisfactory,
            dp_closed_by: phase4.dp_closed_by || TVC_RBAC.getRankLabel(user),
            dp_closed_date: phase4.dp_closed_date || now().slice(0, 10),
            status: TVC_DefectCase.Status.CLOSED,
            phase4_locked: true,
            hq_synced: true,
            closed_at: now(),
        });
        const v = TVC_DefectCase.validatePhase4(row);
        if (!v.ok) {
            throw Object.assign(new Error(`Required: ${v.missing.join(', ')}`), { code: 'VALIDATION', missing: v.missing });
        }
        markPending(row);
        await TVC_DB.put('defect_cases', row);
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `🏁 [Defect/Phase4] ${row.case_no} — ${row.dp_closed_satisfactory ? 'Satisfactory' : 'Unsatisfactory'}`,
            sync_status: 'LOCAL',
        });
        return row;
    }

    async function createFromJob(user, job, shipName) {
        const vesselId = await resolveVesselId(user);
        const row = TVC_DefectCase.fromJob(job, {});
        row.vessel_id = vesselId;
        row.ship_name = shipName || row.ship_name;
        row.department = job?.department || user?.department || '';
        row.reported_by = user?.username || '';
        row.case_no = await nextCaseNo(vesselId);
        row.id = `DEF-${Date.now()}`;
        markPending(row);
        await TVC_DB.put('defect_cases', row);
        return row;
    }

    return {
        listAll, get, saveDraft, submitToCompany, saveHqPhase2, saveShipPhase3, saveHqPhase4,
        startWork, createFromJob,
        resolveVesselId, nextCaseNo, markPending,
    };
})();

if (typeof window !== 'undefined') window.TVC_DefectCaseService = TVC_DefectCaseService;
