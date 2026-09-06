/**
 * Smoke test: public IMPA catalog conversion & lead capture
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
      check: 'conversion banner copy present',
      ok: /Excel/i.test(bannerText || '') && /TVC-PMS/i.test(bannerText || ''),
      detail: (bannerText || '').trim().slice(0, 100),
    });

    results.push({
      check: 'primary trial CTA button visible',
      ok: await page.locator('[data-lead-action="trial"]').isVisible(),
    });
    const contactHref = await page.locator('.impa-lead-btn-secondary').getAttribute('href');
    results.push({
      check: 'secondary contact link',
      ok: contactHref === 'https://thevesselcode.com/#contact',
      detail: contactHref,
    });

    await page.locator('[data-lead-trigger="rob"]').click();
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

    await page.locator('[data-tool-tab="flange"]').click();
    results.push({
      check: 'catalog still works after lead flow',
      ok: await page.locator('#flangeTableHost table').isVisible({ timeout: 5_000 }).catch(() => false)
        || await page.locator('.store-search').isVisible().catch(() => false),
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
