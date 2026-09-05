const { test, expect } = require('@playwright/test');
const { attachErrorHooks, login, switchTab, waitForJobs } = require('./helpers/app');

test('Period datepicker opens on Work Plan and Report History', async ({ page }) => {
  attachErrorHooks(page, 'Engine / engineer');
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, 'engine');

  await switchTab(page, 'actual', 'Engine / engineer');
  await waitForJobs(page, 40_000);

  const actFrom = page.locator('#actPeriodFrom');
  await expect(actFrom).toBeVisible();
  await expect(actFrom).toHaveAttribute('data-tvc-date-fmt', '1');
  await expect(page.locator('#actPeriodFilter .tvc-date-picker-btn').first()).toBeVisible();

  await page.locator('#actPeriodFilter .tvc-date-picker-btn').first().click();
  await actFrom.fill('2026-01-15');
  await actFrom.dispatchEvent('change');
  await expect(actFrom).toHaveValue('2026-01-15');

  await switchTab(page, 'history', 'Engine / engineer');
  await page.waitForTimeout(400);

  const histFrom = page.locator('#histPeriodFrom');
  await expect(histFrom).toBeVisible();
  await expect(histFrom).toHaveAttribute('data-tvc-date-fmt', '1');

  await page.locator('#histPeriodFilter .tvc-date-picker-btn').first().click();
  await histFrom.fill('2026-02-01');
  await histFrom.dispatchEvent('change');
  await expect(histFrom).toHaveValue('2026-02-01');
});

test('Period datepicker tap targets on mobile viewport', async ({ page }) => {
  attachErrorHooks(page, 'Engine / engineer @390');
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'engine');

  await switchTab(page, 'actual', 'Engine / engineer @390');
  await waitForJobs(page, 40_000);

  const btn = page.locator('#actPeriodFilter .tvc-date-picker-btn').first();
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThanOrEqual(26);
  expect(box.height).toBeGreaterThanOrEqual(26);

  await btn.click({ force: false });
  const input = page.locator('#actPeriodFrom');
  await input.fill('2026-03-10');
  await input.dispatchEvent('change');
  await expect(input).toHaveValue('2026-03-10');
});
