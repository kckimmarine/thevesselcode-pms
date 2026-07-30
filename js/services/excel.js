/* THE VESSEL CODE — Excel I/O (Requisition export/import)
 *
 * ExcelJS(브라우저) 사용. index.html 에서 CDN 로드.
 *  - exportRequisition(): 업체가 "가격(Unit Price)"과 "코멘트(Vendor Comment)"만
 *    입력할 수 있도록 시트를 보호(protect)하고 해당 셀만 잠금 해제한다.
 *  - parseRequisitionFile(): 업체/본사가 회신한 엑셀을 파싱해 part_no 기준 행을 반환한다.
 *
 * 컬럼 스키마(헤더명 고정) — 파싱은 헤더명으로 매칭하므로 열 순서가 바뀌어도 안전:
 *   No | Part No | Universal Code | Name | Maker | Model | Unit |
 *   Qty Requested | Unit Price | Currency | Vendor Comment | Qty Approved | HQ Comment
 */
const TVC_Excel = (function () {
    const SHEET = 'Requisition';
    const COLS = [
        { header: 'No', key: 'no', width: 6, lock: true },
        { header: 'Part No', key: 'part_no', width: 16, lock: true },
        { header: 'Universal Code', key: 'universal_code', width: 16, lock: true },
        { header: 'Name', key: 'name', width: 30, lock: true },
        { header: 'Maker', key: 'maker', width: 16, lock: true },
        { header: 'Model', key: 'model', width: 16, lock: true },
        { header: 'Unit', key: 'unit', width: 8, lock: true },
        { header: 'Qty Requested', key: 'qty_requested', width: 14, lock: true },
        { header: 'Unit Price', key: 'price', width: 14, lock: false },        // 업체 입력
        { header: 'Currency', key: 'currency', width: 10, lock: false },        // 업체 입력
        { header: 'Vendor Comment', key: 'vendor_comment', width: 28, lock: false }, // 업체 입력
        { header: 'Qty Approved', key: 'qty_approved', width: 14, lock: false }, // 본사 입력
        { header: 'Qty Received', key: 'qty_received', width: 14, lock: false }, // 입고 수량
        { header: 'HQ Comment', key: 'hq_comment', width: 28, lock: false },     // 본사 입력
    ];

    function available() { return typeof window.ExcelJS !== 'undefined'; }

    function downloadBlob(buffer, filename) {
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    }

    /**
     * 청구서 → 보호된 xlsx 파일 다운로드.
     * @param req requisition 레코드
     * @param opts { vendorOnly:true } vendorOnly면 가격/코멘트만, 아니면 본사 셀도 해제
     */
    async function exportRequisition(req, opts = {}) {
        if (!available()) throw new Error('ExcelJS 라이브러리가 로드되지 않았습니다.');
        const vendorOnly = opts.vendorOnly !== false; // 기본: 업체용(가격/코멘트만)
        const wb = new ExcelJS.Workbook();
        wb.creator = 'TVC-PMS';
        wb.created = new Date();
        const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 4 }] });

        // 상단 메타 헤더
        ws.mergeCells('A1', `${String.fromCharCode(64 + COLS.length)}1`);
        ws.getCell('A1').value = `REQUISITION  ·  ${req.req_no || ''}`;
        ws.getCell('A1').font = { bold: true, size: 14 };
        ws.getCell('A2').value = `Vessel: ${req.vessel_id || '-'}    Dept: ${req.department || '-'}    Date: ${(req.created_at || '').slice(0, 10)}`;
        ws.getCell('A3').value = '업체: [Unit Price], [Currency], [Vendor Comment] 셀만 입력 가능합니다. (나머지 셀은 보호됨)';
        ws.getCell('A3').font = { italic: true, color: { argb: 'FF9C4221' } };

        // 컬럼 헤더 (4행)
        const headerRow = ws.getRow(4);
        COLS.forEach((c, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = c.header;
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = { bottom: { style: 'thin' } };
        });
        headerRow.commit();

        // 데이터 행
        (req.lines || []).forEach((l, idx) => {
            const r = ws.getRow(5 + idx);
            const values = {
                no: idx + 1, part_no: l.part_no, universal_code: l.universal_code, name: l.name,
                maker: l.maker, model: l.model, unit: l.unit, qty_requested: l.qty_requested,
                price: l.price, currency: l.currency, vendor_comment: l.vendor_comment,
                qty_approved: l.qty_approved, hq_comment: l.hq_comment,
                qty_received: l.qty_received,
            };
            COLS.forEach((c, i) => {
                const cell = r.getCell(i + 1);
                cell.value = values[c.key] != null ? values[c.key] : '';
                const editable = c.lock === false && (!vendorOnly || ['price', 'currency', 'vendor_comment'].includes(c.key));
                cell.protection = { locked: !editable };
                if (editable) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
                cell.border = { bottom: { style: 'hair' } };
            });
            r.commit();
        });

        // 시트 보호 (잠금 셀 편집 불가, 잠금해제 셀만 편집 가능)
        await ws.protect('tvc-pms', {
            selectLockedCells: true, selectUnlockedCells: true,
            formatCells: false, insertRows: false, deleteRows: false,
        });

        const buf = await wb.xlsx.writeBuffer();
        downloadBlob(buf, `${req.req_no || 'REQUISITION'}.xlsx`);
        return true;
    }

    /** 헤더명 → 컬럼 index 매핑 (열 순서 무관) */
    function buildHeaderMap(ws) {
        const map = {};
        // 헤더는 4행(export 기준). 그러나 안전하게 상위 6행에서 'Part No' 있는 행을 찾는다.
        let headerRowNo = 4;
        for (let rn = 1; rn <= 8; rn++) {
            const row = ws.getRow(rn);
            let found = false;
            row.eachCell({ includeEmpty: false }, (cell) => {
                if (String(cell.value).trim().toLowerCase() === 'part no') found = true;
            });
            if (found) { headerRowNo = rn; break; }
        }
        const header = ws.getRow(headerRowNo);
        header.eachCell({ includeEmpty: false }, (cell, col) => {
            const key = String(cell.value || '').trim().toLowerCase();
            map[key] = col;
        });
        return { map, headerRowNo };
    }

    /**
     * 회신 엑셀 파싱 → part_no 기준 행 배열.
     * 반환: [{ part_no, price, currency, vendor_comment, qty_approved, hq_comment }]
     */
    async function parseRequisitionFile(file) {
        if (!available()) throw new Error('ExcelJS 라이브러리가 로드되지 않았습니다.');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        const ws = wb.getWorksheet(SHEET) || wb.worksheets[0];
        if (!ws) throw new Error('시트를 찾을 수 없습니다.');

        const { map, headerRowNo } = buildHeaderMap(ws);
        const col = (name) => map[name.toLowerCase()];
        const cPart = col('part no');
        if (!cPart) throw new Error("'Part No' 열을 찾을 수 없습니다.");

        const rows = [];
        const val = (row, c) => (c ? (row.getCell(c).value ?? '') : '');
        const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };

        ws.eachRow((row, rn) => {
            if (rn <= headerRowNo) return;
            const partNo = String(val(row, cPart)).trim();
            if (!partNo) return;
            rows.push({
                part_no: partNo,
                price: num(val(row, col('unit price'))),
                currency: String(val(row, col('currency')) || '').trim() || null,
                vendor_comment: String(val(row, col('vendor comment')) || '').trim() || null,
                qty_approved: num(val(row, col('qty approved'))),
                qty_received: num(val(row, col('qty received'))) ?? num(val(row, col('qty approved'))),
                current_stock: num(val(row, col('current stock'))),
                hq_comment: String(val(row, col('hq comment')) || '').trim() || null,
            });
        });
        return rows;
    }

    const SPARE_LIST_COLS = [
        { header: 'Code', key: 'code', width: 14 },
        { header: 'Class', key: 'class', width: 10 },
        { header: 'Dwg No.', key: 'dwgNo', width: 12 },
        { header: 'Part No.', key: 'partNo', width: 18 },
        { header: 'Items', key: 'item', width: 24 },
        { header: 'Unit', key: 'unit', width: 8 },
        { header: 'Work', key: 'working', width: 10 },
        { header: 'Std', key: 'standard', width: 10 },
        { header: 'Rob', key: 'stock', width: 10 },
        { header: 'O/S', key: 'awaiting', width: 10 },
        { header: 'Need', key: 'need', width: 10 },
    ];

    /**
     * SPARE Parts List → xlsx (Print/Preview와 동일 컬럼)
     * @param {{ ship, dept, filterParts?, rows, count, exportedAt? }} ctx
     */
    async function exportSparePartsList(ctx) {
        if (!available()) throw new Error('ExcelJS 라이브러리가 로드되지 않았습니다.');
        const rows = ctx?.rows || [];
        if (!rows.length) throw new Error('No parts to export.');

        const wb = new ExcelJS.Workbook();
        wb.creator = 'TVC-PMS';
        wb.created = ctx.exportedAt || new Date();
        const ws = wb.addWorksheet('SPARE Parts List', { views: [{ state: 'frozen', ySplit: 5 }] });

        const lastCol = String.fromCharCode(64 + SPARE_LIST_COLS.length);
        ws.mergeCells(`A1:${lastCol}1`);
        ws.getCell('A1').value = 'SPARE Parts List';
        ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF217346' } };

        const exportedAt = (ctx.exportedAt || new Date()).toLocaleString();
        ws.getCell('A2').value = `Vessel: ${ctx.ship || '—'}    Dept: ${ctx.dept || 'All'}    Exported: ${exportedAt}`;
        const filterLine = (ctx.filterParts || []).join(' · ');
        ws.getCell('A3').value = filterLine || '';
        ws.getCell('A4').value = `${ctx.count ?? rows.length} part${(ctx.count ?? rows.length) === 1 ? '' : 's'}`;

        const headerRow = ws.getRow(5);
        SPARE_LIST_COLS.forEach((c, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = c.header;
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF217346' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = { bottom: { style: 'thin', color: { argb: 'FF185C37' } } };
            ws.getColumn(i + 1).width = c.width;
        });
        headerRow.commit();

        rows.forEach((row, idx) => {
            const r = ws.getRow(6 + idx);
            SPARE_LIST_COLS.forEach((c, i) => {
                const cell = r.getCell(i + 1);
                cell.value = row[c.key] != null ? row[c.key] : '';
                cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
                if (['stock', 'working', 'standard', 'awaiting', 'need'].includes(c.key)) {
                    cell.alignment = { horizontal: 'right' };
                }
            });
            r.commit();
        });

        const dateStamp = (ctx.exportedAt || new Date()).toISOString().slice(0, 10);
        const buf = await wb.xlsx.writeBuffer();
        downloadBlob(buf, `SPARE-Parts-List-${dateStamp}.xlsx`);
        return true;
    }

    const SPARE_REQ_PRINT_TEMPLATE = 'data/spare-parts-requisition-template.xlsx';
    const SPARE_REQ_DATA_START_ROW = 16;
    const SPARE_REQ_HEADER_ROW = 15;

    function cloneCellStyle(src, dst) {
        if (!src || !dst) return;
        try {
            if (src.style && Object.keys(src.style).length) dst.style = JSON.parse(JSON.stringify(src.style));
        } catch (_) { /* ignore */ }
        if (src.numFmt) dst.numFmt = src.numFmt;
        if (src.alignment) dst.alignment = { ...src.alignment };
        if (src.border) {
            try { dst.border = JSON.parse(JSON.stringify(src.border)); } catch (_) { /* ignore */ }
        }
        if (src.fill) {
            try { dst.fill = JSON.parse(JSON.stringify(src.fill)); } catch (_) { /* ignore */ }
        }
        if (src.font) {
            try { dst.font = JSON.parse(JSON.stringify(src.font)); } catch (_) { /* ignore */ }
        }
    }

    function cloneWorksheetFromTemplate(src, dst) {
        (src.columns || []).forEach((col, idx) => {
            if (col && col.width) dst.getColumn(idx + 1).width = col.width;
        });
        const maxRow = Math.max(src.rowCount || 0, 34);
        for (let rn = 1; rn <= maxRow; rn++) {
            const srcRow = src.getRow(rn);
            const dstRow = dst.getRow(rn);
            if (srcRow.height) dstRow.height = srcRow.height;
            for (let colNumber = 1; colNumber <= 15; colNumber++) {
                const srcCell = srcRow.getCell(colNumber);
                const dstCell = dstRow.getCell(colNumber);
                if (srcCell.value !== null && srcCell.value !== undefined) dstCell.value = srcCell.value;
                cloneCellStyle(srcCell, dstCell);
            }
            dstRow.commit();
        }
        (src.model.merges || []).forEach((m) => {
            try { dst.mergeCells(m); } catch (_) { /* ignore duplicate merge */ }
        });
        if (src.pageSetup) dst.pageSetup = { ...src.pageSetup };
    }

    function spareReqCellValue(v) {
        if (v == null || v === '') return '';
        if (v === '—') return '—';
        const n = Number(v);
        if (!Number.isNaN(n) && String(v).trim() !== '') return n;
        return v;
    }

    function safeReqSheetName(name, index, used) {
        let s = String(name || `Page${index + 1}`).replace(/[\\/*?:[\]]/g, '_').trim();
        if (!s) s = `Page${index + 1}`;
        if (s.length > 31) s = s.slice(0, 31);
        let base = s;
        let n = 1;
        while (used.has(s)) {
            const suffix = `_${n++}`;
            s = base.slice(0, Math.max(1, 31 - suffix.length)) + suffix;
        }
        used.add(s);
        return s;
    }

    function applySpareReqDataRowStyle(ws, rowNum, templateRowNum = SPARE_REQ_DATA_START_ROW) {
        const tpl = ws.getRow(templateRowNum);
        const row = ws.getRow(rowNum);
        for (let c = 1; c <= 15; c++) cloneCellStyle(tpl.getCell(c), row.getCell(c));
    }

    function fillSpareReqPrintSheet(ws, req, vesselName, page, ctx) {
        const fmt = typeof ctx.fmtDate === 'function' ? ctx.fmtDate : (d) => (d ? String(d).slice(0, 10) : '');
        const typeLabel = ctx.typeLabel || req.priority || 'ROUTINE';
        const dash = (v) => (v == null || v === '' ? '—' : v);

        ws.getCell('C4').value = vesselName || '—';
        ws.getCell('I4').value = `${page.pageIndex} / ${page.pageTotal}`;
        ws.getCell('C5').value = req.req_no || '—';
        ws.getCell('I5').value = typeLabel;
        ws.getCell('C6').value = `${dash(fmt(req.deliver_date_from) || null)} ~ ${dash(fmt(req.deliver_date_to) || null)}`;
        ws.getCell('I6').value = dash(fmt(req.made_on) || null);
        ws.getCell('L6').value = req.made_by || '—';
        ws.getCell('C7').value = req.deliver_port || '—';
        ws.getCell('I7').value = dash(fmt(req.assessed_on) || null);
        ws.getCell('L7').value = req.assessed_by || '—';

        const h = page.header || {};
        ws.getCell('A10').value = h.pmsGroupNo || page.groupKey || '—';
        ws.getCell('A12').value = h.maker || '—';
        ws.getCell('E12').value = h.modelType || '—';
        ws.getCell('G12').value = h.capacity || '—';
        ws.getCell('K12').value = h.serialNo || '—';
        ws.getCell('A15').value = 'No.';

        for (let rn = SPARE_REQ_DATA_START_ROW; rn <= 34; rn++) {
            const row = ws.getRow(rn);
            for (let c = 1; c <= 15; c++) row.getCell(c).value = null;
        }

        const rows = page.rows || [];
        rows.forEach((r, idx) => {
            const rowNum = SPARE_REQ_DATA_START_ROW + idx;
            if (rowNum > 34) applySpareReqDataRowStyle(ws, rowNum);
            const row = ws.getRow(rowNum);
            row.getCell(1).value = r.lineNo;
            row.getCell(2).value = r.code ?? '';
            row.getCell(3).value = r.cls ?? '';
            row.getCell(4).value = r.dwg ?? '';
            row.getCell(5).value = r.pno ?? '';
            row.getCell(6).value = r.item ?? '';
            row.getCell(7).value = r.unit ?? '';
            row.getCell(8).value = spareReqCellValue(r.working);
            row.getCell(9).value = spareReqCellValue(r.std);
            row.getCell(10).value = spareReqCellValue(r.stock);
            row.getCell(11).value = spareReqCellValue(r.awaiting);
            row.getCell(12).value = spareReqCellValue(r.need);
            row.getCell(13).value = spareReqCellValue(r.request);
            row.getCell(14).value = spareReqCellValue(r.assess);
            row.getCell(15).value = spareReqCellValue(r.rcvd);
            row.commit();
        });

        const lastRow = Math.max(34, SPARE_REQ_HEADER_ROW + rows.length);
        ws.pageSetup = { ...(ws.pageSetup || {}), printArea: `A1:O${lastRow}` };
        ws.pageSetup.orientation = 'landscape';
        ws.pageSetup.scale = 85;
        ws.pageSetup.fitToWidth = 1;
        ws.pageSetup.fitToHeight = 1;
    }

    /**
     * SPARE PARTS REQUISITION 인쇄 양식 → xlsx (Print/Preview와 동일 레이아웃)
     * @param {{ req, vesselName, typeLabel?, fmtDate?, pages }} ctx
     *   pages: [{ pageIndex, pageTotal, groupKey, header, rows }]
     */
    async function exportSparePartsRequisitionForm(ctx) {
        if (!available()) throw new Error('ExcelJS 라이브러리가 로드되지 않았습니다.');
        const pages = ctx?.pages || [];
        if (!pages.length) throw new Error('No items to export.');

        const res = await fetch(SPARE_REQ_PRINT_TEMPLATE);
        if (!res.ok) throw new Error('Requisition Excel template not found.');
        const tplBuf = await res.arrayBuffer();

        const outWb = new ExcelJS.Workbook();
        outWb.creator = 'TVC-PMS';
        outWb.created = new Date();
        const usedNames = new Set();

        for (let i = 0; i < pages.length; i++) {
            const tmpWb = new ExcelJS.Workbook();
            await tmpWb.xlsx.load(tplBuf);
            const src = tmpWb.worksheets[0];
            if (!src) throw new Error('Template worksheet missing.');
            const sheetName = safeReqSheetName(pages[i].sheetName || pages[i].groupKey, i, usedNames);
            const ws = outWb.addWorksheet(sheetName);
            cloneWorksheetFromTemplate(src, ws);
            fillSpareReqPrintSheet(ws, ctx.req, ctx.vesselName, pages[i], ctx);
        }

        const safeNo = String(ctx.req?.req_no || 'REQUISITION').replace(/[^\w\-]+/g, '_');
        const buf = await outWb.xlsx.writeBuffer();
        downloadBlob(buf, `${safeNo}-requisition.xlsx`);
        return true;
    }

    return {
        available, exportRequisition, parseRequisitionFile, exportSparePartsList,
        exportSparePartsRequisitionForm, COLS, SPARE_LIST_COLS,
    };
})();
