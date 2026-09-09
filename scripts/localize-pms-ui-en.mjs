#!/usr/bin/env node
/**
 * One-time: translate user-facing Korean UI strings to English in TVC-PMS.
 * Run: node scripts/localize-pms-ui-en.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** @type {Record<string, [string, string][]>} */
const FILE_REPLACEMENTS = {
    'index.html': [
        ['해당 선사 선박만 · Department 불필요', 'company vessels only · Department not required'],
        ['선사 전체 조회', 'all company vessels'],
        ['Department 불필요', 'Department not required'],
        ["TVC_App.askAiHelp('부품 소모 입력법')\">부품 소모 입력법", "TVC_App.askAiHelp('How to log spare consumption')\">Spare consumption"],
        ["TVC_App.askAiHelp('작업 지시 승인 방법')\">작업 지시 승인 방법", "TVC_App.askAiHelp('How to approve work reports')\">Approve work reports"],
        ["TVC_App.askAiHelp('달력/기간 설정')\">달력/기간 설정", "TVC_App.askAiHelp('Period / date filter')\">Period / date filter"],
        ['placeholder="예: Period 필터 사용법"', 'placeholder="e.g. How to use Period filter"'],
        ['placeholder="짧은 제목"', 'placeholder="Short title"'],
        ['placeholder="어떤 점이 어색하거나 개선이 필요한가요?"', 'placeholder="What feels awkward or needs improvement?"'],
    ],
    'js/rbac.js': [
        ["SHIP_OFFICER: '사관 (Officer)'", "SHIP_OFFICER: 'Officer'"],
        ["SHIP_CAPTAIN: '선장 (Captain)'", "SHIP_CAPTAIN: 'Captain'"],
        ["SHIP_CHIEF: '기관장 (Chief Engineer)'", "SHIP_CHIEF: 'Chief Engineer'"],
        ["HQ_SUPERVISOR: '본사 공무감독 (HQ)'", "HQ_SUPERVISOR: 'HQ Superintendent'"],
    ],
    'js/auth.js': [
        ["display_name: 'Choi Captain (선장)'", "display_name: 'Choi Captain'"],
        ["display_name: 'Lee Superintendent (본사)'", "display_name: 'Lee Superintendent'"],
    ],
    'js/ui/storeMenu.js': [
        ['청구 수량 (Requisition Qty)', 'Requisition Qty'],
        ['도판 로딩 중…', 'Loading drawing plate…'],
        ['도판 다운로드 대기', 'Drawing plate download pending'],
        ['도판을 불러올 수 없음', 'Cannot load drawing plate'],
        ['오프라인 상태입니다. 네트워크 연결 후 다시 열어 주세요.', 'You are offline. Reconnect and try again.'],
        ['도판 파일이 아직 캐시되지 않았습니다.', 'Drawing plate is not cached yet.'],
    ],
    'js/ui/spareMenu.js': [
        ["showImportLoading('XLS 없음 — ENGINE CSV (loadSpareInventory)…')", "showImportLoading('No XLS — ENGINE CSV (loadSpareInventory)…')"],
    ],
    'js/services/vesselProfileSync.js': [
        ["label: '표시명'", "label: 'Display name'"],
    ],
    'js/services/adminPrint.js': [
        ["contract.fee_note || '별첨 견적 참조'", "contract.fee_note || 'See attached quotation'"],
    ],
    'js/services/excel.js': [
        ["ws.getCell('A3').value = '업체: [Unit Price], [Currency], [Vendor Comment] 셀만 입력 가능합니다. (나머지 셀은 보호됨)'",
            "ws.getCell('A3').value = 'Vendor: enter [Unit Price], [Currency], and [Vendor Comment] only. (Other cells are protected)'"],
    ],
    'js/services/transaction.js': [
        [": 'LAST DONE/NEXT DATE 갱신'", ": 'LAST DONE/NEXT DATE updated'"],
        ["? 'NEXT DATE 반영'", "? 'NEXT DATE applied'"],
        ["? 'LAST DONE/NEXT DATE 반영'", "? 'LAST DONE/NEXT DATE applied'"],
        ['— LAST DONE/NEXT DATE 원복 —', '— LAST DONE/NEXT DATE reverted —'],
        ['— 재고복원 · LAST DONE/NEXT DATE 원복 ·', '— stock restored · LAST DONE/NEXT DATE reverted ·'],
        ["scheduleNote : '재고차감 · ' + scheduleNote", "scheduleNote : 'stock deducted · ' + scheduleNote"],
    ],
    'js/core/schema.js': [
        ["errors.push('Part No (Maker Part No)는 필수입니다.')", "errors.push('Part No (Maker Part No) is required.')"],
        ["errors.push('Part No는 64자 이하여야 합니다.')", "errors.push('Part No must be 64 characters or fewer.')"],
        ["errors.push('Part No는 영문·숫자·._-/ 만 사용 가능합니다.')", "errors.push('Part No may only use letters, digits, and . _ - /')"],
        ["errors.push('Description (Name)은 필수입니다.')", "errors.push('Description (Name) is required.')"],
        ["errors.push('Description은 200자 이하여야 합니다.')", "errors.push('Description must be 200 characters or fewer.')"],
        ["errors.push('UniversalItemCode는 필수입니다.')", "errors.push('UniversalItemCode is required.')"],
        ["errors.push('UniversalItemCode 형식: UNI-XXXXXX 또는 U_ENG_001')", "errors.push('UniversalItemCode format: UNI-XXXXXX or U_ENG_001')"],
        ['errors.push(`${k}는 0 이상의 정수여야 합니다.`)', 'errors.push(`${k} must be an integer ≥ 0.`)'],
        ["errors.push('Price는 0 이상의 숫자여야 합니다.')", "errors.push('Price must be a number ≥ 0.')"],
        ["'index.html을 더블클릭(file://)으로 열면 재고 파일 자동 로드가 차단됩니다. ' +\n        'Electron 설치본, START-TVC-PMS.bat, 또는 npm start → http://localhost:3000 으로 실행하세요.'",
            "'Opening index.html via file:// blocks automatic inventory loading. ' +\n        'Use the Electron app, START-TVC-PMS.bat, or npm start → http://localhost:3000.'"],
    ],
};

