import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const ART = '/opt/cursor/artifacts';
mkdirSync(ART, { recursive: true });

async function shot(page, name) {
  const path = `${ART}/${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log('SCREENSHOT', path);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  const results = {};

  try {
    await page.goto('https://thevesselcode.com/', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Open hamburger menu
    const menuBtn = page.locator('button[aria-label*="menu" i], .menu-toggle, .hamburger, [class*="menu-toggle"], [class*="hamburger"], header button').first();
    if (await menuBtn.count()) {
      await menuBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    await shot(page, '07-homepage-menu-open');
    const menuText = await page.locator('nav, .menu, header').allInnerTexts().catch(() => []);
    results.menuText = menuText.join('\n');
    results.hasPms = /pms/i.test(results.menuText);
    results.hasToolkit = /toolkit/i.test(results.menuText);

    // Same session: embed pages
    for (const path of ['/toolkit/', '/impa/', '/pms/']) {
      const resp = await page.goto(`https://thevesselcode.com${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);
      const slug = path.replace(/\//g, '') || 'root';
      await shot(page, `08-${slug}`);
      results[path] = {
        status: resp?.status(),
        url: page.url(),
        title: await page.title(),
        bodySnippet: (await page.locator('body').innerText().catch(() => '')).slice(0, 200),
      };
    }

    // WP login with same session
    const cpUser = process.env.BLUEHOST_CPANEL_USER;
    const cpPass = process.env.BLUEHOST_CPANEL_PASS;
    if (cpUser && cpPass) {
      await page.goto('https://thevesselcode.com/wp-login.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3000);
      const userField = page.locator('#user_login');
      if (await userField.count()) {
        await userField.fill(cpUser);
        await page.locator('#user_pass').fill(cpPass);
        await page.locator('#wp-submit').click();
        await page.waitForTimeout(5000);
        results.wpLogin = { url: page.url(), loggedIn: !page.url().includes('wp-login') };
        await shot(page, '09-wp-after-login');
      } else {
        await shot(page, '09-wp-challenge');
        results.wpLogin = { error: 'challenge or no form' };
      }
    }
  } catch (err) {
    results.error = String(err.message || err);
    await shot(page, '99-error').catch(() => {});
  }

  console.log('RESULTS:', JSON.stringify(results, null, 2));
  await browser.close();
}

main();
