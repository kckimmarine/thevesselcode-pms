/**
 * Smoke test: PMS shell has no internal STORE tab (catalog is public-only)
 * Run: node scripts/test-pms-no-store-tab.mjs
 */
import { chromium } from '@playwright/test';

const BASE = process.env.TVC_BASE_URL || 'http://127.0.0.1:4317';
const EXPECTED_NAV = ['Menu', 'PMS', 'SPARE', 'Report History', 'AI Help', 'Settings'];

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
  const results = [];

  try {
    const page = await browser.newPage();
    await login(page);

    results.push({
      check: 'no tab-store pane in PMS',
      ok: (await page.locator('#tab-store').count()) === 0,
    });
    results.push({
      check: 'no storeMenuBody in PMS',
      ok: (await page.locator('#storeMenuBody').count()) === 0,
    });
    results.push({
      check: 'no STORE tab button',
      ok: (await page.locator('.tab-btn[data-tab="store"]').count()) === 0,
    });
    results.push({
      check: 'switchTab(store) falls back to menu',
      ok: await page.evaluate(() => {
        window.TVC_App?.switchTab?.('store');
        return document.getElementById('tab-menu')?.classList.contains('hidden') === false
          && document.querySelector('.tab-btn[data-tab="menu"]')?.classList.contains('active') === true;
      }),
    });

    const desktopLabels = await page.locator('#tabBar .tab-btn, #tabBar .tab-bar-end button').evaluateAll(nodes =>
      nodes.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    );
    results.push({
      check: 'desktop nav items',
      ok: EXPECTED_NAV.every(label => desktopLabels.some(t => t.includes(label.replace('Report History', 'Report')))),
      detail: desktopLabels,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobileNavBtn').click();
    await page.waitForTimeout(200);
    const drawerLabels = await page.locator('#tabBar .tab-btn, #tabBar .tab-bar-end button').evaluateAll(nodes =>
      nodes.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    );
    results.push({
      check: 'mobile drawer nav items',
      ok: EXPECTED_NAV.every(label => drawerLabels.some(t => t.includes(label.replace('Report History', 'Report'))))
        && !drawerLabels.some(t => /STORE/i.test(t)),
      detail: drawerLabels,
    });
    results.push({
      check: 'mobile drawer excludes STORE',
      ok: !drawerLabels.some(t => /STORE/i.test(t)),
      detail: drawerLabels,
    });

    const publicPage = await browser.newPage();
    await publicPage.goto(`${BASE}/store-public.html`, { waitUntil: 'domcontentloaded' });
    await publicPage.locator('.store-search').waitFor({ state: 'visible', timeout: 30_000 });
    results.push({
      check: 'store-public.html still loads',
      ok: await publicPage.locator('.store-search').isVisible(),
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
