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

    function groupKey(job) {
        const g = String(job?.group ?? '').replace(/\s+/g, ' ').trim();
        return `${job.department || ''}|${g}`;
    }

    function groupNoFromLabel(label) {
        const s = String(label ?? '').replace(/\s+/g, ' ').trim();
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

    function mergeGroupNodesByNumber(nodes) {
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
                byDeptNo.set(k, { ...n, jobIds: [...(n.jobIds || [])] });
                continue;
            }
            const mergedIds = [...new Set([...(prev.jobIds || []), ...(n.jobIds || [])])];
            let pick = (prev.jobIds?.length || 0) >= (n.jobIds?.length || 0) ? prev : n;
            if (!mergedIds.length) pick = n;
            byDeptNo.set(k, {
                department: pick.department,
                label: pick.label,
                key: pick.key,
                jobIds: mergedIds,
                isEmpty: mergedIds.length === 0,
            });
        }
        out.push(...byDeptNo.values());
        out.sort((a, b) => {
            const deptOrder = (d) => (d === 'DECK' ? 0 : d === 'ENGINE' ? 1 : 9);
            const dc = deptOrder(a.department) - deptOrder(b.department);
            return dc || a.label.localeCompare(b.label);
        });
        return out;
    }

    function buildGroupTree(jobs, jobsByGroupKey, groupDefs) {
        const nodes = [];
        const seen = new Set();
        jobs.forEach(j => {
            const gk = groupKey(j);
            if (seen.has(gk)) return;
            seen.add(gk);
            nodes.push({
                key: gk,
                department: j.department,
                label: (j.group || '').trim() || 'UNGROUPED',
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
                label: (g.label || '').trim() || 'UNGROUPED',
                jobIds: jobsByGroupKey.get(gk) || [],
                isEmpty: true,
            });
        });
        return mergeGroupNodesByNumber(nodes);
    }

    function isJobUnderGroup(job, groupKeyStr, jobById, nodeHint) {
        const j = typeof job === 'string' ? jobById.get(job) : job;
        if (!j) return false;
        if (groupKey(j) === groupKeyStr) return true;
        const node = nodeHint || null;
        if (node?.jobIds?.includes(j.id)) return true;
        const nodeNo = groupNoFromLabel(node?.label);
        if (nodeNo && groupNoFromJob(j) === nodeNo && j.department === node?.department) return true;
        return false;
    }

    return { build, groupKey, groupNoFromJob, groupNoFromLabel, isJobUnderGroup };
})();
