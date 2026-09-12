const { getDb } = require('../db/connection');

/** 선박용(SHIP) / 회사용(SM) 계정 타입 — legacy HQ read as SM */
const AccountType = {
    SHIP: 'SHIP',
    SM: 'SM',
    HQ: 'SM',
};

/** 역할 — TVC_DESIGN_SPEC RBAC */
const Role = {
    SHIP_OFFICER: 'SHIP_OFFICER',       // 사관
    SHIP_CHIEF: 'SHIP_CHIEF',           // 선기장
    SM_SUPERVISOR: 'SM_SUPERVISOR',
    HQ_SUPERVISOR: 'SM_SUPERVISOR',     // legacy alias
};

/** Daily_Work_Reports 결재 상태 */
const ReportStatus = {
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    CONFIRMED: 'CONFIRMED',
    POSTPONED: 'POSTPONED',
};

/** 권한 액션 키 */
const Action = {
    // 일일 실무 (본선)
    CREATE_DAILY_REPORT: 'CREATE_DAILY_REPORT',
    EDIT_OWN_PENDING_REPORT: 'EDIT_OWN_PENDING_REPORT',
    APPROVE_DAILY_REPORT: 'APPROVE_DAILY_REPORT',
    POSTPONE_DAILY_REPORT: 'POSTPONE_DAILY_REPORT',

    // 재고 (SPICS)
    VIEW_INVENTORY: 'VIEW_INVENTORY',
    DEDUCT_INVENTORY: 'DEDUCT_INVENTORY',
    MODIFY_INVENTORY: 'MODIFY_INVENTORY',
    CREATE_REQUISITION: 'CREATE_REQUISITION',
    SUPPLY_PARTS: 'SUPPLY_PARTS',

    // 가동시간
    UPDATE_RUN_HOURS: 'UPDATE_RUN_HOURS',

    // 동기화
    EXPORT_SHIP_SYNC: 'EXPORT_SHIP_SYNC',
    IMPORT_SHIP_SYNC: 'IMPORT_SHIP_SYNC',
    IMPORT_SM_SYNC: 'IMPORT_SM_SYNC',
    EXPORT_SM_FEEDBACK: 'EXPORT_SM_FEEDBACK',
    IMPORT_HQ_SYNC: 'IMPORT_SM_SYNC',
    EXPORT_HQ_FEEDBACK: 'EXPORT_SM_FEEDBACK',

    // 본사 전용
    REVIEW_MASTER_PLAN: 'REVIEW_MASTER_PLAN',
    APPROVE_ORIGINAL_PLAN: 'APPROVE_ORIGINAL_PLAN',
    ADD_COMPANY_COMMENT: 'ADD_COMPANY_COMMENT',
    CONFIRM_REPORT: 'CONFIRM_REPORT',

    // 조회
    VIEW_PMS_SCHEDULE: 'VIEW_PMS_SCHEDULE',
    VIEW_AUDIT_LOG: 'VIEW_AUDIT_LOG',
};

/** 역할별 허용 액션 매트릭스 */
const ROLE_PERMISSIONS = {
    [Role.SHIP_OFFICER]: new Set([
        Action.CREATE_DAILY_REPORT,
        Action.EDIT_OWN_PENDING_REPORT,
        Action.VIEW_INVENTORY,
        Action.VIEW_PMS_SCHEDULE,
        Action.UPDATE_RUN_HOURS,
        Action.CREATE_REQUISITION,
        Action.DEDUCT_INVENTORY,
        Action.SUPPLY_PARTS,
    ]),
    [Role.SHIP_CHIEF]: new Set([
        Action.CREATE_DAILY_REPORT,
        Action.APPROVE_DAILY_REPORT,
        Action.POSTPONE_DAILY_REPORT,
        Action.VIEW_INVENTORY,
        Action.DEDUCT_INVENTORY,
        Action.MODIFY_INVENTORY,
        Action.VIEW_PMS_SCHEDULE,
        Action.UPDATE_RUN_HOURS,
        Action.EXPORT_SHIP_SYNC,
        Action.IMPORT_SHIP_SYNC,
        Action.CREATE_REQUISITION,
        Action.SUPPLY_PARTS,
        Action.VIEW_AUDIT_LOG,
    ]),
    [Role.SM_SUPERVISOR]: new Set([
        Action.VIEW_INVENTORY,
        Action.VIEW_PMS_SCHEDULE,
        Action.IMPORT_SM_SYNC,
        Action.EXPORT_SM_FEEDBACK,
        Action.REVIEW_MASTER_PLAN,
        Action.APPROVE_ORIGINAL_PLAN,
        Action.ADD_COMPANY_COMMENT,
        Action.CONFIRM_REPORT,
        Action.VIEW_AUDIT_LOG,
        Action.DEDUCT_INVENTORY,
        Action.MODIFY_INVENTORY,
        Action.CREATE_REQUISITION,
        Action.SUPPLY_PARTS,
    ]),
};

