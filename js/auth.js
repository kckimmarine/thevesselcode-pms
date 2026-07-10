/* THE VESSEL CODE — Auth (IndexedDB users + session) */
const TVC_Auth = (function () {
    const SESSION_KEY = 'tvc_session_v2';
    const DEMO_PASSWORD = '0000';
    const USERS_SEED_VERSION = 6;

    const DEFAULT_USERS = [
        // Deck part
        { id: 'user-officer', username: 'officer', display_name: 'Kim 2/O (Deck Officer)', account_type: 'SHIP', role: 'SHIP_OFFICER', department: 'DECK', vessel_id: 'TEST_V01' },
        { id: 'user-captain', username: 'captain', display_name: 'Choi Captain (선장)', account_type: 'SHIP', role: 'SHIP_CAPTAIN', department: 'DECK', vessel_id: 'TEST_V01' },
        // Engine part
        { id: 'user-engineer', username: 'engineer', display_name: 'Kim 3/E (Engineer)', account_type: 'SHIP', role: 'SHIP_OFFICER', department: 'ENGINE', vessel_id: 'TEST_V01' },
        { id: 'user-chief', username: 'ce', display_name: 'Chief engineer', account_type: 'SHIP', role: 'SHIP_CHIEF', department: 'ENGINE', vessel_id: 'TEST_V01' },
        // Head office
        { id: 'user-hq', username: 'hq', display_name: 'Lee Superintendent (본사)', account_type: 'HQ', role: 'HQ_SUPERVISOR', department: null, vessel_id: null },
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
            throw new Error('file:// 모드에서는 로그인할 수 없습니다. START-TVC-PMS.bat 또는 npm start → http://localhost:3000 으로 접속하세요.');
        } else {
            throw new Error('이 브라우저에서 비밀번호 검증을 사용할 수 없습니다. Chrome/Edge 최신 버전을 사용하세요.');
        }
        _hashCache.set(password, hash);
        return hash;
    }

    async function initUsers() {
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
        const updated = {
            ...session,
            role,
            account_type: user.account_type,
            department: user.account_type === 'HQ' ? null : user.department,
            display_name: user.display_name,
            vessel_id: user.vessel_id,
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

    async function login(username, password, department) {
        await initUsers();
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

        const selected = department || '';

        const sessionRole = user.role || (window.TVC_RBAC?.resolveUserRole?.(user));

        // HQ: 부서 선택 불필요 — 선택 여부와 관계없이 접속 허용
        if (user.account_type === 'HQ') {
            const session = {
                id: user.id, username: user.username, display_name: user.display_name,
                account_type: user.account_type, role: sessionRole,
                department: null, vessel_id: user.vessel_id,
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
            return { ok: true, user: session };
        }

        if (!selected) return { ok: false, error: 'Department(Deck/Engine)를 선택하세요.' };

        // 선박 계정: 선택 부서가 계정 부서와 일치해야 접속 가능
        if (user.department !== selected) {
            return { ok: false, error: `이 계정은 ${user.department} 부서 전용입니다. (${selected} 선택됨)` };
        }

        const session = {
            id: user.id, username: user.username, display_name: user.display_name,
            account_type: user.account_type, role: sessionRole,
            department: user.department, vessel_id: user.vessel_id,
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return { ok: true, user: session };
    }

    function logout() {
        sessionStorage.removeItem(SESSION_KEY);
    }

    function requirePermission(action) {
        const user = getCurrentUser();
        if (!user) { alert('로그인이 필요합니다.'); return null; }
        if (!TVC_RBAC.can(user, action)) {
            alert(`권한 없음: ${TVC_RBAC.getRoleLabel(user.role)}`);
            return null;
        }
        return user;
    }

    return { initUsers, login, logout, getCurrentUser, refreshSessionFromDb, requirePermission, DEMO_PASSWORD, DEFAULT_USERS };
})();
