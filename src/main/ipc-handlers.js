const { ipcMain, shell } = require('electron');

function registerIpcHandlers(win, config, view = {}) {
  ipcMain.handle('config:get', () => config.getAll());

  ipcMain.handle('config:set', (_, key, value) => {
    config.set(key, value);
    if (key === 'opacity') {
      win.setOpacity(Math.max(0.3, Math.min(1, value)));
    }
    if (key === 'alwaysOnTop') {
      win.setAlwaysOnTop(!!value);
    }
    if (key === 'uiScale') {
      view.applyUiScale?.(value);
    }
    return true;
  });

  ipcMain.handle('config:setBounds', (_, bounds) => {
    config.set('windowBounds', bounds);
  });

  ipcMain.handle('window:setOpacity', (_, value) => {
    const clamped = Math.max(0.3, Math.min(1, value));
    win.setOpacity(clamped);
    config.set('opacity', clamped);
  });

  ipcMain.handle('window:setAlwaysOnTop', (_, value) => {
    win.setAlwaysOnTop(!!value);
    config.set('alwaysOnTop', !!value);
  });

  // Owned by main.js: the zoom factor also drives the window's minimum size,
  // which the renderer cannot set. Returns the clamped value so the caller can
  // reflect what actually took effect.
  ipcMain.handle('window:setUiScale', (_, value) => view.applyUiScale?.(value) ?? value);

  ipcMain.handle('window:fitToDisplay', () => {
    view.fitToDisplay?.();
  });

  // Owned by main.js: switching modes also swaps the window geometry, which
  // the renderer cannot do itself.
  ipcMain.handle('window:setViewMode', (_, mode) => {
    view.setViewMode?.(mode);
    return view.getViewMode?.() ?? mode;
  });

  ipcMain.handle('window:minimize', () => {
    win.hide();
  });

  ipcMain.handle('window:close', () => {
    win.hide();
  });

  ipcMain.handle('shell:openExternal', (_, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle('shell:openConfigFolder', () => {
    const { app } = require('electron');
    shell.openPath(app.getPath('userData'));
  });
}

module.exports = { registerIpcHandlers };
