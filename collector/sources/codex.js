const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

// sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl - the layout sorts lexically,
// so walking it in reverse finds the newest rollout without stat-ing every file.
function newestRollouts(limit = 5) {
  const found = [];

  const descend = (dir, depth) => {
    if (found.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    for (const e of entries) {
      if (found.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 3) descend(full, depth + 1);
      } else if (e.name.endsWith('.jsonl')) {
        found.push(full);
      }
    }
  };

  descend(SESSIONS, 0);
  return found;
}

// The newest token_count event carries both the rate-limit windows and the
// session's cumulative token usage, so one backwards scan gets everything.
function lastTokenCount(file) {
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf-8').split('\n');
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('rate_limits')) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = rec?.payload || rec;
    const rl = payload?.rate_limits;
    if (rl) return { rateLimits: rl, info: payload?.info || null };
  }
  return null;
}

// Every rollout file, not just the newest. Used to build the token history.
function allRollouts(dir = SESSIONS, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) allRollouts(full, out);
    else if (e.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function emptyTotals() {
  return { in: 0, cached: 0, out: 0, reasoning: 0, total: 0 };
}

function addTotals(target, usage) {
  target.in += usage.input_tokens || 0;
  target.cached += usage.cached_input_tokens || 0;
  target.out += usage.output_tokens || 0;
  target.reasoning += usage.reasoning_output_tokens || 0;
  target.total += usage.total_tokens || 0;
}

// sessions/YYYY/MM/DD/rollout-... - the date comes from the path rather than
// from parsing timestamps out of the file.
function dateFromPath(file) {
  const m = file.replace(/\\/g, '/').match(/sessions\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// total_token_usage is cumulative per session, so only the final event counts -
// summing every event would multiply a long session many times over.
function collectCodexHistory(cache) {
  const state = cache?.data?.codexFiles || {};
  const files = allRollouts();
  let changed = false;

  for (const file of files) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    const prev = state[file];
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue;

    const found = lastTokenCount(file);
    const usage = found?.info?.total_token_usage;
    state[file] = {
      size: st.size,
      mtimeMs: st.mtimeMs,
      date: dateFromPath(file),
      totals: usage
        ? {
            in: usage.input_tokens || 0,
            cached: usage.cached_input_tokens || 0,
            out: usage.output_tokens || 0,
            reasoning: usage.reasoning_output_tokens || 0,
            total: usage.total_tokens || 0
          }
        : null
    };
    changed = true;
  }

  // Forget sessions that have been deleted from disk.
  const present = new Set(files);
  for (const key of Object.keys(state)) {
    if (!present.has(key)) {
      delete state[key];
      changed = true;
    }
  }
  if (changed && cache) cache.markDirty();

  const byDay = {};
  let sessions = 0;
  for (const entry of Object.values(state)) {
    if (!entry.date || !entry.totals) continue;
    sessions++;
    if (!byDay[entry.date]) byDay[entry.date] = emptyTotals();
    const d = byDay[entry.date];
    d.in += entry.totals.in;
    d.cached += entry.totals.cached;
    d.out += entry.totals.out;
    d.reasoning += entry.totals.reasoning;
    d.total += entry.totals.total;
  }

  const startOfDay = (offset) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - offset);
    return d.getTime();
  };
  const key = (ms) => {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  const sumSince = (cutoff) => {
    const acc = emptyTotals();
    for (const [day, t] of Object.entries(byDay)) {
      const ms = Date.parse(day + 'T00:00:00');
      if (cutoff !== null && (!Number.isFinite(ms) || ms < cutoff)) continue;
      acc.in += t.in; acc.cached += t.cached; acc.out += t.out;
      acc.reasoning += t.reasoning; acc.total += t.total;
    }
    return acc;
  };

  const daily = [];
  for (let i = 29; i >= 0; i--) daily.push(byDay[key(startOfDay(i))]?.total || 0);

  return {
    today: sumSince(startOfDay(0)),
    week: sumSince(startOfDay(6)),
    month: sumSince(startOfDay(29)),
    allTime: sumSince(null),
    daily,
    sessions
  };
}

function secondsUntil(epochSec) {
  if (typeof epochSec !== 'number') return null;
  return Math.max(0, Math.round(epochSec - Date.now() / 1000));
}

// Bucket by window_minutes, not by position: on some plans `primary` is the
// weekly (43200 min) window, so a positional mapping would mislabel it.
function collectCodex(cache) {
  let found = null;
  let source = null;
  for (const file of newestRollouts()) {
    found = lastTokenCount(file);
    if (found) {
      source = file;
      break;
    }
  }
  if (!found) throw new Error('no rate_limits found in recent Codex sessions');

  const rl = found.rateLimits;

  const out = { fiveHour: null, weekly: null, plan: rl.plan_type || null };

  for (const w of [rl.primary, rl.secondary]) {
    if (!w || typeof w.used_percent !== 'number') continue;
    const entry = {
      pct: Math.round(w.used_percent),
      resetsInSec: secondsUntil(w.resets_at)
    };
    if (typeof w.window_minutes === 'number' && w.window_minutes <= 360) {
      out.fiveHour = entry;
    } else {
      out.weekly = entry;
    }
  }

  let ageSec = null;
  try {
    ageSec = Math.round((Date.now() - fs.statSync(source).mtimeMs) / 1000);
  } catch {}

  // Cumulative totals for the most recent session only - Codex does not keep a
  // running cross-session tally the way the Claude transcripts allow.
  const usage = found.info?.total_token_usage;
  const tokens = usage ? {
    in: usage.input_tokens || 0,
    cached: usage.cached_input_tokens || 0,
    cacheWrite: usage.cache_write_input_tokens || 0,
    out: usage.output_tokens || 0,
    reasoning: usage.reasoning_output_tokens || 0,
    total: usage.total_tokens || 0,
    contextWindow: found.info?.model_context_window || null
  } : null;

  // History across every session, so Codex gets the same token trend the
  // Claude tab has rather than only the latest session's figures.
  let history = null;
  try {
    history = collectCodexHistory(cache);
  } catch {
    // A history failure must not take down the live rate-limit numbers.
  }

  return { limits: out, tokens, history, ageSec };
}

module.exports = { collectCodex };
