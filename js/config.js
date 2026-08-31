/* THE VESSEL CODE — Web deploy config (Vercel / thevesselcode.com) */
const TVC_Config = (function () {
    /** Supabase — fill after project creation (anon key is public; safe in frontend). */
    const SUPABASE_URL = '';
    const SUPABASE_ANON_KEY = '';

    /** Production PMS app URL (Vercel). Bluehost PMS tab iframe target. */
    const PMS_APP_ORIGIN = 'https://app.thevesselcode.com';
    const MAIN_SITE_ORIGIN = 'https://thevesselcode.com';

    /** Production sync API — Vercel serverless or custom backend. Falls back to localStorage override. */
    const SYNC_API_BASE_URL = 'https://app.thevesselcode.com';

    /** Optional — when set on Vercel (SYNC_CLOUD_READ_KEY), same value here for HQ/Admin cloud DB queries. */
    const SYNC_CLOUD_READ_KEY = '';

    /** Optional — when set on Vercel (SYNC_CLOUD_RESTORE_KEY), same value for cloud restore publish/download. */
    const SYNC_CLOUD_RESTORE_KEY = '';

    /** Vessel Setup.exe — upload to /downloads/ on Vercel or use GitHub Release URL. */
    const VESSEL_SETUP_DOWNLOAD_URL = '/downloads/TVC-PMS-HQ_OFFICE-Setup.exe';

    const WEB_HOSTS = new Set([
        'thevesselcode.com',
        'www.thevesselcode.com',
        'app.thevesselcode.com',
        'pms.thevesselcode.com',
    ]);

    function hostname() {
        try { return String(location.hostname || '').toLowerCase(); } catch (_) { return ''; }
    }

    function isElectron() {
        return !!(typeof window !== 'undefined' && window.tvcElectron?.isElectron);
    }

    function isWebDeploy() {
        if (isElectron()) return false;
        const host = hostname();
        try {
            const q = new URLSearchParams(location.search);
            if (q.get('web') === '1' || q.get('embed') === '1') return true;
        } catch (_) {}
        if (!host || host === 'localhost' || host === '127.0.0.1') return false;
        return WEB_HOSTS.has(host) || host.endsWith('.vercel.app');
    }

    /** Opened inside thevesselcode.com/pms iframe (or ?embed=1). */
    function isEmbedded() {
        try {
            const q = new URLSearchParams(location.search);
            if (q.get('embed') === '1') return true;
            if (window.self !== window.top) return true;
        } catch (_) {
            return true;
        }
        return false;
    }

    function getPmsAppUrl(opts = {}) {
        const embed = opts.embed !== false;
        const base = PMS_APP_ORIGIN.replace(/\/+$/, '');
        return embed ? `${base}/?embed=1` : `${base}/`;
    }

    function isWebAdminPortal() {
        return isWebDeploy();
    }

    /** Admin menu on web — full Administration box on web HQ Admin. */
    function filterAdminMenuSections(sections) {
        return sections;
    }

    function isWebSuperHqUser(user) {
        if (!isWebDeploy() || !user) return false;
        const uname = String(user.username || '').trim().toLowerCase();
        return uname === 'admin' || uname === 'tvc';
    }

    function isSupabaseConfigured() {
        return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
    }

    function applyLoginChrome() {
        if (!isWebDeploy()) return;
        document.body?.classList.add('tvc-web-deploy');

        const beta = document.getElementById('loginBetaBadge');
        if (beta) beta.classList.remove('hidden');

        const hint = document.querySelector('.login-hint');
        if (hint) hint.classList.add('hidden');

        const userLabel = document.querySelector('label[for="loginUser"]');
        if (userLabel) userLabel.textContent = 'Email or Username';

        const dl = document.getElementById('loginDownloadSection');
        if (dl) dl.classList.remove('hidden');

        const dlLink = document.getElementById('loginDownloadLink');
        if (dlLink && VESSEL_SETUP_DOWNLOAD_URL) dlLink.href = VESSEL_SETUP_DOWNLOAD_URL;

        const userInput = document.getElementById('loginUser');
        if (userInput) {
            userInput.type = 'email';
            userInput.placeholder = 'dm_user@thevesselcode.com';
            userInput.autocomplete = 'username email';
        }
    }

    function applyEmbedChrome() {
        if (!isWebDeploy() || !isEmbedded()) return;
        document.body?.classList.add('tvc-embed');

        const back = document.getElementById('loginMainSiteLink');
        if (back) {
            back.classList.remove('hidden');
            const a = back.querySelector('a');
            if (a) a.href = MAIN_SITE_ORIGIN;
        }

        const appBack = document.getElementById('appMainSiteLink');
        if (appBack) {
            appBack.classList.remove('hidden');
            const a = appBack.querySelector('a');
            if (a) a.href = MAIN_SITE_ORIGIN;
        }
    }

    return {
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        SYNC_API_BASE_URL,
        SYNC_CLOUD_READ_KEY,
        SYNC_CLOUD_RESTORE_KEY,
        VESSEL_SETUP_DOWNLOAD_URL,
        PMS_APP_ORIGIN,
        MAIN_SITE_ORIGIN,
        isElectron,
        isWebDeploy,
        isWebAdminPortal,
        filterAdminMenuSections,
        isEmbedded,
        getPmsAppUrl,
        isWebSuperHqUser,
        isSupabaseConfigured,
        applyLoginChrome,
        applyEmbedChrome,
    };
})();
if (typeof window !== 'undefined') window.TVC_Config = TVC_Config;
