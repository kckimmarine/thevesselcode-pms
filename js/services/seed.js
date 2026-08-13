/* Seed loader from pms-unified.json */
const TVC_Seed = (function () {
    async function loadFromJson(data) {
        const ts = new Date().toISOString();
        const seedVessel = data.meta?.vessel_id
            || (typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.PILOT_VESSEL_ID : 'INCHEON CHEMI');
        const jobs = (data.maintenance_jobs || []).map(j => ({
            ...j,
            vessel_id: j.vessel_id || seedVessel,
            original_next_date: j.original_next_date || j.next_date || null,
            sync_status: 'SYNCED',
            updated_at: ts,
            is_locked: false,
            plan_status: j.is_overdue ? 'OVERDUE' : 'PLANNED',
        }));
        const components = (data.ship_components || []).map(c => ({
            ...c,
            vessel_id: c.vessel_id || seedVessel,
            sync_status: 'SYNCED',
            updated_at: ts,
        }));
        const spares = (data.spare_parts || []).map(s => ({
            ...s,
            vessel_id: s.vessel_id || seedVessel,
            sync_status: 'SYNCED',
            updated_at: ts,
        }));

        await TVC_DB.bulkPut('ship_components', components);
        await TVC_DB.bulkPut('maintenance_jobs', jobs);
        await TVC_DB.bulkPut('spare_parts', spares);
        await TVC_DB.setMeta(TVC_META_KEYS.VESSEL_ID, seedVessel);
        await TVC_DB.setMeta(TVC_META_KEYS.SEED_LOADED, ts);
        await TVC_DB.setMeta(TVC_META_KEYS.DB_INIT, ts);
        return { jobs: jobs.length, components: components.length };
    }

    async function tryFetchSeed() {
        try {
            const res = await fetch('data/pms-unified.json');
            if (!res.ok) return null;
            return loadFromJson(await res.json());
        } catch {
            return null;
        }
    }

    async function loadFromFile(file) {
        const text = await file.text();
        return loadFromJson(JSON.parse(text));
    }

    async function ensureSeed() {
        const loaded = await TVC_DB.getMeta(TVC_META_KEYS.SEED_LOADED);
        if (loaded) return { already: true };
        const result = await tryFetchSeed();
        if (result) return result;
        return { needFile: true };
    }

    /* 정규화된 부품명 → 공통 관리 코드(UniversalItemCode).
       같은 이름이면 선박이 달라도 동일 코드를 갖게 하여 본사 통합관리를 가능케 한다. */
    function universalCodeFor(name) {
        const key = String(name || 'UNSPEC').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
        let h = 0;
        for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
        return 'UNI-' + Math.abs(h).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
    }

    /**
     * Inventory 관계 데이터 기본값 시딩 (idempotent, additive).
     *  1) spare_parts 에 standard_stock / universal_code 등 신규 옵션 필드 보강
     *  2) universal_catalog 생성 (공통코드 마스터)
     *  3) job_bom 이 비어있으면 데모 BOM 생성 (엔진 정비작업 ↔ 부품)
     * 기존 값은 절대 덮어쓰지 않는다.
     */
    async function ensureInventoryDefaults() {
        const ts = new Date().toISOString();
        const spares = await TVC_DB.getAll('spare_parts');

        // 1) 부품 필드 보강 + 2) 공통코드 마스터
        const catalog = {};
        for (const s of spares) {
            let changed = false;
            if (s.universal_code == null) { s.universal_code = universalCodeFor(s.name); changed = true; }
            if (s.standard_stock == null) { s.standard_stock = Number(s.min_qty || 0) || 0; changed = true; }
            if (s.maker == null) { s.maker = ''; changed = true; }
            if (s.model == null) { s.model = ''; changed = true; }
            if (s.price === undefined) { s.price = null; changed = true; }
            if (s.category == null) { s.category = (s.name || '').split(' ')[0] || 'GENERAL'; changed = true; }
            if (s.location == null) { s.location = ''; changed = true; }
            if (s.is_critical == null) { s.is_critical = false; changed = true; }
            if (!Array.isArray(s.history)) { s.history = []; changed = true; }
            if (s.schema_version == null) { s.schema_version = 1; changed = true; }
            if (changed) { s.updated_at = ts; await TVC_DB.put('spare_parts', s); }

            if (!catalog[s.universal_code]) {
                catalog[s.universal_code] = {
                    universal_code: s.universal_code,
                    description: s.name || '',
                    category: (s.name || '').split(' ')[0] || 'GENERAL',
                    standard_unit: s.unit || 'EA',
                    updated_at: ts,
                    sync_status: 'SYNCED',
                };
            }
        }
        const catRows = Object.values(catalog);
        if (catRows.length) await TVC_DB.bulkPut('universal_catalog', catRows);

        // 3) 데모 BOM (job_bom 비어있을 때만)
        const existingBom = await TVC_DB.getAll('job_bom');
        if (!existingBom.length && spares.length) {
            const jobs = await TVC_DB.getAll('maintenance_jobs');
            // 엔진(시간기반 우선) 정비작업을 우선 매칭 → 실제 존재하는 job_code 로만 링크
            const engineJobs = jobs.filter(j => (j.department === 'ENGINE'))
                .sort((a, b) => (b.unit === 'H' ? 1 : 0) - (a.unit === 'H' ? 1 : 0));
            const pool = engineJobs.length ? engineJobs : jobs;
            const bomRows = [];
            spares.forEach((s, i) => {
                const job = pool[i % pool.length];
                if (!job) return;
                bomRows.push({
                    id: 'BOM-SEED-' + i,
                    schema_version: 1,
                    job_code: job.job_code,
                    spare_part_id: s.id,
                    qty_per_job: 1,
                    created_at: ts,
                    sync_status: 'SYNCED',
                });
            });
            if (bomRows.length) await TVC_DB.bulkPut('job_bom', bomRows);
        }

        await TVC_DB.setMeta(TVC_META_KEYS.INVENTORY_DEFAULTS, ts);
        return { spares: spares.length, catalog: catRows.length };
    }

    /**
     * 권장: data/spare-inventory.xls (ENGINE) 자동 적재 — 1회 idempotent
     * 부품 100건 미만이거나 아직 XLS 미적재 시 실행
     */
    async function ensureSpareInventoryXls(opts = {}) {
        const force = !!opts.force;
        const existing = await TVC_DB.getAll('spare_parts');
        const engineLike = existing.filter(s =>
            /^\d{2}-\d{3}-\d{2}/.test(String(s.part_no || s.inventory_numbering || ''))
            || (s.category || '').toUpperCase() === 'ENGINE'
        );
        const loaded = await TVC_DB.getMeta(TVC_META_KEYS.INVENTORY_XLS_LOADED);
        if (!force && loaded && engineLike.length >= 500) {
            return { already: true, at: loaded, count: engineLike.length };
        }
        if (!force && engineLike.length >= 500) {
            return { skipped: true, count: engineLike.length };
        }

        if (TVC_Env.isFileProtocol()) {
            return { skipped: true, fileProtocol: true, hint: TVC_Env.FILE_HINT };
        }

        try {
            const importOpts = { department: 'ENGINE', sheetName: 'ENGINE', merge: true };
            let result;
            try {
                result = await TVC_DB.InventoryDB.importXlsFromUrl(opts.url || 'data/spare-inventory.xls', importOpts);
            } catch (xlsErr) {
                if (xlsErr.code === 'NOT_FOUND' || /404|fetch/i.test(xlsErr.message || '')) {
                    result = await TVC_DB.loadSpareInventory(null, importOpts);
                } else {
                    throw xlsErr;
                }
            }
            console.info('[SPARE] ENGINE inventory loaded via loadSpareInventory', result.stats);
            return { loaded: true, ...result };
        } catch (e) {
            console.warn('[SPARE] spare-inventory.xls auto-load failed', e);
            return { error: e.message || String(e), code: e.code };
        }
    }

    return { ensureSeed, loadFromFile, loadFromJson, ensureInventoryDefaults, ensureSpareInventoryXls };
})();
