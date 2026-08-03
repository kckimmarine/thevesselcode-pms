/* THE VESSEL CODE — Menu Outstanding Tasks dashboard */
const TVC_OutstandingTasks = (function () {
    let ctx = null;
    let openKey = null;
    const LIST_CAP = 8;

    const PMS_KEYS = ['overdue', 'due', 'postponed', 'defect'];
    const SPARE_KEYS = ['lowStock', 'legalLowStock', 'requisition'];

    function init(context) { ctx = context; }

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function escAttr(s) { return esc(s); }

    function activeKeys() {
        return PMS_KEYS.concat(SPARE_KEYS);
    }

    function isJobCritical(j) {
        if (!j) return false;
        if (typeof TVC_App?.jobShowsCriticalEquipmentMark === 'function') {
            return !!TVC_App.jobShowsCriticalEquipmentMark(j);
        }
        if (typeof ctx?.jobShowsCriticalEquipmentMark === 'function') {
            return !!ctx.jobShowsCriticalEquipmentMark(j);
        }
        return j.is_critical_equipment === true;
    }

    function defectLinkedJob(dc, state) {
        if (!dc) return null;
        if (dc.maintenance_job_id && state.idx?.jobById) {
            const byId = state.idx.jobById.get(dc.maintenance_job_id);
            if (byId) return byId;
        }
        const code = dc.pms_job_code || dc.job_code;
        if (code && state.jobs) return state.jobs.find(j => j.job_code === code) || null;
        return null;
    }

    function isDefectCritical(dc, state) {
        return isJobCritical(defectLinkedJob(dc, state));
    }

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

    function sparePartClass(s) {
        const raw = s?.partClass ?? s?.part_class ?? '';
        if (window.TVC_SpareSchema?.normalizePartClass) {
            return TVC_SpareSchema.normalizePartClass(raw);
        }
        return String(raw || '').trim().toUpperCase();
    }

    function isLegalLowStock(s) {
        return TVC_Inventory.isLowStock(s) && sparePartClass(s) === 'L';
    }

    function lowStockRows(state) {
        return (state.spares || []).filter(s => spareInDept(state, s) && TVC_Inventory.isLowStock(s));
    }

    function legalLowStockRows(state) {
        return (state.spares || []).filter(s => spareInDept(state, s) && isLegalLowStock(s));
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

    function formatRate(overdue, jobTotal) {
        if (!jobTotal) return '—';
        return `${((overdue / jobTotal) * 100).toFixed(2)}%`;
    }

    /** Total / Non-Critical / Critical × Overdue·Due·Postponed·Defect + Outstanding Rate */
    function buildPmsMatrix(state) {
        const allJobs = ctx.deptJobs() || [];
        const critJobs = allJobs.filter(isJobCritical);
        const nonCritJobs = allJobs.filter(j => !isJobCritical(j));

        const overdueAll = jobRows(state, 'overdue');
        const dueAll = jobRows(state, 'due30');
        const postponedAll = jobRows(state, 'postponed');
        const defectAll = defectRows(state);

        const splitJobs = (rows) => {
            const crit = rows.filter(isJobCritical);
            return { total: rows.length, critical: crit.length, nonCritical: rows.length - crit.length };
        };
        const splitDefects = (rows) => {
            const crit = rows.filter(dc => isDefectCritical(dc, state));
            return { total: rows.length, critical: crit.length, nonCritical: rows.length - crit.length };
        };

        const overdue = splitJobs(overdueAll);
        const due = splitJobs(dueAll);
        const postponed = splitJobs(postponedAll);
        const defect = splitDefects(defectAll);

        return {
            jobTotal: allJobs.length,
            jobCritical: critJobs.length,
            jobNonCritical: nonCritJobs.length,
            overdue,
            due,
            postponed,
            defect,
            rows: [
                {
                    key: 'total',
                    label: 'Total',
                    overdue: overdue.total,
                    due: due.total,
                    postponed: postponed.total,
                    defect: defect.total,
                    rate: formatRate(overdue.total, allJobs.length),
                    strong: true,
                },
                {
                    key: 'nonCritical',
                    label: 'Non-Critical',
                    overdue: overdue.nonCritical,
                    due: due.nonCritical,
                    postponed: postponed.nonCritical,
                    defect: defect.nonCritical,
                    rate: formatRate(overdue.nonCritical, nonCritJobs.length),
                },
                {
                    key: 'critical',
                    label: 'Critical',
                    overdue: overdue.critical,
                    due: due.critical,
                    postponed: postponed.critical,
                    defect: defect.critical,
                    rate: formatRate(overdue.critical, critJobs.length),
                },
            ],
        };
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
        const key = filter === 'due30' ? 'due' : filter;
        return `<button type="button" class="ot-card" onclick="TVC_OutstandingTasks.openItem('${escAttr(key)}')">
            <span class="ot-card-title"><strong>${esc(j.job_code)}</strong></span>
            <span class="ot-card-sub">${esc(title)}</span>
            <span class="ot-card-meta">${esc(stLabel)} · ${esc(j.next_date || '—')}</span>
        </button>`;
    }

    function lowStockItemHtml(s, key = 'lowStock') {
        const stock = TVC_Inventory.currentStock(s);
        const min = TVC_Inventory.minStock(s);
        return `<button type="button" class="ot-card" onclick="TVC_OutstandingTasks.openItem('${escAttr(key)}')">
            <span class="ot-card-title">${esc(s.part_no || '—')}</span>
            <span class="ot-card-sub">${esc(s.name || '')}</span>
            <span class="ot-card-meta">Stock ${stock} / Min ${min}${sparePartClass(s) === 'L' ? ' · Legal' : ''}</span>
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
            case 'lowStock':
                return '<span class="ot-mark ot-mark-lowstock" aria-hidden="true">📦</span>';
            case 'legalLowStock':
                return '<span class="ot-mark ot-mark-legal-low" aria-hidden="true">L</span>';
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
        const legalLowStock = legalLowStockRows(state);
        const requisition = reqRows || [];

        return {
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
            defect: {
                key: 'defect',
                label: 'Defect',
                mark: 'D',
                cls: 'ot-defect',
                count: defect.length,
                items: defect,
                renderItem: dc => defectItemHtml(dc, state),
                navigate: () => ctx.menuNavigate('history'),
            },
            lowStock: {
                key: 'lowStock',
                label: 'Low Stock',
                mark: '📦',
                cls: 'ot-lowstock',
                count: lowStock.length,
                items: lowStock,
                renderItem: s => lowStockItemHtml(s, 'lowStock'),
                navigate: () => {
                    ctx.menuNavigate('spare');
                    TVC_SpareMenu.showLowStockOnly?.();
                },
            },
            legalLowStock: {
                key: 'legalLowStock',
                label: 'Legal Low Stock',
                mark: 'L',
                cls: 'ot-legal-low',
                count: legalLowStock.length,
                items: legalLowStock,
                renderItem: s => lowStockItemHtml(s, 'legalLowStock'),
                navigate: () => {
                    ctx.menuNavigate('spare');
                    if (TVC_SpareMenu.showLegalLowStockOnly) TVC_SpareMenu.showLegalLowStockOnly();
                    else TVC_SpareMenu.setSpareFilter?.('legalLowStock');
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

    function pmsColHead(key, label, count) {
        const hot = count > 0;
        const active = openKey === key;
        return `<button type="button"
            class="ot-pms-colhead ot-pms-${escAttr(key)}${hot ? ' ot-hot' : ''}${active ? ' active' : ''}"
            onclick="TVC_OutstandingTasks.toggle('${escAttr(key)}')"
            aria-expanded="${active ? 'true' : 'false'}"
            ${hot ? '' : ' disabled'}
            title="${esc(label)}">
            ${esc(label)}
        </button>`;
    }

    function pmsTotalBtn(key, label, count) {
        const hot = count > 0;
        const active = openKey === key;
        return `<button type="button"
            class="ot-pms-metric ot-pms-${escAttr(key)}${hot ? ' ot-hot' : ''}${active ? ' active' : ''}"
            onclick="TVC_OutstandingTasks.toggle('${escAttr(key)}')"
            aria-expanded="${active ? 'true' : 'false'}"
            ${hot ? '' : ' disabled'}
            title="${esc(label)}">
            <span class="ot-pms-metric-count">${count}</span>
        </button>`;
    }

    function renderPmsMatrix(state) {
        const matrix = buildPmsMatrix(state);
        const head = `
            <tr>
                <th scope="col" class="ot-pms-corner"></th>
                <th scope="col" class="ot-pms-col-btn">${pmsColHead('overdue', 'Overdue', matrix.overdue.total)}</th>
                <th scope="col" class="ot-pms-col-btn">${pmsColHead('due', 'Due', matrix.due.total)}</th>
                <th scope="col" class="ot-pms-col-btn">${pmsColHead('postponed', 'Postponed', matrix.postponed.total)}</th>
                <th scope="col" class="ot-pms-col-btn">${pmsColHead('defect', 'Defect', matrix.defect.total)}</th>
                <th scope="col" class="ot-pms-rate-h">Outstanding Rate (%)</th>
            </tr>`;
        const body = matrix.rows.map(row => {
            const isTotal = row.key === 'total';
            const cells = isTotal
                ? `
                    <td class="ot-pms-num">${pmsTotalBtn('overdue', 'Overdue', row.overdue)}</td>
                    <td class="ot-pms-num">${pmsTotalBtn('due', 'Due', row.due)}</td>
                    <td class="ot-pms-num">${pmsTotalBtn('postponed', 'Postponed', row.postponed)}</td>
                    <td class="ot-pms-num">${pmsTotalBtn('defect', 'Defect', row.defect)}</td>`
                : `
                    <td class="ot-pms-num"><span class="ot-pms-plain">${row.overdue}</span></td>
                    <td class="ot-pms-num"><span class="ot-pms-plain">${row.due}</span></td>
                    <td class="ot-pms-num"><span class="ot-pms-plain">${row.postponed}</span></td>
                    <td class="ot-pms-num"><span class="ot-pms-plain">${row.defect}</span></td>`;
            const rateCell = isTotal
                ? `<td class="ot-pms-rate ot-pms-rate-total" title="Overdue ÷ Total Job Code">${esc(row.rate)}</td>`
                : `<td class="ot-pms-rate">${esc(row.rate)}</td>`;
            return `<tr class="ot-pms-row${isTotal ? ' ot-pms-row-total' : ''}">
                <th scope="row" class="ot-pms-row-label">${esc(row.label)}</th>
                ${cells}
                ${rateCell}
            </tr>`;
        }).join('');
        return `<div class="ot-section ot-section-pms">
            <h4 class="ot-section-title">PMS Outstanding Code</h4>
            <div class="ot-pms-table-wrap">
                <table class="ot-pms-table" aria-label="PMS Outstanding Code">
                    <thead>${head}</thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
            <p class="ot-pms-rate-note muted">Outstanding Rate (%) = Overdue ÷ Total Job Code</p>
        </div>`;
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

    function renderBuckets(buckets, keys) {
        return keys.map(k => {
            const b = buckets[k];
            if (!b) return '';
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

    function renderSpareSection(buckets) {
        return `<div class="ot-section">
            <h4 class="ot-section-title">SPARE Outstanding Code</h4>
            <div class="ot-badge-grid">${renderBuckets(buckets, SPARE_KEYS)}</div>
        </div>`;
    }

    function renderPanel(buckets, loadingReq, state) {
        const openBucket = openKey ? buckets[openKey] : null;
        return `<section class="outstanding-tasks-panel" aria-label="Outstanding Tasks">
            <header class="ot-head">
                <h3 class="ot-title">Outstanding Tasks</h3>
                ${loadingReq ? '<span class="ot-loading muted">Updating…</span>' : ''}
            </header>
            ${renderPmsMatrix(state)}
            ${renderSpareSection(buckets)}
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

        const keys = activeKeys();
        if (openKey && !keys.includes(openKey)) openKey = null;

        const isHq = TVC_RBAC.isHqAccount(state.user);
        if (isHq && !state.selectedVesselId) {
            host.innerHTML = renderPanel(bucketDefs(state, []), false, state);
            return;
        }

        const syncBuckets = bucketDefs(state, state._outstandingReqCache || []);
        host.innerHTML = renderPanel(syncBuckets, !state._outstandingReqLoaded, state);

        try {
            const reqRows = await requisitionRows(state);
            state._outstandingReqCache = reqRows;
            state._outstandingReqLoaded = true;
            const buckets = bucketDefs(state, reqRows);
            if (openKey && (!buckets[openKey] || !buckets[openKey].count)) openKey = null;
            host.innerHTML = renderPanel(buckets, false, state);
        } catch (e) {
            console.warn('[TVC_OutstandingTasks] requisitions', e);
            state._outstandingReqLoaded = true;
        }
    }

    function toggle(key) {
        if (!activeKeys().includes(key)) return;
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
