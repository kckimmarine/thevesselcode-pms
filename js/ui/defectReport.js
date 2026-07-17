/* Defect (Trouble) Report UI — Phase 1 (Ship) · Phase 2 (HQ) */
const TVC_DefectReport = (function () {
    let _ctx = null;

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function escAttr(s) {
        return esc(s).replace(/'/g, '&#39;');
    }

    const DF_PICK_Z = 10100;
    let _dfGroupPickSearch = '';
    let _dfJobPickSearch = '';
    let _dfListSearch = '';
    let _dfListSelId = null;
    let _dfListChecked = {};
    let _dfWrUsedPartsBackup = null;

    function dfTreeLabel(v) {
        return TVC_SpareMenu?.safeTreeLabel?.(v) || String(v || '').trim();
    }

    function dfGroupKey(row) {
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
        const draftKey = dfGroupKey(row);
        const q = (_dfGroupPickSearch || '').toLowerCase().trim();
        const matchNode = (n) => !q || dfTreeLabel(n.label).toLowerCase().includes(q)
            || String(n.department || '').toLowerCase().includes(q);
        const matchCritical = !q || 'critical equipment'.includes(q) || q.includes('critical') || q.includes('crit');
        let html = '';
        const critKey = TVC_SpareMenu?.CRITICAL_GROUP_KEY || '__CRITICAL_EQUIPMENT__';
        if (matchCritical) {
            const sel = draftKey === critKey ? ' selected' : '';
            html += `<button type="button" class="spare-consume-pick-item${sel}"
                onclick="TVC_DefectReport.pickDfGroup('${escAttr(critKey)}','${escAttr('Critical Equipment')}')">⚠ Critical Equipment</button>`;
        }
        const nodes = (TVC_SpareMenu?.getPlanGroupPickNodes?.(st) || []).filter(matchNode);
        if (!nodes.length && !matchCritical) {
            return '<div class="spare-consume-pick-empty muted">PMS GROUP Tree를 불러오는 중…</div>';
        }
        let curDept = '';
        nodes.forEach(n => {
            if (n.department !== curDept) {
                html += `<div class="spare-consume-pick-dept">${esc(n.department)}</div>`;
                curDept = n.department;
            }
            const sel = draftKey === n.key ? ' selected' : '';
            html += `<button type="button" class="spare-consume-pick-item${sel}"
                onclick="TVC_DefectReport.pickDfGroup('${escAttr(n.key)}','${escAttr(n.label)}')">${esc(dfTreeLabel(n.label))}</button>`;
        });
        return html || '<div class="spare-consume-pick-empty muted">검색 결과 없음</div>';
    }

    function buildDfJobPickList(row) {
        const st = getState();
        const groupKey = dfGroupKey(row);
        if (!groupKey) {
            return '<div class="spare-consume-pick-empty muted">PMS Group No.를 먼저 선택하세요.</div>';
        }
        const q = (_dfJobPickSearch || '').toLowerCase().trim();
        const jobs = (TVC_SpareMenu?.getJobsForGroupKey?.(st, groupKey) || []).filter(j => {
            if (!q) return true;
            const hay = [j.job_code, j.item_sort1, j.item_sort2, j.job_detail].join(' ').toLowerCase();
            return hay.includes(q);
        });
        const selectedCode = dfVal(row, 'pms_job_code');
        const hasJob = !!(selectedCode || dfVal(row, 'maintenance_job_id'));
        const clearBtn = `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-none${hasJob ? '' : ' selected'}"
                onclick="TVC_DefectReport.clearDfJob()">
                <span class="spare-consume-pick-job-code">— Job Code 없음 —</span>
                <span class="spare-consume-pick-job-sub muted">PMS Group만 지정 · Job Name 직접 입력</span>
            </button>`;
        if (!jobs.length) {
            return clearBtn + '<div class="spare-consume-pick-empty muted">검색 결과 없음</div>';
        }
        return clearBtn + jobs.map(j => {
            const sel = selectedCode === j.job_code ? ' selected' : '';
            const sub = [j.item_sort1, j.item_sort2].filter(Boolean).join(' · ');
            return `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-job${sel}"
                onclick="TVC_DefectReport.pickDfJob('${escAttr(j.id)}')">
                <span class="spare-consume-pick-job-code">${esc(j.job_code || '')}</span>
                ${sub ? `<span class="spare-consume-pick-job-sub">${esc(sub)}</span>` : ''}
            </button>`;
        }).join('');
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
        const wrap = document.getElementById('dfJobPick');
        if (wrap?.classList.contains('open')) positionDfPickMenu(wrap, 420);
    }

    function toggleDfGroupPick(ev) {
        ev?.stopPropagation();
        const wrap = document.getElementById('dfGroupPick');
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        closeDfPickMenu(document.getElementById('dfJobPick'));
        if (!opening) {
            closeDfPickMenu(wrap);
            return;
        }
        wrap.classList.add('open');
        refreshDfGroupPickList();
        positionDfPickMenu(wrap, 360);
        bindDfPickClose(wrap, 360);
    }

    function toggleDfJobPick(ev) {
        ev?.stopPropagation();
        const row = getState()._dfDraft || {};
        if (!dfGroupKey(row)) return alert('PMS Group No.를 먼저 선택하세요.');
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
        draft.machinery_name = hdr.machineryName || draft.machinery_name || '';
        draft.maker = hdr.maker || '';
        draft.manufacturer = hdr.maker || '';
        draft.model_type = hdr.modelType || '';
        draft.capacity = hdr.capacity || '';
        draft.serial_no = hdr.serialNo || '';
        draft.type_model_serial = [hdr.modelType, hdr.serialNo].filter(Boolean).join(' / ');
    }

    function pickDfGroup(groupKey, groupLabel) {
        captureDfFormFields();
        const s = getState();
        const draft = s._dfDraft;
        if (!draft) return;
        const prevKey = draft.pms_group_key || dfGroupKey(draft);
        if (prevKey !== groupKey) {
            draft.maintenance_job_id = '';
            draft.pms_job_code = '';
            draft.item_sort1 = '';
            draft.item_sort2 = '';
            draft.job_detail = '';
        }
        applyDfGroupHeader(s, draft, groupKey, groupLabel);
        closeDfPickMenu(document.getElementById('dfGroupPick'));
        rerenderDefectForm();
    }

    function pickDfJob(jobId) {
        captureDfFormFields();
        const s = getState();
        const draft = s._dfDraft;
        if (!draft) return;
        const job = s.idx?.jobById?.get(jobId) || s.jobs?.find(j => j.id === jobId);
        if (!job) return;
        draft.maintenance_job_id = job.id;
        draft.pms_job_code = job.job_code || '';
        draft.item_sort1 = job.item_sort1 || '';
        draft.item_sort2 = job.item_sort2 || '';
        draft.job_detail = job.job_detail || '';
        draft.last_maintenance_date = job.last_done || draft.last_maintenance_date || '';
        const hdr = TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
        draft.machinery_name = hdr.machineryName || job.item_sort1 || draft.machinery_name || '';
        closeDfPickMenu(document.getElementById('dfJobPick'));
        rerenderDefectForm();
    }

    function clearDfJob() {
        captureDfFormFields();
        const s = getState();
        const draft = s._dfDraft;
        if (!draft) return;
        draft.maintenance_job_id = '';
        draft.job_code = '';
        draft.pms_job_code = '';
        draft.item_sort1 = '';
        draft.item_sort2 = '';
        draft.job_detail = '';
        const hdr = resolveDfGroupHeader(s, draft);
        draft.machinery_name = hdr.machineryName || '';
        closeDfPickMenu(document.getElementById('dfJobPick'));
        rerenderDefectForm();
    }

    function renderDfGroupPick(row, ro) {
        const label = dfVal(row, 'pms_group_no');
        const text = label ? dfTreeLabel(label) : '— PMS Group 선택 —';
        if (ro) {
            return `<input class="wr-ro" value="${esc(text)}" readonly tabindex="-1">`;
        }
        return `<div class="spare-consume-meta-pick" id="dfGroupPick">
            <button type="button" class="spare-consume-pick-trigger" onclick="TVC_DefectReport.toggleDfGroupPick(event)">
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

    function renderDfJobPick(row, ro) {
        const code = dfVal(row, 'pms_job_code');
        const text = code || '— JOB CODE 선택 —';
        const disabled = !dfGroupKey(row);
        if (ro) {
            return `<input class="wr-ro" value="${esc(code || '—')}" readonly tabindex="-1">`;
        }
        return `<div class="spare-consume-meta-pick" id="dfJobPick">
            <button type="button" class="spare-consume-pick-trigger"${disabled ? ' disabled' : ''} onclick="TVC_DefectReport.toggleDfJobPick(event)">
                <span class="spare-consume-pick-text">${esc(text)}</span>
                <span class="spare-consume-pick-caret" aria-hidden="true">▾</span>
            </button>
            <div class="spare-consume-pick-menu" role="listbox" aria-label="JOB CODE">
                <div class="spare-consume-pick-search">
                    <input type="search" class="search-input" placeholder="Search JOB CODE / SORT / DETAIL…" value="${esc(_dfJobPickSearch)}"
                        oninput="TVC_DefectReport.dfJobPickSearch(this.value)" onclick="event.stopPropagation()">
                </div>
                <div class="spare-consume-pick-scroll" id="dfJobPickList"></div>
            </div>
        </div>`;
    }

    function init(ctx) { _ctx = ctx; }

    function getState() { return _ctx?.getState?.() || {}; }

    function dfHasLinkedJob(row) {
        return !!(String(dfVal(row, 'pms_job_code') || '').trim() || String(dfVal(row, 'maintenance_job_id') || '').trim());
    }

    function resolveDfGroupHeader(st, row) {
        const groupKey = dfGroupKey(row);
        if (!groupKey) return {};
        return TVC_SpareMenu?.resolveGroupHeaderByKey?.(st, groupKey, dfVal(row, 'pms_group_no')) || {};
    }

    /** Submit/Save 전 — machinery_name·Job 연동 필드 정규화 */
    function normalizeDfSubmitRow(st, row) {
        const hasJob = dfHasLinkedJob(row);
        if (!hasJob) {
            row.maintenance_job_id = '';
            row.pms_job_code = '';
            row.item_sort1 = '';
            row.item_sort2 = '';
            row.job_detail = '';
        }
        const groupHdr = resolveDfGroupHeader(st, row);
        const job = hasJob ? resolveJob(row) : null;
        const jobHdr = job && TVC_SpareMenu?.resolveWrJobHeader?.(st, job) || {};
        row.machinery_name = String(row.machinery_name || '').trim()
            || String(row.job_name || '').trim()
            || (hasJob ? String(row.item_sort1 || job?.item_sort1 || '').trim() : '')
            || String(groupHdr.machineryName || jobHdr.machineryName || '').trim()
            || dfTreeLabel(row.pms_group_no || '');
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
        if (!row?.reported_by) return TVC_RBAC.getRankLabel?.(getState().user) || '';
        const u = getState().user;
        if (u?.username === row.reported_by) return TVC_RBAC.getRankLabel(u);
        return row.reported_by;
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
        const list = s._wrUsedParts || s._dfUsedParts || [];
        if (host) {
            host.querySelectorAll('.spare-wr-qty-input').forEach(el => {
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

    function buildDfPage2Meta(row) {
        const s = getState();
        const job = resolveJob(row);
        const groupHdr = resolveDfGroupHeader(s, row);
        const jobHdr = job && TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
        return {
            reportDate: dfVal(row, 'report_date', row.report_date || ''),
            workDate: dfVal(row, 'work_date', row.work_date || ''),
            reportedBy: reportedByLabel(row),
            pmsGroupNo: dfVal(row, 'pms_group_no', jobHdr.pmsGroupNo || groupHdr.pmsGroupNo || row.pms_group_no || ''),
            jobCode: dfVal(row, 'pms_job_code', job?.job_code || row.job_code || ''),
            sort1: dfVal(row, 'item_sort1', job?.item_sort1 || ''),
            sort2: dfVal(row, 'item_sort2', job?.item_sort2 || ''),
            jobDetail: dfVal(row, 'job_detail', job?.job_detail || ''),
            shipComments: '',
        };
    }

    function renderDfPage2Body(row, ro) {
        return TVC_SpareMenu.renderWrSparePage2Html(null, ro, buildDfPage2Meta(row));
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
        const v = draft?.[key];
        if (v !== undefined && v !== null && v !== '') return v;
        const rv = row?.[key];
        if (rv !== undefined && rv !== null && rv !== '') return rv;
        return fallback ?? '';
    }

    function captureDfFormFields() {
        const host = document.getElementById('defectReportBody');
        const draft = getState()._dfDraft || {};
        if (!host) return draft;
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

    function renderDfAttachmentBlock(kind, { canUpload }) {
        const formKey = kind === 'company' ? 'company_attachments' : 'ship_attachments';
        const label = kind === 'company' ? "Company's Attachment" : "Ship's Attachment";
        const inputId = kind === 'company' ? 'dfCompanyAttachInput' : 'dfShipAttachInput';
        const list = dfAttachmentList(kind);
        const items = list.map(a => `
            <li class="wr-attach-item">
                <a class="wr-attach-link" href="${esc(a.dataUrl)}" download="${esc(a.name)}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>
                <span class="wr-attach-size">${Math.max(1, Math.round((a.size || 0) / 1024))}KB</span>
                ${canUpload ? `<button type="button" class="wr-attach-remove" title="Remove" onclick="TVC_DefectReport.removeAttachment('${kind}','${esc(a.id)}')">×</button>` : ''}
            </li>`).join('');
        const uploadBtn = canUpload
            ? `<button type="button" class="wr-attach-btn" onclick="document.getElementById('${inputId}').click()">📎 ${esc(label)}</button>
               <input type="file" id="${inputId}" class="hidden" multiple onchange="TVC_DefectReport.uploadAttachment('${kind}')">`
            : (list.length ? '' : `<span class="wr-attach-label">${esc(label)}</span>`);
        const listHtml = list.length ? `<ul class="wr-attach-list">${items}</ul>` : '';
        return `<div class="wr-attach-block">${uploadBtn}${listHtml}</div>`;
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
                    alert(`${file.name}: 8MB 이하 파일만 첨부할 수 있습니다.`);
                    continue;
                }
                list.push(await readDfAttachmentFile(file));
            }
        } catch (e) {
            alert(e.message || '파일을 읽을 수 없습니다.');
        }
        input.value = '';
        refreshDefectModal();
    }

    async function removeAttachment(kind, attId) {
        captureDfFormFields();
        const list = dfAttachmentList(kind);
        const i = list.findIndex(a => a.id === attId);
        if (i >= 0) list.splice(i, 1);
        refreshDefectModal();
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
                r.hq_synced === true || r.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
            );
            if (s.selectedVesselId) rows = rows.filter(r => r.vessel_id === s.selectedVesselId);
        } else if (s.department) {
            rows = rows.filter(r => TVC_DefectCase.belongsToDepartment(r, s.department));
        }
        return rows.filter(r => r.visible_in_list !== false)
            .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
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
        return !!(row.pms_job_code || row.maintenance_job_id || row.job_code);
    }

    function defectListColumns(row) {
        if (defectListHasJob(row)) {
            return {
                jobCode: row.pms_job_code || row.job_code || '',
                jobName: row.job_name || row.item_sort1 || row.machinery_name || '',
            };
        }
        if (row.pms_group_no) {
            return {
                jobCode: formatDfGroupNoShort(row.pms_group_no),
                jobName: row.job_name || row.machinery_name || '',
            };
        }
        return {
            jobCode: '',
            jobName: row.job_name || row.machinery_name || '',
        };
    }

    function defectListClosedOut(row) {
        if (row.status !== TVC_DefectCase.Status.CLOSED) return '';
        return formatDfDate(row.dp_closed_date || row.closed_at || row.ship_verified_date);
    }

    function defectListRowsRaw() {
        return filteredCases().sort((a, b) =>
            (b.work_date || b.report_date || b.updated_at || '').localeCompare(a.work_date || a.report_date || a.updated_at || '')
        );
    }

    function matchDfListSearch(row) {
        const q = (_dfListSearch || '').toLowerCase().trim();
        if (!q) return true;
        const cols = defectListColumns(row);
        const hay = [
            row.case_no,
            row.file_no,
            row.voy_no,
            cols.jobCode,
            cols.jobName,
            row.machinery_name,
            row.pms_group_no,
            row.outline_maintenance_request,
            statusLabel(row),
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
    }

    function defectListRows() {
        return defectListRowsRaw().filter(matchDfListSearch);
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
        return TVC_DefectCase.canModifyListWorkflow(row);
    }

    function canDeleteDfListRow(row) {
        if (!row || !getState().user || isHq()) return false;
        return row.status === TVC_DefectCase.Status.DRAFT && !row.phase1_locked;
    }

    function dfListCheckDisabledTitle(row) {
        if (!getState().user) return '로그인 필요';
        if (isHq()) {
            if (row.status !== TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) return 'Awaiting HQ 항목만 선택 가능';
            return '선택 불가';
        }
        if (row.status !== TVC_DefectCase.Status.DRAFT) return 'Draft만 선택 가능';
        if (row.phase1_locked) return '제출된 케이스';
        return '선택 불가';
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
        setDis('dfBtnDetail', !row);
        setDis('dfBtnModify', !row || !canModifyDfListRow(row));
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
    }

    function defectNavList() {
        const s = getState();
        if (s._dfNavSource === 'history') {
            return TVC_App?.getWorkHistoryDefectNavList?.() || [];
        }
        return defectListRows();
    }

    function navDefectModal(dir) {
        const list = defectNavList();
        if (!list.length) return;
        const curId = getState()._defectCaseId;
        let i = list.findIndex(r => r.id === curId);
        if (i < 0) i = 0; else i += dir;
        if (i < 0) { alert('첫 번째 Defect Report입니다.'); return; }
        if (i >= list.length) { alert('마지막 Defect Report입니다.'); return; }
        const mode = getState()._defectMode === 'view' ? 'view' : (getState()._defectMode || 'edit');
        openCase(list[i].id, mode);
    }

    function modifyDefectModal() {
        const id = getState()._defectCaseId;
        if (!id) return;
        openCase(id, 'edit');
    }

    async function deleteDefectModal() {
        const user = getState().user;
        const id = getState()._defectCaseId;
        if (!user || !id) return;
        const row = await TVC_DefectCaseService.get(id);
        if (!row) return;
        if (!canDeleteDfListRow(row)) return alert('Draft 상태만 삭제할 수 있습니다.');
        if (!confirm(`${row.case_no} Defect Report Draft를 삭제하시겠습니까?`)) return;
        try {
            await TVC_DefectCaseService.deleteCase(user, id);
            delete _dfListChecked[id];
            if (_dfListSelId === id) _dfListSelId = null;
            closeModal();
            await refresh();
        } catch (e) {
            alert(e.message || e.code || 'Delete failed');
        }
    }

    function resolveDfOpenMode(row) {
        if (isHq() && row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) return 'phase2';
        if (isHq() && row.status === TVC_DefectCase.Status.AWAITING_COMPLETION) return 'phase4';
        if (!isHq() && (row.status === TVC_DefectCase.Status.COMPANY_REVIEWED
            || row.status === TVC_DefectCase.Status.WORK_IN_PROGRESS)) return 'phase3';
        return 'edit';
    }

    function openCaseFromNav(id, navSource) {
        const row = (getState().defectCases || []).find(c => c.id === id);
        getState()._dfNavSource = navSource;
        openCase(id, row ? resolveDfOpenMode(row) : 'edit');
    }

    function dfDetailReport() {
        const row = getSelectedDfRow();
        if (!row) return alert('Defect Report 목록에서 항목을 선택하세요.');
        openCaseFromNav(row.id, 'list');
    }

    function dfModifyReport() {
        const row = getSelectedDfRow();
        if (!row) return alert('Defect Report 목록에서 항목을 선택하세요.');
        if (!canModifyDfListRow(row)) return alert('Approved · Submitted 상태는 수정할 수 없습니다.');
        openCaseFromNav(row.id, 'list');
    }

    async function dfReportConfirm() {
        const user = getState().user;
        if (!user) return alert('로그인이 필요합니다.');
        let rows = defectListRows().filter(r => _dfListChecked?.[r.id]);
        const sel = getSelectedDfRow();
        if (!rows.length && sel && isDfListRowConfirmable(sel)) rows = [sel];
        if (!rows.length) return alert('Report Confirm할 Reported 항목의 체크박스(ㅁ)를 선택하세요.');

        if (isHq()) {
            const pending = rows.filter(r => r.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY);
            if (!pending.length) return alert('HQ Review 대기(SUBMITTED) 항목만 Confirm할 수 있습니다.');
            openCase(pending[0].id, 'phase2');
            return;
        }

        const toConfirm = rows.filter(isDefectReportConfirmable);
        if (!toConfirm.length) return alert('Confirm할 수 있는 Reported Defect Report를 선택하세요.');
        if (!confirm(`${toConfirm.length}건의 Defect Report를 Confirm하시겠습니까?`)) return;

        let ok = 0;
        for (const row of toConfirm) {
            try {
                await TVC_DefectCaseService.saveApprovalMeta(user, row.id, { confirm: true });
                ok++;
            } catch (e) {
                alert(`${row.case_no}: ${e.message || e.code || 'Confirm failed'}`);
                break;
            }
        }
        _dfListChecked = {};
        await refresh();
        renderTab();
        if (ok) alert(`${ok}건 Report Confirm 완료`);
    }

    async function dfDeleteReport() {
        const user = getState().user;
        if (!user) return alert('로그인이 필요합니다.');
        let ids = getCheckedDfListIds();
        const sel = getSelectedDfRow();
        if (!ids.length && sel && canDeleteDfListRow(sel)) ids = [sel.id];
        if (!ids.length) return alert('삭제할 Draft 항목을 선택하세요.');
        const rows = ids.map(id => defectListRowsRaw().find(r => r.id === id)).filter(Boolean);
        const deletable = rows.filter(canDeleteDfListRow);
        if (!deletable.length) return alert('Draft 상태만 삭제할 수 있습니다.');
        if (!confirm(`${deletable.length}건의 Defect Report Draft를 삭제하시겠습니까?`)) return;

        for (const row of deletable) {
            try {
                await TVC_DefectCaseService.deleteCase(user, row.id);
                delete _dfListChecked[row.id];
                if (_dfListSelId === row.id) _dfListSelId = null;
            } catch (e) {
                alert(`${row.case_no}: ${e.message || e.code || 'Delete failed'}`);
                break;
            }
        }
        await refresh();
        renderTab();
    }

    function renderInbox() {
        renderTab();
    }

    function renderTab() {
        const body = document.getElementById('defectTabBody');
        if (!body) return;
        bindDfListTableEvents();
        pruneDfListChecked();
        const all = defectListRowsRaw();
        const rows = defectListRows();
        const colSpan = 7;
        const countEl = document.getElementById('dfListCount');
        if (countEl) countEl.textContent = `${rows.length} / ${all.length} entries`;
        const searchEl = document.getElementById('dfListSearch');
        if (searchEl && document.activeElement !== searchEl) searchEl.value = _dfListSearch || '';

        if (!all.length) {
            body.innerHTML = `<tr><td colspan="${colSpan}" class="muted" style="text-align:center">No defect cases yet. Create a Defect Report when trouble is identified.</td></tr>`;
            updateDfListToolbarState();
            return;
        }
        if (!rows.length) {
            body.innerHTML = `<tr><td colspan="${colSpan}" class="muted" style="text-align:center">No matches for "${esc(_dfListSearch)}".</td></tr>`;
            updateDfListToolbarState();
            return;
        }

        body.innerHTML = rows.map(r => {
            const cols = defectListColumns(r);
            const occurred = formatDfDate(r.work_date || r.report_date);
            const closed = defectListClosedOut(r);
            const sel = _dfListSelId === r.id ? ' row-selected' : '';
            const canCheck = isDfListRowCheckable(r);
            const checked = canCheck && !!_dfListChecked?.[r.id];
            const chk = canCheck
                ? `<input type="checkbox" class="df-list-chk-input"${checked ? ' checked' : ''}>`
                : `<input type="checkbox" disabled title="${escAttr(dfListCheckDisabledTitle(r))}">`;
            return `<tr class="df-list-row hist-row${sel}" data-df-id="${escAttr(r.id)}" onclick="TVC_DefectReport.selectDfListRow('${escAttr(r.id)}', event)" ondblclick="TVC_DefectReport.openCaseFromList('${escAttr(r.id)}')">
                <td class="hist-chk" onclick="event.stopPropagation()">${chk}</td>
                <td class="df-list-date">${esc(occurred || '—')}</td>
                <td class="df-list-file">${esc(r.file_no || '—')}</td>
                <td class="df-list-code">${cols.jobCode ? `<strong>${esc(cols.jobCode)}</strong>` : '—'}</td>
                <td class="df-list-name">${esc(cols.jobName || '—')}</td>
                <td><span class="defect-status tone-${statusTone(r)}">${esc(statusLabel(r))}</span></td>
                <td class="df-list-closed">${esc(closed || '—')}</td>
            </tr>`;
        }).join('');
        updateDfListToolbarState();
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

    function renderDfReportFooter(row, opts = {}) {
        const ro = opts.readonly;
        const dis = ro ? ' disabled' : '';
        const roAttr = ro ? ' readonly' : '';
        const canEditShipAttach = !ro;
        const canEditCompanyAttach = isHq() && TVC_DefectCase.isPhase2Editable(row);
        const fld = (label, inner, extraCls = '') =>
            `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const inp = (name, val, type = 'text') => {
            const v = esc(dfVal(row, name, val));
            if (type === 'number') return `<input type="number" data-df="${name}" class="${ro ? 'wr-ro' : ''}" value="${v}"${roAttr}${dis}>`;
            return `<input data-df="${name}" class="${ro ? 'wr-ro' : ''}" value="${v}"${roAttr}${dis}>`;
        };
        const flagChk = (name, label) => `<label class="wr-footer-flag">
            <input type="checkbox" data-df="${name}"${dfFlagChecked(row, name) ? ' checked' : ''}${dis}>
            <span>${esc(label)}</span>
        </label>`;

        return `<footer class="wr-report-footer">
            <div class="wr-footer-flags" role="group" aria-label="Report status flags">
                ${flagChk('repair_request', 'Repair Request')}
                ${flagChk('shore_support', 'Conducted by Shore Support')}
                ${flagChk('defect_cleared', 'Defect Cleared')}
            </div>
            <div class="wr-footer-labor">
                ${fld('Working Hours', inp('working_hours', '0', 'number'))}
                ${fld('Working Member', inp('working_member', '0', 'number'))}
            </div>
            <div class="wr-footer-section wr-footer-ship">
                <div class="wr-footer-attach">${renderDfAttachmentBlock('ship', { canUpload: canEditShipAttach })}</div>
            </div>
            <div class="wr-footer-section wr-footer-company">
                ${fld("Company's Comments", `<textarea class="wr-maint-textarea wr-ro" rows="3" readonly>${esc(dfVal(row, 'company_comment', row.company_initial_reply || ''))}</textarea>`, 'wr-maint-span-all')}
                <div class="wr-footer-attach">${renderDfAttachmentBlock('company', { canUpload: canEditCompanyAttach })}</div>
            </div>
        </footer>`;
    }

    function dfApprovalState(row) {
        const user = getState().user;
        const isConfirmed = !!(row.confirmed_at || row.confirmed_by);
        const isApproved = !!(row.approved_at || row.approved_by);
        const canConfirmNow = isDefectReportConfirmable(row);
        const canApproveNow = isConfirmed && !isApproved
            && !!user && TVC_RBAC.isHqAccount(user);
        return {
            isConfirmed,
            isApproved,
            canConfirmNow,
            canApproveNow,
            confirmedByVal: isConfirmed ? 'Captain, Chief Engineer' : '',
            approvedByVal: isApproved ? 'Company' : '',
        };
    }

    function renderDfApprovalHtml(row) {
        const {
            isConfirmed, isApproved, canConfirmNow, canApproveNow,
            confirmedByVal, approvedByVal,
        } = dfApprovalState(row);
        return `<section class="wr-maint-card wr-maint-approval">
            <div class="wr-maint-approval-item${canConfirmNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="dfConfirmedBy"${isConfirmed ? ' checked' : ''}${canConfirmNow ? '' : ' disabled'}> Confirmed by</label>
                <input class="wr-ro wr-maint-date" value="${esc(confirmedByVal)}" readonly tabindex="-1">
            </div>
            <div class="wr-maint-approval-item${canApproveNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="dfApprovedBy"${isApproved ? ' checked' : ''}${canApproveNow ? '' : ' disabled'}> Approved by</label>
                <input class="wr-ro wr-maint-date" value="${esc(approvedByVal)}" readonly tabindex="-1">
            </div>
        </section>`;
    }

    function renderPhase1(row, readonly, opts = {}) {
        const { includeApproval = true } = opts;
        ensureDfDraft(row);
        const s = getState();
        const hasJob = dfHasLinkedJob(row);
        const job = hasJob ? resolveJob(row) : null;
        const hdr = job && TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || resolveDfGroupHeader(s, row);
        const ro = readonly;
        const roAttr = ro ? ' readonly' : '';
        const roCls = ro ? ' wr-ro' : '';
        const dis = ro ? ' disabled' : '';
        const fld = (label, inner, extraCls = '') => `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}">${label ? `<label>${label}</label>` : ''}${inner}</div>`;
        const inp = (name, val, type = 'text') => {
            const v = esc(dfVal(row, name, val));
            if (type === 'date') return `<input type="date" data-df="${name}" class="${roCls.trim()}" value="${v}"${roAttr}>`;
            if (type === 'number') return `<input type="number" data-df="${name}" class="${roCls.trim()}" value="${v}"${roAttr}>`;
            return `<input data-df="${name}" class="${roCls.trim()}" value="${v}"${roAttr}>`;
        };
        const ta = (name, val, rows = 3) => `<textarea class="wr-maint-textarea${roCls}" data-df="${name}" rows="${rows}"${roAttr}>${esc(dfVal(row, name, val))}</textarea>`;

        return `<div class="wr-maint-form">
            ${includeApproval ? renderDfApprovalHtml(row) : ''}
            <section class="wr-maint-card wr-maint-body">
                <div class="wr-maint-grid wr-maint-grid-3">
                    ${fld('File No.', inp('file_no', ''))}
                    ${fld('Voy. No.', inp('voy_no', ''))}
                    ${fld('Place', inp('place', ''))}
                    ${fld('Occurred Date', inp('work_date', row.report_date, 'date'))}
                    ${fld('Reported Date', inp('report_date', row.report_date, 'date'))}
                    ${fld('Reported by', `<input class="wr-ro" value="${esc(reportedByLabel(row))}" readonly>`)}
                    ${fld('PMS Group No.', renderDfGroupPick(row, ro), 'wr-maint-span-all')}
                </div>
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Job Code', renderDfJobPick(row, ro))}
                    ${fld('SORT-1', `<input class="wr-ro" data-df="item_sort1" value="${esc(hasJob ? dfVal(row, 'item_sort1', job?.item_sort1 || '') : '')}" readonly tabindex="-1">`)}
                    ${fld('SORT-2', `<input class="wr-ro" data-df="item_sort2" value="${esc(hasJob ? dfVal(row, 'item_sort2', job?.item_sort2 || '') : '')}" readonly tabindex="-1">`)}
                    ${fld('Job Detail', `<input class="wr-ro" data-df="job_detail" value="${esc(hasJob ? dfVal(row, 'job_detail', job?.job_detail || '') : '')}" readonly tabindex="-1">`)}
                </div>
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
                ${fld('Action Plan / Corrective Action', ta('action_taken', ''), 'wr-maint-span-all')}
                ${renderDfReportFooter(row, { readonly: ro })}
            </section>
        </div>`;
    }

    function renderPhase2(row, readonly) {
        const show = row.status !== TVC_DefectCase.Status.DRAFT || isHq();
        if (!show) return '';
        const p2ro = readonly || !TVC_DefectCase.isPhase2Editable(row);
        return `<section class="df-phase df-phase-hq">
            <h3 class="df-phase-title">Phase 2 — Company Initial Reply / Permit to Work <span class="df-urgent">URGENT</span></h3>
            <div class="df-grid">
                ${fieldInput('company_initial_reply', 'Initial Reply from Company', row.company_initial_reply, { span: 2, textarea: true, rows: 3, readonly: p2ro })}
                ${fieldInput('permit_to_work', 'Permit to Work (Unplanned Maintenance)', row.permit_to_work, { span: 2, textarea: true, rows: 2, readonly: p2ro })}
                ${fieldInput('reply_by', 'Reply by', row.reply_by, { readonly: p2ro })}
                ${fieldInput('reply_date', 'Reply Date', row.reply_date, { type: 'date', readonly: p2ro })}
            </div>
            <div class="df-checks">
                <span class="df-checks-label">Require to report to:</span>
                ${fieldInput('report_to_class', 'Class', row.report_to_class, { checkbox: true, readonly: p2ro })}
                ${fieldInput('report_to_flag', 'Flag', row.report_to_flag, { checkbox: true, readonly: p2ro })}
                ${fieldInput('report_to_external_stakeholder', 'External Stakeholder', row.report_to_external_stakeholder, { checkbox: true, readonly: p2ro })}
                ${fieldInput('report_to_psc', 'PSC', row.report_to_psc, { checkbox: true, readonly: p2ro })}
                ${fieldInput('report_na', 'N/A', row.report_na, { checkbox: true, readonly: p2ro })}
            </div>
        </section>`;
    }

    function renderPhase3(row, readonly) {
        const show = row.phase2_locked || row.phase3_locked
            || row.status === TVC_DefectCase.Status.WORK_IN_PROGRESS
            || row.status === TVC_DefectCase.Status.AWAITING_COMPLETION
            || row.status === TVC_DefectCase.Status.CLOSED;
        if (!show) return '';
        const p3ro = readonly || !TVC_DefectCase.isPhase3Editable(row);
        return `<section class="df-phase df-phase-ship">
            <h3 class="df-phase-title">Phase 3 — Verified by Ship (After trouble cleared)</h3>
            <div class="df-grid">
                ${fieldInput('ship_verified_after_clear', 'Verification — trouble cleared / work completed', row.ship_verified_after_clear, { span: 2, textarea: true, rows: 4, readonly: p3ro })}
                ${fieldInput('ship_verified_by', 'Verified by (C/E or Master)', row.ship_verified_by, { readonly: p3ro })}
                ${fieldInput('ship_verified_date', 'Verification Date', row.ship_verified_date, { type: 'date', readonly: p3ro })}
            </div>
            ${row.phase3_locked ? '<p class="df-phase-note">✔ Completion reported to Company.</p>' : ''}
        </section>`;
    }

    function renderPhase4(row, readonly) {
        const show = row.phase3_locked || row.phase4_locked
            || row.status === TVC_DefectCase.Status.AWAITING_COMPLETION
            || row.status === TVC_DefectCase.Status.CLOSED
            || (isHq() && row.status === TVC_DefectCase.Status.AWAITING_COMPLETION);
        if (!show && !isHq()) return '';
        const p4ro = readonly || !TVC_DefectCase.isPhase4Editable(row);
        const showHQ = row.phase3_locked || row.status === TVC_DefectCase.Status.AWAITING_COMPLETION || row.status === TVC_DefectCase.Status.CLOSED;
        if (!showHQ && !isHq()) return '';
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

    function refreshDefectModal() {
        const s = getState();
        if ((s._dfPage || '1') === '2') {
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
    }

    function setDefectReportPage(page) {
        captureDfFormFields();
        if ((getState()._dfPage || '1') === '2') {
            captureDfUsedParts();
            TVC_SpareMenu.teardownWrSparePage2();
            dfSpareContextLeave();
        }
        getState()._dfPage = page;
        refreshDefectModal();
    }

    function renderModalBody(row, mode) {
        const hq = isHq();
        const forceView = mode === 'view';
        const fromListNav = !!getState()._dfNavSource;
        const dfPage = getState()._dfPage || '1';
        const wfModifiable = TVC_DefectCase.canModifyListWorkflow(row);
        const phase1ro = forceView || hq || !wfModifiable;
        const canEditP1 = !forceView && !hq && wfModifiable && row.status !== TVC_DefectCase.Status.CLOSED;
        const canEditP2 = !forceView && hq && wfModifiable && TVC_DefectCase.isPhase2Editable(row);
        const canEditP3 = !forceView && !hq && wfModifiable && TVC_DefectCase.isPhase3Editable(row);
        const canEditP4 = !forceView && hq && wfModifiable && TVC_DefectCase.isPhase4Editable(row);
        const canSave = !forceView && wfModifiable && (canEditP1 || canEditP2 || canEditP3 || canEditP4);

        const pageTabs = `
            <div class="wr-pagetabs">
                <button type="button" class="wr-pagetab${dfPage === '1' ? ' active' : ''}" onclick="TVC_DefectReport.setDefectReportPage('1')">Page 1</button>
                <button type="button" class="wr-pagetab${dfPage === '2' ? ' active' : ''}" onclick="TVC_DefectReport.setDefectReportPage('2')">Page 2</button>
            </div>`;
        const pageTabsBar = `<div class="wr-pagetabs-bar modal-drag-handle">${pageTabs}</div>`;

        const headHtml = dfPage === '2' ? renderDfApprovalHtml(row) : '';
        let body = '';
        if (dfPage === '2') {
            const page2ro = forceView || !wfModifiable;
            body = renderDfPage2Body(row, page2ro);
        } else {
            body = `${renderPhase1(row, !canEditP1, { includeApproval: true })}
                <div class="df-workflow-phases">
                    ${renderPhase2(row, !canEditP2)}
                    ${renderPhase3(row, !canEditP3)}
                    ${renderPhase4(row, !canEditP4)}
                </div>`;
        }

        let actionsHtml;
        if (fromListNav) {
            actionsHtml = `<button type="button" class="btn" onclick="TVC_DefectReport.navDefectModal(-1)">&laquo; Previous</button>
                <button type="button" class="btn" onclick="TVC_DefectReport.navDefectModal(1)">Next &raquo;</button>
                ${canSave ? `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveModal()">💾 Save</button>` : ''}
                <button type="button" class="btn" onclick="TVC_DefectReport.closeDefectModal()">Close</button>`;
        } else {
            actionsHtml = `${canSave ? `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveModal()">💾 Save</button>` : ''}
                <button type="button" class="btn" onclick="TVC_DefectReport.requestCloseModal()">Cancel</button>`;
        }

        return `<div class="df-modal-inner">
            ${pageTabsBar}
            <div class="wr-page tone-defect">
                ${headHtml}
                ${body}
            </div>
            <div class="modal-actions wr-actions df-modal-actions">
                ${actionsHtml}
            </div>
        </div>`;
    }

    function captureForm() {
        if ((getState()._dfPage || '1') === '2') captureDfUsedParts();
        const draft = captureDfFormFields();
        const st = getState();
        return normalizeDfSubmitRow(st, {
            ...draft,
            ship_attachments: dfAttachmentList('ship'),
            company_attachments: dfAttachmentList('company'),
            used_parts: dfUsedPartsPayload(),
        });
    }

    async function openCase(id, mode) {
        const row = await TVC_DefectCaseService.get(id);
        if (!row) return alert('Case not found.');
        const s = getState();
        if (s._defectCaseId !== id) s._dfPage = '1';
        s._defectCaseId = id;
        s._defectMode = mode === 'view' ? 'view' : (mode || 'edit');
        s._dfCaseId = null;
        _dfListSelId = id;
        ensureDfDraft(row);
        s._dfUsedPartsCaseId = null;
        ensureDfUsedParts(row);
        const body = document.getElementById('defectReportBody');
        if (body) body.innerHTML = renderModalBody(getDefectModalRow() || row, s._defectMode);
        document.getElementById('defectReportModal')?.classList.remove('hidden');
        if ((s._dfPage || '1') === '2') {
            const forceView = s._defectMode === 'view';
            const page2ro = forceView || !TVC_DefectCase.canModifyListWorkflow(row);
            syncDfSparePage2Ui(true, page2ro);
        }
    }

    function openCaseFromList(id) {
        openCaseFromNav(id, 'list');
    }

    async function openNewFromJob(jobId) {
        const s = getState();
        s._dfNavSource = null;
        const job = s.jobs?.find(j => j.id === jobId);
        if (!job) return alert('Select a job first.');
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
        await TVC_DefectCaseService.saveDraft(s.user, row, row.id);
        await refresh();
        s._dfNewSession = true;
        s._dfSavedToList = false;
        openCase(row.id, 'edit');
    }

    async function openNewBlank() {
        const s = getState();
        s._dfNavSource = null;
        s._dfNewSession = true;
        s._dfSavedToList = false;
        const shipName = document.getElementById('cmaxsShipName')?.textContent || '';
        const row = await TVC_DefectCaseService.saveDraft(s.user, {
            ship_name: shipName,
            department: s.department || s.user?.department || '',
            visible_in_list: false,
        });
        await refresh();
        openCase(row.id, 'edit');
    }

    async function saveModal() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        const row = await TVC_DefectCaseService.get(id);
        if (!row) return;
        if (isHq() && TVC_DefectCase.isPhase4Editable(row)) return saveHqPhase4();
        if (isHq() && TVC_DefectCase.isPhase2Editable(row)) return saveHqReply();
        if (!isHq() && TVC_DefectCase.isPhase3Editable(row)) return saveShipPhase3();
        return saveDraft();
    }

    async function saveDraft() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        const data = { ...captureForm(), visible_in_list: true };
        await TVC_DefectCaseService.saveDraft(s.user, data, id);
        s._dfSavedToList = true;
        await refresh();
        await openCase(id);
        alert('Defect Report draft saved.');
    }

    async function submitCase() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        await TVC_DefectCaseService.saveDraft(s.user, captureForm(), id);
        try {
            await TVC_DefectCaseService.submitToCompany(s.user, id);
            await refresh();
            await openCase(id);
            const go = confirm('Submitted to Company (URGENT).\n\nCreate Urgent Export package now? (ZIP + printable HTML for email)');
            if (go) await TVC_App.urgentExportDefect(id);
        } catch (e) {
            alert(e.message || e.code || 'Submit failed');
        }
    }

    async function saveHqReply(andExport) {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        try {
            await TVC_DefectCaseService.saveHqPhase2(s.user, id, captureForm());
            await refresh();
            await openCase(id);
            alert('HQ Phase 2 saved.');
            if (andExport) await TVC_DefectSync.exportHqReplyZip(s.user, id);
        } catch (e) {
            alert(e.message || e.code || 'HQ reply failed');
        }
    }

    async function startWork() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        try {
            await TVC_DefectCaseService.startWork(s.user, id);
            await refresh();
            await openCase(id);
        } catch (e) {
            alert(e.message || e.code || 'Start work failed');
        }
    }

    async function saveShipPhase3(andExport) {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        try {
            await TVC_DefectCaseService.saveShipPhase3(s.user, id, captureForm());
            await refresh();
            await openCase(id);
            alert('Phase 3 — Completion reported to Company.');
            if (andExport) await TVC_App.exportDefectCompletion(id);
        } catch (e) {
            alert(e.message || e.code || 'Phase 3 save failed');
        }
    }

    async function saveHqPhase4(andExport) {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        try {
            await TVC_DefectCaseService.saveHqPhase4(s.user, id, captureForm());
            await refresh();
            await openCase(id);
            alert('Phase 4 — Case closed by Company D.P.');
            if (andExport) await TVC_DefectSync.exportCloseZip(s.user, id);
        } catch (e) {
            alert(e.message || e.code || 'Phase 4 close failed');
        }
    }

    async function printCase(id) {
        const caseId = id || getState()._defectCaseId;
        const row = await TVC_DefectCaseService.get(caseId);
        if (!row) return;
        const html = TVC_DefectSync.buildPrintHtml(row, row.ship_name);
        TVC_DefectSync.openPrintWindow(html, `Defect ${row.case_no}`);
    }

    function isNewUnsavedDefectSession() {
        const s = getState();
        return !!(s._dfNewSession && !s._dfSavedToList && s._defectCaseId && !s._dfNavSource);
    }

    function showCancelConfirm() {
        document.getElementById('dfCancelConfirmModal')?.classList.remove('hidden');
    }

    function dismissCancelConfirm() {
        document.getElementById('dfCancelConfirmModal')?.classList.add('hidden');
    }

    function requestCloseModal() {
        if (isNewUnsavedDefectSession()) {
            showCancelConfirm();
            return;
        }
        closeDefectModal();
    }

    async function closeDefectModal() {
        dismissCancelConfirm();
        const s = getState();
        const id = s._defectCaseId;
        const user = s.user;
        const cfCb = document.getElementById('dfConfirmedBy');
        const apCb = document.getElementById('dfApprovedBy');

        if (id && user) {
            try {
                const doConfirm = cfCb?.checked && !cfCb.disabled;
                const doApprove = apCb?.checked && !apCb.disabled;
                if (doConfirm || doApprove) {
                    await TVC_DefectCaseService.saveApprovalMeta(user, id, {
                        confirm: doConfirm,
                        approve: doApprove,
                    });
                }
            } catch (e) {
                alert(e.message || e.code || 'Approval failed');
                return;
            }
        }
        closeModal();
        await refresh();
    }

    async function confirmCancelNew(yes) {
        dismissCancelConfirm();
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
        dismissCancelConfirm();
        closeAllDfPicks();
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
        if (s.currentTab === 'defect') renderTab();
    }

    return {
        init, renderInbox, renderTab, openCase, openCaseFromList, openCaseFromNav, openNewFromJob, openNewBlank,
        saveDraft, saveModal, submitCase, saveHqReply, saveShipPhase3, saveHqPhase4, startWork,
        printCase, closeModal, closeDefectModal, requestCloseModal, confirmCancelNew, dismissCancelConfirm, captureForm, uploadAttachment, removeAttachment,
        toggleDfGroupPick, toggleDfJobPick, pickDfGroup, pickDfJob, clearDfJob, dfGroupPickSearch, dfJobPickSearch,
        filteredCases, statusLabel, defectListRows,
        dfDetailReport, dfReportConfirm, dfModifyReport, dfDeleteReport,
        dfListSearch, selectDfListRow, toggleDfListCheck, toggleDfListSelectAll,
        navDefectModal, modifyDefectModal, deleteDefectModal, setDefectReportPage,
    };
})();

if (typeof window !== 'undefined') window.TVC_DefectReport = TVC_DefectReport;
