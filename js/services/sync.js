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
        if (s === 'deck_hq') return 'Deck (HQ reply)';
        if (s === 'engine_hq') return 'Engine (HQ reply)';
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
                `Department mismatch: current ${TVC_RBAC.getDeptLabel(activeDept)} ${roleLabel}, but the import file is ${TVC_RBAC.getDeptLabel(fileDept)} data.\n\nFile: ${filename}\n\nSelect the correct Department toggle and import again.`
            );
        }
    }

    /** Engine/Deck station PCs must Export to Master — not Import STATION_TO_HUB ZIP locally. */
    function stationExportImportDeniedMessage(fileDept) {
        const deptHint = fileDept ? ` (${TVC_RBAC.getDeptLabel(fileDept)} toggle)` : '';
        const crossDept = fileDept === 'ENGINE'
            ? 'Engine export is not applied in Deck Mode.'
            : fileDept === 'DECK'
                ? 'Deck export is not applied in Engine Mode.'
                : 'Engine/Deck export is not applied in the other department Mode.';
        return (
            `Import station export ZIP in Master Mode or HQ Mode${deptHint}.\n\n`
            + `${crossDept}\n\n`
            + 'On Engine/Deck station PCs, use Export to send data to Master — do not import station export ZIP here.'
        );
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
                throw new Error(stationExportImportDeniedMessage(fileDept));
            }
            if (!isMaster && !isHq) {
                throw new Error('Station export ZIP can be imported in Master Mode or HQ Mode.');
            }
            if ((isMaster || isHq) && !activeDept) {
                throw new Error(`Select the ${fileDept ? TVC_RBAC.getDeptLabel(fileDept) : 'Deck or Engine'} department toggle before Import.`);
            }
            assertDeptToggleMatch(activeDept, fileDept, filename, 'toggle is selected but');
            if (parsed && (parsed.scope === 'deck' || parsed.scope === 'engine') && activeDept) {
                const expectedScope = TVC_Filename.scopeToken(activeDept, false);
                if (parsed.scope !== expectedScope) {
                    throw new Error(
                        `Department mismatch: the ${importScopeLabel(expectedScope)} toggle is selected, but the import file is ${importScopeLabel(parsed.scope)} data.\n\nFile: ${filename}\n\nSelect the correct Department toggle and import again.`
                    );
                }
            }
            return { ok: true, activeDept, fileDept, route: isMaster ? 'hub_merge' : 'hq_direct' };
        }

        const hqImportFromShip = isHq && direction === 'SHIP_TO_HQ';
        const shipImportFromHq = !isHq && direction === 'HQ_TO_SHIP';

        if (hqImportFromShip) {
            if (!activeDept) {
                throw new Error('Select the Deck or Engine department toggle before Import.');
            }
            if (parsed && (parsed.scope === 'deck' || parsed.scope === 'engine')) {
                const expectedScope = TVC_Filename.scopeToken(activeDept, false);
                if (parsed.scope !== expectedScope) {
                    throw new Error(
                        `Department mismatch: the ${importScopeLabel(expectedScope)} toggle is selected, but the import file is ${importScopeLabel(parsed.scope)} data.\n\nFile: ${filename}\n\nSelect the correct Department toggle and import again.`
                    );
                }
            }
            assertDeptToggleMatch(activeDept, fileDept, filename, 'toggle is selected but');
        }

        if (shipImportFromHq) {
            if (isHq) {
                throw new Error('Import HQ reply ZIP on the vessel (Master / Engine / Deck Mode).');
            }
            if (fileDept === 'ENGINE' && isDeckStation) {
                throw new Error('Engine HQ reply is not applied in Deck Mode. Import in Engine Mode or Master Mode (Engine toggle).');
            }
            if (fileDept === 'DECK' && isEngineStation) {
                throw new Error('Deck HQ reply is not applied in Engine Mode. Import in Deck Mode or Master Mode (Deck toggle).');
            }
            if (parsed) {
                if (parsed.isHqReply && parsed.department) {
                    if (activeDept) {
                        const expectedScope = TVC_Filename.scopeToken(activeDept, false);
                        if (parsed.department !== expectedScope) {
                            throw new Error(
                                `Department mismatch: current department is ${TVC_RBAC.getDeptLabel(activeDept)}, but the import file is ${importScopeLabel(parsed.department)} HQ reply data.\n\nFile: ${filename}\n\nImport on the correct department PC/toggle.`
                            );
                        }
                    }
                } else if (parsed.scope !== 'hq' && !parsed.isHqReply) {
                    throw new Error(
                        `Invalid HQ reply file (scope: ${importScopeLabel(parsed.scope)}). HQ reply ZIP must use {engine|deck}_hq format.\n\nFile: ${filename}`
                    );
                }
            }
            assertDeptToggleMatch(activeDept, fileDept, filename, 'mode but');
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
                message: 'ZIP has no valid vessel_id. Check that this is a correct vessel export file.',
            };
        }
        if (!exp) return { ok: true, warning: 'expected_unconfigured' };
        if (exp !== got) {
            const ctx = isHq
                ? `Selected vessel in HQ is "${exp}".`
                : `Registered vessel on this PC is "${exp}".`;
            return {
                ok: false,
                code: 'VESSEL_MISMATCH',
                message: `Vessel ID mismatch: this ZIP is for vessel "${got}". ${ctx} Import stopped to prevent data corruption.`,
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

    function asIdSet(ids) {
        const set = new Set();
        (ids || []).forEach(id => {
            if (id == null || id === '') return;
            set.add(id);
            set.add(String(id));
        });
        return set;
    }

    function idInSet(id, set) {
        if (id == null || !set) return false;
        return set.has(id) || set.has(String(id));
    }

    /** job_code → Set(department). Deck/Engine may share the same code. */
    function buildJobDeptLookup(jobs) {
        const map = new Map();
        (jobs || []).forEach(j => {
            const code = j?.job_code;
            if (!code) return;
            const d = String(j.department || '').trim().toUpperCase();
            if (!map.has(code)) map.set(code, new Set());
            if (d) map.get(code).add(d);
        });
        return map;
    }

    /** dept 지정 시 해당 부서 데이터만 델타에 포함 (영구 분리) */
    async function collectDelta(dept, opts = {}) {
        const rows = await collectDeptRows(dept, {
            pendingOnly: !opts.hubRelayPending,
            hubRelayPending: !!opts.hubRelayPending,
        });
        if (Array.isArray(opts.reportIds)) {
            const idSet = asIdSet(opts.reportIds);
            rows.daily_work_reports = (rows.daily_work_reports || []).filter(r => idInSet(r.id, idSet));
        }
        if (opts.consumeLogIds?.length) {
            const logs = await TVC_DB.getAll('consume_logs').catch(() => []);
            const idSet = asIdSet(opts.consumeLogIds);
            rows.consume_logs = (logs || []).filter(l => idInSet(l.id, idSet));
            if (dept) {
                rows.consume_logs = rows.consume_logs.filter(l => !l.department || l.department === dept);
            }
        }
        return rows;
    }

    /** Monthly Report — 부서 전체 스냅샷 (sync_status / hub relay 무관) */
    async function collectMonthlySnapshot(dept) {
        return collectDeptRows(dept, { pendingOnly: false, hubRelayPending: false });
    }

    function collectCaseReviewJobRefs(jobs, reports, defects, permits, logs) {
        const byId = new Map(jobs.map(j => [j.id, j]));
        const byCode = new Map();
        const byCodeDept = new Map();
        (jobs || []).forEach(j => {
            if (!j?.job_code) return;
            byCode.set(j.job_code, j);
            byCodeDept.set(`${String(j.department || '').trim().toUpperCase()}|${j.job_code}`, j);
        });
        const picked = new Map();
        const addJob = (id, code, dept) => {
            const d = String(dept || '').trim().toUpperCase();
            const byIdHit = id ? byId.get(id) : null;
            const job = (byIdHit && (!d || String(byIdHit.department || '').trim().toUpperCase() === d) && byIdHit)
                || (code && d && byCodeDept.get(`${d}|${code}`))
                || byIdHit
                || (code && byCode.get(code));
            if (job) picked.set(job.id, job);
        };
        (reports || []).forEach(r => {
            TVC_WorkReport.fromLegacy?.(r);
            const dept = r.department;
            (r.job_items || []).forEach(item => addJob(item.maintenance_job_id, item.job_code, dept));
            addJob(r.maintenance_job_id, r.job_code || r.pms_job_code, dept);
        });
        (defects || []).forEach(d => {
            addJob(d.maintenance_job_id, d.pms_job_code || d.job_code, d.department);
            (d.job_items || []).forEach(item => addJob(item.maintenance_job_id, item.job_code, d.department));
        });
        (permits || []).forEach(p => {
            addJob(p.maintenance_job_id, p.job_code || p.pms_job_code, p.department);
            (p.job_items || []).forEach(item => addJob(item.maintenance_job_id, item.job_code, p.department));
        });
        (logs || []).forEach(l => {
            addJob(null, l.job_code, l.department);
            (l.job_items || l.lines || []).forEach(item => addJob(item.maintenance_job_id, item.job_code, l.department));
        });
        return [...picked.values()];
    }

    async function collectCaseReview(dept, ids = {}) {
        const reportIds = asIdSet(ids.reportIds);
        const defectIds = asIdSet(ids.defectIds);
        const permitIds = asIdSet(ids.workPermitIds);
        const consumeIds = asIdSet(ids.consumeLogIds);
        const [jobs, reports, defects, permits, logs] = await Promise.all([
            TVC_DB.getAll('maintenance_jobs'),
            TVC_DB.getAll('daily_work_reports'),
            TVC_DB.getAll('defect_cases').catch(() => []),
            TVC_DB.getAll('work_permits').catch(() => []),
            TVC_DB.getAll('consume_logs').catch(() => []),
        ]);
        const deptByCode = buildJobDeptLookup(jobs);
        const wantDept = String(dept || '').trim().toUpperCase();
        const pReports = (reports || []).filter(r => {
            if (!idInSet(r.id, reportIds)) return false;
            if (!dept) return true;
            if (TVC_WorkReport.belongsToDepartment(r, dept, deptByCode)) return true;
            // UI already scoped this id; keep when department is unset and job-code map missed.
            return !String(r.department || '').trim();
        });
        pReports.forEach(r => {
            if (wantDept && !String(r.department || '').trim()) r.department = wantDept;
        });
        const pDefects = (defects || []).filter(d => idInSet(d.id, defectIds)
            && (!dept || TVC_DefectCase.belongsToDepartment(d, dept)));
        const pPermits = (permits || []).filter(p => idInSet(p.id, permitIds)
            && (!dept || TVC_WorkPermit.belongsToDepartment(p, dept)));
        const pLogs = (logs || []).filter(l => idInSet(l.id, consumeIds)
            && (!dept || !l.department || String(l.department).toUpperCase() === wantDept));
        return {
            maintenance_jobs: collectCaseReviewJobRefs(jobs, pReports, pDefects, pPermits, pLogs),
            daily_work_reports: pReports,
            defect_cases: pDefects,
            work_permits: pPermits,
            consume_logs: pLogs,
            spare_parts: [],
            ship_components: [],
            audit_logs: [],
            requisitions: [],
            job_bom: [],
            universal_catalog: [],
            maintenance_groups: [],
            spare_groups: [],
        };
    }

    async function collectDeptRows(dept, opts = {}) {
        const hubRelayPending = opts.hubRelayPending === true;
        const pendingOnly = opts.pendingOnly !== false && !hubRelayPending;
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
        const pending = (rows) => {
            if (hubRelayPending && typeof TVC_HubRelay !== 'undefined') {
                return TVC_HubRelay.filterHubPending(rows);
            }
            return pendingOnly ? rows.filter(r => r.sync_status !== 'SYNCED') : rows;
        };
        const deptByCode = buildJobDeptLookup(jobs);

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

    async function buildExportZipBlob(user, direction, dept, opts = {}) {
        const hubRelayHqReply = direction === 'HQ_TO_SHIP'
            && typeof TVC_Space !== 'undefined'
            && TVC_Space.isCaptainHub(user)
            && !TVC_RBAC.isHqAccount(user);
        const action = (direction === 'HQ_TO_SHIP' && !hubRelayHqReply)
            ? TVC_RBAC.Action.EXPORT_HQ_FEEDBACK
            : TVC_RBAC.Action.EXPORT_SHIP_SYNC;
        TVC_RBAC.assert(user, action);
        if (direction === 'STATION_TO_HUB' && typeof TVC_Space !== 'undefined') {
            TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.STATION_EXPORT);
        }
        if (!dept) throw new Error('Select a department (DECK / ENGINE).');
        const accessDept = typeof TVC_Space !== 'undefined' && user?.station
            ? TVC_Space.canAccessDepartment(user, dept)
            : TVC_RBAC.canAccessDepartment(user, dept);
        if (!accessDept) throw new Error(`This account cannot export ${dept} department data.`);

        const hubRelayPending = typeof TVC_HubRelay !== 'undefined'
            && TVC_HubRelay.isHubRelayExport(user)
            && direction === 'SHIP_TO_HQ';

        const delta = opts.caseReview
            ? await collectCaseReview(dept, opts.caseReview)
            : opts.monthlyExport
                ? await collectMonthlySnapshot(dept)
                : await collectDelta(dept, {
                    reportIds: opts.reportIds,
                    consumeLogIds: opts.consumeLogIds,
                    hubRelayPending,
                });
        if (opts.monthlyExport && Array.isArray(opts.reportIds)) {
            const idSet = asIdSet(opts.reportIds);
            delta.daily_work_reports = (delta.daily_work_reports || []).filter(r => idInSet(r.id, idSet));
        }
        const recordCount = Object.values(delta).reduce((sum, rows) => sum + (rows?.length || 0), 0);
        if (!opts.monthlyExport && !opts.caseReview && recordCount === 0) {
            throw new Error('No changes to export. Confirm Work Reports first.');
        }
        if (opts.caseReview && recordCount === 0) {
            throw new Error('No Case Reports to export.');
        }
        const isHq = TVC_RBAC.isHqAccount(user);
        const vesselId = await resolveExpectedVesselId(user, isHq, opts.expectedVesselId);
        if (!vesselId) throw new Error('Vessel ID is missing. Select a vessel first.');
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
                ...(opts.monthlyExport && opts.outstanding ? { outstanding: opts.outstanding } : {}),
                ...(opts.caseReview ? { package_type: 'CASE' } : {}),
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
        zip.file('README.txt', opts.caseReview
            ? `TVC-PMS Case Report\nVessel: ${vesselId}\nDept: ${dept}\nDate: ${payload.export_meta.export_date}\nDirection: ${direction}\nIncludes W/M/D/P/C for ${hubRelayHqReply ? 'Station (HQ approval reply)' : 'Company period review'}.`
            : `TVC-PMS Sync Package\nVessel: ${vesselId}\nDept: ${dept}\nDate: ${payload.export_meta.export_date}\nDirection: ${direction}`);

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
        } else if (opts.caseReview && typeof TVC_Filename !== 'undefined') {
            const scope = direction === 'HQ_TO_SHIP'
                ? TVC_Filename.hqReplyScopeToken(dept)
                : undefined;
            filename = await TVC_Filename.build({
                vesselId,
                type: 'casereport',
                department: dept,
                scope,
                ext: 'zip',
                dateTag: exportDate,
            });
        } else if (opts.caseReview) {
            const scope = direction === 'HQ_TO_SHIP'
                ? `${String(dept || 'ENGINE').toLowerCase()}_hq`
                : String(dept || 'ENGINE').toLowerCase();
            filename = `${String(vesselId || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '')}_casereport_${scope}_${exportDate}_001.zip`;
        } else {
            const prefix = direction === 'STATION_TO_HUB' ? `${vesselId}_${stationId || dept}_STATION` : `${vesselId}_${dept}_PMS_EXPORT`;
            filename = `${prefix}_${exportDate}.zip`;
        }

        return {
            blob,
            filename,
            payload,
            delta,
            record_count: recordCount,
            vessel_id: vesselId,
            company_id: companyId,
            department: dept,
            station_id: stationId,
            hubRelayHqReply,
        };
    }

    async function finalizeZipExport(user, direction, dept, delta, built, opts = {}) {
        if (!opts.skipMarkExported) await markExported(delta, user, direction);
        await TVC_DB.setMeta(TVC_META_KEYS.LAST_EXPORT, now());
        await TVC_DB.put('audit_logs', {
            timestamp: new Date().toLocaleString(),
            log: `📦 [Export/${direction}/${dept}] ${built.filename}`,
            sync_status: 'SYNCED',
        });
        if (opts.skipSyncHistory) return;
        await recordSyncHistory({
            type: 'EXPORT',
            direction,
            department: dept,
            vessel_id: built.vessel_id,
            filename: built.filename,
            record_count: built.record_count,
            status: 'SUCCESS',
            space: spaceOf(user),
            station_id: built.station_id || null,
            package_type: opts.caseReview ? 'CASE' : (opts.monthlyExport ? 'MONTHLY' : undefined),
            channel: opts.channel || undefined,
            peer: opts.monthlyExport || opts.caseReview
                ? (built.hubRelayHqReply ? 'Station' : 'Master/HQ')
                : (direction === 'STATION_TO_HUB'
                    ? 'Master'
                    : (direction === 'SHIP_TO_HQ' || direction === 'HQ_TO_SHIP' ? 'Company' : null)),
        });
    }

    async function exportZip(user, direction, dept, opts = {}) {
        const built = await buildExportZipBlob(user, direction, dept, opts);
        await TVC_FileExport.save(built.blob, built.filename);
        await finalizeZipExport(user, direction, dept, built.delta, built, opts);
        return built.payload;
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

    const SPARE_SYNC_CATEGORIES = new Set([
        'REQUISITION', 'QUOTATION', 'REPLY_EVALUATION', 'PURCHASE_ORDER',
        'RECEIVED', 'INVENTORY', 'ASSESSMENT',
    ]);

    function isSpareSyncHistoryRow(row) {
        const scope = String(row?.scope || '').toUpperCase();
        if (scope === 'SPARE') return true;
        const cat = String(row?.category || '').toUpperCase();
        if (cat && SPARE_SYNC_CATEGORIES.has(cat)) return true;
        const d = String(row?.direction || '').toUpperCase();
        return d.startsWith('SPARE_');
    }

    function isPmsSyncHistoryRow(row) {
        return !isSpareSyncHistoryRow(row);
    }

    async function getHistory(limit = 30) {
        const rows = await TVC_DB.getAll('sync_history');
        return rows.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, limit);
    }

    async function markExported(delta, user, direction) {
        const hubStationForward = direction === 'HQ_TO_SHIP'
            && typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub(user)
            && !TVC_RBAC.isHqAccount(user);
        const stores = ['maintenance_jobs', 'daily_work_reports', 'spare_parts', 'ship_components', 'audit_logs', 'requisitions', 'job_bom', 'universal_catalog', 'maintenance_groups', 'spare_groups', 'defect_cases', 'work_permits', 'consume_logs'];
        for (const store of stores) {
            for (const row of delta[store] || []) {
                if (typeof TVC_HubRelay !== 'undefined') {
                    TVC_HubRelay.stampExport(user, row);
                } else {
                    row.sync_status = 'SYNCED';
                }
                row.last_synced_at = now();
                if (hubStationForward) {
                    if (store === 'defect_cases'
                        && typeof TVC_DefectCase?.isHqReplyStationForwardPending === 'function'
                        && TVC_DefectCase.isHqReplyStationForwardPending(row)) {
                        TVC_DefectCase.stampHqReplyStationForwarded(row);
                    } else if (store === 'work_permits'
                        && typeof TVC_WorkPermit?.isHqReplyStationForwardPending === 'function'
                        && TVC_WorkPermit.isHqReplyStationForwardPending(row)) {
                        TVC_WorkPermit.stampHqReplyStationForwarded(row);
                    } else if (store === 'daily_work_reports') {
                        TVC_WorkReport.fromLegacy?.(row);
                        const wt = String(row.work_type || '').toUpperCase();
                        const approved = !!(row.approved_at || row.approved_by)
                            || (typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isApprovedStatus?.(row.status, row.is_locked));
                        if (wt === 'POSTPONE' && approved && !row.hq_reply_forwarded_at) {
                            row.hq_reply_forwarded_at = now();
                        }
                    }
                }
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
                throw new Error('Captain Hub can merge Station Export (STATION_TO_HUB) packages only.');
            }
        } else if (fileDirection === 'STATION_TO_HUB') {
            if (!isHq) {
                throw new Error('Import Station export ZIP in Master Mode or HQ Mode.');
            }
        }

        if (!dept) throw new Error('Select a department to import (DECK / ENGINE).');
        const accessDept = typeof TVC_Space !== 'undefined' && user?.station && !isHubMerge
            ? TVC_Space.canAccessDepartment(user, dept)
            : TVC_RBAC.canAccessDepartment(user, dept);
        if (!accessDept && !isHubMerge) throw new Error(`This account cannot import ${dept} department data.`);

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
            await failImport(new Error(`Department mismatch: selected department (${dept}) does not match the file (${fileDept}).`));
        }
        if (directionHint && fileDirection && fileDirection !== directionHint) {
            await failImport(new Error(`Direction mismatch: expected ${directionHint}, file has ${fileDirection}.`));
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
            package_type: payload.export_meta?.package_type || undefined,
            peer: isHubMerge && importDir === 'STATION_TO_HUB'
                ? (dept === 'ENGINE' ? 'Engine' : (dept === 'DECK' ? 'Deck' : 'Station'))
                : (importDir === 'HQ_TO_SHIP' || importDir === 'SHIP_TO_HQ' ? (isHq ? null : 'Company') : null),
        });
        return payload;
    }

    async function mergePayload(payload, dept, isHq, vesselId, opts = {}) {
        const importAuthoritative = !!opts.importAuthoritative;
        const jobDeptByCode = buildJobDeptLookup(payload.maintenance_jobs || []);
        const deptOk = (row, kind) => {
            if (!dept) return true;
            if (kind === 'job') return !row.department || row.department === dept;
            if (kind === 'component') return !row.path || row.path[0] === dept;
            if (kind === 'report') return TVC_WorkReport.belongsToDepartment(row, dept, jobDeptByCode);
            if (kind === 'group') return !row.department || row.department === dept;
            if (kind === 'defect') return TVC_DefectCase.belongsToDepartment(row, dept);
            if (kind === 'work_permit') return TVC_WorkPermit.belongsToDepartment(row, dept);
            if (kind === 'consume') return !row.department || row.department === dept;
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
                if (typeof TVC_DefectCase.applyHqReplyOnShip === 'function') {
                    TVC_DefectCase.applyHqReplyOnShip(row);
                }
                const isHub = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub
                    && typeof TVC_Auth !== 'undefined' && TVC_Space.isCaptainHub(TVC_Auth.getCurrentUser());
                if (isHub && (row.approved_at || row.approved_by) && !row.hq_reply_forwarded_at) {
                    row.hq_reply_forward_pending = true;
                }
            }
            if (!isHq && kind === 'report' && (direction === 'HQ_TO_SHIP' || direction === 'POSTPONE_REPLY_HQ_TO_SHIP')) {
                TVC_WorkReport.fromLegacy?.(row);
                const wt = String(row.work_type || '').toUpperCase();
                const isHub = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub
                    && typeof TVC_Auth !== 'undefined' && TVC_Space.isCaptainHub(TVC_Auth.getCurrentUser());
                if (isHub && wt === 'POSTPONE' && (row.approved_at || row.approved_by) && !row.hq_reply_forwarded_at) {
                    row.hq_reply_forward_pending = true;
                }
            }
            if (kind === 'work_permit') {
                row.visible_in_list = row.visible_in_list !== false;
                const metaDeptWp = payload.export_meta?.department;
                if ((!row.department || row.department === 'ALL') && metaDeptWp && metaDeptWp !== 'ALL') {
                    row.department = metaDeptWp;
                }
                if (!isHq && (direction === 'WORK_PERMIT_REPLY_HQ_TO_SHIP' || direction === 'HQ_TO_SHIP')) {
                    if (direction === 'WORK_PERMIT_REPLY_HQ_TO_SHIP' && !row.approved_at && !row.approved_by) {
                        row.approved_at = payload.export_meta?.export_date || now().slice(0, 10);
                        row.approved_by = payload.export_meta?.exported_by || 'Company';
                    }
                    const isHub = typeof TVC_Space !== 'undefined' && TVC_Space.isCaptainHub
                        && typeof TVC_Auth !== 'undefined' && TVC_Space.isCaptainHub(TVC_Auth.getCurrentUser());
                    if (isHub && (row.approved_at || row.approved_by) && !row.hq_reply_forwarded_at) {
                        row.hq_reply_forward_pending = true;
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
                    const keepShipDefect = (!isHq && kind === 'defect'
                        && /HQ_TO_SHIP|DEFECT_REPLY|DEFECT_CLOSE/i.test(payload.export_meta?.direction || ''))
                        ? {
                            defect_cleared: existing.defect_cleared,
                            phase3_locked: existing.phase3_locked,
                            completed_at: existing.completed_at,
                            ship_verified_after_clear: existing.ship_verified_after_clear,
                            ship_verified_by: existing.ship_verified_by,
                            ship_verified_date: existing.ship_verified_date,
                            job_schedule_applied_at: existing.job_schedule_applied_at,
                            completion_exported_at: existing.completion_exported_at,
                            last_export_filename: existing.last_export_filename,
                            working_hours: existing.working_hours,
                            working_member: existing.working_member,
                            shore_support: existing.shore_support,
                            shore_technician: existing.shore_technician,
                        }
                        : null;
                    Object.assign(existing, incoming);
                    if (keepShipDefect) {
                        Object.keys(keepShipDefect).forEach(k => {
                            if (keepShipDefect[k] !== undefined && keepShipDefect[k] !== null && keepShipDefect[k] !== '') {
                                existing[k] = keepShipDefect[k];
                            }
                        });
                        if (keepShipDefect.defect_cleared) existing.defect_cleared = true;
                        if (keepShipDefect.phase3_locked) existing.phase3_locked = true;
                    }
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
        await mergeStore('consume_logs', payload.consume_logs, 'consume');

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


    async function buildCompanyZipBlob(user, opts = {}) {
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
        const recordCount = Object.values(merged).reduce((sum, rows) => sum + (rows?.length || 0), 0);

        if (!opts.skipMarkExported) {
            await markExported(merged, user, 'SHIP_TO_HQ');
            await TVC_DB.setMeta(TVC_META_KEYS.LAST_EXPORT, now());
            await TVC_DB.put('audit_logs', {
                timestamp: new Date().toLocaleString(),
                log: `📦 [Export/SHIP_TO_HQ/ALL] ${filename}`,
                sync_status: 'SYNCED',
            });
        }

        return { blob, filename, payload, vessel_id: vesselId, company_id: companyId, record_count: recordCount };
    }

    async function exportCompanyZip(user) {
        const built = await buildCompanyZipBlob(user);
        await TVC_FileExport.save(built.blob, built.filename);
        await recordSyncHistory({
            type: 'EXPORT',
            direction: 'SHIP_TO_HQ',
            department: 'ALL',
            vessel_id: built.vessel_id,
            filename: built.filename,
            record_count: built.record_count,
            status: 'SUCCESS',
            space: spaceOf(user),
        });
        return built.payload;
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
        exportZip, exportCompanyZip, buildCompanyZipBlob, buildExportZipBlob, finalizeZipExport, importZip, importPayload, collectDelta, collectMonthlySnapshot, collectCaseReview, mergePayload,
        getHistory, recordSyncHistory, isSpareSyncHistoryRow, isPmsSyncHistoryRow,
        validateImportVesselId, validateImportPackageScope, resolveFileDepartment,
        resolveActiveImportDepartment, resolveExpectedVesselId,
        assertLicenseForPackage, licensedCompanyId, stationExportImportDeniedMessage,
    };
})();
