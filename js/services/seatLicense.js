/* THE VESSEL CODE — Admin seat license issue (machine request → license.json) */
const TVC_SeatLicense = (function () {
    const REQUEST_KIND = 'TVC_MACHINE_REQUEST';

    function isAdminUser(user) {
        return !!(user && typeof TVC_RBAC !== 'undefined' && TVC_RBAC.isAdminAccount?.(user));
    }

    function parseMachineRequest(raw) {
        const req = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!req || req.kind !== REQUEST_KIND || !req.machineId) {
            throw new Error('Invalid machine request file (expected TVC_MACHINE_REQUEST with machineId).');
        }
        return req;
    }

    async function getSigningStatus() {
        if (!window.tvcElectron?.getLicenseSigningStatus) {
            return { configured: false, message: 'Seat license issue is available in Electron Admin Mode only.' };
        }
        return window.tvcElectron.getLicenseSigningStatus();
    }

    async function pickSigningKey() {
        if (!window.tvcElectron?.pickLicensePrivateKey) {
            throw new Error('Select signing key is available in Electron Admin Mode only.');
        }
        return window.tvcElectron.pickLicensePrivateKey();
    }

    async function issueFromRequest(request, opts = {}) {
        if (!window.tvcElectron?.issueSeatLicense) {
            throw new Error('Seat license issue is available in Electron Admin Mode only.');
        }
        const result = await window.tvcElectron.issueSeatLicense({
            request,
            months: Number(opts.months) || 3,
            sku: opts.sku || request?.sku || null,
            companyId: opts.companyId || null,
            vesselId: opts.vesselId || null,
            allowedVesselIds: opts.allowedVesselIds || null,
        });
        if (!result?.ok) throw new Error(result?.error || 'License issue failed.');
        return result;
    }

    async function saveLicense(license, suggestedFilename) {
        if (!window.tvcElectron?.exportSeatLicense) {
            throw new Error('Save license is available in Electron Admin Mode only.');
        }
        const result = await window.tvcElectron.exportSeatLicense({ license, suggestedFilename });
        if (result?.canceled) return { ok: false, canceled: true };
        if (!result?.ok) throw new Error(result?.error || 'Save failed.');
        return result;
    }

    function previewRows(req) {
        return [
            ['SKU', req.skuLabel || req.sku || '—'],
            ['App version', req.appVersion || '—'],
            ['Company', req.companyId || '—'],
            ['Vessel', req.vesselId || '(HQ)'],
            ['Machine ID', req.machineId || '—'],
            ['Host', req.hostname || '—'],
            ['User', req.username || '—'],
            ['Requested', req.requestedAt ? String(req.requestedAt).slice(0, 19).replace('T', ' ') : '—'],
        ];
    }

    return {
        isAdminUser,
        parseMachineRequest,
        getSigningStatus,
        pickSigningKey,
        issueFromRequest,
        saveLicense,
        previewRows,
    };
})();
