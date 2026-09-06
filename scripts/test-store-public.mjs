/**
 * Smoke test: Maritime Toolkit public shell (5 tabs, conversion CTA, lead capture)
 * Run: node scripts/test-store-public.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.TVC_BASE_URL || 'http://127.0.0.1:4317';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/toolkit.html`, { waitUntil: 'networkidle' });

    results.push({
      check: 'page title Maritime Toolkit',
      ok: (await page.title()) === 'Maritime Toolkit | THE VESSEL CODE',
    });

    results.push({
      check: 'header title present',
      ok: /MARITIME TOOLKIT/i.test(await page.locator('.store-public-title').textContent() || ''),
    });

    results.push({
      check: 'five utility tab chips',
      ok: await page.locator('[data-tool-tab]').count() === 5,
    });

    results.push({
      check: 'catalog tab active by default',
      ok: await page.locator('[data-tool-tab="catalog"]').evaluate(el => el.classList.contains('active')),
    });

    results.push({
      check: 'global conversion banner visible',
      ok: await page.locator('#toolkitConversionBanner').isVisible(),
    });

    const demoHref = await page.locator('.toolkit-conversion-btn').getAttribute('href');
    results.push({
      check: 'global demo CTA link',
      ok: demoHref === 'https://thevesselcode.com/#contact',
      detail: demoHref,
    });

    results.push({
      check: 'floating upgrade FAB visible',
      ok: await page.locator('#storePublicFab').isVisible(),
    });

    await page.locator('.store-code-link').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('.store-code-link').first().click();
    await page.locator('#impaDetailModal').waitFor({ state: 'visible', timeout: 5_000 });

    results.push({
      check: 'locked ROB preview visible',
      ok: await page.locator('[data-lead-trigger="rob"]').isVisible(),
    });
    results.push({
      check: 'locked requisition preview visible',
      ok: await page.locator('[data-lead-trigger="requisition"]').isVisible(),
    });

    const bannerText = await page.locator('.impa-detail-public-banner-text').textContent();
    results.push({
      check: 'modal conversion banner copy present',
      ok: /Excel/i.test(bannerText || '') && /TVC-PMS/i.test(bannerText || ''),
      detail: (bannerText || '').trim().slice(0, 100),
    });

    await page.keyboard.press('Escape');
    await page.locator('#impaDetailModal').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

    // Bunker tab
    await page.locator('[data-tool-tab="bunker"]').click();
    await page.locator('#bunkerCalcForm').waitFor({ state: 'visible', timeout: 5_000 });
    results.push({
      check: 'bunker calculator visible',
      ok: await page.locator('#bunkerMassValue').isVisible(),
    });
    const bunkerMt = await page.locator('#bunkerMassValue').textContent();
    results.push({
      check: 'bunker MT calculated',
      ok: /MT/.test(bunkerMt || ''),
      detail: bunkerMt,
    });

    // Lub-oil tab
    await page.locator('[data-tool-tab="lube"]').click();
    await page.locator('#lubeTableHost table').waitFor({ state: 'visible', timeout: 5_000 });
    results.push({
      check: 'lube cross-ref table visible',
      ok: await page.locator('#lubeTableHost table').isVisible(),
    });

    // Paint tab
    await page.locator('[data-tool-tab="paint"]').click();
    await page.locator('#paintTableHost table').waitFor({ state: 'visible', timeout: 5_000 });
    results.push({
      check: 'paint cross-ref table visible',
      ok: await page.locator('#paintTableHost table').isVisible(),
    });

    // Engineering tab
    await page.locator('[data-tool-tab="engineering"]').click();
    await page.locator('#flangeTableHost table').waitFor({ state: 'visible', timeout: 5_000 });
    results.push({
      check: 'flange engineering table visible',
      ok: await page.locator('#flangeTableHost table').isVisible(),
    });

    // Mobile viewport tab scroll
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-tool-tab="catalog"]').click();
    const tabNav = page.locator('#storePublicToolkit');
    const scrollable = await tabNav.evaluate(el => el.scrollWidth > el.clientWidth);
    results.push({
      check: 'mobile tab bar horizontally scrollable',
      ok: scrollable,
    });

    await page.locator('.store-code-link').first().waitFor({ state: 'visible', timeout: 15_000 });
    results.push({
      check: 'catalog still works after tab tour',
      ok: await page.locator('.store-search').isVisible(),
    });

    // Lead modal flow
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('[data-lead-trigger="rob"]').first().click({ force: true }).catch(async () => {
      await page.locator('.store-code-link').first().click();
      await page.locator('[data-lead-trigger="rob"]').click();
    });
    await page.locator('#storeLeadModal').waitFor({ state: 'visible', timeout: 5_000 });
    results.push({
      check: 'locked field opens lead modal',
      ok: await page.locator('#storeLeadModal').isVisible(),
    });
    await page.locator('.store-lead-close').click();
    results.push({
      check: 'lead modal closes',
      ok: await page.locator('#storeLeadModal').evaluate(el => el.classList.contains('hidden')),
    });

    await page.locator('#storePublicFab').click();
    await page.locator('#storeLeadModal').waitFor({ state: 'visible', timeout: 5_000 });
    results.push({
      check: 'FAB opens lead modal',
      ok: await page.locator('#storeLeadTitle').isVisible(),
    });

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
