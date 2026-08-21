/* THE VESSEL CODE — Auth (IndexedDB users + session) */
const TVC_Auth = (function () {
    const SESSION_KEY = 'tvc_session_v2';
    const DEMO_PASSWORD = '0000';
    const USERS_SEED_VERSION = 9;

    const DEFAULT_USERS = [
        // Deck part
        { id: 'user-officer', username: 'officer', display_name: 'Kim 2/O (Deck Officer)', account_type: 'SHIP', role: 'SHIP_OFFICER', department: 'DECK', vessel_id: 'INCHEON CHEMI' },
        { id: 'user-co', username: 'co', display_name: 'Park C/O (Chief Officer)', account_type: 'SHIP', role: 'SHIP_CAPTAIN', department: 'DECK', vessel_id: 'INCHEON CHEMI' },
        { id: 'user-captain', username: 'captain', display_name: 'Choi Captain (선장)', account_type: 'SHIP', role: 'SHIP_CAPTAIN', department: 'DECK', vessel_id: 'INCHEON CHEMI' },
        // Engine part
        { id: 'user-engineer', username: 'engineer', display_name: 'Kim 3/E (Engineer)', account_type: 'SHIP', role: 'SHIP_OFFICER', department: 'ENGINE', vessel_id: 'INCHEON CHEMI' },
        { id: 'user-chief', username: 'ce', display_name: 'Chief engineer', account_type: 'SHIP', role: 'SHIP_CHIEF', department: 'ENGINE', vessel_id: 'INCHEON CHEMI' },
        // Head office
        { id: 'user-hq', username: 'hq', display_name: 'Lee Superintendent (본사)', account_type: 'HQ', role: 'HQ_SUPERVISOR', department: null, vessel_id: null, company_id: 'DAEMYUNG' },
        // THE VESSEL CODE — Admin Mode (app updates only)
        { id: 'user-tvc', username: 'tvc', display_name: 'TVC Admin', account_type: 'ADMIN', role: 'TVC_ADMIN', department: null, vessel_id: null },
    ];

    const PBKDF2_SALT = 'tvc-pms-salt-v2';
    const PBKDF2_ITER = 100000;
    const _hashCache = new Map();

    function canUseWebCrypto() {
        return !!(typeof crypto !== 'undefined' && crypto.subtle && (typeof isSecureContext === 'undefined' || isSecureContext));
    }

    async function hashPasswordSubtle(password) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: enc.encode(PBKDF2_SALT), iterations: PBKDF2_ITER, hash: 'SHA-256' },
            keyMaterial, 256
        );
        return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function hashPassword(password) {
        if (_hashCache.has(password)) return _hashCache.get(password);
        let hash;
        if (canUseWebCrypto()) hash = await hashPasswordSubtle(password);
        else if (typeof TVC_Pbkdf2 !== 'undefined') {
            hash = TVC_Pbkdf2.pbkdf2Hex(password, PBKDF2_SALT, PBKDF2_ITER, 32);
        } else if (typeof location !== 'undefined' && location.protocol === 'file:') {
            throw new Error('file:// 모드에서는 로그인할 수 없습니다. Electron 설치본, START-TVC-PMS.bat, 또는 npm start → http://localhost:3000 으로 실행하세요.');
        } else {
            throw new Error('이 브라우저에서 비밀번호 검증을 사용할 수 없습니다. Chrome/Edge 최신 버전을 사용하세요.');
        }
        _hashCache.set(password, hash);
        return hash;
    }

    async function initUsers() {
        const seedVer = await TVC_DB.getMeta('users_seed_version').catch(() => null);
        if (seedVer === USERS_SEED_VERSION) {
            const existing = await TVC_DB.getAll('users');
            const allPresent = DEFAULT_USERS.every(tpl =>
                existing.some(u => u.id === tpl.id && u.is_active && u.username === tpl.username && u.role === tpl.role)
            );
            if (allPresent) return { skipped: true };
        }

        const existing = await TVC_DB.getAll('users');
        const hash = await hashPassword(DEMO_PASSWORD);
        // 데모 계정은 항상 최신 role/username 으로 동기화 (IndexedDB 캐시 불일치 방지)
        for (const u of DEFAULT_USERS) {
            const prev = existing.find(x => x.id === u.id)
                || existing.find(x => x.username === u.username);
            await TVC_DB.put('users', {
                ...(prev || {}),
                ...u,
                password_hash: hash,
                is_active: true,
            });
        }
        // 동일 username 중복 레코드 제거 (예: chief@dm01 → ce 마이그레이션 잔여)
        const fresh = await TVC_DB.getAll('users');
        for (const row of fresh) {
            const tpl = DEFAULT_USERS.find(d => d.username === row.username);
            if (tpl && row.id !== tpl.id) await TVC_DB.del('users', row.id);
        }
        for (const row of fresh) {
            if (row.username?.includes('@') && !DEFAULT_USERS.some(d => d.username === row.username)) {
                await TVC_DB.put('users', { ...row, is_active: false });
            }
        }
        try { await TVC_DB.setMeta('users_seed_version', USERS_SEED_VERSION); } catch (_) {}
    }

    async function refreshSessionFromDb() {
        const session = getCurrentUser();
        if (!session) return null;
        const users = await TVC_DB.getAll('users');
        const user = users.find(u => u.id === session.id)
            || users.find(u => u.username === session.username);
        if (!user) return session;
        const role = user.role || TVC_RBAC.resolveUserRole(user);
        let station = null;
        if (session.login_mode && typeof TVC_Space !== 'undefined') {
            station = TVC_Space.stationFromLoginMode(session.login_mode);
        } else {
            station = session.station || null;
        }
        const updated = {
            ...session,
            role,
            account_type: user.account_type,
            department: (user.account_type === 'HQ' || user.account_type === 'ADMIN') ? null : user.department,
            display_name: user.display_name,
            vessel_id: user.vessel_id,
            company_id: user.company_id || null,
            station,
            login_mode: session.login_mode || null,
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
        return updated;
    }

    function getCurrentUser() {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    async function login(username, password, loginMode) {
        const users = await TVC_DB.getAll('users');
        const uname = username.trim();
        const template = DEFAULT_USERS.find(u => u.username === uname);
        const user = template
            ? (users.find(u => u.id === template.id && u.is_active)
                || users.find(u => u.username === template.username && u.is_active))
            : users.find(u => u.username === uname && u.is_active);
        if (!user) return { ok: false, error: '존재하지 않는 계정입니다.' };
        const hash = await hashPassword(password);
        if (hash !== user.password_hash) return { ok: false, error: '비밀번호가 올바르지 않습니다.' };

        const sessionRole = user.role || (window.TVC_RBAC?.resolveUserRole?.(user));

        if (typeof TVC_License !== 'undefined') {
            await TVC_License.refresh();
            const licCheck = TVC_License.assertLoginMode(loginMode, user.account_type);
            if (!licCheck.ok) return licCheck;
        }

        if (user.account_type === 'HQ' || user.account_type === 'ADMIN') {
            if (loginMode) {
                return {
                    ok: false,
                    error: user.account_type === 'ADMIN'
                        ? 'TVC Admin(tvc) 계정은 Department 선택 없이 로그인하세요.'
                        : 'Superintendent(hq) 계정은 Department 선택 없이 로그인하세요.',
                };
            }
            const session = {
                id: user.id, username: user.username, display_name: user.display_name,
                account_type: user.account_type, role: sessionRole,
                department: null, vessel_id: user.vessel_id, company_id: user.company_id || null,
                station: null, login_mode: null,
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
            return { ok: true, user: session };
        }

        let station = null;
        if (typeof TVC_Space !== 'undefined') {
            const spaceCheck = TVC_Space.validateLogin(user, loginMode);
            if (!spaceCheck.ok) return spaceCheck;
            station = spaceCheck.station;
        } else if (!loginMode) {
            return { ok: false, error: 'Department(Master / Deck / Engine)를 선택하세요.' };
        }

        const session = {
            id: user.id, username: user.username, display_name: user.display_name,
            account_type: user.account_type, role: sessionRole,
            department: user.department, vessel_id: user.vessel_id,
            station: station || null, login_mode: loginMode || null,
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return { ok: true, user: session };
    }

    function logout() {
        sessionStorage.removeItem(SESSION_KEY);
    }

    async function changePassword(userId, currentPassword, newPassword) {
        const users = await TVC_DB.getAll('users');
        const user = users.find(u => u.id === userId && u.is_active);
        if (!user) return { ok: false, error: 'Account not found.' };

        const current = String(currentPassword || '');
        const next = String(newPassword || '');
        if (!current || !next) return { ok: false, error: 'Enter current and new password.' };
        if (next.length < 4) return { ok: false, error: 'New password must be at least 4 characters.' };

        const currentHash = await hashPassword(current);
        if (currentHash !== user.password_hash) {
            return { ok: false, error: 'Current password is incorrect.' };
        }

        const nextHash = await hashPassword(next);
        await TVC_DB.put('users', { ...user, password_hash: nextHash });
        _hashCache.delete(current);
        _hashCache.delete(next);
        return { ok: true };
    }

    async function requirePermission(action) {
        const user = getCurrentUser();
        if (!user) { await TVC_Dialog.alert('Sign in required.'); return null; }
        if (!TVC_RBAC.can(user, action)) {
            await TVC_Dialog.alert(`Permission denied: ${TVC_RBAC.getRoleLabel(user.role)}`);
            return null;
        }
        if (typeof TVC_Space !== 'undefined') {
            const station = TVC_Space.getStation(user);
            if (station) {
                try { TVC_Space.assertAction(user, action); }
                catch (e) { await TVC_Dialog.alert(e.message || 'Station access denied'); return null; }
            }
        }
        return user;
    }

    return { initUsers, login, logout, getCurrentUser, refreshSessionFromDb, requirePermission, changePassword, DEMO_PASSWORD, DEFAULT_USERS };
})();
