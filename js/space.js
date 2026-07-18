/** THE VESSEL CODE — Space / Station access control (CCR · ECR · Captain Hub)
 *  Offline PMS has no HTTP API; this module acts as client-side endpoint middleware. */
const TVC_Space = (function () {
    const Station = {
        CCR: 'CCR',
        ECR: 'ECR',
        CAPTAIN: 'CAPTAIN',
    };

    const Direction = {
        STATION_TO_HUB: 'STATION_TO_HUB',
        SHIP_TO_HQ: 'SHIP_TO_HQ',
        HQ_TO_SHIP: 'HQ_TO_SHIP',
    };

    /** Logical API endpoints guarded per station */
    const Endpoint = {
        DECK_WORK: 'DECK_WORK',
        ENGINE_WORK: 'ENGINE_WORK',
        PENDING_REPORT: 'PENDING_REPORT',
        APPROVE_DECK: 'APPROVE_DECK',
        APPROVE_ENGINE: 'APPROVE_ENGINE',
        STATION_EXPORT: 'STATION_EXPORT',
        HUB_IMPORT: 'HUB_IMPORT',
        COMPANY_EXPORT: 'COMPANY_EXPORT',
        MONITOR_ALL: 'MONITOR_ALL',
        HQ_FEEDBACK_IMPORT: 'HQ_FEEDBACK_IMPORT',
    };

    const STATION_LABELS = {
        CCR: 'CCR (Chart Room)',
        ECR: 'ECR (Engine Control Room)',
        CAPTAIN: 'Captain Room (Hub)',
    };

    const STATION_ENDPOINTS = {
        [Station.CCR]: new Set([
            Endpoint.DECK_WORK, Endpoint.PENDING_REPORT, Endpoint.STATION_EXPORT,
            Endpoint.APPROVE_DECK, Endpoint.HQ_FEEDBACK_IMPORT,
        ]),
        [Station.ECR]: new Set([
            Endpoint.ENGINE_WORK, Endpoint.PENDING_REPORT, Endpoint.STATION_EXPORT,
            Endpoint.APPROVE_ENGINE, Endpoint.HQ_FEEDBACK_IMPORT,
        ]),
        [Station.CAPTAIN]: new Set([
            Endpoint.MONITOR_ALL, Endpoint.DECK_WORK, Endpoint.ENGINE_WORK,
            Endpoint.PENDING_REPORT, Endpoint.APPROVE_DECK, Endpoint.APPROVE_ENGINE,
            Endpoint.HUB_IMPORT, Endpoint.COMPANY_EXPORT, Endpoint.HQ_FEEDBACK_IMPORT,
        ]),
    };


    /** Login UI — Master / Deck / Engine (maps to internal station) */
    const LoginMode = {
        MASTER: 'MASTER',
        DECK: 'DECK',
        ENGINE: 'ENGINE',
    };

    const LOGIN_MODE_LABELS = {
        MASTER: 'Master',
        DECK: 'Deck',
        ENGINE: 'Engine',
    };

    function stationFromLoginMode(mode) {
        if (mode === LoginMode.MASTER) return Station.CAPTAIN;
        if (mode === LoginMode.DECK) return Station.CCR;
        if (mode === LoginMode.ENGINE) return Station.ECR;
        return null;
    }

    function loginModeLabel(mode) {
        return LOGIN_MODE_LABELS[mode] || mode || '—';
    }

    function getStation(user) {
        return user?.station || null;
    }

    function isCaptainHub(user) {
        return getStation(user) === Station.CAPTAIN;
    }

    function isStationPc(user) {
        const s = getStation(user);
        return s === Station.CCR || s === Station.ECR;
    }

    function fixedDepartment(station) {
        if (station === Station.CCR) return 'DECK';
        if (station === Station.ECR) return 'ENGINE';
        return null;
    }

    function stationLabel(station) {
        return STATION_LABELS[station] || station || '—';
    }

    /** Login gate — loginMode: MASTER | DECK | ENGINE */
    function validateLogin(user, loginMode) {
        if (!user) return { ok: false, error: '계정을 확인할 수 없습니다.' };
        if (user.account_type === 'HQ') return { ok: true, station: null };

        if (!loginMode || !LOGIN_MODE_LABELS[loginMode]) {
            return { ok: false, error: 'Department(Master / Deck / Engine)를 선택하세요.' };
        }

        const station = stationFromLoginMode(loginMode);

        if (loginMode === LoginMode.MASTER) {
            if (user.role !== 'SHIP_CAPTAIN') {
                return { ok: false, error: 'Master Mode access is restricted to the Captain.' };
            }
            return { ok: true, station };
        }

        if (loginMode === LoginMode.DECK) {
            if (user.department !== 'DECK') {
                return { ok: false, error: 'Deck department access is limited to Officers and the Captain.' };
            }
            return { ok: true, station };
        }

        if (loginMode === LoginMode.ENGINE) {
            if (user.department !== 'ENGINE') {
                return { ok: false, error: 'Engine department access is limited to Engineers and the Chief Engineer.' };
            }
            return { ok: true, station };
        }

        return { ok: false, error: '유효하지 않은 Department입니다.' };
    }

    /** Client-side endpoint middleware */
    function canEndpoint(user, endpoint) {
        if (!user) return false;
        if (user.account_type === 'HQ') return true;
        const station = getStation(user);
        if (!station) return false;
        const allowed = STATION_ENDPOINTS[station];
        return allowed ? allowed.has(endpoint) : false;
    }

    function assertEndpoint(user, endpoint) {
        if (!canEndpoint(user, endpoint)) {
            const station = getStation(user);
            throw Object.assign(new Error('STATION_ACCESS_DENIED'), {
                code: 'STATION_ACCESS_DENIED',
                endpoint,
                station,
                message: `${stationLabel(station)}에서는 이 작업(${endpoint})을 수행할 수 없습니다.`,
            });
        }
    }

    /** Map RBAC actions → station endpoints */
    function assertAction(user, action) {
        if (!user || user.account_type === 'HQ') return;
        const station = getStation(user);
        if (!station) return;

        const map = {
            [TVC_RBAC.Action.CREATE_DAILY_REPORT]: user.department === 'DECK' ? Endpoint.DECK_WORK : Endpoint.ENGINE_WORK,
            [TVC_RBAC.Action.EDIT_OWN_PENDING_REPORT]: Endpoint.PENDING_REPORT,
            [TVC_RBAC.Action.APPROVE_DAILY_REPORT]: user.role === 'SHIP_CAPTAIN' ? Endpoint.APPROVE_DECK : Endpoint.APPROVE_ENGINE,
            [TVC_RBAC.Action.EXPORT_SHIP_SYNC]: Endpoint.STATION_EXPORT,
            [TVC_RBAC.Action.IMPORT_SHIP_SYNC]: Endpoint.HQ_FEEDBACK_IMPORT,
        };
        const ep = map[action];
        if (ep) assertEndpoint(user, ep);
    }

    function canAccessDepartment(user, dept) {
        if (!user) return false;
        if (TVC_RBAC.isHqAccount(user)) return TVC_RBAC.canAccessDepartment(user, dept);
        if (isCaptainHub(user)) return true;
        const fd = fixedDepartment(getStation(user));
        if (fd) return !dept || dept === fd;
        return TVC_RBAC.canAccessDepartment(user, dept);
    }

    /** Approval: Master(Captain) → all depts; ECR(C/E) → Engine; CCR(Captain) → Deck */
    function canApproveReport(user, dept) {
        if (!user || !TVC_RBAC.isApprover(user)) return false;
        if (isCaptainHub(user)) {
            return user.role === 'SHIP_CAPTAIN';
        }
        const station = getStation(user);
        if (station === Station.ECR) {
            return user.role === 'SHIP_CHIEF' && dept === 'ENGINE';
        }
        if (station === Station.CCR) {
            return user.role === 'SHIP_CAPTAIN' && dept === 'DECK';
        }
        if (!station) {
            return TVC_RBAC.isApprover(user) && user.department === dept;
        }
        return false;
    }

    function getUiFeatures(user) {
        const base = { ...TVC_RBAC.getUiFeatures(user) };
        if (!user || user.account_type === 'HQ') return base;

        const station = getStation(user);
        if (station === Station.CCR) {
            base.showApprovalQueue = user.role === 'SHIP_CAPTAIN';
            base.showExportShip = true;
            base.showImportShip = true;
            base.showStationExport = true;
            base.showHubImport = false;
            base.showCompanyExport = false;
            base.showCaptainDashboard = false;
            base.showDefectReport = true;
            base.showDefectInbox = true;
        }
        if (station === Station.ECR) {
            base.showApprovalQueue = user.role === 'SHIP_CHIEF';
            base.showExportShip = true;
            base.showImportShip = true;
            base.showStationExport = true;
            base.showHubImport = false;
            base.showCompanyExport = false;
            base.showCaptainDashboard = false;
            base.showDefectReport = true;
            base.showDefectInbox = true;
        }
        if (isCaptainHub(user)) {
            base.showCaptainDashboard = false;
            base.showHubImport = true;
            base.showCompanyExport = user.role === 'SHIP_CAPTAIN';
            base.showCompanyImport = user.role === 'SHIP_CAPTAIN';
            base.showHubStationExport = TVC_RBAC.isApprover(user);
            base.showStationExport = false;
            base.showExportShip = false;
            base.showImportShip = false;
            base.showApprovalQueue = TVC_RBAC.isApprover(user);
            base.showDefectReport = true;
            base.showDefectInbox = true;
            base.showDefectImportUrgent = true;
            base.showDefectUrgentExport = TVC_RBAC.isApprover(user);
        }
        return base;
    }

    function getModeBadge(user) {
        if (!user) return '—';
        if (TVC_RBAC.isHqAccount(user)) return 'HQ Mode';
        if (isCaptainHub(user)) return 'Vessel Mode - Master';
        const station = getStation(user);
        if (station === Station.CCR) return 'Vessel Mode - Deck';
        if (station === Station.ECR) return 'Vessel Mode - Engine';
        return user.department === 'DECK' ? 'Vessel Mode - Deck'
            : user.department === 'ENGINE' ? 'Vessel Mode - Engine'
                : 'Vessel Mode';
    }

    function canSwitchDepartmentView(user) {
        return TVC_RBAC.isHqAccount(user) || isCaptainHub(user);
    }

    return {
        Station, Direction, Endpoint, LoginMode, STATION_LABELS, LOGIN_MODE_LABELS,
        getStation, isCaptainHub, isStationPc, fixedDepartment, stationLabel, loginModeLabel,
        stationFromLoginMode, validateLogin, canEndpoint, assertEndpoint, assertAction,
        canAccessDepartment, canApproveReport, getUiFeatures, getModeBadge,
        canSwitchDepartmentView,
    };
})();
