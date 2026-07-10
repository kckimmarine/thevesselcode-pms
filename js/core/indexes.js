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

        return {
            jobById, componentById, jobsByGroupKey, jobsByDepartment,
            reportsByJobCode, spareById, groupNodes,
        };
    }

    function groupKey(job) {
        return `${job.department || ''}|${(job.group || '').trim()}`;
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
        nodes.sort((a, b) => a.department.localeCompare(b.department) || a.label.localeCompare(b.label));
        return nodes;
    }

    function isJobUnderGroup(job, groupKeyStr, jobById) {
        const j = typeof job === 'string' ? jobById.get(job) : job;
        if (!j) return false;
        return groupKey(j) === groupKeyStr;
    }

    return { build, groupKey, isJobUnderGroup };
})();