/** 계정 타입별 UI/기능 노출 (선박 vs 회사) */
const ACCOUNT_UI_FEATURES = {
    [AccountType.SHIP]: {
        showMachineryPanel: true,
        showDailyReportForm: true,
        showApprovalQueue: true,
        showInventoryModify: false,       // 사관은 재고 수동 수정 불가 (선기장만)
        showSmConfirmPanel: false,
        showExportToSm: false,
        showImportFromSm: false,
    },
    [AccountType.SM]: {
        showMachineryPanel: false,
        showDailyReportForm: false,
        showApprovalQueue: false,
        showInventoryModify: false,
        showSmConfirmPanel: true,
        showExportToSm: false,
        showImportFromSm: false,
        showExportFeedback: true,
        showImportShipData: true,
    },
};

class RBAC {
    static can(user, action) {
        if (!user || !user.role) return false;
        const perms = ROLE_PERMISSIONS[user.role];
        return perms ? perms.has(action) : false;
    }

    static assert(user, action) {
        if (!RBAC.can(user, action)) {
            const err = new Error(`PERMISSION_DENIED: ${user?.role} cannot ${action}`);
            err.code = 'PERMISSION_DENIED';
            throw err;
        }
    }

    static isShipAccount(user) {
        return user?.account_type === AccountType.SHIP;
    }

    static normalizeAccountType(accountType) {
        const t = String(accountType || '').trim().toUpperCase();
        return t === 'HQ' ? 'SM' : t;
    }

    static isSmAccount(user) {
        const t = RBAC.normalizeAccountType(user?.account_type);
        return t === 'SM';
    }

    /** @deprecated use isSmAccount */
    static isHqAccount(user) { return RBAC.isSmAccount(user); }

    static getUiFeatures(user) {
        const type = RBAC.normalizeAccountType(user?.account_type);
        const base = ACCOUNT_UI_FEATURES[type] || {};
        const features = { ...base };

        if (user.role === Role.SHIP_CHIEF) {
            features.showInventoryModify = true;
            features.showApprovalQueue = true;
            features.showExportToSm = true;
            features.showImportFromSm = true;
        }
        if (user.role === Role.SHIP_OFFICER) {
            features.showApprovalQueue = false;
        }
        return features;
    }

    /** 상태 전이 가능 여부 (결재 워크플로우) */
    static canTransitionReport(user, fromStatus, toStatus) {
        const transitions = {
            [Role.SHIP_OFFICER]: {
                [ReportStatus.PENDING]: [],  // 사관은 승인 불가
            },
            [Role.SHIP_CHIEF]: {
                [ReportStatus.PENDING]: [ReportStatus.APPROVED, ReportStatus.POSTPONED],
            },
            [Role.SM_SUPERVISOR]: {
                [ReportStatus.APPROVED]: [ReportStatus.CONFIRMED, ReportStatus.POSTPONED],
            },
        };
        const allowed = transitions[user.role]?.[fromStatus] || [];
        return allowed.includes(toStatus);
    }

    static assertReportTransition(user, fromStatus, toStatus) {
        if (!RBAC.canTransitionReport(user, fromStatus, toStatus)) {
            const err = new Error(`INVALID_TRANSITION: ${fromStatus} → ${toStatus} for ${user.role}`);
            err.code = 'INVALID_TRANSITION';
            throw err;
        }
    }
}

module.exports = {
    RBAC,
    AccountType,
    Role,
    ReportStatus,
    Action,
    ROLE_PERMISSIONS,
    ACCOUNT_UI_FEATURES,
};
