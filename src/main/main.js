const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const Config = require('./config');
const { registerIpcHandlers } = require('./ipc-handlers');
const { createTray } = require('./tray');
const { startCollector, stopCollector } = require('./collector-process');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let win;
let config;
let viewMode = 'tabs';

// Which config key holds the geometry for a given view mode.
function boundsKey(mode) {
  return mode === 'wide' ? 'wideBounds' : 'windowBounds';
}

// Wide mode opens filling the display's work area - four full-detail columns
// want the room, and that is what "open it full" means here. Tabs mode keeps
// the compact widget size.
function defaultBounds(mode) {
  const area = screen.getPrimaryDisplay().workArea;
  if (mode !== 'wide') {
    return {
      width: 350,
      height: 500,
      x: Math.round(area.x + (area.width - 350) / 2),
      y: Math.round(area.y + (area.height - 500) / 2)
    };
  }
  // Fill the primary display's work area: four full-detail columns want the
  // room, and x/y must be given explicitly or the window can land centred
  // across two monitors.
  return { width: area.width, height: area.height, x: area.x, y: area.y };
}

// Keeps the window wholly on one display. Two cases matter: a saved position
// from a monitor that is no longer attached, and - now that wide mode can be
// 1400px+ - a window that overhangs an edge and silently clips its last column.
function ensureOnScreen(target) {
  const b = target.getBounds();
  const centerX = b.x + b.width / 2;
  const centerY = b.y + b.height / 2;

  const displays = screen.getAllDisplays();
  const host = displays.find(d => {
    const { x, y, width, height } = d.workArea;
    return centerX >= x && centerX <= x + width && centerY >= y && centerY <= y + height;
  });
  const area = (host || screen.getPrimaryDisplay()).workArea;

  const width = Math.min(b.width, area.width);
  const height = Math.min(b.height, area.height);
  // Clamp rather than recentre, so a window that merely overhangs slides back
  // into view instead of jumping to the middle of the screen.
  const x = host ? Math.min(Math.max(b.x, area.x), area.x + area.width - width)
                 : Math.round(area.x + (area.width - width) / 2);
  const y = host ? Math.min(Math.max(b.y, area.y), area.y + area.height - height)
                 : Math.round(area.y + (area.height - height) / 2);

  if (x === b.x && y === b.y && width === b.width && height === b.height) return;
  target.setBounds({ x, y, width, height });
}

function createWindow() {
  config = new Config();
  // Before the window loads: this may set relayUrl/readToken, which the
  // renderer reads on startup to decide between polling and the setup overlay.
  startCollector(config);

  viewMode = config.get('viewMode') === 'wide' ? 'wide' : 'tabs';
  const bounds = config.get(boundsKey(viewMode)) || {};
  const fallback = defaultBounds(viewMode);

  win = new BrowserWindow({
    width: bounds.width || fallback.width,
    height: bounds.height || fallback.height,
    x: bounds.x ?? fallback.x,
    y: bounds.y ?? fallback.y,
    minWidth: 280,
    minHeight: 400,
    // Wide mode puts four full-detail columns side by side, which needs far
    // more room than the old 600px cap allowed.
    maxWidth: 2400,
    maxHeight: 1600,
    frame: false,
    alwaysOnTop: config.get('alwaysOnTop'),
    // It lives in the tray, so it should not occupy a slot among open apps.
    skipTaskbar: true,
    resizable: true,
    backgroundColor: '#101014',
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.setOpacity(config.get('opacity'));

  ensureOnScreen(win);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  let boundsTimer;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      const b = win.getBounds();
      // Saved against the current mode so resizing one does not overwrite the
      // geometry the user chose for the other.
      config.set(boundsKey(viewMode), { x: b.x, y: b.y, width: b.width, height: b.height });
    }, 500);
  };
  win.on('moved', saveBounds);
  win.on('resized', saveBounds);

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  registerIpcHandlers(win, config, {
    getViewMode: () => viewMode,
    setViewMode: (mode) => {
      const next = mode === 'wide' ? 'wide' : 'tabs';
      if (next === viewMode) return;

      // Stash the geometry of the mode being left before adopting the other's.
      const b = win.getBounds();
      config.set(boundsKey(viewMode), { x: b.x, y: b.y, width: b.width, height: b.height });

      viewMode = next;
      config.set('viewMode', next);

      const target = config.get(boundsKey(next)) || {};
      const fallback = defaultBounds(next);
      const width = target.width || fallback.width;
      const height = target.height || fallback.height;
      // Grow around the current centre so the window does not jump across the
      // screen when it widens.
      // Never seen this mode before: use its default placement. Otherwise grow
      // around the current centre so the window does not jump across screens.
      const x = target.x ?? (target.width ? Math.round(b.x + b.width / 2 - width / 2) : fallback.x);
      const y = target.y ?? (target.width ? Math.round(b.y + b.height / 2 - height / 2) : fallback.y);

      win.setBounds({ x, y, width, height });
      ensureOnScreen(win);
    }
  });
  createTray(win, config);

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.on('second-instance', () => {
  if (win) {
    if (!win.isVisible()) win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopCollector();
});
