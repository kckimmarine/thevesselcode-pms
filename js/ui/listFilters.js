/* Period row Filter — Work Plan PIC · Defect/History Group · History Type */
const TVC_ListFilters = (function () {
    const PIC_BY_DEPT = {
        ENGINE: ['C/E', '1/E', '2/E', '3/E'],
        DECK: ['Captain', 'C/O', '2/O(A)', '2/O(B)', '3/O'],
    };
    const TYPE_LABELS = { all: 'All', m: 'M', p: 'P', d: 'D' };
    let _openTab = null;
    let _groupSearch = '';

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
        return null;
    }

    function activeCount(tab, state) {
        const f = filters(state, tab);
        if (tab === 'actual') {
            let n = (f.pics?.length || 0) + (f.unassigned ? 1 : 0);
            return n;
        }
        if (tab === 'history') {
            let n = (f.groupKeys?.length || 0) + (f.type && f.type !== 'all' ? 1 : 0) + (f.openOnly ? 1 : 0);
            return n;
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
        if (entry.source === 'defect') return resolveDefectGroupKey(entry.defect, ctx);
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

    function histEntryType(entry) {
        if (entry?.source === 'defect') return 'd';
        if (entry?.report?.work_type === 'POSTPONE') return 'p';
        return 'm';
    }

    function matchGroupKeys(key, groupKeys) {
        if (!groupKeys?.length) return true;
        return !!key && groupKeys.includes(key);
    }

    function matchActualJob(job, f) {
        if (!job) return false;
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
        return f.type || 'all';
    }

    function matchHistEntry(entry, f, ctx) {
        const type = effectiveHistType(f);
        if (type !== 'all' && histEntryType(entry) !== type) return false;
        if (f.openOnly && entry?.source === 'defect' && !isDefectOpen(entry.defect)) return false;
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
        if (!btn || !TVC_App?.getListFilterState) return;
        const n = activeCount(tab, { listFilters: TVC_App.getListFilterState() });
        btn.classList.toggle('list-filter-btn-active', n > 0);
        btn.textContent = n > 0 ? `Filter · ${n}` : 'Filter';
    }

    function getPopover() {
        return document.getElementById('listFilterPopFloat');
    }

    function positionPopover(btn, pop) {
        if (!btn || !pop) return;
        const rect = btn.getBoundingClientRect();
        const margin = 4;
        pop.style.left = `${Math.max(8, rect.left)}px`;
        pop.style.top = `${rect.bottom + margin}px`;
        pop.style.right = 'auto';
        requestAnimationFrame(() => {
            const pr = pop.getBoundingClientRect();
            if (pr.bottom > window.innerHeight - 8) {
                const top = rect.top - pr.height - margin;
                if (top >= 8) pop.style.top = `${top}px`;
            }
            if (pr.right > window.innerWidth - 8) {
                pop.style.left = `${Math.max(8, window.innerWidth - pr.width - 8)}px`;
            }
        });
    }

    function closePopover() {
        const pop = getPopover();
        if (pop) pop.classList.add('hidden');
        _openTab = null;
        _groupSearch = '';
    }

    function renderPopover(tab) {
        const pop = getPopover();
        const btnId = filterBtnId(tab);
        const btn = btnId ? document.getElementById(btnId) : null;
        if (!pop || !btn || !TVC_App?.getListFilterState) return;
        pop.classList.toggle('list-filter-pop-history', tab === 'history');
        const state = {
            listFilters: TVC_App.getListFilterState(),
            department: TVC_App.getAppDepartment?.(),
            userDepartment: TVC_App.getAppUserDepartment?.(),
            selectedGroupKey: TVC_App.getSelectedGroupKey?.(),
            idx: TVC_App.getAppIdx?.(),
            jobs: TVC_App.getAppJobs?.(),
        };
        const f = filters(state, tab);

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
            pop.innerHTML = `
                <div class="list-filter-section">
                    ${single ? '<div class="list-filter-section-title">P.I.C</div>' : ''}
                    ${picChecks}
                    <label class="list-filter-check"><input type="checkbox" id="actFilterUnassigned"${f.unassigned ? ' checked' : ''}> Unassigned</label>
                </div>
                <div class="list-filter-actions">
                    <button type="button" class="btn btn-sm" data-filter-clear>Clear</button>
                    <button type="button" class="btn btn-sm btn-green" data-filter-apply>Apply</button>
                </div>`;
        } else {
            const types = ['all', 'm', 'p', 'd'];
            const histType = effectiveHistType(f);
            pop.innerHTML = `
                <div class="list-filter-section">
                    <div class="list-filter-section-title">Report type</div>
                    <div class="list-filter-type-seg">
                        ${types.map(t => `<button type="button" class="list-filter-type-btn${histType === t ? ' active' : ''}" data-hist-type="${t}">${TYPE_LABELS[t]}</button>`).join('')}
                    </div>
                </div>
                ${renderGroupPanel(f, tab)}
                <div class="list-filter-section">
                    <div class="list-filter-section-title">Defect Report</div>
                    <label class="list-filter-check list-filter-open-only"><input type="checkbox" id="histFilterOpenOnly"${f.openOnly ? ' checked' : ''}> Open only <span class="muted">(DC unchecked)</span></label>
                </div>
                <div class="list-filter-actions">
                    <button type="button" class="btn btn-sm" data-filter-clear>Clear</button>
                    <button type="button" class="btn btn-sm btn-green" data-filter-apply>Apply</button>
                </div>`;
        }

        pop.querySelector('[data-filter-apply]')?.addEventListener('click', () => applyFromPopover(tab, pop));
        pop.querySelector('[data-filter-clear]')?.addEventListener('click', (ev) => {
            ev.stopPropagation();
            resetPopoverForm(tab, pop);
        });
        pop.querySelectorAll('[data-hist-type]').forEach(btn => {
            btn.addEventListener('click', () => {
                pop.querySelectorAll('[data-hist-type]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
        pop.querySelector('#histFilterOpenOnly')?.addEventListener('change', (ev) => {
            if (!ev.target.checked) return;
            pop.querySelectorAll('[data-hist-type]').forEach(b => b.classList.remove('active'));
            pop.querySelector('[data-hist-type="d"]')?.classList.add('active');
        });
        const gs = pop.querySelector('.list-filter-group-search');
        if (gs) {
            gs.addEventListener('input', () => {
                _groupSearch = gs.value;
                const list = pop.querySelector('.list-filter-group-list');
                if (list) list.innerHTML = renderGroupChecks(filteredGroupNodes(state), f.groupKeys);
            });
        }
        positionPopover(btn, pop);
    }

    function renderGroupPanel(f, tab) {
        const state = { listFilters: TVC_App.getListFilterState(), department: TVC_App.getAppDepartment?.(), idx: TVC_App.getAppIdx?.() };
        return `
            <div class="list-filter-section">
                <div class="list-filter-section-title">PMS Group</div>
                <input type="text" class="list-filter-group-search search-input" placeholder="Search group…" value="${escAttr(_groupSearch)}">
                <div class="list-filter-group-list">${renderGroupChecks(filteredGroupNodes(state), f.groupKeys)}</div>
            </div>`;
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
        if (tab === 'history') {
            pop.querySelectorAll('[data-hist-type]').forEach(b => b.classList.remove('active'));
            pop.querySelector('[data-hist-type="all"]')?.classList.add('active');
        }
        const gs = pop.querySelector('.list-filter-group-search');
        if (gs) {
            gs.value = '';
            _groupSearch = '';
            const list = pop.querySelector('.list-filter-group-list');
            if (list && TVC_App?.getListFilterState) {
                const state = {
                    listFilters: TVC_App.getListFilterState(),
                    department: TVC_App.getAppDepartment?.(),
                    idx: TVC_App.getAppIdx?.(),
                };
                list.innerHTML = renderGroupChecks(filteredGroupNodes(state), []);
            }
        }
    }

    function applyFromPopover(tab, pop) {
        if (tab === 'actual') {
            const pics = [...pop.querySelectorAll('[data-pic]:checked')].map(el => el.dataset.pic);
            const unassigned = !!pop.querySelector('#actFilterUnassigned')?.checked;
            TVC_App.setListFilters('actual', { pics, unassigned });
        } else {
            const groupKeys = [...pop.querySelectorAll('[data-group-key]:checked')].map(el => el.dataset.groupKey);
            const openOnly = !!pop.querySelector('#histFilterOpenOnly')?.checked;
            const typeBtn = pop.querySelector('[data-hist-type].active');
            let type = typeBtn?.dataset.histType || 'all';
            if (openOnly) type = 'd';
            TVC_App.setListFilters('history', { groupKeys, type, openOnly });
        }
        closePopover();
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
    }

    function describeFilters(tab, state) {
        const f = filters(state, tab);
        const parts = [];
        if (tab === 'actual') {
            if (f.pics?.length) parts.push(`PIC: ${f.pics.join(', ')}`);
            if (f.unassigned) parts.push('PIC: Unassigned');
        }
        if (tab === 'history') {
            if (f.type && f.type !== 'all') parts.push(`Type: ${TYPE_LABELS[f.type]}`);
            if (f.openOnly) parts.push('Open only');
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
        syncBtn,
        activeCount,
        hasActive,
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
