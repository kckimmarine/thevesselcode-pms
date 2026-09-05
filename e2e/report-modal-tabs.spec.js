const { test, expect } = require('@playwright/test');
const { login, switchTab, waitForJobs, dismissAllDialogs, closeTopModal } = require('./helpers/app');

const MOBILE = { width: 390, height: 844 };

test('Report modal: date pair row and kind tab panes', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page, 'engine');
  await switchTab(page, 'actual', 'Engine / engineer');
  await waitForJobs(page, 40_000);

  const job = page.locator('#actScroll .vl-cells[data-job-id]').first();
  await expect(job).toBeVisible({ timeout: 15_000 });
  await job.click();

  const make = page.locator('#planReportBtn');
  await expect(make).toBeEnabled({ timeout: 10_000 });
  await make.click();
  await page.locator('#workReportModal:not(.hidden)').waitFor({ state: 'visible', timeout: 10_000 });

  const datePair = page.locator('#form-maintenance .wr-maint-date-pair-row');
  await expect(datePair).toBeVisible();
  const pairBox = await datePair.boundingBox();
  expect(pairBox?.width).toBeGreaterThan(300);

  const fields = datePair.locator('.wr-maint-field');
  await expect(fields).toHaveCount(2);
  const f1 = await fields.nth(0).boundingBox();
  const f2 = await fields.nth(1).boundingBox();
  expect(f1 && f2).toBeTruthy();
  expect(Math.abs((f1.y || 0) - (f2.y || 0))).toBeLessThan(8);

  await page.screenshot({ path: '/opt/cursor/artifacts/report-maintenance-date-pair.png', fullPage: false });

  const panes = page.locator('#workReportBody .wr-make-report-panes');
  await expect(panes).toBeVisible();
  await expect(page.locator('#workReportBody .wr-pane-repair.active')).toBeVisible();
  await expect(page.locator('#workReportBody .wr-pane-postpone')).toBeHidden();

  await page.locator('.wr-kind-tab', { hasText: 'Postpone' }).click();
  await page.waitForTimeout(200);
  await expect(page.locator('#workReportBody .wr-pane-postpone.active')).toBeVisible();
  await expect(page.locator('#workReportBody .wr-pane-repair')).toBeHidden();
  await expect(page.locator('#workReportBody .wr-make-report-shell')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/report-postpone-tab-pane.png', fullPage: false });

  await page.locator('.wr-kind-tab', { hasText: 'Maintenance' }).click();
  await page.waitForTimeout(200);
  await expect(page.locator('#workReportBody .wr-pane-repair.active')).toBeVisible();

  page.once('dialog', d => d.accept());
  await page.locator('.wr-kind-tab', { hasText: 'Work Permit' }).click();
  await page.waitForTimeout(400);
  await page.locator('#workPermitModal:not(.hidden)').waitFor({ state: 'visible', timeout: 10_000 });

  const wpDatePair = page.locator('#form-work-permit .wr-maint-date-pair-row');
  await expect(wpDatePair).toBeVisible();
  const wpF1 = await wpDatePair.locator('.wr-maint-field').nth(0).boundingBox();
  const wpF2 = await wpDatePair.locator('.wr-maint-field').nth(1).boundingBox();
  expect(Math.abs((wpF1?.y || 0) - (wpF2?.y || 0))).toBeLessThan(8);
  await page.screenshot({ path: '/opt/cursor/artifacts/report-wp-date-pair.png', fullPage: false });

  page.once('dialog', d => d.accept());
  await page.locator('#workPermitModal .wr-kind-tab', { hasText: 'Defect' }).click();
  await page.waitForTimeout(400);
  await page.locator('#defectReportModal:not(.hidden)').waitFor({ state: 'visible', timeout: 10_000 });

  const dfDatePair = page.locator('#form-defect .wr-maint-date-pair-row');
  await expect(dfDatePair).toBeVisible();
  const dfF1 = await dfDatePair.locator('.wr-maint-field').nth(0).boundingBox();
  const dfF2 = await dfDatePair.locator('.wr-maint-field').nth(1).boundingBox();
  expect(Math.abs((dfF1?.y || 0) - (dfF2?.y || 0))).toBeLessThan(8);
  await page.screenshot({ path: '/opt/cursor/artifacts/report-defect-date-pair.png', fullPage: false });

  await closeTopModal(page);
  await dismissAllDialogs(page, true);
});
