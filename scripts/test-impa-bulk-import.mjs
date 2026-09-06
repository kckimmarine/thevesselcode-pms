/**
 * Smoke test: IMPA bulk import (CSV chunk loader)
 * Run: node scripts/test-impa-bulk-import.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.TVC_BASE_URL || 'http://127.0.0.1:4317';
const ROWS = Number(process.env.IMPA_TEST_ROWS || 2500);

function buildCsv(rows) {
    const lines = ['IMPA,Description,Unit,Category,Spec'];
    for (let i = 1; i <= rows; i++) {
        const code = String(600000 + i);
        lines.push(`${code},Bulk Test Item ${i},PCS,Engine,ISO test ${i}`);
    }
    return lines.join('\n');
}

async function waitLoginReady(page) {
    const btn = page.locator('#loginScreen .login-submit');
    for (let i = 0; i < 60; i++) {
        const disabled = await btn.isDisabled().catch(() => true);
        const label = ((await btn.textContent().catch(() => '')) || '').trim();
        if (!disabled && !/Preparing|Signing/i.test(label)) return;
        await page.waitForTimeout(500);
    }
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
    const tmp = path.join(os.tmpdir(), `impa-bulk-${Date.now()}.csv`);
    fs.writeFileSync(tmp, buildCsv(ROWS), 'utf8');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const results = [];

    try {
        await login(page);
        await page.evaluate(() => window.TVC_App?.switchTab?.('store'));
        await page.locator('#storeImportBtn').waitFor({ state: 'visible', timeout: 15_000 });

        const started = Date.now();
        await page.locator('#storeImportFile').setInputFiles(tmp);
        await page.locator('#storeImportProgressLabel').waitFor({ state: 'visible', timeout: 10_000 });
        await page.waitForFunction(
            () => /Import complete|Complete/i.test(document.getElementById('storeImportProgressLabel')?.textContent || ''),
            null,
            { timeout: 120_000 },
        );
        const elapsed = Date.now() - started;

        const label = await page.locator('#storeImportProgressLabel').textContent();
        const countText = await page.locator('#storeCatalogCount').textContent();
        const total = Number(String(countText || '').replace(/[^\d]/g, '')) || 0;

        results.push({ check: 'import completes', ok: /complete/i.test(label || ''), detail: { label, elapsedMs: elapsed } });
        results.push({ check: 'catalog count updated', ok: total >= ROWS, detail: { total, expectedMin: ROWS, countText } });

        const failed = results.filter(r => !r.ok);
        console.log(JSON.stringify({ rows: ROWS, passed: results.length - failed.length, total: results.length, results }, null, 2));
        if (failed.length) process.exit(1);
    } finally {
        fs.unlinkSync(tmp);
        await browser.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
