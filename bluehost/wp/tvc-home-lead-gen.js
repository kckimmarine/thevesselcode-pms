/**
 * TVC Home — Lead-gen FAB + modal (self-contained)
 * Load: <script src="https://thevesselcode.com/wp-tvc/tvc-home-lead-gen.js" defer></script>
 * Homepage only. See deploy/HOME-LEAD-GEN.md
 */
(function () {
  if (window.__TVC_HOME_LEAD_LOADED__) return;
  window.__TVC_HOME_LEAD_LOADED__ = true;

  var CONTACT = 'https://thevesselcode.com/#contact';

  function isHome() {
    var b = document.body;
    if (!b) return false;
    if (b.classList.contains('home') || b.classList.contains('front-page')) return true;
    var p = location.pathname || '/';
    return p === '/' || p === '';
  }

  function injectStyles() {
    if (document.getElementById('tvc-home-lead-styles')) return;
    var s = document.createElement('style');
    s.id = 'tvc-home-lead-styles';
    s.textContent = [
      '#tvc-home-fab{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:max(16px,env(safe-area-inset-bottom,0px));z-index:99990;padding:12px 18px;border:none;border-radius:999px;background:linear-gradient(135deg,#1a365d 0%,#2c5282 100%);color:#fff;font-size:13px;font-weight:700;line-height:1.3;box-shadow:0 8px 28px rgba(26,54,93,.35);cursor:pointer;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:min(92vw,320px);transition:transform .15s ease,box-shadow .15s ease}',
      '#tvc-home-fab:hover,#tvc-home-fab:focus-visible{transform:translateY(-2px);box-shadow:0 12px 32px rgba(26,54,93,.42);outline:2px solid #90cdf4;outline-offset:2px}',
      '#tvc-home-lead-overlay{display:none;position:fixed;inset:0;z-index:99999;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55);backdrop-filter:blur(4px)}',
      '#tvc-home-lead-overlay.is-open{display:flex}',
      '#tvc-home-lead-box{position:relative;width:min(100%,440px);max-height:min(92dvh,720px);overflow-y:auto;padding:20px;border:2px solid #1a365d;border-radius:14px;background:#fff;box-shadow:0 20px 56px rgba(26,54,93,.28);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
      '#tvc-home-lead-box .tvc-close{position:absolute;top:10px;right:10px;width:40px;height:40px;border:none;border-radius:8px;background:#edf2f7;color:#1a365d;font-size:20px;font-weight:700;cursor:pointer}',
      '.tvc-home-badge{display:inline-block;margin-bottom:8px;padding:4px 10px;border-radius:999px;background:#ebf8ff;color:#2b6cb0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}',
      '#tvc-home-lead-box h3{margin:0;padding-right:36px;font-size:20px;color:#1a365d}',
      '#tvc-home-lead-box .tvc-sub{margin:8px 0 16px;font-size:14px;line-height:1.45;color:#4a5568}',
      '.tvc-home-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;font-size:13px;font-weight:600;color:#4a5568}',
      '.tvc-home-field input,.tvc-home-field select{width:100%;padding:10px 12px;border:1px solid #cbd5e0;border-radius:8px;font-size:15px;box-sizing:border-box;font-family:inherit}',
      '.tvc-home-btn{display:flex;align-items:center;justify-content:center;width:100%;padding:12px 14px;border-radius:10px;font-size:14px;font-weight:700;text-align:center;text-decoration:none;cursor:pointer;border:none;font-family:inherit;box-sizing:border-box}',
      '.tvc-home-btn-primary{background:linear-gradient(135deg,#1a365d 0%,#2b6cb0 100%);color:#fff;margin-top:4px}',
      '.tvc-home-btn-secondary{background:#fff;color:#1a365d;border:2px solid #2b6cb0;margin-top:8px}'
    ].join('');
    document.head.appendChild(s);
  }

  function injectMarkup() {
    if (document.getElementById('tvc-home-fab')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = [
      '<button type="button" id="tvc-home-fab" aria-label="Request TVC-PMS demo">🚢 Upgrade Your Fleet to TVC-PMS</button>',
      '<div id="tvc-home-lead-overlay" aria-hidden="true">',
      '  <div id="tvc-home-lead-box" role="dialog" aria-modal="true" aria-labelledby="tvc-home-lead-title">',
      '    <button type="button" class="tvc-close" aria-label="Close">&times;</button>',
      '    <span class="tvc-home-badge">TVC-PMS Enterprise</span>',
      '    <h3 id="tvc-home-lead-title">Request a fleet demo</h3>',
      '    <p class="tvc-sub">Automate ROB, requisitions, and maintenance workflows — no more Excel chaos.</p>',
      '    <form id="tvc-home-lead-form">',
      '      <label class="tvc-home-field"><span>Full name</span><input type="text" name="name" required autocomplete="name" placeholder="Capt. John Doe"></label>',
      '      <label class="tvc-home-field"><span>Work email</span><input type="email" name="email" required autocomplete="email" placeholder="tech@shipping.com"></label>',
      '      <label class="tvc-home-field"><span>Company / fleet</span><input type="text" name="company" autocomplete="organization" placeholder="e.g. 5 Chemical Tankers"></label>',
      '      <label class="tvc-home-field"><span>Role</span><select name="role"><option value="">— Select —</option><option value="superintendent">Superintendent</option><option value="technical">Technical Manager</option><option value="master">Master / Chief Engineer</option><option value="procurement">Procurement</option><option value="other">Other</option></select></label>',
      '      <button type="submit" class="tvc-home-btn tvc-home-btn-primary">🚀 Request 1-Ship Free Trial / Demo</button>',
      '      <a href="' + CONTACT + '" class="tvc-home-btn tvc-home-btn-secondary" target="_blank" rel="noopener noreferrer">📞 Contact Superintendent Team</a>',
      '    </form>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(wrap);
  }

  function bind() {
    var fab = document.getElementById('tvc-home-fab');
    var overlay = document.getElementById('tvc-home-lead-overlay');
    var box = document.getElementById('tvc-home-lead-box');
    var form = document.getElementById('tvc-home-lead-form');
    if (!fab || !overlay || !form) return;

    function openModal() {
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      var name = form.querySelector('[name="name"]');
      if (name) name.focus();
    }
    function closeModal() {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }

    fab.addEventListener('click', openModal);
    var closeBtn = overlay.querySelector('.tvc-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    if (box) {
      box.addEventListener('click', function (e) { e.stopPropagation(); });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeModal();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var subject = encodeURIComponent('TVC-PMS Demo Request (Homepage)');
      var body = encodeURIComponent(
        'Name: ' + (fd.get('name') || '') + '\n' +
        'Email: ' + (fd.get('email') || '') + '\n' +
        'Company: ' + (fd.get('company') || '') + '\n' +
        'Role: ' + (fd.get('role') || '') + '\n' +
        'Source: homepage-fab'
      );
      closeModal();
      window.open('mailto:contact@thevesselcode.com?subject=' + subject + '&body=' + body, '_blank');
      window.open(CONTACT, '_blank', 'noopener,noreferrer');
    });
  }

  function init() {
    if (!isHome()) return;
    injectStyles();
    injectMarkup();
    bind();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
