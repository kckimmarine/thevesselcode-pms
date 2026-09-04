const fs = require('fs');
const path = require('path');
const findings = require('../helpers/findings');

function mdEsc(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

class MarkdownReport {
  onEnd(result) {
    const store = findings.load();
    const bugs = store.findings.filter((f) => f.severity === 'bug');
    const ux = store.findings.filter((f) => f.severity === 'ux');
    const info = store.findings.filter((f) => f.severity === 'info');
    const shots = [...new Set(store.findings.map((f) => f.screenshot).filter(Boolean)
      .concat(store.steps.map((s) => s.screenshot).filter(Boolean)))];

    const status = result.status === 'passed' && bugs.length === 0
      ? 'PASS (tour completed, no functional bugs logged)'
      : result.status === 'passed'
        ? 'TOUR COMPLETE — bugs recorded in findings'
        : `SUITE ${String(result.status).toUpperCase()}`;

    const suggest = [];
    if (ux.some((f) => f.category.includes('overflow'))) {
      suggest.push('**Wide tables on 390px:** PMS / History / SPARE sheets use many columns. Collapse to a card list or sticky first column + horizontal snap, and hide low-priority columns (PIC, Last Done) behind “More”.');
    }
    if (ux.some((f) => f.category.includes('overlap'))) {
      suggest.push('**Header / ship meta overlap:** On 390px the ship-name row + IMO/Delivery/User chips compete with the hamburger and End button. Stack ship meta on two lines and give the header a min-height with `flex-wrap`.');
    }
    if (ux.some((f) => f.category.includes('text-clip'))) {
      suggest.push('**Label clip:** Replace nowrap job-code / menu labels with `overflow-wrap: anywhere` or a 2-line clamp + tooltip. Avoid `white-space: nowrap` in `.cmaxs-header` and `.vl-cells` below 420px.');
    }
    if (bugs.some((f) => f.category === 'button' || f.category === 'blocked-button')) {
      suggest.push('**Unclickable controls:** Raise modal/dialog z-index consistency and keep the 400ms dialog ghost-shield from covering the next tap target. Make primary actions (`Make Report`, `Make Consumption Report`) at least 44×44px and not covered by the sticky header.');
    }
    if (bugs.some((f) => f.category === 'loading')) {
      suggest.push('**Hung loading:** Seed/XLS load on first Engine login can stall the SPARE list. Show a determinate progress banner and fail the busy state after ~15s with Retry.');
    }
    if (bugs.some((f) => f.category === 'work-report' || f.category === 'spare')) {
      suggest.push('**Empty lists:** If seed is still in deferred boot, PMS/SPARE should show “Loading master data…” instead of a blank virtual list.');
    }
    if (!suggest.length) {
      suggest.push('No high-priority layout defects were auto-classified. Still review the 390px screenshots for ship-header density and table usability.');
    }

    const lines = [];
    lines.push('# TVC-PMS E2E Test Report');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('Automated Playwright tour of THE VESSEL CODE PMS (web demo on `localhost`).');
    lines.push('');
    lines.push('## Run summary');
    lines.push('');
    lines.push(`- **Suite status:** ${status}`);
    lines.push(`- **Playwright status:** ${result.status}`);
    lines.push(`- **Functional bugs:** ${bugs.length}`);
    lines.push(`- **UI/UX findings (390px overlap / clip / overflow):** ${ux.length}`);
    lines.push(`- **Info:** ${info.length}`);
    lines.push(`- **Console errors captured:** ${store.consoleErrors.length}`);
    lines.push(`- **Page exceptions:** ${store.pageErrors.length}`);
    lines.push('- **Accounts:** Deck `officer` / `0000` / Department=Deck · Engine `engineer` / `0000` / Department=Engine');
    lines.push('- **Viewport:** desktop 1280×800 (tour) · mobile **390×844** (UI audit)');
    lines.push('');
    lines.push('## What was exercised');
    lines.push('');
    lines.push('1. Login (Deck) → Menu flow clicks → PMS job select → **Make Report** (outline + Page 2 qty) → Save/confirm');
    lines.push('2. SPARE → select part → **Make Consumption Report** (부품 차감) → qty + Save');
    lines.push('3. Report History scope tabs · Settings modal · Menu / PMS / SPARE / History tab switching');
    lines.push('4. Logout → Login (Engine) → same sequential tour');
    lines.push('5. Mobile 390px pass: Menu, PMS, Work Report modal, SPARE, History, Settings, hamburger nav, Login');
    lines.push('');
    lines.push('## Tour steps');
    lines.push('');
    lines.push('| Time | Step | Detail |');
    lines.push('| --- | --- | --- |');
    for (const s of store.steps) {
      const detail = [s.account, s.label, s.detail, s.count != null ? `count=${s.count}` : '', s.ms != null ? `${s.ms}ms` : '']
        .filter(Boolean).join(' · ');
      lines.push(`| ${mdEsc(s.at)} | ${mdEsc(s.name)} | ${mdEsc(detail)} |`);
    }
    if (!store.steps.length) lines.push('| — | *(no steps recorded)* | |');
    lines.push('');

    lines.push('## Functional defects (buttons / hang / JS)');
    lines.push('');
    if (!bugs.length) {
      lines.push('No functional bugs were logged by the probes. If the suite failed, see Playwright output.');
      lines.push('');
    } else {
      lines.push('| Severity | Area | Title | Detail | Screenshot |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const f of bugs) {
        const img = f.screenshot ? `[png](${f.screenshot})` : '';
        lines.push(`| ${f.severity} | ${mdEsc(f.category)} | ${mdEsc(f.title)} | ${mdEsc(f.detail)} | ${img} |`);
      }
      lines.push('');
    }

    lines.push('## Mobile 390px UI/UX findings');
    lines.push('');
    if (!ux.length) {
      lines.push('Probe did not flag overflow / overlap / text-clip (thresholds are conservative). Review screenshots anyway.');
      lines.push('');
    } else {
      lines.push('| Area | Title | Detail | Screenshot |');
      lines.push('| --- | --- | --- | --- |');
      for (const f of ux) {
        const img = f.screenshot ? `[png](${f.screenshot})` : '';
        lines.push(`| ${mdEsc(f.category)} | ${mdEsc(f.title)} | ${mdEsc(f.detail)} | ${img} |`);
      }
      lines.push('');
    }

    lines.push('## Screenshots');
    lines.push('');
    if (!shots.length) {
      lines.push('*(none captured)*');
      lines.push('');
    } else {
      for (const s of shots) {
        lines.push(`### ${path.basename(s)}`);
        lines.push('');
        lines.push(`![${path.basename(s)}](${s})`);
        lines.push('');
      }
    }

    lines.push('## Improvement suggestions');
    lines.push('');
    suggest.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
    lines.push('### Recommended CSS / layout follow-ups');
    lines.push('');
    lines.push('- At `@media (max-width: 420px)`, switch `.plan-layout` / `.actual-layout` from side-by-side tree+sheet to a stacked accordion (tree collapsed by default).');
    lines.push('- Give `.cmaxs-header` a single-row identity (ship name) and move IMO / Delivery / User into a second wrap row or a “i” popover.');
    lines.push('- Make `#planReportBtn` / `#spareMakeConsumeBtn` full-width sticky footers on mobile so they stay tappable above the virtual list.');
    lines.push('- History table: show Type + File No + Status only; put SORT / Spare Data behind a detail sheet.');
    lines.push('- Work Report modal: already improved for ≤768px — verify Page 2 spare qty inputs are 44px tall and not covered by `.wr-actions`.');
    lines.push('');
    lines.push('## How to re-run');
    lines.push('');
    lines.push('```bash');
    lines.push('npm run test:e2e');
    lines.push('```');
    lines.push('');
    lines.push('Requires Chromium (`npx playwright install chromium`). Does not replace `index.html` or `js/auth.js`.');
    lines.push('');

    const out = path.join(__dirname, '..', '..', 'TEST_REPORT.md');
    fs.writeFileSync(out, lines.join('\n'));
    console.log(`[e2e] wrote ${out} (${bugs.length} bugs, ${ux.length} ux)`);
  }
}

module.exports = MarkdownReport;
