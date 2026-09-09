/* THE VESSEL CODE — About & Contact form handler */
(function () {
    const CONTACT_EMAIL = atob('a2NraW0ubWFyaW5lQGdtYWlsLmNvbQ==');

    function qs(sel) {
        return document.querySelector(sel);
    }

    function inquiryLabel(value) {
        const map = {
            demo: 'TVC-PMS Fleet Demo & PoC',
            partnership: 'Maritime Toolkit & Engineering Partnership',
            support: 'Technical Support & Bug Report',
            general: 'General Inquiries',
        };
        return map[value] || value || 'General Inquiries';
    }

    function setStatus(el, type, message) {
        if (!el) return;
        el.className = `ac-status visible ${type}`;
        el.textContent = message;
    }

    function buildMailtoUrl(data) {
        const subject = encodeURIComponent(`[TVC Contact] ${data.inquiryType}`);
        const body = encodeURIComponent(
            [
                `Inquiry Type: ${data.inquiryType}`,
                `Name: ${data.firstName} ${data.lastName}`.trim(),
                `Work Email: ${data.email}`,
                '',
                'Message:',
                data.message,
            ].join('\n')
        );
        return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    }

    function init() {
        const emailLink = qs('#acContactEmail');
        if (emailLink) {
            emailLink.textContent = CONTACT_EMAIL;
            emailLink.href = `mailto:${CONTACT_EMAIL}`;
        }

        const form = qs('#acContactForm');
        const status = qs('#acFormStatus');
        const submitBtn = qs('#acSubmitBtn');
        if (!form) return;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
                firstName: String(fd.get('firstName') || '').trim(),
                lastName: String(fd.get('lastName') || '').trim(),
                email: String(fd.get('email') || '').trim(),
                inquiryType: inquiryLabel(String(fd.get('inquiryType') || '')),
                message: String(fd.get('message') || '').trim(),
            };

            if (!data.firstName || !data.lastName || !data.email || !data.message) {
                setStatus(status, 'error', 'Please complete all required fields.');
                return;
            }

            if (submitBtn) submitBtn.disabled = true;
            setStatus(status, 'success', 'Opening your email client with a pre-filled inquiry…');

            const mailto = buildMailtoUrl(data);
            window.location.href = mailto;

            window.setTimeout(() => {
                if (submitBtn) submitBtn.disabled = false;
                setStatus(
                    status,
                    'success',
                    'If your email client did not open, use the email link in the contact card.'
                );
            }, 1200);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
