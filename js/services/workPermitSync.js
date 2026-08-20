/* Critical Equipment — Work Permit Request Export + HQ Reply */
const TVC_WorkPermitSync = (function () {
    const SCHEMA_VERSION = String(TVC_WorkPermit?.SCHEMA_VERSION || 1);
    const now = () => new Date().toISOString();

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function reportJobCode(row) {
        const fromItems = (row.job_items || []).map(i => i.job_code).find(Boolean);
        return fromItems || row.job_code || row.pms_job_code || '—';
    }

    function safeFileToken(raw) {
        return String(raw || 'item').replace(/[^\w.-]+/g, '_');
    }

    function buildPrintHtml(row, vesselName) {
        const ship = esc(row.ship_name || vesselName || '—');
        const jobCode = esc(reportJobCode(row));
        const approved = !!(row.approved_at || row.approved_by);
        const confirmed = !!(row.confirmed_at || row.confirmed_by);
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Work Permit ${esc(row.permit_no || jobCode)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 16px; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 4px; letter-spacing: 0.5px; }
  h2 { font-size: 12px; margin: 14px 0 6px; border-bottom: 1px solid #333; padding-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  td, th { border: 1px solid #333; padding: 4px 6px; vertical-align: top; }
  th { background: #f0f4f8; text-align: left; width: 28%; font-weight: 600; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 10px; }
  .banner { background: #ebf8ff; border: 1px solid #3182ce; padding: 6px 10px; margin-bottom: 10px; }
  @media print { body { margin: 10mm; } }
</style></head><body>
<div class="meta">
  <div><b>To:</b> Company (HQ)</div>
  <div><b>Permit No:</b> ${esc(row.permit_no || '—')}</div>
</div>
<h1>CRITICAL EQUIPMENT — WORK PERMIT</h1>
<div class="banner"><b>⚠ Critical Equipment</b> — Company approval required before planned maintenance.</div>
<div class="meta">
  <div><b>Ship Name:</b> ${ship}</div>
  <div><b>Plan Date:</b> ${esc(row.plan_date || '—')}</div>
</div>

<div class="phase">
<h2>Phase 1 — Ship Work Permit Request</h2>
<table>
  <tr><th>File No.</th><td>${esc(row.file_no || '—')}</td><th>Voy. No.</th><td>${esc(row.voy_no || '—')}</td></tr>
  <tr><th>Place</th><td>${esc(row.place || '—')}</td><th>Reported Date</th><td>${esc(row.report_date || '—')}</td></tr>
  <tr><th>PMS Group No.</th><td>${esc(row.pms_group_no || '—')}</td><th>Job Code</th><td>${jobCode}</td></tr>
  <tr><th>SORT-1</th><td>${esc(row.item_sort1 || '—')}</td><th>SORT-2</th><td>${esc(row.item_sort2 || '—')}</td></tr>
  <tr><th>Job Detail</th><td colspan="3">${esc(row.job_detail || row.job_name || '—')}</td></tr>
  <tr><th>Ship's Comments</th><td colspan="3">${esc(row.outline_work_permit || '—')}</td></tr>
  <tr><th>Company's Comments</th><td colspan="3">${esc(row.company_comment || '—')}</td></tr>
  <tr><th>Reported by</th><td>${esc(row.reporter_name || '—')}</td><th>Confirmed by</th><td>${confirmed ? esc(row.confirmed_by || row.confirmed_at || 'Yes') : '<i>Pending</i>'}</td></tr>
</table>
</div>

<div class="phase">
<h2>Phase 2 — Company Approval</h2>
<table>
  <tr><th>Approved by</th><td colspan="3">${approved ? esc(row.approved_by || 'Company') : '<i>Awaiting company approval</i>'}</td></tr>
  <tr><th>Approved Date</th><td colspan="3">${approved ? esc(row.approved_at || '—') : '—'}</td></tr>
</table>
</div>
</body></html>`;
    }

    function openPrintWindow(html, title) {
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
        w.document.title = title || 'Work Permit';
        w.focus();
        setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
    }

    async function resolveVesselId(user, row) {
        return row?.vessel_id
            || await TVC_WorkPermitCaseService.resolveVesselId(user)
            || await TVC_Sync.resolveExpectedVesselId(user, TVC_RBAC.isHqAccount(user))
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
            return `${String(vesselId || 'unknown').toLowerCase()}_workpermit_${scope}_${dateTag}_001.zip`;
        }
        return TVC_Filename.build({
            vesselId,
            type: 'workpermit',
            scope,
            ext: 'zip',
        });
    }

    function buildBatchRequestPayload(user, rows, vesselId) {
        const primary = rows[0];
        return {
            export_meta: {
                vessel_id: vesselId,
                company_id: (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId) ? TVC_Sync.licensedCompanyId() : 'DAEMYUNG',
                export_date: now().slice(0, 10),
                direction: 'WORK_PERMIT_REQUEST_TO_HQ',
                package_type: 'WORK_PERMIT',
                department: primary?.department || user?.department || 'ALL',
                exported_by: user?.username || '',
                schema_version: SCHEMA_VERSION,
                record_count: rows.length,
            },
            work_permits: rows,
        };
    }

    function buildBatchHqReplyPayload(user, rows, vesselId) {
        const primary = rows[0];
        return {
            export_meta: {
                vessel_id: vesselId,
                company_id: (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId) ? TVC_Sync.licensedCompanyId() : 'DAEMYUNG',
                export_date: now().slice(0, 10),
                direction: 'WORK_PERMIT_REPLY_HQ_TO_SHIP',
                package_type: 'WORK_PERMIT_REPLY',
                department: primary?.department || 'ALL',
                exported_by: user?.username || '',
                schema_version: SCHEMA_VERSION,
                record_count: rows.length,
            },
            work_permits: rows,
        };
    }

    async function loadPermitContext(permitId) {
        const row = await TVC_WorkPermitCaseService.get(permitId);
        if (!row) throw new Error('Work Permit not found.');
        if (row.visible_in_list === false) throw new Error('Save Work Permit to list before export.');
        return row;
    }

    async function loadPermitBatch(permitIds, { hqReply = false, user = null } = {}) {
        const ids = (permitIds || []).filter(Boolean);
        if (!ids.length) throw new Error('No Work Permits selected.');
        const isHub = !hqReply && user && typeof TVC_HubRelay !== 'undefined' && TVC_HubRelay.isHubRelayExport(user);
        const rows = [];
        for (const id of ids) {
            const row = await loadPermitContext(id);
            const st = TVC_WorkPermit.listWorkflowStatus(row);
            if (hqReply) {
                if (st !== 'Approved') {
                    throw new Error(`${row.permit_no || row.job_code}: only Approved permits can be reply-exported.`);
                }
            } else if (isHub) {
                if (!TVC_HubRelay.canHubLegExport(row)) {
                    throw new Error(`${row.permit_no || row.job_code}: ${TVC_HubRelay.hubExportBlockedTitle()}.`);
                }
                if (st !== 'Submitted') {
                    throw new Error(`${row.permit_no || row.job_code}: awaiting station export first.`);
                }
            } else {
                if (st !== 'Confirmed') {
                    throw new Error(`${row.permit_no || row.job_code}: only Confirmed permits can be exported.`);
                }
                if (!TVC_HubRelay.canStationLegExport(row)) {
                    throw new Error(`${row.permit_no || row.job_code}: already exported (Submitted).`);
                }
            }
            rows.push(row);
        }
        return rows;
    }

    async function saveBatchExport(user, rows, payload, filename, direction) {
        const ts = now();
        for (const row of rows) {
            if (typeof TVC_HubRelay !== 'undefined') {
                TVC_HubRelay.stampExport(user, row);
            } else {
                row.sync_status = 'SYNCED';
            }
            row.last_synced_at = ts;
            row.last_export_filename = filename;
            await TVC_DB.put('work_permits', row);
        }
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📦 [Work Permit Export] ${filename} (${rows.length} item(s))`,
            sync_status: 'SYNCED',
        });
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction,
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

    async function exportRequestBatchZip(user, permitIds) {
        const rows = await loadPermitBatch(permitIds, { hqReply: false, user });
        const vesselId = await resolveVesselId(user, rows[0]);
        const payload = buildBatchRequestPayload(user, rows, vesselId);
        const filename = await buildExportFilename(user, vesselId, rows[0]?.department);
        const zip = new JSZip();
        zip.file('work_permit.json', JSON.stringify(payload, null, 2));
        rows.forEach(row => {
            const jobCode = safeFileToken(reportJobCode(row));
            zip.file(`WORK_PERMIT_${jobCode}.html`, buildPrintHtml(row, row.ship_name));
        });
        zip.file('README.txt',
            `TVC-PMS Work Permit Export\nVessel: ${vesselId}\nScope: ${resolveExportScope(user, rows[0]?.department)}\nItems: ${rows.length}\nDirection: WORK_PERMIT_REQUEST_TO_HQ\n\nFilename: ${filename}`);

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);
        await saveBatchExport(user, rows, payload, filename, 'WORK_PERMIT_REQUEST_TO_HQ');
        return { payload, filename, count: rows.length };
    }

    async function exportHqReplyBatchZip(user, permitIds) {
        const rows = await loadPermitBatch(permitIds, { hqReply: true });
        const vesselId = await resolveVesselId(user, rows[0]);
        const payload = buildBatchHqReplyPayload(user, rows, vesselId);
        const filename = await buildExportFilename(user, vesselId, rows[0]?.department, { hqReply: true });
        const zip = new JSZip();
        zip.file('work_permit_reply.json', JSON.stringify(payload, null, 2));
        rows.forEach(row => {
            const jobCode = safeFileToken(reportJobCode(row));
            zip.file(`WORK_PERMIT_REPLY_${jobCode}.html`, buildPrintHtml(row, row.ship_name));
        });
        zip.file('README.txt',
            `TVC-PMS Work Permit HQ Reply\nVessel: ${vesselId}\nScope: ${resolveExportScope(user, rows[0]?.department, { hqReply: true })}\nItems: ${rows.length}\nDirection: WORK_PERMIT_REPLY_HQ_TO_SHIP\n\nFilename: ${filename}`);

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);
        await saveBatchExport(user, rows, payload, filename, 'WORK_PERMIT_REPLY_HQ_TO_SHIP');
        return { payload, filename, count: rows.length };
    }

    async function exportRequestZip(user, permitId) {
        return exportRequestBatchZip(user, [permitId]);
    }

    async function exportHqReplyZip(user, permitId) {
        return exportHqReplyBatchZip(user, [permitId]);
    }

    async function buildRequestPayload(user, row) {
        const vesselId = await resolveVesselId(user, row);
        return buildBatchRequestPayload(user, [row], vesselId);
    }

    async function buildHqReplyPayload(user, row) {
        const vesselId = row.vessel_id || await resolveVesselId(user, row);
        return buildBatchHqReplyPayload(user, [row], vesselId);
    }

    async function importPackage(user, file) {
        const buf = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(buf);
        const jsonName = ['work_permit.json', 'work_permit_reply.json']
            .find(n => zip.file(n));
        if (!jsonName) throw new Error('Invalid Work Permit package: missing work_permit JSON');
        const text = await zip.file(jsonName).async('string');
        const payload = JSON.parse(text);
        const direction = payload.export_meta?.direction;
        const isHq = TVC_RBAC.isHqAccount(user);
        const isHub = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user);

        const HQ_ONLY = new Set(['WORK_PERMIT_REQUEST_TO_HQ']);
        const SHIP_ONLY = new Set(['WORK_PERMIT_REPLY_HQ_TO_SHIP']);
        if (HQ_ONLY.has(direction) && !isHq && !isHub) {
            throw new Error('This Work Permit package is for HQ or Master Hub import only.');
        }
        if (SHIP_ONLY.has(direction) && isHq) {
            throw new Error('This Work Permit package is for ship import only.');
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
                direction: direction || 'WORK_PERMIT_IMPORT',
                department: payload.export_meta?.department || 'ALL',
                vessel_id: importVesselId || '—',
                filename: file.name || '(work-permit)',
                ref_key: file.name || '',
                record_count: payload.work_permits?.length || 0,
                status: 'SUCCESS',
                space: isHq ? 'HQ' : 'SHIP',
            });
        }
        return payload;
    }

    return {
        buildPrintHtml, openPrintWindow,
        exportRequestZip, exportHqReplyZip,
        exportRequestBatchZip, exportHqReplyBatchZip,
        importPackage, buildRequestPayload, buildHqReplyPayload, reportJobCode,
        resolveExportScope, buildExportFilename,
    };
})();

if (typeof window !== 'undefined') window.TVC_WorkPermitSync = TVC_WorkPermitSync;
