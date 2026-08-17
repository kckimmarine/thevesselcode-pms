/**
 * Admin Mode — contract & deploy SOP (in-app checklist).
 * Full doc: docs/admin-mode-sop.md
 */
(function (global) {
    'use strict';

    function renderChecklist(title, rows) {
        const tr = rows.map(([n, tvc, menu]) => `
            <tr>
                <td class="admin-sop-num">${n}</td>
                <td>${tvc}</td>
                <td>${menu}</td>
            </tr>`).join('');
        return `
            <h4 class="admin-sop-h">${title}</h4>
            <table class="admin-sop-table">
                <thead><tr><th>#</th><th>TVC</th><th>메뉴 / 작업</th></tr></thead>
                <tbody>${tr}</tbody>
            </table>`;
    }

    function renderModalHtml() {
        return `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminSopModal()">×</button>
            <h3 class="spare-sync-title">Contract &amp; Deploy SOP</h3>
            <p class="spare-sync-hint">계약 → Registry → Setup → License → Master Excel · 상세 <code>docs/admin-mode-sop.md</code></p>
            <pre class="admin-sop-flow">[계약] → Registry → Setup ZIP → 설치+License → Master Excel → 운영</pre>

            <h4 class="admin-sop-h">상용화 핵심 (요약)</h4>
            <table class="admin-sop-table admin-sop-table-compact">
                <tbody>
                    <tr><td>①</td><td>범용 Setup — <strong>Export Setup handoff</strong></td></tr>
                    <tr><td>②</td><td>Seat license — <strong>Issue seat license</strong></td></tr>
                    <tr><td>③</td><td>Master Excel — TVC 작성 → HQ/Vessel Import</td></tr>
                    <tr><td>④</td><td>App Update — <strong>Package App Update</strong></td></tr>
                </tbody>
            </table>
            <p class="spare-sync-note muted">상세 · TVC Lab: <button type="button" class="btn-linkish" onclick="TVC_App.closeAdminSopModal();TVC_App.openAdminCommercialModal()">Commercial core &amp; TVC Lab guide</button></p>

            ${renderChecklist('A. 신규 선사 + 선박', [
                ['1', '선사·선박 registry', '<strong>Add / edit company</strong> · <strong>Add / edit vessel</strong>'],
                ['2', 'Setup ZIP', '<code>npm run dist</code> → <strong>Export Setup handoff</strong>'],
                ['3', '전달', 'HQ: HQ Setup · 선박: Master / Engine / Deck Setup'],
                ['4', 'License', 'machine request → <strong>Issue seat license</strong> (HQ=Company, Vessel=Company+Vessel)'],
                ['5', 'Master', '<strong>PMS &amp; SPARE MASTER.xlsx</strong> 작성·전달 → 고객 Import'],
            ])}
            <p class="spare-sync-note muted">PC당 license: HQ 1 + 선박 PC당 3 (Master / Engine / Deck)</p>

            ${renderChecklist('B. 기존 선사 — 선박 추가', [
                ['1', '신규 선박 등록', '<strong>Add / edit vessel</strong>'],
                ['2', 'HQ license 재발급', '<strong>Issue seat license</strong> (active 선박 목록 갱신)'],
                ['3', '신규 PC', 'Vessel Setup 3종 + license 3종'],
                ['4', 'Master', '신규 선박 Master Excel → Import'],
            ])}
            <p class="spare-sync-note muted">Setup ZIP 재생성 불필요 (범용 Setup 동일)</p>

            ${renderChecklist('C. 계약 종료', [
                ['1', 'inactive 처리', '<strong>Set inactive</strong> (vessel / company) — 완전 삭제 없음'],
                ['2', 'HQ license', 'inactive 제외하고 재발급 (권장)'],
            ])}

            <h4 class="admin-sop-h">D. App Update (유지보수)</h4>
            <p class="spare-sync-note"><code>npm run dist</code> → <strong>Package App Update</strong> → HQ ZIP 전달 → Import → Install (Master/History 무손)</p>

            <h4 class="admin-sop-h">Seat license</h4>
            <table class="admin-sop-table admin-sop-table-compact">
                <thead><tr><th>SKU</th><th>Admin 선택</th></tr></thead>
                <tbody>
                    <tr><td>HQ_OFFICE</td><td>Company</td></tr>
                    <tr><td>VESSEL_MASTER / ENGINE / DECK</td><td>Company + Vessel</td></tr>
                </tbody>
            </table>

            <p class="spare-sync-note muted" style="margin-top:12px">Admin 밖: PMS &amp; SPARE MASTER.xlsx 선박별 작성 · Master Import는 HQ/Vessel 앱</p>
            <div class="spare-sync-footer">
                <button type="button" class="btn" onclick="TVC_App.closeAdminSopModal()">Close</button>
            </div>`;
    }

    global.TVC_AdminSop = { renderModalHtml };
})(typeof window !== 'undefined' ? window : globalThis);
