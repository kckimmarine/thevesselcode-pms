/* File-based Delta Sync (.zip) — 부서(DECK/ENGINE) 단위로 완전히 이원화
 * + 데이터 공간(Space) 분리: HQ ↔ 선박(SHIP)은 오직 이 ZIP 파일로만 데이터를 주고받는다. */
const TVC_Sync = (function () {
    const now = () => new Date().toISOString();
    const spaceOf = (user) => (TVC_RBAC.isHqAccount(user) ? 'HQ' : 'SHIP');

    function normalizeVesselId(id) {
        return String(id || '').trim();
    }

    /** 선박: meta VESSEL_ID → user.vessel_id / HQ: Fleet 선택 또는 opts.expectedVesselId */
    async function resolveExpectedVesselId(user, isHq, overrideId) {
        const fromOpt = normalizeVesselId(overrideId);
        if (fromOpt) return fromOpt;
        if (isHq) {
            const sel = typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.getSelectedId() : '';
            return normalizeVesselId(sel);
        }
        try {
            const meta = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID);
            if (meta) return normalizeVesselId(meta);
        } catch (_) {}
        return normalizeVesselId(user?.vessel_id);
    }

    function validateImportVesselId(expected, incoming, isHq) {
        const got = normalizeVesselId(incoming);
        const exp = normalizeVesselId(expected);
        if (!got || got === 'UNKNOWN') {
            return {
                ok: false,
                code: 'VESSEL_ID_MISSING',
                message: 'ZIP에 유효한 vessel_id가 없습니다. 올바른 선박 Export 파일인지 확인하세요.',
            };
        }
        if (!exp) return { ok: true, warning: 'expected_unconfigured' };
        if (exp !== got) {
            const ctx = isHq
                ? `HQ에서 선택한 선박은 "${exp}"입니다.`
                : `이 PC에 등록된 선박은 "${exp}"입니다.`;
            return {
                ok: false,
                code: 'VESSEL_MISMATCH',
                message: `선박 ID 불일치: 이 ZIP은 "${got}" 선박 데이터입니다. ${ctx} 데이터 오염 방지를 위해 Import가 중단되었습니다.`,
                expected: exp,
                incoming: got,
            };
        }
        return { ok: true };
    }

    /** dept 지정 시 해당 부서 데이터만 델타에 포함 (영구 분리) */
    async function collectDelta(dept) {
        const [jobs, reports, spares, components, audits, requisitions, jobBom, catalog, groups, defects] = await Promise.all([
            TVC_DB.getAll('maintenance_jobs'),
            TVC_DB.getAll('daily_work_reports'),
            TVC_DB.getAll('spare_parts'),
            TVC_DB.getAll('ship_components'),
            TVC_DB.getAll('audit_logs'),
            TVC_DB.getAll('requisitions').catch(() => []),
            TVC_DB.getAll('job_bom').catch(() => []),
            TVC_DB.getAll('universal_catalog').catch(() => []),
            TVC_DB.getAll('maintenance_groups').catch(() => []),
            TVC_DB.getAll('defect_cases').catch(() => []),
        ]);
        const pending = (rows) => rows.filter(r => r.sync_status !== 'SYNCED');
        const deptByCode = new Map(jobs.map(j => [j.job_code, j.department]));

        let pJobs = pending(jobs);
        let pReports = pending(reports);
        let pComponents = pending(components);
        let pReqs = pending(requisitions);
        let pGroups = pending(groups);
        let pDefects = pending(defects);
        if (dept) {
            pJobs = pJobs.filter(j => j.department === dept);
            pReports = pReports.filter(r => TVC_WorkReport.belongsToDepartment(r, dept, deptByCode));
            pComponents = pComponents.filter(c => !c.path || c.path[0] === dept);
            pReqs = pReqs.filter(r => !r.department || r.department === dept);
            pGroups = pGroups.filter(g => g.department === dept);
            pDefects = pDefects.filter(d => TVC_DefectCase.belongsToDepartment(d, dept));
        }
        return {
            maintenance_jobs: pJobs,
            daily_work_reports: pReports,
            spare_parts: pending(spares),
            ship_components: pComponents,
            audit_logs: pending(audits),
            requisitions: pReqs,
            job_bom: pending(jobBom),
            universal_catalog: pending(catalog),
            maintenance_groups: pGroups,
            defect_cases: pDefects,
        };
    }

    async function exportZip(user, direction, dept, opts = {}) {
        const action = direction === 'HQ_TO_SHIP' ? TVC_RBAC.Action.EXPORT_HQ_FEEDBACK : TVC_RBAC.Action.EXPORT_SHIP_SYNC;
        TVC_RBAC.assert(user, action);
        if (direction === 'STATION_TO_HUB' && typeof TVC_Space !== 'undefined') {
            TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.STATION_EXPORT);
        }
        if (!dept) throw new Error('부서(DECK/ENGINE)를 선택해야 합니다.');
        const accessDept = typeof TVC_Space !== 'undefined' && user?.station
            ? TVC_Space.canAccessDepartment(user, dept)
            : TVC_RBAC.canAccessDepartment(user, dept);
        if (!accessDept) throw new Error(`이 계정은 ${dept} 부서 데이터를보낼 권한이 없습니다.`);

        const delta = await collectDelta(dept);
        const vesselId = (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || user.vessel_id || 'UNKNOWN';
        const exportDate = now().slice(0, 10).replace(/-/g, '');
        const stationId = opts.station_id || (typeof TVC_Space !== 'undefined' ? TVC_Space.getStation(user) : null);

        const runHoursAll = (typeof TVC_PMS !== 'undefined') ? TVC_PMS.readStore() : {};
        const runHours = {};
        for (const [k, v] of Object.entries(runHoursAll)) {
            if (!dept || k.startsWith(dept + '|')) runHours[k] = v;
        }

        const payload = {
            export_meta: {
                vessel_id: vesselId,
                export_date: now().slice(0, 10),
                direction,
                department: dept,
                station_id: stationId,
                exported_by: user.username,
                schema_version: 6,
            },
            ...delta,
            run_hours: runHours,
            company_comments: (delta.daily_work_reports || [])
                .filter(r => r.company_comment)
                .map(r => ({ job_code: r.job_code, comment: r.company_comment })),
        };

        const zip = new JSZip();
        zip.file('tvc_sync.json', JSON.stringify(payload, null, 2));
        zip.file('tvc_station_export.json', JSON.stringify(payload, null, 2));
        zip.file('README.txt', `TVC-PMS Sync Package\nVessel: ${vesselId}\nDept: ${dept}\nDate: ${payload.export_meta.export_date}\nDirection: ${direction}`);

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const prefix = direction === 'STATION_TO_HUB' ? `${vesselId}_${stationId || dept}_STATION` : `${vesselId}_${dept}_PMS_EXPORT`;
        const filename = `${prefix}_${exportDate}.zip`;
        downloadBlob(blob, filename);

        await markExported(delta);
        await TVC_DB.setMeta(TVC_META_KEYS.LAST_EXPORT, now());
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📦 [Export/${direction}/${dept}] ${filename}`,
            sync_status: 'SYNCED',
        });
        const recordCount = Object.values(delta).reduce((sum, rows) => sum + (rows?.length || 0), 0);
        await recordSyncHistory({
            type: 'EXPORT',
            direction,
            department: dept,
            vessel_id: vesselId,
            filename,
            record_count: recordCount,
            status: 'SUCCESS',
            space: spaceOf(user),
        });
        return payload;
    }

    async function recordSyncHistory(entry) {
        try {
            await TVC_DB.put('sync_history', {
                at: now(),
                date: new Date().toLocaleString(),
                ...entry,
            });
        } catch (_) { /* store may not exist on legacy DB */ }
    }

    async function getHistory(limit = 30) {
        const rows = await TVC_DB.getAll('sync_history');
        return rows.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, limit);
    }

    async function markExported(delta) {
        const stores = ['maintenance_jobs', 'daily_work_reports', 'spare_parts', 'ship_components', 'audit_logs', 'requisitions', 'job_bom', 'universal_catalog', 'maintenance_groups', 'defect_cases'];
        for (const store of stores) {
            for (const row of delta[store] || []) {
                row.sync_status = 'SYNCED';
                row.last_synced_at = now();
                await TVC_DB.put(store, row);
            }
        }
    }

    async function importZip(user, file, dept, opts = {}) {
        const isHq = TVC_RBAC.isHqAccount(user);
        const isHubMerge = !!opts.allowHubMerge;
        const directionHint = opts.expectedDirection;

        if (isHubMerge) {
            if (typeof TVC_Space !== 'undefined') TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.HUB_IMPORT);
        } else {
            TVC_RBAC.assert(user, isHq ? TVC_RBAC.Action.IMPORT_HQ_SYNC : TVC_RBAC.Action.IMPORT_SHIP_SYNC);
            if (typeof TVC_Space !== 'undefined' && user?.station) {
                TVC_Space.assertAction(user, isHq ? TVC_RBAC.Action.IMPORT_HQ_SYNC : TVC_RBAC.Action.IMPORT_SHIP_SYNC);
            }
        }

        const zip = await JSZip.loadAsync(file);
        const jsonFile = zip.file('tvc_sync.json');
        if (!jsonFile) throw new Error('tvc_sync.json not found in zip');

        const payload = JSON.parse(await jsonFile.async('string'));
        const fileDept = payload.export_meta?.department;
        const fileDirection = payload.export_meta?.direction;
        dept = dept || fileDept || user.department;

        if (isHubMerge) {
            if (fileDirection && fileDirection !== 'STATION_TO_HUB' && fileDirection !== 'SHIP_TO_HQ') {
                throw new Error('Captain Hub는 Station Export(STATION_TO_HUB) 패키지만 병합할 수 있습니다.');
            }
        } else if (fileDirection === 'STATION_TO_HUB') {
            throw new Error('Station 패키지는 Captain Room(Hub) PC에서 Import Station Data로 가져와야 합니다.');
        }

        if (!dept) throw new Error('Import할 부서(DECK/ENGINE)를 선택해야 합니다.');
        const accessDept = typeof TVC_Space !== 'undefined' && user?.station && !isHubMerge
            ? TVC_Space.canAccessDepartment(user, dept)
            : TVC_RBAC.canAccessDepartment(user, dept);
        if (!accessDept && !isHubMerge) throw new Error(`이 계정은 ${dept} 부서 데이터를 가져올 권한이 없습니다.`);

        const importVesselId = payload.export_meta?.vessel_id || null;
        const failImport = async (err) => {
            await recordSyncHistory({
                type: 'IMPORT', direction: payload.export_meta?.direction || 'UNKNOWN', department: dept,
                vessel_id: importVesselId || '—', filename: file.name || '(uploaded)',
                record_count: 0, status: 'FAILED', error: err.message, space: spaceOf(user),
            });
            throw err;
        };

        if (fileDept && fileDept !== dept && fileDept !== 'ALL') {
            await failImport(new Error(`부서 불일치: 선택한 부서(${dept})와 파일의 부서(${fileDept})가 다릅니다.`));
        }
        if (directionHint && fileDirection && fileDirection !== directionHint) {
            await failImport(new Error(`방향 불일치: 기대 ${directionHint}, 파일 ${fileDirection}`));
        }

        const expectedVesselId = await resolveExpectedVesselId(user, isHq, opts.expectedVesselId);
        const vCheck = validateImportVesselId(expectedVesselId, importVesselId, isHq);
        if (!vCheck.ok) {
            const err = new Error(vCheck.message);
            err.code = vCheck.code;
            await failImport(err);
        }
        let status = 'SUCCESS';
        const mergeDept = (isHubMerge && dept === 'ALL') ? null : dept;
        try {
            await mergePayload(payload, mergeDept, isHq, importVesselId);
        } catch (err) {
            status = 'FAILED';
            await recordSyncHistory({
                type: 'IMPORT',
                direction: payload.export_meta?.direction || 'UNKNOWN',
                department: dept,
                vessel_id: payload.export_meta?.vessel_id || '—',
                filename: file.name || '(uploaded)',
                record_count: 0,
                status,
                error: err.message,
                space: spaceOf(user),
            });
            throw err;
        }

        if (payload.run_hours && typeof TVC_PMS !== 'undefined') {
            const myScope = isHq ? TVC_PMS.scopeOf('HQ', importVesselId) : 'SHIP';
            const store = TVC_PMS.readStore(myScope);
            for (const [k, v] of Object.entries(payload.run_hours)) {
                if (!mergeDept || k.startsWith(mergeDept + '|')) store[k] = v;
            }
            TVC_PMS.writeStore(store, myScope);
        }

        const recordCount = ['maintenance_jobs', 'maintenance_groups', 'daily_work_reports', 'spare_parts', 'ship_components', 'audit_logs', 'requisitions', 'job_bom', 'universal_catalog', 'defect_cases']
            .reduce((sum, k) => sum + (payload[k]?.length || 0), 0);

        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📥 [Import/${dept}] ${payload.export_meta?.direction || 'UNKNOWN'} from ${payload.export_meta?.export_date || '?'}`,
            sync_status: 'LOCAL',
        });
        await recordSyncHistory({
            type: 'IMPORT',
            direction: payload.export_meta?.direction || 'UNKNOWN',
            department: dept,
            vessel_id: payload.export_meta?.vessel_id || '—',
            filename: file.name || '(uploaded)',
            record_count: recordCount,
            status,
            space: spaceOf(user),
        });
        return payload;
    }

    async function mergePayload(payload, dept, isHq, vesselId) {
        const jobDeptByCode = new Map((payload.maintenance_jobs || []).map(j => [j.job_code, j.department]));
        const deptOk = (row, kind) => {
            if (!dept) return true;
            if (kind === 'job') return !row.department || row.department === dept;
            if (kind === 'component') return !row.path || row.path[0] === dept;
            if (kind === 'report') return TVC_WorkReport.belongsToDepartment(row, dept, jobDeptByCode);
            if (kind === 'group') return !row.department || row.department === dept;
            if (kind === 'defect') return TVC_DefectCase.belongsToDepartment(row, dept);
            return true;
        };
        const stamp = (row, kind) => {
            row.sync_status = 'SYNCED';
            if (vesselId && (kind === 'report' || kind === 'job' || kind === 'requisition' || kind === 'defect')) row.vessel_id = vesselId;
            if (isHq && (kind === 'report' || kind === 'defect')) row.hq_synced = true;
        };
        const mergeStore = async (storeName, rows, kind, keyField = 'id') => {
            if (!rows?.length) return;
            for (const incoming of rows) {
                if (!deptOk(incoming, kind)) continue;
                const key = incoming[keyField];
                const existing = key != null ? await TVC_DB.get(storeName, key) : null;
                if (!existing) {
                    stamp(incoming, kind);
                    await TVC_DB.put(storeName, incoming);
                    continue;
                }
                const inTs = incoming.updated_at || '';
                const exTs = existing.updated_at || '';
                if (inTs >= exTs) {
                    Object.assign(existing, incoming);
                    stamp(existing, kind);
                    await TVC_DB.put(storeName, existing);
                }
            }
        };

        await mergeStore('maintenance_jobs', payload.maintenance_jobs, 'job');
        await mergeStore('maintenance_groups', payload.maintenance_groups, 'group');
        await mergeStore('daily_work_reports', payload.daily_work_reports, 'report');
        await mergeStore('spare_parts', payload.spare_parts, 'spare');
        await mergeStore('ship_components', payload.ship_components, 'component');
        await mergeStore('audit_logs', payload.audit_logs, 'audit');
        await mergeStore('requisitions', payload.requisitions, 'requisition');
        await mergeStore('job_bom', payload.job_bom, 'bom');
        await mergeStore('universal_catalog', payload.universal_catalog, 'catalog', 'universal_code');
        await mergeStore('defect_cases', payload.defect_cases, 'defect');

        for (const c of payload.company_comments || []) {
            const reports = await TVC_DB.indexGetAll('daily_work_reports', 'by_job_code', c.job_code);
            const target = reports.find(r => {
                TVC_WorkReport.fromLegacy(r);
                return TVC_RBAC.isConfirmedStatus(r.status, r.is_locked);
            }) || reports[0];
            if (target) {
                TVC_WorkReport.fromLegacy(target);
                target.company_comment = c.comment;
                target.status = 'APPROVED';
                target.is_locked = true;
                target.sync_status = 'SYNCED';
                if (vesselId) target.vessel_id = vesselId;
                if (isHq) target.hq_synced = true;
                await TVC_DB.put('daily_work_reports', target);
            }
        }
    }

    function downloadBlob(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async function exportCompanyZip(user) {
        if (typeof TVC_Space !== 'undefined') TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.COMPANY_EXPORT);
        TVC_RBAC.assert(user, TVC_RBAC.Action.EXPORT_SHIP_SYNC);

        const depts = ['DECK', 'ENGINE'];
        const merged = {
            maintenance_jobs: [], maintenance_groups: [], daily_work_reports: [],
            spare_parts: [], ship_components: [], audit_logs: [],
            requisitions: [], job_bom: [], universal_catalog: [], defect_cases: [],
        };
        const runHours = {};
        for (const dept of depts) {
            const delta = await collectDelta(dept);
            for (const key of Object.keys(merged)) {
                merged[key].push(...(delta[key] || []));
            }
            const runHoursAll = (typeof TVC_PMS !== 'undefined') ? TVC_PMS.readStore() : {};
            for (const [k, v] of Object.entries(runHoursAll)) {
                if (k.startsWith(dept + '|')) runHours[k] = v;
            }
        }

        const vesselId = (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || user.vessel_id || 'UNKNOWN';
        const exportDate = now().slice(0, 10).replace(/-/g, '');
        const payload = {
            export_meta: {
                vessel_id: vesselId,
                export_date: now().slice(0, 10),
                direction: 'SHIP_TO_HQ',
                department: 'ALL',
                station_id: 'CAPTAIN',
                exported_by: user.username,
                schema_version: 6,
                package_type: 'COMPANY_REPORT',
            },
            ...merged,
            run_hours: runHours,
            company_comments: (merged.daily_work_reports || [])
                .filter(r => r.company_comment)
                .map(r => ({ job_code: r.job_code, comment: r.company_comment })),
        };

        const zip = new JSZip();
        zip.file('tvc_sync.json', JSON.stringify(payload, null, 2));
        zip.file('tvc_company_report.json', JSON.stringify(payload, null, 2));
        zip.file('README.txt', `TVC-PMS Company Report Package\nVessel: ${vesselId}\nDate: ${payload.export_meta.export_date}\nDirection: SHIP_TO_HQ`);

        const filename = `${vesselId}_COMPANY_REPORT_${exportDate}.zip`;
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        downloadBlob(blob, filename);

        await markExported(merged);
        await TVC_DB.setMeta(TVC_META_KEYS.LAST_EXPORT, now());
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📦 [Export/SHIP_TO_HQ/ALL] ${filename}`,
            sync_status: 'SYNCED',
        });
        const recordCount = Object.values(merged).reduce((sum, rows) => sum + (rows?.length || 0), 0);
        await recordSyncHistory({
            type: 'EXPORT',
            direction: 'SHIP_TO_HQ',
            department: 'ALL',
            vessel_id: vesselId,
            filename,
            record_count: recordCount,
            status: 'SUCCESS',
            space: spaceOf(user),
        });
        return payload;
    }

    async function importPayload(user, payload, file, opts = {}) {
        if (opts.allowHubMerge && typeof TVC_Space !== 'undefined') {
            TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.HUB_IMPORT);
        }
        const fileDept = payload.export_meta?.department;
        const fileDirection = payload.export_meta?.direction;
        let dept = opts.dept || fileDept || user.department;
        if (!dept && fileDirection === 'SHIP_TO_HQ') dept = 'ALL';

        const importVesselId = payload.export_meta?.vessel_id || null;
        const expectedVesselId = await resolveExpectedVesselId(user, false, opts.expectedVesselId);
        const vCheck = validateImportVesselId(expectedVesselId, importVesselId, false);
        if (!vCheck.ok) throw new Error(vCheck.message);

        const mergeDept = dept === 'ALL' ? null : dept;
        await mergePayload(payload, mergeDept, false, importVesselId);

        if (payload.run_hours && typeof TVC_PMS !== 'undefined') {
            const store = TVC_PMS.readStore('SHIP');
            for (const [k, v] of Object.entries(payload.run_hours)) store[k] = v;
            TVC_PMS.writeStore(store, 'SHIP');
        }

        const recordCount = ['maintenance_jobs', 'maintenance_groups', 'daily_work_reports', 'spare_parts', 'ship_components', 'audit_logs', 'requisitions', 'job_bom', 'universal_catalog', 'defect_cases']
            .reduce((sum, k) => sum + (payload[k]?.length || 0), 0);

        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📥 [HubMerge/${dept || 'ALL'}] ${fileDirection || 'JSON'} from ${payload.export_meta?.export_date || '?'}`,
            sync_status: 'LOCAL',
        });
        await recordSyncHistory({
            type: 'IMPORT',
            direction: fileDirection || 'HUB_MERGE',
            department: dept || 'ALL',
            vessel_id: importVesselId || '—',
            filename: file?.name || '(merged)',
            record_count: recordCount,
            status: 'SUCCESS',
            space: spaceOf(user),
        });
        return payload;
    }

    return { exportZip, exportCompanyZip, importZip, importPayload, collectDelta, mergePayload, getHistory, recordSyncHistory, validateImportVesselId, resolveExpectedVesselId };
})();
