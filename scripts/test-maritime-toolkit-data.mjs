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

    // ASTM Table 54B worked examples (published reference values)
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

    // Practical bunker case: 500 m³ VLSFO @ 991 kg/m³, 40°C
    const bunker = data.calcBunkerMassAstM54B(500, 991, 40);
    results.push({
        check: 'bunker VLSFO 500m³ @40°C yields MT',
        ok: bunker.mt > 480 && bunker.mt < 500 && bunker.vcf < 1,
        detail: { mt: bunker.mt, vcf: bunker.vcf },
    });

    // Flange table coverage
    const jis5k = data.FLANGE_ROWS.filter(r => r.standard === 'JIS 5K');
    const jis10k = data.FLANGE_ROWS.filter(r => r.standard === 'JIS 10K');
    const jis16k = data.FLANGE_ROWS.filter(r => r.standard === 'JIS 16K');
    results.push({ check: 'JIS 5K rows >= 25', ok: jis5k.length >= 25, detail: jis5k.length });
    results.push({ check: 'JIS 10K rows >= 25', ok: jis10k.length >= 25, detail: jis10k.length });
    results.push({ check: 'JIS 16K rows >= 25', ok: jis16k.length >= 25, detail: jis16k.length });

    // Spot-check JIS 10K 50A (common shipboard size)
    const jis50a = jis10k.find(r => r.nb === '50A');
    results.push({
        check: 'JIS 10K 50A OD/PCD',
        ok: jis50a && jis50a.od === 155 && jis50a.pcd === 120,
        detail: jis50a,
    });

    // Cross-ref row counts
    results.push({ check: 'lube rows >= 20', ok: data.LUB_OIL_ROWS.length >= 20, detail: data.LUB_OIL_ROWS.length });
    results.push({ check: 'paint rows >= 12', ok: data.PAINT_ROWS.length >= 12, detail: data.PAINT_ROWS.length });

    const failed = results.filter(r => !r.ok);
    console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 2));
    if (failed.length) process.exit(1);
}

main();
