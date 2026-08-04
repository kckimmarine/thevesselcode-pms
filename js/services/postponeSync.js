/* Critical Postpone — Request Export (POSTPONE_REQUEST_TO_HQ) + HQ Reply (POSTPONE_REPLY_HQ_TO_SHIP) */
const TVC_PostponeSync = (function () {
    const SCHEMA_VERSION = '1.0';
    const now = () => new Date().toISOString();

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function reportJobCode(row) {
        TVC_WorkReport.fromLegacy(row);
        const fromItems = (row.job_items || []).map(i => i.job_code).find(Boolean);
        return fromItems || row.job_code || '—';
    }

    /** 서식 기반 인쇄/PDF용 HTML */
    function buildPrintHtml(row, vesselName, job) {
        const ship = esc(row.ship_name || vesselName || '—');
        const form = row.report_form || row.job_items?.[0]?.form || {};
        const jobCode = esc(reportJobCode(row));
        const approved = TVC_RBAC.isApprovedStatus(row.status, row.is_locked);
        const confirmed = TVC_RBAC.isConfirmedStatus(row.status, row.is_locked);
        const postponeDate = esc(row.postpone_date || form.postponeDate || '—');
        const approvedDate = esc(row.approved_postpone_date || '—');
        const hdr = job || {};
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Postpone Report ${jobCode}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 16px; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 4px; letter-spacing: 0.5px; }
  h2 { font-size: 12px; margin: 14px 0 6px; border-bottom: 1px solid #333; padding-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  td, th { border: 1px solid #333; padding: 4px 6px; vertical-align: top; }
  th { background: #f0f4f8; text-align: left; width: 28%; font-weight: 600; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 10px; }
  .banner { background: #fff3cd; border: 1px solid #856404; padding: 6px 10px; margin-bottom: 10px; }
  @media print { body { margin: 10mm; } }
</style></head><body>
<div class="meta">
  <div><b>To:</b> Company (HQ)</div>
  <div><b>Report ID:</b> ${esc(row.id)}</div>
</div>
<h1>CRITICAL EQUIPMENT — POSTPONE REQUEST</h1>
<div class="banner"><b>⚠ Critical Equipment</b> — Company approval required before schedule is finalized.</div>
<div class="meta">
  <div><b>Ship Name:</b> ${ship}</div>
  <div><b>Report Date:</b> ${esc(row.report_date || '—')}</div>
</div>

<div class="phase">
<h2>Phase 1 — Ship Postpone Request</h2>
<table>
  <tr><th>PMS Group No.</th><td>${esc(form.pmsGroupNo || hdr.group || '—')}</td><th>Job Code</th><td>${jobCode}</td></tr>
  <tr><th>SORT-1</th><td>${esc(hdr.item_sort1 || '—')}</td><th>SORT-2</th><td>${esc(hdr.item_sort2 || '—')}</td></tr>
  <tr><th>Job Detail</th><td colspan="3">${esc(hdr.job_detail || row.description || '—')}</td></tr>
  <tr><th>Maker</th><td>${esc(form.maker || '—')}</td><th>Model / Type</th><td>${esc(form.modelType || '—')}</td></tr>
  <tr><th>Original Due Date</th><td>${esc(hdr.next_date || '—')}</td><th>Requested Postpone Date</th><td>${postponeDate}</td></tr>
  <tr><th>Last Maintenance Date</th><td>${esc(form.lastMaintDate || '—')}</td><th>Total Run Hrs</th><td>${esc(form.runHrs || '—')}</td></tr>
  <tr><th>Ship's Comments (Reason)</th><td colspan="3">${esc(form.shipComments || row.description || '—')}</td></tr>
  <tr><th>Reported by</th><td>${esc(row.reporter_name || '—')}</td><th>Confirmed by</th><td>${confirmed ? esc(row.confirmed_at?.slice(0, 10) || 'Yes') : '<i>Pending</i>'}</td></tr>
</table>
</div>

<div class="phase">
<h2>Phase 2 — Company Approval</h2>
<table>
  <tr><th>Approved Postpone Date</th><td colspan="3">${approved ? approvedDate : '<i>Awaiting company approval</i>'}</td></tr>
  <tr><th>Company Comment</th><td colspan="3">${approved ? esc(row.company_comment || '—') : '—'}</td></tr>
  <tr><th>Approved by / Date</th><td>${approved ? 'Company' : '—'}</td><td colspan="2">${approved ? esc(row.approved_at?.slice(0, 10) || '') : ''}</td></tr>
</table>
</div>
</body></html>`;
    }

    function openPrintWindow(html, title) {
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
        w.document.title = title || 'Postpone Report';
        w.focus();
        setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
    }

    async function resolveVesselId(user, row) {
        return row.vessel_id
            || await TVC_Sync.resolveExpectedVesselId(user, TVC_RBAC.isHqAccount(user))
            || user?.vessel_id
            || 'UNKNOWN';
    }

    async function buildRequestPayload(user, reportRow, job) {
        const vesselId = await resolveVesselId(user, reportRow);
        return {
            export_meta: {
                vessel_id: vesselId,
                company_id: (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId) ? TVC_Sync.licensedCompanyId() : 'DAEMYUNG',
                export_date: now().slice(0, 10),
                direction: 'POSTPONE_REQUEST_TO_HQ',
                package_type: 'POSTPONE_REPORT',
                report_id: reportRow.id,
                job_code: reportJobCode(reportRow),
                department: job?.department || reportRow.department || user?.department || 'ALL',
                exported_by: user?.username || '',
                schema_version: SCHEMA_VERSION,
            },
            daily_work_reports: [reportRow],
            maintenance_jobs: job ? [job] : [],
        };
    }

    async function buildHqReplyPayload(user, reportRow, job) {
        const vesselId = reportRow.vessel_id || await resolveVesselId(user, reportRow);
        return {
            export_meta: {
                vessel_id: vesselId,
                company_id: (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId) ? TVC_Sync.licensedCompanyId() : 'DAEMYUNG',
                export_date: now().slice(0, 10),
                direction: 'POSTPONE_REPLY_HQ_TO_SHIP',
                package_type: 'POSTPONE_REPORT_REPLY',
                report_id: reportRow.id,
                job_code: reportJobCode(reportRow),
                exported_by: user?.username || '',
                schema_version: SCHEMA_VERSION,
            },
            daily_work_reports: [reportRow],
            maintenance_jobs: job ? [job] : [],
        };
    }

    async function loadReportContext(reportId) {
        const row = await TVC_DB.get('daily_work_reports', reportId);
        if (!row) throw new Error('Postpone report not found.');
        TVC_WorkReport.fromLegacy(row);
        if (row.work_type !== 'POSTPONE') throw new Error('Not a postpone report.');
        if (!row.requires_company_approval) throw new Error('Only critical postpone reports require company export.');
        const jobId = row.job_items?.[0]?.maintenance_job_id;
        const job = jobId ? await TVC_DB.get('maintenance_jobs', jobId) : null;
        return { row, job };
    }

    async function exportRequestZip(user, reportId) {
        const { row, job } = await loadReportContext(reportId);
        if (!TVC_RBAC.isConfirmedStatus(row.status, row.is_locked)) {
            throw new Error('Confirm the postpone report before export.');
        }
        if (row.sync_status === 'SYNCED') {
            throw new Error('Already exported (Submitted).');
        }
        const payload = await buildRequestPayload(user, row, job);
        const exportDate = now().slice(0, 10).replace(/-/g, '');
        const jobCode = reportJobCode(row).replace(/[^\w.-]+/g, '_');
        const html = buildPrintHtml(row, row.ship_name, job);
        const zip = new JSZip();
        zip.file('postpone_report.json', JSON.stringify(payload, null, 2));
        zip.file(`POSTPONE_${jobCode}.html`, html);
        zip.file('README.txt',
            `TVC-PMS Critical Postpone Request\nJob: ${reportJobCode(row)}\nVessel: ${payload.export_meta.vessel_id}\nDirection: POSTPONE_REQUEST_TO_HQ\n\nOpen .html → Print → Save as PDF for email attachment.`);

        const filename = `${payload.export_meta.vessel_id}_POSTPONE_REQUEST_${jobCode}_${exportDate}.zip`;
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);

        row.sync_status = 'SYNCED';
        row.submitted_to_company_at = now();
        row.last_synced_at = now();
        await TVC_DB.put('daily_work_reports', row);
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📦 [Postpone/Request Export] ${filename}`,
            sync_status: 'SYNCED',
        });
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'POSTPONE_REQUEST_TO_HQ',
                department: payload.export_meta.department,
                vessel_id: payload.export_meta.vessel_id,
                filename,
                job_code: reportJobCode(row),
                record_count: 1,
                status: 'SUCCESS',
                space: TVC_RBAC.isHqAccount(user) ? 'HQ' : 'SHIP',
            });
        }
        return { payload, filename };
    }

    async function exportHqReplyZip(user, reportId) {
        const { row, job } = await loadReportContext(reportId);
        if (!TVC_RBAC.isApprovedStatus(row.status, row.is_locked)) {
            throw new Error('HQ must approve the postpone report before reply export.');
        }
        if (!row.approved_postpone_date) {
            throw new Error('Approved Postpone Date is required before reply export.');
        }
        const payload = await buildHqReplyPayload(user, row, job);
        const exportDate = now().slice(0, 10).replace(/-/g, '');
        const jobCode = reportJobCode(row).replace(/[^\w.-]+/g, '_');
        const html = buildPrintHtml(row, row.ship_name, job);
        const zip = new JSZip();
        zip.file('postpone_report_reply.json', JSON.stringify(payload, null, 2));
        zip.file(`POSTPONE_REPLY_${jobCode}.html`, html);
        zip.file('README.txt', `TVC-PMS Postpone HQ Reply\nJob: ${reportJobCode(row)}\nDirection: POSTPONE_REPLY_HQ_TO_SHIP`);

        const filename = `${payload.export_meta.vessel_id}_POSTPONE_REPLY_${jobCode}_${exportDate}.zip`;
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);

        row.sync_status = 'SYNCED';
        row.last_synced_at = now();
        await TVC_DB.put('daily_work_reports', row);
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: 'POSTPONE_REPLY_HQ_TO_SHIP',
                department: row.department || job?.department || 'ALL',
                vessel_id: payload.export_meta.vessel_id,
                filename,
                job_code: reportJobCode(row),
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
        const jsonName = ['postpone_report.json', 'postpone_report_reply.json']
            .find(n => zip.file(n));
        if (!jsonName) throw new Error('Invalid postpone package: missing postpone JSON');
        const text = await zip.file(jsonName).async('string');
        const payload = JSON.parse(text);
        const direction = payload.export_meta?.direction;
        const isHq = TVC_RBAC.isHqAccount(user);

        const HQ_ONLY = new Set(['POSTPONE_REQUEST_TO_HQ']);
        const SHIP_ONLY = new Set(['POSTPONE_REPLY_HQ_TO_SHIP']);
        if (HQ_ONLY.has(direction) && !isHq) {
            throw new Error('This postpone package is for HQ import only.');
        }
        if (SHIP_ONLY.has(direction) && isHq) {
            throw new Error('This postpone package is for ship import only.');
        }

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
                direction: direction || 'POSTPONE_IMPORT',
                department: payload.export_meta?.department || 'ALL',
                vessel_id: importVesselId || '—',
                filename: file.name || '(postpone)',
                record_count: payload.daily_work_reports?.length || 0,
                status: 'SUCCESS',
                space: isHq ? 'HQ' : 'SHIP',
            });
        }
        return payload;
    }

    return {
        buildPrintHtml, openPrintWindow, exportRequestZip, exportHqReplyZip, importPackage,
        buildRequestPayload, buildHqReplyPayload,
    };
})();

if (typeof window !== 'undefined') window.TVC_PostponeSync = TVC_PostponeSync;
