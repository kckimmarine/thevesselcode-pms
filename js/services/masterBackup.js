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

    function lastEventMetaKeys(scope) {
        return scope === SCOPE.SPARE
            ? { backup: TVC_META_KEYS.SPARE_MASTER_BACKUP_LAST, restore: TVC_META_KEYS.SPARE_MASTER_RESTORE_LAST }
            : { backup: TVC_META_KEYS.PMS_MASTER_BACKUP_LAST, restore: TVC_META_KEYS.PMS_MASTER_RESTORE_LAST };
    }

    async function recordLastEvent(scope, kind, extra = {}) {
        const keys = lastEventMetaKeys(scope);
        const key = kind === 'restore' ? keys.restore : keys.backup;
        if (!key) return;
        await TVC_DB.setMeta(key, {
            at: new Date().toISOString(),
            kind: kind === 'restore' ? 'restore' : 'backup',
            ...extra,
        });
    }

    function eventAt(entry) {
        if (!entry) return '';
        if (typeof entry === 'string') return entry;
        return String(entry.at || entry.date || '');
    }

    async function getLastEvents(scope) {
        const keys = lastEventMetaKeys(scope);
        const backup = await TVC_DB.getMeta(keys.backup);
        const restore = await TVC_DB.getMeta(keys.restore);
        return {
            backupAt: eventAt(backup),
            restoreAt: eventAt(restore),
            backup,
            restore,
        };
    }

    function localDateTag() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    }

    function backupTypeToken(scope) {
        return scope === SCOPE.SPARE ? 'spare_backup' : 'pms_backup';
    }

    async function buildBackupFilename(scope, vesselId, department) {
        const dateTag = localDateTag();
        if (typeof TVC_Filename !== 'undefined' && TVC_Filename.build) {
            return TVC_Filename.build({
                vesselId,
                type: backupTypeToken(scope),
                department,
                ext: 'zip',
                dateTag,
            });
        }
        const vessel = String(vesselId || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unknown';
        const dept = String(department || '').toUpperCase() === 'DECK' ? 'deck' : 'engine';
        return `${vessel}_${backupTypeToken(scope)}_${dept}_${dateTag}_001.zip`;
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

    async function collectStores(storeNames, vesselId) {
        const stores = {};
        for (const name of storeNames) {
            let rows = await TVC_DB.getAll(name).catch(() => []);
            if (vesselId && typeof TVC_MasterVesselScope !== 'undefined'
                && TVC_MasterVesselScope.MASTER_STORES.includes(name)) {
                rows = TVC_MasterVesselScope.filterRows(rows, vesselId);
            }
            stores[name] = rows;
        }
        return stores;
    }

    async function buildPayload(scope, user, opts = {}) {
        const vesselId = await resolveVesselId(user, opts);
        const stores = await collectStores(storesFor(scope), vesselId);
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
            throw new Error('Backup scope is invalid. (pms / spare)');
        }
        if (typeof JSZip === 'undefined') throw new Error('JSZip is not loaded.');
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
        const filename = await buildBackupFilename(scope, payload.vessel_id, opts.department || user?.department);
        await TVC_FileExport.save(blob, filename);
        await recordLastEvent(scope, 'backup', { filename, vessel_id: payload.vessel_id });
        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: scope === SCOPE.SPARE ? 'SPARE_MASTER_BACKUP' : 'PMS_MASTER_BACKUP',
                department: opts.department || user?.department || null,
                vessel_id: payload.vessel_id,
                filename,
                record_count: Object.values(payload.stores || {}).reduce((n, rows) => n + (rows?.length || 0), 0),
                status: 'SUCCESS',
            });
        }
        const counts = Object.fromEntries(
            Object.entries(payload.stores).map(([k, rows]) => [k, (rows || []).length])
        );
        return { filename, vesselId: payload.vessel_id, scope, counts };
    }

    async function parseBackupFile(file) {
        if (!file) throw new Error('No file selected.');
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.json')) {
            return JSON.parse(await file.text());
        }
        if (typeof JSZip === 'undefined') throw new Error('JSZip is not loaded.');
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const jsonFile = zip.file('tvc_master_backup.json')
            || zip.file(/tvc_master_backup\.json$/i)[0]
            || zip.file(/\.json$/i)[0];
        if (!jsonFile) throw new Error('tvc_master_backup.json was not found in the backup file.');
        return JSON.parse(await jsonFile.async('string'));
    }

    async function replaceStore(storeName, rows, vesselId) {
        const list = Array.isArray(rows) ? rows : [];
        const masterScoped = typeof TVC_MasterVesselScope !== 'undefined'
            && vesselId
            && TVC_MasterVesselScope.MASTER_STORES.includes(storeName);
        if (masterScoped) {
            await TVC_MasterVesselScope.clearVesselStore(storeName, vesselId);
            const stamped = list.map(r => {
                const copy = { ...r, vessel_id: vesselId };
                return copy;
            });
            if (stamped.length) await TVC_DB.bulkPut(storeName, stamped);
            return stamped.length;
        }
        await TVC_DB.clearStore(storeName);
        if (list.length) await TVC_DB.bulkPut(storeName, list);
        return list.length;
    }

    async function restoreBackup(scope, file, user, opts = {}) {
        if (!scope || (scope !== SCOPE.PMS && scope !== SCOPE.SPARE)) {
            throw new Error('Restore scope is invalid. (pms / spare)');
        }
        const payload = await parseBackupFile(file);
        if (payload?.kind !== KIND) {
            throw new Error('This is not a TVC Master Data backup file.');
        }
        if (payload.scope && payload.scope !== scope) {
            throw new Error(
                `This file is a ${scopeLabel(payload.scope)} backup and cannot restore ${scopeLabel(scope)}.`
            );
        }
        const expectedVessel = await resolveVesselId(user, opts);
        if (payload.vessel_id && expectedVessel && payload.vessel_id !== expectedVessel) {
            const ok = await TVC_Dialog.confirm({ message: 
                `Backup vessel (${payload.vessel_id}) differs from current vessel (${expectedVessel}).\nRestore anyway?`
             });
            if (!ok) throw new Error('Restore cancelled.');
        }

        const storeNames = storesFor(scope);
        const counts = {};
        for (const name of storeNames) {
            counts[name] = await replaceStore(name, payload.stores?.[name] || [], expectedVessel);
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

        await recordLastEvent(scope, 'restore', {
            filename: file?.name || '',
            vessel_id: payload.vessel_id || expectedVessel,
        });

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
        getLastEvents,
    };
})();
