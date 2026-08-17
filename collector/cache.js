const fs = require('fs');
const path = require('path');
const os = require('os');

function userDataDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'usage-widget');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'usage-widget');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'usage-widget');
}

const EMPTY = { files: {}, days: {}, seen: [], ag: {}, copilot: {}, snapshots: {}, codexFiles: {} };

// Persistent scan state for the Claude transcript walker. Kept in memory and
// flushed at most once every FLUSH_MS so a 30s refresh loop does not rewrite a
// multi-megabyte JSON file every cycle.
class Cache {
  constructor(fileName = 'collector-cache.json') {
    this.dir = userDataDir();
    this.filePath = path.join(this.dir, fileName);
    this.data = { ...EMPTY };
    this.dirty = false;
    this.lastFlush = 0;
    this.flushMs = 120000;
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      this.data = {
        files: parsed.files || {},
        days: parsed.days || {},
        seen: Array.isArray(parsed.seen) ? parsed.seen : [],
        ag: parsed.ag || {},
        copilot: parsed.copilot || {},
        snapshots: parsed.snapshots || {},
        codexFiles: parsed.codexFiles || {}
      };
    } catch {
      this.data = { files: {}, days: {}, seen: [], ag: {}, copilot: {}, snapshots: {}, codexFiles: {} };
    }
    this.seen = new Set(this.data.seen);
  }

  markDirty() {
    this.dirty = true;
  }

  flush(force = false) {
    if (!this.dirty) return;
    if (!force && Date.now() - this.lastFlush < this.flushMs) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.data.seen = [...this.seen];
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf-8');
      fs.renameSync(tmp, this.filePath);
      this.dirty = false;
      this.lastFlush = Date.now();
    } catch {}
  }

  reset() {
    this.data = { files: {}, days: {}, seen: [], ag: {}, copilot: {}, snapshots: {}, codexFiles: {} };
    this.seen = new Set();
    this.markDirty();
  }
}

module.exports = { Cache, userDataDir };
