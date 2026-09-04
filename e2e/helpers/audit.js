const { shot } = require('./app');
const findings = require('./findings');

/**
 * In-page UI/UX probe: overflow past viewport, text clip, overlap, dead buttons.
 * Conservative — ignores known scroll containers and tiny 1px noise.
 */
async function collectUiIssues(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const issues = [];

    function vis(el) {
      if (!el || el.nodeType !== 1) return false;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    }

    function label(el) {
      const id = el.id ? `#${el.id}` : '';
      const cls = (el.className && typeof el.className === 'string')
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
      const txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
    }

    function isScrollBox(el) {
      const st = getComputedStyle(el);
      const oy = /(auto|scroll|overlay)/.test(st.overflowY) || /(auto|scroll|overlay)/.test(st.overflow);
      const ox = /(auto|scroll|overlay)/.test(st.overflowX) || /(auto|scroll|overlay)/.test(st.overflow);
      return (oy && el.scrollHeight > el.clientHeight + 2) || (ox && el.scrollWidth > el.clientWidth + 2);
    }

    function skipOverflow(el) {
      if (el.closest('#tabBar') && !document.body.classList.contains('mobile-nav-open')) return true;
      if (el.closest('.virtual-scroll, .tree-scroll, .spare-req-list-scroll, .spare-req-hist-list-scroll, .list-table-scroll-wrap, .modal, .wr-page, .login-hint, [class*="scroll"]')) {
        return true;
      }
      let p = el;
      while (p && p !== document.body) {
        if (isScrollBox(p)) return true;
        p = p.parentElement;
      }
      return false;
    }

    const nodes = [...document.querySelectorAll('body *')].filter(vis);

    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      const clippedRight = r.right > vw + 8;
      const clippedLeft = r.left < -8;
      if ((clippedRight || clippedLeft) && !skipOverflow(el) && el.children.length === 0) {
        issues.push({
          kind: 'overflow',
          severity: 'ux',
          title: 'Element clipped outside viewport',
          detail: `${label(el)} rect=${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} vw=${vw}`,
        });
      }

      const st = getComputedStyle(el);
      const isTextish = /^(P|SPAN|LABEL|STRONG|H1|H2|H3|H4|BUTTON|TH|TD|A|LI)$/.test(el.tagName);
      if (isTextish && el.scrollWidth > el.clientWidth + 4) {
        const overflowStyle = `${st.overflow}|${st.overflowX}|${st.textOverflow}`;
        if (!/auto|scroll|ellipsis/.test(overflowStyle) && !skipOverflow(el)) {
          issues.push({
            kind: 'text-clip',
            severity: 'ux',
            title: 'Text overflows its box (possible overlap / cut-off)',
            detail: `${label(el)} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth}`,
          });
        }
      }
    }

    const texts = nodes.filter((el) => {
      if (!/^(SPAN|LABEL|STRONG|BUTTON|H1|H2|H3|P|A)$/.test(el.tagName)) return false;
      const t = (el.innerText || '').trim();
      return t.length >= 2 && el.children.length === 0;
    });

    function overlapArea(a, b) {
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return x * y;
    }

    for (let i = 0; i < texts.length; i++) {
      const a = texts[i].getBoundingClientRect();
      if (a.width < 8 || a.height < 8) continue;
      for (let j = i + 1; j < texts.length; j++) {
        if (texts[i].contains(texts[j]) || texts[j].contains(texts[i])) continue;
        if (texts[i].parentElement === texts[j].parentElement) continue;
        const b = texts[j].getBoundingClientRect();
        const area = overlapArea(a, b);
        const min = Math.min(a.width * a.height, b.width * b.height);
        if (area > 24 && area / min > 0.35) {
          issues.push({
            kind: 'overlap',
            severity: 'ux',
            title: 'Text labels overlap',
            detail: `${label(texts[i])} ∩ ${label(texts[j])} overlap=${Math.round(area)}px²`,
          });
        }
      }
    }

    const buttons = [...document.querySelectorAll('button, [role="button"], .tab-btn, .spare-flow-item, .login-submit')]
      .filter(vis);

    for (const btn of buttons) {
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
      if (btn.closest('#tabBar') && !document.body.classList.contains('mobile-nav-open')) continue;
      const r = btn.getBoundingClientRect();
      if (r.right < 0 || r.left > vw) continue;
      const cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
      const cy = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1);
      const top = document.elementFromPoint(cx, cy);
      if (!top) continue;
      if (btn === top || btn.contains(top) || top.contains(btn)) continue;
      if (top.closest('[data-tvc-dialog-shield]')) continue;
      if (top.closest('.modal:not(.hidden)') && !btn.closest('.modal')) continue;
      issues.push({
        kind: 'blocked-button',
        severity: 'bug',
        title: 'Button center is covered — click may miss',
        detail: `${label(btn)} covered by ${label(top)} at (${Math.round(cx)},${Math.round(cy)})`,
      });
    }

    const busy = [...document.querySelectorAll('button.is-busy, .login-submit.is-busy')]
      .filter(vis)
      .map(label);
    if (busy.length) {
      issues.push({
        kind: 'loading',
        severity: 'info',
        title: 'Busy / loading button visible',
        detail: busy.join('; '),
      });
    }

    const seen = new Set();
    return issues.filter((it) => {
      const k = `${it.kind}|${it.title}|${it.detail}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 40);
  });
}

async function auditViewport(page, { name, account, viewport }) {
  const file = await shot(page, name);
  const issues = await collectUiIssues(page);
  for (const it of issues) {
    findings.addFinding({
      severity: it.severity,
      category: it.kind === 'blocked-button' || it.kind === 'loading' ? it.kind : `mobile-${it.kind}`,
      title: it.title,
      detail: `${it.detail} [${name}]`,
      screenshot: file,
      viewport,
      account,
    });
  }
  return { screenshot: file, issues };
}

async function probeVisibleButtons(page, { account, limit = 18 } = {}) {
  const specs = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    function vis(el) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width >= 4 && r.height >= 4 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    }
    const skipRe = /End|Delete|Import|Export|Print|Preview|Sign In|Save|Confirm|Approve|Append/i;
    return [...document.querySelectorAll('button')]
      .filter((b) => vis(b) && !b.disabled)
      .map((b, i) => ({
        i,
        text: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 80),
        id: b.id || '',
        disabled: !!b.disabled,
      }))
      .filter((b) => b.text && !skipRe.test(b.text))
      .slice(0, 40);
  });

  const clicked = [];
  for (const spec of specs.slice(0, limit)) {
    const loc = spec.id
      ? page.locator(`#${CSS.escape(spec.id)}`)
      : page.locator('button', { hasText: spec.text }).first();
    const beforeUrl = page.url();
    try {
      const box = await loc.boundingBox();
      if (!box) {
        findings.addFinding({
          severity: 'bug',
          category: 'button',
          title: 'Visible button has no hit box',
          detail: spec.text || spec.id,
          account,
        });
        continue;
      }
      await loc.click({ timeout: 4_000 });
      clicked.push(spec.text || spec.id);
      await page.waitForTimeout(250);
      await page.evaluate(() => {}).catch(() => {});
      if (page.url() !== beforeUrl) await page.goBack().catch(() => {});
    } catch (e) {
      findings.addFinding({
        severity: 'bug',
        category: 'button',
        title: 'Button click failed',
        detail: `${spec.text || spec.id}: ${e.message}`,
        account,
      });
    }
  }
  return clicked;
}

module.exports = { collectUiIssues, auditViewport, probeVisibleButtons };
