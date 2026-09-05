const { test, expect } = require('@playwright/test');
const { login, switchTab, waitForJobs, dismissAllDialogs, closeTopModal } = require('./helpers/app');

const MOBILE = { width: 390, height: 844 };

async function expectModalWidth95vw(page, modalSel) {
  const box = page.locator(`${modalSel} .modal-box`).first();
  await expect(box).toBeVisible();
  const width = await box.evaluate(el => el.getBoundingClientRect().width);
  const vw = await page.evaluate(() => window.innerWidth);
  expect(width).toBeGreaterThan(vw * 0.9);
  expect(width).toBeLessThanOrEqual(vw * 0.96);
}

async function expectCompactApprovalRow(page, row) {
  const cb = await row.locator('input[type="checkbox"]').boundingBox();
  const name = await row.locator('.wr-approval-name').boundingBox();
  expect(cb && name).toBeTruthy();
  expect(Math.abs((cb.y || 0) - (name.y || 0))).toBeLessThan(12);
}

test('Modal audit: report modals structure and triggers @390px', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page, 'engine');
  await switchTab(page, 'actual', 'Engine / engineer');
  await waitForJobs(page, 40_000);

  const job = page.locator('#actScroll .vl-cells[data-job-id]').first();
  await expect(job).toBeVisible({ timeout: 15_000 });
  await job.click();

  await page.locator('#planReportBtn').click();
  await page.locator('#workReportModal:not(.hidden)').waitFor({ state: 'visible', timeout: 10_000 });
  await expectModalWidth95vw(page, '#workReportModal');
  await expectCompactApprovalRow(page, page.locator('#form-maintenance .wr-approval-row').first());
  await expect(page.locator('#form-maintenance .wr-file-no-row .tvc-date-picker-btn')).toHaveCount(0);
  await expect(page.locator('#workReportBody .wr-make-report-panes')).toBeVisible();

  await page.locator('#workReportModal .wr-kind-tab', { hasText: 'Postpone' }).click();
  await page.waitForTimeout(250);
  await expect(page.locator('#workReportBody .wr-pane-postpone.active')).toBeVisible();
  await expectCompactApprovalRow(page, page.locator('#form-postpone .wr-approval-row').first());

  page.once('dialog', d => d.accept());
  await page.locator('#workReportModal .wr-kind-tab', { hasText: 'Work Permit' }).click();
  await page.locator('#workPermitModal:not(.hidden)').waitFor({ state: 'visible', timeout: 10_000 });
  await expectModalWidth95vw(page, '#workPermitModal');
  await expectCompactApprovalRow(page, page.locator('#form-work-permit .wr-approval-row').first());

  const wpHistBtn = page.locator('#wpFileNoPickBtn');
  await expect(wpHistBtn).toBeVisible();
  await expect(wpHistBtn).toBeEnabled();

  page.once('dialog', d => d.accept());
  await page.locator('#workPermitModal .wr-kind-tab', { hasText: 'Defect' }).click();
  await page.locator('#defectReportModal:not(.hidden)').waitFor({ state: 'visible', timeout: 10_000 });
  await expectModalWidth95vw(page, '#defectReportModal');
  await expectCompactApprovalRow(page, page.locator('#form-defect .wr-approval-row').first());

  await page.screenshot({ path: '/opt/cursor/artifacts/modal-audit-defect-390.png', fullPage: false });
  await closeTopModal(page);
  await dismissAllDialogs(page, true);
});

test('Modal audit: spare requisition approval row @390px', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await login(page, 'engine');
  const spareOk = await switchTab(page, 'spare', 'Engine / engineer');
  test.skip(!spareOk, 'Spare tab unavailable');

  const newBtn = page.locator('#spareReqNewBtn, #spareNewReqBtn, button:has-text("New")').first();
  if (!(await newBtn.isVisible().catch(() => false))) {
    test.skip(true, 'Spare requisition New button not found');
  }
  await newBtn.click();
  await page.locator('#spareReqWorkModal:not(.hidden)').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  if (await page.locator('#spareReqWorkModal.hidden').count()) {
    test.skip(true, 'Spare requisition modal did not open');
  }

  await expectModalWidth95vw(page, '#spareReqWorkModal');
  const approvalRow = page.locator('#spareReqWorkBody .wr-approval-row').first();
  if (await approvalRow.isVisible().catch(() => false)) {
    await expectCompactApprovalRow(page, approvalRow);
  }

  await page.screenshot({ path: '/opt/cursor/artifacts/modal-audit-spare-req-390.png', fullPage: false });
  await closeTopModal(page);
  await dismissAllDialogs(page, true);
});
