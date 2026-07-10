/* TVC_PMS 예측 정비 엔진 검증 스크립트
 * 실행: node scripts/test-run-hours.cjs
 * 주기 1000시간 작업에 대해 가동시간/예상시간 변동에 따른 Due Date 변화를 확인한다.
 */
const fs = require('fs');
const path = require('path');

// ── 브라우저 전역 스텁 ────────────────────────────────────────────
global.localStorage = (() => {
    let s = {};
    return {
        getItem: k => (k in s ? s[k] : null),
        setItem: (k, v) => { s[k] = String(v); },
        removeItem: k => { delete s[k]; },
    };
})();
global.TVC_Indexes = { groupKey: j => `${j.department || ''}|${String(j.group || '').trim()}` };
// TVC_DB 미정의 → updateMaintenanceSchedule 의 persist 경로 자동 skip

// ── pms.js 로드 ───────────────────────────────────────────────────
let code = fs.readFileSync(path.join(__dirname, '..', 'js', 'pms.js'), 'utf8');
code += '\nglobalThis.__TVC_PMS = TVC_PMS;';
eval(code);
const PMS = globalThis.__TVC_PMS;

// ── 테스트 데이터: 주기 1000시간 작업 (No.1 G/E, ENGINE) ──────────
const GROUP = '03.        No.1 GENERATOR ENGINE';
const today = new Date().toISOString().slice(0, 10);
const baseJob = { unit: 'H', period: 1000, group: GROUP };

function scenario(label, total, expected) {
    const rec = { totalRunHours: total, expectedNextMonth: expected };
    const c = PMS.computeDueDate(baseJob, rec, today);
    console.log(
        `${label.padEnd(32)} | total ${String(total).padStart(5)}h | exp ${String(expected).padStart(4)}h/mo` +
        ` | into ${String(c.intoCycle).padStart(4)}h | remain ${String(c.remaining).padStart(4)}h` +
        ` | ${String(Math.round(c.months * 100) / 100).padStart(5)} mo | Due ⇒ ${c.newDate}`
    );
    return c.newDate;
}

console.log('\n=== TVC_PMS 예측 정비 엔진 검증 (period = 1000 h) ===');
console.log(`오늘: ${today}  ·  Group: ${GROUP.trim()}  ·  Tracked: ${PMS.isTrackedGroup(GROUP)}\n`);

const A = scenario('A) 신규 (누적0, 월200h)', 0, 200);
const B = scenario('B) 누적600h, 월200h', 600, 200);
const C = scenario('C) 누적600h, 월400h(가동UP)', 600, 400);
const D = scenario('D) 누적1200h(2주기째,월300)', 1200, 300);
const E = scenario('E) 누적950h, 월500h(임박)', 950, 500);

console.log('\n--- 검증 결과 ---');
console.log(`A→B (가동시간 누적 → Due 앞당김) : ${A} ⇒ ${B}   ${B < A ? 'PASS' : 'FAIL'}`);
console.log(`B→C (예상가동 상향 → Due 더 앞당김): ${B} ⇒ ${C}   ${C < B ? 'PASS' : 'FAIL'}`);
console.log(`E (임박 950/1000, 남은 50h → 0.1개월): ${E}`);

// 전체 파이프라인 (updateMaintenanceSchedule) 콘솔 로그 & job 반영 확인
console.log('\n--- updateMaintenanceSchedule() 파이프라인 로그 ---');
PMS.setSpace('SHIP');
localStorage.setItem('tvc_run_hrs_SHIP', JSON.stringify({
    [`ENGINE|${GROUP.trim()}`]: { totalRunHours: 600, expectedNextMonth: 200 },
}));
const state = {
    jobs: [
        { id: 'T1', job_code: 'GE-1000', department: 'ENGINE', group: GROUP, unit: 'H', period: 1000, next_date: '2026-01-01' },
        { id: 'M1', job_code: 'GE-MON', department: 'ENGINE', group: GROUP, unit: 'M', period: 6, next_date: '2026-05-05' },
    ],
};
PMS.updateMaintenanceSchedule(state, {}).then(res => {
    const hourJob = state.jobs[0], monJob = state.jobs[1];
    console.log(`\nrecalculated=${res.changed}`);
    console.log(`시간(H) 작업 next_date : 2026-01-01 ⇒ ${hourJob.next_date}  (schedule_basis=${hourJob.schedule_basis})`);
    console.log(`월(M) 작업 next_date 유지: ${monJob.next_date}  ${monJob.next_date === '2026-05-05' ? 'PASS' : 'FAIL'}`);
});
