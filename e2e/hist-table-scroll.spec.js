const { test, expect } = require('@playwright/test');
const { login, switchTab } = require('./helpers/app');

const MOBILE = { width: 390, height: 844 };

async function assertHistTableScrollSync(page, scrollSelector) {
  const aligned = await page.evaluate((sel) => {
    const scroll = document.querySelector(sel);
    const table = scroll?.querySelector('.report-history-table');
    const th = table?.querySelector('thead th');
    const td = table?.querySelector('tbody tr td');
    if (!scroll || !table || !th || !td) return { ok: false, reason: 'missing nodes' };
    scroll.scrollLeft = 120;
    const thRect = th.getBoundingClientRect();
    const tdRect = td.getBoundingClientRect();
    const delta = Math.abs(thRect.left - tdRect.left);
    return {
      ok: delta < 2,
      scrollLeft: scroll.scrollLeft,
      delta,
      thLeft: thRect.left,
      tdLeft: tdRect.left,
    };
  }, scrollSelector);
  expect(aligned.ok, JSON.stringify(aligned)).toBeTruthy();
}

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

test('PMS Report History: header scrolls in lockstep with rows (mobile)', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page, 'engine');
  await switchTab(page, 'history', 'engine');

  const pmsScope = page.locator('.hist-scope-tab[data-hist-scope="pms"]');
  if (await pmsScope.isVisible().catch(() => false)) {
    await pmsScope.click();
    await page.waitForTimeout(300);
  }

  await expect(page.locator('#histPmsListScroll .report-history-table tbody tr').first()).toBeVisible({ timeout: 25_000 });
  await assertHistTableScrollSync(page, '#histPmsListScroll');
});

test('SPARE Report History: header scrolls in lockstep with rows (mobile)', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page, 'engine');
  await ensureSpareHistRow(page);
  await switchTab(page, 'history', 'engine');

  const spareScope = page.locator('.hist-scope-tab[data-hist-scope="spare"]');
  if (await spareScope.isVisible().catch(() => false)) {
    await spareScope.click();
    await page.waitForTimeout(400);
  }

  await expect(page.locator('#spareHistReqListScroll .report-history-table tbody tr').first()).toBeVisible({ timeout: 25_000 });
  await assertHistTableScrollSync(page, '#spareHistReqListScroll');
});
