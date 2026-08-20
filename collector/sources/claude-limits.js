const fs = require('fs');
const path = require('path');
const os = require('os');

const CREDENTIALS = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

// Read the OAuth access token Claude Code maintains. Never written back to:
// Claude Code owns this file and refreshes it itself, so a concurrent write
// here would clobber a live session.
function readAccessToken() {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS, 'utf-8'));
  const token = raw?.claudeAiOauth?.accessToken;
  if (!token) throw new Error('no claudeAiOauth.accessToken in .credentials.json');
  return token;
}

function secondsUntil(value) {
  if (value === null || value === undefined) return null;
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((ms - Date.now()) / 1000));
}

function windowOf(w) {
  if (!w || typeof w.utilization !== 'number') return null;
  return { pct: Math.round(w.utilization), resetsInSec: secondsUntil(w.resets_at) };
}

async function fetchClaudeLimits() {
  const token = readAccessToken();

  const res = await fetch(USAGE_URL, {
    headers: {
      'Authorization': 'Bearer ' + token,
      'anthropic-beta': 'oauth-2025-04-20',
      'Accept': 'application/json'
    },
    // Without this a hung socket sits here for undici's 300s default, which
    // stalls the whole refresh cycle behind one unreachable endpoint.
    signal: AbortSignal.timeout(12000)
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Claude token rejected - run any Claude Code command to refresh it');
  }
  if (!res.ok) {
    throw new Error('oauth/usage returned ' + res.status);
  }

  const body = await res.json();

  const out = {
    session: windowOf(body.five_hour),
    weekly: windowOf(body.seven_day),
    extra: [],
    extraUsage: null
  };

  // limits[] repeats the session/weekly_all windows already rendered above; only
  // the model-scoped entries (Opus, Fable, ...) belong in the extra rows.
  if (Array.isArray(body.limits)) {
    out.extra = body.limits
      .map(l => {
        if (typeof l.percent !== 'number') return null;
        const label = l.scope?.model?.display_name || l.scope?.surface;
        if (!label) return null;
        return {
          label: String(label),
          pct: Math.round(l.percent),
          resetsInSec: secondsUntil(l.resets_at)
        };
      })
      .filter(Boolean);
  }

  const eu = body.extra_usage;
  if (eu && eu.is_enabled && typeof eu.used_credits === 'number') {
    const places = typeof eu.decimal_places === 'number' ? eu.decimal_places : 2;
    out.extraUsage = { usedCreditsUsd: eu.used_credits / Math.pow(10, places) };
  }

  return out;
}

module.exports = { fetchClaudeLimits };
