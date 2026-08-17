class ClaudePage {
  constructor(container, countdowns, staleness) {
    this.container = container;
    this.countdowns = countdowns;
    this.staleness = staleness;
    this.gauge = null;
    this.weeklyBar = null;
    this.extraBars = [];
    this.spark = null;
    this.range = 'today';
    this.lastTokens = null;
    this.built = false;
  }

  build() {
    this.container.innerHTML = `
      <div class="gauge-container" id="claude-gauge-wrap"></div>
      <div class="progress-row" id="claude-weekly-row">
        <div class="progress-header">
          <span class="progress-label">Weekly</span>
          <span class="progress-value" id="claude-weekly-pct">--</span>
        </div>
        <div id="claude-weekly-bar"></div>
        <div class="progress-reset" id="claude-weekly-reset"></div>
      </div>
      <div class="card" id="claude-extras-card" style="display:none">
        <div class="card-title">Per-Model Limits</div>
        <div id="claude-extras-list"></div>
      </div>
      <div class="card" id="claude-tokens-card" style="display:none">
        <div class="card-title">
          <span>Tokens</span>
          <div class="card-title-tabs" id="claude-token-range">
            <button class="range-btn active" data-range="today">Today</button>
            <button class="range-btn" data-range="week">Week</button>
            <button class="range-btn" data-range="month">Month</button>
            <button class="range-btn" data-range="allTime">All</button>
          </div>
        </div>
        <div class="card-rows" id="claude-tokens-rows"></div>
        <div class="spark-wrap" id="claude-spark-wrap" style="display:none">
          <div class="spark-caption">
            <span>30-day tokens</span>
            <span id="claude-spark-peak"></span>
          </div>
          <div id="claude-spark"></div>
        </div>
      </div>
      <div class="staleness-footer" id="claude-staleness"></div>
    `;

    const gaugeWrap = this.container.querySelector('#claude-gauge-wrap');
    this.gauge = new ArcGauge(gaugeWrap, { accentColor: 'var(--claude-accent)' });

    const label = document.createElement('div');
    label.className = 'gauge-label';
    label.textContent = 'Session (5-hour window)';
    gaugeWrap.appendChild(label);

    const barContainer = this.container.querySelector('#claude-weekly-bar');
    this.weeklyBar = new ProgressBar(barContainer, { accentColor: 'var(--claude-accent)' });

    this.spark = new Sparkline(this.container.querySelector('#claude-spark'), {
      accentColor: 'var(--tokens-accent)'
    });

    this.container.querySelector('#claude-token-range').addEventListener('click', (e) => {
      const btn = e.target.closest('.range-btn');
      if (!btn) return;
      this.range = btn.dataset.range;
      this.container.querySelectorAll('#claude-token-range .range-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
      if (this.lastTokens) this.buildTokens(this.lastTokens);
    });

    this.built = true;
  }

  update(data) {
    if (!this.built) this.build();
    if (!data?.claude) {
      this.container.innerHTML = '<div class="no-data">No Claude data available</div>';
      this.built = false;
      return;
    }

    const { limits, tokens } = data.claude;

    if (limits) {
      // Polled upstream every 2 minutes; anything under 4 is normal.
      this.staleness.updateSection('claude-limits', limits.ageSec, { good: 240, warn: 600 });
      const session = limits.session;
      this.gauge.update(session?.pct, session?.resetsInSec != null ? 'resets ' + fmt.countdown(session.resetsInSec) : '');
      this.countdowns.set('claude-session', session?.resetsInSec);

      const weekly = limits.weekly;
      this.container.querySelector('#claude-weekly-pct').textContent = fmt.pct(weekly?.pct);
      this.weeklyBar.update(weekly?.pct);
      this.countdowns.set('claude-weekly', weekly?.resetsInSec);
      this.container.querySelector('#claude-weekly-reset').textContent =
        weekly?.resetsInSec != null ? 'resets in ' + fmt.countdown(weekly.resetsInSec) : '';

      this.buildExtras(limits.extra, limits.extraUsage);
    }

    if (tokens) {
      this.staleness.updateSection('claude-tokens', tokens.ageSec);
      this.buildTokens(tokens);
    }

    this.updateStaleness();
  }

  buildExtras(extras, extraUsage) {
    const card = this.container.querySelector('#claude-extras-card');
    const list = this.container.querySelector('#claude-extras-list');
    if (!extras || extras.length === 0) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    list.innerHTML = '';
    this.extraBars = [];

    extras.forEach(ext => {
      const row = document.createElement('div');
      row.className = 'progress-row';
      row.style.marginBottom = '6px';
      row.innerHTML = `
        <div class="progress-header">
          <span class="progress-label">${ext.label}</span>
          <span class="progress-value">${fmt.pct(ext.pct)}</span>
        </div>
      `;
      const barWrap = document.createElement('div');
      row.appendChild(barWrap);
      const bar = new ProgressBar(barWrap, { accentColor: 'var(--claude-accent)', height: 5 });
      bar.update(ext.pct);
      this.extraBars.push(bar);
      list.appendChild(row);
    });

    if (extraUsage?.usedCreditsUsd != null) {
      const credits = document.createElement('div');
      credits.style.cssText = 'font-size:10px;color:var(--text-dim);margin-top:4px;';
      credits.textContent = 'Credits: ' + fmt.cost(extraUsage.usedCreditsUsd);
      list.appendChild(credits);
    }
  }

  buildTokens(tokens) {
    const card = this.container.querySelector('#claude-tokens-card');
    const rows = this.container.querySelector('#claude-tokens-rows');
    if (!tokens) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    this.lastTokens = tokens;

    const bucket = tokens[this.range] || {};
    const cost = this.range === 'month' ? tokens.costUsd?.month
      : this.range === 'allTime' ? tokens.costUsd?.allTime : null;

    // Cache reads dominate the total by an order of magnitude, so the split
    // matters more here than the headline number.
    const parts = [
      { label: 'Input', value: bucket.in },
      { label: 'Output', value: bucket.out },
      { label: 'Cache read', value: bucket.cacheRead },
      { label: 'Cache write', value: bucket.cacheWrite },
    ];

    rows.innerHTML = parts.map(p => `
      <div class="card-row">
        <span class="card-row-label">${p.label}</span>
        <span class="card-row-value">${fmt.compact(p.value)}</span>
      </div>
    `).join('') + `
      <div class="card-row card-row-total">
        <span class="card-row-label">Total</span>
        <span>
          <span class="card-row-value">${fmt.compact(bucket.total)}</span>
          ${cost != null ? `<span class="card-row-secondary">${fmt.cost(cost)}</span>` : ''}
        </span>
      </div>`;

    const sparkWrap = this.container.querySelector('#claude-spark-wrap');
    if (Array.isArray(tokens.daily) && tokens.daily.length > 1) {
      sparkWrap.style.display = '';
      this.spark.update(tokens.daily);
      this.container.querySelector('#claude-spark-peak').textContent =
        'peak ' + fmt.compact(Math.max(...tokens.daily));
    } else {
      sparkWrap.style.display = 'none';
    }
  }

  tick() {
    const sessionReset = this.countdowns.getFormatted('claude-session');
    if (this.gauge && sessionReset) {
      this.gauge.update(this.gauge.currentPct,
        this.countdowns.getCurrent('claude-session') != null ? 'resets ' + sessionReset : '');
    }

    const weeklyReset = this.countdowns.getFormatted('claude-weekly');
    const resetEl = this.container.querySelector('#claude-weekly-reset');
    if (resetEl && weeklyReset) {
      resetEl.textContent = this.countdowns.getCurrent('claude-weekly') != null
        ? 'resets in ' + weeklyReset : '';
    }

    this.updateStaleness();
  }

  updateStaleness() {
    const el = this.container.querySelector('#claude-staleness');
    if (el) {
      const text = this.staleness.getFooterText('claude-limits') || this.staleness.getFooterText('claude-tokens');
      el.textContent = text;
    }
  }
}

window.ClaudePage = ClaudePage;
