/* Defect (Trouble) Report UI — Phase 1 (Ship) · Phase 2 (HQ) */
const TVC_DefectReport = (function () {
    let _ctx = null;

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function init(ctx) { _ctx = ctx; }

    function getState() { return _ctx?.getState?.() || {}; }

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
            };
        }
        return s._dfDraft;
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
        const id = getState()._defectCaseId;
        if (id) await openCase(id, getState()._defectMode);
    }

    async function removeAttachment(kind, attId) {
        captureDfFormFields();
        const list = dfAttachmentList(kind);
        const i = list.findIndex(a => a.id === attId);
        if (i >= 0) list.splice(i, 1);
        const id = getState()._defectCaseId;
        if (id) await openCase(id, getState()._defectMode);
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
        return rows.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    }

    function statusLabel(st) {
        const map = {
            DRAFT: 'Draft',
            SUBMITTED_TO_COMPANY: 'Awaiting HQ',
            COMPANY_REVIEWED: 'HQ Replied',
            WORK_IN_PROGRESS: 'Work in Progress',
            AWAITING_COMPLETION: 'Awaiting Completion',
            CLOSED: 'Closed',
        };
        return map[st] || st;
    }

    function statusTone(st) {
        if (st === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) return 'amber';
        if (st === TVC_DefectCase.Status.COMPANY_REVIEWED) return 'green';
        if (st === TVC_DefectCase.Status.AWAITING_COMPLETION) return 'amber';
        if (st === TVC_DefectCase.Status.CLOSED) return 'green';
        if (st === TVC_DefectCase.Status.WORK_IN_PROGRESS) return 'blue';
        if (st === TVC_DefectCase.Status.DRAFT) return 'blue';
        return 'gray';
    }

    function renderInbox() {
        renderInboxTo('defectInboxBody', 'defectInboxHead');
    }

    function renderTab() {
        renderInboxTo('defectTabBody', null);
    }

    function renderInboxTo(bodyId, headId) {
        const host = document.getElementById(bodyId);
        if (!host) return;
        const rows = filteredCases();
        const hq = isHq();
        const pendingHq = rows.filter(r => r.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY);
        const pendingClose = rows.filter(r => r.status === TVC_DefectCase.Status.AWAITING_COMPLETION);
        const badgeCount = hq ? pendingHq.length : pendingClose.length;
        const badge = badgeCount
            ? `<span class="defect-inbox-badge">${badgeCount}</span>` : '';

        if (!rows.length) {
            host.innerHTML = `<p class="muted defect-inbox-empty">No defect cases yet. ${
                hq ? 'Import an Urgent Defect package from ship.' : 'Create a Defect Report when trouble is identified.'
            }</p>`;
            return;
        }

        host.innerHTML = `<table class="defect-inbox-table">
            <thead><tr>
                <th>Ref No</th><th>Date</th><th>Machinery</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>${rows.map(r => `
                <tr class="defect-inbox-row" data-id="${esc(r.id)}">
                    <td><strong>${esc(r.case_no)}</strong></td>
                    <td>${esc(r.report_date)}</td>
                    <td>${esc(r.machinery_name || r.pms_job_code || '—')}</td>
                    <td><span class="defect-status tone-${statusTone(r.status)}">${esc(statusLabel(r.status))}</span></td>
                    <td class="defect-inbox-actions">
                        <button type="button" class="btn-sm" onclick="TVC_DefectReport.openCase('${esc(r.id)}')">Open</button>
                        ${!hq && r.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
                            ? `<button type="button" class="btn-sm btn-amber" onclick="TVC_App.urgentExportDefect('${esc(r.id)}')">Urgent Export</button>` : ''}
                        ${hq && r.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
                            ? `<button type="button" class="btn-sm btn-green" onclick="TVC_DefectReport.openCase('${esc(r.id)}','phase2')">Review</button>` : ''}
                        ${hq && r.status === TVC_DefectCase.Status.AWAITING_COMPLETION
                            ? `<button type="button" class="btn-sm btn-green" onclick="TVC_DefectReport.openCase('${esc(r.id)}','phase4')">Close</button>` : ''}
                        ${!hq && (r.status === TVC_DefectCase.Status.COMPANY_REVIEWED || r.status === TVC_DefectCase.Status.WORK_IN_PROGRESS) && !r.phase3_locked
                            ? `<button type="button" class="btn-sm btn-green" onclick="TVC_DefectReport.openCase('${esc(r.id)}','phase3')">Complete</button>` : ''}
                    </td>
                </tr>`).join('')}</tbody>
        </table>`;

        const head = headId ? document.getElementById(headId) : null;
        if (head) head.innerHTML = `Defect Report Inbox${badge}`;
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

    function renderPhase1(row, readonly) {
        ensureDfDraft(row);
        const s = getState();
        const job = resolveJob(row);
        const hdr = job && TVC_SpareMenu?.resolveWrJobHeader?.(s, job) || {};
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
        const canEditShipAttach = !ro;
        const canEditCompanyAttach = isHq() && TVC_DefectCase.isPhase2Editable(row);

        return `<div class="wr-maint-form">
            <section class="wr-maint-card wr-maint-body">
                <div class="wr-maint-grid wr-maint-grid-3">
                    ${fld('File No.', inp('file_no', ''))}
                    ${fld('Voy. No.', inp('voy_no', ''))}
                    ${fld('Place', inp('place', ''))}
                    ${fld('Work Date', inp('work_date', row.report_date, 'date'))}
                    ${fld('Reported Date', inp('report_date', row.report_date, 'date'))}
                    ${fld('Reported by', `<input class="wr-ro" value="${esc(reportedByLabel(row))}" readonly>`)}
                    ${fld('PMS Group No.', inp('pms_group_no', hdr.pmsGroupNo || row.pms_group_no || job?.group || ''), 'wr-maint-span-all')}
                </div>
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Job Code', `<input class="wr-ro" value="${esc(dfVal(row, 'pms_job_code', job?.job_code || ''))}" readonly>`)}
                    ${fld('SORT-1', `<input class="wr-ro" value="${esc(dfVal(row, 'item_sort1', job?.item_sort1 || ''))}" readonly>`)}
                    ${fld('SORT-2', `<input class="wr-ro" value="${esc(dfVal(row, 'item_sort2', job?.item_sort2 || ''))}" readonly>`)}
                    ${fld('Job Detail', `<input class="wr-ro" value="${esc(dfVal(row, 'job_detail', job?.job_detail || ''))}" readonly>`)}
                </div>
                <div class="wr-maint-grid wr-maint-grid-4 wr-maint-grid-gap">
                    ${fld('Maker', inp('maker', hdr.maker || row.manufacturer || ''))}
                    ${fld('Model / Type', inp('model_type', hdr.modelType || row.model_type || ''))}
                    ${fld('Capacity', inp('capacity', hdr.capacity || row.capacity || ''))}
                    ${fld('Serial No.', inp('serial_no', hdr.serialNo || row.serial_no || ''))}
                </div>
                <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap">
                    ${fld('Total Run Hrs', inp('total_run_hrs', '0', 'number'))}
                    ${fld('Last Maintenance Date', inp('last_maintenance_date', job?.last_done || '', 'date'))}
                    ${fld('Running Hrs after Last Maint.', inp('rh_since_last_maintenance', '', 'number'))}
                </div>
                ${fld('Outline of Defect', ta('outline_maintenance_request', job?.job_detail || ''), 'wr-maint-span-all wr-maint-grid-gap')}
                ${fld('Estimated Cause of Defect', ta('estimated_cause', ''), 'wr-maint-span-all')}
                ${fld('Possible Effect to Other System', ta('possible_effect', ''), 'wr-maint-span-all')}
                ${fld('Action Plan / Corrective Action', ta('action_taken', ''), 'wr-maint-span-all')}
                <div class="wr-maint-attach-wrap">${renderDfAttachmentBlock('ship', { canUpload: canEditShipAttach })}</div>
                <div class="wr-maint-grid wr-maint-grid-3 wr-maint-grid-gap wr-maint-labor">
                    ${fld('Working Hours', inp('working_hours', '0', 'number'))}
                    ${fld('Working Member', inp('working_member', '0', 'number'))}
                    <div class="wr-maint-field wr-maint-chk-field">
                        <label class="wr-maint-chk"><input type="checkbox" data-df="shore_technician"${dfVal(row, 'shore_technician') ? ' checked' : ''}${dis}> Shore Technician</label>
                    </div>
                </div>
                ${fld("Company's Comments", `<textarea class="wr-maint-textarea wr-ro" rows="3" readonly>${esc(dfVal(row, 'company_comment', row.company_initial_reply || ''))}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
                <div class="wr-maint-attach-wrap">${renderDfAttachmentBlock('company', { canUpload: canEditCompanyAttach })}</div>
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

    function renderModalBody(row, mode) {
        const hq = isHq();
        const phase1ro = row.phase1_locked || hq;
        const canEditP1 = !phase1ro && TVC_DefectCase.isPhase1Editable(row);
        const canEditP2 = hq && TVC_DefectCase.isPhase2Editable(row);
        const canEditP3 = !hq && TVC_DefectCase.isPhase3Editable(row);
        const canEditP4 = hq && TVC_DefectCase.isPhase4Editable(row);
        const canStart = !hq && TVC_DefectCase.canStartWork(row);

        return `<div class="df-modal-inner">
            <div class="wr-titlebar">Defect (Trouble) Report — ${esc(row.case_no)}
                <span class="df-status-pill tone-${statusTone(row.status)}">${esc(statusLabel(row.status))}</span>
            </div>
            <div class="wr-page tone-defect df-modal-scroll">
                ${renderPhase1(row, !canEditP1)}
                ${renderPhase2(row, !canEditP2)}
                ${renderPhase3(row, !canEditP3)}
                ${renderPhase4(row, !canEditP4)}
            </div>
            <div class="modal-actions wr-actions df-modal-actions">
                <button type="button" class="btn" onclick="TVC_DefectReport.printCase('${esc(row.id)}')">🖨 Print</button>
                ${canEditP1 ? `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveDraft()">💾 Save</button>` : ''}
                ${canEditP1 ? `<button type="button" class="btn btn-amber" onclick="TVC_DefectReport.submitCase()">Submit to Company</button>` : ''}
                ${!hq && row.status === TVC_DefectCase.Status.SUBMITTED_TO_COMPANY
                    ? `<button type="button" class="btn btn-red" onclick="TVC_App.urgentExportDefect('${esc(row.id)}')">📦 Urgent Export</button>` : ''}
                ${canStart ? `<button type="button" class="btn" onclick="TVC_DefectReport.startWork()">▶ Start Work</button>` : ''}
                ${canEditP2 ? `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveHqReply()">Save HQ Reply</button>` : ''}
                ${canEditP2 ? `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveHqReply(true)">Save &amp; Export Reply</button>` : ''}
                ${canEditP3 ? `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveShipPhase3()">Report Completion</button>` : ''}
                ${canEditP3 ? `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveShipPhase3(true)">Report &amp; Export</button>` : ''}
                ${!hq && row.status === TVC_DefectCase.Status.AWAITING_COMPLETION
                    ? `<button type="button" class="btn btn-amber" onclick="TVC_App.exportDefectCompletion('${esc(row.id)}')">📦 Export Completion</button>` : ''}
                ${canEditP4 ? `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveHqPhase4()">Close Case (D.P.)</button>` : ''}
                ${canEditP4 ? `<button type="button" class="btn btn-green" onclick="TVC_DefectReport.saveHqPhase4(true)">Close &amp; Export</button>` : ''}
                <button type="button" class="btn" onclick="TVC_DefectReport.closeModal()">Cancel</button>
            </div>
        </div>`;
    }

    function captureForm() {
        const draft = captureDfFormFields();
        return {
            ...draft,
            ship_attachments: dfAttachmentList('ship'),
            company_attachments: dfAttachmentList('company'),
        };
    }

    async function openCase(id, mode) {
        const row = await TVC_DefectCaseService.get(id);
        if (!row) return alert('Case not found.');
        getState()._defectCaseId = id;
        getState()._defectMode = mode || 'view';
        getState()._dfCaseId = null;
        ensureDfDraft(row);
        const body = document.getElementById('defectReportBody');
        if (body) body.innerHTML = renderModalBody(row, mode);
        document.getElementById('defectReportModal')?.classList.remove('hidden');
    }

    async function openNewFromJob(jobId) {
        const s = getState();
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
        await TVC_DefectCaseService.saveDraft(s.user, row, row.id);
        await refresh();
        openCase(row.id);
    }

    async function openNewBlank() {
        const s = getState();
        const shipName = document.getElementById('cmaxsShipName')?.textContent || '';
        const row = await TVC_DefectCaseService.saveDraft(s.user, {
            ship_name: shipName,
            department: s.department || s.user?.department || '',
        });
        await refresh();
        openCase(row.id);
    }

    async function saveDraft() {
        const s = getState();
        const id = s._defectCaseId;
        if (!id) return;
        const data = captureForm();
        await TVC_DefectCaseService.saveDraft(s.user, data, id);
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

    function closeModal() {
        document.getElementById('defectReportModal')?.classList.add('hidden');
        const s = getState();
        s._defectCaseId = null;
        s._dfCaseId = null;
        s._dfDraft = null;
    }

    return {
        init, renderInbox, renderTab, openCase, openNewFromJob, openNewBlank,
        saveDraft, submitCase, saveHqReply, saveShipPhase3, saveHqPhase4, startWork,
        printCase, closeModal, captureForm, uploadAttachment, removeAttachment,
        filteredCases, statusLabel,
    };
})();

if (typeof window !== 'undefined') window.TVC_DefectReport = TVC_DefectReport;
