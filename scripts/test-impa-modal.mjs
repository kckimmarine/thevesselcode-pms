/**
 * Smoke test: IMPA detail modal close controls (desktop + mobile)
 * Run: node scripts/test-impa-modal.mjs
 */
import { chromium } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FULL_SRC = join(ROOT, 'public/data/impa-full.json');
const FULL_DEST = join(ROOT, 'data/impa-full.json');
if (existsSync(FULL_SRC)) {
  mkdirSync(dirname(FULL_DEST), { recursive: true });
  copyFileSync(FULL_SRC, FULL_DEST);
}

const BASE = process.env.TVC_BASE_URL || 'http://127.0.0.1:4317';

async function openStoreModal(page) {
  await page.goto(`${BASE}/toolkit.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('.store-code-link').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.store-code-link').first().click();
  await page.locator('#impaDetailModal').waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('#impaDetailShipservLayout').waitFor({ state: 'visible', timeout: 5_000 });
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
      check: 'shipserv layout visible',
      ok: await page.locator('#impaDetailShipservLayout').isVisible(),
    });

    const closeBtn = page.locator('#modalCloseBtn');
    const closeSize = await closeBtn.boundingBox();
    results.push({
      check: 'header close button 36x36 minimum',
      ok: closeSize && closeSize.width >= 36 && closeSize.height >= 36,
      detail: closeSize,
    });

    await closeBtn.click();
    results.push({ check: 'header close dismisses modal', ok: await isModalHidden(page) });

    await openStoreModal(page);
    await page.locator('.impa-detail-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(200);
    const closeVisibleAfterScroll = await closeBtn.isVisible();
    await closeBtn.click();
    results.push({
      check: 'close visible after body scroll',
      ok: closeVisibleAfterScroll && await isModalHidden(page),
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
    await page.keyboard.press('Escape');
    results.push({ check: 'escape closes modal', ok: await isModalHidden(page) });

    const mobile = await browser.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await openStoreModal(mobile);
    const mobileClose = mobile.locator('#modalCloseBtn');
    results.push({
      check: 'mobile header close visible',
      ok: await mobileClose.isVisible(),
    });
    await mobileClose.click();
    results.push({ check: 'mobile header close', ok: await isModalHidden(mobile) });

    await openStoreModal(mobile);
    await mobile.locator('.impa-detail-scroll').evaluate(el => { el.scrollTop = 400; });
    await mobileClose.click();
    results.push({ check: 'mobile close after scroll', ok: await isModalHidden(mobile) });

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