/** Shared replacements applied to multiple files */
const SHARED_REPLACEMENTS = [
    ['HQ Fleet에서 선박을 선택한 뒤 다시 Export하세요.', 'Select a vessel in HQ Fleet, then Export again.'],
    ['Deck / Engine 구역 모니터링', 'Deck / Engine zone monitoring'],
    ['범용 App Update', 'Universal App Update'],
    ['기존 pool · 프로그램만 교체 (MR/License 불필요)', 'Existing pool · program-only replace (no MR/License)'],
    ['기존 pool · 프로그램만 교체 · MR/License 불필요', 'Existing pool · program-only replace · no MR/License'],
    ['범용 Setup · 선사용 App Update', 'Universal Setup · Company App Update'],
    ['신규 선사·선박 → Setup · 선박 추가 → Company App Update + HQ license', 'New company/vessel → Setup · add vessel → Company App Update + HQ license'],
    ['registry files 유지', 'registry files retained'],
    ['Registry 등록 후 전달 파일 3종 · 신규 PC는 3–5단계(MR → License → Import) 필요', 'After registry: 3 delivery files · new PC needs steps 3–5 (MR → License → Import)'],
    ['① 범용 Setup', '① Universal Setup'],
    ['신규 선사·선박 · Registry 확인 후 HQ + Vessel Setup.exe ZIP', 'New company/vessel · verify Registry → HQ + Vessel Setup.exe ZIP'],
    ['② 범용 App Update', '② Universal App Update'],
    ['③ 선사용 App Update', '③ Company App Update'],
    ['선박 추가 등 · manifest에 <strong>allowedVesselIds</strong> 반영 → HQ license 재발급', 'Vessel add, etc. · manifest <strong>allowedVesselIds</strong> → reissue HQ license'],
    ['Steps 3–5 (신규 PC · 선박 추가)', 'Steps 3–5 (new PC · vessel add)'],
    ['고객 PC → Machine Request JSON', 'Customer PC → Machine Request JSON'],
    ['고객 PC → Import seat license · (선사용 App Update 후 HQ license 필수)', 'Customer PC → Import seat license · (HQ license required after Company App Update)'],
    ['계약 선사·선박 목록 + Setup / App 버전', 'Contract companies/vessels + Setup / App version'],
    ['Registry에 등록된 Company / Vessel / SKU에 맞는 범용 Setup.exe를보냅니다. 설치 후 <strong>Seat License</strong> Import로 활성화합니다.', 'Export universal Setup.exe for registered Company / Vessel / SKU. Activate via <strong>Seat License</strong> Import after install.'],
    ['Deck / Engine 구역 모니터링', 'Deck / Engine zone monitoring'],
    ['SPARE 탭에서 Import XLS 클릭', 'click Import XLS on the SPARE tab'],
    ['file:// 모드 — SPARE 탭 Import XLS → data/spare-inventory.xls 선택', 'file:// mode — SPARE tab Import XLS → select data/spare-inventory.xls'],
    ['선사용 App Update (allowedVesselIds)', 'Company App Update (allowedVesselIds)'],
    ['범용 App Update (pool)', 'Universal App Update (pool)'],
    ['선박 추가 등 Registry 변경 후 · manifest에 active 선박 목록 포함 → <strong>HQ seat license 재발급</strong> 필수', 'After vessel add / Registry change · manifest includes active vessels → <strong>reissue HQ seat license</strong> required'],
    ['기존 pool 선박(이미 TVC-PMS 사용 중): <strong>공용 App Update ZIP</strong> 하나를 전달합니다.', 'Existing pool vessels (already on TVC-PMS): deliver one <strong>shared App Update ZIP</strong>.'],
    ['고객 PC: <strong>Data Export &amp; Import → App Update → Import → Install update</strong> · Master / History / IndexedDB 유지', 'Customer PC: <strong>Data Export &amp; Import → App Update → Import → Install update</strong> · Master / History / IndexedDB preserved'],
    ['A선사: App Update ZIP (data 유지) · B선사: Setup.exe (신규 설치)', 'Company A: App Update ZIP (data preserved) · Company B: Setup.exe (new install)'],
    ['Record Setup sent (B선사)', 'Record Setup sent (Company B)'],
    ['Record App Update (A선사 · all SKUs)', 'Record App Update (Company A · all SKUs)'],
    ['placeholder="선사 주소"', 'placeholder="Company address"'],
    ['placeholder="담당자"', 'placeholder="Contact name"'],
    ['placeholder="별첨 견적 참조"', 'placeholder="See attached quotation"'],
    ['최신 기준 Work Plan 집계 — 부서 필터 적용', 'Work Plan totals (latest) — department filter applied'],
    ['선택한 GROUP 이름을 변경합니다. 해당 GROUP의 모든 작업 항목에 반영됩니다.', 'Rename the selected GROUP. Applies to all jobs in that GROUP.'],
    ['새 GROUP을 추가합니다. 이후 Append로 작업 항목을 등록할 수 있습니다.', 'Add a new GROUP. Use Append to register jobs afterward.'],
    ['placeholder="예: 06. AUX BOILER"', 'placeholder="e.g. 06. AUX BOILER"'],
    ['수정할 행을 선택하세요', 'Select a row to edit'],
    ['삭제할 행을 선택하세요', 'Select a row to delete'],
    ['미완료 Work Report ${stats.pendingReports}건 — Cancel 선택 후 Work Plan에서 입력하세요.', 'Unfinished Work Report(s): ${stats.pendingReports} — select Cancel, then enter in Work Plan.'],
    ['미완료 Work Report ${stats.pendingReports}건 — Cancel 선택 후 Work Plan에서 입력하세요.', 'Unfinished Work Report(s): ${stats.pendingReports} — select Cancel, then enter in Work Plan.'],
    ['Original Plan Update 확정 (${shipCode}) — Status On ${stats?.statusDate || \'\'}. 본사 Import 전까지 재변경 불가.', 'Original Plan Update confirmed (${shipCode}) — Status On ${stats?.statusDate || \'\'}. Locked until HQ Import.'],
    ['Original Plan Update 취소 — Due Date 원복. 미완료 Work Report ${pending}건을 Work Plan에서 입력하세요.', 'Original Plan Update cancelled — Due Dates reverted. Enter ${pending} unfinished Work Report(s) in Work Plan.'],
    ['Original Plan Update 취소 — Run-hour Due Date 변경을 되돌렸습니다.', 'Original Plan Update cancelled — reverted run-hour Due Date changes.'],
    ["'작업 항목 없음'", "'no jobs'"],
    ['타 부서 — Confirm 불가', 'Other department — cannot Confirm'],
    ['전체 작업 목록 표시', 'Show all jobs'],
    ['선택된 작업만 목록에 표시', 'Show selected jobs only'],
    ['체크(ㅁ)로 작업을 선택하세요', 'Select jobs with the checkbox'],
    ['행을 클릭하거나 ㅁ에서 선택하세요', 'Click a row or select with the checkbox'],
    ['신규 부품 등록', 'Register new spare part'],
    ['Work Procedure 화면을 불러오지 못했습니다.', 'Could not load Work Procedure screen.'],
    ['— JOB CODE 선택 —', '— Select JOB CODE —'],
    ['타 부서 — 승인 불가', 'Other department — cannot approve'],
    ['타 부서 항목 — 조작 불가', 'Other department — read only'],
    ['청구서 작성', 'Create requisition'],
    ['<label><strong>첨부파일</strong></label>', '<label><strong>Attachments</strong></label>'],
    ['SPARE 탭에서 Import XLS 클릭', 'click Import XLS on the SPARE tab'],
    ['file:// 모드 — SPARE 탭 Import XLS → data/spare-inventory.xls 선택', 'file:// mode — SPARE tab Import XLS → select data/spare-inventory.xls'],
];

