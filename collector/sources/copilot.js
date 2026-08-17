const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const QUOTA_URL = 'https://api.github.com/copilot_internal/user';

// winget installs gh without adding it to an already-open shell's PATH, so fall
// back to the standard install locations before giving up.
function ghPath() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe')
      ]
    : ['/usr/local/bin/gh', '/opt/homebrew/bin/gh', path.join(os.homedir(), '.local', 'bin', 'gh')];

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {}
  }
  return 'gh';
}

function ghToken() {
  return new Promise((resolve, reject) => {
    execFile(ghPath(), ['auth', 'token'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) {
        reject(new Error(
          err.code === 'ENOENT'
            ? 'GitHub CLI not found - install it and run `gh auth login`'
            : 'not logged in - run `gh auth login`'
        ));
        return;
      }
      const token = String(stdout).trim();
      if (!token) reject(new Error('gh auth token returned nothing'));
      else resolve(token);
    });
  });
}

function secondsUntil(value) {
  if (!value) return null;
  // quota_reset_date is a bare YYYY-MM-DD; anchor it to UTC midnight.
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value + 'T00:00:00Z') : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((ms - Date.now()) / 1000));
}

function readSnapshot(snap) {
  if (!snap) return null;
  const included = typeof snap.entitlement === 'number' ? snap.entitlement : null;
  const remaining = typeof snap.remaining === 'number' ? snap.remaining : null;
  const pctRemaining = typeof snap.percent_remaining === 'number' ? snap.percent_remaining : null;

  return {
    // An unlimited quota reports entitlement 0, which would otherwise render as
    // "0 of 0" - the flag is what the UI keys off instead.
    unlimited: snap.unlimited === true,
    used: included !== null && remaining !== null ? Math.round(included - remaining) : null,
    included,
    remaining,
    pctUsed: pctRemaining !== null ? +(100 - pctRemaining).toFixed(1) : null,
    creditsUsed: typeof snap.credits_used === 'number' ? snap.credits_used : null,
    overageCount: typeof snap.overage_count === 'number' ? snap.overage_count : null,
    overagePermitted: snap.overage_permitted === true
  };
}

const { dayKey, startOfDay } = require('./claude-tokens');

// GitHub reports a running total, not a per-day figure, so the trend has to be
// derived: keep the highest count seen each day and difference consecutive
// days. Days when the widget was closed carry the previous total forward, and
// a drop means the monthly quota reset rather than negative usage.
function recordTrend(cache, used, resetsInSec) {
  if (!cache || used == null) return null;

  const store = cache.data.copilot || (cache.data.copilot = {});
  const days = store.days || (store.days = {});
  const today = dayKey(Date.now());
  const prior = days[today];
  if (prior == null || used > prior) {
    days[today] = used;
    cache.markDirty();
  }

  // Trim anything older than the window we display.
  const cutoff = startOfDay(40);
  for (const key of Object.keys(days)) {
    const ms = Date.parse(key + 'T00:00:00');
    if (Number.isFinite(ms) && ms < cutoff) {
      delete days[key];
      cache.markDirty();
    }
  }

  const series = [];
  let carried = null;
  for (let i = 29; i >= 0; i--) {
    const key = dayKey(startOfDay(i));
    const total = days[key];
    if (total != null) {
      // A lower total than yesterday means the billing period rolled over.
      series.push(carried == null || total < carried ? 0 : total - carried);
      carried = total;
    } else {
      series.push(0);
    }
  }

  const recent = series.slice(-7);
  const observed = recent.filter((_, i) => {
    const key = dayKey(startOfDay(6 - i));
    return days[key] != null;
  }).length;

  // Averaging over days we actually observed avoids a closed laptop looking
  // like zero usage and halving the projection.
  const perDay = observed > 0
    ? +(recent.reduce((a, b) => a + b, 0) / observed).toFixed(1)
    : null;

  const daysToReset = resetsInSec != null ? Math.max(0, Math.ceil(resetsInSec / 86400)) : null;
  const projected = perDay != null && daysToReset != null
    ? Math.round(used + perDay * daysToReset)
    : null;

  return { daily: series, perDay, projected, daysToReset, observedDays: observed };
}

// copilot_internal/user is undocumented and may change without notice, so any
// shape mismatch is a soft failure that only nulls out the Copilot tab.
async function collectCopilot(cache) {
  const token = await ghToken();

  const res = await fetch(QUOTA_URL, {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json',
      'User-Agent': 'usage-widget'
    }
  });

  if (!res.ok) throw new Error('copilot_internal/user returned ' + res.status);

  const body = await res.json();
  const snaps = body?.quota_snapshots;
  const premium = readSnapshot(snaps?.premium_interactions);
  if (!premium) throw new Error('no premium_interactions quota in response');

  const resetsInSec = secondsUntil(body.quota_reset_date_utc || body.quota_reset_date);

  return {
    // Flattened premium fields stay at the top level for the existing gauge.
    ...premium,
    trend: recordTrend(cache, premium.used, resetsInSec),
    chat: readSnapshot(snaps?.chat),
    completions: readSnapshot(snaps?.completions),
    resetsInSec,
    resetDate: body.quota_reset_date || null,
    tokenBasedBilling: body.token_based_billing === true,
    login: body.login || null,
    plan: body.copilot_plan || body.access_type_sku || null
  };
}

module.exports = { collectCopilot, recordTrend };
