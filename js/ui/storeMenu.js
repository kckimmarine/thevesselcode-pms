/* THE VESSEL CODE — STORE tab (IMPA catalog) */
const TVC_StoreMenu = (function () {
    let _mounted = false;

    function esc(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderCatalog(root, items, query = '') {
        const filtered = TVC_StoreManager.filterCatalog(query, items);
        if (!filtered.length) {
            root.innerHTML = '<p class="store-empty">No items match your search.</p>';
            return;
        }

        const rows = filtered.map(item => `
            <tr>
                <td class="store-code">${esc(item.code)}</td>
                <td>${esc(item.name)}</td>
                <td><span class="store-category">${esc(item.category)}</span></td>
                <td>${esc(item.unit)}</td>
            </tr>`).join('');

        root.innerHTML = `
            <div class="store-toolbar">
                <input type="search" class="store-search" placeholder="Search IMPA code, name, or category…"
                    aria-label="Search catalog" value="${esc(query)}">
                <span class="store-count">${filtered.length} of ${items.length} items</span>
            </div>
            <div class="store-table-wrap">
                <table class="store-table">
                    <thead>
                        <tr>
                            <th>IMPA Code</th>
                            <th>Description</th>
                            <th>Category</th>
                            <th>Unit</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;

        const searchInput = root.querySelector('.store-search');
        searchInput?.addEventListener('input', e => {
            renderCatalog(root, items, e.target.value);
            const updated = root.querySelector('.store-search');
            if (updated) {
                updated.focus();
                updated.setSelectionRange(updated.value.length, updated.value.length);
            }
        });
    }

    async function render() {
        const root = document.getElementById('storeMenuBody');
        if (!root) return;

        if (_mounted && TVC_StoreManager.getCatalog().length) {
            renderCatalog(root, TVC_StoreManager.getCatalog());
            return;
        }

        root.innerHTML = '<p class="store-loading">Loading catalog…</p>';
        try {
            const items = await TVC_StoreManager.loadCatalog();
            _mounted = true;
            renderCatalog(root, items);
        } catch (err) {
            root.innerHTML = `<p class="store-error">${esc(err.message || 'Failed to load catalog')}</p>`;
        }
    }

    return { render };
})();
