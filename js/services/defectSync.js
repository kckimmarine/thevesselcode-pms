/* Defect Case — Urgent Export (DEFECT_URGENT_TO_HQ) + HQ Reply (DEFECT_REPLY_HQ_TO_SHIP) */
const TVC_DefectSync = (function () {
    const now = () => new Date().toISOString();

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function chk(v) { return v ? '☑' : '☐'; }

    /** 서식 기반 인쇄/PDF용 HTML (브라우저 print → Save as PDF) */
    function buildPrintHtml(row, vesselName) {
        const ship = esc(row.ship_name || vesselName || '—');
        const p2 = row.status === TVC_DefectCase.Status.COMPANY_REVIEWED
            || row.status === TVC_DefectCase.Status.WORK_IN_PROGRESS
            || row.status === TVC_DefectCase.Status.AWAITING_COMPLETION
            || row.status === TVC_DefectCase.Status.CLOSED;
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Defect Report ${esc(row.case_no)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 16px; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 4px; letter-spacing: 0.5px; }
  h2 { font-size: 12px; margin: 14px 0 6px; border-bottom: 1px solid #333; padding-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  td, th { border: 1px solid #333; padding: 4px 6px; vertical-align: top; }
  th { background: #f0f4f8; text-align: left; width: 28%; font-weight: 600; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 10px; }
  .phase { page-break-inside: avoid; }
  .checks span { margin-right: 14px; }
  .sig-row td { height: 28px; }
  @media print { body { margin: 10mm; } }
</style></head><body>
<div class="meta">
  <div><b>To:</b> ${esc(row.to_company)}</div>
  <div><b>Ref No:</b> ${esc(row.case_no)}</div>
</div>
<h1>DEFECT REPORT</h1>
<div class="meta">
  <div><b>Ship Name:</b> ${ship}</div>
  <div><b>Date:</b> ${esc(row.report_date)}</div>
</div>

<div class="phase">
<h2>Phase 1 — Ship Report (Urgent)</h2>
<table>
  <tr><th>PMS GROUP NO</th><td>${esc(row.pms_group_no)}</td><th>PMS JOB CODE</th><td>${esc(row.pms_job_code)}</td></tr>
  <tr><th>Last maintenance date</th><td>${esc(row.last_maintenance_date)}</td><th>RH since last maint.</th><td>${esc(row.rh_since_last_maintenance)}</td></tr>
  <tr><th>Expect date &amp; place</th><td colspan="3">${esc(row.expect_date_place)}</td></tr>
  <tr><th>Machinery name</th><td colspan="3">${esc(row.machinery_name)}</td></tr>
  <tr><th>Manufacturer</th><td>${esc(row.manufacturer)}</td><th>Type / Model / Serial No.</th><td>${esc(row.type_model_serial)}</td></tr>
  <tr><th>Outline of Defect</th><td colspan="3">${esc(row.outline_maintenance_request)}</td></tr>
  <tr><th>Estimated Cause of Defect</th><td colspan="3">${esc(row.estimated_cause)}</td></tr>
  <tr><th>Possible Effect to Other System</th><td colspan="3">${esc(row.possible_effect)}</td></tr>
  <tr><th>Action Plan / Corrective Action</th><td colspan="3">${esc(row.action_taken)}</td></tr>
  <tr class="sig-row"><th>C/E</th><td>${esc(row.chief_engineer)}</td><th>Master</th><td>${esc(row.master)}</td></tr>
</table>
</div>

<div class="phase">
<h2>Phase 2 — Company Initial Reply / Permit to Work (Urgent)</h2>
<table>
  <tr><th>Initial Reply from Company</th><td colspan="3">${p2 ? esc(row.company_initial_reply) : '<i>Awaiting company review</i>'}</td></tr>
  <tr><th>Permit to Work (Unplanned Maint.)</th><td colspan="3">${p2 ? esc(row.permit_to_work) : '—'}</td></tr>
  <tr><th>Reply by / Date</th><td>${p2 ? esc(row.reply_by) : '—'}</td><td colspan="2">${p2 ? esc(row.reply_date) : ''}</td></tr>
  <tr><th>Require to report to</th><td colspan="3" class="checks">
    <span>${chk(row.report_to_class)} Class</span>
    <span>${chk(row.report_to_flag)} Flag</span>
    <span>${chk(row.report_to_external_stakeholder)} External Stakeholder</span>
    <span>${chk(row.report_to_psc)} PSC</span>
    <span>${chk(row.report_na)} N/A</span>
  </td></tr>
</table>
</div>

<div class="phase">
<h2>Phase 3 — Verified by Ship (After defect cleared)</h2>
<table>
  <tr><th>Verification</th><td colspan="3">${esc(row.ship_verified_after_clear) || '—'}</td></tr>
  <tr><th>Verified by / Date</th><td>${esc(row.ship_verified_by) || '—'}</td><td colspan="2">${esc(row.ship_verified_date) || ''}</td></tr>
</table>
</div>

<div class="phase">
<h2>Phase 4 — Closed out reply from Company D.P.</h2>
<table>
  <tr><th>Preventive measures (MTT)</th><td colspan="3">${esc(row.preventive_measures) || '—'}</td></tr>
  <tr><th>Satisfactory / Unsatisfactory</th><td colspan="3">${
    row.dp_closed_satisfactory === true ? '☑ Satisfactory' :
    row.dp_closed_satisfactory === false ? '☑ Unsatisfactory' : '—'
}</td></tr>
  <tr><th>Reply by / Date</th><td>${esc(row.dp_closed_by) || '—'}</td><td colspan="2">${esc(row.dp_closed_date) || ''}</td></tr>
</table>
</div>
</body></html>`;
    }

    function openPrintWindow(html, title) {
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
        w.document.title = title || 'Defect Report';
        w.focus();
        setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
    }

    function buildBatchUrgentPayload(user, rows, vesselId) {
        const primary = rows[0];
        return {
            export_meta: {
                vessel_id: vesselId,
                company_id: (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId) ? TVC_Sync.licensedCompanyId() : 'DAEMYUNG',
                export_date: now().slice(0, 10),
                direction: 'DEFECT_URGENT_TO_HQ',
                package_type: 'DEFECT_CASE',
                urgency: 'IMMEDIATE',
                department: primary?.department || user?.department || 'ALL',
                exported_by: user?.username || '',
                schema_version: TVC_DefectCase.SCHEMA_VERSION,
                record_count: rows.length,
            },
            defect_cases: rows,
        };
    }

    async function buildUrgentPayload(user, caseRow) {
        const vesselId = await resolveVesselId(user, caseRow);
        return buildBatchUrgentPayload(user, [caseRow], vesselId);
    }

    async function buildHqReplyPayload(user, caseRow) {
        const vesselId = caseRow.vessel_id || 'UNKNOWN';
        return buildBatchHqReplyPayload(user, [caseRow], vesselId);
    }

    async function resolveVesselId(user, row) {
        return row?.vessel_id
            || await TVC_DefectCaseService.resolveVesselId(user)
            || (typeof TVC_Sync !== 'undefined'
                ? await TVC_Sync.resolveExpectedVesselId(user, TVC_RBAC.isHqAccount(user))
                : null)
            || user?.vessel_id
            || 'UNKNOWN';
    }

    /** scope: engine | deck | hub | engine_hq | deck_hq (HQ reply) */
    function resolveExportScope(user, department, { hqReply = false } = {}) {
        if (TVC_RBAC.isHqAccount(user)) {
            if (hqReply) {
                const dept = department
                    || (typeof TVC_App !== 'undefined' ? TVC_App.getAppDepartment?.() : null)
                    || user?.department;
                if (typeof TVC_Filename !== 'undefined') {
                    return TVC_Filename.hqReplyScopeToken(dept);
                }
                const d = String(dept || '').trim().toUpperCase();
                return d === 'DECK' ? 'deck_hq' : 'engine_hq';
            }
            return 'hq';
        }
        if (typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)) {
            const dept = department
                || (typeof TVC_App !== 'undefined' ? TVC_App.getAppDepartment?.() : null)
                || user?.department;
            if (typeof TVC_Filename !== 'undefined') {
                return TVC_Filename.scopeToken(dept, false);
            }
            const d = String(dept || '').trim().toUpperCase();
            if (d === 'DECK') return 'deck';
            return 'engine';
        }
        if (typeof TVC_Filename !== 'undefined') {
            return TVC_Filename.scopeToken(department || user?.department, false);
        }
        const d = String(department || user?.department || '').trim().toUpperCase();
        if (d === 'DECK') return 'deck';
        if (d === 'ENGINE') return 'engine';
        return 'engine';
    }

    async function buildExportFilename(user, vesselId, department, { hqReply = false } = {}) {
        const scope = resolveExportScope(user, department, { hqReply });
        if (typeof TVC_Filename === 'undefined') {
            const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            return `${String(vesselId || 'unknown').toLowerCase()}_defect_${scope}_${dateTag}_001.zip`;
        }
        return TVC_Filename.build({
            vesselId,
            type: 'defect',
            scope,
            ext: 'zip',
        });
    }

    function buildBatchHqReplyPayload(user, rows, vesselId) {
        const primary = rows[0];
        return {
            export_meta: {
                vessel_id: vesselId,
                company_id: (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId) ? TVC_Sync.licensedCompanyId() : 'DAEMYUNG',
                export_date: now().slice(0, 10),
                direction: 'DEFECT_REPLY_HQ_TO_SHIP',
                package_type: 'DEFECT_CASE_REPLY',
                department: primary?.department || user?.department || 'ALL',
                exported_by: user?.username || '',
                schema_version: TVC_DefectCase.SCHEMA_VERSION,
                record_count: rows.length,
            },
            defect_cases: rows,
        };
    }

    async function loadDefectHqReplyBatch(caseIds, opts = {}) {
        const ids = (caseIds || []).filter(Boolean);
        if (!ids.length) throw new Error('No defect reports selected.');
        const hubForward = !!opts.hubForward;
        const rows = [];
        for (const id of ids) {
            const row = await TVC_DefectCaseService.get(id);
            if (!row) throw new Error('Defect case not found.');
            if (!hubForward && TVC_DefectCase.isHqReplyExported(row)) {
                throw new Error(`${row.case_no}: HQ reply already exported.`);
            }
            if (hubForward && !TVC_DefectCase.isHqReplyStationForwardPending(row)) {
                throw new Error(`${row.case_no}: HQ reply already forwarded to Station.`);
            }
            if (!hubForward) {
                const v = TVC_DefectCase.validateHqDefectReplyExport(row);
                if (!v.ok) {
                    throw new Error(`${row.case_no}: ${v.missing.join(', ')} required before HQ export.`);
                }
            }
            rows.push(row);
        }
        return rows;
    }

    async function finalizeHqReplyRows(user, rows) {
        for (const row of rows) {
            row.status = TVC_DefectCase.Status.COMPANY_REVIEWED;
            row.phase2_locked = true;
            row.hq_reply_exported_at = now();
            row.reply_date = row.reply_date || now().slice(0, 10);
            row.reply_by = row.reply_by || TVC_RBAC.getRankLabel(user);
            await TVC_DB.put('defect_cases', row);
        }
    }

    async function saveBatchHqReplyExport(user, rows, payload, filename) {
        const ts = now();
        for (const row of rows) {
            row.sync_status = 'SYNCED';
            row.last_synced_at = ts;
            row.last_export_filename = filename;
            await TVC_DB.put('defect_cases', row);
        }
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📦 [Defect/HQ Reply Export] ${filename} (${rows.length} item(s))`,
            sync_status: 'SYNCED',
        });
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'DEFECT_REPLY_HQ_TO_SHIP',
                department: payload.export_meta?.department || 'ALL',
                vessel_id: payload.export_meta?.vessel_id,
                filename,
                ref_key: filename,
                record_count: rows.length,
                status: 'SUCCESS',
                space: 'HQ',
            });
        }
    }

    async function exportHqReplyBatchZip(user, caseIds, opts = {}) {
        const hubForward = !!opts.hubForward;
        const rows = await loadDefectHqReplyBatch(caseIds, { hubForward });
        if (!hubForward) await finalizeHqReplyRows(user, rows);
        const vesselId = await resolveVesselId(user, rows[0]);
        const payload = buildBatchHqReplyPayload(user, rows, vesselId);
        const filename = await buildExportFilename(user, vesselId, rows[0]?.department, { hqReply: true });
        const zip = new JSZip();
        zip.file('defect_case_reply.json', JSON.stringify(payload, null, 2));
        rows.forEach(row => {
            zip.file(`DEFECT_REPLY_${row.case_no}.html`, buildPrintHtml(row, row.ship_name));
        });
        zip.file('README.txt',
            `TVC-PMS Defect HQ Reply\nVessel: ${vesselId}\nScope: ${resolveExportScope(user, rows[0]?.department, { hqReply: true })}\nItems: ${rows.length}\nDirection: DEFECT_REPLY_HQ_TO_SHIP\n\nFilename: ${filename}`);

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);
        await saveBatchHqReplyExport(user, rows, payload, filename);
        if (hubForward) {
            for (const row of rows) {
                TVC_DefectCase.stampHqReplyStationForwarded(row);
                await TVC_DB.put('defect_cases', row);
            }
        }
        return { payload, filename, count: rows.length };
    }

    async function exportHqReplyZip(user, caseId) {
        return exportHqReplyBatchZip(user, [caseId]);
    }

    async function loadDefectUrgentBatch(caseIds, user) {
        const ids = (caseIds || []).filter(Boolean);
        if (!ids.length) throw new Error('No defect reports selected.');
        const isHub = typeof TVC_HubRelay !== 'undefined' && user && TVC_HubRelay.isHubRelayExport(user);
        const rows = [];
        for (const id of ids) {
            const row = await TVC_DefectCaseService.get(id);
            if (!row) throw new Error('Defect case not found.');
            const st = TVC_DefectCase.listWorkflowStatus(row);
            if (isHub) {
                if (!TVC_HubRelay.canHubLegExport(row)) {
                    throw new Error(`${row.case_no}: ${TVC_HubRelay.hubExportBlockedTitle()}.`);
                }
                if (st !== 'Submitted') {
                    throw new Error(`${row.case_no}: awaiting station export first.`);
                }
            } else {
                if (st !== 'Confirmed') {
                    throw new Error(`${row.case_no}: only Confirmed cases can be exported.`);
                }
                if (row.status === TVC_DefectCase.Status.WORK_IN_PROGRESS) {
                    throw new Error(`${row.case_no}: complete defect clearance before export.`);
                }
                if (!TVC_HubRelay.canStationLegExport(row)) {
                    throw new Error(`${row.case_no}: already exported (Submitted).`);
                }
            }
            rows.push(row);
        }
        return rows;
    }

    async function saveBatchUrgentExport(user, rows, payload, filename) {
        const ts = now();
        for (const row of rows) {
            if (typeof TVC_HubRelay !== 'undefined') {
                TVC_HubRelay.stampExport(user, row);
            } else {
                row.sync_status = 'SYNCED';
            }
            row.last_synced_at = ts;
            row.last_export_filename = filename;
            await TVC_DB.put('defect_cases', row);
        }
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📦 [Defect Export] ${filename} (${rows.length} item(s))`,
            sync_status: 'SYNCED',
        });
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'DEFECT_URGENT_TO_HQ',
                department: payload.export_meta?.department || 'ALL',
                vessel_id: payload.export_meta?.vessel_id,
                filename,
                ref_key: filename,
                record_count: rows.length,
                status: 'SUCCESS',
                space: TVC_RBAC.isHqAccount(user) ? 'HQ' : 'SHIP',
            });
        }
    }

    async function exportUrgentBatchZip(user, caseIds) {
        await loadDefectUrgentBatch(caseIds, user);
        for (const id of caseIds) {
            const row = await TVC_DefectCaseService.get(id);
            if (row && row.status !== TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) {
                await TVC_DefectCaseService.submitToCompany(user, id);
            }
        }
        const rows = await Promise.all(caseIds.map(id => TVC_DefectCaseService.get(id))).then(list => list.filter(Boolean));
        if (!rows.length) throw new Error('Defect case not found.');
        const vesselId = await resolveVesselId(user, rows[0]);
        const payload = buildBatchUrgentPayload(user, rows, vesselId);
        const filename = await buildExportFilename(user, vesselId, rows[0]?.department, { hqReply: false });
        const zip = new JSZip();
        zip.file('defect_case.json', JSON.stringify(payload, null, 2));
        rows.forEach(row => {
            zip.file(`DEFECT_${row.case_no}.html`, buildPrintHtml(row, row.ship_name));
        });
        zip.file('README.txt',
            `TVC-PMS Defect Report Export\nVessel: ${vesselId}\nScope: ${resolveExportScope(user, rows[0]?.department)}\nItems: ${rows.length}\nDirection: DEFECT_URGENT_TO_HQ\n\nFilename: ${filename}`);

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);
        await saveBatchUrgentExport(user, rows, payload, filename);
        return { payload, filename, count: rows.length };
    }

    async function exportUrgentZip(user, caseId) {
        return exportUrgentBatchZip(user, [caseId]);
    }

    async function buildCompletionPayload(user, caseRow) {
        const vesselId = caseRow.vessel_id
            || await TVC_DefectCaseService.resolveVesselId(user)
            || 'UNKNOWN';
        const maintenance_jobs = [];
        if (typeof TVC_Transaction !== 'undefined' && TVC_Transaction.resolveDefectScheduleTargets) {
            const allJobs = await TVC_DB.getAll('maintenance_jobs').catch(() => []);
            const seen = new Set();
            for (const t of TVC_Transaction.resolveDefectScheduleTargets(caseRow)) {
                const job = (t.jobId && allJobs.find(j => j.id === t.jobId))
                    || (t.jobCode && allJobs.find(j => j.job_code === t.jobCode))
                    || null;
                if (job && !seen.has(job.id)) {
                    seen.add(job.id);
                    maintenance_jobs.push(job);
                }
            }
        }
        return {
            export_meta: {
                vessel_id: vesselId,
                company_id: (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId) ? TVC_Sync.licensedCompanyId() : 'DAEMYUNG',
                export_date: now().slice(0, 10),
                direction: 'DEFECT_COMPLETION_TO_HQ',
                package_type: 'DEFECT_CASE_COMPLETION',
                case_no: caseRow.case_no,
                department: caseRow.department || user?.department || 'ALL',
                exported_by: user?.username || '',
                schema_version: TVC_DefectCase.SCHEMA_VERSION,
            },
            defect_cases: [caseRow],
            maintenance_jobs,
        };
    }

    async function buildClosePayload(user, caseRow) {
        const vesselId = caseRow.vessel_id || 'UNKNOWN';
        return {
            export_meta: {
                vessel_id: vesselId,
                company_id: (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId) ? TVC_Sync.licensedCompanyId() : 'DAEMYUNG',
                export_date: now().slice(0, 10),
                direction: 'DEFECT_CLOSE_HQ_TO_SHIP',
                package_type: 'DEFECT_CASE_CLOSE',
                case_no: caseRow.case_no,
                exported_by: user?.username || '',
                schema_version: TVC_DefectCase.SCHEMA_VERSION,
            },
            defect_cases: [caseRow],
        };
    }

    async function exportCompletionZip(user, caseId) {
        const row = await TVC_DefectCaseService.get(caseId);
        if (!row) throw new Error('Defect case not found.');
        const completionReady = row.status === TVC_DefectCase.Status.AWAITING_COMPLETION
            || (row.status === TVC_DefectCase.Status.CLOSED && row.defect_cleared && row.phase3_locked);
        if (!completionReady) {
            throw new Error('Complete Phase 3 (DEFECT CLEARED) before export.');
        }
        const isHub = typeof TVC_HubRelay !== 'undefined' && TVC_HubRelay.isHubRelayExport(user);
        if (isHub && !TVC_HubRelay.canHubLegExport(row) && !TVC_DefectCase.isPhase3CompletionHubPending(row)) {
            throw new Error(`${row.case_no}: ${TVC_HubRelay.hubExportBlockedTitle()}.`);
        }
        TVC_DefectCase.clearHubStampForNewOutbound(row);
        if (!isHub && typeof TVC_HubRelay !== 'undefined') {
            TVC_HubRelay.stampStationExport(row);
        }
        const payload = await buildCompletionPayload(user, row);
        const vesselId = payload.export_meta.vessel_id;
        const filename = await buildExportFilename(user, vesselId, row.department, { hqReply: false });
        const html = buildPrintHtml(row, row.ship_name);
        const zip = new JSZip();
        zip.file('defect_case_completion.json', JSON.stringify(payload, null, 2));
        zip.file(`DEFECT_COMPLETION_${row.case_no}.html`, html);
        zip.file('README.txt', `TVC-PMS Defect Completion Report\nCase: ${row.case_no}\nDirection: DEFECT_COMPLETION_TO_HQ\n\nFilename: ${filename}`);

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);

        if (typeof TVC_HubRelay !== 'undefined') {
            TVC_HubRelay.stampExport(user, row);
        } else {
            row.sync_status = 'SYNCED';
        }
        row.last_synced_at = now();
        row.last_export_filename = filename;
        row.completion_exported_at = now();
        await TVC_DB.put('defect_cases', row);
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'DEFECT_COMPLETION_TO_HQ',
                department: row.department || 'ALL',
                vessel_id: payload.export_meta.vessel_id,
                filename,
                ref_key: filename,
                record_count: 1,
                status: 'SUCCESS',
                space: TVC_RBAC.isHqAccount(user) ? 'HQ' : 'SHIP',
            });
        }
        return { payload, filename };
    }

    async function exportCloseZip(user, caseId) {
        const row = await TVC_DefectCaseService.get(caseId);
        if (!row) throw new Error('Defect case not found.');
        if (row.status !== TVC_DefectCase.Status.CLOSED) {
            throw new Error('HQ Phase 4 must be completed before close export.');
        }
        const isHub = typeof TVC_HubRelay !== 'undefined' && TVC_HubRelay.isHubRelayExport(user);
        const isStation = typeof TVC_Space !== 'undefined' && TVC_Space.isStationPc(user);
        if (isStation) {
            throw new Error('Station cannot export HQ close-out. Import the Master-forwarded close ZIP.');
        }
        if (isHub) {
            if (!TVC_DefectCase.isPhase4CloseForwardPending(row)) {
                throw new Error(`${row.case_no}: already forwarded to Station, or HQ close ZIP not imported yet.`);
            }
            TVC_DefectCase.stampPhase4CloseForwarded(row);
        }
        const payload = await buildClosePayload(user, row);
        const exportDate = now().slice(0, 10).replace(/-/g, '');
        const html = buildPrintHtml(row, row.ship_name);
        const zip = new JSZip();
        zip.file('defect_case_close.json', JSON.stringify(payload, null, 2));
        zip.file(`DEFECT_CLOSE_${row.case_no}.html`, html);
        zip.file('README.txt', `TVC-PMS Defect Close-out\nCase: ${row.case_no}\nDirection: DEFECT_CLOSE_HQ_TO_SHIP`);

        const filename = `${payload.export_meta.vessel_id}_DEFECT_CLOSE_${row.case_no}_${exportDate}.zip`;
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);

        row.sync_status = 'SYNCED';
        row.last_synced_at = now();
        await TVC_DB.put('defect_cases', row);
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'DEFECT_CLOSE_HQ_TO_SHIP',
                department: row.department || 'ALL',
                vessel_id: payload.export_meta.vessel_id,
                filename,
                case_no: row.case_no,
                record_count: 1,
                status: 'SUCCESS',
                space: isHub ? 'SHIP' : 'HQ',
            });
        }
        return { payload, filename };
    }

    async function applyDefectRelayAfterImport(payload, { isHq, isHub }) {
        const direction = payload?.export_meta?.direction;
        const rows = payload?.defect_cases || [];
        if (!rows.length || !direction) return;
        for (const incoming of rows) {
            if (!incoming?.id) continue;
            const row = await TVC_DB.get('defect_cases', incoming.id);
            if (!row) continue;
            if (isHub && direction === 'DEFECT_COMPLETION_TO_HQ') {
                TVC_DefectCase.clearHubStampForNewOutbound(row);
                row.sync_status = 'SYNCED';
                await TVC_DB.put('defect_cases', row);
            } else if (!isHq && (direction === 'DEFECT_REPLY_HQ_TO_SHIP' || direction === 'HQ_TO_SHIP')) {
                if (row.approved_at || row.approved_by) {
                    if (typeof TVC_DefectCase.applyHqReplyOnShip === 'function') {
                        TVC_DefectCase.applyHqReplyOnShip(row);
                    }
                    if (isHub && !row.hq_reply_forwarded_at) {
                        row.hq_reply_forward_pending = true;
                    }
                    await TVC_DB.put('defect_cases', row);
                }
            } else if (isHub && direction === 'DEFECT_CLOSE_HQ_TO_SHIP') {
                TVC_DefectCase.markPhase4CloseForwardPending(row);
                await TVC_DB.put('defect_cases', row);
            } else if (!isHq && !isHub && direction === 'DEFECT_CLOSE_HQ_TO_SHIP') {
                row.close_forward_pending = false;
                await TVC_DB.put('defect_cases', row);
            }
        }
    }

    async function importPackage(user, file) {
        const buf = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(buf);
        const jsonName = ['defect_case.json', 'defect_case_reply.json', 'defect_case_completion.json', 'defect_case_close.json']
            .find(n => zip.file(n));
        if (!jsonName) throw new Error('Invalid defect package: missing defect JSON');
        const text = await zip.file(jsonName).async('string');
        const payload = JSON.parse(text);
        const direction = payload.export_meta?.direction;
        const isHq = TVC_RBAC.isHqAccount(user);
        const isHub = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user);

        const HQ_ONLY = new Set(['DEFECT_URGENT_TO_HQ', 'DEFECT_COMPLETION_TO_HQ']);
        const SHIP_ONLY = new Set(['DEFECT_REPLY_HQ_TO_SHIP', 'DEFECT_CLOSE_HQ_TO_SHIP']);
        if (HQ_ONLY.has(direction) && !isHq && !isHub) {
            throw new Error('This defect package is for HQ or Master Hub import only.');
        }
        if (SHIP_ONLY.has(direction) && isHq) {
            throw new Error('This defect package is for ship import only.');
        }

        TVC_Sync.validateImportPackageScope(user, file, payload);

        const expectedVesselId = await TVC_Sync.resolveExpectedVesselId(user, isHq);
        const importVesselId = payload.export_meta?.vessel_id;
        const vCheck = TVC_Sync.validateImportVesselId(expectedVesselId, importVesselId, isHq);
        if (!vCheck.ok) throw new Error(vCheck.message);
        const companyId = payload.export_meta?.company_id || TVC_Sync.licensedCompanyId();
        const lic = TVC_Sync.assertLicenseForPackage(importVesselId, companyId);
        if (!lic.ok) throw new Error(lic.error || 'License does not allow this import.');

        await TVC_Sync.mergePayload(payload, null, isHq, importVesselId, { importAuthoritative: true });
        await applyDefectRelayAfterImport(payload, { isHq, isHub });

        if (typeof TVC_Sync.recordSyncHistory !== 'undefined') {
            await TVC_Sync.recordSyncHistory({
                type: 'IMPORT',
                direction: direction || 'DEFECT_IMPORT',
                department: payload.export_meta?.department || 'ALL',
                vessel_id: importVesselId || '—',
                filename: file.name || '(defect)',
                record_count: payload.defect_cases?.length || 0,
                status: 'SUCCESS',
                space: isHq ? 'HQ' : 'SHIP',
            });
        }
        return payload;
    }

    async function stampCaseReportExport(user, caseIds, filename) {
        const isHq = TVC_RBAC.isHqAccount(user);
        const isHub = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user) && !isHq;
        const ts = now();
        for (const id of caseIds || []) {
            try {
                let row = await TVC_DefectCaseService.get(id);
                if (!row) continue;
                if (isHq) {
                    if (row.status === TVC_DefectCase.Status.CLOSED && TVC_DefectCase.isHqReplyExported(row)) {
                        row.sync_status = 'SYNCED';
                    } else if (!TVC_DefectCase.isHqReplyExported(row)) {
                        row.status = TVC_DefectCase.Status.COMPANY_REVIEWED;
                        row.phase2_locked = true;
                        row.hq_reply_exported_at = ts;
                        row.reply_date = row.reply_date || ts.slice(0, 10);
                        row.reply_by = row.reply_by || TVC_RBAC.getRankLabel(user);
                    }
                } else {
                    const alreadyForwarded = isHub && !!row.hq_reply_forwarded_at;
                    const completionReady = row.status === TVC_DefectCase.Status.AWAITING_COMPLETION
                        || (row.status === TVC_DefectCase.Status.CLOSED && row.defect_cleared && row.phase3_locked);
                    if (isHub && TVC_DefectCase.isHqReplyStationForwardPending(row)) {
                        TVC_DefectCase.stampHqReplyStationForwarded(row);
                    } else if (alreadyForwarded) {
                        /* Master already stamped HQ-reply forward during Case ZIP */
                    } else if (isHub && TVC_DefectCase.isPhase4CloseForwardPending(row)) {
                        TVC_DefectCase.stampPhase4CloseForwarded(row);
                    } else if (completionReady) {
                        if (typeof TVC_DefectCase.clearHubStampForNewOutbound === 'function') {
                            TVC_DefectCase.clearHubStampForNewOutbound(row);
                        }
                        row.completion_exported_at = ts;
                    } else if (!row.phase1_locked && TVC_DefectCase.listWorkflowStatus(row) === 'Confirmed') {
                        const v = TVC_DefectCase.validatePhase1(row);
                        if (v.ok) {
                            row = await TVC_DefectCaseService.submitToCompany(user, id);
                        }
                    }
                }
                if (typeof TVC_HubRelay !== 'undefined') TVC_HubRelay.stampExport(user, row);
                else row.sync_status = 'SYNCED';
                row.last_synced_at = ts;
                if (filename) row.last_export_filename = filename;
                await TVC_DB.put('defect_cases', row);
            } catch (_) { /* keep Case ZIP; skip a row that cannot be stamped */ }
        }
    }

    return {
        buildPrintHtml, openPrintWindow, exportUrgentZip, exportUrgentBatchZip, exportHqReplyZip, exportHqReplyBatchZip,
        exportCompletionZip, exportCloseZip, importPackage, stampCaseReportExport,
        buildUrgentPayload, buildHqReplyPayload, buildCompletionPayload, buildClosePayload,
        resolveExportScope, buildExportFilename,
    };
})();

if (typeof window !== 'undefined') window.TVC_DefectSync = TVC_DefectSync;
