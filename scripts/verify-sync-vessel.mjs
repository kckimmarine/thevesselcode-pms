/**
 * Import vessel_id 검증 로직 (js/services/sync.js 미러)
 * 실행: node scripts/verify-sync-vessel.mjs
 */

function normalizeVesselId(id) {
    return String(id || '').trim();
}

function validateImportVesselId(expected, incoming, isHq) {
    const got = normalizeVesselId(incoming);
    const exp = normalizeVesselId(expected);
    if (!got || got === 'UNKNOWN') {
        return { ok: false, code: 'VESSEL_ID_MISSING' };
    }
    if (!exp) return { ok: true, warning: 'expected_unconfigured' };
    if (exp !== got) {
        return { ok: false, code: 'VESSEL_MISMATCH', expected: exp, incoming: got };
    }
    return { ok: true };
}

function exportFilename(vesselId, dept, dateStr) {
    const exportDate = dateStr.slice(0, 10).replace(/-/g, '');
    return `${vesselId}_${dept}_PMS_EXPORT_${exportDate}.zip`;
}

let passed = 0;
let failed = 0;

function assert(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n═══ Import vessel_id 검증 ═══\n');

assert('동일 vessel_id → 허용', validateImportVesselId('TEST_V01', 'TEST_V01', false).ok);
assert('선박 불일치 → VESSEL_MISMATCH', validateImportVesselId('TEST_V01', 'OTHER_SHIP', false).code === 'VESSEL_MISMATCH');
assert('HQ 불일치 → VESSEL_MISMATCH', validateImportVesselId('VESSEL_A', 'VESSEL_B', true).code === 'VESSEL_MISMATCH');
assert('UNKNOWN incoming → VESSEL_ID_MISSING', validateImportVesselId('TEST_V01', 'UNKNOWN', false).code === 'VESSEL_ID_MISSING');
assert('빈 incoming → VESSEL_ID_MISSING', validateImportVesselId('TEST_V01', '', false).code === 'VESSEL_ID_MISSING');
assert('expected 미설정 → 허용(경고)', validateImportVesselId('', 'TEST_V01', false).ok && validateImportVesselId('', 'TEST_V01', false).warning);

const today = new Date().toISOString();
const fn = exportFilename('TEST_V01', 'ENGINE', today);
assert('Export 파일명 패턴', fn === `TEST_V01_ENGINE_PMS_EXPORT_${today.slice(0, 10).replace(/-/g, '')}.zip`, fn);

console.log(`\n═══ 결과: ${passed} passed, ${failed} failed ═══\n`);
process.exit(failed > 0 ? 1 : 0);
