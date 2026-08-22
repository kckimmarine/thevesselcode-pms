/* Work Permit UI — Critical Equipment (Consumption List window + Defect form) */
const TVC_WorkPermitReport = (function () {
    let _ctx = null;
    let _wpHistOpen = false;
    let _wpListSearchT = null;
    let _wpWrUsedPartsBackup = null;
    let _wpFilterGroupKeys = [];
    let _wpFilterStatus = 'all';
    let _wpListPeriodFrom = '';
    let _wpListPeriodTo = '';
    let _wpListSearch = '';
    let _wpListCheckedIds = {};
    let _wpSelectedPermitId = null;
    const WP_PICK_Z = 10100;
    const WP_NO_GROUP_KEY = '__NO_GROUP__';
    const WP_NO_GROUP_LABEL = 'No PMS GROUP';
    let _wpGroupPickSearch = '';
    let _wpJobPickSearch = '';
    let _wpJobRowPickUnbind = null;
    let _wpActiveJobRowIndex = 0;

    function wpTreeLabel(v) {
        return TVC_SpareMenu?.safeTreeLabel?.(v) || String(v || '').trim();
    }

    function normalizeWpJobCode(raw) {
        const s = String(raw || '').trim();
        if (!s || /^(—|-)$/i.test(s)) return '';
        return s;
    }

    function wpIsNoGroup(row) {
        const key = wpVal(row, 'pms_group_key');
        const label = wpVal(row, 'pms_group_no');
        return key === WP_NO_GROUP_KEY || label === WP_NO_GROUP_LABEL || label === 'No selection';
    }

    function wpGroupKey(row) {
        if (wpIsNoGroup(row)) return '';
        const key = wpVal(row, 'pms_group_key');
        if (key && key !== WP_NO_GROUP_KEY) return key;
        const jobId = wpVal(row, 'maintenance_job_id', row?.maintenance_job_id || '');
        const st = getState();
        const job = jobId ? (st.idx?.jobById?.get(jobId) || st.jobs?.find(j => j.id === jobId)) : null;
        if (job?.department && job?.group) return `${job.department}|${String(job.group).trim()}`;
        const label = wpVal(row, 'pms_group_no');
        if (!label) return '';
        const node = (TVC_SpareMenu?.getPlanGroupPickNodes?.(st) || [])
            .find(n => n.label === label || String(n.label || '').trim() === String(label).trim());
        return node?.key || '';
    }

    function permitGroupNodes(st) {
        return TVC_SpareMenu?.getPlanGroupPickNodes?.(st) || [];
    }

    function wpPickMenuEl(wrap) {
        return wrap?._portalMenu || wrap?.querySelector('.spare-consume-pick-menu') || null;
    }

    function wpPickClickInside(wrap, target) {
        if (!wrap || !target) return false;
        const menu = wpPickMenuEl(wrap);
        return wrap.contains(target) || (menu && menu.contains(target));
    }

    function closeWpPickMenu(wrap) {
        if (!wrap) return;
        const menu = wpPickMenuEl(wrap);
        if (menu) {
            menu.classList.remove('spare-consume-pick-menu-portal');
            menu.style.cssText = '';
            if (wrap._portalMenu && menu.parentNode === document.body) wrap.appendChild(menu);
        }
        wrap.classList.remove('open');
    }

    function unbindWpJobRowPickListeners() {
        if (_wpJobRowPickUnbind) {
            _wpJobRowPickUnbind();
            _wpJobRowPickUnbind = null;
        }
    }

    function isWpJobRowPickOpen() {
        const menu = document.getElementById('wpJobRowPickMenu');
        return !!(menu && menu.style.display !== 'none' && menu.classList.contains('spare-consume-pick-menu-portal'));
    }

    function bindWpJobRowPickListeners(rowIdx) {
        unbindWpJobRowPickListeners();
        const menu = document.getElementById('wpJobRowPickMenu');
        const close = (e) => {
            if (menu?.contains(e.target) || document.getElementById(`wpJobPickTrigger-${rowIdx}`)?.contains(e.target)) return;
            closeWpJobRowPickMenu();
        };
        const onReposition = () => {
            if (!isWpJobRowPickOpen()) return;
            positionWpJobRowPickMenu(rowIdx);
        };
        const token = { cancelled: false };
        _wpJobRowPickUnbind = () => {
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

    function closeWpJobRowPickMenu() {
        unbindWpJobRowPickListeners();
        const host = document.getElementById('wpJobRowPickHost');
        const menu = document.getElementById('wpJobRowPickMenu');
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

    function closeAllWpPicks() {
        closeWpPickMenu(document.getElementById('wpGroupPick'));
        closeWpJobRowPickMenu();
    }

    function positionWpPickMenu(wrap, minWidth = 320) {
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
        menu.style.zIndex = String(WP_PICK_Z);
        menu.style.maxHeight = 'min(420px, 70vh)';
    }

    function positionWpJobRowPickMenu(rowIdx = 0) {
        const trigger = document.getElementById(`wpJobPickTrigger-${rowIdx}`);
        const menu = document.getElementById('wpJobRowPickMenu');
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
        menu.style.zIndex = String(WP_PICK_Z);
        menu.style.maxHeight = 'min(420px, 70vh)';
    }

    function bindWpPickClose(wrap, minWidth) {
        const close = (e) => {
            if (!wpPickClickInside(wrap, e.target)) {
                closeWpPickMenu(wrap);
                document.removeEventListener('click', close);
                window.removeEventListener('scroll', onReposition, true);
                window.removeEventListener('resize', onReposition);
            }
        };
        const onReposition = () => {
            if (wrap.classList.contains('open')) positionWpPickMenu(wrap, minWidth);
        };
        setTimeout(() => {
            document.addEventListener('click', close);
            window.addEventListener('scroll', onReposition, true);
            window.addEventListener('resize', onReposition);
        }, 0);
    }

    function ensureWpJobItems(row) {
        const draft = getState()._wpDraft;
        if (!draft) return [];
        if (Array.isArray(draft.job_items) && draft.job_items.length) return draft.job_items;
        if (Array.isArray(row?.job_items) && row.job_items.length) {
            draft.job_items = row.job_items.map(i => ({
                ...TVC_SpareMenu.newConsumeJobRow(i),
                maintenance_job_id: i.maintenance_job_id || '',
            }));
            return draft.job_items;
        }
        const job = row?.maintenance_job_id
            ? (getState().jobs || []).find(j => j.id === row.maintenance_job_id)
            : null;
        draft.job_items = [{
            ...TVC_SpareMenu.newConsumeJobRow({
                job_code: row?.job_code || row?.pms_job_code || job?.job_code || '',
                sort1: row?.item_sort1 || job?.item_sort1 || '',
                sort2: row?.item_sort2 || job?.item_sort2 || '',
                job_detail: row?.job_detail || job?.job_detail || '',
            }),
            maintenance_job_id: row?.maintenance_job_id || job?.id || '',
        }];
        return draft.job_items;
    }

    function syncWpPrimaryJobFromItems(draft) {
        if (!draft) return;
        const items = Array.isArray(draft.job_items) ? draft.job_items : [];
        const primary = items.find(i => normalizeWpJobCode(i.job_code)) || items[0];
        const jobCode = normalizeWpJobCode(primary?.job_code);
        if (!primary || !jobCode) {
            draft.maintenance_job_id = '';
            draft.job_code = '';
            draft.pms_job_code = '';
            draft.item_sort1 = '';
            draft.item_sort2 = '';
            draft.job_detail = '';
            return;
        }
        draft.maintenance_job_id = primary.maintenance_job_id || '';
        draft.job_code = jobCode;
        draft.pms_job_code = jobCode;
        draft.item_sort1 = primary.sort1 || '';
        draft.item_sort2 = primary.sort2 || '';
        draft.job_detail = primary.job_detail || '';
    }

    function captureWpJobItems() {
        const draft = getState()._wpDraft;
        if (!draft) return;
        const container = document.getElementById('wpJobRows');
        if (!container) return;
        const prevItems = ensureWpJobItems(draft);
        const rowEls = container.querySelectorAll('[data-wp-job-row]');
        if (!rowEls.length) return;
        draft.job_items = [...rowEls].map((rowEl, idx) => {
            const prev = prevItems[idx] || {};
            const hiddenCode = rowEl.querySelector('input[data-field="job_code"]')?.value;
            const jobCode = normalizeWpJobCode(hiddenCode) || normalizeWpJobCode(prev.job_code);
            return {
                job_code: jobCode,
                sort1: rowEl.querySelector('[data-field="sort1"]')?.value?.trim() ?? prev.sort1 ?? '',
                sort2: rowEl.querySelector('[data-field="sort2"]')?.value?.trim() ?? prev.sort2 ?? '',
                job_detail: rowEl.querySelector('[data-field="job_detail"]')?.value?.trim() ?? prev.job_detail ?? '',
                maintenance_job_id: rowEl.dataset.jobId || prev.maintenance_job_id || '',
            };
        });
        syncWpPrimaryJobFromItems(draft);
    }

    function buildWpGroupPickList(row) {
        const st = getState();
        const selKey = wpIsNoGroup(row) ? WP_NO_GROUP_KEY : (wpVal(row, 'pms_group_key') || wpGroupKey(row) || '');
        const q = (_wpGroupPickSearch || '').toLowerCase().trim();
        const matchNode = (n) => !q || wpTreeLabel(n.label).toLowerCase().includes(q)
            || String(n.department || '').toLowerCase().includes(q);
        const matchNoSelection = !q || 'no pms group'.includes(q) || q.includes('no pms') || q.includes('no group');
        let html = '';
        if (matchNoSelection) {
            const sel = selKey === WP_NO_GROUP_KEY ? ' selected' : '';
            html += `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-none${sel}"
                onclick="TVC_WorkPermitReport.pickWpGroup('${escAttr(WP_NO_GROUP_KEY)}','${escAttr(WP_NO_GROUP_LABEL)}')">${esc(WP_NO_GROUP_LABEL)}</button>`;
        }
        const nodes = permitGroupNodes(st).filter(matchNode);
        if (!nodes.length && !matchNoSelection) {
            return '<div class="spare-consume-pick-empty muted">No PMS groups found.</div>';
        }
        let curDept = '';
        nodes.forEach(n => {
            if (n.department !== curDept) {
                html += `<div class="spare-consume-pick-dept">${esc(n.department)}</div>`;
                curDept = n.department;
            }
            const sel = selKey === n.key ? ' selected' : '';
            html += `<button type="button" class="spare-consume-pick-item${sel}"
                onclick="TVC_WorkPermitReport.pickWpGroup('${escAttr(n.key)}','${escAttr(n.label)}')">${esc(wpTreeLabel(n.label))}</button>`;
        });
        return html || '<div class="spare-consume-pick-empty muted">No results</div>';
    }

    function buildWpJobPickList(row, rowIdx) {
        const st = getState();
        const groupKey = wpGroupKey(row);
        if (!groupKey) {
            return '<div class="spare-consume-pick-empty muted">Select PMS Group No. first.</div>';
        }
        const q = (_wpJobPickSearch || '').toLowerCase().trim();
        const jobs = (TVC_SpareMenu?.getJobsForGroupKey?.(st, groupKey) || [])
            .filter(j => {
                if (!q) return true;
                const hay = [j.job_code, j.item_sort1, j.item_sort2, j.job_detail].join(' ').toLowerCase();
                return hay.includes(q);
            });
        const items = ensureWpJobItems(row);
        const activeRow = items[rowIdx ?? _wpActiveJobRowIndex ?? 0] || {};
        const selectedCode = activeRow.job_code || '';
        const clearBtn = `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-none${selectedCode ? '' : ' selected'}"
                onclick="TVC_WorkPermitReport.clearWpJobRow()">
                <span class="spare-consume-pick-job-code">— No Job Code —</span>
                <span class="spare-consume-pick-job-sub muted">PMS Group only</span>
            </button>`;
        if (!jobs.length) {
            return clearBtn + '<div class="spare-consume-pick-empty muted">No jobs in this group.</div>';
        }
        return clearBtn + jobs.map(j => {
            const sel = selectedCode === j.job_code ? ' selected' : '';
            const sub = [j.item_sort1, j.item_sort2].filter(Boolean).join(' · ');
            return `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-job${sel}"
                onclick="TVC_WorkPermitReport.pickWpJobForRow('${escAttr(j.id)}')">
                <span class="spare-consume-pick-job-code">${esc(j.job_code || '')}</span>
                ${sub ? `<span class="spare-consume-pick-job-sub">${esc(sub)}</span>` : ''}
            </button>`;
        }).join('');
    }

    function refreshWpGroupPickList() {
        const list = document.getElementById('wpGroupPickList');
        const row = getState()._wpDraft || getModalRow() || {};
        if (list) list.innerHTML = buildWpGroupPickList(row);
    }

    function refreshWpJobRowPickList() {
        const list = document.getElementById('wpJobRowPickList');
        const row = getState()._wpDraft || getModalRow() || {};
        if (list) list.innerHTML = buildWpJobPickList(row, _wpActiveJobRowIndex);
    }

    function wpGroupPickSearch(v) {
        _wpGroupPickSearch = v || '';
        refreshWpGroupPickList();
        const wrap = document.getElementById('wpGroupPick');
        if (wrap?.classList.contains('open')) positionWpPickMenu(wrap, 360);
    }

    function wpJobRowPickSearch(v) {
        _wpJobPickSearch = v || '';
        refreshWpJobRowPickList();
        if (isWpJobRowPickOpen()) positionWpJobRowPickMenu(_wpActiveJobRowIndex || 0);
    }

    function toggleWpGroupPick(ev) {
        ev?.stopPropagation();
        const wrap = document.getElementById('wpGroupPick');
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        closeWpJobRowPickMenu();
        if (!opening) {
            closeWpPickMenu(wrap);
            return;
        }
        wrap.classList.add('open');
        refreshWpGroupPickList();
        positionWpPickMenu(wrap, 360);
        bindWpPickClose(wrap, 360);
    }

    async function toggleWpJobRowPick(ev, idx) {
        ev?.stopPropagation();
        const row = getState()._wpDraft || getModalRow() || {};
        if (!wpGroupKey(row)) {
            await TVC_Dialog.alert('Select PMS Group No. first.');
            return;
        }
        const prevIdx = _wpActiveJobRowIndex;
        _wpActiveJobRowIndex = idx;
        const host = document.getElementById('wpJobRowPickHost');
        const menu = document.getElementById('wpJobRowPickMenu');
        if (!host || !menu) return;
        closeWpPickMenu(document.getElementById('wpGroupPick'));
        const isVisible = menu.style.display && menu.style.display !== 'none';
        if (isVisible && prevIdx === idx) {
            closeWpJobRowPickMenu();
            return;
        }
        refreshWpJobRowPickList();
        positionWpJobRowPickMenu(idx);
        bindWpJobRowPickListeners(idx);
    }

    function applyWpGroupHeader(st, draft, groupKey, groupLabel) {
        const hdr = TVC_SpareMenu?.resolveGroupHeaderByKey?.(st, groupKey, groupLabel) || {};
        draft.pms_group_key = groupKey;
        draft.pms_group_no = groupLabel;
        draft.maker = hdr.maker || draft.maker || '';
        draft.model_type = hdr.modelType || draft.model_type || '';
        draft.capacity = hdr.capacity || draft.capacity || '';
        draft.serial_no = hdr.serialNo || draft.serial_no || '';
    }

    function applyWpJobPickToDraft(draft, job, rowIdx = 0) {
        const s = getState();
        ensureWpJobItems(draft);
        draft.job_items[rowIdx] = {
            maintenance_job_id: job.id,
            job_code: job.job_code || '',
            sort1: job.item_sort1 || '',
            sort2: job.item_sort2 || '',
            job_detail: job.job_detail || '',
        };
        if (rowIdx === 0) {
            draft.last_maintenance_date = job.last_done || draft.last_maintenance_date || '';
            draft.job_name = job.job_detail || job.item_sort2 || draft.job_name || '';
            const hdr = TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
            draft.maker = hdr.maker || '';
            draft.model_type = hdr.modelType || '';
            draft.capacity = hdr.capacity || '';
            draft.serial_no = hdr.serialNo || '';
        }
        syncWpPrimaryJobFromItems(draft);
    }

    function applyWpNoGroupHeader(draft) {
        draft.pms_group_key = WP_NO_GROUP_KEY;
        draft.pms_group_no = WP_NO_GROUP_LABEL;
        draft.maker = '';
        draft.model_type = '';
        draft.capacity = '';
        draft.serial_no = '';
    }

    function pickWpGroup(groupKey, groupLabel) {
        captureWpFormFields();
        captureWpJobItems();
        const draft = ensureWpDraft(getModalRow() || {});
        const prevKey = draft.pms_group_key || wpGroupKey(draft) || '';
        if (prevKey !== groupKey) {
            draft.maintenance_job_id = '';
            draft.job_code = '';
            draft.pms_job_code = '';
            draft.item_sort1 = '';
            draft.item_sort2 = '';
            draft.job_detail = '';
            draft.job_items = [TVC_SpareMenu.newConsumeJobRow()];
        }
        if (groupKey === WP_NO_GROUP_KEY) applyWpNoGroupHeader(draft);
        else applyWpGroupHeader(getState(), draft, groupKey, groupLabel);
        closeWpPickMenu(document.getElementById('wpGroupPick'));
        refreshWorkPermitModal({ preserveScroll: true, preserveHist: true });
    }

    function pickWpJobForRow(jobId) {
        captureWpFormFields();
        captureWpJobItems();
        const s = getState();
        const draft = ensureWpDraft(getModalRow() || {});
        const job = s.idx?.jobById?.get(jobId) || s.jobs?.find(j => j.id === jobId);
        if (!job) return;
        applyWpJobPickToDraft(draft, job, _wpActiveJobRowIndex || 0);
        closeWpJobRowPickMenu();
        refreshWorkPermitModal({ preserveScroll: true, preserveHist: true });
    }

    function clearWpJobRow() {
        captureWpFormFields();
        captureWpJobItems();
        const draft = ensureWpDraft(getModalRow() || {});
        const idx = _wpActiveJobRowIndex || 0;
        ensureWpJobItems(draft);
        draft.job_items[idx] = TVC_SpareMenu.newConsumeJobRow();
        if (idx === 0) {
            draft.maintenance_job_id = '';
            draft.job_code = '';
            draft.pms_job_code = '';
            draft.item_sort1 = '';
            draft.item_sort2 = '';
            draft.job_detail = '';
        }
        syncWpPrimaryJobFromItems(draft);
        closeWpJobRowPickMenu();
        refreshWorkPermitModal({ preserveScroll: true, preserveHist: true });
    }

    function addWpJobRow() {
        captureWpFormFields();
        captureWpJobItems();
        closeAllWpPicks();
        const draft = ensureWpDraft(getModalRow() || {});
        ensureWpJobItems(draft);
        draft.job_items.push(TVC_SpareMenu.newConsumeJobRow());
        refreshWorkPermitModal({ preserveScroll: true, preserveHist: true });
    }

    function removeWpJobRow(idx) {
        captureWpFormFields();
        captureWpJobItems();
        closeAllWpPicks();
        const draft = ensureWpDraft(getModalRow() || {});
        ensureWpJobItems(draft);
        if (draft.job_items.length <= 1) return;
        draft.job_items.splice(idx, 1);
        if (_wpActiveJobRowIndex >= draft.job_items.length) {
            _wpActiveJobRowIndex = Math.max(0, draft.job_items.length - 1);
        }
        syncWpPrimaryJobFromItems(draft);
        refreshWorkPermitModal({ preserveScroll: true, preserveHist: true });
    }

    function renderWpGroupPick(row, ro) {
        const label = wpVal(row, 'pms_group_no');
        const text = wpIsNoGroup(row)
            ? WP_NO_GROUP_LABEL
            : (label ? wpTreeLabel(label) : '— Select PMS Group —');
        if (ro) {
            return `<input class="wr-ro" value="${esc(text)}" readonly tabindex="-1">`;
        }
        return `<div class="spare-consume-meta-pick" id="wpGroupPick">
            <button type="button" class="wr-maint-job-pick spare-consume-pick-trigger" onclick="TVC_WorkPermitReport.toggleWpGroupPick(event)">
                <span class="spare-consume-pick-text">${esc(text)}</span>
                <span class="spare-consume-pick-caret" aria-hidden="true">▾</span>
            </button>
            <div class="spare-consume-pick-menu" role="listbox" aria-label="PMS Group No.">
                <div class="spare-consume-pick-search">
                    <input type="search" class="search-input" placeholder="Search GROUP…" value="${esc(_wpGroupPickSearch)}"
                        oninput="TVC_WorkPermitReport.wpGroupPickSearch(this.value)" onclick="event.stopPropagation()">
                </div>
                <div class="spare-consume-pick-head muted">PMS GROUP Tree</div>
                <div class="spare-consume-pick-scroll" id="wpGroupPickList"></div>
            </div>
        </div>`;
    }

    function renderWpMaintJobRowHtml(item, idx, opts = {}) {
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
            jobInner = `<button type="button" id="wpJobPickTrigger-${idx}" class="wr-maint-job-pick spare-consume-job-pick-trigger"${jobDisabled ? ' disabled' : ''} onclick="TVC_WorkPermitReport.toggleWpJobRowPick(event, ${idx})">
                    <span class="spare-consume-pick-text">${esc(item.job_code || '— No Job Code —')}</span>
                    <span class="spare-consume-pick-caret" aria-hidden="true">▾</span>
                </button>
                <input type="hidden" data-field="job_code" value="${escAttr(item.job_code || '')}">`;
        }
        const actCol = batch && !ro && (opts.rowCount || 0) > 1
            ? `<div class="wr-maint-field df-maint-job-row-act${hideLabels ? ' wr-maint-field-nolabel' : ''}">${hideLabels ? '' : '<label aria-hidden="true">&nbsp;</label>'}<button type="button" class="btn btn-sm spare-consume-job-row-rm" onclick="TVC_WorkPermitReport.removeWpJobRow(${idx})" title="Remove job row" aria-label="Remove job row">×</button></div>`
            : '';
        const gapCls = idx === 0 ? ' wr-maint-grid-gap' : '';
        const gridCols = actCol ? ' wr-maint-grid-4 df-maint-job-grid-batch' : ' wr-maint-grid-4';
        return `<div class="wr-maint-grid${gridCols}${gapCls} df-maint-job-row" data-wp-job-row="${idx}" data-job-id="${escAttr(item.maintenance_job_id || '')}">
                ${fld('Job Code', jobInner)}
                ${fld('SORT-1', roInp(item.sort1, 'sort1'))}
                ${fld('SORT-2', roInp(item.sort2, 'sort2'))}
                ${fld('Job Detail', ro ? roInp(item.job_detail, 'job_detail') : `<input type="text" id="wpJobDetail-${idx}" data-field="job_detail" value="${esc(item.job_detail || '')}">`)}
                ${actCol}
            </div>`;
    }

    function renderWpJobRowsBlock(row, ro) {
        ensureWpJobItems(row);
        const draft = getState()._wpDraft || row;
        const items = draft.job_items || [];
        const groupKey = wpGroupKey(row);
        const multiJob = items.length > 1 || (!ro && !!groupKey);
        const header = multiJob && TVC_SpareMenu.renderMaintJobRowsHeaderHtml
            ? TVC_SpareMenu.renderMaintJobRowsHeaderHtml({ withActionCol: !ro && items.length > 1 })
            : '';
        const rows = items.map((item, idx) => renderWpMaintJobRowHtml(item, idx, {
            readonly: ro,
            batch: !ro,
            groupKey,
            rowCount: items.length,
            hideLabels: multiJob,
        })).join('');
        const addBtn = !ro && groupKey
            ? `<div class="spare-consume-meta-job-add">
                <button type="button" class="btn btn-sm spare-consume-job-row-add" onclick="TVC_WorkPermitReport.addWpJobRow()" title="Add JOB CODE row">+</button>
               </div>`
            : '';
        const pickHost = !ro
            ? `<div id="wpJobRowPickHost" class="spare-consume-job-pick-host hidden" aria-hidden="true">
                <div id="wpJobRowPickMenu" class="spare-consume-pick-menu" role="listbox" aria-label="JOB CODE" style="display:none">
                    <div class="spare-consume-pick-search">
                        <input type="search" class="search-input" placeholder="Search JOB CODE / SORT / DETAIL…" value="${esc(_wpJobPickSearch)}"
                            oninput="TVC_WorkPermitReport.wpJobRowPickSearch(this.value)" onclick="event.stopPropagation()">
                    </div>
                    <div class="spare-consume-pick-scroll" id="wpJobRowPickList"></div>
                </div>
            </div>`
            : '';
        return `<div class="df-page1-job-rows wr-maint-span-all" id="wpJobRows">${header}${rows}${addBtn}</div>${pickHost}`;
    }

    const WP_LIST_COLGROUP = `<colgroup>
        <col class="wp-col-chk"><col class="wp-col-type"><col class="wp-col-file"><col class="wp-col-crit">
        <col class="wp-col-job"><col class="wp-col-sort1"><col class="wp-col-sort2"><col class="wp-col-reported"><col class="wp-col-status">
    </colgroup>`;

    function init(ctx) { _ctx = ctx; }
    function getState() { return _ctx?.getState?.() || {}; }
    async function refresh() { if (_ctx?.refresh) await _ctx.refresh(); }

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }
    function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }

    function isHq() {
        return TVC_RBAC.isHqAccount(getState().user);
    }

    function isWpListWindow() {
        return !!getState()._wpListMode;
    }

    /** HQ — Company's Comments until HQ reply is exported (ship fields stay locked). */
    function canOpenWpHqCommentEdit(row) {
        if (!row || !isHq() || row.visible_in_list === false) return false;
        if (row.id === 'wp-draft-empty') return false;
        if (TVC_WorkPermit.isHqReplyExported(row)) return false;
        const st = TVC_WorkPermit.listWorkflowStatus(row);
        return st === 'Submitted' || st === 'Confirmed' || st === 'Approved';
    }

    function canOpenWpModify(row) {
        if (!row) return false;
        if (TVC_WorkPermit.canModifyListWorkflow(row)) return true;
        return canOpenWpHqCommentEdit(row);
    }

    function wpCompanyCommentLocked(row) {
        if (!row || !isHq()) return true;
        if (TVC_WorkPermit.isHqReplyExported(row)) return true;
        if (isWpListWindow()) return !getState()._wpListEditing;
        return getState()._wpMode === 'view';
    }

    function syncWpCompanyCommentLock(row) {
        const el = document.querySelector('#workPermitBody textarea[data-wp="company_comment"]');
        if (!el) return;
        const locked = wpCompanyCommentLocked(row || getModalRow());
        el.readOnly = locked;
        el.classList.toggle('wr-ro', locked);
    }

    function wpToolbarBtn(label, onclick, disabled = false, cls = '') {
        const dis = disabled ? ' disabled' : '';
        const c = cls ? ` ${cls}` : '';
        return `<button type="button" class="btn btn-sm${c}" onclick="${onclick}"${dis}>${label}</button>`;
    }

    function setWpToolbarBtnDisabled(scope, onclickNeedle, disabled) {
        if (!scope) return;
        scope.querySelectorAll(`button[onclick*="${onclickNeedle}"]`).forEach(btn => {
            btn.disabled = !!disabled;
        });
    }

    function wpCheckedConfirmableIds() {
        const s = getState();
        const allRows = filteredPermits();
        return wpCheckedIds().filter(id => {
            const r = allRows.find(x => x.id === id) || (s.workPermits || []).find(x => x.id === id);
            return r && isPermitConfirmable(r);
        });
    }

    function wpListActionState() {
        const s = getState();
        const user = s.user;
        const isHqUser = isHq();
        const allRows = filteredPermits();
        const showConfirm = !isHqUser && !!user && allRows.some(r =>
            isPermitConfirmable(r) && TVC_RBAC.canConfirmDepartment(user, r.department));
        const canConfirm = showConfirm && wpCheckedConfirmableIds().length > 0;
        const canApprove = isHqUser && wpCheckedIds().some(id => {
            const r = allRows.find(x => x.id === id);
            return r && !r.approved_at && (r.confirmed_at || TVC_RBAC.canHqDirectApprove(user, r));
        });
        const canDelete = wpCheckedIds().some(id => {
            const r = allRows.find(x => x.id === id);
            return r && TVC_WorkPermit.canDeleteListWorkflow(r);
        });
        return { showConfirm, canConfirm, canApprove, canDelete, isHqUser };
    }

    function syncWpListToolbarState() {
        const panel = document.getElementById('wpHistPanel');
        const head = panel?.querySelector('.spare-req-hist-popover-head');
        if (!head) return;
        const { canConfirm, canApprove, canDelete } = wpListActionState();
        setWpToolbarBtnDisabled(head, 'wpListConfirm', !canConfirm);
        setWpToolbarBtnDisabled(head, 'wpListApprove', !canApprove);
        setWpToolbarBtnDisabled(head, 'wpListDelete', !canDelete);
    }

    function scopedJobs() {
        return (getState().jobs || []).filter(Boolean);
    }

    function filteredPermits() {
        const s = getState();
        let rows = (s.workPermits || []).filter(r => r.visible_in_list !== false);
        if (isHq() && s.selectedVesselId) {
            rows = rows.filter(r => r.vessel_id === s.selectedVesselId);
        }
        const dept = s.department || s.user?.department;
        if (dept && (isHq() || (typeof TVC_Space !== 'undefined' && TVC_Space.canSwitchDepartmentView?.(s.user)))) {
            const jobs = s._allJobs || s.jobs || [];
            rows = rows.filter(r => TVC_App?.workPermitBelongsToDept?.(r, dept, jobs) ?? TVC_WorkPermit.belongsToDepartment(r, dept));
        }
        return rows.sort((a, b) => String(b.report_date || b.plan_date || '').localeCompare(String(a.report_date || a.plan_date || '')));
    }

    function wpDateInPeriod(dateStr, from, to) {
        const d = String(dateStr || '').slice(0, 10);
        if (!d) return !from && !to;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    }

    function resolveWpGroupKey(row, st = getState()) {
        if (!row) return null;
        const direct = String(row.pms_group_key || '').trim();
        if (direct) return direct;
        const jobId = row.maintenance_job_id;
        if (jobId && st.idx?.jobById?.get(jobId)) {
            const job = st.idx.jobById.get(jobId);
            return `${job.department || ''}|${String(job.group || '').trim()}`;
        }
        const code = row.pms_job_code || row.job_code;
        if (code) {
            const job = st.idx?.jobById
                ? [...st.idx.jobById.values()].find(j => j.job_code === code)
                : (st.jobs || []).find(j => j.job_code === code);
            if (job) return `${job.department || ''}|${String(job.group || '').trim()}`;
        }
        const pmsNo = String(row.pms_group_no || '').trim();
        if (pmsNo && st.idx?.groupNodes) {
            const short = pmsNo.replace(/\s+/g, '');
            const node = st.idx.groupNodes.find(n =>
                String(n.label || '').replace(/\s+/g, '') === short
                || String(n.key || '').includes(short)
            );
            if (node) return node.key;
        }
        return null;
    }

    function wpMatchSearch(row, q) {
        if (!q) return true;
        const hay = [
            row.file_no, row.job_code, row.pms_job_code,
            row.item_sort1, row.item_sort2, row.outline_work_permit, row.company_comment,
            row.permit_no, TVC_WorkPermit.listWorkflowStatus(row),
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
    }

    function listRows() {
        const q = (_wpListSearch || '').trim().toLowerCase();
        const statusFilter = String(_wpFilterStatus || 'all').toLowerCase();
        const groupKeys = _wpFilterGroupKeys || [];
        return filteredPermits().filter(r => {
            if (!wpDateInPeriod(r.report_date || r.plan_date, _wpListPeriodFrom, _wpListPeriodTo)) return false;
            if (!wpMatchSearch(r, q)) return false;
            if (statusFilter && statusFilter !== 'all') {
                const st = TVC_WorkPermit.listWorkflowStatus(r).toLowerCase();
                if (st !== statusFilter) return false;
            }
            if (groupKeys.length) {
                const gk = resolveWpGroupKey(r);
                if (!gk || !groupKeys.includes(gk)) return false;
            }
            return true;
        });
    }

    function getWpListFilters() {
        return { groupKeys: [...(_wpFilterGroupKeys || [])], status: _wpFilterStatus || 'all' };
    }

    function setWpListFilters(patch = {}) {
        if (patch.groupKeys !== undefined) {
            _wpFilterGroupKeys = Array.isArray(patch.groupKeys) ? [...patch.groupKeys] : [];
        }
        if (patch.status !== undefined) {
            _wpFilterStatus = String(patch.status || 'all').toLowerCase() || 'all';
        }
        TVC_ListFilters?.syncBtn?.('workPermit');
        refreshWpListUi();
    }

    function ensureWpChecked() {
        if (!_wpListCheckedIds || typeof _wpListCheckedIds !== 'object') _wpListCheckedIds = {};
        return _wpListCheckedIds;
    }

    function wpIsRowChecked(id) {
        return !!ensureWpChecked()[id];
    }

    function syncWpListRowSelection(root) {
        const scope = root || document;
        const selId = _wpSelectedPermitId;
        scope.querySelectorAll('#wpHistListScroll .wp-list-row[data-wp-list-id]').forEach(tr => {
            tr.classList.toggle('sr-req-sel', tr.dataset.wpListId === selId);
        });
    }

    function wpCheckedIds() {
        return Object.keys(ensureWpChecked()).filter(k => ensureWpChecked()[k]);
    }

    function wpListHasDisplayedPermit() {
        if (!isWpListWindow()) return false;
        const id = getState()._workPermitId;
        if (!id) return false;
        return !!(getState().workPermits || []).find(r => r.id === id);
    }

    function wpListViewLocked() {
        return isWpListWindow() && !getState()._wpListEditing;
    }

    function wpVal(row, key, fallback = '') {
        const draft = getState()._wpDraft;
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

    function reportedByLabel(row) {
        if (row?.reporter_name) return row.reporter_name;
        if (row?.reported_by && TVC_RBAC.getReportedByLabelForRecord) {
            return TVC_RBAC.getReportedByLabelForRecord(row);
        }
        return TVC_RBAC.getReportedByLabel(getState().user) || '—';
    }

    function ensureWpDraft(row) {
        const s = getState();
        if (!s._wpDraft || s._wpDraftId !== row.id) {
            s._wpDraftId = row.id;
            s._wpDraft = { ...row };
        }
        return s._wpDraft;
    }

    function getModalRow() {
        const s = getState();
        const id = s._workPermitId;
        if (!id) return null;
        const base = (s.workPermits || []).find(r => r.id === id) || {};
        return { ...base, ...(s._wpDraft || {}), id };
    }

    function upsertPermitInState(row) {
        if (!row?.id) return;
        const s = getState();
        if (!Array.isArray(s.workPermits)) s.workPermits = [];
        const i = s.workPermits.findIndex(r => r.id === row.id);
        if (i >= 0) s.workPermits[i] = row;
        else s.workPermits.push(row);
    }

    function enrichWpUsedParts(lines) {
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
                qty_used: Number(line.qty_estimated ?? line.qty_used) || 0,
            };
        });
    }

    function ensureWpUsedParts(row) {
        const s = getState();
        if (s._wpUsedPartsCaseId !== row.id) {
            s._wpUsedPartsCaseId = row.id;
            s._wpUsedParts = enrichWpUsedParts(row.estimated_parts || []);
        }
        return s._wpUsedParts;
    }

    function captureWpUsedParts() {
        const host = document.getElementById('workPermitBody');
        const s = getState();
        const onPage2 = (s._wpPage || '1') === '2' && !!document.getElementById('wrSpareListScroll');
        const list = onPage2 ? (s._wrUsedParts || s._wpUsedParts || []) : (s._wpUsedParts || []);
        if (host) {
            host.querySelectorAll('.spare-consume-qty-input').forEach(el => {
                const table = el.closest('[data-spare-id]');
                const id = table?.dataset?.spareId;
                if (!id) return;
                const line = list.find(p => String(p.spare_part_id ?? '') === String(id));
                if (line) line.qty_used = Math.max(0, Math.floor(Number(el.value) || 0));
            });
        }
        s._wpUsedParts = list.map(p => ({ ...p }));
        return s._wpUsedParts;
    }

    function wpUsedPartsPayload() {
        return (getState()._wpUsedParts || [])
            .filter(p => Number(p.qty_used) > 0)
            .map(p => ({ spare_part_id: p.spare_part_id, qty_estimated: Number(p.qty_used) || 0, qty_used: Number(p.qty_used) || 0 }));
    }

    function wpSpareContextEnter() {
        const s = getState();
        _wpWrUsedPartsBackup = s._wrUsedParts;
        s._wrUsedParts = s._wpUsedParts || [];
    }

    function wpSpareContextLeave() {
        const s = getState();
        s._wpUsedParts = (s._wrUsedParts || []).map(p => ({ ...p }));
        if (_wpWrUsedPartsBackup !== null) {
            s._wrUsedParts = _wpWrUsedPartsBackup;
            _wpWrUsedPartsBackup = null;
        }
    }

    function syncWpSparePage2Ui(onPage2, ro) {
        if (onPage2) {
            wpSpareContextEnter();
            TVC_SpareMenu.initWrSparePage2(ro);
        } else {
            TVC_SpareMenu.teardownWrSparePage2();
            wpSpareContextLeave();
        }
    }

    function teardownWpSpareUi() {
        if ((getState()._wpPage || '1') === '2') captureWpUsedParts();
        TVC_SpareMenu.teardownWrSparePage2();
        wpSpareContextLeave();
    }

    function buildWpPage2Meta(row) {
        const s = getState();
        const job = s.idx?.jobById?.get(row.maintenance_job_id) || s.jobs?.find(j => j.id === row.maintenance_job_id);
        const jobHdr = job && TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
        return {
            reportDate: wpVal(row, 'report_date', row.report_date || ''),
            workDate: wpVal(row, 'plan_date', row.plan_date || ''),
            workDateLabel: 'Plan Date',
            reportedBy: reportedByLabel(row),
            pmsGroupNo: wpVal(row, 'pms_group_no', jobHdr.pmsGroupNo || row.pms_group_no || ''),
            groupKey: row.pms_group_key || (job ? `${job.department}|${String(job.group || '').trim()}` : ''),
            jobCode: wpVal(row, 'pms_job_code', job?.job_code || row.job_code || ''),
            sort1: wpVal(row, 'item_sort1', job?.item_sort1 || ''),
            sort2: wpVal(row, 'item_sort2', job?.item_sort2 || ''),
            jobDetail: wpVal(row, 'job_detail', job?.job_detail || ''),
            shipComments: '',
            jobItems: row.job_items?.length ? row.job_items : [{
                job_code: row.job_code || row.pms_job_code,
                sort1: row.item_sort1,
                sort2: row.item_sort2,
                job_detail: row.job_detail,
                maintenance_job_id: row.maintenance_job_id,
            }],
            allowAdd: false,
            page2Subtitle: 'Estimated spare parts (reference only — no inventory deduction)',
        };
    }

    function renderWpPage2Body(row, ro) {
        return `<p class="muted wp-spare-ref-note">Estimated spare parts on Page 2 are for reference only — not linked to SPARE consumption or inventory.</p>`
            + TVC_SpareMenu.renderWrSparePage2Html(null, ro, buildWpPage2Meta(row));
    }

    function wpApprovalState(row) {
        const s = getState();
        const user = s.user;
        const isConfirmed = !!(row.confirmed_at || row.confirmed_by);
        const isApproved = !!(row.approved_at || row.approved_by);
        const editMode = s._wpMode !== 'view' && !wpListViewLocked();
        const canConfirmNew = isPermitConfirmable(row);
        const canUnconfirmNow = editMode && isConfirmed && !isApproved
            && !!user && TVC_RBAC.canConfirmDepartment(user, row.department);
        const canConfirmNow = canConfirmNew || canUnconfirmNow;
        const canUnapproveNow = isHq() && editMode && isApproved && !!user && TVC_RBAC.canApproveHqReport(user)
            && !TVC_WorkPermit.isHqReplyExported(row);
        const canApproveNow = canUnapproveNow || (!isApproved && !!user && TVC_RBAC.canApproveHqReport(user)
            && (isConfirmed || TVC_RBAC.canHqDirectApprove(user, row)));
        return {
            isConfirmed, isApproved, canConfirmNow, canApproveNow,
            confirmedByVal: isConfirmed
                ? (TVC_RBAC.resolveConfirmByLabel?.(row.confirmed_by, row.department, user) || row.confirmed_by || '')
                : '',
            approvedByVal: isApproved ? (row.approved_by || 'Company') : '',
        };
    }

    function renderWpPageTabsHtml(wpPage) {
        return `
            <div class="wr-pagetabs">
                <button type="button" class="wr-pagetab${wpPage === '1' ? ' active' : ''}" data-wp-page="1" onclick="TVC_WorkPermitReport.setWorkPermitPage('1')">Page 1</button>
                <button type="button" class="wr-pagetab${wpPage === '2' ? ' active' : ''}" data-wp-page="2" onclick="TVC_WorkPermitReport.setWorkPermitPage('2')">Page 2</button>
            </div>`;
    }

    function syncWpPageTabs() {
        const wpPage = getState()._wpPage || '1';
        document.querySelectorAll('#workPermitBody .wr-pagetab[data-wp-page]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.wpPage === wpPage);
        });
    }

    function renderWpApprovalHtml(row, opts = {}) {
        const forPrint = !!opts.forPrint;
        const { isConfirmed, isApproved, canConfirmNow, canApproveNow, confirmedByVal, approvedByVal } = wpApprovalState(row);
        const displayOnly = forPrint || !!opts.displayOnly || getState()._wpNavSource === 'history';
        const confirmDis = displayOnly || !canConfirmNow ? ' disabled' : '';
        const approveDis = displayOnly || !canApproveNow ? ' disabled' : '';
        return `<section class="wr-maint-card wr-maint-approval">
            <div class="wr-maint-approval-item${!displayOnly && canConfirmNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="wpConfirmedBy"${isConfirmed ? ' checked' : ''}${confirmDis}${displayOnly ? '' : ' onchange="TVC_WorkPermitReport.wpConfirmByToggle()"'}> Confirmed by</label>
                <input class="wr-ro wr-maint-date" value="${esc(confirmedByVal)}" readonly tabindex="-1">
            </div>
            <div class="wr-maint-approval-item${!displayOnly && canApproveNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="wpApprovedBy"${isApproved ? ' checked' : ''}${approveDis}${displayOnly ? '' : ' onchange="TVC_WorkPermitReport.wpApprovedByToggle()"'}> Approved by</label>
                <input class="wr-ro wr-maint-date" value="${esc(approvedByVal)}" readonly tabindex="-1">
            </div>
        </section>`;
    }

    function wpCritMarkHtml() {
        return `<svg class="plan-crit-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <path fill="none" stroke="#9b2c2c" stroke-width="1.35" stroke-linejoin="round" d="M8 2.8 13.6 12.8H2.4Z"/>
            <path fill="none" stroke="#9b2c2c" stroke-width="1.35" stroke-linecap="round" d="M8 6.4v3.1"/>
            <circle fill="#9b2c2c" cx="8" cy="11.1" r="0.85"/>
        </svg>`;
    }

    function wpTypeCell() {
        return `<td class="spare-consume-log-type hist-type hist-type-wp" title="Work Permit"><span class="hist-type-mark">W</span></td>`;
    }

    function wpCritCell() {
        return `<td class="hist-crit" title="Critical Equipment">${wpCritMarkHtml()}</td>`;
    }

    function wpStatusCell(row) {
        const label = TVC_WorkPermit.listWorkflowStatus(row);
        const cls = label.replace(/\s+/g, '');
        return `<span class="sr-status wp-st-${escAttr(cls)}">${esc(label)}</span>`;
    }

    function wpListTableHeadHtml(headChkId = 'wpListHeadChkAll') {
        return `<thead><tr>
            <th class="wp-list-chk">
                <input type="checkbox" id="${headChkId}" class="spare-head-chk wp-list-head-chk" aria-label="Select all work permits"
                    onclick="event.stopPropagation()" onchange="TVC_WorkPermitReport.wpListToggleAll(this.checked)">
            </th>
            <th class="wp-list-th-type" title="W: Work Permit">Type</th>
            <th class="wp-list-th-file">File No</th>
            <th class="wp-list-th-crit" title="Critical Equipment" aria-label="Critical Equipment">⚠</th>
            <th class="wp-list-th-job">JOB CODE</th>
            <th class="wp-list-th-sort">SORT-1</th>
            <th class="wp-list-th-sort">SORT-2</th>
            <th class="wp-list-th-reported"><span class="hist-th-stack"><span>Reported</span><span>Date</span></span></th>
            <th class="wp-list-th-status">Status</th>
        </tr></thead>`;
    }

    function buildWpListRowsHtml(rows) {
        if (!rows.length) {
            return `<tr><td colspan="9" class="spare-req-list-empty">
                <span class="spare-req-list-empty-icon" aria-hidden="true">📋</span>
                <p class="spare-req-list-empty-title">No Work Permit records yet</p>
                <p class="spare-req-list-empty-sub muted">Click <strong>New</strong> to create one, or adjust Period / Search.</p>
            </td></tr>`;
        }
        return rows.map(r => {
            const pid = escAttr(r.id);
            const checked = wpIsRowChecked(r.id);
            const sel = _wpSelectedPermitId === r.id;
            const jobCode = r.pms_job_code || r.job_code || '';
            const sort1 = r.item_sort1 || '';
            const sort2 = r.item_sort2 || '';
            const reported = String(r.report_date || r.plan_date || '').slice(0, 10);
            const fileNo = r.file_no || '';
            return `<tr class="wp-list-row spare-consume-log-row${sel ? ' sr-req-sel' : ''}" data-wp-list-id="${pid}"
                onclick="TVC_WorkPermitReport.wpListSelectRow('${pid}')">
                <td class="wp-list-chk" onclick="event.stopPropagation()">
                    <input type="checkbox" class="spare-row-chk"${checked ? ' checked' : ''} aria-label="Select work permit"
                        onclick="event.stopPropagation()"
                        onchange="TVC_WorkPermitReport.wpListToggleRow('${pid}', this.checked)">
                </td>
                ${wpTypeCell()}
                <td class="wp-list-file"${fileNo ? ` title="${escAttr(fileNo)}"` : ''}>${esc(fileNo || '—')}</td>
                ${wpCritCell()}
                <td class="wp-list-job"${jobCode ? ` title="${escAttr(jobCode)}"` : ''}>${jobCode ? `<strong>${esc(jobCode)}</strong>` : '—'}</td>
                <td class="wp-list-sort"${sort1 ? ` title="${escAttr(sort1)}"` : ''}>${esc(sort1 || '—')}</td>
                <td class="wp-list-sort"${sort2 ? ` title="${escAttr(sort2)}"` : ''}>${esc(sort2 || '—')}</td>
                <td class="wp-list-reported">${esc(reported || '—')}</td>
                <td class="wp-list-status">${wpStatusCell(r)}</td>
            </tr>`;
        }).join('');
    }

    function renderWpListFiltersHtml() {
        return `<div class="hist-toolbar hist-toolbar-filters spare-consume-log-filters list-filter-stack">
            <div class="filter-bar list-filter-period-row">
                <div id="wpListPeriodFilter" class="act-period-filter" title="Filter by Reported Date">
                    <span class="act-period-label">Period</span>
                    <input type="text" id="wpListPeriodFrom" class="act-period-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" aria-label="Period from"
                        value="${escAttr(_wpListPeriodFrom || '')}" onchange="TVC_WorkPermitReport.wpListSetPeriod()">
                    <span class="act-period-sep">~</span>
                    <input type="text" id="wpListPeriodTo" class="act-period-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" aria-label="Period to"
                        value="${escAttr(_wpListPeriodTo || '')}" onchange="TVC_WorkPermitReport.wpListSetPeriod()">
                    <button type="button" class="btn btn-sm act-period-clear" onclick="TVC_WorkPermitReport.wpListClearPeriod()">Clear</button>
                </div>
                <div class="list-filter-wrap">
                    <button type="button" id="wpListFilterBtn" class="btn btn-sm list-filter-btn" onclick="TVC_ListFilters.toggle('workPermit', event)">Filter</button>
                </div>
            </div>
            <div class="filter-bar list-filter-search-row">
                <div class="search-field-wrap">
                    <input class="search-input" id="wpListSearch" placeholder="Search File No / JOB CODE / SORT / STATUS…"
                        value="${esc(_wpListSearch || '')}" oninput="TVC_WorkPermitReport.wpListSetSearch(this.value)">
                    <button type="button" class="search-clear-btn${_wpListSearch ? '' : ' hidden'}" title="Clear search" aria-label="Clear search"
                        onclick="TVC_WorkPermitReport.wpListClearSearch()">×</button>
                </div>
            </div>
        </div>`;
    }

    function updateWpListHeadCheckAll(rows) {
        document.querySelectorAll('.wp-list-head-chk').forEach(el => {
            if (!rows.length) {
                el.checked = false;
                el.indeterminate = false;
                return;
            }
            let n = 0;
            rows.forEach(r => { if (wpIsRowChecked(r.id)) n++; });
            el.checked = n === rows.length;
            el.indeterminate = n > 0 && n < rows.length;
        });
    }

    function syncWpListFilterUi() {
        const periodEl = document.getElementById('wpListPeriodFilter');
        if (periodEl) periodEl.classList.toggle('active', !!(_wpListPeriodFrom || _wpListPeriodTo));
        TVC_ListFilters?.syncBtn?.('workPermit');
    }

    function syncWpListHeadPad() {
        const scroll = document.getElementById('wpHistListScroll');
        const head = document.getElementById('wpHistListHead');
        if (!scroll || !head) return;
        const sb = scroll.offsetWidth - scroll.clientWidth;
        head.style.paddingRight = sb > 0 ? `${sb}px` : '';
    }

    function wpHistPickBtnLabel() {
        return 'Select File No.';
    }

    function renderPage1(row, readonly, opts = {}) {
        ensureWpDraft(row);
        ensureWpJobItems(row);
        const forPrint = !!opts.forPrint;
        const jobId = wpVal(row, 'maintenance_job_id', row.maintenance_job_id || '');
        const s = getState();
        const job = jobId ? (s.idx?.jobById?.get(jobId) || s.jobs?.find(j => j.id === jobId)) : null;
        const hdr = job && TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
        const ro = readonly || forPrint;
        const roAttr = ro ? ' readonly' : '';
        const roCls = ro ? ' wr-ro' : '';
        const fld = (label, inner, extraCls = '') => `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const inp = (name, val, type = 'text') => {
            const raw = wpVal(row, name, val);
            const v = esc(raw);
            if (type === 'date' && forPrint) {
                return TVC_SpareMenu.buildWrSpareDateUiPrintInput
                    ? TVC_SpareMenu.buildWrSpareDateUiPrintInput(raw)
                    : `<input class="wr-ro tvc-date-input" value="${v}" readonly disabled>`;
            }
            if (type === 'date') return `<input type="date" data-wp="${name}" class="${roCls.trim()}" value="${v}"${roAttr}>`;
            if (type === 'number') return `<input type="number" data-wp="${name}" class="${roCls.trim()}" value="${v}"${roAttr}>`;
            return `<input data-wp="${name}" class="${roCls.trim()}" value="${v}"${roAttr}>`;
        };
        const ta = (name, val, rows = 3, forceRo) => {
            const fieldRo = forceRo == null ? !!ro : !!forceRo;
            const roAttr = fieldRo ? ' readonly' : '';
            const roClsLocal = fieldRo ? ' wr-ro' : '';
            return `<textarea class="wr-maint-textarea${roClsLocal}" data-wp="${name}" rows="${rows}"${roAttr}>${esc(wpVal(row, name, val))}</textarea>`;
        };
        const companyCommentRo = forPrint || wpCompanyCommentLocked(row);
        const spareChk = `<label class="wr-maint-chk wp-est-spare-chk"><input type="checkbox" data-wp="checked_estimated_spare_parts"${wpVal(row, 'checked_estimated_spare_parts') ? ' checked' : ''}${ro ? ' disabled' : ''}> CHECKED ESTIMATED SPARE PARTS</label>`;

        const fileNoInner = forPrint
            ? `<input class="wr-ro" value="${esc(wpVal(row, 'file_no', ''))}" readonly tabindex="-1">`
            : isWpListWindow()
            ? `<div class="spare-req-no-wrap">
                <input data-wp="file_no" class="spare-req-meta-input${roCls}" value="${esc(wpVal(row, 'file_no', ''))}"${roAttr}>
                <span class="spare-req-hist-anchor">
                    <button type="button" id="wpHistBtn" class="btn btn-sm spare-req-hist-btn" onclick="TVC_WorkPermitReport.toggleWpHistList()">${wpHistPickBtnLabel()}</button>
                </span>
            </div>`
            : `<div class="wr-file-no-row">
                <input data-wp="file_no" class="${roCls.trim()}" value="${esc(wpVal(row, 'file_no', ''))}"${roAttr}>
                <button type="button" id="wpFileNoPickBtn" class="btn btn-sm wr-file-no-pick-btn" onclick="TVC_App.openFileNoPickModal('wp')"${ro ? ' disabled' : ''} title="Browse Report History">Check History</button>
            </div>`;

        const histPanel = forPrint
            ? ''
            : isWpListWindow()
            ? `<div id="wpHistPanel" class="spare-req-hist-popover hidden" aria-hidden="true"></div>`
            : `<div id="wpFileNoPickPanel" class="wr-file-no-popover spare-req-hist-popover hidden" aria-hidden="true"></div>`;

        return `<div class="wr-maint-form">
            ${renderWpApprovalHtml(row, { forPrint })}
            <section class="wr-maint-card wr-maint-body wr-file-no-anchor wp-meta-form">
                <div class="wr-maint-grid wr-maint-grid-3">
                    ${fld('File No.', fileNoInner)}
                    ${fld('Voy. No.', inp('voy_no', ''))}
                    ${fld('Place', inp('place', ''))}
                    ${fld('Plan Date', inp('plan_date', row.plan_date || row.report_date, 'date'))}
                    ${fld('Reported Date', inp('report_date', row.report_date, 'date'))}
                    ${fld('Reported by', `<input class="wr-ro" value="${esc(reportedByLabel(row))}" readonly>`)}
                </div>
                ${TVC_App.renderWrPmsGroupCriticalRow({
                    pmsInner: `<div id="wpGroupPickSlot">${renderWpGroupPick(row, ro)}</div>`,
                    criticalLabel: TVC_App.jobCriticalEquipmentDisplay(job, hdr?.pmsGroupNo || wpVal(row, 'pms_group_no', '')),
                    forPrint,
                })}
                <div id="wpJobRowsSection">${renderWpJobRowsBlock(row, ro)}</div>
                ${fld('Job Name', inp('job_name', row.job_name || job?.job_detail || ''), 'wr-maint-span-all wr-maint-grid-gap')}
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Maker', `<input class="wr-ro" data-wp="maker" value="${esc(wpVal(row, 'maker', hdr.maker || ''))}" readonly tabindex="-1">`)}
                    ${fld('Model / Type', `<input class="wr-ro" data-wp="model_type" value="${esc(wpVal(row, 'model_type', hdr.modelType || ''))}" readonly tabindex="-1">`)}
                    ${fld('Capacity', `<input class="wr-ro" data-wp="capacity" value="${esc(wpVal(row, 'capacity', hdr.capacity || ''))}" readonly tabindex="-1">`)}
                    ${fld('Serial No.', `<input class="wr-ro" data-wp="serial_no" value="${esc(wpVal(row, 'serial_no', hdr.serialNo || ''))}" readonly tabindex="-1">`)}
                </div>
                <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap">
                    ${fld('Total Run Hrs', inp('total_run_hrs', '0', 'number'))}
                    ${fld('Last Maintenance Date', inp('last_maintenance_date', job?.last_done || '', 'date'))}
                    ${fld('Running Hrs after Last Maint.', inp('rh_since_last_maintenance', '', 'number'))}
                </div>
                ${fld("Ship's Comments", ta('outline_work_permit', ''), 'wr-maint-span-all wr-maint-grid-gap')}
                ${fld("Company's Comments", ta('company_comment', '', 3, companyCommentRo), 'wr-maint-span-all wr-maint-grid-gap')}
                <div class="wr-maint-span-all wr-maint-grid-gap">${spareChk}</div>
                ${histPanel}
            </section>
        </div>`;
    }

    function renderEditModalBody(row, mode) {
        const forceView = mode === 'view';
        const fromHistoryNav = getState()._wpNavSource === 'history';
        const wpPage = getState()._wpPage || '1';
        const canModifyRow = TVC_WorkPermit.canModifyListWorkflow(row);
        const hqCommentOnly = canOpenWpHqCommentEdit(row);
        const canEdit = !forceView && (canModifyRow || hqCommentOnly);
        const titleText = fromHistoryNav
            ? 'Work Permit'
            : (forceView ? 'Work Permit (View)' : 'Work Permit (Draft)');
        const pageTabs = renderWpPageTabsHtml(wpPage);
        const headHtml = wpPage === '2' ? renderWpApprovalHtml(row) : '';
        const body = wpPage === '2'
            ? renderWpPage2Body(row, forceView || !canModifyRow)
            : renderPage1(row, forceView || !canModifyRow);
        let actionsClass = 'modal-actions wr-actions df-modal-actions';
        let actionsHtml;
        if (fromHistoryNav) {
            actionsClass += ' wr-actions-split df-modal-actions-split';
            const navBtns = TVC_App?.histNavButtonsHtml
                ? TVC_App.histNavButtonsHtml('TVC_WorkPermitReport.navWpHistory(-1)', 'TVC_WorkPermitReport.navWpHistory(1)')
                : '';
            const appr = wpApprovalState(row);
            const isHqUser = isHq();
            const histActionLabel = isHqUser ? 'Approve' : 'Confirm';
            const histActionOk = !forceView && (isHqUser
                ? (appr.canApproveNow || appr.isApproved)
                : (isPermitConfirmable(row) || (appr.isConfirmed && !appr.isApproved)));
            const histActionBtn = `<button type="button" class="btn" onclick="TVC_WorkPermitReport.wpHistConfirmOrApprove()"${histActionOk ? '' : ' disabled'}>${histActionLabel}</button>`;
            const printBtn = `${histActionBtn}<button type="button" class="btn" onclick="TVC_WorkPermitReport.printWpModal()">Print</button>
                <button type="button" class="btn" onclick="TVC_WorkPermitReport.previewWpModal()">Preview</button>`;
            const closeBtn = `<button type="button" class="btn" onclick="TVC_WorkPermitReport.closeModal()">Close</button>`;
            let centerBtns = '';
            if (forceView) {
                const modifyOk = canModifyRow || hqCommentOnly;
                const modifyTitle = modifyOk ? '' : 'Modify not available';
                centerBtns = `<button type="button" class="btn" onclick="TVC_WorkPermitReport.modifyWpFromHistory()"${modifyOk ? '' : ' disabled'}${modifyTitle ? ` title="${escAttr(modifyTitle)}"` : ''}>Modify</button>`;
            } else if (canModifyRow || hqCommentOnly) {
                centerBtns = `<button type="button" class="btn btn-green" onclick="TVC_WorkPermitReport.saveModal()">Save</button>
                <button type="button" class="btn" onclick="TVC_WorkPermitReport.cancelWpHistoryEdit()">Cancel</button>`;
            }
            actionsHtml = `<div class="wr-modal-actions-left df-modal-actions-left">${navBtns}</div>
                <div class="wr-modal-actions-center df-modal-actions-center">${centerBtns}</div>
                <div class="wr-modal-actions-right df-modal-actions-right">${printBtn}${closeBtn}</div>`;
        } else {
            actionsHtml = canEdit
                ? `<button type="button" class="btn btn-green" onclick="TVC_WorkPermitReport.saveModal()">Save</button>
                   <button type="button" class="btn" onclick="TVC_WorkPermitReport.requestCloseModal()">Cancel</button>`
                : `<button type="button" class="btn" onclick="TVC_WorkPermitReport.closeModal()">Close</button>`;
        }

        const kindTabs = typeof TVC_App?.renderReportKindTabsHtml === 'function'
            ? TVC_App.renderReportKindTabsHtml('permit')
            : '';
        return `<div class="df-modal-inner">
            <div class="wr-titlebar">${titleText}</div>
            ${kindTabs}
            <div class="wr-pagetabs-bar">${pageTabs}</div>
            <div class="wr-page tone-defect wp-page">
                ${headHtml}
                ${body}
            </div>
            <div class="${actionsClass}">${actionsHtml}</div>
        </div>`;
    }

    function renderListWindowBody(row) {
        const s = getState();
        const wpPage = s._wpPage || '1';
        const listViewLocked = wpListViewLocked();
        const hasDisplayed = wpListHasDisplayedPermit();
        const listEditing = !!s._wpListEditing;
        const titleSuffix = listEditing ? ' <span class="muted">(Draft)</span>' : '';
        const pageTabs = renderWpPageTabsHtml(wpPage);
        const headHtml = wpPage === '2' ? renderWpApprovalHtml(row) : '';
        const formBody = wpPage === '2'
            ? renderWpPage2Body(row, listViewLocked || !TVC_WorkPermit.canModifyListWorkflow(row))
            : renderPage1(row, listViewLocked || !TVC_WorkPermit.canModifyListWorkflow(row));

        const canModifyNow = hasDisplayed && canOpenWpModify(row);
        const headActions = `${wpToolbarBtn('New', 'TVC_WorkPermitReport.wpListNew()', listEditing, 'btn-green')}
            ${wpToolbarBtn('Modify', 'TVC_WorkPermitReport.wpListEnterEdit()', !canModifyNow || listEditing, '')}
            ${wpToolbarBtn('Save', 'TVC_WorkPermitReport.saveModal()', listViewLocked, 'btn-green')}
            ${wpToolbarBtn('Cancel', 'TVC_WorkPermitReport.wpListCancelEdit()', listViewLocked, '')}
            <span class="orig-toolbar-sep" aria-hidden="true"></span>
            ${wpToolbarBtn('Print', 'TVC_WorkPermitReport.wpListPrint()', !hasDisplayed, '')}
            ${wpToolbarBtn('Preview', 'TVC_WorkPermitReport.wpListPreview()', !hasDisplayed, '')}
            <span class="orig-toolbar-sep" aria-hidden="true"></span>
            ${wpToolbarBtn('Close', 'TVC_WorkPermitReport.closeModal()', false, '')}`;

        return `<div class="df-modal-inner">
            <div class="wr-titlebar wp-list-head">
                <span class="wp-list-head-title">Work Permit${titleSuffix}</span>
                <span class="spare-req-work-head-spacer"></span>
                ${headActions}
            </div>
            <div class="wr-pagetabs-bar">${pageTabs}</div>
            <div class="wr-page tone-defect wp-page">
                ${headHtml}
                ${formBody}
            </div>
        </div>`;
    }

    function captureWpModalScroll() {
        const page = document.querySelector('#workPermitBody .wr-page');
        const modal = document.getElementById('workPermitModal');
        return {
            pageTop: page?.scrollTop ?? 0,
            modalTop: modal?.scrollTop ?? 0,
        };
    }

    function restoreWpModalScroll(saved) {
        if (!saved) return;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const page = document.querySelector('#workPermitBody .wr-page');
                const modal = document.getElementById('workPermitModal');
                if (page) page.scrollTop = saved.pageTop;
                if (modal) modal.scrollTop = saved.modalTop;
            });
        });
    }

    function captureWpHistSnapshot() {
        if (!_wpHistOpen) return null;
        const panel = document.getElementById('wpHistPanel');
        if (!panel || panel.classList.contains('hidden') || !panel.innerHTML.trim()) return null;
        return {
            html: panel.innerHTML,
            scrollTop: document.getElementById('wpHistListScroll')?.scrollTop ?? 0,
            metaOpen: document.querySelector('#workPermitBody .wp-meta-form')?.classList.contains('is-consume-hist-open'),
        };
    }

    function restoreWpHistSnapshot(snap) {
        if (!snap?.html) return;
        const panel = document.getElementById('wpHistPanel');
        const btn = document.getElementById('wpHistBtn');
        const meta = document.querySelector('#workPermitBody .wp-meta-form');
        if (!panel) return;
        panel.innerHTML = snap.html;
        panel.classList.remove('hidden');
        panel.setAttribute('aria-hidden', 'false');
        if (btn) btn.classList.add('is-open');
        if (meta) meta.classList.toggle('is-consume-hist-open', !!snap.metaOpen);
        _wpHistOpen = true;
        syncWpListFilterUi();
        syncWpListToolbarState();
        updateWpListHeadCheckAll(listRows());
        const histScroll = document.getElementById('wpHistListScroll');
        if (histScroll) histScroll.scrollTop = snap.scrollTop;
        requestAnimationFrame(() => {
            positionWpHistPopover();
            syncWpListHeadPad();
        });
        syncWpListRowSelection();
    }

    function wpStableRenderOpts(extra = {}) {
        return isWpListWindow()
            ? { preserveScroll: true, preserveHist: true, ...extra }
            : { ...extra };
    }

    function wpListShellReady() {
        return !!document.querySelector('#workPermitBody .df-modal-inner > .wr-page');
    }

    function syncWpListHeadTitle() {
        const el = document.querySelector('#workPermitBody .wp-list-head-title');
        if (!el) return;
        const listEditing = !!getState()._wpListEditing;
        const suffix = listEditing ? ' <span class="muted">(Draft)</span>' : '';
        el.innerHTML = `Work Permit${suffix}`;
    }

    function syncWpListHeadButtons() {
        const head = document.querySelector('#workPermitBody .wr-titlebar.wp-list-head');
        if (!head) return;
        const hasDisplayed = wpListHasDisplayedPermit();
        const listEditing = !!getState()._wpListEditing;
        const listViewLocked = wpListViewLocked();
        const canModifyNow = hasDisplayed && canOpenWpModify(getModalRow());
        setWpToolbarBtnDisabled(head, 'wpListNew', listEditing);
        setWpToolbarBtnDisabled(head, 'wpListEnterEdit', !canModifyNow || listEditing);
        setWpToolbarBtnDisabled(head, 'saveModal', listViewLocked);
        setWpToolbarBtnDisabled(head, 'wpListCancelEdit', listViewLocked);
        setWpToolbarBtnDisabled(head, 'wpListPrint', !hasDisplayed);
        setWpToolbarBtnDisabled(head, 'wpListPreview', !hasDisplayed);
    }

    function syncWpApprovalSection(row) {
        const r = row || getModalRow();
        if (!r) return;
        const html = renderWpApprovalHtml(r);
        document.querySelectorAll('#workPermitBody .wr-maint-approval').forEach(el => {
            el.outerHTML = html;
        });
    }

    function wpRowVal(row, key, fallback = '') {
        if (row && Object.prototype.hasOwnProperty.call(row, key)) {
            const v = row[key];
            return v == null ? '' : v;
        }
        return fallback ?? '';
    }

    function applyWpFormFieldsFromRow(row) {
        if (!row) return;
        document.querySelectorAll('#workPermitBody [data-wp]').forEach(el => {
            const key = el.dataset.wp;
            if (!key) return;
            const v = wpRowVal(row, key);
            if (el.type === 'checkbox') el.checked = !!v;
            else el.value = v;
        });
        const items = Array.isArray(row.job_items) ? row.job_items : [];
        document.querySelectorAll('#workPermitBody [data-wp-job-row]').forEach((rowEl, idx) => {
            const item = items[idx];
            if (!item) return;
            rowEl.querySelectorAll('[data-field]').forEach(el => {
                const key = el.dataset.field;
                if (!key || item[key] === undefined) return;
                el.value = item[key] || '';
            });
            const pickText = rowEl.querySelector('.spare-consume-pick-text');
            if (pickText && item.job_code !== undefined) pickText.textContent = item.job_code || '— No Job Code —';
        });
    }

    function refreshWpGroupPickSlot(row, ro) {
        const slot = document.getElementById('wpGroupPickSlot');
        if (!slot) return false;
        slot.innerHTML = renderWpGroupPick(row, ro);
        return true;
    }

    function refreshWpJobRowsSection(row, ro) {
        const section = document.getElementById('wpJobRowsSection');
        if (!section) return false;
        section.innerHTML = renderWpJobRowsBlock(row, ro);
        return true;
    }

    async function softRefreshWpListWindow(row, opts = {}) {
        if (!isWpListWindow() || !wpListShellReady()) return false;
        const s = getState();
        const scroll = opts.preserveScroll !== false ? captureWpModalScroll() : null;
        const histScrollEl = _wpHistOpen ? document.getElementById('wpHistListScroll') : null;
        const histScrollTop = histScrollEl?.scrollTop ?? 0;

        closeAllWpPicks();
        const wpPage = s._wpPage || '1';
        const listViewLocked = wpListViewLocked();
        const ro = listViewLocked || !TVC_WorkPermit.canModifyListWorkflow(row);

        if (wpPage === '2') {
            await patchWpListFormBody({ ...opts, preserveScroll: true, preserveHist: opts.preserveHist !== false });
        } else if (document.getElementById('wpGroupPickSlot')) {
            if (opts.resetValues !== false) applyWpFormFieldsFromRow(row);
            refreshWpGroupPickSlot(row, ro);
            refreshWpJobRowsSection(row, ro);
            syncWpApprovalSection(row);
        } else {
            await patchWpListFormBody({ ...opts, preserveScroll: true, preserveHist: opts.preserveHist !== false });
            restoreWpModalScroll(scroll);
            syncWpCompanyCommentLock(row);
            return true;
        }

        syncWpListHeadTitle();
        syncWpListHeadButtons();
        applyWpListScrollLock(document.getElementById('workPermitBody'));
        if (_wpHistOpen) {
            syncWpListRowSelection();
            if (opts.refreshList !== false) await patchWpListUi();
            syncWpListToolbarState();
            if (histScrollEl) histScrollEl.scrollTop = histScrollTop;
        }
        restoreWpModalScroll(scroll);
        TVC_PWA?.initDateInputFormat?.(document.querySelector('#workPermitBody .df-modal-inner > .wr-page'));
        syncWpCompanyCommentLock(row);
        return true;
    }

    async function patchWpListFormBody(opts = {}) {
        const s = getState();
        const row = getModalRow();
        if (!row || !isWpListWindow()) return false;
        const page = document.querySelector('#workPermitBody .df-modal-inner > .wr-page');
        if (!page) return false;

        const scroll = opts.preserveScroll !== false ? captureWpModalScroll() : null;
        const histSnap = opts.preserveHist !== false && _wpHistOpen ? captureWpHistSnapshot() : null;
        closeAllWpPicks();

        if ((s._wpPage || '1') === '2' && document.getElementById('wrSpareListScroll')) {
            captureWpUsedParts();
            TVC_SpareMenu.teardownWrSparePage2();
            wpSpareContextLeave();
        }
        ensureWpUsedParts(row);

        const wpPage = s._wpPage || '1';
        const listViewLocked = wpListViewLocked();
        const ro = listViewLocked || !TVC_WorkPermit.canModifyListWorkflow(row);
        const headHtml = wpPage === '2' ? renderWpApprovalHtml(row) : '';
        const formBody = wpPage === '2' ? renderWpPage2Body(row, ro) : renderPage1(row, ro);
        page.innerHTML = headHtml + formBody;

        if (histSnap) {
            restoreWpHistSnapshot(histSnap);
        } else if (_wpHistOpen) {
            setWpHistOpen(true);
            await refreshWpHistList();
        }

        applyWpListScrollLock(document.getElementById('workPermitBody'));
        if (wpPage === '2') {
            syncWpSparePage2Ui(true, ro);
        }
        syncWpPageTabs();
        restoreWpModalScroll(scroll);
        TVC_PWA?.initDateInputFormat?.(page);
        return true;
    }

    async function refreshWpListWindowUi(opts = {}) {
        if (!isWpListWindow()) {
            await renderWorkPermitModal(wpStableRenderOpts(opts));
            return;
        }
        if (!wpListShellReady()) {
            await renderWorkPermitModal(wpStableRenderOpts(opts));
            return;
        }
        if (opts.approvalOnly) {
            syncWpApprovalSection();
            syncWpListHeadButtons();
            return;
        }
        syncWpListHeadTitle();
        syncWpListHeadButtons();
        if (opts.form !== false) {
            await patchWpListFormBody(wpStableRenderOpts(opts));
        }
    }

    async function renderWorkPermitModal(opts = {}) {
        if (isWpListWindow()) {
            opts = wpStableRenderOpts(opts);
        }
        const scroll = opts.preserveScroll ? captureWpModalScroll() : null;
        const histSnap = opts.preserveHist && _wpHistOpen ? captureWpHistSnapshot() : null;
        closeAllWpPicks();
        const s = getState();
        const row = getModalRow() || TVC_WorkPermit.blank({ id: 'wp-draft-empty' });
        if (row.id && row.id !== 'wp-draft-empty') ensureWpUsedParts(row);

        const body = document.getElementById('workPermitBody');
        if (!body) return;

        if (isWpListWindow()) {
            body.innerHTML = renderListWindowBody(row);
            applyWpListScrollLock(body);
            if (histSnap) {
                restoreWpHistSnapshot(histSnap);
            } else if (_wpHistOpen) {
                setWpHistOpen(true);
                await refreshWpHistList();
            }
        } else {
            body.innerHTML = renderEditModalBody(row, s._wpMode || 'edit');
            if ((s._wpPage || '1') === '2') {
                syncWpSparePage2Ui(true, s._wpMode === 'view' || !TVC_WorkPermit.canModifyListWorkflow(row));
            }
        }
        restoreWpModalScroll(scroll);
        syncWpPageTabs();
        TVC_PWA?.initDateInputFormat?.(body);
    }

    function applyWpListScrollLock(body) {
        const scroll = body?.querySelector?.('.df-modal-inner > .wr-page');
        if (!scroll) return;
        const locked = wpListViewLocked();
        scroll.classList.toggle('is-req-locked', locked);
        const keepActive = new Set(['wpHistBtn', 'wpListFilterBtn']);
        scroll.querySelectorAll('input, select, textarea, button').forEach(el => {
            if (keepActive.has(el.id)) return;
            if (el.closest('#wpHistPanel')) return;
            if (el.id === 'wpConfirmedBy' || el.id === 'wpApprovedBy') return;
            if (locked) el.setAttribute('disabled', 'disabled');
            else el.removeAttribute('disabled');
        });
    }

    function positionWpHistPopover() {
        const btn = document.getElementById('wpHistBtn');
        const panel = document.getElementById('wpHistPanel');
        const meta = document.querySelector('#workPermitBody .wp-meta-form');
        if (!btn || !panel || !meta || panel.classList.contains('hidden')) return;
        const top = btn.getBoundingClientRect().bottom - meta.getBoundingClientRect().top + 6;
        panel.style.top = `${Math.max(top, 0)}px`;
    }

    function setWpHistOpen(open, opts = {}) {
        _wpHistOpen = open;
        if (!open && opts.reset) {
            _wpListCheckedIds = {};
            _wpSelectedPermitId = null;
        }
        const panel = document.getElementById('wpHistPanel');
        const btn = document.getElementById('wpHistBtn');
        const meta = document.querySelector('#workPermitBody .wp-meta-form');
        if (panel) {
            panel.classList.toggle('hidden', !open);
            panel.setAttribute('aria-hidden', open ? 'false' : 'true');
        }
        if (btn) btn.classList.toggle('is-open', open);
        if (meta) meta.classList.toggle('is-consume-hist-open', open);
        if (open) {
            requestAnimationFrame(() => {
                positionWpHistPopover();
                syncWpListHeadPad();
            });
        }
    }

    async function refreshWpHistList() {
        const panel = document.getElementById('wpHistPanel');
        if (!panel) return;
        const allRows = filteredPermits();
        const rows = listRows();
        const htmlRows = buildWpListRowsHtml(rows);
        const s = getState();
        const user = s.user;
        const { showConfirm, canConfirm, canApprove, canDelete, isHqUser } = wpListActionState();
        const countLabel = `${rows.length}${rows.length !== allRows.length ? ` / ${allRows.length}` : ''} item(s)`;
        const approveBtn = isHqUser
            ? wpToolbarBtn('Approve', 'TVC_WorkPermitReport.wpListApprove()', !canApprove, 'btn-green')
            : '';

        panel.innerHTML = `<div class="spare-req-list-head spare-req-hist-popover-head spare-consume-log-toolbar">
                <h3 class="spare-req-work-title">Work Permit List
                    <span class="muted spare-req-list-count">${countLabel}</span>
                </h3>
                <span class="spare-req-work-head-spacer"></span>
                ${showConfirm ? wpToolbarBtn('Confirm', 'TVC_WorkPermitReport.wpListConfirm()', !canConfirm, 'btn-green') : ''}
                ${approveBtn}
                ${wpToolbarBtn('Delete', 'TVC_WorkPermitReport.wpListDelete()', !canDelete, 'btn-red')}
                <span class="orig-toolbar-sep" aria-hidden="true"></span>
                ${wpToolbarBtn('Print', 'TVC_WorkPermitReport.wpListPrint()', !rows.length, '')}
                ${wpToolbarBtn('Preview', 'TVC_WorkPermitReport.wpListPreview()', !rows.length, '')}
                <button type="button" class="modal-x" onclick="TVC_WorkPermitReport.toggleWpHistList()" title="Close">×</button>
            </div>
            ${renderWpListFiltersHtml()}
            <div class="spare-req-list-panel-wrap spare-req-hist-panel-wrap">
                <div class="panel spare-req-list-panel spare-consume-log-panel spare-req-hist-list-panel wp-list-panel">
                  <div class="spare-req-list-head-wrap" id="wpHistListHead">
                    <table class="spare-data-table spare-req-list-table spare-consume-log-table wp-list-table spare-req-list-head-table">${WP_LIST_COLGROUP}${wpListTableHeadHtml('wpHistHeadChkAll')}</table>
                  </div>
                  <div class="spare-req-hist-list-scroll" id="wpHistListScroll">
                    <table class="spare-data-table spare-req-list-table spare-consume-log-table wp-list-table spare-req-list-body-table">${WP_LIST_COLGROUP}<tbody>${htmlRows}</tbody></table>
                  </div>
                </div>
            </div>
            <p class="spare-req-list-hint spare-req-hist-hint muted">Click a row to load Work Permit.</p>`;
        updateWpListHeadCheckAll(rows);
        syncWpListFilterUi();
        TVC_PWA?.initDateInputFormat?.(panel);
        TVC_App.bindSearchClearInput?.('wpListSearch');
        TVC_App.updateSearchClearBtn?.('wpListSearch');
        positionWpHistPopover();
        requestAnimationFrame(() => {
            positionWpHistPopover();
            syncWpListHeadPad();
        });
        syncWpListRowSelection();
    }

    async function patchWpListUi() {
        const allRows = filteredPermits();
        const rows = listRows();
        const htmlRows = buildWpListRowsHtml(rows);
        const countLabel = `${rows.length}${rows.length !== allRows.length ? ` / ${allRows.length}` : ''} item(s)`;
        document.querySelectorAll('#wpHistPanel .spare-req-list-count').forEach(el => { el.textContent = countLabel; });
        const tbody = document.querySelector('#wpHistListScroll .wp-list-table tbody');
        if (tbody) tbody.innerHTML = htmlRows;
        updateWpListHeadCheckAll(rows);
        syncWpListFilterUi();
        syncWpListToolbarState();
        syncWpListRowSelection();
    }

    async function refreshWpListUi(opts = {}) {
        if (!opts.full && _wpHistOpen && document.querySelector('#wpHistListScroll .wp-list-table tbody')) {
            await patchWpListUi();
            return;
        }
        if (_wpHistOpen) await refreshWpHistList();
    }

    async function toggleWpHistList() {
        if (_wpHistOpen) {
            setWpHistOpen(false);
            return;
        }
        setWpHistOpen(true, { reset: true });
        await refreshWpHistList();
    }

    function wpListSetPeriod() {
        _wpListPeriodFrom = document.getElementById('wpListPeriodFrom')?.value || '';
        _wpListPeriodTo = document.getElementById('wpListPeriodTo')?.value || '';
        refreshWpListUi();
    }

    function wpListClearPeriod() {
        _wpListPeriodFrom = '';
        _wpListPeriodTo = '';
        refreshWpListUi();
    }

    function wpListSetSearch(v) {
        _wpListSearch = v || '';
        clearTimeout(_wpListSearchT);
        _wpListSearchT = setTimeout(() => refreshWpListUi(), 150);
    }

    function wpListClearSearch() {
        _wpListSearch = '';
        const el = document.getElementById('wpListSearch');
        if (el) el.value = '';
        TVC_App.updateSearchClearBtn?.('wpListSearch');
        refreshWpListUi();
        el?.focus();
    }

    async function wpListSelectRow(id) {
        _wpSelectedPermitId = id;
        if (isWpListWindow()) {
            await loadPermitIntoListWindow(id, { preserveHistPopover: true });
        } else {
            await refreshWpListUi();
        }
        syncWpListRowSelection();
    }

    async function wpListToggleRow(id, checked) {
        const map = ensureWpChecked();
        if (checked) {
            map[id] = true;
            _wpSelectedPermitId = id;
        } else {
            delete map[id];
            if (_wpSelectedPermitId === id) _wpSelectedPermitId = null;
        }
        await refreshWpListUi();
    }

    async function wpListToggleAll(checked) {
        const rows = listRows();
        if (checked) {
            const map = ensureWpChecked();
            rows.forEach(r => { map[r.id] = true; });
            if (!_wpSelectedPermitId && rows.length) _wpSelectedPermitId = rows[0].id;
        } else {
            _wpListCheckedIds = {};
            _wpSelectedPermitId = null;
        }
        await refreshWpListUi();
    }

    async function loadPermitIntoListWindow(id, opts = {}) {
        const row = (getState().workPermits || []).find(r => r.id === id);
        if (!row) {
            await TVC_Dialog.alert('Work Permit not found.');
            return false;
        }
        const s = getState();
        s._workPermitId = id;
        s._wpDraft = null;
        s._wpDraftId = null;
        s._wpMode = 'view';
        s._wpListEditing = false;
        if (!opts.preservePage) s._wpPage = '1';
        s._wpUsedPartsCaseId = null;
        ensureWpUsedParts(row);
        const preserveHist = opts.preserveHistPopover !== false && _wpHistOpen && isWpListWindow();
        if (wpListShellReady() && isWpListWindow()) {
            if (opts.soft !== false) {
                const ok = await softRefreshWpListWindow(row, {
                    preserveScroll: true,
                    preserveHist,
                    resetValues: true,
                    refreshList: opts.refreshList !== false,
                });
                if (ok) return true;
            }
            syncWpListHeadTitle();
            syncWpListHeadButtons();
            await patchWpListFormBody({ preserveScroll: true, preserveHist });
            return true;
        }
        await renderWorkPermitModal({ preserveScroll: preserveHist, preserveHist });
        return true;
    }

    function captureWpFormFields() {
        captureWpJobItems();
        const draft = ensureWpDraft(getModalRow() || {});
        document.querySelectorAll('#workPermitBody [data-wp]').forEach(el => {
            const key = el.dataset.wp;
            if (!key) return;
            if (el.type === 'checkbox') draft[key] = el.checked;
            else draft[key] = el.value;
        });
        return draft;
    }

    async function refreshWorkPermitModal(opts = {}) {
        if (isWpListWindow() && wpListShellReady() && opts.patchList !== false) {
            await refreshWpListWindowUi(opts);
            return;
        }
        const s = getState();
        const row = getModalRow();
        if (!row) return;
        if ((s._wpPage || '1') === '2' && document.getElementById('wrSpareListScroll')) {
            captureWpUsedParts();
            TVC_SpareMenu.teardownWrSparePage2();
            wpSpareContextLeave();
        }
        ensureWpUsedParts(row);
        await renderWorkPermitModal(opts);
        if ((s._wpPage || '1') === '2') {
            syncWpSparePage2Ui(true, s._wpMode === 'view' || wpListViewLocked() || !TVC_WorkPermit.canModifyListWorkflow(row));
        }
    }

    function setWorkPermitPage(page) {
        captureWpFormFields();
        closeAllWpPicks();
        if ((getState()._wpPage || '1') === '2') {
            TVC_SpareMenu.persistWrSpareUsedParts?.();
            captureWpUsedParts();
            TVC_SpareMenu.teardownWrSparePage2();
            wpSpareContextLeave();
        }
        getState()._wpPage = page;
        refreshWorkPermitModal({ preserveScroll: true, preserveHist: true });
    }

    function isPermitConfirmable(row) {
        if (!row || !getState().user) return false;
        if (row.visible_in_list === false) return false;
        if (row.confirmed_at || row.confirmed_by) return false;
        if (row.approved_at || row.approved_by) return false;
        return TVC_RBAC.canConfirmDepartment(getState().user, row.department);
    }

    async function applyWpApprovalFromUi() {
        const s = getState();
        const id = s._workPermitId;
        const user = s.user;
        if (!id || !user) return;
        const cfCb = document.getElementById('wpConfirmedBy');
        const apCb = document.getElementById('wpApprovedBy');
        const doConfirm = cfCb?.checked && !cfCb.disabled;
        const doApprove = apCb?.checked && !apCb.disabled;
        if (doConfirm || doApprove) {
            await TVC_WorkPermitCaseService.saveApprovalMeta(user, id, { confirm: doConfirm, approve: doApprove });
        }
    }

    function applyFileNoFromPicker(val) {
        const draft = ensureWpDraft(getModalRow() || {});
        draft.file_no = String(val || '').trim();
        const inp = document.querySelector('#workPermitBody [data-wp="file_no"]');
        if (inp) inp.value = draft.file_no;
    }

    async function startWorkPermitListSession(opts = {}) {
        const s = getState();
        if (isHq() && !s.selectedVesselId) {
            await TVC_Dialog.alert('Select a vessel first.');
            return;
        }
        s._wpListMode = true;
        s._wpListEditing = false;
        s._wpMode = 'view';
        s._wpPage = '1';
        s._workPermitId = null;
        s._wpDraft = null;
        s._wpDraftId = null;
        s._wpUsedParts = [];
        s._wpUsedPartsCaseId = null;
        _wpListCheckedIds = {};
        _wpSelectedPermitId = null;
        if (opts.openSelectList) setWpHistOpen(true, { reset: true });
        else setWpHistOpen(false);
        await renderWorkPermitModal();
        document.getElementById('workPermitModal')?.classList.remove('hidden');
    }

    function openListModal() {
        startWorkPermitListSession({ openSelectList: true });
    }

    async function openCase(id, mode = 'view', opts = {}) {
        const s = getState();
        const row = (s.workPermits || []).find(r => r.id === id);
        if (!row) return;
        s._wpListMode = false;
        if (opts.fromHistory) s._wpNavSource = 'history';
        else if (!opts.keepNavSource) s._wpNavSource = null;
        if (opts.fromHistory || mode === 'view') s._reportKindLocked = 'permit';
        else s._reportKindLocked = null;
        s._workPermitId = id;
        s._wpDraft = null;
        s._wpDraftId = null;
        s._wpMode = mode;
        if (!opts.preservePage) s._wpPage = '1';
        s._wpUsedPartsCaseId = null;
        ensureWpUsedParts(row);
        await renderWorkPermitModal(opts.preserveScroll ? { preserveScroll: true } : {});
        const wpNav = TVC_App?.isWorkProcedureHistNav?.();
        if (opts.skipModalToggle) {
            document.getElementById('workPermitModal')?.classList.remove('hidden');
            if (wpNav || opts.swapOpts?.overWorkProcedure) TVC_App.applyModalOverWorkProcedure?.('workPermitModal');
        } else if (opts.swapHide && typeof TVC_App?.swapHistoryModals === 'function') {
            TVC_App.swapHistoryModals('workPermitModal', opts.swapHide, opts.swapOpts || {});
        } else {
            document.getElementById('workPermitModal')?.classList.remove('hidden');
            if (wpNav || opts.swapOpts?.overWorkProcedure) TVC_App.applyModalOverWorkProcedure?.('workPermitModal');
        }
        if (!isWpListWindow()) captureWpMakeReportDirtySnap();
    }

    async function wpListNew() {
        const s = getState();
        if (s._wpListEditing) return;
        if (isHq() && !s.selectedVesselId) {
            await TVC_Dialog.alert('Select a vessel first.');
            return;
        }
        const jobs = scopedJobs();
        if (!jobs.length) {
            await TVC_Dialog.alert('No jobs in scope.');
            return;
        }
        const job = jobs[0];
        const row = await TVC_WorkPermitCaseService.createFromJob(s.user, job);
        const hdr = TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
        row.maker = hdr.maker || '';
        row.model_type = hdr.modelType || '';
        row.capacity = hdr.capacity || '';
        row.serial_no = hdr.serialNo || '';
        upsertPermitInState(row);
        s._workPermitId = row.id;
        s._wpDraft = null;
        s._wpDraftId = null;
        s._wpMode = 'edit';
        s._wpListEditing = true;
        s._wpPage = '1';
        ensureWpUsedParts(row);
        setWpHistOpen(false);
        TVC_ListFilters?.closePopover?.();
        await renderWorkPermitModal();
    }

    async function wpListEnterEdit() {
        const s = getState();
        if (!wpListHasDisplayedPermit()) {
            await TVC_Dialog.alert('Select a Work Permit from the list first.');
            return;
        }
        if (s._wpListEditing) return;
        const row = getModalRow();
        if (!canOpenWpModify(row)) {
            await TVC_Dialog.alert(isHq() && TVC_WorkPermit.isHqReplyExported(row)
                ? 'HQ reply already exported — Company Comments cannot be changed.'
                : 'This Work Permit cannot be modified.');
            return;
        }
        s._wpListEditing = true;
        s._wpMode = 'edit';
        if (wpListShellReady()) {
            await softRefreshWpListWindow(row, {
                preserveScroll: true,
                preserveHist: true,
                resetValues: false,
                refreshList: false,
            });
        } else {
            await refreshWpListWindowUi();
        }
    }

    async function wpListCancelEdit() {
        const s = getState();
        if (!isWpListWindow() || !s._wpListEditing) return;
        closeAllWpPicks();
        if ((s._wpPage || '1') === '2') {
            TVC_SpareMenu.persistWrSpareUsedParts?.();
            captureWpUsedParts();
            TVC_SpareMenu.teardownWrSparePage2();
            wpSpareContextLeave();
        }
        const id = s._workPermitId;
        const row = id ? (s.workPermits || []).find(r => r.id === id) : null;
        s._wpDraft = null;
        s._wpDraftId = null;
        s._wpListEditing = false;
        s._wpMode = 'view';
        if (row && row.visible_in_list === false) {
            try {
                await TVC_WorkPermitCaseService.deleteCase(s.user, id);
            } catch (_) { /* discard unsaved draft */ }
            s.workPermits = (s.workPermits || []).filter(r => r.id !== id);
            const fallbackId = _wpSelectedPermitId && (s.workPermits || []).some(r => r.id === _wpSelectedPermitId)
                ? _wpSelectedPermitId
                : null;
            s._workPermitId = fallbackId;
            s._wpPage = '1';
            if (fallbackId) {
                const fresh = await TVC_WorkPermitCaseService.get(fallbackId);
                if (fresh) upsertPermitInState(fresh);
                await loadPermitIntoListWindow(fallbackId, { preserveHistPopover: true, preservePage: true, soft: true });
            } else if (wpListShellReady()) {
                ensureWpUsedParts(TVC_WorkPermit.blank({ id: 'wp-draft-empty' }));
                await softRefreshWpListWindow(TVC_WorkPermit.blank({ id: 'wp-draft-empty' }), {
                    preserveScroll: true,
                    preserveHist: true,
                    resetValues: true,
                });
                await patchWpListUi();
            } else {
                await renderWorkPermitModal({ preserveScroll: true, preserveHist: true });
            }
            void refresh().then(() => { if (_wpHistOpen) patchWpListUi(); });
            return;
        }
        if (id) {
            const fresh = await TVC_WorkPermitCaseService.get(id);
            if (fresh) upsertPermitInState(fresh);
            await loadPermitIntoListWindow(id, { preserveHistPopover: true, preservePage: true, soft: true });
        } else {
            await softRefreshWpListWindow(row || TVC_WorkPermit.blank({ id: 'wp-draft-empty' }), {
                preserveScroll: true,
                preserveHist: true,
                resetValues: true,
            });
        }
    }

    async function openNewBlank() {
        if (isWpListWindow()) {
            await wpListNew();
            return;
        }
        await openNewFromJobInternal(null);
    }

    async function openNewFromJobInternal(jobId, opts = {}) {
        const s = getState();
        if (isHq() && !s.selectedVesselId) {
            await TVC_Dialog.alert('Select a vessel first.');
            return;
        }
        const jobs = scopedJobs();
        if (!jobs.length) {
            await TVC_Dialog.alert('No jobs in scope.');
            return;
        }
        const job = jobId ? (s.idx?.jobById?.get(jobId) || s.jobs?.find(j => j.id === jobId)) : jobs[0];
        if (!job) {
            await TVC_Dialog.alert('Select a job first.');
            return;
        }
        const row = await TVC_WorkPermitCaseService.createFromJob(s.user, job);
        const hdr = TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
        row.maker = hdr.maker || '';
        row.model_type = hdr.modelType || '';
        row.capacity = hdr.capacity || '';
        row.serial_no = hdr.serialNo || '';
        upsertPermitInState(row);
        await openCase(row.id, 'edit', opts);
    }

    async function openNewFromJob(jobId, opts = {}) {
        await openNewFromJobInternal(jobId, opts);
    }

    async function wpListConfirm() {
        const s = getState();
        const checkedIds = wpCheckedIds();
        const idsToConfirm = wpCheckedConfirmableIds();
        if (!idsToConfirm.length) {
            if (checkedIds.length) {
                await TVC_Dialog.alert('None of the selected Work Permits can be confirmed.\nOnly Reported permits can be confirmed, and you need Chief Engineer / Chief Officer / Captain permission.');
            } else {
                await TVC_Dialog.alert('Check one or more Reported Work Permits to confirm.');
            }
            return;
        }
        if (!await TVC_Dialog.confirm({ kind: 'confirm', message: `Confirm ${idsToConfirm.length} Work Permit(s)?` })) return;
        let confirmed = 0;
        for (const id of idsToConfirm) {
            try {
                await TVC_WorkPermitCaseService.saveApprovalMeta(s.user, id, { confirm: true });
                confirmed++;
            } catch (e) {
                await TVC_Dialog.alert(`${id}: ${e.message || e.code || 'Confirm failed'}`);
                break;
            }
        }
        await refresh();
        s._wpListEditing = false;
        if (s._workPermitId && idsToConfirm.includes(s._workPermitId)) {
            s._wpDraft = null;
            s._wpDraftId = null;
        }
        _wpListCheckedIds = {};
        await refreshWpListUi({ full: true });
        await refreshWpListWindowUi({ approvalOnly: true });
        const skipped = checkedIds.length - confirmed;
        if (skipped > 0) {
            await TVC_Dialog.alert(`Confirmed ${confirmed} Work Permit(s). Skipped ${skipped} (not Reported or no permission).`);
        } else {
            await TVC_Dialog.alert(`Confirmed ${confirmed} Work Permit(s).`);
        }
    }

    async function wpListApprove() {
        const s = getState();
        const user = s.user;
        const ids = wpCheckedIds().filter(id => {
            const r = (s.workPermits || []).find(x => x.id === id);
            return r && !r.approved_at && (r.confirmed_at || TVC_RBAC.canHqDirectApprove(user, r));
        });
        if (!ids.length) {
            await TVC_Dialog.alert('Check one or more Confirmed Work Permits to approve.');
            return;
        }
        if (!await TVC_Dialog.confirm({ kind: 'approve', message: `Approve ${ids.length} Work Permit(s)?` })) return;
        for (const id of ids) {
            await TVC_WorkPermitCaseService.saveApprovalMeta(user, id, { approve: true });
        }
        await refresh();
        await refreshWpListUi({ full: true });
        await refreshWpListWindowUi({ approvalOnly: true });
    }

    async function wpListDelete() {
        const s = getState();
        const ids = wpCheckedIds().filter(id => {
            const r = (s.workPermits || []).find(x => x.id === id);
            return r && TVC_WorkPermit.canDeleteListWorkflow(r);
        });
        if (!ids.length) {
            await TVC_Dialog.alert('Check one or more deletable Work Permits.');
            return;
        }
        if (!await TVC_Dialog.confirm({ kind: 'delete', message: `Delete ${ids.length} Work Permit(s)?` })) return;
        for (const id of ids) {
            await TVC_WorkPermitCaseService.deleteCase(s.user, id);
            s.workPermits = (s.workPermits || []).filter(r => r.id !== id);
            if (s._workPermitId === id) {
                s._workPermitId = null;
                s._wpDraft = null;
                s._wpDraftId = null;
            }
        }
        _wpListCheckedIds = {};
        _wpSelectedPermitId = null;
        await refresh();
        await refreshWpListUi({ full: true });
        await refreshWpListWindowUi();
    }

    function workPermitModalTitle(row) {
        const s = getState();
        if (isWpListWindow() && !s._wpListEditing) return 'Work Permit';
        if (s._wpMode === 'view') return 'Work Permit (View)';
        if (isWpListWindow() && s._wpListEditing) return 'Work Permit (Draft)';
        return s._wpMode === 'view' ? 'Work Permit (View)' : 'Work Permit (Draft)';
    }

    function buildWpPrintBody() {
        captureWpFormFields();
        captureWpJobItems();
        if ((getState()._wpPage || '1') === '2') {
            TVC_SpareMenu.persistWrSpareUsedParts?.();
            captureWpUsedParts();
        } else if ((getState()._wpUsedParts || []).length) {
            captureWpUsedParts();
        }
        const row = getModalRow();
        if (!row) return null;
        const s = getState();
        const title = workPermitModalTitle(row);
        const page1Body = renderPage1(row, true, { forPrint: true });
        const page1Html = TVC_SpareMenu.renderWrPrintShell(title, '1', page1Body, 'defect');
        const usedParts = enrichWpUsedParts(s._wpUsedParts || row.estimated_parts || []);
        let page2Html = '';
        if (TVC_SpareMenu.wrHasSparePage2ForPrint(usedParts)) {
            const meta = buildWpPage2Meta(row);
            meta.page2Subtitle = 'Estimated spare parts (reference only — no inventory deduction)';
            const page2Inner = TVC_SpareMenu.buildWrSparePage2UiPrintHtml(s, usedParts, meta);
            const page2Body = `${renderWpApprovalHtml(row, { forPrint: true })}${page2Inner}`;
            page2Html = TVC_SpareMenu.renderWrPrintShell(title, '2', page2Body, 'defect');
        }
        const permitLabel = String(row.file_no || row.permit_no || TVC_WorkPermitSync.reportJobCode(row) || '').trim();
        return { title: `Work Permit ${permitLabel}`.trim(), html: page1Html + page2Html, appCss: true };
    }

    function openWpPrint({ print = false } = {}) {
        const doc = buildWpPrintBody();
        if (!doc) return;
        TVC_SpareMenu.openWrReportPrintWindow(doc.title, doc.html, { print, appCss: !!doc.appCss });
    }

    async function wpListPrint() {
        if (!wpListHasDisplayedPermit()) {
            await TVC_Dialog.alert('Select a Work Permit from the list first.');
            return;
        }
        openWpPrint({ print: false });
    }

    async function wpListPreview() {
        if (!wpListHasDisplayedPermit()) {
            await TVC_Dialog.alert('Select a Work Permit from the list first.');
            return;
        }
        openWpPrint({ print: false });
    }

    async function saveModal() {
        if (!await TVC_Dialog.confirm({ kind: 'save', message: 'Save this Work Permit?' })) return;
        const s = getState();
        const id = s._workPermitId;
        if (!id) return;
        captureWpFormFields();
        if ((s._wpPage || '1') === '2') {
            TVC_SpareMenu.persistWrSpareUsedParts?.();
            captureWpUsedParts();
        }
        const draft = captureWpFormFields();
        const row = getModalRow();
        if (row && !TVC_WorkPermit.canModifyListWorkflow(row) && TVC_RBAC.isHqAccount(s.user)) {
            try {
                const saved = await TVC_WorkPermitCaseService.saveCompanyComment(s.user, id, draft.company_comment);
                upsertPermitInState(saved);
                if (isWpListWindow()) {
                    s._wpDraft = null;
                    s._wpDraftId = null;
                    s._wpListEditing = false;
                    s._wpMode = 'view';
                    if (wpListShellReady()) {
                        await softRefreshWpListWindow(saved, {
                            preserveScroll: true,
                            preserveHist: true,
                            resetValues: false,
                        });
                    } else {
                        await refreshWpListWindowUi();
                    }
                } else {
                    s._wpMode = 'view';
                    await refreshWorkPermitModal({ preserveScroll: true, patchList: false });
                }
                await TVC_Dialog.alert("Company's Comments saved.");
            } catch (e) {
                await TVC_Dialog.alert(e.message || e.code || 'Save failed');
            }
            return;
        }
        try {
            await applyWpApprovalFromUi();
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Approval failed');
            return;
        }
        const payload = {
            ...draft,
            estimated_parts: wpUsedPartsPayload(),
            checked_estimated_spare_parts: draft.checked_estimated_spare_parts === true,
        };
        try {
            const saved = await TVC_WorkPermitCaseService.saveDraft(s.user, payload, id);
            upsertPermitInState(saved);
            if (isWpListWindow()) {
                s._workPermitId = saved.id;
                s._wpDraft = null;
                s._wpDraftId = null;
                s._wpListEditing = false;
                s._wpMode = 'view';
                ensureWpUsedParts(saved);
                if (wpListShellReady()) {
                    await softRefreshWpListWindow(saved, {
                        preserveScroll: true,
                        preserveHist: true,
                        resetValues: false,
                    });
                    await patchWpListUi();
                    void refresh().then(() => { if (_wpHistOpen) patchWpListUi(); });
                } else {
                    await refresh();
                    await refreshWpListWindowUi();
                    await refreshWpListUi({ full: true });
                }
                await TVC_Dialog.alert('Work Permit saved.');
            } else {
                await refresh();
                await openCase(saved.id, 'view', s._wpNavSource === 'history'
                    ? { fromHistory: true, skipModalToggle: true, preservePage: true, keepNavSource: true }
                    : {});
                if (s.currentTab === 'history' && s._wpNavSource !== 'history') {
                    TVC_App.switchTab?.('actual');
                }
                await TVC_Dialog.alert('Work Permit saved.');
            }
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Save failed');
        }
    }

    function wpPermitLabel(row) {
        return row?.permit_no || row?.file_no || 'Work Permit';
    }

    async function wpConfirmByToggle() {
        const cfCb = document.getElementById('wpConfirmedBy');
        if (!cfCb || cfCb.disabled) return;
        const s = getState();
        const row = getModalRow();
        if (!row?.id || row.id === 'wp-draft-empty') return;
        const input = cfCb.closest('.wr-maint-approval-item')?.querySelector('.wr-maint-date');
        const user = s.user;
        if (!user) return;
        const isConfirmed = !!(row.confirmed_at || row.confirmed_by);
        const isApproved = !!(row.approved_at || row.approved_by);
        const editMode = s._wpMode !== 'view' && !wpListViewLocked();

        if (!cfCb.checked) {
            if (input && !isConfirmed) {
                input.value = '';
                return;
            }
            const canUnconfirm = editMode && isConfirmed && !isApproved
                && TVC_RBAC.canConfirmDepartment(user, row.department);
            if (!canUnconfirm) {
                cfCb.checked = true;
                return;
            }
            try {
                const fresh = await TVC_WorkPermitCaseService.saveApprovalMeta(user, row.id, { unconfirm: true });
                upsertPermitInState(fresh);
                s._wpDraft = null;
                s._wpDraftId = null;
                await refresh();
                if (isWpListWindow()) {
                    await refreshWpListUi({ full: true });
                    await refreshWpListWindowUi({ approvalOnly: true });
                } else {
                    await refreshWorkPermitModal({ preserveScroll: true, patchList: false });
                }
                await TVC_Dialog.alert(`${wpPermitLabel(row)} unconfirmed.`);
            } catch (e) {
                cfCb.checked = true;
                await TVC_Dialog.alert(e.message || e.code || 'Unconfirm failed');
            }
            return;
        }

        const label = TVC_RBAC.getDepartmentConfirmLabel(row.department, user) || '';
        if (input) input.value = label;
        if (isConfirmed) return;
        if (!isPermitConfirmable(row)) return;
        try {
            const fresh = await TVC_WorkPermitCaseService.saveApprovalMeta(user, row.id, { confirm: true });
            upsertPermitInState(fresh);
            s._wpDraft = null;
            s._wpDraftId = null;
            await refresh();
            if (isWpListWindow()) {
                await refreshWpListUi({ full: true });
                await refreshWpListWindowUi({ approvalOnly: true });
            } else {
                await refreshWorkPermitModal({ preserveScroll: true, patchList: false });
            }
            await TVC_Dialog.alert(`${wpPermitLabel(row)} confirmed.`);
        } catch (e) {
            cfCb.checked = false;
            if (input) input.value = '';
            await TVC_Dialog.alert(e.message || e.code || 'Confirm failed');
        }
    }

    async function wpHistConfirmOrApprove() {
        const s = getState();
        if (s._wpMode === 'view' || s._wpNavSource !== 'history') return;
        const row = getModalRow();
        const user = s.user;
        if (!row?.id || row.id === 'wp-draft-empty' || !user) return;
        if (isHq()) {
            if (!TVC_RBAC.canApproveHqReport(user)) {
                await TVC_Dialog.alert('Approve is available in HQ mode only.');
                return;
            }
            if (row.approved_at || row.approved_by) {
                try {
                    const fresh = await TVC_WorkPermitCaseService.saveApprovalMeta(user, row.id, { unapprove: true });
                    upsertPermitInState(fresh);
                    s._wpDraft = null;
                    s._wpDraftId = null;
                    await refresh();
                    await refreshWorkPermitModal({ preserveScroll: true, patchList: false });
                    await TVC_Dialog.alert(`${wpPermitLabel(row)} approval removed.`);
                } catch (e) {
                    await TVC_Dialog.alert(e.message || e.code || 'Unapprove failed');
                }
                return;
            }
            try {
                captureWpFormFields();
                const draft = ensureWpDraft(getModalRow() || {});
                const needConfirm = !row.confirmed_at && !row.confirmed_by;
                const fresh = await TVC_WorkPermitCaseService.saveApprovalMeta(user, row.id, {
                    confirm: needConfirm,
                    approve: true,
                    company_comment: draft.company_comment,
                });
                upsertPermitInState(fresh);
                s._wpDraft = null;
                s._wpDraftId = null;
                await refresh();
                await refreshWorkPermitModal({ preserveScroll: true, patchList: false });
                await TVC_Dialog.alert(`${wpPermitLabel(row)} approved.`);
            } catch (e) {
                await TVC_Dialog.alert(e.message || e.code || 'Approve failed');
            }
            return;
        }
        if (row.confirmed_at || row.confirmed_by) {
            if (row.approved_at || row.approved_by) {
                await TVC_Dialog.alert('Approved items cannot be unconfirmed.');
                return;
            }
            try {
                const fresh = await TVC_WorkPermitCaseService.saveApprovalMeta(user, row.id, { unconfirm: true });
                upsertPermitInState(fresh);
                s._wpDraft = null;
                s._wpDraftId = null;
                await refresh();
                await refreshWorkPermitModal({ preserveScroll: true, patchList: false });
                await TVC_Dialog.alert(`${wpPermitLabel(row)} unconfirmed.`);
            } catch (e) {
                await TVC_Dialog.alert(e.message || e.code || 'Unconfirm failed');
            }
            return;
        }
        if (!isPermitConfirmable(row)) {
            await TVC_Dialog.alert('Only Reported items can be confirmed.');
            return;
        }
        try {
            const fresh = await TVC_WorkPermitCaseService.saveApprovalMeta(user, row.id, { confirm: true });
            upsertPermitInState(fresh);
            s._wpDraft = null;
            s._wpDraftId = null;
            await refresh();
            await refreshWorkPermitModal({ preserveScroll: true, patchList: false });
            await TVC_Dialog.alert(`${wpPermitLabel(row)} confirmed.`);
        } catch (e) {
            await TVC_Dialog.alert(e.message || e.code || 'Confirm failed');
        }
    }

    async function wpApprovedByToggle() {
        const apCb = document.getElementById('wpApprovedBy');
        if (!apCb || apCb.disabled) return;
        const s = getState();
        const row = getModalRow();
        if (!row?.id || row.id === 'wp-draft-empty') return;
        const user = s.user;
        if (!user || !TVC_RBAC.isHqAccount(user)) return;

        if (!apCb.checked) {
            const editMode = s._wpMode !== 'view' && !wpListViewLocked();
            const isApproved = !!(row.approved_at || row.approved_by);
            if (editMode && isApproved && !TVC_WorkPermit.isHqReplyExported(row) && TVC_RBAC.canApproveHqReport(user)) {
                try {
                    const fresh = await TVC_WorkPermitCaseService.saveApprovalMeta(user, row.id, { unapprove: true });
                    upsertPermitInState(fresh);
                    s._wpDraft = null;
                    s._wpDraftId = null;
                    await refresh();
                    await refreshWorkPermitModal({ preserveScroll: true, patchList: false });
                    await TVC_Dialog.alert(`${wpPermitLabel(row)} approval removed.`);
                } catch (e) {
                    apCb.checked = true;
                    await TVC_Dialog.alert(e.message || e.code || 'Unapprove failed');
                }
                return;
            }
            apCb.checked = true;
            return;
        }
        if (row.approved_at || row.approved_by) return;
        if (!TVC_RBAC.canApproveHqReport(user)) return;
        if (!row.confirmed_at && !TVC_RBAC.canHqDirectApprove(user, row)) {
            apCb.checked = false;
            await TVC_Dialog.alert('Confirm required before Approve.');
            return;
        }
        try {
            captureWpFormFields();
            const draft = ensureWpDraft(getModalRow() || {});
            const fresh = await TVC_WorkPermitCaseService.saveApprovalMeta(user, row.id, {
                approve: true,
                company_comment: draft.company_comment,
            });
            upsertPermitInState(fresh);
            s._wpDraft = null;
            s._wpDraftId = null;
            await refresh();
            if (isWpListWindow()) {
                await refreshWpListUi({ full: true });
                await refreshWpListWindowUi({ approvalOnly: true });
            } else {
                await refreshWorkPermitModal({ preserveScroll: true, patchList: false });
            }
            await TVC_Dialog.alert(`${wpPermitLabel(row)} approved.`);
        } catch (e) {
            apCb.checked = false;
            await TVC_Dialog.alert(e.message || e.code || 'Approve failed');
        }
    }

    async function closeModal() {
        const s = getState();
        if (isWpListWindow() && s._wpListEditing) {
            if (!await TVC_Dialog.confirm({ message: 'Close without saving?' })) return;
        }
        if (s._wpNavSource === 'history' || s._wpNavSource === 'list' || s._wpListMode) {
            TVC_App.restorePlanBatchSelection?.();
        } else {
            TVC_App.clearPlanBatchSelection?.();
        }
        teardownWpSpareUi();
        closeAllWpPicks();
        TVC_ListFilters?.closePopover?.();
        setWpHistOpen(false);
        document.getElementById('workPermitModal')?.classList.add('hidden');
        s._wpListMode = false;
        s._wpListEditing = false;
        s._wpNavSource = null;
        s._workPermitId = null;
        s._wpDraft = null;
        s._wpDraftId = null;
        s._wpUsedParts = [];
        s._wpUsedPartsCaseId = null;
        s._wpPage = '1';
    }

    function printWpModal() {
        openWpPrint({ print: true });
    }

    function previewWpModal() {
        openWpPrint({ print: false });
    }

    function navWpHistory(dir) {
        TVC_App.navWorkHistoryEntry?.(dir);
    }

    async function modifyWpFromHistory() {
        const row = getModalRow();
        if (!row || !canOpenWpModify(row)) {
            await TVC_Dialog.alert(isHq() && row && TVC_WorkPermit.isHqReplyExported(row)
                ? 'HQ reply already exported — Company Comments cannot be changed.'
                : 'This Work Permit cannot be modified.');
            return;
        }
        const s = getState();
        s._wpMode = 'edit';
        s._wpNavSource = 'history';
        s._reportKindLocked = 'permit';
        await renderWorkPermitModal({ preserveScroll: true });
        captureWpMakeReportDirtySnap();
    }

    async function cancelWpHistoryEdit() {
        const s = getState();
        const id = s._workPermitId;
        if (!id) return requestCloseModal();
        closeAllWpPicks();
        if ((s._wpPage || '1') === '2') {
            TVC_SpareMenu.persistWrSpareUsedParts?.();
            captureWpUsedParts();
            TVC_SpareMenu.teardownWrSparePage2();
            wpSpareContextLeave();
        }
        s._wpDraft = null;
        s._wpDraftId = null;
        await openCase(id, 'view', {
            fromHistory: true,
            skipModalToggle: true,
            preservePage: true,
            keepNavSource: true,
            preserveScroll: true,
        });
    }

    async function requestCloseModal() {
        await closeModal();
    }

    function collectWpEditableFields() {
        const fields = {};
        const host = document.getElementById('workPermitBody');
        if (!host) return fields;
        host.querySelectorAll('[data-wp]').forEach(el => {
            const key = el.dataset.wp;
            if (!key || el.readOnly || el.disabled) return;
            if (el.type === 'checkbox') fields[key] = !!el.checked;
            else fields[key] = String(el.value || '').trim();
        });
        return Object.fromEntries(Object.keys(fields).sort().map(k => [k, fields[k]]));
    }

    function wpMakeReportDirtySnapshot() {
        const draft = captureWpFormFields() || {};
        captureWpUsedParts();
        const s = getState();
        return JSON.stringify({
            fields: collectWpEditableFields(),
            group: String(draft.pms_group_key || ''),
            jobs: (draft.job_items || []).map(i => [
                String(i.job_code || '').trim(),
                String(i.job_detail || '').trim(),
            ]),
            parts: (s._wpUsedParts || [])
                .filter(p => Number(p.qty_used) > 0)
                .map(p => [String(p.spare_part_id || ''), Number(p.qty_used) || 0]),
            shipAtt: (draft.ship_attachments || []).length,
            companyAtt: (draft.company_attachments || []).length,
        });
    }

    function captureWpMakeReportDirtySnap() {
        getState()._wpMakeReportSnap = wpMakeReportDirtySnapshot();
    }

    function hasUnsavedMakeReportInput() {
        const s = getState();
        if (isWpListWindow() || s._wpMode === 'view') return false;
        if (!s._wpMakeReportSnap) return false;
        return wpMakeReportDirtySnapshot() !== s._wpMakeReportSnap;
    }

    return {
        init,
        openListModal, closeListModal: closeModal,
        wpListSetSearch, wpListClearSearch, wpListSetPeriod, wpListClearPeriod,
        wpListSelectRow, wpListToggleRow, wpListToggleAll,
        wpListNew, wpListEnterEdit, wpListCancelEdit, wpListConfirm, wpListApprove, wpListDelete,
        wpListPrint, wpListPreview, toggleWpHistList,
        getWpListFilters, setWpListFilters,
        toggleWpGroupPick, pickWpGroup, addWpJobRow, removeWpJobRow,
        toggleWpJobRowPick, pickWpJobForRow, clearWpJobRow,
        wpGroupPickSearch, wpJobRowPickSearch,
        openCase, openNewBlank, openNewFromJob,
        saveModal, closeModal, requestCloseModal, setWorkPermitPage,
        wpConfirmByToggle, wpApprovedByToggle, wpHistConfirmOrApprove,
        applyFileNoFromPicker, refreshWorkPermitModal, captureWpFormFields,
        filteredPermits, listRows, isPermitConfirmable,
        canOpenWpHqCommentEdit, canOpenWpModify,
        hasUnsavedMakeReportInput,
        navWpHistory, modifyWpFromHistory, cancelWpHistoryEdit, printWpModal, previewWpModal,
    };
})();

if (typeof window !== 'undefined') window.TVC_WorkPermitReport = TVC_WorkPermitReport;
