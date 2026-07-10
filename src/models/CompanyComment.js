const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class CompanyComment {
    static create({ jobCode, reportId, comment, authorId }) {
        const id = uuidv4();
        getDb().prepare(`
            INSERT INTO Company_Comments (id, job_code, report_id, comment, author_id)
            VALUES (?, ?, ?, ?, ?)
        `).run(id, jobCode, reportId || null, comment, authorId);
        return getDb().prepare('SELECT * FROM Company_Comments WHERE id = ?').get(id);
    }

    static listByJobCode(jobCode) {
        return getDb().prepare(`
            SELECT cc.*, u.display_name AS author_name
            FROM Company_Comments cc
            JOIN Users u ON u.id = cc.author_id
            WHERE cc.job_code = ?
            ORDER BY cc.created_at DESC
        `).all(jobCode);
    }
}

module.exports = { CompanyComment };
