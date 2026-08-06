/** SPARE Data Export / Import — ZIP packages (same pattern as PMS tvc_sync.json) */
const TVC_SpareSync = (function () {
    const SCHEMA_VERSION = 1;
    const JSON_NAME = 'tvc_spare_sync.json';

    const now = () => new Date().toISOString();

    function licensedCompanyId() {
        return (typeof TVC_Sync !== 'undefined' && TVC_Sync.licensedCompanyId)
            ? TVC_Sync.licensedCompanyId()
            : 'DAEMYUNG';
    }

    function exportDateTag() {
        return now().slice(0, 10).replace(/-/g, '');
    }

    function isHqUser(user) {
        return !!(typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isHqAccount?.(user));
    }

    async function resolveExportFilename(user, category, opts = {}) {
        const vesselId = opts.vessel_id || user?.vessel_id || 'UNKNOWN';
        const department = opts.department || user?.department || null;
        const isHq = opts.isHq != null ? !!opts.isHq : isHqUser(user);
        if (typeof TVC_Filename !== 'undefined') {
            return TVC_Filename.build({
                vesselId,
                type: TVC_Filename.spareType(category),
                department,
                isHq,
                ext: 'zip',
            });
        }
        return `${String(vesselId).replace(/[\\/:*?"<>|]/g, '_')}_SPARE_${category}_${exportDateTag()}.zip`;
    }

    function buildMeta(user, category, opts = {}) {
        return {
            vessel_id: opts.vessel_id || user?.vessel_id || 'UNKNOWN',
            company_id: licensedCompanyId(),
            export_date: now().slice(0, 10),
            direction: opts.direction || 'SPARE_EXPORT',
            category,
            department: opts.department || user?.department || null,
            exported_by: user?.username || user?.display_name || '',
            schema_version: SCHEMA_VERSION,
            req_no: opts.req_no || null,
            req_count: opts.req_count ?? undefined,
            req_nos: opts.req_nos?.length ? opts.req_nos : undefined,
            vendor_only: opts.vendorOnly != null ? !!opts.vendorOnly : undefined,
        };
    }

    async function saveZip(payload, filename, readmeLines, extraFiles = []) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip is not loaded.');
        const zip = new JSZip();
        zip.file(JSON_NAME, JSON.stringify(payload, null, 2));
        zip.file('README.txt', (readmeLines || []).filter(Boolean).join('\n'));
        (extraFiles || []).forEach((f) => {
            if (f?.filename && f?.buffer) zip.file(f.filename, f.buffer);
        });
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);
        return filename;
    }

    function cloneReq(req) {
        return JSON.parse(JSON.stringify(req));
    }

    async function exportRequisitionsZip(user, reqs, opts = {}) {
        const list = (reqs || []).filter(Boolean);
        if (!list.length) throw new Error('No requisitions to export.');
        const category = opts.category || 'REQUISITION';
        const vesselId = opts.vessel_id || list[0]?.vessel_id || user?.vessel_id || 'UNKNOWN';
        const department = opts.department || list[0]?.department || user?.department || null;
        const reqNos = list.map(r => r.req_no).filter(Boolean);
        const payload = {
            export_meta: buildMeta(user, category, {
                vessel_id: vesselId,
                department,
                vendorOnly: opts.vendorOnly,
                req_count: list.length,
                req_nos: reqNos,
                req_no: list.length === 1 ? list[0].req_no : null,
            }),
            requisitions: list.map(cloneReq),
        };
        const filename = opts.filename || await resolveExportFilename(user, category, {
            vessel_id: vesselId,
            department,
            isHq: opts.isHq,
        });
        const readme = [
            'TVC-PMS SPARE Export Package',
            `Category: ${category}`,
            list.length === 1
                ? `Requisition: ${list[0].req_no || '—'}`
                : `Requisitions (${list.length}): ${reqNos.join(', ') || '—'}`,
            `Vessel: ${payload.export_meta.vessel_id}`,
            `Department: ${department || '—'}`,
            `Date: ${payload.export_meta.export_date}`,
            '',
            `Open ${JSON_NAME} for structured data.`,
            (opts.excelFiles || []).length
                ? `Excel: ${(opts.excelFiles || []).map(f => f.filename).filter(Boolean).join(', ')}`
                : '',
        ].filter(Boolean);
        await saveZip(payload, filename, readme, opts.excelFiles || []);
        return { filename, payload };
    }

    async function exportRequisitionZip(user, req, opts = {}) {
        if (!req) throw new Error('REQ_NOT_FOUND');
        return exportRequisitionsZip(user, [req], {
            ...opts,
            vessel_id: opts.vessel_id || req.vessel_id,
            department: opts.department || req.department,
        });
    }

    async function exportQuotationZip(user, req, quoteTargets, opts = {}) {
        if (!req) throw new Error('REQ_NOT_FOUND');
        const targets = (quoteTargets || []).map(t => ({
            slot: t.slot,
            vendor_name: t.vendorName,
            currency: t.currency,
            lines: (t.lines || []).map(l => ({ ...l })),
        }));
        if (!targets.length) throw new Error('No vendor quote files for this requisition.');
        const category = 'QUOTATION';
        const payload = {
            export_meta: buildMeta(user, category, {
                vessel_id: req.vessel_id,
                department: req.department,
                req_no: req.req_no,
                req_count: 1,
                req_nos: req.req_no ? [req.req_no] : [],
            }),
            requisitions: [cloneReq(req)],
            quotation_exports: targets,
        };
        const filename = opts.filename || await resolveExportFilename(user, category, {
            vessel_id: req.vessel_id,
            department: req.department,
            isHq: opts.isHq,
        });
        const readme = [
            'TVC-PMS SPARE Quotation Export',
            `Requisition: ${req.req_no || '—'}`,
            `Vendors: ${targets.map(t => t.vendor_name).join(', ')}`,
            `Vessel: ${payload.export_meta.vessel_id}`,
            `Date: ${payload.export_meta.export_date}`,
            '',
            'Vendor Excel files: fill yellow cells (Reference No, Quoted Date, Comments, Price, Remark) and return.',
            (opts.excelFiles || []).map(f => f.filename).filter(Boolean).join(', ') || '(none)',
        ];
        await saveZip(payload, filename, readme, opts.excelFiles || []);
        return { filename, payload };
    }

    async function exportInventoryZip(user, spareParts, opts = {}) {
        const parts = (spareParts || []).map(p => ({ ...p }));
        if (!parts.length) throw new Error('No parts to export.');
        const category = 'INVENTORY';
        const vesselId = opts.vessel_id || parts[0]?.vessel_id || user?.vessel_id || 'UNKNOWN';
        const department = opts.department || user?.department || null;
        const payload = {
            export_meta: buildMeta(user, category, {
                vessel_id: vesselId,
                department,
            }),
            spare_parts: parts,
        };
        const filename = opts.filename || await resolveExportFilename(user, category, {
            vessel_id: vesselId,
            department,
            isHq: opts.isHq,
        });
        const readme = [
            'TVC-PMS SPARE Inventory Export',
            `Vessel: ${vesselId}`,
            `Parts: ${parts.length}`,
            `Date: ${payload.export_meta.export_date}`,
        ];
        await saveZip(payload, filename, readme);
        return { filename, payload };
    }

    async function markRequisitionsSynced(reqs) {
        const ts = now();
        for (const req of reqs || []) {
            if (!req?.id) continue;
            req.sync_status = 'SYNCED';
            req.last_synced_at = ts;
            await TVC_DB.put('requisitions', req);
        }
    }

    async function markSparesSynced(parts) {
        const ts = now();
        for (const row of parts || []) {
            if (!row?.id) continue;
            row.sync_status = 'SYNCED';
            row.last_synced_at = ts;
            await TVC_DB.put('spare_parts', row);
        }
    }

    async function importZip(user, file, opts = {}) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip is not loaded.');
        const zip = await JSZip.loadAsync(file);
        const jsonFile = zip.file(JSON_NAME);
        if (!jsonFile) throw new Error(`${JSON_NAME} not found in zip`);
        const payload = JSON.parse(await jsonFile.async('string'));
        const meta = payload.export_meta || {};
        const category = String(meta.category || opts.expectedCategory || '').toUpperCase();
        const expected = opts.expectedCategory ? String(opts.expectedCategory).toUpperCase() : '';
        if (expected && category && category !== expected) {
            throw new Error(`Category mismatch: expected ${expected}, file has ${category}.`);
        }

        let updated = 0;

        if ((payload.requisitions || []).length) {
            for (const req of payload.requisitions) {
                if (!req?.id) continue;
                if (opts.importMode === 'vendor-quote' && window.TVC_Inventory?.applyVendorQuote) {
                    const rows = (req.lines || []).map(l => ({
                        part_no: l.part_no,
                        price: l.price,
                        currency: l.currency,
                        vendor_comment: l.vendor_comment,
                    }));
                    await TVC_Inventory.applyVendorQuote(req.id, rows);
                } else if (opts.importMode === 'hq-adjustment' && window.TVC_Inventory?.applyHqAdjustment) {
                    const existing = await TVC_Inventory.getRequisition(req.id);
                    if (existing) {
                        const rows = (req.lines || []).map(l => ({
                            part_no: l.part_no,
                            qty_approved: l.qty_approved,
                            price: l.price,
                            currency: l.currency,
                            hq_comment: l.hq_comment,
                        }));
                        await TVC_Inventory.applyHqAdjustment(req.id, rows);
                    } else {
                        await TVC_DB.put('requisitions', req);
                    }
                } else {
                    await TVC_DB.put('requisitions', req);
                }
                updated++;
            }
        }

        if ((payload.spare_parts || []).length) {
            for (const row of payload.spare_parts) {
                if (!row?.id) continue;
                await TVC_DB.put('spare_parts', row);
                updated++;
            }
        }

        if (category === 'ASSESSMENT' && payload.assessment && window.TVC_InventoryService?.diffHqImport) {
            return { payload, assessment: payload.assessment, updated };
        }

        return { payload, updated, category, filename: file.name || '' };
    }

    return {
        JSON_NAME,
        exportRequisitionZip,
        exportRequisitionsZip,
        exportQuotationZip,
        exportInventoryZip,
        importZip,
        markRequisitionsSynced,
        markSparesSynced,
        resolveExportFilename,
    };
})();
