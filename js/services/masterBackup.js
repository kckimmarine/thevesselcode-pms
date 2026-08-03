/* THE VESSEL CODE — Master Data Backup / Restore (Menu PMS · SPARE) */
const TVC_MasterBackup = (function () {
    const KIND = 'TVC_MASTER_BACKUP';
    const VERSION = 1;

    const SCOPE = {
        PMS: 'pms',
        SPARE: 'spare',
    };

    const PMS_STORES = [
        'maintenance_jobs',
        'maintenance_groups',
        'ship_components',
        'job_bom',
    ];

    const SPARE_STORES = [
        'spare_parts',
        'universal_catalog',
    ];

    const PMS_META_KEYS = [
        TVC_META_KEYS.ORIGINAL_PLAN_LOCK,
        TVC_META_KEYS.ORIGINAL_PLAN_UPDATE,
    ];

    const SPARE_META_KEYS = [
        TVC_META_KEYS.INVENTORY_IMPORT,
        TVC_META_KEYS.INVENTORY_XLS_LOADED,
        TVC_META_KEYS.INVENTORY_DEFAULTS,
        TVC_META_KEYS.SPICS_SYNC,
    ];

    function storesFor(scope) {
        return scope === SCOPE.SPARE ? SPARE_STORES : PMS_STORES;
    }

    function metaKeysFor(scope) {
        return scope === SCOPE.SPARE ? SPARE_META_KEYS : PMS_META_KEYS;
    }

    function scopeLabel(scope) {
        return scope === SCOPE.SPARE ? 'SPARE Master Data' : 'PMS Master Data';
    }

    function downloadBlob(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    function stamp() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
    }

    async function resolveVesselId(user, opts = {}) {
        if (opts.vesselId) return opts.vesselId;
        if (user && TVC_RBAC.isHqAccount(user) && opts.selectedVesselId) return opts.selectedVesselId;
        return (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || user?.vessel_id || 'SHIP';
    }

    async function collectMeta(keys) {
        const meta = {};
        for (const key of keys) {
            const value = await TVC_DB.getMeta(key);
            if (value !== undefined && value !== null) meta[key] = value;
        }
        return meta;
    }

    async function collectStores(storeNames) {
        const stores = {};
        for (const name of storeNames) {
            stores[name] = await TVC_DB.getAll(name).catch(() => []);
        }
        return stores;
    }

    async function buildPayload(scope, user, opts = {}) {
        const vesselId = await resolveVesselId(user, opts);
        const stores = await collectStores(storesFor(scope));
        const meta = await collectMeta(metaKeysFor(scope));
        const payload = {
            kind: KIND,
            version: VERSION,
            scope,
            exported_at: new Date().toISOString(),
            vessel_id: vesselId,
            account_type: user?.account_type || '',
            exported_by: user?.username || '',
            stores,
            meta,
        };
        if (scope === SCOPE.PMS && typeof TVC_PMS !== 'undefined') {
            payload.run_hours = TVC_PMS.readStore();
        }
        return payload;
    }

    async function exportBackup(scope, user, opts = {}) {
        if (!scope || (scope !== SCOPE.PMS && scope !== SCOPE.SPARE)) {
            throw new Error('Backup scope가 올바르지 않습니다. (pms / spare)');
        }
        if (typeof JSZip === 'undefined') throw new Error('JSZip이 로드되지 않았습니다.');
        const payload = await buildPayload(scope, user, opts);
        const zip = new JSZip();
        zip.file('tvc_master_backup.json', JSON.stringify(payload, null, 2));
        zip.file('README.txt', [
            'THE VESSEL CODE — Master Data Backup',
            `Scope: ${scopeLabel(scope)}`,
            `Vessel: ${payload.vessel_id}`,
            `Exported: ${payload.exported_at}`,
            '',
            'Restore: Menu/SPARE → Database Backup & Restore → Restore',
        ].join('\n'));
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const tag = scope === SCOPE.SPARE ? 'SPARE_MASTER_BACKUP' : 'PMS_MASTER_BACKUP';
        const filename = `${payload.vessel_id}_${tag}_${stamp()}.zip`;
        downloadBlob(blob, filename);
        const counts = Object.fromEntries(
            Object.entries(payload.stores).map(([k, rows]) => [k, (rows || []).length])
        );
        return { filename, vesselId: payload.vessel_id, scope, counts };
    }

    async function parseBackupFile(file) {
        if (!file) throw new Error('파일이 없습니다.');
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.json')) {
            return JSON.parse(await file.text());
        }
        if (typeof JSZip === 'undefined') throw new Error('JSZip이 로드되지 않았습니다.');
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const jsonFile = zip.file('tvc_master_backup.json')
            || zip.file(/tvc_master_backup\.json$/i)[0]
            || zip.file(/\.json$/i)[0];
        if (!jsonFile) throw new Error('백업 파일에서 tvc_master_backup.json을 찾지 못했습니다.');
        return JSON.parse(await jsonFile.async('string'));
    }

    async function replaceStore(storeName, rows) {
        await TVC_DB.clearStore(storeName);
        const list = Array.isArray(rows) ? rows : [];
        if (list.length) await TVC_DB.bulkPut(storeName, list);
        return list.length;
    }

    async function restoreBackup(scope, file, user, opts = {}) {
        if (!scope || (scope !== SCOPE.PMS && scope !== SCOPE.SPARE)) {
            throw new Error('Restore scope가 올바르지 않습니다. (pms / spare)');
        }
        const payload = await parseBackupFile(file);
        if (payload?.kind !== KIND) {
            throw new Error('TVC Master Data 백업 파일이 아닙니다.');
        }
        if (payload.scope && payload.scope !== scope) {
            throw new Error(
                `이 파일은 ${scopeLabel(payload.scope)} 백업입니다. ` +
                `${scopeLabel(scope)} Restore에는 사용할 수 없습니다.`
            );
        }
        const expectedVessel = await resolveVesselId(user, opts);
        if (payload.vessel_id && expectedVessel && payload.vessel_id !== expectedVessel) {
            const ok = window.confirm(
                `백업 선박(${payload.vessel_id})과 현재 선박(${expectedVessel})이 다릅니다.\n그래도 복구하시겠습니까?`
            );
            if (!ok) throw new Error('복구가 취소되었습니다.');
        }

        const storeNames = storesFor(scope);
        const counts = {};
        for (const name of storeNames) {
            counts[name] = await replaceStore(name, payload.stores?.[name] || []);
        }

        const meta = payload.meta || {};
        for (const key of metaKeysFor(scope)) {
            if (Object.prototype.hasOwnProperty.call(meta, key)) {
                await TVC_DB.setMeta(key, meta[key]);
            }
        }

        if (scope === SCOPE.PMS && payload.run_hours && typeof TVC_PMS !== 'undefined') {
            TVC_PMS.writeStore(payload.run_hours);
        }

        return {
            scope,
            vesselId: payload.vessel_id || expectedVessel,
            exported_at: payload.exported_at || '',
            counts,
        };
    }

    return {
        SCOPE,
        scopeLabel,
        storesFor,
        exportBackup,
        restoreBackup,
        parseBackupFile,
    };
})();
