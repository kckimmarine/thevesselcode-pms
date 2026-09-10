/* THE VESSEL CODE — Home hero background intensity picker */
(function () {
    'use strict';

    const STORAGE_KEY = 'tvc_home_hero_variant';
    const DEFAULT = 'vivid';
    const VARIANTS = [
        { id: 'soft', label: 'Soft' },
        { id: 'balanced', label: 'Balanced' },
        { id: 'vivid', label: 'Vivid' },
        { id: 'crisp', label: 'Crisp' },
    ];

    function applyVariant(hero, variant) {
        hero.setAttribute('data-hero-variant', variant);
        const picker = document.getElementById('homeHeroVariantPicker');
        if (!picker) return;
        picker.querySelectorAll('[data-variant]').forEach((btn) => {
            const active = btn.getAttribute('data-variant') === variant;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function init() {
        const hero = document.getElementById('hero');
        const picker = document.getElementById('homeHeroVariantPicker');
        if (!hero || !picker || !hero.classList.contains('mkt-hero-smart-vessel')) return;

        let saved = DEFAULT;
        try {
            saved = localStorage.getItem(STORAGE_KEY) || DEFAULT;
        } catch (_) { /* ignore */ }
        if (!VARIANTS.some((v) => v.id === saved)) saved = DEFAULT;
        applyVariant(hero, saved);

        picker.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-variant]');
            if (!btn) return;
            const variant = btn.getAttribute('data-variant');
            applyVariant(hero, variant);
            try {
                localStorage.setItem(STORAGE_KEY, variant);
            } catch (_) { /* ignore */ }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
