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
    let _menuHistCategory = 'defect'; // defect | workPermit | postpone | monthly

    function repSt(r) { return TVC_RBAC.normalizeReportStatus(r?.status, !!r?.is_locked); }
    function itemSt(item) { return TVC_RBAC.normalizeReportStatus(item?.status); }

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
        listFilters: {
            actual: { pics: [], unassigned: false, criticalOnly: false },
            history: { groupKeys: [], type: 'all', openOnly: false, postponeAwaitingApproval: false },
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
        return '1.0.1';
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
        const allJobs = await TVC_DB.getAll('maintenance_jobs');
        const allGroups = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        await normalizeGroupDepartments(allJobs, allComponents, allGroups);
        if (typeof TVC_PmsMasterExcel !== 'undefined' && TVC_PmsMasterExcel.applyDeckCatalogNormalization) {
            await TVC_PmsMasterExcel.applyDeckCatalogNormalization(allJobs, allGroups);
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
            if (typeof TVC_MasterVesselScope !== 'undefined') {
                return TVC_MasterVesselScope.belongs(row, masterVesselId);
            }
            return !row?.vessel_id || row.vessel_id === masterVesselId;
        };
        const scopedJobs = allJobs.filter(masterBelongs);
        const scopedGroups = allGroups.filter(masterBelongs);
        const scopedComponents = allComponents.filter(masterBelongs);
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
            try { await TVC_PMS.updateMaintenanceSchedule(state, { silent: true }); } catch (e) { console.warn('[TVC_PMS] schedule recalc skipped:', e); }
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
        // 데이터 공간(Space) 분리: HQ와 선박(Vessel)은 서로의 실시간 데이터를 보지 못하며, 오직 Export/Import(ZIP)로만 동기화된다.
        const isAdmin = TVC_RBAC.isAdminAccount?.(state.user);
        const isHq = !isAdmin && TVC_RBAC.isHqAccount(state.user);
        state.space = isAdmin ? 'ADMIN' : (isHq ? 'HQ' : 'SHIP');
        state.station = state.user.station || null;
        if (isAdmin) {
            state.department = null;
        } else if (isHq) {
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
        // HQ는 선박 선택을 먼저 확정해야 선박별 Run-hour scope / 데이터 필터가 올바르게 적용됨
        if (isAdmin) {
            TVC_PMS.setSpace('SHIP');
            state.jobs = [];
            state.components = [];
            state.groups = [];
            state.spareGroups = [];
            state.adminSearch = '';
            state.adminCompanyFilter = '';
            try {
                await TVC_AdminRegistry.load();
                const sel = TVC_AdminRegistry.getSelected();
                const lab = TVC_AdminRegistry.getTvcLabDefaults();
                if (sel.companyId) {
                    state.selectedAdminCompanyId = sel.companyId;
                    state.selectedAdminVesselId = sel.vesselId || null;
                    state.adminCompanyFilter = sel.companyId;
                } else {
                    state.adminCompanyFilter = lab.companyId;
                    state.selectedAdminCompanyId = lab.companyId;
                    state.selectedAdminVesselId = lab.vesselId;
                    TVC_AdminRegistry.setSelected(lab.companyId, lab.vesselId);
                }
            } catch (e) {
                console.warn('[TVC_AdminRegistry]', e);
                await TVC_Dialog.alert('Admin registry (admin/registry.json) load failed.\n' + (e.message || e));
            }
        } else if (isHq) {
            state.fleet = await TVC_Fleet.ensureFleet();
            state.selectedVesselId = TVC_Fleet.getSelectedId();
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
        if (isAdmin) {
            setText('cmaxsShipName', 'THE VESSEL CODE — Admin');
            setText('cmaxsShipCode', 'ADMIN');
            setText('cmaxsShipDelivery', '—');
        }
        showApp();
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
                groupKeys: [], type: 'all', openOnly: false, postponeAwaitingApproval: false,
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
            : (TVC_RBAC.isAdminAccount?.(user)
                ? 'Admin Mode'
                : (TVC_RBAC.isHqAccount(user)
                    ? 'HQ Mode'
                    : (user.department === 'DECK' ? 'Vessel Mode - Deck'
                        : user.department === 'ENGINE' ? 'Vessel Mode - Engine'
                            : 'Vessel Mode')));
        const title = TVC_RBAC.getAccountTitle(user.username);
        document.querySelectorAll('.userBadgeEl').forEach(el => el.textContent = badge);
        document.querySelectorAll('.userNameEl').forEach(el => el.textContent = title);
        document.querySelectorAll('.userVesselEl').forEach(el => {
            if (TVC_RBAC.isAdminAccount?.(user)) { el.textContent = 'TVC Admin'; return; }
            if (!user.vessel_id) { el.textContent = 'Head Office'; return; }
            const v = TVC_Fleet.resolveById(user.vessel_id);
            el.textContent = v ? `Vessel: ${v.name} (${v.id})` : `Vessel: ${user.vessel_id}`;
        });
        if (!TVC_RBAC.isAdminAccount?.(user)) populateShipHeader(user);
        syncWindowTitle(user);
    }

    async function populateShipHeader(user) {
        let vessel = null;
        if (TVC_RBAC.isHqAccount(user)) {
            vessel = state.fleet.find(v => v.id === state.selectedVesselId) || TVC_Fleet.getSelected();
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
            setText('cmaxsShipName', vessel.name);
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
        const isAdmin = !!TVC_RBAC.isAdminAccount?.(user);
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
            btn.classList.toggle('hidden', isAdmin);
        });
        const dash = document.getElementById('captainViewDashboard');
        if (dash) dash.classList.toggle('hidden', !f.showCaptainDashboard || isAdmin);
        syncPlanGroupTreeUi();
        if (isAdmin && state.currentTab !== 'menu') {
            switchTab('menu');
            return;
        }
        if (!f.showSpareTab && state.currentTab === 'spare') {
            switchTab('menu');
            return;
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
        if (!dept) return state.jobs;
        return state.jobs.filter(j => j.department === dept);
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

    /** 이원화된 Export/Import: HQ는 반드시 DECK/ENGINE을 명시적으로 선택해야 진행된다. 선박은 자기 부서로 자동 확정. */
    function pickDepartmentThen(title, cb) {
        if (state.user && !TVC_RBAC.isHqAccount(state.user)) { cb(state.user.department); return; }
        state._deptPickResolve = cb;
        setText('deptPickTitle', title);
        showModal('deptPickModal');
    }

    function resolveDeptPick(dept) {
        closeModal('deptPickModal');
        const cb = state._deptPickResolve;
        state._deptPickResolve = null;
        if (cb) cb(dept);
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

    function histRowKey(reportId, jobId) {
        return `${reportId}|${jobId}`;
    }

    function histDefectRowKey(defectId) {
        return `DEF|${defectId}`;
    }

    function histEntryRowKey(entry) {
        if (isHistDefectEntry(entry)) {
            if (entry.isDefectBatchSummary) return `DEFBATCH|${entry.defect.id}`;
            return histDefectRowKey(entry.defect.id);
        }
        if (entry.isBatchSummary) return `BATCH|${entry.report.id}`;
        return histRowKey(entry.report.id, entry.item.maintenance_job_id);
    }

    function histPrimaryJob(entry) {
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
        if (isHistDefectEntry(entry)) return false;
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
        if (isHistDefectEntry(entry)) {
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
        if (isHistDefectEntry(entry)) {
            return defectShowsCriticalEquipmentMark(entry.defect) ? '⚠' : '';
        }
        const job = state.idx?.jobById.get(entry.item.maintenance_job_id)
            || state.jobs.find(j => j.job_code === entry.item.job_code);
        return job && jobShowsCriticalEquipmentMark(job) ? '⚠' : '';
    }

    function isPlaceholderJobCode(code) {
        const s = String(code || '').trim();
        if (!s) return true;
        return /JOB CODE\s*(선택|选择)/i.test(s) || /^Select JOB CODE$/i.test(s);
    }

    /** job_code lookup — always prefer department when known (ENGINE·DECK may share codes). */
    function resolveJobByCode(code, department) {
        const c = String(code || '').trim();
        if (!c) return null;
        const dept = String(department || '').trim().toUpperCase();
        const pools = [];
        if (state.idx?.jobById) pools.push([...state.idx.jobById.values()]);
        if (state.jobs?.length) pools.push(state.jobs);
        if (state._allJobs?.length) pools.push(state._allJobs);
        for (const pool of pools) {
            if (dept) {
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
        if (isHistDefectEntry(entry)) return listReportedDateStr(entry.defect);
        return listReportedDateStr(entry.report);
    }

    function histEntryCreatedAt(entry) {
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
        if (!report || report.work_type !== 'POSTPONE') return false;
        if (report.requires_company_approval === true) return true;
        if (report.requires_company_approval === false) return false;
        return jobShowsCriticalEquipmentMark(resolveReportJob(report));
    }

    function workHistoryPostponeReports() {
        return workHistoryReports().filter(r => {
            TVC_WorkReport.fromLegacy(r);
            return r.work_type === 'POSTPONE' && postponeRequiresCompanyApproval(r);
        });
    }

    function matchHistSearch(entry) {
        const q = state.search;
        if (!q) return true;
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
        if (keys.postponed.ids.has(j.id) || keys.postponed.codes.has(j.job_code)) return 'postponed';
        if (j.is_overdue) return 'overdue';
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

    /** 부서 필터(전역) 후 mode별 세부 필터 적용 */
    function sheetIds(mode) {
        const idx = state.idx;
        let ids = deptJobs().map(j => j.id);
        if (state.selectedGroupKey === CRITICAL_GROUP_KEY) {
            const crit = new Set(criticalJobIdsInDept());
            ids = ids.filter(id => crit.has(id));
        } else if (state.selectedGroupKey) {
            const set = new Set(idx.jobsByGroupKey.get(state.selectedGroupKey) || []);
            ids = ids.filter(id => set.has(id));
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

    const LIST_FILTER_SEARCH_SEL = '.list-filter-stack .list-filter-search-row .search-input, .spare-list-search-bar .search-input, .list-filter-group-search';
    let _listFilterSearchClearBound = false;

    function isListFilterSearchInput(el) {
        return !!el?.matches?.('input.search-input') && !!el.closest('.list-filter-stack, .spare-list-search-bar, .list-filter-section');
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
        const btn = el.closest('.search-field-wrap')?.querySelector('.search-clear-btn');
        if (btn && !btn.classList.contains('hidden')) {
            btn.click();
            el.focus();
            return;
        }
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
        root.querySelectorAll(LIST_FILTER_SEARCH_SEL).forEach(el => {
            if (el.closest('.search-field-wrap')) {
                updateSearchClearBtnForEl(el);
                return;
            }
            const parent = el.parentElement;
            if (!parent) return;
            const wrap = document.createElement('div');
            wrap.className = 'search-field-wrap';
            parent.insertBefore(wrap, el);
            wrap.appendChild(el);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'search-clear-btn hidden';
            btn.title = 'Clear search';
            btn.setAttribute('aria-label', 'Clear search');
            btn.textContent = '×';
            if (el.id) btn.setAttribute('onclick', `TVC_App.clearSearchField('${el.id}')`);
            wrap.appendChild(btn);
            updateSearchClearBtnForEl(el);
        });
    }

    function bindSearchClearInput(inputId) {
        const el = document.getElementById(inputId);
        if (!el || el.dataset.searchClearBound) return;
        el.dataset.searchClearBound = '1';
        el.addEventListener('input', () => updateSearchClearBtnForEl(el));
        updateSearchClearBtnForEl(el);
    }

    function bindListFilterSearchClear() {
        if (_listFilterSearchClearBound) return;
        _listFilterSearchClearBound = true;
        document.addEventListener('input', (e) => {
            if (!isListFilterSearchInput(e.target)) return;
            updateSearchClearBtnForEl(e.target);
        }, true);
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const el = e.target;
            if (!isListFilterSearchInput(el) || !String(el.value || '').trim()) return;
            e.preventDefault();
            clearListFilterSearch(el);
        }, true);
    }

    function bindTabSearchClearInputs() {
        bindListFilterSearchClear();
        ensureSearchClearUi();
        [
            'actSearch', 'actTreeSearch', 'histSearch', 'spareSearch', 'spareTreeSearch',
            'reqListSearch', 'reqHistSearch', 'consumeLogSearch', 'wpListSearch', 'dfListSearch',
            'reqWorkSearch', 'wrSpareSearch', 'consumeSearch', 'receiveSearch',
        ].forEach(bindSearchClearInput);
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

    function syncReportPeriodInputs() {
        const fromEl = document.getElementById('histPeriodFrom');
        const toEl = document.getElementById('histPeriodTo');
        if (fromEl && document.activeElement !== fromEl) fromEl.value = state.reportPeriodFrom || '';
        if (toEl && document.activeElement !== toEl) toEl.value = state.reportPeriodTo || '';
        document.getElementById('histPeriodFilter')?.classList.toggle('active', hasReportPeriodFilter());
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
            if (j) return j;
        }
        const batch = batchSelectedJobIds();
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
        const overdue = jobs.filter(j => j.is_overdue).length;
        const due30 = jobs.filter(j => !j.is_overdue && daysUntil(j.next_date) <= 30).length;
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
        return { total: jobs.length, overdue, due30, dueMonth, pending: pending.length, approved, defectPending, postponePending, workReportPending, reportsPending, critical };
    }

    function hqMonthlyReportsPendingCount() {
        return hqPendingDefectCases().length
            + hqPendingPostponeReports({ monthly: true }).length
            + hqPendingWorkReports().length;
    }

    function hqPendingDefectCases() {
        return (state.defectCases || []).filter(d =>
            d.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
        );
    }

    function reportMatchesPostponeAwaitingApproval(report, opts = {}) {
        const monthly = opts.monthly === true;
        if (!report) return false;
        TVC_WorkReport.fromLegacy(report);
        if (report.work_type !== 'POSTPONE') return false;
        if (!TVC_RBAC.isConfirmedStatus(report.status, report.is_locked)) return false;
        if (reportIsApproved(report)) return false;
        const critical = postponeRequiresCompanyApproval(report);
        if (critical) return report.sync_status === 'SYNCED';
        return monthly;
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
        return reports.filter(r => {
            TVC_WorkReport.fromLegacy(r);
            if (r.work_type === 'POSTPONE') return false;
            if (!TVC_RBAC.isConfirmedStatus(r.status, r.is_locked)) return false;
            if (reportIsApproved(r)) return false;
            return true;
        }).sort(compareReportByReportedDate);
    }

    function openHqApproveReports() {
        if (!TVC_RBAC.isHqAccount(state.user)) return;
        state.listFilters.history = { groupKeys: [], type: 'all', openOnly: false, postponeAwaitingApproval: false };
        state.reportPeriodFrom = '';
        state.reportPeriodTo = '';
        state.search = '';
        switchTab('history');
        TVC_ListFilters?.syncBtn('history');
    }

    async function openHqApproveDefectReport() {
        if (!TVC_RBAC.isHqAccount(state.user)) return;
        if (!TVC_RBAC.can(state.user, TVC_RBAC.Action.REPLY_DEFECT_REPORT)) {
            await TVC_Dialog.alert('No permission to approve Defect Report.');
        }
        state.listFilters.history = {
            ...state.listFilters.history,
            groupKeys: [],
            type: 'd',
            openOnly: true,
            postponeAwaitingApproval: false,
        };
        switchTab('history');
        TVC_ListFilters?.syncBtn('history');
    }

    async function openHqApprovePostponeReport() {
        if (!TVC_RBAC.isHqAccount(state.user)) return;
        if (!TVC_RBAC.canApproveHqReport(state.user)) {
            await TVC_Dialog.alert('No permission to approve Postpone Report.');
        }
        state.listFilters.history = {
            ...state.listFilters.history,
            groupKeys: [],
            type: 'p',
            openOnly: false,
            postponeAwaitingApproval: true,
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

    function menuModel() {
        if (state.user && TVC_RBAC.isAdminAccount?.(state.user)) {
            const st = typeof TVC_AdminRegistry !== 'undefined' ? TVC_AdminRegistry.stats() : { companies: 0, vessels: 0 };
            return [
                {
                    key: 'commercial',
                    tone: 'daily',
                    title: 'Commercial — TVC delivers',
                    items: [
                        {
                            label: '① Universal Setup · ② Seat license · ③ Master Excel · ④ App Update',
                            textOnly: true,
                        },
                        {
                            label: 'Commercial core & TVC Lab guide (상용화 · 내부 QA)',
                            tag: 'A',
                            action: 'TVC_App.openAdminCommercialModal()',
                        },
                        {
                            label: 'Release (Build & Export Setup + App Update)',
                            tag: 'A',
                            action: 'TVC_App.openAdminReleaseModal()',
                        },
                        {
                            label: 'Export Setup handoff (universal HQ + Vessel → ZIP)',
                            tag: 'A',
                            action: 'TVC_App.openAdminSetupExportModal()',
                        },
                        {
                            label: 'Issue seat license (machine request → license.json)',
                            tag: 'A',
                            action: 'TVC_App.openAdminSeatLicenseModal()',
                        },
                        {
                            label: 'Package App Update (Setup.exe → ZIP → send to company HQ)',
                            tag: 'A',
                            action: 'TVC_App.openMenuXferMenu()',
                        },
                    ],
                },
                {
                    key: 'admin',
                    tone: 'necessary',
                    title: 'Contract registry',
                    items: [
                        {
                            label: `Registry · ${st.companies} companies · ${st.vessels} vessels · Company: No Select / All / ID`,
                            textOnly: true,
                        },
                        {
                            label: 'Select TVC_LAB (internal QA ship list)',
                            tag: 'B',
                            action: 'TVC_App.selectTvcLabInList()',
                        },
                        {
                            label: 'Contract SOP checklist (신규 / 선박추가 / 계약종료)',
                            tag: 'B',
                            action: 'TVC_App.openAdminSopModal()',
                        },
                        {
                            label: 'Print contract draft (선사·선박 → 계약서 초안)',
                            tag: 'B',
                            action: 'TVC_App.adminPrintContractDraft()',
                        },
                        {
                            label: 'Print contract registry (계약 선사·선박 목록)',
                            tag: 'B',
                            action: 'TVC_App.openAdminPrintRegistryModal()',
                        },
                        {
                            label: 'Add / edit company (registry)',
                            tag: 'B',
                            action: "TVC_App.openAdminCompanyForm('add')",
                        },
                        {
                            label: 'Add / edit vessel (registry)',
                            tag: 'B',
                            action: "TVC_App.openAdminVesselForm('add')",
                        },
                    ],
                },
            ];
        }
        const c = menuCounts();
        const isHq = state.user && TVC_RBAC.isHqAccount(state.user);
        const isMaster = state.user && TVC_Space.isCaptainHub(state.user);

        const shipDailyItems = [
            { label: 'Check Work Plan', tag: 'D', action: "TVC_App.menuAction('checkPlan')", badge: c.overdue, badgeTone: 'red' },
            { label: 'Work Permit (for Critical Equipment)', tag: 'C', action: "TVC_App.menuAction('workPermitList')" },
            { label: 'Confirm Work Report', tag: 'B', action: "TVC_App.menuAction('approveReport')", badge: c.pending, badgeTone: 'amber', feature: 'showApprovalQueue' },
            { label: 'Make Defect Report', tag: 'C', action: "TVC_App.menuAction('defectReport')", feature: 'showDefectReport' },
        ];
        const hqDailyItems = [
            { label: 'Work Permit (for Critical Equipment)', tag: 'C', action: "TVC_App.menuAction('workPermitList')" },
            { label: 'Approve Defect Report', tag: 'B', action: "TVC_App.menuAction('approveDefectReport')", badge: c.defectPending, badgeTone: 'amber' },
            { label: 'Approve Postpone Report', tag: 'B', action: "TVC_App.menuAction('approvePostponeReport')", badge: c.postponePending, badgeTone: 'amber' },
        ];
        const necessaryItems = menuNecessaryItems();

        if (isHq) {
            const hqMonthlyItems = [
                ...(runningHoursMenuVisible() ? [{ label: 'Check Running Hours', tag: 'C', action: "TVC_App.menuAction('runHour')" }] : []),
                { label: 'Approve Reports', tag: 'B', action: "TVC_App.menuAction('approveReports')", badge: c.reportsPending, badgeTone: 'amber' },
                    { label: 'Approve Work Plan', tag: 'B', action: "TVC_App.menuAction('approveOriginalPlan')" },
            ];
        return [
                { key: 'daily', tone: 'daily', title: 'Daily Tasks', items: hqDailyItems },
                { key: 'monthly', tone: 'monthly', title: 'Monthly Report', items: hqMonthlyItems },
                { key: 'necessary', tone: 'necessary', title: 'If Necessary', items: necessaryItems },
            ];
        }

        const shipMonthly = shipMonthlyReportItems(c);

        if (isMaster) {
            return [
                { key: 'daily', tone: 'daily', title: 'Daily Tasks', items: shipDailyItems },
                { key: 'monthly', tone: 'monthly', title: 'Monthly Report', items: hubMonthlyReportItems() },
                { key: 'necessary', tone: 'necessary', title: 'If Necessary', items: necessaryItems },
            ];
        }

        return [
            { key: 'daily', tone: 'daily', title: 'Daily Tasks', items: shipDailyItems },
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

    /** Confirmer (CE / Captain) Monthly Report: guide text + RH + Work Plan */
    function shipMonthlyReportItems(c) {
        const items = [];
        const isShipConfirmer = state.user
            && TVC_RBAC.isApprover(state.user)
            && !TVC_RBAC.isHqAccount(state.user);
        if (isShipConfirmer) {
            items.push({
                label: 'Check Work History (for Report Confirm)',
                textOnly: true,
            });
        }
        items.push(
            { label: 'Update Running Hours', tag: 'C', action: "TVC_App.menuAction('runHour')", feature: 'showRunningHours' },
            { label: 'Update Work Plan', tag: 'B', action: "TVC_App.menuAction('originalPlan')", badge: c.dueMonth, badgeTone: 'blue', planLock: true, feature: 'showUpdateWorkPlan' },
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
        const d = String(row?.direction || '');
        if (isMasterExcelHistoryRow(row)) return null;
        if (d.startsWith('DEFECT_') || d === 'DEFECT_IMPORT') return 'Defect Report';
        if (d.startsWith('WORK_PERMIT_') || d === 'WORK_PERMIT_IMPORT') return 'Work Permit';
        if (d.startsWith('POSTPONE_') || d === 'POSTPONE_IMPORT') return 'Postpone Report';
        if (d === 'VESSEL_PROFILE_HQ_TO_SHIP' || /vessel_profile/i.test(d)) return 'Vessel Profile';
        return 'Monthly Report';
    }

    function resetMenuXfer() {
        _menuXfer = {
            step: 'mode',
            importType: null, // workPermit | defect | postpone | monthly | vesselProfile
        };
        const body = document.getElementById('menuXferBody');
        if (body) {
            body._menuXferDefectBound = false;
            body._menuXferPostponeBound = false;
            body._menuXferWorkPermitBound = false;
        }
    }

    const MENU_IMPORT_TYPES = [
        { key: 'appUpdate', label: 'App Update' },
        { key: 'workPermit', label: 'Work Permit' },
        { key: 'defect', label: 'Defect Report' },
        { key: 'postpone', label: 'Postpone Report' },
        { key: 'monthly', label: 'Monthly Report' },
        { key: 'vesselProfile', label: 'Vessel Profile' },
    ];

    function menuImportTypesForUser(user) {
        const isHq = !!(user && TVC_RBAC.isHqAccount(user));
        const isAdmin = !!(user && TVC_RBAC.isAdminAccount?.(user));
        return MENU_IMPORT_TYPES.filter(t => {
            if (isAdmin) return t.key === 'appUpdate'; // Admin exports updates; import not used
            if (t.key === 'vesselProfile') return !isHq; // 선박 Mode만 Import
            return true;
        });
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
            return 'Import Engine/Deck station ZIP (match toggle) or HQ reply. Export to HQ — Update Work Plan is not required on Master Hub.';
        }
        if (ctx === 'hq') {
            return 'Import vessel ZIP (station export or Master report). Engine/Deck toggle must match file. HQ reply → Master or station direct.';
        }
        return 'Default transfer: offline ZIP.';
    }

    function menuXferOnlineSyncHtml(user) {
        const f = typeof TVC_Space !== 'undefined' ? TVC_Space.getUiFeatures(user) : {};
        if (!f.showOnlineSync || typeof TVC_OnlineSync === 'undefined') return '';
        const online = TVC_OnlineSync.isAvailable();
        const msg = TVC_OnlineSync.statusMessage();
        const dir = TVC_RBAC.isHqAccount(user) ? 'HQ_PULL' : 'SHIP_TO_HQ';
        const label = TVC_RBAC.isHqAccount(user) ? 'Pull from vessel (online)' : 'Push to HQ (online)';
        return `
            <div class="menu-xfer-online${online ? '' : ' menu-xfer-online-disabled'}">
                <p class="spare-sync-note muted">${esc(msg)}</p>
                <button type="button" class="btn spare-sync-btn${online ? '' : ' disabled'}"${online ? '' : ' disabled'}
                    onclick="TVC_App.menuXferTryOnlineSync('${escAttr(dir)}')">${esc(label)}</button>
            </div>`;
    }

    async function menuXferTryOnlineSync(direction) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || typeof TVC_OnlineSync === 'undefined') return;
        try {
            const vesselId = TVC_RBAC.isHqAccount(user) ? state.selectedVesselId : undefined;
            const result = await TVC_OnlineSync.syncNow(user, direction, { vesselId });
            await TVC_Dialog.alert(result.message || (result.status === 'SCAFFOLD'
                ? 'Online sync is scaffolded — use offline ZIP for now.'
                : 'Online sync request completed.'));
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

    function menuXferExportTargetLabel(target) {
        if (target === 'COMPANY') return 'Company (HQ)';
        const user = state.user;
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

    function menuXferDefectRowSelectable(row) {
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (TVC_DefectCase.isHqReplyExported(row)) return false;
            const shipSubmitted = !!(row.confirmed_at || row.confirmed_by || row.submitted_at || row.phase1_locked
                || row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY);
            return shipSubmitted;
        }
        const st = TVC_DefectCase.listWorkflowStatus(row);
        if (st === 'Confirmed') return true;
        if (row.defect_cleared && String(row.ship_verified_date || '').trim()
            && (row.approved_at || st === 'Approved')) return true;
        return false;
    }

    function menuXferDefectSelectDisabledTitle(row) {
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (TVC_DefectCase.isHqReplyExported(row)) return 'HQ reply already exported';
            const shipSubmitted = !!(row.confirmed_at || row.confirmed_by || row.submitted_at || row.phase1_locked
                || row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY);
            if (!shipSubmitted) return 'Awaiting ship submission';
            return 'Not exportable';
        }
        const st = TVC_DefectCase.listWorkflowStatus(row);
        if (st === 'Submitted') return 'Already exported (Submitted)';
        if (st === 'Approved') return 'Approved — not exportable here';
        if (st === 'Draft') return 'Draft — not in list workflow';
        if (st === 'Reported') return 'Reported — confirm first';
        return 'Not exportable';
    }

    const MENU_XFER_EXPORT_COLSPAN = 10;

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
            <p class="spare-sync-hint">Check the defect reports to export → <strong>${esc(dest)}</strong> (Confirmed only)</p>
            <p class="spare-sync-note muted">${rows.length} in list · ${selectable.length} selectable (Confirmed, not yet Submitted). Same scope as Work History / Defect tab.</p>
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

    function stationPendingConfirmedReportCount(dept) {
        const target = dept || getPlanLockDept();
        return (state.reports || []).filter(r =>
            r.sync_status !== 'SYNCED'
            && reportDept(r) === target
            && workReportListWorkflowStatus(r) === 'Confirmed'
        ).length;
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

    function menuXferConfirmedExportReadyHtml(opts) {
        const {
            title, count, dest, exportAction, selectAction, emptyMsg, note,
        } = opts;
        const exportLabel = count
            ? `Export (${count} confirmed)`
            : 'Export';
        return `
            <p class="spare-sync-hint">Export <strong>${esc(title)}</strong></p>
            <p class="muted">Destination: <strong>${esc(dest)}</strong></p>
            ${count
                ? `<p class="spare-sync-note">Ready to send: <strong>${count}</strong> confirmed item(s).</p>`
                : `<p class="menu-xfer-block-msg">${esc(emptyMsg)}</p>`}
            ${note ? `<p class="spare-sync-note muted">${esc(note)}</p>` : ''}
            <div class="spare-sync-actions">
                <button type="button" class="btn btn-green spare-sync-btn"${count ? '' : ' disabled'} onclick="${exportAction}">${esc(exportLabel)}</button>
                ${selectAction ? `<button type="button" class="btn spare-sync-btn" onclick="${selectAction}">Select individually…</button>` : ''}
            </div>`;
    }

    function menuXferDefectReadyHtml() {
        const dept = getPlanLockDept();
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'defect'));
        const count = stationPendingConfirmedDefectCount(dept);
        return menuXferConfirmedExportReadyHtml({
            title: 'Defect Report',
            count,
            dest,
            exportAction: 'TVC_App.menuXferConfirmDefectExportAll()',
            selectAction: 'TVC_App.menuXferOpenDefectSelect()',
            emptyMsg: 'No confirmed defect reports pending export.',
            note: 'Confirm defect reports in Work History first.',
        });
    }

    function menuXferPostponeReadyHtml() {
        const dept = getPlanLockDept();
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'postpone'));
        const count = stationPendingConfirmedPostponeCount(dept);
        return menuXferConfirmedExportReadyHtml({
            title: 'Postpone Report',
            count,
            dest,
            exportAction: 'TVC_App.menuXferConfirmPostponeExportAll()',
            selectAction: 'TVC_App.menuXferOpenPostponeSelect()',
            emptyMsg: 'No confirmed postpone reports pending export.',
            note: 'Critical equipment postpone reports only.',
        });
    }

    function menuXferWorkPermitReadyHtml() {
        const dept = getPlanLockDept();
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'workPermit'));
        const count = stationPendingConfirmedWorkPermitCount(dept);
        return menuXferConfirmedExportReadyHtml({
            title: 'Work Permit',
            count,
            dest,
            exportAction: 'TVC_App.menuXferConfirmWorkPermitExportAll()',
            selectAction: 'TVC_App.menuXferOpenWorkPermitSelect()',
            emptyMsg: 'No confirmed Work Permits pending export.',
            note: 'Confirm Work Permits in the list before export.',
        });
    }

    /** Station: delta until Update Work Plan lock; then full monthly snapshot. HQ/Master: always snapshot. */
    function monthlyExportUsesSnapshot(user, dept) {
        if (TVC_RBAC.isHqAccount(user) || isMasterHubMode()) return true;
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)) {
            return isOriginalPlanUpdateLocked(dept || getPlanLockDept());
        }
        return true;
    }

    function menuXferMonthlyReadyHtml() {
        const dept = getPlanLockDept();
        const locked = isOriginalPlanUpdateLocked(dept);
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'monthly'));
        const isStation = typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(state.user);
        const pendingConfirmed = isStation ? stationPendingConfirmedReportCount(dept) : 0;
        if (isStation && !locked && !TVC_RBAC.isHqAccount(state.user) && !isMasterHubMode()) {
            const exportLabel = pendingConfirmed
                ? `Export pending changes (${pendingConfirmed} confirmed report${pendingConfirmed === 1 ? '' : 's'})`
                : 'Export';
            return `
                <p class="spare-sync-hint">Export <strong>confirmed Work Reports</strong> to Master Hub</p>
                <p class="muted">Destination: <strong>${esc(dest)}</strong></p>
                ${pendingConfirmed
                    ? `<p class="spare-sync-note">Ready to send: <strong>${pendingConfirmed}</strong> confirmed report(s) not yet Submitted.</p>`
                    : `<p class="menu-xfer-block-msg">No confirmed reports pending export.</p>
                       <p class="spare-sync-note muted">Confirm Work Report in Work History first, then return here.</p>`}
                <p class="spare-sync-note muted">End-of-month <strong>Monthly Report</strong> (full department snapshot) requires <strong>Update Work Plan</strong> first.</p>
                <div class="spare-sync-actions">
                    <button type="button" id="menuXferMonthlyExportBtn" class="btn btn-green spare-sync-btn"${pendingConfirmed ? '' : ' disabled'} onclick="TVC_App.menuXferConfirmMonthlyExport()">${esc(exportLabel)}</button>
                </div>`;
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
        return `
            <p class="spare-sync-hint">Export <strong>Monthly Report</strong></p>
            ${summary}
            <div class="spare-sync-actions">
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
        return workReportListWorkflowStatus(row) === 'Confirmed';
    }

    function menuXferPostponeSelectDisabledTitle(row) {
        const st = workReportListWorkflowStatus(row);
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (st === 'Submitted') return 'Reply already exported';
            if (st === 'Confirmed') return 'Approve in app before reply export';
            if (st === 'Reported') return 'Reported — confirm first';
            return 'Not exportable';
        }
        if (st === 'Submitted') return 'Already exported (Submitted)';
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
            tableBody = `<tr><td colspan="${MENU_XFER_EXPORT_COLSPAN}" class="muted menu-xfer-empty">No critical postpone reports in scope for ${esc(dest)}.</td></tr>`;
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
            ? 'Select <strong>Approved</strong> critical postpone reports to export reply → Ship'
            : `Select <strong>Confirmed</strong> critical postpone reports to export → <strong>${esc(dest)}</strong>`;
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
        return TVC_WorkPermit.listWorkflowStatus(row) === 'Confirmed';
    }

    function menuXferWorkPermitSelectDisabledTitle(row) {
        const st = TVC_WorkPermit.listWorkflowStatus(row);
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (st === 'Submitted') return 'Reply already exported';
            if (st === 'Confirmed') return 'Approve in app before reply export';
            if (st === 'Reported') return 'Reported — confirm first';
            return 'Not exportable';
        }
        if (st === 'Submitted') return 'Already exported (Submitted)';
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

    function renderMenuXferModal() {
        const body = document.getElementById('menuXferBody');
        if (!body) return;
        const step = _menuXfer.step || 'mode';
        const modalBox = document.querySelector('#menuXferModal .modal-box');
        if (modalBox) modalBox.classList.toggle('menu-xfer-wide', step === 'export-defect-select' || step === 'export-postpone-select' || step === 'export-work-permit-select');
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
                ? 'After Confirm: export Work Permit / Defect / Postpone / Monthly Report. Full monthly snapshot requires Update Work Plan first.'
                : ctx === 'master'
                    ? 'Monthly Report exports aggregated vessel data to Company (HQ). Import Engine/Deck station ZIPs on Master first.'
                    : isHq
                        ? 'Vessel Profile sends identity (name, IMO, delivery…) to the ship. PMS/SPARE Master remains separate Excel.'
                        : '';
            content = `
                <p class="spare-sync-hint">Select the report type to export.</p>
                ${exportNote ? `<p class="spare-sync-note muted">${esc(exportNote)}</p>` : ''}
                <div class="spare-sync-actions">
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickExportType('workPermit')">Work Permit</button>
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickExportType('defect')">Defect Report</button>
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickExportType('postpone')">Postpone Report</button>
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickExportType('monthly')">Monthly Report</button>
                    ${isHq ? `<button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickExportType('vesselProfile')">Vessel Profile</button>` : ''}
                </div>`;
        } else if (step === 'export-work-permit-select') {
            content = menuXferWorkPermitSelectHtml();
        } else if (step === 'export-work-permit-ready') {
            content = menuXferWorkPermitReadyHtml();
        } else if (step === 'export-defect-select') {
            content = menuXferDefectSelectHtml();
        } else if (step === 'export-defect-ready') {
            content = menuXferDefectReadyHtml();
        } else if (step === 'export-postpone-select') {
            content = menuXferPostponeSelectHtml();
        } else if (step === 'export-postpone-ready') {
            content = menuXferPostponeReadyHtml();
        } else if (step === 'export-monthly-ready') {
            content = menuXferMonthlyReadyHtml();
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
                <p class="spare-sync-note muted">App Update / Work Permit / Defect / Postpone / Vessel Profile: <strong>.zip</strong> · Monthly: <strong>.zip / .json / .csv</strong>. App Update never changes PMS/SPARE Master or Work History.</p>
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
                : step === 'export-work-permit-ready' ? '3. Export — Work Permit'
                : step === 'export-work-permit-select' ? '3. Export — select work permits'
                : step === 'export-defect-ready' ? '3. Export — Defect Report'
                : step === 'export-defect-select' ? '3. Export — select defects'
                : step === 'export-postpone-ready' ? '3. Export — Postpone Report'
                    : step === 'export-postpone-select' ? '3. Export — select postpone reports'
                        : step === 'export-monthly-ready' ? '3. Export — monthly report'
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
        if (step === 'export-defect-select') bindMenuXferDefectTableEvents();
        if (step === 'export-postpone-select') bindMenuXferPostponeTableEvents();
        if (step === 'export-work-permit-select') bindMenuXferWorkPermitTableEvents();
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
        if (TVC_RBAC.isAdminAccount?.(state.user)) {
            _menuXfer.step = 'export-app-update';
            _menuXfer.mode = 'export';
            _menuXfer.appUpdateSkus = {
                HQ_OFFICE: true,
                VESSEL_ENGINE: true,
                VESSEL_DECK: true,
                VESSEL_MASTER: false,
            };
            _menuXfer.appUpdateFiles = {};
            _menuXfer.appUpdateCompanyId = state.selectedAdminCompanyId || null;
            _menuXfer.appUpdateRecordDeploy = true;
            try {
                if (typeof TVC_AppUpdate?.resolveAppVersion === 'function') {
                    _menuXfer.appUpdateVersion = await TVC_AppUpdate.resolveAppVersion();
                } else {
                    _menuXfer.appUpdateVersion = await resolveAppVersion();
                }
            } catch (_) {
                _menuXfer.appUpdateVersion = '1.0.1';
            }
        }
        renderMenuXferModal();
        showModal('menuXferModal');
    }

    function closeMenuXferMenu() {
        closeModal('menuXferModal');
        resetMenuXfer();
    }

    function menuXferPickMode(mode) {
        _menuXfer.mode = mode;
        if (TVC_RBAC.isAdminAccount?.(state.user) && mode === 'export') {
            _menuXfer.step = 'export-app-update';
        } else {
            _menuXfer.step = mode === 'export' ? 'export-type' : 'import';
        }
        if (mode === 'import') _menuXfer.importType = null;
        renderMenuXferModal();
    }

    function menuXferBack() {
        const isStation = typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(state.user);
        if (_menuXfer.step === 'export-defect-select' && isStation) {
            _menuXfer.step = 'export-defect-ready';
            delete _menuXfer.selectedDefectIds;
            delete _menuXfer.defectSearch;
        } else if (_menuXfer.step === 'export-postpone-select' && isStation) {
            _menuXfer.step = 'export-postpone-ready';
            delete _menuXfer.selectedPostponeIds;
            delete _menuXfer.postponeSearch;
        } else if (_menuXfer.step === 'export-work-permit-select' && isStation) {
            _menuXfer.step = 'export-work-permit-ready';
            delete _menuXfer.selectedWorkPermitIds;
            delete _menuXfer.workPermitSearch;
        } else if (_menuXfer.step === 'export-defect-ready' || _menuXfer.step === 'export-postpone-ready'
            || _menuXfer.step === 'export-work-permit-ready'
            || _menuXfer.step === 'export-defect-select' || _menuXfer.step === 'export-postpone-select'
            || _menuXfer.step === 'export-work-permit-select' || _menuXfer.step === 'export-monthly-ready'
            || _menuXfer.step === 'export-vessel-profile-ready') {
            _menuXfer.step = 'export-type';
            delete _menuXfer.selectedDefectIds;
            delete _menuXfer.selectedPostponeIds;
            delete _menuXfer.selectedWorkPermitIds;
            delete _menuXfer.defectSearch;
            delete _menuXfer.postponeSearch;
            delete _menuXfer.workPermitSearch;
        } else if (_menuXfer.step === 'import-vessel-profile-preview' || _menuXfer.step === 'import-app-update-preview') {
            _menuXfer.step = 'import';
            delete _menuXfer.vesselProfilePending;
            delete _menuXfer.appUpdatePending;
        } else if (_menuXfer.step === 'export-app-update') {
            if (TVC_RBAC.isAdminAccount?.(state.user)) return;
            _menuXfer.step = 'mode';
        } else if (_menuXfer.step === 'export-type' || _menuXfer.step === 'import') {
            _menuXfer.step = 'mode';
            _menuXfer.importType = null;
            delete _menuXfer.vesselProfilePending;
            delete _menuXfer.appUpdatePending;
        }
        renderMenuXferModal();
    }

    function menuXferSelectImportType(key) {
        const k = String(key || '');
        if (!MENU_IMPORT_TYPES.some(t => t.key === k)) return;
        _menuXfer.importType = _menuXfer.importType === k ? null : k;
        renderMenuXferModal();
    }

    async function menuXferPickExportType(type) {
        _menuXfer.exportType = type;
        const isStation = typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(state.user);
        if (type === 'workPermit') {
            _menuXfer.step = isStation ? 'export-work-permit-ready' : 'export-work-permit-select';
            _menuXfer.selectedWorkPermitIds = {};
            _menuXfer.workPermitSearch = '';
            _menuXfer.exportFilenameLookup = await buildMenuXferExportFilenameLookup('workPermit');
        } else if (type === 'defect') {
            _menuXfer.step = isStation ? 'export-defect-ready' : 'export-defect-select';
            _menuXfer.selectedDefectIds = {};
            _menuXfer.defectSearch = '';
            _menuXfer.exportFilenameLookup = await buildMenuXferExportFilenameLookup('defect');
        } else if (type === 'postpone') {
            _menuXfer.step = isStation ? 'export-postpone-ready' : 'export-postpone-select';
            _menuXfer.selectedPostponeIds = {};
            _menuXfer.postponeSearch = '';
            _menuXfer.exportFilenameLookup = await buildMenuXferExportFilenameLookup('postpone');
        } else if (type === 'vesselProfile') {
            _menuXfer.step = 'export-vessel-profile-ready';
            delete _menuXfer.exportFilenameLookup;
        } else {
            _menuXfer.step = 'export-monthly-ready';
            delete _menuXfer.exportFilenameLookup;
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
                : '1.0.1');
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
        return `
            <p class="spare-sync-hint">App Update <strong>v${esc(m.app_version || '—')}</strong></p>
            <p class="spare-sync-note muted">Operational data (PMS/SPARE Master, Work History) is <strong>not</strong> modified. Only the application installer runs.</p>
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
            await TVC_Dialog.alert('Vessel Profile Export는 HQ Mode에서만 가능합니다.');
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

    async function menuXferOpenDefectSelect() {
        _menuXfer.step = 'export-defect-select';
        _menuXfer.selectedDefectIds = {};
        _menuXfer.defectSearch = '';
        if (!_menuXfer.exportFilenameLookup) {
            _menuXfer.exportFilenameLookup = await buildMenuXferExportFilenameLookup('defect');
        }
        menuXferDefectExportRows().filter(menuXferDefectRowSelectable).forEach(row => {
            _menuXfer.selectedDefectIds[row.id] = true;
        });
        renderMenuXferModal();
    }

    async function menuXferOpenPostponeSelect() {
        _menuXfer.step = 'export-postpone-select';
        _menuXfer.selectedPostponeIds = {};
        _menuXfer.postponeSearch = '';
        if (!_menuXfer.exportFilenameLookup) {
            _menuXfer.exportFilenameLookup = await buildMenuXferExportFilenameLookup('postpone');
        }
        menuXferPostponeExportRows().filter(menuXferPostponeRowSelectable).forEach(row => {
            _menuXfer.selectedPostponeIds[row.id] = true;
        });
        renderMenuXferModal();
    }

    async function menuXferOpenWorkPermitSelect() {
        _menuXfer.step = 'export-work-permit-select';
        _menuXfer.selectedWorkPermitIds = {};
        _menuXfer.workPermitSearch = '';
        if (!_menuXfer.exportFilenameLookup) {
            _menuXfer.exportFilenameLookup = await buildMenuXferExportFilenameLookup('workPermit');
        }
        menuXferWorkPermitExportRows().filter(menuXferWorkPermitRowSelectable).forEach(row => {
            _menuXfer.selectedWorkPermitIds[row.id] = true;
        });
        renderMenuXferModal();
    }

    async function menuXferConfirmDefectExportAll() {
        const ids = menuXferDefectExportRows().filter(menuXferDefectRowSelectable).map(r => r.id);
        if (!ids.length) {
            await TVC_Dialog.alert('No confirmed defect reports ready to export.');
            return;
        }
        _menuXfer.selectedDefectIds = Object.fromEntries(ids.map(id => [id, true]));
        await menuXferConfirmDefectExport();
    }

    async function menuXferConfirmPostponeExportAll() {
        const ids = menuXferPostponeExportRows().filter(menuXferPostponeRowSelectable).map(r => r.id);
        if (!ids.length) {
            await TVC_Dialog.alert('No confirmed postpone reports ready to export.');
            return;
        }
        _menuXfer.selectedPostponeIds = Object.fromEntries(ids.map(id => [id, true]));
        await menuXferConfirmPostponeExport();
    }

    async function menuXferConfirmWorkPermitExportAll() {
        const ids = menuXferWorkPermitExportRows().filter(menuXferWorkPermitRowSelectable).map(r => r.id);
        if (!ids.length) {
            await TVC_Dialog.alert('No confirmed Work Permits ready to export.');
            return;
        }
        _menuXfer.selectedWorkPermitIds = Object.fromEntries(ids.map(id => [id, true]));
        await menuXferConfirmWorkPermitExport();
    }

    async function menuXferConfirmDefectExport() {
        const ids = Object.keys(_menuXfer.selectedDefectIds || {}).filter(id => _menuXfer.selectedDefectIds[id]);
        if (!ids.length) await TVC_Dialog.alert('Select at least one Confirmed defect to export.');
        const selectable = new Set(menuXferDefectExportRows().filter(menuXferDefectRowSelectable).map(r => r.id));
        const scopedIds = ids.filter(id => selectable.has(id));
        if (!scopedIds.length) await TVC_Dialog.alert('No selected defect reports are exportable (Confirmed, not yet Submitted).');
        const target = menuXferResolveExportTarget(state.user, 'defect');
        if (!target || !menuXferCanExportTarget(state.user, target)) {
            await TVC_Dialog.alert('No permission to export defect reports.');
        }
        const destLabel = menuXferExportTargetLabel(target);
        if (!await TVC_Dialog.confirm({ kind: 'confirm', message: `Export ${scopedIds.length} defect report(s) to ${destLabel}?` })) return;
        closeMenuXferMenu();
        try {
            await menuXferExportDefect(target, scopedIds);
        } catch (e) { await TVC_Dialog.alert(e.message || e); }
    }

    async function menuXferConfirmMonthlyExport() {
        const dept = getPlanLockDept();
        const isStation = typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(state.user);
        const locked = isOriginalPlanUpdateLocked(dept);
        if (isStation && !locked && !TVC_RBAC.isHqAccount(state.user) && !isMasterHubMode()) {
            if (stationPendingConfirmedReportCount(dept) === 0) {
                await TVC_Dialog.alert('No confirmed Work Reports ready to export.\n\nConfirm reports in Work History first.');
                return;
            }
        } else if (!TVC_RBAC.isHqAccount(state.user) && !isMasterHubMode() && !locked) {
            await TVC_Dialog.alert('Update Work Plan must be completed first.');
            return;
        }
        const target = menuXferResolveExportTarget(state.user, 'monthly');
        if (!target || !menuXferCanExportTarget(state.user, target)) {
            await TVC_Dialog.alert('No permission to export monthly report.');
            return;
        }
        const destLabel = menuXferExportTargetLabel(target);
        const user = state.user;
        const snapshot = monthlyExportUsesSnapshot(user, dept);
        const confirmMsg = snapshot
            ? `Export Monthly Report to ${destLabel}?`
            : `Export confirmed Work Reports (pending changes) to ${destLabel}?`;
        if (!await TVC_Dialog.confirm({ message: confirmMsg })) return;
        closeMenuXferMenu();
        try {
            await menuXferExportMonthly(target);
        } catch (e) { await TVC_Dialog.alert(e.message || e); }
    }

    function defectCasesForExportTarget(cases, target) {
        if (target === 'COMPANY') return cases;
        return (cases || []).filter(c => String(c.department || '').toUpperCase() === target);
    }

    async function menuXferExportMonthly(target) {
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
        const monthlyOpts = { monthlyExport: snapshot };
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)) {
            TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.STATION_EXPORT);
            await TVC_Sync.exportZip(user, TVC_Space.Direction.STATION_TO_HUB, dept, {
                station_id: TVC_Space.getStation(user),
                ...monthlyOpts,
            });
        } else {
            const direction = TVC_RBAC.isHqAccount(user) ? 'HQ_TO_SHIP' : 'SHIP_TO_HQ';
            await TVC_Sync.exportZip(user, direction, dept, monthlyOpts);
        }
        await refreshAll();
        if (state.currentTab === 'menu') renderSyncHistory();
        const kind = snapshot ? 'Monthly Report' : 'pending changes';
        await TVC_Dialog.alert(`${TVC_RBAC.getDeptLabel(dept)} ${kind} exported to Master Hub.`);
    }

    async function exportSelectedDefectCase(user, caseRow) {
        if (TVC_RBAC.isHqAccount(user)) {
            if (TVC_DefectCase.isHqReplyExported(caseRow)) {
                throw new Error(`${caseRow.case_no}: HQ reply already exported.`);
            }
            const v = TVC_DefectCase.validateHqDefectReplyExport(caseRow);
            if (!v.ok) {
                throw new Error(`${caseRow.case_no}: ${v.missing.join(', ')} required before HQ export.`);
            }
            await TVC_DefectSync.exportHqReplyZip(user, caseRow.id);
            return;
        }
        const clearedReady = !!caseRow.defect_cleared
            && !!String(caseRow.ship_verified_date || '').trim()
            && !!(caseRow.approved_at || caseRow.approved_by);
        if (clearedReady || caseRow.status === TVC_DefectCase.Status.AWAITING_COMPLETION) {
            if (caseRow.status !== TVC_DefectCase.Status.AWAITING_COMPLETION) {
                const row = await TVC_DefectCaseService.get(caseRow.id) || caseRow;
                row.status = TVC_DefectCase.Status.AWAITING_COMPLETION;
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
            throw new Error(`${caseRow.case_no}: only Confirmed cases can be exported.`);
        }
        if (caseRow.status === TVC_DefectCase.Status.WORK_IN_PROGRESS) {
            throw new Error(`${caseRow.case_no}: complete defect clearance before export.`);
        }
        await TVC_DefectSync.exportUrgentBatchZip(user, [caseRow.id]);
    }

    async function menuXferExportDefect(target, selectedIds) {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        const ids = (selectedIds || []).filter(Boolean);
        if (!ids.length) throw new Error('No defect reports selected.');

        const allCases = state.defectCases || [];
        const selected = ids.map(id => allCases.find(c => c.id === id)).filter(Boolean);
        const scoped = defectCasesForExportTarget(selected, target);
        if (!scoped.length) throw new Error('No selected defect reports match this destination.');

        if (TVC_RBAC.isHqAccount(user)) {
            const scopedIds = scoped.map(c => c.id);
            const result = await TVC_DefectSync.exportHqReplyBatchZip(user, scopedIds);
            await refreshAll();
            if (state.currentTab === 'menu') {
                renderSyncHistory();
                TVC_DefectReport?.renderInbox?.();
            }
            if (state.currentTab === 'history') renderWorkHistory();
            const dest = target === 'COMPANY' ? 'Company' : TVC_RBAC.getDeptLabel(target);
            await TVC_Dialog.alert(`Exported ${result.count} defect report(s) in 1 package (${result.filename}) → ${dest}.`);
            return;
        }

        const urgentRows = [];
        const completionRows = [];
        for (const c of scoped) {
            const clearedReady = !!c.defect_cleared
                && !!String(c.ship_verified_date || '').trim()
                && !!(c.approved_at || c.approved_by);
            if (clearedReady || c.status === TVC_DefectCase.Status.AWAITING_COMPLETION) {
                completionRows.push(c);
            } else {
                urgentRows.push(c);
            }
        }
        if (urgentRows.length && completionRows.length) {
            throw new Error('Select either Confirmed defect reports or completion reports, not both.');
        }

        if (urgentRows.length) {
            const result = await TVC_DefectSync.exportUrgentBatchZip(user, urgentRows.map(c => c.id));
            await refreshAll();
            if (state.currentTab === 'menu') {
                renderSyncHistory();
                TVC_DefectReport?.renderInbox?.();
            }
            if (state.currentTab === 'history') renderWorkHistory();
            const dest = target === 'COMPANY' ? 'Company' : TVC_RBAC.getDeptLabel(target);
            await TVC_Dialog.alert(`Exported ${result.count} defect report(s) in 1 package (${result.filename}) → ${dest}.`);
            return;
        }

        let exported = 0;
        for (const c of completionRows) {
            await exportSelectedDefectCase(user, c);
            exported++;
        }
        if (!exported) throw new Error('No Confirmed defect reports ready to export.');

        await refreshAll();
        if (state.currentTab === 'menu') {
            renderSyncHistory();
            TVC_DefectReport?.renderInbox?.();
        }
        if (state.currentTab === 'history') renderWorkHistory();
        const dest = target === 'COMPANY' ? 'Company' : TVC_RBAC.getDeptLabel(target);
        await TVC_Dialog.alert(`Exported ${exported} defect package(s) → ${dest}.`);
    }

    async function menuXferConfirmPostponeExport() {
        const ids = Object.keys(_menuXfer.selectedPostponeIds || {}).filter(id => _menuXfer.selectedPostponeIds[id]);
        if (!ids.length) await TVC_Dialog.alert('Select at least one exportable postpone report.');
        const selectable = new Set(menuXferPostponeExportRows().filter(menuXferPostponeRowSelectable).map(r => r.id));
        const scopedIds = ids.filter(id => selectable.has(id));
        if (!scopedIds.length) await TVC_Dialog.alert('No selected postpone reports are exportable.');
        const target = menuXferResolveExportTarget(state.user, 'postpone');
        if (!target || !menuXferCanExportTarget(state.user, target)) {
            await TVC_Dialog.alert('No permission to export postpone reports.');
        }
        const destLabel = menuXferExportTargetLabel(target);
        const action = TVC_RBAC.isHqAccount(state.user) ? 'reply export' : 'export';
        if (!await TVC_Dialog.confirm({ message: `${action} ${scopedIds.length} postpone report(s) to ${destLabel}?` })) return;
        closeMenuXferMenu();
        try {
            await menuXferExportPostpone(target, scopedIds);
        } catch (e) { await TVC_Dialog.alert(e.message || e); }
    }

    async function exportSelectedPostponeReport(user, reportRow) {
        if (TVC_RBAC.isHqAccount(user)) {
            if (workReportListWorkflowStatus(reportRow) !== 'Approved') {
                throw new Error(`${reportRow.job_code}: only Approved reports can be reply-exported.`);
            }
            await TVC_PostponeSync.exportHqReplyZip(user, reportRow.id);
            return;
        }
        if (workReportListWorkflowStatus(reportRow) !== 'Confirmed') {
            throw new Error(`${reportRow.job_code}: only Confirmed reports can be exported.`);
        }
        await TVC_PostponeSync.exportRequestZip(user, reportRow.id);
    }

    async function menuXferExportPostpone(target, selectedIds) {
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
        await TVC_Dialog.alert(`Exported ${exported} postpone ${kind} package(s) → ${dest}.`);
    }

    async function menuXferConfirmWorkPermitExport() {
        const ids = Object.keys(_menuXfer.selectedWorkPermitIds || {}).filter(id => _menuXfer.selectedWorkPermitIds[id]);
        if (!ids.length) await TVC_Dialog.alert('Select at least one exportable Work Permit.');
        const selectable = new Set(menuXferWorkPermitExportRows().filter(menuXferWorkPermitRowSelectable).map(r => r.id));
        const scopedIds = ids.filter(id => selectable.has(id));
        if (!scopedIds.length) await TVC_Dialog.alert('No selected Work Permits are exportable.');
        const target = menuXferResolveExportTarget(state.user, 'workPermit');
        if (!target || !menuXferCanExportTarget(state.user, target)) {
            await TVC_Dialog.alert('No permission to export Work Permits.');
        }
        const destLabel = menuXferExportTargetLabel(target);
        const action = TVC_RBAC.isHqAccount(state.user) ? 'reply export' : 'export';
        if (!await TVC_Dialog.confirm({ message: `${action} ${scopedIds.length} Work Permit(s) to ${destLabel}?` })) return;
        closeMenuXferMenu();
        try {
            await menuXferExportWorkPermit(target, scopedIds);
        } catch (e) { await TVC_Dialog.alert(e.message || e); }
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
            throw new Error(`${row.permit_no || row.job_code}: only Confirmed permits can be exported.`);
        }
        await TVC_WorkPermitSync.exportRequestZip(user, row.id);
    }

    async function menuXferExportWorkPermit(target, selectedIds) {
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
        await TVC_Dialog.alert(`Exported ${result.count} Work Permit(s) in 1 package (${result.filename}) → ${dest} ${kind}.`);
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
                        await handleHubImport(file);
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
                        'Engine/Deck station export ZIP은 Master Mode 또는 HQ Mode(해당 부서 토글)에서 Import하세요. ' +
                        'Engine export는 Deck Mode에 반영되지 않습니다.'
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
            await handleHubImport(file);
            return;
        }
        const run = async (dept) => {
            state._pendingImportDept = dept;
            await handleImport(file);
        };
        if (user.department) {
            await run(user.department);
        } else if (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)) {
            await run(requireAppDepartment());
        } else {
            pickDepartmentThen('Import할 부서를 선택하세요 (DECK / ENGINE)', run);
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
                workPermit: 'WORK_PERMIT',
                defect: 'DEFECT',
                postpone: 'POSTPONE',
                monthly: 'MONTHLY',
                vesselProfile: 'VESSEL_PROFILE',
            }[selected];
            if (expected && detected !== expected) {
                const labels = {
                    APP_UPDATE: 'App Update',
                    WORK_PERMIT: 'Work Permit',
                    DEFECT: 'Defect Report',
                    POSTPONE: 'Postpone Report',
                    MONTHLY: 'Monthly Report',
                    VESSEL_PROFILE: 'Vessel Profile',
                };
                throw new Error(
                    `선택한 유형(${labels[expected]})과 파일 유형(${labels[detected] || detected})이 일치하지 않습니다.`
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
            if (selected === 'workPermit') {
                await handleWorkPermitImport(file);
            } else if (selected === 'defect') {
                await handleDefectImport(file);
            } else if (selected === 'postpone') {
                await handlePostponeImport(file);
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
            throw new Error('Vessel Profile Import는 선박 Mode에서만 가능합니다.');
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
        if (kind === 'hq') return 'HQ Mode — vessel(Master)과 Export / Import 이력을 표시합니다.';
        if (kind === 'hub') return 'Hub (Captain) — Engine/Deck Station · Company(HQ)와 Export / Import 이력을 표시합니다.';
        if (kind === 'station') {
            return '확인자 — 주로 Master와 Export / Import합니다. Master PC 장애 시 Company(HQ) 패키지도 기록됩니다.';
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
        if (label === 'Work Permit') return 'workPermit';
        if (label === 'Defect Report') return 'defect';
        if (label === 'Postpone Report') return 'postpone';
        if (label === 'Vessel Profile') return null;
        return 'monthly';
    }

    function menuHistCategoryLabel(key) {
        return {
            workPermit: 'Work Permit',
            defect: 'Defect Report',
            postpone: 'Postpone Report',
            monthly: 'Monthly Report',
        }[key] || 'Monthly Report';
    }

    async function openMenuHistoryModal() {
        if (!_menuHistCategory) _menuHistCategory = 'defect';
        await renderMenuHistoryModal();
        showModal('menuHistoryModal');
    }

    function closeMenuHistoryModal() {
        closeModal('menuHistoryModal');
    }

    async function setMenuHistCategory(key) {
        _menuHistCategory = ['workPermit', 'postpone', 'monthly'].includes(key) ? key : 'defect';
        await renderMenuHistoryModal();
    }

    async function renderMenuHistoryModal() {
        const body = document.getElementById('menuHistoryBody');
        if (!body) return;
        const user = state.user;
        const all = await loadSyncHistoryRows();
        const cat = _menuHistCategory || 'defect';
        const rows = all.filter(r => menuHistCategoryKey(r) === cat && !isMasterExcelHistoryRow(r));
        const tabs = ['workPermit', 'defect', 'postpone', 'monthly'].map(key => `
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
            const tip = esc(opts.disabledTitle || 'Original Plan Update는 현재 사용할 수 없습니다.');
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

    function renderMenuCards(host) {
        if (!host) return;
        const f = state.user ? TVC_Space.getUiFeatures(state.user) : {};
        if (TVC_RBAC.isAdminAccount?.(state.user)) {
            const cols = menuModel();
            host.innerHTML = renderAdminHomePanel()
                + `<div class="tvc-admin-menu-grid">${renderMenuFlowPanel(cols, f)}</div>`;
            return;
        }
        host.innerHTML = renderSectionCard('PMS Work Flow', renderMenuFlowPanel(menuModel(), f), {
            className: 'tvc-section-pms-flow',
        });
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
                ? ' — TVC Lab' : '';
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
                        <td style="padding:4px 8px">${esc(vessel ? vessel.name : '—')}</td></tr>
                    <tr><th style="text-align:left;padding:4px 8px">IMO</th>
                        <td style="padding:4px 8px">${esc(vessel?.imo_no || '—')}</td></tr>
                    <tr><th style="text-align:left;padding:4px 8px">Delivery</th>
                        <td style="padding:4px 8px">${esc(vessel?.delivery || '—')}</td></tr>
                    <tr><th style="text-align:left;padding:4px 8px">Setup sent</th>
                        <td style="padding:4px 8px">${esc(setupVer)}${vessel?.deploy?.setup_sent_at ? ` · ${esc(vessel.deploy.setup_sent_at)}` : ''}</td></tr>
                    <tr><th style="text-align:left;padding:4px 8px">Vessel app (M/E/D)</th>
                        <td style="padding:4px 8px">${esc(vesselVer)}</td></tr>
                </tbody>
            </table>
            <p class="spare-sync-note muted">Workflow: <button type="button" class="btn-linkish" onclick="TVC_App.openAdminSopModal()">Contract SOP checklist</button> · <strong>Release</strong> (build + export) · <strong>Export Setup handoff</strong> · <strong>Package App Update</strong>.</p>
        `, { className: 'tvc-section-admin-selected' });
    }

    function syncAdminFleetColgroup() {
        const panel = document.getElementById('fleetListPanel');
        if (!panel || panel.dataset.adminLayout !== '1') return;
        const colgroup = panel.querySelector('.fleet-table colgroup');
        const table = panel.querySelector('.fleet-table');
        if (!colgroup || !table) return;
        colgroup.innerHTML = `<col class="fleet-col-no"><col class="fleet-col-company"><col class="fleet-col-name"><col class="fleet-col-imo"><col class="fleet-col-delivery"><col class="fleet-col-appver">`;
        table.classList.add('fleet-table--with-company');
    }

    const ADMIN_FLEET_TABLE_HEAD = '<th>No</th><th>Company ID</th><th>Ship\'s Name</th><th>IMO No</th><th>Delivery</th><th>App (M/E/D)</th>';
    const ADMIN_FLEET_COLSPAN = 6;

    function ensureAdminFleetPanelLayout() {
        const panel = document.getElementById('fleetListPanel');
        if (!panel || panel.dataset.adminLayout === '1') return;
        panel.dataset.adminLayout = '1';
        panel.innerHTML = `
            <div class="fleet-search-bar">
                <input class="search-input" id="fleetSearch" placeholder="Search ship name / IMO No…">
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
                <input class="search-input" id="fleetSearch" placeholder="Search ship name / IMO No…" oninput="TVC_App.setFleetSearch(this.value)">
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
            search.placeholder = 'Search ship name / IMO No…';
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
            return;
        }

        const rows = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.listVessels({
                search: state.adminSearch || '',
                companyId: listCompanyId,
                includeInactive: true,
            })
            : [];
        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="${ADMIN_FLEET_COLSPAN}" class="muted" style="text-align:center">No vessels found</td></tr>`;
            return;
        }
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
                <td><strong>${esc(v.name)}</strong>${inactive}</td>
                <td>${esc(v.imo_no || '—')}</td>
                <td>${esc(v.delivery || '—')}</td>
                <td class="muted">${esc(appVer)}</td>
            </tr>`;
        }).join('');
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
    }

    async function recordAdminDeployAndSave(deployOptsOrList, { silent = true } = {}) {
        if (typeof TVC_AdminRegistry === 'undefined') return;
        const list = Array.isArray(deployOptsOrList) ? deployOptsOrList : [deployOptsOrList];
        const valid = list.filter(d => d && d.companyId);
        if (!valid.length) return;
        try {
            for (const d of valid) TVC_AdminRegistry.recordDeploy(d);
            const result = await TVC_AdminRegistry.save();
            await TVC_AdminRegistry.load();
            renderMainMenu();
            if (!silent && result.fallback) await TVC_Dialog.alert(result.message);
        } catch (e) {
            if (!silent) await TVC_Dialog.alert(e.message || String(e));
        }
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
            `<option value="${escAttr(v.vessel_id)}"${v.vessel_id === selectedId ? ' selected' : ''}>${esc(v.name)}</option>`
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
        appVersion: '1.0.1',
        notes: '',
        skus: {},
        sourceSetups: [],
        sourcePath: null,
        recordDeploy: true,
    };

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
        if (!_adminSetupExport.skus || !Object.keys(_adminSetupExport.skus).length) {
            _adminSetupExport.skus = {};
            for (const s of _adminSetupExport.sourceSetups) _adminSetupExport.skus[s.sku] = true;
        }
        const setupRows = TVC_SetupExport.HANDOFF_SKUS.map(sku => {
            const hit = _adminSetupExport.sourceSetups.find(s => s.sku === sku);
            const checked = _adminSetupExport.skus[sku] && hit ? 'checked' : '';
            const sizeMb = hit?.bytes ? `${(hit.bytes / (1024 * 1024)).toFixed(1)} MB` : '— missing';
            return `<tr>
                <td style="padding:4px 8px"><label><input type="checkbox" ${checked}${hit ? '' : ' disabled'}
                    onchange="TVC_App.adminSetupExportToggleSku('${escAttr(sku)}', this.checked)"> ${esc(sku)}</label></td>
                <td style="padding:4px 8px">${esc(hit?.filename || '—')}</td>
                <td style="padding:4px 8px" class="muted">${esc(sizeMb)}</td>
            </tr>`;
        }).join('');
        const sourceNote = source.configured
            ? `<span class="muted">Setup folder: ${esc(source.path || '')}</span>`
            : `<span class="muted">Setup folder not found. Run <code>npm run dist</code>, then select the <code>dist</code> folder.</span>`;
        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminSetupExportModal()">×</button>
            <h3 class="spare-sync-title">Export Setup Handoff</h3>
            <p class="spare-sync-hint">Universal <strong>HQ + Vessel</strong> Setup.exe → one ZIP for a company contract.</p>
            <p class="spare-sync-note">${sourceNote}</p>
            <div class="spare-sync-actions" style="margin:8px 0">
                <button type="button" class="btn spare-sync-btn" onclick="TVC_App.adminSetupExportPickFolder()">Select dist folder…</button>
            </div>
            <label class="spare-sync-note" style="display:block;margin:12px 0">
                Company
                <select class="admin-company-select" style="margin-top:4px"
                    onchange="TVC_App.adminSetupExportSetCompany(this.value)">
                    ${adminSeatLicenseCompanyOptions(_adminSetupExport.companyId)}
                </select>
            </label>
            <label class="spare-sync-note" style="display:block;margin:8px 0">
                App version
                <input type="text" value="${escAttr(_adminSetupExport.appVersion)}" style="width:100%;margin-top:4px"
                    oninput="TVC_App.adminSetupExportSetVersion(this.value)">
            </label>
            <label class="spare-sync-note" style="display:block;margin:8px 0">
                Notes
                <textarea rows="2" style="width:100%;margin-top:4px"
                    oninput="TVC_App.adminSetupExportSetNotes(this.value)">${esc(_adminSetupExport.notes || '')}</textarea>
            </label>
            <table style="width:100%;margin:12px 0;border-collapse:collapse">
                <thead><tr><th style="text-align:left;padding:4px 8px">SKU</th><th style="text-align:left;padding:4px 8px">Setup file</th><th style="text-align:left;padding:4px 8px">Size</th></tr></thead>
                <tbody>${setupRows}</tbody>
            </table>
            <label class="spare-sync-note"><input type="checkbox"${_adminSetupExport.recordDeploy !== false ? ' checked' : ''}
                onchange="TVC_App.adminSetupExportSetRecordDeploy(this.checked)"> Update deploy version in registry after export</label>
            <div class="modal-actions spare-sync-footer">
                <button type="button" class="btn btn-green" onclick="TVC_App.adminSetupExportRun()"
                    ${source.configured && _adminSetupExport.companyId ? '' : ' disabled'}>Export Setup ZIP…</button>
                <button type="button" class="btn" onclick="TVC_App.closeAdminSetupExportModal()">Close</button>
            </div>`;
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
                : '1.0.1';
        } catch (_) {
            _adminSetupExport.appVersion = '1.0.1';
        }
        _adminSetupExport.companyId = state.selectedAdminCompanyId || null;
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
        const lab = typeof TVC_AdminRegistry !== 'undefined'
            ? TVC_AdminRegistry.getTvcLabDefaults()
            : { companyId: 'TVC_LAB', vesselId: 'LAB_SHIP' };
        state.adminCompanyFilter = lab.companyId;
        state.selectedAdminCompanyId = lab.companyId;
        state.selectedAdminVesselId = lab.vesselId;
        if (typeof TVC_AdminRegistry !== 'undefined') {
            TVC_AdminRegistry.setSelected(lab.companyId, lab.vesselId);
        }
        closeAdminCommercialModal();
        renderMainMenu();
    }

    function adminSetupExportSetCompany(id) {
        _adminSetupExport.companyId = String(id || '').trim() || null;
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

    function adminSetupExportToggleSku(sku, on) {
        _adminSetupExport.skus = _adminSetupExport.skus || {};
        _adminSetupExport.skus[sku] = !!on;
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
            const selectedSkus = TVC_SetupExport.HANDOFF_SKUS.filter(s => _adminSetupExport.skus?.[s]);
            const { blob, filename, manifest } = await TVC_SetupExport.buildZip(user, {
                companyId: _adminSetupExport.companyId,
                appVersion: _adminSetupExport.appVersion,
                notes: _adminSetupExport.notes,
                skus: selectedSkus,
                sourceSetups: _adminSetupExport.sourceSetups,
            });
            await TVC_FileExport.save(blob, filename);
            if (_adminSetupExport.recordDeploy !== false) {
                await recordAdminDeployAndSave({
                    companyId: _adminSetupExport.companyId,
                    kind: 'setup',
                    appVersion: _adminSetupExport.appVersion,
                });
            }
            await TVC_Dialog.alert(
                `Setup handoff exported.\n${filename}\n\nCompany: ${manifest.company_name}\nSetups: ${(manifest.setups || []).map(s => s.sku).join(', ')}\n\nSend ZIP → install Setup → Issue seat license per PC.`
            );
            closeAdminSetupExportModal();
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
                    `Release export complete.\n\nFolder:\n${exportResult.folder}\n\nFiles:\n  · ${names}\n\nA선사 → App Update ZIP · B선사 → Setup.exe`
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
        host.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminRegistryModal()" aria-label="Close">×</button>
            <h3 class="spare-sync-title">${isEdit ? 'Edit company' : 'Add company'}</h3>
            <p class="spare-sync-hint muted">Saved to <code>admin/registry.json</code> and <code>admin/companies/…/company.json</code>.</p>
            <form class="orig-job-form" id="adminCompanyForm" onsubmit="event.preventDefault();TVC_App.saveAdminCompanyForm()">
                <label>Company ID
                    <input name="company_id" required ${isEdit ? 'readonly class="wr-ro"' : ''}
                        placeholder="e.g. DAEMYUNG" value="${escAttr(company?.company_id || '')}">
                </label>
                <label>Status<select name="status">${adminStatusOptions(company?.status || 'active')}</select></label>
                <label class="span2">Name (KR)
                    <input name="name" required placeholder="e.g. 대명상선" value="${escAttr(company?.name || '')}">
                </label>
                <label class="span2">Name (EN)
                    <input name="name_en" placeholder="e.g. Daemyung" value="${escAttr(company?.name_en || '')}">
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
                <div class="orig-job-actions span2">
                    <button type="button" class="btn" onclick="TVC_App.closeAdminRegistryModal()">Cancel</button>
                    ${isEdit ? `<button type="button" class="btn btn-red" onclick="TVC_App.deactivateAdminCompany()">Set inactive</button>` : ''}
                    <button type="submit" class="btn btn-green">${isEdit ? 'Save company' : 'Add company'}</button>
                </div>
            </form>`;
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
        host.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminRegistryModal()" aria-label="Close">×</button>
            <h3 class="spare-sync-title">${isEdit ? 'Edit vessel' : 'Add vessel'}</h3>
            <p class="spare-sync-hint muted">Saved to registry and <code>admin/companies/…/vessels/…/vessel.json</code>.</p>
            <form class="orig-job-form" id="adminVesselForm" onsubmit="event.preventDefault();TVC_App.saveAdminVesselForm()">
                <label class="span2">Company<select name="company_id" ${isEdit ? 'disabled' : ''}>${companyOpts}</select></label>
                <label>Vessel ID
                    <input name="vessel_id" required ${isEdit ? 'readonly class="wr-ro"' : ''}
                        placeholder="e.g. INCHEON CHEMI" value="${escAttr(vessel?.vessel_id || '')}">
                </label>
                <label>Status<select name="status">${adminStatusOptions(vessel?.status || 'active')}</select></label>
                <label class="span2">Name
                    <input name="name" required value="${escAttr(vessel?.name || '')}">
                </label>
                <label>Code<input name="code" placeholder="01" value="${escAttr(vessel?.code || '')}"></label>
                <label>IMO No<input name="imo_no" placeholder="9297711" value="${escAttr(vessel?.imo_no || '')}"></label>
                <label>Delivery<input name="delivery" type="date" value="${escAttr(vessel?.delivery || '')}"></label>
                <label class="span2">Notes
                    <textarea name="notes" rows="2" placeholder="Optional">${esc(vessel?.notes || '')}</textarea>
                </label>
                <div class="orig-job-actions span2">
                    <button type="button" class="btn" onclick="TVC_App.closeAdminRegistryModal()">Cancel</button>
                    ${isEdit ? `<button type="button" class="btn btn-red" onclick="TVC_App.deactivateAdminVessel()">Set inactive</button>` : ''}
                    <button type="submit" class="btn btn-green">${isEdit ? 'Save vessel' : 'Add vessel'}</button>
                </div>
            </form>`;
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

    async function persistAdminRegistry(successMessage) {
        const result = await TVC_AdminRegistry.save();
        if (result.fallback) {
            await TVC_Dialog.alert(result.message);
        } else {
            await TVC_AdminRegistry.load();
            await TVC_Dialog.success(successMessage || 'Registry saved.');
        }
        closeAdminRegistryModal();
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
            await persistAdminRegistry(isEdit ? 'Company updated.' : 'Company added.');
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
            name: fd.get('name'),
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
            await persistAdminRegistry(isEdit ? 'Vessel updated.' : 'Vessel added.');
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function deactivateAdminCompany() {
        const id = state.selectedAdminCompanyId;
        if (!id) return;
        if (!await TVC_Dialog.confirm({
            message: `Set company "${id}" to inactive?\n\nIt stays in registry files but is hidden from active lists.`,
            kind: 'warning',
        })) return;
        try {
            TVC_AdminRegistry.setCompanyStatus(id, 'inactive');
            await persistAdminRegistry('Company set to inactive.');
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    async function deactivateAdminVessel() {
        const cid = state.selectedAdminCompanyId;
        const vid = state.selectedAdminVesselId;
        if (!cid || !vid) return;
        if (!await TVC_Dialog.confirm({
            message: `Set vessel "${vid}" to inactive?\n\nIt stays in registry files but is hidden from active contract lists.`,
            kind: 'warning',
        })) return;
        try {
            TVC_AdminRegistry.setVesselStatus(cid, vid, 'inactive');
            await persistAdminRegistry('Vessel set to inactive.');
        } catch (e) {
            await TVC_Dialog.alert(e.message || String(e));
        }
    }

    function renderFleetList() {
        const hqCol = document.getElementById('hqLeftCol');
        const body = document.getElementById('fleetTableBody');
        if (!body) return;
        const isAdmin = state.user && TVC_RBAC.isAdminAccount?.(state.user);
        if (isAdmin) {
            renderAdminContractList();
            return;
        }
        restoreHqFleetPanelLayout();
        const isHq = state.user && TVC_RBAC.isHqAccount(state.user);
        hqCol?.classList.toggle('hidden', !isHq);
        document.getElementById('cmaxsMenuBody')?.classList.toggle('hq-mode', isHq);
        if (!isHq) return;

        // Restore HQ fleet chrome if returning from Admin session in same page lifetime
        const head = hqCol?.querySelector('.fleet-list-head');
        if (head) head.textContent = '🚢 Ship List';
        const search = document.getElementById('fleetSearch');
        if (search) {
            search.placeholder = 'Search ship name / IMO No…';
            search.oninput = () => TVC_App.setFleetSearch(search.value);
            if (search.value !== (state.fleetSearch || '')) search.value = state.fleetSearch || '';
        }
        const toolbar = hqCol?.querySelector('.fleet-list-toolbar');
        if (toolbar && !toolbar.querySelector('[data-fview]')) {
            toolbar.innerHTML = `
                <button class="fleet-view-btn active" data-fview="all" onclick="TVC_App.setFleetView('all')">View: All</button>
                <button class="fleet-view-btn" data-fview="selected" onclick="TVC_App.setFleetView('selected')">Selected</button>`;
        }
        const thead = hqCol?.querySelector('.fleet-table thead tr');
        if (thead) {
            thead.innerHTML = '<th>No</th><th>Ship\'s Name</th><th>IMO No</th><th>Delivery</th>';
        }

        let vessels = TVC_Fleet.getAll();
        const q = (state.fleetSearch || '').toLowerCase();
        if (q) vessels = vessels.filter(v =>
            (v.name || '').toLowerCase().includes(q) ||
            (v.imo_no || '').toLowerCase().includes(q) ||
            (v.code || '').toLowerCase().includes(q) ||
            (v.id || '').toLowerCase().includes(q)
        );
        if (state.fleetView === 'selected' && state.selectedVesselId) {
            vessels = vessels.filter(v => v.id === state.selectedVesselId);
        }

        document.querySelectorAll('[data-fview]').forEach(b =>
            b.classList.toggle('active', b.dataset.fview === state.fleetView));

        if (!vessels.length) {
            body.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center">No vessels found</td></tr>';
            return;
        }
        body.innerHTML = vessels.map((v, i) => {
            const sel = v.id === state.selectedVesselId ? ' selected' : '';
            return `<tr class="fleet-row${sel}" onclick="TVC_App.selectVessel('${escAttr(v.id)}')">
                <td>${i + 1}</td>
                <td><strong>${esc(v.name)}</strong></td>
                <td>${esc(v.imo_no || '—')}</td>
                <td>${esc(v.delivery || '—')}</td>
            </tr>`;
        }).join('');
    }

    function setFleetView(mode) {
        state.fleetView = mode;
        renderFleetList();
    }

    function setFleetSearch(q) {
        state.fleetSearch = (q || '').toLowerCase();
        renderFleetList();
    }

    async function selectVessel(id) {
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
        renderMenuCards(mainCards);
        if (sidebarCards) sidebarCards.innerHTML = '';
        if (TVC_RBAC.isAdminAccount?.(state.user)) {
            const ot = document.getElementById('outstandingTasksPanel');
            if (ot) ot.innerHTML = '';
        } else {
            TVC_OutstandingTasks.render();
        }
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
            }
        }
        return map;
    }

    function menuXferRowExportFilename(row, lookup, kind) {
        const st = kind === 'defect'
            ? TVC_DefectCase.listWorkflowStatus(row)
            : kind === 'workPermit'
                ? TVC_WorkPermit.listWorkflowStatus(row)
                : workReportListWorkflowStatus(row);
        const exported = kind === 'defect'
            ? (st === 'Submitted' || row.sync_status === 'SYNCED' || TVC_DefectCase.isHqReplyExported(row))
            : (row.sync_status === 'SYNCED' || st === 'Submitted');
        if (!exported) return histFilenameCellHtml('');
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
        switchTab(tab);
        if (opts.actualFilter && state.currentTab === 'actual') updateActualFilterUI();
    }

    async function menuAction(action) {
        switch (action) {
            case 'checkPlan': menuNavigate('actual', { actualFilter: 'overdue' }); break;
            case 'checkCritical': menuNavigate('actual', { actualFilter: 'critical' }); break;
            case 'inputReport': menuNavigate('actual', { actualFilter: 'total' }); break;
            case 'approveReport': menuNavigate('history'); break;
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
                    await TVC_Dialog.alert(getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan Update는 현재 사용할 수 없습니다.');
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
                pickDepartmentThen('Import할 부서를 선택하세요 (DECK / ENGINE)', (dept) => {
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
        return `Original Plan은 ${at}에 확정되었습니다. 본사 검토 데이터 Import(HQ→Ship) 후 다시 Update 할 수 있습니다.`;
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
        return getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan Update는 현재 사용할 수 없습니다.';
    }

    function syncPlanUpdateUi() {
        const isHq = !!(state.user && TVC_RBAC.isHqAccount(state.user));
        const dept = getPlanLockDept();
        const planLocked = isOriginalPlanUpdateLocked(dept);
        const rhLocked = !isHq && rhUpdateGateApplies() && !isRhUpdateCommitted();
        const locked = planLocked || rhLocked;
        const updateBtn = document.getElementById('actUpdatePlanBtn');
        const approveBtn = document.getElementById('actApprovePlanBtn');
        const canUpdateWorkPlan = !state.user || (typeof TVC_Space !== 'undefined'
            ? TVC_Space.getUiFeatures(state.user).showUpdateWorkPlan !== false
            : TVC_RBAC.getUiFeatures(state.user).showUpdateWorkPlan !== false);
        if (updateBtn) updateBtn.classList.toggle('hidden', isHq || !canUpdateWorkPlan);
        if (approveBtn) approveBtn.classList.toggle('hidden', !isHq);
        if (updateBtn && !isHq && canUpdateWorkPlan) {
            updateBtn.disabled = locked;
            if (planLocked) {
                updateBtn.title = getOriginalPlanLockMessage(dept);
            } else if (rhLocked) {
                updateBtn.title = 'Complete Running Hours Update first.';
            } else {
                updateBtn.title = '';
            }
        }
        if (approveBtn && isHq) {
            const canApprove = TVC_RBAC.can(state.user, TVC_RBAC.Action.APPROVE_ORIGINAL_PLAN) && !!dept;
            approveBtn.disabled = !canApprove;
            approveBtn.title = !dept ? 'Select a department (Deck / Engine).' : '';
        }
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
        return 'Modify, Append, and Delete require Chief Engineer, Chief Officer, Captain, or Superintendent (HQ) permission.';
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
            return 'Captain / Chief Engineer만 Work Procedure를 수정할 수 있습니다.';
        }
        return 'Work Procedure를 편집할 수 없습니다.';
    }

    /** HQ MODE — Original Plan GROUP Tree 그룹명 수정·추가 · PMS Master Excel */
    function canEditOriginalPlanGroups() {
        return canEditOriginalPlanItems() && TVC_RBAC.isHqAccount(state.user);
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
        return 'PMS Master Export · Import는 Chief Engineer, Chief Officer, Captain(Master), 또는 HQ Superintendent만 사용할 수 있습니다.';
    }

    function spareMasterExcelDeniedMessage() {
        return 'SPARE Master Export · Import는 Chief Engineer, Chief Officer, Captain(Master), 또는 HQ Superintendent만 사용할 수 있습니다.';
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
        if (!canEditPlanGroupHeader()) await TVC_Dialog.alert('Chief Engineer / Captain permission required.');
        renderGroupEditor('add');
        showModal('groupEditorModal');
    }

    async function openOrigGroupRename() {
        if (!canEditPlanGroupHeader()) await TVC_Dialog.alert('Chief Engineer / Captain permission required.');
        const node = selectedGroupNode();
        if (!node) await TVC_Dialog.alert('Select a group in PMS GROUP Tree.');
        renderGroupEditor('rename');
        showModal('groupEditorModal');
    }

    async function deleteOrigGroup() {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !canEditPlanGroupHeader()) await TVC_Dialog.alert('Chief Engineer / Captain permission required.');
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
        if (!user || !canEditOriginalPlanGroups()) return;
        const form = document.getElementById('groupEditorForm');
        if (!form) return;
        const fd = new FormData(form);
        const label = String(fd.get('label') || '').trim();
        if (!label) await TVC_Dialog.alert('Enter a GROUP name.');
        try {
            if (state._groupEditMode === 'rename') {
                const node = selectedGroupNode();
                if (!node) await TVC_Dialog.alert('Select a GROUP.');
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
            if (code === 'DUPLICATE') await TVC_Dialog.alert('A GROUP with the same name already exists in this department.');
            await TVC_Dialog.alert(e.message || code || 'Save failed');
        }
    }

    function syncPlanItemUi() {
        const canShow = !!(state.user && TVC_RBAC.isMaintPlanEditor?.(state.user));
        const canEdit = canEditOriginalPlanItems();
        const hasSel = !!state.selectedJobId;
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
            pmsEx.title = canMaster ? 'PMS Master Excel Export → incheonchemi_pms_master_YYYYMMDD_001.xlsx' : pmsMasterExcelDeniedMessage();
        }
        if (pmsIm) {
            pmsIm.disabled = !canMaster;
            pmsIm.title = canMaster ? 'PMS Master Excel Import (incheonchemi_pms_master_YYYYMMDD_001.xlsx)' : pmsMasterExcelDeniedMessage();
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

    function getOrigJobInlineEquipmentDraft() {
        const m = origJobInlineState();
        if (!m.editId || !m.draft) return null;
        return {
            pmsGroupNo: m.draft.group || '',
            itemSort1: m.draft.item_sort1 || '',
            maker: m.draft.maker ?? '',
            modelType: m.draft.modelType ?? '',
            capacity: m.draft.capacity ?? '',
            serialNo: m.draft.serialNo ?? '',
        };
    }

    function origJobInlineState() {
        state._origJobInline = state._origJobInline || { editId: null, mode: null, draft: null };
        return state._origJobInline;
    }

    function isOrigJobInlineEditing() {
        return !!origJobInlineState().editId;
    }

    function origJobCellInput(id, value, extraClass = '') {
        const cls = ['spare-inline-input', extraClass].filter(Boolean).join(' ');
        return `<input class="${cls}" id="${id}" value="${esc(String(value ?? ''))}" onclick="event.stopPropagation()">`;
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
        const groupSelect = `<select class="spare-inline-input spare-inline-input-wide" id="oie_group" onclick="event.stopPropagation()">${origGroupOptions(dept, r.group)}</select>`;
        const codeCell = origJobCellInput('oie_code', r.job_code);
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
                        <td class="c-s1">${origJobCellInput('oie_sort1', r.item_sort1)}</td>
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
        if (TVC_SpareMenu?.cancelGroupHeaderEdit) TVC_SpareMenu.cancelGroupHeaderEdit();
        const hdr = TVC_SpareMenu?.resolveWrJobHeader?.(state, job) || {};
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
            maker: hdr.maker || '',
            modelType: hdr.modelType || '',
            capacity: hdr.capacity || '',
            serialNo: hdr.serialNo || '',
        };
        state._origJobEditMode = 'modify';
        state._origJobEditId = job.id;
        refreshActJobEditBlock();
        renderPlanGroupHeader();
        syncPlanItemUi();
    }

    function startOrigJobInlineAppend() {
        if (TVC_SpareMenu?.cancelGroupHeaderEdit) TVC_SpareMenu.cancelGroupHeaderEdit();
        const ctx = defaultAppendContext();
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
            maker: '',
            modelType: '',
            capacity: '',
            serialNo: '',
        };
        state._origJobEditMode = 'append';
        state._origJobEditId = null;
        refreshActJobEditBlock();
        renderPlanGroupHeader();
        syncPlanItemUi();
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
            maker: g('oie_maker'),
            modelType: g('oie_modelType'),
            capacity: g('oie_capacity'),
            serialNo: g('oie_serialNo'),
        };
    }

    function refreshActualPlan() {
        if (state.currentTab === 'actual') renderActualPlan();
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
                    department: ctx.dept,
                    is_critical_equipment: parseJobCriticalEditValue(data.is_critical_equipment),
                    ...masterVesselOpts(),
                });
                await TVC_SpareMenu.saveJobEquipmentHeader(user, {
                    department: ctx.dept,
                    group: data.group,
                    item_sort1: data.item_sort1,
                    maker: data.maker,
                    modelType: data.modelType,
                    capacity: data.capacity,
                    serialNo: data.serialNo,
                });
                await TVC_Dialog.alert(`${data.job_code} Item added.`);
            } else {
                await TVC_MaintenancePlan.updateJob(user, m.editId, {
                    ...data,
                    is_critical_equipment: parseJobCriticalEditValue(data.is_critical_equipment),
                    ...masterVesselOpts(),
                });
                await TVC_SpareMenu.saveJobEquipmentHeader(user, {
                    department: m.draft?.department || state.department || user.department,
                    group: data.group,
                    item_sort1: data.item_sort1,
                    maker: data.maker,
                    modelType: data.modelType,
                    capacity: data.capacity,
                    serialNo: data.serialNo,
                });
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

    function suggestNextJobCode(group, dept) {
        const prefixMatch = String(group || '').match(/^(\d+)/);
        const prefix = prefixMatch ? prefixMatch[1].padStart(2, '0') : '99';
        let max = 0;
        state.jobs.filter(j => (!dept || j.department === dept)).forEach(j => {
            const m = String(j.job_code || '').match(/^(\d+)\s*-?\s*(\d+)/);
            if (m && m[1].padStart(2, '0') === prefix) max = Math.max(max, parseInt(m[2], 10));
        });
        return `${prefix}-${String(max + 1).padStart(3, '0')}`;
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
        return { group: (group || '').trim(), dept, job_code: suggestNextJobCode(group, dept) };
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
        if (isOrigJobInlineEditing()) return saveOrigJobInlineEdit();
        if (!state.selectedJobId) {
            await TVC_Dialog.alert('Select a job row to modify.');
            return;
        }
        const job = state.idx?.jobById.get(state.selectedJobId);
        if (!job) {
            await TVC_Dialog.alert('Job item not found.');
            return;
        }
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
        if (!state.selectedJobId) {
            await TVC_Dialog.alert('Select a job row to delete.');
            return;
        }
        const job = state.idx?.jobById.get(state.selectedJobId);
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
            const msg = e.code === 'LINKED' ? 'Work Report가 연결된 항목은 삭제할 수 없습니다.'
                : e.code === 'FORBIDDEN' ? '타 부서 항목은 삭제할 수 없습니다.'
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
            await TVC_Dialog.alert('No permission to approve Work Plan.');
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
        let msg = 'Original Plan을 업데이트하고 확정하시겠습니까?';
        if (stats.pendingReports > 0) {
            msg += `\n\n미완료 Work Report ${stats.pendingReports}건 — Cancel 선택 후 Work Plan에서 입력하세요.`;
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
            await TVC_Dialog.alert(getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan Update는 현재 사용할 수 없습니다.');
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
                const emptyTag = n.isEmpty ? `<span class="tree-empty-tag" title="작업 항목 없음">0</span>` : '';
                const sel = state.selectedGroupKey === n.key ? ' selected' : '';
                html += `<div class="tree-node${sel}${n.isEmpty ? ' tree-node-empty' : ''}" onclick="TVC_App.selectGroup('${escAttr(n.key)}')"><span>${esc(n.label)}</span>${emptyTag}</div>`;
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
            if (!batchSelectedCount()) await TVC_Dialog.alert('No jobs selected.');
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
        const checked = batchSelectedJobIds();
        const jobId = checked[0] || explicitJobId || state.selectedJobId;
        if (!jobId) {
            await TVC_Dialog.alert('Select a job or check one or more rows.');
            return;
        }
        const prefill = checked.length ? checked : [jobId];
        if (prefill.length > 1 && state.user?.department) {
            const bad = prefill.some(id => {
                const j = state.idx?.jobById.get(id);
                return j && j.department !== state.user.department;
            });
            if (bad) {
                await TVC_Dialog.alert('Items from another department cannot be included in the same Work Report.');
                return;
            }
        }
        return openWorkReport(jobId, undefined, { prefillJobIds: prefill });
    }

    async function openBatchReport() {
        const jobIds = batchSelectedJobIds();
        if (jobIds.length < 2) {
            await TVC_Dialog.alert('Select at least 2 jobs for Work Report.');
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
        const n = batchSelectedCount();
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
                <button type="button" id="planReportBtn" class="btn btn-sm btn-green" onclick="TVC_App.openWorkReportInput()"${canReport ? '' : ' disabled'}${reportTitle ? ` title="${escAttr(reportTitle)}"` : ''}>Make Work Report</button>
                <button type="button" class="btn btn-sm btn-amber plan-new-defect-btn" data-feature="showDefectReport" onclick="TVC_App.openNewDefectFromPlan()">Make Defect Report</button>
                ${selectedItemsBtn}
            </div>`;
    }

    async function openNewDefectReportInput(explicitJobId) {
        const checked = batchSelectedJobIds();
        const jobId = checked[0] || explicitJobId || state.selectedJobId;
        if (!jobId && !checked.length) {
            return TVC_DefectReport.openNewBlank();
        }
        if (!jobId) {
            await TVC_Dialog.alert('Select a job or check one or more rows.');
            return;
        }
        const prefill = checked.length ? checked : [jobId];
        if (prefill.length > 1 && state.user?.department) {
            const bad = prefill.some(id => {
                const j = state.idx?.jobById.get(id);
                return j && j.department !== state.user.department;
            });
            if (bad) {
                await TVC_Dialog.alert('Items from another department cannot be included in the same Defect Report.');
                return;
            }
        }
        return TVC_DefectReport.openNewFromJob(jobId, { prefillJobIds: prefill });
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
        else if (tab === 'history') setListFilters('history', { groupKeys: [], type: 'all', openOnly: false, postponeAwaitingApproval: false });
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
        entries.sort(compareHistEntryByReportedDate);
        return entries;
    }

    const WORK_HISTORY_CONFIRMED_LABELS = new Set(['Confirmed', 'Approved', 'Submitted']);

    function isWorkHistoryEntryConfirmed(entry) {
        if (isHistDefectEntry(entry)) {
            const st = TVC_DefectCase.listWorkflowStatus(entry.defect);
            return st !== 'Reported' && st !== 'Draft';
        }
        const label = reportWorkflowStatusLabel(entry.report, entry.item);
        return WORK_HISTORY_CONFIRMED_LABELS.has(label);
    }

    /**
     * Engine Monthly → Update Running Hours 게이트.
     * - Defect: 제외 (별도 관리)
     * - Maintenance / Postpone (일반·Critical): Confirmed+
     * - Critical Postpone: Work Plan은 Confirm 시 반영 · Company Approved는 Export/검사용
     */
    function isMonthlyRhGateEntryReady(entry) {
        if (!entry || isHistDefectEntry(entry)) return true;
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
        if (!entry || isHistDefectEntry(entry)) return '';
        const report = entry.report;
        if (!report) return 'Missing report';
        TVC_WorkReport.fromLegacy(report);
        const label = workReportListWorkflowStatus(report);
        if (label === 'Reported' || (entry.item && TVC_RBAC.normalizeReportStatus(entry.item.status, report.is_locked) === 'REPORTED')) {
            return report.work_type === 'POSTPONE'
                ? (postponeRequiresCompanyApproval(report)
                    ? 'Critical Postpone — Confirm required (Company approval via Export)'
                    : 'Postpone — Confirm required')
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

    function isHistRowCheckable(entry) {
        if (TVC_RBAC.isHqAccount(state.user)) {
            return isHistRowHqApprovable(entry);
        }
        if (isHistDefectEntry(entry)) {
            return isHistDefectRowConfirmable(entry);
        }
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
        // HQ 작성분: Reported만 있어도 Approve 가능
        if (TVC_RBAC.canHqDirectApprove(state.user, dc)) return true;
        return !!dc.confirmed_at;
    }

    function isHistRowHqApprovable(entry) {
        if (!state.user || !TVC_RBAC.isHqAccount(state.user) || !TVC_RBAC.canApproveHqReport(state.user)) return false;
        if (isHistDefectEntry(entry)) return isHistDefectRowHqApprovable(entry);
        const { report: r } = entry;
        if (!r || reportIsApproved(r) || r.is_locked) return false;
        if (TVC_RBAC.canHqDirectApprove(state.user, r)) return true;
        if (!TVC_RBAC.isConfirmedStatus(r.status, r.is_locked)) return false;
        if (r.work_type === 'POSTPONE') return postponeRequiresCompanyApproval(r);
        return r.work_type === 'MAINTENANCE' || r.work_type === 'TROUBLE';
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
        if (isHistDefectEntry(entry)) return isHistDefectRowConfirmable(entry);
        if (!isHistRowCheckable(entry)) return false;
        const { report: r } = entry;
        if (TVC_RBAC.isConfirmedStatus(r.status)) return false;
        return canConfirmHistReport(state.user, r);
    }

    function histCheckDisabledTitle(entry) {
        if (isHistDefectEntry(entry)) {
            const dc = entry.defect;
            if (!state.user) return 'Sign in required';
            if (TVC_RBAC.isHqAccount(state.user)) {
                if (dc.approved_at) return '승인 완료';
                if (dc.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) return 'Report Confirm 또는 Approve 대상';
                if (dc.confirmed_at) return 'Approve 대기';
                return 'Awaiting HQ · Confirmed 항목만 선택 가능';
            }
            if (dc.confirmed_at || dc.confirmed_by) return '이미 Confirm 됨';
            if (dc.approved_at || dc.approved_by) return '승인 완료';
            if (dc.status === TVC_DefectCase.Status.CLOSED) return 'Closed';
            if (!TVC_DefectReport.isDefectReportConfirmable(dc)) {
                return 'Confirm 권한 없음 (Engine · C/E · Deck · C/O · Master · Captain · HQ)';
            }
            return 'Not selectable';
        }
        const { report: r, item } = entry;
        if (!state.user) return 'Sign in required';
        if (r.is_locked || reportIsApproved(r)) return '승인 완료된 리포트';
        if (itemSt(item) !== 'REPORTED' && !isHistRowHqApprovable(entry)) return 'REPORTED · Confirmed 항목만 선택 가능';
            if (!TVC_RBAC.canConfirmDepartment(state.user, reportDept(r)) && !isHistRowHqApprovable(entry)) {
            return 'Confirm 권한 없음 (Engine · C/E · Deck · C/O · Master · Captain · HQ)';
        }
        if (TVC_RBAC.isConfirmedStatus(r.status) && !isHistRowHqApprovable(entry)) return '이미 Confirm 됨';
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
        document.querySelectorAll('#tab-history .sheet-table-wrap').forEach(container => {
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
            if (isHistDefectEntry(entry)) return false;
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
            return 'Modify not available';
        }
        const st = isHistDefectEntry(entry)
            ? TVC_DefectCase.listWorkflowStatus(entry.defect)
            : workReportListWorkflowStatus(entry.report);
        if (st === 'Submitted') return 'Submitted — modify not available';
        if (st === 'Approved') return 'Approved — modify not available';
        return 'Modify not available';
    }

    function histEntryHqAwaitingApproval(entry) {
        if (!entry || !state.user || !TVC_RBAC.isHqAccount(state.user)) return false;
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
        if (histEntryHqAwaitingApproval(entry)) return true;
        if (isHistDefectEntry(entry)) {
            return TVC_DefectReport?.canOpenDfModifyRow?.(entry.defect) ?? false;
        }
        const r = entry?.report;
        if (!r) return false;
        if (TVC_RBAC.isApprovedStatus(r.status, r.is_locked)) return false;
        const st = workReportListWorkflowStatus(r);
        if (TVC_RBAC.isHqAccount(state.user)) {
            if (st === 'Approved') return false;
            return st === 'Submitted' || TVC_RBAC.canModifyDeleteListReport(state.user, reportDept(r), st);
        }
        if (TVC_RBAC.isConfirmedStatus(r.status, r.is_locked) && r.sync_status === 'SYNCED') return false;
        if (st === 'Approved' || st === 'Submitted') return false;
        return TVC_RBAC.canModifyDeleteListReport(state.user, reportDept(r), st);
    }

    function canDeleteHistEntry(entry) {
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
        // 작성자(engineer/officer)·HQ: Report Confirm 숨김 (확인자 ce/captain만 표시)
        const showReportConfirm = !isHq && role !== TVC_RBAC.Role.SHIP_OFFICER;
        setVis('histBtnApprove', showReportConfirm);
        setDis('histBtnApprove', !canConfirm);
        const approveBtn = document.getElementById('histBtnApprove');
        if (approveBtn && showReportConfirm) {
            approveBtn.textContent = checkedApprovableCount >= 1
                ? `Report Confirm (${checkedApprovableCount})`
                : 'Report Confirm';
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
        TVC_DefectReport.openCaseFromNav(defectId, 'history', 'view', wpStack
            ? { stackOverWp: true, preserveNavScope: true }
            : { swapHide: 'workReportModal' });
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
        if (state._defectCaseId) {
            const i = list.findIndex(e => isHistDefectEntry(e) && e.defect.id === state._defectCaseId);
            if (i >= 0) return i;
        }
        if (state._wrReportId) {
            const i = list.findIndex(e => {
                if (isHistDefectEntry(e)) return false;
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
        if (isHistDefectEntry(entry)) {
            const defectOpts = { ...navOpts, swapOpts };
            if (isModalOpen('workReportModal')) {
                defectOpts.swapHide = 'workReportModal';
            } else if (wpNav) {
                defectOpts.stackOverWp = true;
            } else {
                defectOpts.swapHide = 'workReportModal';
            }
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
        if (isModalOpen('defectReportModal')) {
            wrOpts.swapHide = 'defectReportModal';
        } else if (wpNav && isModalOpen('workReportModal')) {
            wrOpts.skipModalToggle = true;
        } else if (wpNav) {
            wrOpts.fromWorkProcedure = true;
        } else {
            wrOpts.swapHide = 'defectReportModal';
        }
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
        if (isHistDefectEntry(entry)) {
            openDefectFromHistory(entry.defect.id);
            return;
        }
        openWorkReportFromHistory(entry.report.id, entry.item.maintenance_job_id, { fromHistory: true, view: true });
    }

    async function histModifyReport() {
        const entry = getSelectedHistEntry();
        if (!entry) await TVC_Dialog.alert('Select an item from Work History.');
        if (isHistDefectEntry(entry)) {
            return TVC_DefectReport.dfModifyCase(entry.defect.id, 'history', { swapHide: 'workReportModal' });
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
            await TVC_Dialog.alert('Check one or more REPORTED items to confirm.');
        }
        if (checkedEntries.length && confirmCandidates.length !== checkedEntries.filter(isHistRowApprovable).length) {
            await TVC_Dialog.alert('Some selected items cannot be confirmed.\nCheck Engine (C/E), Deck (C/O), Master (Captain), or HQ permission.');
        }

        const user = await TVC_Auth.requirePermission(TVC_RBAC.Action.APPROVE_DAILY_REPORT);
        if (!user) return;

        const defectEntries = confirmCandidates.filter(isHistDefectEntry);
        const workEntries = confirmCandidates.filter(e => !isHistDefectEntry(e));

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
        const totalCount = reportIds.length + defectToConfirm.length;
        if (!totalCount) await TVC_Dialog.alert('No items available to confirm.');

        const parts = [];
        if (reportIds.length) parts.push(`${reportIds.length}건의 Work Report`);
        if (defectToConfirm.length) parts.push(`${defectToConfirm.length}건의 Defect Report`);
        const wrNote = reportIds.length ? '\n((Stock deduction · LAST DONE / NEXT DATE update))' : '';
        if (!await TVC_Dialog.confirm({ message: `${parts.join(' · ')}를 Confirm selected item(s)?${wrNote}` })) return;

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
            await TVC_Dialog.alert('Check one or more Confirmed items to approve.');
        }
        if (checkedEntries.length && approveCandidates.length !== checkedEntries.filter(isHistRowHqApprovable).length) {
            await TVC_Dialog.alert('Some selected items cannot be approved.\nCheck Confirmed status and HQ approval permission.');
        }

        const user = await TVC_Auth.requirePermission(TVC_RBAC.Action.CONFIRM_REPORT);
        if (!user) return;

        const defectEntries = approveCandidates.filter(isHistDefectEntry);
        const workEntries = approveCandidates.filter(e => !isHistDefectEntry(e));
        const reportIds = [...new Set(workEntries.map(e => e.report.id))];
        const postponeIds = reportIds.filter(id => {
            const rep = state.reports.find(r => r.id === id);
            return rep && rep.work_type === 'POSTPONE' && postponeRequiresCompanyApproval(rep);
        });
        const maintenanceIds = reportIds.filter(id => !postponeIds.includes(id));

        for (const id of reportIds) {
            const rep = state.reports.find(r => r.id === id);
            if (!rep) await TVC_Dialog.alert('Report not found.');
            if (!TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked)) {
                await TVC_Dialog.alert(`${rep.job_code}: Only Confirmed items can be approved.`);
            }
            if (reportIsApproved(rep)) {
                await TVC_Dialog.alert(`${rep.job_code}: Already approved.`);
            }
            if (rep.work_type === 'POSTPONE' && postponeRequiresCompanyApproval(rep) && !hqApprovePostponeDate(rep)) {
                await TVC_Dialog.alert(`${rep.job_code}: Approved Postpone Date is required. Check the Work Report.`);
            }
        }

        const totalCount = reportIds.length + defectEntries.length;
        if (!totalCount) await TVC_Dialog.alert('No items available to approve.');

        const parts = [];
        if (maintenanceIds.length) parts.push(`${maintenanceIds.length}건의 Work Report`);
        if (postponeIds.length) parts.push(`${postponeIds.length}건의 Postpone Report`);
        if (defectEntries.length) parts.push(`${defectEntries.length}건의 Defect Report`);
        if (!await TVC_Dialog.confirm({ message: `${parts.join(' · ')} — approve selected item(s)?` })) return;

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
                const opts = (rep?.work_type === 'POSTPONE' && postponeRequiresCompanyApproval(rep))
                    ? { approvedPostponeDate: hqApprovePostponeDate(rep) }
                    : {};
                await TVC_Transaction.approveReport(user, id, companyComment, opts);
                ok++;
            } catch (e) {
                await TVC_Dialog.alert(`${id}: ${e.message || e.code || 'Approve 실패'}`);
                break;
            }
        }
        for (const entry of defectEntries) {
            try {
                await TVC_DefectCaseService.saveApprovalMeta(user, entry.defect.id, { approve: true });
                ok++;
            } catch (e) {
                await TVC_Dialog.alert(`${entry.defect.case_no || entry.defect.id}: ${e.message || e.code || 'Approve failed'}`);
                break;
            }
        }
        state._histChecked = {};
        await refreshAll();
        if (ok) await TVC_Dialog.alert(`${ok} item(s) approved`);
    }

    async function histDeleteReport() {
        const entry = getSelectedHistEntry();
        if (!entry) await TVC_Dialog.alert('Select an item from Work History.');
        if (isHistDefectEntry(entry)) {
            return TVC_DefectReport.dfDeleteByIds([entry.defect.id], { clearHistSelection: true });
        }
        if (!canDeleteHistEntry(entry)) {
            if (reportIsApproved(entry.report) || entry.report.is_locked) {
                await TVC_Dialog.alert('본사 승인(APPROVED)된 리포트는 삭제할 수 없습니다.');
            }
            await TVC_Dialog.alert('Confirm 완료된 리포트는 Captain / Chief Engineer만 삭제할 수 있습니다.');
        }
        state._wrReportId = entry.report.id;
        state._wrBatchItemId = entry.item.maintenance_job_id;
        await deleteWorkReport();
    }

    /** Work Plan에서 작성된 Work Report를 기반으로 이력 표시 */
    function renderWorkHistory() {
        const body = document.getElementById('historyBody');
        if (!body) return;
        bindWorkHistoryTableEvents();
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
            body.innerHTML = `<tr><td colspan="${colSpan}" class="muted" style="text-align:center">No work reports or defect cases yet.</td></tr>`;
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
    function runHrsTotalEdit(i) { TVC_RunHours.totalEdit(i); }

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
        const tip = 'Chief Engineer / Captain 권한 필요';
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

    /** ㅁ 체크박스 — 다중 선택 */
    function toggleSpareRow(spareId, checked) {
        if (!state.spareListSelected) state.spareListSelected = {};
        if (checked) state.spareListSelected[spareId] = true;
        else delete state.spareListSelected[spareId];
        TVC_SpareMenu.refreshList?.();
        requestAnimationFrame(() => {
            if (typeof TVC_SpareMenu?.syncSpareToolbarUi === 'function') TVC_SpareMenu.syncSpareToolbarUi();
            else syncSpareItemToolbar();
        });
    }

    async function openSpareAppend() {
        if (!canEditSpareItems()) await TVC_Dialog.alert('Chief Engineer / Captain 권한이 필요합니다.');
        TVC_SpareMenu.append();
    }

    async function openSpareModify() {
        if (state.spareModule?.inlineEditId) {
            return TVC_SpareMenu.saveInlineEdit();
        }
        const ids = spareActionIds('modify');
        if (!ids.length) await TVC_Dialog.alert('수정할 부품을 선택하세요 (행 클릭 또는 ㅁ 체크).');
        if (batchSelectedSpareIds().length > 1) await TVC_Dialog.alert('수정은 한 건만 선택할 수 있습니다.');
        if (!canEditSpareItems()) await TVC_Dialog.alert('Chief Engineer / Captain 권한이 필요합니다.');
        TVC_SpareMenu.edit(ids[0]);
    }

    async function deleteSpareItem() {
        const ids = spareActionIds('delete');
        if (!ids.length) await TVC_Dialog.alert('삭제할 부품을 선택하세요 (행 클릭 또는 ㅁ 체크).');
        if (!canEditSpareItems()) await TVC_Dialog.alert('Chief Engineer / Captain 권한이 필요합니다.');
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
            await TVC_Dialog.alert('Work History 화면을 불러오지 못했습니다.');
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
        const items = list.map(a => `
            <li class="wr-attach-item">
                <a class="wr-attach-link" href="${escAttr(a.dataUrl)}" download="${escAttr(a.name)}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>
                <span class="wr-attach-size">${Math.max(1, Math.round(a.size / 1024))}KB</span>
                ${canRemove ? `<button type="button" class="wr-attach-remove" title="Remove" onclick="TVC_App.removeWorkProcedureAttachment('${escAttr(String(a.id))}')">×</button>` : ''}
            </li>`).join('');
        return `<div class="wr-attach-list-wrap"><ul class="wr-attach-list">${items}</ul></div>`;
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
                    <div class="wp-section-head">Work History <span class="muted wp-hist-hint">(double-click row to open report)</span></div>
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
                <button type="button" class="wp-tab${histActive}" onclick="TVC_App.setWorkProcedureTab('history')">Work History</button>
            </div>
            <div class="wp-tab-pane wp-tab-pane-${state._wpTab}">${tabContent}</div>
            <div class="modal-actions wp-modal-actions">
                <div class="wp-modal-actions-left">
                    ${procEditBtns}
                    <button type="button" class="btn btn-green" onclick="TVC_App.closeModal('workProcedureModal');TVC_App.openWorkReportInput('${job.id}')"${editingProc ? ' disabled' : ''}>Report Input</button>
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

    // ── CMAXS Work Report (3 tabs) ───────────────────────────────────
    const WR_TABS = {
        repair: 'Maintenance',
        postpone: 'Postpone',
    };

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
        if (state.user.department && state.user.department !== job.department) {
            await TVC_Dialog.alert('타 부서 항목은 보고할 수 없습니다.');
            return;
        }
        snapshotPlanBatchSelection();
        state._batchMode = false;
        state._batchJobIds = [];
        state._batchDraft = null;
        const prefill = Array.isArray(opts.prefillJobIds) ? opts.prefillJobIds.filter(Boolean) : null;
        if (state._wrJobId !== jobId || !state._wrReportId || (prefill && prefill.length > 1)) {
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
            syncPlanBatchChecksFromJobItems(state._wrJobItems);
        }
        state._wrReportId = null;
        state._wrBatchItemId = null;
        state._wrReadonly = false;
        state._wrPostSaveView = false;
        state._wrFromHistory = false;
        state._wrJobId = jobId;
        state._wrUsedParts = [];
        state.selectedJobId = jobId;
        syncPlanBatchCheckForJob(jobId, true);
        state._wrTab = tab || state._wrTab || 'repair';
        if (state.vlActual) state.vlActual.refresh();
        renderSidePanel();
        renderWorkReportModal();
        showModal('workReportModal');
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
        if (opts.fromWorkProcedure) setWorkProcedureHistNavScope(true);
        else if (!opts.preserveNavScope) clearWorkProcedureHistNavScope();
        if (opts.fromHistory) {
            const histEntry = workHistoryNavEntries().find(e =>
                !isHistDefectEntry(e)
                && e.report.id === reportId
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

        if (isHqApproved) {
            await TVC_Dialog.alert('본사 승인(APPROVED)된 리포트는 삭제할 수 없습니다.');
        }
        if (isShipConfirmed && !TVC_RBAC.isApprover(user)) {
            await TVC_Dialog.alert('Confirm 완료된 리포트는 Captain / Chief Engineer만 삭제할 수 있습니다.');
        }

        const msg = isShipConfirmed
            ? 'Confirm 완료된 Work Report를 삭제합니다.\n\n차감된 재고와 LAST DONE / NEXT DATE가 Confirm 이전 상태로 자동 복구됩니다. 계속하시겠습니까?'
            : '이 Work Report를 Delete this item? 되돌릴 수 없습니다.';
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
                ? 'Work Report가 삭제되고 재고·일자가 원상복구되었습니다.'
                : 'Work Report가 삭제되었습니다.');
        } catch (e) {
            const code = e.code || '';
            if (code === 'LOCKED') await TVC_Dialog.alert('본사 확정된 리포트는 삭제할 수 없습니다.');
            if (code === 'FORBIDDEN') await TVC_Dialog.alert('타 부서 리포트는 삭제할 수 없습니다.');
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
        const isRepConfirmed = !!rep && TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked);
        const isRepApproved = !!rep && reportIsApproved(rep);
        const wrAppr = wrHqApprovalUiState(rep, job, true);
        const {
            canConfirmNow, canApproveNow, confirmedByVal, approvedByVal,
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
                isCriticalPostpone: rep ? postponeRequiresCompanyApproval(rep) : jobShowsCriticalEquipmentMark(job),
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
            cfCb.checked = TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked);
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
            if (state._wrReadonly || TVC_RBAC.isApprovedStatus(rep.status, rep.is_locked)) {
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
                state._wrReadonly = false;
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
                ? (postponeRequiresCompanyApproval(saved)
                    ? `${job.job_code} critical postpone report confirmed. (NEXT DATE updated · Awaiting company approval / export)`
                    : `${job.job_code} postpone report confirmed. (NEXT DATE updated)`)
                : `${job.job_code} report confirmed. (Stock deduction · LAST DONE / NEXT DATE update)`;
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
        const isRepConfirmed = TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked);
        const isRepApproved = reportIsApproved(rep);
        const dept = job?.department || rep.department;
        const canConfirmNow = TVC_RBAC.isReportedStatus(rep.status, rep.is_locked)
            && TVC_RBAC.canConfirmDepartment(st.user, dept);
        const hqDirectApprove = !isRepApproved && TVC_RBAC.canHqDirectApprove(st.user, rep);
        const canApproveNow = !isRepApproved && TVC_RBAC.canApproveHqReport(st.user)
            && (isRepConfirmed || hqDirectApprove);
        const confirmedByVal = isRepConfirmed
            ? (TVC_RBAC.resolveConfirmByLabel?.(rep.confirmed_by, dept, st.user) || '')
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

    function resolveWrJobFromItem(item) {
        if (!item) return null;
        return (item.maintenance_job_id && state.idx?.jobById.get(item.maintenance_job_id))
            || state.jobs.find(j => j.job_code === item.job_code)
            || null;
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
        const job = (first.maintenance_job_id && state.idx?.jobById.get(first.maintenance_job_id))
            || state.jobs.find(j => j.job_code === first.job_code);
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
        if (!jobs.length) return '<div class="spare-consume-pick-empty muted">No results</div>';
        const activeRow = (state._wrJobItems || [])[rowIdx ?? _wrActiveJobRowIndex ?? 0] || {};
        const selectedCode = activeRow.job_code || '';
        return jobs.map(j => {
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
        setTimeout(() => {
            document.addEventListener('click', close);
            window.addEventListener('scroll', onReposition, true);
            window.addEventListener('resize', onReposition);
            _wrJobRowPickUnbind = () => {
                document.removeEventListener('click', close);
                window.removeEventListener('scroll', onReposition, true);
                window.removeEventListener('resize', onReposition);
            };
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

    function wrGroupKeyFromForm() {
        if (state._wrForm?.pmsGroupKey) return state._wrForm.pmsGroupKey;
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
            <button type="button" id="${btnId}" class="btn btn-sm wr-file-no-pick-btn" onclick="TVC_App.openFileNoPickModal('${pickTarget}')"${dis} title="Browse Work History for File No. reference">Select File No.</button>
        </div>`;
    }

    function buildFileNoPickRows() {
        return workHistoryEntries().map(entry => {
            const m = histTypeMarker(entry);
            let fileNo, jobCode, sort1, date;
            if (isHistDefectEntry(entry)) {
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
            return '<p class="muted file-no-pick-empty">No matching Work History entries.</p>';
        }
        return `<div class="search-field-wrap file-no-pick-search">
                <input type="search" class="search-input" id="fileNoPickSearch" placeholder="Search File No / Job Code / SORT…"
                    value="${escAttr(state._fileNoPickSearch || '')}" oninput="TVC_App.fileNoPickSearch(this.value)">
            </div>
            <div class="file-no-pick-table-wrap">
                <table class="file-no-pick-table">
                    <thead><tr>
                        <th class="hist-type-h">Type</th>
                        <th>File No</th>
                        <th class="hist-crit-h" title="Critical Equipment">⚠</th>
                        <th>JOB CODE</th>
                        <th>SORT-1</th>
                        <th><span class="hist-th-stack"><span>Reported</span><span>Date</span></span></th>
                    </tr></thead>
                    <tbody>${rows.map(row => `<tr class="file-no-pick-row" onclick="TVC_App.applyFileNoPick('${escAttr(row.fileNo)}')">
                        ${histTypeCell(row.entry)}
                        <td>${esc(row.fileNo || '—')}</td>
                        ${histCriticalCell(row.entry)}
                        <td>${esc(row.jobCode)}</td>
                        <td>${esc(row.sort1)}</td>
                        <td>${esc(row.date || '—')}</td>
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
        return `<div class="spare-req-hist-popover-head wr-file-no-popover-head">Select File No.
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
        const key = wrGroupKeyFromForm();
        const q = (_wrGroupPickSearch || '').toLowerCase().trim();
        const matchNode = (n) => !q || TVC_SpareMenu.safeTreeLabel(n.label).toLowerCase().includes(q);
        const critKey = TVC_SpareMenu.CRITICAL_GROUP_KEY;
        let html = '';
        (TVC_SpareMenu.getPlanGroupPickNodes(state) || []).filter(matchNode).forEach(n => {
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
        return jobs.map(j => `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-job${cur?.id === j.id ? ' selected' : ''}"
            onclick="TVC_App.pickWrJob('${escAttr(j.id)}')"><span class="spare-consume-pick-job-code">${esc(j.job_code)}</span></button>`).join('')
            || '<div class="spare-consume-pick-empty muted">No jobs</div>';
    }

    function toggleWrGroupPick(ev) {
        ev?.stopPropagation();
        const wrap = document.getElementById('wrGroupPick');
        if (!wrap) return;
        closeWrPickMenu(document.getElementById('wrJobPick'));
        if (wrap.classList.contains('open')) { closeWrPickMenu(wrap); return; }
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
        state._wrForm.pmsGroupKey = groupKey;
        state._wrForm.pmsGroupNo = groupLabel;
        const hdr = TVC_SpareMenu.resolveGroupHeaderByKey(state, groupKey, groupLabel);
        state._wrForm.maker = hdr.maker || '';
        state._wrForm.modelType = hdr.modelType || '';
        state._wrForm.capacity = hdr.capacity || '';
        state._wrForm.serialNo = hdr.serialNo || '';
        if (prev !== groupKey) {
            state._wrForm.jobName = state._wrForm.jobName || '';
            state._wrJobItems = [TVC_SpareMenu.newConsumeJobRow()];
            state._wrJobId = null;
        }
        closeWrPickMenu(document.getElementById('wrGroupPick'));
        renderWorkReportModal();
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
        const text = wf('pmsGroupNo') ? TVC_SpareMenu.safeTreeLabel(wf('pmsGroupNo')) : '— PMS Group 선택 —';
        if (ro) return `<input class="wr-ro" value="${esc(text)}" readonly>`;
        return `<div class="spare-consume-meta-pick" id="wrGroupPick"><button type="button" class="spare-consume-pick-trigger" onclick="TVC_App.toggleWrGroupPick(event)">
            <span class="spare-consume-pick-text">${esc(text)}</span><span class="spare-consume-pick-caret">▾</span></button>
            <div class="spare-consume-pick-menu"><div class="spare-consume-pick-search"><input type="search" class="search-input" placeholder="Search GROUP…" oninput="TVC_App.wrGroupPickSearch(this.value)" onclick="event.stopPropagation()"></div>
            <div class="spare-consume-pick-scroll" id="wrGroupPickList"></div></div></div>`;
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
        const isRepConfirmed = !!rep && TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked);
        const isRepApproved = !!rep && reportIsApproved(rep);
        const hqDirectApprove = !!rep && !isRepApproved && TVC_RBAC.canHqDirectApprove(user, rep);
        const editMode = !ro;
        const canConfirmNow = !isHq && !!rep && !!job && TVC_RBAC.canConfirmDepartment(user, job.department)
            && (TVC_RBAC.isReportedStatus(rep.status, rep.is_locked)
                || (editMode && isRepConfirmed && !isRepApproved));
        const canApproveNow = !!rep && !isRepApproved && TVC_RBAC.canApproveHqReport(user)
            && (isRepConfirmed || hqDirectApprove)
            && (!isHq || editMode);
        const confirmedByVal = isRepConfirmed
            ? (TVC_RBAC.resolveConfirmByLabel?.(rep?.confirmed_by, job?.department, user) || '')
            : '';
        const approvedByVal = isRepApproved
            ? (rep?.approved_by || hqSuperintendentLabel(user))
            : '';
        const canEditCompanyComment = canApproveNow;
        return {
            isHq, isRepConfirmed, isRepApproved, canConfirmNow, canApproveNow,
            confirmedByVal, approvedByVal, canEditCompanyComment, hqDirectApprove,
        };
    }

    function wrApprovedByToggle() {
        const apCb = document.getElementById('wrApprovedBy');
        if (!apCb || apCb.disabled) return;
        const user = TVC_Auth.getCurrentUser();
        if (!user || !TVC_RBAC.isHqAccount(user)) return;
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const input = apCb.closest('.wr-maint-approval-item')?.querySelector('.wr-maint-date');
        const superLabel = hqSuperintendentLabel(user);
        if (!apCb.checked) {
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
        if (input) input.value = superLabel;
    }

    async function applyWrHqApprovalFromUi(user, rep) {
        if (!user || !rep || reportIsApproved(rep)) return rep;
        const apCb = document.getElementById('wrApprovedBy');
        if (!apCb || apCb.disabled || !apCb.checked) return rep;
        if (!TVC_RBAC.canApproveHqReport(user)) return rep;
        if (!TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked) && !TVC_RBAC.canHqDirectApprove(user, rep)) {
            return rep;
        }
        const approvedPostponeDate = document.getElementById('wrApprovedPostponeDate')?.value
            || rep.approved_postpone_date || rep.postpone_date || '';
        if (postponeRequiresCompanyApproval(rep) && !approvedPostponeDate) {
            throw Object.assign(new Error('Approved Enter Postpone Date.'), { code: 'VALIDATION' });
        }
        const companyComment = readWrCompanyComment(rep);
        await TVC_Transaction.approveReport(user, rep.id, companyComment, { approvedPostponeDate });
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
                    pmsInner: roWf('pmsGroupNo', hdr.pmsGroupNo || job.group || ''),
                    criticalLabel: jobCriticalEquipmentDisplay(job, hdr.pmsGroupNo || job.group),
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
            isCriticalPostpone = false,
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
        const approvedPostponeDefault = rep?.approved_postpone_date || rep?.postpone_date || wf('postponeDate') || '';
        const jobInfoBlock = renderWrJobRowsBlock(job, rep, ro, forPrint);
        const approvedPostponeField = isCriticalPostpone && (canApproveNow || isRepApproved)
            ? fld('Approved Postpone Date',
                forPrint || (isRepApproved && !canApproveNow)
                    ? wrDateUiPrintInput(rep?.approved_postpone_date || approvedPostponeDefault)
                    : (canApproveNow && !isRepApproved
                        ? `<input type="date" id="wrApprovedPostponeDate" value="${esc(approvedPostponeDefault)}">`
                        : `<input class="wr-ro" id="wrApprovedPostponeDate" value="${esc(rep?.approved_postpone_date || '—')}" readonly>`),
                'wr-maint-span-all wr-postpone-approved-date')
            : '';

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
                    pmsInner: roWf('pmsGroupNo', hdr.pmsGroupNo || job.group || ''),
                    criticalLabel: jobCriticalEquipmentDisplay(job, hdr.pmsGroupNo || job.group),
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
                    ${fld('Original Due Date', forPrint ? `<input class="wr-ro" value="${esc(job.next_date || '—')}" readonly tabindex="-1">` : `<input class="wr-ro" value="${esc(job.next_date || '—')}" readonly>`)}
                    ${fld('Postpone Date', forPrint
                        ? `<input class="wr-ro" value="${esc(wf('postponeDate') || '')}" readonly tabindex="-1">`
                        : `<input type="date" class="tvc-date-input" data-wf="postponeDate" placeholder="YYYY-MM-DD" value="${esc(wf('postponeDate'))}"${ro ? ' disabled' : ''}>`, 'wr-postpone-date')}
                </div>
                ${approvedPostponeField}
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
        const confirmDis = forPrint || !canConfirmNow ? ' disabled' : '';
        const approveDis = forPrint || !canApproveNow ? ' disabled' : '';
        const confirmOnchange = forPrint ? '' : ' onchange="TVC_App.wrReportConfirmByToggle()"';
        const approveOnchange = forPrint ? '' : ' onchange="TVC_App.wrApprovedByToggle()"';
        const approvedRow = hideApprovedBy ? '' : `
            <div class="wr-maint-approval-item${!forPrint && canApproveNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="wrApprovedBy" ${isRepApproved ? 'checked' : ''}${approveDis}${approveOnchange}> Approved by</label>
                <input class="wr-ro wr-maint-date" value="${esc(approvedByVal)}" readonly>
            </div>`;
        return `<section class="wr-maint-card wr-maint-approval">
            <div class="wr-maint-approval-item${!forPrint && canConfirmNow ? ' is-active' : ''}">
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
        const items = list.map(a => `
            <li class="wr-attach-item">
                ${forPrint
                    ? `<span class="wr-attach-link">📎 ${esc(a.name)}</span>`
                    : `<a class="wr-attach-link" href="${escAttr(a.dataUrl)}" download="${escAttr(a.name)}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>`}
                <span class="wr-attach-size">${Math.max(1, Math.round(a.size / 1024))}KB</span>
                ${(!forPrint && canUpload) ? `<button type="button" class="wr-attach-remove" title="Remove" onclick="TVC_App.removeWrAttachment('${kind}','${escAttr(a.id)}')">×</button>` : ''}
            </li>`).join('');
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

    async function uploadWrAttachment(kind) {
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
        const isCriticalPostpone = tab === 'postpone' && state._batchJobIds.some(id => {
            const j = state.idx?.jobById.get(id);
            return j && jobShowsCriticalEquipmentMark(j);
        });

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
                isCriticalPostpone,
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
        if (lockedTab) state._wrTab = lockedTab;
        const tabBtns = Object.entries(WR_TABS).map(([k, label]) => {
            const tabLocked = !!(lockedTab && k !== lockedTab);
            return `<label class="wr-radio${state._wrTab === k ? ' active' : ''}${tabLocked ? ' locked' : ''}"${tabLocked ? ' title="This report type cannot be changed"' : ''}>
                <input type="radio" name="wrTab" ${state._wrTab === k ? 'checked' : ''}${tabLocked ? ' disabled' : ''} onclick="TVC_App.setWorkReportTab('${k}')"> ${esc(label)}
            </label>`;
        }).join('');
        const wrJobItems = ensureWrJobItems(job, rep);
        const isCriticalPostpone = state._wrTab === 'postpone' && (
            rep ? postponeRequiresCompanyApproval(rep) : wrJobItemsShowCriticalPostpone(wrJobItems)
        );
        const isRepConfirmed = !!rep && TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked);
        const isRepApproved = !!rep && reportIsApproved(rep);
        const wrAppr = wrHqApprovalUiState(rep, job, ro);
        const {
            canConfirmNow, canApproveNow, confirmedByVal, approvedByVal, canEditCompanyComment,
        } = wrAppr;
        const reportedByName = workReportReportedByName(rep);
        const canEditShipAttach = !ro && (!rep || TVC_RBAC.isReportedStatus(rep.status));
        const canEditCompanyAttach = !ro && !!canApproveNow;

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
                ro, isCriticalPostpone,
            });
        }

        const isHist = !!state._wrReportId;
        const histEntry = isHist ? getCurrentWrHistEntry() : null;
        const canModifyRow = histEntry && canModifyHistEntry(histEntry);
        const canDeleteRow = histEntry && canDeleteHistEntry(histEntry);
        const navBtns = isHist
            ? histNavButtonsHtml('TVC_App.navReport(-1)', 'TVC_App.navReport(1)')
            : '';
        const printBtn = isHist
            ? `<button class="btn" onclick="TVC_App.printWorkReport()">Print</button>
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
        const titleText = isHist
            ? 'Work Report'
            : (isNewUnsavedWorkReportSession() ? 'Work Report (Draft)' : (ro ? 'Work Report (View)' : 'Work Report'));

        host.innerHTML = `
            <div class="wr-titlebar">${titleText}</div>
            <div class="wr-tabsel">${tabBtns}</div>
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
                    ? (postponeRequiresCompanyApproval(rep)
                        ? `${rep.job_code} critical postpone report confirmed. (NEXT DATE updated · Awaiting company approval / export)`
                        : `${rep.job_code} postpone report confirmed. (NEXT DATE updated)`)
                    : `${rep.job_code} report confirmed. (Stock deduction · LAST DONE / NEXT DATE update)`;
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
                const sched = postponeRequiresCompanyApproval(rep)
                    ? ` (NEXT DATE → ${document.getElementById('wrApprovedPostponeDate')?.value || rep.approved_postpone_date || rep.postpone_date || ''})`
                    : '';
                await TVC_Dialog.alert(`${rep.job_code} report approved by company.${sched}`);
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
        restorePlanBatchSelection();
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

    async function saveWorkReport() {
        if (!await TVC_Dialog.confirm({ kind: 'save', message: 'Save this Work Report?' })) return;
        captureWorkReportForm();
        if (state._wrPage === '2') TVC_SpareMenu.persistWrSpareUsedParts();
        captureWorkReportUsedParts();
        captureWrJobItems();
        let job = state.idx.jobById.get(state._wrJobId);
        const codedItems = (state._wrJobItems || []).filter(i => String(i.job_code || '').trim());
        if (!job && codedItems.length) {
            const first = codedItems[0];
            job = (first.maintenance_job_id && state.idx.jobById.get(first.maintenance_job_id))
                || state.jobs.find(j => j.job_code === first.job_code);
            if (job) state._wrJobId = job.id;
        }
        if (!job) return;
        const user = await TVC_Auth.requirePermission(TVC_RBAC.Action.CREATE_DAILY_REPORT);
        if (!user) return;
        const form = { ...state._wrForm };
        const tab = state._wrTab;
        const existingRep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;

        if (tab === 'postpone' && !form.postponeDate) {
            await TVC_Dialog.alert('Enter Postpone Date.');
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
                    : `${WR_TABS[tab]} 보고가 수정되었습니다.`)
                : tab === 'postpone'
                    ? `${WR_TABS[tab]} 보고가 저장되었습니다. (NEXT DATE → ${form.postponeDate})`
                    : `${WR_TABS[tab]} 보고가 저장되었습니다. (${status})`);
        } catch (e) { await TVC_Dialog.alert(e.message || e.code); }
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
        if (user.department && user.department !== job.department) await TVC_Dialog.alert('타 부서 항목은 보고할 수 없습니다.');
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
        if (!TVC_RBAC.canApproveDepartment(user, job.department)) await TVC_Dialog.alert('타 부서 항목은 승인할 수 없습니다.');
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
            await TVC_Dialog.alert(`Other department (${dept || '?'}) 리포트는 Confirm할 수 없습니다. 범위: ${TVC_RBAC.getDeptLabel(user.department)}`);
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
        return `${printListMeta('Work Plan')}
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
        return `${printListMeta('Work History')}
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
            title = 'Work Plan';
            body = buildWorkPlanPrintBody();
        } else if (tab === 'history') {
            title = 'Work History';
            body = buildWorkHistoryPrintBody();
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
            await TVC_Dialog.alert(`${TVC_Space.stationLabel(user.station)} 데이터가 Captain Hub용 패키지로보내졌습니다.`);
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function handleCompanyExport() {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        try {
            await TVC_StationSync.exportCompanyPackage(user);
            await refreshAll();
            if (state.currentTab === 'menu') renderSyncHistory();
            await TVC_Dialog.alert('회사 보고용 데이터 패키지가 생성되었습니다.');
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function handleHubImport(file) {
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
            await TVC_StationSync.importStationPackage(user, file);
            await refreshAll();
            if (state.currentTab === 'menu') { renderSyncHistory(); renderCaptainViewDashboard(); }
            await TVC_Dialog.alert('Station 데이터 병합(Merge)이 완료되었습니다.');
        } catch (e) { await TVC_Dialog.alert(e.message); }
    }

    async function handleDefectImport(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        try {
            if (TVC_RBAC.isHqAccount(user)
                || (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user))) {
                requireAppDepartment();
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
                requireAppDepartment();
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
                requireAppDepartment();
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
            await TVC_Dialog.alert('Data Export & Import는 Chief officer (co) · Chief engineer (ce) · Captain만 수행할 수 있습니다.');
            return;
        }
        if (!TVC_RBAC.can(user, user.account_type === 'HQ' ? TVC_RBAC.Action.EXPORT_HQ_FEEDBACK : TVC_RBAC.Action.EXPORT_SHIP_SYNC)) {
            await TVC_Dialog.alert('Data Export & Import는 Chief officer (co) · Chief engineer (ce) · Captain만 수행할 수 있습니다.');
            return;
        }
        pickDepartmentThen('Export할 부서를 선택하세요 (DECK / ENGINE)', async (dept) => {
            try {
                const direction = (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user))
                    ? TVC_Space.Direction.STATION_TO_HUB
                    : (user.account_type === 'HQ' ? 'HQ_TO_SHIP' : 'SHIP_TO_HQ');
                const opts = direction === TVC_Space.Direction.STATION_TO_HUB
                    ? { station_id: TVC_Space.getStation(user), monthlyExport: monthlyExportUsesSnapshot(user, dept) }
                    : { monthlyExport: true };
                await TVC_Sync.exportZip(user, direction, dept, opts);
                await refreshAll();
                if (state.currentTab === 'menu') renderSyncHistory();
                const vesselId = (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || user.vessel_id || 'VESSEL_ID';
                await TVC_Dialog.alert(`${TVC_RBAC.getDeptLabel(dept)} 데이터 ZIP이 내보내졌습니다. (${vesselId}_${dept}_PMS_EXPORT_…zip)`);
            } catch (e) { await TVC_Dialog.alert(e.message); }
        });
    }

    async function handleImport(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        const importAction = user.account_type === 'HQ' ? TVC_RBAC.Action.IMPORT_HQ_SYNC : TVC_RBAC.Action.IMPORT_SHIP_SYNC;
        if (!TVC_RBAC.can(user, importAction)) {
            await TVC_Dialog.alert('Data Import 권한이 없습니다.');
            return;
        }
        const xferUser = typeof TVC_Space !== 'undefined' ? { ...user, station: TVC_Space.getStation(user) } : user;
        if (typeof TVC_Space !== 'undefined' && xferUser.station && !TVC_Space.canStationDataXfer(xferUser)) {
            await TVC_Dialog.alert('Data Export & Import는 Chief officer (co) · Chief engineer (ce) · Captain만 수행할 수 있습니다.');
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
        const dept = state._pendingImportDept || user.department;
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
                ? `\nOriginal Plan Update 기능이 다시 활성화되었습니다.`
                : '';
            const vesselNote = (TVC_RBAC.isHqAccount(user) && payload?.export_meta?.vessel_id)
                ? `\n선박: ${TVC_Fleet.resolveById(payload.export_meta.vessel_id)?.name || payload.export_meta.vessel_id}`
                : '';
            await TVC_Dialog.alert(`${TVC_RBAC.getDeptLabel(dept)} 데이터 Import 완료${vesselNote}${unlockNote}`);
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
        };
    }

    async function openMasterBackupModal(scope = 'pms') {
        if (!state.user) return;
        if (typeof TVC_MasterBackup === 'undefined') {
            await TVC_Dialog.alert('Backup 모듈을 사용할 수 없습니다.');
            return;
        }
        _masterBackupScope = scope === 'spare' ? 'spare' : 'pms';
        const label = TVC_MasterBackup.scopeLabel(_masterBackupScope);
        const hint = document.getElementById('masterBackupHint');
        const note = document.getElementById('masterBackupNote');
        if (hint) {
            hint.textContent = _masterBackupScope === 'spare'
                ? 'SPARE 탭 Master Data(Spare Parts · Catalog)를 백업하거나 복구합니다.'
                : 'Menu(PMS) Master Data(Jobs · Groups · Equipment · BOM · Running Hours)를 백업하거나 복구합니다.';
        }
        if (note) {
            note.textContent = `${label} · Backup은 ZIP 저장, Restore는 선택한 백업으로 현재 Master Data를 교체합니다.`;
        }
        showModal('masterBackupModal');
    }

    function closeMasterBackupModal() {
        closeModal('masterBackupModal');
    }

    async function runMasterBackup() {
        const user = state.user || TVC_Auth.getCurrentUser();
        if (!user) return;
        if (typeof TVC_MasterBackup === 'undefined') await TVC_Dialog.alert('Backup 모듈을 사용할 수 없습니다.');
        try {
            const r = await TVC_MasterBackup.exportBackup(_masterBackupScope, user, masterBackupOpts());
            const parts = Object.entries(r.counts || {}).map(([k, n]) => `${k}: ${n}`).join(', ');
            await TVC_Dialog.alert(`${TVC_MasterBackup.scopeLabel(r.scope)} Backup 완료\n${r.filename}\n${parts}`);
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
        if (typeof TVC_MasterBackup === 'undefined') await TVC_Dialog.alert('Backup 모듈을 사용할 수 없습니다.');
        const label = TVC_MasterBackup.scopeLabel(_masterBackupScope);
        if (!await TVC_Dialog.confirm({ message: 
            `${label}를 선택한 백업 파일로 교체합니다.\n` +
            '현재 Master Data는 덮어씌워집니다. 계속할까요?'
         })) return;
        try {
            const r = await TVC_MasterBackup.restoreBackup(_masterBackupScope, file, user, masterBackupOpts());
            closeMasterBackupModal();
            await refreshAll();
            if (_masterBackupScope === 'spare' && typeof TVC_SpareMenu !== 'undefined') {
                await TVC_SpareMenu.render?.();
            }
            const parts = Object.entries(r.counts || {}).map(([k, n]) => `${k}: ${n}`).join(', ');
            await TVC_Dialog.alert(`${label} Restore 완료\nVessel: ${r.vesselId || '—'}\n${parts}`);
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
        if (typeof TVC_PmsMasterExcel === 'undefined') { await TVC_Dialog.alert('PMS Master Export를 사용할 수 없습니다.'); return; }
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
        if (typeof TVC_PmsMasterExcel === 'undefined') { await TVC_Dialog.alert('PMS Master Import를 사용할 수 없습니다.'); return; }
        if (!await TVC_Dialog.confirm({ message: `Import PMS Master Excel?\n\n${file.name}\n\nExcel 기준으로 Group · Equipment · Jobs를 반영합니다.\n시트에서 제거된 job은 삭제됩니다 (Work Report 연결 job은 임시 CODE로 유지).\n권장: Import 전 Database Backup.\n\nContinue?` })) return;
        try {
            const department = requireAppDepartment();
            const r = await TVC_PmsMasterExcel.importFromFile(file, user, { department, ...masterVesselOpts() });
            await refreshAll();
            const orphanLine = (r.removed || r.detached)
                ? `\n제외: ${r.removed || 0} · Work Report 격리: ${r.detached || 0}`
                : '';
            const vesselLine = r.vessel_id ? `\nVessel: ${r.vessel_id}` : '';
            await TVC_Dialog.alert(`Import 완료${vesselLine}\n\nJobs: ${r.jobs}행 (신규 ${r.created}, 수정 ${r.updated}, CODE 변경 ${r.renamed})${orphanLine}\nGroups: ${r.groups} · Equipment: ${r.equipment}`);
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Import failed');
        }
    }

    async function exportSpareMasterExcel() {
        if (!canSpareMasterExcel()) { await TVC_Dialog.alert(spareMasterExcelDeniedMessage()); return; }
        if (!await confirmMasterExcelPassword('export SPARE Master')) return;
        if (typeof TVC_SpareMasterExcel === 'undefined') { await TVC_Dialog.alert('SPARE Master Export를 사용할 수 없습니다.'); return; }
        try {
            const department = requireAppDepartment();
            await TVC_SpareMasterExcel.exportToFile({ department, simplifyCodes: true, ...masterVesselOpts() });
            if (typeof TVC_SpareMenu?.reloadSparesCache === 'function') await TVC_SpareMenu.reloadSparesCache();
            await refreshAll();
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Export failed');
        }
    }

    async function exportSpareMasterSetupTemplate() {
        if (!canSpareMasterExcel()) await TVC_Dialog.alert(spareMasterExcelDeniedMessage());
        if (typeof TVC_SpareMasterExcel === 'undefined') await TVC_Dialog.alert('SPARE Master Export를 사용할 수 없습니다.');
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
        if (typeof TVC_SpareMasterExcel === 'undefined') { await TVC_Dialog.alert('SPARE Master Import를 사용할 수 없습니다.'); return; }
        const backupHint = '권장: Import 전 If Necessary → Database Backup & Restore로 SPARE 백업을 먼저 수행하세요.';
        if (!await TVC_Dialog.confirm({ message: `Import SPARE Master Excel?\n\n${file.name}${state.selectedVesselId && TVC_RBAC.isHqAccount(user) ? `\nTarget vessel: ${state.selectedVesselId}` : ''}\n\nGroup Headers, Equipment Headers, and Spare Parts will be updated.\nCodes use GG-EE-III (Group-Equipment-Item).\n${backupHint}\n\nContinue?` })) return;
        try {
            const department = requireAppDepartment();
            const r = await TVC_SpareMasterExcel.importFromFile(file, user, { department, simplifyCodes: true, ...masterVesselOpts() });
            if (typeof TVC_SpareMenu?.reloadSparesCache === 'function') await TVC_SpareMenu.reloadSparesCache();
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
            await TVC_Dialog.alert(`Import 완료${vesselLine}\n\nSpare Parts: ${r.parts}행 (신규 ${r.created}, 수정 ${r.updated})\nGroups: ${r.groups} · Equipment: ${r.equipment}${codeLine}${renameLine}${foreignLine}${relinkLine}`);
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
        setFleetView, setFleetSearch, selectVessel,
        setAdminSearch, selectAdminCompany, selectAdminVessel,
        openAdminCompanyForm, openAdminVesselForm, closeAdminRegistryModal,
        openAdminSeatLicenseModal, closeAdminSeatLicenseModal,
        adminSeatLicensePickKey, adminSeatLicenseLoadFile, adminSeatLicenseSetMonths,
        adminSeatLicenseSetCompany, adminSeatLicenseSetVessel, adminSeatLicenseIssueAndSave,
        openAdminSetupExportModal, closeAdminSetupExportModal,
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
        adminSetupExportPickFolder, adminSetupExportSetCompany, adminSetupExportSetVersion,
        adminSetupExportSetNotes, adminSetupExportSetRecordDeploy, adminSetupExportToggleSku, adminSetupExportRun,
        saveAdminCompanyForm, saveAdminVesselForm, deactivateAdminCompany, deactivateAdminVessel,
        setSearch, setTreeSearch, clearSearchField, clearListFilterSearch, updateSearchClearBtn, updateSearchClearBtnForEl, ensureSearchClearUi, bindSearchClearInput, bindListFilterSearchClear, bindTabSearchClearInputs, sortJobs, setActualFilter, onActualPeriodChange, clearActualPeriod, onReportPeriodChange, clearReportPeriod, syncReportPeriodInputs, hasReportPeriodFilter, defectCaseReportDate, listReportedDateStr, compareDefectCaseByReportedDate, matchReportPeriodDate, selectGroup, isTreeDeptCollapsed, toggleTreeDept, renderGroupTree,
        getListFilterState, setListFilters, clearListFilters, syncListFilterBtns, listFilterCtx,
        jobShowsCriticalEquipmentMark, jobCriticalEquipmentDisplay, renderWrPmsGroupCriticalRow,
        reportMatchesPostponeAwaitingApproval,
        getAppDepartment, getAppUserDepartment, getSelectedGroupKey, getSpareSelectedGroupKey, getAppIdx, getAppJobs, resolveJobByCode,
        workPermitBelongsToDept, filterWorkPermitsForView,
        renderSectionCard,
        openJobDetail, openWorkProcedure, openPlanWorkProcedure, onPlanRowClick, setWorkProcedureTab,
        enterWorkProcedureEdit, cancelWorkProcedureEdit, saveWorkProcedure, uploadWorkProcedureAttachment, removeWorkProcedureAttachment,
        refreshWorkProcedureIfOpen, isModalOpen, isWorkProcedureHistNav, applyModalOverWorkProcedure, clearModalOverWorkProcedure,
        openProcedureHistory, openProcedureHistoryByCode,
        openWorkReport, openWorkReportInput, setWorkReportTab, setWorkReportPage, saveWorkReport, captureWorkReportForm,
        uploadWrAttachment, removeWrAttachment,
        toggleWrGroupPick, toggleWrJobPick, pickWrGroup, pickWrJob, wrGroupPickSearch, wrJobPickSearch,
        addWrJobRow, removeWrJobRow, toggleWrJobRowPick, pickWrJobForRow, wrJobRowPickSearch,
        toggleBatchJob, toggleBatchSelectAll, openBatchReport, saveBatchReport,
        syncPlanBatchCheckForJob, syncPlanBatchChecksFromJobItems, buildJobItemsFromJobIds,
        snapshotPlanBatchSelection, restorePlanBatchSelection, clearPlanBatchSnapshot,
        togglePlanSelectedOnly, toggleActSelectedOnly, renderPlanGroupHeader, refreshActualPlan,
        openNewDefectReportInput, openNewDefectFromPlan,
        setBatchActiveJob, setWrBatchViewJob, openBatchJobPicker, closeBatchJobPicker, closeBatchReport,
        openWorkReportFromHistory, openDefectFromHistory, openWorkHistoryEntry, navWorkHistoryEntry, syncHistRowSelection,
        histNavButtonsHtml, workHistoryNavBounds,
        modifyWorkReport, cancelWorkReportEdit, selectHistRow, renderWorkHistory, histDefectRowKey,
        buildDefectHistRowHtml, matchDefectHistSearch, initHistCellTips,
        formatHistGroupEquipmentName, isPlaceholderJobCode, defectEffectiveJobCode,
        histDetailWorkReport, histModifyReport, histReportApproval, histHqReportApproval, histDeleteReport,
        toggleHistCheck, toggleHistSelectAll,
        navReport, deleteWorkReport, printWorkReport, previewWorkReport, wrReportConfirmByToggle, wrApprovedByToggle, closeWorkReport, requestCloseWorkReport,
        openFileNoPickModal, closeFileNoPickModal, fileNoPickSearch, applyFileNoPick,
        
        selectJobRow,
        selectSpareRow, focusSpareRow, toggleSpareRow, syncSpareItemToolbar, spareActionIds, canEditSpareItems, openSpareAppend, openSpareModify, deleteSpareItem,
        saveRunHrs, updateRunHrs, revertRunHrs, runHrsPreview, runHrsTotalEdit,
        openRunHoursModal, closeRunHoursModal,
        updateOriginalPlanFromRunHours, approveWorkPlanFromHq,
        openOrigJobModify, openOrigJobAppend, saveOrigJobEditor, saveOrigJobInlineEdit, cancelOrigJobInlineEdit, deleteOrigJob,
        isOrigJobInlineEditing, getOrigJobInlineEquipmentDraft,
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
        menuXferConfirmDefectExport, menuXferConfirmDefectExportAll,
        menuXferConfirmPostponeExport, menuXferConfirmPostponeExportAll, menuXferConfirmMonthlyExport,
        menuXferConfirmVesselProfileExport, menuXferApplyVesselProfile,
        menuXferAppUpdateToggleSku, menuXferAppUpdateSetVersion, menuXferAppUpdateSetNotes,
        menuXferAppUpdateSetCompany, menuXferAppUpdateSetRecordDeploy,
        menuXferAppUpdatePickSetup, menuXferAppUpdateOnSetupFile, menuXferConfirmAppUpdateExport,
        menuXferApplyAppUpdate,
        menuXferTryOnlineSync,
        menuXferExportDefect, menuXferExportPostpone, menuXferExportWorkPermit, menuXferExportMonthly, onMenuXferImportFile,
        menuXferConfirmWorkPermitExport, menuXferConfirmWorkPermitExportAll,
        menuXferOpenDefectSelect, menuXferOpenPostponeSelect, menuXferOpenWorkPermitSelect,
        openMenuHistoryModal, closeMenuHistoryModal, setMenuHistCategory, menuHistPeerLabel,
        openMasterBackupModal, closeMasterBackupModal, runMasterBackup, triggerMasterRestore, onMasterRestoreFile,
        uploadAttachment, saveDetailReport, closeModal, showModal, swapHistoryModals, dismissSpicsAlerts, openSpicsRequisition,
        buildWorkReportPage2PrintHtmlFromReport,
    };
})();

document.addEventListener('DOMContentLoaded', () => TVC_App.boot());
window.TVC_App = TVC_App;
