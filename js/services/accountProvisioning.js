/** THE VESSEL CODE — Provision HQ / Master logins from admin registry */
const TVC_AccountProvisioning = (function () {
    function slugId(value) {
        return String(value || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
    }

    function suggestCompanyHqUsername(companyId, contactEmail) {
        const email = String(contactEmail || '').trim().toLowerCase();
        if (email.includes('@')) return email;
        return slugId(companyId).toLowerCase();
    }

    function suggestVesselMasterUsername(companyId, vesselId) {
        const slug = slugId(vesselId).toLowerCase();
        return slug ? `${slug}_master@thevesselcode.com` : '';
    }

    function generatePassword(length = 8) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        let out = '';
        const cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
        for (let i = 0; i < length; i++) {
            if (cryptoObj?.getRandomValues) {
                const buf = new Uint32Array(1);
                cryptoObj.getRandomValues(buf);
                out += chars[buf[0] % chars.length];
            } else {
                out += chars[Math.floor(Math.random() * chars.length)];
            }
        }
        return out;
    }

    function registryReady() {
        return typeof TVC_AdminRegistry !== 'undefined' && !!TVC_AdminRegistry.get?.();
    }

    async function syncRegistryToUsers() {
        if (!registryReady() || typeof TVC_Auth?.upsertProvisionedUser !== 'function') {
            return { synced: 0 };
        }
        let synced = 0;
        const companies = TVC_AdminRegistry.listCompanies({ includeInactive: true });
        for (const company of companies) {
            const hq = company.hq_login;
            if (hq?.username && hq?.password_hash) {
                await TVC_Auth.upsertProvisionedUser({
                    id: `prov-hq-${slugId(company.company_id)}`,
                    username: String(hq.username).trim(),
                    password_hash: hq.password_hash,
                    account_type: 'HQ',
                    role: 'HQ_SUPERVISOR',
                    department: null,
                    vessel_id: null,
                    company_id: company.company_id,
                    display_name: hq.display_name || `${company.name} HQ`,
                    is_active: company.status !== 'inactive',
                });
                synced++;
            }
            for (const vessel of company.vessels || []) {
                const ml = vessel.master_login;
                if (!ml?.username || !ml?.password_hash) continue;
                await TVC_Auth.upsertProvisionedUser({
                    id: `prov-master-${slugId(company.company_id)}-${slugId(vessel.vessel_id)}`,
                    username: String(ml.username).trim(),
                    password_hash: ml.password_hash,
                    account_type: 'SHIP',
                    role: 'SHIP_CAPTAIN',
                    department: 'DECK',
                    vessel_id: vessel.vessel_id,
                    company_id: company.company_id,
                    display_name: ml.display_name || `${vessel.name} Master`,
                    is_active: company.status !== 'inactive' && vessel.status !== 'inactive',
                });
                synced++;
            }
        }
        return { synced };
    }

    async function saveCompanyHqLogin(companyId, { username, password, display_name }) {
        if (!registryReady()) throw new Error('Registry not loaded.');
        const uname = String(username || '').trim();
        const pwd = String(password || '');
        if (!uname) throw new Error('HQ username (email) is required.');
        if (pwd.length < 4) throw new Error('Password must be at least 4 characters.');
        const hash = await TVC_Auth.hashPasswordForProvision(pwd);
        TVC_AdminRegistry.setCompanyHqLogin(companyId, {
            username: uname,
            password_hash: hash,
            password_plain: pwd,
            display_name: String(display_name || '').trim() || uname,
            updated_at: new Date().toISOString().slice(0, 10),
        });
        await syncRegistryToUsers();
        return { username: uname, password: pwd };
    }

    async function saveVesselMasterLogin(companyId, vesselId, { username, password, display_name }) {
        if (!registryReady()) throw new Error('Registry not loaded.');
        const uname = String(username || '').trim();
        const pwd = String(password || '');
        if (!uname) throw new Error('Master username is required.');
        if (pwd.length < 4) throw new Error('Password must be at least 4 characters.');
        const hash = await TVC_Auth.hashPasswordForProvision(pwd);
        TVC_AdminRegistry.setVesselMasterLogin(companyId, vesselId, {
            username: uname,
            password_hash: hash,
            password_plain: pwd,
            display_name: String(display_name || '').trim() || uname,
            updated_at: new Date().toISOString().slice(0, 10),
        });
        await syncRegistryToUsers();
        return { username: uname, password: pwd };
    }

    return {
        slugId,
        suggestCompanyHqUsername,
        suggestVesselMasterUsername,
        generatePassword,
        syncRegistryToUsers,
        saveCompanyHqLogin,
        saveVesselMasterLogin,
    };
})();
if (typeof window !== 'undefined') window.TVC_AccountProvisioning = TVC_AccountProvisioning;
