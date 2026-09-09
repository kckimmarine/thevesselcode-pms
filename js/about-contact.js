/* THE VESSEL CODE — About & Contact form handler */
(function () {
    const CONTACT_RECIPIENTS = [
        'ktechship@gmail.com',
        ['kckim', 'marine', 'gmail', 'com'].join('.').replace('.marine.', '.marine@'),
    ];
    const CONTACT_DISPLAY = CONTACT_RECIPIENTS[0];

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

    function isValidEmail(value) {
        const email = String(value || '').trim();
        if (!email || email.length > 254) return false;
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
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
                `Company: ${data.companyName}`,
                `Your Name: ${data.yourName}`,
                `Work Email: ${data.email}`,
                '',
                'Message:',
                data.message,
            ].join('\n')
        );
        const to = CONTACT_RECIPIENTS.map(encodeURIComponent).join(',');
        return `mailto:${to}?subject=${subject}&body=${body}`;
    }

    function applyEmbedMode() {
        try {
            const embed = new URLSearchParams(window.location.search).get('embed') === '1';
            if (embed) document.body.classList.add('ac-embed');
        } catch { /* ignore */ }
    }

    function init() {
        applyEmbedMode();

        const emailLink = qs('#acContactEmail');
        if (emailLink) {
            emailLink.textContent = CONTACT_DISPLAY;
            emailLink.href = `mailto:${CONTACT_RECIPIENTS.join(',')}`;
        }

        const form = qs('#acContactForm');
        const status = qs('#acFormStatus');
        const submitBtn = qs('#acSubmitBtn');
        if (!form) return;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
                companyName: String(fd.get('companyName') || '').trim(),
                yourName: String(fd.get('yourName') || '').trim(),
                email: String(fd.get('email') || '').trim(),
                emailConfirm: String(fd.get('emailConfirm') || '').trim(),
                inquiryType: inquiryLabel(String(fd.get('inquiryType') || '')),
                message: String(fd.get('message') || '').trim(),
            };

            if (!data.companyName || !data.yourName || !data.email || !data.emailConfirm || !data.message) {
                setStatus(status, 'error', 'Please complete all required fields.');
                return;
            }

            if (!isValidEmail(data.email)) {
                setStatus(status, 'error', 'Please enter a valid work email address.');
                return;
            }

            if (data.email.toLowerCase() !== data.emailConfirm.toLowerCase()) {
                setStatus(status, 'error', 'Work Email and Confirm Work Email do not match.');
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
