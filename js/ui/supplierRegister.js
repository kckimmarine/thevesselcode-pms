/* THE VESSEL CODE — Supplier self-registration (login screen) */
const TVC_SupplierRegister = (function () {
    const MODAL_ID = 'supplier-register-modal';
    const TOAST_ID = 'loginToast';
    const SCOPE_VALUES = {
        spares: 'Spares Supply',
        engine: 'Engine Repair',
        stores: 'Stores',
        electrical: 'Electrical',
    };

    function el(id) { return document.getElementById(id); }

    function showToast(message) {
        if (typeof TVC_App !== 'undefined' && typeof TVC_App.showLoginToast === 'function') {
            TVC_App.showLoginToast(message);
            return;
        }
        let toast = el(TOAST_ID);
        if (!toast) {
            toast = document.createElement('div');
            toast.id = TOAST_ID;
            toast.className = 'tvc-feedback-toast login-toast';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.remove('hidden');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => toast.classList.add('hidden'), 4000);
    }

    function openModal() {
        const modal = el(MODAL_ID);
        if (!modal) {
            console.warn('[TVC] supplier register modal missing');
            showToast('Registration form is not loaded. Hard refresh (Ctrl+Shift+R) and try again.');
            return;
        }
        bind();
        modal.classList.remove('hidden');
        const err = el('supplierRegErr');
        if (err) err.textContent = '';
        el('supplierRegUserId')?.focus();
    }

    function closeModal() {
        el(MODAL_ID)?.classList.add('hidden');
    }

    function readBusinessScope() {
        const scopes = [];
        document.querySelectorAll('#supplierRegScope input[type="checkbox"]:checked').forEach(cb => {
            const v = SCOPE_VALUES[cb.value];
            if (v) scopes.push(v);
        });
        return scopes;
    }

    function resetForm() {
        const form = el('supplierRegisterForm');
        if (form) form.reset();
        const err = el('supplierRegErr');
        if (err) err.textContent = '';
    }

    async function handleSubmit(ev) {
        ev?.preventDefault();
        const errEl = el('supplierRegErr');
        if (errEl) errEl.textContent = '';
        const username = el('supplierRegUserId')?.value;
        const password = el('supplierRegPassword')?.value;
        const companyName = el('supplierRegCompany')?.value;
        const contactPerson = el('supplierRegContact')?.value;
        const contactEmail = el('supplierRegEmail')?.value;
        const servicePorts = el('supplierRegPorts')?.value;
        const business_scope = readBusinessScope();

        try {
            await TVC_DB.open();
            const r = await TVC_Auth.registerSupplier({
                username,
                password,
                company_name: companyName,
                contact_person: contactPerson,
                contact_email: contactEmail,
                service_ports: servicePorts,
                business_scope,
            });
            if (!r.ok) {
                if (errEl) errEl.textContent = r.error || 'Registration failed.';
                return;
            }
            closeModal();
            resetForm();
            const loginUser = el('loginUser');
            const loginPass = el('loginPass');
            const loginDept = el('loginDept');
            if (loginUser) loginUser.value = r.username || normalize(username);
            if (loginPass) loginPass.value = password || '';
            if (loginDept) loginDept.value = '';
            const loginErr = el('loginErr');
            if (loginErr) loginErr.textContent = '';
            showToast('Supplier account created successfully');
        } catch (e) {
            console.error('[TVC] supplier register', e);
            if (errEl) errEl.textContent = e.message || 'Registration failed.';
        }
    }

    function normalize(v) {
        return String(v || '').trim();
    }

    let bound = false;

    function bind() {
        if (bound) return;
        bound = true;
        el('supplierRegisterOpenBtn')?.addEventListener('click', (e) => {
            e.preventDefault();
            openModal();
        });
        el('supplierRegisterCloseBtn')?.addEventListener('click', () => closeModal());
        el('supplierRegisterCancelBtn')?.addEventListener('click', () => closeModal());
        el(MODAL_ID)?.addEventListener('click', (e) => {
            if (e.target === el(MODAL_ID)) closeModal();
        });
        el('supplierRegisterForm')?.addEventListener('submit', (e) => { void handleSubmit(e); });
    }

    function init() {
        bind();
    }

    return { init, openModal, closeModal, showToast };
})();
if (typeof window !== 'undefined') window.TVC_SupplierRegister = TVC_SupplierRegister;
// End of body scripts: bind before TVC_App.boot() finishes IndexedDB (boot used to be the only init path).
if (typeof window !== 'undefined' && window.TVC_SupplierRegister) {
    try { window.TVC_SupplierRegister.init(); } catch (e) { console.warn('[TVC] supplier register early init', e); }
}
