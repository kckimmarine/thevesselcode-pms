/**
 * Admin Mode — commercialization core & TVC Lab (in-app guide).
 * Docs: docs/tvc-internal-qa.md · docs/admin-mode-sop.md
 */
(function (global) {
    'use strict';

    function renderModalHtml() {
        return `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminCommercialModal()">×</button>
            <h3 class="spare-sync-title">Commercial Core</h3>
            <p class="spare-sync-hint">Pilot registry: <code>TVC</code> / <code>TVC No1</code> — add companies and vessels from Admin as needed.</p>

            <h4 class="admin-sop-h">상용화 핵심 (TVC → 고객)</h4>
            <table class="admin-sop-table">
                <thead><tr><th>#</th><th>항목</th><th>Admin / TVC</th></tr></thead>
                <tbody>
                    <tr><td class="admin-sop-num">1</td><td><strong>Path B — 범용 Setup</strong></td>
                        <td>Registry 선박 등록 → <strong>Export Setup handoff</strong><br>
                        HQ 1 + Vessel Master/Engine/Deck · seat license로 scope</td></tr>
                    <tr><td class="admin-sop-num">2</td><td><strong>Seat license</strong></td>
                        <td>설치 PC → machine request → <strong>Issue seat license</strong><br>
                        필요할 때마다 발급 (신규 PC · renewal · 선박 추가)</td></tr>
                    <tr><td class="admin-sop-num">3</td><td><strong>PMS &amp; SPARE MASTER.xlsx</strong></td>
                        <td>TVC가 선박별 작성·갱신 → HQ / Vessel에 전달<br>
                        고객: 앱 Menu → Master Excel <strong>Import</strong> (Admin 밖)</td></tr>
                    <tr><td class="admin-sop-num">4</td><td><strong>Path A — App Update</strong></td>
                        <td><strong>Export App Update ZIP</strong> (pool 공용) → HQ/Vessel Import → Install<br>
                        프로그램만 · PMS/SPARE Master · Work History <strong>무손</strong></td></tr>
                </tbody>
            </table>

            <h4 class="admin-sop-h">Registry (Admin)</h4>
            <pre class="admin-sop-flow">Start with TVC / TVC No1 only · Add Company → Add Vessel → Export Setup / App Update</pre>
            <table class="admin-sop-table admin-sop-table-compact">
                <thead><tr><th>Registry</th><th>용도</th></tr></thead>
                <tbody>
                    <tr><td><strong>TVC</strong> / <strong>TVC No1</strong></td><td>Pilot · PMS/SPARE Master · Sync test</td></tr>
                    <tr><td>추가 선사/선박</td><td>Admin에서 직접 등록 후 Setup · license · Master Excel</td></tr>
                </tbody>
            </table>

            <h4 class="admin-sop-h">App Update 흐름</h4>
            <ol class="admin-sop-ol">
                <li>버전 bump → <code>npm run dist</code></li>
                <li>Lab PC에서 Setup 또는 App Update로 반영 · 기능 테스트</li>
                <li>Admin → <strong>Export App Update ZIP</strong> (Company deploy 기록) → ZIP</li>
                <li>HQ / Vessel에서 Import → Install → 재검증</li>
            </ol>

            <div class="spare-sync-actions" style="margin:12px 0">
                <button type="button" class="btn btn-green" onclick="TVC_App.selectTvcLabInList()">Select TVC No1 in ship list</button>
            </div>
            <p class="spare-sync-note muted">상세: <code>docs/tvc-internal-qa.md</code> · <code>docs/admin-registry-id-guide.md</code></p>
            <div class="spare-sync-footer">
                <button type="button" class="btn" onclick="TVC_App.closeAdminCommercialModal()">Close</button>
            </div>`;
    }

    global.TVC_AdminCommercial = { renderModalHtml };
})(typeof window !== 'undefined' ? window : globalThis);