const APP_JS_AI_HELP = `    const AI_HELP_GUIDES = [
        {
            id: 'report-workflow',
            keys: ['report', 'routine', 'incident', 'trouble', 'history', 'pms report', 'work report', 'defect', 'approve', 'make report', 'submit', 'confirm'],
            title: '📘 TVC-PMS reports — create & review',
            steps: [
                'Routine maintenance: [PMS] tab → select equipment → green [Make Report] → [Save].',
                'Trouble / defect: in [Make Report], check [☑ Trouble / Defect] (cause and delay fields expand).',
                'Review history: [Report History] tab → open prior reports and Approve when ready.',
            ],
        },
        {
            id: 'spare-workflow',
            keys: ['spare', 'stock', 'consume', 'requisition', 'spare parts', 'consume log', 'parts'],
            title: '📦 Spare consumption & requisitions',
            steps: [
                'Consumption: enter qty on parts list at bottom of [Make Report] → Save deducts stock automatically.',
                'New requisition: [SPARE] tab → [New Requisition].',
            ],
        },
        {
            id: 'period-filter',
            keys: ['period', 'date', 'datepicker', 'filter', 'calendar', 'range'],
            title: '📅 Filter by period',
            steps: [
                'Use [Period] date fields (YYYY-MM-DD) or the 📅 icon to set the work-date range.',
            ],
        },
        {
            id: 'sync-transfer',
            keys: ['sync', 'export', 'import', 'transfer', 'xfer', 'hq', 'vessel', 'backup', 'restore'],
            title: '🔄 Vessel ↔ HQ data sync',
            steps: [
                '[Menu] → [Transfer / Export] → choose type → [Export] to save a file.',
                '[Menu] → [Import] → select the saved file.',
                '[Menu] → [Online Sync] or [Cloud Restore] (when HQ Cloud is enabled).',
            ],
        },
    ];`;

