const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  relayUrl: '',
  readToken: '',
  pollIntervalMs: 20000,
  opacity: 1,
  alwaysOnTop: true,
  // Chromium zoom factor, 0.75-3. Every dimension in the renderer is a
  // hardcoded px, so this is the only knob that scales the gauges, the bars and
  // the text together - which is what a screen mirrored to a phone needs.
  uiScale: 1,
  viewMode: 'wide',
  // Each mode keeps its own geometry: a single tab wants a narrow column, four
  // side-by-side columns want a wide one, and switching should not destroy the
  // size the user chose for the other mode.
  // null width/height means "fill the display's work area on first run".
  wideBounds: { x: null, y: null, width: null, height: null },
  collectorAutoStart: true,
  collectorPort: 8787,
  collectorToken: '',
  windowBounds: { x: null, y: null, width: 350, height: 500 }
};

class Config {
  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'config.json');
    this.data = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        // Strip a UTF-8 BOM: Notepad and PowerShell's Set-Content write one,
        // and JSON.parse throws on it - which would otherwise quietly reset
        // every setting the moment someone hand-edited this file.
        const raw = fs.readFileSync(this.filePath, 'utf-8').replace(/^﻿/, '');
        const parsed = JSON.parse(raw);
        this.data = { ...DEFAULTS, ...parsed };
      }
    } catch {
      const bak = this.filePath + '.bak';
      try { fs.renameSync(this.filePath, bak); } catch {}
      this.data = { ...DEFAULTS };
    }
    this.save();
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch {}
  }

  get(key) {
    return key ? this.data[key] : { ...this.data };
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  getAll() {
    return { ...this.data };
  }
}

module.exports = Config;
