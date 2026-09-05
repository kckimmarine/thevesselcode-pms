const { test, expect } = require('@playwright/test');
const { login, switchTab, dismissAllDialogs, closeTopModal } = require('./helpers/app');

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function ensureHistoryRow(page) {
  await switchTab(page, 'actual', 'engine');
  await page.locator('#actScroll .vl-cells[data-job-id]').first().waitFor({ state: 'visible', timeout: 40_000 });
  await page.locator('#actScroll .vl-cells[data-job-id]').first().click();
  await page.waitForTimeout(250);
  const make = page.locator('#planReportBtn');
  if (!(await make.isEnabled().catch(() => false))) return;
  await make.click();
  const modal = page.locator('#workReportModal:not(.hidden)');
  await modal.waitFor({ state: 'visible', timeout: 12_000 });
  const outline = modal.locator('[data-wf="outline"]');
  if (await outline.isVisible().catch(() => false)) {
    await outline.fill('E2E history detail modal verification');
  }
  const save = modal.locator('button.btn-green', { hasText: 'Save' }).first();
  if (await save.isVisible().catch(() => false)) {
    await save.click();
    await page.waitForTimeout(500);
    await dismissAllDialogs(page, true);
  }
  if (await modal.isVisible().catch(() => false)) await closeTopModal(page);
}

async function openFirstHistoryDetail(page) {
  await switchTab(page, 'history', 'engine');
  await page.waitForTimeout(500);
  let row = page.locator('#historyBody .hist-row').first();
  if (!(await row.isVisible().catch(() => false))) {
    await ensureHistoryRow(page);
    await switchTab(page, 'history', 'engine');
    await page.waitForTimeout(500);
    row = page.locator('#historyBody .hist-row').first();
  }
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  const detailBtn = page.locator('#histBtnDetail');
  await expect(detailBtn).toBeEnabled({ timeout: 5_000 });
  await detailBtn.click();
  const modal = page.locator('#workReportModal:not(.hidden)');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  return modal;
}

test('Report History Detail Report shows maintenance sections (mobile)', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page, 'engine');
  const modal = await openFirstHistoryDetail(page);

  const box = modal.locator('.modal-box.wr-modal');
  const boxSize = await box.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    height: el.getBoundingClientRect().height,
    vw: window.innerWidth,
  }));
  expect(boxSize.width).toBeLessThanOrEqual(boxSize.vw * 0.96);

  const pageEl = modal.locator('#workReportBody .wr-page');
  await expect(pageEl.locator('label:has-text("Job Code")').first()).toBeVisible();
  await expect(pageEl.locator('label:has-text("Outline of Maintenance")').first()).toBeVisible();
  await expect(pageEl.locator('.wr-maint-approval')).toBeVisible();
  await expect(modal.locator('button:has-text("Modify")')).toBeVisible();
  await expect(modal.locator('button:has-text("Close")')).toBeVisible();

  const scrollInfo = await pageEl.evaluate((el) => ({
    overflowY: getComputedStyle(el).overflowY,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(['auto', 'scroll']).toContain(scrollInfo.overflowY);
});

test('Report History Detail Report desktop layout unchanged width band', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await login(page, 'engine');
  const modal = await openFirstHistoryDetail(page);
  const box = modal.locator('.modal-box.wr-modal');
  const width = await box.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(900);
  await expect(modal.locator('#workReportBody .wr-page label:has-text("Outline of Maintenance")').first()).toBeVisible();
});
