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

    return { available, exportRequisition, parseRequisitionFile, COLS };
})();
