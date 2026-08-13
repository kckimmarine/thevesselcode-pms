/* Vessel Profile — HQ Export → Ship Import (identity metadata only) */
const TVC_VesselProfileSync = (function () {
    const KIND = 'TVC_VESSEL_PROFILE';
    const VERSION = 1;
    const DIRECTION = 'VESSEL_PROFILE_HQ_TO_SHIP';
    const JSON_NAME = 'tvc_vessel_profile.json';

    const FIELDS = [
        { key: 'vessel_id', label: 'vessel id' },
        { key: 'name', label: '표시명' },
        { key: 'company_id', label: 'company id' },
        { key: 'imo_no', label: 'IMO' },
        { key: 'delivery', label: 'delivery' },
        { key: 'code', label: 'code' },
    ];

    function companyId() {
        if (typeof TVC_Fleet !== 'undefined' && TVC_Fleet.COMPANY_ID) return TVC_Fleet.COMPANY_ID;
        if (typeof TVC_License !== 'undefined' && TVC_License.COMPANY_ID) return TVC_License.COMPANY_ID;
        return 'DAEMYUNG';
    }

    function normalizeProfile(raw = {}) {
        const vesselId = String(raw.vessel_id || raw.id || '').trim();
        return {
            vessel_id: vesselId,
            name: String(raw.name || vesselId || '').trim(),
            company_id: String(raw.company_id || companyId()).trim(),
            imo_no: String(raw.imo_no || '').trim(),
            delivery: String(raw.delivery || '').trim().slice(0, 10),
            code: String(raw.code || '').trim(),
        };
    }

    function profileFromFleet(vesselId) {
        const id = String(vesselId || '').trim();
        if (!id) throw Object.assign(new Error('Select a vessel in Fleet first.'), { code: 'VESSEL_REQUIRED' });
        const hit = (typeof TVC_Fleet !== 'undefined' && TVC_Fleet.resolveById)
            ? TVC_Fleet.resolveById(id)
            : { id, name: id };
        return normalizeProfile({
            vessel_id: hit.id || id,
            name: hit.name || id,
            company_id: companyId(),
            imo_no: hit.imo_no,
            delivery: hit.delivery,
            code: hit.code,
        });
    }

    async function buildPayload(user, vesselId) {
        const profile = profileFromFleet(vesselId);
        return {
            kind: KIND,
            version: VERSION,
            export_meta: {
                direction: DIRECTION,
                vessel_id: profile.vessel_id,
                company_id: profile.company_id,
                exported_at: new Date().toISOString(),
                exported_by: user?.username || '',
                account_type: user?.account_type || '',
            },
            profile,
        };
    }

    async function exportZip(user, opts = {}) {
        if (!user || !TVC_RBAC.isHqAccount(user)) {
            throw Object.assign(new Error('Vessel Profile Export는 HQ Mode에서만 가능합니다.'), { code: 'FORBIDDEN' });
        }
        const vesselId = opts.vesselId
            || opts.selectedVesselId
            || (typeof TVC_Fleet !== 'undefined' ? TVC_Fleet.getSelectedId() : null);
        const payload = await buildPayload(user, vesselId);
        if (typeof JSZip === 'undefined') throw new Error('JSZip이 로드되지 않았습니다.');

        let filename;
        if (typeof TVC_Filename !== 'undefined' && TVC_Filename.build) {
            filename = await TVC_Filename.build({
                vesselId: payload.profile.vessel_id,
                type: 'vessel_profile',
                scope: 'hq',
                ext: 'zip',
            });
        } else {
            const slug = String(payload.profile.vessel_id || 'vessel').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'vessel';
            const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            filename = `${slug}_vessel_profile_hq_${dateTag}_001.zip`;
        }

        const zip = new JSZip();
        zip.file(JSON_NAME, JSON.stringify(payload, null, 2));
        zip.file('README.txt', [
            'THE VESSEL CODE — Vessel Profile',
            `Vessel: ${payload.profile.vessel_id}`,
            `Exported: ${payload.export_meta.exported_at}`,
            '',
            'Import on ship: Menu → Data Export & Import → Import → Vessel Profile',
        ].join('\n'));
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        await TVC_FileExport.save(blob, filename);

        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'EXPORT',
                direction: DIRECTION,
                department: 'ALL',
                vessel_id: payload.profile.vessel_id,
                filename,
                record_count: 1,
                status: 'SUCCESS',
                space: 'HQ',
                peer: 'Ship',
            });
        }
        return { filename, profile: payload.profile, payload };
    }

    async function parseFile(file) {
        if (!file) throw new Error('파일이 없습니다.');
        const name = (file.name || '').toLowerCase();
        let text = '';
        if (name.endsWith('.json')) {
            text = await file.text();
        } else {
            if (typeof JSZip === 'undefined') throw new Error('JSZip이 로드되지 않았습니다.');
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const jsonFile = zip.file(JSON_NAME)
                || zip.file(/tvc_vessel_profile\.json$/i)[0]
                || zip.file(/\.json$/i)[0];
            if (!jsonFile) throw new Error('ZIP에 tvc_vessel_profile.json이 없습니다.');
            text = await jsonFile.async('string');
        }
        const payload = JSON.parse(text);
        if (payload?.kind !== KIND) {
            throw new Error('Vessel Profile 파일이 아닙니다.');
        }
        if (!payload.profile?.vessel_id && !payload.export_meta?.vessel_id) {
            throw new Error('Vessel Profile에 vessel_id가 없습니다.');
        }
        payload.profile = normalizeProfile({
            ...payload.profile,
            vessel_id: payload.profile?.vessel_id || payload.export_meta?.vessel_id,
            company_id: payload.profile?.company_id || payload.export_meta?.company_id,
        });
        return payload;
    }

    function isVesselProfileFile(payload) {
        return payload?.kind === KIND
            || payload?.export_meta?.direction === DIRECTION;
    }

    async function resolveShipVesselId(user) {
        try {
            const meta = await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID);
            if (meta) return String(meta).trim();
        } catch (_) {}
        return String(user?.vessel_id || '').trim();
    }

    async function validateForShip(payload, user) {
        if (!user || TVC_RBAC.isHqAccount(user)) {
            return { ok: false, error: 'Vessel Profile Import는 선박 Mode에서만 가능합니다.' };
        }
        const expected = await resolveShipVesselId(user);
        const got = String(payload?.profile?.vessel_id || '').trim();
        if (!expected) return { ok: false, error: '이 PC의 vessel_id를 확인할 수 없습니다.' };
        if (!got) return { ok: false, error: '파일에 vessel_id가 없습니다.' };
        if (expected !== got) {
            return {
                ok: false,
                error: `선박 불일치: 이 PC는 "${expected}", 파일은 "${got}" 입니다.`,
            };
        }
        const company = String(payload?.profile?.company_id || '').trim();
        if (company && company !== companyId()) {
            return {
                ok: false,
                error: `Company 불일치: 파일 "${company}", 이 설치본 "${companyId()}"`,
            };
        }
        return { ok: true, expected, profile: payload.profile };
    }

    function currentShipProfile(vesselId) {
        return profileFromFleet(vesselId);
    }

    function diffRows(current, incoming) {
        const a = normalizeProfile(current);
        const b = normalizeProfile(incoming);
        return FIELDS.map(f => ({
            key: f.key,
            label: f.label,
            current: a[f.key] || '—',
            incoming: b[f.key] || '—',
            changed: String(a[f.key] || '') !== String(b[f.key] || ''),
        }));
    }

    async function apply(payload, user, opts = {}) {
        const check = await validateForShip(payload, user);
        if (!check.ok) throw Object.assign(new Error(check.error), { code: 'VALIDATION' });

        const profile = normalizeProfile(payload.profile);
        if (typeof TVC_Fleet !== 'undefined' && TVC_Fleet.upsert) {
            TVC_Fleet.upsert({
                id: profile.vessel_id,
                name: profile.name,
                imo_no: profile.imo_no,
                delivery: profile.delivery,
                code: profile.code,
            });
            TVC_Fleet.select(profile.vessel_id);
        }
        try {
            await TVC_DB.setMeta(TVC_META_KEYS.VESSEL_ID, profile.vessel_id);
        } catch (_) {}

        if (typeof TVC_Sync !== 'undefined' && TVC_Sync.recordSyncHistory) {
            await TVC_Sync.recordSyncHistory({
                type: 'IMPORT',
                direction: DIRECTION,
                department: 'ALL',
                vessel_id: profile.vessel_id,
                filename: opts.filename || '(vessel profile)',
                record_count: 1,
                status: 'SUCCESS',
                space: 'SHIP',
                peer: 'Company',
            });
        }
        return { profile };
    }

    return {
        KIND,
        VERSION,
        DIRECTION,
        FIELDS,
        JSON_NAME,
        companyId,
        normalizeProfile,
        profileFromFleet,
        buildPayload,
        exportZip,
        parseFile,
        isVesselProfileFile,
        resolveShipVesselId,
        validateForShip,
        currentShipProfile,
        diffRows,
        apply,
    };
})();
if (typeof window !== 'undefined') window.TVC_VesselProfileSync = TVC_VesselProfileSync;
