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

test.describe.configure({ mode: 'serial' });

async function fillWorkReport(page, account) {
  const opened = await switchTab(page, 'actual', account);
  expect(opened, 'PMS tab should open').toBeTruthy();
  await page.waitForTimeout(500);

  const totalDash = page.locator('.act-dash-btn[data-afilter="total"]');
  if (await totalDash.isVisible().catch(() => false)) {
    await totalDash.click();
    await page.waitForTimeout(300);
  }

  const hasJobs = await waitForJobs(page, 50_000);
  if (!hasJobs) {
    const file = await shot(page, `pms-no-jobs-${account.replace(/\W+/g, '_')}`);
    findings.addFinding({
      severity: 'bug',
      category: 'work-report',
      title: 'PMS job list empty or never rendered',
      detail: 'No .vl-cells[data-job-id] after waiting 50s. Seed/boot may be stuck.',
      screenshot: file,
      account,
    });
    return false;
  }

  const job = page.locator('#actScroll .vl-cells[data-job-id]').first();
  await job.click();
  await page.waitForTimeout(250);

  const make = page.locator('#planReportBtn');
  await expect(make).toBeVisible();
  if (await make.isDisabled()) {
    const file = await shot(page, `make-report-disabled-${account.replace(/\W+/g, '_')}`);
    findings.addFinding({
      severity: 'bug',
      category: 'work-report',
      title: 'Make Report stayed disabled after selecting a job',
      screenshot: file,
      account,
    });
    return false;
  }

  await make.click();
  const modal = page.locator('#workReportModal:not(.hidden)');
  const modalOk = await modal.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true).catch(() => false);
  if (!modalOk) {
    await dismissAllDialogs(page, true);
    const file = await shot(page, `work-report-modal-missing-${account.replace(/\W+/g, '_')}`);
    findings.addFinding({
      severity: 'bug',
      category: 'button',
      title: 'Make Report did not open Work Report modal',
      screenshot: file,
      account,
    });
    return false;
  }

  const outline = modal.locator('[data-wf="outline"]');
  const comments = modal.locator('[data-wf="shipComments"]');
  const note = `E2E tour ${new Date().toISOString().slice(0, 16)} — auto input`;
  if (await outline.isVisible().catch(() => false)) await outline.fill(note);
  if (await comments.isVisible().catch(() => false)) await comments.fill(note);

  const page2 = modal.locator('.wr-pagetab', { hasText: 'Page 2' });
  if (await page2.isVisible().catch(() => false)) {
    await page2.click();
    await page.waitForTimeout(400);
    const qty = modal.locator('.spare-consume-qty-input:not([disabled])').first();
    if (await qty.isVisible().catch(() => false)) {
      await qty.fill('1');
      findings.addStep({ name: 'work-report-page2-qty', account });
    }
    await modal.locator('.wr-pagetab', { hasText: 'Page 1' }).click().catch(() => {});
  }

  const file = await shot(page, `work-report-${account.replace(/\W+/g, '_')}`);
  findings.addStep({ name: 'work-report-filled', account, screenshot: file });

  const save = modal.locator('button.btn-green', { hasText: 'Save' }).first();
  if (await save.isVisible().catch(() => false)) {
    await save.click();
    await page.waitForTimeout(400);
    await dismissAllDialogs(page, true);
    await page.waitForTimeout(400);
    await dismissAllDialogs(page, true);
    findings.addStep({ name: 'work-report-save-clicked', account });
  } else {
    findings.addFinding({
      severity: 'bug',
      category: 'work-report',
      title: 'Work Report Save button not visible',
      screenshot: file,
      account,
    });
  }

  if (await modal.isVisible().catch(() => false)) {
    await closeTopModal(page);
  }
  return true;
}

