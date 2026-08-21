const { app, BrowserWindow, screen, powerMonitor } = require('electron');
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

// The window's minimum size in DIP at scale 1. Kept here because the minimum
// has to be recomputed every time the UI scale changes - see applyUiScale.
const MIN_W = 280;
const MIN_H = 400;
const SCALE_MIN = 0.75;
const SCALE_MAX = 3;

// Which config key holds the geometry for a given view mode.
function boundsKey(mode) {
  return mode === 'wide' ? 'wideBounds' : 'windowBounds';
}

function clampScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, n));
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

// Everything in the renderer is a hardcoded CSS px, and the gauge and sparkline
// are viewBox-driven SVGs with no width/height attributes, so a Chromium zoom
// scales the entire UI uniformly - text, arcs, bars and padding alike. That is
// far less invasive than converting ~140 px declarations to rem, and unlike rem
// it actually reaches the SVGs and ProgressBar's inline pixel heights.
function applyUiScale(value, { persist = true } = {}) {
  const scale = clampScale(value);
  if (!win || win.isDestroyed()) return scale;

  if (!win.webContents.isDestroyed()) {
    win.webContents.setZoomFactor(scale);
  }

  // minWidth/minHeight are DIP and are NOT zoom-aware: at 2x a 280 DIP window
  // leaves only 140 CSS px of content, well under the 230px wide-mode column
  // floor, so the layout could be dragged into collapse.
  //
  // But the scaled minimum must never exceed the screen the window is on, or it
  // becomes the bug it was meant to prevent: on a 636 DIP portrait display, a
  // 2.5x scale would force a 700 DIP minimum width and shove the right-hand
  // edge - and every value aligned to it - back off the screen.
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  win.setMinimumSize(
    Math.min(Math.round(MIN_W * scale), area.width),
    Math.min(Math.round(MIN_H * scale), area.height)
  );

  if (persist) config.set('uiScale', scale);
  if (!win.webContents.isDestroyed()) {
    win.webContents.send('ui-scale-change', scale);
  }
  return scale;
}

// Write the current geometry against the active mode, now, with no debounce.
// The debounced saver is driven by the 'resized'/'moved' events, and neither
// fires for a programmatic setBounds on Windows - so every geometry change made
// in code has to persist itself or it is silently lost on the next restart.
function persistBounds() {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  config.set(boundsKey(viewMode), { x: b.x, y: b.y, width: b.width, height: b.height });
}

// Make the window exactly cover the display it is currently on. The point of
// this is an external display the widget was not sized for - a phone over
// spacedesk - where the saved geometry is simply wider than the screen.
function fitToDisplay() {
  if (!win || win.isDestroyed()) return;
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  win.setBounds({ x: area.x, y: area.y, width: area.width, height: area.height });
  persistBounds();
}

// Tell the renderer to fetch now rather than on its own schedule. Safe to call
// often - ApiPoller.fetchOnce() self-guards against overlapping requests.
function wake() {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('widget:wake');
  }
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
    minWidth: MIN_W,
    minHeight: MIN_H,
    // Wide mode puts four full-detail columns side by side, which needs far
    // more room than the old 600px cap allowed. The height cap has to clear a
    // portrait external display too - a phone over spacedesk is ~2700px tall,
    // and a 1600 cap silently made "fit to this display" look broken.
    maxWidth: 2400,
    maxHeight: 4000,
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
      // Load-bearing. This widget hides to the tray on close AND on minimize,
      // and Chromium throttles a hidden page's timers to ~1/min after five
      // minutes, then freezes the page outright. ApiPoller's setInterval is the
      // only thing driving fetches, so without this the widget silently stops
      // updating whenever it has been out of sight for a while.
      backgroundThrottling: false,
    }
  });

  win.setOpacity(config.get('opacity'));

  ensureOnScreen(win);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Applied here rather than via webPreferences.zoomFactor: that is stored per
  // origin and is not reliably re-applied to a file:// load, so a reload would
  // silently drop back to 100%. persist:false - this is restoring the saved
  // value, not choosing a new one.
  win.webContents.on('did-finish-load', () => {
    applyUiScale(config.get('uiScale'), { persist: false });
  });

  // Ctrl +/-/0. before-input-event is the right hook for a frameless window
  // with no menu, and it only fires while the widget is focused - globalShortcut
  // would take these keys away from every other app on the machine.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;

    const current = clampScale(config.get('uiScale'));
    let next;
    if (input.key === '=' || input.key === '+') next = current + 0.25;
    else if (input.key === '-' || input.key === '_') next = current - 0.25;
    else if (input.key === '0') next = 1;
    else return;

    event.preventDefault();
    applyUiScale(next);
  });

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

  // Push-based catch-up. Even with backgroundThrottling off, a machine that
  // slept has a real gap in its timeline, and the renderer should not wait out
  // a whole poll interval before showing current numbers.
  win.on('show', wake);
  win.on('restore', wake);
  win.on('focus', wake);

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
    },
    applyUiScale,
    fitToDisplay
  });
  createTray(win, config, { applyUiScale, fitToDisplay });

  // Plugging in a display is exactly when a window sized for another screen
  // becomes too wide for the one it is on, and nothing re-clamped it before:
  // ensureOnScreen only ran at startup and on a view-mode switch.
  const reclamp = () => {
    if (!win || win.isDestroyed()) return;
    ensureOnScreen(win);
    // Same reason as above: ensureOnScreen moves the window with setBounds, so
    // without this the corrected geometry never reaches config.json.
    persistBounds();
  };
  screen.on('display-added', reclamp);
  screen.on('display-removed', reclamp);
  screen.on('display-metrics-changed', reclamp);

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

app.whenReady().then(() => {
  createWindow();
  // Sleep and screen-lock are the two gaps no in-page timer can cover.
  powerMonitor.on('resume', wake);
  powerMonitor.on('unlock-screen', wake);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopCollector();
});
