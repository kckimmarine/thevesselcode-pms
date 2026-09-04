const { addFinding, addStep, addConsoleError, addPageError, screenshotPath, relScreenshot } = require('./findings');

const ACCOUNTS = {
  deck: { username: 'officer', password: '0000', dept: 'DECK', label: 'Deck / officer' },
  engine: { username: 'engineer', password: '0000', dept: 'ENGINE', label: 'Engine / engineer' },
  ce: { username: 'ce', password: '0000', dept: 'ENGINE', label: 'Engine / ce' },
};

const HUNG_MS = 20_000;

function attachErrorHooks(page, account) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon|Failed to load resource|net::ERR/i.test(text)) return;
    addConsoleError({ account, text });
  });
  page.on('pageerror', (err) => {
    addPageError({ account, text: err.message });
    addFinding({
      severity: 'bug',
      category: 'js-error',
      title: 'Uncaught page error',
      detail: err.message,
      account,
    });
  });
}

async function shot(page, name, extra = {}) {
  const abs = screenshotPath(name);
  await page.screenshot({ path: abs, fullPage: false });
  return relScreenshot(abs);
}

async function waitForLoginReady(page, account) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const user = page.locator('#loginUser');
  await user.waitFor({ state: 'visible', timeout: 30_000 });

  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const btn = page.locator('#loginScreen .login-submit');
    const label = (await btn.textContent().catch(() => '')) || '';
    const disabled = await btn.isDisabled().catch(() => true);
    if (!disabled && !/Preparing|Signing/i.test(label)) return;
    if (Date.now() - started > HUNG_MS && /Preparing|Signing/i.test(label)) {
      const file = await shot(page, `hung-login-${account || 'anon'}`);
      addFinding({
        severity: 'bug',
        category: 'loading',
        title: 'Login loading hung',
        detail: `Sign-in button stayed "${label.trim()}" for ${Math.round((Date.now() - started) / 1000)}s`,
        screenshot: file,
        account,
      });
      throw new Error(`Login hung on: ${label.trim()}`);
    }
    await page.waitForTimeout(250);
  }
  throw new Error('Login form never became ready');
}

async function login(page, role) {
  const acc = ACCOUNTS[role];
  if (!acc) throw new Error(`Unknown role: ${role}`);
  addStep({ name: `login:${role}`, account: acc.label });
  await waitForLoginReady(page, acc.label);
  await page.locator('#loginUser').fill(acc.username);
  await page.locator('#loginPass').fill(acc.password);
  await page.locator('#loginDept').selectOption(acc.dept);

  const t0 = Date.now();
  await page.locator('#loginScreen .login-submit').click();

  const app = page.locator('#appShell');
  const err = page.locator('#loginErr');
  try {
    await Promise.race([
      app.waitFor({ state: 'visible', timeout: 45_000 }),
      err.waitFor({ state: 'visible', timeout: 45_000 }).then(async () => {
        const msg = (await err.textContent()) || '';
        if (msg.trim()) throw new Error(msg.trim());
      }),
    ]);
  } catch (e) {
    const file = await shot(page, `login-failed-${role}`);
    addFinding({
      severity: 'bug',
      category: 'login',
      title: `Login failed (${acc.label})`,
      detail: e.message,
      screenshot: file,
      account: acc.label,
    });
    throw e;
  }

  const elapsed = Date.now() - t0;
  if (elapsed > HUNG_MS) {
    addFinding({
      severity: 'bug',
      category: 'loading',
      title: 'Login took too long',
      detail: `${acc.label} sign-in took ${Math.round(elapsed / 1000)}s`,
      account: acc.label,
    });
  }

  await page.locator('#appShell').waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const name = document.querySelector('.userNameEl')?.textContent?.trim();
    return name && name !== '—';
  }, null, { timeout: 30_000 }).catch(async () => {
    const file = await shot(page, `login-no-userbar-${role}`);
    addFinding({
      severity: 'bug',
      category: 'login',
      title: 'App shell visible but user bar never populated',
      screenshot: file,
      account: acc.label,
    });
  });

  addStep({ name: `login-ok:${role}`, account: acc.label, ms: elapsed });
  return acc;
}

async function logout(page) {
  const backdrop = page.locator('#mobileNavBackdrop');
  const navOpen = await page.evaluate(() => document.body.classList.contains('mobile-nav-open'));
  if (navOpen) {
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ force: true }).catch(() => {});
    } else {
      await page.evaluate(() => document.body.classList.remove('mobile-nav-open'));
    }
    await page.waitForTimeout(200);
  }
  const endBtn = page.locator('#appShell header .btn-red', { hasText: 'End' });
  if (await endBtn.isVisible().catch(() => false)) {
    try {
      await endBtn.click({ timeout: 4_000 });
    } catch (e) {
      addFinding({
        severity: 'bug',
        category: 'blocked-button',
        title: 'End (logout) click intercepted',
        detail: e.message,
      });
      await endBtn.click({ force: true });
    }
  }
  const back = await page.locator('#loginScreen').waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
  if (!back) {
    const file = await shot(page, 'logout-stuck-on-app');
    addFinding({
      severity: 'bug',
      category: 'button',
      title: 'End did not return to Sign in',
      detail: 'handleLogout via the End button left #appShell visible (often the mobile drawer backdrop swallows the tap). Recovered with TVC_App.handleLogout().',
      screenshot: file,
    });
    await page.evaluate(() => { try { window.TVC_App?.handleLogout?.(); } catch (_) {} });
    await page.locator('#loginScreen').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  }
}

