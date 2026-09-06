/* THE VESSEL CODE — Maritime Toolkit (public utilities) */
const TVC_MaritimeToolkit = (function () {
    const FUEL_TYPES = {
        VLSFO: { label: 'VLSFO (0.50% S)', defaultDensity: 991, alpha: 0.00065 },
        LSMGO: { label: 'LSMGO / MGO', defaultDensity: 850, alpha: 0.00080 },
    };

    const FLANGE_ROWS = [
        { standard: 'JIS 5K', nb: '15A', od: 80, pcd: 55, bolts: 4, hole: 12, bolt: 'M12' },
        { standard: 'JIS 5K', nb: '20A', od: 85, pcd: 60, bolts: 4, hole: 12, bolt: 'M12' },
        { standard: 'JIS 5K', nb: '25A', od: 95, pcd: 70, bolts: 4, hole: 12, bolt: 'M12' },
        { standard: 'JIS 5K', nb: '32A', od: 100, pcd: 75, bolts: 4, hole: 15, bolt: 'M12' },
        { standard: 'JIS 5K', nb: '40A', od: 105, pcd: 80, bolts: 4, hole: 15, bolt: 'M12' },
        { standard: 'JIS 5K', nb: '50A', od: 120, pcd: 95, bolts: 4, hole: 15, bolt: 'M12' },
        { standard: 'JIS 5K', nb: '65A', od: 140, pcd: 115, bolts: 4, hole: 19, bolt: 'M16' },
        { standard: 'JIS 5K', nb: '80A', od: 150, pcd: 125, bolts: 8, hole: 19, bolt: 'M16' },
        { standard: 'JIS 5K', nb: '100A', od: 175, pcd: 145, bolts: 8, hole: 19, bolt: 'M16' },
        { standard: 'JIS 5K', nb: '125A', od: 200, pcd: 175, bolts: 8, hole: 19, bolt: 'M16' },
        { standard: 'JIS 5K', nb: '150A', od: 225, pcd: 200, bolts: 8, hole: 19, bolt: 'M16' },
        { standard: 'JIS 10K', nb: '15A', od: 95, pcd: 70, bolts: 4, hole: 15, bolt: 'M12' },
        { standard: 'JIS 10K', nb: '20A', od: 100, pcd: 75, bolts: 4, hole: 15, bolt: 'M12' },
        { standard: 'JIS 10K', nb: '25A', od: 125, pcd: 90, bolts: 4, hole: 19, bolt: 'M16' },
        { standard: 'JIS 10K', nb: '32A', od: 135, pcd: 100, bolts: 4, hole: 19, bolt: 'M16' },
        { standard: 'JIS 10K', nb: '40A', od: 140, pcd: 105, bolts: 4, hole: 19, bolt: 'M16' },
        { standard: 'JIS 10K', nb: '50A', od: 155, pcd: 120, bolts: 8, hole: 19, bolt: 'M16' },
        { standard: 'JIS 10K', nb: '65A', od: 175, pcd: 140, bolts: 8, hole: 19, bolt: 'M16' },
        { standard: 'JIS 10K', nb: '80A', od: 185, pcd: 150, bolts: 8, hole: 19, bolt: 'M16' },
        { standard: 'JIS 10K', nb: '100A', od: 210, pcd: 175, bolts: 8, hole: 19, bolt: 'M16' },
        { standard: 'JIS 10K', nb: '125A', od: 250, pcd: 210, bolts: 8, hole: 23, bolt: 'M20' },
        { standard: 'JIS 10K', nb: '150A', od: 280, pcd: 240, bolts: 8, hole: 23, bolt: 'M20' },
        { standard: 'JIS 16K', nb: '15A', od: 95, pcd: 70, bolts: 4, hole: 15, bolt: 'M12' },
        { standard: 'JIS 16K', nb: '25A', od: 125, pcd: 90, bolts: 4, hole: 19, bolt: 'M16' },
        { standard: 'JIS 16K', nb: '50A', od: 155, pcd: 120, bolts: 8, hole: 19, bolt: 'M16' },
        { standard: 'JIS 16K', nb: '80A', od: 200, pcd: 160, bolts: 8, hole: 23, bolt: 'M20' },
        { standard: 'JIS 16K', nb: '100A', od: 225, pcd: 185, bolts: 8, hole: 23, bolt: 'M20' },
        { standard: 'JIS 16K', nb: '150A', od: 305, pcd: 260, bolts: 12, hole: 25, bolt: 'M22' },
        { standard: 'DIN PN16', nb: 'DN15', od: 95, pcd: 65, bolts: 4, hole: 14, bolt: 'M12' },
        { standard: 'DIN PN16', nb: 'DN20', od: 105, pcd: 75, bolts: 4, hole: 14, bolt: 'M12' },
        { standard: 'DIN PN16', nb: 'DN25', od: 115, pcd: 85, bolts: 4, hole: 14, bolt: 'M12' },
        { standard: 'DIN PN16', nb: 'DN32', od: 140, pcd: 100, bolts: 4, hole: 18, bolt: 'M16' },
        { standard: 'DIN PN16', nb: 'DN40', od: 150, pcd: 110, bolts: 4, hole: 18, bolt: 'M16' },
        { standard: 'DIN PN16', nb: 'DN50', od: 165, pcd: 125, bolts: 4, hole: 18, bolt: 'M16' },
        { standard: 'DIN PN16', nb: 'DN65', od: 185, pcd: 145, bolts: 8, hole: 18, bolt: 'M16' },
        { standard: 'DIN PN16', nb: 'DN80', od: 200, pcd: 160, bolts: 8, hole: 18, bolt: 'M16' },
        { standard: 'DIN PN16', nb: 'DN100', od: 220, pcd: 180, bolts: 8, hole: 18, bolt: 'M16' },
        { standard: 'DIN PN16', nb: 'DN125', od: 250, pcd: 210, bolts: 8, hole: 18, bolt: 'M16' },
        { standard: 'DIN PN16', nb: 'DN150', od: 285, pcd: 240, bolts: 8, hole: 22, bolt: 'M20' },
        { standard: 'ANSI 150#', nb: '1/2"', od: 89, pcd: 60, bolts: 4, hole: 16, bolt: '1/2"' },
        { standard: 'ANSI 150#', nb: '3/4"', od: 98, pcd: 70, bolts: 4, hole: 16, bolt: '1/2"' },
        { standard: 'ANSI 150#', nb: '1"', od: 108, pcd: 79, bolts: 4, hole: 16, bolt: '1/2"' },
        { standard: 'ANSI 150#', nb: '1-1/2"', od: 127, pcd: 98, bolts: 4, hole: 16, bolt: '5/8"' },
        { standard: 'ANSI 150#', nb: '2"', od: 152, pcd: 121, bolts: 4, hole: 19, bolt: '5/8"' },
        { standard: 'ANSI 150#', nb: '3"', od: 190, pcd: 152, bolts: 4, hole: 19, bolt: '5/8"' },
        { standard: 'ANSI 150#', nb: '4"', od: 229, pcd: 190, bolts: 8, hole: 19, bolt: '5/8"' },
        { standard: 'ANSI 150#', nb: '6"', od: 280, pcd: 241, bolts: 8, hole: 22, bolt: '3/4"' },
        { standard: 'ANSI 150#', nb: '8"', od: 343, pcd: 298, bolts: 8, hole: 22, bolt: '3/4"' },
    ];

    const LUB_OIL_ROWS = [
        { category: 'Cylinder Oil', grade: '70BN', shell: 'Alexia 50', mobil: 'Mobil Gard 570', castrol: 'Cleeton 70', total: 'Disola A 40' },
        { category: 'Cylinder Oil', grade: '80BN', shell: 'Alexia 70', mobil: 'Mobil Gard 570', castrol: 'Cleeton 80', total: 'Disola A 50' },
        { category: 'Cylinder Oil', grade: '100BN', shell: 'Alexia 100', mobil: 'Mobil Gard 610', castrol: 'Cleeton 100', total: 'Disola A 70' },
        { category: 'Cylinder Oil', grade: '140BN', shell: 'Alexia 140', mobil: 'Mobil Gard 640', castrol: 'Cleeton 140', total: 'Disola A 100' },
        { category: 'System Oil', grade: 'SAE 30', shell: 'Gadinia 30', mobil: 'Mobil Delvac 1300', castrol: 'Cyltech 30', total: 'Aurelia X 300' },
        { category: 'System Oil', grade: 'SAE 40', shell: 'Gadinia 40', mobil: 'Mobil Delvac 1640', castrol: 'Cyltech 40', total: 'Aurelia X 400' },
        { category: 'System Oil', grade: 'SAE 50', shell: 'Gadinia 50', mobil: 'Mobil Delvac 1 SHC', castrol: 'Cyltech 50', total: 'Aurelia X 500' },
        { category: 'Hydraulic Oil', grade: 'ISO VG 32', shell: 'Tellus S2 M 32', mobil: 'Mobil DTE 10 Excel 32', castrol: 'Hyspin AWS 32', total: 'Azolla ZS 32' },
        { category: 'Hydraulic Oil', grade: 'ISO VG 46', shell: 'Tellus S2 M 46', mobil: 'Mobil DTE 10 Excel 46', castrol: 'Hyspin AWS 46', total: 'Azolla ZS 46' },
        { category: 'Hydraulic Oil', grade: 'ISO VG 68', shell: 'Tellus S2 M 68', mobil: 'Mobil DTE 10 Excel 68', castrol: 'Hyspin AWS 68', total: 'Azolla ZS 68' },
        { category: 'Hydraulic Oil', grade: 'ISO VG 100', shell: 'Tellus S2 M 100', mobil: 'Mobil DTE 10 Excel 100', castrol: 'Hyspin AWS 100', total: 'Azolla ZS 100' },
    ];

    const PAINT_ROWS = [
        { type: 'Antifouling (A/F)', product: 'Self-Polishing SPC', chugoku: 'SeaGrandfather 880', jotun: 'SeaQuantum Pro', hempel: 'Globic 9500', ip: 'Interswift SPC' },
        { type: 'Antifouling (A/F)', product: 'Controlled Depletion', chugoku: 'SeaGrandfather 700', jotun: 'SeaForce 90', hempel: 'Oceanic+', ip: 'Interspeed 640' },
        { type: 'Anticorrosive (A/C)', product: 'Aluminium A/C', chugoku: 'Marine Alumi', jotun: 'Pilot A/C', hempel: 'Aluminium 15360', ip: 'Intershield 300' },
        { type: 'Anticorrosive (A/C)', product: 'Vinyl A/C', chugoku: 'Marine Vinyl', jotun: 'Pilot II', hempel: 'Light Primer 45550', ip: 'Intergard 269' },
        { type: 'Epoxy Primer', product: 'Pure Epoxy', chugoku: 'Epicon B-13', jotun: 'Barrier 77', hempel: 'Hempadur 15553', ip: 'Intershield 300' },
        { type: 'Epoxy Primer', product: 'High-Build Epoxy', chugoku: 'Epicon HB', jotun: 'Barrier 80', hempel: 'Hempadur 17240', ip: 'Intershield 803' },
        { type: 'Epoxy Primer', product: 'Tank Coating', chugoku: 'Tankguard 100', jotun: 'Tankguard Storage', hempel: 'Hempadur Mastic 45880', ip: 'Interline 984' },
    ];

    let _activeTool = 'catalog';

    function esc(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function standards() {
        return [...new Set(FLANGE_ROWS.map(r => r.standard))];
    }

    function filterFlanges(standard, query) {
        const q = String(query || '').trim().toLowerCase();
        return FLANGE_ROWS.filter(row => {
            if (row.standard !== standard) return false;
            if (!q) return true;
            return String(row.nb).toLowerCase().includes(q)
                || String(row.od).includes(q)
                || String(row.pcd).includes(q);
        });
    }

    /**
     * ASTM Table 54B-inspired mass conversion (simplified for shipboard use).
     * Corrects observed volume & density to 15°C reference, then MT in air.
     */
    function calcBunkerMassAstM54B(volume, density15, tempC, fuelKey) {
        const vObs = Math.max(0, Number(volume) || 0);
        const rho15 = Math.max(0, Number(density15) || 0);
        const t = Number(tempC);
        const fuel = FUEL_TYPES[fuelKey] || FUEL_TYPES.VLSFO;
        const alpha = fuel.alpha;

        if (!vObs || !rho15) return { mt: 0, v15: 0, rho15, vcf: 1 };

        const deltaT = Number.isFinite(t) ? t - 15 : 0;
        const vcf = 1 - alpha * deltaT;
        const v15 = vObs * Math.max(0.95, Math.min(1.05, vcf));
        const mt = (v15 * rho15) / 1000;

        return {
            mt,
            v15,
            rho15,
            vcf: v15 / vObs,
            alpha,
        };
    }

    function calcVolumeToMt(volume, density15, tempC, fuelKey) {
        return calcBunkerMassAstM54B(volume, density15, tempC, fuelKey).mt;
    }

    function tableHtml(headers, rows) {
        if (!rows.length) return '<p class="maritime-empty">No matches found.</p>';
        const head = headers.map(h => `<th>${esc(h)}</th>`).join('');
        const body = rows.map(cells =>
            `<tr>${cells.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
        return `
            <div class="maritime-table-wrap">
                <table class="maritime-table">
                    <thead><tr>${head}</tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
    }

    function renderBunkerPanel(host) {
        const fuelOptions = Object.entries(FUEL_TYPES).map(([k, v]) =>
            `<option value="${k}">${esc(v.label)}</option>`).join('');
        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">⛽ Bunker &amp; Fuel Calculator</h2>
                <p class="maritime-panel-sub">Volume to metric tons using ASTM Table 54B-style temperature &amp; density correction (reference 15°C).</p>
            </div>
            <form class="maritime-bunker-form" id="bunkerCalcForm">
                <label class="maritime-field">
                    <span>Fuel type</span>
                    <select id="bunkerFuelType">${fuelOptions}</select>
                </label>
                <label class="maritime-field">
                    <span>Volume (m³ @ observed temp)</span>
                    <input type="number" id="bunkerVolume" min="0" step="0.001" value="500" inputmode="decimal">
                </label>
                <label class="maritime-field">
                    <span>Observed density (kg/m³ @ 15°C)</span>
                    <input type="number" id="bunkerDensity" min="800" max="1100" step="0.1" value="991" inputmode="decimal">
                </label>
                <label class="maritime-field">
                    <span>Temperature (°C)</span>
                    <input type="number" id="bunkerTemp" step="0.1" value="40" inputmode="decimal">
                </label>
            </form>
            <div class="maritime-bunker-result" id="bunkerResult" aria-live="polite">
                <div class="maritime-bunker-metrics">
                    <div><span>Mass (MT)</span><strong id="bunkerMassValue">—</strong></div>
                    <div><span>Vol @ 15°C (m³)</span><strong id="bunkerV15Value">—</strong></div>
                    <div><span>VCF (approx.)</span><strong id="bunkerVcfValue">—</strong></div>
                </div>
            </div>
            <p class="maritime-note">ASTM 54B simplified: V<sub>15</sub> = V<sub>obs</sub> × (1 − αΔT); MT = V<sub>15</sub> × ρ<sub>15</sub> ÷ 1000. Verify with shore lab before commercial settlement.</p>`;

        const form = host.querySelector('#bunkerCalcForm');
        const fuelSelect = host.querySelector('#bunkerFuelType');
        const paint = () => {
            const fuelKey = fuelSelect.value;
            const fuel = FUEL_TYPES[fuelKey];
            const vol = host.querySelector('#bunkerVolume')?.value;
            const den = host.querySelector('#bunkerDensity')?.value;
            const temp = host.querySelector('#bunkerTemp')?.value;
            const result = calcBunkerMassAstM54B(vol, den, temp, fuelKey);
            host.querySelector('#bunkerMassValue').textContent = `${result.mt.toFixed(3)} MT`;
            host.querySelector('#bunkerV15Value').textContent = result.v15.toFixed(3);
            host.querySelector('#bunkerVcfValue').textContent = result.vcf.toFixed(4);
        };
        fuelSelect.addEventListener('change', () => {
            const fuel = FUEL_TYPES[fuelSelect.value];
            host.querySelector('#bunkerDensity').value = String(fuel.defaultDensity);
            paint();
        });
        form.addEventListener('input', paint);
        paint();
    }

    function renderLubePanel(host) {
        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">🛢️ Lubricant Cross-Reference</h2>
                <p class="maritime-panel-sub">Compare cylinder, system, and hydraulic oil grades across major makers.</p>
            </div>
            <div class="maritime-flange-controls">
                <label class="maritime-field">
                    <span>Category</span>
                    <select id="lubeCategoryFilter">
                        <option value="">All categories</option>
                        <option value="Cylinder Oil">Cylinder Oil</option>
                        <option value="System Oil">System Oil</option>
                        <option value="Hydraulic Oil">Hydraulic Oil</option>
                    </select>
                </label>
                <label class="maritime-field maritime-field-grow">
                    <span>Search grade or product</span>
                    <input type="search" id="lubeSearch" placeholder="e.g. 80BN, Tellus, Mobil Gard" autocomplete="off">
                </label>
            </div>
            <div id="lubeTableHost"></div>
            <p class="maritime-note">Reference equivalents for procurement — always confirm OEM / maker approval before change-over.</p>`;

        const catFilter = host.querySelector('#lubeCategoryFilter');
        const search = host.querySelector('#lubeSearch');
        const tableHost = host.querySelector('#lubeTableHost');

        const paint = () => {
            const cat = catFilter.value;
            const q = (search.value || '').trim().toLowerCase();
            const rows = LUB_OIL_ROWS.filter(r => {
                if (cat && r.category !== cat) return false;
                if (!q) return true;
                const hay = [r.category, r.grade, r.shell, r.mobil, r.castrol, r.total].join(' ').toLowerCase();
                return hay.includes(q);
            });
            tableHost.innerHTML = tableHtml(
                ['Category', 'Grade', 'Shell', 'Mobil', 'Castrol', 'Total'],
                rows.map(r => [r.category, r.grade, r.shell, r.mobil, r.castrol, r.total]),
            );
        };
        catFilter.addEventListener('change', paint);
        search.addEventListener('input', paint);
        paint();
    }

    function renderPaintPanel(host) {
        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">🎨 Marine Paint Cross-Reference</h2>
                <p class="maritime-panel-sub">Antifouling, anticorrosive, and epoxy primer equivalents across leading makers.</p>
            </div>
            <div class="maritime-flange-controls">
                <label class="maritime-field">
                    <span>Coating type</span>
                    <select id="paintTypeFilter">
                        <option value="">All types</option>
                        <option value="Antifouling">Antifouling (A/F)</option>
                        <option value="Anticorrosive">Anticorrosive (A/C)</option>
                        <option value="Epoxy">Epoxy Primer</option>
                    </select>
                </label>
                <label class="maritime-field maritime-field-grow">
                    <span>Search product</span>
                    <input type="search" id="paintSearch" placeholder="e.g. SeaQuantum, Globic, Barrier" autocomplete="off">
                </label>
            </div>
            <div id="paintTableHost"></div>
            <p class="maritime-note">Yard / class approval required. Data for cross-reference only — not a coating specification.</p>`;

        const typeFilter = host.querySelector('#paintTypeFilter');
        const search = host.querySelector('#paintSearch');
        const tableHost = host.querySelector('#paintTableHost');

        const paint = () => {
            const type = typeFilter.value;
            const q = (search.value || '').trim().toLowerCase();
            const rows = PAINT_ROWS.filter(r => {
                if (type === 'Antifouling' && !r.type.includes('Antifouling')) return false;
                if (type === 'Anticorrosive' && !r.type.includes('Anticorrosive')) return false;
                if (type === 'Epoxy' && !r.type.includes('Epoxy')) return false;
                if (!q) return true;
                const hay = [r.type, r.product, r.chugoku, r.jotun, r.hempel, r.ip].join(' ').toLowerCase();
                return hay.includes(q);
            });
            tableHost.innerHTML = tableHtml(
                ['Type', 'Product class', 'Chugoku', 'Jotun', 'Hempel', 'International'],
                rows.map(r => [r.type, r.product, r.chugoku, r.jotun, r.hempel, r.ip]),
            );
        };
        typeFilter.addEventListener('change', paint);
        search.addEventListener('input', paint);
        paint();
    }

    function renderEngineeringPanel(host) {
        const stdOptions = standards().map(s =>
            `<option value="${esc(s)}">${esc(s)}</option>`).join('');
        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">📐 Flange &amp; Engineering Tables</h2>
                <p class="maritime-panel-sub">JIS (5K / 10K / 16K), DIN PN16, and ANSI 150# pipe flange dimensions.</p>
            </div>
            <div class="maritime-flange-controls">
                <label class="maritime-field">
                    <span>Standard</span>
                    <select id="flangeStandardSelect">${stdOptions}</select>
                </label>
                <label class="maritime-field maritime-field-grow">
                    <span>Filter nominal bore</span>
                    <input type="search" id="flangeSizeSearch" placeholder="e.g. 50A, DN80, 4&quot;" autocomplete="off">
                </label>
            </div>
            <div id="flangeTableHost"></div>
            <p class="maritime-note">Dimensions in millimetres. Verify against yard drawing / class certificate before procurement.</p>`;

        const stdSelect = host.querySelector('#flangeStandardSelect');
        const search = host.querySelector('#flangeSizeSearch');
        const tableHost = host.querySelector('#flangeTableHost');

        const paint = () => {
            const rows = filterFlanges(stdSelect.value, search.value);
            tableHost.innerHTML = tableHtml(
                ['Nominal', 'OD (mm)', 'PCD (mm)', 'Bolts', 'Hole Ø (mm)', 'Bolt size'],
                rows.map(r => [r.nb, r.od, r.pcd, r.bolts, `Ø${r.hole}`, r.bolt]),
            );
        };
        stdSelect.addEventListener('change', paint);
        search.addEventListener('input', paint);
        paint();
    }

    function setActiveTool(tool) {
        _activeTool = tool || 'catalog';
        document.querySelectorAll('[data-tool-tab]').forEach(btn => {
            const active = btn.dataset.toolTab === _activeTool;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('[data-tool-panel]').forEach(panel => {
            const show = panel.dataset.toolPanel === _activeTool;
            panel.classList.toggle('hidden', !show);
            panel.classList.toggle('store-panel-active', show);
        });
        document.body.className = document.body.className
            .replace(/store-tool-\w+/g, '')
            .trim();
        document.body.classList.add(`store-tool-${_activeTool}`);
        if (!document.body.classList.contains('store-public-body')) {
            document.body.classList.add('store-public-body');
        }
    }

    function init() {
        const nav = document.getElementById('storePublicToolkit');
        if (!nav) return;

        nav.querySelectorAll('[data-tool-tab]').forEach(btn => {
            btn.addEventListener('click', () => setActiveTool(btn.dataset.toolTab));
        });

        const hosts = {
            bunker: document.getElementById('storeToolBunker'),
            lube: document.getElementById('storeToolLube'),
            paint: document.getElementById('storeToolPaint'),
            engineering: document.getElementById('storeToolEngineering'),
        };
        if (hosts.bunker) renderBunkerPanel(hosts.bunker);
        if (hosts.lube) renderLubePanel(hosts.lube);
        if (hosts.paint) renderPaintPanel(hosts.paint);
        if (hosts.engineering) renderEngineeringPanel(hosts.engineering);
        setActiveTool('catalog');
    }

    return {
        init,
        setActiveTool,
        calcVolumeToMt,
        calcBunkerMassAstM54B,
        filterFlanges,
    };
})();
