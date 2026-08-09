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

    async function buildUrgentPayload(user, caseRow) {
        const vesselId = caseRow.vessel_id
            || await TVC_DefectCaseService.resolveVesselId(user)
            || 'UNKNOWN';
        return {
            export_meta: {
                vessel_id: vesselId,
                company_id: (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId) ? TVC_Sync.licensedCompanyId() : 'DAEMYUNG',
                export_date: now().slice(0, 10),
                direction: 'DEFECT_URGENT_TO_HQ',
                package_type: 'DEFECT_CASE',
                urgency: 'IMMEDIATE',
                case_no: caseRow.case_no,
                department: caseRow.department || user?.department || 'ALL',
                exported_by: user?.username || '',
                schema_version: TVC_DefectCase.SCHEMA_VERSION,
            },
            defect_cases: [caseRow],
        };
    }

    async function buildHqReplyPayload(user, caseRow) {
        const vesselId = caseRow.vessel_id || 'UNKNOWN';
        return {
            export_meta: {
                vessel_id: vesselId,
                company_id: (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId) ? TVC_Sync.licensedCompanyId() : 'DAEMYUNG',
                export_date: now().slice(0, 10),
                direction: 'DEFECT_REPLY_HQ_TO_SHIP',
                package_type: 'DEFECT_CASE_REPLY',
                case_no: caseRow.case_no,
                exported_by: user?.username || '',
                schema_version: TVC_DefectCase.SCHEMA_VERSION,
            },
            defect_cases: [caseRow],
        };
    }

    async function exportUrgentZip(user, caseId) {
        const row = await TVC_DefectCaseService.get(caseId);
        if (!row) throw new Error('Defect case not found.');
        if (row.status !== TVC_DefectCase.Status.SUBMITTED_TO_COMPANY) {
            throw new Error('Submit to Company before Urgent Export.');
        }
        const payload = await buildUrgentPayload(user, row);
        const exportDate = now().slice(0, 10).replace(/-/g, '');
        const html = buildPrintHtml(row, row.ship_name);
        const zip = new JSZip();
        zip.file('defect_case.json', JSON.stringify(payload, null, 2));
        zip.file(`DEFECT_${row.case_no}.html`, html);
        zip.file('README.txt',
            `TVC-PMS Urgent Defect Report\nCase: ${row.case_no}\nVessel: ${payload.export_meta.vessel_id}\nDirection: DEFECT_URGENT_TO_HQ\n\nOpen .html → Print → Save as PDF for email attachment.`);

        const filename = `${payload.export_meta.vessel_id}_DEFECT_URGENT_${row.case_no}_${exportDate}.zip`;
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);

        row.sync_status = 'SYNCED';
        row.last_synced_at = now();
        await TVC_DB.put('defect_cases', row);
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📦 [Defect/Urgent Export] ${filename}`,
            sync_status: 'SYNCED',
        });
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'DEFECT_URGENT_TO_HQ',
                department: row.department || 'ALL',
                vessel_id: payload.export_meta.vessel_id,
                filename,
                case_no: row.case_no,
                record_count: 1,
                status: 'SUCCESS',
                space: TVC_RBAC.isHqAccount(user) ? 'HQ' : 'SHIP',
            });
        }
        return { payload, filename };
    }

    async function buildCompletionPayload(user, caseRow) {
        const vesselId = caseRow.vessel_id
            || await TVC_DefectCaseService.resolveVesselId(user)
            || 'UNKNOWN';
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
        if (row.status !== TVC_DefectCase.Status.AWAITING_COMPLETION) {
            throw new Error('Submit Phase 3 (completion) before export.');
        }
        const payload = await buildCompletionPayload(user, row);
        const exportDate = now().slice(0, 10).replace(/-/g, '');
        const html = buildPrintHtml(row, row.ship_name);
        const zip = new JSZip();
        zip.file('defect_case_completion.json', JSON.stringify(payload, null, 2));
        zip.file(`DEFECT_COMPLETION_${row.case_no}.html`, html);
        zip.file('README.txt', `TVC-PMS Defect Completion Report\nCase: ${row.case_no}\nDirection: DEFECT_COMPLETION_TO_HQ`);

        const filename = `${payload.export_meta.vessel_id}_DEFECT_COMPLETION_${row.case_no}_${exportDate}.zip`;
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);

        row.sync_status = 'SYNCED';
        row.last_synced_at = now();
        await TVC_DB.put('defect_cases', row);
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'DEFECT_COMPLETION_TO_HQ',
                department: row.department || 'ALL',
                vessel_id: payload.export_meta.vessel_id,
                filename,
                case_no: row.case_no,
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
                space: 'HQ',
            });
        }
        return { payload, filename };
    }

    async function exportHqReplyZip(user, caseId) {
        const row = await TVC_DefectCaseService.get(caseId);
        if (!row) throw new Error('Defect case not found.');
        if (row.status !== TVC_DefectCase.Status.COMPANY_REVIEWED) {
            throw new Error('HQ Phase 2 must be completed before reply export.');
        }
        const payload = await buildHqReplyPayload(user, row);
        const exportDate = now().slice(0, 10).replace(/-/g, '');
        const html = buildPrintHtml(row, row.ship_name);
        const zip = new JSZip();
        zip.file('defect_case_reply.json', JSON.stringify(payload, null, 2));
        zip.file(`DEFECT_REPLY_${row.case_no}.html`, html);
        zip.file('README.txt', `TVC-PMS Defect HQ Reply\nCase: ${row.case_no}\nDirection: DEFECT_REPLY_HQ_TO_SHIP`);

        const filename = `${payload.export_meta.vessel_id}_DEFECT_REPLY_${row.case_no}_${exportDate}.zip`;
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);

        row.sync_status = 'SYNCED';
        row.last_synced_at = now();
        await TVC_DB.put('defect_cases', row);
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'DEFECT_REPLY_HQ_TO_SHIP',
                department: row.department || 'ALL',
                vessel_id: payload.export_meta.vessel_id,
                filename,
                case_no: row.case_no,
                record_count: 1,
                status: 'SUCCESS',
                space: 'HQ',
            });
        }
        return { payload, filename };
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

        const HQ_ONLY = new Set(['DEFECT_URGENT_TO_HQ', 'DEFECT_COMPLETION_TO_HQ']);
        const SHIP_ONLY = new Set(['DEFECT_REPLY_HQ_TO_SHIP', 'DEFECT_CLOSE_HQ_TO_SHIP']);
        if (HQ_ONLY.has(direction) && !isHq) {
            throw new Error('This defect package is for HQ import only.');
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

    return {
        buildPrintHtml, openPrintWindow, exportUrgentZip, exportHqReplyZip,
        exportCompletionZip, exportCloseZip, importPackage,
        buildUrgentPayload, buildHqReplyPayload, buildCompletionPayload, buildClosePayload,
    };
})();

if (typeof window !== 'undefined') window.TVC_DefectSync = TVC_DefectSync;
