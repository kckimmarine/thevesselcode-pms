/**
 * Smoke test: About & Contact page layout
 * Run: node scripts/test-about-contact.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.TVC_BASE_URL || 'http://127.0.0.1:4317';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/contact-us`, { waitUntil: 'networkidle' });

    results.push({
      check: 'hero headline present',
      ok: /Connect with THE VESSEL CODE/i.test(await page.locator('#acHeroTitle').textContent() || ''),
    });
    results.push({
      check: 'about mission headline present',
      ok: /Bridging Maritime Expertise/i.test(await page.locator('#acAboutTitle').textContent() || ''),
    });
    results.push({
      check: 'three highlight badges',
      ok: await page.locator('.ac-badge').count() === 3,
    });
    results.push({
      check: 'inquiry type dropdown present',
      ok: await page.locator('#acInquiryType').isVisible(),
    });
    results.push({
      check: 'company name and your name fields',
      ok: await page.locator('#acCompanyName').isVisible()
        && await page.locator('#acYourName').isVisible(),
    });
    results.push({
      check: 'work email confirm field present',
      ok: await page.locator('#acEmailConfirm').isVisible(),
    });
    results.push({
      check: 'SLA badge removed',
      ok: await page.locator('.ac-sla').count() === 0,
    });

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    results.push({
      check: 'desktop no horizontal overflow',
      ok: overflow.scrollWidth <= overflow.clientWidth + 1,
      detail: overflow,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    results.push({
      check: 'mobile no horizontal overflow',
      ok: mobileOverflow.scrollWidth <= mobileOverflow.clientWidth + 1,
      detail: mobileOverflow,
    });
    results.push({
      check: 'mobile single-column grid',
      ok: await page.evaluate(() => {
        const grid = document.querySelector('.ac-grid');
        return grid && getComputedStyle(grid).gridTemplateColumns.split(' ').length === 1;
      }),
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
