/* THE VESSEL CODE — Main Application (v3.0 · CMAXS Tab Navigation) */
const TVC_App = (function () {
    const ROW_H = 36;
    const DEPT_TREE_ORDER = ['ENGINE', 'DECK'];
    const TABS = ['menu', 'actual', 'defect', 'history', 'runhrs', 'spare', 'notice'];
    const CRITICAL_GROUP_KEY = '__CRITICAL_EQUIPMENT__';
    const NEW_ORIG_JOB_EDIT_ID = '__new_orig_job__';
    let _wrSpareSearchT = null;

    function repSt(r) { return TVC_RBAC.normalizeReportStatus(r?.status, !!r?.is_locked); }
    function itemSt(item) { return TVC_RBAC.normalizeReportStatus(item?.status); }

    let state = {
        user: null,
        components: [], jobs: [], groups: [], spares: [], reports: [], defectCases: [],
        idx: null,
        selectedGroupKey: null,
        treeSearch: '',
        actualFilter: 'total',        // total | overdue | due30 | postponed
        actualPeriodFrom: '',         // YYYY-MM-DD Due date range (Actual Plan)
        actualPeriodTo: '',
        jobSort: { field: 'job_code', asc: true },
        search: '',
        selectedJobId: null,
        _wpJobId: null,
        _wpTab: 'procedure',
        _wrJobId: null,
        _wrTab: 'repair',
        _wrPage: '1',
        _wrUsedParts: [],
        _wrSpareSearch: '',
        _wrForm: {},
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
        batchSelectedJobs: {},   // { jobId: true } — Original/Actual Plan 다중 선택
        actualSelectedOnly: false, // Actual Plan — 선택 항목만 목록 표시
        _batchDraft: null,       // Batch Report 편집 중 임시 데이터
        _batchMode: false,
        _batchJobIds: [],
        _batchSpareSearch: {},
        _batchJobPickerOpen: false,
        _histSelReportId: null,   // Work History 선택 행 (reportId|jobId)
        _histChecked: {},         // Work History 승인용 체크박스 { rowKey: true }
    };

    // ── Boot ─────────────────────────────────────────────────────────
    async function boot() {
        await TVC_DB.open();
        try {
            const sync = await TVC_DB.SparePart.syncOnBoot();
            if (sync.migrated) console.info('[SPICS] syncOnBoot migrated', sync.migrated, '/', sync.total);
        } catch (e) { console.warn('[SPICS] syncOnBoot', e); }
        await TVC_Auth.initUsers();
        try { await TVC_DataPurge.run(); } catch (e) { console.warn('[TVC_DataPurge]', e); }
        try {
            const reqPurge = await TVC_DataPurge.purgeAllRequisitionsOnce();
            if (reqPurge?.requisitions) {
                state.spareModule = state.spareModule || {};
                state.spareModule.selectedReqId = null;
                state.spareModule.showReqPanel = false;
            }
        } catch (e) { console.warn('[TVC_DataPurge] requisitions', e); }
        try { await TVC_Fleet.ensureFleet(); } catch (e) { console.warn('[TVC_Fleet]', e); }
        const sessionUser = await TVC_Auth.refreshSessionFromDb();
        TVC_RunHours.init({ getState: () => state, refresh: refreshAll });
        TVC_SpareMenu.init({ getState: () => state, refresh: refreshAll });
        TVC_DefectReport.init({ getState: () => state, refresh: refreshAll });
        window.addEventListener('tvc:spics-requisition-suggest', (e) => {
            state.spicsAlerts = e.detail?.alerts || [];
            renderSpicsAlertBanner();
            TVC_SpareMenu.suggestRequisition(e.detail?.alerts || []);
            if (state.currentTab === 'actual') renderActualPlan();
        });
        window.addEventListener('tvc:spics-low-stock', (e) => {
            state.spicsAlerts = e.detail?.alerts || [];
            renderSpicsAlertBanner();
            if (state.currentTab === 'actual') renderActualPlan();
        });
        const seed = await TVC_Seed.ensureSeed();
        if (seed.needFile) document.getElementById('seedBanner')?.classList.remove('hidden');
        // Inventory 관계 데이터(BOM/공통코드/기준재고) 기본값 보강 — idempotent
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

        ['loginUser', 'loginPass', 'loginDept'].forEach(id => {
            document.getElementById(id)?.addEventListener('keydown', e => {
                if (e.key === 'Enter') handleLogin();
            });
        });

        const user = sessionUser || TVC_Auth.getCurrentUser();
        if (user) await onLogin(user);
        else showLogin();
    }

    /** 부서별 데이터 독립성(영구 분리): 선박 계정은 로드 단계에서부터 자기 부서 데이터만 취득한다. */
    // PMS Group 부서 재분류: DECK로 들어온 특정 그룹을 ENGINE으로 이동한다.
    const FORCE_ENGINE_GROUP_NOS = new Set([28, 29, 30, 33, 35]);

    function pmsGroupNoFromLabel(label) {
        const mm = String(label || '').trim().match(/^(\d+)\s*\./);
        return mm ? parseInt(mm[1], 10) : null;
    }

    async function normalizeGroupDepartments(jobs, components, groups) {
        const changedJobs = [];
        (jobs || []).forEach(j => {
            const n = pmsGroupNoFromLabel(j.group);
            if (n != null && FORCE_ENGINE_GROUP_NOS.has(n) && j.department !== 'ENGINE') {
                j.department = 'ENGINE';
                changedJobs.push(j);
            }
        });
        const changedComps = [];
        (components || []).forEach(c => {
            const grpLabel = Array.isArray(c.path) ? c.path[1] : null;
            const n = pmsGroupNoFromLabel(grpLabel);
            if (n == null || !FORCE_ENGINE_GROUP_NOS.has(n)) return;
            let changed = false;
            if (Array.isArray(c.path) && c.path[0] && c.path[0] !== 'ENGINE') {
                c.path = ['ENGINE', ...c.path.slice(1)];
                changed = true;
            }
            if (c.department && c.department !== 'ENGINE') { c.department = 'ENGINE'; changed = true; }
            if (changed) changedComps.push(c);
        });
        const changedGroups = [];
        (groups || []).forEach(g => {
            const n = pmsGroupNoFromLabel(g.label);
            if (n != null && FORCE_ENGINE_GROUP_NOS.has(n) && g.department !== 'ENGINE') {
                g.department = 'ENGINE';
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

    async function applyActivePostponeSchedules() {
        const jobById = new Map((state.jobs || []).map(j => [j.id, j]));
        const dirty = [];
        (state.reports || []).forEach(r => {
            TVC_WorkReport.fromLegacy(r);
            if (r.work_type !== 'POSTPONE') return;
            if (!TVC_RBAC.isReportedStatus(r.status) && !TVC_RBAC.isConfirmedStatus(r.status)) return;
            const postponeDate = String(r.postpone_date || r.job_items?.[0]?.form?.postponeDate || '').slice(0, 10);
            if (!postponeDate) return;
            (r.job_items || []).forEach(item => {
                const job = jobById.get(item.maintenance_job_id);
                if (!job) return;
                const overdue = new Date(postponeDate) < new Date(new Date().toDateString());
                if (job.next_date === postponeDate && job.schedule_basis === 'POSTPONE' && !!job.is_overdue === overdue) return;
                job.next_date = postponeDate;
                job.is_overdue = overdue;
                job.schedule_basis = 'POSTPONE';
                job.plan_status = 'PLANNED';
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
                    || d.status === TVC_DefectCase.Status.AWAITING_COMPLETION) &&
                (!state.selectedVesselId || d.vessel_id === state.selectedVesselId)
            );
        }
        state.reports.forEach(r => TVC_WorkReport.fromLegacy(r));
        await applyActivePostponeSchedules();
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
        notice: renderNotice,
    };

    /** 상단 탭 전환 — 부서 필터 상태는 그대로 유지된다. */
    function switchTab(tab) {
        if (!TABS.includes(tab)) tab = 'menu';
        if (tab !== 'actual') state.actualSelectedOnly = false;
        state.currentTab = tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        document.getElementById('tab-' + tab)?.classList.remove('hidden');
        if (state.user) { applyRoleUi(state.user); renderDeptToggles(state.user); }
        (TAB_RENDERERS[tab] || renderMainMenu)();
        window.scrollTo(0, 0);
        if (typeof TVC_PWA !== 'undefined') TVC_PWA.closeMobileNav();
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

    /** Actual Plan — next_date(Due)가 설정 기간 안에 있는지 */
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
        setText('histDeptLabel', TVC_RBAC.getDeptLabel(state.department));
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
        if (!host || !state.user || !TVC_Space.isCaptainHub(state.user)) return;

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

    function matchHistSearch(entry) {
        const q = state.search;
        if (!q) return true;
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

    /** C. CRITICAL EQUIPMENT 분류 (Original / Actual Plan Group Tree) */
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
        return true;
    }

    function actualDashboardCounts() {
        const jobs = deptJobs();
        const keys = getActualFilterKeys();
        let overdue = 0;
        let due30 = 0;
        let postponed = 0;
        jobs.forEach(j => {
            if (j.is_overdue && !isActualJobCompleted(j)) overdue++;
            const d = daysUntil(j.next_date);
            if (!j.is_overdue && d >= 0 && d <= 30) due30++;
            if (keys.postponed.ids.has(j.id) || keys.postponed.codes.has(j.job_code)) postponed++;
        });
        return { total: jobs.length, overdue, due30, postponed };
    }

    function jobActualStatusPill(j) {
        const keys = getActualFilterKeys();
        if (keys.postponed.ids.has(j.id) || keys.postponed.codes.has(j.job_code)) {
            return '<span class="pill postponed">POSTPONED</span>';
        }
        if (j.is_overdue && !isActualJobCompleted(j)) {
            return '<span class="pill overdue">OVERDUE</span>';
        }
        const d = daysUntil(j.next_date);
        if (d >= 0 && d <= 30) return '<span class="pill warn">DUE</span>';
        return '<span class="pill ok">OK</span>';
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

    // ── Job table (Actual Plan) ──────────────────────────────────────
    function planCellHtml(text, cls) {
        const t = String(text ?? '').trim();
        const display = t || '—';
        if (!t) return `<span class="${cls}"><span class="vl-cell-tip-text">${esc(display)}</span></span>`;
        return `<span class="${cls} vl-cell-tip" data-tip="${escAttr(t)}"><span class="vl-cell-tip-text">${esc(display)}</span></span>`;
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

    function renderJobRowHtml(j) {
        const st = jobActualStatusPill(j);
        const selected = state.selectedJobId === j.id ? ' row-selected' : '';
        const batchOn = !!state.batchSelectedJobs[j.id];
        return `<div class="vl-cells sheet-actual${selected}${j.is_overdue ? ' row-overdue' : ''}"
            onclick="TVC_App.selectJobRow('${j.id}')"
            ondblclick="TVC_App.openWorkProcedure('${j.id}')">
            <span class="c-chk" onclick="event.stopPropagation()">
                <input type="checkbox" class="act-batch-chk" ${batchOn ? 'checked' : ''} aria-label="Select for batch"
                    onchange="TVC_App.toggleBatchJob('${escAttr(j.id)}', this.checked)">
            </span>
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

    /** 행 단일 클릭 — 선택(연한 파란색)만, 모달 없음 */
    function selectJobRow(jobId) {
        if (isOrigJobInlineEditing()) return;
        state.selectedJobId = jobId;
        if (state.vlActual) state.vlActual.refresh();
        renderSidePanel();
        renderPlanGroupHeader();
        if (state.currentTab === 'actual') syncPlanItemUi();
    }

    function mountJobSheet(headId, countId, scrollId, ids, vlKey) {
        if (headId === 'actHead') renderPlanGroupHeader(headId);
        const container = document.getElementById(scrollId);
        if (!container) return;
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
        if (scrollId === 'actScroll') initPlanCellTips(scrollId);
        if (head) container.addEventListener('scroll', () => { head.scrollLeft = container.scrollLeft; });
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
        return { total: jobs.length, overdue, due30, dueMonth, pending: pending.length, approved, defectPending };
    }

    function menuModel() {
        const c = menuCounts();
        const isHq = state.user && TVC_RBAC.isHqAccount(state.user);

        if (isHq) {
            return [
                {
                    key: 'monthly', tone: 'blue', icon: '🗓️', title: 'At first day of every month',
                    items: [
                        { label: 'Data Import', tag: 'C', action: "TVC_App.menuAction('import')", feature: 'showImportHq' },
                        { label: 'Approve Original Plan', tag: 'B', action: "TVC_App.menuAction('approveOriginalPlan')" },
                        { label: "Input Company's Comment", tag: 'C', action: "TVC_App.menuAction('companyComment')" },
                        { label: 'Approve Work Report', tag: 'B', action: "TVC_App.menuAction('hqConfirm')", badge: c.approved, badgeTone: 'green', feature: 'showHqConfirmPanel' },
                        { label: 'Defect Report Inbox', tag: 'B', action: "TVC_App.menuAction('defectInbox')", badge: c.defectPending, badgeTone: 'amber', feature: 'showDefectInbox' },
                        { label: 'Import Urgent Defect', tag: 'C', action: "TVC_App.menuAction('defectImport')", feature: 'showDefectImportUrgent' },
                        { label: 'Data Export', tag: 'C', action: "TVC_App.menuAction('export')", feature: 'showExportHq' },
                    ],
                },
                {
                    key: 'necessary', tone: 'amber', icon: '🧰', title: 'When it is necessary',
                    items: [
                        { label: 'Password Change', tag: 'A', action: "TVC_App.menuAction('password')" },
                        { label: 'Control Change', tag: 'B', action: "TVC_App.menuAction('control')" },
                        { label: 'Database Backup & Restore', tag: 'C', action: "TVC_App.menuAction('backup')" },
                    ],
                },
            ];
        }

        return [
            {
                key: 'everyday', tone: 'red', icon: '📅', title: 'At everyday',
                flow: 'linear',
                items: [
                    { label: 'Check Actual Plan', tag: 'D', action: "TVC_App.menuAction('checkPlan')", badge: c.overdue, badgeTone: 'red' },
                    { kind: 'note', label: 'Execute Repair & Maintenance / Trouble Work' },
                    { label: 'Input Work Report', tag: 'C', action: "TVC_App.menuAction('inputReport')", feature: 'showDailyReportSubmit' },
                    { label: 'Report Defect (Trouble)', tag: 'C', action: "TVC_App.menuAction('defectReport')", feature: 'showDefectReport' },
                    { label: 'Confirm Work Report', tag: 'B', action: "TVC_App.menuAction('approveReport')", badge: c.pending, badgeTone: 'amber', feature: 'showApprovalQueue' },
                ],
            },
            {
                key: 'hub', tone: 'purple', icon: '⚓', title: 'Captain Hub (Station sync)',
                items: [
                    { label: 'Import Station Data', tag: 'C', action: "TVC_App.menuAction('hubImport')", feature: 'showHubImport' },
                    { label: 'Export Company Report Package', tag: 'B', action: "TVC_App.menuAction('companyExport')", feature: 'showCompanyExport' },
                    { label: 'Import HQ Defect Reply', tag: 'C', action: "TVC_App.menuAction('defectImport')", feature: 'showDefectImportUrgent' },
                ],
            },
            {
                key: 'monthly', tone: 'blue', icon: '🗓️', title: 'At first day of every month',
                flow: 'monthly',
                items: [
                    { label: 'Update Run Hour of Equipment', tag: 'C', action: "TVC_App.menuAction('runHour')" },
                    { label: 'Modify Maintenance Item', tag: 'B', action: "TVC_App.menuAction('modifyItem')", feature: 'showModifyOriginalPlan' },
                    { label: 'Update Plan', tag: 'B', action: "TVC_App.menuAction('originalPlan')", badge: c.dueMonth, badgeTone: 'blue' },
                    { label: 'Export to Captain Hub', tag: 'C', action: "TVC_App.menuAction('stationExport')", feature: 'showStationExport' },
                    { label: 'Data Export', tag: 'C', action: "TVC_App.menuAction('export')", feature: 'showExportShip' },
                ],
            },
            {
                key: 'hq', tone: 'green', icon: '🛰️', title: 'When received data from HQ',
                items: [
                    { label: 'Data Import', tag: 'C', action: "TVC_App.menuAction('import')", feature: 'showImportShip' },
                    { label: 'Review Confirmed Reports', tag: 'B', action: "TVC_App.menuAction('hqConfirm')", badge: c.approved, badgeTone: 'green', feature: 'showHqConfirmPanel' },
                ],
            },
            {
                key: 'necessary', tone: 'amber', icon: '🧰', title: 'When it is necessary',
                items: [
                    { label: 'Password Change', tag: 'A', action: "TVC_App.menuAction('password')" },
                    { label: 'Control Change', tag: 'B', action: "TVC_App.menuAction('control')" },
                    { label: 'Database Backup & Restore', tag: 'C', action: "TVC_App.menuAction('backup')" },
                ],
            },
        ];
    }

    function renderMenuStep(it, extra = {}) {
        const badge = (it.badge != null && it.badge > 0)
            ? `<span class="mi-badge mi-${it.badgeTone || 'blue'}">${it.badge}</span>` : '';
        if (extra.locked) {
            const tip = esc(extra.disabledTitle || 'Original Plan Update는 현재 사용할 수 없습니다.');
            return `<button type="button" class="menu-item disabled" disabled title="${tip}">
                <span class="mi-auth">[${it.tag}]</span>
                <span class="mi-label">${esc(it.label)}</span>
                <span class="mi-lock">🔒</span>
            </button>`;
        }
        return `<button class="menu-item" onclick="${it.action}">
            <span class="mi-auth">[${it.tag}]</span>
            <span class="mi-label">${esc(it.label)}</span>
            ${badge}<span class="mi-go">›</span>
        </button>`;
    }

    function menuFlowArrow() {
        return '<div class="menu-flow-arrow" aria-hidden="true"><span class="menu-flow-arrow-icon">▼</span></div>';
    }

    /** CMAXS 스타일 — At everyday: 순차 화살표 + 중간 안내 문구 */
    function renderLinearFlow(items, f) {
        const visible = items.filter(it => it.kind === 'note' || !it.feature || f[it.feature]);
        if (!visible.length) return '<div class="menu-item disabled">권한 없음 (No permitted action)</div>';
        let html = '<div class="menu-flow">';
        visible.forEach((it, i) => {
            if (i > 0) html += menuFlowArrow();
            if (it.kind === 'note') {
                html += `<div class="menu-flow-note">${esc(it.label)}</div>`;
            } else {
                html += renderMenuStep(it);
            }
        });
        return html + '</div>';
    }

    /** CMAXS 스타일 — At first day of every month: (If necessary) 분기 + 화살표 */
    function renderMonthlyFlow(items, f) {
        const runHour = items[0];
        const modify = items.find(it => it.optional);
        const original = items.find(it => it.label === 'Update Plan');
        const exportItem = items.find(it => it.label === 'Data Export');
        const planLocked = isOriginalPlanUpdateLocked(getPlanLockDept());
        const lockTip = getOriginalPlanLockMessage(getPlanLockDept());
        const steps = [runHour, original, exportItem].filter(it => it && (!it.feature || f[it.feature]));
        const showModify = modify && (!modify.feature || f[modify.feature]);
        if (!steps.length) return '<div class="menu-item disabled">권한 없음 (No permitted action)</div>';

        let html = '<div class="menu-flow menu-flow-monthly">';
        html += renderMenuStep(runHour);
        html += '<div class="menu-flow-split">';
        html += '<div class="menu-flow-col menu-flow-col-main">' + menuFlowArrow() + '</div>';
        if (showModify) {
            html += `<div class="menu-flow-col menu-flow-col-opt">
                <span class="menu-flow-if">( If necessary )</span>
                ${renderMenuStep(modify, { locked: planLocked, disabledTitle: lockTip })}
                ${menuFlowArrow()}
            </div>`;
        }
        html += '</div>';
        if (original && (!original.feature || f[original.feature])) {
            html += renderMenuStep(original, { locked: planLocked, disabledTitle: lockTip });
        }
        if (exportItem && (!exportItem.feature || f[exportItem.feature])) {
            html += menuFlowArrow() + renderMenuStep(exportItem);
        }
        return html + '</div>';
    }

    function renderMenuCardItems(card, f) {
        if (card.flow === 'linear') return renderLinearFlow(card.items, f);
        if (card.flow === 'monthly') return renderMonthlyFlow(card.items, f);
        const items = card.items.filter(it => !it.feature || f[it.feature]);
        if (!items.length) return '<div class="menu-item disabled">권한 없음 (No permitted action)</div>';
        return items.map(it => renderMenuStep(it)).join('');
    }

    function renderMenuCards(host) {
        if (!host) return;
        const f = state.user ? TVC_RBAC.getUiFeatures(state.user) : {};
        host.innerHTML = menuModel().map(card => {
            const rows = renderMenuCardItems(card, f);
            const flowCls = card.flow ? ` flow-${card.flow}` : '';
            return `<div class="work-card tone-${card.tone}${flowCls}">
                <div class="wc-head"><span class="wc-icon">${card.icon}</span>
                    <div><div class="wc-title">${esc(card.title)}</div></div>
                </div>
                <div class="wc-items">${rows}</div>
            </div>`;
        }).join('');
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
        setText('histDeptLabel', TVC_RBAC.getDeptLabel(state.department));
        renderCaptainViewDashboard();
        renderFleetList();
        const isHq = state.user && TVC_RBAC.isHqAccount(state.user);
        const mainCol = document.getElementById('menuMainCol');
        const sidebarCards = document.getElementById('cmaxsCardsSidebar');
        const mainCards = document.getElementById('cmaxsCards');
        if (mainCol) mainCol.classList.toggle('hidden', !!isHq);
        if (isHq) {
            renderMenuCards(sidebarCards);
            if (mainCards) mainCards.innerHTML = '';
        } else {
            renderMenuCards(mainCards);
            if (sidebarCards) sidebarCards.innerHTML = '';
        }
        renderSyncHistory();
        TVC_DefectReport.renderInbox();
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
            <tr><td colspan="5" class="muted hist-empty">최신 기준 Actual Plan 집계 — 부서 필터 적용</td></tr>`;
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
            case 'inputReport': menuNavigate('actual', { actualFilter: 'total' }); break;
            case 'approveReport': menuNavigate('history'); break;
            case 'hqConfirm': menuNavigate('history'); break;
            case 'runHour': menuNavigate('runhrs'); break;
            case 'originalPlan':
            case 'approveOriginalPlan':
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

    // ── Plan update & item edit (Actual Plan tab) ────────────────────
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

    function syncPlanUpdateUi() {
        const dept = getPlanLockDept();
        const locked = isOriginalPlanUpdateLocked(dept);
        const btn = document.getElementById('actUpdatePlanBtn');
        if (btn) {
            btn.disabled = locked;
            btn.title = locked ? getOriginalPlanLockMessage(dept) : '';
        }
        syncPlanItemUi();
        const msgEl = document.getElementById('actPlanCalcMsg');
        if (msgEl && locked && !state._planCalcMsg) {
            msgEl.textContent = getOriginalPlanLockMessage(dept);
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
        const btn = document.getElementById('actPlanTreeModifyBtn');
        if (btn) btn.classList.toggle('hidden', !canEdit);
    }

    function syncPlanGroupUi() {
        const bar = document.getElementById('actTreeActions');
        if (!bar) return;
        const canEdit = canEditOriginalPlanGroups();
        bar.classList.toggle('hidden', !canEdit);
        if (!canEdit) return;
        const node = selectedGroupNode();
        const addBtn = document.getElementById('actGroupAddBtn');
        const renBtn = document.getElementById('actGroupRenameBtn');
        if (addBtn) {
            addBtn.disabled = false;
            addBtn.title = '새 GROUP 추가 (작업 항목 없이 트리에만 표시)';
        }
        if (renBtn) {
            renBtn.disabled = !node;
            renBtn.title = node ? `선택: ${node.label}` : '수정할 GROUP을 트리에서 선택하세요';
        }
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
        if (!canEditOriginalPlanGroups()) return alert('HQ MODE에서만 GROUP 추가가 가능합니다.');
        renderGroupEditor('add');
        showModal('groupEditorModal');
    }

    function openOrigGroupRename() {
        if (!canEditOriginalPlanGroups()) return alert('HQ MODE에서만 GROUP 이름 수정이 가능합니다.');
        const node = selectedGroupNode();
        if (!node) return alert('PMS GROUP Tree에서 수정할 그룹을 선택하세요.');
        renderGroupEditor('rename');
        showModal('groupEditorModal');
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
        const codeCell = isNew
            ? origJobCellInput('oie_code', r.job_code)
            : `<span class="orig-inline-ro">${esc(r.job_code || '')}</span>`;
        const colgroup = '<colgroup><col style="width:32px"><col style="width:72px"><col style="width:130px"><col style="width:120px"><col><col style="width:72px"><col style="width:48px"><col style="width:88px"><col style="width:88px"></colgroup>';
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
                        <td class="c-code">${codeCell}</td>
                        <td class="c-s1">${origJobCellInput('oie_sort1', r.item_sort1)}</td>
                        <td class="c-d1">${origJobCellInput('oie_sort2', r.item_sort2)}</td>
                        <td class="c-d2">${origJobCellInput('oie_detail', r.job_detail, 'spare-inline-input-wide')}</td>
                        <td class="c-per"><span class="orig-inline-period">${origJobCellInput('oie_period', r.period, 'spare-inline-input-num')}${unitSelect}</span></td>
                        <td class="c-pic">${origJobCellInput('oie_pic', r.pic)}</td>
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
        };
        state._origJobEditMode = 'append';
        state._origJobEditId = null;
        refreshActJobEditBlock();
        syncPlanItemUi();
    }

    function cancelOrigJobInlineEdit() {
        const m = origJobInlineState();
        m.editId = null;
        m.mode = null;
        m.draft = null;
        refreshActJobEditBlock();
        syncPlanItemUi();
    }

    function readOrigJobInlineForm() {
        const g = (id) => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
        const m = origJobInlineState();
        const isNew = m.editId === NEW_ORIG_JOB_EDIT_ID;
        return {
            job_code: isNew ? g('oie_code') : (m.draft?.job_code || ''),
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
        };
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
            if (m.mode === 'append') {
                const ctx = defaultAppendContext();
                await TVC_MaintenancePlan.createJob(user, { ...data, department: ctx.dept });
                alert(`${data.job_code} 항목이 추가되었습니다.`);
            } else {
                await TVC_MaintenancePlan.updateJob(user, m.editId, data);
                alert(`${data.job_code} 항목이 수정되었습니다.`);
            }
            cancelOrigJobInlineEdit();
            await refreshAll();
        } catch (e) {
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
                <label>Job Code<input name="job_code" required value="${esc(job?.job_code || '')}" ${isNew ? '' : 'readonly class="wr-ro"'}></label>
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
                <label>P.I.C<input name="pic" value="${esc(job?.pic || '')}"></label>
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
                hint.textContent = `미완료 Work Report ${stats.pendingReports}건 — Cancel 선택 후 Actual Plan에서 입력하세요.`;
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
                ? `Original Plan Update 취소 — Due Date 원복. 미완료 Work Report ${pending}건을 Actual Plan에서 입력하세요.`
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
        const q = state.treeSearch;
        const matchNode = (n) => !q || (n.label || '').toLowerCase().includes(q) || (n.department || '').toLowerCase().includes(q);
        const matchCritical = !q || 'critical equipment'.includes(q) || q.includes('critical') || q.includes('crit');
        const byDept = new Map();
        state.idx.groupNodes
            .filter(n => (!state.department || n.department === state.department) && matchNode(n))
            .forEach(n => { if (!byDept.has(n.department)) byDept.set(n.department, []); byDept.get(n.department).push(n); });
        const allSelected = !state.selectedGroupKey;
        let html = `<div class="tree-node${allSelected ? ' selected' : ''}" onclick="TVC_App.selectGroup(null)"><span>📋 All Groups</span></div>`;
        if (matchCritical) {
            const critSel = state.selectedGroupKey === CRITICAL_GROUP_KEY ? ' selected' : '';
            html += `<div class="tree-node tree-node-critical${critSel}" onclick="TVC_App.selectGroup('${CRITICAL_GROUP_KEY}')"><span>⚠ Critical Equipment</span></div>`;
        }
        if (!byDept.size && q && !matchCritical) {
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

    // ── TAB: Actual Plan ─────────────────────────────────────────────
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
            maker: '',
            modelType: '',
            capacity: '',
            serialNo: '',
            allPendingCleared: false,
            dockingRepair: false,
            pendingForRepair: false,
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
        captureBatchJobDraft();
        loadBatchJobIntoEditor(jobId);
        state._batchJobPickerOpen = false;
        renderWorkReportModal();
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
            { key: 'overdue', label: 'Overdue', count: c.overdue, cls: 'act-dash-overdue' },
            { key: 'due30', label: 'Due (30d)', count: c.due30, cls: 'act-dash-due30' },
            { key: 'postponed', label: 'Postponed', count: c.postponed, cls: 'act-dash-postponed' },
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
        const job = state.idx?.jobById.get(state.selectedJobId);
        const noJob = !job;
        const canReport = !noJob || n >= 1;
        const reportLabel = n >= 2 ? `Report Input (${n})` : (n === 1 ? 'Report Input (1)' : 'Report Input');
        const reportTitle = n >= 2 ? `${n}개 작업 일괄 Work Report` : '';
        bar.innerHTML = `<div class="plan-action-btns">
                <button type="button" class="btn btn-sm"${noJob ? ' disabled' : ''}${noJob ? '' : ` onclick="TVC_App.openWorkProcedure('${job.id}')"`}>Work Procedure / History</button>
                <button type="button" class="btn btn-sm btn-green"${canReport ? '' : ' disabled'}${canReport ? ` onclick="TVC_App.openWorkReportInput()"` : ''}${reportTitle ? ` title="${escAttr(reportTitle)}"` : ''}>${reportLabel}</button>
                ${selectedItemsBtn}
            </div>`;
    }

    /** Job 단위 Work History — Work History 탭과 동일한 daily_work_reports / job_items 소스 */
    function jobWorkHistoryEntries(jobId) {
        const job = state.idx?.jobById.get(jobId);
        if (!job) return [];
        return workHistoryEntriesRaw().filter(e =>
            e.item.maintenance_job_id === jobId || e.item.job_code === job.job_code
        );
    }

    function jobConsumedSpareParts(jobId) {
        const spareById = new Map((state.spares || []).map(s => [s.id, s]));
        const consumed = [];
        jobWorkHistoryEntries(jobId).forEach(({ report: r, item }) => {
            const parts = item.used_parts?.length ? item.used_parts : (r.is_batch ? [] : (r.used_parts || []));
            const dt = formatCmaxsHistDate(r.work_date || r.report_date || r.created_at);
            parts.forEach(u => {
                const s = spareById.get(u.spare_part_id) || {};
                consumed.push({
                    date: dt,
                    part_no: s.part_no || u.spare_part_id,
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

    function histAttachmentCell(attachments) {
        const list = Array.isArray(attachments) ? attachments : [];
        const kb = wrAttachmentTotalKb(list);
        return `<td class="hist-at">${list.length ? '☑' : '☐'} <span class="hist-at-kb">${kb}KB</span></td>`;
    }

    function reportWorkflowStatusLabel(report, item) {
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

    /** Work History — Job item 단위 행 (Batch Report는 Job별로 펼침) */
    function workHistoryEntriesRaw() {
        const entries = [];
        workHistoryReports().forEach(r => {
            TVC_WorkReport.fromLegacy(r);
            (r.job_items || []).forEach(item => entries.push({ report: r, item }));
        });
        return entries;
    }

    function workHistoryEntries() {
        return workHistoryEntriesRaw().filter(matchHistSearch);
    }

    function histRowKey(reportId, jobId) {
        return `${reportId}|${jobId}`;
    }

    function getSelectedHistEntry() {
        if (!state._histSelReportId) return null;
        return workHistoryEntries().find(e =>
            histRowKey(e.report.id, e.item.maintenance_job_id) === state._histSelReportId
        ) || null;
    }

    function isHistRowCheckable(entry) {
        const { report: r, item } = entry;
        if (!state.user || r.is_locked || TVC_RBAC.isApprovedStatus(r.status, true)) return false;
        return itemSt(item) === 'REPORTED';
    }

    function isHistRowApprovable(entry) {
        if (!isHistRowCheckable(entry)) return false;
        const { report: r } = entry;
        if (TVC_RBAC.isConfirmedStatus(r.status)) return false;
        return TVC_RBAC.canConfirmDepartment(state.user, reportDept(r));
    }

    function histCheckDisabledTitle(entry) {
        const { report: r, item } = entry;
        if (!state.user) return '로그인 필요';
        if (r.is_locked || TVC_RBAC.isApprovedStatus(r.status, true)) return '승인 완료된 리포트';
        if (itemSt(item) !== 'REPORTED') return 'REPORTED 항목만 선택 가능';
        if (!TVC_RBAC.canConfirmDepartment(state.user, reportDept(r))) {
            return 'Confirm 권한 없음 (Engine Mode · C/E 또는 Master Mode · Captain)';
        }
        if (TVC_RBAC.isConfirmedStatus(r.status)) return '이미 Confirm 됨';
        return '선택 불가';
    }

    function pruneHistChecked() {
        const valid = new Set(
            workHistoryEntries().map(e => histRowKey(e.report.id, e.item.maintenance_job_id))
        );
        Object.keys(state._histChecked || {}).forEach(key => {
            if (!valid.has(key) || !state._histChecked[key]) delete state._histChecked[key];
        });
    }

    function bindWorkHistoryTableEvents() {
        const body = document.getElementById('historyBody');
        if (!body || body._histEventsBound) return;
        body._histEventsBound = true;
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

    function canModifyHistEntry(entry) {
        const r = entry?.report;
        if (!r) return false;
        return !r.is_locked && !TVC_RBAC.isApprovedStatus(r.status, true);
    }

    function canDeleteHistEntry(entry) {
        const r = entry?.report;
        if (!r || !state.user) return false;
        if (r.is_locked || TVC_RBAC.isApprovedStatus(r.status, true)) return false;
        if (TVC_RBAC.isConfirmedStatus(r.status) && !TVC_RBAC.isApprover(state.user)) return false;
        return TVC_RBAC.can(state.user, TVC_RBAC.Action.CREATE_DAILY_REPORT);
    }

    function getCheckedHistReportIds() {
        const ids = new Set();
        Object.keys(state._histChecked || {}).forEach(rowKey => {
            if (!state._histChecked[rowKey]) return;
            const reportId = rowKey.split('|')[0];
            if (reportId) ids.add(reportId);
        });
        return [...ids];
    }

    function updateHistToolbarState() {
        const entry = getSelectedHistEntry();
        const checkedIds = getCheckedHistReportIds();
        const checkedEntries = workHistoryEntries().filter(e =>
            state._histChecked?.[histRowKey(e.report.id, e.item.maintenance_job_id)]
        );
        const canConfirm = checkedEntries.length > 0
            && checkedEntries.every(isHistRowApprovable)
            && checkedIds.every(id => {
                const rep = state.reports.find(r => r.id === id);
                if (!rep) return false;
                const hasReported = TVC_WorkReport.getJobItems(rep).some(i => itemSt(i) === 'REPORTED');
                if (!hasReported || rep.is_locked || TVC_RBAC.isApprovedStatus(rep.status, true)) return false;
                if (TVC_RBAC.isConfirmedStatus(rep.status)) return false;
                return state.user && TVC_RBAC.canConfirmDepartment(state.user, reportDept(rep));
            });
        const setDis = (id, dis) => {
            const el = document.getElementById(id);
            if (el) { if (dis) el.setAttribute('disabled', ''); else el.removeAttribute('disabled'); }
        };
        setDis('histBtnDetail', !entry);
        setDis('histBtnModify', !entry || !canModifyHistEntry(entry));
        setDis('histBtnDelete', !entry || !canDeleteHistEntry(entry));
        setDis('histBtnApprove', !canConfirm);

        const approvable = workHistoryEntries().filter(isHistRowCheckable);
        const allEl = document.getElementById('histSelectAll');
        if (allEl && approvable.length) {
            const allOn = approvable.every(e =>
                state._histChecked[histRowKey(e.report.id, e.item.maintenance_job_id)]
            );
            allEl.checked = allOn;
            allEl.indeterminate = !allOn && approvable.some(e =>
                state._histChecked[histRowKey(e.report.id, e.item.maintenance_job_id)]
            );
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
            const key = histRowKey(e.report.id, e.item.maintenance_job_id);
            if (on) state._histChecked[key] = true;
            else delete state._histChecked[key];
        });
        renderWorkHistory();
    }

    function histDetailWorkReport() {
        const entry = getSelectedHistEntry();
        if (!entry) return alert('Work History에서 항목을 선택하세요.');
        openWorkReportFromHistory(entry.report.id, entry.item.maintenance_job_id);
    }

    function histModifyReport() {
        const entry = getSelectedHistEntry();
        if (!entry) return alert('Work History에서 항목을 선택하세요.');
        if (!canModifyHistEntry(entry)) return alert('승인(APPROVED)된 리포트는 수정할 수 없습니다.');
        openWorkReportFromHistory(entry.report.id, entry.item.maintenance_job_id);
        modifyWorkReport();
    }

    async function histReportApproval() {
        const checkedEntries = workHistoryEntries().filter(e =>
            state._histChecked?.[histRowKey(e.report.id, e.item.maintenance_job_id)]
        );
        if (!checkedEntries.length) return alert('Confirm할 REPORTED 항목의 체크박스(ㅁ)를 선택하세요.');
        const blocked = checkedEntries.filter(e => !isHistRowApprovable(e));
        if (blocked.length) {
            return alert('선택한 항목 중 Confirm할 수 없는 항목이 있습니다.\nEngine Mode(C/E) 또는 Master Mode(Captain) 로그인을 확인하세요.');
        }
        const reportIds = getCheckedHistReportIds();
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
        if (!canDeleteHistEntry(entry)) {
            if (TVC_RBAC.isApprovedStatus(entry.report.status, true) || entry.report.is_locked) {
                return alert('본사 승인(APPROVED)된 리포트는 삭제할 수 없습니다.');
            }
            return alert('Confirm 완료된 리포트는 Captain / Chief Engineer만 삭제할 수 있습니다.');
        }
        state._wrReportId = entry.report.id;
        state._wrBatchItemId = entry.item.maintenance_job_id;
        await deleteWorkReport();
    }

    /** Actual Plan에서 작성된 Work Report를 기반으로 이력 표시 */
    function renderWorkHistory() {
        const body = document.getElementById('historyBody');
        if (!body) return;
        bindWorkHistoryTableEvents();
        pruneHistChecked();
        const all = workHistoryEntriesRaw();
        const entries = workHistoryEntries();
        const colSpan = 16;
        setText('histCount', `${entries.length} / ${all.length} entries`);
        const searchEl = document.getElementById('histSearch');
        if (searchEl && document.activeElement !== searchEl) searchEl.value = state.search || '';
        if (!all.length) {
            body.innerHTML = `<tr><td colspan="${colSpan}" class="muted" style="text-align:center">No work reports yet. Create one from Original Plan or Actual Plan.</td></tr>`;
            updateHistToolbarState();
            return;
        }
        if (!entries.length) {
            body.innerHTML = `<tr><td colspan="${colSpan}" class="muted" style="text-align:center">No matches for "${esc(state.search)}".</td></tr>`;
            updateHistToolbarState();
            return;
        }
        body.innerHTML = entries.map(({ report: r, item }) => {
            const job = state.idx?.jobById.get(item.maintenance_job_id) || state.jobs.find(j => j.job_code === item.job_code);
            const f = item.form || wrReportForm(r);
            const dt = formatCmaxsHistDate(r.work_date || r.report_date || r.created_at);
            const st = reportWorkflowStatusLabel(r, item);
            const shipComments = String(f.shipComments || '').trim();
            const companyComment = String(r.company_comment || '').trim();
            const rowKey = histRowKey(r.id, item.maintenance_job_id);
            const sel = state._histSelReportId === rowKey ? ' row-selected' : '';
            const batchTag = r.is_batch ? `<span class="pill ok" title="Batch report">B</span> ` : '';
            const entry = { report: r, item };
            const canCheck = isHistRowCheckable(entry);
            const checked = canCheck && !!state._histChecked?.[rowKey];
            const chk = canCheck
                ? `<input type="checkbox" class="hist-chk-input"${checked ? ' checked' : ''}>`
                : `<input type="checkbox" disabled title="${escAttr(histCheckDisabledTitle(entry))}">`;
            return `<tr class="hist-row${sel}" data-hist-key="${escAttr(rowKey)}" onclick="TVC_App.selectHistRow('${escAttr(rowKey)}', event)" ondblclick="TVC_App.openWorkReportFromHistory('${escAttr(r.id)}','${escAttr(item.maintenance_job_id)}')">
                <td class="hist-chk" onclick="event.stopPropagation()">${chk}</td>
                <td class="hist-code">${batchTag}<strong>${esc(item.job_code)}</strong></td>
                <td>${esc(job?.item_sort1 || '')}</td>
                <td>${esc(job?.item_sort2 || '')}</td>
                <td class="hist-detail">${esc(job?.job_detail || item.description || r.description || '')}</td>
                <td class="hist-date">${esc(dt)}</td>
                <td>${esc(st)}</td>
                <td>${esc(f.fileNo || '')}</td>
                <td>${esc(f.voyNo || '')}</td>
                ${histFlagCell(!!f.dockingRepair)}
                ${histFlagCell(!!f.pendingForRepair)}
                ${histFlagCell(!!f.allPendingCleared)}
                ${histFlagCell(!!shipComments)}
                ${histFlagCell(!!companyComment)}
                ${histAttachmentCell(f.shipAttachments)}
                ${histAttachmentCell(f.companyAttachments)}
            </tr>`;
        }).join('');
        updateHistToolbarState();
    }

    /** Work History: 단일 클릭 — 행 선택 하이라이트(Actual Plan과 동일 UX) */
    function selectHistRow(rowKey, ev) {
        if (ev?.target?.closest?.('.hist-chk')) return;
        state._histSelReportId = rowKey;
        renderWorkHistory();
    }

    // ── TAB: Equipment Run Hrs (예측 정비 엔진 UI) ───────────────────
    function renderRunHrs() { TVC_RunHours.render(); }
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

    // ── TAB: Preparation Notice ──────────────────────────────────────
    function renderNotice() {
        const list = document.getElementById('noticeList');
        if (!list) return;
        const notices = deptJobs().filter(j => {
            const major = (j.unit || '').toUpperCase() === 'Y' || Number(j.period) >= 12;
            const soon = j.is_overdue || daysUntil(j.next_date) <= 60;
            return major && soon;
        }).sort((a, b) => (a.next_date || '').localeCompare(b.next_date || '')).slice(0, 60);
        if (!notices.length) { list.innerHTML = '<p class="muted" style="padding:24px">No upcoming major maintenance or inspection notices for this department.</p>'; return; }
        list.innerHTML = notices.map(j => {
            const od = j.is_overdue, d = daysUntil(j.next_date);
            const tone = od ? 'red' : (d <= 30 ? 'amber' : 'blue');
            return `<div class="notice-card tone-${tone}" onclick="TVC_App.openJobDetail('${j.id}')">
                <div class="nc-icon">${od ? '🚨' : '🛠️'}</div>
                <div class="nc-body">
                    <div class="nc-title">${esc(j.item_sort2 || j.job_detail || j.job_code)}</div>
                    <div class="nc-meta">${esc(j.job_code)} · ${esc(j.group || '')} · ${esc(j.department)} · ${j.period ?? ''}${esc(j.unit || '')}</div>
                </div>
                <div class="nc-date"><span class="nc-dtag ${od ? 'od' : ''}">${od ? 'OVERDUE' : 'D-' + d}</span><small>${esc(j.next_date || '')}</small></div>
            </div>`;
        }).join('');
    }

    // ── Job detail / procedure modals ────────────────────────────────
    /** Original / Actual Plan: 더블 클릭 — CMAXS Work Procedure / Work History 모달 */
    function openWorkProcedure(jobId, tab) {
        if (state._wpJobId !== jobId) state._wpTab = 'procedure';
        state._wpJobId = jobId;
        state.selectedJobId = jobId;
        if (tab) state._wpTab = tab;
        if (state.vlActual) state.vlActual.refresh();
        renderWorkProcedureModal();
        renderSidePanel();
        showModal('workProcedureModal');
    }

    function setWorkProcedureTab(tab) {
        state._wpTab = tab;
        renderWorkProcedureModal();
    }

    function renderWorkProcedureModal() {
        const job = state.idx?.jobById.get(state._wpJobId);
        const host = document.getElementById('workProcedureBody');
        if (!job || !host) return;
        const meta = TVC_JobMeta.getHistoryForJob(job.job_code);
        const histEntries = jobWorkHistoryEntries(job.id);
        const procActive = state._wpTab === 'procedure' ? ' active' : '';
        const histActive = state._wpTab === 'history' ? ' active' : '';

        let tabContent = '';
        if (state._wpTab === 'procedure') {
            tabContent = `
                <div class="wp-meta-row">
                    <span><b>Interval</b> ${job.period ?? '—'} ${esc(job.unit || '')}</span>
                    <span><b>Due Date</b> ${esc(job.next_date || '—')}</span>
                    <span><b>P.I.C</b> ${esc(job.pic || '—')}</span>
                </div>
                <label class="wp-label">Work Procedure</label>
                <div class="proc-box wp-proc-box">${esc(meta.procedure || job.job_detail || 'No procedure registered.')}</div>`;
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

        host.innerHTML = `
            <h3 class="wp-title">Work Procedure</h3>
            <div class="wp-job-head">
                <span><b>Code</b> ${esc(job.job_code)}</span>
                <span><b>SORT-1</b> ${esc(job.item_sort1 || '—')}</span>
                <span><b>SORT-2</b> ${esc(job.item_sort2 || '—')}</span>
            </div>
            <p class="wp-job-detail">${esc(job.job_detail || '')}</p>
            <div class="wp-tabs">
                <button class="wp-tab${procActive}" onclick="TVC_App.setWorkProcedureTab('procedure')">Work Procedure</button>
                <button class="wp-tab${histActive}" onclick="TVC_App.setWorkProcedureTab('history')">Work History &amp; Consumed Spare Parts</button>
            </div>
            <div class="wp-tab-pane">${tabContent}</div>
            <div class="modal-actions">
                <button class="btn btn-green" onclick="TVC_App.closeModal('workProcedureModal');TVC_App.openWorkReportInput('${job.id}')">Report Input</button>
                <button class="btn" onclick="TVC_App.closeModal('workProcedureModal')">Close</button>
            </div>`;
    }

    // ── CMAXS Work Report (3 tabs) ───────────────────────────────────
    const WR_TABS = {
        repair: 'Maintenance',
        postpone: 'Postpone',
    };

    /** Original / Actual Plan → Report Input: CMAXS 스타일 Work Report 화면 */
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
                lastMaintDate: job.last_done || '',
                pmsGroupNo: hdr.pmsGroupNo || '',
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
    function openWorkReportFromHistory(reportId, jobId) {
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
        state._wrReadonly = true;
        state._wrForm = { ...(item?.form || rep.report_form || {}) };
        state._wrUsedParts = enrichUsedParts(item?.used_parts || rep.used_parts || []);
        state._wrPage = '1';
        state._wrSpareSearch = '';
        state._wrTab = rep.work_type === 'POSTPONE' ? 'postpone' : 'repair';
        renderWorkReportModal();
        showModal('workReportModal');
    }

    /** 히스토리 읽기 뷰 → 편집 모드 전환 */
    function modifyWorkReport() {
        state._wrReadonly = false;
        renderWorkReportModal();
    }

    /** Work Report 창에서 이전/다음 리포트로 이동 (Work History 목록 순서 기준) */
    function navReport(dir) {
        const list = workHistoryEntries();
        if (!list.length) return;
        const curKey = state._wrBatchItemId ? `${state._wrReportId}|${state._wrBatchItemId}` : state._wrReportId;
        let i = list.findIndex(e => `${e.report.id}|${e.item.maintenance_job_id}` === curKey || e.report.id === state._wrReportId);
        if (i < 0) i = 0; else i += dir;
        if (i < 0) { alert('첫 번째 리포트입니다.'); return; }
        if (i >= list.length) { alert('마지막 리포트입니다.'); return; }
        const keepTab = state._wrTab;
        openWorkReportFromHistory(list[i].report.id, list[i].item.maintenance_job_id);
        state._wrTab = keepTab || state._wrTab;
        renderWorkReportModal();
    }

    /** Work Report 삭제 (승인 완료 리포트는 재고/일자 자동 원상복구) */
    async function deleteWorkReport() {
        if (!state._wrReportId) return;
        const user = TVC_Auth.getCurrentUser();
        if (!user) return;
        const rep = state.reports.find(r => r.id === state._wrReportId);
        const isShipConfirmed = rep && TVC_RBAC.isConfirmedStatus(rep.status);
        const isHqApproved = rep && (TVC_RBAC.isApprovedStatus(rep.status, true) || rep.is_locked);

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

    function buildWrPage2Meta(job, reportedByName, today) {
        const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
        return {
            reportDate: wf('reportDate', today),
            workDate: wf('workDate', today),
            reportedBy: reportedByName,
            pmsGroupNo: wf('pmsGroupNo', hdr.pmsGroupNo || job?.group || ''),
            jobCode: job?.job_code || '',
            sort1: job?.item_sort1 || '',
            sort2: job?.item_sort2 || '',
            jobDetail: job?.job_detail || '',
            shipComments: wf('shipComments', ''),
        };
    }

    function renderWrBatchJobRowsHtml(jobIds, activeJobId) {
        if (!jobIds?.length) return '';
        const rows = jobIds.map(id => {
            const j = state.idx?.jobById.get(id);
            if (!j) return '';
            const active = id === activeJobId ? ' wr-maint-batch-job-row-active' : '';
            return `<div class="wr-maint-grid wr-maint-grid-4 wr-maint-batch-job-row${active}" role="button" tabindex="0"
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
        } = opts;
        const hdr = TVC_SpareMenu.resolveWrJobHeader(state, job);
        const fld = (label, inner, extraCls = '') => `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const inp = (key, val) => `<input data-wf="${key}" value="${esc(wf(key, val))}">`;
        const roWf = (key, val) => `<input class="wr-ro" data-wf="${key}" value="${esc(wf(key, val))}" readonly tabindex="-1">`;
        const jobCodeEl = batchMode
            ? `<button type="button" class="wr-maint-batch-code" onclick="TVC_App.openBatchJobPicker()">${esc(job.job_code)}</button>`
            : `<input class="wr-ro" value="${esc(job.job_code)}" readonly>`;
        const jobInfoBlock = batchMode && batchJobIds.length
            ? renderWrBatchJobRowsHtml(batchJobIds, activeJobId || job.id)
            : `<div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Job Code', jobCodeEl)}
                    ${fld('SORT-1', `<input class="wr-ro" value="${esc(job.item_sort1 || '')}" readonly>`)}
                    ${fld('SORT-2', `<input class="wr-ro" value="${esc(job.item_sort2 || '')}" readonly>`)}
                    ${fld('Job Detail', `<input class="wr-ro" value="${esc(job.job_detail || '')}" readonly>`)}
                </div>`;

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
                ${jobInfoBlock}
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Maker', roWf('maker', hdr.maker))}
                    ${fld('Model / Type', roWf('modelType', hdr.modelType))}
                    ${fld('Capacity', roWf('capacity', hdr.capacity))}
                    ${fld('Serial No.', roWf('serialNo', hdr.serialNo))}
                </div>
                <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap">
                    ${fld('Total Run Hrs', `<input type="number" data-wf="runHrs" value="${esc(wf('runHrs', '0'))}">`)}
                    ${fld('Last Maintenance Date', `<input type="date" data-wf="lastMaintDate" value="${esc(wf('lastMaintDate', job.last_done || ''))}">`)}
                    ${fld('Running Hrs after Last Maint.', inp('rhAfterLastMaint', ''))}
                </div>
                ${fld('Outline of Maintenance', `<textarea class="wr-maint-textarea" data-wf="outline" rows="3">${esc(wf('outline'))}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
                ${fld("Ship's Comments &amp; Desired Articles", `<textarea class="wr-maint-textarea" data-wf="shipComments" rows="3">${esc(wf('shipComments'))}</textarea>`, 'wr-maint-span-all')}
                <div class="wr-maint-attach-wrap">${renderWrAttachmentBlock('ship', { canUpload: canEditShipAttach })}</div>
                <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap wr-maint-labor">
                    ${fld('Working Hours', `<input type="number" data-wf="handHours" value="${esc(wf('handHours', '0'))}">`)}
                    ${fld('Working Member', `<input type="number" data-wf="handMembers" value="${esc(wf('handMembers', '0'))}">`)}
                    <div class="wr-maint-field wr-maint-chk-field">
                        <label class="wr-maint-chk"><input type="checkbox" data-wf="shoreTechnician" ${wf('shoreTechnician') ? 'checked' : ''}> Shore Technician</label>
                    </div>
                </div>
                ${fld("Company's Comments", `<textarea class="wr-maint-textarea wr-ro" rows="3" readonly>${esc(rep?.company_comment || '')}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
                <div class="wr-maint-attach-wrap">${renderWrAttachmentBlock('company', { canUpload: canEditCompanyAttach })}</div>
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
                    ${fld('Last Maintenance Date', `<input type="date" data-wf="lastMaintDate" value="${esc(wf('lastMaintDate', job.last_done || ''))}">`)}
                    ${fld('Running Hrs after Last Maint.', inp('rhAfterLastMaint', ''))}
                </div>
                <div class="wr-maint-grid wr-maint-grid-2 wr-maint-grid-gap">
                    ${fld('Original Due Date', `<input class="wr-ro" value="${esc(job.next_date || '—')}" readonly>`)}
                    ${fld('Postpone Date', `<input type="date" data-wf="postponeDate" value="${esc(wf('postponeDate'))}">`, 'wr-postpone-date')}
                </div>
                ${fld("Ship's Comments &amp; Desired Articles", `<textarea class="wr-maint-textarea" data-wf="shipComments" rows="3">${esc(wf('shipComments'))}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
                <div class="wr-maint-attach-wrap">${renderWrAttachmentBlock('ship', { canUpload: canEditShipAttach })}</div>
                ${fld("Company's Comments", `<textarea class="wr-maint-textarea wr-ro" rows="3" readonly>${esc(rep?.company_comment || '')}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
                <div class="wr-maint-attach-wrap">${renderWrAttachmentBlock('company', { canUpload: canEditCompanyAttach })}</div>
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
        const reportedByName = rep ? reporterLabel(rep.reporter_name) : TVC_RBAC.getRankLabel(state.user);
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
            : (list.length ? '' : `<span class="wr-attach-label">${esc(label)}</span>`);
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
        const reportedByName = TVC_RBAC.getRankLabel(state.user);
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
            <button class="btn" onclick="TVC_App.printWorkReport()">🖨 Print</button>
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
        const isRepConfirmed = !!rep && TVC_RBAC.isConfirmedStatus(rep.status);
        const isRepApproved = !!rep && TVC_RBAC.isApprovedStatus(rep.status, true);
        const canConfirmNow = !!rep && TVC_RBAC.isReportedStatus(rep.status) && TVC_RBAC.canConfirmDepartment(state.user, job.department);
        const canApproveNow = !!rep && TVC_RBAC.isConfirmedStatus(rep.status) && TVC_RBAC.canApproveHqReport(state.user);
        const reportedByName = rep ? reporterLabel(rep.reporter_name) : TVC_RBAC.getRankLabel(state.user);
        const confirmedByVal = isRepConfirmed ? (rep.confirmed_at || '').slice(0, 10) : '';
        const approvedByVal = isRepApproved ? (rep.approved_at || '').slice(0, 10) : '';
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
            });
        } else if (state._wrTab === 'postpone') {
            body = renderWrPostponeBody(job, {
                rep, reportedByName, today,
                canApproveNow, canConfirmNow, isRepApproved, isRepConfirmed,
                approvedByVal, confirmedByVal,
                canEditShipAttach, canEditCompanyAttach,
            });
        }

        const isHist = !!state._wrReportId;
        const navBtns = isHist
            ? `<button class="btn" onclick="TVC_App.navReport(-1)">&laquo; Previous</button>
               <button class="btn" onclick="TVC_App.navReport(1)">Next &raquo;</button>`
            : '';
        const primaryBtn = ro
            ? `<button class="btn btn-green" onclick="TVC_App.modifyWorkReport()">✏️ Modify</button>`
            : `<button class="btn btn-green" onclick="TVC_App.saveWorkReport()">💾 Save</button>`;
        const deleteBtn = isHist
            ? `<button class="btn btn-red" onclick="TVC_App.deleteWorkReport()">🗑 Delete</button>`
            : '';
        const printBtn = `<button class="btn" onclick="TVC_App.printWorkReport()">🖨 Print</button>`;
        const closeBtn = isHist
            ? `<button class="btn" onclick="TVC_App.closeWorkReport()">${ro ? 'Close' : 'Cancel'}</button>`
            : `<button class="btn" onclick="TVC_App.closeWorkReport()">Cancel</button>`;
        const actionsHtml = `${navBtns}${primaryBtn}${deleteBtn}${printBtn}${closeBtn}`;
        const titleText = ro ? 'Work Report (View)' : (isHist ? 'Work Report (Modify)' : 'Work Report');

        host.innerHTML = `
            <div class="wr-titlebar">${titleText}</div>
            <div class="wr-tabsel">${tabBtns}</div>
            ${pageTabsBar}
            <div class="wr-page tone-${state._wrTab}">
                ${headHtml}
                ${body}
            </div>
            <div class="modal-actions wr-actions">
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

    /** Work Report 창 닫기 — Confirmed/Approved 체크 시 Confirm·Approve 처리 후 닫기 */
    async function closeWorkReport() {
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
        TVC_SpareMenu.teardownWrSparePage2();
        TVC_SpareMenu.cleanupConsumeWorkReportOverlay();
        state._wrReportId = null;
        state._wrBatchItemId = null;
        state._wrReadonly = false;
        state._wrForm = {};
        state._wrUsedParts = [];
        state._wrPage = '1';
        state._wrSpareSearch = '';
        closeModal('workReportModal');
    }

    async function saveWorkReport() {
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
                    const consumeLogId = await TVC_SpareMenu.syncConsumeLogFromWorkReport({
                        report,
                        job,
                        usedParts: wrPartsForConsumeLog,
                        form: consumeForm,
                        user,
                        department: job.department || state.department || '',
                    });
                    if (report.consume_log_id !== consumeLogId) {
                        report.consume_log_id = consumeLogId || null;
                        await TVC_DB.put('daily_work_reports', report);
                    }
                } catch (syncErr) {
                    console.error('Consumed Log sync failed:', syncErr);
                }
            }

            const wasModify = !!state._wrReportId;
            state._wrForm = {};
            state._wrUsedParts = [];
            state._wrPage = '1';
            state._wrSpareSearch = '';
            state._wrReportId = null;
            state._wrReadonly = false;
            closeModal('workReportModal');
            await refreshAll();
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
    }

    // ── Print ────────────────────────────────────────────────────────
    function printCurrentTab(preview) {
        if (state.currentTab !== 'actual') {
            alert('인쇄는 Actual Plan 탭에서만 지원됩니다.');
            return;
        }
        const ids = sheetIds('actual');
        const jobs = ids.map(id => state.idx.jobById.get(id)).filter(Boolean);
        const title = 'Actual Plan';
        const dept = TVC_RBAC.getDeptLabel(state.department);
        const html = `<html><head><title>TVC ${title}</title><style>
            body{font-family:sans-serif;font-size:12px} table{width:100%;border-collapse:collapse}
            th,td{border:1px solid #ccc;padding:6px;text-align:left} th{background:#1a365d;color:#fff}
        </style></head><body><h1>TVC ${title} — ${dept}</h1><p>${new Date().toLocaleString()} · ${jobs.length} jobs</p>
        <table><tr><th>JOB CODE</th><th>SORT-1</th><th>SORT-2</th><th>JOB DETAIL</th><th>DEPT</th><th>NEXT</th><th>LAST DONE</th><th>P.I.C</th></tr>
        ${jobs.map(j => `<tr><td>${esc(j.job_code)}</td><td>${esc(j.item_sort1 || '')}</td><td>${esc(j.item_sort2 || '')}</td><td>${esc(j.job_detail || '')}</td>
        <td>${esc(j.department)}</td><td>${esc(j.next_date || '')}</td><td>${esc(j.last_done || '')}</td><td>${esc(j.pic || '')}</td></tr>`).join('')}
        </table></body></html>`;
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
        if (!preview) w.print();
    }

    // ── Auth / sync handlers ─────────────────────────────────────────
    async function handleLogin() {
        const errEl = document.getElementById('loginErr');
        try {
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
            await TVC_DefectSync.importPackage(user, file);
            await refreshAll();
            if (state.currentTab === 'menu') {
                renderSyncHistory();
                TVC_DefectReport.renderInbox();
            }
            if (state.currentTab === 'defect') TVC_DefectReport.renderTab();
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
            await refreshAll();
            if (state.currentTab === 'menu') renderSyncHistory();
            const unlockNote = (!TVC_RBAC.isHqAccount(user) && payload?.export_meta?.direction === 'HQ_TO_SHIP')
                ? `\nOriginal Plan Update 기능이 다시 활성화되었습니다.`
                : '';
            alert(`${TVC_RBAC.getDeptLabel(dept)} 데이터 Import 완료${unlockNote}`);
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
    function showModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        window.TVC_ModalDrag?.resetModal?.(el);
        el.classList.remove('hidden');
    }
    function closeModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add('hidden');
        window.TVC_ModalDrag?.resetModal?.(el);
    }
    function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

    /** Reporter 표시 정규화: 이름/직급이 섞인 값에서 역할만 추출 (Engineer/C-E/Officer/Captain/Superintendent) */
    function reporterLabel(name) {
        const s = String(name ?? '').trim();
        if (!s) return '';
        if (/C\/E|Chief/i.test(s)) return 'C/E';
        if (/Captain|선장/i.test(s)) return 'Captain';
        if (/Engineer|기관|\/E/i.test(s)) return 'Engineer';
        if (/Officer|\/O|Deck/i.test(s)) return 'Officer';
        if (/Superintendent|본사|\bHQ\b/i.test(s)) return 'Superintendent';
        return s;
    }
    function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }

    return {
        boot, switchTab, navigate,
        setDepartment, setCaptainView, setHistView, setHistTab, menuAction, resolveDeptPick,
        setFleetView, setFleetSearch, selectVessel,
        setSearch, setTreeSearch, sortJobs, setActualFilter, onActualPeriodChange, clearActualPeriod, selectGroup, renderGroupTree,
        openJobDetail, openWorkProcedure, setWorkProcedureTab, openProcedureHistory, openProcedureHistoryByCode,
        openWorkReport, openWorkReportInput, setWorkReportTab, setWorkReportPage, saveWorkReport,
        uploadWrAttachment, removeWrAttachment,
        toggleBatchJob, toggleBatchSelectAll, openBatchReport, saveBatchReport,
        togglePlanSelectedOnly, toggleActSelectedOnly, renderPlanGroupHeader,
        setBatchActiveJob, openBatchJobPicker, closeBatchJobPicker, closeBatchReport,
        openWorkReportFromHistory, modifyWorkReport, selectHistRow,
        histDetailWorkReport, histModifyReport, histReportApproval, histDeleteReport,
        toggleHistCheck, toggleHistSelectAll,
        navReport, deleteWorkReport, printWorkReport, closeWorkReport,
        selectJobRow,
        selectSpareRow, focusSpareRow, toggleSpareRow, syncSpareItemToolbar, spareActionIds, canEditSpareItems, openSpareAppend, openSpareModify, deleteSpareItem,
        saveRunHrs, runHrsPreview, runHrsTotalEdit,         updateOriginalPlanFromRunHours,
        openOrigJobModify, openOrigJobAppend, saveOrigJobEditor, saveOrigJobInlineEdit, cancelOrigJobInlineEdit, deleteOrigJob,
        openOrigGroupAdd, openOrigGroupRename, saveGroupEditor,
        confirmPlanUpdate, closePlanUpdateModal, printCurrentTab,
        doSubmit, doExecute, doApprove, doConfirm,
        handleLogin, handleLogout, handleExport, handleImport, handleHubImport, handleDefectImport,
        urgentExportDefect, exportDefectCompletion, loadSeedFile,
        uploadAttachment, saveDetailReport, closeModal, showModal, dismissSpicsAlerts, openSpicsRequisition,
    };
})();

document.addEventListener('DOMContentLoaded', () => TVC_App.boot());
window.TVC_App = TVC_App;
