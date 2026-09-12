/** Legacy SM identifiers → SM (read-time normalize for IndexedDB / ZIP / sessions). */
const TVC_LegacySm = (function () {
    const ACCOUNT_HQ = 'HQ';
    const ACCOUNT_SM = 'SM';
    const ROLE_HQ_SUP = 'HQ_SUPERVISOR';
    const ROLE_SM_SUP = 'SM_SUPERVISOR';

    const SYNC_DIR_MAP = {
        SHIP_TO_SM: 'SHIP_TO_SM',
        SM_TO_SHIP: 'SM_TO_SHIP',
        DEFECT_URGENT_TO_SM: 'DEFECT_URGENT_TO_SM',
        DEFECT_REPLY_SM_TO_SHIP: 'DEFECT_REPLY_SM_TO_SHIP',
        POSTPONE_REPLY_SM_TO_SHIP: 'POSTPONE_REPLY_SM_TO_SHIP',
        WORK_PERMIT_REPLY_SM_TO_SHIP: 'WORK_PERMIT_REPLY_SM_TO_SHIP',
        VESSEL_PROFILE_SM_TO_SHIP: 'VESSEL_PROFILE_SM_TO_SHIP',
        SHIP_TO_SM: 'SHIP_TO_SM',
        SM_TO_SHIP: 'SM_TO_SHIP',
        DEFECT_URGENT_TO_SM: 'DEFECT_URGENT_TO_SM',
        DEFECT_REPLY_SM_TO_SHIP: 'DEFECT_REPLY_SM_TO_SHIP',
        POSTPONE_REPLY_SM_TO_SHIP: 'POSTPONE_REPLY_SM_TO_SHIP',
        WORK_PERMIT_REPLY_SM_TO_SHIP: 'WORK_PERMIT_REPLY_SM_TO_SHIP',
        VESSEL_PROFILE_SM_TO_SHIP: 'VESSEL_PROFILE_SM_TO_SHIP',
    };

    function normalizeAccountType(accountType) {
        const t = String(accountType || '').trim().toUpperCase();
        return t === ACCOUNT_HQ ? ACCOUNT_SM : t;
    }

    function normalizeRole(role) {
        const r = String(role || '').trim();
        if (r === ROLE_HQ_SUP) return ROLE_SM_SUP;
        return r;
    }

    function normalizeSyncDirection(direction) {
        const d = String(direction || '').trim();
        return SYNC_DIR_MAP[d] || d;
    }

    function normalizeSpace(space) {
        const s = String(space || '').trim().toUpperCase();
        return s === ACCOUNT_HQ ? ACCOUNT_SM : s;
    }

    /** PMS run-hour scope key: HQ_<vesselId> → SM_<vesselId> */
    function normalizeScope(scope) {
        const s = String(scope || '').trim();
        if (s.startsWith('HQ_')) return `SM_${s.slice(3)}`;
        return s;
    }

    function normalizeRequisitionStatus(status) {
        const s = String(status || '').trim();
        if (s === 'HQ_REVIEW') return 'SM_REVIEW';
        return s;
    }

    /** IndexedDB rows may still carry sm_synced from older builds. */
    function rowSmSynced(row) {
        if (!row || typeof row !== 'object') return false;
        if (row.sm_synced === true) return true;
        if (row.sm_synced === true) return true;
        return false;
    }

    function tagRowSmSynced(row) {
        if (!row || typeof row !== 'object') return;
        row.sm_synced = true;
        try { delete row.sm_synced; } catch (_) { /* frozen */ }
    }

    return {
        normalizeAccountType,
        normalizeRole,
        normalizeSyncDirection,
        normalizeSpace,
        normalizeScope,
        normalizeRequisitionStatus,
        rowSmSynced,
        tagRowSmSynced,
        SYNC_DIR_MAP,
    };
})();
if (typeof window !== 'undefined') window.TVC_LegacySm = TVC_LegacySm;
