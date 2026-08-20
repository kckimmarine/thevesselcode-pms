/* Defect Report UI — Phase 1 (Ship) · Phase 2 (HQ) */
const TVC_DefectReport = (function () {
    let _ctx = null;

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function escAttr(s) {
        return esc(s).replace(/'/g, '&#39;');
    }

    const DF_PICK_Z = 10100;
    const DF_NO_GROUP_KEY = '__NO_GROUP__';
    const DF_NO_GROUP_LABEL = 'No PMS GROUP';
    let _dfGroupPickSearch = '';
    let _dfJobPickSearch = '';
    let _dfJobRowPickUnbind = null;

    function unbindDfJobRowPickListeners() {
        if (_dfJobRowPickUnbind) {
            _dfJobRowPickUnbind();
            _dfJobRowPickUnbind = null;
        }
    }

    function isDfJobRowPickOpen() {
        const menu = document.getElementById('dfJobRowPickMenu');
        return !!(menu && menu.style.display !== 'none' && menu.classList.contains('spare-consume-pick-menu-portal'));
    }

    function bindDfJobRowPickListeners(rowIdx) {
        unbindDfJobRowPickListeners();
        const menu = document.getElementById('dfJobRowPickMenu');
        const close = (e) => {
            if (menu?.contains(e.target) || document.getElementById(`dfJobPickTrigger-${rowIdx}`)?.contains(e.target)) return;
            closeDfJobRowPickMenu();
        };
        const onReposition = () => {
            if (!isDfJobRowPickOpen()) return;
            positionDfJobRowPickMenu(rowIdx);
        };
        setTimeout(() => {
            document.addEventListener('click', close);
            window.addEventListener('scroll', onReposition, true);
            window.addEventListener('resize', onReposition);
        }, 0);
        _dfJobRowPickUnbind = () => {
            document.removeEventListener('click', close);
            window.removeEventListener('scroll', onReposition, true);
            window.removeEventListener('resize', onReposition);
        };
    }
    let _dfActiveJobRowIndex = 0;
    let _dfListSearch = '';
    let _dfListSelId = null;
    let _dfListChecked = {};
    let _dfWrUsedPartsBackup = null;

    function dfTreeLabel(v) {
        return TVC_SpareMenu?.safeTreeLabel?.(v) || String(v || '').trim();
    }

    function dfIsNoGroup(row) {
        const key = dfVal(row, 'pms_group_key');
        const label = dfVal(row, 'pms_group_no');
        return key === DF_NO_GROUP_KEY || label === DF_NO_GROUP_LABEL || label === 'No selection';
    }

    function dfGroupKey(row) {
        if (dfIsNoGroup(row)) return '';
        const key = dfVal(row, 'pms_group_key');
        if (key) return key;
        const job = resolveJob(row);
        if (job?.department && job?.group) return `${job.department}|${String(job.group).trim()}`;
        const label = dfVal(row, 'pms_group_no');
        if (!label) return '';
        const st = getState();
        const node = (TVC_SpareMenu?.getPlanGroupPickNodes?.(st) || [])
            .find(n => n.label === label || String(n.label || '').trim() === String(label).trim());
        return node?.key || '';
    }

    function dfPickMenuEl(wrap) {
        return wrap?._portalMenu || wrap?.querySelector('.spare-consume-pick-menu') || null;
    }

    function dfPickClickInside(wrap, target) {
        if (!wrap || !target) return false;
        const menu = dfPickMenuEl(wrap);
        return wrap.contains(target) || (menu && menu.contains(target));
    }

    function closeDfPickMenu(wrap) {
        if (!wrap) return;
        const menu = dfPickMenuEl(wrap);
        if (menu) {
            menu.classList.remove('spare-consume-pick-menu-portal');
            menu.style.cssText = '';
            if (wrap._portalMenu && menu.parentNode === document.body) wrap.appendChild(menu);
        }
        wrap.classList.remove('open');
    }

    function closeAllDfPicks() {
        closeDfPickMenu(document.getElementById('dfGroupPick'));
        closeDfPickMenu(document.getElementById('dfJobPick'));
        closeDfJobRowPickMenu();
    }

    function closeDfJobRowPickMenu() {
        unbindDfJobRowPickListeners();
        const host = document.getElementById('dfJobRowPickHost');
        const menu = document.getElementById('dfJobRowPickMenu');
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

    function positionDfJobRowPickMenu(rowIdx = 0) {
        const trigger = document.getElementById(`dfJobPickTrigger-${rowIdx}`);
        const menu = document.getElementById('dfJobRowPickMenu');
        if (!trigger || !menu) return;
        if (!menu._portalAttached) menu._portalAttached = true;
        if (menu.parentNode !== document.body) document.body.appendChild(menu);
        menu.classList.add('spare-consume-pick-menu-portal');
        const r = trigger.getBoundingClientRect();
        menu.style.display = 'flex';
        menu.style.flexDirection = 'column';
        menu.style.position = 'fixed';
        menu.style.left = `${r.left}px`;
        menu.style.top = `${r.bottom + 2}px`;
        menu.style.minWidth = `${Math.max(420, r.width)}px`;
        menu.style.width = `${Math.max(420, r.width)}px`;
        menu.style.zIndex = String(DF_PICK_Z);
        menu.style.maxHeight = 'min(420px, 70vh)';
    }

    function positionDfPickMenu(wrap, minWidth = 320) {
        const trigger = wrap.querySelector('.spare-consume-pick-trigger');
        let menu = wrap.querySelector('.spare-consume-pick-menu');
        if (!trigger || !menu) return;
        if (!wrap._portalMenu) wrap._portalMenu = menu;
        if (menu.parentNode !== document.body) document.body.appendChild(menu);
        menu.classList.add('spare-consume-pick-menu-portal');
        const r = trigger.getBoundingClientRect();
        menu.style.display = 'flex';
        menu.style.flexDirection = 'column';
        menu.style.position = 'fixed';
        menu.style.left = `${r.left}px`;
        menu.style.top = `${r.bottom + 2}px`;
        menu.style.minWidth = `${Math.max(minWidth, r.width)}px`;
        menu.style.width = `${Math.max(minWidth, r.width)}px`;
        menu.style.zIndex = String(DF_PICK_Z);
        menu.style.maxHeight = 'min(420px, 70vh)';
    }

    function bindDfPickClose(wrap, minWidth) {
        const close = (e) => {
            if (!dfPickClickInside(wrap, e.target)) {
                closeDfPickMenu(wrap);
                document.removeEventListener('click', close);
                window.removeEventListener('scroll', onReposition, true);
                window.removeEventListener('resize', onReposition);
            }
        };
        const onReposition = () => {
            if (wrap.classList.contains('open')) positionDfPickMenu(wrap, minWidth);
        };
        setTimeout(() => {
            document.addEventListener('click', close);
            window.addEventListener('scroll', onReposition, true);
            window.addEventListener('resize', onReposition);
        }, 0);
    }

    function buildDfGroupPickList(row) {
        const st = getState();
        const selKey = dfVal(row, 'pms_group_key') || dfGroupKey(row) || '';
        const q = (_dfGroupPickSearch || '').toLowerCase().trim();
        const matchNode = (n) => !q || dfTreeLabel(n.label).toLowerCase().includes(q)
            || String(n.department || '').toLowerCase().includes(q);
        const matchNoSelection = !q || 'no pms group'.includes(q) || q.includes('no pms') || q.includes('no group');
        let html = '';
        if (matchNoSelection) {
            const sel = selKey === DF_NO_GROUP_KEY ? ' selected' : '';
            html += `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-none${sel}"
                onclick="TVC_DefectReport.pickDfGroup('${escAttr(DF_NO_GROUP_KEY)}','${escAttr(DF_NO_GROUP_LABEL)}')">${esc(DF_NO_GROUP_LABEL)}</button>`;
        }
        const nodes = (TVC_SpareMenu?.getPlanGroupPickNodes?.(st) || []).filter(matchNode);
        if (!nodes.length && !matchNoSelection) {
            return '<div class="spare-consume-pick-empty muted">Loading PMS GROUP tree…</div>';
        }
        let curDept = '';
        nodes.forEach(n => {
            if (n.department !== curDept) {
                html += `<div class="spare-consume-pick-dept">${esc(n.department)}</div>`;
                curDept = n.department;
            }
            const sel = selKey === n.key ? ' selected' : '';
            html += `<button type="button" class="spare-consume-pick-item${sel}"
                onclick="TVC_DefectReport.pickDfGroup('${escAttr(n.key)}','${escAttr(n.label)}')">${esc(dfTreeLabel(n.label))}</button>`;
        });
        return html || '<div class="spare-consume-pick-empty muted">No results</div>';
    }

    function buildDfJobPickList(row, rowIdx) {
        const st = getState();
        const groupKey = dfGroupKey(row);
        if (!groupKey) {
            return '<div class="spare-consume-pick-empty muted">Select PMS Group No. first.</div>';
        }
        const q = (_dfJobPickSearch || '').toLowerCase().trim();
        const jobs = (TVC_SpareMenu?.getJobsForGroupKey?.(st, groupKey) || []).filter(j => {
            if (!q) return true;
            const hay = [j.job_code, j.item_sort1, j.item_sort2, j.job_detail].join(' ').toLowerCase();
            return hay.includes(q);
        });
        const items = ensureDfJobItems(row);
        const activeRow = items[rowIdx ?? _dfActiveJobRowIndex ?? 0] || {};
        const selectedCode = activeRow.job_code || '';
        const clearBtn = `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-none${selectedCode ? '' : ' selected'}"
                onclick="TVC_DefectReport.clearDfJobRow()">
                <span class="spare-consume-pick-job-code">— No Job Code —</span>
                <span class="spare-consume-pick-job-sub muted">PMS Group only</span>
            </button>`;
        if (!jobs.length) {
            return clearBtn + '<div class="spare-consume-pick-empty muted">No results</div>';
        }
        return clearBtn + jobs.map(j => {
            const sel = selectedCode === j.job_code ? ' selected' : '';
            const sub = [j.item_sort1, j.item_sort2].filter(Boolean).join(' · ');
            return `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-job${sel}"
                onclick="TVC_DefectReport.pickDfJobForRow('${escAttr(j.id)}')">
                <span class="spare-consume-pick-job-code">${esc(j.job_code || '')}</span>
                ${sub ? `<span class="spare-consume-pick-job-sub">${esc(sub)}</span>` : ''}
            </button>`;
        }).join('');
    }

    function refreshDfJobRowPickList() {
        const list = document.getElementById('dfJobRowPickList');
        const row = getState()._dfDraft || {};
        if (list) list.innerHTML = buildDfJobPickList(row, _dfActiveJobRowIndex);
    }

    function refreshDfGroupPickList() {
        const list = document.getElementById('dfGroupPickList');
        const row = getState()._dfDraft || {};
        if (list) list.innerHTML = buildDfGroupPickList(row);
    }

    function refreshDfJobPickList() {
        const list = document.getElementById('dfJobPickList');
        const row = getState()._dfDraft || {};
        if (list) list.innerHTML = buildDfJobPickList(row);
    }

    function dfGroupPickSearch(v) {
        _dfGroupPickSearch = v || '';
        refreshDfGroupPickList();
        const wrap = document.getElementById('dfGroupPick');
        if (wrap?.classList.contains('open')) positionDfPickMenu(wrap, 360);
    }

    function dfJobPickSearch(v) {
        _dfJobPickSearch = v || '';
        refreshDfJobPickList();
        refreshDfJobRowPickList();
        const wrap = document.getElementById('dfJobPick');
        if (wrap?.classList.contains('open')) positionDfPickMenu(wrap, 420);
        const menu = document.getElementById('dfJobRowPickMenu');
        if (isDfJobRowPickOpen()) positionDfJobRowPickMenu(_dfActiveJobRowIndex);
    }

    function dfJobRowPickSearch(v) {
        dfJobPickSearch(v);
        if (!isDfJobRowPickOpen()) return;
        positionDfJobRowPickMenu(_dfActiveJobRowIndex || 0);
    }

    function toggleDfGroupPick(ev) {
        ev?.stopPropagation();
        const wrap = document.getElementById('dfGroupPick');
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        closeDfPickMenu(document.getElementById('dfJobPick'));
        closeDfJobRowPickMenu();
        if (!opening) {
            closeDfPickMenu(wrap);
            return;
        }
        wrap.classList.add('open');
        refreshDfGroupPickList();
        positionDfPickMenu(wrap, 360);
        bindDfPickClose(wrap, 360);
    }

    async function toggleDfJobPick(ev) {
        ev?.stopPropagation();
        const row = getState()._dfDraft || {};
        if (!dfGroupKey(row)) await TVC_Dialog.alert('Select PMS Group No. first.');
        const wrap = document.getElementById('dfJobPick');
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        closeDfPickMenu(document.getElementById('dfGroupPick'));
        if (!opening) {
            closeDfPickMenu(wrap);
            return;
        }
        wrap.classList.add('open');
        refreshDfJobPickList();
        positionDfPickMenu(wrap, 420);
        bindDfPickClose(wrap, 420);
    }

    function rerenderDefectForm() {
        refreshDefectModal();
    }

    function applyDfGroupHeader(st, draft, groupKey, groupLabel) {
        const hdr = TVC_SpareMenu?.resolveGroupHeaderByKey?.(st, groupKey, groupLabel) || {};
        draft.pms_group_key = groupKey;
        draft.pms_group_no = groupLabel;
        draft.machinery_name = hdr.machineryName
            || TVC_App.formatHistGroupEquipmentName?.(groupLabel)
            || draft.machinery_name || '';
        draft.maker = hdr.maker || '';
        draft.manufacturer = hdr.maker || '';
        draft.model_type = hdr.modelType || '';
        draft.capacity = hdr.capacity || '';
        draft.serial_no = hdr.serialNo || '';
        draft.type_model_serial = [hdr.modelType, hdr.serialNo].filter(Boolean).join(' / ');
    }

    function applyDfNoGroupHeader(draft) {
        draft.pms_group_key = DF_NO_GROUP_KEY;
        draft.pms_group_no = DF_NO_GROUP_LABEL;
        draft.machinery_name = '';
        draft.maker = '';
        draft.manufacturer = '';
        draft.model_type = '';
        draft.capacity = '';
        draft.serial_no = '';
        draft.type_model_serial = '';
    }

    function pickDfGroup(groupKey, groupLabel) {
        captureDfFormFields();
        const s = getState();
        const draft = s._dfDraft;
        if (!draft) return;
        const prevKey = draft.pms_group_key || dfGroupKey(draft) || '';
        if (prevKey !== groupKey) {
            draft.maintenance_job_id = '';
            draft.pms_job_code = '';
            draft.item_sort1 = '';
            draft.item_sort2 = '';
            draft.job_detail = '';
            draft.job_items = [TVC_SpareMenu.newConsumeJobRow()];
        }
        if (groupKey === DF_NO_GROUP_KEY) applyDfNoGroupHeader(draft);
        else applyDfGroupHeader(s, draft, groupKey, groupLabel);
        closeDfPickMenu(document.getElementById('dfGroupPick'));
        rerenderDefectForm();
    }

    function applyDfJobPickToDraft(draft, job, rowIdx = 0) {
        const s = getState();
        ensureDfJobItems(draft);
        draft.job_items[rowIdx] = {
            maintenance_job_id: job.id,
            job_code: job.job_code || '',
            sort1: job.item_sort1 || '',
            sort2: job.item_sort2 || '',
            job_detail: job.job_detail || '',
        };
        if (rowIdx === 0) {
            draft.last_maintenance_date = job.last_done || draft.last_maintenance_date || '';
            const hdr = TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
            draft.machinery_name = hdr.machineryName || job.item_sort1 || draft.machinery_name || '';
        }
        syncDfPrimaryJobFromItems(draft);
        TVC_App.syncPlanBatchCheckForJob?.(job.id, true);
    }

    function pickDfJob(jobId) {
        captureDfFormFields();
        captureDfJobItems();
        const s = getState();
        const draft = s._dfDraft;
        if (!draft) return;
        const job = s.idx?.jobById?.get(jobId) || s.jobs?.find(j => j.id === jobId);
        if (!job) return;
        applyDfJobPickToDraft(draft, job, 0);
        closeDfPickMenu(document.getElementById('dfJobPick'));
        closeDfJobRowPickMenu();
        rerenderDefectForm();
    }

    function pickDfJobForRow(jobId) {
        captureDfFormFields();
        captureDfJobItems();
        const s = getState();
        const draft = s._dfDraft;
        if (!draft) return;
        const job = s.idx?.jobById?.get(jobId) || s.jobs?.find(j => j.id === jobId);
        if (!job) return;
        applyDfJobPickToDraft(draft, job, _dfActiveJobRowIndex || 0);
        closeDfJobRowPickMenu();
        rerenderDefectForm();
    }

    function clearDfJobRow() {
        captureDfFormFields();
        captureDfJobItems();
        const s = getState();
        const draft = s._dfDraft;
        if (!draft) return;
        const idx = _dfActiveJobRowIndex || 0;
        ensureDfJobItems(draft);
        draft.job_items[idx] = TVC_SpareMenu.newConsumeJobRow();
        if (idx === 0) {
            draft.maintenance_job_id = '';
            draft.pms_job_code = '';
            draft.item_sort1 = '';
            draft.item_sort2 = '';
            draft.job_detail = '';
            const hdr = resolveDfGroupHeader(s, draft);
            draft.machinery_name = hdr.machineryName || '';
        }
        syncDfPrimaryJobFromItems(draft);
        closeDfJobRowPickMenu();
        rerenderDefectForm();
    }

    function clearDfJob() {
        _dfActiveJobRowIndex = 0;
        clearDfJobRow();
        closeDfPickMenu(document.getElementById('dfJobPick'));
    }

    async function toggleDfJobRowPick(ev, idx) {
        ev?.stopPropagation();
        const row = getState()._dfDraft || {};
        if (!dfGroupKey(row)) await TVC_Dialog.alert('Select PMS Group No. first.');
        const prevIdx = _dfActiveJobRowIndex;
        _dfActiveJobRowIndex = idx;
        const host = document.getElementById('dfJobRowPickHost');
        const menu = document.getElementById('dfJobRowPickMenu');
        if (!host || !menu) return;
        closeDfPickMenu(document.getElementById('dfGroupPick'));
        closeDfPickMenu(document.getElementById('dfJobPick'));
        const isVisible = menu.style.display && menu.style.display !== 'none';
        if (isVisible && prevIdx === idx) {
            closeDfJobRowPickMenu();
            return;
        }
        refreshDfJobRowPickList();
        positionDfJobRowPickMenu(idx);
        bindDfJobRowPickListeners(idx);
    }

    function addDfJobRow() {
        captureDfFormFields();
        captureDfJobItems();
        closeAllDfPicks();
        const draft = getState()._dfDraft;
        if (!draft) return;
        ensureDfJobItems(draft);
        draft.job_items.push(TVC_SpareMenu.newConsumeJobRow());
        rerenderDefectForm();
    }

    function removeDfJobRow(idx) {
        captureDfFormFields();
        captureDfJobItems();
        closeAllDfPicks();
        const draft = getState()._dfDraft;
        if (!draft) return;
        ensureDfJobItems(draft);
        if (draft.job_items.length <= 1) return;
        draft.job_items.splice(idx, 1);
        if (_dfActiveJobRowIndex >= draft.job_items.length) {
            _dfActiveJobRowIndex = Math.max(0, draft.job_items.length - 1);
        }
        syncDfPrimaryJobFromItems(draft);
        rerenderDefectForm();
    }

    function renderDfGroupPick(row, ro) {
        const label = dfVal(row, 'pms_group_no');
        const text = dfIsNoGroup(row)
            ? DF_NO_GROUP_LABEL
            : (label ? dfTreeLabel(label) : '— Select PMS Group —');
        if (ro) {
            return `<input class="wr-ro" value="${esc(text)}" readonly tabindex="-1">`;
        }
        return `<div class="spare-consume-meta-pick" id="dfGroupPick">
            <button type="button" class="wr-maint-job-pick spare-consume-pick-trigger" onclick="TVC_DefectReport.toggleDfGroupPick(event)">
                <span class="spare-consume-pick-text">${esc(text)}</span>
                <span class="spare-consume-pick-caret" aria-hidden="true">▾</span>
            </button>
            <div class="spare-consume-pick-menu" role="listbox" aria-label="PMS Group No.">
                <div class="spare-consume-pick-search">
                    <input type="search" class="search-input" placeholder="Search GROUP…" value="${esc(_dfGroupPickSearch)}"
                        oninput="TVC_DefectReport.dfGroupPickSearch(this.value)" onclick="event.stopPropagation()">
                </div>
                <div class="spare-consume-pick-head muted">PMS GROUP Tree</div>
                <div class="spare-consume-pick-scroll" id="dfGroupPickList"></div>
            </div>
        </div>`;
    }

    function renderDfMaintJobRowHtml(item, idx, opts = {}) {
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
            jobInner = `<button type="button" id="dfJobPickTrigger-${idx}" class="wr-maint-job-pick spare-consume-job-pick-trigger"${jobDisabled ? ' disabled' : ''} onclick="TVC_DefectReport.toggleDfJobRowPick(event, ${idx})">
                    <span class="spare-consume-pick-text">${esc(item.job_code || '— No Job Code —')}</span>
                    <span class="spare-consume-pick-caret" aria-hidden="true">▾</span>
                </button>
                <input type="hidden" data-field="job_code" value="${escAttr(item.job_code || '')}">`;
        }
        const sort1Inner = roInp(item.sort1, 'sort1');
        const sort2Inner = roInp(item.sort2, 'sort2');
        const detailInner = ro
            ? roInp(item.job_detail, 'job_detail')
            : `<input type="text" id="dfJobDetail-${idx}" data-field="job_detail" value="${esc(item.job_detail || '')}">`;
        const actCol = batch && !ro && (opts.rowCount || 0) > 1
            ? `<div class="wr-maint-field df-maint-job-row-act${hideLabels ? ' wr-maint-field-nolabel' : ''}">${hideLabels ? '' : '<label aria-hidden="true">&nbsp;</label>'}<button type="button" class="btn btn-sm spare-consume-job-row-rm" onclick="TVC_DefectReport.removeDfJobRow(${idx})" title="Remove job row" aria-label="Remove job row">×</button></div>`
            : '';
        const gapCls = idx === 0 ? ' wr-maint-grid-gap' : '';
        const gridCols = actCol ? ' wr-maint-grid-4 df-maint-job-grid-batch' : ' wr-maint-grid-4';
        return `<div class="wr-maint-grid${gridCols}${gapCls} df-maint-job-row" data-df-job-row="${idx}" data-job-id="${escAttr(item.maintenance_job_id || '')}">
                ${fld('Job Code', jobInner)}
                ${fld('SORT-1', sort1Inner)}
                ${fld('SORT-2', sort2Inner)}
                ${fld('Job Detail', detailInner)}
                ${actCol}
            </div>`;
    }

    function renderDfJobRowFieldHtml(item, idx, opts = {}) {
        return renderDfMaintJobRowHtml(item, idx, opts);
    }

    function renderDfJobRowsBlock(row, ro) {
        ensureDfJobItems(row);
        const draft = getState()._dfDraft || row;
        const items = draft.job_items;
        const groupKey = dfGroupKey(row);
        const multiJob = items.length > 1 || (!ro && !!groupKey);
        const header = multiJob && TVC_SpareMenu.renderMaintJobRowsHeaderHtml
            ? TVC_SpareMenu.renderMaintJobRowsHeaderHtml({ withActionCol: !ro && items.length > 1 })
            : '';
        const rows = items.map((item, idx) => renderDfJobRowFieldHtml(item, idx, {
            readonly: ro,
            batch: !ro,
            groupKey,
            rowCount: items.length,
            hideLabels: multiJob,
        })).join('');
        const addBtn = !ro && groupKey
            ? `<div class="spare-consume-meta-job-add">
                <button type="button" class="btn btn-sm spare-consume-job-row-add" onclick="TVC_DefectReport.addDfJobRow()" title="Add JOB CODE row">+</button>
               </div>`
            : '';
        const pickHost = !ro
            ? `<div id="dfJobRowPickHost" class="spare-consume-job-pick-host hidden" aria-hidden="true">
                <div id="dfJobRowPickMenu" class="spare-consume-pick-menu" role="listbox" aria-label="JOB CODE" style="display:none">
                    <div class="spare-consume-pick-search">
                        <input type="search" class="search-input" placeholder="Search JOB CODE / SORT / DETAIL…" value="${esc(_dfJobPickSearch)}"
                            oninput="TVC_DefectReport.dfJobRowPickSearch(this.value)" onclick="event.stopPropagation()">
                    </div>
                    <div class="spare-consume-pick-scroll" id="dfJobRowPickList"></div>
                </div>
            </div>`
            : '';
        return `<div class="df-page1-job-rows wr-maint-span-all" id="dfJobRows">${header}${rows}${addBtn}</div>${pickHost}`;
    }

    function renderDfJobPick(row, ro) {
        return renderDfJobRowsBlock(row, ro);
    }

    function init(ctx) { _ctx = ctx; }

    function getState() { return _ctx?.getState?.() || {}; }

    function normalizeDfJobCode(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        return TVC_App.isPlaceholderJobCode?.(s) ? '' : s;
    }

    function dfHasLinkedJob(row) {
        const items = row?.job_items;
        if (Array.isArray(items) && items.some(i => normalizeDfJobCode(i.job_code))) return true;
        return !!normalizeDfJobCode(dfVal(row, 'pms_job_code')) || !!String(dfVal(row, 'maintenance_job_id') || '').trim();
    }

    function syncDfPrimaryJobFromItems(draft) {
        if (!draft) return;
        const items = Array.isArray(draft.job_items) ? draft.job_items : [];
        const primary = items.find(i => normalizeDfJobCode(i.job_code)) || items[0];
        const jobCode = normalizeDfJobCode(primary?.job_code);
        if (!primary || !jobCode) {
            draft.maintenance_job_id = '';
            draft.pms_job_code = '';
            draft.item_sort1 = '';
            draft.item_sort2 = '';
            draft.job_detail = '';
            return;
        }
        draft.maintenance_job_id = primary.maintenance_job_id || '';
        draft.pms_job_code = jobCode;
        draft.item_sort1 = primary.sort1 || '';
        draft.item_sort2 = primary.sort2 || '';
        draft.job_detail = primary.job_detail || '';
    }

    function resolveDfGroupHeader(st, row) {
        const groupKey = dfGroupKey(row);
        if (!groupKey) return {};
        return TVC_SpareMenu?.resolveGroupHeaderByKey?.(st, groupKey, dfVal(row, 'pms_group_no')) || {};
    }

    /** Submit/Save 전 — machinery_name·Job 연동 필드 정규화 */
    function normalizeDfSubmitRow(st, row) {
        const rawItems = Array.isArray(row.job_items) ? row.job_items : [];
        row.job_items = rawItems
            .map(i => ({
                job_code: normalizeDfJobCode(i.job_code),
                sort1: i.sort1 || '',
                sort2: i.sort2 || '',
                job_detail: i.job_detail || '',
                maintenance_job_id: i.maintenance_job_id || '',
            }))
            .filter(i => i.job_code);
        syncDfPrimaryJobFromItems(row);
        const hasJob = row.job_items.length > 0 || dfHasLinkedJob(row);
        if (!hasJob) {
            row.maintenance_job_id = '';
            row.pms_job_code = '';
            row.item_sort1 = '';
            row.item_sort2 = '';
            row.job_detail = '';
            row.job_items = [];
        }
        const groupHdr = resolveDfGroupHeader(st, row);
        const job = hasJob ? resolveJob(row) : null;
        const jobHdr = job && TVC_SpareMenu?.resolveWrJobHeader?.(st, job) || {};
        if (hasJob) {
            row.machinery_name = String(row.machinery_name || '').trim()
                || String(row.job_name || '').trim()
                || String(row.item_sort1 || job?.item_sort1 || '').trim()
                || String(groupHdr.machineryName || jobHdr.machineryName || '').trim()
                || dfTreeLabel(row.pms_group_no || '');
        } else {
            row.machinery_name = String(row.machinery_name || '').trim()
                || String(groupHdr.machineryName || '').trim()
                || TVC_App.formatHistGroupEquipmentName?.(row.pms_group_no || '')
                || dfTreeLabel(row.pms_group_no || '');
        }
        return row;
    }

    function resolveJob(row) {
        const s = getState();
        if (!row?.maintenance_job_id) return null;
        return s.idx?.jobById?.get(row.maintenance_job_id)
            || s.jobs?.find(j => j.id === row.maintenance_job_id)
            || null;
    }

    function reportedByLabel(row) {
        const u = getState().user;
        if (!row?.reported_by) return TVC_RBAC.getReportedByLabel?.(u) || '';
        if (u?.username === row.reported_by) return TVC_RBAC.getReportedByLabel(u);
        const title = TVC_RBAC.getAccountTitle?.(row.reported_by);
        if (title && title !== 'User') return title;
        return TVC_RBAC.normalizeReportedByLabel?.(row.reported_by) || row.reported_by;
    }

    function ensureDfDraft(row) {
        const s = getState();
        if (!s._dfDraft || s._dfCaseId !== row.id) {
            s._dfCaseId = row.id;
            s._dfDraft = {
                ...row,
                ship_attachments: Array.isArray(row.ship_attachments) ? row.ship_attachments.map(a => ({ ...a })) : [],
                company_attachments: Array.isArray(row.company_attachments) ? row.company_attachments.map(a => ({ ...a })) : [],
                used_parts: Array.isArray(row.used_parts) ? row.used_parts.map(p => ({ ...p })) : [],
                job_items: Array.isArray(row.job_items) ? row.job_items.map(i => ({ ...i })) : [],
            };
        }
        return s._dfDraft;
    }

    function enrichDfUsedParts(lines) {
        const s = getState();
        return (lines || []).map(line => {
            const spare = (s.spares || []).find(sp => sp.id === line.spare_part_id);
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

    function ensureDfUsedParts(row) {
        const s = getState();
        if (s._dfUsedPartsCaseId !== row.id) {
            s._dfUsedPartsCaseId = row.id;
            s._dfUsedParts = enrichDfUsedParts(row.used_parts || []);
        }
        return s._dfUsedParts;
    }

    function captureDfUsedParts() {
        const host = document.getElementById('defectReportBody');
        const s = getState();
        const onPage2 = (s._dfPage || '1') === '2' && !!document.getElementById('wrSpareListScroll');
        const list = onPage2 ? (s._wrUsedParts || s._dfUsedParts || []) : (s._dfUsedParts || []);
        if (host) {
            host.querySelectorAll('.spare-consume-qty-input').forEach(el => {
                const table = el.closest('[data-spare-id]');
                const id = table?.dataset?.spareId;
                if (!id) return;
                const line = list.find(p => String(p.spare_part_id ?? '') === String(id));
                if (line) line.qty_used = Math.max(0, Math.floor(Number(el.value) || 0));
            });
        }
        s._dfUsedParts = list.map(p => ({ ...p }));
        return s._dfUsedParts;
    }

    function dfUsedPartsPayload() {
        return (getState()._dfUsedParts || [])
            .filter(p => Number(p.qty_used) > 0)
            .map(p => ({ spare_part_id: p.spare_part_id, qty_used: Number(p.qty_used) || 0 }));
    }

    function dfSpareContextEnter() {
        const s = getState();
        _dfWrUsedPartsBackup = s._wrUsedParts;
        s._wrUsedParts = s._dfUsedParts || [];
    }

    function dfSpareContextLeave() {
        const s = getState();
        s._dfUsedParts = (s._wrUsedParts || []).map(p => ({ ...p }));
        if (_dfWrUsedPartsBackup !== null) {
            s._wrUsedParts = _dfWrUsedPartsBackup;
            _dfWrUsedPartsBackup = null;
        }
    }

    function ensureDfJobItems(row) {
        const draft = getState()._dfDraft;
        if (!draft) return [];
        if (Array.isArray(draft.job_items) && draft.job_items.length) {
            return draft.job_items;
        }
        if (Array.isArray(row?.job_items) && row.job_items.length) {
            draft.job_items = row.job_items.map(i => ({
                ...TVC_SpareMenu.newConsumeJobRow(i),
                maintenance_job_id: i.maintenance_job_id || '',
            }));
            return draft.job_items;
        }
        const job = resolveJob(row);
        draft.job_items = [{
            ...TVC_SpareMenu.newConsumeJobRow({
                job_code: normalizeDfJobCode(dfVal(row, 'pms_job_code', job?.job_code || row?.job_code || '')),
                sort1: dfVal(row, 'item_sort1', job?.item_sort1 || ''),
                sort2: dfVal(row, 'item_sort2', job?.item_sort2 || ''),
                job_detail: Array.isArray(row?.job_items) && row.job_items.length
                    ? (row.job_items[0]?.job_detail ?? '')
                    : dfVal(row, 'job_detail', job?.job_detail || ''),
            }),
            maintenance_job_id: row?.maintenance_job_id || job?.id || '',
        }];
        return draft.job_items;
    }

    function captureDfJobItems() {
        const draft = getState()._dfDraft;
        if (!draft) return;
        const container = document.getElementById('dfJobRows');
        if (!container) return;
        const prevItems = ensureDfJobItems(draft);
        const rowEls = container.querySelectorAll('[data-df-job-row]');
        if (!rowEls.length) return;
        draft.job_items = [...rowEls].map((rowEl, idx) => {
            const prev = prevItems[idx] || {};
            const hiddenCode = rowEl.querySelector('input[data-field="job_code"]')?.value;
            const jobCode = normalizeDfJobCode(hiddenCode) || normalizeDfJobCode(prev.job_code);
            return {
                job_code: jobCode,
                sort1: rowEl.querySelector('[data-field="sort1"]')?.value?.trim() ?? prev.sort1 ?? '',
                sort2: rowEl.querySelector('[data-field="sort2"]')?.value?.trim() ?? prev.sort2 ?? '',
                job_detail: rowEl.querySelector('[data-field="job_detail"]')?.value?.trim() ?? prev.job_detail ?? '',
                maintenance_job_id: rowEl.dataset.jobId || prev.maintenance_job_id || '',
            };
        });
        syncDfPrimaryJobFromItems(draft);
    }

    function ensureDfPage2JobItems(row) {
        return ensureDfJobItems(row);
    }

    function buildDfPage2Meta(row) {
        const s = getState();
        const job = resolveJob(row);
        const groupHdr = resolveDfGroupHeader(s, row);
        const jobHdr = job && TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
        const allJobItems = ensureDfJobItems(row);
        const jobItems = allJobItems.filter(i => String(i.job_code || '').trim());
        return {
            reportDate: dfVal(row, 'report_date', row.report_date || ''),
            workDate: dfVal(row, 'work_date', row.work_date || ''),
            reportedBy: reportedByLabel(row),
            pmsGroupNo: dfVal(row, 'pms_group_no', jobHdr.pmsGroupNo || groupHdr.pmsGroupNo || row.pms_group_no || ''),
            groupKey: dfGroupKey(row) || row.pms_group_key || '',
            jobCode: dfVal(row, 'pms_job_code', job?.job_code || row.job_code || ''),
            sort1: dfVal(row, 'item_sort1', job?.item_sort1 || ''),
            sort2: dfVal(row, 'item_sort2', job?.item_sort2 || ''),
            jobDetail: dfVal(row, 'job_detail', job?.job_detail || ''),
            shipComments: '',
            jobItems,
            allowAdd: false,
        };
    }

    function renderDfPage2Body(row, ro) {
        return TVC_SpareMenu.renderWrSparePage2Html(null, ro, {
            ...buildDfPage2Meta(row),
            allowAdd: false,
        });
    }

    function syncDfSparePage2Ui(onPage2, ro) {
        if (onPage2) {
            dfSpareContextEnter();
            TVC_SpareMenu.initWrSparePage2(ro);
        } else {
            TVC_SpareMenu.teardownWrSparePage2();
            dfSpareContextLeave();
        }
    }

    function teardownDfSpareUi() {
        if ((getState()._dfPage || '1') === '2') captureDfUsedParts();
        TVC_SpareMenu.teardownWrSparePage2();
        dfSpareContextLeave();
    }

    function dfVal(row, key, fallback = '') {
        const draft = getState()._dfDraft;
        if (draft && Object.prototype.hasOwnProperty.call(draft, key)) {
            const v = draft[key];
            return v == null ? '' : v;
        }
        if (row && Object.prototype.hasOwnProperty.call(row, key)) {
            const rv = row[key];
            return rv == null ? '' : rv;
        }
        return fallback ?? '';
    }

    function upsertDefectCaseInState(row) {
        if (!row?.id) return;
        const s = getState();
        if (!Array.isArray(s.defectCases)) s.defectCases = [];
        const i = s.defectCases.findIndex(c => c.id === row.id);
        if (i >= 0) s.defectCases[i] = row;
        else s.defectCases.push(row);
    }

    function syncDfDraftFromRow(row) {
        const s = getState();
        if (!row?.id) return;
        s._dfCaseId = row.id;
        s._dfDraft = {
            ...row,
            ship_attachments: Array.isArray(row.ship_attachments) ? row.ship_attachments.map(a => ({ ...a })) : [],
            company_attachments: Array.isArray(row.company_attachments) ? row.company_attachments.map(a => ({ ...a })) : [],
            used_parts: Array.isArray(row.used_parts) ? row.used_parts.map(p => ({ ...p })) : [],
            job_items: Array.isArray(row.job_items) ? row.job_items.map(i => ({ ...i })) : [],
        };
    }

    function captureDfFormFields() {
        const host = document.getElementById('defectReportBody');
        const draft = { ...(getState()._dfDraft || {}) };
        if (!host) {
            getState()._dfDraft = draft;
            return draft;
        }
        host.querySelectorAll('[data-df]').forEach(el => {
            const key = el.dataset.df;
            if (el.type === 'radio') return;
            if (el.type === 'checkbox') draft[key] = el.checked;
            else draft[key] = el.value;
        });
        if (draft.shore_support) draft.shore_technician = true;
        else if (draft.shore_technician && draft.shore_support == null) draft.shore_support = true;
        host.querySelectorAll('input[type=radio][data-df]:checked').forEach(el => {
            const key = el.dataset.df;
            if (key === 'dp_closed_satisfactory') draft[key] = el.value === 'true';
            else draft[key] = el.value;
        });
        getState()._dfDraft = draft;
        return draft;
    }

    function dfAttachmentList(kind) {
        const draft = getState()._dfDraft;
        if (!draft) return [];
        const key = kind === 'company' ? 'company_attachments' : 'ship_attachments';
        if (!Array.isArray(draft[key])) draft[key] = [];
        return draft[key];
    }

    function readDfAttachmentFile(file) {
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

    function renderDfAttachmentBlock(kind, { canUpload, forPrint = false }) {
        const label = kind === 'company' ? "Company's Attachment" : "Ship's Attachment";
        const inputId = kind === 'company' ? 'dfCompanyAttachInput' : 'dfShipAttachInput';
        const list = dfAttachmentList(kind);
        const items = list.map(a => TVC_Attachments.renderListItemHtml(a, {
            forPrint,
            canRemove: !forPrint && canUpload,
            removeOnclick: (!forPrint && canUpload)
                ? `TVC_DefectReport.removeAttachment('${kind}','${esc(a.id)}')`
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
               <input type="file" id="${inputId}" class="hidden" multiple onchange="TVC_DefectReport.uploadAttachment('${kind}')">`
            : `<button type="button" class="wr-attach-btn" disabled tabindex="-1">📎 ${esc(label)}</button>`;
        const listHtml = list.length ? `<ul class="wr-attach-list">${items}</ul>` : '';
        return `<div class="wr-attach-block">
            <div class="wr-attach-toolbar">${uploadBtn}</div>
            ${listHtml ? `<div class="wr-attach-list-wrap">${listHtml}</div>` : ''}
        </div>`;
    }

    async function uploadAttachment(kind) {
        const inputId = kind === 'company' ? 'dfCompanyAttachInput' : 'dfShipAttachInput';
        const input = document.getElementById(inputId);
        if (!input?.files?.length) return;
        captureDfFormFields();
        const list = dfAttachmentList(kind);
        const maxBytes = 8 * 1024 * 1024;
        try {
            for (const file of input.files) {
                if (file.size > maxBytes) {
                    await TVC_Dialog.alert(`${file.name}: Only files up to 8 MB can be attached.`);
                    continue;
                }
                list.push(await readDfAttachmentFile(file));
            }
        } catch (e) {
            await TVC_Dialog.alert(e.message || 'Could not read the file.');
        }
        input.value = '';
        refreshDefectModal({ preserveScroll: true });
    }

    async function removeAttachment(kind, attId) {
        captureDfFormFields();
        const list = dfAttachmentList(kind);
        const i = list.findIndex(a => a.id === attId);
        if (i >= 0) list.splice(i, 1);
        refreshDefectModal({ preserveScroll: true });
    }

    function refresh() { _ctx?.refresh?.(); }

    function isHq() {
        const s = getState();
        return s.user && TVC_RBAC.isHqAccount(s.user);
    }

    function filteredCases() {
        const s = getState();
        let rows = [...(s.defectCases || [])];
        if (isHq()) {
            rows = rows.filter(r =>
                r.hq_synced === true
                || r.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
                || r.status === TVC_DefectCase.Status.AWAITING_COMPLETION
                || (r.status === TVC_DefectCase.Status.DRAFT && r.visible_in_list !== false)
            );
            if (s.selectedVesselId) rows = rows.filter(r => r.vessel_id === s.selectedVesselId);
        } else if (s.department) {
            rows = rows.filter(r => TVC_DefectCase.belongsToDepartment(r, s.department));
        }
        return rows.filter(r => r.visible_in_list !== false);
    }

    function defectListWorkflowStatus(row) {
        return TVC_DefectCase.listWorkflowStatus(row);
    }

    function defectListWorkflowTone(row) {
        return TVC_DefectCase.listWorkflowTone(defectListWorkflowStatus(row));
    }

    function statusLabel(row) {
        return defectListWorkflowStatus(row);
    }

    function statusTone(row) {
        return defectListWorkflowTone(row);
    }

    function formatDfDate(v) {
        return v ? String(v).slice(0, 10) : '';
    }

    function formatDfGroupNoShort(v) {
        const s = String(v || '').trim();
        if (!s) return '';
        const m = s.match(/^(\d+(?:\s*~\s*\d+)?)/);
        return m ? m[1].replace(/\s+/g, '') : s;
    }

    function defectListHasJob(row) {
        return !!TVC_App.defectEffectiveJobCode?.(row) || !!String(row.maintenance_job_id || '').trim();
    }

    function defectListColumns(row) {
        if (defectListHasJob(row)) {
            return {
                jobCode: row.pms_job_code || row.job_code || '',
                sort1: row.item_sort1 || row.machinery_name || '',
                sort2: row.item_sort2 || '',
            };
        }
        const jobName = String(row.job_name || '').trim();
        const equipName = formatDfGroupEquipmentName(row.pms_group_no)
            || (String(row.machinery_name || '').trim() !== jobName ? String(row.machinery_name || '').trim() : '');
        if (row.pms_group_no && !dfIsNoGroup(row)) {
            return {
                jobCode: formatDfGroupNoShort(row.pms_group_no),
                sort1: equipName,
                sort2: jobName,
            };
        }
        return {
            jobCode: '',
            sort1: equipName || jobName,
            sort2: jobName && equipName ? jobName : '',
        };
    }

    function formatDfGroupEquipmentName(v) {
        return TVC_App.formatHistGroupEquipmentName?.(v) || '';
    }

    function defectListClosedOut(row) {
        if (row.status !== TVC_DefectCase.Status.CLOSED) return '';
        return formatDfDate(row.dp_closed_date || row.closed_at || row.ship_verified_date);
    }

    function defectListRowsRaw() {
        return filteredCases().sort((a, b) => TVC_App.compareDefectCaseByReportedDate(a, b));
    }

    function matchDfListSearch(row) {
        return TVC_App.matchDefectHistSearch?.(row, _dfListSearch) ?? true;
    }

    function matchDfListPeriod(row) {
        return TVC_App.matchReportPeriodDate?.(TVC_App.defectCaseReportDate?.(row) || '') ?? true;
    }

    function hasDfListFilterActive() {
        return !!(_dfListSearch || TVC_App.hasReportPeriodFilter?.());
    }

    function defectListRows() {
        return defectListRowsRaw().filter(r =>
            matchDfListSearch(r) && matchDfListPeriod(r)
        );
    }

    function getSelectedDfRow() {
        if (!_dfListSelId) return null;
        return defectListRows().find(r => r.id === _dfListSelId) || null;
    }

    function getCheckedDfListIds() {
        return Object.keys(_dfListChecked || {}).filter(id => _dfListChecked[id]);
    }

    function isDefectReportConfirmable(row) {
        if (!row || !getState().user) return false;
        if (row.visible_in_list === false) return false;
        if (row.confirmed_at || row.confirmed_by) return false;
        if (row.approved_at || row.approved_by) return false;
        if (row.status === TVC_DefectCase.Status.CLOSED) return false;
        return TVC_RBAC.canConfirmDepartment(getState().user, row.department);
    }

    function isDfListRowCheckable(row) {
        if (!getState().user) return false;
        if (isHq()) return row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY;
        return isDefectReportConfirmable(row) || canDeleteDfListRow(row);
    }

    function isDfListRowConfirmable(row) {
        if (!getState().user) return false;
        if (isHq()) return row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY;
        return isDefectReportConfirmable(row);
    }

    function canModifyDfListRow(row) {
        if (!row || !getState().user) return false;
        if (!TVC_DefectCase.canModifyListWorkflow(row)) return false;
        const st = TVC_DefectCase.listWorkflowStatus(row);
        if (isHq()) {
            if (st === 'Approved') return false;
            return st === 'Submitted' || TVC_RBAC.canModifyDeleteListReport(getState().user, row.department, st);
        }
        return TVC_RBAC.canModifyDeleteListReport(getState().user, row.department, st);
    }

    /** HQ — HQ reply export 전까지 Modify (Approved 포함) */
    function canModifyDfHqRow(row) {
        if (!row || !getState().user || !isHq()) return false;
        if (row.status === TVC_DefectCase.Status.CLOSED) return false;
        if (TVC_DefectCase.isHqReplyExported(row)) return false;
        const shipSubmitted = !!(row.confirmed_at || row.confirmed_by || row.phase1_locked || row.submitted_at
            || row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
            || row.status === TVC_DefectCase.Status.COMPANY_REVIEWED);
        return shipSubmitted;
    }

    function canEditDfCompanyReply(row, forceView) {
        if (forceView || !isHq() || !row) return false;
        if (TVC_DefectCase.isHqReplyExported(row)) return false;
        if (row.status === TVC_DefectCase.Status.CLOSED) return false;
        const shipSubmitted = !!(row.confirmed_at || row.confirmed_by || row.phase1_locked || row.submitted_at
            || row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
            || row.status === TVC_DefectCase.Status.COMPANY_REVIEWED);
        return shipSubmitted;
    }

    function canSaveDfHqInitialReply(row) {
        return canEditDfCompanyReply(row, false);
    }

    function hqSuperintendentApprovalLabel(user) {
        return TVC_RBAC.getRankLabel(user) || 'Superintendent';
    }

    /** Submitted / Approved — Ship's Comments 등 선박 확인 섹션만 Modify */
    function canModifyDfShipCommentsOnly(row) {
        if (!row || !getState().user || isHq()) return false;
        if (row.status === TVC_DefectCase.Status.CLOSED) return false;
        const st = TVC_DefectCase.listWorkflowStatus(row);
        if (!['Reported', 'Confirmed', 'Submitted', 'Approved'].includes(st)) return false;
        if (TVC_DefectCase.isPhase1Editable(row)) return false;
        if (st === 'Submitted' || st === 'Approved') {
            return TVC_RBAC.canConfirmDepartment(getState().user, row.department);
        }
        return TVC_RBAC.canModifyDeleteListReport(getState().user, row.department, st);
    }

    function dfModifyDisabledTitle(row) {
        if (!row || canOpenDfModifyRow(row)) return '';
        if (isHq()) {
            if (TVC_DefectCase.isHqReplyExported(row)) return 'HQ reply exported — modify not available';
            return 'Modify not available';
        }
        const st = TVC_DefectCase.listWorkflowStatus(row);
        if (st === 'Submitted') return 'Submitted — modify not available';
        if (st === 'Approved') return 'Approved — modify not available';
        return 'Modify not available';
    }

    function canOpenDfModifyRow(row) {
        if (!row || !getState().user) return false;
        if (!isHq()) {
            const st = TVC_DefectCase.listWorkflowStatus(row);
            if (st === 'Submitted') return false;
            if (st === 'Approved') {
                return TVC_DefectCase.isShipVerificationEditable(row);
            }
        } else if (TVC_DefectCase.isHqReplyExported(row)) {
            return false;
        }
        return canModifyDfListRow(row) || canModifyDfShipCommentsOnly(row) || canModifyDfHqRow(row);
    }

    function canEditDfShipCommentsSection(row, forceView) {
        if (forceView || isHq() || !row || !getState().user) return false;
        if (row.status === TVC_DefectCase.Status.CLOSED) return false;
        if (TVC_DefectCase.isShipVerificationEditable(row)) return true;
        const st = TVC_DefectCase.listWorkflowStatus(row);
        if (!['Draft', 'Reported', 'Confirmed', 'Submitted', 'Approved'].includes(st)) return false;
        if (st === 'Submitted' || st === 'Approved') {
            return TVC_RBAC.canConfirmDepartment(getState().user, row.department);
        }
        return TVC_RBAC.canModifyDeleteListReport(getState().user, row.department, st);
    }

    function canDeleteDfListRow(row) {
        if (!row || !getState().user || isHq()) return false;
        if (!TVC_DefectCase.canDeleteListWorkflow(row)) return false;
        const st = TVC_DefectCase.listWorkflowStatus(row);
        return TVC_RBAC.canModifyDeleteListReport(getState().user, row.department, st);
    }

    function dfListCheckDisabledTitle(row) {
        if (!getState().user) return 'Sign in required';
        if (isHq()) {
            if (row.status !== TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) return 'Only items awaiting HQ review can be selected';
            return 'Not selectable';
        }
        if (row.status !== TVC_DefectCase.Status.DRAFT && !canDeleteDfListRow(row)) return 'No delete permission';
        if (row.phase1_locked && !canDeleteDfListRow(row)) return 'No delete permission';
        return 'Not selectable';
    }

    function pruneDfListChecked() {
        const valid = new Set(defectListRows().map(r => r.id));
        Object.keys(_dfListChecked || {}).forEach(id => {
            if (!valid.has(id) || !_dfListChecked[id]) delete _dfListChecked[id];
        });
    }

    function bindDfListTableEvents() {
        const body = document.getElementById('defectTabBody');
        if (!body || body._dfListEventsBound) return;
        body._dfListEventsBound = true;
        TVC_App.initHistCellTips?.();
        body.addEventListener('change', (ev) => {
            const cb = ev.target.closest('.df-list-chk-input');
            if (!cb || cb.disabled) return;
            const row = cb.closest('tr[data-df-id]');
            if (!row) return;
            ev.stopPropagation();
            toggleDfListCheck(row.dataset.dfId, cb.checked, { rerender: false });
        });
        body.addEventListener('click', (ev) => {
            if (ev.target.closest('.hist-chk')) ev.stopPropagation();
        });
    }

    function updateDfListToolbarState() {
        const row = getSelectedDfRow();
        const checked = getCheckedDfListIds();
        const checkedRows = defectListRows().filter(r => _dfListChecked?.[r.id]);
        const canConfirm = checkedRows.length > 0
            && checkedRows.every(isDfListRowConfirmable);
        const setDis = (id, dis) => {
            const el = document.getElementById(id);
            if (el) { if (dis) el.setAttribute('disabled', ''); else el.removeAttribute('disabled'); }
        };
        const setVis = (id, show) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !show);
        };
        setDis('dfBtnDetail', !row);
        setVis('dfBtnModify', !!row);
        setDis('dfBtnModify', !row || !canOpenDfModifyRow(row));
        const dfModBtn = document.getElementById('dfBtnModify');
        if (dfModBtn) {
            const modTip = row ? dfModifyDisabledTitle(row) : '';
            if (modTip) dfModBtn.setAttribute('title', modTip);
            else dfModBtn.removeAttribute('title');
        }
        setDis('dfBtnDelete', !(row && canDeleteDfListRow(row)) && !checkedRows.some(canDeleteDfListRow));
        setDis('dfBtnConfirm', !canConfirm && !(row && isDfListRowConfirmable(row)));

        const approvable = defectListRows().filter(isDfListRowCheckable);
        const allEl = document.getElementById('dfSelectAll');
        if (allEl && approvable.length) {
            const allOn = approvable.every(r => _dfListChecked[r.id]);
            allEl.checked = allOn;
            allEl.indeterminate = !allOn && approvable.some(r => _dfListChecked[r.id]);
        } else if (allEl) {
            allEl.checked = false;
            allEl.indeterminate = false;
        }
    }

    function toggleDfListCheck(id, on, opts = {}) {
        _dfListChecked = _dfListChecked || {};
        if (on) _dfListChecked[id] = true;
        else delete _dfListChecked[id];
        if (opts.rerender === false) {
            updateDfListToolbarState();
            return;
        }
        renderTab();
    }

    function toggleDfListSelectAll(on) {
        _dfListChecked = _dfListChecked || {};
        defectListRows().filter(isDfListRowCheckable).forEach(r => {
            if (on) _dfListChecked[r.id] = true;
            else delete _dfListChecked[r.id];
        });
        renderTab();
    }

    function selectDfListRow(id, ev) {
        if (ev?.target?.closest?.('.hist-chk')) return;
        _dfListSelId = id;
        renderTab();
    }

    function dfListSearch(v) {
        _dfListSearch = v || '';
        renderTab();
        TVC_App.updateSearchClearBtn?.('dfListSearch');
    }

    function clearDfListSearch() {
        _dfListSearch = '';
        const el = document.getElementById('dfListSearch');
        if (el) el.value = '';
        TVC_App.updateSearchClearBtn?.('dfListSearch');
        renderTab();
        el?.focus();
    }

    function defectNavList() {
        return defectListRows();
    }

    function defectListNavBounds() {
        const list = defectNavList();
        if (!list.length) return { atFirst: true, atLast: true };
        const curId = getState()._defectCaseId;
        let i = list.findIndex(r => r.id === curId);
        if (i < 0) i = 0;
        return { atFirst: i <= 0, atLast: i >= list.length - 1 };
    }

    function defectNavButtonsHtml() {
        const s = getState();
        if (s._dfNavSource === 'history' && TVC_App?.histNavButtonsHtml) {
            return TVC_App.histNavButtonsHtml('TVC_DefectReport.navDefectModal(-1)', 'TVC_DefectReport.navDefectModal(1)');
        }
        const { atFirst, atLast } = defectListNavBounds();
        return `<button type="button" class="btn" onclick="TVC_DefectReport.navDefectModal(-1)"${atFirst ? ' disabled' : ''}>&laquo; Previous</button>
            <button type="button" class="btn" onclick="TVC_DefectReport.navDefectModal(1)"${atLast ? ' disabled' : ''}>Next &raquo;</button>`;
    }

    async function navDefectModal(dir) {
        const s = getState();
        if (s._dfNavSource === 'history') {
            TVC_App.navWorkHistoryEntry(dir);
            return;
        }
        const list = defectNavList();
        if (!list.length) return;
        const curId = getState()._defectCaseId;
        let i = list.findIndex(r => r.id === curId);
        if (i < 0) i = 0; else i += dir;
        if (i < 0 || i >= list.length) return;
        const mode = getState()._defectMode === 'view' ? 'view' : (getState()._defectMode || 'edit');
        openCase(list[i].id, mode);
    }

    async function modifyDefectModal() {
        const id = getState()._defectCaseId;
        if (!id) return;
        const row = (getState().defectCases || []).find(c => c.id === id);
        if (row && !canOpenDfModifyRow(row)) {
            const st = TVC_DefectCase.listWorkflowStatus(row);
            if (!isHq() && (st === 'Submitted' || st === 'Approved')) {
                await TVC_Dialog.alert("Only Captain / Chief Engineer can edit Ship's Comments in Submitted or Approved status.");
            } else {
                await TVC_Dialog.alert('Modify permission denied.');
            }
            return;
        }
        const mode = row && (getState()._dfNavSource === 'list' || getState()._dfNavSource === 'history')
            ? resolveDfOpenMode(row)
            : 'edit';
        const s = getState();
        s._dfCaseId = null;
        s._dfDraft = null;
        openCase(id, mode);
    }

    async function cancelDefectModalEdit() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        if (s._dfNavSource !== 'list' && s._dfNavSource !== 'history') return requestCloseModal();
        closeAllDfPicks();
        if ((s._dfPage || '1') === '2') {
            TVC_SpareMenu.teardownWrSparePage2();
            dfSpareContextLeave();
        }
        s._dfDraft = null;
        s._dfCaseId = null;
        s._dfUsedPartsCaseId = null;
        s._dfUsedParts = [];
        await openCase(id, 'view');
    }

    async function reopenDefectCaseAfterSave(id) {
        const saved = await TVC_DefectCaseService.get(id);
        if (saved) {
            upsertDefectCaseInState(saved);
            syncDfDraftFromRow(saved);
        }
        const nav = getState()._dfNavSource;
        if (nav === 'list' || nav === 'history') await openCase(id, 'view', { keepDraft: true });
        else await openCase(id, undefined, { keepDraft: true });
    }

    async function syncDefectConsumeStock(row, usedParts) {
        const s = getState();
        const user = s.user;
        if (!user || !row?.id) return row;
        if ((s._dfPage || '1') === '2' || (s._wrUsedParts || s._dfUsedParts || []).length) {
            captureDfUsedParts();
        }
        captureDfJobItems();
        const draft = s._dfDraft || row;
        try {
            const enriched = enrichDfUsedParts(usedParts || dfUsedPartsPayload() || row.used_parts || []);
            const syncResult = await TVC_SpareMenu.syncConsumeLogFromDefectReport({
                defectCase: { ...row, job_items: draft.job_items || row.job_items || [] },
                usedParts: enriched,
                user,
                department: row.department || s.department || '',
            });
            const consumeLogId = syncResult?.logId ?? null;
            const stockAppliedAt = syncResult?.stockAppliedAt || '';
            if (row.consume_log_id !== consumeLogId
                || (stockAppliedAt && row.stock_applied_at !== stockAppliedAt)
                || (!consumeLogId && row.consume_log_id)) {
                row.consume_log_id = consumeLogId || null;
                row.stock_applied_at = stockAppliedAt || '';
                await TVC_DB.put('defect_cases', row);
                upsertDefectCaseInState(row);
                if (s._dfCaseId === row.id && s._dfDraft) {
                    s._dfDraft.consume_log_id = row.consume_log_id;
                    s._dfDraft.stock_applied_at = row.stock_applied_at;
                }
            }
        } catch (syncErr) {
            console.error('Defect consumed log sync failed:', syncErr);
            await TVC_Dialog.alert(syncErr.message || 'Spare parts stock sync failed.');
        }
        return row;
    }

    async function deleteDefectModal() {
        const user = getState().user;
        const id = getState()._defectCaseId;
        if (!user || !id) return;
        const row = await TVC_DefectCaseService.get(id);
        if (!row) return;
        if (!canDeleteDfListRow(row)) {
            const st = TVC_DefectCase.listWorkflowStatus(row);
            if (st === 'Confirmed') await TVC_Dialog.alert('Only Captain / Chief Engineer can delete Confirmed items.');
            await TVC_Dialog.alert('Cannot delete in this status.');
        }
        if (!await TVC_Dialog.confirm({ message: `Delete defect report ${row.case_no}?` })) return;
        try {
            if (row.consume_log_id) {
                const log = await TVC_Inventory.getConsumeLog(row.consume_log_id);
                if (log) await TVC_SpareMenu.reverseConsumeLogStockForLog(user, log, undefined, { skipRbac: true });
                await TVC_Inventory.deleteConsumeLog(row.consume_log_id);
            }
            await TVC_DefectCaseService.deleteCase(user, id);
            delete _dfListChecked[id];
            if (_dfListSelId === id) _dfListSelId = null;
            closeModal();
            await refresh();
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Delete failed');
        }
    }

    function resolveDfOpenMode(row) {
        if (isHq() && row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) return 'edit';
        if (isHq() && row.status === TVC_DefectCase.Status.AWAITING_COMPLETION) return 'edit';
        if (!isHq() && (row.status === TVC_DefectCase.Status.COMPANY_REVIEWED
            || row.status === TVC_DefectCase.Status.WORK_IN_PROGRESS)) return 'phase3';
        return 'edit';
    }

    function openCaseFromNav(id, navSource, modeOverride, opts = {}) {
        const row = (getState().defectCases || []).find(c => c.id === id);
        getState()._dfNavSource = navSource;
        if (navSource === 'history') {
            openCase(id, modeOverride || 'view', opts);
            return;
        }
        if (modeOverride) {
            openCase(id, modeOverride, opts);
            return;
        }
        openCase(id, 'view', opts);
    }

    async function dfDetailReport() {
        const row = getSelectedDfRow();
        if (!row) await TVC_Dialog.alert('Select an item from the Defect Report list.');
        openCaseFromNav(row.id, 'list', 'view');
    }

    async function dfModifyReport() {
        const row = getSelectedDfRow();
        if (!row) await TVC_Dialog.alert('Select an item from the Defect Report list.');
        dfModifyCase(row.id, 'list');
    }

    async function dfModifyCase(id, navSource, opts = {}) {
        const row = (getState().defectCases || []).find(c => c.id === id);
        if (!row) await TVC_Dialog.alert('Defect Report not found.');
        if (!canOpenDfModifyRow(row)) {
            const st = TVC_DefectCase.listWorkflowStatus(row);
            if (isHq()) {
                await TVC_Dialog.alert('Modify permission denied.');
            } else {
                if (st === 'Confirmed') await TVC_Dialog.alert('Only Captain / Chief Engineer can modify Confirmed items.');
                else if (st === 'Submitted' || st === 'Approved') {
                    await TVC_Dialog.alert("Only Captain / Chief Engineer can edit Ship's Comments in Submitted or Approved status.");
                } else {
                    await TVC_Dialog.alert('Cannot modify Approved or Submitted items.');
                }
            }
            return;
        }
        openCaseFromNav(id, navSource, resolveDfOpenMode(row), opts);
    }

    async function dfDeleteByIds(ids, opts = {}) {
        const user = getState().user;
        if (!user) await TVC_Dialog.alert('Sign in required.');
        const idList = (ids || []).filter(Boolean);
        if (!idList.length) await TVC_Dialog.alert('Select item(s) to delete.');
        const rows = idList.map(id => (getState().defectCases || []).find(r => r.id === id)).filter(Boolean);
        const deletable = rows.filter(canDeleteDfListRow);
        if (!deletable.length) await TVC_Dialog.alert('No delete permission or item is Submitted / Approved.');
        if (!await TVC_Dialog.confirm({ message: `Delete ${deletable.length} defect report(s)?` })) return;

        for (const row of deletable) {
            try {
                await TVC_DefectCaseService.deleteCase(user, row.id);
                delete _dfListChecked[row.id];
                if (_dfListSelId === row.id) _dfListSelId = null;
            } catch (e) {
                await TVC_Dialog.alert(`${row.case_no}: ${e.message || e.code || 'Delete failed'}`);
                break;
            }
        }
        await refresh();
        if (getState().currentTab === 'history') TVC_App.renderWorkHistory?.();
        if (opts.clearHistSelection && getState()._histSelReportId) {
            const deletedKeys = new Set(deletable.map(r => TVC_App.histDefectRowKey?.(r.id)));
            if (deletedKeys.has(getState()._histSelReportId)) getState()._histSelReportId = null;
        }
    }

    async function dfDeleteReport() {
        let ids = getCheckedDfListIds();
        const sel = getSelectedDfRow();
        if (!ids.length && sel && canDeleteDfListRow(sel)) ids = [sel.id];
        await dfDeleteByIds(ids);
    }

    async function dfReportConfirm() {
        const user = getState().user;
        if (!user) await TVC_Dialog.alert('Sign in required.');
        let rows = defectListRows().filter(r => _dfListChecked?.[r.id]);
        const sel = getSelectedDfRow();
        if (!rows.length && sel && isDfListRowConfirmable(sel)) rows = [sel];
        if (!rows.length) await TVC_Dialog.alert('Check one or more Reported items to confirm.');

        if (isHq()) {
            const pending = rows.filter(r => r.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY);
            if (!pending.length) await TVC_Dialog.alert('Only SUBMITTED items awaiting HQ review can be confirmed.');
            openCase(pending[0].id, 'edit');
            return;
        }

        const toConfirm = rows.filter(isDefectReportConfirmable);
        if (!toConfirm.length) await TVC_Dialog.alert('Select Reported defect report(s) that can be confirmed.');
        if (!await TVC_Dialog.confirm({ message: `Confirm ${toConfirm.length} defect report(s)?` })) return;

        let ok = 0;
        for (const row of toConfirm) {
            try {
                await TVC_DefectCaseService.saveApprovalMeta(user, row.id, { confirm: true });
                let fresh = await TVC_DefectCaseService.get(row.id);
                if (fresh && (fresh.used_parts || []).some(p => Number(p.qty_used) > 0) && !fresh.stock_applied_at) {
                    fresh = await syncDefectConsumeStock(fresh, fresh.used_parts);
                } else if (fresh) {
                    upsertDefectCaseInState(fresh);
                }
                ok++;
            } catch (e) {
                await TVC_Dialog.alert(`${row.case_no}: ${e.message || e.code || 'Confirm failed'}`);
                break;
            }
        }
        _dfListChecked = {};
        await refresh();
        renderTab();
        if (ok) await TVC_Dialog.alert(`${ok} report(s) confirmed`);
    }

    function renderInbox() {
        renderTab();
    }

    function renderTab() {
        if (getState().currentTab === 'history') {
            TVC_App.renderWorkHistory?.();
        }
    }

    function renderInboxTo(bodyId, headId) {
        if (bodyId === 'defectTabBody') {
            renderTab();
            return;
        }
        renderTab();
    }

    function fieldInput(name, label, value, opts = {}) {
        const ro = opts.readonly ? ' readonly' : '';
        const type = opts.type || 'text';
        if (opts.textarea) {
            return `<div class="df-field df-span-${opts.span || 1}">
                <label>${esc(label)}</label>
                <textarea data-df="${esc(name)}" rows="${opts.rows || 2}"${ro}>${esc(value)}</textarea>
            </div>`;
        }
        if (opts.checkbox) {
            const chk = value ? ' checked' : '';
            const dis = opts.readonly ? ' disabled' : '';
            return `<label class="df-check"><input type="checkbox" data-df="${esc(name)}"${chk}${dis}> ${esc(label)}</label>`;
        }
        if (opts.radioGroup) {
            const val = value === true || value === 'true' ? 'true'
                : value === false || value === 'false' ? 'false' : '';
            const dis = opts.readonly ? ' disabled' : '';
            return `<div class="df-field df-span-${opts.span || 2}">
                <span class="df-radio-label">${esc(label)}</span>
                <div class="df-radio-group">
                    <label class="df-radio"><input type="radio" name="${esc(opts.radioGroup)}" data-df="${esc(name)}" value="true"${val === 'true' ? ' checked' : ''}${dis}> Satisfactory</label>
                    <label class="df-radio"><input type="radio" name="${esc(opts.radioGroup)}" data-df="${esc(name)}" value="false"${val === 'false' ? ' checked' : ''}${dis}> Unsatisfactory</label>
                </div>
            </div>`;
        }
        return `<div class="df-field df-span-${opts.span || 1}">
            <label>${esc(label)}</label>
            <input type="${type}" data-df="${esc(name)}" value="${esc(value)}"${ro}>
        </div>`;
    }

    function dfFlagChecked(row, name) {
        if (name === 'shore_support') return !!(dfVal(row, 'shore_support') || dfVal(row, 'shore_technician'));
        return !!dfVal(row, name);
    }

    function renderDfPostActionSections(row, opts = {}) {
        const {
            canEditCompanyReply = false,
            canEditShipVerify = false,
            canEditShoreSupport = canEditShipVerify,
            canEditCompanyFinal = false,
            forPrint = false,
        } = opts;
        const fld = (label, inner, extraCls = '') =>
            `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const inp = (name, val, type, ro) => {
            if (forPrint && type === 'date') return dfDateUiPrintInput(dfVal(row, name, val));
            const v = esc(dfVal(row, name, val));
            const roAttr = ro ? ' readonly' : '';
            const dis = ro ? ' disabled' : '';
            const roCls = ro ? ' wr-ro' : '';
            if (type === 'date') return `<input type="date" data-df="${name}" class="${roCls.trim()}" value="${v}"${roAttr}${dis}>`;
            if (type === 'number') return `<input type="number" data-df="${name}" class="${roCls.trim()}" value="${v}"${roAttr}${dis}>`;
            return `<input data-df="${name}" class="${roCls.trim()}" value="${v}"${roAttr}${dis}>`;
        };
        const ta = (name, val, rows, ro) => {
            const roAttr = ro ? ' readonly' : '';
            const roCls = ro ? ' wr-ro' : '';
            return `<textarea class="wr-maint-textarea${roCls}" data-df="${name}" rows="${rows}"${roAttr}>${esc(dfVal(row, name, val))}</textarea>`;
        };
        const flagChk = (name, label, enabled) => {
            const dis = (forPrint || !enabled) ? ' disabled' : '';
            return `<label class="wr-footer-flag">
                <input type="checkbox" data-df="${name}"${dfFlagChecked(row, name) ? ' checked' : ''}${dis}>
                <span>${esc(label)}</span>
            </label>`;
        };
        const reportChk = (name, label, ro) =>
            fieldInput(name, label, dfVal(row, name), { checkbox: true, readonly: ro });

        const p2ro = forPrint || !canEditCompanyReply;
        const p3ro = forPrint || !canEditShipVerify;
        const p4ro = forPrint || !canEditCompanyFinal;
        const canUploadCompanyAttach = !forPrint && (canEditCompanyReply || canEditCompanyFinal);
        const replyDateInp = inp('reply_date', row.reply_date || '', 'date', p2ro)
            .replace('data-df="reply_date"', 'id="dfReplyDate" data-df="reply_date"');
        const shipVerifiedDateInp = inp('ship_verified_date', row.ship_verified_date || '', 'date', p3ro)
            .replace('data-df="ship_verified_date"', 'id="dfShipVerifiedDate" data-df="ship_verified_date"');

        return `<div class="df-post-action-stack">
            <section class="df-post-block df-company-reply">
                <div class="df-post-title-row">
                    <h4 class="df-post-title">Initial Reply from Company / Permit to Work for Unplanned Maintenance</h4>
                    <div class="df-post-date-field">
                        <label for="dfReplyDate">Date</label>
                        ${replyDateInp}
                    </div>
                </div>
                ${fld('', ta('company_initial_reply', '', 4, p2ro), 'wr-maint-span-all')}
                ${forPrint ? '' : `<textarea class="hidden" data-df="permit_to_work" aria-hidden="true">${esc(dfVal(row, 'permit_to_work', dfVal(row, 'company_initial_reply', '')))}</textarea>`}
                <div class="df-checks df-post-checks">
                    <span class="df-checks-label">REQUIRE TO REPORT TO</span>
                    ${reportChk('report_to_class', 'Class', p2ro)}
                    ${reportChk('report_to_flag', 'Flag State', p2ro)}
                    ${reportChk('report_to_external_stakeholder', 'External Stakeholder', p2ro)}
                    ${reportChk('report_to_psc', 'PSC', p2ro)}
                    ${reportChk('report_na', 'N/A', p2ro)}
                </div>
            </section>
            <section class="df-post-block df-ship-verify">
                <div class="df-post-title-row">
                    <h4 class="df-post-title">Ship's Comments (After defect was cleared)</h4>
                    <div class="df-post-date-field">
                        <label for="dfShipVerifiedDate">Date</label>
                        ${shipVerifiedDateInp}
                    </div>
                </div>
                ${fld('', ta('ship_verified_after_clear', '', 4, p3ro), 'wr-maint-span-all')}
                <div class="wr-footer-labor df-verify-labor">
                    ${fld('Working Hours', inp('working_hours', '0', 'number', p3ro))}
                    ${fld('Working Member', inp('working_member', '0', 'number', p3ro))}
                    <div class="wr-footer-flags df-verify-flags" role="group" aria-label="Verification flags">
                        ${flagChk('shore_support', 'CONDUCTED BY SHORE SUPPORT', canEditShoreSupport)}
                        ${flagChk('defect_cleared', 'DEFECT CLEARED', canEditShipVerify)}
                    </div>
                </div>
            </section>
            <section class="df-post-block df-company-final">
                ${fld("Company's Comments", ta('company_comment', '', 3, p4ro), 'wr-maint-span-all')}
                <div class="df-company-attach-row wr-maint-span-all">
                    ${renderDfAttachmentBlock('company', { canUpload: canUploadCompanyAttach, forPrint })}
                </div>
            </section>
        </div>`;
    }

    function dfApprovalState(row) {
        const s = getState();
        const user = s.user;
        const isConfirmed = !!(row.confirmed_at || row.confirmed_by);
        const isApproved = !!(row.approved_at || row.approved_by);
        const editMode = s._defectMode !== 'view';
        const hq = isHq();
        const hqPreExport = hq && !TVC_DefectCase.isHqReplyExported(row);
        const canConfirmNew = !hq && isDefectReportConfirmable(row);
        const canUnconfirmNow = !hq && editMode && isConfirmed && !isApproved
            && !!user && TVC_RBAC.canConfirmDepartment(user, row.department);
        const canConfirmNow = canConfirmNew || canUnconfirmNow;
        const canApproveNow = hqPreExport && editMode && !!user && TVC_RBAC.canApproveHqReport(user)
            && (isConfirmed || TVC_RBAC.canHqDirectApprove(user, row) || isApproved);
        return {
            isConfirmed,
            isApproved,
            canConfirmNow,
            canApproveNow,
            confirmedByVal: isConfirmed
                ? (TVC_RBAC.resolveConfirmByLabel?.(row.confirmed_by, row.department, user) || '')
                : '',
            approvedByVal: isApproved
                ? (row.approved_by || hqSuperintendentApprovalLabel(user))
                : '',
        };
    }

    function renderDfApprovalHtml(row, opts = {}) {
        const forPrint = !!opts.forPrint;
        const {
            isConfirmed, isApproved, canConfirmNow, canApproveNow,
            confirmedByVal, approvedByVal,
        } = dfApprovalState(row);
        const confirmDis = forPrint || !canConfirmNow ? ' disabled' : '';
        const approveDis = forPrint || !canApproveNow ? ' disabled' : '';
        return `<section class="wr-maint-card wr-maint-approval">
            <div class="wr-maint-approval-item${!forPrint && canConfirmNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="dfConfirmedBy"${isConfirmed ? ' checked' : ''}${confirmDis}${forPrint ? '' : ' onchange="TVC_DefectReport.dfReportConfirmByToggle()"'}> Confirmed by</label>
                <input class="wr-ro wr-maint-date" value="${esc(confirmedByVal)}" readonly tabindex="-1">
            </div>
            <div class="wr-maint-approval-item${!forPrint && canApproveNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="dfApprovedBy"${isApproved ? ' checked' : ''}${approveDis}${forPrint ? '' : ' onchange="TVC_DefectReport.dfApprovedByToggle()"'}> Approved by</label>
                <input class="wr-ro wr-maint-date" value="${esc(approvedByVal)}" readonly tabindex="-1">
            </div>
        </section>`;
    }

    function renderPhase1(row, readonly, opts = {}) {
        const { includeApproval = true, postAction = {}, forPrint = false } = opts;
        const canEditShipInitial = forPrint ? false : (postAction.canEditShipInitial ?? !readonly);
        const canEditShipAttach = forPrint ? false : (postAction.canEditShipAttach ?? canEditShipInitial);
        ensureDfDraft(row);
        ensureDfJobItems(row);
        const s = getState();
        const draft = s._dfDraft || row;
        const items = draft.job_items || [];
        const hasJob = items.some(i => String(i.job_code || '').trim()) || dfHasLinkedJob(row);
        const primaryJobId = items.find(i => i.maintenance_job_id)?.maintenance_job_id || row.maintenance_job_id;
        const job = hasJob && primaryJobId
            ? (s.idx?.jobById?.get(primaryJobId) || s.jobs?.find(j => j.id === primaryJobId))
            : null;
        const hdr = job && TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || resolveDfGroupHeader(s, row);
        const ro = readonly || forPrint;
        const roAttr = ro ? ' readonly' : '';
        const roCls = ro ? ' wr-ro' : '';
        const fld = (label, inner, extraCls = '') => `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const inp = (name, val, type = 'text') => {
            if (forPrint && type === 'date') return dfDateUiPrintInput(dfVal(row, name, val));
            const v = esc(dfVal(row, name, val));
            if (type === 'date') return `<input type="date" data-df="${name}" class="${roCls.trim()}" value="${v}"${roAttr}${ro ? ' disabled' : ''}>`;
            if (type === 'number') return `<input type="number" data-df="${name}" class="${roCls.trim()}" value="${v}"${roAttr}>`;
            return `<input data-df="${name}" class="${roCls.trim()}" value="${v}"${roAttr}>`;
        };
        const ta = (name, val, rows = 3) => `<textarea class="wr-maint-textarea${roCls}" data-df="${name}" rows="${rows}"${roAttr}>${esc(dfVal(row, name, val))}</textarea>`;
        const repairChk = `<label class="wr-maint-chk df-repair-request-chk"><input type="checkbox" data-df="repair_request"${dfFlagChecked(row, 'repair_request') ? ' checked' : ''}${forPrint || !canEditShipInitial ? ' disabled' : ''}> REPAIR REQUEST (IF SHORE SUPPORT IS REQUIRED)</label>`;
        const fileNoInner = forPrint
            ? `<input class="wr-ro" value="${esc(dfVal(row, 'file_no', ''))}" readonly tabindex="-1">`
            : `<div class="wr-file-no-row">
                        <input data-df="file_no" class="${roCls.trim()}" value="${esc(dfVal(row, 'file_no', ''))}"${roAttr}>
                        <button type="button" id="dfFileNoPickBtn" class="btn btn-sm wr-file-no-pick-btn" onclick="TVC_App.openFileNoPickModal('df')"${canEditShipInitial ? '' : ' disabled'} title="Browse Work History for File No. reference">Select File No.</button>
                    </div>`;
        const fileNoPanel = forPrint
            ? ''
            : '<div id="dfFileNoPickPanel" class="wr-file-no-popover spare-req-hist-popover hidden" aria-hidden="true"></div>';
        const postActionOpts = forPrint
            ? { forPrint: true, canEditCompanyReply: false, canEditShipVerify: false, canEditShoreSupport: false, canEditCompanyFinal: false }
            : (opts.postAction || {});
        const bottomTail = `
                <div class="df-ship-initial-actions wr-maint-span-all wr-maint-grid-gap">
                    ${repairChk}
                    ${renderDfAttachmentBlock('ship', { canUpload: canEditShipAttach, forPrint })}
                </div>
                ${renderDfPostActionSections(row, postActionOpts)}
                ${fileNoPanel}`;
        const mainFields = `
                <div class="wr-maint-grid wr-maint-grid-3">
                    ${fld('File No.', fileNoInner)}
                    ${fld('Voy. No.', inp('voy_no', ''))}
                    ${fld('Place', inp('place', ''))}
                    ${fld('Occurred Date', inp('work_date', row.report_date, 'date'))}
                    ${fld('Reported Date', inp('report_date', row.report_date, 'date'))}
                    ${fld('Reported by', `<input class="wr-ro" value="${esc(reportedByLabel(row))}" readonly>`)}
                </div>
                ${TVC_App.renderWrPmsGroupCriticalRow({
                    pmsInner: renderDfGroupPick(row, ro),
                    criticalLabel: TVC_App.jobCriticalEquipmentDisplay(job, dfVal(row, 'pms_group_no', hdr?.pmsGroupNo || '')),
                    forPrint,
                })}
                ${renderDfJobRowsBlock(row, ro)}
                ${fld('Job Name', inp('job_name', ''), 'wr-maint-span-all wr-maint-grid-gap')}
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Maker', `<input class="wr-ro" data-df="maker" value="${esc(dfVal(row, 'maker', hdr.maker || row.manufacturer || ''))}" readonly tabindex="-1">`)}
                    ${fld('Model / Type', `<input class="wr-ro" data-df="model_type" value="${esc(dfVal(row, 'model_type', hdr.modelType || row.model_type || ''))}" readonly tabindex="-1">`)}
                    ${fld('Capacity', `<input class="wr-ro" data-df="capacity" value="${esc(dfVal(row, 'capacity', hdr.capacity || row.capacity || ''))}" readonly tabindex="-1">`)}
                    ${fld('Serial No.', `<input class="wr-ro" data-df="serial_no" value="${esc(dfVal(row, 'serial_no', hdr.serialNo || row.serial_no || ''))}" readonly tabindex="-1">`)}
                </div>
                <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap">
                    ${fld('Total Run Hrs', inp('total_run_hrs', '0', 'number'))}
                    ${fld('Last Maintenance Date', inp('last_maintenance_date', job?.last_done || '', 'date'))}
                    ${fld('Running Hrs after Last Maint.', inp('rh_since_last_maintenance', '', 'number'))}
                </div>
                ${fld('Outline of Defect', ta('outline_maintenance_request', ''), 'wr-maint-span-all wr-maint-grid-gap')}
                ${fld('Estimated Cause of Defect', ta('estimated_cause', ''), 'wr-maint-span-all')}
                ${fld('Possible Effect to Other System', ta('possible_effect', ''), 'wr-maint-span-all')}
                ${fld('Action Plan / Corrective Action', ta('action_taken', ''), 'wr-maint-span-all')}`;

        if (forPrint) {
            return `<div class="wr-maint-form">
            ${includeApproval ? renderDfApprovalHtml(row, { forPrint }) : ''}
            <section class="wr-maint-card wr-maint-body wr-file-no-anchor">${mainFields}</section>
            ${bottomTail}
        </div>`;
        }

        return `<div class="wr-maint-form">
            ${includeApproval ? renderDfApprovalHtml(row, { forPrint }) : ''}
            <section class="wr-maint-card wr-maint-body wr-file-no-anchor">
                ${mainFields}
                ${bottomTail}
            </section>
        </div>`;
    }

    function renderPhase2() { return ''; }

    function renderPhase3() { return ''; }

    function renderPhase4(row, readonly) {
        // HQ Defect Report — vessel-style UI; Phase 4 close-out is not shown in this modal.
        if (isHq()) return '';
        const show = row.phase3_locked || row.phase4_locked
            || row.status === TVC_DefectCase.Status.AWAITING_COMPLETION
            || row.status === TVC_DefectCase.Status.CLOSED;
        if (!show) return '';
        const p4ro = readonly || !TVC_DefectCase.isPhase4Editable(row);
        const showHQ = row.phase3_locked || row.status === TVC_DefectCase.Status.AWAITING_COMPLETION || row.status === TVC_DefectCase.Status.CLOSED;
        if (!showHQ) return '';
        return `<section class="df-phase df-phase-hq df-phase-close">
            <h3 class="df-phase-title">Phase 4 — Closed out reply from Company D.P.</h3>
            <div class="df-grid">
                ${fieldInput('preventive_measures', 'Preventive measures (Verified by Team Leader MTT)', row.preventive_measures, { span: 2, textarea: true, rows: 3, readonly: p4ro })}
                ${fieldInput('dp_closed_satisfactory', 'Closed out — D.P. reply', row.dp_closed_satisfactory, { radioGroup: 'dp_sat', readonly: p4ro })}
                ${fieldInput('dp_closed_reply', 'Additional D.P. comment (optional)', row.dp_closed_reply || '', { span: 2, textarea: true, rows: 2, readonly: p4ro })}
                ${fieldInput('dp_closed_by', 'Reply by', row.dp_closed_by, { readonly: p4ro })}
                ${fieldInput('dp_closed_date', 'Reply Date', row.dp_closed_date, { type: 'date', readonly: p4ro })}
            </div>
            ${row.phase4_locked ? `<p class="df-phase-note">🏁 Case closed — ${row.dp_closed_satisfactory ? 'Satisfactory' : 'Unsatisfactory'}.</p>` : ''}
        </section>`;
    }

    function getDefectModalRow() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return null;
        const base = (s.defectCases || []).find(c => c.id === id) || {};
        const draft = s._dfDraft || {};
        return { ...base, ...draft, id };
    }

    function captureDefectModalScroll() {
        const page = document.querySelector('#defectReportBody .wr-page');
        const modal = document.getElementById('defectReportModal');
        return {
            pageTop: page?.scrollTop ?? 0,
            modalTop: modal?.scrollTop ?? 0,
        };
    }

    function restoreDefectModalScroll(saved) {
        if (!saved) return;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const page = document.querySelector('#defectReportBody .wr-page');
                const modal = document.getElementById('defectReportModal');
                if (page) page.scrollTop = saved.pageTop;
                if (modal) modal.scrollTop = saved.modalTop;
            });
        });
    }

    function applyFileNoFromPicker(val) {
        const row = getDefectModalRow();
        if (!row) return;
        const draft = ensureDfDraft(row);
        draft.file_no = String(val || '').trim();
        const inp = document.querySelector('#defectReportBody [data-df="file_no"]');
        if (inp) inp.value = draft.file_no;
    }

    function refreshDefectModal(opts = {}) {
        const scroll = opts.preserveScroll ? captureDefectModalScroll() : null;
        closeAllDfPicks();
        TVC_App.closeFileNoPickModal?.();
        const s = getState();
        if ((s._dfPage || '1') === '2' && document.getElementById('wrSpareListScroll')) {
            captureDfUsedParts();
            TVC_SpareMenu.teardownWrSparePage2();
            dfSpareContextLeave();
        }
        const row = getDefectModalRow();
        if (!row) return;
        ensureDfUsedParts(row);
        const body = document.getElementById('defectReportBody');
        if (!body) return;
        const mode = s._defectMode || 'edit';
        body.innerHTML = renderModalBody(row, mode);
        if ((s._dfPage || '1') === '2') {
            const forceView = mode === 'view';
            const page2ro = forceView || !TVC_DefectCase.canModifyListWorkflow(row);
            syncDfSparePage2Ui(true, page2ro);
        }
        document.querySelectorAll('body > .spare-consume-pick-menu-portal').forEach(el => el.remove());
        restoreDefectModalScroll(scroll);
        TVC_PWA?.initDateInputFormat?.(body);
    }

    function setDefectReportPage(page) {
        captureDfFormFields();
        if ((getState()._dfPage || '1') === '1') captureDfJobItems();
        closeAllDfPicks();
        if ((getState()._dfPage || '1') === '2') {
            TVC_SpareMenu.persistWrSpareUsedParts?.();
            captureDfUsedParts();
            TVC_SpareMenu.teardownWrSparePage2();
            dfSpareContextLeave();
        }
        getState()._dfPage = page;
        refreshDefectModal();
    }

    async function applyDfApprovalFromUi() {
        const s = getState();
        const id = s._defectCaseId;
        const user = s.user;
        if (!id || !user) return;
        const row = await TVC_DefectCaseService.get(id);
        if (!row) return;
        const cfCb = document.getElementById('dfConfirmedBy');
        const apCb = document.getElementById('dfApprovedBy');
        const doConfirm = cfCb?.checked && !cfCb.disabled;
        const doApprove = apCb?.checked && !apCb.disabled;
        const doUnapprove = apCb && !apCb.disabled && !apCb.checked
            && (row.approved_at || row.approved_by)
            && isHq() && !TVC_DefectCase.isHqReplyExported(row);
        if (doUnapprove) {
            await TVC_DefectCaseService.saveApprovalMeta(user, id, { unapprove: true });
        }
        if (doConfirm || doApprove) {
            await TVC_DefectCaseService.saveApprovalMeta(user, id, { confirm: doConfirm, approve: doApprove });
        }
    }

    function renderModalBody(row, mode) {
        const hq = isHq();
        const navSource = getState()._dfNavSource;
        const fromHistoryNav = navSource === 'history';
        const fromListNav = navSource === 'list';
        const forceView = mode === 'view';
        const dfPage = getState()._dfPage || '1';
        const approval = dfApprovalState(row);
        const canEditP1 = !forceView && TVC_DefectCase.isPhase1Editable(row)
            && (!hq || row.status === TVC_DefectCase.Status.DRAFT || row.visible_in_list === false);
        const canEditShipInitial = canEditP1;
        const canEditCompanyReply = canEditDfCompanyReply(row, forceView);
        const canEditShipComments = canEditDfShipCommentsSection(row, forceView);
        const canEditShipVerify = canEditShipComments;
        const canEditShoreSupport = canEditShipInitial || canEditShipComments;
        const canEditShipAttach = canEditShipInitial || canEditShipComments;
        const canEditP4 = !forceView && hq && TVC_DefectCase.isPhase4Editable(row);
        const canEditCompanyFinal = !forceView && hq && (canEditP4 || canEditCompanyReply);
        const canHqApproveOnly = !forceView && hq && approval.canApproveNow;
        const canSave = !forceView && (
            canEditP1 || canEditCompanyReply || canEditShipVerify || canEditShoreSupport || canEditP4 || canEditCompanyFinal || canHqApproveOnly
        );
        const titleText = fromListNav || fromHistoryNav
            ? 'Defect Report'
            : (isDraftDefectSession() ? 'Defect Report (Draft)' : (forceView ? 'Defect Report (View)' : 'Defect Report'));

        const pageTabs = `
            <div class="wr-pagetabs">
                <button type="button" class="wr-pagetab${dfPage === '1' ? ' active' : ''}" onclick="TVC_DefectReport.setDefectReportPage('1')">Page 1</button>
                <button type="button" class="wr-pagetab${dfPage === '2' ? ' active' : ''}" onclick="TVC_DefectReport.setDefectReportPage('2')">Page 2</button>
            </div>`;
        const pageTabsBar = `<div class="wr-pagetabs-bar">${pageTabs}</div>`;

        const headHtml = dfPage === '2' ? renderDfApprovalHtml(row) : '';
        let body = '';
        if (dfPage === '2') {
            const page2ro = forceView || !TVC_DefectCase.canModifyListWorkflow(row);
            body = renderDfPage2Body(row, page2ro);
        } else {
            const phase4Html = renderPhase4(row, !canEditP4);
            body = `${renderPhase1(row, !canEditP1, {
                includeApproval: true,
                postAction: {
                    canEditShipInitial,
                    canEditShipAttach,
                    canEditShoreSupport,
                    canEditCompanyReply,
                    canEditShipVerify,
                    canEditCompanyFinal,
                },
            })}
                ${phase4Html ? `<div class="df-workflow-phases">${phase4Html}</div>` : ''}`;
        }

        let actionsClass = 'modal-actions wr-actions df-modal-actions';
        let actionsHtml;
        if (fromListNav || fromHistoryNav) {
            actionsClass += ' df-modal-actions-split';
            const canModifyRow = canOpenDfModifyRow(row);
            const modifyTitle = esc(dfModifyDisabledTitle(row));
            const navBtns = defectNavButtonsHtml();
            const printBtn = `<button type="button" class="btn" onclick="TVC_DefectReport.printDefectModal()">Print</button>
                <button type="button" class="btn" onclick="TVC_DefectReport.previewDefectModal()">Preview</button>`;
            const closeBtn = `<button type="button" class="btn" onclick="TVC_DefectReport.closeDefectModal()">Close</button>`;
            let centerBtns = '';
            if (forceView) {
                centerBtns = `<button type="button" class="btn" onclick="TVC_DefectReport.modifyDefectModal()"${canModifyRow ? '' : ' disabled'}${modifyTitle ? ` title="${modifyTitle}"` : ''}>Modify</button>`;
            } else if (canModifyRow) {
                centerBtns = `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveModal()">Save</button>
                <button type="button" class="btn" onclick="TVC_DefectReport.cancelDefectModalEdit()">Cancel</button>`;
            }
            actionsHtml = `<div class="df-modal-actions-left">${navBtns}</div>
                <div class="df-modal-actions-center">${centerBtns}</div>
                <div class="df-modal-actions-right">${printBtn}${closeBtn}</div>`;
        } else {
            actionsHtml = `${canSave ? `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveModal()">💾 Save</button>` : ''}
                <button type="button" class="btn" onclick="TVC_DefectReport.requestCloseModal()">Cancel</button>`;
        }

        return `<div class="df-modal-inner">
            <div class="wr-titlebar">${titleText}</div>
            ${pageTabsBar}
            <div class="wr-page tone-defect">
                ${headHtml}
                ${body}
            </div>
            <div class="${actionsClass}">
                ${actionsHtml}
            </div>
        </div>`;
    }

    function captureForm() {
        const st = getState();
        if (!st._dfDraft && st._defectCaseId) {
            const base = (st.defectCases || []).find(c => c.id === st._defectCaseId);
            if (base) ensureDfDraft(base);
        }
        const snapshot = { ...(st._dfDraft || {}) };
        if ((st._dfPage || '1') === '1') {
            captureDfJobItems();
        }
        if ((st._dfPage || '1') === '2') {
            TVC_SpareMenu.persistWrSpareUsedParts?.();
        }
        if ((st._dfPage || '1') === '2' || (st._dfUsedParts || []).length) {
            captureDfUsedParts();
        }
        const draft = captureDfFormFields();
        return normalizeDfSubmitRow(st, {
            ...snapshot,
            ...draft,
            ship_attachments: dfAttachmentList('ship'),
            company_attachments: dfAttachmentList('company'),
            used_parts: dfUsedPartsPayload(),
            job_items: draft.job_items || snapshot.job_items || [],
        });
    }

    async function openCase(id, mode, opts = {}) {
        const s = getState();
        let row = opts.row || null;
        if (!row && opts.keepDraft && s._dfCaseId === id && s._dfDraft) {
            row = (s.defectCases || []).find(c => c.id === id) || null;
        } else {
            const fromDb = await TVC_DefectCaseService.get(id);
            if (fromDb) {
                row = fromDb;
                upsertDefectCaseInState(fromDb);
            }
        }
        if (!row) row = (s.defectCases || []).find(c => c.id === id);
        if (!row) await TVC_Dialog.alert('Case not found.');
        const scroll = opts.preserveScroll ? captureDefectModalScroll() : null;
        const caseChanged = s._defectCaseId !== id;
        if (caseChanged && !opts.preservePage) {
            s._dfPage = '1';
            s._dfCaseId = null;
            s._dfDraft = null;
        }
        if ((s._dfPage || '1') === '2' && caseChanged) {
            TVC_SpareMenu.persistWrSpareUsedParts?.();
            captureDfUsedParts();
            TVC_SpareMenu.teardownWrSparePage2();
            dfSpareContextLeave();
        }
        s._defectCaseId = id;
        s._defectMode = mode === 'view' ? 'view' : (mode || 'edit');
        _dfListSelId = id;
        if (opts.keepDraft && s._dfDraft) {
            /* saved reopen — draft already synced from DB */
        } else {
            ensureDfDraft(row);
        }
        if (s._defectMode !== 'view') {
            const draft = s._dfDraft || row;
            ensureDfJobItems(draft);
            TVC_App.syncPlanBatchChecksFromJobItems?.(draft.job_items || row.job_items || []);
        }
        s._dfUsedPartsCaseId = null;
        ensureDfUsedParts(row);
        const body = document.getElementById('defectReportBody');
        if (body) body.innerHTML = renderModalBody(getDefectModalRow() || row, s._defectMode);
        const dfModal = document.getElementById('defectReportModal');
        const dfOpen = dfModal && !dfModal.classList.contains('hidden');
        const wpStack = opts.stackOverWp || opts.swapOpts?.overWorkProcedure || TVC_App?.isWorkProcedureHistNav?.();
        if (opts.swapHide && window.TVC_App?.swapHistoryModals) {
            TVC_App.swapHistoryModals('defectReportModal', opts.swapHide, opts.swapOpts || {});
        } else if (!dfOpen) {
            dfModal?.classList.remove('hidden');
            if (wpStack) TVC_App.applyModalOverWorkProcedure?.('defectReportModal');
        } else if (wpStack) {
            TVC_App.applyModalOverWorkProcedure?.('defectReportModal');
        }
        if ((s._dfPage || '1') === '2') {
            const forceView = s._defectMode === 'view';
            const page2ro = forceView || !TVC_DefectCase.canModifyListWorkflow(row);
            syncDfSparePage2Ui(true, page2ro);
        }
        restoreDefectModalScroll(scroll);
        TVC_PWA?.initDateInputFormat?.(body);
    }

    function openCaseFromList(id) {
        openCaseFromNav(id, 'list', 'view');
    }

    async function openNewFromJob(jobId, opts = {}) {
        const s = getState();
        s._dfNavSource = null;
        TVC_App.switchTab?.('actual');
        TVC_App.snapshotPlanBatchSelection?.();
        const job = s.jobs?.find(j => j.id === jobId);
        if (!job) {
            await TVC_Dialog.alert('Select a job first.');
            return;
        }
        const prefill = Array.isArray(opts.prefillJobIds) ? opts.prefillJobIds.filter(Boolean) : null;
        const shipName = document.getElementById('cmaxsShipName')?.textContent || '';
        const row = await TVC_DefectCaseService.createFromJob(s.user, job, shipName);
        row.ship_name = shipName;
        const hdr = TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
        row.machinery_name = hdr.machineryName || job.item_sort1 || row.machinery_name;
        row.manufacturer = hdr.maker || row.manufacturer;
        row.maker = hdr.maker || row.maker;
        row.model_type = hdr.modelType || row.model_type;
        row.capacity = hdr.capacity || row.capacity;
        row.serial_no = hdr.serialNo || row.serial_no;
        row.type_model_serial = [hdr.modelType, hdr.serialNo].filter(Boolean).join(' / ') || row.type_model_serial;
        row.item_sort1 = job.item_sort1 || row.item_sort1;
        row.item_sort2 = job.item_sort2 || row.item_sort2;
        row.job_detail = job.job_detail || row.job_detail;
        row.pms_group_key = `${job.department}|${String(job.group || '').trim()}`;
        row.pms_group_no = job.group || row.pms_group_no;
        row.visible_in_list = false;
        if (prefill && prefill.length >= 2) {
            row.job_items = TVC_App.buildJobItemsFromJobIds?.(prefill) || [];
            syncDfPrimaryJobFromItems(row);
            TVC_App.syncPlanBatchChecksFromJobItems?.(row.job_items);
        } else {
            TVC_App.syncPlanBatchCheckForJob?.(jobId, true);
        }
        await TVC_DefectCaseService.saveDraft(s.user, row, row.id);
        await refresh();
        s._dfNewSession = true;
        s._dfSavedToList = false;
        openCase(row.id, 'edit');
    }

    async function openNewBlank() {
        const s = getState();
        if (isHq() && !s.selectedVesselId) {
            await TVC_Dialog.alert('Select a vessel first.');
        }
        s._dfNavSource = null;
        TVC_App.switchTab?.('actual');
        TVC_App.snapshotPlanBatchSelection?.();
        s._dfNewSession = true;
        s._dfSavedToList = false;
        const shipName = document.getElementById('cmaxsShipName')?.textContent || '';
        const row = await TVC_DefectCaseService.saveDraft(s.user, {
            ship_name: shipName,
            department: s.department || s.user?.department || '',
            visible_in_list: false,
            vessel_id: isHq() ? s.selectedVesselId : undefined,
        });
        await refresh();
        openCase(row.id, 'edit');
    }

    async function saveModal() {
        if (!await TVC_Dialog.confirm({ kind: 'save', message: 'Save this Defect Report?' })) return;
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        let row = await TVC_DefectCaseService.get(id);
        if (!row) return;
        captureForm();
        try {
            await applyDfApprovalFromUi();
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Approval failed');
            return;
        }
        row = await TVC_DefectCaseService.get(id) || row;
        if (isHq() && canSaveDfHqInitialReply(row)) return saveHqReply();
        if (isHq() && TVC_DefectCase.isPhase4Editable(row)) return saveHqPhase4();
        if (isHq() && canModifyDfHqRow(row)) {
            await refresh();
            await reopenDefectCaseAfterSave(id);
            await TVC_Dialog.alert('Saved.');
            return;
        }
        if (!isHq() && canModifyDfShipCommentsOnly(row)) return saveShipCommentsFieldsModal();
        if (!isHq() && TVC_DefectCase.isShipVerificationEditable(row)) return saveShipVerificationModal();
        if (!isHq() && TVC_DefectCase.isPhase3Editable(row)) return saveShipPhase3();
        try {
            return await saveDraft();
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Save failed');
        }
    }

    async function saveShipCommentsFieldsModal() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        try {
            await TVC_DefectCaseService.saveShipCommentsFields(s.user, id, captureForm());
            s._dfSavedToList = true;
            const saved = await TVC_DefectCaseService.get(id);
            if (saved) syncDfDraftFromRow(saved);
            await refresh();
            await reopenDefectCaseAfterSave(id);
            await TVC_Dialog.alert('Ship\'s Comments saved.');
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Save failed');
        }
    }

    async function saveShipVerificationModal() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        try {
            await TVC_DefectCaseService.saveShipVerification(s.user, id, captureForm());
            s._dfSavedToList = true;
            const saved = await TVC_DefectCaseService.get(id);
            if (saved) syncDfDraftFromRow(saved);
            await refresh();
            await reopenDefectCaseAfterSave(id);
            await TVC_Dialog.alert('Ship verification saved.');
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Save failed');
        }
    }

    async function saveDraft() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        const data = { ...captureForm(), visible_in_list: true };
        const codedItems = (data.job_items || []).filter(i => String(i.job_code || '').trim());
        const multiJobNewSave = !!(s._dfNewSession && codedItems.length >= 2);
        let row = await TVC_DefectCaseService.saveDraft(s.user, data, id);
        row = await syncDefectConsumeStock(row, data.used_parts);
        upsertDefectCaseInState(row);
        syncDfDraftFromRow(row);
        s._dfSavedToList = true;
        promoteNewDefectToListView(id);
        TVC_App.clearPlanBatchSnapshot?.();
        await refresh();
        if (multiJobNewSave) {
            s.batchSelectedJobs = {};
            s.actualSelectedOnly = false;
            s._dfNewSession = false;
            closeModal();
            await TVC_Dialog.alert(`Defect Report saved (${codedItems.length} jobs).`);
            return;
        }
        const fresh = await TVC_DefectCaseService.get(id);
        if (fresh) {
            upsertDefectCaseInState(fresh);
            syncDfDraftFromRow(fresh);
        }
        await reopenDefectCaseAfterSave(id);
        await TVC_Dialog.alert('Defect Report saved.');
    }

    async function submitCase() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        const form = captureForm();
        let row = await TVC_DefectCaseService.saveDraft(s.user, form, id);
        row = await syncDefectConsumeStock(row, form.used_parts);
        upsertDefectCaseInState(row);
        try {
            await TVC_DefectCaseService.submitToCompany(s.user, id);
            await refresh();
            await reopenDefectCaseAfterSave(id);
            const go = await TVC_Dialog.confirm({ message: 'Submitted to Company (URGENT).\n\nCreate Urgent Export package now? (ZIP + printable HTML for email)' });
            if (go) await TVC_App.urgentExportDefect(id);
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Submit failed');
        }
    }

    async function saveHqReply(andExport) {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        try {
            const form = captureForm();
            if (!String(form.permit_to_work || '').trim() && String(form.company_initial_reply || '').trim()) {
                form.permit_to_work = form.company_initial_reply;
            }
            await TVC_DefectCaseService.saveHqPhase2(s.user, id, form);
            if (form.company_comment || (form.company_attachments || []).length) {
                await TVC_DefectCaseService.saveHqCompanyFields(s.user, id, {
                    company_comment: form.company_comment,
                    company_attachments: form.company_attachments,
                });
            }
            s._dfSavedToList = true;
            const saved = await TVC_DefectCaseService.get(id);
            if (saved) {
                upsertDefectCaseInState(saved);
                syncDfDraftFromRow(saved);
            }
            await refresh();
            await reopenDefectCaseAfterSave(id);
            await TVC_Dialog.alert('Company reply saved.');
            if (andExport) await TVC_DefectSync.exportHqReplyZip(s.user, id);
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'HQ reply failed');
        }
    }

    async function startWork() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        try {
            await TVC_DefectCaseService.startWork(s.user, id);
            await refresh();
            await reopenDefectCaseAfterSave(id);
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Start work failed');
        }
    }

    async function saveShipPhase3(andExport) {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        try {
            await TVC_DefectCaseService.saveShipPhase3(s.user, id, captureForm());
            await refresh();
            await reopenDefectCaseAfterSave(id);
            await TVC_Dialog.alert('Phase 3 — Completion reported to Company.');
            if (andExport) await TVC_App.exportDefectCompletion(id);
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Phase 3 save failed');
        }
    }

    async function saveHqPhase4(andExport) {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        try {
            await TVC_DefectCaseService.saveHqPhase4(s.user, id, captureForm());
            await refresh();
            await reopenDefectCaseAfterSave(id);
            await TVC_Dialog.alert('Phase 4 — Case closed by Company D.P.');
            if (andExport) await TVC_DefectSync.exportCloseZip(s.user, id);
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Phase 4 close failed');
        }
    }

    function defectReportModalTitle(row) {
        const s = getState();
        const forceView = s._defectMode === 'view';
        const fromListNav = s._dfNavSource === 'list';
        const fromHistoryNav = s._dfNavSource === 'history';
        if (fromListNav || fromHistoryNav) return 'Defect Report';
        return isDraftDefectSession() ? 'Defect Report (Draft)' : (forceView ? 'Defect Report (View)' : 'Defect Report');
    }

    function renderDfPrintShell(title, activePage, bodyHtml) {
        return TVC_SpareMenu.renderWrPrintShell(title, activePage, bodyHtml, 'defect');
    }

    function dfDateUiPrintInput(val) {
        return TVC_SpareMenu.buildWrSpareDateUiPrintInput
            ? TVC_SpareMenu.buildWrSpareDateUiPrintInput(val)
            : `<input class="wr-ro tvc-date-input" value="${esc(val || '')}" readonly disabled>`;
    }

    function dfHasSparePage2ForPrint(usedParts) {
        return TVC_SpareMenu.wrHasSparePage2ForPrint
            ? TVC_SpareMenu.wrHasSparePage2ForPrint(usedParts)
            : (usedParts || []).some(p => Number(p.qty_used) > 0);
    }

    /** Consumption List Type D — linked Defect Report Page 2 print (no modal state). */
    function buildDefectReportPage2PrintHtmlFromCase(row, st, usedParts, opts = {}) {
        if (!row || !dfHasSparePage2ForPrint(usedParts)) return '';
        const meta = buildDfPage2Meta(row);
        meta.spareShipComments = dfVal(row, 'spare_ship_comments', row.spare_ship_comments || opts.log?.ships_comments || '');
        const page2Inner = TVC_SpareMenu.buildWrSparePage2UiPrintHtml(st, usedParts, meta);
        const page2Body = `${renderDfApprovalHtml(row, { forPrint: true })}${page2Inner}`;
        if (opts.innerOnly) return page2Body;
        return renderDfPrintShell(defectReportModalTitle(row), '2', page2Body);
    }

    function buildDefectReportPrintBody(row) {
        if ((getState()._dfPage || '1') === '2') {
            TVC_SpareMenu.persistWrSpareUsedParts?.();
            captureDfUsedParts();
        } else if ((getState()._dfUsedParts || []).length) {
            captureDfUsedParts();
        }
        captureDfFormFields();
        if ((getState()._dfPage || '1') === '1') captureDfJobItems();
        const s = getState();
        const draft = s._dfDraft || row;
        const title = defectReportModalTitle(row);
        const phase4Print = renderPhase4(row, true);
        const page1Body = `${renderPhase1(row, true, { includeApproval: true, forPrint: true })}
                ${phase4Print ? `<div class="df-workflow-phases">${phase4Print}</div>` : ''}`;
        const page1Html = renderDfPrintShell(title, '1', page1Body);
        const usedParts = enrichDfUsedParts(s._dfUsedParts || row.used_parts || []);
        let page2Html = '';
        if (dfHasSparePage2ForPrint(usedParts)) {
            const page2Body = buildDefectReportPage2PrintHtmlFromCase(row, s, usedParts);
            if (page2Body) page2Html = page2Body;
        }
        return { title: `Defect Report ${row.case_no || ''}`, html: page1Html + page2Html, appCss: true };
    }

    function openDefectReportPrint({ print = false } = {}) {
        const row = getDefectModalRow();
        if (!row) return;
        const doc = buildDefectReportPrintBody(row);
        TVC_SpareMenu.openWrReportPrintWindow(doc.title, doc.html, { print, appCss: !!doc.appCss });
    }

    function printDefectModal() {
        openDefectReportPrint({ print: true });
    }

    function previewDefectModal() {
        openDefectReportPrint({ print: false });
    }

    function dfApprovedByToggle() {
        const apCb = document.getElementById('dfApprovedBy');
        if (!apCb || apCb.disabled) return;
        const s = getState();
        const row = getDefectModalRow();
        if (!row?.id) return;
        const user = s.user;
        if (!user || !TVC_RBAC.isHqAccount(user)) return;
        const input = apCb.closest('.wr-maint-approval-item')?.querySelector('.wr-maint-date');
        const superLabel = hqSuperintendentApprovalLabel(user);

        if (!apCb.checked) {
            if ((row.approved_at || row.approved_by) && !TVC_DefectCase.isHqReplyExported(row)) {
                if (input) input.value = '';
                return;
            }
            if (row.approved_at || row.approved_by) {
                apCb.checked = true;
                if (input) input.value = row.approved_by || superLabel;
                return;
            }
            if (input) input.value = '';
            return;
        }

        if (row.approved_at || row.approved_by) {
            if (input) input.value = row.approved_by || superLabel;
            return;
        }
        if (input) input.value = superLabel;
    }

    async function dfReportConfirmByToggle() {
        const cfCb = document.getElementById('dfConfirmedBy');
        if (!cfCb || cfCb.disabled) return;
        const s = getState();
        const row = getDefectModalRow();
        if (!row) return;
        if (isHq()) {
            cfCb.checked = !!(row.confirmed_at || row.confirmed_by);
            return;
        }
        const input = cfCb.closest('.wr-maint-approval-item')?.querySelector('.wr-maint-date');
        const user = s.user;
        if (!user) return;

        if (!cfCb.checked) {
            if (input && !(row.confirmed_at || row.confirmed_by)) {
                input.value = '';
                return;
            }
            if (s._defectMode === 'view' || row.approved_at || row.approved_by) {
                cfCb.checked = true;
                return;
            }
            if (!TVC_RBAC.canConfirmDepartment(user, row.department)) {
                cfCb.checked = true;
                return;
            }
            try {
                let fresh = await TVC_DefectCaseService.saveApprovalMeta(user, row.id, { unconfirm: true });
                if (fresh && fresh.stock_applied_at && (fresh.used_parts || []).length) {
                    await TVC_InventoryService.reverseConsumption(user, fresh.used_parts, {
                        ref: fresh.case_no || '',
                        source_id: fresh.id,
                        source_type: 'defect_case',
                        note: 'Defect report unconfirmed — stock restored',
                    });
                    fresh.stock_applied_at = '';
                    await TVC_DB.put('defect_cases', fresh);
                }
                fresh = await TVC_DefectCaseService.get(row.id);
                if (fresh) upsertDefectCaseInState(fresh);
                syncDfDraftFromRow(fresh || row);
                refreshDefectModal();
                await TVC_Dialog.alert(`${row.case_no} defect report unconfirmed.`);
            } catch (e) {
                cfCb.checked = true;
                await TVC_Dialog.alert(e.message || e.code || 'Unconfirm failed');
            }
            return;
        }

        const label = TVC_RBAC.getDepartmentConfirmLabel(row.department, user) || '';
        if (input) input.value = label;
        if (row.confirmed_at || row.confirmed_by) return;
        if (!isDefectReportConfirmable(row)) return;
        try {
            await TVC_DefectCaseService.saveApprovalMeta(user, row.id, { confirm: true });
            let fresh = await TVC_DefectCaseService.get(row.id);
            if (fresh && (fresh.used_parts || []).some(p => Number(p.qty_used) > 0) && !fresh.stock_applied_at) {
                fresh = await syncDefectConsumeStock(fresh, fresh.used_parts);
            } else if (fresh) {
                upsertDefectCaseInState(fresh);
            }
            syncDfDraftFromRow(fresh || row);
            refreshDefectModal();
            await TVC_Dialog.alert(`${row.case_no} defect report confirmed.`);
        } catch (e) {
            cfCb.checked = false;
            if (input) input.value = '';
            await TVC_Dialog.alert(e.message || e.code || 'Confirm failed');
        }
    }

    async function printCase(id) {
        const caseId = id || getState()._defectCaseId;
        const row = await TVC_DefectCaseService.get(caseId);
        if (!row) return;
        const doc = buildDefectReportPrintBody(row);
        TVC_SpareMenu.openWrReportPrintWindow(doc.title, doc.html, { print: true, appCss: !!doc.appCss });
    }

    function isNewUnsavedDefectSession() {
        const s = getState();
        return !!(s._dfNewSession && !s._dfSavedToList && s._defectCaseId && !s._dfNavSource);
    }

    function isDraftDefectSession() {
        const s = getState();
        return !!(s._dfNewSession && !s._dfSavedToList && !s._dfNavSource);
    }

    function promoteNewDefectToListView(id) {
        const s = getState();
        if (!s._dfNewSession || s._dfNavSource) return;
        s._dfNavSource = 'history';
        s._dfNewSession = false;
        _dfListSelId = id;
        if (TVC_App.histDefectRowKey) s._histSelReportId = TVC_App.histDefectRowKey(id);
        TVC_App.switchTab?.('history');
    }

    async function requestCloseModal() {
        if (isNewUnsavedDefectSession()) {
            const yes = await TVC_Dialog.confirm({
                kind: 'cancel',
                message: 'Cancel report editing?',
            });
            if (yes) await confirmCancelNew(true);
            return;
        }
        await closeDefectModal();
    }

    async function closeDefectModal() {
        const s = getState();
        const id = s._defectCaseId;
        const user = s.user;

        if (id && user) {
            try {
                await applyDfApprovalFromUi();
            } catch (e) {
                await TVC_Dialog.alert(e.message || e.code || 'Approval failed');
                return;
            }
        }
        closeModal();
        await refresh();
    }

    async function confirmCancelNew(yes) {
        if (!yes) return;
        const s = getState();
        const id = s._defectCaseId;
        if (id && s.user) {
            try {
                const row = await TVC_DefectCaseService.get(id);
                if (row && row.status === TVC_DefectCase.Status.DRAFT && !row.phase1_locked) {
                    await TVC_DefectCaseService.deleteCase(s.user, id);
                }
            } catch (_) { /* draft may already be gone */ }
        }
        closeModal();
        await refresh();
    }

    function closeModal() {
        closeAllDfPicks();
        TVC_App.closeFileNoPickModal?.();
        TVC_App.restorePlanBatchSelection?.();
        teardownDfSpareUi();
        _dfGroupPickSearch = '';
        _dfJobPickSearch = '';
        document.getElementById('defectReportModal')?.classList.add('hidden');
        const s = getState();
        s._defectCaseId = null;
        s._dfCaseId = null;
        s._dfDraft = null;
        s._dfUsedParts = [];
        s._dfUsedPartsCaseId = null;
        s._dfNavSource = null;
        s._dfNewSession = false;
        s._dfSavedToList = false;
        s._dfPage = '1';
        const dfModal = document.getElementById('defectReportModal');
        if (dfModal) {
            dfModal.style.zIndex = '';
            TVC_App?.clearModalOverWorkProcedure?.('defectReportModal');
        }
        if (TVC_App?.refreshWorkProcedureIfOpen) {
            try { TVC_App.refreshWorkProcedureIfOpen(); } catch (_) { /* keep WP open */ }
        }
        if (s.currentTab === 'history') renderTab();
    }

    return {
        init, renderInbox, renderTab, openCase, openCaseFromList, openCaseFromNav, openNewFromJob, openNewBlank,
        saveDraft, saveModal, submitCase, saveHqReply, saveShipPhase3, saveHqPhase4, startWork,
        printCase, printDefectModal, previewDefectModal, dfReportConfirmByToggle, dfApprovedByToggle, closeModal, closeDefectModal, requestCloseModal, confirmCancelNew, captureForm, uploadAttachment, removeAttachment,
        toggleDfGroupPick, toggleDfJobPick, toggleDfJobRowPick, pickDfGroup, pickDfJob, pickDfJobForRow,
        clearDfJob, clearDfJobRow, addDfJobRow, removeDfJobRow, dfGroupPickSearch, dfJobPickSearch, dfJobRowPickSearch,
        filteredCases, statusLabel, defectListRows,
        dfDetailReport, dfReportConfirm, dfModifyReport, dfModifyCase, dfDeleteReport, dfDeleteByIds,
        isDefectReportConfirmable,
        canOpenDfModifyRow, canDeleteDfListRow, canModifyDfShipCommentsOnly,
        dfListSearch, clearDfListSearch, selectDfListRow, toggleDfListCheck, toggleDfListSelectAll,
        navDefectModal, modifyDefectModal, cancelDefectModalEdit, deleteDefectModal, setDefectReportPage,
        captureDfFormFields, applyFileNoFromPicker,
        buildDefectReportPage2PrintHtmlFromCase,
    };
})();

if (typeof window !== 'undefined') window.TVC_DefectReport = TVC_DefectReport;
