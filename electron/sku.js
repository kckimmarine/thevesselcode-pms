/* THE VESSEL CODE — Pilot SKU definitions (shared by main / issue scripts) */
'use strict';

/** @deprecated Legacy pilot constants — seat license is source of truth for universal SKUs */
const COMPANY_ID = 'TVC';
const PILOT_VESSEL_ID = 'TVC No1';
const HQ_ALLOWED_VESSEL_IDS = [
    'TVC No1',
];

const SKUS = {
    VESSEL_MASTER: {
        sku: 'VESSEL_MASTER',
        label: 'TVC-PMS — Master Hub',
        companyId: null,
        vesselId: null,
        universal: true,
        loginModes: ['MASTER'],
        allowHq: false,
        productName: 'TVC-PMS Vessel Master',
        appId: 'com.thevesselcode.tvc-pms.vessel-master',
        executableName: 'TVC-PMS-Vessel-Master',
    },
    VESSEL_ENGINE: {
        sku: 'VESSEL_ENGINE',
        label: 'TVC-PMS — Engine',
        companyId: null,
        vesselId: null,
        universal: true,
        loginModes: ['ENGINE'],
        allowHq: false,
        productName: 'TVC-PMS Vessel Engine',
        appId: 'com.thevesselcode.tvc-pms.vessel-engine',
        executableName: 'TVC-PMS-Vessel-Engine',
    },
    VESSEL_DECK: {
        sku: 'VESSEL_DECK',
        label: 'TVC-PMS — Deck',
        companyId: null,
        vesselId: null,
        universal: true,
        loginModes: ['DECK'],
        allowHq: false,
        productName: 'TVC-PMS Vessel Deck',
        appId: 'com.thevesselcode.tvc-pms.vessel-deck',
        executableName: 'TVC-PMS-Vessel-Deck',
    },
    HQ_OFFICE: {
        sku: 'HQ_OFFICE',
        label: 'TVC-PMS — HQ Office',
        companyId: null,
        vesselId: null,
        allowedVesselIds: null,
        universal: true,
        loginModes: [],
        allowHq: true,
        productName: 'TVC-PMS HQ Office',
        appId: 'com.thevesselcode.tvc-pms.hq-office',
        executableName: 'TVC-PMS-HQ-Office',
    },
    ADMIN_TVC: {
        sku: 'ADMIN_TVC',
        label: 'TVC Admin Mode',
        companyId: 'THEVESSELCODE',
        vesselId: null,
        allowedVesselIds: [],
        loginModes: [],
        allowHq: false,
        allowAdmin: true,
        productName: 'TVC-PMS Admin',
        appId: 'com.thevesselcode.tvc-pms.admin',
        executableName: 'TVC-PMS-Admin',
    },
};

function isUniversalSku(def) {
    return !!(def && def.universal);
}

function getSku(sku) {
    return SKUS[String(sku || '').toUpperCase()] || null;
}

module.exports = {
    COMPANY_ID,
    PILOT_VESSEL_ID,
    HQ_ALLOWED_VESSEL_IDS,
    SKUS,
    getSku,
    isUniversalSku,
};
