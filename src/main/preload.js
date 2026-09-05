'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coach', {
  onState: (cb) => ipcRenderer.on('state', (_e, payload) => cb(payload)),
  onAi: (cb) => ipcRenderer.on('ai', (_e, payload) => cb(payload)),
  onCounters: (cb) => ipcRenderer.on('counters', (_e, payload) => cb(payload)),
  onReady: (cb) => ipcRenderer.on('ready', (_e, payload) => cb(payload)),
  onItems: (cb) => ipcRenderer.on('items', (_e, payload) => cb(payload)),
  itemsInit: () => ipcRenderer.invoke('items-init'),
  setRole: (role) => ipcRenderer.invoke('set-role', role),
  setOpponent: (id) => ipcRenderer.invoke('set-opponent', id),
  init: () => ipcRenderer.invoke('init'),
  refresh: () => ipcRenderer.invoke('refresh'),
  setModel: (m) => ipcRenderer.invoke('set-model', m),
  setAlwaysOnTop: (v) => ipcRenderer.invoke('set-always-on-top', v),
});
