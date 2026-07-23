/** TVC-PMS — 1920×1080 baseline; readability-first (no downscale below 100%) */
const TVC_ViewportScale = (function () {
    const DESIGN_W = 1920;
    const DESIGN_H = 1080;
    const BASE_FONT = 16;
    /** Never shrink UI — user reads at browser 100% zoom */
    const MIN = 1;
    const MAX = 1.12;

    function compute() {
        const vw = window.innerWidth || DESIGN_W;
        const vh = window.innerHeight || DESIGN_H;
        const sx = vw / DESIGN_W;
        const sy = vh / DESIGN_H;
        const ratio = Math.min(sx, sy);
        if (ratio >= 1) return Math.min(MAX, ratio);
        return MIN;
    }

    function apply() {
        const scale = compute();
        const root = document.documentElement;
        root.style.setProperty('--ui-scale', String(scale));
        root.style.setProperty('--ui-base-font', `${BASE_FONT * scale}px`);
        root.style.fontSize = `${BASE_FONT * scale}px`;
        window.dispatchEvent(new CustomEvent('tvc:viewport-scale', { detail: { scale } }));
    }

    function boot() {
        apply();
        window.addEventListener('resize', apply, { passive: true });
        window.visualViewport?.addEventListener('resize', apply, { passive: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    return { boot, apply, compute, DESIGN_W, DESIGN_H, BASE_FONT };
})();
