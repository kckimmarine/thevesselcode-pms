/* THE VESSEL CODE — Pilot SKU definitions (shared by main / issue scripts) */
'use strict';

const COMPANY_ID = 'DAEMYUNG';
const PILOT_VESSEL_ID = 'INCHEON CHEMI';
/** HQ가 Import/선택 가능한 선박 목록 */
const HQ_ALLOWED_VESSEL_IDS = [
    'INCHEON CHEMI',
    'QUARTERBACK J',
    'GOLDSTAR SHINE',
    'VALIANT',
];

const SKUS = {
    VESSEL_MASTER: {
        sku: 'VESSEL_MASTER',
        label: 'INCHEON CHEMI — Master',
        companyId: COMPANY_ID,
        vesselId: PILOT_VESSEL_ID,
        loginModes: ['MASTER'],
        allowHq: false,
        productName: 'TVC-PMS INCHEON CHEMI Master',
        // Unique appId/exe so all 4 SKUs can coexist on one PC
        appId: 'com.thevesselcode.tvc-pms.vessel-master',
        executableName: 'TVC-PMS-INCHEON-CHEMI-Master',
    },
    VESSEL_ENGINE: {
        sku: 'VESSEL_ENGINE',
        label: 'INCHEON CHEMI — Engine',
        companyId: COMPANY_ID,
        vesselId: PILOT_VESSEL_ID,
        loginModes: ['ENGINE'],
        allowHq: false,
        productName: 'TVC-PMS INCHEON CHEMI Engine',
        appId: 'com.thevesselcode.tvc-pms.vessel-engine',
        executableName: 'TVC-PMS-INCHEON-CHEMI-Engine',
    },
    VESSEL_DECK: {
        sku: 'VESSEL_DECK',
        label: 'INCHEON CHEMI — Deck',
        companyId: COMPANY_ID,
        vesselId: PILOT_VESSEL_ID,
        loginModes: ['DECK'],
        allowHq: false,
        productName: 'TVC-PMS INCHEON CHEMI Deck',
        appId: 'com.thevesselcode.tvc-pms.vessel-deck',
        executableName: 'TVC-PMS-INCHEON-CHEMI-Deck',
    },
    HQ_OFFICE: {
        sku: 'HQ_OFFICE',
        label: 'Daemyung HQ Office',
        companyId: COMPANY_ID,
        vesselId: null,
        allowedVesselIds: HQ_ALLOWED_VESSEL_IDS.slice(),
        loginModes: [],
        allowHq: true,
        productName: 'TVC-PMS Daemyung HQ',
        appId: 'com.thevesselcode.tvc-pms.hq-office',
        executableName: 'TVC-PMS-Daemyung-HQ',
    },
    /** THE VESSEL CODE — product improvement / app-update packaging only (no ship ops data) */
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

function getSku(sku) {
    return SKUS[String(sku || '').toUpperCase()] || null;
}

module.exports = { COMPANY_ID, PILOT_VESSEL_ID, HQ_ALLOWED_VESSEL_IDS, SKUS, getSku };
