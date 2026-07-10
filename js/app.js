/* THE VESSEL CODE — Main Application (v3.0 · CMAXS Tab Navigation) */
const TVC_App = (function () {
    const ROW_H = 36;
    const TABS = ['menu', 'original', 'actual', 'history', 'runhrs', 'spare', 'notice'];
    const CRITICAL_GROUP_KEY = '__CRITICAL_EQUIPMENT__';
    let _wrSpareSearchT = null;

    let state = {
        user: null,
        components: [], jobs: [], groups: [], spares: [], reports: [],
        idx: null,
        selectedGroupKey: null,
        treeSearch: '',
        actualFilter: 'total',        // total | overdue | due30 | pending
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
        department: 'ENGINE',              // global filter (locked for ship, switchable for HQ)
        space: 'SHIP',                     // 데이터 공간: 'HQ' | 'SHIP' (Export/Import로만 상호 동기화)
        currentTab: 'menu',
        histTab: 'all',
        vlOriginal: null,
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
        batchSelectedSpares: {},     // { spareId: true } — ㅁ 체크 다중 선택
        spareMenu: null,
        batchSelectedJobs: {},   // { jobId: true } — Actual Plan 다중 선택
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

    async function loadData() {
        const allComponents = await TVC_DB.getAll('ship_components');
        const allJobs = await TVC_DB.getAll('maintenance_jobs');
        const allGroups = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        await normalizeGroupDepartments(allJobs, allComponents, allGroups);
        const allReports = await TVC_DB.getAll('daily_work_reports');
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

        if (state.user && !TVC_RBAC.isHqAccount(state.user) && state.user.department) {
            const dept = state.user.department;
            state.jobs = allJobs.filter(j => j.department === dept);
            state.components = allComponents.filter(c => !c.path || c.path[0] === dept);
            state.groups = allGroups.filter(g => g.department === dept);
            const deptCodes = new Set(state.jobs.map(j => j.job_code));
            state.reports = allReports.filter(r => TVC_WorkReport.belongsToJobCodeSet(r, deptCodes));
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
        }
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
        state.department = isHq ? null : (state.user.department || null);
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
        original: renderOriginalPlan,
        actual: renderActualPlan,
        history: renderWorkHistory,
        runhrs: renderRunHrs,
        spare: renderSpareMenu,
        notice: renderNotice,
    };

    /** 상단 탭 전환 — 부서 필터 상태는 그대로 유지된다. */
    function switchTab(tab) {
        if (!TABS.includes(tab)) tab = 'menu';
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
        const map = { menu: 'menu', dashboard: 'actual', workplan: 'original' };
        switchTab(map[view] || view);
    }

    function rerenderCurrentTab() { (TAB_RENDERERS[state.currentTab] || renderMainMenu)(); }

    // ── Header / role UI ─────────────────────────────────────────────
    function updateUserBar(user) {
        const badge = TVC_RBAC.isHqAccount(user)
            ? 'HQ Mode'
            : `Vessel Mode${user.department ? ` · ${TVC_RBAC.getDeptLabel(user.department)}` : ''}`;
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
        const f = TVC_RBAC.getUiFeatures(user);
        document.querySelectorAll('[data-feature]').forEach(el => {
            el.classList.toggle('hidden', !f[el.dataset.feature]);
        });
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

    /** HQ만 All/Deck/Engine 토글 표시. 선박 계정은 고정 부서 라벨만 노출. */
    function renderDeptToggles(user) {
        if (!user) return;
        const isHq = TVC_RBAC.isHqAccount(user);
        document.querySelectorAll('.dept-toggle').forEach(group => {
            if (isHq) {
                const opts = [{ v: null, l: 'All' }, { v: 'DECK', l: 'Deck' }, { v: 'ENGINE', l: 'Engine' }];
                const btns = opts.map(o => {
                    const active = state.department === o.v ? ' active' : '';
                    const arg = o.v ? `'${o.v}'` : 'null';
                    return `<button class="dept-btn${active}" data-dept="${o.v || ''}" onclick="TVC_App.setDepartment(${arg})">${o.l}</button>`;
                }).join('');
                group.innerHTML = '<span class="dept-label">Department</span>' + btns;
            } else {
                group.innerHTML = `<span class="dept-label">Department</span><span class="dept-fixed pill ok">${TVC_RBAC.getDeptLabel(user.department)} 🔒</span>`;
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
        // 선박 계정은 자기 부서에 고정, 본사는 All/Deck/Engine 자유 전환
        if (state.user && !TVC_RBAC.isHqAccount(state.user) && dept !== state.user.department) {
            alert('이 계정은 ' + TVC_RBAC.getDeptLabel(state.user.department) + ' 부서 전용입니다.');
            return;
        }
        state.department = dept;
        state.selectedGroupKey = null;
        renderDeptToggles(state.user);
        setText('histDeptLabel', TVC_RBAC.getDeptLabel(state.department));
        rerenderCurrentTab();
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
            workHistoryStatusLabel(r),
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
            const pendingKeys = af === 'pending' ? pendingReportJobKeys() : null;
            ids = ids.filter(id => {
                const j = idx.jobById.get(id);
                if (!j) return false;
                if (af === 'total') return true;
                if (af === 'overdue') return j.is_overdue;
                if (af === 'due30') return !j.is_overdue && daysUntil(j.next_date) <= 30;
                if (af === 'pending') {
                    return pendingKeys.ids.has(j.id) || pendingKeys.codes.has(j.job_code);
                }
                return true;
            });
            if (hasActualPeriodFilter()) {
                ids = ids.filter(id => isJobInActualPeriod(idx.jobById.get(id)));
            }
        }
        ids = ids.filter(id => matchSearch(idx.jobById.get(id)));
        return sortIds(ids);
    }

    function setSearch(q) { state.search = (q || '').toLowerCase(); rerenderCurrentTab(); }
    function setTreeSearch(q) {
        state.treeSearch = (q || '').toLowerCase();
        renderGroupTree('origTree');
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
        state.actualFilter = f;
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
        state.selectedGroupKey = key || null;
        // 그룹을 바꾸면 이전에 클릭한 아이템 포커스를 해제 — 헤더가 새 그룹 정보를 표시하도록
        state.focusedSpareId = null;
        if (modStateSpare()) modStateSpare().focusedId = null;
        if (state.currentTab === 'original') renderOriginalPlan();
        else if (state.currentTab === 'actual') renderActualPlan();
        else if (state.currentTab === 'spare') TVC_SpareMenu.render();
    }

    // ── Job table (shared by Original & Actual) ──────────────────────
    function renderJobRowHtml(j, mode) {
        const st = j.is_overdue ? '<span class="pill overdue">OVERDUE</span>'
            : (daysUntil(j.next_date) <= 30 ? '<span class="pill warn">DUE</span>' : '<span class="pill ok">OK</span>');
        const selected = state.selectedJobId === j.id ? ' row-selected' : '';
        if (mode === 'actual') {
            const batchOn = !!state.batchSelectedJobs[j.id];
            return `<div class="vl-cells sheet-actual${selected}${j.is_overdue ? ' row-overdue' : ''}"
                onclick="TVC_App.selectJobRow('${j.id}')"
                ondblclick="TVC_App.openWorkProcedure('${j.id}')">
                <span class="c-chk" onclick="event.stopPropagation()">
                    <input type="checkbox" class="act-batch-chk" ${batchOn ? 'checked' : ''} aria-label="Select for batch"
                        onchange="TVC_App.toggleBatchJob('${escAttr(j.id)}', this.checked)">
                </span>
                <span class="c-code"><strong>${esc(j.job_code)}</strong></span>
                <span class="c-s1">${esc(j.item_sort1 || '')}</span>
                <span class="c-d1">${esc(j.item_sort2 || '')}</span>
                <span class="c-d2">${esc(j.job_detail || '')}</span>
                <span class="c-per">${j.period ?? '—'} ${esc(j.unit || '')}</span>
                <span class="c-pic">${esc(j.pic || '')}</span>
                <span class="c-next">${esc(j.next_date || '—')}</span>
                <span class="c-last">${esc(j.last_done || '—')}</span>
                <span class="c-st">${st}</span>
            </div>`;
        }
        return `<div class="vl-cells sheet-original${selected}${j.is_overdue ? ' row-overdue' : ''}"
            onclick="TVC_App.selectJobRow('${j.id}')"
            ondblclick="TVC_App.openWorkProcedure('${j.id}')">
            <span class="c-chk" onclick="event.stopPropagation()">
                <input type="checkbox" class="orig-chk-disabled" disabled aria-label="Selection not available">
            </span>
            <span class="c-code"><strong>${esc(j.job_code)}</strong></span>
            <span class="c-s1">${esc(j.item_sort1 || '')}</span>
            <span class="c-d1">${esc(j.item_sort2 || '')}</span>
            <span class="c-d2">${esc(j.job_detail || '')}</span>
            <span class="c-per">${j.period ?? '—'} ${esc(j.unit || '')}</span>
            <span class="c-pic">${esc(j.pic || '')}</span>
            <span class="c-next">${esc(j.next_date || '—')}</span>
            <span class="c-last">${esc(j.last_done || '—')}</span>
            <span class="c-st">${st}</span>
        </div>`;
    }

    /** 행 단일 클릭 — 선택(연한 파란색)만, 모달 없음 */
    function selectJobRow(jobId) {
        state.selectedJobId = jobId;
        if (state.vlOriginal) state.vlOriginal.refresh();
        if (state.vlActual) state.vlActual.refresh();
        renderSidePanel();
        if (state.currentTab === 'original') syncOriginalPlanItemUi();
    }

    function mountJobSheet(headId, countId, scrollId, ids, vlKey, sheetMode) {
        const container = document.getElementById(scrollId);
        if (!container) return;
        const arrow = f => state.jobSort.field === f ? (state.jobSort.asc ? ' ▲' : ' ▼') : '';
        setText(countId, `${ids.length} jobs`);
        const mode = sheetMode || 'original';
        const head = document.getElementById(headId);
        if (head) {
            head.classList.toggle('sheet-scroll-actual', mode === 'actual');
            head.classList.toggle('sheet-scroll-original', mode !== 'actual');
            if (mode === 'actual') {
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
            } else {
                head.innerHTML = `<div class="vl-head">
                    <span class="c-chk"><input type="checkbox" class="orig-chk-disabled" disabled aria-hidden="true"></span>
                    <span class="c-code sortable" onclick="TVC_App.sortJobs('job_code')">JOB CODE${arrow('job_code')}</span>
                    <span class="c-s1">SORT-1</span><span class="c-d1">SORT-2</span><span class="c-d2">JOB DETAIL</span>
                    <span class="c-per">PERIOD</span><span class="c-pic">P.I.C</span>
                    <span class="c-next sortable" onclick="TVC_App.sortJobs('next_date')">NEXT DATE${arrow('next_date')}</span>
                    <span class="c-last">LAST DONE</span><span class="c-st">STATUS</span>
                </div>`;
            }
        }
        container.classList.toggle('sheet-scroll-actual', mode === 'actual');
        container.classList.toggle('sheet-scroll-original', mode !== 'actual');
        if (state[vlKey]) state[vlKey].destroy();
        state[vlKey] = TVC_VirtualList.mount(container, {
            rowHeight: ROW_H,
            getCount: () => ids.length,
            renderRow: (i) => {
                const j = state.idx.jobById.get(ids[i]);
                return j ? renderJobRowHtml(j, mode) : '';
            },
        });
        state[vlKey].refresh();
        // 가로 스크롤 시 헤더도 함께 이동 (좁은 화면 대응)
        if (head) container.addEventListener('scroll', () => { head.scrollLeft = container.scrollLeft; });
    }

    // ── TAB: Menu ────────────────────────────────────────────────────
    function menuCounts() {
        const jobs = deptJobs();
        const overdue = jobs.filter(j => j.is_overdue).length;
        const due30 = jobs.filter(j => !j.is_overdue && daysUntil(j.next_date) <= 30).length;
        const dueMonth = jobs.filter(j => { const d = daysUntil(j.next_date); return d >= 0 && d <= 31; }).length;
        let pending = state.reports.filter(r => r.status === 'PENDING');
        if (state.department) pending = pending.filter(r => reportDept(r) === state.department);
        const approved = state.reports.filter(r => r.status === 'APPROVED').length;
        return { total: jobs.length, overdue, due30, dueMonth, pending: pending.length, approved };
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
                        { label: 'Confirm Work Report', tag: 'B', action: "TVC_App.menuAction('hqConfirm')", badge: c.approved, badgeTone: 'green', feature: 'showHqConfirmPanel' },
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
                    { label: 'Approve Work Report', tag: 'B', action: "TVC_App.menuAction('approveReport')", badge: c.pending, badgeTone: 'amber', feature: 'showApprovalQueue' },
                ],
            },
            {
                key: 'monthly', tone: 'blue', icon: '🗓️', title: 'At first day of every month',
                flow: 'monthly',
                items: [
                    { label: 'Update Run Hour of Equipment', tag: 'C', action: "TVC_App.menuAction('runHour')" },
                    { label: 'Modify Maintenance Item', tag: 'B', action: "TVC_App.menuAction('modifyItem')", feature: 'showModifyOriginalPlan' },
                    { label: 'Update Original Plan', tag: 'B', action: "TVC_App.menuAction('originalPlan')", badge: c.dueMonth, badgeTone: 'blue' },
                    { label: 'Data Export', tag: 'C', action: "TVC_App.menuAction('export')", feature: 'showExportShip' },
                ],
            },
            {
                key: 'hq', tone: 'green', icon: '🛰️', title: 'When received data from HQ',
                items: [
                    { label: 'Data Import', tag: 'C', action: "TVC_App.menuAction('import')", feature: 'showImportShip' },
                    { label: 'Review Approved Reports', tag: 'B', action: "TVC_App.menuAction('hqConfirm')", badge: c.approved, badgeTone: 'green', feature: 'showHqConfirmPanel' },
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
        const original = items.find(it => it.label === 'Update Original Plan');
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
        const wrap = document.getElementById('fleetListPanel');
        const body = document.getElementById('fleetTableBody');
        if (!wrap || !body) return;
        const isHq = state.user && TVC_RBAC.isHqAccount(state.user);
        wrap.classList.toggle('hidden', !isHq);
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
        renderFleetList();
        renderMenuCards(document.getElementById('cmaxsCards'));
        renderSyncHistory();
    }

    function setHistTab(tab) {
        state.histTab = tab;
        document.querySelectorAll('.hist-tab').forEach(t => t.classList.toggle('active', t.dataset.htab === tab));
        renderSyncHistory();
    }

    /** 부서별 데이터 독립성: Import & Export History도 dept 기준으로 필터링 (Deck은 Deck만, Engine은 Engine만) */
    async function renderSyncHistory() {
        const body = document.getElementById('histTableBody');
        if (!body) return;
        let rows = [];
        try { rows = await TVC_Sync.getHistory(80); } catch (_) {}
        // Space 분리: HQ는 자신(HQ)이 수행한 Import/Export 기록만, 선박은 선박 기록만 표시
        if (state.space === 'HQ') rows = rows.filter(r => r.space === 'HQ');
        else rows = rows.filter(r => r.space !== 'HQ');
        if (state.department) rows = rows.filter(r => r.department === state.department);
        if (state.user && TVC_RBAC.isHqAccount(state.user) && state.selectedVesselId) {
            rows = rows.filter(r => !r.vessel_id || r.vessel_id === state.selectedVesselId);
        }
        if (state.histTab !== 'all') rows = rows.filter(r => r.type === state.histTab);
        if (!rows.length) { body.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center">No sync history for this department yet</td></tr>'; return; }
        body.innerHTML = rows.map((r, i) => {
            const stTone = r.status === 'SUCCESS' ? 'ok' : (r.status === 'FAILED' ? 'overdue' : 'warn');
            const dirIcon = r.type === 'EXPORT' ? '⬆' : '⬇';
            return `<tr>
                <td>${i + 1}</td><td>${esc(r.date || '')}</td>
                <td>${dirIcon} ${esc(r.type || '')}</td><td>${esc(r.direction || '')}</td>
                <td><span class="pill">${esc(r.department || '—')}</span></td>
                <td class="hist-file">${esc(r.filename || '—')}</td>
                <td style="text-align:right">${r.record_count ?? 0}</td>
                <td><span class="pill ${stTone}">${esc(r.status || '')}</span></td>
            </tr>`;
        }).join('');
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
                switchTab('original');
                break;
            case 'export': handleExport(); break;
            case 'import':
                pickDepartmentThen('Import할 부서를 선택하세요 (DECK / ENGINE)', (dept) => {
                    state._pendingImportDept = dept;
                    document.getElementById('importZip').click();
                });
                break;
            case 'backup': handleExport(); break;
            case 'password': alert('Password 변경은 관리자(A) 권한 콘솔에서 제공됩니다.'); break;
            case 'control': alert('Control(권한) 변경은 관리자(B) 승인 후 적용됩니다.'); break;
            default: break;
        }
    }

    // ── TAB: Original Plan ───────────────────────────────────────────
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

    function syncOriginalPlanUpdateUi() {
        const dept = getPlanLockDept();
        const locked = isOriginalPlanUpdateLocked(dept);
        const btn = document.getElementById('origUpdatePlanBtn');
        if (btn) {
            btn.disabled = locked;
            btn.title = locked ? getOriginalPlanLockMessage(dept) : '';
        }
        syncOriginalPlanItemUi();
        const msgEl = document.getElementById('origPlanCalcMsg');
        if (msgEl && locked && !state._planCalcMsg) {
            msgEl.textContent = getOriginalPlanLockMessage(dept);
            msgEl.classList.remove('hidden');
        }
    }

    function origPlanEditDeniedMessage() {
        if (state.user && TVC_RBAC.isShipAccount(state.user) && !TVC_RBAC.isApprover(state.user)) {
            return 'Captain / Chief Engineer만 Modify · Append · Delete 가능합니다.';
        }
        return getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan 항목을 편집할 수 없습니다.';
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

    function syncOriginalPlanGroupUi() {
        const bar = document.getElementById('origTreeActions');
        if (!bar) return;
        const canEdit = canEditOriginalPlanGroups();
        bar.classList.toggle('hidden', !canEdit);
        if (!canEdit) return;
        const node = selectedGroupNode();
        const addBtn = document.getElementById('origGroupAddBtn');
        const renBtn = document.getElementById('origGroupRenameBtn');
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
        if (!node) return alert('GROUP Tree에서 수정할 그룹을 선택하세요.');
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

    function syncOriginalPlanItemUi() {
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
        ['origModifyBtn', 'origAppendBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.disabled = !canEdit;
            el.title = tip;
        });
        const del = document.getElementById('origDeleteBtn');
        if (del) {
            del.disabled = !canEdit || !hasSel;
            del.title = !canEdit ? tip : (!hasSel ? '삭제할 행을 선택하세요' : '');
        }
        const mod = document.getElementById('origModifyBtn');
        if (mod) mod.disabled = !canEdit || !hasSel;
        if (mod) mod.title = !canEdit ? tip : (!hasSel ? '수정할 행을 선택하세요' : '');
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
        if (!state.selectedJobId) return alert('수정할 작업 행을 선택하세요.');
        const job = state.idx?.jobById.get(state.selectedJobId);
        if (!job) return alert('작업 항목을 찾을 수 없습니다.');
        state._origJobEditMode = 'modify';
        state._origJobEditId = job.id;
        renderOrigJobEditor('modify', job);
        showModal('origJobEditorModal');
    }

    function openOrigJobAppend() {
        if (!canEditOriginalPlanItems()) return alert(origPlanEditDeniedMessage());
        const ctx = defaultAppendContext();
        state._origJobEditMode = 'append';
        state._origJobEditId = null;
        renderOrigJobEditor('append', {
            department: ctx.dept,
            group: ctx.group,
            job_code: ctx.job_code,
            unit: 'M',
            period: 1,
        });
        showModal('origJobEditorModal');
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
        let pending = state.reports.filter(r => r.status === 'PENDING');
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
            syncOriginalPlanUpdateUi();
            renderMenuCards(document.getElementById('cmaxsCards'));
        } else {
            await revertPlanUpdateSnapshot();
            const pending = stats?.pendingReports || 0;
            state._planCalcMsg = pending
                ? `Original Plan Update 취소 — Due Date 원복. 미완료 Work Report ${pending}건을 Actual Plan에서 입력하세요.`
                : 'Original Plan Update 취소 — Run-hour Due Date 변경을 되돌렸습니다.';
            if (pending > 0) {
                switchTab('actual');
                setActualFilter('pending');
            }
        }
        state._planUpdateStats = null;
        if (ok || state.currentTab === 'original') renderOriginalPlan();
        if (state.currentTab === 'actual') renderActualPlan();
    }

    /** Menu → Update Original Plan: Run-hour 입력값으로 H 주기 Due Date 재계산 (CMAXS Calculation) */
    async function updateOriginalPlanFromRunHours() {
        if (!canPerformOriginalPlanUpdate()) {
            alert(getOriginalPlanLockMessage(getPlanLockDept()) || 'Original Plan Update는 현재 사용할 수 없습니다.');
            return;
        }
        switchTab('original');
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

        renderOriginalPlan();
        openPlanUpdateModal();
    }

    function renderOriginalPlan() {
        renderGroupTree('origTree');
        syncOriginalPlanGroupUi();
        mountJobSheet('origHead', 'origCount', 'origScroll', sheetIds('original'), 'vlOriginal', 'original');
        syncOriginalPlanUpdateUi();
        renderSidePanel();
        const msgEl = document.getElementById('origPlanCalcMsg');
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
        byDept.forEach((nodes, dept) => {
            html += `<div class="tree-dept">${esc(dept)}</div>`;
            nodes.forEach(n => {
                const emptyTag = n.isEmpty ? `<span class="tree-empty-tag" title="작업 항목 없음">0</span>` : '';
                const sel = state.selectedGroupKey === n.key ? ' selected' : '';
                html += `<div class="tree-node${sel}${n.isEmpty ? ' tree-node-empty' : ''}" onclick="TVC_App.selectGroup('${escAttr(n.key)}')"><span>${esc(n.label)}</span>${emptyTag}</div>`;
            });
        });
        root.innerHTML = html;
        const searchId = rootId === 'actTree' ? 'actTreeSearch'
            : (rootId === 'spareGroupTree' ? 'spareTreeSearch' : 'origTreeSearch');
        const searchEl = document.getElementById(searchId);
        if (searchEl && document.activeElement !== searchEl) searchEl.value = state.treeSearch || '';
    }

    // ── TAB: Actual Plan ─────────────────────────────────────────────
    function renderActualPlan() {
        renderGroupTree('actTree');
        updateActualFilterUI();
        syncActualPeriodInputs();
        syncBatchReportBtn();
        renderSpicsAlertBanner();
        mountJobSheet('actHead', 'actCount', 'actScroll', sheetIds('actual'), 'vlActual', 'actual');
        renderSidePanel();
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

    function pendingReportJobKeys() {
        let reps = state.reports.filter(r =>
            r.status === 'PENDING' || TVC_WorkReport.getJobItems(r).some(i => i.status === 'PENDING' || i.status === 'POSTPONED')
        );
        if (state.department) reps = reps.filter(r => reportDept(r) === state.department);
        const ids = new Set();
        const codes = new Set();
        reps.forEach(r => {
            TVC_WorkReport.getJobItems(r).forEach(item => {
                if (item.status === 'PENDING' || item.status === 'POSTPONED') {
                    if (item.maintenance_job_id) ids.add(item.maintenance_job_id);
                    if (item.job_code) codes.add(item.job_code);
                }
            });
        });
        return { ids, codes };
    }

    function batchSelectedCount() {
        return Object.keys(state.batchSelectedJobs).filter(id => state.batchSelectedJobs[id]).length;
    }

    function toggleBatchJob(jobId, on) {
        if (on) state.batchSelectedJobs[jobId] = true;
        else delete state.batchSelectedJobs[jobId];
        syncBatchReportBtn();
        if (state.vlActual) state.vlActual.refresh();
        const head = document.getElementById('actHead');
        if (head && state.currentTab === 'actual') {
            const selIds = sheetIds('actual');
            const allBatch = selIds.length > 0 && selIds.every(id => state.batchSelectedJobs[id]);
            const chk = head.querySelector('.c-chk input[type=checkbox]');
            if (chk) chk.checked = allBatch;
        }
    }

    function toggleBatchSelectAll(on) {
        sheetIds('actual').forEach(id => {
            if (on) state.batchSelectedJobs[id] = true;
            else delete state.batchSelectedJobs[id];
        });
        syncBatchReportBtn();
        renderActualPlan();
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
            workResult: 'Completed',
            troublePoint: '',
            outline: '',
            shipComments: '',
            handHours: '0',
            handMembers: '0',
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

    function initBatchDraft(jobIds) {
        const today = new Date().toISOString().slice(0, 10);
        state._batchDraft = { items: {} };
        jobIds.forEach(id => {
            const job = state.idx?.jobById.get(id);
            if (!job) return;
            state._batchDraft.items[id] = {
                form: defaultWrForm(today),
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
        const workType = tab === 'trouble' ? 'TROUBLE' : 'MAINTENANCE';

        const entries = state._batchJobIds.map(jobId => {
            const job = state.idx?.jobById.get(jobId);
            const item = draft.items[jobId];
            if (!job || !item) return null;
            const form = { ...item.form };
            const usedParts = (item.usedParts || [])
                .filter(p => Number(p.qty_used) > 0)
                .map(p => ({ spare_part_id: p.spare_part_id, qty_used: Number(p.qty_used) }));
            const description = tab === 'trouble'
                ? (form.troubleOutline || job.job_detail)
                : (form.outline || form.shipComments || job.job_detail);
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
                status: 'PENDING',
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
            state._batchMode = false;
            state._batchJobIds = [];
            state._batchDraft = null;
            resetAndCloseWorkReport();
            await refreshAll();
            alert(`Batch Work Report 저장 완료 (${entries.length} jobs, PENDING)`);
        } catch (e) {
            alert(e.message || e.code || 'Batch Report 저장 실패');
        }
    }

    function updateActualFilterUI() {
        const f = state.actualFilter;
        document.querySelectorAll('[data-afilter]').forEach(b => b.classList.toggle('active', b.dataset.afilter === f));
    }

    function renderQueues() {
        let pending = state.reports.filter(r => r.status === 'PENDING');
        let approved = state.reports.filter(r => r.status === 'APPROVED');
        // 책임자는 자기 부서 리포트만 승인 큐에 노출
        if (state.user && TVC_RBAC.isApprover(state.user)) {
            pending = pending.filter(r => reportDept(r) === state.user.department);
        } else if (state.department) {
            pending = pending.filter(r => reportDept(r) === state.department);
        }
        if (state.department && TVC_RBAC.isHqAccount(state.user)) {
            approved = approved.filter(r => reportDept(r) === state.department);
        }
        const elP = document.getElementById('chiefQueue');
        const elH = document.getElementById('hqQueue');
        if (elP) elP.innerHTML = pending.length ? pending.map(r => {
            const rd = reportDept(r);
            const canAp = state.user && TVC_RBAC.canApproveDepartment(state.user, rd);
            const dis = canAp ? '' : ' disabled title="타 부서 — 승인 불가"';
            return `<div class="queue-item"><strong>${esc(r.job_code)}</strong> <span class="q-dept">${esc(rd || '')}</span> — ${esc(reporterLabel(r.reporter_name))}
            <button class="btn-sm btn-green"${dis} onclick="TVC_App.doApprove('${r.id}')">✅ Approve</button></div>`;
        }).join('') : '<p class="muted">None</p>';
        if (elH) elH.innerHTML = approved.length ? approved.map(r => `
            <div class="queue-item"><strong>${esc(r.job_code)}</strong> <span class="q-dept">${esc(reportDept(r) || '')}</span>
            <input type="text" id="comment-${r.id}" placeholder="HQ comment">
            <button class="btn-sm btn-green" onclick="TVC_App.doConfirm('${r.id}')">🔒 Confirm</button></div>`).join('') : '<p class="muted">None</p>';
    }

    function sidePanelHostId() {
        return state.currentTab === 'original' ? 'origSidePanel' : 'sidePanel';
    }

    function renderSidePanel() {
        const panel = document.getElementById(sidePanelHostId());
        if (!panel) return;
        const isOrig = state.currentTab === 'original';
        const n = batchSelectedCount();
        const multi = isBatchMultiActive();
        const batchIds = batchSelectedJobIds();
        const batchCodesBar = !isOrig && multi
            ? `<div class="side-batch-codes">${batchIds.map(id => {
                const j = state.idx?.jobById.get(id);
                return `<span class="side-batch-code">${esc(j?.job_code || id)}</span>`;
            }).join('')}</div>`
            : '';
        const batchBtn = isOrig ? '' : `<button type="button" id="actBatchReportBtn" class="btn btn-sm btn-green side-batch-btn"${n < 2 ? ' disabled' : ''} onclick="TVC_App.openBatchReport()">📋 Batch Report${n >= 2 ? ` (${n})` : ''}</button>`;
        const reportInputDisabled = multi ? ' disabled title="2개 이상 선택 시 Batch Report를 사용하세요"' : '';
        const job = state.idx?.jobById.get(state.selectedJobId);
        if (!job) {
            panel.innerHTML = `${batchCodesBar}<p class="muted">Click a row to select · Double-click for Work Procedure</p>
                <div class="side-report-btns">${batchBtn}</div>`;
            return;
        }
        panel.innerHTML = `${batchCodesBar}<div class="side-job"><h4>${esc(job.job_code)}</h4>
            <p><strong>SORT-1:</strong> ${esc(job.item_sort1 || '—')}<br><strong>SORT-2:</strong> ${esc(job.item_sort2 || '—')}<br><strong>JOB DETAIL:</strong> ${esc(job.job_detail || '—')}</p>
            <button class="btn btn-sm" onclick="TVC_App.openWorkProcedure('${job.id}')">Work Procedure / History</button>
            <div class="side-report-btns">
                <button class="btn btn-sm btn-green"${reportInputDisabled} onclick="TVC_App.openWorkReport('${job.id}')">Report Input</button>
                ${batchBtn}
            </div></div>`;
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

    function workHistoryStatusLabel(report) {
        const f = wrReportForm(report);
        if (f.workResult) return f.workResult;
        if (report.status === 'POSTPONED') return 'Postponed';
        if (report.work_type === 'TROUBLE') return 'Trouble';
        return report.status || '';
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

    function isHistRowApprovable(entry) {
        const { report: r, item } = entry;
        if (!state.user || r.is_locked || r.status === 'CONFIRMED' || r.status === 'APPROVED') return false;
        if (item.status !== 'PENDING') return false;
        return TVC_RBAC.canApproveDepartment(state.user, reportDept(r));
    }

    function canModifyHistEntry(entry) {
        const r = entry?.report;
        if (!r) return false;
        return !r.is_locked && r.status !== 'CONFIRMED';
    }

    function canDeleteHistEntry(entry) {
        const r = entry?.report;
        if (!r || !state.user) return false;
        if (r.is_locked || r.status === 'CONFIRMED') return false;
        if (r.status === 'APPROVED' && !TVC_RBAC.isApprover(state.user)) return false;
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
        const canApprove = checkedIds.length > 0 && checkedIds.every(id => {
            const rep = state.reports.find(r => r.id === id);
            if (!rep) return false;
            const hasPending = TVC_WorkReport.getJobItems(rep).some(i => i.status === 'PENDING');
            if (!hasPending || rep.is_locked || rep.status === 'CONFIRMED' || rep.status === 'APPROVED') return false;
            return state.user && TVC_RBAC.canApproveDepartment(state.user, reportDept(rep));
        });
        const setDis = (id, dis) => {
            const el = document.getElementById(id);
            if (el) { if (dis) el.setAttribute('disabled', ''); else el.removeAttribute('disabled'); }
        };
        setDis('histBtnDetail', !entry);
        setDis('histBtnModify', !entry || !canModifyHistEntry(entry));
        setDis('histBtnDelete', !entry || !canDeleteHistEntry(entry));
        setDis('histBtnApprove', !canApprove);

        const approvable = workHistoryEntries().filter(isHistRowApprovable);
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

    function toggleHistCheck(rowKey, on) {
        state._histChecked = state._histChecked || {};
        if (on) state._histChecked[rowKey] = true;
        else delete state._histChecked[rowKey];
        renderWorkHistory();
    }

    function toggleHistSelectAll(on) {
        state._histChecked = state._histChecked || {};
        workHistoryEntries().filter(isHistRowApprovable).forEach(e => {
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
        if (!canModifyHistEntry(entry)) return alert('확정(CONFIRMED)된 리포트는 수정할 수 없습니다.');
        openWorkReportFromHistory(entry.report.id, entry.item.maintenance_job_id);
        modifyWorkReport();
    }

    async function histReportApproval() {
        const reportIds = getCheckedHistReportIds();
        if (!reportIds.length) return alert('승인할 항목의 체크박스(ㅁ)를 선택하세요.');
        const user = TVC_Auth.requirePermission(TVC_RBAC.Action.APPROVE_DAILY_REPORT);
        if (!user) return;

        for (const id of reportIds) {
            const rep = state.reports.find(r => r.id === id);
            if (!rep) return alert('리포트를 찾을 수 없습니다.');
            const hasPending = TVC_WorkReport.getJobItems(rep).some(i => i.status === 'PENDING');
            if (!hasPending) return alert(`${rep.job_code}: 승인할 수 없는 상태입니다.`);
            const dept = reportDept(rep);
            if (!TVC_RBAC.canApproveDepartment(user, dept)) {
                return alert(`타 부서(${dept || '?'}) 리포트는 승인할 수 없습니다: ${rep.job_code}`);
            }
        }
        if (!confirm(`${reportIds.length}건의 Work Report를 승인하시겠습니까?\n(재고 차감 · LAST DONE / NEXT DATE 갱신)`)) return;

        let ok = 0;
        for (const id of reportIds) {
            try {
                await TVC_Transaction.approveReport(user, id);
                ok++;
            } catch (e) {
                alert(`${id}: ${e.message || e.code || '승인 실패'}`);
                break;
            }
        }
        state._histChecked = {};
        await refreshAll();
        if (ok) alert(`${ok}건 승인 완료`);
    }

    async function histDeleteReport() {
        const entry = getSelectedHistEntry();
        if (!entry) return alert('Work History에서 항목을 선택하세요.');
        if (!canDeleteHistEntry(entry)) {
            if (entry.report.status === 'CONFIRMED' || entry.report.is_locked) {
                return alert('본사 확정(CONFIRMED)된 리포트는 삭제할 수 없습니다.');
            }
            return alert('승인 완료된 리포트는 Captain / Chief Engineer만 삭제할 수 있습니다.');
        }
        state._wrReportId = entry.report.id;
        state._wrBatchItemId = entry.item.maintenance_job_id;
        await deleteWorkReport();
    }

    /** Actual Plan에서 작성된 Work Report를 기반으로 이력 표시 */
    function renderWorkHistory() {
        const body = document.getElementById('historyBody');
        if (!body) return;
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
            const st = f.workResult || (item.status === 'POSTPONED' ? 'Postponed' : item.status || workHistoryStatusLabel(r));
            const shipComments = String(f.shipComments || '').trim();
            const companyComment = String(r.company_comment || '').trim();
            const rowKey = histRowKey(r.id, item.maintenance_job_id);
            const sel = state._histSelReportId === rowKey ? ' row-selected' : '';
            const batchTag = r.is_batch ? `<span class="pill ok" title="Batch report">B</span> ` : '';
            const entry = { report: r, item };
            const canCheck = isHistRowApprovable(entry);
            const checked = !!state._histChecked?.[rowKey];
            const chk = canCheck
                ? `<input type="checkbox" class="hist-chk-input"${checked ? ' checked' : ''} onclick="event.stopPropagation();TVC_App.toggleHistCheck('${escAttr(rowKey)}', this.checked)">`
                : `<input type="checkbox" disabled title="승인 불가">`;
            return `<tr class="hist-row${sel}" onclick="TVC_App.selectHistRow('${escAttr(rowKey)}', event)" ondblclick="TVC_App.openWorkReportFromHistory('${escAttr(r.id)}','${escAttr(item.maintenance_job_id)}')">
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

    function batchSelectedSpareIds() {
        return Object.keys(state.batchSelectedSpares || {}).filter(id => state.batchSelectedSpares[id]);
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
        if (!state.batchSelectedSpares) state.batchSelectedSpares = {};
        if (checked) state.batchSelectedSpares[spareId] = true;
        else delete state.batchSelectedSpares[spareId];
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
        if (state.vlOriginal) state.vlOriginal.refresh();
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
                const st = f.workResult || (item.status === 'POSTPONED' ? 'Postponed' : item.status || workHistoryStatusLabel(r));
                const desc = item.description || r.description || '—';
                const batchTag = r.is_batch ? ' <span class="pill ok" title="Batch report">B</span>' : '';
                return `<tr class="wp-hist-row" ondblclick="TVC_App.closeModal('workProcedureModal');TVC_App.openWorkReportFromHistory('${escAttr(r.id)}','${escAttr(item.maintenance_job_id)}')" title="Double-click to open Work Report">
                <td>${esc(dt)}</td>
                <td><span class="pill ${r.status === 'CONFIRMED' || r.status === 'APPROVED' ? 'ok' : 'warn'}">${esc(st)}</span>${batchTag}</td>
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
                <button class="btn btn-green"${isBatchMultiActive() ? ' disabled title="2개 이상 선택 시 Batch Report를 사용하세요"' : ''} onclick="TVC_App.closeModal('workProcedureModal');TVC_App.openWorkReport('${job.id}')">Report Input</button>
                <button class="btn" onclick="TVC_App.closeModal('workProcedureModal')">Close</button>
            </div>`;
    }

    // ── CMAXS Work Report (3 tabs) ───────────────────────────────────
    const WR_TABS = {
        repair: 'Repair & Maintenance',
        trouble: 'Trouble',
        postpone: 'Postpone',
    };

    /** Original / Actual Plan → Report Input: CMAXS 스타일 Work Report 화면 */
    function openWorkReport(jobId, tab) {
        if (isBatchMultiActive()) {
            return alert('2개 이상 선택된 경우 Batch Report를 사용하세요.');
        }
        const job = state.idx.jobById.get(jobId);
        if (!job) return;
        if (state.user.department && state.user.department !== job.department) {
            return alert('타 부서 항목은 보고할 수 없습니다.');
        }
        state._batchMode = false;
        state._batchJobIds = [];
        state._batchDraft = null;
        if (state._wrJobId !== jobId) {
            state._wrForm = {};
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
        if (state.vlOriginal) state.vlOriginal.refresh();
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
        state._wrTab = rep.work_type === 'TROUBLE' ? 'trouble'
            : (rep.work_type === 'POSTPONE' ? 'postpone' : 'repair');
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
        const isApproved = rep && rep.status === 'APPROVED';
        const isConfirmed = rep && (rep.status === 'CONFIRMED' || rep.is_locked);

        if (isConfirmed) {
            return alert('본사 확정(CONFIRMED)된 리포트는 삭제할 수 없습니다.');
        }
        if (isApproved && !TVC_RBAC.isApprover(user)) {
            return alert('승인 완료된 리포트는 Captain / Chief Engineer만 삭제할 수 있습니다.');
        }

        const msg = isApproved
            ? '승인 완료된 Work Report를 삭제합니다.\n\n차감된 재고와 LAST DONE / NEXT DATE가 승인 이전 상태로 자동 복구됩니다. 계속하시겠습니까?'
            : '이 Work Report를 삭제하시겠습니까? 되돌릴 수 없습니다.';
        if (!confirm(msg)) return;

        try {
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
            alert(isApproved
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
        if (state._batchMode && tab !== 'repair' && tab !== 'trouble') return;
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
        host.querySelectorAll('[data-wr-spare][data-wr-field="qty"]').forEach(el => {
            const id = el.dataset.wrSpare;
            const row = (state._wrUsedParts || []).find(p => p.spare_part_id === id);
            if (row) row.qty_used = Number(el.value) || 0;
        });
        const searchEl = document.getElementById('wrSpareSearch');
        if (searchEl) state._wrSpareSearch = searchEl.value;
    }

    function wrSpareSearchResults() {
        const q = (state._wrSpareSearch || '').trim().toLowerCase();
        if (q.length < 1) return [];
        const used = new Set((state._wrUsedParts || []).map(p => p.spare_part_id));
        return (state.spares || []).filter(s => {
            if (used.has(s.id)) return false;
            const canon = TVC_SpareSchema.fromRow(s);
            const hay = [
                canon.makerPartNo, s.part_no, canon.name, s.name,
                canon.universalItemCode, s.universal_code, s.location, s.category,
            ].join(' ').toLowerCase();
            return hay.includes(q);
        }).slice(0, 25);
    }

    function buildWrSpareHitsHtml() {
        const results = wrSpareSearchResults();
        const searchVal = (state._wrSpareSearch || '').trim();
        if (!searchVal) return '';
        if (!results.length) return '<p class="muted wr-spare-empty">검색 결과 없음</p>';
        const resultRows = results.map(s => {
            const canon = TVC_SpareSchema.fromRow(s);
            const pn = canon.makerPartNo || s.part_no || '—';
            const stk = TVC_Inventory.currentStock(s);
            return `<tr class="wr-spare-hit" onclick="TVC_App.addWrSparePart('${escAttr(s.id)}')">
                <td><strong>${esc(pn)}</strong></td>
                <td>${esc(canon.universalItemCode || s.universal_code || '—')}</td>
                <td>${esc(canon.name || s.name)}</td>
                <td style="text-align:center">${stk}</td>
                <td><span class="pill ok">+ Add</span></td>
            </tr>`;
        }).join('');
        return `<div class="wr-table-wrap wr-spare-hits">
            <table class="wr-table"><thead><tr>
                <th>Part No</th><th>Universal Code</th><th>Description</th><th>Stock</th><th></th>
            </tr></thead><tbody>${resultRows}</tbody></table>
        </div>`;
    }

    function refreshWrSpareHits() {
        const wrap = document.getElementById('wrSpareHitsWrap');
        if (wrap) wrap.innerHTML = buildWrSpareHitsHtml();
    }

    function onWrSpareSearchInput(v) {
        state._wrSpareSearch = v;
        clearTimeout(_wrSpareSearchT);
        _wrSpareSearchT = setTimeout(refreshWrSpareHits, 120);
    }

    function setWrSpareSearch(v) {
        state._wrSpareSearch = v;
        refreshWrSpareHits();
    }

    function addWrSparePart(spareId) {
        captureWorkReportUsedParts();
        const spare = (state.spares || []).find(s => s.id === spareId);
        if (!spare) return;
        if ((state._wrUsedParts || []).some(p => p.spare_part_id === spareId)) return;
        const canon = TVC_SpareSchema.fromRow(spare);
        state._wrUsedParts = state._wrUsedParts || [];
        state._wrUsedParts.push({
            spare_part_id: spareId,
            part_no: canon.makerPartNo || spare.part_no,
            name: canon.name || spare.name,
            universal_code: canon.universalItemCode || spare.universal_code || '',
            qty_on_hand: TVC_Inventory.currentStock(spare),
            qty_used: 1,
        });
        state._wrSpareSearch = '';
        renderWorkReportModal();
    }

    function removeWrSparePart(spareId) {
        captureWorkReportUsedParts();
        state._wrUsedParts = (state._wrUsedParts || []).filter(p => p.spare_part_id !== spareId);
        renderWorkReportModal();
    }

    function renderWrPage2Body(ro) {
        const lines = state._wrUsedParts || [];
        const searchVal = esc(state._wrSpareSearch || '');

        const usedRows = lines.length ? lines.map(p => {
            const low = p.qty_on_hand != null && p.qty_used > p.qty_on_hand;
            return `<tr>
                <td><strong>${esc(p.part_no)}</strong></td>
                <td>${esc(p.universal_code || '—')}</td>
                <td>${esc(p.name)}</td>
                <td style="text-align:center">${p.qty_on_hand != null ? p.qty_on_hand : '—'}</td>
                <td style="text-align:center">
                    <input type="number" min="0" step="1" class="wr-spare-qty" data-wr-spare="${escAttr(p.spare_part_id)}" data-wr-field="qty"
                        value="${esc(p.qty_used)}" ${ro ? 'disabled' : ''}>
                </td>
                <td>${low ? '<span class="pill overdue">LOW</span>' : ''}</td>
                <td>${ro ? '' : `<button type="button" class="btn btn-sm btn-red" onclick="TVC_App.removeWrSparePart('${escAttr(p.spare_part_id)}')">×</button>`}</td>
            </tr>`;
        }).join('') : `<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">소모 부품 없음 — 아래 검색에서 SPARE 항목 추가</td></tr>`;

        return `
            <div class="wr-spare-page">
                <p class="wr-spare-note">📦 승인(Approved) 시 기록된 수량만큼 SPARE 재고에서 자동 차감됩니다.</p>
                ${!ro ? `<div class="wr-spare-search">
                    <label class="wr-label">SPARE 검색 (Part No / Name / Universal Code)</label>
                    <input type="search" id="wrSpareSearch" class="wr-spare-search-input" placeholder="예: 01-001, Stud, U_ENG_001"
                        value="${searchVal}" oninput="TVC_App.onWrSpareSearchInput(this.value)">
                    <div id="wrSpareHitsWrap">${buildWrSpareHitsHtml()}</div>
                </div>` : ''}
                <label class="wr-label">Consumed Spare Parts (Page 2)</label>
                <div class="wr-table-wrap wr-spare-used-wrap">
                    <table class="wr-table wr-spare-used">
                        <thead><tr>
                            <th>Part No</th><th>Universal Code</th><th>Description</th>
                            <th>On Hand</th><th>Qty Used</th><th></th><th></th>
                        </tr></thead>
                        <tbody>${usedRows}</tbody>
                    </table>
                </div>
            </div>`;
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
            ? `<button type="button" class="btn btn-sm wr-attach-btn" onclick="document.getElementById('${inputId}').click()">📎 ${esc(label)}</button>
               <input type="file" id="${inputId}" class="hidden" multiple onchange="TVC_App.uploadWrAttachment('${kind}')">`
            : '';
        return `
            <div class="wr-attach-block">
                ${uploadBtn}
                <ul class="wr-attach-list">${items || '<li class="muted wr-attach-empty">None</li>'}</ul>
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
        const machinery = job.group || job.item_sort1 || '—';
        const ro = false;
        const tab = state._wrTab || 'repair';
        const reportedByName = TVC_RBAC.getRankLabel(state.user);
        const itemText = [job.item_sort1, job.item_sort2, job.job_detail].filter(Boolean).join('  |  ') || '—';
        const showPages = tab === 'repair' || tab === 'trouble';
        const canEditShipAttach = true;

        const batchJobTabs = `
            <div class="batch-wr-jobs">
                ${state._batchJobIds.map(id => {
                    const j = state.idx?.jobById.get(id);
                    return `<span class="batch-wr-job-tag">${esc(j?.job_code || id)}</span>`;
                }).join('')}
            </div>`;

        const tabBtns = ['repair', 'trouble'].map(k =>
            `<label class="wr-radio${tab === k ? ' active' : ''}">
                <input type="radio" name="wrTab" ${tab === k ? 'checked' : ''} onclick="TVC_App.setWorkReportTab('${k}')"> ${esc(WR_TABS[k])}
            </label>`).join('');

        const pageTabs = showPages ? `
            <div class="wr-pagetabs">
                <button type="button" class="wr-pagetab${state._wrPage === '1' ? ' active' : ''}" onclick="TVC_App.setWorkReportPage('1')">Page 1</button>
                <button type="button" class="wr-pagetab${state._wrPage === '2' ? ' active' : ''}" onclick="TVC_App.setWorkReportPage('2')">Page 2</button>
            </div>` : '';
        const pageTabsBar = showPages ? `<div class="wr-pagetabs-bar">${pageTabs}</div>` : '';

        const pickerHtml = state._batchJobPickerOpen ? buildBatchJobPickerHtml() : '';

        const headHtml = `
            <div class="wr-form">
                <div class="wr-row">
                    <div class="wr-fld wr-in-reporter"><label>Reported by</label><input class="wr-ro" value="${esc(reportedByName)}" readonly></div>
                    <div class="wr-fld wr-chk wr-in-date"><label class="wr-chk-inline"><input type="checkbox" disabled> Approved by</label><input class="wr-ro" value="" readonly></div>
                    <div class="wr-fld wr-chk wr-in-date"><label class="wr-chk-inline"><input type="checkbox" disabled> Confirmed by</label><input class="wr-ro" value="" readonly></div>
                </div>
                <div class="wr-row">
                    <div class="wr-fld wr-in-code"><label>Code</label>
                        <button type="button" class="batch-wr-scroll-field" onclick="TVC_App.openBatchJobPicker()">${esc(job.job_code)}</button>
                    </div>
                    <div class="wr-fld wr-in-pic"><label>PIC</label><input class="wr-ro" value="${esc(job.pic || '—')}" readonly></div>
                    <div class="wr-fld wr-in-type"><label>TYPE</label><input class="wr-ro" value="${esc(job.unit || '—')}" readonly></div>
                    <div class="wr-fld wr-in-date"><label>Reported Date</label><input type="date" data-wf="reportDate" value="${esc(wf('reportDate', today))}"></div>
                    <div class="wr-fld wr-in-date"><label>Work Date</label><input type="date" data-wf="workDate" value="${esc(wf('workDate', today))}"></div>
                </div>
                <div class="wr-row">
                    <div class="wr-fld wr-grow"><label>Item (SORT-1 / SORT-2 / JOB DETAIL)</label>
                        <button type="button" class="batch-wr-scroll-field batch-wr-scroll-item" onclick="TVC_App.openBatchJobPicker()">${esc(itemText)}</button>
                    </div>
                </div>
            </div>
            ${pickerHtml}`;

        let body = '';
        if (showPages && state._wrPage === '2') {
            body = renderWrPage2Body(ro);
        } else if (tab === 'trouble') {
            body = `
                <div class="wr-form">
                    <div class="wr-row">
                        <div class="wr-fld wr-in-sm"><label>File No.</label><input data-wf="fileNo" value="${esc(wf('fileNo'))}"></div>
                        <div class="wr-fld wr-in-voy"><label>Voy. No.</label><input data-wf="voyNo" value="${esc(wf('voyNo'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Total Run Hrs</label><input type="number" data-wf="runHrs" value="${esc(wf('runHrs', '0'))}"></div>
                        <div class="wr-fld wr-grow"><label>Machinery Name</label><input class="wr-ro" value="${esc(machinery)}" readonly></div>
                    </div>
                    <div class="wr-row">
                        <div class="wr-fld wr-in-num"><label>M/E Stop Hours</label><input type="number" data-wf="meStop" value="${esc(wf('meStop', '0'))}"></div>
                        <div class="wr-fld wr-in-num"><label>M/E Speed Reduction Hours</label><input type="number" data-wf="meSpeedRed" value="${esc(wf('meSpeedRed', '0'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Delay Hours for Repair</label><input type="number" data-wf="delayHours" value="${esc(wf('delayHours', '0'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Cargo Work Delay Hours</label><input type="number" data-wf="cargoDelay" value="${esc(wf('cargoDelay', '0'))}"></div>
                    </div>
                    <div class="wr-row">
                        <div class="wr-fld wr-grow"><label>Reason</label><input data-wf="reason" value="${esc(wf('reason'))}"></div>
                    </div>
                </div>
                <div class="wr-block"><span class="wr-label">Outline of Trouble</span><textarea class="wr-area" data-wf="troubleOutline" rows="2">${esc(wf('troubleOutline'))}</textarea></div>
                <div class="wr-block"><span class="wr-label">Presumed Cause</span><textarea class="wr-area" data-wf="presumedCause" rows="2">${esc(wf('presumedCause'))}</textarea></div>
                <div class="wr-block"><span class="wr-label">Countermeasures &amp; Disposal</span><textarea class="wr-area" data-wf="countermeasures" rows="2">${esc(wf('countermeasures'))}</textarea></div>`;
        } else {
            body = `
                <div class="wr-form">
                    <div class="wr-row">
                        <div class="wr-fld wr-in-sm"><label>File No.</label><input data-wf="fileNo" value="${esc(wf('fileNo'))}"></div>
                        <div class="wr-fld wr-in-voy"><label>Voy. No.</label><input data-wf="voyNo" value="${esc(wf('voyNo'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Total Run Hrs</label><input type="number" data-wf="runHrs" value="${esc(wf('runHrs', '0'))}"></div>
                        <div class="wr-fld wr-in-sm"><label>Place</label><input data-wf="place" value="${esc(wf('place'))}"></div>
                    </div>
                    <div class="wr-row">
                        <div class="wr-fld wr-grow"><label>Machinery Name</label><input class="wr-ro" value="${esc(machinery)}" readonly></div>
                        <div class="wr-fld wr-in-result"><label>Work Result</label>
                            <select data-wf="workResult">
                                ${['', 'Completed', 'In Progress', 'Pending', 'Postponed'].map(o => `<option ${wf('workResult') === o ? 'selected' : ''}>${o}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="wr-row">
                        <div class="wr-fld wr-grow"><label>Trouble Parts (Maker / Model)</label><input data-wf="troubleParts" value="${esc(wf('troubleParts'))}"></div>
                        <div class="wr-fld wr-in-sm"><label>Trouble Point</label><input data-wf="troublePoint" value="${esc(wf('troublePoint'))}"></div>
                    </div>
                </div>
                <div class="wr-stack"><span class="wr-label">Outline of Repair &amp; Maintenance</span><textarea class="wr-area" data-wf="outline" rows="2">${esc(wf('outline'))}</textarea></div>
                <div class="wr-stack"><span class="wr-label">Ship's Comments &amp; Desired Articles</span><textarea class="wr-area" data-wf="shipComments" rows="2">${esc(wf('shipComments'))}</textarea></div>
                ${renderWrAttachmentBlock('ship', { canUpload: canEditShipAttach })}
                <div class="wr-form">
                    <div class="wr-row">
                        <div class="wr-fld wr-in-num"><label>Ship's Hand Working Hours</label><input type="number" data-wf="handHours" value="${esc(wf('handHours', '0'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Ship's Hand Nos Working Member</label><input type="number" data-wf="handMembers" value="${esc(wf('handMembers', '0'))}"></div>
                        <div class="wr-fld wr-chkline"><label><input type="checkbox" data-wf="allPendingCleared" ${wf('allPendingCleared') ? 'checked' : ''}> All Pending Cleared</label></div>
                        <div class="wr-fld wr-chkline"><label><input type="checkbox" data-wf="dockingRepair" ${wf('dockingRepair') ? 'checked' : ''}> Docking Repair</label></div>
                        <div class="wr-fld wr-chkline"><label><input type="checkbox" data-wf="pendingForRepair" ${wf('pendingForRepair') ? 'checked' : ''}> Pending for Repair</label></div>
                    </div>
                </div>
                <div class="wr-stack"><span class="wr-label">Company's Comments</span><textarea class="wr-area wr-ro" rows="2" readonly placeholder="HQ 전용 (Confirm 시 입력)"></textarea></div>
                ${renderWrAttachmentBlock('company', { canUpload: false })}`;
        }

        const actionsHtml = `
            <button class="btn btn-green" onclick="TVC_App.saveBatchReport()">💾 Save Batch Report</button>
            <button class="btn" onclick="TVC_App.printWorkReport()">🖨 Print</button>
            <button class="btn" onclick="TVC_App.closeBatchReport()">Cancel</button>`;

        host.innerHTML = `
            <div class="wr-titlebar">Batch Work Report (${state._batchJobIds.length} jobs)</div>
            ${batchJobTabs}
            <div class="wr-tabsel">${tabBtns}</div>
            ${pageTabsBar}
            <div class="wr-page tone-${tab}">
                ${headHtml}
                ${body}
            </div>
            <div class="modal-actions wr-actions">${actionsHtml}</div>`;
    }

    function renderWorkReportModal() {
        const host = document.getElementById('workReportBody');
        if (!host) return;
        if (state._batchMode) return renderBatchWorkReportModal(host);
        const job = state.idx?.jobById.get(state._wrJobId);
        if (!job) return;
        const today = new Date().toISOString().slice(0, 10);
        const machinery = job.group || job.item_sort1 || '—';
        const ro = !!state._wrReadonly;
        const tabBtns = Object.entries(WR_TABS).map(([k, label]) =>
            `<label class="wr-radio${state._wrTab === k ? ' active' : ''}">
                <input type="radio" name="wrTab" ${state._wrTab === k ? 'checked' : ''} onclick="TVC_App.setWorkReportTab('${k}')"> ${esc(label)}
            </label>`).join('');

        // 승인/확정 워크플로 — Work History에서 리포트를 열었을 때만 활성
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const isRepApproved = !!rep && (rep.status === 'APPROVED' || rep.status === 'CONFIRMED');
        const isRepConfirmed = !!rep && rep.status === 'CONFIRMED';
        const canApproveNow = !!rep && rep.status === 'PENDING' && TVC_RBAC.canApproveDepartment(state.user, job.department);
        const canConfirmNow = !!rep && rep.status === 'APPROVED' && TVC_RBAC.can(state.user, TVC_RBAC.Action.CONFIRM_REPORT);
        const reportedByName = rep ? reporterLabel(rep.reporter_name) : TVC_RBAC.getRankLabel(state.user);
        const approvedByVal = isRepApproved ? (rep.approved_at || '').slice(0, 10) : '';
        const confirmedByVal = isRepConfirmed ? (rep.confirmed_at || '').slice(0, 10) : '';
        const canEditShipAttach = !ro && (!rep || rep.status === 'PENDING' || rep.status === 'POSTPONED');
        const canEditCompanyAttach = !ro && !!canConfirmNow;

        const headHtml = `
            <div class="wr-form">
                <div class="wr-row">
                    <div class="wr-fld wr-in-reporter"><label>Reported by</label><input class="wr-ro" value="${esc(reportedByName)}" readonly></div>
                    <div class="wr-fld wr-chk wr-in-date${canApproveNow ? ' wr-chk-active' : ''}"><label class="wr-chk-inline"><input type="checkbox" id="wrApprovedBy" ${isRepApproved ? 'checked' : ''} ${canApproveNow ? '' : 'disabled'}> Approved by</label><input class="wr-ro" value="${esc(approvedByVal)}" readonly></div>
                    <div class="wr-fld wr-chk wr-in-date${canConfirmNow ? ' wr-chk-active' : ''}"><label class="wr-chk-inline"><input type="checkbox" id="wrConfirmedBy" ${isRepConfirmed ? 'checked' : ''} ${canConfirmNow ? '' : 'disabled'}> Confirmed by</label><input class="wr-ro" value="${esc(confirmedByVal)}" readonly></div>
                </div>
                <div class="wr-row">
                    <div class="wr-fld wr-in-code"><label>Code</label><input class="wr-ro" value="${esc(job.job_code)}" readonly></div>
                    <div class="wr-fld wr-in-pic"><label>PIC</label><input class="wr-ro" value="${esc(job.pic || '—')}" readonly></div>
                    <div class="wr-fld wr-in-type"><label>TYPE</label><input class="wr-ro" value="${esc(job.unit || '—')}" readonly></div>
                    <div class="wr-fld wr-in-date"><label>Reported Date</label><input type="date" data-wf="reportDate" value="${esc(wf('reportDate', today))}"></div>
                    <div class="wr-fld wr-in-date"><label>Work Date</label><input type="date" data-wf="workDate" value="${esc(wf('workDate', today))}"></div>
                </div>
                <div class="wr-row">
                    <div class="wr-fld wr-grow"><label>Item (SORT-1 / SORT-2 / JOB DETAIL)</label><input class="wr-ro" value="${esc([job.item_sort1, job.item_sort2, job.job_detail].filter(Boolean).join('  |  ') || '—')}" readonly></div>
                </div>
            </div>`;

        let body = '';
        const showPages = state._wrTab === 'repair' || state._wrTab === 'trouble';
        const pageTabs = showPages ? `
            <div class="wr-pagetabs">
                <button type="button" class="wr-pagetab${state._wrPage === '1' ? ' active' : ''}" onclick="TVC_App.setWorkReportPage('1')">Page 1</button>
                <button type="button" class="wr-pagetab${state._wrPage === '2' ? ' active' : ''}" onclick="TVC_App.setWorkReportPage('2')">Page 2</button>
            </div>` : '';
        const pageTabsBar = showPages ? `<div class="wr-pagetabs-bar">${pageTabs}</div>` : '';

        if (showPages && state._wrPage === '2') {
            body = renderWrPage2Body(ro);
        } else if (state._wrTab === 'repair') {
            body = `
                <div class="wr-form">
                    <div class="wr-row">
                        <div class="wr-fld wr-in-sm"><label>File No.</label><input data-wf="fileNo" value="${esc(wf('fileNo'))}"></div>
                        <div class="wr-fld wr-in-voy"><label>Voy. No.</label><input data-wf="voyNo" value="${esc(wf('voyNo'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Total Run Hrs</label><input type="number" data-wf="runHrs" value="${esc(wf('runHrs', '0'))}"></div>
                        <div class="wr-fld wr-in-sm"><label>Place</label><input data-wf="place" value="${esc(wf('place'))}"></div>
                    </div>
                    <div class="wr-row">
                        <div class="wr-fld wr-grow"><label>Machinery Name</label><input class="wr-ro" value="${esc(machinery)}" readonly></div>
                        <div class="wr-fld wr-in-result"><label>Work Result</label>
                            <select data-wf="workResult">
                                ${['', 'Completed', 'In Progress', 'Pending', 'Postponed'].map(o => `<option ${wf('workResult') === o ? 'selected' : ''}>${o}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="wr-row">
                        <div class="wr-fld wr-grow"><label>Trouble Parts (Maker / Model)</label><input data-wf="troubleParts" value="${esc(wf('troubleParts'))}"></div>
                        <div class="wr-fld wr-in-sm"><label>Trouble Point</label><input data-wf="troublePoint" value="${esc(wf('troublePoint'))}"></div>
                    </div>
                </div>
                <div class="wr-stack"><span class="wr-label">Outline of Repair &amp; Maintenance</span><textarea class="wr-area" data-wf="outline" rows="2">${esc(wf('outline'))}</textarea></div>
                <div class="wr-stack"><span class="wr-label">Ship's Comments &amp; Desired Articles</span><textarea class="wr-area" data-wf="shipComments" rows="2">${esc(wf('shipComments'))}</textarea></div>
                ${renderWrAttachmentBlock('ship', { canUpload: canEditShipAttach })}
                <div class="wr-form">
                    <div class="wr-row">
                        <div class="wr-fld wr-in-num"><label>Ship's Hand Working Hours</label><input type="number" data-wf="handHours" value="${esc(wf('handHours', '0'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Ship's Hand Nos Working Member</label><input type="number" data-wf="handMembers" value="${esc(wf('handMembers', '0'))}"></div>
                        <div class="wr-fld wr-chkline"><label><input type="checkbox" data-wf="allPendingCleared" ${wf('allPendingCleared') ? 'checked' : ''}> All Pending Cleared</label></div>
                        <div class="wr-fld wr-chkline"><label><input type="checkbox" data-wf="dockingRepair" ${wf('dockingRepair') ? 'checked' : ''}> Docking Repair</label></div>
                        <div class="wr-fld wr-chkline"><label><input type="checkbox" data-wf="pendingForRepair" ${wf('pendingForRepair') ? 'checked' : ''}> Pending for Repair</label></div>
                    </div>
                </div>
                <div class="wr-stack"><span class="wr-label">Company's Comments</span><textarea class="wr-area wr-ro" rows="2" readonly placeholder="HQ 전용 (Confirm 시 입력)">${esc(rep?.company_comment || '')}</textarea></div>
                ${renderWrAttachmentBlock('company', { canUpload: canEditCompanyAttach })}`;
        } else if (state._wrTab === 'trouble') {
            body = `
                <div class="wr-form">
                    <div class="wr-row">
                        <div class="wr-fld wr-in-sm"><label>File No.</label><input data-wf="fileNo" value="${esc(wf('fileNo'))}"></div>
                        <div class="wr-fld wr-in-voy"><label>Voy. No.</label><input data-wf="voyNo" value="${esc(wf('voyNo'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Total Run Hrs</label><input type="number" data-wf="runHrs" value="${esc(wf('runHrs', '0'))}"></div>
                        <div class="wr-fld wr-grow"><label>Machinery Name</label><input class="wr-ro" value="${esc(machinery)}" readonly></div>
                    </div>
                    <div class="wr-row">
                        <div class="wr-fld wr-in-num"><label>M/E Stop Hours</label><input type="number" data-wf="meStop" value="${esc(wf('meStop', '0'))}"></div>
                        <div class="wr-fld wr-in-num"><label>M/E Speed Reduction Hours</label><input type="number" data-wf="meSpeedRed" value="${esc(wf('meSpeedRed', '0'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Delay Hours for Repair</label><input type="number" data-wf="delayHours" value="${esc(wf('delayHours', '0'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Cargo Work Delay Hours</label><input type="number" data-wf="cargoDelay" value="${esc(wf('cargoDelay', '0'))}"></div>
                    </div>
                    <div class="wr-row">
                        <div class="wr-fld wr-grow"><label>Reason</label><input data-wf="reason" value="${esc(wf('reason'))}"></div>
                    </div>
                </div>
                <div class="wr-block"><span class="wr-label">Outline of Trouble</span><textarea class="wr-area" data-wf="troubleOutline" rows="2">${esc(wf('troubleOutline'))}</textarea></div>
                <div class="wr-block"><span class="wr-label">Presumed Cause</span><textarea class="wr-area" data-wf="presumedCause" rows="2">${esc(wf('presumedCause'))}</textarea></div>
                <div class="wr-block"><span class="wr-label">Countermeasures &amp; Disposal</span><textarea class="wr-area" data-wf="countermeasures" rows="2">${esc(wf('countermeasures'))}</textarea></div>`;
        } else {
            body = `
                <div class="wr-postpone-note">📌 If you need to postpone the work due date, input <b>[Postpone Date]</b>.</div>
                <div class="wr-form">
                    <div class="wr-row">
                        <div class="wr-fld wr-in-sm"><label>File No.</label><input data-wf="fileNo" value="${esc(wf('fileNo'))}"></div>
                        <div class="wr-fld wr-in-voy"><label>Voy. No.</label><input data-wf="voyNo" value="${esc(wf('voyNo'))}"></div>
                        <div class="wr-fld wr-in-num"><label>Total Run Hrs</label><input type="number" data-wf="runHrs" value="${esc(wf('runHrs', '0'))}"></div>
                        <div class="wr-fld wr-in-date"><label>Original Due Date</label><input class="wr-ro" value="${esc(job.next_date || '—')}" readonly></div>
                        <div class="wr-fld wr-in-date wr-postpone-date"><label>Postpone Date</label><input type="date" data-wf="postponeDate" value="${esc(wf('postponeDate'))}"></div>
                    </div>
                </div>
                <div class="wr-stack"><span class="wr-label">Ship's Comments &amp; Desired Articles</span><textarea class="wr-area" data-wf="shipComments" rows="2">${esc(wf('shipComments'))}</textarea></div>
                <div class="wr-stack"><span class="wr-label">Company's Comments</span><textarea class="wr-area wr-ro" rows="2" readonly placeholder="HQ 전용"></textarea></div>`;
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
    }

    /** Work Report 창 닫기 — Approved/Confirmed 체크 시 승인·확정 처리 후 닫기 */
    async function closeWorkReport() {
        if (state._batchMode) return closeBatchReport();
        const rep = state._wrReportId ? state.reports.find(r => r.id === state._wrReportId) : null;
        const apCb = document.getElementById('wrApprovedBy');
        const cfCb = document.getElementById('wrConfirmedBy');
        const user = TVC_Auth.getCurrentUser();

        if (user && rep && rep.status === 'PENDING' && apCb && !apCb.disabled && apCb.checked) {
            try {
                await TVC_Transaction.approveReport(user, rep.id);
                resetAndCloseWorkReport();
                await refreshAll();
                return alert(`${rep.job_code} 리포트가 승인되었습니다. (재고 차감 · LAST DONE / NEXT DATE 갱신)`);
            } catch (e) { return alert(e.message || e.code); }
        }
        if (user && rep && rep.status === 'APPROVED' && cfCb && !cfCb.disabled && cfCb.checked) {
            try {
                await TVC_Transaction.confirmReport(user, rep.id, '');
                resetAndCloseWorkReport();
                await refreshAll();
                return alert(`${rep.job_code} 리포트가 본사 확정(CONFIRMED)되었습니다.`);
            } catch (e) { return alert(e.message || e.code); }
        }
        resetAndCloseWorkReport();
    }

    function resetAndCloseWorkReport() {
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

        if (tab === 'postpone' && !form.postponeDate) {
            return alert('Postpone Date를 입력하세요.');
        }

        const workType = tab === 'trouble' ? 'TROUBLE' : (tab === 'postpone' ? 'POSTPONE' : 'MAINTENANCE');
        const status = tab === 'postpone' ? 'POSTPONED' : 'PENDING';
        const description = tab === 'trouble'
            ? (form.troubleOutline || job.job_detail)
            : (form.outline || form.shipComments || job.job_detail);

        const payload = {
            workType, status, form,
            description,
            reportDate: form.reportDate,
            workDate: form.workDate,
            postponeDate: form.postponeDate || null,
            troubleDetail: tab === 'trouble' ? (form.troubleOutline || null) : null,
        };

        const usedParts = (state._wrUsedParts || [])
            .filter(p => Number(p.qty_used) > 0)
            .map(p => ({ spare_part_id: p.spare_part_id, qty_used: Number(p.qty_used) }));

        if (workType === 'MAINTENANCE' || workType === 'TROUBLE') {
            payload.usedParts = usedParts;
        }

        try {
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
                await TVC_Transaction.updateReport(user, state._wrReportId, updatePayload);
                TVC_JobMeta.addHistory(job.job_code, {
                    action: `${workType}_MODIFIED`, user: user.display_name,
                    notes: (description || '').slice(0, 100),
                });
            } else {
                await TVC_Transaction.submitReport(user, job.id, payload);
                TVC_JobMeta.addHistory(job.job_code, {
                    action: `${workType}_${status}`, user: user.display_name,
                    notes: (description || '').slice(0, 100),
                });
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
                : `${WR_TABS[tab]} 보고가 저장되었습니다. (${status})`);
        } catch (e) { alert(e.message || e.code); }
    }

    function openJobDetail(jobId) {
        state.selectedJobId = jobId;
        const job = state.idx.jobById.get(jobId);
        if (!job) return;
        if (state.vlActual) state.vlActual.refresh();
        if (state.vlOriginal) state.vlOriginal.refresh();
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
        if (f.showDailyReportSubmit && sameDept) h += `<button class="btn btn-green" onclick="TVC_App.doSubmit('${job.id}')">📋 Report (PENDING)</button>`;
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
            TVC_JobMeta.addHistory(job.job_code, { action: 'REPORT_PENDING', user: user.display_name, notes: '' });
            closeModal('jobDetailModal');
            await refreshAll();
            alert('PENDING submitted');
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
            TVC_JobMeta.addHistory(job.job_code, { action: 'APPROVED', user: user.display_name, notes: 'Stock deducted' });
            closeModal('jobDetailModal');
            await refreshAll();
            alert('Approved & stock deducted');
        } catch (e) { alert(e.message || e.code); }
    }

    async function pickUsedParts() {
        if (!state.spares.length) return [];
        const spare = state.spares[0];
        const qty = parseInt(prompt(`Part: ${spare.name}\nQty (0=none):`, '0') || '0', 10);
        if (isNaN(qty)) return null;
        return qty <= 0 ? [] : [{ spare_part_id: spare.id, qty_used: qty }];
    }

    async function doApprove(reportId) {
        const user = TVC_Auth.requirePermission(TVC_RBAC.Action.APPROVE_DAILY_REPORT);
        if (!user) return;
        const rep = state.reports.find(r => r.id === reportId);
        const dept = rep ? reportDept(rep) : null;
        if (!TVC_RBAC.canApproveDepartment(user, dept)) {
            alert(`타 부서(${dept || '?'}) 리포트는 승인할 수 없습니다. 승인 범위: ${TVC_RBAC.getDeptLabel(user.department)}`);
            return;
        }
        try { await TVC_Transaction.approveReport(user, reportId); await refreshAll(); alert('Approved'); }
        catch (e) { alert(e.message || e.code); }
    }

    async function doConfirm(reportId) {
        const user = TVC_Auth.requirePermission(TVC_RBAC.Action.CONFIRM_REPORT);
        if (!user) return;
        const comment = document.getElementById('comment-' + reportId)?.value || '';
        try { await TVC_Transaction.confirmReport(user, reportId, comment); await refreshAll(); alert('CONFIRMED'); }
        catch (e) { alert(e.message || e.code); }
    }

    async function refreshAll() {
        await loadData();
        rerenderCurrentTab();
    }

    // ── Print ────────────────────────────────────────────────────────
    function printCurrentTab(preview) {
        let ids;
        if (state.currentTab === 'actual') ids = sheetIds('actual');
        else ids = sheetIds('original');
        const jobs = ids.map(id => state.idx.jobById.get(id)).filter(Boolean);
        const title = state.currentTab === 'actual' ? 'Actual Plan' : 'Original Plan';
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
            const dept = document.getElementById('loginDept')?.value || '';
            const r = await TVC_Auth.login(
                document.getElementById('loginUser').value,
                document.getElementById('loginPass').value,
                dept
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
        setDepartment, setHistTab, menuAction, resolveDeptPick,
        setFleetView, setFleetSearch, selectVessel,
        setSearch, setTreeSearch, sortJobs, setActualFilter, onActualPeriodChange, clearActualPeriod, selectGroup, renderGroupTree,
        openJobDetail, openWorkProcedure, setWorkProcedureTab, openProcedureHistory, openProcedureHistoryByCode,
        openWorkReport, setWorkReportTab, setWorkReportPage, saveWorkReport,
        uploadWrAttachment, removeWrAttachment,
        toggleBatchJob, toggleBatchSelectAll, openBatchReport, saveBatchReport,
        setBatchActiveJob, openBatchJobPicker, closeBatchJobPicker, closeBatchReport,
        setWrSpareSearch, onWrSpareSearchInput, addWrSparePart, removeWrSparePart,
        openWorkReportFromHistory, modifyWorkReport, selectHistRow,
        histDetailWorkReport, histModifyReport, histReportApproval, histDeleteReport,
        toggleHistCheck, toggleHistSelectAll,
        navReport, deleteWorkReport, printWorkReport, closeWorkReport,
        selectJobRow,
        selectSpareRow, focusSpareRow, toggleSpareRow, syncSpareItemToolbar, spareActionIds, canEditSpareItems, openSpareAppend, openSpareModify, deleteSpareItem,
        saveRunHrs, runHrsPreview, runHrsTotalEdit,         updateOriginalPlanFromRunHours,
        openOrigJobModify, openOrigJobAppend, saveOrigJobEditor, deleteOrigJob,
        openOrigGroupAdd, openOrigGroupRename, saveGroupEditor,
        confirmPlanUpdate, closePlanUpdateModal, printCurrentTab,
        doSubmit, doExecute, doApprove, doConfirm,
        handleLogin, handleLogout, handleExport, handleImport, loadSeedFile,
        uploadAttachment, saveDetailReport, closeModal, showModal, dismissSpicsAlerts, openSpicsRequisition,
    };
})();

document.addEventListener('DOMContentLoaded', () => TVC_App.boot());
window.TVC_App = TVC_App;
