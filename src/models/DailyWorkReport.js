const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class DailyWorkReport {
    static findById(id) {
        return getDb().prepare('SELECT * FROM Daily_Work_Reports WHERE id = ? AND is_deleted = 0').get(id);
    }

    static findParts(reportId) {
        return getDb().prepare(`
            SELECT dwrp.*, sp.part_no, sp.name, sp.qty_on_hand
            FROM Daily_Work_Report_Parts dwrp
            JOIN Spare_Parts sp ON sp.id = dwrp.spare_part_id
            WHERE dwrp.report_id = ?
        `).all(reportId);
    }

    static listByStatus(status) {
        return getDb().prepare(`
            SELECT * FROM v_daily_work_pending WHERE status = ? ORDER BY report_date DESC
        `).all(status);
    }

    static create({ maintenanceJobId, jobCode, workType, reportDate, description, reportedBy, usedParts = [], troubleDetail, postponeReason }) {
        const id = uuidv4();
        const db = getDb();

        db.prepare(`
            INSERT INTO Daily_Work_Reports
                (id, maintenance_job_id, job_code, work_type, status, report_date, description,
                 trouble_detail, postpone_reason, reported_by)
            VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)
        `).run(
            id, maintenanceJobId || null, jobCode, workType, reportDate,
            description, troubleDetail || null, postponeReason || null, reportedBy
        );

        const insertPart = db.prepare(`
            INSERT INTO Daily_Work_Report_Parts (id, report_id, spare_part_id, qty_used)
            VALUES (?, ?, ?, ?)
        `);
        for (const p of usedParts) {
            insertPart.run(uuidv4(), id, p.sparePartId, p.qtyUsed);
        }

        return DailyWorkReport.findById(id);
    }

    static updateStatus(id, status, actorId, extra = {}) {
        const fields = ['status = ?', 'updated_at = datetime(\'now\')',
            'sync_status = CASE WHEN sync_status = \'SYNCED\' THEN \'PENDING_SYNC\' ELSE sync_status END',
            'sync_version = sync_version + 1'];
        const params = [status];

        if (status === 'APPROVED') {
            fields.push('approved_by = ?', 'approved_at = datetime(\'now\')');
            params.push(actorId);
        }
        if (status === 'CONFIRMED') {
            fields.push('confirmed_by = ?', 'confirmed_at = datetime(\'now\')', 'is_locked = 1');
            params.push(actorId);
            if (extra.companyComment) {
                fields.push('company_comment = ?');
                params.push(extra.companyComment);
            }
        }
        if (status === 'POSTPONED' && extra.postponeReason) {
            fields.push('postpone_reason = ?');
            params.push(extra.postponeReason);
        }

        params.push(id);
        getDb().prepare(`UPDATE Daily_Work_Reports SET ${fields.join(', ')} WHERE id = ?`).run(...params);
        return DailyWorkReport.findById(id);
    }

    static markPartsDeducted(reportId) {
        getDb().prepare('UPDATE Daily_Work_Report_Parts SET deducted = 1 WHERE report_id = ?').run(reportId);
    }

    static listPendingSync() {
        return getDb().prepare(`
            SELECT * FROM Daily_Work_Reports
            WHERE sync_status IN ('LOCAL', 'PENDING_SYNC') AND is_deleted = 0
            ORDER BY report_date
        `).all();
    }
}

module.exports = { DailyWorkReport };
