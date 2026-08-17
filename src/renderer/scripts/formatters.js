function fmtCompact(n) {
  if (n == null) return '--';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

function fmtCost(usd) {
  if (usd == null) return '--';
  if (usd >= 100) return '$' + Math.round(usd).toLocaleString();
  return '$' + usd.toFixed(2);
}

function fmtCountdown(seconds) {
  if (seconds == null || seconds <= 0) return 'now';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm';
  return '< 1m';
}

function fmtAge(seconds) {
  if (seconds == null) return '--';
  if (seconds < 60) return Math.round(seconds) + 's';
  if (seconds < 3600) return Math.round(seconds / 60) + 'm';
  return Math.round(seconds / 3600) + 'h';
}

function fmtPct(pct) {
  if (pct == null) return '--';
  return Math.round(pct) + '%';
}

window.fmt = { compact: fmtCompact, cost: fmtCost, countdown: fmtCountdown, age: fmtAge, pct: fmtPct };