function applyReplacements(relPath, pairs) {
    const full = path.join(ROOT, relPath);
    if (!fs.existsSync(full)) {
        console.warn('skip missing', relPath);
        return 0;
    }
    let src = fs.readFileSync(full, 'utf8');
    let n = 0;
    for (const [from, to] of pairs) {
        if (!src.includes(from)) continue;
        src = src.split(from).join(to);
        n++;
    }
    if (n) fs.writeFileSync(full, src, 'utf8');
    return n;
}

function applyToSrc(src, pairs) {
    let n = 0;
    for (const [from, to] of pairs) {
        if (!src.includes(from)) continue;
        src = src.split(from).join(to);
        n++;
    }
    return { src, n };
}

function localizeAppJs() {
    const rel = 'js/app.js';
    const full = path.join(ROOT, rel);
    let src = fs.readFileSync(full, 'utf8');
    const shared = applyToSrc(src, SHARED_REPLACEMENTS);
    src = shared.src;
    let n = shared.n;

    const aiStart = src.indexOf('    const AI_HELP_GUIDES = [');
    const aiEnd = src.indexOf('    ];', aiStart);
    if (aiStart >= 0 && aiEnd > aiStart) {
        src = src.slice(0, aiStart) + APP_JS_AI_HELP + src.slice(aiEnd + 5);
        n++;
    }

    const appOnly = [
        ["appendAiHelpBubble('bot', '안녕하세요! 운영 방법이 궁금하시면 아래 칩을 누르거나 질문을 입력해 주세요. (GitHub 접수 없이 즉시 안내)')",
            "appendAiHelpBubble('bot', 'Hello! Tap a chip below or type a question for instant in-app guidance (no GitHub ticket needed).')"],
        ["lines.push('', '다른 주제: [PMS] 보고서 · [SPARE] 부품 · [Period] 기간 · [Menu] Export/Import')",
            "lines.push('', 'Other topics: [PMS] reports · [SPARE] parts · [Period] filter · [Menu] Export/Import')"],
        ["'관련 가이드를 찾지 못했습니다. 아래 주제 중 하나를 선택해 보세요:'",
            "'No matching guide. Try one of these topics:'"],
        ["'• [SPARE] → [New Requisition] · [Make Report] 하단 부품 목록'",
            "'• [SPARE] → [New Requisition] · parts list at bottom of [Make Report]'"],
        ["'• [Period] 날짜(YYYY-MM-DD) 또는 📅 아이콘'",
            "'• [Period] dates (YYYY-MM-DD) or 📅 icon'"],
        ["'버그/개선 제안은 \"Report Issue / Idea\" 탭에서 CEO 검토 대기열로 보내주세요.'",
            "'Send bugs and ideas via the \"Report Issue / Idea\" tab (CEO review queue).'"],
        ["showAiHelpToast('설명 또는 스크린샷을 입력해 주세요.')", "showAiHelpToast('Enter a description or attach a screenshot.')"],
        ["showAiHelpToast('대표님(공무감독)의 검토 대기열로 안전하게 접수되었습니다.')", "showAiHelpToast('Submitted to the superintendent review queue.')"],
        ["showAiHelpToast('접수에 실패했습니다. 네트워크 또는 서버 설정을 확인해 주세요.')", "showAiHelpToast('Submission failed. Check network or server settings.')"],
        ['`미완료 Work Report ${stats.pendingReports}건 — Cancel 선택 후 Work Plan에서 입력하세요.`',
            '`Unfinished Work Report(s): ${stats.pendingReports} — select Cancel, then enter in Work Plan.`'],
    ];
    for (const [from, to] of appOnly) {
        if (src.includes(from)) {
            src = src.split(from).join(to);
            n++;
        }
    }
    fs.writeFileSync(full, src, 'utf8');
    console.log('localized', rel, `(${n} blocks)`);
}

