/**
 * Smoke test: Maritime Toolkit public shell (5 tabs, lead capture)
 * Run: node scripts/test-store-public.mjs
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

async function openImpaCode(page, code) {
  await page.locator('.store-search').fill(code);
  await page.waitForTimeout(600);
  await page.locator(`.store-code-link[data-impa-code="${code}"]`).first().click();
  await page.locator('#impaDetailModal').waitFor({ state: 'visible', timeout: 5_000 });
}

async function assertShipservModal(page, code, results, viewportLabel = 'desktop') {
  await openImpaCode(page, code);

  const badge = await page.locator('#impaDetailBadge').textContent();
  const desc = await page.locator('#impaDetailProductDesc').textContent();
  const box = await page.locator('.impa-detail-box').boundingBox();
  const viewport = page.viewportSize();

  results.push({
    check: `${code} ${viewportLabel} shipserv layout visible`,
    ok: await page.locator('#impaDetailShipservLayout').isVisible(),
  });
  results.push({
    check: `${code} ${viewportLabel} legacy plate section hidden`,
    ok: !(await page.locator('.impa-detail-plate-section').isVisible()),
  });
  results.push({
    check: `${code} ${viewportLabel} product photo container visible`,
    ok: await page.locator('#impaDetailProductPhoto').isVisible(),
  });
  results.push({
    check: `${code} ${viewportLabel} code pill`,
    ok: (badge || '').includes(code),
    detail: (badge || '').trim(),
  });
  results.push({
    check: `${code} ${viewportLabel} spec table rows`,
    ok: await page.locator('.impa-shipserv-spec-table tr').count() >= 3,
  });
  results.push({
    check: `${code} ${viewportLabel} description present`,
    ok: /shipboard/i.test(desc || ''),
    detail: (desc || '').trim().slice(0, 80),
  });
  results.push({
    check: `${code} ${viewportLabel} modal centered`,
    ok: !!(box && viewport && box.y >= 8 && box.y + box.height <= viewport.height - 8),
    detail: box,
  });

  const scrollInfo = await page.locator('#impaDetailModal .modal-body').evaluate(el => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  results.push({
    check: `${code} ${viewportLabel} body scrollable`,
    ok: scrollInfo.overflowY === 'auto' || scrollInfo.overflowY === 'scroll',
    detail: scrollInfo,
  });

  await page.locator('#modalCloseBtn').click();
  await page.locator('#impaDetailModal').waitFor({ state: 'hidden', timeout: 5_000 });
  results.push({
    check: `${code} ${viewportLabel} close dismisses modal`,
    ok: await page.locator('#impaDetailModal').evaluate(el => el.classList.contains('hidden')),
  });
}

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
      check: 'header Contact CTA removed',
      ok: await page.locator('.home-topbar-cta').count() === 0,
    });

    results.push({
      check: 'nav Contact Us link removed',
      ok: await page.locator('.home-topnav a[data-nav="contact"]').count() === 0,
    });

    results.push({
      check: 'lead capture modal removed',
      ok: await page.locator('#storeLeadModal').count() === 0,
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
      check: 'shipserv layout visible',
      ok: await page.locator('#impaDetailShipservLayout').isVisible(),
    });
    results.push({
      check: 'product title in modal body',
      ok: await page.locator('#impaDetailProductTitle').isVisible(),
    });
    results.push({
      check: 'modal conversion footer removed',
      ok: await page.locator('#impaDetailPublicFooter').count() === 0,
    });

    await page.keyboard.press('Escape');
    await page.locator('#impaDetailModal').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

    await assertShipservModal(page, '232435', results, 'desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertShipservModal(page, '232453', results, 'mobile');

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

    await page.setViewportSize({ width: 390, height: 844 });
    results.push({
      check: 'mobile footer visible without banner obstruction',
      ok: await page.locator('.store-public-footer').isVisible()
        && await page.locator('#toolkitConversionBanner').count() === 0
        && await page.locator('#storePublicFab').count() === 0,
    });

    results.push({
      check: 'pull-to-refresh indicator not present',
      ok: await page.evaluate(() => !document.getElementById('storePullRefresh')),
    });

    const catalogScroll = await page.locator('#catalog-table-wrapper').evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        overflowX: style.overflowX,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });
    results.push({
      check: 'mobile IMPA table wrapper allows horizontal scroll',
      ok: catalogScroll.overflowX === 'auto' || catalogScroll.overflowX === 'scroll',
      detail: catalogScroll,
    });

    const searchFontSize = await page.locator('.store-search').evaluate((el) => (
      parseFloat(getComputedStyle(el).fontSize)
    ));
    results.push({
      check: 'mobile search input font-size prevents iOS zoom',
      ok: searchFontSize >= 16,
      detail: searchFontSize,
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
