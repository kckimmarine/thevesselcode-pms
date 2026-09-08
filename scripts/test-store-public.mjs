/**
 * Smoke test: Maritime Toolkit public shell (5 tabs, lead capture)
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
      check: 'global conversion banner removed',
      ok: await page.locator('#toolkitConversionBanner').count() === 0,
    });

    results.push({
      check: 'floating upgrade FAB removed',
      ok: await page.locator('#storePublicFab').count() === 0,
    });

    results.push({
      check: 'footer copyright visible',
      ok: /THE VESSEL CODE/i.test(await page.locator('.store-public-footer').textContent() || ''),
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

    // Mobile IMPA detail modal — centered overlay + scrollable body + close btn
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-tool-tab="catalog"]').click();
    await page.locator('.store-code-link').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.store-code-link').first().click();
    await page.locator('#impaDetailModal').waitFor({ state: 'visible', timeout: 5_000 });

    const modalLayout = await page.locator('#impaDetailModal').evaluate(el => {
      const style = getComputedStyle(el);
      return {
        display: style.display,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
      };
    });
    results.push({
      check: 'mobile modal uses centered flex overlay',
      ok: modalLayout.display === 'flex'
        && modalLayout.alignItems === 'center'
        && modalLayout.justifyContent === 'center',
      detail: modalLayout,
    });

    const bodyScroll = await page.locator('#impaDetailModal .modal-body').evaluate(el => {
      const style = getComputedStyle(el);
      return style.overflowY;
    });
    results.push({
      check: 'mobile modal body scrollable',
      ok: bodyScroll === 'auto' || bodyScroll === 'scroll',
      detail: bodyScroll,
    });

    await page.locator('#modalCloseBtn').click();
    await page.locator('#impaDetailModal').waitFor({ state: 'hidden', timeout: 5_000 });
    results.push({
      check: 'mobile modal close button dismisses overlay',
      ok: await page.locator('#impaDetailModal').evaluate(el => el.classList.contains('hidden')),
    });

    // Bunker tab (desktop viewport)
    await page.setViewportSize({ width: 1280, height: 800 });
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
    await page.locator('.store-code-link').first().click();
    await page.locator('#impaDetailModal').waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('[data-lead-trigger="rob"]').click();
    await page.locator('#storeLeadModal').waitFor({ state: 'visible', timeout: 5_000 });
    results.push({
      check: 'locked field opens lead modal',
      ok: await page.locator('#storeLeadModal').isVisible(),
    });
    await page.locator('.store-lead-close').click({ force: true });
    results.push({
      check: 'lead modal closes',
      ok: await page.locator('#storeLeadModal').evaluate(el => el.classList.contains('hidden')),
    });

    await page.locator('#modalCloseBtn').click();
    await page.locator('#impaDetailModal').waitFor({ state: 'hidden', timeout: 5_000 });

    await page.setViewportSize({ width: 390, height: 844 });
    results.push({
      check: 'mobile footer visible without banner obstruction',
      ok: await page.locator('.store-public-footer').isVisible()
        && await page.locator('#toolkitConversionBanner').count() === 0
        && await page.locator('#storePublicFab').count() === 0,
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
