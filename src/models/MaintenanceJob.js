const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class MaintenanceJob {
    static findById(id) {
        return getDb().prepare('SELECT * FROM Maintenance_Jobs WHERE id = ? AND is_deleted = 0').get(id);
    }

    static findByJobCode(jobCode) {
        return getDb().prepare('SELECT * FROM Maintenance_Jobs WHERE job_code = ? AND is_deleted = 0').get(jobCode);
    }

    static listSchedule() {
        return getDb().prepare('SELECT * FROM v_pms_schedule ORDER BY machinery_name, job_code').all();
    }

    static create(data) {
        const id = uuidv4();
        getDb().prepare(`
            INSERT INTO Maintenance_Jobs
                (id, ship_component_id, job_code, description, period, unit, pic,
                 last_done_hours, next_due_hours, plan_status, spare_part_id, spare_use_qty)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.shipComponentId, data.jobCode, data.description,
            data.period, data.unit, data.pic,
            data.lastDoneHours ?? null, data.nextDueHours ?? null,
            data.planStatus || 'PLANNED', data.sparePartId ?? null, data.spareUseQty || 0
        );
        return MaintenanceJob.findById(id);
    }

    static lock(id) {
        getDb().prepare(`
            UPDATE Maintenance_Jobs SET is_locked = 1, updated_at = datetime('now') WHERE id = ?
        `).run(id);
    }

    static updateAfterMaintenance(id, currentHours, intervalHours) {
        getDb().prepare(`
            UPDATE Maintenance_Jobs
            SET last_done_hours = ?, next_due_hours = ?, plan_status = 'COMPLETED',
                updated_at = datetime('now'),
                sync_status = CASE WHEN sync_status = 'SYNCED' THEN 'PENDING_SYNC' ELSE sync_status END,
                sync_version = sync_version + 1
            WHERE id = ? AND is_locked = 0
        `).run(currentHours, currentHours + intervalHours, id);
    }
}

module.exports = { MaintenanceJob };