function localizeAdminSop() {
    const rel = 'js/services/adminSop.js';
    let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const pairs = [
        ['<th>메뉴 / 작업</th>', '<th>Menu / action</th>'],
        ['계약 → Registry → Deliver files → License → Master Excel · 상세', 'Contract → Registry → Deliver files → License → Master Excel · see'],
        ['[계약] → Registry → Deliver → Setup/License → Master Excel → 운영', '[Contract] → Registry → Deliver → Setup/License → Master Excel → operations'],
        ['상용화 핵심 (요약)', 'Commercial core (summary)'],
        ['상세 · TVC Lab:', 'Details · TVC Lab:'],
        ["renderChecklist('A. 신규 선사 + 선박'", "renderChecklist('A. New company + vessel'"],
        ["['1', '선사·선박 registry'", "['1', 'Company/vessel registry'"],
        ["'<strong>Deliver → 범용 Setup</strong> (Registry 확인 후)'", "'<strong>Deliver → Universal Setup</strong> (after Registry check)'"],
        ["['3', '전달', 'HQ: HQ Setup · 선박: Master / Engine / Deck Setup']", "['3', 'Deliver', 'HQ: HQ Setup · vessel: Master / Engine / Deck Setup']"],
        ["'<strong>PMS &amp; SPARE MASTER.xlsx</strong> 작성·전달 → 고객 Import'", "'<strong>PMS &amp; SPARE MASTER.xlsx</strong> prepare & deliver → customer Import'"],
        ['PC당 license: HQ 1 + 선박 PC당 3 (Master / Engine / Deck)', 'Licenses per PC: HQ 1 + 3 per vessel PC (Master / Engine / Deck)'],
        ["renderChecklist('B. 기존 pool — App Update (유지보수)'", "renderChecklist('B. Existing pool — App Update (maintenance)'"],
        ["['1', '공용 ZIP', '<strong>Deliver → 범용 App Update</strong>']", "['1', 'Shared ZIP', '<strong>Deliver → Universal App Update</strong>']"],
        ["['2', '전달', 'pool 선박 HQ / Vessel PC에 동일 ZIP']", "['2', 'Deliver', 'same ZIP to pool vessel HQ / Vessel PCs']"],
        ["['3', '적용', 'Import → Install update · Master / History 유지']", "['3', 'Apply', 'Import → Install update · keep Master / History']"],
        ["renderChecklist('C. 기존 선사 — 선박 추가'", "renderChecklist('C. Existing company — add vessel'"],
        ["['1', '신규 선박 등록'", "['1', 'Register new vessel'"],
        ["['2', '선사용 App Update', '<strong>Deliver → 선사용 App Update</strong> (allowedVesselIds)']",
            "['2', 'Company App Update', '<strong>Deliver → Company App Update</strong> (allowedVesselIds)']"],
        ["['3', 'HQ license 재발급', '<strong>Issue seat license</strong> (HQ · Company 선택)']",
            "['3', 'Reissue HQ license', '<strong>Issue seat license</strong> (HQ · select Company)']"],
        ["['4', '신규 PC', 'Vessel Setup 3종 + license 3종 · HQ Import license']",
            "['4', 'New PC', '3 Vessel Setups + 3 licenses · HQ Import license']"],
        ["['5', 'Master', '신규 선박 Master Excel → Import']", "['5', 'Master', 'New vessel Master Excel → Import']"],
        ['범용 Setup ZIP 재생성 불필요 (동일 Setup 사용)', 'No need to rebuild universal Setup ZIP (reuse same Setup)'],
        ["renderChecklist('D. 계약 종료'", "renderChecklist('D. Contract end'"],
        ["['1', 'inactive 처리', 'Registry → <strong>Set inactive</strong> — 완전 삭제 없음']",
            "['1', 'Mark inactive', 'Registry → <strong>Set inactive</strong> — no hard delete']"],
        ["['2', 'HQ license', 'inactive 제외하고 재발급 (권장)']", "['2', 'HQ license', 'reissue excluding inactive (recommended)']"],
    ];
    const merged = applyToSrc(src, [...SHARED_REPLACEMENTS, ...pairs]);
    fs.writeFileSync(path.join(ROOT, rel), merged.src, 'utf8');
    console.log('localized', rel);
}

