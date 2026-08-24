/* THE VESSEL CODE — Admin print (contract draft · registry list) */
const TVC_AdminPrint = (function () {
    const TEMPLATE_URL = 'admin/templates/contract-draft.html';
    let _templateCache = null;

    function esc(s) {
        if (typeof TVC_App !== 'undefined' && TVC_App.esc) return TVC_App.esc(s);
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function printStyles() {
        return `body{font-family:system-ui,"Malgun Gothic",sans-serif;font-size:11px;margin:16px;color:#1a202c;line-height:1.45}
            h1{font-size:18px;color:#1a365d;margin:0 0 8px}
            h2{font-size:14px;color:#1a365d;margin:16px 0 6px}
            .meta{color:#4a5568;margin:0 0 12px;font-size:11px}
            table{width:100%;border-collapse:collapse;margin:8px 0}
            th,td{border:1px solid #cbd5e0;padding:5px 7px;text-align:left;vertical-align:top}
            th{background:#1a365d;color:#fff;font-weight:600}
            tr:nth-child(even){background:#f7fafc}
            .sign-table td{border:none;padding:12px 8px}
            ul{margin:6px 0;padding-left:20px}
            @media print{body{margin:10mm}.no-print{display:none!important}}`;
    }

    async function loadContractTemplate() {
        if (_templateCache) return _templateCache;
        const res = await fetch(TEMPLATE_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error('Contract template not found (admin/templates/contract-draft.html).');
        _templateCache = await res.text();
        return _templateCache;
    }

    function fillTemplate(tpl, data) {
        let out = tpl;
        out = out.replace(/\{\{printed_at\}\}/g, esc(data.printed_at || ''));
        const company = data.company || {};
        const contract = data.contract || {};
        const deploy = data.deploy || {};
        out = out.replace(/\{\{company\.name\}\}/g, esc(company.name || '—'));
        out = out.replace(/\{\{company\.name_en\}\}/g, esc(company.name_en || '—'));
        out = out.replace(/\{\{company\.company_id\}\}/g, esc(company.company_id || '—'));
        out = out.replace(/\{\{company\.address\}\}/g, esc(company.address || '—'));
        out = out.replace(/\{\{company\.contact_name\}\}/g, esc(company.contact_name || '—'));
        out = out.replace(/\{\{company\.contact_email\}\}/g, esc(company.contact_email || '—'));
        out = out.replace(/\{\{company\.notes\}\}/g, esc(company.notes || '—'));
        out = out.replace(/\{\{contract\.start_date\}\}/g, esc(contract.start_date || '—'));
        out = out.replace(/\{\{contract\.term_months\}\}/g, esc(contract.term_months ? String(contract.term_months) : '—'));
        out = out.replace(/\{\{contract\.fee_note\}\}/g, esc(contract.fee_note || '별첨 견적 참조'));
        out = out.replace(/\{\{deploy\.setup_version\}\}/g, esc(deploy.setup_version || '—'));
        out = out.replace(/\{\{vessels_table\}\}/g, data.vessels_table || '');
        return out;
    }

    function vesselsTableHtml(vessels) {
        if (!vessels.length) {
            return '<p class="meta">등록된 선박이 없습니다.</p>';
        }
        const rows = vessels.map((v, i) => {
            const ver = typeof TVC_AdminRegistry !== 'undefined'
                ? TVC_AdminRegistry.formatVesselAppVersions(v.deploy)
                : '—';
            return `<tr>
                <td>${i + 1}</td>
                <td>${esc(v.name)}</td>
                <td>${esc(v.imo_no || '—')}</td>
                <td>${esc(v.delivery || '—')}</td>
                <td>${esc(v.status || 'active')}</td>
                <td>${esc(ver)}</td>
            </tr>`;
        }).join('');
        return `<table>
            <thead><tr><th>No</th><th>Ship's Name</th><th>IMO No</th><th>Delivery</th><th>Status</th><th>Version</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    async function buildContractDraftHtml(companyId, opts = {}) {
        if (typeof TVC_AdminRegistry === 'undefined') throw new Error('Admin registry not loaded.');
        const company = TVC_AdminRegistry.getCompany(companyId);
        if (!company) throw new Error('Select a company.');
        const includeInactive = !!opts.includeInactive;
        let vessels = (company.vessels || []).filter(v => includeInactive || v.status !== 'inactive');
        if (Array.isArray(opts.vesselIds) && opts.vesselIds.length) {
            const set = new Set(opts.vesselIds.map(String));
            vessels = vessels.filter(v => set.has(v.vessel_id));
        }
        const tpl = await loadContractTemplate();
        const body = fillTemplate(tpl, {
            printed_at: new Date().toLocaleString(),
            company,
            contract: company.contract || {},
            deploy: company.deploy || {},
            vessels_table: vesselsTableHtml(vessels),
        });
        return `<style>${printStyles()}</style>${body}`;
    }

    function buildRegistryListHtml(opts = {}) {
        if (typeof TVC_AdminRegistry === 'undefined') throw new Error('Admin registry not loaded.');
        const includeInactive = !!opts.includeInactive;
        const companyId = String(opts.companyId || '').trim();
        const companies = TVC_AdminRegistry.listCompanies({ includeInactive })
            .filter(c => !companyId || c.company_id === companyId);
        const sections = companies.map(c => {
            const hqVer = TVC_AdminRegistry.formatCompanyAppVersion(c.deploy);
            const vessels = (c.vessels || []).filter(v => includeInactive || v.status !== 'inactive');
            const vrows = vessels.map((v, i) => {
                const ver = TVC_AdminRegistry.formatVesselAppVersions(v.deploy);
                const setup = v.deploy?.setup_version || '—';
                return `<tr>
                    <td>${i + 1}</td>
                    <td>${esc(v.name)}</td>
                    <td>${esc(v.imo_no || '—')}</td>
                    <td>${esc(v.delivery || '—')}</td>
                    <td>${esc(v.status || 'active')}</td>
                    <td>${esc(setup)}</td>
                    <td>${esc(ver)}</td>
                </tr>`;
            }).join('') || '<tr><td colspan="7">No vessels</td></tr>';
            return `
                <h2>${esc(c.name)} (${esc(c.company_id)}) · HQ ${esc(hqVer)} · ${vessels.length} vessel(s)</h2>
                <p class="meta">Status: ${esc(c.status)} · Setup: ${esc(c.deploy?.setup_version || '—')} · Sent: ${esc(c.deploy?.setup_sent_at || '—')}</p>
                <table>
                    <thead><tr><th>No</th><th>Ship's Name</th><th>IMO</th><th>Delivery</th><th>Status</th><th>Setup ver</th><th>Version</th></tr></thead>
                    <tbody>${vrows}</tbody>
                </table>`;
        }).join('');
        const title = companyId ? 'Contract Registry (company)' : 'Contract Registry (all companies)';
        return `<style>${printStyles()}</style>
            <h1>THE VESSEL CODE — ${esc(title)}</h1>
            <p class="meta">Printed: ${esc(new Date().toLocaleString())}${includeInactive ? ' · includes inactive' : ''}</p>
            ${sections || '<p class="meta">No companies in registry.</p>'}`;
    }

    function openPrintWindow(title, bodyHtml, { print = false } = {}) {
        if (typeof TVC_SpareMenu !== 'undefined' && TVC_SpareMenu.openWrReportPrintWindow) {
            return TVC_SpareMenu.openWrReportPrintWindow(title, bodyHtml, { print, appCss: false });
        }
        const w = window.open('', '_blank');
        if (!w) throw new Error('Pop-up blocked. Allow pop-ups for print preview.');
        w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${bodyHtml}</body></html>`);
        w.document.close();
        if (print) w.print();
        return w;
    }

    async function printContractDraft(companyId, opts = {}) {
        const html = await buildContractDraftHtml(companyId, opts);
        return openPrintWindow('Contract Draft', html, opts);
    }

    async function printRegistryList(opts = {}) {
        const html = buildRegistryListHtml(opts);
        return openPrintWindow('Contract Registry', html, opts);
    }

    return {
        printStyles,
        buildContractDraftHtml,
        buildRegistryListHtml,
        printContractDraft,
        printRegistryList,
    };
})();

if (typeof window !== 'undefined') window.TVC_AdminPrint = TVC_AdminPrint;
