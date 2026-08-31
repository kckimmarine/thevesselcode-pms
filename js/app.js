/* THE VESSEL CODE — Main Application (v3.0 · CMAXS Tab Navigation) */
const TVC_App = (function () {
    const ROW_H = 36;
    const PLAN_SHEET_MIN_WIDTH = 924;
    const DEPT_TREE_ORDER = ['DECK', 'ENGINE'];
    const TABS = ['menu', 'actual', 'history', 'spare'];
    const CRITICAL_GROUP_KEY = '__CRITICAL_EQUIPMENT__';
    const NEW_ORIG_JOB_EDIT_ID = '__new_orig_job__';
    let _wrSpareSearchT = null;
    let _planRowRefreshTimer = null;
    let _planRowLastTap = { id: null, t: 0 };
    let _menuXfer = { step: 'mode' };
    let _menuHistCategory = 'case'; // case | monthly

    function repSt(r) { return TVC_RBAC.normalizeReportStatus(r?.status, !!r?.is_locked); }
    function itemSt(item) { return TVC_RBAC.normalizeReportStatus(item?.status); }

    /** Web HQ portal (Vercel / thevesselcode.com) — not Electron ship PC. */
    function isWebPortal() {
        try {
            if (typeof TVC_Config !== 'undefined' && TVC_Config.isWebDeploy?.()) return true;
        } catch (_) {}
        try {
            const h = String(location.hostname || '').toLowerCase();
            const q = new URLSearchParams(location.search);
            if (q.get('web') === '1' || q.get('embed') === '1') return true;
            if (!h || h === 'localhost' || h === '127.0.0.1') return false;
            if (h.endsWith('.vercel.app')) return true;
            return ['thevesselcode.com', 'www.thevesselcode.com', 'app.thevesselcode.com', 'pms.thevesselcode.com'].includes(h);
        } catch (_) { return false; }
    }

    function filterAdminMenuForWeb(sections) {
        if (!isWebPortal()) return sections;
        if (typeof TVC_Config !== 'undefined' && TVC_Config.filterAdminMenuSections) {
            return TVC_Config.filterAdminMenuSections(sections);
        }
        return sections.map(section => {
            if (section.key === 'commercial') {
                return {
                    ...section,
                    items: (section.items || []).filter(it =>
                        String(it.action || '').includes('openAdminDeliverModal')
                    ),
                };
            }
            if (section.key === 'admin') {
                return {
                    ...section,
                    items: (section.items || []).filter(it =>
                        String(it.action || '').includes('openAdminRegistryHub')
                    ),
                };
            }
            return section;
        }).filter(s => (s.items || []).length > 0);
    }

    let state = {
        user: null,
        components: [], jobs: [], groups: [], spareGroups: [], spares: [], reports: [], defectCases: [], workPermits: [],
        idx: null,
        selectedGroupKey: null,
        spareSelectedGroupKey: null,
        treeSearch: '',
        collapsedTreeDepts: {},
        actualFilter: 'total',        // total | overdue | due30 | postponed | critical
        actualPeriodFrom: '',         // YYYY-MM-DD Due date range (Work Plan)
        actualPeriodTo: '',
        reportPeriodFrom: '',         // YYYY-MM-DD Reported Date (Defect · Work History)
        reportPeriodTo: '',
        historyScope: 'pms',          // pms | spare
        spareHistPeriodFrom: '',
        spareHistPeriodTo: '',
        spareHistSearch: '',
        _spareHistSelKey: null,
        listFilters: {
            actual: { pics: [], unassigned: false, criticalOnly: false },
            history: { groupKeys: [], type: 'all', openOnly: false, noClosedOut: false, postponeAwaitingApproval: false, awaitingShipConfirm: false },
        },
        jobSort: { field: 'job_code', asc: true },
        search: '',
        selectedJobId: null,
        _wpJobId: null,
        _wpTab: 'procedure',
        _wpEditing: false,
        _wrJobId: null,
        _wrTab: 'repair',
        _wrPage: '1',
        _wrUsedParts: [],
        _wrSpareSearch: '',
        _wrForm: {},
        _wrJobItems: null,
        _wrPostSaveView: false,
        _dfPostSaveView: false,
        _wpPostSaveView: false,
        _wrFromHistory: false,
        _wrOverWorkProcedure: false,
        _histNavJobId: null,
        department: 'ENGINE',
        station: null,                     // CCR | ECR | CAPTAIN
        captainView: 'deck',               // deck | engine (Captain Hub dashboard)
        space: 'SHIP',                     // 데이터 공간: 'HQ' | 'SHIP' (Export/Import로만 상호 동기화)
        currentTab: 'menu',
        histView: 'workReport',
        vlActual: null,
        _rhNodes: [],
        _deptPickResolve: null,
        _pendingImportDept: null,
        fleet: [],
        fleetView: 'all',       // all | selected
        fleetSearch: '',
        fleetCompanyFilter: '',
        selectedVesselId: null,
        // SpareRequest 탭
        spareSelected: {},      // { spare_id: true } 청구 대상 선택
        spareShowLow: true,     // 저재만 보기
        selectedReqId: null,    // 열람 중인 청구서
        spicsAlerts: [],
        focusedSpareId: null,        // SPARE 행 클릭 — 연한 파란색 포커스만
        spareListSelected: {},       // { spareId: true } — SPARE 목록 ㅁ 체크(재고 조회용)
        requisitionDraft: [],        // [spareId, …] — New Requisition 선택 아이템(목록과 독립)
        spareMenu: null,
        batchSelectedJobs: {},   // { jobId: true } — Original/Work Plan 다중 선택
        actualSelectedOnly: false, // Work Plan — 선택 항목만 목록 표시
        _batchDraft: null,       // multi-job Work Report 편집 중 임시 데이터
        _batchMode: false,
        _batchJobIds: [],
        _batchSpareSearch: {},
        _batchJobPickerOpen: false,
        _histSelReportId: null,   // Work History 선택 행 (reportId|jobId)
        _histChecked: {},         // Work History 승인용 체크박스 { rowKey: true }
    };

    let bootReady = false;
    let bootDbReady = false;
    let bootReadyPromise = null;
    let bootReadyResolve = null;
    let loginBusy = false;
    let _bootWatchdog = null;

    function finishBootReady() {
        if (bootReady) return;
        bootReady = true;
        bootReadyResolve?.();
        setLoginBusy(false);
    }

    function startBootWatchdog(ms = 12000) {
        clearTimeout(_bootWatchdog);
        _bootWatchdog = setTimeout(() => {
            if (bootReady) return;
            if (!bootDbReady) {
                startBootWatchdog(8000);
                return;
            }
            console.warn('[TVC] boot watchdog — unlocking login UI');
            finishBootReady();
            showLogin();
            const errEl = document.getElementById('loginErr');
            if (errEl && !errEl.textContent) {
                errEl.textContent = 'System startup is delayed. Sign in again shortly or refresh with Ctrl+Shift+R.';
            }
        }, ms);
    }

    function setLoginBusy(busy, message) {
        loginBusy = busy;
        const btn = document.querySelector('#loginScreen .login-submit');
        const errEl = document.getElementById('loginErr');
        if (btn) {
            if (!btn.dataset.defaultLabel) btn.dataset.defaultLabel = btn.textContent.trim() || 'Sign In';
            btn.disabled = busy;
            btn.classList.toggle('is-busy', busy);
            btn.textContent = busy && message ? message : btn.dataset.defaultLabel;
        }
        document.querySelectorAll('#loginScreen input, #loginScreen select').forEach(el => {
            el.disabled = busy;
        });
        if (busy && message && errEl && !errEl.textContent) errEl.textContent = '';
    }

    function formatLoginError(err) {
        const msg = String(err?.message || err || '').trim();
        if (/reading 'transaction'|DB_NOT_READY|database is not ready/i.test(msg)) {
            return 'Local database is still starting. Wait a few seconds and try again, or restart the app (Ctrl+Shift+R).';
        }
        if (/^internal error\.?$/i.test(msg)) {
            return 'Local database error (Internal error). Close all TVC windows, restart the app, or sign in with the correct Department. If it persists, contact TVC support.';
        }
        return msg || 'An error occurred while signing in.';
    }

    /** Limit Department dropdown to licensed login modes (Engine SKU → Engine only). */
    function applyLoginDeptForLicense(lic) {
        const sel = document.getElementById('loginDept');
        const field = sel?.closest('.login-field');
        if (!sel) return;
        const allModes = [
            { value: 'MASTER', label: 'Master' },
            { value: 'ENGINE', label: 'Engine' },
            { value: 'DECK', label: 'Deck' },
        ];
        if (!lic?.enforced || !lic?.ok) {
            sel.innerHTML = `<option value="">— Select Department —</option>`
                + allModes.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
            if (field) field.classList.remove('hidden');
            return;
        }
        if (lic.allowAdmin) {
            if (field) field.classList.add('hidden');
            sel.value = '';
            return;
        }
        if (lic.allowHq) {
            if (field) field.classList.add('hidden');
            sel.value = '';
            return;
        }
        const allowed = (lic.loginModes || []).map(m => String(m).toUpperCase()).filter(Boolean);
        const modes = allModes.filter(m => allowed.includes(m.value));
        if (!modes.length) {
            sel.innerHTML = `<option value="">— Select Department —</option>`
                + allModes.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
            if (field) field.classList.remove('hidden');
            return;
        }
        if (field) field.classList.remove('hidden');
        if (modes.length === 1) {
            sel.innerHTML = `<option value="${modes[0].value}" selected>${modes[0].label}</option>`;
            sel.value = modes[0].value;
            return;
        }
        sel.innerHTML = `<option value="">— Select Department —</option>`
            + modes.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
    }

    function clearStaleLoginSession(lic) {
        try {
            const user = TVC_Auth.getCurrentUser();
            if (!user || !lic?.enforced || !lic?.ok) return;
            if (lic.allowAdmin || lic.allowHq) return;
            const mode = String(user.login_mode || '').toUpperCase();
            const allowed = (lic.loginModes || []).map(m => String(m).toUpperCase());
            if (mode && allowed.length && !allowed.includes(mode)) {
                TVC_Auth.logout();
            }
        } catch (_) { /* ignore */ }
    }

    async function runDeferredBoot() {
        if (state._deferredBootRunning || state._deferredBootDone) return;
        state._deferredBootRunning = true;
        try {
        try {
            const sync = await TVC_DB.SparePart.syncOnBoot();
            if (sync.migrated) console.info('[SPICS] syncOnBoot migrated', sync.migrated, '/', sync.total);
        } catch (e) { console.warn('[SPICS] syncOnBoot', e); }
        try { await TVC_DataPurge.run(); } catch (e) { console.warn('[TVC_DataPurge]', e); }
        try { await TVC_DataPurge.migrateIncheonChemiMasterToTvcNo1Once(); } catch (e) { console.warn('[TVC_DataPurge] master migrate', e); }
        try {
            const reqPurge = await TVC_DataPurge.purgeAllRequisitionsOnce();
            if (reqPurge?.requisitions) {
                state.spareModule = state.spareModule || {};
                state.spareModule.selectedReqId = null;
                state.spareModule.showReqPanel = false;
            }
        } catch (e) { console.warn('[TVC_DataPurge] requisitions', e); }
        try {
            const repPurge = await TVC_DataPurge.purgeAllReportsForTestingOnce();
            if (repPurge?.workReports || repPurge?.defectCases) {
                state._histSelReportId = null;
                state._histChecked = {};
                state._wrReportId = null;
            }
        } catch (e) { console.warn('[TVC_DataPurge] reports', e); }
        try { await TVC_DataPurge.repairReportJobRefsOnce(); } catch (e) { console.warn('[TVC_DataPurge] report job refs', e); }
        try {
            const listPurge = await TVC_DataPurge.purgeBuggyListDataOnce();
            if (listPurge && !listPurge.skipped) {
                state._histSelReportId = null;
                state._histChecked = {};
                state._wrReportId = null;
                state.spareModule = state.spareModule || {};
                state.spareModule.selectedReqId = null;
            }
        } catch (e) { console.warn('[TVC_DataPurge] list data', e); }
        try { await TVC_Fleet.ensureFleet(); } catch (e) { console.warn('[TVC_Fleet]', e); }

            const seed = await TVC_Seed.ensureSeed();
            if (seed.needFile) document.getElementById('seedBanner')?.classList.remove('hidden');
            try { await TVC_Seed.ensureInventoryDefaults(); } catch (e) { console.warn('inventory defaults', e); }
            try {
                const xls = await TVC_Seed.ensureSpareInventoryXls();
                if (xls.loaded) console.info('[SPARE] Engine inventory:', xls.stats?.spares, 'parts');
                else if (xls.fileProtocol) console.info('[SPARE] file:// — use npm run serve or file picker');
            } catch (e) { console.warn('spare inventory xls', e); }
            try {
                if (typeof TVC_MasterVesselScope !== 'undefined') {
                    await TVC_MasterVesselScope.ensureBackfill();
                }
            } catch (e) { console.warn('[TVC_MasterVesselScope]', e); }
            try {
                const dedup = await TVC_SpareDedup.runOnce();
                if (dedup?.totalRemoved > 0) {
                    console.info('[SPARE] duplicate parts removed:', dedup.totalRemoved);
                    state._spareImportMsg = `Removed ${dedup.totalRemoved} duplicate spare part(s). Inventory count restored.`;
                }
            } catch (e) { console.warn('[TVC_SpareDedup]', e); }
            try {
                const scrub = await TVC_SpareDedup.scrubInferredEquipmentOnce();
                if (scrub?.cleared > 0) {
                    console.info('[SPARE] inferred equipment cleared:', scrub.cleared);
                    state._spareImportMsg = `Cleared ${scrub.cleared} auto-assigned Equipment field(s). Codes re-aligned to group level (EE=00) where applicable.`;
                }
            } catch (e) { console.warn('[TVC_SpareDedup] equipment scrub', e); }

            if (TVC_Env.isFileProtocol()) {
                document.getElementById('fileProtocolBanner')?.classList.remove('hidden');
                document.getElementById('loginFileBanner')?.classList.remove('hidden');
                document.getElementById('fileProtocolModal')?.classList.remove('hidden');
            }
            state._deferredBootDone = true;
            if (state.user) {
                try {
                    await loadData();
                    rerenderCurrentTab();
                } catch (e) { console.warn('[TVC] reload after deferred boot', e); }
            }
        } finally {
            state._deferredBootRunning = false;
        }
    }

    // ── Boot ─────────────────────────────────────────────────────────
    /** package.json 1.0.0 → display v1.0.0 ; 1.100.0 → v1.100.0 */
    function formatDisplayVersion(ver) {
        const raw = String(ver || '').trim().replace(/^v/i, '');
        if (!raw) return 'v1.0.0';
        const parts = raw.split('.');
        const major = parts[0] || '1';
        const minor = parts[1] || '0';
        const patch = parts[2] != null && parts[2] !== '' ? parts[2] : '0';
        return `v${major}.${minor}.${patch}`;
    }

    async function resolveAppVersion() {
        try {
            if (window.tvcElectron?.getAppInfo) {
                const info = await window.tvcElectron.getAppInfo();
                if (info?.version) return String(info.version);
            }
        } catch (_) { /* ignore */ }
        try {
            const res = await fetch('package.json', { cache: 'no-store' });
            if (res.ok) {
                const pkg = await res.json();
                if (pkg?.version) return String(pkg.version);
            }
        } catch (_) { /* ignore */ }
        return '1.0.6';
    }

    async function syncLoginAppVersion() {
        const ver = await resolveAppVersion();
        const el = document.getElementById('loginAppVersion');
        if (el) el.textContent = formatDisplayVersion(ver);
        return ver;
    }

    async function boot() {
        bootReady = false;
        bootDbReady = false;
        bootReadyPromise = new Promise(resolve => { bootReadyResolve = resolve; });
        setLoginBusy(true, 'Preparing system…');
        startBootWatchdog();
        try {
            try { await syncLoginAppVersion(); } catch (e) { console.warn('[TVC] version', e); }
            try { TVC_Config?.applyLoginChrome?.(); } catch (e) { console.warn('[TVC] login chrome', e); }
            try { TVC_Config?.applyEmbedChrome?.(); } catch (e) { console.warn('[TVC] embed chrome', e); }
            if (typeof TVC_License !== 'undefined') {
                try {
                    const lic = await TVC_License.refresh();
                    if (lic?.enforced && lic.ok) {
                        const badge = document.getElementById('loginLicenseBadge');
                        if (badge) {
                            badge.classList.remove('hidden');
                            badge.textContent = `${lic.skuLabel || lic.sku}`
                                + (lic.vesselId ? ` · ${lic.vesselId}` : '')
                                + (lic.expiresAt ? ` · until ${String(lic.expiresAt).slice(0, 10)}` : '');
                        }
                        applyLoginDeptForLicense(lic);
                        clearStaleLoginSession(lic);
                    }
                } catch (e) { console.warn('[TVC_License]', e); }
            }
            await TVC_DB.open();
            bootDbReady = true;
            // Vessel SKU: pin DB vessel_id to licensed vessel
            try {
                const lic = typeof TVC_License !== 'undefined' ? TVC_License.statusSync() : null;
                if (lic?.enforced && lic.ok && lic.vesselId) {
                    await TVC_DB.setMeta(TVC_META_KEYS.VESSEL_ID, lic.vesselId);
                }
            } catch (e) { console.warn('[TVC] license vessel pin', e); }
            await TVC_Auth.initUsers();
            try {
                if (typeof TVC_AdminRegistry !== 'undefined') {
                    await TVC_AdminRegistry.load();
                    if (typeof TVC_AccountProvisioning !== 'undefined') {
                        await TVC_AccountProvisioning.syncRegistryToUsers();
                    }
                }
            } catch (e) { console.warn('[TVC] provisioned accounts sync', e); }

            ['loginUser', 'loginPass', 'loginDept'].forEach(id => {
                document.getElementById(id)?.addEventListener('keydown', e => {
                    if (e.key === 'Enter') handleLogin();
                });
            });
            bindListFilterSearchClear();
            bindTabSearchClearInputs();
            try { TVC_ListFilters?.init(); } catch (e) { console.error('[TVC] ListFilters init', e); }

        const sessionUser = await TVC_Auth.refreshSessionFromDb();
            try {
                TVC_RunHours.init({
                    getState: () => state,
                    refresh: refreshAll,
                    allWorkHistoryConfirmed,
                    isWorkHistoryEntryConfirmed: isMonthlyRhGateEntryReady,
                    getMonthlyRhGatePendingEntries,
                    workHistoryEntriesRaw,
                    canUpdateRunningHours,
                    canEditRunningHours: canEditRunningHoursPerm,
                    onRhToolbarChange: () => {
                        syncPlanUpdateUi();
                        if (state.currentTab === 'menu') renderMainMenu();
                    },
                });
            } catch (e) { console.error('[TVC] RunHours init', e); }
            try {
        TVC_SpareMenu.init({ getState: () => state, refresh: refreshAll });
            } catch (e) { console.error('[TVC] SpareMenu init', e); }
            try {
        TVC_DefectReport.init({ getState: () => state, refresh: refreshAll });
            } catch (e) { console.error('[TVC] DefectReport init', e); }
            try {
        TVC_WorkPermitReport.init({ getState: () => state, refresh: refreshAll });
            } catch (e) { console.error('[TVC] WorkPermit init', e); }
            try {
        TVC_OutstandingTasks.init({
            getState: () => state,
            deptJobs,
            jobMatchesActualFilter,
            jobActualStatusKind,
                    jobShowsCriticalEquipmentMark,
            menuNavigate,
                    menuAction,
                    rhUpdateGateApplies,
                    isRhUpdateCommitted,
                    isOriginalPlanUpdateLocked,
                    getPlanLockDept,
                    getMonthlyRhGatePendingEntries,
                    monthlyRhGatePendingReason,
                });
            } catch (e) { console.error('[TVC] OutstandingTasks init', e); }
        window.addEventListener('tvc:spics-requisition-suggest', (e) => {
            state.spicsAlerts = e.detail?.alerts || [];
            renderSpicsAlertBanner();
                TVC_SpareMenu.suggestRequisition?.(e.detail?.alerts || []);
            if (state.currentTab === 'actual') renderActualPlan();
        });
        window.addEventListener('tvc:spics-low-stock', (e) => {
            state.spicsAlerts = e.detail?.alerts || [];
            renderSpicsAlertBanner();
            if (state.currentTab === 'actual') renderActualPlan();
        });

            runDeferredBoot().catch(e => console.warn('[TVC] deferred boot', e));

        const user = sessionUser || TVC_Auth.getCurrentUser();
            if (user) {
                // Auto-login must not block login UI unlock (loadData can take several seconds).
                onLogin(user).catch(e => {
                    console.error('[TVC] auto-login failed', e);
                    try { TVC_Auth.logout(); } catch (_) {}
                    state.user = null;
                    showLogin();
                    const errEl = document.getElementById('loginErr');
                    if (errEl) errEl.textContent = e.message || 'Auto sign-in failed. Please sign in again.';
                });
            } else {
                showLogin();
            }
        } catch (e) {
            console.error('[TVC] boot failed', e);
            const errEl = document.getElementById('loginErr');
            if (errEl) errEl.textContent = formatLoginError(e);
            showLogin();
        } finally {
            clearTimeout(_bootWatchdog);
            finishBootReady();
        }
    }

    /** 부서별 데이터 독립성(영구 분리): 선박 계정은 로드 단계에서부터 자기 부서 데이터만 취득한다. */
    /** PMS Group 부서 재분류: legacy 24·25 → ENGINE; legacy DECK catalog name+no → DECK; 26번은 JOB CODE별 분리.
     *  Per-dept group numbers (01, 02, …) are not forced — only legacy seed labels match. */
    const FORCE_ENGINE_GROUP_NOS = new Set([24, 25]);
    const JOB_DEPT_OVERRIDES = {
        '26-001': 'DECK',
        '26-002': 'DECK',
        '26-003': 'ENGINE',
        '26-004': 'ENGINE',
    };

    function pmsGroupNoFromLabel(label) {
        const mm = String(label || '').trim().match(/^(\d+)\s*\./);
        return mm ? parseInt(mm[1], 10) : null;
    }

    function forceDeptForGroupLabel(label) {
        const n = pmsGroupNoFromLabel(label);
        if (n != null && FORCE_ENGINE_GROUP_NOS.has(n)) return 'ENGINE';
        if (label && typeof TVC_PmsMasterExcel !== 'undefined' && TVC_PmsMasterExcel.isLegacyDeckGroupLabel?.(label)) {
            return 'DECK';
        }
        return null;
    }

    function forceDeptForGroup26Job(job) {
        const groupStr = String(job?.group || '').toUpperCase();
        // Legacy combined seed (CARGO + F.O in one label) — job_code override handles split
        if (groupStr.includes('CARGO TANK') && groupStr.includes('F.O TANK')) return null;
        const itemStr = String(job?.item_sort1 || '').toUpperCase();
        const pathStr = `${groupStr}\0${itemStr}`;
        if (pathStr.includes('F.O TANK')) return 'ENGINE';
        if (pathStr.includes('CARGO TANK')) return 'DECK';
        return null;
    }

    function forceDeptForJob(job) {
        if (job?.master_import_at) return null;
        const fromSplit26 = forceDeptForGroup26Job(job);
        if (fromSplit26) return fromSplit26;
        const code = String(job?.job_code || '').trim().toUpperCase();
        if (JOB_DEPT_OVERRIDES[code]) return JOB_DEPT_OVERRIDES[code];
        const dept = String(job?.department || '').toUpperCase();
        if (dept === 'ENGINE') return null;
        return forceDeptForGroupLabel(job?.group);
    }

    function forceDeptForGroup26Component(c) {
        const grpLabel = Array.isArray(c.path) ? c.path[1] : null;
        if (pmsGroupNoFromLabel(grpLabel) !== 26) return null;
        const pathStr = (c.path || []).join('\0').toUpperCase();
        if (pathStr.includes('CARGO TANK MONITORING SYSTEM')) return 'DECK';
        if (pathStr.includes('F.O TANK MONITORING SYSTEM')) return 'ENGINE';
        return null;
    }

    function forceDeptForComponent(c) {
        const rootDept = Array.isArray(c.path) ? String(c.path[0] || '').toUpperCase() : '';
        if (rootDept === 'ENGINE') return null;
        const fromSplit26 = forceDeptForGroup26Component(c);
        if (fromSplit26) return fromSplit26;
        const grpLabel = Array.isArray(c.path) ? c.path[1] : null;
        return forceDeptForGroupLabel(grpLabel);
    }

    async function normalizeGroupDepartments(jobs, components, groups) {
        const changedJobs = [];
        (jobs || []).forEach(j => {
            const target = forceDeptForJob(j);
            if (target != null && j.department !== target) {
                j.department = target;
                changedJobs.push(j);
            }
        });
        const changedComps = [];
        (components || []).forEach(c => {
            const target = forceDeptForComponent(c);
            if (!target) return;
            let changed = false;
            if (Array.isArray(c.path) && c.path[0] && c.path[0] !== target) {
                c.path = [target, ...c.path.slice(1)];
                changed = true;
            }
            if (c.department && c.department !== target) { c.department = target; changed = true; }
            if (changed) changedComps.push(c);
        });
        const changedGroups = [];
        (groups || []).forEach(g => {
            if (String(g.department || '').toUpperCase() === 'ENGINE') return;
            const n = pmsGroupNoFromLabel(g.label);
            if (n === 26) return;
            const target = forceDeptForGroupLabel(g.label);
            if (target && g.department !== target) {
                g.department = target;
                changedGroups.push(g);
            }
        });
        try {
            if (changedJobs.length) await TVC_DB.bulkPut('maintenance_jobs', changedJobs);
            if (changedComps.length) await TVC_DB.bulkPut('ship_components', changedComps);
            if (changedGroups.length) await TVC_DB.bulkPut('maintenance_groups', changedGroups);
        } catch (e) {
            console.warn('[TVC] group department normalize skipped:', e);
        }
        return { jobs: changedJobs.length, comps: changedComps.length, groups: changedGroups.length };
    }

    function reportIsActiveForPlanSchedule(r) {
        if (!r) return false;
        TVC_WorkReport.fromLegacy(r);
        if (!TVC_RBAC.isReportedStatus(r.status) && !TVC_RBAC.isConfirmedStatus(r.status)
            && !TVC_RBAC.isApprovedStatus(r.status, r.is_locked)) return false;
        return r.work_type === 'POSTPONE' || r.work_type === 'MAINTENANCE' || r.work_type === 'TROUBLE';
    }

    /** Job 일정 — 동일 날짜면 Maintenance가 Postpone보다 우선 */
    function scheduleReportPriority(r) {
        return r?.work_type === 'POSTPONE' ? 0 : 1;
    }

    function compareScheduleReportsAsc(a, b) {
        const da = listReportedDateStr(a);
        const db = listReportedDateStr(b);
        if (da !== db) return da.localeCompare(db);
        const pa = scheduleReportPriority(a);
        const pb = scheduleReportPriority(b);
        if (pa !== pb) return pa - pb;
        return String(a?.created_at || a?.id || '').localeCompare(String(b?.created_at || b?.id || ''));
    }

    /** Job별 최신 Work Report(MAINTENANCE/POSTPONE) — Work Plan STATUS·일정 반영용 */
    function buildLatestScheduleByJobId(reports) {
        const latest = new Map();
        (reports || []).forEach(r => {
            if (!reportIsActiveForPlanSchedule(r)) return;
            TVC_WorkReport.getJobItems(r).forEach(item => {
                const jobId = item.maintenance_job_id;
                if (!jobId) return;
                const prev = latest.get(jobId);
                if (!prev || compareScheduleReportsAsc(prev.report, r) <= 0) {
                    latest.set(jobId, { report: r, item });
                }
            });
        });
        return latest;
    }

    function applyScheduleFromReportItem(job, report, item) {
        if (!job || !report || !item) return false;
        const form = item.form || report.report_form || {};
        if (report.work_type === 'POSTPONE') {
            const postponeDate = String(
                report.approved_postpone_date || report.postpone_date || form.postponeDate || '',
            ).slice(0, 10);
            if (!postponeDate) return false;
            const overdue = new Date(postponeDate) < new Date(new Date().toDateString());
            if (job.next_date === postponeDate && job.schedule_basis === 'POSTPONE'
                && !!job.is_overdue === overdue && job.plan_status === 'PLANNED') return false;
            job.next_date = postponeDate;
            job.is_overdue = overdue;
            job.schedule_basis = 'POSTPONE';
            job.plan_status = 'PLANNED';
            if (form.lastMaintDate) job.last_done = String(form.lastMaintDate).slice(0, 10);
            return true;
        }
        if (report.work_type !== 'MAINTENANCE' && report.work_type !== 'TROUBLE') return false;
        const lastDone = String(form.workDate || form.lastMaintDate || report.work_date || '').slice(0, 10);
        if (!lastDone) return false;
        const nextDate = TVC_Transaction.calcNextDate(job, lastDone);
        const overdue = new Date(nextDate) < new Date(new Date().toDateString());
        if (job.last_done === lastDone && job.next_date === nextDate && job.plan_status === 'COMPLETED') return false;
        job.last_done = lastDone;
        job.next_date = nextDate;
        job.is_overdue = overdue;
        job.plan_status = 'COMPLETED';
        if (job.schedule_basis === 'POSTPONE') job.schedule_basis = null;
        return true;
    }

    async function applyActiveReportSchedules() {
        const jobById = new Map((state.jobs || []).map(j => [j.id, j]));
        const dirty = [];
        const latest = buildLatestScheduleByJobId(state.reports || []);
        for (const [jobId, { report, item }] of latest) {
            const job = jobById.get(jobId);
            if (!job) continue;
            if (applyScheduleFromReportItem(job, report, item)) dirty.push(job);
        }
        if (dirty.length) {
            const ts = new Date().toISOString();
            for (const job of dirty) {
                job.updated_at = ts;
                job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
                await TVC_DB.put('maintenance_jobs', job);
            }
        }
    }

    /** Defect Cleared(DC) — Work Plan LAST DONE / NEXT DATE (저장 누락·Confirm 전 DC 등 보정) */
    async function applyDefectClearedSchedules() {
        const jobById = new Map((state.jobs || []).map(j => [j.id, j]));
        const jobByCode = new Map((state.jobs || []).map(j => [j.job_code, j]));
        const dirtyJobs = [];
        const dirtyCases = [];
        const ts = new Date().toISOString();

        const cleared = (state.defectCases || [])
            .filter(dc => dc.defect_cleared && defectHistoryHasJob(dc))
            .sort((a, b) => String(b.ship_verified_date || b.report_date || '').localeCompare(
                String(a.ship_verified_date || a.report_date || ''),
            ));

        for (const dc of cleared) {
            const lastDone = String(
                dc.ship_verified_date || dc.work_date || dc.report_date || dc.last_maintenance_date || '',
            ).slice(0, 10);
            if (!lastDone) continue;
            const targets = TVC_Transaction.resolveDefectScheduleTargets
                ? TVC_Transaction.resolveDefectScheduleTargets(dc)
                : [{ jobId: dc.maintenance_job_id, jobCode: defectEffectiveJobCode(dc) }];
            for (const t of targets) {
                const job = (t.jobId && jobById.get(t.jobId))
                    || (t.jobCode ? jobByCode.get(t.jobCode) : null);
                if (!job) continue;
                const nextDate = TVC_Transaction.calcNextDate(job, lastDone);
                const overdue = new Date(nextDate) < new Date(new Date().toDateString());
                const scheduleMatches = job.last_done === lastDone
                    && job.next_date === nextDate
                    && job.plan_status === 'COMPLETED';
                if (scheduleMatches) {
                    if (!dc.job_schedule_applied_at && !dirtyCases.includes(dc)) {
                        dc.job_schedule_applied_at = ts;
                        dirtyCases.push(dc);
                    }
                    continue;
                }
                job.last_done = lastDone;
                job.next_date = nextDate;
                job.is_overdue = overdue;
                job.plan_status = 'COMPLETED';
                if (job.schedule_basis === 'POSTPONE') job.schedule_basis = null;
                job.updated_at = ts;
                job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
                if (!dirtyJobs.includes(job)) dirtyJobs.push(job);
                if (!dc.maintenance_job_id) dc.maintenance_job_id = job.id;
                if (!dc.job_schedule_applied_at && !dirtyCases.includes(dc)) {
                    dc.job_schedule_applied_at = ts;
                    dirtyCases.push(dc);
                }
            }
        }

        for (const job of dirtyJobs) await TVC_DB.put('maintenance_jobs', job);
        for (const dc of dirtyCases) {
            dc.updated_at = ts;
            dc.sync_status = dc.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (dc.sync_status || 'LOCAL');
            await TVC_DB.put('defect_cases', dc);
        }
    }

    /** Work Permit — 부서 필드·job 연결로 소속 판별 (ALL/빈 값은 job에서 추론) */
    function workPermitBelongsToDept(row, dept, jobs) {
        if (!dept || !row) return true;
        const want = String(dept).toUpperCase();
        const rowDept = String(row.department || '').trim().toUpperCase();
        if (rowDept && rowDept !== 'ALL' && rowDept === want) return true;
        const jobList = jobs || state._allJobs || state.jobs || [];
        const jobId = row.maintenance_job_id;
        const code = row.job_code || row.pms_job_code;
        const job = jobId
            ? jobList.find(j => j.id === jobId)
            : (code ? jobList.find(j => j.job_code === code) : null);
        if (job?.department === want) return true;
        if (!rowDept || rowDept === 'ALL') return false;
        return rowDept === want;
    }

    function isMasterHubMode() {
        return !!(state.user && typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(state.user));
    }

    /** Captain Hub / HQ may report the viewed department, not only user.department. */
    function canReportJobDepartment(user, dept) {
        if (!dept) return true;
        if (typeof TVC_Space !== 'undefined' && TVC_Space.canAccessDepartment(user, dept)) return true;
        return TVC_RBAC.canAccessDepartment(user, dept);
    }

    function currentViewDepartment() {
        return String(state.department || state.user?.department || '').toUpperCase();
    }

    function jobInCurrentViewDept(jobOrId) {
        const job = typeof jobOrId === 'string' ? resolveJobById(jobOrId) : jobOrId;
        if (!job) return false;
        const view = currentViewDepartment();
        if (!view) return true;
        return String(job.department || '').toUpperCase() === view;
    }

    function clearPlanSelectionOutsideViewDept() {
        if (state.selectedJobId && !jobInCurrentViewDept(state.selectedJobId)) {
            state.selectedJobId = null;
        }
        Object.keys(state.batchSelectedJobs || {}).forEach(id => {
            if (!jobInCurrentViewDept(id)) delete state.batchSelectedJobs[id];
        });
        if (state._wrJobId && !jobInCurrentViewDept(state._wrJobId)) state._wrJobId = null;
        if (state.actualSelectedOnly && !batchSelectedCount()) state.actualSelectedOnly = false;
    }

    function filterWorkPermitsForView(allWorkPermits, allJobs) {
        const user = state.user;
        const rows = allWorkPermits || [];
        if (!user) return rows;
        const jobs = allJobs || state._allJobs || state.jobs || [];
        const isCaptainHub = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user);

        if (!TVC_RBAC.isHqAccount(user) && user.department && !isCaptainHub) {
            return rows.filter(w => workPermitBelongsToDept(w, user.department, jobs));
        }
        if (isCaptainHub) {
            let filtered = rows;
            if (state.department) {
                filtered = filtered.filter(w => workPermitBelongsToDept(w, state.department, jobs));
            }
            return filtered;
        }
        let filtered = rows.filter(w =>
            (w.hq_synced === true || w.visible_in_list !== false)
            && (!state.selectedVesselId || w.vessel_id === state.selectedVesselId)
        );
        if (state.department) {
            filtered = filtered.filter(w => workPermitBelongsToDept(w, state.department, jobs));
        }
        return filtered;
    }

    async function loadData() {
        const allComponents = await TVC_DB.getAll('ship_components');
        let allJobs = await TVC_DB.getAll('maintenance_jobs');
        let allGroups = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        await normalizeGroupDepartments(allJobs, allComponents, allGroups);
        if (typeof TVC_PmsMasterExcel !== 'undefined' && TVC_PmsMasterExcel.applyDeckCatalogNormalization) {
            await TVC_PmsMasterExcel.applyDeckCatalogNormalization(allJobs, allGroups);
        }
        if (typeof TVC_PmsMasterExcel !== 'undefined' && TVC_PmsMasterExcel.applyPmsJobCodeNormalization) {
            await TVC_PmsMasterExcel.applyPmsJobCodeNormalization(allJobs, allGroups);
        }

        const masterVesselIdEarly = (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null))
            || state.user?.vessel_id
            || (typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.getSelectedId() : null)
            || (typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.PILOT_VESSEL_ID : null);
        if (typeof TVC_PmsMasterExcel !== 'undefined' && TVC_PmsMasterExcel.repairDuplicateGroupNumbers && masterVesselIdEarly) {
            for (const dept of ['ENGINE', 'DECK']) {
                const canonical = TVC_PmsMasterExcel.loadCanonicalGroupMap
                    ? await TVC_PmsMasterExcel.loadCanonicalGroupMap(masterVesselIdEarly, dept)
                    : null;
                await TVC_PmsMasterExcel.repairDuplicateGroupNumbers(masterVesselIdEarly, {
                    department: dept,
                    canonicalByNo: canonical || undefined,
                });
            }
            allJobs = await TVC_DB.getAll('maintenance_jobs');
            allGroups = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        }

        state._allJobs = allJobs;
        state._allGroups = allGroups;
        const allReports = await TVC_DB.getAll('daily_work_reports');
        TVC_DataPurge.repairReportJobRefsInRows(allReports, allJobs);
        const allDefects = await TVC_DB.getAll('defect_cases').catch(() => []);
        const deptBackfill = [];
        for (const r of allReports) {
            if (!r.department) {
                const dept = inferReportDepartment(r, allJobs);
                if (dept) {
                    r.department = dept;
                    deptBackfill.push({ store: 'daily_work_reports', row: r });
                }
            }
        }
        for (const d of allDefects) {
            if (!d.department) {
                const code = String(d.pms_job_code || d.job_code || '').trim();
                let dept = null;
                if (code) {
                    const matches = allJobs.filter(j => j.job_code === code);
                    const depts = new Set(matches.map(j => j.department).filter(Boolean));
                    if (depts.size === 1) dept = [...depts][0];
                }
                if (!dept && d.maintenance_job_id) {
                    dept = allJobs.find(j => j.id === d.maintenance_job_id)?.department || null;
                }
                if (dept) {
                    d.department = dept;
                    deptBackfill.push({ store: 'defect_cases', row: d });
                }
            }
        }
        if (deptBackfill.length) {
            Promise.all(deptBackfill.map(({ store, row }) => TVC_DB.put(store, row).catch(() => {})));
        }
        const allWorkPermits = await TVC_DB.getAll('work_permits').catch(() => []);
        state.spares = await TVC_DB.SparePart.listAll().catch(() =>
            TVC_DB.getAll('spare_parts').then(rows => rows.map(TVC_SpareSchema.fromRow)));

        // ENGINE spare inventory.xls — 선박 모드만 (HQ는 선박별 마스터 Import 사용)
        const isHqUserEarly = state.user && TVC_RBAC.isHqAccount(state.user);
        if (!isHqUserEarly && state.spares.length < 500) {
            try {
                const xls = await TVC_Seed.ensureSpareInventoryXls();
                if (xls.loaded) {
                    state.spares = await TVC_DB.SparePart.listAll();
                    state._spareImportMsg = `ENGINE ${xls.stats?.spares || state.spares.length} parts loaded`;
                } else if (xls.error) {
                    state._spareImportMsg = `Import failed: ${xls.error} — SPARE 탭에서 Import XLS 클릭`;
                } else if (xls.fileProtocol) {
                    state._spareImportMsg = 'file:// 모드 — SPARE 탭 Import XLS → data/spare-inventory.xls 선택';
                }
            } catch (e) {
                state._spareImportMsg = `Import failed — SPARE 탭에서 Import XLS 클릭`;
            }
        }

        const masterVesselId = isHqUserEarly
            ? state.selectedVesselId
            : ((await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID).catch(() => null))
                || state.user?.vessel_id
                || (typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.PILOT_VESSEL_ID : null));
        const masterBelongs = (row) => {
            if (!masterVesselId) return !isHqUserEarly;
            const rowVid = String(row?.vessel_id || '').trim();
            // legacy 미태깅 행은 현재 선박으로 간주 (아래에서 stamp)
            if (!rowVid) return true;
            if (typeof TVC_MasterVesselScope !== 'undefined') {
                return TVC_MasterVesselScope.belongs(row, masterVesselId);
            }
            return rowVid === masterVesselId;
        };
        const scopedJobs = allJobs.filter(masterBelongs);
        const scopedGroups = allGroups.filter(masterBelongs);
        const scopedComponents = allComponents.filter(masterBelongs);
        // Import/Append 직후 누락 방지 — vessel_id 미태깅 행 보정
        if (masterVesselId) {
            const stampRows = [];
            for (const row of [...scopedJobs, ...scopedGroups, ...scopedComponents]) {
                if (row && !String(row.vessel_id || '').trim()) {
                    row.vessel_id = masterVesselId;
                    stampRows.push(row);
                }
            }
            if (stampRows.length) {
                const jobsToStamp = stampRows.filter(r => scopedJobs.includes(r));
                const groupsToStamp = stampRows.filter(r => scopedGroups.includes(r));
                const compsToStamp = stampRows.filter(r => scopedComponents.includes(r));
                Promise.all([
                    jobsToStamp.length ? TVC_DB.bulkPut('maintenance_jobs', jobsToStamp) : null,
                    groupsToStamp.length ? TVC_DB.bulkPut('maintenance_groups', groupsToStamp) : null,
                    compsToStamp.length ? TVC_DB.bulkPut('ship_components', compsToStamp) : null,
                ].filter(Boolean)).catch(() => {});
            }
        }
        state.spares = (state.spares || []).filter(masterBelongs);
        state._allJobs = scopedJobs;
        state._allGroups = scopedGroups;
        let allSpareGroups = await TVC_DB.getAll('spare_groups').catch(() => []);
        if (typeof TVC_SpareGroups !== 'undefined') {
            allSpareGroups = await TVC_SpareGroups.ensureSeeded({
                vesselId: masterVesselId,
                spares: state.spares,
                maintenanceGroups: scopedGroups,
            });
        }
        const scopedSpareGroups = allSpareGroups.filter(masterBelongs);
        state._allSpareGroups = scopedSpareGroups;

        const isCaptainHub = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(state.user);
        if (state.user && !TVC_RBAC.isHqAccount(state.user) && state.user.department && !isCaptainHub) {
            const dept = state.user.department;
            state.jobs = scopedJobs.filter(j => j.department === dept);
            state.components = scopedComponents.filter(c => !c.path || c.path[0] === dept);
            state.groups = scopedGroups.filter(g => g.department === dept);
            state.spareGroups = scopedSpareGroups.filter(g => g.department === dept);
            const deptCodes = new Set(state.jobs.map(j => j.job_code));
            state.reports = allReports.filter(r => TVC_WorkReport.belongsToJobCodeSet(r, deptCodes));
            state.defectCases = allDefects.filter(d => TVC_DefectCase.belongsToDepartment(d, dept));
            state._allWorkPermits = allWorkPermits;
            state.workPermits = filterWorkPermitsForView(allWorkPermits, scopedJobs);
        } else if (isCaptainHub) {
            state.jobs = scopedJobs;
            state.components = scopedComponents;
            state.groups = scopedGroups;
            state.spareGroups = scopedSpareGroups;
            state.reports = allReports;
            state.defectCases = allDefects;
            state._allWorkPermits = allWorkPermits;
            state.workPermits = filterWorkPermitsForView(allWorkPermits, scopedJobs);
        } else {
            state.jobs = scopedJobs;
            state.components = scopedComponents;
            state.groups = scopedGroups;
            state.spareGroups = scopedSpareGroups;
            // HQ: Import된 리포트(hq_synced) + HQ에서 직접 작성한 리포트도 Work History에 표시
            //  (선박 Export → HQ Import 시 hq_synced/vessel_id 태깅; 로컬 HQ 작성분은 여기서 보정)
            const hqRole = TVC_RBAC.Role?.HQ_SUPERVISOR || 'HQ_SUPERVISOR';
            const hqRepair = [];
            for (const r of allReports) {
                const hqAuthored = r.reporter_role === hqRole;
                const imported = r.sync_status === 'SYNCED'
                    && r.vessel_id
                    && (!state.selectedVesselId || r.vessel_id === state.selectedVesselId);
                if (!r.hq_synced && !hqAuthored && !imported) continue;
                let changed = false;
                if (r.hq_synced !== true && (hqAuthored || imported)) {
                    r.hq_synced = true;
                    changed = true;
                }
                if (hqAuthored && !r.vessel_id && state.selectedVesselId) {
                    r.vessel_id = state.selectedVesselId;
                    changed = true;
                }
                if (changed) hqRepair.push(r);
            }
            if (hqRepair.length) {
                Promise.all(hqRepair.map(r => TVC_DB.put('daily_work_reports', r).catch(() => {})));
            }
            state.reports = allReports.filter(r =>
                r.hq_synced === true &&
                (!state.selectedVesselId || r.vessel_id === state.selectedVesselId
                    || (r.reporter_role === hqRole && !r.vessel_id))
            );
            state.defectCases = allDefects.filter(d =>
                (d.hq_synced === true
                    || d.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
                    || d.status === TVC_DefectCase.Status.AWAITING_COMPLETION
                    || (d.status === TVC_DefectCase.Status.DRAFT && d.visible_in_list !== false)) &&
                (!state.selectedVesselId || d.vessel_id === state.selectedVesselId)
            );
            state.workPermits = filterWorkPermitsForView(allWorkPermits, scopedJobs);
            state._allWorkPermits = allWorkPermits;
        }
        state.reports.forEach(r => TVC_WorkReport.fromLegacy(r));
        await applyActiveReportSchedules();
        await applyDefectClearedSchedules();
        state.idx = TVC_Indexes.build(state);
        if (state.selectedGroupKey && TVC_Indexes.rematchGroupKey) {
            state.selectedGroupKey = TVC_Indexes.rematchGroupKey(
                state.selectedGroupKey,
                state.idx.groupNodes
            );
        }
        assertDeptIsolation();
        await backfillOriginalNextDates(state.jobs);
        // run-hour 미적용 작업 — Original Plan 기준 Due Date 스냅샷
        for (const job of state.jobs) {
            if (!job.original_next_date && job.next_date && job.schedule_basis !== 'RUN_HOUR') {
                job.original_next_date = job.next_date;
            }
        }
        await loadOriginalPlanLock();
        const lockDept = state.user && !TVC_RBAC.isHqAccount(state.user) ? state.user.department : null;
        if (!lockDept || !isOriginalPlanUpdateLocked(lockDept)) {
            try {
                if (!state._skipRhRecalcOnce) {
                    await TVC_PMS.updateMaintenanceSchedule(state, { silent: true });
                }
            } catch (e) { console.warn('[TVC_PMS] schedule recalc skipped:', e); }
        }
        clearActualFilterKeysCache();
        state._outstandingReqLoaded = false;
        state._outstandingReqCache = null;
        try {
            const consumeVesselId = masterVesselId || state.user?.vessel_id || null;
            const consumeLogs = consumeVesselId
                ? await TVC_Inventory.listConsumeLogs(consumeVesselId).catch(() => [])
                : await TVC_DB.getAll('consume_logs').catch(() => []);
            state._consumeLogById = Object.fromEntries(
                consumeLogs.filter(masterBelongs).map(l => [String(l.id), l])
            );
        } catch (_) {
            state._consumeLogById = {};
        }
    }

    /** seed JSON 기준 Due Date — run-hour 리셋 시 Original Plan 복원용 */
    async function backfillOriginalNextDates(jobs) {
        const needs = (jobs || []).some(j =>
            TVC_PMS.isRunHourJob(j) && TVC_PMS.isTrackedGroup(j.group) && !j.original_next_date
        );
        if (!needs) return;
        try {
            const res = await fetch('data/pms-unified.json');
            if (!res.ok) return;
            const data = await res.json();
            const byId = new Map((data.maintenance_jobs || []).map(j => [j.id, j.next_date]));
            const byCode = new Map((data.maintenance_jobs || []).map(j => [j.job_code, j.next_date]));
            for (const job of jobs) {
                if (job.original_next_date) continue;
                job.original_next_date = byId.get(job.id) || byCode.get(job.job_code) || job.next_date || null;
            }
        } catch (_) { /* offline / file:// */ }
    }

    /** 선박 계정: 로드된 데이터에 타 부서 항목이 섞이면 즉시 차단(콘솔 경고). */
    function assertDeptIsolation() {
        if (!state.user || TVC_RBAC.isHqAccount(state.user) || !state.user.department) return;
        const dept = state.user.department;
        const jobLeaks = state.jobs.filter(j => j.department !== dept);
        const compLeaks = state.components.filter(c => c.path?.[0] && c.path[0] !== dept);
        if (jobLeaks.length || compLeaks.length) {
            console.error(`[TVC] 부서 격리 위반 (${dept}): jobs=${jobLeaks.length}, components=${compLeaks.length}`);
        }
    }

    async function onLogin(user) {
        const role = user.role || TVC_RBAC.resolveUserRole(user);
        state.user = role && role !== user.role ? { ...user, role } : user;
        const isSuperHq = TVC_RBAC.isSuperHqAccount?.(state.user);
        const isHq = TVC_RBAC.isHqAccount(state.user);
        // HQ ↔ Ship data stays isolated until Export/Import (ZIP or cloud sync storage).
        state.space = isHq ? 'HQ' : 'SHIP';
        state.isSuperHq = isSuperHq;
        state.station = state.user.station || null;
        if (isHq) {
            const savedDept = localStorage.getItem('tvc_hq_dept_view');
            state.department = (savedDept === 'ENGINE' || savedDept === 'DECK') ? savedDept : 'DECK';
        } else {
            state.department = TVC_Space.isCaptainHub(state.user)
                ? 'DECK'
                : (state.user.department || 'ENGINE');
        }
        state.captainView = state.department === 'ENGINE' ? 'engine' : 'deck';
        state.selectedGroupKey = null;
        state.spareSelectedGroupKey = null;
        state.search = '';
        updateUserBar(state.user);
        if (isHq) {
            if (isSuperHq) {
                state.adminSearch = state.adminSearch || '';
                try {
                    await TVC_AdminRegistry.load();
                    const sel = TVC_AdminRegistry.getSelected();
                    if (sel.companyId) {
                        state.selectedAdminCompanyId = sel.companyId;
                        state.selectedAdminVesselId = sel.vesselId || null;
                        state.adminCompanyFilter = sel.companyId;
                    } else {
                        state.adminCompanyFilter = ADMIN_COMPANY_FILTER_ALL;
                        state.selectedAdminCompanyId = null;
                        state.selectedAdminVesselId = null;
                    }
                    if (typeof TVC_Fleet.syncFromAdminRegistry === 'function') {
                        TVC_Fleet.syncFromAdminRegistry();
                    }
                    if (typeof TVC_AccountProvisioning !== 'undefined') {
                        await TVC_AccountProvisioning.syncRegistryToUsers();
                    }
                } catch (e) {
                    console.warn('[TVC_AdminRegistry]', e);
                    await TVC_Dialog.alert('Admin registry (admin/registry.json) load failed.\n' + (e.message || e));
                }
            }
            await TVC_Fleet.ensureFleet();
            state.fleet = TVC_Fleet.getVisible(state.user);
            let sel = TVC_Fleet.getSelectedId();
            if (!state.fleet.some(v => v.id === sel)) sel = state.fleet[0]?.id || null;
            state.selectedVesselId = sel;
            if (sel) TVC_Fleet.select(sel);
            if (isSuperHq) {
                state.fleetCompanyFilter = state.fleetCompanyFilter || ADMIN_COMPANY_FILTER_ALL;
            } else if (TVC_RBAC.isCompanyHqAccount?.(state.user)) {
                state.fleetCompanyFilter = String(state.user.company_id || TVC_Fleet.licenseCompanyId()).trim();
            } else {
                state.fleetCompanyFilter = ADMIN_COMPANY_FILTER_ALL;
            }
            TVC_PMS.setSpace('HQ', state.selectedVesselId);
            await loadData();
        } else {
            TVC_PMS.setSpace('SHIP');
            await loadData();
        }
        applyRoleUi(state.user);
        renderDeptToggles(state.user);
        renderCaptainViewDashboard();
        if (isHq) await populateShipHeader(state.user);
        showApp();
        try { TVC_Config?.applyEmbedChrome?.(); } catch (_) {}
        switchTab('menu');
    }

    // ── View shell ───────────────────────────────────────────────────
    function showLogin() {
        document.getElementById('appShell')?.classList.add('hidden');
        document.getElementById('loginScreen')?.classList.remove('hidden');
        setLoginBusy(false);
        syncWindowTitle(null);
    }
    function showApp() {
        document.getElementById('loginScreen')?.classList.add('hidden');
        document.getElementById('appShell')?.classList.remove('hidden');
    }

    const TAB_RENDERERS = {
        menu: renderMainMenu,
        actual: renderActualPlan,
        history: renderWorkHistory,
        spare: renderSpareMenu,
    };

    /** 상단 탭 전환 — 부서 필터 상태는 그대로 유지된다. */
    function switchTab(tab) {
        if (!TABS.includes(tab)) tab = 'menu';
        if (tab === 'spare' && state.user && typeof TVC_Space !== 'undefined'
            && !TVC_Space.getUiFeatures(state.user).showSpareTab) {
            tab = 'menu';
        }
        TVC_ListFilters?.closePopover();
        if (tab !== 'actual') state.actualSelectedOnly = false;
        if (state.currentTab === 'history' && tab !== 'history' && state.listFilters.history) {
            Object.assign(state.listFilters.history, {
                groupKeys: [], type: 'all', openOnly: false, noClosedOut: false, postponeAwaitingApproval: false,
            });
        }
        state.currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById('tab-' + tab)?.classList.remove('hidden');
        if (state.user) { applyRoleUi(state.user); renderDeptToggles(state.user); }
        (TAB_RENDERERS[tab] || renderMainMenu)();
        syncListFilterBtns();
        window.scrollTo(0, 0);
        if (typeof TVC_PWA !== 'undefined') TVC_PWA.closeMobileNav();
        requestAnimationFrame(() => bindTabSearchClearInputs());
    }

    /** legacy alias */
    function navigate(view) {
        const map = { menu: 'menu', dashboard: 'actual', workplan: 'actual' };
        switchTab(map[view] || view);
    }

    function rerenderCurrentTab() { (TAB_RENDERERS[state.currentTab] || renderMainMenu)(); }

    // ── Header / role UI ─────────────────────────────────────────────
    const WINDOW_TITLE_BASE = 'THE VESSEL CODE — TVC-PMS';

    function resolveWindowTitleSuffix(user) {
        if (!user) return '';
        if (TVC_RBAC.isHqAccount(user)) return 'HQ';
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)) return 'MASTER';
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isDeckVesselMode(user)) return 'DECK';
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isEngineVesselMode(user)) return 'ENGINE';
        const dept = String(user.department || '').toUpperCase();
        if (dept === 'DECK') return 'DECK';
        if (dept === 'ENGINE') return 'ENGINE';
        return '';
    }

    function syncWindowTitle(user) {
        const suffix = resolveWindowTitleSuffix(user);
        document.title = suffix ? `${WINDOW_TITLE_BASE} ${suffix}` : WINDOW_TITLE_BASE;
    }

    function updateUserBar(user) {
        const badge = typeof TVC_Space !== 'undefined'
            ? TVC_Space.getModeBadge(user)
            : (TVC_RBAC.isSuperHqAccount?.(user)
                ? 'HQ Admin'
                : (TVC_RBAC.isHqAccount(user)
                    ? 'HQ Mode'
                    : (user.department === 'DECK' ? 'Vessel Mode - Deck'
                        : user.department === 'ENGINE' ? 'Vessel Mode - Engine'
                            : 'Vessel Mode')));
        const title = TVC_RBAC.getAccountTitle(user.username);
        document.querySelectorAll('.userBadgeEl').forEach(el => el.textContent = badge);
        document.querySelectorAll('.userNameEl').forEach(el => el.textContent = title);
        document.querySelectorAll('.userVesselEl').forEach(el => {
            if (TVC_RBAC.isSuperHqAccount?.(user)) {
                el.textContent = 'All companies';
                return;
            }
            if (!user.vessel_id) { el.textContent = 'Head Office'; return; }
            const v = TVC_Fleet.resolveById(user.vessel_id);
            el.textContent = v ? `Vessel: ${v.id}` : `Vessel: ${user.vessel_id}`;
        });
        if (TVC_RBAC.isHqAccount(user)) populateShipHeader(user);
        syncWindowTitle(user);
    }

    async function populateShipHeader(user) {
        let vessel = null;
        if (TVC_RBAC.isHqAccount(user)) {
            const visible = typeof TVC_Fleet.getVisible === 'function'
                ? TVC_Fleet.getVisible(user)
                : (state.fleet || []);
            vessel = visible.find(v => v.id === state.selectedVesselId)
                || visible[0]
                || TVC_Fleet.getSelected();
        } else {
        let vesselId = user.vessel_id;
        if (!vesselId) { try { vesselId = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID); } catch (_) {} }
            if (vesselId) {
                vessel = TVC_Fleet.resolveById(vesselId);
                const hasDelivery = vessel?.delivery && vessel.delivery !== '—';
                if (!hasDelivery) {
                    try {
                        const init = await TVC_DB.getMeta(TVC_META_KEYS.DB_INIT);
                        if (init) vessel.delivery = String(init).slice(0, 10);
                    } catch (_) {}
                }
            }
        }
        if (vessel) {
            setText('cmaxsShipName', vessel.id);
            setText('cmaxsShipCode', vessel.imo_no || vessel.code || '—');
            setText('cmaxsShipDelivery', vessel.delivery || '—');
        } else {
            setText('cmaxsShipName', 'HEAD OFFICE (Fleet View)');
            setText('cmaxsShipCode', 'HQ');
            setText('cmaxsShipDelivery', '—');
        }
    }

    function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }

    function applyRoleUi(user) {
        const f = typeof TVC_Space !== 'undefined' ? TVC_Space.getUiFeatures(user) : TVC_RBAC.getUiFeatures(user);
        document.querySelectorAll('[data-feature]').forEach(el => {
            if (el.classList.contains('tab-pane')) return;
            el.classList.toggle('hidden', !f[el.dataset.feature]);
        });
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const tab = btn.dataset.tab;
            if (!tab || tab === 'menu') {
                btn.classList.remove('hidden');
                return;
            }
            const feat = btn.dataset.feature;
            btn.classList.toggle('hidden', !!(feat && !f[feat]));
        });
        const dash = document.getElementById('captainViewDashboard');
        if (dash) dash.classList.toggle('hidden', !f.showCaptainDashboard);
        syncPlanGroupTreeUi();
        if (!f.showSpareTab && state.currentTab === 'spare') {
            switchTab('menu');
            return;
        }
        if (!f.showSpareTab && state.historyScope === 'spare') {
            state.historyScope = 'pms';
        }
        const activeTab = state.currentTab || 'menu';
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById('tab-' + activeTab)?.classList.remove('hidden');
    }

    function daysUntil(dateStr) {
        if (!dateStr) return 9999;
        return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
    }

    /** Work Plan — next_date(Due)가 설정 기간 안에 있는지 */
    function isJobInActualPeriod(job) {
        if (!job) return false;
        const from = state.actualPeriodFrom;
        const to = state.actualPeriodTo;
        if (!from && !to) return true;
        const due = (job.next_date || '').slice(0, 10);
        if (!due) return false;
        if (from && due < from) return false;
        if (to && due > to) return false;
        return true;
    }

    function hasActualPeriodFilter() {
        return !!(state.actualPeriodFrom || state.actualPeriodTo);
    }

    function hasReportPeriodFilter() {
        return !!(state.reportPeriodFrom || state.reportPeriodTo);
    }

    function isDateInPeriod(dateStr, from, to) {
        if (!from && !to) return true;
        const d = (dateStr || '').slice(0, 10);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    }

    function defectCaseReportDate(dc) {
        return listReportedDateStr(dc);
    }

    /** Defect Report · Work History 목록 — Reported Date (Occurred/work_date·created_at 날짜와 분리) */
    function listReportedDateStr(record) {
        if (!record) return '';
        const rd = String(record.report_date || '').slice(0, 10);
        if (rd) return rd;
        const fallback = record.created_at || record.submitted_at || '';
        return String(fallback).slice(0, 10);
    }

    function matchReportPeriodDate(dateStr) {
        return isDateInPeriod(dateStr, state.reportPeriodFrom, state.reportPeriodTo);
    }

    // ── Department toggle & global filter ────────────────────────────
    function deptJobs() {
        const dept = String(state.department || state.user?.department || '').toUpperCase();
        const active = (j) => !TVC_Indexes.isDetachedCode?.(j.job_code);
        if (!dept) return state.jobs.filter(active);
        return state.jobs.filter(j => j.department === dept && active(j));
    }

    /** HQ / Captain Hub: Deck / Engine only (no All). Station PC는 고정 부서 라벨만 노출. */
    function renderDeptToggles(user) {
        if (!user) return;
        const canSwitch = typeof TVC_Space !== 'undefined'
            ? TVC_Space.canSwitchDepartmentView(user)
            : TVC_RBAC.isHqAccount(user);
        document.querySelectorAll('.dept-toggle').forEach(group => {
            if (canSwitch) {
                const opts = [{ v: 'DECK', l: 'Deck' }, { v: 'ENGINE', l: 'Engine' }];
            const btns = opts.map(o => {
                const active = state.department === o.v ? ' active' : '';
                    return `<button class="dept-btn${active}" data-dept="${o.v}" onclick="TVC_App.setDepartment('${o.v}')">${o.l}</button>`;
            }).join('');
                group.innerHTML = '<span class="dept-label">Department</span>' + btns;
            } else {
                const modeLbl = user.login_mode && typeof TVC_Space !== 'undefined'
                    ? TVC_Space.loginModeLabel(user.login_mode)
                    : TVC_RBAC.getDeptLabel(user.department);
                group.innerHTML = `<span class="dept-label">Department</span><span class="dept-fixed pill ok">${modeLbl} 🔒</span>`;
            }
        });
    }

    /** HQ · Master Hub: Import/Export 시 DECK/ENGINE을 명시적으로 고른다. Station(C/E·C/O)은 자기 부서로 자동 확정. */
    function accountNeedsDeptPick(user) {
        if (!user) return false;
        if (TVC_RBAC.isHqAccount(user)) return true;
        return typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user);
    }

    function pickDepartmentThen(title, cb) {
        if (!accountNeedsDeptPick(state.user)) {
            const dept = state.user?.department || state.department || null;
            if (cb) cb(dept);
            return Promise.resolve(dept);
        }
        return new Promise((resolve) => {
            const hideMenuXfer = isModalOpen('menuXferModal');
            if (hideMenuXfer) {
                closeModal('menuXferModal');
                state._deptPickRestoreMenuXfer = true;
            }
            state._deptPickResolve = (dept) => {
                if (!dept && state._deptPickRestoreMenuXfer) {
                    state._deptPickRestoreMenuXfer = false;
                    showModal('menuXferModal');
                } else if (dept) {
                    state._deptPickRestoreMenuXfer = false;
                }
                if (cb) cb(dept);
                resolve(dept || null);
            };
            setText('deptPickTitle', title);
            showModal('deptPickModal');
        });
    }

    function resolveDeptPick(dept) {
        const cb = state._deptPickResolve;
        state._deptPickResolve = null;
        closeModal('deptPickModal');
        if (cb) cb(dept);
    }

    async function pickImportDepartment() {
        const title = 'Select a department to import (DECK / ENGINE)';
        if (!accountNeedsDeptPick(state.user)) {
            return state.user?.department || null;
        }
        const dept = await pickDepartmentThen(title);
        if (!dept) return null;
        if (isMasterHubMode() && dept !== state.department) {
            await setDepartment(dept);
        }
        return dept;
    }

    async function setDepartment(dept) {
        const canSwitch = state.user && (typeof TVC_Space !== 'undefined'
            ? TVC_Space.canSwitchDepartmentView(state.user)
            : TVC_RBAC.isHqAccount(state.user));
        if (state.user && !canSwitch && dept !== state.user.department) {
            await TVC_Dialog.alert('This account is restricted to the ' + TVC_RBAC.getDeptLabel(state.user.department) + ' department.');
            return;
        }
        state.department = dept;
        state.captainView = dept === 'DECK' ? 'deck' : 'engine';
        if (state.user && TVC_RBAC.isHqAccount(state.user)) {
            try { localStorage.setItem('tvc_hq_dept_view', dept); } catch (_) {}
        }
        state.selectedGroupKey = null;
        state.spareSelectedGroupKey = null;
        clearPlanSelectionOutsideViewDept();
        if (state._allWorkPermits) {
            state.workPermits = filterWorkPermitsForView(state._allWorkPermits);
        }
        renderDeptToggles(state.user);
        renderCaptainViewDashboard();
        rerenderCurrentTab();
    }

    function setCaptainView(view) {
        state.captainView = view;
        if (view === 'deck') setDepartment('DECK');
        else if (view === 'engine') setDepartment('ENGINE');
    }

    /** Captain Hub — Deck / Engine 모니터링 대시보드 */
    function renderCaptainViewDashboard() {
        const host = document.getElementById('captainViewDashboard');
        if (!host || !state.user) return;
        const f = typeof TVC_Space !== 'undefined' ? TVC_Space.getUiFeatures(state.user) : {};
        if (!f.showCaptainDashboard) {
            host.innerHTML = '';
            host.classList.add('hidden');
            return;
        }
        if (!TVC_Space.isCaptainHub(state.user)) return;

        const c = menuCounts();
        const deckPending = state.reports.filter(r => repSt(r) === 'REPORTED' && reportDept(r) === 'DECK').length;
        const engPending = state.reports.filter(r => repSt(r) === 'REPORTED' && reportDept(r) === 'ENGINE').length;
        const deckJobs = state.jobs.filter(j => j.department === 'DECK');
        const engJobs = state.jobs.filter(j => j.department === 'ENGINE');
        const v = state.captainView || 'deck';

        host.innerHTML = `
            <div class="captain-dash-head">
                <span class="captain-dash-title">⚓ Captain Hub — Vessel Overview</span>
                <span class="captain-dash-sub">Deck / Engine 구역 모니터링</span>
            </div>
            <div class="captain-view-tabs" role="tablist" aria-label="Vessel view">
                <button type="button" class="captain-view-btn${v === 'engine' ? ' active' : ''}" onclick="TVC_App.setCaptainView('engine')">Engine</button>
                <button type="button" class="captain-view-btn${v === 'deck' ? ' active' : ''}" onclick="TVC_App.setCaptainView('deck')">Deck</button>
            </div>
            <div class="captain-view-stats">
                <div class="captain-stat-card"><span class="captain-stat-num">${c.total}</span><span class="captain-stat-lbl">Jobs (filtered)</span></div>
                <div class="captain-stat-card warn"><span class="captain-stat-num">${c.pending}</span><span class="captain-stat-lbl">Confirm Pending</span></div>
                <div class="captain-stat-card engine"><span class="captain-stat-num">${engPending}</span><span class="captain-stat-lbl">Engine Pending</span></div>
                <div class="captain-stat-card deck"><span class="captain-stat-num">${deckPending}</span><span class="captain-stat-lbl">Deck Pending</span></div>
                <div class="captain-stat-card"><span class="captain-stat-num">${engJobs.length}</span><span class="captain-stat-lbl">Engine Jobs</span></div>
                <div class="captain-stat-card"><span class="captain-stat-num">${deckJobs.length}</span><span class="captain-stat-lbl">Deck Jobs</span></div>
            </div>`;
    }

    // ── Shared job-id computation ────────────────────────────────────
    function sortIds(ids) {
        const { field, asc } = state.jobSort;
        const dir = asc ? 1 : -1;
        return ids.sort((a, b) => {
            const ja = state.idx.jobById.get(a), jb = state.idx.jobById.get(b);
            if (!ja || !jb) return 0;
            // All departments / All groups — keep DECK·ENGINE blocks and group order before job_code.
            if (!state.department) {
                const deptRank = (d) => (d === 'DECK' ? 0 : d === 'ENGINE' ? 1 : 9);
                const dc = deptRank(ja.department) - deptRank(jb.department);
                if (dc) return dc;
            }
            if (!state.selectedGroupKey) {
                const gc = String(ja.group || '').localeCompare(String(jb.group || ''), undefined, { numeric: true });
                if (gc) return gc;
            }
            const va = ja[field] ?? '', vb = jb[field] ?? '';
            return dir * String(va).localeCompare(String(vb), undefined, { numeric: true });
        });
    }

    function matchSearch(j) {
        const q = state.search;
        if (!q) return true;
        return (j.job_code || '').toLowerCase().includes(q)
            || (j.job_detail || '').toLowerCase().includes(q)
            || (j.item_sort2 || '').toLowerCase().includes(q)
            || (j.item_sort1 || '').toLowerCase().includes(q);
    }

    function isHistDefectEntry(entry) {
        return entry?.source === 'defect';
    }

    function isHistPermitEntry(entry) {
        return entry?.source === 'permit';
    }

    function isHistConsumeEntry(entry) {
        return entry?.source === 'consume';
    }

    function histConsumeRowKey(logId) {
        return `COS|${logId}`;
    }

    function consumeHistoryFields(log) {
        if (typeof TVC_SpareMenu?.consumeHistoryFields === 'function') {
            return TVC_SpareMenu.consumeHistoryFields(log, state);
        }
        return {
            fileNo: String(log?.file_no || '').trim(),
            jobCode: String(log?.job_code || '').trim(),
            sort1: String(log?.sort1 || '').trim(),
            sort2: String(log?.sort2 || '').trim(),
            date: String(log?.made_on || log?.consumed_date || '').slice(0, 10),
            status: '',
            spareData: Number(log?.line_count) || (log?.lines || []).length || 0,
        };
    }

    function histRowKey(reportId, jobId) {
        return `${reportId}|${jobId}`;
    }

    function histDefectRowKey(defectId) {
        return `DEF|${defectId}`;
    }

    function histPermitRowKey(permitId) {
        return `WP|${permitId}`;
    }

    function histEntryRowKey(entry) {
        if (isHistPermitEntry(entry)) return histPermitRowKey(entry.permit?.id);
        if (isHistConsumeEntry(entry)) return histConsumeRowKey(entry.consume?.id);
        if (isHistDefectEntry(entry)) {
            if (entry.isDefectBatchSummary) return `DEFBATCH|${entry.defect.id}`;
            return histDefectRowKey(entry.defect.id);
        }
        if (entry.isBatchSummary) return `BATCH|${entry.report.id}`;
        return histRowKey(entry.report.id, entry.item.maintenance_job_id);
    }

    function histPrimaryJob(entry) {
        if (isHistConsumeEntry(entry)) return null;
        if (isHistPermitEntry(entry)) {
            const row = entry.permit;
            const jobId = row?.maintenance_job_id || (row?.job_items || [])[0]?.maintenance_job_id;
            if (jobId && state.idx?.jobById.get(jobId)) return state.idx.jobById.get(jobId);
            const code = row?.job_code || row?.pms_job_code || (row?.job_items || [])[0]?.job_code;
            return code ? (state.jobs.find(j => j.job_code === code) || null) : null;
        }
        if (isHistDefectEntry(entry)) {
            if (entry.isDefectBatchSummary) {
                const primary = defectPrimaryJobItem(entry.defect);
                return state.idx?.jobById.get(primary?.maintenance_job_id)
                    || state.jobs.find(j => j.job_code === primary?.job_code)
                    || null;
            }
            return null;
        }
        const { report: r, item } = entry;
        if (!r) return null;
        if (entry.isBatchSummary) {
            const primary = TVC_WorkReport.primaryJobItem(r);
            return state.idx?.jobById.get(primary?.maintenance_job_id)
                || state.jobs.find(j => j.job_code === primary?.job_code)
                || null;
        }
        return state.idx?.jobById.get(item?.maintenance_job_id)
            || state.jobs.find(j => j.job_code === item?.job_code)
            || null;
    }

    function histDisplayJobCode(entry) {
        if (isHistConsumeEntry(entry)) {
            return consumeHistoryFields(entry.consume).jobCode || '';
        }
        if (isHistPermitEntry(entry)) {
            const cols = workPermitHistoryColumns(entry.permit || {});
            return cols.jobCode || '';
        }
        if (isHistDefectEntry(entry)) {
            if (entry.isDefectBatchSummary || defectIsBatch(entry.defect)) {
                return defectPrimaryJobItem(entry.defect)?.job_code || defectEffectiveJobCode(entry.defect) || '';
            }
            return entry.defect?.pms_job_code || entry.defect?.job_code || defectEffectiveJobCode(entry.defect) || '';
        }
        const { report: r, item } = entry;
        if (r?.is_batch) {
            return TVC_WorkReport.primaryJobItem(r)?.job_code || item?.job_code || '';
        }
        return item?.job_code || '';
    }

    function histEntryHasReportedItem(entry) {
        if (isHistPermitEntry(entry) || isHistDefectEntry(entry) || isHistConsumeEntry(entry)) return false;
        if (entry.isBatchSummary) {
            return TVC_WorkReport.getJobItems(entry.report).some(i => itemSt(i) === 'REPORTED');
        }
        return itemSt(entry.item) === 'REPORTED';
    }

    function formatHistGroupLabel(v) {
        return TVC_SpareMenu?.safeTreeLabel?.(v) || String(v || '').trim();
    }

    /** PMS Group → Work History Job Code (번호만, 예: "01. MAIN ENGINE" → "01") */
    function formatHistGroupNoShort(v) {
        const s = String(v || '').trim();
        if (!s) return '';
        const m = s.match(/^(\d+(?:\s*~\s*\d+)?)/);
        return m ? m[1].replace(/\s+/g, '') : s;
    }

    /** PMS Group → 장비명 (예: "06. EMERGENCY GENERATOR…" → "EMERGENCY GENERATOR…") */
    function formatHistGroupEquipmentName(v) {
        const label = formatHistGroupLabel(v);
        if (!label) return '';
        const m = label.match(/^\d+(?:\s*~\s*\d+)?\.\s*(.+)$/);
        return m ? m[1].trim() : label;
    }

    function histTypeMarker(entry) {
        if (isHistPermitEntry(entry)) {
            return { letter: 'W', title: 'Work Permit', cls: 'hist-type-wp' };
        }
        if (isHistConsumeEntry(entry)) {
            return { letter: 'C', title: 'Consumption Report', cls: 'hist-type-consume' };
        }
        if (isHistDefectEntry(entry)) {
            return { letter: 'D', title: 'Defect Report', cls: 'hist-type-defect' };
        }
        if (entry.report?.work_type === 'POSTPONE') {
            return { letter: 'P', title: 'Postponed Report', cls: 'hist-type-postpone' };
        }
        return { letter: 'M', title: 'Maintenance Report', cls: 'hist-type-maint' };
    }

    function histTypeLetter(raw) {
        return String(raw || '').replace(/\./g, '').charAt(0);
    }

    function histTypeCell(entry) {
        const m = histTypeMarker(entry);
        const letter = histTypeLetter(m.letter);
        if (!letter) return '<td class="hist-type"></td>';
        return `<td class="hist-type ${m.cls}" title="${escAttr(m.title)}"><span class="hist-type-mark">${esc(letter)}</span></td>`;
    }

    function histCriticalCell(entry) {
        let show = false;
        if (isHistPermitEntry(entry)) {
            const job = histPrimaryJob(entry);
            show = !!(job && jobShowsCriticalEquipmentMark(job));
        } else if (isHistConsumeEntry(entry)) {
            show = false;
        } else if (isHistDefectEntry(entry)) {
            show = defectShowsCriticalEquipmentMark(entry.defect);
        } else {
            const job = state.idx?.jobById.get(entry.item.maintenance_job_id)
                || state.jobs.find(j => j.job_code === entry.item.job_code);
            show = !!(job && jobShowsCriticalEquipmentMark(job));
        }
        if (!show) return '<td class="hist-crit" aria-hidden="true"></td>';
        return `<td class="hist-crit" title="Critical Equipment">${planCriticalMarkHtml()}</td>`;
    }

    function printHistCriticalMark(entry) {
        if (isHistPermitEntry(entry)) {
            const job = histPrimaryJob(entry);
            return job && jobShowsCriticalEquipmentMark(job) ? '⚠' : '';
        }
        if (isHistDefectEntry(entry)) {
            return defectShowsCriticalEquipmentMark(entry.defect) ? '⚠' : '';
        }
        if (isHistConsumeEntry(entry)) return '';
        const job = state.idx?.jobById.get(entry.item.maintenance_job_id)
            || state.jobs.find(j => j.job_code === entry.item.job_code);
        return job && jobShowsCriticalEquipmentMark(job) ? '⚠' : '';
    }

    function isPlaceholderJobCode(code) {
        const s = String(code || '').trim();
        if (!s) return true;
        return /JOB CODE\s*(선택|选择)/i.test(s) || /^Select JOB CODE$/i.test(s);
    }

    /** job_code lookup — always prefer group then department (ENGINE·DECK may share codes). */
    function resolveJobByCode(code, department, groupLabel) {
        const c = String(code || '').trim();
        if (!c) return null;
        const dept = String(department || '').trim().toUpperCase();
        const skipDept = !dept || dept === 'MASTER' || dept === 'HQ' || dept === 'ADMIN';
        const groupWant = String(groupLabel || '').replace(/\s+/g, '').toLowerCase();
        const pools = [];
        if (state.idx?.jobById) pools.push([...state.idx.jobById.values()]);
        if (state.jobs?.length) pools.push(state.jobs);
        if (state._allJobs?.length) pools.push(state._allJobs);
        if (groupWant) {
            for (const pool of pools) {
                const hit = pool.find(j => j.job_code === c
                    && String(j.group || '').replace(/\s+/g, '').toLowerCase() === groupWant);
                if (hit) return hit;
            }
        }
        if (!skipDept) {
            for (const pool of pools) {
                const hit = pool.find(j => j.job_code === c && String(j.department || '').toUpperCase() === dept);
                if (hit) return hit;
            }
        }
        for (const pool of pools) {
            const hit = pool.find(j => j.job_code === c);
            if (hit) return hit;
        }
        return null;
    }

    function defectEffectiveJobCode(dc) {
        const items = dc?.job_items;
        if (Array.isArray(items)) {
            const fromItems = items.map(i => String(i.job_code || '').trim()).find(c => c && !isPlaceholderJobCode(c));
            if (fromItems) return fromItems;
        }
        const code = String(dc.pms_job_code || dc.job_code || '').trim();
        return isPlaceholderJobCode(code) ? '' : code;
    }

    function defectBatchJobItems(dc) {
        return (dc?.job_items || []).filter(i => {
            const c = String(i.job_code || '').trim();
            return c && !isPlaceholderJobCode(c);
        });
    }

    function defectIsBatch(dc) {
        return defectBatchJobItems(dc).length > 1;
    }

    function defectPrimaryJobItem(dc) {
        const items = defectBatchJobItems(dc);
        if (!items.length) return null;
        return [...items].sort((a, b) => TVC_WorkReport.compareJobCodes(a.job_code, b.job_code))[0];
    }

    function defectCaseMatchesJob(dc, job) {
        if (!dc || !job) return false;
        if ((dc.job_items || []).some(it =>
            (it.maintenance_job_id && it.maintenance_job_id === job.id)
            || (it.job_code && it.job_code === job.job_code)
        )) return true;
        if (dc.maintenance_job_id === job.id) return true;
        return defectEffectiveJobCode(dc) === job.job_code;
    }

    function defectHistoryColumnsForJob(dc, job) {
        const item = (dc?.job_items || []).find(it =>
            (it.maintenance_job_id && it.maintenance_job_id === job.id)
            || (it.job_code && it.job_code === job.job_code)
        );
        if (item) {
            const j = state.idx?.jobById.get(item.maintenance_job_id || job.id)
                || resolveJobByCode(item.job_code, dc?.department)
                || job;
            return {
                jobCode: item.job_code || j?.job_code || '',
                sort1: item.sort1 || j?.item_sort1 || '',
                sort2: item.sort2 || j?.item_sort2 || '',
                jobDetail: item.job_detail || dc.outline_maintenance_request || j?.job_detail || '',
                groupOnly: false,
            };
        }
        return defectHistoryColumns(dc);
    }

    function defectHistoryHasJob(dc) {
        if ((dc?.job_items || []).some(i => {
            const c = String(i.job_code || '').trim();
            return (c && !isPlaceholderJobCode(c)) || String(i.maintenance_job_id || '').trim();
        })) return true;
        if (defectEffectiveJobCode(dc)) return true;
        return !!String(dc.maintenance_job_id || '').trim();
    }

    /** Defect Case → Defect List / Work History columns (group-only: Group No→Job Code, 장비명→SORT-1, Job Name→SORT-2) */
    function defectHistoryColumns(dc) {
        if (defectHistoryHasJob(dc)) {
            const job = state.idx?.jobById.get(dc.maintenance_job_id)
                || resolveJobByCode(defectEffectiveJobCode(dc), dc.department);
            const jobCode = defectEffectiveJobCode(dc) || job?.job_code || '';
            return {
                jobCode,
                sort1: dc.item_sort1 || job?.item_sort1 || '',
                sort2: dc.item_sort2 || job?.item_sort2 || '',
                jobDetail: dc.job_detail || dc.outline_maintenance_request || job?.job_detail || '',
                groupOnly: false,
            };
        }
        const jobName = String(dc.job_name || '').trim();
        const equipName = formatHistGroupEquipmentName(dc.pms_group_no)
            || (String(dc.machinery_name || '').trim() !== jobName ? String(dc.machinery_name || '').trim() : '');
        if (dc.pms_group_no) {
            return {
                jobCode: formatHistGroupNoShort(dc.pms_group_no),
                sort1: equipName,
                sort2: jobName,
                jobDetail: dc.outline_maintenance_request || dc.action_taken || '',
                groupOnly: true,
            };
        }
        return {
            jobCode: '',
            sort1: equipName || jobName,
            sort2: jobName && equipName ? jobName : '',
            jobDetail: dc.outline_maintenance_request || '',
            groupOnly: false,
        };
    }

    function defectHistoryStatusLabel(dc) {
        return TVC_DefectCase.listWorkflowStatus(dc);
    }

    function defectHistoryFormFlags(dc) {
        return {
            repairRequest: !!dc.repair_request,
            shoreSupport: !!(dc.shore_support || dc.shore_technician),
            defectCleared: !!(dc.defect_cleared || dc.status === TVC_DefectCase.Status.CLOSED),
            shipComment: !!String(dc.ship_verified_after_clear || '').trim(),
            companyComment: !!String(dc.company_comment || dc.company_initial_reply || '').trim(),
        };
    }

    function compareReportedDateDesc(dateA, timeA, dateB, timeB) {
        const dA = String(dateA || '').slice(0, 10);
        const dB = String(dateB || '').slice(0, 10);
        const byDate = dB.localeCompare(dA);
        if (byDate !== 0) return byDate;
        return String(timeB || '').localeCompare(String(timeA || ''));
    }

    function compareDefectCaseByReportedDate(a, b) {
        return compareReportedDateDesc(
            listReportedDateStr(a), a?.created_at || a?.submitted_at || a?.id,
            listReportedDateStr(b), b?.created_at || b?.submitted_at || b?.id,
        );
    }

    function compareReportByReportedDate(a, b) {
        return compareReportedDateDesc(
            listReportedDateStr(a), a?.created_at || a?.id,
            listReportedDateStr(b), b?.created_at || b?.id,
        );
    }

    function histEntryReportedDate(entry) {
        if (isHistPermitEntry(entry)) return listReportedDateStr(entry.permit);
        if (isHistConsumeEntry(entry)) return consumeHistoryFields(entry.consume).date;
        if (isHistDefectEntry(entry)) return listReportedDateStr(entry.defect);
        return listReportedDateStr(entry.report);
    }

    function histEntryCreatedAt(entry) {
        if (isHistPermitEntry(entry)) {
            const d = entry.permit;
            return d?.created_at || d?.id || '';
        }
        if (isHistConsumeEntry(entry)) {
            const d = entry.consume;
            return d?.created_at || d?.consumed_date || d?.id || '';
        }
        if (isHistDefectEntry(entry)) {
            const d = entry.defect;
            return d?.created_at || d?.submitted_at || d?.id || '';
        }
        const r = entry.report;
        return r?.created_at || r?.id || '';
    }

    function compareHistEntryByReportedDate(a, b) {
        return compareReportedDateDesc(
            histEntryReportedDate(a), histEntryCreatedAt(a),
            histEntryReportedDate(b), histEntryCreatedAt(b),
        );
    }

    function histEntrySortDate(entry) {
        return histEntryReportedDate(entry);
    }

    function workHistoryPermits() {
        let rows = (state.workPermits || []).filter(r => r.visible_in_list !== false);
        if (state.department) {
            const canSwitch = state.user && (TVC_RBAC.isHqAccount(state.user)
                || (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(state.user)));
            if (canSwitch) {
                const jobs = state._allJobs || state.jobs || [];
                rows = rows.filter(r => workPermitBelongsToDept(r, state.department, jobs));
            }
        }
        return rows.filter(r => {
            const st = TVC_WorkPermit.listWorkflowStatus(r);
            return st === 'Draft' || st === 'Reported' || st === 'Confirmed' || st === 'Approved' || st === 'Submitted';
        });
    }

    function workHistoryDefectCases() {
        let cases = (state.defectCases || []).filter(d => d.visible_in_list !== false);
        if (state.department) {
            const canSwitch = state.user && (TVC_RBAC.isHqAccount(state.user)
                || (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(state.user)));
            if (canSwitch) {
                cases = cases.filter(d => defectCaseDept(d) === state.department);
            }
        }
        return cases;
    }

    function resolveReportJob(report) {
        if (!report) return null;
        TVC_WorkReport.fromLegacy(report);
        const item = report.job_items?.[0];
        if (item?.maintenance_job_id) {
            const byId = state.idx?.jobById.get(item.maintenance_job_id);
            if (byId) return byId;
        }
        const code = item?.job_code || report.job_code;
        if (code) return state.jobs.find(j => j.job_code === code) || null;
        return null;
    }

    function postponeRequiresCompanyApproval(report) {
        return false;
    }

    function workHistoryPostponeReports() {
        return workHistoryReports().filter(r => {
            TVC_WorkReport.fromLegacy(r);
            return r.work_type === 'POSTPONE';
        });
    }

    function matchHistSearch(entry) {
        const q = state.search;
        if (!q) return true;
        if (isHistPermitEntry(entry)) {
            const row = entry.permit;
            const cols = workPermitHistoryColumns(row || {});
            const hay = [
                cols.jobCode,
                cols.sort1,
                cols.sort2,
                row?.permit_no,
                row?.file_no,
                row?.pms_group_no,
                TVC_WorkPermit.listWorkflowStatus(row),
            ].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
        }
        if (isHistConsumeEntry(entry)) {
            const f = consumeHistoryFields(entry.consume);
            const hay = [f.fileNo, f.jobCode, f.sort1, f.sort2, f.status, f.date]
                .filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
        }
        if (isHistDefectEntry(entry)) {
            const dc = entry.defect;
            const cols = defectHistoryColumns(dc);
            const hay = [
                cols.jobCode,
                cols.sort1,
                cols.sort2,
                cols.jobDetail,
                dc.case_no,
                dc.pms_group_no,
                dc.pms_job_code,
                dc.job_name,
                dc.machinery_name,
                defectHistoryStatusLabel(dc),
            ].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
        }
        const { report: r, item } = entry;
        const job = histPrimaryJob(entry);
        const f = item.form || wrReportForm(r);
        const detail = job?.job_detail || item.description || r.description || '';
        const hay = [
            ...(r?.is_batch ? TVC_WorkReport.getJobCodes(r) : []),
            histDisplayJobCode(entry),
            job?.item_sort1,
            job?.item_sort2,
            detail,
            f.fileNo,
            f.voyNo,
            f.workResult,
            item.status,
            r.status,
            workHistoryStatusLabel(r, item),
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
    }

    /** C. CRITICAL EQUIPMENT 분류 (Original / Work Plan Group Tree) */
    function isCriticalMaintenanceJob(j) {
        if (!j) return false;
        const sort = String(j.sort || '').trim().toUpperCase();
        if (sort.startsWith('C.') || sort.includes('CRITICAL')) return true;
        return String(j.item_sort1 || '').toUpperCase().includes('CRITICAL');
    }

    function criticalJobIdsInDept() {
        return deptJobs().filter(isCriticalMaintenanceJob).map(j => j.id);
    }

    let _actualFilterKeysCache = null;

    function clearActualFilterKeysCache() { _actualFilterKeysCache = null; }

    function reportsForDept() {
        let reps = state.reports || [];
        if (state.department) reps = reps.filter(r => reportDept(r) === state.department);
        return reps;
    }

    function postponedJobKeys() {
        const ids = new Set();
        const codes = new Set();
        buildLatestScheduleByJobId(reportsForDept()).forEach(({ report, item }, jobId) => {
            if (report.work_type !== 'POSTPONE') return;
            ids.add(jobId);
            if (item.job_code) codes.add(item.job_code);
        });
        return { ids, codes };
    }

    function getActualFilterKeys() {
        if (!_actualFilterKeysCache) {
            _actualFilterKeysCache = {
                postponed: postponedJobKeys(),
            };
        }
        return _actualFilterKeysCache;
    }

    function isActualJobCompleted(j) {
        return j?.plan_status === 'COMPLETED';
    }

    function jobMatchesActualFilter(j, filter) {
        if (!j || filter === 'total') return true;
        const keys = getActualFilterKeys();
        if (filter === 'overdue') return !!j.is_overdue && !isActualJobCompleted(j);
        if (filter === 'due30') {
            const d = daysUntil(j.next_date);
            return !j.is_overdue && d >= 0 && d <= 30;
        }
        if (filter === 'postponed') {
            return keys.postponed.ids.has(j.id) || keys.postponed.codes.has(j.job_code);
        }
        if (filter === 'critical') return jobShowsCriticalEquipmentMark(j);
        return true;
    }

    function actualDashboardCounts() {
        const jobs = deptJobs();
        const keys = getActualFilterKeys();
        let overdue = 0;
        let due30 = 0;
        let postponed = 0;
        let critical = 0;
        jobs.forEach(j => {
            if (j.is_overdue && !isActualJobCompleted(j)) overdue++;
            const d = daysUntil(j.next_date);
            if (!j.is_overdue && d >= 0 && d <= 30) due30++;
            if (keys.postponed.ids.has(j.id) || keys.postponed.codes.has(j.job_code)) postponed++;
            if (jobShowsCriticalEquipmentMark(j)) critical++;
        });
        return { total: jobs.length, overdue, due30, postponed, critical };
    }

    function jobActualStatusKind(j) {
        if (isActualJobCompleted(j)) {
            const d = daysUntil(j.next_date);
            if (j.is_overdue) return 'overdue';
            if (d >= 0 && d <= 30) return 'due';
            return 'ok';
        }
        const keys = getActualFilterKeys();
        if (j.is_overdue) return 'overdue';
        if (keys.postponed.ids.has(j.id) || keys.postponed.codes.has(j.job_code)) return 'postponed';
        const d = daysUntil(j.next_date);
        if (d >= 0 && d <= 30) return 'due';
        return 'ok';
    }

    const PLAN_STATUS_META = {
        postponed: { mark: 'P', title: 'Postponed', cls: 'plan-st-postponed' },
        overdue: { mark: '!', title: 'Overdue', cls: 'plan-st-overdue' },
        due: { mark: '◷', title: 'Due (30d)', cls: 'plan-st-due' },
        ok: { mark: '', title: 'OK', cls: 'plan-st-ok' },
    };

    function jobActualStatusCellHtml(j) {
        const kind = jobActualStatusKind(j);
        const m = PLAN_STATUS_META[kind];
        if (kind === 'ok') {
            return `<span class="pill ok plan-st-ok" title="${escAttr(m.title)}">OK</span>`;
        }
        return `<span class="plan-st-mark ${m.cls}" title="${escAttr(m.title)}"><span class="plan-st-badge">${m.mark}</span></span>`;
    }

    function jobActualStatusPill(j) {
        return jobActualStatusCellHtml(j);
    }

    function jobMatchesSelectedGroup(job, idx) {
        if (!job || !state.selectedGroupKey) return true;
        const key = state.selectedGroupKey;
        if (TVC_Indexes.groupKey(job) === key) return true;
        const node = idx?.groupNodes?.find(n => n.key === key);
        if (!node) return false;
        return TVC_Indexes.isJobUnderGroup(job, key, idx.jobById, node);
    }

    /** 부서 필터(전역) 후 mode별 세부 필터 적용 */
    function sheetIds(mode) {
        const idx = state.idx;
        let ids = deptJobs().map(j => j.id);
        if (state.selectedGroupKey === CRITICAL_GROUP_KEY) {
            const crit = new Set(criticalJobIdsInDept());
            ids = ids.filter(id => crit.has(id));
        } else if (state.selectedGroupKey) {
            ids = ids.filter(id => jobMatchesSelectedGroup(idx.jobById.get(id), idx));
        }
        if (mode === 'actual') {
            const af = state.actualFilter;
            ids = ids.filter(id => jobMatchesActualFilter(idx.jobById.get(id), af));
            if (hasActualPeriodFilter()) {
                ids = ids.filter(id => isJobInActualPeriod(idx.jobById.get(id)));
            }
            if (state.actualSelectedOnly) {
                ids = ids.filter(id => state.batchSelectedJobs[id]);
            }
            const picF = state.listFilters?.actual;
            if (picF && TVC_ListFilters) {
                ids = ids.filter(id => TVC_ListFilters.matchActualJob(idx.jobById.get(id), picF));
            }
        }
        ids = ids.filter(id => matchSearch(idx.jobById.get(id)));
        return sortIds(ids);
    }

    function setSearch(q) { state.search = (q || '').toLowerCase(); rerenderCurrentTab(); }
    function setTreeSearch(q) {
        state.treeSearch = (q || '').toLowerCase();
        renderGroupTree('actTree');
        if (document.getElementById('spareGroupTree') && window.TVC_SpareMenu?.renderSpareGroupTree) {
            TVC_SpareMenu.renderSpareGroupTree();
        } else {
            renderGroupTree('spareGroupTree');
        }
    }

    const SEARCH_INPUT_SEL = 'input.search-input';
    let _searchClearGlobalBound = false;

    function isSearchClearInput(el) {
        return !!el?.matches?.(SEARCH_INPUT_SEL) && !!el.closest('.search-field-wrap');
    }

    /** @deprecated use isSearchClearInput */
    function isListFilterSearchInput(el) {
        return isSearchClearInput(el);
    }

    function appendSearchClearBtn(el) {
        const wrap = el.closest('.search-field-wrap') || el.parentElement;
        if (!wrap) return;
        let btn = wrap.querySelector('.search-clear-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'search-clear-btn hidden';
            btn.title = 'Clear search';
            btn.setAttribute('aria-label', 'Clear search');
            btn.textContent = '×';
            if (el.id) {
                btn.setAttribute('onclick', `TVC_App.clearSearchField('${el.id.replace(/'/g, "\\'")}')`);
            } else {
                btn.addEventListener('click', () => clearListFilterSearch(el));
            }
            wrap.appendChild(btn);
        }
        updateSearchClearBtnForEl(el);
    }

    function updateSearchClearBtnForEl(el) {
        if (!el) return;
        const btn = el.closest('.search-field-wrap')?.querySelector('.search-clear-btn');
        if (btn) btn.classList.toggle('hidden', !String(el.value || '').trim());
        else if (el.id) updateSearchClearBtn(el.id);
    }

    function updateSearchClearBtn(inputId) {
        updateSearchClearBtnForEl(document.getElementById(inputId));
    }

    function clearSearchField(inputId) {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.value = '';
        updateSearchClearBtnForEl(el);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
    }

    function clearListFilterSearch(el) {
        if (!el) return;
        if (el.id) {
            clearSearchField(el.id);
            return;
        }
        el.value = '';
        updateSearchClearBtnForEl(el);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
    }

    function ensureSearchClearUi(root = document) {
        root.querySelectorAll(SEARCH_INPUT_SEL).forEach(el => {
            if (el.closest('.search-field-wrap')) {
                appendSearchClearBtn(el);
                return;
            }
            const parent = el.parentElement;
            if (!parent) return;
            const wrap = document.createElement('div');
            wrap.className = 'search-field-wrap';
            parent.insertBefore(wrap, el);
            wrap.appendChild(el);
            appendSearchClearBtn(el);
        });
    }

    function bindSearchClearInput(inputIdOrEl) {
        const el = typeof inputIdOrEl === 'string' ? document.getElementById(inputIdOrEl) : inputIdOrEl;
        if (!el || el.dataset.searchClearBound) return;
        el.dataset.searchClearBound = '1';
        el.addEventListener('input', () => updateSearchClearBtnForEl(el));
        updateSearchClearBtnForEl(el);
    }

    function bindSearchClearGlobal() {
        if (_searchClearGlobalBound) return;
        _searchClearGlobalBound = true;
        document.addEventListener('input', (e) => {
            const el = e.target;
            if (!el?.matches?.(SEARCH_INPUT_SEL)) return;
            if (!el.closest('.search-field-wrap')) ensureSearchClearUi(el.parentElement || document);
            if (!el.dataset.searchClearBound) bindSearchClearInput(el);
            else updateSearchClearBtnForEl(el);
        }, true);
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const el = e.target;
            if (!isSearchClearInput(el) || !String(el.value || '').trim()) return;
            e.preventDefault();
            clearListFilterSearch(el);
        }, true);
    }

    /** @deprecated use bindSearchClearGlobal */
    function bindListFilterSearchClear() {
        bindSearchClearGlobal();
    }

    function refreshSearchClearUi(root = document) {
        ensureSearchClearUi(root);
        root.querySelectorAll(SEARCH_INPUT_SEL).forEach(el => bindSearchClearInput(el));
    }

    function bindTabSearchClearInputs(root = document) {
        bindSearchClearGlobal();
        refreshSearchClearUi(root);
    }
    function sortJobs(field) {
        if (state.jobSort.field === field) state.jobSort.asc = !state.jobSort.asc;
        else { state.jobSort.field = field; state.jobSort.asc = true; }
        rerenderCurrentTab();
    }
    function setActualFilter(f) {
        state.actualFilter = f === 'pending' ? 'total' : f;
        updateActualFilterUI();
        renderActualPlan();
    }

    async function onActualPeriodChange() {
        const fromEl = document.getElementById('actPeriodFrom');
        const toEl = document.getElementById('actPeriodTo');
        const from = fromEl?.value || '';
        const to = toEl?.value || '';
        if (from && to && from > to) {
            await TVC_Dialog.alert('Start date cannot be after end date.');
            if (fromEl) fromEl.value = state.actualPeriodFrom || '';
            if (toEl) toEl.value = state.actualPeriodTo || '';
            return;
        }
        state.actualPeriodFrom = from;
        state.actualPeriodTo = to;
        renderActualPlan();
    }

    function clearActualPeriod() {
        state.actualPeriodFrom = '';
        state.actualPeriodTo = '';
        if (state.listFilters?.actual) {
            Object.assign(state.listFilters.actual, { pics: [], unassigned: false, criticalOnly: false });
        }
        TVC_ListFilters?.refreshOpenPopover?.();
        TVC_ListFilters?.syncBtn('actual');
        renderActualPlan();
    }

    async function onReportPeriodChange() {
        const fromEl = document.getElementById('histPeriodFrom');
        const toEl = document.getElementById('histPeriodTo');
        const from = fromEl?.value || '';
        const to = toEl?.value || '';
        if (from && to && from > to) {
            await TVC_Dialog.alert('Start date cannot be after end date.');
            syncReportPeriodInputs();
            return;
        }
        state.reportPeriodFrom = from;
        state.reportPeriodTo = to;
        syncReportPeriodInputs();
        if (state.currentTab === 'history') renderWorkHistory();
    }

    function clearReportPeriod() {
        state.reportPeriodFrom = '';
        state.reportPeriodTo = '';
        syncReportPeriodInputs();
        if (state.currentTab === 'history') renderWorkHistory();
    }

    function clearHistoryPeriodAndFilters() {
        state.reportPeriodFrom = '';
        state.reportPeriodTo = '';
        syncReportPeriodInputs();
        if (state.listFilters?.history) {
            Object.assign(state.listFilters.history, {
                groupKeys: [],
                type: 'all',
                openOnly: false,
                noClosedOut: false,
                postponeAwaitingApproval: false,
                awaitingShipConfirm: false,
            });
        }
        TVC_ListFilters?.refreshOpenPopover?.();
        if (state.currentTab === 'history') renderWorkHistory();
        TVC_ListFilters?.syncBtn('history');
    }

    function syncReportPeriodInputs() {
        const fromEl = document.getElementById('histPeriodFrom');
        const toEl = document.getElementById('histPeriodTo');
        if (fromEl && document.activeElement !== fromEl) fromEl.value = state.reportPeriodFrom || '';
        if (toEl && document.activeElement !== toEl) toEl.value = state.reportPeriodTo || '';
        document.getElementById('histPeriodFilter')?.classList.toggle('active', hasReportPeriodFilter());
    }

    function canShowSpareHistory() {
        return !!(state.user && typeof TVC_Space !== 'undefined' && TVC_Space.getUiFeatures(state.user).showSpareTab);
    }

    function syncHistoryScopeUi() {
        const scope = state.historyScope === 'spare' && canShowSpareHistory() ? 'spare' : 'pms';
        state.historyScope = scope;
        document.getElementById('histScopeTabs')?.classList.toggle('hidden', !canShowSpareHistory());
        document.querySelectorAll('.hist-scope-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.histScope === scope);
        });
        document.getElementById('histPmsPane')?.classList.toggle('hidden', scope !== 'pms');
        document.getElementById('histSparePane')?.classList.toggle('hidden', scope !== 'spare');
    }

    function setHistoryScope(scope) {
        if (scope !== 'spare' || !canShowSpareHistory()) scope = 'pms';
        state.historyScope = scope;
        TVC_ListFilters?.closePopover();
        renderWorkHistory();
    }

    async function onSpareHistPeriodChange() {
        const fromEl = document.getElementById('spareHistPeriodFrom');
        const toEl = document.getElementById('spareHistPeriodTo');
        const from = fromEl?.value || '';
        const to = toEl?.value || '';
        if (from && to && from > to) {
            await TVC_Dialog.alert('Start date cannot be after end date.');
            syncSpareHistPeriodInputs();
            return;
        }
        state.spareHistPeriodFrom = from;
        state.spareHistPeriodTo = to;
        syncSpareHistPeriodInputs();
        if (state.currentTab === 'history') renderWorkHistory();
    }

    function clearSpareHistPeriod() {
        state.spareHistPeriodFrom = '';
        state.spareHistPeriodTo = '';
        syncSpareHistPeriodInputs();
        if (state.currentTab === 'history') renderWorkHistory();
    }

    function syncSpareHistPeriodInputs() {
        const fromEl = document.getElementById('spareHistPeriodFrom');
        const toEl = document.getElementById('spareHistPeriodTo');
        if (fromEl && document.activeElement !== fromEl) fromEl.value = state.spareHistPeriodFrom || '';
        if (toEl && document.activeElement !== toEl) toEl.value = state.spareHistPeriodTo || '';
        document.getElementById('spareHistPeriodFilter')?.classList.toggle(
            'active', !!(state.spareHistPeriodFrom || state.spareHistPeriodTo)
        );
    }

    function setSpareHistSearch(q) {
        state.spareHistSearch = String(q || '');
        if (state.currentTab === 'history') renderWorkHistory();
    }

    function selectSpareHistRow(key) {
        state._spareHistSelKey = key || null;
        document.querySelectorAll('#spareHistoryBody .hist-row').forEach(tr => {
            tr.classList.toggle('row-selected', tr.dataset.spareHistKey === state._spareHistSelKey);
        });
        const btn = document.getElementById('spareHistBtnDetail');
        if (btn) btn.disabled = !state._spareHistSelKey;
    }

    function spareHistDetailReport() {
        if (typeof TVC_SpareMenu?.openReportHistoryEntry === 'function') {
            TVC_SpareMenu.openReportHistoryEntry(state._spareHistSelKey);
        }
    }

    function syncActualPeriodInputs() {
        const fromEl = document.getElementById('actPeriodFrom');
        const toEl = document.getElementById('actPeriodTo');
        if (fromEl && document.activeElement !== fromEl) fromEl.value = state.actualPeriodFrom || '';
        if (toEl && document.activeElement !== toEl) toEl.value = state.actualPeriodTo || '';
        const wrap = document.getElementById('actPeriodFilter');
        if (wrap) wrap.classList.toggle('active', hasActualPeriodFilter());
    }
    function selectGroup(key) {
        if (isOrigJobInlineEditing()) cancelOrigJobInlineEdit();
        if (modStateSpare()?.groupHeaderEdit && TVC_SpareMenu?.cancelGroupHeaderEdit) {
            TVC_SpareMenu.cancelGroupHeaderEdit();
        }
        state.selectedGroupKey = key || null;
        state.focusedSpareId = null;
        if (modStateSpare()) modStateSpare().focusedId = null;
        if (state.currentTab === 'actual') renderActualPlan();
    }

    // ── Job table (Work Plan) ──────────────────────────────────────
    function planCellHtml(text, cls) {
        const t = String(text ?? '').trim();
        const display = t || '—';
        if (!t) return `<span class="${cls}"><span class="vl-cell-tip-text">${esc(display)}</span></span>`;
        return `<span class="${cls} vl-cell-tip" data-tip="${escAttr(t)}"><span class="vl-cell-tip-text">${esc(display)}</span></span>`;
    }

    function histCellHtml(text) {
        return planCellHtml(text, 'hist-cell-tip');
    }

    function resolveJobById(jobId) {
        const id = String(jobId ?? '').trim();
        if (!id) return null;
        return state.idx?.jobById.get(id)
            || state.idx?.jobById.get(jobId)
            || (state.jobs || []).find(j => String(j.id) === id)
            || null;
    }

    function clearPlanRowRefreshTimer() {
        if (_planRowRefreshTimer) {
            clearTimeout(_planRowRefreshTimer);
            _planRowRefreshTimer = null;
        }
    }

    function updatePlanRowSelectionHighlight(jobId) {
        const scroll = document.getElementById('actScroll');
        if (!scroll) return;
        scroll.querySelectorAll('.vl-cells.row-selected').forEach(el => el.classList.remove('row-selected'));
        if (!jobId) return;
        const id = String(jobId);
        scroll.querySelectorAll('.vl-cells[data-job-id]').forEach(el => {
            if (el.getAttribute('data-job-id') === id) el.classList.add('row-selected');
        });
    }

    /** Work Plan 행 클릭 — 선택 / 빠른 두 번 클릭 시 Procedure 모달 */
    function onPlanRowClick(ev, jobId) {
        if (ev?.target?.closest?.('.c-chk, .act-batch-chk, input[type=checkbox]')) return;
        const id = String(jobId ?? '').trim();
        if (!id) return;

        const now = Date.now();
        if (_planRowLastTap.id === id && now - _planRowLastTap.t < 550) {
            clearPlanRowRefreshTimer();
            _planRowLastTap = { id: null, t: 0 };
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
            }
            openWorkProcedure(id);
            return;
        }
        _planRowLastTap = { id, t: now };
        if (isOrigJobInlineEditing()) return;
        state.selectedJobId = id;
        updatePlanRowSelectionHighlight(id);
        renderSidePanel();
        renderPlanGroupHeader();
        if (state.currentTab === 'actual') syncPlanItemUi();
    }

    async function openPlanWorkProcedure() {
        const job = getPlanFocusJob();
        if (!job) await TVC_Dialog.alert('Select a job in Work Plan.');
        openWorkProcedure(job.id);
    }

    function initPlanCellTips(scrollId) {
        const container = document.getElementById(scrollId);
        if (!container || container._planTipsBound) return;
        container._planTipsBound = true;
        const syncTip = (tip) => {
            const textEl = tip.querySelector('.vl-cell-tip-text');
            const truncated = textEl && textEl.scrollWidth > textEl.clientWidth + 1;
            tip.classList.toggle('vl-cell-tip-active', !!truncated);
            tip.closest('.vl-row')?.classList.toggle('vl-row-tip-open', !!truncated);
        };
        container.addEventListener('mouseover', (e) => {
            const tip = e.target.closest('.vl-cell-tip');
            if (!tip || !container.contains(tip)) return;
            syncTip(tip);
        });
        container.addEventListener('mouseout', (e) => {
            const from = e.target.closest('.vl-cell-tip');
            const to = e.relatedTarget?.closest?.('.vl-cell-tip');
            if (from && from !== to) {
                from.classList.remove('vl-cell-tip-active');
                from.closest('.vl-row')?.classList.remove('vl-row-tip-open');
            }
        });
    }

    /** 행 단일 클릭 — 선택(연한 파란색)만, 모달 없음 */
    function selectJobRow(jobId) {
        if (isOrigJobInlineEditing()) return;
        clearPlanRowRefreshTimer();
        _planRowLastTap = { id: null, t: 0 };
        state.selectedJobId = jobId;
        updatePlanRowSelectionHighlight(jobId);
        renderSidePanel();
        renderPlanGroupHeader();
        if (state.currentTab === 'actual') syncPlanItemUi();
    }

    function jobShowsCriticalEquipmentMark(j) {
        if (!j) return false;
        if (j.is_critical_equipment === true) return true;
        if (j.is_critical_equipment === false) return false;
        return !!TVC_SpareMenu?.isGroupCriticalEquipmentYes?.(state, j.group);
    }

    function jobCriticalEditValue(j) {
        if (j?.is_critical_equipment === true) return 'Yes';
        if (j?.is_critical_equipment === false) return 'No';
        return '';
    }

    function jobCriticalEquipmentDisplay(job, groupFallback = '') {
        if (job) {
            if (job.is_critical_equipment === true) return 'Yes';
            if (job.is_critical_equipment === false) return 'No';
            groupFallback = groupFallback || job.group || '';
        }
        if (groupFallback && TVC_SpareMenu?.isGroupCriticalEquipmentYes?.(state, groupFallback)) return 'Yes';
        return '—';
    }

    function renderWrPmsGroupCriticalRow(opts = {}) {
        const {
            pmsInner,
            criticalLabel = '—',
            pmsLabel = 'PMS Group No.',
            forPrint = false,
        } = opts;
        const crit = String(criticalLabel || '').trim() || '—';
        const critEmpty = crit === '—';
        const critDisplay = forPrint
            ? `<input class="wr-ro" value="${esc(crit)}" readonly tabindex="-1">`
            : `<span class="spare-gh-value${critEmpty ? ' empty' : ''}">${esc(crit)}</span>`;
        return `<div class="wr-maint-pms-crit-row spare-gh-row spare-gh-row-primary spare-gh-row-plan-split">
            <div class="spare-gh-field spare-gh-field-wide spare-gh-field-span3">
                <span class="spare-gh-label">${esc(pmsLabel)}</span>
                <div class="wr-pms-crit-pms-inner">${pmsInner}</div>
            </div>
            <div class="spare-gh-field">
                <span class="spare-gh-label">Critical Equipment</span>
                ${critDisplay}
            </div>
        </div>`;
    }

    function parseJobCriticalEditValue(raw) {
        if (raw === 'Yes') return true;
        if (raw === 'No') return false;
        return null;
    }

    function resolveDefectLinkedJob(dc) {
        if (!dc) return null;
        if (dc.maintenance_job_id) {
            const byId = state.idx?.jobById.get(dc.maintenance_job_id);
            if (byId) return byId;
        }
        const code = dc.pms_job_code || dc.job_code;
        if (code) return state.jobs.find(j => j.job_code === code) || null;
        return null;
    }

    function defectShowsCriticalEquipmentMark(dc) {
        const job = resolveDefectLinkedJob(dc);
        if (job) return jobShowsCriticalEquipmentMark(job);
        const groupLabel = dc?.pms_group_no || dc?.group || '';
        if (groupLabel) return !!TVC_SpareMenu?.isGroupCriticalEquipmentYes?.(state, groupLabel);
        return false;
    }

    function defectCriticalTypeCell(dc) {
        if (!defectShowsCriticalEquipmentMark(dc)) {
            return '<td class="hist-crit" aria-hidden="true"></td>';
        }
        return `<td class="hist-crit" title="Critical Equipment">${planCriticalMarkHtml()}</td>`;
    }

    function defectReportTypeCell() {
        return '<td class="hist-type hist-type-defect" title="Defect Report"><span class="hist-type-mark">D</span></td>';
    }

    function planCriticalMarkHtml() {
        return `<svg class="plan-crit-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <path fill="none" stroke="#9b2c2c" stroke-width="1.35" stroke-linejoin="round" d="M8 2.8 13.6 12.8H2.4Z"/>
            <path fill="none" stroke="#9b2c2c" stroke-width="1.35" stroke-linecap="round" d="M8 6.4v3.1"/>
            <circle fill="#9b2c2c" cx="8" cy="11.1" r="0.85"/>
        </svg>`;
    }

    function planCriticalCellHtml(j) {
        if (!jobShowsCriticalEquipmentMark(j)) return '<span class="c-crit" aria-hidden="true"></span>';
        return `<span class="c-crit" title="Critical Equipment">${planCriticalMarkHtml()}</span>`;
    }

    function origJobCriticalSelect(id, value) {
        const v = value || '';
        return `<select class="spare-inline-input orig-inline-critical" id="${escAttr(id)}" onclick="event.stopPropagation()" aria-label="Critical Equipment">
            <option value=""${v === '' ? ' selected' : ''}>—</option>
            <option value="Yes"${v === 'Yes' ? ' selected' : ''}>Yes</option>
            <option value="No"${v === 'No' ? ' selected' : ''}>No</option>
        </select>`;
    }

    function renderJobRowHtml(j) {
        const st = jobActualStatusPill(j);
        const selected = state.selectedJobId === j.id ? ' row-selected' : '';
        const batchOn = !!state.batchSelectedJobs[j.id];
        return `<div class="vl-cells sheet-actual${selected}${j.is_overdue ? ' row-overdue' : ''}" data-job-id="${escAttr(j.id)}"
            onclick="TVC_App.onPlanRowClick(event, this.getAttribute('data-job-id'))"
            ondblclick="TVC_App.openWorkProcedure(this.getAttribute('data-job-id'))">
            <span class="c-chk" onclick="event.stopPropagation()">
                <input type="checkbox" class="act-batch-chk" ${batchOn ? 'checked' : ''} aria-label="Select for batch"
                    onchange="TVC_App.toggleBatchJob('${escAttr(j.id)}', this.checked)">
            </span>
            ${planCriticalCellHtml(j)}
            <span class="c-code"><strong>${esc(j.job_code)}</strong></span>
            ${planCellHtml(j.item_sort1, 'c-s1')}
            ${planCellHtml(j.item_sort2, 'c-d1')}
            ${planCellHtml(j.job_detail, 'c-d2')}
            <span class="c-per">${j.period ?? '—'} ${esc(j.unit || '')}</span>
            <span class="c-pic">${esc(j.pic || '')}</span>
            <span class="c-next">${esc(j.next_date || '—')}</span>
            <span class="c-last">${esc(j.last_done || '—')}</span>
            <span class="c-st">${st}</span>
        </div>`;
    }

    function getPlanFocusJob() {
        if (state.selectedJobId) {
            const j = resolveJobById(state.selectedJobId);
            if (j && jobInCurrentViewDept(j)) return j;
        }
        const batch = planContextCheckedJobIds();
        if (batch.length === 1) return resolveJobById(batch[0]);
        return null;
    }

    function syncPlanSheetLayout(scrollId, headId) {
        const scroll = document.getElementById(scrollId);
        const head = document.getElementById(headId);
        const inner = scroll?.querySelector('.vl-inner');
        const vlHead = head?.querySelector('.vl-head');
        if (!scroll || !head || !inner || !vlHead) return;
        const tableW = Math.max(scroll.clientWidth, PLAN_SHEET_MIN_WIDTH);
        const sb = scroll.offsetWidth - scroll.clientWidth;
        inner.style.setProperty('width', `${tableW}px`, 'important');
        inner.style.setProperty('min-width', `${PLAN_SHEET_MIN_WIDTH}px`, 'important');
        vlHead.style.width = `${tableW}px`;
        vlHead.style.minWidth = `${PLAN_SHEET_MIN_WIDTH}px`;
        head.style.paddingRight = sb > 0 ? `${sb}px` : '';
        head.scrollLeft = scroll.scrollLeft;
    }

    function captureActListScroll() {
        const scroll = document.getElementById('actScroll');
        return scroll ? scroll.scrollTop : 0;
    }

    function restoreActListScroll(scrollTop) {
        if (scrollTop == null || scrollTop < 0) return;
        const container = document.getElementById('actScroll');
        if (!container) return;
        const apply = () => {
            container.scrollTop = scrollTop;
            state.vlActual?.refresh();
        };
        requestAnimationFrame(() => {
            apply();
            requestAnimationFrame(apply);
        });
    }

    function bindPlanSheetLayoutSync(scrollId, headId) {
        const scroll = document.getElementById(scrollId);
        if (!scroll) return;
        if (scroll._planSheetLayoutHandler) {
            scroll.removeEventListener('scroll', scroll._planSheetLayoutHandler);
        }
        const run = () => syncPlanSheetLayout(scrollId, headId);
        scroll._planSheetLayoutHandler = run;
        scroll.addEventListener('scroll', run, { passive: true });
        run();
        requestAnimationFrame(() => {
            run();
            requestAnimationFrame(run);
        });
        if (scroll._planSheetResizeObs) scroll._planSheetResizeObs.disconnect();
        if (typeof ResizeObserver !== 'undefined') {
            scroll._planSheetResizeObs = new ResizeObserver(run);
            scroll._planSheetResizeObs.observe(scroll);
            const head = document.getElementById(headId);
            if (head) scroll._planSheetResizeObs.observe(head);
        }
    }

    function mountJobSheet(headId, countId, scrollId, ids, vlKey) {
        if (headId === 'actHead') renderPlanGroupHeader(headId);
        const container = document.getElementById(scrollId);
        if (!container) return;
        const restoreScrollTop = scrollId === 'actScroll' ? state._actScrollRestore : null;
        if (scrollId === 'actScroll') state._actScrollRestore = null;
        const arrow = f => state.jobSort.field === f ? (state.jobSort.asc ? ' ▲' : ' ▼') : '';
        setText(countId, `${ids.length} jobs`);
        const head = document.getElementById(headId);
        if (head) {
            head.classList.add('sheet-scroll-actual');
            head.classList.remove('sheet-scroll-original');
            const selIds = sheetIds('actual');
            const allBatch = selIds.length > 0 && selIds.every(id => state.batchSelectedJobs[id]);
            head.innerHTML = `<div class="vl-head sheet-actual">
                <span class="c-chk" title="Select all visible">
                    <input type="checkbox" ${allBatch ? 'checked' : ''} onchange="TVC_App.toggleBatchSelectAll(this.checked)">
                </span>
                <span class="c-crit" title="Critical Equipment">⚠</span>
            <span class="c-code sortable" onclick="TVC_App.sortJobs('job_code')">JOB CODE${arrow('job_code')}</span>
                <span class="c-s1">SORT-1</span><span class="c-d1">SORT-2</span><span class="c-d2">JOB DETAIL</span>
                <span class="c-per">PERIOD</span><span class="c-pic">P.I.C</span>
            <span class="c-next sortable" onclick="TVC_App.sortJobs('next_date')">NEXT DATE${arrow('next_date')}</span>
                <span class="c-last">LAST DONE</span><span class="c-st">STATUS</span>
        </div>`;
        }
        container.classList.add('sheet-scroll-actual');
        container.classList.remove('sheet-scroll-original');
        if (state[vlKey]) state[vlKey].destroy();
        state[vlKey] = TVC_VirtualList.mount(container, {
            rowHeight: ROW_H,
            getCount: () => ids.length,
            renderRow: (i) => {
                const j = state.idx.jobById.get(ids[i]);
                return j ? renderJobRowHtml(j) : '';
            },
        });
        if (restoreScrollTop != null) container.scrollTop = restoreScrollTop;
        state[vlKey].refresh();
        if (restoreScrollTop != null) restoreActListScroll(restoreScrollTop);
        if (scrollId === 'actScroll') initPlanCellTips(scrollId);
        bindPlanSheetLayoutSync(scrollId, headId);
    }

    // ── TAB: Menu ────────────────────────────────────────────────────
    function menuCounts() {
        const jobs = deptJobs();
        const dash = actualDashboardCounts();
        const overdue = dash.overdue;
        const due30 = dash.due30;
        const dueMonth = jobs.filter(j => { const d = daysUntil(j.next_date); return d >= 0 && d <= 31; }).length;
        let pending = state.reports.filter(r => repSt(r) === 'REPORTED');
        if (state.department) pending = pending.filter(r => reportDept(r) === state.department);
        const approved = state.reports.filter(r => repSt(r) === 'CONFIRMED').length;
        const defectPending = (state.defectCases || []).filter(d =>
            d.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
        ).length;
        const postponePending = hqPendingPostponeReports().length;
        const workReportPending = hqPendingWorkReports().length;
        const reportsPending = hqMonthlyReportsPendingCount();
        const critical = jobs.filter(jobShowsCriticalEquipmentMark).length;
        const workPermitPending = (state.workPermits || []).filter(r =>
            r.visible_in_list !== false && TVC_WorkPermitReport?.isPermitConfirmable?.(r)
        ).length;
        const workPermitApprovePending = hqPendingWorkPermits().length;
        const defectConfirmPending = (state.defectCases || []).filter(d =>
            TVC_DefectReport?.isDefectReportConfirmable?.(d)
        ).length;
        const postponeConfirmPending = (state.reports || []).filter(r => isPostponeReportConfirmable(r)).length;
        const reportConfirmPending = workPermitPending + defectConfirmPending + pending.length;
        const hqApprovePending = workPermitApprovePending + defectPending + postponePending + reportsPending;
        return { total: jobs.length, overdue, due30, dueMonth, pending: pending.length, approved, defectPending, postponePending, workReportPending, reportsPending, critical, workPermitPending, workPermitApprovePending, defectConfirmPending, postponeConfirmPending, reportConfirmPending, hqApprovePending };
    }

    function hqMonthlyReportsPendingCount() {
        // Monthly "Approve Reports" — Work/Trouble only.
        // Defect + Postpone (all) have their own Daily Tasks badges.
        return hqPendingWorkReports().length;
    }

    function hqPendingDefectCases() {
        return (state.defectCases || []).filter(d =>
            d.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
        );
    }

    function hqPendingWorkPermits() {
        let rows = (state.workPermits || []).filter(r => r.visible_in_list !== false);
        if (state.selectedVesselId) rows = rows.filter(r => r.vessel_id === state.selectedVesselId);
        if (state.department) {
            const jobs = state._allJobs || state.jobs || [];
            rows = rows.filter(r => workPermitBelongsToDept(r, state.department, jobs));
        }
        return rows.filter(r => {
            const st = TVC_WorkPermit.listWorkflowStatus(r);
            return st === 'Confirmed' || st === 'Submitted';
        });
    }

    function reportMatchesPostponeAwaitingApproval(report, opts = {}) {
        const monthly = opts.monthly === true;
        if (!report) return false;
        TVC_WorkReport.fromLegacy(report);
        if (report.work_type !== 'POSTPONE') return false;
        if (!TVC_RBAC.isConfirmedStatus(report.status, report.is_locked)) return false;
        if (reportIsApproved(report)) return false;
        return report.sync_status === 'SYNCED';
    }

    function hqPendingPostponeReports(opts = {}) {
        let reports = state.reports || [];
        if (state.department) reports = reports.filter(r => reportDept(r) === state.department);
        return reports.filter(r => reportMatchesPostponeAwaitingApproval(r, opts))
            .sort(compareReportByReportedDate);
    }

    function hqPendingWorkReports() {
        let reports = state.reports || [];
        if (state.department) reports = reports.filter(r => reportDept(r) === state.department);
        if (state.selectedVesselId) {
            reports = reports.filter(r => !r.vessel_id || r.vessel_id === state.selectedVesselId);
        }
        return reports.filter(r => {
            TVC_WorkReport.fromLegacy(r);
            if (r.work_type === 'POSTPONE') return false;
            if (reportIsApproved(r) || r.is_locked) return false;
            if (r.approved_at || r.approved_by) return false;
            const user = state.user;
            if (user && TVC_RBAC.canHqDirectApprove(user, r)) return true;
            if (!TVC_RBAC.isConfirmedStatus(r.status, r.is_locked)) return false;
            return r.work_type === 'MAINTENANCE' || r.work_type === 'TROUBLE';
        }).sort(compareReportByReportedDate);
    }

    function isPostponeReportConfirmable(report) {
        if (!report || !state.user) return false;
        if (TVC_RBAC.isHqAccount(state.user)) return false;
        TVC_WorkReport.fromLegacy(report);
        if (report.work_type !== 'POSTPONE') return false;
        if (report.visible_in_list === false) return false;
        if (state.department && reportDept(report) !== state.department) return false;
        if (reportIsApproved(report) || report.is_locked) return false;
        if (TVC_RBAC.isConfirmedStatus(report.status, report.is_locked)) return false;
        if (repSt(report) !== 'REPORTED') return false;
        return TVC_RBAC.canConfirmDepartment(state.user, reportDept(report));
    }

    function histEntryAwaitingShipConfirm(entry) {
        if (!entry) return false;
        if (isHistConsumeEntry(entry)) return false;
        if (isHistPermitEntry(entry)) {
            return !!(TVC_WorkPermitReport?.isPermitConfirmable?.(entry.permit));
        }
        if (isHistDefectEntry(entry)) {
            const row = entry.defect;
            if (!row || row.visible_in_list === false) return false;
            if (row.confirmed_at || row.confirmed_by || row.approved_at || row.approved_by) return false;
            if (row.status === TVC_DefectCase.Status.CLOSED) return false;
            const st = TVC_DefectCase.listWorkflowStatus(row);
            return st === 'Reported' || st === 'Draft';
        }
        const r = entry.report;
        if (!r) return false;
        return workReportListWorkflowStatus(r) === 'Reported';
    }

    function openShipConfirmHistory(type) {
        state.historyScope = 'pms';
        state.listFilters.history = {
            groupKeys: [],
            type: type || 'all',
            openOnly: false,
            noClosedOut: false,
            postponeAwaitingApproval: false,
            awaitingShipConfirm: true,
        };
        state.reportPeriodFrom = '';
        state.reportPeriodTo = '';
        state.search = '';
        switchTab('history');
        TVC_ListFilters?.syncBtn('history');
    }

    function openHqApproveReports() {
        if (!TVC_RBAC.isHqAccount(state.user)) return;
        state.listFilters.history = { groupKeys: [], type: 'all', openOnly: false, noClosedOut: false, postponeAwaitingApproval: false, awaitingShipConfirm: false };
        state.reportPeriodFrom = '';
        state.reportPeriodTo = '';
        state.search = '';
        switchTab('history');
        TVC_ListFilters?.syncBtn('history');
    }

    async function openHqApproveDefectReport() {
        if (!TVC_RBAC.isHqAccount(state.user)) return;
        if (!TVC_RBAC.can(state.user, TVC_RBAC.Action.REPLY_DEFECT_REPORT)) {
            await TVC_Dialog.alert('You do not have permission to approve Defect Report.');
        }
        state.listFilters.history = {
            ...state.listFilters.history,
            groupKeys: [],
            type: 'd',
            openOnly: true,
            noClosedOut: false,
            postponeAwaitingApproval: false,
            awaitingShipConfirm: false,
        };
        switchTab('history');
        TVC_ListFilters?.syncBtn('history');
    }

    async function openHqApprovePostponeReport() {
        if (!TVC_RBAC.isHqAccount(state.user)) return;
        if (!TVC_RBAC.canApproveHqReport(state.user)) {
            await TVC_Dialog.alert('You do not have permission to approve Postpone Report.');
        }
        state.listFilters.history = {
            ...state.listFilters.history,
            groupKeys: [],
            type: 'p',
            openOnly: false,
            noClosedOut: false,
            postponeAwaitingApproval: true,
            awaitingShipConfirm: false,
        };
        switchTab('history');
        TVC_ListFilters?.syncBtn('history');
    }

    function runningHoursMenuVisible() {
        if (!state.user) return false;
        if (TVC_RBAC.isHqAccount(state.user)) return state.department !== 'DECK';
        const f = typeof TVC_Space !== 'undefined' ? TVC_Space.getUiFeatures(state.user) : {};
        return f.showRunningHours !== false;
    }

    function superHqAdminMenuSections() {
        const st = typeof TVC_AdminRegistry !== 'undefined' ? TVC_AdminRegistry.stats() : { companies: 0, vessels: 0 };
        return [
            {
                key: 'administration',
                tone: 'necessary',
                title: 'Administration',
                items: [
                    {
                        label: `Registry · ${st.companies} companies · ${st.vessels} vessels`,
                        textOnly: true,
                    },
                    {
                        label: 'Company & Vessel Registry',
                        tag: '1',
                        action: 'TVC_App.openAdminRegistryHub()',
                    },
                    {
                        label: 'Universal Setup.exe…',
                        tag: '2',
                        action: 'TVC_App.openAdminUniversalSetupModal()',
                    },
                    {
                        label: 'Seat License…',
                        tag: '3',
                        action: 'TVC_App.openAdminSeatLicenseModal()',
                    },
                ],
            },
        ];
    }

    function menuModel() {
        const c = menuCounts();
        const isHq = state.user && TVC_RBAC.isHqAccount(state.user);
        const isSuperHq = state.user && TVC_RBAC.isSuperHqAccount?.(state.user);
        const isMaster = state.user && TVC_Space.isCaptainHub(state.user);

        const shipDailyItems = [
            { label: 'Check PMS', tag: 'D', action: "TVC_App.menuAction('checkPlan')", badge: c.overdue, badgeTone: 'red' },
            { label: 'Confirm Report', tag: 'C', action: "TVC_App.menuAction('confirmReport')", badge: c.reportConfirmPending, badgeTone: 'amber' },
        ];
        const hqDailyItems = [
            { label: 'Check PMS', tag: 'D', action: "TVC_App.menuAction('checkPlan')", badge: c.overdue, badgeTone: 'red' },
            { label: 'Approve Report', tag: 'B', action: "TVC_App.menuAction('approveReport')", badge: c.hqApprovePending, badgeTone: 'amber' },
        ];
        const necessaryItems = menuNecessaryItems();

        if (isHq) {
            const hqMonthlyItems = [
                ...(runningHoursMenuVisible() ? [{ label: 'Check Running Hours', tag: 'C', action: "TVC_App.menuAction('runHour')" }] : []),
            ];
            const sections = [
                { key: 'daily', tone: 'daily', title: 'Routine Tasks', items: hqDailyItems },
                { key: 'monthly', tone: 'monthly', title: 'Monthly Report', items: hqMonthlyItems },
                { key: 'necessary', tone: 'necessary', title: 'If Necessary', items: necessaryItems },
            ];
            if (isSuperHq) {
                sections.push(...filterAdminMenuForWeb(superHqAdminMenuSections()));
            }
            return sections;
        }

        const shipMonthly = shipMonthlyReportItems();

        if (isMaster) {
            return [
                { key: 'daily', tone: 'daily', title: 'Routine Tasks', items: shipDailyItems },
                { key: 'monthly', tone: 'monthly', title: 'Monthly Report', items: hubMonthlyReportItems() },
                { key: 'necessary', tone: 'necessary', title: 'If Necessary', items: necessaryItems },
            ];
        }

        return [
            { key: 'daily', tone: 'daily', title: 'Routine Tasks', items: shipDailyItems },
            { key: 'monthly', tone: 'monthly', title: 'Monthly Report', items: shipMonthly },
            { key: 'necessary', tone: 'necessary', title: 'If Necessary', items: necessaryItems },
        ];
    }

    /** Master Hub — station ZIP merge + HQ export only (no Update Work Plan on hub PC) */
    function hubMonthlyReportItems() {
        return [
            {
                label: 'Import Engine/Deck station ZIP (Data Export & Import — match Deck/Engine toggle)',
                textOnly: true,
            },
            {
                label: 'Export Monthly Report to Company (Data Export & Import — after station merge)',
                textOnly: true,
            },
        ];
    }

    /** Confirmer (CE / Captain) Monthly Report: guide text + RH */
    function shipMonthlyReportItems() {
        const items = [];
        const isShipConfirmer = state.user
            && TVC_RBAC.isApprover(state.user)
            && !TVC_RBAC.isHqAccount(state.user);
        if (isShipConfirmer) {
            items.push({
                label: 'Check Report History (for Report Confirm)',
                textOnly: true,
            });
        }
        items.push(
            { label: 'Update Running Hours', tag: 'C', action: "TVC_App.menuAction('runHour')", feature: 'showRunningHours' },
        );
        return items;
    }

    function menuNecessaryItems() {
        const role = state.user
            ? (TVC_RBAC.resolveUserRole?.(state.user) || state.user.role)
            : null;
        const isAuthor = role === TVC_RBAC.Role.SHIP_OFFICER;
        return [
                    { label: 'Database Backup & Restore', tag: 'C', action: "TVC_App.menuAction('backup')" },
            { label: 'Data Export & Import', tag: 'C', action: 'TVC_App.openMenuXferMenu()', feature: 'showDataXfer' },
            ...(isAuthor ? [] : [
            { label: 'View Data History', tag: 'C', action: 'TVC_App.openMenuHistoryModal()' },
            ]),
        ];
    }

    function isMasterExcelHistoryRow(row) {
        const d = String(row?.direction || '').toUpperCase();
        return d === 'PMS_MASTER' || d === 'SPARE_MASTER'
            || d === 'PMS_MASTER_BACKUP' || d === 'SPARE_MASTER_BACKUP';
    }

    function menuXferCategoryFromRow(row) {
        if (isMasterExcelHistoryRow(row)) return null;
        const d = String(row?.direction || '').toUpperCase();
        const pkg = String(row?.package_type || '').toUpperCase();
        const fn = String(row?.filename || row?.file_name || '').toLowerCase();
        if (d === 'VESSEL_PROFILE_HQ_TO_SHIP' || /VESSEL_PROFILE/.test(d) || /vesselprofile|vessel_profile/.test(fn)) {
            return 'Vessel Profile';
        }
        if (pkg === 'MONTHLY' || pkg === 'COMPANY_REPORT' || d.includes('MONTHLY')
            || /(^|_)monthly(_|\.|$)/.test(fn) || /_pms_export_/.test(fn) || /_company_report_/.test(fn)) {
            return 'Monthly Report';
        }
        if (pkg === 'CASE' || pkg.startsWith('DEFECT') || pkg.startsWith('WORK_PERMIT') || pkg.startsWith('POSTPONE')
            || d.startsWith('DEFECT_') || d === 'DEFECT_IMPORT'
            || d.startsWith('WORK_PERMIT_') || d === 'WORK_PERMIT_IMPORT'
            || d.startsWith('POSTPONE_') || d === 'POSTPONE_IMPORT'
            || /casereport|case_report/.test(fn)
            || /defect/.test(fn)
            || /workpermit|work_permit/.test(fn)
            || /postpone/.test(fn)) {
            return 'Case Report';
        }
        return 'Monthly Report';
    }

    function resetMenuXfer() {
        _menuXfer = {
            step: 'mode',
            importType: null, // case | monthly | vesselProfile | appUpdate
        };
        const body = document.getElementById('menuXferBody');
        if (body) {
            body._menuXferCaseBound = false;
            body._menuXferDefectBound = false;
            body._menuXferPostponeBound = false;
            body._menuXferWorkPermitBound = false;
            body._menuXferMonthlyBound = false;
        }
    }

    const MENU_IMPORT_TYPES = [
        { key: 'appUpdate', label: 'App Update' },
        { key: 'case', label: 'Case Report' },
        { key: 'monthly', label: 'Monthly Report' },
        { key: 'vesselProfile', label: 'Vessel Profile' },
    ];

    function menuImportTypesForUser(user) {
        return MENU_IMPORT_TYPES.filter(t => t.key === 'case' || t.key === 'monthly');
    }

    function menuXferStationContext(user) {
        if (!user || typeof TVC_Space === 'undefined') return null;
        if (TVC_Space.isCaptainHub(user)) return 'master';
        if (TVC_Space.isStationPc(user)) return 'station';
        if (TVC_RBAC.isHqAccount(user)) return 'hq';
        return null;
    }

    function menuXferDefaultChannelHint(user) {
        const ctx = menuXferStationContext(user);
        if (ctx === 'station') {
            return 'Export Monthly Report ZIP → Master (or HQ direct, same dept). Import HQ reply here — Engine/Deck only, no cross-dept.';
        }
        if (ctx === 'master') {
            return 'Import station ZIP → Export to HQ. After HQ reply Import, Export again → Engine/Deck station (CE/C/O). Match the Deck/Engine toggle. Online: Push to HQ / Pull HQ reply (V-SAT). FBB: use ZIP.';
        }
        if (ctx === 'hq') {
            return 'Import vessel ZIP (station export or Master report). Engine/Deck toggle must match file. HQ reply → Master or station direct. Online: Pull from vessel / Push reply (V-SAT). FBB: use ZIP.';
        }
        return 'Default transfer: offline ZIP.';
    }

    function menuXferOnlineSyncHtml(user) {
        const f = typeof TVC_Space !== 'undefined' ? TVC_Space.getUiFeatures(user) : {};
        if (!f.showOnlineSync || typeof TVC_OnlineSync === 'undefined') return '';
        const online = TVC_OnlineSync.isAvailable();
        const msg = TVC_OnlineSync.statusMessage();
        const isHq = TVC_RBAC.isHqAccount(user);
        const isMaster = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user);
        const buttons = [];
        if (isHq) {
            buttons.push({ dir: 'HQ_PULL', label: 'Pull from vessel (online)' });
            buttons.push({ dir: 'HQ_PUSH', label: 'Push reply to vessel (online)' });
        } else if (isMaster) {
            buttons.push({ dir: 'SHIP_TO_HQ', label: 'Push to HQ (online)' });
            buttons.push({ dir: 'SHIP_PULL', label: 'Pull HQ reply (online)' });
        }
        if (!buttons.length) return '';
        const btnHtml = buttons.map(b => `
                <button type="button" class="btn spare-sync-btn menu-xfer-online-btn${online ? '' : ' disabled'}"${online ? '' : ' disabled'}
                    onclick="TVC_App.menuXferTryOnlineSync('${escAttr(b.dir)}')">${esc(b.label)}</button>`).join('');
        return `
            <div class="menu-xfer-online${online ? '' : ' menu-xfer-online-disabled'}">
                <p class="spare-sync-note muted">${esc(msg)}</p>
                <p class="spare-sync-note muted">V-SAT: online sync OK (may take several minutes). FBB / low bandwidth: use Export/Import ZIP.</p>
                <div class="spare-sync-actions menu-xfer-online-actions">${btnHtml}
                </div>
            </div>`;
    }

    async function menuXferTryOnlineSync(direction) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || typeof TVC_OnlineSync === 'undefined') return;
        try {
            const isHq = TVC_RBAC.isHqAccount(user);
            const vesselId = isHq ? state.selectedVesselId : undefined;
            if ((direction === 'HQ_PULL' || direction === 'HQ_PUSH') && !vesselId) {
                await TVC_Dialog.alert('Select a vessel in Ship List before online sync.');
                return;
            }
            const busyByDir = {
                HQ_PULL: 'Pulling latest vessel report from cloud…\n(V-SAT links may take several minutes.)',
                HQ_PUSH: 'Building HQ reply and uploading to cloud…\n(V-SAT links may take several minutes.)',
                SHIP_TO_HQ: 'Building report and uploading to cloud…\n(V-SAT links may take several minutes.)',
                SHIP_PULL: 'Pulling latest HQ reply from cloud…\n(V-SAT links may take several minutes.)',
            };
            await TVC_Dialog.alert(busyByDir[direction] || 'Online sync in progress…');
            const dept = (direction === 'HQ_PUSH' && typeof getAppDepartment === 'function')
                ? getAppDepartment()
                : undefined;
            const result = await TVC_OnlineSync.syncNow(user, direction, { vesselId, dept });
            if (result.status === 'OK' && (isHq || direction === 'SHIP_PULL')) {
                await loadData();
                rerenderCurrentTab();
            }
            await TVC_Dialog.alert(result.message || 'Online sync completed.');
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    function menuXferCanExportTarget(user, target) {
        if (!user || !target) return false;
        if (target === 'COMPANY') {
            return typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user);
        }
        const dept = target;
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)) {
            const own = user.department || (TVC_Space.getStation(user) === TVC_Space.Station.CCR ? 'DECK' : 'ENGINE');
            return dept === own;
        }
        if (typeof TVC_Space !== 'undefined' && user.station) {
            return TVC_Space.canAccessDepartment(user, dept);
        }
        return TVC_RBAC.canAccessDepartment(user, dept);
    }

    function menuXferResolveExportTarget(user, exportType) {
        if (!user) return null;
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)) {
            if (exportType === 'monthly') {
                const dept = String(state.department || user.department || '').toUpperCase();
                return (dept === 'DECK' || dept === 'ENGINE') ? dept : null;
            }
            return 'COMPANY';
        }
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)) {
            return user.department || (TVC_Space.getStation(user) === TVC_Space.Station.CCR ? 'DECK' : 'ENGINE');
        }
        if (TVC_RBAC.isHqAccount(user)) {
            return state.department || user.department || null;
        }
        return user.department || state.department || null;
    }

    function monthlyHasHqReplyForDept(dept) {
        const target = dept || getPlanLockDept();
        return (state.reports || []).some(r => {
            TVC_WorkReport.fromLegacy(r);
            if (target && reportDept(r) !== target) return false;
            if (String(r.company_comment || '').trim()) return true;
            return String(r.status || '').toUpperCase() === 'APPROVED';
        });
    }

    function menuXferExportTargetLabel(target) {
        if (target === 'COMPANY') return 'Company (HQ)';
        const user = state.user;
        if (target && typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)) {
            if (monthlyHasHqReplyForDept(target)) {
                return target === 'DECK' ? 'Deck station (C/O)' : 'Engine station (CE)';
            }
            return `Company (HQ) — ${TVC_RBAC.getDeptLabel(target)}`;
        }
        if (target && typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)) {
            return `Master Hub (${TVC_RBAC.getDeptLabel(target)})`;
        }
        return target ? TVC_RBAC.getDeptLabel(target) : '—';
    }

    function menuXferDefectExportRows() {
        const target = menuXferResolveExportTarget(state.user, 'defect');
        let cases = workHistoryDefectCases();
        if (TVC_RBAC.isHqAccount(state.user)) {
            cases = cases.filter(r =>
                r.hq_synced === true
                || r.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
                || r.status === TVC_DefectCase.Status.AWAITING_COMPLETION
                || (r.status === TVC_DefectCase.Status.DRAFT && r.visible_in_list !== false)
            );
            if (state.selectedVesselId) {
                cases = cases.filter(r => r.vessel_id === state.selectedVesselId);
            }
            if (state.department) {
                cases = cases.filter(c => defectCaseDept(c) === state.department);
            }
        } else if (target && target !== 'COMPANY') {
            cases = cases.filter(c => TVC_DefectCase.belongsToDepartment(c, target));
        }
        cases = defectCasesForExportTarget(cases, target || 'COMPANY');
        return cases.sort(compareDefectCaseByReportedDate);
    }

    function isDefectCompletionReady(row) {
        if (!row) return false;
        if (row.defect_cleared && String(row.ship_verified_date || '').trim()) return true;
        if (row.status === TVC_DefectCase.Status.AWAITING_COMPLETION) return true;
        return row.status === TVC_DefectCase.Status.CLOSED && TVC_DefectCase.isPhase3DcComplete(row);
    }

    function isDefectCompletionExported(row) {
        if (row?.completion_exported_at) return true;
        return /completion/i.test(String(row?.last_export_filename || ''));
    }

    function isDefectCloseExported(row) {
        if (row?.close_forwarded_at) return true;
        return /close/i.test(String(row?.last_export_filename || ''));
    }

    function isDefectStationCompletionPending(row) {
        return isDefectCompletionReady(row) && !isDefectCompletionExported(row);
    }

    function isDefectHqClosePending(row) {
        if (!row || row.status !== TVC_DefectCase.Status.CLOSED) return false;
        if (!TVC_DefectCase.isHqReplyExported(row)) return false;
        return !isDefectCloseExported(row);
    }

    function menuXferDefectRowSelectable(row) {
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (isDefectHqClosePending(row)) return true;
            if (TVC_DefectCase.isHqReplyExported(row)) return false;
            const shipSubmitted = !!(row.confirmed_at || row.confirmed_by || row.submitted_at || row.phase1_locked
                || row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY);
            return shipSubmitted;
        }
        const st = TVC_DefectCase.listWorkflowStatus(row);
        if (isMasterHubMode()) {
            if (TVC_DefectCase.isPhase4CloseForwardPending(row)) return true;
            if (TVC_DefectCase.isPhase3CompletionHubPending(row)) return true;
            if (isDefectStationCompletionPending(row)) return true;
            if (TVC_DefectCase.isHqReplyStationForwardPending(row)) return true;
            if (!TVC_HubRelay.canHubLegExport(row)) return false;
            if (st === 'Submitted') return true;
            return false;
        }
        if (isDefectStationCompletionPending(row)) return true;
        if (!TVC_HubRelay.canStationLegExport(row)) return false;
        if (st === 'Confirmed') return true;
        return false;
    }

    function menuXferDefectSelectDisabledTitle(row) {
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (isDefectHqClosePending(row)) return '';
            if (TVC_DefectCase.isHqReplyExported(row)) return 'Already exported';
            const shipSubmitted = !!(row.confirmed_at || row.confirmed_by || row.submitted_at || row.phase1_locked
                || row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY);
            if (!shipSubmitted) return 'Awaiting ship submission';
            return 'Not exportable';
        }
        const st = TVC_DefectCase.listWorkflowStatus(row);
        if (isMasterHubMode()) {
            if (TVC_DefectCase.isPhase4CloseForwardPending(row)) return '';
            if (TVC_DefectCase.isPhase3CompletionHubPending(row)) return '';
            if (isDefectStationCompletionPending(row)) return '';
            if (TVC_DefectCase.isHqReplyStationForwardPending(row)) return '';
            if (row.hq_reply_forwarded_at) return 'Already forwarded to Station';
            if (row.close_forwarded_at) return 'Already forwarded to Station';
            if (TVC_HubRelay.isHubSynced(row)) return TVC_HubRelay.hubExportBlockedTitle();
            if (st !== 'Submitted' && st !== 'Approved' && !isDefectCompletionReady(row)) {
                return 'Awaiting station export first';
            }
            return 'Not exportable';
        }
        if (isDefectStationCompletionPending(row)) return '';
        if (st === 'Submitted') return TVC_HubRelay.stationExportBlockedTitle();
        if (st === 'Approved') return 'Approved — not exportable here';
        if (st === 'Draft') return 'Draft — not in list workflow';
        if (st === 'Reported') return 'Reported — confirm first';
        return 'Not exportable';
    }

    const MENU_XFER_EXPORT_COLSPAN = 10;

    function workReportXferTypeHtml(report) {
        const wt = report?.work_type;
        if (wt === 'POSTPONE') {
            return '<td class="hist-type hist-type-postpone" title="Postpone Report"><span class="hist-type-mark">P</span></td>';
        }
        if (wt === 'TROUBLE') {
            return '<td class="hist-type hist-type-trouble" title="Trouble Report"><span class="hist-type-mark">T</span></td>';
        }
        return '<td class="hist-type hist-type-maint" title="Maintenance Report"><span class="hist-type-mark">M</span></td>';
    }

    function workReportHistoryColumns(report) {
        const job = resolveReportJob(report);
        return {
            jobCode: report.job_code || report.job_codes?.[0] || job?.job_code || '',
            sort1: job?.item_sort1 || '',
            sort2: job?.item_sort2 || '',
        };
    }

    function monthlyExportWorkReportRows(dept, opts = {}) {
        const snapshot = opts.snapshot === true;
        if (!snapshot) return stationPendingConfirmedReportRows(dept);
        const target = dept || getPlanLockDept();
        return (state.reports || []).filter(r => {
            TVC_WorkReport.fromLegacy(r);
            return reportDept(r) === target;
        }).sort(compareReportByReportedDate);
    }

    function menuXferMonthlyRowSelectable(row) {
        TVC_WorkReport.fromLegacy(row);
        if (isMasterHubMode()) {
            if (workReportListWorkflowStatus(row) !== 'Submitted') return false;
            return TVC_HubRelay.canHubLegExport(row);
        }
        if (workReportListWorkflowStatus(row) !== 'Confirmed') return false;
        return TVC_HubRelay.canStationLegExport(row);
    }

    function menuXferMonthlySelectDisabledTitle(row) {
        if (isMasterHubMode()) {
            if (TVC_HubRelay.isHubSynced(row)) return TVC_HubRelay.hubExportBlockedTitle();
            const st = workReportListWorkflowStatus(row);
            if (st !== 'Submitted') return 'Awaiting station export first';
            return 'Not exportable';
        }
        if (!TVC_HubRelay.canStationLegExport(row)) return TVC_HubRelay.stationExportBlockedTitle();
        const st = workReportListWorkflowStatus(row);
        if (st === 'Reported') return 'Reported — confirm first';
        if (st !== 'Confirmed') return 'Confirm first';
        return 'Not exportable';
    }

    function menuXferCurrentMonthPeriod() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const last = String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0');
        return { from: `${y}-${m}-01`, to: `${y}-${m}-${last}` };
    }

    function menuXferDefaultMonthlyFilters() {
        return { type: 'all', groupKeys: [] };
    }

    function getMenuXferMonthlyFilters() {
        if (!_menuXfer.monthlyFilters) _menuXfer.monthlyFilters = menuXferDefaultMonthlyFilters();
        return _menuXfer.monthlyFilters;
    }

    function setMenuXferMonthlyFilters(patch) {
        _menuXfer.monthlyFilters = { ...menuXferDefaultMonthlyFilters(), ...getMenuXferMonthlyFilters(), ...patch };
        refreshMenuXferMonthlyList();
        TVC_ListFilters?.refreshOpenPopover?.();
    }

    function resetMenuXferMonthlyListChrome() {
        const period = menuXferCurrentMonthPeriod();
        _menuXfer.monthlySearch = '';
        _menuXfer.monthlyPeriodFrom = period.from;
        _menuXfer.monthlyPeriodTo = period.to;
        _menuXfer.monthlyFilters = menuXferDefaultMonthlyFilters();
    }

    function menuXferMonthlyRowType(row) {
        return row?.work_type === 'POSTPONE' ? 'p' : 'm';
    }

    function menuXferMonthlyRowGroupKey(row) {
        return menuXferCaseEntryGroupKey({
            kind: row?.work_type === 'POSTPONE' ? 'postpone' : 'maintenance',
            row,
        });
    }

    function menuXferMonthlyAllRows() {
        const dept = getPlanLockDept();
        const snapshot = monthlyExportUsesSnapshot(state.user, dept);
        return monthlyExportWorkReportRows(dept, { snapshot });
    }

    function menuXferMonthlyVisibleRows(rows) {
        const list = rows || menuXferMonthlyAllRows();
        const f = getMenuXferMonthlyFilters();
        const searchQ = (_menuXfer.monthlySearch || '').trim().toLowerCase();
        const from = _menuXfer.monthlyPeriodFrom || '';
        const to = _menuXfer.monthlyPeriodTo || '';
        const type = f.type || 'all';
        return list.filter(row => {
            if (type !== 'all' && menuXferMonthlyRowType(row) !== type) return false;
            if (!isDateInPeriod(listReportedDateStr(row), from, to)) return false;
            if (f.groupKeys?.length && !f.groupKeys.includes(menuXferMonthlyRowGroupKey(row))) return false;
            if (searchQ) {
                const cols = workReportHistoryColumns(row);
                const hay = [
                    row.id, cols.jobCode, cols.sort1, cols.sort2,
                    workReportListWorkflowStatus(row), row.report_date,
                ].filter(Boolean).join(' ').toLowerCase();
                if (!hay.includes(searchQ)) return false;
            }
            return true;
        });
    }

    function menuXferCollectSelectedMonthlyIds() {
        const visible = new Set(
            menuXferMonthlyVisibleRows().filter(menuXferMonthlyRowSelectable).map(r => r.id),
        );
        return Object.keys(_menuXfer.selectedMonthlyReportIds || {})
            .filter(id => _menuXfer.selectedMonthlyReportIds[id] && visible.has(id));
    }

    function menuXferMonthlySelectedKindCounts() {
        const selected = new Set(menuXferCollectSelectedMonthlyIds());
        const counts = { w: 0, m: 0, d: 0, p: 0, c: 0 };
        menuXferMonthlyVisibleRows().forEach(row => {
            if (!selected.has(row.id)) return;
            counts[menuXferMonthlyRowType(row)]++;
        });
        return counts;
    }

    function menuXferMonthlyTypeCountsHtml() {
        const counts = menuXferMonthlySelectedKindCounts();
        return ['w', 'm', 'd', 'p', 'c'].map(k => {
            const n = counts[k] || 0;
            const label = k.toUpperCase();
            return n ? `${label} <strong>${n}</strong>` : `${label} ${n}`;
        }).join(' · ');
    }

    function menuXferUpdateMonthlyTypeCounts() {
        const el = document.getElementById('menuXferMonthlyTypeCounts');
        if (el) el.innerHTML = menuXferMonthlyTypeCountsHtml();
    }

    function menuXferPmsOutstandingMatrix() {
        if (typeof TVC_OutstandingTasks?.buildPmsMatrix === 'function') {
            return TVC_OutstandingTasks.buildPmsMatrix(state);
        }
        const dash = actualDashboardCounts();
        return {
            overdue: { total: dash.overdue },
            due: { total: dash.due30 },
            postponed: { total: dash.postponed },
            defect: { total: 0 },
        };
    }

    function menuXferMonthlyOutstandingSnapshot() {
        const m = menuXferPmsOutstandingMatrix();
        return {
            overdue: m.overdue?.total ?? 0,
            due: m.due?.total ?? 0,
            postponed: m.postponed?.total ?? 0,
            defect: m.defect?.total ?? 0,
        };
    }

    function menuXferVesselOpenReports() {
        const dept = getPlanLockDept();
        const isOpen = (st) => st === 'Reported' || st === 'Draft';
        const jobs = state.jobs || [];
        const w = (state.workPermits || []).filter(r => {
            if (r.visible_in_list === false) return false;
            if (dept && typeof workPermitBelongsToDept === 'function' && !workPermitBelongsToDept(r, dept, jobs)) return false;
            return isOpen(TVC_WorkPermit.listWorkflowStatus(r));
        });
        const reports = (state.reports || []).filter(r => {
            TVC_WorkReport.fromLegacy(r);
            return !dept || reportDept(r) === dept;
        });
        const m = reports.filter(r => r.work_type !== 'POSTPONE' && isOpen(workReportListWorkflowStatus(r)));
        const p = reports.filter(r => r.work_type === 'POSTPONE' && isOpen(workReportListWorkflowStatus(r)));
        const d = (state.defectCases || []).filter(dc => {
            if (dc.visible_in_list === false) return false;
            if (dept && !TVC_DefectCase.belongsToDepartment(dc, dept)) return false;
            return isOpen(TVC_DefectCase.listWorkflowStatus(dc));
        });
        const c = workHistoryConsumeLogs().filter(log => {
            if (dept && log.department && String(log.department).toUpperCase() !== dept) return false;
            return isOpen(consumeHistoryFields(log).status);
        });
        return {
            w: w.length, m: m.length, d: d.length, p: p.length, c: c.length,
            total: w.length + m.length + d.length + p.length + c.length,
        };
    }

    function menuXferVesselMonthlyBlocked() {
        if (TVC_RBAC.isHqAccount(state.user) || isMasterHubMode()) return false;
        return menuXferVesselOpenReports().total > 0;
    }

    function menuXferMonthlyPlanHtml() {
        const isHq = TVC_RBAC.isHqAccount(state.user);
        const isMaster = isMasterHubMode();
        const dept = getPlanLockDept();
        const matrix = menuXferPmsOutstandingMatrix();
        const open = (!isHq && !isMaster) ? menuXferVesselOpenReports() : null;
        const lock = state._originalPlanLock?.[dept];
        const store = typeof TVC_PMS !== 'undefined' ? TVC_PMS.readStore() : {};
        const lastUpdated = String(store._lastUpdatedDate || '').slice(0, 10);
        const showRh = dept !== 'DECK' && typeof TVC_PMS !== 'undefined';
        const rhNodes = showRh
            ? (state.idx?.groupNodes || []).filter(n =>
                TVC_PMS.isTrackedGroup(n.label) && n.department === 'ENGINE')
            : [];
        const rhRows = rhNodes.map(n => {
            const rec = store[n.key] || {};
            return `<li>${esc(n.label)} — last month ${esc(String(Number(rec.prevMonth) || 0))} · total ${esc(String(Number(rec.totalRunHours) || 0))} · expected ${esc(String(Number(rec.expectedNextMonth) || 0))}</li>`;
        }).join('');
        const rhJobs = showRh
            ? (state.jobs || []).filter(j =>
                TVC_PMS.isRunHourJob(j) && TVC_PMS.isTrackedGroup(j.group)
                && String(j.department || '').toUpperCase() === 'ENGINE')
            : [];
        const nextReady = rhJobs.filter(j => j.next_date).length;
        const hint = isHq
            ? 'Monthly snapshot for HQ reply. Review imported running hours and Outstanding Code.'
            : isMaster
                ? 'Monthly Report snapshot → Company. Running Hours and Update Work Plan are done on station PCs.'
                : 'On the first day of the month: enter last month running hours, calculate total, then enter this month expected hours so time-based Job Codes get NEXT DATE. Then calculate PMS Outstanding Code.';
        const canRh = !isHq && !isMaster && runningHoursMenuVisible();
        return `
            <div class="spare-sync-note muted menu-xfer-monthly-plan">
                <p>${esc(hint)}</p>
                ${lock?.month ? `<p>Plan month: <strong>${esc(lock.month)}</strong>${lock.stats?.statusDate ? ` · Status On ${esc(lock.stats.statusDate)}` : ''}</p>` : ''}
                ${showRh ? `<p>Running Hours last updated: <strong>${esc(lastUpdated || '—')}</strong>${rhJobs.length ? ` · Time-based NEXT DATE ${nextReady} / ${rhJobs.length}` : ''}</p>` : ''}
                <p>PMS Outstanding Code — Overdue <strong>${esc(String(matrix.overdue?.total ?? 0))}</strong> · Due <strong>${esc(String(matrix.due?.total ?? 0))}</strong> · Postponed <strong>${esc(String(matrix.postponed?.total ?? 0))}</strong> · Defect <strong>${esc(String(matrix.defect?.total ?? 0))}</strong></p>
                ${open?.total ? `<p class="menu-xfer-monthly-block">Monthly export is locked until every report is Confirmed or later. Still open: W ${open.w} · M ${open.m} · D ${open.d} · P ${open.p} · C ${open.c}.</p>` : ''}
                ${rhRows ? `<ul class="menu-xfer-monthly-rh">${rhRows}</ul>` : ''}
                ${canRh ? `<div class="menu-xfer-monthly-plan-actions">
                    <button type="button" class="btn btn-sm" onclick="TVC_App.menuXferOpenRunningHours()">Update Running Hours</button>
                </div>` : ''}
            </div>`;
    }

    function menuXferMonthlyTableRowsHtml(rows, filtered, dest, lookup, sel) {
        if (!rows.length) {
            return `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No Monthly Reports in scope for ${esc(dest)}.</td></tr>`;
        }
        if (!filtered.length) {
            return `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No matches for period / filter / search.</td></tr>`;
        }
        return filtered.map(row => {
            const cols = workReportHistoryColumns(row);
            const st = workReportListWorkflowStatus(row);
            const dt = formatCmaxsHistDate(row.report_date || row.created_at);
            const form = row.report_form || row.job_items?.[0]?.form || {};
            const fileNo = String(form.fileNo || row.file_no || '').trim() || '—';
            const job = resolveReportJob(row);
            const canSelect = menuXferMonthlyRowSelectable(row);
            const checked = canSelect && !!sel[row.id];
            const chk = canSelect
                ? `<input type="checkbox" class="menu-xfer-monthly-chk" data-monthly-id="${escAttr(row.id)}"${checked ? ' checked' : ''}>`
                : `<input type="checkbox" disabled title="${escAttr(menuXferMonthlySelectDisabledTitle(row))}">`;
            return `<tr class="menu-xfer-monthly-row${canSelect ? '' : ' menu-xfer-monthly-row-disabled'}">
                    <td class="menu-xfer-chk">${chk}</td>
                    ${workReportXferTypeHtml(row)}
                    <td>${esc(fileNo)}</td>
                    ${menuXferCritCell(!!(job && jobShowsCriticalEquipmentMark(job)))}
                    <td>${cols.jobCode ? `<strong>${esc(cols.jobCode)}</strong>` : '—'}</td>
                    <td>${histCellHtml(cols.sort1)}</td>
                    <td>${histCellHtml(cols.sort2)}</td>
                    <td>${esc(dt || '—')}</td>
                    <td class="hist-status">${esc(st)}</td>
                    <td class="menu-xfer-file">${menuXferRowExportFilename(row, lookup, 'monthly')}</td>
                </tr>`;
        }).join('');
    }

    function refreshMenuXferMonthlyList() {
        if (_menuXfer.step !== 'export-monthly-select') return;
        const tbody = document.querySelector('#menuXferBody .menu-xfer-monthly-table tbody');
        if (!tbody) {
            renderMenuXferModal();
            return;
        }
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'monthly'));
        const rows = menuXferMonthlyAllRows();
        const filtered = menuXferMonthlyVisibleRows(rows);
        const sel = _menuXfer.selectedMonthlyReportIds || {};
        const lookup = _menuXfer.exportFilenameLookup || {};
        const selectable = filtered.filter(menuXferMonthlyRowSelectable);
        tbody.innerHTML = menuXferMonthlyTableRowsHtml(rows, filtered, dest, lookup, sel);
        const count = document.getElementById('menuXferMonthlyCount');
        if (count) count.textContent = `${filtered.length} / ${rows.length} entries`;
        const selectAll = document.getElementById('menuXferMonthlySelectAll');
        if (selectAll) {
            selectAll.checked = selectable.length > 0 && selectable.every(r => sel[r.id]);
            selectAll.disabled = selectable.length === 0;
        }
        document.getElementById('menuXferMonthlyPeriodFilter')?.classList.toggle('active', !!(_menuXfer.monthlyPeriodFrom || _menuXfer.monthlyPeriodTo));
        const fromEl = document.getElementById('menuXferMonthlyPeriodFrom');
        const toEl = document.getElementById('menuXferMonthlyPeriodTo');
        if (fromEl && document.activeElement !== fromEl) fromEl.value = _menuXfer.monthlyPeriodFrom || '';
        if (toEl && document.activeElement !== toEl) toEl.value = _menuXfer.monthlyPeriodTo || '';
        const searchEl = document.getElementById('menuXferMonthlySearch');
        if (searchEl && document.activeElement !== searchEl) searchEl.value = _menuXfer.monthlySearch || '';
        updateSearchClearBtnForEl(searchEl);
        menuXferUpdateMonthlyExportBtn();
        TVC_ListFilters?.syncBtn('monthlyXfer');
    }

    function menuXferMonthlySelectHtml() {
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'monthly'));
        const rows = menuXferMonthlyAllRows();
        const sel = _menuXfer.selectedMonthlyReportIds || {};
        const lookup = _menuXfer.exportFilenameLookup || {};
        const filtered = menuXferMonthlyVisibleRows(rows);
        const selectable = filtered.filter(menuXferMonthlyRowSelectable);
        const selectedCount = menuXferCollectSelectedMonthlyIds().length;
        const periodActive = !!(_menuXfer.monthlyPeriodFrom || _menuXfer.monthlyPeriodTo);
        const allChecked = selectable.length > 0 && selectable.every(r => sel[r.id]);
        const tableBody = menuXferMonthlyTableRowsHtml(rows, filtered, dest, lookup, sel);
        const isHq = TVC_RBAC.isHqAccount(state.user);
        const hint = isHq
            ? 'Check Monthly Reports for HQ reply → vessel.'
            : `Check Monthly Reports for the Period so Company can review the month work plan → <strong>${esc(dest)}</strong>`;
        return `
            <p class="spare-sync-hint">${hint}</p>
            <p class="menu-xfer-type-counts" id="menuXferMonthlyTypeCounts">${menuXferMonthlyTypeCountsHtml()}</p>
            ${menuXferMonthlyPlanHtml()}
            <div class="hist-toolbar hist-toolbar-filters list-filter-stack menu-xfer-case-filters">
                <div class="filter-bar list-filter-period-row">
                    <div id="menuXferMonthlyPeriodFilter" class="act-period-filter${periodActive ? ' active' : ''}" title="Filter by Reported Date">
                        <span class="act-period-label">Period</span>
                        <input type="text" id="menuXferMonthlyPeriodFrom" class="act-period-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" aria-label="Period from"
                            value="${escAttr(_menuXfer.monthlyPeriodFrom || '')}" onchange="TVC_App.menuXferMonthlySetPeriod()">
                        <span class="act-period-sep">~</span>
                        <input type="text" id="menuXferMonthlyPeriodTo" class="act-period-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" aria-label="Period to"
                            value="${escAttr(_menuXfer.monthlyPeriodTo || '')}" onchange="TVC_App.menuXferMonthlySetPeriod()">
                        <div class="list-filter-wrap">
                            <button type="button" id="menuXferMonthlyFilterBtn" class="btn btn-sm list-filter-btn" onclick="TVC_ListFilters.toggle('monthlyXfer', event)">Filter</button>
                        </div>
                    </div>
                    <button type="button" class="btn btn-sm act-period-clear" onclick="TVC_App.menuXferClearMonthlyPeriodAndFilters()">Clear</button>
                    <span class="count-label" id="menuXferMonthlyCount">${filtered.length} / ${rows.length} entries</span>
                </div>
                <div class="filter-bar list-filter-search-row">
                    <div class="search-field-wrap">
                        <input class="search-input" id="menuXferMonthlySearch" placeholder="Search JOB CODE / GROUP / DEFECT…"
                            value="${escAttr(_menuXfer.monthlySearch || '')}" oninput="TVC_App.menuXferMonthlySetSearch(this.value)">
                        <button type="button" class="search-clear-btn${_menuXfer.monthlySearch ? '' : ' hidden'}" title="Clear search" aria-label="Clear search"
                            onclick="TVC_App.clearSearchField('menuXferMonthlySearch')">×</button>
                    </div>
                </div>
            </div>
            <div class="menu-xfer-table-wrap">
                <table class="menu-xfer-table menu-xfer-monthly-table">
                    ${menuXferExportColgroupHtml()}
                    ${menuXferExportTheadHtml('menuXferMonthlySelectAll', allChecked, selectable)}
                    <tbody>${tableBody}</tbody>
                </table>
            </div>
            <div class="spare-sync-actions">
                <button type="button" id="menuXferMonthlyExportBtn" class="btn btn-green spare-sync-btn"${selectedCount && !menuXferVesselMonthlyBlocked() ? '' : ' disabled'} onclick="TVC_App.menuXferConfirmMonthlyExport()">${selectedCount ? `Export (${selectedCount})` : 'Export'}</button>
            </div>`;
    }

    async function menuXferMonthlySetPeriod() {
        const fromEl = document.getElementById('menuXferMonthlyPeriodFrom');
        const toEl = document.getElementById('menuXferMonthlyPeriodTo');
        const from = fromEl?.value || '';
        const to = toEl?.value || '';
        if (from && to && from > to) {
            await TVC_Dialog.alert('Start date cannot be after end date.');
            if (fromEl) fromEl.value = _menuXfer.monthlyPeriodFrom || '';
            if (toEl) toEl.value = _menuXfer.monthlyPeriodTo || '';
            return;
        }
        if (from === (_menuXfer.monthlyPeriodFrom || '') && to === (_menuXfer.monthlyPeriodTo || '')) return;
        _menuXfer.monthlyPeriodFrom = from;
        _menuXfer.monthlyPeriodTo = to;
        refreshMenuXferMonthlyList();
    }

    function menuXferClearMonthlyPeriodAndFilters() {
        _menuXfer.monthlyPeriodFrom = '';
        _menuXfer.monthlyPeriodTo = '';
        _menuXfer.monthlyFilters = menuXferDefaultMonthlyFilters();
        _menuXfer.monthlySearch = document.getElementById('menuXferMonthlySearch')?.value || _menuXfer.monthlySearch || '';
        TVC_ListFilters?.refreshOpenPopover?.();
        refreshMenuXferMonthlyList();
    }

    function menuXferMonthlySetSearch(value) {
        _menuXfer.monthlySearch = value || '';
        refreshMenuXferMonthlyList();
    }

    function menuXferOpenRunningHours() {
        if (!runningHoursMenuVisible()) return;
        openRunHoursModal();
    }

    async function menuXferOpenMonthlySelect() {
        _menuXfer.step = 'export-monthly-select';
        _menuXfer.selectedMonthlyReportIds = {};
        resetMenuXferMonthlyListChrome();
        _menuXfer.exportFilenameLookup = await buildMenuXferExportFilenameLookup('monthly');
        renderMenuXferModal();
    }

    function menuXferUpdateMonthlyExportBtn() {
        const btn = document.getElementById('menuXferMonthlyExportBtn');
        if (!btn) return;
        const count = menuXferCollectSelectedMonthlyIds().length;
        const blocked = menuXferVesselMonthlyBlocked();
        if (count === 0 || blocked) {
            btn.setAttribute('disabled', '');
            btn.textContent = count ? `Export (${count})` : 'Export';
            if (blocked) btn.title = 'Confirm every Reported / Draft report first.';
            else btn.removeAttribute('title');
        } else {
            btn.removeAttribute('disabled');
            btn.removeAttribute('title');
            btn.textContent = `Export (${count})`;
        }
        menuXferUpdateMonthlyTypeCounts();
    }

    function menuXferExportColgroupHtml() {
        return `<colgroup>
            <col class="menu-xfer-col-chk"><col class="menu-xfer-col-type"><col class="menu-xfer-col-file-no"><col class="menu-xfer-col-warn">
            <col class="menu-xfer-col-job"><col class="menu-xfer-col-sort"><col class="menu-xfer-col-sort2"><col class="menu-xfer-col-date"><col class="menu-xfer-col-status">
            <col class="menu-xfer-col-filename">
        </colgroup>`;
    }

    function menuXferExportTheadHtml(selectAllId, allChecked, selectable) {
        return `<thead><tr>
            <th class="menu-xfer-chk"><input type="checkbox" id="${selectAllId}"${allChecked ? ' checked' : ''}${selectable.length ? '' : ' disabled'}></th>
            <th class="hist-type-h">Type</th>
            <th>File No</th>
            <th class="hist-crit-h" title="Critical Equipment">⚠</th>
            <th>JOB CODE</th>
            <th>SORT-1</th>
            <th>SORT-2</th>
            <th><span class="hist-th-stack"><span>Reported</span><span>Date</span></span></th>
            <th>Status</th>
            <th class="menu-xfer-file-h">File Name</th>
        </tr></thead>`;
    }

    function menuXferCritCell(show) {
        if (!show) return '<td class="hist-crit" aria-hidden="true"></td>';
        return `<td class="hist-crit" title="Critical Equipment">${planCriticalMarkHtml()}</td>`;
    }

    function menuXferDefectSelectHtml() {
        const rows = menuXferDefectExportRows();
        const sel = _menuXfer.selectedDefectIds || {};
        const lookup = _menuXfer.exportFilenameLookup || {};
        const selectable = rows.filter(menuXferDefectRowSelectable);
        const selectedCount = selectable.filter(r => sel[r.id]).length;
        const allChecked = selectable.length > 0 && selectable.every(r => sel[r.id]);
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'defect'));
        const searchQ = (_menuXfer.defectSearch || '').trim().toLowerCase();
        const filteredRows = searchQ
            ? rows.filter(row => {
                const cols = defectHistoryColumns(row);
                const hay = [
                    row.file_no, cols.jobCode, cols.sort1, cols.sort2,
                    TVC_DefectCase.listWorkflowStatus(row),
                    row.case_no,
                ].filter(Boolean).join(' ').toLowerCase();
                return hay.includes(searchQ);
            })
            : rows;
        let tableBody = '';
        if (!rows.length) {
            tableBody = `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No defect reports in scope for ${esc(dest)}.</td></tr>`;
        } else if (!filteredRows.length) {
            tableBody = `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No matches for search.</td></tr>`;
        } else {
            tableBody = filteredRows.map(row => {
                const cols = defectHistoryColumns(row);
                const st = TVC_DefectCase.listWorkflowStatus(row);
                const dt = formatCmaxsHistDate(row.report_date || row.created_at);
                const canSelect = menuXferDefectRowSelectable(row);
                const checked = canSelect && !!sel[row.id];
                const chk = canSelect
                    ? `<input type="checkbox" class="menu-xfer-defect-chk" data-defect-id="${escAttr(row.id)}"${checked ? ' checked' : ''}>`
                    : `<input type="checkbox" disabled title="${escAttr(menuXferDefectSelectDisabledTitle(row))}">`;
                return `<tr class="menu-xfer-defect-row${canSelect ? '' : ' menu-xfer-defect-row-disabled'}">
                    <td class="menu-xfer-chk">${chk}</td>
                    <td class="hist-type hist-type-defect" title="Defect Report"><span class="hist-type-mark">D</span></td>
                    <td>${esc(String(row.file_no || '').trim() || '—')}</td>
                    ${menuXferCritCell(defectShowsCriticalEquipmentMark(row))}
                    <td>${cols.jobCode ? `<strong>${esc(cols.jobCode)}</strong>` : '—'}</td>
                    <td>${histCellHtml(cols.sort1)}</td>
                    <td>${histCellHtml(cols.sort2)}</td>
                    <td>${esc(dt || '—')}</td>
                    <td class="hist-status">${esc(st)}</td>
                    <td class="menu-xfer-file">${menuXferRowExportFilename(row, lookup, 'defect')}</td>
                </tr>`;
        }).join('');
        }
        return `
            <p class="spare-sync-hint">Check the defect reports to export → <strong>${esc(dest)}</strong>${isMasterHubMode() ? ' (Submitted → Company · Approved HQ replies → Station)' : ' (Confirmed only)'}</p>
            <p class="spare-sync-note muted">${rows.length} in list · ${selectable.length} selectable${isMasterHubMode() ? ' (Submitted to Company, or Approved HQ reply to Station)' : ' (Confirmed, not yet Submitted)'}. Same scope as Work History / Defect tab.</p>
            <div class="search-field-wrap menu-xfer-defect-search">
                <input type="text" class="search-input" id="menuXferDefectSearch" placeholder="Search File No / Job Code / SORT…" value="${escAttr(_menuXfer.defectSearch || '')}">
            </div>
            <div class="menu-xfer-table-wrap">
                <table class="menu-xfer-table menu-xfer-defect-table">
                    ${menuXferExportColgroupHtml()}
                    ${menuXferExportTheadHtml('menuXferDefectSelectAll', allChecked, selectable)}
                    <tbody>${tableBody}</tbody>
                </table>
            </div>
            <div class="spare-sync-actions">
                <button type="button" id="menuXferDefectExportBtn" class="btn btn-green spare-sync-btn"${selectedCount ? '' : ' disabled'} onclick="TVC_App.menuXferConfirmDefectExport()">${selectedCount ? `Export (${selectedCount})` : 'Export'}</button>
            </div>`;
    }

    function stationPendingConfirmedReportRows(dept) {
        const target = dept || getPlanLockDept();
        return (state.reports || []).filter(r => {
            TVC_WorkReport.fromLegacy(r);
            if (r.sync_status === 'SYNCED') return false;
            if (reportDept(r) !== target) return false;
            if (workReportListWorkflowStatus(r) !== 'Confirmed') return false;
            return true;
        }).sort(compareReportByReportedDate);
    }

    /** Critical Postpone — Postpone Export 전용; Monthly pending 목록·건수에서 제외 */
    function stationPendingCriticalPostponeExcluded(dept) {
        const target = dept || getPlanLockDept();
        return (state.reports || []).filter(r => {
            TVC_WorkReport.fromLegacy(r);
            return r.work_type === 'POSTPONE'
                && postponeRequiresCompanyApproval(r)
                && r.sync_status !== 'SYNCED'
                && reportDept(r) === target
                && workReportListWorkflowStatus(r) === 'Confirmed';
        }).sort(compareReportByReportedDate);
    }

    function stationPendingConfirmedReportCount(dept) {
        return stationPendingConfirmedReportRows(dept).length;
    }

    function stationPendingConfirmedDefectCount(dept) {
        const target = dept || getPlanLockDept();
        return menuXferDefectExportRows()
            .filter(r => menuXferDefectRowSelectable(r) && (!target || String(r.department || '').toUpperCase() === target))
            .length;
    }

    function stationPendingConfirmedPostponeCount(dept) {
        const target = dept || getPlanLockDept();
        return menuXferPostponeExportRows()
            .filter(r => menuXferPostponeRowSelectable(r) && reportDept(r) === target)
            .length;
    }

    function stationPendingConfirmedWorkPermitCount(dept) {
        const target = dept || getPlanLockDept();
        return menuXferWorkPermitExportRows()
            .filter(r => menuXferWorkPermitRowSelectable(r) && String(r.department || '').toUpperCase() === target)
            .length;
    }

    function menuXferMaintExportRows() {
        const target = menuXferResolveExportTarget(state.user, 'monthly');
        let reports = workHistoryReports().filter(r => {
            TVC_WorkReport.fromLegacy(r);
            return r.work_type !== 'POSTPONE';
        });
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (state.selectedVesselId) reports = reports.filter(r => r.vessel_id === state.selectedVesselId);
        } else if (target && target !== 'COMPANY') {
            reports = reports.filter(r => reportDept(r) === target);
        }
        return reports.sort(compareReportByReportedDate);
    }

    function menuXferConsumeExportRows() {
        const target = menuXferResolveExportTarget(state.user, 'monthly');
        let logs = workHistoryConsumeLogs();
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (state.selectedVesselId) logs = logs.filter(r => r.vessel_id === state.selectedVesselId);
        } else if (target && target !== 'COMPANY') {
            logs = logs.filter(r => !r.department || String(r.department).toUpperCase() === target);
        }
        return logs.sort((a, b) => compareReportedDateDesc(
            consumeHistoryFields(a).date, a.created_at || a.id,
            consumeHistoryFields(b).date, b.created_at || b.id,
        ));
    }

    function menuXferConsumeRowSelectable(row) {
        const st = consumeHistoryFields(row).status;
        if (TVC_RBAC.isHqAccount(state.user)) {
            return st === 'Approved' && row.sync_status !== 'SYNCED';
        }
        if (isMasterHubMode()) {
            if (st !== 'Submitted' && st !== 'Approved') return false;
            return typeof TVC_HubRelay?.canHubLegExport === 'function'
                ? TVC_HubRelay.canHubLegExport(row)
                : row.sync_status !== 'SYNCED';
        }
        if (st !== 'Confirmed') return false;
        return typeof TVC_HubRelay?.canStationLegExport === 'function'
            ? TVC_HubRelay.canStationLegExport(row)
            : row.sync_status !== 'SYNCED';
    }

    function menuXferConsumeSelectDisabledTitle(row) {
        const st = consumeHistoryFields(row).status;
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (st === 'Submitted') return 'Already exported';
            if (st === 'Confirmed') return 'Approve in app before reply export';
            if (st === 'Reported') return 'Reported — confirm first';
            return 'Not exportable';
        }
        if (isMasterHubMode()) {
            if (TVC_HubRelay?.isHubSynced?.(row)) return TVC_HubRelay.hubExportBlockedTitle();
            if (st !== 'Submitted' && st !== 'Approved') return 'Awaiting station export first';
            return 'Not exportable';
        }
        if (st === 'Submitted') return TVC_HubRelay?.stationExportBlockedTitle?.() || 'Already exported';
        if (st === 'Approved') return 'Approved — use HQ reply import';
        if (st === 'Reported') return 'Reported — confirm first';
        return 'Not exportable';
    }

    function stationPendingConfirmedMaintCount(dept) {
        const target = dept || getPlanLockDept();
        return menuXferMaintExportRows()
            .filter(r => menuXferMonthlyRowSelectable(r) && reportDept(r) === target)
            .length;
    }

    function stationPendingConfirmedConsumeCount(dept) {
        const target = dept || getPlanLockDept();
        return menuXferConsumeExportRows()
            .filter(r => menuXferConsumeRowSelectable(r) && (!r.department || String(r.department).toUpperCase() === target))
            .length;
    }

    function menuXferCaseKey(kind, id) {
        return `${kind}:${id}`;
    }

    function menuXferCaseEntryDateStr(entry) {
        if (entry.kind === 'consume') return consumeHistoryFields(entry.row).date || listReportedDateStr(entry.row);
        return listReportedDateStr(entry.row);
    }

    function menuXferCaseExportEntries() {
        const wp = menuXferWorkPermitExportRows().map(row => ({ kind: 'workPermit', id: row.id, row }));
        const mn = menuXferMaintExportRows().map(row => ({ kind: 'maintenance', id: row.id, row }));
        const df = menuXferDefectExportRows().map(row => ({ kind: 'defect', id: row.id, row }));
        const pp = menuXferPostponeExportRows().map(row => ({ kind: 'postpone', id: row.id, row }));
        const cs = menuXferConsumeExportRows().map(row => ({ kind: 'consume', id: row.id, row }));
        return [...wp, ...mn, ...df, ...pp, ...cs].sort((a, b) => compareReportedDateDesc(
            menuXferCaseEntryDateStr(a), a.row?.created_at || a.id,
            menuXferCaseEntryDateStr(b), b.row?.created_at || b.id,
        ));
    }

    function menuXferCaseIsVesselReview() {
        return !TVC_RBAC.isHqAccount(state.user);
    }

    function menuXferCaseEntryListStatus(entry) {
        if (entry.kind === 'workPermit') return TVC_WorkPermit.listWorkflowStatus(entry.row);
        if (entry.kind === 'defect') return TVC_DefectCase.listWorkflowStatus(entry.row);
        if (entry.kind === 'consume') return consumeHistoryFields(entry.row).status || '';
        return workReportListWorkflowStatus(entry.row);
    }

    function isMasterHqReplyForwardPending(kind, row) {
        if (!isMasterHubMode() || !row) return false;
        if (kind === 'defect') {
            return typeof TVC_DefectCase.isHqReplyStationForwardPending === 'function'
                && TVC_DefectCase.isHqReplyStationForwardPending(row);
        }
        if (kind === 'workPermit') {
            return typeof TVC_WorkPermit.isHqReplyStationForwardPending === 'function'
                && TVC_WorkPermit.isHqReplyStationForwardPending(row);
        }
        if (kind === 'postpone') {
            return workReportListWorkflowStatus(row) === 'Approved' && !row.hq_reply_forwarded_at;
        }
        return false;
    }

    function menuXferHqReplyStationDestLabel() {
        const dept = String(getPlanLockDept() || state.department || '').toUpperCase();
        return dept === 'DECK' ? 'Deck station (C/O)' : 'Engine station (CE)';
    }

    async function stampMasterHqReplyCaseForwarded({ wpIds = [], ppIds = [] } = {}) {
        const ts = new Date().toISOString();
        for (const id of wpIds) {
            try {
                const row = await TVC_DB.get('work_permits', id);
                if (!row || row.hq_reply_forwarded_at) continue;
                if (typeof TVC_WorkPermit.stampHqReplyStationForwarded === 'function') {
                    TVC_WorkPermit.stampHqReplyStationForwarded(row);
                } else {
                    row.hq_reply_forwarded_at = ts;
                }
                await TVC_DB.put('work_permits', row);
            } catch (_) { /* keep Case ZIP; skip a row that cannot be stamped */ }
        }
        for (const id of ppIds) {
            try {
                const row = await TVC_DB.get('daily_work_reports', id);
                if (!row || row.hq_reply_forwarded_at) continue;
                row.hq_reply_forwarded_at = ts;
                await TVC_DB.put('daily_work_reports', row);
            } catch (_) { /* keep Case ZIP; skip a row that cannot be stamped */ }
        }
    }

    function classifySelectedCaseExportDirection() {
        const { wpIds, mnIds, dfIds, ppIds, csIds } = menuXferCollectSelectedCaseIds();
        const wpSet = new Set(wpIds.map(String));
        const dfSet = new Set(dfIds.map(String));
        const ppSet = new Set(ppIds.map(String));
        const selected = menuXferCaseExportEntries().filter(e => {
            if (e.kind === 'workPermit') return wpSet.has(String(e.id));
            if (e.kind === 'defect') return dfSet.has(String(e.id));
            if (e.kind === 'postpone') return ppSet.has(String(e.id));
            return false;
        });
        const toStation = selected.filter(e => isMasterHqReplyForwardPending(e.kind, e.row)).length;
        const toCompany = selected.length - toStation + mnIds.length + csIds.length;
        if (toStation && toCompany) return 'mixed';
        if (toStation) return 'station';
        return 'company';
    }

    function menuXferCaseEntrySelectable(entry) {
        if (!entry?.id || !entry?.row) return false;
        if (entry.kind === 'defect') return menuXferDefectRowSelectable(entry.row);
        if (menuXferCaseIsVesselReview()) {
            const st = menuXferCaseEntryListStatus(entry);
            if (isMasterHubMode()) {
                if (st === 'Confirmed' || st === 'Submitted') return true;
                return isMasterHqReplyForwardPending(entry.kind, entry.row);
            }
            return st === 'Confirmed';
        }
        if (entry.kind === 'maintenance' || entry.kind === 'consume') return false;
        if (entry.kind === 'workPermit') return menuXferWorkPermitRowSelectable(entry.row);
        return menuXferPostponeRowSelectable(entry.row);
    }

    function menuXferCaseEntryDisabledTitle(entry) {
        if (entry.kind === 'defect') return menuXferDefectSelectDisabledTitle(entry.row);
        if (menuXferCaseIsVesselReview()) {
            const st = menuXferCaseEntryListStatus(entry);
            if (st === 'Submitted') return isMasterHubMode() ? '' : 'Already exported';
            if (st === 'Approved') {
                if (isMasterHubMode()) {
                    if (entry.row?.hq_reply_forwarded_at) return 'Already forwarded to Station';
                    if (isMasterHqReplyForwardPending(entry.kind, entry.row)) return '';
                    return 'Already forwarded to Station';
                }
                return 'Approved — use HQ reply import';
            }
            if (st === 'Draft') return 'Draft — confirm first';
            if (st === 'Reported') return 'Reported — confirm first';
            return 'Confirm first';
        }
        if (entry.kind === 'maintenance' || entry.kind === 'consume') {
            return 'Imported from the vessel — review in Report History';
        }
        if (entry.kind === 'workPermit') return menuXferWorkPermitSelectDisabledTitle(entry.row);
        if (entry.kind === 'defect') return menuXferDefectSelectDisabledTitle(entry.row);
        return menuXferPostponeSelectDisabledTitle(entry.row);
    }

    function menuXferSelectedCaseIds(kind) {
        const sel = _menuXfer.selectedCaseKeys || {};
        const prefix = `${kind}:`;
        return Object.keys(sel).filter(k => sel[k] && k.startsWith(prefix)).map(k => k.slice(prefix.length));
    }

    function stationPendingConfirmedCaseCount(dept) {
        return stationPendingConfirmedWorkPermitCount(dept)
            + stationPendingConfirmedMaintCount(dept)
            + stationPendingConfirmedDefectCount(dept)
            + stationPendingConfirmedPostponeCount(dept)
            + stationPendingConfirmedConsumeCount(dept);
    }

    async function buildMenuXferCaseFilenameLookup() {
        return {
            workPermit: await buildMenuXferExportFilenameLookup('workPermit'),
            defect: await buildMenuXferExportFilenameLookup('defect'),
            postpone: await buildMenuXferExportFilenameLookup('postpone'),
        };
    }

    function menuXferConfirmedExportReadyHtml(opts) {
        const {
            title, count, dest, exportAction, selectAction, emptyMsg, note,
        } = opts;
        const exportLabel = opts.exportLabel || (count
            ? `Export (${count} confirmed)`
            : 'Export');
        const readyLine = opts.readyLine || `Ready to send: <strong>${count}</strong> confirmed item(s).`;
        return `
            <p class="spare-sync-hint">Export <strong>${esc(title)}</strong></p>
            <p class="muted">Destination: <strong>${esc(dest)}</strong></p>
            ${count
                ? `<p class="spare-sync-note">${readyLine}</p>`
                : `<p class="menu-xfer-block-msg">${esc(emptyMsg)}</p>`}
            ${note ? `<p class="spare-sync-note muted">${esc(note)}</p>` : ''}
            <div class="spare-sync-actions">
                ${selectAction ? `<button type="button" class="btn spare-sync-btn" onclick="${selectAction}">Select individually…</button>` : ''}
                <button type="button" class="btn btn-green spare-sync-btn"${count ? '' : ' disabled'} onclick="${exportAction}">${esc(exportLabel)}</button>
            </div>`;
    }

    function menuXferCaseKindCounts(entries) {
        const counts = { w: 0, m: 0, d: 0, p: 0, c: 0 };
        (entries || []).forEach(e => {
            if (e.kind === 'workPermit') counts.w++;
            else if (e.kind === 'maintenance') counts.m++;
            else if (e.kind === 'defect') counts.d++;
            else if (e.kind === 'postpone') counts.p++;
            else if (e.kind === 'consume') counts.c++;
        });
        return counts;
    }

    function menuXferCaseSelectedKindCounts() {
        const ids = menuXferCollectSelectedCaseIds();
        return {
            w: ids.wpIds.length,
            m: ids.mnIds.length,
            d: ids.dfIds.length,
            p: ids.ppIds.length,
            c: ids.csIds.length,
        };
    }

    function menuXferCaseTypeCountsHtml(isHq) {
        const counts = menuXferCaseSelectedKindCounts();
        const kinds = isHq ? ['w', 'd', 'p'] : ['w', 'm', 'd', 'p', 'c'];
        const labels = { w: 'W', m: 'M', d: 'D', p: 'P', c: 'C' };
        return kinds.map(k => {
            const n = counts[k] || 0;
            return n ? `${labels[k]} <strong>${n}</strong>` : `${labels[k]} ${n}`;
        }).join(' · ');
    }

    function menuXferUpdateCaseTypeCounts() {
        const el = document.getElementById('menuXferCaseTypeCounts');
        if (!el) return;
        el.innerHTML = menuXferCaseTypeCountsHtml(TVC_RBAC.isHqAccount(state.user));
    }

    function menuXferCaseReadyHtml() {
        const dest = isMasterHubMode()
            ? `Company (HQ) / ${menuXferHqReplyStationDestLabel()}`
            : menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'workPermit'));
        if (menuXferCaseIsVesselReview()) {
            const entries = menuXferCaseExportEntries();
            const ready = entries.filter(menuXferCaseEntrySelectable);
            const count = ready.length;
            const k = menuXferCaseKindCounts(ready);
            return menuXferConfirmedExportReadyHtml({
                title: 'Case Report',
                count,
                dest,
                exportAction: 'TVC_App.menuXferConfirmCaseExportAll()',
                selectAction: 'TVC_App.menuXferOpenCaseSelect()',
                emptyMsg: 'No confirmed Case Reports to export.',
                exportLabel: count ? `Export (${count} confirmed)` : 'Export',
                readyLine: `Ready to send: <strong>${count}</strong> Case Report(s) (W / M / D / P / C).`,
                note: isMasterHubMode()
                    ? `W ${k.w} · M ${k.m} · D ${k.d} · P ${k.p} · C ${k.c}. Submitted → Company (HQ). Approved HQ replies → ${menuXferHqReplyStationDestLabel()}. Export those two groups separately.`
                    : `W ${k.w} · M ${k.m} · D ${k.d} · P ${k.p} · C ${k.c}. Confirm first, then export any type so Company can review vessel work for a period. Use Select individually to set Period.`,
            });
        }
        const dept = getPlanLockDept();
        const wp = stationPendingConfirmedWorkPermitCount(dept);
        const mn = stationPendingConfirmedMaintCount(dept);
        const df = stationPendingConfirmedDefectCount(dept);
        const pp = stationPendingConfirmedPostponeCount(dept);
        const cs = stationPendingConfirmedConsumeCount(dept);
        const count = wp + mn + df + pp + cs;
        return menuXferConfirmedExportReadyHtml({
            title: 'Case Report',
            count,
            dest,
            exportAction: 'TVC_App.menuXferConfirmCaseExportAll()',
            selectAction: 'TVC_App.menuXferOpenCaseSelect()',
            emptyMsg: 'No approved Case Reports pending reply export.',
            note: `W ${wp} · M ${mn} · D ${df} · P ${pp} · C ${cs}. Reply export is for official W / D / P. Review imported M / C in Report History.`,
        });
    }

    /** Station: delta while unlocked with pending Confirmed; otherwise full monthly snapshot so a file is always created. HQ/Master: always snapshot. */
    function monthlyExportUsesSnapshot(user, dept) {
        if (TVC_RBAC.isHqAccount(user) || isMasterHubMode()) return true;
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)) {
            const d = dept || getPlanLockDept();
            if (isOriginalPlanUpdateLocked(d)) return true;
            return stationPendingConfirmedReportCount(d) === 0;
        }
        return true;
    }

    function menuXferMonthlyReadyHtml() {
        const dept = getPlanLockDept();
        const locked = isOriginalPlanUpdateLocked(dept);
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'monthly'));
        const isStation = typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(state.user);
        const pendingConfirmed = isStation ? stationPendingConfirmedReportCount(dept) : 0;
        if (isStation && !locked && pendingConfirmed === 0) {
            return `
            <p class="spare-sync-hint">Export <strong>Monthly Report</strong></p>
            <p class="muted">Destination: <strong>${esc(dest)}</strong></p>
            <p class="spare-sync-note">No pending confirmed Work Reports. Export current Monthly snapshot.</p>
            <p class="spare-sync-note muted">End-of-month completeness: Update Work Plan first, then re-export.</p>
            <div class="spare-sync-actions">
                <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferOpenMonthlySelect()">Select individually…</button>
                <button type="button" id="menuXferMonthlyExportBtn" class="btn btn-green spare-sync-btn" onclick="TVC_App.menuXferConfirmMonthlyExport()">Export</button>
            </div>`;
        }
        if (isStation && !locked && !TVC_RBAC.isHqAccount(state.user) && !isMasterHubMode()) {
            return menuXferConfirmedExportReadyHtml({
                title: 'confirmed Work Reports (pending changes)',
                count: pendingConfirmed,
                dest,
                exportAction: 'TVC_App.menuXferConfirmMonthlyExport()',
                selectAction: 'TVC_App.menuXferOpenMonthlySelect()',
                emptyMsg: 'No confirmed reports pending export.',
                note: 'End-of-month Monthly Report (full snapshot) requires Update Work Plan first.',
            });
        }
        const lock = state._originalPlanLock?.[dept];
        const month = lock?.month || '—';
        const stats = lock?.stats;
        let summary = `<p class="muted">Destination: <strong>${esc(dest)}</strong></p>`;
        if (isMasterHubMode()) {
            summary += `<p class="muted">Master Hub — import Engine/Deck station ZIP first (match ${esc(TVC_RBAC.getDeptLabel(dept) || dept || 'department')} toggle), then export. Update Work Plan is done on station PCs.</p>`;
        } else if (lock) {
            summary += `<ul class="menu-xfer-summary">
                <li>Department: ${esc(TVC_RBAC.getDeptLabel(dept) || dept || '—')}</li>
                <li>Plan month: ${esc(month)}</li>`;
            if (stats?.statusDate) summary += `<li>Status date: ${esc(stats.statusDate)}</li>`;
            if (stats?.nonCritical || stats?.critical) {
                summary += `<li>Outstanding — Non-critical: ${esc(String(stats.nonCritical?.outstanding ?? '—'))}, Critical: ${esc(String(stats.critical?.outstanding ?? '—'))}</li>`;
            }
            summary += '</ul>';
        } else if (TVC_RBAC.isHqAccount(state.user)) {
            summary += `<p class="muted">HQ export for ${esc(TVC_RBAC.getDeptLabel(dept) || dept || 'selected department')}.</p>`;
        }
        const snapshot = monthlyExportUsesSnapshot(state.user, dept);
        const reportCount = monthlyExportWorkReportRows(dept, { snapshot }).length;
        return `
            <p class="spare-sync-hint">Export <strong>Monthly Report</strong></p>
            ${summary}
            ${reportCount
                ? `<p class="spare-sync-note">Work Reports in package: <strong>${reportCount}</strong> (view list before export).</p>`
                : ''}
            <div class="spare-sync-actions">
                <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferOpenMonthlySelect()">Select individually…</button>
                <button type="button" id="menuXferMonthlyExportBtn" class="btn btn-green spare-sync-btn" onclick="TVC_App.menuXferConfirmMonthlyExport()">Export</button>
            </div>`;
    }

    function menuXferUpdateDefectExportBtn() {
        const btn = document.getElementById('menuXferDefectExportBtn');
        if (!btn) return;
        const count = Object.keys(_menuXfer.selectedDefectIds || {}).filter(id => _menuXfer.selectedDefectIds[id]).length;
        if (count === 0) {
            btn.setAttribute('disabled', '');
            btn.textContent = 'Export';
        } else {
            btn.removeAttribute('disabled');
            btn.textContent = `Export (${count})`;
        }
    }

    function bindMenuXferDefectTableEvents() {
        const body = document.getElementById('menuXferBody');
        if (!body || body._menuXferDefectBound) return;
        body._menuXferDefectBound = true;
        body.addEventListener('change', (ev) => {
            const all = ev.target.closest('#menuXferDefectSelectAll');
            if (all) {
                const checked = all.checked;
                if (!_menuXfer.selectedDefectIds) _menuXfer.selectedDefectIds = {};
                menuXferDefectExportRows().filter(menuXferDefectRowSelectable).forEach(row => {
                    if (checked) _menuXfer.selectedDefectIds[row.id] = true;
                    else delete _menuXfer.selectedDefectIds[row.id];
                });
                renderMenuXferModal();
                return;
            }
            const cb = ev.target.closest('.menu-xfer-defect-chk');
            if (!cb || !cb.dataset.defectId) return;
            if (!_menuXfer.selectedDefectIds) _menuXfer.selectedDefectIds = {};
            if (cb.checked) _menuXfer.selectedDefectIds[cb.dataset.defectId] = true;
            else delete _menuXfer.selectedDefectIds[cb.dataset.defectId];
            menuXferUpdateDefectExportBtn();
            const selectable = menuXferDefectExportRows().filter(menuXferDefectRowSelectable);
            const selectAll = document.getElementById('menuXferDefectSelectAll');
            if (selectAll) {
                selectAll.checked = selectable.length > 0 && selectable.every(r => _menuXfer.selectedDefectIds[r.id]);
            }
        });
        body.addEventListener('input', (ev) => {
            if (ev.target.id === 'menuXferDefectSearch') {
                _menuXfer.defectSearch = ev.target.value;
                renderMenuXferModal();
            }
        });
    }

    function menuXferPostponeExportRows() {
        const target = menuXferResolveExportTarget(state.user, 'postpone');
        let reports = workHistoryPostponeReports();
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (state.selectedVesselId) {
                reports = reports.filter(r => r.vessel_id === state.selectedVesselId);
            }
        } else if (target && target !== 'COMPANY') {
            reports = reports.filter(r => reportDept(r) === target);
        }
        return reports.sort(compareReportByReportedDate);
    }

    function menuXferPostponeRowSelectable(row) {
        if (TVC_RBAC.isHqAccount(state.user)) {
            return workReportListWorkflowStatus(row) === 'Approved' && row.sync_status !== 'SYNCED';
        }
        const st = workReportListWorkflowStatus(row);
        if (isMasterHubMode()) {
            if (st === 'Approved') return !row.hq_reply_forwarded_at;
            return st === 'Submitted' && TVC_HubRelay.canHubLegExport(row);
        }
        return st === 'Confirmed' && TVC_HubRelay.canStationLegExport(row);
    }

    function menuXferPostponeSelectDisabledTitle(row) {
        const st = workReportListWorkflowStatus(row);
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (st === 'Submitted') return 'Reply already exported';
            if (st === 'Confirmed') return 'Approve in app before reply export';
            if (st === 'Reported') return 'Reported — confirm first';
            return 'Not exportable';
        }
        if (isMasterHubMode()) {
            if (st === 'Approved') return row.hq_reply_forwarded_at ? 'Already forwarded to Station' : '';
            if (TVC_HubRelay.isHubSynced(row)) return TVC_HubRelay.hubExportBlockedTitle();
            if (st !== 'Submitted') return 'Awaiting station export first';
            return 'Not exportable';
        }
        if (st === 'Submitted') return TVC_HubRelay.stationExportBlockedTitle();
        if (st === 'Approved') return 'Approved — use HQ reply import';
        if (st === 'Reported') return 'Reported — confirm first';
        return 'Not exportable';
    }

    function postponeHistoryColumns(report) {
        const job = resolveReportJob(report);
        return {
            jobCode: report.job_code || report.job_codes?.[0] || job?.job_code || '',
            sort1: job?.item_sort1 || '',
            sort2: job?.item_sort2 || '',
        };
    }

    function menuXferPostponeSelectHtml() {
        const rows = menuXferPostponeExportRows();
        const sel = _menuXfer.selectedPostponeIds || {};
        const lookup = _menuXfer.exportFilenameLookup || {};
        const selectable = rows.filter(menuXferPostponeRowSelectable);
        const selectedCount = selectable.filter(r => sel[r.id]).length;
        const allChecked = selectable.length > 0 && selectable.every(r => sel[r.id]);
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'postpone'));
        const isHq = TVC_RBAC.isHqAccount(state.user);
        const searchQ = (_menuXfer.postponeSearch || '').trim().toLowerCase();
        const filteredRows = searchQ
            ? rows.filter(row => {
                const cols = postponeHistoryColumns(row);
                const hay = [
                    row.id, cols.jobCode, cols.sort1, cols.sort2,
                    workReportListWorkflowStatus(row),
                    row.postpone_date,
                ].filter(Boolean).join(' ').toLowerCase();
                return hay.includes(searchQ);
            })
            : rows;
        let tableBody = '';
        if (!rows.length) {
            tableBody = `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No postpone reports in scope for ${esc(dest)}.</td></tr>`;
        } else if (!filteredRows.length) {
            tableBody = `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No matches for search.</td></tr>`;
        } else {
            tableBody = filteredRows.map(row => {
                const cols = postponeHistoryColumns(row);
                const st = workReportListWorkflowStatus(row);
                const dt = formatCmaxsHistDate(row.report_date || row.created_at);
                const canSelect = menuXferPostponeRowSelectable(row);
                const checked = canSelect && !!sel[row.id];
                const chk = canSelect
                    ? `<input type="checkbox" class="menu-xfer-postpone-chk" data-postpone-id="${escAttr(row.id)}"${checked ? ' checked' : ''}>`
                    : `<input type="checkbox" disabled title="${escAttr(menuXferPostponeSelectDisabledTitle(row))}">`;
                const form = row.report_form || row.job_items?.[0]?.form || {};
                const fileNo = String(form.fileNo || '').trim() || '—';
                const job = resolveReportJob(row);
                return `<tr class="menu-xfer-postpone-row${canSelect ? '' : ' menu-xfer-postpone-row-disabled'}">
                    <td class="menu-xfer-chk">${chk}</td>
                    <td class="hist-type hist-type-postpone" title="Postpone Report"><span class="hist-type-mark">P</span></td>
                    <td>${esc(fileNo)}</td>
                    ${menuXferCritCell(!!(job && jobShowsCriticalEquipmentMark(job)))}
                    <td>${cols.jobCode ? `<strong>${esc(cols.jobCode)}</strong>` : '—'}</td>
                    <td>${histCellHtml(cols.sort1)}</td>
                    <td>${histCellHtml(cols.sort2)}</td>
                    <td>${esc(dt || '—')}</td>
                    <td class="hist-status">${esc(st)}</td>
                    <td class="menu-xfer-file">${menuXferRowExportFilename(row, lookup, 'postpone')}</td>
                </tr>`;
            }).join('');
        }
        const hint = isHq
            ? 'Select <strong>Approved</strong> postpone reports to export reply → Ship'
            : `Select <strong>Confirmed</strong> postpone reports to export → <strong>${esc(dest)}</strong>`;
        const note = isHq
            ? `${rows.length} in list · ${selectable.length} selectable (Approved, reply not yet exported).`
            : `${rows.length} in list · ${selectable.length} selectable (Confirmed, not yet Submitted). Same scope as Work History.`;
        return `
            <p class="spare-sync-hint">${hint}</p>
            <p class="spare-sync-note muted">${note}</p>
            <div class="search-field-wrap menu-xfer-postpone-search">
                <input type="text" class="search-input" id="menuXferPostponeSearch" placeholder="Search File No / Job Code / SORT…" value="${escAttr(_menuXfer.postponeSearch || '')}">
            </div>
            <div class="menu-xfer-table-wrap">
                <table class="menu-xfer-table menu-xfer-postpone-table">
                    ${menuXferExportColgroupHtml()}
                    ${menuXferExportTheadHtml('menuXferPostponeSelectAll', allChecked, selectable)}
                    <tbody>${tableBody}</tbody>
                </table>
            </div>
            <div class="spare-sync-actions">
                <button type="button" id="menuXferPostponeExportBtn" class="btn btn-green spare-sync-btn"${selectedCount ? '' : ' disabled'} onclick="TVC_App.menuXferConfirmPostponeExport()">${selectedCount ? `Export (${selectedCount})` : 'Export'}</button>
            </div>`;
    }

    function menuXferUpdatePostponeExportBtn() {
        const btn = document.getElementById('menuXferPostponeExportBtn');
        if (!btn) return;
        const count = Object.keys(_menuXfer.selectedPostponeIds || {}).filter(id => _menuXfer.selectedPostponeIds[id]).length;
        if (count === 0) {
            btn.setAttribute('disabled', '');
            btn.textContent = 'Export';
        } else {
            btn.removeAttribute('disabled');
            btn.textContent = `Export (${count})`;
        }
    }

    function bindMenuXferPostponeTableEvents() {
        const body = document.getElementById('menuXferBody');
        if (!body || body._menuXferPostponeBound) return;
        body._menuXferPostponeBound = true;
        body.addEventListener('change', (ev) => {
            const all = ev.target.closest('#menuXferPostponeSelectAll');
            if (all) {
                const checked = all.checked;
                if (!_menuXfer.selectedPostponeIds) _menuXfer.selectedPostponeIds = {};
                menuXferPostponeExportRows().filter(menuXferPostponeRowSelectable).forEach(row => {
                    if (checked) _menuXfer.selectedPostponeIds[row.id] = true;
                    else delete _menuXfer.selectedPostponeIds[row.id];
                });
                renderMenuXferModal();
                return;
            }
            const cb = ev.target.closest('.menu-xfer-postpone-chk');
            if (!cb || !cb.dataset.postponeId) return;
            if (!_menuXfer.selectedPostponeIds) _menuXfer.selectedPostponeIds = {};
            if (cb.checked) _menuXfer.selectedPostponeIds[cb.dataset.postponeId] = true;
            else delete _menuXfer.selectedPostponeIds[cb.dataset.postponeId];
            menuXferUpdatePostponeExportBtn();
            const selectable = menuXferPostponeExportRows().filter(menuXferPostponeRowSelectable);
            const selectAll = document.getElementById('menuXferPostponeSelectAll');
            if (selectAll) {
                selectAll.checked = selectable.length > 0 && selectable.every(r => _menuXfer.selectedPostponeIds[r.id]);
            }
        });
        body.addEventListener('input', (ev) => {
            if (ev.target.id === 'menuXferPostponeSearch') {
                _menuXfer.postponeSearch = ev.target.value;
                renderMenuXferModal();
            }
        });
    }

    function workPermitHistoryColumns(row) {
        const first = (row.job_items || [])[0] || {};
        return {
            jobCode: row.job_code || row.pms_job_code || first.job_code || '',
            sort1: row.item_sort1 || first.sort1 || '',
            sort2: row.item_sort2 || first.sort2 || '',
        };
    }

    function menuXferWorkPermitExportRows() {
        const target = menuXferResolveExportTarget(state.user, 'workPermit');
        let rows = (state.workPermits || []).filter(r => r.visible_in_list !== false);
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (state.selectedVesselId) {
                rows = rows.filter(r => r.vessel_id === state.selectedVesselId);
            }
        } else if (target && target !== 'COMPANY') {
            rows = rows.filter(r => TVC_WorkPermit.belongsToDepartment(r, target));
        }
        return rows.sort(compareReportByReportedDate);
    }

    function menuXferWorkPermitRowSelectable(row) {
        if (TVC_RBAC.isHqAccount(state.user)) {
            return TVC_WorkPermit.listWorkflowStatus(row) === 'Approved' && row.sync_status !== 'SYNCED';
        }
        const st = TVC_WorkPermit.listWorkflowStatus(row);
        if (isMasterHubMode()) {
            if (TVC_WorkPermit.isHqReplyStationForwardPending(row)) return true;
            return st === 'Submitted' && TVC_HubRelay.canHubLegExport(row);
        }
        return st === 'Confirmed' && TVC_HubRelay.canStationLegExport(row);
    }

    function menuXferWorkPermitSelectDisabledTitle(row) {
        const st = TVC_WorkPermit.listWorkflowStatus(row);
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (st === 'Submitted') return 'Reply already exported';
            if (st === 'Confirmed') return 'Approve in app before reply export';
            if (st === 'Reported') return 'Reported — confirm first';
            return 'Not exportable';
        }
        if (isMasterHubMode()) {
            if (TVC_WorkPermit.isHqReplyStationForwardPending(row)) return '';
            if (row.hq_reply_forwarded_at) return 'Already forwarded to Station';
            if (TVC_HubRelay.isHubSynced(row)) return TVC_HubRelay.hubExportBlockedTitle();
            if (st !== 'Submitted') return 'Awaiting station export first';
            return 'Not exportable';
        }
        if (st === 'Submitted') return TVC_HubRelay.stationExportBlockedTitle();
        if (st === 'Approved') return 'Approved — use HQ reply import';
        if (st === 'Reported') return 'Reported — confirm first';
        return 'Not exportable';
    }

    function menuXferWorkPermitSelectHtml() {
        const rows = menuXferWorkPermitExportRows();
        const sel = _menuXfer.selectedWorkPermitIds || {};
        const lookup = _menuXfer.exportFilenameLookup || {};
        const selectable = rows.filter(menuXferWorkPermitRowSelectable);
        const selectedCount = selectable.filter(r => sel[r.id]).length;
        const allChecked = selectable.length > 0 && selectable.every(r => sel[r.id]);
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'workPermit'));
        const isHq = TVC_RBAC.isHqAccount(state.user);
        const searchQ = (_menuXfer.workPermitSearch || '').trim().toLowerCase();
        const filteredRows = searchQ
            ? rows.filter(row => {
                const cols = workPermitHistoryColumns(row);
                const hay = [
                    row.file_no, row.permit_no, cols.jobCode, cols.sort1, cols.sort2,
                    TVC_WorkPermit.listWorkflowStatus(row),
                ].filter(Boolean).join(' ').toLowerCase();
                return hay.includes(searchQ);
            })
            : rows;
        let tableBody = '';
        if (!rows.length) {
            tableBody = `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No Work Permit records in scope for ${esc(dest)}.</td></tr>`;
        } else if (!filteredRows.length) {
            tableBody = `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No matches for search.</td></tr>`;
        } else {
            tableBody = filteredRows.map(row => {
                const cols = workPermitHistoryColumns(row);
                const st = TVC_WorkPermit.listWorkflowStatus(row);
                const dt = formatCmaxsHistDate(row.report_date || row.created_at);
                const canSelect = menuXferWorkPermitRowSelectable(row);
                const checked = canSelect && !!sel[row.id];
                const chk = canSelect
                    ? `<input type="checkbox" class="menu-xfer-work-permit-chk" data-work-permit-id="${escAttr(row.id)}"${checked ? ' checked' : ''}>`
                    : `<input type="checkbox" disabled title="${escAttr(menuXferWorkPermitSelectDisabledTitle(row))}">`;
                const fileNo = String(row.file_no || '').trim() || '—';
                const jobId = row.maintenance_job_id || (row.job_items || [])[0]?.maintenance_job_id;
                const job = jobId ? state.idx?.jobById.get(jobId) : null;
                return `<tr class="menu-xfer-work-permit-row${canSelect ? '' : ' menu-xfer-work-permit-row-disabled'}">
                    <td class="menu-xfer-chk">${chk}</td>
                    <td class="spare-consume-log-type hist-type hist-type-wp" title="Work Permit"><span class="hist-type-mark">W</span></td>
                    <td>${esc(fileNo)}</td>
                    ${menuXferCritCell(!job || jobShowsCriticalEquipmentMark(job))}
                    <td>${cols.jobCode ? `<strong>${esc(cols.jobCode)}</strong>` : '—'}</td>
                    <td>${histCellHtml(cols.sort1)}</td>
                    <td>${histCellHtml(cols.sort2)}</td>
                    <td>${esc(dt || '—')}</td>
                    <td class="hist-status">${esc(st)}</td>
                    <td class="menu-xfer-file">${menuXferRowExportFilename(row, lookup, 'workPermit')}</td>
                </tr>`;
            }).join('');
        }
        const hint = isHq
            ? 'Select <strong>Approved</strong> Work Permits to export reply → Ship'
            : `Select <strong>Confirmed</strong> Work Permits to export → <strong>${esc(dest)}</strong>`;
        const note = isHq
            ? `${rows.length} in list · ${selectable.length} selectable (Approved, reply not yet exported).`
            : `${rows.length} in list · ${selectable.length} selectable (Confirmed, not yet Submitted).`;
        return `
            <p class="spare-sync-hint">${hint}</p>
            <p class="spare-sync-note muted">${note}</p>
            <div class="search-field-wrap menu-xfer-work-permit-search">
                <input type="text" class="search-input" id="menuXferWorkPermitSearch" placeholder="Search File No / Permit No / Job Code / SORT…" value="${escAttr(_menuXfer.workPermitSearch || '')}">
            </div>
            <div class="menu-xfer-table-wrap">
                <table class="menu-xfer-table menu-xfer-work-permit-table">
                    ${menuXferExportColgroupHtml()}
                    ${menuXferExportTheadHtml('menuXferWorkPermitSelectAll', allChecked, selectable)}
                    <tbody>${tableBody}</tbody>
                </table>
            </div>
            <div class="spare-sync-actions">
                <button type="button" id="menuXferWorkPermitExportBtn" class="btn btn-green spare-sync-btn"${selectedCount ? '' : ' disabled'} onclick="TVC_App.menuXferConfirmWorkPermitExport()">${selectedCount ? `Export (${selectedCount})` : 'Export'}</button>
            </div>`;
    }

    function menuXferUpdateWorkPermitExportBtn() {
        const btn = document.getElementById('menuXferWorkPermitExportBtn');
        if (!btn) return;
        const count = Object.keys(_menuXfer.selectedWorkPermitIds || {}).filter(id => _menuXfer.selectedWorkPermitIds[id]).length;
        if (count === 0) {
            btn.setAttribute('disabled', '');
            btn.textContent = 'Export';
        } else {
            btn.removeAttribute('disabled');
            btn.textContent = `Export (${count})`;
        }
    }

    function bindMenuXferWorkPermitTableEvents() {
        const body = document.getElementById('menuXferBody');
        if (!body || body._menuXferWorkPermitBound) return;
        body._menuXferWorkPermitBound = true;
        body.addEventListener('change', (ev) => {
            const all = ev.target.closest('#menuXferWorkPermitSelectAll');
            if (all) {
                const checked = all.checked;
                if (!_menuXfer.selectedWorkPermitIds) _menuXfer.selectedWorkPermitIds = {};
                menuXferWorkPermitExportRows().filter(menuXferWorkPermitRowSelectable).forEach(row => {
                    if (checked) _menuXfer.selectedWorkPermitIds[row.id] = true;
                    else delete _menuXfer.selectedWorkPermitIds[row.id];
                });
                renderMenuXferModal();
                return;
            }
            const cb = ev.target.closest('.menu-xfer-work-permit-chk');
            if (!cb || !cb.dataset.workPermitId) return;
            if (!_menuXfer.selectedWorkPermitIds) _menuXfer.selectedWorkPermitIds = {};
            if (cb.checked) _menuXfer.selectedWorkPermitIds[cb.dataset.workPermitId] = true;
            else delete _menuXfer.selectedWorkPermitIds[cb.dataset.workPermitId];
            menuXferUpdateWorkPermitExportBtn();
            const selectable = menuXferWorkPermitExportRows().filter(menuXferWorkPermitRowSelectable);
            const selectAll = document.getElementById('menuXferWorkPermitSelectAll');
            if (selectAll) {
                selectAll.checked = selectable.length > 0 && selectable.every(r => _menuXfer.selectedWorkPermitIds[r.id]);
            }
        });
        body.addEventListener('input', (ev) => {
            if (ev.target.id === 'menuXferWorkPermitSearch') {
                _menuXfer.workPermitSearch = ev.target.value;
                renderMenuXferModal();
            }
        });
    }

    function menuXferCaseTypeHtml(kind, row) {
        if (kind === 'workPermit') {
            return '<td class="spare-consume-log-type hist-type hist-type-wp" title="Work Permit"><span class="hist-type-mark">W</span></td>';
        }
        if (kind === 'maintenance') {
            return '<td class="hist-type hist-type-maint" title="Maintenance Report"><span class="hist-type-mark">M</span></td>';
        }
        if (kind === 'defect') {
            return '<td class="hist-type hist-type-defect" title="Defect Report"><span class="hist-type-mark">D</span></td>';
        }
        if (kind === 'consume') {
            return '<td class="hist-type hist-type-consume" title="Consumption Report"><span class="hist-type-mark">C</span></td>';
        }
        return '<td class="hist-type hist-type-postpone" title="Postpone Report"><span class="hist-type-mark">P</span></td>';
    }

    function menuXferCaseRowMeta(entry) {
        const { kind, row } = entry;
        if (kind === 'workPermit') {
            const cols = workPermitHistoryColumns(row);
            const jobId = row.maintenance_job_id || (row.job_items || [])[0]?.maintenance_job_id;
            const job = jobId ? state.idx?.jobById.get(jobId) : null;
            return {
                fileNo: String(row.file_no || '').trim() || '—',
                cols,
                status: TVC_WorkPermit.listWorkflowStatus(row),
                date: formatCmaxsHistDate(row.report_date || row.created_at),
                critical: !job || jobShowsCriticalEquipmentMark(job),
                search: [row.file_no, row.permit_no, cols.jobCode, cols.sort1, cols.sort2, TVC_WorkPermit.listWorkflowStatus(row)],
            };
        }
        if (kind === 'maintenance') {
            const cols = workReportHistoryColumns(row);
            const job = resolveReportJob(row);
            return {
                fileNo: String(row.file_no || row.job_code || '').trim() || '—',
                cols,
                status: workReportListWorkflowStatus(row),
                date: formatCmaxsHistDate(row.report_date || row.created_at),
                critical: !!(job && jobShowsCriticalEquipmentMark(job)),
                search: [row.file_no, cols.jobCode, cols.sort1, cols.sort2, workReportListWorkflowStatus(row)],
            };
        }
        if (kind === 'defect') {
            const cols = defectHistoryColumns(row);
            return {
                fileNo: String(row.file_no || '').trim() || '—',
                cols,
                status: TVC_DefectCase.listWorkflowStatus(row),
                date: formatCmaxsHistDate(row.report_date || row.created_at),
                critical: defectShowsCriticalEquipmentMark(row),
                search: [row.file_no, cols.jobCode, cols.sort1, cols.sort2, TVC_DefectCase.listWorkflowStatus(row), row.case_no],
            };
        }
        if (kind === 'consume') {
            const fields = consumeHistoryFields(row);
            return {
                fileNo: String(fields.fileNo || '').trim() || '—',
                cols: { jobCode: fields.jobCode, sort1: fields.sort1, sort2: fields.sort2 },
                status: fields.status || '—',
                date: formatCmaxsHistDate(fields.date || row.created_at),
                critical: false,
                search: [fields.fileNo, fields.jobCode, fields.sort1, fields.sort2, fields.status],
            };
        }
        const cols = postponeHistoryColumns(row);
        const form = row.report_form || row.job_items?.[0]?.form || {};
        const job = resolveReportJob(row);
        return {
            fileNo: String(form.fileNo || '').trim() || '—',
            cols,
            status: workReportListWorkflowStatus(row),
            date: formatCmaxsHistDate(row.report_date || row.created_at),
            critical: !!(job && jobShowsCriticalEquipmentMark(job)),
            search: [row.id, cols.jobCode, cols.sort1, cols.sort2, workReportListWorkflowStatus(row), row.postpone_date],
        };
    }

    function menuXferDefaultCaseFilters() {
        return { type: 'all', groupKeys: [] };
    }

    function getMenuXferCaseFilters() {
        if (!_menuXfer.caseFilters) _menuXfer.caseFilters = menuXferDefaultCaseFilters();
        return _menuXfer.caseFilters;
    }

    function setMenuXferCaseFilters(patch) {
        _menuXfer.caseFilters = { ...menuXferDefaultCaseFilters(), ...getMenuXferCaseFilters(), ...patch };
        refreshMenuXferCaseList();
        TVC_ListFilters?.refreshOpenPopover?.();
    }

    function resetMenuXferCaseListChrome() {
        _menuXfer.caseSearch = '';
        _menuXfer.casePeriodFrom = '';
        _menuXfer.casePeriodTo = '';
        _menuXfer.caseFilters = menuXferDefaultCaseFilters();
    }

    function menuXferCaseEntryType(kind) {
        if (kind === 'workPermit') return 'w';
        if (kind === 'maintenance') return 'm';
        if (kind === 'defect') return 'd';
        if (kind === 'consume') return 'c';
        return 'p';
    }

    function menuXferCaseEntryGroupKey(entry) {
        const ctx = { idx: state.idx, jobs: state.jobs };
        if (entry.kind === 'consume') {
            return typeof TVC_SpareMenu?.resolveConsumeLogGroupKey === 'function'
                ? TVC_SpareMenu.resolveConsumeLogGroupKey(entry.row, state)
                : (String(entry.row?.pms_group_key || '').trim() || null);
        }
        if (entry.kind === 'defect') return TVC_ListFilters?.resolveDefectGroupKey?.(entry.row, ctx) || null;
        const row = entry.row;
        const direct = String(row?.pms_group_key || '').trim();
        if (direct) return direct;
        const jobId = row?.maintenance_job_id || (row?.job_items || [])[0]?.maintenance_job_id;
        if (jobId && state.idx?.jobById?.get(jobId)) {
            const job = state.idx.jobById.get(jobId);
            return `${job.department || ''}|${String(job.group || '').trim()}`;
        }
        const jobCode = (row?.job_items || [])[0]?.job_code || row?.job_code || row?.pms_job_code;
        if (jobCode) {
            const job = state.idx?.jobById
                ? [...state.idx.jobById.values()].find(j => j.job_code === jobCode)
                : (state.jobs || []).find(j => j.job_code === jobCode);
            if (job) return `${job.department || ''}|${String(job.group || '').trim()}`;
        }
        return null;
    }

    function menuXferCaseVisibleEntries(entries) {
        const list = entries || menuXferCaseExportEntries();
        const f = getMenuXferCaseFilters();
        const searchQ = (_menuXfer.caseSearch || '').trim().toLowerCase();
        const from = _menuXfer.casePeriodFrom || '';
        const to = _menuXfer.casePeriodTo || '';
        const type = f.type || 'all';
        return list.filter(entry => {
            if (type !== 'all' && menuXferCaseEntryType(entry.kind) !== type) return false;
            if (!isDateInPeriod(listReportedDateStr(entry.row), from, to)) return false;
            if (f.groupKeys?.length && !f.groupKeys.includes(menuXferCaseEntryGroupKey(entry))) return false;
            if (searchQ && !menuXferCaseRowMeta(entry).search.filter(Boolean).join(' ').toLowerCase().includes(searchQ)) return false;
            return true;
        });
    }

    async function menuXferCaseSetPeriod() {
        const fromEl = document.getElementById('menuXferCasePeriodFrom');
        const toEl = document.getElementById('menuXferCasePeriodTo');
        const from = fromEl?.value || '';
        const to = toEl?.value || '';
        if (from && to && from > to) {
            await TVC_Dialog.alert('Start date cannot be after end date.');
            if (fromEl) fromEl.value = _menuXfer.casePeriodFrom || '';
            if (toEl) toEl.value = _menuXfer.casePeriodTo || '';
            return;
        }
        if (from === (_menuXfer.casePeriodFrom || '') && to === (_menuXfer.casePeriodTo || '')) return;
        _menuXfer.casePeriodFrom = from;
        _menuXfer.casePeriodTo = to;
        refreshMenuXferCaseList();
    }

    function menuXferClearCasePeriodAndFilters() {
        _menuXfer.casePeriodFrom = '';
        _menuXfer.casePeriodTo = '';
        _menuXfer.caseFilters = menuXferDefaultCaseFilters();
        _menuXfer.caseSearch = document.getElementById('menuXferCaseSearch')?.value || _menuXfer.caseSearch || '';
        TVC_ListFilters?.refreshOpenPopover?.();
        refreshMenuXferCaseList();
    }

    function menuXferCaseSetSearch(value) {
        const next = value || '';
        if (next === (_menuXfer.caseSearch || '')) return;
        _menuXfer.caseSearch = next;
        refreshMenuXferCaseList();
    }

    function menuXferCaseTableRowsHtml(entries, filtered, dest, maps, sel) {
        if (!entries.length) {
            return `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No Case Reports in scope for ${esc(dest)}.</td></tr>`;
        }
        if (!filtered.length) {
            return `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No matches for period / filter / search.</td></tr>`;
        }
        return filtered.map(entry => {
            const meta = menuXferCaseRowMeta(entry);
            const canSelect = menuXferCaseEntrySelectable(entry);
            const key = menuXferCaseKey(entry.kind, entry.id);
            const checked = canSelect && !!sel[key];
            const chk = canSelect
                ? `<input type="checkbox" class="menu-xfer-case-chk" data-case-kind="${escAttr(entry.kind)}" data-case-id="${escAttr(entry.id)}"${checked ? ' checked' : ''}>`
                : `<input type="checkbox" disabled title="${escAttr(menuXferCaseEntryDisabledTitle(entry))}">`;
            const lookup = maps[entry.kind] || {};
            return `<tr class="menu-xfer-case-row${canSelect ? '' : ' menu-xfer-case-row-disabled'}">
                    <td class="menu-xfer-chk">${chk}</td>
                    ${menuXferCaseTypeHtml(entry.kind, entry.row)}
                    <td>${esc(meta.fileNo)}</td>
                    ${menuXferCritCell(meta.critical)}
                    <td>${meta.cols.jobCode ? `<strong>${esc(meta.cols.jobCode)}</strong>` : '—'}</td>
                    <td>${histCellHtml(meta.cols.sort1)}</td>
                    <td>${histCellHtml(meta.cols.sort2)}</td>
                    <td>${esc(meta.date || '—')}</td>
                    <td class="hist-status">${esc(meta.status)}</td>
                    <td class="menu-xfer-file">${menuXferRowExportFilename(entry.row, lookup, entry.kind)}</td>
                </tr>`;
        }).join('');
    }

    function refreshMenuXferCaseList() {
        if (_menuXfer.step !== 'export-case-select') return;
        const tbody = document.querySelector('#menuXferBody .menu-xfer-case-table tbody');
        if (!tbody) {
            renderMenuXferModal();
            return;
        }
        const entries = menuXferCaseExportEntries();
        const filtered = menuXferCaseVisibleEntries(entries);
        const sel = _menuXfer.selectedCaseKeys || {};
        const maps = _menuXfer.exportFilenameLookup || {};
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'workPermit'));
        const selectable = filtered.filter(menuXferCaseEntrySelectable);
        tbody.innerHTML = menuXferCaseTableRowsHtml(entries, filtered, dest, maps, sel);
        const count = document.getElementById('menuXferCaseCount');
        if (count) count.textContent = `${filtered.length} / ${entries.length} entries`;
        const selectAll = document.getElementById('menuXferCaseSelectAll');
        if (selectAll) {
            selectAll.checked = selectable.length > 0 && selectable.every(e => sel[menuXferCaseKey(e.kind, e.id)]);
            selectAll.disabled = selectable.length === 0;
        }
        document.getElementById('menuXferCasePeriodFilter')?.classList.toggle('active', !!(_menuXfer.casePeriodFrom || _menuXfer.casePeriodTo));
        const fromEl = document.getElementById('menuXferCasePeriodFrom');
        const toEl = document.getElementById('menuXferCasePeriodTo');
        if (fromEl && document.activeElement !== fromEl) fromEl.value = _menuXfer.casePeriodFrom || '';
        if (toEl && document.activeElement !== toEl) toEl.value = _menuXfer.casePeriodTo || '';
        const searchEl = document.getElementById('menuXferCaseSearch');
        if (searchEl && document.activeElement !== searchEl) searchEl.value = _menuXfer.caseSearch || '';
        updateSearchClearBtnForEl(searchEl);
        menuXferUpdateCaseExportBtn();
        TVC_ListFilters?.syncBtn('caseXfer');
    }

    function menuXferCaseSelectHtml() {
        const entries = menuXferCaseExportEntries();
        const sel = _menuXfer.selectedCaseKeys || {};
        const maps = _menuXfer.exportFilenameLookup || {};
        const filtered = menuXferCaseVisibleEntries(entries);
        const selectable = filtered.filter(menuXferCaseEntrySelectable);
        const selectedCount = menuXferCollectSelectedCaseIds().total;
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'workPermit'));
        const isHq = TVC_RBAC.isHqAccount(state.user);
        const periodActive = !!(_menuXfer.casePeriodFrom || _menuXfer.casePeriodTo);
        const allChecked = selectable.length > 0 && selectable.every(e => sel[menuXferCaseKey(e.kind, e.id)]);
        const tableBody = menuXferCaseTableRowsHtml(entries, filtered, dest, maps, sel);
        const typeCounts = menuXferCaseTypeCountsHtml(isHq);
        const hint = isHq
            ? 'Official reply export is W / D / P only. Review imported M / C in Report History.'
            : isMasterHubMode()
                ? `Submitted → <strong>Company (HQ)</strong>. Approved HQ replies → <strong>${esc(menuXferHqReplyStationDestLabel())}</strong>.`
                : `Check Case Reports for the Period so Company can review vessel work → <strong>${esc(dest)}</strong>`;
        return `
            <p class="spare-sync-hint">${hint}</p>
            <p class="menu-xfer-type-counts" id="menuXferCaseTypeCounts">${typeCounts}</p>
            <div class="hist-toolbar hist-toolbar-filters list-filter-stack menu-xfer-case-filters">
                <div class="filter-bar list-filter-period-row">
                    <div id="menuXferCasePeriodFilter" class="act-period-filter${periodActive ? ' active' : ''}" title="Filter by Reported Date">
                        <span class="act-period-label">Period</span>
                        <input type="text" id="menuXferCasePeriodFrom" class="act-period-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" aria-label="Period from"
                            value="${escAttr(_menuXfer.casePeriodFrom || '')}" onchange="TVC_App.menuXferCaseSetPeriod()">
                        <span class="act-period-sep">~</span>
                        <input type="text" id="menuXferCasePeriodTo" class="act-period-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" aria-label="Period to"
                            value="${escAttr(_menuXfer.casePeriodTo || '')}" onchange="TVC_App.menuXferCaseSetPeriod()">
                        <div class="list-filter-wrap">
                            <button type="button" id="menuXferCaseFilterBtn" class="btn btn-sm list-filter-btn" onclick="TVC_ListFilters.toggle('caseXfer', event)">Filter</button>
                        </div>
                    </div>
                    <button type="button" class="btn btn-sm act-period-clear" onclick="TVC_App.menuXferClearCasePeriodAndFilters()">Clear</button>
                    <span class="count-label" id="menuXferCaseCount">${filtered.length} / ${entries.length} entries</span>
                </div>
                <div class="filter-bar list-filter-search-row">
                    <div class="search-field-wrap">
                        <input class="search-input" id="menuXferCaseSearch" placeholder="Search JOB CODE / GROUP / DEFECT…"
                            value="${escAttr(_menuXfer.caseSearch || '')}" oninput="TVC_App.menuXferCaseSetSearch(this.value)">
                        <button type="button" class="search-clear-btn${_menuXfer.caseSearch ? '' : ' hidden'}" title="Clear search" aria-label="Clear search"
                            onclick="TVC_App.clearSearchField('menuXferCaseSearch')">×</button>
                    </div>
                </div>
            </div>
            <div class="menu-xfer-table-wrap">
                <table class="menu-xfer-table menu-xfer-case-table">
                    ${menuXferExportColgroupHtml()}
                    ${menuXferExportTheadHtml('menuXferCaseSelectAll', allChecked, selectable)}
                    <tbody>${tableBody}</tbody>
                </table>
            </div>
            <div class="spare-sync-actions">
                <button type="button" id="menuXferCaseExportBtn" class="btn btn-green spare-sync-btn"${selectedCount ? '' : ' disabled'} onclick="TVC_App.menuXferConfirmCaseExport()">${selectedCount ? `Export (${selectedCount})` : 'Export'}</button>
            </div>`;
    }

    function menuXferUpdateCaseExportBtn() {
        const btn = document.getElementById('menuXferCaseExportBtn');
        if (!btn) return;
        const count = menuXferCollectSelectedCaseIds().total;
        if (count === 0) {
            btn.setAttribute('disabled', '');
            btn.textContent = 'Export';
        } else {
            btn.removeAttribute('disabled');
            btn.textContent = `Export (${count})`;
        }
        menuXferUpdateCaseTypeCounts();
    }

    function bindMenuXferCaseTableEvents() {
        const body = document.getElementById('menuXferBody');
        if (!body || body._menuXferCaseBound) return;
        body._menuXferCaseBound = true;
        body.addEventListener('change', (ev) => {
            const all = ev.target.closest('#menuXferCaseSelectAll');
            if (all) {
                const checked = all.checked;
                if (!_menuXfer.selectedCaseKeys) _menuXfer.selectedCaseKeys = {};
                menuXferCaseVisibleEntries().filter(menuXferCaseEntrySelectable).forEach(entry => {
                    const key = menuXferCaseKey(entry.kind, entry.id);
                    if (checked) _menuXfer.selectedCaseKeys[key] = true;
                    else delete _menuXfer.selectedCaseKeys[key];
                });
                refreshMenuXferCaseList();
                return;
            }
            const cb = ev.target.closest('.menu-xfer-case-chk');
            if (!cb || !cb.dataset.caseKind || !cb.dataset.caseId) return;
            if (!_menuXfer.selectedCaseKeys) _menuXfer.selectedCaseKeys = {};
            const key = menuXferCaseKey(cb.dataset.caseKind, cb.dataset.caseId);
            if (cb.checked) _menuXfer.selectedCaseKeys[key] = true;
            else delete _menuXfer.selectedCaseKeys[key];
            menuXferUpdateCaseExportBtn();
            const selectable = menuXferCaseVisibleEntries().filter(menuXferCaseEntrySelectable);
            const selectAll = document.getElementById('menuXferCaseSelectAll');
            if (selectAll) {
                selectAll.checked = selectable.length > 0 && selectable.every(e => _menuXfer.selectedCaseKeys[menuXferCaseKey(e.kind, e.id)]);
            }
        });
    }

    function bindMenuXferMonthlyTableEvents() {
        const body = document.getElementById('menuXferBody');
        if (!body || body._menuXferMonthlyBound) return;
        body._menuXferMonthlyBound = true;
        body.addEventListener('change', (ev) => {
            const all = ev.target.closest('#menuXferMonthlySelectAll');
            if (all) {
                const checked = all.checked;
                if (!_menuXfer.selectedMonthlyReportIds) _menuXfer.selectedMonthlyReportIds = {};
                menuXferMonthlyVisibleRows().filter(menuXferMonthlyRowSelectable).forEach(row => {
                    if (checked) _menuXfer.selectedMonthlyReportIds[row.id] = true;
                    else delete _menuXfer.selectedMonthlyReportIds[row.id];
                });
                refreshMenuXferMonthlyList();
                return;
            }
            const cb = ev.target.closest('.menu-xfer-monthly-chk');
            if (!cb || !cb.dataset.monthlyId) return;
            if (!_menuXfer.selectedMonthlyReportIds) _menuXfer.selectedMonthlyReportIds = {};
            if (cb.checked) _menuXfer.selectedMonthlyReportIds[cb.dataset.monthlyId] = true;
            else delete _menuXfer.selectedMonthlyReportIds[cb.dataset.monthlyId];
            menuXferUpdateMonthlyExportBtn();
            const selectable = menuXferMonthlyVisibleRows().filter(menuXferMonthlyRowSelectable);
            const selectAll = document.getElementById('menuXferMonthlySelectAll');
            if (selectAll) {
                selectAll.checked = selectable.length > 0 && selectable.every(r => _menuXfer.selectedMonthlyReportIds[r.id]);
            }
        });
        body.addEventListener('input', (ev) => {
            if (ev.target.id === 'menuXferMonthlySearch') {
                _menuXfer.monthlySearch = ev.target.value;
                refreshMenuXferMonthlyList();
            }
        });
    }

    function renderMenuXferModal() {
        const body = document.getElementById('menuXferBody');
        if (!body) return;
        const step = _menuXfer.step || 'mode';
        const modalBox = document.querySelector('#menuXferModal .modal-box');
        if (modalBox) {
            modalBox.classList.toggle('menu-xfer-wide', step === 'export-case-select'
                || step === 'export-defect-select'
                || step === 'export-postpone-select'
                || step === 'export-work-permit-select'
                || step === 'export-monthly-select');
        }
        let content = '';
        if (step === 'mode') {
            const hint = menuXferDefaultChannelHint(state.user);
            content = `
                <p class="spare-sync-hint">Choose whether to send data out or bring data in.</p>
                <p class="spare-sync-note muted">${esc(hint)}</p>
                <div class="spare-sync-actions">
                    <button type="button" class="btn btn-green spare-sync-btn" onclick="TVC_App.menuXferPickMode('export')">Export (ZIP)</button>
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickMode('import')">Import (ZIP)</button>
                </div>
                ${menuXferOnlineSyncHtml(state.user)}`;
        } else if (step === 'export-app-update') {
            content = menuXferAppUpdateExportHtml();
        } else if (step === 'import-app-update-preview') {
            content = menuXferAppUpdateImportPreviewHtml();
        } else if (step === 'export-type') {
            const ctx = menuXferStationContext(state.user);
            const isHq = ctx === 'hq';
            const exportNote = ctx === 'station'
                ? 'Case Report: send W / M / D / P / C so Company can review work for a period. Monthly Report: last month running hours → total → this month expected hours → NEXT DATE for time-based Job Codes → PMS Outstanding Code.'
                    : ctx === 'master'
                    ? 'Case Report: send W / M / D / P / C so Company can review vessel work for a period. Monthly Report: first export goes to Company (HQ). After HQ reply is imported, export again to Engine/Deck station (CE / C/O).'
                    : isHq
                        ? 'Import vessel Case / Monthly ZIP, then reply with Case Report or Monthly Report.'
                        : '';
            content = `
                <p class="spare-sync-hint">Select the report type to export.</p>
                ${exportNote ? `<p class="spare-sync-note muted">${esc(exportNote)}</p>` : ''}
                <div class="spare-sync-actions">
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickExportType('case')">Case Report</button>
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickExportType('monthly')">Monthly Report</button>
                </div>`;
        } else if (step === 'export-case-select') {
            content = menuXferCaseSelectHtml();
        } else if (step === 'export-case-ready') {
            content = menuXferCaseReadyHtml();
        } else if (step === 'export-monthly-ready') {
            content = menuXferMonthlyReadyHtml();
        } else if (step === 'export-monthly-select') {
            content = menuXferMonthlySelectHtml();
        } else if (step === 'export-vessel-profile-ready') {
            content = menuXferVesselProfileExportHtml();
        } else if (step === 'import-vessel-profile-preview') {
            content = menuXferVesselProfileImportPreviewHtml();
        } else if (step === 'import') {
            const ctx = menuXferStationContext(state.user);
            const importHint = ctx === 'station'
                ? 'Import HQ feedback ZIP (HQ → Ship). Engine HQ reply → Engine Mode only; Deck HQ reply → Deck Mode only.'
                : ctx === 'master'
                    ? 'Import Engine/Deck station ZIP or HQ feedback ZIP. Match Deck/Engine toggle — Engine data never merges into Deck view.'
                    : ctx === 'hq'
                        ? 'Import vessel ZIP (Engine/Deck station export or Master→HQ report). Select vessel and matching Deck/Engine toggle first.'
                        : 'Select a PMS sync ZIP from Master or Company.';
            const importType = _menuXfer.importType || '';
            const typeBtns = menuImportTypesForUser(state.user).map(t => `
                <button type="button" class="btn spare-sync-btn spare-sync-check-btn${importType === t.key ? ' is-checked' : ''}"
                    aria-pressed="${importType === t.key ? 'true' : 'false'}"
                    onclick="TVC_App.menuXferSelectImportType('${t.key}')">${esc(t.label)}${importType === t.key ? ' ✓' : ''}</button>`).join('');
            content = `
                <p class="spare-sync-hint">Select import type, then open the file.</p>
                <p class="spare-sync-note muted">${esc(importHint)}</p>
                <p class="spare-sync-note muted">Case Report: <strong>.zip</strong> · Monthly: <strong>.zip / .json / .csv</strong>.</p>
                <div class="spare-sync-actions">
                    ${typeBtns}
                    <button type="button" class="btn btn-green spare-sync-btn"
                        onclick="TVC_App.menuXferTriggerImport()"
                        ${importType ? '' : ' disabled title="Select import type first"'}>Open file…</button>
                </div>`;
        }
        const backBtn = step !== 'mode'
            ? `<button type="button" class="btn btn-sm spare-sync-back" onclick="TVC_App.menuXferBack()">← Back</button>`
            : '';
        const stepLabel = step === 'mode' ? '1. Export or Import'
            : step === 'export-app-update' ? 'Admin — App Update package'
            : step === 'export-type' ? '2. Export — report type'
                : step === 'export-case-ready' ? '3. Export — Case Report'
                : step === 'export-case-select' ? '3. Export — select Case Reports'
                        : step === 'export-monthly-ready' ? '3. Export — monthly report'
                        : step === 'export-monthly-select' ? '3. Export — select Monthly Reports'
                        : step === 'export-vessel-profile-ready' ? '3. Export — Vessel Profile'
                        : step === 'import-vessel-profile-preview' ? '3. Import — Vessel Profile preview'
                        : step === 'import-app-update-preview' ? '3. Import — App Update preview'
                    : '2. Import — select file';
        const applyProfileBtn = step === 'import-vessel-profile-preview'
            ? `<button type="button" class="btn btn-green" onclick="TVC_App.menuXferApplyVesselProfile()">Apply</button>`
            : step === 'import-app-update-preview'
                ? `<button type="button" class="btn btn-green" onclick="TVC_App.menuXferApplyAppUpdate()">Install update</button>`
                : '';
        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeMenuXferMenu()">×</button>
            <h3 class="spare-sync-title">Data Export &amp; Import</h3>
            <p class="spare-sync-step-label muted">${esc(stepLabel)}</p>
            ${content}
            <div class="modal-actions spare-sync-footer">${backBtn}
                ${applyProfileBtn}
                <button type="button" class="btn" onclick="TVC_App.closeMenuXferMenu()">Close</button>
            </div>`;
        if (step === 'export-case-select') {
            bindMenuXferCaseTableEvents();
            TVC_ListFilters?.syncBtn('caseXfer');
            TVC_PWA?.initDateInputFormat?.(body);
        } else if (step === 'export-monthly-select') {
            bindMenuXferMonthlyTableEvents();
            TVC_ListFilters?.syncBtn('monthlyXfer');
            TVC_PWA?.initDateInputFormat?.(body);
        } else {
            TVC_ListFilters?.closePopover();
        }
        refreshSearchClearUi(body);
    }

    async function openMenuXferMenu() {
        const f = state.user
            ? (typeof TVC_Space !== 'undefined' ? TVC_Space.getUiFeatures(state.user) : TVC_RBAC.getUiFeatures(state.user))
            : {};
        if (!f.showDataXfer && !f.showExportHq && !f.showImportHq && !f.showAppUpdateAdmin) {
            await TVC_Dialog.alert('No permission for Data Export & Import.');
            return;
        }
        resetMenuXfer();
        renderMenuXferModal();
        showModal('menuXferModal');
    }

    function closeMenuXferMenu() {
        TVC_ListFilters?.closePopover();
        closeModal('menuXferModal');
        resetMenuXfer();
    }

    function menuXferPickMode(mode) {
        _menuXfer.mode = mode;
        _menuXfer.step = mode === 'export' ? 'export-type' : 'import';
        if (mode === 'import') _menuXfer.importType = null;
        renderMenuXferModal();
    }

    function menuXferBack() {
        if (_menuXfer.step === 'export-case-ready'
            || _menuXfer.step === 'export-case-select'
            || _menuXfer.step === 'export-monthly-ready'
            || _menuXfer.step === 'export-monthly-select'
            || _menuXfer.step === 'export-vessel-profile-ready') {
            _menuXfer.step = 'export-type';
            delete _menuXfer.selectedCaseKeys;
            delete _menuXfer.selectedMonthlyReportIds;
            resetMenuXferCaseListChrome();
            resetMenuXferMonthlyListChrome();
            delete _menuXfer.monthlySearch;
        } else if (_menuXfer.step === 'import-vessel-profile-preview' || _menuXfer.step === 'import-app-update-preview') {
            _menuXfer.step = 'import';
            delete _menuXfer.vesselProfilePending;
            delete _menuXfer.appUpdatePending;
        } else if (_menuXfer.step === 'export-app-update') {
            _menuXfer.step = 'export-type';
        } else if (_menuXfer.step === 'export-type' || _menuXfer.step === 'import') {
            _menuXfer.step = 'mode';
            _menuXfer.importType = null;
            delete _menuXfer.vesselProfilePending;
            delete _menuXfer.appUpdatePending;
        }
        renderMenuXferModal();
    }

    function menuXferSelectImportType(key) {
        let k = String(key || '');
        if (k === 'workPermit' || k === 'defect' || k === 'postpone') k = 'case';
        if (!MENU_IMPORT_TYPES.some(t => t.key === k)) return;
        _menuXfer.importType = _menuXfer.importType === k ? null : k;
        renderMenuXferModal();
    }

    async function menuXferPickExportType(type) {
        const mapped = (type === 'workPermit' || type === 'defect' || type === 'postpone') ? 'case' : type;
        _menuXfer.exportType = mapped;
        if (mapped === 'case') {
            _menuXfer.step = 'export-case-select';
            _menuXfer.selectedCaseKeys = {};
            resetMenuXferCaseListChrome();
            _menuXfer.exportFilenameLookup = await buildMenuXferCaseFilenameLookup();
        } else if (mapped === 'vesselProfile') {
            _menuXfer.step = 'export-vessel-profile-ready';
            delete _menuXfer.exportFilenameLookup;
        } else {
            _menuXfer.step = 'export-monthly-select';
            _menuXfer.selectedMonthlyReportIds = {};
            resetMenuXferMonthlyListChrome();
            _menuXfer.exportFilenameLookup = await buildMenuXferExportFilenameLookup('monthly');
        }
        renderMenuXferModal();
    }

    function menuXferAppUpdateExportHtml() {
        if (typeof TVC_AppUpdate === 'undefined') {
            return '<p class="spare-sync-note muted">App Update module unavailable.</p>';
        }
        const skus = _menuXfer.appUpdateSkus || {};
        const files = _menuXfer.appUpdateFiles || {};
        const ver = _menuXfer.appUpdateVersion
            || (typeof TVC_AppUpdate !== 'undefined' && TVC_AppUpdate.currentAppVersion
                ? TVC_AppUpdate.currentAppVersion()
                : '1.0.6');
        const notes = _menuXfer.appUpdateNotes || '';
        const companyId = _menuXfer.appUpdateCompanyId || state.selectedAdminCompanyId || '';
        const recordDeploy = _menuXfer.appUpdateRecordDeploy !== false;
        const skuRows = ['HQ_OFFICE', 'VESSEL_ENGINE', 'VESSEL_DECK', 'VESSEL_MASTER'].map(sku => {
            const checked = skus[sku] ? 'checked' : '';
            const fname = files[sku]?.name || '';
            return `<tr>
                <td style="padding:4px 8px"><label><input type="checkbox" data-sku="${escAttr(sku)}" ${checked}
                    onchange="TVC_App.menuXferAppUpdateToggleSku('${escAttr(sku)}', this.checked)"> ${esc(sku)}</label></td>
                <td style="padding:4px 8px">
                    <button type="button" class="btn btn-sm" onclick="TVC_App.menuXferAppUpdatePickSetup('${escAttr(sku)}')">Attach Setup…</button>
                    <span class="muted" style="margin-left:6px">${esc(fname || '—')}</span>
                </td>
            </tr>`;
        }).join('');
        return `
            <p class="spare-sync-hint">Package <strong>App Update</strong> for HQ / Vessel (Setup.exe only).</p>
            <p class="spare-sync-note muted">Does <strong>not</strong> include PMS Master, SPARE Master, or Work History. Build Setup with <code>npm run dist</code>, attach files, Export ZIP, send to company HQ.</p>
            <label class="spare-sync-note" style="display:block;margin:8px 0">Company (deploy registry)
                <select class="admin-company-select" style="margin-top:4px"
                    onchange="TVC_App.menuXferAppUpdateSetCompany(this.value)">
                    ${adminSeatLicenseCompanyOptions(companyId)}
                </select>
            </label>
            <label class="spare-sync-note">App version
                <input id="appUpdateVersionInput" type="text" value="${escAttr(ver)}" style="width:100%;margin-top:4px"
                    oninput="TVC_App.menuXferAppUpdateSetVersion(this.value)">
            </label>
            <label class="spare-sync-note" style="display:block;margin-top:8px">Update notes
                <textarea id="appUpdateNotesInput" rows="4" style="width:100%;margin-top:4px"
                    oninput="TVC_App.menuXferAppUpdateSetNotes(this.value)">${esc(notes)}</textarea>
            </label>
            <table style="width:100%;margin:12px 0;border-collapse:collapse">${skuRows}</table>
            <label class="spare-sync-note"><input type="checkbox"${recordDeploy ? ' checked' : ''}
                onchange="TVC_App.menuXferAppUpdateSetRecordDeploy(this.checked)"> Update deploy version in registry after export</label>
            <div class="spare-sync-actions">
                <button type="button" class="btn btn-green spare-sync-btn" onclick="TVC_App.menuXferConfirmAppUpdateExport()">Export App Update ZIP</button>
            </div>`;
    }

    function menuXferAppUpdateToggleSku(sku, on) {
        _menuXfer.appUpdateSkus = _menuXfer.appUpdateSkus || {};
        _menuXfer.appUpdateSkus[sku] = !!on;
        if (!on && _menuXfer.appUpdateFiles) delete _menuXfer.appUpdateFiles[sku];
        renderMenuXferModal();
    }

    function menuXferAppUpdateSetVersion(v) {
        _menuXfer.appUpdateVersion = String(v || '').trim();
    }

    function menuXferAppUpdateSetNotes(v) {
        _menuXfer.appUpdateNotes = String(v || '');
    }

    function menuXferAppUpdateSetCompany(id) {
        _menuXfer.appUpdateCompanyId = String(id || '').trim() || null;
    }

    function menuXferAppUpdateSetRecordDeploy(on) {
        _menuXfer.appUpdateRecordDeploy = !!on;
    }

    function menuXferAppUpdatePickSetup(sku) {
        const input = document.getElementById('menuXferAppUpdateSetupFile');
        if (!input) return;
        _menuXfer._pickSetupSku = sku;
        input.value = '';
        input.click();
    }

    function menuXferAppUpdateOnSetupFile(file) {
        const sku = _menuXfer._pickSetupSku;
        if (!sku || !file) return;
        _menuXfer.appUpdateFiles = _menuXfer.appUpdateFiles || {};
        _menuXfer.appUpdateSkus = _menuXfer.appUpdateSkus || {};
        _menuXfer.appUpdateFiles[sku] = file;
        _menuXfer.appUpdateSkus[sku] = true;
        delete _menuXfer._pickSetupSku;
        renderMenuXferModal();
    }

    async function menuXferConfirmAppUpdateExport() {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !TVC_RBAC.isAdminAccount?.(user)) {
            await TVC_Dialog.alert('Admin Mode (tvc) only.');
            return;
        }
        if (typeof TVC_AppUpdate === 'undefined') {
            await TVC_Dialog.alert('App Update module unavailable.');
            return;
        }
        try {
            const skus = _menuXfer.appUpdateSkus || {};
            const files = _menuXfer.appUpdateFiles || {};
            const setupFiles = Object.keys(skus).filter(s => skus[s] && files[s]).map(s => ({
                sku: s,
                file: files[s],
            }));
            const { blob, filename, manifest } = await TVC_AppUpdate.buildZip(user, {
                appVersion: _menuXfer.appUpdateVersion || document.getElementById('appUpdateVersionInput')?.value,
                notes: _menuXfer.appUpdateNotes || document.getElementById('appUpdateNotesInput')?.value,
                setupFiles,
            });
            await TVC_FileExport.save(blob, filename);
            if (_menuXfer.appUpdateRecordDeploy !== false && _menuXfer.appUpdateCompanyId) {
                const ver = manifest.app_version || _menuXfer.appUpdateVersion;
                const deployEntries = (manifest.target_skus || []).map(sku => ({
                    companyId: _menuXfer.appUpdateCompanyId,
                    kind: 'update',
                    sku,
                    appVersion: ver,
                }));
                await recordAdminDeployAndSave(deployEntries);
            }
            await TVC_Dialog.alert(
                `App Update exported.\n${filename}\nTargets: ${(manifest.target_skus || []).join(', ')}\n\nSend this ZIP to HQ/Vessel. Import → App Update → Install update.`
            );
            closeMenuXferMenu();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    function menuXferAppUpdateImportPreviewHtml() {
        const pending = _menuXfer.appUpdatePending;
        if (!pending) return '<p class="muted">No App Update loaded.</p>';
        const m = pending.manifest || {};
        const setups = (m.setups || []).map(s => `<li>${esc(s.sku)} — ${esc(s.filename)}</li>`).join('') || '<li>—</li>';
        const isCompany = m.delivery_mode === 'company';
        const vesselLines = (m.registry_vessels || []).map(v =>
            `<li>${esc(v.vessel_id)}</li>`
        ).join('') || (m.allowed_vessel_ids || []).map(id => `<li>${esc(id)}</li>`).join('');
        return `
            <p class="spare-sync-hint">App Update <strong>v${esc(m.app_version || '—')}</strong>${isCompany ? ` · <strong>${esc(m.company_name || m.company_id || '')}</strong>` : ' · pool'}</p>
            <p class="spare-sync-note muted">Operational data (PMS/SPARE Master, Work History) is <strong>not</strong> modified. Only the application installer runs.</p>
            ${isCompany ? `<p class="spare-sync-note">Company scope · allowedVesselIds / Ship List:</p><ul>${vesselLines || '<li>—</li>'}</ul>
                <p class="spare-sync-note muted">HQ: Import new seat license from TVC for full Ship List enforcement.</p>` : ''}
            <p class="spare-sync-note">${esc(m.notes || '(no notes)')}</p>
            <p class="spare-sync-note muted">Setups in package:</p>
            <ul>${setups}</ul>
            <p class="spare-sync-note muted">File: ${esc(pending.filename || '')}</p>`;
    }

    async function menuXferLoadAppUpdatePreview(file) {
        if (typeof TVC_AppUpdate === 'undefined') throw new Error('App Update module unavailable.');
        if (TVC_RBAC.isAdminAccount?.(state.user)) {
            throw new Error('Admin Mode exports App Updates; install them on HQ / Vessel.');
        }
        const parsed = await TVC_AppUpdate.parseFile(file);
        const lic = typeof TVC_License !== 'undefined' ? await TVC_License.getStatus() : null;
        const check = await TVC_AppUpdate.validateForInstall(parsed, lic);
        if (!check.ok) throw new Error(check.error);
        _menuXfer.appUpdatePending = {
            filename: file.name || '',
            parsed,
            manifest: parsed.manifest,
            sku: check.sku,
            setup: check.setup,
        };
        if (parsed.manifest?.delivery_mode === 'company' && typeof TVC_AppUpdate !== 'undefined') {
            TVC_AppUpdate.applyCompanyScopeToFleet(parsed.manifest);
            if (TVC_RBAC.isHqAccount?.(state.user)) renderFleetList();
        }
        _menuXfer.step = 'import-app-update-preview';
        renderMenuXferModal();
    }

    async function menuXferApplyAppUpdate() {
        const pending = _menuXfer.appUpdatePending;
        if (!pending?.parsed) {
            await TVC_Dialog.alert('No App Update loaded.');
            return;
        }
        try {
            const lic = typeof TVC_License !== 'undefined' ? await TVC_License.getStatus() : null;
            const result = await TVC_AppUpdate.applyUpdate(pending.parsed, lic);
            if (!result.ok) {
                await TVC_Dialog.alert(result.error || 'Install failed.');
                return;
            }
            if (pending.manifest?.delivery_mode === 'company' && typeof TVC_AppUpdate !== 'undefined') {
                TVC_AppUpdate.applyCompanyScopeToFleet(pending.manifest);
                if (TVC_RBAC.isHqAccount?.(state.user)) renderFleetList();
            }
            await TVC_Dialog.alert(result.message || 'Installer launched.');
            closeMenuXferMenu();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    function menuXferVesselProfileExportHtml() {
        if (typeof TVC_VesselProfileSync === 'undefined') {
            return '<p class="spare-sync-note muted">Vessel Profile module is unavailable.</p>';
        }
        if (!state.selectedVesselId) {
            return `
                <p class="spare-sync-hint">Select a vessel in Fleet first.</p>
                <p class="spare-sync-note muted">HQ Fleet에서 선박을 선택한 뒤 다시 Export하세요.</p>`;
        }
        let profile;
        try {
            profile = TVC_VesselProfileSync.profileFromFleet(state.selectedVesselId);
        } catch (e) {
            return `<p class="spare-sync-note muted">${esc(e.message || 'Vessel Profile unavailable.')}</p>`;
        }
        const rows = TVC_VesselProfileSync.FIELDS.map(f => `
            <tr><th style="text-align:left;padding:4px 8px">${esc(f.label)}</th>
            <td style="padding:4px 8px">${esc(profile[f.key] || '—')}</td></tr>`).join('');
        return `
            <p class="spare-sync-hint">Export <strong>Vessel Profile</strong> → Ship</p>
            <p class="spare-sync-note muted">Identity only (name, IMO, delivery…). PMS/SPARE Master is separate Excel.</p>
            <table class="menu-xfer-profile-table" style="width:100%;margin:8px 0;border-collapse:collapse">
                <tbody>${rows}</tbody>
            </table>
            <div class="spare-sync-actions">
                <button type="button" class="btn btn-green spare-sync-btn" onclick="TVC_App.menuXferConfirmVesselProfileExport()">Export ZIP</button>
            </div>`;
    }

    function menuXferVesselProfileImportPreviewHtml() {
        const pending = _menuXfer.vesselProfilePending;
        if (!pending?.payload?.profile) {
            return '<p class="spare-sync-note muted">No Vessel Profile loaded. Go back and open a file.</p>';
        }
        const rows = (pending.diff || []).map(r => `
            <tr${r.changed ? ' style="background:#fff8e6"' : ''}>
                <th style="text-align:left;padding:4px 8px">${esc(r.label)}</th>
                <td style="padding:4px 8px">${esc(r.current)}</td>
                <td style="padding:4px 8px">${esc(r.incoming)}${r.changed ? ' ✎' : ''}</td>
            </tr>`).join('');
        return `
            <p class="spare-sync-hint">Review Vessel Profile, then Apply.</p>
            <p class="spare-sync-note muted">File: <strong>${esc(pending.filename || '')}</strong></p>
            <table class="menu-xfer-profile-table" style="width:100%;margin:8px 0;border-collapse:collapse">
                <thead><tr>
                    <th style="text-align:left;padding:4px 8px">Field</th>
                    <th style="text-align:left;padding:4px 8px">Current</th>
                    <th style="text-align:left;padding:4px 8px">Incoming</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    async function menuXferConfirmVesselProfileExport() {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !TVC_RBAC.isHqAccount(user)) {
            await TVC_Dialog.alert('This action is available in HQ Mode only.');
            return;
        }
        if (!state.selectedVesselId) {
            await TVC_Dialog.alert('Select a vessel in Fleet first.');
            return;
        }
        if (typeof TVC_VesselProfileSync === 'undefined') {
            await TVC_Dialog.alert('Vessel Profile module is unavailable.');
            return;
        }
        try {
            const r = await TVC_VesselProfileSync.exportZip(user, {
                vesselId: state.selectedVesselId,
                selectedVesselId: state.selectedVesselId,
            });
            closeMenuXferMenu();
            await TVC_Dialog.alert(`Vessel Profile exported.\n\n${r.filename}\n\nSend this ZIP to the ship → Import → Vessel Profile.`);
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Export failed');
        }
    }

    async function menuXferApplyVesselProfile() {
        const user = TVC_Auth.getCurrentUser();
        const pending = _menuXfer.vesselProfilePending;
        if (!user || !pending?.payload) {
            await TVC_Dialog.alert('No Vessel Profile to apply.');
            return;
        }
        try {
            const r = await TVC_VesselProfileSync.apply(pending.payload, user, {
                filename: pending.filename,
            });
            state.fleet = TVC_Fleet.getAll();
            await populateShipHeader(user);
            closeMenuXferMenu();
            await TVC_Dialog.alert(
                `Vessel Profile applied.\n\n${r.profile.name}\nIMO: ${r.profile.imo_no || '—'}\nDelivery: ${r.profile.delivery || '—'}`
            );
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Apply failed');
        }
    }

    async function menuXferOpenCaseSelect() {
        _menuXfer.step = 'export-case-select';
        _menuXfer.selectedCaseKeys = {};
        resetMenuXferCaseListChrome();
        if (!_menuXfer.exportFilenameLookup?.workPermit) {
            _menuXfer.exportFilenameLookup = await buildMenuXferCaseFilenameLookup();
        }
        renderMenuXferModal();
    }

    function menuXferCollectSelectedCaseIds() {
        const pool = _menuXfer.step === 'export-case-select'
            ? menuXferCaseVisibleEntries()
            : menuXferCaseExportEntries();
        const selectable = new Set(
            pool.filter(menuXferCaseEntrySelectable).map(e => menuXferCaseKey(e.kind, e.id)),
        );
        const wpIds = menuXferSelectedCaseIds('workPermit').filter(id => selectable.has(menuXferCaseKey('workPermit', id)));
        const mnIds = menuXferSelectedCaseIds('maintenance').filter(id => selectable.has(menuXferCaseKey('maintenance', id)));
        const dfIds = menuXferSelectedCaseIds('defect').filter(id => selectable.has(menuXferCaseKey('defect', id)));
        const ppIds = menuXferSelectedCaseIds('postpone').filter(id => selectable.has(menuXferCaseKey('postpone', id)));
        const csIds = menuXferSelectedCaseIds('consume').filter(id => selectable.has(menuXferCaseKey('consume', id)));
        return { wpIds, mnIds, dfIds, ppIds, csIds, total: wpIds.length + mnIds.length + dfIds.length + ppIds.length + csIds.length };
    }

    async function menuXferConfirmCaseExportAll() {
        const keys = {};
        menuXferCaseExportEntries().filter(menuXferCaseEntrySelectable).forEach(entry => {
            keys[menuXferCaseKey(entry.kind, entry.id)] = true;
        });
        if (!Object.keys(keys).length) {
            await TVC_Dialog.alert(menuXferCaseIsVesselReview()
                ? 'No confirmed Case Reports to export.'
                : 'No approved Case Reports ready to export.');
            return;
        }
        _menuXfer.selectedCaseKeys = keys;
        await menuXferConfirmCaseExport();
    }

    async function menuXferExportCaseReview(target, ids, dirKind) {
        await menuXferExportSyncSubset(target, {
            caseReview: {
                workPermitIds: ids.wpIds || [],
                reportIds: [...(ids.mnIds || []), ...(ids.ppIds || [])],
                defectIds: ids.dfIds || [],
                consumeLogIds: ids.csIds || [],
            },
            exportDirKind: dirKind,
        });
    }

    async function menuXferConfirmCaseExport() {
        const { wpIds, mnIds, dfIds, ppIds, csIds, total } = menuXferCollectSelectedCaseIds();
        if (!total) {
            await TVC_Dialog.alert(menuXferCaseIsVesselReview()
                ? 'Select at least one confirmed Case Report.'
                : 'Select at least one exportable Case Report.');
            return;
        }
        const target = menuXferResolveExportTarget(state.user, 'workPermit');
        if (!target || !menuXferCanExportTarget(state.user, target)) {
            await TVC_Dialog.alert('You do not have permission to export Case Reports.');
            return;
        }
        const dirKind = isMasterHubMode() ? classifySelectedCaseExportDirection() : '';
        if (dirKind === 'mixed') {
            await TVC_Dialog.alert(
                'Export Approved HQ replies to Station separately from Submitted reports going to Company.',
            );
            return;
        }
        const destLabel = dirKind === 'station'
            ? menuXferHqReplyStationDestLabel()
            : menuXferExportTargetLabel(target);
        const parts = [];
        if (wpIds.length) parts.push(`${wpIds.length} W`);
        if (mnIds.length) parts.push(`${mnIds.length} M`);
        if (dfIds.length) parts.push(`${dfIds.length} D`);
        if (ppIds.length) parts.push(`${ppIds.length} P`);
        if (csIds.length) parts.push(`${csIds.length} C`);
        const action = TVC_RBAC.isHqAccount(state.user) ? 'Reply export' : 'Export';
        const reviewNote = dirKind === 'station'
            ? ' so Station can apply HQ approval'
            : (menuXferCaseIsVesselReview() ? ' so Company can review vessel work' : '');
        if (!await TVC_Dialog.confirm({
            kind: 'confirm',
            message: `${action} ${total} Case Report(s) (${parts.join(', ')}) to ${destLabel}${reviewNote}?`,
        })) return;
        closeMenuXferMenu();
        try {
            await menuXferExportCaseReview(target, { wpIds, mnIds, dfIds, ppIds, csIds }, dirKind);
            if (dfIds.length && typeof TVC_DefectSync?.stampCaseReportExport === 'function') {
                await TVC_DefectSync.stampCaseReportExport(TVC_Auth.getCurrentUser(), dfIds);
            }
            if (dirKind === 'station') {
                await stampMasterHqReplyCaseForwarded({ wpIds, ppIds });
            }
            await TVC_Dialog.alert(`Exported ${total} Case Report(s) (${parts.join(', ')}) → ${destLabel}.`);
        } catch (e) {
            await TVC_Dialog.alert(e.message || e);
        }
    }

    async function menuXferConfirmMonthlyExport() {
        if (menuXferVesselMonthlyBlocked()) {
            const open = menuXferVesselOpenReports();
            await TVC_Dialog.alert(
                `Monthly Report can export only when no report is still Reported / Draft.\n\nOpen: W ${open.w} · M ${open.m} · D ${open.d} · P ${open.p} · C ${open.c}\n\nConfirm them in Report History first.`,
            );
            return;
        }
        const dept = getPlanLockDept();
        const user = state.user;
        const isStation = typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user);
        const locked = isOriginalPlanUpdateLocked(dept);
        const snapshot = monthlyExportUsesSnapshot(user, dept);
        if (isStation && !locked && !snapshot) {
            if (stationPendingConfirmedReportCount(dept) === 0) {
                await TVC_Dialog.alert('No confirmed Work Reports ready to export.\n\nConfirm reports in Work History first.');
                return;
            }
        }
        const target = menuXferResolveExportTarget(user, 'monthly');
        if (!target || !menuXferCanExportTarget(user, target)) {
            await TVC_Dialog.alert(isMasterHubMode()
                ? 'Select Deck or Engine first, then export Monthly Report to Company.'
                : 'You do not have permission to export monthly report.');
            return;
        }
        let reportIds = null;
        if (_menuXfer.step === 'export-monthly-select') {
            reportIds = menuXferCollectSelectedMonthlyIds();
            if (!reportIds.length) {
                await TVC_Dialog.alert('Select at least one Monthly Report to export.');
                return;
            }
        } else if (!snapshot) {
            reportIds = stationPendingConfirmedReportRows(dept).map(r => r.id);
        }
        const destLabel = menuXferExportTargetLabel(target);
        const exportCount = reportIds
            ? reportIds.length
            : monthlyExportWorkReportRows(dept, { snapshot }).length;
        const confirmMsg = _menuXfer.step === 'export-monthly-select'
            ? `Export ${exportCount} selected Work Report(s) to ${destLabel}?`
            : snapshot
                ? `Export Monthly Report (${exportCount} Work Report(s)) to ${destLabel}?`
                : `Export ${exportCount} confirmed Work Report(s) (pending changes) to ${destLabel}?`;
        if (!await TVC_Dialog.confirm({ message: confirmMsg })) return;
        closeMenuXferMenu();
        try {
            await menuXferExportMonthly(target, { reportIds });
        } catch (e) { await TVC_Dialog.alert(e.message || e); }
    }

    function defectCasesForExportTarget(cases, target) {
        if (target === 'COMPANY') return cases;
        return (cases || []).filter(c => String(c.department || '').toUpperCase() === target);
    }

    function menuXferCaseSyncDept(target) {
        if (target && target !== 'COMPANY') return target;
        return getPlanLockDept();
    }

    async function menuXferExportSyncSubset(target, packOpts, emptyMsg) {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        const dept = menuXferCaseSyncDept(target);
        if (!dept) throw new Error('Select Deck or Engine first.');
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)) {
            TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.STATION_EXPORT);
            await TVC_Sync.exportZip(user, TVC_Space.Direction.STATION_TO_HUB, dept, {
                station_id: TVC_Space.getStation(user),
                ...packOpts,
            });
        } else {
            let relayHqReply = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)
                && monthlyHasHqReplyForDept(dept);
            if (isMasterHubMode() && packOpts.caseReview) {
                const kind = packOpts.exportDirKind || classifySelectedCaseExportDirection();
                if (kind === 'mixed') {
                    throw new Error('Export Approved HQ replies to Station separately from Submitted reports going to Company.');
                }
                relayHqReply = kind === 'station';
            }
            const direction = TVC_RBAC.isHqAccount(user) || relayHqReply ? 'HQ_TO_SHIP' : 'SHIP_TO_HQ';
            await TVC_Sync.exportZip(user, direction, dept, packOpts);
        }
        await refreshAll();
        if (state.currentTab === 'menu') renderSyncHistory();
    }

    async function menuXferExportMaintenance(target, selectedIds, opts = {}) {
        const ids = (selectedIds || []).filter(Boolean);
        if (!ids.length) throw new Error('No Maintenance Reports selected.');
        await menuXferExportSyncSubset(target, { reportIds: ids }, 'No Maintenance Reports selected.');
        if (!opts.quiet) {
            const dest = menuXferExportTargetLabel(target);
            await TVC_Dialog.alert(`Exported ${ids.length} Maintenance Report(s) → ${dest}.`);
        }
    }

    async function menuXferExportConsume(target, selectedIds, opts = {}) {
        const ids = (selectedIds || []).filter(Boolean);
        if (!ids.length) throw new Error('No Consumption Reports selected.');
        await menuXferExportSyncSubset(target, { reportIds: [], consumeLogIds: ids }, 'No Consumption Reports selected.');
        if (!opts.quiet) {
            const dest = menuXferExportTargetLabel(target);
            await TVC_Dialog.alert(`Exported ${ids.length} Consumption Report(s) → ${dest}.`);
        }
    }

    async function menuXferExportMonthly(target, opts = {}) {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;

        if (target === 'COMPANY') {
            if (typeof TVC_Space === 'undefined' || !TVC_Space.isCaptainHub(user)) {
                throw new Error('Company export is available on Captain Hub (Master PC) only.');
            }
            await handleCompanyExport();
            return;
        }

        const dept = target;
        const snapshot = monthlyExportUsesSnapshot(user, dept);
        const monthlyOpts = {
            monthlyExport: snapshot,
            reportIds: opts.reportIds,
            outstanding: menuXferMonthlyOutstandingSnapshot(),
        };
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)) {
            TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.STATION_EXPORT);
            await TVC_Sync.exportZip(user, TVC_Space.Direction.STATION_TO_HUB, dept, {
                station_id: TVC_Space.getStation(user),
                ...monthlyOpts,
            });
        } else {
            const relayHqReply = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)
                && monthlyHasHqReplyForDept(dept);
            const direction = TVC_RBAC.isHqAccount(user) || relayHqReply ? 'HQ_TO_SHIP' : 'SHIP_TO_HQ';
            await TVC_Sync.exportZip(user, direction, dept, monthlyOpts);
        }
        await refreshAll();
        if (state.currentTab === 'menu') renderSyncHistory();
        const kind = snapshot ? 'Monthly Report' : 'pending changes';
        const dest = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)
            ? (monthlyHasHqReplyForDept(dept)
                ? (dept === 'DECK' ? 'Deck station (C/O)' : 'Engine station (CE)')
                : 'Company (HQ)')
            : (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)
                ? 'Master Hub'
                : 'vessel');
        await TVC_Dialog.alert(`${TVC_RBAC.getDeptLabel(dept)} ${kind} exported to ${dest}.`);
    }

    async function exportSelectedDefectCase(user, caseRow) {
        if (TVC_RBAC.isHqAccount(user)) {
            if (isDefectHqClosePending(caseRow)) {
                await TVC_DefectSync.exportCloseZip(user, caseRow.id);
                return;
            }
            if (TVC_DefectCase.isHqReplyExported(caseRow)) {
                throw new Error(`${caseRow.case_no}: already exported.`);
            }
            const v = TVC_DefectCase.validateHqDefectReplyExport(caseRow);
            if (!v.ok) {
                throw new Error(`${caseRow.case_no}: ${v.missing.join(', ')} required before HQ export.`);
            }
            await TVC_DefectSync.exportHqReplyZip(user, caseRow.id);
            return;
        }
        if (isMasterHubMode() && TVC_DefectCase.isHqReplyStationForwardPending(caseRow)) {
            await TVC_DefectSync.exportHqReplyBatchZip(user, [caseRow.id], { hubForward: true });
            return;
        }
        if (isMasterHubMode() && TVC_DefectCase.isPhase4CloseForwardPending(caseRow)) {
            await TVC_DefectSync.exportCloseZip(user, caseRow.id);
            return;
        }
        const clearedReady = isDefectCompletionReady(caseRow);
        if (clearedReady || caseRow.status === TVC_DefectCase.Status.CLOSED
            || caseRow.status === TVC_DefectCase.Status.AWAITING_COMPLETION) {
            if (caseRow.status !== TVC_DefectCase.Status.CLOSED
                && caseRow.status !== TVC_DefectCase.Status.AWAITING_COMPLETION) {
                const row = await TVC_DefectCaseService.get(caseRow.id) || caseRow;
                row.status = TVC_DefectCase.Status.CLOSED;
                if (!row.phase3_locked) row.phase3_locked = true;
                row.completed_at = row.completed_at || new Date().toISOString();
                row.sync_status = row.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (row.sync_status || 'LOCAL');
                row.updated_at = new Date().toISOString();
                await TVC_DB.put('defect_cases', row);
            }
            await TVC_DefectSync.exportCompletionZip(user, caseRow.id);
            return;
        }
        if (TVC_DefectCase.listWorkflowStatus(caseRow) !== 'Confirmed') {
            if (!(isMasterHubMode() && TVC_HubRelay.canHubLegExport(caseRow)
                && TVC_DefectCase.listWorkflowStatus(caseRow) === 'Submitted')) {
                throw new Error(`${caseRow.case_no}: only Confirmed cases can be exported.`);
            }
        }
        if (caseRow.status === TVC_DefectCase.Status.WORK_IN_PROGRESS) {
            throw new Error(`${caseRow.case_no}: complete defect clearance before export.`);
        }
        await TVC_DefectSync.exportUrgentBatchZip(user, [caseRow.id]);
    }

    async function menuXferExportDefect(target, selectedIds, opts = {}) {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        const ids = (selectedIds || []).filter(Boolean);
        if (!ids.length) throw new Error('No defect reports selected.');

        const allCases = state.defectCases || [];
        const selected = ids.map(id => allCases.find(c => c.id === id)).filter(Boolean);
        const scoped = defectCasesForExportTarget(selected, target);
        if (!scoped.length) throw new Error('No selected defect reports match this destination.');

        if (TVC_RBAC.isHqAccount(user)) {
            const replyRows = scoped.filter(c => !TVC_DefectCase.isHqReplyExported(c));
            const closeRows = scoped.filter(c => isDefectHqClosePending(c));
            let exported = 0;
            if (replyRows.length) {
                const result = await TVC_DefectSync.exportHqReplyBatchZip(user, replyRows.map(c => c.id));
                exported += result.count || replyRows.length;
            }
            for (const c of closeRows) {
                await TVC_DefectSync.exportCloseZip(user, c.id);
                exported++;
            }
            if (!exported) throw new Error('No defect reports ready to export.');
            await refreshAll();
            if (state.currentTab === 'menu') {
                renderSyncHistory();
                TVC_DefectReport?.renderInbox?.();
            }
            if (state.currentTab === 'history') renderWorkHistory();
            const dest = target === 'COMPANY' ? 'Company' : TVC_RBAC.getDeptLabel(target);
            if (!opts.quiet) await TVC_Dialog.alert(`Exported ${exported} defect report(s) → ${dest}.`);
            return;
        }

        const urgentRows = [];
        const replyRows = [];
        const completionRows = [];
        const closeRows = [];
        for (const c of scoped) {
            if (isMasterHubMode() && TVC_DefectCase.isPhase4CloseForwardPending(c)) {
                closeRows.push(c);
            } else if (isMasterHubMode() && TVC_DefectCase.isHqReplyStationForwardPending(c)) {
                replyRows.push(c);
            } else if (isDefectCompletionReady(c)
                || c.status === TVC_DefectCase.Status.CLOSED
                || c.status === TVC_DefectCase.Status.AWAITING_COMPLETION) {
                completionRows.push(c);
            } else {
                urgentRows.push(c);
            }
        }

        let exported = 0;
        if (replyRows.length) {
            const result = await TVC_DefectSync.exportHqReplyBatchZip(user, replyRows.map(c => c.id), { hubForward: true });
            exported += result.count || replyRows.length;
        }
        if (urgentRows.length) {
            const result = await TVC_DefectSync.exportUrgentBatchZip(user, urgentRows.map(c => c.id));
            exported += result.count || urgentRows.length;
        }
        for (const c of [...completionRows, ...closeRows]) {
            await exportSelectedDefectCase(user, c);
            exported++;
        }
        if (!exported) throw new Error('No defect reports ready to export.');

        await refreshAll();
        if (state.currentTab === 'menu') {
            renderSyncHistory();
            TVC_DefectReport?.renderInbox?.();
        }
        if (state.currentTab === 'history') renderWorkHistory();
        const dest = (closeRows.length || replyRows.length) && !urgentRows.length && !completionRows.length
            ? menuXferHqReplyStationDestLabel()
            : (target === 'COMPANY' ? 'Company' : TVC_RBAC.getDeptLabel(target));
        if (!opts.quiet) await TVC_Dialog.alert(`Exported ${exported} defect report(s) → ${dest}.`);
    }

    async function exportSelectedPostponeReport(user, reportRow) {
        const st = workReportListWorkflowStatus(reportRow);
        const code = reportRow.job_code || reportRow.id;
        if (TVC_RBAC.isHqAccount(user)) {
            if (st !== 'Approved') {
                throw new Error(`${code}: only Approved reports can be reply-exported.`);
            }
            await TVC_PostponeSync.exportHqReplyZip(user, reportRow.id);
            return;
        }
        const hub = typeof TVC_HubRelay !== 'undefined' && TVC_HubRelay.isHubRelayExport(user);
        if (hub || isMasterHubMode()) {
            if (st === 'Approved') {
                await TVC_PostponeSync.exportHqReplyZip(user, reportRow.id);
                if (!reportRow.hq_reply_forwarded_at) {
                    reportRow.hq_reply_forwarded_at = new Date().toISOString();
                    await TVC_DB.put('daily_work_reports', reportRow);
                }
                return;
            }
            if (st !== 'Submitted' || !TVC_HubRelay.canHubLegExport(reportRow)) {
                throw new Error(`${code}: awaiting station export first (Submitted). Report Confirm is station-only.`);
            }
            await TVC_PostponeSync.exportRequestZip(user, reportRow.id);
            return;
        }
        if (st !== 'Confirmed') {
            throw new Error(`${code}: only Confirmed reports can be exported.`);
        }
        await TVC_PostponeSync.exportRequestZip(user, reportRow.id);
    }

    async function menuXferExportPostpone(target, selectedIds, opts = {}) {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        const ids = (selectedIds || []).filter(Boolean);
        if (!ids.length) throw new Error('No postpone reports selected.');

        const allReports = state.reports || [];
        const selected = ids.map(id => allReports.find(r => r.id === id)).filter(Boolean);
        const scoped = target === 'COMPANY'
            ? selected
            : selected.filter(r => reportDept(r) === target);
        if (!scoped.length) throw new Error('No selected postpone reports match this destination.');

        let exported = 0;
        for (const r of scoped) {
            await exportSelectedPostponeReport(user, r);
            exported++;
        }
        if (!exported) throw new Error('No postpone reports ready to export.');

        await refreshAll();
        if (state.currentTab === 'menu') renderSyncHistory();
        if (state.currentTab === 'history') renderWorkHistory();
        const dest = target === 'COMPANY' ? 'Company' : TVC_RBAC.getDeptLabel(target);
        const kind = TVC_RBAC.isHqAccount(user) ? 'reply' : 'request';
        if (!opts.quiet) await TVC_Dialog.alert(`Exported ${exported} postpone ${kind} package(s) → ${dest}.`);
    }

    async function exportSelectedWorkPermit(user, row) {
        if (TVC_RBAC.isHqAccount(user)) {
            if (TVC_WorkPermit.listWorkflowStatus(row) !== 'Approved') {
                throw new Error(`${row.permit_no || row.job_code}: only Approved permits can be reply-exported.`);
            }
            await TVC_WorkPermitSync.exportHqReplyZip(user, row.id);
            return;
        }
        if (TVC_WorkPermit.listWorkflowStatus(row) !== 'Confirmed') {
            if (isMasterHubMode() && TVC_WorkPermit.isHqReplyStationForwardPending(row)) {
                await TVC_WorkPermitSync.exportHqReplyZip(user, row.id);
                if (typeof TVC_WorkPermit.stampHqReplyStationForwarded === 'function') {
                    TVC_WorkPermit.stampHqReplyStationForwarded(row);
                    await TVC_DB.put('work_permits', row);
                }
                return;
            }
            throw new Error(`${row.permit_no || row.job_code}: only Confirmed permits can be exported.`);
        }
        await TVC_WorkPermitSync.exportRequestZip(user, row.id);
    }

    async function menuXferExportWorkPermit(target, selectedIds, opts = {}) {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        const ids = (selectedIds || []).filter(Boolean);
        if (!ids.length) throw new Error('No Work Permits selected.');

        const allRows = state.workPermits || [];
        const selected = ids.map(id => allRows.find(r => r.id === id)).filter(Boolean);
        const scoped = target === 'COMPANY'
            ? selected
            : selected.filter(r => TVC_WorkPermit.belongsToDepartment(r, target));
        if (!scoped.length) throw new Error('No selected Work Permits match this destination.');

        const scopedIds = scoped.map(r => r.id);
        const result = TVC_RBAC.isHqAccount(user)
            ? await TVC_WorkPermitSync.exportHqReplyBatchZip(user, scopedIds)
            : await TVC_WorkPermitSync.exportRequestBatchZip(user, scopedIds);

        await refreshAll();
        if (state.currentTab === 'menu') renderSyncHistory();
        const dest = target === 'COMPANY' ? 'Company (Hub)' : TVC_RBAC.getDeptLabel(target);
        const kind = TVC_RBAC.isHqAccount(user) ? 'reply' : 'request';
        if (!opts.quiet) await TVC_Dialog.alert(`Exported ${result.count} Work Permit(s) in 1 package (${result.filename}) → ${dest} ${kind}.`);
    }

    async function menuXferTriggerImport() {
        if (!_menuXfer.importType) {
            await TVC_Dialog.alert('Select an import type first.');
            return;
        }
        const fi = document.getElementById('menuXferImportFile');
        if (!fi) return;
        const mode = _menuXfer.importType;
        if (mode === 'monthly') {
            fi.setAttribute('accept', '.zip,.json,.csv,application/zip,application/json,text/csv');
        } else {
            fi.setAttribute('accept', '.zip,application/zip');
        }
        fi.value = '';
        fi.click();
    }

    async function detectMenuImportType(file) {
        const name = (file.name || '').toLowerCase();
        if (!name.endsWith('.zip')) return 'MONTHLY';
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const files = Object.keys(zip.files);
        if (files.some(f => /tvc_app_update\.json$/i.test(f))) return 'APP_UPDATE';
        if (files.some(f => /tvc_vessel_profile\.json$/i.test(f) || /vessel_profile/i.test(f))) return 'VESSEL_PROFILE';
        const jsonFile = zip.file('tvc_sync.json') || zip.file('tvc_station_export.json');
        if (jsonFile) {
            try {
                const payload = JSON.parse(await jsonFile.async('string'));
                const pkg = String(payload.export_meta?.package_type || '');
                if (/^CASE/i.test(pkg)) return 'CASE';
                if (/^MONTHLY/i.test(pkg)) return 'MONTHLY';
            } catch (_) { /* fall through to filename heuristics */ }
        }
        if (files.some(f => /defect_case/i.test(f))) return 'DEFECT';
        if (files.some(f => /postpone_report/i.test(f))) return 'POSTPONE';
        if (files.some(f => /work_permit/i.test(f))) return 'WORK_PERMIT';
        return 'MONTHLY';
    }

    async function menuXferImportMonthly(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        const name = (file.name || '').toLowerCase();
        const isMasterHub = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user);

        if (name.endsWith('.zip')) {
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const jsonFile = zip.file('tvc_sync.json');
            if (jsonFile) {
                const payload = JSON.parse(await jsonFile.async('string'));
                const dir = payload.export_meta?.direction;
                if (dir === 'STATION_TO_HUB') {
                    if (isMasterHub) {
                        const dept = await pickImportDepartment();
                        if (!dept) return;
                        state._pendingImportDept = dept;
                        await handleHubImport(file, dept);
                        return;
                    }
                    if (TVC_RBAC.isHqAccount(user)) {
                        const fileDept = payload.export_meta?.department
                            || (typeof TVC_Sync.resolveFileDepartment === 'function'
                                ? TVC_Sync.resolveFileDepartment(payload, file.name)
                                : null);
                        state._pendingImportDept = fileDept;
                        await handleImport(file);
                        return;
                    }
                    throw new Error(
                        typeof TVC_Sync.stationExportImportDeniedMessage === 'function'
                            ? TVC_Sync.stationExportImportDeniedMessage(
                                payload.export_meta?.department
                                    || (typeof TVC_Sync.resolveFileDepartment === 'function'
                                        ? TVC_Sync.resolveFileDepartment(payload, file.name)
                                        : null),
                            )
                            : 'Import station export ZIP in Master Mode or HQ Mode (matching department toggle).'
                    );
                }
                if (TVC_RBAC.isHqAccount(user) && (dir === 'SHIP_TO_HQ' || payload.export_meta?.package_type === 'COMPANY_REPORT')) {
                    state._pendingImportDept = 'ALL';
                    await handleImport(file);
                    return;
                }
                if (!TVC_RBAC.isHqAccount(user) && dir === 'HQ_TO_SHIP') {
                    const fileDept = payload.export_meta?.department;
                    state._pendingImportDept = fileDept === 'ALL' ? (user.department || 'ALL') : (fileDept || user.department);
                    await handleImport(file);
                    return;
                }
            }
        }

        if (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)
            && (name.endsWith('.json') || name.endsWith('.csv'))) {
            const dept = await pickImportDepartment();
            if (!dept) return;
            state._pendingImportDept = dept;
            await handleHubImport(file, dept);
            return;
        }
        const run = async (dept) => {
            state._pendingImportDept = dept;
            await handleImport(file);
        };
        if (accountNeedsDeptPick(user) || !user.department) {
            const dept = await pickImportDepartment();
            if (!dept) return;
            await run(dept);
        } else {
            await run(user.department);
        }
    }

    async function onMenuXferImportFile(file) {
        if (!file) return;
        const selected = _menuXfer.importType || '';
        if (!selected) {
            await TVC_Dialog.alert('Select an import type first.');
            return;
        }
        try {
            const detected = await detectMenuImportType(file);
            const expected = {
                appUpdate: 'APP_UPDATE',
                case: 'CASE',
                monthly: 'MONTHLY',
                vesselProfile: 'VESSEL_PROFILE',
            }[selected];
            const labels = {
                APP_UPDATE: 'App Update',
                CASE: 'Case Report',
                WORK_PERMIT: 'Case Report',
                DEFECT: 'Case Report',
                POSTPONE: 'Case Report',
                MONTHLY: 'Monthly Report',
                VESSEL_PROFILE: 'Vessel Profile',
            };
            const caseKinds = detected === 'CASE' || detected === 'WORK_PERMIT' || detected === 'DEFECT'
                || detected === 'POSTPONE' || detected === 'MONTHLY';
            if (selected === 'case') {
                if (!caseKinds) {
                    throw new Error(
                        `Selected type (Case Report) does not match file type (${labels[detected] || detected}).`
                    );
                }
            } else if (expected && detected !== expected) {
                throw new Error(
                    `Selected type (${labels[expected] || expected}) does not match file type (${labels[detected] || detected}).`
                );
            }
            if (selected === 'appUpdate') {
                await menuXferLoadAppUpdatePreview(file);
                return;
            }
            if (selected === 'vesselProfile') {
                await menuXferLoadVesselProfilePreview(file);
                return;
            }
            if (selected === 'case') {
                if (detected === 'WORK_PERMIT') await handleWorkPermitImport(file);
                else if (detected === 'DEFECT') await handleDefectImport(file);
                else if (detected === 'POSTPONE') await handlePostponeImport(file);
                else await menuXferImportMonthly(file);
            } else {
                await menuXferImportMonthly(file);
            }
            closeMenuXferMenu();
        } catch (e) {
            await TVC_Dialog.alert('Import failed: ' + (e.message || e));
        } finally {
            const fi = document.getElementById('menuXferImportFile');
            if (fi) fi.value = '';
        }
    }

    async function menuXferLoadVesselProfilePreview(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || TVC_RBAC.isHqAccount(user)) {
            throw new Error('Vessel Profile Import is available in vessel mode only.');
        }
        if (typeof TVC_VesselProfileSync === 'undefined') {
            throw new Error('Vessel Profile module is unavailable.');
        }
        const payload = await TVC_VesselProfileSync.parseFile(file);
        const check = await TVC_VesselProfileSync.validateForShip(payload, user);
        if (!check.ok) throw new Error(check.error);
        const current = TVC_VesselProfileSync.currentShipProfile(check.expected);
        _menuXfer.vesselProfilePending = {
            filename: file.name || '',
            payload,
            diff: TVC_VesselProfileSync.diffRows(current, payload.profile),
        };
        _menuXfer.step = 'import-vessel-profile-preview';
        renderMenuXferModal();
    }

    function menuHistViewerKind(user) {
        if (!user) return 'ship';
        if (TVC_RBAC.isHqAccount(user)) return 'hq';
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)) return 'hub';
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)) return 'station';
        if (TVC_RBAC.isApprover(user)) return 'station';
        return 'ship';
    }

    function menuHistAccountHint(user) {
        const kind = menuHistViewerKind(user);
        if (kind === 'hq') return 'HQ Mode — shows Export / Import history for the vessel (Master).';
        if (kind === 'hub') return 'Hub (Captain) — shows Export / Import history with Engine/Deck stations and Company (HQ).';
        if (kind === 'station') {
            return 'Confirmer — primarily exports/imports with Master. Company (HQ) packages are also recorded if Master PC is unavailable.';
        }
        return 'Data Export & Import History';
    }

    /** 이력 행의 상대방(Direction) 표시 — 계정 역할 기준 */
    function menuHistPeerLabel(row, user) {
        if (row?.peer) return row.peer;
        const kind = menuHistViewerKind(user);
        const d = String(row?.direction || '');
        const dept = String(row?.department || '').toUpperCase();
        const station = String(row?.station_id || '').toUpperCase();

        const stationPeer = () => {
            if (dept === 'ENGINE' || station === 'ECR') return 'Engine';
            if (dept === 'DECK' || station === 'CCR') return 'Deck';
            if (dept === 'ENGINE') return 'Engine';
            if (dept === 'DECK') return 'Deck';
            return 'Station';
        };

        const isCompanyDir = () =>
            d === 'SHIP_TO_HQ' || d === 'HQ_TO_SHIP'
            || /TO_HQ|HQ_TO|REPLY_HQ|CLOSE_HQ|COMPANY/i.test(d);

        const isStationDir = () =>
            d === 'STATION_TO_HUB' || d === 'HUB_MERGE' || /STATION/i.test(d);

        if (kind === 'hq') {
            const vid = row?.vessel_id;
            if (vid && vid !== '—') {
                const fleet = typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.resolveById?.(vid) : null;
                return fleet?.name || vid;
            }
            return 'Vessel';
        }

        if (kind === 'hub') {
            if (isStationDir()) return stationPeer();
            if (isCompanyDir()) return 'Company';
            // Monthly / Defect / Postpone 기본: Company, Station 패키지만 Engine/Deck
            if (d === 'STATION_TO_HUB') return stationPeer();
            return 'Company';
        }

        // Station confirmer (CE / CO): Master 기본, HQ 직송은 Company
        if (isCompanyDir() && !isStationDir()) return 'Company';
        return 'Master';
    }

    function menuHistCategoryKey(row) {
        const label = menuXferCategoryFromRow(row);
        if (!label) return null;
        if (label === 'Case Report' || label === 'Work Permit' || label === 'Defect Report' || label === 'Postpone Report') {
            return 'case';
        }
        if (label === 'Vessel Profile') return null;
        return 'monthly';
    }

    function menuHistCategoryLabel(key) {
        return {
            case: 'Case Report',
            monthly: 'Monthly Report',
        }[key] || 'Monthly Report';
    }

    function menuHistNormalizeCategory(key) {
        return key === 'monthly' ? 'monthly' : 'case';
    }

    async function openMenuHistoryModal() {
        _menuHistCategory = menuHistNormalizeCategory(_menuHistCategory);
        await renderMenuHistoryModal();
        showModal('menuHistoryModal');
    }

    function closeMenuHistoryModal() {
        closeModal('menuHistoryModal');
    }

    async function setMenuHistCategory(key) {
        _menuHistCategory = menuHistNormalizeCategory(key);
        await renderMenuHistoryModal();
    }

    async function renderMenuHistoryModal() {
        const body = document.getElementById('menuHistoryBody');
        if (!body) return;
        const user = state.user;
        const all = await loadSyncHistoryRows();
        const cat = menuHistNormalizeCategory(_menuHistCategory);
        _menuHistCategory = cat;
        const rows = all.filter(r => menuHistCategoryKey(r) === cat && !isMasterExcelHistoryRow(r));
        const tabs = ['case', 'monthly'].map(key => `
            <button type="button" class="menu-hist-cat${cat === key ? ' active' : ''}"
                onclick="TVC_App.setMenuHistCategory('${key}')">${esc(menuHistCategoryLabel(key))}</button>`).join('');
        const tbody = rows.map(r => {
            const dt = histEventDate(r);
            const isExport = String(r.type || '').toUpperCase() === 'EXPORT';
            const peer = menuHistPeerLabel(r, user);
            const fileCell = histFilenameCellHtml(histSyncFilename(r));
            return `<tr>
                <td class="menu-hist-exp">${isExport ? esc(dt) : ''}</td>
                <td class="menu-hist-imp">${isExport ? '' : esc(dt)}</td>
                <td class="menu-hist-dir">${esc(peer)}</td>
                <td class="menu-hist-file">${fileCell}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="4" class="muted" style="text-align:center">No ${esc(menuHistCategoryLabel(cat))} history yet.</td></tr>`;

        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeMenuHistoryModal()">×</button>
            <h3 class="spare-sync-title">Data Export &amp; Import History</h3>
            <p class="spare-hist-sub muted">${esc(menuHistAccountHint(user))}</p>
            <div class="menu-hist-cats" role="tablist">${tabs}</div>
            <div class="spics-tx-lines-wrap menu-hist-table-wrap">
                <table class="spics-tx-table spics-hist-table menu-hist-table">
                    <colgroup>
                        <col class="menu-hist-col-exp">
                        <col class="menu-hist-col-imp">
                        <col class="menu-hist-col-dir">
                        <col class="menu-hist-col-file">
                    </colgroup>
                    <thead><tr>
                        <th>Export</th>
                        <th>Import</th>
                        <th>Direction</th>
                        <th class="menu-hist-file-h">File Name</th>
                    </tr></thead>
                    <tbody>${tbody}</tbody>
                </table>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn" onclick="TVC_App.closeMenuHistoryModal()">Close</button>
            </div>`;
    }

    function renderMenuFlowItem(it, f, opts = {}) {
        if (it.feature && !f[it.feature]) return '';
        if (it.textOnly) {
            return `<p class="spare-flow-note">${esc(it.label)}</p>`;
        }
                    const badge = (it.badge != null && it.badge > 0)
                        ? `<span class="mi-badge mi-${it.badgeTone || 'blue'}">${it.badge}</span>` : '';
        const label = `<span class="mi-label">${esc(it.label)}</span>`;
        if (opts.locked) {
            const tip = esc(opts.disabledTitle || 'Original Plan Update is not available.');
            return `<button type="button" class="spare-flow-item" disabled title="${tip}">${label}<span class="mi-lock">🔒</span></button>`;
        }
        return `<button type="button" class="spare-flow-item${it.primary ? ' primary' : ''}" onclick="${it.action}">${label}${badge}</button>`;
    }

    function renderSectionCard(title, bodyHtml, opts = {}) {
        const sub = opts.sub ? `<p class="tvc-section-sub muted">${esc(opts.sub)}</p>` : '';
        const extra = opts.className ? ` ${opts.className}` : '';
        return `<section class="tvc-section-card${extra}">
            <header class="tvc-section-head">
                <h2 class="tvc-section-title">${esc(title)}</h2>${sub}
            </header>
            <div class="tvc-section-body">${bodyHtml}</div>
        </section>`;
    }

    function renderMenuFlowPanel(cols, f) {
        const planLocked = !canUpdateWorkPlanFromRh();
        const lockTip = planLocked ? getPlanMenuLockMessage() : '';
        const colHtml = cols.map(col => {
            const items = col.items
                .map(it => {
                    if (it.planLock) {
                        return renderMenuFlowItem(it, f, { locked: planLocked, disabledTitle: lockTip });
                    }
                    return renderMenuFlowItem(it, f, {});
                })
                .filter(Boolean)
                .join('');
            const empty = items || '<p class="menu-flow-empty muted">No permitted action</p>';
            return `<section class="spare-flow-col tone-${col.tone}">
                <header class="spare-flow-head">${esc(col.title)}</header>
                <div class="spare-flow-items">${empty}</div>
            </section>`;
            }).join('');
        return `<nav class="spare-flow-panel menu-flow-panel" aria-label="Maintenance workflow">${colHtml}</nav>`;
    }

    function renderAdministrationSidebar(adminCols, f) {
        if (!adminCols.length) return '';
        return adminCols.map(col => {
            const items = col.items
                .map(it => renderMenuFlowItem(it, f, {}))
                .filter(Boolean)
                .join('');
            return `<aside class="fleet-list-panel hq-administration-panel">
                <div class="fleet-list-head">${esc(col.title)}</div>
                <div class="hq-administration-body">${items}</div>
            </aside>`;
        }).join('');
    }

    function renderMenuCards(mainHost, adminHost) {
        if (!mainHost) return;
        const f = state.user ? TVC_Space.getUiFeatures(state.user) : {};
        const isSuperHq = TVC_RBAC.isSuperHqAccount?.(state.user);
        const cols = menuModel();
        const opsCols = isSuperHq
            ? cols.filter(s => s.key !== 'administration')
            : cols;
        const adminCols = isSuperHq
            ? cols.filter(s => s.key === 'administration')
            : [];
        const spareFlow = f.showSpareTab && typeof TVC_SpareMenu !== 'undefined' && TVC_SpareMenu.renderSpareWorkFlowCard
            ? TVC_SpareMenu.renderSpareWorkFlowCard()
            : '';
        mainHost.innerHTML = renderSectionCard('PMS Work Flow', renderMenuFlowPanel(opsCols, f), {
            className: 'tvc-section-pms-flow',
        }) + spareFlow;
        if (adminHost) {
            const adminHtml = renderAdministrationSidebar(adminCols, f);
            adminHost.innerHTML = adminHtml;
            adminHost.classList.toggle('hidden', !adminHtml);
        }
    }

    const ADMIN_COMPANY_FILTER_ALL = '__ALL__';

    function adminCompanyFilterValue() {
        if (state.adminCompanyFilter != null && state.adminCompanyFilter !== '') {
            return state.adminCompanyFilter;
        }
        if (state.selectedAdminCompanyId) return state.selectedAdminCompanyId;
        return '';
    }

    function adminCompanySelectOptions(selectedFilter) {
        const companies = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.listCompanies({ includeInactive: true })
            : [];
        const sel = selectedFilter != null ? selectedFilter : adminCompanyFilterValue();
        let html = `<option value=""${sel === '' ? ' selected' : ''}>No Select</option>`;
        html += `<option value="${ADMIN_COMPANY_FILTER_ALL}"${sel === ADMIN_COMPANY_FILTER_ALL ? ' selected' : ''}>All</option>`;
        html += companies.map(c => {
            const off = c.status === 'inactive' ? ' (inactive)' : '';
            const lab = (typeof TVC_AdminRegistry !== 'undefined' && TVC_AdminRegistry.isTvcLabCompany(c.company_id))
                ? ' — Lab' : '';
            return `<option value="${escAttr(c.company_id)}"${c.company_id === sel ? ' selected' : ''}>${esc(c.company_id)}${esc(lab)}${esc(off)}</option>`;
        }).join('');
        return html;
    }

    function adminCompanyFilterForList() {
        const f = adminCompanyFilterValue();
        if (f === '') return null;
        if (f === ADMIN_COMPANY_FILTER_ALL) return '';
        return f;
    }

    function renderAdminHomePanel() {
        const filter = adminCompanyFilterValue();
        const company = state.selectedAdminCompanyId
            && typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.getCompany(state.selectedAdminCompanyId)
            : null;
        const vessel = company && state.selectedAdminVesselId
            ? TVC_AdminRegistry.getVessel(state.selectedAdminCompanyId, state.selectedAdminVesselId)
            : null;
        const filterNote = filter === ''
            ? 'No company filter — select All or a Company ID in the left list.'
            : filter === ADMIN_COMPANY_FILTER_ALL
                ? 'Showing all companies — select a vessel in the list.'
                : '';
        const isLab = company && typeof TVC_AdminRegistry !== 'undefined'
            && TVC_AdminRegistry.isTvcLabCompany(company.company_id);
        const labBanner = isLab
            ? '<p class="admin-lab-banner"><strong>TVC Lab</strong> — internal QA only · App Update ZIP test here before customer deploy.</p>'
            : '';
        const st = typeof TVC_AdminRegistry !== 'undefined' ? TVC_AdminRegistry.stats() : { companies: 0, vessels: 0 };
        const hqVer = company && typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.formatCompanyAppVersion(company.deploy) : '—';
        const vesselVer = vessel && typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.formatVesselAppVersions(vessel.deploy) : '—';
        const setupVer = vessel && typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.formatVesselSetupVersion(vessel.deploy)
            : (company?.deploy?.setup_version || '—');
        const webPortal = isWebPortal();
        const deployWorkflow = webPortal ? '' : `
            <p class="spare-sync-note muted">Workflow: <button type="button" class="btn-linkish" onclick="TVC_App.openAdminSopModal()">Contract SOP checklist</button>
                · <button type="button" class="btn-linkish" onclick="TVC_App.openAdminDeliverModal()">Deliver files</button>
                · <button type="button" class="btn-linkish" onclick="TVC_App.openAdminRegistryHub()">Registry</button></p>
            <div class="admin-deploy-workflow">
                <div class="admin-deploy-path">
                    <strong>범용 App Update</strong>
                    <p class="spare-sync-note muted">기존 pool · 프로그램만 교체 (MR/License 불필요)</p>
                    <button type="button" class="btn btn-green btn-sm" onclick="TVC_App.openAdminAppUpdateModal()">Export pool App Update…</button>
                </div>
                <div class="admin-deploy-path">
                    <strong>범용 Setup · 선사용 App Update</strong>
                    <p class="spare-sync-note muted">신규 선사·선박 → Setup · 선박 추가 → Company App Update + HQ license</p>
                    <div class="admin-deploy-path-actions">
                        <button type="button" class="btn btn-sm" onclick="TVC_App.openAdminRegistryHub()">Company &amp; Vessel Registry</button>
                        <button type="button" class="btn btn-green btn-sm" onclick="TVC_App.openAdminDeliverModal()">Deliver files…</button>
                    </div>
                </div>
            </div>`;
        return renderSectionCard('Selected contract', `
            ${labBanner}
            <p class="spare-sync-note muted">Registry: ${st.companies} companies · ${st.vessels} vessels (scales to 100+). Search/select in the left list.</p>
            ${filterNote ? `<p class="spare-sync-note muted">${esc(filterNote)}</p>` : ''}
            <table class="menu-xfer-profile-table" style="width:100%;margin:8px 0;border-collapse:collapse">
                <tbody>
                    <tr><th style="text-align:left;padding:4px 8px">Company</th>
                        <td style="padding:4px 8px">${esc(company ? `${company.name} (${company.company_id})` : '—')}</td></tr>
                    <tr><th style="text-align:left;padding:4px 8px">HQ app version</th>
                        <td style="padding:4px 8px">${esc(hqVer)}</td></tr>
                    <tr><th style="text-align:left;padding:4px 8px">Vessel</th>
                        <td style="padding:4px 8px">${esc(vessel ? vessel.vessel_id : '—')}</td></tr>
                    <tr><th style="text-align:left;padding:4px 8px">IMO</th>
                        <td style="padding:4px 8px">${esc(vessel?.imo_no || '—')}</td></tr>
                    <tr><th style="text-align:left;padding:4px 8px">Delivery</th>
                        <td style="padding:4px 8px">${esc(vessel?.delivery || '—')}</td></tr>
                    <tr><th style="text-align:left;padding:4px 8px">Setup sent</th>
                        <td style="padding:4px 8px">${esc(setupVer)}${vessel?.deploy?.setup_sent_at ? ` · ${esc(vessel.deploy.setup_sent_at)}` : ''}</td></tr>
                    <tr><th style="text-align:left;padding:4px 8px">Version</th>
                        <td style="padding:4px 8px">${esc(vesselVer)}</td></tr>
                </tbody>
            </table>
            ${deployWorkflow}
        `, { className: 'tvc-section-admin-selected' });
    }

    function syncAdminFleetColgroup() {
        const panel = document.getElementById('fleetListPanel');
        if (!panel || panel.dataset.adminLayout !== '1') return;
        const colgroup = panel.querySelector('.fleet-table colgroup');
        const table = panel.querySelector('.fleet-table');
        if (!colgroup || !table) return;
        colgroup.innerHTML = `<col class="fleet-col-no"><col class="fleet-col-company"><col class="fleet-col-name"><col class="fleet-col-imo"><col class="fleet-col-delivery"><col class="fleet-col-appver"><col class="fleet-col-docs">`;
        table.classList.add('fleet-table--with-company');
    }

    const ADMIN_FLEET_TABLE_HEAD = '<th>No</th><th>Company ID</th><th>Vessel ID</th><th>IMO No</th><th>Delivery</th><th class="fleet-cell-ver">Version</th><th class="fleet-cell-docs">Docs</th>';
    const ADMIN_FLEET_COLSPAN = 7;

    function vesselDocsRecordId(companyId, vesselId) {
        const vid = String(vesselId || '').trim();
        const cid = String(companyId || '').trim();
        return cid ? `${cid}::${vid}` : vid;
    }

    function fleetDocsCellHtml(vesselId, companyId) {
        return `<td class="fleet-cell-docs" onclick="event.stopPropagation()">
            <button type="button" class="fleet-docs-link" title="Documents" aria-label="Documents" onclick="event.stopPropagation();TVC_App.openVesselDocsModal('${escAttr(vesselId)}','${escAttr(companyId || '')}')">
                <svg class="fleet-docs-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                    <path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 2.5L17.5 8H14zM8 12h8v1.5H8zm0 3h8v1.5H8zm0-6h4v1.5H8z"/>
                </svg>
            </button>
        </td>`;
    }

    function ensureAdminFleetPanelLayout() {
        const panel = document.getElementById('fleetListPanel');
        if (!panel || panel.dataset.adminLayout === '1') return;
        panel.dataset.adminLayout = '1';
        panel.innerHTML = `
            <div class="fleet-search-bar">
                <div class="search-field-wrap">
                    <input class="search-input" id="fleetSearch" placeholder="Search ship name / IMO No…">
                    <button type="button" class="search-clear-btn hidden" title="Clear search" aria-label="Clear search" onclick="TVC_App.clearSearchField('fleetSearch')">×</button>
                </div>
            </div>
            <div class="admin-company-field">
                <span class="admin-company-label">Company</span>
                <select class="admin-company-select" id="adminCompanySelect"></select>
            </div>
            <div class="fleet-list-head">🚢 Ship List</div>
            <div class="fleet-table-wrap">
                <table class="fleet-table fleet-table--with-company">
                    <colgroup>
                        <col class="fleet-col-no">
                        <col class="fleet-col-company">
                        <col class="fleet-col-name">
                        <col class="fleet-col-imo">
                        <col class="fleet-col-delivery">
                        <col class="fleet-col-appver">
                        <col class="fleet-col-docs">
                    </colgroup>
                    <thead><tr>${ADMIN_FLEET_TABLE_HEAD}</tr></thead>
                    <tbody id="fleetTableBody"></tbody>
                </table>
            </div>`;
    }

    function restoreHqFleetPanelLayout() {
        const panel = document.getElementById('fleetListPanel');
        if (!panel || panel.dataset.adminLayout !== '1') return;
        delete panel.dataset.adminLayout;
        panel.innerHTML = `
            <div class="fleet-list-head">🚢 Ship List</div>
            <div class="fleet-list-toolbar">
                <button class="fleet-view-btn active" data-fview="all" onclick="TVC_App.setFleetView('all')">View: All</button>
                <button class="fleet-view-btn" data-fview="selected" onclick="TVC_App.setFleetView('selected')">Selected</button>
            </div>
            <div class="fleet-search-bar">
                <div class="search-field-wrap">
                    <input class="search-input" id="fleetSearch" placeholder="Search ship name / IMO No…" oninput="TVC_App.setFleetSearch(this.value)">
                    <button type="button" class="search-clear-btn hidden" title="Clear search" aria-label="Clear search" onclick="TVC_App.clearSearchField('fleetSearch')">×</button>
                </div>
            </div>
            <div class="fleet-table-wrap">
                <table class="fleet-table">
                    <colgroup>
                        <col class="fleet-col-no">
                        <col class="fleet-col-name">
                        <col class="fleet-col-imo">
                        <col class="fleet-col-delivery">
                    </colgroup>
                    <thead><tr>
                        <th>No</th><th>Ship's Name</th><th>IMO No</th><th>Delivery</th>
                    </tr></thead>
                    <tbody id="fleetTableBody"></tbody>
                </table>
            </div>`;
    }

    function renderAdminContractList() {
        const hqCol = document.getElementById('hqLeftCol');
        const body = document.getElementById('fleetTableBody');
        if (!body || !hqCol) return;
        hqCol.classList.remove('hidden');
        document.getElementById('cmaxsMenuBody')?.classList.add('hq-mode');
        ensureAdminFleetPanelLayout();

        const search = document.getElementById('fleetSearch');
        if (search) {
            search.placeholder = 'Search vessel ID / IMO No…';
            search.oninput = () => TVC_App.setAdminSearch(search.value);
            if (search.value !== (state.adminSearch || '')) search.value = state.adminSearch || '';
        }

        const companySelect = document.getElementById('adminCompanySelect');
        if (companySelect) {
            companySelect.innerHTML = adminCompanySelectOptions(adminCompanyFilterValue());
            companySelect.onchange = () => TVC_App.selectAdminCompany(companySelect.value);
        }

        const listCompanyId = adminCompanyFilterForList();
        syncAdminFleetColgroup();
        const theadRow = document.querySelector('#fleetListPanel .fleet-table thead tr');
        if (theadRow) theadRow.innerHTML = ADMIN_FLEET_TABLE_HEAD;
        if (listCompanyId === null) {
            body.innerHTML = `<tr><td colspan="${ADMIN_FLEET_COLSPAN}" class="muted" style="text-align:center">Select All or a Company ID</td></tr>`;
            refreshSearchClearUi(document.getElementById('fleetListPanel') || document);
            return;
        }

        let rows = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.listVessels({
                search: state.adminSearch || '',
                companyId: listCompanyId,
                includeInactive: true,
            })
            : [];
        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="${ADMIN_FLEET_COLSPAN}" class="muted" style="text-align:center">No vessels found</td></tr>`;
            refreshSearchClearUi(document.getElementById('fleetListPanel') || document);
            return;
        }
        const listAllCompanies = listCompanyId === ADMIN_COMPANY_FILTER_ALL;
        rows = sortFleetListRows(rows, { companyFilterAll: listAllCompanies });
        body.innerHTML = rows.map((v, i) => {
            const sel = v.vessel_id === state.selectedAdminVesselId
                && v.company_id === state.selectedAdminCompanyId ? ' selected' : '';
            const inactive = v.status === 'inactive' ? ' <span class="muted">(inactive)</span>' : '';
            const appVer = typeof TVC_AdminRegistry !== 'undefined'
                ? TVC_AdminRegistry.formatVesselAppVersions(v.deploy)
                : '—';
            return `<tr class="fleet-row${sel}" onclick="TVC_App.selectAdminVessel('${escAttr(v.company_id)}','${escAttr(v.vessel_id)}')">
                <td>${i + 1}</td>
                <td>${esc(v.company_id || '—')}</td>
                <td><strong>${esc(v.vessel_id)}</strong>${inactive}</td>
                <td>${esc(v.imo_no || '—')}</td>
                <td>${esc(v.delivery || '—')}</td>
                <td class="fleet-cell-ver">${esc(appVer)}</td>
                ${fleetDocsCellHtml(v.vessel_id, v.company_id)}
            </tr>`;
        }).join('');
        refreshSearchClearUi(document.getElementById('fleetListPanel') || document);
    }

    function setAdminSearch(q) {
        state.adminSearch = String(q || '');
        renderAdminContractList();
    }

    function selectAdminCompany(filterValue) {
        const v = String(filterValue ?? '');
        state.adminCompanyFilter = v;
        if (v === '') {
            state.selectedAdminCompanyId = null;
            state.selectedAdminVesselId = null;
        } else if (v === ADMIN_COMPANY_FILTER_ALL) {
            state.selectedAdminCompanyId = null;
            state.selectedAdminVesselId = null;
        } else {
            state.selectedAdminCompanyId = v;
            const vessels = typeof TVC_AdminRegistry !== 'undefined'
                ? TVC_AdminRegistry.listVessels({ companyId: v, includeInactive: true })
                : [];
            state.selectedAdminVesselId = vessels[0]?.vessel_id || null;
        }
        if (typeof TVC_AdminRegistry !== 'undefined') {
            TVC_AdminRegistry.setSelected(state.selectedAdminCompanyId, state.selectedAdminVesselId);
        }
        renderMainMenu();
    }

    function selectAdminVessel(companyId, vesselId) {
        state.selectedAdminCompanyId = String(companyId || '').trim() || null;
        state.selectedAdminVesselId = String(vesselId || '').trim() || null;
        if (typeof TVC_AdminRegistry !== 'undefined') {
            TVC_AdminRegistry.setSelected(state.selectedAdminCompanyId, state.selectedAdminVesselId);
        }
        renderMainMenu();
    }

    function closeAdminRegistryModal() {
        closeModal('adminRegistryModal');
        state._adminRegForm = null;
        state._adminRegView = 'hub';
    }

    function adminRegistryLoginFields(login, isEdit, { suggest = '' } = {}) {
        const username = login?.username || '';
        const pwdPlaceholder = isEdit && login?.password_plain
            ? 'Enter new password to change'
            : (isEdit && login ? 'Enter new password to change' : 'Min 4 characters');
        return `
            <label>ID
                <input name="login_username" type="text"${isEdit ? ' readonly class="wr-ro"' : ''}
                    placeholder="Web login ID"
                    value="${escAttr(isEdit ? username : suggest)}"></label>
            <label>Password
                <input name="login_password" type="text" autocomplete="new-password"
                    placeholder="${pwdPlaceholder}"
                    value="${escAttr(isEdit ? (login?.password_plain || '') : '')}"></label>`;
    }

    async function recordAdminDeployAndSave(deployOptsOrList, { silent = true } = {}) {
        if (typeof TVC_AdminRegistry === 'undefined') return;
        const list = Array.isArray(deployOptsOrList) ? deployOptsOrList : [deployOptsOrList];
        const valid = list.filter(d => d && d.companyId);
        if (!valid.length) return;
        try {
            for (const d of valid) TVC_AdminRegistry.recordDeploy(d);
            await TVC_AdminRegistry.save();
            if (typeof TVC_Fleet.syncFromAdminRegistry === 'function') {
                TVC_Fleet.syncFromAdminRegistry();
            }
            renderMainMenu();
        } catch (e) {
            if (!silent) await TVC_Dialog.alert(e.message || String(e));
        }
    }

    function adminPoolCompanies({ includeLab = false } = {}) {
        if (typeof TVC_AdminRegistry === 'undefined') return [];
        return TVC_AdminRegistry.listCompanies({ includeInactive: false })
            .filter(c => includeLab || !TVC_AdminRegistry.isTvcLabCompany(c.company_id));
    }

    function buildPoolAppUpdateDeployRecords(appVersion, skus, { includeLab = false } = {}) {
        const ver = String(appVersion || '').trim();
        const skuList = Array.isArray(skus) ? skus : [];
        if (!ver || !skuList.length) return [];
        const records = [];
        for (const co of adminPoolCompanies({ includeLab })) {
            for (const sku of skuList) {
                records.push({ companyId: co.company_id, kind: 'update', sku, appVersion: ver });
            }
        }
        return records;
    }

    function buildCompanyAppUpdateDeployRecords(companyId, appVersion, skus) {
        const cid = String(companyId || '').trim();
        const ver = String(appVersion || '').trim();
        const skuList = Array.isArray(skus) ? skus : [];
        if (!cid || !ver || !skuList.length) return [];
        return skuList.map(sku => ({ companyId: cid, kind: 'update', sku, appVersion: ver }));
    }

    function adminRegistryActiveVesselRows(companyId) {
        if (!companyId || typeof TVC_AdminRegistry === 'undefined') return [];
        return TVC_AdminRegistry.listVessels({ companyId, includeInactive: false });
    }

    function adminRegistryManifestVessels(companyId) {
        return adminRegistryActiveVesselRows(companyId).map(v => ({
            vessel_id: v.vessel_id,
            name: v.vessel_id,
            code: v.code,
            imo_no: v.imo_no,
            delivery: v.delivery,
        }));
    }

    function renderAdminRegistryHub() {
        const host = document.getElementById('adminRegistryBody');
        if (!host || typeof TVC_AdminRegistry === 'undefined') return;
        state._adminRegView = 'hub';
        const companies = TVC_AdminRegistry.listCompanies({ includeInactive: true });
        if (!state.selectedAdminCompanyId && companies[0]) {
            state.selectedAdminCompanyId = companies[0].company_id;
        }
        const companyId = state.selectedAdminCompanyId;
        const vessels = companyId
            ? TVC_AdminRegistry.listVessels({ companyId, includeInactive: true })
            : [];
        if (companyId && vessels.length && !state.selectedAdminVesselId) {
            state.selectedAdminVesselId = vessels[0].vessel_id;
        }
        const vesselId = state.selectedAdminVesselId;
        const company = companyId ? TVC_AdminRegistry.getCompany(companyId) : null;
        const vessel = companyId && vesselId ? TVC_AdminRegistry.getVessel(companyId, vesselId) : null;
        const companyOpts = companies.map(c =>
            `<option value="${escAttr(c.company_id)}"${c.company_id === companyId ? ' selected' : ''}>${esc(c.name)} (${esc(c.company_id)})${c.status === 'inactive' ? ' [inactive]' : ''}</option>`
        ).join('') || '<option value="">—</option>';
        const vesselOpts = vessels.map(v =>
            `<option value="${escAttr(v.vessel_id)}"${v.vessel_id === vesselId ? ' selected' : ''}>${esc(v.vessel_id)}${v.status === 'inactive' ? ' [inactive]' : ''}</option>`
        ).join('') || '<option value="">—</option>';
        host.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminRegistryModal()" aria-label="Close">×</button>
            <h3 class="spare-sync-title">Company &amp; Vessel Registry</h3>
            <p class="spare-sync-hint muted">Select · Add · Modify · Delete = <strong>Set inactive</strong> (registry files 유지)</p>
            <label class="spare-sync-note admin-registry-field">Company
                <div class="admin-registry-row">
                    <select class="admin-company-select admin-registry-select"
                        onchange="TVC_App.adminRegistryHubSelectCompany(this.value)">${companyOpts}</select>
                    <div class="admin-registry-row-actions">
                        <button type="button" class="btn btn-sm" onclick="TVC_App.openAdminCompanyFormFromHub('edit')" ${company ? '' : ' disabled'}>Modify</button>
                        <button type="button" class="btn btn-sm" onclick="TVC_App.openAdminCompanyFormFromHub('add')">Add</button>
                    </div>
                </div>
            </label>
            <label class="spare-sync-note admin-registry-field">Vessel
                <div class="admin-registry-row">
                    <select class="admin-company-select admin-registry-select"
                        onchange="TVC_App.adminRegistryHubSelectVessel(this.value)">${vesselOpts}</select>
                    <div class="admin-registry-row-actions">
                        <button type="button" class="btn btn-sm" onclick="TVC_App.openAdminVesselFormFromHub('edit')" ${vessel ? '' : ' disabled'}>Modify</button>
                        <button type="button" class="btn btn-sm" onclick="TVC_App.openAdminVesselFormFromHub('add')" ${company ? '' : ' disabled'}>Add</button>
                    </div>
                </div>
            </label>
            ${company ? `<p class="spare-sync-note muted">Status: company <strong>${esc(company.status)}</strong>${vessel ? ` · vessel <strong>${esc(vessel.status)}</strong>` : ''}</p>` : ''}
            <div class="modal-actions admin-registry-form-actions">
                <button type="button" class="btn" onclick="TVC_App.closeAdminRegistryModal()">Close</button>
            </div>`;
    }

    async function openAdminRegistryHub() {
        if (!state.user || !TVC_RBAC.isAdminAccount?.(state.user)) return;
        if (typeof TVC_AdminRegistry === 'undefined') {
            await TVC_Dialog.alert('Admin registry module not loaded.');
            return;
        }
        state._adminRegFromHub = false;
        state._adminRegView = 'hub';
        renderAdminRegistryHub();
        showModal('adminRegistryModal');
    }

    function adminRegistryHubSelectCompany(companyId) {
        state.selectedAdminCompanyId = String(companyId || '').trim() || null;
        state.selectedAdminVesselId = null;
        if (typeof TVC_AdminRegistry !== 'undefined') {
            TVC_AdminRegistry.setSelected(state.selectedAdminCompanyId, null);
        }
        renderAdminRegistryHub();
        renderMainMenu();
    }

    function adminRegistryHubSelectVessel(vesselId) {
        state.selectedAdminVesselId = String(vesselId || '').trim() || null;
        if (typeof TVC_AdminRegistry !== 'undefined') {
            TVC_AdminRegistry.setSelected(state.selectedAdminCompanyId, state.selectedAdminVesselId);
        }
        renderAdminRegistryHub();
        renderMainMenu();
    }

    function adminRegistryCancelForm() {
        if (state._adminRegFromHub) {
            state._adminRegFromHub = false;
            state._adminRegForm = null;
            renderAdminRegistryHub();
            return;
        }
        closeAdminRegistryModal();
    }

    function openAdminCompanyFormFromHub(mode) {
        state._adminRegFromHub = true;
        openAdminCompanyForm(mode);
    }

    function openAdminVesselFormFromHub(mode) {
        state._adminRegFromHub = true;
        openAdminVesselForm(mode);
    }

    function renderAdminDeliverModal() {
        const body = document.getElementById('adminDeliverBody');
        if (!body) return;
        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminDeliverModal()">×</button>
            <h3 class="spare-sync-title">Deliver files &amp; license</h3>
            <p class="spare-sync-hint muted">Registry 등록 후 전달 파일 3종 · 신규 PC는 3–5단계(MR → License → Import) 필요</p>
            <div class="admin-deploy-workflow" style="margin:12px 0">
                <div class="admin-deploy-path">
                    <strong>① 범용 Setup</strong>
                    <p class="spare-sync-note muted">신규 선사·선박 · Registry 확인 후 HQ + Vessel Setup.exe ZIP</p>
                    <button type="button" class="btn btn-green btn-sm" onclick="TVC_App.adminDeliverOpenSetup()">Export Setup handoff…</button>
                </div>
                <div class="admin-deploy-path">
                    <strong>② 범용 App Update</strong>
                    <p class="spare-sync-note muted">기존 pool · 프로그램만 교체 · MR/License 불필요</p>
                    <button type="button" class="btn btn-green btn-sm" onclick="TVC_App.adminDeliverOpenPoolUpdate()">Export pool App Update…</button>
                </div>
                <div class="admin-deploy-path">
                    <strong>③ 선사용 App Update</strong>
                    <p class="spare-sync-note muted">선박 추가 등 · manifest에 <strong>allowedVesselIds</strong> 반영 → HQ license 재발급</p>
                    <button type="button" class="btn btn-green btn-sm" onclick="TVC_App.adminDeliverOpenCompanyUpdate()">Export company App Update…</button>
                </div>
            </div>
            <h4 class="admin-sop-h" style="margin-top:16px">Steps 3–5 (신규 PC · 선박 추가)</h4>
            <ol class="admin-sop-ol">
                <li>고객 PC → Machine Request JSON</li>
                <li>Admin → <strong>Issue seat license</strong> (HQ=Company · Vessel=Company+Vessel)</li>
                <li>고객 PC → Import seat license · (선사용 App Update 후 HQ license 필수)</li>
            </ol>
            <div class="modal-actions spare-sync-footer">
                <button type="button" class="btn btn-green" onclick="TVC_App.adminDeliverOpenSeatLicense()">Issue seat license…</button>
                <button type="button" class="btn" onclick="TVC_App.closeAdminDeliverModal()">Close</button>
            </div>`;
    }

    function openAdminDeliverModal() {
        if (!state.user || !TVC_RBAC.isAdminAccount?.(state.user)) return;
        renderAdminDeliverModal();
        showModal('adminDeliverModal');
    }

    function closeAdminDeliverModal() {
        closeModal('adminDeliverModal');
    }

    function adminDeliverOpenSetup() {
        closeAdminDeliverModal();
        openAdminSetupExportModal();
    }

    function adminDeliverOpenPoolUpdate() {
        closeAdminDeliverModal();
        openAdminAppUpdateModal({ scope: 'pool' });
    }

    function adminDeliverOpenCompanyUpdate() {
        closeAdminDeliverModal();
        openAdminCompanyAppUpdateModal();
    }

    function adminDeliverOpenSeatLicense() {
        closeAdminDeliverModal();
        openAdminSeatLicenseModal();
    }

    function adminSetupExportVesselPreviewHtml(companyId) {
        if (!companyId || typeof TVC_AdminRegistry === 'undefined') {
            return '<p class="spare-sync-note muted">Select a company to preview registered vessels.</p>';
        }
        const vessels = TVC_AdminRegistry.listVessels({ companyId, includeInactive: false });
        if (!vessels.length) {
            return `<p class="spare-sync-note" style="color:#c53030">No active vessels in registry for this company.
                <button type="button" class="btn-linkish" onclick="TVC_App.openAdminRegistryHub()">Company &amp; Vessel Registry</button> first.</p>`;
        }
        const rows = vessels.map(v => `<tr>
            <td style="padding:4px 8px">${esc(v.vessel_id || '—')}</td>
            <td style="padding:4px 8px">${esc(v.vessel_id || '—')}</td>
            <td style="padding:4px 8px">${esc(v.imo_no || '—')}</td>
            <td style="padding:4px 8px" class="muted">${esc(typeof TVC_AdminRegistry.formatVesselSetupVersion === 'function'
                ? TVC_AdminRegistry.formatVesselSetupVersion(v.deploy) : '—')}</td>
        </tr>`).join('');
        return `
            <p class="spare-sync-note muted">Registry vessels included in Setup handoff manifest (${vessels.length}):</p>
            <table style="width:100%;margin:8px 0;border-collapse:collapse;font-size:12px">
                <thead><tr>
                    <th style="text-align:left;padding:4px 8px">Vessel ID</th>
                    <th style="text-align:left;padding:4px 8px">Name</th>
                    <th style="text-align:left;padding:4px 8px">IMO</th>
                    <th style="text-align:left;padding:4px 8px">Setup sent</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    async function adminPrintContractDraft() {
        if (!state.user || !TVC_RBAC.isAdminAccount?.(state.user)) return;
        if (typeof TVC_AdminPrint === 'undefined') {
            await TVC_Dialog.alert('Admin print module not loaded.');
            return;
        }
        const companyId = state.selectedAdminCompanyId;
        if (!companyId) {
            await TVC_Dialog.alert('Select a company in the left list first.');
            return;
        }
        try {
            await TVC_AdminPrint.printContractDraft(companyId, { print: false });
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    const _adminPrintRegistry = { companyId: '', includeInactive: false };

    function renderAdminPrintRegistryModal() {
        const body = document.getElementById('adminPrintRegistryBody');
        if (!body) return;
        if (!_adminPrintRegistry.companyId && state.selectedAdminCompanyId) {
            _adminPrintRegistry.companyId = state.selectedAdminCompanyId;
        }
        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminPrintRegistryModal()">×</button>
            <h3 class="spare-sync-title">Print Contract Registry</h3>
            <p class="spare-sync-hint">계약 선사·선박 목록 + Setup / App 버전</p>
            <label class="spare-sync-note" style="display:block;margin:12px 0">Company
                <select class="admin-company-select" style="margin-top:4px"
                    onchange="TVC_App.adminPrintRegistrySetCompany(this.value)">
                    <option value=""${!_adminPrintRegistry.companyId ? ' selected' : ''}>— All companies —</option>
                    ${adminSeatLicenseCompanyOptions(_adminPrintRegistry.companyId)}
                </select>
            </label>
            <label class="spare-sync-note"><input type="checkbox"${_adminPrintRegistry.includeInactive ? ' checked' : ''}
                onchange="TVC_App.adminPrintRegistrySetIncludeInactive(this.checked)"> Include inactive</label>
            <div class="modal-actions spare-sync-footer">
                <button type="button" class="btn btn-green" onclick="TVC_App.adminPrintRegistryRun()">Print preview…</button>
                <button type="button" class="btn" onclick="TVC_App.closeAdminPrintRegistryModal()">Close</button>
            </div>`;
    }

    function openAdminPrintRegistryModal() {
        if (!state.user || !TVC_RBAC.isAdminAccount?.(state.user)) return;
        _adminPrintRegistry.companyId = state.selectedAdminCompanyId || '';
        _adminPrintRegistry.includeInactive = false;
        renderAdminPrintRegistryModal();
        showModal('adminPrintRegistryModal');
    }

    function closeAdminPrintRegistryModal() {
        closeModal('adminPrintRegistryModal');
    }

    function adminPrintRegistrySetCompany(id) {
        _adminPrintRegistry.companyId = String(id || '').trim();
    }

    function adminPrintRegistrySetIncludeInactive(on) {
        _adminPrintRegistry.includeInactive = !!on;
    }

    async function adminPrintRegistryRun() {
        if (typeof TVC_AdminPrint === 'undefined') {
            await TVC_Dialog.alert('Admin print module not loaded.');
            return;
        }
        try {
            await TVC_AdminPrint.printRegistryList({
                companyId: _adminPrintRegistry.companyId || '',
                includeInactive: _adminPrintRegistry.includeInactive,
                print: false,
            });
            closeAdminPrintRegistryModal();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    const _adminSeatLicense = {
        request: null,
        months: 3,
        companyId: null,
        vesselId: null,
        signingConfigured: false,
        signingPath: null,
    };

    function seatLicenseIssueScope(req, companyId, vesselId) {
        const sku = req?.sku;
        if (!companyId) throw new Error('Select a company.');
        if (sku === 'HQ_OFFICE') {
            const vessels = typeof TVC_AdminRegistry !== 'undefined'
                ? TVC_AdminRegistry.listVessels({ companyId, includeInactive: false })
                : [];
            if (!vessels.length) throw new Error('No active vessels for this company in registry.');
            return {
                companyId,
                vesselId: null,
                allowedVesselIds: vessels.map(v => v.vessel_id),
            };
        }
        if (!vesselId) throw new Error('Select a vessel for vessel SKU licenses.');
        return {
            companyId,
            vesselId,
            allowedVesselIds: [vesselId],
        };
    }

    function adminSeatLicenseCompanyOptions(selectedId) {
        const companies = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.listCompanies({ includeInactive: true })
            : [];
        return companies.map(c =>
            `<option value="${escAttr(c.company_id)}"${c.company_id === selectedId ? ' selected' : ''}>${esc(c.name_en || c.name || c.company_id)}</option>`
        ).join('') || '<option value="">—</option>';
    }

    function adminSeatLicenseVesselOptions(companyId, selectedId) {
        const vessels = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.listVessels({ companyId, includeInactive: false })
            : [];
        return vessels.map(v =>
            `<option value="${escAttr(v.vessel_id)}"${v.vessel_id === selectedId ? ' selected' : ''}>${esc(v.vessel_id)}</option>`
        ).join('') || '<option value="">—</option>';
    }

    async function renderAdminSeatLicenseModal() {
        const body = document.getElementById('adminSeatLicenseBody');
        if (!body || typeof TVC_SeatLicense === 'undefined') return;
        let signing = { configured: false };
        try {
            signing = await TVC_SeatLicense.getSigningStatus();
        } catch (_) { /* ignore */ }
        _adminSeatLicense.signingConfigured = !!signing.configured;
        _adminSeatLicense.signingPath = signing.path || null;
        const req = _adminSeatLicense.request;
        if (!_adminSeatLicense.companyId && state.selectedAdminCompanyId) {
            _adminSeatLicense.companyId = state.selectedAdminCompanyId;
        }
        if (!_adminSeatLicense.vesselId && state.selectedAdminVesselId) {
            _adminSeatLicense.vesselId = state.selectedAdminVesselId;
        }
        const preview = req
            ? TVC_SeatLicense.previewRows(req).map(([k, v]) =>
                `<tr><th style="text-align:left;padding:4px 8px;white-space:nowrap">${esc(k)}</th><td style="padding:4px 8px;word-break:break-all">${esc(v)}</td></tr>`
            ).join('')
            : '';
        const signingNote = signing.configured
            ? `<span class="muted">Signing key: ${esc(signing.path || 'configured')}</span>`
            : `<span class="muted">Signing key not found. Dev: <code>npm run license:keys</code> · Packaged Admin: select <code>private.pem</code> once below.</span>`;
        const isVesselSku = req && req.sku && req.sku !== 'HQ_OFFICE' && req.sku !== 'ADMIN_TVC';
        const scopeFields = req ? `
            <label class="spare-sync-note" style="display:block;margin:12px 0">
                Company (license scope)
                <select id="adminSeatLicenseCompany" class="admin-company-select" style="margin-top:4px"
                    onchange="TVC_App.adminSeatLicenseSetCompany(this.value)">
                    ${adminSeatLicenseCompanyOptions(_adminSeatLicense.companyId)}
                </select>
            </label>
            ${isVesselSku ? `<label class="spare-sync-note" style="display:block;margin:12px 0">
                Vessel (license scope)
                <select id="adminSeatLicenseVessel" class="admin-company-select" style="margin-top:4px"
                    onchange="TVC_App.adminSeatLicenseSetVessel(this.value)">
                    ${adminSeatLicenseVesselOptions(_adminSeatLicense.companyId, _adminSeatLicense.vesselId)}
                </select>
            </label>` : `<p class="spare-sync-note muted">HQ license includes all active vessels registered for the selected company.</p>`}
        ` : '';
        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminSeatLicenseModal()">×</button>
            <h3 class="spare-sync-title">Issue Seat License</h3>
            <p class="spare-sync-hint">Universal Setup: select <strong>company / vessel</strong> here · crew sends <strong>machine request</strong> JSON.</p>
            <p class="spare-sync-note muted">Pilot term: 3 months · Established: 12 months.</p>
            <p class="spare-sync-note">${signingNote}</p>
            <div class="spare-sync-actions" style="margin:12px 0">
                <button type="button" class="btn spare-sync-btn" onclick="TVC_App.adminSeatLicensePickKey()">Select signing key (private.pem)…</button>
            </div>
            <label class="spare-sync-note" style="display:block;margin:12px 0">
                <span>Machine request file</span>
                <input type="file" id="adminSeatLicenseFile" accept=".json,application/json"
                    onchange="TVC_App.adminSeatLicenseLoadFile(this.files[0])">
            </label>
            ${req ? `<table class="menu-xfer-profile-table" style="width:100%;margin:8px 0;border-collapse:collapse"><tbody>${preview}</tbody></table>` : '<p class="muted">No machine request loaded.</p>'}
            ${scopeFields}
            <label class="spare-sync-note" style="display:block;margin:12px 0">
                License term
                <select id="adminSeatLicenseMonths" onchange="TVC_App.adminSeatLicenseSetMonths(this.value)">
                    <option value="3"${_adminSeatLicense.months === 3 ? ' selected' : ''}>3 months (pilot / new company)</option>
                    <option value="12"${_adminSeatLicense.months === 12 ? ' selected' : ''}>12 months (renewal)</option>
                </select>
            </label>
            <div class="modal-actions spare-sync-footer">
                <button type="button" class="btn btn-green"
                    onclick="TVC_App.adminSeatLicenseIssueAndSave()"
                    ${req && signing.configured && _adminSeatLicense.companyId ? '' : ' disabled'}>Issue &amp; save license.json…</button>
                <button type="button" class="btn" onclick="TVC_App.closeAdminSeatLicenseModal()">Close</button>
            </div>`;
    }

    async function openAdminSeatLicenseModal() {
        if (!state.user || !TVC_RBAC.isAdminAccount?.(state.user)) return;
        if (typeof TVC_SeatLicense === 'undefined') {
            await TVC_Dialog.alert('Seat license module not loaded.');
            return;
        }
        _adminSeatLicense.request = null;
        _adminSeatLicense.months = 3;
        _adminSeatLicense.companyId = state.selectedAdminCompanyId || null;
        _adminSeatLicense.vesselId = state.selectedAdminVesselId || null;
        await renderAdminSeatLicenseModal();
        showModal('adminSeatLicenseModal');
    }

    function closeAdminSeatLicenseModal() {
        closeModal('adminSeatLicenseModal');
    }

    function adminSeatLicenseSetMonths(val) {
        _adminSeatLicense.months = Number(val) || 3;
    }

    function adminSeatLicenseSetCompany(companyId) {
        _adminSeatLicense.companyId = String(companyId || '').trim() || null;
        const vessels = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.listVessels({ companyId: _adminSeatLicense.companyId, includeInactive: false })
            : [];
        _adminSeatLicense.vesselId = vessels[0]?.vessel_id || null;
        renderAdminSeatLicenseModal();
    }

    function adminSeatLicenseSetVessel(vesselId) {
        _adminSeatLicense.vesselId = String(vesselId || '').trim() || null;
    }

    async function adminSeatLicensePickKey() {
        try {
            const result = await TVC_SeatLicense.pickSigningKey();
            if (result?.canceled) return;
            await renderAdminSeatLicenseModal();
            if (result?.ok) await TVC_Dialog.success('Signing key saved.');
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function adminSeatLicenseLoadFile(file) {
        if (!file) return;
        try {
            const text = await file.text();
            _adminSeatLicense.request = TVC_SeatLicense.parseMachineRequest(text);
            await renderAdminSeatLicenseModal();
        } catch (e) {
            _adminSeatLicense.request = null;
            await renderAdminSeatLicenseModal();
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function adminSeatLicenseIssueAndSave() {
        const req = _adminSeatLicense.request;
        if (!req) {
            await TVC_Dialog.alert('Load a machine request file first.');
            return;
        }
        try {
            const scope = seatLicenseIssueScope(req, _adminSeatLicense.companyId, _adminSeatLicense.vesselId);
            const issued = await TVC_SeatLicense.issueFromRequest(req, {
                months: _adminSeatLicense.months,
                ...scope,
            });
            const saved = await TVC_SeatLicense.saveLicense(issued.license, issued.suggestedFilename);
            if (saved.canceled) return;
            if (typeof TVC_AdminRegistry !== 'undefined') {
                await recordAdminDeployAndSave({
                    companyId: scope.companyId,
                    vesselId: scope.vesselId,
                    kind: 'license',
                    sku: issued.sku || req.sku,
                    appVersion: req.appVersion || null,
                });
            }
            await TVC_Dialog.alert(
                `Seat license saved.\n${saved.path || issued.suggestedFilename}\n\nSKU: ${issued.sku}\nExpires: ${String(issued.expiresAt || '').slice(0, 10)}\n\nSend this file to the crew → Import seat license on their PC.`
            );
            closeAdminSeatLicenseModal();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    const _adminSetupExport = {
        companyId: null,
        vesselId: null,
        skus: { VESSEL_MASTER: true, VESSEL_ENGINE: false, VESSEL_DECK: false },
        appVersion: '1.0.6',
        notes: '',
        sourceSetups: [],
        sourcePath: null,
        recordDeploy: true,
    };

    const ADMIN_VESSEL_SETUP_SKUS = ['VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK'];

    function adminSetupExportSelectedSkus() {
        const picked = _adminSetupExport.skus || {};
        return ADMIN_VESSEL_SETUP_SKUS.filter(sku => picked[sku]);
    }

    function ensureAdminSetupExportSkus() {
        if (!_adminSetupExport.skus || !Object.keys(_adminSetupExport.skus).length) {
            _adminSetupExport.skus = {
                VESSEL_MASTER: true,
                VESSEL_ENGINE: false,
                VESSEL_DECK: false,
            };
        }
    }

    async function renderAdminSetupExportModal() {
        const body = document.getElementById('adminSetupExportBody');
        if (!body || typeof TVC_SetupExport === 'undefined') return;
        let source = { configured: false, path: null, setups: [] };
        try {
            source = await TVC_SetupExport.getSourceStatus();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
        _adminSetupExport.sourcePath = source.path || null;
        _adminSetupExport.sourceSetups = source.setups || [];
        if (!_adminSetupExport.companyId && state.selectedAdminCompanyId) {
            _adminSetupExport.companyId = state.selectedAdminCompanyId;
        }
        if (!_adminSetupExport.vesselId && state.selectedAdminVesselId) {
            _adminSetupExport.vesselId = state.selectedAdminVesselId;
        }
        const vessels = _adminSetupExport.companyId && typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.listVessels({ companyId: _adminSetupExport.companyId, includeInactive: false })
            : [];
        if (!vessels.some(v => v.vessel_id === _adminSetupExport.vesselId)) {
            _adminSetupExport.vesselId = vessels[0]?.vessel_id || null;
        }
        ensureAdminSetupExportSkus();
        const selectedSkus = adminSetupExportSelectedSkus();
        const sourceNote = source.configured
            ? `<span class="muted">Setup folder: ${esc(source.path || '')}</span>`
            : `<span class="muted">Electron Admin required. Run <code>npm run dist</code>, then select the <code>dist</code> folder.</span>`;
        const hasAllFiles = selectedSkus.length > 0
            && selectedSkus.every(sku => _adminSetupExport.sourceSetups.some(s => s.sku === sku));
        const canExport = source.configured && _adminSetupExport.companyId && _adminSetupExport.vesselId && hasAllFiles;
        const skuChecks = ADMIN_VESSEL_SETUP_SKUS.map(sku => {
            const hit = _adminSetupExport.sourceSetups.find(s => s.sku === sku);
            const checked = _adminSetupExport.skus[sku] ? ' checked' : '';
            const missingNote = hit ? '' : ' title="Setup.exe not in dist folder yet"';
            return `<label class="admin-setup-sku-check${hit ? '' : ' muted'}"><input type="checkbox"${checked}${missingNote}
                onchange="TVC_App.adminSetupExportToggleSku('${escAttr(sku)}', this.checked)"> ${esc(sku)}</label>`;
        }).join('');
        const setupStatus = selectedSkus.length
            ? selectedSkus.map(sku => {
                const hit = _adminSetupExport.sourceSetups.find(s => s.sku === sku);
                if (!hit) return `${esc(sku)}: Setup.exe not found in dist folder.`;
                return `${esc(sku)}: <strong>${esc(hit.filename)}</strong> (${(hit.bytes / (1024 * 1024)).toFixed(1)} MB)`;
            }).join('<br>')
            : 'Select at least one SKU to export.';
        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminSetupExportModal()">×</button>
            <h3 class="spare-sync-title">Universal Setup.exe</h3>
            <p class="spare-sync-hint muted">Registry에 등록된 Company / Vessel / SKU에 맞는 범용 Setup.exe를 내보냅니다. 설치 후 <strong>Seat License</strong> Import로 활성화합니다.</p>
            <p class="spare-sync-note">${sourceNote}</p>
            <div class="spare-sync-actions" style="margin:8px 0">
                <button type="button" class="btn spare-sync-btn" onclick="TVC_App.adminSetupExportPickFolder()">Select dist folder…</button>
            </div>
            <label class="spare-sync-note" style="display:block;margin:12px 0">Select Company
                <select class="admin-company-select" style="margin-top:4px;width:100%"
                    onchange="TVC_App.adminSetupExportSetCompany(this.value);TVC_App.renderAdminSetupExportModal()">
                    ${adminSeatLicenseCompanyOptions(_adminSetupExport.companyId)}
                </select>
            </label>
            <label class="spare-sync-note" style="display:block;margin:12px 0">Select Vessel
                <select class="admin-company-select" style="margin-top:4px;width:100%"
                    onchange="TVC_App.adminSetupExportSetVessel(this.value)">
                    ${adminSeatLicenseVesselOptions(_adminSetupExport.companyId, _adminSetupExport.vesselId)}
                </select>
            </label>
            <label class="spare-sync-note" style="display:block;margin:12px 0">Select SKU
                <div class="admin-setup-sku-checks">${skuChecks}</div>
            </label>
            <p class="spare-sync-note muted" style="margin:8px 0">${setupStatus}</p>
            <label class="spare-sync-note" style="display:block;margin:8px 0">
                App version
                <input type="text" value="${escAttr(_adminSetupExport.appVersion)}" style="width:100%;margin-top:4px"
                    oninput="TVC_App.adminSetupExportSetVersion(this.value)">
            </label>
            <label class="spare-sync-note"><input type="checkbox"${_adminSetupExport.recordDeploy !== false ? ' checked' : ''}
                onchange="TVC_App.adminSetupExportSetRecordDeploy(this.checked)"> Update deploy version in registry after export</label>
            <div class="modal-actions spare-sync-footer">
                <button type="button" class="btn btn-green" onclick="TVC_App.adminSetupExportRun()"
                    ${canExport ? '' : ' disabled'}>Export Setup ZIP…</button>
                <button type="button" class="btn" onclick="TVC_App.closeAdminSetupExportModal()">Close</button>
            </div>`;
    }

    async function openAdminUniversalSetupModal() {
        await openAdminSetupExportModal();
    }

    async function openAdminSetupExportModal() {
        if (!state.user || !TVC_RBAC.isAdminAccount?.(state.user)) return;
        if (typeof TVC_SetupExport === 'undefined') {
            await TVC_Dialog.alert('Setup export module not loaded.');
            return;
        }
        try {
            _adminSetupExport.appVersion = typeof TVC_AppUpdate !== 'undefined'
                ? await TVC_AppUpdate.resolveAppVersion()
                : '1.0.6';
        } catch (_) {
            _adminSetupExport.appVersion = '1.0.6';
        }
        _adminSetupExport.companyId = state.selectedAdminCompanyId || null;
        _adminSetupExport.vesselId = state.selectedAdminVesselId || null;
        ensureAdminSetupExportSkus();
        await renderAdminSetupExportModal();
        showModal('adminSetupExportModal');
    }

    function closeAdminSetupExportModal() {
        closeModal('adminSetupExportModal');
    }

    function openAdminSopModal() {
        const body = document.getElementById('adminSopBody');
        if (body && typeof TVC_AdminSop !== 'undefined') {
            body.innerHTML = TVC_AdminSop.renderModalHtml();
        } else if (body) {
            body.innerHTML = '<p class="spare-sync-note">SOP module not loaded.</p>';
        }
        showModal('adminSopModal');
    }

    function closeAdminSopModal() {
        closeModal('adminSopModal');
    }

    function openAdminCommercialModal() {
        const body = document.getElementById('adminCommercialBody');
        if (body && typeof TVC_AdminCommercial !== 'undefined') {
            body.innerHTML = TVC_AdminCommercial.renderModalHtml();
        } else if (body) {
            body.innerHTML = '<p class="spare-sync-note">Commercial guide module not loaded.</p>';
        }
        showModal('adminCommercialModal');
    }

    function closeAdminCommercialModal() {
        closeModal('adminCommercialModal');
    }

    function selectTvcLabInList() {
        const pilot = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.getPilotDefaults()
            : { companyId: 'TVC', vesselId: 'TVC No1' };
        state.adminCompanyFilter = pilot.companyId;
        state.selectedAdminCompanyId = pilot.companyId;
        state.selectedAdminVesselId = pilot.vesselId;
        if (typeof TVC_AdminRegistry !== 'undefined') {
            TVC_AdminRegistry.setSelected(pilot.companyId, pilot.vesselId);
        }
        closeAdminCommercialModal();
        renderMainMenu();
    }

    function adminSetupExportSetCompany(id) {
        _adminSetupExport.companyId = String(id || '').trim() || null;
        const vessels = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.listVessels({ companyId: _adminSetupExport.companyId, includeInactive: false })
            : [];
        _adminSetupExport.vesselId = vessels[0]?.vessel_id || null;
    }

    function adminSetupExportSetVessel(id) {
        _adminSetupExport.vesselId = String(id || '').trim() || null;
    }

    function adminSetupExportToggleSku(sku, on) {
        _adminSetupExport.skus = _adminSetupExport.skus || {};
        _adminSetupExport.skus[sku] = !!on;
        renderAdminSetupExportModal();
    }

    function adminSetupExportSetVersion(v) {
        _adminSetupExport.appVersion = String(v || '').trim();
    }

    function adminSetupExportSetNotes(v) {
        _adminSetupExport.notes = String(v || '');
    }

    function adminSetupExportSetRecordDeploy(on) {
        _adminSetupExport.recordDeploy = !!on;
    }

    async function adminSetupExportPickFolder() {
        try {
            const r = await TVC_SetupExport.pickSourceFolder();
            if (r?.canceled) return;
            await renderAdminSetupExportModal();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function adminSetupExportRun() {
        const user = TVC_Auth.getCurrentUser();
        try {
            const companyId = _adminSetupExport.companyId;
            const vesselId = _adminSetupExport.vesselId;
            const selectedSkus = adminSetupExportSelectedSkus();
            if (!companyId) throw new Error('Select a company.');
            if (!vesselId) throw new Error('Select a vessel.');
            if (!selectedSkus.length) throw new Error('Select at least one SKU.');
            const { blob, filename, manifest } = await TVC_SetupExport.buildZip(user, {
                companyId,
                vesselId,
                appVersion: _adminSetupExport.appVersion,
                notes: _adminSetupExport.notes,
                skus: selectedSkus,
                sourceSetups: _adminSetupExport.sourceSetups,
            });
            await TVC_FileExport.save(blob, filename);
            if (_adminSetupExport.recordDeploy !== false) {
                await recordAdminDeployAndSave(selectedSkus.map(sku => ({
                    companyId,
                    vesselId,
                    kind: 'setup',
                    sku,
                    appVersion: _adminSetupExport.appVersion,
                })));
            }
            await TVC_Dialog.alert(
                `Setup exported.\n${filename}\n\nCompany: ${manifest.company_name}\nVessel: ${vesselId}\nSKUs: ${selectedSkus.join(', ')}\n\n1. Install Setup on vessel PC\n2. Export machine request JSON\n3. Administration → Seat License\n4. Import seat license on vessel PC`
            );
            closeAdminSetupExportModal();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    const _adminAppUpdate = {
        appVersion: '1.0.6',
        notes: '',
        skus: {},
        sourceSetups: [],
        sourcePath: null,
        recordDeploy: true,
        recordPool: true,
        scope: 'pool',
        companyId: null,
    };

    async function renderAdminAppUpdateModal() {
        const body = document.getElementById('adminAppUpdateBody');
        if (!body || typeof TVC_AppUpdate === 'undefined') return;
        let source = { configured: false, path: null, setups: [] };
        try {
            if (typeof TVC_SetupExport !== 'undefined') {
                source = await TVC_SetupExport.getSourceStatus();
            }
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
        _adminAppUpdate.sourcePath = source.path || null;
        _adminAppUpdate.sourceSetups = source.setups || [];
        if (!_adminAppUpdate.skus || !Object.keys(_adminAppUpdate.skus).length) {
            _adminAppUpdate.skus = {};
            for (const s of TVC_SetupExport?.HANDOFF_SKUS || ['HQ_OFFICE', 'VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK']) {
                _adminAppUpdate.skus[s] = !!_adminAppUpdate.sourceSetups.find(x => x.sku === s);
            }
        }
        const poolCompanies = adminPoolCompanies();
        const poolVesselCount = poolCompanies.reduce((n, co) => {
            const vs = typeof TVC_AdminRegistry !== 'undefined'
                ? TVC_AdminRegistry.listVessels({ companyId: co.company_id, includeInactive: false })
                : [];
            return n + vs.length;
        }, 0);
        const isCompanyScope = _adminAppUpdate.scope === 'company';
        if (isCompanyScope && !_adminAppUpdate.companyId && state.selectedAdminCompanyId) {
            _adminAppUpdate.companyId = state.selectedAdminCompanyId;
        }
        const companyId = _adminAppUpdate.companyId;
        const company = companyId && typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.getCompany(companyId) : null;
        const companyVessels = isCompanyScope ? adminRegistryActiveVesselRows(companyId) : [];
        const allowedIds = companyVessels.map(v => v.vessel_id);
        const setupRows = (TVC_SetupExport?.HANDOFF_SKUS || ['HQ_OFFICE', 'VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK']).map(sku => {
            const hit = _adminAppUpdate.sourceSetups.find(s => s.sku === sku);
            const checked = _adminAppUpdate.skus[sku] && hit ? 'checked' : '';
            const sizeMb = hit?.bytes ? `${(hit.bytes / (1024 * 1024)).toFixed(1)} MB` : '— missing';
            return `<tr>
                <td style="padding:4px 8px"><label><input type="checkbox" ${checked}${hit ? '' : ' disabled'}
                    onchange="TVC_App.adminAppUpdateToggleSku('${escAttr(sku)}', this.checked)"> ${esc(sku)}</label></td>
                <td style="padding:4px 8px">${esc(hit?.filename || '—')}</td>
                <td style="padding:4px 8px" class="muted">${esc(sizeMb)}</td>
            </tr>`;
        }).join('');
        const sourceNote = source.configured
            ? `<span class="muted">Setup folder: ${esc(source.path || '')}</span>`
            : `<span class="muted">Setup folder not found. Run <code>Release</code> or <code>npm run dist</code>, then select the <code>dist</code> folder.</span>`;
        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminAppUpdateModal()">×</button>
            <h3 class="spare-sync-title">${isCompanyScope ? '선사용 App Update (allowedVesselIds)' : '범용 App Update (pool)'}</h3>
            <p class="spare-sync-hint">${isCompanyScope
                ? '선박 추가 등 Registry 변경 후 · manifest에 active 선박 목록 포함 → <strong>HQ seat license 재발급</strong> 필수'
                : '기존 pool 선박(이미 TVC-PMS 사용 중): <strong>공용 App Update ZIP</strong> 하나를 전달합니다.'}</p>
            <p class="spare-sync-note muted">고객 PC: <strong>Data Export &amp; Import → App Update → Import → Install update</strong> · Master / History / IndexedDB 유지</p>
            ${isCompanyScope ? `
            <label class="spare-sync-note" style="display:block;margin:8px 0">Company
                <select class="admin-company-select" style="margin-top:4px;width:100%"
                    onchange="TVC_App.adminAppUpdateSetCompany(this.value);TVC_App.renderAdminAppUpdateModal()">
                    ${adminSeatLicenseCompanyOptions(companyId)}
                </select>
            </label>
            ${adminSetupExportVesselPreviewHtml(companyId)}
            <p class="spare-sync-note muted">allowedVesselIds (${allowedIds.length}): ${allowedIds.length ? esc(allowedIds.join(', ')) : '— none — register vessels first'}</p>
            ` : `<p class="spare-sync-note">Pool: ${poolCompanies.length} companies · ${poolVesselCount} active vessels</p>`}
            <p class="spare-sync-note">${sourceNote}</p>
            <div class="spare-sync-actions" style="margin:8px 0">
                <button type="button" class="btn spare-sync-btn" onclick="TVC_App.adminAppUpdatePickFolder()">Select dist folder…</button>
            </div>
            <label class="spare-sync-note" style="display:block;margin:8px 0">App version
                <input type="text" value="${escAttr(_adminAppUpdate.appVersion)}" style="width:100%;margin-top:4px"
                    oninput="TVC_App.adminAppUpdateSetVersion(this.value)">
            </label>
            <label class="spare-sync-note" style="display:block;margin:8px 0">Update notes
                <textarea rows="3" style="width:100%;margin-top:4px"
                    oninput="TVC_App.adminAppUpdateSetNotes(this.value)">${esc(_adminAppUpdate.notes || '')}</textarea>
            </label>
            <table style="width:100%;margin:12px 0;border-collapse:collapse">
                <thead><tr><th style="text-align:left;padding:4px 8px">SKU</th><th style="text-align:left;padding:4px 8px">Setup file</th><th style="text-align:left;padding:4px 8px">Size</th></tr></thead>
                <tbody>${setupRows}</tbody>
            </table>
            <label class="spare-sync-note"><input type="checkbox"${_adminAppUpdate.recordDeploy !== false ? ' checked' : ''}
                onchange="TVC_App.adminAppUpdateSetRecordDeploy(this.checked)"> Update deploy version in registry after export</label>
            ${isCompanyScope ? '' : `<label class="spare-sync-note"><input type="checkbox"${_adminAppUpdate.recordPool !== false ? ' checked' : ''}
                onchange="TVC_App.adminAppUpdateSetRecordPool(this.checked)"> Record for all active pool companies (shared ZIP)</label>`}
            <div class="modal-actions spare-sync-footer">
                <button type="button" class="btn btn-green" onclick="TVC_App.adminAppUpdateRun()"
                    ${source.configured && (!isCompanyScope || (companyId && allowedIds.length)) ? '' : ' disabled'}>Export App Update ZIP…</button>
                <button type="button" class="btn" onclick="TVC_App.closeAdminAppUpdateModal()">Close</button>
            </div>`;
    }

    async function openAdminAppUpdateModal(opts = {}) {
        if (!state.user || !TVC_RBAC.isAdminAccount?.(state.user)) return;
        if (typeof TVC_AppUpdate === 'undefined') {
            await TVC_Dialog.alert('App Update module not loaded.');
            return;
        }
        try {
            _adminAppUpdate.appVersion = await TVC_AppUpdate.resolveAppVersion();
        } catch (_) {
            _adminAppUpdate.appVersion = '1.0.6';
        }
        _adminAppUpdate.scope = opts.scope === 'company' ? 'company' : 'pool';
        _adminAppUpdate.companyId = _adminAppUpdate.scope === 'company'
            ? (opts.companyId || state.selectedAdminCompanyId || null)
            : null;
        _adminAppUpdate.skus = {};
        await renderAdminAppUpdateModal();
        showModal('adminAppUpdateModal');
    }

    async function openAdminCompanyAppUpdateModal() {
        await openAdminAppUpdateModal({ scope: 'company' });
    }

    function adminAppUpdateSetCompany(companyId) {
        _adminAppUpdate.companyId = String(companyId || '').trim() || null;
    }

    function closeAdminAppUpdateModal() {
        closeModal('adminAppUpdateModal');
    }

    function adminAppUpdateSetVersion(v) {
        _adminAppUpdate.appVersion = String(v || '').trim();
    }

    function adminAppUpdateSetNotes(v) {
        _adminAppUpdate.notes = String(v || '');
    }

    function adminAppUpdateSetRecordDeploy(on) {
        _adminAppUpdate.recordDeploy = !!on;
    }

    function adminAppUpdateSetRecordPool(on) {
        _adminAppUpdate.recordPool = !!on;
    }

    function adminAppUpdateToggleSku(sku, on) {
        _adminAppUpdate.skus = _adminAppUpdate.skus || {};
        _adminAppUpdate.skus[sku] = !!on;
    }

    async function adminAppUpdatePickFolder() {
        try {
            const r = await TVC_SetupExport.pickSourceFolder();
            if (r?.canceled) return;
            _adminAppUpdate.skus = {};
            await renderAdminAppUpdateModal();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function adminAppUpdateRun() {
        const user = TVC_Auth.getCurrentUser();
        const isCompanyScope = _adminAppUpdate.scope === 'company';
        const companyId = _adminAppUpdate.companyId;
        try {
            const handoffSkus = TVC_SetupExport?.HANDOFF_SKUS
                || ['HQ_OFFICE', 'VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK'];
            const selectedSkus = handoffSkus.filter(s => _adminAppUpdate.skus?.[s]);
            if (!selectedSkus.length) throw new Error('Select at least one SKU with Setup.exe in dist/.');
            if (isCompanyScope) {
                if (!companyId) throw new Error('Select a company.');
                const vessels = adminRegistryActiveVesselRows(companyId);
                if (!vessels.length) throw new Error('No active vessels in registry for this company.');
            }
            const company = isCompanyScope && typeof TVC_AdminRegistry !== 'undefined'
                ? TVC_AdminRegistry.getCompany(companyId) : null;
            const registryVessels = isCompanyScope ? adminRegistryManifestVessels(companyId) : null;
            const allowedVesselIds = isCompanyScope ? registryVessels.map(v => v.vessel_id) : null;
            const { blob, filename, manifest } = await TVC_AppUpdate.buildZipFromSource(user, {
                appVersion: _adminAppUpdate.appVersion,
                notes: _adminAppUpdate.notes,
                skus: selectedSkus,
                sourceSetups: _adminAppUpdate.sourceSetups,
                deliveryMode: isCompanyScope ? 'company' : 'pool',
                companyId: isCompanyScope ? companyId : null,
                companyName: company?.name || companyId,
                allowedVesselIds,
                registryVessels,
            });
            await TVC_FileExport.save(blob, filename);
            if (_adminAppUpdate.recordDeploy !== false) {
                const records = isCompanyScope
                    ? buildCompanyAppUpdateDeployRecords(companyId, _adminAppUpdate.appVersion, selectedSkus)
                    : (_adminAppUpdate.recordPool !== false
                        ? buildPoolAppUpdateDeployRecords(_adminAppUpdate.appVersion, selectedSkus)
                        : []);
                if (records.length) await recordAdminDeployAndSave(records);
            }
            if (isCompanyScope) {
                const issueLicense = await TVC_Dialog.confirm({
                    message: `Company App Update exported.\n${filename}\n\nallowedVesselIds: ${allowedVesselIds.join(', ')}\n\nNext: Issue HQ seat license for this company → HQ Import.\n\nOpen Issue seat license now?`,
                });
                closeAdminAppUpdateModal();
                if (issueLicense) {
                    _adminSeatLicense.companyId = companyId;
                    _adminSeatLicense.vesselId = null;
                    await openAdminSeatLicenseModal();
                }
            } else {
                await TVC_Dialog.alert(
                    `App Update exported.\n${filename}\n\nVersion: ${manifest.app_version}\nSKUs: ${(manifest.setups || []).map(s => s.sku).join(', ')}\n\nSend this shared ZIP to pool vessels → Import → Install update on each PC (HQ / Master / Engine / Deck).`
                );
                closeAdminAppUpdateModal();
            }
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    const _adminRelease = {
        running: false,
        info: null,
        artifacts: null,
        log: '',
        includeSetups: true,
        includeAppUpdate: true,
        includeHandoff: true,
        runBuild: true,
        recordDeploy: false,
        recordSetup: false,
        recordUpdate: true,
        companyId: null,
    };

    function adminReleaseAppendLog(line) {
        _adminRelease.log = (_adminRelease.log + String(line || '') + '\n').slice(-120000);
        const el = document.getElementById('adminReleaseLog');
        if (el) {
            el.textContent = _adminRelease.log;
            el.scrollTop = el.scrollHeight;
        }
    }

    function renderAdminReleaseBody() {
        const body = document.getElementById('adminReleaseBody');
        if (!body || typeof TVC_AdminRelease === 'undefined') return;
        const info = _adminRelease.info || {};
        const artifacts = _adminRelease.artifacts || info.artifacts || {};
        const summary = TVC_AdminRelease.artifactSummary(artifacts);
        const version = info.version || artifacts.version || '—';
        const config = artifacts.config || info.artifacts?.config || null;
        const changelog = (config?.changelog || []).slice(0, 8);
        const changelogMore = (config?.changelog || []).length > 8
            ? `<li class="muted">… +${config.changelog.length - 8} more</li>` : '';
        const setupRows = (artifacts.setups || []).map(s =>
            `<li>${esc(s.sku)} — ${esc(s.filename)} (${esc(TVC_AdminRelease.formatBytes(s.bytes))})</li>`
        ).join('') || '<li class="muted">No Setup.exe in dist/ yet</li>';
        const zipLine = artifacts.appUpdateZip
            ? `<li>App Update — ${esc(artifacts.appUpdateZip.filename)} (${esc(TVC_AdminRelease.formatBytes(artifacts.appUpdateZip.bytes))})</li>`
            : '<li class="muted">No App Update ZIP in dist/ yet</li>';
        const handoffLine = artifacts.handoff
            ? `<li>Handoff — ${esc(artifacts.handoff.filename)}</li>`
            : '<li class="muted">No handoff note in release/ yet</li>';
        const buildable = info.buildable !== false;
        const buildWarn = buildable
            ? ''
            : `<p class="spare-sync-note" style="color:#c53030">${esc(info.buildableMessage || 'Release build unavailable in this environment.')}</p>`;
        const running = _adminRelease.running;
        const exportFolder = info.exportFolder || 'Downloads';
        const companyId = _adminRelease.companyId || state.selectedAdminCompanyId || '';
        body.innerHTML = `
            <h3 class="spare-sync-title">Release v${esc(version)} — Build &amp; Export</h3>
            <p class="spare-sync-hint">One click: <strong>npm run release</strong> → 4× Setup.exe + App Update ZIP + handoff.txt → export folder.</p>
            <p class="spare-sync-note muted">A선사: App Update ZIP (data 유지) · B선사: Setup.exe (신규 설치) · 빌드 약 20–40분.</p>
            ${buildWarn}
            ${config?.label ? `<p class="spare-sync-note"><strong>${esc(config.label)}</strong></p>` : ''}
            ${changelog.length ? `<ul class="admin-release-artifacts">${changelog.map(c => `<li>${esc(c)}</li>`).join('')}${changelogMore}</ul>` : ''}
            <p class="spare-sync-note muted">Current artifacts (${summary.setups} setups${summary.hasZip ? ' · ZIP ready' : ''}${summary.hasHandoff ? ' · handoff ready' : ''}):</p>
            <ul class="admin-release-artifacts">${setupRows}${zipLine}${handoffLine}</ul>
            <p class="spare-sync-note muted">Export folder: <code>${esc(exportFolder)}</code> / subfolder <code>TVC-Release-v${esc(version)}-YYYY-MM-DD</code></p>
            <label class="spare-sync-note" style="display:block;margin:8px 0">
                <input type="checkbox"${_adminRelease.runBuild ? ' checked' : ''}${running ? ' disabled' : ''}
                    onchange="TVC_App.adminReleaseSetRunBuild(this.checked)"> Run <code>npm run release</code> (4 SKU Setup + App Update ZIP)
            </label>
            <label class="spare-sync-note"><input type="checkbox"${_adminRelease.includeSetups ? ' checked' : ''}${running ? ' disabled' : ''}
                onchange="TVC_App.adminReleaseSetIncludeSetups(this.checked)"> Copy Setup.exe (4 SKU) to export folder</label>
            <label class="spare-sync-note"><input type="checkbox"${_adminRelease.includeAppUpdate ? ' checked' : ''}${running ? ' disabled' : ''}
                onchange="TVC_App.adminReleaseSetIncludeAppUpdate(this.checked)"> Copy App Update ZIP to export folder</label>
            <label class="spare-sync-note"><input type="checkbox"${_adminRelease.includeHandoff ? ' checked' : ''}${running ? ' disabled' : ''}
                onchange="TVC_App.adminReleaseSetIncludeHandoff(this.checked)"> Copy handoff.txt to export folder</label>
            <label class="spare-sync-note" style="display:block;margin:8px 0">Company (optional deploy registry)
                <select class="admin-company-select" style="margin-top:4px"${running ? ' disabled' : ''}
                    onchange="TVC_App.adminReleaseSetCompany(this.value)">
                    ${adminSeatLicenseCompanyOptions(companyId)}
                </select>
            </label>
            <label class="spare-sync-note"><input type="checkbox"${_adminRelease.recordDeploy ? ' checked' : ''}${running ? ' disabled' : ''}
                onchange="TVC_App.adminReleaseSetRecordDeploy(this.checked)"> Update deploy version in registry after export</label>
            <label class="spare-sync-note admin-release-deploy-detail"${_adminRelease.recordDeploy ? '' : ' hidden'}>
                <input type="checkbox"${_adminRelease.recordSetup ? ' checked' : ''}${running ? ' disabled' : ''}
                    onchange="TVC_App.adminReleaseSetRecordSetup(this.checked)"> Record Setup sent (B선사)</label>
            <label class="spare-sync-note admin-release-deploy-detail"${_adminRelease.recordDeploy ? '' : ' hidden'}>
                <input type="checkbox"${_adminRelease.recordUpdate !== false ? ' checked' : ''}${running ? ' disabled' : ''}
                    onchange="TVC_App.adminReleaseSetRecordUpdate(this.checked)"> Record App Update (A선사 · all SKUs)</label>
            <pre id="adminReleaseLog" class="admin-release-log">${esc(_adminRelease.log || '')}</pre>
            <div class="spare-sync-actions">
                <button type="button" class="btn btn-green spare-sync-btn" onclick="TVC_App.adminReleaseRun()"
                    ${running ? ' disabled' : ''}>${running ? 'Building…' : (_adminRelease.runBuild ? 'Run Release (Build & Export)' : 'Export artifacts only')}</button>
                <button type="button" class="btn spare-sync-btn" onclick="TVC_App.adminReleaseCancel()"
                    ${running ? '' : ' disabled'}>Cancel build</button>
                <button type="button" class="btn spare-sync-btn" onclick="TVC_App.adminReleaseOpenExportFolder()"
                    ${running ? ' disabled' : ''}>Open export folder</button>
            </div>
            <div class="spare-sync-footer">
                <button type="button" class="btn" onclick="TVC_App.closeAdminReleaseModal()" ${running ? ' disabled' : ''}>Close</button>
            </div>`;
    }

    async function openAdminReleaseModal() {
        if (!state.user || !TVC_RBAC.isAdminAccount?.(state.user)) return;
        if (typeof TVC_AdminRelease === 'undefined') {
            await TVC_Dialog.alert('Admin Release module not loaded.');
            return;
        }
        if (!window.tvcElectron?.getReleaseInfo) {
            await TVC_Dialog.alert('Release requires Electron Admin Mode (npm run electron:admin).');
            return;
        }
        try {
            _adminRelease.info = await TVC_AdminRelease.getInfo();
            _adminRelease.artifacts = _adminRelease.info.artifacts || null;
            _adminRelease.companyId = state.selectedAdminCompanyId || _adminRelease.companyId || null;
            if (!_adminRelease.log) _adminRelease.log = '';
            renderAdminReleaseBody();
            showModal('adminReleaseModal');
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    function closeAdminReleaseModal() {
        if (_adminRelease.running) return;
        closeModal('adminReleaseModal');
    }

    function adminReleaseSetRunBuild(on) { _adminRelease.runBuild = !!on; renderAdminReleaseBody(); }
    function adminReleaseSetIncludeSetups(on) { _adminRelease.includeSetups = !!on; }
    function adminReleaseSetIncludeAppUpdate(on) { _adminRelease.includeAppUpdate = !!on; }
    function adminReleaseSetIncludeHandoff(on) { _adminRelease.includeHandoff = !!on; }
    function adminReleaseSetCompany(id) { _adminRelease.companyId = String(id || '').trim() || null; }
    function adminReleaseSetRecordDeploy(on) {
        _adminRelease.recordDeploy = !!on;
        renderAdminReleaseBody();
    }
    function adminReleaseSetRecordSetup(on) { _adminRelease.recordSetup = !!on; }
    function adminReleaseSetRecordUpdate(on) { _adminRelease.recordUpdate = !!on; }

    async function adminReleaseOpenExportFolder() {
        if (!window.tvcElectron?.openExportFolder) return;
        await window.tvcElectron.openExportFolder();
    }

    async function adminReleaseCancel() {
        if (!_adminRelease.running) return;
        try {
            await TVC_AdminRelease.cancelBuild();
            adminReleaseAppendLog('\n[Cancelled by user]\n');
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        } finally {
            _adminRelease.running = false;
            renderAdminReleaseBody();
        }
    }

    async function adminReleaseRun() {
        if (_adminRelease.running) return;
        if (typeof TVC_AdminRelease === 'undefined') {
            await TVC_Dialog.alert('Admin Release module not loaded.');
            return;
        }
        const info = _adminRelease.info;
        if (_adminRelease.runBuild && info && info.buildable === false) {
            await TVC_Dialog.alert(info.buildableMessage || 'Release build is not available in this environment.');
            return;
        }
        if (!_adminRelease.runBuild
            && !_adminRelease.includeSetups
            && !_adminRelease.includeAppUpdate
            && !_adminRelease.includeHandoff) {
            await TVC_Dialog.alert('Select at least one export option.');
            return;
        }
        if (_adminRelease.recordDeploy && !_adminRelease.companyId) {
            await TVC_Dialog.alert('Select a company to update deploy registry.');
            return;
        }
        const version = info?.version || _adminRelease.artifacts?.version;
        const ok = await TVC_Dialog.confirm(
            _adminRelease.runBuild
                ? `Run full release build for v${version || '?'}?\n\nThis runs npm run release (about 20–40 min) and copies outputs to the export folder.`
                : `Export existing release artifacts for v${version || '?'} to the export folder?`
        );
        if (!ok) return;

        _adminRelease.running = true;
        _adminRelease.log = '';
        renderAdminReleaseBody();

        try {
            if (_adminRelease.runBuild) {
                adminReleaseAppendLog(`Starting npm run release (v${version || '?'})...\n`);
                const buildResult = await TVC_AdminRelease.runBuild(adminReleaseAppendLog);
                _adminRelease.artifacts = buildResult.artifacts || null;
                adminReleaseAppendLog('\n[Build complete]\n');
            } else {
                _adminRelease.artifacts = await TVC_AdminRelease.listArtifacts();
            }

            if (_adminRelease.includeSetups || _adminRelease.includeAppUpdate || _adminRelease.includeHandoff) {
                adminReleaseAppendLog('Copying artifacts to export folder…\n');
                const exportResult = await TVC_AdminRelease.exportArtifacts({
                    version,
                    includeSetups: _adminRelease.includeSetups,
                    includeAppUpdate: _adminRelease.includeAppUpdate,
                    includeHandoff: _adminRelease.includeHandoff,
                });
                adminReleaseAppendLog(`Exported to: ${exportResult.folder}\n`);
                for (const c of exportResult.copied || []) {
                    adminReleaseAppendLog(`  · ${c.filename} (${TVC_AdminRelease.formatBytes(c.bytes)})\n`);
                }

                if (_adminRelease.recordDeploy && _adminRelease.companyId) {
                    const skus = (exportResult.copied || [])
                        .filter(c => /Setup\.exe$/i.test(c.filename))
                        .map(c => {
                            if (/HQ_OFFICE/i.test(c.filename)) return 'HQ_OFFICE';
                            if (/VESSEL_MASTER/i.test(c.filename)) return 'VESSEL_MASTER';
                            if (/VESSEL_ENGINE/i.test(c.filename)) return 'VESSEL_ENGINE';
                            if (/VESSEL_DECK/i.test(c.filename)) return 'VESSEL_DECK';
                            return null;
                        })
                        .filter(Boolean);
                    const deployEntries = TVC_AdminRelease.buildDeployRecords(
                        _adminRelease.companyId,
                        version,
                        skus.length ? [...new Set(skus)] : null,
                        {
                            recordSetup: _adminRelease.recordSetup,
                            recordUpdate: _adminRelease.recordUpdate !== false,
                        }
                    );
                    if (deployEntries.length) {
                        await recordAdminDeployAndSave(deployEntries);
                        adminReleaseAppendLog('Registry deploy version updated.\n');
                    }
                }

                const names = (exportResult.copied || []).map(c => c.filename).join('\n  · ');
                await TVC_Dialog.alert(
                    `Release export complete.\n\nFolder:\n${exportResult.folder}\n\nFiles:\n  · ${names}\n\nCompany A → App Update ZIP · Company B → Setup.exe`
                );
            } else if (_adminRelease.runBuild) {
                await TVC_Dialog.alert('Build complete. Artifacts are in dist/ and release/.');
            }

            _adminRelease.info = await TVC_AdminRelease.getInfo();
            _adminRelease.artifacts = _adminRelease.info.artifacts || _adminRelease.artifacts;
        } catch (e) {
            adminReleaseAppendLog(`\n[Error] ${e.message || String(e)}\n`);
            await TVC_Dialog.alert(e.message || String(e));
        } finally {
            _adminRelease.running = false;
            renderAdminReleaseBody();
        }
    }

    function enrichFleetRowCompanyCode(v) {
        if (v.company_code) return v;
        const cid = typeof TVC_Fleet !== 'undefined'
            ? TVC_Fleet.vesselCompanyId(v)
            : String(v.company_id || '').trim();
        const c = typeof TVC_AdminRegistry !== 'undefined' && cid
            ? TVC_AdminRegistry.getCompany(cid)
            : null;
        return { ...v, company_code: c?.company_code || '' };
    }

    function sortFleetListRows(vessels, { companyFilterAll = false } = {}) {
        const sortKey = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.regCodeSortKey.bind(TVC_AdminRegistry)
            : (v) => {
                const n = Number(String(v ?? '').trim());
                return Number.isInteger(n) && n >= 1 && n <= 200 ? n : 9999;
            };
        const rows = vessels.map(enrichFleetRowCompanyCode);
        return [...rows].sort((a, b) => {
            if (companyFilterAll) {
                const cc = sortKey(a.company_code) - sortKey(b.company_code);
                if (cc) return cc;
            }
            const vc = sortKey(a.code) - sortKey(b.code);
            if (vc) return vc;
            return String(a.id || a.vessel_id || '').localeCompare(String(b.id || b.vessel_id || ''));
        });
    }

    function adminRegistryFormActions(isEdit, { saveFormId, onDelete }) {
        const deleteBtn = isEdit && onDelete
            ? `<button type="button" class="btn btn-red" onclick="${onDelete}">Delete</button>`
            : '';
        return `
            <div class="modal-actions admin-registry-form-actions">
                <button type="submit" form="${escAttr(saveFormId)}" class="btn btn-green">Save</button>
                ${deleteBtn}
                <button type="button" class="btn" onclick="TVC_App.adminRegistryCancelForm()">Cancel</button>
            </div>`;
    }

    function adminStatusOptions(selected) {
        const opts = TVC_AdminRegistry?.STATUS_OPTS || ['active', 'inactive'];
        return opts.map(s =>
            `<option value="${escAttr(s)}"${s === selected ? ' selected' : ''}>${esc(s)}</option>`).join('');
    }

    function renderAdminCompanyForm(mode) {
        const host = document.getElementById('adminRegistryBody');
        if (!host) return;
        const isEdit = mode === 'edit';
        const company = isEdit && state.selectedAdminCompanyId
            ? TVC_AdminRegistry.getCompany(state.selectedAdminCompanyId)
            : null;
        if (isEdit && !company) {
            host.innerHTML = '<p class="muted">Select a company in the left list first.</p>';
            return;
        }
        const hqSku = company?.hq_sku || 'HQ_OFFICE';
        const hqSuggest = !isEdit && typeof TVC_AccountProvisioning !== 'undefined'
            ? TVC_AccountProvisioning.suggestCompanyHqUsername(company?.company_id || '', company?.contact_email || '')
            : '';
        const companyCodeUsed = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.usedCompanyCodes(isEdit ? company?.company_id : null)
            : new Set();
        const companyCodeOpts = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.regCodeSelectOptions(companyCodeUsed, company?.company_code)
            : '';
        host.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminRegistryModal()" aria-label="Close">×</button>
            <h3 class="spare-sync-title">${isEdit ? 'Edit company' : 'Add company'}</h3>
            <p class="spare-sync-hint muted">Saved to <code>admin/registry.json</code> and <code>admin/companies/…/company.json</code>.</p>
            <form class="orig-job-form" id="adminCompanyForm" onsubmit="event.preventDefault();TVC_App.saveAdminCompanyForm()">
                <label>Company ID
                    <input name="company_id" required ${isEdit ? 'readonly class="wr-ro"' : ''}
                        placeholder="e.g. TVC" value="${escAttr(company?.company_id || '')}">
                </label>
                <label>Status<select name="status">${adminStatusOptions(company?.status || 'active')}</select></label>
                <label>Company Code
                    <select name="company_code" required>${companyCodeOpts}</select></label>
                ${adminRegistryLoginFields(company?.hq_login, isEdit, { suggest: hqSuggest })}
                <label class="span2">Name (KR)
                    <input name="name" required placeholder="e.g. The Vessel Code" value="${escAttr(company?.name || '')}">
                </label>
                <label class="span2">Name (EN)
                    <input name="name_en" placeholder="e.g. The Vessel Code" value="${escAttr(company?.name_en || '')}">
                </label>
                <label class="span2">Address
                    <input name="address" placeholder="선사 주소" value="${escAttr(company?.address || '')}">
                </label>
                <label>Contact name
                    <input name="contact_name" placeholder="담당자" value="${escAttr(company?.contact_name || '')}">
                </label>
                <label>Contact email
                    <input name="contact_email" type="email" placeholder="email@…" value="${escAttr(company?.contact_email || '')}">
                </label>
                <label>Contract start
                    <input name="contract_start_date" type="date" value="${escAttr(company?.contract?.start_date || '')}">
                </label>
                <label>Term (months)
                    <input name="contract_term_months" type="number" min="0" step="1" placeholder="12"
                        value="${escAttr(company?.contract?.term_months ? String(company.contract.term_months) : '')}">
                </label>
                <label class="span2">Fee note
                    <input name="contract_fee_note" placeholder="별첨 견적 참조" value="${escAttr(company?.contract?.fee_note || '')}">
                </label>
                <label>HQ SKU
                    <input name="hq_sku" value="${escAttr(hqSku)}" placeholder="HQ_OFFICE">
                </label>
                <label class="span2">Notes
                    <textarea name="notes" rows="2" placeholder="Optional contract notes">${esc(company?.notes || '')}</textarea>
                </label>
            </form>
            ${adminRegistryFormActions(isEdit, {
                saveFormId: 'adminCompanyForm',
                onDelete: 'TVC_App.deactivateAdminCompany()',
            })}`;
        state._adminRegForm = { type: 'company', mode };
    }

    function renderAdminVesselForm(mode) {
        const host = document.getElementById('adminRegistryBody');
        if (!host) return;
        const isEdit = mode === 'edit';
        const companyId = state.selectedAdminCompanyId;
        const vessel = isEdit && companyId && state.selectedAdminVesselId
            ? TVC_AdminRegistry.getVessel(companyId, state.selectedAdminVesselId)
            : null;
        const companies = TVC_AdminRegistry.listCompanies({ includeInactive: true });
        if (isEdit && !vessel) {
            host.innerHTML = '<p class="muted">Select a vessel in the left list first.</p>';
            return;
        }
        if (!companies.length) {
            host.innerHTML = '<p class="muted">Add a company first.</p>';
            return;
        }
        const companyOpts = companies.map(c =>
            `<option value="${escAttr(c.company_id)}"${c.company_id === (companyId || companies[0]?.company_id) ? ' selected' : ''}>${esc(c.name)} (${esc(c.company_id)})</option>`).join('');
        const selCompanyId = companyId || companies[0]?.company_id || '';
        const masterSuggest = !isEdit && selCompanyId && typeof TVC_AccountProvisioning !== 'undefined'
            ? TVC_AccountProvisioning.suggestVesselMasterUsername(selCompanyId, vessel?.vessel_id || '')
            : '';
        const vesselCodeUsed = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.usedVesselCodes(selCompanyId, isEdit ? vessel?.vessel_id : null)
            : new Set();
        const vesselCodeOpts = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.regCodeSelectOptions(vesselCodeUsed, vessel?.code)
            : '';
        host.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminRegistryModal()" aria-label="Close">×</button>
            <h3 class="spare-sync-title">${isEdit ? 'Edit vessel' : 'Add vessel'}</h3>
            <p class="spare-sync-hint muted">Saved to registry and <code>admin/companies/…/vessels/…/vessel.json</code>.</p>
            <form class="orig-job-form" id="adminVesselForm" onsubmit="event.preventDefault();TVC_App.saveAdminVesselForm()">
                <label class="span2">Company<select name="company_id" ${isEdit ? 'disabled' : ''}>${companyOpts}</select></label>
                <label>Vessel ID
                    <input name="vessel_id" required ${isEdit ? 'readonly class="wr-ro"' : ''}
                        placeholder="e.g. TVC No1" value="${escAttr(vessel?.vessel_id || '')}">
                </label>
                <label>Status<select name="status">${adminStatusOptions(vessel?.status || 'active')}</select></label>
                ${adminRegistryLoginFields(vessel?.master_login, isEdit, { suggest: masterSuggest })}
                <label>Code
                    <select name="code" required>${vesselCodeOpts}</select></label>
                <label>IMO No<input name="imo_no" placeholder="9297711" value="${escAttr(vessel?.imo_no || '')}"></label>
                <label>Delivery<input name="delivery" type="date" value="${escAttr(vessel?.delivery || '')}"></label>
                <label class="span2">Notes
                    <textarea name="notes" rows="2" placeholder="Optional">${esc(vessel?.notes || '')}</textarea>
                </label>
            </form>
            ${adminRegistryFormActions(isEdit, {
                saveFormId: 'adminVesselForm',
                onDelete: 'TVC_App.deactivateAdminVessel()',
            })}`;
        state._adminRegForm = { type: 'vessel', mode };
    }

    async function openAdminCompanyForm(mode) {
        if (!state.user || !TVC_RBAC.isAdminAccount?.(state.user)) return;
        if (typeof TVC_AdminRegistry === 'undefined') {
            await TVC_Dialog.alert('Admin registry module not loaded.');
            return;
        }
        renderAdminCompanyForm(mode === 'edit' ? 'edit' : 'add');
        showModal('adminRegistryModal');
    }

    async function openAdminVesselForm(mode) {
        if (!state.user || !TVC_RBAC.isAdminAccount?.(state.user)) return;
        if (typeof TVC_AdminRegistry === 'undefined') {
            await TVC_Dialog.alert('Admin registry module not loaded.');
            return;
        }
        if (mode === 'add' && !state.selectedAdminCompanyId) {
            const first = TVC_AdminRegistry.listCompanies({ includeInactive: true })[0];
            if (first) state.selectedAdminCompanyId = first.company_id;
        }
        renderAdminVesselForm(mode === 'edit' ? 'edit' : 'add');
        showModal('adminRegistryModal');
    }

    async function persistAdminRegistry() {
        await TVC_AdminRegistry.save();
        if (typeof TVC_Fleet.syncFromAdminRegistry === 'function') {
            TVC_Fleet.syncFromAdminRegistry();
        }
        if (typeof TVC_AccountProvisioning !== 'undefined') {
            await TVC_AccountProvisioning.syncRegistryToUsers();
        }
        const fromHub = state._adminRegFromHub;
        state._adminRegForm = null;
        if (fromHub) {
            state._adminRegFromHub = false;
            state._adminRegView = 'hub';
            renderAdminRegistryHub();
            showModal('adminRegistryModal');
        } else {
            closeAdminRegistryModal();
        }
        renderMainMenu();
    }

    async function saveAdminCompanyForm() {
        const form = document.getElementById('adminCompanyForm');
        if (!form) return;
        const fd = new FormData(form);
        const isEdit = state._adminRegForm?.mode === 'edit';
        const input = {
            _edit: isEdit,
            company_id: fd.get('company_id'),
            company_code: fd.get('company_code'),
            name: fd.get('name'),
            name_en: fd.get('name_en'),
            status: fd.get('status'),
            hq_sku: fd.get('hq_sku'),
            notes: fd.get('notes'),
            address: fd.get('address'),
            contact_name: fd.get('contact_name'),
            contact_email: fd.get('contact_email'),
            contract_start_date: fd.get('contract_start_date'),
            contract_term_months: fd.get('contract_term_months'),
            contract_fee_note: fd.get('contract_fee_note'),
        };
        try {
            const company = TVC_AdminRegistry.upsertCompany(input);
            state.selectedAdminCompanyId = company.company_id;
            TVC_AdminRegistry.setSelected(state.selectedAdminCompanyId, state.selectedAdminVesselId);
            const loginUsername = String(fd.get('login_username') || '').trim();
            const loginPassword = String(fd.get('login_password') || '').trim();
            if (typeof TVC_AccountProvisioning !== 'undefined') {
                if (isEdit) {
                    if (loginPassword) {
                        const username = loginUsername || company.hq_login?.username;
                        if (!username) throw new Error('HQ web login ID is required to change password.');
                        await TVC_AccountProvisioning.saveCompanyHqLogin(company.company_id, {
                            username,
                            password: loginPassword,
                            display_name: `${company.name} HQ`,
                        });
                    }
                } else if (loginUsername || loginPassword) {
                    if (!loginUsername || loginPassword.length < 4) {
                        throw new Error('Web login requires ID and password (min 4 characters).');
                    }
                    await TVC_AccountProvisioning.saveCompanyHqLogin(company.company_id, {
                        username: loginUsername,
                        password: loginPassword,
                        display_name: `${company.name} HQ`,
                    });
                }
            }
            await persistAdminRegistry();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function saveAdminVesselForm() {
        const form = document.getElementById('adminVesselForm');
        if (!form) return;
        const fd = new FormData(form);
        const isEdit = state._adminRegForm?.mode === 'edit';
        const companyId = isEdit
            ? state.selectedAdminCompanyId
            : String(fd.get('company_id') || '').trim();
        const input = {
            _edit: isEdit,
            vessel_id: fd.get('vessel_id'),
            code: fd.get('code'),
            imo_no: fd.get('imo_no'),
            delivery: fd.get('delivery'),
            status: fd.get('status'),
            notes: fd.get('notes'),
        };
        try {
            const vessel = TVC_AdminRegistry.upsertVessel(companyId, input);
            state.selectedAdminCompanyId = companyId;
            state.selectedAdminVesselId = vessel.vessel_id;
            TVC_AdminRegistry.setSelected(state.selectedAdminCompanyId, state.selectedAdminVesselId);
            const loginUsername = String(fd.get('login_username') || '').trim();
            const loginPassword = String(fd.get('login_password') || '').trim();
            if (typeof TVC_AccountProvisioning !== 'undefined') {
                if (isEdit) {
                    if (loginPassword) {
                        const username = loginUsername || vessel.master_login?.username;
                        if (!username) throw new Error('Master login ID is required to change password.');
                        await TVC_AccountProvisioning.saveVesselMasterLogin(companyId, vessel.vessel_id, {
                            username,
                            password: loginPassword,
                            display_name: `${vessel.vessel_id} Master`,
                        });
                    }
                } else if (loginUsername || loginPassword) {
                    if (!loginUsername || loginPassword.length < 4) {
                        throw new Error('Web login requires ID and password (min 4 characters).');
                    }
                    await TVC_AccountProvisioning.saveVesselMasterLogin(companyId, vessel.vessel_id, {
                        username: loginUsername,
                        password: loginPassword,
                        display_name: `${vessel.vessel_id} Master`,
                    });
                }
            }
            await persistAdminRegistry();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function deactivateAdminCompany() {
        const id = state.selectedAdminCompanyId;
        if (!id) return;
        if (!await TVC_Dialog.confirm({
            message: `Delete company "${id}"?\n\nSets status to inactive. Registry files are kept but it is hidden from active lists.`,
            kind: 'delete',
        })) return;
        try {
            TVC_AdminRegistry.setCompanyStatus(id, 'inactive');
            await persistAdminRegistry();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function deactivateAdminVessel() {
        const cid = state.selectedAdminCompanyId;
        const vid = state.selectedAdminVesselId;
        if (!cid || !vid) return;
        if (!await TVC_Dialog.confirm({
            message: `Delete vessel "${vid}"?\n\nSets status to inactive. Registry files are kept but it is hidden from active lists.`,
            kind: 'delete',
        })) return;
        try {
            TVC_AdminRegistry.setVesselStatus(cid, vid, 'inactive');
            await persistAdminRegistry();
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    function hqFleetCompanyId(user) {
        return String(user?.company_id || (typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.licenseCompanyId() : 'TVC')).trim();
    }

    function hqFleetCompanySelectOptions(user, selectedFilter) {
        const sel = selectedFilter != null ? selectedFilter : (state.fleetCompanyFilter || '');
        if (TVC_RBAC.isCompanyHqAccount?.(user)) {
            const id = hqFleetCompanyId(user);
            return `<option value="${escAttr(id)}" selected>${esc(id)}</option>`;
        }
        const companies = typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.listCompanyIds(user) : [];
        let html = `<option value="${ADMIN_COMPANY_FILTER_ALL}"${sel === ADMIN_COMPANY_FILTER_ALL || sel === '' ? ' selected' : ''}>All</option>`;
        html += companies.map(id =>
            `<option value="${escAttr(id)}"${id === sel ? ' selected' : ''}>${esc(id)}</option>`
        ).join('');
        return html;
    }

    function hqFleetAppVersion(vessel) {
        if (typeof TVC_AdminRegistry !== 'undefined' && TVC_AdminRegistry.formatVesselAppVersions && vessel) {
            try {
                const cid = TVC_Fleet.vesselCompanyId?.(vessel);
                const row = TVC_AdminRegistry.getVessel?.(cid, vessel.id);
                const fromRow = row?.deploy ? TVC_AdminRegistry.formatVesselAppVersions(row.deploy) : '';
                if (fromRow && fromRow !== '—') return fromRow;
                const company = TVC_AdminRegistry.getCompany?.(cid);
                const fromCo = company?.deploy ? TVC_AdminRegistry.formatCompanyAppVersion(company.deploy) : '';
                if (fromCo && fromCo !== '—') return fromCo;
            } catch (_) { /* registry not loaded on HQ */ }
        }
        const local = String(vessel?.app_version || '').trim();
        if (local) return local;
        try {
            const last = typeof TVC_AppUpdate !== 'undefined' ? TVC_AppUpdate.getLastApplied?.() : null;
            if (last?.app_version) return String(last.app_version);
        } catch (_) { /* ignore */ }
        if (typeof TVC_AppUpdate !== 'undefined' && TVC_AppUpdate.currentAppVersion) {
            return TVC_AppUpdate.currentAppVersion() || '—';
        }
        return '—';
    }

    function renderFleetList() {
        const hqCol = document.getElementById('hqLeftCol');
        const body = document.getElementById('fleetTableBody');
        if (!body) return;
        const isSuperHq = state.user && TVC_RBAC.isSuperHqAccount?.(state.user);
        const isHq = state.user && TVC_RBAC.isHqAccount(state.user);
        hqCol?.classList.toggle('hidden', !isHq);
        document.getElementById('cmaxsMenuBody')?.classList.toggle('hq-mode', isHq);
        if (!isHq) return;

        ensureAdminFleetPanelLayout();
        const search = document.getElementById('fleetSearch');
        if (search) {
            search.placeholder = 'Search vessel ID / IMO No…';
            search.oninput = () => TVC_App.setFleetSearch(search.value);
            if (search.value !== (state.fleetSearch || '')) search.value = state.fleetSearch || '';
        }

        const companySelect = document.getElementById('adminCompanySelect');
        if (companySelect) {
            const scoped = TVC_RBAC.isCompanyHqAccount?.(state.user) && !isSuperHq;
            if (scoped && !state.fleetCompanyFilter) state.fleetCompanyFilter = hqFleetCompanyId(state.user);
            if (!scoped && !state.fleetCompanyFilter) state.fleetCompanyFilter = ADMIN_COMPANY_FILTER_ALL;
            companySelect.innerHTML = isSuperHq
                ? adminCompanySelectOptions(state.fleetCompanyFilter)
                : hqFleetCompanySelectOptions(state.user, state.fleetCompanyFilter);
            companySelect.disabled = !!scoped;
            companySelect.title = scoped ? 'This HQ account is limited to the licensed company.' : '';
            companySelect.onchange = () => TVC_App.setFleetCompanyFilter(companySelect.value);
        }

        syncAdminFleetColgroup();
        const theadRow = document.querySelector('#fleetListPanel .fleet-table thead tr');
        if (theadRow) theadRow.innerHTML = ADMIN_FLEET_TABLE_HEAD;

        let vessels = typeof TVC_Fleet.getVisible === 'function'
            ? TVC_Fleet.getVisible(state.user)
            : TVC_Fleet.getAll();
        const companyFilter = state.fleetCompanyFilter;
        if (companyFilter && companyFilter !== ADMIN_COMPANY_FILTER_ALL) {
            vessels = vessels.filter(v => TVC_Fleet.vesselCompanyId(v) === companyFilter);
        }
        const q = (state.fleetSearch || '').toLowerCase();
        if (q) vessels = vessels.filter(v =>
            (v.id || '').toLowerCase().includes(q) ||
            (v.imo_no || '').toLowerCase().includes(q) ||
            (v.code || '').toLowerCase().includes(q) ||
            (TVC_Fleet.vesselCompanyId(v) || '').toLowerCase().includes(q)
        );
        const companyFilterAll = !companyFilter || companyFilter === ADMIN_COMPANY_FILTER_ALL;
        vessels = sortFleetListRows(vessels, { companyFilterAll });
        state.fleet = vessels;

        if (!vessels.length) {
            body.innerHTML = `<tr><td colspan="${ADMIN_FLEET_COLSPAN}" class="muted" style="text-align:center">No vessels found</td></tr>`;
            refreshSearchClearUi(document.getElementById('fleetListPanel') || document);
            return;
        }
        body.innerHTML = vessels.map((v, i) => {
            const sel = v.id === state.selectedVesselId ? ' selected' : '';
            const companyId = TVC_Fleet.vesselCompanyId(v);
            return `<tr class="fleet-row${sel}" onclick="TVC_App.selectVessel('${escAttr(v.id)}')">
                <td>${i + 1}</td>
                <td>${esc(companyId)}</td>
                <td><strong>${esc(v.id)}</strong></td>
                <td>${esc(v.imo_no || '—')}</td>
                <td>${esc(v.delivery || '—')}</td>
                <td class="fleet-cell-ver">${esc(hqFleetAppVersion(v))}</td>
                ${fleetDocsCellHtml(v.id, companyId)}
            </tr>`;
        }).join('');
        refreshSearchClearUi(document.getElementById('fleetListPanel') || document);
    }

    function canEditVesselDocs() {
        const user = state.user;
        return !!(user && (TVC_RBAC.isHqAccount?.(user) || TVC_RBAC.isAdminAccount?.(user)));
    }

    function resolveVesselDocsMeta(vesselId, companyId) {
        const vid = String(vesselId || '').trim();
        const cid = String(companyId || '').trim();
        const isAdmin = state.user && TVC_RBAC.isAdminAccount?.(state.user);
        if (isAdmin && typeof TVC_AdminRegistry !== 'undefined') {
            const row = TVC_AdminRegistry.getVessel?.(cid, vid);
            if (row) {
                return {
                    vesselId: row.vessel_id || vid,
                    companyId: row.company_id || cid,
                    name: row.vessel_id || vid,
                    imo: row.imo_no || '',
                };
            }
        }
        const vessels = typeof TVC_Fleet !== 'undefined'
            ? (typeof TVC_Fleet.getVisible === 'function' ? TVC_Fleet.getVisible(state.user) : TVC_Fleet.getAll())
            : [];
        const hit = (vessels || []).find(v => String(v.id) === vid
            || String(v.vessel_id) === vid);
        if (hit) {
            return {
                vesselId: hit.id || vid,
                companyId: cid || TVC_Fleet.vesselCompanyId?.(hit) || '',
                name: hit.name || vid,
                imo: hit.imo_no || '',
            };
        }
        return { vesselId: vid, companyId: cid, name: vid, imo: '' };
    }

    function emptyVesselDocsRecord(meta) {
        return {
            id: vesselDocsRecordId(meta.companyId, meta.vesselId),
            vessel_id: meta.vesselId,
            company_id: meta.companyId || '',
            attachments: [],
            updated_at: new Date().toISOString(),
            sync_status: 'LOCAL',
        };
    }

    async function persistVesselDocsRecord() {
        const rec = state._vesselDocsRecord;
        if (!rec?.id || typeof TVC_DB === 'undefined') return;
        rec.updated_at = new Date().toISOString();
        rec.sync_status = 'LOCAL';
        await TVC_DB.put('vessel_documents', rec);
    }

    function renderVesselDocsModal() {
        const host = document.getElementById('vesselDocsBody');
        const rec = state._vesselDocsRecord;
        const meta = state._vesselDocsMeta || {};
        if (!host || !rec) return;
        const canAttach = canEditVesselDocs();
        const list = rec.attachments || [];
        const items = typeof TVC_Attachments !== 'undefined'
            ? list.map(a => TVC_Attachments.renderListItemHtml(a, {
                canRemove: canAttach,
                removeOnclick: canAttach
                    ? `TVC_App.removeVesselDocsAttachment('${escAttr(String(a.id))}')`
                    : '',
            })).join('')
            : '';
        const listHtml = items
            ? `<div class="wr-attach-list-wrap"><ul class="wr-attach-list">${items}</ul></div>`
            : `<p class="muted vessel-docs-empty">No documents attached.</p>`;
        const attachTip = canAttach
            ? 'Attach documents required for this vessel'
            : 'Documents cannot be attached with this account';
        host.innerHTML = `
            <h3 class="wp-title">Documents</h3>
            <div class="wp-job-head">
                <span><b>Ship's Name</b> ${esc(meta.name || '—')}</span>
                <span><b>IMO No</b> ${esc(meta.imo || '—')}</span>
                <span><b>Company ID</b> ${esc(meta.companyId || '—')}</span>
            </div>
            <p class="wp-job-detail">Attach documents required for this vessel.</p>
            <div class="vessel-docs-list">${listHtml}</div>
            <div class="modal-actions wp-modal-actions">
                <div class="wp-modal-actions-left">
                    <button type="button" class="btn" onclick="TVC_App.closeModal('vesselDocsModal')">Close</button>
                </div>
                <div class="wp-modal-actions-right wp-attach-panel">
                    <div class="wr-attach-toolbar">
                        <button type="button" class="wr-attach-btn" onclick="document.getElementById('vesselDocsAttachInput').click()"${canAttach ? '' : ' disabled'} title="${escAttr(attachTip)}">📎 Attachment</button>
                        <input type="file" id="vesselDocsAttachInput" class="hidden" multiple onchange="TVC_App.uploadVesselDocsAttachment()">
                    </div>
                </div>
            </div>`;
    }

    async function openVesselDocsModal(vesselId, companyId) {
        const meta = resolveVesselDocsMeta(vesselId, companyId);
        if (!meta.vesselId) return;
        state._vesselDocsMeta = meta;
        const recId = vesselDocsRecordId(meta.companyId, meta.vesselId);
        let rec = null;
        try {
            rec = await TVC_DB.get('vessel_documents', recId);
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Could not open Documents.');
            return;
        }
        state._vesselDocsRecord = rec && Array.isArray(rec.attachments)
            ? rec
            : emptyVesselDocsRecord(meta);
        renderVesselDocsModal();
        showModal('vesselDocsModal');
    }

    async function uploadVesselDocsAttachment() {
        if (!canEditVesselDocs()) return;
        const input = document.getElementById('vesselDocsAttachInput');
        if (!state._vesselDocsRecord || !input?.files?.length) return;
        const maxBytes = 8 * 1024 * 1024;
        try {
            for (const file of input.files) {
                if (file.size > maxBytes) {
                    await TVC_Dialog.alert(`${file.name}: Only files up to 8 MB can be attached.`);
                    continue;
                }
                const att = await readWrAttachmentFile(file);
                state._vesselDocsRecord.attachments = state._vesselDocsRecord.attachments || [];
                state._vesselDocsRecord.attachments.push(att);
            }
            await persistVesselDocsRecord();
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Attachment failed.');
        }
        input.value = '';
        renderVesselDocsModal();
    }

    async function removeVesselDocsAttachment(attachmentId) {
        if (!canEditVesselDocs() || !state._vesselDocsRecord) return;
        state._vesselDocsRecord.attachments = (state._vesselDocsRecord.attachments || [])
            .filter(a => String(a.id) !== String(attachmentId));
        await persistVesselDocsRecord();
        renderVesselDocsModal();
    }

    function setFleetView(mode) {
        state.fleetView = mode;
        renderFleetList();
    }

    function setFleetSearch(q) {
        state.fleetSearch = (q || '').toLowerCase();
        renderFleetList();
    }

    function setFleetCompanyFilter(value) {
        state.fleetCompanyFilter = String(value || '');
        renderFleetList();
    }

    async function selectVessel(id) {
        const visible = typeof TVC_Fleet.getVisible === 'function'
            ? TVC_Fleet.getVisible(state.user)
            : TVC_Fleet.getAll();
        if (id && !visible.some(v => v.id === id)) return;
        state.selectedVesselId = id;
        TVC_Fleet.select(id);
        // 선택 선박에 맞춰 Run-hour scope 재설정 + 데이터 재로드 → 그 선박의 Import된 정보만 표시
        TVC_PMS.setSpace('HQ', id);
        if (state.user) await populateShipHeader(state.user);
        await loadData();
        renderFleetList();
        rerenderCurrentTab();
    }

    function renderMainMenu() {
        renderCaptainViewDashboard();
        renderFleetList();
        const sidebarCards = document.getElementById('cmaxsCardsSidebar');
        const mainCards = document.getElementById('cmaxsCards');
        document.getElementById('menuMainCol')?.classList.remove('hidden');
        renderMenuCards(mainCards, sidebarCards);
        TVC_OutstandingTasks.render();
    }

    function setHistView(view) {
        state.histView = view;
        document.querySelectorAll('.hist-view-btn').forEach(b => b.classList.toggle('active', b.dataset.hview === view));
        renderSyncHistory();
    }

    /** @deprecated — use setHistView */
    function setHistTab(tab) {
        const map = { all: 'workReport', IMPORT: 'workReport', EXPORT: 'workReport' };
        setHistView(map[tab] || 'workReport');
    }

    function histSyncFilename(row) {
        if (typeof TVC_Filename !== 'undefined' && TVC_Filename.histResolve) {
            return TVC_Filename.histResolve(row);
        }
        return String(row?.filename || row?.file_name || '').trim();
    }

    function histFilenameCellHtml(name) {
        const n = String(name || '').trim();
        if (!n) return '<span class="muted">—</span>';
        return `<span class="menu-hist-file-text" title="${escAttr(n)}">${esc(n)}</span>`;
    }

    function parseDefectFilenameRef(filename) {
        const m = String(filename || '').match(/_DEFECT_(?:URGENT|COMPLETION|REPLY|CLOSE)_([^_]+)_/i);
        return m ? m[1] : '';
    }

    function parsePostponeFilenameRef(filename) {
        const m = String(filename || '').match(/_POSTPONE_(?:REQUEST|REPLY)_([^_]+)_/i);
        return m ? m[1] : '';
    }

    function parseWorkPermitFilenameRef(filename) {
        const legacy = String(filename || '').match(/_WORK_PERMIT_(?:REQUEST|REPLY)_([^_]+)_/i);
        if (legacy) return legacy[1];
        const modern = String(filename || '').match(/^([a-z0-9]+_workpermit_(?:(?:engine|deck)_hq|hq|engine|deck|hub)_\d{8}_\d{3}\.zip)$/i);
        return modern ? modern[1] : '';
    }

    function xferFilenameLookupKey(code) {
        const s = String(code || '').trim();
        if (!s) return [];
        return [s.toUpperCase(), s.replace(/[^\w.-]+/g, '_').toUpperCase()];
    }

    async function buildMenuXferExportFilenameLookup(category) {
        let rows = [];
        try { rows = await TVC_Sync.getHistory(200); } catch (_) {}
        if (typeof TVC_Sync?.isPmsSyncHistoryRow === 'function') {
            rows = rows.filter(r => TVC_Sync.isPmsSyncHistoryRow(r));
        } else {
            rows = rows.filter(r => String(r?.scope || '').toUpperCase() !== 'SPARE');
        }
        const map = {};
        const sorted = rows.slice().sort((a, b) => (a.at || '').localeCompare(b.at || ''));
        for (const r of sorted) {
            if (String(r.type || '').toUpperCase() !== 'EXPORT') continue;
            const fn = histSyncFilename(r);
            if (!fn) continue;
            const d = String(r.direction || '');
            if (category === 'defect') {
                if (!d.startsWith('DEFECT_')) continue;
                const ref = r.ref_key || r.case_no || parseDefectFilenameRef(fn);
                xferFilenameLookupKey(ref).forEach(k => { map[k] = fn; });
                if (fn) map[fn.toLowerCase()] = fn;
            } else if (category === 'workPermit') {
                if (!d.startsWith('WORK_PERMIT_')) continue;
                const ref = r.ref_key || r.filename || r.file_name || parseWorkPermitFilenameRef(fn);
                xferFilenameLookupKey(ref).forEach(k => { map[k] = fn; });
                if (fn) map[fn.toLowerCase()] = fn;
            } else if (category === 'postpone') {
                if (!d.startsWith('POSTPONE_')) continue;
                const ref = r.job_code || r.ref_key || parsePostponeFilenameRef(fn);
                xferFilenameLookupKey(ref).forEach(k => { map[k] = fn; });
            } else if (category === 'monthly') {
                if (d !== 'STATION_TO_HUB' && d !== 'SHIP_TO_HQ') continue;
                const parsed = typeof TVC_Filename !== 'undefined' ? TVC_Filename.parseScoped(fn) : null;
                if (parsed?.type === 'monthly' || /_monthly_/i.test(fn)) map.__monthly__ = fn;
            }
        }
        return map;
    }

    function menuXferRowExportFilename(row, lookup, kind) {
        const st = kind === 'consume'
            ? consumeHistoryFields(row).status
            : kind === 'defect'
                ? TVC_DefectCase.listWorkflowStatus(row)
                : kind === 'workPermit'
                    ? TVC_WorkPermit.listWorkflowStatus(row)
                    : workReportListWorkflowStatus(row);
        const exported = kind === 'defect'
            ? (st === 'Submitted' || row.sync_status === 'SYNCED' || TVC_DefectCase.isHqReplyExported(row))
            : (row.sync_status === 'SYNCED' || st === 'Submitted');
        if (!exported) return histFilenameCellHtml('');
        if (kind === 'monthly') {
            return histFilenameCellHtml(String(lookup?.__monthly__ || '').trim());
        }
        if (kind === 'workPermit' || kind === 'defect') {
            const batchFn = String(row.last_export_filename || '').trim();
            if (batchFn) return histFilenameCellHtml(batchFn);
        }
        const ref = kind === 'defect'
            ? String(row.case_no || '').trim()
            : kind === 'workPermit'
                ? String(row.permit_no || workPermitHistoryColumns(row).jobCode || '').trim()
                : String(postponeHistoryColumns(row).jobCode || '').trim();
        if (!ref) return histFilenameCellHtml('');
        const keys = xferFilenameLookupKey(ref);
        const fn = keys.map(k => lookup?.[k]).find(Boolean) || '';
        return histFilenameCellHtml(fn);
    }

    function histEventDate(row) {
        if (row.at) return row.at.slice(0, 10);
        const raw = String(row.date || '');
        const m = raw.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
        if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
        return raw.slice(0, 10) || '—';
    }

    async function loadSyncHistoryRows() {
        let rows = [];
        try { rows = await TVC_Sync.getHistory(120); } catch (_) {}
        if (typeof TVC_Sync?.isPmsSyncHistoryRow === 'function') {
            rows = rows.filter(r => TVC_Sync.isPmsSyncHistoryRow(r));
        } else {
            rows = rows.filter(r => String(r?.scope || '').toUpperCase() !== 'SPARE');
        }
        if (state.space === 'HQ') rows = rows.filter(r => r.space === 'HQ');
        else rows = rows.filter(r => r.space !== 'HQ');
        if (state.department) rows = rows.filter(r => !r.department || r.department === state.department || r.department === 'ALL');
        if (state.user && TVC_RBAC.isHqAccount(state.user) && state.selectedVesselId) {
            rows = rows.filter(r => !r.vessel_id || r.vessel_id === '—' || r.vessel_id === state.selectedVesselId);
        }
        return rows.sort((a, b) => (b.at || b.date || '').localeCompare(a.at || a.date || ''));
    }

    function renderHistSimpleTable(rows, emptyMsg) {
        const head = document.getElementById('histTableHead');
        const body = document.getElementById('histTableBody');
        if (!head || !body) return;
        head.innerHTML = '<tr><th>No</th><th>Import</th><th>Export</th></tr>';
        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="3" class="muted hist-empty">${esc(emptyMsg)}</td></tr>`;
            return;
        }
        body.innerHTML = rows.map((r, i) => {
            const dt = histEventDate(r);
            const imp = r.type === 'IMPORT' ? dt : '';
            const exp = r.type === 'EXPORT' ? dt : '';
            return `<tr><td>${i + 1}</td><td>${esc(imp)}</td><td>${esc(exp)}</td></tr>`;
        }).join('');
    }

    function renderOutstandingRateView() {
        const head = document.getElementById('histTableHead');
        const body = document.getElementById('histTableBody');
        if (!head || !body) return;
        const jobs = deptJobs();
        const total = jobs.length || 1;
        const overdue = jobs.filter(j => j.is_overdue).length;
        const due30 = jobs.filter(j => !j.is_overdue && daysUntil(j.next_date) <= 30).length;
        const outstanding = overdue + due30;
        const rate = Math.round((outstanding / total) * 1000) / 10;
        head.innerHTML = '<tr><th>No</th><th>Period</th><th>Outstanding Rate</th><th>Overdue</th><th>Due (30d)</th></tr>';
        const today = new Date().toISOString().slice(0, 10);
        body.innerHTML = `
            <tr>
                <td>1</td>
                <td>${esc(today)}</td>
                <td><strong>${rate}%</strong> (${outstanding} / ${total})</td>
                <td>${overdue}</td>
                <td>${due30}</td>
            </tr>
            <tr><td colspan="5" class="muted hist-empty">최신 기준 Work Plan 집계 — 부서 필터 적용</td></tr>`;
    }

    /** Import & Export History — Work Report / Original Plan / Outstanding Rate 뷰 */
    async function renderSyncHistory() {
        const body = document.getElementById('histTableBody');
        if (!body) return;
        const rows = await loadSyncHistoryRows();
        const view = state.histView || 'workReport';

        if (view === 'workReport') {
            renderHistSimpleTable(rows, 'No sync history for this department yet');
            return;
        }
        if (view === 'originalPlan') {
            const planRows = rows.filter(r =>
                r.direction === 'HQ_TO_SHIP'
                || (r.type === 'EXPORT' && (r.direction === 'SHIP_TO_HQ' || r.direction === 'STATION_TO_HUB'))
            );
            renderHistSimpleTable(planRows, 'No Original Plan sync history for this department yet');
            return;
        }
        if (view === 'outstandingRate') {
            renderOutstandingRateView();
        }
    }

    /** 메뉴 카드 클릭 → 해당 탭 전환 + 필터 적용 (switchTab과 완전 결합) */
    function menuNavigate(tab, opts = {}) {
        if (opts.actualFilter) {
            state.actualFilter = opts.actualFilter;
        }
        if (opts.historyFilter && state.listFilters?.history) {
            Object.assign(state.listFilters.history, {
                groupKeys: [],
                type: 'all',
                openOnly: false,
                noClosedOut: false,
                postponeAwaitingApproval: false,
                awaitingShipConfirm: false,
                ...opts.historyFilter,
            });
        }
        switchTab(tab);
        if (opts.actualFilter && state.currentTab === 'actual') updateActualFilterUI();
        if (tab === 'history') TVC_ListFilters?.syncBtn?.('history');
    }

    async function menuAction(action) {
        switch (action) {
            case 'checkPlan': menuNavigate('actual', { actualFilter: 'overdue' }); break;
            case 'checkCritical': menuNavigate('actual', { actualFilter: 'critical' }); break;
            case 'inputReport': menuNavigate('actual', { actualFilter: 'total' }); break;
            case 'approveReport':
                if (TVC_RBAC.isHqAccount(state.user)) {
                    openHqApproveReports();
                    break;
                }
                menuNavigate('history');
                break;
            case 'hqConfirm': menuNavigate('history'); break;
            case 'runHour':
                if (!runningHoursMenuVisible()) break;
                openRunHoursModal();
                break;
            case 'approveOriginalPlan':
                approveWorkPlanFromHq();
                break;
            case 'originalPlan':
                if (typeof TVC_Space !== 'undefined' && !TVC_Space.getUiFeatures(state.user).showUpdateWorkPlan) {
                    await TVC_Dialog.alert('Update Work Plan requires Chief Engineer, Chief Officer, or Captain permission.');
                    return;
                }
                if (rhUpdateGateApplies() && !isRhUpdateCommitted()) {
                    await TVC_Dialog.alert('Complete Running Hours Update first.');
                    return;
                }
                if (!canPerformOriginalPlanUpdate()) {
                    await TVC_Dialog.alert(getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan Update is not available.');
                    return;
                }
                updateOriginalPlanFromRunHours({ fromMenu: true });
                break;
            case 'companyComment': menuNavigate('actual'); break;
            case 'modifyItem':
                if (!canEditOriginalPlanItems()) {
                    await TVC_Dialog.alert(origPlanEditDeniedMessage());
                    return;
                }
                menuNavigate('actual', { actualFilter: 'total' });
                break;
            case 'export': handleExport(); break;
            case 'stationExport': handleStationExport(); break;
            case 'hubImport': document.getElementById('importStation')?.click(); break;
            case 'companyExport': handleCompanyExport(); break;
            case 'import':
                pickDepartmentThen('Select a department to import (DECK / ENGINE)', (dept) => {
                    if (!dept) return;
                    state._pendingImportDept = dept;
                    document.getElementById('importZip').click();
                });
                break;
            case 'backup': openMasterBackupModal('pms'); break;
            case 'defectReport':
                openNewDefectReportInput();
                break;
            case 'workPermitList':
                TVC_WorkPermitReport.openListModal();
                break;
            case 'approveWorkPermit':
                TVC_WorkPermitReport.openListModal();
                break;
            case 'confirmReport':
            case 'confirmDefectReport':
            case 'confirmPostponeReport':
                openShipConfirmHistory('all');
                break;
            case 'approveReports':
                openHqApproveReports();
                break;
            case 'approveDefectReport':
                openHqApproveDefectReport();
                break;
            case 'approvePostponeReport':
                openHqApprovePostponeReport();
                break;
            case 'defectInbox':
                switchTab('history');
                break;
            case 'defectImport':
                document.getElementById('importDefectUrgent')?.click();
                break;
            case 'password': TVC_Settings.open('password'); break;
            case 'control': await TVC_Dialog.alert('Control (permission) changes apply after administrator approval.'); break;
            default: break;
        }
    }

    // ── Plan update & item edit (Work Plan tab) ────────────────────
    let _planCalcTimer = null;
    let _planUpdateSnapshot = null;
    const PLAN_CALC_MS = 5000;

    function getPlanLockDept() {
        if (state.user && TVC_RBAC.isHqAccount(state.user)) return state.department || null;
        if (isMasterHubMode()) return state.department || null;
        return state.user?.department || state.department || null;
    }

    function rhUpdateGateApplies() {
        if (!state.user) return true;
        if (isMasterHubMode()) return false;
        return !(typeof TVC_Space !== 'undefined' && TVC_Space.isDeckVesselMode(state.user));
    }

    async function loadOriginalPlanLock() {
        try {
            const raw = await TVC_DB.getMeta(TVC_META_KEYS.ORIGINAL_PLAN_LOCK);
            state._originalPlanLock = raw ? JSON.parse(raw) : {};
        } catch {
            state._originalPlanLock = {};
        }
    }

    function isOriginalPlanUpdateLocked(dept) {
        if (isMasterHubMode()) return false;
        if (state.user && TVC_RBAC.isHqAccount(state.user)) return false;
        dept = dept || getPlanLockDept();
        if (!dept) return false;
        return !!state._originalPlanLock?.[dept]?.locked;
    }

    function canPerformOriginalPlanUpdate() {
        if (!state.user) return false;
        if (isMasterHubMode()) return false;
        if (TVC_RBAC.isHqAccount(state.user)) return true;
        const dept = getPlanLockDept();
        if (!dept) return false;
        return !isOriginalPlanUpdateLocked(dept);
    }

    function getOriginalPlanLockMessage(dept) {
        dept = dept || getPlanLockDept();
        const lock = state._originalPlanLock?.[dept];
        if (!lock?.locked) return '';
        const at = lock.confirmed_at
            ? new Date(lock.confirmed_at).toLocaleDateString('en-GB')
            : (lock.month || '');
        return `Original Plan was confirmed on ${at}. Import HQ review data (HQ→Ship) to Update again.`;
    }

    async function lockOriginalPlanUpdate(dept, shipCode, stats) {
        dept = dept || getPlanLockDept();
        if (!dept) return;
        const now = new Date();
        const locks = { ...(state._originalPlanLock || {}) };
        locks[dept] = {
            locked: true,
            month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
            confirmed_at: now.toISOString(),
            ship_code: shipCode || 'TVC',
            stats,
        };
        state._originalPlanLock = locks;
        await TVC_DB.setMeta(TVC_META_KEYS.ORIGINAL_PLAN_LOCK, JSON.stringify(locks));
    }

    async function unlockOriginalPlanForDept(dept) {
        dept = dept || getPlanLockDept();
        if (!dept) return;
        const locks = { ...(state._originalPlanLock || {}) };
        if (!locks[dept]?.locked) return;
        locks[dept] = {
            ...locks[dept],
            locked: false,
            unlocked_at: new Date().toISOString(),
            unlocked_by: 'HQ_IMPORT',
        };
        state._originalPlanLock = locks;
        await TVC_DB.setMeta(TVC_META_KEYS.ORIGINAL_PLAN_LOCK, JSON.stringify(locks));
    }

    function getPlanMenuLockMessage() {
        if (rhUpdateGateApplies() && !isRhUpdateCommitted()) {
            return 'Complete Running Hours Update first.';
        }
        return getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan Update is not available.';
    }

    function syncPlanUpdateUi() {
        const isHq = !!(state.user && TVC_RBAC.isHqAccount(state.user));
        const dept = getPlanLockDept();
        const planLocked = isOriginalPlanUpdateLocked(dept);
        const rhLocked = !isHq && rhUpdateGateApplies() && !isRhUpdateCommitted();
        const locked = planLocked || rhLocked;
        syncPlanItemUi();
        const msgEl = document.getElementById('actPlanCalcMsg');
        if (msgEl && locked && !state._planCalcMsg) {
            msgEl.textContent = rhLocked
                ? 'Complete Running Hours Update first.'
                : getOriginalPlanLockMessage(dept);
            msgEl.classList.remove('hidden');
        }
    }

    function origPlanEditDeniedMessage() {
        return 'Modify, append, and delete require Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission.';
    }

    /** PMS job Modify / Append / Delete — not blocked by Original Plan lock or RH gate (master data). */
    function canEditOriginalPlanItems() {
        if (!state.user) return false;
        return TVC_RBAC.canModifyOriginalPlan(state.user);
    }

    /** Work Procedure text — CE/Captain/HQ; not blocked by Original Plan lock */
    function canEditWorkProcedure() {
        if (!state.user) return false;
        return TVC_RBAC.canModifyOriginalPlan(state.user);
    }

    function workProcedureEditDeniedMessage() {
        if (state.user && TVC_RBAC.isShipAccount(state.user) && !TVC_RBAC.isApprover(state.user)) {
            return 'Only Captain or Chief Engineer can edit the Work Procedure.';
        }
        return 'You do not have permission to edit the Work Procedure.';
    }

    /** PMS/SPARE Master Excel — plan lock과 무관, ce/co/captain/hq + 부서 토글(DECK|ENGINE) 필수 */
    function canPmsMasterExcel() {
        if (!state.user) return false;
        return TVC_RBAC.canModifyOriginalPlan(state.user);
    }

    function canSpareMasterExcel() {
        if (!state.user) return false;
        if (TVC_RBAC.isHqAccount(state.user)) return TVC_RBAC.canModifyOriginalPlan(state.user);
        return TVC_RBAC.isMaintPlanEditor(state.user) && TVC_RBAC.canModifySpareInventory(state.user);
    }

    function pmsMasterExcelDeniedMessage() {
        return 'PMS Master Export · Import requires Chief Engineer, Chief Officer, Captain (Master), or HQ Superintendent.';
    }

    function spareMasterExcelDeniedMessage() {
        return 'SPARE Master Export · Import requires Chief Engineer, Chief Officer, Captain (Master), or HQ Superintendent.';
    }

    function selectedGroupNode() {
        if (!state.selectedGroupKey || state.selectedGroupKey === CRITICAL_GROUP_KEY || !state.idx) return null;
        return state.idx.groupNodes.find(n => n.key === state.selectedGroupKey) || null;
    }

    function canEditPlanGroupHeader() {
        if (!state.user) return false;
        return TVC_RBAC.canModifyOriginalPlan(state.user);
    }

    function syncPlanGroupTreeUi() {
        const canEdit = canEditPlanGroupHeader();
        ['actPlanTreeModifyBtn', 'actPlanTreeAppendBtn', 'actPlanTreeDeleteBtn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('hidden', !canEdit);
        });
        const node = selectedGroupNode();
        const delBtn = document.getElementById('actPlanTreeDeleteBtn');
        const blockDelete = !node || state.selectedGroupKey === CRITICAL_GROUP_KEY
            || state.selectedGroupKey === TVC_SpareMenu?.MERGED_GEN_ENGINE_KEY;
        if (delBtn) delBtn.disabled = blockDelete;
    }

    function syncPlanGroupUi() {
        const bar = document.getElementById('actTreeActions');
        if (bar) bar.classList.add('hidden');
    }

    function renderGroupEditor(mode) {
        const host = document.getElementById('groupEditorBody');
        if (!host) return;
        const node = selectedGroupNode();
        const isRename = mode === 'rename';
        const dept = node?.department || state.department || 'ENGINE';
        const depts = ['DECK', 'ENGINE'];
        const deptField = isRename
            ? `<label>Department<input value="${esc(dept)}" readonly class="wr-ro"></label>`
            : `<label>Department<select name="department">${depts.map(d =>
                `<option value="${d}"${d === dept ? ' selected' : ''}>${d}</option>`).join('')}</select></label>`;
        host.innerHTML = `
            <h3>${isRename ? '✏️ Rename GROUP' : '➕ Add GROUP'}</h3>
            <p class="muted group-editor-hint">${isRename
                ? '선택한 GROUP 이름을 변경합니다. 해당 GROUP의 모든 작업 항목에 반영됩니다.'
                : '새 GROUP을 추가합니다. 이후 Append로 작업 항목을 등록할 수 있습니다.'}</p>
            <form class="orig-job-form" id="groupEditorForm" onsubmit="event.preventDefault();TVC_App.saveGroupEditor()">
                ${deptField}
                ${isRename ? `<label class="span2">Current Name<input value="${esc(node?.label || '')}" readonly class="wr-ro"></label>` : ''}
                <label class="span2">${isRename ? 'New Name' : 'GROUP Name'}
                    <input name="label" required placeholder="예: 06. AUX BOILER" value="${isRename ? '' : ''}">
                </label>
                <div class="orig-job-actions span2">
                    <button type="button" class="btn" onclick="TVC_App.closeModal('groupEditorModal')">Cancel</button>
                    <button type="submit" class="btn btn-green">${isRename ? 'Rename' : 'Add'}</button>
                </div>
            </form>`;
        state._groupEditMode = mode;
    }

    async function openOrigGroupAdd() {
        if (!canEditPlanGroupHeader()) await TVC_Dialog.alert('Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission required.');
        renderGroupEditor('add');
        showModal('groupEditorModal');
    }

    async function openOrigGroupRename() {
        if (!canEditPlanGroupHeader()) await TVC_Dialog.alert('Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission required.');
        const node = selectedGroupNode();
        if (!node) await TVC_Dialog.alert('Select a group in PMS GROUP Tree.');
        renderGroupEditor('rename');
        showModal('groupEditorModal');
    }

    async function deleteOrigGroup() {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !canEditPlanGroupHeader()) await TVC_Dialog.alert('Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission required.');
        const node = selectedGroupNode();
        if (!node) await TVC_Dialog.alert('Select a group to delete.');
        if (state.selectedGroupKey === CRITICAL_GROUP_KEY
            || state.selectedGroupKey === TVC_SpareMenu?.MERGED_GEN_ENGINE_KEY) {
            await TVC_Dialog.alert('This group cannot be deleted.');
        }
        if (!await TVC_Dialog.confirm({ message: `Delete GROUP "${node.label}"?\n\nOnly empty groups (no jobs, no spare parts) can be deleted.` })) return;
        try {
            await TVC_MaintenancePlan.deleteGroup(user, node.department, node.label, masterVesselOpts());
            state.selectedGroupKey = null;
            await refreshAll();
            await TVC_Dialog.alert('Group deleted.');
        } catch (e) {
            const code = e.code || '';
            if (code === 'HAS_JOBS') await TVC_Dialog.alert(`Cannot delete: ${e.count || ''} maintenance job(s) in this group.`);
            if (code === 'HAS_SPARES') await TVC_Dialog.alert(`Cannot delete: spare parts exist in this group.`);
            await TVC_Dialog.alert(e.message || code || 'Delete failed');
        }
    }

    async function saveGroupEditor() {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !canEditPlanGroupHeader()) {
            await TVC_Dialog.alert('Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission required.');
            return;
        }
        const form = document.getElementById('groupEditorForm');
        if (!form) return;
        const fd = new FormData(form);
        const label = String(fd.get('label') || '').trim();
        if (!label) {
            await TVC_Dialog.alert('Enter a GROUP name.');
            return;
        }
        try {
            if (state._groupEditMode === 'rename') {
                const node = selectedGroupNode();
                if (!node) {
                    await TVC_Dialog.alert('Select a GROUP.');
                    return;
                }
                const { newKey } = await TVC_MaintenancePlan.renameGroup(
                    user, node.department, node.label, label, masterVesselOpts()
                );
                closeModal('groupEditorModal');
                await refreshAll();
                state.selectedGroupKey = newKey;
                await TVC_Dialog.alert(`GROUP renamed to "${label}".`);
            } else {
                const dept = String(fd.get('department') || state.department || 'ENGINE').trim();
                const row = await TVC_MaintenancePlan.createGroup(user, dept, label, masterVesselOpts());
                closeModal('groupEditorModal');
                await refreshAll();
                state.selectedGroupKey = TVC_MaintenancePlan.groupKeyOf(row.department, row.label);
                await TVC_Dialog.alert(`GROUP "${label}" was added.`);
            }
        } catch (e) {
            const code = e.code || '';
            if (code === 'DUPLICATE') {
                await TVC_Dialog.alert('A GROUP with the same name already exists in this department.');
                return;
            }
            await TVC_Dialog.alert(e.message || code || 'Save failed');
        }
    }

    function syncPlanItemUi() {
        const canShow = !!(state.user && TVC_RBAC.isMaintPlanEditor?.(state.user));
        const canEdit = canEditOriginalPlanItems();
        const hasSel = !!planEditTargetJobId();
        let tip = '';
        if (!canEdit) {
            tip = origPlanEditDeniedMessage();
        }

        const mod = document.getElementById('actModifyBtn');
        const app = document.getElementById('actAppendBtn');
        const del = document.getElementById('actDeleteBtn');
        const pmsEx = document.getElementById('actPmsMasterExportBtn');
        const pmsIm = document.getElementById('actPmsMasterImportBtn');

        [mod, app, del].forEach(el => el?.classList.toggle('hidden', !canShow));
        const canMaster = canPmsMasterExcel();
        [pmsEx, pmsIm].forEach(el => el?.classList.toggle('hidden', !canMaster));

        if (!canShow && !canMaster) return;

        if (mod) {
            mod.disabled = !canEdit || (!hasSel && !isOrigJobInlineEditing());
            mod.title = !canEdit ? tip : ((!hasSel && !isOrigJobInlineEditing()) ? '수정할 행을 선택하세요' : '');
        }
        if (app) {
            app.disabled = !canEdit || (isOrigJobInlineEditing() && !canEdit);
            app.title = !canEdit ? tip : '';
        }
        if (del) {
            del.disabled = !canEdit || !hasSel;
            del.title = !canEdit ? tip : (!hasSel ? '삭제할 행을 선택하세요' : '');
        }
        if (pmsEx) {
            pmsEx.disabled = !canMaster;
            pmsEx.title = canMaster ? 'PMS Master Excel Export → tvcno1_pms_master_YYYYMMDD_001.xlsx' : pmsMasterExcelDeniedMessage();
        }
        if (pmsIm) {
            pmsIm.disabled = !canMaster;
            pmsIm.title = canMaster ? 'PMS Master Excel Import (tvcno1_pms_master_YYYYMMDD_001.xlsx)' : pmsMasterExcelDeniedMessage();
        }
    }

    const ORIG_PIC_BY_DEPT = {
        ENGINE: ['C/E', '1/E', '2/E', '3/E'],
        DECK: ['Captain', 'C/O', '2/O(A)', '2/O(B)', '3/O'],
    };

    function origPicOptions(dept, selected) {
        const d = String(dept || 'ENGINE').toUpperCase();
        const list = ORIG_PIC_BY_DEPT[d] || ORIG_PIC_BY_DEPT.ENGINE;
        const sel = String(selected || '').trim();
        let html = '<option value="">—</option>';
        if (sel && !list.includes(sel)) {
            html += `<option value="${escAttr(sel)}" selected>${esc(sel)}</option>`;
        }
        html += list.map(p => `<option value="${escAttr(p)}"${p === sel ? ' selected' : ''}>${esc(p)}</option>`).join('');
        return html;
    }

    function origJobPicSelect(id, dept, value) {
        return `<select class="spare-inline-input orig-inline-pic" id="${id}" onclick="event.stopPropagation()">${origPicOptions(dept, value)}</select>`;
    }

    function origGroupOptions(dept, selected) {
        const groups = new Set();
        (state.idx?.groupNodes || [])
            .filter(n => !dept || n.department === dept)
            .forEach(n => groups.add(n.label));
        (state.groups || []).filter(g => !dept || g.department === dept).forEach(g => {
            if (g.label) groups.add(g.label.trim());
        });
        state.jobs.filter(j => !dept || j.department === dept).forEach(j => {
            if (j.group) groups.add(j.group.trim());
        });
        if (selected) groups.add(selected);
        if (!groups.size) groups.add('UNGROUPED');
        return [...groups].sort().map(g =>
            `<option value="${escAttr(g)}"${g === selected ? ' selected' : ''}>${esc(g)}</option>`
        ).join('');
    }

    function origJobGroupCriticalLabel(group, department) {
        if (!group || !TVC_SpareMenu) return '';
        if (TVC_SpareMenu.effectiveGroupCriticalEquipment) {
            return TVC_SpareMenu.effectiveGroupCriticalEquipment(state, group, department, 'pms') || '';
        }
        return TVC_SpareMenu.isGroupCriticalEquipmentYes?.(state, group) ? 'Yes' : '';
    }

    function jobEquipmentDraftValue(job) {
        if (TVC_SpareMenu?.resolveJobEquipment) {
            return TVC_SpareMenu.resolveJobEquipment(state, job).equipment;
        }
        const eq = String(job?.equipment || '').trim();
        if (eq) return eq;
        const sort1 = String(job?.item_sort1 || '').trim();
        if (!sort1) return '';
        const names = TVC_SpareMenu?.equipmentNamesForGroup?.(state, job.group, 'pms') || [];
        return names.includes(sort1) ? sort1 : '';
    }

    function getOrigJobInlineEquipmentDraft() {
        const m = origJobInlineState();
        if (!m.editId || !m.draft) return null;
        return {
            pmsGroupNo: m.draft.group || '',
            equipment: m.draft.equipment || '',
            itemSort1: m.draft.item_sort1 || '',
            maker: m.draft.maker ?? '',
            modelType: m.draft.modelType ?? '',
            capacity: m.draft.capacity ?? '',
            serialNo: m.draft.serialNo ?? '',
            criticalEquipment: m.draft.criticalEquipment
                || origJobGroupCriticalLabel(m.draft.group, m.draft.department),
        };
    }

    function origJobInlineState() {
        state._origJobInline = state._origJobInline || { editId: null, mode: null, draft: null };
        return state._origJobInline;
    }

    function isOrigJobInlineEditing() {
        return !!origJobInlineState().editId;
    }

    function origJobCellInput(id, value, extraClass = '', onChange = '') {
        const cls = ['spare-inline-input', extraClass].filter(Boolean).join(' ');
        const changeAttr = onChange ? ` onchange="${onChange}"` : '';
        return `<input class="${cls}" id="${id}" value="${esc(String(value ?? ''))}"${changeAttr} onclick="event.stopPropagation()">`;
    }

    function parseJobCodeBlockParts(group, eqNo) {
        const prefixMatch = String(group || '').match(/^(\d+)/);
        const g = prefixMatch ? prefixMatch[1].padStart(2, '0') : '';
        const ee = Math.max(0, parseInt(String(eqNo ?? 0), 10) || 0);
        return { g, ee };
    }

    function formatPmsJobCodeLocal(g, ee, itemNo) {
        if (TVC_PmsMasterExcel?.formatPmsJobCode) return TVC_PmsMasterExcel.formatPmsJobCode(g, ee, itemNo);
        return `${g}-${String(ee).padStart(2, '0')}-${String(itemNo).padStart(3, '0')}`;
    }

    function parsePmsJobCodeLocal(code) {
        if (TVC_PmsMasterExcel?.parsePmsJobCode) return TVC_PmsMasterExcel.parsePmsJobCode(code);
        const m = String(code || '').match(/^(\d{1,2})-(\d{2})-(\d{1,3})$/);
        if (!m) return null;
        return {
            valid: true,
            groupNo: m[1].padStart(2, '0'),
            equipNo: parseInt(m[2], 10),
            itemNo: parseInt(m[3], 10),
        };
    }

    function usedJobItemNosInBlock(group, dept, eqNo, excludeJobId) {
        const { g, ee } = parseJobCodeBlockParts(group, eqNo);
        const used = new Set();
        if (!g) return used;
        state.jobs.forEach(j => {
            if (excludeJobId && String(j.id) === String(excludeJobId)) return;
            if (dept && j.department !== dept) return;
            const p = parsePmsJobCodeLocal(j.job_code);
            if (p?.valid && p.groupNo === g && p.equipNo === ee) used.add(p.itemNo);
        });
        return used;
    }

    function jobCodeMatchesBlock(code, group, eqNo) {
        const { g, ee } = parseJobCodeBlockParts(group, eqNo);
        if (!g || !code) return false;
        const p = parsePmsJobCodeLocal(code);
        return !!(p?.valid && p.groupNo === g && p.equipNo === ee);
    }

    function listJobCodeOptions(group, dept, eqNo, currentCode, excludeJobId, maxOptions = 40) {
        const { g, ee } = parseJobCodeBlockParts(group, eqNo);
        if (!g) return currentCode ? [{ code: currentCode }] : [];
        const used = usedJobItemNosInBlock(group, dept, eqNo, excludeJobId);
        const options = [];
        const seen = new Set();
        const add = (code) => {
            if (!code || seen.has(code)) return;
            seen.add(code);
            options.push({ code });
        };
        if (currentCode && jobCodeMatchesBlock(currentCode, group, eqNo)) add(currentCode);
        for (let n = 1; options.length < maxOptions && n <= 999; n++) {
            if (used.has(n)) continue;
            add(formatPmsJobCodeLocal(g, ee, n));
        }
        if (!options.length) add(suggestNextJobCode(group, dept, eqNo));
        return options;
    }

    function renderOrigJobCodeSelect(draft) {
        const m = origJobInlineState();
        const excludeId = m.mode === 'modify' ? m.editId : null;
        const eqNo = draft.equipment && TVC_SpareMenu?.equipmentNoForName
            ? TVC_SpareMenu.equipmentNoForName(state, draft.group, draft.equipment, 'pms')
            : 0;
        const opts = listJobCodeOptions(draft.group, draft.department, eqNo, draft.job_code, excludeId);
        const cur = draft.job_code || opts[0]?.code || '';
        if (!opts.length) return origJobCellInput('oie_code', cur);
        return `<select class="spare-inline-input orig-inline-code" id="oie_code" onclick="event.stopPropagation()">${opts.map(o =>
            `<option value="${escAttr(o.code)}"${o.code === cur ? ' selected' : ''}>${esc(o.code)}</option>`
        ).join('')}</select>`;
    }

    function refreshOrigJobCodeCell(draft) {
        const cell = document.querySelector('.orig-job-inline-table tbody .c-code');
        if (!cell || !draft) return;
        cell.innerHTML = renderOrigJobCodeSelect(draft);
    }

    function origJobCellDate(id, value) {
        const v = esc(String(value ?? '').slice(0, 10));
        return `<input type="text" class="spare-inline-input orig-inline-date tvc-date-input" id="${id}" value="${v}" placeholder="YYYY-MM-DD" autocomplete="off" onclick="event.stopPropagation()">`;
    }

    function refreshActJobEditBlock() {
        const host = document.getElementById('actJobEditBlock');
        if (!host) return;
        host.innerHTML = renderOrigJobInlineEditHtml();
        TVC_PWA?.initDateInputFormat?.(host);
    }

    function renderOrigJobInlineEditHtml() {
        const m = origJobInlineState();
        if (!m.editId || !m.draft) return '';
        const r = m.draft;
        const isNew = m.editId === NEW_ORIG_JOB_EDIT_ID;
        const panelHead = isNew ? '➕ Append maintenance item' : '✏️ Editing maintenance item';
        const dept = r.department || state.user?.department || state.department || 'ENGINE';
        const units = ['M', 'W', 'D', 'H', 'Y'];
        const unitSelect = `<select class="spare-inline-input orig-inline-unit" id="oie_unit" onclick="event.stopPropagation()">${units.map(u => `<option ${(r.unit || 'M') === u ? 'selected' : ''}>${u}</option>`).join('')}</select>`;
        const groupSelect = `<select class="spare-inline-input spare-inline-input-wide" id="oie_group" onchange="TVC_App.syncOrigJobInlineHeader()" onclick="event.stopPropagation()">${origGroupOptions(dept, r.group)}</select>`;
        const codeCell = renderOrigJobCodeSelect(r);
        const colgroup = '<colgroup><col style="width:32px"><col style="width:56px"><col style="width:72px"><col><col><col><col style="width:100px"><col style="width:80px"><col style="width:130px"><col style="width:130px"></colgroup>';
        return `<section class="spare-item-edit-panel orig-job-inline-panel" aria-label="Maintenance job edit">
            <div class="spare-item-edit-head">${panelHead}</div>
            <div class="orig-job-inline-meta">
                <span class="orig-job-inline-meta-label">GROUP</span>
                ${groupSelect}
            </div>
            <div class="spare-item-edit-table-wrap">
                <table class="spare-data-table spare-item-edit-table orig-job-inline-table">
                    ${colgroup}
                    <thead><tr>
                        <th class="c-chk" aria-hidden="true"></th>
                        <th class="c-crit" title="Critical Equipment">⚠</th>
                        <th class="c-code">JOB CODE</th>
                        <th class="c-s1">SORT-1</th>
                        <th class="c-d1">SORT-2</th>
                        <th class="c-d2">JOB DETAIL</th>
                        <th class="c-per">PERIOD</th>
                        <th class="c-pic">P.I.C</th>
                        <th class="c-next">NEXT DATE</th>
                        <th class="c-last">LAST DONE</th>
                    </tr></thead>
                    <tbody><tr class="spare-row-editing">
                        <td class="c-chk"></td>
                        <td class="c-crit">${origJobCriticalSelect('oie_critical', r.is_critical_equipment)}</td>
                        <td class="c-code">${codeCell}</td>
                        <td class="c-s1">${origJobCellInput('oie_sort1', r.item_sort1, '', 'TVC_App.syncOrigJobInlineHeader()')}</td>
                        <td class="c-d1">${origJobCellInput('oie_sort2', r.item_sort2)}</td>
                        <td class="c-d2">${origJobCellInput('oie_detail', r.job_detail, 'spare-inline-input-wide')}</td>
                        <td class="c-per"><span class="orig-inline-period">${origJobCellInput('oie_period', r.period, 'spare-inline-input-num')}${unitSelect}</span></td>
                        <td class="c-pic">${origJobPicSelect('oie_pic', dept, r.pic)}</td>
                        <td class="c-next">${origJobCellDate('oie_next', r.next_date)}</td>
                        <td class="c-last">${origJobCellDate('oie_last', r.last_done)}</td>
                    </tr></tbody>
                </table>
            </div>
            <div class="spare-item-edit-actions">
                <button type="button" class="btn btn-sm btn-green" onclick="TVC_App.saveOrigJobInlineEdit()">💾 Save</button>
                <button type="button" class="btn btn-sm" onclick="TVC_App.cancelOrigJobInlineEdit()">Cancel</button>
            </div>
        </section>`;
    }

    function startOrigJobInlineEdit(job) {
        const scrollTop = captureActListScroll();
        if (TVC_SpareMenu?.cancelGroupHeaderEdit) TVC_SpareMenu.cancelGroupHeaderEdit();
        const equipment = jobEquipmentDraftValue(job);
        const hdr = resolveOrigJobHeaderDraft({ ...job, equipment });
        const m = origJobInlineState();
        m.editId = job.id;
        m.mode = 'modify';
        m.draft = {
            department: job.department,
            job_code: job.job_code || '',
            group: (job.group || '').trim(),
            sort: job.sort || '',
            item_sort1: job.item_sort1 || '',
            item_sort2: job.item_sort2 || '',
            job_detail: job.job_detail || '',
            period: String(job.period ?? 1),
            unit: job.unit || 'M',
            pic: job.pic || '',
            next_date: (job.next_date || '').slice(0, 10),
            last_done: (job.last_done || '').slice(0, 10),
            is_critical_equipment: jobCriticalEditValue(job),
            equipment,
            maker: hdr.maker || '',
            modelType: hdr.modelType || '',
            capacity: hdr.capacity || '',
            serialNo: hdr.serialNo || '',
            criticalEquipment: origJobGroupCriticalLabel((job.group || '').trim(), job.department),
        };
        state._origJobEditMode = 'modify';
        state._origJobEditId = job.id;
        refreshActJobEditBlock();
        renderPlanGroupHeader();
        syncPlanItemUi();
        restoreActListScroll(scrollTop);
    }

    function resolveOrigJobHeaderDraft(jobLike) {
        return TVC_SpareMenu?.resolveWrJobHeader?.(state, jobLike) || {};
    }

    function syncOrigJobInlineHeader() {
        const m = origJobInlineState();
        if (!m.editId || !m.draft) return;
        const g = (id) => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
        const prevGroup = m.draft.group || '';
        const prevEquipment = m.draft.equipment || '';
        const group = g('oie_group') || prevGroup;
        let equipment = g('oie_equipment');
        if (document.getElementById('oie_equipment') == null) equipment = m.draft.equipment || '';
        const sort1 = g('oie_sort1') || m.draft.item_sort1 || '';
        if (group !== prevGroup) {
            const names = TVC_SpareMenu?.equipmentNamesForGroup?.(state, group, 'pms') || [];
            if (equipment && !names.includes(equipment)) equipment = '';
        }
        const eqNo = equipment && TVC_SpareMenu?.equipmentNoForName
            ? TVC_SpareMenu.equipmentNoForName(state, group, equipment, 'pms')
            : 0;
        let jobCode = g('oie_code') || m.draft.job_code || '';
        const blockChanged = group !== prevGroup || equipment !== prevEquipment;
        if (blockChanged || !jobCodeMatchesBlock(jobCode, group, eqNo)) {
            if (m.mode === 'append' || !jobCodeMatchesBlock(jobCode, group, eqNo)) {
                jobCode = suggestNextJobCode(group, m.draft.department, eqNo);
            }
        }
        const hdr = resolveOrigJobHeaderDraft({
            department: m.draft.department,
            group,
            item_sort1: sort1,
            equipment,
        });
        const groupCrit = origJobGroupCriticalLabel(group, m.draft.department);
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        set('oie_maker', hdr.maker);
        set('oie_modelType', hdr.modelType);
        set('oie_capacity', hdr.capacity);
        set('oie_serialNo', hdr.serialNo);
        const critEl = document.getElementById('oie_group_critical');
        if (critEl) {
            const label = groupCrit || '—';
            critEl.textContent = label;
            critEl.classList.toggle('empty', label === '—');
        }
        m.draft.group = group;
        m.draft.equipment = equipment;
        m.draft.item_sort1 = sort1;
        m.draft.job_code = jobCode;
        m.draft.maker = hdr.maker || '';
        m.draft.modelType = hdr.modelType || '';
        m.draft.capacity = hdr.capacity || '';
        m.draft.serialNo = hdr.serialNo || '';
        m.draft.criticalEquipment = groupCrit;
        if (group !== prevGroup) renderPlanGroupHeader();
        refreshOrigJobCodeCell(m.draft);
        const codeEl = document.getElementById('oie_code');
        if (codeEl) codeEl.value = jobCode;
    }

    function startOrigJobInlineAppend() {
        const scrollTop = captureActListScroll();
        if (TVC_SpareMenu?.cancelGroupHeaderEdit) TVC_SpareMenu.cancelGroupHeaderEdit();
        const ctx = defaultAppendContext();
        const hdr = resolveOrigJobHeaderDraft({ department: ctx.dept, group: ctx.group });
        const m = origJobInlineState();
        m.editId = NEW_ORIG_JOB_EDIT_ID;
        m.mode = 'append';
        m.draft = {
            department: ctx.dept,
            job_code: ctx.job_code,
            group: ctx.group,
            sort: '',
            item_sort1: '',
            item_sort2: '',
            job_detail: '',
            period: '1',
            unit: 'M',
            pic: '',
            next_date: '',
            last_done: '',
            is_critical_equipment: '',
            equipment: ctx.equipment || '',
            maker: hdr.maker || '',
            modelType: hdr.modelType || '',
            capacity: hdr.capacity || '',
            serialNo: hdr.serialNo || '',
            criticalEquipment: origJobGroupCriticalLabel(ctx.group, ctx.dept),
        };
        state._origJobEditMode = 'append';
        state._origJobEditId = null;
        refreshActJobEditBlock();
        renderPlanGroupHeader();
        syncPlanItemUi();
        restoreActListScroll(scrollTop);
    }

    function cancelOrigJobInlineEdit(opts = {}) {
        const scrollTop = captureActListScroll();
        const m = origJobInlineState();
        m.editId = null;
        m.mode = null;
        m.draft = null;
        refreshActJobEditBlock();
        renderPlanGroupHeader();
        syncPlanItemUi();
        if (opts.restoreScroll !== false) restoreActListScroll(scrollTop);
    }

    function readOrigJobInlineForm() {
        const g = (id) => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
        const m = origJobInlineState();
        return {
            job_code: g('oie_code'),
            group: g('oie_group'),
            sort: m.draft?.sort || '',
            item_sort1: g('oie_sort1'),
            item_sort2: g('oie_sort2'),
            job_detail: g('oie_detail'),
            period: g('oie_period'),
            unit: g('oie_unit'),
            pic: g('oie_pic'),
            next_date: g('oie_next'),
            last_done: g('oie_last'),
            is_critical_equipment: g('oie_critical'),
            equipment: g('oie_equipment'),
            maker: g('oie_maker'),
            modelType: g('oie_modelType'),
            capacity: g('oie_capacity'),
            serialNo: g('oie_serialNo'),
        };
    }

    function origJobEquipmentSaveFields(data) {
        const equipment = String(data.equipment || '').trim();
        const equipment_no = equipment && TVC_SpareMenu?.equipmentNoForName
            ? TVC_SpareMenu.equipmentNoForName(state, data.group, equipment, 'pms')
            : 0;
        return { equipment, equipment_no };
    }

    function refreshActualPlan() {
        if (state.currentTab === 'actual') renderActualPlan();
    }

    async function persistOrigJobEquipmentHeader(user, data, department) {
        const equipment = String(data.equipment || data.item_sort1 || '').trim();
        const hasHeader = !!(data.maker || data.modelType || data.capacity || data.serialNo);
        if (!equipment || !hasHeader || !TVC_SpareMenu?.saveJobEquipmentHeader) return;
        const eqNo = data.equipment_no || (TVC_SpareMenu.equipmentNoForName
            ? TVC_SpareMenu.equipmentNoForName(state, data.group, equipment, 'pms')
            : 0);
        await TVC_SpareMenu.saveJobEquipmentHeader(user, {
            department,
            group: data.group,
            item_sort1: equipment,
            equipment_no: eqNo,
            maker: data.maker,
            modelType: data.modelType,
            capacity: data.capacity,
            serialNo: data.serialNo,
            header_edited: true,
        }, 'pms');
    }

    async function saveOrigJobInlineEdit() {
        if (!isOrigJobInlineEditing()) return;
        const user = TVC_Auth.getCurrentUser();
        if (!user || !canEditOriginalPlanItems()) return;
        const m = origJobInlineState();
        const data = readOrigJobInlineForm();
        if (!data.job_code) await TVC_Dialog.alert('Enter Job Code.');
        if (!data.group) await TVC_Dialog.alert('Select a GROUP.');
        try {
            if (m.mode === 'append') {
                const ctx = defaultAppendContext();
                await TVC_MaintenancePlan.createJob(user, {
                    ...data,
                    ...origJobEquipmentSaveFields(data),
                    department: ctx.dept,
                    is_critical_equipment: parseJobCriticalEditValue(data.is_critical_equipment),
                    ...masterVesselOpts(),
                });
                await persistOrigJobEquipmentHeader(user, data, ctx.dept);
                await TVC_Dialog.alert(`${data.job_code} Item added.`);
            } else {
                await TVC_MaintenancePlan.updateJob(user, m.editId, {
                    ...data,
                    ...origJobEquipmentSaveFields(data),
                    is_critical_equipment: parseJobCriticalEditValue(data.is_critical_equipment),
                    ...masterVesselOpts(),
                });
                await persistOrigJobEquipmentHeader(
                    user,
                    data,
                    m.draft?.department || state.department || user.department
                );
                await TVC_Dialog.alert(`${data.job_code} Item updated.`);
            }
            cancelOrigJobInlineEdit({ restoreScroll: false });
            state._actScrollRestore = captureActListScroll();
            await refreshAll();
        } catch (e) {
            state._actScrollRestore = null;
            const msg = e.code === 'DUPLICATE' ? 'Job Code already exists.'
                : e.code === 'FORBIDDEN' ? 'Cannot edit items from another department.'
                : (e.message || e.code);
            await TVC_Dialog.alert(msg);
        }
    }

    function suggestNextJobCode(group, dept, equipmentNo) {
        const prefixMatch = String(group || '').match(/^(\d+)/);
        const prefix = prefixMatch ? prefixMatch[1].padStart(2, '0') : '99';
        const ee = Math.max(0, parseInt(String(equipmentNo ?? 0), 10) || 0);
        const format = TVC_PmsMasterExcel?.formatPmsJobCode
            || ((g, e, i) => `${g}-${String(e).padStart(2, '0')}-${String(i).padStart(3, '0')}`);
        const parse = TVC_PmsMasterExcel?.parsePmsJobCode;
        let max = 0;
        state.jobs.filter(j => (!dept || j.department === dept)).forEach(j => {
            const p = parse ? parse(j.job_code) : null;
            if (p?.valid) {
                if (p.groupNo === prefix && p.equipNo === ee) max = Math.max(max, p.itemNo);
                return;
            }
            const m = String(j.job_code || '').match(/^(\d{1,2})-(\d{2})-(\d{1,3})$/);
            if (m && m[1].padStart(2, '0') === prefix && parseInt(m[2], 10) === ee) {
                max = Math.max(max, parseInt(m[3], 10));
            }
        });
        return format(prefix, ee, max + 1);
    }

    function defaultAppendContext() {
        const selJob = state.selectedJobId ? state.idx?.jobById.get(state.selectedJobId) : null;
        let group = selJob?.group || '';
        let dept = selJob?.department || state.user?.department || state.department || 'ENGINE';
        if (state.selectedGroupKey && state.idx) {
            const node = state.idx.groupNodes.find(n => n.key === state.selectedGroupKey);
            if (node) {
                group = node.label;
                dept = node.department || dept;
            }
        }
        const eqNo = selJob?.equipment_no || 0;
        const equipment = selJob ? jobEquipmentDraftValue(selJob) : '';
        return {
            group: (group || '').trim(),
            dept,
            equipment,
            job_code: suggestNextJobCode(group, dept, equipment
                ? (TVC_SpareMenu?.equipmentNoForName?.(state, group, equipment, 'pms') || eqNo)
                : eqNo),
        };
    }

    function renderOrigJobEditor(mode, job) {
        const host = document.getElementById('origJobEditorBody');
        if (!host) return;
        const isNew = mode === 'append';
        const dept = job?.department || state.user?.department || state.department || 'ENGINE';
        const units = ['M', 'W', 'D', 'H', 'Y'];
        const sorts = ['', 'C.       CRITICAL EQUIPMENT', 'D.       DOCKING', 'A.       ROUTINE', 'B.       SPECIAL'];
        const title = isNew ? '➕ Append Maintenance Item' : '✏️ Modify Maintenance Item';
        host.innerHTML = `
            <h3>${title}</h3>
            <form class="orig-job-form" id="origJobForm" onsubmit="event.preventDefault();TVC_App.saveOrigJobEditor()">
                <label>Department<input value="${esc(dept)}" readonly class="wr-ro"></label>
                <label>Job Code<input name="job_code" required value="${esc(job?.job_code || '')}"></label>
                <label class="span2">GROUP
                    <select name="group">${origGroupOptions(dept, (job?.group || '').trim())}</select>
                </label>
                <label class="span2">SORT
                    <select name="sort">
                        ${sorts.map(s => `<option value="${escAttr(s)}"${(job?.sort || '') === s ? ' selected' : ''}>${esc(s || '(none)')}</option>`).join('')}
                    </select>
                </label>
                <label>SORT-1<input name="item_sort1" value="${esc(job?.item_sort1 || '')}"></label>
                <label>SORT-2<input name="item_sort2" value="${esc(job?.item_sort2 || '')}"></label>
                <label class="span2">JOB DETAIL<textarea name="job_detail">${esc(job?.job_detail || '')}</textarea></label>
                <label>Period<input type="number" step="0.1" min="0" name="period" value="${esc(job?.period ?? 1)}"></label>
                <label>Unit
                    <select name="unit">${units.map(u => `<option ${(job?.unit || 'M') === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
                </label>
                <label>P.I.C
                    <select name="pic">${origPicOptions(dept, job?.pic || '')}</select>
                </label>
                <label>Next Date<input type="date" name="next_date" value="${esc((job?.next_date || '').slice(0, 10))}"></label>
                <label>Last Done<input type="date" name="last_done" value="${esc((job?.last_done || '').slice(0, 10))}"></label>
                <div class="orig-job-actions span2">
                    <button type="button" class="btn" onclick="TVC_App.closeModal('origJobEditorModal')">Cancel</button>
                    <button type="submit" class="btn btn-green">${isNew ? 'Append' : 'Save'}</button>
                </div>
            </form>`;
    }

    async function openOrigJobModify() {
        if (!canEditOriginalPlanItems()) {
            await TVC_Dialog.alert(origPlanEditDeniedMessage());
            return;
        }
        if (isOrigJobInlineEditing()) {
            const targetId = planEditTargetJobId();
            const m = origJobInlineState();
            if (targetId && String(m.editId) !== String(targetId)) {
                const job = state.idx?.jobById.get(targetId);
                if (!job) {
                    await TVC_Dialog.alert('Job item not found.');
                    return;
                }
                state.selectedJobId = targetId;
                startOrigJobInlineEdit(job);
                return;
            }
            return saveOrigJobInlineEdit();
        }
        const jobId = planEditTargetJobId();
        if (!jobId) {
            await TVC_Dialog.alert(planContextCheckedJobIds().length > 1
                ? 'Check exactly one job to modify.'
                : 'Select a job row to modify.');
            return;
        }
        const job = state.idx?.jobById.get(jobId);
        if (!job) {
            await TVC_Dialog.alert('Job item not found.');
            return;
        }
        state.selectedJobId = jobId;
        startOrigJobInlineEdit(job);
    }

    async function openOrigJobAppend() {
        if (!canEditOriginalPlanItems()) {
            await TVC_Dialog.alert(origPlanEditDeniedMessage());
            return;
        }
        if (isOrigJobInlineEditing()) return saveOrigJobInlineEdit();
        startOrigJobInlineAppend();
    }

    function readOrigJobForm() {
        const form = document.getElementById('origJobForm');
        if (!form) return null;
        const fd = new FormData(form);
        const o = {};
        fd.forEach((v, k) => { o[k] = String(v).trim(); });
        return o;
    }

    async function saveOrigJobEditor() {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !canEditOriginalPlanItems()) return;
        const data = readOrigJobForm();
        if (!data?.job_code) await TVC_Dialog.alert('Enter Job Code.');
        try {
            if (state._origJobEditMode === 'append') {
                const ctx = defaultAppendContext();
                await TVC_MaintenancePlan.createJob(user, {
                    ...data,
                    department: ctx.dept,
                    ...masterVesselOpts(),
                });
                await TVC_Dialog.alert(`${data.job_code} Item added.`);
            } else {
                await TVC_MaintenancePlan.updateJob(user, state._origJobEditId, {
                    ...data,
                    ...masterVesselOpts(),
                });
                await TVC_Dialog.alert(`${data.job_code} Item updated.`);
            }
            closeModal('origJobEditorModal');
            await refreshAll();
        } catch (e) {
            const msg = e.code === 'DUPLICATE' ? 'Job Code already exists.'
                : e.code === 'FORBIDDEN' ? 'Cannot edit items from another department.'
                : (e.message || e.code);
            await TVC_Dialog.alert(msg);
        }
    }

    async function deleteOrigJob() {
        if (!canEditOriginalPlanItems()) {
            await TVC_Dialog.alert(origPlanEditDeniedMessage());
            return;
        }
        const jobId = planEditTargetJobId();
        if (!jobId) {
            await TVC_Dialog.alert(planContextCheckedJobIds().length > 1
                ? 'Check exactly one job to delete.'
                : 'Select a job row to delete.');
            return;
        }
        const job = state.idx?.jobById.get(jobId);
        if (!job) return;
        if (!await TVC_Dialog.confirm({ message: `${job.job_code} — "${job.job_detail || job.item_sort2 || ''}"\n\nDelete this maintenance item?` })) return;
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        try {
            await TVC_MaintenancePlan.deleteJob(user, job.id, state.reports);
            state.selectedJobId = null;
            await TVC_Dialog.alert(`${job.job_code} item deleted.`);
            await refreshAll();
        } catch (e) {
            const msg = e.code === 'LINKED' ? 'Items linked to a Work Report cannot be deleted.'
                : e.code === 'FORBIDDEN' ? 'Other department items cannot be deleted.'
                : (e.message || e.code);
            await TVC_Dialog.alert(msg);
        }
    }

    function showPlanCalc(show) {
        const m = document.getElementById('planCalcModal');
        const fill = document.getElementById('planCalcFill');
        if (!m) return;
        if (show) {
            m.classList.remove('hidden');
            if (fill) fill.style.width = '0%';
        } else {
            m.classList.add('hidden');
            if (fill) fill.style.width = '0%';
            if (_planCalcTimer) { clearInterval(_planCalcTimer); _planCalcTimer = null; }
        }
    }

    function planUpdateRate(outstanding, monthly) {
        if (!outstanding) return '100.00';
        return Math.min(100, (monthly / outstanding) * 100).toFixed(2);
    }

    /** Original Plan Update — Monthly Planned: Overdue + 이번 달 Due / Outstand'g: Overdue만 */
    function isPlanDueThisMonth(job, ym) {
        return !!(job.next_date && job.next_date.slice(0, 7) === ym);
    }

    function buildPlanUpdateStats() {
        const jobs = deptJobs();
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const buckets = { nonCritical: { o: 0, m: 0 }, critical: { o: 0, m: 0 } };
        jobs.forEach(j => {
            const k = isCriticalMaintenanceJob(j) ? 'critical' : 'nonCritical';
            if (j.is_overdue) buckets[k].o++;
            if (j.is_overdue || isPlanDueThisMonth(j, ym)) buckets[k].m++;
        });
        let pending = state.reports.filter(r => repSt(r) === 'REPORTED');
        if (state.department) pending = pending.filter(r => reportDept(r) === state.department);
        return {
            statusDate: now.toLocaleDateString('en-GB'),
            nonCritical: {
                outstanding: buckets.nonCritical.o,
                monthly: buckets.nonCritical.m,
                rate: planUpdateRate(buckets.nonCritical.o, buckets.nonCritical.m),
            },
            critical: {
                outstanding: buckets.critical.o,
                monthly: buckets.critical.m,
                rate: planUpdateRate(buckets.critical.o, buckets.critical.m),
            },
            pendingReports: pending.length,
        };
    }

    function snapshotRunHourJobs() {
        return state.jobs
            .filter(j => TVC_PMS.isRunHourJob(j) && TVC_PMS.isTrackedGroup(j.group))
            .map(j => ({
                id: j.id,
                next_date: j.next_date,
                is_overdue: j.is_overdue,
                schedule_basis: j.schedule_basis,
                run_hours_total: j.run_hours_total,
                run_hours_expected: j.run_hours_expected,
            }));
    }

    async function revertPlanUpdateSnapshot() {
        if (!_planUpdateSnapshot?.length) return;
        for (const snap of _planUpdateSnapshot) {
            const job = state.jobs.find(j => j.id === snap.id);
            if (!job) continue;
            job.next_date = snap.next_date;
            job.is_overdue = snap.is_overdue;
            job.schedule_basis = snap.schedule_basis;
            if (snap.run_hours_total != null) job.run_hours_total = snap.run_hours_total;
            else delete job.run_hours_total;
            if (snap.run_hours_expected != null) job.run_hours_expected = snap.run_hours_expected;
            else delete job.run_hours_expected;
            job.updated_at = new Date().toISOString();
            await TVC_DB.put('maintenance_jobs', job);
        }
        _planUpdateSnapshot = null;
    }

    function openPlanUpdateModal() {
        const stats = buildPlanUpdateStats();
        state._planUpdateStats = stats;
        setText('planUpdateStatusDate', stats.statusDate);
        setText('planUpNonOut', stats.nonCritical.outstanding);
        setText('planUpNonMon', stats.nonCritical.monthly);
        setText('planUpNonRate', stats.nonCritical.rate);
        setText('planUpCritOut', stats.critical.outstanding);
        setText('planUpCritMon', stats.critical.monthly);
        setText('planUpCritRate', stats.critical.rate);
        const shipEl = document.getElementById('planUpdateShipCode');
        if (shipEl && !shipEl.value.trim()) shipEl.value = 'TVC';
        const hint = document.getElementById('planUpdatePendingHint');
        if (hint) {
            if (stats.pendingReports > 0) {
                hint.textContent = `미완료 Work Report ${stats.pendingReports}건 — Cancel 선택 후 Work Plan에서 입력하세요.`;
                hint.classList.remove('hidden');
            } else {
                hint.textContent = '';
                hint.classList.add('hidden');
            }
        }
        showModal('planUpdateModal');
    }

    function closePlanUpdateModal() {
        closeModal('planUpdateModal');
    }

    async function confirmPlanUpdate(ok) {
        closePlanUpdateModal();
        const stats = state._planUpdateStats;
        const dept = getPlanLockDept();
        if (ok) {
            const shipCode = document.getElementById('planUpdateShipCode')?.value?.trim() || 'TVC';
            try {
                await TVC_PMS.updateMaintenanceSchedule(state, { persist: true });
            } catch (e) {
                console.error('[TVC] confirmPlanUpdate persist', e);
                await TVC_Dialog.alert(e.message || 'An error occurred while saving Original Plan.');
                await revertPlanUpdateSnapshot();
                return;
            }
            await TVC_DB.setMeta(TVC_META_KEYS.ORIGINAL_PLAN_UPDATE, JSON.stringify({
                at: new Date().toISOString(),
                ship_code: shipCode,
                stats,
                department: dept,
            }));
            await lockOriginalPlanUpdate(dept, shipCode, stats);
            _planUpdateSnapshot = null;
            // Plan 확정 후 RH Revert 세션 종료 → Update 버튼이 계속 비활성인 상태 해제
            TVC_RunHours.clearRevertAfterPlanLock?.();
            state._planCalcMsg = `Original Plan Update 확정 (${shipCode}) — Status On ${stats?.statusDate || ''}. 본사 Import 전까지 재변경 불가.`;
            syncPlanUpdateUi();
            if (state.currentTab === 'menu') renderMainMenu();
        } else {
            await revertPlanUpdateSnapshot();
            const pending = stats?.pendingReports || 0;
            state._planCalcMsg = pending
                ? `Original Plan Update 취소 — Due Date 원복. 미완료 Work Report ${pending}건을 Work Plan에서 입력하세요.`
                : 'Original Plan Update 취소 — Run-hour Due Date 변경을 되돌렸습니다.';
            if (pending > 0) {
                switchTab('actual');
                setActualFilter('total');
            }
        }
        state._planUpdateStats = null;
        if (ok || state.currentTab === 'actual') renderActualPlan();
    }

    /** HQ Mode — Work Plan Approve (Menu · Work Plan tab) */
    async function approveWorkPlanFromHq() {
        if (!TVC_RBAC.isHqAccount(state.user)) return;
        if (!TVC_RBAC.can(state.user, TVC_RBAC.Action.APPROVE_ORIGINAL_PLAN)) {
            await TVC_Dialog.alert('You do not have permission to approve Work Plan.');
            return;
        }
        if (!getPlanLockDept()) {
            await TVC_Dialog.alert('Select a department (Deck / Engine).');
            return;
        }
        await updateOriginalPlanFromRunHours({ hqApprove: true });
    }

    /** Menu · HQ Approve Work Plan — skip Calculation modal and Outstanding Rate table */
    function shouldSkipPlanUpdateUi(opts = {}) {
        return opts.hqApprove === true || opts.fromMenu === true;
    }

    async function promptPlanUpdateConfirm() {
        const stats = buildPlanUpdateStats();
        state._planUpdateStats = stats;
        let msg = 'Update and confirm Original Plan?';
        if (stats.pendingReports > 0) {
            msg += `\n\n${stats.pendingReports} unfinished Work Report(s) — choose Cancel and complete them in Work Plan.`;
        }
        await confirmPlanUpdate(await TVC_Dialog.confirm({ message: msg }));
    }

    /** Menu → Update Original Plan: Run-hour 입력값으로 H 주기 Due Date 재계산 (CMAXS Calculation) */
    async function updateOriginalPlanFromRunHours(opts = {}) {
        const isHqApprove = opts.hqApprove === true;
        const skipUi = shouldSkipPlanUpdateUi(opts);
        if (!isHqApprove && typeof TVC_Space !== 'undefined' && !TVC_Space.getUiFeatures(state.user).showUpdateWorkPlan) {
            await TVC_Dialog.alert('Update Work Plan requires Chief Engineer, Chief Officer, or Captain permission.');
            return;
        }
        if (!isHqApprove && rhUpdateGateApplies() && !isRhUpdateCommitted()) {
            await TVC_Dialog.alert('Complete Running Hours Update first.');
            return;
        }
        if (!canPerformOriginalPlanUpdate()) {
            await TVC_Dialog.alert(getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan Update is not available.');
            return;
        }
        menuNavigate('actual', { actualFilter: 'total' });
        state._planCalcMsg = '';
        _planUpdateSnapshot = snapshotRunHourJobs();

        let calcError = null;
        if (skipUi) {
            try {
                await TVC_PMS.updateMaintenanceSchedule(state, { persist: false });
            } catch (e) {
                calcError = e;
            }
        } else {
            showPlanCalc(true);
            const start = Date.now();
        const calcPromise = TVC_PMS.updateMaintenanceSchedule(state, { persist: false })
            .catch(e => { calcError = e; });

        const fill = document.getElementById('planCalcFill');
        await new Promise(resolve => {
            if (_planCalcTimer) clearInterval(_planCalcTimer);
            _planCalcTimer = setInterval(() => {
                const elapsed = Date.now() - start;
                const pct = Math.min(100, Math.round((elapsed / PLAN_CALC_MS) * 100));
                if (fill) fill.style.width = pct + '%';
                if (elapsed >= PLAN_CALC_MS) {
                    clearInterval(_planCalcTimer);
                    _planCalcTimer = null;
                    resolve();
                }
            }, 50);
        });

        await calcPromise;
        if (fill) fill.style.width = '100%';
        await new Promise(r => setTimeout(r, 200));
        showPlanCalc(false);
        }

        if (calcError) {
            console.error('[TVC] updateOriginalPlanFromRunHours', calcError);
            await revertPlanUpdateSnapshot();
            _planUpdateSnapshot = null;
            await TVC_Dialog.alert(calcError.message || 'An error occurred while calculating Original Plan.');
            return;
        }

        renderActualPlan();
        if (skipUi) await promptPlanUpdateConfirm();
        else openPlanUpdateModal();
    }

    function isTreeDeptCollapsed(dept) {
        if (state.treeSearch) return false;
        return !!state.collapsedTreeDepts[dept];
    }

    function toggleTreeDept(dept) {
        if (!dept) return;
        if (state.collapsedTreeDepts[dept]) delete state.collapsedTreeDepts[dept];
        else state.collapsedTreeDepts[dept] = true;
        if (document.getElementById('actTree') && state.idx) renderGroupTree('actTree');
        if (document.getElementById('spareGroupTree') && window.TVC_SpareMenu?.renderSpareGroupTree) {
            TVC_SpareMenu.renderSpareGroupTree();
        }
    }

    function renderGroupTree(rootId) {
        const root = document.getElementById(rootId);
        if (!root || !state.idx) return;
        if (state.selectedGroupKey === CRITICAL_GROUP_KEY) state.selectedGroupKey = null;
        const q = state.treeSearch;
        const matchNode = (n) => !q || (n.label || '').toLowerCase().includes(q) || (n.department || '').toLowerCase().includes(q);
        const byDept = new Map();
        state.idx.groupNodes
            .filter(n => (!state.department || n.department === state.department) && matchNode(n))
            .forEach(n => { if (!byDept.has(n.department)) byDept.set(n.department, []); byDept.get(n.department).push(n); });
        const allSelected = !state.selectedGroupKey;
        let html = `<div class="tree-node${allSelected ? ' selected' : ''}" onclick="TVC_App.selectGroup(null)"><span>📋 All Groups</span></div>`;
        if (!byDept.size && q) {
            html += `<div class="tree-empty muted">No groups match "${esc(q)}"</div>`;
        }
        DEPT_TREE_ORDER.filter(d => byDept.has(d)).forEach(dept => {
            const nodes = byDept.get(dept);
            const collapsed = isTreeDeptCollapsed(dept);
            const chevron = collapsed ? '▸' : '▾';
            html += `<div class="tree-dept tree-dept-toggle" role="button" tabindex="0" onclick="TVC_App.toggleTreeDept('${escAttr(dept)}')"><span class="tree-dept-chevron" aria-hidden="true">${chevron}</span><span>${esc(dept)}</span></div>`;
            if (!collapsed) {
            nodes.forEach(n => {
                const nJobs = n.jobIds?.length || 0;
                const countTag = `<span class="tree-empty-tag" title="${nJobs ? nJobs + ' jobs' : '작업 항목 없음'}">${nJobs}</span>`;
                const sel = state.selectedGroupKey === n.key ? ' selected' : '';
                html += `<div class="tree-node${sel}${nJobs ? '' : ' tree-node-empty'}" onclick="TVC_App.selectGroup('${escAttr(n.key)}')"><span>${esc(n.label)}</span>${countTag}</div>`;
            });
            }
        });
        root.innerHTML = html;
        const searchId = rootId === 'actTree' ? 'actTreeSearch'
            : (rootId === 'spareGroupTree' ? 'spareTreeSearch' : null);
        if (!searchId) return;
        const searchEl = document.getElementById(searchId);
        if (searchEl && document.activeElement !== searchEl) searchEl.value = state.treeSearch || '';
    }

    // ── TAB: Work Plan ─────────────────────────────────────────────
    function renderActualPlan() {
        clearActualFilterKeysCache();
        renderGroupTree('actTree');
        syncPlanGroupUi();
        syncPlanGroupTreeUi();
        updateActualFilterUI();
        syncActualPeriodInputs();
        syncBatchReportBtn();
        renderSpicsAlertBanner();
        mountJobSheet('actHead', 'actCount', 'actScroll', sheetIds('actual'), 'vlActual');
        TVC_ListFilters?.syncBtn('actual');
        syncPlanUpdateUi();
        renderSidePanel();
        renderPlanGroupHeader();
        refreshActJobEditBlock();
        const msgEl = document.getElementById('actPlanCalcMsg');
        if (msgEl) {
            if (state._planCalcMsg) {
                msgEl.textContent = state._planCalcMsg;
                msgEl.classList.remove('hidden');
            } else if (!isOriginalPlanUpdateLocked(getPlanLockDept())) {
                msgEl.textContent = '';
                msgEl.classList.add('hidden');
            }
        }
    }

    function inferReportDepartment(report, jobs) {
        if (!report) return null;
        if (report.department) return report.department;
        TVC_WorkReport.fromLegacy(report);
        const codes = TVC_WorkReport.getJobCodes(report);
        const pool = jobs || state._allJobs || state.jobs || [];
        const depts = new Set();
        for (const code of codes) {
            const c = String(code || '').trim();
            if (!c) continue;
            for (const j of pool) {
                if (j.job_code === c && j.department) depts.add(j.department);
            }
        }
        if (depts.size === 1) return [...depts][0];
        for (const item of TVC_WorkReport.getJobItems(report)) {
            const job = resolveJobById(item.maintenance_job_id)
                || resolveJobByCode(item.job_code, report.department || state.department);
            if (job?.department) return job.department;
        }
        return null;
    }

    function defectCaseDept(dc) {
        if (!dc) return null;
        if (dc.department) return dc.department;
        const job = resolveJobById(dc.maintenance_job_id)
            || resolveJobByCode(defectEffectiveJobCode(dc), dc.department || state.department);
        return job?.department || null;
    }

    function reportDept(r) {
        if (!r) return null;
        if (r.department) return r.department;
        return inferReportDepartment(r);
    }

    function histReportJobDept(rep, item) {
        const scopeDept = String(reportDept(rep)
            || (typeof TVC_Space !== 'undefined' ? TVC_Space.fixedDepartment(TVC_Space.getStation(state.user)) : '')
            || state.department || state.user?.department || '').trim().toUpperCase();
        let job = resolveJobById(item?.maintenance_job_id)
            || resolveJobByCode(item?.job_code, scopeDept || state.department);
        if (scopeDept && item?.job_code) {
            const scoped = resolveJobByCode(item.job_code, scopeDept);
            if (scoped) job = scoped;
        }
        const jobDept = String(job?.department || '').trim().toUpperCase();
        if (scopeDept && (!jobDept || (jobDept !== scopeDept && TVC_RBAC.canConfirmDepartment(state.user, scopeDept)))) {
            return scopeDept;
        }
        if (job?.department) return job.department;
        return scopeDept || null;
    }

    function canConfirmHistReport(user, rep) {
        if (!user || !rep) return false;
        const dept = reportDept(rep);
        if (!TVC_RBAC.canConfirmDepartment(user, dept)) return false;
        TVC_WorkReport.fromLegacy(rep);
        for (const item of TVC_WorkReport.getJobItems(rep)) {
            if (!TVC_RBAC.isReportedStatus(item.status)) continue;
            const itemDept = histReportJobDept(rep, item);
            if (itemDept && !TVC_RBAC.canConfirmDepartment(user, itemDept)) return false;
        }
        return true;
    }


    function batchSelectedCount() {
        return Object.keys(state.batchSelectedJobs).filter(id => state.batchSelectedJobs[id]).length;
    }

    function planSheetMode() {
        return 'actual';
    }

    function clearPlanSelectedOnlyIfEmpty() {
        if (state.actualSelectedOnly && !batchSelectedCount()) state.actualSelectedOnly = false;
    }

    function refreshPlanAfterBatchToggle() {
        if (state.actualSelectedOnly) {
            renderActualPlan();
            return;
        }
        if (state.vlActual) state.vlActual.refresh();
        const head = document.getElementById('actHead');
        if (head) {
            const selIds = sheetIds('actual');
            const allBatch = selIds.length > 0 && selIds.every(id => state.batchSelectedJobs[id]);
            const chk = head.querySelector('.c-chk input[type=checkbox]');
            if (chk) chk.checked = allBatch;
        }
    }

    function toggleBatchJob(jobId, on) {
        if (on) state.batchSelectedJobs[jobId] = true;
        else delete state.batchSelectedJobs[jobId];
        if (on) {
            state.selectedJobId = jobId;
            updatePlanRowSelectionHighlight(jobId);
            renderPlanGroupHeader();
            if (state.currentTab === 'actual') syncPlanItemUi();
        }
        clearPlanSelectedOnlyIfEmpty();
        syncBatchReportBtn();
        if (state.currentTab === 'actual') refreshPlanAfterBatchToggle();
    }

    /** Work Plan batch checkboxes — snapshot before report draft open, restore on cancel close. */
    function snapshotPlanBatchSelection() {
        state._planBatchSnapshot = { ...state.batchSelectedJobs };
    }

    function restorePlanBatchSelection() {
        if (!state._planBatchSnapshot) return;
        state.batchSelectedJobs = { ...state._planBatchSnapshot };
        state._planBatchSnapshot = null;
        clearPlanSelectedOnlyIfEmpty();
        syncBatchReportBtn();
        if (state.currentTab === 'actual') refreshPlanAfterBatchToggle();
    }

    function clearPlanBatchSnapshot() {
        state._planBatchSnapshot = null;
    }

    function clearPlanBatchSelection() {
        state.batchSelectedJobs = {};
        state._planBatchSnapshot = null;
        state.actualSelectedOnly = false;
        syncBatchReportBtn();
        if (state.currentTab === 'actual') refreshPlanAfterBatchToggle();
    }

    /** Work Report / Defect Report draft — mirror JOB CODE picks to Work Plan batch checkboxes. */
    function syncPlanBatchCheckForJob(jobId, on = true) {
        if (!jobId) return;
        if (on) state.batchSelectedJobs[jobId] = true;
        else delete state.batchSelectedJobs[jobId];
        clearPlanSelectedOnlyIfEmpty();
        syncBatchReportBtn();
        document.querySelectorAll('.sheet-actual[data-job-id]').forEach(row => {
            if (row.getAttribute('data-job-id') === jobId) {
                const chk = row.querySelector('.act-batch-chk');
                if (chk) chk.checked = !!on;
            }
        });
    }

    function syncPlanBatchChecksFromJobItems(items) {
        (items || []).forEach(item => {
            const id = item?.maintenance_job_id;
            if (id) syncPlanBatchCheckForJob(id, true);
        });
    }

    function toggleBatchSelectAll(on) {
        sheetIds('actual').forEach(id => {
            if (on) state.batchSelectedJobs[id] = true;
            else delete state.batchSelectedJobs[id];
        });
        clearPlanSelectedOnlyIfEmpty();
        syncBatchReportBtn();
        if (state.currentTab === 'actual') renderActualPlan();
    }

    function isBatchMultiActive() {
        return batchSelectedCount() >= 2;
    }

    function batchSelectedJobIds() {
        return Object.keys(state.batchSelectedJobs).filter(id => state.batchSelectedJobs[id]);
    }

    /** Checkboxes in the current department + PMS group. Blue row highlight is focus only. */
    function planContextCheckedJobIds() {
        return batchSelectedJobIds().filter(id => {
            if (!jobInCurrentViewDept(id)) return false;
            if (!state.selectedGroupKey) return true;
            const job = resolveJobById(id);
            return !!(job && jobMatchesSelectedGroup(job, state.idx));
        });
    }

    function planJobGroupKey(job) {
        if (!job) return '';
        return (window.TVC_Indexes?.groupKey?.(job))
            || `${job.department || ''}|${String(job.group || '').trim()}`;
    }

    function planCheckedJobsSameGroup(jobIds) {
        const keys = new Set((jobIds || []).map(id => planJobGroupKey(resolveJobById(id))).filter(Boolean));
        return keys.size <= 1;
    }

    /** Modify / Delete: one checkbox in this group, otherwise the blue focus row. */
    function planEditTargetJobId() {
        const checked = planContextCheckedJobIds();
        if (checked.length === 1) return checked[0];
        if (checked.length > 1) {
            const focus = String(state.selectedJobId || '');
            if (focus && checked.includes(focus)) return focus;
            return null;
        }
        if (state.selectedJobId && jobInCurrentViewDept(state.selectedJobId)) return state.selectedJobId;
        return null;
    }

    function planMakeReportJobIds(explicitJobId) {
        const explicit = explicitJobId && jobInCurrentViewDept(explicitJobId) ? String(explicitJobId) : '';
        const checked = planContextCheckedJobIds();
        if (explicit) {
            if (checked.includes(explicit)) return checked;
            return [explicit];
        }
        if (checked.length) return checked;
        if (state.selectedJobId && jobInCurrentViewDept(state.selectedJobId)) return [state.selectedJobId];
        return [];
    }

    function applyPlanBatchSelection(jobIds) {
        state.batchSelectedJobs = {};
        (jobIds || []).forEach(id => {
            if (id) state.batchSelectedJobs[id] = true;
        });
        clearPlanSelectedOnlyIfEmpty();
        syncBatchReportBtn();
    }

    function defaultWrForm(today) {
        return {
            reportDate: today,
            workDate: today,
            fileNo: '',
            voyNo: '',
            runHrs: '0',
            place: '',
            troubleParts: '',
            workResult: '',
            troublePoint: '',
            outline: '',
            shipComments: '',
            spareShipComments: '',
            handHours: '0',
            handMembers: '0',
            rhAfterLastMaint: '',
            shoreTechnician: false,
            lastMaintDate: '',
            pmsGroupNo: '',
            pmsGroupKey: '',
            jobName: '',
            maker: '',
            modelType: '',
            capacity: '',
            serialNo: '',
            allPendingCleared: false,
            dockingRepair: false,
            pendingForRepair: false,
            postponeDate: '',
            requestCompanyApproval: false,
            repairRequest: false,
            shoreSupport: false,
            defectCleared: false,
            shipAttachments: [],
            companyAttachments: [],
            meStop: '0',
            meSpeedRed: '0',
            delayHours: '0',
            cargoDelay: '0',
            reason: '',
            troubleOutline: '',
            presumedCause: '',
            countermeasures: '',
        };
    }

    function syncBatchReportBtn() {
        if (state.currentTab === 'actual') renderSidePanel();
    }

    async function togglePlanSelectedOnly() {
        if (state.currentTab !== 'actual') return;
        if (state.actualSelectedOnly) {
            state.actualSelectedOnly = false;
        } else {
            if (!planContextCheckedJobIds().length) {
                await TVC_Dialog.alert('No jobs selected.');
                return;
            }
            state.actualSelectedOnly = true;
        }
        renderActualPlan();
    }

    function toggleActSelectedOnly() {
        togglePlanSelectedOnly();
    }

    function initBatchDraft(jobIds) {
        const today = new Date().toISOString().slice(0, 10);
        state._batchDraft = { items: {} };
        jobIds.forEach(id => {
            const job = state.idx?.jobById.get(id);
            if (!job) return;
            const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
            state._batchDraft.items[id] = {
                form: {
                    ...defaultWrForm(today),
                    lastMaintDate: job.last_done || '',
                    pmsGroupNo: hdr.pmsGroupNo || '',
                    maker: hdr.maker || '',
                    modelType: hdr.modelType || '',
                    capacity: hdr.capacity || '',
                    serialNo: hdr.serialNo || '',
                },
                usedParts: [],
            };
        });
    }

    function captureBatchJobDraft() {
        if (!state._batchMode || !state._wrJobId || !state._batchDraft?.items) return;
        captureWorkReportForm();
        captureWorkReportUsedParts();
        state._batchDraft.items[state._wrJobId] = {
            form: { ...state._wrForm },
            usedParts: (state._wrUsedParts || []).map(p => ({ ...p })),
        };
    }

    function loadBatchJobIntoEditor(jobId) {
        const item = state._batchDraft?.items[jobId];
        if (!item) return;
        state._wrJobId = jobId;
        state._wrForm = { ...(item.form || {}) };
        state._wrUsedParts = enrichUsedParts(item.usedParts || []);
        state._wrSpareSearch = '';
    }

    function setBatchActiveJob(jobId) {
        if (!state._batchMode || !state._batchJobIds.includes(jobId)) return;
        if (state._wrJobId === jobId) return;
        captureBatchJobDraft();
        loadBatchJobIntoEditor(jobId);
        state._batchJobPickerOpen = false;
        refreshBatchActiveJobSwitch();
    }

    function setWrBatchViewJob(jobId) {
        if (state._batchMode && state._batchJobIds.includes(jobId)) {
            setBatchActiveJob(jobId);
        }
    }

    function openBatchJobPicker() {
        if (!state._batchMode) return;
        state._batchJobPickerOpen = !state._batchJobPickerOpen;
        renderWorkReportModal();
    }

    function closeBatchJobPicker() {
        state._batchJobPickerOpen = false;
        renderWorkReportModal();
    }

    function buildBatchJobPickerHtml() {
        const rows = state._batchJobIds.map(id => {
            const j = state.idx?.jobById.get(id);
            if (!j) return '';
            const itemText = [j.item_sort1, j.item_sort2, j.job_detail].filter(Boolean).join('  |  ') || '—';
            const active = id === state._wrJobId ? ' active' : '';
            return `<button type="button" class="batch-job-picker-row${active}" onclick="TVC_App.setBatchActiveJob('${escAttr(id)}')">
                <strong class="batch-job-picker-code">${esc(j.job_code)}</strong>
                <span class="batch-job-picker-item">${esc(itemText)}</span>
            </button>`;
        }).join('');
        return `<div class="batch-job-picker">${rows}</div>`;
    }

    async function openWorkReportInput(explicitJobId) {
        const prefill = planMakeReportJobIds(explicitJobId);
        const jobId = prefill[0];
        if (!jobId) {
            await TVC_Dialog.alert('Select a job or check one or more rows.');
            return;
        }
        if (prefill.length > 1 && !planCheckedJobsSameGroup(prefill)) {
            await TVC_Dialog.alert('Selected jobs belong to different PMS groups. Check jobs in one group only.');
            return;
        }
        if (prefill.length > 1) {
            const depts = [...new Set(prefill.map(id => {
                const j = state.idx?.jobById.get(id);
                return j?.department || '';
            }).filter(Boolean))];
            if (depts.length > 1) {
                await TVC_Dialog.alert('Items from another department cannot be included in the same Work Report.');
                return;
            }
            if (depts[0] && !canReportJobDepartment(state.user, depts[0])) {
                await TVC_Dialog.alert('Other department items cannot be reported.');
                return;
            }
        }
        return openWorkReport(jobId, undefined, { prefillJobIds: prefill });
    }

    async function openBatchReport() {
        const jobIds = planContextCheckedJobIds();
        if (jobIds.length < 2) {
            await TVC_Dialog.alert('Select at least 2 jobs for Work Report.');
            return;
        }
        if (!planCheckedJobsSameGroup(jobIds)) {
            await TVC_Dialog.alert('Selected jobs belong to different PMS groups. Check jobs in one group only.');
            return;
        }
        return openWorkReport(jobIds[0], undefined, { prefillJobIds: jobIds });
    }

    function closeBatchReport() {
        state._batchMode = false;
        state._batchJobIds = [];
        state._batchDraft = null;
        state._batchSpareSearch = {};
        state._batchJobPickerOpen = false;
        resetAndCloseWorkReport();
    }

    async function saveBatchReport() {
        return saveWorkReport();
    }

    function renderActualFilterDashboard() {
        const host = document.getElementById('actFilterDashboard');
        if (!host) return;
        const c = actualDashboardCounts();
        const f = state.actualFilter;
        const items = [
            { key: 'overdue', label: '! Overdue', count: c.overdue, cls: 'act-dash-overdue' },
            { key: 'due30', label: '◷ Due (30d)', count: c.due30, cls: 'act-dash-due30' },
            { key: 'postponed', label: 'P Postponed', count: c.postponed, cls: 'act-dash-postponed' },
            { key: 'critical', label: '⚠ Critical', count: c.critical, cls: 'act-dash-critical' },
        ];
        const btnHtml = items.map(b => `
            <button type="button" class="act-dash-btn ${b.cls}${f === b.key ? ' active' : ''}" data-afilter="${b.key}"
                onclick="TVC_App.setActualFilter('${b.key}')">
                <span class="act-dash-count">${b.count}</span>
                <span class="act-dash-label">${esc(b.label)}</span>
            </button>`).join('');
        host.innerHTML = `
            <div class="act-filter-dashboard-inner">
                ${btnHtml}
                <span class="act-dash-sep" aria-hidden="true"></span>
                <button type="button" class="act-dash-btn act-dash-total${f === 'total' ? ' active' : ''}" data-afilter="total"
                    onclick="TVC_App.setActualFilter('total')">
                    <span class="act-dash-count">${c.total}</span>
                    <span class="act-dash-label">Total</span>
                </button>
            </div>`;
    }

    function updateActualFilterUI() {
        renderActualFilterDashboard();
    }

    function renderQueues() {
        let reported = state.reports.filter(r => repSt(r) === 'REPORTED');
        let confirmed = state.reports.filter(r => repSt(r) === 'CONFIRMED');
        // 책임자: Station별 Confirm 권한 · Captain Hub는 뷰 필터에 따라 큐 표시
        if (state.user && TVC_RBAC.isApprover(state.user)) {
            if (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(state.user)) {
                const dept = state.department || state.user.department;
                if (!TVC_Space.canApproveReport(state.user, dept)) {
                    reported = [];
                } else {
                    reported = reported.filter(r => reportDept(r) === dept);
                }
            } else if (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(state.user)) {
                if (state.department) reported = reported.filter(r => reportDept(r) === state.department);
            } else {
                reported = reported.filter(r => reportDept(r) === state.user.department);
            }
        } else if (state.department) {
            reported = reported.filter(r => reportDept(r) === state.department);
        }
        if (state.department && TVC_RBAC.isHqAccount(state.user)) {
            confirmed = confirmed.filter(r => reportDept(r) === state.department);
        }
        const elP = document.getElementById('chiefQueue');
        const elH = document.getElementById('hqQueue');
        if (elP) elP.innerHTML = reported.length ? reported.map(r => {
            const rd = reportDept(r);
            const canCf = state.user && TVC_RBAC.canConfirmDepartment(state.user, rd);
            const dis = canCf ? '' : ' disabled title="타 부서 — Confirm 불가"';
            return `<div class="queue-item"><strong>${esc(r.job_code)}</strong> <span class="q-dept">${esc(rd || '')}</span> — ${esc(reporterLabel(r.reporter_name))}
            <button class="btn-sm btn-green"${dis} onclick="TVC_App.doConfirm('${r.id}')">✅ Confirm</button></div>`;
        }).join('') : '<p class="muted">None</p>';
        if (elH) elH.innerHTML = confirmed.length ? confirmed.map(r => `
            <div class="queue-item"><strong>${esc(r.job_code)}</strong> <span class="q-dept">${esc(reportDept(r) || '')}</span>
            <input type="text" id="comment-${r.id}" placeholder="HQ comment">
            <button class="btn-sm btn-green" onclick="TVC_App.doApprove('${r.id}')">🔒 Approve</button></div>`).join('') : '<p class="muted">None</p>';
    }

    function planActionBarHostId() {
        return 'actPlanActionBar';
    }

    function planGroupHeaderHostId() {
        return 'actPlanGroupHeader';
    }

    function planGroupHeaderHostForSheet(headId) {
        if (headId === 'actHead') return 'actPlanGroupHeader';
        return planGroupHeaderHostId();
    }

    function ensurePlanGroupHeaderHost(hostId) {
        let host = document.getElementById(hostId);
        if (host) return host;
        const listPanel = document.querySelector('#tab-actual .plan-list-panel');
        if (!listPanel?.parentElement) return null;
        host = document.createElement('div');
        host.id = hostId;
        host.className = 'plan-group-header';
        listPanel.parentElement.insertBefore(host, listPanel);
        return host;
    }

    function renderPlanGroupHeader(headId) {
        const hostId = headId ? planGroupHeaderHostForSheet(headId) : planGroupHeaderHostId();
        const host = ensurePlanGroupHeaderHost(hostId);
        if (!host) return;
        const render = TVC_SpareMenu?.renderPlanGroupHeaderHtml || TVC_SpareMenu?.renderSpareGroupHeaderHtml;
        if (!render) return;
        host.innerHTML = TVC_SpareMenu.renderPlanGroupHeaderHtml
            ? TVC_SpareMenu.renderPlanGroupHeaderHtml(state)
            : render(state, {
                pmsLabel: 'PMS Group No.',
                focusedId: null,
                suppressIdleHint: true,
                ariaLabel: 'PMS Group information',
            });
    }

    function renderSidePanel() {
        const bar = document.getElementById(planActionBarHostId());
        if (!bar) return;
        const n = planContextCheckedJobIds().length;
        const selFilterOn = !!state.actualSelectedOnly;
        const selLabel = selFilterOn ? `Show All (${n})` : `Selected Items${n >= 1 ? ` (${n})` : ''}`;
        const selTitle = selFilterOn ? '전체 작업 목록 표시' : (n >= 1 ? '선택된 작업만 목록에 표시' : '체크(ㅁ)로 작업을 선택하세요');
        const selectedItemsBtn = `<button type="button" id="planSelectedItemsBtn" class="btn btn-sm${selFilterOn ? ' plan-selected-filter-active' : ''}"${!selFilterOn && n < 1 ? ' disabled' : ''} title="${escAttr(selTitle)}" onclick="TVC_App.togglePlanSelectedOnly()">${selLabel}</button>`;
        const job = getPlanFocusJob();
        const noJob = !job;
        const canReport = !noJob || n >= 1;
        const reportTitle = n >= 2 ? `${n} jobs — batch Work Report` : '';
        bar.innerHTML = `<div class="plan-action-btns">
                <button type="button" id="planWpBtn" class="btn btn-sm" onclick="TVC_App.openPlanWorkProcedure()"${noJob ? ' disabled' : ''}>Work Procedure / History</button>
                <button type="button" id="planReportBtn" class="btn btn-sm btn-green" onclick="TVC_App.openWorkReportInput()"${canReport ? '' : ' disabled'}${reportTitle ? ` title="${escAttr(reportTitle)}"` : ''}>Make Report</button>
                ${selectedItemsBtn}
            </div>`;
    }

    async function openNewDefectReportInput(explicitJobId, opts = {}) {
        const prefill = planMakeReportJobIds(explicitJobId);
        const jobId = prefill[0];
        if (!jobId && !prefill.length) {
            return TVC_DefectReport.openNewBlank();
        }
        if (!jobId) {
            await TVC_Dialog.alert('Select a job or check one or more rows.');
            return;
        }
        if (prefill.length > 1 && !planCheckedJobsSameGroup(prefill)) {
            await TVC_Dialog.alert('Selected jobs belong to different PMS groups. Check jobs in one group only.');
            return;
        }
        if (prefill.length > 1) {
            const depts = [...new Set(prefill.map(id => {
                const j = state.idx?.jobById.get(id);
                return j?.department || '';
            }).filter(Boolean))];
            if (depts.length > 1) {
                await TVC_Dialog.alert('Items from another department cannot be included in the same Defect Report.');
                return;
            }
            if (depts[0] && !canReportJobDepartment(state.user, depts[0])) {
                await TVC_Dialog.alert('Other department items cannot be reported.');
                return;
            }
        }
        return TVC_DefectReport.openNewFromJob(jobId, { prefillJobIds: prefill, ...opts });
    }

    function openNewDefectFromPlan() {
        return openNewDefectReportInput();
    }

    /** Job 단위 Work History — Work History 탭과 동일한 daily_work_reports / defect_cases 소스 */
    function jobWorkHistoryEntries(jobId) {
        const job = resolveJobById(jobId);
        if (!job) return [];
        const entries = [];
        workHistoryEntriesRaw().forEach(e => {
            if (e.source === 'permit') {
                const row = e.permit;
                if (!row) return;
                const items = row.job_items || [];
                const jobMatch = row.maintenance_job_id === job.id
                    || (row.job_code || row.pms_job_code) === job.job_code
                    || items.some(it => it.maintenance_job_id === job.id || it.job_code === job.job_code);
                if (jobMatch) entries.push(e);
                return;
            }
            if (e.source === 'defect') {
                const dc = e.defect;
                if (!dc || !defectCaseMatchesJob(dc, job)) return;
                if (e.isDefectBatchSummary && defectIsBatch(dc)) {
                    const batchItem = (dc.job_items || []).find(it =>
                        (it.maintenance_job_id && it.maintenance_job_id === job.id)
                        || (it.job_code && it.job_code === job.job_code)
                    );
                    entries.push({
                        source: 'defect',
                        defect: dc,
                        defectJobItem: batchItem,
                        isDefectBatchSummary: true,
                    });
                } else {
                    entries.push(e);
                }
                return;
            }
            const { report: r, item } = e;
            if (!r || !item) return;
            if (e.isBatchSummary && r.is_batch) {
                const batchItem = (r.job_items || []).find(it =>
                    it.maintenance_job_id === job.id || it.job_code === job.job_code
                );
                if (batchItem) {
                    entries.push({
                        source: 'report',
                        report: r,
                        item: batchItem,
                        isBatchSummary: true,
                    });
                }
                return;
            }
            if (item.maintenance_job_id === job.id || item.job_code === job.job_code) {
                entries.push(e);
            }
        });
        entries.sort(compareHistEntryByReportedDate);
        return entries;
    }

    function jobConsumedSpareParts(jobId) {
        const spareById = new Map((state.spares || []).map(s => [s.id, s]));
        const consumed = [];
        jobWorkHistoryEntries(jobId).forEach(entry => {
            if (entry.source === 'report') {
            const { report: r, item } = entry;
            if (!r || !item) return;
            const parts = item.used_parts?.length ? item.used_parts : (r.is_batch ? [] : (r.used_parts || []));
                const dt = formatCmaxsHistDate(listReportedDateStr(r));
            parts.forEach(u => {
                    const s = spareById.get(u.spare_part_id) || {};
                    consumed.push({
                        date: dt,
                        part_no: s.part_no || u.part_no || u.spare_part_id,
                        name: s.name || '—',
                        unit: s.unit || '—',
                        qty: u.qty_used,
                    });
                });
                return;
            }
            const dc = entry.defect;
            if (!dc) return;
            const dt = formatCmaxsHistDate(dc.ship_verified_date || listReportedDateStr(dc) || dc.work_date);
            (dc.used_parts || []).forEach(u => {
                const s = spareById.get(u.spare_part_id) || {};
                consumed.push({
                    date: dt,
                    part_no: s.part_no || u.part_no || u.spare_part_id,
                    name: s.name || '—',
                    unit: s.unit || '—',
                    qty: u.qty_used,
                });
            });
        });
        return consumed;
    }

    function histEntryUsedParts(entry) {
        if (entry.source === 'defect') return entry.defect?.used_parts || [];
        const { report: r, item } = entry;
        if (!r || !item) return [];
        if (entry.isBatchSummary && r.is_batch) {
            return TVC_SpareMenu.aggregateUsedPartsFromWorkReport(r);
        }
        return item.used_parts?.length ? item.used_parts : (r.is_batch ? [] : (r.used_parts || []));
    }

    /** Work Procedure Work History — Page 2 checked spare count (0 when none consumed) */
    function histEntryPage2SpareCount(entry) {
        return histEntryUsedParts(entry).filter(p => Number(p.qty_used) > 0).length;
    }

    function resolveHistEntryConsumeLog(entry) {
        const map = state._consumeLogById || {};
        if (isHistConsumeEntry(entry)) return entry.consume || null;
        if (isHistDefectEntry(entry)) {
            const dc = entry.defect;
            if (!dc) return null;
            if (dc.consume_log_id && map[String(dc.consume_log_id)]) return map[String(dc.consume_log_id)];
            return Object.values(map).find(l => l.defect_case_id === dc.id) || null;
        }
        const r = entry?.report;
        if (!r) return null;
        if (r.consume_log_id && map[String(r.consume_log_id)]) return map[String(r.consume_log_id)];
        return Object.values(map).find(l => l.work_report_id === r.id) || null;
    }

    /** Work History — Spare Data (Consumption List line count when linked) */
    function histEntrySpareDataCount(entry) {
        const log = resolveHistEntryConsumeLog(entry);
        if (log) {
            return TVC_SpareMenu.consumeLogTotalData
                ? TVC_SpareMenu.consumeLogTotalData(log)
                : (Number(log.line_count) || (log.lines || []).length || 0);
        }
        return histEntryPage2SpareCount(entry);
    }

    function histSpareDataCell(entry) {
        return `<td class="hist-spare-data">${histEntrySpareDataCount(entry)}</td>`;
    }

    function wrReportForm(report) {
        return report?.report_form || {};
    }

    /** 다중 Work Report — job item form + report_form 병합 (outline 등 공유 필드 복원) */
    function resolveBatchWrForm(rep, item) {
        if (!rep) return { ...(item?.form || {}) };
        TVC_WorkReport.fromLegacy(rep);
        const primary = TVC_WorkReport.primaryJobItem(rep) || item || rep.job_items?.[0];
        const form = {
            ...(primary?.form || item?.form || {}),
            ...(rep.report_form || {}),
        };
        if (!String(form.outline || '').trim()) {
            form.outline = (rep.job_items || [])
                .map(it => it.form?.outline)
                .find(v => String(v || '').trim())
                || primary?.description
                || rep.description
                || '';
        }
        return form;
    }

    function formatCmaxsHistDate(dateStr) {
        if (!dateStr) return '';
        return String(dateStr).slice(0, 10);
    }

    function wrAttachmentTotalKb(attachments) {
        const list = Array.isArray(attachments) ? attachments : [];
        if (!list.length) return 0;
        return Math.max(1, Math.round(list.reduce((n, a) => n + (Number(a.size) || 0), 0) / 1024));
    }

    function histFlagCell(on) {
        return `<td class="hist-flag">${on ? '☑' : '☐'}</td>`;
    }

    /** Work History flag columns — RR / SS / DC / SC / CC (legacy DR·PR·CL fields supported) */
    function workHistoryFormFlags(f, report) {
        const form = f || {};
        return {
            repairRequest: !!(form.repairRequest ?? form.dockingRepair),
            shoreSupport: !!(form.shoreSupport ?? form.pendingForRepair ?? form.shoreTechnician),
            defectCleared: !!(form.defectCleared ?? form.allPendingCleared),
            shipComment: !!String(form.shipComments || '').trim(),
            companyComment: !!String(report?.company_comment || '').trim(),
        };
    }

    function histAttachmentCell(attachments, cellClass) {
        const list = Array.isArray(attachments) ? attachments : [];
        const kb = wrAttachmentTotalKb(list);
        const cls = cellClass ? `hist-at ${cellClass}` : 'hist-at';
        return `<td class="${cls}">${list.length ? '☑' : '☐'} <span class="hist-at-kb">${kb}KB</span></td>`;
    }

    function reportWorkflowStatusLabel(report, item) {
        if (report && !item) return workReportListWorkflowStatus(report);
        const wf = report ? workReportListWorkflowStatus(report) : null;
        if (wf === 'Submitted' || wf === 'Approved') return wf;
        if (wf && (!item || report.job_items?.length === 1)) return wf;
        const status = item
            ? TVC_RBAC.normalizeReportStatus(item.status, report?.is_locked)
            : repSt(report);
        const labels = {
            REPORTED: 'Reported',
            CONFIRMED: 'Confirmed',
            APPROVED: 'Approved',
        };
        return labels[status] || 'Reported';
    }

    function histWorkflowStatusPillClass(label) {
        if (label === 'Submitted') return 'warn';
        if (label === 'Approved' || label === 'Confirmed') return 'ok';
        return 'warn';
    }

    function workHistoryStatusLabel(report, item) {
        return reportWorkflowStatusLabel(report, item);
    }

    /** Work History 목록(필터+정렬) — 렌더링과 Prev/Next 네비게이션이 공유 */
    function workHistoryReports() {
        let reports = state.reports.slice();
        if (state.department) reports = reports.filter(r => reportDept(r) === state.department);
        reports.sort(compareReportByReportedDate);
        return reports;
    }

    /** Work History — Work Report(job item) + Defect Case 통합 타임라인 */
    function getListFilterState() { return state.listFilters; }
    function getAppDepartment() { return state.department; }
    function getAppUserDepartment() { return state.user?.department || null; }
    function getSelectedGroupKey() { return state.selectedGroupKey; }
    function getSpareSelectedGroupKey() { return state.spareSelectedGroupKey; }
    function getAppIdx() { return state.idx; }
    function getAppJobs() { return state.jobs; }

    function setListFilters(tab, patch) {
        if (!state.listFilters[tab]) return;
        Object.assign(state.listFilters[tab], patch);
        rerenderCurrentTab();
        TVC_ListFilters?.syncBtn(tab);
    }

    function clearListFilters(tab) {
        if (tab === 'actual') setListFilters('actual', { pics: [], unassigned: false, criticalOnly: false });
        else if (tab === 'history') setListFilters('history', { groupKeys: [], type: 'all', openOnly: false, noClosedOut: false, postponeAwaitingApproval: false, awaitingShipConfirm: false });
    }

    function syncListFilterBtns() {
        ['actual', 'history'].forEach(t => TVC_ListFilters?.syncBtn(t));
    }

    function listFilterCtx() {
        return { idx: state.idx, jobs: state.jobs };
    }

    function workHistoryEntriesRaw() {
        const entries = [];
        workHistoryReports().forEach(r => {
            TVC_WorkReport.fromLegacy(r);
            if (r.is_batch && (r.job_items || []).length > 1) {
                const primary = TVC_WorkReport.primaryJobItem(r) || r.job_items[0];
                entries.push({ source: 'report', report: r, item: primary, isBatchSummary: true });
            } else {
                (r.job_items || []).forEach(item => entries.push({ source: 'report', report: r, item }));
            }
        });
        workHistoryDefectCases().forEach(dc => {
            if (defectIsBatch(dc)) {
                const primary = defectPrimaryJobItem(dc);
                entries.push({
                    source: 'defect',
                    defect: dc,
                    defectJobItem: primary,
                    isDefectBatchSummary: true,
                });
            } else {
                entries.push({ source: 'defect', defect: dc });
            }
        });
        workHistoryPermits().forEach(row => {
            entries.push({ source: 'permit', permit: row });
        });
        workHistoryConsumeLogs().forEach(log => {
            entries.push({ source: 'consume', consume: log });
        });
        entries.sort(compareHistEntryByReportedDate);
        return entries;
    }

    function workHistoryConsumeLogs() {
        const map = state._consumeLogById || {};
        return Object.values(map).filter(log => {
            if (typeof TVC_SpareMenu?.isStandaloneConsumeLog === 'function') {
                return TVC_SpareMenu.isStandaloneConsumeLog(log, state);
            }
            return !log?.work_report_id && !log?.defect_case_id;
        });
    }

    const WORK_HISTORY_CONFIRMED_LABELS = new Set(['Confirmed', 'Approved', 'Submitted']);

    function isWorkHistoryEntryConfirmed(entry) {
        if (isHistPermitEntry(entry)) {
            const st = TVC_WorkPermit.listWorkflowStatus(entry.permit);
            return WORK_HISTORY_CONFIRMED_LABELS.has(st);
        }
        if (isHistDefectEntry(entry)) {
            const st = TVC_DefectCase.listWorkflowStatus(entry.defect);
            return st !== 'Reported' && st !== 'Draft';
        }
        if (isHistConsumeEntry(entry)) {
            const st = consumeHistoryFields(entry.consume).status;
            return WORK_HISTORY_CONFIRMED_LABELS.has(st);
        }
        const label = reportWorkflowStatusLabel(entry.report, entry.item);
        return WORK_HISTORY_CONFIRMED_LABELS.has(label);
    }

    /**
     * Engine Monthly → Update Running Hours 게이트.
     * - Maintenance / Postpone: Confirmed+
     * - Defect: 제외 (별도 관리)
     */
    function isMonthlyRhGateEntryReady(entry) {
        if (!entry || isHistDefectEntry(entry) || isHistPermitEntry(entry) || isHistConsumeEntry(entry)) return true;
        const report = entry.report;
        if (!report) return false;
        TVC_WorkReport.fromLegacy(report);
        const label = workReportListWorkflowStatus(report);
        if (label !== 'Confirmed' && label !== 'Submitted' && label !== 'Approved') return false;
        const itemSt = entry.item
            ? TVC_RBAC.normalizeReportStatus(entry.item.status, report.is_locked)
            : null;
        if (itemSt === 'REPORTED') return false;
        return true;
    }

    function monthlyRhGatePendingReason(entry) {
        if (!entry || isHistDefectEntry(entry) || isHistPermitEntry(entry) || isHistConsumeEntry(entry)) return '';
        const report = entry.report;
        if (!report) return 'Missing report';
        TVC_WorkReport.fromLegacy(report);
        const label = workReportListWorkflowStatus(report);
        if (label === 'Reported' || (entry.item && TVC_RBAC.normalizeReportStatus(entry.item.status, report.is_locked) === 'REPORTED')) {
            return report.work_type === 'POSTPONE'
                ? 'Postpone — Confirm required'
                : 'Maintenance — Confirm required';
        }
        return '';
    }

    function getMonthlyRhGatePendingEntries() {
        return workHistoryEntriesRaw().filter(e => !isHistDefectEntry(e) && !isMonthlyRhGateEntryReady(e));
    }

    function allWorkHistoryConfirmed() {
        // RH gate: monthly readiness (excludes Defect; Maintenance/Postpone Confirmed+)
        return getMonthlyRhGatePendingEntries().length === 0;
    }

    function isRhUpdateCommitted() {
        return TVC_RunHours.hasPendingRevert();
    }

    function canEditRunningHoursPerm() {
        if (!state.user) return false;
        const f = typeof TVC_Space !== 'undefined'
            ? TVC_Space.getUiFeatures(state.user)
            : TVC_RBAC.getUiFeatures(state.user);
        return f.canEditRunningHours === true;
    }

    function canUpdateRunningHours() {
        if (!canEditRunningHoursPerm()) return false;
        return allWorkHistoryConfirmed() && !isRhUpdateCommitted();
    }

    function canUpdateWorkPlanFromRh() {
        if (!rhUpdateGateApplies()) return canPerformOriginalPlanUpdate();
        return isRhUpdateCommitted() && canPerformOriginalPlanUpdate();
    }

    function workHistoryEntries() {
        const ctx = { idx: state.idx, jobs: state.jobs };
        const hf = state.listFilters?.history;
        return workHistoryEntriesRaw().filter(entry =>
            matchHistSearch(entry) && matchReportPeriodDate(histEntrySortDate(entry))
            && (!TVC_ListFilters || !hf || TVC_ListFilters.matchHistEntry(entry, hf, ctx))
        );
    }

    function getSelectedHistEntry() {
        if (!state._histSelReportId) return null;
        return workHistoryEntries().find(e => histEntryRowKey(e) === state._histSelReportId) || null;
    }

    function isHistDefectRowConfirmable(entry) {
        if (!isHistDefectEntry(entry) || !state.user) return false;
        if (TVC_RBAC.isHqAccount(state.user)) return false;
        return TVC_DefectReport.isDefectReportConfirmable(entry.defect);
    }

    function isHistPermitRowConfirmable(entry) {
        if (!isHistPermitEntry(entry) || !state.user) return false;
        if (TVC_RBAC.isHqAccount(state.user)) return false;
        return !!(TVC_WorkPermitReport?.isPermitConfirmable?.(entry.permit));
    }

    function isHistConsumeRowConfirmable(entry) {
        if (!isHistConsumeEntry(entry) || !state.user) return false;
        if (TVC_RBAC.isHqAccount(state.user)) return false;
        const log = entry.consume;
        if (!log) return false;
        const st = consumeHistoryFields(log).status;
        if (st && st !== 'Reported') return false;
        return TVC_RBAC.canConfirmDepartment(state.user, log.department || state.department);
    }

    function isHistRowCheckable(entry) {
        if (TVC_RBAC.isHqAccount(state.user)) {
            return isHistRowHqApprovable(entry);
        }
        if (isHistConsumeEntry(entry)) return isHistConsumeRowConfirmable(entry);
        if (isHistPermitEntry(entry)) return isHistPermitRowConfirmable(entry);
        if (isHistDefectEntry(entry)) return isHistDefectRowConfirmable(entry);
        const { report: r } = entry;
        if (!state.user || r.is_locked || reportIsApproved(r)) return false;
        return histEntryHasReportedItem(entry);
    }

    function isHistDefectRowHqApprovable(entry) {
        if (!isHistDefectEntry(entry) || !state.user || !TVC_RBAC.isHqAccount(state.user)) return false;
        if (!TVC_RBAC.canApproveHqReport(state.user)) return false;
        const dc = entry.defect;
        if (dc.status === TVC_DefectCase.Status.CLOSED) return false;
        if (dc.approved_at || dc.approved_by) return false;
        const st = TVC_DefectCase.listWorkflowStatus(dc);
        if (st === 'Reported' || st === 'Confirmed' || st === 'Submitted') return true;
        if (TVC_RBAC.canHqDirectApprove(state.user, dc)) return true;
        return !!dc.confirmed_at;
    }

    function isHistRowHqApprovable(entry) {
        if (!state.user || !TVC_RBAC.isHqAccount(state.user) || !TVC_RBAC.canApproveHqReport(state.user)) return false;
        if (isHistPermitEntry(entry)) {
            const row = entry.permit;
            if (!row || row.approved_at || row.approved_by) return false;
            const st = TVC_WorkPermit.listWorkflowStatus(row);
            return st === 'Reported' || st === 'Confirmed' || st === 'Submitted';
        }
        if (isHistConsumeEntry(entry)) {
            const log = entry.consume;
            if (!log || log.approved_by || log.approved_at) return false;
            const st = consumeHistoryFields(log).status || 'Reported';
            return st === 'Reported' || st === 'Confirmed' || st === 'Submitted';
        }
        if (isHistDefectEntry(entry)) return isHistDefectRowHqApprovable(entry);
        const { report: r } = entry;
        if (!r || reportIsApproved(r) || r.is_locked) return false;
        if (TVC_RBAC.canHqDirectApprove(state.user, r)) return true;
        const st = workReportListWorkflowStatus(r);
        if (st === 'Approved') return false;
        if (st === 'Reported' || histEntryHasReportedItem(entry)) return true;
        if (!TVC_RBAC.isConfirmedStatus(r.status, r.is_locked) && st !== 'Confirmed' && st !== 'Submitted') return false;
        return r.work_type === 'MAINTENANCE' || r.work_type === 'TROUBLE' || r.work_type === 'POSTPONE';
    }

    function hqApprovePostponeDate(report) {
        TVC_WorkReport.fromLegacy(report);
        const item = TVC_WorkReport.getJobItems(report)[0];
        return String(
            report.approved_postpone_date || report.postpone_date
            || item?.form?.postponeDate || wfFromReport(report, 'postponeDate') || '',
        ).slice(0, 10);
    }

    function wfFromReport(report, key) {
        const item = TVC_WorkReport.getJobItems(report)[0];
        return item?.form?.[key] ?? report.report_form?.[key] ?? '';
    }

    function isHistRowApprovable(entry) {
        if (isHistPermitEntry(entry)) return isHistPermitRowConfirmable(entry);
        if (isHistDefectEntry(entry)) return isHistDefectRowConfirmable(entry);
        if (isHistConsumeEntry(entry)) return isHistConsumeRowConfirmable(entry);
        if (!isHistRowCheckable(entry)) return false;
        const { report: r } = entry;
        if (TVC_RBAC.isConfirmedStatus(r.status)) return false;
        return canConfirmHistReport(state.user, r);
    }

    function histCheckDisabledTitle(entry) {
        if (isHistConsumeEntry(entry)) {
            if (isHistConsumeRowConfirmable(entry) || isHistRowHqApprovable(entry)) return '';
            return 'Already confirmed, or Confirm permission required';
        }
        if (isHistPermitEntry(entry)) {
            if (isHistPermitRowConfirmable(entry)) return '';
            return 'Already confirmed, or Confirm permission required';
        }
        if (isHistDefectEntry(entry)) {
            const dc = entry.defect;
            if (!state.user) return 'Sign in required';
            if (TVC_RBAC.isHqAccount(state.user)) {
                if (dc.approved_at) return 'Approved';
                if (dc.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) return 'Eligible for Report Confirm or Approve';
                if (dc.confirmed_at) return 'Awaiting Approve';
                return 'Awaiting HQ — select Confirmed items only';
            }
            if (dc.confirmed_at || dc.confirmed_by) return 'Already confirmed';
            if (dc.approved_at || dc.approved_by) return 'Approved';
            if (dc.status === TVC_DefectCase.Status.CLOSED) return 'Closed';
            if (!TVC_DefectReport.isDefectReportConfirmable(dc)) {
                return 'No permission to confirm (Engine · C/E · Deck · C/O · Master · Captain · HQ)';
            }
            return 'Not selectable';
        }
        const { report: r, item } = entry;
        if (!state.user) return 'Sign in required';
        if (r.is_locked || reportIsApproved(r)) return 'Approved report';
        if (itemSt(item) !== 'REPORTED' && !isHistRowHqApprovable(entry)) return 'REPORTED or Confirmed items only';
            if (!TVC_RBAC.canConfirmDepartment(state.user, reportDept(r)) && !isHistRowHqApprovable(entry)) {
            return 'No permission to confirm (Engine · C/E · Deck · C/O · Master · Captain · HQ)';
        }
        if (TVC_RBAC.isConfirmedStatus(r.status) && !isHistRowHqApprovable(entry)) return 'Already confirmed';
        return 'Not selectable';
    }

    function pruneHistChecked() {
        const valid = new Set(workHistoryEntries().map(e => histEntryRowKey(e)));
        Object.keys(state._histChecked || {}).forEach(key => {
            if (!valid.has(key) || !state._histChecked[key]) delete state._histChecked[key];
        });
    }

    function ensureHistCellTipFloater() {
        let el = document.getElementById('histCellTipFloater');
        if (!el) {
            el = document.createElement('div');
            el.id = 'histCellTipFloater';
            el.className = 'hist-cell-tip-floater hidden';
            el.setAttribute('role', 'tooltip');
            document.body.appendChild(el);
        }
        return el;
    }

    function hideHistCellTipFloater() {
        const floater = document.getElementById('histCellTipFloater');
        if (!floater) return;
        floater.classList.add('hidden');
        floater.textContent = '';
    }

    function showHistCellTipFloater(tip) {
        const textEl = tip.querySelector('.vl-cell-tip-text');
        const truncated = textEl && textEl.scrollWidth > textEl.clientWidth + 1;
        if (!truncated) {
            hideHistCellTipFloater();
            return false;
        }
        const floater = ensureHistCellTipFloater();
        const text = tip.dataset.tip || textEl.textContent || '';
        floater.textContent = text;
        floater.classList.remove('hidden');
        floater.style.left = '-9999px';
        floater.style.top = '0';
        const fw = floater.offsetWidth;
        const fh = floater.offsetHeight;
        const anchor = tip.getBoundingClientRect();
        let left = anchor.left;
        let top = anchor.bottom + 4;
        if (top + fh > window.innerHeight - 8) top = anchor.top - fh - 4;
        if (top < 8) top = 8;
        if (left + fw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - fw - 8);
        if (left < 8) left = 8;
        floater.style.left = `${left}px`;
        floater.style.top = `${top}px`;
        return true;
    }

    function initHistCellTips() {
        document.querySelectorAll('#tab-history .sheet-table-wrap, #tab-history #histPmsListScroll').forEach(container => {
            if (container._histTipsBound) return;
            container._histTipsBound = true;
            const syncTip = (tip) => {
                const active = showHistCellTipFloater(tip);
                tip.classList.toggle('vl-cell-tip-active', active);
                tip.closest('td')?.classList.toggle('hist-cell-tip-open', active);
            };
            container.addEventListener('mouseover', (e) => {
                const tip = e.target.closest('.vl-cell-tip');
                if (!tip || !container.contains(tip)) return;
                syncTip(tip);
            });
            container.addEventListener('mouseout', (e) => {
                const from = e.target.closest('.vl-cell-tip');
                const to = e.relatedTarget?.closest?.('.vl-cell-tip');
                if (from && from !== to) {
                    from.classList.remove('vl-cell-tip-active');
                    from.closest('td')?.classList.remove('hist-cell-tip-open');
                    hideHistCellTipFloater();
                }
            });
            container.addEventListener('scroll', hideHistCellTipFloater, { passive: true });
        });
    }

    function matchDefectHistSearch(dc, q) {
        q = (q || '').toLowerCase().trim();
        if (!q) return true;
        const cols = defectHistoryColumns(dc);
        const hay = [
            cols.jobCode,
            cols.sort1,
            cols.sort2,
            cols.jobDetail,
            dc.case_no,
            dc.file_no,
            dc.pms_group_no,
            dc.pms_job_code,
            dc.job_name,
            dc.machinery_name,
            defectHistoryStatusLabel(dc),
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
    }

    function buildDefectHistRowHtml(dc, opts = {}) {
        const cols = opts.defectJobItem
            ? {
                jobCode: opts.defectJobItem.job_code || '',
                sort1: opts.defectJobItem.sort1 || '',
                sort2: opts.defectJobItem.sort2 || '',
                jobDetail: opts.defectJobItem.job_detail || dc.outline_maintenance_request || '',
                groupOnly: false,
            }
            : (defectIsBatch(dc)
                ? defectHistoryColumnsForJob(dc, state.idx?.jobById.get(defectPrimaryJobItem(dc)?.maintenance_job_id)
                    || state.jobs.find(j => j.job_code === defectPrimaryJobItem(dc)?.job_code))
                : defectHistoryColumns(dc));
        const dt = formatCmaxsHistDate(listReportedDateStr(dc));
        const st = defectHistoryStatusLabel(dc);
        const flags = defectHistoryFormFlags(dc);
        const sel = opts.selected ? ' row-selected' : '';
        const rowKey = opts.rowKey || histDefectRowKey(dc.id);
        const chk = opts.checkboxHtml ?? '<input type="checkbox" disabled>';
        const onclick = opts.onclick ? ` onclick="${opts.onclick}"` : '';
        const ondblclick = opts.ondblclick ? ` ondblclick="${opts.ondblclick}"` : '';
        const batchTag = (opts.isDefectBatchSummary || defectIsBatch(dc))
            ? `<span class="pill ok" title="Defect Report (multi-job)">B</span> `
            : '';
        const fileNoCell = opts.fileNoColumn
            ? `<td class="hist-file">${esc(String(dc.file_no || '').trim() || '—')}</td>`
            : '';
        const typeCell = opts.criticalColumn ? defectCriticalTypeCell(dc) : defectReportTypeCell();
        const critCell = opts.includeCriticalColumn ? defectCriticalTypeCell(dc) : '';
        const typeFileCritCells = (opts.includeCriticalColumn && opts.fileNoColumn)
            ? `${defectReportTypeCell()}${fileNoCell}${critCell}`
            : `${fileNoCell}${typeCell}${critCell}`;
        const detailCell = opts.omitDetailColumn ? '' : `<td class="hist-detail">${histCellHtml(cols.jobDetail)}</td>`;
        const useListColStyle = opts.omitDetailColumn || opts.historyListColumns;
        const atShipClass = useListColStyle ? 'hist-at-ship' : '';
        const atCompanyClass = useListColStyle ? 'hist-at-company' : '';
        return `<tr class="hist-row hist-row-defect${sel}" data-df-id="${escAttr(dc.id)}" data-hist-key="${escAttr(rowKey)}"${onclick}${ondblclick}>
                <td class="hist-chk" onclick="event.stopPropagation()">${chk}</td>
                ${typeFileCritCells}
                <td class="hist-code">${batchTag}${cols.jobCode ? `<strong>${esc(cols.jobCode)}</strong>` : '—'}</td>
                <td class="hist-sort1">${histCellHtml(cols.sort1)}</td>
                <td class="hist-sort2">${histCellHtml(cols.sort2)}</td>
                ${detailCell}
                <td class="hist-date">${esc(dt || '—')}</td>
                <td class="hist-status">${esc(st)}</td>
                ${histFlagCell(flags.repairRequest)}
                ${histFlagCell(flags.shoreSupport)}
                ${histFlagCell(flags.defectCleared)}
                ${histAttachmentCell(dc.ship_attachments, atShipClass)}
                ${histAttachmentCell(dc.company_attachments, atCompanyClass)}
                ${opts.spareDataCount != null
                    ? `<td class="hist-spare-data">${opts.spareDataCount}</td>`
                    : (opts.historyListColumns ? histSpareDataCell({ source: 'defect', defect: dc }) : '')}
            </tr>`;
    }

    function bindWorkHistoryTableEvents() {
        const body = document.getElementById('historyBody');
        if (!body || body._histEventsBound) return;
        body._histEventsBound = true;
        initHistCellTips();
        body.addEventListener('change', (ev) => {
            const cb = ev.target.closest('.hist-chk-input');
            if (!cb || cb.disabled) return;
            const row = cb.closest('tr[data-hist-key]');
            if (!row) return;
            ev.stopPropagation();
            toggleHistCheck(row.dataset.histKey, cb.checked, { rerender: false });
        });
        body.addEventListener('click', (ev) => {
            if (ev.target.closest('.hist-chk')) ev.stopPropagation();
        });
    }

    function reportIsApproved(r) {
        return !!r && TVC_RBAC.isApprovedStatus(r.status, r.is_locked);
    }

    /** Confirmed-by checkbox: stay checked after HQ Approve (status becomes APPROVED). */
    function reportShowsConfirmed(r) {
        if (!r) return false;
        if (r.confirmed_by || r.confirmed_at) return true;
        if (TVC_RBAC.isConfirmedStatus(r.status, r.is_locked)) return true;
        return TVC_RBAC.isApprovedStatus(r.status, r.is_locked);
    }

    function workReportListWorkflowStatus(report) {
        if (!report) return 'Reported';
        TVC_WorkReport.fromLegacy(report);
        if (TVC_RBAC.isApprovedStatus(report.status, report.is_locked)) return 'Approved';
        if (TVC_RBAC.isConfirmedStatus(report.status, report.is_locked)) {
            if (report.sync_status === 'SYNCED') return 'Submitted';
            return 'Confirmed';
        }
        return 'Reported';
    }

    /** Previous / Next navigation list — job-scoped when opened from Work Procedure */
    function workHistoryNavEntries() {
        if (state._histNavJobId) return jobWorkHistoryEntries(state._histNavJobId);
        return workHistoryEntries();
    }

    function isWorkProcedureHistNav() {
        return !!(state._histNavJobId && isModalOpen('workProcedureModal'));
    }

    function setWorkProcedureHistNavScope(fromWorkProcedure) {
        if (fromWorkProcedure && state._wpJobId) state._histNavJobId = state._wpJobId;
    }

    function clearWorkProcedureHistNavScope() {
        state._histNavJobId = null;
    }

    function getCurrentWrHistEntry() {
        if (!state._wrReportId) return null;
        return workHistoryNavEntries().find(entry => {
            if (isHistPermitEntry(entry) || isHistDefectEntry(entry) || isHistConsumeEntry(entry)) return false;
            if (entry.report.id !== state._wrReportId) return false;
            if (state._wrBatchItemId) return entry.item.maintenance_job_id === state._wrBatchItemId;
            return true;
        }) || null;
    }

    function histModifyDisabledTitle(entry) {
        if (!entry || canModifyHistEntry(entry)) return '';
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (isHistDefectEntry(entry) && TVC_DefectCase.isHqReplyExported(entry.defect)) {
                return 'HQ reply exported — modify not available';
            }
            if (isHistPermitEntry(entry) && TVC_WorkPermit.isHqReplyExported(entry.permit)) {
                return 'HQ reply exported — modify not available';
            }
            return 'Modify not available';
        }
        const st = isHistPermitEntry(entry)
            ? TVC_WorkPermit.listWorkflowStatus(entry.permit)
            : (isHistDefectEntry(entry)
                ? TVC_DefectCase.listWorkflowStatus(entry.defect)
                : workReportListWorkflowStatus(entry.report));
        if (st === 'Submitted') return 'Submitted — modify not available';
        if (st === 'Approved') return 'Approved — modify not available';
        return 'Modify not available';
    }

    function histEntryHqAwaitingApproval(entry) {
        if (!entry || !state.user || !TVC_RBAC.isHqAccount(state.user)) return false;
        if (isHistPermitEntry(entry)) return false;
        if (isHistDefectEntry(entry)) {
            const row = entry.defect;
            if (!row || row.status === TVC_DefectCase.Status.CLOSED) return false;
            if (TVC_DefectCase.isHqReplyExported(row)) return false;
            const shipSubmitted = !!(row.confirmed_at || row.confirmed_by || row.submitted_at || row.phase1_locked
                || row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY);
            return shipSubmitted;
        }
        const r = entry.report;
        if (!r) return false;
        return !reportIsApproved(r) && !r.is_locked;
    }

    function isHistWorkReportModifiableStatus(entry) {
        if (!entry) return false;
        if (histEntryHqAwaitingApproval(entry)) return true;
        if (isHistDefectEntry(entry)) {
            const row = entry.defect;
            return !!(row && (TVC_DefectCase.canModifyListWorkflow(row)
                || TVC_DefectReport?.canModifyDfShipCommentsOnly?.(row)));
        }
        const r = entry?.report;
        if (!r) return false;
        if (TVC_RBAC.isApprovedStatus(r.status, r.is_locked)) return false;
        if (TVC_RBAC.isConfirmedStatus(r.status, r.is_locked) && r.sync_status === 'SYNCED') return false;
        const st = workReportListWorkflowStatus(r);
        return st !== 'Approved' && st !== 'Submitted';
    }

    function canModifyHistEntry(entry) {
        if (!entry || !state.user) return false;
        if (isHistConsumeEntry(entry)) return false;
        if (histEntryHqAwaitingApproval(entry)) return true;
        if (isHistPermitEntry(entry)) {
            if (TVC_WorkPermit.canModifyListWorkflow(entry.permit)) return true;
            return !!(TVC_WorkPermitReport?.canOpenWpHqCommentEdit?.(entry.permit));
        }
        if (isHistDefectEntry(entry)) {
            return TVC_DefectReport?.canOpenDfModifyRow?.(entry.defect) ?? false;
        }
        const r = entry?.report;
        if (!r) return false;
        const st = workReportListWorkflowStatus(r);
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (st === 'Approved' && r.sync_status === 'SYNCED') return false;
            if (st === 'Approved') return TVC_RBAC.canApproveHqReport(state.user);
            return st === 'Submitted' || TVC_RBAC.canModifyDeleteListReport(state.user, reportDept(r), st);
        }
        if (TVC_RBAC.isApprovedStatus(r.status, r.is_locked)) return false;
        if (TVC_RBAC.isConfirmedStatus(r.status, r.is_locked) && r.sync_status === 'SYNCED') return false;
        if (st === 'Approved' || st === 'Submitted') return false;
        return TVC_RBAC.canModifyDeleteListReport(state.user, reportDept(r), st);
    }

    function canDeleteHistEntry(entry) {
        if (isHistPermitEntry(entry) || isHistConsumeEntry(entry)) return false;
        if (isHistDefectEntry(entry)) {
            return TVC_DefectReport?.canDeleteDfListRow?.(entry.defect) ?? false;
        }
        const r = entry?.report;
        if (!r || !state.user) return false;
        if (TVC_RBAC.isApprovedStatus(r.status, r.is_locked)) return false;
        if (TVC_RBAC.isConfirmedStatus(r.status, r.is_locked) && r.sync_status === 'SYNCED') return false;
        const st = workReportListWorkflowStatus(r);
        if (st === 'Approved' || st === 'Submitted') return false;
        if (r.is_locked || reportIsApproved(r)) return false;
        return TVC_RBAC.canModifyDeleteListReport(state.user, reportDept(r), st);
    }

    function getHistHqApproveCandidates() {
        const checkedEntries = workHistoryEntries().filter(e =>
            state._histChecked?.[histEntryRowKey(e)]
        );
        const hqApprovable = checkedEntries.filter(isHistRowHqApprovable);
        if (hqApprovable.length) return hqApprovable;
        const entry = getSelectedHistEntry();
        if (entry && isHistRowHqApprovable(entry)) return [entry];
        return [];
    }

    function canHqApproveHistReports(candidates) {
        if (!candidates.length) return false;
        return candidates.every(isHistRowHqApprovable);
    }

    function getHistConfirmCandidates() {
        const checkedEntries = workHistoryEntries().filter(e =>
            state._histChecked?.[histEntryRowKey(e)]
        );
        if (checkedEntries.length) return checkedEntries.filter(isHistRowApprovable);
        const entry = getSelectedHistEntry();
        if (entry && isHistRowApprovable(entry)) return [entry];
        return [];
    }

    function canConfirmHistReports(candidates) {
        if (!candidates.length) return false;
        return candidates.every(entry => {
            if (isHistDefectEntry(entry)) return isHistDefectRowConfirmable(entry);
            if (isHistPermitEntry(entry)) return isHistPermitRowConfirmable(entry);
            if (isHistConsumeEntry(entry)) return isHistConsumeRowConfirmable(entry);
            const { report: r } = entry;
            if (!r) return false;
            if (r.is_locked || reportIsApproved(r)) return false;
            if (TVC_RBAC.isConfirmedStatus(r.status, r.is_locked)) return false;
            if (!histEntryHasReportedItem(entry)) return false;
            return state.user && TVC_RBAC.canConfirmDepartment(state.user, reportDept(r));
        });
    }

    function updateHistToolbarState() {
        const entry = getSelectedHistEntry();
        const checkedEntries = workHistoryEntries().filter(e =>
            state._histChecked?.[histEntryRowKey(e)]
        );
        const confirmCandidates = getHistConfirmCandidates();
        const hqApproveCandidates = getHistHqApproveCandidates();
        const checkedApprovableCount = checkedEntries.filter(isHistRowApprovable).length;
        const checkedHqApproveCount = checkedEntries.filter(isHistRowHqApprovable).length;
        const canConfirm = checkedEntries.length
            ? checkedEntries.length === checkedApprovableCount && canConfirmHistReports(confirmCandidates)
            : canConfirmHistReports(confirmCandidates);
        const canHqApprove = TVC_RBAC.isHqAccount(state.user) && (
            checkedEntries.length
                ? checkedEntries.length === checkedHqApproveCount && canHqApproveHistReports(hqApproveCandidates)
                : canHqApproveHistReports(hqApproveCandidates)
        );
        const setDis = (id, dis) => {
            const el = document.getElementById(id);
            if (el) { if (dis) el.setAttribute('disabled', ''); else el.removeAttribute('disabled'); }
        };
        const setVis = (id, show) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !show);
        };
        setDis('histBtnDetail', !entry);
        setVis('histBtnModify', !!entry);
        setDis('histBtnModify', !entry || !canModifyHistEntry(entry));
        const histModBtn = document.getElementById('histBtnModify');
        if (histModBtn) {
            const modTip = histModifyDisabledTitle(entry);
            if (modTip) histModBtn.setAttribute('title', modTip);
            else histModBtn.removeAttribute('title');
        }
        setDis('histBtnDelete', !entry || !canDeleteHistEntry(entry));
        const isHq = TVC_RBAC.isHqAccount(state.user);
        const role = state.user
            ? (TVC_RBAC.resolveUserRole?.(state.user) || state.user.role)
            : null;
        // 작성자(engineer/officer)·HQ: Confirm 숨김 (확인자 ce/captain만 표시)
        const showReportConfirm = !isHq && role !== TVC_RBAC.Role.SHIP_OFFICER;
        setVis('histBtnApprove', showReportConfirm);
        setDis('histBtnApprove', !canConfirm);
        const approveBtn = document.getElementById('histBtnApprove');
        if (approveBtn && showReportConfirm) {
            approveBtn.textContent = checkedApprovableCount >= 1
                ? `Confirm (${checkedApprovableCount})`
                : 'Confirm';
        }
        const hqApproveBtn = document.getElementById('histBtnHqApprove');
        if (hqApproveBtn) {
            hqApproveBtn.classList.toggle('hidden', !isHq);
            setDis('histBtnHqApprove', !canHqApprove);
            hqApproveBtn.textContent = checkedHqApproveCount >= 1
                ? `Approve (${checkedHqApproveCount})`
                : 'Approve';
        }

        const approvable = workHistoryEntries().filter(isHistRowCheckable);
        const allEl = document.getElementById('histSelectAll');
        if (allEl && approvable.length) {
            const allOn = approvable.every(e => state._histChecked[histEntryRowKey(e)]);
            allEl.checked = allOn;
            allEl.indeterminate = !allOn && approvable.some(e => state._histChecked[histEntryRowKey(e)]);
        } else if (allEl) {
            allEl.checked = false;
            allEl.indeterminate = false;
        }
    }

    function toggleHistCheck(rowKey, on, opts = {}) {
        state._histChecked = state._histChecked || {};
        if (on) state._histChecked[rowKey] = true;
        else delete state._histChecked[rowKey];
        if (opts.rerender === false) {
            updateHistToolbarState();
            return;
        }
        renderWorkHistory();
    }

    function toggleHistSelectAll(on) {
        state._histChecked = state._histChecked || {};
        workHistoryEntries().filter(isHistRowCheckable).forEach(e => {
            const key = histEntryRowKey(e);
            if (on) state._histChecked[key] = true;
            else delete state._histChecked[key];
        });
        renderWorkHistory();
    }

    function openDefectFromHistory(defectId, opts = {}) {
        if (!defectId) return;
        if (opts.fromWorkProcedure) setWorkProcedureHistNavScope(true);
        else if (!opts.preserveNavScope) clearWorkProcedureHistNavScope();
        state._histSelReportId = histDefectRowKey(defectId);
        syncHistRowSelection({ scrollIntoView: true });
        const wpStack = opts.fromWorkProcedure && isModalOpen('workProcedureModal');
        const hide = histSwapHideId('defectReportModal');
        TVC_DefectReport.openCaseFromNav(defectId, 'history', 'view', wpStack
            ? { stackOverWp: true, preserveNavScope: true, swapHide: hide || undefined }
            : { swapHide: hide || 'workReportModal' });
    }

    function syncHistRowSelection(opts = {}) {
        const body = document.getElementById('historyBody');
        if (!body) return;
        const key = state._histSelReportId;
        let selectedRow = null;
        body.querySelectorAll('tr.hist-row').forEach(tr => {
            const match = !!(key && tr.dataset.histKey === key);
            tr.classList.toggle('row-selected', match);
            if (match) selectedRow = tr;
        });
        if (opts.scrollIntoView && selectedRow) {
            selectedRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function findCurrentWorkHistoryNavIndex(list) {
        if (state._histSelReportId) {
            const i = list.findIndex(e => histEntryRowKey(e) === state._histSelReportId);
            if (i >= 0) return i;
        }
        if (state._workPermitId) {
            const i = list.findIndex(e => isHistPermitEntry(e) && e.permit?.id === state._workPermitId);
            if (i >= 0) return i;
        }
        if (state._defectCaseId) {
            const i = list.findIndex(e => isHistDefectEntry(e) && e.defect.id === state._defectCaseId);
            if (i >= 0) return i;
        }
        const consumeId = TVC_SpareMenu?.currentConsumeHistLogId?.();
        if (consumeId) {
            const i = list.findIndex(e => isHistConsumeEntry(e) && e.consume?.id === consumeId);
            if (i >= 0) return i;
        }
        if (state._wrReportId) {
            const i = list.findIndex(e => {
                if (isHistPermitEntry(e) || isHistDefectEntry(e) || isHistConsumeEntry(e) || !e.report) return false;
                if (e.report.id !== state._wrReportId) return false;
                if (state._wrBatchItemId) {
                    return e.item.maintenance_job_id === state._wrBatchItemId
                        || e.item.job_code === state.idx?.jobById.get(state._wrBatchItemId)?.job_code;
                }
                return true;
            });
            if (i >= 0) return i;
        }
        return -1;
    }

    function visibleHistReportModalId() {
        if (isModalOpen('workPermitModal') && !state._wpListMode) return 'workPermitModal';
        if (isModalOpen('defectReportModal')) return 'defectReportModal';
        if (isModalOpen('workReportModal')) return 'workReportModal';
        if (isModalOpen('spareConsumeModal') && TVC_SpareMenu?.isConsumeHistoryView?.()) return 'spareConsumeModal';
        return null;
    }

    function histSwapHideId(targetId) {
        const cur = visibleHistReportModalId();
        return cur && cur !== targetId ? cur : null;
    }

    function openWorkHistoryEntry(entry, opts = {}) {
        const wpNav = isWorkProcedureHistNav();
        state._histSelReportId = histEntryRowKey(entry);
        if (!wpNav) syncHistRowSelection({ scrollIntoView: true });
        const navOpts = {
            preservePage: !!opts.preservePage,
            preserveScroll: !!opts.preserveScroll,
            preserveNavScope: !!opts.preserveNavScope,
        };
        const swapOpts = { preserveScroll: navOpts.preserveScroll, overWorkProcedure: wpNav };
        if (isHistPermitEntry(entry)) {
            openWorkPermitFromHistory(entry.permit.id, {
                fromHistory: true,
                preserveNavScope: true,
                preservePage: !!opts.preservePage,
                swapOpts,
                fromWorkProcedure: wpNav,
            });
            return;
        }
        if (isHistConsumeEntry(entry)) {
            openConsumeFromHistory(entry.consume.id, {
                preserveNavScope: true,
                swapOpts,
            });
            return;
        }
        if (isHistDefectEntry(entry)) {
            const defectOpts = { ...navOpts, swapOpts };
            const hide = histSwapHideId('defectReportModal');
            if (hide) defectOpts.swapHide = hide;
            else if (wpNav) defectOpts.stackOverWp = true;
            TVC_DefectReport.openCaseFromNav(entry.defect.id, 'history', 'view', defectOpts);
            return;
        }
        const wrOpts = {
            fromHistory: true,
            keepTab: opts.keepTab || state._wrTab,
            ...navOpts,
            swapOpts,
        };
        if (opts.preserveWrMode && state._wrFromHistory) {
            wrOpts.view = !!(state._wrReadonly || state._wrPostSaveView);
            wrOpts.edit = !state._wrReadonly && !state._wrPostSaveView;
        } else {
            wrOpts.view = true;
        }
        const hideWr = histSwapHideId('workReportModal');
        if (hideWr) wrOpts.swapHide = hideWr;
        else if (wpNav && isModalOpen('workReportModal')) wrOpts.skipModalToggle = true;
        else if (wpNav) wrOpts.fromWorkProcedure = true;
        openWorkReportFromHistory(entry.report.id, entry.item.maintenance_job_id, wrOpts);
    }

    /** Work History modal — Prev/Next boundary (first/last item) */
    function workHistoryNavBounds() {
        const list = workHistoryNavEntries();
        if (!list.length) return { atFirst: true, atLast: true, index: -1 };
        let i = findCurrentWorkHistoryNavIndex(list);
        if (i < 0) i = 0;
        return { atFirst: i <= 0, atLast: i >= list.length - 1, index: i };
    }

    function histNavButtonsHtml(prevOnclick, nextOnclick) {
        const { atFirst, atLast } = workHistoryNavBounds();
        return `<button type="button" class="btn" onclick="${prevOnclick}"${atFirst ? ' disabled' : ''}>&laquo; Previous</button>
            <button type="button" class="btn" onclick="${nextOnclick}"${atLast ? ' disabled' : ''}>Next &raquo;</button>`;
    }

    /** Work History 목록 — Previous / Next (job-scoped when opened from Work Procedure) */
    async function navWorkHistoryEntry(dir) {
        const list = workHistoryNavEntries();
        if (!list.length) return;
        let i = findCurrentWorkHistoryNavIndex(list);
        if (i < 0) i = 0;
        else i += dir;
        if (i < 0 || i >= list.length) return;
        openWorkHistoryEntry(list[i], {
            preserveWrMode: true,
            preserveNavScope: true,
            keepTab: state._wrTab,
            preservePage: true,
            preserveScroll: true,
        });
    }

    async function histDetailWorkReport() {
        const entry = getSelectedHistEntry();
        if (!entry) { await TVC_Dialog.alert('Select an item from Work History.'); return; }
        if (isHistPermitEntry(entry)) {
            openWorkPermitFromHistory(entry.permit.id, { fromHistory: true });
            return;
        }
        if (isHistConsumeEntry(entry)) {
            openConsumeFromHistory(entry.consume.id);
            return;
        }
        if (isHistDefectEntry(entry)) {
            openDefectFromHistory(entry.defect.id);
            return;
        }
        openWorkReportFromHistory(entry.report.id, entry.item.maintenance_job_id, { fromHistory: true, view: true });
    }

    async function histModifyReport() {
        const entry = getSelectedHistEntry();
        if (!entry) await TVC_Dialog.alert('Select an item from Work History.');
        if (isHistPermitEntry(entry)) {
            if (!canModifyHistEntry(entry)) {
                await TVC_Dialog.alert('This Work Permit cannot be modified.');
                return;
            }
            openWorkPermitFromHistory(entry.permit.id, { fromHistory: true, edit: true });
            return;
        }
        if (isHistConsumeEntry(entry)) {
            await TVC_Dialog.alert('Open the Consumption Report to modify it.');
            return;
        }
        if (isHistDefectEntry(entry)) {
            return TVC_DefectReport.dfModifyCase(entry.defect.id, 'history', {
                swapHide: histSwapHideId('defectReportModal') || 'workReportModal',
            });
        }
        if (!canModifyHistEntry(entry)) {
            if (TVC_RBAC.isHqAccount(state.user)) {
                await TVC_Dialog.alert('Modify permission denied.');
            } else {
                const st = workReportListWorkflowStatus(entry.report);
                if (st === 'Confirmed') await TVC_Dialog.alert('Only Captain / Chief Engineer can modify Confirmed items.');
                else await TVC_Dialog.alert('Cannot modify Approved or Submitted items.');
            }
            return;
        }
        openWorkReportFromHistory(entry.report.id, entry.item.maintenance_job_id, { fromHistory: true, edit: true });
    }

    async function histReportApproval() {
        const checkedEntries = workHistoryEntries().filter(e =>
            state._histChecked?.[histEntryRowKey(e)]
        );
        const confirmCandidates = getHistConfirmCandidates();
        if (!confirmCandidates.length) {
            await TVC_Dialog.alert('Select one or more REPORTED items to confirm.');
        }
        if (checkedEntries.length && confirmCandidates.length !== checkedEntries.filter(isHistRowApprovable).length) {
            await TVC_Dialog.alert('Some selected items cannot be confirmed.\nCheck Engine (C/E), Deck (C/O), Master (Captain), or HQ permission.');
        }

        const user = await TVC_Auth.requirePermission(TVC_RBAC.Action.APPROVE_DAILY_REPORT);
        if (!user) return;

        const defectEntries = confirmCandidates.filter(isHistDefectEntry);
        const permitEntries = confirmCandidates.filter(isHistPermitEntry);
        const consumeEntries = confirmCandidates.filter(isHistConsumeEntry);
        const workEntries = confirmCandidates.filter(e =>
            !isHistDefectEntry(e) && !isHistPermitEntry(e) && !isHistConsumeEntry(e)
        );

        if (TVC_RBAC.isHqAccount(user) && defectEntries.length) {
            const pending = defectEntries.filter(e =>
                e.defect.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
            );
            if (pending.length) {
                TVC_DefectReport.openCase(pending[0].defect.id, 'phase2');
                return;
            }
        }

        const reportIds = [...new Set(workEntries.map(e => e.report.id))];
        for (const id of reportIds) {
            const rep = state.reports.find(r => r.id === id);
            if (!rep) {
                await TVC_Dialog.alert('Report not found.');
                return;
            }
            const hasReported = TVC_WorkReport.getJobItems(rep).some(i => itemSt(i) === 'REPORTED');
            if (!hasReported) {
                await TVC_Dialog.alert(`${rep.job_code}: Cannot confirm in this status.`);
                return;
            }
            if (!canConfirmHistReport(user, rep)) {
                const dept = reportDept(rep);
                await TVC_Dialog.alert(`Cannot confirm ${rep.job_code || id}: other department (${dept || '?'}) or permission denied.`);
                return;
            }
        }

        const defectToConfirm = defectEntries.filter(e => TVC_DefectReport.isDefectReportConfirmable(e.defect));
        const permitToConfirm = permitEntries.filter(isHistPermitRowConfirmable);
        const consumeToConfirm = consumeEntries.filter(isHistConsumeRowConfirmable);
        const totalCount = reportIds.length + defectToConfirm.length + permitToConfirm.length + consumeToConfirm.length;
        if (!totalCount) await TVC_Dialog.alert('No items available to confirm.');

        const parts = [];
        if (reportIds.length) parts.push(`${reportIds.length} Work Report(s)`);
        if (defectToConfirm.length) parts.push(`${defectToConfirm.length} Defect Report(s)`);
        if (permitToConfirm.length) parts.push(`${permitToConfirm.length} Work Permit(s)`);
        if (consumeToConfirm.length) parts.push(`${consumeToConfirm.length} Consumption Report(s)`);
        const wrNote = reportIds.length ? '\n(LAST DONE / NEXT DATE update)' : '';
        if (!await TVC_Dialog.confirm({ message: `Confirm ${parts.join(' · ')}?${wrNote}` })) return;

        let ok = 0;
        for (const id of reportIds) {
            const rep = state.reports.find(r => r.id === id);
            try {
                await TVC_Transaction.confirmReport(user, id);
                ok++;
            } catch (e) {
                const label = rep?.job_code || id;
                await TVC_Dialog.alert(`${label}: ${e.message || e.code || 'Confirm failed'}`);
                break;
            }
        }
        for (const entry of defectToConfirm) {
            try {
                await TVC_DefectCaseService.saveApprovalMeta(user, entry.defect.id, { confirm: true });
                ok++;
            } catch (e) {
                await TVC_Dialog.alert(`${entry.defect.case_no || entry.defect.id}: ${e.message || e.code || 'Confirm failed'}`);
                break;
            }
        }
        for (const entry of permitToConfirm) {
            try {
                await TVC_WorkPermitCaseService.saveApprovalMeta(user, entry.permit.id, { confirm: true });
                ok++;
            } catch (e) {
                await TVC_Dialog.alert(`${entry.permit.permit_no || entry.permit.id}: ${e.message || e.code || 'Confirm failed'}`);
                break;
            }
        }
        for (const entry of consumeToConfirm) {
            try {
                const done = await TVC_SpareMenu.confirmConsumeLogById(entry.consume.id);
                if (!done) throw new Error('Cannot confirm this consumption log.');
                ok++;
            } catch (e) {
                await TVC_Dialog.alert(`${entry.consume.file_no || entry.consume.id}: ${e.message || e.code || 'Confirm failed'}`);
                break;
            }
        }
        state._histChecked = {};
        await refreshAll();
        if (ok) await TVC_Dialog.alert(`${ok} item(s) confirmed`);
    }

    async function histHqReportApproval() {
        if (!TVC_RBAC.isHqAccount(state.user)) return;
        const checkedEntries = workHistoryEntries().filter(e =>
            state._histChecked?.[histEntryRowKey(e)]
        );
        const approveCandidates = getHistHqApproveCandidates();
        if (!approveCandidates.length) {
            await TVC_Dialog.alert('Select one or more Reported items to approve.');
        }
        if (checkedEntries.length && approveCandidates.length !== checkedEntries.filter(isHistRowHqApprovable).length) {
            await TVC_Dialog.alert('Some selected items cannot be approved.\nCheck Reported status and HQ approval permission.');
        }

        const user = await TVC_Auth.requirePermission(TVC_RBAC.Action.CONFIRM_REPORT);
        if (!user) return;

        const defectEntries = approveCandidates.filter(isHistDefectEntry);
        const permitEntries = approveCandidates.filter(isHistPermitEntry);
        const consumeEntries = approveCandidates.filter(isHistConsumeEntry);
        const workEntries = approveCandidates.filter(e =>
            !isHistDefectEntry(e) && !isHistPermitEntry(e) && !isHistConsumeEntry(e)
        );
        const reportIds = [...new Set(workEntries.map(e => e.report.id))];
        const postponeIds = reportIds.filter(id => {
            const rep = state.reports.find(r => r.id === id);
            return rep && rep.work_type === 'POSTPONE';
        });
        const maintenanceIds = reportIds.filter(id => !postponeIds.includes(id));

        for (const id of reportIds) {
            const rep = state.reports.find(r => r.id === id);
            if (!rep) {
                await TVC_Dialog.alert('Report not found.');
                return;
            }
            if (reportIsApproved(rep)) {
                await TVC_Dialog.alert(`${rep.job_code}: Already approved.`);
                return;
            }
        }

        const totalCount = reportIds.length + defectEntries.length + permitEntries.length + consumeEntries.length;
        if (!totalCount) await TVC_Dialog.alert('No items available to approve.');

        const parts = [];
        if (maintenanceIds.length) parts.push(`${maintenanceIds.length} Work Report(s)`);
        if (postponeIds.length) parts.push(`${postponeIds.length} Postpone Report(s)`);
        if (defectEntries.length) parts.push(`${defectEntries.length} Defect Report(s)`);
        if (permitEntries.length) parts.push(`${permitEntries.length} Work Permit(s)`);
        if (consumeEntries.length) parts.push(`${consumeEntries.length} Consumption Report(s)`);
        if (!await TVC_Dialog.confirm({ message: `Approve ${parts.join(' · ')}?` })) return;

        let companyComment = '';
        if (reportIds.length) {
            companyComment = await TVC_Dialog.promptText({
                title: "Company's Comments",
                message: `Enter company reply for ${reportIds.length} selected Work Report(s).`,
                defaultValue: 'WELL NOTED',
                placeholder: 'e.g. WELL NOTED',
            });
            if (companyComment === null) return;
        }

        let ok = 0;
        for (const id of reportIds) {
            try {
                const rep = state.reports.find(r => r.id === id);
                if (rep && !TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked)) {
                    await TVC_Transaction.confirmReport(user, id);
                }
                await TVC_Transaction.approveReport(user, id, companyComment);
                ok++;
            } catch (e) {
                await TVC_Dialog.alert(`${id}: ${e.message || e.code || 'Approve failed'}`);
                break;
            }
        }
        for (const entry of defectEntries) {
            try {
                const needConfirm = !entry.defect.confirmed_at && !entry.defect.confirmed_by;
                await TVC_DefectCaseService.saveApprovalMeta(user, entry.defect.id, {
                    confirm: needConfirm,
                    approve: true,
                });
                ok++;
            } catch (e) {
                await TVC_Dialog.alert(`${entry.defect.case_no || entry.defect.id}: ${e.message || e.code || 'Approve failed'}`);
                break;
            }
        }
        for (const entry of permitEntries) {
            try {
                const needConfirm = !entry.permit.confirmed_at && !entry.permit.confirmed_by;
                await TVC_WorkPermitCaseService.saveApprovalMeta(user, entry.permit.id, {
                    confirm: needConfirm,
                    approve: true,
                });
                ok++;
            } catch (e) {
                await TVC_Dialog.alert(`${entry.permit.permit_no || entry.permit.id}: ${e.message || e.code || 'Approve failed'}`);
                break;
            }
        }
        for (const entry of consumeEntries) {
            try {
                const done = await TVC_SpareMenu.approveConsumeLogById(entry.consume.id);
                if (!done) throw new Error('Cannot approve this consumption log.');
                ok++;
            } catch (e) {
                await TVC_Dialog.alert(`${entry.consume.file_no || entry.consume.id}: ${e.message || e.code || 'Approve failed'}`);
                break;
            }
        }
        state._histChecked = {};
        await refreshAll();
        if (ok) await TVC_Dialog.alert(`${ok} item(s) approved`);
    }

    async function histDeleteReport() {
        const entry = getSelectedHistEntry();
        if (!entry) {
            await TVC_Dialog.alert('Select an item from Work History.');
            return;
        }
        if (isHistPermitEntry(entry)) {
            await TVC_Dialog.alert('Delete Work Permits from the Work Permit form.');
            return;
        }
        if (isHistConsumeEntry(entry)) {
            await TVC_Dialog.alert('Open the Consumption Report to delete it.');
            return;
        }
        if (isHistDefectEntry(entry)) {
            return TVC_DefectReport.dfDeleteByIds([entry.defect.id], { clearHistSelection: true });
        }
        if (!canDeleteHistEntry(entry)) {
            const st = workReportListWorkflowStatus(entry.report);
            if (st === 'Submitted' || (entry.report.sync_status === 'SYNCED'
                && TVC_RBAC.isConfirmedStatus(entry.report.status, entry.report.is_locked))) {
                await TVC_Dialog.alert('Submitted reports cannot be deleted.');
                return;
            }
            if (reportIsApproved(entry.report) || entry.report.is_locked || st === 'Approved') {
                await TVC_Dialog.alert('HQ-approved (APPROVED) reports cannot be deleted.');
                return;
            }
            await TVC_Dialog.alert('Confirmed reports can be deleted by Captain / Chief Engineer only.');
            return;
        }
        state._wrReportId = entry.report.id;
        state._wrBatchItemId = entry.item.maintenance_job_id;
        await deleteWorkReport();
    }

    async function renderSpareReportHistory() {
        if (typeof TVC_SpareMenu?.renderReportHistory === 'function') {
            await TVC_SpareMenu.renderReportHistory();
            return;
        }
        const host = document.getElementById('spareHistReqListHost');
        if (host) host.innerHTML = '<p class="muted" style="padding:16px">SPARE Report History is not available.</p>';
    }

    function syncHistPmsListHeadPad() {
        const scroll = document.getElementById('histPmsListScroll');
        const head = document.getElementById('histPmsListHead');
        if (!scroll || !head) return;
        const sb = scroll.offsetWidth - scroll.clientWidth;
        head.style.paddingRight = sb > 0 ? `${sb}px` : '';
        if (scroll._histPmsPadBound) return;
        scroll._histPmsPadBound = true;
        scroll.addEventListener('scroll', () => {
            head.scrollLeft = scroll.scrollLeft;
        }, { passive: true });
    }

    /** Work Plan에서 작성된 Work Report를 기반으로 이력 표시 */
    function renderWorkHistory() {
        syncHistoryScopeUi();
        if (state.historyScope === 'spare') {
            void renderSpareReportHistory();
            return;
        }
        const body = document.getElementById('historyBody');
        if (!body) return;
        bindWorkHistoryTableEvents();
        syncHistPmsListHeadPad();
        pruneHistChecked();
        const all = workHistoryEntriesRaw();
        const entries = workHistoryEntries();
        const colSpan = 15;
        setText('histCount', `${entries.length} / ${all.length} entries`);
        const searchEl = document.getElementById('histSearch');
        if (searchEl && document.activeElement !== searchEl) searchEl.value = state.search || '';
        updateSearchClearBtn('histSearch');
        syncReportPeriodInputs();
        if (!all.length) {
            body.innerHTML = `<tr><td colspan="${colSpan}" class="muted" style="text-align:center">No reports yet.</td></tr>`;
            updateHistToolbarState();
            TVC_RunHours.syncRhToolbarUi();
            return;
        }
        if (!entries.length) {
            const noMatchMsg = (state.search || hasReportPeriodFilter())
                ? 'No matches for the current search or period filter.'
                : `No matches for "${esc(state.search)}".`;
            body.innerHTML = `<tr><td colspan="${colSpan}" class="muted" style="text-align:center">${noMatchMsg}</td></tr>`;
            updateHistToolbarState();
            TVC_RunHours.syncRhToolbarUi();
            return;
        }
        body.innerHTML = entries.map(entry => {
            if (isHistPermitEntry(entry)) {
                const row = entry.permit;
                const rowKey = histEntryRowKey(entry);
                const sel = state._histSelReportId === rowKey ? ' row-selected' : '';
                const cols = workPermitHistoryColumns(row || {});
                const job = histPrimaryJob(entry);
                const dt = formatCmaxsHistDate(listReportedDateStr(row));
                const st = TVC_WorkPermit.listWorkflowStatus(row);
                const fileNo = String(row?.file_no || '').trim();
                const canCheck = isHistRowCheckable(entry);
                const checked = canCheck && !!state._histChecked?.[rowKey];
                const chk = canCheck
                    ? `<input type="checkbox" class="hist-chk-input"${checked ? ' checked' : ''}>`
                    : `<input type="checkbox" disabled title="${escAttr(histCheckDisabledTitle(entry))}">`;
                return `<tr class="hist-row${sel}" data-hist-key="${escAttr(rowKey)}" onclick="TVC_App.selectHistRow('${escAttr(rowKey)}', event)" ondblclick="TVC_App.openWorkPermitFromHistory('${escAttr(row.id)}')">
                <td class="hist-chk" onclick="event.stopPropagation()">${chk}</td>
                ${histTypeCell(entry)}
                <td class="hist-file">${esc(fileNo || '—')}</td>
                ${histCriticalCell(entry)}
                <td class="hist-code">${cols.jobCode ? `<strong>${esc(cols.jobCode)}</strong>` : '—'}</td>
                <td class="hist-sort1">${histCellHtml(cols.sort1 || job?.item_sort1)}</td>
                <td class="hist-sort2">${histCellHtml(cols.sort2 || job?.item_sort2)}</td>
                <td class="hist-date">${esc(dt || '—')}</td>
                <td class="hist-status">${esc(st)}</td>
                ${histFlagCell(false)}
                ${histFlagCell(false)}
                ${histFlagCell(false)}
                ${histAttachmentCell(row?.ship_attachments || row?.attachments, 'hist-at-ship')}
                ${histAttachmentCell(row?.company_attachments, 'hist-at-company')}
                ${histSpareDataCell(entry)}
            </tr>`;
            }
            if (isHistConsumeEntry(entry)) {
                const log = entry.consume;
                const rowKey = histEntryRowKey(entry);
                const sel = state._histSelReportId === rowKey ? ' row-selected' : '';
                const f = consumeHistoryFields(log);
                const dt = formatCmaxsHistDate(f.date);
                const canCheck = isHistRowCheckable(entry);
                const checked = canCheck && !!state._histChecked?.[rowKey];
                const chk = canCheck
                    ? `<input type="checkbox" class="hist-chk-input"${checked ? ' checked' : ''}>`
                    : `<input type="checkbox" disabled title="${escAttr(histCheckDisabledTitle(entry))}">`;
                return `<tr class="hist-row${sel}" data-hist-key="${escAttr(rowKey)}" onclick="TVC_App.selectHistRow('${escAttr(rowKey)}', event)" ondblclick="TVC_App.openConsumeFromHistory('${escAttr(log.id)}')">
                <td class="hist-chk" onclick="event.stopPropagation()">${chk}</td>
                ${histTypeCell(entry)}
                <td class="hist-file">${esc(f.fileNo || '—')}</td>
                ${histCriticalCell(entry)}
                <td class="hist-code">${f.jobCode ? `<strong>${esc(f.jobCode)}</strong>` : '—'}</td>
                <td class="hist-sort1">${histCellHtml(f.sort1)}</td>
                <td class="hist-sort2">${histCellHtml(f.sort2)}</td>
                <td class="hist-date">${esc(dt || '—')}</td>
                <td class="hist-status">${esc(f.status || '—')}</td>
                ${histFlagCell(false)}
                ${histFlagCell(false)}
                ${histFlagCell(false)}
                ${histAttachmentCell(null, 'hist-at-ship')}
                ${histAttachmentCell(null, 'hist-at-company')}
                ${histSpareDataCell(entry)}
            </tr>`;
            }
            if (isHistDefectEntry(entry)) {
                const dc = entry.defect;
                const rowKey = histEntryRowKey(entry);
                const sel = state._histSelReportId === rowKey;
                const dfEntry = { source: 'defect', defect: dc };
                const canCheck = isHistRowCheckable(dfEntry);
                const checked = canCheck && !!state._histChecked?.[rowKey];
                const chk = canCheck
                    ? `<input type="checkbox" class="hist-chk-input"${checked ? ' checked' : ''}>`
                    : `<input type="checkbox" disabled title="${escAttr(histCheckDisabledTitle(dfEntry))}">`;
                return buildDefectHistRowHtml(dc, {
                    rowKey,
                    selected: sel,
                    checkboxHtml: chk,
                    fileNoColumn: true,
                    includeCriticalColumn: true,
                    omitDetailColumn: true,
                    historyListColumns: true,
                    isDefectBatchSummary: entry.isDefectBatchSummary,
                    defectJobItem: entry.defectJobItem,
                    onclick: `TVC_App.selectHistRow('${escAttr(rowKey)}', event)`,
                    ondblclick: `TVC_App.openDefectFromHistory('${escAttr(dc.id)}')`,
                });
            }
            const { report: r, item } = entry;
            const job = histPrimaryJob(entry);
            const f = item.form || wrReportForm(r);
            const dt = formatCmaxsHistDate(listReportedDateStr(r));
            const st = reportWorkflowStatusLabel(r, entry.isBatchSummary ? null : item);
            const flags = workHistoryFormFlags(f, r);
            const rowKey = histEntryRowKey(entry);
            const sel = state._histSelReportId === rowKey ? ' row-selected' : '';
            const batchTag = r.is_batch ? `<span class="pill ok" title="Work Report (multi-job)">B</span> ` : '';
            const displayJobCode = histDisplayJobCode(entry);
            const openJobId = item.maintenance_job_id;
            const wrEntry = { source: 'report', report: r, item };
            const canCheck = isHistRowCheckable(wrEntry);
            const checked = canCheck && !!state._histChecked?.[rowKey];
            const chk = canCheck
                ? `<input type="checkbox" class="hist-chk-input"${checked ? ' checked' : ''}>`
                : `<input type="checkbox" disabled title="${escAttr(histCheckDisabledTitle(wrEntry))}">`;
            const fileNo = String(f.fileNo || '').trim();
            return `<tr class="hist-row${sel}" data-hist-key="${escAttr(rowKey)}" onclick="TVC_App.selectHistRow('${escAttr(rowKey)}', event)" ondblclick="TVC_App.openWorkReportFromHistory('${escAttr(r.id)}','${escAttr(openJobId)}',{fromHistory:true,view:true,swapHide:'defectReportModal'})">
                <td class="hist-chk" onclick="event.stopPropagation()">${chk}</td>
                ${histTypeCell(wrEntry)}
                <td class="hist-file">${esc(fileNo || '—')}</td>
                ${histCriticalCell(wrEntry)}
                <td class="hist-code">${batchTag}${displayJobCode ? `<strong>${esc(displayJobCode)}</strong>` : '—'}</td>
                <td class="hist-sort1">${histCellHtml(job?.item_sort1)}</td>
                <td class="hist-sort2">${histCellHtml(job?.item_sort2)}</td>
                <td class="hist-date">${esc(dt || '—')}</td>
                <td class="hist-status">${esc(st)}</td>
                ${histFlagCell(flags.repairRequest)}
                ${histFlagCell(flags.shoreSupport)}
                ${histFlagCell(flags.defectCleared)}
                ${histAttachmentCell(f.shipAttachments, 'hist-at-ship')}
                ${histAttachmentCell(f.companyAttachments, 'hist-at-company')}
                ${histSpareDataCell(entry)}
            </tr>`;
        }).join('');
        updateHistToolbarState();
        TVC_RunHours.syncRhToolbarUi();
        TVC_ListFilters?.syncBtn('history');
    }

    /** Work History: 단일 클릭 — 행 선택 하이라이트(Work Plan과 동일 UX) */
    function selectHistRow(rowKey, ev) {
        if (ev?.target?.closest?.('.hist-chk')) return;
        state._histSelReportId = rowKey;
        syncHistRowSelection();
    }

    // ── Running Hours modal (예측 정비 엔진 UI) ───────────────────────
    function openRunHoursModal() {
        if (!runningHoursMenuVisible()) return;
        TVC_RunHours.resetInputEditMode();
        TVC_RunHours.render();
        showModal('runHoursModal');
    }

    function closeRunHoursModal() {
        closeModal('runHoursModal');
    }

    function renderRunHrs() { TVC_RunHours.render(); }
    function updateRunHrs() { return TVC_RunHours.updateAll(); }
    function revertRunHrs() { return TVC_RunHours.revert(); }
    function saveRunHrs(i) { return TVC_RunHours.save(i); }
    function runHrsPreview(i) { TVC_RunHours.preview(i); }

    // ── TAB: Unified SPARE ────────────────────────────────────────────
    function spareSessionUser() {
        const u = state.user || TVC_Auth.getCurrentUser();
        if (!u) return null;
        const role = u.role || TVC_RBAC.resolveUserRole(u);
        if (role && role !== u.role) {
            const fixed = { ...u, role };
            state.user = fixed;
            return fixed;
        }
        if (!state.user && u) state.user = u;
        return u;
    }

    function canEditSpareItems() {
        return TVC_RBAC.canModifySpareInventory(spareSessionUser());
    }

    function spareListSelectedIds() {
        return Object.keys(state.spareListSelected || {}).filter(id => state.spareListSelected[id]);
    }

    /** @deprecated spareListSelectedIds 사용 */
    function batchSelectedSpareIds() {
        return spareListSelectedIds();
    }

    /** ㅁ 체크 우선, 없으면 포커스(행 클릭) 행으로 Modify/Delete 대상 결정 */
    function spareActionIds(kind) {
        const checked = batchSelectedSpareIds();
        const sm = state.spareModule || {};
        const focused = state.focusedSpareId || sm.focusedId
            || (sm.reqWorkOpen ? sm.reqWorkFocusedId : null) || null;
        if (kind === 'modify') {
            if (checked.length === 1) return checked;
            if (!checked.length && focused) return [focused];
            return [];
        }
        if (checked.length) return checked;
        return focused ? [focused] : [];
    }

    function syncSpareItemToolbar() {
        if (typeof TVC_SpareMenu?.syncSpareToolbarUi === 'function') {
            return TVC_SpareMenu.syncSpareToolbarUi();
        }
        const tb = typeof TVC_SpareMenu?.spareToolbarFlags === 'function'
            ? TVC_SpareMenu.spareToolbarFlags(state)
            : null;
        if (tb && typeof TVC_SpareMenu?.applySpareToolbarFlags === 'function') {
            return TVC_SpareMenu.applySpareToolbarFlags(tb);
        }
        const canEdit = canEditSpareItems();
        const modifyIds = spareActionIds('modify');
        const deleteIds = spareActionIds('delete');
        const tip = 'Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission required';
        const pickTip = '행을 클릭하거나 ㅁ에서 선택하세요';
        const mod = document.getElementById('spareModifyBtn');
        if (mod) {
            const on = canEdit && modifyIds.length === 1;
            mod.disabled = !on;
            if (on) mod.removeAttribute('disabled');
            mod.title = !canEdit ? tip : (modifyIds.length ? '' : pickTip);
        }
        const del = document.getElementById('spareDeleteBtn');
        if (del) {
            const on = canEdit && deleteIds.length >= 1;
            del.disabled = !on;
            if (on) del.removeAttribute('disabled');
            del.title = !canEdit ? tip : (deleteIds.length ? '' : pickTip);
        }
        const appendBtn = document.getElementById('spareAppendBtn');
        if (appendBtn) {
            appendBtn.disabled = !canEdit;
            if (canEdit) appendBtn.removeAttribute('disabled');
            appendBtn.title = canEdit ? '신규 부품 등록' : tip;
        }
    }

    /** 행 본문 클릭 — 연한 파란색 포커스 + Modify/Delete 대상 */
    function focusSpareRow(spareId) {
        if (state.spareModule?.inlineEditId) return;
        state.focusedSpareId = spareId || null;
        modStateSpare().focusedId = state.focusedSpareId;
        TVC_SpareMenu.refreshList?.();
        if (typeof TVC_SpareMenu?.syncSpareToolbarUi === 'function') TVC_SpareMenu.syncSpareToolbarUi();
        else syncSpareItemToolbar();
    }

    function modStateSpare() {
        state.spareModule = state.spareModule || {
            focusedId: null,
            inlineEditId: null,
            inlineDraft: null,
        };
        return state.spareModule;
    }

    function selectSpareRow(spareId) { focusSpareRow(spareId); }

    /** ㅁ 체크박스 — 다중 선택 (체크 시 PMS Work Plan처럼 파란 포커스 이동) */
    function toggleSpareRow(spareId, checked) {
        if (!state.spareListSelected) state.spareListSelected = {};
        if (checked) {
            state.spareListSelected[spareId] = true;
            state.focusedSpareId = spareId;
            modStateSpare().focusedId = spareId;
        } else {
            delete state.spareListSelected[spareId];
        }
        TVC_SpareMenu.refreshList?.();
        requestAnimationFrame(() => {
            if (typeof TVC_SpareMenu?.syncSpareToolbarUi === 'function') TVC_SpareMenu.syncSpareToolbarUi();
            else syncSpareItemToolbar();
        });
    }

    async function openSpareAppend() {
        if (!canEditSpareItems()) await TVC_Dialog.alert('Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission required.');
        TVC_SpareMenu.append();
    }

    async function openSpareModify() {
        if (state.spareModule?.inlineEditId) {
            return TVC_SpareMenu.saveInlineEdit();
        }
        const ids = spareActionIds('modify');
        if (!ids.length) await TVC_Dialog.alert('Select a part to edit (click the row or check the box).');
        if (batchSelectedSpareIds().length > 1) await TVC_Dialog.alert('Modify supports only one selected item.');
        if (!canEditSpareItems()) await TVC_Dialog.alert('Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission required.');
        TVC_SpareMenu.edit(ids[0]);
    }

    async function deleteSpareItem() {
        const ids = spareActionIds('delete');
        if (!ids.length) await TVC_Dialog.alert('Select a part to delete (click the row or check the box).');
        if (!canEditSpareItems()) await TVC_Dialog.alert('Chief Engineer, Chief Officer, Captain, or HQ Superintendent permission required.');
        TVC_SpareMenu.deleteSpareItems(ids);
    }

    function renderSpareMenu() {
        if (!state.idx && (state.jobs || []).length) state.idx = TVC_Indexes.build(state);
        TVC_SpareMenu.render();
    }

    function renderSpicsAlertBanner() {
        const el = document.getElementById('spicsAlertBanner');
        if (!el) return;
        const alerts = state.spicsAlerts || [];
        if (!alerts.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
        el.classList.remove('hidden');
        el.innerHTML = `<strong>⚠ SPICS Low Stock</strong> — ${alerts.map(a =>
            `${esc(a.partNo)} (${a.stock}/${a.minStock ?? a.standard})`).join(' · ')}
            <button class="btn-sm" onclick="TVC_App.openSpicsRequisition()">청구서 작성</button>
            <button class="btn-sm" onclick="TVC_App.dismissSpicsAlerts()">Dismiss</button>`;
    }
    function openSpicsRequisition() { TVC_SpareMenu.suggestRequisition(state.spicsAlerts || []); }
    function dismissSpicsAlerts() { state.spicsAlerts = []; renderSpicsAlertBanner(); }

    // ── Job detail / procedure modals ────────────────────────────────
    /** Original / Work Plan: 더블 클릭 — CMAXS Work Procedure / Work History 모달 */
    async function openWorkProcedure(jobId, tab) {
        const job = resolveJobById(jobId);
        if (!job) {
            await TVC_Dialog.alert('Job not found.');
            return;
        }
        clearPlanRowRefreshTimer();
        _planRowLastTap = { id: null, t: 0 };
        if (state._wpJobId !== job.id) {
            state._wpTab = 'procedure';
            state._wpEditing = false;
        }
        state._wpJobId = job.id;
        state.selectedJobId = job.id;
        updatePlanRowSelectionHighlight(job.id);
        if (tab) state._wpTab = tab;
        try {
            renderWorkProcedureModal();
        } catch (err) {
            console.error('[WorkProcedure]', err);
            const host = document.getElementById('workProcedureBody');
            if (host) {
                host.innerHTML = `<p class="muted">Work Procedure 화면을 불러오지 못했습니다.</p>`;
            }
        }
        showModal('workProcedureModal');
        if (state.vlActual) state.vlActual.refresh();
        renderSidePanel();
    }

    async function setWorkProcedureTab(tab) {
        state._wpTab = tab;
        if (tab !== 'procedure') state._wpEditing = false;
        try {
            renderWorkProcedureModal();
        } catch (err) {
            console.error('[WorkProcedure tab]', err);
            await TVC_Dialog.alert('Failed to load Work History.');
        }
    }

    async function enterWorkProcedureEdit() {
        if (!canEditWorkProcedure()) {
            await TVC_Dialog.alert(workProcedureEditDeniedMessage());
            return;
        }
        state._wpEditing = true;
        renderWorkProcedureModal();
        requestAnimationFrame(() => document.getElementById('wpProcedureInput')?.focus());
    }

    function cancelWorkProcedureEdit() {
        state._wpEditing = false;
        renderWorkProcedureModal();
    }

    async function saveWorkProcedure() {
        const job = resolveJobById(state._wpJobId);
        if (!job) return;
        if (!canEditWorkProcedure()) {
            await TVC_Dialog.alert(workProcedureEditDeniedMessage());
            return;
        }
        const text = String(document.getElementById('wpProcedureInput')?.value ?? '').trim();
        TVC_JobMeta.setProcedure(job.job_code, text);
        TVC_JobMeta.addHistory(job.job_code, {
            action: 'PROCEDURE_SAVED',
            user: state.user?.display_name || '',
            notes: text.slice(0, 100),
        });
        state._wpEditing = false;
        renderWorkProcedureModal();
        await TVC_Dialog.success('Work Procedure saved.');
    }

    function renderWpAttachmentList(attachments, canRemove) {
        const list = attachments || [];
        if (!list.length) return '';
        const items = list.map(a => TVC_Attachments.renderListItemHtml(a, {
            canRemove,
            removeOnclick: canRemove
                ? `TVC_App.removeWorkProcedureAttachment('${escAttr(String(a.id))}')`
                : '',
        })).join('');
        return items ? `<div class="wr-attach-list-wrap"><ul class="wr-attach-list">${items}</ul></div>` : '';
    }

    function renderWorkProcedureModal() {
        const job = resolveJobById(state._wpJobId);
        const host = document.getElementById('workProcedureBody');
        if (!job || !host) return;
        const meta = TVC_JobMeta.getHistoryForJob(job.job_code);
        const histEntries = jobWorkHistoryEntries(job.id);
        const procActive = state._wpTab === 'procedure' ? ' active' : '';
        const histActive = state._wpTab === 'history' ? ' active' : '';

        let tabContent = '';
        if (state._wpTab === 'procedure') {
            const procText = meta.procedure || job.job_detail || '';
            const editing = !!state._wpEditing;
            const procField = editing
                ? `<textarea id="wpProcedureInput" class="wp-proc-input" rows="12" aria-label="Work Procedure">${esc(procText)}</textarea>`
                : `<div class="proc-box wp-proc-box">${esc(procText || 'No procedure registered.')}</div>`;
            tabContent = `
                <div class="wp-meta-row">
                    <span><b>Interval</b> ${job.period ?? '—'} ${esc(job.unit || '')}</span>
                    <span><b>Due Date</b> ${esc(job.next_date || '—')}</span>
                    <span><b>P.I.C</b> ${esc(job.pic || '—')}</span>
                </div>
                <label class="wp-label">Work Procedure</label>
                ${procField}`;
        } else {
            const histRows = histEntries.length ? histEntries.map(entry => {
                if (entry.source === 'defect') {
                    const dc = entry.defect;
                    const m = { letter: 'D', title: 'Defect Report' };
                    const fileNo = String(dc.file_no || '').trim() || '—';
                    const dt = formatCmaxsHistDate(listReportedDateStr(dc));
                    const st = defectHistoryStatusLabel(dc);
                    const desc = dc.outline_maintenance_request || dc.action_taken || '—';
                    const consumption = histEntryPage2SpareCount(entry);
                    const batchTag = entry.isDefectBatchSummary ? '<span class="pill ok" title="Defect Report (multi-job)">B</span> ' : '';
                    return `<tr class="wp-hist-row wp-hist-row-defect" ondblclick="TVC_App.openDefectFromHistory('${escAttr(dc.id)}',{fromWorkProcedure:true})" title="Double-click to open Defect Report">
                <td class="hist-type ${esc(m.title ? 'hist-type-defect' : '')}"><span class="hist-type-mark">${esc(m.letter)}</span> ${batchTag}</td>
                <td>${esc(fileNo)}</td>
                <td>${esc(dt || '—')}</td>
                <td><span class="pill ${histWorkflowStatusPillClass(st)}">${esc(st)}</span></td>
                <td>${esc(desc)}</td>
                <td class="num">${consumption}</td>
            </tr>`;
                }
                const { report: r, item } = entry;
                const m = histTypeMarker(entry);
                const f = item.form || wrReportForm(r);
                const fileNo = String(f.fileNo || r.report_form?.fileNo || '').trim() || '—';
                const dt = formatCmaxsHistDate(listReportedDateStr(r));
                const st = reportWorkflowStatusLabel(r, entry.isBatchSummary ? null : item);
                const desc = entry.isBatchSummary
                    ? (resolveBatchWrForm(r, item).outline || item.description || r.description || '—')
                    : (item.description || r.description || '—');
                const consumption = histEntryPage2SpareCount(entry);
                const openJobId = entry.isBatchSummary ? job.id : item.maintenance_job_id;
                return `<tr class="wp-hist-row" ondblclick="TVC_App.openWorkReportFromHistory('${escAttr(r.id)}','${escAttr(openJobId)}',{fromHistory:true,view:true,fromWorkProcedure:true})" title="Double-click to open Work Report">
                <td class="hist-type ${esc(m.cls)}"><span class="hist-type-mark">${esc(m.letter)}</span></td>
                <td>${esc(fileNo)}</td>
                <td>${esc(dt || '—')}</td>
                <td><span class="pill ${histWorkflowStatusPillClass(st)}">${esc(st)}</span></td>
                <td>${esc(desc)}</td>
                <td class="num">${consumption}</td>
            </tr>`;
            }).join('') : '<tr><td colspan="6" class="muted" style="text-align:center">No work history</td></tr>';
            tabContent = `
                <div class="wp-section">
                    <div class="wp-section-head">Report History <span class="muted wp-hist-hint">(double-click row to open report)</span></div>
                    <div class="wp-table-wrap">
                        <table class="wp-table">
                            <thead><tr>
                                <th>Type</th>
                                <th>File No.</th>
                                <th><span class="hist-th-stack"><span>Reported</span><span>Date</span></span></th>
                                <th>Status</th>
                                <th>Description</th>
                                <th class="num"><span class="hist-th-stack"><span>Spare</span><span>Data</span></span></th>
                            </tr></thead>
                            <tbody>${histRows}</tbody>
                        </table>
                    </div>
                </div>`;
        }

        const canEditProc = canEditWorkProcedure();
        const editingProc = state._wpTab === 'procedure' && !!state._wpEditing;
        const procEditTip = escAttr(workProcedureEditDeniedMessage());
        const canAttach = canEditProc && state._wpTab === 'procedure';
        const attachTip = escAttr(canAttach
            ? 'Attach files to this Work Procedure'
            : workProcedureEditDeniedMessage());
        let procEditBtns = '';
        if (state._wpTab === 'procedure') {
            procEditBtns = editingProc
                ? `<button type="button" class="btn btn-green" onclick="TVC_App.saveWorkProcedure()">Save</button>
                <button type="button" class="btn" onclick="TVC_App.cancelWorkProcedureEdit()">Cancel</button>`
                : `<button type="button" class="btn" onclick="TVC_App.enterWorkProcedureEdit()"${canEditProc ? '' : ` disabled title="${procEditTip}"`}>Modify</button>`;
        }

        const attachListHtml = renderWpAttachmentList(meta.attachments, canAttach);

        host.innerHTML = `
            <h3 class="wp-title">Work Procedure</h3>
            <div class="wp-job-head">
                <span><b>Code</b> ${esc(job.job_code)}</span>
                <span><b>SORT-1</b> ${esc(job.item_sort1 || '—')}</span>
                <span><b>SORT-2</b> ${esc(job.item_sort2 || '—')}</span>
            </div>
            <p class="wp-job-detail">${esc(job.job_detail || '')}</p>
            <div class="wp-tabs">
                <button type="button" class="wp-tab${procActive}" onclick="TVC_App.setWorkProcedureTab('procedure')">Work Procedure</button>
                <button type="button" class="wp-tab${histActive}" onclick="TVC_App.setWorkProcedureTab('history')">Report History</button>
            </div>
            <div class="wp-tab-pane wp-tab-pane-${state._wpTab}">${tabContent}</div>
            <div class="modal-actions wp-modal-actions">
                <div class="wp-modal-actions-left">
                    ${procEditBtns}
                    <button type="button" class="btn btn-green" onclick="TVC_App.closeModal('workProcedureModal');TVC_App.openWorkReportInput('${job.id}')"${editingProc ? ' disabled' : ''}>Make Report</button>
                    <button type="button" class="btn" onclick="TVC_App.closeModal('workProcedureModal')">Close</button>
                </div>
                <div class="wp-modal-actions-right wp-attach-panel">
                    <div class="wr-attach-toolbar">
                        <button type="button" class="wr-attach-btn" onclick="document.getElementById('wpAttachInput').click()"${canAttach ? '' : ' disabled'} title="${attachTip}">📎 Attachment</button>
                        <input type="file" id="wpAttachInput" class="hidden" multiple onchange="TVC_App.uploadWorkProcedureAttachment()">
                    </div>
                    ${attachListHtml}
                </div>
            </div>`;
    }

    async function uploadWorkProcedureAttachment() {
        if (!canEditWorkProcedure() || state._wpTab !== 'procedure') return;
        const job = resolveJobById(state._wpJobId);
        const input = document.getElementById('wpAttachInput');
        if (!job || !input?.files?.length) return;
        for (const f of input.files) await TVC_JobMeta.addAttachment(job.job_code, f);
        input.value = '';
        renderWorkProcedureModal();
    }

    function removeWorkProcedureAttachment(attachmentId) {
        if (!canEditWorkProcedure() || state._wpTab !== 'procedure') return;
        const job = resolveJobById(state._wpJobId);
        if (!job) return;
        TVC_JobMeta.removeAttachment(job.job_code, attachmentId);
        renderWorkProcedureModal();
    }

    // ── Make Report (Work Permit / Maintenance / Defect / Postpone) ───
    const WR_TABS = {
        repair: 'Maintenance',
        postpone: 'Postpone',
    };
    const REPORT_KIND_TABS = [
        ['permit', 'Work Permit'],
        ['repair', 'Maintenance'],
        ['defect', 'Defect'],
        ['postpone', 'Postpone'],
    ];

    function renderReportKindTabsHtml(activeKind) {
        const locked = state._reportKindLocked || null;
        return `<div class="wr-tabsel wr-report-kind-tabs">${REPORT_KIND_TABS.map(([k, label]) => {
            const on = k === activeKind;
            const tabLocked = !!(locked && k !== locked);
            return `<button type="button" class="wr-kind-tab${on ? ' active' : ''}${tabLocked ? ' locked' : ''}"
                ${tabLocked ? 'disabled title="This report type cannot be changed"' : `onclick="TVC_App.switchMakeReportKind('${k}')"`}>${esc(label)}</button>`;
        }).join('')}</div>`;
    }

    function currentMakeReportKind() {
        if (isModalOpen('workPermitModal') && !state._wpListMode) return 'permit';
        if (isModalOpen('defectReportModal')) return 'defect';
        if (state._wrTab === 'postpone') return 'postpone';
        return 'repair';
    }

    function resolveMakeReportJobId() {
        if (state._wrJobId && jobInCurrentViewDept(state._wrJobId)) return state._wrJobId;
        const checked = planContextCheckedJobIds();
        if (checked.length === 1) return checked[0];
        if (state.selectedJobId && jobInCurrentViewDept(state.selectedJobId)) return state.selectedJobId;
        const wpId = state._workPermitId;
        if (wpId) {
            const row = (state.workPermits || []).find(r => r.id === wpId);
            const jobId = row?.maintenance_job_id || (row?.job_items || [])[0]?.maintenance_job_id;
            if (jobId) return jobId;
        }
        const dfId = state._defectCaseId;
        if (dfId) {
            const dc = (state.defectCases || []).find(d => d.id === dfId);
            const jobId = dc?.maintenance_job_id || (dc?.job_items || [])[0]?.maintenance_job_id;
            if (jobId) return jobId;
        }
        return checked[0] || null;
    }

    function collectEditableFieldMap(host, attr) {
        const fields = {};
        if (!host) return fields;
        host.querySelectorAll(`[${attr}]`).forEach(el => {
            const key = el.getAttribute(attr);
            if (!key) return;
            if (el.readOnly || el.disabled) return;
            if (el.type === 'radio') {
                if (el.checked) fields[key] = String(el.value || '');
                return;
            }
            if (el.type === 'checkbox') fields[key] = !!el.checked;
            else fields[key] = String(el.value || '').trim();
        });
        return Object.fromEntries(Object.keys(fields).sort().map(k => [k, fields[k]]));
    }

    function wrMakeReportDirtySnapshot() {
        captureWorkReportForm();
        captureWorkReportUsedParts();
        captureWrJobItems();
        const f = state._wrForm || {};
        return JSON.stringify({
            fields: collectEditableFieldMap(document.getElementById('workReportBody'), 'data-wf'),
            group: String(f.pmsGroupKey || ''),
            jobs: (state._wrJobItems || []).map(i => [
                String(i.job_code || '').trim(),
                String(i.job_detail || '').trim(),
            ]),
            parts: (state._wrUsedParts || [])
                .filter(p => Number(p.qty_used) > 0)
                .map(p => [String(p.spare_part_id || ''), Number(p.qty_used) || 0]),
            shipAtt: (f.shipAttachments || []).length,
            companyAtt: (f.companyAttachments || []).length,
        });
    }

    function captureWrMakeReportDirtySnap() {
        state._wrMakeReportSnap = wrMakeReportDirtySnapshot();
    }

    function wrHasUnsavedMakeReportInput() {
        if (state._wrReadonly) return false;
        if (!state._wrMakeReportSnap) return false;
        return wrMakeReportDirtySnapshot() !== state._wrMakeReportSnap;
    }

    function hasUnsavedMakeReportInput() {
        const kind = currentMakeReportKind();
        if (kind === 'permit') return !!TVC_WorkPermitReport.hasUnsavedMakeReportInput?.();
        if (kind === 'defect') return !!TVC_DefectReport.hasUnsavedMakeReportInput?.();
        return wrHasUnsavedMakeReportInput();
    }

    async function confirmSwitchMakeReportKind() {
        if (!hasUnsavedMakeReportInput()) return true;
        return TVC_Dialog.confirm({
            message: 'Each tab is a separate report. Unsaved input on this tab is not kept.\n\nSwitch report type?',
        });
    }

    function currentMakeReportModalId() {
        if (isModalOpen('workPermitModal') && !state._wpListMode) return 'workPermitModal';
        if (isModalOpen('defectReportModal')) return 'defectReportModal';
        return 'workReportModal';
    }

    function hideMakeReportPeerModals(keep) {
        if (keep !== 'workReportModal') document.getElementById('workReportModal')?.classList.add('hidden');
        if (keep !== 'workPermitModal') document.getElementById('workPermitModal')?.classList.add('hidden');
        if (keep !== 'defectReportModal') document.getElementById('defectReportModal')?.classList.add('hidden');
    }

    async function switchMakeReportKind(kind) {
        if (!REPORT_KIND_TABS.some(([k]) => k === kind)) kind = 'repair';
        const current = currentMakeReportKind();
        if (kind === current) return;
        if (state._reportKindLocked && kind !== state._reportKindLocked) return;
        const ok = await confirmSwitchMakeReportKind();
        if (!ok) return;
        const jobId = resolveMakeReportJobId();
        if (!jobId) {
            await TVC_Dialog.alert('Select a job first.');
            return;
        }
        state._reportKindLocked = null;
        const fromId = currentMakeReportModalId();
        const swapOpts = { preserveScroll: true };
        if (kind === 'repair' || kind === 'postpone') {
            const stay = fromId === 'workReportModal';
            await openWorkReport(jobId, kind, {
                resetForm: true,
                skipModalToggle: stay,
                skipDragReset: true,
                swapHide: stay ? null : fromId,
                swapOpts,
            });
            return;
        }
        if (kind === 'permit') {
            await TVC_WorkPermitReport.openNewFromJob(jobId, {
                swapHide: fromId,
                swapOpts,
                fromMakeReport: true,
            });
            return;
        }
        await openNewDefectReportInput(jobId, {
            swapHide: fromId,
            swapOpts,
            fromMakeReport: true,
        });
    }

    function openWorkPermitFromHistory(id, opts = {}) {
        if (!id) return;
        if (opts.fromWorkProcedure) setWorkProcedureHistNavScope(true);
        else if (!opts.preserveNavScope) clearWorkProcedureHistNavScope();
        state._histSelReportId = histPermitRowKey(id);
        syncHistRowSelection({ scrollIntoView: true });
        const hide = histSwapHideId('workPermitModal');
        const wpNav = isWorkProcedureHistNav();
        TVC_WorkPermitReport.openCase(id, opts.edit ? 'edit' : 'view', {
            fromHistory: true,
            preservePage: !!opts.preservePage,
            skipModalToggle: !hide && isModalOpen('workPermitModal') && !state._wpListMode,
            swapHide: hide,
            swapOpts: opts.swapOpts || { overWorkProcedure: wpNav },
        });
    }

    function openConsumeFromHistory(id, opts = {}) {
        if (!id) return;
        if (opts.fromWorkProcedure) setWorkProcedureHistNavScope(true);
        else if (!opts.preserveNavScope) clearWorkProcedureHistNavScope();
        state._histSelReportId = histConsumeRowKey(id);
        syncHistRowSelection({ scrollIntoView: true });
        const hide = histSwapHideId('spareConsumeModal');
        const wpNav = isWorkProcedureHistNav();
        void TVC_SpareMenu?.openConsumeFromPmsHistory?.(id, {
            edit: !!opts.edit,
            skipModalToggle: !hide && isModalOpen('spareConsumeModal'),
            swapHide: hide,
            swapOpts: opts.swapOpts || { overWorkProcedure: wpNav, preserveScroll: !!opts.preserveScroll },
        });
    }

    /** Existing Work Report → tab must match saved work_type (no cross-switch) */
    /** Legacy TROUBLE records are treated as Maintenance within Work Report. */
    function normalizeWorkReportType(workType) {
        return workType === 'POSTPONE' ? 'POSTPONE' : 'MAINTENANCE';
    }

    function workReportTabForType(workType) {
        return normalizeWorkReportType(workType) === 'POSTPONE' ? 'postpone' : 'repair';
    }

    function currentWorkReportLockedTab() {
        if (!state._wrReportId) return null;
        const rep = state.reports.find(r => r.id === state._wrReportId);
        if (!rep) return null;
        return workReportTabForType(rep.work_type);
    }

    /** Original / Work Plan → Report Input: CMAXS 스타일 Work Report 화면 */
    async function openWorkReport(jobId, tab, opts = {}) {
        const job = state.idx.jobById.get(jobId);
        if (!job) return;
        if (job.department && !canReportJobDepartment(state.user, job.department)) {
            await TVC_Dialog.alert('Other department items cannot be reported.');
            return;
        }
        snapshotPlanBatchSelection();
        state._batchMode = false;
        state._batchJobIds = [];
        state._batchDraft = null;
        const prefill = Array.isArray(opts.prefillJobIds) ? opts.prefillJobIds.filter(Boolean) : null;
        if (opts.resetForm || state._wrJobId !== jobId || !state._wrReportId || (prefill && prefill.length > 1)) {
            const today = new Date().toISOString().slice(0, 10);
            state._wrForm = defaultWrForm(today);
            const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
            Object.assign(state._wrForm, {
                lastMaintDate: job.last_done || '',
                pmsGroupNo: hdr.pmsGroupNo || '',
                pmsGroupKey: `${job.department}|${String(job.group || '').trim()}`,
                maker: hdr.maker || '',
                modelType: hdr.modelType || '',
                capacity: hdr.capacity || '',
                serialNo: hdr.serialNo || '',
            });
            state._wrTab = 'repair';
            state._wrPage = '1';
            state._wrSpareSearch = '';
            state._wrJobItems = null;
        }
        if (prefill && prefill.length >= 2) {
            state._wrJobItems = buildWrJobItemsFromJobIds(prefill);
        }
        state._wrReportId = null;
        state._wrBatchItemId = null;
        state._wrReadonly = false;
        state._wrPostSaveView = false;
        state._wrFromHistory = false;
        state._wrJobId = jobId;
        state._wrUsedParts = [];
        state.selectedJobId = jobId;
        applyPlanBatchSelection(prefill?.length ? prefill : [jobId]);
        state._wrTab = tab || state._wrTab || 'repair';
        state._reportKindLocked = null;
        if (state.vlActual) state.vlActual.refresh();
        renderSidePanel();
        renderWorkReportModal();
        if (opts.swapHide) {
            swapHistoryModals('workReportModal', opts.swapHide, opts.swapOpts || {});
        } else if (!opts.skipModalToggle) {
            showModal('workReportModal', { skipDragReset: !!opts.skipDragReset });
        }
        captureWrMakeReportDirtySnap();
    }

    function resolveJobForWorkReport(item, rep) {
        if (!rep) return null;
        TVC_WorkReport.fromLegacy(rep);
        const mid = item?.maintenance_job_id || rep.maintenance_job_id;
        const code = String(item?.job_code || rep.job_code || '').trim();
        const dept = reportDept(rep) || rep.department || state.department;
        if (mid) {
            const byId = resolveJobById(mid);
            if (byId) return byId;
        }
        if (code) return resolveJobByCode(code, dept);
        return null;
    }

    /** Work History: 더블 클릭 — 저장된 Work Report를 그대로 재현(읽기 전용, Modify 가능) */
    async function openWorkReportFromHistory(reportId, jobId, opts = {}) {
        const rep = state.reports.find(r => r.id === reportId);
        if (!rep) {
            await TVC_Dialog.alert('Work Report not found in the current view.');
            return;
        }
        TVC_WorkReport.fromLegacy(rep);
        let item = jobId ? TVC_WorkReport.findItem(rep, jobId) : null;
        if (!item && jobId) {
            const hintJob = resolveJobById(jobId) || resolveJobByCode(jobId, reportDept(rep) || state.department);
            if (hintJob) item = TVC_WorkReport.findItem(rep, hintJob.job_code) || TVC_WorkReport.findItem(rep, hintJob.id);
        }
        if (!item) item = TVC_WorkReport.getJobItems(rep)[0];
        const job = resolveJobForWorkReport(item, rep);
        if (!job) { await TVC_Dialog.alert('Job item not found.'); return; }
        if (item && item.maintenance_job_id !== job.id) {
            item.maintenance_job_id = job.id;
            TVC_DB.put('daily_work_reports', rep).catch(() => {});
        }
        if (!rep.department && job.department) {
            rep.department = job.department;
            TVC_DB.put('daily_work_reports', rep).catch(() => {});
        }
        state._defectCaseId = null;
        state._wrJobId = job.id;
        state.selectedJobId = job.id;
        state._wrJobItems = null;
        state._wrReportId = reportId;
        const isBatchView = rep.is_batch && (rep.job_items || []).length > 1;
        state._wrBatchItemId = isBatchView ? null : (item?.maintenance_job_id || job.id);
        state._wrPostSaveView = false;
        state._wrFromHistory = !!opts.fromHistory;
        state._reportKindLocked = workReportTabForType(rep.work_type);
        if (opts.fromWorkProcedure) setWorkProcedureHistNavScope(true);
        else if (!opts.preserveNavScope) clearWorkProcedureHistNavScope();
        if (opts.fromHistory) {
            const histEntry = workHistoryNavEntries().find(e =>
                !isHistPermitEntry(e) && !isHistDefectEntry(e) && !isHistConsumeEntry(e)
                && e.report?.id === reportId
                && (e.isBatchSummary
                    || e.item.maintenance_job_id === job.id
                    || e.item.job_code === job.job_code)
            );
            if (histEntry) state._histSelReportId = histEntryRowKey(histEntry);
        }
        syncHistRowSelection({ scrollIntoView: !!opts.fromHistory });
        const histEntry = { source: 'report', report: rep, item };
        if (opts.edit) {
            state._wrReadonly = false;
        } else if (opts.fromHistory || opts.view) {
            state._wrReadonly = true;
        } else {
        state._wrReadonly = !canModifyHistEntry(histEntry);
        }
        state._wrForm = isBatchView
            ? resolveBatchWrForm(rep, item)
            : { ...(item?.form || rep.report_form || {}) };
        state._wrUsedParts = isBatchView
            ? enrichUsedParts(TVC_SpareMenu.aggregateUsedPartsFromWorkReport(rep))
            : enrichUsedParts(item?.used_parts || rep.used_parts || []);
        if (!opts.preservePage) state._wrPage = '1';
        state._wrSpareSearch = '';
        // Always open on the report's own type — never keep the opposite tab
        state._wrTab = workReportTabForType(rep.work_type);
        if (!opts.skipRender) {
            try {
                renderWorkReportModal({ preserveScroll: !!opts.preserveScroll });
            } catch (err) {
                console.error('[WorkReport] render failed', err);
                await TVC_Dialog.alert('Work Report could not be displayed.\n' + (err.message || String(err)));
                return;
            }
        }
        if (opts.edit) syncPlanBatchChecksFromJobItems(rep.job_items || []);
        const wrModal = document.getElementById('workReportModal');
        const wrOpen = wrModal && !wrModal.classList.contains('hidden');
        const wpStack = isWorkProcedureHistNav();
        if (opts.skipModalToggle) {
            if (wpStack) applyModalOverWorkProcedure('workReportModal');
            state._wrOverWorkProcedure = !!wpStack;
        } else if (opts.swapHide) {
            swapHistoryModals('workReportModal', opts.swapHide, opts.swapOpts || {});
            state._wrOverWorkProcedure = !!(wpStack || opts.swapOpts?.overWorkProcedure);
        } else {
            if (!wrOpen) showModal('workReportModal');
            if (wpStack || opts.fromWorkProcedure) {
                applyModalOverWorkProcedure('workReportModal');
                state._wrOverWorkProcedure = true;
            }
        }
    }

    /** 히스토리 읽기 뷰 → 편집 모드 전환 */
    function modifyWorkReport() {
        const histEntry = getCurrentWrHistEntry();
        if (histEntry && !canModifyHistEntry(histEntry)) return;
        state._wrReadonly = false;
        state._wrPostSaveView = false;
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const job = state.idx?.jobById.get(state._wrJobId);
        ensureWrJobItems(job, rep);
        syncPlanBatchChecksFromJobItems(state._wrJobItems);
        renderWorkReportModal();
    }

    function reloadWorkReportViewFromDb(report, job) {
        TVC_WorkReport.fromLegacy(report);
        const item = TVC_WorkReport.findItem(report, job.id)
            || TVC_WorkReport.getJobItems(report)[0];
        const isBatchView = report.is_batch && (report.job_items || []).length > 1;
        state._wrReportId = report.id;
        state._wrBatchItemId = isBatchView ? null : (item?.maintenance_job_id || null);
        state._wrForm = isBatchView
            ? resolveBatchWrForm(report, item)
            : { ...(item?.form || report.report_form || {}) };
        state._wrUsedParts = isBatchView
            ? enrichUsedParts(TVC_SpareMenu.aggregateUsedPartsFromWorkReport(report))
            : enrichUsedParts(item?.used_parts || report.used_parts || []);
        state._wrTab = report.work_type === 'POSTPONE' ? 'postpone' : 'repair';
        state._wrPage = '1';
        state._wrSpareSearch = '';
        state._wrJobItems = null;
        state._wrReadonly = true;
        state._wrPostSaveView = false;
    }

    async function cancelWorkReportEdit() {
        const id = state._wrReportId;
        const job = state.idx?.jobById.get(state._wrJobId);
        if (!id || !job) return requestCloseWorkReport();
        if (!state._wrFromHistory) return requestCloseWorkReport();
        TVC_SpareMenu.teardownWrSparePage2();
        const rep = state.reports.find(r => r.id === id);
        if (!rep) return;
        reloadWorkReportViewFromDb(rep, job);
        renderWorkReportModal();
    }

    function reloadWorkReportStateFromSaved(report, job) {
        TVC_WorkReport.fromLegacy(report);
        const item = TVC_WorkReport.findItem(report, job.id)
            || TVC_WorkReport.getJobItems(report)[0];
        const isBatchView = report.is_batch && (report.job_items || []).length > 1;
        state._wrReportId = report.id;
        state._wrBatchItemId = isBatchView ? null : (item?.maintenance_job_id || null);
        state._wrForm = isBatchView
            ? resolveBatchWrForm(report, item)
            : { ...(item?.form || report.report_form || {}) };
        state._wrUsedParts = isBatchView
            ? enrichUsedParts(TVC_SpareMenu.aggregateUsedPartsFromWorkReport(report))
            : enrichUsedParts(item?.used_parts || report.used_parts || []);
        state._wrTab = report.work_type === 'POSTPONE' ? 'postpone' : 'repair';
        state._wrPage = '1';
        state._wrSpareSearch = '';
        state._wrJobItems = null;
        state._wrReadonly = true;
        state._wrPostSaveView = true;
    }

    /** Work Report 창에서 이전/다음 — Work History 통합 목록 기준 */
    function navReport(dir) {
        navWorkHistoryEntry(dir);
    }

    /** Work Report 삭제 (승인 완료 리포트는 재고/일자 자동 원상복구) */
    async function deleteWorkReport() {
        if (!state._wrReportId) return;
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        const rep = state.reports.find(r => r.id === state._wrReportId);
        const isShipConfirmed = rep && TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked);
        const isHqApproved = rep && reportIsApproved(rep);

        const st = workReportListWorkflowStatus(rep);
        if (st === 'Submitted' || (isShipConfirmed && rep.sync_status === 'SYNCED')) {
            await TVC_Dialog.alert('Submitted reports cannot be deleted.');
            return;
        }
        if (isHqApproved || st === 'Approved') {
            await TVC_Dialog.alert('HQ-approved (APPROVED) reports cannot be deleted.');
            return;
        }
        if (isShipConfirmed && !TVC_RBAC.isApprover(user)) {
            await TVC_Dialog.alert('Confirmed reports can be deleted by Captain / Chief Engineer only.');
            return;
        }

        const msg = isShipConfirmed
            ? 'Delete this confirmed Work Report?\n\nDeducted Cos will be restored to ROB, and LAST DONE / NEXT DATE will be restored. Continue?'
            : 'Delete this Work Report?\n\nDeducted Cos will be restored to ROB. This cannot be undone.';
        if (!await TVC_Dialog.confirm({ message: msg })) return;

        try {
            if (rep?.consume_log_id) {
                const log = await TVC_Inventory.getConsumeLog(rep.consume_log_id);
                if (log) await TVC_SpareMenu.reverseConsumeLogStockForLog(user, log, undefined, { skipRbac: true });
                await TVC_Inventory.deleteConsumeLog(rep.consume_log_id);
            }
            await TVC_Transaction.deleteReport(user, state._wrReportId);
            state._wrReportId = null;
            state._wrReadonly = false;
            state._wrForm = {};
            state._wrUsedParts = [];
            state._wrPage = '1';
            state._wrSpareSearch = '';
            state._histSelReportId = null;
            state._histChecked = {};
            closeModal('workReportModal');
            await refreshAll();
            await TVC_Dialog.alert(isShipConfirmed
                ? 'Work Report deleted. Stock and dates were restored.'
                : 'Work Report deleted.');
        } catch (e) {
            const code = e.code || '';
            if (code === 'LOCKED') {
                await TVC_Dialog.alert(e.message || 'This report cannot be deleted.');
                return;
            }
            if (code === 'FORBIDDEN') {
                await TVC_Dialog.alert('Other department reports cannot be deleted.');
                return;
            }
            await TVC_Dialog.alert(e.message || code);
        }
    }

    /** Work Report 프린트 / 미리보기 상단 제목 (Maintenance·Postpone 탭별) */
    function workReportModalTitle() {
        const isHist = !!state._wrReportId;
        const base = state._wrTab === 'postpone' ? 'Postponed Report' : 'Maintenance Report';
        return isHist
            ? base
            : (isNewUnsavedWorkReportSession()
                ? `${base} (Draft)`
                : (state._wrReadonly ? `${base} (View)` : base));
    }

    function wrDateUiPrintInput(val) {
        return TVC_SpareMenu.buildWrSpareDateUiPrintInput
            ? TVC_SpareMenu.buildWrSpareDateUiPrintInput(val)
            : `<input class="wr-ro tvc-date-input" value="${esc(val || '')}" readonly disabled>`;
    }

    function buildWorkReportPrintBody() {
        captureWorkReportForm();
        if (state._wrPage === '2') TVC_SpareMenu.persistWrSpareUsedParts();
        captureWorkReportUsedParts();
        const job = state.idx?.jobById.get(state._wrJobId);
        if (!job) return null;
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const today = new Date().toISOString().slice(0, 10);
        const reportedByName = workReportReportedByName(rep);
        const wrAppr = wrHqApprovalUiState(rep, job, true);
        const {
            canConfirmNow, canApproveNow, confirmedByVal, approvedByVal,
            isRepConfirmed, isRepApproved,
        } = wrAppr;
        const title = workReportModalTitle();
        const tone = state._wrTab === 'postpone' ? 'postpone' : 'repair';
        let page1Body = '';
        if (state._wrTab === 'repair') {
            page1Body = renderWrRepairMaintenanceBody(job, {
                rep, reportedByName, today,
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal,
                canEditShipAttach: false, canEditCompanyAttach: false,
                ro: true,
                forPrint: true,
            });
        } else if (state._wrTab === 'postpone') {
            page1Body = renderWrPostponeBody(job, {
                rep, reportedByName, today,
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal,
                canEditShipAttach: false, canEditCompanyAttach: false,
                ro: true,
                forPrint: true,
            });
        }
        const printShellOpts = state._wrTab === 'postpone' ? { hidePageTabs: true } : {};
        const page1Html = TVC_SpareMenu.renderWrPrintShell(title, '1', page1Body, tone, printShellOpts);
        let page2Html = '';
        if (state._wrTab === 'repair' && TVC_SpareMenu.wrHasSparePage2ForPrint(state._wrUsedParts)) {
            const meta = buildWrPage2Meta(job, reportedByName, today);
            meta.spareShipComments = wf('spareShipComments', meta.spareShipComments || wf('shipComments', ''));
            const page2Inner = TVC_SpareMenu.buildWrSparePage2UiPrintHtml(state, state._wrUsedParts, meta);
            const page2Body = `${renderWrPage2HeadHtml({
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal, forPrint: true,
            })}${page2Inner}`;
            page2Html = TVC_SpareMenu.renderWrPrintShell(title, '2', page2Body, tone);
        }
        return { title, html: page1Html + page2Html, appCss: true };
    }

    function openWorkReportPrint({ print = false } = {}) {
        const doc = buildWorkReportPrintBody();
        if (!doc) return;
        TVC_SpareMenu.openWrReportPrintWindow(doc.title, doc.html, { print, appCss: !!doc.appCss });
    }

    function printWorkReport() {
        openWorkReportPrint({ print: true });
    }

    function previewWorkReport() {
        openWorkReportPrint({ print: false });
    }

    async function wrReportConfirmByToggle() {
        const cfCb = document.getElementById('wrConfirmedBy');
        if (!cfCb || cfCb.disabled) return;
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const job = state.idx?.jobById.get(state._wrJobId);
        if (!rep || !job) return;
        if (TVC_RBAC.isHqAccount(state.user)) {
            cfCb.checked = reportShowsConfirmed(rep);
            return;
        }
        const input = cfCb.closest('.wr-maint-approval-item')?.querySelector('.wr-maint-date');
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;

        if (!cfCb.checked) {
            if (input && !TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked)) {
                input.value = '';
                return;
            }
            if (!state._wrReadonly || TVC_RBAC.isApprovedStatus(rep.status, rep.is_locked)) {
                cfCb.checked = true;
                return;
            }
            if (!TVC_RBAC.canConfirmDepartment(user, job.department)) {
                cfCb.checked = true;
                return;
            }
            try {
                await TVC_Transaction.unconfirmReport(user, rep.id);
                await refreshAll();
                const saved = state.reports.find(r => r.id === rep.id) || rep;
                reloadWorkReportViewFromDb(saved, job);
                renderWorkReportModal();
                await TVC_Dialog.alert(`${job.job_code} report unconfirmed. (Returned to Reported)`);
            } catch (e) {
                cfCb.checked = true;
                await TVC_Dialog.alert(e.message || e.code || 'Unconfirm failed');
            }
            return;
        }

        const label = TVC_RBAC.getDepartmentConfirmLabel(job.department, user) || '';
        if (input) input.value = label;
        if (!TVC_RBAC.isReportedStatus(rep.status, rep.is_locked)) return;
        try {
            await TVC_Transaction.confirmReport(user, rep.id);
            await refreshAll();
            const saved = state.reports.find(r => r.id === rep.id) || rep;
            reloadWorkReportViewFromDb(saved, job);
            renderWorkReportModal();
            const msg = rep.work_type === 'POSTPONE'
                ? `${job.job_code} postpone report confirmed. (NEXT DATE updated)`
                : `${job.job_code} report confirmed. (LAST DONE / NEXT DATE update)`;
            await TVC_Dialog.alert(msg);
        } catch (e) {
            cfCb.checked = false;
            if (input) input.value = '';
            await TVC_Dialog.alert(e.message || e.code || 'Confirm failed');
        }
    }

    function setWorkReportTab(tab) {
        if (!WR_TABS[tab]) tab = 'repair';
        const lockedTab = currentWorkReportLockedTab();
        if (lockedTab && tab !== lockedTab) return;
        captureWorkReportForm();
        if (state._wrPage === '2') TVC_SpareMenu.persistWrSpareUsedParts();
        captureWorkReportUsedParts();
        state._wrTab = tab;
        state._wrPage = '1';
        renderWorkReportModal();
    }

    function setWorkReportPage(page) {
        captureWorkReportForm();
        if (state._wrPage === '2') TVC_SpareMenu.persistWrSpareUsedParts();
        captureWorkReportUsedParts();
        state._wrPage = page;
        renderWorkReportModal();
    }

    function enrichUsedParts(lines) {
        return (lines || []).map(line => {
            const spare = (state.spares || []).find(s => s.id === line.spare_part_id);
            const canon = spare ? TVC_SpareSchema.fromRow(spare) : {};
            return {
                spare_part_id: line.spare_part_id,
                part_no: canon.makerPartNo || spare?.part_no || line.part_no || '—',
                name: canon.name || spare?.name || line.name || '—',
                universal_code: canon.universalItemCode || spare?.universal_code || '',
                qty_on_hand: spare ? TVC_Inventory.currentStock(spare) : null,
                qty_used: Number(line.qty_used) || 0,
            };
        });
    }

    function captureWorkReportUsedParts() {
        const host = document.getElementById('workReportBody');
        if (!host) return;
        host.querySelectorAll('.spare-consume-qty-input').forEach(el => {
            const table = el.closest('[data-spare-id]');
            const id = table?.dataset?.spareId;
            if (!id) return;
            const row = (state._wrUsedParts || []).find(p => String(p.spare_part_id ?? '') === String(id));
            if (row) row.qty_used = Math.max(0, Math.floor(Number(el.value) || 0));
        });
    }

    function buildWrPage2JobItems(job) {
        captureWrJobItems();
        if (Array.isArray(state._wrJobItems) && state._wrJobItems.length) {
            const coded = state._wrJobItems.filter(i => String(i.job_code || '').trim());
            if (coded.length) return coded.map(it => TVC_SpareMenu.newConsumeJobRow(it));
        }
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        if (rep?.is_batch && rep.job_items?.length) {
            return rep.job_items.map(it => {
                const j = state.idx?.jobById.get(it.maintenance_job_id);
                return TVC_SpareMenu.newConsumeJobRow({
                    job_code: it.job_code || j?.job_code || '',
                    sort1: j?.item_sort1 || it.item_sort1 || it.form?.sort1 || '',
                    sort2: j?.item_sort2 || it.item_sort2 || it.form?.sort2 || '',
                    job_detail: j?.job_detail || it.job_detail || it.form?.jobDetail || '',
                });
            });
        }
        return TVC_SpareMenu.buildPage2JobItemsFromJobs([job]);
    }

    function buildWrPage2Meta(job, reportedByName, today) {
        const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
        return {
            reportDate: wf('reportDate', today),
            workDate: wf('workDate', today),
            reportedBy: reportedByName,
            pmsGroupNo: wf('pmsGroupNo', hdr.pmsGroupNo || job?.group || ''),
            groupKey: `${job?.department || ''}|${String(job?.group || '').trim()}`,
            jobCode: job?.job_code || '',
            sort1: job?.item_sort1 || '',
            sort2: job?.item_sort2 || '',
            jobDetail: job?.job_detail || '',
            spareShipComments: wf('spareShipComments', ''),
            jobItems: buildWrPage2JobItems(job),
            allowAdd: false,
        };
    }

    function resolveWorkReportPrimaryJob(rep, st) {
        if (!rep) return null;
        const item = (rep.job_items || [])[0];
        const jobId = item?.maintenance_job_id || rep.maintenance_job_id;
        if (!jobId) return null;
        return st.idx?.jobById.get(jobId) || (st.jobs || []).find(j => j.id === jobId) || null;
    }

    function buildWrPage2JobItemsFromReport(rep, st) {
        if (rep?.is_batch && rep.job_items?.length) {
            return rep.job_items.map(it => {
                const j = st.idx?.jobById.get(it.maintenance_job_id);
                return TVC_SpareMenu.newConsumeJobRow({
                    job_code: it.job_code || j?.job_code || '',
                    sort1: j?.item_sort1 || it.item_sort1 || it.form?.sort1 || '',
                    sort2: j?.item_sort2 || it.item_sort2 || it.form?.sort2 || '',
                    job_detail: j?.job_detail || it.job_detail || it.form?.jobDetail || '',
                });
            });
        }
        const job = resolveWorkReportPrimaryJob(rep, st);
        if (!job) return [];
        return TVC_SpareMenu.buildPage2JobItemsFromJobs([job]);
    }

    function buildWrPage2MetaFromReport(rep, job, st, log) {
        const f = rep?.report_form || {};
        const item = (rep.job_items || [])[0];
        const itemForm = item?.form || {};
        const reportedByName = workReportReportedByName(rep);
        const hdr = job ? TVC_SpareMenu.resolveWrJobHeader(st, job) : {};
        let jobItems = buildWrPage2JobItemsFromReport(rep, st);
        if (!jobItems.length && Array.isArray(log?.job_items) && log.job_items.length) {
            jobItems = log.job_items.map(it => TVC_SpareMenu.newConsumeJobRow(it));
        }
        return {
            reportDate: f.reportDate || itemForm.reportDate || rep.report_date || log?.made_on || '',
            workDate: f.workDate || itemForm.workDate || log?.consumed_date || '',
            reportedBy: reportedByName,
            pmsGroupNo: f.pmsGroupNo || itemForm.pmsGroupNo || hdr.pmsGroupNo || job?.group || log?.pms_group_no || '',
            groupKey: `${job?.department || rep.department || ''}|${String(job?.group || log?.pms_group_no || '').trim()}`,
            jobCode: job?.job_code || '',
            sort1: job?.item_sort1 || '',
            sort2: job?.item_sort2 || '',
            jobDetail: job?.job_detail || '',
            spareShipComments: f.spareShipComments || f.shipComments || log?.ships_comments || '',
            jobItems,
            allowAdd: false,
        };
    }

    function workReportTitleFromRep(rep) {
        return rep?.work_type === 'POSTPONE' ? 'Postponed Report' : 'Maintenance Report';
    }

    /** Consumption List Type M — linked Maintenance Report Page 2 print (no modal state). */
    function buildWorkReportPage2PrintHtmlFromReport(rep, st, usedParts, opts = {}) {
        if (!rep || !TVC_SpareMenu.wrHasSparePage2ForPrint(usedParts)) return '';
        const job = resolveWorkReportPrimaryJob(rep, st);
        if (!job && !rep.is_batch) return '';
        const meta = buildWrPage2MetaFromReport(rep, job, st, opts.log);
        const page2Inner = TVC_SpareMenu.buildWrSparePage2UiPrintHtml(st, usedParts, meta);
        const isRepApproved = reportIsApproved(rep);
        const isRepConfirmed = reportShowsConfirmed(rep);
        const dept = job?.department || rep.department;
        const canConfirmNow = TVC_RBAC.isReportedStatus(rep.status, rep.is_locked)
            && TVC_RBAC.canConfirmDepartment(st.user, dept);
        const hqDirectApprove = !isRepApproved && TVC_RBAC.canHqDirectApprove(st.user, rep);
        const canApproveNow = !isRepApproved && TVC_RBAC.canApproveHqReport(st.user)
            && (TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked) || hqDirectApprove);
        const confirmedByVal = isRepConfirmed
            ? (TVC_RBAC.resolveConfirmByLabel?.(rep.confirmed_by, dept, st.user) || rep.confirmed_by || '')
            : '';
        const approvedByVal = isRepApproved ? 'Company' : '';
        const page2Body = `${renderWrPage2HeadHtml({
            canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
            approvedByVal, confirmedByVal, forPrint: true,
        })}${page2Inner}`;
        if (opts.innerOnly) return page2Body;
        const tone = rep.work_type === 'POSTPONE' ? 'postpone' : 'repair';
        return TVC_SpareMenu.renderWrPrintShell(workReportTitleFromRep(rep), '2', page2Body, tone);
    }

    function renderWrBatchJobRowsHtml(jobIds) {
        if (!jobIds?.length) return '';
        const multi = jobIds.length > 1;
        const header = multi && TVC_SpareMenu.renderMaintJobRowsHeaderHtml
            ? TVC_SpareMenu.renderMaintJobRowsHeaderHtml()
            : '';
        const roInp = (val, field) => field
            ? `<input class="wr-ro" data-field="${field}" value="${esc(val || '')}" readonly tabindex="-1">`
            : `<input class="wr-ro" value="${esc(val || '')}" readonly tabindex="-1">`;
        const fld = (label, inner) => multi
            ? `<div class="wr-maint-field wr-maint-field-nolabel">${inner}</div>`
            : `<div class="wr-maint-field"><label>${label}</label>${inner}</div>`;
        const rows = jobIds.map((id) => {
            const j = state.idx?.jobById.get(id);
            if (!j) return '';
            return `<div class="wr-maint-grid wr-maint-grid-4 df-maint-job-row" data-batch-job-id="${escAttr(id)}">
                ${fld('Job Code', roInp(j.job_code, 'job_code'))}
                ${fld('SORT-1', roInp(j.item_sort1, 'sort1'))}
                ${fld('SORT-2', roInp(j.item_sort2, 'sort2'))}
                ${fld('Job Detail', roInp(j.job_detail, 'job_detail'))}
            </div>`;
        }).join('');
        return `<div class="df-page1-job-rows wr-maint-span-all wr-batch-job-rows">${header}${rows}</div>`;
    }

    const WR_PICK_Z = 10100;
    let _wrGroupPickSearch = '';
    let _wrJobPickSearch = '';
    let _wrActiveJobRowIndex = 0;
    let _wrJobRowPickSearch = '';
    let _wrJobRowPickUnbind = null;

    function buildWrJobItemsFromJobIds(jobIds) {
        return buildJobItemsFromJobIds(jobIds);
    }

    function buildJobItemsFromJobIds(jobIds) {
        return (jobIds || []).map(id => {
            const j = state.idx?.jobById.get(id);
            if (!j) return TVC_SpareMenu.newConsumeJobRow();
            return {
                maintenance_job_id: j.id,
                job_code: j.job_code || '',
                sort1: j.item_sort1 || '',
                sort2: j.item_sort2 || '',
                job_detail: j.job_detail || '',
            };
        });
    }

    function wrJobDeptHint() {
        const gk = String(state._wrForm?.pmsGroupKey || '').trim();
        if (gk.includes('|')) {
            const dept = gk.split('|')[0].trim().toUpperCase();
            if (dept && dept !== 'MASTER' && dept !== 'HQ' && dept !== 'ADMIN') return dept;
        }
        const d = String(state.department || '').trim().toUpperCase();
        if (d && d !== 'MASTER' && d !== 'HQ' && d !== 'ADMIN') return d;
        return '';
    }

    function wrJobGroupHint() {
        return String(state._wrForm?.pmsGroupNo || '').trim();
    }

    function resolveWrJobFromItem(item) {
        if (!item) return null;
        if (item.maintenance_job_id) {
            const byId = state.idx?.jobById.get(item.maintenance_job_id);
            if (byId) return byId;
        }
        return resolveJobByCode(item.job_code, wrJobDeptHint(), wrJobGroupHint()) || null;
    }

    function wrJobItemsShowCriticalPostpone(items) {
        return (items || []).some(item => {
            const j = resolveWrJobFromItem(item);
            return j && jobShowsCriticalEquipmentMark(j);
        });
    }

    function ensureWrJobItems(job, rep) {
        if (Array.isArray(state._wrJobItems) && state._wrJobItems.length) return state._wrJobItems;
        if (rep && (rep.job_items || []).length) {
            state._wrJobItems = rep.job_items.map(it => {
                const j = state.idx?.jobById.get(it.maintenance_job_id);
                return {
                    maintenance_job_id: it.maintenance_job_id || j?.id || '',
                    job_code: it.job_code || j?.job_code || '',
                    sort1: j?.item_sort1 || it.item_sort1 || it.form?.sort1 || '',
                    sort2: j?.item_sort2 || it.item_sort2 || it.form?.sort2 || '',
                    job_detail: j?.job_detail || it.job_detail || it.form?.jobDetail || '',
                };
            });
            return state._wrJobItems;
        }
        if (job) {
            state._wrJobItems = [{
                maintenance_job_id: job.id,
                job_code: job.job_code || '',
                sort1: job.item_sort1 || '',
                sort2: job.item_sort2 || '',
                job_detail: job.job_detail || '',
            }];
            return state._wrJobItems;
        }
        state._wrJobItems = [TVC_SpareMenu.newConsumeJobRow()];
        return state._wrJobItems;
    }

    function captureWrJobItems() {
        const container = document.getElementById('wrJobRows');
        if (!container) return ensureWrJobItems(state.idx?.jobById.get(state._wrJobId));
        const rowEls = container.querySelectorAll('[data-wr-job-row]');
        if (!rowEls.length) return ensureWrJobItems(state.idx?.jobById.get(state._wrJobId));
        state._wrJobItems = [...rowEls].map(rowEl => ({
            maintenance_job_id: rowEl.dataset.jobId || '',
            job_code: rowEl.querySelector('[data-field="job_code"]')?.value?.trim()
                || rowEl.querySelector('.spare-consume-pick-text')?.textContent?.trim()
                || '',
            sort1: rowEl.querySelector('[data-field="sort1"]')?.value?.trim() || '',
            sort2: rowEl.querySelector('[data-field="sort2"]')?.value?.trim() || '',
            job_detail: rowEl.querySelector('[data-field="job_detail"]')?.value?.trim() || '',
        }));
        syncWrPrimaryJobFromItems();
        return state._wrJobItems;
    }

    function syncWrPrimaryJobFromItems() {
        const items = state._wrJobItems || [];
        const first = items.find(i => String(i.job_code || '').trim()) || items[0];
        if (!first) return;
        const job = resolveWrJobFromItem(first);
        if (job) {
            state._wrJobId = job.id;
            state.selectedJobId = job.id;
            first.maintenance_job_id = job.id;
            first.job_code = job.job_code || first.job_code;
            first.sort1 = job.item_sort1 || first.sort1;
            first.sort2 = job.item_sort2 || first.sort2;
            first.job_detail = job.job_detail || first.job_detail;
        }
    }

    function applyWrJobPickToItems(job, rowIdx = 0) {
        ensureWrJobItems(job);
        state._wrJobItems[rowIdx] = {
            maintenance_job_id: job.id,
            job_code: job.job_code || '',
            sort1: job.item_sort1 || '',
            sort2: job.item_sort2 || '',
            job_detail: job.job_detail || '',
        };
        if (rowIdx === 0) {
            state._wrJobId = job.id;
            state.selectedJobId = job.id;
            const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
            Object.assign(state._wrForm, {
                pmsGroupKey: `${job.department}|${String(job.group || '').trim()}`,
                pmsGroupNo: hdr.pmsGroupNo || job.group || state._wrForm.pmsGroupNo || '',
                maker: hdr.maker || '',
                modelType: hdr.modelType || '',
                capacity: hdr.capacity || '',
                serialNo: hdr.serialNo || '',
                lastMaintDate: state._wrForm.lastMaintDate || job.last_done || '',
            });
        }
        syncWrPrimaryJobFromItems();
        syncPlanBatchCheckForJob(job.id, true);
    }

    function unbindWrJobRowPickListeners() {
        if (_wrJobRowPickUnbind) {
            _wrJobRowPickUnbind();
            _wrJobRowPickUnbind = null;
        }
    }

    function closeWrJobRowPickMenu() {
        unbindWrJobRowPickListeners();
        const host = document.getElementById('wrJobRowPickHost');
        const menu = document.getElementById('wrJobRowPickMenu');
        if (menu) {
            menu.classList.remove('spare-consume-pick-menu-portal');
            menu.style.cssText = 'display:none';
            if (menu.parentNode === document.body) {
                if (host) host.appendChild(menu);
                else menu.remove();
            }
        }
        if (host) host.classList.add('hidden');
    }

    function positionWrJobRowPickMenu(rowIdx = 0) {
        const trigger = document.getElementById(`wrJobPickTrigger-${rowIdx}`);
        const menu = document.getElementById('wrJobRowPickMenu');
        if (!trigger || !menu) return;
        if (menu.parentNode !== document.body) document.body.appendChild(menu);
        menu.classList.add('spare-consume-pick-menu-portal');
        const r = trigger.getBoundingClientRect();
        Object.assign(menu.style, {
            display: 'flex', flexDirection: 'column', position: 'fixed',
            left: `${r.left}px`, top: `${r.bottom + 2}px`,
            minWidth: `${Math.max(420, r.width)}px`, width: `${Math.max(420, r.width)}px`,
            zIndex: String(WR_PICK_Z + 1), maxHeight: 'min(420px, 70vh)',
        });
    }

    function buildWrJobRowPickList(rowIdx = 0) {
        const gk = wrGroupKeyFromForm();
        if (!gk) return '<div class="spare-consume-pick-empty muted">Select PMS Group first.</div>';
        const q = (_wrJobRowPickSearch || '').toLowerCase().trim();
        const jobs = (TVC_SpareMenu.getJobsForGroupKey(state, gk) || []).filter(j => {
            if (!q) return true;
            return [j.job_code, j.item_sort1, j.item_sort2, j.job_detail].join(' ').toLowerCase().includes(q);
        });
        const activeRow = (state._wrJobItems || [])[rowIdx ?? _wrActiveJobRowIndex ?? 0] || {};
        const selectedCode = activeRow.job_code || '';
        const clearBtn = `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-none${selectedCode ? '' : ' selected'}"
                onclick="TVC_App.clearWrJobRow()">
                <span class="spare-consume-pick-job-code">— No Job Code —</span>
                <span class="spare-consume-pick-job-sub muted">PMS Group only</span>
            </button>`;
        if (!jobs.length) return clearBtn + '<div class="spare-consume-pick-empty muted">No results</div>';
        return clearBtn + jobs.map(j => {
            const sel = selectedCode === j.job_code ? ' selected' : '';
            const sub = [j.item_sort1, j.item_sort2].filter(Boolean).join(' · ');
            return `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-job${sel}"
                onclick="TVC_App.pickWrJobForRow('${escAttr(j.id)}')">
                <span class="spare-consume-pick-job-code">${esc(j.job_code || '')}</span>
                ${sub ? `<span class="spare-consume-pick-job-sub">${esc(sub)}</span>` : ''}
            </button>`;
        }).join('');
    }

    function refreshWrJobRowPickList() {
        const list = document.getElementById('wrJobRowPickList');
        if (list) list.innerHTML = buildWrJobRowPickList(_wrActiveJobRowIndex);
    }

    function bindWrJobRowPickListeners() {
        unbindWrJobRowPickListeners();
        const close = (e) => {
            const menu = document.getElementById('wrJobRowPickMenu');
            const trigger = document.getElementById(`wrJobPickTrigger-${_wrActiveJobRowIndex}`);
            if (menu?.contains(e.target) || trigger?.contains(e.target)) return;
            closeWrJobRowPickMenu();
        };
        const onReposition = () => {
            const menu = document.getElementById('wrJobRowPickMenu');
            if (menu && menu.style.display && menu.style.display !== 'none') {
                positionWrJobRowPickMenu(_wrActiveJobRowIndex);
            }
        };
        const token = { cancelled: false };
        _wrJobRowPickUnbind = () => {
            token.cancelled = true;
            document.removeEventListener('click', close);
            window.removeEventListener('scroll', onReposition, true);
            window.removeEventListener('resize', onReposition);
        };
        setTimeout(() => {
            if (token.cancelled) return;
            document.addEventListener('click', close);
            window.addEventListener('scroll', onReposition, true);
            window.addEventListener('resize', onReposition);
        }, 0);
    }

    async function toggleWrJobRowPick(ev, idx) {
        ev?.stopPropagation();
        if (!wrGroupKeyFromForm()) await TVC_Dialog.alert('Select PMS Group No. first.');
        const prevIdx = _wrActiveJobRowIndex;
        _wrActiveJobRowIndex = idx;
        const host = document.getElementById('wrJobRowPickHost');
        const menu = document.getElementById('wrJobRowPickMenu');
        if (!host || !menu) return;
        closeWrPickMenu(document.getElementById('wrGroupPick'));
        closeWrPickMenu(document.getElementById('wrJobPick'));
        const isVisible = menu.style.display && menu.style.display !== 'none';
        if (isVisible && prevIdx === idx) {
            closeWrJobRowPickMenu();
            return;
        }
        refreshWrJobRowPickList();
        positionWrJobRowPickMenu(idx);
        bindWrJobRowPickListeners();
    }

    function pickWrJobForRow(jobId) {
        captureWorkReportForm();
        captureWrJobItems();
        const job = state.idx?.jobById.get(jobId) || state.jobs.find(j => j.id === jobId);
        if (!job) return;
        applyWrJobPickToItems(job, _wrActiveJobRowIndex || 0);
        closeWrJobRowPickMenu();
        renderWorkReportModal({ preserveScroll: true });
    }

    function clearWrJobRow() {
        captureWorkReportForm();
        captureWrJobItems();
        const idx = _wrActiveJobRowIndex || 0;
        ensureWrJobItems(state.idx?.jobById.get(state._wrJobId));
        if (!Array.isArray(state._wrJobItems) || !state._wrJobItems.length) {
            state._wrJobItems = [TVC_SpareMenu.newConsumeJobRow()];
        }
        state._wrJobItems[idx] = TVC_SpareMenu.newConsumeJobRow();
        if (idx === 0 && !wrIsNoGroup()) {
            const hdr = TVC_SpareMenu.resolveGroupHeaderByKey(state, wrGroupKeyFromForm(), wf('pmsGroupNo')) || {};
            Object.assign(state._wrForm, {
                maker: hdr.maker || '',
                modelType: hdr.modelType || '',
                capacity: hdr.capacity || '',
                serialNo: hdr.serialNo || '',
            });
        }
        closeWrJobRowPickMenu();
        renderWorkReportModal({ preserveScroll: true });
    }

    function wrJobRowPickSearch(v) {
        _wrJobRowPickSearch = v || '';
        refreshWrJobRowPickList();
        positionWrJobRowPickMenu(_wrActiveJobRowIndex || 0);
    }

    function addWrJobRow() {
        captureWorkReportForm();
        captureWrJobItems();
        ensureWrJobItems(state.idx?.jobById.get(state._wrJobId));
        state._wrJobItems.push(TVC_SpareMenu.newConsumeJobRow());
        renderWorkReportModal({ preserveScroll: true });
    }

    function removeWrJobRow(idx) {
        captureWorkReportForm();
        captureWrJobItems();
        ensureWrJobItems(state.idx?.jobById.get(state._wrJobId));
        if (state._wrJobItems.length <= 1) return;
        state._wrJobItems.splice(idx, 1);
        if (_wrActiveJobRowIndex >= state._wrJobItems.length) {
            _wrActiveJobRowIndex = Math.max(0, state._wrJobItems.length - 1);
        }
        syncWrPrimaryJobFromItems();
        renderWorkReportModal({ preserveScroll: true });
    }

    function renderWrMaintJobRowHtml(item, idx, opts = {}) {
        const ro = !!opts.readonly;
        const batch = !!opts.batch;
        const hideLabels = !!opts.hideLabels;
        const jobDisabled = !opts.groupKey;
        const fld = (label, inner) => hideLabels
            ? `<div class="wr-maint-field wr-maint-field-nolabel">${inner}</div>`
            : `<div class="wr-maint-field"><label>${label}</label>${inner}</div>`;
        const roInp = (val, field) => field
            ? `<input class="wr-ro" data-field="${field}" value="${esc(val || '')}" readonly tabindex="-1">`
            : `<input class="wr-ro" value="${esc(val || '')}" readonly tabindex="-1">`;
        let jobInner;
        if (ro) {
            jobInner = roInp(item.job_code, 'job_code');
        } else {
            jobInner = `<button type="button" id="wrJobPickTrigger-${idx}" class="wr-maint-job-pick spare-consume-job-pick-trigger"${jobDisabled ? ' disabled' : ''} onclick="TVC_App.toggleWrJobRowPick(event, ${idx})">
                    <span class="spare-consume-pick-text">${esc(item.job_code || '— No Job Code —')}</span>
                    <span class="spare-consume-pick-caret" aria-hidden="true">▾</span>
                </button>
                <input type="hidden" data-field="job_code" value="${escAttr(item.job_code || '')}">`;
        }
        const sort1Inner = roInp(item.sort1, 'sort1');
        const sort2Inner = roInp(item.sort2, 'sort2');
        const detailInner = ro
            ? roInp(item.job_detail, 'job_detail')
            : `<input type="text" id="wrJobDetail-${idx}" data-field="job_detail" value="${esc(item.job_detail || '')}">`;
        const actCol = batch && !ro && (opts.rowCount || 0) > 1
            ? `<div class="wr-maint-field df-maint-job-row-act${hideLabels ? ' wr-maint-field-nolabel' : ''}">${hideLabels ? '' : '<label aria-hidden="true">&nbsp;</label>'}<button type="button" class="btn btn-sm spare-consume-job-row-rm" onclick="TVC_App.removeWrJobRow(${idx})" title="Remove job row" aria-label="Remove job row">×</button></div>`
            : '';
        const gapCls = idx === 0 ? ' wr-maint-grid-gap' : '';
        const gridCols = actCol ? ' wr-maint-grid-4 df-maint-job-grid-batch' : ' wr-maint-grid-4';
        return `<div class="wr-maint-grid${gridCols}${gapCls} df-maint-job-row" data-wr-job-row="${idx}" data-job-id="${escAttr(item.maintenance_job_id || '')}">
                ${fld('Job Code', jobInner)}
                ${fld('SORT-1', sort1Inner)}
                ${fld('SORT-2', sort2Inner)}
                ${fld('Job Detail', detailInner)}
                ${actCol}
            </div>`;
    }

    function renderWrJobRowsBlock(job, rep, ro, forPrint) {
        ensureWrJobItems(job, rep);
        const items = state._wrJobItems || [];
        const groupKey = wrGroupKeyFromForm();
        const allowAdd = !ro && !forPrint && !!groupKey;
        const multiJob = items.length > 1 || allowAdd;
        const header = multiJob && TVC_SpareMenu.renderMaintJobRowsHeaderHtml
            ? TVC_SpareMenu.renderMaintJobRowsHeaderHtml({ withActionCol: allowAdd && items.length > 1 })
            : '';
        const rows = items.map((item, idx) => renderWrMaintJobRowHtml(item, idx, {
            readonly: ro || forPrint,
            batch: allowAdd,
            groupKey,
            rowCount: items.length,
            hideLabels: multiJob,
        })).join('');
        const addBtn = allowAdd
            ? `<div class="spare-consume-meta-job-add">
                <button type="button" class="btn btn-sm spare-consume-job-row-add" onclick="TVC_App.addWrJobRow()" title="Add JOB CODE row">+</button>
               </div>`
            : '';
        const pickHost = allowAdd
            ? `<div id="wrJobRowPickHost" class="spare-consume-job-pick-host hidden" aria-hidden="true">
                <div id="wrJobRowPickMenu" class="spare-consume-pick-menu" role="listbox" aria-label="JOB CODE" style="display:none">
                    <div class="spare-consume-pick-search">
                        <input type="search" class="search-input" placeholder="Search JOB CODE / SORT / DETAIL…" value="${esc(_wrJobRowPickSearch)}"
                            oninput="TVC_App.wrJobRowPickSearch(this.value)" onclick="event.stopPropagation()">
                    </div>
                    <div class="spare-consume-pick-scroll" id="wrJobRowPickList"></div>
                </div>
            </div>`
            : '';
        return `<div class="df-page1-job-rows wr-maint-span-all" id="wrJobRows">${header}${rows}${addBtn}</div>${pickHost}`;
    }

    const WR_NO_GROUP_KEY = '__NO_GROUP__';
    const WR_NO_GROUP_LABEL = 'No PMS GROUP';

    function wrIsNoGroup() {
        const key = state._wrForm?.pmsGroupKey;
        const label = state._wrForm?.pmsGroupNo;
        return key === WR_NO_GROUP_KEY || label === WR_NO_GROUP_LABEL || label === 'No selection';
    }

    function wrGroupKeyFromForm() {
        if (wrIsNoGroup()) return '';
        if (state._wrForm?.pmsGroupKey && state._wrForm.pmsGroupKey !== WR_NO_GROUP_KEY) {
            return state._wrForm.pmsGroupKey;
        }
        const job = state.idx?.jobById.get(state._wrJobId);
        if (job?.department && job?.group) return `${job.department}|${String(job.group).trim()}`;
        return '';
    }

    function closeWrPickMenu(wrap) {
        if (!wrap) return;
        const menu = wrap._portalMenu || wrap.querySelector('.spare-consume-pick-menu');
        if (menu) {
            menu.classList.remove('spare-consume-pick-menu-portal');
            menu.style.cssText = '';
            if (wrap._portalMenu && menu.parentNode === document.body) wrap.appendChild(menu);
        }
        wrap.classList.remove('open');
    }

    function closeAllWrPicks() {
        closeWrPickMenu(document.getElementById('wrGroupPick'));
        closeWrPickMenu(document.getElementById('wrJobPick'));
        closeWrJobRowPickMenu();
    }

    function positionWrPickMenu(wrap, minWidth) {
        const trigger = wrap.querySelector('.spare-consume-pick-trigger');
        let menu = wrap.querySelector('.spare-consume-pick-menu');
        if (!trigger || !menu) return;
        if (!wrap._portalMenu) wrap._portalMenu = menu;
        if (menu.parentNode !== document.body) document.body.appendChild(menu);
        menu.classList.add('spare-consume-pick-menu-portal');
        const r = trigger.getBoundingClientRect();
        Object.assign(menu.style, {
            display: 'flex', flexDirection: 'column', position: 'fixed',
            left: `${r.left}px`, top: `${r.bottom + 2}px`,
            minWidth: `${Math.max(minWidth, r.width)}px`, width: `${Math.max(minWidth, r.width)}px`,
            zIndex: String(WR_PICK_Z), maxHeight: 'min(420px, 70vh)',
        });
    }

    function cleanupOrphanPickMenus() {
        closeAllWrPicks();
        document.querySelectorAll('body > .spare-consume-pick-menu-portal').forEach(el => el.remove());
    }

    function renderFileNoPickPanelHtml(target = 'wr') {
        const id = target === 'df' ? 'dfFileNoPickPanel' : 'wrFileNoPickPanel';
        return `<div id="${id}" class="wr-file-no-popover spare-req-hist-popover hidden" aria-hidden="true"></div>`;
    }

    function renderFileNoInputHtml(opts = {}) {
        const {
            fieldKey = 'fileNo',
            dataAttr = 'data-wf',
            value = '',
            ro = false,
            forPrint = false,
            pickTarget = 'wr',
        } = opts;
        if (forPrint) {
            return `<input class="wr-ro" ${dataAttr}="${fieldKey}" value="${esc(value)}" readonly tabindex="-1">`;
        }
        const btnId = pickTarget === 'df' ? 'dfFileNoPickBtn' : 'wrFileNoPickBtn';
        const dis = ro ? ' disabled' : '';
        return `<div class="wr-file-no-row">
            <input ${dataAttr}="${fieldKey}" value="${esc(value)}"${dis}>
            <button type="button" id="${btnId}" class="btn btn-sm wr-file-no-pick-btn" onclick="TVC_App.openFileNoPickModal('${pickTarget}')"${dis} title="Browse Report History">Check History</button>
        </div>`;
    }

    function fileNoPickHistoryType() {
        const target = state._fileNoPickTarget || 'wr';
        if (target === 'wp') return 'w';
        if (target === 'df') return 'd';
        if (state._wrTab === 'postpone') return 'p';
        return 'm';
    }

    function fileNoPickMatchesTab(entry) {
        const want = fileNoPickHistoryType();
        if (want === 'w') return isHistPermitEntry(entry);
        if (want === 'd') return isHistDefectEntry(entry);
        if (isHistConsumeEntry(entry)) return false;
        if (want === 'p') return !isHistPermitEntry(entry) && !isHistDefectEntry(entry) && entry.report?.work_type === 'POSTPONE';
        return !isHistPermitEntry(entry) && !isHistDefectEntry(entry) && entry.report?.work_type !== 'POSTPONE';
    }

    function buildFileNoPickRows() {
        return workHistoryEntries().filter(fileNoPickMatchesTab).map(entry => {
            const m = histTypeMarker(entry);
            let fileNo, jobCode, sort1, date;
            if (isHistPermitEntry(entry)) {
                const row = entry.permit;
                const cols = workPermitHistoryColumns(row || {});
                fileNo = String(row?.file_no || '').trim();
                jobCode = cols.jobCode || '—';
                sort1 = cols.sort1 || '—';
                date = formatCmaxsHistDate(listReportedDateStr(row));
            } else if (isHistDefectEntry(entry)) {
                const dc = entry.defect;
                fileNo = String(dc.file_no || '').trim();
                jobCode = dc.job_code || dc.job_items?.[0]?.job_code || '—';
                sort1 = dc.item_sort1 || dc.job_items?.[0]?.item_sort1 || '—';
                date = formatCmaxsHistDate(dc.report_date || dc.created_at);
            } else {
                const { report: r, item } = entry;
                const f = item.form || wrReportForm(r);
                fileNo = String(f.fileNo || '').trim();
                const job = state.idx?.jobById.get(item.maintenance_job_id);
                jobCode = item.job_code || '—';
                sort1 = job?.item_sort1 || '—';
                date = formatCmaxsHistDate(listReportedDateStr(r));
            }
            return {
                entry,
                fileNo,
                letter: m.letter,
                typeTitle: m.title,
                typeCls: m.cls,
                jobCode,
                sort1,
                date,
                rowKey: histEntryRowKey(entry),
            };
        });
    }

    function renderFileNoPickPopoverInner() {
        const q = String(state._fileNoPickSearch || '').trim().toLowerCase();
        const rows = buildFileNoPickRows().filter(row => {
            if (!q) return true;
            const hay = [row.fileNo, row.letter, row.typeTitle, row.jobCode, row.sort1, row.date].join(' ').toLowerCase();
            return hay.includes(q);
        });
        if (!rows.length) {
            return '<p class="muted file-no-pick-empty">No matching Report History entries.</p>';
        }
        return `<div class="search-field-wrap file-no-pick-search">
                <input type="search" class="search-input" id="fileNoPickSearch" placeholder="Search File No / Job Code / SORT…"
                    value="${escAttr(state._fileNoPickSearch || '')}" oninput="TVC_App.fileNoPickSearch(this.value)">
            </div>
            <div class="file-no-pick-table-wrap">
                <table class="file-no-pick-table">
                    <thead><tr>
                        <th class="hist-type-h">Type</th>
                        <th class="hist-file-h">File No</th>
                        <th class="hist-crit-h" title="Critical Equipment">⚠</th>
                        <th class="hist-code-h">JOB CODE</th>
                        <th class="hist-sort1-h">SORT-1</th>
                        <th class="hist-date-h"><span class="hist-th-stack"><span>Reported</span><span>Date</span></span></th>
                    </tr></thead>
                    <tbody>${rows.map(row => `<tr class="file-no-pick-row" onclick="TVC_App.applyFileNoPick('${escAttr(row.fileNo)}')">
                        ${histTypeCell(row.entry)}
                        <td class="hist-file">${esc(row.fileNo || '—')}</td>
                        ${histCriticalCell(row.entry)}
                        <td class="hist-code">${esc(row.jobCode)}</td>
                        <td class="hist-sort1">${esc(row.sort1)}</td>
                        <td class="hist-date">${esc(row.date || '—')}</td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>`;
    }

    function renderFileNoPickPopoverBody() {
        const rows = buildFileNoPickRows();
        const q = String(state._fileNoPickSearch || '').trim().toLowerCase();
        const shown = q
            ? rows.filter(row => [row.fileNo, row.letter, row.typeTitle, row.jobCode, row.sort1, row.date].join(' ').toLowerCase().includes(q))
            : rows;
        const countLabel = `${shown.length}${shown.length !== rows.length ? ` / ${rows.length}` : ''} item(s)`;
        return `<div class="spare-req-hist-popover-head wr-file-no-popover-head">Report History
                <span class="muted spare-req-list-count">${countLabel}</span>
                <button type="button" class="modal-x" onclick="TVC_App.closeFileNoPickModal()" title="Close">×</button>
            </div>
            ${renderFileNoPickPopoverInner()}
            <p class="spare-req-list-hint spare-req-hist-hint muted">Click a row to apply File No.</p>`;
    }

    function fileNoPickPanelId(target) {
        if (target === 'df') return 'dfFileNoPickPanel';
        if (target === 'wp') return 'wpFileNoPickPanel';
        return 'wrFileNoPickPanel';
    }

    function fileNoPickBtnId(target) {
        if (target === 'df') return 'dfFileNoPickBtn';
        if (target === 'wp') return 'wpFileNoPickBtn';
        return 'wrFileNoPickBtn';
    }

    function positionFileNoPickPopover(target) {
        const btn = document.getElementById(fileNoPickBtnId(target));
        const panel = document.getElementById(fileNoPickPanelId(target));
        const anchor = panel?.closest('.wr-file-no-anchor');
        if (!btn || !panel || !anchor || panel.classList.contains('hidden')) return;
        const top = btn.getBoundingClientRect().bottom - anchor.getBoundingClientRect().top + 6;
        panel.style.top = `${Math.max(top, 0)}px`;
    }

    function closeFileNoPickPopover() {
        ['wr', 'df', 'wp'].forEach(target => {
            const panel = document.getElementById(fileNoPickPanelId(target));
            const btn = document.getElementById(fileNoPickBtnId(target));
            const anchor = panel?.closest('.wr-file-no-anchor');
            if (panel) {
                panel.classList.add('hidden');
                panel.setAttribute('aria-hidden', 'true');
                panel.innerHTML = '';
                panel.style.top = '';
            }
            btn?.classList.remove('is-open');
            anchor?.classList.remove('is-file-no-pick-open');
        });
        state._fileNoPickOpen = false;
    }

    function openFileNoPickModal(target) {
        const nextTarget = target || 'wr';
        const panel = document.getElementById(fileNoPickPanelId(nextTarget));
        if (!panel) return;
        const alreadyOpen = state._fileNoPickOpen && state._fileNoPickTarget === nextTarget
            && !panel.classList.contains('hidden');
        if (alreadyOpen) {
            closeFileNoPickPopover();
            return;
        }
        closeFileNoPickPopover();
        state._fileNoPickTarget = nextTarget;
        state._fileNoPickSearch = '';
        state._fileNoPickOpen = true;
        if (nextTarget === 'wr') captureWorkReportForm();
        else if (nextTarget === 'df') TVC_DefectReport.captureDfFormFields?.();
        else TVC_WorkPermitReport.captureWpFormFields?.();
        panel.innerHTML = renderFileNoPickPopoverBody();
        panel.classList.remove('hidden');
        panel.setAttribute('aria-hidden', 'false');
        const anchor = panel.closest('.wr-file-no-anchor');
        anchor?.classList.add('is-file-no-pick-open');
        document.getElementById(fileNoPickBtnId(nextTarget))?.classList.add('is-open');
        positionFileNoPickPopover(nextTarget);
        requestAnimationFrame(() => positionFileNoPickPopover(nextTarget));
    }

    function closeFileNoPickModal() {
        closeFileNoPickPopover();
    }

    function fileNoPickSearch(v) {
        state._fileNoPickSearch = v || '';
        const target = state._fileNoPickTarget || 'wr';
        const panel = document.getElementById(fileNoPickPanelId(target));
        if (!panel || panel.classList.contains('hidden')) return;
        panel.innerHTML = renderFileNoPickPopoverBody();
        positionFileNoPickPopover(target);
    }

    function applyFileNoPick(fileNo) {
        const val = String(fileNo || '').trim();
        if (state._fileNoPickTarget === 'df') {
            TVC_DefectReport.applyFileNoFromPicker?.(val);
        } else if (state._fileNoPickTarget === 'wp') {
            TVC_WorkPermitReport.applyFileNoFromPicker?.(val);
        } else {
            state._wrForm = state._wrForm || {};
            state._wrForm.fileNo = val;
            const inp = document.querySelector('#workReportBody [data-wf="fileNo"]');
            if (inp) inp.value = val;
            else renderWorkReportModal({ preserveScroll: true });
        }
        closeFileNoPickModal();
    }

    function buildWrGroupPickList() {
        const key = wrIsNoGroup() ? WR_NO_GROUP_KEY : wrGroupKeyFromForm();
        const q = (_wrGroupPickSearch || '').toLowerCase().trim();
        const matchNode = (n) => !q || TVC_SpareMenu.safeTreeLabel(n.label).toLowerCase().includes(q)
            || String(n.department || '').toLowerCase().includes(q);
        const matchNoSelection = !q || 'no pms group'.includes(q) || q.includes('no pms') || q.includes('no group');
        let html = '';
        if (matchNoSelection) {
            const sel = key === WR_NO_GROUP_KEY ? ' selected' : '';
            html += `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-none${sel}"
                onclick="TVC_App.pickWrGroup('${escAttr(WR_NO_GROUP_KEY)}','${escAttr(WR_NO_GROUP_LABEL)}')">${esc(WR_NO_GROUP_LABEL)}</button>`;
        }
        let curDept = '';
        (TVC_SpareMenu.getPlanGroupPickNodes(state) || []).filter(matchNode).forEach(n => {
            if (n.department !== curDept) {
                html += `<div class="spare-consume-pick-dept">${esc(n.department)}</div>`;
                curDept = n.department;
            }
            html += `<button type="button" class="spare-consume-pick-item${key === n.key ? ' selected' : ''}"
                onclick="TVC_App.pickWrGroup('${escAttr(n.key)}','${escAttr(n.label)}')">${esc(TVC_SpareMenu.safeTreeLabel(n.label))}</button>`;
        });
        return html || '<div class="spare-consume-pick-empty muted">No groups</div>';
    }

    function buildWrJobPickList() {
        const gk = wrGroupKeyFromForm();
        if (!gk) return '<div class="spare-consume-pick-empty muted">Select PMS Group first.</div>';
        const q = (_wrJobPickSearch || '').toLowerCase().trim();
        const jobs = (TVC_SpareMenu.getJobsForGroupKey(state, gk) || []).filter(j => {
            if (!q) return true;
            return [j.job_code, j.item_sort1, j.item_sort2, j.job_detail].join(' ').toLowerCase().includes(q);
        });
        const cur = state.idx?.jobById.get(state._wrJobId);
        const selectedCode = cur?.job_code || '';
        const clearBtn = `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-none${selectedCode ? '' : ' selected'}"
                onclick="TVC_App.clearWrJobRow()">
                <span class="spare-consume-pick-job-code">— No Job Code —</span>
                <span class="spare-consume-pick-job-sub muted">PMS Group only</span>
            </button>`;
        return clearBtn + (jobs.map(j => `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-job${cur?.id === j.id ? ' selected' : ''}"
            onclick="TVC_App.pickWrJob('${escAttr(j.id)}')"><span class="spare-consume-pick-job-code">${esc(j.job_code)}</span></button>`).join('')
            || '<div class="spare-consume-pick-empty muted">No jobs</div>');
    }

    function toggleWrGroupPick(ev) {
        ev?.stopPropagation();
        const wrap = document.getElementById('wrGroupPick');
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        closeWrPickMenu(document.getElementById('wrJobPick'));
        closeWrJobRowPickMenu();
        if (!opening) {
            closeWrPickMenu(wrap);
            return;
        }
        wrap.classList.add('open');
        const list = document.getElementById('wrGroupPickList');
        if (list) list.innerHTML = buildWrGroupPickList();
        positionWrPickMenu(wrap, 360);
        setTimeout(() => document.addEventListener('click', function c(e) {
            if (!wrap.contains(e.target) && !(wrap._portalMenu?.contains(e.target))) {
                closeWrPickMenu(wrap); document.removeEventListener('click', c);
            }
        }), 0);
    }

    async function toggleWrJobPick(ev) {
        ev?.stopPropagation();
        if (!wrGroupKeyFromForm()) await TVC_Dialog.alert('Select PMS Group No. first.');
        const wrap = document.getElementById('wrJobPick');
        if (!wrap) return;
        closeWrPickMenu(document.getElementById('wrGroupPick'));
        closeWrJobRowPickMenu();
        if (wrap.classList.contains('open')) { closeWrPickMenu(wrap); return; }
        wrap.classList.add('open');
        const list = document.getElementById('wrJobPickList');
        if (list) list.innerHTML = buildWrJobPickList();
        positionWrPickMenu(wrap, 420);
        setTimeout(() => document.addEventListener('click', function c(e) {
            if (!wrap.contains(e.target) && !(wrap._portalMenu?.contains(e.target))) {
                closeWrPickMenu(wrap); document.removeEventListener('click', c);
            }
        }), 0);
    }

    function pickWrGroup(groupKey, groupLabel) {
        captureWorkReportForm();
        const prev = state._wrForm.pmsGroupKey;
        if (groupKey === WR_NO_GROUP_KEY) {
            state._wrForm.pmsGroupKey = WR_NO_GROUP_KEY;
            state._wrForm.pmsGroupNo = WR_NO_GROUP_LABEL;
            state._wrForm.maker = '';
            state._wrForm.modelType = '';
            state._wrForm.capacity = '';
            state._wrForm.serialNo = '';
        } else {
            state._wrForm.pmsGroupKey = groupKey;
            state._wrForm.pmsGroupNo = groupLabel;
            const hdr = TVC_SpareMenu.resolveGroupHeaderByKey(state, groupKey, groupLabel);
            state._wrForm.maker = hdr.maker || '';
            state._wrForm.modelType = hdr.modelType || '';
            state._wrForm.capacity = hdr.capacity || '';
            state._wrForm.serialNo = hdr.serialNo || '';
        }
        if (prev !== groupKey) {
            state._wrForm.jobName = state._wrForm.jobName || '';
            state._wrJobItems = [TVC_SpareMenu.newConsumeJobRow()];
        }
        closeWrPickMenu(document.getElementById('wrGroupPick'));
        renderWorkReportModal({ preserveScroll: true });
    }

    function pickWrJob(jobId) {
        captureWorkReportForm();
        const job = state.idx?.jobById.get(jobId);
        if (!job) return;
        if (state._wrJobId === jobId) {
            closeWrPickMenu(document.getElementById('wrJobPick'));
            return;
        }
        state._wrJobId = jobId;
        state._wrForm.pmsGroupKey = `${job.department}|${String(job.group || '').trim()}`;
        state._wrForm.pmsGroupNo = job.group || state._wrForm.pmsGroupNo;
        const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
        Object.assign(state._wrForm, {
            maker: hdr.maker || '', modelType: hdr.modelType || '',
            capacity: hdr.capacity || '', serialNo: hdr.serialNo || '',
            runHrs: String(state._wrForm.runHrs || '0'),
            lastMaintDate: state._wrForm.lastMaintDate || job.last_done || new Date().toISOString().slice(0, 10),
        });
        closeWrPickMenu(document.getElementById('wrJobPick'));
        applyWrFormToDom();
        syncWrJobHeaderFieldsToDom(job);
    }

    function applyWrFormToDom(form = state._wrForm) {
        const host = document.getElementById('workReportBody');
        if (!host || !form) return;
        host.querySelectorAll('[data-wf]').forEach(el => {
            const key = el.dataset.wf;
            if (!Object.prototype.hasOwnProperty.call(form, key)) return;
            const v = form[key];
            if (el.type === 'checkbox') el.checked = !!v;
            else el.value = v ?? '';
        });
    }

    function syncWrJobHeaderFieldsToDom(job) {
        if (!job) return;
        const host = document.getElementById('workReportBody');
        if (!host) return;
        const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
        const roMap = {
            pmsGroupNo: hdr.pmsGroupNo || job.group || '',
            maker: hdr.maker || '',
            modelType: hdr.modelType || '',
            capacity: hdr.capacity || '',
            serialNo: hdr.serialNo || '',
        };
        host.querySelectorAll('input.wr-ro[data-wf]').forEach(el => {
            const key = el.dataset.wf;
            if (Object.prototype.hasOwnProperty.call(roMap, key)) el.value = roMap[key];
        });
        host.querySelectorAll('.wr-maint-field').forEach(fld => {
            const label = fld.querySelector('label')?.textContent?.trim();
            const input = fld.querySelector('input.wr-ro:not([data-wf])');
            if (!input) return;
            if (label === 'SORT-1') input.value = job.item_sort1 || '';
            else if (label === 'SORT-2') input.value = job.item_sort2 || '';
            else if (label === 'Job Detail') input.value = job.job_detail || '';
        });
        const jobPickText = host.querySelector('#wrJobPick .spare-consume-pick-text');
        if (jobPickText) jobPickText.textContent = job.job_code || '—';
    }

    function updateBatchJobRowHighlight(activeJobId) {
        document.querySelectorAll('.wr-maint-batch-job-row[data-batch-job-id]').forEach(row => {
            row.classList.toggle('wr-maint-batch-job-row-active', row.dataset.batchJobId === activeJobId);
        });
    }

    function refreshBatchActiveJobSwitch() {
        const job = state.idx?.jobById.get(state._wrJobId);
        if (!job) return;
        if (state._wrPage === '2') {
            TVC_SpareMenu.refreshWrSpareJobContext?.();
            applyWrFormToDom();
            syncWrJobHeaderFieldsToDom(job);
            updateBatchJobRowHighlight(state._wrJobId);
            return;
        }
        applyWrFormToDom();
        syncWrJobHeaderFieldsToDom(job);
        updateBatchJobRowHighlight(state._wrJobId);
    }

    function wrGroupPickSearch(v) { _wrGroupPickSearch = v || ''; const l = document.getElementById('wrGroupPickList'); if (l) l.innerHTML = buildWrGroupPickList(); }
    function wrJobPickSearch(v) { _wrJobPickSearch = v || ''; const l = document.getElementById('wrJobPickList'); if (l) l.innerHTML = buildWrJobPickList(); }

    function renderWrGroupPick(ro) {
        const text = wrIsNoGroup()
            ? WR_NO_GROUP_LABEL
            : (wf('pmsGroupNo') ? TVC_SpareMenu.safeTreeLabel(wf('pmsGroupNo')) : '— Select PMS Group —');
        if (ro) return `<input class="wr-ro" value="${esc(text)}" readonly>`;
        return `<div class="spare-consume-meta-pick" id="wrGroupPick"><button type="button" class="wr-maint-job-pick spare-consume-pick-trigger" onclick="TVC_App.toggleWrGroupPick(event)">
            <span class="spare-consume-pick-text">${esc(text)}</span><span class="spare-consume-pick-caret">▾</span></button>
            <div class="spare-consume-pick-menu" role="listbox" aria-label="PMS Group No.">
                <div class="spare-consume-pick-search"><input type="search" class="search-input" placeholder="Search GROUP…" value="${esc(_wrGroupPickSearch || '')}" oninput="TVC_App.wrGroupPickSearch(this.value)" onclick="event.stopPropagation()"></div>
                <div class="spare-consume-pick-head muted">PMS GROUP Tree</div>
                <div class="spare-consume-pick-scroll" id="wrGroupPickList"></div>
            </div></div>`;
    }

    function wrPmsGroupInner(job, hdr, ro, forPrint) {
        if (forPrint || ro) {
            const text = wrIsNoGroup()
                ? WR_NO_GROUP_LABEL
                : TVC_SpareMenu.safeTreeLabel(wf('pmsGroupNo', hdr?.pmsGroupNo || job?.group || ''));
            return `<input class="wr-ro" data-wf="pmsGroupNo" value="${esc(text)}" readonly tabindex="-1">`;
        }
        return renderWrGroupPick(false);
    }

    function wrCriticalLabelForForm(job, hdr) {
        if (wrIsNoGroup()) return '—';
        return jobCriticalEquipmentDisplay(job, wf('pmsGroupNo', hdr?.pmsGroupNo || job?.group));
    }

    function renderWrJobPick(ro) {
        const job = state.idx?.jobById.get(state._wrJobId);
        const text = job?.job_code || '— JOB CODE 선택 —';
        if (ro) return `<input class="wr-ro" value="${esc(job?.job_code || '')}" readonly>`;
        const dis = !wrGroupKeyFromForm();
        return `<div class="spare-consume-meta-pick" id="wrJobPick"><button type="button" class="spare-consume-pick-trigger"${dis ? ' disabled' : ''} onclick="TVC_App.toggleWrJobPick(event)">
            <span class="spare-consume-pick-text">${esc(text)}</span><span class="spare-consume-pick-caret">▾</span></button>
            <div class="spare-consume-pick-menu"><div class="spare-consume-pick-search"><input type="search" class="search-input" placeholder="Search JOB CODE…" oninput="TVC_App.wrJobPickSearch(this.value)" onclick="event.stopPropagation()"></div>
            <div class="spare-consume-pick-scroll" id="wrJobPickList"></div></div></div>`;
    }

    function wrFormFlag(key) {
        if (key === 'repairRequest') return !!(wf('repairRequest') || wf('dockingRepair'));
        if (key === 'shoreSupport') return !!(wf('shoreSupport') || wf('pendingForRepair') || wf('shoreTechnician'));
        if (key === 'defectCleared') return !!(wf('defectCleared') || wf('allPendingCleared'));
        return !!wf(key);
    }

    function hqSuperintendentLabel(user) {
        return TVC_RBAC.getRankLabel(user) || 'Superintendent';
    }

    function wrHqApprovalUiState(rep, job, ro) {
        const user = state.user;
        const isHq = TVC_RBAC.isHqAccount(user);
        const isStatusConfirmed = !!rep && TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked);
        const isRepApproved = !!rep && reportIsApproved(rep);
        const isRepConfirmed = reportShowsConfirmed(rep);
        const hqDirectApprove = !!rep && !isRepApproved && TVC_RBAC.canHqDirectApprove(user, rep);
        const editMode = !ro;
        const approvalLive = !editMode;
        const canConfirmNow = approvalLive && !isHq && !!rep && !!job && TVC_RBAC.canConfirmDepartment(user, job.department)
            && (TVC_RBAC.isReportedStatus(rep.status, rep.is_locked)
                || (isStatusConfirmed && !isRepApproved));
        const canUnapproveNow = approvalLive && isHq && isRepApproved && TVC_RBAC.canApproveHqReport(user);
        const canApproveNow = canUnapproveNow || (approvalLive && !!rep && !isRepApproved && TVC_RBAC.canApproveHqReport(user)
            && (isStatusConfirmed || hqDirectApprove));
        const confirmedByVal = isRepConfirmed
            ? (TVC_RBAC.resolveConfirmByLabel?.(rep?.confirmed_by, job?.department, user) || rep?.confirmed_by || '')
            : '';
        const approvedByVal = isRepApproved
            ? (rep?.approved_by || hqSuperintendentLabel(user))
            : '';
        const canEditCompanyComment = isHq && editMode && !!rep && TVC_RBAC.canApproveHqReport(user)
            && (isRepApproved || isRepConfirmed || TVC_RBAC.canHqDirectApprove(user, rep));
        return {
            isHq, isRepConfirmed, isRepApproved, canConfirmNow, canApproveNow,
            confirmedByVal, approvedByVal, canEditCompanyComment, hqDirectApprove,
        };
    }

    async function wrHistConfirmOrApprove() {
        if (!state._wrReadonly || !state._wrFromHistory) return;
        const user = TVC_Auth.getCurrentUser();
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const job = state.idx?.jobById.get(state._wrJobId);
        if (!user || !rep || !job) return;
        if (TVC_RBAC.isHqAccount(user)) {
            if (!TVC_RBAC.canApproveHqReport(user)) {
                await TVC_Dialog.alert('This action is available in HQ Mode only.');
                return;
            }
            if (reportIsApproved(rep)) {
                try {
                    await TVC_Transaction.unapproveReport(user, rep.id);
                    await refreshAll();
                    const saved = state.reports.find(r => r.id === rep.id) || rep;
                    reloadWorkReportViewFromDb(saved, job);
                    renderWorkReportModal();
                    await TVC_Dialog.alert(`${job.job_code} approval removed.`);
                } catch (e) {
                    await TVC_Dialog.alert(e.message || e.code || 'Unapprove failed');
                }
                return;
            }
            if (!TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked) && !TVC_RBAC.canHqDirectApprove(user, rep)) {
                try {
                    await TVC_Transaction.confirmReport(user, rep.id);
                } catch (e) {
                    await TVC_Dialog.alert(e.message || e.code || 'Confirm required before Approve.');
                    return;
                }
            }
            try {
                const companyComment = readWrCompanyComment(rep);
                await TVC_Transaction.approveReport(user, rep.id, companyComment);
                await refreshAll();
                const saved = state.reports.find(r => r.id === rep.id) || rep;
                reloadWorkReportViewFromDb(saved, job);
                renderWorkReportModal();
                await TVC_Dialog.alert(`${job.job_code} report approved by company.`);
            } catch (e) {
                await TVC_Dialog.alert(e.message || e.code || 'Approve failed');
            }
            return;
        }
        if (!TVC_RBAC.canConfirmDepartment(user, job.department)) {
            await TVC_Dialog.alert('You do not have permission to confirm this report.');
            return;
        }
        if (TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked)) {
            if (reportIsApproved(rep)) {
                await TVC_Dialog.alert('Approved items cannot be unconfirmed.');
                return;
            }
            try {
                await TVC_Transaction.unconfirmReport(user, rep.id);
                await refreshAll();
                const saved = state.reports.find(r => r.id === rep.id) || rep;
                reloadWorkReportViewFromDb(saved, job);
                renderWorkReportModal();
                await TVC_Dialog.alert(`${job.job_code} report unconfirmed. (Returned to Reported)`);
            } catch (e) {
                await TVC_Dialog.alert(e.message || e.code || 'Unconfirm failed');
            }
            return;
        }
        if (!TVC_RBAC.isReportedStatus(rep.status, rep.is_locked)) {
            await TVC_Dialog.alert('Only Reported items can be confirmed.');
            return;
        }
        try {
            await TVC_Transaction.confirmReport(user, rep.id);
            await refreshAll();
            const saved = state.reports.find(r => r.id === rep.id) || rep;
            reloadWorkReportViewFromDb(saved, job);
            renderWorkReportModal();
            const msg = rep.work_type === 'POSTPONE'
                ? `${job.job_code} postpone report confirmed. (NEXT DATE updated)`
                : `${job.job_code} report confirmed. (LAST DONE / NEXT DATE update)`;
            await TVC_Dialog.alert(msg);
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Confirm failed');
        }
    }

    async function wrApprovedByToggle() {
        const apCb = document.getElementById('wrApprovedBy');
        if (!apCb || apCb.disabled) return;
        const user = TVC_Auth.getCurrentUser();
        if (!user || !TVC_RBAC.isHqAccount(user)) return;
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const job = state.idx?.jobById.get(state._wrJobId);
        const input = apCb.closest('.wr-maint-approval-item')?.querySelector('.wr-maint-date');
        const superLabel = hqSuperintendentLabel(user);
        if (!apCb.checked) {
            if (rep && reportIsApproved(rep) && state._wrReadonly && TVC_RBAC.canApproveHqReport(user)) {
                try {
                    await TVC_Transaction.unapproveReport(user, rep.id);
                    await refreshAll();
                    const saved = state.reports.find(r => r.id === rep.id) || rep;
                    if (job) reloadWorkReportViewFromDb(saved, job);
                    renderWorkReportModal();
                    await TVC_Dialog.alert(`${job?.job_code || 'Report'} approval removed.`);
                } catch (e) {
                    apCb.checked = true;
                    if (input) input.value = rep.approved_by || superLabel;
                    await TVC_Dialog.alert(e.message || e.code || 'Unapprove failed');
                }
                return;
            }
            if (rep && reportIsApproved(rep)) {
                apCb.checked = true;
                if (input) input.value = rep.approved_by || superLabel;
                return;
            }
            if (input) input.value = '';
            return;
        }
        if (rep && reportIsApproved(rep)) {
            if (input) input.value = rep.approved_by || superLabel;
            return;
        }
        if (!rep || !state._wrReadonly) {
            if (input) input.value = superLabel;
            return;
        }
        if (!TVC_RBAC.canApproveHqReport(user)) {
            apCb.checked = false;
            if (input) input.value = '';
            return;
        }
        if (!TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked) && !TVC_RBAC.canHqDirectApprove(user, rep)) {
            apCb.checked = false;
            if (input) input.value = '';
            await TVC_Dialog.alert('Confirm required before Approve.');
            return;
        }
        try {
            const companyComment = readWrCompanyComment(rep);
            await TVC_Transaction.approveReport(user, rep.id, companyComment);
            await refreshAll();
            const saved = state.reports.find(r => r.id === rep.id) || rep;
            if (job) reloadWorkReportViewFromDb(saved, job);
            renderWorkReportModal();
            await TVC_Dialog.alert(`${job?.job_code || 'Report'} report approved by company.`);
        } catch (e) {
            apCb.checked = false;
            if (input) input.value = '';
            await TVC_Dialog.alert(e.message || e.code || 'Approve failed');
        }
    }

    async function applyWrHqApprovalFromUi(user, rep) {
        if (!user || !rep || reportIsApproved(rep)) return rep;
        const apCb = document.getElementById('wrApprovedBy');
        if (!apCb || apCb.disabled || !apCb.checked) return rep;
        if (!TVC_RBAC.canApproveHqReport(user)) return rep;
        if (!TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked) && !TVC_RBAC.canHqDirectApprove(user, rep)) {
            return rep;
        }
        const companyComment = readWrCompanyComment(rep);
        await TVC_Transaction.approveReport(user, rep.id, companyComment);
        return state.reports.find(r => r.id === rep.id) || rep;
    }

    function readWrCompanyComment(rep) {
        const el = document.getElementById('wrCompanyComment');
        if (el && !el.readOnly && !el.disabled) return String(el.value || '').trim();
        return String(rep?.company_comment || '').trim();
    }

    function renderWrReportFooter(opts = {}) {
        const {
            rep = null,
            ro = false,
            forPrint = false,
            canEditShipAttach = true,
            canEditCompanyAttach = false,
            canEditCompanyComment = false,
            showShipComment = true,
            showLaborRow = true,
            shipCommentLabel = "Ship's Comments (If any)",
        } = opts;
        const locked = ro || forPrint;
        const dis = locked ? ' disabled' : '';
        const roAttr = locked ? ' readonly' : '';
        const companyCommentVal = rep?.company_comment || '';
        const companyCommentEditable = canEditCompanyComment && !forPrint;
        const companyCommentField = companyCommentEditable
            ? `<textarea class="wr-maint-textarea wr-company-comment-edit" id="wrCompanyComment" rows="3" placeholder="Enter company reply…">${esc(companyCommentVal)}</textarea>`
            : `<textarea class="wr-maint-textarea wr-ro" id="wrCompanyComment" rows="3" readonly tabindex="-1">${esc(companyCommentVal)}</textarea>`;
        const fld = (label, inner, extraCls = '') =>
            `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const flagChk = (key, label) => `<label class="wr-footer-flag">
            <input type="checkbox" data-wf="${key}"${wrFormFlag(key) ? ' checked' : ''}${dis}>
            <span>${esc(label)}</span>
        </label>`;

        const laborRow = showLaborRow ? `
            <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap">
                ${fld('Working Hours', `<input type="number" class="${locked ? 'wr-ro' : ''}" data-wf="handHours" value="${esc(wf('handHours', '0'))}"${locked ? ' readonly tabindex="-1"' : dis}>`)}
                ${fld('Working Member', `<input type="number" class="${locked ? 'wr-ro' : ''}" data-wf="handMembers" value="${esc(wf('handMembers', '0'))}"${locked ? ' readonly tabindex="-1"' : dis}>`)}
                <div class="wr-maint-field wr-maint-chk-field">${flagChk('shoreSupport', 'Conducted by Shore Support')}</div>
            </div>` : '';

        return `
            ${laborRow}
            ${showShipComment ? `
                ${fld(shipCommentLabel, `<textarea class="wr-maint-textarea${locked ? ' wr-ro' : ''}" data-wf="shipComments" rows="3"${roAttr}${dis}>${esc(wf('shipComments'))}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
                ${fld('', renderWrAttachmentBlock('ship', { canUpload: canEditShipAttach && !locked, forPrint }), 'wr-maint-span-all wr-maint-grid-gap')}
            ` : ''}
            ${fld("Company's Comments", companyCommentField, 'wr-maint-span-all wr-maint-grid-gap')}
            ${fld('', renderWrAttachmentBlock('company', { canUpload: canEditCompanyAttach && !locked, forPrint }), 'wr-maint-span-all wr-maint-grid-gap')}
        `;
    }

    function renderWrRepairMaintenanceBody(job, opts = {}) {
        const {
            rep = null,
            reportedByName = '',
            today = new Date().toISOString().slice(0, 10),
            canApproveNow = false,
            canConfirmNow = false,
            isRepApproved = false,
            isRepConfirmed = false,
            approvedByVal = '',
            confirmedByVal = '',
            canEditShipAttach = true,
            canEditCompanyAttach = false,
            canEditCompanyComment = false,
            batchMode = false,
            batchJobIds = [],
            activeJobId = null,
            ro = false,
            forPrint = false,
        } = opts;
        const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
        const fld = (label, inner, extraCls = '') => `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const fieldInp = (key, val, type = 'text') => {
            if (forPrint && type === 'date') return wrDateUiPrintInput(wf(key, val));
            if (forPrint || ro) {
                const v = esc(wf(key, val));
                if (type === 'number') return `<input type="number" class="wr-ro" data-wf="${key}" value="${v}" readonly tabindex="-1">`;
                return `<input class="wr-ro" data-wf="${key}" value="${v}" readonly tabindex="-1">`;
            }
            if (type === 'number') return `<input type="number" data-wf="${key}" value="${esc(wf(key, val))}">`;
            return `<input data-wf="${key}" value="${esc(wf(key, val))}">`;
        };
        const roWf = (key, val) => `<input class="wr-ro" data-wf="${key}" value="${esc(wf(key, val))}" readonly tabindex="-1">`;
        const jobInfoBlock = renderWrJobRowsBlock(job, rep, ro, forPrint);

        return `<div class="wr-maint-form">
            ${renderWrApprovalHtml({
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal, forPrint,
            })}

            <section class="wr-maint-card wr-maint-body wr-file-no-anchor">
                <div class="wr-maint-grid wr-maint-grid-3">
                    ${fld('File No.', renderFileNoInputHtml({ value: wf('fileNo', ''), ro, forPrint }))}
                    ${fld('Voy. No.', fieldInp('voyNo', ''))}
                    ${fld('Place', fieldInp('place', ''))}
                    ${fld('Work Date', fieldInp('workDate', today, 'date'))}
                    ${fld('Reported Date', fieldInp('reportDate', today, 'date'))}
                    ${fld('Reported by', `<input class="wr-ro" value="${esc(reportedByName)}" readonly>`)}
                </div>
                ${renderWrPmsGroupCriticalRow({
                    pmsInner: wrPmsGroupInner(job, hdr, ro, forPrint),
                    criticalLabel: wrCriticalLabelForForm(job, hdr),
                    forPrint,
                })}
                ${jobInfoBlock}
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Maker', roWf('maker', hdr.maker))}
                    ${fld('Model / Type', roWf('modelType', hdr.modelType))}
                    ${fld('Capacity', roWf('capacity', hdr.capacity))}
                    ${fld('Serial No.', roWf('serialNo', hdr.serialNo))}
                </div>
                <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap">
                    ${fld('Total Run Hrs', fieldInp('runHrs', '0', 'number'))}
                    ${fld('Last Maintenance Date', fieldInp('lastMaintDate', job.last_done || '', 'date'))}
                    ${fld('Running Hrs after Last Maint.', fieldInp('rhAfterLastMaint', ''))}
                </div>
                ${fld('Outline of Maintenance', `<textarea class="wr-maint-textarea${forPrint || ro ? ' wr-ro' : ''}" data-wf="outline" rows="3"${forPrint || ro ? ' readonly' : ''}>${esc(wf('outline'))}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
                ${renderWrReportFooter({
                    rep,
                    ro,
                    forPrint,
                    canEditShipAttach,
                    canEditCompanyAttach,
                    canEditCompanyComment,
                })}
                ${forPrint ? '' : renderFileNoPickPanelHtml('wr')}
            </section>
            </div>`;
    }

    function renderWrPostponeBody(job, opts = {}) {
        const {
            rep = null,
            reportedByName = '',
            today = new Date().toISOString().slice(0, 10),
            canApproveNow = false,
            canConfirmNow = false,
            isRepApproved = false,
            isRepConfirmed = false,
            approvedByVal = '',
            confirmedByVal = '',
            canEditShipAttach = true,
            canEditCompanyAttach = false,
            canEditCompanyComment = false,
            batchMode = false,
            batchJobIds = [],
            ro = false,
            forPrint = false,
        } = opts;
        const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
        const fld = (label, inner, extraCls = '') => `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const fieldInp = (key, val, type = 'text') => {
            if (forPrint && type === 'date') return wrDateUiPrintInput(wf(key, val));
            if (forPrint || ro) {
                const v = esc(wf(key, val));
                if (type === 'number') return `<input type="number" class="wr-ro" data-wf="${key}" value="${v}" readonly tabindex="-1">`;
                return `<input class="wr-ro" data-wf="${key}" value="${v}" readonly tabindex="-1">`;
            }
            if (type === 'number') return `<input type="number" data-wf="${key}" value="${esc(wf(key, val))}">`;
            return `<input data-wf="${key}" value="${esc(wf(key, val))}">`;
        };
        const roWf = (key, val) => `<input class="wr-ro" data-wf="${key}" value="${esc(wf(key, val))}" readonly tabindex="-1">`;
        const originalDueDate = TVC_WorkReport.postponeOriginalDueDate(rep, job);
        const postponeMaxDate = originalDueDate
            ? (TVC_WorkReport.postponeMaxDate(originalDueDate) || '')
            : '';
        const postponeMinMax = (!forPrint && !ro && originalDueDate)
            ? ` min="${esc(originalDueDate)}"${postponeMaxDate ? ` max="${esc(postponeMaxDate)}"` : ''}`
            : '';
        const jobInfoBlock = renderWrJobRowsBlock(job, rep, ro, forPrint);

        return `<div class="wr-maint-form">
            ${renderWrApprovalHtml({
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal, forPrint,
            })}
            <section class="wr-maint-card wr-maint-body wr-file-no-anchor">
                <div class="wr-maint-grid wr-maint-grid-3">
                    ${fld('File No.', renderFileNoInputHtml({ value: wf('fileNo', ''), ro, forPrint }))}
                    ${fld('Voy. No.', fieldInp('voyNo', ''))}
                    ${fld('Place', fieldInp('place', ''))}
                    ${fld('Reported Date', fieldInp('reportDate', today, 'date'))}
                    ${fld('Reported by', `<input class="wr-ro" value="${esc(reportedByName)}" readonly>`)}
                </div>
                ${renderWrPmsGroupCriticalRow({
                    pmsInner: wrPmsGroupInner(job, hdr, ro, forPrint),
                    criticalLabel: wrCriticalLabelForForm(job, hdr),
                    forPrint,
                })}
                ${jobInfoBlock}
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Maker', roWf('maker', hdr.maker))}
                    ${fld('Model / Type', roWf('modelType', hdr.modelType))}
                    ${fld('Capacity', roWf('capacity', hdr.capacity))}
                    ${fld('Serial No.', roWf('serialNo', hdr.serialNo))}
                </div>
                <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap">
                    ${fld('Total Run Hrs', fieldInp('runHrs', '0', 'number'))}
                    ${fld('Last Maintenance Date', fieldInp('lastMaintDate', job.last_done || '', 'date'))}
                    ${fld('Running Hrs after Last Maint.', fieldInp('rhAfterLastMaint', ''))}
                </div>
                <div class="wr-maint-grid wr-maint-grid-2 wr-maint-grid-gap">
                    ${fld('Original Due Date', forPrint ? `<input class="wr-ro" value="${esc(originalDueDate || '—')}" readonly tabindex="-1">` : `<input class="wr-ro" value="${esc(originalDueDate || '—')}" readonly>`)}
                    ${fld('Postpone Date', forPrint
                        ? `<input class="wr-ro" value="${esc(wf('postponeDate') || '')}" readonly tabindex="-1">`
                        : `<input type="date" class="tvc-date-input" data-wf="postponeDate" placeholder="YYYY-MM-DD" value="${esc(wf('postponeDate'))}"${postponeMinMax}${ro ? ' disabled' : ''} onchange="TVC_App.onPostponeDateChange()">`, 'wr-postpone-date')}
                </div>
                ${renderWrReportFooter({
                    rep,
                    ro,
                    forPrint,
                    canEditShipAttach,
                    canEditCompanyAttach,
                    canEditCompanyComment,
                    showLaborRow: false,
                    shipCommentLabel: "Ship's Comments (Reason)",
                })}
                ${forPrint ? '' : renderFileNoPickPanelHtml('wr')}
            </section>
        </div>`;
    }

    function renderWrApprovalHtml(opts = {}) {
        const {
            canApproveNow = false,
            canConfirmNow = false,
            isRepApproved = false,
            isRepConfirmed = false,
            approvedByVal = '',
            confirmedByVal = '',
            hideApprovedBy = false,
            forPrint = false,
        } = opts;
        const displayOnly = forPrint || !!opts.displayOnly;
        const confirmOk = !displayOnly && canConfirmNow;
        const approveOk = !displayOnly && canApproveNow;
        const confirmDis = confirmOk ? '' : ' disabled';
        const approveDis = approveOk ? '' : ' disabled';
        const confirmOnchange = confirmOk ? ' onchange="TVC_App.wrReportConfirmByToggle()"' : '';
        const approveOnchange = approveOk ? ' onchange="TVC_App.wrApprovedByToggle()"' : '';
        const approvedRow = hideApprovedBy ? '' : `
            <div class="wr-maint-approval-item${approveOk ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="wrApprovedBy" ${isRepApproved ? 'checked' : ''}${approveDis}${approveOnchange}> Approved by</label>
                <input class="wr-ro wr-maint-date" value="${esc(approvedByVal)}" readonly>
            </div>`;
        return `<section class="wr-maint-card wr-maint-approval">
            <div class="wr-maint-approval-item${confirmOk ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="wrConfirmedBy" ${isRepConfirmed ? 'checked' : ''}${confirmDis}${confirmOnchange}> Confirmed by</label>
                <input class="wr-ro wr-maint-date" value="${esc(confirmedByVal)}" readonly>
            </div>
            ${approvedRow}
        </section>`;
    }

    function renderWrPage2HeadHtml(opts = {}) {
        return renderWrApprovalHtml(opts);
    }

    function renderWrPage2Body(ro) {
        const job = state.idx?.jobById.get(state._wrJobId);
        if (!job) return '';
        const today = new Date().toISOString().slice(0, 10);
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const reportedByName = workReportReportedByName(rep);
        return TVC_SpareMenu.renderWrSparePage2Html(job, ro, buildWrPage2Meta(job, reportedByName, today));
    }

    function syncWorkReportPage2Ui(showPages, ro) {
        const onPage2 = showPages && state._wrPage === '2';
        if (onPage2) TVC_SpareMenu.initWrSparePage2(ro);
        else TVC_SpareMenu.teardownWrSparePage2();
    }

    /** 현재 입력값을 임시 보관 (탭 전환 시 유실 방지) */
    function captureWorkReportForm() {
        captureWrJobItems();
        const host = document.getElementById('workReportBody');
        if (!host) return;
        state._wrForm = state._wrForm || {};
        host.querySelectorAll('[data-wf]').forEach(el => {
            state._wrForm[el.dataset.wf] = el.type === 'checkbox' ? el.checked : el.value;
        });
    }

    async function onPostponeDateChange() {
        captureWorkReportForm();
        const pd = String(wf('postponeDate') || '').slice(0, 10);
        if (!pd || !/^\d{4}-\d{2}-\d{2}$/.test(pd)) return;
        const job = state.idx?.jobById.get(state._wrJobId);
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const originalDueDate = TVC_WorkReport.postponeOriginalDueDate(rep, job);
        const check = TVC_WorkReport.postponeDateWithinMax(originalDueDate, pd);
        if (check.ok) return;
        await TVC_Dialog.alert(TVC_WorkReport.postponeDateRangeMessage(check));
    }

    function wf(key, fallback) {
        const v = state._wrForm ? state._wrForm[key] : undefined;
        return v !== undefined ? v : (fallback ?? '');
    }

    function wrAttachmentList(formKey) {
        state._wrForm = state._wrForm || {};
        if (!Array.isArray(state._wrForm[formKey])) state._wrForm[formKey] = [];
        return state._wrForm[formKey];
    }

    function readWrAttachmentFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({
                id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: file.name,
                type: file.type,
                size: file.size,
                dataUrl: reader.result,
                uploaded_at: new Date().toISOString(),
            });
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function renderWrAttachmentBlock(kind, { canUpload, forPrint = false }) {
        const formKey = kind === 'company' ? 'companyAttachments' : 'shipAttachments';
        const label = kind === 'company' ? "Company's Attachment" : "Ship's Attachment";
        const inputId = kind === 'company' ? 'wrCompanyAttachInput' : 'wrShipAttachInput';
        const list = wrAttachmentList(formKey);
        const items = list.map(a => TVC_Attachments.renderListItemHtml(a, {
            forPrint,
            canRemove: !forPrint && canUpload,
            removeOnclick: (!forPrint && canUpload)
                ? `TVC_App.removeWrAttachment('${kind}','${escAttr(a.id)}')`
                : '',
        })).join('');
        if (forPrint) {
            const listHtml = list.length ? `<div class="wr-attach-list-wrap"><ul class="wr-attach-list">${items}</ul></div>` : '';
            return `<div class="wr-attach-block wr-attach-print">
                <div class="wr-attach-toolbar"><span class="wr-attach-btn wr-print-static-attach">📎 ${esc(label)}</span></div>
                ${listHtml}
            </div>`;
        }
        const uploadBtn = canUpload
            ? `<button type="button" class="wr-attach-btn" onclick="document.getElementById('${inputId}').click()">📎 ${esc(label)}</button>
               <input type="file" id="${inputId}" class="hidden" multiple onchange="TVC_App.uploadWrAttachment('${kind}')">`
            : `<button type="button" class="wr-attach-btn" disabled tabindex="-1">📎 ${esc(label)}</button>`;
        const listHtml = list.length
            ? `<ul class="wr-attach-list">${items}</ul>`
            : '';
        return `
            <div class="wr-attach-block">
                <div class="wr-attach-toolbar">${uploadBtn}</div>
                ${listHtml ? `<div class="wr-attach-list-wrap">${listHtml}</div>` : ''}
            </div>`;
    }

    function canMutateWrAttachment(kind) {
        const ro = !!state._wrReadonly;
        const user = state.user;
        const isHq = !!(user && TVC_RBAC.isHqAccount(user));
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        if (kind === 'company') {
            const wrAppr = wrHqApprovalUiState(rep, state.idx?.jobById?.get(state._wrJobId), ro);
            return !ro && !!wrAppr.canApproveNow;
        }
        return !ro && !isHq && (!rep || TVC_RBAC.isReportedStatus(rep.status));
    }

    async function uploadWrAttachment(kind) {
        if (!canMutateWrAttachment(kind)) return;
        const inputId = kind === 'company' ? 'wrCompanyAttachInput' : 'wrShipAttachInput';
        const input = document.getElementById(inputId);
        if (!input?.files?.length) return;
        captureWorkReportForm();
        captureWorkReportUsedParts();
        const formKey = kind === 'company' ? 'companyAttachments' : 'shipAttachments';
        const list = wrAttachmentList(formKey);
        const maxBytes = 8 * 1024 * 1024;
        try {
            for (const file of input.files) {
                if (file.size > maxBytes) {
                    await TVC_Dialog.alert(`${file.name}: Only files up to 8 MB can be attached.`);
                    continue;
                }
                list.push(await readWrAttachmentFile(file));
            }
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Could not read the file.');
        }
        input.value = '';
        renderWorkReportModal({ preserveScroll: true });
    }

    function removeWrAttachment(kind, id) {
        if (!canMutateWrAttachment(kind)) return;
        captureWorkReportForm();
        captureWorkReportUsedParts();
        const formKey = kind === 'company' ? 'companyAttachments' : 'shipAttachments';
        const list = wrAttachmentList(formKey);
        const i = list.findIndex(a => a.id === id);
        if (i >= 0) list.splice(i, 1);
        renderWorkReportModal({ preserveScroll: true });
    }

    function renderBatchWorkReportModal(host) {
        captureBatchJobDraft();
        if (!state._wrJobId && state._batchJobIds.length) loadBatchJobIntoEditor(state._batchJobIds[0]);
        const job = state.idx?.jobById.get(state._wrJobId);
        if (!job) return;
        const today = new Date().toISOString().slice(0, 10);
        const ro = false;
        const tab = WR_TABS[state._wrTab] ? state._wrTab : 'repair';
        const reportedByName = TVC_RBAC.getReportedByLabel(state.user);
        const showPages = tab === 'repair';
        const canEditShipAttach = true;

        const batchJobTags = `
            <div class="batch-wr-jobs">
                ${state._batchJobIds.map(id => {
                    const j = state.idx?.jobById.get(id);
                    return `<span class="batch-wr-job-tag">${esc(j?.job_code || id)}</span>`;
                }).join('')}
            </div>`;

        const tabBtns = Object.entries(WR_TABS).map(([k, label]) =>
            `<label class="wr-radio${state._wrTab === k ? ' active' : ''}">
                <input type="radio" name="wrTab" ${state._wrTab === k ? 'checked' : ''} onclick="TVC_App.setWorkReportTab('${k}')"> ${esc(label)}
            </label>`,
        ).join('');

        const pageTabs = showPages ? `
            <div class="wr-pagetabs">
                <button type="button" class="wr-pagetab${state._wrPage === '1' ? ' active' : ''}" onclick="TVC_App.setWorkReportPage('1')">Page 1</button>
                <button type="button" class="wr-pagetab${state._wrPage === '2' ? ' active' : ''}" onclick="TVC_App.setWorkReportPage('2')">Page 2</button>
            </div>` : '';
        const pageTabsBar = showPages ? `<div class="wr-pagetabs-bar">${pageTabs}</div>` : '';

        const headHtml = showPages && state._wrPage === '2'
            ? renderWrPage2HeadHtml({ reportedByName })
            : '';

        let body = '';
        if (showPages && state._wrPage === '2') {
            body = renderWrPage2Body(ro);
        } else if (tab === 'postpone') {
            body = renderWrPostponeBody(job, {
                reportedByName, today,
                canEditShipAttach,
                batchMode: true,
                batchJobIds: state._batchJobIds,
            });
        } else {
            body = renderWrRepairMaintenanceBody(job, {
                reportedByName, today,
                canEditShipAttach,
                batchMode: true,
                batchJobIds: state._batchJobIds,
            });
        }

        const actionsHtml = `
            <button class="btn btn-green" onclick="TVC_App.saveBatchReport()">Save</button>
            <button class="btn" onclick="TVC_App.requestCloseWorkReport()">Cancel</button>`;

        host.innerHTML = `
            <div class="wr-titlebar">Work Report (Draft)</div>
            ${batchJobTags}
            <div class="wr-tabsel">${tabBtns}</div>
            ${pageTabsBar}
            <div class="wr-page tone-${tab}">
                ${headHtml}
                ${body}
            </div>
            <div class="modal-actions wr-actions">${actionsHtml}</div>`;
        syncWorkReportPage2Ui(showPages, ro);
        TVC_PWA?.initDateInputFormat?.(host);
    }

    function captureWorkReportModalScroll() {
        const page = document.querySelector('#workReportBody .wr-page');
        const modal = document.getElementById('workReportModal');
        return {
            pageTop: page?.scrollTop ?? 0,
            modalTop: modal?.scrollTop ?? 0,
        };
    }

    function restoreWorkReportModalScroll(saved) {
        if (!saved) return;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const page = document.querySelector('#workReportBody .wr-page');
                const modal = document.getElementById('workReportModal');
                if (page) page.scrollTop = saved.pageTop;
                if (modal) modal.scrollTop = saved.modalTop;
            });
        });
    }

    function renderWorkReportModal(opts = {}) {
        const scroll = opts.preserveScroll ? captureWorkReportModalScroll() : null;
        const forPrint = !!opts.forPrint;
        cleanupOrphanPickMenus();
        closeFileNoPickPopover();
        const host = document.getElementById('workReportBody');
        if (!host) return;
        let job = resolveJobById(state._wrJobId);
        const repEarly = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        if (!job && repEarly) {
            TVC_WorkReport.fromLegacy(repEarly);
            const item = TVC_WorkReport.findItem(repEarly, state._wrJobId)
                || TVC_WorkReport.getJobItems(repEarly)[0];
            job = resolveJobForWorkReport(item, repEarly);
            if (job) state._wrJobId = job.id;
        }
        if (!job) return;
        if (!WR_TABS[state._wrTab]) state._wrTab = 'repair';
        const today = new Date().toISOString().slice(0, 10);
        const ro = !!state._wrReadonly;
        // 승인/확정 워크플로 — Work History에서 리포트를 열었을 때만 활성
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const lockedTab = rep ? workReportTabForType(rep.work_type) : null;
        if (lockedTab) {
            state._wrTab = lockedTab;
            state._reportKindLocked = lockedTab;
        }
        const kindTabs = renderReportKindTabsHtml(state._wrTab);
        const wrJobItems = ensureWrJobItems(job, rep);
        const wrAppr = wrHqApprovalUiState(rep, job, ro);
        const {
            canConfirmNow, canApproveNow, confirmedByVal, approvedByVal, canEditCompanyComment,
            isRepConfirmed, isRepApproved,
        } = wrAppr;
        const reportedByName = workReportReportedByName(rep);
        const canEditShipAttach = !ro && !wrAppr.isHq && (!rep || TVC_RBAC.isReportedStatus(rep.status));
        const canEditCompanyAttach = !ro && wrAppr.isHq && TVC_RBAC.canApproveHqReport(state.user)
            && (isRepApproved || isRepConfirmed || wrAppr.hqDirectApprove);

        const showPages = state._wrTab === 'repair';
        const headHtml = showPages && state._wrPage === '2'
            ? renderWrPage2HeadHtml({
                reportedByName,
                canApproveNow,
                canConfirmNow,
                isRepApproved,
                isRepConfirmed,
                approvedByVal,
                confirmedByVal,
            })
            : '';

        let body = '';
        const pageTabs = showPages ? `
            <div class="wr-pagetabs">
                <button type="button" class="wr-pagetab${state._wrPage === '1' ? ' active' : ''}" onclick="TVC_App.setWorkReportPage('1')">Page 1</button>
                <button type="button" class="wr-pagetab${state._wrPage === '2' ? ' active' : ''}" onclick="TVC_App.setWorkReportPage('2')">Page 2</button>
            </div>` : '';
        const pageTabsBar = showPages ? `<div class="wr-pagetabs-bar">${pageTabs}</div>` : '';

        if (showPages && state._wrPage === '2') {
            body = renderWrPage2Body(ro);
        } else if (state._wrTab === 'repair') {
            body = renderWrRepairMaintenanceBody(job, {
                rep, reportedByName, today,
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal,
                canEditShipAttach, canEditCompanyAttach, canEditCompanyComment,
                ro,
            });
        } else if (state._wrTab === 'postpone') {
            body = renderWrPostponeBody(job, {
                rep, reportedByName, today,
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal,
                canEditShipAttach, canEditCompanyAttach, canEditCompanyComment,
                ro,
            });
        }

        const isHist = !!state._wrReportId;
        const histEntry = isHist ? getCurrentWrHistEntry() : null;
        const canModifyRow = histEntry && canModifyHistEntry(histEntry);
        const canDeleteRow = histEntry && canDeleteHistEntry(histEntry);
        const navBtns = isHist
            ? histNavButtonsHtml('TVC_App.navReport(-1)', 'TVC_App.navReport(1)')
            : '';
        const isHqUser = TVC_RBAC.isHqAccount(state.user);
        const histActionLabel = isHqUser ? 'Approve' : 'Confirm';
        const histActionOk = isHist && !!state._wrFromHistory && (isHqUser
            ? canApproveNow
            : canConfirmNow);
        const histActionBtn = isHist && state._wrFromHistory
            ? `<button type="button" class="btn" onclick="TVC_App.wrHistConfirmOrApprove()"${histActionOk ? '' : ' disabled'}>${histActionLabel}</button>`
            : '';
        const printBtn = isHist
            ? `${histActionBtn}<button class="btn" onclick="TVC_App.printWorkReport()">Print</button>
               <button class="btn" onclick="TVC_App.previewWorkReport()">Preview</button>`
            : '';
        let actionsClass = 'modal-actions wr-actions';
        let actionsHtml;
        if (state._wrPostSaveView && !state._wrFromHistory) {
            actionsClass += ' wr-actions-split';
            actionsHtml = `<div class="wr-modal-actions-left"></div>
                <div class="wr-modal-actions-center"></div>
                <div class="wr-modal-actions-right"><button class="btn" onclick="TVC_App.requestCloseWorkReport()">Close</button></div>`;
        } else if (isHist && state._wrFromHistory) {
            actionsClass += ' wr-actions-split';
            const closeBtn = `<button class="btn" onclick="TVC_App.requestCloseWorkReport()">Close</button>`;
            const modifyTitle = escAttr(histModifyDisabledTitle(histEntry));
            let centerBtns = '';
            if (ro) {
                centerBtns = `<button type="button" class="btn" onclick="TVC_App.modifyWorkReport()"${canModifyRow ? '' : ' disabled'}${modifyTitle ? ` title="${modifyTitle}"` : ''}>Modify</button>`;
            } else if (canModifyRow) {
                centerBtns = `<button type="button" class="btn btn-green" onclick="TVC_App.saveWorkReport()">Save</button>
                <button type="button" class="btn" onclick="TVC_App.cancelWorkReportEdit()">Cancel</button>`;
            }
            actionsHtml = `<div class="wr-modal-actions-left">${navBtns}</div>
                <div class="wr-modal-actions-center">${centerBtns}</div>
                <div class="wr-modal-actions-right">${printBtn}${closeBtn}</div>`;
        } else if (isHist) {
            const closeBtn = `<button class="btn" onclick="TVC_App.requestCloseWorkReport()">Close</button>`;
            const modifyTitle = escAttr(histModifyDisabledTitle(histEntry));
            const modifyBtn = `<button type="button" class="btn" onclick="TVC_App.modifyWorkReport()"${canModifyRow ? '' : ' disabled'}${modifyTitle ? ` title="${modifyTitle}"` : ''}>Modify</button>`;
            const deleteBtn = canDeleteRow
                ? `<button class="btn btn-red" onclick="TVC_App.deleteWorkReport()">Delete</button>`
                : '';
            const saveBtn = !ro && canModifyRow
                ? `<button type="button" class="btn btn-green" onclick="TVC_App.saveWorkReport()">Save</button>`
                : '';
            actionsHtml = `${navBtns}${modifyBtn}${deleteBtn}${saveBtn}${printBtn}${closeBtn}`;
        } else {
            const primaryBtn = !ro
                ? `<button class="btn btn-green" onclick="TVC_App.saveWorkReport()">Save</button>`
                : '';
            const closeBtn = `<button class="btn" onclick="TVC_App.requestCloseWorkReport()">${ro ? 'Close' : 'Cancel'}</button>`;
            actionsHtml = `${navBtns}${primaryBtn}${closeBtn}`;
        }
        const kindLabel = state._wrTab === 'postpone' ? 'Postponed Report' : 'Maintenance Report';
        const titleText = isHist
            ? kindLabel
            : (isNewUnsavedWorkReportSession() ? `${kindLabel} (Draft)` : (ro ? `${kindLabel} (View)` : kindLabel));

        host.innerHTML = `
            <div class="wr-titlebar">${titleText}</div>
            ${kindTabs}
            ${pageTabsBar}
            <div class="wr-page tone-${state._wrTab}">
                ${headHtml}
                ${body}
            </div>
            <div class="${actionsClass}">
                ${actionsHtml}
            </div>`;

        if (ro) {
            host.querySelectorAll('.wr-page input, .wr-page textarea, .wr-page select')
                .forEach(el => {
                    if (el.id === 'wrApprovedBy' || el.id === 'wrConfirmedBy'
                        || el.id === 'wrCompanyComment' || el.id === 'wrApprovedPostponeDate') return;
                    el.disabled = true;
                });
        }
        syncWorkReportPage2Ui(showPages, ro);
        TVC_PWA?.initDateInputFormat?.(host);
        restoreWorkReportModalScroll(scroll);
    }

    function isNewUnsavedWorkReportSession() {
        return !state._wrReportId && !state._wrReadonly;
    }

    async function requestCloseWorkReport() {
        if (isNewUnsavedWorkReportSession()) {
            const yes = await TVC_Dialog.confirm({
                kind: 'cancel',
                message: 'Cancel report editing?',
            });
            if (yes) {
                resetAndCloseWorkReport();
            }
            return;
        }
        closeWorkReport();
    }

    /** Work Report 창 닫기 — Confirmed/Approved 체크 시 Confirm·Approve 처리 후 닫기 */
    async function closeWorkReport() {
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const apCb = document.getElementById('wrApprovedBy');
        const cfCb = document.getElementById('wrConfirmedBy');
        const user = TVC_Auth.getCurrentUser();

        if (user && rep && TVC_RBAC.isReportedStatus(rep.status) && cfCb && !cfCb.disabled && cfCb.checked) {
            try {
                await TVC_Transaction.confirmReport(user, rep.id);
                resetAndCloseWorkReport();
                await refreshAll();
                const msg = rep.work_type === 'POSTPONE'
                    ? `${rep.job_code} postpone report confirmed. (NEXT DATE updated)`
                    : `${rep.job_code} report confirmed. (LAST DONE / NEXT DATE update)`;
                await TVC_Dialog.alert(msg);
            } catch (e) { await TVC_Dialog.alert(e.message || e.code); }
        }
        const canApproveFromUi = !!rep && apCb && !apCb.disabled && apCb.checked
            && TVC_RBAC.canApproveHqReport(user)
            && (TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked)
                || (TVC_RBAC.canHqDirectApprove(user, rep) && TVC_RBAC.isReportedStatus(rep.status)));
        if (user && canApproveFromUi) {
            try {
                await applyWrHqApprovalFromUi(user, rep);
                resetAndCloseWorkReport();
                await refreshAll();
                await TVC_Dialog.alert(`${rep.job_code} report approved by company.`);
            } catch (e) { await TVC_Dialog.alert(e.message || e.code); }
            return;
        }
        resetAndCloseWorkReport();
    }

    function resetAndCloseWorkReport() {
        cleanupOrphanPickMenus();
        closeFileNoPickPopover();
        TVC_SpareMenu.teardownWrSparePage2();
        TVC_SpareMenu.cleanupConsumeWorkReportOverlay();
        if (state._wrFromHistory) restorePlanBatchSelection();
        else clearPlanBatchSelection();
        state._wrReportId = null;
        state._wrBatchItemId = null;
        state._wrReadonly = false;
        state._wrPostSaveView = false;
        state._wrFromHistory = false;
        const wasOverWp = state._wrOverWorkProcedure;
        state._wrOverWorkProcedure = false;
        state._wrForm = {};
        state._wrUsedParts = [];
        state._wrJobItems = null;
        state._wrPage = '1';
        state._wrSpareSearch = '';
        const wrModal = document.getElementById('workReportModal');
        if (wrModal) wrModal.style.zIndex = '';
        clearModalOverWorkProcedure('workReportModal');
        closeModal('workReportModal');
        if (wasOverWp && state._wpJobId && isModalOpen('workProcedureModal')) {
            refreshWorkProcedureIfOpen();
        }
    }

    function refreshWorkProcedureIfOpen() {
        if (!state._wpJobId || !isModalOpen('workProcedureModal')) return;
        try { renderWorkProcedureModal(); } catch (_) { /* keep WP open */ }
    }

    function keepWorkReportEditorOpen() {
        document.getElementById('workReportModal')?.classList.remove('hidden');
        state._wrReadonly = false;
        state._wrPostSaveView = false;
    }

    async function saveWorkReport() {
        captureWorkReportForm();
        if (state._wrPage === '2') TVC_SpareMenu.persistWrSpareUsedParts();
        captureWorkReportUsedParts();
        if (!await TVC_SpareMenu.confirmIfCosExceedsRob?.('wr')) {
            keepWorkReportEditorOpen();
            return;
        }
        if (!TVC_SpareMenu.consumeStockForceOk?.()) {
            if (!await TVC_Dialog.confirm({ kind: 'save', message: 'Save this Work Report?' })) return;
        }
        captureWrJobItems();
        let job = state.idx.jobById.get(state._wrJobId);
        const codedItems = (state._wrJobItems || []).filter(i => String(i.job_code || '').trim());
        if (!job && codedItems.length) {
            const first = codedItems[0];
            job = resolveWrJobFromItem(first);
            if (job) state._wrJobId = job.id;
        }
        if (!job) return;
        const user = await TVC_Auth.requirePermission(TVC_RBAC.Action.CREATE_DAILY_REPORT);
        if (!user) return;
        const form = { ...state._wrForm };
        const tab = state._wrTab;
        const existingRep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;

        if (tab === 'postpone') {
            if (!form.postponeDate) {
                await TVC_Dialog.alert('Enter Postpone Date.');
                return;
            }
            const originalDueDate = TVC_WorkReport.postponeOriginalDueDate(existingRep, job);
            const check = TVC_WorkReport.postponeDateWithinMax(originalDueDate, form.postponeDate);
            if (!check.ok) {
                await TVC_Dialog.alert(TVC_WorkReport.postponeDateRangeMessage(check));
                return;
            }
        }

        const workType = tab === 'postpone' ? 'POSTPONE' : 'MAINTENANCE';
        const status = 'REPORTED';
        if (workType === 'MAINTENANCE' && form.workDate
            && (!form.lastMaintDate || form.lastMaintDate === (job.last_done || ''))) {
            form.lastMaintDate = form.workDate;
        }
        if (form.shoreTechnician) form.shoreSupport = true;
        if (form.shoreSupport) form.shoreTechnician = true;
        form.repairRequest = false;
        form.defectCleared = false;
        form.dockingRepair = false;
        form.allPendingCleared = false;
        form.pendingForRepair = !!form.shoreSupport;

        const description = form.outline || form.shipComments || existingRep?.description || job.job_detail;

        const payload = {
            workType, status, form,
            description,
            reportDate: form.reportDate,
            workDate: form.workDate,
            postponeDate: form.postponeDate || null,
            troubleDetail: null,
        };

        const usedParts = (state._wrUsedParts || [])
            .filter(p => Number(p.qty_used) > 0)
            .map(p => ({ spare_part_id: p.spare_part_id, qty_used: Number(p.qty_used) }));
        const wrPartsForConsumeLog = enrichUsedParts(usedParts);

        if (workType === 'MAINTENANCE') {
            payload.usedParts = usedParts;
        }

        try {
            let report;
            const multiJobSave = codedItems.length > 1;
            const buildWrSaveEntries = () => codedItems.map((item, idx) => {
                const j = (item.maintenance_job_id && state.idx.jobById.get(item.maintenance_job_id))
                    || state.jobs.find(x => x.job_code === item.job_code);
                if (!j) throw Object.assign(new Error(`Job not found: ${item.job_code || '?'}`), { code: 'NOT_FOUND' });
                const rowForm = { ...form };
                if (workType === 'MAINTENANCE' && rowForm.workDate
                    && (!rowForm.lastMaintDate || rowForm.lastMaintDate === (j.last_done || ''))) {
                    rowForm.lastMaintDate = rowForm.workDate;
                }
                return {
                    maintenance_job_id: j.id,
                    job_code: j.job_code,
                    form: rowForm,
                    description,
                    used_parts: (workType === 'MAINTENANCE' && idx === 0) ? usedParts : [],
                };
            });
            if (state._wrReportId) {
                const updatePayload = { ...payload };
                const rep = state.reports.find(r => r.id === state._wrReportId);
                if (rep) {
                    TVC_WorkReport.fromLegacy(rep);
                    if (multiJobSave) {
                        updatePayload.jobItems = buildWrSaveEntries().map((entry, idx) => {
                            const prev = (rep.job_items || []).find(it =>
                                it.maintenance_job_id === entry.maintenance_job_id
                                || it.job_code === entry.job_code
                            ) || {};
                            const j = state.idx.jobById.get(entry.maintenance_job_id);
                            return TVC_WorkReport.blankJobItem(j, {
                                status: prev.status || rep.status || status,
                                form: { ...(prev.form || {}), ...entry.form },
                                used_parts: entry.used_parts,
                                description: entry.description,
                                prev_job_state: prev.prev_job_state || null,
                            });
                        });
                        updatePayload.form = form;
                    } else if (rep.is_batch && (rep.job_items || []).length > 1) {
                        updatePayload.jobItems = rep.job_items.map((it, idx) => ({
                            ...it,
                            form: { ...(it.form || {}), ...form },
                            description,
                            used_parts: idx === 0 ? usedParts : (it.used_parts || []),
                        }));
                        updatePayload.form = form;
                    } else if (state._wrBatchItemId) {
                        const items = rep.job_items.map(it => {
                            if (it.maintenance_job_id !== state._wrBatchItemId) return it;
                            return {
                                ...it,
                                form: form,
                                used_parts: usedParts,
                                description,
                            };
                        });
                        updatePayload.jobItems = items;
                        updatePayload.form = form;
                    }
                }
                report = await TVC_Transaction.updateReport(user, state._wrReportId, updatePayload);
                TVC_JobMeta.addHistory(job.job_code, {
                    action: `${workType}_MODIFIED`, user: user.display_name,
                    notes: (description || '').slice(0, 100),
                });
            } else if (multiJobSave) {
                report = await TVC_Transaction.submitBatchReport(user, {
                    workType,
                    status,
                    reportDate: form.reportDate,
                    workDate: form.workDate,
                    postponeDate: form.postponeDate || null,
                    sharedForm: form,
                    items: buildWrSaveEntries(),
                    description,
                });
                TVC_JobMeta.addHistory(job.job_code, {
                    action: `${workType}_${status}`, user: user.display_name,
                    notes: (description || '').slice(0, 100),
                });
            } else {
                report = await TVC_Transaction.submitReport(user, job.id, payload);
                TVC_JobMeta.addHistory(job.job_code, {
                    action: `${workType}_${status}`, user: user.display_name,
                    notes: (description || '').slice(0, 100),
                });
            }

            if (workType === 'MAINTENANCE' || workType === 'POSTPONE') {
                try {
                    TVC_WorkReport.fromLegacy(report);
                    const partsForSync = report.is_batch
                        ? TVC_SpareMenu.aggregateUsedPartsFromWorkReport(report)
                        : usedParts;
                    const consumeForm = {
                        reportDate: form.reportDate || payload.reportDate,
                        workDate: form.workDate || payload.workDate,
                        shipComments: form.spareShipComments || form.shipComments || '',
                        fileNo: form.fileNo || '',
                        voyNo: form.voyNo || '',
                        place: form.place || '',
                    };
                    const syncResult = await TVC_SpareMenu.syncConsumeLogFromWorkReport({
                        report,
                        job,
                        usedParts: enrichUsedParts(partsForSync),
                        form: consumeForm,
                        user,
                        department: job.department || state.department || '',
                    });
                    const consumeLogId = syncResult?.logId ?? null;
                    const stockAppliedAt = syncResult?.stockAppliedAt || '';
                    if (report.consume_log_id !== consumeLogId
                        || (stockAppliedAt && report.stock_applied_at !== stockAppliedAt)) {
                        report.consume_log_id = consumeLogId || null;
                        if (stockAppliedAt) report.stock_applied_at = stockAppliedAt;
                        await TVC_DB.put('daily_work_reports', report);
                    }
                } catch (syncErr) {
                    if (syncErr.code === 'STOCK_CANCEL' || syncErr.code === 'STOCK') throw syncErr;
                    console.error('Consumed Log sync failed:', syncErr);
                    await TVC_Dialog.alert(syncErr.message || 'Spare parts stock update failed.');
                }
            }

            const wasModify = !!state._wrReportId;
            const fromHistory = state._wrFromHistory;
            clearPlanBatchSnapshot();
            await refreshAll();
            if (!wasModify && multiJobSave) {
                state.batchSelectedJobs = {};
                state.actualSelectedOnly = false;
                resetAndCloseWorkReport();
                await TVC_Dialog.alert(tab === 'postpone'
                    ? `Postpone report saved (${codedItems.length} jobs, ${status})`
                    : `Work Report saved (${codedItems.length} jobs, ${status})`);
                return;
            }
            if (state.currentTab === 'history' && !fromHistory) {
                switchTab('actual');
            }
            const saved = state.reports.find(r => r.id === report.id) || report;
            let finalRep = saved;
            try {
                finalRep = await applyWrHqApprovalFromUi(user, saved) || saved;
            } catch (approveErr) {
                await TVC_Dialog.alert(approveErr.message || approveErr.code || 'Approve failed');
            }
            state._wrJobItems = null;
            if (fromHistory) reloadWorkReportViewFromDb(finalRep, job);
            else reloadWorkReportStateFromSaved(finalRep, job);
            if (reportIsApproved(finalRep)) state._wrReadonly = true;
            renderWorkReportModal();
            await TVC_Dialog.alert(wasModify
                ? (reportIsApproved(finalRep)
                    ? `${WR_TABS[tab]} report saved and approved.`
                    : `${WR_TABS[tab]} report updated.`)
                : tab === 'postpone'
                    ? `${WR_TABS[tab]} report saved. (NEXT DATE → ${form.postponeDate})`
                    : `${WR_TABS[tab]} report saved. (${status})`);
        } catch (e) {
            if (e.code === 'STOCK_CANCEL' || e.code === 'STOCK') {
                keepWorkReportEditorOpen();
                return;
            }
            await TVC_Dialog.alert(e.message || e.code);
        }
    }

    function openJobDetail(jobId) {
        state.selectedJobId = jobId;
        const job = state.idx.jobById.get(jobId);
        if (!job) return;
        if (state.vlActual) state.vlActual.refresh();
        renderSidePanel();
        showModal('jobDetailModal');
        const meta = TVC_JobMeta.get(job.job_code);
        document.getElementById('jobDetailBody').innerHTML = `
            <h3>${esc(job.job_code)}</h3>
            <p><strong>SORT-1:</strong> ${esc(job.item_sort1 || '—')}<br>
               <strong>SORT-2:</strong> ${esc(job.item_sort2 || '—')}<br>
               <strong>JOB DETAIL:</strong> ${esc(job.job_detail || '—')}</p>
            <dl class="detail-dl">
                <dt>GROUP</dt><dd>${esc(job.group || '—')}</dd>
                <dt>DEPT</dt><dd>${esc(job.department || '—')}</dd>
                <dt>PERIOD</dt><dd>${job.period} ${esc(job.unit)}</dd>
                <dt>NEXT DATE</dt><dd>${esc(job.next_date || '—')}</dd>
                <dt>LAST DONE</dt><dd>${esc(job.last_done || '—')}</dd>
                <dt>P.I.C</dt><dd>${esc(job.pic || '—')}</dd>
            </dl>
            <label><strong>Report / Detail Input</strong></label>
            <textarea id="detailReportInput" rows="4" style="width:100%">${esc(meta.last_report || '')}</textarea>
            <label><strong>첨부파일</strong></label>
            <input type="file" id="detailFileInput" multiple onchange="TVC_App.uploadAttachment('${escAttr(job.job_code)}')">
            <ul id="attachmentList">${meta.attachments.map(a => `<li>📎 ${esc(a.name)} (${Math.round(a.size / 1024)}KB)</li>`).join('') || '<li class="muted">None</li>'}</ul>
            <div class="modal-actions">${buildActionButtons(job)}</div>`;
    }

    function canAccessJobDepartment(jobDept) {
        if (!state.user) return false;
        if (typeof TVC_Space !== 'undefined' && state.user.station) {
            return TVC_Space.canAccessDepartment(state.user, jobDept);
        }
        return TVC_RBAC.canAccessDepartment(state.user, jobDept);
    }

    function buildActionButtons(job) {
        const f = TVC_RBAC.getUiFeatures(state.user);
        const canJob = canAccessJobDepartment(job.department);
        let h = '';
        const canAp = TVC_RBAC.canApproveDepartment(state.user, job.department);
        if (f.showDailyReportSubmit && canJob) h += `<button class="btn btn-green" onclick="TVC_App.doSubmit('${job.id}')">📋 Report (REPORTED)</button>`;
        if (f.showMaintenanceExecute && canJob && canAp) h += `<button class="btn btn-green" onclick="TVC_App.doExecute('${job.id}')">🛠️ Approve & Deduct</button>`;
        if (f.showMaintenanceExecute && canJob && !canAp) h += `<button class="btn btn-green" disabled title="타 부서 — 승인 불가">🛠️ Approve & Deduct</button>`;
        h += `<button class="btn" onclick="TVC_App.saveDetailReport('${job.id}')">💾 Save Detail</button>`;
        h += `<button class="btn" onclick="TVC_App.openProcedureHistory('${job.id}')">📜 Procedure / History</button>`;
        if (!canJob) h += `<span class="dept-warn">타 부서 항목 — 조작 불가</span>`;
        return h;
    }

    async function uploadAttachment(jobCode) {
        const input = document.getElementById('detailFileInput');
        if (!input?.files?.length) return;
        for (const f of input.files) await TVC_JobMeta.addAttachment(jobCode, f);
        const job = [...state.idx.jobById.values()].find(j => j.job_code === jobCode);
        if (job) openJobDetail(job.id);
    }

    async function saveDetailReport(jobId) {
        const job = state.idx.jobById.get(jobId);
        const text = document.getElementById('detailReportInput')?.value || '';
        const all = JSON.parse(localStorage.getItem('tvc_job_meta') || '{}');
        if (!all[job.job_code]) all[job.job_code] = TVC_JobMeta.get(job.job_code);
        all[job.job_code].last_report = text;
        localStorage.setItem('tvc_job_meta', JSON.stringify(all));
        TVC_JobMeta.addHistory(job.job_code, { action: 'DETAIL_SAVED', user: state.user.display_name, notes: text.slice(0, 100) });
        await TVC_Dialog.alert('Saved');
    }

    function openProcedureHistory(jobId) {
        const job = state.idx.jobById.get(jobId);
        if (!job) return;
        const meta = TVC_JobMeta.getHistoryForJob(job.job_code);
        const reportHist = (state.idx.reportsByJobCode.get(job.job_code) || []).map(r =>
            `[${r.report_date}] ${r.status} — ${r.description || ''} (${r.reporter_name || ''})`);
        document.getElementById('procedureHistoryBody').innerHTML = `
            <h3>${esc(job.job_code)} — Work Procedure & History</h3>
            <h4>Work Procedure</h4>
            <div class="proc-box">${esc(meta.procedure || job.job_detail || 'No procedure registered.')}</div>
            <h4>Work History (Reports)</h4>
            <ul>${reportHist.length ? reportHist.map(h => `<li>${esc(h)}</li>`).join('') : '<li class="muted">No report history</li>'}</ul>
            <h4>Local History Log</h4>
            <ul>${meta.history.length ? meta.history.map(h => `<li>[${esc(h.date)}] ${esc(h.action)}: ${esc(h.notes || '')}</li>`).join('') : '<li class="muted">None</li>'}</ul>`;
        showModal('procedureHistoryModal');
    }

    function openProcedureHistoryByCode(jobCode) {
        const job = [...state.idx.jobById.values()].find(j => j.job_code === jobCode);
        if (job) openProcedureHistory(job.id);
    }

    // ── Workflow actions ─────────────────────────────────────────────
    async function doSubmit(jobId) {
        const user = await TVC_Auth.requirePermission(TVC_RBAC.Action.CREATE_DAILY_REPORT);
        if (!user) return;
        const job = state.idx.jobById.get(jobId);
        if (job.department && !canReportJobDepartment(user, job.department)) {
            await TVC_Dialog.alert('Other department items cannot be reported.');
            return;
        }
        const usedParts = await pickUsedParts();
        if (usedParts === null) return;
        try {
            await TVC_Transaction.submitReport(user, jobId, { description: job.job_detail, usedParts });
            TVC_JobMeta.addHistory(job.job_code, { action: 'REPORTED', user: user.display_name, notes: '' });
            closeModal('jobDetailModal');
            await refreshAll();
            await TVC_Dialog.alert('REPORTED submitted');
        } catch (e) { await TVC_Dialog.alert(e.message || e.code); }
    }

    async function doExecute(jobId) {
        const user = await TVC_Auth.requirePermission(TVC_RBAC.Action.EXECUTE_MAINTENANCE);
        if (!user) return;
        const job = state.idx.jobById.get(jobId);
        if (!TVC_RBAC.canApproveDepartment(user, job.department)) await TVC_Dialog.alert('Other department items cannot be approved.');
        const usedParts = await pickUsedParts();
        if (usedParts === null) return;
        try {
            await TVC_Transaction.executeMaintenance(user, jobId, usedParts, job.job_detail);
            TVC_JobMeta.addHistory(job.job_code, { action: 'CONFIRMED', user: user.display_name, notes: 'Stock deducted' });
            closeModal('jobDetailModal');
            await refreshAll();
            await TVC_Dialog.alert('Confirmed & stock deducted');
        } catch (e) { await TVC_Dialog.alert(e.message || e.code); }
    }

    async function pickUsedParts() {
        if (!state.spares.length) return [];
        const spare = state.spares[0];
        const qty = parseInt(prompt(`Part: ${spare.name}\nQty (0=none):`, '0') || '0', 10);
        if (isNaN(qty)) return null;
        return qty <= 0 ? [] : [{ spare_part_id: spare.id, qty_used: qty }];
    }

    async function doConfirm(reportId) {
        const user = await TVC_Auth.requirePermission(TVC_RBAC.Action.APPROVE_DAILY_REPORT);
        if (!user) return;
        const rep = state.reports.find(r => r.id === reportId);
        const dept = rep ? reportDept(rep) : null;
        if (!TVC_RBAC.canConfirmDepartment(user, dept)) {
            await TVC_Dialog.alert(`Other department (${dept || '?'}) reports cannot be confirmed. Scope: ${TVC_RBAC.getDeptLabel(user.department)}`);
            return;
        }
        try { await TVC_Transaction.confirmReport(user, reportId); await refreshAll(); await TVC_Dialog.alert('Confirmed'); }
        catch (e) { await TVC_Dialog.alert(e.message || e.code); }
    }

    async function doApprove(reportId) {
        const user = await TVC_Auth.requirePermission(TVC_RBAC.Action.CONFIRM_REPORT);
        if (!user) return;
        const comment = document.getElementById('comment-' + reportId)?.value || '';
        try { await TVC_Transaction.approveReport(user, reportId, comment); await refreshAll(); await TVC_Dialog.alert('APPROVED'); }
        catch (e) { await TVC_Dialog.alert(e.message || e.code); }
    }

    async function refreshAll() {
        await loadData();
        rerenderCurrentTab();
        refreshWorkProcedureIfOpen();
        TVC_RunHours.syncRhToolbarUi();
        syncPlanUpdateUi();
    }

    async function refreshAfterImport(payload) {
        const importVesselId = payload?.export_meta?.vessel_id;
        const user = state.user;
        if (user && TVC_RBAC.isHqAccount(user) && importVesselId) {
            state.selectedVesselId = importVesselId;
            TVC_Fleet.select(importVesselId);
            TVC_PMS.setSpace('HQ', importVesselId);
            await populateShipHeader(user);
        }
        await refreshAll();
        if (state.currentTab === 'menu') renderSyncHistory();
    }

    function jobActualStatusText(j) {
        const kind = jobActualStatusKind(j);
        if (kind === 'postponed') return 'P POSTPONED';
        if (kind === 'overdue') return '! OVERDUE';
        if (kind === 'due') return '◷ DUE';
        return 'OK';
    }

    // ── Print ────────────────────────────────────────────────────────
    function printTableStyles() {
        return `body{font-family:system-ui,sans-serif;font-size:11px;margin:16px;color:#1a202c}
            h1{font-size:18px;color:#1a365d;margin:0 0 4px}
            .meta{color:#4a5568;margin:0 0 12px;font-size:11px}
            table{width:100%;border-collapse:collapse}
            th,td{border:1px solid #cbd5e0;padding:5px 7px;text-align:left;vertical-align:top}
            th{background:#1a365d;color:#fff;font-weight:600}
            tr:nth-child(even){background:#f7fafc}
            @media print{body{margin:10mm}}`;
    }

    function printListMeta(title) {
        const ship = document.getElementById('cmaxsShipName')?.textContent?.trim() || '—';
        const dept = TVC_RBAC.getDeptLabel(state.department);
        return `<h1>${esc(title)}</h1><p class="meta">${esc(ship)} · ${esc(dept)} · ${new Date().toLocaleString()}</p>`;
    }

    function printFilterNote(parts) {
        const notes = parts.filter(Boolean);
        return notes.length ? `<p class="meta">${notes.map(n => esc(n)).join(' · ')}</p>` : '';
    }

    function printFlagCells(flags) {
        return ['repairRequest', 'shoreSupport', 'defectCleared', 'shipComment', 'companyComment']
            .map(k => `<td>${flags[k] ? '☑' : '—'}</td>`).join('');
    }

    function printHistFlagCells(flags) {
        return ['repairRequest', 'shoreSupport', 'defectCleared']
            .map(k => `<td>${flags[k] ? '☑' : '—'}</td>`).join('');
    }

    function printAttachmentLabel(attachments) {
        const list = Array.isArray(attachments) ? attachments : [];
        return list.length ? `Yes (${list.length})` : '—';
    }

    function printDefectRowCells(dc, opts = {}) {
        const cols = defectHistoryColumns(dc);
        const dt = formatCmaxsHistDate(listReportedDateStr(dc));
        const st = defectHistoryStatusLabel(dc);
        const flags = defectHistoryFormFlags(dc);
        const detailCell = opts.omitDetail
            ? ''
            : `<td>${esc(cols.jobDetail || '')}</td>`;
        const fileNoCell = opts.includeFileNo
            ? `<td>${esc(String(dc.file_no || '').trim() || '—')}</td>`
            : '';
        const flagCells = opts.historyList ? printHistFlagCells(flags) : printFlagCells(flags);
        const spareCell = opts.historyList
            ? `<td>${histEntrySpareDataCount({ source: 'defect', defect: dc })}</td>`
            : '';
        return `${fileNoCell}<td>${esc(cols.jobCode || '—')}</td>
            <td>${esc(cols.sort1 || '')}</td>
            <td>${esc(cols.sort2 || '')}</td>
            ${detailCell}
            <td>${esc(dt || '—')}</td>
            <td>${esc(st)}</td>
            ${flagCells}
            <td>${esc(printAttachmentLabel(dc.ship_attachments))}</td>
            <td>${esc(printAttachmentLabel(dc.company_attachments))}</td>${spareCell}`;
    }

    const PRINT_DEFECT_HIST_HEAD = `<tr>
            <th>JOB CODE</th><th>SORT-1</th><th>SORT-2</th><th>JOB DETAIL</th>
            <th>Reported Date</th><th>Status</th>
            <th>RR</th><th>SS</th><th>DC</th><th>SC</th><th>CC</th>
            <th>Ship's AT</th><th>Company's AT</th>
        </tr>`;

    const PRINT_DEFECT_LIST_HEAD = `<tr>
            <th>File No</th><th>JOB CODE</th><th>SORT-1</th><th>SORT-2</th>
            <th>Reported Date</th><th>Status</th>
            <th>RR</th><th>SS</th><th>DC</th><th>SC</th><th>CC</th>
            <th>Ship's AT</th><th>Company's AT</th>
        </tr>`;

    const PRINT_WORK_HIST_HEAD = `<tr>
            <th>Type</th><th>File No</th><th>⚠</th><th>JOB CODE</th><th>SORT-1</th><th>SORT-2</th>
            <th>Reported Date</th><th>Status</th>
            <th>RR</th><th>SS</th><th>DC</th>
            <th>Ship's AT</th><th>Company's AT</th>
            <th>Spare Data</th>
        </tr>`;

    function buildWorkPlanPrintBody() {
        const ids = sheetIds('actual');
        const jobs = ids.map(id => state.idx.jobById.get(id)).filter(Boolean);
        const filterParts = [];
        if (state.search) filterParts.push(`Search: "${state.search}"`);
        if (hasActualPeriodFilter()) {
            filterParts.push(`Period: ${state.actualPeriodFrom || '…'} ~ ${state.actualPeriodTo || '…'}`);
        }
        if (state.selectedGroupKey) filterParts.push('Group filter applied');
        if (state.actualFilter === 'critical') filterParts.push('Filter: Critical Equipment');
        else if (state.actualFilter === 'overdue') filterParts.push('Filter: ! Overdue');
        else if (state.actualFilter === 'due30') filterParts.push('Filter: ◷ Due (30d)');
        else if (state.actualFilter === 'postponed') filterParts.push('Filter: P Postponed');
        filterParts.push(...(TVC_ListFilters?.describeFilters('actual', state) || []));
        const rows = jobs.map(j => `<tr>
            <td>${esc(j.job_code)}</td>
            <td>${esc(j.item_sort1 || '')}</td>
            <td>${esc(j.item_sort2 || '')}</td>
            <td>${esc(j.job_detail || '')}</td>
            <td>${esc(`${j.period ?? '—'} ${j.unit || ''}`.trim())}</td>
            <td>${esc(j.pic || '')}</td>
            <td>${esc(j.next_date || '—')}</td>
            <td>${esc(j.last_done || '—')}</td>
            <td>${esc(jobActualStatusText(j))}</td>
        </tr>`).join('');
        return `${printListMeta('PMS')}
            ${printFilterNote(filterParts)}
            <p class="meta">${jobs.length} job(s)</p>
            <table><tr>
                <th>JOB CODE</th><th>SORT-1</th><th>SORT-2</th><th>JOB DETAIL</th>
                <th>PERIOD</th><th>P.I.C</th><th>NEXT DATE</th><th>LAST DONE</th><th>STATUS</th>
            </tr>${rows || `<tr><td colspan="9">No jobs to print.</td></tr>`}</table>`;
    }

    function buildDefectReportPrintBody() {
        const rows = TVC_DefectReport.defectListRows();
        const filterParts = [];
        const search = document.getElementById('dfListSearch')?.value?.trim();
        if (search) filterParts.push(`Search: "${search}"`);
        if (hasReportPeriodFilter()) {
            filterParts.push(`Period: ${state.reportPeriodFrom || '…'} ~ ${state.reportPeriodTo || '…'}`);
        }
        filterParts.push(...(TVC_ListFilters?.describeFilters('defect', state) || []));
        const bodyRows = rows.map(dc => `<tr>${printDefectRowCells(dc, { omitDetail: true, includeFileNo: true })}</tr>`).join('');
        return `${printListMeta('Defect Report')}
            ${printFilterNote(filterParts)}
            <p class="meta">${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}</p>
            <table>${PRINT_DEFECT_LIST_HEAD}${bodyRows || `<tr><td colspan="13">No defect reports to print.</td></tr>`}</table>`;
    }

    function buildWorkHistoryPrintBody() {
        const entries = workHistoryEntries();
        const filterParts = [];
        if (state.search) filterParts.push(`Search: "${state.search}"`);
        if (hasReportPeriodFilter()) {
            filterParts.push(`Period: ${state.reportPeriodFrom || '…'} ~ ${state.reportPeriodTo || '…'}`);
        }
        filterParts.push(...(TVC_ListFilters?.describeFilters('history', state) || []));
        const bodyRows = entries.map(entry => {
            if (isHistPermitEntry(entry)) {
                const row = entry.permit;
                const cols = workPermitHistoryColumns(row || {});
                const job = histPrimaryJob(entry);
                const fileNo = String(row?.file_no || '').trim() || '—';
                const dt = formatCmaxsHistDate(listReportedDateStr(row));
                const st = TVC_WorkPermit.listWorkflowStatus(row);
                return `<tr>
                <td>W</td>
                <td>${esc(fileNo)}</td>
                <td>${esc(printHistCriticalMark(entry))}</td>
                <td>${esc(cols.jobCode || '—')}</td>
                <td>${esc(cols.sort1 || job?.item_sort1 || '')}</td>
                <td>${esc(cols.sort2 || job?.item_sort2 || '')}</td>
                <td>${esc(dt || '—')}</td>
                <td>${esc(st)}</td>
                <td></td><td></td><td></td>
                <td></td><td></td>
                <td>${histEntrySpareDataCount(entry)}</td>
            </tr>`;
            }
            if (isHistConsumeEntry(entry)) {
                const f = consumeHistoryFields(entry.consume);
                return `<tr>
                <td>C</td>
                <td>${esc(f.fileNo || '—')}</td>
                <td></td>
                <td>${esc(f.jobCode || '—')}</td>
                <td>${esc(f.sort1 || '')}</td>
                <td>${esc(f.sort2 || '')}</td>
                <td>${esc(formatCmaxsHistDate(f.date) || '—')}</td>
                <td>${esc(f.status || '—')}</td>
                <td></td><td></td><td></td>
                <td></td><td></td>
                <td>${esc(String(f.spareData ?? 0))}</td>
            </tr>`;
            }
            if (isHistDefectEntry(entry)) {
                const fileNo = String(entry.defect.file_no || '').trim() || '—';
                return `<tr><td>D</td><td>${esc(fileNo)}</td><td>${esc(printHistCriticalMark(entry))}</td>${printDefectRowCells(entry.defect, { omitDetail: true, historyList: true })}</tr>`;
            }
            const { report: r, item } = entry;
            const job = histPrimaryJob(entry);
            const f = item.form || wrReportForm(r);
            const dt = formatCmaxsHistDate(listReportedDateStr(r));
            const st = reportWorkflowStatusLabel(r, entry.isBatchSummary ? null : item);
            const flags = workHistoryFormFlags(f, r);
            const type = histTypeMarker(entry).letter;
            const batch = r.is_batch ? 'B ' : '';
            const fileNo = String(f.fileNo || '').trim() || '—';
            return `<tr>
                <td>${esc(type)}</td>
                <td>${esc(fileNo)}</td>
                <td>${esc(printHistCriticalMark(entry))}</td>
                <td>${esc(batch + (histDisplayJobCode(entry) || '—'))}</td>
                <td>${esc(job?.item_sort1 || '')}</td>
                <td>${esc(job?.item_sort2 || '')}</td>
                <td>${esc(dt || '—')}</td>
                <td>${esc(st)}</td>
                ${printHistFlagCells(flags)}
                <td>${esc(printAttachmentLabel(f.shipAttachments))}</td>
                <td>${esc(printAttachmentLabel(f.companyAttachments))}</td>
                <td>${histEntrySpareDataCount(entry)}</td>
            </tr>`;
        }).join('');
        return `${printListMeta('Report History')}
            ${printFilterNote(filterParts)}
            <p class="meta">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</p>
            <table>${PRINT_WORK_HIST_HEAD}${bodyRows || `<tr><td colspan="14">No history entries to print.</td></tr>`}</table>`;
    }

    function openListPrintWindow(title, bodyHtml, preview) {
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TVC — ${esc(title)}</title>
            <style>${printTableStyles()}</style></head><body>${bodyHtml}</body></html>`;
        const features = 'width=980,height=760,menubar=no,toolbar=no,location=no,status=no';
        const w = window.open('', '_blank', features);
        if (!w) {
            void TVC_Dialog.alert('Pop-up blocked. Allow pop-ups to print or preview.');
            return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
        if (!preview) setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
    }

    function printTabList(tab, preview) {
        let title;
        let body;
        if (tab === 'actual') {
            title = 'PMS';
            body = buildWorkPlanPrintBody();
        } else if (tab === 'history') {
            if (state.historyScope === 'spare') {
                title = 'Requisition List';
                if (typeof TVC_SpareMenu?.buildRequisitionListPrintBody !== 'function') {
                    void TVC_Dialog.alert('Requisition List is not ready to print.');
                    return;
                }
                void Promise.resolve(TVC_SpareMenu.buildRequisitionListPrintBody()).then(html => {
                    if (!html) {
                        void TVC_Dialog.alert('Requisition List is not ready to print.');
                        return;
                    }
                    openListPrintWindow(title, html, preview);
                }).catch(err => {
                    void TVC_Dialog.alert(err?.message || 'Failed to print Requisition List.');
                });
                return;
            } else {
                title = 'Report History';
                body = buildWorkHistoryPrintBody();
            }
        } else if (tab === 'spare') {
            title = 'SPARE Parts List';
            body = typeof TVC_SpareMenu !== 'undefined' && TVC_SpareMenu.buildPrintBody
                ? TVC_SpareMenu.buildPrintBody()
                : '';
            if (!body) {
                void TVC_Dialog.alert('SPARE list is not ready to print.');
                return;
            }
        } else {
            void TVC_Dialog.alert('Print is not available on this tab.');
            return;
        }
        openListPrintWindow(title, body, preview);
    }

    function printCurrentTab(preview) {
        printTabList(state.currentTab, preview);
    }

    // ── Auth / sync handlers ─────────────────────────────────────────
    async function handleLogin() {
        const errEl = document.getElementById('loginErr');
        if (loginBusy) return;
        try {
            if (!bootReady) {
                setLoginBusy(true, 'Preparing system…');
                await bootReadyPromise;
                setLoginBusy(false);
            }
            setLoginBusy(true, 'Signing in…');
            if (errEl) errEl.textContent = '';
            await TVC_DB.open();
            const loginMode = document.getElementById('loginDept')?.value || '';
        const r = await TVC_Auth.login(
            document.getElementById('loginUser').value,
            document.getElementById('loginPass').value,
                loginMode
            );
            if (errEl) errEl.textContent = r.ok ? '' : (r.error || 'Sign in failed');
            if (r.ok) {
                const refreshed = await TVC_Auth.refreshSessionFromDb();
                await onLogin(refreshed || r.user);
            }
        } catch (e) {
            console.error('[TVC] login failed', e);
            if (errEl) errEl.textContent = formatLoginError(e);
        } finally {
            setLoginBusy(false);
        }
    }

    function handleLogout() {
        TVC_Auth.logout();
        state.user = null;
        setLoginBusy(false);
        showLogin();
    }

    async function handleStationExport() {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        try {
            await TVC_StationSync.exportStationPackage(user);
            await refreshAll();
            if (state.currentTab === 'menu') renderSyncHistory();
            await TVC_Dialog.alert(`${TVC_Space.stationLabel(user.station)} data was exported as a Captain Hub package.`);
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function handleCompanyExport() {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        try {
            await TVC_StationSync.exportCompanyPackage(user);
            await refreshAll();
            if (state.currentTab === 'menu') renderSyncHistory();
            await TVC_Dialog.alert('Company report data package created.');
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function handleHubImport(file, dept) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        if (typeof TVC_Space !== 'undefined' && !TVC_Space.isCaptainHub(user)) {
            await TVC_Dialog.alert(
                'Station merge import requires Vessel Mode — Master (captain account). ' +
                'Sign out and log in with Department = Master.'
            );
            return;
        }
        try {
            let importDept = dept || state._pendingImportDept || null;
            if (!importDept) {
                importDept = await pickImportDepartment();
                if (!importDept) return;
            }
            state._pendingImportDept = null;
            await TVC_StationSync.importStationPackage(user, file, importDept);
            await refreshAll();
            if (state.currentTab === 'menu') { renderSyncHistory(); renderCaptainViewDashboard(); }
            await TVC_Dialog.alert('Station data merge complete.');
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function handleDefectImport(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        try {
            if (TVC_RBAC.isHqAccount(user)
                || (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user))) {
                const dept = await pickImportDepartment();
                if (!dept) return;
            }
            const payload = await TVC_DefectSync.importPackage(user, file);
            await refreshAfterImport(payload);
            if (state.currentTab === 'menu') TVC_DefectReport.renderInbox();
            await TVC_Dialog.alert('Defect package imported successfully.');
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function handlePostponeImport(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        try {
            if (TVC_RBAC.isHqAccount(user)
                || (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user))) {
                const dept = await pickImportDepartment();
                if (!dept) return;
            }
            const payload = await TVC_PostponeSync.importPackage(user, file);
            await refreshAfterImport(payload);
            await TVC_Dialog.alert('Postpone package imported successfully.');
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function handleWorkPermitImport(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        try {
            if (TVC_RBAC.isHqAccount(user)
                || (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user))) {
                const dept = await pickImportDepartment();
                if (!dept) return;
            }
            const payload = await TVC_WorkPermitSync.importPackage(user, file);
            await refreshAfterImport(payload);
            await TVC_Dialog.alert('Work Permit package imported successfully.');
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function urgentExportDefect(caseId) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !caseId) return;
        try {
            const { filename } = await TVC_DefectSync.exportUrgentZip(user, caseId);
            await refreshAll();
            if (state.currentTab === 'menu') {
                renderSyncHistory();
                TVC_DefectReport.renderInbox();
            }
            if (state.currentTab === 'history') renderWorkHistory();
            await TVC_Dialog.alert(`Defect package created:\n${filename}\n\nAttach ZIP to email or import at HQ.`);
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function exportDefectCompletion(caseId) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !caseId) return;
        try {
            const { filename } = await TVC_DefectSync.exportCompletionZip(user, caseId);
            await refreshAll();
            if (state.currentTab === 'menu') {
                renderSyncHistory();
                TVC_DefectReport.renderInbox();
            }
            if (state.currentTab === 'history') renderWorkHistory();
            await TVC_Dialog.alert(`Completion package created:\n${filename}`);
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function handleExport() {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        if (typeof TVC_Space !== 'undefined' && user.station && !TVC_Space.canStationDataXfer(user)) {
            await TVC_Dialog.alert('Data Export & Import requires Chief Officer (co), Chief Engineer (ce), or Captain.');
            return;
        }
        if (!TVC_RBAC.can(user, TVC_RBAC.isHqAccount(user) ? TVC_RBAC.Action.EXPORT_HQ_FEEDBACK : TVC_RBAC.Action.EXPORT_SHIP_SYNC)) {
            await TVC_Dialog.alert('Data Export & Import requires Chief Officer (co), Chief Engineer (ce), or Captain.');
            return;
        }
        pickDepartmentThen('Select a department to export (DECK / ENGINE)', async (dept) => {
            try {
                const direction = (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user))
                    ? TVC_Space.Direction.STATION_TO_HUB
                    : (TVC_RBAC.isHqAccount(user) ? 'HQ_TO_SHIP' : 'SHIP_TO_HQ');
                const opts = direction === TVC_Space.Direction.STATION_TO_HUB
                    ? { station_id: TVC_Space.getStation(user), monthlyExport: monthlyExportUsesSnapshot(user, dept) }
                    : { monthlyExport: true };
                await TVC_Sync.exportZip(user, direction, dept, opts);
                await refreshAll();
                if (state.currentTab === 'menu') renderSyncHistory();
                const vesselId = (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || user.vessel_id || 'VESSEL_ID';
                await TVC_Dialog.alert(`${TVC_RBAC.getDeptLabel(dept)} data ZIP exported (${vesselId}_${dept}_PMS_EXPORT_…zip).`);
            } catch (e) { await TVC_Dialog.alert(e.message); }
        });
    }

    async function handleImport(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        const importAction = TVC_RBAC.isHqAccount(user) ? TVC_RBAC.Action.IMPORT_HQ_SYNC : TVC_RBAC.Action.IMPORT_SHIP_SYNC;
        if (!TVC_RBAC.can(user, importAction)) {
            await TVC_Dialog.alert('No permission for Data Import.');
            return;
        }
        const xferUser = typeof TVC_Space !== 'undefined' ? { ...user, station: TVC_Space.getStation(user) } : user;
        if (typeof TVC_Space !== 'undefined' && xferUser.station && !TVC_Space.canStationDataXfer(xferUser)) {
            await TVC_Dialog.alert('Data Export & Import requires Chief Officer (co), Chief Engineer (ce), or Captain.');
            return;
        }
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.zip') && typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(xferUser)) {
            try {
                const zip = await JSZip.loadAsync(await file.arrayBuffer());
                const jsonFile = zip.file('tvc_sync.json');
                if (jsonFile) {
                    const peek = JSON.parse(await jsonFile.async('string'));
                    if (peek.export_meta?.direction === 'STATION_TO_HUB') {
                        await handleHubImport(file);
                        return;
                    }
                }
            } catch (_) { /* fall through to standard import */ }
        }
        const dept = state._pendingImportDept || user.department
            || (accountNeedsDeptPick(user) ? await pickImportDepartment() : null);
        if (accountNeedsDeptPick(user) && !dept) return;
        state._pendingImportDept = null;
        try {
            const payload = await TVC_Sync.importZip(user, file, dept, {
                expectedVesselId: TVC_RBAC.isHqAccount(user) ? state.selectedVesselId : undefined,
            });
            if (!TVC_RBAC.isHqAccount(user) && payload?.export_meta?.direction === 'HQ_TO_SHIP') {
                await unlockOriginalPlanForDept(dept);
            }
            await refreshAfterImport(payload);
            const unlockNote = (!TVC_RBAC.isHqAccount(user) && payload?.export_meta?.direction === 'HQ_TO_SHIP')
                ? `\nOriginal Plan Update is enabled again.`
                : '';
            const vesselNote = (TVC_RBAC.isHqAccount(user) && payload?.export_meta?.vessel_id)
                ? `\nVessel: ${TVC_Fleet.resolveById(payload.export_meta.vessel_id)?.name || payload.export_meta.vessel_id}`
                : '';
            await TVC_Dialog.alert(`${TVC_RBAC.getDeptLabel(dept)} data import complete${vesselNote}${unlockNote}`);
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function loadSeedFile(file) {
        if (!file) return;
        await TVC_Seed.loadFromFile(file);
        document.getElementById('seedBanner')?.classList.add('hidden');
        await refreshAll();
        await TVC_Dialog.alert(`Loaded ${state.jobs.length} jobs`);
    }

    // ── Database Backup & Restore (Menu PMS · SPARE Master Data) ─────
    let _masterBackupScope = 'pms';

    function masterBackupOpts() {
        return {
            selectedVesselId: state.selectedVesselId || null,
            vesselId: TVC_RBAC.isHqAccount(state.user) ? (state.selectedVesselId || null) : null,
            department: state.department || state.user?.department || null,
        };
    }

    function formatMasterBackupWhen(iso) {
        const raw = String(iso || '').trim();
        if (!raw) return '—';
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return raw;
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function masterBackupSubject() {
        return _masterBackupScope === 'spare'
            ? 'SPARE Master Data (Spare Parts · Catalog)'
            : 'Menu (PMS) Master Data (Jobs · Groups · Equipment · BOM · Running Hours · Work Reports · Defect Cases)';
    }

    async function paintMasterBackupCopy() {
        const title = document.getElementById('masterBackupTitle');
        const hint = document.getElementById('masterBackupHint');
        const note = document.getElementById('masterBackupNote');
        if (title) title.textContent = 'Database Backup & Restore';
        if (hint) hint.textContent = `Back up or restore ${masterBackupSubject()}.`;
        if (!note) return;
        let backupAt = '';
        let restoreAt = '';
        if (typeof TVC_MasterBackup?.getLastEvents === 'function') {
            try {
                const last = await TVC_MasterBackup.getLastEvents(_masterBackupScope);
                backupAt = last?.backupAt || '';
                restoreAt = last?.restoreAt || '';
            } catch (_) { /* meta store may be unavailable */ }
        }
        note.innerHTML = `Last Backup: <strong>${esc(formatMasterBackupWhen(backupAt))}</strong><br>`
            + `Last Restore: <strong>${esc(formatMasterBackupWhen(restoreAt))}</strong>`;
    }

    async function openMasterBackupModal(scope = 'pms') {
        if (!state.user) return;
        if (typeof TVC_MasterBackup === 'undefined') {
            await TVC_Dialog.alert('Backup module is not available.');
            return;
        }
        _masterBackupScope = scope === 'spare' ? 'spare' : 'pms';
        await paintMasterBackupCopy();
        showModal('masterBackupModal');
    }

    function closeMasterBackupModal() {
        closeModal('masterBackupModal');
    }

    async function runMasterBackup() {
        const user = state.user || TVC_Auth.getCurrentUser();
        if (!user) return;
        if (typeof TVC_MasterBackup === 'undefined') {
            await TVC_Dialog.alert('Backup module is not available.');
            return;
        }
        const proceed = await TVC_Dialog.confirm({
            kind: 'cancel',
            title: 'Database Backup',
            message: `Backup ${masterBackupSubject()} now?`,
        });
        if (!proceed) return;
        try {
            const r = await TVC_MasterBackup.exportBackup(_masterBackupScope, user, masterBackupOpts());
            await paintMasterBackupCopy();
            const parts = Object.entries(r.counts || {}).map(([k, n]) => `${k}: ${n}`).join(', ');
            await TVC_Dialog.alert({
                kind: 'success',
                title: 'Backup complete',
                message: `${TVC_MasterBackup.scopeLabel(r.scope)}\n${r.filename}\n${parts}`,
            });
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    function triggerMasterRestore() {
        if (!state.user) return;
        document.getElementById('masterBackupRestoreFile')?.click();
    }

    async function onMasterRestoreFile(file) {
        if (!file) return;
        const user = state.user || TVC_Auth.getCurrentUser();
        if (!user) return;
        if (typeof TVC_MasterBackup === 'undefined') {
            await TVC_Dialog.alert('Backup module is not available.');
            return;
        }
        const label = TVC_MasterBackup.scopeLabel(_masterBackupScope);
        const proceed = await TVC_Dialog.confirm({
            kind: 'cancel',
            title: 'Database Restore',
            message: `Restore ${masterBackupSubject()} from the selected backup?\nCurrent Master Data will be replaced.`,
        });
        if (!proceed) return;
        try {
            const r = await TVC_MasterBackup.restoreBackup(_masterBackupScope, file, user, masterBackupOpts());
            closeMasterBackupModal();
            await refreshAll();
            if (_masterBackupScope === 'spare' && typeof TVC_SpareMenu !== 'undefined') {
                await TVC_SpareMenu.render?.();
            }
            const parts = Object.entries(r.counts || {}).map(([k, n]) => `${k}: ${n}`).join(', ');
            await TVC_Dialog.alert({
                kind: 'success',
                title: 'Restore complete',
                message: `${label}\nVessel: ${r.vesselId || '—'}\n${parts}`,
            });
        } catch (e) {
            if (e?.message === 'Restore cancelled.') return;
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    // ── Utils ────────────────────────────────────────────────────────
    function isModalOpen(id) {
        const el = document.getElementById(id);
        return !!(el && !el.classList.contains('hidden'));
    }
    function showModal(id, opts = {}) {
        const el = document.getElementById(id);
        if (!el) return;
        if (!opts.skipDragReset) window.TVC_ModalDrag?.resetModal?.(el);
        el.classList.remove('hidden');
    }
    function closeModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add('hidden');
        window.TVC_ModalDrag?.resetModal?.(el);
        if (id === 'workProcedureModal') clearWorkProcedureHistNavScope();
        if (id === 'vesselDocsModal') {
            state._vesselDocsRecord = null;
            state._vesselDocsMeta = null;
        }
        if (id === 'deptPickModal' && state._deptPickResolve) {
            const cb = state._deptPickResolve;
            state._deptPickResolve = null;
            cb(null);
        }
    }

    function applyModalOverWorkProcedure(modalId) {
        const el = document.getElementById(modalId);
        if (!el) return;
        el.classList.add('modal-over-wp');
        el.style.zIndex = '10001';
    }

    function clearModalOverWorkProcedure(modalId) {
        const el = document.getElementById(modalId);
        if (!el) return;
        el.classList.remove('modal-over-wp');
        el.style.zIndex = '';
    }

    /** Work History — Work Report ↔ Defect 전환 시 backdrop 깜빡임 방지 */
    function swapHistoryModals(showId, hideId, opts = {}) {
        const showEl = document.getElementById(showId);
        const hideEl = hideId ? document.getElementById(hideId) : null;
        if (!showEl) return;
        showEl.classList.remove('modal-hist-swapping');
        if (hideEl && !hideEl.classList.contains('hidden')) {
            hideEl.classList.add('modal-hist-swapping');
        }
        showEl.classList.remove('hidden');
        showEl.style.zIndex = '10001';
        if (opts.overWorkProcedure || isWorkProcedureHistNav()) {
            applyModalOverWorkProcedure(showId);
        }
        if (!opts.preserveScroll) {
            showEl.scrollTop = 0;
            const showBox = showEl.querySelector('.modal-box');
            if (showBox) showBox.scrollTop = 0;
        }
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (hideEl) {
                    hideEl.classList.remove('modal-hist-swapping');
                    hideEl.classList.add('hidden');
                    hideEl.style.zIndex = '';
                    clearModalOverWorkProcedure(hideId);
                    window.TVC_ModalDrag?.resetModal?.(hideEl);
                }
            });
        });
    }
    function requireAppDepartment() {
        const dept = String(state.department || state.user?.department || '').toUpperCase();
        if (dept !== 'DECK' && dept !== 'ENGINE') {
            throw new Error('Select Deck or Engine department first.');
        }
        return dept;
    }

    const MASTER_EXCEL_PASSWORD = '0000';
    let _masterImportAuth = null;

    async function confirmMasterExcelPassword(actionLabel) {
        const pw = await TVC_Dialog.promptPassword({
            title: 'Master Excel',
            message: `Enter password to ${actionLabel}.`,
            placeholder: 'Password',
        });
        if (pw === null) return false;
        if (String(pw) !== MASTER_EXCEL_PASSWORD) {
            await TVC_Dialog.alert({ message: 'Incorrect password.', kind: 'error' });
            return false;
        }
        return true;
    }

    function masterVesselOpts() {
        const opts = {};
        if (state.user && TVC_RBAC.isHqAccount(state.user)) {
            if (!state.selectedVesselId) {
                throw Object.assign(new Error('Select a vessel in Fleet first.'), { code: 'VESSEL_REQUIRED' });
            }
            opts.vesselId = state.selectedVesselId;
            opts.selectedVesselId = state.selectedVesselId;
        }
        return opts;
    }

    async function exportPmsMasterExcel() {
        if (!canPmsMasterExcel()) { await TVC_Dialog.alert(pmsMasterExcelDeniedMessage()); return; }
        if (!await confirmMasterExcelPassword('export PMS Master')) return;
        if (typeof TVC_PmsMasterExcel === 'undefined') { await TVC_Dialog.alert('PMS Master Export is not available.'); return; }
        try {
            const department = requireAppDepartment();
            await TVC_PmsMasterExcel.exportToFile({ department, ...masterVesselOpts() });
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Export failed');
        }
    }

    async function triggerPmsMasterImport() {
        if (!canPmsMasterExcel()) { await TVC_Dialog.alert(pmsMasterExcelDeniedMessage()); return; }
        if (!await confirmMasterExcelPassword('import PMS Master')) return;
        _masterImportAuth = 'pms';
        document.getElementById('pmsMasterImportFile')?.click();
    }

    async function importPmsMasterExcel(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !canPmsMasterExcel()) { await TVC_Dialog.alert(pmsMasterExcelDeniedMessage()); return; }
        if (!file) { _masterImportAuth = null; return; }
        if (_masterImportAuth !== 'pms') {
            if (!await confirmMasterExcelPassword('import PMS Master')) return;
        }
        _masterImportAuth = null;
        if (typeof TVC_PmsMasterExcel === 'undefined') { await TVC_Dialog.alert('PMS Master Import is not available.'); return; }
        if (!await TVC_Dialog.confirm({ message: `Import PMS Master Excel?\n\n${file.name}\n\nExcel will replace Group, Equipment, and Jobs.\nJobs removed from the sheet will be deleted (jobs linked to a Work Report keep a temporary CODE).\nRecommended: Database Backup before Import.\n\nContinue?` })) return;
        try {
            const department = requireAppDepartment();
            const r = await TVC_PmsMasterExcel.importFromFile(file, user, { department, ...masterVesselOpts() });
            state.selectedGroupKey = null;
            await refreshAll();
            const orphanLine = (r.removed || r.detached)
                ? `\nExcluded: ${r.removed || 0} · Work Report isolated: ${r.detached || 0}`
                : '';
            const reuseLine = (r.codeReuseNotes && r.codeReuseNotes.length)
                ? `\n\nExisting JOB CODE updated (group move):\n${r.codeReuseNotes.join('\n')}`
                : '';
            const warnLine = (r.warnings && r.warnings.length)
                ? `\n\n⚠ Review:\n${r.warnings.slice(0, 5).join('\n')}${r.warnings.length > 5 ? '\n…' : ''}`
                : '';
            const vesselLine = r.vessel_id ? `\nVessel: ${r.vessel_id}` : '';
            const repairLine = (r.groupRepair?.defsPruned || r.rehomedJobs || r.ensureRepaired || r.ensureCreated)
                ? `\nGroup cleanup: defs ${r.groupRepair?.defsPruned || 0} · jobs moved ${r.rehomedJobs || 0} · repaired ${r.ensureRepaired || 0} · recreated ${r.ensureCreated || 0}`
                : '';
            const buildLine = r.importBuild ? `\nEngine: ${r.importBuild}` : '';
            const allSummary = r.groupSummary || [];
            const summaryLine = allSummary.length
                ? `\n\nDB group check:\n${allSummary.join('\n')}`
                : '';
            const verifyLine = (r.groupVerify && r.groupVerify.length)
                ? `\n\n⚠ Not applied:\n${r.groupVerify.slice(0, 6).join('\n')}`
                : '';
            const tailCodeLine = (r.tailJobCodes && r.tailJobCodes.length)
                ? `\n29~43 CODE: ${r.tailJobCodes.join(', ')}`
                : '';
            await TVC_Dialog.alert(`Import complete${vesselLine}\n\nJobs: ${r.jobs} rows (new ${r.created}, updated ${r.updated}, CODE changed ${r.renamed})${orphanLine}${repairLine}${reuseLine}${warnLine}${summaryLine}${verifyLine}${tailCodeLine}${buildLine}`);
            if (r.groupVerify?.length) {
                console.warn('[TVC] PMS Master Import group verify failed', r.groupVerify);
            }
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Import failed');
        }
    }

    async function exportSpareMasterExcel() {
        if (!canSpareMasterExcel()) { await TVC_Dialog.alert(spareMasterExcelDeniedMessage()); return; }
        if (!await confirmMasterExcelPassword('export SPARE Master')) return;
        if (typeof TVC_SpareMasterExcel === 'undefined') { await TVC_Dialog.alert('SPARE Master Export is not available.'); return; }
        try {
            const department = requireAppDepartment();
            await TVC_SpareMasterExcel.exportToFile({ department, simplifyCodes: true, user: TVC_Auth.getCurrentUser(), ...masterVesselOpts() });
            if (typeof TVC_SpareMenu?.reloadSparesCache === 'function') await TVC_SpareMenu.reloadSparesCache();
            await refreshAll();
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Export failed');
        }
    }

    async function exportSpareMasterSetupTemplate() {
        if (!canSpareMasterExcel()) await TVC_Dialog.alert(spareMasterExcelDeniedMessage());
        if (typeof TVC_SpareMasterExcel === 'undefined') await TVC_Dialog.alert('SPARE Master Export is not available.');
        const ok = await TVC_Dialog.confirm({
            message: 'Export SPARE Master setup template?\n\n'
                + '· Code = GG-EE-III (e.g. 01-01-001; no Equipment → 02-00-001)\n'
                + '· SPARE_ID cleared · ROB/Work = 0\n'
                + '· For new vessel or sister-ship Excel editing',
        });
        if (!ok) return;
        try {
            const department = requireAppDepartment();
            await TVC_SpareMasterExcel.exportSetupTemplate({ department, ...masterVesselOpts() });
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Export failed');
        }
    }

    async function renumberSpareMasterCodes() {
        if (!canSpareMasterExcel()) await TVC_Dialog.alert(spareMasterExcelDeniedMessage());
        if (typeof TVC_SpareCode === 'undefined') await TVC_Dialog.alert('Spare code module unavailable.');
        const ok = await TVC_Dialog.confirm({
            message: 'Renumber all spare codes to GG-EE-III format?\n\n'
                + 'Example: MAIN BEARING → 01-01-001, 01-01-002 …\n'
                + 'No Equipment → 02-00-001, 02-00-002 …\n'
                + 'Consumption / Requisition history stays linked (spare ID).\n'
                + 'Displayed codes in old reports may differ.',
        });
        if (!ok) return;
        try {
            const department = requireAppDepartment();
            const opts = masterVesselOpts();
            let vesselId = opts.vesselId || opts.selectedVesselId;
            if (!vesselId && typeof TVC_MasterVesselScope !== 'undefined') {
                vesselId = await TVC_MasterVesselScope.resolve(TVC_Auth.getCurrentUser(), opts);
            }
            const r = await TVC_SpareCode.renumberVessel(vesselId, { department });
            if (typeof TVC_SpareMenu?.reloadSparesCache === 'function') await TVC_SpareMenu.reloadSparesCache();
            await refreshAll();
            await TVC_Dialog.success(`Renumbered ${r.updated} / ${r.total} spare codes (${department}).`);
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Renumber failed');
        }
    }

    async function triggerSpareMasterImport() {
        if (!canSpareMasterExcel()) { await TVC_Dialog.alert(spareMasterExcelDeniedMessage()); return; }
        if (!await confirmMasterExcelPassword('import SPARE Master')) return;
        _masterImportAuth = 'spare';
        document.getElementById('spareMasterImportFile')?.click();
    }

    async function importSpareMasterExcel(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !canSpareMasterExcel()) { await TVC_Dialog.alert(spareMasterExcelDeniedMessage()); return; }
        if (!file) { _masterImportAuth = null; return; }
        if (_masterImportAuth !== 'spare') {
            if (!await confirmMasterExcelPassword('import SPARE Master')) return;
        }
        _masterImportAuth = null;
        if (typeof TVC_SpareMasterExcel === 'undefined') { await TVC_Dialog.alert('SPARE Master Import is not available.'); return; }
        const backupHint = 'Recommended: If necessary, back up SPARE in Database Backup & Restore before Import.';
        if (!await TVC_Dialog.confirm({ message: `Import SPARE Master Excel?\n\n${file.name}${state.selectedVesselId && TVC_RBAC.isHqAccount(user) ? `\nTarget vessel: ${state.selectedVesselId}` : ''}\n\nGroup Headers, Equipment Headers, and Spare Parts will follow Excel.\nRows deleted in Excel will also be deleted in the UI/DB.\nCodes use GG-EE-III (Group-Equipment-Item).\n${backupHint}\n\nContinue?` })) return;
        try {
            const department = requireAppDepartment();
            const r = await TVC_SpareMasterExcel.importFromFile(file, user, { department, simplifyCodes: true, ...masterVesselOpts() });
            if (typeof TVC_SpareMenu?.reloadSparesCache === 'function') await TVC_SpareMenu.reloadSparesCache({ force: true });
            if (typeof TVC_SpareMenu?.reloadSpareGroupsCache === 'function') await TVC_SpareMenu.reloadSpareGroupsCache();
            await refreshAll();
            const vesselLine = r.vessel_id ? `\nVessel: ${r.vessel_id}` : '';
            const codeLine = r.codesRenumbered ? `\nCodes renumbered: ${r.codesRenumbered}` : '';
            const renameLine = r.groupRenamed
                ? `\nGroup renamed: ${r.groupRenamed} (jobs ${r.groupRenameJobs || 0}, headers ${r.groupRenameGroups || 0}, spares ${r.groupRenameSpares || 0})`
                : '';
            const foreignLine = r.foreignSpareIds
                ? `\nWarning: ${r.foreignSpareIds} SPARE_ID(s) in file belong to another vessel — imported as new parts. Re-import with the correct vessel selected in Fleet.`
                : '';
            const relinkTotal = (r.relinkedReqLines || 0) + (r.relinkedConsumeLines || 0) + (r.relinkedUsedParts || 0)
                + (r.relinkedDefectParts || 0) + (r.relinkedPermitParts || 0) + (r.relinkedJobBom || 0);
            const relinkLine = relinkTotal
                ? `\nHistorical links updated: req ${r.relinkedReqLines || 0}, consume ${r.relinkedConsumeLines || 0}, work report ${r.relinkedUsedParts || 0}, defect ${r.relinkedDefectParts || 0}, work permit ${r.relinkedPermitParts || 0}, BOM ${r.relinkedJobBom || 0}`
                : '';
            const removedLine = (r.removed || r.removedEquipment || r.removedGroups)
                ? `\nDeleted: parts ${r.removed || 0} · equipment ${r.removedEquipment || 0} · groups ${r.removedGroups || 0}`
                : '';
            await TVC_Dialog.alert(`Import complete${vesselLine}\n\nSpare Parts: ${r.parts} rows (new ${r.created}, updated ${r.updated})${removedLine}\nGroups: ${r.groups} · Equipment: ${r.equipment}${codeLine}${renameLine}${foreignLine}${relinkLine}`);
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Import failed');
        }
    }

    function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

    /** Reporter 표시 — full titles; legacy C/E etc. mapped via RBAC helper */
    function reporterLabel(name) {
        return TVC_RBAC.normalizeReportedByLabel(name);
    }

    /** PMS Work Report — 최초 작성 계정 Reported by (신규 작성 시에만 현재 접속자) */
    function workReportReportedByName(rep) {
        if (rep) {
            const fromRecord = TVC_RBAC.getReportedByLabelForWorkReport?.(rep);
            if (fromRecord) return fromRecord;
            if (rep.reporter_name) return reporterLabel(rep.reporter_name);
        }
        return TVC_RBAC.getReportedByLabel(state.user);
    }
    function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }

    return {
        boot, switchTab, navigate,
        setDepartment, setCaptainView, setHistView, setHistTab, menuAction, resolveDeptPick,
        setFleetView, setFleetSearch, setFleetCompanyFilter, selectVessel,
        openVesselDocsModal, uploadVesselDocsAttachment, removeVesselDocsAttachment,
        setAdminSearch, selectAdminCompany, selectAdminVessel,
        openAdminCompanyForm, openAdminVesselForm, closeAdminRegistryModal,
        openAdminRegistryHub, adminRegistryHubSelectCompany, adminRegistryHubSelectVessel,
        adminRegistryCancelForm, openAdminCompanyFormFromHub, openAdminVesselFormFromHub,
        openAdminDeliverModal, closeAdminDeliverModal,
        adminDeliverOpenSetup, adminDeliverOpenPoolUpdate, adminDeliverOpenCompanyUpdate, adminDeliverOpenSeatLicense,
        openAdminSeatLicenseModal, closeAdminSeatLicenseModal,
        adminSeatLicensePickKey, adminSeatLicenseLoadFile, adminSeatLicenseSetMonths,
        adminSeatLicenseSetCompany, adminSeatLicenseSetVessel, adminSeatLicenseIssueAndSave,
        openAdminUniversalSetupModal,
        openAdminSetupExportModal, closeAdminSetupExportModal, renderAdminSetupExportModal,
        openAdminAppUpdateModal, openAdminCompanyAppUpdateModal, closeAdminAppUpdateModal, renderAdminAppUpdateModal,
        adminAppUpdateSetCompany,
        openAdminReleaseModal, closeAdminReleaseModal,
        adminReleaseSetRunBuild, adminReleaseSetIncludeSetups, adminReleaseSetIncludeAppUpdate,
        adminReleaseSetIncludeHandoff, adminReleaseSetCompany, adminReleaseSetRecordDeploy,
        adminReleaseSetRecordSetup, adminReleaseSetRecordUpdate, adminReleaseRun, adminReleaseCancel,
        adminReleaseOpenExportFolder,
        openAdminSopModal, closeAdminSopModal,
        openAdminCommercialModal, closeAdminCommercialModal, selectTvcLabInList,
        adminPrintContractDraft,
        openAdminPrintRegistryModal, closeAdminPrintRegistryModal,
        adminPrintRegistrySetCompany, adminPrintRegistrySetIncludeInactive, adminPrintRegistryRun,
        adminSetupExportPickFolder, adminSetupExportSetCompany, adminSetupExportSetVessel, adminSetupExportToggleSku,
        adminSetupExportSetVersion,
        adminSetupExportSetNotes, adminSetupExportSetRecordDeploy, adminSetupExportRun,
        adminAppUpdatePickFolder, adminAppUpdateSetVersion, adminAppUpdateSetNotes,
        adminAppUpdateSetRecordDeploy, adminAppUpdateSetRecordPool, adminAppUpdateToggleSku, adminAppUpdateRun,
        saveAdminCompanyForm, saveAdminVesselForm, deactivateAdminCompany, deactivateAdminVessel,
        setSearch, setTreeSearch, clearSearchField, clearListFilterSearch, updateSearchClearBtn, updateSearchClearBtnForEl, ensureSearchClearUi, bindSearchClearInput, bindListFilterSearchClear, bindTabSearchClearInputs, refreshSearchClearUi, sortJobs, setActualFilter, onActualPeriodChange, clearActualPeriod, onReportPeriodChange, clearReportPeriod, clearHistoryPeriodAndFilters, syncReportPeriodInputs, hasReportPeriodFilter, setHistoryScope, onSpareHistPeriodChange, clearSpareHistPeriod, setSpareHistSearch, selectSpareHistRow, spareHistDetailReport, defectCaseReportDate, listReportedDateStr, compareDefectCaseByReportedDate, matchReportPeriodDate, selectGroup, isTreeDeptCollapsed, toggleTreeDept, renderGroupTree,
        getListFilterState, setListFilters, clearListFilters, syncListFilterBtns, listFilterCtx,
        jobShowsCriticalEquipmentMark, jobCriticalEquipmentDisplay, renderWrPmsGroupCriticalRow,
        postponeRequiresCompanyApproval, workReportListWorkflowStatus,
        reportMatchesPostponeAwaitingApproval, histEntryAwaitingShipConfirm,
        getAppDepartment, getAppUserDepartment, getSelectedGroupKey, getSpareSelectedGroupKey, getAppIdx, getAppJobs, resolveJobByCode,
        workPermitBelongsToDept, filterWorkPermitsForView,
        renderSectionCard,
        openJobDetail, openWorkProcedure, openPlanWorkProcedure, onPlanRowClick, setWorkProcedureTab,
        enterWorkProcedureEdit, cancelWorkProcedureEdit, saveWorkProcedure, uploadWorkProcedureAttachment, removeWorkProcedureAttachment,
        refreshWorkProcedureIfOpen, isModalOpen, isWorkProcedureHistNav, applyModalOverWorkProcedure, clearModalOverWorkProcedure,
        openProcedureHistory, openProcedureHistoryByCode,
        openWorkReport, openWorkReportInput, setWorkReportTab, setWorkReportPage, saveWorkReport, captureWorkReportForm,
        onPostponeDateChange,
        switchMakeReportKind, renderReportKindTabsHtml, openWorkPermitFromHistory,
        uploadWrAttachment, removeWrAttachment,
        toggleWrGroupPick, toggleWrJobPick, pickWrGroup, pickWrJob, wrGroupPickSearch, wrJobPickSearch,
        addWrJobRow, removeWrJobRow, toggleWrJobRowPick, pickWrJobForRow, clearWrJobRow, wrJobRowPickSearch,
        toggleBatchJob, toggleBatchSelectAll, openBatchReport, saveBatchReport,
        syncPlanBatchCheckForJob, syncPlanBatchChecksFromJobItems, buildJobItemsFromJobIds,
        snapshotPlanBatchSelection, restorePlanBatchSelection, clearPlanBatchSnapshot, clearPlanBatchSelection,
        togglePlanSelectedOnly, toggleActSelectedOnly, renderPlanGroupHeader, refreshActualPlan,
        openNewDefectReportInput, openNewDefectFromPlan,
        setBatchActiveJob, setWrBatchViewJob, openBatchJobPicker, closeBatchJobPicker, closeBatchReport,
        openWorkReportFromHistory, openDefectFromHistory, openConsumeFromHistory, openWorkHistoryEntry, navWorkHistoryEntry, syncHistRowSelection,
        histNavButtonsHtml, workHistoryNavBounds,
        modifyWorkReport, cancelWorkReportEdit, selectHistRow, renderWorkHistory, histDefectRowKey,
        buildDefectHistRowHtml, matchDefectHistSearch, initHistCellTips,
        formatHistGroupEquipmentName, isPlaceholderJobCode, defectEffectiveJobCode,
        histDetailWorkReport, histModifyReport, histReportApproval, histHqReportApproval, histDeleteReport,
        toggleHistCheck, toggleHistSelectAll,
        navReport, deleteWorkReport, printWorkReport, previewWorkReport, wrReportConfirmByToggle, wrApprovedByToggle, wrHistConfirmOrApprove, closeWorkReport, requestCloseWorkReport,
        openFileNoPickModal, closeFileNoPickModal, fileNoPickSearch, applyFileNoPick,
        
        selectJobRow,
        selectSpareRow, focusSpareRow, toggleSpareRow, syncSpareItemToolbar, spareActionIds, canEditSpareItems, openSpareAppend, openSpareModify, deleteSpareItem,
        saveRunHrs, updateRunHrs, revertRunHrs, runHrsPreview,
        openRunHoursModal, closeRunHoursModal,
        updateOriginalPlanFromRunHours, approveWorkPlanFromHq,
        openOrigJobModify, openOrigJobAppend, saveOrigJobEditor, saveOrigJobInlineEdit, cancelOrigJobInlineEdit, deleteOrigJob,
        isOrigJobInlineEditing, getOrigJobInlineEquipmentDraft, syncOrigJobInlineHeader,
        openOrigGroupAdd, openOrigGroupRename, deleteOrigGroup, saveGroupEditor,
        masterVesselOpts,
        exportPmsMasterExcel, triggerPmsMasterImport, importPmsMasterExcel,
        canSpareMasterExcel, spareMasterExcelDeniedMessage,
        exportSpareMasterExcel, exportSpareMasterSetupTemplate, renumberSpareMasterCodes,
        triggerSpareMasterImport, importSpareMasterExcel,
        confirmPlanUpdate, closePlanUpdateModal, printTabList, printCurrentTab,
        doSubmit, doExecute, doApprove, doConfirm,
        handleLogin, handleLogout, handleExport, handleImport, handleHubImport, handleDefectImport, handlePostponeImport, handleWorkPermitImport,
        urgentExportDefect, exportDefectCompletion, loadSeedFile,
        openMenuXferMenu, closeMenuXferMenu, menuXferPickMode, menuXferBack, menuXferTriggerImport,
        menuXferSelectImportType, menuXferPickExportType,
        menuXferConfirmCaseExport, menuXferConfirmCaseExportAll,
        menuXferConfirmMonthlyExport,
        menuXferConfirmVesselProfileExport, menuXferApplyVesselProfile,
        menuXferAppUpdateToggleSku, menuXferAppUpdateSetVersion, menuXferAppUpdateSetNotes,
        menuXferAppUpdateSetCompany, menuXferAppUpdateSetRecordDeploy,
        menuXferAppUpdatePickSetup, menuXferAppUpdateOnSetupFile, menuXferConfirmAppUpdateExport,
        menuXferApplyAppUpdate,
        menuXferTryOnlineSync,
        menuXferExportDefect, menuXferExportPostpone, menuXferExportWorkPermit, menuXferExportMonthly, onMenuXferImportFile,
        menuXferOpenCaseSelect, menuXferOpenMonthlySelect,
        menuXferCaseSetPeriod, menuXferClearCasePeriodAndFilters, menuXferCaseSetSearch,
        getMenuXferCaseFilters, setMenuXferCaseFilters,
        menuXferMonthlySetPeriod, menuXferClearMonthlyPeriodAndFilters, menuXferMonthlySetSearch,
        getMenuXferMonthlyFilters, setMenuXferMonthlyFilters,
        menuXferOpenRunningHours,
        openMenuHistoryModal, closeMenuHistoryModal, setMenuHistCategory, menuHistPeerLabel,
        openMasterBackupModal, closeMasterBackupModal, runMasterBackup, triggerMasterRestore, onMasterRestoreFile,
        uploadAttachment, saveDetailReport, closeModal, showModal, swapHistoryModals, dismissSpicsAlerts, openSpicsRequisition,
        buildWorkReportPage2PrintHtmlFromReport,
    };
})();

document.addEventListener('DOMContentLoaded', () => TVC_App.boot());
window.TVC_App = TVC_App;