function localizeAdminCommercial() {
    const rel = 'js/services/adminCommercial.js';
    let src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const pairs = [
        ['상용화 핵심 (TVC → 고객)', 'Commercial core (TVC → customer)'],
        ['<th>항목</th>', '<th>Item</th>'],
        ['<strong>Path B — 범용 Setup</strong>', '<strong>Path B — Universal Setup</strong>'],
        ['Registry 선박 등록 →', 'Register vessel in Registry →'],
        ['HQ 1 + Vessel Master/Engine/Deck · seat license로 scope', 'HQ 1 + Vessel Master/Engine/Deck · scope via seat license'],
        ['설치 PC → machine request →', 'Install PC → machine request →'],
        ['필요할 때마다 발급 (신규 PC · renewal · 선박 추가)', 'Issue as needed (new PC · renewal · vessel add)'],
        ['TVC가 선박별 작성·갱신 → HQ / Vessel에 전달<br>\n                        고객: 앱 Menu → Master Excel <strong>Import</strong> (Admin 밖)',
            'TVC prepares per vessel → deliver to HQ / Vessel<br>\n                        Customer: app Menu → Master Excel <strong>Import</strong> (outside Admin)'],
        ['<strong>Export App Update ZIP</strong> (pool 공용) → HQ/Vessel Import → Install<br>\n                        프로그램만 · PMS/SPARE Master · Work History <strong>무손</strong>',
            '<strong>Export App Update ZIP</strong> (shared pool) → HQ/Vessel Import → Install<br>\n                        Program only · PMS/SPARE Master · Work History <strong>preserved</strong>'],
        ['<th>용도</th>', '<th>Purpose</th>'],
        ['추가 선사/선박', 'Add company/vessel'],
        ['Admin에서 직접 등록 후 Setup · license · Master Excel', 'Register in Admin → Setup · license · Master Excel'],
        ['App Update 흐름', 'App Update flow'],
        ['버전 bump →', 'Version bump →'],
        ['Lab PC에서 Setup 또는 App Update로 반영 · 기능 테스트', 'Apply on Lab PC via Setup or App Update · feature test'],
        ['Admin → <strong>Export App Update ZIP</strong> (Company deploy 기록) → ZIP', 'Admin → <strong>Export App Update ZIP</strong> (record Company deploy) → ZIP'],
        ['HQ / Vessel에서 Import → Install → 재검증', 'HQ / Vessel Import → Install → re-verify'],
        ['상세:', 'Details:'],
    ];
    const merged = applyToSrc(src, [...SHARED_REPLACEMENTS, ...pairs]);
    fs.writeFileSync(path.join(ROOT, rel), merged.src, 'utf8');
    console.log('localized', rel);
}

