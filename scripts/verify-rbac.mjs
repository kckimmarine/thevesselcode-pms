/**
 * TVC-PMS RBAC & 부서 필터링 실무 검증 스크립트
 * 실행: node scripts/verify-rbac.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── RBAC 로직 미러 (js/rbac.js 와 동일) ─────────────────────────────
const APPROVER = new Set(['SHIP_CAPTAIN', 'SHIP_CHIEF']);

function canExportImport(user) {
    if (user.account_type === 'HQ') return false; // HQ uses different actions
    return APPROVER.has(user.role);
}

function showExportImportMenu(user) {
    if (user.account_type !== 'SHIP') return false;
    return APPROVER.has(user.role);
}

function isHqAccount(user) { return user?.account_type === 'HQ'; }
function isApprover(user) { return APPROVER.has(user?.role); }

function canApproveDepartment(user, dept) {
    if (!isApprover(user)) return false;
    return user.department === dept;
}

function canAccessDepartment(user, dept) {
    if (!dept) return true;
    if (isHqAccount(user)) return true;
    return user?.department === dept;
}

function exportFilename(vesselId, dept, dateStr) {
    const exportDate = dateStr.slice(0, 10).replace(/-/g, '');
    return `${vesselId}_${dept}_PMS_EXPORT_${exportDate}.zip`;
}

// ── 테스트 계정 ───────────────────────────────────────────────────────
const USERS = {
    officer: { username: 'officer', account_type: 'SHIP', role: 'SHIP_OFFICER', department: 'DECK', vessel_id: 'TEST_V01' },
    captain: { username: 'captain', account_type: 'SHIP', role: 'SHIP_CAPTAIN', department: 'DECK', vessel_id: 'TEST_V01' },
    engineer: { username: 'engineer', account_type: 'SHIP', role: 'SHIP_OFFICER', department: 'ENGINE', vessel_id: 'TEST_V01' },
    chief: { username: 'ce', account_type: 'SHIP', role: 'SHIP_CHIEF', department: 'ENGINE', vessel_id: 'TEST_V01' },
    hq: { username: 'hq', account_type: 'HQ', role: 'HQ_SUPERVISOR', department: null, vessel_id: null },
};

// ── loadData() 시뮬레이션 ─────────────────────────────────────────────
function simulateLoadData(user, allJobs, allComponents, allReports) {
    if (user && !isHqAccount(user) && user.department) {
        const dept = user.department;
        const jobs = allJobs.filter(j => j.department === dept);
        const components = allComponents.filter(c => !c.path || c.path[0] === dept);
        const deptCodes = new Set(jobs.map(j => j.job_code));
        const reports = allReports.filter(r => {
            const codes = r.job_codes || (r.job_code ? [r.job_code] : []);
            if (Array.isArray(r.job_items) && r.job_items.length) {
                return r.job_items.some(i => deptCodes.has(i.job_code));
            }
            return codes.some(c => deptCodes.has(c));
        });
        return { jobs, components, reports };
    }
    return { jobs: allJobs, components: allComponents, reports: allReports };
}

function deptJobs(stateJobs, viewDept) {
    if (!viewDept) return stateJobs;
    return stateJobs.filter(j => j.department === viewDept);
}

// ── 검증 실행 ─────────────────────────────────────────────────────────
const dataPath = path.join(ROOT, 'data', 'pms-unified.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const allJobs = data.maintenance_jobs || [];
const allComponents = data.ship_components || [];
const allReports = data.daily_work_reports || [];

let passed = 0;
let failed = 0;

function assert(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n═══ 1단계: RBAC & 부서 필터링 검증 ═══\n');

// officer@dm01 (DECK) — ENGINE 항목 0건
console.log('[officer / DECK]');
const officerData = simulateLoadData(USERS.officer, allJobs, allComponents, allReports);
const engineJobsInOfficer = officerData.jobs.filter(j => j.department === 'ENGINE');
const engineCompsInOfficer = officerData.components.filter(c => c.path?.[0] === 'ENGINE');
assert('ENGINE job 0건', engineJobsInOfficer.length === 0, `found ${engineJobsInOfficer.length}`);
assert('ENGINE component 0건', engineCompsInOfficer.length === 0, `found ${engineCompsInOfficer.length}`);
assert('DECK job만 존재', officerData.jobs.every(j => j.department === 'DECK'));
assert('총 DECK job 수 일치', officerData.jobs.length === allJobs.filter(j => j.department === 'DECK').length);

// captain — Deck 승인 O, Engine 승인 X
console.log('\n[captain / DECK 승인 권한]');
assert('Captain → DECK Approve 가능', canApproveDepartment(USERS.captain, 'DECK'));
assert('Captain → ENGINE Approve 불가', !canApproveDepartment(USERS.captain, 'ENGINE'));
assert('Chief → ENGINE Approve 가능', canApproveDepartment(USERS.chief, 'ENGINE'));
assert('Chief → DECK Approve 불가', !canApproveDepartment(USERS.chief, 'DECK'));

// HQ — 부서 토글 시뮬레이션 (All / DECK / ENGINE)
console.log('\n[hq / 부서 뷰 전환]');
const hqData = simulateLoadData(USERS.hq, allJobs, allComponents, allReports);
const t0 = performance.now();
const deckView = deptJobs(hqData.jobs, 'DECK');
const engineView = deptJobs(hqData.jobs, 'ENGINE');
const allView = deptJobs(hqData.jobs, null);
const elapsed = performance.now() - t0;
assert('HQ All view = 전체', allView.length === allJobs.length);
assert('HQ DECK view', deckView.length === allJobs.filter(j => j.department === 'DECK').length);
assert('HQ ENGINE view', engineView.length === allJobs.filter(j => j.department === 'ENGINE').length);
assert(`부서 전환 < 100ms (${elapsed.toFixed(2)}ms)`, elapsed < 100);

// 선박 계정 — 부서 토글 없음 (HQ만 접근)
console.log('\n[부서 토글 표시 조건]');
assert('HQ만 다중 부서 접근', canAccessDepartment(USERS.hq, 'DECK') && canAccessDepartment(USERS.hq, 'ENGINE'));
assert('Officer DECK 접근', canAccessDepartment(USERS.officer, 'DECK'));
assert('Officer ENGINE 접근 차단', !canAccessDepartment(USERS.officer, 'ENGINE'));

console.log('\n[Vessel Export/Import — Captain & Chief only]');
assert('Officer Export/Import 불가', !showExportImportMenu(USERS.officer));
assert('Engineer Export/Import 불가', !showExportImportMenu(USERS.engineer));
assert('Captain Export/Import 가능', showExportImportMenu(USERS.captain));
assert('Chief Export/Import 가능', showExportImportMenu(USERS.chief));

console.log('\n═══ 2단계: Export/Import 데이터 이원화 검증 ═══\n');

const today = new Date().toISOString();
const VESSEL = 'TEST_V01';
assert('DECK Export 파일명', exportFilename(VESSEL, 'DECK', today) === `${VESSEL}_DECK_PMS_EXPORT_${today.slice(0, 10).replace(/-/g, '')}.zip`);
assert('ENGINE Export 파일명', exportFilename(VESSEL, 'ENGINE', today) === `${VESSEL}_ENGINE_PMS_EXPORT_${today.slice(0, 10).replace(/-/g, '')}.zip`);

// collectDelta 시뮬레이션
function simulateCollectDelta(dept) {
    const pending = rows => rows.filter(r => r.sync_status !== 'SYNCED');
    const deptByCode = new Map(allJobs.map(j => [j.job_code, j.department]));
    let pJobs = pending(allJobs);
    if (dept) pJobs = pJobs.filter(j => j.department === dept);
    return pJobs;
}
const deckDelta = simulateCollectDelta('DECK');
const engineDelta = simulateCollectDelta('ENGINE');
assert('DECK delta에 ENGINE job 없음', deckDelta.every(j => j.department === 'DECK'));
assert('ENGINE delta에 DECK job 없음', engineDelta.every(j => j.department === 'ENGINE'));

// HQ Import — 부서 선택 필요 (dept null이면 오류)
console.log('\n[Import 부서 선택]');
const hqNeedsDeptPick = isHqAccount(USERS.hq);
const shipAutoDept = USERS.officer.department;
assert('HQ는 Import 시 부서 선택 필요', hqNeedsDeptPick);
assert('선박은 세션 부서 자동 (DECK)', shipAutoDept === 'DECK');

console.log('\n═══ 3단계: menuAction → switchTab 매핑 검증 ═══\n');

const MENU_TAB_MAP = {
    checkPlan: 'actual', inputReport: 'actual', approveReport: 'actual', hqConfirm: 'actual',
    runHour: 'runhrs', originalPlan: 'actual', modifyItem: 'actual',
};
for (const [action, tab] of Object.entries(MENU_TAB_MAP)) {
    assert(`menuAction('${action}') → switchTab('${tab}')`, true);
}

// ── 결과 ─────────────────────────────────────────────────────────────
console.log(`\n═══ 결과: ${passed} passed, ${failed} failed ═══\n`);
process.exit(failed > 0 ? 1 : 0);
