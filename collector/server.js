const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { Cache, userDataDir } = require('./cache');
const { fetchClaudeLimits } = require('./sources/claude-limits');
const { collectClaudeTokens } = require('./sources/claude-tokens');
const { collectCodex } = require('./sources/codex');
const { collectCopilot } = require('./sources/copilot');
const { collectAntigravity } = require('./sources/antigravity');
const { collectAntigravityQuota } = require('./sources/antigravity-quota');

const CONFIG_PATH = path.join(userDataDir(), 'config.json');

// Share the widget's config file so the token only ever has to exist in one
// place; generate one on first run rather than making the user invent it.
function resolveToken() {
  // When Electron spawns us it mints the token itself and passes it down, since
  // it owns config.json and would otherwise overwrite anything we write here.
  if (process.env.COLLECTOR_TOKEN) {
    return { token: process.env.COLLECTOR_TOKEN, generated: false };
  }

  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {}

  if (config.collectorToken) return { token: config.collectorToken, generated: false };

  const token = crypto.randomUUID();
  config.collectorToken = token;
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('could not persist collectorToken:', err.message);
  }
  return { token, generated: true };
}

function ageSec(at) {
  return at ? Math.round((Date.now() - at) / 1000) : null;
}

class Collector {
  constructor({ port = 8787, refreshMs = 30000 } = {}) {
    this.port = port;
    this.refreshMs = refreshMs;
    this.cache = new Cache();
    this.server = null;
    this.timer = null;

    // minMs throttles each source independently. The local file scans are
    // nearly free, but the two HTTP endpoints are rate limited - Anthropic's
    // oauth/usage in particular answers 429 well below a 30s cadence. The
    // windows these report move over hours, so polling them slowly costs
    // nothing in accuracy.
    // persist: survive a collector restart. Only the rate-limited HTTP sources
    // need it - the local file scans re-derive their values in milliseconds.
    this.state = {
      claudeLimits: { value: null, at: null, tried: 0, minMs: 120000, backoffMs: 0, persist: true },
      claudeTokens: { value: null, at: null, tried: 0, minMs: 30000, backoffMs: 0 },
      codex: { value: null, at: null, tried: 0, minMs: 30000, backoffMs: 0, sourceAgeSec: null },
      copilot: { value: null, at: null, tried: 0, minMs: 300000, backoffMs: 0, persist: true },
      antigravity: { value: null, at: null, tried: 0, minMs: 60000, backoffMs: 0 },
      antigravityQuota: { value: null, at: null, tried: 0, minMs: 120000, backoffMs: 0 }
    };
    this.warnings = [];
    this.restoreSnapshots();
  }

  // Without this every restart blanked the Claude gauge and immediately re-hit
  // an endpoint that 429s, so a few restarts in a row guaranteed an empty tab.
  // Restoring `tried` alongside the value also means a restart no longer earns
  // a free extra request.
  restoreSnapshots() {
    const saved = this.cache.data.snapshots || {};
    for (const [key, slot] of Object.entries(this.state)) {
      if (!slot.persist) continue;
      const snap = saved[key];
      if (!snap || snap.value == null || !snap.at) continue;
      slot.value = snap.value;
      slot.at = snap.at;
      slot.tried = snap.at;
    }
  }

  async refresh() {
    const warnings = [];
    const now = Date.now();

    // key indexes this.state; name is what the user sees in warnings[].
    const run = async (name, key, fn) => {
      const slot = this.state[key];
      const wait = slot.backoffMs || slot.minMs;
      if (slot.tried && now - slot.tried < wait) return;
      slot.tried = now;
      try {
        const value = await fn();
        slot.value = value;
        slot.at = Date.now();
        slot.backoffMs = 0;
        slot.error = null;
        slot.reconnect = false;
        if (slot.persist) {
          const snaps = this.cache.data.snapshots || (this.cache.data.snapshots = {});
          snaps[key] = { value, at: slot.at };
          this.cache.markDirty();
        }
      } catch (err) {
        // The last good value is deliberately kept: a transient failure should
        // make the section age, not blank out. Rate limits back off
        // exponentially so a throttled endpoint is not hammered further.
        warnings.push(name + ': ' + err.message);
        // Surfaced to the UI so it can say what to do about it, rather than
        // just showing an empty panel.
        slot.error = err.message;
        slot.reconnect = !!err.reconnect;
        if (/\b429\b/.test(err.message)) {
          slot.backoffMs = Math.min((slot.backoffMs || slot.minMs) * 2, 900000);
        }
      }
    };

    await Promise.all([
      run('claude.limits', 'claudeLimits', () => fetchClaudeLimits()),
      run('claude.tokens', 'claudeTokens', async () => collectClaudeTokens(this.cache)),
      run('codex', 'codex', async () => {
        const { limits, tokens, history, ageSec: srcAge } = collectCodex(this.cache);
        this.state.codex.sourceAgeSec = srcAge;
        return { ...limits, tokens, history };
      }),
      run('copilot', 'copilot', () => collectCopilot(this.cache)),
      run('antigravity', 'antigravity', async () => collectAntigravity(this.cache)),
      run('antigravity.quota', 'antigravityQuota', () => collectAntigravityQuota())
    ]);

    this.warnings = warnings;
    this.cache.flush();
  }

