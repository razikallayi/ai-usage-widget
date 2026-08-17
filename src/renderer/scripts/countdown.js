class CountdownManager {
  constructor() {
    this.timers = new Map();
  }

  set(id, resetsInSec) {
    if (resetsInSec == null) {
      this.timers.delete(id);
      return;
    }
    this.timers.set(id, {
      baseValue: resetsInSec,
      fetchTime: Date.now()
    });
  }

  getCurrent(id) {
    const timer = this.timers.get(id);
    if (!timer) return null;
    const elapsed = (Date.now() - timer.fetchTime) / 1000;
    return Math.max(0, timer.baseValue - elapsed);
  }

  getFormatted(id) {
    const current = this.getCurrent(id);
    return window.fmt.countdown(current);
  }

  clear() {
    this.timers.clear();
  }
}

window.CountdownManager = CountdownManager;
