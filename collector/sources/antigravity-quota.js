const { execFile } = require('child_process');
const path = require('path');

// PowerShell is an external process with no knowledge of asar, so in a packaged
// build it cannot read this script from inside app.asar. electron-builder is
// told to unpack collector/ (see asarUnpack in electron-builder.yml); this
// rewrites the path to the real file on disk. The negative lookahead keeps it
// idempotent - the collector is normally already spawned from the unpacked
// directory, and rewriting twice yields app.asar.unpacked.unpacked. No-op when
// running from source.
const SCRIPT = path.join(__dirname, '..', 'scripts', 'find-antigravity-ls.ps1')
  .replace(/\bapp\.asar\b(?!\.unpacked)/, 'app.asar.unpacked');
const SERVICE = '/exa.language_server_pb.LanguageServerService/';

// Antigravity's Settings > Models & Usage panel is fed by the language server
// running on localhost, which already holds the real quota. Reading it there
// beats calling Google directly: no OAuth token, nothing to expire, and the
// numbers match the panel exactly.
//
// The catch is that it only exists while Antigravity is running - the port and
// CSRF token are regenerated per launch, so both are discovered each cycle.
let cachedEndpoint = null;

function findLanguageServer() {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        if (err) return reject(new Error('could not inspect Antigravity processes'));
        let parsed;
        try {
          parsed = JSON.parse(String(stdout).trim());
        } catch {
          return reject(new Error('process lookup returned unreadable output'));
        }
        if (parsed.error === 'not-running') {
          const e = new Error('Antigravity is not running');
          e.notRunning = true;
          return reject(e);
        }
        if (parsed.error || !parsed.csrfToken) {
          return reject(new Error('Antigravity language server not reachable'));
        }
        const ports = Array.isArray(parsed.ports) ? parsed.ports : [parsed.ports];
        resolve({ csrfToken: parsed.csrfToken, ports });
      }
    );
  });
}

async function rpc(endpoint, method, body = {}) {
  const res = await fetch('http://127.0.0.1:' + endpoint.port + SERVICE + method, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-codeium-csrf-token': endpoint.csrfToken
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(method + ' returned ' + res.status);
  return res.json();
}

// One of the listening ports speaks TLS and one speaks plain HTTP; try each
// until one answers rather than hardcoding an ordering that may flip.
async function resolveEndpoint() {
  if (cachedEndpoint) {
    try {
      await rpc(cachedEndpoint, 'RetrieveUserQuotaSummary');
      return cachedEndpoint;
    } catch {
      cachedEndpoint = null;
    }
  }

  const { csrfToken, ports } = await findLanguageServer();
  for (const port of ports) {
    const candidate = { port, csrfToken };
    try {
      await rpc(candidate, 'RetrieveUserQuotaSummary');
      cachedEndpoint = candidate;
      return candidate;
    } catch {
      // Wrong port (TLS listener) - try the next.
    }
  }
  throw new Error('Antigravity language server did not answer on any port');
}

function secondsUntil(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((ms - Date.now()) / 1000));
}

// remainingFraction is 0..1 of quota LEFT. Everything else in this widget is
// expressed as "used", so convert once here rather than in the renderer.
function mapBucket(bucket) {
  const remaining = typeof bucket.remainingFraction === 'number' ? bucket.remainingFraction : null;
  return {
    id: bucket.bucketId || null,
    label: bucket.window === '5h' ? '5-hour' : (bucket.window === 'weekly' ? 'Weekly' : (bucket.displayName || '')),
    window: bucket.window || null,
    usedPct: remaining == null ? null : +((1 - remaining) * 100).toFixed(1),
    remainingPct: remaining == null ? null : +(remaining * 100).toFixed(1),
    resetsInSec: secondsUntil(bucket.resetTime),
    note: bucket.description || null
  };
}

async function collectAntigravityQuota() {
  const endpoint = await resolveEndpoint();

  const [quotaRes, statusRes] = await Promise.all([
    rpc(endpoint, 'RetrieveUserQuotaSummary'),
    rpc(endpoint, 'GetUserStatus').catch(() => null)
  ]);

  const groups = (quotaRes?.response?.groups || []).map(g => ({
    name: g.displayName || '',
    models: g.description || null,
    windows: (g.buckets || []).map(mapBucket)
  }));

  if (groups.length === 0) throw new Error('quota summary contained no groups');

  // Deliberately only the plan name - GetUserStatus also carries the account
  // name and email, which this widget has no reason to hold.
  const plan = statusRes?.userStatus?.planStatus?.planInfo?.planName || null;

  return { plan, groups };
}

module.exports = { collectAntigravityQuota };
