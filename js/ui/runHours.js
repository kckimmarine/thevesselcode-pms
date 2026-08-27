/* THE VESSEL CODE — Running Hours UI
 *
 * 월간 Update: Last Month Run Hours 입력 → Total 자동 합산(저장 Total + Last)
 * → Estimated Run Hours Next month 로 NEXT DATE 재계산 (TVC_PMS.updateMaintenanceSchedule).
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
        return 'Running Hours Update requires Chief Engineer (ce) or Superintendent (hq) permission.';
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
                updateBtn.title = 'Running Hours update is complete. Use Revert to update again.';
            } else if (!inputEditMode && ctx?.allWorkHistoryConfirmed && !ctx.allWorkHistoryConfirmed()) {
                updateBtn.title = 'Work History: confirm Maintenance/Postpone before Update. (Defect excluded)';
            } else if (inputEditMode) {
                updateBtn.title = 'Enter values, then click Apply Update to save.';
            } else {
                updateBtn.title = 'Click Update to begin entering values.';
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
            const totalCls = ['rh-total', 'rh-total-display', fieldsEditable ? 'rh-total-auto' : 'rh-readonly'].filter(Boolean).join(' ');
            return `<tr>
                <td class="rh-equip"><strong>${esc(n.label)}</strong></td>
                <td class="rh-jobs">${hourJobs}</td>
                <td class="rh-prev"><input type="number" min="0" step="1" class="rh-input${fieldsEditable ? '' : ' rh-readonly'}" id="rh-prev-${i}" placeholder="0"${ro}
                    oninput="TVC_App.runHrsPreview(${i})"></td>
                <td class="rh-total-cell"><span class="${totalCls}" id="rh-total-${i}" data-base="${total}" aria-label="Total Run Hours (auto)">${total.toLocaleString()}</span></td>
                <td class="rh-exp"><input type="number" min="0" step="1" class="rh-input${fieldsEditable ? '' : ' rh-readonly'}" id="rh-exp-${i}"
                    value="${rec.expectedNextMonth ?? ''}" placeholder="0"${ro}></td>
            </tr>`;
        }).join('');
    }

    function syncTotalDisplay(i) {
        const prevEl = document.getElementById('rh-prev-' + i);
        const totalEl = document.getElementById('rh-total-' + i);
        if (!totalEl) return;
        const base = Number(totalEl.dataset.base) || 0;
        const add = Number(prevEl?.value) || 0;
        const next = base + add;
        totalEl.textContent = next.toLocaleString();
        totalEl.classList.toggle('rh-total-live', add !== 0);
    }

    /** Last Month Run Hours 입력 시 Total Run Hours 자동 합산 표시 */
    function preview(i) {
        syncTotalDisplay(i);
    }

    function collectRowInput(i) {
        const prevEl = document.getElementById('rh-prev-' + i);
        const totalEl = document.getElementById('rh-total-' + i);
        const expEl = document.getElementById('rh-exp-' + i);
        const base = Number(totalEl?.dataset.base) || 0;
        const add = Number(prevEl?.value) || 0;
        return {
            add,
            newTotal: base + add,
            expected: Number(expEl?.value) || 0,
        };
    }

    /** Run-hour job Work Plan fields — Revert 시 Update 직전 NEXT DATE 복원용 */
    function snapshotRunHourJobs(state) {
        const out = [];
        for (const job of (state.jobs || [])) {
            if (!TVC_PMS.isRunHourJob(job) || !TVC_PMS.isTrackedGroup(job.group)) continue;
            if (job.schedule_basis === 'POSTPONE') continue;
            out.push({
                id: job.id,
                next_date: job.next_date ?? null,
                is_overdue: !!job.is_overdue,
                schedule_basis: job.schedule_basis ?? null,
                original_next_date: job.original_next_date ?? null,
                run_hours_total: job.run_hours_total ?? null,
                run_hours_expected: job.run_hours_expected ?? null,
            });
        }
        return out;
    }

    async function restoreRunHourJobSnapshots(state, snapshots) {
        if (!snapshots?.length || typeof TVC_DB === 'undefined') return 0;
        const byId = new Map((state.jobs || []).map(j => [j.id, j]));
        const ts = new Date().toISOString();
        let n = 0;
        for (const snap of snapshots) {
            const job = byId.get(snap.id);
            if (!job) continue;
            job.next_date = snap.next_date;
            job.is_overdue = snap.is_overdue;
            job.schedule_basis = snap.schedule_basis;
            job.original_next_date = snap.original_next_date;
            if (snap.run_hours_total != null) job.run_hours_total = snap.run_hours_total;
            else delete job.run_hours_total;
            if (snap.run_hours_expected != null) job.run_hours_expected = snap.run_hours_expected;
            else delete job.run_hours_expected;
            job.updated_at = ts;
            job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
            await TVC_DB.put('maintenance_jobs', job);
            n++;
        }
        return n;
    }

    /** Update: 1st click → unlock inputs; 2nd click (Apply Update) → save */
    async function updateAll() {
        if (!canEditRh()) {
            await TVC_Dialog.alert(rhEditLockTip());
            return;
        }
        const state = ctx.getState();
        const nodes = state._rhNodes || trackedNodes(state);
        if (!nodes.length) return;

        if (revertSnapshot) {
            await TVC_Dialog.alert(
                'Running Hours update is already complete.\nUse Revert to update again.'
            );
            return;
        }

        if (!inputEditMode) {
            if (ctx?.allWorkHistoryConfirmed && !ctx.allWorkHistoryConfirmed()) {
                const pending = typeof ctx.getMonthlyRhGatePendingEntries === 'function'
                    ? ctx.getMonthlyRhGatePendingEntries()
                    : [];
                const unconfirmed = pending.length
                    || (ctx.workHistoryEntriesRaw
                        ? ctx.workHistoryEntriesRaw().filter(e => ctx.isWorkHistoryEntryConfirmed && !ctx.isWorkHistoryEntryConfirmed(e)).length
                        : 0);
                await TVC_Dialog.alert(
                    `Monthly prep: ${unconfirmed} unfinished Work History item(s)\n` +
                    '· Maintenance / Postpone → Confirm\n' +
                    '· Defect reports are separate (not an RH gate)\n' +
                    'Complete them before Running Hours Update.'
                );
                return;
            }
            inputEditMode = true;
            render();
            syncRhToolbarUi();
            return;
        }

        const storeBefore = TVC_PMS.readStore();
        const needsEstimate = [];
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const hourJobs = n.jobIds.filter(id => TVC_PMS.isRunHourJob(state.idx.jobById.get(id))).length;
            if (!hourJobs) continue;
            const { add, expected } = collectRowInput(i);
            const rec = storeBefore[n.key] || {};
            const prevTotal = Number(rec.totalRunHours) || 0;
            const willRecalc = add > 0 || prevTotal > 0;
            if (willRecalc && expected <= 0) needsEstimate.push(n.label);
        }
        if (needsEstimate.length) {
            await TVC_Dialog.alert(
                'Enter Estimated Run Hours Next month for equipment with run-hour jobs.\n\n' +
                needsEstimate.join('\n')
            );
            return;
        }

        revertSnapshot = {
            store: JSON.parse(JSON.stringify(storeBefore)),
            lastUpdatedDate: readLastUpdatedDate(storeBefore),
            jobs: snapshotRunHourJobs(state),
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
            ? '\nEquipment with Total Run Hours = 0 will restore Work Plan due dates.'
            : '';
        await TVC_Dialog.alert(
            `Running Hours updated · ${updatedYmd}\n\n` +
            (summaries.length ? summaries.join('\n') + '\n\n' : '') +
            `Recalculated NEXT DATE for ${res.changed} run-hour job(s) using Estimated monthly hours.${resetNote}`
        );
    }

    /** 마지막 Update 이전 상태로 되돌림 */
    async function revert() {
        if (!canEditRh()) {
            await TVC_Dialog.alert(rhEditLockTip());
            return;
        }
        if (!revertSnapshot) {
            await TVC_Dialog.alert('No update record to revert.');
            return;
        }
        if (!await TVC_Dialog.confirm({
            kind: 'warning',
            message: 'Revert the last Running Hours update?\nWork Plan NEXT DATE values will return to their pre-update state.',
        })) {
            return;
        }

        const jobSnaps = revertSnapshot.jobs || [];
        TVC_PMS.writeStore(JSON.parse(JSON.stringify(revertSnapshot.store)));
        revertSnapshot = null;
        inputEditMode = false;

        const state = ctx.getState();
        await restoreRunHourJobSnapshots(state, jobSnaps);
        state._skipRhRecalcOnce = true;
        if (ctx.refresh) await ctx.refresh();
        state._skipRhRecalcOnce = false;
        render();
        syncRhToolbarUi();
        await TVC_Dialog.alert('Running Hours update reverted.');
    }

    function resetInputEditMode() {
        inputEditMode = false;
    }

    /**
     * Work Plan Update 확정 후 호출.
     * RH→Plan 구간의 Revert 세션만 종료하고, 저장된 Running Hours 값은 유지한다.
     * (확정 후에도 Update가 Revert 때문에 계속 막히는 문제 방지)
     */
    function clearRevertAfterPlanLock() {
        revertSnapshot = null;
        inputEditMode = false;
        syncRhToolbarUi();
    }

    /** @deprecated per-row save — use updateAll */
    async function save(i) { return updateAll(); }

    return {
        init, render, preview, updateAll, revert, save,
        hasPendingRevert, syncRhToolbarUi, resetInputEditMode, clearRevertAfterPlanLock,
    };
})();
