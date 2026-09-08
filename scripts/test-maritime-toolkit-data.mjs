/**
 * Verify Maritime Toolkit reference data and ASTM Table 54B calculations.
 * Run: node scripts/test-maritime-toolkit-data.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;

function loadToolkitData() {
    const code = readFileSync(`${root}/js/data/maritimeToolkitData.js`, 'utf8');
    const sandbox = { Math, console };
    vm.createContext(sandbox);
    vm.runInContext(`${code}\nthis.TVC_MaritimeToolkitData = TVC_MaritimeToolkitData;`, sandbox);
    return sandbox.TVC_MaritimeToolkitData;
}

function approx(actual, expected, tol = 0.0001) {
    return Math.abs(actual - expected) <= tol;
}

function main() {
    const data = loadToolkitData();
    const results = [];

    const vcfCases = [
        { den15: 839, tempC: 32.5, vcf: 0.98515 },
        { den15: 903.5, tempC: 30.5, vcf: 0.988067 },
        { den15: 819, tempC: 26.75, vcf: 0.989552 },
        { den15: 777.5, tempC: 9, vcf: 1.006412 },
        { den15: 749, tempC: 32, vcf: 0.979423 },
    ];
    for (const c of vcfCases) {
        const got = data.vcf54B(c.den15, c.tempC);
        results.push({
            check: `VCF den=${c.den15} T=${c.tempC}`,
            ok: approx(got, c.vcf, 0.00005),
            detail: { got, expected: c.vcf },
        });
    }

    const bunker = data.calculateBunkerMetric({
        fuelType: 'VLSFO', tempC: 40, density15: 991, volumeM3: 500, inputMode: 'volume',
    });
    results.push({
        check: 'bunker VLSFO 500m³ @40°C weight-in-air MT',
        ok: bunker.mt > 475 && bunker.mt < 495 && bunker.vcf < 1,
        detail: { mt: bunker.mt, vcf: bunker.vcf, co2Mt: bunker.co2Mt },
    });

    results.push({
        check: 'bunker CO₂ factor applied',
        ok: approx(bunker.co2Mt, bunker.mt * 3.151, 0.1),
        detail: { co2Mt: bunker.co2Mt },
    });

    const jis5k = data.FLANGE_ROWS.filter(r => r.standard === 'JIS 5K');
    const jis10k = data.FLANGE_ROWS.filter(r => r.standard === 'JIS 10K');
    const jis16k = data.FLANGE_ROWS.filter(r => r.standard === 'JIS 16K');
    const dinPn10 = data.FLANGE_ROWS.filter(r => r.standard === 'DIN PN10');
    results.push({ check: 'JIS 5K rows >= 25', ok: jis5k.length >= 25, detail: jis5k.length });
    results.push({ check: 'JIS 10K rows >= 25', ok: jis10k.length >= 25, detail: jis10k.length });
    results.push({ check: 'JIS 16K rows >= 25', ok: jis16k.length >= 25, detail: jis16k.length });
    results.push({ check: 'DIN PN10 rows >= 10', ok: dinPn10.length >= 10, detail: dinPn10.length });

    const jis50a = jis10k.find(r => r.nb === '50A');
    results.push({
        check: 'JIS 10K 50A OD/PCD',
        ok: jis50a && jis50a.od === 155 && jis50a.pcd === 120,
        detail: jis50a,
    });

    const sizes = data.flangeSizesForStandard('JIS 10K', 300);
    results.push({
        check: 'flange size filter 15A-300A',
        ok: sizes.length >= 15 && sizes.every(s => {
            const mm = parseInt(s.nb, 10);
            return mm >= 15 && mm <= 300;
        }),
        detail: sizes.length,
    });

    results.push({ check: 'lube rows >= 15', ok: data.LUB_OIL_ROWS.length >= 15, detail: data.LUB_OIL_ROWS.length });
    results.push({ check: 'PSC guard topics >= 5', ok: data.PSC_GUARD_ROWS.length >= 5, detail: data.PSC_GUARD_ROWS.length });
    results.push({ check: 'gasket ref rows >= 5', ok: data.GASKET_REF_ROWS.length >= 5, detail: data.GASKET_REF_ROWS.length });

    const failed = results.filter(r => !r.ok);
    console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 2));
    if (failed.length) process.exit(1);
}

main();
