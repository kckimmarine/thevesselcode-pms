/* THE VESSEL CODE — preload (license + settings bridge) */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tvcElectron', {
    isElectron: true,
    getLicense: () => ipcRenderer.invoke('tvc:get-license'),
    getAppInfo: () => ipcRenderer.invoke('tvc:get-app-info'),
    exportMachineRequest: () => ipcRenderer.invoke('tvc:export-machine-request'),
    importSeatLicense: () => ipcRenderer.invoke('tvc:import-seat-license'),
    installAppUpdate: (payload) => ipcRenderer.invoke('tvc:install-app-update', payload),
    getSettings: () => ipcRenderer.invoke('tvc:get-settings'),
    setExportFolder: (folder) => ipcRenderer.invoke('tvc:set-export-folder', folder),
    pickExportFolder: () => ipcRenderer.invoke('tvc:pick-export-folder'),
    openExportFolder: () => ipcRenderer.invoke('tvc:open-export-folder'),
    saveExportFile: (bytes, filename) => ipcRenderer.invoke('tvc:save-export-file', { bytes, filename }),
    saveAdminRegistry: (bundle) => ipcRenderer.invoke('tvc:save-admin-registry', bundle),
    getLicenseSigningStatus: () => ipcRenderer.invoke('tvc:get-license-signing-status'),
    pickLicensePrivateKey: () => ipcRenderer.invoke('tvc:pick-license-private-key'),
    issueSeatLicense: (payload) => ipcRenderer.invoke('tvc:issue-seat-license', payload),
    exportSeatLicense: (payload) => ipcRenderer.invoke('tvc:export-seat-license', payload),
    getSetupsSource: () => ipcRenderer.invoke('tvc:get-setups-source'),
    pickSetupsSourceFolder: () => ipcRenderer.invoke('tvc:pick-setups-source-folder'),
    readSetupFile: (payload) => ipcRenderer.invoke('tvc:read-setup-file', payload),
    getReleaseInfo: () => ipcRenderer.invoke('tvc:get-release-info'),
    listReleaseArtifacts: () => ipcRenderer.invoke('tvc:list-release-artifacts'),
    runAdminRelease: () => ipcRenderer.invoke('tvc:run-admin-release'),
    cancelAdminRelease: () => ipcRenderer.invoke('tvc:cancel-admin-release'),
    exportReleaseArtifacts: (payload) => ipcRenderer.invoke('tvc:export-release-artifacts', payload),
    onReleaseLog: (callback) => {
        const handler = (_evt, line) => {
            try { callback(line); } catch (_) { /* ignore */ }
        };
        ipcRenderer.on('tvc:release-log', handler);
        return () => ipcRenderer.removeListener('tvc:release-log', handler);
    },
    openPrintPreview: (payload) => ipcRenderer.invoke('tvc:open-print-preview', payload),
});
