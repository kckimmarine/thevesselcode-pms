/** THE VESSEL CODE — Station sync (CCR/ECR → Captain Hub merge, Company export) */
const TVC_StationSync = (function () {
    const STORE_KEYS = [
        'maintenance_jobs', 'maintenance_groups', 'daily_work_reports',
        'spare_parts', 'ship_components', 'audit_logs', 'requisitions', 'job_bom', 'universal_catalog',
    ];

    function emptyPayload() {
        const p = { export_meta: {} };
        for (const k of STORE_KEYS) p[k] = [];
        return p;
    }

    /** CCR/ECR — Captain Hub로보낼 Station 패키지 (ZIP + JSON) */
    async function exportStationPackage(user) {
        TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.STATION_EXPORT);
        const dept = user.department || TVC_Space.fixedDepartment(TVC_Space.getStation(user));
        return TVC_Sync.exportZip(user, TVC_Space.Direction.STATION_TO_HUB, dept, {
            station_id: TVC_Space.getStation(user),
        });
    }

    /** Captain Hub — Station ZIP / JSON / CSV 병합 */
    async function importStationPackage(user, file) {
        if (!file) throw new Error('파일을 선택하세요.');
        TVC_Space.assertEndpoint(user, TVC_Space.Endpoint.HUB_IMPORT);
        const name = (file.name || '').toLowerCase();

        if (name.endsWith('.zip')) {
            return TVC_Sync.importZip(user, file, null, { allowHubMerge: true });
        }
        if (name.endsWith('.json')) {
            const text = await file.text();
            const payload = JSON.parse(text);
            return TVC_Sync.importPayload(user, payload, file, { allowHubMerge: true });
        }
        if (name.endsWith('.csv')) {
            const payload = await parseCsvToPayload(file);
            return TVC_Sync.importPayload(user, payload, file, { allowHubMerge: true });
        }
        throw new Error('지원 형식: .zip, .json, .csv');
    }

    /** Captain — 회사 보고용 전체 패키지 */
    async function exportCompanyPackage(user) {
        return TVC_Sync.exportCompanyZip(user);
    }

    /** 간단 CSV → daily_work_reports 병합용 payload (Station 델타 요약) */
    async function parseCsvToPayload(file) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) throw new Error('CSV에 데이터 행이 없습니다.');

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const idx = (k) => headers.indexOf(k);
        const payload = emptyPayload();
        payload.export_meta = {
            direction: 'STATION_TO_HUB',
            department: headers.includes('department') ? null : 'DECK',
            export_date: new Date().toISOString().slice(0, 10),
            vessel_id: (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || 'UNKNOWN',
            schema_version: 6,
            source_format: 'CSV',
        };

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            const jobCode = cols[idx('job_code')] || cols[0];
            const status = (cols[idx('status')] || 'PENDING').toUpperCase();
            const dept = (cols[idx('department')] || payload.export_meta.department || 'DECK').toUpperCase();
            if (!payload.export_meta.department) payload.export_meta.department = dept;

            payload.daily_work_reports.push({
                id: `csv-${jobCode}-${i}`,
                job_code: jobCode,
                status,
                reporter_name: cols[idx('reporter')] || 'Station CSV',
                created_at: cols[idx('date')] || new Date().toISOString(),
                sync_status: 'LOCAL',
                updated_at: new Date().toISOString(),
            });
        }
        return payload;
    }

    return { exportStationPackage, importStationPackage, exportCompanyPackage };
})();
