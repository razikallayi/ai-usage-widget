// Scheduling note: everything is driven off the 1-second tick rather than a
// second setInterval at the poll interval. A bare interval timer is exactly
// what used to make the widget "stop fetching" - Chromium coalesces and then
// freezes timers in a hidden page, and a machine that slept skips them
// entirely. The tick compares wall-clock elapsed against the interval, so a
// missed or throttled tick self-corrects on the next one instead of leaving
// the widget permanently stale.
const MAX_RETRY_MS = 120000;

class ApiPoller {
  constructor() {
    this.data = null;
    this.lastFetchTime = null;   // last SUCCESS - staleness and the footers key off this
    this.lastAttemptTime = null; // last attempt, success or not - drives the watchdog
    this.error = null;
    this.tickTimer = null;
    this.relayUrl = '';
    this.readToken = '';
    this.intervalMs = 20000;
    this.inFlight = false;
    this.inFlightSince = 0;
    this.failureStreak = 0;
    this.timeoutMs = 12000;
  }

  start(relayUrl, readToken, intervalMs = 20000) {
    this.stop();
    this.relayUrl = relayUrl;
    this.readToken = readToken;
    this.intervalMs = Math.max(5000, intervalMs);
    this.failureStreak = 0;
    this.fetchOnce();
    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  // How long to wait before the next attempt. A dead collector backs off so it
  // is not hammered every interval, but the cap keeps recovery within 2 minutes
  // once it comes back - without anyone having to click anything.
  nextDelayMs() {
    if (!this.failureStreak) return this.intervalMs;
    return Math.min(this.intervalMs * Math.pow(2, this.failureStreak - 1), MAX_RETRY_MS);
  }

  async fetchOnce() {
    if (!this.relayUrl || !this.readToken) return;
    // A wedged inFlight flag would stop polling forever, which is the very
    // failure this class exists to avoid - so the guard expires.
    if (this.inFlight && Date.now() - this.inFlightSince < this.timeoutMs * 2) return;

    this.inFlight = true;
    this.inFlightSince = Date.now();
    this.lastAttemptTime = Date.now();

    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.relayUrl + '/v1/summary', {
        headers: { 'Authorization': 'Bearer ' + this.readToken },
        signal: ctl.signal
      });

      if (res.status === 401) {
        this.fail('Authentication failed. Check your read token.');
        return;
      }

      if (!res.ok) {
        this.fail('Relay returned ' + res.status);
        return;
      }

      this.data = await res.json();
      this.lastFetchTime = Date.now();
      this.error = null;
      this.failureStreak = 0;
      document.dispatchEvent(new CustomEvent('data:update', { detail: this.data }));
    } catch (err) {
      this.fail(err?.name === 'AbortError'
        ? 'Connection timed out while fetching usage data.'
        : 'Connection failed: ' + (err.message || 'network error'));
    } finally {
      clearTimeout(timeout);
      this.inFlight = false;
    }
  }

  fail(message) {
    this.error = message;
    this.failureStreak++;
    document.dispatchEvent(new CustomEvent('data:error', { detail: { message } }));
  }

  // Manual refresh: ask the collector to re-poll its sources now, then read the
  // result. Best effort on the trigger - a remote relay may not implement
  // /v1/refresh - but the summary fetch afterwards is what actually matters.
  async refreshNow() {
    if (!this.relayUrl || !this.readToken) return;

    let skipped = [];
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 25000);
    try {
      const res = await fetch(this.relayUrl + '/v1/refresh', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + this.readToken },
        signal: ctl.signal
      });
      if (res.ok) {
        const body = await res.json();
        if (Array.isArray(body.skipped)) skipped = body.skipped;
      }
    } catch {
      // Ignore refresh trigger failures; the summary fetch below is authoritative.
    } finally {
      clearTimeout(timeout);
    }

    await this.fetchOnce();

    // Say why a source did not move, rather than letting the click look like it
    // did nothing. Sources in 429 backoff are deliberately left alone.
    if (skipped.length && !this.error) {
      const parts = skipped.map(s => s.name + (s.retryInSec ? ' (retry in ' + window.fmt.age(s.retryInSec) + ')' : ''));
      this.error = 'Rate limited, left alone: ' + parts.join(', ');
      document.dispatchEvent(new CustomEvent('data:error', { detail: { message: this.error } }));
    }
  }

  getSecondsSinceLastSuccess() {
    return this.lastFetchTime ? Math.round((Date.now() - this.lastFetchTime) / 1000) : null;
  }

  tick() {
    document.dispatchEvent(new CustomEvent('data:tick', {
      detail: { elapsed: this.lastFetchTime ? (Date.now() - this.lastFetchTime) / 1000 : 0 }
    }));

    const since = Date.now() - (this.lastAttemptTime ?? 0);
    if (since >= this.nextDelayMs()) this.fetchOnce();
  }

  stop() {
    clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.inFlight = false;
    this.inFlightSince = 0;
    this.failureStreak = 0;
    this.lastAttemptTime = null;
    this.relayUrl = '';
    this.readToken = '';
  }
}

window.ApiPoller = ApiPoller;
