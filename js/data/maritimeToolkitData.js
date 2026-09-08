/* THE VESSEL CODE — Maritime Toolkit reference datasets (production-grade) */
const TVC_MaritimeToolkitData = (function () {
    const JIS_INCH = {
        10: '3/8"', 15: '1/2"', 20: '3/4"', 25: '1"', 32: '1-1/4"', 40: '1-1/2"',
        50: '2"', 65: '2-1/2"', 80: '3"', 90: '3-1/2"', 100: '4"', 125: '5"',
        150: '6"', 175: '7"', 200: '8"', 225: '9"', 250: '10"', 300: '12"',
        350: '14"', 400: '16"', 450: '18"', 500: '20"', 550: '22"', 600: '24"',
        650: '26"', 700: '28"', 750: '30"', 800: '32"', 850: '34"', 900: '36"', 1000: '40"',
    };

    function boltFromHole(hole) {
        const map = {
            11: 'M10', 12: 'M10', 14: 'M12', 15: 'M12', 16: 'M14', 18: 'M16',
            19: 'M16', 22: 'M20', 23: 'M20', 25: 'M22', 26: 'M24', 27: 'M24',
            33: 'M30', 39: 'M36', 42: 'M39', 48: 'M45', 56: 'M52',
        };
        return map[hole] || `Ø${hole}`;
    }

    function jisRow(standard, nbMm, od, pcd, bolts, hole) {
        const inch = JIS_INCH[nbMm] || '';
        const nb = `${nbMm}A`;
        const sizeLabel = inch ? `${nb} (${inch})` : nb;
        return { standard, nb, sizeLabel, od, pcd, bolts, hole, bolt: boltFromHole(hole) };
    }

    function dinRow(standard, dn, od, pcd, bolts, hole) {
        const nb = `DN${dn}`;
        const inch = JIS_INCH[dn] || '';
        const sizeLabel = inch ? `${nb} (${inch})` : nb;
        return { standard, nb, sizeLabel, od, pcd, bolts, hole, bolt: boltFromHole(hole) };
    }

    const JIS_5K = [
        [10, 75, 55, 4, 12], [15, 80, 60, 4, 12], [20, 85, 65, 4, 12], [25, 95, 75, 4, 12],
        [32, 115, 90, 4, 15], [40, 120, 95, 4, 15], [50, 130, 105, 4, 15], [65, 155, 130, 4, 15],
        [80, 180, 145, 4, 19], [90, 190, 155, 4, 19], [100, 200, 165, 8, 19], [125, 235, 200, 8, 19],
        [150, 265, 230, 8, 19], [175, 300, 260, 8, 23], [200, 320, 280, 8, 23], [225, 345, 305, 12, 23],
        [250, 385, 345, 12, 23], [300, 430, 390, 12, 23], [350, 480, 435, 12, 25], [400, 540, 495, 16, 25],
        [450, 605, 555, 16, 25], [500, 655, 605, 20, 25], [550, 720, 665, 20, 27], [600, 770, 715, 20, 27],
        [650, 825, 770, 24, 27], [700, 875, 820, 24, 27], [750, 945, 880, 24, 33], [800, 995, 930, 24, 33],
        [850, 1045, 980, 24, 33], [900, 1095, 1030, 24, 33], [1000, 1195, 1130, 28, 33],
    ].map(([nb, od, pcd, bolts, hole]) => jisRow('JIS 5K', nb, od, pcd, bolts, hole));

    const JIS_10K = [
        [10, 90, 65, 4, 15], [15, 95, 70, 4, 15], [20, 100, 75, 4, 15], [25, 110, 90, 4, 19],
        [32, 135, 100, 4, 19], [40, 140, 105, 4, 19], [50, 155, 120, 4, 19], [65, 175, 140, 4, 19],
        [80, 185, 150, 8, 19], [90, 195, 160, 8, 19], [100, 210, 175, 8, 19], [125, 230, 210, 8, 23],
        [150, 280, 240, 8, 23], [175, 300, 270, 8, 23], [200, 330, 290, 12, 23], [225, 350, 310, 12, 25],
        [250, 400, 355, 12, 25], [300, 445, 410, 12, 25], [350, 490, 445, 16, 25], [400, 520, 515, 16, 27],
        [450, 570, 565, 20, 27], [500, 675, 620, 20, 27], [550, 745, 680, 24, 33], [600, 795, 730, 24, 33],
        [650, 845, 780, 24, 33], [700, 905, 840, 24, 33], [750, 970, 900, 24, 33], [800, 1020, 950, 24, 33],
        [850, 1070, 1000, 28, 33], [900, 1120, 1050, 28, 33], [1000, 1235, 1160, 28, 39],
    ].map(([nb, od, pcd, bolts, hole]) => jisRow('JIS 10K', nb, od, pcd, bolts, hole));

    const JIS_16K = [
        [10, 90, 65, 4, 15], [15, 95, 70, 4, 15], [20, 100, 75, 4, 15], [25, 125, 90, 4, 19],
        [32, 135, 100, 4, 19], [40, 140, 105, 4, 19], [50, 155, 120, 8, 19], [65, 175, 140, 8, 19],
        [80, 200, 160, 8, 23], [90, 210, 170, 8, 23], [100, 225, 185, 8, 23], [125, 270, 225, 8, 25],
        [150, 305, 260, 12, 25], [200, 350, 305, 12, 25], [250, 430, 380, 12, 27], [300, 480, 430, 16, 27],
        [350, 540, 480, 16, 33], [400, 605, 540, 16, 33], [450, 675, 605, 20, 33], [500, 730, 660, 20, 33],
        [550, 795, 720, 20, 39], [600, 845, 770, 24, 39], [650, 895, 820, 24, 39], [700, 960, 875, 24, 42],
        [750, 1020, 935, 24, 42], [800, 1085, 990, 24, 48], [850, 1135, 1040, 24, 48], [900, 1185, 1090, 28, 48],
        [1000, 1320, 1210, 28, 56],
    ].map(([nb, od, pcd, bolts, hole]) => jisRow('JIS 16K', nb, od, pcd, bolts, hole));

    const DIN_PN10 = [
        [15, 95, 65, 4, 11], [20, 105, 75, 4, 11], [25, 115, 85, 4, 14], [32, 140, 100, 4, 18],
        [40, 150, 110, 4, 18], [50, 165, 125, 4, 18], [65, 185, 145, 8, 18], [80, 200, 160, 8, 18],
        [100, 220, 180, 8, 18], [125, 250, 210, 8, 18], [150, 285, 240, 8, 22], [200, 340, 295, 8, 22],
        [250, 400, 350, 12, 26], [300, 455, 400, 12, 26],
    ].map(([dn, od, pcd, bolts, hole]) => dinRow('DIN PN10', dn, od, pcd, bolts, hole));

    const DIN_PN16 = [
        [15, 95, 65, 4, 14], [20, 105, 75, 4, 14], [25, 115, 85, 4, 14], [32, 140, 100, 4, 18],
        [40, 150, 110, 4, 18], [50, 165, 125, 4, 18], [65, 185, 145, 8, 18], [80, 200, 160, 8, 18],
        [100, 220, 180, 8, 18], [125, 250, 210, 8, 18], [150, 285, 240, 8, 22], [200, 340, 295, 12, 22],
        [250, 405, 355, 12, 26], [300, 460, 410, 12, 26],
    ].map(([dn, od, pcd, bolts, hole]) => dinRow('DIN PN16', dn, od, pcd, bolts, hole));

    const ANSI_150 = [
        ['1/2"', 89, 60, 4, 16, '1/2"'], ['3/4"', 98, 70, 4, 16, '1/2"'], ['1"', 108, 79, 4, 16, '1/2"'],
        ['1-1/4"', 117, 89, 4, 16, '5/8"'], ['1-1/2"', 127, 98, 4, 16, '5/8"'], ['2"', 152, 121, 4, 19, '5/8"'],
        ['2-1/2"', 178, 140, 4, 19, '5/8"'], ['3"', 190, 152, 4, 19, '5/8"'], ['4"', 229, 190, 8, 19, '5/8"'],
        ['6"', 280, 241, 8, 22, '3/4"'], ['8"', 343, 298, 8, 22, '3/4"'], ['10"', 406, 362, 12, 25, '7/8"'],
        ['12"', 483, 432, 12, 25, '7/8"'],
    ].map(([nb, od, pcd, bolts, hole, bolt]) => ({
        standard: 'ANSI 150#', nb, sizeLabel: nb, od, pcd, bolts, hole, bolt,
    }));

    const FLANGE_ROWS = [...JIS_5K, ...JIS_10K, ...JIS_16K, ...DIN_PN10, ...DIN_PN16, ...ANSI_150];

    const FLANGE_STANDARDS = ['JIS 5K', 'JIS 10K', 'JIS 16K', 'ANSI 150#', 'DIN PN10', 'DIN PN16'];

    const GASKET_REF_ROWS = [
        { type: 'Compressed Fibre (CAF)', material: 'Aramid / NBR binder', temp: '−30 to 200°C', service: 'General steam, water, fuel oil flanges' },
        { type: 'PTFE Envelope', material: 'PTFE with CAF insert', temp: '−60 to 200°C', service: 'Corrosive chemicals, low clamp load' },
        { type: 'Spiral Wound SS/Graphite', material: '316 SS + flexible graphite filler', temp: '−200 to 550°C', service: 'High-temp steam, exhaust, thermal cycling' },
        { type: 'Ring Joint (RTJ)', material: 'Soft iron / SS oval/octagonal', temp: 'Up to 450°C', service: 'ANSI high-pressure, refinery cargo manifolds' },
        { type: 'Rubber Full-Face', material: 'EPDM / NBR / Neoprene', temp: '−30 to 120°C', service: 'Cooling SW, bilge, low-pressure utility' },
        { type: 'Graphite Sheet', material: 'Expanded graphite foil', temp: 'Up to 450°C', service: 'Exhaust, boiler manholes, high-temp isolation' },
    ];

    const PACKING_REF_ROWS = [
        { type: 'Valve Stem Packing', material: 'Graphite / PTFE', service: 'Globe, gate, butterfly valve stems' },
        { type: 'Pump Gland Packing', material: 'Graphite + PTFE corners', service: 'Centrifugal pump stuffing boxes' },
        { type: 'Manhole Packing', material: 'Graphite rope + anti-extrusion rings', service: 'Boiler / tank manhole covers' },
        { type: 'Lip Seal / Chevron', material: 'NBR / FKM V-packing', service: 'Hydraulic cylinders, stern tube seals' },
    ];

    const LUB_OIL_ROWS = [
        { category: '2-Stroke Cylinder (High BN)', specs: 'SAE 50, BN 100 (for HSFO)', shell: 'Alexia 100', mobil: 'Mobilgard 5100', castrol: 'Cyltech 100', total: 'Talusia Universal 100' },
        { category: '2-Stroke Cylinder (High BN)', specs: 'SAE 50, BN 70', shell: 'Alexia 70', mobil: 'Mobilgard 570', castrol: 'Cyltech 70', total: 'Talusia Universal 70' },
        { category: '2-Stroke Cylinder (Mid BN)', specs: 'SAE 50, BN 40 (for VLSFO 0.5% S)', shell: 'Alexia 40', mobil: 'Mobilgard 540', castrol: 'Cyltech 40SX', total: 'Talusia HR 40' },
        { category: '2-Stroke Cylinder (Low BN)', specs: 'SAE 50, BN 25 (for ultra-low sulphur)', shell: 'Alexia 25', mobil: 'Mobilgard 525', castrol: 'Cyltech 25', total: 'Talusia LS 25' },
        { category: '2-Stroke Cylinder (Bio/EAL)', specs: 'BN 40, VGP compliant EAL', shell: 'Alexia 40 EC', mobil: 'Mobilgard ADL 40', castrol: 'BioStat 100', total: 'Talusia BIO 40' },
        { category: '2-Stroke & 4-Stroke System Oil', specs: 'SAE 30 (Main Engine Crankcase)', shell: 'Melina S 30', mobil: 'Mobilgard 300', castrol: 'CDX 30', total: 'Atlanta Marine D 3005' },
        { category: '2-Stroke & 4-Stroke System Oil', specs: 'SAE 40 (Crosshead / trunk piston)', shell: 'Melina S 40', mobil: 'Mobilgard 340', castrol: 'CDX 40', total: 'Atlanta Marine D 3015' },
        { category: '2-Stroke & 4-Stroke System Oil', specs: 'SAE 50 (High BN system oil)', shell: 'Melina S 50', mobil: 'Mobilgard 350', castrol: 'CDX 50', total: 'Atlanta Marine D 3025' },
        { category: 'Trunk Piston Engine Oil (TPEO)', specs: 'BN 30 (4-stroke ME)', shell: 'Gadinia 30', mobil: 'Mobil Delvac 1300', castrol: 'Cyltech 30', total: 'Aurelia X 300' },
        { category: 'Trunk Piston Engine Oil (TPEO)', specs: 'BN 40 (4-stroke ME / aux)', shell: 'Gadinia 40', mobil: 'Mobil Delvac 1640', castrol: 'Cyltech 40', total: 'Aurelia X 400' },
        { category: 'Trunk Piston Engine Oil (TPEO)', specs: 'BN 50 (high sulphur operation)', shell: 'Gadinia 50', mobil: 'Mobil Delvac 1 SHC', castrol: 'Cyltech 50', total: 'Aurelia X 500' },
        { category: 'Hydraulic Oil', specs: 'ISO VG 32 (HVI marine hydraulic)', shell: 'Tellus S2 VX 32', mobil: 'DTE 10 Excel 32', castrol: 'Hyspin AWH-M 32', total: 'Equivis ZS 32' },
        { category: 'Hydraulic Oil', specs: 'ISO VG 46 (High Viscosity Index)', shell: 'Tellus S2 VX 46', mobil: 'DTE 10 Excel 46', castrol: 'Hyspin AWH-M 46', total: 'Equivis ZS 46' },
        { category: 'Hydraulic Oil', specs: 'ISO VG 68 (Deck machinery / CPP)', shell: 'Tellus S2 VX 68', mobil: 'DTE 10 Excel 68', castrol: 'Hyspin AWH-M 68', total: 'Equivis ZS 68' },
        { category: 'Air Compressor Oil', specs: 'ISO VG 68 (Air compressor)', shell: 'Corena S2 P 68', mobil: 'Rarus 426', castrol: 'Aircol PD 68', total: 'Dacnis VS 68' },
        { category: 'Air Compressor Oil', specs: 'ISO VG 100 (High-pressure air)', shell: 'Corena S2 P 100', mobil: 'Rarus 427', castrol: 'Aircol PD 100', total: 'Dacnis VS 100' },
        { category: 'Refrigeration Oil', specs: 'POE 32 (HFC refrigerant)', shell: 'Refrigeration Oil S4 FR-F 32', mobil: 'EAL Arctic 32', castrol: 'Icematic SW 32', total: 'Lunaria FR 32' },
        { category: 'Refrigeration Oil', specs: 'POE 68 (Reefer plant)', shell: 'Refrigeration Oil S4 FR-F 68', mobil: 'EAL Arctic 68', castrol: 'Icematic SW 68', total: 'Lunaria FR 68' },
    ];

    const PAINT_ROWS = [
        { type: 'Antifouling (A/F)', product: 'Self-Polishing SPC', chugoku: 'SeaGrandfather 880', jotun: 'SeaQuantum Pro', hempel: 'Globic 9500', ip: 'Interswift SPC' },
        { type: 'Antifouling (A/F)', product: 'Self-Polishing (TBT-free)', chugoku: 'SeaGrandfather 820', jotun: 'SeaQuantum Classic', hempel: 'Globic 9000', ip: 'Interswift 655' },
        { type: 'Antifouling (A/F)', product: 'Controlled Depletion', chugoku: 'SeaGrandfather 700', jotun: 'SeaForce 90', hempel: 'Oceanic+', ip: 'Interspeed 640' },
        { type: 'Antifouling (A/F)', product: 'Hard A/F (slow speed)', chugoku: 'SeaGrandfather 600', jotun: 'SeaForce 60', hempel: 'Olympic+', ip: 'Interspeed 610' },
        { type: 'Boottop / Waterline', product: 'Abrasion-resistant', chugoku: 'Marine Boottop', jotun: 'Pilot W', hempel: 'Hempadur Mastic 45880', ip: 'Intershield 803' },
        { type: 'Anticorrosive (A/C)', product: 'Aluminium A/C', chugoku: 'Marine Alumi', jotun: 'Pilot A/C', hempel: 'Aluminium 15360', ip: 'Intershield 300' },
        { type: 'Anticorrosive (A/C)', product: 'Vinyl A/C', chugoku: 'Marine Vinyl', jotun: 'Pilot II', hempel: 'Light Primer 45550', ip: 'Intergard 269' },
        { type: 'Anticorrosive (A/C)', product: 'Zinc Silicate', chugoku: 'Zinc Rich Primer', jotun: 'Barrier SmartPack', hempel: 'Hempadur Zinc 17360', ip: 'Intergard 7500' },
        { type: 'Epoxy Primer', product: 'Pure Epoxy', chugoku: 'Epicon B-13', jotun: 'Barrier 77', hempel: 'Hempadur 15553', ip: 'Intershield 300' },
        { type: 'Epoxy Primer', product: 'High-Build Epoxy', chugoku: 'Epicon HB', jotun: 'Barrier 80', hempel: 'Hempadur 17240', ip: 'Intershield 803' },
        { type: 'Epoxy Primer', product: 'Tank Coating', chugoku: 'Tankguard 100', jotun: 'Tankguard Storage', hempel: 'Hempadur Mastic 45880', ip: 'Interline 984' },
        { type: 'Epoxy Primer', product: 'Cargo Hold', chugoku: 'Tankguard Cargo', jotun: 'Tankguard Cargo', hempel: 'Hempadur 85671', ip: 'Interline 925' },
        { type: 'Topcoat', product: 'Polyurethane', chugoku: 'Urethane Topcoat', jotun: 'Hardtop XP', hempel: 'Hempathane 55210', ip: 'Interthane 870' },
        { type: 'Topcoat', product: 'Acrylic', chugoku: 'Marine Acrylic', jotun: 'Jotacote Universal', hempel: 'Hempatex 48500', ip: 'Intergard 345' },
    ];

    const PSC_GUARD_ROWS = [
        {
            id: 'efp',
            title: 'Emergency Fire Pump',
            mou: 'Tokyo MoU / Paris MoU CIC',
            focus: 'Suction pressure, priming time, dual jets >12 m throw',
            checks: [
                'Verify positive suction head and stripper seal / vacuum priming system',
                'Record priming time from standstill — target <5 minutes',
                'Operate two fire hoses simultaneously; verify jet reach ≥12 m',
                'Check relief valve setting and pressure gauge calibration',
            ],
            acceptance: 'Pump starts on first attempt; stable discharge pressure; both jets meet minimum throw.',
        },
        {
            id: 'qcv',
            title: 'Quick-Closing Valves & Fire Dampers',
            mou: 'Tokyo MoU / Paris MoU CIC',
            focus: 'Tripping wires, pneumatic release, fail-safe closure',
            checks: [
                'Trace all fuel-oil QCV tripping wire routes to remote stations',
                'Test pneumatic / hydraulic release at each remote position',
                'Confirm fire dampers close fully and latch on release',
                'Verify local manual override and reset procedure',
            ],
            acceptance: 'All QCVs and dampers close on single remote release; no seized linkages.',
        },
        {
            id: 'ows',
            title: 'OWS 15 ppm Bilge Alarm & 3-Way Valve',
            mou: 'Tokyo MoU / Paris MoU CIC',
            focus: '15 ppm alarm, 3-way valve fail-safe, zero discharge overboard',
            checks: [
                'Simulate 15 ppm alarm — verify audible/visual alarm and auto-recirculation',
                'Test 3-way valve fail-safe position (recirculation / sludge tank)',
                'Review OWS 15 ppm calibration certificate validity',
                'Inspect sample line for air lock or dilution',
            ],
            acceptance: 'Alarm activates at 15 ppm; valve diverts to sludge/recirc; no untreated discharge.',
        },
        {
            id: 'lifeboat',
            title: 'Lifeboat Engine & On-Load Release Gear',
            mou: 'Tokyo MoU / Paris MoU CIC',
            focus: 'Engine start, interlock, on-load release maintenance',
            checks: [
                'Start lifeboat engine — cold start within 2 min (SOLAS)',
                'Verify on-load release gear interlock and hydrostatic interlock',
                'Check fall wire condition, pennant arrangement, and hook maintenance',
                'Confirm weekly/monthly inspection records are up to date',
            ],
            acceptance: 'Engine starts within regulatory time; release gear interlocks functional.',
        },
        {
            id: 'eg',
            title: 'Emergency Generator Auto-Start',
            mou: 'Tokyo MoU / Paris MoU CIC',
            focus: 'Auto-start within 45 s, 3 consecutive attempts, load transfer',
            checks: [
                'Simulate main power failure — EG must start within 45 seconds',
                'Verify 3 consecutive auto-start attempts before lockout',
                'Confirm automatic connection to emergency switchboard',
                'Test fuel day tank level and starting air / battery condition',
            ],
            acceptance: 'EG starts and connects within 45 s on simulated blackout; load accepted.',
        },
    ];

    const FUEL_TYPES = {
        VLSFO: { label: 'VLSFO 0.5% S', defaultDensity: 991, densityMin: 920, densityMax: 1010, co2Factor: 3.151 },
        LSMGO: { label: 'LSMGO 0.1% S', defaultDensity: 865, densityMin: 840, densityMax: 890, co2Factor: 3.206 },
        HSFO: { label: 'HSFO 380', defaultDensity: 980, densityMin: 960, densityMax: 1010, co2Factor: 3.151 },
    };

    /** ASTM Table 54B α coefficient at 15°C reference (kg/m³). */
    function alpha54B(den15) {
        const d = Number(den15);
        if (!d || d <= 0) return 0;
        if (d <= 770) return (346.42278 + 0.43884 * d) / (d * d);
        if (d < 778) return -0.0033612 + 2680.32 / (d * d);
        if (d < 839) return 594.5418 / (d * d);
        return (186.9696 + 0.48618 * d) / (d * d);
    }

    /** ASTM Table 54B VCF to 15°C. */
    function vcf54B(den15, tempC) {
        const dT = Number(tempC) - 15;
        const alpha = alpha54B(den15);
        return Math.exp(-alpha * dT * (1 + 0.8 * alpha * dT));
    }

    /**
     * Full bunker metric calculation with weight-in-air and CO₂ estimate.
     * @param {object} opts fuelType, tempC, density15, volumeM3, massMt, inputMode ('volume'|'mass')
     */
    function calculateBunkerMetric(opts) {
        const fuelKey = opts.fuelType || 'VLSFO';
        const fuel = FUEL_TYPES[fuelKey] || FUEL_TYPES.VLSFO;
        const rho15 = Math.max(0, Number(opts.density15) || 0);
        const tempC = Number(opts.tempC);
        const inputMode = opts.inputMode === 'mass' ? 'mass' : 'volume';

        if (!rho15) {
            return {
                vcf: 1, v15: 0, vObs: 0, mt: 0, rhoObs: 0, rhoInAir: 0,
                alpha: 0, co2Mt: 0, co2Factor: fuel.co2Factor,
            };
        }

        const alpha = alpha54B(rho15);
        const vcf = Number.isFinite(tempC) ? vcf54B(rho15, tempC) : 1;
        const rhoObs = rho15 * vcf;
        const rhoInAir = rhoObs - 1.1;

        let vObs = 0;
        let v15 = 0;
        let mt = 0;

        if (inputMode === 'mass') {
            mt = Math.max(0, Number(opts.massMt) || 0);
            vObs = rhoInAir > 0 ? (mt * 1000) / rhoInAir : 0;
            v15 = vObs * vcf;
        } else {
            vObs = Math.max(0, Number(opts.volumeM3) || 0);
            v15 = vObs * vcf;
            mt = (vObs * rhoInAir) / 1000;
        }

        const co2Mt = mt * fuel.co2Factor;

        return {
            vcf, v15, vObs, mt, rhoObs, rhoInAir, alpha, co2Mt, co2Factor: fuel.co2Factor,
        };
    }

    function calcBunkerMassAstM54B(volume, density15, tempC) {
        const r = calculateBunkerMetric({
            fuelType: 'VLSFO', tempC, density15, volumeM3: volume, inputMode: 'volume',
        });
        return { mt: r.mt, v15: r.v15, rho15: Number(density15) || 0, vcf: r.vcf, alpha: r.alpha };
    }

    function flangeSizesForStandard(standard, maxNbMm) {
        const limit = maxNbMm || 300;
        return FLANGE_ROWS.filter(row => {
            if (row.standard !== standard) return false;
            const mm = parseInt(String(row.nb).replace(/[^\d]/g, ''), 10);
            if (!mm) return true;
            return mm >= 15 && mm <= limit;
        });
    }

    return {
        FLANGE_ROWS,
        FLANGE_STANDARDS,
        GASKET_REF_ROWS,
        PACKING_REF_ROWS,
        LUB_OIL_ROWS,
        PAINT_ROWS,
        PSC_GUARD_ROWS,
        FUEL_TYPES,
        alpha54B,
        vcf54B,
        calculateBunkerMetric,
        calcBunkerMassAstM54B,
        flangeSizesForStandard,
    };
})();
