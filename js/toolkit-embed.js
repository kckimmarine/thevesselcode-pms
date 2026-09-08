/* Maritime Toolkit — embed chrome (thevesselcode.com/maritime-toolkit iframe) */
(function () {
    function isEmbedded() {
        try {
            var q = new URLSearchParams(location.search);
            if (q.get('embed') === '1') return true;
            return window.self !== window.top;
        } catch (_) {
            return true;
        }
    }

    function applyEmbedChrome() {
        if (!isEmbedded()) return;
        document.documentElement.classList.add('store-embed-mode');
        document.body.classList.add('store-embed-mode');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyEmbedChrome);
    } else {
        applyEmbedChrome();
    }
})();
