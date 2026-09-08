/* THE VESSEL CODE — Public catalog lead capture (no PMS login) */
const TVC_StorePublicLead = (function () {
    const CONTACT_URL = 'https://thevesselcode.com/#contact';
    let _ready = false;
    let _source = 'general';

    function esc(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function sourceHeadline(source) {
        const map = {
            rob: 'Track live vessel ROB inside TVC-PMS',
            requisition: 'Issue 1-click requisitions from IMPA',
            fab: 'Upgrade your fleet to TVC-PMS',
            trial: 'Start your 1-ship free trial',
            locked: 'Unlock enterprise store management',
            general: 'See TVC-PMS in action',
        };
        return map[source] || map.general;
    }

    function ensureLeadModal() {
        if (document.getElementById('storeLeadModal')) return;

        const wrap = document.createElement('div');
        wrap.id = 'storeLeadModal';
        wrap.className = 'modal hidden store-lead-modal';
        wrap.setAttribute('aria-hidden', 'true');
        wrap.innerHTML = `
            <div class="modal-box store-lead-box" role="dialog" aria-modal="true" aria-labelledby="storeLeadTitle">
                <button type="button" class="store-lead-close" aria-label="Close">✕</button>
                <header class="store-lead-head">
                    <span class="store-lead-badge">TVC-PMS Enterprise</span>
                    <h2 id="storeLeadTitle" class="store-lead-title">Request a fleet demo</h2>
                    <p id="storeLeadSubtitle" class="store-lead-subtitle">
                        Automate ROB, requisitions, and maintenance workflows — no more Excel chaos.
                    </p>
                </header>
                <form class="store-lead-form" id="storeLeadForm">
                    <label class="store-lead-field">
                        <span>Full name</span>
                        <input type="text" name="name" id="storeLeadName" autocomplete="name" required>
                    </label>
                    <label class="store-lead-field">
                        <span>Work email</span>
                        <input type="email" name="email" id="storeLeadEmail" autocomplete="email" required>
                    </label>
                    <label class="store-lead-field">
                        <span>Company / fleet</span>
                        <input type="text" name="company" id="storeLeadCompany" autocomplete="organization">
                    </label>
                    <label class="store-lead-field">
                        <span>Role</span>
                        <select name="role" id="storeLeadRole">
                            <option value="">— Select —</option>
                            <option value="superintendent">Superintendent</option>
                            <option value="technical">Technical Manager</option>
                            <option value="master">Master / Chief Engineer</option>
                            <option value="procurement">Procurement</option>
                            <option value="other">Other</option>
                        </select>
                    </label>
                    <div class="store-lead-actions">
                        <button type="submit" class="store-lead-btn store-lead-btn-primary">
                            🚀 Request 1-Ship Free Trial / Demo
                        </button>
                        <a href="${CONTACT_URL}" target="_blank" rel="noopener noreferrer"
                            class="store-lead-btn store-lead-btn-secondary" id="storeLeadContactLink">
                            📞 Contact Superintendent Team
                        </a>
                    </div>
                </form>
            </div>`;
        document.body.appendChild(wrap);

        wrap.addEventListener('click', e => {
            if (e.target === wrap) closeLeadModal();
        });
        wrap.querySelector('.store-lead-box')?.addEventListener('click', e => e.stopPropagation());
        wrap.querySelector('.store-lead-close')?.addEventListener('click', closeLeadModal);
        wrap.querySelector('#storeLeadForm')?.addEventListener('submit', onLeadSubmit);

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !wrap.classList.contains('hidden')) closeLeadModal();
        });
    }

    function bindTriggers() {
        document.addEventListener('click', e => {
            const locked = e.target.closest('[data-lead-trigger]');
            if (locked) {
                e.preventDefault();
                openLeadModal(locked.dataset.leadTrigger || 'locked');
                return;
            }
            const trial = e.target.closest('[data-lead-action="trial"]');
            if (trial) {
                e.preventDefault();
                openLeadModal('trial');
            }
        });
    }

    function openLeadModal(source) {
        ensureLeadModal();
        _source = source || 'general';
        const modal = document.getElementById('storeLeadModal');
        const title = document.getElementById('storeLeadTitle');
        const subtitle = document.getElementById('storeLeadSubtitle');
        if (title) title.textContent = sourceHeadline(_source);
        if (subtitle) {
            subtitle.textContent = _source === 'rob'
                ? 'See real-time stock levels per vessel and auto-sync requisitions with your IMPA catalog.'
                : _source === 'requisition'
                    ? 'Convert IMPA lookups into approved requisitions in seconds — built for ship & shore teams.'
                    : 'TVC-PMS automates fleet maintenance, store tracking, and procurement workflows.';
        }
        modal?.classList.remove('hidden');
        modal?.setAttribute('aria-hidden', 'false');
        document.getElementById('impaDetailModal')?.classList.add('impa-detail-modal-behind');
        document.getElementById('storeLeadName')?.focus();
    }

    function closeLeadModal() {
        const modal = document.getElementById('storeLeadModal');
        modal?.classList.add('hidden');
        modal?.setAttribute('aria-hidden', 'true');
        document.getElementById('impaDetailModal')?.classList.remove('impa-detail-modal-behind');
    }

    function onLeadSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const data = {
            name: form.name?.value?.trim() || '',
            email: form.email?.value?.trim() || '',
            company: form.company?.value?.trim() || '',
            role: form.role?.value || '',
            source: _source,
            item: document.getElementById('impaDetailBadge')?.textContent || '',
            at: new Date().toISOString(),
        };
        try {
            sessionStorage.setItem('tvc_store_lead_draft', JSON.stringify(data));
        } catch { /* ignore */ }
        closeLeadModal();
        window.open(CONTACT_URL, '_blank', 'noopener,noreferrer');
    }

    function init() {
        if (_ready) return;
        _ready = true;
        ensureLeadModal();
        bindTriggers();
    }

    return { init, openLeadModal, closeLeadModal, CONTACT_URL };
})();
