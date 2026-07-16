/* THE VESSEL CODE — Equipment Run Hours UI
 *
 * 시간 기반 관리 장비(M/E, No.1~3 G/E)의 가동시간을 입력/누적하고,
 * TVC_PMS.updateMaintenanceSchedule 로 Due Date 를 재계산한다.
 *
 * 컬럼: Equipment / Group | Run-hour Jobs | Actual Run Hrs Prev. Month
 *       | Total Run Hours | Expected Run Hrs Next Month | Updated | Action
 */
const TVC_RunHours = (function () {
    let ctx = null; // { getState: () => state, refresh: async () => {} }

    function init(context) { ctx = context; }

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    /** 시간 기반 관리 대상 장비 그룹만 추출 (부서 필터 반영) */
    function trackedNodes(state) {
        return (state.idx?.groupNodes || []).filter(n =>
            TVC_PMS.isTrackedGroup(n.label) &&
            (!state.department || n.department === state.department)
        );
    }

    function render() {
        const state = ctx.getState();
        const body = document.getElementById('runHrsBody');
        if (!body || !state.idx) return;

        const store = TVC_PMS.readStore();
        const nodes = trackedNodes(state);
        state._rhNodes = nodes;

        if (!nodes.length) {
            body.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center">No run-hour tracked equipment for this view. (Only M/E and No.1~3 G/E are time-based.)</td></tr>';
            return;
        }

        body.innerHTML = nodes.map((n, i) => {
            const rec = store[n.key] || {};
            const total = Number(rec.totalRunHours) || 0;
            const hourJobs = n.jobIds.filter(id => TVC_PMS.isRunHourJob(state.idx.jobById.get(id))).length;
            return `<tr>
                <td><strong>${esc(n.label)}</strong></td>
                <td>${hourJobs}</td>
                <td><input type="number" min="0" step="1" class="rh-input" id="rh-prev-${i}" placeholder="0"
                    oninput="TVC_App.runHrsPreview(${i})"></td>
                <td><input type="number" min="0" step="1" class="rh-input rh-total" id="rh-total-${i}"
                    data-base="${total}" value="${total}"
                    oninput="TVC_App.runHrsTotalEdit(${i})"></td>
                <td><input type="number" min="0" step="1" class="rh-input" id="rh-exp-${i}"
                    value="${rec.expectedNextMonth ?? ''}" placeholder="0"></td>
                <td class="rh-updated">${esc(rec.updated || '—')}</td>
                <td><button class="btn-sm btn-green" onclick="TVC_App.saveRunHrs(${i})">↻ Update</button></td>
            </tr>`;
        }).join('');
    }

    /** Actual Run Hrs Prev. Month 입력 시 Total Run Hours 실시간 합산 미리보기 */
    function preview(i) {
        const prevEl = document.getElementById('rh-prev-' + i);
        const totalEl = document.getElementById('rh-total-' + i);
        if (!prevEl || !totalEl) return;
        const base = Number(totalEl.dataset.base) || 0;
        const add = Number(prevEl.value) || 0;
        totalEl.value = add ? base + add : base;
        totalEl.classList.toggle('rh-total-live', add !== 0);
    }

    /** Total Run Hours 직접 수정 시 미리보기 하이라이트 해제 */
    function totalEdit(i) {
        const prevEl = document.getElementById('rh-prev-' + i);
        const totalEl = document.getElementById('rh-total-' + i);
        if (!totalEl) return;
        const base = Number(totalEl.dataset.base) || 0;
        const cur = Number(totalEl.value) || 0;
        const add = Number(prevEl?.value) || 0;
        const fromPreview = add !== 0 && cur === base + add;
        totalEl.classList.toggle('rh-total-live', fromPreview);
    }

    /** 입력값 저장 → 누적 → Due Date 재계산 (IndexedDB 반영) */
    async function save(i) {
        const state = ctx.getState();
        const n = state._rhNodes?.[i];
        if (!n) return;

        const prevEl = document.getElementById('rh-prev-' + i);
        const totalEl = document.getElementById('rh-total-' + i);
        const expEl = document.getElementById('rh-exp-' + i);
        const add = Number(prevEl?.value) || 0;
        const expected = Number(expEl?.value) || 0;
        const newTotal = Number(totalEl?.value) || 0;

        const store = TVC_PMS.readStore();
        const rec = store[n.key] || { totalRunHours: 0 };
        const prevTotal = Number(rec.totalRunHours) || 0;
        rec.totalRunHours = newTotal;
        rec.prevMonth = add;
        rec.expectedNextMonth = expected;
        rec.updated = new Date().toLocaleString();
        store[n.key] = rec;
        TVC_PMS.writeStore(store);

        // 시간 기반 정비 항목 Due Date 재계산 + DB 저장
        const res = await TVC_PMS.updateMaintenanceSchedule(state, { persist: true });

        // 데이터 재로드 후 현재 탭 + 본 화면 갱신
        if (ctx.refresh) await ctx.refresh();
        render();

        const delta = newTotal - prevTotal;
        const deltaStr = delta ? `  (${delta > 0 ? '+' : ''}${delta.toLocaleString()} h)` : '';
        const resetMsg = newTotal === 0
            ? `\n↺ Total Run Hours = 0 → Original / Work Plan Due Date 원복\n`
            : '';
        alert(
            `${n.label}\n` +
            `Total Run Hours: ${newTotal.toLocaleString()} h${deltaStr}\n` +
            (add ? `Prev. Month: +${add.toLocaleString()} h\n` : '') +
            `Expected Next Month: ${expected.toLocaleString()} h${resetMsg}\n` +
            `시간 기반 정비 ${res.changed}건의 Due Date를 ${newTotal === 0 ? '원복' : '재계산'}했습니다.\n(개발자 콘솔 로그에서 상세 확인 가능)`
        );
    }

    return { init, render, preview, totalEdit, save };
})();