async function deductSpare(page, account) {
  const opened = await switchTab(page, 'spare', account);
  if (!opened) {
    findings.addStep({ name: 'spare-tab-skipped', account, detail: 'SPARE tab hidden for this role' });
    return false;
  }
  await page.waitForTimeout(800);
  const hasSpares = await waitForSpares(page, 50_000);
  if (!hasSpares) {
    const file = await shot(page, `spare-empty-${account.replace(/\W+/g, '_')}`);
    findings.addFinding({
      severity: 'bug',
      category: 'spare',
      title: 'SPARE list empty or never rendered',
      screenshot: file,
      account,
    });
    return false;
  }

  const chk = page.locator('#tab-spare .spare-row-chk:not([disabled])').first();
  if (await chk.isVisible().catch(() => false)) {
    await chk.check({ force: true });
    await page.waitForTimeout(200);
  }

  const consumeBtn = page.locator('#spareMakeConsumeBtn');
  if (!(await consumeBtn.isVisible().catch(() => false))) {
    const file = await shot(page, `spare-no-consume-btn-${account.replace(/\W+/g, '_')}`);
    findings.addFinding({
      severity: 'bug',
      category: 'spare',
      title: 'Make Consumption Report button missing',
      screenshot: file,
      account,
    });
    return false;
  }
  if (await consumeBtn.isDisabled()) {
    findings.addFinding({
      severity: 'bug',
      category: 'spare',
      title: 'Make Consumption Report disabled (permission or selection)',
      account,
    });
    return false;
  }

  await consumeBtn.click();
  await page.waitForTimeout(500);
  await dismissAllDialogs(page, true);

  const consumeModal = page.locator('#spareConsumeModal:not(.hidden)');
  const ok = await consumeModal.waitFor({ state: 'visible', timeout: 12_000 }).then(() => true).catch(() => false);
  if (!ok) {
    const file = await shot(page, `consume-modal-missing-${account.replace(/\W+/g, '_')}`);
    findings.addFinding({
      severity: 'bug',
      category: 'button',
      title: 'Make Consumption Report did not open consume modal',
      screenshot: file,
      account,
    });
    return false;
  }

  const qty = consumeModal.locator('.spare-consume-qty-input:not([disabled])').first();
  if (await qty.isVisible().catch(() => false)) {
    await qty.fill('1');
  }

  const file = await shot(page, `spare-consume-${account.replace(/\W+/g, '_')}`);
  findings.addStep({ name: 'spare-consume-opened', account, screenshot: file });

  const save = consumeModal.locator('#consumeLogSaveBtn, button.btn-green:has-text("Save")').first();
  if (await save.isVisible().catch(() => false)) {
    await save.click();
    await page.waitForTimeout(400);
    await dismissAllDialogs(page, true);
    await page.waitForTimeout(300);
    await dismissAllDialogs(page, true);
    findings.addStep({ name: 'spare-consume-save-clicked', account });
  }

  if (await consumeModal.isVisible().catch(() => false)) {
    await closeTopModal(page);
  }
  return true;
}

async function clickMenuFlow(page, account) {
  await switchTab(page, 'menu', account);
  await page.waitForTimeout(400);
  const items = page.locator('#cmaxsCards .spare-flow-item:not([disabled])');
  const n = await items.count();
  findings.addStep({ name: 'menu-flow-count', account, count: n });
  const max = Math.min(n, 6);
  for (let i = 0; i < max; i++) {
    const item = items.nth(i);
    const label = ((await item.innerText()) || '').replace(/\s+/g, ' ').trim();
    await item.click();
    await page.waitForTimeout(400);
    await dismissAllDialogs(page, false);
    findings.addStep({ name: 'menu-flow-click', account, label });
    const modalOpen = await page.locator('.modal:not(.hidden)').first().isVisible().catch(() => false);
    if (modalOpen) await closeTopModal(page);
    if (!(await page.locator('#tab-menu:not(.hidden)').isVisible().catch(() => false))) {
      await switchTab(page, 'menu', account);
    }
  }
}

async function tourRole(page, role) {
  attachErrorHooks(page, role);
  const acc = await login(page, role);
  const account = acc.label;
  await shot(page, `after-login-${role}`);

  await clickMenuFlow(page, account);
  await fillWorkReport(page, account);
  await deductSpare(page, account);

  await switchTab(page, 'history', account);
  await page.waitForTimeout(400);
  await shot(page, `history-${role}`);
  const histPms = page.locator('.hist-scope-tab[data-hist-scope="pms"]');
  const histSpare = page.locator('.hist-scope-tab[data-hist-scope="spare"]');
  if (await histPms.isVisible().catch(() => false)) await histPms.click();
  if (await histSpare.isVisible().catch(() => false) && !(await histSpare.isHidden())) {
    await histSpare.click();
    await page.waitForTimeout(300);
  }

  const settingsOk = await openSettings(page, account);
  if (settingsOk) {
    await shot(page, `settings-${role}`);
    await closeTopModal(page);
  }

  await switchTab(page, 'menu', account);
  await switchTab(page, 'actual', account);
  await switchTab(page, 'history', account);
  await switchTab(page, 'menu', account);

  await logout(page);
  findings.addStep({ name: `logout:${role}`, account });
}

test('Deck then Engine sequential tour: login → Work Report → spare deduct → tabs', async ({ page }) => {
  await tourRole(page, 'deck');
  await tourRole(page, 'engine');
  expect(findings.load().steps.some((s) => s.name === 'login-ok:deck')).toBeTruthy();
  expect(findings.load().steps.some((s) => s.name === 'login-ok:engine')).toBeTruthy();
});
