/* THE VESSEL CODE — Admin one-click Release (build + export) */
const TVC_AdminRelease = (function () {
    function isAdminUser(user) {
        return !!(user && typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isAdminAccount?.(user));
    }

    function requireElectron() {
        if (!window.tvcElectron?.getReleaseInfo) {
            throw new Error('Release requires Electron Admin Mode.');
        }
    }

    function formatBytes(n) {
        const b = Number(n) || 0;
        if (b >= 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
        if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
        if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
        return `${b} B`;
    }

    function artifactSummary(artifacts) {
        if (!artifacts) return { setups: 0, hasZip: false, hasHandoff: false };
        return {
            setups: (artifacts.setups || []).length,
            hasZip: !!artifacts.appUpdateZip,
            hasHandoff: !!artifacts.handoff,
            zipName: artifacts.appUpdateZip?.filename || null,
            handoffName: artifacts.handoff?.filename || null,
        };
    }

    async function getInfo() {
        requireElectron();
        const r = await window.tvcElectron.getReleaseInfo();
        if (!r?.ok) throw new Error(r?.error || 'Could not read release info.');
        return r;
    }

    async function listArtifacts() {
        requireElectron();
        const r = await window.tvcElectron.listReleaseArtifacts();
        if (!r?.ok) throw new Error(r?.error || 'Could not list release artifacts.');
        return r.artifacts;
    }

    async function runBuild(onLog) {
        requireElectron();
        let unsub = null;
        if (typeof onLog === 'function' && window.tvcElectron.onReleaseLog) {
            unsub = window.tvcElectron.onReleaseLog(onLog);
        }
        try {
            const r = await window.tvcElectron.runAdminRelease();
            if (!r?.ok) throw new Error(r?.error || 'Release build failed.');
            return r;
        } finally {
            if (typeof unsub === 'function') unsub();
        }
    }

    async function cancelBuild() {
        if (!window.tvcElectron?.cancelAdminRelease) return { ok: false };
        return window.tvcElectron.cancelAdminRelease();
    }

    async function exportArtifacts(opts = {}) {
        requireElectron();
        const r = await window.tvcElectron.exportReleaseArtifacts({
            version: opts.version,
            subfolder: opts.subfolder,
            includeSetups: opts.includeSetups !== false,
            includeAppUpdate: opts.includeAppUpdate !== false,
            includeHandoff: opts.includeHandoff !== false,
        });
        if (!r?.ok) throw new Error(r?.error || 'Export failed.');
        return r;
    }

    function buildDeployRecords(companyId, version, skus, { recordSetup = false, recordUpdate = true } = {}) {
        const out = [];
        const co = String(companyId || '').trim();
        const ver = String(version || '').trim();
        if (!co || !ver) return out;
        const list = Array.isArray(skus) && skus.length
            ? skus
            : ['HQ_OFFICE', 'VESSEL_MASTER', 'VESSEL_ENGINE', 'VESSEL_DECK'];
        if (recordSetup) {
            out.push({ companyId: co, kind: 'setup', appVersion: ver });
        }
        if (recordUpdate) {
            for (const sku of list) {
                out.push({ companyId: co, kind: 'update', sku, appVersion: ver });
            }
        }
        return out;
    }

    return {
        isAdminUser,
        formatBytes,
        artifactSummary,
        getInfo,
        listArtifacts,
        runBuild,
        cancelBuild,
        exportArtifacts,
        buildDeployRecords,
    };
})();
