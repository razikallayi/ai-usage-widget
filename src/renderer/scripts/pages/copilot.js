class CopilotPage {
  constructor(container, countdowns, staleness) {
    this.container = container;
    this.countdowns = countdowns;
    this.staleness = staleness;
    this.bar = null;
    this.built = false;
  }

  build() {
    this.container.innerHTML = `
      <div class="hero-number">
        <span class="hero-used" id="copilot-used">--</span>
        <span class="hero-sep">/</span>
        <span class="hero-included" id="copilot-included">--</span>
      </div>
      <div class="hero-label">premium requests used</div>
      <div class="progress-row" style="margin-top:8px">
        <div class="progress-header">
          <span class="progress-label">Usage</span>
          <span class="progress-value" id="copilot-pct">--</span>
        </div>
        <div id="copilot-bar"></div>
        <div class="progress-reset" id="copilot-reset"></div>
      </div>
      <div class="card" id="copilot-trend-card" style="display:none">
        <div class="card-title"><span>Burn Rate</span></div>
        <div class="card-rows" id="copilot-trend-rows"></div>
        <div class="spark-wrap">
          <div class="spark-caption">
            <span>30-day requests</span>
            <span id="copilot-spark-peak"></span>
          </div>
          <div id="copilot-spark"></div>
        </div>
      </div>
      <div class="card" id="copilot-quotas-card" style="display:none">
        <div class="card-title"><span>Quotas</span></div>
        <div class="card-rows" id="copilot-quotas-rows"></div>
      </div>
      <div id="copilot-plan-wrap" style="display:none;margin-top:8px"></div>
      <div class="staleness-footer" id="copilot-staleness" style="margin-top:auto"></div>
    `;

    const barContainer = this.container.querySelector('#copilot-bar');
    this.bar = new ProgressBar(barContainer, { accentColor: 'var(--copilot-accent)', height: 8 });

    this.spark = new Sparkline(this.container.querySelector('#copilot-spark'), {
      accentColor: 'var(--copilot-accent)'
    });

    this.built = true;
  }

  update(data) {
    if (!this.built) this.build();
    if (!data?.copilot?.quota) {
      this.container.innerHTML = '<div class="no-data">No Copilot data available</div>';
      this.built = false;
      return;
    }

    const quota = data.copilot.quota;
    // A monthly counter polled every 5 minutes - minutes of age are expected.
    this.staleness.updateSection('copilot', quota.ageSec, { good: 600, warn: 1500 });

    const usedEl = this.container.querySelector('#copilot-used');
    const includedEl = this.container.querySelector('#copilot-included');

    usedEl.textContent = quota.used != null ? quota.used.toLocaleString() : '--';

    if (quota.included == null) {
      includedEl.textContent = '(unlimited)';
      this.container.querySelector('.hero-sep').style.display = 'none';
    } else {
      includedEl.textContent = quota.included.toLocaleString();
      this.container.querySelector('.hero-sep').style.display = '';
    }

    this.container.querySelector('#copilot-pct').textContent =
      quota.pctUsed != null ? quota.pctUsed.toFixed(1) + '%' : '--';
    this.bar.update(quota.pctUsed);

    this.countdowns.set('copilot-reset', quota.resetsInSec);
    this.container.querySelector('#copilot-reset').textContent =
      quota.resetsInSec != null ? 'resets in ' + fmt.countdown(quota.resetsInSec) : '';

    this.buildTrend(quota);
    this.buildQuotas(quota);

    const planWrap = this.container.querySelector('#copilot-plan-wrap');
    if (quota.plan) {
      planWrap.style.display = '';
      planWrap.innerHTML = `
        <div class="plan-badge">
          <div class="plan-badge-dot" style="background:var(--copilot-accent)"></div>
          ${quota.plan}${quota.login ? ' &middot; ' + quota.login : ''}
        </div>`;
    } else {
      planWrap.style.display = 'none';
    }

    this.updateStaleness();
  }

  // Answers "will I run out before the reset", which the raw counter does not.
  buildTrend(quota) {
    const card = this.container.querySelector('#copilot-trend-card');
    const rows = this.container.querySelector('#copilot-trend-rows');
    if (!card) return;

    const trend = quota.trend;
    if (!trend || trend.perDay == null) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';

    const items = [{ label: 'Per day', value: trend.perDay.toLocaleString() }];

    if (trend.projected != null && quota.included) {
      const overBudget = trend.projected > quota.included;
      items.push({
        label: 'Projected at reset',
        value: trend.projected.toLocaleString() + ' / ' + quota.included.toLocaleString(),
        // Flag it only when the current rate would actually exhaust the budget.
        warn: overBudget
      });
    }
    if (trend.daysToReset != null) {
      items.push({ label: 'Days to reset', value: trend.daysToReset.toLocaleString() });
    }
    // Stated plainly: a closed laptop is not zero usage, and the average is
    // over observed days only.
    if (trend.observedDays != null && trend.observedDays < 7) {
      items.push({ label: 'Based on', value: trend.observedDays + ' day' + (trend.observedDays === 1 ? '' : 's') });
    }

    rows.innerHTML = items.map(i => `
      <div class="card-row">
        <span class="card-row-label">${i.label}</span>
        <span class="card-row-value"${i.warn ? ' style="color:var(--status-warn)"' : ''}>${i.value}</span>
      </div>
    `).join('');

    this.spark.update(trend.daily);
    this.container.querySelector('#copilot-spark-peak').textContent =
      'peak ' + Math.max(...(trend.daily || [0])).toLocaleString();
  }

  buildQuotas(quota) {
    const card = this.container.querySelector('#copilot-quotas-card');
    const rows = this.container.querySelector('#copilot-quotas-rows');
    if (!card) return;

    // An unlimited quota reports entitlement 0, so "0 / 0" would be actively
    // misleading - say "unlimited" instead.
    const describe = (snap) => {
      if (!snap) return null;
      if (snap.unlimited) return 'unlimited';
      if (snap.included == null) return '--';
      return snap.used?.toLocaleString() + ' / ' + snap.included.toLocaleString();
    };

    const items = [
      { label: 'Premium', value: describe(quota) },
      { label: 'Chat', value: describe(quota.chat) },
      { label: 'Completions', value: describe(quota.completions) },
    ].filter(i => i.value);

    if (quota.creditsUsed) items.push({ label: 'Credits used', value: fmt.cost(quota.creditsUsed) });
    if (quota.overageCount) items.push({ label: 'Overage', value: quota.overageCount.toLocaleString() });
    if (quota.resetDate) items.push({ label: 'Resets', value: quota.resetDate });

    if (items.length === 0) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    rows.innerHTML = items.map(i => `
      <div class="card-row">
        <span class="card-row-label">${i.label}</span>
        <span class="card-row-value">${i.value}</span>
      </div>
    `).join('');
  }

  tick() {
    const reset = this.countdowns.getFormatted('copilot-reset');
    const resetEl = this.container.querySelector('#copilot-reset');
    if (resetEl && reset) {
      resetEl.textContent = this.countdowns.getCurrent('copilot-reset') != null
        ? 'resets in ' + reset : '';
    }
    this.updateStaleness();
  }

  updateStaleness() {
    const el = this.container.querySelector('#copilot-staleness');
    if (el) el.textContent = this.staleness.getFooterText('copilot');
  }
}

window.CopilotPage = CopilotPage;
