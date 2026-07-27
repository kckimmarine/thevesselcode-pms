/* THE VESSEL CODE — IndexedDB Layer (Offline-First) */

/**
 * SPICS spare inventory (.xls / .xlsx / .csv) — Equipment vs SparePart 분리 파서
 * spare inventory.xls ENGINE 시트 구조 기준 (정규식 행 분류)
 */
const TVC_SpareInventoryParser = (function () {
    const COL = {
        PC: 0, NUMBERING: 1, CLASS: 2, ITEMS: 3, PART_NO: 4, UNIT: 5,
        PREV_STOCK: 6, RECEIVED: 7, CONSUMPTION: 8, STOCK_A: 9, STOCK_B: 10, REMARK: 11,
    };

    const RE = {
        EQUIP_PC: /^PC$/i,
        VERSION: /^\d+\.\d+$/,
        SECTION_NUM: /^\d{2}-\d{3}$/,
        PART_NUM: /^\d{2}-\d{3}-\d{2,3}$/,
        PART_NUM_ALT: /^\d{2}\.\d{3}-\d{2}$/,
        PART_CLASS: /^[GL]$/i,
        GROUP_LABEL: /^\d{2}(\.\s|\~|\s)/,
        SHEET_TITLE: /Sheet\s*No/i,
    };

    function cell(row, i) { return sanitizeText(row[i]); }
    function padRow(row, len) {
        const out = (row || []).map(c => sanitizeText(c));
        while (out.length < len) out.push('');
        return out;
    }

    /** 공백·제어문자·불필요 특수문자 제거 */
    function sanitizeText(s) {
        return String(s ?? '')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/[\u0000-\u001F\u007F]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** Part Number / Numbering 정제 */
    function sanitizePartNumber(s) {
        return sanitizeText(s).replace(/[^\w.\-/&]/g, '').trim();
    }

    /** Items(Description) 정제 */
    function sanitizeItems(s) {
        return sanitizeText(s).replace(/\s{2,}/g, ' ').trim();
    }

    /** Equipment Header 감지 — MAIN ENGINE, GENERATOR ENGINE 등 */
    function isEquipmentHeaderName(name) {
        const n = sanitizeItems(name).toUpperCase();
        return /MAIN\s+ENGINE|GENERATOR\s+ENGINE|PURIFIER|BOILER|PUMP|M\/E|G\/E/.test(n)
            && !RE.SHEET_TITLE.test(name);
    }

    /** CSV 텍스트 → 2D 배열 */
    function parseCsvText(text) {
        const rows = [];
        let row = [], cur = '', inQ = false;
        const s = String(text || '').replace(/^\uFEFF/, '');
        for (let i = 0; i < s.length; i++) {
            const ch = s[i], nx = s[i + 1];
            if (inQ) {
                if (ch === '"' && nx === '"') { cur += '"'; i++; }
                else if (ch === '"') inQ = false;
                else cur += ch;
                continue;
            }
            if (ch === '"') { inQ = true; continue; }
            if (ch === ',') { row.push(cur); cur = ''; continue; }
            if (ch === '\n' || (ch === '\r' && nx === '\n')) {
                row.push(cur); rows.push(row); row = []; cur = '';
                if (ch === '\r') i++;
                continue;
            }
            if (ch === '\r') continue;
            cur += ch;
        }
        if (cur.length || row.length) { row.push(cur); rows.push(row); }
        return rows.filter(r => r.some(c => String(c).trim()));
    }

    function findHeaderRow(rows) {
        for (let i = 0; i < Math.min(rows.length, 30); i++) {
            const c0 = cell(rows[i], 0).toLowerCase();
            const c1 = cell(rows[i], 1).toLowerCase();
            if (c0 === 'pc' && c1 === 'numbering') return i;
        }
        for (let i = 0; i < Math.min(rows.length, 25); i++) {
            const line = rows[i].map(c => String(c ?? '').toLowerCase());
            if (line.some(c => c.includes('previous stock')) && line.some(c => /part number|numbering/.test(c))) {
                return i;
            }
        }
        return 5;
    }

    /** 장비 / 섹션 / 부품 행 분류 */
    function classifyRow(c) {
        const c0 = cell(c, COL.PC), c1 = cell(c, COL.NUMBERING), c2 = cell(c, COL.CLASS);
        const c3 = cell(c, COL.ITEMS), c4 = cell(c, COL.PART_NO);
        if (c0.toLowerCase() === 'pc' && c1.toLowerCase() === 'numbering') return 'SKIP';
        if (c3.toLowerCase() === 'items' && RE.EQUIP_PC.test(c0)) return 'SKIP';
        if (!c0 && !c1 && !c2 && !c3 && !c4) return 'SKIP';
        if (RE.EQUIP_PC.test(c0) && RE.VERSION.test(c2) && c3) return 'EQUIPMENT';
        if (c3 && isEquipmentHeaderName(c3) && !RE.PART_NUM.test(c1) && !RE.PART_NUM_ALT.test(c1)) return 'EQUIPMENT';
        if (RE.PART_NUM.test(c1) || RE.PART_NUM_ALT.test(c1)) return 'SPARE_PART';
        if (RE.SECTION_NUM.test(c1) && c3) return 'SECTION';
        if (c3 && RE.SHEET_TITLE.test(c3)) return 'SECTION';
        if (c3 && !c1 && !c2 && !RE.EQUIP_PC.test(c0)) return 'SECTION';
        return 'SKIP';
    }

    function partNoFrom(c) {
        return sanitizePartNumber(cell(c, COL.NUMBERING));
    }

    function mapSparePart(c, ctx, uicCode) {
        const name = sanitizeItems(cell(c, COL.ITEMS));
        const numbering = partNoFrom(c);
        if (!numbering || !name) return null;

        const prev = TVC_SpareSchema.intStock(cell(c, COL.PREV_STOCK));
        const recv = TVC_SpareSchema.intStock(cell(c, COL.RECEIVED));
        const cons = TVC_SpareSchema.intStock(cell(c, COL.CONSUMPTION));
        const stockA = TVC_SpareSchema.intStock(cell(c, COL.STOCK_A));
        const stockB = TVC_SpareSchema.intStock(cell(c, COL.STOCK_B));
        const current = stockA + stockB;
        const pClass = TVC_SpareSchema.normalizePartClass(cell(c, COL.CLASS));
        const unitRaw = cell(c, COL.UNIT) || 'EA';
        const unit = /^PC$/i.test(unitRaw) ? 'EA' : unitRaw.toUpperCase();
        const drawingNo = sanitizePartNumber(cell(c, COL.PART_NO));

        const part = {
            makerPartNo: numbering,
            inventoryNumbering: numbering,
            name,
            drawingPartNo: drawingNo,
            previousStock: prev,
            currentStock: current,
            stockA,
            stockB,
            receivedQty: recv,
            consumptionQty: cons,
            workingQty: 0,
            minStock: 0,
            standardStock: 0,
            partClass: pClass,
            isCritical: pClass === 'L',
            unit,
            category: ctx.department || 'ENGINE',
            group: (ctx.groupLabel || '').trim(),
            location: [ctx.groupLabel, ctx.sectionTitle].filter(Boolean).join(' · '),
            shipComponentId: ctx.sectionId || ctx.groupId || ctx.equipmentId || '',
            parentEquipmentID: ctx.equipmentId || '',
            vendorComment: sanitizeText(cell(c, COL.REMARK)),
            universalItemCode: uicCode,
        };
        return part;
    }

    /**
     * 2D rows → { equipment, spares, stats }
     * @param {string[][]} rows
     * @param {{ department?: string, sheetName?: string }} opts
     */
    function parseRows(rows, opts = {}) {
        const department = String(opts.department || opts.sheetName || 'ENGINE').trim().toUpperCase();
        const headerIdx = findHeaderRow(rows);
        const dataRows = rows.slice(headerIdx + 1);

        const equipment = [];
        const equipmentById = new Map();
        const spares = [];
        let sortOrder = 0;
        let uicSeq = 0;
        const uicPrefix = TVC_SpareSchema.uicPrefixForDepartment(department);
        const nextUic = () => TVC_SpareSchema.generateSequentialUic(uicPrefix, ++uicSeq);

        const ctx = {
            department,
            equipmentId: null,
            equipmentName: '',
            groupId: null,
            groupLabel: '',
            sectionId: null,
            sectionCode: '',
            sectionTitle: '',
            path: [department],
            remark: '',
            sortOrder: 0,
        };

        function setParentEquipment(eq) {
            ctx.equipmentId = eq.id;
            ctx.equipmentName = sanitizeItems(eq.label || eq.machinery_name || eq.component_name);
        }

        function pushEquipment(rec) {
            if (equipmentById.has(rec.id)) return equipmentById.get(rec.id);
            rec.sort_order = ++sortOrder;
            rec.updated_at = new Date().toISOString();
            equipment.push(rec);
            equipmentById.set(rec.id, rec);
            return rec;
        }

        for (const raw of dataRows) {
            const c = padRow(raw, 12);
            const kind = classifyRow(c);

            if (kind === 'EQUIPMENT') {
                ctx.equipmentName = sanitizeItems(cell(c, COL.ITEMS));
                ctx.remark = sanitizeText(cell(c, COL.REMARK) || cell(c, COL.PREV_STOCK));
                ctx.path = [department, ctx.equipmentName];
                ctx.groupId = null;
                ctx.groupLabel = '';
                ctx.sectionId = null;
                ctx.sectionCode = '';
                ctx.sectionTitle = '';
                const eq = pushEquipment(TVC_EquipmentSchema.fromInventory(ctx, 'TOP'));
                setParentEquipment(eq);
                continue;
            }

            if (kind === 'SECTION') {
                const c0 = cell(c, COL.PC);
                const c1 = cell(c, COL.NUMBERING);
                const c3 = cell(c, COL.ITEMS);

                if (c0 && (RE.GROUP_LABEL.test(c0) || /GENERATOR|ENGINE|PUMP|PURIFIER/i.test(c0)) && RE.SECTION_NUM.test(c1)) {
                    ctx.groupLabel = c0.replace(/\s+/g, ' ').trim();
                    ctx.sectionCode = c1;
                    ctx.sectionTitle = c3;
                    ctx.path = [department, ctx.equipmentName || ctx.groupLabel, ctx.groupLabel, c3].filter(Boolean);
                    if (!ctx.groupId || ctx.groupLabel) {
                        const grp = pushEquipment(TVC_EquipmentSchema.fromInventory(ctx, 'GROUP'));
                        ctx.groupId = grp.id;
                    }
                    const sec = pushEquipment(TVC_EquipmentSchema.fromInventory(ctx, 'SECTION'));
                    ctx.sectionId = sec.id;
                    continue;
                }

                if (c0 && RE.GROUP_LABEL.test(c0)) {
                    ctx.groupLabel = c0.replace(/\s+/g, ' ').trim();
                    ctx.path = [department, ctx.equipmentName || ctx.groupLabel, ctx.groupLabel];
                    const grp = pushEquipment(TVC_EquipmentSchema.fromInventory(ctx, 'GROUP'));
                    ctx.groupId = grp.id;
                }

                if (RE.SECTION_NUM.test(c1)) {
                    ctx.sectionCode = c1;
                    ctx.sectionTitle = c3;
                    ctx.path = [department, ctx.equipmentName, ctx.groupLabel, c3].filter(Boolean);
                    const sec = pushEquipment(TVC_EquipmentSchema.fromInventory(ctx, 'SECTION'));
                    ctx.sectionId = sec.id;
                } else if (c3) {
                    ctx.sectionTitle = c3;
                }
                continue;
            }

            if (kind === 'SPARE_PART') {
                const part = mapSparePart(c, ctx, nextUic());
                if (part) spares.push(part);
            }
        }

        return {
            equipment,
            spares,
            stats: {
                department,
                uicPrefix,
                headerRow: headerIdx,
                dataRows: dataRows.length,
                equipment: equipment.length,
                spares: spares.length,
                skipped: dataRows.length - spares.length,
            },
        };
    }

    /**
     * CSV 텍스트를 한 줄씩 파싱 — Equipment Header → parentEquipmentID 추적
     * @param {string} csvText
     * @param {{ department?: string, sheetName?: string }} opts
     */
    function parseCsvLineByLine(csvText, opts = {}) {
        const rows = parseCsvText(csvText);
        return parseRows(rows, opts);
    }

    /** ExcelJS worksheet → 2D array */
    function worksheetToRows(ws) {
        const rows = [];
        ws.eachRow({ includeEmpty: true }, (row) => {
            const cells = [];
            row.eachCell({ includeEmpty: true }, (cell, col) => {
                while (cells.length < col - 1) cells.push('');
                cells[col - 1] = cell.text != null ? String(cell.text).trim() : '';
            });
            rows.push(cells);
        });
        return rows;
    }

    /** SheetJS sheet → 2D array */
    function xlsxSheetToRows(sheet) {
        if (!sheet || !sheet['!ref']) return [];
        const range = window.XLSX.utils.decode_range(sheet['!ref']);
        const rows = [];
        for (let r = range.s.r; r <= range.e.r; r++) {
            const row = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
                const addr = window.XLSX.utils.encode_cell({ r, c });
                const cell = sheet[addr];
                row.push(cell ? String(cell.w ?? cell.v ?? '').trim() : '');
            }
            rows.push(row);
        }
        return rows;
    }

    /**
     * File(Blob) → parseRows (브라우저)
     * .csv / .xlsx(ExcelJS) / .xls(SheetJS)
     */
    async function parseFile(file, opts = {}) {
        if (!file) throw Object.assign(new Error('파일이 없습니다.'), { code: 'NO_FILE' });
        const name = (file.name || '').toLowerCase();
        const sheetName = opts.sheetName || (name.includes('engine') ? 'ENGINE' : null);

        if (name.endsWith('.csv')) {
            const text = await file.text();
            return parseCsvLineByLine(text, { ...opts, sheetName: sheetName || 'ENGINE' });
        }

        if (name.endsWith('.xlsx') && typeof window.ExcelJS !== 'undefined') {
            const buf = await file.arrayBuffer();
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf);
            const ws = sheetName ? wb.getWorksheet(sheetName) : (wb.worksheets[0]);
            if (!ws) throw Object.assign(new Error(`시트 "${sheetName}" 를 찾을 수 없습니다.`), { code: 'NO_SHEET' });
            return parseRows(worksheetToRows(ws), { ...opts, sheetName: ws.name });
        }

        if ((name.endsWith('.xls') || name.endsWith('.xlsx')) && typeof window.XLSX !== 'undefined') {
            const buf = await file.arrayBuffer();
            const wb = window.XLSX.read(buf, { type: 'array' });
            const sn = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
            return parseRows(xlsxSheetToRows(wb.Sheets[sn]), { ...opts, sheetName: sn });
        }

        throw Object.assign(new Error('지원 형식: .csv, .xls, .xlsx'), { code: 'UNSUPPORTED' });
    }

    return {
        parseCsvText, parseCsvLineByLine, parseRows, parseFile,
        classifyRow, findHeaderRow, sanitizeText, sanitizePartNumber, COL, RE,
    };
})();

