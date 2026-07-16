/* THE VESSEL CODE — Predictive Maintenance Engine (Run-hour based scheduling)
 *
 * 시간 기반(Run-hour based)으로 관리되는 정비 항목의 Due Date를 장비 가동시간으로 재계산한다.
 * - 대상 장비 그룹: 01. MAIN ENGINE, 03. No.1 G/E, 04. No.2 G/E, 05. No.3 G/E
 * - 대상 정비 항목: unit === 'H' (시간 주기)
 * - 공식: (주기 - 사이클 내 누적시간) / 예상 월간 운전시간 = 정비까지 남은 개월수
 */
const TVC_PMS = (function () {
    // 시간 기반으로 관리하는 장비 그룹 (GROUP 접두 번호 기준)
    const TRACKED_PREFIXES = ['01.', '03.', '04.', '05.'];
    const DAYS_PER_MONTH = 30.44;

    // 데이터 공간(Space) 분리: HQ와 선박(SHIP)은 Run-hour 저장소를 공유하지 않는다.
    // - 선박: scope = 'SHIP'
    // - HQ  : scope = 'HQ_<vesselId>'  (선박별 별도 저장소 → Import한 선박만 표시)
    let _scope = 'SHIP';

    /** 현재 데이터 공간 지정. HQ는 vesselId 별로 분리된다. */
    function setSpace(space, vesselId) {
        _scope = scopeOf(space, vesselId);
        if (_scope === 'SHIP') {
            // 레거시(비-namespaced) 데이터를 선박(SHIP) 공간으로 1회 이관
            try {
                const legacy = localStorage.getItem('tvc_run_hrs');
                if (legacy && !localStorage.getItem('tvc_run_hrs_SHIP')) {
                    localStorage.setItem('tvc_run_hrs_SHIP', legacy);
                }
            } catch (_) { /* ignore */ }
        }
    }

    function scopeOf(space, vesselId) {
        return space === 'HQ' ? `HQ_${vesselId || 'UNKNOWN'}` : 'SHIP';
    }

    function storeKey(scope) { return `tvc_run_hrs_${scope || _scope}`; }

    function normGroup(g) { return String(g || '').trim(); }

    /** "03.        No.1 GENERATOR ENGINE" → "03." */
    function groupPrefix(group) {
        const m = normGroup(group).match(/^(\d+)\s*\./);
        return m ? m[1].padStart(2, '0') + '.' : '';
    }

    /** 시간 기반 관리 대상 장비 그룹인가 */
    function isTrackedGroup(group) {
        return TRACKED_PREFIXES.includes(groupPrefix(group));
    }

    /** 시간 주기(H)로 관리되는 정비 항목인가 */
    function isRunHourJob(job) {
        return job && String(job.unit || '').toUpperCase() === 'H';
    }

    // ── Run-hour 저장소 (localStorage, groupKey 기준 · Space/선박별 분리) ──
    // scope 미지정 시 현재 활성 scope 사용. HQ는 'HQ_<vesselId>' 형태.
    function readStore(scope) {
        try { return JSON.parse(localStorage.getItem(storeKey(scope)) || '{}'); }
        catch { return {}; }
    }
    function writeStore(store, scope) {
        localStorage.setItem(storeKey(scope), JSON.stringify(store));
    }
    function getRecord(groupKey) {
        const s = readStore();
        return s[groupKey] || { totalRunHours: 0, prevMonth: 0, expectedNextMonth: 0, updated: null };
    }

    /** GROUP Tree 이름 변경 시 모든 Run-hour 저장소 scope에서 키 이전 */
    function renameGroupKey(oldKey, newKey) {
        if (!oldKey || !newKey || oldKey === newKey) return;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith('tvc_run_hrs')) continue;
                const store = JSON.parse(localStorage.getItem(k) || '{}');
                if (!store[oldKey]) continue;
                store[newKey] = store[oldKey];
                delete store[oldKey];
                localStorage.setItem(k, JSON.stringify(store));
            }
        } catch (e) {
            console.warn('[TVC_PMS] renameGroupKey', e);
        }
    }

    /** fromDate 기준으로 months(소수 허용) 개월 뒤 날짜(YYYY-MM-DD) */
    function addMonths(fromDateStr, months) {
        const d = new Date(fromDateStr);
        if (isNaN(d.getTime())) return fromDateStr;
        const days = Math.round(Number(months) * DAYS_PER_MONTH);
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
    }

    /** run-hour 스케줄 적용 전 원본 Due Date 보존 (Original / Actual Plan 복원용) */
    function ensureOriginalSnapshot(job) {
        if (!job.original_next_date && job.next_date) {
            job.original_next_date = job.next_date;
        }
    }

    function restoreRunHourJob(job, today) {
        const baseline = job.original_next_date || job.next_date;
        job.next_date = baseline;
        job.is_overdue = !!(baseline && new Date(baseline) < new Date(today));
        job.schedule_basis = null;
        delete job.run_hours_total;
        delete job.run_hours_expected;
    }

    /** 단일 정비 항목의 Due Date를 run-hour 데이터로 계산 (부수효과 없음) */
    function computeDueDate(job, rec, todayStr) {
        const period = Number(job.period) || 0;               // 정비 주기 (시간)
        const total = Number(rec.totalRunHours) || 0;         // 누적 총 가동시간
        const expected = Number(rec.expectedNextMonth) || 0;  // 예상 월간 운전시간
        if (period <= 0 || expected <= 0) return null;

        const intoCycle = total % period;                     // 현재 사이클 내 누적 가동시간
        const remaining = Math.max(0, period - intoCycle);    // 정비까지 남은 시간
        const months = remaining / expected;                  // 정비까지 남은 개월수
        const newDate = addMonths(todayStr, months);
        return { period, total, intoCycle, remaining, expected, months, newDate };
    }

    /**
     * 시간 기반 정비 항목 전체의 Due Date 재계산.
     * @param {object} state           TVC_App.state (state.jobs 사용)
     * @param {object} [opts]
     * @param {boolean} [opts.persist] true 면 IndexedDB(maintenance_jobs)에도 저장
     * @param {boolean} [opts.silent]  true 면 콘솔 로그 생략
     * @returns {Promise<{changed:number, log:Array}>}
     */
    async function updateMaintenanceSchedule(state, opts = {}) {
        const store = readStore();
        const today = new Date().toISOString().slice(0, 10);
        const log = [];
        const changed = [];

        for (const job of (state.jobs || [])) {
            if (!isRunHourJob(job) || !isTrackedGroup(job.group)) continue;
            if (job.schedule_basis === 'POSTPONE') continue;
            const key = TVC_Indexes.groupKey(job);
            const rec = store[key];
            if (!rec) continue;

            ensureOriginalSnapshot(job);
            const total = Number(rec.totalRunHours) || 0;

            if (total === 0) {
                const oldDate = job.next_date;
                const wasRunHour = job.schedule_basis === 'RUN_HOUR';
                restoreRunHourJob(job, today);
                if (wasRunHour || oldDate !== job.next_date) {
                    changed.push(job);
                    log.push({
                        job_code: job.job_code,
                        group: normGroup(job.group),
                        reset: true,
                        oldDate,
                        newDate: job.next_date,
                    });
                }
                continue;
            }

            const calc = computeDueDate(job, rec, today);
            if (!calc) continue;

            const oldDate = job.next_date;
            job.next_date = calc.newDate;
            job.is_overdue = new Date(calc.newDate) < new Date(today);
            job.run_hours_total = calc.total;
            job.run_hours_expected = calc.expected;
            job.schedule_basis = 'RUN_HOUR';
            changed.push(job);

            log.push({
                job_code: job.job_code,
                group: normGroup(job.group),
                period: calc.period,
                total: calc.total,
                intoCycle: calc.intoCycle,
                remaining: calc.remaining,
                expected: calc.expected,
                months: Math.round(calc.months * 100) / 100,
                oldDate,
                newDate: calc.newDate,
            });
        }

        if (opts.persist && changed.length && typeof TVC_DB !== 'undefined') {
            for (const job of changed) {
                job.updated_at = new Date().toISOString();
                job.sync_status = job.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (job.sync_status || 'LOCAL');
                await TVC_DB.put('maintenance_jobs', job);
            }
        }

        if (!opts.silent && log.length) {
            console.groupCollapsed(`⏱️ [TVC_PMS] updateMaintenanceSchedule — ${log.length} run-hour job(s) recalculated`);
            log.forEach(l => {
                if (l.reset) {
                    console.log(`${l.job_code} · ${l.group}\n   ↺ RESET (Total Run Hours = 0) | Due: ${l.oldDate || '—'} ⇒ ${l.newDate}`);
                    return;
                }
                console.log(
                    `${l.job_code} · ${l.group}\n` +
                    `   period ${l.period}h | total ${l.total}h | into-cycle ${l.intoCycle}h | remaining ${l.remaining}h | expected ${l.expected}h/mo\n` +
                    `   → ${l.months} month(s) | Due: ${l.oldDate || '—'} ⇒ ${l.newDate}`
                );
            });
            console.groupEnd();
        }

        return { changed: changed.length, log };
    }

    /**
     * confirmTask — 정비 Task 완료 시 연결 부품 currentStock 자동 차감.
     * currentStock < minStock 이면 spareRequest 청구 제안 이벤트 발생.
     */
    async function confirmTask(api, job, requiredParts, opts = {}) {
        const alerts = [];
        let deducted = 0;
        const forceOk = !!opts.forceOk;
        const ref = opts.ref || job?.job_code || '';

        for (const line of requiredParts || []) {
            const id = line.spare_part_id || line.sparePartId;
            const qty = Number(line.qty_used ?? line.qty) || 0;
            if (!id || qty <= 0) continue;

            const spare = await api.get('spare_parts', id);
            if (!spare) continue;

            const onHand = Number(spare.qty_on_hand) || 0;
            if (onHand < qty && !forceOk) {
                throw Object.assign(new Error('INSUFFICIENT_STOCK'), { code: 'STOCK', part: spare.part_no });
            }

            spare.qty_on_hand = Math.max(0, onHand - qty);
            spare.qty_working = (Number(spare.qty_working) || 0) + qty;
            spare.history = Array.isArray(spare.history) ? spare.history : [];
            spare.history.push({
                at: new Date().toISOString(),
                type: 'TASK_CONFIRM',
                qty: -qty,
                ref,
                note: `Task ${ref} confirmed`,
            });
            spare.updated_at = new Date().toISOString();
            spare.sync_status = spare.sync_status === 'SYNCED' ? 'PENDING_SYNC' : (spare.sync_status || 'LOCAL');
            await api.put('spare_parts', spare);
            deducted++;

            const minS = Number(spare.min_qty ?? spare.standard_stock ?? 0) || 0;
            if (spare.qty_on_hand < minS) {
                alerts.push({
                    sparePartId: spare.id,
                    partNo: spare.part_no,
                    name: spare.name,
                    stock: spare.qty_on_hand,
                    minStock: minS,
                    jobCode: ref,
                });
            }
        }

        if (alerts.length && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tvc:spics-requisition-suggest', { detail: { alerts, jobCode: ref } }));
        }

        return { alerts, deducted };
    }

    /**
     * confirmBatchTasks — 다중 Job Code에 대해 confirmTask를 순차 수행 (재고 개별 차감).
     * @param {object} api — IndexedDB transaction api
     * @param {Array<{job: object, usedParts?: Array, requiredParts?: Array}>} tasks
     * @param {object} [opts]
     */
    async function confirmBatchTasks(api, tasks, opts = {}) {
        const allAlerts = [];
        let totalDeducted = 0;
        for (const task of tasks || []) {
            if (!task?.job) continue;
            const parts = task.usedParts || task.requiredParts || [];
            const { alerts, deducted } = await confirmTask(api, task.job, parts, {
                ...opts,
                ref: task.job.job_code,
            });
            if (alerts?.length) allAlerts.push(...alerts);
            totalDeducted += deducted || 0;
        }
        return { alerts: allAlerts, deducted: totalDeducted };
    }

    /** @deprecated alias */ async function confirmWorkCompletion(api, job, requiredParts, opts) {
        return confirmTask(api, job, requiredParts, opts);
    }

    return {
        TRACKED_PREFIXES,
        setSpace,
        scopeOf,
        groupPrefix,
        isTrackedGroup,
        isRunHourJob,
        readStore,
        writeStore,
        getRecord,
        renameGroupKey,
        addMonths,
        ensureOriginalSnapshot,
        restoreRunHourJob,
        computeDueDate,
        updateMaintenanceSchedule,
        confirmTask,
        confirmBatchTasks,
        confirmWorkCompletion,
    };
})();
