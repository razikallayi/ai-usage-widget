const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');

function listTranscripts(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    // Subagent usage is already attributed in the parent transcript.
    if (e.isDirectory()) {
      if (e.name !== 'subagents') listTranscripts(full, out);
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

function emptyBucket() {
  return { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function addUsage(bucket, u) {
  const i = u.input_tokens || 0;
  const o = u.output_tokens || 0;
  const cr = u.cache_read_input_tokens || 0;
  const cw = u.cache_creation_input_tokens || 0;
  bucket.in += i;
  bucket.out += o;
  bucket.cacheRead += cr;
  bucket.cacheWrite += cw;
  bucket.total += i + o + cr + cw;
}

function dayKey(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Read only the bytes appended since the last pass, stopping at the final
// newline so a half-written trailing line is re-read next cycle rather than
// silently dropped.
function readNewBytes(file, from, to) {
  const len = to - from;
  if (len <= 0) return { text: '', consumed: 0 };
  const buf = Buffer.allocUnsafe(len);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, from);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const nl = buf.lastIndexOf(0x0a);
  if (nl === -1) return { text: '', consumed: 0 };
  return { text: buf.slice(0, nl + 1).toString('utf-8'), consumed: nl + 1 };
}

function scan(cache) {
  const files = listTranscripts(PROJECTS);
  const state = cache.data.files;
  const days = cache.data.days;
  let changed = false;

  for (const file of files) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }

    const prev = state[file];
    // A shrunk file means rotation/rewrite - start over for that file.
    let offset = prev && st.size >= prev.offset ? prev.offset : 0;
    if (prev && st.size === prev.size && st.mtimeMs === prev.mtimeMs) continue;

    const { text, consumed } = readNewBytes(file, offset, st.size);
    if (consumed > 0) {
      for (const line of text.split('\n')) {
        if (!line) continue;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        const usage = rec?.message?.usage;
        if (!usage) continue;

        // Resumed sessions replay earlier messages into a new transcript, so
        // dedupe on the API message id rather than counting per line.
        const id = rec.message.id;
        if (id) {
          if (cache.seen.has(id)) continue;
          cache.seen.add(id);
        }

        const ts = Date.parse(rec.timestamp);
        const key = dayKey(Number.isFinite(ts) ? ts : st.mtimeMs);
        if (!days[key]) days[key] = emptyBucket();
        addUsage(days[key], usage);
        changed = true;
      }
      offset += consumed;
    }

    state[file] = { size: st.size, mtimeMs: st.mtimeMs, offset };
    changed = true;
  }

  if (changed) cache.markDirty();
  return days;
}

function sumSince(days, cutoffMs) {
  const acc = emptyBucket();
  for (const [key, b] of Object.entries(days)) {
    const ms = Date.parse(key + 'T00:00:00');
    if (cutoffMs !== null && (!Number.isFinite(ms) || ms < cutoffMs)) continue;
    acc.in += b.in;
    acc.out += b.out;
    acc.cacheRead += b.cacheRead;
    acc.cacheWrite += b.cacheWrite;
    acc.total += b.total;
  }
  return acc;
}

function startOfDay(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.getTime();
}

// Last 30 days of daily totals, oldest first, with gaps filled as 0 so the
// renderer can draw a sparkline without knowing the date math.
function dailySeries(days, count = 30) {
  const series = [];
  for (let i = count - 1; i >= 0; i--) {
    const key = dayKey(startOfDay(i));
    series.push(days[key]?.total || 0);
  }
  return series;
}

function collectClaudeTokens(cache) {
  const days = scan(cache);
  return {
    today: sumSince(days, startOfDay(0)),
    week: sumSince(days, startOfDay(6)),
    month: sumSince(days, startOfDay(29)),
    allTime: sumSince(days, null),
    daily: dailySeries(days),
    costUsd: null
  };
}

module.exports = { collectClaudeTokens, dayKey, startOfDay };
