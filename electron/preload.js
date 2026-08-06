/* THE VESSEL CODE — preload (license + settings bridge) */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tvcElectron', {
    isElectron: true,
    getLicense: () => ipcRenderer.invoke('tvc:get-license'),
    getAppInfo: () => ipcRenderer.invoke('tvc:get-app-info'),
    getSettings: () => ipcRenderer.invoke('tvc:get-settings'),
    setExportFolder: (folder) => ipcRenderer.invoke('tvc:set-export-folder', folder),
    pickExportFolder: () => ipcRenderer.invoke('tvc:pick-export-folder'),
    openExportFolder: () => ipcRenderer.invoke('tvc:open-export-folder'),
    saveExportFile: (bytes, filename) => ipcRenderer.invoke('tvc:save-export-file', { bytes, filename }),
    openPrintPreview: (payload) => ipcRenderer.invoke('tvc:open-print-preview', payload),
});
