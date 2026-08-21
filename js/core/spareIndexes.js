/* SPARE GROUP Tree index — independent from PMS idx.groupNodes */
const TVC_SpareIndexes = (function () {
    function groupKey(dept, label) {
        return `${dept || ''}|${String(label || '').trim()}`;
    }

    function deptFromSpare(spare) {
        const cat = String(spare?.category || '').toUpperCase();
        if (cat === 'DECK' || cat === 'ENGINE') return cat;
        return 'ENGINE';
    }

    function spareCountForGroup(spares, dept, label) {
        const lab = String(label || '').trim();
        if (!lab) return 0;
        return (spares || []).filter(s => {
            if (String(s.group || '').trim() !== lab) return false;
            const d = deptFromSpare(s);
            return !dept || d === dept;
        }).length;
    }

    /** Build SPARE GROUP Tree nodes from spare_groups + spare_parts.group labels. */
    function buildSpareGroupTree(spareGroupDefs, spares) {
        const nodes = [];
        const seen = new Set();

        (spareGroupDefs || []).forEach(g => {
            if (String(g.item_sort1 || '').trim()) return;
            const label = String(g.label || '').trim();
            if (!label) return;
            const dept = g.department || 'ENGINE';
            const key = groupKey(dept, label);
            if (seen.has(key)) return;
            seen.add(key);
            const count = spareCountForGroup(spares, dept, label);
            nodes.push({
                key,
                department: dept,
                label,
                spareCount: count,
                isEmpty: count === 0,
            });
        });

        (spares || []).forEach(s => {
            const label = String(s.group || '').trim();
            if (!label) return;
            const dept = deptFromSpare(s);
            const key = groupKey(dept, label);
            if (seen.has(key)) return;
            seen.add(key);
            nodes.push({
                key,
                department: dept,
                label,
                spareCount: spareCountForGroup(spares, dept, label),
                isEmpty: false,
            });
        });

        nodes.sort((a, b) => {
            const deptOrder = (d) => (d === 'DECK' ? 0 : d === 'ENGINE' ? 1 : 9);
            const dc = deptOrder(a.department) - deptOrder(b.department);
            return dc || a.label.localeCompare(b.label);
        });
        return nodes;
    }

    return { buildSpareGroupTree, groupKey, deptFromSpare };
})();
