/* File-based Delta Sync (.zip) — 부서(DECK/ENGINE) 단위로 완전히 이원화
 * + 데이터 공간(Space) 분리: HQ ↔ 선박(SHIP)은 오직 이 ZIP 파일로만 데이터를 주고받는다. */
const TVC_Sync = (function () {
    const now = () => new Date().toISOString();
    const spaceOf = (user) => (TVC_RBAC.isHqAccount(user) ? 'HQ' : 'SHIP');

    const SHIP_DEFECT_INBOUND = new Set(['SHIP_TO_HQ', 'STATION_TO_HUB', 'DEFECT_URGENT_TO_HQ']);

    /** HQ import — defect-only or monthly: Confirmed/Ship-submitted cases → awaiting Initial Reply */
    function normalizeShipDefectForHq(row, direction) {
        if (!row || !SHIP_DEFECT_INBOUND.has(direction)) return;
        if (row.phase2_locked || row.status === TVC_DefectCase.Status.COMPANY_REVIEWED) return;
        const listSt = TVC_DefectCase.listWorkflowStatus(row);
        const shipSubmitted = !!(row.confirmed_at || row.confirmed_by || row.phase1_locked
            || row.submitted_at || listSt === 'Confirmed' || listSt === 'Submitted'
            || (row.visible_in_list !== false && listSt === 'Reported'));
        if (!shipSubmitted) return;
        if (!row.phase2_locked && row.status !== TVC_DefectCase.Status.COMPANY_REVIEWED
            && row.status !== TVC_DefectCase.Status.AWAITING_COMPLETION
            && row.status !== TVC_DefectCase.Status.CLOSED) {
            row.status = TVC_DefectCase.Status.SUBMITTED_TO_COMPANY;
        }
        if (!row.phase1_locked) row.phase1_locked = true;
        if (row.visible_in_list === false) row.visible_in_list = true;
    }

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

    function resolveActiveImportDepartment(user, overrideDept) {
        const fromOpt = String(overrideDept || '').trim().toUpperCase();
        if (fromOpt === 'DECK' || fromOpt === 'ENGINE') return fromOpt;
        const fromApp = typeof TVC_App !== 'undefined'
            ? String(TVC_App.getAppDepartment?.() || '').trim().toUpperCase()
            : '';
        if (fromApp === 'DECK' || fromApp === 'ENGINE') return fromApp;
        const fromUser = String(user?.department || '').trim().toUpperCase();
        if (fromUser === 'DECK' || fromUser === 'ENGINE') return fromUser;
        return null;
    }

    function importScopeLabel(scope) {
        const s = String(scope || '').toLowerCase();
        if (s === 'deck') return 'Deck';
        if (s === 'engine') return 'Engine';
        if (s === 'deck_hq') return 'Deck (HQ 회신)';
        if (s === 'engine_hq') return 'Engine (HQ 회신)';
        if (s === 'hq') return 'HQ (legacy)';
        if (s === 'hub') return 'Hub (Master)';
        return s || '—';
    }

    /** Infer DECK/ENGINE from payload meta, station_id, or scoped filename. */
    function resolveFileDepartment(payload, filename) {
        let dept = String(payload?.export_meta?.department || '').trim().toUpperCase();
        if (dept === 'ALL') dept = '';
        if (!dept) {
            const parsed = typeof TVC_Filename !== 'undefined' ? TVC_Filename.parseScoped(filename) : null;
            if (parsed?.department === 'engine' || parsed?.scope === 'engine') dept = 'ENGINE';
            else if (parsed?.department === 'deck' || parsed?.scope === 'deck') dept = 'DECK';
        }
        if (!dept && payload?.export_meta?.direction === 'STATION_TO_HUB') {
            const sid = String(payload.export_meta.station_id || '').toUpperCase();
            if (sid === 'ECR') dept = 'ENGINE';
            if (sid === 'CCR') dept = 'DECK';
        }
        return dept || null;
    }

    function assertDeptToggleMatch(activeDept, fileDept, filename, roleLabel) {
        if (!fileDept || fileDept === 'ALL') return;
        if (activeDept && activeDept !== fileDept) {
            throw new Error(
                `부서 불일치: 현재 ${TVC_RBAC.getDeptLabel(activeDept)} ${roleLabel}, Import 파일은 ${TVC_RBAC.getDeptLabel(fileDept)} 부서 데이터입니다.\n\n파일: ${filename}\n\n올바른 부서(Department) 토글을 선택한 뒤 다시 Import하세요.`
            );
        }
    }

    /** Enforce Engine/Deck import routing — Master·HQ toggle, station direct HQ reply, no cross-dept merge. */
    function validateImportPackageScope(user, file, payload, opts = {}) {
        const direction = String(payload?.export_meta?.direction || '');
        const isHq = TVC_RBAC.isHqAccount(user);
        const isMaster = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user);
        const isEngineStation = typeof TVC_Space !== 'undefined' && TVC_Space.isEngineVesselMode(user);
        const isDeckStation = typeof TVC_Space !== 'undefined' && TVC_Space.isDeckVesselMode(user);
        const activeDept = resolveActiveImportDepartment(user, opts.department);
        const fileDept = resolveFileDepartment(payload, file?.name);
        const filename = String(file?.name || '').trim();
        const parsed = typeof TVC_Filename !== 'undefined' ? TVC_Filename.parseScoped(filename) : null;

        if (direction === 'STATION_TO_HUB') {
            if (isEngineStation || isDeckStation) {
                throw new Error(
                    `Station export ZIP은 Master Mode 또는 HQ Mode${fileDept ? ` (${TVC_RBAC.getDeptLabel(fileDept)} 토글)` : ''}에서 Import하세요.\n\n${fileDept === 'ENGINE' ? 'Engine export는 Deck Mode에 반영되지 않습니다.' : fileDept === 'DECK' ? 'Deck export는 Engine Mode에 반영되지 않습니다.' : 'Engine/Deck export는 상대 부서 Mode에 반영되지 않습니다.'}`
                );
            }
            if (!isMaster && !isHq) {
                throw new Error('Station export ZIP은 Master Mode 또는 HQ Mode에서 Import할 수 있습니다.');
            }
            if ((isMaster || isHq) && !activeDept) {
                throw new Error(`Import 전 ${fileDept ? TVC_RBAC.getDeptLabel(fileDept) : 'Deck 또는 Engine'} 부서 토글을 선택하세요.`);
            }
            assertDeptToggleMatch(activeDept, fileDept, filename, '토글이 선택되어 있으나');
            if (parsed && (parsed.scope === 'deck' || parsed.scope === 'engine') && activeDept) {
                const expectedScope = TVC_Filename.scopeToken(activeDept, false);
                if (parsed.scope !== expectedScope) {
                    throw new Error(
                        `부서 불일치: 현재 ${importScopeLabel(expectedScope)} 토글이 선택되어 있으나, Import 파일은 ${importScopeLabel(parsed.scope)} 부서 데이터입니다.\n\n파일: ${filename}\n\n올바른 부서(Department) 토글을 선택한 뒤 다시 Import하세요.`
                    );
                }
            }
            return { ok: true, activeDept, fileDept, route: isMaster ? 'hub_merge' : 'hq_direct' };
        }

        const hqImportFromShip = isHq && direction === 'SHIP_TO_HQ';
        const shipImportFromHq = !isHq && direction === 'HQ_TO_SHIP';

        if (hqImportFromShip) {
            if (!activeDept) {
                throw new Error('Import 전 Deck 또는 Engine 부서 토글을 선택하세요.');
            }
            if (parsed && (parsed.scope === 'deck' || parsed.scope === 'engine')) {
                const expectedScope = TVC_Filename.scopeToken(activeDept, false);
                if (parsed.scope !== expectedScope) {
                    throw new Error(
                        `부서 불일치: 현재 ${importScopeLabel(expectedScope)} 토글이 선택되어 있으나, Import 파일은 ${importScopeLabel(parsed.scope)} 부서 데이터입니다.\n\n파일: ${filename}\n\n올바른 부서(Department) 토글을 선택한 뒤 다시 Import하세요.`
                    );
                }
            }
            assertDeptToggleMatch(activeDept, fileDept, filename, '토글이 선택되어 있으나');
        }

        if (shipImportFromHq) {
            if (isHq) {
                throw new Error('HQ 회신 ZIP은 선박(Master / Engine / Deck Mode)에서 Import하세요.');
            }
            if (fileDept === 'ENGINE' && isDeckStation) {
                throw new Error('Engine 부서 HQ 회신은 Deck Mode에 반영되지 않습니다. Engine Mode 또는 Master Mode(Engine 토글)에서 Import하세요.');
            }
            if (fileDept === 'DECK' && isEngineStation) {
                throw new Error('Deck 부서 HQ 회신은 Engine Mode에 반영되지 않습니다. Deck Mode 또는 Master Mode(Deck 토글)에서 Import하세요.');
            }
            if (parsed) {
                if (parsed.isHqReply && parsed.department) {
                    if (activeDept) {
                        const expectedScope = TVC_Filename.scopeToken(activeDept, false);
                        if (parsed.department !== expectedScope) {
                            throw new Error(
                                `부서 불일치: 현재 ${TVC_RBAC.getDeptLabel(activeDept)} 부서이나, Import 파일은 ${importScopeLabel(parsed.department)} HQ 회신 데이터입니다.\n\n파일: ${filename}\n\n올바른 부서 PC/토글에서 Import하세요.`
                            );
                        }
                    }
                } else if (parsed.scope !== 'hq' && !parsed.isHqReply) {
                    throw new Error(
                        `잘못된 HQ 회신 파일입니다 (scope: ${importScopeLabel(parsed.scope)}). HQ 회신 ZIP은 {engine|deck}_hq 형식이어야 합니다.\n\n파일: ${filename}`
                    );
                }
            }
            assertDeptToggleMatch(activeDept, fileDept, filename, '모드이나');
        }

        return { ok: true, activeDept, fileDept };
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

    function licensedCompanyId() {
        if (typeof TVC_License !== 'undefined') {
            return TVC_License.statusSync()?.companyId || TVC_License.COMPANY_ID;
        }
        return 'DAEMYUNG';
    }

    /** Electron Pilot: company + vessel must match license */
    function assertLicenseForPackage(vesselId, companyId) {
        if (typeof TVC_License === 'undefined') return { ok: true };
        const st = TVC_License.statusSync();
        if (!st?.enforced) return { ok: true };
        return TVC_License.assertExportImport(vesselId, companyId || licensedCompanyId());
    }

    /** dept 지정 시 해당 부서 데이터만 델타에 포함 (영구 분리) */
    async function collectDelta(dept) {
        return collectDeptRows(dept, { pendingOnly: true });
    }

    /** Monthly Report — 부서 전체 스냅샷 (sync_status 무관, Master→HQ 재전송용) */
    async function collectMonthlySnapshot(dept) {
        return collectDeptRows(dept, { pendingOnly: false });
    }

    async function collectDeptRows(dept, opts = {}) {
        const pendingOnly = opts.pendingOnly !== false;
        const [jobs, reports, spares, components, audits, requisitions, jobBom, catalog, groups, spareGroups, defects] = await Promise.all([
            TVC_DB.getAll('maintenance_jobs'),
            TVC_DB.getAll('daily_work_reports'),
            TVC_DB.getAll('spare_parts'),
            TVC_DB.getAll('ship_components'),
            TVC_DB.getAll('audit_logs'),
            TVC_DB.getAll('requisitions').catch(() => []),
            TVC_DB.getAll('job_bom').catch(() => []),
            TVC_DB.getAll('universal_catalog').catch(() => []),
            TVC_DB.getAll('maintenance_groups').catch(() => []),
            TVC_DB.getAll('spare_groups').catch(() => []),
            TVC_DB.getAll('defect_cases').catch(() => []),
        ]);
        const pending = (rows) => pendingOnly ? rows.filter(r => r.sync_status !== 'SYNCED') : rows;
        const deptByCode = new Map(jobs.map(j => [j.job_code, j.department]));

        let pJobs = pending(jobs);
        let pReports = pending(reports);
        let pComponents = pending(components);
        let pReqs = pending(requisitions);
        let pGroups = pending(groups);
        let pSpareGroups = pending(spareGroups);
        let pDefects = pending(defects);
        if (dept) {
            pJobs = pJobs.filter(j => j.department === dept);
            pReports = pReports.filter(r => TVC_WorkReport.belongsToDepartment(r, dept, deptByCode));
            pComponents = pComponents.filter(c => !c.path || c.path[0] === dept);
            pReqs = pReqs.filter(r => !r.department || r.department === dept);
            pGroups = pGroups.filter(g => g.department === dept);
            pSpareGroups = pSpareGroups.filter(g => g.department === dept);
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
            spare_groups: pSpareGroups,
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

        const delta = opts.monthlyExport ? await collectMonthlySnapshot(dept) : await collectDelta(dept);
        const recordCount = Object.values(delta).reduce((sum, rows) => sum + (rows?.length || 0), 0);
        if (!opts.monthlyExport && recordCount === 0) {
            throw new Error('보낼 변경 데이터가 없습니다. Confirm된 Work Report가 있는지 확인하세요.');
        }
        const vesselId = (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || user.vessel_id || 'UNKNOWN';
        const companyId = licensedCompanyId();
        const lic = assertLicenseForPackage(vesselId, companyId);
        if (!lic.ok) throw new Error(lic.error || 'License does not allow this export.');
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
                company_id: companyId,
                export_date: now().slice(0, 10),
                direction,
                department: dept,
                station_id: stationId,
                exported_by: user.username,
                schema_version: 6,
                ...(opts.monthlyExport ? { package_type: 'MONTHLY' } : {}),
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
        let filename;
        if (opts.monthlyExport && typeof TVC_Filename !== 'undefined') {
            const scope = direction === 'HQ_TO_SHIP'
                ? TVC_Filename.hqReplyScopeToken(dept)
                : undefined;
            filename = await TVC_Filename.build({
                vesselId,
                type: 'monthly',
                department: dept,
                scope,
                ext: 'zip',
                dateTag: exportDate,
            });
        } else {
            const prefix = direction === 'STATION_TO_HUB' ? `${vesselId}_${stationId || dept}_STATION` : `${vesselId}_${dept}_PMS_EXPORT`;
            filename = `${prefix}_${exportDate}.zip`;
        }
        await TVC_FileExport.save(blob, filename);

        await markExported(delta);
        await TVC_DB.setMeta(TVC_META_KEYS.LAST_EXPORT, now());
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📦 [Export/${direction}/${dept}] ${filename}`,
            sync_status: 'SYNCED',
        });
        await recordSyncHistory({
            type: 'EXPORT',
            direction,
            department: dept,
            vessel_id: vesselId,
            filename,
            record_count: recordCount,
            status: 'SUCCESS',
            space: spaceOf(user),
            station_id: stationId || null,
            peer: opts.monthlyExport
                ? 'Master/HQ'
                : (direction === 'STATION_TO_HUB'
                    ? 'Master'
                    : (direction === 'SHIP_TO_HQ' || direction === 'HQ_TO_SHIP' ? 'Company' : null)),
        });
        return payload;
    }

    async function recordSyncHistory(entry) {
        try {
            const fn = String(entry?.filename || entry?.file_name || '').trim();
            await TVC_DB.put('sync_history', {
                at: now(),
                date: new Date().toLocaleString(),
                ...entry,
                filename: fn,
                file_name: fn,
            });
        } catch (_) { /* store may not exist on legacy DB */ }
    }

    async function getHistory(limit = 30) {
        const rows = await TVC_DB.getAll('sync_history');
        return rows.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, limit);
    }

    async function markExported(delta) {
        const stores = ['maintenance_jobs', 'daily_work_reports', 'spare_parts', 'ship_components', 'audit_logs', 'requisitions', 'job_bom', 'universal_catalog', 'maintenance_groups', 'spare_groups', 'defect_cases'];
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

        const scope = validateImportPackageScope(user, file, payload, { department: dept, allowHubMerge: isHubMerge });
        dept = dept || scope.fileDept || fileDept || user.department;

        if (isHubMerge) {
            if (fileDirection && fileDirection !== 'STATION_TO_HUB' && fileDirection !== 'SHIP_TO_HQ') {
                throw new Error('Captain Hub는 Station Export(STATION_TO_HUB) 패키지만 병합할 수 있습니다.');
            }
        } else if (fileDirection === 'STATION_TO_HUB') {
            if (!isHq) {
                throw new Error('Station export ZIP은 Master Mode 또는 HQ Mode에서 Import하세요.');
            }
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
        const importCompanyId = payload.export_meta?.company_id || licensedCompanyId();
        const licCheck = assertLicenseForPackage(importVesselId, importCompanyId);
        if (!licCheck.ok) {
            const err = new Error(licCheck.error || 'License does not allow this import.');
            err.code = 'LICENSE_MISMATCH';
            await failImport(err);
        }
        let status = 'SUCCESS';
        const mergeDept = dept === 'ALL' ? null : dept;
        try {
            await mergePayload(payload, mergeDept, isHq, importVesselId, { importAuthoritative: true });
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

        const recordCount = ['maintenance_jobs', 'maintenance_groups', 'spare_groups', 'daily_work_reports', 'spare_parts', 'ship_components', 'audit_logs', 'requisitions', 'job_bom', 'universal_catalog', 'defect_cases']
            .reduce((sum, k) => sum + (payload[k]?.length || 0), 0);

        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📥 [Import/${dept}] ${payload.export_meta?.direction || 'UNKNOWN'} from ${payload.export_meta?.export_date || '?'}`,
            sync_status: 'LOCAL',
        });
        const importDir = payload.export_meta?.direction || 'UNKNOWN';
        await recordSyncHistory({
            type: 'IMPORT',
            direction: importDir,
            department: dept,
            vessel_id: payload.export_meta?.vessel_id || '—',
            filename: file.name || '(uploaded)',
            record_count: recordCount,
            status,
            space: spaceOf(user),
            station_id: payload.export_meta?.station_id || null,
            peer: isHubMerge && importDir === 'STATION_TO_HUB'
                ? (dept === 'ENGINE' ? 'Engine' : (dept === 'DECK' ? 'Deck' : 'Station'))
                : (importDir === 'HQ_TO_SHIP' || importDir === 'SHIP_TO_HQ' ? (isHq ? null : 'Company') : null),
        });
        return payload;
    }

    async function mergePayload(payload, dept, isHq, vesselId, opts = {}) {
        const importAuthoritative = !!opts.importAuthoritative;
        const jobDeptByCode = new Map((payload.maintenance_jobs || []).map(j => [j.job_code, j.department]));
        const deptOk = (row, kind) => {
            if (!dept) return true;
            if (kind === 'job') return !row.department || row.department === dept;
            if (kind === 'component') return !row.path || row.path[0] === dept;
            if (kind === 'report') return TVC_WorkReport.belongsToDepartment(row, dept, jobDeptByCode);
            if (kind === 'group') return !row.department || row.department === dept;
            if (kind === 'defect') return TVC_DefectCase.belongsToDepartment(row, dept);
            if (kind === 'work_permit') return TVC_WorkPermit.belongsToDepartment(row, dept);
            return true;
        };
        const stamp = (row, kind) => {
            row.sync_status = 'SYNCED';
            if (vesselId && (kind === 'report' || kind === 'job' || kind === 'requisition' || kind === 'defect' || kind === 'work_permit')) row.vessel_id = vesselId;
            if (isHq && (kind === 'report' || kind === 'defect' || kind === 'work_permit')) row.hq_synced = true;
        };
        const stampImported = (row, kind) => {
            stamp(row, kind);
            const metaDept = payload.export_meta?.department;
            const direction = payload.export_meta?.direction || '';
            if (kind === 'report' && !row.department && metaDept && metaDept !== 'ALL') row.department = metaDept;
            if (kind === 'defect' && !row.department && metaDept && metaDept !== 'ALL') row.department = metaDept;
            if (isHq && kind === 'defect') normalizeShipDefectForHq(row, direction);
            if (!isHq && kind === 'defect' && (direction === 'HQ_TO_SHIP' || direction === 'DEFECT_REPLY_HQ_TO_SHIP')) {
                if (!row.approved_at && !row.approved_by) {
                    row.approved_at = now().slice(0, 10);
                    row.approved_by = payload.export_meta?.exported_by || 'Company';
                }
            }
            if (kind === 'work_permit') {
                row.visible_in_list = row.visible_in_list !== false;
                const metaDept = payload.export_meta?.department;
                if ((!row.department || row.department === 'ALL') && metaDept && metaDept !== 'ALL') {
                    row.department = metaDept;
                }
                if (!isHq && direction === 'WORK_PERMIT_REPLY_HQ_TO_SHIP') {
                    if (!row.approved_at && !row.approved_by) {
                        row.approved_at = payload.export_meta?.export_date || now().slice(0, 10);
                        row.approved_by = payload.export_meta?.exported_by || 'Company';
                    }
                }
            }
        };
        /** Import ZIP은 선박 Export가 단일 진실원 — 타임스탬프가 없거나 HQ 쪽이 더 오래됐으면 반영 */
        const shouldApplyIncoming = (existing, incoming) => {
            const inTs = incoming.updated_at || incoming.last_synced_at || '';
            const exTs = existing.updated_at || existing.last_synced_at || '';
            if (!exTs || !inTs) return true;
            return inTs >= exTs;
        };

        const AUTHOR_PRESERVE_FIELDS = [
            'reporter_name', 'reporter_username', 'reported_by', 'reporter_role',
            'made_by', 'created_by', 'created_by_username', 'creator_name', 'operator_id', 'operator_name',
        ];
        const preserveAuthorFields = (existing, incoming) => {
            for (const f of AUTHOR_PRESERVE_FIELDS) {
                const ex = existing?.[f];
                const inc = incoming?.[f];
                if (ex != null && String(ex).trim() && (inc == null || !String(inc).trim())) {
                    incoming[f] = ex;
                }
            }
        };

        const mergeStore = async (storeName, rows, kind, keyField = 'id') => {
            if (!rows?.length) return;
            for (const incoming of rows) {
                if (!deptOk(incoming, kind)) continue;
                const key = incoming[keyField];
                const existing = key != null ? await TVC_DB.get(storeName, key) : null;
                if (!existing) {
                    stampImported(incoming, kind);
                    await TVC_DB.put(storeName, incoming);
                    continue;
                }
                if (importAuthoritative || shouldApplyIncoming(existing, incoming)) {
                    preserveAuthorFields(existing, incoming);
                    Object.assign(existing, incoming);
                    stampImported(existing, kind);
                    await TVC_DB.put(storeName, existing);
                }
            }
        };

        const findSpareByPartNo = async (partNo) => {
            const pn = String(partNo || '').trim();
            if (!pn) return null;
            if (typeof TVC_DB.SparePart !== 'undefined' && TVC_DB.SparePart.getByPartNo) {
                const hit = await TVC_DB.SparePart.getByPartNo(pn);
                if (hit?.id) return TVC_DB.get('spare_parts', hit.id);
            }
            const rows = await TVC_DB.indexGetAll('spare_parts', 'by_part_no', pn);
            return rows?.length ? rows[0] : null;
        };

        /** spare_parts has unique index on part_no — merge by part_no when station/hub ids differ */
        const mergeSpareParts = async (rows) => {
            if (!rows?.length) return new Map();
            const idRemap = new Map();
            for (const incoming of rows) {
                if (!deptOk(incoming, 'spare')) continue;
                let existing = incoming.id != null ? await TVC_DB.get('spare_parts', incoming.id) : null;
                const partNo = String(incoming.part_no || incoming.makerPartNo || '').trim();
                if (!existing && partNo) existing = await findSpareByPartNo(partNo);
                if (existing && incoming.id && existing.id !== incoming.id) {
                    idRemap.set(incoming.id, existing.id);
                }
                if (!existing) {
                    stampImported(incoming, 'spare');
                    await TVC_DB.put('spare_parts', incoming);
                    continue;
                }
                if (importAuthoritative || shouldApplyIncoming(existing, incoming)) {
                    preserveAuthorFields(existing, incoming);
                    const keepId = existing.id;
                    Object.assign(existing, incoming);
                    existing.id = keepId;
                    stampImported(existing, 'spare');
                    await TVC_DB.put('spare_parts', existing);
                }
            }
            return idRemap;
        };

        /** maintenance_jobs — merge by job_code when import id differs (HQ/Hub vs station) */
        const mergeMaintenanceJobs = async (rows) => {
            if (!rows?.length) return new Map();
            const idRemap = new Map();
            const allJobs = await TVC_DB.getAll('maintenance_jobs').catch(() => []);
            const findByCode = (code, department) => {
                const c = String(code || '').trim();
                if (!c) return null;
                const dept = String(department || '').trim().toUpperCase();
                return allJobs.find(j => j.job_code === c && (!dept || j.department === dept))
                    || allJobs.find(j => j.job_code === c)
                    || null;
            };
            for (const incoming of rows) {
                if (!deptOk(incoming, 'job')) continue;
                let existing = incoming.id != null ? await TVC_DB.get('maintenance_jobs', incoming.id) : null;
                if (!existing && incoming.job_code) {
                    existing = findByCode(incoming.job_code, incoming.department);
                }
                if (existing && incoming.id && existing.id !== incoming.id) {
                    idRemap.set(incoming.id, existing.id);
                }
                if (!existing) {
                    stampImported(incoming, 'job');
                    await TVC_DB.put('maintenance_jobs', incoming);
                    allJobs.push(incoming);
                    continue;
                }
                if (importAuthoritative || shouldApplyIncoming(existing, incoming)) {
                    preserveAuthorFields(existing, incoming);
                    const keepId = existing.id;
                    Object.assign(existing, incoming);
                    existing.id = keepId;
                    stampImported(existing, 'job');
                    await TVC_DB.put('maintenance_jobs', existing);
                }
            }
            return idRemap;
        };

        const remapReportJobRefs = async (reports, jobIdRemap, mergeDept) => {
            if (!reports?.length) return;
            const allJobs = await TVC_DB.getAll('maintenance_jobs').catch(() => []);
            const byCode = new Map();
            const byDeptCode = new Map();
            for (const j of allJobs) {
                if (!j?.job_code) continue;
                if (mergeDept && j.department && j.department !== mergeDept) continue;
                byCode.set(j.job_code, j.id);
                if (j.department) byDeptCode.set(`${j.department}|${j.job_code}`, j.id);
            }
            for (const rep of reports) {
                if (!deptOk(rep, 'report')) continue;
                TVC_WorkReport.fromLegacy(rep);
                for (const item of rep.job_items || []) {
                    let mid = item.maintenance_job_id;
                    if (mid && jobIdRemap.has(mid)) mid = jobIdRemap.get(mid);
                    const code = String(item.job_code || '').trim();
                    const repDept = rep.department || mergeDept;
                    let canonical = null;
                    if (mid && allJobs.some(j => j.id === mid)) canonical = mid;
                    if (!canonical && code) {
                        canonical = (repDept && byDeptCode.get(`${repDept}|${code}`)) || byCode.get(code) || null;
                    }
                    if (canonical) item.maintenance_job_id = canonical;
                }
                const primary = TVC_WorkReport.primaryJobItem(rep);
                if (primary?.maintenance_job_id) rep.maintenance_job_id = primary.maintenance_job_id;
            }
        };

        const jobIdRemap = await mergeMaintenanceJobs(payload.maintenance_jobs);
        await remapReportJobRefs(payload.daily_work_reports, jobIdRemap, dept);
        await mergeStore('maintenance_groups', payload.maintenance_groups, 'group');
        await mergeStore('spare_groups', payload.spare_groups, 'group');
        await mergeStore('daily_work_reports', payload.daily_work_reports, 'report');
        const spareIdRemap = await mergeSpareParts(payload.spare_parts);
        if (spareIdRemap.size && payload.job_bom?.length) {
            for (const bom of payload.job_bom) {
                if (bom.spare_part_id && spareIdRemap.has(bom.spare_part_id)) {
                    bom.spare_part_id = spareIdRemap.get(bom.spare_part_id);
                }
            }
        }
        await mergeStore('ship_components', payload.ship_components, 'component');
        await mergeStore('audit_logs', payload.audit_logs, 'audit');
        await mergeStore('requisitions', payload.requisitions, 'requisition');
        await mergeStore('job_bom', payload.job_bom, 'bom');
        await mergeStore('universal_catalog', payload.universal_catalog, 'catalog', 'universal_code');
        await mergeStore('defect_cases', payload.defect_cases, 'defect');
        await mergeStore('work_permits', payload.work_permits, 'work_permit');

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


    async function exportCompanyZip(user) {
        if (typeof TVC_Space !== 'undefined') TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.COMPANY_EXPORT);
        TVC_RBAC.assert(user, TVC_RBAC.Action.EXPORT_SHIP_SYNC);

        const depts = ['DECK', 'ENGINE'];
        const merged = {
            maintenance_jobs: [], maintenance_groups: [], spare_groups: [], daily_work_reports: [],
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
        const companyId = licensedCompanyId();
        const lic = assertLicenseForPackage(vesselId, companyId);
        if (!lic.ok) throw new Error(lic.error || 'License does not allow this export.');
        const exportDate = now().slice(0, 10).replace(/-/g, '');
        const payload = {
            export_meta: {
                vessel_id: vesselId,
                company_id: companyId,
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
        await TVC_FileExport.save(blob, filename);

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
        const fileDirection = payload.export_meta?.direction;
        const scope = validateImportPackageScope(user, file || { name: '' }, payload, {
            department: opts.dept,
            allowHubMerge: opts.allowHubMerge,
        });
        let dept = opts.dept || scope.fileDept || payload.export_meta?.department || user.department;
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

        const recordCount = ['maintenance_jobs', 'maintenance_groups', 'spare_groups', 'daily_work_reports', 'spare_parts', 'ship_components', 'audit_logs', 'requisitions', 'job_bom', 'universal_catalog', 'defect_cases']
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
            station_id: payload.export_meta?.station_id || null,
            peer: fileDirection === 'STATION_TO_HUB'
                ? (dept === 'ENGINE' ? 'Engine' : (dept === 'DECK' ? 'Deck' : 'Station'))
                : (fileDirection === 'HQ_TO_SHIP' || fileDirection === 'SHIP_TO_HQ' ? 'Company' : null),
        });
        return payload;
    }

    return {
        exportZip, exportCompanyZip, importZip, importPayload, collectDelta, collectMonthlySnapshot, mergePayload,
        getHistory, recordSyncHistory, validateImportVesselId, validateImportPackageScope, resolveFileDepartment,
        resolveActiveImportDepartment, resolveExpectedVesselId,
        assertLicenseForPackage, licensedCompanyId,
    };
})();
