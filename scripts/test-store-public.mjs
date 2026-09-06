/**
 * Smoke test: public IMPA catalog (no login, iframe embed)
 * Run: node scripts/test-store-public.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.TVC_BASE_URL || 'http://127.0.0.1:4317';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/store-public.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#loginScreen').waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => null);

    results.push({
      check: 'no login screen on public page',
      ok: !(await page.locator('#loginScreen').isVisible().catch(() => false)),
    });
    results.push({
      check: 'public mode class on document',
      ok: await page.evaluate(() => document.documentElement.classList.contains('store-public-mode')),
    });
    results.push({
      check: 'import button hidden',
      ok: !(await page.locator('#storeImportBtn').count()),
    });
    results.push({
      check: 'cart pill hidden',
      ok: !(await page.locator('.store-cart-pill').count()),
    });

    await page.locator('.store-code-link').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('.store-search').fill('rope');
    await page.waitForTimeout(400);
    await page.locator('.store-code-link').first().click();
    await page.locator('#impaDetailModal').waitFor({ state: 'visible', timeout: 5_000 });

    results.push({
      check: 'modal opens without login',
      ok: await page.locator('#impaDetailModal').isVisible(),
    });
    results.push({
      check: 'ROB banner hidden in public mode',
      ok: await page.locator('#impaDetailRobBanner').evaluate(el => el.classList.contains('hidden')),
    });
    results.push({
      check: 'cart section hidden in public mode',
      ok: await page.locator('.impa-detail-cart').evaluate(el => el.classList.contains('hidden')),
    });

    const cta = page.locator('#impaDetailPublicCta a');
    results.push({
      check: 'public CTA visible',
      ok: await cta.isVisible(),
    });
    const ctaHref = await cta.getAttribute('href');
    const ctaText = ((await cta.textContent()) || '').trim();
    results.push({
      check: 'CTA links to thevesselcode.com',
      ok: ctaHref === 'https://thevesselcode.com',
      detail: ctaHref,
    });
    results.push({
      check: 'CTA copy mentions ROB and requisitions',
      ok: /manage ROB/i.test(ctaText) && /requisitions/i.test(ctaText),
      detail: ctaText,
    });

    const iframePage = await browser.newPage();
    await iframePage.setContent(`
      <!DOCTYPE html><html><body style="margin:0">
        <iframe id="embed" src="${BASE}/store-public.html" width="900" height="700"></iframe>
      </body></html>
    `, { waitUntil: 'domcontentloaded' });
    const frame = iframePage.frameLocator('#embed');
    await frame.locator('.store-search').waitFor({ state: 'visible', timeout: 30_000 });
    results.push({
      check: 'loads inside iframe',
      ok: await frame.locator('.store-search').isVisible(),
    });

    const redirectPage = await browser.newPage();
    await redirectPage.goto(`${BASE}/?mode=public`, { waitUntil: 'load' });
    results.push({
      check: '?mode=public redirects to store-public.html',
      ok: /store-public/i.test(redirectPage.url()),
      detail: redirectPage.url(),
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
