const path = require('path');
const fs = require('fs');
const { initSchema, closeDb, getDb } = require('../src/db/connection');
const { User, hashPassword } = require('../src/models/User');
const { RBAC, Action, Role } = require('../src/auth/rbac');
const { WorkflowService } = require('../src/services/WorkflowService');
const { DailyWorkReport } = require('../src/models/DailyWorkReport');
const { SparePart } = require('../src/models/SparePart');

const VESSEL = 'TEST_V01';
const PASSWORD = 'tvc1234';

function seedUsers() {
    const db = getDb();
    const existing = db.prepare('SELECT COUNT(*) AS c FROM Users').get();
    if (existing.c > 0) return;

    User.create({ username: 'officer@dm01', password: PASSWORD, displayName: 'Kim 3/O (사관)', accountType: 'SHIP', role: 'SHIP_OFFICER', vesselId: VESSEL });
    User.create({ username: 'chief@dm01', password: PASSWORD, displayName: 'Park C/E (선기장)', accountType: 'SHIP', role: 'SHIP_CHIEF', vesselId: VESSEL });
    User.create({ username: 'hq@thevessel', password: PASSWORD, displayName: 'Lee Superintendent', accountType: 'HQ', role: 'HQ_SUPERVISOR', vesselId: null });
}

function runSeedSql() {
    const seedPath = path.join(__dirname, '..', 'database', 'seed_sample.sql');
    if (fs.existsSync(seedPath)) {
        getDb().exec(fs.readFileSync(seedPath, 'utf8'));
    }
}

function demo() {
    console.log('=== TVC-PMS RBAC & Workflow Demo ===\n');

    const officer = User.authenticate('officer@dm01', PASSWORD);
    const chief = User.authenticate('chief@dm01', PASSWORD);
    const hq = User.authenticate('hq@thevessel', PASSWORD);

    console.log('1. UI features by account');
    console.log('   Officer:', RBAC.getUiFeatures(officer));
    console.log('   Chief:  ', RBAC.getUiFeatures(chief));
    console.log('   HQ:     ', RBAC.getUiFeatures(hq));

    console.log('\n2. Permission checks');
    console.log('   Officer can CREATE_DAILY_REPORT:', RBAC.can(officer, Action.CREATE_DAILY_REPORT));
    console.log('   Officer can APPROVE_DAILY_REPORT:', RBAC.can(officer, Action.APPROVE_DAILY_REPORT));
    console.log('   Chief can APPROVE_DAILY_REPORT: ', RBAC.can(chief, Action.APPROVE_DAILY_REPORT));
    console.log('   HQ can CONFIRM_REPORT:           ', RBAC.can(hq, Action.CONFIRM_REPORT));

    console.log('\n3. Workflow: Officer creates report → Chief approves (inventory deduct) → HQ confirms (lock)');

    const beforeQty = SparePart.findById('sp-01').qty_on_hand;
    const report = WorkflowService.createDailyReport(officer, {
        maintenanceJobId: 'job-01',
        jobCode: '01-004',
        workType: 'MAINTENANCE',
        description: 'Exhaust valve overhaul completed',
        usedParts: [{ sparePartId: 'sp-01', qtyUsed: 1 }],
    });
    console.log('   Created report:', report.id, 'status:', report.status);

    const approved = WorkflowService.approveReport(chief, report.id);
    const afterQty = SparePart.findById('sp-01').qty_on_hand;
    console.log('   Chief approved:', approved.status, '| SP-01 stock:', beforeQty, '→', afterQty);

    try {
        WorkflowService.approveReport(officer, report.id);
    } catch (e) {
        console.log('   Officer approve blocked:', e.code);
    }

    const confirmed = WorkflowService.confirmReport(hq, report.id, 'Well done. Next survey item noted.');
    console.log('   HQ confirmed:', confirmed.status, 'locked:', confirmed.is_locked);

    console.log('\n4. Export ship → HQ');
    const exportPayload = WorkflowService.exportShipToHq(VESSEL);
    console.log('   export_meta:', exportPayload.export_meta);
    console.log('   daily_reports count:', exportPayload.daily_reports.length);

    console.log('\n=== Demo complete ===');
}

initSchema();
runSeedSql();
seedUsers();
demo();
closeDb();
