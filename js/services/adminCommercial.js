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

            <h4 class="admin-sop-h">Commercial core (TVC → customer)</h4>
            <table class="admin-sop-table">
                <thead><tr><th>#</th><th>Item</th><th>Admin / TVC</th></tr></thead>
                <tbody>
                    <tr><td class="admin-sop-num">1</td><td><strong>Path B — Universal Setup</strong></td>
                        <td>Register vessel in Registry → <strong>Export Setup handoff</strong><br>
                        HQ 1 + Vessel Master/Engine/Deck · scope via seat license</td></tr>
                    <tr><td class="admin-sop-num">2</td><td><strong>Seat license</strong></td>
                        <td>Install PC → machine request → <strong>Issue seat license</strong><br>
                        Issue as needed (new PC · renewal · vessel add)</td></tr>
                    <tr><td class="admin-sop-num">3</td><td><strong>PMS &amp; SPARE MASTER.xlsx</strong></td>
                        <td>TVC prepares per vessel → deliver to HQ / Vessel<br>
                        Customer: app Menu → Master Excel <strong>Import</strong> (outside Admin)</td></tr>
                    <tr><td class="admin-sop-num">4</td><td><strong>Path A — App Update</strong></td>
                        <td><strong>Export App Update ZIP</strong> (shared pool) → HQ/Vessel Import → Install<br>
                        Program only · PMS/SPARE Master · Work History <strong>preserved</strong></td></tr>
                </tbody>
            </table>

            <h4 class="admin-sop-h">Registry (Admin)</h4>
            <pre class="admin-sop-flow">Start with TVC / TVC No1 only · Add Company → Add Vessel → Export Setup / App Update</pre>
            <table class="admin-sop-table admin-sop-table-compact">
                <thead><tr><th>Registry</th><th>Purpose</th></tr></thead>
                <tbody>
                    <tr><td><strong>TVC</strong> / <strong>TVC No1</strong></td><td>Pilot · PMS/SPARE Master · Sync test</td></tr>
                    <tr><td>Add company/vessel</td><td>Register in Admin → Setup · license · Master Excel</td></tr>
                </tbody>
            </table>

            <h4 class="admin-sop-h">App Update flow</h4>
            <ol class="admin-sop-ol">
                <li>Version bump → <code>npm run dist</code></li>
                <li>Apply on Lab PC via Setup or App Update · feature test</li>
                <li>Admin → <strong>Export App Update ZIP</strong> (record Company deploy) → ZIP</li>
                <li>HQ / Vessel Import → Install → re-verify</li>
            </ol>

            <div class="spare-sync-actions" style="margin:12px 0">
                <button type="button" class="btn btn-green" onclick="TVC_App.selectTvcLabInList()">Select TVC No1 in ship list</button>
            </div>
            <p class="spare-sync-note muted">Details: <code>docs/tvc-internal-qa.md</code> · <code>docs/admin-registry-id-guide.md</code></p>
            <div class="spare-sync-footer">
                <button type="button" class="btn" onclick="TVC_App.closeAdminCommercialModal()">Close</button>
            </div>`;
    }

    global.TVC_AdminCommercial = { renderModalHtml };
})(typeof window !== 'undefined' ? window : globalThis);
