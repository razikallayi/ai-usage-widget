const fs = require('fs');
const path = require('path');
const os = require('os');

const CONVERSATIONS = path.join(os.homedir(), '.gemini', 'antigravity', 'conversations');

// Antigravity keeps its credentials in Electron safeStorage (DPAPI on Windows),
// so its server-side quota API is out of reach. What IS readable is the local
// conversation store: plain SQLite, one .db per conversation. That gives real
// activity counts - agent steps over time - but no percentage of any limit.
function loadSqlite() {
  try {
    return require('node:sqlite');
  } catch {
    throw new Error('node:sqlite unavailable - needs Node 22.5+');
  }
}

function readVarint(buf, i) {
  let result = 0n;
  let shift = 0n;
  while (i < buf.length) {
    const byte = buf[i++];
    result |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7n;
  }
  return [Number(result), i];
}

// steps.metadata is an opaque protobuf, but its first field is a submessage
// whose own first field is a google.protobuf.Timestamp `seconds` varint.
// Verified: 795/795 steps decoded across every local DB, and the newest
// decoded value matched each file's mtime to the minute.
function stepSeconds(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0x0a) return null;
  const [len, i] = readVarint(buf, 1);
  const sub = buf.subarray(i, i + len);
  if (sub[0] !== 0x08) return null;
  const [seconds] = readVarint(sub, 1);
  // Reject anything outside a plausible epoch-seconds range rather than
  // trusting a mis-parse.
  if (seconds < 1600000000 || seconds > 2200000000) return null;
  return seconds;
}

function dayKey(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function scanDb(DatabaseSync, file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('select metadata from steps').all();
    const days = {};
    let steps = 0;
    let last = 0;
    for (const row of rows) {
      const seconds = stepSeconds(row.metadata && Buffer.from(row.metadata));
      if (!seconds) continue;
      steps++;
      if (seconds > last) last = seconds;
      const key = dayKey(seconds * 1000);
      days[key] = (days[key] || 0) + 1;
    }
    return { steps, days, last };
  } finally {
    db.close();
  }
}

function startOfDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.getTime();
}

function sumSince(days, cutoffMs) {
  let total = 0;
  for (const [key, count] of Object.entries(days)) {
    const ms = Date.parse(key + 'T00:00:00');
    if (cutoffMs !== null && (!Number.isFinite(ms) || ms < cutoffMs)) continue;
    total += count;
  }
  return total;
}

function collectAntigravity(cache) {
  const { DatabaseSync } = loadSqlite();

  let entries;
  try {
    entries = fs.readdirSync(CONVERSATIONS).filter(f => f.endsWith('.db'));
  } catch {
    throw new Error('no Antigravity conversation store at ' + CONVERSATIONS);
  }
  if (entries.length === 0) throw new Error('no Antigravity conversations yet');

  const state = cache.data.ag;
  const merged = {};
  let lastSeconds = 0;
  let totalSteps = 0;
  let changed = false;

  for (const name of entries) {
    const file = path.join(CONVERSATIONS, name);
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }

    // A conversation DB only changes while that conversation is active, so an
    // unchanged mtime means the cached per-day counts are still exact.
    let entry = state[file];
    if (!entry || entry.mtimeMs !== st.mtimeMs) {
      try {
        const scanned = scanDb(DatabaseSync, file);
        entry = { mtimeMs: st.mtimeMs, ...scanned };
        state[file] = entry;
        changed = true;
      } catch {
        continue;
      }
    }

    totalSteps += entry.steps;
    if (entry.last > lastSeconds) lastSeconds = entry.last;
    for (const [key, count] of Object.entries(entry.days)) {
      merged[key] = (merged[key] || 0) + count;
    }
  }

  // Drop cache entries for conversations that have been deleted.
  for (const key of Object.keys(state)) {
    if (!entries.includes(path.basename(key))) {
      delete state[key];
      changed = true;
    }
  }

  if (changed) cache.markDirty();

  const weekCutoff = startOfDay(6);
  const activeWeek = Object.values(state)
    .filter(e => e.last * 1000 >= weekCutoff).length;

  return {
    stepsToday: sumSince(merged, startOfDay(0)),
    stepsWeek: sumSince(merged, weekCutoff),
    stepsMonth: sumSince(merged, startOfDay(29)),
    stepsTotal: totalSteps,
    conversations: entries.length,
    conversationsWeek: activeWeek,
    lastActiveSec: lastSeconds ? Math.max(0, Math.round(Date.now() / 1000 - lastSeconds)) : null,
    days: merged
  };
}

module.exports = { collectAntigravity };
