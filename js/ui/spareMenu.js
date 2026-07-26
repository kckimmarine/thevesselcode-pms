/* THE VESSEL CODE — Unified SPARE Module
 * 좌: GROUP Tree (Original/Actual Plan 동일) | 중: 요약 카드 + Virtual List | 우: 슬라이드 상세 패널
 * 재고 · 상세 · 청구 · Task BOM 할당 — SparePart 단일 데이터 객체
 */
const TVC_SpareMenu = (function () {
    let getState = () => ({});
    let refresh = () => {};
    let vl = null;
    let vlReqWork = null;
    let _reqWorkHistOpen = false;
    let _closeOsReqId = null;
    let _reqListReturnAfterSave = false;
    let _consumeListReturnAfterSave = false;
    let _consumeWorkReportOverlay = false;
    let _reqWorkCachedList = [];
    let _cachedList = [];
    let _importReqId = null;
    let _debounce = null;
    let _searchT = null;
    let _txDraft = { type: null, lines: [], search: '', ref: '', note: '' };
    let _txSearchT = null;
    let _hqAssessment = null;
    let _reqSheet = { reqId: null, step: 3, selectedLineIdx: 0, partSearch: '' };
    let _reqSheetSearchT = null;
    let _reqWorkDraft = null;
    let vlConsume = null;
    let vlReceive = null;
    let vlWrSpare = null;
    let _consumeCachedList = [];
    let _receiveCachedList = [];
    let _receiveDraft = null;
    let _receiveLineBySpareId = null;
    let _wrSpareCachedList = [];
    let _spareXfer = { step: 'mode' };
    let _reqListXferExportKind = null; // null | 'requisition' | 'received'
    /** HQ requisition import mode: vendor-quote | hq-adjustment */
    let _reqImportMode = null;
    let _consumeDraft = null;
    let _consumeLineBySpareId = null;
    let _wrSpareLineBySpareId = null;
    let _wrSpareResizeObs = null;
    let _wrSpareTreeDocClick = null;
    let _consumeGroupPickSearch = '';
    let _consumeJobPickSearch = '';
    let _page2JobPickSearch = '';
    let _page2ActiveJobRowIndex = 0;
    /** @type {{ items: object[], groupKey: string, readonly: boolean, allowAdd: boolean } | null} */
    let _page2JobCtx = null;
    let _consumeActiveJobRowIndex = 0;
    let _consumeJobPickUnbind = null;

    function fmtSpareDate(v) {
        if (typeof TVC_PWA?.normalizeDateText === 'function') return TVC_PWA.normalizeDateText(v);
        const s = String(v ?? '').trim();
        if (!s) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        return s.slice(0, 10);
    }

    function syncSpareDateInputs(root) {
        if (typeof TVC_PWA?.initDateInputFormat === 'function') {
            TVC_PWA.initDateInputFormat(root || document);
        }
    }

    function unbindConsumeJobPickListeners() {
        if (_consumeJobPickUnbind) {
            _consumeJobPickUnbind();
            _consumeJobPickUnbind = null;
        }
    }

    function isConsumeJobPickOpen() {
        const menu = document.getElementById('consumeJobPickMenu');
        return !!(menu && menu.style.display !== 'none' && menu.classList.contains('spare-consume-pick-menu-portal'));
    }

    let _reqLineBySpareId = null;
    let _reqLineMapReqId = null;
    let _reportedWaitBySpareId = new Map();
    let _reportedWaitByPartNo = new Map();

    const SPARE_MAIN_ITEM_WIDTH = 288;
    const SPARE_MAIN_PART_NO_WIDTH = 150;
    const SPARE_MAIN_COL_WIDTHS = [32, 92, 62, SPARE_MAIN_ITEM_WIDTH, SPARE_MAIN_PART_NO_WIDTH, 44, 56, 56, 56, 56, 56];
    const SPARE_MAIN_MIN_WIDTH = SPARE_MAIN_COL_WIDTHS.reduce((a, b) => a + b, 0);
    const SPARE_REQ_METRIC_WIDTH = 36;
    const SPARE_REQ_ROB_WIDTH = 36;
    const SPARE_REQ_REQ_INPUT_WIDTH = 40;
    const SPARE_REQ_ITEM_WIDTH = 280;
    const SPARE_REQ_PART_NO_WIDTH = 140;
    const SPARE_REQ_EXTRA_COL_WIDTHS = [SPARE_REQ_METRIC_WIDTH, SPARE_REQ_METRIC_WIDTH, SPARE_REQ_REQ_INPUT_WIDTH, SPARE_REQ_METRIC_WIDTH, SPARE_REQ_METRIC_WIDTH];
    const SPARE_REQ_BASE_COL_WIDTHS = [30, 82, 36, SPARE_REQ_ITEM_WIDTH, SPARE_REQ_PART_NO_WIDTH, 32, SPARE_REQ_METRIC_WIDTH, SPARE_REQ_METRIC_WIDTH, SPARE_REQ_ROB_WIDTH];
    const SPARE_REQ_COL_MINS = [28, 72, 32, 120, 88, 28, 34, 34, 34, 34, 34, 38, 34, 34];
    const SPARE_REQ_MIN_WIDTH = SPARE_REQ_BASE_COL_WIDTHS.concat(SPARE_REQ_EXTRA_COL_WIDTHS).reduce((a, b) => a + b, 0);
    const SPARE_MAIN_COLGROUP = `<colgroup>${SPARE_MAIN_COL_WIDTHS.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;
    const SPARE_REQ_BASE_COLGROUP = `<colgroup>${SPARE_REQ_BASE_COL_WIDTHS.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;
    const SPARE_REQ_EXTRA_COLS = SPARE_REQ_EXTRA_COL_WIDTHS.map(w => `<col style="width:${w}px">`).join('');
    const SPARE_REQ_COLGROUP = SPARE_REQ_BASE_COLGROUP.replace('</colgroup>', SPARE_REQ_EXTRA_COLS + '</colgroup>');
    const REQ_LIST_COLGROUP = `<colgroup>
        <col class="rl-col-chk"><col class="rl-col-type"><col class="rl-col-reqno"><col class="rl-col-req-date"><col class="rl-col-req-port">
        <col class="rl-col-submitted"><col class="rl-col-status"><col class="rl-col-recv-date"><col class="rl-col-recv-port"><col class="rl-col-os"><col class="rl-col-total">
    </colgroup>`;
    const REQ_LIST_PHASE = {
        ALL: 'all', DRAFT: 'draft', REPORTED: 'reported',
        CONFIRMED: 'confirmed', SUBMITTED: 'submitted',
        ASSESSED: 'assessed', RECEIVED: 'received',
    };
    const CONSUME_LOG_COLGROUP = `<colgroup>
        <col class="cl-col-chk"><col class="cl-col-job"><col class="cl-col-sort1"><col class="cl-col-sort2">
        <col class="cl-col-detail"><col class="cl-col-reported"><col class="cl-col-status"><col class="cl-col-total">
    </colgroup>`;
    function consumeLogTableHeadHtml(headChkId = 'consumeLogHeadChkAll') {
        return `<thead><tr>
        <th class="spare-consume-log-chk">
            <input type="checkbox" id="${headChkId}" class="spare-head-chk spare-consume-log-head-chk" aria-label="Select all consumed logs"
                onclick="event.stopPropagation()" onchange="TVC_SpareMenu.consumeLogToggleAll(this.checked)">
        </th>
        <th>Job Code</th>
        <th class="cl-col-sort-h">SORT-1</th>
        <th class="cl-col-sort-h">SORT-2</th>
        <th>JOB DETAIL</th>
        <th>Reported Date</th>
        <th>Status</th>
        <th class="spare-consume-log-th-num">Total Data</th>
    </tr></thead>`;
    }
    function reqListTableHeadHtml(headChkId = 'reqListHeadChkAll') {
        return `<thead>
        <tr>
        <th class="spare-req-list-chk" rowspan="2">
            <input type="checkbox" id="${headChkId}" class="spare-head-chk spare-req-list-head-chk" aria-label="Select all requisitions"
                onclick="event.stopPropagation()" onchange="TVC_SpareMenu.reqListToggleAll(this.checked)">
        </th>
        <th class="spare-req-list-th-type" rowspan="2">Type</th>
        <th class="spare-req-list-th-reqno" rowspan="2">Requisition No.</th>
        <th class="spare-req-list-th-group" colspan="2">Required</th>
        <th class="spare-req-list-th-submitted" rowspan="2">Reported Date</th>
        <th class="spare-req-list-th-status" rowspan="2">Status</th>
        <th class="spare-req-list-th-group" colspan="2">Received</th>
        <th class="spare-req-list-th-num spare-col-head-stack" rowspan="2" title="${SPARE_COL_WAIT_TITLE}">O/S</th>
        <th class="spare-req-list-th-num spare-col-head-stack" rowspan="2">Total<span class="spare-head-sub">Data</span></th>
        </tr>
        <tr>
        <th class="spare-req-list-th-sub">Date</th>
        <th class="spare-req-list-th-sub">Port</th>
        <th class="spare-req-list-th-sub">Date</th>
        <th class="spare-req-list-th-sub">Port</th>
        </tr>
    </thead>`;
    }
    const SPARE_COL_WORK = 'Work';
    const SPARE_COL_WORK_TITLE = 'Working';
    const SPARE_COL_STD = 'Std';
    const SPARE_COL_STD_TITLE = 'Standard';
    const SPARE_COL_ROB = 'Rob';
    const SPARE_COL_ROB_TITLE = 'Remaining onboard';
    const SPARE_COL_COS = 'Cos';
    const SPARE_COL_COS_TITLE = 'Consumed';
    const SPARE_COL_WAIT = 'O/S';
    const SPARE_COL_WAIT_TITLE = 'Outstanding (Req − Rcvd)';
    const SPARE_COL_NEED = 'Need';
    const SPARE_COL_NEED_TITLE = 'Need';
    const SPARE_COL_REQ = 'Req';
    const SPARE_COL_REQ_TITLE = 'Request';
    const SPARE_COL_EVAL = 'Eval';
    const SPARE_COL_EVAL_TITLE = 'Evaluated';
    const SPARE_COL_RCVD = 'Rcvd';
    const SPARE_COL_RCVD_TITLE = 'Received';
    const SPARE_MAIN_TABLE_HEAD = `<thead><tr>
                    <th class="c-chk"><input type="checkbox" id="spareHeadChkAll" class="spare-head-chk" aria-label="Select all"
                        onclick="event.stopPropagation()" onchange="TVC_SpareMenu.toggleSpareAll(this.checked)"></th>
                    <th class="c-num">Code</th>
                    <th class="c-cls">Class</th>
                    <th class="c-item">Item</th>
                    <th class="c-pno spare-col-head-stack">Part No.<span class="spare-head-sub">(Code No.)</span></th>
                    <th class="c-unit">Unit</th>
                    <th class="c-work" title="${SPARE_COL_WORK_TITLE}">${SPARE_COL_WORK}</th>
                    <th class="c-std" title="${SPARE_COL_STD_TITLE}">${SPARE_COL_STD}</th>
                    <th class="c-stk" title="${SPARE_COL_ROB_TITLE}">${SPARE_COL_ROB}</th>
                    <th class="c-await" title="${SPARE_COL_WAIT_TITLE}">${SPARE_COL_WAIT}</th>
                    <th class="c-need" title="${SPARE_COL_NEED_TITLE}">${SPARE_COL_NEED}</th>
                </tr></thead>`;
    const SPARE_REQ_TABLE_HEAD = `<thead><tr>
                    <th class="c-chk"><input type="checkbox" id="reqWorkHeadChkAll" class="spare-head-chk" aria-label="Select all"
                        onclick="event.stopPropagation()" onchange="TVC_SpareMenu.reqWorkToggleAll(this.checked)"></th>
                    <th class="c-num">Code</th>
                    <th class="c-cls">Class</th>
                    <th class="c-item">Item</th>
                    <th class="c-pno spare-col-head-stack">Part No.<span class="spare-head-sub">(Code No.)</span></th>
                    <th class="c-unit">Unit</th>
                    <th class="c-work" title="${SPARE_COL_WORK_TITLE}">${SPARE_COL_WORK}</th>
                    <th class="c-std" title="${SPARE_COL_STD_TITLE}">${SPARE_COL_STD}</th>
                    <th class="c-stk" title="${SPARE_COL_ROB_TITLE}">${SPARE_COL_ROB}</th>
                    <th class="c-await" title="${SPARE_COL_WAIT_TITLE}">${SPARE_COL_WAIT}</th>
                    <th class="c-need" title="${SPARE_COL_NEED_TITLE}">${SPARE_COL_NEED}</th>
                    <th class="c-req" title="${SPARE_COL_REQ_TITLE}">${SPARE_COL_REQ}</th>
                    <th class="c-assess" title="${SPARE_COL_EVAL_TITLE}">${SPARE_COL_EVAL}</th>
                    <th class="c-rcvd" title="${SPARE_COL_RCVD_TITLE}">${SPARE_COL_RCVD}</th>
                </tr></thead>`;
    const SPARE_REQ_TABLE_HEAD_GROUP = `<thead><tr>
                    <th class="c-chk"></th>
                    <th class="c-num">Code</th>
                    <th class="c-cls">Class</th>
                    <th class="c-item">Item</th>
                    <th class="c-pno spare-col-head-stack">Part No.<span class="spare-head-sub">(Code No.)</span></th>
                    <th class="c-unit">Unit</th>
                    <th class="c-work" title="${SPARE_COL_WORK_TITLE}">${SPARE_COL_WORK}</th>
                    <th class="c-std" title="${SPARE_COL_STD_TITLE}">${SPARE_COL_STD}</th>
                    <th class="c-stk" title="${SPARE_COL_ROB_TITLE}">${SPARE_COL_ROB}</th>
                    <th class="c-await" title="${SPARE_COL_WAIT_TITLE}">${SPARE_COL_WAIT}</th>
                    <th class="c-need" title="${SPARE_COL_NEED_TITLE}">${SPARE_COL_NEED}</th>
                    <th class="c-req" title="${SPARE_COL_REQ_TITLE}">${SPARE_COL_REQ}</th>
                    <th class="c-assess" title="${SPARE_COL_EVAL_TITLE}">${SPARE_COL_EVAL}</th>
                    <th class="c-rcvd" title="${SPARE_COL_RCVD_TITLE}">${SPARE_COL_RCVD}</th>
                </tr></thead>`;
    const SPARE_CONSUME_EXTRA_COL_WIDTH = 62;
    const SPARE_CONSUME_MIN_WIDTH = 836 + SPARE_CONSUME_EXTRA_COL_WIDTH;
    const SPARE_CONSUME_COLGROUP = '<colgroup><col style="width:32px"><col style="width:92px"><col style="width:62px"><col><col style="width:150px"><col style="width:44px"><col style="width:56px"><col style="width:56px"><col style="width:56px"><col style="width:62px"></colgroup>';
    const SPARE_RECEIVE_ITEM_WIDTH = 228;
    const SPARE_RECEIVE_PART_NO_WIDTH = 126;
    const SPARE_RECEIVE_METRIC_WIDTH = 40;
    const SPARE_RECEIVE_UNIT_WIDTH = 32;
    const SPARE_RECEIVE_INPUT_WIDTH = 44;
    const SPARE_RECEIVE_COL_WIDTHS = [30, 82, 36, SPARE_RECEIVE_ITEM_WIDTH, SPARE_RECEIVE_PART_NO_WIDTH, SPARE_RECEIVE_UNIT_WIDTH, SPARE_RECEIVE_METRIC_WIDTH, SPARE_RECEIVE_METRIC_WIDTH, SPARE_RECEIVE_METRIC_WIDTH, SPARE_RECEIVE_METRIC_WIDTH, SPARE_RECEIVE_INPUT_WIDTH];
    const SPARE_RECEIVE_MIN_WIDTH = SPARE_RECEIVE_COL_WIDTHS.reduce((a, b) => a + b, 0);
    const SPARE_RECEIVE_COLGROUP = `<colgroup>${SPARE_RECEIVE_COL_WIDTHS.map(w => `<col style="width:${w}px">`).join('')}</colgroup>`;
    const SPARE_RECEIVE_TABLE_HEAD = `<thead><tr>
                    <th class="c-chk"><input type="checkbox" id="receiveHeadChkAll" class="spare-head-chk" aria-label="Select all"
                        onclick="event.stopPropagation()" onchange="TVC_SpareMenu.receiveToggleAll(this.checked)"></th>
                    <th class="c-num">Code</th>
                    <th class="c-cls">Class</th>
                    <th class="c-item">Item</th>
                    <th class="c-pno spare-col-head-stack">Part No.<span class="spare-head-sub">(Code No.)</span></th>
                    <th class="c-unit">Unit</th>
                    <th class="c-work" title="${SPARE_COL_WORK_TITLE}">${SPARE_COL_WORK}</th>
                    <th class="c-std" title="${SPARE_COL_STD_TITLE}">${SPARE_COL_STD}</th>
                    <th class="c-stk" title="${SPARE_COL_ROB_TITLE}">${SPARE_COL_ROB}</th>
                    <th class="c-await" title="${SPARE_COL_WAIT_TITLE}">${SPARE_COL_WAIT}</th>
                    <th class="c-recv" title="${SPARE_COL_RCVD_TITLE}">${SPARE_COL_RCVD}</th>
                </tr></thead>`;
    const SPARE_CONSUME_TABLE_HEAD = `<thead><tr>
                    <th class="c-chk"><input type="checkbox" id="consumeHeadChkAll" class="spare-head-chk" aria-label="Select all"
                        onclick="event.stopPropagation()" onchange="TVC_SpareMenu.consumeToggleAll(this.checked)"></th>
                    <th class="c-num">Code</th>
                    <th class="c-cls">Class</th>
                    <th class="c-item">Item</th>
                    <th class="c-pno spare-col-head-stack">Part No.<span class="spare-head-sub">(Code No.)</span></th>
                    <th class="c-unit">Unit</th>
                    <th class="c-work" title="${SPARE_COL_WORK_TITLE}">${SPARE_COL_WORK}</th>
                    <th class="c-std" title="${SPARE_COL_STD_TITLE}">${SPARE_COL_STD}</th>
                    <th class="c-stk" title="${SPARE_COL_ROB_TITLE}">${SPARE_COL_ROB}</th>
                    <th class="c-cons" title="${SPARE_COL_COS_TITLE}">${SPARE_COL_COS}</th>
                </tr></thead>`;
    const SPARE_WR_EXTRA_COL_WIDTH = SPARE_CONSUME_EXTRA_COL_WIDTH;
    const SPARE_WR_MIN_WIDTH = SPARE_CONSUME_MIN_WIDTH;
    const SPARE_WR_COLGROUP = SPARE_CONSUME_COLGROUP;
    const SPARE_WR_TABLE_HEAD = `<thead><tr>
                    <th class="c-chk"><input type="checkbox" id="wrSpareHeadChkAll" class="spare-head-chk" aria-label="Select all"
                        onclick="event.stopPropagation()" onchange="TVC_SpareMenu.wrSpareToggleAll(this.checked)"></th>
                    <th class="c-num">Code</th>
                    <th class="c-cls">Class</th>
                    <th class="c-item">Item</th>
                    <th class="c-pno spare-col-head-stack">Part No.<span class="spare-head-sub">(Code No.)</span></th>
                    <th class="c-unit">Unit</th>
                    <th class="c-work" title="${SPARE_COL_WORK_TITLE}">${SPARE_COL_WORK}</th>
                    <th class="c-std" title="${SPARE_COL_STD_TITLE}">${SPARE_COL_STD}</th>
                    <th class="c-stk" title="${SPARE_COL_ROB_TITLE}">${SPARE_COL_ROB}</th>
                    <th class="c-cons" title="${SPARE_COL_COS_TITLE}">${SPARE_COL_COS}</th>
                </tr></thead>`;

    // 이미 "[object Object]"로 저장/표시된 값도 &로 복원 (안전망)
    const fixAmp = (s) => String(s ?? '').replace(/\[object Object\]/g, '&');
    const esc = (s) => fixAmp(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    /** PMS GROUP 라벨 — "03.    NAME" → "03. NAME" (번호 뒤 공백 1칸) */
    function formatPmsGroupNoLabel(label) {
        let s = String(label ?? '').replace(/\[object Object\]/g, ' & ').trim();
        if (!s) return '';
        const m = s.match(/^(\d+(?:\s*~\s*\d+)?)\.\s*(.*)$/);
        if (!m) return s.replace(/\s+/g, ' ').trim();
        const num = m[1].replace(/\s+/g, '');
        const rest = m[2].replace(/\s+/g, ' ').trim();
        return rest ? `${num}. ${rest}` : `${num}.`;
    }

    function safeTreeLabel(v) {
        if (v == null || v === '') return '';
        if (typeof v === 'string') return formatPmsGroupNoLabel(v);
        return String(v);
    }

    /** Original/Actual Plan GROUP Tree — Critical Equipment 키와 동일 */
    const CRITICAL_GROUP_KEY = '__CRITICAL_EQUIPMENT__';
    const DEPT_TREE_ORDER = ['ENGINE', 'DECK'];
    /** SPARE GROUP Tree — 03/04/05 Generator Engine 통합 노드 */
    const MERGED_GEN_ENGINE_KEY = '__SPARE_MERGE_03_05_GENERATOR__';
    const MERGED_GEN_ENGINE_LABEL = '03~05. GENERATOR ENGINE';
    const MERGED_GEN_ENGINE_PREFIXES = new Set(['03.', '04.', '05.']);
    /** inline Append — Modify와 동일 UI */
    const NEW_SPARE_EDIT_ID = '__NEW_SPARE__';

    function spareGroupPrefix(group) {
        const m = String(group || '').trim().match(/^(\d+)\s*\./);
        return m ? `${m[1].padStart(2, '0')}.` : '';
    }

    function isGeneratorEngineGroupLabel(label) {
        const s = String(label || '').trim();
        if (/^03\s*~\s*05/i.test(s) && /GENERATOR\s+ENGINE/i.test(s)) return true;
        const prefix = spareGroupPrefix(label);
        if (!MERGED_GEN_ENGINE_PREFIXES.has(prefix)) return false;
        return /GENERATOR\s+ENGINE/i.test(s);
    }

    function spareInMergedGeneratorEngine(s) {
        return isGeneratorEngineGroupLabel(s.group);
    }

    function normalizeGroupLabel(s) {
        return String(s || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
            .replace(/(\d+)\s*~\s*(\d+)/g, '$1~$2');
    }

    function extractMachineryFromGroupLabel(label) {
        return String(label || '')
            .replace(/^\d+(?:\.\s*|\s*~\s*\d+\.?\s*)/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function parseGeModelFromText(text) {
        const m = String(text || '').match(/\(\s*G\/E\s*[-–]\s*([^)]+)\)/i);
        return m ? m[1].trim() : '';
    }

    function findGroupComponent(st, groupLabels) {
        const labels = (Array.isArray(groupLabels) ? groupLabels : [groupLabels]).filter(Boolean);
        const normSet = new Set(labels.map(normalizeGroupLabel));
        return (st.components || []).find(c => {
            if (c.node_type !== 'GROUP') return false;
            const lab = normalizeGroupLabel(c.label || c.component_name || c.component_code);
            return normSet.has(lab);
        });
    }

    function findComponentById(st, id) {
        return (st.components || []).find(c => c.id === id) || null;
    }

    function sectionCodeFromPartNo(partNo) {
        const m = String(partNo || '').match(/^(\d{2}-\d{3})-/);
        return m ? m[1] : '';
    }

    function assyNameFromSpare(s) {
        if (s?.location) {
            const parts = String(s.location).split(' · ');
            if (parts.length > 1) return parts[parts.length - 1].trim();
        }
        const secCode = sectionCodeFromPartNo(s?.makerPartNo || s?.part_no);
        return secCode ? `Sheet ${secCode}` : '';
    }

    function groupLabelsForPmsGroup(pmsGroupNo, st, groupKey) {
        const labels = [pmsGroupNo].filter(Boolean);
        if (groupKey === MERGED_GEN_ENGINE_KEY || isGeneratorEngineGroupLabel(pmsGroupNo)) {
            labels.push(MERGED_GEN_ENGINE_LABEL, '03~05        GENERATOR ENGINE', '03~05 GENERATOR ENGINE');
            (st?.idx?.groupNodes || []).forEach(n => {
                if (isGeneratorEngineGroupLabel(n.label)) labels.push(n.label);
            });
        }
        return [...new Set(labels.map(l => String(l || '').trim()).filter(Boolean))];
    }

    function headerFieldText(v) {
        if (v == null || v === '') return '';
        if (typeof v === 'string') return fixAmp(v).trim();
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
        return '';
    }

    function enrichSpareHeaderFields(st, base, sampleSpare, opts = {}) {
        // 그룹만 선택된 상태(itemLevel=false)에서는 Ass'y Name / Dwg. No.를 비운다.
        const itemLevel = opts.itemLevel !== false;
        const h = { ...base };
        const sample = sampleSpare ? canon(sampleSpare) : null;
        let assyName = headerFieldText(h.assyName);
        if (sample) {
            assyName = assyName || assyNameFromSpare(sample);
            if (!h.dwgNo) h.dwgNo = spareDrawingNo(sample);
            if (!h.maker) h.maker = sample.maker || sample.vendorComment || '';
            if (!h.modelType) h.modelType = sample.model || '';
        }

        const groupLabels = groupLabelsForPmsGroup(h.pmsGroupNo, st, st.selectedGroupKey);
        const comp = findGroupComponent(st, groupLabels);
        const parent = comp?.parent_id ? findComponentById(st, comp.parent_id) : null;
        // 그룹만 선택된 경우엔 임의 샘플 부품의 parentEquipmentID를 신뢰하지 않고
        // 선택된 그룹의 컴포넌트(그룹 라벨) 기준으로만 장비 정보를 도출한다.
        const equip = (itemLevel && sample?.parentEquipmentID)
            ? findComponentById(st, sample.parentEquipmentID)
            : parent;

        if (!h.machineryName) {
            h.machineryName = headerFieldText(equip?.machinery_name || equip?.label || comp?.machinery_name
                || extractMachineryFromGroupLabel(h.pmsGroupNo));
        }
        if (!h.modelType) {
            h.modelType = headerFieldText(equip?.model_type || equip?.model || comp?.model_type || comp?.model);
        }
        if (!h.maker) h.maker = headerFieldText(equip?.maker || comp?.maker);
        if (!h.capacity) h.capacity = headerFieldText(equip?.capacity || equip?.remarks || comp?.capacity || comp?.remarks);
        if (!h.dwgNo) h.dwgNo = headerFieldText(comp?.dwg_no || equip?.dwg_no || comp?.drawing_no || equip?.drawing_no);
        if (!h.serialNo) h.serialNo = headerFieldText(equip?.serial_no || comp?.serial_no || sample?.serialNo);

        if (sample) {
            const secCode = sectionCodeFromPartNo(sample.makerPartNo || sample.part_no);
            const secComp = secCode
                ? (st.components || []).find(c => c.component_code === secCode && (c.node_type === 'SORT' || c.node_type === 'SECTION'))
                : null;
            if (secComp) {
                assyName = secComp.label || secComp.component_name || assyName;
                if (!h.dwgNo) h.dwgNo = secComp.dwg_no || secComp.drawing_no || secComp.component_code || h.dwgNo;
            }
        }

        if (!h.modelType) {
            h.modelType = parseGeModelFromText(assyName)
                || parseGeModelFromText(sample?.name)
                || parseGeModelFromText(sample?.location);
        }
        if (h.modelType && !h.maker) {
            const mk = h.modelType.split(/\s+/)[0];
            if (/^[A-Za-z]/.test(mk)) h.maker = mk;
        }
        if (!h.modelType && h.machineryName) {
            const mm = h.machineryName.match(/(?:MAIN ENGINE|GENERATOR ENGINE|M\/E|G\/E)\s+(.+)/i);
            if (mm) h.modelType = mm[1].trim();
        }

        h.assyName = headerFieldText(assyName);
        h.machineryName = headerFieldText(h.machineryName || h.pmsGroupNo);
        h.pmsGroupNo = formatPmsGroupNoLabel(h.pmsGroupNo);
        h.modelType = headerFieldText(h.modelType);
        h.capacity = headerFieldText(h.capacity);
        h.maker = headerFieldText(h.maker);
        h.dwgNo = headerFieldText(h.dwgNo);
        h.serialNo = headerFieldText(h.serialNo);
        if (!itemLevel) { h.assyName = ''; h.dwgNo = ''; }
        return h;
    }

    function resolveSpareHeaderFromSpare(st, spare) {
        const s = canon(spare);
        if (!s) return null;
        const rawGroup = spareGroupLabel(s);
        let pmsGroupNo = rawGroup === '—' ? '' : rawGroup;
        if (!pmsGroupNo) pmsGroupNo = groupLabelFromCode(st, s);
        // 그룹 Modify로 저장한 그룹 헤더 메타를 최우선으로 반영(아이템 클릭 시에도 일치)
        const def = groupDefHeader(st, pmsGroupNo === '—' ? '' : pmsGroupNo);
        const base = {
            pmsGroupNo: pmsGroupNo === '—' ? '' : pmsGroupNo,
            machineryName: def?.machineryName || '',
            modelType: def?.modelType || s.model || '',
            capacity: def?.capacity || '',
            maker: def?.maker || s.maker || '',
            serialNo: def?.serialNo || s.serialNo || '',
            assyName: assyNameFromSpare(s),
            dwgNo: spareDrawingNo(s),
        };
        const result = enrichSpareHeaderFields(st, base, s);
        // 그룹 헤더를 편집했으면 입력값(빈 값 포함)을 그대로 반영 — enrich 폴백값으로 되돌아가지 않게
        if (def?.edited) {
            result.machineryName = def.machineryName;
            result.modelType = def.modelType;
            result.capacity = def.capacity;
            result.maker = def.maker;
            result.serialNo = def.serialNo;
        }
        return result;
    }

    /** maintenance_groups에 저장된 그룹 헤더 메타(그룹 Modify로 영속 저장) 조회 */
    function groupDefHeader(st, label) {
        const lab = String(label || '').trim();
        if (!lab) return null;
        const inDept = (gr) => (!st.department || gr.department === st.department);
        // 병합 그룹(03~05)은 개별 gen-engine 라벨에 저장되므로, 병합 라벨 조회 시 그 중 하나를 사용
        let def;
        if (isGeneratorEngineGroupLabel(lab)) {
            def = (st.groups || []).find(gr => inDept(gr) && isGeneratorEngineGroupLabel(gr.label)
                && (gr.machinery_name || gr.model_type || gr.maker || gr.capacity));
        }
        if (!def) {
            const target = normalizeGroupLabel(lab);
            def = (st.groups || []).find(gr => inDept(gr) && normalizeGroupLabel(gr.label) === target);
        }
        if (!def) return null;
        const has = def.machinery_name || def.model_type || def.maker || def.capacity || def.dwg_no || def.serial_no
            || def.is_critical_equipment != null;
        // header_edited가 없고 저장된 값도 없으면 무시(폴백 사용)
        if (!def.header_edited && !has) return null;
        return {
            edited: !!def.header_edited,
            machineryName: headerFieldText(def.machinery_name),
            modelType: headerFieldText(def.model_type),
            maker: headerFieldText(def.maker),
            capacity: headerFieldText(def.capacity),
            dwgNo: headerFieldText(def.dwg_no),
            serialNo: headerFieldText(def.serial_no),
            criticalEquipment: criticalEquipmentLabel(def.is_critical_equipment),
        };
    }

    function parseCriticalEquipmentValue(raw) {
        if (raw === 'Yes' || raw === true) return true;
        if (raw === 'No' || raw === false) return false;
        return null;
    }

    function criticalEquipmentLabel(val) {
        if (val === true || val === 'Yes') return 'Yes';
        if (val === false || val === 'No') return 'No';
        return '';
    }

    function renderCriticalEquipmentControl(st, h, opts = {}) {
        const {
            hasContent = true,
            editMode = false,
        } = opts;
        const val = criticalEquipmentLabel(h.criticalEquipment);
        if (!hasContent) {
            return '<span class="spare-gh-value empty">—</span>';
        }
        if (!editMode) {
            const t = val || '—';
            const empty = !val;
            return `<span class="spare-gh-value${empty ? ' empty' : ''}">${esc(t)}</span>`;
        }
        return `<select class="spare-gh-select" id="sgh_g_criticalEquipment" aria-label="Critical Equipment">
            <option value=""${val === '' ? ' selected' : ''}>—</option>
            <option value="Yes"${val === 'Yes' ? ' selected' : ''}>Yes</option>
            <option value="No"${val === 'No' ? ' selected' : ''}>No</option>
        </select>`;
    }

    async function upsertGroupCriticalEquipment(st, yesNo) {
        const key = st.selectedGroupKey;
        if (!key || key === CRITICAL_GROUP_KEY) return;
        const node = groupSelectedNode(st);
        const dept = node?.department || st.department || '';
        const label = groupFilterLabel(st) || node?.label || '';
        if (!label) return;
        const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
        const norm = normalizeGroupLabel;
        let targetLabels;
        if (key === MERGED_GEN_ENGINE_KEY) {
            targetLabels = (st.idx?.groupNodes || [])
                .filter(n => (!dept || n.department === dept) && isGeneratorEngineGroupLabel(n.label))
                .map(n => n.label);
            if (!targetLabels.length) targetLabels = [label];
        } else {
            targetLabels = [label];
        }
        for (const lab of [...new Set(targetLabels.filter(Boolean))]) {
            const existing = (defs || []).find(gr => (!dept || gr.department === dept) && norm(gr.label) === norm(lab));
            const defBase = existing || {
                id: 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                department: dept,
                label: lab,
                sort_order: 0,
                created_at: new Date().toISOString(),
            };
            const row = {
                ...defBase,
                label: lab,
                is_critical_equipment: yesNo,
                header_edited: !!defBase.header_edited || yesNo !== null,
                updated_at: new Date().toISOString(),
                sync_status: 'LOCAL',
            };
            await TVC_DB.put('maintenance_groups', row);
            const groups = st.groups || [];
            const gi = groups.findIndex(gr => gr.id === row.id);
            if (gi >= 0) groups[gi] = row;
            else groups.push(row);
            st.groups = groups;
        }
    }

    function isGroupCriticalEquipmentYes(st, groupLabel) {
        const h = groupDefHeader(st, groupLabel);
        if (h) return h.criticalEquipment === 'Yes';
        const lab = String(groupLabel || '').trim();
        if (!lab) return false;
        const inDept = (gr) => (!st.department || gr.department === st.department);
        const target = normalizeGroupLabel(lab);
        const def = (st.groups || []).find(gr => inDept(gr) && normalizeGroupLabel(gr.label) === target);
        return def?.is_critical_equipment === true;
    }

    async function savePlanCriticalEquipment(rawVal) {
        const st = getState();
        if (!canEditGroupHeader(st)) {
            alert('Chief Engineer / Captain permission required.');
            return;
        }
        if (!st.selectedGroupKey || st.selectedGroupKey === CRITICAL_GROUP_KEY) return;
        try {
            await upsertGroupCriticalEquipment(st, parseCriticalEquipmentValue(rawVal));
            afterSpareListChange(st);
        } catch (e) {
            alert(e.message || e.code || 'Save failed');
        }
    }

    function resolveSpareHeaderFromGroup(st) {
        const blank = {
            pmsGroupNo: '',
            machineryName: '',
            modelType: '',
            capacity: '',
            maker: '',
            serialNo: '',
            criticalEquipment: '',
            assyName: '',
            dwgNo: '',
        };
        const groupKey = st.selectedGroupKey;
        if (!groupKey) return blank;

        const pmsGroupNo = groupFilterLabel(st);
        if (groupKey === CRITICAL_GROUP_KEY) {
            return { ...blank, pmsGroupNo, machineryName: 'Critical Equipment' };
        }

        // 우선순위: 1) maintenance_groups에 저장된 그룹 헤더 메타(그룹 Modify로 영속 저장)
        //           2) 그룹 컴포넌트 자체 값  3) 대표 아이템(클릭 시와 동일 소스)
        //           Ass'y/Dwg.는 그룹 단위에서는 비운다.
        const def = groupDefHeader(st, pmsGroupNo);
        // 사용자가 그룹 헤더를 편집했으면(빈 값 포함) 입력값을 그대로 사용 — 폴백하지 않음
        if (def?.edited) {
            return {
                pmsGroupNo,
                machineryName: def.machineryName,
                modelType: def.modelType,
                capacity: def.capacity,
                maker: def.maker,
                serialNo: def.serialNo,
                criticalEquipment: def.criticalEquipment || '',
                assyName: '',
                dwgNo: '',
            };
        }
        const sample = filteredSpares(st)[0];
        const itemHeader = sample ? resolveSpareHeaderFromSpare(st, sample) : null;
        const groupLabels = groupLabelsForPmsGroup(pmsGroupNo, st, groupKey);
        const comp = findGroupComponent(st, groupLabels);
        return {
            pmsGroupNo,
            machineryName: def?.machineryName || headerFieldText(comp?.machinery_name) || itemHeader?.machineryName || '',
            modelType: def?.modelType || headerFieldText(comp?.model_type || comp?.model) || itemHeader?.modelType || '',
            capacity: def?.capacity || headerFieldText(comp?.capacity || comp?.remarks) || itemHeader?.capacity || '',
            maker: def?.maker || headerFieldText(comp?.maker) || itemHeader?.maker || '',
            serialNo: def?.serialNo || headerFieldText(comp?.serial_no) || itemHeader?.serialNo || '',
            criticalEquipment: def?.criticalEquipment || '',
            assyName: '',
            dwgNo: '',
        };
    }

    function resolveSpareGroupHeader(st, opts = {}) {
        const focusedId = opts.focusedId !== undefined ? opts.focusedId : getFocusedSpareId(st);
        if (focusedId) {
            const spare = (st.spares || []).find(x => x.id === focusedId);
            if (spare) {
                const fromItem = resolveSpareHeaderFromSpare(st, spare);
                if (fromItem) return fromItem;
            }
        }
        return resolveSpareHeaderFromGroup(st);
    }

    function spareHeaderHasContent(st, focusedOverride) {
        const focusedId = focusedOverride !== undefined ? focusedOverride : getFocusedSpareId(st);
        return !!(focusedId || st.selectedGroupKey);
    }

    function refreshSpareEditBlock() {
        const st = getState();
        const html = renderSpareEditBlockHtml(st);
        const block = document.getElementById('spareEditBlock');
        if (block) block.innerHTML = html;
        const m = modState(st);
        if (m.reqWorkOpen) {
            const rw = document.getElementById('reqWorkEditBlock');
            if (rw) {
                rw.innerHTML = m.inlineEditId && m.inlineDraft?.header
                    ? html
                    : renderSpareGroupHeaderHtml(st, { focusedId: m.reqWorkFocusedId });
            }
        }
        if (m.consumeOpen) {
            const cw = document.getElementById('consumeEditBlock');
            if (cw) {
                cw.innerHTML = m.inlineEditId && m.inlineDraft?.header
                    ? html
                    : renderConsumeGroupHeaderHtml(st);
            }
        }
        if (m.receiveOpen) {
            const rw = document.getElementById('receiveEditBlock');
            if (rw) {
                rw.innerHTML = renderSpareGroupHeaderHtml(st, { focusedId: m.receiveFocusedId });
            }
        }
    }

    function refreshSpareGroupHeader() {
        refreshSpareEditBlock();
    }

    function renderSpareGroupHeaderHtml(st, opts = {}) {
        const m = modState(st);
        const focusOverride = opts.focusedId;
        const pmsLabel = opts.pmsLabel || 'SPARE Group No.';
        if (m.inlineEditId && m.inlineDraft?.header && focusOverride === undefined) {
            return renderSpareGroupHeaderEditHtml(st, m.inlineDraft.header);
        }
        if (m.groupHeaderEdit && m.groupHeaderDraft && m.groupHeaderEditKey === st.selectedGroupKey) {
            return renderSpareGroupHeaderGroupEditHtml(st, m.groupHeaderDraft, {
                pmsLabel: opts.pmsLabel || 'SPARE Group No.',
                showCriticalEquipment: opts.showCriticalEquipment,
            });
        }
        const h = resolveSpareGroupHeader(st, { focusedId: focusOverride });
        const hasContent = spareHeaderHasContent(st, focusOverride);
        const showCriticalEquipment = !!opts.showCriticalEquipment;
        const field = (v, extraClass = '') => {
            const t = String(v || '').trim();
            const empty = !t;
            const cls = ['spare-gh-value', extraClass, empty ? 'empty' : ''].filter(Boolean).join(' ');
            return `<span class="${cls}">${empty ? '—' : esc(t)}</span>`;
        };
        const idleHintText = opts.idleHint || 'Click an item or select a group in the SPARE GROUP Tree to display equipment information.';
        const idleHint = `<span class="spare-gh-idle-hint">${idleHintText}</span>`;
        const ariaLabel = opts.ariaLabel || 'SPARE Group information';
        const primaryRowClass = showCriticalEquipment
            ? 'spare-gh-row spare-gh-row-primary spare-gh-row-plan-split'
            : 'spare-gh-row spare-gh-row-primary';
        const pmsFieldClass = showCriticalEquipment
            ? 'spare-gh-field spare-gh-field-wide spare-gh-field-span3'
            : 'spare-gh-field spare-gh-field-wide';
        const criticalField = showCriticalEquipment ? `
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Critical Equipment</span>
                        ${renderCriticalEquipmentControl(st, h, { hasContent })}
                    </div>` : '';
        return `<section class="spare-group-header${hasContent ? '' : ' is-idle'}" aria-label="${esc(ariaLabel)}">
            <div class="spare-group-header-card">
                <div class="${primaryRowClass}">
                    <div class="${pmsFieldClass}">
                        <span class="spare-gh-label">${pmsLabel}</span>
                        ${hasContent ? field(h.pmsGroupNo, 'spare-gh-value-primary') : `<span class="spare-gh-value spare-gh-value-primary empty">${idleHint}</span>`}
                    </div>${criticalField}
                </div>
                <div class="spare-gh-row spare-gh-row-quad">
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Maker</span>
                        ${field(h.maker)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Model / Type</span>
                        ${field(h.modelType)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Capacity</span>
                        ${field(h.capacity)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Serial No.</span>
                        ${field(h.serialNo)}
                    </div>
                </div>
            </div>
        </section>`;
    }

    function renderSpareGroupHeaderFromResolved(h, opts = {}) {
        const pmsLabel = opts.pmsLabel || 'SPARE Group No.';
        const hasContent = !!(String(h?.pmsGroupNo || '').trim());
        const field = (v, extraClass = '') => {
            const t = String(v || '').trim();
            const empty = !t;
            const cls = ['spare-gh-value', extraClass, empty ? 'empty' : ''].filter(Boolean).join(' ');
            return `<span class="${cls}">${empty ? '—' : esc(t)}</span>`;
        };
        const ariaLabel = opts.ariaLabel || 'SPARE Group information';
        return `<section class="spare-group-header spare-group-header-in-list${hasContent ? '' : ' is-idle'}" aria-label="${esc(ariaLabel)}">
            <div class="spare-group-header-card">
                <div class="spare-gh-row spare-gh-row-primary">
                    <div class="spare-gh-field spare-gh-field-wide">
                        <span class="spare-gh-label">${pmsLabel}</span>
                        ${hasContent ? field(h.pmsGroupNo, 'spare-gh-value-primary') : `<span class="spare-gh-value spare-gh-value-primary empty">—</span>`}
                    </div>
                </div>
                <div class="spare-gh-row spare-gh-row-quad">
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Maker</span>
                        ${field(h.maker)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Model / Type</span>
                        ${field(h.modelType)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Capacity</span>
                        ${field(h.capacity)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Serial No.</span>
                        ${field(h.serialNo)}
                    </div>
                </div>
            </div>
        </section>`;
    }

    function reqWorkUsesGroupedList(st) {
        const m = modState(st);
        return isRequisitionListWindow(m) && reqWorkCheckedSpareCount(st) > 0;
    }

    function reqWorkGroupedSections(st) {
        const req = getReqWorkSession();
        if (!req?.lines?.length) return [];
        return reqPreviewGroups(st, req).map(g => ({
            key: g.key,
            header: g.header || { pmsGroupNo: g.key, machineryName: '', modelType: '', capacity: '', maker: '', serialNo: '' },
            spares: g.rows.map(({ spare }) => spare).filter(Boolean).map(canon),
        })).filter(g => g.spares.length);
    }

    function withDerivedPlanGroupKey(st) {
        if (st.selectedGroupKey) return st;
        if (st.selectedJobId && st.idx) {
            const job = st.idx.jobById.get(st.selectedJobId);
            if (job?.group) {
                return { ...st, selectedGroupKey: `${job.department || ''}|${String(job.group).trim()}` };
            }
        }
        return st;
    }

    function renderPlanGroupHeaderHtml(st) {
        return renderSpareGroupHeaderHtml(withDerivedPlanGroupKey(st), {
            pmsLabel: 'PMS Group No.',
            idleHint: 'Click a job or select a group in the PMS GROUP Tree to display equipment information.',
            ariaLabel: 'PMS Group information',
            showCriticalEquipment: true,
        });
    }

    function ghInput(id, value, extraClass = '') {
        const cls = ['spare-gh-input', extraClass].filter(Boolean).join(' ');
        return `<input class="${cls}" id="${id}" value="${esc(String(value ?? ''))}">`;
    }

    function pmsGroupSortNo(label) {
        const m = String(label || '').trim().match(/^(\d+)\s*\./);
        return m ? parseInt(m[1], 10) : null;
    }

    function isStandardPmsGroupLabel(label) {
        const n = pmsGroupSortNo(label);
        return n != null && n >= 1 && n <= 26;
    }

    // SPARE GROUP Tree에서 숨길 그룹 번호 (부서별)
    const SPARE_HIDDEN_GROUPS_BY_DEPT = {
        ENGINE: new Set([27, 36]),
        DECK: new Set([34, 36]),
    };
    function isHiddenSpareGroup(label, department) {
        const n = pmsGroupSortNo(label);
        if (n == null) return false;
        const set = SPARE_HIDDEN_GROUPS_BY_DEPT[department];
        return !!(set && set.has(n));
    }

    function spareEditPmsGroupNodes(st) {
        if (!st.idx && (st.jobs || []).length && window.TVC_Indexes) {
            st.idx = TVC_Indexes.build(st);
        }
        // GROUP Tree와 동일한 목록을 노출한다:
        //  - 부서 필터 + 숨김 그룹(예: ENGINE 27/36, DECK 34/36) 제외
        //  - 03~05 GENERATOR ENGINE 은 하나로 병합
        //  - 라벨 기준 동일 정렬
        const seen = new Set();
        const nodes = (st.idx?.groupNodes || [])
            .filter(n => !st.department || n.department === st.department)
            .filter(n => !isHiddenSpareGroup(n.label, n.department))
            .filter(n => {
                if (isGeneratorEngineGroupLabel(n.label)) return true; // 병합 단계에서 처리
                const key = normalizeGroupLabel(n.label);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        return mergeSpareTreeNodes(nodes);
    }

    /** Original / Actual Plan GROUP Tree — SPARE 병합·숨김 없이 동일 소스 */
    function planGroupNodes(st) {
        if (!st.idx && (st.jobs || []).length && window.TVC_Indexes) {
            st.idx = TVC_Indexes.build(st);
        }
        return (st.idx?.groupNodes || [])
            .filter(n => !st.department || n.department === st.department);
    }

    function resolveEditGroupSelection(st, selected) {
        const s = String(selected || '').trim();
        if (!s) return '';
        const nodes = spareEditPmsGroupNodes(st);
        const exact = nodes.find(n => n.label === s || normalizeGroupLabel(n.label) === normalizeGroupLabel(s));
        if (exact) return exact.label;
        if (isGeneratorEngineGroupLabel(s)) {
            const gen = nodes.find(n => isGeneratorEngineGroupLabel(n.label));
            if (gen) return gen.label;
        }
        const n = pmsGroupSortNo(s);
        if (n != null && n >= 1 && n <= 26) {
            const byNo = nodes.find(x => pmsGroupSortNo(x.label) === n);
            if (byNo) return byNo.label;
        }
        return isStandardPmsGroupLabel(s) ? s : '';
    }

    function normalizeEditGroupLabel(label) {
        const s = String(label || '').trim();
        if (!s) return '';
        if (/^critical equipment$/i.test(s)) return 'Critical Equipment';
        return s;
    }

    function renderSpareGroupPickListHtml(st, selected) {
        const nodes = spareEditPmsGroupNodes(st);
        const sel = resolveEditGroupSelection(st, selected);
        const triggerText = sel ? safeTreeLabel(sel) : '— Select GROUP —';
        let inner = '';
        if (!nodes.length) {
            inner = '<span class="spare-gh-group-empty muted">Open Original Plan to load the PMS GROUP Tree.</span>';
        }
        nodes.forEach(n => {
            const label = n.label;
            const isSel = sel === label;
            const cls = ['spare-gh-group-item', isSel ? 'selected' : '', n.isEmpty ? 'is-empty' : ''].filter(Boolean).join(' ');
            inner += `<button type="button" class="${cls}" data-group-label="${escAttr(label)}"
                onclick="TVC_SpareMenu.pickEditGroup('${escAttr(label)}')">${esc(safeTreeLabel(label))}</button>`;
        });
        return `<div class="spare-gh-group-select" id="sghGroupSelect">
            <input type="hidden" id="sgh_pmsGroupNo" value="${escAttr(sel)}">
            <button type="button" class="spare-gh-group-trigger" onclick="TVC_SpareMenu.toggleEditGroupPick(event)">
                <span class="spare-gh-group-trigger-text">${esc(triggerText)}</span>
                <span class="spare-gh-group-trigger-caret" aria-hidden="true">▾</span>
            </button>
            <div class="spare-gh-group-pick" role="listbox" aria-label="SPARE Group No.">${inner}</div>
        </div>`;
    }

    function renderSpareGroupHeaderEditHtml(st, h) {
        return `<section class="spare-group-header is-editing" aria-label="SPARE Group edit">
            <div class="spare-group-header-card">
                <div class="spare-gh-row spare-gh-row-primary">
                    <div class="spare-gh-field spare-gh-field-wide">
                        <span class="spare-gh-label">SPARE Group No.</span>
                        ${renderSpareGroupPickListHtml(st, h.pmsGroupNo)}
                    </div>
                </div>
                <div class="spare-gh-row spare-gh-row-quad">
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Maker</span>
                        ${ghInput('sgh_maker', h.maker)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Model / Type</span>
                        ${ghInput('sgh_modelType', h.modelType)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Capacity</span>
                        ${ghInput('sgh_capacity', h.capacity)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Serial No.</span>
                        ${ghInput('sgh_serialNo', h.serialNo)}
                    </div>
                </div>
            </div>
        </section>`;
    }

    // 그룹 단위 헤더 편집 (Machinery Name / Model / Capacity / Maker → 그룹 내 전체 아이템 일괄 적용)
    function renderSpareGroupHeaderGroupEditHtml(st, h, opts = {}) {
        const pmsLabel = opts.pmsLabel || 'SPARE Group No.';
        const showCriticalEquipment = !!opts.showCriticalEquipment;
        const primaryRowClass = showCriticalEquipment
            ? 'spare-gh-row spare-gh-row-primary spare-gh-row-plan-split'
            : 'spare-gh-row spare-gh-row-primary';
        const pmsFieldClass = showCriticalEquipment
            ? 'spare-gh-field spare-gh-field-wide spare-gh-field-span3'
            : 'spare-gh-field spare-gh-field-wide';
        const criticalField = showCriticalEquipment ? `
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Critical Equipment</span>
                        ${renderCriticalEquipmentControl(st, h, { hasContent: true, editMode: true })}
                    </div>` : '';
        return `<section class="spare-group-header is-editing is-group-editing" aria-label="Edit group header">
            <div class="spare-group-header-card">
                <div class="${primaryRowClass}">
                    <div class="${pmsFieldClass}">
                        <span class="spare-gh-label">${esc(pmsLabel)}</span>
                        ${ghInput('sgh_g_pmsGroupNo', h.pmsGroupNo, 'spare-gh-input-primary')}
                    </div>${criticalField}
                </div>
                <div class="spare-gh-row spare-gh-row-quad">
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Maker</span>
                        ${ghInput('sgh_g_maker', h.maker)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Model / Type</span>
                        ${ghInput('sgh_g_modelType', h.modelType)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Capacity</span>
                        ${ghInput('sgh_g_capacity', h.capacity)}
                    </div>
                    <div class="spare-gh-field">
                        <span class="spare-gh-label">Serial No.</span>
                        ${ghInput('sgh_g_serialNo', h.serialNo)}
                    </div>
                </div>
                <div class="spare-gh-edit-actions">
                    <span class="spare-gh-edit-hint">Applied to all items in this group.</span>
                    <button type="button" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.saveGroupHeaderEdit()">💾 Save</button>
                    <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.cancelGroupHeaderEdit()">Cancel</button>
                </div>
            </div>
        </section>`;
    }

    function isNewInlineEdit(st) {
        return modState(st).inlineEditId === NEW_SPARE_EDIT_ID;
    }

    function resolveAppendGroupHeader(st) {
        const blank = {
            pmsGroupNo: '', machineryName: '', modelType: '', capacity: '',
            maker: '', serialNo: '', assyName: '', dwgNo: '',
        };
        let groupLabel = '';
        if (st.selectedGroupKey === MERGED_GEN_ENGINE_KEY) {
            const nodes = spareEditPmsGroupNodes(st);
            const gen = nodes.find(n => isGeneratorEngineGroupLabel(n.label));
            groupLabel = gen?.label || '';
        } else if (st.selectedGroupKey && st.selectedGroupKey !== CRITICAL_GROUP_KEY) {
            const node = st.idx?.groupNodes?.find(n => n.key === st.selectedGroupKey);
            if (node && isStandardPmsGroupLabel(node.label)) groupLabel = node.label;
        }
        if (groupLabel) return enrichSpareHeaderFields(st, { ...blank, pmsGroupNo: groupLabel }, null);
        return { ...blank };
    }

    function renderSpareItemEditRowHtml(st) {
        const m = modState(st);
        if (!m.inlineEditId || !m.inlineDraft?.row) return '';
        const r = m.inlineDraft.row;
        const isNew = isNewInlineEdit(st);
        const spare = isNew ? null : (st.spares || []).find(x => x.id === m.inlineEditId);
        const stock = spare ? (spare.qty_on_hand ?? spare.currentStock ?? 0) : 0;
        const pipe = spare ? sparePipelineCols(canon(spare)) : { awaiting: 0, need: null };
        const panelHead = isNew ? '➕ Append spare part' : '✏️ Editing spare part';
        return `<section class="spare-item-edit-panel" aria-label="Spare part edit">
            <div class="spare-item-edit-head">${panelHead}</div>
            <div class="spare-item-edit-table-wrap">
                <table class="spare-data-table spare-item-edit-table">
                    ${SPARE_MAIN_COLGROUP}
                    <thead><tr>
                        <th class="c-chk" aria-hidden="true"></th>
                        <th class="c-num">Code</th>
                        <th class="c-cls">Class</th>
                        <th class="c-item">Item</th>
                        <th class="c-pno spare-col-head-stack">Part No.<span class="spare-head-sub">(Code No.)</span></th>
                        <th class="c-unit">Unit</th>
                        <th class="c-work" title="${SPARE_COL_WORK_TITLE}">${SPARE_COL_WORK}</th>
                        <th class="c-std" title="${SPARE_COL_STD_TITLE}">${SPARE_COL_STD}</th>
                        <th class="c-stk" title="${SPARE_COL_ROB_TITLE}">${SPARE_COL_ROB}</th>
                        <th class="c-await" title="${SPARE_COL_WAIT_TITLE}">${SPARE_COL_WAIT}</th>
                        <th class="c-need" title="${SPARE_COL_NEED_TITLE}">${SPARE_COL_NEED}</th>
                    </tr></thead>
                    <tbody><tr class="spare-row-editing">
                        <td class="c-chk"></td>
                        <td class="c-num">${rowCellInput('sie_code', r.code)}</td>
                        <td class="c-cls">${rowCellClassSelect('sie_class', r.class)}</td>
                        <td class="c-item">${rowCellInput('sie_item', r.item, 'spare-inline-input-wide')}</td>
                        <td class="c-pno">${rowCellInput('sie_pno', r.partNo)}</td>
                        <td class="c-unit">${rowCellInput('sie_unit', r.unit)}</td>
                        <td class="c-work">${rowCellInput('sie_working', r.working, 'spare-inline-input-num')}</td>
                        <td class="c-std">${rowCellInput('sie_standard', r.standard, 'spare-inline-input-num')}</td>
                        <td class="c-stk"><span class="spare-edit-stock">${esc(String(stock))}</span></td>
                        <td class="c-await"><span class="spare-edit-stock">${esc(String(pipe.awaiting))}</span></td>
                        <td class="c-need">${formatNeedHtml(pipe.need)}</td>
                    </tr></tbody>
                </table>
            </div>
            <div class="spare-item-edit-actions">
                <button type="button" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.saveInlineEdit()">💾 Save</button>
                <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.cancelInlineEdit()">Cancel</button>
            </div>
        </section>`;
    }

    function renderSpareEditBlockHtml(st) {
        return renderSpareGroupHeaderHtml(st) + renderSpareItemEditRowHtml(st);
    }

    function matchMergedGeneratorSearch(q) {
        if (!q) return true;
        const ql = q.toLowerCase();
        if (MERGED_GEN_ENGINE_LABEL.toLowerCase().includes(ql)) return true;
        if (/^0?[345]$/.test(ql)) return true;
        if ((ql.includes('03') || ql.includes('04') || ql.includes('05')) && (ql.includes('generator') || ql.includes('gen') || ql.length <= 3)) return true;
        if (ql.includes('generator') && ql.includes('engine')) return true;
        return false;
    }

    function mergeSpareTreeNodes(nodes) {
        const rest = [];
        let hasMerged = false;
        let mergedDept = null;
        let mergedEmpty = true;

        nodes.forEach(n => {
            if (isGeneratorEngineGroupLabel(n.label)) {
                hasMerged = true;
                mergedDept = n.department;
                if (!n.isEmpty) mergedEmpty = false;
                return;
            }
            rest.push(n);
        });

        if (hasMerged) {
            rest.push({
                key: MERGED_GEN_ENGINE_KEY,
                department: mergedDept,
                label: MERGED_GEN_ENGINE_LABEL,
                isEmpty: mergedEmpty,
                isMerged: true,
            });
        }

        rest.sort((a, b) => safeTreeLabel(a.label).localeCompare(safeTreeLabel(b.label)));
        return rest;
    }

    function init(opts) {
        getState = opts.getState || getState;
        refresh = opts.refresh || refresh;
    }

    async function reloadSparesCache() {
        const st = getState();
        if (!st) return;
        st.spares = await TVC_DB.SparePart.listAll().catch(() =>
            TVC_DB.getAll('spare_parts').then(rows => rows.map(TVC_SpareSchema.fromRow)));
    }

    function modState(st) {
        if (!st) st = getState();
        st.spareModule = st.spareModule || {
            partNo: '', description: '', universalCode: '',
            showLowOnly: false,
            spareFilter: 'total',
            selectedId: null,
            focusedId: null,
            panelOpen: false,
            selectedReqId: null,
            showReqPanel: false,
            reqWorkOpen: false,
            reqWorkFocusedId: null,
            reqWorkEditMode: false,
            reqWorkListEditing: false,
            reqWorkShowSelectedOnly: false,
            consumeOpen: false,
            consumeFocusedId: null,
            consumeShowSelectedOnly: false,
            consumeEditMode: false,
            consumePreview: false,
            consumeLastSavedLogId: null,
            receiveOpen: false,
            receiveFocusedId: null,
            receiveShowSelectedOnly: false,
            receiveTreeOpen: false,
            wrSpareOpen: false,
            wrSpareFocusedId: null,
            wrSpareShowSelectedOnly: false,
            wrSparePostSaveFilter: false,
            wrSpareReadonly: false,
            wrSpareTreeOpen: false,
            consumeTreeOpen: false,
            reqWorkTreeOpen: false,
            reqWorkListMode: false,
            reqWorkListDocPreview: false,
            reqListCheckedIds: {},
            reqListPhaseTab: REQ_LIST_PHASE.ALL,
            reqListPeriodFrom: '',
            reqListPeriodTo: '',
            reqListSearch: '',
            consumeLogCheckedIds: {},
            selectedConsumeLogId: null,
            consumeLogPeriodFrom: '',
            consumeLogPeriodTo: '',
            consumeLogSearch: '',
            inlineEditId: null,
            inlineDraft: null,
            groupHeaderEdit: false,
            groupHeaderDraft: null,
            groupHeaderEditKey: null,
        };
        return st.spareModule;
    }

    function isInlineEditing(st) {
        return !!modState(st).inlineEditId;
    }

    function canon(s) {
        const base = (s && s.makerPartNo != null) ? { ...s } : TVC_SpareSchema.fromRow(s);
        if (!base) return TVC_SpareSchema.blank();
        const tf = TVC_SpareSchema.textField;
        if (typeof tf === 'function') {
            base.drawingPartNo = tf(base.drawingPartNo);
        } else if (typeof base.drawingPartNo === 'string' && base.drawingPartNo.includes('[object Object]')) {
            base.drawingPartNo = base.drawingPartNo.replace(/\[object Object\]/g, '&');
        }
        // &가 "[object Object]"로 저장된 값 복원 (표시·편집·내보내기 공통)
        ['makerPartNo', 'inventoryNumbering', 'name', 'drawingPartNo', 'group', 'location', 'maker', 'model'].forEach(k => {
            if (typeof base[k] === 'string' && base[k].includes('[object Object]')) base[k] = fixAmp(base[k]);
        });
        return base;
    }

    function partNo(s) { return s.makerPartNo || s.part_no || ''; }

    function spareNumbering(s) {
        return s.inventoryNumbering || s.makerPartNo || s.part_no || '';
    }

    // 부품 코드(예: "01-001-01") 앞자리 → PMS Group 번호
    function spareCodeGroupNo(s) {
        const m = String(spareNumbering(s) || '').trim().match(/^(\d{1,2})[-.\s]/);
        return m ? parseInt(m[1], 10) : null;
    }

    // 부품 코드 앞자리로 소속 그룹 라벨(예: "01. MAIN ENGINE") 찾기
    function groupLabelFromCode(st, s) {
        const codeNo = spareCodeGroupNo(s);
        if (codeNo == null) return '';
        const dept = String(s.category || '').toUpperCase();
        const nodes = st.idx?.groupNodes || [];
        let node = nodes.find(n => pmsGroupSortNo(n.label) === codeNo && (!dept || n.department === dept));
        if (!node) node = nodes.find(n => pmsGroupSortNo(n.label) === codeNo);
        return node ? node.label : '';
    }

    function spareClass(s) {
        const cls = TVC_SpareSchema.normalizePartClass(canon(s).partClass);
        return cls || '—';
    }

    function spareDrawingNo(s) {
        const raw = canon(s).drawingPartNo;
        if (raw == null || raw === '') return '';
        if (typeof raw === 'string') {
            const v = raw.trim();
            return v.includes('[object Object]') ? v.replace(/\[object Object\]/g, '&') : v;
        }
        if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
        return '';
    }

    function spareStandardQty(s) {
        return String(TVC_Inventory.standardStock(canon(s)));
    }

    function spareWorking(s) {
        return String(TVC_SpareSchema.intStock(canon(s).workingQty));
    }

    function spareUnit(s) {
        const u = String(canon(s).unit || 'EA').trim().toUpperCase();
        return u || 'EA';
    }

    async function syncReportedWaitMap(vesselId) {
        const st = getState();
        if (!vesselId) {
            try { vesselId = (await vesselScope()).vesselId; } catch { _reportedWaitBySpareId = new Map(); return; }
        }
        try {
            const allReqs = await TVC_Inventory.listRequisitions(null);
            const dept = String(st?.department || '').trim().toUpperCase();
            const scoped = allReqs.filter(r => {
                if (!vesselId) return true;
                if (r.vessel_id === vesselId) return true;
                if (!r.vessel_id && String(r.department || '').trim().toUpperCase() === dept) return true;
                return false;
            });
            const map = new Map();
            const partMap = new Map();
            scoped.forEach(req => {
                if (reqOsWaived(req)) return;
                const effective = reqEffectiveForWait(req);
                (effective.lines || []).forEach(l => {
                    const pending = reqLinePendingQty(l);
                    if (pending <= 0) return;
                    const sid = spareIdForReqLine(l, st);
                    if (sid) map.set(sid, (map.get(sid) || 0) + pending);
                    const pno = String(l.part_no || '').trim().toLowerCase();
                    if (pno) partMap.set(pno, (partMap.get(pno) || 0) + pending);
                });
            });
            _reportedWaitBySpareId = map;
            _reportedWaitByPartNo = partMap;
        } catch (_) {
            _reportedWaitBySpareId = new Map();
            _reportedWaitByPartNo = new Map();
        }
    }

    /** 미수급 수량 — Wait · Requisition List O/S 공통 (Req − Rcvd) */
    function reqLinePendingQty(line) {
        if (!line) return 0;
        return Math.max(0, (Number(line.qty_requested) || 0) - (Number(line.qty_received) || 0));
    }

    function reqEffectiveForWait(req) {
        if (!_reqWorkDraft || _reqWorkDraft.id !== req?.id) return req;
        if (reqListWorkflowLabel(_reqWorkDraft) !== 'Received') return req;
        const m = modState(getState());
        if ((isRequisitionListWindow(m) && m.reqWorkListEditing)
            || (m.reqWorkEditMode && !m.reqWorkPreview)) {
            return _reqWorkDraft;
        }
        return req;
    }

    function spareIdForReqLine(line, st) {
        const id = reqWorkSpareIdKey(line?.spare_part_id);
        if (id && (st?.spares || []).some(s => reqWorkSameSpareId(s.id, id))) return id;
        const pno = String(line?.part_no || '').trim().toLowerCase();
        if (!pno) return id || '';
        const spare = (st?.spares || []).find(s => {
            const c = canon(s);
            return [spareNumbering(c), c.makerPartNo, s.part_no].some(v => String(v || '').trim().toLowerCase() === pno);
        });
        return spare ? reqWorkSpareIdKey(spare.id) : (id || '');
    }

    function requisitionContributesToSpareWait(req) {
        if (!req?.id || reqOsWaived(req)) return false;
        const effective = reqEffectiveForWait(req);
        return (effective.lines || []).some(l => reqLinePendingQty(l) > 0);
    }

    function reportedWaitQty(s) {
        const c = canon(s);
        const id = reqWorkSpareIdKey(c?.id ?? s?.id);
        if (id && _reportedWaitBySpareId.has(id)) return _reportedWaitBySpareId.get(id) || 0;
        const pno = String(spareNumbering(c) || c.makerPartNo || s?.part_no || '').trim().toLowerCase();
        if (pno && _reportedWaitByPartNo?.has(pno)) return _reportedWaitByPartNo.get(pno) || 0;
        return 0;
    }

    async function syncReportedWaitAndRefreshList() {
        await syncReportedWaitMap();
        refreshList();
    }

    async function syncReqLineMap() {
        _reqLineBySpareId = new Map();
        if (_reqWorkDraft && modState(getState()).reqWorkOpen) {
            _reqLineMapReqId = '__draft__';
            (_reqWorkDraft.lines || []).forEach(l => {
                const id = reqWorkSpareIdKey(l.spare_part_id);
                if (id) _reqLineBySpareId.set(id, l);
            });
            return;
        }
        const reqId = _reqSheet.reqId || modState(getState()).selectedReqId;
        _reqLineMapReqId = reqId || null;
        if (!reqId) return;
        try {
            const req = await TVC_Inventory.getRequisition(reqId);
            (req?.lines || []).forEach(l => {
                const id = reqWorkSpareIdKey(l.spare_part_id);
                if (id) _reqLineBySpareId.set(id, l);
            });
        } catch (_) { /* noop */ }
    }

    function getReqWorkSession() {
        return _reqWorkDraft;
    }

    /** SPARE 목록 화면 ㅁ 체크 상태 (재고 조회용 — 청구서와 독립) */
    function spareListSelectedMap(st) {
        if (!st.spareListSelected) st.spareListSelected = {};
        return st.spareListSelected;
    }

    function spareListSelectedIds(st) {
        return Object.keys(spareListSelectedMap(st)).filter(id => st.spareListSelected[id]);
    }

    function clearSpareListSelection(st) {
        st.spareListSelected = {};
    }

    /** New Requisition 선택 아이템 ID 목록 — _reqWorkDraft.lines 와 동기화 */
    function syncRequisitionDraftFromLines() {
        const st = getState();
        const req = getReqWorkSession();
        st.requisitionDraft = (req?.lines || [])
            .map(l => reqWorkSpareIdKey(l.spare_part_id))
            .filter(Boolean);
    }

    /** Requisition List — 로드된 청구서 첫 부품으로 SPARE Group 헤더 자동 표시 */
    function syncReqWorkHeaderFocusFromLines(st) {
        const m = modState(st);
        if (!isRequisitionListWindow(m)) return;
        const req = getReqWorkSession();
        let focusId = null;
        for (const line of req?.lines || []) {
            const id = reqWorkSpareIdKey(line.spare_part_id);
            if (!id) continue;
            const spare = (st.spares || []).find(s => reqWorkSameSpareId(s.id, id));
            if (spare) {
                focusId = spare.id;
                break;
            }
        }
        m.reqWorkFocusedId = focusId;
    }

    function clearRequisitionDraft(st) {
        st.requisitionDraft = [];
        if (_reqWorkDraft) _reqWorkDraft.lines = [];
        syncReqLineMap();
    }

    function reqWorkSpareIdKey(id) {
        return id == null ? '' : String(id);
    }

    function reqWorkSameSpareId(a, b) {
        return reqWorkSpareIdKey(a) === reqWorkSpareIdKey(b);
    }

    function reqWorkRowChecked(s) {
        return !!_reqLineBySpareId?.get(reqWorkSpareIdKey(s.id));
    }

    function getConsumeSession() {
        return _consumeDraft;
    }

    function consumeSpareIdKey(id) {
        return id == null ? '' : String(id);
    }

    function consumeSameSpareId(a, b) {
        return consumeSpareIdKey(a) === consumeSpareIdKey(b);
    }

    function syncConsumeLineMap() {
        const map = new Map();
        (_consumeDraft?.lines || []).forEach(l => {
            const id = consumeSpareIdKey(l.spare_part_id);
            if (id) map.set(id, l);
        });
        _consumeLineBySpareId = map;
    }

    function consumeRowChecked(s) {
        return !!_consumeLineBySpareId?.get(consumeSpareIdKey(s.id));
    }

    function consumeCheckedSpareCount(st) {
        return (st.spares || []).reduce((n, s) => n + (consumeRowChecked(canon(s)) ? 1 : 0), 0);
    }

    function consumeSelectedBtnMeta(st) {
        const m = modState(st);
        const n = consumeCheckedSpareCount(st);
        const on = !!m.consumeShowSelectedOnly;
        return {
            label: on ? `Show All (${n})` : `Selected Items${n >= 1 ? ` (${n})` : ''}`,
            title: on ? 'Show full parts list' : (n >= 1 ? 'Show selected parts only' : 'Select parts using the checkbox'),
            disabled: !on && n < 1,
            active: on,
        };
    }

    function consumeSelectedCountLabel(st, visibleCount) {
        const allCanon = (st.spares || []).length;
        if (spareListSearchQuery(st)) return `${visibleCount} / ${allCanon}`;
        return `${consumeCheckedSpareCount(st)} selected`;
    }

    function reqWorkCheckedSpareCount(st) {
        return (st.spares || []).reduce((n, s) => n + (reqWorkRowChecked(canon(s)) ? 1 : 0), 0);
    }

    function reqWorkSelectedBtnMeta(st) {
        const m = modState(st);
        const n = reqWorkCheckedSpareCount(st);
        if (isRequisitionListWindow(m)) {
            return {
                label: n >= 1 ? `Selected Items (${n})` : 'No requisition selected',
                title: 'Requisition List shows parts from the selected requisition only',
                disabled: true,
                active: true,
            };
        }
        const on = !!m.reqWorkShowSelectedOnly;
        return {
            label: on ? `Show All (${n})` : `Selected Items${n >= 1 ? ` (${n})` : ''}`,
            title: on ? 'Show full parts list' : (n >= 1 ? 'Show selected parts only' : 'Select parts using the checkbox'),
            disabled: !on && n < 1,
            active: on,
        };
    }

    function reqWorkSelectedCountLabel(st, visibleCount) {
        const allCanon = (st.spares || []).length;
        if (spareListSearchQuery(st)) return `${visibleCount} / ${allCanon}`;
        return `${reqWorkCheckedSpareCount(st)} selected`;
    }

    // Complete 완료(Complete) 후 · Requisition List 조회 모드에서는 폼을 잠근다.
    function isReqWorkListViewLocked() {
        const m = modState(getState());
        return isRequisitionListWindow(m) && !m.reqWorkListEditing;
    }

    function reqWorkFormLocked() {
        const m = modState(getState());
        if (m.reqWorkCompleted) return true;
        if (m.reqWorkListDocPreview) return true;
        return isReqWorkListViewLocked();
    }

    function reqWorkListLockTip() {
        return 'Click Modify at the top to edit this requisition.';
    }

    function reqWorkSpareActionBlocked() {
        const m = modState(getState());
        return m.reqWorkOpen && reqWorkFormLocked();
    }

    function applyReqWorkScrollLock(body) {
        const scroll = body?.querySelector?.('.spare-req-work-scroll');
        if (!scroll) return;
        const locked = reqWorkFormLocked();
        scroll.classList.toggle('is-req-locked', locked);
        const keepActive = new Set(['reqWorkHistBtn']);
        scroll.querySelectorAll('input, select, textarea, button').forEach(el => {
            if (keepActive.has(el.id)) return;
            if (locked) el.setAttribute('disabled', 'disabled');
            else el.removeAttribute('disabled');
        });
        if (!locked) syncSpareToolbarUi();
    }

    function reqWorkRequestCellHtml(s, sid, locked = false) {
        const line = _reqLineBySpareId?.get(reqWorkSpareIdKey(s.id));
        if (!line) return '0';
        const qty = Number(line.qty_requested) || 0;
        return `<input type="number" min="0" step="1" inputmode="numeric" pattern="[0-9]*" class="spare-req-qty-input" value="${qty}"${locked ? ' disabled' : ''}
            onclick="event.stopPropagation()" onmousedown="event.stopPropagation()"
            onfocus="event.stopPropagation();this.select()"
            onchange="TVC_SpareMenu.reqWorkSetRequestQty('${sid}', this.value)">`;
    }

    function reqWorkReceivedQtyEditable() {
        const req = getReqWorkSession();
        if (!req || reqListWorkflowLabel(req) !== 'Received') return false;
        const m = modState(getState());
        if (isRequisitionListWindow(m) && m.reqWorkListEditing) return true;
        if (m.reqWorkEditMode && !m.reqWorkPreview) return true;
        return false;
    }

    function reqWorkReceivedCellHtml(s, sid) {
        const line = _reqLineBySpareId?.get(reqWorkSpareIdKey(s.id));
        if (!line) return '0';
        const qty = Number(line.qty_received) || 0;
        return `<input type="number" min="0" step="1" inputmode="numeric" pattern="[0-9]*" class="spare-req-qty-input spare-req-rcvd-qty-input" value="${qty}"
            onclick="event.stopPropagation()" onmousedown="event.stopPropagation()"
            onfocus="event.stopPropagation();this.select()"
            onchange="TVC_SpareMenu.reqWorkSetReceivedQty('${sid}', this.value)">`;
    }

    function consumeQtyCellHtml(s, sid) {
        const line = _consumeLineBySpareId?.get(consumeSpareIdKey(s.id));
        if (!line) return '0';
        const qty = Number(line.qty_consumed) || 0;
        if (modState(getState()).consumePreview) return String(qty);
        return `<input type="number" min="0" step="1" inputmode="numeric" pattern="[0-9]*" class="spare-consume-qty-input" value="${qty}"
            onclick="event.stopPropagation()" onmousedown="event.stopPropagation()"
            onfocus="event.stopPropagation();this.select()"
            onchange="TVC_SpareMenu.consumeSetQty('${sid}', this.value)">`;
    }

    function receiveSpareIdKey(id) {
        return id == null ? '' : String(id);
    }

    function receiveSameSpareId(a, b) {
        return receiveSpareIdKey(a) === receiveSpareIdKey(b);
    }

    function getReceiveSession() {
        return _receiveDraft;
    }

    function syncReceiveLineMap() {
        const map = new Map();
        (_receiveDraft?.lines || []).forEach(l => {
            const id = receiveSpareIdKey(l.spare_part_id);
            if (id) map.set(id, l);
        });
        _receiveLineBySpareId = map;
    }

    function receiveRowChecked(s) {
        return !!_receiveLineBySpareId?.get(receiveSpareIdKey(s.id));
    }

    function receiveCheckedSpareCount(st) {
        return (st.spares || []).reduce((n, s) => n + (receiveRowChecked(canon(s)) ? 1 : 0), 0);
    }

    function receiveSelectedBtnMeta(st) {
        const m = modState(st);
        const n = receiveCheckedSpareCount(st);
        const on = !!m.receiveShowSelectedOnly;
        return {
            label: on ? `Show All (${n})` : `Selected Items${n >= 1 ? ` (${n})` : ''}`,
            title: on ? 'Show full parts list' : (n >= 1 ? 'Show selected parts only' : 'Select parts using the checkbox'),
            disabled: !on && n < 1,
            active: on,
        };
    }

    function receiveSelectedCountLabel(st, visibleCount) {
        const allCanon = (st.spares || []).length;
        if (spareListSearchQuery(st)) return `${visibleCount} / ${allCanon}`;
        return `${receiveCheckedSpareCount(st)} selected`;
    }

    function receiveQtyCellHtml(s, sid) {
        const line = _receiveLineBySpareId?.get(receiveSpareIdKey(s.id));
        if (!line) return '0';
        const qty = Number(line.qty_received) || 0;
        return `<input type="number" min="0" step="1" inputmode="numeric" pattern="[0-9]*" class="spare-receive-qty-input" value="${qty}"
            onclick="event.stopPropagation()" onmousedown="event.stopPropagation()"
            onfocus="event.stopPropagation();this.select()"
            onchange="TVC_SpareMenu.receiveSetQty('${sid}', this.value)">`;
    }

    function wrSpareIdKey(id) {
        return id == null ? '' : String(id);
    }

    function wrSameSpareId(a, b) {
        return wrSpareIdKey(a) === wrSpareIdKey(b);
    }

    function syncWrLineMap() {
        const map = new Map();
        (getState()._wrUsedParts || []).forEach(l => {
            const id = wrSpareIdKey(l.spare_part_id);
            if (id) map.set(id, l);
        });
        _wrSpareLineBySpareId = map;
    }

    function wrSpareRowChecked(s) {
        return !!_wrSpareLineBySpareId?.get(wrSpareIdKey(s.id));
    }

    function wrSpareCheckedCount(st) {
        return (st.spares || []).reduce((n, s) => n + (wrSpareRowChecked(canon(s)) ? 1 : 0), 0);
    }

    function wrSpareSelectedBtnMeta(st) {
        const m = modState(st);
        const n = wrSpareCheckedCount(st);
        const on = !!m.wrSpareShowSelectedOnly;
        return {
            label: on ? `Show All (${n})` : `Selected Items${n >= 1 ? ` (${n})` : ''}`,
            title: on ? 'Show full parts list' : (n >= 1 ? 'Show selected parts only' : 'Select parts using the checkbox'),
            disabled: !on && n < 1,
            active: on,
        };
    }

    function wrSpareSelectedCountLabel(st, visibleCount) {
        const allCanon = (st.spares || []).length;
        if (spareListSearchQuery(st)) return `${visibleCount} / ${allCanon}`;
        return `${wrSpareCheckedCount(st)} selected`;
    }

    function buildWrLine(spare, qty) {
        const c = canon(spare);
        return {
            spare_part_id: c.id || spare.id,
            part_no: spareNumbering(c) || spare.part_no || '',
            name: c.name || spare.name || '',
            universal_code: c.universalItemCode || spare.universal_code || '',
            qty_on_hand: TVC_Inventory.currentStock(spare),
            qty_used: Math.max(0, Math.floor(Number(qty) || 0)),
        };
    }

    function wrQtyCellHtml(s, sid, ro = false) {
        const line = _wrSpareLineBySpareId?.get(wrSpareIdKey(s.id));
        if (!line) return ro ? '0' : `<input type="number" min="0" step="1" inputmode="numeric" pattern="[0-9]*" class="spare-wr-qty-input" value="0" disabled
            onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">`;
        const qty = Number(line.qty_used) || 0;
        if (ro) return String(qty);
        return `<input type="number" min="0" step="1" inputmode="numeric" pattern="[0-9]*" class="spare-wr-qty-input" value="${qty}"
            onclick="event.stopPropagation()" onmousedown="event.stopPropagation()"
            onfocus="event.stopPropagation();this.select()"
            onchange="TVC_SpareMenu.wrSpareSetQty('${sid}', this.value)">`;
    }

    function updateSpareHeadCheckAll() {
        const el = document.getElementById('spareHeadChkAll');
        if (!el) return;
        const batchMap = getState().spareListSelected || {};
        const list = _cachedList || [];
        if (!list.length) {
            el.checked = false;
            el.indeterminate = false;
            return;
        }
        let n = 0;
        list.forEach(s => { if (batchMap[s.id]) n++; });
        el.checked = n === list.length;
        el.indeterminate = n > 0 && n < list.length;
    }

    function updateReqWorkHeadCheckAll() {
        const el = document.getElementById('reqWorkHeadChkAll');
        if (!el) return;
        const list = _reqWorkCachedList || [];
        if (!list.length) {
            el.checked = false;
            el.indeterminate = false;
            return;
        }
        let n = 0;
        list.forEach(s => { if (reqWorkRowChecked(s)) n++; });
        el.checked = n === list.length;
        el.indeterminate = n > 0 && n < list.length;
    }

    function toggleSpareAll(checked) {
        const st = getState();
        if (!st.spareListSelected) st.spareListSelected = {};
        (_cachedList || []).forEach(s => {
            if (checked) st.spareListSelected[s.id] = true;
            else delete st.spareListSelected[s.id];
        });
        refreshList();
    }

    function updateConsumeHeadCheckAll() {
        const el = document.getElementById('consumeHeadChkAll');
        if (!el) return;
        const list = _consumeCachedList || [];
        if (!list.length) {
            el.checked = false;
            el.indeterminate = false;
            return;
        }
        let n = 0;
        list.forEach(s => { if (consumeRowChecked(s)) n++; });
        el.checked = n === list.length;
        el.indeterminate = n > 0 && n < list.length;
    }

    function reqWorkToggleAll(checked) {
        if (reqWorkFormLocked()) return;
        const req = getReqWorkSession();
        if (!req) return;
        captureReqWorkMeta();
        const list = _reqWorkCachedList || [];
        req.lines = req.lines || [];
        if (checked) {
            list.forEach(s => {
                if (!req.lines.some(l => reqWorkSameSpareId(l.spare_part_id, s.id))) {
                    req.lines.push(buildReqLine(s, 0));
                }
            });
        } else {
            const visibleIds = new Set(list.map(s => reqWorkSpareIdKey(s.id)));
            req.lines = req.lines.filter(l => !visibleIds.has(reqWorkSpareIdKey(l.spare_part_id)));
        }
        syncRequisitionDraftFromLines();
        syncReqLineMap();
        const st = getState();
        if (modState(st).reqWorkShowSelectedOnly && !reqWorkCheckedSpareCount(st)) {
            modState(st).reqWorkShowSelectedOnly = false;
        }
        refreshReqWorkListUi();
    }

    function consumeToggleAll(checked) {
        const draft = getConsumeSession();
        if (!draft) return;
        captureConsumeMeta();
        const list = _consumeCachedList || [];
        draft.lines = draft.lines || [];
        if (checked) {
            list.forEach(s => {
                if (!draft.lines.some(l => consumeSameSpareId(l.spare_part_id, s.id))) {
                    draft.lines.push(buildConsumeLine(s, 0));
                }
            });
        } else {
            const visibleIds = new Set(list.map(s => consumeSpareIdKey(s.id)));
            draft.lines = draft.lines.filter(l => !visibleIds.has(consumeSpareIdKey(l.spare_part_id)));
        }
        syncConsumeLineMap();
        const st = getState();
        if (modState(st).consumeShowSelectedOnly && !consumeCheckedSpareCount(st)) {
            modState(st).consumeShowSelectedOnly = false;
        }
        refreshConsumeListUi();
    }

    function spareBaselineQty(s) {
        const c = canon(s);
        const std = Number(TVC_Inventory.standardStock(c)) || 0;
        if (std > 0) return std;
        const min = Number(TVC_Inventory.minStock(c)) || 0;
        if (min > 0) return min;
        return null;
    }

    function formatNeedHtml(need) {
        if (need == null) return '<span class="qty-na muted" title="Standard or Min not set">—</span>';
        return esc(String(need));
    }

    function sparePipelineCols(s, line = null) {
        const stock = TVC_Inventory.currentStock(s);
        const awaiting = reportedWaitQty(s);
        const baseline = spareBaselineQty(s);
        const need = baseline != null ? Math.max(0, baseline - stock - awaiting) : null;
        const request = line ? (Number(line.qty_requested) || 0) : 0;
        const assess = line?.qty_approved != null ? String(line.qty_approved) : '—';
        const rcvd = line ? String(Number(line.qty_received) || 0) : '—';
        return { stock, awaiting, need, request, assess, rcvd };
    }

    /** @deprecated alias */
    function spareOrderCols(s) {
        return sparePipelineCols(s, _reqLineBySpareId?.get(reqWorkSpareIdKey(s.id)));
    }

    function spareInventoryUser(st) {
        const session = typeof TVC_Auth !== 'undefined' ? TVC_Auth.getCurrentUser() : null;
        let user = session || st?.user;
        if (!user) return null;
        const role = user.role || TVC_RBAC?.resolveUserRole?.(user);
        const resolved = role && role !== user.role ? { ...user, role } : user;
        if (st) st.user = resolved;
        return resolved;
    }

    function canModifySpare(st) {
        if (typeof TVC_App?.canEditSpareItems === 'function') {
            return TVC_App.canEditSpareItems();
        }
        return window.TVC_RBAC && TVC_RBAC.canModifySpareInventory(spareInventoryUser(st));
    }

    function canCreateRequisition(st) {
        const user = spareInventoryUser(st);
        return !!(typeof TVC_RBAC !== 'undefined' && user && TVC_RBAC.can(user, TVC_RBAC.Action.CREATE_REQUISITION));
    }

    function canCreateConsume(st) {
        const user = spareInventoryUser(st);
        return !!(typeof TVC_RBAC !== 'undefined' && user && TVC_RBAC.can(user, TVC_RBAC.Action.DEDUCT_INVENTORY));
    }

    function canCreateDeliver(st) {
        const user = spareInventoryUser(st);
        return !!(typeof TVC_RBAC !== 'undefined' && user && TVC_RBAC.can(user, TVC_RBAC.Action.SUPPLY_PARTS));
    }

    /** New Requisition Complete — Chief Engineer or HQ Superintendent */
    function canCompleteRequisition(st) {
        const user = spareInventoryUser(st);
        if (!user || !window.TVC_RBAC) return false;
        const role = TVC_RBAC.resolveUserRole(user);
        return role === TVC_RBAC.Role.SHIP_CHIEF || role === TVC_RBAC.Role.HQ_SUPERVISOR;
    }

    function getFocusedSpareId(st) {
        const m = modState(st);
        if (m.wrSpareOpen) return m.wrSpareFocusedId || null;
        if (m.receiveOpen) return m.receiveFocusedId || null;
        if (m.consumeOpen) return m.consumeFocusedId || null;
        if (m.reqWorkOpen) return m.reqWorkFocusedId || null;
        return st?.focusedSpareId || m.focusedId || null;
    }

    function setFocusedSpareId(st, id) {
        const m = modState(st);
        if (m.wrSpareOpen) {
            m.wrSpareFocusedId = id || null;
            return;
        }
        if (m.receiveOpen) {
            m.receiveFocusedId = id || null;
            return;
        }
        if (m.consumeOpen) {
            m.consumeFocusedId = id || null;
            return;
        }
        if (m.reqWorkOpen) {
            m.reqWorkFocusedId = id || null;
            return;
        }
        st.focusedSpareId = id || null;
        m.focusedId = id || null;
    }

    function afterSpareListChange(st) {
        const m = modState(st);
        if (m.consumeOpen) {
            refreshConsumeListUi();
            syncSpareToolbarUi();
        } else if (m.receiveOpen) {
            refreshReceiveListUi();
            syncSpareToolbarUi();
        } else if (m.wrSpareOpen) {
            refreshWrSpareListUi();
        } else if (m.reqWorkOpen) {
            refreshReqWorkListUi();
            syncSpareToolbarUi();
        } else if (st.currentTab === 'actual') {
            if (window.TVC_App?.renderPlanGroupHeader) TVC_App.renderPlanGroupHeader();
            if (window.TVC_App?.refreshActualPlan) TVC_App.refreshActualPlan();
        } else {
            render();
        }
    }

    function isSpareChecked(st, id) {
        return !!(st.spareListSelected && st.spareListSelected[id]);
    }

    function getCheckedSpareIds(st) {
        return Object.keys(st.spareListSelected || {}).filter(id => st.spareListSelected[id]);
    }

    /** @deprecated detail/legacy — 포커스 행 */
    function getSelectedSpareId(st) {
        return getFocusedSpareId(st);
    }

    function setSelectedSpareId(st, id) {
        setFocusedSpareId(st, id);
    }

    function spareGroupLabel(s) {
        return String(s.group || '').trim() || '—';
    }

    function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }

    /** 잘릴 수 있는 테이블 셀 — 마우스 오버 시 전체 텍스트 툴팁 */
    function cellTitleAttr(val) {
        const t = String(val ?? '').trim();
        if (!t || t === '—') return '';
        return ` title="${escAttr(t)}"`;
    }

    /** Original/Actual Plan과 동일한 GROUP Tree — SPARE 탭 전용 렌더 */
    function renderSpareGroupTree() {
        const st = getState();
        const root = document.getElementById('spareGroupTree');
        if (!root) return;
        if (st.selectedGroupKey === CRITICAL_GROUP_KEY) st.selectedGroupKey = null;
        if (!st.idx && (st.jobs || []).length && window.TVC_Indexes) {
            st.idx = TVC_Indexes.build(st);
        }
        if (!st.idx) {
            root.innerHTML = '<div class="tree-empty muted">Loading Maintenance Plan…<br>Please open the Original Plan tab once.</div>';
            return;
        }
        const q = (st.treeSearch || '').toLowerCase();
        const matchNode = (n) => !q || (n.label || '').toLowerCase().includes(q) || (n.department || '').toLowerCase().includes(q);
        const byDept = new Map();
        (st.idx.groupNodes || [])
            .filter(n => {
                if (isHiddenSpareGroup(n.label, n.department)) return false;
                if (st.department && n.department !== st.department) return false;
                if (matchNode(n)) return true;
                return isGeneratorEngineGroupLabel(n.label) && matchMergedGeneratorSearch(q);
            })
            .forEach(n => {
                if (!byDept.has(n.department)) byDept.set(n.department, []);
                byDept.get(n.department).push(n);
            });
        const allSelected = !st.selectedGroupKey;
        let html = `<div class="tree-node${allSelected ? ' selected' : ''}" onclick="TVC_App.selectGroup(null)"><span>📋 All Groups</span></div>`;
        if (!byDept.size && q) {
            html += `<div class="tree-empty muted">No groups match "${esc(q)}"</div>`;
        }
        DEPT_TREE_ORDER.filter(d => byDept.has(d)).forEach(dept => {
            const nodes = byDept.get(dept);
            html += `<div class="tree-dept">${esc(dept)}</div>`;
            mergeSpareTreeNodes(nodes).forEach(n => {
                const emptyTag = n.isEmpty ? `<span class="tree-empty-tag" title="No job items">0</span>` : '';
                const sel = st.selectedGroupKey === n.key ? ' selected' : '';
                html += `<div class="tree-node${sel}${n.isEmpty ? ' tree-node-empty' : ''}" onclick="TVC_App.selectGroup('${escAttr(n.key)}')"><span>${esc(safeTreeLabel(n.label))}</span>${emptyTag}</div>`;
            });
        });
        root.innerHTML = html;
        const searchEl = document.getElementById('spareTreeSearch');
        if (searchEl && document.activeElement !== searchEl) searchEl.value = st.treeSearch || '';
    }

    /** Original/Actual Plan GROUP 목록 — GROUP Tree와 동일 소스 */
    function buildGroupSelectHtml(st, selected) {
        if (!st.idx && (st.jobs || []).length && window.TVC_Indexes) {
            st.idx = TVC_Indexes.build(st);
        }
        const deptRank = { ENGINE: 0, DECK: 1 };
        const nodes = (st.idx?.groupNodes || [])
            .filter(n => !st.department || n.department === st.department)
            .sort((a, b) => (deptRank[a.department] ?? 9) - (deptRank[b.department] ?? 9) || a.label.localeCompare(b.label));
        let html = '<option value="">— Unassigned —</option>';
        let curDept = '';
        nodes.forEach(n => {
            if (n.department !== curDept) {
                if (curDept) html += '</optgroup>';
                html += `<optgroup label="${esc(n.department)}">`;
                curDept = n.department;
            }
            const sel = String(selected || '').trim() === n.label ? ' selected' : '';
            html += `<option value="${esc(n.label).replace(/"/g, '&quot;')}"${sel}>${esc(n.label)}</option>`;
        });
        if (curDept) html += '</optgroup>';
        return html;
    }

    function spareMatchesGroup(s, node) {
        const spareGroup = String(s.group || '').trim().toLowerCase();
        const nodeLabel = String(node.label || '').trim().toLowerCase();
        if (spareGroup && nodeLabel && spareGroup === nodeLabel) return true;
        // 코드 앞자리(예: 01-...)가 그룹 번호(예: 01. MAIN ENGINE)와 같으면 해당 그룹에도 포함
        const nodeNo = pmsGroupSortNo(node.label);
        const codeNo = spareCodeGroupNo(s);
        if (nodeNo != null && codeNo != null && nodeNo === codeNo) return true;
        return false;
    }

    async function vesselScope() {
        const st = getState();
        const isHq = window.TVC_RBAC && TVC_RBAC.isHqAccount(st.user);
        const vesselId = isHq ? st.selectedVesselId : (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID));
        return { st, isHq, vesselId };
    }

    function matchSpare(s, st, f) {
        const q = (f.partNo || f.description || '').toLowerCase().trim();
        if (q) {
            const hay = [
                spareNumbering(s),
                s.name,
                spareDrawingNo(s),
                spareUnit(s),
                spareWorking(s),
                s.universalItemCode || s.universalCode || s.universal_code || '',
                spareClass(s),
            ].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        if (st.department) {
            const cat = (s.category || 'GENERAL').toUpperCase();
            if (cat !== st.department) return false;
        }
        const groupKey = st.selectedGroupKey;
        if (groupKey === CRITICAL_GROUP_KEY) {
            if (!s.isCritical) return false;
        } else if (groupKey === MERGED_GEN_ENGINE_KEY) {
            if (!spareInMergedGeneratorEngine(s)) return false;
        } else if (groupKey) {
            const node = st.idx?.groupNodes?.find(n => n.key === groupKey);
            if (node) {
                if (node.department) {
                    const cat = (s.category || 'GENERAL').toUpperCase();
                    if (cat !== node.department) return false;
                }
                if (!spareMatchesGroup(s, node)) return false;
            }
        }
        const sf = f.spareFilter || (f.showLowOnly ? 'lowStock' : 'total');
        if (sf === 'lowStock' && !TVC_Inventory.isLowStock(s)) return false;
        if (sf === 'legal' && spareClass(s) !== 'L') return false;
        return true;
    }

    function filteredSpares(st) {
        const f = modState(st);
        return (st.spares || []).map(canon).filter(s => matchSpare(s, st, f));
    }

    /** 검색/재고 필터와 무관하게, 현재 선택된 그룹(병합/크리티컬 포함)에 속한 모든 부품 */
    function sparesInSelectedGroup(st) {
        const key = st.selectedGroupKey;
        const all = (st.spares || []).map(canon).filter(s => {
            if (st.department) {
                const cat = (s.category || 'GENERAL').toUpperCase();
                if (cat !== st.department) return false;
            }
            return true;
        });
        if (!key) return all;
        if (key === CRITICAL_GROUP_KEY) return all.filter(s => s.isCritical);
        if (key === MERGED_GEN_ENGINE_KEY) return all.filter(s => spareInMergedGeneratorEngine(s));
        const node = st.idx?.groupNodes?.find(n => n.key === key);
        if (!node) return [];
        return all.filter(s => {
            if (node.department) {
                const cat = (s.category || 'GENERAL').toUpperCase();
                if (cat !== node.department) return false;
            }
            return spareMatchesGroup(s, node);
        });
    }

    function spareListSearchQuery(st) {
        const f = modState(st);
        return (f.partNo || f.description || st.spareSearch || '').trim();
    }

    function filteredReqWorkSpares(st) {
        const m = modState(st);
        const list = filteredSpares(st);
        if (isRequisitionListWindow(m)) {
            if (!reqWorkCheckedSpareCount(st)) return [];
            return list.filter(s => reqWorkRowChecked(s));
        }
        if (!m.reqWorkShowSelectedOnly) return list;
        return list.filter(s => reqWorkRowChecked(s));
    }

    function filteredConsumeSpares(st) {
        const m = modState(st);
        const list = filteredSpares(st);
        if (!m.consumeShowSelectedOnly) return list;
        return list.filter(s => consumeRowChecked(s));
    }

    function filteredReceiveSpares(st) {
        const m = modState(st);
        const list = filteredSpares(st);
        if (!m.receiveShowSelectedOnly) return list;
        return list.filter(s => receiveRowChecked(s));
    }

    function filteredWrSpares(st) {
        const m = modState(st);
        if (!m.wrSpareShowSelectedOnly) return filteredSpares(st);
        if (spareListSearchQuery(st)) return filteredSpares(st);
        const f = modState(st);
        const stNoGroup = { ...st, selectedGroupKey: null };
        return (st.spares || []).map(canon).filter(s => {
            if (!wrSpareRowChecked(s)) return false;
            return matchSpare(s, stNoGroup, f);
        });
    }

    function groupFilterLabel(st) {
        if (!st.selectedGroupKey) return '';
        if (st.selectedGroupKey === CRITICAL_GROUP_KEY) return 'Critical Equipment';
        if (st.selectedGroupKey === MERGED_GEN_ENGINE_KEY) return MERGED_GEN_ENGINE_LABEL;
        const node = st.idx?.groupNodes?.find(n => n.key === st.selectedGroupKey);
        return node?.label || '';
    }

    function updatePanelLayout(open) {
        document.querySelector('.spare-layout')?.classList.toggle('panel-open', open);
        document.getElementById('spareDetailPanel')?.classList.toggle('open', open);
    }

    async function maintenanceHistory(spareId, st) {
        const s = (st.spares || []).map(canon).find(x => x.id === spareId);
        const items = [];
        (s?.history || []).forEach(h => {
            if (/TASK|MAINT|DEDUCT|CONFIRM/.test(h.type || '')) {
                items.push({ at: h.at, jobCode: h.ref || '—', qty: h.qty, type: h.type, note: h.note || '' });
            }
        });
        try {
            const bomLinks = await TVC_DB.indexGetAll('job_bom', 'by_spare', spareId);
            bomLinks.forEach(l => items.push({ at: l.created_at, jobCode: l.job_code, qty: l.qty_per_job, type: 'BOM', note: 'Linked in BOM' }));
        } catch (_) { /* noop */ }
        (st.reports || []).filter(r => TVC_RBAC.isConfirmedStatus(r.status) || TVC_RBAC.isApprovedStatus(r.status)).forEach(r => {
            (r.used_parts || []).filter(u => u.spare_part_id === spareId).forEach(u => {
                items.push({ at: r.confirmed_at || r.approved_at || r.created_at, jobCode: r.job_code, qty: -(u.qty_used || 0), type: 'WORK_REPORT', note: r.reporter_name || '' });
            });
        });
        return items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    }

    function spareScopeSpares(st) {
        const f = { partNo: '', description: '', spareFilter: 'total', showLowOnly: false };
        return (st.spares || []).map(canon).filter(s => matchSpare(s, st, f));
    }

    function spareDashboardCounts(st) {
        const scope = spareScopeSpares(st);
        let lowStock = 0;
        let legal = 0;
        scope.forEach(s => {
            if (TVC_Inventory.isLowStock(s)) lowStock++;
            if (spareClass(s) === 'L') legal++;
        });
        return { total: scope.length, lowStock, legal };
    }

    function renderSpareFilterDashboard() {
        const host = document.getElementById('spareFilterDashboard');
        if (!host) return;
        const st = getState();
        const m = modState(st);
        if (m.spareFilter === 'major') m.spareFilter = 'total';
        const c = spareDashboardCounts(st);
        const f = m.spareFilter || 'total';
        const items = [
            { key: 'lowStock', label: 'Low Stock', count: c.lowStock, cls: 'act-dash-overdue' },
            { key: 'legal', label: 'Legal Spare', count: c.legal, cls: 'act-dash-pending' },
        ];
        const btnHtml = items.map(b => `
            <button type="button" class="act-dash-btn ${b.cls}${f === b.key ? ' active' : ''}" data-sfilter="${b.key}"
                onclick="TVC_SpareMenu.setSpareFilter('${b.key}')">
                <span class="act-dash-count">${b.count}</span>
                <span class="act-dash-label">${esc(b.label)}</span>
            </button>`).join('');
        host.innerHTML = `
            <div class="act-filter-dashboard-inner">
                ${btnHtml}
                <span class="act-dash-sep" aria-hidden="true"></span>
                <button type="button" class="act-dash-btn act-dash-total${f === 'total' ? ' active' : ''}" data-sfilter="total"
                    onclick="TVC_SpareMenu.setSpareFilter('total')">
                    <span class="act-dash-count">${c.total}</span>
                    <span class="act-dash-label">Total</span>
                </button>
            </div>`;
        bindSpareDashLayoutSync(host);
        requestAnimationFrame(() => {
            syncSpareHeadLayout();
            requestAnimationFrame(syncSpareHeadLayout);
        });
    }

    function bindSpareDashLayoutSync(host) {
        if (!host || typeof ResizeObserver === 'undefined') return;
        if (_spareDashResizeObs) _spareDashResizeObs.disconnect();
        _spareDashResizeObs = new ResizeObserver(() => syncSpareHeadLayout());
        _spareDashResizeObs.observe(host);
    }

    function setSpareFilter(filter) {
        const st = getState();
        const m = modState(st);
        m.spareFilter = filter || 'total';
        m.showLowOnly = m.spareFilter === 'lowStock';
        renderSpareFilterDashboard();
        applySpareListFilter();
    }

    function spareActiveFilterLabel(m) {
        const f = m.spareFilter || (m.showLowOnly ? 'lowStock' : 'total');
        if (f === 'lowStock') return 'Low stock';
        if (f === 'legal') return 'Legal Spare';
        return '';
    }

    async function render() {
        const root = document.getElementById('spareMenuBody');
        if (!root) return;
        if (await ensureInventoryLoaded()) return render();
        const { st, isHq, vesselId } = await vesselScope();
        await syncReqLineMap();
        await syncReportedWaitMap(vesselId);
        spareInventoryUser(st);
        const m = modState(st);
        const allCanon = (st.spares || []).map(canon);
        _cachedList = filteredSpares(st);
        const canRequisition = window.TVC_RBAC && st.user && TVC_RBAC.can(st.user, TVC_RBAC.Action.CREATE_REQUISITION);
        const canModify = canModifySpare(st);
        const canConsume = window.TVC_RBAC && st.user && TVC_RBAC.can(st.user, TVC_RBAC.Action.DEDUCT_INVENTORY);
        const canDeliver = window.TVC_RBAC && st.user && TVC_RBAC.can(st.user, TVC_RBAC.Action.SUPPLY_PARTS);
        const canHqImport = window.TVC_RBAC && st.user && TVC_RBAC.can(st.user, TVC_RBAC.Action.IMPORT_HQ_SYNC);
        const needsImport = allCanon.length < 500;
        const fileMode = TVC_Env.isFileProtocol();
        const panelOpen = m.panelOpen && getFocusedSpareId(st);
        const tb = spareToolbarFlags(st);
        const prevTreeScroll = document.getElementById('spareGroupTree')?.scrollTop || 0;
        const sectionCard = (title, bodyHtml, className) =>
            (typeof TVC_App !== 'undefined' && TVC_App.renderSectionCard)
                ? TVC_App.renderSectionCard(title, bodyHtml, { className })
                : bodyHtml;

        const importBanners = `
          ${fileMode && needsImport ? `<div class="spare-import-banner file-mode">
            <strong>⚠ file:// mode</strong> — Auto Import unavailable. Click the <b>Select spare-inventory.xls</b> button below.
            (Recommended: <code>npm run serve</code> → <code>http://localhost:3000</code>)
          </div>` : ''}
          ${needsImport ? `<div class="spare-import-banner">
            <strong>⚠ ENGINE inventory not loaded</strong> — Currently ${allCanon.length} item(s) (demo data).
            ${canModify
                ? (fileMode
                    ? `<label class="btn btn-sm btn-green spare-file-pick" for="srInventoryImportFile">📂 Select spare-inventory.xls</label>`
                    : `<button type="button" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.loadBundledXls()">📥 Import XLS (ENGINE) — Recommended</button>
                       <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.triggerInventoryImport()">📂 Select file</button>`)
                : 'Import using Chief Engineer / Captain account.'}
            ${st._spareImportMsg ? `<span class="muted">${esc(st._spareImportMsg)}</span>` : ''}
          </div>` : (st._spareImportMsg ? `<div class="spare-import-banner ok">${esc(st._spareImportMsg)}</div>` : '')}`;

        const inventoryBody = `
          ${importBanners}
          <div class="plan-layout spare-layout${panelOpen ? ' panel-open' : ''}">
            <aside class="panel tree-panel">
              <div class="panel-head spare-tree-head">
                <span>🌳 SPARE GROUP Tree</span>
                ${renderSpareTreeActionBtns(st)}
              </div>
              <div class="tree-search-bar">
                <div class="search-field-wrap">
                  <input class="search-input" id="spareTreeSearch" placeholder="Search GROUP…" oninput="TVC_App.setTreeSearch(this.value)">
                  <button type="button" class="search-clear-btn hidden" title="Clear search" aria-label="Clear search" onclick="TVC_App.clearSearchField('spareTreeSearch')">×</button>
                </div>
              </div>
              <div class="panel-body tree-scroll" id="spareGroupTree"></div>
            </aside>
            <main class="panel spare-main">
              <div class="filter-bar orig-toolbar spare-item-toolbar">
                <button type="button" id="spareModifyBtn" class="btn btn-sm" onclick="TVC_App.openSpareModify()"${tb.modifyEnabled ? '' : ' disabled'} title="${esc(tb.modifyTitle)}">✏️ Modify</button>
                <button type="button" id="spareAppendBtn" class="btn btn-sm" onclick="TVC_App.openSpareAppend()"${tb.appendEnabled ? '' : ' disabled'} title="${esc(tb.appendTitle)}">➕ Append</button>
                <button type="button" id="spareDeleteBtn" class="btn btn-sm btn-red" onclick="TVC_App.deleteSpareItem()"${tb.deleteEnabled ? '' : ' disabled'} title="${esc(tb.deleteTitle)}">🗑 Delete</button>
                <span class="orig-toolbar-sep"></span>
                ${spareItemHistoryBtnHtml()}
                <span class="orig-toolbar-sep"></span>
                <button type="button" class="btn btn-sm btn-excel" onclick="TVC_SpareMenu.exportPartsListXlsx()" title="Export Excel (.xlsx)">
                    <span class="btn-excel-icon" aria-hidden="true">X</span> Export XLS
                </button>
                <div class="tab-toolbar-end">
                    <button type="button" class="btn btn-sm" onclick="TVC_App.printTabList('spare', false)">🖨 Print</button>
                    <button type="button" class="btn btn-sm" onclick="TVC_App.printTabList('spare', true)">👁 Preview</button>
                </div>
              </div>
              <div id="spareFilterDashboard" class="act-filter-dashboard"></div>
              <div class="filter-bar spare-list-search-bar">
                <div class="search-field-wrap">
                  <input type="text" class="search-input spare-list-search-input" id="spareSearch" placeholder="Search Code / Item / Part No / Work"
                      value="${esc(m.partNo || m.description ? [m.partNo, m.description].filter(Boolean).join(' ') : (st.spareSearch || ''))}"
                      oninput="TVC_SpareMenu.setSearch(this.value)">
                  <button type="button" class="search-clear-btn hidden" title="Clear search" aria-label="Clear search" onclick="TVC_SpareMenu.clearSpareSearch()">×</button>
                </div>
                <span class="count-label" id="spareCount">${_cachedList.length} / ${allCanon.length}</span>
              </div>
              <div id="spareEditBlock">${renderSpareEditBlockHtml(st)}</div>
              <div id="spareEditorWrap"></div>
              <div class="panel spare-list-panel">
                <div id="spareListHead" class="vl-head-wrap sheet-scroll-original"></div>
                <div id="spareListScroll" class="virtual-scroll sheet-scroll-original spare-vl-scroll"></div>
              </div>
              <div id="spareReqSection" class="spare-req-section${m.showReqPanel ? '' : ' hidden'}"></div>
            </main>
            <aside id="spareDetailPanel" class="spare-detail-panel${panelOpen ? ' open' : ''}">
              <div id="spareDetailInner" class="spare-detail-inner"></div>
            </aside>
          </div>`;

        root.innerHTML = `
        <div class="spare-unified">
          ${sectionCard('Spare Work Flow', renderSpicsMenuHtml({ canConsume, canDeliver, canRequisition, canHqImport, canModify, user: st.user, isHq }), 'tvc-section-spare-flow')}
          ${sectionCard('Spare Parts Inventory', inventoryBody, 'tvc-section-inventory')}
        </div>
        <input type="file" id="srImportFile" accept=".xlsx" class="hidden">
        <input type="file" id="srCsvUploadFile" accept=".csv" class="hidden">
        <input type="file" id="srInventoryImportFile" accept=".csv,.xls,.xlsx" class="hidden">
        <input type="file" id="spareHqImportFile" accept=".json" class="hidden">
        <input type="file" id="spareXferImportFile" accept=".json,.xlsx,.xls,.csv" class="hidden">`;

        renderSpareGroupTree();
        const treeScrollEl = document.getElementById('spareGroupTree');
        if (treeScrollEl && prevTreeScroll) treeScrollEl.scrollTop = prevTreeScroll;
        mountVirtualList();
        bindSpareListEvents();
        bindFileInputs();
        renderSpareFilterDashboard();
        syncSpareItemHistoryBtns();

        if (st._spareEdit && !st._spareEdit.id) renderEditor(st._spareEdit);
        if (panelOpen) await renderDetailPanel(getFocusedSpareId(st), canRequisition, canModify);
        if (window.TVC_App?.syncSpareItemToolbar) TVC_App.syncSpareItemToolbar();
        else syncSpareToolbarUi();
        TVC_App.bindSearchClearInput?.('spareSearch');
        TVC_App.bindSearchClearInput?.('spareTreeSearch');
        TVC_App.updateSearchClearBtn?.('spareSearch');
        TVC_App.updateSearchClearBtn?.('spareTreeSearch');
    }

    function refreshList() {
        syncReportedWaitMap().finally(() => {
            if (vl) vl.refresh();
            refreshSpareEditBlock();
            syncSpareToolbarUi();
            syncSpareItemHistoryBtns();
            updateSpareHeadCheckAll();
            if (modState(getState()).reqWorkOpen) refreshReqWorkListRows();
            requestAnimationFrame(syncSpareHeadLayout);
        });
    }

    function spareActionIds(kind) {
        const st = getState();
        const checked = getCheckedSpareIds(st);
        const focused = getFocusedSpareId(st);
        if (kind === 'modify') {
            if (checked.length === 1) return checked;
            if (!checked.length && focused) return [focused];
            return [];
        }
        if (checked.length) return checked;
        return focused ? [focused] : [];
    }

    function spareToolbarFlags(st) {
        spareInventoryUser(st);
        const editing = isInlineEditing(st);
        const canModify = canModifySpare(st);
        const modifyIds = spareActionIds('modify');
        const deleteIds = spareActionIds('delete');
        const checkedCount = getCheckedSpareIds(st).length;
        const permTip = 'Chief Engineer / Captain permission required';
        const pickTip = 'Click a row or select using the checkbox';
        const editingTip = 'Not available while editing';
        return {
            editing,
            canModify,
            modifyIds,
            deleteIds,
            modifyEnabled: canModify && !editing && modifyIds.length === 1,
            deleteEnabled: canModify && !editing && deleteIds.length >= 1,
            appendEnabled: canModify && !editing,
            modifyTitle: !canModify ? permTip : (editing ? editingTip : (checkedCount > 1 ? 'Modify allows only one selected item' : (modifyIds.length ? '' : pickTip))),
            deleteTitle: !canModify ? permTip : (editing ? editingTip : (deleteIds.length ? '' : pickTip)),
            appendTitle: !canModify ? permTip : (editing ? 'Cannot Append while editing' : 'Register new part'),
        };
    }

    function applySpareToolbarFlags(tb) {
        const setBtn = (id, on, title) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.disabled = !on;
            if (on) {
                el.removeAttribute('disabled');
                el.removeAttribute('aria-disabled');
            } else {
                el.setAttribute('disabled', 'disabled');
                el.setAttribute('aria-disabled', 'true');
            }
            el.title = title || '';
        };
        if (tb.editing) {
            setBtn('spareModifyBtn', false, tb.modifyTitle);
            setBtn('spareAppendBtn', false, tb.appendTitle);
            setBtn('spareDeleteBtn', false, tb.deleteTitle);
            setBtn('reqWorkModifyBtn', false, tb.modifyTitle);
            setBtn('reqWorkAppendBtn', false, tb.appendTitle);
            setBtn('reqWorkDeleteBtn', false, tb.deleteTitle);
            return;
        }
        setBtn('spareAppendBtn', tb.appendEnabled, tb.appendTitle);
        setBtn('spareModifyBtn', tb.modifyEnabled, tb.modifyTitle);
        setBtn('spareDeleteBtn', tb.deleteEnabled, tb.deleteTitle);
        const m = modState(getState());
        const listLocked = isReqWorkListViewLocked();
        if (isRequisitionListWindow(m)) {
            const hasDisplayedReq = reqWorkListHasDisplayedReq(m);
            setBtn('reqWorkHeadModifyBtn', hasDisplayedReq && !m.reqWorkListEditing, hasDisplayedReq ? 'Enable editing' : 'Select a requisition from the list first');
        }
        const lockTip = reqWorkListLockTip();
        if (listLocked) {
            setBtn('reqWorkModifyBtn', false, lockTip);
            setBtn('reqWorkAppendBtn', false, lockTip);
            setBtn('reqWorkDeleteBtn', false, lockTip);
        } else {
            setBtn('reqWorkAppendBtn', tb.appendEnabled, tb.appendTitle);
            setBtn('reqWorkModifyBtn', tb.modifyEnabled, tb.modifyTitle);
            setBtn('reqWorkDeleteBtn', tb.deleteEnabled, tb.deleteTitle);
        }
    }

    function syncSpareToolbarUi() {
        applySpareToolbarFlags(spareToolbarFlags(getState()));
    }

    function bindSpareListEvents() {
        /* 행 선택은 rowHtml inline onclick (Original Plan과 동일) */
    }

    function rowCellInput(id, value, extraClass = '') {
        const cls = ['spare-inline-input', extraClass].filter(Boolean).join(' ');
        return `<input class="${cls}" id="${id}" value="${esc(String(value ?? ''))}" onclick="event.stopPropagation()">`;
    }

    const SPARE_CLASS_OPTIONS = [
        { value: 'L', label: 'L : Legal spare parts' },
        { value: 'G', label: 'G : General spare parts' },
    ];
    function rowCellClassSelect(id, value, extraClass = '') {
        const cur = TVC_SpareSchema.normalizePartClass(value);
        const wrapId = `${id}_wrap`;
        const wrapCls = ['spare-class-pick', extraClass].filter(Boolean).join(' ');
        const items = SPARE_CLASS_OPTIONS.map(o => {
            const sel = o.value === cur ? ' selected' : '';
            return `<button type="button" class="spare-class-pick-item${sel}" data-class-value="${o.value}"
                onclick="TVC_SpareMenu.pickSpareClass('${id}','${o.value}')">${esc(o.label)}</button>`;
        }).join('');
        const display = cur || '—';
        return `<div class="${wrapCls}" id="${wrapId}">
            <input type="hidden" id="${id}" value="${escAttr(cur)}">
            <button type="button" class="spare-class-pick-trigger" onclick="TVC_SpareMenu.toggleSpareClassPick(event,'${wrapId}')">
                <span class="spare-class-pick-val">${esc(display)}</span>
                <span class="spare-class-pick-caret" aria-hidden="true">▾</span>
            </button>
            <div class="spare-class-pick-menu" role="listbox" aria-label="Class">${items}</div>
        </div>`;
    }

    function spareClassPickMenuEl(wrap) {
        return wrap?._spareClassMenu || wrap?.querySelector('.spare-class-pick-menu') || null;
    }

    function spareClassPickClickInside(wrap, target) {
        if (!wrap || !target) return false;
        const menu = spareClassPickMenuEl(wrap);
        return wrap.contains(target) || (menu && menu.contains(target));
    }

    function resetSpareClassPickMenu(wrap) {
        if (!wrap) return;
        const menu = spareClassPickMenuEl(wrap);
        if (!menu) return;
        menu.classList.remove('spare-class-pick-menu-portal');
        menu.style.display = '';
        menu.style.position = '';
        menu.style.left = '';
        menu.style.top = '';
        menu.style.minWidth = '';
        menu.style.zIndex = '';
        if (wrap._spareClassMenu && menu.parentNode === document.body) wrap.appendChild(menu);
    }

    function positionSpareClassPickMenu(wrap) {
        const trigger = wrap.querySelector('.spare-class-pick-trigger');
        let menu = wrap.querySelector('.spare-class-pick-menu');
        if (!trigger || !menu) return;
        if (!wrap._spareClassMenu) wrap._spareClassMenu = menu;
        if (menu.parentNode !== document.body) document.body.appendChild(menu);
        menu.classList.add('spare-class-pick-menu-portal');
        const r = trigger.getBoundingClientRect();
        menu.style.display = 'block';
        menu.style.position = 'fixed';
        menu.style.left = `${r.left}px`;
        menu.style.top = `${r.bottom + 2}px`;
        menu.style.minWidth = `${Math.max(200, r.width)}px`;
        menu.style.zIndex = '10050';
    }

    function closeSpareClassPick(wrap) {
        if (!wrap) return;
        resetSpareClassPickMenu(wrap);
        wrap.classList.remove('open');
    }

    function toggleSpareClassPick(ev, wrapId) {
        ev?.stopPropagation();
        const wrap = document.getElementById(wrapId);
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        document.querySelectorAll('.spare-class-pick.open').forEach(el => {
            if (el !== wrap) closeSpareClassPick(el);
        });
        if (!opening) {
            closeSpareClassPick(wrap);
            return;
        }
        wrap.classList.add('open');
        positionSpareClassPickMenu(wrap);
        const close = (e) => {
            if (!spareClassPickClickInside(wrap, e.target)) {
                closeSpareClassPick(wrap);
                document.removeEventListener('click', close);
                window.removeEventListener('scroll', onReposition, true);
                window.removeEventListener('resize', onReposition);
            }
        };
        const onReposition = () => {
            if (wrap.classList.contains('open')) positionSpareClassPickMenu(wrap);
        };
        setTimeout(() => {
            document.addEventListener('click', close);
            window.addEventListener('scroll', onReposition, true);
            window.addEventListener('resize', onReposition);
        }, 0);
    }

    function pickSpareClass(inputId, val) {
        const v = String(val || '').trim().toUpperCase();
        const hidden = document.getElementById(inputId);
        const wrap = document.getElementById(`${inputId}_wrap`);
        if (hidden) hidden.value = v;
        if (wrap) {
            const valEl = wrap.querySelector('.spare-class-pick-val');
            if (valEl) valEl.textContent = v || '—';
            wrap.querySelectorAll('.spare-class-pick-item').forEach(el => {
                el.classList.toggle('selected', el.dataset.classValue === v);
            });
            closeSpareClassPick(wrap);
        }
    }

    function rowHtml(s, focusedId, batchMap, ctx = 'main') {
        const low = TVC_Inventory.isLowStock(s);
        const sel = s.id === focusedId ? ' spare-row-focused row-selected' : '';
        const checked = ctx === 'reqWork'
            ? (reqWorkRowChecked(s) ? 'checked' : '')
            : ctx === 'consume'
                ? (consumeRowChecked(s) ? 'checked' : '')
                : ctx === 'receive'
                    ? (receiveRowChecked(s) ? 'checked' : '')
                : ctx === 'wrSpare'
                    ? (wrSpareRowChecked(s) ? 'checked' : '')
                    : (batchMap && batchMap[s.id] ? 'checked' : '');
        const sid = escAttr(s.id);
        const focusFn = ctx === 'reqWork' ? 'TVC_SpareMenu.reqWorkFocusRow'
            : ctx === 'consume' ? 'TVC_SpareMenu.consumeFocusRow'
                : ctx === 'receive' ? 'TVC_SpareMenu.receiveFocusRow'
                : ctx === 'wrSpare' ? 'TVC_SpareMenu.wrSpareFocusRow' : 'TVC_App.focusSpareRow';
        const focusClick = ctx === 'reqWork'
            ? `TVC_SpareMenu.reqWorkFocusRow('${sid}', true)`
            : ctx === 'receive'
                ? `TVC_SpareMenu.receiveFocusRow('${sid}', true)`
            : ctx === 'consume'
                ? `TVC_SpareMenu.consumeFocusRow('${sid}', true)`
            : `${focusFn}('${sid}')`;
        const toggleFn = ctx === 'reqWork' ? 'TVC_SpareMenu.reqWorkToggleRow'
            : ctx === 'consume' ? 'TVC_SpareMenu.consumeToggleRow'
                : ctx === 'receive' ? 'TVC_SpareMenu.receiveToggleRow'
                : ctx === 'wrSpare' ? 'TVC_SpareMenu.wrSpareToggleRow' : 'TVC_App.toggleSpareRow';
        const dblFn = `TVC_SpareMenu.openSpareItemHistory('${sid}')`;
        const dblAttr = (ctx === 'reqWork' || ctx === 'receive' || ctx === 'consume') ? '' : ` ondblclick="event.preventDefault();${dblFn}"`;
        const colgroup = ctx === 'reqWork' ? SPARE_REQ_COLGROUP
            : ctx === 'consume' ? SPARE_CONSUME_COLGROUP
                : ctx === 'receive' ? SPARE_RECEIVE_COLGROUP
                : ctx === 'wrSpare' ? SPARE_WR_COLGROUP : SPARE_MAIN_COLGROUP;
        const reqLine = ctx === 'reqWork' ? _reqLineBySpareId?.get(reqWorkSpareIdKey(s.id)) : null;
        const pipe = sparePipelineCols(s, reqLine);
        const stockCell = pipe.stock;
        const locked = ctx === 'reqWork' && reqWorkFormLocked();
        const rcvdEdit = ctx === 'reqWork' && reqWorkReceivedQtyEditable() && !locked;
        const wrRo = ctx === 'wrSpare' && modState(getState()).wrSpareReadonly;
        const consumeRo = ctx === 'consume' && modState(getState()).consumePreview;
        const pipelineCells = (ctx === 'main' || ctx === 'reqWork')
            ? `<td class="c-await">${pipe.awaiting}</td><td class="c-need">${formatNeedHtml(pipe.need)}</td>`
            : '';
        const reqCells = ctx === 'reqWork'
            ? `${pipelineCells}<td class="c-req">${rcvdEdit ? esc(String(pipe.request)) : reqWorkRequestCellHtml(s, sid, locked)}</td><td class="c-assess">${esc(pipe.assess)}</td><td class="c-rcvd">${rcvdEdit ? reqWorkReceivedCellHtml(s, sid) : esc(pipe.rcvd)}</td>`
            : (ctx === 'main' ? pipelineCells : '');
        const consumeCell = ctx === 'consume'
            ? `<td class="c-cons">${consumeQtyCellHtml(s, sid)}</td>`
            : '';
        const receiveCell = ctx === 'receive'
            ? `<td class="c-await">${pipe.awaiting}</td><td class="c-recv">${receiveQtyCellHtml(s, sid)}</td>`
            : '';
        const wrQtyCell = ctx === 'wrSpare'
            ? `<td class="c-cons">${wrQtyCellHtml(s, sid, wrRo)}</td>`
            : '';
        const tableCls = ctx === 'reqWork' ? 'spare-data-table spare-data-table-req spare-data-row'
            : ctx === 'consume' ? 'spare-data-table spare-data-table-consume spare-data-row'
                : ctx === 'receive' ? 'spare-data-table spare-data-table-receive spare-data-row'
                : ctx === 'wrSpare' ? 'spare-data-table spare-data-table-wrspare spare-data-row'
                    : 'spare-data-table spare-data-row';
        const itemName = String(s.name || '').trim();
        const pnoText = String(spareDrawingNo(s) || '').trim();
        const workText = String(spareWorking(s) || '').trim();
        return `<table class="${tableCls}" role="presentation" data-spare-id="${sid}"
            onclick="${focusClick}"${dblAttr}>${colgroup}<tbody><tr class="spare-row${low ? ' row-overdue' : ''}${sel}"
            tabindex="0" role="button" style="cursor:pointer">
            <td class="c-chk" onclick="event.stopPropagation()">
                <input type="checkbox" class="spare-row-chk" ${checked}${locked || wrRo || consumeRo ? ' disabled' : ''} aria-label="Select part"
                    onclick="event.stopPropagation()"
                    onchange="${toggleFn}('${sid}', this.checked)">
            </td>
            <td class="c-num"${cellTitleAttr(spareNumbering(s))}><strong>${esc(spareNumbering(s))}</strong></td>
            <td class="c-cls">${esc(spareClass(s))}</td>
            <td class="c-item"${cellTitleAttr(itemName)}>${esc(s.name)}</td>
            <td class="c-pno"${cellTitleAttr(pnoText)}>${esc(spareDrawingNo(s) || '—')}</td>
            <td class="c-unit">${esc(spareUnit(s))}</td>
            <td class="c-work"${cellTitleAttr(workText)}>${spareWorking(s)}</td>
            <td class="c-std">${spareStandardQty(s)}</td>
            <td class="c-stk">${stockCell}</td>${reqCells}${consumeCell}${receiveCell}${wrQtyCell}
        </tr></tbody></table>`;
    }

    let _reqWorkResizeObs = null;
    let _spareListResizeObs = null;
    let _spareDashResizeObs = null;
    let _consumeResizeObs = null;
    let _receiveResizeObs = null;

    function syncHeadLayout(scrollId, headId, trackId, minWidth) {
        const scroll = document.getElementById(scrollId);
        const head = document.getElementById(headId);
        const track = document.getElementById(trackId);
        const table = head?.querySelector('.spare-data-table');
        const inner = scroll?.querySelector('.vl-inner');
        if (!scroll || !head || !track || !table) return;
        const tableW = Math.max(scroll.clientWidth, minWidth);
        const sb = scroll.offsetWidth - scroll.clientWidth;
        if (inner) {
            inner.style.setProperty('width', `${tableW}px`, 'important');
            inner.style.setProperty('min-width', `${minWidth}px`, 'important');
        }
        scroll.style.setProperty('--spare-table-w', `${tableW}px`);
        head.style.paddingRight = sb > 0 ? `${sb}px` : '';
        track.style.width = `${scroll.clientWidth}px`;
        table.style.width = `${tableW}px`;
        table.style.minWidth = `${tableW}px`;
        table.style.maxWidth = `${tableW}px`;
        track.scrollLeft = scroll.scrollLeft;
    }

    function bindHeadTrackScroll(scroll, headId) {
        const head = document.getElementById(headId);
        const track = head?.querySelector('.spare-head-track');
        if (!track) return;
        if (track === scroll._tvcHeadTrackEl) return;
        if (scroll._tvcHeadTrackEl && scroll._tvcHeadTrackHandler) {
            scroll._tvcHeadTrackEl.removeEventListener('scroll', scroll._tvcHeadTrackHandler);
        }
        scroll._tvcHeadTrackEl = track;
        scroll._tvcHeadTrackHandler = () => {
            if (Math.abs(scroll.scrollLeft - track.scrollLeft) > 0.5) {
                scroll.scrollLeft = track.scrollLeft;
            }
        };
        track.addEventListener('scroll', scroll._tvcHeadTrackHandler, { passive: true });
    }

    function bindHeadLayoutSync(scroll, syncFn, obsKey) {
        if (!scroll) return;
        const headId = obsKey === 'reqWork' ? 'reqWorkListHead'
            : obsKey === 'consume' ? 'consumeListHead'
                : obsKey === 'receive' ? 'receiveListHead'
                : obsKey === 'wrSpare' ? 'wrSpareListHead'
                    : 'spareListHead';
        const run = () => {
            syncFn();
            if (obsKey !== 'reqWork' && obsKey !== 'consume' && obsKey !== 'receive') bindHeadTrackScroll(scroll, headId);
        };
        const prevScroll = scroll.onscroll;
        scroll.onscroll = () => {
            if (typeof prevScroll === 'function') prevScroll();
            run();
        };
        run();
        requestAnimationFrame(() => {
            run();
            requestAnimationFrame(run);
        });
        if (obsKey === 'spare') {
            if (_spareListResizeObs) _spareListResizeObs.disconnect();
            if (typeof ResizeObserver !== 'undefined') {
                _spareListResizeObs = new ResizeObserver(run);
                _spareListResizeObs.observe(scroll);
                const head = document.getElementById('spareListHead');
                if (head) _spareListResizeObs.observe(head);
            }
        } else if (obsKey === 'reqWork') {
            if (_reqWorkResizeObs) _reqWorkResizeObs.disconnect();
            if (typeof ResizeObserver !== 'undefined') {
                _reqWorkResizeObs = new ResizeObserver(run);
                _reqWorkResizeObs.observe(scroll);
                const hscroll = scroll.closest('.spare-req-table-hscroll');
                if (hscroll) _reqWorkResizeObs.observe(hscroll);
                const workScroll = scroll.closest('.spare-req-work-scroll');
                if (workScroll) _reqWorkResizeObs.observe(workScroll);
                const modalBox = scroll.closest('.modal-box');
                if (modalBox) _reqWorkResizeObs.observe(modalBox);
            }
        } else if (obsKey === 'consume') {
            if (_consumeResizeObs) _consumeResizeObs.disconnect();
            if (typeof ResizeObserver !== 'undefined') {
                _consumeResizeObs = new ResizeObserver(run);
                _consumeResizeObs.observe(scroll);
                const hscroll = scroll.closest('.spare-req-table-hscroll');
                if (hscroll) _consumeResizeObs.observe(hscroll);
                const head = document.getElementById('consumeListHead');
                if (head) _consumeResizeObs.observe(head);
            }
        } else if (obsKey === 'receive') {
            if (_receiveResizeObs) _receiveResizeObs.disconnect();
            if (typeof ResizeObserver !== 'undefined') {
                _receiveResizeObs = new ResizeObserver(run);
                _receiveResizeObs.observe(scroll);
                const head = document.getElementById('receiveListHead');
                if (head) _receiveResizeObs.observe(head);
                const modalBox = scroll.closest('.modal-box');
                if (modalBox) _receiveResizeObs.observe(modalBox);
            }
        } else if (obsKey === 'wrSpare') {
            if (_wrSpareResizeObs) _wrSpareResizeObs.disconnect();
            if (typeof ResizeObserver !== 'undefined') {
                _wrSpareResizeObs = new ResizeObserver(run);
                _wrSpareResizeObs.observe(scroll);
                const hscroll = scroll.closest('.spare-req-table-hscroll');
                if (hscroll) _wrSpareResizeObs.observe(hscroll);
                const head = document.getElementById('wrSpareListHead');
                if (head) _wrSpareResizeObs.observe(head);
            }
        }
        if (!window._tvcSpareHeadResizeBound) {
            window._tvcSpareHeadResizeBound = true;
            window.addEventListener('resize', () => {
                syncSpareHeadLayout();
                const m = modState(getState());
                if (m.reqWorkOpen) syncReqWorkHeadLayout();
                if (m.consumeOpen) syncConsumeHeadLayout();
                if (m.receiveOpen) syncReceiveHeadLayout();
                if (m.wrSpareOpen) syncWrSpareHeadLayout();
            });
        }
    }

    function syncSpareHeadLayout() {
        syncHeadLayout('spareListScroll', 'spareListHead', 'spareListHeadTrack', SPARE_MAIN_MIN_WIDTH);
    }

    function mountVirtualList() {
        const head = document.getElementById('spareListHead');
        if (head) {
            head.innerHTML = `<div id="spareListHeadTrack" class="spare-head-track"><table class="spare-data-table spare-data-head">
                ${SPARE_MAIN_COLGROUP}
                ${SPARE_MAIN_TABLE_HEAD}
            </table></div>`;
        }
        const scroll = document.getElementById('spareListScroll');
        if (!scroll) return;
        if (vl) vl.destroy();
        if (!_cachedList.length) {
            const st = getState();
            const gLabel = groupFilterLabel(st);
            const filterTag = spareActiveFilterLabel(modState(st));
            const filterLabel = [gLabel, filterTag].filter(Boolean).join(' · ');
            scroll.innerHTML = `<div class="spare-empty-list muted" style="padding:24px;text-align:center">
                No parts to display.${filterLabel ? ' (Filter: ' + esc(filterLabel) + ' — <a href="#" onclick="TVC_App.selectGroup(null);TVC_SpareMenu.clearListFilters();return false">View all</a>)' : ''}
                ${gLabel ? '<br><small>No parts assigned to this GROUP. Use ✏️ Modify or the detail panel to set <b>GROUP (PMS)</b>.</small>' : ''}
            </div>`;
            return;
        }
        vl = TVC_VirtualList.mount(scroll, {
            getCount: () => _cachedList.length,
            renderRow: (i) => {
                const s = _cachedList[i];
                const st = getState();
                const focusedId = getFocusedSpareId(st);
                const batchMap = st.spareListSelected || {};
                return s ? rowHtml(s, focusedId, batchMap) : '';
            },
        });
        if (head) bindHeadLayoutSync(scroll, syncSpareHeadLayout, 'spare');
        updateSpareHeadCheckAll();
        requestAnimationFrame(() => {
            syncSpareHeadLayout();
            requestAnimationFrame(syncSpareHeadLayout);
        });
    }

    async function renderDetailPanel(id, canRequisition, canModify) {
        const inner = document.getElementById('spareDetailInner');
        if (!inner) return;
        const st = getState();
        const s = (st.spares || []).map(canon).find(x => x.id === id);
        if (!s) { inner.innerHTML = '<p class="muted">Part not found</p>'; return; }

        const low = TVC_Inventory.isLowStock(s);
        const recQty = TVC_Inventory.recommendedOrderQty(s);
        const maint = await maintenanceHistory(id, st);

        const supplyRows = (s.history || []).slice().reverse().map(h => `<tr>
            <td>${esc((h.at || '').slice(0, 10))}</td>
            <td>${esc(h.type || '—')}</td>
            <td style="text-align:center">${h.qty ?? '—'}</td>
            <td style="text-align:right">${h.price != null ? esc(h.price) : '—'}</td>
            <td>${esc(h.vendorComment || h.note || '—')}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted" style="text-align:center">No supply history</td></tr>';

        const maintRows = maint.slice(0, 20).map(h => `<tr>
            <td>${esc((h.at || '').slice(0, 10))}</td>
            <td>${esc(h.jobCode)}</td>
            <td style="text-align:center">${h.qty ?? '—'}</td>
            <td>${esc(h.type)}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center">No maintenance history</td></tr>';

        inner.innerHTML = `
            <button class="spare-panel-close" onclick="TVC_SpareMenu.closeDetail()" title="Close">×</button>
            <h3 class="spare-panel-title">${esc(partNo(s))}</h3>
            <p class="spare-panel-sub">${esc(s.name)}</p>
            <div class="spare-panel-badges">
                ${s.isCritical ? '<span class="pill overdue">CRITICAL</span>' : ''}
                ${low ? '<span class="pill overdue">LOW STOCK</span>' : '<span class="pill ok">OK</span>'}
                ${s.partClass ? `<span class="pill">${esc(s.partClass)}</span>` : ''}
            </div>
            <div class="spare-panel-meta">
                <div><b>Universal Code</b><br>${esc(s.universalItemCode || s.universalCode || '—')}</div>
                <div><b>Stock</b><br>${s.currentStock ?? 0} <span class="muted">(prev ${s.previousStock ?? 0})</span></div>
                <div><b>Working</b><br>${spareWorking(s)}</div>
                <div><b>Standard</b><br>${TVC_Inventory.standardStock(s)}</div>
                <div><b>Min</b><br>${s.minStock ?? 0}</div>
                <div><b>GROUP (PMS)</b><br>${canModify
                    ? `<select id="spDetailGroup" class="spare-group-select" onchange="TVC_SpareMenu.saveDetailGroup('${s.id}')">${buildGroupSelectHtml(st, s.group)}</select>`
                    : esc(spareGroupLabel(s))}</div>
                <div><b>Location</b><br>${esc(s.location || '—')}</div>
                <div><b>Parent Equipment</b><br>${esc(s.parentEquipmentID || '—')}</div>
                <div><b>Price</b><br>${s.price != null ? esc(s.price) + ' ' + esc(s.currency || '') : '—'}</div>
                <div><b>Vendor</b><br>${esc(s.vendorComment || s.maker || '—')}</div>
            </div>
            <div class="spare-panel-actions">
                ${canRequisition ? `<button class="btn btn-sm btn-green" onclick="TVC_SpareMenu.createRequisition('${s.id}')">📝 Requisition</button>` : ''}
                <button class="btn btn-sm" onclick="TVC_SpareMenu.assignToTask('${s.id}')">🔧 Assign to Task</button>
                ${canModify ? `<button class="btn btn-sm" onclick="TVC_SpareMenu.edit('${s.id}')">✏️ Edit</button>` : ''}
            </div>
            <div class="spics-hist-head">Supply History</div>
            <div class="spare-panel-scroll"><table class="spics-hist-table">
                <thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Price</th><th>Comment</th></tr></thead>
                <tbody>${supplyRows}</tbody>
            </table></div>
            <div class="spics-hist-head">Maintenance / Task History</div>
            <div class="spare-panel-scroll"><table class="spics-hist-table">
                <thead><tr><th>Date</th><th>Job</th><th>Qty</th><th>Type</th></tr></thead>
                <tbody>${maintRows}</tbody>
            </table></div>
            ${low && canRequisition ? `<p class="muted spare-rec-hint">Recommended order qty: <strong>${recQty}</strong></p>` : ''}`;
    }

    function reqListTotalData(req) {
        return (req.lines || []).reduce((sum, l) => sum + (Number(l.qty_requested) || 0), 0);
    }

    function reqLineTargetQty(line) {
        if (!line) return 0;
        return line.qty_approved != null ? (Number(line.qty_approved) || 0) : (Number(line.qty_requested) || 0);
    }

    /** Line has outstanding qty (Req − Rcvd) — same basis as Wait. */
    function reqLineIsOutstanding(line) {
        return reqLinePendingQty(line) > 0;
    }

    /** Raw O/S before waive — Req − Rcvd sum. */
    function reqRawOutstandingData(req) {
        const effective = reqEffectiveForWait(req);
        return (effective.lines || []).reduce((sum, l) => sum + reqLinePendingQty(l), 0);
    }

    function reqOsWaived(req) {
        return !!(req?.os_waived_approved_at);
    }

    function reqOsWaiveInitiated(req) {
        return !!(String(req?.os_waive_reason || '').trim());
    }

    function reqCanCloseOs(req) {
        if (!req || reqOsWaived(req)) return false;
        if (reqWorkflowPhase(req) !== REQ_LIST_PHASE.RECEIVED) return false;
        return reqRawOutstandingData(req) > 0;
    }

    function closeOsApprovalState(req, st) {
        st = st || getState();
        const user = spareInventoryUser(st);
        const dept = req?.department || st?.department;
        const isConfirmed = !!(req?.os_waived_confirmed_at || req?.os_waived_confirmed_by);
        const isApproved = reqOsWaived(req);
        const initiated = reqOsWaiveInitiated(req);
        const canConfirmNow = initiated && !isConfirmed && !isApproved
            && !!user && TVC_RBAC.canConfirmDepartment(user, dept);
        const canApproveNow = isConfirmed && !isApproved
            && !!user && TVC_RBAC.canApproveHqReport(user);
        return {
            isConfirmed,
            isApproved,
            canConfirmNow,
            canApproveNow,
            confirmedByVal: isConfirmed ? (req.os_waived_confirmed_by || requisitionConfirmByLabel(st, req)) : '',
            approvedByVal: isApproved ? 'Company' : '',
        };
    }

    function reqCloseOsButtonEnabled(req, st) {
        if (!req || reqOsWaived(req)) return false;
        if (reqCanCloseOs(req)) return true;
        if (reqOsWaiveInitiated(req)) {
            const approval = closeOsApprovalState(req, st);
            return approval.canConfirmNow || approval.canApproveNow;
        }
        return false;
    }

    function resolveCloseOsTargetReq(allReqs, m, st) {
        st = st || getState();
        if (isRequisitionListWindow(m) && _reqWorkDraft?.id && reqWorkListHasDisplayedReq(m)
            && reqCloseOsButtonEnabled(_reqWorkDraft, st)) {
            return allReqs.find(r => r.id === _reqWorkDraft.id) || _reqWorkDraft;
        }
        if (m.selectedReqId) {
            const req = allReqs.find(r => r.id === m.selectedReqId);
            if (reqCloseOsButtonEnabled(req, st)) return req;
        }
        const checkedIds = Object.keys(m.reqListCheckedIds || {}).filter(k => m.reqListCheckedIds[k]);
        const eligible = checkedIds
            .map(id => allReqs.find(r => r.id === id))
            .filter(r => reqCloseOsButtonEnabled(r, st));
        if (eligible.length === 1) return eligible[0];
        if (eligible.length > 1 && m.selectedReqId) {
            const sel = eligible.find(r => r.id === m.selectedReqId);
            if (sel) return sel;
        }
        return eligible[0] || null;
    }

    function reqListAnyCloseOsEnabled(m, allReqs, st) {
        return !!resolveCloseOsTargetReq(allReqs, m, st);
    }

    /** Requisition List O/S — total unreceived qty (sum of Wait per line); 0 when O/S waived. */
    function reqListOutstandingData(req) {
        if (reqOsWaived(req)) return 0;
        return reqRawOutstandingData(req);
    }

    function reqListDateCell(val) {
        return esc(val || '—');
    }

    function reqListReceivedDate(req) {
        return req.received_on || req.received_date || '';
    }

    function reqListReceivedPort(req) {
        return String(req.received_port || '').trim();
    }

    function reqListTypeKind(req) {
        if (req?.dock_use) return 'DOCK';
        if (String(req?.priority || '').toUpperCase() === 'URGENT') return 'URGENT';
        return 'ROUTINE';
    }

    function reqListTypeLabel(req) {
        const k = reqListTypeKind(req);
        if (k === 'URGENT') return 'Urgent';
        if (k === 'DOCK') return 'Dock Use';
        return 'Routine';
    }

    function reqListTypeCellClass(req) {
        const k = reqListTypeKind(req);
        if (k === 'URGENT') return 'rl-type-urgent';
        if (k === 'DOCK') return 'rl-type-dock';
        return 'rl-type-routine';
    }

    function reqApplyTypeKind(req, kind) {
        const k = String(kind || 'ROUTINE').toUpperCase();
        if (k === 'DOCK') {
            req.dock_use = true;
            req.priority = 'ROUTINE';
        } else if (k === 'URGENT') {
            req.dock_use = false;
            req.priority = 'URGENT';
        } else {
            req.dock_use = false;
            req.priority = 'ROUTINE';
        }
    }

    function reqListReportedDate(req) {
        return req.made_on || req.reported_on || '';
    }

    function reqListStatusLabel(req) {
        return spareListStatus(req) || SPARE_LIST_STATUS.DRAFT;
    }

    function reqListDateInPeriod(dateStr, from, to) {
        if (!from && !to) return true;
        const d = String(dateStr || '').slice(0, 10);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    }

    function reqListMatchSearch(req, q) {
        if (!q) return true;
        const hay = [
            req.req_no, req.deliver_port, reqListReportedDate(req), req.assessed_on,
            reqListReceivedDate(req), reqListReceivedPort(req), reqListStatusLabel(req), req.made_by, req.assessed_by,
        ].join(' ').toLowerCase();
        return hay.includes(q);
    }

    function filterReqList(reqs, st) {
        const m = modState(st);
        const from = m.reqListPeriodFrom || '';
        const to = m.reqListPeriodTo || '';
        const q = String(m.reqListSearch || '').trim().toLowerCase();
        const phase = m.reqListPhaseTab || REQ_LIST_PHASE.ALL;
        return (reqs || []).filter(req =>
            reqListDateInPeriod(reqListReportedDate(req), from, to)
            && reqListMatchSearch(req, q)
            && reqListMatchesPhase(req, phase));
    }

    function reqListFilterBase(reqs, st) {
        const m = modState(st);
        const from = m.reqListPeriodFrom || '';
        const to = m.reqListPeriodTo || '';
        const q = String(m.reqListSearch || '').trim().toLowerCase();
        return (reqs || []).filter(req =>
            reqListDateInPeriod(reqListReportedDate(req), from, to)
            && reqListMatchSearch(req, q));
    }

    function reqListPhaseCounts(allReqs, st) {
        const filtered = reqListFilterBase(allReqs, st);
        const counts = { all: filtered.length };
        Object.values(REQ_LIST_PHASE).forEach(p => { if (p !== REQ_LIST_PHASE.ALL) counts[p] = 0; });
        filtered.forEach(req => {
            const p = reqWorkflowPhase(req);
            counts[p] = (counts[p] || 0) + 1;
        });
        return counts;
    }

    function reqListPhaseTabsHtml(m, counts) {
        const tabs = [
            [REQ_LIST_PHASE.ALL, 'All'],
            [REQ_LIST_PHASE.DRAFT, 'Draft'],
            [REQ_LIST_PHASE.REPORTED, 'Reported'],
            [REQ_LIST_PHASE.CONFIRMED, 'Confirmed'],
            [REQ_LIST_PHASE.SUBMITTED, 'Submitted'],
            [REQ_LIST_PHASE.ASSESSED, 'Evaluated'],
            [REQ_LIST_PHASE.RECEIVED, 'Received'],
        ];
        const cur = m.reqListPhaseTab || REQ_LIST_PHASE.ALL;
        return `<div class="req-list-phase-tabs" role="tablist" aria-label="Requisition phase">
            ${tabs.map(([id, label]) => {
                const n = counts[id] ?? 0;
                const active = cur === id ? ' active' : '';
                return `<button type="button" class="req-phase-tab${active}" role="tab" aria-selected="${cur === id ? 'true' : 'false'}"
                    onclick="TVC_SpareMenu.reqListSetPhase('${id}')">${esc(label)}${n ? `<span class="req-phase-count">${n}</span>` : ''}</button>`;
            }).join('')}
        </div>`;
    }

    function reqListSetPhase(phase) {
        const st = getState();
        const p = phase === 'exported' ? REQ_LIST_PHASE.SUBMITTED : (phase || REQ_LIST_PHASE.ALL);
        modState(st).reqListPhaseTab = p;
        renderReqListModal();
    }

    function reqListRequiredDateCell(req) {
        const from = String(req.deliver_date_from || '').slice(0, 10);
        const to = String(req.deliver_date_to || '').slice(0, 10);
        if (from && to) return esc(`${from} ~ ${to}`);
        if (from) return esc(from);
        if (to) return esc(to);
        return '—';
    }

    function canConfirmRequisition(st, req) {
        if (!req || reqListStatusLabel(req) !== SPARE_LIST_STATUS.REPORTED) return false;
        const user = spareInventoryUser(st);
        if (!user) return false;
        const dept = req.department || st.department;
        if (window.TVC_RBAC?.isHqAccount?.(user)) {
            return TVC_RBAC.can(user, TVC_RBAC.Action.CONFIRM_REPORT);
        }
        return TVC_RBAC.canConfirmDepartment(user, dept);
    }

    function requisitionConfirmByLabel(st, req) {
        const user = spareInventoryUser(st);
        const dept = req?.department || st?.department;
        if (window.TVC_RBAC?.isHqAccount?.(user)) return 'Superintendent';
        return TVC_RBAC.getDepartmentConfirmLabel(dept) || TVC_RBAC.getRankLabel(user);
    }

    function reqListCanConfirm(st, req) {
        return canConfirmRequisition(st, req);
    }

    function reqListCheckedConfirmableIds(m, allReqs, st) {
        const map = m.reqListCheckedIds || {};
        return Object.keys(map).filter(id => {
            if (!map[id]) return false;
            const req = allReqs.find(r => r.id === id);
            return reqListCanConfirm(st, req);
        });
    }

    function reqListAnyCheckedCanConfirm(m, allReqs, st) {
        return reqListCheckedConfirmableIds(m, allReqs, st).length > 0;
    }

    function reqListAnyChecked(m) {
        return Object.keys(m.reqListCheckedIds || {}).some(k => m.reqListCheckedIds[k]);
    }

    function reqListCanDeleteSelection(m, st) {
        if (!canCreateRequisition(st)) return false;
        return reqListAnyChecked(m) || !!m.selectedReqId;
    }

    function syncReqListFilterUi(st) {
        const m = modState(st);
        const fromEl = document.getElementById('reqListPeriodFrom');
        const toEl = document.getElementById('reqListPeriodTo');
        const searchEl = document.getElementById('reqListSearch');
        const filterEl = document.getElementById('reqListPeriodFilter');
        if (fromEl) fromEl.value = m.reqListPeriodFrom || '';
        if (toEl) toEl.value = m.reqListPeriodTo || '';
        if (searchEl) searchEl.value = m.reqListSearch || '';
        if (filterEl) filterEl.classList.toggle('active', !!(m.reqListPeriodFrom || m.reqListPeriodTo));
    }

    function reqListSetPeriod() {
        const st = getState();
        const m = modState(st);
        m.reqListPeriodFrom = document.getElementById('reqListPeriodFrom')?.value || '';
        m.reqListPeriodTo = document.getElementById('reqListPeriodTo')?.value || '';
        renderReqListModal();
    }

    function reqListClearPeriod() {
        const st = getState();
        const m = modState(st);
        m.reqListPeriodFrom = '';
        m.reqListPeriodTo = '';
        renderReqListModal();
    }

    function reqListSetSearch(v) {
        modState(getState()).reqListSearch = v;
        clearTimeout(_reqListSearchT);
        _reqListSearchT = setTimeout(() => renderReqListModal(), 150);
    }

    function reqListClearSearch() {
        modState(getState()).reqListSearch = '';
        const el = document.getElementById('reqListSearch');
        if (el) el.value = '';
        renderReqListModal();
    }

    let _reqListSearchT = null;

    function spareListToolbarBtn(label, onclick, disabled = false, cls = '') {
        return `<button type="button" class="btn btn-sm${cls ? ' ' + cls : ''}" onclick="${onclick}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
    }

    function spareListPrintStyles() {
        return `body{font-family:system-ui,sans-serif;font-size:11px;margin:16px;color:#1a202c}
            h1{font-size:18px;color:#1a365d;margin:0 0 4px}
            .meta{color:#4a5568;margin:0 0 12px;font-size:11px}
            table{width:100%;border-collapse:collapse}
            th,td{border:1px solid #cbd5e0;padding:5px 7px;text-align:left;vertical-align:top}
            th{background:#1a365d;color:#fff;font-weight:600;text-align:center}
            td.num{text-align:center;font-variant-numeric:tabular-nums}
            tr:nth-child(even){background:#f7fafc}
            @media print{body{margin:10mm}}`;
    }

    async function spareListPrintMeta(title) {
        const { st, vesselId } = await vesselScope();
        const ship = await vesselLabel(vesselId, st.department)
            || document.getElementById('cmaxsShipName')?.textContent?.trim() || '—';
        const dept = TVC_RBAC.getDeptLabel(st.department);
        return `<h1>${esc(title)}</h1><p class="meta">${esc(ship)} · ${esc(dept)} · ${new Date().toLocaleString()}</p>`;
    }

    function spareListPrintFilterNote(parts) {
        const notes = parts.filter(Boolean);
        return notes.length ? `<p class="meta">${notes.map(n => esc(n)).join(' · ')}</p>` : '';
    }

    function openSpareListPrintWindow(title, bodyHtml, preview) {
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TVC — ${esc(title)}</title>
            <style>${spareListPrintStyles()}</style></head><body>${bodyHtml}</body></html>`;
        const w = window.open('', '_blank');
        if (!w) {
            alert('Pop-up blocked. Allow pop-ups to print or preview.');
            return;
        }
        w.document.write(html);
        w.document.close();
        w.focus();
        if (!preview) setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
    }

    async function buildConsumedLogListPrintBody() {
        const { st, vesselId } = await vesselScope();
        const m = modState(st);
        const allLogs = await TVC_Inventory.listConsumeLogs(vesselId);
        const logs = filterConsumeLogs(allLogs, st);
        const filterParts = [];
        if (m.consumeLogSearch) filterParts.push(`Search: "${m.consumeLogSearch}"`);
        if (m.consumeLogPeriodFrom || m.consumeLogPeriodTo) {
            filterParts.push(`Period: ${m.consumeLogPeriodFrom || '…'} ~ ${m.consumeLogPeriodTo || '…'}`);
        }
        const head = `<tr>
            <th>Job Code</th><th>SORT-1</th><th>SORT-2</th><th>JOB DETAIL</th>
            <th>Reported Date</th><th>Status</th><th>Total Data</th>
        </tr>`;
        const rows = logs.map(log => {
            const reported = log.made_on || log.consumed_date || '';
            return `<tr>
                <td>${esc(log.job_code || '—')}</td>
                <td>${esc(log.sort1 || '—')}</td>
                <td>${esc(log.sort2 || '—')}</td>
                <td>${esc(log.job_detail || '—')}</td>
                <td class="num">${esc(reported || '—')}</td>
                <td class="num">${esc(consumeLogStatusLabel(log))}</td>
                <td class="num">${consumeLogTotalData(log)}</td>
            </tr>`;
        }).join('');
        const meta = await spareListPrintMeta('Consumed Log');
        return `${meta}
            ${spareListPrintFilterNote(filterParts)}
            <p class="meta">${logs.length} item(s)</p>
            <table>${head}${rows || `<tr><td colspan="7">No consumed logs to print.</td></tr>`}</table>`;
    }

    async function buildRequisitionListPrintBody() {
        const { st, vesselId } = await vesselScope();
        const m = modState(st);
        const allReqs = await TVC_Inventory.listRequisitions(vesselId);
        const reqs = filterReqList(allReqs, st);
        const filterParts = [];
        if (m.reqListSearch) filterParts.push(`Search: "${m.reqListSearch}"`);
        if (m.reqListPeriodFrom || m.reqListPeriodTo) {
            filterParts.push(`Period: ${m.reqListPeriodFrom || '…'} ~ ${m.reqListPeriodTo || '…'}`);
        }
        if (m.reqListPhaseTab && m.reqListPhaseTab !== REQ_LIST_PHASE.ALL) {
            filterParts.push(`Phase: ${m.reqListPhaseTab}`);
        }
        const head = `<tr>
            <th rowspan="2">Type</th>
            <th rowspan="2">Requisition No.</th>
            <th colspan="2">Required</th>
            <th rowspan="2">Reported Date</th>
            <th rowspan="2">Status</th>
            <th colspan="2">Received</th>
            <th rowspan="2">O/S</th>
            <th rowspan="2">Total Data</th>
        </tr>
        <tr><th>Date</th><th>Port</th><th>Date</th><th>Port</th></tr>`;
        const rows = reqs.map(r => {
            const reported = reqListReportedDate(r);
            const received = reqListReceivedDate(r);
            const recvPort = reqListReceivedPort(r);
            return `<tr>
                <td>${esc(reqListTypeLabel(r))}</td>
                <td>${esc(r.req_no || '—')}</td>
                <td class="num">${reqListRequiredDateCell(r)}</td>
                <td>${esc(r.deliver_port || '—')}</td>
                <td class="num">${reqListDateCell(reported)}</td>
                <td>${esc(reqListWorkflowLabel(r))}</td>
                <td class="num">${reqListDateCell(received)}</td>
                <td>${esc(recvPort || '—')}</td>
                <td class="num">${reqListOutstandingData(r)}</td>
                <td class="num">${reqListTotalData(r)}</td>
            </tr>`;
        }).join('');
        const meta = await spareListPrintMeta('Requisition List');
        return `${meta}
            ${spareListPrintFilterNote(filterParts)}
            <p class="meta">${reqs.length} item(s)</p>
            <table>${head}${rows || `<tr><td colspan="10">No requisitions to print.</td></tr>`}</table>`;
    }

    function clearReqListUiState(m) {
        m.reqListCheckedIds = {};
        m.selectedReqId = null;
    }

    function applyReqListSelection(m, id) {
        m.selectedReqId = id || null;
        if (id) ensureReqListChecked(m)[id] = true;
    }

    function ensureReqListChecked(m) {
        if (!m.reqListCheckedIds) m.reqListCheckedIds = {};
        return m.reqListCheckedIds;
    }

    function reqListIsRowChecked(m, id) {
        return !!m.reqListCheckedIds?.[id];
    }

    function updateReqListHeadCheckAll(reqs) {
        const scopeReqs = _reqListXferExportKind
            ? (reqs || []).filter(r => reqListCanXferExport(r))
            : (reqs || []);
        document.querySelectorAll('.spare-req-list-head-chk').forEach(el => {
            if (!scopeReqs.length) {
                el.checked = false;
                el.indeterminate = false;
                return;
            }
            const m = modState(getState());
            let n = 0;
            scopeReqs.forEach(r => { if (reqListIsRowChecked(m, r.id)) n++; });
            el.checked = n === scopeReqs.length;
            el.indeterminate = n > 0 && n < scopeReqs.length;
        });
    }

    async function refreshReqListUi() {
        const modal = document.getElementById('spareReqListModal');
        if (modal && !modal.classList.contains('hidden')) await renderReqListModal();
        if (_reqWorkHistOpen) await refreshReqWorkHistList();
    }

    function syncReqListRowSelection(root) {
        const scope = root || document;
        const selId = modState(getState()).selectedReqId;
        scope.querySelectorAll('.spare-req-list-body-table tbody tr[data-req-id]').forEach(tr => {
            tr.classList.toggle('sr-req-sel', tr.getAttribute('data-req-id') === selId);
        });
    }

    function setSpareListToolbarBtnDisabled(scope, onclickNeedle, disabled) {
        if (!scope) return;
        scope.querySelectorAll(`button[onclick*="${onclickNeedle}"]`).forEach(btn => {
            btn.disabled = !!disabled;
        });
    }

    async function syncReqListModalToolbar() {
        const body = document.getElementById('spareReqListBody');
        if (!body) return;
        const { st, vesselId } = await vesselScope();
        const m = modState(st);
        const allReqs = await TVC_Inventory.listRequisitions(vesselId);
        if (_reqListXferExportKind) {
            const ids = reqListCheckedExportableIds(m, allReqs);
            setSpareListToolbarBtnDisabled(body, 'reqListExportToMaster', !ids.length);
            return;
        }
        const selReq = m.selectedReqId ? allReqs.find(r => r.id === m.selectedReqId) : null;
        const hasSel = !!selReq;
        const canRequisition = canCreateRequisition(st);
        const canConfirm = reqListAnyCheckedCanConfirm(m, allReqs, st);
        const canDelete = reqListCanDeleteSelection(m, st);
        const canCloseOs = reqListAnyCloseOsEnabled(m, allReqs, st);
        setSpareListToolbarBtnDisabled(body, 'reqListDetailReport', !hasSel);
        setSpareListToolbarBtnDisabled(body, 'reqListReportConfirm', !canConfirm);
        setSpareListToolbarBtnDisabled(body, 'openCloseOsModal', !canCloseOs);
        setSpareListToolbarBtnDisabled(body, 'reqListModify', !canRequisition || !hasSel);
        setSpareListToolbarBtnDisabled(body, 'reqListDelete', !canDelete);
    }

    async function syncReqHistPopoverToolbar() {
        const panel = document.getElementById('reqWorkHistPanel');
        if (!panel || panel.classList.contains('hidden')) return;
        const m = modState(getState());
        if (!isRequisitionListWindow(m)) return;
        const { st, vesselId } = await vesselScope();
        const reqs = await TVC_Inventory.listRequisitions(vesselId);
        const selReq = m.selectedReqId ? reqs.find(r => r.id === m.selectedReqId) : null;
        const hasSel = !!selReq;
        const canRequisition = canCreateRequisition(st);
        const canConfirm = reqListAnyCheckedCanConfirm(m, reqs, st);
        const canDelete = reqListCanDeleteSelection(m, st);
        const canCloseOs = reqListAnyCloseOsEnabled(m, reqs, st);
        setSpareListToolbarBtnDisabled(panel, 'reqListReportConfirm', !canConfirm);
        setSpareListToolbarBtnDisabled(panel, 'openCloseOsModal', !canCloseOs);
        setSpareListToolbarBtnDisabled(panel, 'reqListDelete', !canDelete);
    }

    function applyReqWorkMetaFromSession(req) {
        if (!req) return;
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val ?? '';
        };
        setVal('reqWorkReqNo', req.req_no || '');
        setVal('reqWorkDelFrom', fmtSpareDate(req.deliver_date_from || ''));
        setVal('reqWorkDelTo', fmtSpareDate(req.deliver_date_to || ''));
        setVal('reqWorkDelPort', req.deliver_port || '');
        setVal('reqWorkMadeOn', fmtSpareDate(req.made_on || ''));
        setVal('reqWorkAssessedOn', fmtSpareDate(req.assessed_on || ''));
        setVal('reqWorkAssessedBy', req.assessed_by || '');
        const reqType = reqListTypeKind(req);
        document.querySelectorAll('input[name="reqWorkPriority"]').forEach(radio => {
            radio.checked = radio.value === reqType;
        });
    }

    function syncReqWorkApprovalSection(req) {
        const meta = document.querySelector('#spareReqWorkBody .spare-req-work-meta');
        if (!meta || !req || !isRequisitionListWindow(modState(getState()))) return;
        const st = getState();
        const m = modState(st);
        const html = renderSpareApprovalSection(req, {
            prefix: 'reqWork',
            department: req.department || st.department,
            listMode: true,
            listEditing: m.reqWorkListEditing,
        });
        const existing = meta.querySelector('.wr-maint-approval')?.closest('section');
        if (existing) existing.outerHTML = html;
        else meta.insertAdjacentHTML('afterbegin', html);
    }

    function syncReqWorkListWindowHeadButtons() {
        const m = modState(getState());
        if (!isRequisitionListWindow(m)) return;
        const head = document.querySelector('#spareReqWorkBody .spare-req-work-head');
        if (!head) return;
        const hasDisplayedReq = reqWorkListHasDisplayedReq(m);
        const listViewLocked = !m.reqWorkListEditing;
        const completeDone = !!m.reqWorkCompleted;
        const saveDisabled = completeDone || listViewLocked;
        const modifyBtn = document.getElementById('reqWorkHeadModifyBtn');
        const newBtn = document.getElementById('reqWorkHeadNewBtn');
        const saveBtn = document.getElementById('reqWorkSaveBtn');
        if (modifyBtn) modifyBtn.disabled = !hasDisplayedReq || m.reqWorkListEditing;
        if (newBtn) newBtn.disabled = m.reqWorkListEditing || !canCreateRequisition(getState());
        if (saveBtn) saveBtn.disabled = saveDisabled;
        setSpareListToolbarBtnDisabled(head, 'reqWorkPrint', !hasDisplayedReq);
        setSpareListToolbarBtnDisabled(head, 'reqWorkDocPreview', !hasDisplayedReq);
        const closeOsBtn = document.getElementById('reqWorkHeadCloseOsBtn');
        if (closeOsBtn) {
            const req = _reqWorkDraft;
            closeOsBtn.disabled = !(hasDisplayedReq && reqCloseOsButtonEnabled(req, getState()));
        }
    }

    async function reqListSelectRow(id) {
        const m = modState(getState());
        // 행 클릭은 하이라이트(선택)만 — 체크는 ㅁ를 직접 눌러야 함
        m.selectedReqId = id;
        syncReqListRowSelection(document.getElementById('spareReqListBody'));
        await syncReqListModalToolbar();
    }

    async function reqListToggleRow(id, checked) {
        const m = modState(getState());
        const map = ensureReqListChecked(m);
        if (checked) {
            map[id] = true;
            m.selectedReqId = id;
        } else {
            delete map[id];
            if (m.selectedReqId === id) m.selectedReqId = null;
        }
        const modal = document.getElementById('spareReqListModal');
        if (modal && !modal.classList.contains('hidden')) {
            const { vesselId } = await vesselScope();
            const reqs = filterReqList(await TVC_Inventory.listRequisitions(vesselId), getState());
            updateReqListHeadCheckAll(reqs);
            await syncReqListModalToolbar();
            return;
        }
        await refreshReqListUi();
    }

    async function reqListToggleAll(checked) {
        const m = modState(getState());
        const { vesselId } = await vesselScope();
        const allReqs = await TVC_Inventory.listRequisitions(vesselId);
        const reqs = filterReqList(allReqs, getState());
        if (checked) {
            const map = ensureReqListChecked(m);
            reqs.forEach(r => {
                if (!_reqListXferExportKind || reqListCanXferExport(r)) map[r.id] = true;
            });
            if (!m.selectedReqId && reqs.length) m.selectedReqId = reqs[0].id;
        } else {
            m.reqListCheckedIds = {};
            m.selectedReqId = null;
        }
        await refreshReqListUi();
    }

    async function loadRequisitionIntoListWindow(reqId, opts = {}) {
        const req = await TVC_Inventory.getRequisition(reqId);
        if (!req) {
            alert('Requisition not found.');
            return false;
        }
        _reqWorkDraft = {
            ...req,
            lines: (req.lines || []).map(l => ({ ...l })),
        };
        _reqSheet.reqId = req.id;
        const st = getState();
        const m = modState(st);
        applyReqListSelection(m, req.id);
        m.reqWorkListEditing = false;
        m.reqWorkShowSelectedOnly = true;
        m.reqWorkLastSavedId = req.id;
        st.selectedGroupKey = null;
        st.treeSearch = '';
        clearReqWorkSearch(st);
        await syncReqLineMap();
        syncRequisitionDraftFromLines();
        syncReqWorkHeaderFocusFromLines(st);
        const preserveHist = opts.preserveHistPopover !== false
            && _reqWorkHistOpen
            && isRequisitionListWindow(m);
        if (preserveHist) {
            const histScroll = document.getElementById('reqWorkHistListScroll');
            const histScrollTop = histScroll?.scrollTop ?? 0;
            applyReqWorkMetaFromSession(req);
            syncReqWorkApprovalSection(req);
            updateReqWorkHeadStats();
            syncReqWorkListWindowHeadButtons();
            refreshReqWorkListUi();
            syncReqListRowSelection(document.getElementById('reqWorkHistPanel'));
            await syncReqHistPopoverToolbar();
            applyReqWorkScrollLock(document.getElementById('spareReqWorkBody'));
            if (histScroll) histScroll.scrollTop = histScrollTop;
            return true;
        }
        await renderReqWorkModal();
        return true;
    }

    async function clearRequisitionListWindowSelection() {
        const st = getState();
        const m = modState(st);
        _reqWorkDraft = await buildBlankRequisitionDraft();
        _reqSheet.reqId = null;
        m.selectedReqId = null;
        m.reqWorkFocusedId = null;
        m.reqWorkListEditing = false;
        m.reqWorkShowSelectedOnly = true;
        m.reqWorkLastSavedId = null;
        st.requisitionDraft = [];
        clearReqListWindowAuditMeta(_reqWorkDraft);
        await syncReqLineMap();
        await renderReqWorkModal();
    }

    async function reqListPickRow(id, reqNo) {
        const m = modState(getState());
        m.selectedReqId = id;
        if (isRequisitionListWindow(m)) {
            await loadRequisitionIntoListWindow(id, { preserveHistPopover: true });
            return;
        }
        const histScroll = document.getElementById('reqWorkHistListScroll');
        const histScrollTop = histScroll?.scrollTop ?? 0;
        reqWorkSetReqNoInput(reqNo);
        syncReqListRowSelection(document.getElementById('reqWorkHistPanel'));
        if (histScroll) histScroll.scrollTop = histScrollTop;
    }

    function syncReqListHeadPad() {
        const scroll = document.getElementById('spareReqListScroll');
        const head = document.getElementById('spareReqListHead');
        if (!scroll || !head) return;
        const sb = scroll.offsetWidth - scroll.clientWidth;
        head.style.paddingRight = sb > 0 ? `${sb}px` : '';
    }

    function buildReqListRowsHtml(reqs, mode = 'modal') {
        if (!reqs.length) {
            return `<tr><td colspan="11" class="spare-req-list-empty">
                <span class="spare-req-list-empty-icon" aria-hidden="true">🧾</span>
                <p class="spare-req-list-empty-title">No requisitions yet</p>
                <p class="spare-req-list-empty-sub muted">${mode === 'pick'
                    ? 'Save a requisition to see it here.'
                    : 'Click <strong>New</strong> to create a requisition, or adjust Phase / Period / Search.'}</p>
            </td></tr>`;
        }
        const m = modState(getState());
        return reqs.map(r => {
            const rid = escAttr(r.id);
            const no = escAttr(r.req_no || '');
            const checked = reqListIsRowChecked(m, r.id);
            const sel = m.selectedReqId === r.id;
            const rowClick = mode === 'pick'
                ? `onclick="TVC_SpareMenu.reqListPickRow('${rid}', '${no}')"`
                : `onclick="TVC_SpareMenu.reqListSelectRow('${rid}')"`;
            const toggleFn = mode === 'pick' ? 'reqListPickToggleRow' : 'reqListToggleRow';
            const port = String(r.deliver_port || '').trim();
            const reported = reqListReportedDate(r);
            const received = reqListReceivedDate(r);
            const recvPort = reqListReceivedPort(r);
            const reqDate = reqListRequiredDateCell(r);
            const reqType = reqListTypeLabel(r);
            const reqTypeCls = reqListTypeCellClass(r);
            const canSelect = !_reqListXferExportKind || reqListCanXferExport(r);
            const chkDisabled = canSelect ? '' : ` disabled title="${escAttr(reqListXferExportSelectDisabledTitle(r))}"`;
            return `<tr class="${sel ? 'sr-req-sel' : ''}${canSelect ? '' : ' menu-xfer-defect-row-disabled'}" data-req-id="${rid}" ${rowClick}>
                <td class="spare-req-list-chk" onclick="event.stopPropagation()">
                    <input type="checkbox" aria-label="Select requisition ${no}"
                        ${checked ? 'checked' : ''}${chkDisabled} onchange="TVC_SpareMenu.${toggleFn}('${rid}', this.checked)">
                </td>
                <td class="spare-req-list-type ${reqTypeCls}"${cellTitleAttr(reqType)}>${esc(reqType)}</td>
                <td class="spare-req-list-reqno"${cellTitleAttr(r.req_no)}>${esc(r.req_no || '—')}</td>
                <td class="spare-req-list-date spare-req-list-daterange"${cellTitleAttr(reqDate)}>${reqDate}</td>
                <td class="spare-req-list-port spare-req-list-req-port"${cellTitleAttr(port)}>${esc(r.deliver_port || '—')}</td>
                <td class="spare-req-list-date spare-req-list-submitted"${cellTitleAttr(reported)}>${reqListDateCell(reported)}</td>
                <td class="spare-req-list-status">${reqListStatusCell(r)}</td>
                <td class="spare-req-list-date spare-req-list-received"${cellTitleAttr(received)}>${reqListDateCell(received)}</td>
                <td class="spare-req-list-port spare-req-list-recv-port"${cellTitleAttr(recvPort)}>${esc(recvPort || '—')}</td>
                <td class="spare-req-list-os">${reqListOutstandingData(r)}</td>
                <td class="spare-req-list-total">${reqListTotalData(r)}</td>
            </tr>`;
        }).join('');
    }

    async function reqListPickToggleRow(id, checked) {
        const m = modState(getState());
        const map = ensureReqListChecked(m);
        if (checked) {
            map[id] = true;
            m.selectedReqId = id;
        } else {
            delete map[id];
            if (m.selectedReqId === id) m.selectedReqId = null;
        }
        if (isRequisitionListWindow(m)) {
            const { vesselId } = await vesselScope();
            const reqs = await TVC_Inventory.listRequisitions(vesselId);
            updateReqListHeadCheckAll(reqs);
            syncReqListRowSelection(document.getElementById('reqWorkHistPanel'));
            await syncReqHistPopoverToolbar();
            return;
        }
        if (checked) {
            const req = await TVC_Inventory.getRequisition(id);
            if (req?.req_no) reqWorkSetReqNoInput(req.req_no);
        }
        await refreshReqWorkHistList();
    }

    function syncReqWorkHistHeadPad() {
        const scroll = document.getElementById('reqWorkHistListScroll');
        const head = document.getElementById('reqWorkHistListHead');
        if (!scroll || !head) return;
        const sb = scroll.offsetWidth - scroll.clientWidth;
        head.style.paddingRight = sb > 0 ? `${sb}px` : '';
    }

    async function renderReqListModal() {
        const body = document.getElementById('spareReqListBody');
        if (!body) return;
        const { st, vesselId } = await vesselScope();
        const m = modState(st);
        const canRequisition = canCreateRequisition(st);
        const allReqs = await TVC_Inventory.listRequisitions(vesselId);
        const phaseCounts = reqListPhaseCounts(allReqs, st);
        const reqs = filterReqList(allReqs, st);
        const reqRows = buildReqListRowsHtml(reqs, 'modal');
        const selId = m.selectedReqId;
        const selReq = selId ? allReqs.find(r => r.id === selId) : null;
        const hasSel = !!selReq;
        const canConfirm = reqListAnyCheckedCanConfirm(m, allReqs, st);
        const canDelete = reqListCanDeleteSelection(m, st);
        const canCloseOs = reqListAnyCloseOsEnabled(m, allReqs, st);
        const exportXfer = _reqListXferExportKind;
        const exportableCount = exportXfer ? reqListCheckedExportableIds(m, allReqs).length : 0;
        const exportXferTitle = exportXfer === 'received' ? ' — Received Export' : exportXfer ? ' — Export' : '';
        const exportXferHint = exportXfer === 'received'
            ? 'Select <strong>Received</strong> requisition(s) to export. Other statuses cannot be selected.'
            : exportXfer
                ? 'Select <strong>Confirmed</strong> requisition(s) to export. Reported, Draft, Submitted, and other rows cannot be selected.'
                : '';

        const headToolbar = exportXfer
            ? `${spareListToolbarBtn('Export', 'TVC_SpareMenu.reqListExportToMaster()', !exportableCount, 'btn-green')}
            ${spareListToolbarBtn('← Back', 'TVC_SpareMenu.reqListXferExportBack()')}
            ${spareListToolbarBtn('Close', 'TVC_SpareMenu.closeReqListModal()')}
            <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeReqListModal()" title="Close">×</button>`
            : `${spareListToolbarBtn('Detail Report', 'TVC_SpareMenu.reqListDetailReport()', !hasSel)}
            ${spareListToolbarBtn('Report Confirm', 'TVC_SpareMenu.reqListReportConfirm()', !canConfirm, 'btn-green')}
            ${spareListToolbarBtn('Close O/S', 'TVC_SpareMenu.openCloseOsModal()', !canCloseOs)}
            <span class="orig-toolbar-sep" aria-hidden="true"></span>
            ${spareListToolbarBtn('New', 'TVC_SpareMenu.reqListNew()', !canRequisition, 'btn-green')}
            ${spareListToolbarBtn('Modify', 'TVC_SpareMenu.reqListModify()', !canRequisition || !hasSel)}
            ${spareListToolbarBtn('Delete', 'TVC_SpareMenu.reqListDelete()', !canDelete, 'btn-red')}
            <span class="orig-toolbar-sep" aria-hidden="true"></span>
            ${spareListToolbarBtn('Print', 'TVC_SpareMenu.reqListPrint()')}
            ${spareListToolbarBtn('Preview', 'TVC_SpareMenu.reqListDocPreview()')}
            ${spareListToolbarBtn('Close', 'TVC_SpareMenu.closeReqListModal()')}
            <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeReqListModal()" title="Close">×</button>`;

        body.innerHTML = `
        <div class="spare-req-list-wrap spare-req-list-main-wrap${exportXfer ? ' spare-req-list-xfer-export' : ''}">
          <div class="spare-req-list-head">
            <h3 class="spare-req-work-title">📋 Requisition List${exportXferTitle}
              <span class="muted spare-req-list-count">${reqs.length}${reqs.length !== allReqs.length ? ` / ${allReqs.length}` : ''} item(s)</span>
            </h3>
            <span class="spare-req-work-head-spacer"></span>
            ${headToolbar}
          </div>
          ${exportXfer ? `<p class="spare-sync-note muted spare-req-list-xfer-hint">${exportXferHint}</p>` : ''}
          ${exportXfer ? '' : reqListPhaseTabsHtml(m, phaseCounts)}
          <div class="hist-toolbar hist-toolbar-filters filter-bar spare-list-search-bar spare-req-list-filters">
            <div id="reqListPeriodFilter" class="act-period-filter" title="Filter by Reported Date">
                <span class="act-period-label">Period</span>
                <input type="text" id="reqListPeriodFrom" class="act-period-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" aria-label="Period from"
                    value="${escAttr(m.reqListPeriodFrom || '')}" onchange="TVC_SpareMenu.reqListSetPeriod()">
                <span class="act-period-sep">~</span>
                <input type="text" id="reqListPeriodTo" class="act-period-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" aria-label="Period to"
                    value="${escAttr(m.reqListPeriodTo || '')}" onchange="TVC_SpareMenu.reqListSetPeriod()">
                <button type="button" class="btn btn-sm act-period-clear" onclick="TVC_SpareMenu.reqListClearPeriod()">Clear</button>
            </div>
            <div class="search-field-wrap">
                <input class="search-input" id="reqListSearch" placeholder="Search REQ NO / PORT / STATUS…"
                    value="${esc(m.reqListSearch || '')}" oninput="TVC_SpareMenu.reqListSetSearch(this.value)">
                <button type="button" class="search-clear-btn${m.reqListSearch ? '' : ' hidden'}" title="Clear search" aria-label="Clear search"
                    onclick="TVC_SpareMenu.reqListClearSearch()">×</button>
            </div>
          </div>
          <div class="spare-req-list-panel-wrap">
            <div class="panel spare-req-list-panel">
              <div class="spare-req-list-head-wrap" id="spareReqListHead">
                <table class="spare-data-table spare-req-list-table spare-req-list-head-table">${REQ_LIST_COLGROUP}${reqListTableHeadHtml()}</table>
              </div>
              <div class="spare-req-list-scroll" id="spareReqListScroll">
                <table class="spare-data-table spare-req-list-table spare-req-list-body-table">${REQ_LIST_COLGROUP}<tbody>${reqRows}</tbody></table>
              </div>
            </div>
          </div>
        </div>`;
        updateReqListHeadCheckAll(reqs);
        syncReqListFilterUi(st);
        syncSpareDateInputs(body);
        requestAnimationFrame(syncReqListHeadPad);
    }

    function clearConsumeLogUiState(m) {
        m.consumeLogCheckedIds = {};
        m.selectedConsumeLogId = null;
    }

    function ensureConsumeLogChecked(m) {
        if (!m.consumeLogCheckedIds) m.consumeLogCheckedIds = {};
        return m.consumeLogCheckedIds;
    }

    function consumeLogIsRowChecked(m, id) {
        return !!m.consumeLogCheckedIds?.[id];
    }

    function consumeLogTotalData(log) {
        return Number(log.line_count) || (log.lines || []).length || 0;
    }

    function consumeLogDateCell(val) {
        return esc(val || '—');
    }

    function consumeLogComments(log) {
        return String(log.ships_comments || '').trim();
    }

    function consumeLogDateInPeriod(dateStr, from, to) {
        if (!from && !to) return true;
        const d = String(dateStr || '').slice(0, 10);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
    }

    function consumeLogStatusLabel(log) {
        const s = spareListStatus(log);
        return s || SPARE_LIST_STATUS.DRAFT;
    }

    function consumeLogStatusCell(log) {
        const label = consumeLogStatusLabel(log);
        const cls = label.replace(/\s+/g, '');
        return `<span class="sr-status cl-st-${escAttr(cls)}">${esc(label)}</span>`;
    }

    function consumeLogMatchSearch(log, q) {
        if (!q) return true;
        const jobHay = consumeLogJobItems(log).map(i =>
            [i.job_code, i.sort1, i.sort2, i.job_detail].join(' ')
        ).join(' ');
        const hay = [
            log.job_code, log.sort1, log.sort2, log.job_detail, jobHay,
            log.made_on, log.made_by, consumeLogStatusLabel(log),
            log.pms_group_no, consumeLogComments(log),
        ].join(' ').toLowerCase();
        return hay.includes(q);
    }

    function filterConsumeLogs(logs, st) {
        const m = modState(st);
        const from = m.consumeLogPeriodFrom || '';
        const to = m.consumeLogPeriodTo || '';
        const q = String(m.consumeLogSearch || '').trim().toLowerCase();
        return (logs || []).filter(log =>
            consumeLogDateInPeriod(log.made_on || log.consumed_date, from, to)
            && consumeLogMatchSearch(log, q));
    }

    function consumeLogCanConfirm(st, log) {
        if (!log) return false;
        const user = spareInventoryUser(st);
        return consumeLogStatusLabel(log) === SPARE_LIST_STATUS.REPORTED
            && !!user && TVC_RBAC.canConfirmDepartment(user, log.department || st.department);
    }

    function syncConsumeLogFilterUi(st) {
        const m = modState(st);
        const fromEl = document.getElementById('consumeLogPeriodFrom');
        const toEl = document.getElementById('consumeLogPeriodTo');
        const searchEl = document.getElementById('consumeLogSearch');
        const filterEl = document.getElementById('consumeLogPeriodFilter');
        if (fromEl) fromEl.value = m.consumeLogPeriodFrom || '';
        if (toEl) toEl.value = m.consumeLogPeriodTo || '';
        if (searchEl) searchEl.value = m.consumeLogSearch || '';
        if (filterEl) filterEl.classList.toggle('active', !!(m.consumeLogPeriodFrom || m.consumeLogPeriodTo));
    }

    function consumeLogSetPeriod() {
        const st = getState();
        const m = modState(st);
        m.consumeLogPeriodFrom = document.getElementById('consumeLogPeriodFrom')?.value || '';
        m.consumeLogPeriodTo = document.getElementById('consumeLogPeriodTo')?.value || '';
        renderConsumeLogModal();
    }

    function consumeLogClearPeriod() {
        const st = getState();
        const m = modState(st);
        m.consumeLogPeriodFrom = '';
        m.consumeLogPeriodTo = '';
        renderConsumeLogModal();
    }

    function consumeLogSetSearch(v) {
        modState(getState()).consumeLogSearch = v;
        clearTimeout(_consumeLogSearchT);
        _consumeLogSearchT = setTimeout(() => renderConsumeLogModal(), 150);
    }

    function consumeLogClearSearch() {
        modState(getState()).consumeLogSearch = '';
        const el = document.getElementById('consumeLogSearch');
        if (el) el.value = '';
        renderConsumeLogModal();
    }

    let _consumeLogSearchT = null;

    function resolveConsumeDraftWorkReportId(draft, st) {
        if (!draft) return '';
        if (draft.work_report_id) return draft.work_report_id;
        const logId = draft.log_id;
        if (!logId) return '';
        const rep = (st.reports || []).find(r => r.consume_log_id === logId);
        return rep?.id || '';
    }

    function consumeDraftFromLog(log) {
        const jobItems = consumeLogJobItems(log);
        const draft = {
            log_id: log.id,
            work_report_id: log.work_report_id || '',
            source: log.source || '',
            consumed_date: log.consumed_date || '',
            made_on: log.made_on || '',
            made_by: log.made_by || '',
            spare_group_key: log.pms_group_key || '',
            spare_group_label: log.pms_group_no || '',
            job_code: log.job_code || '',
            sort1: log.sort1 || '',
            sort2: log.sort2 || '',
            job_detail: log.job_detail || '',
            job_items: jobItems,
            ships_comments: log.ships_comments || '',
            list_status: log.list_status || spareListStatus(log),
            confirmed_by: log.confirmed_by || '',
            confirmed_at: log.confirmed_at || '',
            approved_by: log.approved_by || '',
            approved_at: log.approved_at || '',
            lines: (log.lines || []).map(l => ({
                spare_part_id: l.spare_part_id,
                part_no: l.part_no || '',
                name: l.name || '',
                qty_consumed: Number(l.qty ?? l.qty_consumed) || 0,
            })),
        };
        syncConsumeDraftJobSummary(draft);
        return draft;
    }

    function consumeLogPreviewSource(draft) {
        ensureConsumeJobItems(draft);
        syncConsumeDraftJobSummary(draft);
        return {
            consumed_date: draft.consumed_date,
            made_on: draft.made_on,
            made_by: draft.made_by,
            pms_group_no: draft.spare_group_label || '',
            job_code: draft.job_code,
            sort1: draft.sort1,
            sort2: draft.sort2,
            job_detail: draft.job_detail,
            job_items: draft.job_items.map(i => ({ ...i })),
            ships_comments: draft.ships_comments,
            lines: (draft.lines || []).map(l => ({
                part_no: l.part_no,
                name: l.name,
                qty: Number(l.qty_consumed) || 0,
            })),
        };
    }

    function applyConsumeLogSelection(m, id) {
        if (!id) return;
        m.selectedConsumeLogId = id;
        const map = ensureConsumeLogChecked(m);
        map[id] = true;
    }

    function updateConsumeLogHeadCheckAll(logs) {
        document.querySelectorAll('.spare-consume-log-head-chk').forEach(el => {
            if (!logs.length) {
                el.checked = false;
                el.indeterminate = false;
                return;
            }
            const m = modState(getState());
            let n = 0;
            logs.forEach(l => { if (consumeLogIsRowChecked(m, l.id)) n++; });
            el.checked = n === logs.length;
            el.indeterminate = n > 0 && n < logs.length;
        });
    }

    function syncConsumeLogHeadPad() {
        const scroll = document.getElementById('spareConsumeLogScroll');
        const head = document.getElementById('spareConsumeLogHead');
        if (!scroll || !head) return;
        const sb = scroll.offsetWidth - scroll.clientWidth;
        head.style.paddingRight = sb > 0 ? `${sb}px` : '';
    }

    function buildConsumeLogRowsHtml(logs) {
        if (!logs.length) {
            return `<tr><td colspan="8" class="spare-req-list-empty">
                <span class="spare-req-list-empty-icon" aria-hidden="true">📋</span>
                <p class="spare-req-list-empty-title">No consumed logs yet</p>
                <p class="spare-req-list-empty-sub muted">Save consumed spare parts from <strong>Input Consumed Spare Parts</strong>, or adjust Period / Search.</p>
            </td></tr>`;
        }
        const m = modState(getState());
        return logs.map(log => {
            const lid = escAttr(log.id);
            const checked = consumeLogIsRowChecked(m, log.id);
            const sel = m.selectedConsumeLogId === log.id;
            const jobItems = consumeLogJobItems(log);
            const jobText = jobItems.map(i => i.job_code).filter(Boolean).join(', ') || String(log.job_code || '').trim();
            const sort1Text = jobItems.length > 1
                ? jobItems.map(i => i.sort1).filter(Boolean).join(' · ')
                : String(jobItems[0]?.sort1 || log.sort1 || '').trim();
            const sort2Text = jobItems.length > 1
                ? jobItems.map(i => i.sort2).filter(Boolean).join(' · ')
                : String(jobItems[0]?.sort2 || log.sort2 || '').trim();
            const detailText = jobItems.length > 1
                ? jobItems.map(i => i.job_detail).filter(Boolean).join(' · ')
                : String(jobItems[0]?.job_detail || log.job_detail || '').trim();
            const reported = log.made_on || log.consumed_date || '';
            return `<tr class="spare-consume-log-row${sel ? ' sr-req-sel' : ''}" data-consume-log-id="${lid}"
                onclick="TVC_SpareMenu.consumeLogSelectRow('${lid}')">
                <td class="spare-consume-log-chk" onclick="event.stopPropagation()">
                    <input type="checkbox" class="spare-row-chk"${checked ? ' checked' : ''} aria-label="Select consumption log"
                        onclick="event.stopPropagation()"
                        onchange="TVC_SpareMenu.consumeLogToggleRow('${lid}', this.checked)">
                </td>
                <td class="spare-consume-log-job"${cellTitleAttr(jobText)}>${esc(jobText || '—')}</td>
                <td class="spare-consume-log-sort"${cellTitleAttr(sort1Text)}>${esc(sort1Text || '—')}</td>
                <td class="spare-consume-log-sort"${cellTitleAttr(sort2Text)}>${esc(sort2Text || '—')}</td>
                <td class="spare-consume-log-detail"${cellTitleAttr(detailText)}>${esc(detailText || '—')}</td>
                <td class="spare-consume-log-reported"${cellTitleAttr(reported)}>${consumeLogDateCell(reported)}</td>
                <td class="spare-consume-log-status">${consumeLogStatusCell(log)}</td>
                <td class="spare-consume-log-total">${consumeLogTotalData(log)}</td>
            </tr>`;
        }).join('');
    }

    function consumeLogToolbarBtn(label, onclick, disabled = false, cls = '') {
        return spareListToolbarBtn(label, onclick, disabled, cls);
    }

    async function renderConsumeLogModal() {
        const body = document.getElementById('spareConsumeLogBody');
        if (!body) return;
        const { st, vesselId } = await vesselScope();
        const m = modState(st);
        const canConsume = canCreateConsume(st);
        const allLogs = await TVC_Inventory.listConsumeLogs(vesselId);
        const logs = filterConsumeLogs(allLogs, st);
        const rows = buildConsumeLogRowsHtml(logs);
        const selId = m.selectedConsumeLogId;
        const selLog = selId ? allLogs.find(l => l.id === selId) : null;
        const hasSel = !!selLog;
        const canConfirm = consumeLogCanConfirm(st, selLog);

        body.innerHTML = `
            <div class="spare-req-list-wrap spare-consume-log-wrap">
              <div class="spare-req-list-head spare-consume-log-toolbar">
                <h3 class="spare-req-work-title">Consumed Log
                  <span class="muted spare-req-list-count">${logs.length}${logs.length !== allLogs.length ? ` / ${allLogs.length}` : ''} item(s)</span>
                </h3>
                <span class="spare-req-work-head-spacer"></span>
                ${consumeLogToolbarBtn('Detail Report', 'TVC_SpareMenu.consumeLogDetailReport()', !hasSel)}
                ${consumeLogToolbarBtn('Report Confirm', 'TVC_SpareMenu.consumeLogReportConfirm()', !canConfirm, 'btn-green')}
                <span class="orig-toolbar-sep" aria-hidden="true"></span>
                ${consumeLogToolbarBtn('New', 'TVC_SpareMenu.consumeLogNew()', !canConsume, 'btn-green')}
                ${consumeLogToolbarBtn('Modify', 'TVC_SpareMenu.consumeLogModify()', !canConsume || !hasSel)}
                ${consumeLogToolbarBtn('Delete', 'TVC_SpareMenu.consumeLogDelete()', !canConsume || !hasSel, 'btn-red')}
                <span class="orig-toolbar-sep" aria-hidden="true"></span>
                ${consumeLogToolbarBtn('Print', 'TVC_SpareMenu.consumeLogPrint()')}
                ${consumeLogToolbarBtn('Preview', 'TVC_SpareMenu.consumeLogDocPreview()')}
                ${consumeLogToolbarBtn('Close', 'TVC_SpareMenu.closeConsumeLogModal()')}
                <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeConsumeLogModal()" title="Close">×</button>
              </div>
              <div class="hist-toolbar hist-toolbar-filters filter-bar spare-list-search-bar spare-consume-log-filters">
                <div id="consumeLogPeriodFilter" class="act-period-filter" title="Filter by Reported Date">
                    <span class="act-period-label">Period</span>
                    <input type="text" id="consumeLogPeriodFrom" class="act-period-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" aria-label="Period from"
                        value="${escAttr(m.consumeLogPeriodFrom || '')}" onchange="TVC_SpareMenu.consumeLogSetPeriod()">
                    <span class="act-period-sep">~</span>
                    <input type="text" id="consumeLogPeriodTo" class="act-period-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" aria-label="Period to"
                        value="${escAttr(m.consumeLogPeriodTo || '')}" onchange="TVC_SpareMenu.consumeLogSetPeriod()">
                    <button type="button" class="btn btn-sm act-period-clear" onclick="TVC_SpareMenu.consumeLogClearPeriod()">Clear</button>
                </div>
                <div class="search-field-wrap">
                    <input class="search-input" id="consumeLogSearch" placeholder="Search JOB CODE / SORT / DETAIL / STATUS…"
                        value="${esc(m.consumeLogSearch || '')}" oninput="TVC_SpareMenu.consumeLogSetSearch(this.value)">
                    <button type="button" class="search-clear-btn${m.consumeLogSearch ? '' : ' hidden'}" title="Clear search" aria-label="Clear search"
                        onclick="TVC_SpareMenu.consumeLogClearSearch()">×</button>
                </div>
              </div>
              <div class="spare-req-list-panel-wrap">
                <div class="panel spare-req-list-panel spare-consume-log-panel">
                  <div class="spare-req-list-head-wrap" id="spareConsumeLogHead">
                    <table class="spare-data-table spare-req-list-table spare-consume-log-table spare-req-list-head-table spare-consume-log-head-table">${CONSUME_LOG_COLGROUP}${consumeLogTableHeadHtml()}</table>
                  </div>
                  <div class="spare-req-list-scroll" id="spareConsumeLogScroll">
                    <table class="spare-data-table spare-req-list-table spare-consume-log-table spare-req-list-body-table spare-consume-log-body-table">${CONSUME_LOG_COLGROUP}<tbody>${rows}</tbody></table>
                  </div>
                </div>
              </div>
            </div>`;
        updateConsumeLogHeadCheckAll(logs);
        syncConsumeLogFilterUi(st);
        syncSpareDateInputs(body);
        requestAnimationFrame(syncConsumeLogHeadPad);
    }

    function openConsumeLogModal(opts = {}) {
        const m = modState(getState());
        clearConsumeLogUiState(m);
        if (opts.selectId) applyConsumeLogSelection(m, opts.selectId);
        renderConsumeLogModal().then(() => showSpicsModal('spareConsumeLogModal'));
    }

    function closeConsumeLogModal() {
        clearConsumeLogUiState(modState(getState()));
        closeSpicsModal('spareConsumeLogModal');
    }

    function viewConsumedLog() {
        openConsumeLogModal();
    }

    async function consumeLogSelectRow(id) {
        const m = modState(getState());
        // 행 클릭은 하이라이트(선택)만 — Requisition List와 동일
        m.selectedConsumeLogId = id;
        await renderConsumeLogModal();
    }

    async function consumeLogToggleRow(id, checked) {
        const m = modState(getState());
        const map = ensureConsumeLogChecked(m);
        if (checked) {
            map[id] = true;
            m.selectedConsumeLogId = id;
        } else {
            delete map[id];
            if (m.selectedConsumeLogId === id) m.selectedConsumeLogId = null;
        }
        await renderConsumeLogModal();
    }

    async function consumeLogToggleAll(checked) {
        const m = modState(getState());
        const { vesselId } = await vesselScope();
        const allLogs = await TVC_Inventory.listConsumeLogs(vesselId);
        const logs = filterConsumeLogs(allLogs, getState());
        if (checked) {
            const map = ensureConsumeLogChecked(m);
            logs.forEach(l => { map[l.id] = true; });
            if (!m.selectedConsumeLogId && logs.length) m.selectedConsumeLogId = logs[0].id;
        } else {
            m.consumeLogCheckedIds = {};
            m.selectedConsumeLogId = null;
        }
        await renderConsumeLogModal();
    }

    async function consumeLogReportConfirm() {
        const st = getState();
        const id = modState(st).selectedConsumeLogId;
        if (!id) return alert('Select a consumption log.');
        const log = await TVC_Inventory.getConsumeLog(id);
        if (!log) return alert('Consumption log not found.');
        if (!consumeLogCanConfirm(st, log)) {
            return alert('Only Reported logs can be confirmed, and you need Chief Engineer / Captain permission.');
        }
        const user = spareInventoryUser(st);
        log.confirmed_by = TVC_RBAC.getDepartmentConfirmLabel(log.department || st.department) || TVC_RBAC.getRankLabel(user);
        log.confirmed_at = new Date().toISOString();
        log.list_status = SPARE_LIST_STATUS.CONFIRMED;
        await TVC_Inventory.saveConsumeLog(log);
        await renderConsumeLogModal();
        alert('Report confirmed.');
    }

    async function consumeLogDetailReport() {
        return consumeLogPreview();
    }

    async function consumeLogDocPreview() {
        const body = await buildConsumedLogListPrintBody();
        openSpareListPrintWindow('Consumed Log', body, true);
    }

    async function consumeLogNew() {
        const { st } = await vesselScope();
        if (!canCreateConsume(st)) {
            alert('No permission to enter consumption records.');
            return;
        }
        closeConsumeLogModal();
        _consumeListReturnAfterSave = true;
        if (window.TVC_App?.switchTab && st.currentTab !== 'spare') {
            TVC_App.switchTab('spare');
        }
        await startConsumeSession();
    }

    async function consumePreviewOpenWorkReport() {
        const draft = getConsumeSession();
        const st = getState();
        let reportId = draft?.work_report_id || resolveConsumeDraftWorkReportId(draft, st);
        if (!reportId && draft?.log_id) {
            const all = await TVC_DB.getAll('daily_work_reports');
            const linked = all.find(r => r.consume_log_id === draft.log_id);
            reportId = linked?.id || '';
        }
        if (!reportId) return alert('No linked Work Report.');

        let report = (st.reports || []).find(r => r.id === reportId);
        if (!report) {
            report = await TVC_DB.get('daily_work_reports', reportId);
            if (report) {
                TVC_WorkReport.fromLegacy(report);
                st.reports = st.reports || [];
                if (!st.reports.some(r => r.id === reportId)) st.reports.push(report);
            }
        }
        if (!report) return alert('Work Report not found.');

        TVC_WorkReport.fromLegacy(report);
        const item = TVC_WorkReport.findItem(report, draft.job_code) || TVC_WorkReport.getJobItems(report)[0];
        if (!item?.maintenance_job_id) return alert('Work Report job item not found.');

        _consumeWorkReportOverlay = true;
        if (!window.TVC_App?.openWorkReportFromHistory) return alert('Cannot open Work Report screen.');
        TVC_App.openWorkReportFromHistory(reportId, item.maintenance_job_id);
        document.getElementById('workReportModal')?.classList.add('modal-over-consume');
    }

    function cleanupConsumeWorkReportOverlay() {
        if (!_consumeWorkReportOverlay) return;
        _consumeWorkReportOverlay = false;
        document.getElementById('workReportModal')?.classList.remove('modal-over-consume');
    }

    async function consumePreviewModify() {
        const { st } = await vesselScope();
        const m = modState(st);
        if (!canCreateConsume(st)) {
            alert('No permission to enter consumption records.');
            return;
        }
        const logId = m.consumeLastSavedLogId || m.selectedConsumeLogId;
        if (!logId) return alert('Select a consumption log to edit.');
        const log = await TVC_Inventory.getConsumeLog(logId);
        if (!log) return alert('Consumption log not found.');
        if (!(log.lines || []).length) return alert('No parts to edit.');
        _consumeListReturnAfterSave = true;
        await startConsumeEditSession(logId);
    }

    async function consumeLogModify() {
        const { st } = await vesselScope();
        const m = modState(st);
        if (!canCreateConsume(st)) {
            alert('No permission to enter consumption records.');
            return;
        }
        if (!m.selectedConsumeLogId) return alert('Select a consumption log to edit.');
        const log = await TVC_Inventory.getConsumeLog(m.selectedConsumeLogId);
        if (!log) return alert('Consumption log not found.');
        if (!(log.lines || []).length) return alert('No parts to edit.');
        const logId = m.selectedConsumeLogId;
        closeConsumeLogModal();
        _consumeListReturnAfterSave = true;
        if (window.TVC_App?.switchTab && st.currentTab !== 'spare') {
            TVC_App.switchTab('spare');
        }
        await startConsumeEditSession(logId);
    }

    async function consumeLogDelete() {
        const st = getState();
        const m = modState(st);
        if (!canCreateConsume(st)) {
            alert('No permission to delete consumption logs.');
            return;
        }
        if (!m.selectedConsumeLogId) return alert('Select a consumption log to delete.');
        const log = await TVC_Inventory.getConsumeLog(m.selectedConsumeLogId);
        if (!log) return alert('Consumption log not found.');
        const label = [log.consumed_date, log.job_code, consumeLogComments(log)].filter(Boolean).join(' · ') || log.id;
        if (!confirm(`Delete this consumption log?\n\n${label}`)) return;
        const isWrLinked = log.source === 'work_report' || !!log.work_report_id;
        if (!isWrLinked && log.stock_applied_at && (log.lines || []).length) {
            const revLines = (log.lines || []).map(l => ({
                spare_part_id: l.spare_part_id,
                qty: Number(l.qty ?? l.qty_consumed) || 0,
            }));
            await TVC_InventoryService.reverseConsumption(user, revLines, {
                ref: log.job_code || '',
                source_id: log.id,
                source_type: 'consume_log',
                note: 'Consumed log deleted — stock restored',
            });
        }
        await TVC_Inventory.deleteConsumeLog(m.selectedConsumeLogId);
        m.selectedConsumeLogId = null;
        m.consumeLogCheckedIds = {};
        await refresh();
        await renderConsumeLogModal();
    }

    async function consumeLogPreview() {
        const id = modState(getState()).selectedConsumeLogId;
        if (!id) return alert('Select a consumption log.');
        closeConsumeLogModal();
        _consumeListReturnAfterSave = true;
        if (window.TVC_App?.switchTab && getState().currentTab !== 'spare') {
            TVC_App.switchTab('spare');
        }
        await startConsumePreviewSession(id);
    }

    async function consumeLogPrint() {
        const body = await buildConsumedLogListPrintBody();
        openSpareListPrintWindow('Consumed Log', body, false);
    }

    function buildConsumeLogJobMetaRowsHtml(log) {
        const items = consumeLogJobItems(log);
        if (items.length <= 1) {
            const i = items[0] || {};
            return `
                    <tr><th>PMS Group No.</th><td>${esc(safeTreeLabel(log.pms_group_no || '') || '—')}</td><th>JOB CODE</th><td>${esc(i.job_code || '—')}</td></tr>
                    <tr><th>Made on</th><td>${esc(log.made_on || '—')}</td><th>by</th><td>${esc(log.made_by || '—')}</td></tr>
                    <tr><th>SORT-1</th><td>${esc(i.sort1 || '—')}</td><th>SORT-2</th><td>${esc(i.sort2 || '—')}</td></tr>
                    <tr><th>JOB DETAIL</th><td colspan="3">${esc(i.job_detail || '—')}</td></tr>`;
        }
        const jobRows = items.map(i => `<tr>
                <td>${esc(i.job_code || '—')}</td>
                <td>${esc(i.sort1 || '—')}</td>
                <td>${esc(i.sort2 || '—')}</td>
                <td>${esc(i.job_detail || '—')}</td>
            </tr>`).join('');
        return `
                    <tr><th>PMS Group No.</th><td colspan="3">${esc(safeTreeLabel(log.pms_group_no || '') || '—')}</td></tr>
                    <tr><th>Made on</th><td>${esc(log.made_on || '—')}</td><th>by</th><td>${esc(log.made_by || '—')}</td></tr>
                    <tr><th>Jobs</th><td colspan="3">
                        <table class="consume-log-jobs-mini">
                            <thead><tr><th>JOB CODE</th><th>SORT-1</th><th>SORT-2</th><th>JOB DETAIL</th></tr></thead>
                            <tbody>${jobRows}</tbody>
                        </table>
                    </td></tr>`;
    }

    function buildConsumeLogPreviewPagesHtml(st, log, vesselName) {
        const lines = (log.lines || []);
        const rows = lines.map(l => `<tr>
            <td class="rpv-code">${esc(l.part_no || '—')}</td>
            <td class="rpv-item">${esc(l.name || '—')}</td>
            <td class="rpv-n rpv-req">${esc(String(l.qty ?? ''))}</td>
        </tr>`).join('');
        const itemBody = rows || '<tr><td colspan="3" class="req-preview-empty">No lines</td></tr>';
        const comments = consumeLogComments(log);
        return `<div class="req-preview-page">
            <div class="req-preview-doc-title">CONSUMED SPARE PARTS LOG</div>
            <table class="req-preview-meta">
                <tbody>
                    <tr><th>Vessel Name</th><td>${esc(vesselName)}</td><th>Consumed Date</th><td>${esc(log.consumed_date || '—')}</td></tr>
                    ${buildConsumeLogJobMetaRowsHtml(log)}
                    <tr><th>Ship's Comments</th><td colspan="3">${esc(comments || '—')}</td></tr>
                </tbody>
            </table>
            <table class="req-preview-items">
                <thead><tr><th>Part No.</th><th>Item</th><th>Consumed Qty</th></tr></thead>
                <tbody>${itemBody}</tbody>
            </table>
        </div>`;
    }

    function renderConsumePreviewHtml(st, draft, vesselName) {
        if (!draft) return '';
        const log = consumeLogPreviewSource(draft);
        const pages = buildConsumeLogPreviewPagesHtml(st, log, vesselName);
        return `
        <div class="spare-req-work-wrap req-preview-wrap">
          <div class="spare-req-work-head">
            <h3 class="spare-req-work-title">Preview</h3>
            <span class="spare-req-work-head-spacer"></span>
            <button type="button" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.consumeLogPrintPreview()">🖨 Print</button>
            <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.consumeLogOpenList()">List</button>
            <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.closeConsumeModal()">Close</button>
            <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeConsumeModal()" title="Close">×</button>
          </div>
          <div class="spare-req-work-scroll req-preview-scroll">
            <div class="req-preview-pages">${pages}</div>
          </div>
        </div>`;
    }

    async function buildConsumeLogPrintDocument(logId) {
        const { st, vesselId } = await vesselScope();
        const log = await TVC_Inventory.getConsumeLog(logId);
        if (!log) return null;
        const vesselName = await vesselLabel(vesselId, log.department || st.user?.department);
        return buildConsumeLogPreviewPagesHtml(st, log, vesselName);
    }

    async function consumeLogPrintPreview() {
        const m = modState(getState());
        const id = m.consumeLastSavedLogId;
        if (!id) return alert('Consumption log not found.');
        const html = await buildConsumeLogPrintDocument(id);
        if (!html) return alert('Consumption log not found.');
        const w = window.open('', '_blank', 'width=980,height=760');
        if (!w) { alert('Popup blocked. Please allow popups in your browser.'); return; }
        w.document.write(`<!DOCTYPE html><html><head><title>Consumed Spare Parts Log</title>
            <style>${reqPreviewPrintStyles()}</style></head><body>${html}</body></html>`);
        w.document.close();
        w.focus();
        w.print();
    }

    async function consumeLogOpenList() {
        const m = modState(getState());
        const selectId = m.consumeLastSavedLogId || null;
        closeConsumeModal();
        await openConsumeLogModal(selectId ? { selectId } : {});
    }

    async function renderReqDetail(reqId, isHq, canRequisition, detailId = 'spareReqListDetail') {
        const box = document.getElementById(detailId);
        if (!box) return;
        const req = await TVC_Inventory.getRequisition(reqId);
        if (!req) { box.innerHTML = ''; return; }
        const lines = (req.lines || []).map(l => `<tr>
            <td>${esc(l.part_no)}</td><td>${esc(l.name)}</td>
            <td style="text-align:center">${l.qty_requested}</td>
            <td style="text-align:right">${l.price != null ? l.price : '—'}</td>
        </tr>`).join('');
        box.innerHTML = `
            <div class="sr-detail-head">
              <strong>${esc(req.req_no)}</strong> · <span class="sr-status sr-${req.status}">${req.status}</span>
              <span style="flex:1"></span>
              <button class="btn btn-sm" onclick="TVC_SpareMenu.exportReq('${req.id}')">⬇ Export</button>
              <button class="btn btn-sm" onclick="TVC_SpareMenu.triggerImport('${req.id}')">⬆ Import</button>
            </div>
            <table class="sr-table sr-detail-table"><thead><tr><th>Part</th><th>Name</th><th>Qty</th><th>Price</th></tr></thead>
            <tbody>${lines}</tbody></table>`;
    }

    function renderEditor(sp) {
        const box = document.getElementById('spareEditorWrap');
        if (!box) return;
        const st = getState();
        const isNew = !sp.id;
        const f = (k, v) => (sp[k] != null ? sp[k] : (v != null ? v : ''));
        const groupVal = f('group');
        box.innerHTML = `
        <div class="sr-editor">
          <div class="sr-editor-head">${isNew ? '➕ Append Spare Part' : '✏️ Modify Spare Part'}</div>
          <div class="sr-editor-grid">
            <label>Part No *<input id="se_part_no" value="${esc(f('part_no', f('makerPartNo')))}"></label>
            <label>Name *<input id="se_name" value="${esc(f('name'))}"></label>
            <label>Universal Code<input id="se_universal_code" value="${esc(f('universal_code', f('universalItemCode')))}"></label>
            <label>GROUP (PMS)<select id="se_group">${buildGroupSelectHtml(st, groupVal)}</select></label>
            <label>Category<input id="se_category" value="${esc(f('category', 'ENGINE'))}"></label>
            <label>Unit<input id="se_unit" value="${esc(f('unit', 'EA'))}"></label>
            <label>Working Qty<input id="se_working_qty" type="number" min="0" value="${esc(f('qty_working', f('workingQty', 0)))}"></label>
            <label>Current Stock<input id="se_qty_on_hand" type="number" value="${esc(f('qty_on_hand', f('currentStock', 0)))}"></label>
            <label>Min Stock<input id="se_min_qty" type="number" value="${esc(f('min_qty', f('minStock', 0)))}"></label>
            <label>Standard Stock<input id="se_standard_stock" type="number" value="${esc(f('standard_stock', f('standardStock', 0)))}"></label>
            <label>Location<input id="se_location" value="${esc(f('location'))}"></label>
            <label>Price<input id="se_price" type="number" step="0.01" value="${sp.price != null ? esc(sp.price) : ''}"></label>
          </div>
          <p class="muted sr-editor-hint">GROUP matches the PMS GROUP Tree. Parts appear only for the GROUP selected in the SPARE GROUP Tree.</p>
          <div class="sr-editor-actions">
            <button class="btn btn-sm btn-green" onclick="TVC_SpareMenu.saveEdit()">💾 Save</button>
            <button class="btn btn-sm" onclick="TVC_SpareMenu.cancelEdit()">Cancel</button>
          </div>
        </div>`;
    }

    function bindFileInputs() {
        const fi = document.getElementById('srImportFile');
        if (fi) fi.onchange = (e) => onImportFile(e.target.files[0]);
        const invFi = document.getElementById('srInventoryImportFile');
        if (invFi) invFi.onchange = (e) => onInventoryImportFile(e.target.files[0]);
        const csvFi = document.getElementById('srCsvUploadFile');
        if (csvFi) csvFi.onchange = (e) => onCsvUpload(e.target.files[0]);
        const hqFi = document.getElementById('spareHqImportFile');
        if (hqFi) hqFi.onchange = (e) => onHqImportFile(e.target.files[0]);
        const xferFi = document.getElementById('spareXferImportFile');
        if (xferFi) xferFi.onchange = (e) => onSpareXferImportFile(e.target.files[0]);
    }

    function applySpareListFilter() {
        const st = getState();
        const allCanon = (st.spares || []).map(canon);
        const hadItems = _cachedList.length > 0;
        _cachedList = filteredSpares(st);
        const hasItems = _cachedList.length > 0;
        const countEl = document.getElementById('spareCount');
        if (countEl) countEl.textContent = `${_cachedList.length} / ${allCanon.length}`;
        if (!document.getElementById('spareListScroll') && !modState(st).reqWorkOpen && !modState(st).consumeOpen && !modState(st).receiveOpen && !modState(st).wrSpareOpen) {
            renderSpareFilterDashboard();
            return;
        }
        if (vl && hadItems && hasItems && document.getElementById('spareListScroll')) {
            vl.refresh();
        } else if (document.getElementById('spareListScroll')) {
            mountVirtualList();
        }
        renderSpareFilterDashboard();
        if (modState(st).reqWorkOpen) refreshReqWorkListUi();
        if (modState(st).consumeOpen) refreshConsumeListUi();
        if (modState(st).receiveOpen) refreshReceiveListUi();
        if (modState(st).wrSpareOpen) refreshWrSpareListUi();
        requestAnimationFrame(syncSpareHeadLayout);
    }

    // ── Navigation & filters ──────────────────────────────────────────
    function setSearch(v) {
        const st = getState();
        const m = modState(st);
        m.partNo = v;
        m.description = v;
        st.spareSearch = v;
        clearTimeout(_searchT);
        _searchT = setTimeout(() => {
            applySpareListFilter();
            TVC_App.updateSearchClearBtn?.('spareSearch');
        }, 150);
    }

    function clearSpareSearch() {
        setSearch('');
        const el = document.getElementById('spareSearch');
        if (el) el.value = '';
        TVC_App.updateSearchClearBtn?.('spareSearch');
        el?.focus();
    }

    function setFilter(key, val) {
        const st = getState();
        modState(st)[key] = val;
        clearTimeout(_debounce);
        _debounce = setTimeout(() => render(), 100);
    }

    function clearListFilters() {
        const st = getState();
        const m = modState(st);
        m.showLowOnly = false;
        m.spareFilter = 'total';
        renderSpareFilterDashboard();
        applySpareListFilter();
    }

    function toggleLowOnly() {
        const st = getState();
        const m = modState(st);
        if (m.spareFilter === 'lowStock') {
            m.spareFilter = 'total';
            m.showLowOnly = false;
        } else {
            m.spareFilter = 'lowStock';
            m.showLowOnly = true;
        }
        renderSpareFilterDashboard();
        applySpareListFilter();
    }

    function showLowStockOnly() {
        setSpareFilter('lowStock');
    }

    function toggleReqPanel() {
        const modal = document.getElementById('spareReqListModal');
        if (modal && !modal.classList.contains('hidden')) closeReqListModal();
        else openReqListModal();
    }

    async function openReqListModal(opts = {}) {
        const m = modState(getState());
        clearReqListUiState(m);
        if (opts.xferExport === 'received') _reqListXferExportKind = 'received';
        else if (opts.xferExport) _reqListXferExportKind = 'requisition';
        if (opts.phase) m.reqListPhaseTab = opts.phase;
        if (opts.selectId) applyReqListSelection(m, opts.selectId);
        await renderReqListModal();
        showSpicsModal('spareReqListModal');
    }

    function closeReqListModal() {
        clearReqListUiState(modState(getState()));
        _reqListXferExportKind = null;
        closeSpicsModal('spareReqListModal');
    }

    function reqListXferExportBack() {
        _reqListXferExportKind = null;
        closeReqListModal();
        _spareXfer = { step: 'export-type', mode: 'export' };
        renderSpareXferModal();
        showSpicsModal('spareSyncModal');
    }

    async function reqListNew() {
        const { st } = await vesselScope();
        if (!canCreateRequisition(st)) {
            alert('No permission to create requisitions.');
            return;
        }
        closeReqListModal();
        _reqListReturnAfterSave = true;
        if (window.TVC_App?.switchTab && st.currentTab !== 'spare') {
            TVC_App.switchTab('spare');
        }
        await openNewRequisitionWindow();
    }

    async function reqListModify() {
        const { st } = await vesselScope();
        const m = modState(st);
        if (!canCreateRequisition(st)) {
            alert('No permission to create requisitions.');
            return;
        }
        if (!m.selectedReqId) return alert('Select a requisition to edit.');
        const req = await TVC_Inventory.getRequisition(m.selectedReqId);
        if (!req) return alert('Requisition not found.');
        if (!(req.lines || []).length) return alert('No parts to edit.');
        const reqId = m.selectedReqId;
        closeReqListModal();
        _reqListReturnAfterSave = true;
        if (window.TVC_App?.switchTab && st.currentTab !== 'spare') {
            TVC_App.switchTab('spare');
        }
        await startReqWorkEditSession(reqId);
    }

    async function reqListDelete() {
        const st = getState();
        const m = modState(st);
        if (window.TVC_RBAC && !TVC_RBAC.can(st.user, TVC_RBAC.Action.CREATE_REQUISITION)) {
            alert('No permission to delete requisitions.');
            return;
        }
        const { vesselId } = await vesselScope();
        const allReqs = await TVC_Inventory.listRequisitions(vesselId);
        const checkedIds = Object.keys(m.reqListCheckedIds || {}).filter(k => m.reqListCheckedIds[k]);
        const idsToDelete = checkedIds.length
            ? checkedIds
            : (m.selectedReqId ? [m.selectedReqId] : []);
        if (!idsToDelete.length) return alert('Check one or more requisitions to delete.');
        const reqNos = idsToDelete.map(id => allReqs.find(r => r.id === id)?.req_no || id);
        const confirmMsg = idsToDelete.length === 1
            ? `Delete requisition ${reqNos[0]}?`
            : `Delete ${idsToDelete.length} requisitions?\n\n${reqNos.join('\n')}`;
        if (!confirm(confirmMsg)) return;
        const loadedId = _reqSheet.reqId || _reqWorkDraft?.id;
        const wasLoadedInListWindow = isRequisitionListWindow(m)
            && loadedId && idsToDelete.includes(loadedId);
        for (const deletedId of idsToDelete) {
            await TVC_Inventory.deleteRequisition(deletedId);
            if (_reqSheet.reqId === deletedId) _reqSheet.reqId = null;
        }
        m.reqListCheckedIds = {};
        m.selectedReqId = null;
        if (wasLoadedInListWindow) await clearRequisitionListWindowSelection();
        await refreshReqListUi();
        await syncReportedWaitAndRefreshList();
        if (idsToDelete.length > 1) alert(`Deleted ${idsToDelete.length} requisition(s).`);
    }

    function reqPreviewGroups(st, req) {
        const spareById = new Map((st.spares || []).map(s => [String(s.id), s]));
        const groups = new Map();
        (req.lines || []).forEach(line => {
            const raw = spareById.get(String(line.spare_part_id));
            const spare = raw ? canon(raw) : null;
            let header = null;
            let key = '';
            if (spare) {
                header = resolveSpareHeaderFromSpare(st, spare);
                key = header.pmsGroupNo || '';
            }
            if (!key) key = String(line.equipment || '').trim();
            const gkey = key || 'Unclassified';
            if (!groups.has(gkey)) {
                groups.set(gkey, {
                    key: gkey,
                    header: header || { pmsGroupNo: key, machineryName: '', modelType: '', capacity: '', maker: '', assyName: '', dwgNo: '' },
                    rows: [],
                });
            } else if (header && !groups.get(gkey).header.machineryName && header.machineryName) {
                groups.get(gkey).header = header;
            }
            groups.get(gkey).rows.push({ spare, line });
        });
        return [...groups.values()].sort((a, b) => {
            const na = pmsGroupSortNo(a.key);
            const nb = pmsGroupSortNo(b.key);
            if (na != null && nb != null) return na - nb;
            if (na != null) return -1;
            if (nb != null) return 1;
            return String(a.key).localeCompare(String(b.key));
        });
    }

    function reqPreviewItemCells(spare, line) {
        const s = spare;
        const pipe = s ? sparePipelineCols(s) : null;
        const std = s ? Number(spareStandardQty(s)) || 0 : (Number(line.standard_stock) || 0);
        const stock = s ? TVC_Inventory.currentStock(s) : (Number(line.qty_on_hand) || 0);
        const awaiting = pipe ? pipe.awaiting : (Number(line.on_order) || 0);
        const needVal = pipe ? pipe.need : Math.max(0, std - stock - awaiting);
        const request = Number(line.qty_requested) || 0;
        return {
            code: s ? spareNumbering(s) : (line.part_no || '—'),
            cls: s ? spareClass(s) : '—',
            item: s ? (s.name || '') : (line.name || ''),
            pno: s ? (spareDrawingNo(s) || '—') : '—',
            unit: s ? spareUnit(s) : (line.unit || 'EA'),
            working: s ? spareWorking(s) : '',
            std: String(std),
            stock: String(stock),
            awaiting: String(awaiting),
            need: needVal == null ? '—' : String(needVal),
            request: String(request),
        };
    }

    function buildReqPreviewPagesHtml(st, req, vesselName) {
        const groups = reqPreviewGroups(st, req);
        const total = groups.length || 1;
        const dateRange = `${esc(req.deliver_date_from || '—')} ~ ${esc(req.deliver_date_to || '—')}`;
        const priority = esc(reqListTypeLabel(req));
        const madeCell = `${esc(req.made_on || '—')}${req.made_by ? ` by ${esc(req.made_by)}` : ''}`;
        const assessedCell = `${esc(req.assessed_on || '—')}${req.assessed_by ? ` by ${esc(req.assessed_by)}` : ''}`;
        if (!groups.length) {
            return `<div class="req-preview-page"><p class="req-preview-empty">No items to preview.</p></div>`;
        }
        return groups.map((g, i) => {
            const h = g.header || {};
            const rows = g.rows.map(({ spare, line }) => {
                const c = reqPreviewItemCells(spare, line);
                return `<tr>
                    <td class="rpv-code">${esc(c.code)}</td>
                    <td class="rpv-cls">${esc(c.cls)}</td>
                    <td class="rpv-item">${esc(c.item)}</td>
                    <td class="rpv-pno">${esc(c.pno)}</td>
                    <td class="rpv-c">${esc(c.unit)}</td>
                    <td class="rpv-n">${esc(c.working)}</td>
                    <td class="rpv-n">${esc(c.std)}</td>
                    <td class="rpv-n">${esc(c.stock)}</td>
                    <td class="rpv-n">${esc(c.awaiting)}</td>
                    <td class="rpv-n">${esc(c.need)}</td>
                    <td class="rpv-n rpv-req">${esc(c.request)}</td>
                </tr>`;
            }).join('');
            return `<div class="req-preview-page">
                <div class="req-preview-doc-title">PARTS REQUISITION</div>
                <table class="req-preview-meta">
                    <tbody>
                        <tr><th>Vessel Name</th><td>${esc(vesselName)}</td><th>Requisition No.</th><td>${esc(req.req_no || '—')}</td></tr>
                        <tr><th>Required Date</th><td>${dateRange}</td><th>Required Port</th><td>${esc(req.deliver_port || '—')}</td></tr>
                        <tr><th>Reported Date</th><td>${madeCell}</td><th>Evaluated Date</th><td>${assessedCell}</td></tr>
                        <tr><th>Type</th><td>${priority}</td><th>Page</th><td>${i + 1} / ${total}</td></tr>
                    </tbody>
                </table>
                <table class="req-preview-group">
                    <tbody>
                        <tr><th>SPARE Group No.</th><td colspan="3">${esc(h.pmsGroupNo || g.key)}</td></tr>
                        <tr><th>Machinery Name</th><td>${esc(h.machineryName || '—')}</td><th>Model / Type</th><td>${esc(h.modelType || '—')}</td></tr>
                        <tr><th>Maker</th><td>${esc(h.maker || '—')}</td><th>Capacity</th><td>${esc(h.capacity || '—')}</td></tr>
                        <tr><th>Ass'y Name</th><td>${esc(h.assyName || '—')}</td><th>Dwg. No.</th><td>${esc(h.dwgNo || '—')}</td></tr>
                    </tbody>
                </table>
                <table class="req-preview-items">
                    <thead><tr>
                        <th>Code</th><th>Class</th><th>Item</th><th>Part No.<br>(Code No.)</th><th>Unit</th>
                        <th title="${SPARE_COL_WORK_TITLE}">${SPARE_COL_WORK}</th><th title="${SPARE_COL_STD_TITLE}">${SPARE_COL_STD}</th><th title="${SPARE_COL_ROB_TITLE}">${SPARE_COL_ROB}</th><th title="${SPARE_COL_WAIT_TITLE}">${SPARE_COL_WAIT}</th><th title="${SPARE_COL_NEED_TITLE}">${SPARE_COL_NEED}</th><th title="${SPARE_COL_REQ_TITLE}">${SPARE_COL_REQ}</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        }).join('');
    }

    function renderReqPreviewHtml(st, req, vesselName) {
        if (!req) return '';
        const pages = buildReqPreviewPagesHtml(st, req, vesselName);
        return `
        <div class="spare-req-work-wrap req-preview-wrap">
          <div class="spare-req-work-head">
            <h3 class="spare-req-work-title">Preview</h3>
            <span class="spare-req-work-head-spacer"></span>
            <button type="button" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.reqWorkPrintPreview()">🖨 Print</button>
            <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.closeReqWorkModal()">Close</button>
            <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeReqWorkModal()">×</button>
          </div>
          <div class="spare-req-work-scroll req-preview-scroll">
            <div class="req-preview-pages">${pages}</div>
          </div>
        </div>`;
    }

    function reqPreviewPrintStyles() {
        return `
            *{box-sizing:border-box}
            body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#111;margin:0;padding:0;background:#fff}
            .req-preview-page{padding:16mm 12mm;page-break-after:always}
            .req-preview-page:last-child{page-break-after:auto}
            .req-preview-doc-title{text-align:center;font-size:18px;font-weight:700;color:#003366;letter-spacing:2px;margin:0 0 12px}
            table{width:100%;border-collapse:collapse;margin-bottom:10px}
            .req-preview-meta th,.req-preview-meta td,.req-preview-group th,.req-preview-group td{border:1px solid #666;padding:4px 6px;font-size:11px;text-align:left;vertical-align:middle}
            .req-preview-meta th,.req-preview-group th{background:#eef2f7;width:14%;white-space:nowrap;font-weight:700}
            .req-preview-items th,.req-preview-items td{border:1px solid #666;padding:3px 5px;font-size:10.5px}
            .req-preview-items th{background:#dde5ef;text-align:center;font-weight:700}
            .req-preview-items td{text-align:center}
            .req-preview-items td.rpv-item{text-align:left}
            .req-preview-items td.rpv-req{font-weight:700}`;
    }

    async function buildReqPrintDocument(reqId) {
        const { st, vesselId } = await vesselScope();
        const req = await TVC_Inventory.getRequisition(reqId);
        if (!req) return null;
        const vesselName = await vesselLabel(vesselId, req.department || st.user?.department);
        const lineRows = (req.lines || []).map(l => `<tr>
            <td>${esc(l.part_no)}</td><td>${esc(l.name)}</td>
            <td style="text-align:center">${l.qty_requested ?? ''}</td>
            <td style="text-align:right">${l.price != null ? l.price : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;padding:12px">No lines</td></tr>';
        return `
            <h2 style="text-align:center;color:#003366;margin:0 0 12px">${esc(vesselName)} — Parts Requisition</h2>
            <p><strong>Requisition No:</strong> ${esc(req.req_no)} · <strong>Status:</strong> ${esc(req.status)}</p>
            <p><strong>Priority:</strong> ${esc(req.priority || 'ROUTINE')} · <strong>Reported Date:</strong> ${esc(req.made_on || '—')} · <strong>by:</strong> ${esc(req.made_by || req.creator_name || '—')}</p>
            ${req.remarks ? `<p><strong>Remarks:</strong> ${esc(req.remarks)}</p>` : ''}
            <table><thead><tr><th>Part No</th><th>Name</th><th>Qty</th><th>Price</th></tr></thead>
            <tbody>${lineRows}</tbody></table>`;
    }

    function openReqPrintWindow(html, { print = false } = {}) {
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) { alert('Popup blocked. Please allow popups in your browser.'); return null; }
        w.document.write(`<!DOCTYPE html><html><head><title>Parts Requisition</title>
            <style>body{font-family:Segoe UI,Arial,sans-serif;font-size:12px;padding:16px}
            table{width:100%;border-collapse:collapse;margin-top:12px} th,td{border:1px solid #999;padding:4px 6px}
            th{background:#ddd;text-align:left}</style></head><body>${html}</body></html>`);
        w.document.close();
        w.focus();
        if (print) w.print();
        return w;
    }

    async function reqListPreview() {
        const id = modState(getState()).selectedReqId;
        if (!id) return alert('Select a requisition.');
        closeReqListModal();
        await startReqWorkPreviewSession(id);
    }

    async function reqListDetailReport() {
        return reqListPreview();
    }

    async function reqListDocPreview() {
        const body = await buildRequisitionListPrintBody();
        openSpareListPrintWindow('Requisition List', body, true);
    }

    async function reqListReportConfirm() {
        const st = getState();
        const m = modState(st);
        const { vesselId } = await vesselScope();
        const allReqs = await TVC_Inventory.listRequisitions(vesselId);
        const checkedIds = Object.keys(m.reqListCheckedIds || {}).filter(k => m.reqListCheckedIds[k]);
        const idsToConfirm = checkedIds.length
            ? reqListCheckedConfirmableIds(m, allReqs, st)
            : [];
        if (!idsToConfirm.length) {
            if (checkedIds.length) {
                return alert('None of the selected requisitions can be confirmed. Only Reported requisitions can be confirmed, and you need Chief Engineer / Captain / Superintendent permission.');
            }
            return alert('Check one or more Reported requisitions to confirm.');
        }
        const loadedId = _reqSheet.reqId || _reqWorkDraft?.id;
        let confirmed = 0;
        let needReload = false;
        for (const id of idsToConfirm) {
            const req = await TVC_Inventory.getRequisition(id);
            if (!req || !reqListCanConfirm(st, req)) continue;
            req.confirmed_by = requisitionConfirmByLabel(st, req);
            req.confirmed_at = new Date().toISOString();
            req.list_status = SPARE_LIST_STATUS.CONFIRMED;
            await TVC_Inventory.saveRequisition(req);
            confirmed++;
            if (loadedId === id) needReload = true;
        }
        if (needReload && isRequisitionListWindow(m)) {
            await loadRequisitionIntoListWindow(loadedId);
        }
        await refreshReqListUi();
        await syncReportedWaitAndRefreshList();
        const skipped = checkedIds.length - confirmed;
        if (skipped > 0) {
            alert(`Confirmed ${confirmed} requisition(s). Skipped ${skipped} (not Reported or no permission).`);
        } else {
            alert(`Confirmed ${confirmed} requisition(s).`);
        }
    }

    async function reqListExportToMaster() {
        const st = getState();
        const m = modState(st);
        const xferKind = _reqListXferExportKind;
        if (xferKind === 'received') {
            if (!canCreateDeliver(st)) return alert('No permission to export received data.');
        } else if (xferKind === 'requisition') {
            if (!canCreateRequisition(st)) return alert('No permission to export requisitions.');
        } else if (!canCreateRequisition(st)) {
            return alert('No permission to export requisitions.');
        }
        const { vesselId } = await vesselScope();
        const allReqs = await TVC_Inventory.listRequisitions(vesselId);
        const ids = reqListCheckedExportableIds(m, allReqs);
        const statusLabel = xferKind === 'received' ? 'Received' : 'Confirmed';
        if (!ids.length) {
            const anyChecked = Object.keys(m.reqListCheckedIds || {}).some(k => m.reqListCheckedIds[k]);
            if (anyChecked) return alert(`Only ${statusLabel} requisitions can be exported.`);
            return alert('Select one or more requisitions to export.');
        }
        const skipped = Object.keys(m.reqListCheckedIds || {}).filter(k => m.reqListCheckedIds[k] && !ids.includes(k));
        const confirmTarget = xferKind === 'received' ? 'received requisition(s)' : 'requisition(s)';
        if (skipped.length) {
            const skipNos = skipped.map(id => allReqs.find(r => r.id === id)?.req_no || id).join(', ');
            if (!window.confirm(`${skipped.length} non-${statusLabel} item(s) will be skipped (${skipNos}).\n\nExport ${ids.length} ${confirmTarget} to Master?`)) return;
        } else if (!window.confirm(`Export ${ids.length} ${confirmTarget} to Master?`)) {
            return;
        }
        let ok = 0;
        for (const id of ids) {
            try {
                if (xferKind === 'received') await exportReceivedReq(id);
                else await exportReq(id);
                ok++;
            } catch (e) {
                alert(`Export failed: ${e.message || e.code || id}`);
            }
        }
        if (ok) {
            if (xferKind) {
                await logSpareDataXfer({
                    direction: 'EXPORT',
                    category: xferKind === 'received' ? SPARE_XFER_EXPORT.RECEIVED : SPARE_XFER_EXPORT.REQUISITION,
                    summary: xferKind === 'received'
                        ? `${ok} received requisition(s) exported`
                        : `${ok} requisition(s) exported`,
                    count: ok,
                });
                _reqListXferExportKind = null;
                closeReqListModal();
            }
            alert(xferKind === 'received'
                ? `Exported ${ok} received requisition(s) to Master.`
                : `Exported ${ok} requisition(s) to Master.`);
        }
    }

    async function reqListPrint() {
        const body = await buildRequisitionListPrintBody();
        openSpareListPrintWindow('Requisition List', body, false);
    }

    function focusSpareRow(id) {
        if (window.TVC_App?.focusSpareRow) return TVC_App.focusSpareRow(id);
        const st = getState();
        setFocusedSpareId(st, id);
        refreshList();
    }

    function selectSpareRow(id) { focusSpareRow(id); }

    async function openDetail(id) {
        const st = getState();
        const m = modState(st);
        setFocusedSpareId(st, id);
        m.panelOpen = true;
        updatePanelLayout(true);
        if (vl) vl.refresh();
        refreshSpareGroupHeader();
        syncSpareToolbarUi();
        const canRequisition = window.TVC_RBAC && st.user && TVC_RBAC.can(st.user, TVC_RBAC.Action.CREATE_REQUISITION);
        const canModify = canModifySpare(st);
        await renderDetailPanel(id, canRequisition, canModify);
    }

    function closeDetail() {
        const st = getState();
        const m = modState(st);
        m.panelOpen = false;
        updatePanelLayout(false);
        const inner = document.getElementById('spareDetailInner');
        if (inner) inner.innerHTML = '';
        if (vl) vl.refresh();
        syncSpareToolbarUi();
    }

    function openSpareModify() {
        if (reqWorkSpareActionBlocked()) return;
        if (isInlineEditing(getState())) return saveInlineEdit();
        if (window.TVC_App?.openSpareModify) return TVC_App.openSpareModify();
        const ids = spareActionIds('modify');
        if (!ids.length) return alert('Select a part to edit (click row or use checkbox).');
        if (getCheckedSpareIds(getState()).length > 1) return alert('Modify allows only one selected item.');
        edit(ids[0]);
    }

    function openSpareAppend() {
        if (reqWorkSpareActionBlocked()) return;
        if (window.TVC_App?.openSpareAppend) return TVC_App.openSpareAppend();
        if (!canModifySpare(getState())) {
            return alert('Chief Engineer / Captain permission required.');
        }
        append();
    }

    async function deleteSpareItems(ids) {
        const st = getState();
        const list = (ids || []).filter(Boolean);
        if (!list.length) return alert('Select part(s) to delete (click row or use checkbox).');
        const labels = list.map(id => {
            const s = (st.spares || []).find(x => x.id === id);
            return s ? (s.part_no || s.name || id) : id;
        });
        const preview = labels.slice(0, 5).join(', ') + (labels.length > 5 ? ` and ${labels.length - 5} more` : '');
        if (!confirm(`Delete ${list.length} selected part(s)?\n\n${preview}\n\nThis cannot be undone.`)) return;
        try {
            const user = spareInventoryUser(st);
            for (const id of list) await TVC_Inventory.deleteSpare(user, id);
            if (!st.spareListSelected) st.spareListSelected = {};
            list.forEach(id => delete st.spareListSelected[id]);
            if (list.includes(getFocusedSpareId(st))) setFocusedSpareId(st, null);
            modState(st).panelOpen = false;
            st._spareEdit = null;
            await refresh();
            afterSpareListChange(st);
            if (window.TVC_App?.syncSpareItemToolbar) TVC_App.syncSpareItemToolbar();
            alert(`${list.length} part(s) deleted.`);
        } catch (e) { alert(e.message || e.code || 'Delete failed'); }
    }

    async function deleteSpareItem() {
        if (reqWorkSpareActionBlocked()) return;
        if (window.TVC_App?.deleteSpareItem) return TVC_App.deleteSpareItem();
        return deleteSpareItems(spareActionIds('delete'));
    }

    // ── Actions ───────────────────────────────────────────────────────
    async function createRequisition(spareId) {
        const { st, vesselId } = await vesselScope();
        const s = (st.spares || []).map(canon).find(x => x.id === spareId);
        if (!s) return;
        const qty = TVC_Inventory.recommendedOrderQty(s) || 1;
        try {
            const req = await TVC_Inventory.createRequisition(st.user, {
                vesselId, spares: [s], qtyMap: { [s.id]: qty },
            });
            alert(`Requisition created: ${req.req_no}`);
            await refresh();
            await openReqListModal({ selectId: req.id });
        } catch (e) { alert(e.message || e.code); }
    }

    async function assignToTask(spareId) {
        const st = getState();
        const s = (st.spares || []).map(canon).find(x => x.id === spareId);
        if (!s) return;
        const jobCode = prompt(`JOB CODE에 "${partNo(s)}" 할당\n\nJob Code:`, '');
        if (!jobCode || !jobCode.trim()) return;
        const qty = parseInt(prompt('Qty per job:', '1') || '1', 10) || 1;
        try {
            await TVC_Inventory.addBomLine(jobCode.trim().toUpperCase(), spareId, qty);
            alert(`BOM linked: ${jobCode.trim().toUpperCase()} · qty ${qty}`);
            openDetail(spareId);
        } catch (e) { alert(e.message || e.code); }
    }

    async function suggestRequisition(alerts) {
        if (!alerts || !alerts.length) return;
        const lines = alerts.map(a =>
            `• ${a.partNo || '—'} — ${a.name || ''} (재고 ${a.stock} / Min ${a.minStock ?? a.standard})`
        ).join('\n');
        const job = alerts[0]?.jobCode ? `\n\nJob: ${alerts[0].jobCode}` : '';
        if (!confirm(`Stock is below Min Stock.\n\n${lines}${job}\n\nCreate a requisition in the SPARE tab?`)) return;
        const st = getState();
        const m = modState(st);
        if (alerts[0]?.sparePartId) { setFocusedSpareId(getState(), alerts[0].sparePartId); modState(getState()).panelOpen = true; }
        m.spareFilter = 'lowStock';
        m.showLowOnly = true;
        if (window.TVC_App?.switchTab) TVC_App.switchTab('spare');
        await refresh();
        await render();
        await openReqListModal();
    }

    function append() {
        startInlineAppend();
    }

    function startInlineAppend() {
        const st = getState();
        const m = modState(st);
        st._spareEdit = null;
        const editorWrap = document.getElementById('spareEditorWrap');
        if (editorWrap) editorWrap.innerHTML = '';
        m.inlineEditId = NEW_SPARE_EDIT_ID;
        m.inlineDraft = {
            header: resolveAppendGroupHeader(st),
            row: {
                code: '',
                class: '',
                item: '',
                partNo: '',
                unit: 'EA',
                working: '0',
                standard: '0',
            },
        };
        setFocusedSpareId(st, null);
        closeDetail();
        afterSpareListChange(st);
    }

    function startInlineEdit(id) {
        const st = getState();
        const raw = (st.spares || []).find(s => s.id === id);
        if (!raw) return;
        const s = canon(raw);
        setFocusedSpareId(st, id);
        const m = modState(st);
        m.groupHeaderEdit = false;
        m.groupHeaderDraft = null;
        m.groupHeaderEditKey = null;
        m.inlineEditId = id;
        m.inlineDraft = {
            header: resolveSpareGroupHeader(st),
            row: {
                code: spareNumbering(s),
                class: spareClass(s) === '—' ? '' : spareClass(s),
                item: s.name || '',
                partNo: spareDrawingNo(s),
                unit: spareUnit(s),
                working: String(spareWorking(s)),
                standard: String(spareStandardQty(s)),
            },
        };
        st._spareEdit = null;
        const editorWrap = document.getElementById('spareEditorWrap');
        if (editorWrap) editorWrap.innerHTML = '';
        closeDetail();
        afterSpareListChange(st);
    }

    function toggleEditGroupPick(ev) {
        ev?.stopPropagation();
        const wrap = document.getElementById('sghGroupSelect');
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        document.querySelectorAll('.spare-gh-group-select.open').forEach(el => {
            if (el !== wrap) el.classList.remove('open');
        });
        wrap.classList.toggle('open', opening);
        if (opening) {
            const selected = wrap.querySelector('.spare-gh-group-item.selected');
            if (selected) selected.scrollIntoView({ block: 'nearest' });
            const close = (e) => {
                if (!wrap.contains(e.target)) {
                    wrap.classList.remove('open');
                    document.removeEventListener('click', close);
                }
            };
            setTimeout(() => document.addEventListener('click', close), 0);
        }
    }

    function pickEditGroup(label) {
        const st = getState();
        const groupLabel = String(label || '').trim();
        const hidden = document.getElementById('sgh_pmsGroupNo');
        if (hidden) hidden.value = groupLabel;
        const text = document.querySelector('.spare-gh-group-trigger-text');
        if (text) text.textContent = groupLabel ? safeTreeLabel(groupLabel) : '— Select GROUP —';
        document.querySelectorAll('.spare-gh-group-item').forEach(el => {
            el.classList.toggle('selected', el.dataset.groupLabel === groupLabel);
        });
        document.getElementById('sghGroupSelect')?.classList.remove('open');
        const header = enrichSpareHeaderFields(st, {
            pmsGroupNo: groupLabel,
            machineryName: '',
            modelType: '',
            capacity: '',
            maker: '',
            assyName: '',
            dwgNo: '',
        }, null);
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        set('sgh_modelType', header.modelType);
        set('sgh_capacity', header.capacity);
        set('sgh_maker', header.maker);
        set('sgh_serialNo', header.serialNo);
        const m = modState(st);
        // 헤더 UI에서 제거된 필드는 draft에 보존해 저장 시 반영되도록 한다.
        if (m.inlineDraft?.header) {
            m.inlineDraft.header.pmsGroupNo = groupLabel;
            m.inlineDraft.header.machineryName = header.machineryName || '';
            m.inlineDraft.header.assyName = header.assyName || '';
            m.inlineDraft.header.dwgNo = header.dwgNo || '';
        }
    }

    function cancelInlineEdit() {
        const st = getState();
        const m = modState(st);
        m.inlineEditId = null;
        m.inlineDraft = null;
        afterSpareListChange(st);
    }

    // ── 그룹 단위 헤더 편집 ────────────────────────────────────────────
    function groupSelectedNode(st) {
        const key = st.selectedGroupKey;
        if (!key || key === CRITICAL_GROUP_KEY || key === MERGED_GEN_ENGINE_KEY) return null;
        return st.idx?.groupNodes?.find(n => n.key === key) || null;
    }

    function canEditGroupHeader(st) {
        if (canModifySpare(st)) return true;
        const user = spareInventoryUser(st);
        return !!(user && window.TVC_RBAC?.canModifyOriginalPlan?.(user));
    }

    function canDeleteSelectedGroup(st) {
        const key = st.selectedGroupKey;
        const node = groupSelectedNode(st);
        return !!node && key !== CRITICAL_GROUP_KEY && key !== MERGED_GEN_ENGINE_KEY;
    }

    function renderSpareTreeActionBtns(st) {
        if (!canEditGroupHeader(st)) return '';
        const canDelete = canDeleteSelectedGroup(st);
        return `<span class="spare-tree-actions">
            <button type="button" class="spare-tree-action-btn" onclick="TVC_SpareMenu.startGroupHeaderEdit()" title="Modify group equipment info" aria-label="Modify">✏️</button>
            <button type="button" class="spare-tree-action-btn" onclick="TVC_SpareMenu.appendGroupFromTree()" title="Add group" aria-label="Append">➕</button>
            <button type="button" class="spare-tree-action-btn" onclick="TVC_SpareMenu.deleteGroupFromTree()" title="Delete empty group" aria-label="Delete"${canDelete ? '' : ' disabled'}>🗑</button>
        </span>`;
    }

    function appendGroupFromTree() {
        if (!canEditGroupHeader(getState())) return alert('Chief Engineer / Captain permission required.');
        if (window.TVC_App?.openOrigGroupAdd) return TVC_App.openOrigGroupAdd();
        alert('Group append is unavailable.');
    }

    async function deleteGroupFromTree() {
        const st = getState();
        if (!canEditGroupHeader(st)) return alert('Chief Engineer / Captain permission required.');
        const node = groupSelectedNode(st);
        if (!canDeleteSelectedGroup(st)) return alert('Select a group to delete.');
        if (!confirm(`Delete GROUP "${node.label}"?\n\nOnly empty groups (no jobs, no spare parts) can be deleted.`)) return;
        const user = spareInventoryUser(st) || st.user;
        if (!user) return alert('Login required.');
        try {
            await TVC_MaintenancePlan.deleteGroup(user, node.department, node.label);
            st.selectedGroupKey = null;
            await refresh();
            await render();
            alert('Group deleted.');
        } catch (e) {
            const code = e.code || '';
            if (code === 'HAS_JOBS') return alert(`Cannot delete: ${e.count || ''} maintenance job(s) in this group.`);
            if (code === 'HAS_SPARES') return alert('Cannot delete: spare parts exist in this group.');
            alert(e.message || code || 'Delete failed');
        }
    }

    function startGroupHeaderEdit() {
        const st = getState();
        if (!canEditGroupHeader(st)) return alert('Chief Engineer / Captain permission required.');
        const key = st.selectedGroupKey;
        const treeName = st.currentTab === 'actual'
            ? 'PMS GROUP Tree' : 'SPARE GROUP Tree';
        if (!key || key === CRITICAL_GROUP_KEY) {
            return alert(`${treeName} — select a group to edit first.`);
        }
        if (window.TVC_App?.isOrigJobInlineEditing?.() && window.TVC_App?.cancelOrigJobInlineEdit) {
            TVC_App.cancelOrigJobInlineEdit();
        }
        const m = modState(st);
        m.inlineEditId = null;
        m.inlineDraft = null;
        setFocusedSpareId(st, null);
        const header = resolveSpareHeaderFromGroup(st);
        m.groupHeaderEdit = true;
        m.groupHeaderEditKey = key;
        m.groupHeaderDraft = header;
        afterSpareListChange(st);
    }

    function cancelGroupHeaderEdit() {
        const st = getState();
        const m = modState(st);
        m.groupHeaderEdit = false;
        m.groupHeaderDraft = null;
        m.groupHeaderEditKey = null;
        afterSpareListChange(st);
    }

    async function saveGroupHeaderEdit() {
        const st = getState();
        const m = modState(st);
        if (!m.groupHeaderEdit) return;
        if (!canEditGroupHeader(st)) return alert('Chief Engineer / Captain permission required.');
        const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
        const draft = m.groupHeaderDraft || {};
        const key = st.selectedGroupKey;
        const isMerged = key === MERGED_GEN_ENGINE_KEY;
        const node = groupSelectedNode(st);
        const dept = node?.department || st.department || '';
        const oldLabel = String(draft.pmsGroupNo || node?.label || '').trim();
        const newLabelInput = g('sgh_g_pmsGroupNo') || oldLabel;
        // 병합 그룹(03~05)은 가상 라벨이므로 라벨 rename을 허용하지 않는다(개별 그룹 라벨 보존).
        const labelChanged = !isMerged && !!newLabelInput && newLabelInput !== oldLabel;
        const newLabel = labelChanged ? newLabelInput : oldLabel;
        const header = {
            pmsGroupNo: newLabel,
            // Machinery Name / Ass'y Name / Dwg. No.는 헤더 UI에서 제거됨 → 기존 값 보존
            machineryName: draft.machineryName || '',
            modelType: g('sgh_g_modelType'),
            capacity: g('sgh_g_capacity'),
            maker: g('sgh_g_maker'),
            serialNo: g('sgh_g_serialNo'),
            criticalEquipment: document.getElementById('sgh_g_criticalEquipment')
                ? g('sgh_g_criticalEquipment')
                : (draft.criticalEquipment || ''),
            assyName: draft.assyName || '',
            dwgNo: draft.dwgNo || '',
        };
        const groupSpares = sparesInSelectedGroup(st);
        try {
            // 컴포넌트/상위 장비 헤더 갱신 (기존 라벨로 조회 → 새 라벨로 rename)
            const sampleRow = TVC_SpareSchema.toRow(groupSpares[0] || { group: oldLabel });
            sampleRow.group = oldLabel;
            // 각 아이템이 참조하는 상위 장비 컴포넌트도 함께 갱신해야 아이템 클릭 시 헤더에 반영됨
            const itemComponentIds = new Set();
            groupSpares.forEach(s => {
                const pid = s.parentEquipmentID || s.parent_equipment_id;
                if (pid) itemComponentIds.add(pid);
            });
            await saveGroupHeaderMeta(st, header, sampleRow, {
                renameLabel: labelChanged,
                itemComponentIds: [...itemComponentIds],
            });

            // 그룹 헤더 메타를 maintenance_groups에 영속 저장
            // (GROUP 컴포넌트/상위 장비가 없어도 헤더에 확실히 반영되도록 하는 authoritative 저장소)
            const defs = await TVC_DB.getAll('maintenance_groups').catch(() => []);
            const norm = normalizeGroupLabel;
            // 병합 그룹(03~05)은 가상 라벨로 저장하면 Original Plan 트리에 유령 노드가 생기므로
            // 실제 개별 gen-engine 라벨(03/04/05)에 저장한다. 일반 그룹은 자기 라벨에 저장.
            let targetLabels;
            if (isMerged) {
                targetLabels = (st.idx?.groupNodes || [])
                    .filter(n => (!dept || n.department === dept) && isGeneratorEngineGroupLabel(n.label))
                    .map(n => n.label);
                if (!targetLabels.length) targetLabels = [oldLabel];
            } else {
                targetLabels = [newLabel];
            }
            for (const lab of [...new Set(targetLabels.filter(Boolean))]) {
                const existing = (defs || []).find(gr => (!dept || gr.department === dept) && norm(gr.label) === norm(lab));
                const critEl = document.getElementById('sgh_g_criticalEquipment');
                const defBase = existing || {
                    id: 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                    department: dept,
                    label: lab,
                    sort_order: 0,
                    created_at: new Date().toISOString(),
                };
                await TVC_DB.put('maintenance_groups', {
                    ...defBase,
                    label: lab,
                    // 입력값을 그대로 저장(빈 값 포함) — 지우기가 반영되도록, header_edited로 authoritative 표시
                    machinery_name: header.machineryName || '',
                    model_type: header.modelType || '',
                    maker: header.maker || '',
                    capacity: header.capacity || '',
                    dwg_no: header.dwgNo || '',
                    serial_no: header.serialNo || '',
                    is_critical_equipment: critEl
                        ? parseCriticalEquipmentValue(header.criticalEquipment)
                        : (existing?.is_critical_equipment ?? null),
                    header_edited: true,
                    updated_at: new Date().toISOString(),
                    sync_status: 'LOCAL',
                });
            }

            // SPARE Group No. 변경 시: 유지보수 작업/그룹 정의의 라벨도 함께 rename (GROUP Tree 일관성)
            if (labelChanged) {
                const jobs = await TVC_DB.getAll('maintenance_jobs');
                const jchg = jobs
                    .filter(j => String(j.group || '').trim() === oldLabel && (!dept || j.department === dept))
                    .map(j => ({ ...j, group: newLabel }));
                if (jchg.length) await TVC_DB.bulkPut('maintenance_jobs', jchg);
                const grps = await TVC_DB.getAll('maintenance_groups').catch(() => []);
                const gchg = (grps || [])
                    .filter(gr => String(gr.label || '').trim() === oldLabel && (!dept || gr.department === dept))
                    .map(gr => ({ ...gr, label: newLabel }));
                if (gchg.length) await TVC_DB.bulkPut('maintenance_groups', gchg);
            }

            // 그룹 내 모든 아이템에 Model/Maker 일괄 적용 (값이 있을 때만 덮어써 기존 값 보존)
            const rows = groupSpares.map(s => {
                const patch = { ...s };
                if (header.modelType) patch.model = header.modelType;
                if (header.maker) patch.maker = header.maker;
                if (labelChanged) patch.group = newLabel;
                return TVC_SpareSchema.toRow(patch);
            });
            if (rows.length) {
                if (typeof TVC_DB?.bulkPut === 'function') await TVC_DB.bulkPut('spare_parts', rows);
                else { const u = spareInventoryUser(st); for (const r of rows) await TVC_Inventory.saveSpare(u, r); }
            }
            m.groupHeaderEdit = false;
            m.groupHeaderDraft = null;
            m.groupHeaderEditKey = null;
            await refresh();
            // rename 되었으면 새 라벨 그룹을 다시 선택
            if (labelChanged) st.selectedGroupKey = `${dept}|${newLabel}`;
            afterSpareListChange(st);
            if (window.TVC_App?.syncSpareItemToolbar) TVC_App.syncSpareItemToolbar();
            alert(`Group header saved (${rows.length} item(s) updated)`);
        } catch (e) { alert(e.message || e.code || 'Save failed'); }
    }

    async function saveGroupHeaderMeta(st, header, spare, opts = {}) {
        if (!window.TVC_DB) return;
        const renameLabel = opts.renameLabel !== false;
        const ts = new Date().toISOString();
        const patchComp = (c) => ({
            ...c,
            machinery_name: header.machineryName || c.machinery_name,
            model_type: header.modelType || c.model_type,
            model: header.modelType || c.model,
            maker: header.maker || c.maker,
            capacity: header.capacity || c.capacity,
            dwg_no: header.dwgNo || c.dwg_no,
            drawing_no: header.dwgNo || c.drawing_no,
            serial_no: header.serialNo || c.serial_no,
            remarks: header.capacity || c.remarks,
            updated_at: ts,
            sync_status: 'LOCAL',
        });

        const groupLabels = groupLabelsForPmsGroup(header.pmsGroupNo || spare.group, st, st.selectedGroupKey);
        // 라벨 변경 시(현재 아이템의 기존 group 라벨로도 조회) 기존 컴포넌트를 찾아 rename
        if (spare.group && !groupLabels.includes(spare.group)) groupLabels.push(spare.group);
        // 병합 그룹은 여러 컴포넌트(03/04/05)가 있을 수 있으므로 매칭되는 모든 GROUP 컴포넌트를 갱신
        const normSet = new Set(groupLabels.map(normalizeGroupLabel));
        const comps = (st.components || []).filter(c =>
            c.node_type === 'GROUP' && normSet.has(normalizeGroupLabel(c.label || c.component_name || c.component_code)));
        const primaryComp = comps[0] || findGroupComponent(st, groupLabels);
        const targetComps = comps.length ? comps : (primaryComp ? [primaryComp] : []);
        for (const comp of targetComps) {
            const row = renameLabel
                ? patchComp({ ...comp, label: header.pmsGroupNo || comp.label, component_name: header.pmsGroupNo || comp.component_name })
                : patchComp(comp);
            await TVC_DB.put('ship_components', row);
        }

        const parentIds = new Set();
        targetComps.forEach(c => { if (c.parent_id) parentIds.add(c.parent_id); });
        if (!parentIds.size && (spare.parentEquipmentID || spare.parent_equipment_id)) {
            parentIds.add(spare.parentEquipmentID || spare.parent_equipment_id);
        }
        // 그룹 내 아이템들이 직접 참조하는 상위 장비 컴포넌트도 포함 (아이템 클릭 헤더 반영)
        (opts.itemComponentIds || []).forEach(id => { if (id) parentIds.add(id); });
        const compIds = new Set(targetComps.map(c => c.id));
        for (const pid of parentIds) {
            if (compIds.has(pid)) continue; // 이미 위에서 갱신한 GROUP 컴포넌트는 건너뜀
            const parent = findComponentById(st, pid);
            if (parent) {
                await TVC_DB.put('ship_components', patchComp({
                    ...parent,
                    machinery_name: header.machineryName || parent.machinery_name,
                }));
            }
        }

        const secCode = sectionCodeFromPartNo(spare.part_no);
        if (secCode && header.assyName) {
            const secComp = (st.components || []).find(c => c.component_code === secCode);
            if (secComp) {
                await TVC_DB.put('ship_components', {
                    ...secComp,
                    label: header.assyName,
                    component_name: header.assyName,
                    updated_at: ts,
                    sync_status: 'LOCAL',
                });
            }
        }
    }

    async function saveInlineEdit() {
        const st = getState();
        const m = modState(st);
        const id = m.inlineEditId;
        if (!id) return;
        const isNew = isNewInlineEdit(st);
        const raw = isNew ? null : (st.spares || []).find(s => s.id === id);
        if (!isNew && !raw) return;

        const g = (elId) => { const el = document.getElementById(elId); return el ? el.value : ''; };
        // 헤더에서 제거된 필드(Machinery Name / Ass'y Name / Dwg. No.)는 편집 시작 시점의 값을 보존한다.
        const dh = (m.inlineDraft && m.inlineDraft.header) || {};
        const header = {
            pmsGroupNo: g('sgh_pmsGroupNo').trim(),
            machineryName: (dh.machineryName || '').trim(),
            modelType: g('sgh_modelType').trim(),
            capacity: g('sgh_capacity').trim(),
            maker: g('sgh_maker').trim(),
            serialNo: g('sgh_serialNo').trim(),
            assyName: (dh.assyName || '').trim(),
            dwgNo: (dh.dwgNo || '').trim(),
        };
        const code = g('sie_code').trim();
        const itemName = g('sie_item').trim();
        if (!header.pmsGroupNo) return alert('Select SPARE Group No.');
        if (!code) return alert('Enter Code.');
        if (!itemName) return alert('Enter Item.');
        const partClass = TVC_SpareSchema.normalizePartClass(g('sie_class'));
        if (!partClass) return alert('Select Class (G or L).');
        // 기존 캐논 객체 위에 편집값을 얹어 깨끗한 canonical → toRow(snake_case)로 저장한다.
        // (camelCase/snake_case 혼용 시 재로드에서 옛 값/0 으로 되돌아가는 문제 방지)
        const baseCanon = isNew ? TVC_SpareSchema.blank() : canon(raw);
        const updated = {
            ...baseCanon,
            makerPartNo: code,
            inventoryNumbering: code,
            name: itemName,
            partClass,
            isCritical: partClass === 'L',
            drawingPartNo: g('sie_pno').trim(),
            unit: g('sie_unit').trim() || 'EA',
            workingQty: g('sie_working'),
            standardStock: g('sie_standard'),
            category: st.department || baseCanon.category || 'ENGINE',
            group: header.pmsGroupNo,
            maker: header.maker,
            model: header.modelType,
            location: [header.pmsGroupNo, header.assyName].filter(Boolean).join(' · '),
        };
        const draft = TVC_SpareSchema.toRow(updated);

        try {
            await TVC_Inventory.saveSpare(spareInventoryUser(st), draft);
            await saveGroupHeaderMeta(st, header, draft);
            m.inlineEditId = null;
            m.inlineDraft = null;
            await refresh();
            afterSpareListChange(st);
            if (window.TVC_App?.syncSpareItemToolbar) TVC_App.syncSpareItemToolbar();
        } catch (e) { alert(e.message || e.code); }
    }

    async function edit(id) {
        startInlineEdit(id);
    }
    function cancelEdit() {
        getState()._spareEdit = null;
        const editorWrap = document.getElementById('spareEditorWrap');
        if (editorWrap) editorWrap.innerHTML = '';
        cancelInlineEdit();
    }

    async function saveEdit() {
        const st = getState();
        const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        const draft = {
            ...(st._spareEdit || {}),
            part_no: g('se_part_no').trim(),
            name: g('se_name').trim(),
            universal_code: g('se_universal_code').trim(),
            category: g('se_category').trim() || 'ENGINE',
            group: g('se_group').trim(),
            unit: g('se_unit').trim() || 'EA',
            qty_working: g('se_working_qty'),
            qty_on_hand: g('se_qty_on_hand'),
            min_qty: g('se_min_qty'),
            standard_stock: g('se_standard_stock'),
            location: g('se_location').trim(),
            price: g('se_price'),
        };
        try {
            await TVC_Inventory.saveSpare(st.user, draft);
            st._spareEdit = null;
            await refresh();
            render();
        } catch (e) { alert(e.message || e.code); }
    }

    async function saveDetailGroup(id) {
        const st = getState();
        const sel = document.getElementById('spDetailGroup');
        if (!sel) return;
        const spare = (st.spares || []).find(s => s.id === id);
        if (!spare) return;
        try {
            await TVC_Inventory.saveSpare(st.user, { ...spare, group: sel.value.trim() });
            await refresh();
            await render();
            modState(getState()).selectedId = id;
            modState(getState()).panelOpen = true;
            const canRequisition = window.TVC_RBAC && st.user && TVC_RBAC.can(st.user, TVC_RBAC.Action.CREATE_REQUISITION);
            const canModify = canModifySpare(st);
            await renderDetailPanel(id, canRequisition, canModify);
        } catch (e) { alert(e.message || e.code); }
    }

    function showImportLoading(msg) {
        let el = document.getElementById('spareImportOverlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'spareImportOverlay';
            el.className = 'spare-import-overlay';
            document.body.appendChild(el);
        }
        el.innerHTML = `<div class="spare-import-loading"><div class="spare-spinner"></div><div>${esc(msg)}</div><small>1,300+ items — Please wait</small></div>`;
        el.style.display = 'flex';
    }

    function hideImportLoading() {
        const el = document.getElementById('spareImportOverlay');
        if (el) el.style.display = 'none';
    }

    async function finishImport(st, res) {
        st.selectedGroupKey = null;
        modState(st).showLowOnly = false;
        modState(st).partNo = '';
        modState(st).description = '';
        st.spareSearch = '';
        const partCount = res.stats?.spares || res.spares?.length || res.parts?.length || 0;
        const equipCount = res.equipment || res.equipmentTree?.length || res.parsed?.equipment?.length || 0;
        st._spareImportMsg = `ENGINE ${partCount} parts · Equipment ${equipCount} nodes`;
        await refresh();
        await render();
        return res;
    }

    /**
     * loadSpareInventory — CSV/XLS 업로드 → DB 적재 → SPARE 리스트 자동 갱신
     * @param {string|File|null} [source] null이면 data/spare inventory.xls - ENGINE.csv
     */
    async function loadSpareInventory(source, opts = {}) {
        const { st } = await vesselScope();
        const silent = !!opts.silent;
        if (opts.requireAuth !== false && window.TVC_RBAC) {
            TVC_RBAC.assert(st.user, TVC_RBAC.Action.MODIFY_INVENTORY);
        }
        if (!silent) showImportLoading('Loading ENGINE spare inventory…');
        const importOpts = {
            department: 'ENGINE',
            merge: opts.merge !== false,
            onProgress: opts.onProgress || ((n, total) => showImportLoading(`Saving… ${n} / ${total}`)),
        };
        try {
            const res = await TVC_DB.loadSpareInventory(source ?? null, importOpts);
            await finishImport(st, res);
            if (!silent) {
                alert(
                    `ENGINE 재고 적재 완료 (loadSpareInventory)\n` +
                    `· ${res.stats?.spares || 0} parts\n` +
                    `· Equipment ${res.equipment} nodes (MAIN ENGINE 등 부모)\n` +
                    `· 신규 ${res.spareCreated} · 갱신 ${res.spareUpdated}`
                );
            }
            return res;
        } finally {
            if (!silent) hideImportLoading();
        }
    }

    /** SPARE 탭 진입 시 부품 500건 미만이면 번들 CSV 자동 적재 (1회) */
    async function ensureInventoryLoaded() {
        const st = getState();
        if (st._spareAutoLoadDone || (st.spares || []).length >= 500) return false;
        if (TVC_Env.isFileProtocol()) return false;
        st._spareAutoLoadDone = true;
        try {
            const res = await TVC_DB.loadSpareInventory(null, { department: 'ENGINE', merge: true });
            if (res.loaded) {
                st._spareImportMsg = `ENGINE ${res.stats?.spares || 0} parts auto-loaded`;
                await refresh();
                return true;
            }
        } catch (e) {
            console.info('[SPARE] loadSpareInventory auto-load skipped:', e.message || e.code || e);
            st._spareAutoLoadDone = false;
        }
        return false;
    }

    /** 권장: 번들 XLS → 없으면 loadSpareInventory(CSV) · file:// 는 label 클릭 */
    async function loadBundledXls() {
        if (TVC_Env.isFileProtocol()) {
            alert(
                'file:// 모드에서는 자동 Import가 불가합니다.\n\n' +
                '▶ "Select spare-inventory.xls" 버튼을 직접 클릭하세요\n' +
                '▶ 권장: npm run serve → http://localhost:3000'
            );
            return;
        }
        const { st } = await vesselScope();
        showImportLoading('ENGINE inventory loading…');
        const importOpts = {
            department: 'ENGINE',
            sheetName: 'ENGINE',
            merge: true,
            onProgress: (n, total) => showImportLoading(`Saving… ${n} / ${total}`),
        };
        try {
            if (window.TVC_RBAC) TVC_RBAC.assert(st.user, TVC_RBAC.Action.MODIFY_INVENTORY);
            let res;
            try {
                res = await TVC_DB.InventoryDB.importXlsFromUrl('data/spare-inventory.xls', importOpts);
            } catch (xlsErr) {
                const xlsMsg = xlsErr.message || xlsErr.code || '';
                if (xlsErr.code === 'NOT_FOUND' || /404|fetch|Failed to fetch/i.test(xlsMsg)) {
                    showImportLoading('XLS 없음 — ENGINE CSV (loadSpareInventory)…');
                    res = await TVC_DB.loadSpareInventory(null, importOpts);
                } else {
                    throw xlsErr;
                }
            }
            await finishImport(st, res);
            alert(
                `ENGINE 재고 Import 완료\n` +
                `· ${res.stats?.spares || res.spares?.length || 0} parts\n` +
                `· Equipment ${res.equipment} · 신규 ${res.spareCreated} · 갱신 ${res.spareUpdated}`
            );
        } catch (e) {
            hideImportLoading();
            const msg = e.message || e.code || String(e);
            if (/fetch|Failed to fetch|404|NOT_FOUND/i.test(msg)) {
                if (confirm(
                    '재고 파일을 불러올 수 없습니다.\n\n' +
                    '▶ npm run serve 로 http://localhost:3000 접속 후 재시도\n' +
                    '▶ 또는 [확인] → spare inventory.xls 직접 선택\n\n' +
                    'Select file 창을 열까요?'
                )) {
                    triggerInventoryImport();
                }
            } else {
                alert('Import failed: ' + msg);
            }
        } finally {
            hideImportLoading();
        }
    }

    function triggerInventoryImport() { document.getElementById('srInventoryImportFile')?.click(); }
    function triggerCsvUpload() { document.getElementById('srCsvUploadFile')?.click(); }
    function triggerImport(id) { _importReqId = id; document.getElementById('srImportFile')?.click(); }
    async function openReq(id) {
        const modal = document.getElementById('spareReqListModal');
        const m = modState(getState());
        if (modal && !modal.classList.contains('hidden')) {
            clearReqListUiState(m);
            applyReqListSelection(m, id);
            await renderReqListModal();
        } else await openReqListModal({ selectId: id });
    }

    /** CSV 업로드 → loadSpareInventory → 리스트 즉시 렌더 */
    async function onCsvUpload(file) {
        if (!file) return;
        try {
            await loadSpareInventory(file, { merge: true });
        } catch (e) {
            alert('CSV upload failed: ' + (e.message || e.code));
        } finally {
            const fi = document.getElementById('srCsvUploadFile');
            if (fi) fi.value = '';
        }
    }

    async function onInventoryImportFile(file) {
        if (!file) return;
        const { st } = await vesselScope();
        showImportLoading('Reading ' + file.name + '…');
        try {
            if (window.TVC_RBAC) TVC_RBAC.assert(st.user, TVC_RBAC.Action.MODIFY_INVENTORY);
            const sheet = file.name.toLowerCase().includes('deck') ? 'DECK' : 'ENGINE';
            const name = (file.name || '').toLowerCase();
            let res;
            if (name.endsWith('.csv')) {
                res = await TVC_DB.loadSpareInventory(file, {
                    department: sheet, merge: true,
                    onProgress: (n, total) => showImportLoading(`Saving… ${n} / ${total}`),
                });
            } else {
                res = await TVC_DB.InventoryDB.importXlsFile(file, {
                    department: sheet,
                    sheetName: sheet,
                    merge: true,
                    onProgress: (n, total) => showImportLoading(`Saving… ${n} / ${total}`),
                });
            }
            await finishImport(st, res);
            alert(
                `ENGINE 재고 Import 완료\n` +
                `· ${res.stats?.spares || res.spares?.length || 0} parts\n` +
                `· Equipment ${res.equipment} · 신규 ${res.spareCreated} · 갱신 ${res.spareUpdated}`
            );
        } catch (e) {
            alert('Import failed: ' + (e.message || e.code));
        } finally {
            hideImportLoading();
            document.getElementById('srInventoryImportFile').value = '';
        }
    }

    async function refreshReqListModalIfOpen() {
        const modal = document.getElementById('spareReqListModal');
        if (modal && !modal.classList.contains('hidden')) await renderReqListModal();
    }

    async function onImportFile(file) {
        if (!file || !_importReqId) return;
        const { isHq } = await vesselScope();
        try {
            const rows = await TVC_Excel.parseRequisitionFile(file);
            const res = isHq
                ? await TVC_Inventory.applyHqAdjustment(_importReqId, rows)
                : await TVC_Inventory.applyVendorQuote(_importReqId, rows);
            const req = await TVC_Inventory.getRequisition(_importReqId);
            const dbRes = await TVC_Inventory.applyExcelImport(rows, req?.req_no);
            alert(`Applied: ${res.updated}/${res.total} · DB ${dbRes.updated}/${dbRes.total}`);
            await refresh();
            await refreshReqListModalIfOpen();
            render();
        } catch (e) { alert('Import failed: ' + (e.message || e.code)); }
        finally { document.getElementById('srImportFile').value = ''; _importReqId = null; }
    }

    async function exportReceivedReq(id) {
        const { isHq } = await vesselScope();
        const req = await TVC_Inventory.getRequisition(id);
        if (!req) throw new Error('REQ_NOT_FOUND');
        if (!reqListCanReceivedExport(req)) throw new Error('Only Received requisitions can be exported.');
        await TVC_Excel.exportRequisition(req, { vendorOnly: !isHq });
        await refreshReqListModalIfOpen();
        render();
    }

    async function exportReq(id) {
        const { isHq } = await vesselScope();
        try {
            const req = await TVC_Inventory.getRequisition(id);
            if (!req) throw new Error('REQ_NOT_FOUND');
            if (!reqListCanMasterExport(req)) throw new Error('Only Confirmed requisitions can be exported.');
            await TVC_Excel.exportRequisition(req, { vendorOnly: !isHq });
            const listSt = spareListStatus(req);
            if (listSt !== SPARE_LIST_STATUS.DRAFT) {
                await TVC_Inventory.setStatus(id, TVC_Inventory.REQ_STATUS.SUBMITTED);
            } else if (req.status === TVC_Inventory.REQ_STATUS.DRAFT) {
                await TVC_Inventory.setStatus(id, TVC_Inventory.REQ_STATUS.EXPORTED);
            }
            await refreshReqListModalIfOpen();
            render();
        } catch (e) { alert(e.message || e.code); }
    }

    // ── SPARE Data Export / Import (unified wizard) ─────────────────────
    const SPARE_XFER_EXPORT = {
        REQUISITION: 'REQUISITION',
        RECEIVED: 'RECEIVED',
        INVENTORY: 'INVENTORY',
    };

    function resetSpareXfer() {
        _spareXfer = { step: 'mode' };
    }

    async function logSpareDataXfer(entry) {
        const st = getState();
        const user = st.user;
        try {
            await TVC_DB.put('sync_history', {
                at: new Date().toISOString(),
                date: new Date().toLocaleString(),
                scope: 'SPARE',
                direction: entry.direction || '',
                category: entry.category || '',
                file_name: entry.file_name || '',
                summary: entry.summary || '',
                count: entry.count ?? null,
                operator_name: user?.display_name || user?.username || '',
            });
        } catch (e) { console.warn('[SPARE_XFER] log failed', e); }
    }

    async function listSpareDataXferHistory(limit = 100) {
        const rows = await TVC_DB.getAll('sync_history').catch(() => []);
        return rows
            .filter(r => r.scope === 'SPARE')
            .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
            .slice(0, limit);
    }

    function spareXferCategoryLabel(cat) {
        const map = {
            REQUISITION: 'Requisition',
            RECEIVED: 'Received',
            INVENTORY: 'Spare Parts Inventory',
            ASSESSMENT: 'Assessment',
        };
        return map[cat] || cat || '—';
    }

    function renderSpareXferModal() {
        const body = document.getElementById('spareSyncBody');
        if (!body) return;
        const step = _spareXfer.step || 'mode';
        let content = '';
        if (step === 'mode') {
            content = `
                <p class="spare-sync-hint">Choose whether to send data out or bring data in.</p>
                <div class="spare-sync-actions">
                    <button type="button" class="btn btn-green spare-sync-btn" onclick="TVC_SpareMenu.spareXferPickMode('export')">Export</button>
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_SpareMenu.spareXferPickMode('import')">Import</button>
                </div>`;
        } else if (step === 'export-type') {
            content = `
                <p class="spare-sync-hint">Select the data type to export to Master PC.</p>
                <div class="spare-sync-actions">
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_SpareMenu.spareXferOpenReqExportList()">Requisition</button>
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_SpareMenu.spareXferOpenReceivedExportList()">Received</button>
                    <button type="button" class="btn spare-sync-btn" onclick="TVC_SpareMenu.spareXferExportInventory()">Spare Parts Inventory</button>
                </div>`;
        } else if (step === 'import') {
            content = `
                <p class="spare-sync-hint">Select a file from Master PC or Company.</p>
                <p class="spare-sync-note muted">Supported: Requisition Excel (.xlsx), Assessment JSON (.json), Inventory (.xls / .xlsx / .csv). The file type is detected automatically.</p>
                <div class="spare-sync-actions">
                    <button type="button" class="btn btn-green spare-sync-btn" onclick="TVC_SpareMenu.spareXferTriggerImport()">Open file…</button>
                </div>`;
        }
        const backBtn = step !== 'mode'
            ? `<button type="button" class="btn btn-sm spare-sync-back" onclick="TVC_SpareMenu.spareXferBack()">← Back</button>`
            : '';
        const stepLabel = step === 'mode' ? '1. Export or Import'
            : step === 'export-type' ? '2. Export — select type'
                : '2. Import — select file';
        body.innerHTML = `
            <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeSpareSyncMenu()">×</button>
            <h3 class="spare-sync-title">Data Export &amp; Import</h3>
            <p class="spare-sync-step-label muted">${esc(stepLabel)}</p>
            ${content}
            <div class="modal-actions spare-sync-footer">${backBtn}
                <button type="button" class="btn" onclick="TVC_SpareMenu.closeSpareSyncMenu()">Close</button>
            </div>`;
    }

    function openSpareSyncMenu() {
        resetSpareXfer();
        renderSpareXferModal();
        showSpicsModal('spareSyncModal');
    }

    function closeSpareSyncMenu() {
        closeSpicsModal('spareSyncModal');
        resetSpareXfer();
    }

    function spareXferPickMode(mode) {
        _spareXfer.mode = mode;
        _spareXfer.step = mode === 'export' ? 'export-type' : 'import';
        renderSpareXferModal();
    }

    function spareXferBack() {
        if (_spareXfer.step === 'export-type' || _spareXfer.step === 'import') {
            _spareXfer.step = 'mode';
        }
        renderSpareXferModal();
    }

    function spareXferTriggerImport() {
        document.getElementById('spareXferImportFile')?.click();
    }

    async function spareXferOpenReqExportList() {
        const st = getState();
        if (!canCreateRequisition(st)) return alert('No permission to export requisitions.');
        const m = modState(st);
        m.reqListPhaseTab = REQ_LIST_PHASE.ALL;
        _reqListXferExportKind = 'requisition';
        closeSpareSyncMenu();
        await openReqListModal({ xferExport: 'requisition' });
    }

    async function spareXferOpenReceivedExportList() {
        const st = getState();
        if (!canCreateDeliver(st)) return alert('No permission to export received data.');
        const m = modState(st);
        m.reqListPhaseTab = REQ_LIST_PHASE.ALL;
        _reqListXferExportKind = 'received';
        closeSpareSyncMenu();
        await openReqListModal({ xferExport: 'received' });
    }

    async function spareXferExportRequisitions() {
        const { vesselId, isHq } = await vesselScope();
        const all = await TVC_Inventory.listRequisitions(vesselId);
        const exportable = all.filter(r => reqListCanMasterExport(r));
        if (!exportable.length) return alert('No Confirmed requisitions ready to export.');
        if (!window.confirm(`Export ${exportable.length} requisition(s) to Master PC?`)) return;
        try {
            let ok = 0;
            for (const req of exportable) {
                await TVC_Excel.exportRequisition(req, { vendorOnly: !isHq });
                if (spareListStatus(req) !== SPARE_LIST_STATUS.DRAFT) {
                    await TVC_Inventory.setStatus(req.id, TVC_Inventory.REQ_STATUS.SUBMITTED);
                }
                ok++;
            }
            await logSpareDataXfer({
                direction: 'EXPORT', category: SPARE_XFER_EXPORT.REQUISITION,
                summary: `${ok} requisition(s) exported`, count: ok,
            });
            closeSpareSyncMenu();
            await refreshReqListModalIfOpen();
            render();
            alert(`Exported ${ok} requisition(s).`);
        } catch (e) { alert(e.message || e.code); }
    }

    async function spareXferExportReceived() {
        const st = getState();
        if (!canCreateDeliver(st)) return alert('No permission to export received data.');
        const { vesselId, isHq } = await vesselScope();
        const reqs = (await TVC_Inventory.listRequisitions(vesselId))
            .filter(r => reqWorkflowPhase(r) === REQ_LIST_PHASE.RECEIVED || !!reqListReceivedDate(r));
        if (!reqs.length) return alert('No received requisitions to export.');
        if (!window.confirm(`Export ${reqs.length} received requisition(s) to Master PC?`)) return;
        try {
            let ok = 0;
            for (const req of reqs) {
                await TVC_Excel.exportRequisition(req, { vendorOnly: !isHq });
                ok++;
            }
            await logSpareDataXfer({
                direction: 'EXPORT', category: SPARE_XFER_EXPORT.RECEIVED,
                summary: `${ok} received requisition(s) exported`, count: ok,
            });
            closeSpareSyncMenu();
            alert(`Exported ${ok} received requisition(s).`);
        } catch (e) { alert(e.message || e.code); }
    }

    async function spareXferExportInventory() {
        const spares = (getState().spares || []).map(canon);
        if (!spares.length) return alert('No parts to export.');
        exportPartsList();
        await logSpareDataXfer({
            direction: 'EXPORT', category: SPARE_XFER_EXPORT.INVENTORY,
            summary: `${spares.length} part(s) exported (CSV)`, count: spares.length,
            file_name: `spare-parts-list-${new Date().toISOString().slice(0, 10)}.csv`,
        });
        closeSpareSyncMenu();
    }

    async function spareXferImportRequisitionExcel(file) {
        const { vesselId, isHq } = await vesselScope();
        const rows = await TVC_Excel.parseRequisitionFile(file);
        const all = await TVC_Inventory.listRequisitions(vesselId);
        const reqNoFromName = (file.name || '').match(/REQ[-\w]+/i)?.[0];
        let req = reqNoFromName ? all.find(r => String(r.req_no).toUpperCase() === reqNoFromName.toUpperCase()) : null;
        if (!req) {
            const candidates = all.filter(r => spareListStatus(r) !== SPARE_LIST_STATUS.DRAFT);
            req = candidates.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
        }
        if (!req) throw new Error('No matching requisition found. Create and complete a requisition first.');
        const importAsVendor = _reqImportMode === 'vendor-quote';
        const importAsHq = _reqImportMode === 'hq-adjustment' || (_reqImportMode !== 'vendor-quote' && isHq);
        const res = importAsVendor
            ? await TVC_Inventory.applyVendorQuote(req.id, rows)
            : importAsHq
                ? await TVC_Inventory.applyHqAdjustment(req.id, rows)
                : await TVC_Inventory.applyVendorQuote(req.id, rows);
        _reqImportMode = null;
        const dbRes = await TVC_Inventory.applyExcelImport(rows, req.req_no);
        await logSpareDataXfer({
            direction: 'IMPORT', category: SPARE_XFER_EXPORT.REQUISITION,
            file_name: file.name,
            summary: `Applied to ${req.req_no}: ${res.updated}/${res.total} lines`,
            count: res.updated,
        });
        closeSpareSyncMenu();
        await refresh();
        await refreshReqListModalIfOpen();
        render();
        alert(`Import applied to ${req.req_no}: ${res.updated}/${res.total} lines · DB ${dbRes.updated}/${dbRes.total}`);
    }

    async function onSpareXferImportFile(file) {
        if (!file) return;
        const name = (file.name || '').toLowerCase();
        try {
            if (name.endsWith('.json')) {
                _hqAssessment = await TVC_InventoryService.diffHqImport(JSON.parse(await file.text()));
                await logSpareDataXfer({
                    direction: 'IMPORT', category: 'ASSESSMENT',
                    file_name: file.name,
                    summary: `Assessment loaded (${_hqAssessment.summary?.total || 0} change(s))`,
                    count: _hqAssessment.summary?.total || 0,
                });
                closeSpareSyncMenu();
                openAssessmentModal();
                return;
            }
            if (name.endsWith('.csv') || name.endsWith('.xls')) {
                await onInventoryImportFile(file);
                await logSpareDataXfer({
                    direction: 'IMPORT', category: SPARE_XFER_EXPORT.INVENTORY,
                    file_name: file.name,
                    summary: 'Spare parts inventory file imported',
                });
                closeSpareSyncMenu();
                return;
            }
            if (name.endsWith('.xlsx')) {
                if (/inventory|spare/i.test(name)) {
                    await onInventoryImportFile(file);
                    await logSpareDataXfer({
                        direction: 'IMPORT', category: SPARE_XFER_EXPORT.INVENTORY,
                        file_name: file.name,
                        summary: 'Spare parts inventory file imported',
                    });
                    closeSpareSyncMenu();
                } else {
                    await spareXferImportRequisitionExcel(file);
                }
                return;
            }
            alert('Unsupported file type. Use .xlsx (Requisition), .json (Assessment), or .xls/.csv (Inventory).');
        } catch (e) {
            alert('Import failed: ' + (e.message || e.code));
        } finally {
            _reqImportMode = null;
            const fi = document.getElementById('spareXferImportFile');
            if (fi) fi.value = '';
        }
    }

    // ── SPARE workflow menu (4 columns) ────────────────────────────────
    function renderSpareNecessaryCol({ canModify }) {
        const item = (label, onclick, enabled = true, primary = false) =>
            enabled
                ? `<button type="button" class="spare-flow-item${primary ? ' primary' : ''}" onclick="${onclick}">${esc(label)}</button>`
                : `<button type="button" class="spare-flow-item" disabled title="No permission">${esc(label)}</button>`;
        const col = (tone, title, buttons) => `
          <section class="spare-flow-col tone-${tone}">
            <header class="spare-flow-head">${esc(title)}</header>
            <div class="spare-flow-items">${buttons}</div>
          </section>`;
        return col('necessary', 'If Necessary', [
            item('Database Backup & Restore', "TVC_App.menuAction('backup')", true),
            item('Data Export & Import', 'TVC_SpareMenu.openSpareSyncMenu()', true),
            item('View Data History', 'TVC_SpareMenu.openHistoryModal()', true),
            item('Update Spare Parts Inventory', 'TVC_SpareMenu.triggerInventoryImport()', canModify),
        ].join(''));
    }

    async function hqRequestQuotation() {
        const { vesselId } = await vesselScope();
        const all = await TVC_Inventory.listRequisitions(vesselId);
        const exportable = all.filter(r => reqListCanExport(r));
        if (!exportable.length) return alert('No requisitions ready for quotation request.');
        if (!window.confirm(`Export ${exportable.length} requisition(s) for vendor quotation?`)) return;
        try {
            for (const req of exportable) {
                await TVC_Excel.exportRequisition(req, { vendorOnly: true });
            }
            alert(`Exported ${exportable.length} requisition(s) for vendor quotation.`);
        } catch (e) { alert(e.message || e.code); }
    }

    function hqCheckQuotation() {
        _reqImportMode = 'vendor-quote';
        document.getElementById('spareXferImportFile')?.click();
    }

    function hqReplyCompanyAssessment() {
        _reqImportMode = 'hq-adjustment';
        document.getElementById('spareXferImportFile')?.click();
    }

    async function hqPurchaseOrder() {
        const { vesselId } = await vesselScope();
        const all = await TVC_Inventory.listRequisitions(vesselId);
        const RS = TVC_Inventory.REQ_STATUS;
        const ready = all.filter(r => reqListCanExport(r) && (
            r.status === RS.QUOTED || r.status === RS.HQ_REVIEW || r.status === RS.APPROVED
            || spareListStatus(r) === SPARE_LIST_STATUS.CONFIRMED
        ));
        if (!ready.length) return alert('No requisitions ready for purchase order export.');
        if (!window.confirm(`Export ${ready.length} purchase order(s)?`)) return;
        try {
            for (const req of ready) {
                await TVC_Excel.exportRequisition(req, { vendorOnly: false });
            }
            alert(`Exported ${ready.length} purchase order(s).`);
        } catch (e) { alert(e.message || e.code); }
    }

    async function hqReviewReceivedParts() {
        await openReqListModal({ phase: REQ_LIST_PHASE.RECEIVED });
    }

    function renderSpicsMenuHtml({ canConsume, canDeliver, canRequisition, canHqImport, canModify, user, isHq }) {
        const item = (label, onclick, enabled = true, primary = false) =>
            enabled
                ? `<button type="button" class="spare-flow-item${primary ? ' primary' : ''}" onclick="${onclick}">${esc(label)}</button>`
                : `<button type="button" class="spare-flow-item" disabled title="No permission">${esc(label)}</button>`;
        const col = (tone, title, buttons, longHead = false) => `
          <section class="spare-flow-col tone-${tone}">
            <header class="spare-flow-head${longHead ? ' spare-flow-head-long' : ''}">${esc(title)}</header>
            <div class="spare-flow-items">${buttons}</div>
          </section>`;

        const consumedItems = [
            item('View Consumed Log', 'TVC_SpareMenu.viewConsumedLog()', canConsume),
            item('Input Consumed Spare Parts', 'TVC_SpareMenu.openConsumeModal()', canConsume, true),
        ].join('');

        if (isHq) {
            return `
        <nav class="spare-flow-panel" aria-label="SPARE workflow">
          ${col('consume', 'Consumed', consumedItems)}
          ${col('req', 'Requisition', [
                item('View Requisition List', 'TVC_SpareMenu.viewRequisitionList()', canRequisition),
                item('Make New Requisition', 'TVC_SpareMenu.openNewRequisition()', canRequisition, true),
                item('Request Quotation', 'TVC_SpareMenu.hqRequestQuotation()', canRequisition),
                item('Check Quotation', 'TVC_SpareMenu.hqCheckQuotation()', canRequisition),
                item('Reply Company Assessment', 'TVC_SpareMenu.hqReplyCompanyAssessment()', canRequisition),
                item('Purchase Order', 'TVC_SpareMenu.hqPurchaseOrder()', canRequisition),
                item('Review Received Spare Parts', 'TVC_SpareMenu.hqReviewReceivedParts()', canDeliver),
            ].join(''))}
          ${renderSpareNecessaryCol({ canModify })}
        </nav>`;
        }

        const hasAssessment = !!_hqAssessment;
        return `
        <nav class="spare-flow-panel" aria-label="SPARE workflow">
          ${col('consume', 'Consumed', consumedItems)}
          ${col('req', 'Requisition', [
            item('View Requisition List', 'TVC_SpareMenu.viewRequisitionList()', canRequisition),
            item('Make New Requisition', 'TVC_SpareMenu.openNewRequisition()', canRequisition, true),
            item('Review Company Evaluation', 'TVC_SpareMenu.openAssessmentModal()', canHqImport && hasAssessment),
            item('Input Received Spare Parts', 'TVC_SpareMenu.openDeliverModal()', canDeliver, true),
          ].join(''))}
          ${renderSpareNecessaryCol({ canModify })}
        </nav>`;
    }

    /* ── Requisition List 창 vs New Requisition 창 (이원화) ─────────────────
     * 동일 spareReqWorkModal UI이지만 진입·제목·Requisition No. 버튼 라벨이 다름.
     *
     * Requisition List 창  — SPARE › View Requisition List  (reqWorkListMode=true)
     *   · 제목: 📋 Requisition List
     *   · Requisition No. 버튼: Select Requisition
     *
     * New Requisition 창   — SPARE › Make New Requisition   (reqWorkListMode=false)
     *   · 제목: ➕ New Requisition
     *   · Requisition No. 버튼: Requisition List
     *
     * 별도: spareReqListModal — 저장된 청구서 테이블(헤더 List 버튼 등). 위 두 창과 구분.
     * ─────────────────────────────────────────────────────────────────────── */

    function isRequisitionListWindow(m) {
        const s = m?.reqWorkListMode !== undefined ? m : modState(getState());
        return !!s.reqWorkListMode;
    }

    function isNewRequisitionWindow(m) {
        const s = m?.reqWorkOpen !== undefined ? m : modState(getState());
        return !!s.reqWorkOpen && !s.reqWorkListMode && !s.reqWorkPreview;
    }

    /** Requisition List 창 — Select Requisition / List에서 고른 청구서가 로드·표시된 상태 */
    function reqWorkListHasDisplayedReq(m) {
        const s = m?.reqWorkListMode !== undefined ? m : modState(getState());
        if (!isRequisitionListWindow(s)) return false;
        const loadedId = _reqSheet.reqId;
        if (!loadedId) return false;
        if (!_reqWorkDraft || _reqWorkDraft.id !== loadedId) return false;
        if (!String(_reqWorkDraft.req_no || '').trim()) return false;
        if (s.selectedReqId && s.selectedReqId !== loadedId) return false;
        return true;
    }

    function reqWorkHistPickBtnLabel(listMode) {
        return listMode ? 'Select Requisition' : 'Requisition List';
    }

    async function openRequisitionListWindow() {
        clearReqListUiState(modState(getState()));
        await startReqWorkSession(true, { listMode: true });
    }

    async function openNewRequisitionWindow() {
        await startReqWorkSession(true, { listMode: false });
    }

    function viewRequisitionList() {
        openRequisitionListWindow();
    }

    async function openNewRequisition() {
        await openNewRequisitionWindow();
    }

    function renderReqWorkGroupTree() {
        const st = getState();
        const root = document.getElementById('reqWorkGroupTree');
        if (!root) return;
        if (!st.idx && (st.jobs || []).length && window.TVC_Indexes) {
            st.idx = TVC_Indexes.build(st);
        }
        if (!st.idx) {
            root.innerHTML = '<div class="tree-empty muted">Loading Maintenance Plan…</div>';
            return;
        }
        const q = (st.treeSearch || '').toLowerCase();
        const matchNode = (n) => !q || (n.label || '').toLowerCase().includes(q) || (n.department || '').toLowerCase().includes(q);
        const matchCritical = !q || 'critical equipment'.includes(q) || q.includes('critical') || q.includes('crit');
        const byDept = new Map();
        (st.idx.groupNodes || [])
            .filter(n => {
                if (isHiddenSpareGroup(n.label, n.department)) return false;
                if (st.department && n.department !== st.department) return false;
                if (matchNode(n)) return true;
                return isGeneratorEngineGroupLabel(n.label) && matchMergedGeneratorSearch(q);
            })
            .forEach(n => {
                if (!byDept.has(n.department)) byDept.set(n.department, []);
                byDept.get(n.department).push(n);
            });
        const allSelected = !st.selectedGroupKey;
        let html = `<div class="tree-node${allSelected ? ' selected' : ''}" onclick="TVC_SpareMenu.reqWorkSelectGroup(null)"><span>📋 All Groups</span></div>`;
        if (matchCritical) {
            const critSel = st.selectedGroupKey === CRITICAL_GROUP_KEY ? ' selected' : '';
            html += `<div class="tree-node tree-node-critical${critSel}" onclick="TVC_SpareMenu.reqWorkSelectGroup('${CRITICAL_GROUP_KEY}')"><span>⚠ Critical Equipment</span></div>`;
        }
        if (!byDept.size && q && !matchCritical) {
            html += `<div class="tree-empty muted">No groups match "${esc(q)}"</div>`;
        }
        DEPT_TREE_ORDER.filter(d => byDept.has(d)).forEach(dept => {
            const nodes = byDept.get(dept);
            html += `<div class="tree-dept">${esc(dept)}</div>`;
            mergeSpareTreeNodes(nodes).forEach(n => {
                const emptyTag = n.isEmpty ? `<span class="tree-empty-tag" title="No job items">0</span>` : '';
                const sel = st.selectedGroupKey === n.key ? ' selected' : '';
                html += `<div class="tree-node${sel}${n.isEmpty ? ' tree-node-empty' : ''}" onclick="TVC_SpareMenu.reqWorkSelectGroup('${escAttr(n.key)}')"><span>${esc(safeTreeLabel(n.label))}</span>${emptyTag}</div>`;
            });
        });
        root.innerHTML = html;
        const searchEl = document.getElementById('reqWorkTreeSearch');
        if (searchEl && document.activeElement !== searchEl) searchEl.value = st.treeSearch || '';
    }

    function reqWorkListTableWidth(scroll) {
        if (!scroll) return 0;
        const grouped = !!scroll.querySelector('.req-work-group-section');
        const inset = grouped ? 28 : 0;
        return Math.max(0, scroll.clientWidth - inset);
    }

    function syncReqWorkRowTableWidths() {
        const scroll = document.getElementById('reqWorkListScroll');
        if (!scroll) return;
        const tableW = reqWorkListTableWidth(scroll);
        if (!tableW) return;

        const base = SPARE_REQ_BASE_COL_WIDTHS.concat(SPARE_REQ_EXTRA_COL_WIDTHS);
        const baseSum = base.reduce((a, b) => a + b, 0);
        const mins = SPARE_REQ_COL_MINS;
        const flexFloor = [24, 48, mins[2], 72, 52, mins[5], mins[6], mins[7], mins[8], mins[9], mins[10], mins[11], mins[12]];
        let scaled = base.map((w, i) => Math.max(mins[i] || 22, Math.round(w * tableW / baseSum)));

        let sum = scaled.reduce((a, b) => a + b, 0);
        if (sum > tableW) {
            let excess = sum - tableW;
            for (const idx of [3, 4, 1, 0]) {
                if (excess <= 0) break;
                const cut = Math.min(excess, scaled[idx] - flexFloor[idx]);
                if (cut > 0) {
                    scaled[idx] -= cut;
                    excess -= cut;
                }
            }
        }

        sum = scaled.reduce((a, b) => a + b, 0);
        const drift = tableW - sum;
        if (drift > 0) {
            scaled[3] += Math.round(drift * 0.55);
            scaled[4] += drift - Math.round(drift * 0.55);
        } else if (drift < 0) {
            scaled[3] = Math.max(flexFloor[3], scaled[3] + drift);
        }

        scroll.style.setProperty('--spare-table-w', `${tableW}px`);
        scroll.querySelectorAll('.spare-data-table-req').forEach(table => {
            table.style.width = '100%';
            table.style.minWidth = '0';
            table.style.maxWidth = '100%';
            table.querySelectorAll('colgroup col').forEach((col, i) => {
                if (scaled[i] != null) {
                    col.style.width = `${(scaled[i] / tableW * 100).toFixed(4)}%`;
                }
            });
        });
    }

    function syncReqWorkHeadLayout() {
        const head = document.getElementById('reqWorkListHead');
        const track = document.getElementById('reqWorkListHeadTrack');
        const headTable = head?.querySelector('.spare-data-table');
        if (head && track && headTable && !head.classList.contains('is-grouped-inline')) {
            syncHeadLayout('reqWorkListScroll', 'reqWorkListHead', 'reqWorkListHeadTrack', SPARE_REQ_MIN_WIDTH);
        }
        syncReqWorkRowTableWidths();
    }

    function reqWorkGroupListHeadHtml(isFirst) {
        const thead = isFirst ? SPARE_REQ_TABLE_HEAD : SPARE_REQ_TABLE_HEAD_GROUP;
        return `<div class="req-work-group-head"><table class="spare-data-table spare-data-head spare-data-table-req">
                ${SPARE_REQ_COLGROUP}
                ${thead}
            </table></div>`;
    }

    function setReqWorkListHeadGroupedMode(grouped) {
        const head = document.getElementById('reqWorkListHead');
        if (!head) return;
        head.classList.toggle('is-grouped-inline', grouped);
        if (grouped) head.innerHTML = '';
    }

    function mountReqWorkGroupedList() {
        setReqWorkListHeadGroupedMode(true);
        const scroll = document.getElementById('reqWorkListScroll');
        if (!scroll) return;
        const hscroll = scroll.closest('.spare-req-table-hscroll');
        const scrollTop = scroll.scrollTop;
        const hScrollLeft = hscroll?.scrollLeft || 0;
        if (vlReqWork) { vlReqWork.destroy(); vlReqWork = null; }
        const st = getState();
        const m = modState(st);
        const sections = reqWorkGroupedSections(st);
        if (!sections.length) {
            scroll.innerHTML = `<div class="spare-empty-list muted" style="padding:24px;text-align:center">Click <strong>Select Requisition</strong> to load requisition parts.</div>`;
            return;
        }
        const batchMap = st.spareListSelected || {};
        const html = sections.map((g, i) => `
            <section class="req-work-group-section" data-req-group="${escAttr(g.key)}">
                ${renderSpareGroupHeaderFromResolved(g.header)}
                ${reqWorkGroupListHeadHtml(i === 0)}
                <div class="req-work-group-rows">
                    ${g.spares.map(s => rowHtml(s, m.reqWorkFocusedId, batchMap, 'reqWork')).join('')}
                </div>
            </section>`).join('');
        scroll.innerHTML = `<div class="req-work-groups">${html}</div>`;
        scroll.scrollTop = scrollTop;
        if (hscroll) hscroll.scrollLeft = hScrollLeft;
        bindHeadLayoutSync(scroll, syncReqWorkHeadLayout, 'reqWork');
        requestAnimationFrame(() => {
            updateReqWorkHeadCheckAll();
            syncReqWorkRowTableWidths();
            requestAnimationFrame(() => {
                syncReqWorkRowTableWidths();
                setTimeout(syncReqWorkRowTableWidths, 120);
            });
        });
    }

    function mountReqWorkVirtualList() {
        const st = getState();
        if (reqWorkUsesGroupedList(st)) {
            mountReqWorkGroupedList();
            return;
        }
        const head = document.getElementById('reqWorkListHead');
        setReqWorkListHeadGroupedMode(false);
        if (head && !head.querySelector('.spare-data-head')) {
            head.innerHTML = `<div id="reqWorkListHeadTrack" class="spare-head-track"><table class="spare-data-table spare-data-head spare-data-table-req">
                ${SPARE_REQ_COLGROUP}
                ${SPARE_REQ_TABLE_HEAD}
            </table></div>`;
        }
        const scroll = document.getElementById('reqWorkListScroll');
        if (!scroll) return;
        const hscroll = scroll.closest('.spare-req-table-hscroll');
        const scrollTop = scroll.scrollTop;
        const hScrollLeft = hscroll?.scrollLeft || 0;
        if (vlReqWork) vlReqWork.destroy();
        if (!_reqWorkCachedList.length) {
            const st = getState();
            const m = modState(st);
            const gLabel = groupFilterLabel(st);
            const lowTag = m.showLowOnly ? 'Low stock' : '';
            const filterLabel = [gLabel, lowTag].filter(Boolean).join(' · ');
            const listHint = isRequisitionListWindow(m) && !reqWorkCheckedSpareCount(st)
                ? 'Click <strong>Select Requisition</strong> to load requisition parts.'
                : `No parts to display.${filterLabel ? ' (Filter: ' + esc(filterLabel) + ')' : ''}`;
            scroll.innerHTML = `<div class="spare-empty-list muted" style="padding:24px;text-align:center">${listHint}</div>`;
            vlReqWork = null;
            return;
        }
        const m = modState(st);
        vlReqWork = TVC_VirtualList.mount(scroll, {
            getCount: () => _reqWorkCachedList.length,
            renderRow: (i) => {
                const s = _reqWorkCachedList[i];
                const batchMap = st.spareListSelected || {};
                return s ? rowHtml(s, m.reqWorkFocusedId, batchMap, 'reqWork') : '';
            },
            overflowX: 'hidden',
            overflowY: 'auto',
        });
        scroll.scrollTop = scrollTop;
        if (hscroll) hscroll.scrollLeft = hScrollLeft;
        if (vlReqWork) vlReqWork.refresh();
        if (head) bindHeadLayoutSync(scroll, syncReqWorkHeadLayout, 'reqWork');
        requestAnimationFrame(() => {
            syncReqWorkHeadLayout();
            requestAnimationFrame(syncReqWorkHeadLayout);
        });
        updateReqWorkHeadCheckAll();
        syncReqWorkSaveBtn();
    }

    function captureReqWorkLineQtys() {
        const req = getReqWorkSession();
        if (!req) return;
        document.querySelectorAll('#reqWorkListScroll [data-spare-id]').forEach(table => {
            const spareId = reqWorkSpareIdKey(table.dataset.spareId);
            const reqInput = table.querySelector('.spare-req-qty-input');
            if (reqInput && spareId) {
                const qty = Math.max(0, Math.floor(Number(reqInput.value) || 0));
                const line = (req.lines || []).find(l => reqWorkSameSpareId(l.spare_part_id, spareId));
                if (line) line.qty_requested = qty;
            }
            const rcvdInput = table.querySelector('.spare-req-rcvd-qty-input');
            if (rcvdInput && spareId) {
                const qty = Math.max(0, Math.floor(Number(rcvdInput.value) || 0));
                const line = (req.lines || []).find(l => reqWorkSameSpareId(l.spare_part_id, spareId));
                if (line) line.qty_received = qty;
            }
        });
    }

    function finalizeReqWorkDraftForSave() {
        captureReqWorkMeta();
        captureReqWorkLineQtys();
        const req = _reqWorkDraft;
        if (!req) return;

        const st = getState();
        const user = spareInventoryUser(st);
        if (!String(req.made_by || '').trim()) req.made_by = spareReportedByForUser(user);
        if (!String(req.made_on || '').trim()) req.made_on = reqListReportedDateToday();
        if (req.req_no?.trim()) {
            if (!req.list_status || req.list_status === SPARE_LIST_STATUS.DRAFT) {
                req.list_status = SPARE_LIST_STATUS.REPORTED;
            }
        }

        const byId = new Map();
        (req.lines || []).forEach(l => {
            const id = reqWorkSpareIdKey(l.spare_part_id);
            if (!id) return;
            byId.set(id, l);
        });
        req.lines = [...byId.values()];
    }

    function reqWorkLinesMissingRequestQty(lines) {
        return (lines || []).filter(l => reqWorkSpareIdKey(l.spare_part_id) && (Number(l.qty_requested) || 0) <= 0);
    }

    function reqWorkSaveQtyValid(m) {
        if (!isNewRequisitionWindow(m)) return true;
        const req = getReqWorkSession();
        const lines = (req?.lines || []).filter(l => reqWorkSpareIdKey(l.spare_part_id));
        if (!lines.length) return false;
        return reqWorkLinesMissingRequestQty(lines).length === 0;
    }

    function reqWorkMissingRequestQtyAlert(lines) {
        const missingQty = reqWorkLinesMissingRequestQty(lines);
        if (!missingQty.length) return false;
        const names = missingQty.slice(0, 5).map(l => l.part_no || l.name || '—').join(', ');
        const more = missingQty.length > 5 ? ` and ${missingQty.length - 5} more` : '';
        alert(`Some selected parts have no Request quantity.\n\n${names}${more}\n\nEnter Request quantity for each selected part, then save.`);
        return true;
    }

    function syncReqWorkSaveBtn() {
        const btn = document.getElementById('reqWorkSaveBtn');
        if (!btn) return;
        const m = modState(getState());
        const completeDone = !!m.reqWorkCompleted;
        const listViewLocked = isRequisitionListWindow(m) && !m.reqWorkListEditing;
        const qtyBlocked = isNewRequisitionWindow(m) && !reqWorkSaveQtyValid(m);
        const disabled = completeDone || listViewLocked || qtyBlocked;
        btn.disabled = disabled;
        btn.title = qtyBlocked
            ? 'Enter Request quantity for each selected part before Save.'
            : '';
    }

    /** Complete 시 Made on / by — 갑판부(DECK): Captain, 기관부(ENGINE): Chief Engineer */
    function reqWorkMadeByForDept(department) {
        const dept = String(department || '').trim().toUpperCase();
        if (dept === 'DECK') return 'Captain';
        return 'Chief Engineer';
    }

    /** Requisition List — PC 로컬 날짜 (Reported Date) */
    function reqListReportedDateToday() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /** SPARE Reported by — 접속자 직책 (작성자 / 확인자 / 승인자) */
    function spareReportedByForUser(user) {
        if (!user) return '';
        if (window.TVC_RBAC?.getReportedByLabel) return TVC_RBAC.getReportedByLabel(user);
        const role = user.role || TVC_RBAC?.resolveUserRole?.(user);
        if (role === 'SHIP_CAPTAIN') return 'Captain';
        if (role === 'SHIP_CHIEF') return 'Chief Engineer';
        if (role === 'HQ_SUPERVISOR') return 'Superintendent';
        if (role === 'SHIP_OFFICER') {
            return String(user.department || '').toUpperCase() === 'ENGINE' ? 'Engineer' : 'Officer';
        }
        return user.display_name || '';
    }

    /** Reported by on save — preserve saved value; auto-fill for new records */
    function resolveSpareReportedBy(record, user) {
        const saved = String(record?.made_by || '').trim();
        if (saved) return TVC_RBAC.normalizeReportedByLabel?.(saved) || saved;
        return spareReportedByForUser(user);
    }

    /** Requisition List 창 — 선택 해제 시 Reported / Evaluated by·date 비움 */
    function clearReqListWindowAuditMeta(req) {
        if (!req) return;
        req.made_on = '';
        req.made_by = '';
        req.assessed_on = '';
        req.assessed_by = '';
    }

    function applyReqWorkCompleteMeta(st, req) {
        if (!req) return;
        req.made_on = new Date().toISOString().slice(0, 10);
        if (!String(req.made_by || '').trim()) {
            req.made_by = spareReportedByForUser(spareInventoryUser(st));
        }
    }

    const SPARE_LIST_STATUS = { DRAFT: 'Draft', REPORTED: 'Reported', CONFIRMED: 'Confirmed', APPROVED: 'Approved' };

    function spareRecordDepartment(record, st) {
        return record?.department || st?.department || '';
    }

    function spareListStatus(record) {
        if (!record) return SPARE_LIST_STATUS.DRAFT;
        if (record.approved_by || record.approved_at) return SPARE_LIST_STATUS.APPROVED;
        if (record.confirmed_by || record.confirmed_at) return SPARE_LIST_STATUS.CONFIRMED;
        if (record.list_status === SPARE_LIST_STATUS.CONFIRMED) return SPARE_LIST_STATUS.CONFIRMED;
        if (record.list_status === SPARE_LIST_STATUS.APPROVED) return SPARE_LIST_STATUS.APPROVED;
        if (record.list_status === SPARE_LIST_STATUS.REPORTED) return SPARE_LIST_STATUS.REPORTED;
        // Saved requisition with req no + reported date → Reported (legacy Draft list_status)
        if (record.req_no && reqListReportedDate(record)) return SPARE_LIST_STATUS.REPORTED;
        if (record.list_status) return record.list_status;
        if (record.log_id || (record.id && record.req_no)) return SPARE_LIST_STATUS.REPORTED;
        return SPARE_LIST_STATUS.DRAFT;
    }

    function reqWorkflowPhase(req) {
        if (!req) return REQ_LIST_PHASE.DRAFT;
        const RS = TVC_Inventory?.REQ_STATUS || {};
        const invStatus = String(req.status || RS.DRAFT || 'DRAFT').toUpperCase();
        const listStatus = spareListStatus(req);
        const hasReceivedDate = !!reqListReceivedDate(req);
        const hasLineReceived = (req.lines || []).some(l => Number(l.qty_received) > 0);
        const hasAssessed = !!(req.assessed_on)
            || invStatus === RS.QUOTED || invStatus === RS.HQ_REVIEW || invStatus === RS.APPROVED
            || listStatus === SPARE_LIST_STATUS.APPROVED;
        const isExported = (TVC_Inventory?.isRequisitionSubmittedExport?.(req))
            || invStatus === RS.EXPORTED || invStatus === RS.SUBMITTED;

        if (hasReceivedDate || hasLineReceived) return REQ_LIST_PHASE.RECEIVED;
        if (hasAssessed) return REQ_LIST_PHASE.ASSESSED;
        if (isExported) return REQ_LIST_PHASE.SUBMITTED;
        if (listStatus === SPARE_LIST_STATUS.CONFIRMED) return REQ_LIST_PHASE.CONFIRMED;
        if (listStatus === SPARE_LIST_STATUS.REPORTED) return REQ_LIST_PHASE.REPORTED;
        return REQ_LIST_PHASE.DRAFT;
    }

    function reqListWorkflowLabel(req) {
        const phase = reqWorkflowPhase(req);
        if (phase === REQ_LIST_PHASE.RECEIVED && !reqListReceivedDate(req)) return 'Partial Recv';
        const labels = {
            [REQ_LIST_PHASE.DRAFT]: 'Draft',
            [REQ_LIST_PHASE.REPORTED]: 'Reported',
            [REQ_LIST_PHASE.CONFIRMED]: 'Confirmed',
            [REQ_LIST_PHASE.SUBMITTED]: 'Submitted',
            [REQ_LIST_PHASE.ASSESSED]: 'Evaluated',
            [REQ_LIST_PHASE.RECEIVED]: 'Received',
        };
        return labels[phase] || 'Draft';
    }

    function reqListStatusCell(req) {
        const label = reqListWorkflowLabel(req);
        const cls = label.replace(/\s+/g, '');
        return `<span class="sr-status rl-st-${escAttr(cls)}">${esc(label)}</span>`;
    }

    function reqListMatchesPhase(req, tab) {
        if (!tab || tab === REQ_LIST_PHASE.ALL) return true;
        const phase = reqWorkflowPhase(req);
        if (tab === 'exported') return phase === REQ_LIST_PHASE.SUBMITTED;
        return phase === tab;
    }

    function reqListCanExport(req) {
        return spareListStatus(req) !== SPARE_LIST_STATUS.DRAFT;
    }

    function reqListCanMasterExport(req) {
        if (!req) return false;
        return reqWorkflowPhase(req) === REQ_LIST_PHASE.CONFIRMED;
    }

    function reqListCanReceivedExport(req) {
        if (!req) return false;
        return reqListWorkflowLabel(req) === 'Received';
    }

    function reqListCanXferExport(req) {
        if (_reqListXferExportKind === 'received') return reqListCanReceivedExport(req);
        if (_reqListXferExportKind === 'requisition') return reqListCanMasterExport(req);
        return reqListCanMasterExport(req);
    }

    function reqListExportSelectDisabledTitle(req) {
        const phase = reqWorkflowPhase(req);
        if (phase === REQ_LIST_PHASE.DRAFT) return 'Draft — complete requisition first';
        if (phase === REQ_LIST_PHASE.REPORTED) return 'Reported — confirm first';
        if (phase === REQ_LIST_PHASE.SUBMITTED) return 'Already exported (Submitted)';
        if (phase === REQ_LIST_PHASE.ASSESSED) return 'Evaluated — not exportable here';
        if (phase === REQ_LIST_PHASE.RECEIVED) return 'Received — not exportable here';
        return 'Not exportable';
    }

    function reqListXferExportSelectDisabledTitle(req) {
        if (_reqListXferExportKind === 'received') {
            const label = reqListWorkflowLabel(req);
            if (label === 'Received') return 'Not exportable';
            if (label === 'Partial Recv') return 'Partial Recv — complete received date first';
            return `${label} — only Received status can be exported`;
        }
        return reqListExportSelectDisabledTitle(req);
    }

    function reqListCheckedExportableIds(m, allReqs) {
        const map = m.reqListCheckedIds || {};
        return Object.keys(map).filter(id => map[id] && reqListCanXferExport(allReqs.find(r => r.id === id)));
    }

    function spareApprovalState(record, department, opts = {}) {
        const st = getState();
        const user = spareInventoryUser(st);
        const dept = department || spareRecordDepartment(record, st);
        const status = spareListStatus(record);
        const isConfirmed = status === SPARE_LIST_STATUS.CONFIRMED || status === SPARE_LIST_STATUS.APPROVED
            || !!(record?.confirmed_by || record?.confirmed_at);
        const isApproved = status === SPARE_LIST_STATUS.APPROVED || !!(record?.approved_by || record?.approved_at);
        const hasKey = !!(record?.log_id || record?.id);
        const listMode = !!opts.listMode;
        const listEditing = !!opts.listEditing;
        const canConfirmRequisitionNow = canConfirmRequisition(st, record);
        const canConfirmNow = hasKey && status === SPARE_LIST_STATUS.REPORTED && !isConfirmed && !isApproved
            && canConfirmRequisitionNow
            && (!listMode || listEditing);
        const canApproveNow = hasKey && (status === SPARE_LIST_STATUS.CONFIRMED || isConfirmed) && !isApproved
            && !!user && TVC_RBAC.canApproveHqReport(user);
        return {
            isConfirmed,
            isApproved,
            canConfirmNow,
            canApproveNow,
            confirmedByVal: isConfirmed
                ? (record?.confirmed_by || requisitionConfirmByLabel(st, record))
                : '',
            approvedByVal: isApproved ? 'Company' : '',
        };
    }

    function renderSpareApprovalHtml(opts = {}) {
        const {
            prefix = 'spare',
            canApproveNow = false,
            canConfirmNow = false,
            isRepApproved = false,
            isRepConfirmed = false,
            approvedByVal = '',
            confirmedByVal = '',
        } = opts;
        return `<section class="wr-maint-card wr-maint-approval" aria-label="Approval">
            <div class="wr-maint-approval-item${canConfirmNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="${prefix}ConfirmedBy"${isRepConfirmed ? ' checked' : ''}${canConfirmNow ? '' : ' disabled'} onchange="TVC_SpareMenu.spareConfirmedByToggle('${prefix}')"> Confirmed by</label>
                <input class="wr-ro wr-maint-date" value="${esc(confirmedByVal)}" readonly tabindex="-1">
            </div>
            <div class="wr-maint-approval-item${canApproveNow ? ' is-active' : ''}">
                <label class="wr-maint-chk"><input type="checkbox" id="${prefix}ApprovedBy"${isRepApproved ? ' checked' : ''}${canApproveNow ? '' : ' disabled'}> Approved by</label>
                <input class="wr-ro wr-maint-date" value="${esc(approvedByVal)}" readonly tabindex="-1">
            </div>
        </section>`;
    }

    function renderSpareApprovalSection(record, { prefix, department, listMode, listEditing } = {}) {
        const approval = spareApprovalState(record, department, { listMode, listEditing });
        return renderSpareApprovalHtml({
            prefix,
            canApproveNow: approval.canApproveNow,
            canConfirmNow: approval.canConfirmNow,
            isRepApproved: approval.isApproved,
            isRepConfirmed: approval.isConfirmed,
            approvedByVal: approval.approvedByVal,
            confirmedByVal: approval.confirmedByVal,
        });
    }

    function spareConfirmedByToggle(prefix) {
        const cb = document.getElementById(`${prefix}ConfirmedBy`);
        if (!cb || cb.disabled) return;
        const input = cb.closest('.wr-maint-approval-item')?.querySelector('.wr-maint-date');
        if (!input) return;
        const st = getState();
        const record = prefix === 'reqWork' ? _reqWorkDraft : null;
        if (cb.checked) {
            if (prefix === 'closeOs') {
                input.value = requisitionConfirmByLabel(st, { department: st.department });
            } else if (record) {
                input.value = requisitionConfirmByLabel(st, record);
            } else {
                input.value = requisitionConfirmByLabel(st, { department: st.department });
            }
        } else if (prefix === 'closeOs') {
            if (!document.getElementById('closeOsConfirmedBy')?.checked) input.value = '';
        } else if (!record?.confirmed_by && !record?.confirmed_at) {
            input.value = '';
        }
    }

    function applySpareApprovalFromUi(record, prefix, department) {
        const st = getState();
        const user = spareInventoryUser(st);
        if (!user || !record) return false;
        const dept = department || spareRecordDepartment(record, st);
        const cfCb = document.getElementById(`${prefix}ConfirmedBy`);
        const apCb = document.getElementById(`${prefix}ApprovedBy`);
        const now = new Date().toISOString();
        let changed = false;
        const canConfirm = prefix === 'reqWork'
            ? canConfirmRequisition(st, record)
            : TVC_RBAC.canConfirmDepartment(user, dept);
        if (cfCb?.checked && !cfCb.disabled && canConfirm) {
            if (!record.confirmed_by && !record.confirmed_at) {
                record.confirmed_by = prefix === 'reqWork'
                    ? requisitionConfirmByLabel(st, record)
                    : (TVC_RBAC.getDepartmentConfirmLabel(dept) || TVC_RBAC.getRankLabel(user));
                record.confirmed_at = now;
                record.list_status = SPARE_LIST_STATUS.CONFIRMED;
                changed = true;
            }
        }
        if (apCb?.checked && !apCb.disabled && TVC_RBAC.canApproveHqReport(user)) {
            if (!record.approved_by && !record.approved_at) {
                record.approved_by = 'Company';
                record.approved_at = now;
                record.list_status = SPARE_LIST_STATUS.APPROVED;
                changed = true;
            }
        }
        return changed;
    }

    async function tryApplySpareApprovalOnClose(kind, record, department) {
        if (!record) return false;
        const key = kind === 'consume' ? record.log_id : record.id;
        if (!key) return false;
        const before = spareListStatus(record);
        if (!applySpareApprovalFromUi(record, kind === 'consume' ? 'consume' : 'reqWork', department)) return false;
        const after = spareListStatus(record);
        if (after === before) return false;
        if (kind === 'consume') {
            const { st, user, vesselId } = await vesselScope();
            captureConsumeMeta();
            await persistConsumeLogFromDraft(record, { st, user, vesselId });
        } else {
            await TVC_Inventory.saveRequisition(record);
        }
        if (after === SPARE_LIST_STATUS.CONFIRMED) alert('Confirmed.');
        else if (after === SPARE_LIST_STATUS.APPROVED) alert('Approved by Company.');
        return true;
    }

    function captureReqWorkMeta() {
        const req = _reqWorkDraft;
        if (!req) return;
        const g = (id) => document.getElementById(id)?.value ?? '';
        reqApplyTypeKind(req, document.querySelector('input[name="reqWorkPriority"]:checked')?.value || 'ROUTINE');
        req.deliver_date_from = g('reqWorkDelFrom');
        req.deliver_date_to = g('reqWorkDelTo');
        req.deliver_port = g('reqWorkDelPort');
        req.req_no = g('reqWorkReqNo').trim();
        req.made_on = g('reqWorkMadeOn');
        req.made_by = resolveSpareReportedBy(req, spareInventoryUser(getState()));
        req.assessed_on = g('reqWorkAssessedOn');
        req.assessed_by = g('reqWorkAssessedBy');
        updateReqWorkHeadStats();
    }

    function renderReqWorkMetaHtml(req, opts = {}) {
        if (!req) return '';
        const preview = !!opts.preview;
        const docPreview = !!opts.docPreview;
        const st = getState();
        const reportedByVal = resolveSpareReportedBy(req, spareInventoryUser(st));
        const today = new Date().toISOString().slice(0, 10);
        const reqType = reqListTypeKind(req);
        const vesselRow = preview ? `<div class="spare-req-meta-row">
                        <label class="spare-req-meta-label">Vessel Name</label>
                        <div class="spare-req-meta-field">
                            <input type="text" class="spare-req-meta-input" value="${esc(opts.vesselName || '')}" disabled>
                        </div>
                    </div>` : '';
        const reqNoField = (preview || docPreview)
            ? `<input type="text" id="reqWorkReqNo" class="spare-req-meta-input" value="${esc(req.req_no || '')}" disabled readonly tabindex="-1">`
            : `<input type="text" id="reqWorkReqNo" class="spare-req-meta-input" value="${esc(req.req_no || '')}" placeholder="Requisition No." oninput="TVC_SpareMenu.captureReqWorkMeta()" onchange="TVC_SpareMenu.captureReqWorkMeta()">
                            <span class="spare-req-hist-anchor">
                                <button type="button" id="reqWorkHistBtn" class="btn btn-sm spare-req-hist-btn" onclick="TVC_SpareMenu.toggleReqWorkHistList()">${reqWorkHistPickBtnLabel(!!opts.listMode)}</button>
                            </span>`;
        const histPanel = (preview || docPreview) ? '' : `<div id="reqWorkHistPanel" class="spare-req-hist-popover hidden" aria-hidden="true"></div>`;
        const approvalSection = opts.listMode
            ? renderSpareApprovalSection(req, {
                prefix: 'reqWork',
                department: req.department || opts.department,
                listMode: true,
                listEditing: !!modState(st).reqWorkListEditing,
            })
            : '';
        return `<section class="spare-req-work-meta" aria-label="Requisition information">
            ${approvalSection}
            <div class="spare-req-meta-grid">
                <div class="spare-req-meta-col spare-req-meta-col-left">
                    ${vesselRow}
                    <div class="spare-req-meta-row">
                        <label class="spare-req-meta-label" for="reqWorkReqNo">Requisition No.</label>
                        <div class="spare-req-meta-field spare-req-no-wrap">
                            ${reqNoField}
                        </div>
                    </div>
                    <div class="spare-req-meta-row">
                        <span class="spare-req-meta-label">Required Date</span>
                        <div class="spare-req-meta-field spare-req-meta-date-range">
                            <input type="text" id="reqWorkDelFrom" class="spare-req-meta-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(req.deliver_date_from || ''))}" onchange="TVC_SpareMenu.captureReqWorkMeta()">
                            <span class="spare-req-meta-sep">~</span>
                            <input type="text" id="reqWorkDelTo" class="spare-req-meta-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(req.deliver_date_to || ''))}" onchange="TVC_SpareMenu.captureReqWorkMeta()">
                        </div>
                    </div>
                    <div class="spare-req-meta-row">
                        <label class="spare-req-meta-label" for="reqWorkDelPort">Required Port</label>
                        <div class="spare-req-meta-field">
                            <input type="text" id="reqWorkDelPort" class="spare-req-meta-input" value="${esc(req.deliver_port || '')}" placeholder="Required port" onchange="TVC_SpareMenu.captureReqWorkMeta()">
                        </div>
                    </div>
                </div>
                <div class="spare-req-meta-col spare-req-meta-col-right">
                    <div class="spare-req-meta-row spare-req-meta-row-priority">
                        <span class="spare-req-meta-label spare-req-meta-label-spacer" aria-hidden="true">&nbsp;</span>
                        <div class="spare-req-meta-field spare-req-meta-priority">
                            <label class="spare-req-priority-opt"><input type="radio" name="reqWorkPriority" value="URGENT"${reqType === 'URGENT' ? ' checked' : ''} onchange="TVC_SpareMenu.captureReqWorkMeta()"><span>Urgent</span></label>
                            <label class="spare-req-priority-opt"><input type="radio" name="reqWorkPriority" value="ROUTINE"${reqType === 'ROUTINE' ? ' checked' : ''} onchange="TVC_SpareMenu.captureReqWorkMeta()"><span>Routine</span></label>
                            <label class="spare-req-priority-opt"><input type="radio" name="reqWorkPriority" value="DOCK"${reqType === 'DOCK' ? ' checked' : ''} onchange="TVC_SpareMenu.captureReqWorkMeta()"><span>Dock Use</span></label>
                        </div>
                    </div>
                    <div class="spare-req-meta-row spare-req-meta-row-audit">
                        <span class="spare-req-meta-label">Reported Date</span>
                        <div class="spare-req-meta-field spare-req-meta-audit">
                            <input type="text" id="reqWorkMadeOn" class="spare-req-meta-input spare-req-meta-date tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(req.made_on || ''))}" onchange="TVC_SpareMenu.captureReqWorkMeta()">
                            <span class="spare-req-meta-by">by</span>
                            <input type="text" id="reqWorkMadeBy" class="spare-req-meta-input spare-req-meta-by-name wr-ro" value="${esc(reportedByVal)}" readonly disabled tabindex="-1">
                        </div>
                    </div>
                    <div class="spare-req-meta-row spare-req-meta-row-audit">
                        <span class="spare-req-meta-label">Evaluated Date</span>
                        <div class="spare-req-meta-field spare-req-meta-audit">
                            <input type="text" id="reqWorkAssessedOn" class="spare-req-meta-input spare-req-meta-date tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(req.assessed_on || ''))}" onchange="TVC_SpareMenu.captureReqWorkMeta()">
                            <span class="spare-req-meta-by">by</span>
                            <input type="text" id="reqWorkAssessedBy" class="spare-req-meta-input spare-req-meta-by-name" value="${esc(req.assessed_by || '')}" placeholder="Superintendent" onchange="TVC_SpareMenu.captureReqWorkMeta()">
                        </div>
                    </div>
                </div>
            </div>
            ${histPanel}
        </section>`;
    }

    function positionReqWorkHistPopover() {
        const btn = document.getElementById('reqWorkHistBtn');
        const panel = document.getElementById('reqWorkHistPanel');
        const meta = document.querySelector('#spareReqWorkBody .spare-req-work-meta');
        if (!btn || !panel || !meta || panel.classList.contains('hidden')) return;
        const top = btn.getBoundingClientRect().bottom - meta.getBoundingClientRect().top + 6;
        panel.style.top = `${Math.max(top, 0)}px`;
    }

    function setReqWorkHistOpen(open, opts = {}) {
        _reqWorkHistOpen = open;
        if (!open || opts.reset) clearReqListUiState(modState(getState()));
        const panel = document.getElementById('reqWorkHistPanel');
        const btn = document.getElementById('reqWorkHistBtn');
        const meta = document.querySelector('#spareReqWorkBody .spare-req-work-meta');
        if (panel) {
            panel.classList.toggle('hidden', !open);
            panel.setAttribute('aria-hidden', open ? 'false' : 'true');
        }
        if (btn) btn.classList.toggle('is-open', open);
        if (meta) meta.classList.toggle('is-req-hist-open', open);
        if (open) {
            requestAnimationFrame(() => {
                positionReqWorkHistPopover();
                syncReqWorkHistHeadPad();
            });
        }
    }

    async function refreshReqWorkHistList() {
        const panel = document.getElementById('reqWorkHistPanel');
        if (!panel) return;
        const st = getState();
        const { vesselId } = await vesselScope();
        const reqs = await TVC_Inventory.listRequisitions(vesselId);
        const reqRows = buildReqListRowsHtml(reqs, 'pick');
        const m = modState(st);
        const listMode = isRequisitionListWindow(m);
        const countLabel = `${reqs.length} item(s)`;
        let headHtml;
        if (listMode) {
            const canConfirm = reqListAnyCheckedCanConfirm(m, reqs, st);
            const canDelete = reqListCanDeleteSelection(m, st);
            const canCloseOs = reqListAnyCloseOsEnabled(m, reqs, st);
            headHtml = `<div class="spare-req-list-head spare-req-hist-popover-head">
                <h3 class="spare-req-work-title">📋 Requisition List
                    <span class="muted spare-req-list-count">${countLabel}</span>
                </h3>
                <span class="spare-req-work-head-spacer"></span>
                ${spareListToolbarBtn('Confirm', 'TVC_SpareMenu.reqListReportConfirm()', !canConfirm, 'btn-green')}
                ${spareListToolbarBtn('Close O/S', 'TVC_SpareMenu.openCloseOsModal()', !canCloseOs)}
                ${spareListToolbarBtn('Delete', 'TVC_SpareMenu.reqListDelete()', !canDelete, 'btn-red')}
                <span class="orig-toolbar-sep" aria-hidden="true"></span>
                ${spareListToolbarBtn('Print', 'TVC_SpareMenu.reqListPrint()')}
                ${spareListToolbarBtn('Preview', 'TVC_SpareMenu.reqListDocPreview()')}
                <button type="button" class="modal-x" onclick="TVC_SpareMenu.toggleReqWorkHistList()" title="Close">×</button>
            </div>`;
        } else {
            const histHeadLabel = reqWorkHistPickBtnLabel(false);
            headHtml = `<div class="spare-req-hist-popover-head">${histHeadLabel}
                <span class="muted spare-req-list-count">${countLabel}</span>
                <button type="button" class="modal-x" onclick="TVC_SpareMenu.toggleReqWorkHistList()" title="Close">×</button></div>`;
        }
        const hintText = listMode
            ? 'Click a row to load requisition.'
            : 'Click a row to fill Requisition No.';
        panel.innerHTML = `${headHtml}
            <div class="spare-req-list-panel-wrap spare-req-hist-panel-wrap">
                <div class="panel spare-req-list-panel spare-req-hist-list-panel">
                    <div class="spare-req-list-head-wrap" id="reqWorkHistListHead">
                        <table class="spare-data-table spare-req-list-table spare-req-list-head-table">${REQ_LIST_COLGROUP}${reqListTableHeadHtml('reqWorkHistHeadChkAll')}</table>
                    </div>
                    <div class="spare-req-hist-list-scroll" id="reqWorkHistListScroll">
                        <table class="spare-data-table spare-req-list-table spare-req-list-body-table">${REQ_LIST_COLGROUP}<tbody>${reqRows}</tbody></table>
                    </div>
                </div>
            </div>
            <p class="spare-req-list-hint spare-req-hist-hint muted">${hintText}</p>`;
        updateReqListHeadCheckAll(reqs);
        positionReqWorkHistPopover();
        requestAnimationFrame(() => {
            positionReqWorkHistPopover();
            syncReqWorkHistHeadPad();
        });
    }

    async function toggleReqWorkHistList() {
        if (_reqWorkHistOpen) {
            setReqWorkHistOpen(false);
            return;
        }
        setReqWorkHistOpen(true, { reset: true });
        await refreshReqWorkHistList();
    }

    function reqWorkSetReqNoInput(reqNo) {
        const el = document.getElementById('reqWorkReqNo');
        if (el) el.value = reqNo || '';
        captureReqWorkMeta();
    }

    function reqWorkPickReqNo(reqNo) {
        reqWorkSetReqNoInput(reqNo);
        setReqWorkHistOpen(false);
    }

    function updateReqWorkHeadStats() {
        const req = getReqWorkSession();
        const noEl = document.querySelector('.spare-req-work-no');
        const linesEl = document.querySelector('.spare-req-work-lines');
        if (noEl && req) noEl.textContent = req.req_no || '—';
        if (linesEl && req) linesEl.textContent = `${(req.lines || []).length} line(s)`;
    }

    function refreshReqWorkListRows() {
        const st = getState();
        const m = modState(st);
        const block = document.getElementById('reqWorkEditBlock');
        if (block) {
            if (reqWorkUsesGroupedList(st)) {
                block.innerHTML = '';
            } else if (m.inlineEditId && m.inlineDraft?.header) {
                block.innerHTML = renderSpareEditBlockHtml(st);
            } else {
                block.innerHTML = renderSpareGroupHeaderHtml(st, { focusedId: m.reqWorkFocusedId });
            }
        }
        const scroll = document.getElementById('reqWorkListScroll');
        const head = document.getElementById('reqWorkListHead');
        if (reqWorkUsesGroupedList(st)) {
            setReqWorkListHeadGroupedMode(true);
        } else {
            setReqWorkListHeadGroupedMode(false);
            if (head && !head.querySelector('.spare-data-head')) {
                head.innerHTML = `<div id="reqWorkListHeadTrack" class="spare-head-track"><table class="spare-data-table spare-data-head spare-data-table-req">
                    ${SPARE_REQ_COLGROUP}
                    ${SPARE_REQ_TABLE_HEAD}
                </table></div>`;
            }
        }
        if (reqWorkUsesGroupedList(st)) {
            mountReqWorkGroupedList();
        } else if (vlReqWork && scroll?.querySelector('.vl-inner')) {
            vlReqWork.refresh();
            requestAnimationFrame(syncReqWorkHeadLayout);
        } else if (scroll) {
            mountReqWorkVirtualList();
        }
        syncSpareToolbarUi();
        updateReqWorkHeadStats();
        updateReqWorkHeadCheckAll();
        syncSpareItemHistoryBtns();
    }

    function refreshReqWorkListUi() {
        const st = getState();
        const m = modState(st);
        const allCanon = (st.spares || []).map(canon);
        const prevCount = _reqWorkCachedList.length;
        _reqWorkCachedList = filteredReqWorkSpares(st);
        const hadItems = prevCount > 0;
        const hasItems = _reqWorkCachedList.length > 0;
        const scroll = document.getElementById('reqWorkListScroll');
        const canRefresh = !!(vlReqWork && scroll?.querySelector('.vl-inner') && hadItems && hasItems);
        const block = document.getElementById('reqWorkEditBlock');
        if (block) {
            if (reqWorkUsesGroupedList(st)) {
                block.innerHTML = '';
            } else if (m.inlineEditId && m.inlineDraft?.header) {
                block.innerHTML = renderSpareEditBlockHtml(st);
            } else {
                block.innerHTML = renderSpareGroupHeaderHtml(st, { focusedId: m.reqWorkFocusedId });
            }
        }
        renderReqWorkGroupTree();
        if (reqWorkUsesGroupedList(st)) {
            mountReqWorkGroupedList();
        } else if (canRefresh) {
            vlReqWork.refresh();
            requestAnimationFrame(syncReqWorkHeadLayout);
        } else {
            mountReqWorkVirtualList();
        }
        syncSpareToolbarUi();
        updateReqWorkHeadStats();
        updateReqWorkHeadCheckAll();
        const countEl = document.getElementById('reqWorkCount');
        if (countEl) {
            countEl.textContent = m.reqWorkShowSelectedOnly
                ? reqWorkSelectedCountLabel(st, _reqWorkCachedList.length)
                : `${_reqWorkCachedList.length} / ${allCanon.length}`;
        }
        updateReqWorkSelectedBtn();
        updateSpareModalTreeToggleUi('reqWork');
        if (isReqWorkListViewLocked()) {
            applyReqWorkScrollLock(document.getElementById('spareReqWorkBody'));
        }
    }

    async function renderReqWorkModal() {
        const body = document.getElementById('spareReqWorkBody');
        if (!body) return;
        await syncReqLineMap();
        const { st, vesselId } = await vesselScope();
        spareInventoryUser(st);
        const m = modState(st);
        const allCanon = (st.spares || []).map(canon);
        _reqWorkCachedList = filteredReqWorkSpares(st);
        const tb = spareToolbarFlags(st);
        const req = getReqWorkSession();
        if (m.reqWorkPreview) {
            const vesselName = await vesselLabel(vesselId);
            body.innerHTML = renderReqPreviewHtml(st, req, vesselName);
            return;
        }
        const reqLabel = req?.req_no ? esc(req.req_no) : '—';
        const lineCount = (req?.lines || []).length;
        const draftTag = (_reqWorkDraft && !m.reqWorkCompleted) ? ' <span class="muted spare-req-work-draft">(unsaved)</span>' : '';
        const titlePrefix = isRequisitionListWindow(m) ? '📋 Requisition List'
            : m.reqWorkEditMode ? '✏️ Modify Requisition'
            : '➕ New Requisition';
        const completeDone = !!m.reqWorkCompleted;
        const preview = false;
        const selBtn = reqWorkSelectedBtnMeta(st);
        const selectedBtnCls = selBtn.active ? ' plan-selected-filter-active' : '';
        const countLabel = isRequisitionListWindow(m)
            ? `${_reqWorkCachedList.length} item(s)`
            : m.reqWorkShowSelectedOnly
            ? reqWorkSelectedCountLabel(st, _reqWorkCachedList.length)
            : `${_reqWorkCachedList.length} / ${allCanon.length}`;
        const modifyHint = (m.reqWorkEditMode || (isRequisitionListWindow(m) && m.reqWorkListEditing)) && !m.reqWorkCompleted
            ? '<p class="spare-req-work-modify-hint muted">Use checkboxes to add/remove parts · Enter Request qty, then Save</p>'
            : '';
        const headTitle = preview ? 'Preview' : titlePrefix;
        const previewVesselName = preview ? await vesselLabel(vesselId) : '';
        const listMode = isRequisitionListWindow(m);
        const docPreview = listMode && !!m.reqWorkListDocPreview;
        const hasDisplayedReq = reqWorkListHasDisplayedReq(m);
        const listViewLocked = listMode && !m.reqWorkListEditing;
        const saveDisabled = completeDone || listViewLocked || (isNewRequisitionWindow(m) && !reqWorkSaveQtyValid(m));
        const printPreviewDisabled = listMode && !hasDisplayedReq;
        const canRequisition = canCreateRequisition(st);
        const headNewDisabled = !canRequisition || m.reqWorkListEditing || docPreview;
        const headNewBtn = listMode && !docPreview
            ? `<button type="button" id="reqWorkHeadNewBtn" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.reqWorkSwitchToNew()"${headNewDisabled ? ' disabled' : ''} title="${m.reqWorkListEditing ? 'Finish editing first' : (!canRequisition ? 'No permission' : 'New requisition')}">New</button>`
            : '';
        const headModifyBtn = listMode && !docPreview
            ? `<button type="button" id="reqWorkHeadModifyBtn" class="btn btn-sm" onclick="TVC_SpareMenu.reqWorkEnterListEdit()"${!hasDisplayedReq || m.reqWorkListEditing ? ' disabled' : ''} title="${hasDisplayedReq ? 'Enable editing' : 'Select a requisition from the list first'}">Modify</button>`
            : '';
        const headCloseOsBtn = listMode && !docPreview
            ? `<button type="button" id="reqWorkHeadCloseOsBtn" class="btn btn-sm" onclick="TVC_SpareMenu.openCloseOsModal()" disabled title="Close outstanding for Received requisition with O/S &gt; 0">Close O/S</button>`
            : '';
        const headPrintPreviewBtns = listMode && !docPreview
            ? `<button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.reqWorkPrint()"${printPreviewDisabled ? ' disabled' : ''} title="${hasDisplayedReq ? 'Print requisition' : 'Select a requisition from the list first'}">Print</button>
            <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.reqWorkDocPreview()"${printPreviewDisabled ? ' disabled' : ''} title="${hasDisplayedReq ? 'Preview requisition' : 'Select a requisition from the list first'}">Preview</button>`
            : '';
        const headButtons = preview
            ? `<button type="button" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.reqWorkPrintPreview()">🖨 Print</button>
            <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.closeReqWorkModal()">Close</button>
            <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeReqWorkModal()">×</button>`
            : docPreview
            ? `<button type="button" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.reqWorkDocPreviewPrint()">Print</button>
            <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.reqWorkExitDocPreview()">Close</button>
            <button type="button" class="modal-x" onclick="TVC_SpareMenu.reqWorkExitDocPreview()">×</button>`
            : `${headNewBtn}${headModifyBtn}${headCloseOsBtn}
            <button type="button" id="reqWorkSaveBtn" class="btn btn-sm" onclick="TVC_SpareMenu.reqWorkSave()"${saveDisabled ? ' disabled' : ''}${saveDisabled && isNewRequisitionWindow(m) && !completeDone && !listViewLocked ? ' title="Enter Request quantity for each selected part before Save."' : ''}>Save</button>
            ${headPrintPreviewBtns}
            <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.closeReqWorkModal()">Close</button>
            <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeReqWorkModal()">×</button>`;
        const itemToolbar = (preview || docPreview) ? '' : `<div class="filter-bar orig-toolbar spare-item-toolbar wr-spare-toolbar">
                ${spareGroupTreeToggleHtml('reqWork', st)}
                ${spareItemHistoryBtnHtml()}
                <span class="wr-spare-toolbar-spacer" aria-hidden="true"></span>
                <div class="wr-spare-toolbar-actions">
                <button type="button" id="reqWorkModifyBtn" class="btn btn-sm" onclick="TVC_App.openSpareModify()"${tb.modifyEnabled ? '' : ' disabled'} title="${esc(tb.modifyTitle)}">✏️ Modify</button>
                <button type="button" id="reqWorkAppendBtn" class="btn btn-sm" onclick="TVC_App.openSpareAppend()"${tb.appendEnabled ? '' : ' disabled'} title="${esc(tb.appendTitle)}">➕ Append</button>
                <button type="button" id="reqWorkDeleteBtn" class="btn btn-sm btn-red" onclick="TVC_App.deleteSpareItem()"${tb.deleteEnabled ? '' : ' disabled'} title="${esc(tb.deleteTitle)}">🗑 Delete</button>
                <button type="button" id="reqWorkSelectedBtn" class="btn btn-sm spare-req-selected-btn${selectedBtnCls}"
                    onclick="TVC_SpareMenu.reqWorkToggleSelectedOnly()" aria-pressed="${selBtn.active ? 'true' : 'false'}"
                    title="${escAttr(selBtn.title)}"${selBtn.disabled ? ' disabled' : ''}>${esc(selBtn.label)}</button>
                </div>
              </div>`;
        const searchBar = (preview || docPreview) ? '' : `<div class="filter-bar spare-list-search-bar">
                <input type="search" class="search-input spare-list-search-input" id="reqWorkSearch" placeholder="Search Code / Item / Part No / Work"
                    value="${esc(m.partNo || m.description ? [m.partNo, m.description].filter(Boolean).join(' ') : (st.spareSearch || ''))}"
                    oninput="TVC_SpareMenu.reqWorkSetSearch(this.value)">
                <label class="sr-check"><input type="checkbox" ${m.showLowOnly ? 'checked' : ''}
                    onchange="TVC_SpareMenu.reqWorkToggleLowOnly()"> Low stock only</label>
                <span class="count-label" id="reqWorkCount">${countLabel}</span>
              </div>`;
        const useGroupedList = listMode && lineCount > 0;
        const editBlock = useGroupedList
            ? '<div id="reqWorkEditBlock"></div>'
            : `<div id="reqWorkEditBlock">${renderSpareGroupHeaderHtml(st, { focusedId: m.reqWorkFocusedId })}</div>`;

        body.innerHTML = `
        <div class="spare-req-work-wrap${preview ? ' is-preview' : ''}${docPreview ? ' is-doc-preview' : ''}">
          <div class="spare-req-work-head${docPreview ? ' spare-req-doc-preview-head' : ''}">
            <h3 class="spare-req-work-title${docPreview ? ' spare-req-doc-preview-title' : ''}">${docPreview ? 'Spare Part Requisition' : (preview ? headTitle : `${headTitle} · <span class="spare-req-work-no">${reqLabel}</span>${draftTag}
              <span class="muted spare-req-work-lines">${lineCount} line(s)</span>`)}</h3>
            <span class="spare-req-work-head-spacer"></span>
            ${headButtons}
          </div>
          <div class="spare-req-work-scroll">
          ${renderReqWorkMetaHtml(req, { preview, docPreview, vesselName: previewVesselName, department: st.department, listMode: m.reqWorkListMode })}
          ${docPreview ? '' : modifyHint}
          <div class="plan-layout spare-layout spare-req-work-layout wr-spare-full-width${preview ? ' is-preview' : ''}${docPreview ? ' is-doc-preview' : ''}">
            <main class="panel spare-main">
              ${itemToolbar}
              ${searchBar}
              ${editBlock}
              <div class="panel spare-list-panel">
                <div class="spare-req-table-hscroll">
                  <div class="spare-req-table-wide">
                    <div id="reqWorkListHead" class="vl-head-wrap sheet-scroll-original"></div>
                    <div id="reqWorkListScroll" class="virtual-scroll sheet-scroll-original spare-vl-scroll"></div>
                  </div>
                </div>
              </div>
            </main>
          </div>
          </div>
        </div>`;

        renderReqWorkGroupTree();
        mountReqWorkVirtualList();
        updateReqWorkSelectedBtn();
        if (!preview && !docPreview) {
            bindSpareModalTreePopovers();
            updateSpareModalTreeToggleUi('reqWork');
            syncSpareItemHistoryBtns();
        }
        if (preview || docPreview) {
            body.querySelectorAll('.spare-req-work-meta input, .spare-req-work-meta select').forEach(el => {
                el.setAttribute('disabled', 'disabled');
            });
        }
        // Requisition List 조회 모드 · Complete 완료 후: 본문 잠금 (Select Requisition만 항상 활성)
        applyReqWorkScrollLock(body);
        bindReqWorkListKeyboard();
        if (_reqWorkHistOpen) {
            setReqWorkHistOpen(true);
            await refreshReqWorkHistList();
        }
        requestAnimationFrame(() => {
            syncReqWorkHeadLayout();
            requestAnimationFrame(syncReqWorkHeadLayout);
        });
        syncSpareDateInputs(body);
        syncReqWorkListWindowHeadButtons();
    }

    async function startReqWorkSession(createNew = true, opts = {}) {
        const { st } = await vesselScope();
        if (!canCreateRequisition(st)) {
            alert('No permission to create requisitions.');
            return;
        }
        closeReqSheetModal();
        closeReqListModal();
        if (createNew) {
            _reqWorkDraft = null;
            _reqSheet.reqId = null;
            st.requisitionDraft = [];
        }
        const m = modState(st);
        m.reqWorkListMode = !!opts.listMode;
        m.reqWorkEditMode = false;
        m.reqWorkListEditing = false;
        m.reqWorkPreview = false;
        m.reqWorkListDocPreview = false;
        m.reqWorkShowSelectedOnly = !!opts.listMode;
        m.reqWorkCompleted = false;
        m.reqWorkLastSavedId = null;
        await ensureReqWorkDraft(createNew);
        if (opts.listMode && _reqWorkDraft) clearReqListWindowAuditMeta(_reqWorkDraft);
        m.selectedReqId = _reqSheet.reqId;
        m.reqWorkOpen = true;
        m.reqWorkFocusedId = null;
        m.showReqPanel = false;
        m.panelOpen = false;
        await renderReqWorkModal();
        showSpicsModal('spareReqWorkModal');
    }

    async function startReqWorkEditSession(reqId) {
        const { st } = await vesselScope();
        if (!canCreateRequisition(st)) {
            alert('No permission to create requisitions.');
            return;
        }
        const req = await TVC_Inventory.getRequisition(reqId);
        if (!req) return alert('Requisition not found.');
        closeReqSheetModal();
        _reqWorkDraft = {
            ...req,
            lines: (req.lines || []).map(l => ({ ...l })),
        };
        _reqSheet.reqId = req.id;
        const m = modState(st);
        m.reqWorkListMode = false;
        m.reqWorkEditMode = true;
        m.reqWorkPreview = false;
        m.reqWorkShowSelectedOnly = true;
        m.reqWorkCompleted = false;
        m.reqWorkLastSavedId = null;
        m.selectedReqId = req.id;
        m.reqWorkOpen = true;
        m.reqWorkFocusedId = null;
        m.showReqPanel = false;
        m.panelOpen = false;
        m.partNo = '';
        m.description = '';
        st.spareSearch = '';
        st.treeSearch = '';
        st.selectedGroupKey = null;
        await syncReqLineMap();
        syncRequisitionDraftFromLines();
        await renderReqWorkModal();
        showSpicsModal('spareReqWorkModal');
    }

    async function startReqWorkPreviewSession(reqId) {
        const { st } = await vesselScope();
        const req = await TVC_Inventory.getRequisition(reqId);
        if (!req) return alert('Requisition not found.');
        closeReqSheetModal();
        _reqWorkDraft = {
            ...req,
            lines: (req.lines || []).map(l => ({ ...l })),
        };
        _reqSheet.reqId = req.id;
        const m = modState(st);
        m.reqWorkListMode = false;
        m.reqWorkEditMode = false;
        m.reqWorkPreview = true;
        m.reqWorkShowSelectedOnly = true;
        m.reqWorkCompleted = false;
        m.reqWorkLastSavedId = req.id;
        m.selectedReqId = req.id;
        m.reqWorkOpen = true;
        m.reqWorkFocusedId = null;
        m.showReqPanel = false;
        m.panelOpen = false;
        m.partNo = '';
        m.description = '';
        st.spareSearch = '';
        st.treeSearch = '';
        st.selectedGroupKey = null;
        await syncReqLineMap();
        syncRequisitionDraftFromLines();
        await renderReqWorkModal();
        showSpicsModal('spareReqWorkModal');
    }

    async function closeReqWorkModal() {
        const st = getState();
        const req = _reqWorkDraft;
        if (req?.id) {
            const confirmed = await tryApplySpareApprovalOnClose('requisition', req, req.department || st.department);
            if (confirmed) await refreshReqListUi();
        }
        const m = modState(st);
        m.reqWorkOpen = false;
        m.reqWorkFocusedId = null;
        m.reqWorkListMode = false;
        m.reqWorkEditMode = false;
        m.reqWorkListEditing = false;
        m.reqWorkPreview = false;
        m.reqWorkListDocPreview = false;
        m.reqWorkShowSelectedOnly = false;
        m.reqWorkTreeOpen = false;
        m.reqWorkCompleted = false;
        m.reqWorkLastSavedId = null;
        st.requisitionDraft = [];
        _reqWorkDraft = null;
        setReqWorkHistOpen(false);
        _reqListReturnAfterSave = false;
        if (_reqWorkResizeObs) { _reqWorkResizeObs.disconnect(); _reqWorkResizeObs = null; }
        if (vlReqWork) { vlReqWork.destroy(); vlReqWork = null; }
        document.getElementById('spareReqWorkModal')?.classList.remove('is-req-doc-preview');
        closeSpicsModal('spareReqWorkModal');
        if (st.currentTab === 'spare') render();
    }

    async function reqWorkComplete() {
        const st = getState();
        const m = modState(st);
        if (m.reqWorkCompleted) return;
        if (!canCompleteRequisition(st)) {
            return alert('Complete is available to Chief Engineer only.');
        }
        finalizeReqWorkDraftForSave();
        const req = getReqWorkSession();
        if (!req || !_reqWorkDraft) return alert('Requisition not found.');
        if (!_reqWorkDraft.req_no?.trim()) return alert('Enter Requisition No.');

        _reqWorkDraft.lines = (_reqWorkDraft.lines || []).filter(l => reqWorkSpareIdKey(l.spare_part_id));
        if (!_reqWorkDraft.lines.length) {
            return alert('Select part(s).');
        }

        const missingQty = reqWorkLinesMissingRequestQty(_reqWorkDraft.lines);
        if (missingQty.length) {
            const names = missingQty.slice(0, 5).map(l => l.part_no || l.name || '—').join(', ');
            const more = missingQty.length > 5 ? ` and ${missingQty.length - 5} more` : '';
            return alert(`Some selected parts have no Request quantity.\n\n${names}${more}\n\nEnter Request quantity for each selected part, then save.`);
        }

        // 작성/수정 완료 확인 — 취소 시 현재 화면 유지
        if (!window.confirm('Complete this requisition?')) return;

        // 확인 시 Made on = 오늘, by = 부서별 직책(Captain / Chief Engineer)
        applyReqWorkCompleteMeta(st, _reqWorkDraft);
        _reqWorkDraft.list_status = SPARE_LIST_STATUS.REPORTED;

        await TVC_Inventory.saveRequisition(_reqWorkDraft);
        const savedNo = _reqWorkDraft.req_no;
        const lineCount = _reqWorkDraft.lines.length;
        const savedId = _reqWorkDraft.id;
        _reqSheet.reqId = savedId;

        _reqListReturnAfterSave = false;
        m.reqWorkCompleted = true;
        m.reqWorkLastSavedId = savedId;
        st.requisitionDraft = [];
        await syncReportedWaitAndRefreshList();
        // 폼 데이터를 유지한 채 전체를 잠금 상태로 다시 렌더링 (입력 필드·버튼 disabled)
        await renderReqWorkModal();
        const doneMsg = m.reqWorkEditMode
            ? `청구서 ${savedNo} 수정 완료 (${lineCount} line(s)).`
            : `청구서 ${savedNo} 완료 (${lineCount} line(s)) — Requisition List에 추가되었습니다.`;
        alert(doneMsg);
    }

    async function reqWorkSwitchToNew() {
        const { st } = await vesselScope();
        if (!canCreateRequisition(st)) {
            alert('No permission to create requisitions.');
            return;
        }
        const m = modState(st);
        if (m.reqWorkListEditing) return;
        await openNewRequisitionWindow();
    }

    async function reqWorkEnterListEdit() {
        const st = getState();
        const m = modState(st);
        if (!isRequisitionListWindow(m)) return;
        if (!canCreateRequisition(st)) {
            alert('No permission to modify requisitions.');
            return;
        }
        if (!reqWorkListHasDisplayedReq(m)) {
            return alert('Select a requisition from the list first.');
        }
        if (m.reqWorkListEditing) return;
        m.reqWorkListEditing = true;
        await renderReqWorkModal();
    }

    async function reqWorkSave() {
        const st = getState();
        const m = modState(st);
        if (m.reqWorkCompleted) return;
        if (isRequisitionListWindow(m) && !m.reqWorkListEditing) return;
        finalizeReqWorkDraftForSave();
        if (!_reqWorkDraft) return alert('Requisition not found.');
        if (!_reqWorkDraft.req_no?.trim()) return alert('Enter Requisition No.');

        _reqWorkDraft.lines = (_reqWorkDraft.lines || []).filter(l => reqWorkSpareIdKey(l.spare_part_id));
        if (!_reqWorkDraft.lines.length) return alert('Select part(s).');
        if (isNewRequisitionWindow(m) && reqWorkMissingRequestQtyAlert(_reqWorkDraft.lines)) return;

        const isNewReqSave = m.reqWorkOpen && !m.reqWorkListMode && !m.reqWorkPreview && !m.reqWorkEditMode;
        if (isNewReqSave && !window.confirm('저장하시겠습니까?')) return;

        const dept = _reqWorkDraft.department || st.department;
        let pendingConfirm = false;
        if (isRequisitionListWindow(m)) {
            const cfCb = document.getElementById('reqWorkConfirmedBy');
            pendingConfirm = !!(cfCb?.checked && !cfCb.disabled);
            applySpareApprovalFromUi(_reqWorkDraft, 'reqWork', dept);
        }

        await TVC_Inventory.saveRequisition(_reqWorkDraft);
        m.reqWorkLastSavedId = _reqWorkDraft.id;
        _reqSheet.reqId = _reqWorkDraft.id;
        await syncReportedWaitAndRefreshList();

        if (isNewReqSave) {
            const savedId = _reqWorkDraft.id;
            m.reqWorkListMode = true;
            m.reqWorkEditMode = false;
            m.reqWorkShowSelectedOnly = true;
            st.selectedGroupKey = null;
            st.treeSearch = '';
            clearReqWorkSearch(st);
            clearReqListUiState(m);
            applyReqListSelection(m, savedId);
            await loadRequisitionIntoListWindow(savedId);
            await syncReportedWaitAndRefreshList();
            return;
        }

        if (isRequisitionListWindow(m)) {
            m.reqWorkListEditing = false;
            await refreshReqListUi();
            await renderReqWorkModal();
            if (pendingConfirm && spareListStatus(_reqWorkDraft) === SPARE_LIST_STATUS.CONFIRMED) alert('Confirmed.');
            else alert(`Requisition ${_reqWorkDraft.req_no} saved (${_reqWorkDraft.lines.length} line(s)).`);
            return;
        }
    }

    async function reqWorkOpenList() {
        const m = modState(getState());
        const selectId = m.reqWorkLastSavedId || null;
        closeReqWorkModal();
        await openReqListModal(selectId ? { selectId } : {});
    }

    async function reqWorkPrintContext() {
        captureReqWorkMeta();
        captureReqWorkLineQtys();
        const req = getReqWorkSession();
        if (!req?.req_no?.trim()) return null;
        const { st, vesselId } = await vesselScope();
        const vesselName = await vesselLabel(vesselId);
        return { st, req, vesselName };
    }

    function openReqWorkPreviewWindow(ctx, print = false) {
        const pages = buildReqPreviewPagesHtml(ctx.st, ctx.req, ctx.vesselName);
        const w = window.open('', '_blank', 'width=980,height=760');
        if (!w) { alert('Popup blocked. Please allow popups in your browser.'); return; }
        w.document.write(`<!DOCTYPE html><html><head><title>Parts Requisition — ${esc(ctx.req.req_no || '')}</title>
            <style>${reqPreviewPrintStyles()}</style></head><body>${pages}</body></html>`);
        w.document.close();
        w.focus();
        if (print) w.print();
    }

    async function reqWorkEnterDocPreview() {
        const st = getState();
        const m = modState(st);
        if (!isRequisitionListWindow(m)) return false;
        if (!reqWorkListHasDisplayedReq(m)) {
            alert('Select a requisition from the list first.');
            return false;
        }
        captureReqWorkMeta();
        captureReqWorkLineQtys();
        setReqWorkHistOpen(false);
        m.reqWorkListDocPreview = true;
        document.getElementById('spareReqWorkModal')?.classList.add('is-req-doc-preview');
        await renderReqWorkModal();
        return true;
    }

    async function reqWorkExitDocPreview() {
        const m = modState(getState());
        if (!m.reqWorkListDocPreview) return;
        m.reqWorkListDocPreview = false;
        document.getElementById('spareReqWorkModal')?.classList.remove('is-req-doc-preview');
        await renderReqWorkModal();
    }

    function reqWorkDocPreviewPrint() {
        window.print();
    }

    async function reqWorkDocPreview() {
        const m = modState(getState());
        if (isRequisitionListWindow(m)) {
            await reqWorkEnterDocPreview();
            return;
        }
        const ctx = await reqWorkPrintContext();
        if (!ctx) return alert('Load a requisition to preview.');
        openReqWorkPreviewWindow(ctx, false);
    }

    async function reqWorkPrint() {
        const m = modState(getState());
        if (isRequisitionListWindow(m)) {
            if (!reqWorkListHasDisplayedReq(m)) return alert('Select a requisition from the list first.');
            if (!m.reqWorkListDocPreview) await reqWorkEnterDocPreview();
            setTimeout(() => window.print(), 350);
            return;
        }
        const ctx = await reqWorkPrintContext();
        if (!ctx) return alert('Load a requisition to print.');
        openReqWorkPreviewWindow(ctx, true);
    }

    async function reqWorkPrintPreview() {
        const ctx = await reqWorkPrintContext();
        if (!ctx) {
            const { st, vesselId } = await vesselScope();
            const id = modState(st).reqWorkLastSavedId;
            if (!id) return alert('Requisition not found.');
            const req = await TVC_Inventory.getRequisition(id);
            if (!req) return alert('Requisition not found.');
            const vesselName = await vesselLabel(vesselId);
            openReqWorkPreviewWindow({ st, req, vesselName }, true);
            return;
        }
        openReqWorkPreviewWindow(ctx, true);
    }

    function updateReqWorkSelectedBtn() {
        const st = getState();
        const meta = reqWorkSelectedBtnMeta(st);
        const btn = document.getElementById('reqWorkSelectedBtn');
        if (!btn) return;
        btn.textContent = meta.label;
        btn.title = meta.title;
        btn.disabled = meta.disabled;
        btn.classList.toggle('plan-selected-filter-active', meta.active);
        btn.setAttribute('aria-pressed', meta.active ? 'true' : 'false');
    }

    function clearReqWorkSearch(st) {
        const m = modState(st);
        m.partNo = '';
        m.description = '';
        st.spareSearch = '';
        const searchEl = document.getElementById('reqWorkSearch');
        if (searchEl) searchEl.value = '';
    }

    function reqWorkToggleSelectedOnly() {
        const st = getState();
        const m = modState(st);
        if (isRequisitionListWindow(m)) return;
        if (m.reqWorkShowSelectedOnly) {
            m.reqWorkShowSelectedOnly = false;
        } else {
            if (!reqWorkCheckedSpareCount(st)) return alert('No parts selected.');
            m.reqWorkShowSelectedOnly = true;
        }
        refreshReqWorkListUi();
    }

    function reqWorkSelectGroup(key) {
        const st = getState();
        st.selectedGroupKey = key || null;
        modState(st).reqWorkFocusedId = null;
        modState(st).reqWorkTreeOpen = false;
        refreshReqWorkListUi();
    }

    function reqWorkToggleGroupTree() {
        const st = getState();
        const m = modState(st);
        if (m.reqWorkPreview || reqWorkFormLocked()) return;
        m.reqWorkTreeOpen = !m.reqWorkTreeOpen;
        if (m.reqWorkTreeOpen) renderReqWorkGroupTree();
        updateSpareModalTreeToggleUi('reqWork');
    }

    function reqWorkSetTreeSearch(v) {
        getState().treeSearch = v;
        renderReqWorkGroupTree();
    }

    function reqWorkSetSearch(v) { setSearch(v); }

    function reqWorkToggleLowOnly() {
        const st = getState();
        modState(st).showLowOnly = !modState(st).showLowOnly;
        applySpareListFilter();
    }

    function reqWorkEditable() {
        const m = modState(getState());
        return !!(m.reqWorkOpen && !m.reqWorkPreview && !reqWorkFormLocked());
    }

    function reqWorkNavigableSpares(st) {
        if (reqWorkUsesGroupedList(st)) {
            return reqWorkGroupedSections(st).flatMap(g => g.spares.filter(s => reqWorkRowChecked(s)));
        }
        return (_reqWorkCachedList || []).filter(s => reqWorkRowChecked(s));
    }

    function findReqWorkRowTable(spareId) {
        const sid = reqWorkSpareIdKey(spareId);
        const scroll = document.getElementById('reqWorkListScroll');
        if (!scroll || !sid) return null;
        for (const el of scroll.querySelectorAll('[data-spare-id]')) {
            if (el.dataset.spareId === sid) return el;
        }
        return null;
    }

    function updateReqWorkRowFocusHighlight(prevId, nextId) {
        const scroll = document.getElementById('reqWorkListScroll');
        if (!scroll) return false;
        const clearSel = (id) => {
            if (!id) return;
            const table = findReqWorkRowTable(id);
            table?.querySelectorAll('.spare-row').forEach(tr => {
                tr.classList.remove('spare-row-focused', 'row-selected');
            });
        };
        const setSel = (id) => {
            if (!id) return;
            const table = findReqWorkRowTable(id);
            table?.querySelectorAll('.spare-row').forEach(tr => {
                tr.classList.add('spare-row-focused', 'row-selected');
            });
        };
        clearSel(prevId);
        setSel(nextId);
        return !!findReqWorkRowTable(nextId) || !nextId;
    }

    function syncReqWorkSingleGroupHeader(st) {
        if (reqWorkUsesGroupedList(st)) return;
        const block = document.getElementById('reqWorkEditBlock');
        if (!block) return;
        const m = modState(st);
        if (m.inlineEditId && m.inlineDraft?.header) {
            block.innerHTML = renderSpareEditBlockHtml(st);
        } else {
            block.innerHTML = renderSpareGroupHeaderHtml(st, { focusedId: m.reqWorkFocusedId });
        }
    }

    function scrollReqWorkRowIntoView(spareId) {
        const st = getState();
        const scroll = document.getElementById('reqWorkListScroll');
        if (!scroll || !spareId) return;
        if (vlReqWork && scroll.querySelector('.vl-inner')) {
            const idx = (_reqWorkCachedList || []).findIndex(s => reqWorkSameSpareId(s.id, spareId));
            if (idx < 0) return;
            const rowH = TVC_VirtualList.ROW_H || 36;
            const viewH = scroll.clientHeight || 400;
            const rowTop = idx * rowH;
            const rowBottom = rowTop + rowH;
            if (rowTop < scroll.scrollTop) scroll.scrollTop = rowTop;
            else if (rowBottom > scroll.scrollTop + viewH) scroll.scrollTop = rowBottom - viewH;
            return;
        }
        findReqWorkRowTable(spareId)?.scrollIntoView({ block: 'nearest' });
    }

    function focusReqWorkRequestInput(spareId) {
        if (!spareId || reqWorkFormLocked()) return;
        const table = findReqWorkRowTable(spareId);
        const input = table?.querySelector('.spare-req-qty-input:not([disabled])');
        if (input) {
            input.focus();
            input.select();
        }
    }

    function reqWorkApplyRowFocus(spareId, focusQty = false) {
        const st = getState();
        const prevId = getFocusedSpareId(st);
        setFocusedSpareId(st, spareId || null);
        syncReqWorkSingleGroupHeader(st);
        scrollReqWorkRowIntoView(spareId);
        const scroll = document.getElementById('reqWorkListScroll');
        if (reqWorkUsesGroupedList(st)) {
            if (!updateReqWorkRowFocusHighlight(prevId, spareId)) mountReqWorkGroupedList();
        } else if (vlReqWork && scroll?.querySelector('.vl-inner')) {
            vlReqWork.refresh();
        } else {
            refreshReqWorkListRows();
        }
        syncSpareItemHistoryBtns();
        if (focusQty && spareId && reqWorkEditable()) {
            const spare = (st.spares || []).find(s => reqWorkSameSpareId(s.id, spareId));
            if (spare && reqWorkRowChecked(spare)) {
                requestAnimationFrame(() => {
                    focusReqWorkRequestInput(spareId);
                    requestAnimationFrame(() => focusReqWorkRequestInput(spareId));
                });
            }
        }
    }

    function reqWorkMoveFocusRow(delta) {
        if (!reqWorkEditable()) return;
        const st = getState();
        const list = reqWorkNavigableSpares(st);
        if (!list.length) return;
        const curId = getFocusedSpareId(st);
        let idx = list.findIndex(s => reqWorkSameSpareId(s.id, curId));
        if (idx < 0) idx = delta > 0 ? -1 : list.length;
        const next = list[idx + delta];
        if (!next) return;
        reqWorkApplyRowFocus(next.id, true);
    }

    function onReqWorkListKeydown(e) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (!reqWorkEditable()) return;
        const t = e.target;
        if (!t.closest?.('#reqWorkListScroll')) return;
        if (t.tagName === 'INPUT' && !t.classList.contains('spare-req-qty-input')) return;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
        e.preventDefault();
        reqWorkMoveFocusRow(e.key === 'ArrowDown' ? 1 : -1);
    }

    function bindReqWorkListKeyboard() {
        const modal = document.getElementById('spareReqWorkModal');
        if (!modal || modal._reqWorkKeyBound) return;
        modal._reqWorkKeyBound = true;
        modal.addEventListener('keydown', onReqWorkListKeydown, true);
    }

    function reqWorkFocusRow(spareId, focusQty = false) {
        if (spareId) reqWorkApplyRowFocus(spareId, focusQty);
        else {
            setFocusedSpareId(getState(), null);
            refreshReqWorkListRows();
        }
    }

    function reqWorkToggleRow(spareId, checked) {
        if (reqWorkFormLocked()) return;
        const req = getReqWorkSession();
        if (!req) return;
        const sid = reqWorkSpareIdKey(spareId);
        captureReqWorkMeta();
        req.lines = req.lines || [];
        const spare = (getState().spares || []).find(s => reqWorkSameSpareId(s.id, sid));
        if (checked) {
            let line = req.lines.find(l => reqWorkSameSpareId(l.spare_part_id, sid));
            if (!line && spare) {
                line = buildReqLine(spare, 0);
                req.lines.push(line);
            }
        } else {
            req.lines = req.lines.filter(l => !reqWorkSameSpareId(l.spare_part_id, sid));
        }
        syncRequisitionDraftFromLines();
        syncReqLineMap();
        if (modState(getState()).reqWorkShowSelectedOnly && !reqWorkCheckedSpareCount(getState())) {
            modState(getState()).reqWorkShowSelectedOnly = false;
        }
        refreshReqWorkListUi();
    }

    function reqWorkSetRequestQty(spareId, rawQty) {
        if (reqWorkFormLocked()) return;
        const req = getReqWorkSession();
        if (!req) return;
        const sid = reqWorkSpareIdKey(spareId);
        captureReqWorkMeta();
        const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
        req.lines = req.lines || [];
        let line = req.lines.find(l => reqWorkSameSpareId(l.spare_part_id, sid));
        const spare = (getState().spares || []).find(s => reqWorkSameSpareId(s.id, sid));
        if (!line && spare) {
            line = buildReqLine(spare, qty);
            req.lines.push(line);
        } else if (line) {
            line.qty_requested = qty;
        }
        syncRequisitionDraftFromLines();
        syncReqLineMap();
        refreshReqWorkListUi();
        syncReqWorkSaveBtn();
    }

    function reqWorkSetReceivedQty(spareId, rawQty) {
        if (reqWorkFormLocked() || !reqWorkReceivedQtyEditable()) return;
        const req = getReqWorkSession();
        if (!req) return;
        const sid = reqWorkSpareIdKey(spareId);
        const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
        const line = (req.lines || []).find(l => reqWorkSameSpareId(l.spare_part_id, sid));
        if (!line) return;
        line.qty_received = qty;
        syncReqLineMap();
        syncReportedWaitMap().then(() => {
            refreshReqWorkListUi();
            refreshReqListUi();
        });
    }

    async function reqWorkAddSpare(spareId, silent = false) {
        const req = getReqWorkSession()
            || (_reqSheet.reqId ? await TVC_Inventory.getRequisition(_reqSheet.reqId) : null);
        if (!req) return false;
        const sid = reqWorkSpareIdKey(spareId);
        if ((req.lines || []).some(l => reqWorkSameSpareId(l.spare_part_id, sid))) {
            if (!silent) alert('Part already added.');
            return false;
        }
        const spare = (getState().spares || []).find(s => reqWorkSameSpareId(s.id, sid));
        if (!spare) return false;
        req.lines = req.lines || [];
        req.lines.push(buildReqLine(spare, 0));
        syncRequisitionDraftFromLines();
        if (!_reqWorkDraft) await TVC_Inventory.saveRequisition(req);
        await syncReqLineMap();
        if (!silent) {
            captureReqWorkMeta();
            refreshReqWorkListUi();
        }
        return true;
    }

    /** SPARE 목록에서 선택한 부품을 New Requisition draft로 복사 (체크 상태는 목록·청구서 각각 독립) */
    async function addToRequisition() {
        const st = getState();
        if (!canCreateRequisition(st)) {
            return alert('No permission to create requisitions.');
        }
        const ids = spareListSelectedIds(st);
        if (!ids.length) return alert('Select parts using the checkbox.');

        const m = modState(st);
        const writableOpen = m.reqWorkOpen && !m.reqWorkEditMode && !m.reqWorkPreview && !m.reqWorkCompleted;
        if (!writableOpen) {
            await openNewRequisitionWindow();
        }

        let added = 0;
        for (const id of ids) {
            if (await reqWorkAddSpare(id, true)) added++;
        }
        syncRequisitionDraftFromLines();
        clearSpareListSelection(st);
        captureReqWorkMeta();
        refreshList();
        refreshReqWorkListUi();
        if (added) alert(`${added} part(s) added to requisition.`);
        else alert('Selected parts are already on the requisition or cannot be added.');
    }

    async function reqWorkAddChecked() {
        await addToRequisition();
    }

    function spareListExportContext() {
        const st = getState();
        const list = _cachedList.length ? _cachedList : filteredSpares(st);
        const ship = document.getElementById('cmaxsShipName')?.textContent?.trim() || '—';
        const dept = window.TVC_RBAC ? TVC_RBAC.getDeptLabel(st.department) : 'All';
        const filterParts = [];
        const q = spareListSearchQuery(st);
        if (q) filterParts.push(`Search: "${q}"`);
        const sf = spareActiveFilterLabel(modState(st));
        if (sf) filterParts.push(`Filter: ${sf}`);
        const gLabel = groupFilterLabel(st);
        if (gLabel) filterParts.push(`Group: ${gLabel}`);
        const rows = list.map(s => {
            const pipe = sparePipelineCols(s);
            return {
                code: spareNumbering(s),
                class: spareClass(s) === '—' ? '' : spareClass(s),
                item: s.name || '',
                partNo: spareDrawingNo(s) || '',
                unit: spareUnit(s),
                working: String(spareWorking(s) || ''),
                standard: String(spareStandardQty(s)),
                stock: String(pipe.stock),
                awaiting: String(pipe.awaiting),
                need: pipe.need == null ? '—' : String(pipe.need),
            };
        });
        return { ship, dept, filterParts, rows, count: list.length, exportedAt: new Date() };
    }

    function buildPrintBody() {
        const ctx = spareListExportContext();
        const filterNote = ctx.filterParts.length
            ? `<p class="meta">${ctx.filterParts.map(p => esc(p)).join(' · ')}</p>` : '';
        const rows = ctx.rows.map(r => `<tr>
            <td>${esc(r.code)}</td>
            <td>${esc(r.class)}</td>
            <td>${esc(r.item)}</td>
            <td>${esc(r.partNo || '—')}</td>
            <td>${esc(r.unit)}</td>
            <td>${esc(r.working)}</td>
            <td>${esc(r.standard)}</td>
            <td>${esc(r.stock)}</td>
            <td>${esc(r.awaiting)}</td>
            <td>${esc(r.need)}</td>
        </tr>`).join('');
        return `<h1>SPARE Parts List</h1>
            <p class="meta">${esc(ctx.ship)} · ${esc(ctx.dept)} · ${ctx.exportedAt.toLocaleString()}</p>
            ${filterNote}
            <p class="meta">${ctx.count} part${ctx.count === 1 ? '' : 's'}</p>
            <table><tr>
                <th>Code</th><th>Class</th><th>Item</th><th>Part No.</th>
                <th>Unit</th><th title="${SPARE_COL_WORK_TITLE}">${SPARE_COL_WORK}</th><th title="${SPARE_COL_STD_TITLE}">${SPARE_COL_STD}</th><th title="${SPARE_COL_ROB_TITLE}">${SPARE_COL_ROB}</th><th title="${SPARE_COL_WAIT_TITLE}">${SPARE_COL_WAIT}</th><th title="${SPARE_COL_NEED_TITLE}">${SPARE_COL_NEED}</th>
            </tr>${rows || '<tr><td colspan="10">No parts to print.</td></tr>'}</table>`;
    }

    async function exportPartsListXlsx() {
        const ctx = spareListExportContext();
        if (!ctx.rows.length) return alert('No parts to export.');
        if (typeof TVC_Excel === 'undefined' || !TVC_Excel.exportSparePartsList) {
            return alert('Excel export is not available.');
        }
        try {
            await TVC_Excel.exportSparePartsList(ctx);
        } catch (e) {
            alert(e.message || 'Export failed');
        }
    }

    function exportPartsList() {
        const spares = (getState().spares || []).map(canon);
        if (!spares.length) return alert('No parts to export.');
        const headers = ['Code', 'Class', 'Item', 'Part No', 'Unit', SPARE_COL_WORK, SPARE_COL_STD, SPARE_COL_ROB, 'Group'];
        const rows = spares.map(s => [
            spareNumbering(s),
            spareClass(s) === '—' ? '' : spareClass(s),
            s.name || '',
            partNo(s),
            s.unit || '',
            s.workingStock ?? s.working_stock ?? '',
            s.standardStock ?? s.standard_stock ?? '',
            TVC_Inventory.currentStock(s),
            s.group || '',
        ]);
        const csv = [headers, ...rows]
            .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
            .join('\r\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `spare-parts-list-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function showSpicsModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
    function closeSpicsModal(id) { document.getElementById(id)?.classList.add('hidden'); }

    // ── Consumed Spare Parts (New Requisition 스타일 모달) ───────────────
    const CONSUME_PICK_Z = 10060;

    function newConsumeJobRow(overrides = {}) {
        return {
            job_code: overrides.job_code || '',
            sort1: overrides.sort1 || '',
            sort2: overrides.sort2 || '',
            job_detail: overrides.job_detail || '',
        };
    }

    function ensureConsumeJobItems(draft) {
        if (!draft) return [];
        if (!Array.isArray(draft.job_items) || !draft.job_items.length) {
            draft.job_items = [newConsumeJobRow({
                job_code: draft.job_code || '',
                sort1: draft.sort1 || '',
                sort2: draft.sort2 || '',
                job_detail: draft.job_detail || '',
            })];
        }
        return draft.job_items;
    }

    function syncConsumeDraftJobSummary(draft) {
        ensureConsumeJobItems(draft);
        const items = draft.job_items;
        const codes = items.map(i => String(i.job_code || '').trim()).filter(Boolean);
        draft.job_code = codes.length > 1 ? codes.join(', ') : (codes[0] || '');
        const first = items[0] || newConsumeJobRow();
        draft.sort1 = first.sort1 || '';
        draft.sort2 = first.sort2 || '';
        draft.job_detail = first.job_detail || '';
    }

    function consumeLogJobItems(log) {
        if (!log) return [];
        if (Array.isArray(log.job_items) && log.job_items.length) {
            return log.job_items.map(i => newConsumeJobRow(i));
        }
        if (log.job_code || log.sort1 || log.sort2 || log.job_detail) {
            return [newConsumeJobRow({
                job_code: log.job_code || '',
                sort1: log.sort1 || '',
                sort2: log.sort2 || '',
                job_detail: log.job_detail || '',
            })];
        }
        return [newConsumeJobRow()];
    }

    function consumeJobBatchEnabled(draft, ro) {
        if (ro) return false;
        return !(draft?.work_report_id || draft?.source === 'work_report');
    }

    function newConsumeDraft(st, user) {
        const today = new Date().toISOString().slice(0, 10);
        return {
            consumed_date: today,
            made_on: today,
            made_by: spareReportedByForUser(user),
            list_status: SPARE_LIST_STATUS.DRAFT,
            confirmed_by: '',
            confirmed_at: '',
            approved_by: '',
            approved_at: '',
            spare_group_key: '',
            spare_group_label: '',
            job_code: '',
            sort1: '',
            sort2: '',
            job_detail: '',
            job_items: [newConsumeJobRow()],
            ships_comments: '',
            lines: [],
        };
    }

    function isCriticalMaintenanceJob(j) {
        if (!j) return false;
        const sort = String(j.sort || '').trim().toUpperCase();
        if (sort.startsWith('C.') || sort.includes('CRITICAL')) return true;
        return String(j.item_sort1 || '').toUpperCase().includes('CRITICAL');
    }

    function consumeJobsForGroup(st, groupKey) {
        if (!st.idx && (st.jobs || []).length && window.TVC_Indexes) {
            st.idx = TVC_Indexes.build(st);
        }
        if (!st.idx) return [];
        let jobs = (st.jobs || []).filter(j => !st.department || j.department === st.department);
        if (groupKey === CRITICAL_GROUP_KEY) {
            jobs = jobs.filter(isCriticalMaintenanceJob);
        } else if (groupKey === MERGED_GEN_ENGINE_KEY) {
            jobs = jobs.filter(j => isGeneratorEngineGroupLabel(j.group));
        } else if (groupKey) {
            const set = new Set(st.idx.jobsByGroupKey.get(groupKey) || []);
            jobs = jobs.filter(j => set.has(j.id));
        }
        return jobs.sort((a, b) => String(a.job_code || '').localeCompare(String(b.job_code || '')));
    }

    function consumePickMenuEl(wrap) {
        return wrap?._portalMenu || wrap?.querySelector('.spare-consume-pick-menu') || null;
    }

    function consumePickClickInside(wrap, target) {
        if (!wrap || !target) return false;
        const menu = consumePickMenuEl(wrap);
        return wrap.contains(target) || (menu && menu.contains(target));
    }

    function closeConsumePickMenu(wrap) {
        if (!wrap) return;
        const menu = consumePickMenuEl(wrap);
        if (menu) {
            menu.classList.remove('spare-consume-pick-menu-portal');
            menu.style.cssText = '';
            if (wrap._portalMenu && menu.parentNode === document.body) wrap.appendChild(menu);
        }
        wrap.classList.remove('open');
    }

    function positionConsumePickMenu(wrap, minWidth = 300) {
        const trigger = wrap.querySelector('.spare-consume-pick-trigger');
        let menu = wrap.querySelector('.spare-consume-pick-menu');
        if (!trigger || !menu) return;
        if (!wrap._portalMenu) wrap._portalMenu = menu;
        if (menu.parentNode !== document.body) document.body.appendChild(menu);
        menu.classList.add('spare-consume-pick-menu-portal');
        const r = trigger.getBoundingClientRect();
        menu.style.display = 'flex';
        menu.style.flexDirection = 'column';
        menu.style.position = 'fixed';
        menu.style.left = `${r.left}px`;
        menu.style.top = `${r.bottom + 2}px`;
        menu.style.minWidth = `${Math.max(minWidth, r.width)}px`;
        menu.style.width = `${Math.max(minWidth, r.width)}px`;
        menu.style.zIndex = String(CONSUME_PICK_Z);
        menu.style.maxHeight = 'min(420px, 70vh)';
    }

    function closeAllConsumeMetaPicks() {
        closeConsumePickMenu(document.getElementById('consumeGroupPick'));
        closeConsumeJobPickMenu();
    }

    function closeConsumeJobPickMenu() {
        unbindConsumeJobPickListeners();
        const menu = document.getElementById('consumeJobPickMenu');
        if (!menu) return;
        menu.classList.remove('spare-consume-pick-menu-portal', 'open');
        menu.style.cssText = 'display:none';
        if (menu.parentNode === document.body) {
            const host = document.getElementById('consumeJobPickHost');
            if (host) host.appendChild(menu);
            else menu.remove();
        }
    }

    function positionConsumeJobPickMenu(rowIdx = 0) {
        const trigger = document.getElementById(`consumeJobPickTrigger-${rowIdx}`);
        const menu = document.getElementById('consumeJobPickMenu');
        if (!trigger || !menu) return;
        if (!menu._portalAttached) menu._portalAttached = true;
        if (menu.parentNode !== document.body) document.body.appendChild(menu);
        menu.classList.add('spare-consume-pick-menu-portal');
        const r = trigger.getBoundingClientRect();
        menu.style.display = 'flex';
        menu.style.flexDirection = 'column';
        menu.style.position = 'fixed';
        menu.style.left = `${r.left}px`;
        menu.style.top = `${r.bottom + 2}px`;
        menu.style.minWidth = `${Math.max(420, r.width)}px`;
        menu.style.width = `${Math.max(420, r.width)}px`;
        menu.style.zIndex = String(CONSUME_PICK_Z);
        menu.style.maxHeight = 'min(420px, 70vh)';
    }

    function buildConsumeLine(spare, qty) {
        const c = canon(spare);
        return {
            spare_part_id: c.id || spare.id,
            part_no: spareNumbering(c) || spare.part_no || '',
            name: c.name || spare.name || '',
            qty_consumed: Math.max(0, Math.floor(Number(qty) || 0)),
        };
    }

    function findJobByCode(st, jobCode) {
        const code = String(jobCode || '').trim().toLowerCase();
        if (!code) return null;
        return (st.jobs || []).find(j => String(j.job_code || '').trim().toLowerCase() === code) || null;
    }

    function applyConsumeJobFields(job, rowIdx = _consumeActiveJobRowIndex || 0) {
        const draft = getConsumeSession();
        if (!draft || !job) return;
        ensureConsumeJobItems(draft);
        const row = draft.job_items[rowIdx] || draft.job_items[0];
        if (!row) return;
        row.job_code = job.job_code || '';
        row.sort1 = job.item_sort1 || '';
        row.sort2 = job.item_sort2 || '';
        row.job_detail = job.job_detail || '';
        syncConsumeDraftJobSummary(draft);
    }

    function captureConsumeMeta() {
        const draft = getConsumeSession();
        if (!draft) return;
        const g = (id) => document.getElementById(id)?.value ?? '';
        draft.consumed_date = g('consumeDate');
        draft.made_on = g('consumeMadeOn');
        draft.made_by = resolveSpareReportedBy(draft, spareInventoryUser(getState()));
        draft.ships_comments = g('consumeShipComments');
        const rowEls = document.querySelectorAll('[data-consume-job-row]');
        if (rowEls.length) {
            draft.job_items = [...rowEls].map(rowEl => ({
                job_code: String(rowEl.querySelector('[data-field="job_code"]')?.value ?? '').trim(),
                sort1: rowEl.querySelector('[data-field="sort1"]')?.value ?? '',
                sort2: rowEl.querySelector('[data-field="sort2"]')?.value ?? '',
                job_detail: rowEl.querySelector('[data-field="job_detail"]')?.value ?? '',
            }));
        } else {
            draft.job_items = [newConsumeJobRow({
                job_code: g('consumeJobCode').trim(),
                sort1: g('consumeSort1'),
                sort2: g('consumeSort2'),
                job_detail: g('consumeJobDetail'),
            })];
        }
        syncConsumeDraftJobSummary(draft);
        updateConsumeHeadStats();
    }

    function captureConsumeLineQtys() {
        const draft = getConsumeSession();
        if (!draft) return;
        document.querySelectorAll('#consumeListScroll [data-spare-id]').forEach(table => {
            const spareId = consumeSpareIdKey(table.dataset.spareId);
            const input = table.querySelector('.spare-consume-qty-input');
            if (!input || !spareId) return;
            const qty = Math.max(0, Math.floor(Number(input.value) || 0));
            const line = (draft.lines || []).find(l => consumeSameSpareId(l.spare_part_id, spareId));
            if (line) line.qty_consumed = qty;
        });
    }

    function consumeLookupJobFromInput() {
        const st = getState();
        captureConsumeMeta();
        const draft = getConsumeSession();
        if (!draft) return;
        const job = findJobByCode(st, draft.job_code);
        if (job) applyConsumeJobFields(job);
        renderConsumeMetaFields();
    }

    function renderConsumeMetaFields() {
        const draft = getConsumeSession();
        if (!draft) return;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
        set('consumeDate', fmtSpareDate(draft.consumed_date));
        set('consumeMadeOn', fmtSpareDate(draft.made_on));
        set('consumeMadeBy', resolveSpareReportedBy(draft, spareInventoryUser(getState())));
        set('consumeShipComments', draft.ships_comments);
        const groupText = document.getElementById('consumeGroupPickText');
        if (groupText) {
            groupText.textContent = draft.spare_group_label
                ? safeTreeLabel(draft.spare_group_label)
                : '— PMS Group 선택 —';
        }
        renderConsumeJobRowsSection();
    }

    function renderConsumeJobRowFieldHtml(row, idx, opts = {}) {
        const ro = !!opts.readonly;
        const batch = !!opts.batch;
        const roAttr = ro ? ' readonly disabled' : '';
        const jobDisabled = !opts.groupKey;
        const head = (label, forId) => idx === 0
            ? `<label class="spare-consume-meta-col-head" for="${forId}">${label}</label>`
            : '';
        const jobField = ro
            ? `<input type="text" class="spare-req-meta-input spare-consume-meta-input" data-field="job_code" value="${esc(row.job_code || '')}"${roAttr}>`
            : `<button type="button" id="consumeJobPickTrigger-${idx}" class="spare-consume-pick-trigger spare-consume-job-pick-trigger"${jobDisabled ? ' disabled' : ''} onclick="TVC_SpareMenu.toggleConsumeJobPick(event, ${idx})">
                    <span class="spare-consume-pick-text">${esc(row.job_code || '— Select JOB CODE —')}</span>
                    <span class="spare-consume-pick-caret" aria-hidden="true">▾</span>
                </button>
                <input type="hidden" data-field="job_code" value="${escAttr(row.job_code || '')}">`;
        const rmBtn = batch && !ro && (opts.rowCount || 0) > 1
            ? `<button type="button" class="btn btn-sm spare-consume-job-row-rm" onclick="TVC_SpareMenu.removeConsumeJobRow(${idx})" title="Remove job row" aria-label="Remove job row">×</button>`
            : '';
        return `<div class="spare-consume-meta-job-grid spare-consume-meta-job-row${batch ? ' batch' : ''}" data-consume-job-row="${idx}">
                <div class="spare-consume-meta-job-col spare-consume-meta-job-col-job">
                    ${head('JOB CODE', `consumeJobPickTrigger-${idx}`)}
                    ${jobField}
                </div>
                <div class="spare-consume-meta-job-col">
                    ${head('SORT-1', `consumeSort1-${idx}`)}
                    <input type="text" id="consumeSort1-${idx}" data-field="sort1" class="spare-req-meta-input spare-consume-meta-input" value="${esc(row.sort1 || '')}"${roAttr}${ro ? '' : ' onchange="TVC_SpareMenu.captureConsumeMeta()"'}>
                </div>
                <div class="spare-consume-meta-job-col">
                    ${head('SORT-2', `consumeSort2-${idx}`)}
                    <input type="text" id="consumeSort2-${idx}" data-field="sort2" class="spare-req-meta-input spare-consume-meta-input" value="${esc(row.sort2 || '')}"${roAttr}${ro ? '' : ' onchange="TVC_SpareMenu.captureConsumeMeta()"'}>
                </div>
                <div class="spare-consume-meta-job-col spare-consume-meta-job-col-detail">
                    ${head('JOB DETAIL', `consumeJobDetail-${idx}`)}
                    <input type="text" id="consumeJobDetail-${idx}" data-field="job_detail" class="spare-req-meta-input spare-consume-meta-input" value="${esc(row.job_detail || '')}"${roAttr}${ro ? '' : ' onchange="TVC_SpareMenu.captureConsumeMeta()"'}>
                </div>
                ${batch ? `<div class="spare-consume-meta-job-col spare-consume-meta-job-col-act">${rmBtn}</div>` : ''}
            </div>`;
    }

    function renderConsumeJobRowsInner(draft, opts = {}) {
        ensureConsumeJobItems(draft);
        const items = draft.job_items;
        const batch = consumeJobBatchEnabled(draft, opts.readonly);
        const rows = items.map((row, idx) => renderConsumeJobRowFieldHtml(row, idx, {
            readonly: opts.readonly,
            batch,
            groupKey: draft.spare_group_key,
            rowCount: items.length,
        })).join('');
        const addBtn = batch
            ? `<div class="spare-consume-meta-job-add">
                <button type="button" class="btn btn-sm spare-consume-job-row-add" onclick="TVC_SpareMenu.addConsumeJobRow()" title="Add JOB CODE row">+</button>
               </div>`
            : '';
        return rows + addBtn;
    }

    function renderConsumeJobRowsSection() {
        const draft = getConsumeSession();
        const container = document.getElementById('consumeJobRows');
        if (!container || !draft) return;
        const ro = container.dataset.readonly === '1';
        container.innerHTML = renderConsumeJobRowsInner(draft, { readonly: ro });
        document.querySelectorAll(`[id^="consumeJobPickTrigger-"]`).forEach(el => {
            el.disabled = !draft.spare_group_key;
        });
    }

    function addConsumeJobRow() {
        captureConsumeMeta();
        const draft = getConsumeSession();
        if (!draft || !consumeJobBatchEnabled(draft, false)) return;
        ensureConsumeJobItems(draft);
        draft.job_items.push(newConsumeJobRow());
        renderConsumeJobRowsSection();
    }

    function removeConsumeJobRow(idx) {
        captureConsumeMeta();
        const draft = getConsumeSession();
        if (!draft || !consumeJobBatchEnabled(draft, false)) return;
        ensureConsumeJobItems(draft);
        if (draft.job_items.length <= 1) return;
        draft.job_items.splice(idx, 1);
        if (_consumeActiveJobRowIndex >= draft.job_items.length) {
            _consumeActiveJobRowIndex = Math.max(0, draft.job_items.length - 1);
        }
        renderConsumeJobRowsSection();
    }

    // ── Page 2 (WR / Defect) — multi JOB CODE rows ─────────────────────
    function setPage2JobContext(ctx) {
        _page2JobCtx = ctx ? {
            items: ctx.items,
            groupKey: ctx.groupKey || '',
            readonly: !!ctx.readonly,
            allowAdd: !!ctx.allowAdd,
        } : null;
    }

    function getPage2JobContext() {
        return _page2JobCtx;
    }

    function capturePage2JobItems() {
        const ctx = getPage2JobContext();
        if (!ctx?.items) return [];
        const container = document.getElementById('page2JobRows');
        if (!container) return ctx.items;
        const rowEls = container.querySelectorAll('[data-page2-job-row]');
        if (rowEls.length) {
            ctx.items.length = 0;
            rowEls.forEach(rowEl => {
                ctx.items.push({
                    job_code: rowEl.querySelector('[data-field="job_code"]')?.value?.trim()
                        || rowEl.querySelector('.spare-consume-pick-text')?.textContent?.trim()
                        || '',
                    sort1: rowEl.querySelector('[data-field="sort1"]')?.value?.trim() || '',
                    sort2: rowEl.querySelector('[data-field="sort2"]')?.value?.trim() || '',
                    job_detail: rowEl.querySelector('[data-field="job_detail"]')?.value?.trim() || '',
                });
            });
        }
        return ctx.items;
    }

    function renderPage2MaintJobRowHtml(row, idx, opts = {}) {
        const ro = !!opts.readonly;
        const batch = !!opts.batch;
        const jobDisabled = !opts.groupKey;
        const fld = (label, inner) => `<div class="wr-maint-field"><label>${label}</label>${inner}</div>`;
        const roInp = (val, field) => field
            ? `<input class="wr-ro" data-field="${field}" value="${esc(val || '')}" readonly tabindex="-1">`
            : `<input class="wr-ro" value="${esc(val || '')}" readonly tabindex="-1">`;
        let jobInner;
        if (ro) {
            jobInner = roInp(row.job_code, 'job_code');
        } else {
            jobInner = `<button type="button" id="page2JobPickTrigger-${idx}" class="wr-maint-job-pick spare-consume-job-pick-trigger"${jobDisabled ? ' disabled' : ''} onclick="TVC_SpareMenu.togglePage2JobPick(event, ${idx})">
                    <span class="spare-consume-pick-text">${esc(row.job_code || '— Select JOB CODE —')}</span>
                    <span class="spare-consume-pick-caret" aria-hidden="true">▾</span>
                </button>
                <input type="hidden" data-field="job_code" value="${escAttr(row.job_code || '')}">`;
        }
        const sort1Inner = ro
            ? roInp(row.sort1, 'sort1')
            : `<input type="text" id="page2Sort1-${idx}" data-field="sort1" class="wr-ro" value="${esc(row.sort1 || '')}" readonly tabindex="-1">`;
        const sort2Inner = ro
            ? roInp(row.sort2, 'sort2')
            : `<input type="text" id="page2Sort2-${idx}" data-field="sort2" class="wr-ro" value="${esc(row.sort2 || '')}" readonly tabindex="-1">`;
        const detailInner = ro
            ? roInp(row.job_detail, 'job_detail')
            : `<input type="text" id="page2JobDetail-${idx}" data-field="job_detail" class="wr-ro" value="${esc(row.job_detail || '')}" readonly tabindex="-1">`;
        const actCol = batch && !ro && (opts.rowCount || 0) > 1
            ? `<div class="wr-maint-field wr-page2-job-row-act"><label aria-hidden="true">&nbsp;</label><button type="button" class="btn btn-sm spare-consume-job-row-rm" onclick="TVC_SpareMenu.removePage2JobRow(${idx})" title="Remove job row" aria-label="Remove job row">×</button></div>`
            : '';
        const gapCls = idx === 0 ? ' wr-maint-grid-gap' : '';
        const gridCols = actCol ? ' wr-maint-grid-4 wr-page2-job-grid-batch' : ' wr-maint-grid-4';
        return `<div class="wr-maint-grid${gridCols}${gapCls} wr-page2-job-row" data-page2-job-row="${idx}" data-job-id="${escAttr(row.maintenance_job_id || '')}">
                ${fld('Job Code', jobInner)}
                ${fld('SORT-1', sort1Inner)}
                ${fld('SORT-2', sort2Inner)}
                ${fld('Job Detail', detailInner)}
                ${actCol}
            </div>`;
    }

    function renderPage2JobRowFieldHtml(row, idx, opts = {}) {
        if (opts.maintStyle) return renderPage2MaintJobRowHtml(row, idx, opts);
        const ro = !!opts.readonly;
        const batch = !!opts.batch;
        const roAttr = ro ? ' readonly disabled' : '';
        const jobDisabled = !opts.groupKey;
        const head = (label, forId) => idx === 0
            ? `<label class="spare-consume-meta-col-head" for="${forId}">${label}</label>`
            : '';
        const jobField = ro
            ? `<input type="text" class="spare-req-meta-input spare-consume-meta-input" data-field="job_code" value="${esc(row.job_code || '')}"${roAttr}>`
            : `<button type="button" id="page2JobPickTrigger-${idx}" class="spare-consume-pick-trigger spare-consume-job-pick-trigger"${jobDisabled ? ' disabled' : ''} onclick="TVC_SpareMenu.togglePage2JobPick(event, ${idx})">
                    <span class="spare-consume-pick-text">${esc(row.job_code || '— Select JOB CODE —')}</span>
                    <span class="spare-consume-pick-caret" aria-hidden="true">▾</span>
                </button>
                <input type="hidden" data-field="job_code" value="${escAttr(row.job_code || '')}">`;
        const rmBtn = batch && !ro && (opts.rowCount || 0) > 1
            ? `<button type="button" class="btn btn-sm spare-consume-job-row-rm" onclick="TVC_SpareMenu.removePage2JobRow(${idx})" title="Remove job row" aria-label="Remove job row">×</button>`
            : '';
        return `<div class="spare-consume-meta-job-grid spare-consume-meta-job-row${batch ? ' batch' : ''}" data-page2-job-row="${idx}">
                <div class="spare-consume-meta-job-col spare-consume-meta-job-col-job">
                    ${head('JOB CODE', `page2JobPickTrigger-${idx}`)}
                    ${jobField}
                </div>
                <div class="spare-consume-meta-job-col">
                    ${head('SORT-1', `page2Sort1-${idx}`)}
                    <input type="text" id="page2Sort1-${idx}" data-field="sort1" class="spare-req-meta-input spare-consume-meta-input" value="${esc(row.sort1 || '')}"${roAttr}>
                </div>
                <div class="spare-consume-meta-job-col">
                    ${head('SORT-2', `page2Sort2-${idx}`)}
                    <input type="text" id="page2Sort2-${idx}" data-field="sort2" class="spare-req-meta-input spare-consume-meta-input" value="${esc(row.sort2 || '')}"${roAttr}>
                </div>
                <div class="spare-consume-meta-job-col spare-consume-meta-job-col-detail">
                    ${head('JOB DETAIL', `page2JobDetail-${idx}`)}
                    <input type="text" id="page2JobDetail-${idx}" data-field="job_detail" class="spare-req-meta-input spare-consume-meta-input" value="${esc(row.job_detail || '')}"${roAttr}>
                </div>
                ${batch ? `<div class="spare-consume-meta-job-col spare-consume-meta-job-col-act">${rmBtn}</div>` : ''}
            </div>`;
    }

    function renderPage2JobRowsInner(ctx, opts = {}) {
        if (!ctx?.items?.length) {
            ctx.items = [newConsumeJobRow()];
        }
        const items = ctx.items;
        const allowAdd = !!opts.allowAdd && !opts.readonly;
        const rows = items.map((row, idx) => renderPage2JobRowFieldHtml(row, idx, {
            readonly: opts.readonly,
            batch: allowAdd,
            groupKey: ctx.groupKey,
            rowCount: items.length,
            maintStyle: !!opts.maintStyle,
        })).join('');
        const addBtn = allowAdd
            ? `<div class="spare-consume-meta-job-add">
                <button type="button" class="btn btn-sm spare-consume-job-row-add" onclick="TVC_SpareMenu.addPage2JobRow()" title="Add JOB CODE row">+</button>
               </div>`
            : '';
        return rows + addBtn;
    }

    function renderPage2JobRowsSection() {
        const ctx = getPage2JobContext();
        const container = document.getElementById('page2JobRows');
        if (!container || !ctx) return;
        const ro = container.dataset.readonly === '1';
        const allowAdd = container.dataset.batch === '1';
        const maintStyle = container.dataset.maintStyle === '1';
        container.innerHTML = renderPage2JobRowsInner(ctx, { readonly: ro, allowAdd, maintStyle });
        document.querySelectorAll('[id^="page2JobPickTrigger-"]').forEach(el => {
            el.disabled = !ctx.groupKey;
        });
    }

    function addPage2JobRow() {
        const ctx = getPage2JobContext();
        if (!ctx?.allowAdd || ctx.readonly) return;
        capturePage2JobItems();
        ctx.items.push(newConsumeJobRow());
        renderPage2JobRowsSection();
    }

    function removePage2JobRow(idx) {
        const ctx = getPage2JobContext();
        if (!ctx?.allowAdd || ctx.readonly) return;
        capturePage2JobItems();
        if (ctx.items.length <= 1) return;
        ctx.items.splice(idx, 1);
        if (_page2ActiveJobRowIndex >= ctx.items.length) {
            _page2ActiveJobRowIndex = Math.max(0, ctx.items.length - 1);
        }
        renderPage2JobRowsSection();
    }

    function renderPage2JobPickMenuHtml() {
        return `<div id="page2JobPickHost" class="spare-consume-job-pick-host hidden" aria-hidden="true">
                <div id="page2JobPickMenu" class="spare-consume-pick-menu" role="listbox" aria-label="JOB CODE" style="display:none">
                    <div class="spare-consume-pick-search">
                        <input type="search" class="search-input" placeholder="Search JOB CODE / SORT / DETAIL…" value="${esc(_page2JobPickSearch)}"
                            oninput="TVC_SpareMenu.page2JobPickSearch(this.value)" onclick="event.stopPropagation()">
                    </div>
                    <div class="spare-consume-pick-scroll" id="page2JobPickList"></div>
                </div>
            </div>`;
    }

    function buildPage2JobPickListInner() {
        const ctx = getPage2JobContext();
        if (!ctx?.groupKey) {
            return '<div class="spare-consume-pick-empty muted">PMS Group No.를 먼저 선택하세요.</div>';
        }
        const q = (_page2JobPickSearch || '').toLowerCase().trim();
        const jobs = consumeJobsForGroup(getState(), ctx.groupKey).filter(j => {
            if (!q) return true;
            const hay = [j.job_code, j.item_sort1, j.item_sort2, j.job_detail].join(' ').toLowerCase();
            return hay.includes(q);
        });
        if (!jobs.length) {
            return '<div class="spare-consume-pick-empty muted">검색 결과 없음</div>';
        }
        const activeRow = ctx.items?.[_page2ActiveJobRowIndex || 0];
        const selectedCode = activeRow?.job_code || '';
        return jobs.map(j => {
            const sel = selectedCode === j.job_code ? ' selected' : '';
            const sub = [j.item_sort1, j.item_sort2].filter(Boolean).join(' · ');
            return `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-job${sel}"
                onclick="TVC_SpareMenu.pickPage2Job('${escAttr(j.id)}')">
                <span class="spare-consume-pick-job-code">${esc(j.job_code || '')}</span>
                ${sub ? `<span class="spare-consume-pick-job-sub">${esc(sub)}</span>` : ''}
            </button>`;
        }).join('');
    }

    function refreshPage2JobPickList() {
        const list = document.getElementById('page2JobPickList');
        if (list) list.innerHTML = buildPage2JobPickListInner();
    }

    function positionPage2JobPickMenu(rowIdx = 0) {
        const trigger = document.getElementById(`page2JobPickTrigger-${rowIdx}`);
        const menu = document.getElementById('page2JobPickMenu');
        if (!trigger || !menu) return;
        if (!menu._portalAttached) menu._portalAttached = true;
        if (menu.parentNode !== document.body) document.body.appendChild(menu);
        menu.classList.add('spare-consume-pick-menu-portal');
        const r = trigger.getBoundingClientRect();
        menu.style.display = 'flex';
        menu.style.flexDirection = 'column';
        menu.style.position = 'fixed';
        menu.style.left = `${r.left}px`;
        menu.style.top = `${r.bottom + 2}px`;
        menu.style.minWidth = `${Math.max(420, r.width)}px`;
        menu.style.width = `${Math.max(420, r.width)}px`;
        menu.style.zIndex = String(CONSUME_PICK_Z);
        menu.style.maxHeight = 'min(420px, 70vh)';
    }

    function closePage2JobPickMenu() {
        const host = document.getElementById('page2JobPickHost');
        const menu = document.getElementById('page2JobPickMenu');
        if (menu) {
            menu.classList.remove('spare-consume-pick-menu-portal');
            menu.style.cssText = 'display:none';
            if (menu.parentNode === document.body) {
                if (host) host.appendChild(menu);
                else menu.remove();
            }
        }
        if (host) host.classList.add('hidden');
    }

    function page2JobPickSearch(v) {
        _page2JobPickSearch = v || '';
        refreshPage2JobPickList();
        const menu = document.getElementById('page2JobPickMenu');
        if (menu?.style.display !== 'none') positionPage2JobPickMenu(_page2ActiveJobRowIndex || 0);
    }

    function togglePage2JobPick(ev, rowIdx) {
        ev?.stopPropagation();
        const ctx = getPage2JobContext();
        if (!ctx?.groupKey || ctx.readonly) return;
        _page2ActiveJobRowIndex = rowIdx;
        const host = document.getElementById('page2JobPickHost');
        const menu = document.getElementById('page2JobPickMenu');
        const trigger = document.getElementById(`page2JobPickTrigger-${rowIdx}`);
        if (!host || !menu || !trigger) return;
        const opening = menu.style.display === 'none' || !menu.style.display;
        closeConsumeJobPickMenu();
        if (!opening) {
            closePage2JobPickMenu();
            return;
        }
        refreshPage2JobPickList();
        positionPage2JobPickMenu(rowIdx);
        const close = (e) => {
            if (!menu.contains(e.target) && !trigger.contains(e.target)) {
                closePage2JobPickMenu();
                document.removeEventListener('click', close);
            }
        };
        setTimeout(() => document.addEventListener('click', close), 0);
    }

    function pickPage2Job(jobId) {
        const ctx = getPage2JobContext();
        const st = getState();
        if (!ctx) return;
        const job = st.idx?.jobById?.get(jobId) || st.jobs?.find(j => j.id === jobId);
        if (!job) return;
        capturePage2JobItems();
        const idx = _page2ActiveJobRowIndex || 0;
        ctx.items[idx] = newConsumeJobRow({
            job_code: job.job_code || '',
            sort1: job.item_sort1 || '',
            sort2: job.item_sort2 || '',
            job_detail: job.job_detail || '',
        });
        closePage2JobPickMenu();
        renderPage2JobRowsSection();
    }

    function jobRowFromMaintenanceJob(j) {
        if (!j) return newConsumeJobRow();
        return newConsumeJobRow({
            job_code: j.job_code || '',
            sort1: j.item_sort1 || '',
            sort2: j.item_sort2 || '',
            job_detail: j.job_detail || '',
        });
    }

    function buildPage2JobItemsFromJobs(jobs) {
        return (jobs || []).filter(Boolean).map(jobRowFromMaintenanceJob);
    }

    function teardownPage2JobContext() {
        closePage2JobPickMenu();
        _page2JobCtx = null;
        _page2JobPickSearch = '';
        _page2ActiveJobRowIndex = 0;
    }

    function consumeGroupLabelForKey(st, groupKey) {
        if (!groupKey) return '';
        if (groupKey === CRITICAL_GROUP_KEY) return 'Critical Equipment';
        return planGroupNodes(st).find(n => n.key === groupKey)?.label
            || st.idx?.groupNodes?.find(n => n.key === groupKey)?.label
            || '';
    }

    function applyConsumeMetaGroup(st, groupKey, groupLabel, opts = {}) {
        const draft = getConsumeSession();
        if (!draft) return;
        if (!opts.skipCapture) captureConsumeMeta();
        const prevKey = draft.spare_group_key;
        const key = groupKey || '';
        const label = String(groupLabel || '').trim() || consumeGroupLabelForKey(st, key);
        draft.spare_group_key = key;
        draft.spare_group_label = label;
        if (prevKey !== key) {
            draft.job_items = [newConsumeJobRow()];
            syncConsumeDraftJobSummary(draft);
        }
        if (!opts.skipMetaFields) renderConsumeMetaFields();
        if (!opts.skipRefresh) refreshConsumeJobPickList();
    }

    function renderConsumeGroupHeaderHtml(st) {
        const m = modState(st);
        return renderSpareGroupHeaderHtml(st, { focusedId: m.consumeFocusedId });
    }

    function buildConsumeGroupPickListInner(st) {
        const draft = getConsumeSession();
        const q = (_consumeGroupPickSearch || '').toLowerCase().trim();
        const matchNode = (n) => !q || safeTreeLabel(n.label).toLowerCase().includes(q)
            || String(n.department || '').toLowerCase().includes(q);
        const matchCritical = !q || 'critical equipment'.includes(q) || q.includes('critical') || q.includes('crit');
        let html = '';
        if (matchCritical) {
            const sel = draft?.spare_group_key === CRITICAL_GROUP_KEY ? ' selected' : '';
            html += `<button type="button" class="spare-consume-pick-item${sel}"
                onclick="TVC_SpareMenu.pickConsumeMetaGroup('${CRITICAL_GROUP_KEY}','${escAttr('Critical Equipment')}')">⚠ Critical Equipment</button>`;
        }
        const nodes = planGroupNodes(st).filter(matchNode);
        if (!nodes.length && !matchCritical) {
            return '<div class="spare-consume-pick-empty muted">Loading PMS GROUP Tree…</div>';
        }
        let curDept = '';
        nodes.forEach(n => {
            if (n.department !== curDept) {
                html += `<div class="spare-consume-pick-dept">${esc(n.department)}</div>`;
                curDept = n.department;
            }
            const sel = draft?.spare_group_key === n.key ? ' selected' : '';
            html += `<button type="button" class="spare-consume-pick-item${sel}"
                onclick="TVC_SpareMenu.pickConsumeMetaGroup('${escAttr(n.key)}','${escAttr(n.label)}')">${esc(safeTreeLabel(n.label))}</button>`;
        });
        return html || '<div class="spare-consume-pick-empty muted">No search results</div>';
    }

    function refreshConsumeGroupPickList() {
        const list = document.getElementById('consumeGroupPickList');
        if (!list) return;
        list.innerHTML = buildConsumeGroupPickListInner(getState());
    }

    function consumeGroupPickSearch(v) {
        _consumeGroupPickSearch = v || '';
        refreshConsumeGroupPickList();
        const wrap = document.getElementById('consumeGroupPick');
        if (wrap?.classList.contains('open')) positionConsumePickMenu(wrap, 360);
    }

    function toggleConsumeGroupPick(ev) {
        ev?.stopPropagation();
        const wrap = document.getElementById('consumeGroupPick');
        if (!wrap) return;
        const opening = !wrap.classList.contains('open');
        closeConsumeJobPickMenu();
        if (!opening) {
            closeConsumePickMenu(wrap);
            return;
        }
        wrap.classList.add('open');
        refreshConsumeGroupPickList();
        positionConsumePickMenu(wrap, 360);
        const close = (e) => {
            if (!consumePickClickInside(wrap, e.target)) {
                closeConsumePickMenu(wrap);
                document.removeEventListener('click', close);
                window.removeEventListener('scroll', onReposition, true);
                window.removeEventListener('resize', onReposition);
            }
        };
        const onReposition = () => {
            if (wrap.classList.contains('open')) positionConsumePickMenu(wrap, 360);
        };
        setTimeout(() => {
            document.addEventListener('click', close);
            window.addEventListener('scroll', onReposition, true);
            window.addEventListener('resize', onReposition);
        }, 0);
    }

    function pickConsumeMetaGroup(groupKey, groupLabel) {
        applyConsumeMetaGroup(getState(), groupKey, groupLabel);
        closeConsumePickMenu(document.getElementById('consumeGroupPick'));
    }

    function buildConsumeJobPickListInner(st) {
        const draft = getConsumeSession();
        if (!draft?.spare_group_key) {
            return '<div class="spare-consume-pick-empty muted">Select PMS Group No. first.</div>';
        }
        const q = (_consumeJobPickSearch || '').toLowerCase().trim();
        const jobs = consumeJobsForGroup(st, draft.spare_group_key).filter(j => {
            if (!q) return true;
            const hay = [j.job_code, j.item_sort1, j.item_sort2, j.job_detail].join(' ').toLowerCase();
            return hay.includes(q);
        });
        if (!jobs.length) {
            return '<div class="spare-consume-pick-empty muted">No search results</div>';
        }
        return jobs.map(j => {
            const code = escAttr(j.job_code || '');
            const activeRow = draft.job_items?.[_consumeActiveJobRowIndex || 0];
            const sel = activeRow?.job_code === j.job_code ? ' selected' : '';
            const sub = [j.item_sort1, j.item_sort2].filter(Boolean).join(' · ');
            return `<button type="button" class="spare-consume-pick-item spare-consume-pick-item-job${sel}"
                onclick="TVC_SpareMenu.pickConsumeMetaJob('${code}')">
                <span class="spare-consume-pick-job-code">${esc(j.job_code || '')}</span>
                ${sub ? `<span class="spare-consume-pick-job-sub">${esc(sub)}</span>` : ''}
            </button>`;
        }).join('');
    }

    function refreshConsumeJobPickList() {
        const list = document.getElementById('consumeJobPickList');
        if (!list) return;
        list.innerHTML = buildConsumeJobPickListInner(getState());
    }

    function consumeJobPickSearch(v) {
        _consumeJobPickSearch = v || '';
        refreshConsumeJobPickList();
        if (document.getElementById('consumeJobPickMenu')?.style.display !== 'none') {
            positionConsumeJobPickMenu(_consumeActiveJobRowIndex || 0);
        }
    }

    function consumeJobPickClickInside(target) {
        const menu = document.getElementById('consumeJobPickMenu');
        if (!menu || !target) return false;
        if (menu.contains(target)) return true;
        return !!target.closest?.('[id^="consumeJobPickTrigger-"]');
    }

    function toggleConsumeJobPick(ev, rowIdx = 0) {
        ev?.stopPropagation();
        const draft = getConsumeSession();
        if (!draft?.spare_group_key) return alert('Select PMS Group No. first.');
        const menu = document.getElementById('consumeJobPickMenu');
        if (!menu) return;
        const wasOpen = menu.style.display !== 'none' && menu.style.display !== '';
        if (wasOpen && _consumeActiveJobRowIndex === rowIdx) {
            closeConsumeJobPickMenu();
            return;
        }
        _consumeActiveJobRowIndex = rowIdx;
        closeConsumePickMenu(document.getElementById('consumeGroupPick'));
        refreshConsumeJobPickList();
        positionConsumeJobPickMenu(rowIdx);
        if (wasOpen) return;
        unbindConsumeJobPickListeners();
        const close = (e) => {
            if (!consumeJobPickClickInside(e.target)) closeConsumeJobPickMenu();
        };
        const onReposition = () => {
            if (!isConsumeJobPickOpen()) return;
            positionConsumeJobPickMenu(_consumeActiveJobRowIndex || 0);
        };
        setTimeout(() => {
            document.addEventListener('click', close);
            window.addEventListener('scroll', onReposition, true);
            window.addEventListener('resize', onReposition);
        }, 0);
        _consumeJobPickUnbind = () => {
            document.removeEventListener('click', close);
            window.removeEventListener('scroll', onReposition, true);
            window.removeEventListener('resize', onReposition);
        };
    }

    function pickConsumeMetaJob(jobCode) {
        const st = getState();
        const draft = getConsumeSession();
        if (!draft) return;
        ensureConsumeJobItems(draft);
        const idx = _consumeActiveJobRowIndex || 0;
        const job = findJobByCode(st, jobCode);
        if (job) applyConsumeJobFields(job, idx);
        else {
            const row = draft.job_items[idx] || draft.job_items[0];
            if (row) row.job_code = String(jobCode || '').trim();
            syncConsumeDraftJobSummary(draft);
        }
        closeConsumeJobPickMenu();
        renderConsumeJobRowsSection();
        captureConsumeMeta();
    }

    function renderConsumeJobPickMenuHtml() {
        return `<div id="consumeJobPickHost" class="spare-consume-job-pick-host hidden" aria-hidden="true">
                <div id="consumeJobPickMenu" class="spare-consume-pick-menu" role="listbox" aria-label="JOB CODE" style="display:none">
                    <div class="spare-consume-pick-search">
                        <input type="search" class="search-input" placeholder="Search JOB CODE / SORT / DETAIL…" value="${esc(_consumeJobPickSearch)}"
                            oninput="TVC_SpareMenu.consumeJobPickSearch(this.value)" onclick="event.stopPropagation()">
                    </div>
                    <div class="spare-consume-pick-scroll" id="consumeJobPickList"></div>
                </div>
            </div>`;
    }

    function renderConsumeMetaHtml(draft, opts = {}) {
        if (!draft) return '';
        const ro = !!opts.readonly;
        const roAttr = ro ? ' readonly disabled' : '';
        const reportedByVal = resolveSpareReportedBy(draft, spareInventoryUser(getState()));
        const today = new Date().toISOString().slice(0, 10);
        const groupLabel = draft.spare_group_label ? safeTreeLabel(draft.spare_group_label) : '—';
        const batch = consumeJobBatchEnabled(draft, ro);
        const pmsField = ro
            ? `<input type="text" class="spare-req-meta-input spare-consume-meta-input wr-spare-meta-pms" value="${esc(groupLabel)}"${roAttr}>`
            : `<div class="spare-consume-meta-pick" id="consumeGroupPick">
                    <button type="button" id="consumeGroupPickTrigger" class="spare-consume-pick-trigger" onclick="TVC_SpareMenu.toggleConsumeGroupPick(event)">
                        <span class="spare-consume-pick-text" id="consumeGroupPickText">${esc(groupLabel || '— Select PMS Group —')}</span>
                        <span class="spare-consume-pick-caret" aria-hidden="true">▾</span>
                    </button>
                    <div class="spare-consume-pick-menu" role="listbox" aria-label="PMS Group No.">
                        <div class="spare-consume-pick-search">
                            <input type="search" class="search-input" placeholder="Search GROUP…" value="${esc(_consumeGroupPickSearch)}"
                                oninput="TVC_SpareMenu.consumeGroupPickSearch(this.value)" onclick="event.stopPropagation()">
                        </div>
                        <div class="spare-consume-pick-head muted">PMS GROUP Tree</div>
                        <div class="spare-consume-pick-scroll" id="consumeGroupPickList"></div>
                    </div>
                </div>`;
        return `<section class="spare-consume-meta-form${ro ? ' wr-spare-meta-form' : ''}" aria-label="Consumed spare parts information">
            ${renderSpareApprovalSection(draft, { prefix: 'consume', department: opts.department })}
            <div class="spare-consume-meta-row-top">
                <div class="spare-consume-meta-field spare-consume-meta-field-date">
                    <label class="spare-consume-meta-inline-label" for="consumeDate">Consumed Date</label>
                    <input type="text" id="consumeDate" class="spare-req-meta-input spare-consume-meta-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(draft.consumed_date || today))}"${roAttr}${ro ? '' : ' onchange="TVC_SpareMenu.captureConsumeMeta()"'}>
                </div>
                <div class="spare-consume-meta-field spare-consume-meta-field-made">
                    <label class="spare-consume-meta-inline-label" for="consumeMadeOn">Reported Date</label>
                    <input type="text" id="consumeMadeOn" class="spare-req-meta-input spare-consume-meta-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(draft.made_on || ''))}"${roAttr}${ro ? '' : ' onchange="TVC_SpareMenu.captureConsumeMeta()"'}>
                </div>
                <div class="spare-consume-meta-field spare-consume-meta-field-by">
                    <label class="spare-consume-meta-inline-label" for="consumeMadeBy">Reported by</label>
                    <input type="text" id="consumeMadeBy" class="spare-req-meta-input spare-consume-meta-input wr-ro" value="${esc(reportedByVal)}" readonly disabled tabindex="-1">
                </div>
            </div>
            <div class="spare-consume-meta-row spare-consume-meta-row-pms">
                <label class="spare-consume-meta-label" for="consumeGroupPickTrigger">PMS Group No.</label>
                ${pmsField}
            </div>
            <div class="spare-consume-meta-jobs" id="consumeJobRows" data-readonly="${ro ? '1' : '0'}" data-batch="${batch ? '1' : '0'}">
                ${renderConsumeJobRowsInner(draft, { readonly: ro })}
            </div>
            ${ro ? '' : renderConsumeJobPickMenuHtml()}
            <div class="spare-consume-meta-comments">
                <label class="spare-consume-meta-col-head" for="consumeShipComments">Ship's Comments</label>
                <textarea id="consumeShipComments" class="spare-req-meta-input spare-consume-meta-textarea" rows="2"
                    placeholder="Enter remarks for this consumption record…"${roAttr}${ro ? '' : ' oninput="TVC_SpareMenu.captureConsumeMeta()"'}>${esc(draft.ships_comments || '')}</textarea>
            </div>
        </section>`;
    }

    function renderConsumeGroupTree() {
        const st = getState();
        const root = document.getElementById('consumeGroupTree');
        if (!root) return;
        if (!st.idx && (st.jobs || []).length && window.TVC_Indexes) {
            st.idx = TVC_Indexes.build(st);
        }
        if (!st.idx) {
            root.innerHTML = '<div class="tree-empty muted">Loading Maintenance Plan…</div>';
            return;
        }
        const q = (st.treeSearch || '').toLowerCase();
        const matchNode = (n) => !q || (n.label || '').toLowerCase().includes(q) || (n.department || '').toLowerCase().includes(q);
        const matchCritical = !q || 'critical equipment'.includes(q) || q.includes('critical') || q.includes('crit');
        const byDept = new Map();
        (st.idx.groupNodes || [])
            .filter(n => {
                if (isHiddenSpareGroup(n.label, n.department)) return false;
                if (st.department && n.department !== st.department) return false;
                if (matchNode(n)) return true;
                return isGeneratorEngineGroupLabel(n.label) && matchMergedGeneratorSearch(q);
            })
            .forEach(n => {
                if (!byDept.has(n.department)) byDept.set(n.department, []);
                byDept.get(n.department).push(n);
            });
        const allSelected = !st.selectedGroupKey;
        let html = `<div class="tree-node${allSelected ? ' selected' : ''}" onclick="TVC_SpareMenu.consumeSelectGroup(null)"><span>📋 All Groups</span></div>`;
        if (matchCritical) {
            const critSel = st.selectedGroupKey === CRITICAL_GROUP_KEY ? ' selected' : '';
            html += `<div class="tree-node tree-node-critical${critSel}" onclick="TVC_SpareMenu.consumeSelectGroup('${CRITICAL_GROUP_KEY}')"><span>⚠ Critical Equipment</span></div>`;
        }
        if (!byDept.size && q && !matchCritical) {
            html += `<div class="tree-empty muted">No groups match "${esc(q)}"</div>`;
        }
        DEPT_TREE_ORDER.filter(d => byDept.has(d)).forEach(dept => {
            const nodes = byDept.get(dept);
            html += `<div class="tree-dept">${esc(dept)}</div>`;
            mergeSpareTreeNodes(nodes).forEach(n => {
                const emptyTag = n.isEmpty ? `<span class="tree-empty-tag" title="No job items">0</span>` : '';
                const sel = st.selectedGroupKey === n.key ? ' selected' : '';
                html += `<div class="tree-node${sel}${n.isEmpty ? ' tree-node-empty' : ''}" onclick="TVC_SpareMenu.consumeSelectGroup('${escAttr(n.key)}')"><span>${esc(safeTreeLabel(n.label))}</span>${emptyTag}</div>`;
            });
        });
        root.innerHTML = html;
        const searchEl = document.getElementById('consumeTreeSearch');
        if (searchEl && document.activeElement !== searchEl) searchEl.value = st.treeSearch || '';
    }

    function syncConsumeHeadLayout() {
        syncHeadLayout('consumeListScroll', 'consumeListHead', 'consumeListHeadTrack', SPARE_CONSUME_MIN_WIDTH);
    }

    function mountConsumeVirtualList() {
        const head = document.getElementById('consumeListHead');
        if (head) {
            head.innerHTML = `<div id="consumeListHeadTrack" class="spare-head-track"><table class="spare-data-table spare-data-head spare-data-table-consume">
                ${SPARE_CONSUME_COLGROUP}
                ${SPARE_CONSUME_TABLE_HEAD}
            </table></div>`;
        }
        const scroll = document.getElementById('consumeListScroll');
        if (!scroll) return;
        const hscroll = scroll.closest('.spare-req-table-hscroll');
        const scrollTop = scroll.scrollTop;
        const hScrollLeft = hscroll?.scrollLeft || 0;
        if (vlConsume) vlConsume.destroy();
        if (!_consumeCachedList.length) {
            const st = getState();
            const gLabel = groupFilterLabel(st);
            const lowTag = modState(st).showLowOnly ? 'Low stock' : '';
            const filterLabel = [gLabel, lowTag].filter(Boolean).join(' · ');
            scroll.innerHTML = `<div class="spare-empty-list muted" style="padding:24px;text-align:center">
                No parts to display.${filterLabel ? ' (Filter: ' + esc(filterLabel) + ')' : ''}
            </div>`;
            vlConsume = null;
            return;
        }
        const st = getState();
        const m = modState(st);
        vlConsume = TVC_VirtualList.mount(scroll, {
            getCount: () => _consumeCachedList.length,
            renderRow: (i) => {
                const s = _consumeCachedList[i];
                return s ? rowHtml(s, m.consumeFocusedId, null, 'consume') : '';
            },
            overflowX: 'hidden',
            overflowY: 'auto',
        });
        const inner = scroll.querySelector('.vl-inner');
        if (inner) {
            inner.style.minWidth = `${SPARE_CONSUME_MIN_WIDTH}px`;
            inner.style.width = '100%';
        }
        scroll.scrollTop = scrollTop;
        if (hscroll) hscroll.scrollLeft = hScrollLeft;
        if (vlConsume) vlConsume.refresh();
        if (head) bindHeadLayoutSync(scroll, syncConsumeHeadLayout, 'consume');
        updateConsumeHeadCheckAll();
    }

    function updateConsumeHeadStats() {
        const draft = getConsumeSession();
        const linesEl = document.querySelector('.spare-consume-lines');
        if (linesEl && draft) linesEl.textContent = `${(draft.lines || []).length} line(s)`;
    }

    function refreshConsumeListRows() {
        const st = getState();
        const m = modState(st);
        const block = document.getElementById('consumeEditBlock');
        if (block) {
            block.innerHTML = m.inlineEditId && m.inlineDraft?.header
                ? renderSpareEditBlockHtml(st)
                : renderConsumeGroupHeaderHtml(st);
        }
        const scroll = document.getElementById('consumeListScroll');
        const head = document.getElementById('consumeListHead');
        if (head && !head.querySelector('.spare-data-head')) {
            head.innerHTML = `<div id="consumeListHeadTrack" class="spare-head-track"><table class="spare-data-table spare-data-head spare-data-table-consume">
                ${SPARE_CONSUME_COLGROUP}
                ${SPARE_CONSUME_TABLE_HEAD}
            </table></div>`;
        }
        if (vlConsume && scroll?.querySelector('.vl-inner')) {
            vlConsume.refresh();
            requestAnimationFrame(syncConsumeHeadLayout);
        } else if (scroll) {
            mountConsumeVirtualList();
        }
        updateConsumeHeadStats();
        updateConsumeHeadCheckAll();
    }

    function refreshConsumeListUi() {
        const st = getState();
        const m = modState(st);
        const allCanon = (st.spares || []).map(canon);
        const prevCount = _consumeCachedList.length;
        _consumeCachedList = filteredConsumeSpares(st);
        const hadItems = prevCount > 0;
        const hasItems = _consumeCachedList.length > 0;
        const scroll = document.getElementById('consumeListScroll');
        const canRefresh = !!(vlConsume && scroll?.querySelector('.vl-inner') && hadItems && hasItems);
        const block = document.getElementById('consumeEditBlock');
        if (block) {
            block.innerHTML = m.inlineEditId && m.inlineDraft?.header
                ? renderSpareEditBlockHtml(st)
                : renderConsumeGroupHeaderHtml(st);
        }
        renderConsumeGroupTree();
        if (canRefresh) {
            vlConsume.refresh();
            requestAnimationFrame(syncConsumeHeadLayout);
        } else {
            mountConsumeVirtualList();
        }
        updateConsumeHeadStats();
        updateConsumeHeadCheckAll();
        const countEl = document.getElementById('consumeCount');
        if (countEl) {
            countEl.textContent = m.consumeShowSelectedOnly
                ? consumeSelectedCountLabel(st, _consumeCachedList.length)
                : `${_consumeCachedList.length} / ${allCanon.length}`;
        }
        updateConsumeSelectedBtn();
        updateSpareModalTreeToggleUi('consume');
        syncSpareItemHistoryBtns();
    }

    function updateConsumeSelectedBtn() {
        const st = getState();
        const meta = consumeSelectedBtnMeta(st);
        const btn = document.getElementById('consumeSelectedBtn');
        if (!btn) return;
        btn.textContent = meta.label;
        btn.title = meta.title;
        btn.disabled = meta.disabled;
        btn.classList.toggle('plan-selected-filter-active', meta.active);
        btn.setAttribute('aria-pressed', meta.active ? 'true' : 'false');
    }

    function clearConsumeSearch(st) {
        const m = modState(st);
        m.partNo = '';
        m.description = '';
        st.spareSearch = '';
        const searchEl = document.getElementById('consumeSearch');
        if (searchEl) searchEl.value = '';
    }

    function consumeToggleSelectedOnly() {
        const st = getState();
        const m = modState(st);
        if (m.consumeShowSelectedOnly) {
            m.consumeShowSelectedOnly = false;
        } else {
            if (!consumeCheckedSpareCount(st)) return alert('No parts selected.');
            m.consumeShowSelectedOnly = true;
        }
        refreshConsumeListUi();
    }

    function consumeSelectGroup(key) {
        const st = getState();
        st.selectedGroupKey = key || null;
        modState(st).consumeFocusedId = null;
        modState(st).consumeTreeOpen = false;
        refreshConsumeListUi();
    }

    function consumeToggleGroupTree() {
        const st = getState();
        const m = modState(st);
        if (m.consumePreview) return;
        m.consumeTreeOpen = !m.consumeTreeOpen;
        if (m.consumeTreeOpen) renderConsumeGroupTree();
        updateSpareModalTreeToggleUi('consume');
    }

    function consumeSetTreeSearch(v) {
        getState().treeSearch = v;
        renderConsumeGroupTree();
    }

    function consumeSetSearch(v) { setSearch(v); }

    function consumeToggleLowOnly() {
        const st = getState();
        modState(st).showLowOnly = !modState(st).showLowOnly;
        applySpareListFilter();
    }

    function consumeListEditable() {
        const m = modState(getState());
        return !!(m.consumeOpen && !m.consumePreview);
    }

    function syncConsumeGroupHeader(st) {
        const block = document.getElementById('consumeEditBlock');
        if (!block) return;
        block.innerHTML = renderConsumeGroupHeaderHtml(st);
    }

    function consumeNavigableSpares(st) {
        return (_consumeCachedList || []).filter(s => consumeRowChecked(s));
    }

    function findConsumeRowTable(spareId) {
        const sid = consumeSpareIdKey(spareId);
        const scroll = document.getElementById('consumeListScroll');
        if (!scroll || !sid) return null;
        for (const el of scroll.querySelectorAll('[data-spare-id]')) {
            if (el.dataset.spareId === sid) return el;
        }
        return null;
    }

    function scrollConsumeRowIntoView(spareId) {
        const scroll = document.getElementById('consumeListScroll');
        if (!scroll || !spareId) return;
        if (vlConsume && scroll.querySelector('.vl-inner')) {
            const idx = (_consumeCachedList || []).findIndex(s => consumeSameSpareId(s.id, spareId));
            if (idx < 0) return;
            const rowH = TVC_VirtualList.ROW_H || 36;
            const viewH = scroll.clientHeight || 400;
            const rowTop = idx * rowH;
            const rowBottom = rowTop + rowH;
            if (rowTop < scroll.scrollTop) scroll.scrollTop = rowTop;
            else if (rowBottom > scroll.scrollTop + viewH) scroll.scrollTop = rowBottom - viewH;
            return;
        }
        findConsumeRowTable(spareId)?.scrollIntoView({ block: 'nearest' });
    }

    function focusConsumeQtyInput(spareId) {
        if (!spareId || !consumeListEditable()) return;
        const table = findConsumeRowTable(spareId);
        const input = table?.querySelector('.spare-consume-qty-input:not([disabled])');
        if (input) {
            input.focus();
            input.select();
        }
    }

    function consumeApplyRowFocus(spareId, focusQty = false) {
        const st = getState();
        setFocusedSpareId(st, spareId || null);
        syncConsumeGroupHeader(st);
        scrollConsumeRowIntoView(spareId);
        if (vlConsume) {
            vlConsume.refresh();
            updateConsumeHeadCheckAll();
            requestAnimationFrame(() => {
                syncConsumeHeadLayout();
                requestAnimationFrame(syncConsumeHeadLayout);
            });
        } else {
            refreshConsumeListRows();
        }
        syncSpareItemHistoryBtns();
        if (focusQty && spareId && consumeListEditable()) {
            const spare = (st.spares || []).find(s => consumeSameSpareId(s.id, spareId));
            if (spare && consumeRowChecked(spare)) {
                requestAnimationFrame(() => {
                    focusConsumeQtyInput(spareId);
                    requestAnimationFrame(() => focusConsumeQtyInput(spareId));
                });
            }
        }
    }

    function consumeMoveFocusRow(delta) {
        if (!consumeListEditable()) return;
        const st = getState();
        const list = consumeNavigableSpares(st);
        if (!list.length) return;
        const curId = getFocusedSpareId(st);
        let idx = list.findIndex(s => consumeSameSpareId(s.id, curId));
        if (idx < 0) idx = delta > 0 ? -1 : list.length;
        const next = list[idx + delta];
        if (!next) return;
        consumeApplyRowFocus(next.id, true);
    }

    function onConsumeListKeydown(e) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (!consumeListEditable()) return;
        const t = e.target;
        if (!t.closest?.('#consumeListScroll')) return;
        if (t.tagName === 'INPUT' && !t.classList.contains('spare-consume-qty-input')) return;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
        e.preventDefault();
        consumeMoveFocusRow(e.key === 'ArrowDown' ? 1 : -1);
    }

    function bindConsumeListKeyboard() {
        const modal = document.getElementById('spareConsumeModal');
        if (!modal || modal._consumeKeyBound) return;
        modal._consumeKeyBound = true;
        modal.addEventListener('keydown', onConsumeListKeydown, true);
    }

    function consumeFocusRow(spareId, focusQty = false) {
        if (spareId) consumeApplyRowFocus(spareId, focusQty);
        else {
            setFocusedSpareId(getState(), null);
            syncConsumeGroupHeader(getState());
            refreshConsumeListRows();
        }
    }

    function consumeToggleRow(spareId, checked) {
        const draft = getConsumeSession();
        if (!draft) return;
        const sid = consumeSpareIdKey(spareId);
        captureConsumeMeta();
        draft.lines = draft.lines || [];
        const spare = (getState().spares || []).find(s => consumeSameSpareId(s.id, sid));
        if (checked) {
            let line = draft.lines.find(l => consumeSameSpareId(l.spare_part_id, sid));
            if (!line && spare) {
                line = buildConsumeLine(spare, 0);
                draft.lines.push(line);
            }
        } else {
            draft.lines = draft.lines.filter(l => !consumeSameSpareId(l.spare_part_id, sid));
        }
        syncConsumeLineMap();
        if (modState(getState()).consumeShowSelectedOnly && !consumeCheckedSpareCount(getState())) {
            modState(getState()).consumeShowSelectedOnly = false;
        }
        if (checked && spare) consumeApplyRowFocus(spareId, false);
        else refreshConsumeListUi();
    }

    function consumeSetQty(spareId, rawQty) {
        const draft = getConsumeSession();
        if (!draft) return;
        const sid = consumeSpareIdKey(spareId);
        captureConsumeMeta();
        const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
        draft.lines = draft.lines || [];
        let line = draft.lines.find(l => consumeSameSpareId(l.spare_part_id, sid));
        const spare = (getState().spares || []).find(s => consumeSameSpareId(s.id, sid));
        if (!line && spare) {
            line = buildConsumeLine(spare, qty);
            draft.lines.push(line);
        } else if (line) {
            line.qty_consumed = qty;
        }
        syncConsumeLineMap();
        refreshConsumeListUi();
        if (spareId) {
            requestAnimationFrame(() => focusConsumeQtyInput(spareId));
        }
    }

    function renderWrSpareMetaHtml(meta = {}, opts = {}) {
        const pmsLabel = meta.pmsGroupNo ? safeTreeLabel(meta.pmsGroupNo) : '—';
        const ro = !!opts.readonly;
        const allowAdd = !!opts.allowAdd && !ro;
        const jobItems = (meta.jobItems && meta.jobItems.length)
            ? meta.jobItems
            : [newConsumeJobRow({
                job_code: meta.jobCode || '',
                sort1: meta.sort1 || '',
                sort2: meta.sort2 || '',
                job_detail: meta.jobDetail || '',
            })];
        setPage2JobContext({
            items: jobItems,
            groupKey: meta.groupKey || '',
            readonly: ro || !allowAdd,
            allowAdd,
        });
        const roInp = (type, val) => type === 'date'
            ? `<input type="text" class="wr-ro tvc-date-input" value="${esc(fmtSpareDate(val))}" readonly disabled>`
            : `<input type="${type}" class="wr-ro" value="${esc(val)}" readonly disabled>`;
        const fld = (label, inner, extraCls = '') =>
            `<div class="wr-maint-field${extraCls ? ' ' + extraCls : ''}"><label>${label}</label>${inner}</div>`;

        return `<section class="wr-maint-card wr-maint-body wr-spare-meta-form" aria-label="Work report job context">
            <div class="wr-maint-grid wr-maint-grid-3">
                ${fld('Work Date', roInp('date', meta.workDate || ''))}
                ${fld('Reported Date', roInp('date', meta.reportDate || ''))}
                ${fld('Reported by', roInp('text', meta.reportedBy || ''))}
                ${fld('PMS Group No.', roInp('text', pmsLabel), 'wr-maint-span-all')}
            </div>
            <div class="wr-page2-job-rows" id="page2JobRows" data-maint-style="1" data-readonly="${ro || !allowAdd ? '1' : '0'}" data-batch="${allowAdd ? '1' : '0'}">
                ${renderPage2JobRowsInner(getPage2JobContext(), { readonly: ro || !allowAdd, allowAdd, maintStyle: true })}
            </div>
            ${allowAdd && !ro ? renderPage2JobPickMenuHtml() : ''}
            ${fld("Ship's Comments &amp; Desired Articles", `<textarea class="wr-maint-textarea wr-ro" rows="3" readonly disabled>${esc(meta.shipComments || '')}</textarea>`, 'wr-maint-span-all wr-maint-grid-gap')}
        </section>`;
    }

    function applyWrSpareSelectedOnlyAfterSave(st) {
        const m = modState(st || getState());
        m.wrSparePostSaveFilter = true;
        m.wrSpareShowSelectedOnly = true;
        const s = st || getState();
        s._wrUsedParts = (s._wrUsedParts || []).filter(p => Number(p.qty_used) > 0);
        syncWrLineMap();
        if (m.wrSpareOpen) {
            rebuildWrSpareCachedList(s);
            refreshWrSpareListUi();
        }
    }

    function wrSparePreviewMode(st, ro) {
        return !!ro && (!!st._wrReportId || !!st._defectCaseId);
    }

    function rebuildWrSpareCachedList(st) {
        const m = modState(st);
        const isPreview = wrSparePreviewMode(st, m.wrSpareReadonly);
        syncWrLineMap();
        if (isPreview) m.wrSpareShowSelectedOnly = true;
        let list = filteredWrSpares(st);
        if (isPreview) {
            list = list.filter(s => {
                const line = _wrSpareLineBySpareId?.get(wrSpareIdKey(s.id));
                return line && (Number(line.qty_used) || 0) > 0;
            });
        }
        _wrSpareCachedList = list;
        return list;
    }

    function spareGroupTreeToggleHtml(prefix, st, opts = {}) {
        const m = modState(st);
        const treeOpen = !!m[`${prefix}TreeOpen`];
        const treeBtnCls = treeOpen ? ' is-active' : '';
        const treePopCls = treeOpen ? ' is-open' : '';
        const groupLabel = esc(groupFilterLabel(st) || 'All Groups');
        const roDis = opts.readonly ? ' disabled' : '';
        const toggleFn = prefix === 'wrSpare'
            ? 'TVC_SpareMenu.wrSpareToggleGroupTree()'
            : prefix === 'consume'
                ? 'TVC_SpareMenu.consumeToggleGroupTree()'
                : prefix === 'receive'
                    ? 'TVC_SpareMenu.receiveToggleGroupTree()'
                    : 'TVC_SpareMenu.reqWorkToggleGroupTree()';
        const searchFn = prefix === 'wrSpare'
            ? 'TVC_SpareMenu.wrSpareSetTreeSearch(this.value)'
            : prefix === 'consume'
                ? 'TVC_SpareMenu.consumeSetTreeSearch(this.value)'
                : prefix === 'receive'
                    ? 'TVC_SpareMenu.receiveSetTreeSearch(this.value)'
                    : 'TVC_SpareMenu.reqWorkSetTreeSearch(this.value)';
        return `<div class="wr-spare-tree-toggle-wrap" id="${prefix}GroupTreeWrap">
        <button type="button" id="${prefix}GroupTreeBtn" class="btn btn-sm wr-spare-tree-toggle-btn${treeBtnCls}"
          onclick="event.stopPropagation();${toggleFn}"
          aria-expanded="${treeOpen ? 'true' : 'false'}" aria-haspopup="true"${roDis}>
          🌳 ${groupLabel} <span class="wr-spare-tree-caret" aria-hidden="true">▾</span>
        </button>
        <div id="${prefix}GroupTreePop" class="wr-spare-tree-pop${treePopCls}" role="dialog" aria-label="SPARE GROUP Tree"
          onclick="event.stopPropagation()">
          <div class="wr-spare-tree-pop-head">SPARE GROUP Tree</div>
          <div class="tree-search-bar">
            <input class="search-input" id="${prefix}TreeSearch" placeholder="Search GROUP…"
              value="${esc(st.treeSearch || '')}" oninput="${searchFn}"${roDis}>
          </div>
          <div class="panel-body tree-scroll wr-spare-tree-pop-body" id="${prefix}GroupTree"></div>
        </div>
      </div>`;
    }

    function updateSpareModalTreeToggleUi(prefix) {
        const st = getState();
        const m = modState(st);
        const treeOpen = !!m[`${prefix}TreeOpen`];
        const btn = document.getElementById(`${prefix}GroupTreeBtn`);
        const pop = document.getElementById(`${prefix}GroupTreePop`);
        if (btn) {
            btn.classList.toggle('is-active', treeOpen);
            btn.setAttribute('aria-expanded', treeOpen ? 'true' : 'false');
            btn.innerHTML = `🌳 ${esc(groupFilterLabel(st) || 'All Groups')} <span class="wr-spare-tree-caret" aria-hidden="true">▾</span>`;
        }
        if (pop) pop.classList.toggle('is-open', treeOpen);
    }

    function bindSpareModalTreePopovers() {
        if (_wrSpareTreeDocClick) return;
        _wrSpareTreeDocClick = (e) => {
            const st = getState();
            const m = modState(st);
            const closeOutside = (wrapId, isOpen, treeOpenKey, prefix) => {
                if (!isOpen || !m[treeOpenKey]) return;
                const wrap = document.getElementById(wrapId);
                if (wrap && !wrap.contains(e.target)) {
                    m[treeOpenKey] = false;
                    if (prefix === 'wrSpare') updateWrSpareTreeToggleUi();
                    else updateSpareModalTreeToggleUi(prefix);
                }
            };
            closeOutside('wrSpareGroupTreeWrap', m.wrSpareOpen, 'wrSpareTreeOpen', 'wrSpare');
            closeOutside('consumeGroupTreeWrap', m.consumeOpen && !m.consumePreview, 'consumeTreeOpen', 'consume');
            closeOutside('reqWorkGroupTreeWrap', m.reqWorkOpen && !m.reqWorkPreview, 'reqWorkTreeOpen', 'reqWork');
            closeOutside('receiveGroupTreeWrap', m.receiveOpen, 'receiveTreeOpen', 'receive');
        };
        document.addEventListener('click', _wrSpareTreeDocClick);
    }

    function unbindSpareModalTreePopovers() {
        if (!_wrSpareTreeDocClick) return;
        document.removeEventListener('click', _wrSpareTreeDocClick);
        _wrSpareTreeDocClick = null;
    }

    function wrSpareGroupTreeBtnLabel(st) {
        return groupFilterLabel(st) || 'All Groups';
    }

    function updateWrSpareTreeToggleUi() {
        updateSpareModalTreeToggleUi('wrSpare');
    }

    function bindWrSpareTreePopover() {
        bindSpareModalTreePopovers();
    }

    function unbindWrSpareTreePopover() {
        unbindSpareModalTreePopovers();
    }

    function wrSpareToggleGroupTree() {
        const st = getState();
        const m = modState(st);
        if (m.wrSpareReadonly) return;
        m.wrSpareTreeOpen = !m.wrSpareTreeOpen;
        if (m.wrSpareTreeOpen) renderWrSpareGroupTree();
        updateWrSpareTreeToggleUi();
    }

    function renderWrSparePage2Html(job, ro, meta = {}) {
        const st = getState();
        const m = modState(st);
        const isPreview = wrSparePreviewMode(st, ro);
        m.wrSpareReadonly = !!ro;
        if (isPreview) m.wrSpareShowSelectedOnly = true;
        else if (m.wrSparePostSaveFilter) m.wrSpareShowSelectedOnly = true;
        else if (!ro) m.wrSpareShowSelectedOnly = false;
        const allCanon = (st.spares || []).map(canon);
        rebuildWrSpareCachedList(st);
        const selBtn = wrSpareSelectedBtnMeta(st);
        const selectedBtnCls = selBtn.active ? ' plan-selected-filter-active' : '';
        const countLabel = m.wrSpareShowSelectedOnly
            ? wrSpareSelectedCountLabel(st, _wrSpareCachedList.length)
            : `${_wrSpareCachedList.length} / ${allCanon.length}`;
        const searchVal = esc(m.partNo || m.description ? [m.partNo, m.description].filter(Boolean).join(' ') : (st.spareSearch || ''));
        const roDis = ro ? ' disabled' : '';

        const listToolbar = isPreview ? '' : `
    <div class="filter-bar orig-toolbar spare-item-toolbar wr-spare-toolbar">
      ${spareGroupTreeToggleHtml('wrSpare', st, { readonly: ro })}
      ${spareItemHistoryBtnHtml()}
      <span class="wr-spare-toolbar-spacer" aria-hidden="true"></span>
      <div class="wr-spare-toolbar-actions">
      <button type="button" id="wrSpareSelectedBtn" class="btn btn-sm spare-req-selected-btn${selectedBtnCls}"
        onclick="TVC_SpareMenu.wrSpareToggleSelectedOnly()" aria-pressed="${selBtn.active ? 'true' : 'false'}"
        title="${esc(selBtn.title)}"${selBtn.disabled || ro ? ' disabled' : ''}>${esc(selBtn.label)}</button>
      </div>
    </div>
    <div class="filter-bar spare-list-search-bar">
      <input type="search" class="search-input spare-list-search-input" id="wrSpareSearch" placeholder="Search Code / Item / Part No / Work"
        value="${searchVal}" oninput="TVC_SpareMenu.wrSpareSetSearch(this.value)"${roDis}>
      <label class="sr-check"><input type="checkbox" ${m.showLowOnly ? 'checked' : ''}${roDis}
        onchange="TVC_SpareMenu.wrSpareToggleLowOnly()"> Low stock only</label>
      <span class="count-label" id="wrSpareCount">${countLabel}</span>
    </div>`;

        const layoutCls = isPreview
            ? 'plan-layout spare-layout spare-req-work-layout spare-consume-work-layout wr-spare-work-layout wr-spare-full-width spare-consume-preview-layout'
            : 'plan-layout spare-layout spare-req-work-layout spare-consume-work-layout wr-spare-work-layout wr-spare-full-width';

        return `
${renderWrSpareMetaHtml(meta, { readonly: ro, allowAdd: !!meta.allowAdd })}
<div class="${layoutCls}">
  <main class="panel spare-main">
    ${listToolbar}
    <div id="wrSpareEditBlock">${renderWrSpareGroupHeaderHtml(st)}</div>
    <div class="panel spare-list-panel">
      <div class="spare-req-table-hscroll">
        <div class="spare-req-table-wide">
          <div id="wrSpareListHead" class="vl-head-wrap sheet-scroll-original"></div>
          <div id="wrSpareListScroll" class="virtual-scroll sheet-scroll-original spare-vl-scroll"></div>
        </div>
      </div>
    </div>
  </main>
</div>`;
    }

    function renderWrSpareGroupHeaderHtml(st) {
        const m = modState(st);
        return renderSpareGroupHeaderHtml(st, { focusedId: m.wrSpareFocusedId });
    }

    function renderWrSpareGroupTree() {
        const st = getState();
        const root = document.getElementById('wrSpareGroupTree');
        if (!root) return;
        if (!st.idx && (st.jobs || []).length && window.TVC_Indexes) {
            st.idx = TVC_Indexes.build(st);
        }
        if (!st.idx) {
            root.innerHTML = '<div class="tree-empty muted">Loading Maintenance Plan…</div>';
            return;
        }
        const q = (st.treeSearch || '').toLowerCase();
        const matchNode = (n) => !q || (n.label || '').toLowerCase().includes(q) || (n.department || '').toLowerCase().includes(q);
        const matchCritical = !q || 'critical equipment'.includes(q) || q.includes('critical') || q.includes('crit');
        const byDept = new Map();
        (st.idx.groupNodes || [])
            .filter(n => {
                if (isHiddenSpareGroup(n.label, n.department)) return false;
                if (st.department && n.department !== st.department) return false;
                if (matchNode(n)) return true;
                return isGeneratorEngineGroupLabel(n.label) && matchMergedGeneratorSearch(q);
            })
            .forEach(n => {
                if (!byDept.has(n.department)) byDept.set(n.department, []);
                byDept.get(n.department).push(n);
            });
        const allSelected = !st.selectedGroupKey;
        let html = `<div class="tree-node${allSelected ? ' selected' : ''}" onclick="TVC_SpareMenu.wrSpareSelectGroup(null)"><span>📋 All Groups</span></div>`;
        if (matchCritical) {
            const critSel = st.selectedGroupKey === CRITICAL_GROUP_KEY ? ' selected' : '';
            html += `<div class="tree-node tree-node-critical${critSel}" onclick="TVC_SpareMenu.wrSpareSelectGroup('${CRITICAL_GROUP_KEY}')"><span>⚠ Critical Equipment</span></div>`;
        }
        if (!byDept.size && q && !matchCritical) {
            html += `<div class="tree-empty muted">No groups match "${esc(q)}"</div>`;
        }
        DEPT_TREE_ORDER.filter(d => byDept.has(d)).forEach(dept => {
            const nodes = byDept.get(dept);
            html += `<div class="tree-dept">${esc(dept)}</div>`;
            mergeSpareTreeNodes(nodes).forEach(n => {
                const emptyTag = n.isEmpty ? `<span class="tree-empty-tag" title="No job items">0</span>` : '';
                const sel = st.selectedGroupKey === n.key ? ' selected' : '';
                html += `<div class="tree-node${sel}${n.isEmpty ? ' tree-node-empty' : ''}" onclick="TVC_SpareMenu.wrSpareSelectGroup('${escAttr(n.key)}')"><span>${esc(safeTreeLabel(n.label))}</span>${emptyTag}</div>`;
            });
        });
        root.innerHTML = html;
        const searchEl = document.getElementById('wrSpareTreeSearch');
        if (searchEl && document.activeElement !== searchEl) searchEl.value = st.treeSearch || '';
    }

    function syncWrSpareHeadLayout() {
        syncHeadLayout('wrSpareListScroll', 'wrSpareListHead', 'wrSpareListHeadTrack', SPARE_WR_MIN_WIDTH);
    }

    function mountWrSpareVirtualList() {
        const head = document.getElementById('wrSpareListHead');
        if (head) {
            head.innerHTML = `<div id="wrSpareListHeadTrack" class="spare-head-track"><table class="spare-data-table spare-data-head spare-data-table-wrspare">
                ${SPARE_WR_COLGROUP}
                ${SPARE_WR_TABLE_HEAD}
            </table></div>`;
        }
        const scroll = document.getElementById('wrSpareListScroll');
        if (!scroll) return;
        const hscroll = scroll.closest('.spare-req-table-hscroll');
        const scrollTop = scroll.scrollTop;
        const hScrollLeft = hscroll?.scrollLeft || 0;
        if (vlWrSpare) vlWrSpare.destroy();
        if (!_wrSpareCachedList.length) {
            const st = getState();
            const m = modState(st);
            const isPreview = wrSparePreviewMode(st, m.wrSpareReadonly);
            const emptyMsg = isPreview
                ? 'No recorded SPARE usage.'
                : `No parts to display.${(() => {
                    const gLabel = groupFilterLabel(st);
                    const lowTag = modState(st).showLowOnly ? 'Low stock' : '';
                    const filterLabel = [gLabel, lowTag].filter(Boolean).join(' · ');
                    return filterLabel ? ' (Filter: ' + esc(filterLabel) + ')' : '';
                })()}`;
            scroll.innerHTML = `<div class="spare-empty-list muted" style="padding:24px;text-align:center">${emptyMsg}</div>`;
            vlWrSpare = null;
            return;
        }
        const st = getState();
        const m = modState(st);
        vlWrSpare = TVC_VirtualList.mount(scroll, {
            getCount: () => _wrSpareCachedList.length,
            renderRow: (i) => {
                const s = _wrSpareCachedList[i];
                return s ? rowHtml(s, m.wrSpareFocusedId, null, 'wrSpare') : '';
            },
            overflowX: 'hidden',
            overflowY: 'auto',
        });
        const inner = scroll.querySelector('.vl-inner');
        if (inner) {
            inner.style.minWidth = `${SPARE_WR_MIN_WIDTH}px`;
            inner.style.width = '100%';
        }
        scroll.scrollTop = scrollTop;
        if (hscroll) hscroll.scrollLeft = hScrollLeft;
        if (vlWrSpare) vlWrSpare.refresh();
        if (head) bindHeadLayoutSync(scroll, syncWrSpareHeadLayout, 'wrSpare');
        updateWrSpareHeadCheckAll();
    }

    function updateWrSpareSelectedBtn() {
        const st = getState();
        const meta = wrSpareSelectedBtnMeta(st);
        const btn = document.getElementById('wrSpareSelectedBtn');
        if (!btn) return;
        btn.textContent = meta.label;
        btn.title = meta.title;
        btn.disabled = meta.disabled || modState(st).wrSpareReadonly;
        btn.classList.toggle('plan-selected-filter-active', meta.active);
        btn.classList.toggle('is-active', meta.active);
        btn.setAttribute('aria-pressed', meta.active ? 'true' : 'false');
    }

    function updateWrSpareHeadStats() {
        const st = getState();
        const m = modState(st);
        const allCanon = (st.spares || []).map(canon);
        const countEl = document.getElementById('wrSpareCount');
        if (countEl) {
            countEl.textContent = m.wrSpareShowSelectedOnly
                ? wrSpareSelectedCountLabel(st, _wrSpareCachedList.length)
                : `${_wrSpareCachedList.length} / ${allCanon.length}`;
        }
        updateWrSpareSelectedBtn();
        updateWrSpareTreeToggleUi();
    }

    function refreshWrSpareJobContext() {
        const st = getState();
        rebuildWrSpareCachedList(st);
        syncWrLineMap();
        const block = document.getElementById('wrSpareEditBlock');
        if (block) block.innerHTML = renderWrSpareGroupHeaderHtml(st);
        const scroll = document.getElementById('wrSpareListScroll');
        if (vlWrSpare && scroll?.querySelector('.vl-inner')) {
            vlWrSpare.refresh();
            requestAnimationFrame(syncWrSpareHeadLayout);
        } else if (scroll) {
            mountWrSpareVirtualList();
        }
        updateWrSpareHeadStats();
        updateWrSpareHeadCheckAll();
    }

    function refreshWrSpareListRows() {
        const st = getState();
        const scroll = document.getElementById('wrSpareListScroll');
        const head = document.getElementById('wrSpareListHead');
        if (head && !head.querySelector('.spare-data-head')) {
            head.innerHTML = `<div id="wrSpareListHeadTrack" class="spare-head-track"><table class="spare-data-table spare-data-head spare-data-table-wrspare">
                ${SPARE_WR_COLGROUP}
                ${SPARE_WR_TABLE_HEAD}
            </table></div>`;
        }
        if (vlWrSpare && scroll?.querySelector('.vl-inner')) {
            vlWrSpare.refresh();
            requestAnimationFrame(syncWrSpareHeadLayout);
        } else if (scroll) {
            mountWrSpareVirtualList();
        }
        updateWrSpareHeadStats();
        updateWrSpareHeadCheckAll();
    }

    function refreshWrSpareListUi() {
        const st = getState();
        const m = modState(st);
        const isPreview = wrSparePreviewMode(st, m.wrSpareReadonly);
        const allCanon = (st.spares || []).map(canon);
        const prevCount = _wrSpareCachedList.length;
        rebuildWrSpareCachedList(st);
        const hadItems = prevCount > 0;
        const hasItems = _wrSpareCachedList.length > 0;
        const scroll = document.getElementById('wrSpareListScroll');
        const canRefresh = !!(vlWrSpare && scroll?.querySelector('.vl-inner') && hadItems && hasItems);
        const block = document.getElementById('wrSpareEditBlock');
        if (block) block.innerHTML = renderWrSpareGroupHeaderHtml(st);
        if (!isPreview) renderWrSpareGroupTree();
        if (canRefresh) {
            vlWrSpare.refresh();
            requestAnimationFrame(syncWrSpareHeadLayout);
        } else if (scroll) {
            mountWrSpareVirtualList();
        }
        updateWrSpareHeadStats();
        updateWrSpareHeadCheckAll();
        syncSpareItemHistoryBtns();
    }

    function updateWrSpareHeadCheckAll() {
        const el = document.getElementById('wrSpareHeadChkAll');
        if (!el) return;
        const list = _wrSpareCachedList || [];
        if (!list.length) {
            el.checked = false;
            el.indeterminate = false;
            return;
        }
        let n = 0;
        list.forEach(s => { if (wrSpareRowChecked(s)) n++; });
        el.checked = n === list.length;
        el.indeterminate = n > 0 && n < list.length;
    }

    function wrSpareSelectGroup(key) {
        const st = getState();
        if (modState(st).wrSpareReadonly) return;
        st.selectedGroupKey = key || null;
        modState(st).wrSpareFocusedId = null;
        modState(st).wrSpareTreeOpen = false;
        refreshWrSpareListUi();
    }

    function wrSpareSetTreeSearch(v) {
        getState().treeSearch = v;
        renderWrSpareGroupTree();
    }

    function wrSpareSetSearch(v) { setSearch(v); }

    function wrSpareToggleLowOnly() {
        const st = getState();
        modState(st).showLowOnly = !modState(st).showLowOnly;
        applySpareListFilter();
    }

    function wrSpareToggleSelectedOnly() {
        const st = getState();
        const m = modState(st);
        if (m.wrSpareReadonly) return;
        if (m.wrSpareShowSelectedOnly && spareListSearchQuery(st)) {
            clearConsumeSearch(st);
            refreshWrSpareListUi();
            return;
        }
        m.wrSpareShowSelectedOnly = !m.wrSpareShowSelectedOnly;
        if (m.wrSpareShowSelectedOnly) clearConsumeSearch(st);
        refreshWrSpareListUi();
    }

    function wrSpareFocusRow(spareId) {
        setFocusedSpareId(getState(), spareId || null);
        refreshWrSpareListRows();
    }

    function wrSpareToggleRow(spareId, checked) {
        const st = getState();
        if (modState(st).wrSpareReadonly) return;
        const sid = wrSpareIdKey(spareId);
        st._wrUsedParts = st._wrUsedParts || [];
        const spare = (st.spares || []).find(s => wrSameSpareId(s.id, sid));
        if (checked) {
            if (!st._wrUsedParts.some(l => wrSameSpareId(l.spare_part_id, sid)) && spare) {
                st._wrUsedParts.push(buildWrLine(spare, 1));
            }
        } else {
            st._wrUsedParts = st._wrUsedParts.filter(l => !wrSameSpareId(l.spare_part_id, sid));
        }
        syncWrLineMap();
        refreshWrSpareListRows();
    }

    function wrSpareToggleAll(checked) {
        const st = getState();
        if (modState(st).wrSpareReadonly) return;
        const list = _wrSpareCachedList || filteredWrSpares(st);
        st._wrUsedParts = st._wrUsedParts || [];
        if (checked) {
            list.forEach(s => {
                if (!st._wrUsedParts.some(l => wrSameSpareId(l.spare_part_id, s.id))) {
                    st._wrUsedParts.push(buildWrLine(s, 1));
                }
            });
        } else {
            const ids = new Set(list.map(s => wrSpareIdKey(s.id)));
            st._wrUsedParts = st._wrUsedParts.filter(l => !ids.has(wrSpareIdKey(l.spare_part_id)));
        }
        syncWrLineMap();
        refreshWrSpareListRows();
    }

    function wrSpareSetQty(spareId, rawQty) {
        const st = getState();
        if (modState(st).wrSpareReadonly) return;
        const sid = wrSpareIdKey(spareId);
        st._wrUsedParts = st._wrUsedParts || [];
        const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
        let line = st._wrUsedParts.find(l => wrSameSpareId(l.spare_part_id, sid));
        const spare = (st.spares || []).find(s => wrSameSpareId(s.id, sid));
        if (!line && spare && qty > 0) {
            st._wrUsedParts.push(buildWrLine(spare, qty));
        } else if (line) {
            if (qty <= 0) {
                st._wrUsedParts = st._wrUsedParts.filter(l => !wrSameSpareId(l.spare_part_id, sid));
            } else {
                line.qty_used = qty;
            }
        }
        syncWrLineMap();
        refreshWrSpareListRows();
    }

    function initWrSparePage2(ro) {
        const st = getState();
        const m = modState(st);
        m.wrSpareOpen = true;
        m.wrSpareReadonly = !!ro;
        const isPreview = wrSparePreviewMode(st, ro);
        if (isPreview) {
            m.wrSpareShowSelectedOnly = true;
            const firstLine = (st._wrUsedParts || []).find(l => Number(l.qty_used) > 0);
            if (firstLine?.spare_part_id) m.wrSpareFocusedId = firstLine.spare_part_id;
        } else if (m.wrSparePostSaveFilter) {
            m.wrSpareShowSelectedOnly = true;
            m.wrSparePostSaveFilter = false;
        } else if (!ro) {
            m.wrSpareShowSelectedOnly = false;
            m.wrSpareTreeOpen = false;
        }
        rebuildWrSpareCachedList(st);
        if (!st.idx && (st.jobs || []).length && window.TVC_Indexes) {
            st.idx = TVC_Indexes.build(st);
        }
        if (!isPreview) renderWrSpareGroupTree();
        mountWrSpareVirtualList();
        bindWrSpareTreePopover();
        updateWrSpareTreeToggleUi();
        updateWrSpareHeadStats();
        syncSpareItemHistoryBtns();
        requestAnimationFrame(() => {
            syncWrSpareHeadLayout();
            requestAnimationFrame(syncWrSpareHeadLayout);
        });
    }

    function teardownWrSparePage2() {
        const m = modState(getState());
        m.wrSpareOpen = false;
        m.wrSpareTreeOpen = false;
        unbindWrSpareTreePopover();
        if (vlWrSpare) {
            vlWrSpare.destroy();
            vlWrSpare = null;
        }
        if (_wrSpareResizeObs) {
            _wrSpareResizeObs.disconnect();
            _wrSpareResizeObs = null;
        }
        _wrSpareCachedList = [];
        _wrSpareLineBySpareId = null;
        teardownPage2JobContext();
    }

    async function renderConsumeModal() {
        const body = document.getElementById('spareConsumeBody');
        if (!body) return;
        syncConsumeLineMap();
        const { st, vesselId } = await vesselScope();
        spareInventoryUser(st);
        const m = modState(st);
        const draft = getConsumeSession();
        const isPreview = m.consumePreview;
        const canConsume = canCreateConsume(st);

        if (isPreview) m.consumeShowSelectedOnly = true;

        const allCanon = (st.spares || []).map(canon);
        _consumeCachedList = filteredConsumeSpares(st);
        if (isPreview) _consumeCachedList = _consumeCachedList.filter(s => consumeRowChecked(s));
        const lineCount = (draft?.lines || []).length;
        const titleSuffix = m.consumeEditMode ? ' <span class="muted">(Modify)</span>'
            : (isPreview ? ' <span class="muted">(Preview)</span>' : '');
        const editBlock = `<div id="consumeEditBlock">${renderConsumeGroupHeaderHtml(st)}</div>`;
        const wrReportId = draft?.work_report_id || resolveConsumeDraftWorkReportId(draft, st);

        const headActions = isPreview
            ? `<button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.consumePreviewOpenWorkReport()"${wrReportId ? '' : ' disabled'} title="${wrReportId ? 'View linked Work Report' : 'Not created from Work Report'}">Work Report</button>
               <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.consumePreviewModify()"${canConsume ? '' : ' disabled'}>Modify</button>
               <button type="button" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.consumeLogPrintPreview()">🖨 Print</button>
               <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.consumeLogOpenList()">List</button>
               <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.closeConsumeModal()">Close</button>
               <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeConsumeModal()" title="Close">×</button>`
            : `<button type="button" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.saveConsume()">Save</button>
               <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.closeConsumeModal()">Close</button>
               <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeConsumeModal()">×</button>`;

        const listToolbar = isPreview ? '' : (() => {
            const selBtn = consumeSelectedBtnMeta(st);
            const selectedBtnCls = selBtn.active ? ' plan-selected-filter-active' : '';
            return `
              <div class="filter-bar orig-toolbar spare-item-toolbar wr-spare-toolbar">
                ${spareGroupTreeToggleHtml('consume', st)}
                ${spareItemHistoryBtnHtml()}
                <span class="wr-spare-toolbar-spacer" aria-hidden="true"></span>
                <div class="wr-spare-toolbar-actions">
                <button type="button" id="consumeSelectedBtn" class="btn btn-sm spare-req-selected-btn${selectedBtnCls}"
                    onclick="TVC_SpareMenu.consumeToggleSelectedOnly()" aria-pressed="${selBtn.active ? 'true' : 'false'}"
                    title="${escAttr(selBtn.title)}"${selBtn.disabled ? ' disabled' : ''}>${esc(selBtn.label)}</button>
                </div>
              </div>
              <div class="filter-bar spare-list-search-bar">
                <input type="search" class="search-input spare-list-search-input" id="consumeSearch" placeholder="Search Code / Item / Part No / Work"
                    value="${esc(m.partNo || m.description ? [m.partNo, m.description].filter(Boolean).join(' ') : (st.spareSearch || ''))}"
                    oninput="TVC_SpareMenu.consumeSetSearch(this.value)">
                <label class="sr-check"><input type="checkbox" ${m.showLowOnly ? 'checked' : ''}
                    onchange="TVC_SpareMenu.consumeToggleLowOnly()"> Low stock only</label>
                <span class="count-label" id="consumeCount">${m.consumeShowSelectedOnly
            ? consumeSelectedCountLabel(st, _consumeCachedList.length)
            : `${_consumeCachedList.length} / ${allCanon.length}`}</span>
              </div>`;
        })();

        const layoutCls = isPreview
            ? 'plan-layout spare-layout spare-req-work-layout spare-consume-work-layout wr-spare-full-width spare-consume-preview-layout'
            : 'plan-layout spare-layout spare-req-work-layout spare-consume-work-layout wr-spare-full-width';

        body.innerHTML = `
        <div class="spare-req-work-wrap">
          <div class="spare-req-work-head">
            <h3 class="spare-req-work-title">Consumed Spare Parts${titleSuffix}
              <span class="muted spare-consume-lines">${lineCount} line(s)</span></h3>
            <span class="spare-req-work-head-spacer"></span>
            ${headActions}
          </div>
          <div class="spare-req-work-scroll">
          ${renderConsumeMetaHtml(draft, { readonly: isPreview, department: st.department })}
          <div class="${layoutCls}">
            <main class="panel spare-main">
              ${listToolbar}
              ${editBlock}
              <div class="panel spare-list-panel">
                <div class="spare-req-table-hscroll">
                  <div class="spare-req-table-wide">
                    <div id="consumeListHead" class="vl-head-wrap sheet-scroll-original"></div>
                    <div id="consumeListScroll" class="virtual-scroll sheet-scroll-original spare-vl-scroll"></div>
                  </div>
                </div>
              </div>
            </main>
          </div>
          </div>
        </div>`;

        if (!isPreview) renderConsumeGroupTree();
        mountConsumeVirtualList();
        if (!isPreview) {
            refreshConsumeGroupPickList();
            updateConsumeSelectedBtn();
            bindSpareModalTreePopovers();
            updateSpareModalTreeToggleUi('consume');
            syncSpareItemHistoryBtns();
            bindConsumeListKeyboard();
        }
        requestAnimationFrame(() => {
            syncConsumeHeadLayout();
            requestAnimationFrame(syncConsumeHeadLayout);
        });
        syncSpareDateInputs(body);
    }

    async function startConsumeSession() {
        const { st } = await vesselScope();
        const user = spareInventoryUser(st);
        if (!user || !canCreateConsume(st)) {
            return alert('No permission to enter consumption records.');
        }
        _consumeDraft = newConsumeDraft(st, user);
        syncConsumeLineMap();
        const m = modState(st);
        m.consumeOpen = true;
        m.consumeEditMode = false;
        m.consumePreview = false;
        m.consumeLastSavedLogId = null;
        m.consumeFocusedId = null;
        m.consumeShowSelectedOnly = false;
        m.consumeTreeOpen = false;
        m.partNo = '';
        m.description = '';
        st.spareSearch = '';
        st.treeSearch = '';
        st.selectedGroupKey = null;
        _consumeGroupPickSearch = '';
        _consumeJobPickSearch = '';
        closeAllConsumeMetaPicks();
        await renderConsumeModal();
        showSpicsModal('spareConsumeModal');
    }

    async function startConsumeEditSession(logId) {
        const { st } = await vesselScope();
        if (!canCreateConsume(st)) {
            return alert('No permission to enter consumption records.');
        }
        const log = await TVC_Inventory.getConsumeLog(logId);
        if (!log) return alert('Consumption log not found.');
        _consumeDraft = consumeDraftFromLog(log);
        syncConsumeLineMap();
        const m = modState(st);
        m.consumeOpen = true;
        m.consumeEditMode = true;
        m.consumePreview = false;
        m.consumeLastSavedLogId = logId;
        m.selectedConsumeLogId = logId;
        m.consumeFocusedId = null;
        m.consumeShowSelectedOnly = true;
        m.partNo = '';
        m.description = '';
        st.spareSearch = '';
        st.treeSearch = '';
        st.selectedGroupKey = null;
        _consumeGroupPickSearch = '';
        _consumeJobPickSearch = '';
        closeAllConsumeMetaPicks();
        await renderConsumeModal();
        showSpicsModal('spareConsumeModal');
    }

    async function startConsumePreviewSession(logId) {
        const { st } = await vesselScope();
        const log = await TVC_Inventory.getConsumeLog(logId);
        if (!log) return alert('Consumption log not found.');
        _consumeDraft = consumeDraftFromLog(log);
        if (!_consumeDraft.work_report_id) {
            _consumeDraft.work_report_id = resolveConsumeDraftWorkReportId(_consumeDraft, st);
            if (!_consumeDraft.work_report_id && log.id) {
                const all = await TVC_DB.getAll('daily_work_reports');
                const linked = all.find(r => r.consume_log_id === log.id);
                _consumeDraft.work_report_id = linked?.id || '';
            }
        }
        syncConsumeLineMap();
        const m = modState(st);
        m.consumeOpen = true;
        m.consumeEditMode = false;
        m.consumePreview = true;
        m.consumeLastSavedLogId = logId;
        m.selectedConsumeLogId = logId;
        m.consumeFocusedId = null;
        m.consumeShowSelectedOnly = true;
        const firstLine = (log.lines || [])[0];
        if (firstLine?.spare_part_id) m.consumeFocusedId = firstLine.spare_part_id;
        m.partNo = '';
        m.description = '';
        st.spareSearch = '';
        st.treeSearch = '';
        st.selectedGroupKey = null;
        _consumeGroupPickSearch = '';
        _consumeJobPickSearch = '';
        closeAllConsumeMetaPicks();
        await renderConsumeModal();
        showSpicsModal('spareConsumeModal');
    }

    async function closeConsumeModal(opts = {}) {
        const st = getState();
        const m = modState(st);
        if (!opts.skipConfirm && !m.consumePreview) {
            if (!confirm('작성을 취소하시겠습니까?')) return;
        }
        const draft = getConsumeSession();
        if (draft?.log_id) {
            captureConsumeMeta();
            await tryApplySpareApprovalOnClose('consume', draft, st.department);
        }
        const returnToList = _consumeListReturnAfterSave;
        const selectId = m.consumeLastSavedLogId || m.selectedConsumeLogId || null;
        m.consumeOpen = false;
        m.consumeEditMode = false;
        m.consumePreview = false;
        m.consumeLastSavedLogId = null;
        m.consumeFocusedId = null;
        m.consumeShowSelectedOnly = false;
        m.consumeTreeOpen = false;
        const consumeModal = document.getElementById('spareConsumeModal');
        if (consumeModal) consumeModal._consumeKeyBound = false;
        _consumeDraft = null;
        _consumeLineBySpareId = null;
        _consumeGroupPickSearch = '';
        _consumeJobPickSearch = '';
        _consumeListReturnAfterSave = false;
        closeAllConsumeMetaPicks();
        if (_consumeResizeObs) { _consumeResizeObs.disconnect(); _consumeResizeObs = null; }
        if (vlConsume) { vlConsume.destroy(); vlConsume = null; }
        closeSpicsModal('spareConsumeModal');
        if (st.currentTab === 'spare') render();
        if (returnToList) {
            openConsumeLogModal(selectId ? { selectId } : {});
        }
    }

    async function persistConsumeLogFromDraft(draft, { st, user, vesselId, department, extra = {} }) {
        const logLines = (draft.lines || [])
            .filter(l => consumeSpareIdKey(l.spare_part_id) && (Number(l.qty_consumed) || 0) > 0)
            .map(l => ({
                spare_part_id: l.spare_part_id,
                part_no: l.part_no || '',
                name: l.name || '',
                qty: Number(l.qty_consumed) || 0,
            }));
        const shipsComments = String(draft.ships_comments || '').trim();
        const curStatus = spareListStatus(draft);
        const nextStatus = (curStatus === SPARE_LIST_STATUS.CONFIRMED || curStatus === SPARE_LIST_STATUS.APPROVED)
            ? curStatus
            : SPARE_LIST_STATUS.REPORTED;
        ensureConsumeJobItems(draft);
        syncConsumeDraftJobSummary(draft);
        const jobItems = draft.job_items.map(i => ({
            job_code: i.job_code || '',
            sort1: i.sort1 || '',
            sort2: i.sort2 || '',
            job_detail: i.job_detail || '',
        }));
        return TVC_Inventory.saveConsumeLog({
            id: draft.log_id || undefined,
            vessel_id: vesselId,
            department: department || st.department || '',
            consumed_date: draft.consumed_date || '',
            pms_group_no: draft.spare_group_label ? safeTreeLabel(draft.spare_group_label) : '',
            pms_group_key: draft.spare_group_key || '',
            job_code: draft.job_code || '',
            job_items: jobItems,
            ships_comments: shipsComments,
            made_on: draft.made_on || '',
            made_by: draft.made_by || '',
            sort1: draft.sort1 || '',
            sort2: draft.sort2 || '',
            job_detail: draft.job_detail || '',
            list_status: draft.list_status || nextStatus,
            confirmed_by: draft.confirmed_by || '',
            confirmed_at: draft.confirmed_at || '',
            approved_by: draft.approved_by || '',
            approved_at: draft.approved_at || '',
            lines: logLines,
            line_count: logLines.length,
            operator_id: user?.id || user?.username || '',
            operator_name: user?.display_name || '',
            ...extra,
        });
    }

    function consumeLogLinesToStock(lines) {
        return (lines || [])
            .filter(l => consumeSpareIdKey(l.spare_part_id) && (Number(l.qty ?? l.qty_consumed) || 0) > 0)
            .map(l => ({
                spare_part_id: l.spare_part_id,
                qty: Number(l.qty ?? l.qty_consumed) || 0,
            }));
    }

    async function reverseConsumeLogStockForLog(user, log, note, opts = {}) {
        if (!user || !log?.stock_applied_at) return;
        const revLines = consumeLogLinesToStock(log.lines);
        if (!revLines.length) return;
        await TVC_InventoryService.reverseConsumption(user, revLines, {
            ref: log.job_code || '',
            source_id: log.id,
            source_type: 'consume_log',
            note: note || 'Consumption cleared — stock restored',
            skipRbac: !!opts.skipRbac,
        });
    }

    async function applyConsumeLogStock(user, { logId, prevLog, nextLines, ref, note, sourceType = 'consume_log', skipRbac = false }) {
        const prevLines = consumeLogLinesToStock(prevLog?.lines);
        const lines = consumeLogLinesToStock(nextLines);
        if (!lines.length) {
            await reverseConsumeLogStockForLog(user, prevLog, undefined, { skipRbac });
            await reloadSparesCache();
            return '';
        }
        const applyDiff = async (forceOk = false) => {
            await TVC_InventoryService.applyConsumptionDiff(user, prevLines, lines, {
                ref,
                source_id: logId,
                source_type: sourceType,
                forceOk,
            });
        };
        try {
            if (prevLog?.stock_applied_at) {
                await applyDiff(false);
                await reloadSparesCache();
                return prevLog.stock_applied_at;
            }
            const res = await TVC_InventoryService.recordConsumption(user, lines, {
                ref,
                note,
                source_id: logId,
                source_type: sourceType,
                skipRbac,
            });
            await reloadSparesCache();
            return res.at;
        } catch (e) {
            if (e.code === 'STOCK' && confirm(e.message + '\n\nProceed anyway?')) {
                if (prevLog?.stock_applied_at) {
                    await applyDiff(true);
                    await reloadSparesCache();
                    return prevLog.stock_applied_at;
                }
                const res = await TVC_InventoryService.recordConsumption(user, lines, {
                    ref, note, source_id: logId, source_type: sourceType, forceOk: true, skipRbac,
                });
                await reloadSparesCache();
                return res.at;
            }
            throw e;
        }
    }

    async function syncConsumeLogFromWorkReport({ report, job, usedParts, form, user, department }) {
        if (!report?.id || !job) return { logId: null, stockAppliedAt: '' };
        await TVC_DB.open();
        const { vesselId } = await vesselScope();
        const logLines = (usedParts || [])
            .filter(p => consumeSpareIdKey(p.spare_part_id) && (Number(p.qty_used) || 0) > 0)
            .map(p => ({
                spare_part_id: p.spare_part_id,
                part_no: p.part_no || '',
                name: p.name || '',
                qty_consumed: Number(p.qty_used) || 0,
            }));
        const existingLogId = report.consume_log_id || null;
        const prevLog = existingLogId ? await TVC_Inventory.getConsumeLog(existingLogId) : null;

        if (!logLines.length) {
            if (existingLogId) {
                await reverseConsumeLogStockForLog(user, prevLog, undefined, { skipRbac: true });
                await TVC_Inventory.deleteConsumeLog(existingLogId);
                await reloadSparesCache();
            }
            return { logId: null, stockAppliedAt: '' };
        }

        const draft = {
            log_id: existingLogId || undefined,
            consumed_date: form?.reportDate || report.report_date || '',
            made_on: form?.workDate || report.work_date || '',
            made_by: TVC_RBAC.normalizeReportedByLabel?.(report.reporter_name) || spareReportedByForUser(user),
            spare_group_key: `${job.department || ''}|${String(job.group || '').trim()}`,
            spare_group_label: job.group || '',
            job_code: job.job_code || '',
            sort1: job.item_sort1 || '',
            sort2: job.item_sort2 || '',
            job_detail: job.job_detail || '',
            ships_comments: form?.shipComments || '',
            lines: logLines,
            job_items: (() => {
                const fromPage2 = capturePage2JobItems();
                if (fromPage2.length) return fromPage2.map(i => newConsumeJobRow(i));
                if (report.is_batch && report.job_items?.length) {
                    return report.job_items.map(it => newConsumeJobRow({
                        job_code: it.job_code || '',
                        sort1: it.item_sort1 || it.form?.sort1 || '',
                        sort2: it.item_sort2 || it.form?.sort2 || '',
                        job_detail: it.job_detail || it.form?.jobDetail || '',
                    }));
                }
                return [newConsumeJobRow({
                    job_code: job.job_code || '',
                    sort1: job.item_sort1 || '',
                    sort2: job.item_sort2 || '',
                    job_detail: job.job_detail || '',
                })];
            })(),
        };

        const st = getState();
        const saved = await persistConsumeLogFromDraft(draft, {
            st,
            user,
            vesselId: vesselId || user?.vessel_id || '',
            department,
            extra: {
                work_report_id: report.id,
                source: 'work_report',
            },
        });
        const stockAppliedAt = await applyConsumeLogStock(user, {
            logId: saved.id,
            prevLog,
            nextLines: logLines,
            ref: job.job_code || '',
            note: `Work Report — ${job.job_code || report.id}`,
            skipRbac: true,
        });
        if (stockAppliedAt) {
            await TVC_Inventory.saveConsumeLog({ ...saved, stock_applied_at: stockAppliedAt });
        }
        return { logId: saved.id, stockAppliedAt: stockAppliedAt || '' };
    }

    async function syncConsumeLogFromDefectReport({ defectCase, usedParts, user, department }) {
        if (!defectCase?.id) return { logId: null, stockAppliedAt: '' };
        await TVC_DB.open();
        const { vesselId } = await vesselScope();
        const logLines = (usedParts || [])
            .filter(p => consumeSpareIdKey(p.spare_part_id) && (Number(p.qty_used) || 0) > 0)
            .map(p => ({
                spare_part_id: p.spare_part_id,
                part_no: p.part_no || '',
                name: p.name || '',
                qty_consumed: Number(p.qty_used) || 0,
            }));
        const existingLogId = defectCase.consume_log_id || null;
        const prevLog = existingLogId ? await TVC_Inventory.getConsumeLog(existingLogId) : null;

        if (!logLines.length) {
            if (existingLogId) {
                await reverseConsumeLogStockForLog(user, prevLog, undefined, { skipRbac: true });
                await TVC_Inventory.deleteConsumeLog(existingLogId);
                await reloadSparesCache();
            }
            return { logId: null, stockAppliedAt: '' };
        }

        const groupKey = defectCase.pms_group_key
            || `${defectCase.department || ''}|${String(defectCase.pms_group_no || '').trim()}`;
        const draft = {
            log_id: existingLogId || undefined,
            consumed_date: defectCase.report_date || '',
            made_on: defectCase.work_date || '',
            made_by: defectCase.reported_by || spareReportedByForUser(user),
            spare_group_key: groupKey,
            spare_group_label: defectCase.pms_group_no || '',
            job_code: defectCase.pms_job_code || defectCase.job_code || '',
            sort1: defectCase.item_sort1 || '',
            sort2: defectCase.item_sort2 || '',
            job_detail: defectCase.job_detail || defectCase.job_name || '',
            ships_comments: defectCase.outline_maintenance_request || '',
            lines: logLines,
            job_items: (() => {
                if (Array.isArray(defectCase.job_items) && defectCase.job_items.length) {
                    return defectCase.job_items.map(i => newConsumeJobRow(i));
                }
                return [newConsumeJobRow({
                    job_code: defectCase.pms_job_code || defectCase.job_code || '',
                    sort1: defectCase.item_sort1 || '',
                    sort2: defectCase.item_sort2 || '',
                    job_detail: defectCase.job_detail || defectCase.job_name || '',
                })];
            })(),
        };

        const st = getState();
        const saved = await persistConsumeLogFromDraft(draft, {
            st,
            user,
            vesselId: vesselId || user?.vessel_id || '',
            department: department || defectCase.department || st.department || '',
            extra: {
                defect_case_id: defectCase.id,
                source: 'defect_report',
            },
        });
        const stockAppliedAt = await applyConsumeLogStock(user, {
            logId: saved.id,
            prevLog,
            nextLines: logLines,
            ref: draft.job_code,
            note: `Defect Report — ${defectCase.case_no || defectCase.id}`,
            skipRbac: true,
        });
        if (stockAppliedAt) {
            await TVC_Inventory.saveConsumeLog({ ...saved, stock_applied_at: stockAppliedAt });
        }
        return { logId: saved.id, stockAppliedAt: stockAppliedAt || '' };
    }

    async function saveConsume() {
        if (!confirm('저장하시겠습니까?')) return;
        captureConsumeMeta();
        captureConsumeLineQtys();
        const { st, vesselId } = await vesselScope();
        const user = spareInventoryUser(st);
        if (!user) return alert('Login required.');
        const draft = getConsumeSession();
        if (!draft) return;
        const m = modState(st);
        const lines = (draft.lines || [])
            .filter(l => consumeSpareIdKey(l.spare_part_id) && (Number(l.qty_consumed) || 0) > 0)
            .map(l => ({ spare_part_id: l.spare_part_id, qty: Number(l.qty_consumed), note: '' }));
        if (!lines.length) return alert('Select parts and enter Consumed quantity.');

        const noteParts = [
            draft.consumed_date ? `Consumed: ${draft.consumed_date}` : '',
            draft.made_on ? `Made: ${draft.made_on} by ${draft.made_by || '—'}` : '',
            draft.spare_group_label ? `Group: ${draft.spare_group_label}` : '',
            ...(ensureConsumeJobItems(draft).map((i, n) => {
                const parts = [i.sort1, i.sort2, i.job_detail].filter(Boolean);
                const label = i.job_code || `Job ${n + 1}`;
                return parts.length ? `${label}: ${parts.join(' / ')}` : (i.job_code ? `Job: ${i.job_code}` : '');
            }).filter(Boolean)),
            draft.ships_comments ? `Comments: ${draft.ships_comments}` : '',
        ].filter(Boolean);
        const ref = draft.job_code || '';
        const note = noteParts.join(' · ');

        if (draft.log_id) {
            const prev = await TVC_Inventory.getConsumeLog(draft.log_id);
            const prevLines = (prev?.lines || []).map(l => ({
                spare_part_id: l.spare_part_id,
                qty: Number(l.qty ?? l.qty_consumed) || 0,
            }));
            const isWrLinked = prev?.source === 'work_report' || !!prev?.work_report_id;
            if (!isWrLinked) {
                const applyDiff = async (forceOk = false) => {
                    await TVC_InventoryService.applyConsumptionDiff(user, prevLines, lines, {
                        ref: draft.job_code || '',
                        source_id: draft.log_id,
                        source_type: 'consume_log',
                        forceOk,
                    });
                };
                try {
                    if (prev?.stock_applied_at) {
                        await applyDiff(false);
                    } else if (lines.length) {
                        const res = await TVC_InventoryService.recordConsumption(user, lines, {
                            ref: draft.job_code || '',
                            note,
                            source_id: draft.log_id,
                            source_type: 'consume_log',
                        });
                        draft.stock_applied_at = res.at;
                    }
                } catch (e) {
                    if (e.code === 'STOCK' && confirm(e.message + '\n\nProceed anyway?')) {
                        if (prev?.stock_applied_at) await applyDiff(true);
                        else {
                            const res = await TVC_InventoryService.recordConsumption(user, lines, {
                                ref: draft.job_code || '', note, source_id: draft.log_id, forceOk: true,
                            });
                            draft.stock_applied_at = res.at;
                        }
                    } else throw e;
                }
            }
            const saved = await persistConsumeLogFromDraft(draft, {
                st, user, vesselId,
                extra: { stock_applied_at: draft.stock_applied_at || prev?.stock_applied_at || '' },
            });
            draft.log_id = saved.id;
            draft.list_status = spareListStatus(draft);
            if (applySpareApprovalFromUi(draft, 'consume', st.department)) {
                await persistConsumeLogFromDraft(draft, { st, user, vesselId });
            }
            m.consumeLastSavedLogId = saved.id;
            await reloadSparesCache();
            await refresh();
            alert(`Consumption log updated — ${lines.length} line(s).`);
            if (_consumeListReturnAfterSave) {
                await closeConsumeModal({ skipConfirm: true });
            } else {
                await renderConsumeModal();
            }
            return;
        }

        try {
            const res = await TVC_InventoryService.recordConsumption(user, lines, { ref, note, source_type: 'consume_log' });
            const saved = await persistConsumeLogFromDraft(draft, {
                st, user, vesselId,
                extra: { stock_applied_at: res.at },
            });
            draft.log_id = saved.id;
            await TVC_Inventory.saveConsumeLog({ ...saved, stock_applied_at: res.at });
            draft.list_status = SPARE_LIST_STATUS.REPORTED;
            m.consumeLastSavedLogId = saved.id;
            m.selectedConsumeLogId = saved.id;
            if (applySpareApprovalFromUi(draft, 'consume', st.department)) {
                await persistConsumeLogFromDraft(draft, { st, user, vesselId });
            }
            await closeConsumeModal({ skipConfirm: true });
            await reloadSparesCache();
            await refresh();
            await render();
            alert(`CONSUMPTION recorded — ${res.count} item(s)`);
        } catch (e) {
            if (e.code === 'STOCK' && confirm(e.message + '\n\nProceed anyway?')) {
                const res = await TVC_InventoryService.recordConsumption(user, lines, { ref, note, forceOk: true, source_type: 'consume_log' });
                const saved = await persistConsumeLogFromDraft(draft, {
                    st, user, vesselId,
                    extra: { stock_applied_at: res.at },
                });
                draft.log_id = saved.id;
                await TVC_Inventory.saveConsumeLog({ ...saved, stock_applied_at: res.at });
                draft.list_status = SPARE_LIST_STATUS.REPORTED;
                m.consumeLastSavedLogId = saved.id;
                m.selectedConsumeLogId = saved.id;
                if (applySpareApprovalFromUi(draft, 'consume', st.department)) {
                    await persistConsumeLogFromDraft(draft, { st, user, vesselId });
                }
                await closeConsumeModal({ skipConfirm: true });
                await reloadSparesCache();
                await refresh();
                await render();
                alert(`CONSUMPTION — ${res.count} item(s)`);
            } else alert(e.message || e.code || 'Save failed');
        }
    }

    function resetTxDraft(type) { _txDraft = { type, lines: [], search: '', ref: '', note: '' }; }

    // ── Received Spare Parts (Consumed Parts 스타일) ───────────────────
    function newReceiveDraft(st, user) {
        const today = new Date().toISOString().slice(0, 10);
        return {
            received_date: today,
            made_on: today,
            made_by: spareReportedByForUser(user),
            deliver_port: '',
            ships_comments: '',
            ref: '',
            requisition_id: null,
            lines: [],
        };
    }

    function buildReceiveLine(spare, qty) {
        const c = canon(spare);
        return {
            spare_part_id: c.id || spare.id,
            part_no: spareNumbering(c) || spare.part_no || '',
            name: c.name || spare.name || '',
            qty_received: Math.max(0, Math.floor(Number(qty) || 0)),
        };
    }

    function captureReceiveMeta() {
        const draft = getReceiveSession();
        if (!draft) return;
        const g = (id) => document.getElementById(id)?.value ?? '';
        const reqId = g('receiveReqNo').trim();
        draft.requisition_id = reqId || null;
        draft.received_date = g('receiveDate');
        draft.deliver_port = g('receiveDeliverPort');
        draft.made_by = resolveSpareReportedBy(draft, spareInventoryUser(getState()));
        draft.ships_comments = g('receiveShipComments');
    }

    function validateReceiveSave(draft) {
        if (!draft.requisition_id) return 'Requisition No.를 선택하세요.';
        if (!String(draft.received_date || '').trim()) return 'Received Date를 입력하세요.';
        if (!String(draft.deliver_port || '').trim()) return 'Received Port를 입력하세요.';
        const lines = (draft.lines || [])
            .filter(l => receiveSpareIdKey(l.spare_part_id) && (Number(l.qty_received) || 0) > 0);
        if (!lines.length) return 'Select parts and enter Received quantity.';
        return null;
    }

    function showReceiveSaveConfirm() {
        document.getElementById('spareReceiveConfirmModal')?.classList.remove('hidden');
    }

    function dismissReceiveSaveConfirm() {
        document.getElementById('spareReceiveConfirmModal')?.classList.add('hidden');
    }

    async function openCloseOsModal() {
        const st = getState();
        const m = modState(st);
        const { vesselId } = await vesselScope();
        const allReqs = await TVC_Inventory.listRequisitions(vesselId);
        const target = resolveCloseOsTargetReq(allReqs, m, st);
        if (!target) {
            return alert('Select a Received requisition with O/S > 0, or one with a pending O/S close awaiting your approval.');
        }
        const req = await TVC_Inventory.getRequisition(target.id);
        if (!req) return alert('Requisition not found.');
        _closeOsReqId = req.id;
        renderCloseOsModal(req);
        document.getElementById('spareCloseOsModal')?.classList.remove('hidden');
    }

    function closeCloseOsModal() {
        _closeOsReqId = null;
        document.getElementById('spareCloseOsModal')?.classList.add('hidden');
    }

    function renderCloseOsModal(req) {
        const st = getState();
        const approval = closeOsApprovalState(req, st);
        const osQty = reqRawOutstandingData(req);
        const reason = String(req.os_waive_reason || '');
        const reasonLocked = approval.isConfirmed;
        const body = document.getElementById('spareCloseOsBody');
        if (!body) return;
        body.innerHTML = `
            <h3 class="spare-close-os-title">Close O/S</h3>
            <p class="muted spare-close-os-meta">Requisition: <strong>${esc(req.req_no || '—')}</strong></p>
            <p class="spare-close-os-os">Remaining O/S: <strong>${osQty}</strong></p>
            <div class="spare-close-os-reason">
                <label class="spare-close-os-reason-label" for="closeOsReason">Reason <span class="muted">(required)</span></label>
                <textarea id="closeOsReason" class="spare-req-meta-input spare-close-os-reason-input" rows="3" placeholder="Enter reason for closing outstanding quantity"${reasonLocked ? ' readonly' : ''}>${esc(reason)}</textarea>
            </div>
            ${renderSpareApprovalHtml({
                prefix: 'closeOs',
                canApproveNow: approval.canApproveNow,
                canConfirmNow: approval.canConfirmNow,
                isRepApproved: approval.isApproved,
                isRepConfirmed: approval.isConfirmed,
                approvedByVal: approval.approvedByVal,
                confirmedByVal: approval.confirmedByVal,
            })}
            <div class="modal-actions spare-close-os-actions">
                <button type="button" class="btn btn-green" onclick="TVC_SpareMenu.saveCloseOsWaive()">Save</button>
                <button type="button" class="btn" onclick="TVC_SpareMenu.closeCloseOsModal()">Cancel</button>
            </div>`;
    }

    async function saveCloseOsWaive() {
        if (!_closeOsReqId) return;
        const req = await TVC_Inventory.getRequisition(_closeOsReqId);
        if (!req) return alert('Requisition not found.');
        const st = getState();
        const reason = String(document.getElementById('closeOsReason')?.value || '').trim();
        const initiated = reqOsWaiveInitiated(req);
        if (!initiated && !reason) return alert('Reason is required.');
        if (!initiated && !reqCanCloseOs(req)) return alert('This requisition cannot close O/S.');
        if (req.os_waived_confirmed_at && reason !== String(req.os_waive_reason || '').trim()) {
            return alert('Reason cannot be changed after confirmation.');
        }
        let changed = false;
        const now = new Date().toISOString();
        if (!req.os_waived_confirmed_at && reason && reason !== String(req.os_waive_reason || '').trim()) {
            req.os_waive_reason = reason;
            req.os_closure = 'WAIVED';
            changed = true;
        }
        const approval = closeOsApprovalState(req, st);
        const cfCb = document.getElementById('closeOsConfirmedBy');
        const apCb = document.getElementById('closeOsApprovedBy');
        if (cfCb?.checked && !cfCb.disabled && approval.canConfirmNow) {
            if (!String(req.os_waive_reason || '').trim() && reason) {
                req.os_waive_reason = reason;
                req.os_closure = 'WAIVED';
            }
            if (!String(req.os_waive_reason || '').trim()) return alert('Enter reason before confirming.');
            req.os_waived_confirmed_by = requisitionConfirmByLabel(st, req);
            req.os_waived_confirmed_at = now;
            changed = true;
        }
        if (apCb?.checked && !apCb.disabled && approval.canApproveNow) {
            req.os_waived_approved_by = 'Company';
            req.os_waived_approved_at = now;
            req.os_closure = 'WAIVED';
            changed = true;
        }
        if (!changed) return alert('No changes to save.');
        await TVC_Inventory.saveRequisition(req);
        const loadedId = _reqSheet.reqId || _reqWorkDraft?.id;
        const m = modState(st);
        if (loadedId === req.id && isRequisitionListWindow(m)) {
            await loadRequisitionIntoListWindow(req.id);
        }
        await refreshReqListUi();
        await syncReportedWaitAndRefreshList();
        syncReqWorkListWindowHeadButtons();
        if (reqOsWaived(req)) {
            alert('O/S closed — approved by Company.');
            closeCloseOsModal();
            return;
        }
        if (req.os_waived_confirmed_at) alert('O/S close request confirmed.');
        else alert('O/S close request saved.');
        renderCloseOsModal(req);
    }

    async function confirmSaveReceive(yes) {
        dismissReceiveSaveConfirm();
        if (!yes) return;
        await saveReceiveProceed();
    }

    async function receiveEligibleRequisitions(vesselId) {
        const all = await TVC_Inventory.listRequisitions(vesselId);
        return all
            .filter(r => spareListStatus(r) !== SPARE_LIST_STATUS.DRAFT)
            .sort((a, b) => (b.created_at || b.made_on || '').localeCompare(a.created_at || a.made_on || ''));
    }

    async function renderReceiveMetaHtml(draft) {
        const { vesselId } = await vesselScope();
        const reportedByVal = resolveSpareReportedBy(draft, spareInventoryUser(getState()));
        const reqs = await receiveEligibleRequisitions(vesselId);
        const opts = reqs.map(r => {
            const sel = r.id === draft.requisition_id ? ' selected' : '';
            return `<option value="${escAttr(r.id)}"${sel}>${esc(r.req_no)} — ${esc(reqListWorkflowLabel(r))}</option>`;
        }).join('');
        return `<section class="spare-consume-meta-form spare-receive-meta-form" aria-label="Received spare parts information">
            <div class="spare-consume-meta-row spare-receive-meta-row-req">
                <label class="spare-consume-meta-label" for="receiveReqNo">Requisition No.</label>
                <select id="receiveReqNo" class="spare-req-meta-input spare-consume-meta-input spare-receive-req-select" onchange="TVC_SpareMenu.receiveSelectRequisition(this.value || null)">
                    <option value="">— Select Requisition —</option>${opts}
                </select>
            </div>
            <div class="spare-consume-meta-row-top spare-receive-meta-row-top">
                <div class="spare-consume-meta-field spare-consume-meta-field-date">
                    <label class="spare-consume-meta-inline-label" for="receiveDate">Received Date</label>
                    <input type="text" id="receiveDate" class="spare-req-meta-input spare-consume-meta-input tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(draft.received_date || ''))}" onchange="TVC_SpareMenu.captureReceiveMeta()">
                </div>
                <div class="spare-consume-meta-field spare-receive-meta-field-port">
                    <label class="spare-consume-meta-inline-label" for="receiveDeliverPort">Received Port</label>
                    <input type="text" id="receiveDeliverPort" class="spare-req-meta-input spare-consume-meta-input" value="${esc(draft.deliver_port || '')}" placeholder="Received port" onchange="TVC_SpareMenu.captureReceiveMeta()">
                </div>
                <div class="spare-consume-meta-field spare-consume-meta-field-by">
                    <label class="spare-consume-meta-inline-label" for="receiveReportedBy">Reported by</label>
                    <input type="text" id="receiveReportedBy" class="spare-req-meta-input spare-consume-meta-input wr-ro" value="${esc(reportedByVal)}" readonly disabled tabindex="-1">
                </div>
            </div>
            <div class="spare-consume-meta-comments">
                <label class="spare-consume-meta-col-head" for="receiveShipComments">Ship's Comments</label>
                <textarea id="receiveShipComments" class="spare-req-meta-input spare-consume-meta-textarea" rows="2"
                    placeholder="Remarks for this receipt…" oninput="TVC_SpareMenu.captureReceiveMeta()">${esc(draft.ships_comments || '')}</textarea>
            </div>
        </section>`;
    }

    async function receiveSelectRequisition(reqId) {
        captureReceiveMeta();
        const draft = getReceiveSession();
        if (!draft) return;
        const id = reqId ? String(reqId).trim() : '';
        draft.requisition_id = id || null;
        if (!id) {
            await renderReceiveModal();
            return;
        }
        const req = await TVC_Inventory.getRequisition(id);
        if (!req) return alert('Requisition not found.');
        draft.ref = draft.ref || req.req_no || '';
        if (!draft.deliver_port) draft.deliver_port = req.deliver_port || '';
        if (!draft.made_by) draft.made_by = req.made_by || '';
        const st = getState();
        draft.lines = [];
        (req.lines || []).forEach(l => {
            const sid = receiveSpareIdKey(l.spare_part_id);
            if (!sid) return;
            const spare = (st.spares || []).find(s => receiveSameSpareId(s.id, sid));
            const approved = Number(l.qty_approved);
            const requested = Number(l.qty_requested);
            const already = Number(l.qty_received) || 0;
            const target = ((approved > 0 ? approved : requested) || 0) - already;
            const qty = Math.max(0, Math.floor(target));
            if (!qty && !spare) return;
            draft.lines.push(buildReceiveLine(spare || {
                id: sid, part_no: l.part_no, name: l.name,
            }, qty));
        });
        syncReceiveLineMap();
        modState(st).receiveShowSelectedOnly = draft.lines.length > 0;
        const firstLine = draft.lines[0];
        if (firstLine) {
            modState(st).receiveFocusedId = receiveSpareIdKey(firstLine.spare_part_id) || null;
        }
        await renderReceiveModal();
    }

    function renderReceiveGroupTree() {
        const st = getState();
        const root = document.getElementById('receiveGroupTree');
        if (!root) return;
        if (!st.idx && (st.jobs || []).length && window.TVC_Indexes) {
            st.idx = TVC_Indexes.build(st);
        }
        if (!st.idx) {
            root.innerHTML = '<div class="tree-empty muted">Loading Maintenance Plan…</div>';
            return;
        }
        const q = (st.treeSearch || '').toLowerCase();
        const matchNode = (n) => !q || (n.label || '').toLowerCase().includes(q) || (n.department || '').toLowerCase().includes(q);
        const matchCritical = !q || 'critical equipment'.includes(q) || q.includes('critical') || q.includes('crit');
        const byDept = new Map();
        (st.idx.groupNodes || [])
            .filter(n => {
                if (isHiddenSpareGroup(n.label, n.department)) return false;
                if (st.department && n.department !== st.department) return false;
                if (matchNode(n)) return true;
                return isGeneratorEngineGroupLabel(n.label) && matchMergedGeneratorSearch(q);
            })
            .forEach(n => {
                if (!byDept.has(n.department)) byDept.set(n.department, []);
                byDept.get(n.department).push(n);
            });
        const allSelected = !st.selectedGroupKey;
        let html = `<div class="tree-node${allSelected ? ' selected' : ''}" onclick="TVC_SpareMenu.receiveSelectGroup(null)"><span>📋 All Groups</span></div>`;
        if (matchCritical) {
            const critSel = st.selectedGroupKey === CRITICAL_GROUP_KEY ? ' selected' : '';
            html += `<div class="tree-node tree-node-critical${critSel}" onclick="TVC_SpareMenu.receiveSelectGroup('${CRITICAL_GROUP_KEY}')"><span>⚠ Critical Equipment</span></div>`;
        }
        DEPT_TREE_ORDER.filter(d => byDept.has(d)).forEach(dept => {
            const nodes = byDept.get(dept);
            html += `<div class="tree-dept">${esc(dept)}</div>`;
            mergeSpareTreeNodes(nodes).forEach(n => {
                const emptyTag = n.isEmpty ? `<span class="tree-empty-tag" title="No job items">0</span>` : '';
                const sel = st.selectedGroupKey === n.key ? ' selected' : '';
                html += `<div class="tree-node${sel}${n.isEmpty ? ' tree-node-empty' : ''}" onclick="TVC_SpareMenu.receiveSelectGroup('${escAttr(n.key)}')"><span>${esc(safeTreeLabel(n.label))}</span>${emptyTag}</div>`;
            });
        });
        root.innerHTML = html;
        const searchEl = document.getElementById('receiveTreeSearch');
        if (searchEl && document.activeElement !== searchEl) searchEl.value = st.treeSearch || '';
    }

    function syncReceiveHeadLayout() {
        syncHeadLayout('receiveListScroll', 'receiveListHead', 'receiveListHeadTrack', SPARE_RECEIVE_MIN_WIDTH);
    }

    function updateReceiveHeadCheckAll() {
        const el = document.getElementById('receiveHeadChkAll');
        if (!el) return;
        const list = _receiveCachedList || [];
        if (!list.length) {
            el.checked = false;
            el.indeterminate = false;
            return;
        }
        let n = 0;
        list.forEach(s => { if (receiveRowChecked(s)) n++; });
        el.checked = n === list.length;
        el.indeterminate = n > 0 && n < list.length;
    }

    function mountReceiveVirtualList() {
        const head = document.getElementById('receiveListHead');
        if (head) {
            head.innerHTML = `<div id="receiveListHeadTrack" class="spare-head-track"><table class="spare-data-table spare-data-head spare-data-table-receive">
                ${SPARE_RECEIVE_COLGROUP}
                ${SPARE_RECEIVE_TABLE_HEAD}
            </table></div>`;
        }
        const scroll = document.getElementById('receiveListScroll');
        if (!scroll) return;
        const hscroll = scroll.closest('.spare-req-table-hscroll');
        const scrollTop = scroll.scrollTop;
        const hScrollLeft = hscroll?.scrollLeft || 0;
        if (vlReceive) vlReceive.destroy();
        if (!_receiveCachedList.length) {
            scroll.innerHTML = `<div class="spare-empty-list muted" style="padding:24px;text-align:center">No parts to display.</div>`;
            vlReceive = null;
            return;
        }
        const m = modState(getState());
        vlReceive = TVC_VirtualList.mount(scroll, {
            getCount: () => _receiveCachedList.length,
            renderRow: (i) => {
                const s = _receiveCachedList[i];
                return s ? rowHtml(s, m.receiveFocusedId, null, 'receive') : '';
            },
            overflowX: 'hidden',
            overflowY: 'auto',
        });
        const inner = scroll.querySelector('.vl-inner');
        if (inner) {
            inner.style.minWidth = `${SPARE_RECEIVE_MIN_WIDTH}px`;
            inner.style.width = '100%';
        }
        scroll.scrollTop = scrollTop;
        if (hscroll) hscroll.scrollLeft = hScrollLeft;
        if (vlReceive) vlReceive.refresh();
        if (head) bindHeadLayoutSync(scroll, syncReceiveHeadLayout, 'receive');
        updateReceiveHeadCheckAll();
    }

    function refreshReceiveListUi() {
        const st = getState();
        const m = modState(st);
        const allCanon = (st.spares || []).map(canon);
        _receiveCachedList = filteredReceiveSpares(st);
        renderReceiveGroupTree();
        mountReceiveVirtualList();
        const countEl = document.getElementById('receiveCount');
        if (countEl) {
            countEl.textContent = m.receiveShowSelectedOnly
                ? receiveSelectedCountLabel(st, _receiveCachedList.length)
                : `${_receiveCachedList.length} / ${allCanon.length}`;
        }
        updateReceiveSelectedBtn();
        updateSpareModalTreeToggleUi('receive');
        syncReceiveGroupHeader(st);
        const linesEl = document.querySelector('.spare-receive-lines');
        if (linesEl && _receiveDraft) linesEl.textContent = `${(_receiveDraft.lines || []).length} line(s)`;
        syncSpareItemHistoryBtns();
    }

    function updateReceiveSelectedBtn() {
        const st = getState();
        const meta = receiveSelectedBtnMeta(st);
        const btn = document.getElementById('receiveSelectedBtn');
        if (!btn) return;
        btn.textContent = meta.label;
        btn.title = meta.title;
        btn.disabled = meta.disabled;
        btn.classList.toggle('plan-selected-filter-active', meta.active);
        btn.setAttribute('aria-pressed', meta.active ? 'true' : 'false');
    }

    async function renderReceiveModal() {
        const body = document.getElementById('spareReceiveBody');
        if (!body) return;
        const st = getState();
        const m = modState(st);
        const draft = getReceiveSession();
        if (!draft) return;
        const lineCount = (draft.lines || []).length;
        const selBtn = receiveSelectedBtnMeta(st);
        const selectedBtnCls = selBtn.active ? ' plan-selected-filter-active' : '';
        const editBlock = `<div id="receiveEditBlock">${renderSpareGroupHeaderHtml(st, { focusedId: m.receiveFocusedId })}</div>`;
        body.innerHTML = `
        <div class="spare-req-work-wrap">
          <div class="spare-req-work-head">
            <h3 class="spare-req-work-title">Received Spare Parts
              <span class="muted spare-receive-lines">${lineCount} line(s)</span></h3>
            <span class="spare-req-work-head-spacer"></span>
            <button type="button" class="btn btn-sm btn-green" onclick="TVC_SpareMenu.saveReceive()">Save</button>
            <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.closeReceiveModal()">Close</button>
            <button type="button" class="modal-x" onclick="TVC_SpareMenu.closeReceiveModal()" title="Close">×</button>
          </div>
          <div class="spare-req-work-scroll">
          ${await renderReceiveMetaHtml(draft)}
          <div class="plan-layout spare-layout spare-req-work-layout spare-receive-work-layout wr-spare-full-width">
            <main class="panel spare-main">
              <div class="filter-bar orig-toolbar spare-item-toolbar wr-spare-toolbar">
                ${spareGroupTreeToggleHtml('receive', st)}
                ${spareItemHistoryBtnHtml()}
                <span class="wr-spare-toolbar-spacer" aria-hidden="true"></span>
                <div class="wr-spare-toolbar-actions">
                <button type="button" id="receiveSelectedBtn" class="btn btn-sm spare-req-selected-btn${selectedBtnCls}"
                    onclick="TVC_SpareMenu.receiveToggleSelectedOnly()" aria-pressed="${selBtn.active ? 'true' : 'false'}"
                    title="${escAttr(selBtn.title)}"${selBtn.disabled ? ' disabled' : ''}>${esc(selBtn.label)}</button>
                </div>
              </div>
              <div class="spare-receive-content-stack">
              <div class="filter-bar spare-list-search-bar spare-receive-search-bar">
                <input type="search" class="search-input spare-list-search-input" id="receiveSearch" placeholder="Search Code / Item / Part No / Work"
                    value="${esc(st.spareSearch || '')}" oninput="TVC_SpareMenu.receiveSetSearch(this.value)">
                <span class="count-label" id="receiveCount">0</span>
              </div>
              ${editBlock}
              <div class="spare-receive-table-panel">
                <div class="spare-req-table-hscroll">
                  <div class="spare-req-table-wide">
                    <div id="receiveListHead" class="vl-head-wrap sheet-scroll-original"></div>
                    <div id="receiveListScroll" class="virtual-scroll sheet-scroll-original spare-vl-scroll"></div>
                  </div>
                </div>
              </div>
              </div>
            </main>
          </div>
          </div>
        </div>`;
        renderReceiveGroupTree();
        bindSpareModalTreePopovers();
        updateSpareModalTreeToggleUi('receive');
        refreshReceiveListUi();
        requestAnimationFrame(() => {
            syncReceiveHeadLayout();
            requestAnimationFrame(syncReceiveHeadLayout);
        });
        bindReceiveListKeyboard();
        syncSpareDateInputs(body);
    }

    async function startReceiveSession() {
        const { st } = await vesselScope();
        const user = spareInventoryUser(st);
        if (!user || !canCreateDeliver(st)) {
            return alert('No permission to record received parts.');
        }
        _receiveDraft = newReceiveDraft(st, user);
        syncReceiveLineMap();
        const m = modState(st);
        m.receiveOpen = true;
        m.receiveFocusedId = null;
        m.receiveShowSelectedOnly = false;
        m.receiveTreeOpen = false;
        st.spareSearch = '';
        st.treeSearch = '';
        st.selectedGroupKey = null;
        await renderReceiveModal();
        showSpicsModal('spareReceiveModal');
    }

    function closeReceiveModal() {
        dismissReceiveSaveConfirm();
        const st = getState();
        const m = modState(st);
        m.receiveOpen = false;
        m.receiveFocusedId = null;
        m.receiveShowSelectedOnly = false;
        m.receiveTreeOpen = false;
        const modal = document.getElementById('spareReceiveModal');
        if (modal) modal._receiveKeyBound = false;
        _receiveDraft = null;
        _receiveLineBySpareId = null;
        _receiveCachedList = [];
        if (vlReceive) { vlReceive.destroy(); vlReceive = null; }
        if (_receiveResizeObs) { _receiveResizeObs.disconnect(); _receiveResizeObs = null; }
        closeSpicsModal('spareReceiveModal');
        if (st.currentTab === 'spare') render();
    }

    function receiveToggleSelectedOnly() {
        const st = getState();
        const m = modState(st);
        if (m.receiveShowSelectedOnly) m.receiveShowSelectedOnly = false;
        else {
            if (!receiveCheckedSpareCount(st)) return alert('No parts selected.');
            m.receiveShowSelectedOnly = true;
        }
        refreshReceiveListUi();
    }

    function receiveSelectGroup(key) {
        const st = getState();
        st.selectedGroupKey = key || null;
        modState(st).receiveFocusedId = null;
        modState(st).receiveTreeOpen = false;
        refreshReceiveListUi();
    }

    function receiveToggleGroupTree() {
        const st = getState();
        const m = modState(st);
        m.receiveTreeOpen = !m.receiveTreeOpen;
        if (m.receiveTreeOpen) renderReceiveGroupTree();
        updateSpareModalTreeToggleUi('receive');
    }

    function receiveSetTreeSearch(v) {
        getState().treeSearch = v;
        renderReceiveGroupTree();
    }

    function receiveSetSearch(v) { setSearch(v); }

    function syncReceiveGroupHeader(st) {
        const block = document.getElementById('receiveEditBlock');
        if (!block) return;
        const m = modState(st);
        block.innerHTML = renderSpareGroupHeaderHtml(st, { focusedId: m.receiveFocusedId });
    }

    function receiveNavigableSpares(st) {
        return (_receiveCachedList || []).filter(s => receiveRowChecked(s));
    }

    function findReceiveRowTable(spareId) {
        const sid = receiveSpareIdKey(spareId);
        const scroll = document.getElementById('receiveListScroll');
        if (!scroll || !sid) return null;
        for (const el of scroll.querySelectorAll('[data-spare-id]')) {
            if (el.dataset.spareId === sid) return el;
        }
        return null;
    }

    function scrollReceiveRowIntoView(spareId) {
        const scroll = document.getElementById('receiveListScroll');
        if (!scroll || !spareId) return;
        if (vlReceive && scroll.querySelector('.vl-inner')) {
            const idx = (_receiveCachedList || []).findIndex(s => receiveSameSpareId(s.id, spareId));
            if (idx < 0) return;
            const rowH = TVC_VirtualList.ROW_H || 36;
            const viewH = scroll.clientHeight || 400;
            const rowTop = idx * rowH;
            const rowBottom = rowTop + rowH;
            if (rowTop < scroll.scrollTop) scroll.scrollTop = rowTop;
            else if (rowBottom > scroll.scrollTop + viewH) scroll.scrollTop = rowBottom - viewH;
            return;
        }
        findReceiveRowTable(spareId)?.scrollIntoView({ block: 'nearest' });
    }

    function focusReceiveQtyInput(spareId) {
        if (!spareId) return;
        const table = findReceiveRowTable(spareId);
        const input = table?.querySelector('.spare-receive-qty-input:not([disabled])');
        if (input) {
            input.focus();
            input.select();
        }
    }

    function receiveApplyRowFocus(spareId, focusQty = false) {
        const st = getState();
        setFocusedSpareId(st, spareId || null);
        syncReceiveGroupHeader(st);
        scrollReceiveRowIntoView(spareId);
        if (vlReceive) {
            vlReceive.refresh();
            updateReceiveHeadCheckAll();
            requestAnimationFrame(() => {
                syncReceiveHeadLayout();
                requestAnimationFrame(syncReceiveHeadLayout);
            });
        }
        syncSpareItemHistoryBtns();
        if (focusQty && spareId) {
            const spare = (st.spares || []).find(s => receiveSameSpareId(s.id, spareId));
            if (spare && receiveRowChecked(spare)) {
                requestAnimationFrame(() => {
                    focusReceiveQtyInput(spareId);
                    requestAnimationFrame(() => focusReceiveQtyInput(spareId));
                });
            }
        }
    }

    function receiveMoveFocusRow(delta) {
        const st = getState();
        const list = receiveNavigableSpares(st);
        if (!list.length) return;
        const curId = getFocusedSpareId(st);
        let idx = list.findIndex(s => receiveSameSpareId(s.id, curId));
        if (idx < 0) idx = delta > 0 ? -1 : list.length;
        const next = list[idx + delta];
        if (!next) return;
        receiveApplyRowFocus(next.id, true);
    }

    function onReceiveListKeydown(e) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const t = e.target;
        if (!t.closest?.('#receiveListScroll')) return;
        if (t.tagName === 'INPUT' && !t.classList.contains('spare-receive-qty-input')) return;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
        e.preventDefault();
        receiveMoveFocusRow(e.key === 'ArrowDown' ? 1 : -1);
    }

    function bindReceiveListKeyboard() {
        const modal = document.getElementById('spareReceiveModal');
        if (!modal || modal._receiveKeyBound) return;
        modal._receiveKeyBound = true;
        modal.addEventListener('keydown', onReceiveListKeydown, true);
    }

    function receiveFocusRow(spareId, focusQty = false) {
        if (spareId) receiveApplyRowFocus(spareId, focusQty);
        else {
            setFocusedSpareId(getState(), null);
            syncReceiveGroupHeader(getState());
            if (vlReceive) { vlReceive.refresh(); updateReceiveHeadCheckAll(); }
        }
    }

    function receiveToggleAll(checked) {
        const draft = getReceiveSession();
        if (!draft) return;
        captureReceiveMeta();
        if (checked) {
            (_receiveCachedList || []).forEach(s => {
                if (!receiveRowChecked(s)) {
                    draft.lines.push(buildReceiveLine(s, 0));
                }
            });
        } else {
            const visibleIds = new Set((_receiveCachedList || []).map(s => receiveSpareIdKey(s.id)));
            draft.lines = (draft.lines || []).filter(l => !visibleIds.has(receiveSpareIdKey(l.spare_part_id)));
        }
        syncReceiveLineMap();
        refreshReceiveListUi();
    }

    function receiveToggleRow(spareId, checked) {
        const draft = getReceiveSession();
        if (!draft) return;
        const sid = receiveSpareIdKey(spareId);
        captureReceiveMeta();
        draft.lines = draft.lines || [];
        const spare = (getState().spares || []).find(s => receiveSameSpareId(s.id, sid));
        if (checked) {
            let line = draft.lines.find(l => receiveSameSpareId(l.spare_part_id, sid));
            if (!line && spare) {
                line = buildReceiveLine(spare, 0);
                draft.lines.push(line);
            }
        } else {
            draft.lines = draft.lines.filter(l => !receiveSameSpareId(l.spare_part_id, sid));
        }
        syncReceiveLineMap();
        if (modState(getState()).receiveShowSelectedOnly && !receiveCheckedSpareCount(getState())) {
            modState(getState()).receiveShowSelectedOnly = false;
        }
        const st = getState();
        if (checked && spare) receiveApplyRowFocus(spareId, false);
        else refreshReceiveListUi();
    }

    function receiveSetQty(spareId, rawQty) {
        const draft = getReceiveSession();
        if (!draft) return;
        const sid = receiveSpareIdKey(spareId);
        captureReceiveMeta();
        const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
        draft.lines = draft.lines || [];
        let line = draft.lines.find(l => receiveSameSpareId(l.spare_part_id, sid));
        const spare = (getState().spares || []).find(s => receiveSameSpareId(s.id, sid));
        if (!line && spare) {
            line = buildReceiveLine(spare, qty);
            draft.lines.push(line);
        } else if (line) {
            line.qty_received = qty;
        }
        syncReceiveLineMap();
        refreshReceiveListUi();
        if (spareId) {
            requestAnimationFrame(() => focusReceiveQtyInput(spareId));
        }
    }

    async function saveReceive() {
        captureReceiveMeta();
        const draft = getReceiveSession();
        if (!draft) return;
        const err = validateReceiveSave(draft);
        if (err) return alert(err);
        showReceiveSaveConfirm();
    }

    async function saveReceiveProceed() {
        captureReceiveMeta();
        const { st } = await vesselScope();
        const user = spareInventoryUser(st);
        if (!user) return alert('Login required.');
        const draft = getReceiveSession();
        if (!draft) return;
        const err = validateReceiveSave(draft);
        if (err) return alert(err);
        const lines = (draft.lines || [])
            .filter(l => receiveSpareIdKey(l.spare_part_id) && (Number(l.qty_received) || 0) > 0)
            .map(l => ({ spare_part_id: l.spare_part_id, qty: Number(l.qty_received), note: draft.ships_comments || '' }));
        if (!lines.length) return alert('Select parts and enter Received quantity.');
        const noteParts = [
            draft.received_date ? `Received: ${draft.received_date}` : '',
            draft.deliver_port ? `Port: ${draft.deliver_port}` : '',
            draft.made_by ? `Reported by: ${draft.made_by}` : '',
            draft.ships_comments ? `Comments: ${draft.ships_comments}` : '',
        ].filter(Boolean);
        try {
            const res = await TVC_InventoryService.recordDelivery(user, lines, {
                ref: draft.ref || '',
                note: noteParts.join(' · '),
            });
            if (draft.requisition_id) {
                const req = await TVC_Inventory.getRequisition(draft.requisition_id);
                if (req) {
                    const recvDate = draft.received_date || new Date().toISOString().slice(0, 10);
                    req.received_on = recvDate;
                    req.received_date = recvDate;
                    if (draft.deliver_port) req.received_port = draft.deliver_port;
                    (req.lines || []).forEach(rl => {
                        const sid = receiveSpareIdKey(rl.spare_part_id);
                        const delivered = lines.find(l => receiveSameSpareId(l.spare_part_id, sid));
                        if (delivered) {
                            rl.qty_received = (Number(rl.qty_received) || 0) + delivered.qty;
                        }
                    });
                    await TVC_Inventory.saveRequisition(req);
                }
            }
            closeReceiveModal();
            await refresh();
            await render();
            alert(`RECEIVED — ${res.count} item(s)`);
        } catch (e) {
            alert(e.message || e.code || 'Save failed');
        }
    }

    function openConsumeModal() { startConsumeSession(); }
    function openDeliverModal() { startReceiveSession(); }
    function closeTxModal() { closeSpicsModal('spareTxModal'); resetTxDraft(null); }

    function captureTxDraftFromDom() {
        const ref = document.getElementById('spareTxRef');
        const note = document.getElementById('spareTxNote');
        if (ref) _txDraft.ref = ref.value;
        if (note) _txDraft.note = note.value;
        document.querySelectorAll('[data-tx-spare][data-tx-field="qty"]').forEach(el => {
            const row = _txDraft.lines.find(l => l.spare_part_id === el.dataset.txSpare);
            if (row) row.qty = Number(el.value) || 0;
        });
    }

    function txSearchHits() {
        const q = (_txDraft.search || '').trim().toLowerCase();
        if (!q) return [];
        const used = new Set(_txDraft.lines.map(l => l.spare_part_id));
        return (getState().spares || []).map(canon).filter(s => {
            if (used.has(s.id)) return false;
            const hay = [partNo(s), s.name, s.universalItemCode, s.universal_code].join(' ').toLowerCase();
            return hay.includes(q);
        }).slice(0, 20);
    }

    function buildTxHitsHtml() {
        const hits = txSearchHits();
        if (!hits.length) {
            const q = (_txDraft.search || '').trim();
            return q ? '<p class="muted spics-tx-empty">No search results</p>' : '';
        }
        return `<div class="spics-tx-hits"><table class="spics-tx-table"><thead><tr>
            <th>Part No</th><th>Description</th><th>Stock</th><th></th>
        </tr></thead><tbody>${hits.map(s => `<tr class="spics-tx-hit" onclick="TVC_SpareMenu.addTxLine('${s.id}')">
            <td><strong>${esc(partNo(s))}</strong></td><td>${esc(s.name)}</td>
            <td style="text-align:center">${TVC_Inventory.currentStock(s)}</td>
            <td><span class="pill ok">+ Add</span></td>
        </tr>`).join('')}</tbody></table></div>`;
    }

    function onTxSearchInput(v) {
        _txDraft.search = v;
        clearTimeout(_txSearchT);
        _txSearchT = setTimeout(() => {
            const wrap = document.getElementById('spareTxHitsWrap');
            if (wrap) wrap.innerHTML = buildTxHitsHtml();
        }, 120);
    }

    function addTxLine(spareId) {
        captureTxDraftFromDom();
        const s = (getState().spares || []).map(canon).find(x => x.id === spareId);
        if (!s || _txDraft.lines.some(l => l.spare_part_id === spareId)) return;
        _txDraft.lines.push({ spare_part_id: spareId, part_no: partNo(s), name: s.name, stock: TVC_Inventory.currentStock(s), qty: 1 });
        _txDraft.search = '';
        renderTxModal();
    }

    function removeTxLine(spareId) {
        captureTxDraftFromDom();
        _txDraft.lines = _txDraft.lines.filter(l => l.spare_part_id !== spareId);
        renderTxModal();
    }

    function renderTxModal() {
        const body = document.getElementById('spareTxModalBody');
        if (!body) return;
        const isConsume = _txDraft.type === TVC_INVENTORY_TX.CONSUMPTION;
        const title = isConsume ? 'Input Consumed Spare Parts / Qty.' : 'Input Delivered Parts / Qty.';
        const lines = _txDraft.lines || [];
        const lineRows = lines.length ? lines.map(l => `<tr>
            <td><strong>${esc(l.part_no)}</strong></td><td>${esc(l.name)}</td>
            <td style="text-align:center">${l.stock}</td>
            <td style="text-align:center"><input type="number" min="1" class="spics-tx-qty" data-tx-spare="${esc(l.spare_part_id)}" data-tx-field="qty" value="${l.qty}"></td>
            <td><button type="button" class="btn btn-sm btn-red" onclick="TVC_SpareMenu.removeTxLine('${esc(l.spare_part_id)}')">×</button></td>
        </tr>`).join('') : `<tr><td colspan="5" class="muted" style="text-align:center;padding:16px">Search and add parts</td></tr>`;

        body.innerHTML = `
            <button class="modal-x" onclick="TVC_SpareMenu.closeTxModal()">×</button>
            <h3 class="spics-tx-title">${title}</h3>
            <p class="spics-tx-hint">On save, date, time, user, change, and remaining qty are recorded in inventory_history.</p>
            <div class="spics-tx-search">
                <label>Search Part No / Name</label>
                <input type="search" id="spareTxSearch" class="search-input" placeholder="e.g. 01-001, Stud"
                    value="${esc(_txDraft.search)}" oninput="TVC_SpareMenu.onTxSearchInput(this.value)">
                <div id="spareTxHitsWrap">${buildTxHitsHtml()}</div>
            </div>
            <div class="spics-tx-grid">
                <label>Ref / Job Code<input id="spareTxRef" value="${esc(_txDraft.ref)}" placeholder="Optional"></label>
                <label>Note<input id="spareTxNote" value="${esc(_txDraft.note)}" placeholder="Optional"></label>
            </div>
            <div class="spics-tx-lines-wrap">
                <table class="spics-tx-table"><thead><tr>
                    <th>Part No</th><th>Description</th><th>On Hand</th><th>Qty</th><th></th>
                </tr></thead><tbody>${lineRows}</tbody></table>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-green" onclick="TVC_SpareMenu.saveTx()">💾 Save</button>
                <button type="button" class="btn" onclick="TVC_SpareMenu.closeTxModal()">Cancel</button>
            </div>`;
    }

    async function saveTx() {
        captureTxDraftFromDom();
        const { st } = await vesselScope();
        const user = st.user;
        if (!user) return alert('Login required.');
        const lines = _txDraft.lines.filter(l => l.qty > 0).map(l => ({ spare_part_id: l.spare_part_id, qty: l.qty, note: _txDraft.note }));
        if (!lines.length) return alert('Enter quantity.');
        try {
            const res = _txDraft.type === TVC_INVENTORY_TX.CONSUMPTION
                ? await TVC_InventoryService.recordConsumption(user, lines, { ref: _txDraft.ref, note: _txDraft.note })
                : await TVC_InventoryService.recordDelivery(user, lines, { ref: _txDraft.ref, note: _txDraft.note });
            closeTxModal();
            await refresh();
            await render();
            alert(`${res.tx_type} recorded — ${res.count} item(s)`);
        } catch (e) {
            if (e.code === 'STOCK' && _txDraft.type === TVC_INVENTORY_TX.CONSUMPTION && confirm(e.message + '\n\nProceed anyway?')) {
                const res = await TVC_InventoryService.recordConsumption(user, lines, { ref: _txDraft.ref, note: _txDraft.note, forceOk: true });
                closeTxModal(); await refresh(); await render();
                alert(`CONSUMPTION — ${res.count} item(s)`);
            } else alert(e.message || e.code || 'Save failed');
        }
    }

    function openHqImportModal() { document.getElementById('spareHqImportFile')?.click(); }

    async function onHqImportFile(file) {
        if (!file) return;
        try {
            _hqAssessment = await TVC_InventoryService.diffHqImport(JSON.parse(await file.text()));
            openAssessmentModal();
        } catch (e) { alert('HQ Import JSON failed: ' + (e.message || e)); }
        finally { const fi = document.getElementById('spareHqImportFile'); if (fi) fi.value = ''; }
    }

    function openAssessmentModal() {
        const body = document.getElementById('spareAssessmentBody');
        if (!body || !_hqAssessment) return alert('Load JSON via Data Import first.');
        const s = _hqAssessment.summary;
        const rows = (_hqAssessment.diff || []).slice(0, 200).map(d => `<tr>
            <td><span class="pill ${d.type === 'NEW' ? 'ok' : 'overdue'}">${esc(d.type)}</span></td>
            <td>${esc(d.part_no)}</td><td>${esc(d.name)}</td><td>${esc(d.field)}</td>
            <td style="text-align:right">${esc(String(d.before))}</td><td style="text-align:right">${esc(String(d.after))}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center">No differences</td></tr>';
        body.innerHTML = `
            <button class="modal-x" onclick="TVC_SpareMenu.closeAssessmentModal()">×</button>
            <h3>Assessment Result (HQ Import Diff)</h3>
            <div class="spics-assess-summary">Total: <b>${s.total}</b> · New: <b>${s.newItems}</b> · Stock Δ: <b>${s.stockChanges}</b> · Price Δ: <b>${s.priceChanges}</b></div>
            <div class="spics-tx-lines-wrap"><table class="spics-tx-table"><thead><tr>
                <th>Type</th><th>Part No</th><th>Name</th><th>Field</th><th>Before</th><th>After</th>
            </tr></thead><tbody>${rows}</tbody></table></div>
            <div class="modal-actions">
                <button type="button" class="btn btn-green" onclick="TVC_SpareMenu.applyHqAssessment()">Apply Assessment</button>
                <button type="button" class="btn" onclick="TVC_SpareMenu.closeAssessmentModal()">Close</button>
            </div>`;
        showSpicsModal('spareAssessmentModal');
    }

    function closeAssessmentModal() { closeSpicsModal('spareAssessmentModal'); }

    async function applyHqAssessment() {
        const { st } = await vesselScope();
        if (!_hqAssessment) return;
        try {
            const res = await TVC_InventoryService.applyHqAssessment(st.user, _hqAssessment);
            await refresh(); await render(); closeAssessmentModal();
            alert(`Assessment applied — ${res.updated} item(s)`);
        } catch (e) { alert(e.message || e.code); }
    }

    // ── Spare Item History (Consumed / Received / Requisition) ─────────
    let _shSpareId = null;
    let _shTab = 'consumed';

    function spareItemHistoryBtnHtml() {
        return `<button type="button" class="btn btn-sm spare-item-hist-btn" onclick="TVC_SpareMenu.openSpareItemHistoryForFocus()" title="View consumed / received / requisition history" disabled>📋 Spare History</button>`;
    }

    function syncSpareItemHistoryBtns() {
        const id = getFocusedSpareId(getState());
        document.querySelectorAll('.spare-item-hist-btn').forEach(btn => {
            btn.disabled = !id;
            btn.title = id
                ? 'View consumed / received / requisition history'
                : 'Select a spare part row first';
        });
    }

    function openSpareItemHistoryForFocus() {
        const id = getFocusedSpareId(getState());
        if (!id) return alert('Select a spare part row first.');
        openSpareItemHistory(id);
    }

    async function loadSpareItemHistoryData(spareId, vesselId) {
        const sid = String(spareId);
        const consumed = [];
        const seenConsumeLog = new Set();

        try {
            const logs = await TVC_Inventory.listConsumeLogs(vesselId);
            logs.forEach(log => {
                (log.lines || []).forEach(line => {
                    if (String(line.spare_part_id) !== sid) return;
                    const jobs = consumeLogJobItems(log);
                    consumed.push({
                        date: log.consumed_date || log.made_on || (log.created_at || '').slice(0, 10),
                        qty: Number(line.qty ?? line.qty_consumed) || 0,
                        logId: log.id,
                        pmsGroup: safeTreeLabel(log.pms_group_no || '') || '—',
                        jobCode: log.job_code || jobs[0]?.job_code || '—',
                        madeBy: log.made_by || '—',
                        status: log.list_status || '—',
                        source: log.work_report_id ? 'Work Report' : (log.source === 'defect' ? 'Defect Report' : 'Consumed Log'),
                        openLog: true,
                    });
                    seenConsumeLog.add(log.id);
                });
            });
        } catch (_) { /* noop */ }

        const received = [];
        try {
            const invRows = await TVC_InventoryService.getHistory({ spare_part_id: spareId, limit: 300 });
            invRows.forEach(h => {
                if (h.tx_type === TVC_INVENTORY_TX.DELIVERY) {
                    received.push({
                        date: h.date || (h.at || '').slice(0, 10),
                        qty: Number(h.qty_delta) || 0,
                        ref: h.ref || '—',
                        operator: h.operator_name || '—',
                        note: h.note || '—',
                        qtyAfter: h.qty_after,
                    });
                    return;
                }
                if (h.tx_type === TVC_INVENTORY_TX.CONSUMPTION && h.source_id && seenConsumeLog.has(h.source_id)) return;
                if (h.tx_type === TVC_INVENTORY_TX.CONSUMPTION) {
                    consumed.push({
                        date: h.date || (h.at || '').slice(0, 10),
                        qty: Math.abs(Number(h.qty_delta) || 0),
                        logId: h.source_id || '',
                        pmsGroup: '—',
                        jobCode: h.ref || '—',
                        madeBy: h.operator_name || '—',
                        status: h.tx_type,
                        source: h.source_type || 'Stock',
                        openLog: !!(h.source_id && h.source_type === 'consume_log'),
                    });
                }
            });
        } catch (_) { /* noop */ }

        const requisitions = [];
        try {
            const reqs = await TVC_Inventory.listRequisitions(vesselId);
            reqs.forEach(req => {
                (req.lines || []).forEach(line => {
                    if (String(line.spare_part_id) !== sid) return;
                    requisitions.push({
                        reqId: req.id,
                        reqNo: req.req_no || '—',
                        date: reqListReportedDate(req) || (req.created_at || '').slice(0, 10),
                        status: reqListStatusLabel(req),
                        qtyRequested: Number(line.qty_requested) || 0,
                        qtyReceived: Number(line.qty_received) || 0,
                        deliverPort: req.deliver_port || '—',
                        priority: req.priority || 'ROUTINE',
                    });
                });
            });
        } catch (_) { /* noop */ }

        const sortDesc = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));
        consumed.sort(sortDesc);
        received.sort(sortDesc);
        requisitions.sort(sortDesc);
        return { consumed, received, requisitions };
    }

    async function openSpareItemHistory(spareId, tab) {
        const st = getState();
        const spare = (st.spares || []).map(canon).find(s => String(s.id) === String(spareId));
        if (!spare) return alert('Spare part not found.');
        setFocusedSpareId(st, spareId);
        syncSpareItemHistoryBtns();
        if (_shSpareId !== spareId) _shTab = 'consumed';
        _shSpareId = spareId;
        if (tab) _shTab = tab;
        await renderSpareItemHistoryModal();
        showSpicsModal('spareItemHistoryModal');
    }

    function setSpareItemHistoryTab(tab) {
        _shTab = tab;
        renderSpareItemHistoryModal();
    }

    function closeSpareItemHistoryModal() {
        closeSpicsModal('spareItemHistoryModal');
    }

    async function spareHistOpenConsumeLog(logId) {
        if (!logId) return;
        closeSpareItemHistoryModal();
        if (window.TVC_App?.switchTab && getState().currentTab !== 'spare') {
            TVC_App.switchTab('spare');
        }
        await startConsumePreviewSession(logId);
    }

    async function spareHistOpenRequisition(reqId) {
        if (!reqId) return;
        closeSpareItemHistoryModal();
        if (window.TVC_App?.switchTab && getState().currentTab !== 'spare') {
            TVC_App.switchTab('spare');
        }
        await startReqWorkPreviewSession(reqId);
    }

    async function renderSpareItemHistoryModal() {
        const host = document.getElementById('spareItemHistoryBody');
        if (!host || !_shSpareId) return;
        const st = getState();
        const spare = (st.spares || []).map(canon).find(s => String(s.id) === String(_shSpareId));
        if (!spare) {
            host.innerHTML = '<p class="muted">Spare part not found.</p>';
            return;
        }
        host.innerHTML = '<p class="muted">Loading history…</p>';
        const { vesselId } = await vesselScope();
        const data = await loadSpareItemHistoryData(_shSpareId, vesselId);
        const consumedActive = _shTab === 'consumed' ? ' active' : '';
        const receivedActive = _shTab === 'received' ? ' active' : '';
        const reqActive = _shTab === 'requisition' ? ' active' : '';

        let tabContent = '';
        if (_shTab === 'consumed') {
            const rows = data.consumed.length ? data.consumed.map(c => {
                const dbl = c.openLog && c.logId
                    ? ` ondblclick="TVC_SpareMenu.spareHistOpenConsumeLog('${escAttr(c.logId)}')" title="Double-click to open Consumed Log"`
                    : '';
                const rowCls = c.openLog && c.logId ? ' wp-hist-row' : '';
                return `<tr class="${rowCls.trim()}"${dbl}>
                    <td>${esc(c.date || '—')}</td>
                    <td style="text-align:right">${c.qty ?? '—'}</td>
                    <td>${esc(c.pmsGroup)}</td>
                    <td>${esc(c.jobCode)}</td>
                    <td>${esc(c.madeBy)}</td>
                    <td>${esc(c.source)}</td>
                    <td>${esc(c.status)}</td>
                </tr>`;
            }).join('') : '<tr><td colspan="7" class="muted" style="text-align:center">No consumed history</td></tr>';
            tabContent = `
                <div class="wp-section">
                    <div class="wp-section-head">Consumed History <span class="muted wp-hist-hint">(double-click row to open Consumed Log)</span></div>
                    <div class="wp-table-wrap">
                        <table class="wp-table">
                            <thead><tr><th>Date</th><th>Qty</th><th>PMS Group</th><th>Job Code</th><th>By</th><th>Source</th><th>Status</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>`;
        } else if (_shTab === 'received') {
            const rows = data.received.length ? data.received.map(r => `<tr>
                    <td>${esc(r.date || '—')}</td>
                    <td style="text-align:right">${r.qty ?? '—'}</td>
                    <td style="text-align:right">${r.qtyAfter ?? '—'}</td>
                    <td>${esc(r.ref)}</td>
                    <td>${esc(r.operator)}</td>
                    <td>${esc(r.note || '—')}</td>
                </tr>`).join('') : '<tr><td colspan="6" class="muted" style="text-align:center">No received history</td></tr>';
            tabContent = `
                <div class="wp-section">
                    <div class="wp-section-head">Received History <span class="muted wp-hist-hint">(from stock delivery records)</span></div>
                    <div class="wp-table-wrap">
                        <table class="wp-table">
                            <thead><tr><th>Date</th><th>Qty</th><th>Stock After</th><th>Ref</th><th>Operator</th><th>Note</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>`;
        } else {
            const rows = data.requisitions.length ? data.requisitions.map(r => {
                const pri = r.priority === 'URGENT' ? ' <span class="pill warn">URGENT</span>' : '';
                return `<tr class="wp-hist-row" ondblclick="TVC_SpareMenu.spareHistOpenRequisition('${escAttr(r.reqId)}')" title="Double-click to open Requisition">
                    <td>${esc(r.date || '—')}</td>
                    <td>${esc(r.reqNo)}</td>
                    <td>${esc(r.status)}${pri}</td>
                    <td style="text-align:right">${r.qtyRequested ?? '—'}</td>
                    <td style="text-align:right">${r.qtyReceived ?? '—'}</td>
                    <td>${esc(r.deliverPort)}</td>
                </tr>`;
            }).join('') : '<tr><td colspan="6" class="muted" style="text-align:center">No requisition history</td></tr>';
            tabContent = `
                <div class="wp-section">
                    <div class="wp-section-head">Requisition History <span class="muted wp-hist-hint">(double-click row to open Requisition)</span></div>
                    <div class="wp-table-wrap">
                        <table class="wp-table">
                            <thead><tr><th>Date</th><th>Req No.</th><th>Status</th><th>Requested</th><th>Received</th><th>Port</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>`;
        }

        host.innerHTML = `
            <h3 class="wp-title">Spare History</h3>
            <div class="wp-job-head">
                <span><b>Code</b> ${esc(partNo(spare))}</span>
                <span><b>Item</b> ${esc(spare.name || '—')}</span>
                <span><b>Stock</b> ${spare.currentStock ?? 0}</span>
            </div>
            <p class="wp-job-detail">${esc(spare.universalItemCode || spare.universalCode || spare.working || '')}</p>
            <div class="wp-tabs">
                <button type="button" class="wp-tab${consumedActive}" onclick="TVC_SpareMenu.setSpareItemHistoryTab('consumed')">Consumed (${data.consumed.length})</button>
                <button type="button" class="wp-tab${receivedActive}" onclick="TVC_SpareMenu.setSpareItemHistoryTab('received')">Received (${data.received.length})</button>
                <button type="button" class="wp-tab${reqActive}" onclick="TVC_SpareMenu.setSpareItemHistoryTab('requisition')">Requisition (${data.requisitions.length})</button>
            </div>
            <div class="wp-tab-pane">${tabContent}</div>
            <div class="modal-actions">
                <button type="button" class="btn" onclick="TVC_SpareMenu.closeSpareItemHistoryModal()">Close</button>
            </div>`;
    }

    async function openHistoryModal() {
        const body = document.getElementById('spareHistoryBody');
        if (!body) return;
        const rows = await listSpareDataXferHistory(100);
        body.innerHTML = `
            <button class="modal-x" onclick="TVC_SpareMenu.closeHistoryModal()">×</button>
            <h3>Data Export / Import History</h3>
            <p class="muted spare-hist-sub">Spare module Export &amp; Import activity only.</p>
            <div class="spics-tx-lines-wrap"><table class="spics-tx-table spics-hist-table"><thead><tr>
                <th>Date</th><th>Direction</th><th>Type</th><th>Summary</th><th>File</th><th>Operator</th>
            </tr></thead><tbody>${rows.map(r => `<tr>
                <td>${esc(r.date || (r.at || '').slice(0, 16).replace('T', ' '))}</td>
                <td><span class="pill ${r.direction === 'EXPORT' ? 'ok' : 'warn'}">${esc(r.direction || '—')}</span></td>
                <td>${esc(spareXferCategoryLabel(r.category))}</td>
                <td>${esc(r.summary || '—')}</td>
                <td>${esc(r.file_name || '—')}</td>
                <td>${esc(r.operator_name || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center">No export/import history yet.</td></tr>'}
            </tbody></table></div>
            <div class="modal-actions"><button type="button" class="btn" onclick="TVC_SpareMenu.closeHistoryModal()">Close</button></div>`;
        showSpicsModal('spareHistoryModal');
    }

    function closeHistoryModal() { closeSpicsModal('spareHistoryModal'); }

    // ── Parts Requisition Sheet (CMAXS-SPICS style) ───────────────────
    function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

    function partCodeMain(partNo) {
        const p = String(partNo || '').trim();
        const i = p.indexOf('-');
        return i > 0 ? p.slice(0, i) : p;
    }

    function partCodeSub(partNo) {
        const parts = String(partNo || '').trim().split('-');
        return parts.length > 1 ? parts[parts.length - 1] : '';
    }

    async function vesselLabel(vesselId, dept) {
        const fleet = (window.TVC_Fleet && TVC_Fleet.getAll) ? await TVC_Fleet.getAll() : [];
        const v = fleet.find(x => x.id === vesselId);
        const d = dept ? ` (${dept.charAt(0) + dept.slice(1).toLowerCase()})` : '';
        return v ? `${v.name}${d}` : `${vesselId || 'Vessel'}${d}`;
    }

    async function ensureReqSheetDraft(user, vesselId) {
        const reqs = await TVC_Inventory.listRequisitions(vesselId);
        const draft = reqs.find(r => r.status === TVC_Inventory.REQ_STATUS.DRAFT);
        if (draft) return draft;
        try {
            return await TVC_Inventory.createRequisition(user, { vesselId, department: user?.department });
        } catch (e) {
            if (e.code !== 'EMPTY') throw e;
        }
        const today = new Date().toISOString().slice(0, 10);
        const req = {
            id: 'REQ-' + Date.now(),
            schema_version: 1,
            req_no: await TVC_Inventory.nextReqNo(vesselId),
            vessel_id: vesselId,
            department: user?.department || 'ENGINE',
            status: TVC_Inventory.REQ_STATUS.DRAFT,
            created_at: new Date().toISOString(),
            created_by: user?.id || null,
            creator_name: '',
            lines: [],
            code_no: '',
            remarks: '',
            priority: 'ROUTINE',
            dock_use: false,
            deliver_date_from: today,
            deliver_date_to: today,
            deliver_port: '',
            made_on: '',
            made_by: '',
            assessed_on: '',
            assessed_by: '',
        };
        await TVC_Inventory.saveRequisition(req);
        return req;
    }

    async function openReqSheetModal() {
        const { st, vesselId } = await vesselScope();
        if (window.TVC_RBAC && !TVC_RBAC.can(st.user, TVC_RBAC.Action.CREATE_REQUISITION)) {
            alert('No permission to create requisitions.'); return;
        }
        try {
            const req = _reqSheet.reqId
                ? await TVC_Inventory.getRequisition(_reqSheet.reqId)
                : await ensureReqSheetDraft(st.user, vesselId);
            if (!req) throw new Error('REQ_NOT_FOUND');
            _reqSheet.reqId = req.id;
            if (!_reqSheet.step) _reqSheet.step = 3;
            await renderReqSheetModal();
            showSpicsModal('spareReqSheetModal');
        } catch (e) { alert(e.message || e.code || 'Cannot open requisition.'); }
    }

    function closeReqSheetModal() {
        closeSpicsModal('spareReqSheetModal');
        _reqSheet.partSearch = '';
    }

    function captureReqSheetForm() {
        const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        _reqSheet.form = {
            code_no: g('reqCodeNo'),
            remarks: g('reqRemarks'),
            deliver_date_from: g('reqDelFrom'),
            deliver_date_to: g('reqDelTo'),
            deliver_port: g('reqDelPort'),
            made_on: g('reqMadeOn'),
            assessed_on: g('reqAssessedOn'),
            assessed_by: g('reqAssessedBy'),
        };
        reqApplyTypeKind(_reqSheet.form, document.querySelector('input[name="reqPriority"]:checked')?.value || 'ROUTINE');
        _reqSheet.form.made_by = resolveSpareReportedBy(
            { made_by: _reqSheet.preservedMadeBy || '' },
            spareInventoryUser(getState())
        );
        document.querySelectorAll('[data-req-line][data-req-field="order"]').forEach(el => {
            const idx = Number(el.dataset.reqLine);
            if (!Number.isNaN(idx)) _reqSheet.lineOrders = _reqSheet.lineOrders || {}, _reqSheet.lineOrders[idx] = Number(el.value) || 0;
        });
    }

    async function saveReqSheetModal() {
        captureReqSheetForm();
        const req = await TVC_Inventory.getRequisition(_reqSheet.reqId);
        if (!req) return;
        const f = _reqSheet.form || {};
        Object.assign(req, f);
        _reqSheet.preservedMadeBy = req.made_by || '';
        (req.lines || []).forEach((l, i) => {
            if (_reqSheet.lineOrders && _reqSheet.lineOrders[i] != null) l.qty_requested = _reqSheet.lineOrders[i];
        });
        await TVC_Inventory.saveRequisition(req);
        await syncReportedWaitAndRefreshList();
        alert('Requisition saved.');
        await renderReqSheetModal();
        render();
    }

    async function reqSheetSelectReq(reqId) {
        if (reqId === '__new__') { await reqSheetNew(); return; }
        captureReqSheetForm();
        const cur = await TVC_Inventory.getRequisition(_reqSheet.reqId);
        if (cur && _reqSheet.form) {
            Object.assign(cur, _reqSheet.form);
            if (_reqSheet.lineOrders) {
                (cur.lines || []).forEach((l, i) => {
                    if (_reqSheet.lineOrders[i] != null) l.qty_requested = _reqSheet.lineOrders[i];
                });
            }
            await TVC_Inventory.saveRequisition(cur);
        }
        _reqSheet.reqId = reqId;
        _reqSheet.selectedLineIdx = 0;
        _reqSheet.lineOrders = null;
        await renderReqSheetModal();
    }

    async function buildBlankRequisitionDraft() {
        const { st, vesselId } = await vesselScope();
        return {
            id: 'REQ-' + Date.now(),
            schema_version: 1,
            req_no: '',
            vessel_id: vesselId,
            department: st.user?.department || 'ENGINE',
            status: TVC_Inventory.REQ_STATUS.DRAFT,
            created_at: new Date().toISOString(),
            created_by: st.user?.id || null,
            creator_name: '',
            lines: [],
            code_no: '', remarks: '', priority: 'ROUTINE', dock_use: false,
            deliver_date_from: '', deliver_date_to: '', deliver_port: '',
            made_on: '', made_by: '',
            assessed_on: '', assessed_by: '',
            list_status: SPARE_LIST_STATUS.DRAFT,
            confirmed_by: '', confirmed_at: '',
            approved_by: '', approved_at: '',
        };
    }

    async function ensureReqWorkDraft(forceNew = false) {
        if (!forceNew && _reqWorkDraft) return _reqWorkDraft;
        _reqWorkDraft = await buildBlankRequisitionDraft();
        _reqSheet.reqId = null;
        _reqSheet.step = 1;
        return _reqWorkDraft;
    }

    async function createBlankRequisitionDraft() {
        const req = await buildBlankRequisitionDraft();
        await TVC_Inventory.saveRequisition(req);
        _reqSheet.reqId = req.id;
        _reqSheet.step = 1;
        return req;
    }

    async function reqSheetNew() {
        captureReqSheetForm();
        await createBlankRequisitionDraft();
        await renderReqSheetModal();
    }

    async function reqSheetFillLowStock() {
        const { st, vesselId } = await vesselScope();
        captureReqSheetForm();
        let req = await TVC_Inventory.getRequisition(_reqSheet.reqId);
        if (!req) return;
        const low = (st.spares || []).map(canon).filter(s => TVC_Inventory.isLowStock(s));
        const existing = new Set((req.lines || []).map(l => l.spare_part_id));
        low.forEach(s => {
            if (existing.has(s.id)) return;
            const raw = (st.spares || []).find(x => x.id === s.id);
            const qty = TVC_Inventory.recommendedOrderQty(s) || 1;
            req.lines.push(buildReqLine(raw || s, qty));
        });
        Object.assign(req, _reqSheet.form || {});
        await TVC_Inventory.saveRequisition(req);
        _reqSheet.step = 2;
        await renderReqSheetModal();
    }

    function buildReqLine(spare, qty) {
        const c = canon(spare);
        const q = (qty === 0 || qty === '0')
            ? 0
            : (Number(qty) || TVC_Inventory.recommendedOrderQty(c) || 1);
        return {
            spare_part_id: c.id || spare.id,
            part_no: partNo(c) || spare.part_no || '',
            universal_code: c.universalItemCode || spare.universal_code || '',
            name: c.name || spare.name || '',
            unit: spare.unit || 'EA',
            maker: spare.maker || '',
            model: spare.model || '',
            qty_on_hand: TVC_Inventory.currentStock(spare),
            standard_stock: TVC_Inventory.standardStock(c),
            qty_required: q,
            qty_requested: q,
            on_order: reportedWaitQty(c),
            price: spare.price != null ? spare.price : null,
            currency: spare.currency || 'USD',
            vendor_comment: '',
            hq_comment: '',
            equipment: c.location || spare.location || '',
            is_critical: !!c.isCritical,
        };
    }

    function reqSheetSearchHits() {
        const q = (_reqSheet.partSearch || '').trim().toLowerCase();
        if (!q) return [];
        return (getState().spares || []).map(canon).filter(s => {
            const hay = [partNo(s), s.name, s.universalItemCode, s.universal_code, s.location].join(' ').toLowerCase();
            return hay.includes(q);
        }).slice(0, 20);
    }

    function buildReqSheetHitsHtml() {
        const hits = reqSheetSearchHits();
        const q = (_reqSheet.partSearch || '').trim();
        if (!q) return '';
        if (!hits.length) return '<p class="muted req-sheet-empty">No search results</p>';
        return `<div class="req-sheet-hits"><table class="req-sheet-table req-sheet-hits-table"><thead><tr>
            <th>Part No</th><th>Universal Code</th><th>Description</th><th>Stock</th><th></th>
        </tr></thead><tbody>${hits.map(s => `<tr class="req-hit-row" onclick="TVC_SpareMenu.reqSheetAddSpare('${escAttr(s.id)}')">
            <td><strong>${esc(partNo(s))}</strong></td>
            <td>${esc(s.universalItemCode || s.universal_code || '—')}</td>
            <td>${esc(s.name)}</td>
            <td style="text-align:center">${TVC_Inventory.currentStock(s)}</td>
            <td><span class="pill ok">+ Add</span></td>
        </tr>`).join('')}</tbody></table></div>`;
    }

    function onReqSheetSearchInput(v) {
        _reqSheet.partSearch = v;
        clearTimeout(_reqSheetSearchT);
        _reqSheetSearchT = setTimeout(() => {
            const wrap = document.getElementById('reqSheetHitsWrap');
            if (wrap) wrap.innerHTML = buildReqSheetHitsHtml();
        }, 120);
    }

    async function reqSheetAddSpare(spareId) {
        captureReqSheetForm();
        const req = await TVC_Inventory.getRequisition(_reqSheet.reqId);
        if (!req) return;
        if ((req.lines || []).some(l => l.spare_part_id === spareId)) { alert('Part already added.'); return; }
        const spare = (getState().spares || []).find(s => s.id === spareId);
        if (!spare) return;
        req.lines = req.lines || [];
        req.lines.push(buildReqLine(spare, TVC_Inventory.recommendedOrderQty(canon(spare)) || 1));
        Object.assign(req, _reqSheet.form || {});
        await TVC_Inventory.saveRequisition(req);
        _reqSheet.partSearch = '';
        _reqSheet.step = 2;
        await renderReqSheetModal();
    }

    async function reqSheetRemoveLine(idx) {
        captureReqSheetForm();
        const req = await TVC_Inventory.getRequisition(_reqSheet.reqId);
        if (!req || !req.lines) return;
        req.lines.splice(idx, 1);
        Object.assign(req, _reqSheet.form || {});
        await TVC_Inventory.saveRequisition(req);
        _reqSheet.selectedLineIdx = Math.max(0, idx - 1);
        await renderReqSheetModal();
    }

    function reqSheetSelectLine(idx) {
        _reqSheet.selectedLineIdx = idx;
        document.querySelectorAll('.req-line-row').forEach((r, i) => r.classList.toggle('selected', i === idx));
    }

    function reqSheetSetStep(n) {
        _reqSheet.step = n;
        document.querySelectorAll('.req-flow-step').forEach(el => {
            el.classList.toggle('active', Number(el.dataset.step) === n);
        });
    }

    async function reqSheetComplete() {
        await saveReqSheetModal();
        _reqSheet.step = 4;
        await renderReqSheetModal();
    }

    async function reqSheetExport() {
        await saveReqSheetModal();
        try {
            await exportReq(_reqSheet.reqId);
        } catch (e) { alert(e.message || e.code); }
    }

    function reqSheetPrint() {
        const area = document.getElementById('reqSheetPrintArea');
        if (!area) { window.print(); return; }
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) { window.print(); return; }
        w.document.write(`<!DOCTYPE html><html><head><title>Parts Requisition</title>
            <style>body{font-family:Segoe UI,Arial,sans-serif;font-size:12px;padding:16px}
            table{width:100%;border-collapse:collapse} th,td{border:1px solid #999;padding:4px 6px}
            th{background:#ddd} h2{text-align:center;color:#003366}</style></head><body>${area.innerHTML}</body></html>`);
        w.document.close();
        w.focus();
        w.print();
    }

    async function renderReqSheetModal() {
        const host = document.getElementById('spareReqSheetBody');
        if (!host) return;
        const { st, vesselId, isHq } = await vesselScope();
        const req = await TVC_Inventory.getRequisition(_reqSheet.reqId);
        if (!req) { host.innerHTML = '<p class="muted">Requisition not found.</p>'; return; }
        _reqSheet.preservedMadeBy = req.made_by || '';
        const reportedByVal = resolveSpareReportedBy(req, spareInventoryUser(st));
        const reqs = await TVC_Inventory.listRequisitions(vesselId);
        const vesselName = await vesselLabel(vesselId, req.department || st.user?.department);
        const today = new Date().toISOString().slice(0, 10);
        const step = _reqSheet.step || 3;
        const selIdx = _reqSheet.selectedLineIdx || 0;

        const reqOptions = reqs.map(r =>
            `<option value="${escAttr(r.id)}"${r.id === req.id ? ' selected' : ''}>${esc(r.req_no)} (${esc(r.status)})</option>`
        ).join('');

        const lines = req.lines || [];
        const lineRows = lines.length ? lines.map((l, i) => {
            const spare = (st.spares || []).find(s => s.id === l.spare_part_id);
            const c = spare ? canon(spare) : null;
            const crit = (l.is_critical || c?.isCritical) ? '<span class="req-crit" title="Critical">*</span>' : '';
            const std = l.standard_stock ?? TVC_Inventory.standardStock(c || l);
            const rob = l.qty_on_hand ?? (spare ? TVC_Inventory.currentStock(spare) : 0);
            const pipe = c ? sparePipelineCols(c) : null;
            const awaiting = l.on_order ?? (pipe?.awaiting ?? 0);
            const needVal = l.qty_required ?? (pipe?.need != null ? pipe.need : Math.max(0, (Number(std) || 0) - rob - awaiting));
            const needDisplay = needVal == null ? '—' : needVal;
            const selected = i === selIdx ? ' selected' : '';
            return `<tr class="req-line-row${selected}" onclick="TVC_SpareMenu.reqSheetSelectLine(${i})">
                <td class="req-col-icon">${crit}</td>
                <td>${esc(partCodeMain(l.part_no))}</td>
                <td>${esc(partCodeSub(l.part_no))}</td>
                <td>${esc(l.equipment || c?.location || '—')}</td>
                <td class="req-col-parts">${esc(l.name)}</td>
                <td class="req-col-icon">${crit}</td>
                <td style="text-align:center">${std}</td>
                <td style="text-align:center">${rob}</td>
                <td style="text-align:center">${awaiting}</td>
                <td style="text-align:center">${needDisplay}</td>
                <td style="text-align:center"><input type="number" min="0" step="1" class="req-order-qty"
                    data-req-line="${i}" data-req-field="order" value="${l.qty_requested ?? (needVal ?? '')}"
                    onclick="event.stopPropagation()"></td>
                <td><button type="button" class="btn btn-sm btn-red" onclick="event.stopPropagation();TVC_SpareMenu.reqSheetRemoveLine(${i})">×</button></td>
            </tr>`;
        }).join('') : `<tr><td colspan="12" class="muted" style="text-align:center;padding:20px">
            No requisition lines — add via search below or <a href="#" onclick="TVC_SpareMenu.reqSheetFillLowStock();return false">Add low stock automatically</a>
        </td></tr>`;

        const flowStep = (n, label) =>
            `<span class="req-flow-step${step === n ? ' active' : ''}" data-step="${n}" onclick="TVC_SpareMenu.reqSheetSetStep(${n})">${label}</span>`;

        const reqType = reqListTypeKind(req);
        host.innerHTML = `
        <div class="req-sheet" id="reqSheetPrintArea">
            <div class="req-sheet-titlebar">
                <button type="button" class="modal-x req-sheet-close" onclick="TVC_SpareMenu.closeReqSheetModal()">×</button>
                <span class="req-vessel-name">${esc(vesselName)}</span>
                <span class="req-sheet-title">- Parts Requisition -</span>
                <span class="req-sheet-toolbar">
                    <button type="button" class="req-tool-btn" onclick="TVC_SpareMenu.reqSheetPrint()">Print</button>
                    <button type="button" class="req-tool-btn" onclick="TVC_SpareMenu.reqSheetPrint()">Preview</button>
                    <button type="button" class="req-tool-btn" onclick="TVC_SpareMenu.closeReqSheetModal()">Menu</button>
                </span>
            </div>
            <div class="req-sheet-form">
                <div class="req-form-row">
                    <label>Code No.<select id="reqCodeNo">
                        <option value=""${!req.code_no ? ' selected' : ''}>—</option>
                        <option value="ENGINE"${req.code_no === 'ENGINE' ? ' selected' : ''}>ENGINE</option>
                        <option value="DECK"${req.code_no === 'DECK' ? ' selected' : ''}>DECK</option>
                        <option value="ELECT"${req.code_no === 'ELECT' ? ' selected' : ''}>ELECT</option>
                    </select></label>
                    <label>Requisition No.<select id="reqSelectNo" onchange="TVC_SpareMenu.reqSheetSelectReq(this.value)">
                        <option value="__new__">New Requisition</option>${reqOptions}
                    </select></label>
                    <label class="req-reqno-display">No. <strong>${esc(req.req_no)}</strong></label>
                </div>
                <div class="req-form-row req-form-remarks">
                    <label>Remarks<textarea id="reqRemarks" rows="3">${esc(req.remarks || '')}</textarea></label>
                </div>
                <div class="req-form-row req-form-mid">
                    <div class="req-priority">
                        <label><input type="radio" name="reqPriority" value="URGENT"${reqType === 'URGENT' ? ' checked' : ''}> Urgent</label>
                        <label><input type="radio" name="reqPriority" value="ROUTINE"${reqType === 'ROUTINE' ? ' checked' : ''}> Routine</label>
                        <label><input type="radio" name="reqPriority" value="DOCK"${reqType === 'DOCK' ? ' checked' : ''}> Dock Use</label>
                    </div>
                    <label>Delivered Date
                        <span class="req-date-range">
                            <input type="text" id="reqDelFrom" class="tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(req.deliver_date_from || today))}">
                            <span>~</span>
                            <input type="text" id="reqDelTo" class="tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(req.deliver_date_to || today))}">
                        </span>
                    </label>
                    <label>Delivered Port<input type="text" id="reqDelPort" value="${esc(req.deliver_port || '')}"></label>
                </div>
                <div class="req-form-row req-form-track">
                    <label>Requested Date<input type="text" id="reqMadeOn" class="tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(req.made_on || ''))}"></label>
                    <label>by<input type="text" id="reqMadeBy" class="wr-ro" value="${esc(reportedByVal)}" readonly disabled tabindex="-1"></label>
                    <label>Evaluated Date<input type="text" id="reqAssessedOn" class="tvc-date-input" placeholder="YYYY-MM-DD" autocomplete="off" value="${esc(fmtSpareDate(req.assessed_on || ''))}"></label>
                    <label>by<input type="text" id="reqAssessedBy" value="${esc(req.assessed_by || '')}"></label>
                </div>
            </div>
            <div class="req-flow-bar">
                ${flowStep(1, 'Select Requisition No.')}
                <span class="req-flow-arrow">⇒</span>
                ${flowStep(2, 'Select REQD Parts')}
                <span class="req-flow-arrow">⇒</span>
                ${flowStep(3, 'Input Order Qty.')}
                <span class="req-flow-arrow">⇒</span>
                ${flowStep(4, 'Complete')}
            </div>
            <div class="req-sheet-add">
                <label class="req-add-label">Search REQD Parts (Part No / Name / Universal Code)</label>
                <input type="search" id="reqSheetSearch" class="req-sheet-search" placeholder="e.g. gasket, 01-001, U_ENG_001"
                    value="${esc(_reqSheet.partSearch || '')}" oninput="TVC_SpareMenu.onReqSheetSearchInput(this.value)">
                <div id="reqSheetHitsWrap">${buildReqSheetHitsHtml()}</div>
                <div class="req-sheet-add-actions">
                    <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.reqSheetFillLowStock()">Add low stock automatically</button>
                    <button type="button" class="btn btn-sm" onclick="TVC_SpareMenu.reqSheetNew()">+ New Requisition</button>
                </div>
            </div>
            <div class="req-table-scroll">
                <table class="req-sheet-table req-sheet-parts">
                    <thead><tr>
                        <th></th><th>Code</th><th></th><th>Equipment</th><th>Parts</th><th></th>
                        <th title="${SPARE_COL_STD_TITLE}">${SPARE_COL_STD}</th><th title="${SPARE_COL_ROB_TITLE}">${SPARE_COL_ROB}</th><th title="${SPARE_COL_WAIT_TITLE}">${SPARE_COL_WAIT}</th><th title="${SPARE_COL_NEED_TITLE}">${SPARE_COL_NEED}</th><th>Order</th><th></th>
                    </tr></thead>
                    <tbody>${lineRows}</tbody>
                </table>
            </div>
            <div class="req-sheet-actions">
                <button type="button" class="btn btn-green" onclick="TVC_SpareMenu.saveReqSheetModal()">💾 Save</button>
                <button type="button" class="btn" onclick="TVC_SpareMenu.reqSheetExport()">⬇ Data Export</button>
                <button type="button" class="btn btn-green" onclick="TVC_SpareMenu.reqSheetComplete()">✓ Complete</button>
                <button type="button" class="btn" onclick="TVC_SpareMenu.closeReqSheetModal()">Close</button>
            </div>
        </div>`;

        const sel = document.getElementById('reqSelectNo');
        if (sel) sel.value = req.id;
    }

    function exportRequisitionData() {
        viewRequisitionList();
    }
    function resolveWrJobHeader(st, job) {
        if (!job) {
            return { pmsGroupNo: '', maker: '', modelType: '', capacity: '', serialNo: '' };
        }
        const prevKey = st.selectedGroupKey;
        const gk = `${job.department || ''}|${String(job.group || '').trim()}`;
        return resolveGroupHeaderByKey(st, gk, job.group || '', prevKey);
    }

    function resolveGroupHeaderByKey(st, groupKey, groupLabel, restoreKey) {
        const prevKey = restoreKey !== undefined ? restoreKey : st.selectedGroupKey;
        st.selectedGroupKey = groupKey || null;
        const h = resolveSpareHeaderFromGroup(st);
        st.selectedGroupKey = prevKey;
        const label = groupLabel
            ? safeTreeLabel(groupLabel)
            : (groupKey ? safeTreeLabel(groupFilterLabel(st)) : '');
        return {
            pmsGroupNo: label || h.pmsGroupNo || '',
            maker: h.maker || '',
            modelType: h.modelType || '',
            capacity: h.capacity || '',
            serialNo: h.serialNo || '',
        };
    }

    function getPlanGroupPickNodes(st) {
        return planGroupNodes(st);
    }

    function getJobsForGroupKey(st, groupKey) {
        return consumeJobsForGroup(st, groupKey);
    }

    async function exportDeliveryData() {
        const st = getState();
        if (!canCreateDeliver(st)) return alert('No permission to export received data.');
        const { vesselId, isHq } = await vesselScope();
        const reqs = (await TVC_Inventory.listRequisitions(vesselId))
            .filter(r => reqWorkflowPhase(r) === REQ_LIST_PHASE.RECEIVED || !!reqListReceivedDate(r));
        if (!reqs.length) return alert('No received requisitions to export.');
        if (!window.confirm(`Export ${reqs.length} received requisition(s) to Master?`)) return;
        try {
            let ok = 0;
            for (const req of reqs) {
                await TVC_Excel.exportRequisition(req, { vendorOnly: !isHq });
                ok++;
            }
            alert(`Exported ${ok} received requisition(s) to Master.`);
        } catch (e) { alert(e.message || e.code); }
    }

    return {
        init, render, renderSpareGroupTree, refreshList, syncSpareToolbarUi, spareToolbarFlags, applySpareToolbarFlags,
        setFilter, setSearch, clearSpareSearch, clearListFilters, toggleLowOnly, showLowStockOnly, setSpareFilter, toggleReqPanel,
        selectSpareRow, focusSpareRow, openSpareModify, openSpareAppend, deleteSpareItem, deleteSpareItems,
        openDetail, closeDetail, saveDetailGroup,
        createRequisition, assignToTask, suggestRequisition,
        append, startInlineAppend, edit, cancelEdit, cancelInlineEdit, saveEdit, saveInlineEdit, startInlineEdit, pickEditGroup, toggleEditGroupPick, pickSpareClass, toggleSpareClassPick,
        startGroupHeaderEdit, appendGroupFromTree, deleteGroupFromTree, saveGroupHeaderEdit, cancelGroupHeaderEdit, savePlanCriticalEquipment,
        loadBundledXls, loadSpareInventory, ensureInventoryLoaded,
        openConsumeModal, openDeliverModal, closeReceiveModal, saveReceive, confirmSaveReceive, dismissReceiveSaveConfirm, closeTxModal, saveTx, closeConsumeModal, saveConsume, captureConsumeMeta,
        receiveSelectGroup, receiveSetTreeSearch, receiveToggleGroupTree, receiveSetSearch, receiveToggleSelectedOnly,
        receiveFocusRow, receiveToggleRow, receiveToggleAll, receiveSetQty, captureReceiveMeta, receiveSelectRequisition,
        syncConsumeLogFromWorkReport, syncConsumeLogFromDefectReport, reverseConsumeLogStockForLog, reloadSparesCache,
        toggleConsumeGroupPick, consumeGroupPickSearch, pickConsumeMetaGroup,
        toggleConsumeJobPick, consumeJobPickSearch, pickConsumeMetaJob, addConsumeJobRow, removeConsumeJobRow,
        consumeSelectGroup, consumeSetTreeSearch, consumeToggleGroupTree, consumeSetSearch, consumeToggleLowOnly,
        consumeToggleSelectedOnly, consumeFocusRow, consumeToggleRow, consumeToggleAll, consumeSetQty,
        renderSpareGroupHeaderHtml, renderPlanGroupHeaderHtml,
        renderWrSparePage2Html, initWrSparePage2, teardownWrSparePage2, resolveWrJobHeader,
        capturePage2JobItems, addPage2JobRow, removePage2JobRow, togglePage2JobPick, pickPage2Job,
        page2JobPickSearch, buildPage2JobItemsFromJobs, newConsumeJobRow, jobRowFromMaintenanceJob,
        resolveGroupHeaderByKey, getPlanGroupPickNodes, getJobsForGroupKey, findJobByCode, safeTreeLabel,
        isGroupCriticalEquipmentYes,
        CRITICAL_GROUP_KEY,
        MERGED_GEN_ENGINE_KEY,
        wrSpareSelectGroup, wrSpareSetTreeSearch, wrSpareSetSearch, wrSpareToggleLowOnly,
        wrSpareToggleGroupTree, wrSpareToggleSelectedOnly, wrSpareFocusRow, wrSpareToggleRow, wrSpareToggleAll, wrSpareSetQty,
        refreshWrSpareJobContext,
        onTxSearchInput, addTxLine, removeTxLine,
        openHqImportModal, onHqImportFile, openAssessmentModal, closeAssessmentModal, applyHqAssessment,
        openSpareSyncMenu, closeSpareSyncMenu, spareXferPickMode, spareXferBack, spareXferTriggerImport,
        spareXferOpenReqExportList, spareXferOpenReceivedExportList, spareXferExportRequisitions, spareXferExportReceived, spareXferExportInventory,
        reqListXferExportBack,
        openHistoryModal, closeHistoryModal,
        openSpareItemHistory, openSpareItemHistoryForFocus, closeSpareItemHistoryModal, setSpareItemHistoryTab,
        spareHistOpenConsumeLog, spareHistOpenRequisition,
        openReqListModal, closeReqListModal, reqListNew, reqListModify, reqListDelete,
        reqListPreview, reqListDetailReport, reqListReportConfirm, reqListExportToMaster, reqListDocPreview, reqListPrint,
        openCloseOsModal, closeCloseOsModal, saveCloseOsWaive,
        reqListSelectRow, reqListToggleRow, reqListToggleAll, reqListPickRow, reqListPickToggleRow,
        reqListSetPeriod, reqListClearPeriod, reqListSetSearch, reqListClearSearch, reqListSetPhase,
        openReqSheetModal, closeReqSheetModal, saveReqSheetModal,
        reqSheetSelectReq, reqSheetNew, reqSheetFillLowStock, reqSheetAddSpare,
        reqSheetRemoveLine, reqSheetSelectLine, reqSheetSetStep, reqSheetComplete,
        reqSheetExport, reqSheetPrint, onReqSheetSearchInput,
        exportRequisitionData, exportDeliveryData, exportPartsList, exportPartsListXlsx, buildPrintBody,
        viewRequisitionList, openNewRequisition,
        hqRequestQuotation, hqCheckQuotation, hqReplyCompanyAssessment, hqPurchaseOrder, hqReviewReceivedParts,
        viewConsumedLog, openConsumeLogModal, closeConsumeLogModal,
        consumeLogNew, consumeLogModify, consumePreviewModify, consumePreviewOpenWorkReport, cleanupConsumeWorkReportOverlay,
        consumeLogDelete, consumeLogPreview, consumeLogDetailReport, consumeLogReportConfirm, consumeLogDocPreview, consumeLogPrint,
        consumeLogPrintPreview, consumeLogOpenList,
        consumeLogSelectRow, consumeLogToggleRow, consumeLogToggleAll,
        consumeLogSetPeriod, consumeLogClearPeriod, consumeLogSetSearch, consumeLogClearSearch,
        closeReqWorkModal, reqWorkComplete, reqWorkSave, reqWorkSwitchToNew, reqWorkEnterListEdit, reqWorkOpenList, reqWorkPrint, reqWorkDocPreview, reqWorkDocPreviewPrint, reqWorkExitDocPreview, reqWorkPrintPreview, reqWorkAddSpare, addToRequisition, reqWorkAddChecked, captureReqWorkMeta,
        toggleReqWorkHistList, reqWorkPickReqNo,
        reqWorkSetRequestQty, reqWorkSetReceivedQty,
        reqWorkSelectGroup, reqWorkSetTreeSearch, reqWorkToggleGroupTree, reqWorkSetSearch, reqWorkToggleLowOnly,
        reqWorkToggleSelectedOnly,
        reqWorkFocusRow, reqWorkToggleRow, reqWorkToggleAll, toggleSpareAll,
        spareConfirmedByToggle,
        triggerInventoryImport, triggerCsvUpload, triggerImport, openReq, exportReq,
    };
})();

/** @deprecated alias — unified SPARE module */
const TVC_Spare = TVC_SpareMenu;
