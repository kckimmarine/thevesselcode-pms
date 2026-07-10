const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

const SALT_LEN = 16;
const KEY_LEN = 64;

function hashPassword(plain) {
    const salt = crypto.randomBytes(SALT_LEN).toString('hex');
    const hash = crypto.scryptSync(plain, salt, KEY_LEN).toString('hex');
    return `$scrypt$${salt}$${hash}`;
}

function verifyPassword(plain, stored) {
    const parts = stored.split('$');
    if (parts.length !== 4 || parts[1] !== 'scrypt') return false;
    const salt = parts[2];
    const expected = parts[3];
    if (expected.length !== KEY_LEN * 2) return false;
    const actual = crypto.scryptSync(plain, salt, KEY_LEN).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

class User {
    static findByUsername(username) {
        return getDb().prepare('SELECT * FROM Users WHERE username = ? AND is_active = 1').get(username);
    }

    static findById(id) {
        return getDb().prepare('SELECT * FROM Users WHERE id = ? AND is_active = 1').get(id);
    }

    static create({ username, password, displayName, accountType, role, vesselId }) {
        const id = uuidv4();
        getDb().prepare(`
            INSERT INTO Users (id, username, password_hash, display_name, account_type, role, vessel_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, username, hashPassword(password), displayName, accountType, role, vesselId || null);
        return User.findById(id);
    }

    static authenticate(username, password) {
        const user = User.findByUsername(username);
        if (!user || !verifyPassword(password, user.password_hash)) return null;
        const { password_hash, ...safe } = user;
        return safe;
    }

    static listByAccountType(accountType) {
        return getDb().prepare(
            'SELECT id, username, display_name, account_type, role, vessel_id FROM Users WHERE account_type = ? AND is_active = 1'
        ).all(accountType);
    }
}

module.exports = { User, hashPassword, verifyPassword };
