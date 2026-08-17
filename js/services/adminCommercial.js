/**
 * Admin Mode — commercialization core & TVC Lab (in-app guide).
 * Docs: docs/tvc-internal-qa.md · docs/admin-mode-sop.md
 */
(function (global) {
    'use strict';

    function renderModalHtml() {
        return `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminCommercialModal()">×</button>
            <h3 class="spare-sync-title">Commercial Core &amp; TVC Lab</h3>
            <p class="spare-sync-hint">상용화 핵심 · 출시 후 TVC 내부 QA (<code>TVC_LAB</code> / <code>LAB_SHIP</code>)</p>

            <h4 class="admin-sop-h">상용화 핵심 (TVC → 고객)</h4>
            <table class="admin-sop-table">
                <thead><tr><th>#</th><th>항목</th><th>Admin / TVC</th></tr></thead>
                <tbody>
                    <tr><td class="admin-sop-num">1</td><td><strong>범용 Setup</strong></td>
                        <td><code>npm run dist</code> → <strong>Export Setup handoff</strong><br>
                        HQ 1 + Vessel Master/Engine/Deck · 선사·선박명 없음 · seat license로 scope</td></tr>
                    <tr><td class="admin-sop-num">2</td><td><strong>Seat license</strong></td>
                        <td>설치 PC → machine request → <strong>Issue seat license</strong><br>
                        필요할 때마다 발급 (신규 PC · renewal · 선박 추가)</td></tr>
                    <tr><td class="admin-sop-num">3</td><td><strong>PMS &amp; SPARE MASTER.xlsx</strong></td>
                        <td>TVC가 선박별 작성·갱신 → HQ / Vessel에 전달<br>
                        고객: 앱 Menu → Master Excel <strong>Import</strong> (Admin 밖)</td></tr>
                    <tr><td class="admin-sop-num">4</td><td><strong>App Update</strong></td>
                        <td><code>npm run dist</code> → <strong>Package App Update</strong> → ZIP<br>
                        프로그램만 · PMS/SPARE Master · Work History <strong>무손</strong></td></tr>
                </tbody>
            </table>

            <h4 class="admin-sop-h">TVC Lab (출시 후 내부 테스트)</h4>
            <pre class="admin-sop-flow">고객 registry ≠ TVC_LAB · Lab PC에서 ZIP 검증 → 통과 후 고객 HQ에 동일 ZIP</pre>
            <table class="admin-sop-table admin-sop-table-compact">
                <thead><tr><th>Registry</th><th>용도</th></tr></thead>
                <tbody>
                    <tr><td><strong>TVC_LAB</strong> / <strong>LAB_SHIP</strong></td><td>항상 active · App Update · Sync QA</td></tr>
                    <tr><td>DAEMYUNG 등 Pilot</td><td>출시 시 inactive → 운영은 새 Company ID</td></tr>
                    <tr><td>실제 계약 선사</td><td>deploy = 고객 배포 버전</td></tr>
                </tbody>
            </table>
            <p class="spare-sync-note muted">Lab PC: HQ + Master + Engine (+ Deck) Setup · license scope = TVC_LAB + LAB_SHIP</p>

            <h4 class="admin-sop-h">Lab App Update 흐름</h4>
            <ol class="admin-sop-ol">
                <li>버전 bump → <code>npm run dist</code></li>
                <li>Lab PC에서 Setup 또는 App Update로 반영 · 기능 테스트</li>
                <li>Admin → <strong>Package App Update</strong> (Company = <strong>TVC_LAB</strong>) → ZIP</li>
                <li>Lab PC에서 같은 ZIP Import → Install → 재검증</li>
                <li>통과 → <strong>동일 ZIP</strong>을 고객 HQ (Company = 실제 선사, deploy 기록)</li>
            </ol>

            <div class="spare-sync-actions" style="margin:12px 0">
                <button type="button" class="btn btn-green" onclick="TVC_App.selectTvcLabInList()">Select TVC_LAB in ship list</button>
            </div>
            <p class="spare-sync-note muted">상세: <code>docs/tvc-internal-qa.md</code> · <code>docs/admin-registry-id-guide.md</code></p>
            <div class="spare-sync-footer">
                <button type="button" class="btn" onclick="TVC_App.closeAdminCommercialModal()">Close</button>
            </div>`;
    }

    global.TVC_AdminCommercial = { renderModalHtml };
})(typeof window !== 'undefined' ? window : globalThis);
