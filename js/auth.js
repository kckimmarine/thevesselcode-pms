/* THE VESSEL CODE — Auth (IndexedDB users + session) */
const TVC_Auth = (function () {
    const SESSION_KEY = 'tvc_session_v2';
    const SAVED_ID_KEY = 'tvc_saved_id';
    const AUTH_SESSION_KEY = 'tvc_auth_session';
    const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const DEMO_PASSWORD = '0000';
    const USERS_SEED_VERSION = 21;

    const DEFAULT_USERS = [
        // Contract vessel — TVC Voyager (demo ship accounts)
        { id: 'user-officer', username: 'officer', display_name: 'Officer', account_type: 'SHIP', role: 'SHIP_OFFICER', department: 'DECK', vessel_id: 'TVC Voyager' },
        { id: 'user-co', username: 'co', display_name: 'Chief officer', account_type: 'SHIP', role: 'SHIP_CO', department: 'DECK', vessel_id: 'TVC Voyager' },
        { id: 'user-engineer', username: 'engineer', display_name: 'Engineer', account_type: 'SHIP', role: 'SHIP_ENGINEER', department: 'ENGINE', vessel_id: 'TVC Voyager' },
        { id: 'user-ce', username: 'ce', display_name: 'Chief engineer', account_type: 'SHIP', role: 'SHIP_CE', department: 'ENGINE', vessel_id: 'TVC Voyager' },
        { id: 'user-captain', username: 'captain', display_name: 'Captain', account_type: 'SHIP', role: 'SHIP_CAPTAIN', department: 'CAPTAIN', vessel_id: 'TVC Voyager' },
        // Contract company SM — superintendent (company-scoped fleet)
        { id: 'user-tvc-shipping', username: 'tvc shipping', display_name: 'TVC Shipping', account_type: 'SM', role: 'SM_SUPERINTENDENT', department: null, vessel_id: null, company_id: 'TVC_SHIPPING', seed_password: '0000' },
        // TVC internal — Admin Mode (registry / license / app update)
        { id: 'user-tvc-admin', username: 'admin', display_name: 'Admin', account_type: 'ADMIN', role: 'TVC_ADMIN', department: null, vessel_id: null, seed_password: 'admin' },
    ];

    const REMOVED_SEED_USER_IDS = ['user-supplier-demo'];

    const DEPRECATED_USERNAMES = [
        'admin@thevesselcode.com',
        'hq', 'tvc', 'dm_user@thevesselcode.com', 'pms-21',
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
            throw new Error('Sign-in is not available in file:// mode. Use the Electron app, START-TVC-PMS.bat, or npm start → http://localhost:3000.');
        } else {
            throw new Error('Password verification is not available in this browser. Use the latest Chrome or Edge.');
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
        const demoHash = await hashPassword(DEMO_PASSWORD);
        // 데모 계정은 항상 최신 role/username 으로 동기화 (IndexedDB 캐시 불일치 방지)
        for (const u of DEFAULT_USERS) {
            const { seed_password: seedPassword, ...fields } = u;
            const prev = existing.find(x => x.id === u.id)
                || existing.find(x => x.username === u.username);
            const password_hash = seedPassword
                ? await hashPassword(seedPassword)
                : demoHash;
            await TVC_DB.put('users', {
                ...(prev || {}),
                ...fields,
                password_hash,
                is_active: true,
            });
        }
        // 동일 username 중복 레코드 제거 (예: chief@dm01 → ce 마이그레이션 잔여)
        const fresh = await TVC_DB.getAll('users');
        for (const row of fresh) {
            if (DEPRECATED_USERNAMES.includes(row.username) || REMOVED_SEED_USER_IDS.includes(row.id)) {
                await TVC_DB.del('users', row.id);
                continue;
            }
            const tpl = DEFAULT_USERS.find(d => d.username === row.username);
            if (tpl && row.id !== tpl.id) await TVC_DB.del('users', row.id);
        }
        try { await TVC_DB.setMeta('users_seed_version', USERS_SEED_VERSION); } catch (_) {}
    }

    async function upsertProvisionedUser(record) {
        const username = String(record?.username || '').trim();
        if (!username || !record?.password_hash) {
            throw new Error('Provisioned user requires username and password_hash.');
        }
        const existing = await TVC_DB.getAll('users');
        const prev = existing.find(u => u.id === record.id)
            || existing.find(u => u.username === username);
        const id = prev?.id || record.id || `prov-${username.replace(/[^a-zA-Z0-9._-]+/g, '_')}`;
        await TVC_DB.put('users', {
            ...(prev || {}),
            ...record,
            id,
            username,
            is_active: record.is_active !== false,
        });
        return id;
    }

    async function hashPasswordForProvision(password) {
        return hashPassword(password);
    }

    async function refreshSessionFromDb() {
        const session = getCurrentUser();
        if (!session) return null;
        const users = await TVC_DB.getAll('users');
        const user = users.find(u => u.id === session.id)
            || users.find(u => u.username === session.username);
        if (!user) return session;
        let supplierProfile = null;
        if (user.account_type === 'SUPPLIER' && user.supplier_id) {
            supplierProfile = await TVC_DB.get('supplier_profiles', user.supplier_id).catch(() => null);
        }
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
            department: (user.account_type === 'HQ' || user.account_type === 'SM'
                || user.account_type === 'ADMIN' || user.account_type === 'SUPPLIER')
                ? null : user.department,
            display_name: user.display_name,
            vessel_id: user.vessel_id,
            company_id: user.company_id || null,
            supplier_id: user.supplier_id || session.supplier_id || null,
            company_name: supplierProfile?.company_name || user.company_name || session.company_name || null,
            contact_person: supplierProfile?.contact_person || user.contact_person || null,
            contact_email: supplierProfile?.contact_email || user.contact_email || null,
            business_scope: supplierProfile?.business_scope || user.business_scope || null,
            service_ports: supplierProfile?.service_ports || user.service_ports || null,
            station,
            login_mode: session.login_mode || null,
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
        return updated;
    }

    function normalizeSupplierUsername(raw) {
        return String(raw || '').trim();
    }

    function isUsernameTaken(users, username) {
        const key = normalizeSupplierUsername(username).toLowerCase();
        if (!key) return true;
        return users.some(u => u.is_active
            && normalizeSupplierUsername(u.username).toLowerCase() === key);
    }

    function makeSupplierId() {
        const stamp = Date.now().toString(36);
        const rand = Math.random().toString(36).slice(2, 8);
        return `SUP_${stamp}_${rand}`.toUpperCase();
    }

    function slugUserId(username) {
        return normalizeSupplierUsername(username).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 48) || 'supplier';
    }

    /**
     * Self-service supplier onboarding — stores users + supplier_profiles (offline).
     * @returns {Promise<{ ok: boolean, error?: string, username?: string }>}
     */
    async function registerSupplier(payload) {
        const username = normalizeSupplierUsername(payload?.username);
        const password = String(payload?.password || '');
        const companyName = String(payload?.company_name || '').trim();
        const contactPerson = String(payload?.contact_person || '').trim();
        const contactEmail = String(payload?.contact_email || '').trim().toLowerCase();
        const servicePorts = String(payload?.service_ports || '').trim();
        const businessScope = Array.isArray(payload?.business_scope)
            ? payload.business_scope.map(s => String(s).trim()).filter(Boolean)
            : [];

        if (!username || username.length < 2) {
            return { ok: false, error: 'User ID must be at least 2 characters.' };
        }
        if (!/^[a-zA-Z0-9._@-]+$/.test(username)) {
            return { ok: false, error: 'User ID may only use letters, numbers, and . _ @ -' };
        }
        if (!password || password.length < 4) {
            return { ok: false, error: 'Password must be at least 4 characters.' };
        }
        if (!companyName) return { ok: false, error: 'Supplier / Company Name is required.' };
        if (!businessScope.length) {
            return { ok: false, error: 'Select at least one Business Scope.' };
        }
        if (!contactPerson) return { ok: false, error: 'Contact Person is required.' };
        if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
            return { ok: false, error: 'Enter a valid contact email.' };
        }
        if (!servicePorts) return { ok: false, error: 'Service Base Ports are required.' };

        const users = await TVC_DB.getAll('users');
        if (isUsernameTaken(users, username)) {
            return { ok: false, error: 'This User ID is already registered.' };
        }

        const supplierId = makeSupplierId();
        const userId = `supplier-${slugUserId(username)}`;
        const password_hash = await hashPassword(password);
        const now = new Date().toISOString();

        const profile = {
            supplier_id: supplierId,
            username,
            company_name: companyName,
            business_scope: businessScope,
            contact_person: contactPerson,
            contact_email: contactEmail,
            service_ports: servicePorts,
            sync_status: 'local',
            updated_at: now,
            created_at: now,
        };

        await TVC_DB.put('supplier_profiles', profile);
        await TVC_DB.put('users', {
            id: userId,
            username,
            display_name: companyName,
            password_hash,
            account_type: 'SUPPLIER',
            role: 'SUPPLIER',
            department: null,
            vessel_id: null,
            supplier_id: supplierId,
            company_name: companyName,
            contact_person: contactPerson,
            contact_email: contactEmail,
            business_scope: businessScope,
            service_ports: servicePorts,
            is_active: true,
        });

        return { ok: true, username };
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
        if (!user) return { ok: false, error: 'Account not found.' };
        const hash = await hashPassword(password);
        if (hash !== user.password_hash) return { ok: false, error: 'Incorrect password.' };

        const sessionRole = user.role || (window.TVC_RBAC?.resolveUserRole?.(user));

        if (typeof TVC_License !== 'undefined') {
            await TVC_License.refresh();
            const licCheck = TVC_License.assertLoginMode(loginMode, user.account_type);
            if (!licCheck.ok) return licCheck;
        }

        if (user.account_type === 'HQ' || user.account_type === 'SM'
            || user.account_type === 'ADMIN' || user.account_type === 'SUPPLIER') {
            if (loginMode) {
                return {
                    ok: false,
                    error: user.account_type === 'ADMIN'
                        ? 'Admin accounts must sign in without selecting a Department.'
                        : (user.account_type === 'SUPPLIER'
                            ? 'Supplier accounts must sign in without selecting a Department.'
                            : 'Superintendent accounts must sign in without selecting a Department.'),
                };
            }
            const session = {
                id: user.id, username: user.username, display_name: user.display_name,
                account_type: user.account_type, role: sessionRole,
                department: null, vessel_id: user.vessel_id, company_id: user.company_id || null,
                supplier_id: user.supplier_id || null,
                company_name: user.company_name || user.display_name || null,
                contact_person: user.contact_person || null,
                contact_email: user.contact_email || null,
                business_scope: user.business_scope || null,
                service_ports: user.service_ports || null,
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
            return { ok: false, error: 'Select Department (Captain / Deck / Engine).' };
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

    function getSavedId() {
        try { return localStorage.getItem(SAVED_ID_KEY) || ''; } catch { return ''; }
    }

    function setSavedId(userId) {
        const id = String(userId || '').trim();
        if (!id) return;
        try { localStorage.setItem(SAVED_ID_KEY, id); } catch { /* ignore */ }
    }

    function clearSavedId() {
        try { localStorage.removeItem(SAVED_ID_KEY); } catch { /* ignore */ }
    }

    function hasPersistedAuthSession() {
        try { return !!localStorage.getItem(AUTH_SESSION_KEY); } catch { return false; }
    }

    function savePersistedAuthSession(session) {
        if (!session?.username) return;
        try {
            localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
                userId: session.username,
                role: session.role,
                timestamp: Date.now(),
                loginMode: session.login_mode || null,
            }));
        } catch { /* ignore */ }
    }

    function clearPersistedAuthSession() {
        try { localStorage.removeItem(AUTH_SESSION_KEY); } catch { /* ignore */ }
    }

    function applySavedIdToLoginForm() {
        const savedId = getSavedId();
        const userInput = document.getElementById('loginUser');
        const rememberCb = document.getElementById('loginRememberId');
        const autoCb = document.getElementById('loginAutoLogin');
        if (savedId && userInput) {
            userInput.value = savedId;
            if (rememberCb) rememberCb.checked = true;
        }
        if (hasPersistedAuthSession() && autoCb) autoCb.checked = true;
    }

    async function restorePersistedAuthSession() {
        if (getCurrentUser()) return getCurrentUser();
        let data;
        try {
            const raw = localStorage.getItem(AUTH_SESSION_KEY);
            if (!raw) return null;
            data = JSON.parse(raw);
        } catch {
            clearPersistedAuthSession();
            return null;
        }
        const userId = String(data?.userId || '').trim();
        if (!userId || !data?.timestamp) {
            clearPersistedAuthSession();
            return null;
        }
        if (Date.now() - Number(data.timestamp) > AUTH_SESSION_TTL_MS) {
            clearPersistedAuthSession();
            return null;
        }

        const users = await TVC_DB.getAll('users');
        const template = DEFAULT_USERS.find(u => u.username === userId);
        const user = template
            ? (users.find(u => u.id === template.id && u.is_active)
                || users.find(u => u.username === template.username && u.is_active))
            : users.find(u => u.username === userId && u.is_active);
        if (!user) {
            clearPersistedAuthSession();
            return null;
        }

        const sessionRole = user.role || (window.TVC_RBAC?.resolveUserRole?.(user));
        const loginMode = data.loginMode ? String(data.loginMode) : '';

        if (typeof TVC_License !== 'undefined') {
            await TVC_License.refresh();
            const licCheck = TVC_License.assertLoginMode(loginMode, user.account_type);
            if (!licCheck.ok) {
                clearPersistedAuthSession();
                return null;
            }
        }

        if (user.account_type === 'HQ' || user.account_type === 'SM'
            || user.account_type === 'ADMIN' || user.account_type === 'SUPPLIER') {
            const session = {
                id: user.id, username: user.username, display_name: user.display_name,
                account_type: user.account_type, role: sessionRole,
                department: null, vessel_id: user.vessel_id, company_id: user.company_id || null,
                supplier_id: user.supplier_id || null,
                company_name: user.company_name || user.display_name || null,
                station: null, login_mode: null,
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
            return session;
        }

        if (!loginMode) {
            clearPersistedAuthSession();
            return null;
        }

        let station = null;
        if (typeof TVC_Space !== 'undefined') {
            const spaceCheck = TVC_Space.validateLogin(user, loginMode);
            if (!spaceCheck.ok) {
                clearPersistedAuthSession();
                return null;
            }
            station = spaceCheck.station;
        }

        const session = {
            id: user.id, username: user.username, display_name: user.display_name,
            account_type: user.account_type, role: sessionRole,
            department: user.department, vessel_id: user.vessel_id,
            company_id: user.company_id || null,
            supplier_id: user.supplier_id || null,
            company_name: user.company_name || null,
            station: station || null, login_mode: loginMode || null,
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        return session;
    }

    function logout() {
        sessionStorage.removeItem(SESSION_KEY);
        clearPersistedAuthSession();
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
                catch (e) { await TVC_Dialog.alert(e.message || 'Station access denied.'); return null; }
            }
        }
        return user;
    }

    return {
        initUsers, login, logout, getCurrentUser, refreshSessionFromDb, registerSupplier, requirePermission, changePassword,
        upsertProvisionedUser, hashPasswordForProvision, DEMO_PASSWORD, DEFAULT_USERS,
        getSavedId, setSavedId, clearSavedId, savePersistedAuthSession, clearPersistedAuthSession,
        hasPersistedAuthSession, applySavedIdToLoginForm, restorePersistedAuthSession,
    };
})();
