const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;

function createTray(win, config) {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.isEmpty() ? createFallbackIcon() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('AI Usage Widget');

  function buildMenu() {
    const isVisible = win.isVisible();
    const isOnTop = config.get('alwaysOnTop');
    const currentOpacity = config.get('opacity');

    return Menu.buildFromTemplate([
      {
        label: isVisible ? 'Hide' : 'Show',
        click: () => { isVisible ? win.hide() : win.show(); }
      },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: isOnTop,
        click: (menuItem) => {
          win.setAlwaysOnTop(menuItem.checked);
          config.set('alwaysOnTop', menuItem.checked);
          win.webContents.send('always-on-top-change', menuItem.checked);
        }
      },
      { type: 'separator' },
      {
        label: 'Opacity',
        submenu: [1.0, 0.9, 0.8, 0.7, 0.5].map(val => ({
          label: `${Math.round(val * 100)}%`,
          type: 'radio',
          checked: Math.abs(currentOpacity - val) < 0.05,
          click: () => {
            win.setOpacity(val);
            config.set('opacity', val);
            win.webContents.send('opacity-change', val);
          }
        }))
      },
      { type: 'separator' },
      {
        label: 'Settings...',
        click: () => {
          win.show();
          win.webContents.send('show-settings');
        }
      },
      {
        label: 'Open Config Folder',
        click: () => {
          const { shell } = require('electron');
          shell.openPath(app.getPath('userData'));
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);
  }

  tray.on('click', () => {
    win.isVisible() ? win.hide() : win.show();
  });

  tray.on('right-click', () => {
    tray.setContextMenu(buildMenu());
    tray.popUpContextMenu();
  });

  tray.setContextMenu(buildMenu());
  return tray;
}

function createFallbackIcon() {
  // 16x16 RGBA buffer - simple gauge icon (white arc on transparent)
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = 7.5, cy = 7.5, r = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= r - 1.5 && dist <= r + 0.5) {
        const angle = Math.atan2(dy, dx);
        // Draw 270-degree arc (skip bottom 90 degrees)
        if (angle < Math.PI * 0.25 || angle > Math.PI * 0.75 || angle < 0) {
          const offset = (y * size + x) * 4;
          buf[offset] = 220;     // R
          buf[offset + 1] = 220; // G
          buf[offset + 2] = 230; // B
          buf[offset + 3] = 220; // A
        }
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

module.exports = { createTray };
