const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class SparePart {
    static findById(id) {
        return getDb().prepare('SELECT * FROM Spare_Parts WHERE id = ? AND is_deleted = 0').get(id);
    }

    static listAll() {
        return getDb().prepare('SELECT * FROM Spare_Parts WHERE is_deleted = 0 ORDER BY part_no').all();
    }

    static deduct(id, qty) {
        const part = SparePart.findById(id);
        if (!part) throw new Error('SPARE_PART_NOT_FOUND');
        const newQty = part.qty_on_hand - qty;
        getDb().prepare(`
            UPDATE Spare_Parts
            SET qty_on_hand = ?, updated_at = datetime('now'),
                sync_status = CASE WHEN sync_status = 'SYNCED' THEN 'PENDING_SYNC' ELSE sync_status END,
                sync_version = sync_version + 1
            WHERE id = ?
        `).run(newQty, id);
        return SparePart.findById(id);
    }

    static addStock(id, qty) {
        getDb().prepare(`
            UPDATE Spare_Parts
            SET qty_on_hand = qty_on_hand + ?, updated_at = datetime('now'),
                sync_status = CASE WHEN sync_status = 'SYNCED' THEN 'PENDING_SYNC' ELSE sync_status END,
                sync_version = sync_version + 1
            WHERE id = ?
        `).run(qty, id);
        return SparePart.findById(id);
    }
}

module.exports = { SparePart };
