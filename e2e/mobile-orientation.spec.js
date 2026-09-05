const { test, expect } = require('@playwright/test');
const { attachErrorHooks, login, switchTab, waitForJobs } = require('./helpers/app');

const LANDSCAPE_PHONE = { width: 844, height: 390 };

test('Landscape phone: mobile nav and compact PMS tree apply', async ({ page }) => {
  attachErrorHooks(page, 'Engine / engineer @844x390');
  await page.setViewportSize(LANDSCAPE_PHONE);
  await login(page, 'engine');

  await expect(page.locator('.mobile-nav-btn')).toBeVisible();

  await switchTab(page, 'actual', 'Engine / engineer @844x390');
  await waitForJobs(page, 40_000);

  const treeScroll = page.locator('#tab-actual #actTree');
  await expect(treeScroll).toBeVisible();

  const maxHeight = await treeScroll.evaluate((el) => getComputedStyle(el).maxHeight);
  expect(maxHeight).not.toBe('none');
  const maxHeightPx = parseFloat(maxHeight);
  expect(maxHeightPx).toBeGreaterThan(0);
  expect(maxHeightPx).toBeLessThanOrEqual(200);

  const periodBtn = page.locator('#actPeriodFilter .tvc-date-picker-btn').first();
  await expect(periodBtn).toBeVisible();
  const btnBox = await periodBtn.boundingBox();
  expect(btnBox?.height).toBeGreaterThanOrEqual(32);
});
