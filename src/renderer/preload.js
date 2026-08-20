const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (key, value) => ipcRenderer.invoke('config:set', key, value),
  setBounds: (bounds) => ipcRenderer.invoke('config:setBounds', bounds),
  setViewMode: (mode) => ipcRenderer.invoke('window:setViewMode', mode),
  setOpacity: (value) => ipcRenderer.invoke('window:setOpacity', value),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('window:setAlwaysOnTop', value),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openConfigFolder: () => ipcRenderer.invoke('shell:openConfigFolder'),
  onShowSettings: (callback) => ipcRenderer.on('show-settings', callback),
  onOpacityChange: (callback) => ipcRenderer.on('opacity-change', (_, val) => callback(val)),
  onAlwaysOnTopChange: (callback) => ipcRenderer.on('always-on-top-change', (_, val) => callback(val)),
  // Fired on window show/restore/focus and on system resume/unlock, so the
  // poller can close the gap immediately instead of waiting for its interval.
  onWake: (callback) => ipcRenderer.on('widget:wake', () => callback()),
});
