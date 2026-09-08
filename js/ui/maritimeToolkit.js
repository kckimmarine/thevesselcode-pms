/* THE VESSEL CODE — Maritime Toolkit (public utilities) */
const TVC_MaritimeToolkit = (function () {
    const DATA = typeof TVC_MaritimeToolkitData !== 'undefined' ? TVC_MaritimeToolkitData : {};
    const FLANGE_ROWS = DATA.FLANGE_ROWS || [];
    const LUB_OIL_ROWS = DATA.LUB_OIL_ROWS || [];
    const PAINT_ROWS = DATA.PAINT_ROWS || [];
    const PSC_GUARD_ROWS = DATA.PSC_GUARD_ROWS || [];
    const GASKET_REF_ROWS = DATA.GASKET_REF_ROWS || [];
    const PACKING_REF_ROWS = DATA.PACKING_REF_ROWS || [];
    const FUEL_TYPES = DATA.FUEL_TYPES || {
        VLSFO: { label: 'VLSFO 0.5% S', defaultDensity: 991, co2Factor: 3.151 },
        LSMGO: { label: 'LSMGO 0.1% S', defaultDensity: 865, co2Factor: 3.206 },
        HSFO: { label: 'HSFO 380', defaultDensity: 980, co2Factor: 3.151 },
    };
    const FLANGE_STANDARDS = DATA.FLANGE_STANDARDS || [...new Set(FLANGE_ROWS.map(r => r.standard))];

    let _activeTool = 'catalog';

    function esc(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function filterFlanges(standard, sizeKey) {
        return FLANGE_ROWS.filter(row => {
            if (row.standard !== standard) return false;
            if (!sizeKey) return true;
            return row.nb === sizeKey || row.sizeLabel === sizeKey;
        });
    }

    function calcBunkerMassAstM54B(volume, density15, tempC, fuelKey) {
        if (DATA.calculateBunkerMetric) {
            const r = DATA.calculateBunkerMetric({
                fuelType: fuelKey || 'VLSFO',
                tempC,
                density15,
                volumeM3: volume,
                inputMode: 'volume',
            });
            return { mt: r.mt, v15: r.v15, rho15: Number(density15) || 0, vcf: r.vcf, alpha: r.alpha };
        }
        const vObs = Math.max(0, Number(volume) || 0);
        const rho15 = Math.max(0, Number(density15) || 0);
        if (!vObs || !rho15) return { mt: 0, v15: 0, rho15, vcf: 1, alpha: 0 };
        return { mt: (vObs * rho15) / 1000, v15: vObs, rho15, vcf: 1, alpha: 0 };
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

    function flangeSizeOptions(standard) {
        const sizes = DATA.flangeSizesForStandard
            ? DATA.flangeSizesForStandard(standard, 300)
            : FLANGE_ROWS.filter(r => r.standard === standard);
        return sizes.map(r => ({
            key: r.nb,
            label: r.sizeLabel || r.nb,
        }));
    }

    function renderBunkerPanel(host) {
        const fuelOptions = Object.entries(FUEL_TYPES).map(([k, v]) =>
            `<option value="${k}">${esc(v.label)}</option>`).join('');
        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">⛽ Bunker &amp; Fuel Calculator</h2>
                <p class="maritime-panel-sub">ASTM Table 54B volume correction, weight-in-air mass, and estimated CO₂ emission (IMO conversion factors).</p>
            </div>
            <form class="maritime-bunker-form" id="bunkerCalcForm">
                <label class="maritime-field">
                    <span>Fuel grade</span>
                    <select id="bunkerFuelType" title="Select fuel grade for default density and CO₂ factor">${fuelOptions}</select>
                </label>
                <label class="maritime-field">
                    <span>Input mode</span>
                    <select id="bunkerInputMode" title="Calculate from observed volume or target mass">
                        <option value="volume">Observed volume (m³)</option>
                        <option value="mass">Target mass (MT)</option>
                    </select>
                </label>
                <label class="maritime-field" id="bunkerVolumeField">
                    <span>Observed volume (m³)</span>
                    <input type="number" id="bunkerVolume" min="0" step="0.001" value="500" inputmode="decimal" title="Gross observed volume at tank temperature">
                </label>
                <label class="maritime-field hidden" id="bunkerMassField">
                    <span>Target mass (MT in air)</span>
                    <input type="number" id="bunkerMass" min="0" step="0.001" value="487" inputmode="decimal" title="Commercial mass in air">
                </label>
                <label class="maritime-field">
                    <span>Density at 15°C (kg/m³)</span>
                    <input type="number" id="bunkerDensity" min="700" max="1100" step="0.1" value="991" inputmode="decimal" title="Laboratory density at 15°C reference">
                </label>
                <label class="maritime-field">
                    <span>Observed temperature (°C)</span>
                    <input type="number" id="bunkerTemp" step="0.1" value="40" inputmode="decimal" title="Cargo / tank temperature at measurement">
                </label>
            </form>
            <div class="maritime-bunker-result" id="bunkerResult" aria-live="polite">
                <div class="maritime-bunker-metrics">
                    <div><span>Mass in air (MT)</span><strong id="bunkerMassValue">—</strong></div>
                    <div><span>Vol @ 15°C (m³)</span><strong id="bunkerV15Value">—</strong></div>
                    <div><span>VCF (Table 54B)</span><strong id="bunkerVcfValue">—</strong></div>
                    <div><span>Density @ obs. temp (kg/m³)</span><strong id="bunkerRhoObsValue">—</strong></div>
                    <div><span>α @ 15°C</span><strong id="bunkerAlphaValue">—</strong></div>
                    <div><span>Est. CO₂ (MT)</span><strong id="bunkerCo2Value">—</strong></div>
                </div>
            </div>
            <p class="maritime-note">VCF = exp(−α·ΔT·(1 + 0.8·α·ΔT)); weight-in-air uses ρ<sub>obs</sub> − 1.1 kg/m³ buoyancy correction. CO₂ factors: VLSFO/HSFO 3.151, LSMGO 3.206 t-CO₂/t-fuel (IMO). Verify with shore lab before commercial settlement.</p>`;

        const form = host.querySelector('#bunkerCalcForm');
        const fuelSelect = host.querySelector('#bunkerFuelType');
        const modeSelect = host.querySelector('#bunkerInputMode');
        const volField = host.querySelector('#bunkerVolumeField');
        const massField = host.querySelector('#bunkerMassField');

        const paint = () => {
            const fuelKey = fuelSelect.value;
            const inputMode = modeSelect.value;
            const den = host.querySelector('#bunkerDensity')?.value;
            const temp = host.querySelector('#bunkerTemp')?.value;
            const vol = host.querySelector('#bunkerVolume')?.value;
            const mass = host.querySelector('#bunkerMass')?.value;

            const result = DATA.calculateBunkerMetric
                ? DATA.calculateBunkerMetric({ fuelType: fuelKey, tempC: temp, density15: den, volumeM3: vol, massMt: mass, inputMode })
                : calcBunkerMassAstM54B(vol, den, temp, fuelKey);

            host.querySelector('#bunkerMassValue').textContent = `${result.mt.toFixed(3)} MT`;
            host.querySelector('#bunkerV15Value').textContent = result.v15.toFixed(3);
            host.querySelector('#bunkerVcfValue').textContent = result.vcf.toFixed(5);
            host.querySelector('#bunkerRhoObsValue').textContent = (result.rhoObs || 0).toFixed(2);
            host.querySelector('#bunkerAlphaValue').textContent = result.alpha.toExponential(4);
            host.querySelector('#bunkerCo2Value').textContent = result.co2Mt != null
                ? `${result.co2Mt.toFixed(2)} MT`
                : '—';
        };

        modeSelect.addEventListener('change', () => {
            const isMass = modeSelect.value === 'mass';
            volField.classList.toggle('hidden', isMass);
            massField.classList.toggle('hidden', !isMass);
            paint();
        });

        fuelSelect.addEventListener('change', () => {
            const fuel = FUEL_TYPES[fuelSelect.value];
            if (fuel?.defaultDensity) {
                host.querySelector('#bunkerDensity').value = String(fuel.defaultDensity);
            }
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
                <h2 class="maritime-panel-title">🛢️ Marine Lub-Oil Cross-Reference</h2>
                <p class="maritime-panel-sub">Searchable matrix across Shell, ExxonMobil, Castrol, and TotalEnergies — cylinder, system, TPEO, hydraulic, compressor, and refrigeration grades.</p>
            </div>
            <div class="maritime-flange-controls">
                <label class="maritime-field">
                    <span>Category</span>
                    <select id="lubeCategoryFilter" title="Filter by lubricant application">
                        <option value="">All categories</option>
                        ${catOptions}
                    </select>
                </label>
                <label class="maritime-field maritime-field-grow">
                    <span>Search brand, product, or viscosity / BN</span>
                    <input type="search" id="lubeSearch" placeholder="e.g. BN 40, Mobilgard, Tellus, TPEO" autocomplete="off" title="Keyword search across all makers">
                </label>
            </div>
            <div id="lubeTableHost"></div>
            <p class="maritime-note">Reference equivalents for procurement — always confirm OEM / maker approval and lube analysis before change-over.</p>`;

        const catFilter = host.querySelector('#lubeCategoryFilter');
        const search = host.querySelector('#lubeSearch');
        const tableHost = host.querySelector('#lubeTableHost');

        const paint = () => {
            const cat = catFilter.value;
            const q = (search.value || '').trim().toLowerCase();
            const rows = LUB_OIL_ROWS.filter(r => {
                if (cat && r.category !== cat) return false;
                if (!q) return true;
                const hay = [r.category, r.specs, r.shell, r.mobil, r.castrol, r.total].join(' ').toLowerCase();
                return hay.includes(q);
            });
            tableHost.innerHTML = tableHtml(
                ['Category', 'Specification', 'Shell', 'ExxonMobil', 'Castrol', 'TotalEnergies'],
                rows.map(r => [r.category, r.specs, r.shell, r.mobil, r.castrol, r.total]),
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
        const stdOptions = FLANGE_STANDARDS.map(s =>
            `<option value="${esc(s)}">${esc(s)}</option>`).join('');
        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">📐 Piping &amp; Flange Lookup</h2>
                <p class="maritime-panel-sub">JIS B2220 (5K / 10K / 16K), ANSI 150#, and DIN PN10/PN16 — instant dimensional lookup for 15A (1/2&quot;) to 300A (12&quot;).</p>
            </div>
            <div class="maritime-flange-controls">
                <label class="maritime-field">
                    <span>Flange standard</span>
                    <select id="flangeStandardSelect" title="Select piping flange standard">${stdOptions}</select>
                </label>
                <label class="maritime-field maritime-field-grow">
                    <span>Nominal bore</span>
                    <select id="flangeSizeSelect" title="Select nominal pipe size">
                        <option value="">All sizes (table)</option>
                    </select>
                </label>
            </div>
            <div id="flangeTableHost"></div>
            <div class="maritime-ref-cards">
                <div class="maritime-ref-card">
                    <h3 class="maritime-ref-card-title">Gasket Quick Reference</h3>
                    <div id="gasketRefHost"></div>
                </div>
                <div class="maritime-ref-card">
                    <h3 class="maritime-ref-card-title">Packing Quick Reference</h3>
                    <div id="packingRefHost"></div>
                </div>
            </div>
            <p class="maritime-note">Dimensions in millimetres (JIS B2220 per industry reference tables). Verify against yard drawing / class certificate before procurement.</p>`;

        const stdSelect = host.querySelector('#flangeStandardSelect');
        const sizeSelect = host.querySelector('#flangeSizeSelect');
        const tableHost = host.querySelector('#flangeTableHost');

        const refillSizes = () => {
            const sizes = flangeSizeOptions(stdSelect.value);
            sizeSelect.innerHTML = '<option value="">All sizes (table)</option>'
                + sizes.map(s => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('');
        };

        const paintGasketCards = () => {
            host.querySelector('#gasketRefHost').innerHTML = tableHtml(
                ['Gasket type', 'Material', 'Temp range', 'Typical service'],
                GASKET_REF_ROWS.map(r => [r.type, r.material, r.temp, r.service]),
            );
            host.querySelector('#packingRefHost').innerHTML = tableHtml(
                ['Packing type', 'Material', 'Typical service'],
                PACKING_REF_ROWS.map(r => [r.type, r.material, r.service]),
            );
        };

        const paint = () => {
            const sizeKey = sizeSelect.value;
            const rows = filterFlanges(stdSelect.value, sizeKey);
            const displayRows = sizeKey && rows.length === 1 ? rows : rows;
            tableHost.innerHTML = tableHtml(
                ['Nominal size (DN / inch)', 'OD (mm)', 'PCD (mm)', 'Bolt holes', 'Hole Ø (mm)', 'Bolt spec'],
                displayRows.map(r => [
                    r.sizeLabel || r.nb, r.od, r.pcd, r.bolts, `Ø${r.hole}`, r.bolt,
                ]),
            );
        };

        stdSelect.addEventListener('change', () => { refillSizes(); paint(); });
        sizeSelect.addEventListener('change', paint);
        refillSizes();
        paintGasketCards();
        paint();
    }

    function renderPscGuardPanel(host) {
        const cards = PSC_GUARD_ROWS.map(item => `
            <article class="maritime-psc-card" id="psc-${esc(item.id)}">
                <header class="maritime-psc-card-head">
                    <h3 class="maritime-psc-card-title">${esc(item.title)}</h3>
                    <span class="maritime-psc-mou">${esc(item.mou)}</span>
                </header>
                <p class="maritime-psc-focus"><strong>Inspection focus:</strong> ${esc(item.focus)}</p>
                <ul class="maritime-psc-checks">
                    ${item.checks.map(c => `<li>${esc(c)}</li>`).join('')}
                </ul>
                <p class="maritime-psc-accept"><strong>Acceptance criteria:</strong> ${esc(item.acceptance)}</p>
            </article>`).join('');

        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">🛡️ Class &amp; PSC Guard</h2>
                <p class="maritime-panel-sub">High-priority inspection matrix for Tokyo MoU and Paris MoU Concentrated Inspection Campaign (CIC) topics.</p>
            </div>
            <div class="maritime-psc-grid">${cards}</div>
            <p class="maritime-note">Reference checklist for shipboard preparation — not a substitute for flag / class statutory requirements. Cross-check with current MoU circulars.</p>`;
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
            bunker: document.getElementById('tab-bunker') || document.getElementById('storeToolBunker'),
            lube: document.getElementById('tab-luboil') || document.getElementById('storeToolLube'),
            paint: document.getElementById('storeToolPaint'),
            engineering: document.getElementById('tab-flange') || document.getElementById('storeToolEngineering'),
            psc: document.getElementById('tab-psc-guard') || document.getElementById('storeToolPscGuard'),
        };
        if (hosts.bunker) renderBunkerPanel(hosts.bunker);
        if (hosts.lube) renderLubePanel(hosts.lube);
        if (hosts.paint) renderPaintPanel(hosts.paint);
        if (hosts.engineering) renderEngineeringPanel(hosts.engineering);
        if (hosts.psc) renderPscGuardPanel(hosts.psc);
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
