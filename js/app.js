/* THE VESSEL CODE — Main Application (v3.0 · CMAXS Tab Navigation) */
const TVC_App = (function () {
    const ROW_H = 36;
    const PLAN_SHEET_MIN_WIDTH = 924;
    const DEPT_TREE_ORDER = ['ENGINE', 'DECK'];
    const TABS = ['menu', 'actual', 'defect', 'history', 'runhrs', 'spare'];
    const CRITICAL_GROUP_KEY = '__CRITICAL_EQUIPMENT__';
    const NEW_ORIG_JOB_EDIT_ID = '__new_orig_job__';
    let _wrSpareSearchT = null;
    let _planRowRefreshTimer = null;
    let _planRowLastTap = { id: null, t: 0 };
    let _menuXfer = { step: 'mode' };

    function repSt(r) { return TVC_RBAC.normalizeReportStatus(r?.status, !!r?.is_locked); }
    function itemSt(item) { return TVC_RBAC.normalizeReportStatus(item?.status); }

    let state = {
        user: null,
        components: [], jobs: [], groups: [], spares: [], reports: [], defectCases: [],
        idx: null,
        selectedGroupKey: null,
        treeSearch: '',
        actualFilter: 'total',        // total | overdue | due30 | postponed | critical
        actualPeriodFrom: '',         // YYYY-MM-DD Due date range (Work Plan)
        actualPeriodTo: '',
        reportPeriodFrom: '',         // YYYY-MM-DD Reported Date (Defect · Work History)
        reportPeriodTo: '',
        listFilters: {
            actual: { pics: [], unassigned: false },
            defect: { groupKeys: [], openOnly: false },
            history: { groupKeys: [], type: 'all' },
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
        _wrPostSaveView: false,
        _wrFromHistory: false,
        department: 'ENGINE',
        station: null,                     // CCR | ECR | CAPTAIN
        captainView: 'all',                // all | deck | engine (Captain Hub dashboard)
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
        _batchDraft: null,       // Batch Report 편집 중 임시 데이터
        _batchMode: false,
        _batchJobIds: [],
        _batchSpareSearch: {},
        _batchJobPickerOpen: false,
        _histSelReportId: null,   // Work History 선택 행 (reportId|jobId)
        _histChecked: {},         // Work History 승인용 체크박스 { rowKey: true }
    };

    let bootReady = false;
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
            console.warn('[TVC] boot watchdog — unlocking login UI');
            finishBootReady();
            showLogin();
            const errEl = document.getElementById('loginErr');
            if (errEl && !errEl.textContent) {
                errEl.textContent = '시스템 준비가 지연되고 있습니다. 잠시 후 다시 로그인하거나 Ctrl+Shift+R 로 새로고침하세요.';
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
            try { await TVC_Fleet.ensureFleet(); } catch (e) { console.warn('[TVC_Fleet]', e); }

            const seed = await TVC_Seed.ensureSeed();
            if (seed.needFile) document.getElementById('seedBanner')?.classList.remove('hidden');
            try { await TVC_Seed.ensureInventoryDefaults(); } catch (e) { console.warn('inventory defaults', e); }
            try {
                const xls = await TVC_Seed.ensureSpareInventoryXls();
                if (xls.loaded) console.info('[SPARE] Engine inventory:', xls.stats?.spares, 'parts');
                else if (xls.fileProtocol) console.info('[SPARE] file:// — use npm run serve or file picker');
            } catch (e) { console.warn('spare inventory xls', e); }

            if (TVC_Env.isFileProtocol()) {
                document.getElementById('fileProtocolBanner')?.classList.remove('hidden');
                document.getElementById('loginFileBanner')?.classList.remove('hidden');
                document.getElementById('fileProtocolModal')?.classList.remove('hidden');
            }
            state._deferredBootDone = true;
        } finally {
            state._deferredBootRunning = false;
        }
    }

    // ── Boot ─────────────────────────────────────────────────────────
    async function boot() {
        bootReady = false;
        bootReadyPromise = new Promise(resolve => { bootReadyResolve = resolve; });
        setLoginBusy(true, '시스템 준비 중…');
        startBootWatchdog();
        try {
            await TVC_DB.open();
            await TVC_Auth.initUsers();

            ['loginUser', 'loginPass', 'loginDept'].forEach(id => {
                document.getElementById(id)?.addEventListener('keydown', e => {
                    if (e.key === 'Enter') handleLogin();
                });
            });
            bindTabSearchClearInputs();
            try { TVC_ListFilters?.init(); } catch (e) { console.error('[TVC] ListFilters init', e); }

            const sessionUser = await TVC_Auth.refreshSessionFromDb();
            try {
                TVC_RunHours.init({
                    getState: () => state,
                    refresh: refreshAll,
                    allWorkHistoryConfirmed,
                    isWorkHistoryEntryConfirmed,
                    workHistoryEntriesRaw,
                    canUpdateRunningHours,
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
                TVC_OutstandingTasks.init({
                    getState: () => state,
                    deptJobs,
                    jobMatchesActualFilter,
                    jobActualStatusKind,
                    menuNavigate,
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
                    if (errEl) errEl.textContent = e.message || '자동 로그인에 실패했습니다. 다시 로그인하세요.';
                });
            } else {
                showLogin();
            }
        } catch (e) {
            console.error('[TVC] boot failed', e);
            const errEl = document.getElementById('loginErr');
            if (errEl) errEl.textContent = e.message || '시스템 초기화 중 오류가 발생했습니다.';
            showLogin();
        } finally {
            clearTimeout(_bootWatchdog);
            finishBootReady();
        }
    }

    /** 부서별 데이터 독립성(영구 분리): 선박 계정은 로드 단계에서부터 자기 부서 데이터만 취득한다. */
    /** PMS Group 부서 재분류: Engine Work Plan과 분리 — 지정 그룹은 DECK 전용 */
    const FORCE_DECK_GROUP_NOS = new Set([24, 25, 26, 28, 29, 30, 33, 35]);

    function pmsGroupNoFromLabel(label) {
        const mm = String(label || '').trim().match(/^(\d+)\s*\./);
        return mm ? parseInt(mm[1], 10) : null;
    }

    async function normalizeGroupDepartments(jobs, components, groups) {
        const changedJobs = [];
        (jobs || []).forEach(j => {
            const n = pmsGroupNoFromLabel(j.group);
            if (n != null && FORCE_DECK_GROUP_NOS.has(n) && j.department !== 'DECK') {
                j.department = 'DECK';
                changedJobs.push(j);
            }
        });
        const changedComps = [];
        (components || []).forEach(c => {
            const grpLabel = Array.isArray(c.path) ? c.path[1] : null;
            const n = pmsGroupNoFromLabel(grpLabel);
            if (n == null || !FORCE_DECK_GROUP_NOS.has(n)) return;
            let changed = false;
            if (Array.isArray(c.path) && c.path[0] && c.path[0] !== 'DECK') {
                c.path = ['DECK', ...c.path.slice(1)];
                changed = true;
            }
            if (c.department && c.department !== 'DECK') { c.department = 'DECK'; changed = true; }
            if (changed) changedComps.push(c);
        });
        const changedGroups = [];
        (groups || []).forEach(g => {
            const n = pmsGroupNoFromLabel(g.label);
            if (n != null && FORCE_DECK_GROUP_NOS.has(n) && g.department !== 'DECK') {
                g.department = 'DECK';
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

    async function applyActiveReportSchedules() {
        const jobById = new Map((state.jobs || []).map(j => [j.id, j]));
        const dirty = [];
        (state.reports || []).forEach(r => {
            TVC_WorkReport.fromLegacy(r);
            if (!TVC_RBAC.isReportedStatus(r.status) && !TVC_RBAC.isConfirmedStatus(r.status)) return;
            (r.job_items || []).forEach(item => {
                const job = jobById.get(item.maintenance_job_id);
                if (!job) return;
                const form = item.form || r.report_form || {};
                if (r.work_type === 'POSTPONE') {
                    const postponeDate = String(r.postpone_date || form.postponeDate || '').slice(0, 10);
                    if (!postponeDate) return;
                    const overdue = new Date(postponeDate) < new Date(new Date().toDateString());
                    if (job.next_date === postponeDate && job.schedule_basis === 'POSTPONE' && !!job.is_overdue === overdue) return;
                    job.next_date = postponeDate;
                    job.is_overdue = overdue;
                    job.schedule_basis = 'POSTPONE';
                    job.plan_status = 'PLANNED';
                    if (form.lastMaintDate) job.last_done = String(form.lastMaintDate).slice(0, 10);
                    dirty.push(job);
                    return;
                }
                if (r.work_type !== 'MAINTENANCE' && r.work_type !== 'TROUBLE') return;
                const lastDone = String(form.workDate || form.lastMaintDate || r.work_date || '').slice(0, 10);
                if (!lastDone) return;
                const nextDate = TVC_Transaction.calcNextDate(job, lastDone);
                const overdue = new Date(nextDate) < new Date(new Date().toDateString());
                if (job.last_done === lastDone && job.next_date === nextDate && job.plan_status === 'COMPLETED') return;
                job.last_done = lastDone;
                job.next_date = nextDate;
                job.is_overdue = overdue;
                job.plan_status = 'COMPLETED';
                if (job.schedule_basis === 'POSTPONE') job.schedule_basis = null;
                dirty.push(job);
            });
        });
        if (dirty.length) {
            const ts = new Date().toISOString();
            for (const job of dirty) {
                job.updated_at = ts;
                job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
                await TVC_DB.put('maintenance_jobs', job);
            }
        }
    }

    async function loadData() {
        const allComponents = await TVC_DB.getAll('ship_components');
        const allJobs = await TVC_DB.getAll('maintenance_jobs');
        const allGroups = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        await normalizeGroupDepartments(allJobs, allComponents, allGroups);
        const allReports = await TVC_DB.getAll('daily_work_reports');
        const allDefects = await TVC_DB.getAll('defect_cases').catch(() => []);
        state.spares = await TVC_DB.SparePart.listAll().catch(() =>
            TVC_DB.getAll('spare_parts').then(rows => rows.map(TVC_SpareSchema.fromRow)));

        // ENGINE spare inventory.xls — 로그인 후 재시도 (부품 500건 미만이면)
        if (state.spares.length < 500) {
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

        const isCaptainHub = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(state.user);
        if (state.user && !TVC_RBAC.isHqAccount(state.user) && state.user.department && !isCaptainHub) {
            const dept = state.user.department;
            state.jobs = allJobs.filter(j => j.department === dept);
            state.components = allComponents.filter(c => !c.path || c.path[0] === dept);
            state.groups = allGroups.filter(g => g.department === dept);
            const deptCodes = new Set(state.jobs.map(j => j.job_code));
            state.reports = allReports.filter(r => TVC_WorkReport.belongsToJobCodeSet(r, deptCodes));
            state.defectCases = allDefects.filter(d => TVC_DefectCase.belongsToDepartment(d, dept));
        } else if (isCaptainHub) {
            state.jobs = allJobs;
            state.components = allComponents;
            state.groups = allGroups;
            state.reports = allReports;
            state.defectCases = allDefects;
        } else {
            state.jobs = allJobs;
            state.components = allComponents;
            state.groups = allGroups;
            // HQ는 "선택한 선박"의 Import된 리포트만 확인 가능
            //  (선박에서 Export → HQ가 해당 선박 ZIP을 Import → hq_synced=true, vessel_id 태깅)
            state.reports = allReports.filter(r =>
                r.hq_synced === true &&
                (!state.selectedVesselId || r.vessel_id === state.selectedVesselId)
            );
            state.defectCases = allDefects.filter(d =>
                (d.hq_synced === true
                    || d.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
                    || d.status === TVC_DefectCase.Status.AWAITING_COMPLETION
                    || (d.status === TVC_DefectCase.Status.DRAFT && d.visible_in_list !== false)) &&
                (!state.selectedVesselId || d.vessel_id === state.selectedVesselId)
            );
        }
        state.reports.forEach(r => TVC_WorkReport.fromLegacy(r));
        await applyActiveReportSchedules();
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
        const isHq = TVC_RBAC.isHqAccount(state.user);
        state.space = isHq ? 'HQ' : 'SHIP';
        state.station = state.user.station || null;
        state.department = isHq ? null : (TVC_Space.isCaptainHub(state.user) ? null : (state.user.department || null));
        state.captainView = 'all';
        state.selectedGroupKey = null;
        state.search = '';
        updateUserBar(state.user);
        // HQ는 선박 선택을 먼저 확정해야 선박별 Run-hour scope / 데이터 필터가 올바르게 적용됨
        if (isHq) {
            state.fleet = await TVC_Fleet.ensureFleet();
            state.selectedVesselId = TVC_Fleet.getSelectedId();
            TVC_PMS.setSpace('HQ', state.selectedVesselId);
        } else {
            TVC_PMS.setSpace('SHIP');
        }
        await loadData();
        applyRoleUi(state.user);
        renderDeptToggles(state.user);
        renderCaptainViewDashboard();
        if (isHq) await populateShipHeader(state.user);
        showApp();
        switchTab('menu');
    }

    // ── View shell ───────────────────────────────────────────────────
    function showLogin() {
        document.getElementById('appShell')?.classList.add('hidden');
        document.getElementById('loginScreen')?.classList.remove('hidden');
    }
    function showApp() {
        document.getElementById('loginScreen')?.classList.add('hidden');
        document.getElementById('appShell')?.classList.remove('hidden');
    }

    const TAB_RENDERERS = {
        menu: renderMainMenu,
        actual: renderActualPlan,
        history: renderWorkHistory,
        defect: renderDefectTab,
        runhrs: renderRunHrs,
        spare: renderSpareMenu,
    };

    /** 상단 탭 전환 — 부서 필터 상태는 그대로 유지된다. */
    function switchTab(tab) {
        if (!TABS.includes(tab)) tab = 'menu';
        TVC_ListFilters?.closePopover();
        if (tab !== 'actual') state.actualSelectedOnly = false;
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
    function updateUserBar(user) {
        const badge = typeof TVC_Space !== 'undefined'
            ? TVC_Space.getModeBadge(user)
            : (TVC_RBAC.isHqAccount(user)
                ? 'HQ Mode'
                : (user.department === 'DECK' ? 'Vessel Mode - Deck'
                    : user.department === 'ENGINE' ? 'Vessel Mode - Engine'
                        : 'Vessel Mode'));
        const title = TVC_RBAC.getAccountTitle(user.username);
        document.querySelectorAll('.userBadgeEl').forEach(el => el.textContent = badge);
        document.querySelectorAll('.userNameEl').forEach(el => el.textContent = title);
        document.querySelectorAll('.userVesselEl').forEach(el => {
            if (!user.vessel_id) { el.textContent = 'Head Office'; return; }
            const v = TVC_Fleet.resolveById(user.vessel_id);
            el.textContent = v ? `Vessel: ${v.name} (${v.id})` : `Vessel: ${user.vessel_id}`;
        });
        populateShipHeader(user);
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
                try { const init = await TVC_DB.getMeta(TVC_META_KEYS.DB_INIT); if (init) vessel.delivery = String(init).slice(0, 10); } catch (_) {}
            }
        }
        if (vessel) {
            setText('cmaxsShipName', vessel.name);
            setText('cmaxsShipCode', vessel.code || '—');
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
            el.classList.toggle('hidden', !f[el.dataset.feature]);
        });
        const dash = document.getElementById('captainViewDashboard');
        if (dash) dash.classList.toggle('hidden', !f.showCaptainDashboard);
        syncPlanGroupTreeUi();
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
        if (!dc) return '';
        return (dc.report_date || dc.work_date || dc.submitted_at || dc.created_at || '').slice(0, 10);
    }

    function matchReportPeriodDate(dateStr) {
        return isDateInPeriod(dateStr, state.reportPeriodFrom, state.reportPeriodTo);
    }

    // ── Department toggle & global filter ────────────────────────────
    function deptJobs() {
        if (!state.department) return state.jobs;   // All (HQ)
        return state.jobs.filter(j => j.department === state.department);
    }

    /** HQ / Captain Hub: All/Deck/Engine 토글. Station PC는 고정 부서 라벨만 노출. */
    function renderDeptToggles(user) {
        if (!user) return;
        const canSwitch = typeof TVC_Space !== 'undefined'
            ? TVC_Space.canSwitchDepartmentView(user)
            : TVC_RBAC.isHqAccount(user);
        document.querySelectorAll('.dept-toggle').forEach(group => {
            if (canSwitch) {
                const opts = [{ v: null, l: 'All' }, { v: 'ENGINE', l: 'Engine' }, { v: 'DECK', l: 'Deck' }];
            const btns = opts.map(o => {
                const active = state.department === o.v ? ' active' : '';
                const arg = o.v ? `'${o.v}'` : 'null';
                return `<button class="dept-btn${active}" data-dept="${o.v || ''}" onclick="TVC_App.setDepartment(${arg})">${o.l}</button>`;
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

    function setDepartment(dept) {
        const canSwitch = state.user && (typeof TVC_Space !== 'undefined'
            ? TVC_Space.canSwitchDepartmentView(state.user)
            : TVC_RBAC.isHqAccount(state.user));
        if (state.user && !canSwitch && dept !== state.user.department) {
            alert('이 계정은 ' + TVC_RBAC.getDeptLabel(state.user.department) + ' 부서 전용입니다.');
            return;
        }
        state.department = dept;
        state.captainView = dept === 'DECK' ? 'deck' : dept === 'ENGINE' ? 'engine' : 'all';
        state.selectedGroupKey = null;
        renderDeptToggles(state.user);
        renderCaptainViewDashboard();
        rerenderCurrentTab();
    }

    function setCaptainView(view) {
        state.captainView = view;
        if (view === 'deck') setDepartment('DECK');
        else if (view === 'engine') setDepartment('ENGINE');
        else setDepartment(null);
    }

    /** Captain Hub — All / Deck / Engine 모니터링 대시보드 뼈대 */
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
        const v = state.captainView || 'all';

        host.innerHTML = `
            <div class="captain-dash-head">
                <span class="captain-dash-title">⚓ Captain Hub — Vessel Overview</span>
                <span class="captain-dash-sub">All / Engine / Deck 구역 모니터링</span>
            </div>
            <div class="captain-view-tabs" role="tablist" aria-label="Vessel view">
                <button type="button" class="captain-view-btn${v === 'all' ? ' active' : ''}" onclick="TVC_App.setCaptainView('all')">All</button>
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
        return ids.sort((a, b) => {
            const ja = state.idx.jobById.get(a), jb = state.idx.jobById.get(b);
            let va = (ja?.[field]) || '', vb = (jb?.[field]) || '';
            return asc ? String(va).localeCompare(String(vb), undefined, { numeric: true })
                       : String(vb).localeCompare(String(va), undefined, { numeric: true });
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
        if (isHistDefectEntry(entry)) return histDefectRowKey(entry.defect.id);
        return histRowKey(entry.report.id, entry.item.maintenance_job_id);
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

    function defectEffectiveJobCode(dc) {
        const items = dc?.job_items;
        if (Array.isArray(items)) {
            const fromItems = items.map(i => String(i.job_code || '').trim()).find(c => c && !isPlaceholderJobCode(c));
            if (fromItems) return fromItems;
        }
        const code = String(dc.pms_job_code || dc.job_code || '').trim();
        return isPlaceholderJobCode(code) ? '' : code;
    }

    function defectHistoryHasJob(dc) {
        if (defectEffectiveJobCode(dc)) return true;
        return !!String(dc.maintenance_job_id || '').trim();
    }

    /** Defect Case → Defect List / Work History columns (group-only: Group No→Job Code, 장비명→SORT-1, Job Name→SORT-2) */
    function defectHistoryColumns(dc) {
        if (defectHistoryHasJob(dc)) {
            const job = state.idx?.jobById.get(dc.maintenance_job_id)
                || state.jobs.find(j => j.job_code === defectEffectiveJobCode(dc));
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

    function histEntrySortDate(entry) {
        if (isHistDefectEntry(entry)) {
            const d = entry.defect;
            return d.work_date || d.report_date || d.submitted_at || d.created_at || '';
        }
        const r = entry.report;
        return r.work_date || r.report_date || r.created_at || '';
    }

    function workHistoryDefectCases() {
        return (state.defectCases || []).filter(d => d.visible_in_list !== false);
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
        const job = state.idx?.jobById.get(item.maintenance_job_id)
            || state.jobs.find(j => j.job_code === item.job_code);
        const f = item.form || wrReportForm(r);
        const detail = job?.job_detail || item.description || r.description || '';
        const hay = [
            item.job_code,
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
        reportsForDept().forEach(r => {
            TVC_WorkReport.fromLegacy(r);
            if (r.work_type === 'POSTPONE' && (TVC_RBAC.isReportedStatus(r.status) || TVC_RBAC.isConfirmedStatus(r.status))) {
                TVC_WorkReport.getJobItems(r).forEach(item => {
                    if (item.maintenance_job_id) ids.add(item.maintenance_job_id);
                    if (item.job_code) codes.add(item.job_code);
                });
            }
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
        const keys = getActualFilterKeys();
        if (keys.postponed.ids.has(j.id) || keys.postponed.codes.has(j.job_code)) return 'postponed';
        if (j.is_overdue && !isActualJobCompleted(j)) return 'overdue';
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

    function updateSearchClearBtn(inputId) {
        const el = document.getElementById(inputId);
        if (!el) return;
        const btn = el.closest('.search-field-wrap')?.querySelector('.search-clear-btn');
        if (btn) btn.classList.toggle('hidden', !String(el.value || '').trim());
    }

    function clearSearchField(inputId) {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.value = '';
        updateSearchClearBtn(inputId);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
    }

    function bindSearchClearInput(inputId) {
        const el = document.getElementById(inputId);
        if (!el || el.dataset.searchClearBound) return;
        el.dataset.searchClearBound = '1';
        el.addEventListener('input', () => updateSearchClearBtn(inputId));
        updateSearchClearBtn(inputId);
    }

    function bindTabSearchClearInputs() {
        ['actSearch', 'actTreeSearch', 'histSearch', 'dfListSearch', 'spareSearch', 'spareTreeSearch']
            .forEach(bindSearchClearInput);
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

    function onActualPeriodChange() {
        const fromEl = document.getElementById('actPeriodFrom');
        const toEl = document.getElementById('actPeriodTo');
        const from = fromEl?.value || '';
        const to = toEl?.value || '';
        if (from && to && from > to) {
            alert('시작일은 종료일보다 늦을 수 없습니다.');
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

    function onReportPeriodChange() {
        const tab = state.currentTab;
        const fromEl = document.getElementById(tab === 'defect' ? 'dfPeriodFrom' : 'histPeriodFrom');
        const toEl = document.getElementById(tab === 'defect' ? 'dfPeriodTo' : 'histPeriodTo');
        const from = fromEl?.value || '';
        const to = toEl?.value || '';
        if (from && to && from > to) {
            alert('시작일은 종료일보다 늦을 수 없습니다.');
            syncReportPeriodInputs();
            return;
        }
        state.reportPeriodFrom = from;
        state.reportPeriodTo = to;
        syncReportPeriodInputs();
        if (tab === 'defect') TVC_DefectReport?.renderTab?.();
        else if (tab === 'history') renderWorkHistory();
    }

    function clearReportPeriod() {
        state.reportPeriodFrom = '';
        state.reportPeriodTo = '';
        syncReportPeriodInputs();
        if (state.currentTab === 'defect') TVC_DefectReport?.renderTab?.();
        else if (state.currentTab === 'history') renderWorkHistory();
    }

    function syncReportPeriodInputs() {
        [['dfPeriodFrom', 'histPeriodFrom'], ['dfPeriodTo', 'histPeriodTo']].forEach(([dfId, histId], i) => {
            const val = i === 0 ? state.reportPeriodFrom : state.reportPeriodTo;
            [dfId, histId].forEach(id => {
                const el = document.getElementById(id);
                if (el && document.activeElement !== el) el.value = val || '';
            });
        });
        ['dfPeriodFilter', 'histPeriodFilter'].forEach(id => {
            document.getElementById(id)?.classList.toggle('active', hasReportPeriodFilter());
        });
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
        state.selectedGroupKey = key || null;
        state.focusedSpareId = null;
        if (modStateSpare()) modStateSpare().focusedId = null;
        if (state.currentTab === 'actual') renderActualPlan();
        else if (state.currentTab === 'spare') TVC_SpareMenu.render();
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

    function openPlanWorkProcedure() {
        const job = getPlanFocusJob();
        if (!job) return alert('Work Plan에서 작업을 선택하세요.');
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
        const critical = jobs.filter(jobShowsCriticalEquipmentMark).length;
        return { total: jobs.length, overdue, due30, dueMonth, pending: pending.length, approved, defectPending, critical };
    }

    function menuModel() {
        const c = menuCounts();
        const isHq = state.user && TVC_RBAC.isHqAccount(state.user);
        const isMaster = state.user && TVC_Space.isCaptainHub(state.user);

        const dailyItems = [
            { label: 'Check Work Plan', tag: 'D', action: "TVC_App.menuAction('checkPlan')", badge: c.overdue, badgeTone: 'red' },
            { label: 'Confirm Work Report', tag: 'B', action: "TVC_App.menuAction('approveReport')", badge: c.pending, badgeTone: 'amber', feature: 'showApprovalQueue' },
        ];

        const necessaryItems = menuNecessaryItems();

        if (isHq) {
        return [
                { key: 'defect', tone: 'defect', title: 'Defect Report', items: [
                    { label: 'View Defect List', tag: 'D', action: "TVC_App.menuAction('defectInbox')", badge: c.defectPending, badgeTone: 'amber' },
                    { label: 'Make Defect Report', tag: 'C', action: "TVC_App.menuAction('defectReport')" },
                ] },
                { key: 'monthly', tone: 'monthly', title: 'Monthly Report', items: [
                    { label: 'Approve Work Plan', tag: 'B', action: "TVC_App.menuAction('approveOriginalPlan')" },
                ] },
                { key: 'necessary', tone: 'necessary', title: 'If Necessary', items: necessaryItems },
            ];
        }

        if (isMaster) {
            const monthlyCore = [
                { label: 'Running Hours', tag: 'C', action: "TVC_App.menuAction('runHour')" },
                { label: 'Update Work Plan', tag: 'B', action: "TVC_App.menuAction('originalPlan')", badge: c.dueMonth, badgeTone: 'blue', planLock: true },
            ];
            return [
                { key: 'daily', tone: 'daily', title: 'Daily Tasks', items: dailyItems },
                { key: 'defect', tone: 'defect', title: 'Defect Report', items: [
                    { label: 'View Defect List', tag: 'D', action: "TVC_App.menuAction('defectInbox')" },
                    { label: 'Make Defect Report', tag: 'C', action: "TVC_App.menuAction('defectReport')", feature: 'showDefectReport' },
                ] },
                { key: 'monthly', tone: 'monthly', title: 'Monthly Report', items: monthlyCore },
                { key: 'necessary', tone: 'necessary', title: 'If Necessary', items: necessaryItems },
            ];
        }

        return [
            { key: 'daily', tone: 'daily', title: 'Daily Tasks', items: dailyItems },
            { key: 'defect', tone: 'defect', title: 'Defect Report', items: [
                { label: 'View Defect List', tag: 'D', action: "TVC_App.menuAction('defectInbox')" },
                { label: 'Make Defect Report', tag: 'C', action: "TVC_App.menuAction('defectReport')", feature: 'showDefectReport' },
            ] },
            { key: 'monthly', tone: 'monthly', title: 'Monthly Report', items: [
                { label: 'Running Hours', tag: 'C', action: "TVC_App.menuAction('runHour')" },
                { label: 'Update Work Plan', tag: 'B', action: "TVC_App.menuAction('originalPlan')", badge: c.dueMonth, badgeTone: 'blue', planLock: true },
            ] },
            { key: 'necessary', tone: 'necessary', title: 'If Necessary', items: necessaryItems },
        ];
    }

    function menuNecessaryItems() {
        return [
                    { label: 'Database Backup & Restore', tag: 'C', action: "TVC_App.menuAction('backup')" },
            { label: 'Data Export & Import', tag: 'C', action: 'TVC_App.openMenuXferMenu()' },
            { label: 'View Data History', tag: 'C', action: 'TVC_App.openMenuHistoryModal()' },
        ];
    }

    function menuXferCategoryFromRow(row) {
        const d = String(row?.direction || '');
        if (d.startsWith('DEFECT_') || d === 'DEFECT_IMPORT') return 'Defect Report';
        return 'Monthly Report';
    }

    function resetMenuXfer() {
        _menuXfer = { step: 'mode' };
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
        if (target === 'COMPANY') return 'Company';
        return target ? TVC_RBAC.getDeptLabel(target) : '—';
    }

    function menuXferDefectExportRows() {
        const target = menuXferResolveExportTarget(state.user, 'defect');
        const cases = defectCasesForExportTarget(state.defectCases || [], target || 'COMPANY');
        return cases
            .filter(c => c.visible_in_list !== false)
            .sort((a, b) => String(b.report_date || b.created_at || '').localeCompare(String(a.report_date || a.created_at || '')));
    }

    function menuXferDefectRowSelectable(row) {
        return TVC_DefectCase.listWorkflowStatus(row) === 'Confirmed';
    }

    function menuXferDefectSelectDisabledTitle(row) {
        const st = TVC_DefectCase.listWorkflowStatus(row);
        if (st === 'Submitted') return 'Already exported (Submitted)';
        if (st === 'Approved') return 'Approved — not exportable here';
        if (st === 'Draft') return 'Draft — not in list workflow';
        if (st === 'Reported') return 'Reported — confirm first';
        return 'Not exportable';
    }

    function menuXferDefectSelectHtml() {
        const rows = menuXferDefectExportRows();
        const sel = _menuXfer.selectedDefectIds || {};
        const selectable = rows.filter(menuXferDefectRowSelectable);
        const selectedCount = selectable.filter(r => sel[r.id]).length;
        const allChecked = selectable.length > 0 && selectable.every(r => sel[r.id]);
        let tableBody = '';
        if (!rows.length) {
            tableBody = `<tr><td colspan="6" class="muted menu-xfer-empty">No defect reports in scope.</td></tr>`;
        } else {
            tableBody = rows.map(row => {
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
                    <td>${esc(String(row.file_no || '').trim())}</td>
                    <td>${cols.jobCode ? `<strong>${esc(cols.jobCode)}</strong>` : '—'}</td>
                    <td>${histCellHtml(cols.sort1)}</td>
                    <td class="hist-status">${esc(st)}</td>
                    <td>${esc(dt || '—')}</td>
                </tr>`;
            }).join('');
        }
        return `
            <p class="spare-sync-hint">Select <strong>Confirmed</strong> defect reports to export.</p>
            <p class="spare-sync-note muted">Only Confirmed (not yet Submitted) rows can be selected. Reported, Draft, Submitted, and Approved rows are shown for reference.</p>
            <div class="menu-xfer-table-wrap">
                <table class="menu-xfer-table">
                    <thead><tr>
                        <th class="menu-xfer-chk"><input type="checkbox" id="menuXferDefectSelectAll"${allChecked ? ' checked' : ''}${selectable.length ? '' : ' disabled'}></th>
                        <th>File No</th><th>Job Code</th><th>SORT-1</th><th>Status</th><th>Reported Date</th>
                    </tr></thead>
                    <tbody>${tableBody}</tbody>
                </table>
            </div>
            <div class="spare-sync-actions">
                <button type="button" id="menuXferDefectExportBtn" class="btn btn-green spare-sync-btn"${selectedCount ? '' : ' disabled'} onclick="TVC_App.menuXferConfirmDefectExport()">${selectedCount ? `Export (${selectedCount})` : 'Export'}</button>
            </div>`;
    }

    function menuXferMonthlyReadyHtml() {
        const dept = getPlanLockDept();
        const locked = isOriginalPlanUpdateLocked(dept);
        const dest = menuXferExportTargetLabel(menuXferResolveExportTarget(state.user, 'monthly'));
        if (!locked && !TVC_RBAC.isHqAccount(state.user)) {
            return `
                <p class="spare-sync-hint">Export <strong>Monthly Report</strong></p>
                <p class="menu-xfer-block-msg">Update Work Plan must be completed first.</p>
                <p class="spare-sync-note muted">Complete Work Plan → Update Plan before exporting the Monthly Report.</p>`;
        }
        const lock = state._originalPlanLock?.[dept];
        const month = lock?.month || '—';
        const stats = lock?.stats;
        let summary = `<p class="muted">Destination: <strong>${esc(dest)}</strong></p>`;
        if (lock) {
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
        btn.disabled = count === 0;
        btn.textContent = count ? `Export (${count})` : 'Export';
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
    }

    function renderMenuXferModal() {
        const body = document.getElementById('menuXferBody');
        if (!body) return;
        const step = _menuXfer.step || 'mode';
        const modalBox = document.querySelector('#menuXferModal .modal-box');
        if (modalBox) modalBox.classList.toggle('menu-xfer-wide', step === 'export-defect-select');
        let content = '';
        if (step === 'mode') {
            content = `
                <p class="spare-sync-hint">Choose whether to send data out or bring data in.</p>
                <div class="spare-sync-actions">
                    <button type="button" class="btn btn-green spare-sync-btn" onclick="TVC_App.menuXferPickMode('export')">Export</button>
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickMode('import')">Import</button>
                </div>`;
        } else if (step === 'export-type') {
            content = `
                <p class="spare-sync-hint">Select the report type to export.</p>
                <div class="spare-sync-actions">
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickExportType('defect')">Defect Report</button>
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_App.menuXferPickExportType('monthly')">Monthly Report</button>
                </div>`;
        } else if (step === 'export-defect-select') {
            content = menuXferDefectSelectHtml();
        } else if (step === 'export-monthly-ready') {
            content = menuXferMonthlyReadyHtml();
        } else if (step === 'import') {
            content = `
                <p class="spare-sync-hint">Select a file from Master PC or Company.</p>
                <p class="spare-sync-note muted">Supported: PMS sync ZIP (Monthly Report), Defect package ZIP. File type is detected automatically.</p>
                <div class="spare-sync-actions">
                    <button type="button" class="btn btn-green spare-sync-btn" onclick="TVC_App.menuXferTriggerImport()">Open file…</button>
                </div>`;
        }
        const backBtn = step !== 'mode'
            ? `<button type="button" class="btn btn-sm spare-sync-back" onclick="TVC_App.menuXferBack()">← Back</button>`
            : '';
        const stepLabel = step === 'mode' ? '1. Export or Import'
            : step === 'export-type' ? '2. Export — report type'
                : step === 'export-defect-select' ? '3. Export — select defects'
                    : step === 'export-monthly-ready' ? '3. Export — monthly report'
                        : '2. Import — select file';
        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeMenuXferMenu()">×</button>
            <h3 class="spare-sync-title">Data Export &amp; Import</h3>
            <p class="spare-sync-step-label muted">${esc(stepLabel)}</p>
            ${content}
            <div class="modal-actions spare-sync-footer">${backBtn}
                <button type="button" class="btn" onclick="TVC_App.closeMenuXferMenu()">Close</button>
            </div>`;
        if (step === 'export-defect-select') bindMenuXferDefectTableEvents();
    }

    function openMenuXferMenu() {
        resetMenuXfer();
        renderMenuXferModal();
        showModal('menuXferModal');
    }

    function closeMenuXferMenu() {
        closeModal('menuXferModal');
        resetMenuXfer();
    }

    function menuXferPickMode(mode) {
        _menuXfer.mode = mode;
        _menuXfer.step = mode === 'export' ? 'export-type' : 'import';
        renderMenuXferModal();
    }

    function menuXferBack() {
        if (_menuXfer.step === 'export-defect-select' || _menuXfer.step === 'export-monthly-ready') {
            _menuXfer.step = 'export-type';
            delete _menuXfer.selectedDefectIds;
        } else if (_menuXfer.step === 'export-type' || _menuXfer.step === 'import') {
            _menuXfer.step = 'mode';
        }
        renderMenuXferModal();
    }

    function menuXferPickExportType(type) {
        _menuXfer.exportType = type;
        if (type === 'defect') {
            _menuXfer.step = 'export-defect-select';
            _menuXfer.selectedDefectIds = {};
        } else {
            _menuXfer.step = 'export-monthly-ready';
        }
        renderMenuXferModal();
    }

    async function menuXferConfirmDefectExport() {
        const ids = Object.keys(_menuXfer.selectedDefectIds || {}).filter(id => _menuXfer.selectedDefectIds[id]);
        if (!ids.length) return alert('Select at least one Confirmed defect to export.');
        const target = menuXferResolveExportTarget(state.user, 'defect');
        if (!target || !menuXferCanExportTarget(state.user, target)) {
            return alert('No permission to export defect reports.');
        }
        const destLabel = menuXferExportTargetLabel(target);
        if (!confirm(`Export ${ids.length} defect report(s) to ${destLabel}?`)) return;
        closeMenuXferMenu();
        try {
            await menuXferExportDefect(target, ids);
        } catch (e) { alert(e.message || e); }
    }

    async function menuXferConfirmMonthlyExport() {
        const dept = getPlanLockDept();
        if (!TVC_RBAC.isHqAccount(state.user) && !isOriginalPlanUpdateLocked(dept)) {
            return alert('Update Work Plan must be completed first.');
        }
        const target = menuXferResolveExportTarget(state.user, 'monthly');
        if (!target || !menuXferCanExportTarget(state.user, target)) {
            return alert('No permission to export monthly report.');
        }
        const destLabel = menuXferExportTargetLabel(target);
        if (!confirm(`Export Monthly Report to ${destLabel}?`)) return;
        closeMenuXferMenu();
        try {
            await menuXferExportMonthly(target);
        } catch (e) { alert(e.message || e); }
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
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user)) {
            await handleStationExport();
            return;
        }

        const direction = TVC_RBAC.isHqAccount(user) ? 'HQ_TO_SHIP' : 'SHIP_TO_HQ';
        await TVC_Sync.exportZip(user, direction, dept);
        await refreshAll();
        if (state.currentTab === 'menu') renderSyncHistory();
        alert(`${TVC_RBAC.getDeptLabel(dept)} Monthly Report exported.`);
    }

    async function exportSelectedDefectCase(user, caseRow) {
        if (TVC_DefectCase.listWorkflowStatus(caseRow) !== 'Confirmed') {
            throw new Error(`${caseRow.case_no}: only Confirmed cases can be exported.`);
        }
        if (TVC_RBAC.isHqAccount(user)) {
            if (caseRow.status === TVC_DefectCase.Status.COMPANY_REVIEWED) {
                await TVC_DefectSync.exportHqReplyZip(user, caseRow.id);
                return;
            }
            throw new Error(`${caseRow.case_no}: not ready for HQ export.`);
        }
        if (caseRow.status === TVC_DefectCase.Status.AWAITING_COMPLETION) {
            await TVC_DefectSync.exportCompletionZip(user, caseRow.id);
            return;
        }
        if (caseRow.status === TVC_DefectCase.Status.WORK_IN_PROGRESS) {
            throw new Error(`${caseRow.case_no}: complete Phase 3 before export.`);
        }
        if (caseRow.status !== TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) {
            await TVC_DefectCaseService.submitToCompany(user, caseRow.id);
        }
        await TVC_DefectSync.exportUrgentZip(user, caseRow.id);
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

        let exported = 0;
        for (const c of scoped) {
            await exportSelectedDefectCase(user, c);
            exported++;
        }
        if (!exported) throw new Error('No Confirmed defect reports ready to export.');

        await refreshAll();
        if (state.currentTab === 'menu') {
            renderSyncHistory();
            TVC_DefectReport?.renderInbox?.();
        }
        if (state.currentTab === 'defect') TVC_DefectReport?.renderTab?.();
        const dest = target === 'COMPANY' ? 'Company' : TVC_RBAC.getDeptLabel(target);
        alert(`Exported ${exported} defect package(s) → ${dest}.`);
    }

    function menuXferTriggerImport() {
        document.getElementById('menuXferImportFile')?.click();
    }

    async function detectMenuImportType(file) {
        const name = (file.name || '').toLowerCase();
        if (!name.endsWith('.zip')) return 'MONTHLY';
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const files = Object.keys(zip.files);
        if (files.some(f => /defect_case/i.test(f))) return 'DEFECT';
        return 'MONTHLY';
    }

    async function menuXferImportMonthly(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        const name = (file.name || '').toLowerCase();
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
        } else {
            pickDepartmentThen('Import할 부서를 선택하세요 (DECK / ENGINE)', run);
        }
    }

    async function onMenuXferImportFile(file) {
        if (!file) return;
        try {
            const kind = await detectMenuImportType(file);
            if (kind === 'DEFECT') {
                await handleDefectImport(file);
            } else {
                await menuXferImportMonthly(file);
            }
            closeMenuXferMenu();
        } catch (e) {
            alert('Import failed: ' + (e.message || e));
        } finally {
            const fi = document.getElementById('menuXferImportFile');
            if (fi) fi.value = '';
        }
    }

    async function openMenuHistoryModal() {
        const body = document.getElementById('menuHistoryBody');
        if (!body) return;
        const rows = await loadSyncHistoryRows();
        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_App.closeMenuHistoryModal()">×</button>
            <h3 class="spare-sync-title">Data Export / Import History</h3>
            <p class="spare-hist-sub muted">Defect Report and Monthly Report sync activity.</p>
            <div class="spics-tx-lines-wrap"><table class="spics-tx-table spics-hist-table"><thead><tr>
                <th>Date</th><th>Direction</th><th>Type</th><th>Department</th><th>File</th><th>Status</th>
            </tr></thead><tbody>${rows.map(r => `<tr>
                <td>${esc(histEventDate(r))}</td>
                <td><span class="pill ${r.type === 'EXPORT' ? 'ok' : 'warn'}">${esc(r.type || '—')}</span></td>
                <td>${esc(menuXferCategoryFromRow(r))}</td>
                <td>${esc(r.department || '—')}</td>
                <td>${esc(r.filename || '—')}</td>
                <td>${esc(r.status || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center">No export/import history yet.</td></tr>'}
            </tbody></table></div>
            <div class="modal-actions"><button type="button" class="btn" onclick="TVC_App.closeMenuHistoryModal()">Close</button></div>`;
        showModal('menuHistoryModal');
    }

    function closeMenuHistoryModal() {
        closeModal('menuHistoryModal');
    }

    function renderMenuFlowItem(it, f, opts = {}) {
        if (it.feature && !f[it.feature]) return '';
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
                .map(it => renderMenuFlowItem(it, f, it.planLock ? { locked: planLocked, disabledTitle: lockTip } : {}))
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
        host.innerHTML = renderSectionCard('PMS Work Flow', renderMenuFlowPanel(menuModel(), f), {
            className: 'tvc-section-pms-flow',
        });
    }

    function renderFleetList() {
        const hqCol = document.getElementById('hqLeftCol');
        const body = document.getElementById('fleetTableBody');
        if (!body) return;
        const isHq = state.user && TVC_RBAC.isHqAccount(state.user);
        hqCol?.classList.toggle('hidden', !isHq);
        document.getElementById('cmaxsMenuBody')?.classList.toggle('hq-mode', isHq);
        if (!isHq) return;

        let vessels = TVC_Fleet.getAll();
        const q = (state.fleetSearch || '').toLowerCase();
        if (q) vessels = vessels.filter(v =>
            (v.name || '').toLowerCase().includes(q) ||
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
                <td>${esc(v.code || '—')}</td>
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
        TVC_OutstandingTasks.render();
    }

    function renderDefectTab() {
        applyRoleUi(state.user);
        TVC_DefectReport.renderTab();
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

    function menuAction(action) {
        switch (action) {
            case 'checkPlan': menuNavigate('actual', { actualFilter: 'overdue' }); break;
            case 'checkCritical': menuNavigate('actual', { actualFilter: 'critical' }); break;
            case 'inputReport': menuNavigate('actual', { actualFilter: 'total' }); break;
            case 'approveReport': menuNavigate('history'); break;
            case 'hqConfirm': menuNavigate('history'); break;
            case 'runHour': menuNavigate('runhrs'); break;
            case 'originalPlan':
            case 'approveOriginalPlan':
                if (!isRhUpdateCommitted()) {
                    alert('Running Hours Update를 먼저 완료하세요.');
                    return;
                }
                if (!canPerformOriginalPlanUpdate()) {
                    alert(getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan Update는 현재 사용할 수 없습니다.');
                    return;
                }
                updateOriginalPlanFromRunHours();
                break;
            case 'companyComment': menuNavigate('actual'); break;
            case 'modifyItem':
                if (!canEditOriginalPlanItems()) {
                    alert(origPlanEditDeniedMessage());
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
            case 'backup': handleExport(); break;
            case 'defectReport':
                switchTab('defect');
                if (state.selectedJobId) TVC_DefectReport.openNewFromJob(state.selectedJobId);
                else TVC_DefectReport.openNewBlank();
                break;
            case 'defectInbox':
                switchTab('defect');
                break;
            case 'defectImport':
                document.getElementById('importDefectUrgent')?.click();
                break;
            case 'password': alert('Password 변경은 관리자(A) 권한 콘솔에서 제공됩니다.'); break;
            case 'control': alert('Control(권한) 변경은 관리자(B) 승인 후 적용됩니다.'); break;
            default: break;
        }
    }

    // ── Plan update & item edit (Work Plan tab) ────────────────────
    let _planCalcTimer = null;
    let _planUpdateSnapshot = null;
    const PLAN_CALC_MS = 5000;

    function getPlanLockDept() {
        if (state.user && !TVC_RBAC.isHqAccount(state.user)) return state.user.department;
        return state.department || null;
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
        if (state.user && TVC_RBAC.isHqAccount(state.user)) return false;
        dept = dept || getPlanLockDept();
        if (!dept) return false;
        return !!state._originalPlanLock?.[dept]?.locked;
    }

    function canPerformOriginalPlanUpdate() {
        if (!state.user) return false;
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
        if (!isRhUpdateCommitted()) {
            return 'Running Hours Update를 먼저 완료하세요.';
        }
        return getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan Update는 현재 사용할 수 없습니다.';
    }

    function syncPlanUpdateUi() {
        const dept = getPlanLockDept();
        const planLocked = isOriginalPlanUpdateLocked(dept);
        const rhLocked = !isRhUpdateCommitted();
        const locked = planLocked || rhLocked;
        const btn = document.getElementById('actUpdatePlanBtn');
        if (btn) {
            btn.disabled = locked;
            if (planLocked) {
                btn.title = getOriginalPlanLockMessage(dept);
            } else if (rhLocked) {
                btn.title = 'Running Hours Update를 먼저 완료하세요.';
            } else {
                btn.title = '';
            }
        }
        syncPlanItemUi();
        const msgEl = document.getElementById('actPlanCalcMsg');
        if (msgEl && locked && !state._planCalcMsg) {
            msgEl.textContent = rhLocked
                ? 'Running Hours Update를 먼저 완료하세요.'
                : getOriginalPlanLockMessage(dept);
            msgEl.classList.remove('hidden');
        }
    }

    function origPlanEditDeniedMessage() {
        if (state.user && TVC_RBAC.isShipAccount(state.user) && !TVC_RBAC.isApprover(state.user)) {
            return 'Captain / Chief Engineer만 Modify · Append · Delete 가능합니다.';
        }
        return getOriginalPlanLockMessage(getPlanLockDept()) || 'Maintenance Plan 항목을 편집할 수 없습니다.';
    }

    function canEditOriginalPlanItems() {
        if (!state.user) return false;
        if (!TVC_RBAC.canModifyOriginalPlan(state.user)) return false;
        if (TVC_RBAC.isHqAccount(state.user)) return true;
        return !isOriginalPlanUpdateLocked(getPlanLockDept());
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

    /** HQ MODE — Original Plan GROUP Tree 그룹명 수정·추가 */
    function canEditOriginalPlanGroups() {
        return canEditOriginalPlanItems() && TVC_RBAC.isHqAccount(state.user);
    }

    function selectedGroupNode() {
        if (!state.selectedGroupKey || state.selectedGroupKey === CRITICAL_GROUP_KEY || !state.idx) return null;
        return state.idx.groupNodes.find(n => n.key === state.selectedGroupKey) || null;
    }

    function canEditPlanGroupHeader() {
        if (!state.user) return false;
        return TVC_RBAC.canModifySpareInventory(state.user) || TVC_RBAC.canModifyOriginalPlan(state.user);
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
        const depts = ['ENGINE', 'DECK'];
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

    function openOrigGroupAdd() {
        if (!canEditPlanGroupHeader()) return alert('Chief Engineer / Captain permission required.');
        renderGroupEditor('add');
        showModal('groupEditorModal');
    }

    function openOrigGroupRename() {
        if (!canEditPlanGroupHeader()) return alert('Chief Engineer / Captain permission required.');
        const node = selectedGroupNode();
        if (!node) return alert('Select a group in PMS GROUP Tree.');
        renderGroupEditor('rename');
        showModal('groupEditorModal');
    }

    async function deleteOrigGroup() {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !canEditPlanGroupHeader()) return alert('Chief Engineer / Captain permission required.');
        const node = selectedGroupNode();
        if (!node) return alert('Select a group to delete.');
        if (state.selectedGroupKey === CRITICAL_GROUP_KEY
            || state.selectedGroupKey === TVC_SpareMenu?.MERGED_GEN_ENGINE_KEY) {
            return alert('This group cannot be deleted.');
        }
        if (!confirm(`Delete GROUP "${node.label}"?\n\nOnly empty groups (no jobs, no spare parts) can be deleted.`)) return;
        try {
            await TVC_MaintenancePlan.deleteGroup(user, node.department, node.label);
            state.selectedGroupKey = null;
            await refreshAll();
            alert('Group deleted.');
        } catch (e) {
            const code = e.code || '';
            if (code === 'HAS_JOBS') return alert(`Cannot delete: ${e.count || ''} maintenance job(s) in this group.`);
            if (code === 'HAS_SPARES') return alert(`Cannot delete: spare parts exist in this group.`);
            alert(e.message || code || 'Delete failed');
        }
    }

    async function saveGroupEditor() {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !canEditOriginalPlanGroups()) return;
        const form = document.getElementById('groupEditorForm');
        if (!form) return;
        const fd = new FormData(form);
        const label = String(fd.get('label') || '').trim();
        if (!label) return alert('GROUP 이름을 입력하세요.');
        try {
            if (state._groupEditMode === 'rename') {
                const node = selectedGroupNode();
                if (!node) return alert('GROUP을 선택하세요.');
                const { newKey } = await TVC_MaintenancePlan.renameGroup(user, node.department, node.label, label);
                closeModal('groupEditorModal');
                await refreshAll();
                state.selectedGroupKey = newKey;
                alert(`GROUP 이름이 "${label}"(으)로 변경되었습니다.`);
            } else {
                const dept = String(fd.get('department') || state.department || 'ENGINE').trim();
                const row = await TVC_MaintenancePlan.createGroup(user, dept, label);
                closeModal('groupEditorModal');
                await refreshAll();
                state.selectedGroupKey = TVC_MaintenancePlan.groupKeyOf(row.department, row.label);
                alert(`GROUP "${label}"이(가) 추가되었습니다.`);
            }
        } catch (e) {
            const code = e.code || '';
            if (code === 'DUPLICATE') return alert('같은 부서에 동일한 GROUP 이름이 이미 있습니다.');
            alert(e.message || code || '저장 실패');
        }
    }

    function syncPlanItemUi() {
        const canEdit = canEditOriginalPlanItems();
        const hasSel = !!state.selectedJobId;
        let tip = '';
        if (!canEdit) {
            if (state.user && TVC_RBAC.isShipAccount(state.user) && !TVC_RBAC.isApprover(state.user)) {
                tip = origPlanEditDeniedMessage();
            } else {
                tip = getOriginalPlanLockMessage(getPlanLockDept()) || '권한 없음';
            }
        }
        ['actModifyBtn', 'actAppendBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.disabled = !canEdit;
            el.title = tip;
        });
        const del = document.getElementById('actDeleteBtn');
        if (del) {
            del.disabled = !canEdit || !hasSel;
            del.title = !canEdit ? tip : (!hasSel ? '삭제할 행을 선택하세요' : '');
        }
        const mod = document.getElementById('actModifyBtn');
        if (mod) mod.disabled = !canEdit || (!hasSel && !isOrigJobInlineEditing());
        if (mod) mod.title = !canEdit ? tip : ((!hasSel && !isOrigJobInlineEditing()) ? '수정할 행을 선택하세요' : '');
        const app = document.getElementById('actAppendBtn');
        if (app && isOrigJobInlineEditing()) app.disabled = !canEdit;
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
        return `<input type="date" class="spare-inline-input orig-inline-date" id="${id}" value="${esc(String(value ?? ''))}" onclick="event.stopPropagation()">`;
    }

    function refreshActJobEditBlock() {
        const host = document.getElementById('actJobEditBlock');
        if (!host) return;
        host.innerHTML = renderOrigJobInlineEditHtml();
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
        };
        state._origJobEditMode = 'modify';
        state._origJobEditId = job.id;
        refreshActJobEditBlock();
        syncPlanItemUi();
    }

    function startOrigJobInlineAppend() {
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
        };
        state._origJobEditMode = 'append';
        state._origJobEditId = null;
        refreshActJobEditBlock();
        syncPlanItemUi();
    }

    function cancelOrigJobInlineEdit(opts = {}) {
        const scrollTop = captureActListScroll();
        const m = origJobInlineState();
        m.editId = null;
        m.mode = null;
        m.draft = null;
        refreshActJobEditBlock();
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
        if (!data.job_code) return alert('Job Code를 입력하세요.');
        if (!data.group) return alert('GROUP을 선택하세요.');
        try {
            state._actScrollRestore = captureActListScroll();
            if (m.mode === 'append') {
                const ctx = defaultAppendContext();
                await TVC_MaintenancePlan.createJob(user, {
                    ...data,
                    department: ctx.dept,
                    is_critical_equipment: parseJobCriticalEditValue(data.is_critical_equipment),
                });
                alert(`${data.job_code} 항목이 추가되었습니다.`);
            } else {
                await TVC_MaintenancePlan.updateJob(user, m.editId, {
                    ...data,
                    is_critical_equipment: parseJobCriticalEditValue(data.is_critical_equipment),
                });
                alert(`${data.job_code} 항목이 수정되었습니다.`);
            }
            cancelOrigJobInlineEdit({ restoreScroll: false });
            await refreshAll();
        } catch (e) {
            state._actScrollRestore = null;
            const msg = e.code === 'DUPLICATE' ? '동일한 Job Code가 이미 존재합니다.'
                : e.code === 'FORBIDDEN' ? '타 부서 항목은 편집할 수 없습니다.'
                : (e.message || e.code);
            alert(msg);
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

    function openOrigJobModify() {
        if (!canEditOriginalPlanItems()) return alert(origPlanEditDeniedMessage());
        if (isOrigJobInlineEditing()) return saveOrigJobInlineEdit();
        if (!state.selectedJobId) return alert('수정할 작업 행을 선택하세요.');
        const job = state.idx?.jobById.get(state.selectedJobId);
        if (!job) return alert('작업 항목을 찾을 수 없습니다.');
        startOrigJobInlineEdit(job);
    }

    function openOrigJobAppend() {
        if (!canEditOriginalPlanItems()) return alert(origPlanEditDeniedMessage());
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
        if (!data?.job_code) return alert('Job Code를 입력하세요.');
        try {
            if (state._origJobEditMode === 'append') {
                const ctx = defaultAppendContext();
                await TVC_MaintenancePlan.createJob(user, {
                    ...data,
                    department: ctx.dept,
                });
                alert(`${data.job_code} 항목이 추가되었습니다.`);
            } else {
                await TVC_MaintenancePlan.updateJob(user, state._origJobEditId, data);
                alert(`${data.job_code} 항목이 수정되었습니다.`);
            }
            closeModal('origJobEditorModal');
            await refreshAll();
        } catch (e) {
            const msg = e.code === 'DUPLICATE' ? '동일한 Job Code가 이미 존재합니다.'
                : e.code === 'FORBIDDEN' ? '타 부서 항목은 편집할 수 없습니다.'
                : (e.message || e.code);
            alert(msg);
        }
    }

    async function deleteOrigJob() {
        if (!canEditOriginalPlanItems()) return alert(origPlanEditDeniedMessage());
        if (!state.selectedJobId) return alert('삭제할 작업 행을 선택하세요.');
        const job = state.idx?.jobById.get(state.selectedJobId);
        if (!job) return;
        if (!confirm(`${job.job_code} — "${job.job_detail || job.item_sort2 || ''}"\n\n이 작업 항목을 삭제하시겠습니까?`)) return;
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        try {
            await TVC_MaintenancePlan.deleteJob(user, job.id, state.reports);
            state.selectedJobId = null;
            alert(`${job.job_code} 항목이 삭제되었습니다.`);
            await refreshAll();
        } catch (e) {
            const msg = e.code === 'LINKED' ? 'Work Report가 연결된 항목은 삭제할 수 없습니다.'
                : e.code === 'FORBIDDEN' ? '타 부서 항목은 삭제할 수 없습니다.'
                : (e.message || e.code);
            alert(msg);
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
                alert(e.message || 'Original Plan 저장 중 오류가 발생했습니다.');
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

    /** Menu → Update Original Plan: Run-hour 입력값으로 H 주기 Due Date 재계산 (CMAXS Calculation) */
    async function updateOriginalPlanFromRunHours() {
        if (!isRhUpdateCommitted()) {
            alert('Running Hours Update를 먼저 완료하세요.');
            return;
        }
        if (!canPerformOriginalPlanUpdate()) {
            alert(getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan Update는 현재 사용할 수 없습니다.');
            return;
        }
        menuNavigate('actual', { actualFilter: 'total' });
        state._planCalcMsg = '';
        showPlanCalc(true);
        _planUpdateSnapshot = snapshotRunHourJobs();

        const start = Date.now();
        let calcError = null;
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

        if (calcError) {
            console.error('[TVC] updateOriginalPlanFromRunHours', calcError);
            await revertPlanUpdateSnapshot();
            _planUpdateSnapshot = null;
            alert(calcError.message || 'Original Plan 계산 중 오류가 발생했습니다.');
            return;
        }

        renderActualPlan();
        openPlanUpdateModal();
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
            html += `<div class="tree-dept">${esc(dept)}</div>`;
            nodes.forEach(n => {
                const emptyTag = n.isEmpty ? `<span class="tree-empty-tag" title="작업 항목 없음">0</span>` : '';
                const sel = state.selectedGroupKey === n.key ? ' selected' : '';
                html += `<div class="tree-node${sel}${n.isEmpty ? ' tree-node-empty' : ''}" onclick="TVC_App.selectGroup('${escAttr(n.key)}')"><span>${esc(n.label)}</span>${emptyTag}</div>`;
            });
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

    function reportDept(r) {
        if (!r) return null;
        const items = TVC_WorkReport.getJobItems(r);
        for (const item of items) {
            const byId = state.idx?.jobById.get(item.maintenance_job_id)?.department;
            if (byId) return byId;
            const byCode = state.jobs.find(j => j.job_code === item.job_code)?.department;
            if (byCode) return byCode;
        }
        const byId = state.idx?.jobById.get(r.maintenance_job_id)?.department;
        if (byId) return byId;
        return state.jobs.find(j => j.job_code === r.job_code)?.department || null;
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

    function togglePlanSelectedOnly() {
        if (state.currentTab !== 'actual') return;
        if (state.actualSelectedOnly) {
            state.actualSelectedOnly = false;
        } else {
            if (!batchSelectedCount()) return alert('선택된 작업이 없습니다.');
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
                    lastMaintDate: today,
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

    function openWorkReportInput(explicitJobId) {
        const jobIds = batchSelectedJobIds();
        if (jobIds.length >= 2) return openBatchReport();
        const jobId = jobIds.length === 1 ? jobIds[0] : (explicitJobId || state.selectedJobId);
        if (!jobId) return alert('작업을 선택하거나 체크(ㅁ)로 1개 이상 선택하세요.');
        return openWorkReport(jobId);
    }

    function openBatchReport() {
        const jobIds = batchSelectedJobIds();
        if (jobIds.length < 2) return alert('Batch Report는 2개 이상의 작업을 선택하세요.');
        if (state.user?.department) {
            const bad = jobIds.some(id => {
                const j = state.idx?.jobById.get(id);
                return j && j.department !== state.user.department;
            });
            if (bad) return alert('타 부서 항목은 Batch Report에 포함할 수 없습니다.');
        }
        state._batchMode = true;
        state._batchJobIds = [...jobIds];
        state._wrReportId = null;
        state._wrBatchItemId = null;
        state._wrReadonly = false;
        state._wrTab = 'repair';
        state._wrPage = '1';
        state._batchSpareSearch = {};
        initBatchDraft(jobIds);
        loadBatchJobIntoEditor(jobIds[0]);
        state._batchJobPickerOpen = false;
        if (state.vlActual) state.vlActual.refresh();
        renderWorkReportModal();
        showModal('workReportModal');
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
        captureBatchJobDraft();
        const draft = state._batchDraft;
        if (!draft || !state._batchJobIds.length) return;
        const user = TVC_Auth.requirePermission(TVC_RBAC.Action.CREATE_DAILY_REPORT);
        if (!user) return;
        const tab = state._wrTab || 'repair';
        const workType = 'MAINTENANCE';

        const entries = state._batchJobIds.map(jobId => {
            const job = state.idx?.jobById.get(jobId);
            const item = draft.items[jobId];
            if (!job || !item) return null;
            const form = { ...item.form };
            const usedParts = (item.usedParts || [])
                .filter(p => Number(p.qty_used) > 0)
                .map(p => ({ spare_part_id: p.spare_part_id, qty_used: Number(p.qty_used) }));
            const description = form.outline || form.shipComments || job.job_detail;
            return {
                maintenance_job_id: jobId,
                job_code: job.job_code,
                form,
                description,
                used_parts: usedParts,
            };
        }).filter(Boolean);

        if (!entries.length) return alert('저장할 작업이 없습니다.');

        const firstForm = draft.items[state._batchJobIds[0]]?.form || {};
        try {
            await TVC_Transaction.submitBatchReport(user, {
                workType,
                status: 'REPORTED',
                reportDate: firstForm.reportDate,
                workDate: firstForm.workDate,
                sharedForm: {
                    reportDate: firstForm.reportDate,
                    workDate: firstForm.workDate,
                    fileNo: firstForm.fileNo,
                    voyNo: firstForm.voyNo,
                },
                items: entries,
            });
            state.batchSelectedJobs = {};
            state.actualSelectedOnly = false;
            state._batchMode = false;
            state._batchJobIds = [];
            state._batchDraft = null;
            resetAndCloseWorkReport();
            await refreshAll();
            alert(`Batch Work Report 저장 완료 (${entries.length} jobs, REPORTED)`);
        } catch (e) {
            alert(e.message || e.code || 'Batch Report 저장 실패');
        }
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
                idleHint: '작업을 클릭하거나 PMS GROUP Tree에서 그룹을 선택하면 장비 정보가 표시됩니다.',
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
        const reportLabel = n >= 2 ? `Report Input (${n})` : (n === 1 ? 'Report Input (1)' : 'Report Input');
        const reportTitle = n >= 2 ? `${n}개 작업 일괄 Work Report` : '';
        bar.innerHTML = `<div class="plan-action-btns">
                <button type="button" id="planWpBtn" class="btn btn-sm" onclick="TVC_App.openPlanWorkProcedure()"${noJob ? ' disabled' : ''}>Work Procedure / History</button>
                <button type="button" id="planReportBtn" class="btn btn-sm btn-green" onclick="TVC_App.openWorkReportInput()"${canReport ? '' : ' disabled'}${reportTitle ? ` title="${escAttr(reportTitle)}"` : ''}>${reportLabel}</button>
                ${selectedItemsBtn}
            </div>`;
    }

    /** Job 단위 Work History — Work History 탭과 동일한 daily_work_reports / job_items 소스 */
    function jobWorkHistoryEntries(jobId) {
        const job = resolveJobById(jobId);
        if (!job) return [];
        return workHistoryEntriesRaw().filter(e => {
            if (e.source === 'defect') {
                const dc = e.defect;
                return dc && (dc.maintenance_job_id === job.id || dc.job_code === job.job_code);
            }
            const item = e.item;
            return item && (item.maintenance_job_id === job.id || item.job_code === job.job_code);
        });
    }

    function jobConsumedSpareParts(jobId) {
        const spareById = new Map((state.spares || []).map(s => [s.id, s]));
        const consumed = [];
        jobWorkHistoryEntries(jobId).forEach(entry => {
            if (entry.source !== 'report') return;
            const { report: r, item } = entry;
            if (!r || !item) return;
            const parts = item.used_parts?.length ? item.used_parts : (r.is_batch ? [] : (r.used_parts || []));
            const dt = formatCmaxsHistDate(r.work_date || r.report_date || r.created_at);
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
        });
        return consumed;
    }

    function wrReportForm(report) {
        return report?.report_form || {};
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
        const status = item
            ? TVC_RBAC.normalizeReportStatus(item.status, report?.is_locked)
            : repSt(report);
        const wf = report ? workReportListWorkflowStatus(report) : null;
        if (wf && (!item || report.job_items?.length === 1)) return wf;
        const labels = {
            REPORTED: 'Reported',
            CONFIRMED: 'Confirmed',
            APPROVED: 'Approved',
        };
        return labels[status] || 'Reported';
    }

    function workHistoryStatusLabel(report, item) {
        return reportWorkflowStatusLabel(report, item);
    }

    /** Work History 목록(필터+정렬) — 렌더링과 Prev/Next 네비게이션이 공유 */
    function workHistoryReports() {
        let reports = state.reports.slice();
        if (state.department) reports = reports.filter(r => reportDept(r) === state.department);
        reports.sort((a, b) => (b.work_date || b.report_date || b.created_at || '').localeCompare(a.work_date || a.report_date || a.created_at || ''));
        return reports;
    }

    /** Work History — Work Report(job item) + Defect Case 통합 타임라인 */
    function getListFilterState() { return state.listFilters; }
    function getAppDepartment() { return state.department; }
    function getAppUserDepartment() { return state.user?.department || null; }
    function getSelectedGroupKey() { return state.selectedGroupKey; }
    function getAppIdx() { return state.idx; }
    function getAppJobs() { return state.jobs; }

    function setListFilters(tab, patch) {
        if (!state.listFilters[tab]) return;
        Object.assign(state.listFilters[tab], patch);
        rerenderCurrentTab();
        TVC_ListFilters?.syncBtn(tab);
    }

    function clearListFilters(tab) {
        if (tab === 'actual') setListFilters('actual', { pics: [], unassigned: false });
        else if (tab === 'defect') setListFilters('defect', { groupKeys: [], openOnly: false });
        else if (tab === 'history') setListFilters('history', { groupKeys: [], type: 'all' });
    }

    function syncListFilterBtns() {
        ['actual', 'defect', 'history'].forEach(t => TVC_ListFilters?.syncBtn(t));
    }

    function listFilterCtx() {
        return { idx: state.idx, jobs: state.jobs };
    }

    function workHistoryEntriesRaw() {
        const entries = [];
        workHistoryReports().forEach(r => {
            TVC_WorkReport.fromLegacy(r);
            (r.job_items || []).forEach(item => entries.push({ source: 'report', report: r, item }));
        });
        workHistoryDefectCases().forEach(dc => entries.push({ source: 'defect', defect: dc }));
        entries.sort((a, b) => histEntrySortDate(b).localeCompare(histEntrySortDate(a)));
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

    function allWorkHistoryConfirmed() {
        const entries = workHistoryEntriesRaw();
        if (!entries.length) return true;
        return entries.every(isWorkHistoryEntryConfirmed);
    }

    function isRhUpdateCommitted() {
        return TVC_RunHours.hasPendingRevert();
    }

    function canUpdateRunningHours() {
        return allWorkHistoryConfirmed() && !isRhUpdateCommitted();
    }

    function canUpdateWorkPlanFromRh() {
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

    function isHistRowCheckable(entry) {
        if (isHistDefectEntry(entry)) return false;
        const { report: r, item } = entry;
        if (!state.user || r.is_locked || reportIsApproved(r)) return false;
        return itemSt(item) === 'REPORTED';
    }

    function isHistRowApprovable(entry) {
        if (!isHistRowCheckable(entry)) return false;
        const { report: r } = entry;
        if (TVC_RBAC.isConfirmedStatus(r.status)) return false;
        return TVC_RBAC.canConfirmDepartment(state.user, reportDept(r));
    }

    function histCheckDisabledTitle(entry) {
        if (isHistDefectEntry(entry)) return 'Defect case — Confirm 불가';
        const { report: r, item } = entry;
        if (!state.user) return '로그인 필요';
        if (r.is_locked || reportIsApproved(r)) return '승인 완료된 리포트';
        if (itemSt(item) !== 'REPORTED') return 'REPORTED 항목만 선택 가능';
        if (!TVC_RBAC.canConfirmDepartment(state.user, reportDept(r))) {
            return 'Confirm 권한 없음 (Engine Mode · C/E 또는 Master Mode · Captain)';
        }
        if (TVC_RBAC.isConfirmedStatus(r.status)) return '이미 Confirm 됨';
        return '선택 불가';
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
        document.querySelectorAll('#tab-history .sheet-table-wrap, #tab-defect .sheet-table-wrap').forEach(container => {
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
        const cols = defectHistoryColumns(dc);
        const dt = formatCmaxsHistDate(dc.work_date || dc.report_date || dc.submitted_at || dc.created_at);
        const st = defectHistoryStatusLabel(dc);
        const flags = defectHistoryFormFlags(dc);
        const sel = opts.selected ? ' row-selected' : '';
        const rowKey = opts.rowKey || histDefectRowKey(dc.id);
        const chk = opts.checkboxHtml ?? '<input type="checkbox" disabled>';
        const onclick = opts.onclick ? ` onclick="${opts.onclick}"` : '';
        const ondblclick = opts.ondblclick ? ` ondblclick="${opts.ondblclick}"` : '';
        const fileNoCell = opts.fileNoColumn
            ? `<td class="hist-file">${esc(String(dc.file_no || '').trim() || '—')}</td>`
            : '';
        const typeCell = opts.criticalColumn ? defectCriticalTypeCell(dc) : defectReportTypeCell();
        const critCell = opts.includeCriticalColumn ? defectCriticalTypeCell(dc) : '';
        const detailCell = opts.omitDetailColumn ? '' : `<td class="hist-detail">${histCellHtml(cols.jobDetail)}</td>`;
        const useListColStyle = opts.omitDetailColumn || opts.historyListColumns;
        const atShipClass = useListColStyle ? 'hist-at-ship' : '';
        const atCompanyClass = useListColStyle ? 'hist-at-company' : '';
        return `<tr class="hist-row hist-row-defect${sel}" data-df-id="${escAttr(dc.id)}" data-hist-key="${escAttr(rowKey)}"${onclick}${ondblclick}>
                <td class="hist-chk" onclick="event.stopPropagation()">${chk}</td>
                ${fileNoCell}
                ${typeCell}
                ${critCell}
                <td class="hist-code">${cols.jobCode ? `<strong>${esc(cols.jobCode)}</strong>` : '—'}</td>
                <td class="hist-sort1">${histCellHtml(cols.sort1)}</td>
                <td class="hist-sort2">${histCellHtml(cols.sort2)}</td>
                ${detailCell}
                <td class="hist-date">${esc(dt || '—')}</td>
                <td class="hist-status">${esc(st)}</td>
                ${histFlagCell(flags.repairRequest)}
                ${histFlagCell(flags.shoreSupport)}
                ${histFlagCell(flags.defectCleared)}
                ${histFlagCell(flags.shipComment)}
                ${histFlagCell(flags.companyComment)}
                ${histAttachmentCell(dc.ship_attachments, atShipClass)}
                ${histAttachmentCell(dc.company_attachments, atCompanyClass)}
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

    function getCurrentWrHistEntry() {
        if (!state._wrReportId) return null;
        return workHistoryEntries().find(entry => {
            if (isHistDefectEntry(entry)) return false;
            if (entry.report.id !== state._wrReportId) return false;
            if (state._wrBatchItemId) return entry.item.maintenance_job_id === state._wrBatchItemId;
            return true;
        }) || null;
    }

    function isHistWorkReportModifiableStatus(entry) {
        if (!entry || isHistDefectEntry(entry)) return false;
        const r = entry?.report;
        if (!r) return false;
        if (TVC_RBAC.isApprovedStatus(r.status, r.is_locked)) return false;
        if (TVC_RBAC.isConfirmedStatus(r.status, r.is_locked) && r.sync_status === 'SYNCED') return false;
        const st = workReportListWorkflowStatus(r);
        return st !== 'Approved' && st !== 'Submitted';
    }

    function canModifyHistEntry(entry) {
        if (!entry || !state.user) return false;
        if (isHistDefectEntry(entry)) return false;
        const r = entry?.report;
        if (!r) return false;
        if (TVC_RBAC.isApprovedStatus(r.status, r.is_locked)) return false;
        if (TVC_RBAC.isConfirmedStatus(r.status, r.is_locked) && r.sync_status === 'SYNCED') return false;
        const st = workReportListWorkflowStatus(r);
        if (st === 'Approved' || st === 'Submitted') return false;
        return TVC_RBAC.canModifyDeleteListReport(state.user, reportDept(r), st);
    }

    function canDeleteHistEntry(entry) {
        if (isHistDefectEntry(entry)) return false;
        const r = entry?.report;
        if (!r || !state.user) return false;
        if (TVC_RBAC.isApprovedStatus(r.status, r.is_locked)) return false;
        if (TVC_RBAC.isConfirmedStatus(r.status, r.is_locked) && r.sync_status === 'SYNCED') return false;
        const st = workReportListWorkflowStatus(r);
        if (st === 'Approved' || st === 'Submitted') return false;
        if (r.is_locked || reportIsApproved(r)) return false;
        return TVC_RBAC.canModifyDeleteListReport(state.user, reportDept(r), st);
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
        const reportIds = [...new Set(candidates.map(e => e.report.id))];
        return reportIds.every(id => {
            const rep = state.reports.find(r => r.id === id);
            if (!rep) return false;
            const hasReported = TVC_WorkReport.getJobItems(rep).some(i => itemSt(i) === 'REPORTED');
            if (!hasReported || rep.is_locked || reportIsApproved(rep)) return false;
            if (TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked)) return false;
            return state.user && TVC_RBAC.canConfirmDepartment(state.user, reportDept(rep));
        });
    }

    function updateHistToolbarState() {
        const entry = getSelectedHistEntry();
        const checkedEntries = workHistoryEntries().filter(e =>
            state._histChecked?.[histEntryRowKey(e)]
        );
        const confirmCandidates = getHistConfirmCandidates();
        const checkedApprovableCount = checkedEntries.filter(isHistRowApprovable).length;
        const canConfirm = checkedEntries.length
            ? checkedEntries.length === checkedApprovableCount && canConfirmHistReports(confirmCandidates)
            : canConfirmHistReports(confirmCandidates);
        const setDis = (id, dis) => {
            const el = document.getElementById(id);
            if (el) { if (dis) el.setAttribute('disabled', ''); else el.removeAttribute('disabled'); }
        };
        const setVis = (id, show) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !show);
        };
        setDis('histBtnDetail', !entry);
        const modifiableStatus = isHistWorkReportModifiableStatus(entry);
        setVis('histBtnModify', modifiableStatus);
        setDis('histBtnModify', !entry || !canModifyHistEntry(entry));
        setDis('histBtnDelete', !entry || !canDeleteHistEntry(entry));
        setDis('histBtnApprove', !canConfirm);
        const approveBtn = document.getElementById('histBtnApprove');
        if (approveBtn) {
            approveBtn.textContent = checkedApprovableCount >= 1
                ? `Report Confirm (${checkedApprovableCount})`
                : 'Report Confirm';
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

    function openDefectFromHistory(defectId) {
        if (!defectId) return;
        state._histSelReportId = histDefectRowKey(defectId);
        TVC_DefectReport.openCaseFromNav(defectId, 'history', 'view', { swapHide: 'workReportModal' });
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
            const i = list.findIndex(e => !isHistDefectEntry(e) && e.report.id === state._wrReportId
                && (!state._wrBatchItemId || e.item.maintenance_job_id === state._wrBatchItemId));
            if (i >= 0) return i;
        }
        return -1;
    }

    function openWorkHistoryEntry(entry, opts = {}) {
        state._histSelReportId = histEntryRowKey(entry);
        if (isHistDefectEntry(entry)) {
            TVC_DefectReport.openCaseFromNav(entry.defect.id, 'history', 'view', { swapHide: 'workReportModal' });
            return;
        }
        const wrOpts = {
            fromHistory: true,
            keepTab: opts.keepTab || state._wrTab,
            swapHide: 'defectReportModal',
        };
        if (opts.preserveWrMode && state._wrFromHistory) {
            wrOpts.view = !!(state._wrReadonly || state._wrPostSaveView);
            wrOpts.edit = !state._wrReadonly && !state._wrPostSaveView;
        } else {
            wrOpts.view = true;
        }
        openWorkReportFromHistory(entry.report.id, entry.item.maintenance_job_id, wrOpts);
    }

    /** Work History 목록 전체(Work Report + Defect) 순서로 Previous / Next */
    function navWorkHistoryEntry(dir) {
        const list = workHistoryEntries();
        if (!list.length) return;
        let i = findCurrentWorkHistoryNavIndex(list);
        if (i < 0) i = 0;
        else i += dir;
        if (i < 0) { alert('첫 번째 항목입니다.'); return; }
        if (i >= list.length) { alert('마지막 항목입니다.'); return; }
        openWorkHistoryEntry(list[i], { preserveWrMode: true, keepTab: state._wrTab });
    }

    function histDetailWorkReport() {
        const entry = getSelectedHistEntry();
        if (!entry) return alert('Work History에서 항목을 선택하세요.');
        if (isHistDefectEntry(entry)) {
            openDefectFromHistory(entry.defect.id);
            return;
        }
        openWorkReportFromHistory(entry.report.id, entry.item.maintenance_job_id, { fromHistory: true, view: true });
    }

    function histModifyReport() {
        const entry = getSelectedHistEntry();
        if (!entry) return alert('Work History에서 항목을 선택하세요.');
        if (isHistDefectEntry(entry)) {
            return alert('Defect Report Modify · Delete는 Defect Report 탭에서만 가능합니다.');
        }
        if (!canModifyHistEntry(entry)) {
            const st = workReportListWorkflowStatus(entry.report);
            if (st === 'Confirmed') return alert('Confirmed 상태는 Captain / Chief Engineer만 수정할 수 있습니다.');
            return alert('Approved · Submitted 상태는 수정할 수 없습니다.');
        }
        openWorkReportFromHistory(entry.report.id, entry.item.maintenance_job_id, { fromHistory: true, edit: true });
    }

    async function histReportApproval() {
        const checkedEntries = workHistoryEntries().filter(e =>
            state._histChecked?.[histEntryRowKey(e)]
        );
        const confirmCandidates = getHistConfirmCandidates();
        if (!confirmCandidates.length) {
            return alert('Confirm할 REPORTED 항목의 체크박스(ㅁ)를 선택하세요.');
        }
        if (checkedEntries.length && confirmCandidates.length !== checkedEntries.length) {
            return alert('선택한 항목 중 Confirm할 수 없는 항목이 있습니다.\nEngine Mode(C/E) 또는 Master Mode(Captain) 로그인을 확인하세요.');
        }
        const reportIds = [...new Set(confirmCandidates.map(e => e.report.id))];
        const user = TVC_Auth.requirePermission(TVC_RBAC.Action.APPROVE_DAILY_REPORT);
        if (!user) return;

        for (const id of reportIds) {
            const rep = state.reports.find(r => r.id === id);
            if (!rep) return alert('리포트를 찾을 수 없습니다.');
            const hasReported = TVC_WorkReport.getJobItems(rep).some(i => itemSt(i) === 'REPORTED');
            if (!hasReported) return alert(`${rep.job_code}: Confirm할 수 없는 상태입니다.`);
            const dept = reportDept(rep);
            if (!TVC_RBAC.canConfirmDepartment(user, dept)) {
                return alert(`타 부서(${dept || '?'}) 리포트는 Confirm할 수 없습니다: ${rep.job_code}`);
            }
        }
        if (!confirm(`${reportIds.length}건의 Work Report를 Confirm하시겠습니까?\n(재고 차감 · LAST DONE / NEXT DATE 갱신)`)) return;

        let ok = 0;
        for (const id of reportIds) {
            try {
                await TVC_Transaction.confirmReport(user, id);
                ok++;
            } catch (e) {
                alert(`${id}: ${e.message || e.code || 'Confirm 실패'}`);
                break;
            }
        }
        state._histChecked = {};
        await refreshAll();
        if (ok) alert(`${ok}건 Confirm 완료`);
    }

    async function histDeleteReport() {
        const entry = getSelectedHistEntry();
        if (!entry) return alert('Work History에서 항목을 선택하세요.');
        if (isHistDefectEntry(entry)) {
            return alert('Defect Report Modify · Delete는 Defect Report 탭에서만 가능합니다.');
        }
        if (!canDeleteHistEntry(entry)) {
            if (reportIsApproved(entry.report) || entry.report.is_locked) {
                return alert('본사 승인(APPROVED)된 리포트는 삭제할 수 없습니다.');
            }
            return alert('Confirm 완료된 리포트는 Captain / Chief Engineer만 삭제할 수 있습니다.');
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
                const chk = `<input type="checkbox" disabled title="${escAttr(histCheckDisabledTitle(entry))}">`;
                return buildDefectHistRowHtml(dc, {
                    rowKey,
                    selected: sel,
                    checkboxHtml: chk,
                    includeCriticalColumn: true,
                    omitDetailColumn: true,
                    historyListColumns: true,
                    onclick: `TVC_App.selectHistRow('${escAttr(rowKey)}', event)`,
                    ondblclick: `TVC_App.openDefectFromHistory('${escAttr(dc.id)}')`,
                });
            }
            const { report: r, item } = entry;
            const job = state.idx?.jobById.get(item.maintenance_job_id) || state.jobs.find(j => j.job_code === item.job_code);
            const f = item.form || wrReportForm(r);
            const dt = formatCmaxsHistDate(r.work_date || r.report_date || r.created_at);
            const st = reportWorkflowStatusLabel(r, item);
            const flags = workHistoryFormFlags(f, r);
            const rowKey = histEntryRowKey(entry);
            const sel = state._histSelReportId === rowKey ? ' row-selected' : '';
            const batchTag = r.is_batch ? `<span class="pill ok" title="Batch report">B</span> ` : '';
            const wrEntry = { source: 'report', report: r, item };
            const canCheck = isHistRowCheckable(wrEntry);
            const checked = canCheck && !!state._histChecked?.[rowKey];
            const chk = canCheck
                ? `<input type="checkbox" class="hist-chk-input"${checked ? ' checked' : ''}>`
                : `<input type="checkbox" disabled title="${escAttr(histCheckDisabledTitle(wrEntry))}">`;
            return `<tr class="hist-row${sel}" data-hist-key="${escAttr(rowKey)}" onclick="TVC_App.selectHistRow('${escAttr(rowKey)}', event)" ondblclick="TVC_App.openWorkReportFromHistory('${escAttr(r.id)}','${escAttr(item.maintenance_job_id)}',{fromHistory:true,view:true})">
                <td class="hist-chk" onclick="event.stopPropagation()">${chk}</td>
                ${histTypeCell(wrEntry)}
                ${histCriticalCell(wrEntry)}
                <td class="hist-code">${batchTag}${item.job_code ? `<strong>${esc(item.job_code)}</strong>` : '—'}</td>
                <td class="hist-sort1">${histCellHtml(job?.item_sort1)}</td>
                <td class="hist-sort2">${histCellHtml(job?.item_sort2)}</td>
                <td class="hist-date">${esc(dt || '—')}</td>
                <td class="hist-status">${esc(st)}</td>
                ${histFlagCell(flags.repairRequest)}
                ${histFlagCell(flags.shoreSupport)}
                ${histFlagCell(flags.defectCleared)}
                ${histFlagCell(flags.shipComment)}
                ${histFlagCell(flags.companyComment)}
                ${histAttachmentCell(f.shipAttachments, 'hist-at-ship')}
                ${histAttachmentCell(f.companyAttachments, 'hist-at-company')}
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
        renderWorkHistory();
    }

    // ── TAB: Running Hours (예측 정비 엔진 UI) ───────────────────────
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

    function openSpareAppend() {
        if (!canEditSpareItems()) return alert('Chief Engineer / Captain 권한이 필요합니다.');
        TVC_SpareMenu.append();
    }

    function openSpareModify() {
        if (state.spareModule?.inlineEditId) {
            return TVC_SpareMenu.saveInlineEdit();
        }
        const ids = spareActionIds('modify');
        if (!ids.length) return alert('수정할 부품을 선택하세요 (행 클릭 또는 ㅁ 체크).');
        if (batchSelectedSpareIds().length > 1) return alert('수정은 한 건만 선택할 수 있습니다.');
        if (!canEditSpareItems()) return alert('Chief Engineer / Captain 권한이 필요합니다.');
        TVC_SpareMenu.edit(ids[0]);
    }

    function deleteSpareItem() {
        const ids = spareActionIds('delete');
        if (!ids.length) return alert('삭제할 부품을 선택하세요 (행 클릭 또는 ㅁ 체크).');
        if (!canEditSpareItems()) return alert('Chief Engineer / Captain 권한이 필요합니다.');
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
    function openWorkProcedure(jobId, tab) {
        const job = resolveJobById(jobId);
        if (!job) return alert('작업을 찾을 수 없습니다.');
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

    function setWorkProcedureTab(tab) {
        state._wpTab = tab;
        if (tab !== 'procedure') state._wpEditing = false;
        try {
            renderWorkProcedureModal();
        } catch (err) {
            console.error('[WorkProcedure tab]', err);
            alert('Work History 화면을 불러오지 못했습니다.');
        }
    }

    function enterWorkProcedureEdit() {
        if (!canEditWorkProcedure()) return alert(workProcedureEditDeniedMessage());
        state._wpEditing = true;
        renderWorkProcedureModal();
        requestAnimationFrame(() => document.getElementById('wpProcedureInput')?.focus());
    }

    function cancelWorkProcedureEdit() {
        state._wpEditing = false;
        renderWorkProcedureModal();
    }

    function saveWorkProcedure() {
        const job = resolveJobById(state._wpJobId);
        if (!job) return;
        if (!canEditWorkProcedure()) return alert(workProcedureEditDeniedMessage());
        const text = String(document.getElementById('wpProcedureInput')?.value ?? '').trim();
        TVC_JobMeta.setProcedure(job.job_code, text);
        TVC_JobMeta.addHistory(job.job_code, {
            action: 'PROCEDURE_SAVED',
            user: state.user?.display_name || '',
            notes: text.slice(0, 100),
        });
        state._wpEditing = false;
        renderWorkProcedureModal();
        alert('Work Procedure saved.');
    }

    function renderWorkProcedureModal() {
        const job = resolveJobById(state._wpJobId);
        const host = document.getElementById('workProcedureBody');
        if (!job || !host) return;
        const meta = TVC_JobMeta.getHistoryForJob(job.job_code);
        const histEntries = jobWorkHistoryEntries(job.id).filter(e => e.source === 'report');
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
            const histRows = histEntries.length ? histEntries.map(({ report: r, item }) => {
                const f = item.form || wrReportForm(r);
                const dt = formatCmaxsHistDate(r.work_date || r.report_date || r.created_at);
                const st = reportWorkflowStatusLabel(r, item);
                const desc = item.description || r.description || '—';
                const batchTag = r.is_batch ? ' <span class="pill ok" title="Batch report">B</span>' : '';
                return `<tr class="wp-hist-row" ondblclick="TVC_App.closeModal('workProcedureModal');TVC_App.openWorkReportFromHistory('${escAttr(r.id)}','${escAttr(item.maintenance_job_id)}')" title="Double-click to open Work Report">
                <td>${esc(dt)}</td>
                <td><span class="pill ${TVC_RBAC.isConfirmedStatus(r.status) || TVC_RBAC.isApprovedStatus(r.status) ? 'ok' : 'warn'}">${esc(st)}</span>${batchTag}</td>
                <td>${esc(reporterLabel(r.reporter_name) || '—')}</td>
                <td>${esc(desc)}</td>
                <td>${esc(r.company_comment || '—')}</td>
            </tr>`;
            }).join('') : '<tr><td colspan="5" class="muted" style="text-align:center">No work history</td></tr>';
            const consumed = jobConsumedSpareParts(job.id);
            const spareRows = consumed.length ? consumed.map(c => `<tr>
                <td>${esc(c.date || '—')}</td><td>${esc(c.part_no)}</td><td>${esc(c.name)}</td>
                <td>${esc(c.unit)}</td><td style="text-align:right">${c.qty ?? '—'}</td>
            </tr>`).join('') : '<tr><td colspan="5" class="muted" style="text-align:center">No consumed spare parts</td></tr>';
            tabContent = `
                <div class="wp-section">
                    <div class="wp-section-head">Work History <span class="muted wp-hist-hint">(same as Work History tab · double-click row)</span></div>
                    <div class="wp-table-wrap">
                        <table class="wp-table">
                            <thead><tr><th>Work Date</th><th>Status</th><th>Reporter</th><th>Description</th><th>HQ Comment</th></tr></thead>
                            <tbody>${histRows}</tbody>
                        </table>
                    </div>
                </div>
                <div class="wp-section">
                    <div class="wp-section-head">Consumed Spare Parts</div>
                    <div class="wp-table-wrap">
                        <table class="wp-table">
                            <thead><tr><th>Date</th><th>Code</th><th>Parts Name</th><th>Unit</th><th>Used</th></tr></thead>
                            <tbody>${spareRows}</tbody>
                        </table>
                    </div>
                </div>`;
        }

        const canEditProc = canEditWorkProcedure();
        const editingProc = state._wpTab === 'procedure' && !!state._wpEditing;
        const procEditTip = escAttr(workProcedureEditDeniedMessage());
        let procEditBtns = '';
        if (state._wpTab === 'procedure') {
            procEditBtns = editingProc
                ? `<button type="button" class="btn btn-green" onclick="TVC_App.saveWorkProcedure()">Save</button>
                <button type="button" class="btn" onclick="TVC_App.cancelWorkProcedureEdit()">Cancel</button>`
                : `<button type="button" class="btn" onclick="TVC_App.enterWorkProcedureEdit()"${canEditProc ? '' : ` disabled title="${procEditTip}"`}>Modify</button>`;
        }

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
                <button type="button" class="wp-tab${histActive}" onclick="TVC_App.setWorkProcedureTab('history')">Work History &amp; Consumed Spare Parts</button>
            </div>
            <div class="wp-tab-pane">${tabContent}</div>
            <div class="modal-actions wp-modal-actions">
                ${procEditBtns}
                <button type="button" class="btn btn-green" onclick="TVC_App.closeModal('workProcedureModal');TVC_App.openWorkReportInput('${job.id}')"${editingProc ? ' disabled' : ''}>Report Input</button>
                <button type="button" class="btn" onclick="TVC_App.closeModal('workProcedureModal')">Close</button>
            </div>`;
    }

    // ── CMAXS Work Report (3 tabs) ───────────────────────────────────
    const WR_TABS = {
        repair: 'Maintenance',
        postpone: 'Postpone',
    };

    /** Original / Work Plan → Report Input: CMAXS 스타일 Work Report 화면 */
    function openWorkReport(jobId, tab) {
        const job = state.idx.jobById.get(jobId);
        if (!job) return;
        if (state.user.department && state.user.department !== job.department) {
            return alert('타 부서 항목은 보고할 수 없습니다.');
        }
        state._batchMode = false;
        state._batchJobIds = [];
        state._batchDraft = null;
        if (state._wrJobId !== jobId) {
            const today = new Date().toISOString().slice(0, 10);
            state._wrForm = defaultWrForm(today);
            const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
            Object.assign(state._wrForm, {
                lastMaintDate: today,
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
        }
        state._wrReportId = null;
        state._wrBatchItemId = null;
        state._wrReadonly = false;
        state._wrPostSaveView = false;
        state._wrFromHistory = false;
        state._wrJobId = jobId;
        state._wrUsedParts = [];
        state.selectedJobId = jobId;
        state._wrTab = tab || state._wrTab || 'repair';
        if (state.vlActual) state.vlActual.refresh();
        renderSidePanel();
        renderWorkReportModal();
        showModal('workReportModal');
    }

    /** Work History: 더블 클릭 — 저장된 Work Report를 그대로 재현(읽기 전용, Modify 가능) */
    function openWorkReportFromHistory(reportId, jobId, opts = {}) {
        const rep = state.reports.find(r => r.id === reportId);
        if (!rep) return;
        TVC_WorkReport.fromLegacy(rep);
        const item = jobId
            ? TVC_WorkReport.findItem(rep, jobId)
            : TVC_WorkReport.getJobItems(rep)[0];
        const job = state.idx?.jobById.get(item?.maintenance_job_id || rep.maintenance_job_id)
            || state.jobs.find(j => j.job_code === (item?.job_code || rep.job_code));
        if (!job) return alert('해당 작업 항목을 찾을 수 없습니다.');
        state._wrJobId = job.id;
        state.selectedJobId = job.id;
        state._wrReportId = reportId;
        state._wrBatchItemId = item?.maintenance_job_id || null;
        state._wrPostSaveView = false;
        state._wrFromHistory = !!opts.fromHistory;
        if (opts.fromHistory) {
            const histEntry = workHistoryEntries().find(e =>
                !isHistDefectEntry(e)
                && e.report.id === reportId
                && e.item.maintenance_job_id === (item?.maintenance_job_id || job.id)
            );
            if (histEntry) state._histSelReportId = histEntryRowKey(histEntry);
        }
        const histEntry = { source: 'report', report: rep, item };
        if (opts.edit) {
            state._wrReadonly = false;
        } else if (opts.fromHistory || opts.view) {
            state._wrReadonly = true;
        } else {
            state._wrReadonly = !canModifyHistEntry(histEntry);
        }
        state._wrForm = { ...(item?.form || rep.report_form || {}) };
        state._wrUsedParts = enrichUsedParts(item?.used_parts || rep.used_parts || []);
        state._wrPage = '1';
        state._wrSpareSearch = '';
        state._wrTab = opts.keepTab || (rep.work_type === 'POSTPONE' ? 'postpone' : 'repair');
        if (!opts.skipRender) renderWorkReportModal();
        if (opts.swapHide) swapHistoryModals('workReportModal', opts.swapHide);
        else showModal('workReportModal');
    }

    /** 히스토리 읽기 뷰 → 편집 모드 전환 */
    function modifyWorkReport() {
        state._wrReadonly = false;
        state._wrPostSaveView = false;
        renderWorkReportModal();
    }

    function reloadWorkReportViewFromDb(report, job) {
        TVC_WorkReport.fromLegacy(report);
        const item = TVC_WorkReport.findItem(report, job.id)
            || TVC_WorkReport.getJobItems(report)[0];
        state._wrReportId = report.id;
        state._wrBatchItemId = item?.maintenance_job_id || null;
        state._wrForm = { ...(item?.form || report.report_form || {}) };
        state._wrUsedParts = enrichUsedParts(item?.used_parts || report.used_parts || []);
        state._wrTab = report.work_type === 'POSTPONE' ? 'postpone' : 'repair';
        state._wrPage = '1';
        state._wrSpareSearch = '';
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
        state._wrReportId = report.id;
        state._wrBatchItemId = item?.maintenance_job_id || null;
        state._wrForm = { ...(item?.form || report.report_form || {}) };
        state._wrUsedParts = enrichUsedParts(item?.used_parts || report.used_parts || []);
        state._wrTab = report.work_type === 'POSTPONE' ? 'postpone' : 'repair';
        state._wrPage = '1';
        state._wrSpareSearch = '';
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
            return alert('본사 승인(APPROVED)된 리포트는 삭제할 수 없습니다.');
        }
        if (isShipConfirmed && !TVC_RBAC.isApprover(user)) {
            return alert('Confirm 완료된 리포트는 Captain / Chief Engineer만 삭제할 수 있습니다.');
        }

        const msg = isShipConfirmed
            ? 'Confirm 완료된 Work Report를 삭제합니다.\n\n차감된 재고와 LAST DONE / NEXT DATE가 Confirm 이전 상태로 자동 복구됩니다. 계속하시겠습니까?'
            : '이 Work Report를 삭제하시겠습니까? 되돌릴 수 없습니다.';
        if (!confirm(msg)) return;

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
            alert(isShipConfirmed
                ? 'Work Report가 삭제되고 재고·일자가 원상복구되었습니다.'
                : 'Work Report가 삭제되었습니다.');
        } catch (e) {
            const code = e.code || '';
            if (code === 'LOCKED') return alert('본사 확정된 리포트는 삭제할 수 없습니다.');
            if (code === 'FORBIDDEN') return alert('타 부서 리포트는 삭제할 수 없습니다.');
            alert(e.message || code);
        }
    }

    /** 현재 Work Report 화면을 프린트 */
    function printWorkReport() {
        captureWorkReportForm();
        renderWorkReportModal();
        const host = document.getElementById('workReportBody');
        const page = host?.querySelector('.wr-page');
        const tabsel = host?.querySelector('.wr-tabsel');
        const title = host?.querySelector('.wr-titlebar')?.textContent || 'Work Report';
        if (!page) return;
        const w = window.open('', '_blank');
        w.document.write(`<html><head><title>TVC — ${esc(title)}</title>
            <base href="${location.href}">
            <link rel="stylesheet" href="css/app.css">
            <style>
                body { padding: 16px; background: #fff; }
                .wr-print-title { font-size: 16px; font-weight: 700; color: #1a365d; margin: 0 0 10px; }
                .wr-page { max-height: none !important; overflow: visible !important; }
                input, textarea, select { border: 1px solid #cbd5e0 !important; background: #fff !important; }
                @media print { .wr-tabsel { break-inside: avoid; } }
            </style></head><body>
            <div class="wr-print-title">${esc(title)}</div>
            ${tabsel ? tabsel.outerHTML : ''}
            ${page.outerHTML}
            </body></html>`);
        w.document.close();
        w.focus();
        setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
    }

    function setWorkReportTab(tab) {
        if (state._batchMode && tab !== 'repair') return;
        if (!WR_TABS[tab]) tab = 'repair';
        if (state._batchMode) captureBatchJobDraft();
        else {
            captureWorkReportForm();
            captureWorkReportUsedParts();
        }
        state._wrTab = tab;
        state._wrPage = '1';
        renderWorkReportModal();
    }

    function setWorkReportPage(page) {
        if (state._batchMode) captureBatchJobDraft();
        else {
            captureWorkReportForm();
            captureWorkReportUsedParts();
        }
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
        host.querySelectorAll('.spare-wr-qty-input').forEach(el => {
            const table = el.closest('[data-spare-id]');
            const id = table?.dataset?.spareId;
            if (!id) return;
            const row = (state._wrUsedParts || []).find(p => String(p.spare_part_id ?? '') === String(id));
            if (row) row.qty_used = Math.max(0, Math.floor(Number(el.value) || 0));
        });
    }

    function buildWrPage2JobItems(job) {
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        if (state._batchMode && state._batchJobIds?.length >= 2) {
            const jobs = state._batchJobIds
                .map(id => state.idx?.jobById.get(id))
                .filter(Boolean);
            return TVC_SpareMenu.buildPage2JobItemsFromJobs(jobs);
        }
        if (rep?.is_batch && rep.job_items?.length) {
            return rep.job_items.map(it => TVC_SpareMenu.newConsumeJobRow({
                job_code: it.job_code || '',
                sort1: it.item_sort1 || it.form?.sort1 || '',
                sort2: it.item_sort2 || it.form?.sort2 || '',
                job_detail: it.description || it.form?.jobDetail || it.job_detail || '',
            }));
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
            shipComments: wf('shipComments', ''),
            jobItems: buildWrPage2JobItems(job),
            allowAdd: false,
        };
    }

    function renderWrBatchJobRowsHtml(jobIds, activeJobId) {
        if (!jobIds?.length) return '';
        const rows = jobIds.map(id => {
            const j = state.idx?.jobById.get(id);
            if (!j) return '';
            const active = id === activeJobId ? ' wr-maint-batch-job-row-active' : '';
            return `<div class="wr-maint-grid wr-maint-grid-4 wr-maint-batch-job-row${active}" data-batch-job-id="${escAttr(id)}" role="button" tabindex="0"
                onclick="TVC_App.setBatchActiveJob('${escAttr(id)}')">
                <div class="wr-maint-batch-cell"><span class="wr-maint-batch-code">${esc(j.job_code)}</span></div>
                <div class="wr-maint-batch-cell" title="${escAttr(j.item_sort1 || '')}">${esc(j.item_sort1 || '—')}</div>
                <div class="wr-maint-batch-cell" title="${escAttr(j.item_sort2 || '')}">${esc(j.item_sort2 || '—')}</div>
                <div class="wr-maint-batch-cell" title="${escAttr(j.job_detail || '')}">${esc(j.job_detail || '—')}</div>
            </div>`;
        }).join('');
        return `<div class="wr-maint-batch-job-list">
            <div class="wr-maint-grid wr-maint-grid-4 wr-maint-batch-job-header">
                <div class="wr-maint-batch-h">Job Code</div>
                <div class="wr-maint-batch-h">SORT-1</div>
                <div class="wr-maint-batch-h">SORT-2</div>
                <div class="wr-maint-batch-h">Job Detail</div>
            </div>
            ${rows}
        </div>`;
    }

    const WR_PICK_Z = 10100;
    let _wrGroupPickSearch = '';
    let _wrJobPickSearch = '';

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

    function buildWrGroupPickList() {
        const key = wrGroupKeyFromForm();
        const q = (_wrGroupPickSearch || '').toLowerCase().trim();
        const matchNode = (n) => !q || TVC_SpareMenu.safeTreeLabel(n.label).toLowerCase().includes(q);
        const critKey = TVC_SpareMenu.CRITICAL_GROUP_KEY;
        let html = '';
        if (!q || 'critical'.includes(q)) {
            html += `<button type="button" class="spare-consume-pick-item${key === critKey ? ' selected' : ''}"
                onclick="TVC_App.pickWrGroup('${escAttr(critKey)}','Critical Equipment')">⚠ Critical Equipment</button>`;
        }
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

    function toggleWrJobPick(ev) {
        ev?.stopPropagation();
        if (!wrGroupKeyFromForm()) return alert('PMS Group No.를 먼저 선택하세요.');
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

    function renderWrReportFooter(opts = {}) {
        const {
            rep = null,
            ro = false,
            canEditShipAttach = true,
            canEditCompanyAttach = false,
            showShipComment = true,
        } = opts;
        const dis = ro ? ' disabled' : '';
        const roAttr = ro ? ' readonly' : '';
        const fld = (label, inner, extraCls = '') =>
            `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const flagChk = (key, label) => `<label class="wr-footer-flag">
            <input type="checkbox" data-wf="${key}"${wrFormFlag(key) ? ' checked' : ''}${dis}>
            <span>${esc(label)}</span>
        </label>`;

        return `
            <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap">
                ${fld('Working Hours', `<input type="number" data-wf="handHours" value="${esc(wf('handHours', '0'))}"${dis}>`)}
                ${fld('Working Member', `<input type="number" data-wf="handMembers" value="${esc(wf('handMembers', '0'))}"${dis}>`)}
                <div class="wr-maint-field wr-maint-chk-field">${flagChk('shoreSupport', 'Conducted by Shore Support')}</div>
                </div>
            ${showShipComment ? `
                ${fld("Ship's Comments (If any)", `<textarea class="wr-maint-textarea" data-wf="shipComments" rows="3"${roAttr}${dis}>${esc(wf('shipComments'))}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
                ${fld("Ship's Attachment", renderWrAttachmentBlock('ship', { canUpload: canEditShipAttach && !ro }), 'wr-maint-span-all wr-maint-grid-gap')}
            ` : ''}
            ${fld("Company's Comments", `<textarea class="wr-maint-textarea wr-ro" rows="3" readonly>${esc(rep?.company_comment || '')}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
            ${fld("Company's Attachment", renderWrAttachmentBlock('company', { canUpload: canEditCompanyAttach && !ro }), 'wr-maint-span-all wr-maint-grid-gap')}
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
            batchMode = false,
            batchJobIds = [],
            activeJobId = null,
            ro = false,
        } = opts;
        const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
        const fld = (label, inner, extraCls = '') => `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const inp = (key, val) => `<input data-wf="${key}" value="${esc(wf(key, val))}">`;
        const roWf = (key, val) => `<input class="wr-ro" data-wf="${key}" value="${esc(wf(key, val))}" readonly tabindex="-1">`;
        const jobInfoBlock = batchMode && batchJobIds.length
            ? renderWrBatchJobRowsHtml(batchJobIds, activeJobId || job.id)
            : '';

        return `<div class="wr-maint-form">
            ${renderWrApprovalHtml({
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal,
            })}

            <section class="wr-maint-card wr-maint-body">
                <div class="wr-maint-grid wr-maint-grid-3">
                    ${fld('File No.', inp('fileNo', ''))}
                    ${fld('Voy. No.', inp('voyNo', ''))}
                    ${fld('Place', inp('place', ''))}
                    ${fld('Work Date', `<input type="date" data-wf="workDate" value="${esc(wf('workDate', today))}"${ro ? ' disabled' : ''}>`)}
                    ${fld('Reported Date', `<input type="date" data-wf="reportDate" value="${esc(wf('reportDate', today))}"${ro ? ' disabled' : ''}>`)}
                    ${fld('Reported by', `<input class="wr-ro" value="${esc(reportedByName)}" readonly>`)}
                    ${fld('PMS Group No.', roWf('pmsGroupNo', hdr.pmsGroupNo || job.group || ''), 'wr-maint-span-all')}
                </div>
                ${jobInfoBlock}
                ${!batchMode ? `<div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Job Code', `<input class="wr-ro" value="${esc(job.job_code || '')}" readonly>`)}
                    ${fld('SORT-1', `<input class="wr-ro" value="${esc(job.item_sort1 || '')}" readonly>`)}
                    ${fld('SORT-2', `<input class="wr-ro" value="${esc(job.item_sort2 || '')}" readonly>`)}
                    ${fld('Job Detail', `<input class="wr-ro" value="${esc(job.job_detail || '')}" readonly>`)}
                </div>` : ''}
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Maker', roWf('maker', hdr.maker))}
                    ${fld('Model / Type', roWf('modelType', hdr.modelType))}
                    ${fld('Capacity', roWf('capacity', hdr.capacity))}
                    ${fld('Serial No.', roWf('serialNo', hdr.serialNo))}
                </div>
                <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap">
                    ${fld('Total Run Hrs', `<input type="number" data-wf="runHrs" value="${esc(wf('runHrs', '0'))}">`)}
                    ${fld('Last Maintenance Date', `<input type="date" data-wf="lastMaintDate" value="${esc(wf('lastMaintDate', wf('workDate', today)))}">`)}
                    ${fld('Running Hrs after Last Maint.', inp('rhAfterLastMaint', ''))}
                </div>
                ${fld('Outline of Maintenance', `<textarea class="wr-maint-textarea" data-wf="outline" rows="3"${ro ? ' readonly disabled' : ''}>${esc(wf('outline'))}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
                ${renderWrReportFooter({
                    rep,
                    ro,
                    canEditShipAttach,
                    canEditCompanyAttach,
                })}
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
            ro = false,
        } = opts;
        const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
        const fld = (label, inner, extraCls = '') => `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const inp = (key, val) => `<input data-wf="${key}" value="${esc(wf(key, val))}">`;
        const roWf = (key, val) => `<input class="wr-ro" data-wf="${key}" value="${esc(wf(key, val))}" readonly tabindex="-1">`;

        return `<div class="wr-maint-form">
            ${renderWrApprovalHtml({
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal,
            })}
            <section class="wr-maint-card wr-maint-body">
                <div class="wr-maint-grid wr-maint-grid-3">
                    ${fld('File No.', inp('fileNo', ''))}
                    ${fld('Voy. No.', inp('voyNo', ''))}
                    ${fld('Place', inp('place', ''))}
                    ${fld('Work Date', `<input type="date" data-wf="workDate" value="${esc(wf('workDate', today))}">`)}
                    ${fld('Reported Date', `<input type="date" data-wf="reportDate" value="${esc(wf('reportDate', today))}">`)}
                    ${fld('Reported by', `<input class="wr-ro" value="${esc(reportedByName)}" readonly>`)}
                    ${fld('PMS Group No.', roWf('pmsGroupNo', hdr.pmsGroupNo), 'wr-maint-span-all')}
                </div>
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Job Code', `<input class="wr-ro" value="${esc(job.job_code)}" readonly>`)}
                    ${fld('SORT-1', `<input class="wr-ro" value="${esc(job.item_sort1 || '')}" readonly>`)}
                    ${fld('SORT-2', `<input class="wr-ro" value="${esc(job.item_sort2 || '')}" readonly>`)}
                    ${fld('Job Detail', `<input class="wr-ro" value="${esc(job.job_detail || '')}" readonly>`)}
                </div>
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Maker', roWf('maker', hdr.maker))}
                    ${fld('Model / Type', roWf('modelType', hdr.modelType))}
                    ${fld('Capacity', roWf('capacity', hdr.capacity))}
                    ${fld('Serial No.', roWf('serialNo', hdr.serialNo))}
                </div>
                <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap">
                    ${fld('Total Run Hrs', `<input type="number" data-wf="runHrs" value="${esc(wf('runHrs', '0'))}">`)}
                    ${fld('Last Maintenance Date', `<input type="date" data-wf="lastMaintDate" value="${esc(wf('lastMaintDate', wf('workDate', today)))}">`)}
                    ${fld('Running Hrs after Last Maint.', inp('rhAfterLastMaint', ''))}
                </div>
                <div class="wr-maint-grid wr-maint-grid-2 wr-maint-grid-gap">
                    ${fld('Original Due Date', `<input class="wr-ro" value="${esc(job.next_date || '—')}" readonly>`)}
                    ${fld('Postpone Date', `<input type="date" data-wf="postponeDate" value="${esc(wf('postponeDate'))}"${ro ? ' disabled' : ''}>`, 'wr-postpone-date')}
                </div>
                ${renderWrReportFooter({
                    rep,
                    ro,
                    canEditShipAttach,
                    canEditCompanyAttach,
                })}
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
        } = opts;
        return `<section class="wr-maint-card wr-maint-approval">
            <div class="wr-maint-approval-item${canConfirmNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="wrConfirmedBy" ${isRepConfirmed ? 'checked' : ''} ${canConfirmNow ? '' : 'disabled'}> Confirmed by</label>
                <input class="wr-ro wr-maint-date" value="${esc(confirmedByVal)}" readonly>
            </div>
            <div class="wr-maint-approval-item${canApproveNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="wrApprovedBy" ${isRepApproved ? 'checked' : ''} ${canApproveNow ? '' : 'disabled'}> Approved by</label>
                <input class="wr-ro wr-maint-date" value="${esc(approvedByVal)}" readonly>
            </div>
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
        const reportedByName = rep ? reporterLabel(rep.reporter_name) : TVC_RBAC.getReportedByLabel(state.user);
        return TVC_SpareMenu.renderWrSparePage2Html(job, ro, buildWrPage2Meta(job, reportedByName, today));
    }

    function syncWorkReportPage2Ui(showPages, ro) {
        const onPage2 = showPages && state._wrPage === '2';
        if (onPage2) TVC_SpareMenu.initWrSparePage2(ro);
        else TVC_SpareMenu.teardownWrSparePage2();
    }

    /** 현재 입력값을 임시 보관 (탭 전환 시 유실 방지) */
    function captureWorkReportForm() {
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

    function renderWrAttachmentBlock(kind, { canUpload }) {
        const formKey = kind === 'company' ? 'companyAttachments' : 'shipAttachments';
        const label = kind === 'company' ? "Company's Attachment" : "Ship's Attachment";
        const inputId = kind === 'company' ? 'wrCompanyAttachInput' : 'wrShipAttachInput';
        const list = wrAttachmentList(formKey);
        const items = list.map(a => `
            <li class="wr-attach-item">
                <a class="wr-attach-link" href="${escAttr(a.dataUrl)}" download="${escAttr(a.name)}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>
                <span class="wr-attach-size">${Math.max(1, Math.round(a.size / 1024))}KB</span>
                ${canUpload ? `<button type="button" class="wr-attach-remove" title="Remove" onclick="TVC_App.removeWrAttachment('${kind}','${escAttr(a.id)}')">×</button>` : ''}
            </li>`).join('');
        const uploadBtn = canUpload
            ? `<button type="button" class="wr-attach-btn" onclick="document.getElementById('${inputId}').click()">📎 ${esc(label)}</button>
               <input type="file" id="${inputId}" class="hidden" multiple onchange="TVC_App.uploadWrAttachment('${kind}')">`
            : (list.length
                ? ''
                : `<button type="button" class="wr-attach-btn" disabled tabindex="-1">📎 ${esc(label)}</button>`);
        const listHtml = list.length
            ? `<ul class="wr-attach-list">${items}</ul>`
            : '';
        return `
            <div class="wr-attach-block">
                ${uploadBtn}
                ${listHtml}
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
                    alert(`${file.name}: 8MB 이하 파일만 첨부할 수 있습니다.`);
                    continue;
                }
                list.push(await readWrAttachmentFile(file));
            }
        } catch (e) {
            alert(e.message || '파일을 읽을 수 없습니다.');
        }
        input.value = '';
        renderWorkReportModal();
    }

    function removeWrAttachment(kind, id) {
        captureWorkReportForm();
        captureWorkReportUsedParts();
        const formKey = kind === 'company' ? 'companyAttachments' : 'shipAttachments';
        const list = wrAttachmentList(formKey);
        const i = list.findIndex(a => a.id === id);
        if (i >= 0) list.splice(i, 1);
        renderWorkReportModal();
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

        const batchJobTabs = `
            <div class="batch-wr-jobs">
                ${state._batchJobIds.map(id => {
                    const j = state.idx?.jobById.get(id);
                    return `<span class="batch-wr-job-tag">${esc(j?.job_code || id)}</span>`;
                }).join('')}
            </div>`;

        const pageTabs = showPages ? `
            <div class="wr-pagetabs">
                <button type="button" class="wr-pagetab${state._wrPage === '1' ? ' active' : ''}" onclick="TVC_App.setWorkReportPage('1')">Page 1</button>
                <button type="button" class="wr-pagetab${state._wrPage === '2' ? ' active' : ''}" onclick="TVC_App.setWorkReportPage('2')">Page 2</button>
            </div>` : '';
        const pageTabsBar = showPages ? `<div class="wr-pagetabs-bar">${pageTabs}</div>` : '';

        const pickerHtml = state._batchJobPickerOpen ? buildBatchJobPickerHtml() : '';

        const headHtml = showPages && state._wrPage === '2'
            ? renderWrPage2HeadHtml({ reportedByName })
            : '';

        let body = '';
        if (showPages && state._wrPage === '2') {
            body = renderWrPage2Body(ro);
        } else {
            body = renderWrRepairMaintenanceBody(job, {
                reportedByName, today,
                canEditShipAttach,
                batchMode: true,
                batchJobIds: state._batchJobIds,
                activeJobId: state._wrJobId,
            }) + (state._batchJobPickerOpen ? pickerHtml : '');
        }

        const actionsHtml = `
            <button class="btn btn-green" onclick="TVC_App.saveBatchReport()">💾 Save Batch Report</button>
            <button class="btn" onclick="TVC_App.closeBatchReport()">Cancel</button>`;

        host.innerHTML = `
            <div class="wr-titlebar">Batch Work Report (${state._batchJobIds.length} jobs)</div>
            ${batchJobTabs}
            ${pageTabsBar}
            <div class="wr-page tone-repair">
                ${headHtml}
                ${body}
            </div>
            <div class="modal-actions wr-actions">${actionsHtml}</div>`;
        syncWorkReportPage2Ui(showPages, ro);
    }

    function renderWorkReportModal() {
        const host = document.getElementById('workReportBody');
        if (!host) return;
        if (state._batchMode) return renderBatchWorkReportModal(host);
        const job = state.idx?.jobById.get(state._wrJobId);
        if (!job) return;
        if (!WR_TABS[state._wrTab]) state._wrTab = 'repair';
        const today = new Date().toISOString().slice(0, 10);
        const ro = !!state._wrReadonly;
        const tabBtns = Object.entries(WR_TABS).map(([k, label]) =>
            `<label class="wr-radio${state._wrTab === k ? ' active' : ''}">
                <input type="radio" name="wrTab" ${state._wrTab === k ? 'checked' : ''} onclick="TVC_App.setWorkReportTab('${k}')"> ${esc(label)}
            </label>`).join('');

        // 승인/확정 워크플로 — Work History에서 리포트를 열었을 때만 활성
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const isRepConfirmed = !!rep && TVC_RBAC.isConfirmedStatus(rep.status, rep.is_locked);
        const isRepApproved = !!rep && reportIsApproved(rep);
        const canConfirmNow = !!rep && TVC_RBAC.isReportedStatus(rep.status, rep.is_locked) && TVC_RBAC.canConfirmDepartment(state.user, job.department);
        const canApproveNow = !!rep && isRepConfirmed && !isRepApproved && TVC_RBAC.canApproveHqReport(state.user);
        const reportedByName = rep ? reporterLabel(rep.reporter_name) : TVC_RBAC.getReportedByLabel(state.user);
        const confirmedByVal = isRepConfirmed
            ? (TVC_RBAC.getDepartmentConfirmLabel(job.department) || rep?.confirmed_by || '')
            : '';
        const approvedByVal = isRepApproved ? 'Company' : '';
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
                canEditShipAttach, canEditCompanyAttach,
                ro,
            });
        } else if (state._wrTab === 'postpone') {
            body = renderWrPostponeBody(job, {
                rep, reportedByName, today,
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal,
                canEditShipAttach, canEditCompanyAttach,
                ro,
            });
        }

        const isHist = !!state._wrReportId;
        const histEntry = isHist ? getCurrentWrHistEntry() : null;
        const canModifyRow = histEntry && canModifyHistEntry(histEntry);
        const canDeleteRow = histEntry && canDeleteHistEntry(histEntry);
        const navBtns = isHist
            ? `<button class="btn" onclick="TVC_App.navReport(-1)">&laquo; Previous</button>
               <button class="btn" onclick="TVC_App.navReport(1)">Next &raquo;</button>`
            : '';
        const printBtn = isHist
            ? `<button class="btn" onclick="TVC_App.printWorkReport()">Print</button>`
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
            let centerBtns = '';
            if (canModifyRow) {
                centerBtns = ro
                    ? `<button class="btn" onclick="TVC_App.modifyWorkReport()">Modify</button>`
                    : `<button class="btn btn-green" onclick="TVC_App.saveWorkReport()">Save</button>
                <button class="btn" onclick="TVC_App.cancelWorkReportEdit()">Cancel</button>`;
            }
            actionsHtml = `<div class="wr-modal-actions-left">${navBtns}</div>
                <div class="wr-modal-actions-center">${centerBtns}</div>
                <div class="wr-modal-actions-right">${printBtn}${closeBtn}</div>`;
        } else if (isHist) {
            const closeBtn = `<button class="btn" onclick="TVC_App.requestCloseWorkReport()">Close</button>`;
            if (!canModifyRow) {
                actionsHtml = `${navBtns}${printBtn}${closeBtn}`;
            } else {
                const modifyBtn = ro
                    ? `<button class="btn" onclick="TVC_App.modifyWorkReport()">Modify</button>`
                    : '';
                const deleteBtn = canDeleteRow
                    ? `<button class="btn btn-red" onclick="TVC_App.deleteWorkReport()">Delete</button>`
                    : '';
                const saveBtn = !ro
                    ? `<button class="btn btn-green" onclick="TVC_App.saveWorkReport()">Save</button>`
                    : '';
                actionsHtml = `${navBtns}${modifyBtn}${deleteBtn}${saveBtn}${printBtn}${closeBtn}`;
            }
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
                    if (el.id === 'wrApprovedBy' || el.id === 'wrConfirmedBy') return;
                    el.disabled = true;
                });
        }
        syncWorkReportPage2Ui(showPages, ro);
    }

    function isNewUnsavedWorkReportSession() {
        return !state._batchMode && !state._wrReportId && !state._wrReadonly;
    }

    function showWrCancelConfirm() {
        document.getElementById('wrCancelConfirmModal')?.classList.remove('hidden');
    }

    function dismissWrCancelConfirm() {
        document.getElementById('wrCancelConfirmModal')?.classList.add('hidden');
    }

    function requestCloseWorkReport() {
        if (isNewUnsavedWorkReportSession()) {
            showWrCancelConfirm();
            return;
        }
        closeWorkReport();
    }

    function confirmCancelWorkReport(yes) {
        dismissWrCancelConfirm();
        if (!yes) return;
        resetAndCloseWorkReport();
    }

    /** Work Report 창 닫기 — Confirmed/Approved 체크 시 Confirm·Approve 처리 후 닫기 */
    async function closeWorkReport() {
        dismissWrCancelConfirm();
        if (state._batchMode) return closeBatchReport();
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
                    ? `${rep.job_code} Postpone 리포트가 Confirm되었습니다. (NEXT DATE 갱신)`
                    : `${rep.job_code} 리포트가 Confirm되었습니다. (재고 차감 · LAST DONE / NEXT DATE 갱신)`;
                return alert(msg);
            } catch (e) { return alert(e.message || e.code); }
        }
        if (user && rep && TVC_RBAC.isConfirmedStatus(rep.status) && apCb && !apCb.disabled && apCb.checked) {
            try {
                await TVC_Transaction.approveReport(user, rep.id, '');
                resetAndCloseWorkReport();
                await refreshAll();
                return alert(`${rep.job_code} 리포트가 본사 승인(APPROVED)되었습니다.`);
            } catch (e) { return alert(e.message || e.code); }
        }
        resetAndCloseWorkReport();
    }

    function resetAndCloseWorkReport() {
        dismissWrCancelConfirm();
        TVC_SpareMenu.teardownWrSparePage2();
        TVC_SpareMenu.cleanupConsumeWorkReportOverlay();
        state._wrReportId = null;
        state._wrBatchItemId = null;
        state._wrReadonly = false;
        state._wrPostSaveView = false;
        state._wrFromHistory = false;
        state._wrForm = {};
        state._wrUsedParts = [];
        state._wrPage = '1';
        state._wrSpareSearch = '';
        closeModal('workReportModal');
    }

    async function saveWorkReport() {
        if (!window.confirm('Save this Work Report?')) return;
        captureWorkReportForm();
        captureWorkReportUsedParts();
        const job = state.idx.jobById.get(state._wrJobId);
        if (!job) return;
        const user = TVC_Auth.requirePermission(TVC_RBAC.Action.CREATE_DAILY_REPORT);
        if (!user) return;
        const form = { ...state._wrForm };
        const tab = state._wrTab;
        const existingRep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;

        if (tab === 'postpone' && !form.postponeDate) {
            return alert('Postpone Date를 입력하세요.');
        }

        const workType = existingRep?.work_type === 'TROUBLE'
            ? 'TROUBLE'
            : (tab === 'postpone' ? 'POSTPONE' : 'MAINTENANCE');
        const status = 'REPORTED';
        if ((workType === 'MAINTENANCE' || workType === 'TROUBLE') && form.workDate
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

        const description = existingRep?.work_type === 'TROUBLE'
            ? (form.troubleOutline || existingRep.description || job.job_detail)
            : (form.outline || form.shipComments || job.job_detail);

        const payload = {
            workType, status, form,
            description,
            reportDate: form.reportDate,
            workDate: form.workDate,
            postponeDate: form.postponeDate || null,
            troubleDetail: existingRep?.work_type === 'TROUBLE' ? (form.troubleOutline || existingRep.trouble_detail || null) : null,
        };

        const usedParts = (state._wrUsedParts || [])
            .filter(p => Number(p.qty_used) > 0)
            .map(p => ({ spare_part_id: p.spare_part_id, qty_used: Number(p.qty_used) }));
        const wrPartsForConsumeLog = enrichUsedParts(usedParts);

        if (workType === 'MAINTENANCE' || workType === 'TROUBLE') {
            payload.usedParts = usedParts;
        }

        try {
            let report;
            if (state._wrReportId) {
                const updatePayload = { ...payload };
                if (state._wrBatchItemId) {
                    const rep = state.reports.find(r => r.id === state._wrReportId);
                    if (rep) {
                        TVC_WorkReport.fromLegacy(rep);
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
            } else {
                report = await TVC_Transaction.submitReport(user, job.id, payload);
                TVC_JobMeta.addHistory(job.job_code, {
                    action: `${workType}_${status}`, user: user.display_name,
                    notes: (description || '').slice(0, 100),
                });
            }

            if ((workType === 'MAINTENANCE' || workType === 'TROUBLE') && !state._batchMode) {
                try {
                    const consumeForm = {
                        reportDate: form.reportDate || payload.reportDate,
                        workDate: form.workDate || payload.workDate,
                        shipComments: form.shipComments || '',
                    };
                    const syncResult = await TVC_SpareMenu.syncConsumeLogFromWorkReport({
                        report,
                        job,
                        usedParts: wrPartsForConsumeLog,
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
                    alert(syncErr.message || 'Spare parts stock update failed.');
                }
            }

            const wasModify = !!state._wrReportId;
            const fromHistory = state._wrFromHistory;
            await refreshAll();
            const saved = state.reports.find(r => r.id === report.id) || report;
            if (fromHistory) reloadWorkReportViewFromDb(saved, job);
            else reloadWorkReportStateFromSaved(saved, job);
            renderWorkReportModal();
            alert(wasModify
                ? `${WR_TABS[tab]} 보고가 수정되었습니다.`
                : tab === 'postpone'
                    ? `${WR_TABS[tab]} 보고가 저장되었습니다. (NEXT DATE → ${form.postponeDate})`
                    : `${WR_TABS[tab]} 보고가 저장되었습니다. (${status})`);
        } catch (e) { alert(e.message || e.code); }
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

    function buildActionButtons(job) {
        const f = TVC_RBAC.getUiFeatures(state.user);
        const sameDept = !state.user.department || state.user.department === job.department;
        let h = '';
        const canAp = TVC_RBAC.canApproveDepartment(state.user, job.department);
        if (f.showDailyReportSubmit && sameDept) h += `<button class="btn btn-green" onclick="TVC_App.doSubmit('${job.id}')">📋 Report (REPORTED)</button>`;
        if (f.showMaintenanceExecute && sameDept && canAp) h += `<button class="btn btn-green" onclick="TVC_App.doExecute('${job.id}')">🛠️ Approve & Deduct</button>`;
        if (f.showMaintenanceExecute && sameDept && !canAp) h += `<button class="btn btn-green" disabled title="타 부서 — 승인 불가">🛠️ Approve & Deduct</button>`;
        h += `<button class="btn" onclick="TVC_App.saveDetailReport('${job.id}')">💾 Save Detail</button>`;
        h += `<button class="btn" onclick="TVC_App.openProcedureHistory('${job.id}')">📜 Procedure / History</button>`;
        if (!sameDept) h += `<span class="dept-warn">타 부서 항목 — 조작 불가</span>`;
        return h;
    }

    async function uploadAttachment(jobCode) {
        const input = document.getElementById('detailFileInput');
        if (!input?.files?.length) return;
        for (const f of input.files) await TVC_JobMeta.addAttachment(jobCode, f);
        const job = [...state.idx.jobById.values()].find(j => j.job_code === jobCode);
        if (job) openJobDetail(job.id);
    }

    function saveDetailReport(jobId) {
        const job = state.idx.jobById.get(jobId);
        const text = document.getElementById('detailReportInput')?.value || '';
        const all = JSON.parse(localStorage.getItem('tvc_job_meta') || '{}');
        if (!all[job.job_code]) all[job.job_code] = TVC_JobMeta.get(job.job_code);
        all[job.job_code].last_report = text;
        localStorage.setItem('tvc_job_meta', JSON.stringify(all));
        TVC_JobMeta.addHistory(job.job_code, { action: 'DETAIL_SAVED', user: state.user.display_name, notes: text.slice(0, 100) });
        alert('Saved');
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
        const user = TVC_Auth.requirePermission(TVC_RBAC.Action.CREATE_DAILY_REPORT);
        if (!user) return;
        const job = state.idx.jobById.get(jobId);
        if (user.department && user.department !== job.department) return alert('타 부서 항목은 보고할 수 없습니다.');
        const usedParts = await pickUsedParts();
        if (usedParts === null) return;
        try {
            await TVC_Transaction.submitReport(user, jobId, { description: job.job_detail, usedParts });
            TVC_JobMeta.addHistory(job.job_code, { action: 'REPORTED', user: user.display_name, notes: '' });
            closeModal('jobDetailModal');
            await refreshAll();
            alert('REPORTED submitted');
        } catch (e) { alert(e.message || e.code); }
    }

    async function doExecute(jobId) {
        const user = TVC_Auth.requirePermission(TVC_RBAC.Action.EXECUTE_MAINTENANCE);
        if (!user) return;
        const job = state.idx.jobById.get(jobId);
        if (!TVC_RBAC.canApproveDepartment(user, job.department)) return alert('타 부서 항목은 승인할 수 없습니다.');
        const usedParts = await pickUsedParts();
        if (usedParts === null) return;
        try {
            await TVC_Transaction.executeMaintenance(user, jobId, usedParts, job.job_detail);
            TVC_JobMeta.addHistory(job.job_code, { action: 'CONFIRMED', user: user.display_name, notes: 'Stock deducted' });
            closeModal('jobDetailModal');
            await refreshAll();
            alert('Confirmed & stock deducted');
        } catch (e) { alert(e.message || e.code); }
    }

    async function pickUsedParts() {
        if (!state.spares.length) return [];
        const spare = state.spares[0];
        const qty = parseInt(prompt(`Part: ${spare.name}\nQty (0=none):`, '0') || '0', 10);
        if (isNaN(qty)) return null;
        return qty <= 0 ? [] : [{ spare_part_id: spare.id, qty_used: qty }];
    }

    async function doConfirm(reportId) {
        const user = TVC_Auth.requirePermission(TVC_RBAC.Action.APPROVE_DAILY_REPORT);
        if (!user) return;
        const rep = state.reports.find(r => r.id === reportId);
        const dept = rep ? reportDept(rep) : null;
        if (!TVC_RBAC.canConfirmDepartment(user, dept)) {
            alert(`타 부서(${dept || '?'}) 리포트는 Confirm할 수 없습니다. 범위: ${TVC_RBAC.getDeptLabel(user.department)}`);
            return;
        }
        try { await TVC_Transaction.confirmReport(user, reportId); await refreshAll(); alert('Confirmed'); }
        catch (e) { alert(e.message || e.code); }
    }

    async function doApprove(reportId) {
        const user = TVC_Auth.requirePermission(TVC_RBAC.Action.CONFIRM_REPORT);
        if (!user) return;
        const comment = document.getElementById('comment-' + reportId)?.value || '';
        try { await TVC_Transaction.approveReport(user, reportId, comment); await refreshAll(); alert('APPROVED'); }
        catch (e) { alert(e.message || e.code); }
    }

    async function refreshAll() {
        await loadData();
        rerenderCurrentTab();
        TVC_RunHours.syncRhToolbarUi();
        syncPlanUpdateUi();
    }

    /** HQ Import 후 — 선택 선박·Run-hour scope·헤더·Outstanding Tasks까지 Import 결과 반영 */
    async function refreshAfterImport(payload) {
        const importVesselId = payload?.export_meta?.vessel_id;
        const user = state.user;
        if (user && TVC_RBAC.isHqAccount(user) && importVesselId) {
            state.selectedVesselId = importVesselId;
            TVC_Fleet.select(importVesselId);
            TVC_PMS.setSpace('HQ', importVesselId);
            await populateShipHeader(user);
        }
        await loadData();
        renderFleetList();
        rerenderCurrentTab();
        if (state.currentTab === 'menu') renderSyncHistory();
        if (state.currentTab === 'defect') TVC_DefectReport.renderTab();
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

    function printAttachmentLabel(attachments) {
        const list = Array.isArray(attachments) ? attachments : [];
        return list.length ? `Yes (${list.length})` : '—';
    }

    function printDefectRowCells(dc, opts = {}) {
        const cols = defectHistoryColumns(dc);
        const dt = formatCmaxsHistDate(dc.work_date || dc.report_date || dc.submitted_at || dc.created_at);
        const st = defectHistoryStatusLabel(dc);
        const flags = defectHistoryFormFlags(dc);
        const detailCell = opts.omitDetail
            ? ''
            : `<td>${esc(cols.jobDetail || '')}</td>`;
        const fileNoCell = opts.includeFileNo
            ? `<td>${esc(String(dc.file_no || '').trim() || '—')}</td>`
            : '';
        return `${fileNoCell}<td>${esc(cols.jobCode || '—')}</td>
            <td>${esc(cols.sort1 || '')}</td>
            <td>${esc(cols.sort2 || '')}</td>
            ${detailCell}
            <td>${esc(dt || '—')}</td>
            <td>${esc(st)}</td>
            ${printFlagCells(flags)}
            <td>${esc(printAttachmentLabel(dc.ship_attachments))}</td>
            <td>${esc(printAttachmentLabel(dc.company_attachments))}</td>`;
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
            <th>Type</th><th>⚠</th><th>JOB CODE</th><th>SORT-1</th><th>SORT-2</th>
            <th>Reported Date</th><th>Status</th>
            <th>RR</th><th>SS</th><th>DC</th><th>SC</th><th>CC</th>
            <th>Ship's AT</th><th>Company's AT</th>
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
                return `<tr><td>D</td><td>${esc(printHistCriticalMark(entry))}</td>${printDefectRowCells(entry.defect, { omitDetail: true })}</tr>`;
            }
            const { report: r, item } = entry;
            const job = state.idx?.jobById.get(item.maintenance_job_id)
                || state.jobs.find(j => j.job_code === item.job_code);
            const f = item.form || wrReportForm(r);
            const dt = formatCmaxsHistDate(r.work_date || r.report_date || r.created_at);
            const st = reportWorkflowStatusLabel(r, item);
            const flags = workHistoryFormFlags(f, r);
            const type = histTypeMarker(entry).letter;
            const batch = r.is_batch ? 'B ' : '';
            return `<tr>
                <td>${esc(type)}</td>
                <td>${esc(printHistCriticalMark(entry))}</td>
                <td>${esc(batch + (item.job_code || '—'))}</td>
                <td>${esc(job?.item_sort1 || '')}</td>
                <td>${esc(job?.item_sort2 || '')}</td>
                <td>${esc(dt || '—')}</td>
                <td>${esc(st)}</td>
                ${printFlagCells(flags)}
                <td>${esc(printAttachmentLabel(f.shipAttachments))}</td>
                <td>${esc(printAttachmentLabel(f.companyAttachments))}</td>
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
        const w = window.open('', '_blank');
        if (!w) {
            alert('Pop-up blocked. Allow pop-ups to print or preview.');
            return;
        }
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
        } else if (tab === 'defect') {
            title = 'Defect Report';
            body = buildDefectReportPrintBody();
        } else if (tab === 'history') {
            title = 'Work History';
            body = buildWorkHistoryPrintBody();
        } else if (tab === 'spare') {
            title = 'SPARE Parts List';
            body = typeof TVC_SpareMenu !== 'undefined' && TVC_SpareMenu.buildPrintBody
                ? TVC_SpareMenu.buildPrintBody()
                : '';
            if (!body) {
                alert('SPARE list is not ready to print.');
                return;
            }
        } else {
            alert('Print is not available on this tab.');
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
                setLoginBusy(true, '시스템 준비 중…');
                await bootReadyPromise;
                setLoginBusy(false);
            }
            setLoginBusy(true, '로그인 중…');
            const loginMode = document.getElementById('loginDept')?.value || '';
            const r = await TVC_Auth.login(
                document.getElementById('loginUser').value,
                document.getElementById('loginPass').value,
                loginMode
            );
            if (errEl) errEl.textContent = r.ok ? '' : (r.error || '로그인 실패');
            if (r.ok) {
                const refreshed = await TVC_Auth.refreshSessionFromDb();
                await onLogin(refreshed || r.user);
            }
        } catch (e) {
            console.error('[TVC] login failed', e);
            if (errEl) errEl.textContent = e.message || '로그인 중 오류가 발생했습니다.';
        } finally {
            if (!state.user) setLoginBusy(false);
        }
    }

    function handleLogout() {
        TVC_Auth.logout();
        state.user = null;
        showLogin();
    }

    async function handleStationExport() {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        try {
            await TVC_StationSync.exportStationPackage(user);
            await refreshAll();
            if (state.currentTab === 'menu') renderSyncHistory();
            alert(`${TVC_Space.stationLabel(user.station)} 데이터가 Captain Hub용 패키지로보내졌습니다.`);
        } catch (e) { alert(e.message); }
    }

    async function handleCompanyExport() {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        try {
            await TVC_StationSync.exportCompanyPackage(user);
            await refreshAll();
            if (state.currentTab === 'menu') renderSyncHistory();
            alert('회사 보고용 데이터 패키지가 생성되었습니다.');
        } catch (e) { alert(e.message); }
    }

    async function handleHubImport(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        try {
            await TVC_StationSync.importStationPackage(user, file);
            await refreshAll();
            if (state.currentTab === 'menu') { renderSyncHistory(); renderCaptainViewDashboard(); }
            alert('Station 데이터 병합(Merge)이 완료되었습니다.');
        } catch (e) { alert(e.message); }
    }

    async function handleDefectImport(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        try {
            const payload = await TVC_DefectSync.importPackage(user, file);
            await refreshAfterImport(payload);
            if (state.currentTab === 'menu') TVC_DefectReport.renderInbox();
            alert('Defect package imported successfully.');
        } catch (e) { alert(e.message); }
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
            if (state.currentTab === 'defect') TVC_DefectReport.renderTab();
            alert(`Urgent Defect package created:\n${filename}\n\nAttach ZIP or HTML to email to Company. HQ imports the ZIP for Phase 2.`);
        } catch (e) { alert(e.message); }
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
            if (state.currentTab === 'defect') TVC_DefectReport.renderTab();
            alert(`Completion package created:\n${filename}`);
        } catch (e) { alert(e.message); }
    }

    async function handleExport() {
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        if (!TVC_RBAC.can(user, user.account_type === 'HQ' ? TVC_RBAC.Action.EXPORT_HQ_FEEDBACK : TVC_RBAC.Action.EXPORT_SHIP_SYNC)) {
            alert('Data Export는 Captain / Chief engineer만 수행할 수 있습니다.');
            return;
        }
        pickDepartmentThen('Export할 부서를 선택하세요 (DECK / ENGINE)', async (dept) => {
            try {
                await TVC_Sync.exportZip(user, user.account_type === 'HQ' ? 'HQ_TO_SHIP' : 'SHIP_TO_HQ', dept);
                await refreshAll();
                if (state.currentTab === 'menu') renderSyncHistory();
                const vesselId = (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || user.vessel_id || 'VESSEL_ID';
                alert(`${TVC_RBAC.getDeptLabel(dept)} 데이터 ZIP이 내보내졌습니다. (${vesselId}_${dept}_PMS_EXPORT_…zip)`);
            } catch (e) { alert(e.message); }
        });
    }

    async function handleImport(file) {
        const user = TVC_Auth.getCurrentUser();
        if (!user || !file) return;
        const importAction = user.account_type === 'HQ' ? TVC_RBAC.Action.IMPORT_HQ_SYNC : TVC_RBAC.Action.IMPORT_SHIP_SYNC;
        if (!TVC_RBAC.can(user, importAction)) {
            alert('Data Import는 Captain / Chief engineer만 수행할 수 있습니다.');
            return;
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
            alert(`${TVC_RBAC.getDeptLabel(dept)} 데이터 Import 완료${vesselNote}${unlockNote}`);
        } catch (e) { alert(e.message); }
    }

    async function loadSeedFile(file) {
        if (!file) return;
        await TVC_Seed.loadFromFile(file);
        document.getElementById('seedBanner')?.classList.add('hidden');
        await refreshAll();
        alert(`Loaded ${state.jobs.length} jobs`);
    }

    // ── Utils ────────────────────────────────────────────────────────
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
    }

    /** Work History — Work Report ↔ Defect 전환 시 backdrop 깜빡임 방지 */
    function swapHistoryModals(showId, hideId) {
        const showEl = document.getElementById(showId);
        const hideEl = hideId ? document.getElementById(hideId) : null;
        if (!showEl) return;
        showEl.classList.remove('modal-hist-swapping');
        if (hideEl && !hideEl.classList.contains('hidden')) {
            hideEl.classList.add('modal-hist-swapping');
        }
        showEl.classList.remove('hidden');
        showEl.style.zIndex = '10001';
        showEl.scrollTop = 0;
        const showBox = showEl.querySelector('.modal-box');
        if (showBox) showBox.scrollTop = 0;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (hideEl) {
                    hideEl.classList.remove('modal-hist-swapping');
                    hideEl.classList.add('hidden');
                    hideEl.style.zIndex = '';
                    window.TVC_ModalDrag?.resetModal?.(hideEl);
                }
            });
        });
    }
    function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

    /** Reporter 표시 — full titles; legacy C/E etc. mapped via RBAC helper */
    function reporterLabel(name) {
        return TVC_RBAC.normalizeReportedByLabel(name);
    }
    function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }

    return {
        boot, switchTab, navigate,
        setDepartment, setCaptainView, setHistView, setHistTab, menuAction, resolveDeptPick,
        setFleetView, setFleetSearch, selectVessel,
        setSearch, setTreeSearch, clearSearchField, updateSearchClearBtn, bindSearchClearInput, bindTabSearchClearInputs, sortJobs, setActualFilter, onActualPeriodChange, clearActualPeriod, onReportPeriodChange, clearReportPeriod, syncReportPeriodInputs, hasReportPeriodFilter, defectCaseReportDate, matchReportPeriodDate, selectGroup, renderGroupTree,
        getListFilterState, setListFilters, clearListFilters, syncListFilterBtns, listFilterCtx,
        getAppDepartment, getAppUserDepartment, getSelectedGroupKey, getAppIdx, getAppJobs,
        renderSectionCard,
        openJobDetail, openWorkProcedure, openPlanWorkProcedure, onPlanRowClick, setWorkProcedureTab,
        enterWorkProcedureEdit, cancelWorkProcedureEdit, saveWorkProcedure,
        openProcedureHistory, openProcedureHistoryByCode,
        openWorkReport, openWorkReportInput, setWorkReportTab, setWorkReportPage, saveWorkReport,
        uploadWrAttachment, removeWrAttachment,
        toggleWrGroupPick, toggleWrJobPick, pickWrGroup, pickWrJob, wrGroupPickSearch, wrJobPickSearch,
        toggleBatchJob, toggleBatchSelectAll, openBatchReport, saveBatchReport,
        togglePlanSelectedOnly, toggleActSelectedOnly, renderPlanGroupHeader, refreshActualPlan,
        setBatchActiveJob, openBatchJobPicker, closeBatchJobPicker, closeBatchReport,
        openWorkReportFromHistory, openDefectFromHistory, openWorkHistoryEntry, navWorkHistoryEntry,
        modifyWorkReport, cancelWorkReportEdit, selectHistRow,
        buildDefectHistRowHtml, matchDefectHistSearch, initHistCellTips,
        formatHistGroupEquipmentName, isPlaceholderJobCode, defectEffectiveJobCode,
        histDetailWorkReport, histModifyReport, histReportApproval, histDeleteReport,
        toggleHistCheck, toggleHistSelectAll,
        navReport, deleteWorkReport, printWorkReport, closeWorkReport, requestCloseWorkReport,
        confirmCancelWorkReport, dismissWrCancelConfirm,
        selectJobRow,
        selectSpareRow, focusSpareRow, toggleSpareRow, syncSpareItemToolbar, spareActionIds, canEditSpareItems, openSpareAppend, openSpareModify, deleteSpareItem,
        saveRunHrs, updateRunHrs, revertRunHrs, runHrsPreview, runHrsTotalEdit,         updateOriginalPlanFromRunHours,
        openOrigJobModify, openOrigJobAppend, saveOrigJobEditor, saveOrigJobInlineEdit, cancelOrigJobInlineEdit, deleteOrigJob,
        openOrigGroupAdd, openOrigGroupRename, deleteOrigGroup, saveGroupEditor,
        confirmPlanUpdate, closePlanUpdateModal, printTabList, printCurrentTab,
        doSubmit, doExecute, doApprove, doConfirm,
        handleLogin, handleLogout, handleExport, handleImport, handleHubImport, handleDefectImport,
        urgentExportDefect, exportDefectCompletion, loadSeedFile,
        openMenuXferMenu, closeMenuXferMenu, menuXferPickMode, menuXferBack, menuXferTriggerImport,
        menuXferPickExportType,
        menuXferConfirmDefectExport, menuXferConfirmMonthlyExport,
        menuXferExportDefect, menuXferExportMonthly, onMenuXferImportFile,
        openMenuHistoryModal, closeMenuHistoryModal,
        uploadAttachment, saveDetailReport, closeModal, showModal, swapHistoryModals, dismissSpicsAlerts, openSpicsRequisition,
    };
})();

document.addEventListener('DOMContentLoaded', () => TVC_App.boot());
window.TVC_App = TVC_App;
