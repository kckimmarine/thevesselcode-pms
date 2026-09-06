/**
 * Smoke test: IMPA detail modal on STORE tab
 * Run: node scripts/test-impa-modal.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.TVC_BASE_URL || 'http://127.0.0.1:4317';

async function waitLoginReady(page) {
  const btn = page.locator('#loginScreen .login-submit');
  for (let i = 0; i < 60; i++) {
    const disabled = await btn.isDisabled().catch(() => true);
    const label = ((await btn.textContent().catch(() => '')) || '').trim();
    if (!disabled && !/Preparing|Signing/i.test(label)) return;
    await page.waitForTimeout(500);
  }
  throw new Error('Login UI not ready');
}

async function login(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await waitLoginReady(page);
  if (await page.locator('#appShell').isVisible().catch(() => false)) return;
  await page.locator('#loginUser').fill('captain');
  await page.locator('#loginPass').fill('0000');
  await page.locator('#loginDept').selectOption('MASTER');
  await page.locator('#loginScreen .login-submit').click();
  await page.locator('#appShell').waitFor({ state: 'visible', timeout: 30_000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  try {
    await login(page);
    await page.evaluate(() => window.TVC_App?.switchTab?.('store'));
    await page.locator('#tab-store').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.store-code-link').first().waitFor({ state: 'visible', timeout: 15_000 });

    const linkVisible = await page.locator('.store-code-link').count();
    results.push({ check: 'clickable IMPA code links', ok: linkVisible > 0, detail: { count: linkVisible } });

    await page.locator('.store-code-link').first().click();
    await page.locator('#impaDetailModal').waitFor({ state: 'visible', timeout: 5_000 });

    const modalVisible = await page.locator('#impaDetailModal').isVisible();
    const badge = await page.locator('#impaDetailBadge').textContent();
    const plateImg = await page.locator('#impaDetailPlateImg').isVisible().catch(() => false);
    const specs = await page.locator('#impaDetailSpecBody tr').count();
    results.push({
      check: 'modal opens with badge and specs',
      ok: modalVisible && badge?.trim() && specs >= 3,
      detail: { badge: badge?.trim(), specs },
    });
    results.push({ check: 'catalog plate image or fallback', ok: plateImg || await page.locator('#impaDetailPlateFallback').isVisible() });

    await page.locator('#impaDetailQty').fill('2');
    await page.locator('#impaDetailCartBtn').click();
    const cartMsg = await page.locator('#impaDetailCartMsg').textContent();
    const cartCount = await page.evaluate(() => window.TVC_StoreManager?.getCartCount?.() ?? 0);
    results.push({
      check: 'add to requisition cart',
      ok: /Added/i.test(cartMsg || '') && cartCount >= 2,
      detail: { cartMsg, cartCount },
    });

    await page.locator('.impa-detail-close').click();
    const hidden = await page.locator('#impaDetailModal').evaluate(el => el.classList.contains('hidden'));
    results.push({ check: 'modal closes', ok: hidden });

    const failed = results.filter(r => !r.ok);
    console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 2));
    if (failed.length) process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
