/* Defect (Trouble) Report UI — Phase 1 (Ship) · Phase 2 (HQ) */
const TVC_DefectReport = (function () {
    let _ctx = null;

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function init(ctx) { _ctx = ctx; }

    function getState() { return _ctx?.getState?.() || {}; }

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
        return `<section class="df-phase">
            <h3 class="df-phase-title">Phase 1 — Ship Report <span class="df-urgent">URGENT</span></h3>
            <div class="df-grid">
                ${fieldInput('to_company', 'To', row.to_company, { readonly })}
                ${fieldInput('case_no', 'Ref No', row.case_no, { readonly: true })}
                ${fieldInput('ship_name', "Ship's Name", row.ship_name, { readonly })}
                ${fieldInput('report_date', 'Date', row.report_date, { type: 'date', readonly })}
                ${fieldInput('pms_group_no', 'PMS GROUP NO', row.pms_group_no, { readonly })}
                ${fieldInput('pms_job_code', 'PMS JOB CODE', row.pms_job_code, { readonly })}
                ${fieldInput('last_maintenance_date', 'Last maintenance date', row.last_maintenance_date, { type: 'date', readonly })}
                ${fieldInput('rh_since_last_maintenance', 'RH since last maintenance', row.rh_since_last_maintenance, { readonly })}
                ${fieldInput('expect_date_place', 'Expect date & place', row.expect_date_place, { span: 2, readonly })}
                ${fieldInput('machinery_name', 'Machinery name', row.machinery_name, { span: 2, readonly })}
                ${fieldInput('manufacturer', 'Manufacturer', row.manufacturer, { readonly })}
                ${fieldInput('type_model_serial', 'Type / Model / Serial No.', row.type_model_serial, { readonly })}
                ${fieldInput('outline_maintenance_request', 'Outline of Maintenance Request', row.outline_maintenance_request, { span: 2, textarea: true, rows: 3, readonly })}
                ${fieldInput('estimated_cause', 'Estimated cause of Trouble', row.estimated_cause, { span: 2, textarea: true, rows: 2, readonly })}
                ${fieldInput('possible_effect', 'Possible effect to other system', row.possible_effect, { span: 2, textarea: true, rows: 2, readonly })}
                ${fieldInput('action_taken', 'Action taken / Corrective Action', row.action_taken, { span: 2, textarea: true, rows: 3, readonly })}
                ${fieldInput('chief_engineer', 'C/E', row.chief_engineer, { readonly })}
                ${fieldInput('master', 'Master', row.master, { readonly })}
            </div>
        </section>`;
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
            <div class="df-titlebar">DEFECT (TROUBLE) REPORT — ${esc(row.case_no)}
                <span class="df-status-pill tone-${statusTone(row.status)}">${esc(statusLabel(row.status))}</span>
            </div>
            <div class="df-modal-scroll">
                ${renderPhase1(row, !canEditP1)}
                ${renderPhase2(row, !canEditP2)}
                ${renderPhase3(row, !canEditP3)}
                ${renderPhase4(row, !canEditP4)}
            </div>
            <div class="modal-actions df-modal-actions">
                <button type="button" class="btn" onclick="TVC_DefectReport.printCase('${esc(row.id)}')">🖨 Print / PDF</button>
                ${canEditP1 ? `<button type="button" class="btn" onclick="TVC_DefectReport.saveDraft()">Save Draft</button>` : ''}
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
                <button type="button" class="btn btn-ghost" onclick="TVC_DefectReport.closeModal()">Close</button>
            </div>
        </div>`;
    }

    function captureForm() {
        const host = document.getElementById('defectReportBody');
        if (!host) return {};
        const data = {};
        host.querySelectorAll('[data-df]').forEach(el => {
            const key = el.dataset.df;
            if (el.type === 'radio') return;
            if (el.type === 'checkbox') data[key] = el.checked;
            else data[key] = el.value;
        });
        host.querySelectorAll('input[type=radio][data-df]:checked').forEach(el => {
            const key = el.dataset.df;
            if (key === 'dp_closed_satisfactory') {
                data[key] = el.value === 'true';
            } else {
                data[key] = el.value;
            }
        });
        return data;
    }

    async function openCase(id, mode) {
        const row = await TVC_DefectCaseService.get(id);
        if (!row) return alert('Case not found.');
        getState()._defectCaseId = id;
        getState()._defectMode = mode || 'view';
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
        row.type_model_serial = [hdr.model, hdr.serialNo].filter(Boolean).join(' / ') || row.type_model_serial;
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
        getState()._defectCaseId = null;
    }

    return {
        init, renderInbox, renderTab, openCase, openNewFromJob, openNewBlank,
        saveDraft, submitCase, saveHqReply, saveShipPhase3, saveHqPhase4, startWork,
        printCase, closeModal, captureForm,
        filteredCases, statusLabel,
    };
})();

if (typeof window !== 'undefined') window.TVC_DefectReport = TVC_DefectReport;
