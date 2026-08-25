/* Period row Filter — Work Plan PIC · Defect/History Group · History Type */
const TVC_ListFilters = (function () {
    const PIC_BY_DEPT = {
        ENGINE: ['C/E', '1/E', '2/E', '3/E'],
        DECK: ['Captain', 'C/O', '2/O(A)', '2/O(B)', '3/O'],
    };
    const TYPE_LABELS = { all: 'All', w: 'W', m: 'M', p: 'P', d: 'D', c: 'C' };
    let _openTab = null;
    let _groupSearch = '';

    function isXferTab(tab) {
        return tab === 'caseXfer' || tab === 'monthlyXfer';
    }

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function escAttr(s) { return esc(s); }

    function filters(state, tab) {
        return state?.listFilters?.[tab] || {};
    }

    function filterBtnId(tab) {
        if (tab === 'actual') return 'actListFilterBtn';
        if (tab === 'history') return 'histListFilterBtn';
        if (tab === 'consumeLog') return 'consumeLogListFilterBtn';
        if (tab === 'workPermit') return 'wpListFilterBtn';
        if (tab === 'reqList') {
            const histTabBtn = document.getElementById('spareHistReqListFilterBtn');
            if (histTabBtn && histTabBtn.getClientRects().length > 0) return 'spareHistReqListFilterBtn';
            const histBtn = document.getElementById('reqHistListFilterBtn');
            if (histBtn && histBtn.getClientRects().length > 0) return 'reqHistListFilterBtn';
            return 'reqListFilterBtn';
        }
        if (tab === 'caseXfer') return 'menuXferCaseFilterBtn';
        if (tab === 'monthlyXfer') return 'menuXferMonthlyFilterBtn';
        return null;
    }

    function consumeLogFilterState() {
        return typeof TVC_SpareMenu !== 'undefined' && TVC_SpareMenu.getConsumeLogListFilters
            ? TVC_SpareMenu.getConsumeLogListFilters()
            : { groupKeys: [], type: 'all' };
    }

    function wpListFilterState() {
        return typeof TVC_WorkPermitReport !== 'undefined' && TVC_WorkPermitReport.getWpListFilters
            ? TVC_WorkPermitReport.getWpListFilters()
            : { groupKeys: [], status: 'all' };
    }

    function reqListFilterState() {
        return typeof TVC_SpareMenu !== 'undefined' && TVC_SpareMenu.getReqListFilters
            ? TVC_SpareMenu.getReqListFilters()
            : { groupKeys: [], type: 'all' };
    }

    function caseXferFilterState() {
        return typeof TVC_App !== 'undefined' && TVC_App.getMenuXferCaseFilters
            ? TVC_App.getMenuXferCaseFilters()
            : { groupKeys: [], type: 'all' };
    }

    function monthlyXferFilterState() {
        return typeof TVC_App !== 'undefined' && TVC_App.getMenuXferMonthlyFilters
            ? TVC_App.getMenuXferMonthlyFilters()
            : { groupKeys: [], type: 'all' };
    }

    function xferFilterState(tab) {
        return tab === 'monthlyXfer' ? monthlyXferFilterState() : caseXferFilterState();
    }

    const REQ_TYPE_LABELS = { all: 'All', routine: 'Routine', urgent: 'Urgent', dock: 'Dock' };

    function postponeAwaitingActive(f) {
        return !!f?.postponeAwaitingApproval;
    }

    function isSpareHistReqFilter() {
        return filterBtnId('reqList') === 'spareHistReqListFilterBtn';
    }

    function activeCount(tab, state) {
        const f = filters(state, tab);
        if (tab === 'actual') {
            let n = (f.pics?.length || 0) + (f.unassigned ? 1 : 0) + (f.criticalOnly ? 1 : 0);
            return n;
        }
        if (tab === 'history') {
            let n = (f.groupKeys?.length || 0) + (f.type && f.type !== 'all' ? 1 : 0) + (f.openOnly ? 1 : 0) + (f.noClosedOut ? 1 : 0) + (postponeAwaitingActive(f) ? 1 : 0) + (f.awaitingShipConfirm ? 1 : 0);
            return n;
        }
        if (tab === 'consumeLog') {
            return (f.groupKeys?.length || 0) + (f.type && f.type !== 'all' ? 1 : 0);
        }
        if (tab === 'workPermit') {
            return (f.groupKeys?.length || 0) + (f.status && f.status !== 'all' ? 1 : 0);
        }
        if (tab === 'reqList') {
            return (f.groupKeys?.length || 0) + (f.type && f.type !== 'all' ? 1 : 0) + (f.openOnly ? 1 : 0);
        }
        if (isXferTab(tab)) {
            return (f.groupKeys?.length || 0) + (f.type && f.type !== 'all' ? 1 : 0);
        }
        return 0;
    }

    function hasActive(tab, state) {
        return activeCount(tab, state) > 0;
    }

    function resolveDefectGroupKey(dc, ctx) {
        if (!dc) return null;
        if (dc.pms_group_key) return dc.pms_group_key;
        const idx = ctx?.idx;
        const jobs = ctx?.jobs || [];
        if (dc.maintenance_job_id && idx?.jobById) {
            const job = idx.jobById.get(dc.maintenance_job_id);
            if (job) return `${job.department || ''}|${String(job.group || '').trim()}`;
        }
        const code = dc.pms_job_code || dc.job_code;
        if (code) {
            const job = idx?.jobById
                ? [...idx.jobById.values()].find(j => j.job_code === code)
                : jobs.find(j => j.job_code === code);
            if (job) return `${job.department || ''}|${String(job.group || '').trim()}`;
        }
        if (dc.pms_group_no && ctx?.idx?.groupNodes) {
            const short = String(dc.pms_group_no).trim().replace(/\s+/g, '');
            const node = ctx.idx.groupNodes.find(n =>
                String(n.label || '').replace(/\s+/g, '') === short
                || String(n.key || '').includes(short)
            );
            if (node) return node.key;
        }
        if (dc.department && dc.job_name) {
            const node = ctx?.idx?.groupNodes?.find(n =>
                n.department === dc.department && n.label === dc.job_name
            );
            if (node) return node.key;
        }
        return null;
    }

    function resolveHistEntryGroupKey(entry, ctx) {
        if (!entry) return null;
        if (entry.source === 'permit') {
            const row = entry.permit;
            const direct = String(row?.pms_group_key || '').trim();
            if (direct) return direct;
            const jobId = row?.maintenance_job_id || (row?.job_items || [])[0]?.maintenance_job_id;
            if (jobId && ctx?.idx?.jobById?.get(jobId)) {
                const job = ctx.idx.jobById.get(jobId);
                return `${job.department || ''}|${String(job.group || '').trim()}`;
            }
            return null;
        }
        if (entry.source === 'defect') return resolveDefectGroupKey(entry.defect, ctx);
        if (entry.source === 'consume') {
            const log = entry.consume;
            const direct = String(log?.spare_group_key || log?.pms_group_key || '').trim();
            if (direct) return direct;
            const jobCode = (log?.job_items || [])[0]?.job_code || log?.job_code;
            if (jobCode && ctx?.jobs) {
                const job = ctx.jobs.find(j => j.job_code === jobCode);
                if (job) return `${job.department || ''}|${String(job.group || '').trim()}`;
            }
            return null;
        }
        const item = entry.item;
        const idx = ctx?.idx;
        const jobs = ctx?.jobs || [];
        if (item?.maintenance_job_id && idx?.jobById) {
            const job = idx.jobById.get(item.maintenance_job_id);
            if (job) return `${job.department || ''}|${String(job.group || '').trim()}`;
        }
        if (item?.job_code) {
            const job = idx?.jobById
                ? [...idx.jobById.values()].find(j => j.job_code === item.job_code)
                : jobs.find(j => j.job_code === item.job_code);
            if (job) return `${job.department || ''}|${String(job.group || '').trim()}`;
        }
        return null;
    }

    function isDefectOpen(dc) {
        if (!dc) return false;
        if (dc.defect_cleared) return false;
        if (dc.status === TVC_DefectCase.Status.CLOSED) return false;
        return true;
    }

    function isHistEntryClosedOut(entry) {
        if (!entry) return false;
        if (entry.source === 'defect') return !isDefectOpen(entry.defect);
        if (entry.source === 'permit' || entry.source === 'consume') return false;
        const form = {
            ...(entry.item?.form || {}),
            ...(entry.report?.form || {}),
            ...(entry.report?.report_form || {}),
        };
        return !!(form.defectCleared || form.allPendingCleared || entry.report?.defect_cleared);
    }

    function histEntryType(entry) {
        if (entry?.source === 'permit') return 'w';
        if (entry?.source === 'defect') return 'd';
        if (entry?.source === 'consume') return 'c';
        if (entry?.report?.work_type === 'POSTPONE') return 'p';
        return 'm';
    }

    function matchGroupKeys(key, groupKeys) {
        if (!groupKeys?.length) return true;
        return !!key && groupKeys.includes(key);
    }

    function matchActualJob(job, f) {
        if (!job) return false;
        if (f.criticalOnly) {
            const isCrit = typeof TVC_App?.jobShowsCriticalEquipmentMark === 'function'
                ? TVC_App.jobShowsCriticalEquipmentMark(job)
                : job.is_critical_equipment === true;
            if (!isCrit) return false;
        }
        const hasPic = (f.pics?.length || 0) > 0 || f.unassigned;
        if (!hasPic) return true;
        const pic = String(job.pic || '').trim();
        if (!pic && f.unassigned) return true;
        if (pic && f.pics?.includes(pic)) return true;
        return false;
    }

    function matchDefectRow(dc, f, ctx) {
        if (f.openOnly && !isDefectOpen(dc)) return false;
        if (!matchGroupKeys(resolveDefectGroupKey(dc, ctx), f.groupKeys)) return false;
        return true;
    }

    function effectiveHistType(f) {
        if (f.openOnly) return 'd';
        if (postponeAwaitingActive(f)) return 'p';
        return f.type || 'all';
    }

    function matchHistEntry(entry, f, ctx) {
        const type = effectiveHistType(f);
        if (type !== 'all' && histEntryType(entry) !== type) return false;
        if (f.openOnly && entry?.source === 'defect' && !isDefectOpen(entry.defect)) return false;
        if (f.noClosedOut && isHistEntryClosedOut(entry)) return false;
        if (postponeAwaitingActive(f)) {
            if (entry?.source !== 'report' || !TVC_App?.reportMatchesPostponeAwaitingApproval?.(entry.report)) return false;
        }
        if (f.awaitingShipConfirm && !TVC_App?.histEntryAwaitingShipConfirm?.(entry)) return false;
        if (!matchGroupKeys(resolveHistEntryGroupKey(entry, ctx), f.groupKeys)) return false;
        return true;
    }

    function resolvePicDepartment(state) {
        const raw = state.department ?? state.userDepartment ?? null;
        if (raw) {
            const dept = String(raw).toUpperCase();
            if (PIC_BY_DEPT[dept]) return dept;
        }
        const key = state.selectedGroupKey;
        if (key && state.idx?.groupNodes) {
            const node = state.idx.groupNodes.find(n => n.key === key);
            if (node?.department && PIC_BY_DEPT[node.department]) return node.department;
        }
        return null;
    }

    function workPlanPicSections(state) {
        const dept = resolvePicDepartment(state);
        if (dept) return [{ dept, pics: PIC_BY_DEPT[dept] }];
        return [
            { dept: 'ENGINE', label: 'Engine', pics: PIC_BY_DEPT.ENGINE },
            { dept: 'DECK', label: 'Deck', pics: PIC_BY_DEPT.DECK },
        ];
    }

    function groupNodes(state) {
        return (state.idx?.groupNodes || []).filter(n =>
            !state.department || n.department === state.department
        );
    }

    function filteredGroupNodes(state) {
        const q = _groupSearch.trim().toLowerCase();
        const nodes = groupNodes(state);
        if (!q) return nodes;
        return nodes.filter(n =>
            String(n.label || '').toLowerCase().includes(q)
            || String(n.department || '').toLowerCase().includes(q)
        );
    }

    function syncBtn(tab) {
        const btnId = filterBtnId(tab);
        const btn = btnId ? document.getElementById(btnId) : null;
        if (!btn) return;
        let n = 0;
        if (tab === 'consumeLog') {
            n = activeCount('consumeLog', { listFilters: { consumeLog: consumeLogFilterState() } });
        } else if (tab === 'workPermit') {
            n = activeCount('workPermit', { listFilters: { workPermit: wpListFilterState() } });
        } else if (tab === 'reqList') {
            n = activeCount('reqList', { listFilters: { reqList: reqListFilterState() } });
        } else if (tab === 'caseXfer') {
            n = activeCount('caseXfer', { listFilters: { caseXfer: caseXferFilterState() } });
        } else if (tab === 'monthlyXfer') {
            n = activeCount('monthlyXfer', { listFilters: { monthlyXfer: monthlyXferFilterState() } });
        } else {
            if (!TVC_App?.getListFilterState) return;
            n = activeCount(tab, { listFilters: TVC_App.getListFilterState() });
        }
        btn.classList.toggle('list-filter-btn-active', n > 0);
        btn.textContent = n > 0 ? `Filter · ${n}` : 'Filter';
    }

    function getPopover() {
        return document.getElementById('listFilterPopFloat');
    }

    function positionPopover(btn, pop) {
        if (!btn || !pop) return;
        const margin = 4;
        const pad = 8;
        const rect = btn.getBoundingClientRect();
        pop.style.left = `${Math.max(pad, rect.left)}px`;
        pop.style.right = 'auto';
        pop.style.bottom = 'auto';

        const spaceBelow = window.innerHeight - rect.bottom - margin - pad;
        const spaceAbove = rect.top - margin - pad;
        const openBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
        const maxH = Math.max(180, openBelow ? spaceBelow : spaceAbove);
        pop.style.maxHeight = `${maxH}px`;
        if (openBelow) {
            pop.style.top = `${rect.bottom + margin}px`;
        } else {
            pop.style.top = `${Math.max(pad, rect.top - margin - maxH)}px`;
        }

        requestAnimationFrame(() => {
            const pr = pop.getBoundingClientRect();
            if (pr.right > window.innerWidth - pad) {
                pop.style.left = `${Math.max(pad, window.innerWidth - pr.width - pad)}px`;
            }
            if (pr.top < pad) {
                pop.style.top = `${pad}px`;
            }
            const top = parseFloat(pop.style.top) || pad;
            pop.style.maxHeight = `${Math.max(180, window.innerHeight - top - pad)}px`;
        });
    }

    function closePopover() {
        const pop = getPopover();
        if (pop) pop.classList.add('hidden');
        _openTab = null;
        _groupSearch = '';
    }

    function popShell(bodyHtml) {
        return `<div class="list-filter-pop-body">${bodyHtml}</div>`;
    }

    function renderPopover(tab) {
        const pop = getPopover();
        const btnId = filterBtnId(tab);
        const btn = btnId ? document.getElementById(btnId) : null;
        if (!pop || !btn) return;
        if (tab !== 'consumeLog' && tab !== 'workPermit' && tab !== 'reqList' && !isXferTab(tab) && !TVC_App?.getListFilterState) return;
        pop.classList.toggle('list-filter-pop-history', tab === 'history' || tab === 'consumeLog' || tab === 'workPermit' || tab === 'reqList' || isXferTab(tab));
        const state = {
            listFilters: TVC_App?.getListFilterState?.() || {},
            department: TVC_App?.getAppDepartment?.(),
            userDepartment: TVC_App?.getAppUserDepartment?.(),
            selectedGroupKey: TVC_App?.getSelectedGroupKey?.(),
            idx: TVC_App?.getAppIdx?.(),
            jobs: TVC_App?.getAppJobs?.(),
        };
        const f = tab === 'consumeLog' ? consumeLogFilterState()
            : (tab === 'reqList' ? reqListFilterState()
                : (tab === 'workPermit' ? wpListFilterState()
                    : (isXferTab(tab) ? xferFilterState(tab) : filters(state, tab))));

        if (tab === 'actual') {
            const sections = workPlanPicSections(state);
            const single = sections.length === 1;
            const picChecks = sections.map(sec => {
                const title = !single && sec.label
                    ? `<div class="list-filter-section-title">${esc(sec.label)}</div>`
                    : '';
                const checks = sec.pics.map(p =>
                    `<label class="list-filter-check"><input type="checkbox" data-pic="${escAttr(p)}"${f.pics?.includes(p) ? ' checked' : ''}> ${esc(p)}</label>`
                ).join('');
                return title + checks;
            }).join('');
            pop.innerHTML = popShell(`
                <div class="list-filter-section">
                    ${single ? '<div class="list-filter-section-title">P.I.C</div>' : ''}
                    ${picChecks}
                    <label class="list-filter-check"><input type="checkbox" id="actFilterUnassigned"${f.unassigned ? ' checked' : ''}> Unassigned</label>
                </div>
                <div class="list-filter-section">
                    <div class="list-filter-section-title">Critical Equipment</div>
                    <label class="list-filter-check"><input type="checkbox" id="actFilterCriticalOnly"${f.criticalOnly ? ' checked' : ''}> Critical Equipment only</label>
                </div>`);
        } else if (tab === 'consumeLog') {
            const types = ['all', 'm', 'd', 'c'];
            const curType = f.type || 'all';
            pop.innerHTML = popShell(`
                <div class="list-filter-section">
                    <div class="list-filter-section-title">Report type</div>
                    <div class="list-filter-type-seg">
                        ${types.map(t => `<button type="button" class="list-filter-type-btn${curType === t ? ' active' : ''}" data-hist-type="${t}">${TYPE_LABELS[t]}</button>`).join('')}
                    </div>
                </div>
                ${renderGroupPanel(f, tab)}`);
        } else if (isXferTab(tab)) {
            const types = ['all', 'w', 'm', 'd', 'p', 'c'];
            const curType = f.type || 'all';
            pop.innerHTML = popShell(`
                <div class="list-filter-section">
                    <div class="list-filter-section-title">Type</div>
                    <div class="list-filter-type-seg">
                        ${types.map(t => `<button type="button" class="list-filter-type-btn${curType === t ? ' active' : ''}" data-hist-type="${t}">${TYPE_LABELS[t]}</button>`).join('')}
                    </div>
                </div>
                ${renderGroupPanel(f, tab)}`);
        } else if (tab === 'workPermit') {
            const statuses = ['all', 'reported', 'confirmed', 'approved'];
            const WP_STATUS_LABELS = { all: 'All', reported: 'Reported', confirmed: 'Confirmed', approved: 'Approved' };
            const curStatus = f.status || 'all';
            pop.innerHTML = popShell(`
                <div class="list-filter-section">
                    <div class="list-filter-section-title">Status</div>
                    <div class="list-filter-type-seg">
                        ${statuses.map(t => `<button type="button" class="list-filter-type-btn${curStatus === t ? ' active' : ''}" data-wp-status="${t}">${WP_STATUS_LABELS[t]}</button>`).join('')}
                    </div>
                </div>
                ${renderGroupPanel(f, tab)}`);
        } else if (tab === 'reqList') {
            const types = ['all', 'routine', 'urgent', 'dock'];
            const curType = f.type || 'all';
            const spareHist = isSpareHistReqFilter();
            pop.innerHTML = popShell(`
                <div class="list-filter-section">
                    <div class="list-filter-section-title">${spareHist ? 'Type' : 'Report type'}</div>
                    <div class="list-filter-type-seg">
                        ${types.map(t => `<button type="button" class="list-filter-type-btn${curType === t ? ' active' : ''}" data-hist-type="${t}">${REQ_TYPE_LABELS[t]}</button>`).join('')}
                    </div>
                </div>
                ${renderGroupPanel(f, tab)}
                <div class="list-filter-section">
                    <div class="list-filter-section-title">Status</div>
                    <label class="list-filter-check list-filter-open-only"><input type="checkbox" id="reqListFilterOpenOnly"${f.openOnly ? ' checked' : ''}> Open <span class="muted">(not Received, or Received with O/S &gt; 0)</span></label>
                </div>`);
        } else {
            const types = ['all', 'w', 'm', 'p', 'd', 'c'];
            const histType = f.type || 'all';
            pop.innerHTML = popShell(`
                <div class="list-filter-section">
                    <div class="list-filter-section-title">Type</div>
                    <div class="list-filter-type-seg">
                        ${types.map(t => `<button type="button" class="list-filter-type-btn${histType === t ? ' active' : ''}" data-hist-type="${t}">${TYPE_LABELS[t]}</button>`).join('')}
                    </div>
                </div>
                ${renderGroupPanel(f, tab)}
                <div class="list-filter-section">
                    <label class="list-filter-check list-filter-open-only"><input type="checkbox" id="histFilterNoClosedOut"${f.noClosedOut ? ' checked' : ''}> No Closed-out</label>
                </div>`);
        }

        pop.querySelectorAll('[data-hist-type]').forEach(typeBtn => {
            typeBtn.addEventListener('click', () => {
                pop.querySelectorAll('[data-hist-type]').forEach(b => b.classList.remove('active'));
                typeBtn.classList.add('active');
                applyFromPopover(tab, pop, { keepOpen: true });
            });
        });
        pop.querySelectorAll('[data-wp-status]').forEach(statusBtn => {
            statusBtn.addEventListener('click', () => {
                pop.querySelectorAll('[data-wp-status]').forEach(b => b.classList.remove('active'));
                statusBtn.classList.add('active');
                applyFromPopover(tab, pop, { keepOpen: true });
            });
        });
        const gs = pop.querySelector('.list-filter-group-search');
        if (gs) {
            gs.addEventListener('input', () => {
                _groupSearch = gs.value;
                TVC_App.updateSearchClearBtnForEl?.(gs);
                const list = pop.querySelector('.list-filter-group-list');
                if (list) {
                    const liveKeys = tab === 'history'
                        ? (TVC_App.getListFilterState?.()?.history?.groupKeys || f.groupKeys)
                        : f.groupKeys;
                    list.innerHTML = renderGroupChecks(filteredGroupNodes(state), liveKeys);
                }
            });
            TVC_App.updateSearchClearBtnForEl?.(gs);
        }
        positionPopover(btn, pop);
    }

    function renderGroupPanel(f, tab) {
        const state = { listFilters: TVC_App.getListFilterState(), department: TVC_App.getAppDepartment?.(), idx: TVC_App.getAppIdx?.() };
        const groupSearchVal = escAttr(_groupSearch);
        return `
            <div class="list-filter-section">
                <div class="list-filter-section-title">PMS Group</div>
                <div class="search-field-wrap list-filter-group-search-wrap">
                    <input type="text" class="list-filter-group-search search-input" placeholder="Search group…" value="${groupSearchVal}">
                    <button type="button" class="search-clear-btn${_groupSearch ? '' : ' hidden'}" title="Clear search" aria-label="Clear search"
                        onclick="TVC_ListFilters.clearGroupSearch(event)">×</button>
                </div>
                <div class="list-filter-group-list">${renderGroupChecks(filteredGroupNodes(state), f.groupKeys)}</div>
            </div>`;
    }

    function clearGroupSearch(ev) {
        ev?.stopPropagation?.();
        _groupSearch = '';
        const pop = getPopover();
        const gs = pop?.querySelector('.list-filter-group-search');
        if (gs) {
            gs.value = '';
            gs.dispatchEvent(new Event('input', { bubbles: true }));
            gs.focus();
        }
        TVC_App.updateSearchClearBtnForEl?.(gs);
    }

    function deptLabel(dept) {
        if (typeof TVC_RBAC !== 'undefined' && TVC_RBAC.getDeptLabel) {
            return TVC_RBAC.getDeptLabel(dept);
        }
        return dept || 'Other';
    }

    function renderGroupChecks(nodes, selected) {
        if (!nodes.length) return '<p class="muted list-filter-empty">No groups</p>';
        const byDept = new Map();
        nodes.forEach(n => {
            const dept = n.department || 'OTHER';
            if (!byDept.has(dept)) byDept.set(dept, []);
            byDept.get(dept).push(n);
        });
        const depts = [...byDept.keys()].sort((a, b) => a.localeCompare(b));
        return depts.map(dept => {
            const deptNodes = byDept.get(dept);
            const checks = deptNodes.map(n => {
                const checked = selected?.includes(n.key) ? ' checked' : '';
                return `<label class="list-filter-check" title="${escAttr(n.key)}"><input type="checkbox" data-group-key="${escAttr(n.key)}"${checked}> ${esc(n.label)}</label>`;
            }).join('');
            return `<div class="list-filter-dept-block">
                <div class="list-filter-dept-title">${esc(deptLabel(dept))}</div>
                ${checks}
            </div>`;
        }).join('');
    }

    function resetPopoverForm(tab, pop) {
        pop.querySelectorAll('input[type="checkbox"]').forEach(el => { el.checked = false; });
        if (tab === 'history' || tab === 'consumeLog' || tab === 'workPermit' || tab === 'reqList' || isXferTab(tab)) {
            pop.querySelectorAll('[data-hist-type]').forEach(b => b.classList.remove('active'));
            pop.querySelector('[data-hist-type="all"]')?.classList.add('active');
            pop.querySelectorAll('[data-wp-status]').forEach(b => b.classList.remove('active'));
            pop.querySelector('[data-wp-status="all"]')?.classList.add('active');
        }
        const gs = pop.querySelector('.list-filter-group-search');
        if (gs) {
            gs.value = '';
            _groupSearch = '';
            const list = pop.querySelector('.list-filter-group-list');
            if (list && TVC_App?.getAppIdx) {
                const state = {
                    listFilters: TVC_App.getListFilterState?.() || {},
                    department: TVC_App.getAppDepartment?.(),
                    idx: TVC_App.getAppIdx?.(),
                };
                list.innerHTML = renderGroupChecks(filteredGroupNodes(state), []);
            }
        }
    }

    function applyFromPopover(tab, pop, opts = {}) {
        if (tab === 'actual') {
            const pics = [...pop.querySelectorAll('[data-pic]:checked')].map(el => el.dataset.pic);
            const unassigned = !!pop.querySelector('#actFilterUnassigned')?.checked;
            const criticalOnly = !!pop.querySelector('#actFilterCriticalOnly')?.checked;
            TVC_App.setListFilters('actual', { pics, unassigned, criticalOnly });
        } else if (tab === 'consumeLog') {
            const groupKeys = [...pop.querySelectorAll('[data-group-key]:checked')].map(el => el.dataset.groupKey);
            const typeBtn = pop.querySelector('[data-hist-type].active');
            const type = typeBtn?.dataset.histType || 'all';
            TVC_SpareMenu?.setConsumeLogListFilters?.({ groupKeys, type });
        } else if (tab === 'workPermit') {
            const groupKeys = [...pop.querySelectorAll('[data-group-key]:checked')].map(el => el.dataset.groupKey);
            const statusBtn = pop.querySelector('[data-wp-status].active');
            const status = statusBtn?.dataset.wpStatus || 'all';
            TVC_WorkPermitReport?.setWpListFilters?.({ groupKeys, status });
        } else if (tab === 'reqList') {
            const groupKeys = [...pop.querySelectorAll('[data-group-key]:checked')].map(el => el.dataset.groupKey);
            const typeBtn = pop.querySelector('[data-hist-type].active');
            const type = typeBtn?.dataset.histType || 'all';
            const openOnly = !!pop.querySelector('#reqListFilterOpenOnly')?.checked;
            TVC_SpareMenu?.setReqListFilters?.({ groupKeys, type, openOnly });
        } else if (tab === 'caseXfer') {
            const groupKeys = [...pop.querySelectorAll('[data-group-key]:checked')].map(el => el.dataset.groupKey);
            const typeBtn = pop.querySelector('[data-hist-type].active');
            const type = typeBtn?.dataset.histType || 'all';
            TVC_App?.setMenuXferCaseFilters?.({ groupKeys, type });
        } else if (tab === 'monthlyXfer') {
            const groupKeys = [...pop.querySelectorAll('[data-group-key]:checked')].map(el => el.dataset.groupKey);
            const typeBtn = pop.querySelector('[data-hist-type].active');
            const type = typeBtn?.dataset.histType || 'all';
            TVC_App?.setMenuXferMonthlyFilters?.({ groupKeys, type });
        } else {
            const groupKeys = [...pop.querySelectorAll('[data-group-key]:checked')].map(el => el.dataset.groupKey);
            const noClosedOut = !!pop.querySelector('#histFilterNoClosedOut')?.checked;
            const typeBtn = pop.querySelector('[data-hist-type].active');
            const type = typeBtn?.dataset.histType || 'all';
            TVC_App.setListFilters('history', {
                groupKeys,
                type,
                noClosedOut,
                openOnly: false,
                postponeAwaitingApproval: false,
                awaitingShipConfirm: false,
            });
        }
        if (!opts.keepOpen) closePopover();
    }

    function isPopoverOpen(tab) {
        const pop = getPopover();
        return !!pop && !pop.classList.contains('hidden') && _openTab === tab;
    }

    function toggle(tab, ev) {
        ev?.stopPropagation();
        const pop = getPopover();
        const btnId = filterBtnId(tab);
        const btn = btnId ? document.getElementById(btnId) : null;
        if (!pop || !btn) return;
        if (isPopoverOpen(tab)) {
            closePopover();
            return;
        }
        _groupSearch = '';
        _openTab = tab;
        renderPopover(tab);
        pop.classList.remove('hidden');
    }

    function bindPopoverListeners() {
        if (document._listFilterBound) return;
        document._listFilterBound = true;
        window.addEventListener('resize', () => {
            if (!_openTab) return;
            const btnId = filterBtnId(_openTab);
            const btn = btnId ? document.getElementById(btnId) : null;
            const pop = getPopover();
            if (btn && pop && !pop.classList.contains('hidden')) positionPopover(btn, pop);
        });
        window.addEventListener('scroll', () => {
            if (!_openTab) return;
            const btnId = filterBtnId(_openTab);
            const btn = btnId ? document.getElementById(btnId) : null;
            const pop = getPopover();
            if (btn && pop && !pop.classList.contains('hidden')) positionPopover(btn, pop);
        }, true);
        document.addEventListener('pointerdown', (ev) => {
            if (!_openTab) return;
            const pop = getPopover();
            if (!pop || pop.classList.contains('hidden')) return;
            if (pop.contains(ev.target)) return;
            const btnId = filterBtnId(_openTab);
            const btn = btnId ? document.getElementById(btnId) : null;
            if (btn && (btn === ev.target || btn.contains(ev.target))) return;
            closePopover();
        });
        document.addEventListener('change', (ev) => {
            const pop = getPopover();
            if (!pop || pop.classList.contains('hidden') || !pop.contains(ev.target)) return;
            if (_openTab === 'actual' && ev.target.matches('[data-pic], #actFilterUnassigned, #actFilterCriticalOnly')) {
                applyFromPopover('actual', pop, { keepOpen: true });
            }
            if (_openTab === 'history' && ev.target.matches('[data-group-key], #histFilterNoClosedOut')) {
                applyFromPopover('history', pop, { keepOpen: true });
            }
            if (_openTab === 'consumeLog' && ev.target.matches('[data-group-key]')) {
                applyFromPopover('consumeLog', pop, { keepOpen: true });
            }
            if (_openTab === 'workPermit' && ev.target.matches('[data-group-key]')) {
                applyFromPopover('workPermit', pop, { keepOpen: true });
            }
            if (_openTab === 'reqList' && ev.target.matches('[data-group-key], #reqListFilterOpenOnly')) {
                applyFromPopover('reqList', pop, { keepOpen: true });
            }
            if (_openTab === 'caseXfer' && ev.target.matches('[data-group-key]')) {
                applyFromPopover('caseXfer', pop, { keepOpen: true });
            }
            if (_openTab === 'monthlyXfer' && ev.target.matches('[data-group-key]')) {
                applyFromPopover('monthlyXfer', pop, { keepOpen: true });
            }
        });
    }

    function refreshOpenPopover() {
        if (!_openTab) return;
        const pop = getPopover();
        if (!pop || pop.classList.contains('hidden')) return;
        renderPopover(_openTab);
    }

    function describeFilters(tab, state) {
        const f = tab === 'reqList' ? reqListFilterState()
            : (tab === 'consumeLog' ? consumeLogFilterState()
                : (isXferTab(tab) ? xferFilterState(tab) : filters(state, tab)));
        const parts = [];
        if (tab === 'actual') {
            if (f.pics?.length) parts.push(`PIC: ${f.pics.join(', ')}`);
            if (f.unassigned) parts.push('PIC: Unassigned');
            if (f.criticalOnly) parts.push('Critical Equipment');
        }
        if (tab === 'history' || tab === 'consumeLog' || tab === 'reqList' || isXferTab(tab)) {
            if (f.type && f.type !== 'all') {
                parts.push(`Type: ${tab === 'reqList' ? (REQ_TYPE_LABELS[f.type] || f.type) : TYPE_LABELS[f.type]}`);
            }
            if (tab === 'history' && f.openOnly) parts.push('Open only');
            if (tab === 'history' && f.noClosedOut) parts.push('No Closed-out');
            if (tab === 'reqList' && f.openOnly) parts.push('Open');
            if (tab === 'history' && postponeAwaitingActive(f)) parts.push('Awaiting company approval');
            if (tab === 'history' && f.awaitingShipConfirm) parts.push('Awaiting confirm');
            if (f.groupKeys?.length) parts.push(`Group: ${f.groupKeys.length} selected`);
        }
        return parts;
    }

    function init() {
        bindPopoverListeners();
    }

    return {
        init,
        toggle,
        closePopover,
        refreshOpenPopover,
        syncBtn,
        activeCount,
        hasActive,
        clearGroupSearch,
        matchActualJob,
        matchDefectRow,
        matchHistEntry,
        resolveDefectGroupKey,
        histEntryType,
        isDefectOpen,
        describeFilters,
    };
})();

if (typeof window !== 'undefined') window.TVC_ListFilters = TVC_ListFilters;
