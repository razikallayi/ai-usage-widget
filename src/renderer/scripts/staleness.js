class StalenessTracker {
  constructor() {
    this.sections = new Map();
    this.thresholds = new Map();
    this.lastFetchTime = null;
  }

  // Sources refresh at very different rates upstream - the rate-limited HTTP
  // endpoints are polled minutes apart, the local file scans every 30s - so
  // "stale" has to be judged per section rather than against one global rule.
  updateSection(id, ageSec, thresholds) {
    this.sections.set(id, ageSec);
    if (thresholds) this.thresholds.set(id, thresholds);
    this.lastFetchTime = Date.now();
  }

  getTotalAge(id) {
    const ageSec = this.sections.get(id);
    if (ageSec == null || !this.lastFetchTime) return null;
    const elapsed = (Date.now() - this.lastFetchTime) / 1000;
    return ageSec + elapsed;
  }

  getLevel(id) {
    const total = this.getTotalAge(id);
    if (total == null) return 'unknown';
    const { good = 90, warn = 300 } = this.thresholds.get(id) || {};
    if (total < good) return 'good';
    if (total < warn) return 'warn';
    return 'bad';
  }

  getWorstLevel() {
    if (this.sections.size === 0) return 'unknown';
    const levels = ['good', 'warn', 'bad'];
    let worst = 0;
    for (const [id] of this.sections) {
      const level = this.getLevel(id);
      const idx = levels.indexOf(level);
      if (idx > worst) worst = idx;
    }
    return levels[worst];
  }

  getFooterText(id) {
    const total = this.getTotalAge(id);
    if (total == null) return '';
    return 'as of ' + window.fmt.age(total) + ' ago';
  }

  clear() {
    this.sections.clear();
    this.thresholds.clear();
    this.lastFetchTime = null;
  }
}

window.StalenessTracker = StalenessTracker;
