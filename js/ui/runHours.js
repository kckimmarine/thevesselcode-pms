/* THE VESSEL CODE — Running Hours UI
 *
 * 시간 기반 관리 장비(M/E, No.1~3 G/E)의 가동시간을 입력/누적하고,
 * TVC_PMS.updateMaintenanceSchedule 로 Due Date 를 재계산한다.
 */
const TVC_RunHours = (function () {
    let ctx = null; // { getState: () => state, refresh: async () => {} }
    let revertSnapshot = null;
    let inputEditMode = false;

    function init(context) { ctx = context; }

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function todayYmd() {
        return new Date().toISOString().slice(0, 10);
    }

    function formatUpdatedDate(raw) {
        if (!raw) return '';
        const s = String(raw).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    }

    function readLastUpdatedDate(store) {
        const s = store || TVC_PMS.readStore();
        return formatUpdatedDate(s._lastUpdatedDate || '');
    }

    function syncLastUpdatedField(store) {
        const el = document.getElementById('rhLastUpdated');
        if (!el) return;
        el.value = readLastUpdatedDate(store);
    }

    function hasPendingRevert() {
        return !!revertSnapshot;
    }

    function canEditRh() {
        return ctx?.canEditRunningHours ? ctx.canEditRunningHours() : true;
    }

    function rhEditLockTip() {
        return 'Running Hours Update는 Chief engineer (ce) · Superintendent (hq)만 사용할 수 있습니다.';
    }

    function updateRevertButtonState() {
        const btn = document.getElementById('rhRevertBtn');
        if (btn) btn.disabled = !canEditRh() || !revertSnapshot;
    }

    function syncRhToolbarUi() {
        const editable = canEditRh();
        const canUpdate = editable && !revertSnapshot && (inputEditMode || (ctx?.canUpdateRunningHours ? ctx.canUpdateRunningHours() : true));
        const updateBtn = document.getElementById('rhUpdateBtn');
        if (updateBtn) {
            updateBtn.disabled = !canUpdate;
            updateBtn.textContent = inputEditMode ? '↻ Apply Update' : '↻ Update';
            if (!editable) {
                updateBtn.title = rhEditLockTip();
            } else if (revertSnapshot) {
                updateBtn.title = 'Running Hours Update가 완료되었습니다. Revert 후 다시 Update할 수 있습니다.';
            } else if (!inputEditMode && ctx?.allWorkHistoryConfirmed && !ctx.allWorkHistoryConfirmed()) {
                updateBtn.title = 'Work History의 모든 항목이 Confirm된 후 Update할 수 있습니다.';
            } else if (inputEditMode) {
                updateBtn.title = '입력 후 Apply Update를 눌러 저장합니다.';
            } else {
                updateBtn.title = 'Update를 눌러 입력을 시작합니다.';
            }
        }
        updateRevertButtonState();
        if (ctx?.onRhToolbarChange) ctx.onRhToolbarChange();
    }

    /** Running Hours는 Engine 전용. HQ All에서도 Engine만, Deck 부서에서는 비표시. */
    function runningHoursDepartment(state) {
        if (state?.department === 'DECK') return null;
        return 'ENGINE';
    }

    /** 시간 기반 관리 대상 장비 그룹만 추출 (Engine 전용) */
    function trackedNodes(state) {
        const dept = runningHoursDepartment(state);
        if (!dept) return [];
        return (state.idx?.groupNodes || []).filter(n =>
            TVC_PMS.isTrackedGroup(n.label) &&
            n.department === dept
        );
    }

    function render() {
        const state = ctx.getState();
        const body = document.getElementById('runHrsBody');
        if (!body || !state.idx) return;

        const store = TVC_PMS.readStore();
        const nodes = trackedNodes(state);
        state._rhNodes = nodes;

        syncLastUpdatedField(store);
        syncRhToolbarUi();

        const fieldsEditable = canEditRh() && inputEditMode && !revertSnapshot;
        const ro = fieldsEditable ? '' : ' readonly tabindex="-1"';

        if (!nodes.length) {
            body.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center">No run-hour tracked equipment for this view. (Only M/E and No.1~3 G/E are time-based.)</td></tr>';
            return;
        }

        body.innerHTML = nodes.map((n, i) => {
            const rec = store[n.key] || {};
            const total = Number(rec.totalRunHours) || 0;
            const hourJobs = n.jobIds.filter(id => TVC_PMS.isRunHourJob(state.idx.jobById.get(id))).length;
            return `<tr>
                <td class="rh-equip"><strong>${esc(n.label)}</strong></td>
                <td class="rh-jobs">${hourJobs}</td>
                <td class="rh-prev"><input type="number" min="0" step="1" class="rh-input${fieldsEditable ? '' : ' rh-readonly'}" id="rh-prev-${i}" placeholder="0"${ro}
                    oninput="TVC_App.runHrsPreview(${i})"></td>
                <td class="rh-total-cell"><input type="number" min="0" step="1" class="rh-input rh-total${fieldsEditable ? '' : ' rh-readonly'}" id="rh-total-${i}"
                    data-base="${total}" value="${total}"${ro}
                    oninput="TVC_App.runHrsTotalEdit(${i})"></td>
                <td class="rh-exp"><input type="number" min="0" step="1" class="rh-input${fieldsEditable ? '' : ' rh-readonly'}" id="rh-exp-${i}"
                    value="${rec.expectedNextMonth ?? ''}" placeholder="0"${ro}></td>
            </tr>`;
        }).join('');
    }

    /** Actual Run Hours Previous Month 입력 시 Total Run Hours 실시간 합산 미리보기 */
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

    function collectRowInput(i) {
        const prevEl = document.getElementById('rh-prev-' + i);
        const totalEl = document.getElementById('rh-total-' + i);
        const expEl = document.getElementById('rh-exp-' + i);
        return {
            add: Number(prevEl?.value) || 0,
            newTotal: Number(totalEl?.value) || 0,
            expected: Number(expEl?.value) || 0,
        };
    }

    /** Update: 1st click → unlock inputs; 2nd click (Apply Update) → save */
    async function updateAll() {
        if (!canEditRh()) {
            alert(rhEditLockTip());
            return;
        }
        const state = ctx.getState();
        const nodes = state._rhNodes || trackedNodes(state);
        if (!nodes.length) return;

        if (revertSnapshot) {
            alert('Running Hours Update가 이미 완료되었습니다.\nRevert 후 다시 Update할 수 있습니다.');
            return;
        }

        if (!inputEditMode) {
            if (ctx?.allWorkHistoryConfirmed && !ctx.allWorkHistoryConfirmed()) {
                const entries = ctx.workHistoryEntriesRaw ? ctx.workHistoryEntriesRaw() : [];
                const isConfirmed = ctx.isWorkHistoryEntryConfirmed;
                const unconfirmed = isConfirmed
                    ? entries.filter(e => !isConfirmed(e)).length
                    : entries.length;
                alert(
                    `Work History에 Confirm되지 않은 항목이 ${unconfirmed}건 있습니다.\n` +
                    '모든 Work History 항목이 Confirm(또는 Approved/Submitted)된 후 Running Hours Update를 진행하세요.'
                );
                return;
            }
            inputEditMode = true;
            render();
            syncRhToolbarUi();
            return;
        }

        const storeBefore = TVC_PMS.readStore();
        revertSnapshot = {
            store: JSON.parse(JSON.stringify(storeBefore)),
            lastUpdatedDate: readLastUpdatedDate(storeBefore),
        };

        const store = TVC_PMS.readStore();
        const updatedYmd = todayYmd();
        const summaries = [];

        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const { add, newTotal, expected } = collectRowInput(i);
            const rec = store[n.key] || { totalRunHours: 0 };
            const prevTotal = Number(rec.totalRunHours) || 0;

            rec.totalRunHours = newTotal;
            rec.prevMonth = add;
            rec.expectedNextMonth = expected;
            rec.updated = updatedYmd;
            store[n.key] = rec;

            const delta = newTotal - prevTotal;
            if (delta || add || expected !== Number(storeBefore[n.key]?.expectedNextMonth || 0)) {
                const deltaStr = delta ? ` (${delta > 0 ? '+' : ''}${delta.toLocaleString()} h)` : '';
                summaries.push(`${n.label}: ${newTotal.toLocaleString()} h${deltaStr}`);
            }
        }

        store._lastUpdatedDate = updatedYmd;
        TVC_PMS.writeStore(store);

        inputEditMode = false;
        const res = await TVC_PMS.updateMaintenanceSchedule(state, { persist: true });
        if (ctx.refresh) await ctx.refresh();
        render();
        syncRhToolbarUi();

        const resetNote = summaries.some(s => s.includes(': 0 h'))
            ? '\n↺ Total Run Hours = 0 인 장비는 Work Plan Due Date가 원복됩니다.'
            : '';
        alert(
            `Running Hours updated · ${updatedYmd}\n\n` +
            (summaries.length ? summaries.join('\n') + '\n\n' : '') +
            `시간 기반 정비 ${res.changed}건의 Due Date를 재계산했습니다.${resetNote}\n` +
            `(개발자 콘솔 로그에서 상세 확인 가능)`
        );
    }

    /** 마지막 Update 이전 상태로 되돌림 */
    async function revert() {
        if (!canEditRh()) {
            alert(rhEditLockTip());
            return;
        }
        if (!revertSnapshot) {
            alert('되돌릴 Update 기록이 없습니다.');
            return;
        }
        if (!confirm('마지막 Running Hours Update를 되돌리시겠습니까?\nWork Plan Due Date도 이전 상태로 재계산됩니다.')) {
            return;
        }

        TVC_PMS.writeStore(JSON.parse(JSON.stringify(revertSnapshot.store)));
        revertSnapshot = null;
        inputEditMode = false;

        const state = ctx.getState();
        await TVC_PMS.updateMaintenanceSchedule(state, { persist: true });
        if (ctx.refresh) await ctx.refresh();
        render();
        syncRhToolbarUi();
        alert('Running Hours Update가 되돌려졌습니다.');
    }

    function resetInputEditMode() {
        inputEditMode = false;
    }

    /** @deprecated per-row save — use updateAll */
    async function save(i) { return updateAll(); }

    return { init, render, preview, totalEdit, updateAll, revert, save, hasPendingRevert, syncRhToolbarUi, resetInputEditMode };
})();
