const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');

let child = null;
let restartTimer = null;
let stopping = false;

// Mint the shared token here rather than letting the collector write it: Config
// holds config.json in memory and rewrites the whole file on every set(), so a
// token written by the child would be clobbered by the next settings change.
// Also points the poller at the local collector on first run, so the setup
// overlay never appears for the default single-machine setup.
function prepareCollectorConfig(config) {
  let token = config.get('collectorToken');
  if (!token) {
    token = crypto.randomUUID();
    config.set('collectorToken', token);
  }

  const port = config.get('collectorPort') || 8787;
  if (config.get('collectorAutoStart') !== false && !config.get('relayUrl')) {
    config.set('relayUrl', 'http://127.0.0.1:' + port);
    config.set('readToken', token);
  }

  return token;
}

// Run collector/index.js on Electron's bundled Node so no separate Node install
// is needed. ELECTRON_RUN_AS_NODE is the same switch launch.js has to scrub -
// here we deliberately set it, since this child IS meant to be plain Node.
function startCollector(config) {
  const token = prepareCollectorConfig(config);
  if (child || config.get('collectorAutoStart') === false) return;

  // Point at the unpacked copy in a packaged build: the collector shells out to
  // a PowerShell script that cannot be read from inside app.asar, so the whole
  // directory is unpacked and the child must resolve to the same real files.
  // No-op when running from source.
  const entry = path.join(__dirname, '..', '..', 'collector', 'index.js')
    .replace(/\bapp\.asar\b(?!\.unpacked)/, 'app.asar.unpacked');
  // NODE_NO_WARNINGS silences the node:sqlite ExperimentalWarning that the
  // Antigravity source triggers on Electron's Node 22.
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_NO_WARNINGS: '1' };
  env.COLLECTOR_PORT = String(config.get('collectorPort') || 8787);
  env.COLLECTOR_TOKEN = token;

  child = spawn(process.execPath, [entry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  child.stdout.on('data', d => process.stdout.write('[collector] ' + d));
  child.stderr.on('data', d => process.stderr.write('[collector] ' + d));
  child.on('error', err => {
    console.error('[collector] failed to spawn:', err.message);
    child = null;
  });
  // A dead collector would otherwise leave the widget permanently blank, since
  // the renderer only knows how to retry the HTTP poll.
  child.on('exit', () => {
    child = null;
    if (stopping) return;
    restartTimer = setTimeout(() => startCollector(config), 3000);
  });
}

function stopCollector() {
  stopping = true;
  clearTimeout(restartTimer);
  if (!child) return;
  child.kill();
  child = null;
}

module.exports = { startCollector, stopCollector };
