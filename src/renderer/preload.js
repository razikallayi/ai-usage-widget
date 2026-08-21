const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (key, value) => ipcRenderer.invoke('config:set', key, value),
  setBounds: (bounds) => ipcRenderer.invoke('config:setBounds', bounds),
  setViewMode: (mode) => ipcRenderer.invoke('window:setViewMode', mode),
  setOpacity: (value) => ipcRenderer.invoke('window:setOpacity', value),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('window:setAlwaysOnTop', value),
  // Resolves to the clamped scale that actually took effect.
  setUiScale: (value) => ipcRenderer.invoke('window:setUiScale', value),
  fitToDisplay: () => ipcRenderer.invoke('window:fitToDisplay'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openConfigFolder: () => ipcRenderer.invoke('shell:openConfigFolder'),
  onShowSettings: (callback) => ipcRenderer.on('show-settings', callback),
  onOpacityChange: (callback) => ipcRenderer.on('opacity-change', (_, val) => callback(val)),
  onAlwaysOnTopChange: (callback) => ipcRenderer.on('always-on-top-change', (_, val) => callback(val)),
  // Fired whenever the scale changes from anywhere - tray, Ctrl +/-, or the
  // restore on load - so the titlebar and the settings slider stay in sync.
  onUiScaleChange: (callback) => ipcRenderer.on('ui-scale-change', (_, val) => callback(val)),
  // Fired on window show/restore/focus and on system resume/unlock, so the
  // poller can close the gap immediately instead of waiting for its interval.
  onWake: (callback) => ipcRenderer.on('widget:wake', () => callback()),
});
