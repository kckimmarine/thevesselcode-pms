/* ID / GROUP hash maps for O(1) lookup */
const TVC_Indexes = (function () {
    function build(state) {
        const jobById = new Map();
        const componentById = new Map();
        const jobsByGroupKey = new Map();
        const jobsByDepartment = new Map();
        const reportsByJobCode = new Map();
        const spareById = new Map();

        state.components.forEach(c => componentById.set(c.id, c));
        state.spares.forEach(s => spareById.set(s.id, s));

        state.jobs.forEach(j => {
            jobById.set(j.id, j);
            if (isDetachedCode(j.job_code)) return; // Import 격리 job — Work Plan 트리/목록에서 제외
            const gk = groupKey(j);
            if (!jobsByGroupKey.has(gk)) jobsByGroupKey.set(gk, []);
            jobsByGroupKey.get(gk).push(j.id);
            const dept = j.department || 'OTHER';
            if (!jobsByDepartment.has(dept)) jobsByDepartment.set(dept, []);
            jobsByDepartment.get(dept).push(j.id);
        });

        state.reports.forEach(r => {
            const codes = typeof TVC_WorkReport !== 'undefined'
                ? TVC_WorkReport.getJobCodes(r)
                : (r.job_code ? [r.job_code] : []);
            codes.forEach(code => {
                if (!code) return;
                if (!reportsByJobCode.has(code)) reportsByJobCode.set(code, []);
                reportsByJobCode.get(code).push(r);
            });
        });

        const groupNodes = buildGroupTree(state.jobs, jobsByGroupKey, state.groups);
        const spareGroupNodes = typeof TVC_SpareIndexes !== 'undefined'
            ? TVC_SpareIndexes.buildSpareGroupTree(state.spareGroups, state.spares)
            : [];

        return {
            jobById, componentById, jobsByGroupKey, jobsByDepartment,
            reportsByJobCode, spareById, groupNodes, spareGroupNodes,
        };
    }

    function normLabel(s) {
        return String(s ?? '').replace(/\s+/g, ' ').trim();
    }

    function groupKey(job) {
        return `${job.department || ''}|${normLabel(job?.group)}`;
    }

    function groupNoFromLabel(label) {
        const s = normLabel(label);
        const m = s.match(/^(\d{1,2})\./);
        return m ? m[1].padStart(2, '0') : '';
    }

    function groupNoFromJobCode(code) {
        const m = String(code || '').trim().match(/^(\d{1,2})-/);
        return m ? m[1].padStart(2, '0') : '';
    }

    function groupNoFromJob(job) {
        if (!job) return '';
        const code = String(job.job_code || '').startsWith('__tvc_')
            ? job.detached_from_code
            : job.job_code;
        return groupNoFromJobCode(code) || groupNoFromLabel(job.group);
    }

    function isDetachedCode(code) {
        return String(code || '').startsWith('__tvc_');
    }

    /**
     * 동일 GROUP NO 노드 병합.
     * - jobIds: JOB CODE 접두/라벨 기준 해당 번호 전체 job (라벨 불일치해도 누락 방지)
     * - key: 항상 department|정규화(label) — 선택 키와 job.group 매칭 안정화
     * - label: job이 가장 많이 붙은 이름 우선 (빈 UI 그룹이 이기지 않음)
     */
    function mergeGroupNodesByNumber(nodes, jobs) {
        const out = [];
        const byDeptNo = new Map();
        for (const n of nodes) {
            const gNo = groupNoFromLabel(n.label);
            if (!gNo) {
                out.push(n);
                continue;
            }
            const k = `${n.department}|${gNo}`;
            const prev = byDeptNo.get(k);
            if (!prev) {
                byDeptNo.set(k, {
                    department: n.department,
                    label: normLabel(n.label) || n.label,
                    candidates: [normLabel(n.label) || n.label],
                });
                continue;
            }
            const lab = normLabel(n.label) || n.label;
            if (lab && !prev.candidates.includes(lab)) prev.candidates.push(lab);
        }

        for (const [k, cluster] of byDeptNo) {
            const [dept, gNo] = k.split('|');
            const matched = (jobs || []).filter(j =>
                (j.department || '') === dept
                && groupNoFromJob(j) === gNo
                && !isDetachedCode(j.job_code)
            );
            const labelCounts = new Map();
            for (const j of matched) {
                const lab = normLabel(j.group);
                if (!lab) continue;
                labelCounts.set(lab, (labelCounts.get(lab) || 0) + 1);
            }
            let winner = cluster.candidates[cluster.candidates.length - 1] || `${gNo}.`;
            let best = -1;
            for (const [lab, count] of labelCounts) {
                if (count > best) {
                    best = count;
                    winner = lab;
                }
            }
            if (best <= 0) {
                for (const lab of cluster.candidates) {
                    if (labelCounts.has(lab) || matched.some(j => normLabel(j.group) === lab)) {
                        winner = lab;
                        break;
                    }
                }
            }
            const jobIds = matched.map(j => j.id);
            out.push({
                department: dept,
                label: winner,
                key: `${dept}|${winner}`,
                jobIds,
                isEmpty: jobIds.length === 0,
            });
        }

        out.sort((a, b) => {
            const deptOrder = (d) => (d === 'DECK' ? 0 : d === 'ENGINE' ? 1 : 9);
            const dc = deptOrder(a.department) - deptOrder(b.department);
            if (dc) return dc;
            const na = groupNoFromLabel(a.label);
            const nb = groupNoFromLabel(b.label);
            if (na && nb && na !== nb) return na.localeCompare(nb, undefined, { numeric: true });
            return a.label.localeCompare(b.label);
        });
        return out;
    }

    function buildGroupTree(jobs, jobsByGroupKey, groupDefs) {
        const nodes = [];
        const seen = new Set();
        jobs.forEach(j => {
            if (isDetachedCode(j.job_code)) return;
            const gk = groupKey(j);
            if (seen.has(gk)) return;
            seen.add(gk);
            nodes.push({
                key: gk,
                department: j.department,
                label: normLabel(j.group) || 'UNGROUPED',
                jobIds: jobsByGroupKey.get(gk) || [],
            });
        });
        (groupDefs || []).forEach(g => {
            const gk = groupKey({ department: g.department, group: g.label });
            if (seen.has(gk)) return;
            seen.add(gk);
            nodes.push({
                key: gk,
                department: g.department,
                label: normLabel(g.label) || 'UNGROUPED',
                jobIds: jobsByGroupKey.get(gk) || [],
                isEmpty: true,
            });
        });
        return mergeGroupNodesByNumber(nodes, jobs);
    }

    function isJobUnderGroup(job, groupKeyStr, jobById, nodeHint) {
        const j = typeof job === 'string' ? jobById.get(job) : job;
        if (!j || isDetachedCode(j.job_code)) return false;
        if (groupKey(j) === groupKeyStr) return true;
        const node = nodeHint || null;
        if (node?.jobIds?.includes(j.id)) return true;
        const nodeNo = groupNoFromLabel(node?.label);
        if (nodeNo && groupNoFromJob(j) === nodeNo && j.department === node?.department) return true;
        // selected key may be stale after rename — match by group number in key
        const keyNo = groupNoFromLabel(String(groupKeyStr || '').split('|').slice(1).join('|'));
        if (keyNo && groupNoFromJob(j) === keyNo) {
            const keyDept = String(groupKeyStr || '').split('|')[0];
            if (!keyDept || keyDept === (j.department || '')) return true;
        }
        return false;
    }

    /** selectedGroupKey가 트리에서 사라졌을 때 GROUP NO로 재연결 */
    function rematchGroupKey(selectedKey, groupNodes) {
        if (!selectedKey || !groupNodes?.length) return selectedKey;
        if (groupNodes.some(n => n.key === selectedKey)) return selectedKey;
        const pipe = String(selectedKey).indexOf('|');
        if (pipe < 0) return null;
        const dept = selectedKey.slice(0, pipe);
        const label = selectedKey.slice(pipe + 1);
        const gNo = groupNoFromLabel(label);
        if (!gNo) return null;
        const hit = groupNodes.find(n =>
            n.department === dept && groupNoFromLabel(n.label) === gNo
        );
        return hit ? hit.key : null;
    }

    return {
        build, groupKey, groupNoFromJob, groupNoFromLabel, isJobUnderGroup, rematchGroupKey,
        isDetachedCode,
    };
})();