function localizeAdminSopExtra() {
    const rel = 'js/services/adminSop.js';
    const pairs = [
        ['신규 선사·선박 · Registry 확인 후 Setup ZIP', 'New company/vessel · verify Registry → Setup ZIP'],
        ['선박 추가 등 · manifest <strong>allowedVesselIds</strong> → HQ license 재발급', 'Vessel add, etc. · manifest <strong>allowedVesselIds</strong> → reissue HQ license'],
        ['(Setup / App Update 2종)', '(Setup / App Update — 2 types)'],
        ['Master Excel — TVC 작성 → HQ/Vessel Import', 'Master Excel — TVC prepares → HQ/Vessel Import'],
        ["['1', '공용 ZIP'", "['1', 'Shared ZIP'"],
        ['<th>Admin 선택</th>', '<th>Admin selection</th>'],
        ['Company → active 선박 전체 → allowedVesselIds', 'Company → all active vessels → allowedVesselIds'],
        ['Admin 밖: PMS &amp; SPARE MASTER.xlsx 선박별 작성 · Master Import는 HQ/Vessel 앱', 'Outside Admin: per-vessel PMS &amp; SPARE MASTER.xlsx · Master Import on HQ/Vessel app'],
    ];
    applyReplacements(rel, pairs);
}

function localizeExcelHeaders() {
    const pairs = [
        ['Group에 Yes면 해당 그룹 job이 Critical로 집계됩니다.', 'If Group is Yes, jobs in that group count as Critical.'],
        ['Equipment blocks (GG-EE-III 중 EE)', 'Equipment blocks (EE in GG-EE-III)'],
        ['EQ NO = EE (01–99, 필수). Jobs 시트 EQ NO · Equipment와 같아야 해당 Equipment로 분류됩니다.',
            'EQ NO = EE (01–99, required). Jobs sheet EQ NO must match Equipment for classification.'],
        ['CRITICAL EQUIPMENT = Yes / No (Equipment별).', 'CRITICAL EQUIPMENT = Yes / No (per Equipment).'],
        ['JOB CODE = GG-EE-III (예: 01-00-001). EE 미지정 = 00. Match by DEPARTMENT + JOB CODE. 시트에서 뺀 행은 삭제(Work Report 연결은 임시 CODE).',
            'JOB CODE = GG-EE-III (e.g. 01-00-001). EE unset = 00. Match by DEPARTMENT + JOB CODE. Rows removed from sheet are deleted (Work Report links use temp CODE).'],
        ['EQ NO / Equipment: Equipment Headers와 동일하게 입력. 노란색 셀 = Import 필수.',
            'EQ NO / Equipment: same as Equipment Headers. Yellow cells = required for Import.'],
        ['CRITICAL EQUIPMENT = Yes / No (Job별). 비우면 Group / Equipment 설정을 따릅니다.',
            'CRITICAL EQUIPMENT = Yes / No (per Job). Blank inherits Group / Equipment.'],
        ['JOB_ID가 다른 행과 중복 — JOB CODE로 매칭합니다.', 'duplicate JOB_ID on another row — matching by JOB CODE.'],
        [' · 제외 ${orphanStats.removed} · Work Report 격리 ${orphanStats.detached}', ' · excluded ${orphanStats.removed} · Work Report isolated ${orphanStats.detached}'],
        ['Group에 Yes면 해당 그룹이 Critical로 표시됩니다.', 'If Group is Yes, that group is marked Critical.'],
        ['EQ No. = EE in Code (01–99, 필수). 노란색 셀 = Import 필수.', 'EQ No. = EE in Code (01–99, required). Yellow cells = required for Import.'],
    ];
    for (const f of ['js/services/pmsMasterExcel.js', 'js/services/spareMasterExcel.js']) {
        applyReplacements(f, pairs);
        console.log('localized', f);
    }
}

