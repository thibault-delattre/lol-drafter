'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('simulator', {
  init: () => ipcRenderer.invoke('sim-init'),
  run: (spec, online) => ipcRenderer.invoke('sim-run', spec, online),
});
