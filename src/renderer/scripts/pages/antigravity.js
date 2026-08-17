// Antigravity keeps its credentials in Electron safeStorage, so no quota API is
// reachable and there is deliberately no gauge here - only real activity counts
// read from the local conversation store.
class AntigravityPage {
  constructor(container, countdowns, staleness) {
    this.container = container;
    this.countdowns = countdowns;
    this.staleness = staleness;
    this.spark = null;
    this.gauge = null;
    this.groupBars = {};
    this.groupSignature = null;
    this.built = false;
  }

  build() {
    this.container.innerHTML = `
      <div class="gauge-container" id="ag-gauge-wrap"></div>

      <div id="ag-groups"></div>
      <div class="quota-state" id="ag-quota-state" style="display:none"></div>
      <div id="ag-plan-wrap" style="display:none"></div>

      <div class="hero-number" style="padding-top:4px">
        <span class="hero-used" id="ag-steps-today">--</span>
      </div>
      <div class="hero-label">agent steps today</div>

      <div class="card">
        <div class="card-title"><span>Activity</span></div>
        <div class="card-rows" id="ag-rows"></div>
      </div>

      <div class="card" id="ag-spark-card" style="display:none">
        <div class="card-title">
          <span>30-Day Steps</span>
          <span class="card-title-note" id="ag-spark-peak"></span>
        </div>
        <div id="ag-spark"></div>
      </div>

      <div class="staleness-footer" id="ag-staleness" style="margin-top:auto"></div>
    `;

    this.spark = new Sparkline(this.container.querySelector('#ag-spark'), {
      accentColor: 'var(--antigravity-accent)'
    });

    const gaugeWrap = this.container.querySelector('#ag-gauge-wrap');
    this.gauge = new ArcGauge(gaugeWrap, { accentColor: 'var(--antigravity-accent)' });
    const label = document.createElement('div');
    label.className = 'gauge-label';
    label.id = 'ag-gauge-label';
    label.textContent = 'Gemini 5-Hour Window';
    gaugeWrap.appendChild(label);

    this.groupBars = {};
    this.built = true;
  }

  update(data) {
    if (!this.built) this.build();
    const activity = data?.antigravity?.activity;
    if (!activity) {
      this.container.innerHTML = '<div class="no-data">No Antigravity data available</div>';
      this.built = false;
      return;
    }

    this.staleness.updateSection('antigravity', activity.ageSec, { good: 150, warn: 420 });

    this.container.querySelector('#ag-steps-today').textContent =
      activity.stepsToday != null ? activity.stepsToday.toLocaleString() : '--';

    const items = [
      { label: 'This week', value: fmt.compact(activity.stepsWeek) },
      { label: 'This month', value: fmt.compact(activity.stepsMonth) },
      { label: 'All time', value: fmt.compact(activity.stepsTotal) },
      {
        label: 'Conversations',
        value: activity.conversations?.toLocaleString() ?? '--',
        secondary: activity.conversationsWeek ? activity.conversationsWeek + ' this week' : null
      },
      { label: 'Last active', value: activity.lastActiveSec != null ? fmt.age(activity.lastActiveSec) + ' ago' : '--' },
    ];

    this.container.querySelector('#ag-rows').innerHTML = items.map(i => `
      <div class="card-row">
        <span class="card-row-label">${i.label}</span>
        <span>
          <span class="card-row-value">${i.value}</span>
          ${i.secondary ? `<span class="card-row-secondary">${i.secondary}</span>` : ''}
        </span>
      </div>
    `).join('');

    this.buildQuota(data.antigravity);
    this.buildSpark(activity.days);
    this.updateStaleness();
  }

