/* THE VESSEL CODE — Export file save (Electron folder or browser download) */
const TVC_FileExport = (function () {
    const LS_KEY = 'tvc_export_folder_v1';

    function toBlob(data) {
        if (data instanceof Blob) return data;
        if (data instanceof ArrayBuffer) return new Blob([data]);
        if (data instanceof Uint8Array) return new Blob([data]);
        return new Blob([data]);
    }

    function browserDownload(blob, filename) {
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return { ok: true, path: null, fallback: true };
    }

    async function save(data, filename) {
        const name = String(filename || '').trim();
        if (!name) throw new Error('Export filename is required.');
        const blob = toBlob(data);

        if (window.tvcElectron?.saveExportFile) {
            const buf = new Uint8Array(await blob.arrayBuffer());
            const result = await window.tvcElectron.saveExportFile(Array.from(buf), name);
            if (result?.ok) return result;
            throw new Error(result?.error || 'Export save failed.');
        }

        return browserDownload(blob, name);
    }

    async function getExportFolderInfo() {
        if (window.tvcElectron?.getSettings) {
            return window.tvcElectron.getSettings();
        }
        return {
            exportFolder: null,
            configuredExportFolder: localStorage.getItem(LS_KEY) || null,
            downloadsPath: null,
            electron: false,
        };
    }

    async function pickExportFolder() {
        if (window.tvcElectron?.pickExportFolder) {
            return window.tvcElectron.pickExportFolder();
        }
        return { ok: false, error: 'Export folder can only be changed in the Electron app.' };
    }

    async function resetExportFolder() {
        if (window.tvcElectron?.setExportFolder) {
            return window.tvcElectron.setExportFolder(null);
        }
        localStorage.removeItem(LS_KEY);
        return { ok: true };
    }

    async function openExportFolder() {
        if (window.tvcElectron?.openExportFolder) {
            return window.tvcElectron.openExportFolder();
        }
        return { ok: false, error: 'Open folder is available in the Electron app only.' };
    }

    function isElectron() {
        return !!window.tvcElectron?.isElectron;
    }

    return {
        save,
        getExportFolderInfo,
        pickExportFolder,
        resetExportFolder,
        openExportFolder,
        isElectron,
    };
})();
