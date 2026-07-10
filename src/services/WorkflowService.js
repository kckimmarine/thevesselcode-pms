const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { withTransaction, getDb } = require('../db/connection');
const { RBAC, Action, ReportStatus, Role } = require('../auth/rbac');
const { DailyWorkReport } = require('../models/DailyWorkReport');
const { SparePart } = require('../models/SparePart');
const { MaintenanceJob } = require('../models/MaintenanceJob');
const { ShipComponent } = require('../models/ShipComponent');
const { CompanyComment } = require('../models/CompanyComment');

/**
 * TVC_DESIGN_SPEC 워크플로우 서비스
 *
 * [본선] 사관 PENDING 입력 → 선기장 APPROVED (+ SPICS 재고 차감)
 * [본사] Import → 검토 → Confirm(CONFIRMED, 락) → Export 피드백
 */
class WorkflowService {
    /** 사관/선기장: 일일 정비·트러블 리포트 작성 */
    static createDailyReport(user, payload) {
        RBAC.assert(user, Action.CREATE_DAILY_REPORT);
        if (!RBAC.isShipAccount(user)) {
            throw Object.assign(new Error('SHIP_ACCOUNT_ONLY'), { code: 'SHIP_ACCOUNT_ONLY' });
        }

        const report = DailyWorkReport.create({
            maintenanceJobId: payload.maintenanceJobId,
            jobCode: payload.jobCode,
            workType: payload.workType,
            reportDate: payload.reportDate || new Date().toISOString().slice(0, 10),
            description: payload.description,
            reportedBy: user.id,
            usedParts: payload.usedParts || [],
            troubleDetail: payload.troubleDetail,
            postponeReason: payload.postponeReason,
        });

        return report;
    }

    /** 선기장: PENDING → APPROVED + 재고 자동 차감 */
    static approveReport(user, reportId) {
        RBAC.assert(user, Action.APPROVE_DAILY_REPORT);

        return withTransaction(() => {
            const report = DailyWorkReport.findById(reportId);
            if (!report) throw Object.assign(new Error('REPORT_NOT_FOUND'), { code: 'NOT_FOUND' });
            if (report.is_locked) throw Object.assign(new Error('REPORT_LOCKED'), { code: 'LOCKED' });

            RBAC.assertReportTransition(user, report.status, ReportStatus.APPROVED);

            const parts = DailyWorkReport.findParts(reportId);
            for (const p of parts) {
                if (!p.deducted) {
                    if (p.qty_on_hand < p.qty_used && !payloadAllowForce(user)) {
                        throw Object.assign(new Error('INSUFFICIENT_STOCK'), { code: 'INSUFFICIENT_STOCK', partNo: p.part_no });
                    }
                    SparePart.deduct(p.spare_part_id, p.qty_used);
                }
            }
            DailyWorkReport.markPartsDeducted(reportId);

            if (report.maintenance_job_id && report.work_type === 'MAINTENANCE') {
                const job = MaintenanceJob.findById(report.maintenance_job_id);
                if (job && !job.is_locked) {
                    const comp = ShipComponent.findById(job.ship_component_id);
                    MaintenanceJob.updateAfterMaintenance(job.id, comp.total_running_hours, job.period);
                }
            }

            return DailyWorkReport.updateStatus(reportId, ReportStatus.APPROVED, user.id);
        });
    }

    /** 선기장: 연기 처리 */
    static postponeReport(user, reportId, reason) {
        RBAC.assert(user, Action.POSTPONE_DAILY_REPORT);
        const report = DailyWorkReport.findById(reportId);
        if (!report) throw Object.assign(new Error('REPORT_NOT_FOUND'), { code: 'NOT_FOUND' });
        RBAC.assertReportTransition(user, report.status, ReportStatus.POSTPONED);
        return DailyWorkReport.updateStatus(reportId, ReportStatus.POSTPONED, user.id, { postponeReason: reason });
    }

