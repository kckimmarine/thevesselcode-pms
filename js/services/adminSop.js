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
                <thead><tr><th>#</th><th>TVC</th><th>Menu / action</th></tr></thead>
                <tbody>${tr}</tbody>
            </table>`;
    }

    function renderModalHtml() {
        return `
            <button type="button" class="modal-x" onclick="TVC_App.closeAdminSopModal()">×</button>
            <h3 class="spare-sync-title">Contract &amp; Deploy SOP</h3>
            <p class="spare-sync-hint">Contract → Registry → Deliver files → License → Master Excel · see <code>docs/admin-mode-sop.md</code></p>
            <pre class="admin-sop-flow">[Contract] → Registry → Deliver → Setup/License → Master Excel → operations</pre>

            <h4 class="admin-sop-h">Deliver files (Admin)</h4>
            <table class="admin-sop-table admin-sop-table-compact">
                <tbody>
                    <tr><td><strong>① Universal Setup</strong></td><td>New company/vessel · verify Registry → Setup ZIP</td></tr>
                    <tr><td><strong>② Universal App Update</strong></td><td>Existing pool · program-only replace · no MR/License</td></tr>
                    <tr><td><strong>③ Company App Update</strong></td><td>Vessel add, etc. · manifest <strong>allowedVesselIds</strong> → reissue HQ license</td></tr>
                </tbody>
            </table>

            <h4 class="admin-sop-h">Commercial core (summary)</h4>
            <table class="admin-sop-table admin-sop-table-compact">
                <tbody>
                    <tr><td>①</td><td>Registry — <strong>Company &amp; Vessel Registry</strong></td></tr>
                    <tr><td>②</td><td>Deliver — <strong>Deliver files &amp; license</strong> (Setup / App Update — 2 types)</td></tr>
                    <tr><td>③</td><td>Seat license — <strong>Issue seat license</strong> (steps 3–5)</td></tr>
                    <tr><td>④</td><td>Master Excel — TVC prepares → HQ/Vessel Import</td></tr>
                </tbody>
            </table>
            <p class="spare-sync-note muted">Details · TVC Lab: <button type="button" class="btn-linkish" onclick="TVC_App.closeAdminSopModal();TVC_App.openAdminCommercialModal()">Commercial core &amp; TVC Lab guide</button></p>

            ${renderChecklist('A. New company + vessel', [
                ['1', 'Company/vessel registry', '<strong>Company &amp; Vessel Registry</strong>'],
                ['2', 'Setup ZIP', '<strong>Deliver → Universal Setup</strong> (after Registry check)'],
                ['3', 'Deliver', 'HQ: HQ Setup · vessel: Master / Engine / Deck Setup'],
                ['4', 'License', 'machine request → <strong>Issue seat license</strong> (HQ=Company, Vessel=Company+Vessel)'],
                ['5', 'Master', '<strong>PMS &amp; SPARE MASTER.xlsx</strong> prepare & deliver → customer Import'],
            ])}
            <p class="spare-sync-note muted">Licenses per PC: HQ 1 + 3 per vessel PC (Master / Engine / Deck)</p>

            ${renderChecklist('B. Existing pool — App Update (maintenance)', [
                ['1', 'Shared ZIP', '<strong>Deliver → Universal App Update</strong>'],
                ['2', 'Deliver', 'same ZIP to pool vessel HQ / Vessel PCs'],
                ['3', 'Apply', 'Import → Install update · keep Master / History'],
            ])}

            ${renderChecklist('C. Existing company — add vessel', [
                ['1', 'Register new vessel', '<strong>Company &amp; Vessel Registry</strong>'],
                ['2', 'Company App Update', '<strong>Deliver → Company App Update</strong> (allowedVesselIds)'],
                ['3', 'Reissue HQ license', '<strong>Issue seat license</strong> (HQ · select Company)'],
                ['4', 'New PC', '3 Vessel Setups + 3 licenses · HQ Import license'],
                ['5', 'Master', 'New vessel Master Excel → Import'],
            ])}
            <p class="spare-sync-note muted">No need to rebuild universal Setup ZIP (reuse same Setup)</p>

            ${renderChecklist('D. Contract end', [
                ['1', 'Mark inactive', 'Registry → <strong>Set inactive</strong> — no hard delete'],
                ['2', 'HQ license', 'reissue excluding inactive (recommended)'],
            ])}

            <h4 class="admin-sop-h">Seat license</h4>
            <table class="admin-sop-table admin-sop-table-compact">
                <thead><tr><th>SKU</th><th>Admin selection</th></tr></thead>
                <tbody>
                    <tr><td>HQ_OFFICE</td><td>Company → all active vessels → allowedVesselIds</td></tr>
                    <tr><td>VESSEL_MASTER / ENGINE / DECK</td><td>Company + Vessel</td></tr>
                </tbody>
            </table>

            <p class="spare-sync-note muted" style="margin-top:12px">Outside Admin: per-vessel PMS &amp; SPARE MASTER.xlsx · Master Import on HQ/Vessel app</p>
            <div class="spare-sync-footer">
                <button type="button" class="btn" onclick="TVC_App.closeAdminSopModal()">Close</button>
            </div>`;
    }

    global.TVC_AdminSop = { renderModalHtml };
})(typeof window !== 'undefined' ? window : globalThis);
