/* THE VESSEL CODE — Maritime mini-toolkit (public catalog) */
const TVC_MaritimeToolkit = (function () {
    const FLANGE_ROWS = [
        { standard: 'JIS 5K', nb: '15A', od: 80, pcd: 55, bolts: 4, hole: 12 },
        { standard: 'JIS 5K', nb: '20A', od: 85, pcd: 60, bolts: 4, hole: 12 },
        { standard: 'JIS 5K', nb: '25A', od: 95, pcd: 70, bolts: 4, hole: 12 },
        { standard: 'JIS 5K', nb: '32A', od: 100, pcd: 75, bolts: 4, hole: 15 },
        { standard: 'JIS 5K', nb: '40A', od: 105, pcd: 80, bolts: 4, hole: 15 },
        { standard: 'JIS 5K', nb: '50A', od: 120, pcd: 95, bolts: 4, hole: 15 },
        { standard: 'JIS 5K', nb: '65A', od: 140, pcd: 115, bolts: 4, hole: 19 },
        { standard: 'JIS 5K', nb: '80A', od: 150, pcd: 125, bolts: 8, hole: 19 },
        { standard: 'JIS 5K', nb: '100A', od: 175, pcd: 145, bolts: 8, hole: 19 },
        { standard: 'JIS 5K', nb: '125A', od: 200, pcd: 175, bolts: 8, hole: 19 },
        { standard: 'JIS 5K', nb: '150A', od: 225, pcd: 200, bolts: 8, hole: 19 },
        { standard: 'JIS 10K', nb: '15A', od: 95, pcd: 70, bolts: 4, hole: 15 },
        { standard: 'JIS 10K', nb: '20A', od: 100, pcd: 75, bolts: 4, hole: 15 },
        { standard: 'JIS 10K', nb: '25A', od: 125, pcd: 90, bolts: 4, hole: 19 },
        { standard: 'JIS 10K', nb: '32A', od: 135, pcd: 100, bolts: 4, hole: 19 },
        { standard: 'JIS 10K', nb: '40A', od: 140, pcd: 105, bolts: 4, hole: 19 },
        { standard: 'JIS 10K', nb: '50A', od: 155, pcd: 120, bolts: 8, hole: 19 },
        { standard: 'JIS 10K', nb: '65A', od: 175, pcd: 140, bolts: 8, hole: 19 },
        { standard: 'JIS 10K', nb: '80A', od: 185, pcd: 150, bolts: 8, hole: 19 },
        { standard: 'JIS 10K', nb: '100A', od: 210, pcd: 175, bolts: 8, hole: 19 },
        { standard: 'JIS 10K', nb: '125A', od: 250, pcd: 210, bolts: 8, hole: 23 },
        { standard: 'JIS 10K', nb: '150A', od: 280, pcd: 240, bolts: 8, hole: 23 },
        { standard: 'DIN PN16', nb: 'DN15', od: 95, pcd: 65, bolts: 4, hole: 14 },
        { standard: 'DIN PN16', nb: 'DN20', od: 105, pcd: 75, bolts: 4, hole: 14 },
        { standard: 'DIN PN16', nb: 'DN25', od: 115, pcd: 85, bolts: 4, hole: 14 },
        { standard: 'DIN PN16', nb: 'DN32', od: 140, pcd: 100, bolts: 4, hole: 18 },
        { standard: 'DIN PN16', nb: 'DN40', od: 150, pcd: 110, bolts: 4, hole: 18 },
        { standard: 'DIN PN16', nb: 'DN50', od: 165, pcd: 125, bolts: 4, hole: 18 },
        { standard: 'DIN PN16', nb: 'DN65', od: 185, pcd: 145, bolts: 8, hole: 18 },
        { standard: 'DIN PN16', nb: 'DN80', od: 200, pcd: 160, bolts: 8, hole: 18 },
        { standard: 'DIN PN16', nb: 'DN100', od: 220, pcd: 180, bolts: 8, hole: 18 },
        { standard: 'DIN PN16', nb: 'DN125', od: 250, pcd: 210, bolts: 8, hole: 18 },
        { standard: 'DIN PN16', nb: 'DN150', od: 285, pcd: 240, bolts: 8, hole: 22 },
        { standard: 'ANSI 150#', nb: '1/2"', od: 89, pcd: 60, bolts: 4, hole: 16 },
        { standard: 'ANSI 150#', nb: '3/4"', od: 98, pcd: 70, bolts: 4, hole: 16 },
        { standard: 'ANSI 150#', nb: '1"', od: 108, pcd: 79, bolts: 4, hole: 16 },
        { standard: 'ANSI 150#', nb: '1-1/2"', od: 127, pcd: 98, bolts: 4, hole: 16 },
        { standard: 'ANSI 150#', nb: '2"', od: 152, pcd: 121, bolts: 4, hole: 19 },
        { standard: 'ANSI 150#', nb: '3"', od: 190, pcd: 152, bolts: 4, hole: 19 },
        { standard: 'ANSI 150#', nb: '4"', od: 229, pcd: 190, bolts: 8, hole: 19 },
        { standard: 'ANSI 150#', nb: '6"', od: 280, pcd: 241, bolts: 8, hole: 22 },
        { standard: 'ANSI 150#', nb: '8"', od: 343, pcd: 298, bolts: 8, hole: 22 },
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

    function flangeTableHtml(rows) {
        if (!rows.length) {
            return '<p class="maritime-empty">No flange sizes match your filter.</p>';
        }
        const body = rows.map(row => `
            <tr>
                <td>${esc(row.nb)}</td>
                <td>${row.od}</td>
                <td>${row.pcd}</td>
                <td>${row.bolts}</td>
                <td>Ø${row.hole}</td>
            </tr>`).join('');
        return `
            <div class="maritime-table-wrap">
                <table class="maritime-table">
                    <thead>
                        <tr>
                            <th>Nominal</th>
                            <th>OD (mm)</th>
                            <th>PCD (mm)</th>
                            <th>Bolts</th>
                            <th>Hole (mm)</th>
                        </tr>
                    </thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
    }

    function renderFlangePanel(host) {
        const stdOptions = standards().map(s =>
            `<option value="${esc(s)}">${esc(s)}</option>`).join('');
        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">📐 Pipe Flange Dimension Table</h2>
                <p class="maritime-panel-sub">Quick lookup for JIS, DIN, and ANSI raised-face flanges (reference values).</p>
            </div>
            <div class="maritime-flange-controls">
                <label class="maritime-field">
                    <span>Standard</span>
                    <select id="flangeStandardSelect">${stdOptions}</select>
                </label>
                <label class="maritime-field maritime-field-grow">
                    <span>Filter nominal size</span>
                    <input type="search" id="flangeSizeSearch" placeholder="e.g. 50A, DN80, 4&quot;" autocomplete="off">
                </label>
            </div>
            <div id="flangeTableHost"></div>
            <p class="maritime-note">Dimensions in millimetres. Verify against class certificate / yard drawing before procurement.</p>`;

        const stdSelect = host.querySelector('#flangeStandardSelect');
        const search = host.querySelector('#flangeSizeSearch');
        const tableHost = host.querySelector('#flangeTableHost');

        const paint = () => {
            const rows = filterFlanges(stdSelect.value, search.value);
            tableHost.innerHTML = flangeTableHtml(rows);
        };

        stdSelect.addEventListener('change', paint);
        search.addEventListener('input', paint);
        paint();
    }

    function calcBunkerMass(volume, density, tempC) {
        const v = Math.max(0, Number(volume) || 0);
        const rho = Math.max(0, Number(density) || 0);
        const t = Number(tempC);
        let corrected = rho;
        if (Number.isFinite(t) && t !== 15) {
            corrected = rho * (1 - 0.00065 * (t - 15));
        }
        return (v * corrected) / 1000;
    }

    function renderBunkerPanel(host) {
        host.innerHTML = `
            <div class="maritime-panel-head">
                <h2 class="maritime-panel-title">⛽ Bunker Mass Calculator</h2>
                <p class="maritime-panel-sub">Convert tank volume to metric tons using observed density (VLSFO / MGO).</p>
            </div>
            <form class="maritime-bunker-form" id="bunkerCalcForm">
                <label class="maritime-field">
                    <span>Volume (m³)</span>
                    <input type="number" id="bunkerVolume" min="0" step="0.001" value="100" inputmode="decimal">
                </label>
                <label class="maritime-field">
                    <span>Density @ 15°C (kg/m³)</span>
                    <input type="number" id="bunkerDensity" min="800" max="1100" step="0.1" value="991" inputmode="decimal">
                </label>
                <label class="maritime-field">
                    <span>Observed temp (°C)</span>
                    <input type="number" id="bunkerTemp" step="0.1" value="15" inputmode="decimal">
                </label>
            </form>
            <div class="maritime-bunker-result" id="bunkerResult" aria-live="polite">
                <span class="maritime-bunker-label">Estimated mass</span>
                <strong class="maritime-bunker-value" id="bunkerMassValue">99.10 MT</strong>
            </div>
            <p class="maritime-note">Formula: MT = Volume × Density<sub>15°C</sub> ÷ 1000 (with simple temperature correction).</p>`;

        const form = host.querySelector('#bunkerCalcForm');
        const massEl = host.querySelector('#bunkerMassValue');
        const paint = () => {
            const vol = host.querySelector('#bunkerVolume')?.value;
            const den = host.querySelector('#bunkerDensity')?.value;
            const temp = host.querySelector('#bunkerTemp')?.value;
            const mt = calcBunkerMass(vol, den, temp);
            massEl.textContent = `${mt.toFixed(2)} MT`;
        };
        form.addEventListener('input', paint);
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
            panel.classList.toggle('hidden', panel.dataset.toolPanel !== _activeTool);
        });
        document.body.classList.toggle('store-tool-catalog', _activeTool === 'catalog');
        document.body.classList.toggle('store-tool-flange', _activeTool === 'flange');
        document.body.classList.toggle('store-tool-bunker', _activeTool === 'bunker');
    }

    function init() {
        const nav = document.getElementById('storePublicToolkit');
        if (!nav) return;

        nav.querySelectorAll('[data-tool-tab]').forEach(btn => {
            btn.addEventListener('click', () => setActiveTool(btn.dataset.toolTab));
        });

        const flangeHost = document.getElementById('storeToolFlange');
        const bunkerHost = document.getElementById('storeToolBunker');
        if (flangeHost) renderFlangePanel(flangeHost);
        if (bunkerHost) renderBunkerPanel(bunkerHost);
        setActiveTool('catalog');
    }

    return { init, setActiveTool, calcBunkerMass, filterFlanges };
})();
