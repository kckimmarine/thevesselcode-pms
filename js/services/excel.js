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

    async function downloadBlob(buffer, filename) {
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        await TVC_FileExport.save(blob, filename);
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
        await downloadBlob(buf, opts.filename || `${req.req_no || 'REQUISITION'}.xlsx`);
        return true;
    }

    /**
     * Request Quote — 업체별 견적 요청 xlsx (체크된 품목만, 통화 HQ 지정).
     * @param req requisition 레cord
     * @param opts { vendorName, currency, lines, filename }
     */
    async function exportQuoteRequisition(req, opts = {}) {
        if (!available()) throw new Error('ExcelJS 라이브러리가 로드되지 않았습니다.');
        const vendorName = String(opts.vendorName || '').trim();
        const currency = String(opts.currency || 'USD').trim().toUpperCase();
        const lines = Array.isArray(opts.lines) ? opts.lines : [];
        if (!vendorName) throw new Error('Vendor name is required.');
        if (!lines.length) throw new Error('No items selected for quotation.');

        const wb = new ExcelJS.Workbook();
        wb.creator = 'TVC-PMS';
        wb.created = new Date();
        const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 4 }] });

        ws.mergeCells('A1', `${String.fromCharCode(64 + COLS.length)}1`);
        ws.getCell('A1').value = `QUOTATION REQUEST  ·  ${req.req_no || ''}`;
        ws.getCell('A1').font = { bold: true, size: 14 };
        ws.getCell('A2').value = `Vessel: ${req.vessel_id || '-'}    Vendor: ${vendorName}    Currency: ${currency}    Dept: ${req.department || '-'}`;
        ws.getCell('A3').value = 'Please fill [Unit Price] and [Vendor Comment] only. Currency is fixed by HQ.';
        ws.getCell('A3').font = { italic: true, color: { argb: 'FF9C4221' } };

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

        lines.forEach((l, idx) => {
            const r = ws.getRow(5 + idx);
            const values = {
                no: idx + 1, part_no: l.part_no, universal_code: l.universal_code, name: l.name,
                maker: l.maker, model: l.model, unit: l.unit, qty_requested: l.qty_requested,
                price: l.price, currency, vendor_comment: l.vendor_comment,
                qty_approved: l.qty_approved, hq_comment: l.hq_comment,
                qty_received: l.qty_received,
            };
            COLS.forEach((c, i) => {
                const cell = r.getCell(i + 1);
                cell.value = values[c.key] != null ? values[c.key] : '';
                const editable = c.lock === false && ['price', 'vendor_comment'].includes(c.key);
                cell.protection = { locked: !editable };
                if (editable) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
                cell.border = { bottom: { style: 'hair' } };
            });
            r.commit();
        });

        await ws.protect('tvc-pms', {
            selectLockedCells: true, selectUnlockedCells: true,
            formatCells: false, insertRows: false, deleteRows: false,
        });

        const buf = await wb.xlsx.writeBuffer();
        await downloadBlob(buf, opts.filename || `${req.req_no || 'REQUISITION'}_${vendorName}.xlsx`);
        return true;
    }

    /** 헤더명 → 컬럼 index 매핑 (열 순서 무관) */
    function buildHeaderMap(ws) {
        const map = {};
        let headerRowNo = 4;
        for (let rn = 1; rn <= 35; rn++) {
            const row = ws.getRow(rn);
            let found = false;
            row.eachCell({ includeEmpty: false }, (cell) => {
                const v = String(cell.value).trim().toLowerCase().replace(/\.$/, '');
                if (v === 'part no') found = true;
            });
            if (found) { headerRowNo = rn; break; }
        }
        const header = ws.getRow(headerRowNo);
        header.eachCell({ includeEmpty: false }, (cell, col) => {
            const key = String(cell.value || '').trim().toLowerCase().replace(/\.$/, '');
            if (!key) return;
            if (key === 'price' && map.price != null) return;
            if (key === 'remark' && map.remark != null) return;
            if (key === 'amount' && map.amount != null) return;
            map[key] = col;
        });
        return { map, headerRowNo };
    }

    function excelPlainValue(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number' || typeof v === 'boolean') return v;
        if (v instanceof Date) return v;
        if (typeof v === 'string') return v;
        if (typeof v === 'object') {
            if (Array.isArray(v.richText)) return v.richText.map(t => t.text || '').join('');
            if (v.text != null && v.text !== '') return v.text;
            if (v.result != null && v.result !== '') return excelPlainValue(v.result);
            if (v.hyperlink && v.text) return v.text;
            return null;
        }
        return v;
    }

    function parseNumCell(v) {
        const plain = excelPlainValue(v);
        if (plain == null || plain === '') return null;
        if (typeof plain === 'number') return Number.isFinite(plain) ? plain : null;
        const n = parseFloat(String(plain).replace(/[^0-9.\-]/g, ''));
        return Number.isNaN(n) ? null : n;
    }

    function parseCurrencyToken(v) {
        const s = String(excelPlainValue(v) ?? '').trim().toUpperCase();
        const m = s.match(/\b(KRW|USD|EUR|JPY|CNY|GBP|SGD|AUD)\b/);
        return m ? m[1] : null;
    }

    function rowCellVal(row, col) {
        return col ? (excelPlainValue(row.getCell(col).value) ?? '') : '';
    }

    function isBlankImportCell(v) {
        const s = String(excelPlainValue(v) ?? '').trim();
        return !s || s === '—' || s === '-' || s === '–';
    }

    function quotePrintVendorMeta(ws) {
        const cellVal = (addr) => excelPlainValue(ws.getCell(addr).value);
        const cellStr = (addr) => {
            const v = cellVal(addr);
            if (v == null || v === '') return null;
            if (v instanceof Date) return v.toISOString().slice(0, 10);
            return String(v).trim() || null;
        };
        return {
            vendorName: cellStr('K11'),
            refNo: cellStr('K12'),
            quotedDate: cellStr('K13'),
            totalAmount: parseNumCell(cellVal('M14'))
                ?? parseNumCell(cellVal('O26'))
                ?? parseNumCell(cellVal('K14')),
            comments: cellStr('K15'),
            field16: cellStr('K16') || cellStr('I16'),
            field17: cellStr('K17') || cellStr('I17'),
            currency: parseCurrencyToken(cellVal('K14'))
                || parseCurrencyToken(cellVal('M26'))
                || parseCurrencyToken(cellVal('N26'))
                || parseCurrencyToken(cellVal('M14')),
        };
    }

    function parseQuoteRowPrice(row, map) {
        const cols = [];
        const add = (c) => {
            const n = Number(c);
            if (Number.isFinite(n) && n > 0 && !cols.includes(n)) cols.push(n);
        };
        add(map.price);
        add(13);
        add(14);
        for (const col of cols) {
            const n = parseNumCell(row.getCell(col).value);
            if (n != null) return n;
        }
        return null;
    }

    /** Vendor quotation print form (SPARE PARTS REQUISITION + Price/Remark columns) */
    function parseQuotePrintForm(ws, map, headerRowNo) {
        const cCode = map.code;
        const cPart = map['part no'];
        if (!cCode && !cPart) return null;
        const cRemark = map.remark || map['vendor comment'];
        const meta = quotePrintVendorMeta(ws);
        const currency = meta.currency;
        const rows = [];
        ws.eachRow((row, rn) => {
            if (rn <= headerRowNo) return;
            const code = cCode ? String(rowCellVal(row, cCode)).trim() : '';
            const drawing = cPart ? String(rowCellVal(row, cPart)).trim() : '';
            const partNo = !isBlankImportCell(code) ? code : (!isBlankImportCell(drawing) ? drawing : '');
            if (!partNo || partNo.toLowerCase().replace(/\.$/, '') === 'part no' || partNo === 'Code') return;
            const price = parseQuoteRowPrice(row, map);
            const remark17 = String(rowCellVal(row, 17) || '').trim();
            const remark18 = cRemark ? String(rowCellVal(row, cRemark) || '').trim() : '';
            const vendorComment = remark17 || remark18 || null;
            rows.push({
                part_no: partNo,
                price,
                currency,
                vendor_comment: vendorComment,
                qty_approved: null,
                qty_received: null,
                current_stock: null,
                hq_comment: null,
            });
        });
        return rows.length ? { rows, ...meta } : null;
    }

    function isQuotePrintForm(map) {
        return map.remark != null || (map.price != null && map.req != null && map['qty requested'] == null);
    }

    /**
     * 회신 엑셀 파싱 → part_no 기준 행 배열.
     * 반환: [{ part_no, price, currency, vendor_comment, qty_approved, hq_comment }]
     */
    async function parseRequisitionFile(file, opts = {}) {
        if (!available()) throw new Error('ExcelJS 라이브러리가 로드되지 않았습니다.');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        const ws = wb.getWorksheet(SHEET) || wb.worksheets[0];
        if (!ws) throw new Error('시트를 찾을 수 없습니다.');

        const { map, headerRowNo } = buildHeaderMap(ws);
        if (isQuotePrintForm(map)) {
            const parsed = parseQuotePrintForm(ws, map, headerRowNo);
            if (parsed?.rows?.length) {
                if (opts.withMeta) return parsed;
                return parsed.rows;
            }
        }

        const col = (name) => map[name.toLowerCase()];
        const cPart = col('part no');
        if (!cPart) throw new Error("'Part No' 열을 찾을 수 없습니다.");

        const rows = [];
        ws.eachRow((row, rn) => {
            if (rn <= headerRowNo) return;
            const partNo = String(rowCellVal(row, cPart)).trim();
            if (!partNo) return;
            rows.push({
                part_no: partNo,
                price: parseNumCell(rowCellVal(row, col('unit price'))),
                currency: String(rowCellVal(row, col('currency')) || '').trim() || null,
                vendor_comment: String(rowCellVal(row, col('vendor comment')) || '').trim() || null,
                qty_approved: parseNumCell(rowCellVal(row, col('qty approved'))),
                qty_received: parseNumCell(rowCellVal(row, col('qty received'))) ?? parseNumCell(rowCellVal(row, col('qty approved'))),
                current_stock: parseNumCell(rowCellVal(row, col('current stock'))),
                hq_comment: String(rowCellVal(row, col('hq comment')) || '').trim() || null,
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
        await downloadBlob(buf, `SPARE-Parts-List-${dateStamp}.xlsx`);
        return true;
    }

    const SPARE_REQ_PRINT_TEMPLATE = 'data/spare-parts-requisition-template.xlsx';
    const SPARE_REQ_DATA_START_ROW = 28;
    const SPARE_REQ_HEADER_ROW = 27;
    const SPARE_REQ_MAX_COL = 18;
    const SPARE_REQ_TEMPLATE_MIN_ROW = 46;
    const SPARE_REQ_MAX_DATA_ROW = 35;

    const SPARE_QUOTE_PRINT_TEMPLATE = 'data/spare-parts-quotation-template.xlsx';
    const SPARE_QUOTE_DATA_START_ROW = 28;
    const SPARE_QUOTE_HEADER_ROW = 27;
    const SPARE_QUOTE_MAX_COL = 18;
    const SPARE_QUOTE_TEMPLATE_MIN_ROW = 34;
    const SPARE_QUOTE_MAX_DATA_ROW = 34;
    const SPARE_QUOTE_SUM_ROW = 26;
    const SPARE_QUOTE_YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

    function clearSpareQuoteTemplateRows(ws, fromRow = SPARE_QUOTE_DATA_START_ROW, toRow = SPARE_QUOTE_TEMPLATE_MIN_ROW) {
        for (let rn = fromRow; rn <= toRow; rn++) {
            const row = ws.getRow(rn);
            for (let c = 1; c <= SPARE_QUOTE_MAX_COL; c++) row.getCell(c).value = null;
        }
    }

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

    function cloneWorksheetFromTemplate(src, dst, opts = {}) {
        const maxCol = opts.maxCol || 15;
        const minRow = opts.minRow || 34;
        (src.columns || []).forEach((col, idx) => {
            if (col && col.width) dst.getColumn(idx + 1).width = col.width;
        });
        const maxRow = Math.max(src.rowCount || 0, minRow);
        for (let rn = 1; rn <= maxRow; rn++) {
            const srcRow = src.getRow(rn);
            const dstRow = dst.getRow(rn);
            if (srcRow.height) dstRow.height = srcRow.height;
            for (let colNumber = 1; colNumber <= maxCol; colNumber++) {
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
        if (src.headerFooter) {
            try { dst.headerFooter = JSON.parse(JSON.stringify(src.headerFooter)); } catch (_) { /* ignore */ }
        }
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
        for (let c = 1; c <= SPARE_REQ_MAX_COL; c++) cloneCellStyle(tpl.getCell(c), row.getCell(c));
    }

    function clearSpareReqTemplateRows(ws, fromRow = SPARE_REQ_DATA_START_ROW, toRow = SPARE_REQ_TEMPLATE_MIN_ROW) {
        for (let rn = fromRow; rn <= toRow; rn++) {
            const row = ws.getRow(rn);
            for (let c = 1; c <= SPARE_REQ_MAX_COL; c++) row.getCell(c).value = null;
        }
    }

    function applySpareQuoteDataRowStyle(ws, rowNum) {
        const tpl = ws.getRow(SPARE_QUOTE_DATA_START_ROW);
        const row = ws.getRow(rowNum);
        for (let c = 1; c <= SPARE_QUOTE_MAX_COL; c++) cloneCellStyle(tpl.getCell(c), row.getCell(c));
        [13, 14, 17, 18].forEach((c) => { row.getCell(c).fill = SPARE_QUOTE_YELLOW; });
    }

    function fillSpareQuotePrintSheet(ws, req, vesselName, page, ctx) {
        const fmt = typeof ctx.fmtDate === 'function' ? ctx.fmtDate : (d) => (d ? String(d).slice(0, 10) : '');
        const typeLabel = ctx.typeLabel || req.priority || 'ROUTINE';
        const dash = (v) => (v == null || v === '' ? '—' : v);
        const currency = String(ctx.currency || 'USD').trim().toUpperCase() || 'USD';
        const quoteMode = ctx.quoteMode === 'order' ? 'order' : 'vendor';
        const receivedDate = req.received_on || req.received_date || '';
        const receivedPort = String(req.received_port || '').trim();

        ws.getCell('C4').value = vesselName || '—';
        ws.getCell('K4').value = page.pageTotal;
        ws.getCell('C5').value = req.req_no || '—';
        ws.getCell('K5').value = typeLabel;
        ws.getCell('C6').value = `${dash(fmt(req.deliver_date_from) || null)} ~ ${dash(fmt(req.deliver_date_to) || null)}`;
        ws.getCell('K6').value = dash(fmt(req.made_on) || null);
        ws.getCell('O6').value = req.made_by || '—';
        ws.getCell('C7').value = req.deliver_port || '—';
        ws.getCell('K7').value = dash(fmt(req.assessed_on) || null);
        ws.getCell('O7').value = req.assessed_by || '—';
        ws.getCell('C8').value = dash(fmt(receivedDate) || null);
        ws.getCell('G8').value = receivedPort || '—';
        ws.getCell('K8').value = dash(fmt(req.ordered_on) || null);
        ws.getCell('O8').value = req.ordered_by || '—';

        ws.getCell('A12').value = req.ships_comments || '';

        ws.getCell('K11').value = String(ctx.vendorName || '').trim() || '—';
        ws.getCell('K12').value = '';
        ws.getCell('K13').value = '';
        ws.getCell('K15').value = '';

        const h = page.header || {};
        ws.getCell('A20').value = h.pmsGroupNo || page.groupKey || '—';
        ws.getCell('A23').value = h.maker || '—';
        ws.getCell('E23').value = h.modelType || '—';
        ws.getCell('I23').value = h.capacity || '—';
        ws.getCell('N23').value = h.serialNo || '—';

        clearSpareQuoteTemplateRows(ws);
        ws.getRow(35).eachCell({ includeEmpty: false }, (cell) => { cell.value = null; });

        const rows = page.rows || [];
        rows.forEach((r, idx) => {
            const rowNum = SPARE_QUOTE_DATA_START_ROW + idx;
            if (rowNum > SPARE_QUOTE_MAX_DATA_ROW) applySpareQuoteDataRowStyle(ws, rowNum);
            const row = ws.getRow(rowNum);
            const orderQty = quoteMode === 'order'
                ? spareReqCellValue(r.assess != null && r.assess !== '—' ? r.assess : r.request)
                : '';
            const price = quoteMode === 'order' && r.unitPrice != null ? spareReqCellValue(r.unitPrice) : '';
            row.getCell(1).value = r.lineNo;
            row.getCell(2).value = r.code ?? '';
            row.getCell(3).value = r.cls ?? '';
            row.getCell(4).value = r.dwg ?? '';
            row.getCell(5).value = r.pno ?? '';
            row.getCell(6).value = r.item ?? '';
            row.getCell(10).value = r.unit ?? '';
            row.getCell(11).value = spareReqCellValue(r.request);
            row.getCell(12).value = orderQty;
            row.getCell(13).value = price;
            row.getCell(14).value = price;
            if (!price) {
                row.getCell(13).fill = SPARE_QUOTE_YELLOW;
                row.getCell(14).fill = SPARE_QUOTE_YELLOW;
            }
            row.getCell(15).value = { formula: `K${rowNum}*M${rowNum}` };
            row.getCell(16).value = { formula: `K${rowNum}*M${rowNum}` };
            const remark = quoteMode === 'order' ? (r.vendorRemark || '') : '';
            row.getCell(17).value = remark;
            row.getCell(18).value = remark;
            if (!remark) {
                row.getCell(17).fill = SPARE_QUOTE_YELLOW;
                row.getCell(18).fill = SPARE_QUOTE_YELLOW;
            }
            row.commit();
        });

        const lastDataRow = Math.max(SPARE_QUOTE_MAX_DATA_ROW, SPARE_QUOTE_DATA_START_ROW + rows.length - 1);
        ws.getCell('K14').value = currency;
        ws.getCell('M26').value = currency;
        ws.getCell('N26').value = currency;
        ws.getCell('O26').value = { formula: `SUM(O${SPARE_QUOTE_DATA_START_ROW}:P${lastDataRow})` };
        ws.getCell('P26').value = { formula: `SUM(O${SPARE_QUOTE_DATA_START_ROW}:P${lastDataRow})` };
        ['M14', 'N14', 'O14', 'P14', 'Q14', 'R14'].forEach((addr) => {
            ws.getCell(addr).value = { formula: 'O26' };
        });

        const lastRow = Math.max(SPARE_QUOTE_TEMPLATE_MIN_ROW, SPARE_QUOTE_HEADER_ROW + rows.length);
        ws.pageSetup = { ...(ws.pageSetup || {}), printArea: `A1:R${lastRow}` };
        ws.pageSetup.orientation = 'landscape';
        ws.pageSetup.scale = 85;
        ws.pageSetup.fitToWidth = 1;
        ws.pageSetup.fitToHeight = 1;
        const footer = `&CPage ${page.pageIndex} of ${page.pageTotal}`;
        ws.headerFooter = { ...(ws.headerFooter || {}), oddFooter: footer, evenFooter: footer };
    }

    async function buildQuoteSparePartsWorkbook(ctx) {
        if (!available()) throw new Error('ExcelJS 라이브러리가 로드되지 않았습니다.');
        const pages = ctx?.pages || [];
        if (!pages.length) throw new Error('No items to export.');

        const res = await fetch(SPARE_QUOTE_PRINT_TEMPLATE);
        if (!res.ok) throw new Error('Quotation Excel template not found.');
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
            cloneWorksheetFromTemplate(src, ws, { maxCol: SPARE_QUOTE_MAX_COL, minRow: SPARE_QUOTE_TEMPLATE_MIN_ROW });
            fillSpareQuotePrintSheet(ws, ctx.req, ctx.vesselName, pages[i], ctx);
        }
        return outWb;
    }

    async function buildQuoteSparePartsRequisitionBuffer(ctx) {
        const wb = await buildQuoteSparePartsWorkbook(ctx);
        return wb.xlsx.writeBuffer();
    }

    async function exportQuoteSparePartsRequisitionForm(ctx) {
        const buf = await buildQuoteSparePartsRequisitionBuffer(ctx);
        const safeNo = String(ctx.req?.req_no || 'REQUISITION').replace(/[^\w\-]+/g, '_');
        const safeVendor = String(ctx.vendorName || 'VENDOR').replace(/[^\w\-]+/g, '_');
        await downloadBlob(buf, ctx.filename || `${safeNo}_${safeVendor}.xlsx`);
        return true;
    }

    function fillSpareReqPrintSheet(ws, req, vesselName, page, ctx) {
        const fmt = typeof ctx.fmtDate === 'function' ? ctx.fmtDate : (d) => (d ? String(d).slice(0, 10) : '');
        const typeLabel = ctx.typeLabel || req.priority || 'ROUTINE';
        const dash = (v) => (v == null || v === '' ? '—' : v);
        const vendor = ctx.vendorInfo || {};
        const receivedDate = req.received_on || req.received_date || '';
        const receivedPort = String(req.received_port || '').trim();

        ws.getCell('C4').value = vesselName || '—';
        ws.getCell('K4').value = page.pageTotal;
        ws.getCell('C5').value = req.req_no || '—';
        ws.getCell('K5').value = typeLabel;
        ws.getCell('C6').value = `${dash(fmt(req.deliver_date_from) || null)} ~ ${dash(fmt(req.deliver_date_to) || null)}`;
        ws.getCell('K6').value = dash(fmt(req.made_on) || null);
        ws.getCell('O6').value = req.made_by || '—';
        ws.getCell('C7').value = req.deliver_port || '—';
        ws.getCell('K7').value = dash(fmt(req.assessed_on) || null);
        ws.getCell('O7').value = req.assessed_by || '—';
        ws.getCell('C8').value = dash(fmt(receivedDate) || null);
        ws.getCell('G8').value = receivedPort || '—';
        ws.getCell('K8').value = dash(fmt(req.ordered_on) || null);
        ws.getCell('O8').value = req.ordered_by || '—';

        ws.getCell('A12').value = req.ships_comments || '';

        ws.getCell('K11').value = String(vendor.vendorName || '').trim() || '—';
        ws.getCell('K12').value = vendor.refNo || '';
        ws.getCell('K13').value = vendor.quotedDate ? dash(fmt(vendor.quotedDate) || vendor.quotedDate) : '';
        if (vendor.totalAmount != null && vendor.totalAmount !== '') {
            ws.getCell('K14').value = spareReqCellValue(vendor.totalAmount);
            if (vendor.currency) ws.getCell('M14').value = String(vendor.currency).trim().toUpperCase();
        }
        ws.getCell('K15').value = vendor.comments || req.vendor_comments || '';
        ws.getCell('K16').value = vendor.field16 || '';
        ws.getCell('K17').value = vendor.field17 || '';

        const h = page.header || {};
        ws.getCell('A20').value = h.pmsGroupNo || page.groupKey || '—';
        ws.getCell('A23').value = h.maker || '—';
        ws.getCell('E23').value = h.modelType || '—';
        ws.getCell('I23').value = h.capacity || '—';
        ws.getCell('N23').value = h.serialNo || '—';

        clearSpareReqTemplateRows(ws);

        const rows = page.rows || [];
        rows.forEach((r, idx) => {
            const rowNum = SPARE_REQ_DATA_START_ROW + idx;
            if (rowNum > SPARE_REQ_MAX_DATA_ROW) applySpareReqDataRowStyle(ws, rowNum);
            const row = ws.getRow(rowNum);
            row.getCell(1).value = r.lineNo;
            row.getCell(2).value = r.code ?? '';
            row.getCell(3).value = r.cls ?? '';
            row.getCell(4).value = r.dwg ?? '';
            row.getCell(5).value = r.pno ?? '';
            row.getCell(6).value = r.item ?? '';
            row.getCell(10).value = r.unit ?? '';
            row.getCell(11).value = spareReqCellValue(r.working);
            row.getCell(12).value = spareReqCellValue(r.std);
            row.getCell(13).value = spareReqCellValue(r.stock);
            row.getCell(14).value = spareReqCellValue(r.awaiting);
            row.getCell(15).value = spareReqCellValue(r.need);
            row.getCell(16).value = spareReqCellValue(r.request);
            row.getCell(17).value = spareReqCellValue(r.assess);
            row.getCell(18).value = spareReqCellValue(r.rcvd);
            row.commit();
        });

        const lastRow = Math.max(SPARE_REQ_TEMPLATE_MIN_ROW, SPARE_REQ_HEADER_ROW + rows.length);
        ws.pageSetup = { ...(ws.pageSetup || {}), printArea: `A1:R${lastRow}` };
        ws.pageSetup.orientation = 'landscape';
        ws.pageSetup.scale = 72;
        ws.pageSetup.fitToWidth = 1;
        ws.pageSetup.fitToHeight = 1;
        const footer = `&CPage ${page.pageIndex} of ${page.pageTotal}`;
        ws.headerFooter = { ...(ws.headerFooter || {}), oddFooter: footer, evenFooter: footer };
    }

    async function buildSparePartsRequisitionWorkbook(ctx) {
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
            cloneWorksheetFromTemplate(src, ws, { maxCol: SPARE_REQ_MAX_COL, minRow: SPARE_REQ_TEMPLATE_MIN_ROW });
            fillSpareReqPrintSheet(ws, ctx.req, ctx.vesselName, pages[i], ctx);
        }
        return outWb;
    }

    async function buildSparePartsRequisitionBuffer(ctx) {
        const wb = await buildSparePartsRequisitionWorkbook(ctx);
        return wb.xlsx.writeBuffer();
    }

    /**
     * SPARE PARTS REQUISITION 인쇄 양식 → xlsx (Print/Preview와 동일 레이아웃)
     * @param {{ req, vesselName, typeLabel?, fmtDate?, pages }} ctx
     *   pages: [{ pageIndex, pageTotal, groupKey, header, rows }]
     */
    async function exportSparePartsRequisitionForm(ctx) {
        const buf = await buildSparePartsRequisitionBuffer(ctx);
        const safeNo = String(ctx.req?.req_no || 'REQUISITION').replace(/[^\w\-]+/g, '_');
        await downloadBlob(buf, ctx.filename || `${safeNo}-requisition.xlsx`);
        return true;
    }

    return {
        available, exportRequisition, exportQuoteRequisition, parseRequisitionFile, parseVendorQuoteFile: (file) => parseRequisitionFile(file, { withMeta: true }), exportSparePartsList,
        exportSparePartsRequisitionForm, buildQuoteSparePartsRequisitionBuffer, exportQuoteSparePartsRequisitionForm,
        buildSparePartsRequisitionBuffer,
        COLS, SPARE_LIST_COLS,
    };
})();
