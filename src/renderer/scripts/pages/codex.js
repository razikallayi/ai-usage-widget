class CodexPage {
  constructor(container, countdowns, staleness) {
    this.container = container;
    this.countdowns = countdowns;
    this.staleness = staleness;
    this.gauge = null;
    this.weeklyBar = null;
    this.sessionAgeSec = null;
    this.spark = null;
    this.range = 'today';
    this.lastHistory = null;
    this.built = false;
  }

  build() {
    this.container.innerHTML = `
      <div class="gauge-container" id="codex-gauge-wrap"></div>
      <div class="progress-row" id="codex-weekly-row">
        <div class="progress-header">
          <span class="progress-label">Weekly</span>
          <span class="progress-value" id="codex-weekly-pct">--</span>
        </div>
        <div id="codex-weekly-bar"></div>
        <div class="progress-reset" id="codex-weekly-reset"></div>
      </div>
      <div class="card" id="codex-history-card" style="display:none">
        <div class="card-title">
          <span>Tokens</span>
          <div class="card-title-tabs" id="codex-range">
            <button class="range-btn active" data-range="today">Today</button>
            <button class="range-btn" data-range="week">Week</button>
            <button class="range-btn" data-range="month">Month</button>
            <button class="range-btn" data-range="allTime">All</button>
          </div>
        </div>
        <div class="card-rows" id="codex-history-rows"></div>
        <div class="spark-wrap" id="codex-spark-wrap" style="display:none">
          <div class="spark-caption">
            <span>30-day tokens</span>
            <span id="codex-spark-peak"></span>
          </div>
          <div id="codex-spark"></div>
        </div>
      </div>
      <div class="card" id="codex-tokens-card" style="display:none">
        <div class="card-title"><span>Latest Session Tokens</span></div>
        <div class="card-rows" id="codex-tokens-rows"></div>
      </div>
      <div id="codex-plan-wrap" style="display:none;margin-top:8px"></div>
      <div class="staleness-footer" id="codex-staleness" style="margin-top:auto"></div>
    `;

    const gaugeWrap = this.container.querySelector('#codex-gauge-wrap');
    this.gauge = new ArcGauge(gaugeWrap, { accentColor: 'var(--codex-accent)' });

    const label = document.createElement('div');
    label.className = 'gauge-label';
    label.id = 'codex-gauge-label';
    label.textContent = '5-Hour Window';
    gaugeWrap.appendChild(label);

    const barContainer = this.container.querySelector('#codex-weekly-bar');
    this.weeklyBar = new ProgressBar(barContainer, { accentColor: 'var(--codex-accent)' });

    this.spark = new Sparkline(this.container.querySelector('#codex-spark'), {
      accentColor: 'var(--tokens-accent)'
    });

    this.container.querySelector('#codex-range').addEventListener('click', (e) => {
      const btn = e.target.closest('.range-btn');
      if (!btn) return;
      this.range = btn.dataset.range;
      this.container.querySelectorAll('#codex-range .range-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
      if (this.lastHistory) this.buildHistory(this.lastHistory);
    });

    this.built = true;
  }

  update(data) {
    if (!this.built) this.build();
    if (!data?.codex?.limits) {
      this.container.innerHTML = '<div class="no-data">No Codex data available</div>';
      this.built = false;
      return;
    }

    const limits = data.codex.limits;
    this.staleness.updateSection('codex', limits.ageSec);
    this.sessionAgeSec = limits.sessionAgeSec ?? null;

    // Not every Codex plan exposes a 5-hour window - this one reports only the
    // weekly. Leading with whichever exists keeps the gauge meaningful instead
    // of parking it on "--" forever.
    const primary = limits.fiveHour ?? limits.weekly;
    this.container.querySelector('#codex-gauge-label').textContent =
      limits.fiveHour ? '5-Hour Window' : 'Weekly Window';

    this.gauge.update(primary?.pct, primary?.resetsInSec != null ? 'resets ' + fmt.countdown(primary.resetsInSec) : '');
    this.countdowns.set('codex-fiveHour', primary?.resetsInSec);

    const weekly = limits.weekly;
    this.container.querySelector('#codex-weekly-pct').textContent = fmt.pct(weekly?.pct);
    this.weeklyBar.update(weekly?.pct);
    this.countdowns.set('codex-weekly', weekly?.resetsInSec);
    this.container.querySelector('#codex-weekly-reset').textContent =
      weekly?.resetsInSec != null ? 'resets in ' + fmt.countdown(weekly.resetsInSec) : '';

    this.buildHistory(data.codex.history);
    this.buildTokens(data.codex.tokens);

    const planWrap = this.container.querySelector('#codex-plan-wrap');
    if (limits.plan) {
      planWrap.style.display = '';
      planWrap.innerHTML = `
        <div class="plan-badge">
          <div class="plan-badge-dot" style="background:var(--codex-accent)"></div>
          Codex ${limits.plan}
        </div>`;
    } else {
      planWrap.style.display = 'none';
    }

    this.updateStaleness();
  }

  // Totals across every rollout file on disk, giving Codex the same history the
  // Claude tab has. Each session's cumulative total is counted once, attributed
  // to the day of the session.
  buildHistory(history) {
    const card = this.container.querySelector('#codex-history-card');
    const rows = this.container.querySelector('#codex-history-rows');
    if (!card) return;
    if (!history) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    this.lastHistory = history;

    const bucket = history[this.range] || {};
    const parts = [
      { label: 'Input', value: bucket.in },
      { label: 'Cached', value: bucket.cached },
      { label: 'Output', value: bucket.out },
      { label: 'Reasoning', value: bucket.reasoning },
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
          ${history.sessions ? `<span class="card-row-secondary">${history.sessions} sessions</span>` : ''}
        </span>
      </div>`;

    const wrap = this.container.querySelector('#codex-spark-wrap');
    if (Array.isArray(history.daily) && history.daily.some(v => v > 0)) {
      wrap.style.display = '';
      this.spark.update(history.daily);
      this.container.querySelector('#codex-spark-peak').textContent =
        'peak ' + fmt.compact(Math.max(...history.daily));
    } else {
      wrap.style.display = 'none';
    }
  }

  // Codex only records a running total per session, not a cross-session tally,
  // so this is explicitly the most recent session rather than a lifetime figure.
  buildTokens(tokens) {
    const card = this.container.querySelector('#codex-tokens-card');
    const rows = this.container.querySelector('#codex-tokens-rows');
    if (!card) return;
    if (!tokens) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';

    const parts = [
      { label: 'Input', value: tokens.in },
      { label: 'Cached', value: tokens.cached },
      { label: 'Output', value: tokens.out },
      { label: 'Reasoning', value: tokens.reasoning },
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
          <span class="card-row-value">${fmt.compact(tokens.total)}</span>
          ${tokens.contextWindow ? `<span class="card-row-secondary">${fmt.compact(tokens.contextWindow)} ctx</span>` : ''}
        </span>
      </div>`;
  }

  tick() {
    const fiveReset = this.countdowns.getFormatted('codex-fiveHour');
    if (this.gauge && fiveReset) {
      this.gauge.update(this.gauge.currentPct,
        this.countdowns.getCurrent('codex-fiveHour') != null ? 'resets ' + fiveReset : '');
    }

    const weeklyReset = this.countdowns.getFormatted('codex-weekly');
    const resetEl = this.container.querySelector('#codex-weekly-reset');
    if (resetEl && weeklyReset) {
      resetEl.textContent = this.countdowns.getCurrent('codex-weekly') != null
        ? 'resets in ' + weeklyReset : '';
    }

    this.updateStaleness();
  }

  updateStaleness() {
    const el = this.container.querySelector('#codex-staleness');
    if (!el) return;
    const fresh = this.staleness.getFooterText('codex');
    // Codex figures are only as current as the last session that wrote them,
    // so say when that was rather than implying live numbers.
    el.textContent = this.sessionAgeSec != null
      ? 'last session ' + fmt.age(this.sessionAgeSec) + ' ago'
      : fresh;
  }
}

window.CodexPage = CodexPage;
