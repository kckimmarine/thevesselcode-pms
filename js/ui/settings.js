/* THE VESSEL CODE — Settings modal (Export folder · Password) */
const TVC_Settings = (function () {
    const MODAL_ID = 'settingsModal';

    function el(id) { return document.getElementById(id); }

    function setMsg(id, text, tone) {
        const node = el(id);
        if (!node) return;
        node.textContent = text || '';
        node.classList.toggle('is-error', tone === 'error');
        node.classList.toggle('is-ok', tone === 'ok');
        node.classList.toggle('hidden', !text);
    }

    async function refreshExportSection() {
        const pathNode = el('settingsExportPath');
        const noteNode = el('settingsExportNote');
        const resetBtn = el('settingsExportResetBtn');
        const openBtn = el('settingsExportOpenBtn');
        const changeBtn = el('settingsExportChangeBtn');
        if (!pathNode) return;

        const info = await TVC_FileExport.getExportFolderInfo();
        const configured = info.configuredExportFolder;
        const active = info.exportFolder || info.downloadsPath || 'Downloads';
        pathNode.textContent = active;

        if (TVC_FileExport.isElectron()) {
            noteNode.textContent = configured
                ? 'ZIP/Excel exports are saved to this folder automatically.'
                : 'No custom folder set — using Windows Downloads.';
            resetBtn.disabled = !configured;
            openBtn.disabled = false;
            changeBtn.disabled = false;
        } else {
            noteNode.textContent = 'Browser mode — exports use the browser Downloads folder. Use the Electron app to set a custom folder.';
            resetBtn.disabled = true;
            openBtn.disabled = true;
            changeBtn.disabled = true;
        }
    }

    function open(focusSection) {
        setMsg('settingsExportMsg', '');
        setMsg('settingsPasswordMsg', '');
        if (el('settingsCurrentPassword')) el('settingsCurrentPassword').value = '';
        if (el('settingsNewPassword')) el('settingsNewPassword').value = '';
        if (el('settingsConfirmPassword')) el('settingsConfirmPassword').value = '';
        refreshExportSection();
        window.TVC_App?.showModal?.(MODAL_ID);
        if (focusSection === 'password') {
            el('settingsNewPassword')?.focus();
        }
    }

    function close() {
        window.TVC_App?.closeModal?.(MODAL_ID);
    }

    async function changeExportFolder() {
        setMsg('settingsExportMsg', '');
        const result = await TVC_FileExport.pickExportFolder();
        if (result?.canceled) return;
        if (!result?.ok) {
            setMsg('settingsExportMsg', result?.error || 'Could not change folder.', 'error');
            return;
        }
        await refreshExportSection();
        setMsg('settingsExportMsg', 'Export folder updated.', 'ok');
    }

    async function resetExportFolder() {
        setMsg('settingsExportMsg', '');
        const result = await TVC_FileExport.resetExportFolder();
        if (!result?.ok) {
            setMsg('settingsExportMsg', result?.error || 'Could not reset folder.', 'error');
            return;
        }
        await refreshExportSection();
        setMsg('settingsExportMsg', 'Reset to Downloads.', 'ok');
    }

    async function openExportFolder() {
        setMsg('settingsExportMsg', '');
        const result = await TVC_FileExport.openExportFolder();
        if (!result?.ok) {
            setMsg('settingsExportMsg', result?.error || 'Could not open folder.', 'error');
        }
    }

    async function changePassword() {
        setMsg('settingsPasswordMsg', '');
        const user = TVC_Auth.getCurrentUser();
        if (!user) {
            setMsg('settingsPasswordMsg', 'Sign in required.', 'error');
            return;
        }
        const current = el('settingsCurrentPassword')?.value || '';
        const next = el('settingsNewPassword')?.value || '';
        const confirm = el('settingsConfirmPassword')?.value || '';
        if (!current || !next || !confirm) {
            setMsg('settingsPasswordMsg', 'Fill in all password fields.', 'error');
            return;
        }
        if (next !== confirm) {
            setMsg('settingsPasswordMsg', 'New passwords do not match.', 'error');
            return;
        }
        const result = await TVC_Auth.changePassword(user.id, current, next);
        if (!result.ok) {
            setMsg('settingsPasswordMsg', result.error || 'Password change failed.', 'error');
            return;
        }
        if (el('settingsCurrentPassword')) el('settingsCurrentPassword').value = '';
        if (el('settingsNewPassword')) el('settingsNewPassword').value = '';
        if (el('settingsConfirmPassword')) el('settingsConfirmPassword').value = '';
        setMsg('settingsPasswordMsg', 'Password updated.', 'ok');
    }

    return {
        open,
        close,
        changeExportFolder,
        resetExportFolder,
        openExportFolder,
        changePassword,
    };
})();