    /** 본사: APPROVED → CONFIRMED (락 발생) */
    static confirmReport(user, reportId, companyComment) {
        RBAC.assert(user, Action.CONFIRM_REPORT);
        if (!RBAC.isHqAccount(user)) {
            throw Object.assign(new Error('HQ_ACCOUNT_ONLY'), { code: 'HQ_ACCOUNT_ONLY' });
        }

        return withTransaction(() => {
            const report = DailyWorkReport.findById(reportId);
            if (!report) throw Object.assign(new Error('REPORT_NOT_FOUND'), { code: 'NOT_FOUND' });
            RBAC.assertReportTransition(user, report.status, ReportStatus.CONFIRMED);

            const updated = DailyWorkReport.updateStatus(reportId, ReportStatus.CONFIRMED, user.id, { companyComment });

            if (report.maintenance_job_id) {
                MaintenanceJob.lock(report.maintenance_job_id);
            }

            if (companyComment) {
                CompanyComment.create({
                    jobCode: report.job_code,
                    reportId,
                    comment: companyComment,
                    authorId: user.id,
                });
            }

            return updated;
        });
    }

    /** 본사: 기술 코멘트 추가 */
    static addCompanyComment(user, jobCode, comment, reportId) {
        RBAC.assert(user, Action.ADD_COMPANY_COMMENT);
        return CompanyComment.create({ jobCode, reportId, comment, authorId: user.id });
    }

    /** 월간 본선 → 본사 Export (JSON 구조 — spec 준수) */
    static exportShipToHq(vesselId) {
        const reports = DailyWorkReport.listPendingSync();
        const partsByReport = {};
        for (const r of reports) {
            partsByReport[r.id] = DailyWorkReport.findParts(r.id).map(p => ({
                part_no: p.part_no,
                name: p.name,
                qty_used: p.qty_used,
            }));
        }

        const payload = {
            export_meta: {
                vessel_id: vesselId,
                export_date: new Date().toISOString().slice(0, 10),
                direction: 'SHIP_TO_HQ',
            },
            daily_reports: reports.map(r => ({
                id: r.id,
                job_code: r.job_code,
                work_type: r.work_type,
                status: r.status,
                report_date: r.report_date,
                description: r.description,
                used_parts: partsByReport[r.id] || [],
            })),
            machinery_hours: ShipComponent.findRoots().concat(
                ShipComponent.getTree().flatMap(r => r.children || [])
            ).map(c => ({ machinery: c.machinery_name, component: c.component_name, hours: c.total_running_hours })),
        };

        const db = getDb();
        db.prepare(`
            INSERT INTO Sync_Export_Log (id, vessel_id, direction, export_date, record_count)
            VALUES (?, ?, 'SHIP_TO_HQ', ?, ?)
        `).run(uuidv4(), vesselId, payload.export_meta.export_date, reports.length);

        db.prepare(`
            UPDATE Daily_Work_Reports SET sync_status = 'SYNCED', last_synced_at = datetime('now')
            WHERE sync_status IN ('LOCAL', 'PENDING_SYNC') AND is_deleted = 0
        `).run();

        return payload;
    }

    /** 본사 → 본선 피드백 Export */
    static exportHqFeedback(vesselId) {
        const comments = getDb().prepare(`
            SELECT job_code, comment, created_at FROM Company_Comments
            WHERE sync_status IN ('LOCAL', 'PENDING_SYNC')
        `).all();

        const confirmed = getDb().prepare(`
            SELECT id, job_code, status, company_comment, is_locked FROM Daily_Work_Reports
            WHERE status = 'CONFIRMED' AND sync_status = 'PENDING_SYNC'
        `).all();

        return {
            export_meta: {
                vessel_id: vesselId,
                export_date: new Date().toISOString().slice(0, 10),
                direction: 'HQ_TO_SHIP',
            },
            daily_reports: confirmed,
            company_comments: comments,
        };
    }

    /** 본선: 본사 피드백 Import */
    static importHqFeedback(payload) {
        return withTransaction(() => {
            for (const c of payload.company_comments || []) {
                const report = getDb().prepare(
                    'SELECT id FROM Daily_Work_Reports WHERE job_code = ? ORDER BY created_at DESC LIMIT 1'
                ).get(c.job_code);
                if (report) {
                    getDb().prepare(`
                        UPDATE Daily_Work_Reports
                        SET company_comment = ?, is_locked = 1, status = 'CONFIRMED',
                            sync_status = 'SYNCED', updated_at = datetime('now')
                        WHERE id = ?
                    `).run(c.comment, report.id);
                }
            }
            return { imported: (payload.company_comments || []).length };
        });
    }
}

function payloadAllowForce(user) {
    return user.role === Role.SHIP_CHIEF;
}

module.exports = { WorkflowService };
