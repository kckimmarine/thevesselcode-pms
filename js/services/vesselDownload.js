/* THE VESSEL CODE — Sign-in Vessel Mode installer picker (web deploy) */
const TVC_VesselDownload = (function () {
    const SKU_META = {
        VESSEL_MASTER: { label: 'Master', desc: 'Bridge / captain station', icon: '🧭' },
        VESSEL_ENGINE: { label: 'Engine', desc: 'Engine control room', icon: '⚙️' },
        VESSEL_DECK: { label: 'Deck', desc: 'Deck department', icon: '⚓' },
    };

    let wired = false;
    let busy = false;
    let cachedSetups = null;

    function $(id) {
        return document.getElementById(id);
    }

    function formatBytes(n) {
        const b = Number(n) || 0;
        if (!b) return '';
        if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
        return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    }

    function showStatus(msg, isError) {
        const el = $('vesselDownloadStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.classList.toggle('hidden', !msg);
        el.classList.toggle('is-error', !!isError);
    }

    function openModal() {
        const modal = $('vesselDownloadModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        showStatus('');
        renderList().catch(err => {
            showStatus(err?.message || 'Could not load installer list.', true);
        });
    }

    function closeModal() {
        const modal = $('vesselDownloadModal');
        if (modal) modal.classList.add('hidden');
        showStatus('');
    }

    function isMobileDevice() {
        return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent || '');
    }

    function prefersDirectDownload() {
        return isMobileDevice() || typeof window.showSaveFilePicker !== 'function';
    }

    async function loadSetups() {
        if (cachedSetups) return cachedSetups;
        const skus = TVC_SetupExport?.VESSEL_SETUP_SKUS || Object.keys(SKU_META);
        const manifest = TVC_SetupExport?.fetchWebInstallersManifest
            ? await TVC_SetupExport.fetchWebInstallersManifest()
            : null;
        const manifestBySku = new Map((manifest?.setups || []).filter(s => skus.includes(s.sku)).map(s => [s.sku, s]));
        let version = String(manifest?.version || '').trim();
        if (!version && TVC_SetupExport?.fetchPackageVersion) {
            version = await TVC_SetupExport.fetchPackageVersion();
        }
        const setups = [];
        for (const sku of skus) {
            const meta = SKU_META[sku] || { label: sku, desc: '', icon: '💾' };
            const listed = manifestBySku.get(sku);
            let hit = null;
            if (listed) {
                hit = {
                    sku,
                    filename: listed.filename,
                    url: `/downloads/${encodeURIComponent(listed.filename)}`,
                    bytes: listed.bytes || 0,
                };
            } else if (version && TVC_SetupExport?.probeWebSetup) {
                hit = await TVC_SetupExport.probeWebSetup(sku, version);
            }
            setups.push({
                sku,
                label: meta.label,
                desc: meta.desc,
                icon: meta.icon,
                available: !!hit,
                filename: hit?.filename || (version ? `TVC-PMS-${sku}-${version}-Setup.exe` : `TVC-PMS-${sku}-Setup.exe`),
                url: hit?.url || (version ? `/downloads/${encodeURIComponent(`TVC-PMS-${sku}-${version}-Setup.exe`)}` : null),
                bytes: hit?.bytes || 0,
            });
        }
        cachedSetups = { version, setups };
        return cachedSetups;
    }

    function renderListItem(setup) {
        const size = setup.bytes ? formatBytes(setup.bytes) : '';
        const badge = setup.available
            ? (size ? `Ready · ${size}` : 'Ready')
            : 'Not on server';
        const disabled = busy ? 'disabled' : '';
        const cls = setup.available ? 'vessel-download-item' : 'vessel-download-item is-unavailable';
        return `
            <button type="button" class="${cls}" data-sku="${setup.sku}" ${disabled}
                aria-label="Download ${setup.label} Vessel Mode installer">
                <span class="vessel-download-item-icon" aria-hidden="true">${setup.icon}</span>
                <span class="vessel-download-item-body">
                    <span class="vessel-download-item-title">${setup.label}</span>
                    <span class="vessel-download-item-desc">${setup.desc}</span>
                    <span class="vessel-download-item-file muted">${setup.filename}</span>
                </span>
                <span class="vessel-download-item-badge">${badge}</span>
            </button>`;
    }

    async function renderList() {
        const list = $('vesselDownloadList');
        if (!list) return;
        list.innerHTML = '<p class="muted vessel-download-loading">Checking installers…</p>';
        const { version, setups } = await loadSetups();
        if (!version && !setups.some(s => s.available)) {
            list.innerHTML = setups.map(renderListItem).join('');
            showStatus('Could not read app version. Installers may be unavailable.', true);
            return;
        }
        const any = setups.some(s => s.available);
        list.innerHTML = setups.map(renderListItem).join('');
        if (!any) {
            showStatus(`No installers in /downloads/ for v${version}. Contact your administrator.`, true);
        }
        list.querySelectorAll('.vessel-download-item:not(.is-unavailable)').forEach(btn => {
            btn.addEventListener('click', () => {
                const sku = btn.getAttribute('data-sku');
                if (sku) {
                    startDownload(sku).catch(err => {
                        if (err?.name === 'AbortError') return;
                        alert(err?.message || String(err));
                    });
                }
            });
        });
        list.querySelectorAll('.vessel-download-item.is-unavailable').forEach(btn => {
            btn.addEventListener('click', () => {
                showStatus('This installer is not available on the server yet.', true);
            });
        });
    }

    async function saveWithPicker(filename, bytes) {
        if (typeof window.showSaveFilePicker === 'function') {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'Windows Setup',
                    accept: { 'application/octet-stream': ['.exe'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(bytes);
            await writable.close();
            return true;
        }
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return false;
    }

    function triggerDirectDownload(setup) {
        const a = document.createElement('a');
        a.href = setup.url;
        a.download = setup.filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    async function startDownload(sku) {
        if (busy) return;
        busy = true;
        showStatus('Preparing download…');
        try {
            const { setups, version } = await loadSetups();
            const setup = setups.find(s => s.sku === sku);
            if (!setup) throw new Error('Unknown Vessel Mode type.');
            if (!setup.available || !setup.url) {
                throw new Error(version
                    ? `Installer not found for v${version}. Upload TVC-PMS-${sku}-${version}-Setup.exe to /downloads/.`
                    : 'Installer not available.');
            }
            closeModal();
            if (prefersDirectDownload()) {
                triggerDirectDownload(setup);
                return;
            }
            const bytes = TVC_SetupExport?.readSetupBytes
                ? await TVC_SetupExport.readSetupBytes(setup)
                : new Uint8Array(await (await fetch(setup.url, { cache: 'no-store' })).arrayBuffer());
            const usedPicker = await saveWithPicker(setup.filename, bytes);
            if (!usedPicker) {
                alert(`${setup.filename} download started. Check your browser downloads folder.`);
            }
        } finally {
            busy = false;
            showStatus('');
        }
    }

    function wireLoginButton() {
        if (wired) return;
        const btn = $('loginDownloadBtn') || $('loginDownloadLink');
        if (!btn) return;
        wired = true;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openModal();
        });
        if (btn.tagName === 'A') {
            btn.removeAttribute('href');
            btn.removeAttribute('target');
            btn.removeAttribute('download');
        }
    }

    function initLogin() {
        wireLoginButton();
    }

    return {
        initLogin,
        openModal,
        closeModal,
        startDownload,
    };
})();
if (typeof window !== 'undefined') window.TVC_VesselDownload = TVC_VesselDownload;
