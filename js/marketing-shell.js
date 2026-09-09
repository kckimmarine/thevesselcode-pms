/**
 * THE VESSEL CODE — shared marketing topbar (Home, Services, Toolkit, Contact Us).
 * Mount: <div id="marketing-topbar"></div> + body[data-mkt-active="home|services|toolkit|contact"]
 */
(function () {
    'use strict';

    const NAV = [
        { id: 'home', href: '/', label: 'Home' },
        { id: 'services', href: '/services', label: 'Services' },
        { id: 'toolkit', href: '/toolkit', label: 'Maritime Toolkit' },
        { id: 'pms', href: 'https://app.thevesselcode.com', label: 'TVC-PMS', external: true },
        { id: 'contact', href: '/contact-us', label: 'Contact Us' },
    ];

    const LOGO = '/icons/company-logo.png?v=20260804-logo-no-ring';

    function renderTopbar(active) {
        const nav = NAV.map((item) => {
            const current = item.id === active ? ' aria-current="page"' : '';
            const ext = item.external ? ' target="_blank" rel="noopener noreferrer"' : '';
            return `<a href="${item.href}" data-nav="${item.id}"${current}${ext}>${item.label}</a>`;
        }).join('\n                ');

        return `
        <header class="home-topbar" role="banner">
            <a class="home-brand" href="/"${active === 'home' ? ' aria-current="page"' : ''}>
                <img src="${LOGO}" alt="" width="44" height="44" draggable="false">
                <span class="home-brand-text">
                    <span class="home-brand-name">THE VESSEL CODE</span>
                    <span class="home-brand-tag">Engineering · Operations · Economics</span>
                </span>
            </a>
            <nav class="home-topnav" aria-label="Primary">
                ${nav}
            </nav>
            <a class="home-btn home-btn-ghost home-topbar-cta" href="/contact-us">Contact</a>
        </header>`;
    }

    function mount() {
        const mountEl = document.getElementById('marketing-topbar');
        if (!mountEl) return;
        const active = document.body.getAttribute('data-mkt-active') || '';
        mountEl.innerHTML = renderTopbar(active);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