function localizeContractDraft() {
    const rel = 'admin/templates/contract-draft.html';
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return;
    let src = fs.readFileSync(full, 'utf8');
    src = `<h1>TVC-PMS Software License Agreement (Draft)</h1>
<p><strong>Provider:</strong> THE VESSEL CODE (TVC)<br>
<strong>Customer (shipowner):</strong> {{company.name}} ({{company.name_en}})<br>
<strong>Company ID:</strong> {{company.company_id}}<br>
<strong>Address:</strong> {{company.address}}<br>
<strong>Contact:</strong> {{company.contact_name}} · {{company.contact_email}}</p>

<h2>1. Overview</h2>
<p>This agreement governs installation and use of TVC-PMS (Planned Maintenance System) and SPARE management software.</p>
<ul>
  <li><strong>Start date:</strong> {{contract.start_date}}</li>
  <li><strong>Term:</strong> {{contract.term_months}} months</li>
  <li><strong>Fee:</strong> {{contract.fee_note}}</li>
  <li><strong>Deploy version:</strong> {{deploy.setup_version}}</li>
</ul>

<h2>2. Contract vessels</h2>
{{vessel_table}}

<h2>3. Scope of supply</h2>
<ul>
  <li>Company HQ: TVC-PMS HQ Office Setup × 1</li>
  <li>Each contract vessel: Vessel Master / Engine / Deck Setup × 1 each</li>
  <li>Per-vessel PMS &amp; SPARE MASTER Excel data</li>
  <li>Seat license (per PC · SKU activation)</li>
</ul>

<h2>4. Other</h2>
<p>{{contract.notes}}</p>
<p class="meta">— Auto-generated contract draft from Admin Mode. Review with legal counsel before signing. —</p>

<table style="width:100%;margin-top:24px">
  <tr>
    <td style="width:50%"><strong>THE VESSEL CODE</strong><br><br>Signature: ___________________<br>Date: ___________________</td>
    <td style="width:50%"><strong>{{company.name}}</strong><br><br>Signature: ___________________<br>Date: ___________________</td>
  </tr>
</table>
`;
    fs.writeFileSync(full, src, 'utf8');
    console.log('localized', rel);
}

let total = 0;
for (const [file, pairs] of Object.entries(FILE_REPLACEMENTS)) {
    const n = applyReplacements(file, [...pairs, ...SHARED_REPLACEMENTS]);
    total += n;
    if (n) console.log('localized', file, `(${n})`);
}
localizeAppJs();
localizeAdminSop();
localizeAdminSopExtra();
localizeAdminCommercial();
localizeExcelHeaders();
localizeContractDraft();
console.log('\nDone. Replacement batches:', total);
