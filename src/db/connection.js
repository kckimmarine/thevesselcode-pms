const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.TVC_DB_PATH
    || path.join(__dirname, '..', '..', 'database', 'tvc_pms.db');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'database', 'schema.sql');

let db = null;

function getDb() {
    if (!db) {
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        db = new DatabaseSync(DB_PATH);
        db.exec('PRAGMA foreign_keys = ON');
        db.exec('PRAGMA journal_mode = WAL');
    }
    return db;
}

function initSchema() {
    const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    getDb().exec(sql);
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

function withTransaction(fn) {
    const database = getDb();
    database.exec('BEGIN IMMEDIATE');
    try {
        const result = fn();
        database.exec('COMMIT');
        return result;
    } catch (err) {
        database.exec('ROLLBACK');
        throw err;
    }
}

function touchSync(table, id) {
    const database = getDb();
    database.prepare(`
        UPDATE ${table}
        SET updated_at = datetime('now'),
            sync_status = CASE WHEN sync_status = 'SYNCED' THEN 'PENDING_SYNC' ELSE sync_status END,
            sync_version = sync_version + 1
        WHERE id = ?
    `).run(id);
}

module.exports = { getDb, initSchema, closeDb, withTransaction, touchSync, DB_PATH };
