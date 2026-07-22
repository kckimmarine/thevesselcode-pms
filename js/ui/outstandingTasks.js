/* THE VESSEL CODE — Menu Outstanding Tasks dashboard */
const TVC_OutstandingTasks = (function () {
    let ctx = null;
    let openKey = null;
    const LIST_CAP = 8;

    const KEYS = ['defect', 'overdue', 'due', 'postponed', 'lowStock', 'requisition'];

    function init(context) { ctx = context; }

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function escAttr(s) { return esc(s); }

    function isDefectSubmittedExport(dc) {
        if (!dc || dc.visible_in_list === false) return false;
        return TVC_DefectCase.listWorkflowStatus(dc) === 'Submitted';
    }

    function isDefectOutstanding(dc, state) {
        if (!dc || dc.visible_in_list === false) return false;
        if (state?.user && TVC_RBAC.isHqAccount(state.user)) {
            return dc.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY;
        }
        return isDefectSubmittedExport(dc);
    }

    function defectRows(state) {
        return (state.defectCases || []).filter(dc => {
            if (!isDefectOutstanding(dc, state)) return false;
            if (state.department && !TVC_DefectCase.belongsToDepartment(dc, state.department)) return false;
            return true;
        });
    }

    function jobRows(state, filter) {
        return ctx.deptJobs().filter(j => ctx.jobMatchesActualFilter(j, filter));
    }

    function spareInDept(state, spare) {
        if (!state.department) return true;
        const cat = spare.category || spare.department || '';
        return !cat || cat === state.department;
    }

    function lowStockRows(state) {
        return (state.spares || []).filter(s => spareInDept(state, s) && TVC_Inventory.isLowStock(s));
    }

    async function requisitionRows(state) {
        const isHq = state.user && TVC_RBAC.isHqAccount(state.user);
        const vesselId = isHq
            ? (state.selectedVesselId || (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || 'SHIP')
            : ((await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || 'SHIP');
        let rows = await TVC_Inventory.listRequisitions(vesselId);
        rows = rows.filter(TVC_Inventory.isRequisitionSubmittedExport);
        if (state.department) {
            rows = rows.filter(r => !r.department || r.department === state.department);
        }
        return rows;
    }

    function defectItemHtml(dc, state) {
        const code = dc.pms_job_code || dc.job_code || dc.case_no || '—';
        const title = dc.job_detail || dc.outline_maintenance_request || dc.job_name || dc.machinery_name || '';
        const dt = (dc.report_date || dc.work_date || dc.submitted_at || '').slice(0, 10);
        const isHq = state?.user && TVC_RBAC.isHqAccount(state.user);
        const meta = isHq ? `HQ Review · ${dt || '—'}` : `Submitted · ${dt || '—'}`;
        return `<button type="button" class="ot-card" onclick="TVC_OutstandingTasks.openItem('defect')">
            <span class="ot-card-title">${esc(code)}</span>
            <span class="ot-card-sub">${esc(title)}</span>
            <span class="ot-card-meta">${esc(meta)}</span>
        </button>`;
    }

    function jobItemHtml(j, filter) {
        const title = j.item_sort2 || j.job_detail || j.group || '';
        const st = ctx.jobActualStatusKind(j);
        const stLabel = { overdue: 'Overdue', due: 'Due (30d)', postponed: 'Postponed', ok: 'OK' }[st] || 'OK';
        return `<button type="button" class="ot-card" onclick="TVC_OutstandingTasks.openItem('${escAttr(filter)}')">
            <span class="ot-card-title"><strong>${esc(j.job_code)}</strong></span>
            <span class="ot-card-sub">${esc(title)}</span>
            <span class="ot-card-meta">${esc(stLabel)} · ${esc(j.next_date || '—')}</span>
        </button>`;
    }

    function lowStockItemHtml(s) {
        const stock = TVC_Inventory.currentStock(s);
        const min = TVC_Inventory.minStock(s);
        return `<button type="button" class="ot-card" onclick="TVC_OutstandingTasks.openItem('lowStock')">
            <span class="ot-card-title">${esc(s.part_no || '—')}</span>
            <span class="ot-card-sub">${esc(s.name || '')}</span>
            <span class="ot-card-meta">Stock ${stock} / Min ${min}</span>
        </button>`;
    }

    function requisitionItemHtml(r) {
        const dt = (r.created_at || '').slice(0, 10);
        const lines = (r.lines || []).length;
        return `<button type="button" class="ot-card" onclick="TVC_OutstandingTasks.openItem('requisition')">
            <span class="ot-card-title">${esc(r.req_no || '—')}</span>
            <span class="ot-card-sub">Submitted · ${lines} line${lines === 1 ? '' : 's'}</span>
            <span class="ot-card-meta">${esc(dt || '—')}</span>
        </button>`;
    }

    function renderMarkHtml(b) {
        switch (b.key) {
            case 'defect':
                return '<span class="ot-mark ot-mark-defect" aria-hidden="true">D</span>';
            case 'overdue':
                return '<span class="ot-mark ot-mark-overdue" aria-hidden="true">!</span>';
            case 'due':
                return `<span class="ot-mark ot-mark-due" aria-hidden="true">
                    <svg class="ot-mark-clock" viewBox="0 0 16 16" width="14" height="14" focusable="false">
                        <circle cx="8" cy="8" r="6.1" fill="none" stroke="#fff" stroke-width="1.45"/>
                        <path d="M8 8V5.15M8 8h2.35" fill="none" stroke="#fff" stroke-width="1.45" stroke-linecap="round"/>
                    </svg>
                </span>`;
            case 'postponed':
                return '<span class="ot-mark ot-mark-postponed" aria-hidden="true">P</span>';
            case 'lowStock':
                return '<span class="ot-mark ot-mark-lowstock" aria-hidden="true">📦</span>';
            case 'requisition':
                return '<span class="ot-mark ot-mark-requisition" aria-hidden="true">🧾</span>';
            default:
                return `<span class="ot-mark" aria-hidden="true">${esc(b.mark || '')}</span>`;
        }
    }

    function bucketDefs(state, reqRows) {
        const defect = defectRows(state);
        const overdue = jobRows(state, 'overdue');
        const due = jobRows(state, 'due30');
        const postponed = jobRows(state, 'postponed');
        const lowStock = lowStockRows(state);
        const requisition = reqRows || [];

        return {
            defect: {
                key: 'defect',
                label: 'Defect',
                mark: 'D',
                cls: 'ot-defect',
                count: defect.length,
                items: defect,
                renderItem: dc => defectItemHtml(dc, state),
                navigate: () => ctx.menuNavigate('defect'),
            },
            overdue: {
                key: 'overdue',
                label: 'Overdue',
                mark: '!',
                cls: 'ot-overdue',
                count: overdue.length,
                items: overdue,
                renderItem: j => jobItemHtml(j, 'overdue'),
                navigate: () => ctx.menuNavigate('actual', { actualFilter: 'overdue' }),
            },
            due: {
                key: 'due',
                label: 'Due',
                mark: '◷',
                cls: 'ot-due',
                count: due.length,
                items: due,
                renderItem: j => jobItemHtml(j, 'due30'),
                navigate: () => ctx.menuNavigate('actual', { actualFilter: 'due30' }),
            },
            postponed: {
                key: 'postponed',
                label: 'Postponed',
                mark: 'P',
                cls: 'ot-postponed',
                count: postponed.length,
                items: postponed,
                renderItem: j => jobItemHtml(j, 'postponed'),
                navigate: () => ctx.menuNavigate('actual', { actualFilter: 'postponed' }),
            },
            lowStock: {
                key: 'lowStock',
                label: 'Low Stock',
                mark: '📦',
                cls: 'ot-lowstock',
                count: lowStock.length,
                items: lowStock,
                renderItem: lowStockItemHtml,
                navigate: () => {
                    ctx.menuNavigate('spare');
                    TVC_SpareMenu.showLowStockOnly?.();
                },
            },
            requisition: {
                key: 'requisition',
                label: 'Requisition',
                mark: '🧾',
                cls: 'ot-requisition',
                count: requisition.length,
                items: requisition,
                renderItem: requisitionItemHtml,
                navigate: () => {
                    ctx.menuNavigate('spare');
                    TVC_SpareMenu.viewRequisitionList?.();
                },
            },
        };
    }

    function renderDetail(bucket) {
        if (!bucket || openKey !== bucket.key) return '';
        if (!bucket.count) {
            return `<div class="ot-detail ot-detail-empty muted">No outstanding ${esc(bucket.label.toLowerCase())} items.</div>`;
        }
        const shown = bucket.items.slice(0, LIST_CAP);
        const cards = shown.map(item => bucket.renderItem(item)).join('');
        const more = bucket.count > LIST_CAP
            ? `<p class="ot-more muted">+ ${bucket.count - LIST_CAP} more</p>` : '';
        return `<div class="ot-detail" id="otDetailPanel">
            <div class="ot-detail-head">
                <span>${esc(bucket.label)} · ${bucket.count}</span>
                <button type="button" class="btn btn-sm" onclick="TVC_OutstandingTasks.viewAll('${escAttr(bucket.key)}')">View all →</button>
            </div>
            <div class="ot-card-grid">${cards}</div>
            ${more}
        </div>`;
    }

    function renderBuckets(buckets) {
        return KEYS.map(k => {
            const b = buckets[k];
            const hot = b.count > 0;
            const active = openKey === b.key;
            return `<button type="button"
                class="ot-badge ${b.cls}${hot ? ' ot-hot' : ''}${active ? ' active' : ''}"
                onclick="TVC_OutstandingTasks.toggle('${escAttr(b.key)}')"
                aria-expanded="${active ? 'true' : 'false'}"
                ${hot ? '' : ' disabled'}>
                ${renderMarkHtml(b)}
                <span class="ot-badge-label">${esc(b.label)}</span>
                <span class="ot-badge-count">${b.count}</span>
            </button>`;
        }).join('');
    }

    function renderPanel(buckets, loadingReq) {
        const openBucket = openKey ? buckets[openKey] : null;
        return `<section class="outstanding-tasks-panel" aria-label="Outstanding Tasks">
            <header class="ot-head">
                <h3 class="ot-title">Outstanding Tasks</h3>
                ${loadingReq ? '<span class="ot-loading muted">Updating…</span>' : ''}
            </header>
            <div class="ot-badge-grid">${renderBuckets(buckets)}</div>
            ${renderDetail(openBucket)}
        </section>`;
    }

    async function render() {
        const host = document.getElementById('outstandingTasksPanel');
        if (!host || !ctx) return;
        const state = ctx.getState();
        if (!state.user) {
            host.innerHTML = '';
            host.classList.add('hidden');
            return;
        }
        host.classList.remove('hidden');

        const isHq = TVC_RBAC.isHqAccount(state.user);
        if (isHq && !state.selectedVesselId) {
            host.innerHTML = renderPanel(bucketDefs(state, []), false);
            return;
        }

        const syncBuckets = bucketDefs(state, state._outstandingReqCache || []);
        host.innerHTML = renderPanel(syncBuckets, !state._outstandingReqLoaded);

        try {
            const reqRows = await requisitionRows(state);
            state._outstandingReqCache = reqRows;
            state._outstandingReqLoaded = true;
            const buckets = bucketDefs(state, reqRows);
            if (openKey && (!buckets[openKey] || !buckets[openKey].count)) openKey = null;
            host.innerHTML = renderPanel(buckets, false);
        } catch (e) {
            console.warn('[TVC_OutstandingTasks] requisitions', e);
            state._outstandingReqLoaded = true;
        }
    }

    function toggle(key) {
        if (!KEYS.includes(key)) return;
        openKey = openKey === key ? null : key;
        render();
    }

    function viewAll(key) {
        const state = ctx.getState();
        const buckets = bucketDefs(state, state._outstandingReqCache || []);
        const b = buckets[key];
        if (b?.navigate) b.navigate();
    }

    function openItem(key) {
        viewAll(key);
    }

    function reset() {
        openKey = null;
        const state = ctx.getState();
        if (state) {
            state._outstandingReqLoaded = false;
            state._outstandingReqCache = null;
        }
    }

    return { init, render, toggle, viewAll, openItem, reset };
})();
