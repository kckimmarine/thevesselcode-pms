const { test, expect } = require('@playwright/test');
const findings = require('./helpers/findings');
const {
  attachErrorHooks,
  login,
  logout,
  switchTab,
  openSettings,
  closeTopModal,
  dismissAllDialogs,
  waitForJobs,
  waitForSpares,
  shot,
} = require('./helpers/app');
const { auditViewport } = require('./helpers/audit');

const MOBILE = { width: 390, height: 844 };

test('Mobile 390px: overflow / overlap / clip audit across tabs', async ({ page }) => {
  attachErrorHooks(page, 'Engine / engineer (390px)');
  await page.setViewportSize(MOBILE);
  const acc = await login(page, 'engine');
  const account = `${acc.label} @390`;
  const vp = '390x844';

  const loginAlreadyGone = await page.locator('#appShell').isVisible();
  expect(loginAlreadyGone).toBeTruthy();

  await auditViewport(page, { name: 'mobile-390-menu', account, viewport: vp });

  await switchTab(page, 'actual', account);
  await waitForJobs(page, 40_000);
  await page.waitForTimeout(300);
  await auditViewport(page, { name: 'mobile-390-pms', account, viewport: vp });

  const job = page.locator('#actScroll .vl-cells[data-job-id]').first();
  if (await job.isVisible().catch(() => false)) {
    await job.click();
    const make = page.locator('#planReportBtn');
    if (await make.isEnabled().catch(() => false)) {
      await make.click();
      await page.waitForTimeout(400);
      await page.locator('#workReportModal:not(.hidden)').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      await auditViewport(page, { name: 'mobile-390-work-report', account, viewport: vp });
      await closeTopModal(page);
      await dismissAllDialogs(page, true);
    }
  }

  const spareOk = await switchTab(page, 'spare', account);
  if (spareOk) {
    await waitForSpares(page, 40_000);
    await auditViewport(page, { name: 'mobile-390-spare', account, viewport: vp });
  }

  await switchTab(page, 'history', account);
  await page.waitForTimeout(300);
  await auditViewport(page, { name: 'mobile-390-history', account, viewport: vp });

  if (await openSettings(page, account)) {
    await auditViewport(page, { name: 'mobile-390-settings', account, viewport: vp });
    await closeTopModal(page);
  }

  const nav = page.locator('#mobileNavBtn');
  if (await nav.isVisible().catch(() => false)) {
    const expanded = await nav.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      try {
        await nav.click({ timeout: 3_000 });
      } catch (e) {
        findings.addFinding({
          severity: 'bug',
          category: 'blocked-button',
          title: 'Hamburger menu click intercepted',
          detail: e.message,
          account,
          viewport: vp,
        });
        await nav.click({ force: true });
      }
    }
    await page.waitForTimeout(250);
    await auditViewport(page, { name: 'mobile-390-nav-open', account, viewport: vp });
    await shot(page, 'mobile-390-nav-open-full');
  }

  await logout(page);
  await page.setViewportSize(MOBILE);
  await auditViewport(page, { name: 'mobile-390-login', account: 'login @390', viewport: vp });

  const store = findings.load();
  const ux = store.findings.filter((f) => String(f.category).startsWith('mobile-'));
  findings.addStep({ name: 'mobile-audit-done', count: ux.length });
  expect(store.steps.some((s) => s.name === 'login-ok:engine')).toBeTruthy();
});
