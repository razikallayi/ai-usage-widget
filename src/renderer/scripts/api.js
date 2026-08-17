class ApiPoller {
  constructor() {
    this.data = null;
    this.lastFetchTime = null;
    this.error = null;
    this.pollTimer = null;
    this.tickTimer = null;
  }

  start(relayUrl, readToken, intervalMs = 20000) {
    this.stop();
    this.fetchOnce(relayUrl, readToken);
    this.pollTimer = setInterval(() => this.fetchOnce(relayUrl, readToken), intervalMs);
    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  async fetchOnce(relayUrl, readToken) {
    try {
      const res = await fetch(relayUrl + '/v1/summary', {
        headers: { 'Authorization': 'Bearer ' + readToken }
      });

      if (res.status === 401) {
        this.error = 'Authentication failed. Check your read token.';
        document.dispatchEvent(new CustomEvent('data:error', { detail: { message: this.error } }));
        return;
      }

      if (!res.ok) {
        this.error = 'Relay returned ' + res.status;
        document.dispatchEvent(new CustomEvent('data:error', { detail: { message: this.error } }));
        return;
      }

      this.data = await res.json();
      this.lastFetchTime = Date.now();
      this.error = null;
      document.dispatchEvent(new CustomEvent('data:update', { detail: this.data }));
    } catch (err) {
      this.error = 'Connection failed: ' + (err.message || 'network error');
      document.dispatchEvent(new CustomEvent('data:error', { detail: { message: this.error } }));
    }
  }

  tick() {
    document.dispatchEvent(new CustomEvent('data:tick', {
      detail: { elapsed: this.lastFetchTime ? (Date.now() - this.lastFetchTime) / 1000 : 0 }
    }));
  }

  stop() {
    clearInterval(this.pollTimer);
    clearInterval(this.tickTimer);
    this.pollTimer = null;
    this.tickTimer = null;
  }
}

window.ApiPoller = ApiPoller;
