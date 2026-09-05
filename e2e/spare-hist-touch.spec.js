const { test, expect } = require('@playwright/test');
const { login, switchTab } = require('./helpers/app');

const MOBILE = { width: 390, height: 844 };

async function ensureSpareHistRow(page) {
  await page.evaluate(async () => {
    const vesselId = (await TVC_DB.getMeta(TVC_META_KEYS.VESSEL_ID)) || 'SHIP';
    const existing = await TVC_Inventory.listRequisitions(vesselId);
    if (existing.length) return;
    const user = TVC_Auth.getCurrentUser();
    await TVC_Inventory.saveRequisition({
      id: `e2e-req-${Date.now()}`,
      req_no: 'E2E-HIST-001',
      vessel_id: vesselId,
      department: user?.department || 'ENGINE',
      status: 'DRAFT',
      list_status: 'REPORTED',
      created_at: new Date().toISOString(),
      report_date: new Date().toISOString().slice(0, 10),
      lines: [],
      deliver_port: 'Test Port',
    });
  });
}

test('Spare Report History: double-tap opens requisition detail modal (mobile)', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page, 'engine');
  await ensureSpareHistRow(page);

  await switchTab(page, 'history', 'engine');
  const spareScope = page.locator('.hist-scope-tab[data-hist-scope="spare"]');
  if (await spareScope.isVisible().catch(() => false)) {
    await spareScope.click();
    await page.waitForTimeout(400);
  }

  const row = page.locator('#spareHistReqListScroll tr.spare-req-list-row[data-req-id]').first();
  await expect(row).toBeVisible({ timeout: 25_000 });

  const touchBound = await page.evaluate(() => !!document.getElementById('spareHistReqListHost')?._spareHistTouchBound);
  expect(touchBound).toBeTruthy();

  const reqId = await row.getAttribute('data-req-id');
  expect(reqId).toBeTruthy();
  await page.evaluate((id) => {
    const host = document.getElementById('spareHistReqListHost');
    const tr = host?.querySelector(`tr.spare-req-list-row[data-req-id="${id}"]`);
    if (!host || !tr) throw new Error('row missing');
    const fire = () => tr.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
    fire();
    fire();
  }, reqId);

  const modal = page.locator('#spareReqWorkModal:not(.hidden)');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await expect(modal.locator('.spare-req-work-meta label:has-text("Requisition No.")').first()).toBeVisible();
  await expect(modal.locator('.spare-req-draft-actions button:has-text("Close")').first()).toBeVisible();

  const modalBox = modal.locator('.modal-box.spare-req-work-modal');
  const modalWidth = await modalBox.evaluate((el) => el.getBoundingClientRect().width);
  const vw = await page.evaluate(() => window.innerWidth);
  expect(modalWidth).toBeLessThanOrEqual(vw * 0.99);
});
