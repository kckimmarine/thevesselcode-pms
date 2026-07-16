/** THE VESSEL CODE — Browser RBAC (mirrors src/auth/rbac.js) */
const TVC_RBAC = (function () {
    const AccountType = { SHIP: 'SHIP', HQ: 'HQ' };

    const Department = { DECK: 'DECK', ENGINE: 'ENGINE' };

    const Role = {
        SHIP_OFFICER: 'SHIP_OFFICER',   // Deck/Engine inputter (부서에 따라)
        SHIP_CAPTAIN: 'SHIP_CAPTAIN',   // Deck approver
        SHIP_CHIEF: 'SHIP_CHIEF',       // Engine approver
        HQ_SUPERVISOR: 'HQ_SUPERVISOR',
    };

    // 승인 권한을 가진 선박 역할 (부서 책임자)
    const APPROVER_ROLES = new Set(['SHIP_CAPTAIN', 'SHIP_CHIEF']);

    const ReportStatus = {
        REPORTED: 'REPORTED',
        CONFIRMED: 'CONFIRMED',
        APPROVED: 'APPROVED',
        POSTPONED: 'POSTPONED',
        // legacy (read-time normalize only)
        PENDING: 'PENDING',
    };

    const LEGACY_REPORT_STATUS = {
        PENDING: 'REPORTED',
        APPROVED: 'CONFIRMED',
        POSTPONED: 'CONFIRMED',
    };

    function normalizeReportStatus(status, isLocked) {
        if (status === 'PENDING') return ReportStatus.REPORTED;
        if (status === 'POSTPONED') return ReportStatus.CONFIRMED;
        if (status === 'APPROVED') return ReportStatus.CONFIRMED;
        if (status === 'CONFIRMED') return isLocked ? ReportStatus.APPROVED : ReportStatus.CONFIRMED;
        return status || ReportStatus.REPORTED;
    }

    function isReportedStatus(status, isLocked) { return normalizeReportStatus(status, isLocked) === ReportStatus.REPORTED; }
    function isConfirmedStatus(status, isLocked) { return normalizeReportStatus(status, isLocked) === ReportStatus.CONFIRMED; }
    function isApprovedStatus(status, isLocked) { return normalizeReportStatus(status, isLocked) === ReportStatus.APPROVED; }

    const Action = {
        CREATE_DAILY_REPORT: 'CREATE_DAILY_REPORT',
        EDIT_OWN_PENDING_REPORT: 'EDIT_OWN_PENDING_REPORT',
        APPROVE_DAILY_REPORT: 'APPROVE_DAILY_REPORT',
        POSTPONE_DAILY_REPORT: 'POSTPONE_DAILY_REPORT',
        VIEW_INVENTORY: 'VIEW_INVENTORY',
        DEDUCT_INVENTORY: 'DEDUCT_INVENTORY',
        MODIFY_INVENTORY: 'MODIFY_INVENTORY',
        CREATE_REQUISITION: 'CREATE_REQUISITION',
        UPDATE_RUN_HOURS: 'UPDATE_RUN_HOURS',
        EXPORT_SHIP_SYNC: 'EXPORT_SHIP_SYNC',
        IMPORT_SHIP_SYNC: 'IMPORT_SHIP_SYNC',
        IMPORT_HQ_SYNC: 'IMPORT_HQ_SYNC',
        EXPORT_HQ_FEEDBACK: 'EXPORT_HQ_FEEDBACK',
        REVIEW_MASTER_PLAN: 'REVIEW_MASTER_PLAN',
        APPROVE_ORIGINAL_PLAN: 'APPROVE_ORIGINAL_PLAN',
        ADD_COMPANY_COMMENT: 'ADD_COMPANY_COMMENT',
        CONFIRM_REPORT: 'CONFIRM_REPORT',
        SUBMIT_DEFECT_REPORT: 'SUBMIT_DEFECT_REPORT',
        REPLY_DEFECT_REPORT: 'REPLY_DEFECT_REPORT',
        IMPORT_DEFECT_URGENT: 'IMPORT_DEFECT_URGENT',
        VIEW_PMS_SCHEDULE: 'VIEW_PMS_SCHEDULE',
        MODIFY_MAINTENANCE_ITEM: 'MODIFY_MAINTENANCE_ITEM',
        VIEW_AUDIT_LOG: 'VIEW_AUDIT_LOG',
        EXECUTE_MAINTENANCE: 'EXECUTE_MAINTENANCE',
        SUPPLY_PARTS: 'SUPPLY_PARTS',
    };

    const ROLE_LABELS = {
        SHIP_OFFICER: '사관 (Officer)',
        SHIP_CAPTAIN: '선장 (Captain)',
        SHIP_CHIEF: '기관장 (Chief Engineer)',
        HQ_SUPERVISOR: '본사 공무감독 (HQ)',
    };

    const DEPT_LABELS = { DECK: 'Deck', ENGINE: 'Engine' };

    // 계정 명칭 정의 — Username → Header 표시 타이틀
    const ACCOUNT_TITLES = {
        'officer': 'Officer',
        'captain': 'Captain',
        'engineer': 'Engineer',
        'ce': 'Chief engineer',
        'hq': 'Superintendent',
    };

    const ROLE_PERMISSIONS = {
        SHIP_OFFICER: new Set([
            Action.CREATE_DAILY_REPORT, Action.EDIT_OWN_PENDING_REPORT,
            Action.VIEW_INVENTORY, Action.VIEW_PMS_SCHEDULE,
            Action.UPDATE_RUN_HOURS, Action.CREATE_REQUISITION,
            Action.SUBMIT_DEFECT_REPORT,
        ]),
        SHIP_CHIEF: new Set([
            Action.CREATE_DAILY_REPORT, Action.APPROVE_DAILY_REPORT,
            Action.POSTPONE_DAILY_REPORT, Action.VIEW_INVENTORY,
            Action.DEDUCT_INVENTORY, Action.MODIFY_INVENTORY,
            Action.EXECUTE_MAINTENANCE, Action.SUPPLY_PARTS,
            Action.VIEW_PMS_SCHEDULE, Action.UPDATE_RUN_HOURS,
            Action.EXPORT_SHIP_SYNC, Action.IMPORT_SHIP_SYNC,
            Action.CREATE_REQUISITION, Action.VIEW_AUDIT_LOG,
            Action.MODIFY_MAINTENANCE_ITEM,
            Action.SUBMIT_DEFECT_REPORT, Action.IMPORT_DEFECT_URGENT,
        ]),
        SHIP_CAPTAIN: new Set([
            Action.CREATE_DAILY_REPORT, Action.APPROVE_DAILY_REPORT,
            Action.POSTPONE_DAILY_REPORT, Action.VIEW_INVENTORY,
            Action.DEDUCT_INVENTORY, Action.MODIFY_INVENTORY,
            Action.EXECUTE_MAINTENANCE, Action.SUPPLY_PARTS,
            Action.VIEW_PMS_SCHEDULE, Action.UPDATE_RUN_HOURS,
            Action.EXPORT_SHIP_SYNC, Action.IMPORT_SHIP_SYNC,
            Action.CREATE_REQUISITION, Action.VIEW_AUDIT_LOG,
            Action.MODIFY_MAINTENANCE_ITEM,
            Action.SUBMIT_DEFECT_REPORT, Action.IMPORT_DEFECT_URGENT,
        ]),
        HQ_SUPERVISOR: new Set([
            Action.VIEW_INVENTORY, Action.VIEW_PMS_SCHEDULE,
            Action.IMPORT_HQ_SYNC, Action.EXPORT_HQ_FEEDBACK,
            Action.REVIEW_MASTER_PLAN, Action.APPROVE_ORIGINAL_PLAN,
            Action.ADD_COMPANY_COMMENT, Action.CONFIRM_REPORT,
            Action.VIEW_AUDIT_LOG, Action.MODIFY_MAINTENANCE_ITEM,
            Action.REPLY_DEFECT_REPORT, Action.IMPORT_DEFECT_URGENT,
        ]),
    };

    const ACCOUNT_UI_FEATURES = {
        SHIP: {
            showDailyReportSubmit: true,
            showMaintenanceExecute: false,
            showApprovalQueue: false,
            showHqConfirmPanel: false,
            showExportShip: false,
            showImportShip: false,
            showExportHq: false,
            showImportHq: false,
            showDefectReport: true,
            showDefectInbox: true,
            showDefectUrgentExport: false,
            showDefectImportUrgent: false,
        },
        HQ: {
            showDailyReportSubmit: false,
            showMaintenanceExecute: false,
            showApprovalQueue: false,
            showHqConfirmPanel: true,
            showExportShip: false,
            showImportShip: false,
            showExportHq: true,
            showImportHq: true,
            showDefectReport: false,
            showDefectInbox: true,
            showDefectUrgentExport: false,
            showDefectImportUrgent: true,
        },
    };

    function can(user, action) {
        if (!user || !user.role) return false;
        const perms = ROLE_PERMISSIONS[user.role];
        return perms ? perms.has(action) : false;
    }

    function assert(user, action) {
        if (!can(user, action)) {
            throw Object.assign(new Error('PERMISSION_DENIED'), {
                code: 'PERMISSION_DENIED',
                action,
                role: user?.role,
            });
        }
    }

    function isShipAccount(user) { return user?.account_type === AccountType.SHIP; }
    function isHqAccount(user) { return user?.account_type === AccountType.HQ; }

    function isApprover(user) { return APPROVER_ROLES.has(user?.role); }

    function getUiFeatures(user) {
        const base = { ...(ACCOUNT_UI_FEATURES[user.account_type] || {}) };
        if (isApprover(user)) {
            base.showMaintenanceExecute = true;
            base.showApprovalQueue = true;
            base.showDailyReportSubmit = true;
            base.showExportShip = true;
            base.showImportShip = true;
            base.showModifyOriginalPlan = true;
            base.showDefectUrgentExport = true;
            base.showDefectImportUrgent = true;
        }
        if (user.role === Role.SHIP_OFFICER) {
            base.showMaintenanceExecute = false;
            base.showApprovalQueue = false;
            base.showDefectUrgentExport = false;
        }
        return base;
    }

    function canTransitionReport(user, fromStatus, toStatus) {
        const from = normalizeReportStatus(fromStatus);
        const to = normalizeReportStatus(toStatus);
        const transitions = {
            SHIP_OFFICER: { REPORTED: [] },
            SHIP_CAPTAIN: { REPORTED: ['CONFIRMED'] },
            SHIP_CHIEF: { REPORTED: ['CONFIRMED'] },
            HQ_SUPERVISOR: { CONFIRMED: ['APPROVED'] },
        };
        return (transitions[user.role]?.[from] || []).includes(to);
    }

    function assertReportTransition(user, fromStatus, toStatus) {
        if (!canTransitionReport(user, fromStatus, toStatus)) {
            throw Object.assign(new Error('ILLEGAL_TRANSITION'), {
                code: 'ILLEGAL_TRANSITION', from: fromStatus, to: toStatus, role: user?.role,
            });
        }
    }

    // ── Department scoping ───────────────────────────────────────────
    /** 계정이 접근 가능한 부서 목록. HQ는 전체, 선박은 자기 부서만. */
    function getAccessibleDepartments(user) {
        if (isHqAccount(user)) return [Department.ENGINE, Department.DECK];
        return user?.department ? [user.department] : [];
    }

    function canAccessDepartment(user, dept) {
        if (!dept) return true;                 // null = 전체 뷰
        if (isHqAccount(user)) return true;     // HQ는 모든 부서 조회
        return user?.department === dept;
    }

    /** 선장/기관장: Reported → Confirmed */
    function canConfirmDepartment(user, dept) {
        if (typeof TVC_Space !== 'undefined' && user?.station) {
            return TVC_Space.canApproveReport(user, dept);
        }
        if (!isApprover(user)) return false;
        return user.department === dept;
    }

    /** HQ 공무감독: Confirmed → Approved */
    function canApproveHqReport(user) {
        return isHqAccount(user) && can(user, Action.CONFIRM_REPORT);
    }

    /** @deprecated use canConfirmDepartment — ship-side confirm */
    function canApproveDepartment(user, dept) {
        return canConfirmDepartment(user, dept);
    }

    function getRoleLabel(role) {
        return ROLE_LABELS[role] || role;
    }

    /** 보고서/승인 기록용 간결 직책 라벨: Officer / Engineer / C/E / Captain / Superintendent */
    function getRankLabel(user) {
        if (!user) return '';
        switch (user.role) {
            case 'SHIP_CAPTAIN': return 'Captain';
            case 'SHIP_CHIEF': return 'C/E';
            case 'HQ_SUPERVISOR': return 'Superintendent';
            case 'SHIP_OFFICER': return user.department === 'ENGINE' ? 'Engineer' : 'Officer';
            default: return user.department === 'ENGINE' ? 'Engineer' : 'Officer';
        }
    }

    function getDeptLabel(dept) {
        return dept ? (DEPT_LABELS[dept] || dept) : 'All';
    }

    /** 데모 계정 username → role (IndexedDB role 누락/불일치 시 fallback) */
    const DEMO_ROLE_BY_USERNAME = {
        ce: Role.SHIP_CHIEF,
        captain: Role.SHIP_CAPTAIN,
        officer: Role.SHIP_OFFICER,
        engineer: Role.SHIP_OFFICER,
        hq: Role.HQ_SUPERVISOR,
    };

    function resolveUserRole(user) {
        if (!user) return null;
        if (user.role) return user.role;
        return DEMO_ROLE_BY_USERNAME[String(user.username || '').toLowerCase()] || null;
    }

    /** Original Plan Modify / Append / Delete — 선박: Captain·Chief Engineer만, HQ: 본사 감독 */
    function canModifyOriginalPlan(user) {
        if (!user) return false;
        const role = resolveUserRole(user);
        const u = role && role !== user.role ? { ...user, role } : user;
        if (isHqAccount(u)) return can(u, Action.MODIFY_MAINTENANCE_ITEM);
        return isApprover(u) && can(u, Action.MODIFY_MAINTENANCE_ITEM);
    }

    /** SPARE Modify / Append / Delete — 선박: Captain·Chief Engineer, HQ: 본사 감독 */
    function canModifySpareInventory(user) {
        if (!user) return false;
        const role = resolveUserRole(user);
        const u = role && role !== user.role ? { ...user, role } : user;
        if (can(u, Action.MODIFY_INVENTORY)) return true;
        if (isApprover(u)) return true;
        const name = String(user.username || '').toLowerCase();
        return name === 'ce' || name === 'captain';
    }

    function assertModifyOriginalPlan(user) {
        if (!canModifyOriginalPlan(user)) {
            throw Object.assign(new Error('PERMISSION_DENIED'), {
                code: 'PERMISSION_DENIED',
                action: Action.MODIFY_MAINTENANCE_ITEM,
                role: user?.role,
            });
        }
    }

    /** Username 기반 계정 명칭 (Header 표시용) */
    function getAccountTitle(username) {
        return ACCOUNT_TITLES[username] || (username || 'User');
    }

    return {
        AccountType, Role, Department, ReportStatus, Action,
        can, assert, getUiFeatures, canTransitionReport, assertReportTransition, getRoleLabel, getRankLabel, getDeptLabel, getAccountTitle,
        isShipAccount, isHqAccount, isApprover,
        canModifyOriginalPlan, assertModifyOriginalPlan,
        canModifySpareInventory, resolveUserRole,
        normalizeReportStatus, isReportedStatus, isConfirmedStatus, isApprovedStatus,
        getAccessibleDepartments, canAccessDepartment, canConfirmDepartment, canApproveDepartment, canApproveHqReport,
    };
})();
if (typeof window !== 'undefined') window.TVC_RBAC = TVC_RBAC;