const TVC_DB = (function () {
    let db = null;

    function open() {
        if (db) return Promise.resolve(db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(TVC_SCHEMA.DB_NAME, TVC_SCHEMA.DB_VERSION);
            req.onupgradeneeded = (e) => {
                const database = e.target.result;
                const tx = e.target.transaction; // version-change tx (기존 store 접근용)
                for (const [name, cfg] of Object.entries(TVC_SCHEMA.STORES)) {
                    let store;
                    if (!database.objectStoreNames.contains(name)) {
                        // 신규 store 생성 + 인덱스 부여
                        store = database.createObjectStore(name, {
                        keyPath: cfg.keyPath,
                        autoIncrement: !!cfg.autoIncrement,
                    });
                    } else {
                        // 기존 store: 누락된 인덱스만 추가 (파괴적 재생성 금지 → 하위호환)
                        store = tx.objectStore(name);
                    }
                    (TVC_SCHEMA.INDEXES[name] || []).forEach(idx => {
                        if (!store.indexNames.contains(idx.name)) {
                        store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
                        }
                    });
                }
            };
            req.onsuccess = () => { db = req.result; resolve(db); };
            req.onerror = () => reject(req.error);
        });
    }

    function tx(storeNames, mode = 'readonly') {
        return db.transaction(storeNames, mode);
    }

    function getAll(storeName) {
        return new Promise((resolve, reject) => {
            const r = tx(storeName).objectStore(storeName).getAll();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
        });
    }

    function get(storeName, key) {
        return new Promise((resolve, reject) => {
            const r = tx(storeName).objectStore(storeName).get(key);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    }

    function put(storeName, value) {
        return new Promise((resolve, reject) => {
            const r = tx(storeName, 'readwrite').objectStore(storeName).put(value);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    }

    function del(storeName, key) {
        return new Promise((resolve, reject) => {
            const r = tx(storeName, 'readwrite').objectStore(storeName).delete(key);
            r.onsuccess = () => resolve(true);
            r.onerror = () => reject(r.error);
        });
    }

    function bulkPut(storeName, values) {
        return new Promise((resolve, reject) => {
            const t = tx(storeName, 'readwrite');
            const store = t.objectStore(storeName);
            values.forEach(v => store.put(v));
            t.oncomplete = () => resolve(values.length);
            t.onerror = () => reject(t.error);
        });
    }

    function getMeta(key) {
        return get('meta', key).then(r => r?.value);
    }

    function setMeta(key, value) {
        return put('meta', { key, value });
    }

    function indexGetAll(storeName, indexName, query) {
        return new Promise((resolve, reject) => {
            const store = tx(storeName).objectStore(storeName);
            const idx = store.index(indexName);
            const r = query === undefined ? idx.getAll() : idx.getAll(query);
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
        });
    }

    async function runTransaction(storeNames, fn) {
        await open();
        return new Promise((resolve, reject) => {
            const t = tx(storeNames, 'readwrite');
            const api = {
                get: (s, k) => new Promise((res, rej) => {
                    const r = t.objectStore(s).get(k);
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                }),
                getAll: (s) => new Promise((res, rej) => {
                    const r = t.objectStore(s).getAll();
                    r.onsuccess = () => res(r.result || []);
                    r.onerror = () => rej(r.error);
                }),
                put: (s, v) => new Promise((res, rej) => {
                    const r = t.objectStore(s).put(v);
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                }),
                del: (s, k) => new Promise((res, rej) => {
                    const r = t.objectStore(s).delete(k);
                    r.onsuccess = () => res(true);
                    r.onerror = () => rej(r.error);
                }),
            };
            Promise.resolve(fn(api, t))
                .then(resolve)
                .catch(reject);
            t.onerror = () => reject(t.error);
        });
    }

    async function clearAll() {
        await open();
        const names = Object.keys(TVC_SCHEMA.STORES);
        return new Promise((resolve, reject) => {
            const t = tx(names, 'readwrite');
            names.forEach(n => t.objectStore(n).clear());
            t.oncomplete = () => resolve();
            t.onerror = () => reject(t.error);
        });
    }

    // ── SparePart CRUD (SPICS) ────────────────────────────────────────
    const SparePart = (function () {
        const STORE = 'spare_parts';
        const now = () => new Date().toISOString();

        function markPending(row) {
            row.sync_status = row.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (row.sync_status || 'LOCAL');
            row.updated_at = now();
            return row;
        }

        async function listAll() {
            const rows = await getAll(STORE);
            return rows.map(TVC_SpareSchema.fromRow).sort((a, b) =>
                (a.makerPartNo || '').localeCompare(b.makerPartNo || ''));
        }

        async function getById(id) {
            return TVC_SpareSchema.fromRow(await get(STORE, id));
        }

        async function getByPartNo(partNo) {
            const rows = await indexGetAll(STORE, 'by_part_no', String(partNo).trim());
            return rows.length ? TVC_SpareSchema.fromRow(rows[0]) : null;
        }

        async function listByCategory(category) {
            const rows = category
                ? await indexGetAll(STORE, 'by_category', category)
                : await getAll(STORE);
            return rows.map(TVC_SpareSchema.fromRow);
        }

        async function create(part) {
            const draft = { ...part };
            if (!draft.universalItemCode && !draft.universalCode) {
                draft.universalItemCode = TVC_SpareSchema.generateUniversalItemCode(draft.name || draft.makerPartNo);
            }
            const canonical = TVC_SpareSchema.validate(draft);
            const row = TVC_SpareSchema.toRow(canonical);
            row.id = row.id || 'SP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            const dup = await getByPartNo(row.part_no);
            if (dup) throw Object.assign(new Error(`Part No "${row.part_no}" already exists.`), { code: 'DUP' });
            markPending(row);
            await put(STORE, row);
            return TVC_SpareSchema.fromRow(row);
        }

        async function update(part) {
            if (!part.id) throw Object.assign(new Error('id required for update'), { code: 'VALIDATION' });
            const existing = await get(STORE, part.id);
            if (!existing) throw Object.assign(new Error('SPARE_NOT_FOUND'), { code: 'NOT_FOUND' });
            const canonical = TVC_SpareSchema.validate({ ...TVC_SpareSchema.fromRow(existing), ...part });
            const row = TVC_SpareSchema.toRow(canonical);
            row.id = part.id;
            if (row.part_no !== existing.part_no) {
                const dup = await getByPartNo(row.part_no);
                if (dup && dup.id !== row.id) throw Object.assign(new Error(`Part No "${row.part_no}" already exists.`), { code: 'DUP' });
            }
            row.history = row.history.length ? row.history : (existing.history || []);
            markPending(row);
            await put(STORE, row);
            return TVC_SpareSchema.fromRow(row);
        }

        async function remove(id) {
            await del(STORE, id);
            return true;
        }

        /** 재고 차감 + history 기록 */
        async function deductStock(id, qty, historyEntry) {
            const row = await get(STORE, id);
            if (!row) throw Object.assign(new Error('SPARE_NOT_FOUND'), { code: 'NOT_FOUND' });
            const q = Math.max(0, Math.floor(Number(qty) || 0));
            if (q <= 0) return TVC_SpareSchema.fromRow(row);
            row.qty_on_hand = Math.max(0, (Number(row.qty_on_hand) || 0) - q);
            row.history = Array.isArray(row.history) ? row.history : [];
            row.history.push({
                at: now(),
                type: historyEntry?.type || 'DEDUCT',
                qty: -q,
                ref: historyEntry?.ref || '',
                note: historyEntry?.note || '',
            });
            markPending(row);
            await put(STORE, row);
            return TVC_SpareSchema.fromRow(row);
        }

        /** 재고 증가 + history (입고/엑셀 반영) */
        async function addStock(id, qty, historyEntry) {
            const row = await get(STORE, id);
            if (!row) throw Object.assign(new Error('SPARE_NOT_FOUND'), { code: 'NOT_FOUND' });
            const q = Math.max(0, Math.floor(Number(qty) || 0));
            row.qty_on_hand = (Number(row.qty_on_hand) || 0) + q;
            row.history = Array.isArray(row.history) ? row.history : [];
            if (q > 0) {
                row.history.push({
                    at: now(),
                    type: historyEntry?.type || 'RECEIPT',
                    qty: q,
                    ref: historyEntry?.ref || '',
                    note: historyEntry?.note || '',
                });
            }
            markPending(row);
            await put(STORE, row);
            return TVC_SpareSchema.fromRow(row);
        }

        /** price / vendorComment / stock 일괄 반영 (엑셀 import) */
        async function applyVendorUpdate(partNo, patch) {
            const found = await getByPartNo(partNo);
            if (!found) return null;
            const row = await get(STORE, found.id);
            if (!row) return null;
            if (patch.price != null) row.price = Number(patch.price);
            if (patch.currency) row.currency = patch.currency;
            if (patch.vendor_comment != null) row.vendor_comment = String(patch.vendor_comment);
            if (patch.qty_received != null && patch.qty_received > 0) {
                row.qty_on_hand = (Number(row.qty_on_hand) || 0) + Math.floor(patch.qty_received);
                row.history = Array.isArray(row.history) ? row.history : [];
                row.history.push({
                    at: now(), type: 'VENDOR_IMPORT', qty: patch.qty_received,
                    price: patch.price != null ? Number(patch.price) : undefined,
                    vendorComment: patch.vendor_comment || '',
                    ref: patch.ref || '', note: patch.vendor_comment || '',
                });
            }
            markPending(row);
            await put(STORE, row);
            return TVC_SpareSchema.fromRow(row);
        }

        /**
         * 시스템 부팅 시 SparePart 로컬 DB 정규화·동기화.
         * UniversalItemCode / minStock / history 누락 레코드를 보강한다 (idempotent).
         */
        async function syncOnBoot() {
            await open();
            const rows = await getAll(STORE);
            let migrated = 0;
            for (const row of rows) {
                let changed = false;
                if (!TVC_SpareSchema.universalItemCodeOf(row)) {
                    row.universal_code = TVC_SpareSchema.generateUniversalItemCode(row.name || row.part_no);
                    row.universal_item_code = row.universal_code;
                    changed = true;
                }
                if (row.min_qty == null) { row.min_qty = Number(row.standard_stock || 0) || 0; changed = true; }
                if (row.standard_stock == null) { row.standard_stock = row.min_qty; changed = true; }
                if (!Array.isArray(row.history)) { row.history = []; changed = true; }
                if (row.schema_version == null) { row.schema_version = TVC_SpareSchema.SCHEMA_VERSION; changed = true; }
                if (row.category == null) { row.category = (row.name || '').split(' ')[0] || 'GENERAL'; changed = true; }
                if (row.qty_working == null) { row.qty_working = 0; changed = true; }
                if (changed) { markPending(row); await put(STORE, row); migrated++; }
            }
            await setMeta(TVC_META_KEYS.SPICS_SYNC, now());
            return { total: rows.length, migrated, parts: rows.map(TVC_SpareSchema.fromRow) };
        }

        return { listAll, getById, getByPartNo, listByCategory, create, update, remove, deductStock, addStock, applyVendorUpdate, syncOnBoot };
    })();

    /**
     * inventory_history — SPICS 입·출고 전용 이력 (날짜/시간/작업자/품목/증감/잔여)
     */
    const InventoryHistory = (function () {
        const STORE = 'inventory_history';

        function stamp() {
            const ts = new Date();
            const at = ts.toISOString();
            return { at, date: at.slice(0, 10), time: at.slice(11, 19) };
        }

        /** @param {object} entry */
        async function append(entry) {
            const { at, date, time } = stamp();
            const row = {
                id: entry.id || ('IH-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
                at: entry.at || at,
                date: entry.date || date,
                time: entry.time || time,
                tx_type: entry.tx_type,
                spare_part_id: entry.spare_part_id || '',
                part_no: entry.part_no || '',
                part_name: entry.part_name || '',
                universal_code: entry.universal_code || '',
                qty_delta: Number(entry.qty_delta) || 0,
                qty_after: Number(entry.qty_after) || 0,
                operator_id: entry.operator_id || '',
                operator_name: entry.operator_name || '',
                department: entry.department || '',
                ref: entry.ref || '',
                note: entry.note || '',
                sync_status: entry.sync_status || 'LOCAL',
                updated_at: entry.updated_at || at,
            };
            await put(STORE, row);
            return row;
        }

        async function listAll() {
            const rows = await getAll(STORE);
            return rows.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
        }

        async function listBySpare(sparePartId, limit = 50) {
            const rows = await indexGetAll(STORE, 'by_spare', sparePartId);
            return rows.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, limit);
        }

        async function listByType(txType, limit = 100) {
            const rows = await indexGetAll(STORE, 'by_type', txType);
            return rows.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, limit);
        }

        async function listRecent(limit = 100) {
            const rows = await listAll();
            return rows.slice(0, limit);
        }

        return { append, listAll, listBySpare, listByType, listRecent };
    })();

    /**
     * 파싱 결과 → IndexedDB 적재 (Equipment + SparePart)
     * @param {{ equipment: object[], spares: object[] }} parsed
     * @param {{ merge?: boolean, department?: string }} opts
     */
    async function importSpareInventory(parsed, opts = {}) {
        await open();
        const merge = opts.merge !== false;
        const ts = new Date().toISOString();
        let equipmentCount = 0;
        let spareCreated = 0;
        let spareUpdated = 0;
        const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

        const existingComponents = await getAll('ship_components');
        const compById = new Map(existingComponents.map(c => [c.id, c]));
        const equipBatch = [];

        for (const eq of parsed.equipment || []) {
            const prev = compById.get(eq.id);
            const row = prev ? { ...prev, ...eq, updated_at: ts } : { ...eq, sync_status: 'LOCAL', updated_at: ts };
            equipBatch.push(row);
            compById.set(row.id, row);
            equipmentCount++;
        }
        if (equipBatch.length) await bulkPut('ship_components', equipBatch);

        const existingSpares = await getAll('spare_parts');
        const byPartNo = new Map(
            existingSpares.map(r => [String(r.part_no || '').toLowerCase(), r])
        );
        const spareBatch = [];
        const total = (parsed.spares || []).length;

        for (let i = 0; i < total; i++) {
            const draft = parsed.spares[i];
            const canonical = { ...draft };
            if (!canonical.universalItemCode) {
                canonical.universalItemCode = TVC_SpareSchema.generateUniversalItemCode(
                    canonical.name + '|' + canonical.makerPartNo
                );
            }
            const row = TVC_SpareSchema.toRow(canonical);
            const key = String(row.part_no || '').toLowerCase();
            const existing = key ? byPartNo.get(key) : null;

            if (existing && merge) {
                row.id = existing.id;
                if (String(existing.group || '').trim()) row.group = existing.group;
                const existingClass = TVC_SpareSchema.normalizePartClass(existing.part_class);
                if (existingClass) row.part_class = existingClass;
                row.history = Array.isArray(existing.history) ? existing.history.slice() : [];
                row.history.push({
                    at: ts,
                    type: 'INVENTORY_IMPORT',
                    qty: row.qty_on_hand - (Number(existing.qty_on_hand) || 0),
                    note: `Import ${opts.department || parsed.stats?.department || ''}`,
                });
                row.sync_status = existing.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (existing.sync_status || 'LOCAL');
                spareUpdated++;
            } else if (!existing) {
                row.id = row.id || ('SP-' + Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2, 5));
                row.history = [{ at: ts, type: 'INVENTORY_IMPORT', qty: row.qty_on_hand, note: 'Initial import' }];
                row.sync_status = 'LOCAL';
                spareCreated++;
            } else {
                continue;
            }
            spareBatch.push(row);
            byPartNo.set(key, row);
            if (onProgress && (i % 50 === 0 || i === total - 1)) onProgress(i + 1, total);
        }

        const CHUNK = 250;
        for (let i = 0; i < spareBatch.length; i += CHUNK) {
            await bulkPut('spare_parts', spareBatch.slice(i, i + CHUNK));
            if (onProgress) onProgress(Math.min(i + CHUNK, spareBatch.length), spareBatch.length);
        }

        await setMeta(TVC_META_KEYS.SPICS_SYNC, ts);
        await setMeta(TVC_META_KEYS.INVENTORY_IMPORT, { at: ts, ...parsed.stats, equipmentCount, spareCreated, spareUpdated });

        return {
            equipment: equipmentCount,
            spareCreated,
            spareUpdated,
            totalSpares: spareCreated + spareUpdated,
            stats: parsed.stats,
        };
    }

    /** File upload → parse → import (원스텝) */
    async function importSpareInventoryFile(file, opts = {}) {
        const parsed = await TVC_SpareInventoryParser.parseFile(file, opts);
        if (!parsed.spares.length) {
            throw Object.assign(new Error('파싱된 부품(SparePart) 행이 없습니다. 파일 형식을 확인하세요.'), { code: 'EMPTY' });
        }
        return importSpareInventory(parsed, opts);
    }

    /**
     * spare inventory.xls - ENGINE.csv → IndexedDB 적재
     *
     * 1) CSV 헤더 행(PC / Numbering) 자동 인식
     * 2) MAIN ENGINE 등 Equipment → ship_components 부모 노드
     * 3) 개별 부품 → spare_parts (parentEquipmentID · UIC U_ENG_001…)
     *
     * @param {string|File|Blob|null} [source]
     *   - null/undefined: 번들 CSV 자동 로드
     *   - string: CSV 원문 또는 fetch URL
     *   - File/Blob: 업로드 파일
     * @param {{ department?: string, merge?: boolean, onProgress?: function }} [opts]
     */
    async function loadSpareInventory(source, opts = {}) {
        await open();
        const department = String(opts.department || 'ENGINE').trim().toUpperCase();
        let csvText = null;
        let sourceLabel = 'bundled';

        if (source == null || source === '') {
            if (TVC_Env.isFileProtocol()) {
                throw Object.assign(new Error(TVC_Env.FILE_HINT), { code: 'FILE_PROTOCOL' });
            }
            let lastErr;
            for (const url of (opts.urls || TVC_ENGINE_CSV_PATHS)) {
                try {
                    const res = await fetch(url);
                    if (!res.ok) { lastErr = new Error(`NOT_FOUND: ${url}`); continue; }
                    csvText = await res.text();
                    sourceLabel = url;
                    break;
                } catch (e) { lastErr = e; }
            }
            if (!csvText) {
                throw Object.assign(
                    new Error(`ENGINE CSV를 찾을 수 없습니다: ${TVC_ENGINE_CSV_PATHS.join(', ')}`),
                    { code: 'NOT_FOUND', cause: lastErr }
                );
            }
        } else if (typeof source === 'string') {
            if (source.includes('\n') || (source.includes(',') && source.length > 200)) {
                csvText = source;
                sourceLabel = 'inline';
            } else {
                if (TVC_Env.isFileProtocol()) {
                    throw Object.assign(new Error(TVC_Env.FILE_HINT), { code: 'FILE_PROTOCOL' });
                }
                const res = await fetch(source);
                if (!res.ok) throw Object.assign(new Error(`CSV fetch 실패: ${source}`), { code: 'NOT_FOUND' });
                csvText = await res.text();
                sourceLabel = source;
            }
        } else if (typeof source.text === 'function') {
            csvText = await source.text();
            sourceLabel = source.name || 'upload';
        } else {
            throw Object.assign(new Error('지원 source: CSV 문자열, URL, File, null(번들)'), { code: 'INVALID_SOURCE' });
        }

        const parsed = TVC_SpareInventoryParser.parseCsvLineByLine(csvText, { department, sheetName: department });
        if (!parsed.spares.length) {
            throw Object.assign(new Error('CSV에서 부품(SparePart) 행을 찾지 못했습니다. 헤더/형식을 확인하세요.'), { code: 'EMPTY' });
        }

        const migrated = await importSpareInventory(parsed, { ...opts, department, merge: opts.merge !== false });
        const parts = await SparePart.listAll();
        const ts = new Date().toISOString();

        await setMeta(TVC_META_KEYS.INVENTORY_XLS_LOADED, ts);
        await setMeta(TVC_META_KEYS.INVENTORY_IMPORT, {
            at: ts,
            source: sourceLabel,
            equipmentNodes: parsed.equipment?.length || migrated.equipment,
            ...parsed.stats,
            ...migrated,
        });

        return {
            loaded: true,
            source: sourceLabel,
            ...migrated,
            parsed,
            spares: parsed.spares,
            equipmentTree: parsed.equipment || [],
            parts,
        };
    }

    /**
     * InventoryDB — CSV ENGINE 시트 → IndexedDB 마이그레이션
     * UniversalItemCode: U_ENG_001 … 순차 할당 · parentEquipmentID 자동 연결
     */
    const InventoryDB = {
        loadSpareInventory,

        /**
         * @param {string} csvText  spare inventory.xls - ENGINE.csv 원문
         * @param {{ department?: string, merge?: boolean }} opts
         * @returns {Promise<{ equipment, spareCreated, spareUpdated, stats, spares, parts }>}
         */
        async migrateCsvToDb(csvText, opts = {}) {
            return loadSpareInventory(csvText, opts);
        },

        /** File → migrateCsvToDb */
        async migrateCsvFileToDb(file, opts = {}) {
            if (!file) throw Object.assign(new Error('파일이 없습니다.'), { code: 'NO_FILE' });
            const text = await file.text();
            const dept = opts.department
                || (file.name.toLowerCase().includes('deck') ? 'DECK' : 'ENGINE');
            return InventoryDB.migrateCsvToDb(text, { ...opts, department: dept });
        },

        /** URL → CSV text → loadSpareInventory (XLS 없을 때 fallback) */
        async importCsvFromUrl(url, opts = {}) {
            return loadSpareInventory(url, opts);
        },

        /**
         * 권장: spare inventory.xls (ENGINE 시트) → IndexedDB
         * @param {string} [url='data/spare-inventory.xls']
         */
        async importXlsFromUrl(url = 'data/spare-inventory.xls', opts = {}) {
            await open();
            if (TVC_Env.isFileProtocol()) {
                throw Object.assign(new Error(TVC_Env.FILE_HINT), { code: 'FILE_PROTOCOL' });
            }
            if (typeof window === 'undefined' || typeof window.XLSX === 'undefined') {
                throw Object.assign(new Error('SheetJS(XLSX)가 로드되지 않았습니다.'), { code: 'NO_XLSX' });
            }
            const res = await fetch(url);
            if (!res.ok) throw Object.assign(new Error(`XLS 파일을 찾을 수 없습니다: ${url}`), { code: 'NOT_FOUND' });
            const buf = await res.arrayBuffer();
            const department = String(opts.department || opts.sheetName || 'ENGINE').trim().toUpperCase();
            const file = new File([buf], 'spare-inventory.xls', { type: 'application/vnd.ms-excel' });
            const parsed = await TVC_SpareInventoryParser.parseFile(file, { department, sheetName: department });
            if (!parsed.spares.length) {
                throw Object.assign(new Error('XLS에서 부품 행을 찾지 못했습니다.'), { code: 'EMPTY' });
            }
            const migrated = await importSpareInventory(parsed, { ...opts, department, merge: opts.merge !== false });
            const parts = await SparePart.listAll();
            await setMeta(TVC_META_KEYS.INVENTORY_XLS_LOADED, new Date().toISOString());
            await setMeta(TVC_META_KEYS.INVENTORY_IMPORT, {
                at: new Date().toISOString(),
                source: url,
                ...parsed.stats,
                ...migrated,
            });
            return { ...migrated, parsed, spares: parsed.spares, parts, source: url };
        },

        /** File 객체로 XLS import (파일 선택용) */
        async importXlsFile(file, opts = {}) {
            if (!file) throw Object.assign(new Error('파일이 없습니다.'), { code: 'NO_FILE' });
            const parsed = await TVC_SpareInventoryParser.parseFile(file, {
                department: opts.department || 'ENGINE',
                sheetName: opts.sheetName || 'ENGINE',
            });
            if (!parsed.spares.length) {
                throw Object.assign(new Error('XLS에서 부품 행을 찾지 못했습니다.'), { code: 'EMPTY' });
            }
            const department = String(opts.department || 'ENGINE').trim().toUpperCase();
            const migrated = await importSpareInventory(parsed, { ...opts, department, merge: opts.merge !== false });
            const parts = await SparePart.listAll();
            await setMeta(TVC_META_KEYS.INVENTORY_XLS_LOADED, new Date().toISOString());
            return { ...migrated, parsed, spares: parsed.spares, parts, source: file.name };
        },
    };

    return {
        open, getAll, get, put, del, bulkPut, getMeta, setMeta, indexGetAll, runTransaction, clearAll,
        SparePart, InventoryHistory, SpareInventoryParser: TVC_SpareInventoryParser, InventoryDB,
        loadSpareInventory,
        importSpareInventory, importSpareInventoryFile,
    };
})();