  // Mirrors Antigravity's own Settings > Models & Usage panel: one card per
  // model group, each with its 5-hour and weekly windows.
  buildQuota(section) {
    const groupsEl = this.container.querySelector('#ag-groups');
    const state = this.container.querySelector('#ag-quota-state');
    const planWrap = this.container.querySelector('#ag-plan-wrap');
    if (!groupsEl || !state) return;

    const quota = section?.quota;
    if (!quota) {
      groupsEl.innerHTML = '';
      this.groupBars = {};
      this.gauge.update(null, '');
      planWrap.style.display = 'none';
      state.style.display = '';
      state.className = 'quota-state warn';
      state.textContent = section?.quotaMessage || 'Open Antigravity to read its usage limits';
      return;
    }

    state.style.display = 'none';

    // The 5-hour Gemini window is the one that moves hour to hour, so it leads.
    const gemini = quota.groups.find(g => /gemini/i.test(g.name)) || quota.groups[0];
    const lead = gemini?.windows.find(w => w.window === '5h');
    this.container.querySelector('#ag-gauge-label').textContent =
      (gemini?.name || 'Gemini') + ' 5-Hour Window';
    this.gauge.update(lead?.usedPct,
      lead?.resetsInSec != null ? 'resets ' + fmt.countdown(lead.resetsInSec) : '');
    this.countdowns.set('ag-lead', lead?.resetsInSec);

    // Rebuild only when the set of groups changes, so the bar width transitions
    // animate instead of being thrown away on every poll.
    const signature = quota.groups.map(g => g.name + ':' + g.windows.map(w => w.id).join(',')).join('|');
    if (signature !== this.groupSignature) {
      this.groupSignature = signature;
      this.groupBars = {};
      groupsEl.innerHTML = quota.groups.map(g => `
        <div class="card" style="margin-bottom:8px">
          <div class="card-title"><span>${g.name}</span></div>
          <div class="quota-windows" data-group="${g.name}"></div>
        </div>
      `).join('');

      quota.groups.forEach(g => {
        const host = groupsEl.querySelector(`[data-group="${CSS.escape(g.name)}"]`);
        g.windows.forEach(w => {
          const row = document.createElement('div');
          row.className = 'progress-row';
          row.style.marginBottom = '6px';
          row.innerHTML = `
            <div class="progress-header">
              <span class="progress-label">${w.label}</span>
              <span class="progress-value" data-v="${w.id}">--</span>
            </div>`;
          const barWrap = document.createElement('div');
          row.appendChild(barWrap);
          const reset = document.createElement('div');
          reset.className = 'progress-reset';
          reset.dataset.r = w.id;
          row.appendChild(reset);
          host.appendChild(row);

          this.groupBars[w.id] = {
            bar: new ProgressBar(barWrap, { accentColor: 'var(--antigravity-accent)', height: 5 }),
            value: row.querySelector(`[data-v="${w.id}"]`),
            reset
          };
        });
      });
    }

    for (const g of quota.groups) {
      for (const w of g.windows) {
        const ref = this.groupBars[w.id];
        if (!ref) continue;
        ref.bar.update(w.usedPct);
        // Shown as remaining, matching the wording in Antigravity's own panel.
        ref.value.textContent = w.remainingPct != null ? w.remainingPct + '% left' : '--';
        ref.reset.textContent = w.resetsInSec != null ? 'resets in ' + fmt.countdown(w.resetsInSec) : '';
        this.countdowns.set('ag-' + w.id, w.resetsInSec);
      }
    }

    if (quota.plan) {
      planWrap.style.display = '';
      planWrap.innerHTML = `
        <div class="plan-badge">
          <div class="plan-badge-dot" style="background:var(--antigravity-accent)"></div>
          Google AI ${quota.plan}
        </div>`;
    } else {
      planWrap.style.display = 'none';
    }
  }

  // The collector sends a date-keyed map; flatten it to the same fixed-length
  // 30-day series the Claude sparkline uses.
  buildSpark(days) {
    const card = this.container.querySelector('#ag-spark-card');
    if (!days || typeof days !== 'object') {
      card.style.display = 'none';
      return;
    }

    const series = [];
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(cursor);
      d.setDate(d.getDate() - i);
      const p = n => String(n).padStart(2, '0');
      const key = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      series.push(days[key] || 0);
    }

    if (series.every(v => v === 0)) {
      card.style.display = 'none';
      return;
    }

    card.style.display = '';
    this.spark.update(series);
    this.container.querySelector('#ag-spark-peak').textContent = 'peak ' + Math.max(...series);
  }

  tick() {
    const lead = this.countdowns.getFormatted('ag-lead');
    if (this.gauge && lead) {
      this.gauge.update(this.gauge.currentPct,
        this.countdowns.getCurrent('ag-lead') != null ? 'resets ' + lead : '');
    }
    for (const [id, ref] of Object.entries(this.groupBars || {})) {
      const text = this.countdowns.getFormatted('ag-' + id);
      if (ref.reset && text) {
        ref.reset.textContent = this.countdowns.getCurrent('ag-' + id) != null
          ? 'resets in ' + text : '';
      }
    }
    this.updateStaleness();
  }

  updateStaleness() {
    const el = this.container.querySelector('#ag-staleness');
    if (el) el.textContent = this.staleness.getFooterText('antigravity');
  }
}

window.AntigravityPage = AntigravityPage;
