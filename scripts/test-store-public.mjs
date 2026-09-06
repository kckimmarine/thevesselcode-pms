/**
 * Smoke test: public IMPA catalog advanced features
 * Run: node scripts/test-store-public.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.TVC_BASE_URL || 'http://127.0.0.1:4317';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/store-public.html`, { waitUntil: 'networkidle' });
    await page.locator('#loginScreen').waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => null);

    results.push({
      check: 'public mode class on document',
      ok: await page.evaluate(() => document.documentElement.classList.contains('store-public-mode')),
    });
    results.push({
      check: 'toolkit chips visible',
      ok: await page.locator('.store-tool-chip').count() === 3,
    });

    await page.locator('.store-code-link').first().waitFor({ state: 'visible', timeout: 30_000 });
    results.push({
      check: 'indexed search returns matches quickly',
      ok: await page.evaluate(async () => {
        const res = await TVC_StoreManager.searchCatalog('rope');
        return res.items.length > 0 && res.ms < 250;
      }),
    });

    const searchStart = Date.now();
    await page.locator('.store-search').fill('rope');
    await page.waitForTimeout(200);
    await page.locator('.store-code-link').first().waitFor({ state: 'visible', timeout: 5_000 });
    results.push({
      check: 'debounced search returns results quickly',
      ok: Date.now() - searchStart < 3000,
    });

    await page.locator('.store-code-link').first().click();
    await page.locator('#impaDetailModal').waitFor({ state: 'visible', timeout: 5_000 });

    const footerCta = page.locator('#impaDetailPublicFooter a');
    results.push({ check: 'sticky footer CTA visible', ok: await footerCta.isVisible() });
    const ctaHref = await footerCta.getAttribute('href');
    const ctaText = ((await footerCta.textContent()) || '').trim();
    results.push({
      check: 'CTA links to contact section',
      ok: ctaHref === 'https://thevesselcode.com/#contact',
      detail: ctaHref,
    });
    results.push({
      check: 'CTA mentions automate Requisitions',
      ok: /automate Requisitions/i.test(ctaText) && /ROB/i.test(ctaText),
      detail: ctaText,
    });

    const specText = await page.locator('#impaDetailSpecBody').innerText();
    results.push({
      check: 'specs show category and material fields',
      ok: /Category/i.test(specText) && (/Material/i.test(specText) || /Dimensions/i.test(specText)),
      detail: specText.slice(0, 120),
    });

    results.push({
      check: 'float close button 44x44',
      ok: await page.locator('.impa-detail-close-float').evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.width >= 44 && r.height >= 44;
      }),
    });

    await page.locator('.impa-detail-close-float').click();
    results.push({
      check: 'float close dismisses modal',
      ok: await page.locator('#impaDetailModal').evaluate(el => el.classList.contains('hidden')),
    });

    await page.locator('[data-tool-tab="flange"]').click();
    await page.locator('#flangeTableHost table').waitFor({ state: 'visible', timeout: 5_000 });
    results.push({
      check: 'flange table renders',
      ok: await page.locator('#flangeTableHost tbody tr').count() > 0,
    });

    await page.locator('[data-tool-tab="bunker"]').click();
    await page.locator('#bunkerMassValue').waitFor({ state: 'visible', timeout: 5_000 });
    const bunkerMass = await page.locator('#bunkerMassValue').textContent();
    results.push({
      check: 'bunker calculator shows MT',
      ok: /MT/i.test(bunkerMass || ''),
      detail: bunkerMass,
    });

    await page.locator('[data-tool-tab="catalog"]').click();
    results.push({
      check: 'catalog tab restores IMPA list',
      ok: await page.locator('.store-search').isVisible(),
    });

    const mobile = await browser.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(`${BASE}/store-public.html`, { waitUntil: 'domcontentloaded' });
    await mobile.locator('.store-search').waitFor({ state: 'visible', timeout: 30_000 });
    results.push({
      check: 'mobile catalog layout',
      ok: await mobile.locator('.store-tool-chip').first().isVisible(),
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
