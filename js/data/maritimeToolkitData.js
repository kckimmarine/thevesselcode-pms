/* THE VESSEL CODE — Maritime Toolkit reference data (JIS B2220, lube/paint cross-ref) */
const TVC_MaritimeToolkitData = (function () {
    /** Map JIS bolt-hole diameter (mm) to nominal bolt thread. */
    function boltFromHole(hole) {
        const map = {
            12: 'M10',
            15: 'M12',
            19: 'M16',
            23: 'M20',
            25: 'M22',
            27: 'M24',
            33: 'M30',
            39: 'M36',
            42: 'M39',
            48: 'M45',
            56: 'M52',
        };
        return map[hole] || `Ø${hole}`;
    }

    function jisRow(standard, nb, od, pcd, bolts, hole) {
        return { standard, nb, od, pcd, bolts, hole, bolt: boltFromHole(hole) };
    }

    /** JIS B2220 dimensions (mm) — source: wermac.org societies tables. */
    const JIS_5K = [
        [10, 75, 55, 4, 12], [15, 80, 60, 4, 12], [20, 85, 65, 4, 12], [25, 95, 75, 4, 12],
        [32, 115, 90, 4, 15], [40, 120, 95, 4, 15], [50, 130, 105, 4, 15], [65, 155, 130, 4, 15],
        [80, 180, 145, 4, 19], [90, 190, 155, 4, 19], [100, 200, 165, 8, 19], [125, 235, 200, 8, 19],
        [150, 265, 230, 8, 19], [175, 300, 260, 8, 23], [200, 320, 280, 8, 23], [225, 345, 305, 12, 23],
        [250, 385, 345, 12, 23], [300, 430, 390, 12, 23], [350, 480, 435, 12, 25], [400, 540, 495, 16, 25],
        [450, 605, 555, 16, 25], [500, 655, 605, 20, 25], [550, 720, 665, 20, 27], [600, 770, 715, 20, 27],
        [650, 825, 770, 24, 27], [700, 875, 820, 24, 27], [750, 945, 880, 24, 33], [800, 995, 930, 24, 33],
        [850, 1045, 980, 24, 33], [900, 1095, 1030, 24, 33], [1000, 1195, 1130, 28, 33],
    ].map(([nb, od, pcd, bolts, hole]) => jisRow('JIS 5K', `${nb}A`, od, pcd, bolts, hole));

    const JIS_10K = [
        [10, 90, 65, 4, 15], [15, 95, 70, 4, 15], [20, 100, 75, 4, 15], [25, 110, 90, 4, 19],
        [32, 135, 100, 4, 19], [40, 140, 105, 4, 19], [50, 155, 120, 4, 19], [65, 175, 140, 4, 19],
        [80, 185, 150, 8, 19], [90, 195, 160, 8, 19], [100, 210, 175, 8, 19], [125, 230, 210, 8, 23],
        [150, 280, 240, 8, 23], [175, 300, 270, 8, 23], [200, 330, 290, 12, 23], [225, 350, 310, 12, 25],
        [250, 400, 355, 12, 25], [300, 445, 410, 12, 25], [350, 490, 445, 16, 25], [400, 520, 515, 16, 27],
        [450, 570, 565, 20, 27], [500, 675, 620, 20, 27], [550, 745, 680, 24, 33], [600, 795, 730, 24, 33],
        [650, 845, 780, 24, 33], [700, 905, 840, 24, 33], [750, 970, 900, 24, 33], [800, 1020, 950, 24, 33],
        [850, 1070, 1000, 28, 33], [900, 1120, 1050, 28, 33], [1000, 1235, 1160, 28, 39],
    ].map(([nb, od, pcd, bolts, hole]) => jisRow('JIS 10K', `${nb}A`, od, pcd, bolts, hole));

    const JIS_16K = [
        [10, 90, 65, 4, 15], [15, 95, 70, 4, 15], [20, 100, 75, 4, 15], [25, 125, 90, 4, 19],
        [32, 135, 100, 4, 19], [40, 140, 105, 4, 19], [50, 155, 120, 8, 19], [65, 175, 140, 8, 19],
        [80, 200, 160, 8, 23], [90, 210, 170, 8, 23], [100, 225, 185, 8, 23], [125, 270, 225, 8, 25],
        [150, 305, 260, 12, 25], [200, 350, 305, 12, 25], [250, 430, 380, 12, 27], [300, 480, 430, 16, 27],
        [350, 540, 480, 16, 33], [400, 605, 540, 16, 33], [450, 675, 605, 20, 33], [500, 730, 660, 20, 33],
        [550, 795, 720, 20, 39], [600, 845, 770, 24, 39], [650, 895, 820, 24, 39], [700, 960, 875, 24, 42],
        [750, 1020, 935, 24, 42], [800, 1085, 990, 24, 48], [850, 1135, 1040, 24, 48], [900, 1185, 1090, 28, 48],
        [1000, 1320, 1210, 28, 56],
    ].map(([nb, od, pcd, bolts, hole]) => jisRow('JIS 16K', `${nb}A`, od, pcd, bolts, hole));

    const DIN_PN16 = [
        ['DN15', 95, 65, 4, 14, 'M12'], ['DN20', 105, 75, 4, 14, 'M12'], ['DN25', 115, 85, 4, 14, 'M12'],
        ['DN32', 140, 100, 4, 18, 'M16'], ['DN40', 150, 110, 4, 18, 'M16'], ['DN50', 165, 125, 4, 18, 'M16'],
        ['DN65', 185, 145, 8, 18, 'M16'], ['DN80', 200, 160, 8, 18, 'M16'], ['DN100', 220, 180, 8, 18, 'M16'],
        ['DN125', 250, 210, 8, 18, 'M16'], ['DN150', 285, 240, 8, 22, 'M20'], ['DN200', 340, 295, 12, 22, 'M20'],
        ['DN250', 405, 355, 12, 26, 'M24'], ['DN300', 460, 410, 12, 26, 'M24'],
    ].map(([nb, od, pcd, bolts, hole, bolt]) => ({ standard: 'DIN PN16', nb, od, pcd, bolts, hole, bolt }));

    const ANSI_150 = [
        ['1/2"', 89, 60, 4, 16, '1/2"'], ['3/4"', 98, 70, 4, 16, '1/2"'], ['1"', 108, 79, 4, 16, '1/2"'],
        ['1-1/4"', 117, 89, 4, 16, '5/8"'], ['1-1/2"', 127, 98, 4, 16, '5/8"'], ['2"', 152, 121, 4, 19, '5/8"'],
        ['2-1/2"', 178, 140, 4, 19, '5/8"'], ['3"', 190, 152, 4, 19, '5/8"'], ['4"', 229, 190, 8, 19, '5/8"'],
        ['6"', 280, 241, 8, 22, '3/4"'], ['8"', 343, 298, 8, 22, '3/4"'], ['10"', 406, 362, 12, 25, '7/8"'],
        ['12"', 483, 432, 12, 25, '7/8"'],
    ].map(([nb, od, pcd, bolts, hole, bolt]) => ({ standard: 'ANSI 150#', nb, od, pcd, bolts, hole, bolt }));

    const FLANGE_ROWS = [...JIS_5K, ...JIS_10K, ...JIS_16K, ...DIN_PN16, ...ANSI_150];

    const LUB_OIL_ROWS = [
        { category: 'Cylinder Oil', grade: '40BN', shell: 'Alexia 40', mobil: 'Mobil Gard 540', castrol: 'Cleeton 40', total: 'Disola A 30' },
        { category: 'Cylinder Oil', grade: '50BN', shell: 'Alexia 50', mobil: 'Mobil Gard 560', castrol: 'Cleeton 50', total: 'Disola A 40' },
        { category: 'Cylinder Oil', grade: '70BN', shell: 'Alexia 50', mobil: 'Mobil Gard 570', castrol: 'Cleeton 70', total: 'Disola A 40' },
        { category: 'Cylinder Oil', grade: '80BN', shell: 'Alexia 70', mobil: 'Mobil Gard 570', castrol: 'Cleeton 80', total: 'Disola A 50' },
        { category: 'Cylinder Oil', grade: '100BN', shell: 'Alexia 100', mobil: 'Mobil Gard 610', castrol: 'Cleeton 100', total: 'Disola A 70' },
        { category: 'Cylinder Oil', grade: '140BN', shell: 'Alexia 140', mobil: 'Mobil Gard 640', castrol: 'Cleeton 140', total: 'Disola A 100' },
        { category: 'System Oil', grade: 'SAE 30', shell: 'Gadinia 30', mobil: 'Mobil Delvac 1300', castrol: 'Cyltech 30', total: 'Aurelia X 300' },
        { category: 'System Oil', grade: 'SAE 40', shell: 'Gadinia 40', mobil: 'Mobil Delvac 1640', castrol: 'Cyltech 40', total: 'Aurelia X 400' },
        { category: 'System Oil', grade: 'SAE 50', shell: 'Gadinia 50', mobil: 'Mobil Delvac 1 SHC', castrol: 'Cyltech 50', total: 'Aurelia X 500' },
        { category: 'Turbine Oil', grade: 'ISO VG 32', shell: 'Turbo T 32', mobil: 'Mobil DTE Light', castrol: 'Perfecto T 32', total: 'Preslia GT 32' },
        { category: 'Turbine Oil', grade: 'ISO VG 46', shell: 'Turbo T 46', mobil: 'Mobil DTE Medium', castrol: 'Perfecto T 46', total: 'Preslia GT 46' },
        { category: 'Turbine Oil', grade: 'ISO VG 68', shell: 'Turbo T 68', mobil: 'Mobil DTE Heavy Medium', castrol: 'Perfecto T 68', total: 'Preslia GT 68' },
        { category: 'Hydraulic Oil', grade: 'ISO VG 32', shell: 'Tellus S2 M 32', mobil: 'Mobil DTE 10 Excel 32', castrol: 'Hyspin AWS 32', total: 'Azolla ZS 32' },
        { category: 'Hydraulic Oil', grade: 'ISO VG 46', shell: 'Tellus S2 M 46', mobil: 'Mobil DTE 10 Excel 46', castrol: 'Hyspin AWS 46', total: 'Azolla ZS 46' },
        { category: 'Hydraulic Oil', grade: 'ISO VG 68', shell: 'Tellus S2 M 68', mobil: 'Mobil DTE 10 Excel 68', castrol: 'Hyspin AWS 68', total: 'Azolla ZS 68' },
        { category: 'Hydraulic Oil', grade: 'ISO VG 100', shell: 'Tellus S2 M 100', mobil: 'Mobil DTE 10 Excel 100', castrol: 'Hyspin AWS 100', total: 'Azolla ZS 100' },
        { category: 'Gear Oil', grade: 'ISO VG 150', shell: 'Omala S2 G 150', mobil: 'Mobilgear 600 XP 150', castrol: 'Alpha SP 150', total: 'Carter EP 150' },
        { category: 'Gear Oil', grade: 'ISO VG 220', shell: 'Omala S2 G 220', mobil: 'Mobilgear 600 XP 220', castrol: 'Alpha SP 220', total: 'Carter EP 220' },
        { category: 'Gear Oil', grade: 'ISO VG 320', shell: 'Omala S2 G 320', mobil: 'Mobilgear 600 XP 320', castrol: 'Alpha SP 320', total: 'Carter EP 320' },
        { category: 'Compressor Oil', grade: 'ISO VG 32', shell: 'Corena S2 P 32', mobil: 'Mobil Rarus 424', castrol: 'Aircol PD 32', total: 'Dacnis VS 32' },
        { category: 'Compressor Oil', grade: 'ISO VG 46', shell: 'Corena S2 P 46', mobil: 'Mobil Rarus 425', castrol: 'Aircol PD 46', total: 'Dacnis VS 46' },
        { category: 'Compressor Oil', grade: 'ISO VG 68', shell: 'Corena S2 P 68', mobil: 'Mobil Rarus 426', castrol: 'Aircol PD 68', total: 'Dacnis VS 68' },
        { category: 'Refrigeration Oil', grade: 'POE 32', shell: 'Refrigeration Oil S4 FR-F 32', mobil: 'Mobil EAL Arctic 32', castrol: 'Icematic SW 32', total: 'Lunaria FR 32' },
        { category: 'Refrigeration Oil', grade: 'POE 68', shell: 'Refrigeration Oil S4 FR-F 68', mobil: 'Mobil EAL Arctic 68', castrol: 'Icematic SW 68', total: 'Lunaria FR 68' },
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

    /**
     * ASTM Table 54B coefficient of thermal expansion (α) at 15°C reference.
     * @param {number} den15 density at 15°C (kg/m³)
     */
    function alpha54B(den15) {
        const d = Number(den15);
        if (!d || d <= 0) return 0;
        if (d <= 770) return (346.42278 + 0.43884 * d) / (d * d);
        if (d < 778) return -0.0033612 + 2680.32 / (d * d);
        if (d < 839) return 594.5418 / (d * d);
        return (186.9696 + 0.48618 * d) / (d * d);
    }

    /**
     * ASTM Table 54B volume correction factor to 15°C.
     * VCF = exp(−α·ΔT·(1 + 0.8·α·ΔT)), ΔT = Tobs − 15°C
     */
    function vcf54B(den15, tempC) {
        const dT = Number(tempC) - 15;
        const alpha = alpha54B(den15);
        return Math.exp(-alpha * dT * (1 + 0.8 * alpha * dT));
    }

    /**
     * ASTM Table 54B mass conversion: observed volume → MT at 15°C reference density.
     */
    function calcBunkerMassAstM54B(volume, density15, tempC) {
        const vObs = Math.max(0, Number(volume) || 0);
        const rho15 = Math.max(0, Number(density15) || 0);
        const t = Number(tempC);

        if (!vObs || !rho15) {
            return { mt: 0, v15: 0, rho15, vcf: 1, alpha: 0 };
        }

        const alpha = alpha54B(rho15);
        const vcf = Number.isFinite(t) ? vcf54B(rho15, t) : 1;
        const v15 = vObs * vcf;
        const mt = (v15 * rho15) / 1000;

        return { mt, v15, rho15, vcf, alpha };
    }

    return {
        FLANGE_ROWS,
        LUB_OIL_ROWS,
        PAINT_ROWS,
        alpha54B,
        vcf54B,
        calcBunkerMassAstM54B,
    };
})();
