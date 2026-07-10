const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class ShipComponent {
    static findById(id) {
        return getDb().prepare('SELECT * FROM Ship_Components WHERE id = ? AND is_deleted = 0').get(id);
    }

    static findRoots() {
        return getDb().prepare(`
            SELECT * FROM Ship_Components WHERE parent_id IS NULL AND is_deleted = 0 ORDER BY sort_order
        `).all();
    }

    static findChildren(parentId) {
        return getDb().prepare(`
            SELECT * FROM Ship_Components WHERE parent_id = ? AND is_deleted = 0 ORDER BY sort_order
        `).all(parentId);
    }

    static getTree() {
        const all = getDb().prepare(`
            SELECT * FROM Ship_Components WHERE is_deleted = 0 ORDER BY sort_order
        `).all();
        const map = new Map(all.map(n => [n.id, { ...n, children: [] }]));
        const roots = [];
        for (const node of map.values()) {
            if (node.parent_id && map.has(node.parent_id)) {
                map.get(node.parent_id).children.push(node);
            } else if (!node.parent_id) {
                roots.push(node);
            }
        }
        return roots;
    }

    static create(data) {
        const id = uuidv4();
        getDb().prepare(`
            INSERT INTO Ship_Components
                (id, parent_id, machinery_name, component_name, component_code, node_type, total_running_hours, sort_order, remarks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, data.parentId || null, data.machineryName, data.componentName,
            data.componentCode || null, data.nodeType || 'COMPONENT',
            data.totalRunningHours || 0, data.sortOrder || 0, data.remarks || null
        );
        return ShipComponent.findById(id);
    }

    static updateRunningHours(id, newHours, previousHours) {
        if (newHours < previousHours) {
            throw new Error('RUNNING_HOURS_DECREASE_FORBIDDEN');
        }
        getDb().prepare(`
            UPDATE Ship_Components
            SET total_running_hours = ?, updated_at = datetime('now'),
                sync_status = CASE WHEN sync_status = 'SYNCED' THEN 'PENDING_SYNC' ELSE sync_status END,
                sync_version = sync_version + 1
            WHERE id = ? AND is_deleted = 0
        `).run(newHours, id);
        return ShipComponent.findById(id);
    }
}

module.exports = { ShipComponent };