async function dismissDialog(page, accept = true) {
  const modal = page.locator('#tvcDialogModal:not(.hidden)');
  if (!(await modal.isVisible().catch(() => false))) return false;
  const btn = modal.locator(accept ? '#tvcDialogConfirmBtn' : '#tvcDialogCancelBtn');
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(450);
    return true;
  }
  return false;
}

async function dismissAllDialogs(page, accept = true, max = 4) {
  for (let i = 0; i < max; i++) {
    if (!(await dismissDialog(page, accept))) return;
  }
}

async function switchTab(page, tab, account) {
  const map = {
    menu: 'menu',
    pms: 'actual',
    actual: 'actual',
    spare: 'spare',
    history: 'history',
  };
  const key = map[tab] || tab;
  const btn = page.locator(`#tabBar .tab-btn[data-tab="${key}"]`);
  if (!(await btn.count())) {
    addFinding({
      severity: 'bug',
      category: 'tabs',
      title: `Tab button missing: ${key}`,
      account,
    });
    return false;
  }
  if (await btn.isHidden().catch(() => true)) {
    addStep({ name: `tab-hidden:${key}`, account });
    return false;
  }

  const dialog = page.locator('#tvcDialogModal:not(.hidden)');
  if (await dialog.isVisible().catch(() => false)) {
    const msg = ((await page.locator('#tvcDialogMessage').textContent().catch(() => '')) || '').trim();
    const file = await shot(page, `dialog-blocking-nav-${key}`);
    addFinding({
      severity: 'bug',
      category: 'button',
      title: 'In-app dialog blocked navigation / next click',
      detail: msg || 'tvcDialogModal was open without being dismissed',
      screenshot: file,
      account,
    });
    await dismissAllDialogs(page, true);
  }

  const mobileNav = page.locator('#mobileNavBtn');
  if (await mobileNav.isVisible().catch(() => false)) {
    const expanded = await mobileNav.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await mobileNav.click({ force: true });
      await page.waitForTimeout(250);
    }
  }

  const t0 = Date.now();
  await btn.click({ force: true });
  await page.waitForTimeout(300);

  const pane = page.locator(`#tab-${key}`);
  const visible = await pane.isVisible().catch(() => false);
  const elapsed = Date.now() - t0;
  if (!visible) {
    const file = await shot(page, `tab-not-visible-${key}`);
    addFinding({
      severity: 'bug',
      category: 'tabs',
      title: `Tab pane did not appear: ${key}`,
      detail: `Clicked tab "${key}" but #tab-${key} stayed hidden`,
      screenshot: file,
      account,
    });
    return false;
  }
  if (elapsed > HUNG_MS) {
    addFinding({
      severity: 'bug',
      category: 'loading',
      title: `Tab switch hung: ${key}`,
      detail: `${elapsed}ms`,
      account,
    });
  }
  addStep({ name: `tab:${key}`, account, ms: elapsed });
  return true;
}

async function openSettings(page, account) {
  const mobileNav = page.locator('#mobileNavBtn');
  if (await mobileNav.isVisible().catch(() => false)) {
    const expanded = await mobileNav.getAttribute('aria-expanded');
    if (expanded !== 'true') await mobileNav.click();
    await page.waitForTimeout(200);
  }
  await dismissAllDialogs(page, true);
  const btn = page.locator('#settingsOpenBtn');
  if (!(await btn.isVisible().catch(() => false))) {
    addFinding({
      severity: 'bug',
      category: 'tabs',
      title: 'Settings button not visible',
      account,
    });
    return false;
  }
  await btn.click();
  const modal = page.locator('#settingsModal:not(.hidden)');
  const ok = await modal.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
  if (!ok) {
    const file = await shot(page, 'settings-not-open');
    addFinding({
      severity: 'bug',
      category: 'button',
      title: 'Settings button did not open modal',
      screenshot: file,
      account,
    });
  }
  return ok;
}

async function closeTopModal(page) {
  const open = page.locator('.modal:not(.hidden) .modal-x, .modal:not(.hidden) button:has-text("Close"), .modal:not(.hidden) button:has-text("Cancel")');
  if (await open.first().isVisible().catch(() => false)) {
    await open.first().click();
    await page.waitForTimeout(300);
    return true;
  }
  await page.keyboard.press('Escape');
  await dismissAllDialogs(page, false);
  return false;
}

async function waitForJobs(page, timeout = 45_000) {
  const row = page.locator('#actScroll .vl-cells[data-job-id]').first();
  try {
    await row.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function waitForSpares(page, timeout = 45_000) {
  const row = page.locator('#tab-spare [data-spare-id], #tab-spare .spare-row-chk').first();
  try {
    await row.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ACCOUNTS,
  HUNG_MS,
  attachErrorHooks,
  shot,
  waitForLoginReady,
  login,
  logout,
  dismissDialog,
  dismissAllDialogs,
  switchTab,
  openSettings,
  closeTopModal,
  waitForJobs,
  waitForSpares,
};
