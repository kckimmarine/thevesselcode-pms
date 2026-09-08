/* THE VESSEL CODE — Maritime Toolkit (public utilities) */
const TVC_MaritimeToolkit = (function () {
    const DATA = typeof TVC_MaritimeToolkitData !== 'undefined' ? TVC_MaritimeToolkitData : {};
    const FLANGE_ROWS = DATA.FLANGE_ROWS || [];
    const LUB_OIL_ROWS = DATA.LUB_OIL_ROWS || [];
    const PAINT_ROWS = DATA.PAINT_ROWS || [];

    const FUEL_TYPES = {
        VLSFO: { label: 'VLSFO (0.50% S)', defaultDensity: 991 },
        LSMGO: { label: 'LSMGO / MGO', defaultDensity: 850 },
        HFO: { label: 'HFO / VLSHFO', defaultDensity: 980 },
    };

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

    function calcBunkerMassAstM54B(volume, density15, tempC, fuelKey) {
        if (DATA.calcBunkerMassAstM54B) {
            return DATA.calcBunkerMassAstM54B(volume, density15, tempC);
        }
        const vObs = Math.max(0, Number(volume) || 0);
        const rho15 = Math.max(0, Number(density15) || 0);
        if (!vObs || !rho15) return { mt: 0, v15: 0, rho15, vcf: 1, alpha: 0 };
        const v15 = vObs;
        return { mt: (v15 * rho15) / 1000, v15, rho15, vcf: 1, alpha: 0 };
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

    function lubeCategories() {
        return [...new Set(LUB_OIL_ROWS.map(r => r.category))];
    }

    function renderBunkerPanel(host) {
        const fuelOptions = Object.entries(FUEL_TYPES).map(([k, v]) =>
            `<option value="${k}">${esc(v.label)}</option>`).join('');
        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">⛽ Bunker &amp; Fuel Calculator</h2>
                <p class="maritime-panel-sub">Volume to metric tons using ASTM Table 54B temperature correction to 15°C (density-based α).</p>
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
                    <span>Density at 15°C (kg/m³)</span>
                    <input type="number" id="bunkerDensity" min="700" max="1100" step="0.1" value="991" inputmode="decimal">
                </label>
                <label class="maritime-field">
                    <span>Observed temperature (°C)</span>
                    <input type="number" id="bunkerTemp" step="0.1" value="40" inputmode="decimal">
                </label>
            </form>
            <div class="maritime-bunker-result" id="bunkerResult" aria-live="polite">
                <div class="maritime-bunker-metrics">
                    <div><span>Mass (MT)</span><strong id="bunkerMassValue">—</strong></div>
                    <div><span>Vol @ 15°C (m³)</span><strong id="bunkerV15Value">—</strong></div>
                    <div><span>VCF (Table 54B)</span><strong id="bunkerVcfValue">—</strong></div>
                    <div><span>α @ 15°C</span><strong id="bunkerAlphaValue">—</strong></div>
                </div>
            </div>
            <p class="maritime-note">ASTM Table 54B: VCF = exp(−α·ΔT·(1 + 0.8·α·ΔT)); V<sub>15</sub> = V<sub>obs</sub> × VCF; MT = V<sub>15</sub> × ρ<sub>15</sub> ÷ 1000. Verify with shore lab before commercial settlement.</p>`;

        const form = host.querySelector('#bunkerCalcForm');
        const fuelSelect = host.querySelector('#bunkerFuelType');
        const paint = () => {
            const fuelKey = fuelSelect.value;
            const vol = host.querySelector('#bunkerVolume')?.value;
            const den = host.querySelector('#bunkerDensity')?.value;
            const temp = host.querySelector('#bunkerTemp')?.value;
            const result = calcBunkerMassAstM54B(vol, den, temp, fuelKey);
            host.querySelector('#bunkerMassValue').textContent = `${result.mt.toFixed(3)} MT`;
            host.querySelector('#bunkerV15Value').textContent = result.v15.toFixed(3);
            host.querySelector('#bunkerVcfValue').textContent = result.vcf.toFixed(5);
            host.querySelector('#bunkerAlphaValue').textContent = result.alpha.toExponential(4);
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
        const catOptions = lubeCategories().map(c =>
            `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">🛢️ Lubricant Cross-Reference</h2>
                <p class="maritime-panel-sub">Compare cylinder, system, hydraulic, gear, turbine, and compressor oil grades across Shell, Mobil, Castrol, and Total.</p>
            </div>
            <div class="maritime-flange-controls">
                <label class="maritime-field">
                    <span>Category</span>
                    <select id="lubeCategoryFilter">
                        <option value="">All categories</option>
                        ${catOptions}
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
                <p class="maritime-panel-sub">Antifouling, anticorrosive, epoxy, boottop, and topcoat equivalents across Chugoku, Jotun, Hempel, and International.</p>
            </div>
            <div class="maritime-flange-controls">
                <label class="maritime-field">
                    <span>Coating type</span>
                    <select id="paintTypeFilter">
                        <option value="">All types</option>
                        <option value="Antifouling">Antifouling (A/F)</option>
                        <option value="Boottop">Boottop / Waterline</option>
                        <option value="Anticorrosive">Anticorrosive (A/C)</option>
                        <option value="Epoxy">Epoxy Primer</option>
                        <option value="Topcoat">Topcoat</option>
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
                if (type === 'Boottop' && !r.type.includes('Boottop')) return false;
                if (type === 'Anticorrosive' && !r.type.includes('Anticorrosive')) return false;
                if (type === 'Epoxy' && !r.type.includes('Epoxy')) return false;
                if (type === 'Topcoat' && !r.type.includes('Topcoat')) return false;
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
                <p class="maritime-panel-sub">JIS B2220 (5K / 10K / 16K), DIN PN16, and ANSI 150# pipe flange dimensions.</p>
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
            <p class="maritime-note">Dimensions in millimetres (JIS B2220 per wermac.org reference). Verify against yard drawing / class certificate before procurement.</p>`;

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
