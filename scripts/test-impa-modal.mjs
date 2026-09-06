/**
 * Smoke test: IMPA detail modal close controls (desktop + mobile)
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

async function openStoreModal(page) {
  await page.goto(`${BASE}/toolkit.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('.store-code-link').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.store-code-link').first().click();
  await page.locator('#impaDetailModal').waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('#impaDetailZoomBtn').waitFor({ state: 'visible', timeout: 15_000 });
}

async function isModalHidden(page) {
  return page.locator('#impaDetailModal').evaluate(el => el.classList.contains('hidden'));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    const page = await browser.newPage();
    await openStoreModal(page);
    results.push({
      check: 'zoom button visible with plate',
      ok: await page.locator('#impaDetailZoomBtn').isVisible(),
    });
    await page.locator('#impaDetailZoomBtn').click();
    results.push({
      check: 'fullscreen plate opens',
      ok: await page.locator('#impaPlateFullscreen').isVisible(),
    });
    await page.locator('.impa-plate-fullscreen-close').click();
    results.push({
      check: 'fullscreen plate closes',
      ok: await page.locator('#impaPlateFullscreen').evaluate(el => el.classList.contains('hidden')),
    });

    const floatBtn = page.locator('.impa-detail-close-float');
    const floatSize = await floatBtn.boundingBox();
    results.push({
      check: 'floating close button 44x44',
      ok: floatSize && floatSize.width >= 44 && floatSize.height >= 44,
      detail: floatSize,
    });

    await floatBtn.click();
    results.push({ check: 'float close dismisses modal', ok: await isModalHidden(page) });

    await openStoreModal(page);
    await page.locator('.impa-detail-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(200);
    const floatVisibleAfterScroll = await floatBtn.isVisible();
    await floatBtn.click();
    results.push({
      check: 'float close visible after scroll',
      ok: floatVisibleAfterScroll && await isModalHidden(page),
    });

    await openStoreModal(page);
    const box = await page.locator('.impa-detail-box').boundingBox();
    const modal = await page.locator('#impaDetailModal').boundingBox();
    if (box && modal) {
      await page.mouse.click(modal.x + 8, modal.y + 8);
      results.push({ check: 'backdrop tap closes modal', ok: await isModalHidden(page) });
    } else {
      results.push({ check: 'backdrop tap closes modal', ok: false, detail: 'no bounds' });
    }

    await openStoreModal(page);
    await page.locator('.impa-detail-close-bottom').click();
    results.push({ check: 'bottom close button', ok: await isModalHidden(page) });

    const mobile = await browser.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await openStoreModal(mobile);
    const mobileFloat = mobile.locator('.impa-detail-close-float');
    results.push({
      check: 'mobile floating close visible',
      ok: await mobileFloat.isVisible(),
    });
    await mobileFloat.click();
    results.push({ check: 'mobile float close', ok: await isModalHidden(mobile) });

    await openStoreModal(mobile);
    await mobile.locator('.impa-detail-scroll').evaluate(el => { el.scrollTop = 400; });
    await mobile.locator('.impa-detail-close-bottom').click();
    results.push({ check: 'mobile bottom close after scroll', ok: await isModalHidden(mobile) });

    await openStoreModal(mobile);
    const mbox = await mobile.locator('#impaDetailModal').boundingBox();
    if (mbox) {
      await mobile.mouse.click(mbox.x + mbox.width / 2, mbox.y + 12);
      results.push({ check: 'mobile backdrop tap', ok: await isModalHidden(mobile) });
    }

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
