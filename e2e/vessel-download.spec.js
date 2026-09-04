const { test, expect } = require('@playwright/test');

test.describe('Vessel download picker', () => {
  test('opens modal with three vessel modes on web deploy', async ({ page }) => {
    await page.goto('/?web=1', { waitUntil: 'domcontentloaded' });
    await page.locator('#loginDownloadBtn').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('#loginDownloadBtn').click();

    const modal = page.locator('#vesselDownloadModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('h3')).toHaveText('Vessel Mode installer');

    const items = modal.locator('.vessel-download-item');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('Master');
    await expect(items.nth(1)).toContainText('Engine');
    await expect(items.nth(2)).toContainText('Deck');

    await expect(items.nth(0)).toContainText('Ready');
  });

  test('downloads selected installer file', async ({ page }) => {
    await page.goto('/?web=1', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { delete window.showSaveFilePicker; });
    await page.locator('#loginDownloadBtn').click();
    await page.locator('#vesselDownloadModal .vessel-download-item').filter({ hasText: 'Engine' }).click();

    const download = await page.waitForEvent('download', { timeout: 15000 });
    expect(download.suggestedFilename()).toBe('TVC-PMS-VESSEL_ENGINE-1.0.6-Setup.exe');
  });
});