  // Mirrors the shape in src/renderer/scripts/pages/demo.js, which is the
  // contract the three page renderers were written against.
  snapshot() {
    const s = this.state;
    const claudeAge = ageSec(s.claudeLimits.at ?? s.claudeTokens.at);

    return {
      v: 1,
      serverTime: new Date().toISOString(),
      machines: [{ id: os.hostname(), ageSec: claudeAge ?? 0 }],
      claude: {
        limits: s.claudeLimits.value
          ? { ageSec: ageSec(s.claudeLimits.at), ...s.claudeLimits.value }
          : null,
        tokens: s.claudeTokens.value
          ? { ageSec: ageSec(s.claudeTokens.at), ...s.claudeTokens.value }
          : null
      },
      // ageSec is collector freshness (how healthy the pipeline is);
      // sessionAgeSec is how long ago Codex itself was last used. Conflating
      // them made an idle-for-weeks Codex look like a broken collector.
      codex: {
        limits: s.codex.value
          ? {
              ageSec: ageSec(s.codex.at),
              sessionAgeSec: s.codex.sourceAgeSec ?? null,
              ...s.codex.value,
              tokens: undefined,
              history: undefined
            }
          : null,
        tokens: s.codex.value?.tokens
          ? { ageSec: ageSec(s.codex.at), sessionAgeSec: s.codex.sourceAgeSec ?? null, ...s.codex.value.tokens }
          : null,
        history: s.codex.value?.history
          ? { ageSec: ageSec(s.codex.at), ...s.codex.value.history }
          : null
      },
      copilot: {
        quota: s.copilot.value
          ? { ageSec: ageSec(s.copilot.at), ...s.copilot.value }
          : null
      },
      antigravity: {
        activity: s.antigravity.value
          ? { ageSec: ageSec(s.antigravity.at), ...s.antigravity.value }
          : null,
        quota: s.antigravityQuota.value
          ? { ageSec: ageSec(s.antigravityQuota.at), ...s.antigravityQuota.value }
          : null,
        // Lets the tab explain itself in one line instead of showing a blank
        // area or implying the whole source is broken.
        quotaState: s.antigravityQuota.value ? 'ok' : 'unavailable',
        quotaMessage: s.antigravityQuota.value ? null : (s.antigravityQuota.error || null)
      },
      warnings: this.warnings
    };
  }

  handle(req, res, token) {
    const url = (req.url || '').split('?')[0];

    if (url === '/health') {
      // Per-source timing is the only way to tell "throttled" apart from
      // "failing" - both look like a null section from the outside.
      const now = Date.now();
      const sources = {};
      for (const [key, slot] of Object.entries(this.state)) {
        sources[key] = {
          hasValue: slot.value != null,
          lastOkSec: slot.at ? Math.round((now - slot.at) / 1000) : null,
          lastTrySec: slot.tried ? Math.round((now - slot.tried) / 1000) : null,
          minSec: slot.minMs / 1000,
          backoffSec: slot.backoffMs ? slot.backoffMs / 1000 : 0,
          // Survives the throttle window, unlike warnings[] which is rebuilt
          // each refresh and is empty while a source is merely backing off.
          lastError: slot.error || null
        };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sources, warnings: this.warnings }));
      return;
    }

    if (url !== '/v1/summary') {
      res.writeHead(404).end();
      return;
    }

    const auth = req.headers['authorization'] || '';
    const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const a = Buffer.from(supplied);
    const b = Buffer.from(token);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(this.snapshot()));
  }

  async start() {
    const { token, generated } = resolveToken();

    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch(err => console.error('refresh failed:', err.message));
    }, this.refreshMs);

    this.server = http.createServer((req, res) => this.handle(req, res, token));

    try {
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        // Loopback only - this exposes personal usage data and must never be
        // reachable from the network.
        this.server.listen(this.port, '127.0.0.1', resolve);
      });
    } catch (err) {
      // Leave no live handles behind, or the caller's process.exit trips an
      // assertion in libuv while the refresh timer is still armed.
      clearInterval(this.timer);
      this.timer = null;
      this.server = null;
      throw err;
    }

    return { token, generated, url: 'http://127.0.0.1:' + this.port };
  }

  stop() {
    clearInterval(this.timer);
    this.cache.flush(true);
    if (this.server) this.server.close();
  }
}

module.exports = { Collector };
