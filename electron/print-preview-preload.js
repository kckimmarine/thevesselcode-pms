/* THE VESSEL CODE — print preview window bridge */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tvcPrintPreview', {
    print: () => ipcRenderer.invoke('tvc:print-preview-window'),
});
